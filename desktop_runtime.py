import ctypes
import hashlib
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


APP_NAME = "不想排座位"
MACOS_PACKAGE_IDENTIFIER = "xyz.577622.fuckseats.pkg"
MAX_LOCAL_UPDATE_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024
DEFAULT_UPDATE_MANIFEST_URL = "https://apps.577622.xyz/api/user_a6d12cebda652894/7h4sjhx0azr/api.json"
MACOS_UPDATE_MANIFEST_URL = "https://apps.577622.xyz/api/user_a6d12cebda652894/pgth9eyr8uf6/api.json"
DEFAULT_UPDATE_DETAILS_URL = "https://apps.577622.xyz/api/user_a6d12cebda652894/7h4sjhx0azr/update.txt"
MACOS_UPDATE_DETAILS_URL = "https://apps.577622.xyz/api/user_a6d12cebda652894/pgth9eyr8uf6/update.txt"
OFFICIAL_RELEASE_API_URL = "https://api.github.com/repos/laosan577622/open_fuckseats/releases/tags/v{}"
MAX_UPDATE_JSON_BYTES = 1024 * 1024
LOCAL_RELEASE_MANIFEST_RELATIVE_PATHS = (
    ("runtime", "release.json"),
    ("website", "public", "api.json"),
)
DEFAULT_WINDOWS_INSTALLER_ARGS = (
    "/SP- /NORESTART"
)
DOWNLOAD_CHUNK_SIZE = 1024 * 128
VERSION_RE = re.compile(
    r"v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
)
STABLE_VERSION_RE = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)")
BLOCKED_INSTALLER_FLAG_RE = re.compile(
    r"(?i)(?:^|\s)/(?:verysilent|silent|suppressmsgboxes|closeapplications|forcecloseapplications)(?=\s|$)"
)
UPDATE_STATE_LOCK = threading.Lock()
UPDATE_THREAD_LOCK = threading.RLock()
UPDATE_THREAD = None
PREPARED_INSTALLER_PATH = ""
UPDATE_STATE = {
    "state": "idle",
    "message": "",
    "current_version": "0.0.0",
    "target_version": "",
    "latest_version": "",
    "download_url": "",
    "notes": "",
    "published_at": "",
    "mode": "remote_download",
    "package_path": "",
    "package_sha256": "",
    "package_size": 0,
    "signature": "",
    "progress": {
        "received_bytes": 0,
        "total_bytes": 0,
        "percent": None,
    },
    "last_error": "",
}


def is_windows():
    return sys.platform.startswith("win")


def is_macos():
    return sys.platform == "darwin"


def get_platform_name():
    override = (os.getenv("FUCKSEATS_APP_PLATFORM") or "").strip().lower()
    if override in {"windows", "macos", "linux"}:
        return override
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return "linux"


def is_update_api_supported():
    if not (is_windows() or is_macos()):
        return False
    return (os.getenv("FUCKSEATS_APP_SHELL") or "").strip().lower() == "webview"


def _unique_paths(paths):
    unique = []
    seen = set()
    for item in paths:
        if not item:
            continue
        path = Path(item).resolve()
        key = str(path).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def iter_runtime_roots():
    candidates = []

    env_root = (os.getenv("FUCKSEATS_RUNTIME_ROOT") or "").strip()
    if env_root:
        candidates.append(env_root)

    meipass = getattr(sys, "_MEIPASS", "")
    if meipass:
        candidates.append(meipass)

    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).resolve().parent)

    candidates.append(Path(__file__).resolve().parent)
    candidates.append(Path.cwd())

    return _unique_paths(candidates)


def resolve_release_manifest_path(path=None):
    if path:
        return Path(path).resolve()

    for root in iter_runtime_roots():
        for relative_path in LOCAL_RELEASE_MANIFEST_RELATIVE_PATHS:
            candidate = root.joinpath(*relative_path)
            if candidate.exists():
                return candidate

    return iter_runtime_roots()[0].joinpath(*LOCAL_RELEASE_MANIFEST_RELATIVE_PATHS[0])


def load_release_manifest(path=None):
    manifest_path = resolve_release_manifest_path(path)
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def get_current_version():
    env_version = (os.getenv("FUCKSEATS_APP_VERSION") or "").strip()
    if env_version:
        return env_version

    manifest = load_release_manifest()
    return str(manifest.get("version") or "0.0.0").strip() or "0.0.0"


