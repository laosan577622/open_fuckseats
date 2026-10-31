"""正式版本与 SP 修订版的发布、安装版本转换。"""
import re


RELEASE_VERSION_PATTERN = r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-sp[1-9]\d*)?'
RELEASE_VERSION_RE = re.compile(RELEASE_VERSION_PATTERN)


def version_key(version):
    version = str(version or '').strip()
    if not RELEASE_VERSION_RE.fullmatch(version):
        raise ValueError('版本号须为三段数字，可附加 -sp1 等修订号')
    core, _, revision = version.partition('-sp')
    return (*map(int, core.split('.')), int(revision or 0))


def native_version(version):
    major, minor, patch, revision = version_key(version)
    core = f'{major}.{minor}.{patch}'
    return f'{core}.{revision}' if revision else core


def public_package_version(version):
    match = re.fullmatch(r'(\d+\.\d+\.\d+)\.([1-9]\d*)', str(version))
    return f'{match[1]}-sp{match[2]}' if match else version
