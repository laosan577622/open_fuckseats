import ctypes
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path


APP_NAME = "不想排座位"
DEFAULT_UPDATE_MANIFEST_URL = "https://apps.577622.xyz/api/user_a6d12cebda652894/7h4sjhx0azr/api.json"
LOCAL_RELEASE_MANIFEST_RELATIVE_PATHS = (
    ("runtime", "release.json"),
    ("website", "public", "api.json"),
)
DEFAULT_WINDOWS_INSTALLER_ARGS = (
    "/SP- /NORESTART"
)
DOWNLOAD_CHUNK_SIZE = 1024 * 128
VERSION_PART_RE = re.compile(r"\d+")
BLOCKED_INSTALLER_FLAG_RE = re.compile(
    r"(?i)(?:^|\s)/(?:verysilent|silent|suppressmsgboxes|closeapplications|forcecloseapplications)(?=\s|$)"
)
UPDATE_STATE_LOCK = threading.Lock()
UPDATE_THREAD_LOCK = threading.Lock()
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
    "progress": {
        "received_bytes": 0,
        "total_bytes": 0,
        "percent": None,
    },
    "last_error": "",
}


def is_windows():
    return sys.platform.startswith("win")


def get_platform_name():
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return "linux"


def is_update_api_supported():
    if not is_windows():
        return False
    return (os.getenv("FUCKSEATS_APP_SHELL") or "").strip().lower() != "browser"


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
    parts = [int(item) for item in VERSION_PART_RE.findall(str(value or ""))]
    if not parts:
        return [0]
    return parts


def compare_versions(left, right):
    left_parts = _parse_version_parts(left)
    right_parts = _parse_version_parts(right)
    length = max(len(left_parts), len(right_parts))
    left_parts.extend([0] * (length - len(left_parts)))
    right_parts.extend([0] * (length - len(right_parts)))

    if left_parts < right_parts:
        return -1
    if left_parts > right_parts:
        return 1
    return 0


def is_newer_version(candidate, current):
    return compare_versions(candidate, current) > 0


def get_update_manifest_url():
    configured = (os.getenv("FUCKSEATS_UPDATE_MANIFEST_URL") or "").strip()
    return configured or DEFAULT_UPDATE_MANIFEST_URL


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
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload)


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
        progress=_build_progress_payload(),
        last_error="",
    )


def download_file(url, destination, timeout=60, progress_callback=None):
    destination = Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_suffix(destination.suffix + ".part")

    request = urllib.request.Request(
        add_cache_busting_query(str(url or "").strip()),
        headers={
            "User-Agent": f"FuckSeatsDesktop/{get_current_version()}",
            "Cache-Control": "no-cache",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        total_bytes = int(response.headers.get("Content-Length") or 0)
        received_bytes = 0
        if callable(progress_callback):
            progress_callback(received_bytes, total_bytes)
        with temp_path.open("wb") as output:
            while True:
                chunk = response.read(DOWNLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                output.write(chunk)
                received_bytes += len(chunk)
                if callable(progress_callback):
                    progress_callback(received_bytes, total_bytes)

    if not temp_path.exists() or temp_path.stat().st_size <= 0:
        raise RuntimeError("更新安装包下载失败，未获取到有效内容。")

    temp_path.replace(destination)
    return destination


def get_windows_update_cache_dir():
    return Path(tempfile.gettempdir()).resolve() / "fuckseats-updater"


def prepare_windows_update_installer(download_url, version, progress_callback=None):
    safe_version = build_cache_safe_version(version)
    cache_dir = get_windows_update_cache_dir() / safe_version
    installer_path = cache_dir / f"FuckSeatsSetup-{safe_version}.exe"
    url_marker = cache_dir / ".download_url"

    if installer_path.exists() and installer_path.stat().st_size > 0:
        cached_url = ""
        if url_marker.exists():
            cached_url = url_marker.read_text(encoding="utf-8").strip()
        if cached_url == download_url:
            if callable(progress_callback):
                cached_size = installer_path.stat().st_size
                progress_callback(cached_size, cached_size)
            return installer_path
        installer_path.unlink(missing_ok=True)

    result = download_file(download_url, installer_path, progress_callback=progress_callback)
    cache_dir.mkdir(parents=True, exist_ok=True)
    url_marker.write_text(download_url, encoding="utf-8")
    return result


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


def _normalize_remote_manifest(manifest):
    latest_version = str(manifest.get("version") or "").strip()
    download_url = str(manifest.get("download_url") or "").strip()
    notes = str(manifest.get("notes") or "").strip()
    published_at = str(manifest.get("published_at") or "").strip()

    if not latest_version:
        raise RuntimeError("远程更新清单缺少 version。")
    if not download_url:
        raise RuntimeError("远程更新清单缺少 download_url。")

    return {
        "latest_version": latest_version,
        "download_url": download_url,
        "notes": notes,
        "published_at": published_at,
    }


def check_for_updates():
    payload = {
        "platform": get_platform_name(),
        "supported": is_update_api_supported(),
        "current_version": get_current_version(),
        "requires_manual_trigger": True,
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
        def _on_progress(received_bytes, total_bytes):
            _update_state(
                state="downloading",
                message="正在下载更新安装包",
                progress=_build_progress_payload(received_bytes, total_bytes),
            )

        installer_path = prepare_windows_update_installer(
            manifest["download_url"],
            manifest["latest_version"],
            progress_callback=_on_progress,
        )
        _set_prepared_installer_path(installer_path)
        _update_state(
            state="ready_to_install",
            message="更新安装包已准备完成，请点击开始安装",
            progress=_build_progress_payload(installer_path.stat().st_size, installer_path.stat().st_size),
        )
    except Exception as exc:
        _set_prepared_installer_path("")
        _update_state(
            state="error",
            message=str(exc),
            last_error=str(exc),
        )


def start_manual_update(target_version=""):
    global UPDATE_THREAD

    if not is_update_api_supported():
        raise RuntimeError("仅 Windows 桌面端支持自动更新。")

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
            message="已开始下载更新安装包",
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
    if not is_update_api_supported():
        raise RuntimeError("仅 Windows 桌面端支持自动更新。")

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
        raise RuntimeError("更新安装包不存在，请重新下载更新。")

    try:
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
