"""Cross-platform runtime paths for application data and read-only resources."""

from __future__ import annotations

import os
import sys
from pathlib import Path


APP_BUNDLE_ID = "xyz.577622.fuckseats"
APP_DATA_DIR_NAME = "FuckSeats"
PROJECT_ROOT = Path(__file__).resolve().parent


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def resource_root() -> Path:
    meipass = str(getattr(sys, "_MEIPASS", "") or "").strip()
    if meipass:
        return Path(meipass).resolve()
    return PROJECT_ROOT


def _is_truthy(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def user_data_root() -> Path:
    explicit = str(os.getenv("FUCKSEATS_DATA_DIR") or "").strip()
    if explicit:
        return Path(explicit).expanduser().resolve()

    # Source checkouts keep their existing repository-local database unless the
    # caller explicitly requests the installed-app layout.
    if not is_frozen() and not _is_truthy(os.getenv("FUCKSEATS_USE_USER_DATA")):
        return PROJECT_ROOT

    if sys.platform == "darwin":
        return (Path.home() / "Library" / "Application Support" / APP_BUNDLE_ID).resolve()
    if sys.platform.startswith("win"):
        local_app_data = str(os.getenv("LOCALAPPDATA") or "").strip()
        base = Path(local_app_data).expanduser() if local_app_data else Path.home() / "AppData" / "Local"
        return (base / APP_DATA_DIR_NAME).resolve()

    xdg_data_home = str(os.getenv("XDG_DATA_HOME") or "").strip()
    base = Path(xdg_data_home).expanduser() if xdg_data_home else Path.home() / ".local" / "share"
    return (base / APP_BUNDLE_ID).resolve()


def uses_installed_data_layout() -> bool:
    return user_data_root() != PROJECT_ROOT


def ensure_private_directory(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    try:
        path.chmod(0o700)
    except OSError:
        pass
    return path


def data_directory() -> Path:
    root = user_data_root()
    if root == PROJECT_ROOT:
        return root
    return ensure_private_directory(root / "data")


def database_path() -> Path:
    explicit = str(os.getenv("FUCKSEATS_DATABASE_PATH") or "").strip()
    if explicit:
        path = Path(explicit).expanduser().resolve()
        ensure_private_directory(path.parent)
        return path
    return data_directory() / "db.sqlite3"


def runtime_state_root() -> Path:
    """Return a writable root for non-database runtime artifacts.

    Source checkouts retain the historical repository-local ``db.sqlite3``,
    but locks, backups and temporary imports live in a dedicated ignored
    directory so tests and development runs never pollute the source tree.
    """
    root = user_data_root()
    if root == PROJECT_ROOT:
        root = PROJECT_ROOT / ".runtime"
    return ensure_private_directory(root)


def backups_directory() -> Path:
    return ensure_private_directory(runtime_state_root() / "backups")


def state_directory() -> Path:
    return ensure_private_directory(runtime_state_root() / "state")


def locks_directory() -> Path:
    return ensure_private_directory(runtime_state_root() / "locks")


def temp_directory() -> Path:
    return ensure_private_directory(runtime_state_root() / "temp")


def user_plugins_directory() -> Path:
    return ensure_private_directory(user_data_root() / "plugins")


def bundled_plugins_directory() -> Path:
    return resource_root() / "plugins"


def plugin_directories() -> list[str]:
    directories: list[Path] = []
    bundled = bundled_plugins_directory()
    if bundled.exists():
        directories.append(bundled)
    if uses_installed_data_layout():
        directories.append(user_plugins_directory())
    unique: list[str] = []
    seen: set[str] = set()
    for directory in directories:
        key = str(directory.resolve()).lower()
        if key not in seen:
            seen.add(key)
            unique.append(str(directory.resolve()))
    return unique


def legacy_database_candidates() -> list[Path]:
    if (
        os.getenv("FUCKSEATS_DATA_DIR")
        and not _is_truthy(os.getenv("FUCKSEATS_MIGRATE_LEGACY_DATABASE"))
    ):
        return []
    target = database_path().resolve()
    candidates = [
        PROJECT_ROOT / "db.sqlite3",
        resource_root() / "db.sqlite3",
        resource_root().parent / "db.sqlite3",
    ]
    if is_frozen():
        candidates.extend(
            [
                Path(sys.executable).resolve().parent / "db.sqlite3",
                Path(sys.executable).resolve().parent.parent / "Resources" / "db.sqlite3",
                Path(sys.executable).resolve().parent.parent / "Frameworks" / "db.sqlite3",
            ]
        )

    unique: list[Path] = []
    seen: set[str] = {str(target).lower()}
    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        key = str(resolved).lower()
        if key not in seen:
            seen.add(key)
            unique.append(resolved)
    return unique
