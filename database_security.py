"""Database key management, plaintext migration, locking, and update backups."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import shutil
import sqlite3
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from app_paths import (
    APP_BUNDLE_ID,
    backups_directory,
    database_path,
    legacy_database_candidates,
    locks_directory,
    state_directory,
)


SQLITE_HEADER = b"SQLite format 3\x00"
KEYRING_SERVICE = f"{APP_BUNDLE_ID}.database"
KEYRING_ACCOUNT = "desktop-main-v1"
BOOTSTRAP_SCHEMA = 1
_DATABASE_KEY_CACHE: bytes | None = None
_DATABASE_KEY_LOCK = threading.Lock()


class DatabaseSecurityError(RuntimeError):
    pass


def _is_truthy(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _is_test_process() -> bool:
    executable = Path(str(sys.argv[0] or "")).stem.lower()
    return (
        executable in {"pytest", "py.test"}
        or "PYTEST_CURRENT_TEST" in os.environ
        or any(str(arg).strip().lower() in {"test", "pytest"} for arg in sys.argv[1:])
    )


def database_encryption_enabled() -> bool:
    if _is_truthy(os.getenv("FUCKSEATS_DISABLE_DATABASE_ENCRYPTION")):
        if getattr(sys, "frozen", False):
            raise DatabaseSecurityError("正式桌面版本不允许关闭数据库加密")
        return False
    return not _is_test_process()


def _decode_configured_key(value: str) -> bytes:
    raw = str(value or "").strip()
    if not raw:
        raise DatabaseSecurityError("数据库密钥为空")
    if len(raw) == 64:
        try:
            decoded = bytes.fromhex(raw)
            if len(decoded) == 32:
                return decoded
        except ValueError:
            pass
    try:
        decoded = base64.b64decode(raw.encode("ascii"), validate=True)
        if len(decoded) == 32:
            return decoded
    except Exception:
        pass
    # Environment values may be human-provided during source development.
    return hashlib.sha256(raw.encode("utf-8")).digest()


def get_database_key(*, create: bool = True) -> bytes:
    global _DATABASE_KEY_CACHE
    configured = str(os.getenv("FUCKSEATS_DATABASE_KEY") or "").strip()
    if configured:
        return _decode_configured_key(configured)

    if _is_test_process():
        return hashlib.sha256(b"fuckseats-test-database-key").digest()

    try:
        import keyring
    except ImportError as exc:
        raise DatabaseSecurityError("缺少 keyring，无法安全读取数据库密钥") from exc

    with _DATABASE_KEY_LOCK:
        if _DATABASE_KEY_CACHE is not None:
            return _DATABASE_KEY_CACHE
        try:
            stored = keyring.get_password(KEYRING_SERVICE, KEYRING_ACCOUNT)
        except Exception as exc:
            raise DatabaseSecurityError(f"无法访问系统钥匙串：{exc}") from exc
        if stored:
            _DATABASE_KEY_CACHE = _decode_configured_key(stored)
            return _DATABASE_KEY_CACHE
        if not create:
            raise DatabaseSecurityError("系统钥匙串中不存在数据库密钥")

        key = secrets.token_bytes(32)
        encoded = base64.b64encode(key).decode("ascii")
        try:
            keyring.set_password(KEYRING_SERVICE, KEYRING_ACCOUNT, encoded)
            confirmed = keyring.get_password(KEYRING_SERVICE, KEYRING_ACCOUNT)
        except Exception as exc:
            raise DatabaseSecurityError(f"无法将数据库密钥保存到系统钥匙串：{exc}") from exc
        if confirmed != encoded:
            raise DatabaseSecurityError("数据库密钥写入系统钥匙串后校验失败")
        _DATABASE_KEY_CACHE = key
        return key


def sqlcipher_key_pragma(key: bytes) -> str:
    if not isinstance(key, bytes) or len(key) != 32:
        raise DatabaseSecurityError("SQLCipher 数据库密钥必须为 256 位")
    return f'PRAGMA key = "x\'{key.hex()}\'"'


def _load_sqlcipher():
    try:
        from sqlcipher3 import dbapi2 as sqlcipher
    except ImportError as exc:
        raise DatabaseSecurityError("缺少 sqlcipher3，无法启用数据库加密") from exc
    return sqlcipher


class FileLock:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._handle = None

    def acquire(self, *, blocking: bool = False):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+b")
        try:
            if sys.platform.startswith("win"):
                import msvcrt

                handle.seek(0)
                if handle.tell() == 0:
                    handle.write(b"0")
                    handle.flush()
                handle.seek(0)
                mode = msvcrt.LK_LOCK if blocking else msvcrt.LK_NBLCK
                msvcrt.locking(handle.fileno(), mode, 1)
            else:
                import fcntl

                flags = fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB)
                fcntl.flock(handle.fileno(), flags)
        except (OSError, BlockingIOError) as exc:
            handle.close()
            raise DatabaseSecurityError("已有一个不想排座位实例正在运行或执行数据升级") from exc
        handle.seek(0)
        handle.truncate()
        handle.write(json.dumps({"pid": os.getpid(), "time": time.time()}).encode("utf-8"))
        handle.flush()
        self._handle = handle
        return self

    def release(self):
        handle = self._handle
        self._handle = None
        if handle is None:
            return
        try:
            if sys.platform.startswith("win"):
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()

    def __enter__(self):
        return self.acquire()

    def __exit__(self, exc_type, exc, tb):
        self.release()


def application_lock() -> FileLock:
    return FileLock(locks_directory() / "application.lock")


@contextmanager
def bootstrap_lock():
    lock = FileLock(locks_directory() / "database-bootstrap.lock").acquire(blocking=True)
    try:
        yield lock
    finally:
        lock.release()


def _state_path() -> Path:
    return state_directory() / "database-bootstrap.json"


def _write_state(state: str, **details):
    payload = {
        "schema": BOOTSTRAP_SCHEMA,
        "state": state,
        "updated_at": time.time(),
        **details,
    }
    target = _state_path()
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, target)


def _is_plaintext_sqlite(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(len(SQLITE_HEADER)) == SQLITE_HEADER
    except OSError:
        return False


def _quote_sqlite_path(path: Path) -> str:
    return str(path).replace("'", "''")


def _verify_plaintext_database(path: Path):
    connection = sqlite3.connect(str(path))
    try:
        result = connection.execute("PRAGMA integrity_check").fetchone()
        if not result or str(result[0]).lower() != "ok":
            raise DatabaseSecurityError(f"旧数据库完整性检查失败：{result}")
    finally:
        connection.close()


def _verify_encrypted_database(path: Path, key: bytes):
    sqlcipher = _load_sqlcipher()
    connection = sqlcipher.connect(str(path))
    try:
        connection.execute(sqlcipher_key_pragma(key))
        connection.execute("SELECT count(*) FROM sqlite_master").fetchone()
        result = connection.execute("PRAGMA integrity_check").fetchone()
        if not result or str(result[0]).lower() != "ok":
            raise DatabaseSecurityError(f"加密数据库完整性检查失败：{result}")
        cipher_errors = list(connection.execute("PRAGMA cipher_integrity_check"))
        if cipher_errors:
            raise DatabaseSecurityError(f"加密页校验失败：{cipher_errors[0][0]}")
    except DatabaseSecurityError:
        raise
    except Exception as exc:
        raise DatabaseSecurityError("数据库密钥错误或加密数据库已损坏") from exc
    finally:
        connection.close()


def _copy_plaintext_database(source: Path, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    source_connection = sqlite3.connect(str(source))
    target_connection = sqlite3.connect(str(target))
    try:
        source_connection.backup(target_connection)
        target_connection.commit()
    finally:
        target_connection.close()
        source_connection.close()


def relocate_legacy_database(target: Path) -> Path | None:
    if target.exists() and target.stat().st_size > 0:
        return None
    for candidate in legacy_database_candidates():
        if not candidate.is_file() or candidate.stat().st_size <= 0:
            continue
        _write_state("relocating", source=str(candidate), target=str(target))
        if _is_plaintext_sqlite(candidate):
            temporary = target.with_suffix(".relocating")
            temporary.unlink(missing_ok=True)
            _copy_plaintext_database(candidate, temporary)
            _verify_plaintext_database(temporary)
            os.replace(temporary, target)
        else:
            shutil.copy2(candidate, target)
        return candidate
    return None


def _encrypt_plaintext_database(path: Path, key: bytes):
    _verify_plaintext_database(path)
    sqlcipher = _load_sqlcipher()
    encrypted = path.with_suffix(".encrypted-new")
    quarantine = path.with_suffix(".plaintext-old")
    encrypted.unlink(missing_ok=True)
    quarantine.unlink(missing_ok=True)

    source = sqlcipher.connect(str(path))
    try:
        user_version = int(source.execute("PRAGMA user_version").fetchone()[0])
        encrypted_sql_path = _quote_sqlite_path(encrypted)
        source.execute(
            f"ATTACH DATABASE '{encrypted_sql_path}' AS encrypted KEY \"x'{key.hex()}'\""
        )
        source.execute("SELECT sqlcipher_export('encrypted')")
        source.execute(f"PRAGMA encrypted.user_version = {user_version}")
        source.execute("DETACH DATABASE encrypted")
    finally:
        source.close()

    _verify_encrypted_database(encrypted, key)
    _write_state("committing", database=str(path))
    os.replace(path, quarantine)
    try:
        os.replace(encrypted, path)
        _verify_encrypted_database(path, key)
        encrypted_backup = backups_directory() / f"db-before-encryption-{int(time.time())}.sqlite3"
        shutil.copy2(path, encrypted_backup)
        quarantine.unlink(missing_ok=True)
    except Exception:
        if quarantine.exists():
            path.unlink(missing_ok=True)
            os.replace(quarantine, path)
        raise


def _recover_interrupted_commit(path: Path):
    quarantine = path.with_suffix(".plaintext-old")
    encrypted = path.with_suffix(".encrypted-new")
    if not path.exists() and quarantine.exists():
        os.replace(quarantine, path)
    if path.exists() and encrypted.exists():
        encrypted.unlink(missing_ok=True)


def _finish_interrupted_commit(path: Path, key: bytes):
    quarantine = path.with_suffix(".plaintext-old")
    if not quarantine.exists() or not path.exists():
        return
    if _is_plaintext_sqlite(path):
        _verify_plaintext_database(path)
        quarantine.unlink(missing_ok=True)
        return
    try:
        _verify_encrypted_database(path, key)
    except DatabaseSecurityError:
        path.unlink(missing_ok=True)
        os.replace(quarantine, path)
        return
    quarantine.unlink(missing_ok=True)


def _harden_database_permissions(path: Path):
    if not path.exists():
        return
    try:
        path.chmod(0o600)
    except OSError:
        pass


def prepare_desktop_database() -> Path:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not database_encryption_enabled():
        relocate_legacy_database(path)
        return path

    with bootstrap_lock():
        _recover_interrupted_commit(path)
        source = relocate_legacy_database(path)
        has_database = path.exists() and path.stat().st_size > 0
        create_key = not has_database or _is_plaintext_sqlite(path)
        key = get_database_key(create=create_key)
        _finish_interrupted_commit(path, key)
        if path.exists() and path.stat().st_size > 0:
            if _is_plaintext_sqlite(path):
                _write_state("encrypting", database=str(path), legacy_source=str(source or ""))
                _encrypt_plaintext_database(path, key)
            else:
                _write_state("verifying", database=str(path))
                _verify_encrypted_database(path, key)
        _harden_database_permissions(path)
        _write_state("ready", database=str(path), encrypted=True)
    return path


def backup_database_for_update(target_version: str) -> Path | None:
    path = database_path()
    if not path.exists() or path.stat().st_size <= 0:
        return None
    try:
        from django.db import connections

        connections.close_all()
    except Exception:
        pass
    key = get_database_key(create=False) if database_encryption_enabled() else None
    if key:
        _verify_encrypted_database(path, key)
    elif _is_plaintext_sqlite(path):
        _verify_plaintext_database(path)

    safe_version = "".join(ch for ch in str(target_version or "unknown") if ch.isalnum() or ch in ".-_")
    backup = backups_directory() / f"db-before-update-{safe_version or 'unknown'}-{int(time.time())}.sqlite3"
    if key:
        sqlcipher = _load_sqlcipher()
        source = sqlcipher.connect(str(path))
        destination = sqlcipher.connect(str(backup))
        try:
            source.execute(sqlcipher_key_pragma(key))
            source.execute("SELECT count(*) FROM sqlite_master").fetchone()
            destination.execute(sqlcipher_key_pragma(key))
            source.backup(destination)
        finally:
            destination.close()
            source.close()
        _verify_encrypted_database(backup, key)
    else:
        source = sqlite3.connect(str(path))
        destination = sqlite3.connect(str(backup))
        try:
            source.backup(destination)
        finally:
            destination.close()
            source.close()
        _verify_plaintext_database(backup)
    _harden_database_permissions(backup)
    return backup
