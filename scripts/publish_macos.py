"""将已构建的 macOS PKG 发布到网盘和应用市场；凭证仅从 CI 环境读取。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib.parse import urlsplit, urlunsplit


APP_ID = 'pgth9eyr8uf6'
MANIFEST_URL = f'https://apps.577622.xyz/api/user_a6d12cebda652894/{APP_ID}/api.json'
RELEASE_URL = f'https://apps.577622.xyz/api/v1/external/apps/{APP_ID}/release/'
PAN_BASE_URL = 'https://pan.577622.xyz'
VERSION_RE = re.compile(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)')


def _version(value):
    value = str(value or '')
    if not VERSION_RE.fullmatch(value):
        raise RuntimeError('发布版本必须是三段数字正式版本号')
    return tuple(map(int, value.split('.')))


def _https(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise RuntimeError('发布地址必须使用 HTTPS，且不能包含登录凭据')
    return parsed


def _safe_error(message):
    for name in ('PAN_UPLOAD_KEY', 'MACOS_APPS_RELEASE_TOKEN', 'GH_TOKEN'):
        if os.environ.get(name):
            message = message.replace(os.environ[name], '<redacted>')
    return message


def _curl(args, *, data=None, timeout=1800):
    result = subprocess.run([
        'curl', '--silent', '--show-error', '--proto', '=https', '--proto-redir', '=https',
        '--connect-timeout', '30', '--max-time', str(timeout),
        '--write-out', '\nHTTP_STATUS:%{http_code}', *args,
    ], input=data, capture_output=True, text=True, timeout=timeout + 10, check=False)
    if result.returncode:
        raise RuntimeError(_safe_error(f'发布请求失败：{result.stderr.strip()}'))
    body, separator, status = result.stdout.rpartition('\nHTTP_STATUS:')
    if not separator or not status.strip().isdigit():
        raise RuntimeError('发布服务未返回 HTTP 状态码')
    return int(status.strip()), body.strip()


def _json_response(status, body):
    if not 200 <= status < 300:
        raise RuntimeError(_safe_error(f'发布服务 HTTP {status}：{body[:1000]}'))
    try:
        result = json.loads(body)
    except ValueError as exc:
        raise RuntimeError('发布服务未返回有效 JSON') from exc
    if not isinstance(result, dict):
        raise RuntimeError('发布服务响应格式无效')
    return result


def _published_manifest():
    return _json_response(*_curl([f'{MANIFEST_URL}?_ts={time.time_ns()}'], timeout=30))


def _official_asset(version, digest, size):
    repo = os.environ.get('PUBLIC_RELEASE_REPOSITORY') or 'laosan577622/open_fuckseats'
    result = subprocess.run(
        ['gh', 'api', f'repos/{repo}/releases/tags/v{version}'],
        capture_output=True, text=True, timeout=60, check=False,
    )
    if result.returncode:
        raise RuntimeError('无法读取 GitHub 官方发布记录')
    release = json.loads(result.stdout)
    if release.get('tag_name') != f'v{version}' or release.get('draft') or release.get('prerelease'):
        raise RuntimeError('官方发布记录不是目标正式版本')
    assets = [item for item in release.get('assets', []) if item.get('name') == f'Fuckseats_v{version}_macos.pkg']
    if len(assets) != 1 or assets[0].get('digest') != f'sha256:{digest}' or assets[0].get('size') != size:
        raise RuntimeError('网盘上传包的 SHA-256 或大小与官方发布记录不一致')


def _upload_pan(asset, version, md5, ca_path=None):
    upload_url = os.environ.get('PAN_UPLOAD_API_URL') or f'{PAN_BASE_URL}/api.php'
    parsed = _https(upload_url)
    tls_args = []
    if parsed.hostname == 'pan.577622.xyz':
        # 保留公开域名的 Host/SNI 与证书校验，直连上传源站以避开 CDN 大文件限制。
        tls_args = ['--connect-to', 'pan.577622.xyz:443:no-cf-pan.577622.xyz:443']
    if ca_path:
        tls_args.extend(['--cacert', str(ca_path)])
    expected_url = f'{PAN_BASE_URL}/down.php/{md5}.pkg'
    status, body = _curl([
        *tls_args, '--form-string', f'key={os.environ["PAN_UPLOAD_KEY"]}',
        '--form-string', 'show=0', '--form-string', 'format=json',
        '--form', f'file=@{asset};filename=FuckSeats-macOS-{version}.pkg;type=application/octet-stream',
        upload_url,
    ])
    if status == 524:
        for _ in range(12):
            time.sleep(10)
            check_status, _ = _curl(['--head', '--location', expected_url], timeout=30)
            if 200 <= check_status < 300:
                return expected_url
        raise RuntimeError('网盘上传超时，且未找到上传后的 PKG')
    result = _json_response(status, body)
    if str(result.get('code')) != '0':
        raise RuntimeError(_safe_error(f'网盘上传失败：{result.get("msg", "未知错误")}'))
    returned = _https(str(result.get('downurl') or ''))
    if returned.path != urlsplit(expected_url).path:
        raise RuntimeError('网盘返回地址与上传包的文件指纹不一致')
    return urlunsplit(('https', 'pan.577622.xyz', returned.path, returned.query, ''))


def publish(version, asset, notes_path):
    requested_version = _version(version)
    for name in ('PAN_UPLOAD_KEY', 'MACOS_APPS_RELEASE_TOKEN'):
        if not os.environ.get(name, '').strip():
            raise RuntimeError(f'缺少发布凭证：{name}')
    asset = Path(asset)
    if asset.is_symlink() or not asset.is_file() or asset.suffix.lower() != '.pkg':
        raise RuntimeError('请提供已构建的 macOS PKG')
    notes = Path(notes_path).read_text(encoding='utf-8-sig').strip()
    sha256, md5 = hashlib.sha256(), hashlib.md5()
    with asset.open('rb') as source:
        if source.read(4) != b'xar!':
            raise RuntimeError('发布文件不是 macOS PKG')
        source.seek(0)
        while chunk := source.read(1024 * 1024):
            sha256.update(chunk)
            md5.update(chunk)
    size = asset.stat().st_size
    _official_asset(version, sha256.hexdigest(), size)
    published = _published_manifest()
    if _version(published.get('version')) > requested_version:
        raise RuntimeError('Refusing to replace a newer published version')
    with tempfile.TemporaryDirectory(prefix='fuckseats-pan-') as directory:
        ca_path = None
        if os.environ.get('PAN_UPLOAD_CA_PEM', '').strip():
            ca_path = Path(directory) / 'pan-ca.pem'
            ca_path.write_text(os.environ['PAN_UPLOAD_CA_PEM'], encoding='utf-8')
        download_url = _upload_pan(asset.resolve(), version, md5.hexdigest(), ca_path)
    # Windows 与 macOS 工作并行，发布前再次检查各自应用的版本。
    if _version(_published_manifest().get('version')) > requested_version:
        raise RuntimeError('Refusing to replace a newer published version')
    payload = {
        'version': version,
        'download_url': download_url,
        'size': f'{size / (1024 * 1024):.1f} MB',
        'update_text': f'version={version}\nurl={download_url}\n\n{notes}',
    }
    response = _json_response(*_curl([
        '--request', 'POST', RELEASE_URL,
        '--header', f'Authorization: Bearer {os.environ["MACOS_APPS_RELEASE_TOKEN"]}',
        '--header', 'Content-Type: application/json', '--data-binary', '@-',
    ], data=json.dumps(payload, ensure_ascii=False), timeout=60))
    if response.get('success') is False or response.get('status') == 'error':
        raise RuntimeError('应用市场拒绝了发布请求')
    for attempt in range(6):
        visible = _published_manifest()
        if visible.get('version') == version and visible.get('download_url') == download_url:
            print(f'macOS {version} 已发布：{download_url}')
            return payload
        if attempt < 5:
            time.sleep(2)
    raise RuntimeError('发布请求已提交，但公开下载接口尚未返回目标版本和地址')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version')
    parser.add_argument('asset', help='与 GitHub Release 中一致的 PKG')
    parser.add_argument('--notes', default='update.txt')
    args = parser.parse_args(argv)
    try:
        publish(args.version, args.asset, args.notes)
    except (RuntimeError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f'发布失败：{_safe_error(str(exc))}')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
