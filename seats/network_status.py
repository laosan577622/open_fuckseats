import ctypes
import ctypes.util
import platform
import urllib.parse


MAC_REACHABLE = 1 << 1
MAC_CONNECTION_REQUIRED = 1 << 2
MAC_CONNECTION_ON_TRAFFIC = 1 << 3
MAC_INTERVENTION_REQUIRED = 1 << 4
MAC_CONNECTION_ON_DEMAND = 1 << 5


def _macos_flags_online(value):
    reachable = bool(value & MAC_REACHABLE)
    connection_required = bool(value & MAC_CONNECTION_REQUIRED)
    can_connect_automatically = bool(
        value & (MAC_CONNECTION_ON_TRAFFIC | MAC_CONNECTION_ON_DEMAND)
    ) and not bool(value & MAC_INTERVENTION_REQUIRED)
    return reachable and (not connection_required or can_connect_automatically)


def _windows_network_status():
    flags = ctypes.c_ulong(0)
    wininet = ctypes.windll.wininet
    checker = wininet.InternetGetConnectedState
    checker.argtypes = [ctypes.POINTER(ctypes.c_ulong), ctypes.c_ulong]
    checker.restype = ctypes.c_bool
    online = bool(checker(ctypes.byref(flags), 0))
    return online, 'wininet', int(flags.value)


def _macos_network_status(host):
    system_config_path = (
        ctypes.util.find_library('SystemConfiguration')
        or '/System/Library/Frameworks/SystemConfiguration.framework/SystemConfiguration'
    )
    core_foundation_path = (
        ctypes.util.find_library('CoreFoundation')
        or '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation'
    )
    system_config = ctypes.CDLL(system_config_path)
    core_foundation = ctypes.CDLL(core_foundation_path)

    create = system_config.SCNetworkReachabilityCreateWithName
    create.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    create.restype = ctypes.c_void_p

    get_flags = system_config.SCNetworkReachabilityGetFlags
    get_flags.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
    get_flags.restype = ctypes.c_bool

    release = core_foundation.CFRelease
    release.argtypes = [ctypes.c_void_p]
    release.restype = None

    reference = create(None, host.encode('idna'))
    if not reference:
        raise RuntimeError('无法创建 macOS 网络可达性检查')

    flags = ctypes.c_uint32(0)
    try:
        if not get_flags(reference, ctypes.byref(flags)):
            raise RuntimeError('macOS 网络可达性检查失败')
    finally:
        release(reference)

    value = int(flags.value)
    online = _macos_flags_online(value)
    return online, 'scnetworkreachability', value


def get_system_network_status(cloud_url):
    host = urllib.parse.urlparse(str(cloud_url or '')).hostname or ''
    system_name = platform.system().strip().lower()
    platform_name = {
        'darwin': 'macos',
        'windows': 'windows',
        'linux': 'linux',
    }.get(system_name, system_name or 'unknown')

    result = {
        'online': None,
        'platform': platform_name,
        'source': 'unsupported',
        'checked_host': host,
        'error': '',
    }
    if not host:
        result['source'] = 'invalid-host'
        result['error'] = '云服务器地址无效'
        return result

    try:
        if system_name == 'windows':
            online, source, flags = _windows_network_status()
        elif system_name == 'darwin':
            online, source, flags = _macos_network_status(host)
        else:
            return result
    except Exception as exc:
        result['source'] = 'system-api-error'
        result['error'] = str(exc)[:160]
        return result

    result.update({
        'online': bool(online),
        'source': source,
        'flags': flags,
    })
    return result
