import json
import os
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from datetime import timedelta

from django.db import models
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .crypto import compute_key_id, decrypt_payload, encrypt_payload, generate_rsa_keypair
from .models import CloudSession, FrontendKVStore, LocalCloudKeyMaterial, SyncMeta


OFFICIAL_CLOUD_SERVER_URL = 'https://fuckseatsapi.577622.xyz'
DEFAULT_CLOUD_SERVER_URL = OFFICIAL_CLOUD_SERVER_URL
DEFAULT_CLOUD_CALLBACK_URL = os.getenv('FUCKSEATS_CLOUD_CALLBACK_URL', 'http://localhost:23948/cloud/callback').strip() or 'http://localhost:23948/cloud/callback'
CLOUD_USER_AGENT = os.getenv('FUCKSEATS_CLOUD_USER_AGENT', 'fuckseats_cilent').strip() or 'fuckseats_cilent'
CLOUD_SERVER_URL_KEY = 'cloud_server_url'
AUTO_REFRESH_SUBSCRIPTION_EXCLUDED_PATHS = {
    '/auth/exchange',
    '/auth/logout',
    '/api/me/refresh-subscription',
}

_sync_state = threading.local()


class CloudAPIError(RuntimeError):
    def __init__(self, message, status_code=502, payload=None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload or {'status': 'error', 'message': message}


def _get_ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass

    try:
        context = ssl.create_default_context()
        try:
            context.load_default_certs()
        except Exception:
            pass
        if context.get_ca_certs():
            return context
    except Exception:
        pass

    return ssl._create_unverified_context()


def get_cloud_server_url():
    return OFFICIAL_CLOUD_SERVER_URL


def set_cloud_server_url(url):
    FrontendKVStore.objects.update_or_create(
        key=CLOUD_SERVER_URL_KEY,
        defaults={'value': OFFICIAL_CLOUD_SERVER_URL},
    )
    return OFFICIAL_CLOUD_SERVER_URL


def build_cloud_login_url(callback_url=None):
    local_keys = get_or_create_local_cloud_keypair()
    query = urllib.parse.urlencode({
        'callback': callback_url or DEFAULT_CLOUD_CALLBACK_URL,
        'client_key_id': local_keys['key_id'],
        'client_public_key': local_keys['public_key_pem'],
    })
    return f'{get_cloud_server_url()}/auth/login?{query}'


def _read_json_response(response):
    raw = response.read()
    if not raw:
        return {}
    return json.loads(raw.decode('utf-8'))


def _unwrap_encrypted_response(payload, session=None):
    if not isinstance(payload, dict):
        return payload
    encrypted = payload.get('encrypted')
    if not isinstance(encrypted, dict):
        return payload

    private_key_pem = ''
    if session is not None:
        private_key_pem = str(getattr(session, 'client_private_key_pem', '') or '')
    if not private_key_pem:
        keys = get_or_create_local_cloud_keypair()
        private_key_pem = keys['private_key_pem']
    if not private_key_pem:
        raise CloudAPIError('本地缺少解密私钥', status_code=500, payload={'status': 'error', 'message': '本地缺少解密私钥'})

    try:
        decrypted = decrypt_payload(encrypted, private_key_pem)
    except Exception as exc:
        raise CloudAPIError(f'解密云端响应失败：{exc}', status_code=502, payload={'status': 'error', 'message': f'解密云端响应失败：{exc}'}) from exc

    if isinstance(payload.get('server_key'), dict):
        decrypted['server_key'] = payload.get('server_key')
    if payload.get('client_key_id'):
        decrypted['client_key_id'] = payload.get('client_key_id')
    if '_http_status' in payload:
        decrypted['_http_status'] = payload.get('_http_status')
    return decrypted


def get_or_create_local_cloud_keypair():
    local_key = LocalCloudKeyMaterial.objects.filter(scope='default').first()
    if local_key and local_key.public_key_pem and local_key.private_key_pem:
        key_id = str(local_key.key_id or '').strip() or compute_key_id(local_key.public_key_pem)
        if key_id != local_key.key_id:
            local_key.key_id = key_id
            local_key.save(update_fields=['key_id', 'updated_at'])
        return {
            'key_id': key_id,
            'public_key_pem': local_key.public_key_pem,
            'private_key_pem': local_key.private_key_pem,
        }

    session = CloudSession.objects.order_by('-updated_at').first()
    if session and session.client_private_key_pem and session.client_public_key_pem:
        key_id = str(session.client_key_id or '').strip() or compute_key_id(session.client_public_key_pem)
        if session.client_key_id != key_id:
            session.client_key_id = key_id
            session.save(update_fields=['client_key_id', 'updated_at'])
        LocalCloudKeyMaterial.objects.update_or_create(
            scope='default',
            defaults={
                'key_id': key_id,
                'public_key_pem': session.client_public_key_pem,
                'private_key_pem': session.client_private_key_pem,
            },
        )
        return {
            'key_id': key_id,
            'public_key_pem': session.client_public_key_pem,
            'private_key_pem': session.client_private_key_pem,
        }

    generated = generate_rsa_keypair()
    LocalCloudKeyMaterial.objects.update_or_create(
        scope='default',
        defaults={
            'key_id': generated['key_id'],
            'public_key_pem': generated['public_key_pem'],
            'private_key_pem': generated['private_key_pem'],
        },
    )
    if session:
        session.client_key_id = generated['key_id']
        session.client_public_key_pem = generated['public_key_pem']
        session.client_private_key_pem = generated['private_key_pem']
        session.save(update_fields=['client_key_id', 'client_public_key_pem', 'client_private_key_pem', 'updated_at'])
    return generated


def _encrypt_request_body(body, session=None):
    if body is None:
        return None
    server_public_key_pem = ''
    sender_key_id = ''
    if session is not None:
        server_public_key_pem = str(getattr(session, 'server_public_key_pem', '') or '')
        sender_key_id = str(getattr(session, 'client_key_id', '') or '')
    if not server_public_key_pem:
        return body
    if not sender_key_id:
        sender_key_id = get_or_create_local_cloud_keypair()['key_id']
    return {
        'encrypted': encrypt_payload(body, server_public_key_pem, sender_key_id=sender_key_id),
    }


def _request_json(method, url, body=None, headers=None, timeout=20):
    request_headers = {
        'Accept': 'application/json',
        'User-Agent': CLOUD_USER_AGENT,
    }
    if headers:
        request_headers.update(headers)

    data = None
    if body is not None:
        request_headers['Content-Type'] = 'application/json'
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')

    req = urllib.request.Request(url, data=data, headers=request_headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_get_ssl_context()) as response:
            payload = _read_json_response(response)
            payload.setdefault('_http_status', getattr(response, 'status', 200))
            return payload
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode('utf-8'))
        except Exception:
            payload = {'status': 'error', 'message': str(exc)}
        payload.setdefault('_http_status', exc.code)
        raise CloudAPIError(payload.get('message') or payload.get('error') or str(exc), status_code=exc.code, payload=payload) from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, 'reason', exc)
        raise CloudAPIError(f'无法连接云端服务：{reason}', status_code=502) from exc
    except Exception as exc:
        raise CloudAPIError(f'无法连接云端服务：{exc}', status_code=502) from exc