def _parse_version_parts(value):
    matched = VERSION_RE.fullmatch(str(value or "").strip())
    if not matched:
        raise ValueError("版本号格式无效")
    return [int(item) for item in matched[1].split(".")], matched[2]


def compare_versions(left, right):
    left_parts, left_pre = _parse_version_parts(left)
    right_parts, right_pre = _parse_version_parts(right)
    length = max(len(left_parts), len(right_parts))
    left_parts.extend([0] * (length - len(left_parts)))
    right_parts.extend([0] * (length - len(right_parts)))

    if left_parts < right_parts:
        return -1
    if left_parts > right_parts:
        return 1
    if left_pre == right_pre:
        return 0
    if left_pre is None:
        return 1
    if right_pre is None:
        return -1
    left_ids, right_ids = left_pre.split("."), right_pre.split(".")
    for left_id, right_id in zip(left_ids, right_ids):
        if left_id == right_id:
            continue
        if left_id.isdigit() and right_id.isdigit():
            return (int(left_id) > int(right_id)) - (int(left_id) < int(right_id))
        if left_id.isdigit() != right_id.isdigit():
            return -1 if left_id.isdigit() else 1
        return 1 if left_id > right_id else -1
    return (len(left_ids) > len(right_ids)) - (len(left_ids) < len(right_ids))


def is_newer_version(candidate, current):
    return compare_versions(candidate, current) > 0


def get_update_manifest_url():
    configured = (os.getenv("FUCKSEATS_UPDATE_MANIFEST_URL") or "").strip()
    return configured or (MACOS_UPDATE_MANIFEST_URL if is_macos() else DEFAULT_UPDATE_MANIFEST_URL)


def get_update_details_url():
    return MACOS_UPDATE_DETAILS_URL if is_macos() else DEFAULT_UPDATE_DETAILS_URL


def build_cache_safe_version(version):
    value = re.sub(r"[^0-9A-Za-z._-]+", "-", str(version or "").strip()).strip(".-")
    return value or "latest"


def add_cache_busting_query(url):
    parsed = urllib.parse.urlsplit(str(url or "").strip())
    query_items = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query_items.append(("_ts", str(int(time.time()))))
    return urllib.parse.urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urllib.parse.urlencode(query_items),
            parsed.fragment,
        )
    )


