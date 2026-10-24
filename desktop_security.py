"""Ephemeral credentials shared only by the desktop shell and its local server."""

from __future__ import annotations

import secrets
import threading
import time
import urllib.request
from urllib.parse import urlencode, urlsplit


DESKTOP_COOKIE = 'fuckseats_desktop_session'
DESKTOP_HEADER = 'X-FuckSeats-Desktop'
DESKTOP_SESSION_PATH = '/_desktop/session/'
WINDOW_TICKET_TTL = 60
LOCAL_HOSTS = frozenset({'127.0.0.1', 'localhost', '::1'})


def _local_origin(url):
    parsed = urlsplit(url)
    if (
        parsed.scheme != 'http' or parsed.hostname not in LOCAL_HOSTS
        or parsed.username is not None or parsed.password is not None
    ):
        raise ValueError('桌面服务必须使用本机 HTTP 地址')
    return f'{parsed.scheme}://{parsed.netloc}'


class DesktopSession:
    def __init__(self):
        self._lock = threading.Lock()
        self._origin = ''
        self._credential = ''
        self._tickets = {}

    def start(self, origin):
        origin = _local_origin(origin)
        with self._lock:
            self._origin = origin
            self._credential = secrets.token_urlsafe(32)
            self._tickets.clear()

    def close(self):
        with self._lock:
            self._origin = ''
            self._credential = ''
            self._tickets.clear()

    def accepts_host(self, host):
        try:
            parsed = urlsplit('http://' + host)
            with self._lock:
                port = urlsplit(self._origin).port
            return bool(
                port and parsed.hostname in LOCAL_HOSTS and parsed.port == port
                and parsed.username is None and parsed.password is None
                and not parsed.path and not parsed.query and not parsed.fragment
            )
        except ValueError:
            return False

    def accepts_origin(self, origin):
        with self._lock:
            return bool(self._origin and origin == self._origin)

    def authorized(self, credential):
        if not isinstance(credential, str) or len(credential) != 43:
            return False
        with self._lock:
            return bool(self._credential and secrets.compare_digest(
                credential.encode('utf-8'), self._credential.encode('ascii'),
            ))

    def request_headers(self, url):
        with self._lock:
            if not self._credential:
                return {}
            if _local_origin(url) != self._origin:
                raise ValueError('禁止向其他地址发送桌面凭证')
            return {DESKTOP_HEADER: self._credential}

    def window_url(self, url):
        """Issue a one-use ticket; the session credential never appears in a URL."""
        with self._lock:
            if not self._credential:
                return url
            parsed = urlsplit(url)
            if _local_origin(url) != self._origin or parsed.fragment:
                raise ValueError('桌面窗口必须使用本应用地址')
            target = parsed.path or '/'
            if target.startswith('//') or target == DESKTOP_SESSION_PATH:
                raise ValueError('桌面窗口地址无效')
            if parsed.query:
                target += '?' + parsed.query
            now = time.monotonic()
            self._tickets = {key: value for key, value in self._tickets.items() if value[0] > now}
            if len(self._tickets) >= 128:
                raise RuntimeError('待打开的桌面窗口过多')
            ticket = secrets.token_urlsafe(32)
            self._tickets[ticket] = (now + WINDOW_TICKET_TTL, target)
            return self._origin + DESKTOP_SESSION_PATH + '?' + urlencode({'ticket': ticket})

    def consume_ticket(self, ticket):
        with self._lock:
            entry = self._tickets.pop(ticket, None)
            if not self._credential or not entry or entry[0] <= time.monotonic():
                return None
            return entry[1], self._credential


desktop_session = DesktopSession()


class _NoDesktopRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # urllib otherwise forwards custom authentication headers on redirects.
        if fp is not None:
            fp.close()
        raise ValueError('本地文件请求不允许重定向，请使用完整接口地址')


def open_local_request(request, *, timeout=120):
    """Keep native imports/exports off proxies and never forward their credential."""
    _local_origin(request.full_url)
    for name, value in desktop_session.request_headers(request.full_url).items():
        request.add_unredirected_header(name, value)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoDesktopRedirect())
    return opener.open(request, timeout=timeout)
