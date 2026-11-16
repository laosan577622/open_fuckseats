"""Agent 在应用界面里申请访问：令牌由服务端签发，由用户在前端弹窗中确认后才生效。

申请本身不授予任何权限。用户确认时选择授权期限：
- session：只在本次应用运行期间有效，凭证只留在内存里；
- 30d / forever：把令牌的 SHA-256 摘要、程序名称和范围写入本地数据库，应用重启后同一令牌继续有效，
  到期或被用户撤销后失效。数据库里不保存令牌原文。
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from datetime import datetime, timezone

from .shared_state import load_json_state, save_json_state


AGENT_TOKEN_PREFIX = 'fks-agent-'
AGENT_SCOPES = ('read', 'full')
AGENT_DURATIONS = {'session': None, '30d': 30 * 24 * 3600, 'forever': None}
GRANT_STORE_KEY = 'fuckseats_agent_access_grants'
PENDING_SECONDS = 300
MAX_PENDING_REQUESTS = 6
MAX_TRACKED_REQUESTS = 128
MAX_PERSISTENT_GRANTS = 32


def _clean_text(value, *, limit, label, required=False):
    if value is None:
        value = ''
    if not isinstance(value, str):
        raise ValueError(f'{label}必须是字符串')
    text = value.strip()
    if any(ord(char) < 32 or ord(char) == 127 for char in text):
        raise ValueError(f'{label}不能包含换行或控制字符')
    if required and not text:
        raise ValueError(f'{label}不能为空')
    if len(text) > limit:
        raise ValueError(f'{label}不能超过 {limit} 个字符')
    return text


def _iso(timestamp):
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace('+00:00', 'Z')


class DatabaseGrantStore:
    """长期授权保存在本地键值表里，随应用数据库一起加密。"""

    def load(self):
        data = load_json_state(GRANT_STORE_KEY, lambda: {'grants': []})
        grants = data.get('grants') if isinstance(data, dict) else None
        return [item for item in grants if isinstance(item, dict)] if isinstance(grants, list) else []

    def save(self, grants):
        return save_json_state(GRANT_STORE_KEY, {'grants': grants})


class MemoryGrantStore:
    def __init__(self):
        self.grants = []

    def load(self):
        return [dict(item) for item in self.grants]

    def save(self, grants):
        self.grants = [dict(item) for item in grants]
        return True


class AgentAccessBroker:
    def __init__(self, *, clock=time.monotonic, wall_clock=time.time, store=None):
        self._lock = threading.Lock()
        self._clock = clock
        self._wall_clock = wall_clock
        self._store = store or DatabaseGrantStore()
        self._requests = {}

    @staticmethod
    def _key(token):
        return hashlib.sha256(str(token or '').encode('utf-8')).hexdigest()

    def _expire_locked(self):
        now = self._clock()
        for state in self._requests.values():
            if state['authorization'] == 'pending' and now - state['created'] >= PENDING_SECONDS:
                state['authorization'] = 'expired'

    def _trim_locked(self):
        if len(self._requests) < MAX_TRACKED_REQUESTS:
            return
        # 已拒绝或已过期的记录只用于让申请方读到结果，可以按时间淘汰。
        closed = sorted(
            (item for item in self._requests.items() if item[1]['authorization'] in ('denied', 'expired')),
            key=lambda item: item[1]['created'],
        )
        for key, _ in closed[:max(1, len(closed) // 2)]:
            del self._requests[key]

    def _stored_grants(self):
        """读取仍然有效的长期授权，顺手清掉已到期的记录。"""
        now = self._wall_clock()
        grants = self._store.load()
        valid = [
            item for item in grants
            if item.get('token_hash') and item.get('scope') in AGENT_SCOPES
            and (item.get('expires_at') is None or float(item['expires_at']) > now)
        ]
        if len(valid) != len(grants):
            self._store.save(valid)
        return valid

    @staticmethod
    def _public(state):
        return {
            'request_id': state['id'],
            'client_name': state['client_name'],
            'reason': state.get('reason', ''),
            'requested_scope': state.get('requested_scope', state.get('scope')),
            'authorization': state['authorization'],
            'scope': state['scope'],
            'duration': state.get('duration'),
            'granted_at': _iso(state.get('granted_at')),
            'expires_at': _iso(state.get('expires_at')),
        }

    @staticmethod
    def _stored_state(grant):
        return {
            'id': grant['id'],
            'client_name': grant.get('client_name', ''),
            'authorization': 'granted',
            'scope': grant['scope'],
            'duration': grant.get('duration', 'forever'),
            'granted_at': grant.get('granted_at'),
            'expires_at': grant.get('expires_at'),
        }

    def submit(self, client_name, scope='full', reason=''):
        client_name = _clean_text(client_name, limit=80, label='申请程序名称', required=True)
        reason = _clean_text(reason, limit=200, label='申请说明')
        scope = str(scope or 'full').strip().lower()
        if scope not in AGENT_SCOPES:
            raise ValueError('scope 只能是 read 或 full')
        token = AGENT_TOKEN_PREFIX + secrets.token_urlsafe(32)
        with self._lock:
            self._expire_locked()
            self._trim_locked()
            pending = sum(state['authorization'] == 'pending' for state in self._requests.values())
            if pending >= MAX_PENDING_REQUESTS:
                raise OverflowError('等待确认的授权申请过多，请先在应用中处理后再试')
            if len(self._requests) >= MAX_TRACKED_REQUESTS:
                raise OverflowError('本次运行的授权申请过多，请重新打开应用后再试')
            state = {
                'id': secrets.token_urlsafe(12),
                'client_name': client_name,
                'reason': reason,
                'requested_scope': scope,
                'authorization': 'pending',
                'scope': None,
                'duration': None,
                'granted_at': None,
                'expires_at': None,
                'created': self._clock(),
            }
            self._requests[self._key(token)] = state
            return {**self._public(state), 'token': token, 'expires_in': PENDING_SECONDS}

    def pending(self):
        with self._lock:
            self._expire_locked()
            return [
                self._public(state)
                for state in sorted(self._requests.values(), key=lambda item: item['created'])
                if state['authorization'] == 'pending'
            ]

    def decide(self, request_id, decision, duration='session'):
        decision = str(decision or '').strip().lower()
        duration = str(duration or 'session').strip().lower()
        if decision not in ('deny', *AGENT_SCOPES):
            raise ValueError('decision 只能是 deny、read 或 full')
        if duration not in AGENT_DURATIONS:
            raise ValueError('duration 只能是 session、30d 或 forever')
        with self._lock:
            self._expire_locked()
            entry = next((item for item in self._requests.items() if item[1]['id'] == request_id), None)
            if entry is None:
                raise LookupError('授权申请不存在')
            token_hash, state = entry
            if state['authorization'] != 'pending':
                raise LookupError('授权申请已处理或已过期')
            if decision == 'full' and state['requested_scope'] != 'full':
                raise ValueError('不能授予超出申请范围的权限')
            if decision == 'deny':
                state['authorization'] = 'denied'
                return self._public(state)
            now = self._wall_clock()
            expires_at = now + AGENT_DURATIONS[duration] if AGENT_DURATIONS[duration] else None
            if duration != 'session':
                grants = self._stored_grants()
                if len(grants) >= MAX_PERSISTENT_GRANTS:
                    raise OverflowError('长期授权的程序过多，请先在设置中撤销不再使用的授权')
                grants.append({
                    'id': state['id'], 'client_name': state['client_name'], 'scope': decision,
                    'duration': duration, 'token_hash': token_hash, 'granted_at': now, 'expires_at': expires_at,
                })
                if not self._store.save(grants):
                    raise RuntimeError('长期授权保存失败，请重试或改为仅本次运行')
            state.update(authorization='granted', scope=decision, duration=duration,
                         granted_at=now, expires_at=expires_at)
            return self._public(state)

    def lookup(self, token):
        if not str(token or '').startswith(AGENT_TOKEN_PREFIX):
            return None
        token_hash = self._key(token)
        with self._lock:
            self._expire_locked()
            state = self._requests.get(token_hash)
            if state is not None and (state['authorization'] != 'granted' or state['duration'] == 'session'):
                return self._public(state)
            # 长期授权以数据库为准：到期、被撤销或在别的窗口清理后立即失效。
            for grant in self._stored_grants():
                if secrets.compare_digest(str(grant['token_hash']), token_hash):
                    return self._public(self._stored_state(grant))
            if state is not None:
                state['authorization'] = 'denied'
                return self._public(state)
            return None

    def grants(self):
        """当前有效的授权：长期授权加上本次运行内的临时授权，供设置页展示和撤销。"""
        with self._lock:
            stored = [self._public(self._stored_state(grant)) for grant in self._stored_grants()]
            session = [
                self._public(state) for state in self._requests.values()
                if state['authorization'] == 'granted' and state['duration'] == 'session'
            ]
            return sorted(stored + session, key=lambda item: item['granted_at'] or '', reverse=True)

    def revoke(self, grant_id):
        with self._lock:
            grants = self._stored_grants()
            remaining = [item for item in grants if item['id'] != grant_id]
            found = len(remaining) != len(grants)
            if found and not self._store.save(remaining):
                raise RuntimeError('撤销失败，请重试')
            for state in self._requests.values():
                if state['id'] == grant_id and state['authorization'] == 'granted':
                    state['authorization'] = 'denied'
                    found = True
            if not found:
                raise LookupError('授权不存在或已失效')

    def clear(self):
        with self._lock:
            self._requests.clear()


agent_access_broker = AgentAccessBroker()
