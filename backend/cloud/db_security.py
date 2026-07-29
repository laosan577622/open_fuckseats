"""SQLCipher bootstrap helpers for the standalone cloud service databases."""

from __future__ import annotations

import hashlib
import os
import sqlite3
import sys
from functools import wraps
from pathlib import Path


SQLITE_HEADER = b"SQLite format 3\x00"


def _locked_migration(function):
    @wraps(function)
    def wrapped(path, key):
        resolved = Path(path).resolve()
        resolved.parent.mkdir(parents=True, exist_ok=True)
        lock_path = resolved.with_name(f"{resolved.name}.encryption.lock")
        handle = lock_path.open("a+b")
        acquired = False
        try:
            if sys.platform.startswith("win"):
                import msvcrt

                if lock_path.stat().st_size == 0:
                    handle.write(b"0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            acquired = True
            return function(resolved, key)
        finally:
            try:
                if acquired and sys.platform.startswith("win"):
                    import msvcrt

                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                elif acquired:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            finally:
                handle.close()

    return wrapped


def _truthy(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def normalize_key(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    if len(raw) == 64:
        try:
            decoded = bytes.fromhex(raw)
            if len(decoded) == 32:
                return decoded
        except ValueError:
            pass
    return hashlib.sha256(raw.encode("utf-8")).digest()


def key_pragma(key):
    if not key or len(key) != 32:
        raise RuntimeError("SQLCipher 服务端数据库密钥无效")
    return f'PRAGMA key = "x\'{key.hex()}\'"'


def is_plaintext_database(path):
    path = Path(path)
    if not path.exists() or path.stat().st_size <= 0:
        return False
    with path.open("rb") as source:
        return source.read(len(SQLITE_HEADER)) == SQLITE_HEADER


def _verify_plaintext(path):
    connection = sqlite3.connect(str(path))
    try:
        result = connection.execute("PRAGMA integrity_check").fetchone()
        if not result or str(result[0]).lower() != "ok":
            raise RuntimeError(f"服务端明文数据库完整性检查失败：{result}")
    finally:
        connection.close()


def verify_encrypted(path, key):
    from sqlcipher3 import dbapi2 as sqlcipher

    connection = sqlcipher.connect(str(path))
    try:
        connection.execute(key_pragma(key))
        connection.execute("SELECT count(*) FROM sqlite_master").fetchone()
        result = connection.execute("PRAGMA integrity_check").fetchone()
        if not result or str(result[0]).lower() != "ok":
            raise RuntimeError(f"服务端加密数据库完整性检查失败：{result}")
    finally:
        connection.close()
    try:
        Path(path).chmod(0o600)
    except OSError:
        pass


@_locked_migration
def migrate_database(path, key):
    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    target = path.with_suffix(".encrypted-new")
    old = path.with_suffix(".plaintext-old")
    if not path.exists() and old.exists():
        os.replace(old, path)
    if path.exists() and old.exists():
        if is_plaintext_database(path):
            _verify_plaintext(path)
            old.unlink(missing_ok=True)
        else:
            try:
                verify_encrypted(path, key)
            except Exception:
                path.unlink(missing_ok=True)
                os.replace(old, path)
            else:
                old.unlink(missing_ok=True)
    if path.exists() and target.exists():
        target.unlink(missing_ok=True)
    if not path.exists() or path.stat().st_size <= 0:
        return
    if not is_plaintext_database(path):
        verify_encrypted(path, key)
        return

    _verify_plaintext(path)
    from sqlcipher3 import dbapi2 as sqlcipher

    target.unlink(missing_ok=True)
    old.unlink(missing_ok=True)
    connection = sqlcipher.connect(str(path))
    try:
        user_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        escaped = str(target).replace("'", "''")
        connection.execute(f"ATTACH DATABASE '{escaped}' AS encrypted KEY \"x'{key.hex()}'\"")
        connection.execute("SELECT sqlcipher_export('encrypted')")
        connection.execute(f"PRAGMA encrypted.user_version = {user_version}")
        connection.execute("DETACH DATABASE encrypted")
    finally:
        connection.close()
    verify_encrypted(target, key)
    os.replace(path, old)
    try:
        os.replace(target, path)
        verify_encrypted(path, key)
        old.unlink(missing_ok=True)
    except Exception:
        if old.exists():
            path.unlink(missing_ok=True)
            os.replace(old, path)
        raise


def prepare_cloud_databases():
    from cloud.config import BASE_DIR, get_config

    config = get_config()
    cloud_key = normalize_key(os.getenv("FUCKSEATS_CLOUD_DB_KEY"))
    improve_key = normalize_key(os.getenv("FUCKSEATS_IMPROVE_DB_KEY"))
    require = _truthy(os.getenv("FUCKSEATS_REQUIRE_SERVER_DB_ENCRYPTION"))
    if require and (not cloud_key or not improve_key):
        raise RuntimeError("已要求服务端数据库加密，但云数据库或改进数据密钥未配置")

    cloud_name = os.getenv("CLOUD_SQLITE_PATH") or config.get("database", {}).get("name") or BASE_DIR / "cloud.sqlite3"
    cloud_path = Path(cloud_name)
    if not cloud_path.is_absolute():
        cloud_path = BASE_DIR / cloud_path
    if cloud_key:
        migrate_database(cloud_path, cloud_key)

    improve_name = (
        os.getenv("FUCKSEATS_IMPROVE_DB_PATH")
        or config.get("data_sharing", {}).get("database")
        or "improve_data.sqlite3"
    )
    improve_path = Path(improve_name)
    if not improve_path.is_absolute():
        improve_path = BASE_DIR / improve_path
    if improve_key:
        migrate_database(improve_path, improve_key)
