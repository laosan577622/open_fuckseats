"""通过 Pan 获取短期签名，将文件内容直接上传至 OBS，再登记下载链接。"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlencode, urlsplit


PAN_API_URL = 'https://pan.577622.xyz/api.php'
PAN_BASE_URL = 'https://pan.577622.xyz'


def _https(url):
    parsed = urlsplit(str(url))
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise RuntimeError('上传地址必须使用 HTTPS 且不能包含登录凭据或片段')
    return parsed


def _safe_error(message):
    key = os.environ.get('PAN_UPLOAD_KEY', '')
    if key:
        message = message.replace(key, '<redacted>')
    return re.sub(r'https://[^\s"<>]+', '[上传地址]', message)


def _curl(args, *, data=None, timeout=30):
    result = subprocess.run([
        'curl', '--silent', '--show-error', '--proto', '=https', '--proto-redir', '=https',
        '--connect-timeout', '20', '--max-time', str(timeout),
        '--write-out', '\nHTTP_STATUS:%{http_code}', *args,
    ], input=data, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout + 10, check=False)
    if result.returncode:
        raise RuntimeError(_safe_error(f'上传连接失败：{result.stderr.strip()}'))
    body, marker, status = result.stdout.rpartition('\nHTTP_STATUS:')
    if not marker or not status.strip().isdigit():
        raise RuntimeError('上传服务未返回 HTTP 状态码')
    return int(status.strip()), body.strip()


def _api(fields, api_url, ca_path):
    _https(api_url)
    args = ['--request', 'POST', '--header', 'Content-Type: application/x-www-form-urlencoded', '--data-binary', '@-']
    if ca_path:
        args.extend(['--cacert', str(ca_path)])
    data = urlencode({'key': os.environ['PAN_UPLOAD_KEY'], 'format': 'json', **fields})
    last_error = None
    for attempt in range(4):
        try:
            status, body = _curl([*args, api_url], data=data)
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            last_error = error
        else:
            if not 200 <= status < 300:
                if status < 500 and status != 429:
                    raise RuntimeError(f'网盘接口 HTTP {status}')
                last_error = RuntimeError(f'网盘接口 HTTP {status}')
            else:
                try:
                    result = json.loads(body)
                except ValueError as error:
                    raise RuntimeError('网盘接口未返回有效 JSON') from error
                if not isinstance(result, dict):
                    raise RuntimeError('网盘接口响应格式无效')
                if str(result.get('code')) == '0':
                    return result
                message = _safe_error(str(result.get('msg') or '未知错误'))
                if not result.get('retryable'):
                    raise RuntimeError(f'网盘直传失败：{message}')
                last_error = RuntimeError(f'网盘直传失败：{message}')
        if attempt < 3:
            time.sleep(2 ** attempt)
    raise RuntimeError(_safe_error(str(last_error))) from last_error


def _config_value(value):
    value = str(value)
    if '\r' in value or '\n' in value or '\x00' in value:
        raise RuntimeError('直传参数包含无效字符')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def _upload_obs(upload, asset, md5):
    if not isinstance(upload, dict) or upload.get('method') != 'PUT':
        raise RuntimeError('网盘未返回有效的 OBS PUT 直传参数')
    parsed = _https(upload.get('url', ''))
    if not parsed.hostname.endswith('.myhuaweicloud.com'):
        raise RuntimeError('直传地址不是华为云 OBS 地址')
    headers = upload.get('headers')
    if not isinstance(headers, dict) or len(headers) > 20:
        raise RuntimeError('直传请求头无效')
    normalized = {str(key).lower(): str(value) for key, value in headers.items()}
    if normalized.get('content-md5') != base64.b64encode(bytes.fromhex(md5)).decode('ascii'):
        raise RuntimeError('直传签名中的 MD5 与安装包不一致')
    if any(not re.fullmatch(r'[A-Za-z0-9-]+', str(key)) for key in headers):
        raise RuntimeError('直传请求头名称无效')
    # 签名 URL 与请求头通过 stdin 传入，避免出现在进程命令行或日志中。
    config = 'url = ' + _config_value(upload['url']) + '\n'
    for key, value in headers.items():
        config += 'header = ' + _config_value(f'{key}: {value}') + '\n'
    config += 'header = "Expect:"\n'
    status, _ = _curl([
        '--config', '-', '--request', 'PUT', '--upload-file', str(asset),
        '--retry', '2', '--retry-all-errors', '--retry-max-time', '1700',
    ], data=config, timeout=1800)
    if not 200 <= status < 300:
        raise RuntimeError(f'OBS 直传 HTTP {status}')


def upload_pan(asset, filename, *, expected_md5=None, ca_path=None, api_url=None):
    if not os.environ.get('PAN_UPLOAD_KEY', '').strip():
        raise RuntimeError('缺少 PAN_UPLOAD_KEY')
    asset = Path(asset)
    if asset.is_symlink() or not asset.is_file():
        raise RuntimeError('上传文件不存在或是符号链接')
    if Path(filename).name != filename or not re.fullmatch(r'[A-Za-z0-9._-]+', filename):
        raise RuntimeError('发布上传文件名无效')
    digest = hashlib.md5()
    with asset.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    md5 = digest.hexdigest()
    if expected_md5 is not None and md5 != expected_md5:
        raise RuntimeError('上传前文件 MD5 已变化')
    size = asset.stat().st_size
    api_url = api_url or os.environ.get('PAN_UPLOAD_API_URL') or PAN_API_URL
    prepared = _api({'action': 'prepare', 'name': filename, 'hash': md5, 'size': size, 'show': 0}, api_url, ca_path)
    if prepared.get('exists'):
        completed = prepared
    else:
        if not isinstance(prepared.get('token'), str) or not prepared['token'] or prepared.get('hash') != md5:
            raise RuntimeError('网盘返回的直传凭据无效')
        _upload_obs(prepared.get('upload'), asset.resolve(), md5)
        completed = _api({'action': 'complete', 'token': prepared['token']}, api_url, ca_path)
    if completed.get('hash') != md5 or completed.get('size') != size:
        raise RuntimeError('网盘登记的文件指纹或大小不一致')
    returned = _https(completed.get('downurl', ''))
    expected_path = f'/down.php/{md5}{Path(filename).suffix.lower()}'
    if returned.path != expected_path or returned.query:
        raise RuntimeError('网盘下载地址与文件指纹不一致')
    return PAN_BASE_URL + expected_path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('asset')
    parser.add_argument('--filename', required=True)
    parser.add_argument('--expected-md5')
    parser.add_argument('--ca-path')
    args = parser.parse_args(argv)
    try:
        url = upload_pan(args.asset, args.filename, expected_md5=args.expected_md5, ca_path=args.ca_path)
    except (RuntimeError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        parser.exit(1, _safe_error(f'OBS 直传失败：{error}') + '\n')
    print(json.dumps({'code': 0, 'downurl': url}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
