import os
import shutil
import subprocess
import sys

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
    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--noconfirm',
        '--onedir',
        '--clean',
        '--name', 'FuckSeats',
        
        # 数据文件包含
        '--add-data', f'templates{os.pathsep}templates',
        '--add-data', f'static{os.pathsep}static',
        '--add-data', f'seats{os.pathsep}seats',
        '--add-data', f'website{os.pathsep}website',
        # config 文件夹包含设置为 app 配置
        '--add-data', f'config{os.pathsep}config',
        
        # 隐式导入 - 解决运行时缺包问题
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
        '--hidden-import', 'tzdata',
        
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
        print("-" * 30, flush=True)
        print("打包成功！", flush=True)
        exe_path = os.path.join(DIST_DIR, 'FuckSeats', 'FuckSeats.exe')
        print(f"可执行文件位置: {exe_path}", flush=True)
    except subprocess.CalledProcessError as e:
        print(f"打包过程中出错: {e}", flush=True)
        sys.exit(1)

if __name__ == '__main__':
    main()
