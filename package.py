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


def _ensure_utf8_stdio():
    """在部分 Windows CI 环境中，默认输出编码可能是 cp1252，中文打印会报错。"""
    for stream_name in ('stdout', 'stderr'):
        stream = getattr(sys, stream_name, None)
        if stream and hasattr(stream, 'reconfigure'):
            try:
                stream.reconfigure(encoding='utf-8', errors='replace')
            except Exception:
                pass


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


def main():
    _ensure_utf8_stdio()

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    
    if not sys.prefix or sys.prefix == sys.base_prefix:
        print("警告: 似乎未在虚拟环境中运行。建议在虚拟环境中使用此脚本。", flush=True)
    
    DIST_DIR = os.path.join(BASE_DIR, 'dist')
    BUILD_DIR = os.path.join(BASE_DIR, 'build')
    SPEC_FILE = os.path.join(BASE_DIR, 'FuckSeats.spec')
    STAGE_DIR = os.path.join(BASE_DIR, '_data_stage')
    # 仅打包桌面运行所需目录
    DATA_DIRS = ['templates', 'static', 'seats', 'runtime', 'config']
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
    
    # 先暂存数据目录，排除数据库文件
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

    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--noconfirm',
        '--onedir',
        '--clean',
        '--name', 'FuckSeats',

        *data_args,

        '--hidden-import', 'waitress',
        '--hidden-import', 'webview',
        '--hidden-import', 'clr',
        '--hidden-import', 'pythonnet',
        '--hidden-import', 'clr_loader',
        '--hidden-import', 'whitenoise',
        '--hidden-import', 'whitenoise.middleware',
        '--hidden-import', 'django.contrib.staticfiles',
        '--hidden-import', 'django.contrib.admin',
        '--hidden-import', 'django.contrib.auth',
        '--hidden-import', 'django.contrib.contenttypes',
        '--hidden-import', 'django.contrib.sessions',
        '--hidden-import', 'django.contrib.messages',
        '--hidden-import', 'django.contrib.humanize',
        '--hidden-import', 'pandas',
        '--hidden-import', 'openai',
        '--hidden-import', 'httpx',
        '--hidden-import', 'httpcore',
        '--hidden-import', 'anyio',
        '--hidden-import', 'sniffio',
        '--hidden-import', 'pydantic',
        '--hidden-import', 'pydantic_core',
        '--hidden-import', 'openpyxl',
        '--hidden-import', 'xlrd',
        '--hidden-import', 'pptx',
        '--hidden-import', 'pytz',
        '--hidden-import', 'tzdata',
        '--hidden-import', 'pypinyin',
        '--collect-all', 'openai',
        '--collect-all', 'httpx',
        '--collect-all', 'httpcore',
        '--collect-all', 'pptx',
        '--collect-all', 'pythonnet',
        '--collect-all', 'clr_loader',
        '--collect-all', 'webview',
        '--copy-metadata', 'pandas',
        '--copy-metadata', 'pythonnet',
        '--copy-metadata', 'pywebview',
        '--copy-metadata', 'pytz',
        '--copy-metadata', 'python-dateutil',
        '--copy-metadata', 'tzdata',
        
        # 这些目录已通过 add-data 带入
        '--exclude-module', 'seats',
        '--exclude-module', 'website',
        '--exclude-module', 'config',

        'run_app.py'
    ]
    
    print(f"执行命令: {' '.join(cmd)}", flush=True)
    
    try:
        subprocess.check_call(cmd, cwd=BASE_DIR)
        removed_db_files = _remove_embedded_databases(DIST_DIR)
        print("-" * 30, flush=True)
        print("打包成功！", flush=True)
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
        exe_path = os.path.join(DIST_DIR, 'FuckSeats', 'FuckSeats.exe')
        print(f"可执行文件位置: {exe_path}", flush=True)
    except subprocess.CalledProcessError as e:
        print(f"打包过程中出错: {e}", flush=True)
        sys.exit(1)

if __name__ == '__main__':
    main()
