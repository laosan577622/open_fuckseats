"""Select a usable source-checkout interpreter before importing application code."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys


def ensure_runtime_dependencies():
    if getattr(sys, 'frozen', False):
        return
    required = ('django', 'waitress', 'httpx', 'openai', 'cryptography')
    missing = [name for name in required if importlib.util.find_spec(name) is None]
    if not missing:
        return
    root = Path(__file__).resolve().parent
    venv = root / '.venv'
    python = venv / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    # Compare prefixes, not executable realpaths: venv Python is often a symlink.
    if Path(sys.prefix).resolve() != venv.resolve() and python.is_file():
        try:
            probe = subprocess.run(
                [str(python), '-c', 'import ' + ', '.join(required)],
                capture_output=True, timeout=15, check=False,
            )
            if probe.returncode == 0:
                print('当前 Python 缺少依赖，正在切换到项目 .venv。', flush=True)
                os.execv(str(python), [str(python), *sys.argv])
        except (OSError, subprocess.TimeoutExpired):
            pass
    raise SystemExit(
        '当前 Python 缺少依赖：' + ', '.join(missing)
        + '\n请使用项目虚拟环境安装 requirements.txt 后启动：'
        + '\n  .venv/bin/python -m pip install -r requirements.txt'
        + '\n  .venv/bin/python run_app.py -dev'
    )
