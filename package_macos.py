import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile


APP_DISPLAY_NAME = '不想排座位'
APP_BUNDLE_NAME = 'FuckSeats.app'
APP_BUNDLE_ID = 'xyz.577622.fuckseats'
PKG_IDENTIFIER = 'xyz.577622.fuckseats.pkg'
ARTIFACT_PREFIX = 'Fuckseats'


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


def _truthy(value):
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _configure_app_info(app_path, version):
    info_path = os.path.join(app_path, 'Contents', 'Info.plist')
    with open(info_path, 'rb') as source:
        info = plistlib.load(source)
    info['CFBundleIdentifier'] = APP_BUNDLE_ID
    info['CFBundleDisplayName'] = APP_DISPLAY_NAME
    info['CFBundleName'] = APP_DISPLAY_NAME
    info['CFBundleShortVersionString'] = str(version)
    info['CFBundleVersion'] = str(version)
    info['NSHumanReadableCopyright'] = 'Copyright © 老三 · www.577622.xyz'
    with open(info_path, 'wb') as output:
        plistlib.dump(info, output, sort_keys=True)


def _sign_app(app_path):
    identity = str(os.getenv('MACOS_APP_SIGNING_IDENTITY') or '').strip()
    require_signing = _truthy(os.getenv('MACOS_REQUIRE_SIGNING'))
    if not identity:
        if require_signing:
            raise RuntimeError('MACOS_REQUIRE_SIGNING=1，但未配置 MACOS_APP_SIGNING_IDENTITY')
        subprocess.check_call([
            '/usr/bin/codesign', '--force', '--deep', '--sign', '-', app_path,
        ])
        print('未配置 Developer ID，已对 App 使用开发用 ad-hoc 签名。', flush=True)
        return False
    subprocess.check_call([
        '/usr/bin/codesign',
        '--force',
        '--deep',
        '--options', 'runtime',
        '--timestamp',
        '--sign', identity,
        app_path,
    ])
    subprocess.check_call(['/usr/bin/codesign', '--verify', '--deep', '--strict', app_path])
    return True


def _build_pkg(base_dir, app_path, pkg_path, version):
    source_scripts = os.path.join(base_dir, 'install', 'macos', 'scripts')
    with tempfile.TemporaryDirectory(prefix='fuckseats-pkg-scripts-') as temp_dir:
        scripts_dir = os.path.join(temp_dir, 'scripts')
        shutil.copytree(source_scripts, scripts_dir)
        for filename in os.listdir(scripts_dir):
            os.chmod(os.path.join(scripts_dir, filename), 0o755)

        command = [
            '/usr/bin/pkgbuild',
            '--component', app_path,
            '--install-location', '/Applications',
            '--identifier', PKG_IDENTIFIER,
            '--version', str(version),
            '--scripts', scripts_dir,
        ]
        installer_identity = str(os.getenv('MACOS_INSTALLER_SIGNING_IDENTITY') or '').strip()
        if installer_identity:
            command.extend(['--sign', installer_identity])
        elif _truthy(os.getenv('MACOS_REQUIRE_SIGNING')):
            raise RuntimeError('MACOS_REQUIRE_SIGNING=1，但未配置 MACOS_INSTALLER_SIGNING_IDENTITY')
        command.append(pkg_path)
        subprocess.check_call(command)

    if str(os.getenv('MACOS_INSTALLER_SIGNING_IDENTITY') or '').strip():
        subprocess.check_call(['/usr/sbin/pkgutil', '--check-signature', pkg_path])


def _notarize_and_staple(paths):
    profile = str(os.getenv('MACOS_NOTARY_PROFILE') or '').strip()
    apple_id = str(os.getenv('MACOS_NOTARY_APPLE_ID') or '').strip()
    password = str(os.getenv('MACOS_NOTARY_PASSWORD') or '').strip()
    team_id = str(os.getenv('MACOS_NOTARY_TEAM_ID') or '').strip()
    credentials = []
    if profile:
        credentials = ['--keychain-profile', profile]
    elif apple_id and password and team_id:
        credentials = [
            '--apple-id', apple_id,
            '--password', password,
            '--team-id', team_id,
        ]
    elif _truthy(os.getenv('MACOS_REQUIRE_NOTARIZATION')):
        raise RuntimeError(
            '要求公证，但未配置 MACOS_NOTARY_PROFILE，且 Apple ID 公证凭据不完整'
        )
    else:
        return
    for path in paths:
        subprocess.check_call([
            '/usr/bin/xcrun', 'notarytool', 'submit', path,
            *credentials,
            '--wait',
        ])
        subprocess.check_call(['/usr/bin/xcrun', 'stapler', 'staple', path])


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
    dmg_path = os.path.join(artifacts_dir, f'{ARTIFACT_PREFIX}_v{safe_version}_macos.dmg')
    pkg_path = os.path.join(artifacts_dir, f'{ARTIFACT_PREFIX}_v{safe_version}_macos.pkg')

    print(f'开始构建 macOS 版本: {version}', flush=True)
    package_env = os.environ.copy()
    package_env['FUCKSEATS_APP_VERSION'] = version
    subprocess.check_call([sys.executable, 'package.py'], cwd=base_dir, env=package_env)

    app_bundle_path = _find_app_bundle(base_dir)
    if not app_bundle_path:
        print('未找到 PyInstaller 生成的 .app 产物。', file=sys.stderr, flush=True)
        sys.exit(1)

    if os.path.exists(stage_dir):
        shutil.rmtree(stage_dir)
    if os.path.exists(dmg_path):
        os.remove(dmg_path)
    if os.path.exists(pkg_path):
        os.remove(pkg_path)

    os.makedirs(stage_dir, exist_ok=True)
    os.makedirs(artifacts_dir, exist_ok=True)
    shutil.copytree(app_bundle_path, staged_app_path, symlinks=True)
    _configure_app_info(staged_app_path, version)
    _sign_app(staged_app_path)
    _build_pkg(base_dir, staged_app_path, pkg_path, version)

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

    _notarize_and_staple([pkg_path, dmg_path])

    print(f'macOS DMG 产物位置: {dmg_path}', flush=True)
    print(f'macOS PKG 升级包位置: {pkg_path}', flush=True)


if __name__ == '__main__':
    main()
