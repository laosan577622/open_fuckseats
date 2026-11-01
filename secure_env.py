"""限制发布版的调试与更新来源覆盖，保留源码调试配置。"""

import os

from app_paths import is_frozen


PACKAGED_ENV_OVERRIDES = frozenset({
    'DJANGO_SETTINGS_MODULE',
    'FUCKSEATS_APP_SHELL',
    'FUCKSEATS_APP_VERSION',
    'FUCKSEATS_APP_PLATFORM',
    'FUCKSEATS_RUNTIME_ROOT',
    'FUCKSEATS_UPDATE_MANIFEST_URL',
    'FUCKSEATS_MACOS_ALLOW_UNSIGNED_UPDATE',
    'FUCKSEATS_MACOS_TEAM_ID',
    'FUCKSEATS_INSTALLER_ARGS',
    'FUCKSEATS_CLOUD_CALLBACK_URL',
    'FUCKSEATS_DISABLE_DATABASE_ENCRYPTION',
})


def env(name, default=''):
    if is_frozen() and name in PACKAGED_ENV_OVERRIDES:
        return default
    return os.environ.get(name, default)


def sanitize_environment():
    if not is_frozen():
        return []
    removed = sorted(PACKAGED_ENV_OVERRIDES.intersection(os.environ))
    for name in removed:
        os.environ.pop(name, None)
    return removed
