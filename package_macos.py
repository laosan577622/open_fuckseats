import json
import os
import re
import shutil
import subprocess
import sys


APP_DISPLAY_NAME = '不想排座位'
APP_BUNDLE_NAME = 'FuckSeats.app'


def _ensure_utf8_stdio():
    for stream_name in ('stdout', 'stderr'):
        stream = getattr(sys, stream_name, None)
        if stream and hasattr(stream, 'reconfigure'):
            try:
                stream.reconfigure(encoding='utf-8', errors='replace')
            except Exception:
                pass


def _read_manifest_version(base_dir):
    manifest_path = os.path.join(base_dir, 'runtime', 'release.json')
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return str(data.get('version') or '').strip()
    except Exception:
        return ''


def _resolve_version(base_dir):
    if len(sys.argv) > 1:
        version = str(sys.argv[1] or '').strip()
        if version:
            return version

    env_version = str(os.getenv('FUCKSEATS_APP_VERSION') or '').strip()
    if env_version:
        return env_version

    return _read_manifest_version(base_dir) or '0.0.0-local'


def _safe_filename_part(value):
    return re.sub(r'[^0-9A-Za-z._-]+', '-', str(value or '').strip()).strip('.-') or 'local'


def _find_app_bundle(base_dir):
    candidates = (
        os.path.join(base_dir, 'dist', APP_BUNDLE_NAME),
        os.path.join(base_dir, 'dist', 'FuckSeats', APP_BUNDLE_NAME),
    )
    for candidate in candidates:
        if os.path.isdir(candidate):
            return candidate
    return ''


def main():
    _ensure_utf8_stdio()

    if sys.platform != 'darwin':
        print('macOS DMG 打包脚本只能在 macOS 上运行。', file=sys.stderr, flush=True)
        sys.exit(1)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    version = _resolve_version(base_dir)
    safe_version = _safe_filename_part(version)
    artifacts_dir = os.path.join(base_dir, 'artifacts', 'macos')
    stage_dir = os.path.join(base_dir, '_mac_dmg_stage')
    staged_app_path = os.path.join(stage_dir, f'{APP_DISPLAY_NAME}.app')
    dmg_path = os.path.join(artifacts_dir, f'{APP_DISPLAY_NAME}_v{safe_version}_macOS.dmg')

    print(f'开始构建 macOS 版本: {version}', flush=True)
    subprocess.check_call([sys.executable, 'package.py'], cwd=base_dir)

    app_bundle_path = _find_app_bundle(base_dir)
    if not app_bundle_path:
        print('未找到 PyInstaller 生成的 .app 产物。', file=sys.stderr, flush=True)
        sys.exit(1)

    if os.path.exists(stage_dir):
        shutil.rmtree(stage_dir)
    if os.path.exists(dmg_path):
        os.remove(dmg_path)

    os.makedirs(stage_dir, exist_ok=True)
    os.makedirs(artifacts_dir, exist_ok=True)
    shutil.copytree(app_bundle_path, staged_app_path, symlinks=True)

    skill_source_dir = os.path.join(base_dir, 'skill')
    if os.path.isdir(skill_source_dir):
        shutil.copytree(skill_source_dir, os.path.join(stage_dir, 'skill'))

    applications_link = os.path.join(stage_dir, 'Applications')
    try:
        os.symlink('/Applications', applications_link)
    except FileExistsError:
        pass

    subprocess.check_call([
        'hdiutil',
        'create',
        '-volname', f'{APP_DISPLAY_NAME} {version}',
        '-srcfolder', stage_dir,
        '-ov',
        '-format', 'UDZO',
        dmg_path,
    ], cwd=base_dir)

    print(f'macOS DMG 产物位置: {dmg_path}', flush=True)


if __name__ == '__main__':
    main()