def _normalize_cloud_path(path):
    normalized = str(path or '').strip()
    if not normalized.startswith('/'):
        normalized = '/' + normalized
    return normalized


def _should_auto_refresh_subscription(path):
    normalized_path = _normalize_cloud_path(path)
    return normalized_path not in AUTO_REFRESH_SUBSCRIPTION_EXCLUDED_PATHS


def cloud_public_request(method, path, body=None, timeout=20):
    active_session = get_active_cloud_session()
    if active_session and _should_auto_refresh_subscription(path):
        refresh_cloud_subscription(active_session, timeout=timeout)
    payload = _request_json(method, f'{get_cloud_server_url()}{path}', body=body, timeout=timeout)
    return _unwrap_encrypted_response(payload)


def cloud_api_request(session, method, path, body=None, timeout=20, refresh_subscription=True):
    if not session:
        raise CloudAPIError('尚未登录云服务', status_code=401, payload={'status': 'error', 'error': 'not_logged_in', 'message': '尚未登录云服务'})
    if refresh_subscription and _should_auto_refresh_subscription(path):
        refresh_cloud_subscription(session, timeout=timeout)
    headers = {'Authorization': f'Bearer {session.session_token}'}
    encrypted_body = _encrypt_request_body(body, session=session)
    payload = _request_json(method, f'{get_cloud_server_url()}{path}', body=encrypted_body, headers=headers, timeout=timeout)
    unwrapped = _unwrap_encrypted_response(payload, session=session)
    if isinstance(unwrapped, dict) and (
        isinstance(unwrapped.get('subscription'), dict)
        or 'subscription_tier' in unwrapped
        or 'subscription_display_name' in unwrapped
        or 'subscription_expires_at' in unwrapped
        or 'limits' in unwrapped
    ):
        apply_cloud_subscription_payload(session, unwrapped)
    return unwrapped


pass # 此部分代码未被披露至开源版本


def cloud_exchange_session_code(code, device_id='local-desktop'):
    local_keys = get_or_create_local_cloud_keypair()
    payload = cloud_public_request('POST', '/auth/exchange', {
        'code': code,
        'device_id': device_id,
        'client_key_id': local_keys['key_id'],
        'client_public_key': local_keys['public_key_pem'],
    })
    if isinstance(payload, dict):
        payload.setdefault('client_key_id', local_keys['key_id'])
    return payload