def _require_https_url(url):
    parsed = urllib.parse.urlsplit(str(url or "").strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise RuntimeError("更新地址必须使用 HTTPS，且不能包含登录凭据。")


class _UpdateRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        _require_https_url(new_url)
        return super().redirect_request(request, fp, code, message, headers, new_url)


def _create_update_ssl_context():
    try:
        context = ssl.create_default_context()
    except (OSError, ssl.SSLError):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    try:
        import certifi

        context.load_verify_locations(cafile=certifi.where())
    except (ImportError, OSError, ssl.SSLError) as exc:
        if not context.get_ca_certs():
            raise RuntimeError(f"无法加载更新服务的可信根证书：{exc}") from exc
    context.set_alpn_protocols(["http/1.1"])
    return context


def _open_update_url(request, timeout):
    _require_https_url(request.full_url)
    return urllib.request.build_opener(
        _UpdateRedirectHandler(),
        urllib.request.HTTPSHandler(context=_create_update_ssl_context()),
    ).open(request, timeout=timeout)


def _update_request_error(error, url, timeout):
    hostname = urllib.parse.urlsplit(url).hostname or "未知地址"
    reason = getattr(error, "reason", error)
    if isinstance(error, urllib.error.HTTPError):
        description = f"返回 HTTP {error.code}：{reason}"
    elif isinstance(reason, ssl.SSLCertVerificationError):
        detail = getattr(reason, "verify_message", "") or str(reason)
        description = f"HTTPS 证书验证失败：{detail}。请检查系统时间及网络代理证书。"
    elif isinstance(reason, ssl.SSLError):
        description = f"TLS 连接失败：{reason}"
    elif isinstance(reason, TimeoutError):
        description = f"连接超时（{timeout} 秒）：{reason}"
    elif isinstance(reason, socket.gaierror):
        description = f"域名解析失败：{reason}"
    else:
        description = f"无法连接：{reason}"
    return RuntimeError(f"更新服务（{hostname}）{description}")


def fetch_json(url, timeout=8):
    request = urllib.request.Request(
        add_cache_busting_query(url),
        headers={
            "User-Agent": f"FuckSeatsDesktop/{get_current_version()}",
            "Accept": "application/json",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )
    try:
        with _open_update_url(request, timeout=timeout) as response:
            content = response.read(MAX_UPDATE_JSON_BYTES + 1)
    except (urllib.error.URLError, OSError) as exc:
        raise _update_request_error(exc, url, timeout) from exc
    if len(content) > MAX_UPDATE_JSON_BYTES:
        raise RuntimeError("远程更新清单过大。")
    try:
        payload = content.decode("utf-8-sig")
        return json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        hostname = urllib.parse.urlsplit(url).hostname or "未知地址"
        if content.lstrip().startswith(b"<"):
            raise RuntimeError(f"更新服务（{hostname}）返回了 HTML 页面，可能被访问规则拦截或服务异常。") from exc
        raise RuntimeError(f"更新服务（{hostname}）返回的 JSON 格式无效：{exc}") from exc


def _build_progress_payload(received_bytes=0, total_bytes=0):
    received_bytes = max(0, int(received_bytes or 0))
    total_bytes = max(0, int(total_bytes or 0))
    percent = None
    if total_bytes > 0:
        percent = int((received_bytes / total_bytes) * 100)
    return {
        "received_bytes": received_bytes,
        "total_bytes": total_bytes,
        "percent": percent,
    }


def _update_state(**kwargs):
    with UPDATE_STATE_LOCK:
        if "progress" in kwargs and kwargs["progress"] is not None:
            progress = kwargs.pop("progress")
            UPDATE_STATE["progress"] = _build_progress_payload(
                progress.get("received_bytes", 0),
                progress.get("total_bytes", 0),
            )
        for key, value in kwargs.items():
            UPDATE_STATE[key] = value
        UPDATE_STATE["current_version"] = get_current_version()


def get_update_status():
    with UPDATE_STATE_LOCK:
        payload = dict(UPDATE_STATE)
        payload["progress"] = dict(UPDATE_STATE.get("progress") or {})
    payload["current_version"] = get_current_version()
    payload["platform"] = get_platform_name()
    payload["supported"] = is_update_api_supported()
    payload["network_used"] = payload["mode"] == "remote_download"
    return payload


def _set_prepared_installer_path(path=""):
    global PREPARED_INSTALLER_PATH
    resolved = ""
    if path:
        resolved = str(Path(path).resolve())
    with UPDATE_STATE_LOCK:
        PREPARED_INSTALLER_PATH = resolved


def _get_prepared_installer_path():
    with UPDATE_STATE_LOCK:
        return PREPARED_INSTALLER_PATH


def reset_update_state():
    _set_prepared_installer_path("")
    _update_state(
        state="idle",
        message="",
        target_version="",
        latest_version="",
        download_url="",
        notes="",
        published_at="",
        mode="remote_download",
        package_path="",
        package_sha256="",
        package_size=0,
        signature="",
        progress=_build_progress_payload(),
        last_error="",
    )


def download_file(url, destination, timeout=60, progress_callback=None, *, expected_sha256="", expected_size=0):
    _require_https_url(url)
    destination = Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None

    request = urllib.request.Request(
        str(url).strip(),
        headers={
            "User-Agent": f"FuckSeatsDesktop/{get_current_version()}",
            "Cache-Control": "no-cache",
        },
    )
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=destination.parent, prefix=destination.name + ".", suffix=".part", delete=False
        ) as output:
            temp_path = Path(output.name)
            with _open_update_url(request, timeout=timeout) as response:
                if response.status != 200:
                    raise RuntimeError("更新服务器未返回完整安装包。")
                total_bytes = int(response.headers.get("Content-Length") or 0)
                if total_bytes < 0 or total_bytes > MAX_LOCAL_UPDATE_PACKAGE_BYTES:
                    raise RuntimeError("更新安装包大小无效。")
                if expected_size and total_bytes and total_bytes != expected_size:
                    raise RuntimeError("更新安装包大小与发布记录不一致。")
                received_bytes = 0
                digest = hashlib.sha256()
                if callable(progress_callback):
                    progress_callback(0, total_bytes or expected_size)
                while True:
                    chunk = response.read(DOWNLOAD_CHUNK_SIZE)
                    if not chunk:
                        break
                    received_bytes += len(chunk)
                    if received_bytes > (expected_size or MAX_LOCAL_UPDATE_PACKAGE_BYTES):
                        raise RuntimeError("更新安装包超出预期大小。")
                    output.write(chunk)
                    digest.update(chunk)
                    if callable(progress_callback):
                        progress_callback(received_bytes, total_bytes or expected_size)
        if received_bytes <= 0 or (total_bytes and received_bytes != total_bytes):
            raise RuntimeError("更新安装包下载不完整，请重试。")
        if expected_size and received_bytes != expected_size:
            raise RuntimeError("更新安装包大小与发布记录不一致。")
        if expected_sha256 and digest.hexdigest() != expected_sha256:
            raise RuntimeError("更新安装包 SHA-256 校验失败，请重试。")
        temp_path.replace(destination)
        return destination
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def get_windows_update_cache_dir():
    from app_paths import temp_directory

    return temp_directory() / "updates"


def _verify_windows_installer(path, expected_sha256, expected_size=0):
    if not re.fullmatch(r"[0-9a-f]{64}", str(expected_sha256 or "")):
        raise RuntimeError("缺少可信的安装包 SHA-256 校验信息。")
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError("更新安装包不存在或无效。")
    if expected_size and path.stat().st_size != expected_size:
        raise RuntimeError("更新安装包大小与发布记录不一致。")
    with path.open("rb") as source:
        if source.read(2) != b"MZ":
            raise RuntimeError("下载内容不是 Windows 安装程序。")
    if _sha256_file(path) != expected_sha256:
        raise RuntimeError("更新安装包 SHA-256 校验失败，请重新下载。")


def prepare_windows_update_installer(download_url, version, progress_callback=None, *, expected_sha256="", expected_size=0):
    _require_https_url(download_url)
    if not re.fullmatch(r"[0-9a-f]{64}", str(expected_sha256 or "")):
        raise RuntimeError("缺少可信的安装包 SHA-256 校验信息。")
    safe_version = build_cache_safe_version(version)
    cache_dir = (get_windows_update_cache_dir() / safe_version).resolve()
    installer_path = cache_dir / f"FuckSeatsSetup-{safe_version}.exe"
    url_marker = cache_dir / ".download_url"

    if installer_path.exists() or installer_path.is_symlink():
        try:
            _verify_windows_installer(installer_path, expected_sha256, expected_size)
            if callable(progress_callback):
                cached_size = installer_path.stat().st_size
                progress_callback(cached_size, cached_size)
            return installer_path
        except (RuntimeError, OSError):
            installer_path.unlink(missing_ok=True)
            url_marker.unlink(missing_ok=True)

    try:
        result = download_file(
            download_url, installer_path, progress_callback=progress_callback,
            expected_sha256=expected_sha256, expected_size=expected_size,
        )
        _verify_windows_installer(result, expected_sha256, expected_size)
        return result
    except Exception:
        installer_path.unlink(missing_ok=True)
        raise


def is_process_elevated():
    if not is_windows():
        return False
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def shell_execute_windows(verb, executable, parameters="", working_directory=None):
    if not is_windows():
        raise RuntimeError("仅支持在 Windows 环境调用 ShellExecuteW。")

    show_normal = 1
    workdir = str(working_directory or "")
    result = ctypes.windll.shell32.ShellExecuteW(
        None,
        str(verb or ""),
        str(executable),
        str(parameters or ""),
        workdir,
        show_normal,
    )
    code = int(result)
    if code <= 32:
        raise OSError(f"ShellExecuteW 执行失败，错误码：{code}")
    return code


def relaunch_self_as_admin(entry_script, argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)

    if getattr(sys, "frozen", False):
        executable = Path(sys.executable).resolve()
        parameters = subprocess.list2cmdline(argv)
        working_directory = executable.parent
    else:
        executable = Path(sys.executable).resolve()
        script_path = Path(entry_script).resolve()
        parameters = subprocess.list2cmdline([str(script_path), *argv])
        working_directory = script_path.parent

    shell_execute_windows("runas", executable, parameters, working_directory)


def launch_installer_as_admin(installer_path, installer_args=None):
    installer_args = (
        (installer_args or "").strip()
        or (os.getenv("FUCKSEATS_INSTALLER_ARGS") or "").strip()
        or DEFAULT_WINDOWS_INSTALLER_ARGS
    )
    installer_args = BLOCKED_INSTALLER_FLAG_RE.sub(" ", installer_args)
    installer_args = " ".join(installer_args.split())
    shell_execute_windows(
        "runas",
        Path(installer_path).resolve(),
        installer_args,
        Path(installer_path).resolve().parent,
    )


def fetch_remote_release_manifest():
    data = fetch_json(get_update_manifest_url())
    if not isinstance(data, dict):
        raise RuntimeError("远程更新清单格式无效。")
    return data


def _sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _run_checked(command, error_message):
    result = subprocess.run(
        [str(item) for item in command],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part.strip())
    if result.returncode != 0:
        raise RuntimeError(f"{error_message}{f'：{output}' if output else ''}")
    return output


def _allow_unsigned_macos_package():
    return not getattr(sys, "frozen", False) and str(
        os.getenv("FUCKSEATS_MACOS_ALLOW_UNSIGNED_UPDATE") or ""
    ).strip().lower() in {"1", "true", "yes", "on"}


def _expected_macos_team_id():
    configured = str(os.getenv("FUCKSEATS_MACOS_TEAM_ID") or "").strip()
    if configured:
        return configured
    return str(load_release_manifest().get("team_id") or "").strip()


def _inspect_macos_package_metadata(package_path):
    package_path = Path(package_path).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="fuckseats-pkg-inspect-") as temp_root:
        expanded = Path(temp_root) / "expanded"
        _run_checked(
            ["/usr/sbin/pkgutil", "--expand", str(package_path), str(expanded)],
            "无法读取升级包内容",
        )
        package_info_files = list(expanded.rglob("PackageInfo"))
        if not package_info_files:
            raise RuntimeError("升级包缺少 PackageInfo")
        root = ET.parse(package_info_files[0]).getroot()
        identifier = str(root.attrib.get("identifier") or "").strip()
        version = str(root.attrib.get("version") or "").strip()
        if identifier != MACOS_PACKAGE_IDENTIFIER:
            raise RuntimeError("升级包不是不想排座位的官方 macOS 安装包")
        if not version:
            raise RuntimeError("升级包缺少版本号")
        return {"identifier": identifier, "version": version}


