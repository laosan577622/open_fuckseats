import secrets
from datetime import timedelta
from functools import wraps

from django.http import JsonResponse
from django.utils import timezone

from .config import get_data_limit, subscription_payload
from .models import CloudSession


def issue_session(user, device_id='', client_key_id='', client_public_key_pem=''):
    token = secrets.token_urlsafe(48)
    expires_at = timezone.now() + timedelta(days=get_data_limit('session_token_ttl_days', 7))
    return CloudSession.objects.create(
        user=user,
        token=token,
        device_id=str(device_id or '')[:64],
        client_key_id=str(client_key_id or '')[:96],
        client_public_key_pem=str(client_public_key_pem or ''),
        expires_at=expires_at,
    )


def get_request_session(request):
    auth_header = request.headers.get('Authorization') or ''
    prefix = 'Bearer '
    if not auth_header.startswith(prefix):
        return None
    token = auth_header[len(prefix):].strip()
    if not token:
        return None
    session = CloudSession.objects.select_related('user').filter(token=token).first()
    if not session or not session.is_valid():
        return None
    return session


def require_session(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        session = get_request_session(request)
        if not session:
            return JsonResponse({
                'ok': False,
                'status': 'error',
                'error': 'unauthorized',
                'message': 'session_token 无效或已过期',
            }, status=401)
        request.cloud_session = session
        request.cloud_user = session.user
        return view_func(request, *args, **kwargs)

    return wrapped


def user_payload(user):
    return {
        'uid': user.uid,
        'nickname': user.nickname,
        'email': user.email,
        'avatar_url': user.avatar_url,
        'subscription': subscription_payload(user.subscription_tier, user.subscription_expires_at),
    }
