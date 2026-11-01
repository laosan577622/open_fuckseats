import json
import os
import py_compile
import shutil
import subprocess
import sys


DB_FILE_MARKERS = {
    'db.sqlite3',
    'db.sqlite3-journal',
    'db.sqlite3-shm',
    'db.sqlite3-wal',
}

OPENAI_ENV_NAMES = (
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
)

COMMON_HIDDEN_IMPORTS = (
    'seats.desktop_auth',
    'seats.drop_views',
    'buxiang_drop_sdk',
    'buxiang_drop_sdk.drop_client',
    'tkinter',
    'tkinter.ttk',
    'tkinter.messagebox',
    'waitress',
    'webview',
    'whitenoise',
    'whitenoise.middleware',
    'whitenoise.storage',
    'django.contrib.staticfiles',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.humanize',
    'pandas',
    'openai',
    'httpx',
    'httpcore',
    'anyio',
    'sniffio',
    'pydantic',
    'pydantic_core',
    'openpyxl',
    'xlrd',
    'pptx',
    'pytz',
    'tzdata',
    'pypinyin',
    'certifi',
    'cryptography',
    'cryptography.hazmat.primitives.ciphers.aead',
    'cryptography.hazmat.bindings._rust',
    'keyring',
    'sqlcipher3',
    'sqlcipher3.dbapi2',
)

OPEN_API_HIDDEN_IMPORTS = (
    'seats.open_api',
    'seats.open_api.ai_session',
    'seats.open_api.auth',
    'seats.open_api.mcp',
    'seats.open_api.openapi',
    'seats.open_api.realtime',
    'seats.open_api.registry',
    'seats.open_api.serializers',
    'seats.open_api.shared_state',
    'seats.open_api.tools',
    'seats.open_api.urls',
    'seats.open_api.views',
)

WINDOWS_HIDDEN_IMPORTS = (
    'clr',
    'pythonnet',
    'clr_loader',
    'webview.platforms.winforms',
    'webview.platforms.edgechromium',
    'webview.platforms.mshtml',
    'keyring.backends.Windows',
)

MACOS_HIDDEN_IMPORTS = (
    'keyring.backends.macOS',
)

COMMON_COLLECT_ALL = (
    'openai',
    'httpx',
    'httpcore',
    'pptx',
    'webview',
    'whitenoise',
    'cryptography',
    'keyring',
    'sqlcipher3',
)

WINDOWS_COLLECT_ALL = (
    'pythonnet',
    'clr_loader',
)

COMMON_COLLECT_DATA = (
    'certifi',
    'cryptography',
    'keyring',
    'sqlcipher3',
)

COMMON_COPY_METADATA = (
    'pandas',
    'pywebview',
    'pytz',
    'python-dateutil',
    'tzdata',
    'certifi',
    'whitenoise',
    'cryptography',
)

WINDOWS_COPY_METADATA = (
    'pythonnet',
)

EXCLUDED_MODULES = (
    'website',
)

UNWANTED_PROJECT_BACKEND_PATHS = (
    os.path.join('FuckSeats', 'backend'),
    os.path.join('FuckSeats', '_internal', 'backend'),
    os.path.join('FuckSeats.app', 'Contents', 'backend'),
    os.path.join('FuckSeats.app', 'Contents', 'MacOS', 'backend'),
    os.path.join('FuckSeats.app', 'Contents', 'Resources', 'backend'),
    os.path.join('FuckSeats.app', 'Contents', 'Frameworks', 'backend'),
    os.path.join('FuckSeats.app', 'Contents', '_internal', 'backend'),
)


def _ensure_utf8_stdio():
    for stream_name in ('stdout', 'stderr'):
        stream = getattr(sys, stream_name, None)
        if stream and hasattr(stream, 'reconfigure'):
            try:
                stream.reconfigure(encoding='utf-8', errors='replace')
            except Exception:
                pass


def _is_windows():
    return sys.platform.startswith('win')


def _is_macos():
    return sys.platform == 'darwin'


