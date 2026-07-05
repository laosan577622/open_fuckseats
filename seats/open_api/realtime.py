import threading
import time

from .shared_state import load_json_state, save_json_state

_lock = threading.Lock()
_cond = threading.Condition(_lock)
STORE_KEY = 'fuckseats_realtime_state'
PERSISTENT_POLL_INTERVAL = 1.0


def _default_state():
    return {
        'global_seq': 0,
        'data_seq': 0,
        'classroom_seq': {},
        'last_classroom_id': None,
    }


_state = _default_state()


def _normalize_state(state):
    default = _default_state()
    if not isinstance(state, dict):
        return default
    normalized = {
        'global_seq': int(state.get('global_seq') or 0),
        'data_seq': int(state.get('data_seq') or 0),
        'classroom_seq': {},
        'last_classroom_id': None,
    }
    raw_classrooms = state.get('classroom_seq') or {}
    if isinstance(raw_classrooms, dict):
        for key, value in raw_classrooms.items():
            try:
                cid = int(key)
                normalized['classroom_seq'][cid] = int(value or 0)
            except (TypeError, ValueError):
                continue
    try:
        normalized['last_classroom_id'] = int(state.get('last_classroom_id'))
    except (TypeError, ValueError):
        normalized['last_classroom_id'] = None
    return normalized


def _load_persistent_state():
    return _normalize_state(load_json_state(STORE_KEY, _default_state))


def _dump_persistent_state(state):
    payload = {
        'global_seq': state['global_seq'],
        'data_seq': state['data_seq'],
        'classroom_seq': {str(key): value for key, value in state['classroom_seq'].items()},
        'last_classroom_id': state['last_classroom_id'],
    }
    save_json_state(STORE_KEY, payload)


def _merge_locked(persistent=None):
    persistent = _load_persistent_state() if persistent is None else _normalize_state(persistent)
    changed = False
    if persistent['global_seq'] > _state['global_seq']:
        _state['global_seq'] = persistent['global_seq']
        changed = True
    if persistent['data_seq'] > _state['data_seq']:
        _state['data_seq'] = persistent['data_seq']
        changed = True
    for cid, seq in persistent['classroom_seq'].items():
        if seq > _state['classroom_seq'].get(cid, 0):
            _state['classroom_seq'][cid] = seq
            changed = True
    if changed and persistent['last_classroom_id'] is not None:
        _state['last_classroom_id'] = persistent['last_classroom_id']
    return changed


def _snapshot_locked():
    return {
        'global_seq': _state['global_seq'],
        'data_seq': _state['data_seq'],
        'classroom_seq': dict(_state['classroom_seq']),
        'last_classroom_id': _state['last_classroom_id'],
    }


def bump(classroom_id=None, *, data=False):
    with _cond:
        _merge_locked()
        _state['global_seq'] += 1
        if data:
            _state['data_seq'] += 1
        if classroom_id is not None:
            try:
                cid = int(classroom_id)
            except (TypeError, ValueError):
                cid = None
            if cid is not None:
                _state['classroom_seq'][cid] = _state['classroom_seq'].get(cid, 0) + 1
                _state['last_classroom_id'] = cid
        snap = _snapshot_locked()
        _dump_persistent_state(snap)
        _cond.notify_all()
    return snap


def snapshot():
    with _cond:
        if _merge_locked():
            _cond.notify_all()
        return _snapshot_locked()


def wait_for_change(last_global_seq, timeout=25.0):
    deadline = time.monotonic() + max(0.0, float(timeout or 0.0))
    with _cond:
        if _merge_locked():
            _cond.notify_all()
        if last_global_seq is None or _state['global_seq'] != last_global_seq:
            return _snapshot_locked()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            _cond.wait(timeout=min(PERSISTENT_POLL_INTERVAL, remaining))
            if _merge_locked():
                _cond.notify_all()
            if _state['global_seq'] != last_global_seq:
                break
        return _snapshot_locked()
