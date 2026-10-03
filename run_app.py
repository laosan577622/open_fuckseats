import os
import sys
import threading
import time
import json
import urllib.error
import urllib.request
import webbrowser
import logging
import argparse
import errno
import socket
from io import StringIO
from runtime_bootstrap import ensure_runtime_dependencies
from desktop_access import ReadAccessRequest, forward_read_access_request, read_access_broker
from desktop_instance import DesktopInstanceGuard, ExistingInstanceError
from startup_dialogs import StartupSplash, prompt_read_access, show_message

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


def _parse_startup_options(argv):
    class StartupArgumentParser(argparse.ArgumentParser):
        def error(self, message):
            raise ValueError('启动参数错误，请使用 --help 查看参数说明')

    parser = StartupArgumentParser(description='不想排座位桌面启动器')
    parser.add_argument('-dev', '--dev', action='store_true', help='使用浏览器开发模式')
    parser.add_argument('--request-read-access', action='store_true', help='申请本次运行期间的只读授权（Windows）')
    parser.add_argument('--client-name', help='申请读取的第三方程序名称')
    parser.add_argument('--access-token', help='第三方自行生成的 fks-read- 随机只读凭证')
    options = parser.parse_args(argv[1:])
    options.read_access_request = None
    if options.request_read_access:
        if not sys.platform.startswith('win'):
            raise ValueError('第三方启动授权参数目前仅支持 Windows')
        options.read_access_request = ReadAccessRequest(options.client_name, options.access_token)
    elif options.client_name is not None or options.access_token is not None:
        raise ValueError('--client-name 和 --access-token 必须与 --request-read-access 一起使用')
    return options


def _check_service_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        if not sys.platform.startswith('win'):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((HOST, PORT))
        except OSError as exc:
            if exc.errno in {errno.EADDRINUSE, 10048}:
                raise ExistingInstanceError(
                    f'本地端口 {PORT} 已被占用。如果已打开不想排座位，请使用已有实例。'
                ) from exc
            raise


def _handle_existing_instance(request=None, message='已有实例，请使用已打开的不想排座位。'):
    if request is not None:
        try:
            forward_read_access_request(f'http://{HOST}:{PORT}', request)
            message += '\n\n第三方读取授权申请已交给已有实例处理。'
        except Exception as exc:
            show_message(f'{message}\n\n{exc}', error=True)
            return 1
    show_message(message)
    return 0


def _wait_for_server_ready(url, timeout=60, server_thread=None):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        if server_thread is not None and not server_thread.is_alive():
            raise RuntimeError('本地服务在启动过程中提前退出')
        try:
            with urllib.request.urlopen(url + '/health/', timeout=2) as response:
                status = getattr(response, 'status', 200)
                if status == 200:
                    return
        except urllib.error.HTTPError as exc:
            last_error = exc
        except Exception as exc:
            last_error = exc
            time.sleep(0.15)
            continue
        time.sleep(0.05)
    raise RuntimeError(f'本地服务启动超时: {last_error}')


def _start_waitress(application):
    from waitress import serve

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