def _extend_option_pairs(args, option, values):
    for value in values:
        args.extend([option, value])


def _build_pyinstaller_command(data_args):
    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--noconfirm',
        '--onedir',
        '--clean',
        '--name', 'FuckSeats',
        *data_args,
    ]

    if _is_windows() or _is_macos():
        cmd.append('--windowed')
        icon = 'app-icon.ico' if _is_windows() else 'app-icon.icns'
        icon_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static', icon)
        if not os.path.isfile(icon_path):
            raise FileNotFoundError(f'缺少应用图标：{icon_path}')
        cmd.extend(['--icon', icon_path])
    if _is_macos():
        cmd.extend(['--osx-bundle-identifier', 'xyz.577622.fuckseats'])
        # Sign bundled native libraries with the same identity as the outer App.
        identity = str(os.getenv('MACOS_APP_SIGNING_IDENTITY') or '').strip()
        if identity:
            cmd.extend(['--codesign-identity', identity])

    _extend_option_pairs(cmd, '--hidden-import', COMMON_HIDDEN_IMPORTS)
    _extend_option_pairs(cmd, '--hidden-import', OPEN_API_HIDDEN_IMPORTS)
    _extend_option_pairs(cmd, '--collect-all', COMMON_COLLECT_ALL)
    _extend_option_pairs(cmd, '--collect-data', COMMON_COLLECT_DATA)
    _extend_option_pairs(cmd, '--copy-metadata', COMMON_COPY_METADATA)

    if _is_windows():
        _extend_option_pairs(cmd, '--hidden-import', WINDOWS_HIDDEN_IMPORTS)
        _extend_option_pairs(cmd, '--collect-all', WINDOWS_COLLECT_ALL)
        _extend_option_pairs(cmd, '--copy-metadata', WINDOWS_COPY_METADATA)
    elif _is_macos():
        _extend_option_pairs(cmd, '--hidden-import', MACOS_HIDDEN_IMPORTS)

    _extend_option_pairs(cmd, '--exclude-module', EXCLUDED_MODULES)
    cmd.append('run_app.py')
    return cmd


def _build_output_path(dist_dir):
    if _is_macos():
        return os.path.join(dist_dir, 'FuckSeats.app')
    if _is_windows():
        return os.path.join(dist_dir, 'FuckSeats', 'FuckSeats.exe')
    return os.path.join(dist_dir, 'FuckSeats', 'FuckSeats')


def _write_staged_release_manifest(stage_dir):
    version = str(os.getenv('FUCKSEATS_APP_VERSION') or '').strip()
    if not version:
        return
    manifest_path = os.path.join(stage_dir, 'runtime', 'release.json')
    os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
    try:
        with open(manifest_path, 'r', encoding='utf-8') as source:
            payload = json.load(source)
        if not isinstance(payload, dict):
            payload = {}
    except Exception:
        payload = {}
    payload['version'] = version
    team_id = str(
        os.getenv('MACOS_TEAM_ID')
        or os.getenv('MACOS_NOTARY_TEAM_ID')
        or ''
    ).strip()
    if team_id:
        payload['team_id'] = team_id
    else:
        payload.pop('team_id', None)
    with open(manifest_path, 'w', encoding='utf-8') as output:
        json.dump(payload, output, ensure_ascii=False, indent=2)
        output.write('\n')


def _compile_staged_app_code(stage_dir):
    """为动态发现的 Django 模块保留相邻 .pyc，绝不修改工作区源码。"""
    compiled = 0
    for package in ('seats', 'config'):
        package_dir = os.path.join(stage_dir, package)
        if not os.path.isdir(package_dir):
            continue
        for directory, _, files in os.walk(package_dir):
            for filename in files:
                if not filename.endswith('.py'):
                    continue
                source = os.path.join(directory, filename)
                py_compile.compile(
                    source, cfile=source + 'c', dfile=os.path.relpath(source, stage_dir),
                    doraise=True, optimize=0,
                    invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH,
                )
                os.remove(source)
                compiled += 1
    return compiled


def _verify_compiled_app_payload(dist_dir):
    plaintext = []
    required_bytecode = {'seats/views.pyc', 'config/settings.pyc'}
    root_modules = {
        name for name in os.listdir(os.path.dirname(os.path.dirname(__file__)))
        if name.endswith('.py')
    }
    for directory, _, files in os.walk(dist_dir):
        parts = os.path.relpath(directory, dist_dir).split(os.sep)
        core_package = any(part in {'seats', 'config', 'plugin_core'} for part in parts)
        for filename in files:
            if filename.lower().endswith(('.py', '.pyw')) and (core_package or filename in root_modules):
                plaintext.append(os.path.join(directory, filename))
            for required in tuple(required_bytecode):
                package, name = required.split('/')
                if filename == name and parts[-1] == package:
                    required_bytecode.remove(required)
    if plaintext:
        raise RuntimeError('安装包仍包含核心 Python 源码：' + ', '.join(plaintext[:5]))
    if required_bytecode:
        raise RuntimeError('安装包缺少核心字节码：' + ', '.join(sorted(required_bytecode)))


def _verify_frozen_startup(app_path):
    """脱离源码目录验证成品，验证结束后关闭进程并清理隔离数据。"""
    import secrets
    import socket
    import tempfile
    import time
    import urllib.error
    import urllib.request
    from concurrent.futures import ThreadPoolExecutor

    with socket.socket() as connection:
        if connection.connect_ex(('127.0.0.1', 23948)) == 0:
            raise RuntimeError('23948 端口已占用，无法执行隔离成品验证')
    executable = os.path.abspath(app_path)
    if executable.endswith('.app'):
        executable = os.path.join(executable, 'Contents', 'MacOS', 'FuckSeats')
    with tempfile.TemporaryDirectory(prefix='fuckseats-package-check-') as directory:
        api_key = secrets.token_hex(24)
        env = {
            **os.environ, 'FUCKSEATS_DATA_DIR': directory,
            'FUCKSEATS_DATABASE_KEY': secrets.token_hex(32),
            'FUCKSEATS_OPEN_API_KEY': api_key,
            'BROWSER': 'msedge' if _is_windows() else '/usr/bin/true',
        }
        env.pop('FUCKSEATS_DATABASE_PATH', None)
        env.pop('FUCKSEATS_DISABLE_DATABASE_ENCRYPTION', None)

        def request(path, payload=None):
            headers = {'Authorization': 'Bearer ' + api_key}
            data = None
            if payload is not None:
                data = json.dumps(payload).encode('utf-8')
                headers['Content-Type'] = 'application/json'
            req = urllib.request.Request('http://127.0.0.1:23948' + path, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=20) as response:
                if path == '/health/':
                    return response.read().strip() == b'ok'
                return json.load(response)

        log_path = os.path.join(directory, 'startup.log')
        with open(log_path, 'w+b') as log:
            process = subprocess.Popen([executable, '-dev'], cwd=directory, env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 120
                while True:
                    if process.poll() is not None:
                        raise RuntimeError('打包程序在启动验证中提前退出')
                    try:
                        if request('/health/'):
                            break
                    except (OSError, ValueError, urllib.error.URLError):
                        pass
                    if time.monotonic() >= deadline:
                        raise RuntimeError('打包程序启动验证超时')
                    time.sleep(0.25)
                for path in ('/api/store/js/', '/cloud/userinfo'):
                    try:
                        request(path)
                    except urllib.error.HTTPError as error:
                        if error.code != 401 or json.load(error).get('code') != 'DESKTOP_AUTH_REQUIRED':
                            raise RuntimeError('成品桌面鉴权验证失败：' + path) from error
                    else:
                        raise RuntimeError('成品内部接口接受了 Open API 凭证：' + path)
                with ThreadPoolExecutor(max_workers=4) as pool:
                    created = request('/open_api/tools/execute', {
                        'tool': 'create_classroom', 'arguments': {'name': '成品隔离验证', 'rows': 2, 'cols': 3},
                    })
                    classroom_id = created['result']['classroom']['id']
                    read_checks = [pool.submit(request, '/open_api/classrooms') for _ in range(4)]
                    operations = [
                        ('add_students_batch', {'students': [{'name': '验证甲'}, {'name': '验证乙'}]}),
                        ('arrange_seats', {'mode': 'random'}),
                        ('create_snapshot', {'name': '成品验证快照'}),
                        ('validate_seating', {}),
                    ]
                    for tool, arguments in operations:
                        result = request('/open_api/tools/execute', {
                            'tool': tool, 'classroom_id': classroom_id, 'arguments': arguments,
                        })
                        if result.get('status') != 'ok' or (tool == 'validate_seating' and not result['result']['ok']):
                            raise RuntimeError('成品核心操作验证失败：' + tool)
                    for check in read_checks:
                        check.result()
                print('成品独立启动、桌面鉴权、数据库迁移、并发读取、排座与快照验证通过。', flush=True)
            except Exception as error:
                log.flush()
                with open(log_path, 'r', encoding='utf-8', errors='replace') as source:
                    details = source.read()[-4000:]
                raise RuntimeError(f'{error}\n{details}') from error
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=10)


def _remove_embedded_databases(dist_root):
    if not os.path.exists(dist_root):
        return []

    removed = []
    for root, _, files in os.walk(dist_root):
        for filename in files:
            lowered = filename.lower()
            if lowered in DB_FILE_MARKERS or lowered.endswith('.sqlite3'):
                file_path = os.path.join(root, filename)
                try:
                    os.remove(file_path)
                    removed.append(file_path)
                except Exception as e:
                    print(f"移除数据库文件失败: {file_path} ({e})", flush=True)
    return removed


def _remove_project_backend_payload(dist_root):
    if not os.path.exists(dist_root):
        return []

    removed = []
    for rel_path in UNWANTED_PROJECT_BACKEND_PATHS:
        dir_path = os.path.join(dist_root, rel_path)
        if not os.path.isdir(dir_path):
            continue
        try:
            shutil.rmtree(dir_path)
            removed.append(dir_path)
        except Exception as e:
            print(f"移除项目 backend 目录失败: {dir_path} ({e})", flush=True)
    return removed


def _stage_startup_font(base_dir, stage_dir):
    filename = 'HarmonyOS_SansSC_Regular.ttf'
    source = os.path.join(base_dir, 'fonts', filename)
    if not os.path.isfile(source):
        raise FileNotFoundError(f'缺少启动字体：{source}')
    target_dir = os.path.join(stage_dir, 'fonts')
    os.makedirs(target_dir, exist_ok=True)
    shutil.copy2(source, os.path.join(target_dir, filename))
    return target_dir


