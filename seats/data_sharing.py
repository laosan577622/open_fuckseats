from __future__ import annotations

import json
import os
import platform
import queue
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from typing import Any

from django.conf import settings
from django.utils import timezone

from .models import CloudSession, FrontendKVStore


OFFICIAL_DATA_SHARING_BASE_URL = 'https://fuckseatsapi.577622.xyz'
DATA_SHARING_USAGE_URL = f'{OFFICIAL_DATA_SHARING_BASE_URL}/api/improve/events'
DATA_SHARING_LOGS_URL = f'{OFFICIAL_DATA_SHARING_BASE_URL}/api/improve/logs'
DATA_SHARING_ENABLED_KEY = 'data_sharing_enabled'
DATA_SHARING_INSTALL_ID_KEY = 'data_sharing_install_id'
DATA_SHARING_LOG_RETENTION_DAYS_KEY = 'data_sharing_log_retention_days'
DATA_SHARING_PROMPT_SEEN_VERSION_KEY = 'data_sharing_prompt_seen_version'
DATA_SHARING_DEFAULT_LOG_RETENTION_DAYS = 30
DATA_SHARING_MAX_LOG_RETENTION_DAYS = 365

_QUEUE: queue.Queue[tuple[str, dict[str, Any]]] = queue.Queue(maxsize=1000)
_WORKER_LOCK = threading.Lock()
_WORKER_STARTED = False
_TRUE_VALUES = {'1', 'true', 'yes', 'on', 'enabled', 'enable', '是', '开启'}


def _kv_get(key: str, default: str = '') -> str:
    try:
        row = FrontendKVStore.objects.filter(key=key).first()
        if not row:
            return default
        return str(row.value or default)
    except Exception:
        return default


def _kv_set(key: str, value: Any) -> str:
    text = str(value if value is not None else '')
    FrontendKVStore.objects.update_or_create(key=key, defaults={'value': text})
    return text


def _bool_value(value: Any, default: bool = False) -> bool:
    if value in (None, ''):
        return default
    return str(value).strip().lower() in _TRUE_VALUES


def get_data_sharing_enabled() -> bool:
    return _bool_value(_kv_get(DATA_SHARING_ENABLED_KEY, '0'), False)


def set_data_sharing_enabled(enabled: Any) -> bool:
    value = _bool_value(enabled, False)
    _kv_set(DATA_SHARING_ENABLED_KEY, '1' if value else '0')
    return value


def get_data_sharing_log_retention_days() -> int:
    try:
        days = int(_kv_get(DATA_SHARING_LOG_RETENTION_DAYS_KEY, str(DATA_SHARING_DEFAULT_LOG_RETENTION_DAYS)))
    except (TypeError, ValueError):
        days = DATA_SHARING_DEFAULT_LOG_RETENTION_DAYS
    return max(1, min(DATA_SHARING_MAX_LOG_RETENTION_DAYS, days))


def set_data_sharing_log_retention_days(days: Any) -> int:
    try:
        value = int(days)
    except (TypeError, ValueError):
        value = DATA_SHARING_DEFAULT_LOG_RETENTION_DAYS
    value = max(1, min(DATA_SHARING_MAX_LOG_RETENTION_DAYS, value))
    _kv_set(DATA_SHARING_LOG_RETENTION_DAYS_KEY, value)
    return value


def get_or_create_install_id() -> str:
    current = _kv_get(DATA_SHARING_INSTALL_ID_KEY, '').strip()
    if current:
        return current
    generated = uuid.uuid4().hex
    try:
        return _kv_set(DATA_SHARING_INSTALL_ID_KEY, generated)
    except Exception:
        return generated


def get_data_sharing_user_uid() -> str:
    try:
        session = CloudSession.objects.order_by('-updated_at').first()
        if not session or session.token_expires_at <= timezone.now():
            return ''
        return str(session.uid or '').strip()[:64]
    except Exception:
        return ''


def get_data_sharing_prompt_seen_version() -> str:
    return _kv_get(DATA_SHARING_PROMPT_SEEN_VERSION_KEY, '').strip()


def set_data_sharing_prompt_seen_version(version: str) -> str:
    return _kv_set(DATA_SHARING_PROMPT_SEEN_VERSION_KEY, str(version or '').strip())


def should_show_data_sharing_prompt() -> bool:
    seen = get_data_sharing_prompt_seen_version()
    current = _get_app_version()
    return seen != current


def get_data_sharing_config() -> dict[str, Any]:
    local_log_retention_days = get_data_sharing_log_retention_days()
    return {
        'enabled': get_data_sharing_enabled(),
        'official_base_url': OFFICIAL_DATA_SHARING_BASE_URL,
        'usage_url': DATA_SHARING_USAGE_URL,
        'logs_url': DATA_SHARING_LOGS_URL,
        'upload_only_official': True,
        'local_log_retention_days': local_log_retention_days,
        'log_retention_days': local_log_retention_days,
        'show_prompt': should_show_data_sharing_prompt(),
    }