def _build_macos_menu(window_ref, context='classroom'):
    """使用 pywebview 原生菜单接入 macOS 系统菜单栏。

    菜单动作只调用页面中已有的真实控件，避免桌面菜单与业务逻辑产生两套实现。
    macOS 会将该菜单渲染到系统顶栏，右上角状态区由系统菜单栏负责显示。
    """
    import webview

    context = str(context or 'classroom')
    bridge = window_ref.get('bridge')
    available = set(window_ref.get('available') or [])

    def has_selector(selector):
        return (not available and context != 'welcome') or selector in available

    def menu_action(label, selector, callback=None):
        if not has_selector(selector):
            return None
        action = webview.menu.MenuAction(label, callback or (lambda: click(selector)))
        action._fuckseats_selector = selector
        return action

    def menu_group(title, actions):
        items = [item for item in actions if item is not None]
        return webview.Menu(title, items) if items else None

    def menu_list(items):
        return [item for item in items if item is not None]

    def click(selector):
        window = window_ref.get('window')
        if window is None:
            return
        script = (
            "(() => { const target = document.querySelector(%s); "
            "if (target) target.click(); })();"
        ) % json.dumps(selector, ensure_ascii=False)
        try:
            window.evaluate_js(script)
        except Exception:
            pass

    def about_action():
        if bridge is not None and hasattr(bridge, 'open_about_window'):
            try:
                bridge.open_about_window()
                return
            except Exception:
                pass
        click('#native-menu-about')

    help_menu = webview.Menu('帮助', [webview.menu.MenuAction('关于', about_action)])

    if context == 'home':
        # 首页不承载班级级操作，系统菜单只保留帮助/关于，避免把导入导出、
        # 排座等上下文动作带到首页；进入班级后再由 sync_native_menu 动态替换。
        return [help_menu]

    if context == 'settings':
        return menu_list([
            menu_group('文件', [menu_action('返回首页', '.global-back-button')]),
            menu_group('视图', [
                menu_action('外观', '[data-settings-nav="appearance"]'),
                menu_action('排座偏好', '[data-settings-nav="arrange"]'),
                menu_action('数据与隐私', '[data-settings-nav="privacy"]'),
            ]),
            menu_group('窗口', [menu_action('首页', '.global-back-button')]),
            help_menu,
        ])

    if context == 'about':
        return menu_list([
            menu_group('窗口', [
                menu_action('返回设置', 'a[href*="/settings/"]'),
                menu_action('返回首页', '.global-back-button'),
            ]),
            help_menu,
        ])

    if context == 'generic':
        return menu_list([
            menu_group('窗口', [menu_action('首页', '.global-back-button')]),
            help_menu,
        ])

    import_menu = menu_group('导入', [
        menu_group('第三方软件', [
            menu_group('座位表', [
                menu_action('导入座位表', '#btn-open-layout-import-modal'),
                menu_action('BSCE 导入', '[data-bsce-import-trigger="1"]'),
            ]),
            menu_group('其他表格', [menu_action('导入 Excel 成绩表', '#btn-import-students')]),
        ]),
        menu_group('系统操作', [menu_action('导入 .seats', '#btn-import-seats-file')]),
    ])
    export_menu = menu_group('导出', [
        menu_group('第三方软件', [
            menu_group('座位表', [
                menu_action('导出排座表', '#btn-export-excel'),
                menu_action('导出 SVG', '#btn-export-svg'),
                menu_action('导出 PPTX', '#btn-export-pptx'),
            ]),
            menu_group('其他表格', [
                menu_action('导出小组登记表', '#btn-export-group-report'),
                menu_action('导出 CSIS', '#btn-export-csis'),
            ]),
        ]),
        menu_group('系统操作', [menu_action('导出 .seats', '#btn-export-seats-file')]),
    ])

    return menu_list([
        menu_group('文件', [import_menu, export_menu]),
        menu_group('编辑', [
            menu_action('撤销', '#undoBtn'),
            menu_action('重做', '#redoBtn'),
            menu_action('添加学生', '#btn-add-student'),
            menu_action('修改班级名称', '#btn-rename-classroom'),
            menu_action('删除班级', '#btn-delete-classroom'),
        ]),
        menu_group('视图', [
            menu_action('布局编辑', '#btn-layout-editor'), menu_action('全屏', '#btn-fullscreen'),
            menu_action('学生面板', '[data-tab="students"]'), menu_action('小组面板', '[data-tab="groups"]'),
            menu_action('约束面板', '[data-tab="constraints"]'),
        ]),
        menu_group('排座', [
            menu_action('自动排座', '#btn-auto-arrange'), menu_action('自定义策略设置', '#classroom-custom-sort-link'),
            menu_action('约束设置', '[data-tab="constraints"]'),
        ]),
        menu_group('变换', [
            menu_action('左移布局', '#btn-shift-layout-left'), menu_action('右移布局', '#btn-shift-layout-right'),
            menu_action('前移布局', '#btn-shift-layout-front'), menu_action('后移布局', '#btn-shift-layout-back'),
            menu_action('左右镜像', '#btn-mirror-layout-lr'), menu_action('移动选项', '[data-open-modal="shift-options-modal"]'),
        ]),
        menu_group('学生', [menu_action('学生面板', '[data-tab="students"]'), menu_action('小组面板', '[data-tab="groups"]')]),
        menu_group('扩展', [
            menu_action('插件中心', '#btn-open-plugin-hub'), menu_action('命令面板', '#btn-open-plugin-command'),
            menu_action('扩展清单', 'a[href*="/extensions/"]'), menu_action('闻道智能', '#btn-open-future-mode'),
        ]),
        menu_group('窗口', [menu_action('首页', '.global-back-button'), menu_action('设置', 'a[href*="/settings/"]')]),
        help_menu,
    ])