def _verify_macos_package_signature(package_path, *, trusted_remote=False):
    expected_team_id = _expected_macos_team_id()
    # 无证书发行包通过官方 Release 的 SHA-256 校验；本地自选包仍须校验签名。
    if trusted_remote and not expected_team_id:
        return "已通过官方发布记录的 SHA-256 校验"
    try:
        signature_output = _run_checked(
            ["/usr/sbin/pkgutil", "--check-signature", str(package_path)],
            "升级包签名校验失败",
        )
        _run_checked(
            ["/usr/sbin/spctl", "--assess", "--type", "install", "--verbose=2", str(package_path)],
            "升级包未通过 macOS 安全检查",
        )
    except RuntimeError:
        if not _allow_unsigned_macos_package():
            raise
        signature_output = "开发模式：允许未签名升级包"
    if expected_team_id and not re.search(r"(?<![A-Za-z0-9])" + re.escape(expected_team_id) + r"(?![A-Za-z0-9])", signature_output):
        raise RuntimeError("升级包签名团队与当前应用不一致")
    return signature_output


def get_macos_update_cache_dir():
    from app_paths import temp_directory

    return temp_directory() / "updates" / "macos"


def _verify_macos_installer(path, version, expected_sha256, expected_size):
    path = Path(path)
    if not re.fullmatch(r"[0-9a-f]{64}", str(expected_sha256 or "")):
        raise RuntimeError("缺少可信的安装包 SHA-256 校验信息。")
    if path.is_symlink() or not path.is_file() or path.stat().st_size != expected_size:
        raise RuntimeError("更新安装包不存在或大小与发布记录不一致。")
    if _sha256_file(path) != expected_sha256:
        raise RuntimeError("更新安装包 SHA-256 校验失败，请重新下载。")
    with path.open("rb") as source:
        if source.read(4) != b"xar!":
            raise RuntimeError("下载内容不是 macOS PKG 安装包。")
    _verify_macos_package_signature(path, trusted_remote=True)
    metadata = _inspect_macos_package_metadata(path)
    if metadata["version"] != version:
        raise RuntimeError("升级包版本与目标版本不一致，请重新检查更新。")