def _get_app_version() -> str:
    try:
        import desktop_runtime

        return str(desktop_runtime.get_current_version() or '0.0.0')
    except Exception:
        return str(os.getenv('FUCKSEATS_APP_VERSION') or '0.0.0')


def _client_payload() -> dict[str, Any]:
    payload = {
        'install_id': get_or_create_install_id(),
        'app_version': _get_app_version(),
        'platform': sys.platform,
        'source': 'local-django',
        'metadata': {
            'app_shell': str(getattr(settings, 'APP_SHELL', 'browser') or 'browser'),
            'python': f'{sys.version_info.major}.{sys.version_info.minor}',
            'system': platform.system().lower(),
            'local_log_retention_days': get_data_sharing_log_retention_days(),
        },
    }
    uid = get_data_sharing_user_uid()
    if uid:
        payload['uid'] = uid
    return payload


def _ssl_context():
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        try:
            return ssl.create_default_context()
        except Exception:
            return ssl._create_unverified_context()


def _post_json(url: str, payload: dict[str, Any], timeout: int = 4) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(
        url,
        data=data,
        method='POST',
        headers={
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': f'FuckSeatsDataSharing/{_get_app_version()}',
        },
    )
    with urllib.request.urlopen(request, timeout=timeout, context=_ssl_context()) as response:
        response.read()


def _worker_loop() -> None:
    while True:
        kind, item = _QUEUE.get()
        batch = [item]
        while len(batch) < 50:
            try:
                next_kind, next_item = _QUEUE.get_nowait()
            except queue.Empty:
                break
            if next_kind == kind:
                batch.append(next_item)
            else:
                try:
                    _QUEUE.put_nowait((next_kind, next_item))
                except queue.Full:
                    pass
                break
        try:
            payload = {'client': _client_payload()}
            if kind == 'log':
                payload['logs'] = batch
                _post_json(DATA_SHARING_LOGS_URL, payload)
            else:
                payload['events'] = batch
                _post_json(DATA_SHARING_USAGE_URL, payload)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            pass
        except Exception:
            pass


def _ensure_worker() -> None:
    global _WORKER_STARTED
    if _WORKER_STARTED:
        return
    with _WORKER_LOCK:
        if _WORKER_STARTED:
            return
        thread = threading.Thread(target=_worker_loop, name='fuckseats-data-sharing', daemon=True)
        thread.start()
        _WORKER_STARTED = True


def _enqueue(kind: str, item: dict[str, Any]) -> None:
    if not get_data_sharing_enabled():
        return
    _ensure_worker()
    try:
        _QUEUE.put_nowait((kind, item))
    except queue.Full:
        pass


def share_usage_event(
    feature: str,
    action: str,
    *,
    success: bool = True,
    duration_ms: int = 0,
    count: int = 1,
    metadata: dict[str, Any] | None = None,
) -> None:
    _enqueue(
        'usage',
        {
            'feature': str(feature or 'unknown')[:80],
            'action': str(action or 'use')[:80],
            'success': bool(success),
            'duration_ms': max(0, int(duration_ms or 0)),
            'count': max(1, int(count or 1)),
            'occurred_at': time.time(),
            'metadata': metadata or {},
        },
    )


def share_log(
    level: str,
    source: str,
    code: str,
    *,
    message: str = '',
    context: dict[str, Any] | None = None,
) -> None:
    _enqueue(
        'log',
        {
            'level': str(level or 'INFO').upper()[:16],
            'source': str(source or 'client')[:80],
            'code': str(code or '')[:80],
            'message': str(message or '')[:240],
            'occurred_at': time.time(),
            'context': context or {},
        },
    )


def _feature_for_url_name(url_name: str) -> str:
    name = str(url_name or '')
    if not name:
        return ''
    if name.startswith('cloud_'):
        return 'cloud'
    if 'plugin' in name or 'extension' in name:
        return 'plugin'
    if 'ai_' in name or name.startswith('ai'):
        return 'ai'
    if 'arrange' in name or 'seat' in name or 'layout' in name:
        return 'seat_layout'
    if 'student' in name or 'tag' in name:
        return 'student'
    if 'group' in name:
        return 'group'
    if 'constraint' in name or 'suggestion' in name:
        return 'constraint'
    if 'import' in name:
        return 'import'
    if 'export' in name:
        return 'export'
    if 'update' in name:
        return 'update'
    if 'settings' in name:
        return 'settings'
    if 'classroom' in name or name in {'index', 'create_classroom'}:
        return 'classroom'
    return 'other'


class DataSharingUsageMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started_at = time.monotonic()
        response = self.get_response(request)
        try:
            url_name = getattr(getattr(request, 'resolver_match', None), 'url_name', '') or ''
            feature = _feature_for_url_name(url_name)
            if feature:
                duration_ms = int((time.monotonic() - started_at) * 1000)
                status_code = int(getattr(response, 'status_code', 200) or 200)
                share_usage_event(
                    feature,
                    url_name,
                    success=status_code < 500,
                    duration_ms=duration_ms,
                    metadata={
                        'method': str(getattr(request, 'method', '') or ''),
                        'status_bucket': f'{status_code // 100}xx',
                    },
                )
        except Exception:
            pass
        return response