def _start_desktop_window(url, on_ready=None):
    try:
        import webview
    except Exception as exc:
        raise RuntimeError(f'当前环境缺少 pywebview 依赖: {exc}') from exc

    from desktop_shell import DesktopBridge, windows_window_geometry

    window_ref = {}
    bridge = DesktopBridge(url, native_menu_builder=_build_macos_menu)
    window_ref['bridge'] = bridge
    window_options = dict(
        width=1440,
        height=920,
        min_size=(1180, 760),
        background_color='#FFFFFF',
        text_select=True,
        frameless=True,
        easy_drag=False,
        resizable=True,
    )
    if sys.platform.startswith('win'):
        window_options.update({'width': 1100, 'height': 700, 'min_size': (840, 560)})
        window_options.update(windows_window_geometry(1440, 920, 840, 560))
    if sys.platform == 'darwin':
        # pywebview 默认会额外插入英文 View/Edit 菜单；本项目已经按页面
        # 动态生成中文原生菜单，保留默认菜单会造成“View/Edit”与“视图/编辑”
        # 重复出现。关闭默认菜单后，系统菜单栏只保留当前页面的自定义菜单。
        webview.settings['SHOW_DEFAULT_MENUS'] = False
        window_options.update({
            'width': 1500,
            'height': 900,
            'min_size': (1100, 700),
            'vibrancy': True,
            # 应用从首页启动时，原生菜单先展示首页可用项；进入班级/设置后由
            # sync_native_menu 根据当前路径动态替换，避免首屏仍残留班级操作。
            'menu': _build_macos_menu(window_ref, context='home'),
        })
    window = webview.create_window(
        '不想排座位',
        url,
        js_api=bridge,
        **window_options,
    )
    window_ref['window'] = window
    bridge._attach_window(window)
    if on_ready is not None:
        window.events.loaded += on_ready

    start_kwargs = {'debug': False}
    if sys.platform.startswith('win'):
        start_kwargs['gui'] = 'edgechromium'

    try:
        webview.start(_configure_windows_webview, bridge, **start_kwargs)
    except Exception as exc:
        if sys.platform.startswith('win'):
            raise RuntimeError(f'启动 WebView 失败，请确认系统已安装 WebView2 Runtime：{exc}') from exc
        raise RuntimeError(f'启动 WebView 失败：{exc}') from exc


def _ensure_windows_admin(entry_script, dev_mode, before_relaunch=None):
    if not sys.platform.startswith('win') or dev_mode:
        return False

    from desktop_runtime import is_process_elevated, relaunch_self_as_admin

    if is_process_elevated():
        return False

    if before_relaunch is not None:
        before_relaunch()
    print('检测到 Windows 桌面端尚未获得管理员权限，正在重新申请管理员权限...', flush=True)
    try:
        relaunch_self_as_admin(entry_script)
    except Exception as exc:
        print(f'管理员权限申请失败，本次启动已取消：{exc}', file=sys.stderr, flush=True)
        show_message(f'管理员权限申请失败，本次启动已取消：{exc}', error=True)
    return True


