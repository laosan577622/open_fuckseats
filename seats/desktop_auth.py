"""Authenticate every desktop page and internal endpoint before dispatch."""

from django.conf import settings
from django.http import HttpResponseRedirect, JsonResponse
from django.utils.cache import patch_cache_control, patch_vary_headers

from desktop_security import DESKTOP_COOKIE, DESKTOP_HEADER, DESKTOP_SESSION_PATH, desktop_session


CALLBACK_PATHS = frozenset({'/cloud/callback', '/cloud/callback/', '/ai/connect/callback/'})


def desktop_mode_enabled():
    return settings.APP_SHELL == 'webview'


def _private_response(response, *, referrer_policy='same-origin'):
    patch_cache_control(response, private=True, no_store=True)
    # Native form POSTs need their real Origin; no-referrer turns it into null.
    # same-origin still prevents desktop page URLs from reaching external sites.
    response['Referrer-Policy'] = referrer_policy
    response['X-Content-Type-Options'] = 'nosniff'
    return response


def _denied(message='请在桌面应用内使用此接口', *, status=401, code='DESKTOP_AUTH_REQUIRED'):
    return _private_response(JsonResponse({
        'status': 'error', 'code': code, 'message': message,
    }, status=status))


class DesktopAuthMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not desktop_mode_enabled():
            return self.get_response(request)
        if (
            request.META.get('REMOTE_ADDR') not in {'127.0.0.1', '::1'}
            or not desktop_session.accepts_host(request.get_host())
        ):
            return _denied('桌面服务仅接受本机地址', status=403, code='LOCAL_CLIENT_REQUIRED')

        path = request.path_info
        # Open API validates Bearer keys/read grants itself. Origin is never a credential.
        if path == '/open_api' or path.startswith('/open_api/'):
            return _private_response(self.get_response(request))
        # External login browsers have no desktop session. These endpoints validate
        # their single-use authorization state/code and never issue a desktop cookie.
        if request.method in {'GET', 'HEAD'} and (path == '/health/' or path in CALLBACK_PATHS):
            return _private_response(self.get_response(request))

        origin = request.headers.get('Origin')
        if (origin and not desktop_session.accepts_origin(origin)) or (
            request.headers.get('Sec-Fetch-Site') in {'cross-site', 'same-site'}
        ):
            return _denied('请求来源不受允许', status=403, code='DESKTOP_ORIGIN_REJECTED')

        if path == DESKTOP_SESSION_PATH:
            if request.method != 'GET':
                return _denied(status=405)
            grant = desktop_session.consume_ticket(request.GET.get('ticket', ''))
            if grant is None:
                return _denied('桌面窗口凭证无效或已过期')
            target, credential = grant
            response = HttpResponseRedirect(target)
            response.set_cookie(DESKTOP_COOKIE, credential, httponly=True, samesite='Strict')
            return _private_response(response, referrer_policy='no-referrer')

        if not any(desktop_session.authorized(value) for value in (
            request.headers.get(DESKTOP_HEADER, ''), request.COOKIES.get(DESKTOP_COOKIE, ''),
        )):
            return _denied()
        response = self.get_response(request)
        patch_vary_headers(response, ('Cookie', DESKTOP_HEADER))
        return _private_response(response)
