import copy
import json

from django.db import DatabaseError, transaction


def _default_value(default):
    return copy.deepcopy(default() if callable(default) else default)


def _decode_value(value, default):
    if not value:
        return _default_value(default)
    data = json.loads(value)
    if not isinstance(data, dict):
        return _default_value(default)
    return data


def load_json_state(key, default):
    try:
        from seats.models import FrontendKVStore
        row = FrontendKVStore.objects.filter(key=key).only('value').first()
        return _decode_value(row.value if row else '', default)
    except (DatabaseError, json.JSONDecodeError, TypeError, ValueError):
        return _default_value(default)


def save_json_state(key, state):
    try:
        from seats.models import FrontendKVStore
        value = json.dumps(state, ensure_ascii=False, separators=(',', ':'))
        with transaction.atomic():
            FrontendKVStore.objects.update_or_create(key=key, defaults={'value': value})
        return True
    except (DatabaseError, TypeError, ValueError):
        return False