def prepare_macos_update_installer(download_url, version, progress_callback=None, *, expected_sha256="", expected_size=0):
    _require_https_url(download_url)
    if not re.fullmatch(r"[0-9a-f]{64}", str(expected_sha256 or "")) or not 0 < expected_size <= MAX_LOCAL_UPDATE_PACKAGE_BYTES:
        raise RuntimeError("缺少可信的 macOS 安装包校验信息。")
    safe_version = build_cache_safe_version(version)
    cache_dir = get_macos_update_cache_dir() / safe_version
    cache_dir.mkdir(parents=True, exist_ok=True)
    installer_path = cache_dir / f"FuckSeatsSetup-{safe_version}.pkg"
    if installer_path.exists() or installer_path.is_symlink():
        try:
            _verify_macos_installer(installer_path, version, expected_sha256, expected_size)
            if callable(progress_callback):
                progress_callback(expected_size, expected_size)
            return installer_path
        except (RuntimeError, OSError):
            installer_path.unlink(missing_ok=True)
    if shutil.disk_usage(cache_dir).free < expected_size * 3:
        raise RuntimeError("可用磁盘空间不足，至少需要升级包大小的三倍空间")
    try:
        download_file(
            download_url, installer_path, progress_callback=progress_callback,
            expected_sha256=expected_sha256, expected_size=expected_size,
        )
        _verify_macos_installer(installer_path, version, expected_sha256, expected_size)
        return installer_path
    except Exception:
        installer_path.unlink(missing_ok=True)
        raise


