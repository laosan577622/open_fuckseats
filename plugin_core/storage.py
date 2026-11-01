from __future__ import annotations

import base64
import hashlib
import json
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable


MISSING = object()


class MemoryStorageBackend:
    def __init__(self):
        self._lock = threading.RLock()
        self._rows: dict[tuple[str, str, str], Any] = {}

    def get(self, plugin_id: str, namespace: str, key: str, default=None, *, secret=False):
        with self._lock:
            return self._rows.get((plugin_id, namespace, key), default)

    def set(self, plugin_id: str, namespace: str, key: str, value, *, secret=False):
        with self._lock:
            self._rows[(plugin_id, namespace, key)] = value
        return value

    def delete(self, plugin_id: str, namespace: str, key: str):
        with self._lock:
            return self._rows.pop((plugin_id, namespace, key), MISSING) is not MISSING

    def keys(self, plugin_id: str, namespace: str):
        with self._lock:
            return sorted(key for pid, ns, key in self._rows if pid == plugin_id and ns == namespace)

    def clear(self, plugin_id: str, namespace: str | None = None):
        with self._lock:
            targets = [
                row for row in self._rows
                if row[0] == plugin_id and (namespace is None or row[1] == namespace)
            ]
            for row in targets:
                self._rows.pop(row, None)
        return len(targets)


class DjangoModelStorageBackend(MemoryStorageBackend):
    """以延迟 Model getter 复用本地/云端 ORM；迁移前自动退回进程内存。"""

    def __init__(self, model_getter: Callable[[], Any], secret_key_getter: Callable[[], str], *, fallback_secret_keys=()):
        super().__init__()
        self._model_getter = model_getter
        self._secret_key_getter = secret_key_getter
        self._fallback_secret_keys = tuple(str(key) for key in fallback_secret_keys if key)

    def _fernet(self, secret_key=None):
        from cryptography.fernet import Fernet

        raw_key = str((self._secret_key_getter() if secret_key is None else secret_key) or 'fuckseats-plugin-storage').encode('utf-8')
        key = base64.urlsafe_b64encode(hashlib.sha256(raw_key).digest())
        return Fernet(key)

    def _encode(self, value, secret=False):
        serialized = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
        if not secret:
            return serialized
        return 'enc:v1:' + self._fernet().encrypt(serialized.encode('utf-8')).decode('ascii')

    def _decode(self, value, secret=False):
        text = str(value or '')
        if text.startswith('enc:v1:'):
            text = self._fernet().decrypt(text[7:].encode('ascii')).decode('utf-8')
        elif secret:
            return None
        return json.loads(text)

    def get(self, plugin_id: str, namespace: str, key: str, default=None, *, secret=False):
        try:
            model = self._model_getter()
            row = model.objects.filter(plugin_id=plugin_id, namespace=namespace, key=key).only('value').first()
            if row is None:
                return super().get(plugin_id, namespace, key, default, secret=secret)
            from cryptography.fernet import InvalidToken

            rotate = False
            try:
                value = self._decode(row.value, secret=secret)
            except InvalidToken:
                for fallback_key in self._fallback_secret_keys:
                    try:
                        value = json.loads(self._fernet(fallback_key).decrypt(str(row.value)[7:].encode('ascii')))
                    except InvalidToken:
                        continue
                    rotate = True
                    break
                else:
                    raise
            super().set(plugin_id, namespace, key, value, secret=secret)
            if rotate:
                model.objects.filter(pk=row.pk, value=row.value).update(value=self._encode(value, secret=True))
            return value
        except Exception:
            return super().get(plugin_id, namespace, key, default, secret=secret)

    def set(self, plugin_id: str, namespace: str, key: str, value, *, secret=False):
        super().set(plugin_id, namespace, key, value, secret=secret)
        try:
            model = self._model_getter()
            model.objects.update_or_create(
                plugin_id=plugin_id,
                namespace=namespace,
                key=key,
                defaults={'value': self._encode(value, secret=secret), 'is_secret': bool(secret)},
            )
        except Exception:
            pass
        return value

    def delete(self, plugin_id: str, namespace: str, key: str):
        removed = super().delete(plugin_id, namespace, key)
        try:
            model = self._model_getter()
            count, _ = model.objects.filter(plugin_id=plugin_id, namespace=namespace, key=key).delete()
            removed = bool(count) or removed
        except Exception:
            pass
        return removed

    def keys(self, plugin_id: str, namespace: str):
        memory_keys = set(super().keys(plugin_id, namespace))
        try:
            model = self._model_getter()
            memory_keys.update(model.objects.filter(plugin_id=plugin_id, namespace=namespace).values_list('key', flat=True))
        except Exception:
            pass
        return sorted(memory_keys)

    def clear(self, plugin_id: str, namespace: str | None = None):
        count = super().clear(plugin_id, namespace)
        try:
            model = self._model_getter()
            queryset = model.objects.filter(plugin_id=plugin_id)
            if namespace is not None:
                queryset = queryset.filter(namespace=namespace)
            db_count, _ = queryset.delete()
            count = max(count, db_count)
        except Exception:
            pass
        return count


class PluginStore:
    def __init__(self, backend, plugin_id: str, namespace: str, *, secret=False):
        self.backend = backend
        self.plugin_id = str(plugin_id)
        self.namespace = str(namespace)
        self.secret = bool(secret)

    def _key(self, key):
        value = str(key or '').strip()
        if not value:
            raise ValueError('存储 key 不能为空')
        if len(value) > 160:
            raise ValueError('存储 key 不能超过 160 个字符')
        return value

    def get(self, key, default=None):
        return self.backend.get(self.plugin_id, self.namespace, self._key(key), default, secret=self.secret)

    def set(self, key, value):
        json.dumps(value, ensure_ascii=False)
        return self.backend.set(self.plugin_id, self.namespace, self._key(key), value, secret=self.secret)

    def delete(self, key):
        return self.backend.delete(self.plugin_id, self.namespace, self._key(key))

    def keys(self):
        return self.backend.keys(self.plugin_id, self.namespace)

    def clear(self):
        return self.backend.clear(self.plugin_id, self.namespace)


class PluginCache:
    def __init__(self, plugin_id: str):
        self.plugin_id = plugin_id
        self._lock = threading.RLock()
        self._rows: dict[str, tuple[float | None, Any]] = {}

    def get(self, key, default=None):
        name = str(key or '').strip()
        with self._lock:
            row = self._rows.get(name)
            if row is None:
                return default
            expires_at, value = row
            if expires_at is not None and expires_at <= time.monotonic():
                self._rows.pop(name, None)
                return default
            return value

    def set(self, key, value, ttl=None):
        name = str(key or '').strip()
        if not name:
            raise ValueError('缓存 key 不能为空')
        expires_at = None if ttl in (None, 0) else time.monotonic() + max(0.0, float(ttl))
        with self._lock:
            self._rows[name] = (expires_at, value)
        return value

    def delete(self, key):
        with self._lock:
            return self._rows.pop(str(key or '').strip(), None) is not None

    def clear(self):
        with self._lock:
            count = len(self._rows)
            self._rows.clear()
        return count


@dataclass
class PluginStorageBundle:
    storage: PluginStore
    settings: PluginStore
    secrets: PluginStore
    cache: PluginCache

    @classmethod
    def create(cls, backend, plugin_id: str, cache: PluginCache | None = None):
        return cls(
            storage=PluginStore(backend, plugin_id, 'storage'),
            settings=PluginStore(backend, plugin_id, 'settings'),
            secrets=PluginStore(backend, plugin_id, 'secrets', secret=True),
            cache=cache or PluginCache(plugin_id),
        )
