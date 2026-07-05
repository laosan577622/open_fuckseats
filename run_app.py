import os
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
import logging
from io import StringIO
from django.core.management import call_command
from waitress import serve
from desktop_runtime import (
    is_process_elevated,
    is_windows,
    relaunch_self_as_admin,
)

HOST = '127.0.0.1'
PORT = 23948


def _filter_migration_noise(text):
    lines = (text or '').splitlines()
    filtered = []
    skip_next = False

    for line in lines:
        current = (line or '').strip()

        if skip_next:
            if "Run 'manage.py makemigrations' to make new migrations" in current:
                skip_next = False
                continue
            skip_next = False

        if "Your models in app(s):" in current and "have changes that are not yet reflected in a migration" in current:
            skip_next = True
            continue

        filtered.append(line)

    return '\n'.join(filtered).strip()


def _is_dev_mode(argv):
    return any(arg in {'-dev', '--dev'} for arg in argv[1:])


def _wait_for_server_ready(url, timeout=20):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                status = getattr(response, 'status', 200)
                if status < 500:
                    return
        except urllib.error.HTTPError as exc:
            last_error = exc
            if getattr(exc, 'code', 500) < 500:
                return
            try:
                with urllib.request.urlopen(url.rsplit('/', 1)[0] + '/static/favicon.svg', timeout=1) as response:
                    status = getattr(response, 'status', 200)
                    if status < 500:
                        return
            except Exception:
                pass
        except Exception as exc:
            last_error = exc
            time.sleep(0.15)
            continue
        time.sleep(0.05)
    raise RuntimeError(f'本地服务启动超时: {last_error}')


def _start_waitress(application):
    serve(application, host=HOST, port=PORT, threads=32)


def _open_browser(url):
    try:
        webbrowser.open(url)
    except Exception:
        pass


def _configure_windows_webview(bridge):
    if not sys.platform.startswith('win'):
        return

    try:
        bridge._enable_windows_context_menu_bridge()
    except Exception as exc:
        print(f'Windows WebView 右键补丁加载失败: {exc}', file=sys.stderr, flush=True)


def _start_desktop_window(url):
    try:
        import webview
    except Exception as exc:
        raise RuntimeError(f'当前环境缺少 pywebview 依赖: {exc}') from exc

    from desktop_shell import DesktopBridge

    bridge = DesktopBridge(url)
    window = webview.create_window(
        '不想排座位',
        url,
        js_api=bridge,
        width=1440,
        height=920,
        min_size=(1180, 760),
        background_color='#FFFFFF',
        text_select=True,
    )
    bridge._attach_window(window)

    start_kwargs = {'debug': False}
    if sys.platform.startswith('win'):
        start_kwargs['gui'] = 'edgechromium'

    try:
        webview.start(_configure_windows_webview, bridge, **start_kwargs)
    except Exception as exc:
        if sys.platform.startswith('win'):
            raise RuntimeError(f'启动 WebView 失败，请确认系统已安装 WebView2 Runtime：{exc}') from exc
        raise RuntimeError(f'启动 WebView 失败：{exc}') from exc


def _ensure_windows_admin(entry_script, dev_mode):
    if not is_windows() or dev_mode:
        return False

    if is_process_elevated():
        return False

    print('检测到 Windows 桌面端尚未获得管理员权限，正在重新申请管理员权限...', flush=True)
    try:
        relaunch_self_as_admin(entry_script)
    except Exception as exc:
        print(f'管理员权限申请失败，本次启动已取消：{exc}', file=sys.stderr, flush=True)
    return True


def main():
    dev_mode = _is_dev_mode(sys.argv)
    if _ensure_windows_admin(__file__, dev_mode):
        return

    os.environ['FUCKSEATS_APP_SHELL'] = 'browser' if dev_mode else 'webview'
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    logging.getLogger('waitress').setLevel(logging.ERROR)
    
    import django
    django.setup()
    
    from config.wsgi import application

    openai_model = (os.getenv('OPENAI_MODEL') or 'gpt-4.1-mini').strip() or 'gpt-4.1-mini'
    openai_base_url = (os.getenv('OPENAI_BASE_URL') or '').strip()
    has_openai_key = bool((os.getenv('OPENAI_API_KEY') or '').strip())
    
    try:
        migrate_stdout = StringIO()
        migrate_stderr = StringIO()
        call_command(
            'migrate',
            interactive=False,
            stdout=migrate_stdout,
            stderr=migrate_stderr,
        )
        stdout_text = _filter_migration_noise(migrate_stdout.getvalue())
        stderr_text = _filter_migration_noise(migrate_stderr.getvalue())
    except Exception as e:
        print(f"数据库迁移出错: {e}", file=sys.stderr, flush=True)


    app_url = f'http://{HOST}:{PORT}'

    server_thread = threading.Thread(
        target=_start_waitress,
        args=(application,),
        daemon=True,
        name='fuckseats-waitress',
    )
    server_thread.start()
    _wait_for_server_ready(app_url)

    if dev_mode:
        print(f"客户端已启动：http://{HOST}:{PORT}", flush=True)
        _open_browser(app_url)
        try:
            while server_thread.is_alive():
                server_thread.join(timeout=1)
        except KeyboardInterrupt:
            print("\n开发模式已停止。", flush=True)
        return

    print(f"客户端已启动：http://{HOST}:{PORT}", flush=True)
    _start_desktop_window(app_url)

if __name__ == '__main__':
    main()
   
