"""Lightweight startup UI; do not import Django or pywebview here."""

from __future__ import annotations

import ctypes
import sys
import threading

from desktop_fonts import FONT_FAMILY, register_bundled_font


APP_TITLE = '不想排座位'


def _check_tk_version(tk):
    if sys.platform == 'darwin' and tk.TkVersion < 8.6:
        raise RuntimeError('当前 macOS 的 Tk 版本过旧，请使用包含 Tk 8.6 或更新版本的项目 Python')


def show_message(message, *, error=False):
    if sys.platform.startswith('win'):
        flags = (0x10 if error else 0x40) | 0x10000  # icon + foreground
        ctypes.windll.user32.MessageBoxW(None, str(message), APP_TITLE, flags)
        return
    root = None
    try:
        import tkinter as tk
        from tkinter import messagebox

        _check_tk_version(tk)
        root = tk.Tk()
        root.withdraw()
        dialog = messagebox.showerror if error else messagebox.showinfo
        dialog(APP_TITLE, str(message), parent=root)
    except Exception:
        print(str(message), file=sys.stderr if error else sys.stdout, flush=True)
    finally:
        if root is not None:
            root.destroy()


def prompt_read_access(client_name):
    """Windows native prompt defaults to rejecting a third-party request."""
    if not sys.platform.startswith('win'):
        return False
    message = (
        f'“{client_name}”申请读取不想排座位的数据。\n\n'
        '允许后，该程序可以读取所有班级、具体座位排列、班级名单，以及'
        '学号、成绩、自定义信息、小组、约束、标签、快照和历史记录。\n\n'
        '授权仅在本次应用运行期间有效；不允许修改或删除数据。\n\n'
        '是否允许读取？'
    )
    # MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2 | MB_SETFOREGROUND | MB_TOPMOST
    result = ctypes.windll.user32.MessageBoxW(None, message, '第三方读取授权', 0x50124)
    return result == 6  # IDYES; closing the dialog also rejects the request.


class StartupSplash:
    def __init__(self):
        self.root = None
        self._ui_thread = None
        self._shown = threading.Event()
        self._closing = threading.Event()

    def show(self):
        if sys.platform.startswith('win'):
            # Tk and WebView each own their GUI thread. Keep the splash visible
            # through WebView loading, and destroy it on the thread that made it.
            self._ui_thread = threading.Thread(
                target=self._windows_ui, name='fuckseats-startup-ui', daemon=True,
            )
            self._ui_thread.start()
            self._shown.wait(5)
            return
        self._create_window()

    def _windows_ui(self):
        try:
            self._create_window()
            self._shown.set()
            while self.root is not None and not self._closing.is_set():
                self.root.update()
                self._closing.wait(0.03)
        finally:
            self._shown.set()
            self._destroy_window()

    def _create_window(self):
        try:
            import tkinter as tk
            from tkinter import ttk

            _check_tk_version(tk)
            register_bundled_font()
            root = self.root = tk.Tk()
            root.withdraw()
            root.title(APP_TITLE)
            root.configure(background='#ffffff')
            root.resizable(False, False)
            root.protocol('WM_DELETE_WINDOW', lambda: None)
            width, height = 380, 156
            x = (root.winfo_screenwidth() - width) // 2
            y = (root.winfo_screenheight() - height) // 2
            root.geometry(f'{width}x{height}+{x}+{y}')
            tk.Label(
                root, text='启动中，请稍后…', font=(FONT_FAMILY, 15),
                foreground='#1d1d1f', background='#ffffff',
            ).pack(pady=(32, 22))
            style = ttk.Style(root)
            style.theme_use('clam')
            style.configure(
                'Startup.Horizontal.TProgressbar', background='#0a59f7',
                troughcolor='#f2f2f7', borderwidth=0, thickness=4,
            )
            progress = ttk.Progressbar(
                root, mode='indeterminate', length=280,
                style='Startup.Horizontal.TProgressbar',
            )
            progress.pack()
            progress.start(15)
            root.deiconify()
            root.update()
        except Exception as exc:
            self._destroy_window()
            print(f'无法显示 Tk 启动提示：{exc}', file=sys.stderr, flush=True)

    def run(self, initialize):
        """Keep Tk responsive while slow imports, migrations and server startup run."""
        if self._ui_thread is not None or self.root is None:
            return initialize()
        completed = threading.Event()
        result = {}

        def worker():
            try:
                result['value'] = initialize()
            except BaseException as exc:
                result['error'] = exc
            finally:
                completed.set()

        thread = threading.Thread(target=worker, name='fuckseats-startup', daemon=True)
        thread.start()
        try:
            while not completed.is_set():
                self.root.update()
                completed.wait(0.03)
            if 'error' in result:
                raise result['error']
            return result.get('value')
        finally:
            self.close()

    def close(self):
        if self._ui_thread is not None:
            self._closing.set()
            if threading.current_thread() is not self._ui_thread:
                self._ui_thread.join(timeout=2)
            return
        self._destroy_window()

    def _destroy_window(self):
        root, self.root = self.root, None
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass
