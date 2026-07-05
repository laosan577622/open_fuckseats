import os
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
    'cryptography.hazmat.bindings._rust.openssl',
    'cryptography.hazmat.bindings._rust.openssl.aead',
)

WINDOWS_HIDDEN_IMPORTS = (
    'clr',
    'pythonnet',
    'clr_loader',
    'webview.platforms.winforms',
    'webview.platforms.edgechromium',
    'webview.platforms.mshtml',
)

COMMON_COLLECT_ALL = (
    'openai',
    'httpx',
    'httpcore',
    'pptx',
    'webview',
    'whitenoise',
    'cryptography',
)

WINDOWS_COLLECT_ALL = (
    'pythonnet',
    'clr_loader',
)

COMMON_COLLECT_DATA = (
    'certifi',
    'cryptography',
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

    _extend_option_pairs(cmd, '--hidden-import', COMMON_HIDDEN_IMPORTS)
    _extend_option_pairs(cmd, '--collect-all', COMMON_COLLECT_ALL)
    _extend_option_pairs(cmd, '--collect-data', COMMON_COLLECT_DATA)
    _extend_option_pairs(cmd, '--copy-metadata', COMMON_COPY_METADATA)

    if _is_windows():
        _extend_option_pairs(cmd, '--hidden-import', WINDOWS_HIDDEN_IMPORTS)
        _extend_option_pairs(cmd, '--collect-all', WINDOWS_COLLECT_ALL)
        _extend_option_pairs(cmd, '--copy-metadata', WINDOWS_COPY_METADATA)

    _extend_option_pairs(cmd, '--exclude-module', EXCLUDED_MODULES)
    cmd.append('run_app.py')
    return cmd


def _build_output_path(dist_dir):
    if _is_macos():
        return os.path.join(dist_dir, 'FuckSeats.app')
    if _is_windows():
        return os.path.join(dist_dir, 'FuckSeats', 'FuckSeats.exe')
    return os.path.join(dist_dir, 'FuckSeats', 'FuckSeats')


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


def main():
    _ensure_utf8_stdio()

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    
    if not sys.prefix or sys.prefix == sys.base_prefix:
        print("警告: 似乎未在虚拟环境中运行。建议在虚拟环境中使用此脚本。", flush=True)
    
    DIST_DIR = os.path.join(BASE_DIR, 'dist')
    BUILD_DIR = os.path.join(BASE_DIR, 'build')
    SPEC_FILE = os.path.join(BASE_DIR, 'FuckSeats.spec')
    STAGE_DIR = os.path.join(BASE_DIR, '_data_stage')
    DATA_DIRS = ['templates', 'static', 'seats', 'runtime', 'config', 'skill']
    DB_EXCLUDE_PATTERNS = ['*.sqlite3', '*.sqlite', '*.db']
    
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
            ignore=shutil.ignore_patterns(*DB_EXCLUDE_PATTERNS),
        )
        staged_data_dirs[data_dir] = dst_dir

    data_args = []
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