def prepare_macos_local_update(package_path):
    if not is_macos():
        raise RuntimeError("本地 PKG 更新仅支持 macOS")
    if not is_update_api_supported():
        raise RuntimeError("请在 macOS 桌面版中选择本地升级包")

    selected = Path(str(package_path or "")).expanduser()
    if selected.is_symlink():
        raise RuntimeError("升级包不能是符号链接")
    try:
        selected = selected.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError("选择的升级包不存在") from exc
    if not selected.is_file() or selected.suffix.lower() != ".pkg":
        raise RuntimeError("请选择 .pkg 格式的 macOS 升级包")
    size = selected.stat().st_size
    if size <= 0 or size > MAX_LOCAL_UPDATE_PACKAGE_BYTES:
        raise RuntimeError("升级包大小无效或超过 2 GB 限制")
    free_bytes = shutil.disk_usage(selected.parent).free
    if free_bytes < size * 3:
        raise RuntimeError("可用磁盘空间不足，至少需要升级包大小的三倍空间")

    signature_output = _verify_macos_package_signature(selected)

    metadata = _inspect_macos_package_metadata(selected)
    current_version = get_current_version()
    if not is_newer_version(metadata["version"], current_version):
        raise ValueError("升级包版本必须高于当前版本")

    package_hash = _sha256_file(selected)
    _set_prepared_installer_path(selected)
    _update_state(
        state="ready_to_install",
        message="本地升级包校验完成",
        mode="local_package",
        target_version=metadata["version"],
        latest_version=metadata["version"],
        download_url="",
        notes="升级包来自本地文件，应用不会从服务器下载安装包。",
        package_path=str(selected),
        package_sha256=package_hash,
        package_size=size,
        signature=signature_output,
        progress=_build_progress_payload(size, size),
        last_error="",
    )
    return get_update_status()


def _normalize_remote_manifest(manifest):
    latest_version = str(manifest.get("version") or "").strip()
    download_url = str(manifest.get("download_url") or "").strip()
    notes = str(manifest.get("notes") or "").strip()
    published_at = str(manifest.get("published_at") or manifest.get("updated_at") or "").strip()

    if not latest_version:
        raise RuntimeError("远程更新清单缺少 version。")
    if not STABLE_VERSION_RE.fullmatch(latest_version):
        raise RuntimeError("远程更新清单必须使用三段数字正式版本号。")
    if not download_url:
        raise RuntimeError("远程更新清单缺少 download_url。")
    _require_https_url(download_url)
    if is_macos() and not urllib.parse.urlsplit(download_url).path.lower().endswith('.pkg'):
        raise RuntimeError("macOS PKG 安装包尚未发布，请稍后重试。")

    package_hash = str(manifest.get("sha256") or "").strip().lower()
    if package_hash and not re.fullmatch(r"[0-9a-f]{64}", package_hash):
        raise RuntimeError("远程更新清单中的 SHA-256 格式无效。")
    try:
        package_size = int(manifest.get("size_bytes") or 0)
    except (ValueError, TypeError) as exc:
        raise RuntimeError("远程更新清单中的安装包大小无效。") from exc
    if package_size < 0 or package_size > MAX_LOCAL_UPDATE_PACKAGE_BYTES:
        raise RuntimeError("远程更新清单中的安装包大小无效。")

    return {
        "latest_version": latest_version,
        "download_url": download_url,
        "notes": notes,
        "published_at": published_at,
        "package_sha256": package_hash,
        "package_size": package_size,
    }


def _resolve_release_integrity(manifest, asset_suffix, *, require_official=False):
    if manifest.get("package_sha256") and not require_official:
        return manifest["package_sha256"], manifest.get("package_size", 0)

    # Older app-service manifests have no digest. GitHub records the SHA-256
    # of the identical installer uploaded by our release workflow.
    version = manifest["latest_version"]
    release = fetch_json(OFFICIAL_RELEASE_API_URL.format(version))
    if not isinstance(release, dict) or release.get("tag_name") != f"v{version}":
        raise RuntimeError("官方发布记录的版本与目标版本不一致。")
    if release.get("draft") or release.get("prerelease"):
        raise RuntimeError("自动更新仅接受已经发布的正式版本。")
    asset_name = f"Fuckseats_v{version}_{asset_suffix}"
    for asset in release.get("assets") or []:
        if not isinstance(asset, dict) or asset.get("name") != asset_name:
            continue
        digest = str(asset.get("digest") or "").removeprefix("sha256:").lower()
        try:
            size = int(asset.get("size") or 0)
        except (ValueError, TypeError):
            break
        if re.fullmatch(r"[0-9a-f]{64}", digest) and 0 < size <= MAX_LOCAL_UPDATE_PACKAGE_BYTES:
            return digest, size
        break
    raise RuntimeError("官方发布记录缺少有效的安装包校验信息，请稍后重试。")


def _resolve_windows_release_integrity(manifest):
    return _resolve_release_integrity(manifest, "windows.exe")


def check_for_updates():
    payload = {
        "platform": get_platform_name(),
        "supported": is_update_api_supported(),
        "current_version": get_current_version(),
        "requires_manual_trigger": True,
        "mode": "remote_download",
    }

    if not payload["supported"]:
        payload["message"] = "当前平台暂不支持自动更新"
        return payload

    manifest = _normalize_remote_manifest(fetch_remote_release_manifest())
    payload.update(manifest)
    payload["update_available"] = is_newer_version(
        manifest["latest_version"],
        payload["current_version"],
    )
    return payload


def _run_manual_update_task(manifest):
    try:
        if is_macos():
            package_hash, package_size = _resolve_release_integrity(manifest, "macos.pkg", require_official=True)
            prepare_installer = prepare_macos_update_installer
        else:
            package_hash, package_size = _resolve_windows_release_integrity(manifest)
            prepare_installer = prepare_windows_update_installer
        def _on_progress(received_bytes, total_bytes):
            _update_state(
                state="downloading",
                message="正在下载更新安装包",
                progress=_build_progress_payload(received_bytes, total_bytes),
            )

        installer_path = prepare_installer(
            manifest["download_url"],
            manifest["latest_version"],
            progress_callback=_on_progress,
            expected_sha256=package_hash,
            expected_size=package_size,
        )
        _set_prepared_installer_path(installer_path)
        _update_state(
            state="ready_to_install",
            message="更新安装包已准备完成，请点击开始安装",
            package_sha256=package_hash,
            package_size=package_size,
            progress=_build_progress_payload(installer_path.stat().st_size, installer_path.stat().st_size),
        )
    except Exception as exc:
        _set_prepared_installer_path("")
        _update_state(
            state="error",
            message=str(exc),
            last_error=str(exc),
        )


