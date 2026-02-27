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
    # 获取当前脚本所在目录
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    
    # 确保在虚拟环境中运行
    if not sys.prefix or sys.prefix == sys.base_prefix:
        print("警告: 似乎未在虚拟环境中运行。建议在虚拟环境中使用此脚本。", flush=True)
    
    # 定义输出目录
    DIST_DIR = os.path.join(BASE_DIR, 'dist')
    BUILD_DIR = os.path.join(BASE_DIR, 'build')
    SPEC_FILE = os.path.join(BASE_DIR, 'FuckSeats.spec')
    STAGE_DIR = os.path.join(BASE_DIR, '_data_stage')
    DATA_DIRS = ['templates', 'static', 'seats', 'website', 'config']
    DB_EXCLUDE_PATTERNS = ['*.sqlite3', '*.sqlite', '*.db']
    
    # 清理旧的构建文件
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
    
    # 构建 PyInstaller 命令
    # 使用 sys.executable 确保使用当前环境的 Python 解释器和库
    # Stage data directories to exclude database files from packaging
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

        # Data files (staged; database files excluded)
        *data_args,

        '--hidden-import', 'waitress',
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
        '--hidden-import', 'openpyxl',
        '--hidden-import', 'xlrd',
        '--hidden-import', 'pptx',
        '--hidden-import', 'tzdata',
        '--collect-all', 'pptx',
        
        # 如果 run_app.py 里排除了这些模块，则需要在这里排除，或者让 pyinstaller 自动分析
        # 用户之前的指令排除了它们，可能是因为包含在 add-data 中了。
        # 如果 add-data 同时包含了源码，通常排除模块分析可以减小体积或避免冲突，但要小心。
        # 这里为了稳妥，我们遵循之前的排除逻辑，但确保 hidden-import 处理了依赖。
        # 不过，如果 run_app 导入了它们，排除可能会导致问题。
        # 鉴于 add-data 已经把文件夹拷过去了，我们可以排除模块分析，让 python 运行时直接从文件系统（_internal）加载。
        # 这种方式类似“源代码分发”。
        '--exclude-module', 'seats',
        '--exclude-module', 'website',
        '--exclude-module', 'config',
        
        # 主入口
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
        exe_path = os.path.join(DIST_DIR, 'FuckSeats', 'FuckSeats.exe')
        print(f"可执行文件位置: {exe_path}", flush=True)
    except subprocess.CalledProcessError as e:
        print(f"打包过程中出错: {e}", flush=True)
        sys.exit(1)

if __name__ == '__main__':
    main()
