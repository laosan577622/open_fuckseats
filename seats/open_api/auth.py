import os
import secrets
from functools import wraps

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from seats.models import FrontendKVStore


OPEN_API_STORE_KEY = 'fuckseats_open_api_key'
OPEN_API_KEY_PREFIX = 'fks-'


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


def unauthorized_response(message='缺少或无效的 Bearer API Key'):
    response = JsonResponse({
        'status': 'error',
        'error': message,
        'code': 'UNAUTHORIZED',
    }, status=401)
    response['WWW-Authenticate'] = 'Bearer'
    return response


def require_open_api_auth(view_func):
    @csrf_exempt
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if request.method == 'OPTIONS':
            return JsonResponse({'status': 'ok'})
        if not is_authorized(request):
            return unauthorized_response()
        return view_func(request, *args, **kwargs)

    return wrapper