def main():
    _ensure_utf8_stdio()

    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    if not sys.prefix or sys.prefix == sys.base_prefix:
        print("警告: 似乎未在虚拟环境中运行。建议在虚拟环境中使用此脚本。", flush=True)

    DIST_DIR = os.path.join(BASE_DIR, 'dist')
    BUILD_DIR = os.path.join(BASE_DIR, 'build')
    SPEC_FILE = os.path.join(BASE_DIR, 'FuckSeats.spec')
    STAGE_DIR = os.path.join(BASE_DIR, '_data_stage')
    DATA_DIRS = ['templates', 'static', 'seats', 'runtime', 'config', 'plugins', 'skill']
    DATA_EXCLUDE_PATTERNS = [
        '*.sqlite3', '*.sqlite', '*.db', '__pycache__', '*.pyc', '*.pyo',
        'tests', 'test', '__tests__', 'tests.py', 'test_*.py', 'tests_*.py',
        '.pytest_cache', '.DS_Store',
        '.env', '.env.*', '*.env', 'instance-secret', 'database-bootstrap.json',
    ]

    print("正在清理旧构建文件...", flush=True)
    if os.path.exists(DIST_DIR):
        try:
            shutil.rmtree(DIST_DIR)
        except Exception as e:
            print(f"清理 dist 目录失败: {e}", flush=True)

    if os.path.exists(BUILD_DIR):
        try:
            shutil.rmtree(BUILD_DIR)
        except Exception as e:
            print(f"清理 build 目录失败: {e}", flush=True)

    if os.path.exists(SPEC_FILE):
        try:
            os.remove(SPEC_FILE)
        except Exception as e:
            print(f"清理 spec 文件失败: {e}", flush=True)

    print("开始打包程序...", flush=True)

    print("Preparing data files (excluding database files)...", flush=True)
    if os.path.exists(STAGE_DIR):
        try:
            shutil.rmtree(STAGE_DIR)
        except Exception as e:
            print(f"Failed to clean stage directory: {e}", flush=True)
    os.makedirs(STAGE_DIR, exist_ok=True)

    staged_data_dirs = {}
    for data_dir in DATA_DIRS:
        src_dir = os.path.join(BASE_DIR, data_dir)
        if not os.path.exists(src_dir):
            continue
        dst_dir = os.path.join(STAGE_DIR, data_dir)
        shutil.copytree(
            src_dir,
            dst_dir,
            ignore=shutil.ignore_patterns(*DATA_EXCLUDE_PATTERNS),
        )
        staged_data_dirs[data_dir] = dst_dir

    _write_staged_release_manifest(STAGE_DIR)
    compiled = _compile_staged_app_code(STAGE_DIR)
    print(f'已将 {compiled} 个核心 Python 文件编译为无源码 .pyc。', flush=True)
    staged_font_dir = _stage_startup_font(BASE_DIR, STAGE_DIR)

    data_args = ['--add-data', f'{staged_font_dir}{os.pathsep}fonts']
    for data_dir in DATA_DIRS:
        staged_dir = staged_data_dirs.get(data_dir)
        if staged_dir:
            data_args += ['--add-data', f'{staged_dir}{os.pathsep}{data_dir}']

    cmd = _build_pyinstaller_command(data_args)

    print(f"执行命令: {' '.join(cmd)}", flush=True)

    try:
        subprocess.check_call(cmd, cwd=BASE_DIR)
        removed_unwanted_dirs = _remove_project_backend_payload(DIST_DIR)
        removed_db_files = _remove_embedded_databases(DIST_DIR)
        _verify_compiled_app_payload(DIST_DIR)
        if os.getenv('FUCKSEATS_VERIFY_PACKAGE') == '1':
            _verify_frozen_startup(_build_output_path(DIST_DIR))
        print("-" * 30, flush=True)
        print("打包成功！", flush=True)
        if removed_unwanted_dirs:
            print(f"已移除 {len(removed_unwanted_dirs)} 个不需要的目录（含 backend）。", flush=True)
        else:
            print("未发现需要剔除的项目 backend 目录。", flush=True)
        if removed_db_files:
            print(f"已移除 {len(removed_db_files)} 个数据库文件，避免随安装包分发。", flush=True)
        else:
            print("未发现可执行目录中的数据库文件。", flush=True)
        configured_openai_envs = [name for name in OPENAI_ENV_NAMES if os.getenv(name)]
        if configured_openai_envs:
            print(
                "检测到当前环境已配置 OpenAI 变量: "
                + ", ".join(configured_openai_envs)
                + "。打包后的程序运行时也可继续读取这些环境变量。",
                flush=True
            )
        else:
            print(
                "当前环境未配置 OpenAI 变量。打包后的程序仍可在 Future Mode 页面中直接填写 API Key / Base URL / Model ID。",
                flush=True
            )
        output_path = _build_output_path(DIST_DIR)
        print(f"构建产物位置: {output_path}", flush=True)
    except subprocess.CalledProcessError as e:
        print(f"打包过程中出错: {e}", flush=True)
        sys.exit(1)

if __name__ == '__main__':
    main()