def _parse_datetime_or_none(value):
    if not value:
        return None
    parsed = parse_datetime(str(value))
    if parsed and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def apply_cloud_subscription_payload(session, data):
    if session is None or not isinstance(data, dict):
        return session

    subscription = data.get('subscription') if isinstance(data.get('subscription'), dict) else {}
    session.subscription_tier = str(subscription.get('tier') or data.get('subscription_tier') or session.subscription_tier or 'free')
    session.subscription_display_name = str(
        subscription.get('display_name') or data.get('subscription_display_name') or session.subscription_display_name or '免费版'
    )
    session.subscription_expires_at = _parse_datetime_or_none(
        subscription.get('expires_at') or data.get('subscription_expires_at')
    )
    session.limits = subscription.get('limits') if isinstance(subscription.get('limits'), dict) else (
        data.get('limits') if isinstance(data.get('limits'), dict) else (session.limits or {})
    )
    session.save(update_fields=['subscription_tier', 'subscription_display_name', 'subscription_expires_at', 'limits', 'updated_at'])
    return session


def save_cloud_session_from_payload(data):
    subscription = data.get('subscription') if isinstance(data.get('subscription'), dict) else {}
    uid = str(data.get('uid') or data.get('user', {}).get('uid') or '').strip()
    if not uid:
        raise CloudAPIError('云端返回缺少 uid', status_code=502)

    expires_at = _parse_datetime_or_none(data.get('token_expires_at'))
    if not expires_at:
        expires_at = timezone.now() + timedelta(days=7)

    existing = CloudSession.objects.order_by('-updated_at').first()
    fallback_keys = None
    if existing and existing.client_private_key_pem and existing.client_public_key_pem:
        fallback_keys = {
            'key_id': str(existing.client_key_id or '') or compute_key_id(existing.client_public_key_pem),
            'public_key_pem': existing.client_public_key_pem,
            'private_key_pem': existing.client_private_key_pem,
        }
    else:
        fallback_keys = get_or_create_local_cloud_keypair()

    server_key = data.get('server_key') if isinstance(data.get('server_key'), dict) else {}

    session, _ = CloudSession.objects.update_or_create(
        uid=uid,
        defaults={
            'nickname': str(data.get('nickname') or data.get('user', {}).get('nickname') or ''),
            'avatar_url': str(data.get('avatar_url') or data.get('user', {}).get('avatar_url') or ''),
            'email': str(data.get('email') or data.get('user', {}).get('email') or ''),
            'session_token': str(data.get('session_token') or ''),
            'client_key_id': str(data.get('client_key_id') or fallback_keys['key_id'] or '')[:96],
            'client_public_key_pem': str(data.get('client_public_key') or fallback_keys['public_key_pem'] or ''),
            'client_private_key_pem': str(data.get('client_private_key') or fallback_keys['private_key_pem'] or ''),
            'server_key_id': str(server_key.get('key_id') or data.get('server_key_id') or '')[:96],
            'server_public_key_pem': str(server_key.get('public_key') or data.get('server_public_key') or ''),
            'token_expires_at': expires_at,
            'subscription_tier': str(subscription.get('tier') or data.get('subscription_tier') or 'free'),
            'subscription_display_name': str(subscription.get('display_name') or data.get('subscription_display_name') or '免费版'),
            'subscription_expires_at': _parse_datetime_or_none(subscription.get('expires_at') or data.get('subscription_expires_at')),
            'limits': subscription.get('limits') if isinstance(subscription.get('limits'), dict) else {},
        },
    )
    CloudSession.objects.exclude(pk=session.pk).delete()
    return session


def get_active_cloud_session():
    session = CloudSession.objects.order_by('-updated_at').first()
    if not session:
        return None
    if session.token_expires_at <= timezone.now():
        return None
    return session


def clear_cloud_session():
    CloudSession.objects.all().delete()


def refresh_cloud_subscription(session, timeout=20, strict=False):
    if not session:
        return session

    try:
        headers = {'Authorization': f'Bearer {session.session_token}'}
        payload = _request_json(
            'POST',
            f'{get_cloud_server_url()}/api/me/refresh-subscription',
            body=None,
            headers=headers,
            timeout=timeout,
        )
        payload = _unwrap_encrypted_response(payload, session=session)
        if isinstance(payload, dict):
            apply_cloud_subscription_payload(session, payload)
    except CloudAPIError:
        if strict:
            raise
    except Exception as exc:
        if strict:
            raise CloudAPIError(f'刷新订阅失败：{exc}', status_code=502) from exc
    return session


def is_sync_bump_suspended():
    return bool(getattr(_sync_state, 'suspended', False))


@contextmanager
def suspend_sync_version_bump():
    previous = is_sync_bump_suspended()
    _sync_state.suspended = True
    try:
        yield
    finally:
        _sync_state.suspended = previous


def ensure_sync_meta(classroom):
    meta, _ = SyncMeta.objects.get_or_create(classroom=classroom)
    return meta


def bump_local_version(classroom_or_id):
    if is_sync_bump_suspended() or not classroom_or_id:
        return

    classroom_id = getattr(classroom_or_id, 'pk', classroom_or_id)
    if not classroom_id:
        return

    meta, _ = SyncMeta.objects.get_or_create(classroom_id=classroom_id)
    now = timezone.now()
    SyncMeta.objects.filter(pk=meta.pk).update(
        local_version=models.F('local_version') + 1,
        last_operation_at=now,
        updated_at=now,
    )
