import threading
import time

from . import realtime
from .shared_state import load_json_state, save_json_state

_lock = threading.Lock()
STORE_KEY = 'fuckseats_ai_session_state'


def _default_state():
    return {
        'active': False,
        'task_id': None,
        'message': '',
        'progress': None,
        'started_at': None,
        'updated_at': 0.0,
        'seq': 0,
    }


_state = _default_state()


def _normalize_state(state):
    default = _default_state()
    if not isinstance(state, dict):
        return default
    return {
        'active': bool(state.get('active')),
        'task_id': str(state['task_id']) if state.get('task_id') is not None else None,
        'message': str(state.get('message') or ''),
        'progress': state.get('progress') if isinstance(state.get('progress'), (int, float)) else None,
        'started_at': state.get('started_at') if isinstance(state.get('started_at'), (int, float)) else None,
        'updated_at': float(state.get('updated_at') or 0.0),
        'seq': int(state.get('seq') or 0),
    }


def _load_persistent_state():
    return _normalize_state(load_json_state(STORE_KEY, _default_state))


def _save_locked():
    save_json_state(STORE_KEY, _snapshot_locked())


def _merge_locked():
    persistent = _load_persistent_state()
    if persistent['seq'] > int(_state.get('seq') or 0):
        _state.update(persistent)
        return True
    return False


def _snapshot_locked():
    return {
        'active': _state['active'],
        'task_id': _state['task_id'],
        'message': _state['message'],
        'progress': _state['progress'],
        'started_at': _state['started_at'],
        'updated_at': _state['updated_at'],
        'seq': _state['seq'],
    }


def begin(*, task_id=None, message=''):
    with _lock:
        _merge_locked()
        _state['active'] = True
        _state['task_id'] = str(task_id) if task_id is not None else None
        _state['message'] = str(message or '')
        _state['progress'] = None
        _state['started_at'] = time.time()
        _state['updated_at'] = _state['started_at']
        _state['seq'] += 1
        snap = _snapshot_locked()
        _save_locked()
    realtime.bump()
    return snap


def update(*, task_id=None, message=None, progress=None):
    with _lock:
        _merge_locked()
        if not _state['active']:
            return _snapshot_locked()
        if task_id is not None and _state['task_id'] is not None and str(task_id) != _state['task_id']:
            return _snapshot_locked()
        if message is not None:
            _state['message'] = str(message)
        if progress is not None:
            _state['progress'] = progress
        _state['updated_at'] = time.time()
        _state['seq'] += 1
        snap = _snapshot_locked()
        _save_locked()
    realtime.bump()
    return snap


def end(*, task_id=None):
    with _lock:
        _merge_locked()
        if task_id is not None and _state['task_id'] is not None and str(task_id) != _state['task_id']:
            return _snapshot_locked()
        _state['active'] = False
        _state['task_id'] = None
        _state['message'] = ''
        _state['progress'] = None
        _state['started_at'] = None
        _state['updated_at'] = time.time()
        _state['seq'] += 1
        snap = _snapshot_locked()
        _save_locked()
    realtime.bump()
    return snap


def status():
    with _lock:
        _merge_locked()
        return _snapshot_locked()