def _prepare_application(dev_mode):
    ensure_runtime_dependencies()
    from database_security import prepare_desktop_database

    os.environ['FUCKSEATS_APP_SHELL'] = 'browser' if dev_mode else 'webview'
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    logging.getLogger('waitress').setLevel(logging.ERROR)
    prepare_desktop_database()

    from config.wsgi import application
    from django.core.management import call_command

    try:
        migrate_stdout = StringIO()
        migrate_stderr = StringIO()
        call_command(
            'migrate', interactive=False,
            stdout=migrate_stdout, stderr=migrate_stderr,
        )
        stdout_text = _filter_migration_noise(migrate_stdout.getvalue())
        stderr_text = _filter_migration_noise(migrate_stderr.getvalue())
        if stdout_text:
            print(stdout_text, flush=True)
        if stderr_text:
            print(stderr_text, file=sys.stderr, flush=True)
    except Exception as exc:
        raise RuntimeError(f'数据库迁移失败，应用已停止启动：{exc}') from exc

    app_url = f'http://{HOST}:{PORT}'
    server_thread = threading.Thread(
        target=_start_waitress, args=(application,), daemon=True,
        name='fuckseats-waitress',
    )
    server_thread.start()
    _wait_for_server_ready(app_url, server_thread=server_thread)
    return server_thread


def main(argv=None):
    try:
        options = _parse_startup_options(sys.argv if argv is None else argv)
    except ValueError as exc:
        show_message(str(exc), error=True)
        return 1

    # Both guards run before dependencies, database preparation and UAC relaunch.
    from database_security import DatabaseSecurityError, application_lock

    guard = DesktopInstanceGuard()
    app_lock = None
    try:
        guard.acquire()
        app_lock = application_lock()
        app_lock.acquire()
        _check_service_port()
    except (ExistingInstanceError, DatabaseSecurityError) as exc:
        if app_lock is not None:
            app_lock.release()
        guard.release()
        message = str(exc) if isinstance(exc, ExistingInstanceError) else '已有实例，请使用已打开的不想排座位。'
        return _handle_existing_instance(options.read_access_request, message)
    except Exception as exc:
        if app_lock is not None:
            app_lock.release()
        guard.release()
        show_message(f'无法检查应用实例：{exc}', error=True)
        return 1

    splash = StartupSplash()

    def release_before_relaunch():
        # The elevated child must not see the launching parent as an existing app.
        splash.close()
        app_lock.release()
        guard.release()

    try:
        splash.show()
        if _ensure_windows_admin(__file__, options.dev, before_relaunch=release_before_relaunch):
            return 0
        server_thread = splash.run(lambda: _prepare_application(options.dev))
        if sys.platform.startswith('win'):
            read_access_broker.start(prompt_read_access)
        if options.read_access_request is not None:
            read_access_broker.submit(options.read_access_request)

        app_url = f'http://{HOST}:{PORT}'
        print(f'客户端已启动：{app_url}', flush=True)
        if options.dev:
            _open_browser(app_url)
            splash.close()
            try:
                while server_thread.is_alive():
                    server_thread.join(timeout=1)
            except KeyboardInterrupt:
                print("\n开发模式已停止。", flush=True)
            return 0

        _start_desktop_window(app_url, on_ready=splash.close)
        return 0
    except Exception as exc:
        splash.close()
        show_message(f'启动失败：{exc}', error=True)
        return 1
    finally:
        splash.close()
        read_access_broker.close()
        app_lock.release()
        guard.release()

if __name__ == '__main__':
    sys.exit(main())
   
