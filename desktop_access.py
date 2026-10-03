"""Session-only, user-approved read access for desktop integrations."""

from __future__ import annotations

import hashlib
import json
import queue
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field


READ_TOKEN_PREFIX = 'fks-read-'
READ_ACCESS_SCOPES = ('classrooms:read', 'seating:read', 'students:read')
READ_ACCESS_TOOL_NAMES = frozenset({
    'list_classrooms', 'get_classroom', 'list_classroom_groups',
    'list_students', 'get_student', 'search_students',
    'get_seat_map', 'get_layout', 'list_groups', 'get_group_stats',
    'list_constraints', 'list_tags', 'list_tag_rules', 'list_snapshots',
    'get_history', 'analyze_seating', 'validate_seating', 'suggest_improvements',
    'cross_classroom_report',
})


@dataclass(frozen=True)
class ReadAccessRequest:
    client_name: str
    token: str = field(repr=False)

    def __post_init__(self):
        if not isinstance(self.client_name, str) or not isinstance(self.token, str):
            raise ValueError('申请程序名称和只读凭证必须是字符串')
        name = str(self.client_name or '').strip()
        if not name or len(name) > 80 or any(ord(char) < 32 or ord(char) == 127 for char in name):
            raise ValueError('申请程序名称必须为 1–80 个字符，不能包含换行或控制字符')
        if not re.fullmatch(r'fks-read-[A-Za-z0-9_-]{32,128}', str(self.token or '')):
            raise ValueError('只读凭证必须以 fks-read- 开头，后接 32–128 个随机字母、数字、下划线或短横线')
        object.__setattr__(self, 'client_name', name)


class ReadAccessBroker:
    """Keep credentials in memory and serialize desktop approval prompts."""

    def __init__(self):
        self._lock = threading.Lock()
        self._requests = {}
        self._queue = queue.Queue()
        self._stop = threading.Event()
        self._thread = None

    @staticmethod
    def _key(token):
        return hashlib.sha256(str(token or '').encode('utf-8')).hexdigest()

    @property
    def running(self):
        return bool(self._thread and self._thread.is_alive() and not self._stop.is_set())

    def start(self, prompt):
        if self.running:
            return
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._approve_requests, args=(prompt, self._stop, self._queue),
            name='fuckseats-read-access', daemon=True,
        )
        self._thread.start()

    def submit(self, request):
        key = self._key(request.token)
        with self._lock:
            existing = self._requests.get(key)
            if existing:
                if existing['client_name'] != request.client_name:
                    raise ValueError('同一只读凭证不能用于不同的申请程序')
                return dict(existing)
            if len(self._requests) >= 128:
                raise ValueError('本次运行的授权申请过多，请关闭应用后重试')
            state = {'client_name': request.client_name, 'authorization': 'pending'}
            self._requests[key] = state
            self._queue.put(key)
            return dict(state)

    def lookup(self, token):
        with self._lock:
            state = self._requests.get(self._key(token))
            return dict(state) if state else None

    def _approve_requests(self, prompt, stop, pending):
        while not stop.is_set():
            try:
                key = pending.get(timeout=0.2)
            except queue.Empty:
                continue
            with self._lock:
                state = self._requests.get(key)
                name = state['client_name'] if state else None
            if name is None:
                continue
            try:
                allowed = bool(prompt(name))
            except Exception:
                allowed = False
            with self._lock:
                if not stop.is_set() and key in self._requests:
                    self._requests[key]['authorization'] = 'granted' if allowed else 'denied'

    def close(self):
        self._stop.set()
        with self._lock:
            self._requests.clear()
            self._queue = queue.Queue()


read_access_broker = ReadAccessBroker()


def forward_read_access_request(app_url, request, timeout=60):
    """Wait for an existing instance's startup, then hand it the request."""
    payload = json.dumps({
        'client_name': request.client_name, 'token': request.token,
    }, ensure_ascii=False).encode('utf-8')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + timeout
    while True:
        try:
            with opener.open(urllib.request.Request(
                app_url + '/open_api/access/request', data=payload,
                headers={'Content-Type': 'application/json'}, method='POST',
            ), timeout=2) as response:
                return json.loads(response.read(8192).decode('utf-8'))
        except urllib.error.HTTPError as exc:
            try:
                if exc.code == 403:
                    error = json.loads(exc.read(8192).decode('utf-8'))
                    if error.get('code') == 'ACCESS_DENIED':
                        raise RuntimeError('用户已拒绝本次第三方读取申请') from exc
                if exc.code != 503:
                    raise RuntimeError('已有实例无法接收授权申请，请更新应用并重试') from exc
            finally:
                exc.close()
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError('已有实例尚未启动完成，授权申请未送达，请稍后重试')
        time.sleep(0.2)
