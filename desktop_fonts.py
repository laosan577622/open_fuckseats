"""Make the bundled Chinese font available before Tk enumerates fonts."""

from __future__ import annotations

import ctypes
import os
import sys

from app_paths import resource_root


FONT_FAMILY = 'HarmonyOS Sans SC'
FONT_FILENAME = 'HarmonyOS_SansSC_Regular.ttf'


def _register_windows_font(path):
    gdi = ctypes.WinDLL('gdi32', use_last_error=True)
    gdi.AddFontResourceExW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_void_p]
    gdi.AddFontResourceExW.restype = ctypes.c_int
    # FR_PRIVATE: available only to this process, including portable installs.
    return gdi.AddFontResourceExW(str(path), 0x10, None) > 0


def _register_macos_font(path):
    foundation = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    core_text = ctypes.CDLL('/System/Library/Frameworks/CoreText.framework/CoreText')
    foundation.CFURLCreateFromFileSystemRepresentation.argtypes = [
        ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_ubyte,
    ]
    foundation.CFURLCreateFromFileSystemRepresentation.restype = ctypes.c_void_p
    foundation.CFRelease.argtypes = [ctypes.c_void_p]
    foundation.CFRelease.restype = None
    foundation.CFErrorGetCode.argtypes = [ctypes.c_void_p]
    foundation.CFErrorGetCode.restype = ctypes.c_long
    core_text.CTFontManagerRegisterFontsForURL.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p),
    ]
    core_text.CTFontManagerRegisterFontsForURL.restype = ctypes.c_bool
    encoded_path = os.fsencode(path)
    url = foundation.CFURLCreateFromFileSystemRepresentation(
        None, encoded_path, len(encoded_path), False,
    )
    if not url:
        return False
    error = ctypes.c_void_p()
    try:
        # kCTFontManagerScopeProcess; do not install fonts into the user's system.
        registered = core_text.CTFontManagerRegisterFontsForURL(url, 1, ctypes.byref(error))
        return bool(registered or (error.value and foundation.CFErrorGetCode(error) == 105))
    finally:
        if error.value:
            foundation.CFRelease(error)
        foundation.CFRelease(url)


def register_bundled_font():
    """Register the runtime font; installed system fonts remain usable on failure."""
    path = resource_root() / 'fonts' / FONT_FILENAME
    try:
        if not path.is_file():
            raise FileNotFoundError(f'缺少鸿蒙黑体资源：{path}')
        if sys.platform.startswith('win'):
            registered = _register_windows_font(path)
        elif sys.platform == 'darwin':
            registered = _register_macos_font(path)
        else:
            return False
        if not registered:
            raise RuntimeError('系统未能加载应用自带的鸿蒙黑体')
        return True
    except Exception as exc:
        print(f'无法加载启动字体：{exc}', file=sys.stderr, flush=True)
        return False