def start_manual_update(target_version="", package_path=""):
    with UPDATE_THREAD_LOCK:
        return _start_manual_update(target_version, package_path)


def _start_manual_update(target_version="", package_path=""):
    global UPDATE_THREAD

    if UPDATE_THREAD is not None and UPDATE_THREAD.is_alive():
        return get_update_status()
    if is_macos() and package_path:
        return prepare_macos_local_update(package_path)

    if not is_update_api_supported():
        raise RuntimeError("请在 Windows 或 macOS 桌面版中更新应用。")

    manifest = _normalize_remote_manifest(fetch_remote_release_manifest())
    current_version = get_current_version()
    latest_version = manifest["latest_version"]

    requested_target = str(target_version or "").strip()
    if requested_target and requested_target != latest_version:
        raise ValueError("目标版本与远端最新版本不一致，请重新检查更新。")

    if not is_newer_version(latest_version, current_version):
        _set_prepared_installer_path("")
        _update_state(
            state="up_to_date",
            mode="remote_download",
            message="当前已是最新版本",
            target_version=latest_version,
            latest_version=latest_version,
            download_url=manifest["download_url"],
            notes=manifest["notes"],
            published_at=manifest["published_at"],
            progress=_build_progress_payload(),
            last_error="",
        )
        return get_update_status()

    with UPDATE_THREAD_LOCK:
        if UPDATE_THREAD is not None and UPDATE_THREAD.is_alive():
            return get_update_status()

        _set_prepared_installer_path("")
        _update_state(
            state="downloading",
            mode="remote_download",
            message="已开始下载更新安装包",
            package_sha256="",
            package_size=0,
            target_version=latest_version,
            latest_version=latest_version,
            download_url=manifest["download_url"],
            notes=manifest["notes"],
            published_at=manifest["published_at"],
            progress=_build_progress_payload(),
            last_error="",
        )
        UPDATE_THREAD = threading.Thread(
            target=_run_manual_update_task,
            args=(manifest,),
            daemon=True,
            name="fuckseats-manual-updater",
        )
        UPDATE_THREAD.start()

    return get_update_status()


def launch_prepared_update():
    with UPDATE_THREAD_LOCK:
        return _launch_prepared_update()


def _launch_prepared_update():
    if not is_update_api_supported():
        raise RuntimeError("请在 Windows 或 macOS 桌面版中更新应用。")

    current_status = get_update_status()
    state = str(current_status.get("state") or "").strip().lower()
    installer_path_text = _get_prepared_installer_path()

    if not installer_path_text:
        if state == "downloading":
            raise RuntimeError("更新安装包仍在下载，请稍后再试。")
        if state == "installer_started":
            return current_status
        raise RuntimeError("更新安装包尚未准备完成，请稍后重试。")

    installer_path = Path(installer_path_text).resolve()
    if not installer_path.exists():
        _set_prepared_installer_path("")
        raise RuntimeError("更新安装包不存在，请重新选择升级包。")

    try:
        expected_hash = str(current_status.get("package_sha256") or "")
        if is_macos():
            if not expected_hash or _sha256_file(installer_path) != expected_hash:
                raise RuntimeError("升级包在校验后发生变化，请重新选择")
        else:
            _verify_windows_installer(installer_path, expected_hash, current_status.get("package_size", 0))

        from database_security import backup_database_for_update

        backup_database_for_update(current_status.get("target_version") or "unknown")
        if is_macos():
            subprocess.Popen(["/usr/bin/open", str(installer_path)], close_fds=True)
        else:
            launch_installer_as_admin(installer_path)
        _set_prepared_installer_path("")
        _update_state(
            state="installer_started",
            message="安装器已启动，桌面程序即将退出",
            progress=_build_progress_payload(installer_path.stat().st_size, installer_path.stat().st_size),
            last_error="",
        )
        return get_update_status()
    except Exception as exc:
        _update_state(
            state="error",
            message=str(exc),
            last_error=str(exc),
        )
        raise


reset_update_state()
