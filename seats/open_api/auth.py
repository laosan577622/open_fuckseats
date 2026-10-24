import os
import secrets
from functools import wraps

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

import desktop_access
from seats.desktop_auth import desktop_mode_enabled
from seats.models import FrontendKVStore


OPEN_API_STORE_KEY = 'fuckseats_open_api_key'
OPEN_API_KEY_PREFIX = 'fks-'
OPEN_API_BROWSER_ORIGINS_ENV = 'FUCKSEATS_OPEN_API_BROWSER_ORIGINS'
DEFAULT_OPEN_API_BROWSER_ORIGINS = {
    'https://ai.577622.xyz',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
}


def generate_open_api_key():
    return f'{OPEN_API_KEY_PREFIX}{secrets.token_urlsafe(32)}'


def get_or_create_open_api_key():
    row, _ = FrontendKVStore.objects.get_or_create(
        key=OPEN_API_STORE_KEY,
        defaults={'value': generate_open_api_key()},
    )
    value = str(row.value or '').strip()
    if not value:
        value = generate_open_api_key()
        row.value = value
        row.save(update_fields=['value'])
    return value


def reset_open_api_key():
    value = generate_open_api_key()
    FrontendKVStore.objects.update_or_create(
        key=OPEN_API_STORE_KEY,
        defaults={'value': value},
    )
    return value


def _configured_env_keys():
    keys = []
    for name in ('FUCKSEATS_OPEN_API_KEY', 'OPEN_API_KEY'):
        value = str(os.environ.get(name) or getattr(settings, name, '') or '').strip()
        if value:
            keys.append(value)
    return keys


def valid_open_api_keys():
    keys = _configured_env_keys()
    try:
        keys.append(get_or_create_open_api_key())
    except Exception:
        pass
    return {key for key in keys if key}


def extract_bearer_token(request):
    header = str(request.headers.get('authorization') or request.META.get('HTTP_AUTHORIZATION') or '').strip()
    if not header:
        return ''
    prefix = 'Bearer '
    if not header.lower().startswith(prefix.lower()):
        return ''
    return header[len(prefix):].strip()


def is_authorized(request):
    token = extract_bearer_token(request)
    if not token:
        return False
    return any(secrets.compare_digest(token, key) for key in valid_open_api_keys())


def is_trusted_browser_request(request):
    if desktop_mode_enabled():
        return False
    origin = str(request.headers.get('origin') or '').strip().rstrip('/')
    return bool(origin and origin in allowed_browser_origins())


def unauthorized_response(message='缺少或无效的 Bearer API Key'):
    response = JsonResponse({
        'status': 'error',
        'error': message,
        'code': 'UNAUTHORIZED',
    }, status=401)
    response['WWW-Authenticate'] = 'Bearer'
    return response


def read_access_state(request):
    token = extract_bearer_token(request)
    if not token.startswith(desktop_access.READ_TOKEN_PREFIX):
        return None
    return desktop_access.read_access_broker.lookup(token)


def read_access_error(state):
    if state is None:
        return unauthorized_response('只读凭证无效，或应用重启后授权已失效')
    authorization = state['authorization']
    pending = authorization == 'pending'
    return JsonResponse({
        'status': 'error',
        'authorization': authorization,
        'error': '等待用户允许第三方读取' if pending else '用户已拒绝第三方读取',
        'code': 'ACCESS_PENDING' if pending else 'ACCESS_DENIED',
    }, status=409 if pending else 403)


def allowed_browser_origins():
    configured = str(os.environ.get(OPEN_API_BROWSER_ORIGINS_ENV) or '').strip()
    if not configured:
        return set(DEFAULT_OPEN_API_BROWSER_ORIGINS)
    return {
        origin.strip().rstrip('/')
        for origin in configured.split(',')
        if origin.strip()
    }


def _append_vary(response, value):
    current = [item.strip() for item in str(response.get('Vary') or '').split(',') if item.strip()]
    if value not in current:
        current.append(value)
    response['Vary'] = ', '.join(current)


def apply_open_api_browser_headers(request, response):
    origin = str(request.headers.get('origin') or '').strip().rstrip('/')
    if not origin or origin not in allowed_browser_origins():
        return response
    response['Access-Control-Allow-Origin'] = origin
    response['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
    response['Access-Control-Max-Age'] = '600'
    if str(request.headers.get('access-control-request-private-network') or '').lower() == 'true':
        response['Access-Control-Allow-Private-Network'] = 'true'
    _append_vary(response, 'Origin')
    return response


def require_open_api_auth(view_func):
    @csrf_exempt
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if request.method == 'OPTIONS':
            origin = str(request.headers.get('origin') or '').strip().rstrip('/')
            if origin and origin not in allowed_browser_origins():
                return JsonResponse({
                    'status': 'error',
                    'error': '浏览器来源未获允许',
                    'code': 'ORIGIN_NOT_ALLOWED',
                }, status=403)
            return apply_open_api_browser_headers(request, JsonResponse({'status': 'ok'}))
        request.open_api_read_only = False
        token = extract_bearer_token(request)
        if token.startswith(desktop_access.READ_TOKEN_PREFIX):
            state = read_access_state(request)
            if state is None or state['authorization'] != 'granted':
                return apply_open_api_browser_headers(request, read_access_error(state))
            request.open_api_read_only = True
            request.open_api_client_name = state['client_name']
            return apply_open_api_browser_headers(request, view_func(request, *args, **kwargs))
        if not is_authorized(request) and not is_trusted_browser_request(request):
            return apply_open_api_browser_headers(request, unauthorized_response())
        return apply_open_api_browser_headers(request, view_func(request, *args, **kwargs))

    return wrapper
