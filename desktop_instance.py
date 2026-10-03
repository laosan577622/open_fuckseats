"""Windows process guard, including launches using different data directories."""

import ctypes
import sys
from ctypes import wintypes


class ExistingInstanceError(RuntimeError):
    pass


class DesktopInstanceGuard:
    def __init__(self):
        self._handle = None
        self._kernel32 = None

    def acquire(self):
        if not sys.platform.startswith('win'):
            return self
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel32.CreateMutexW.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
        kernel32.CreateMutexW.restype = wintypes.HANDLE
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        kernel32.CloseHandle.restype = wintypes.BOOL
        self._kernel32 = kernel32
        ctypes.set_last_error(0)
        handle = kernel32.CreateMutexW(None, False, 'Local\\xyz.577622.fuckseats.instance')
        error = ctypes.get_last_error()
        if handle and error == 183:  # ERROR_ALREADY_EXISTS
            kernel32.CloseHandle(handle)
            raise ExistingInstanceError('已有实例，请使用已打开的不想排座位。')
        if not handle:
            if error == 5:  # Elevated instance owns the mutex: ERROR_ACCESS_DENIED.
                raise ExistingInstanceError('已有实例，请使用已打开的不想排座位。')
            raise OSError(error, '无法创建应用实例锁')
        self._handle = handle
        return self

    def release(self):
        handle, self._handle = self._handle, None
        if handle is not None:
            self._kernel32.CloseHandle(handle)
