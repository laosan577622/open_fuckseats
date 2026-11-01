"""在实例私有目录中保存 Django 签名密钥。"""

import os
import re
import secrets
import stat
import tempfile
from pathlib import Path

from app_paths import locks_directory, state_directory
from database_security import FileLock


def get_instance_secret():
    path = state_directory() / 'instance-secret'
    lock = FileLock(locks_directory() / 'instance-secret.lock').acquire(blocking=True)
    try:
        return _read_or_create_secret(path)
    finally:
        lock.release()


def _read_or_create_secret(path):
    try:
        if path.is_symlink():
            raise RuntimeError('实例密钥不能是符号链接')
        descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    except FileNotFoundError:
        value = secrets.token_urlsafe(48)
        descriptor, temporary = tempfile.mkstemp(prefix='.instance-secret-', dir=path.parent)
        try:
            with os.fdopen(descriptor, 'w', encoding='ascii') as output:
                output.write(value + '\n')
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return value

    with os.fdopen(descriptor, 'r', encoding='ascii') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise RuntimeError('实例密钥必须是普通文件')
        if os.name != 'nt':
            os.fchmod(source.fileno(), 0o600)
        value = source.read(256).strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{64}', value):
        raise RuntimeError('实例密钥已损坏，请恢复应用数据备份')
    return value
