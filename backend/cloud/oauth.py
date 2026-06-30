import json
import os
import ssl
import urllib.parse
import urllib.request
from datetime import timedelta

from django.utils import timezone

from .config import determine_tier, get_config
from .models import CloudUser


class OAuthError(RuntimeError):
    pass


CLOUD_USER_AGENT = os.getenv('FUCKSEATS_CLOUD_USER_AGENT', 'fuckseats_cilent').strip() or 'fuckseats_cilent'


def _get_ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    ctx = ssl.create_default_context()
    try:
        ctx.load_default_certs()
    except Exception:
        pass
    if not ctx.get_ca_certs():
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _request_json(url, method='GET', data=None, headers=None):
    request_headers = {
        'Accept': 'application/json',
        'User-Agent': CLOUD_USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    }
    if headers:
        request_headers.update(headers)
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode('utf-8')
        request_headers['Content-Type'] = 'application/x-www-form-urlencoded'

    req = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20, context=_get_ssl_context()) as response:
            raw = response.read()
            return json.loads(raw.decode('utf-8')) if raw else {}
    except urllib.error.HTTPError as exc:
        error_body = ''
        try:
            error_body = exc.read().decode('utf-8', errors='replace')
        except Exception:
            pass
        print(f'[oauth _request_json] {exc.code} {exc.reason} url={url} body={error_body[:500]}')
        raise OAuthError(f'HTTP Error {exc.code}: {exc.reason} - {error_body[:200]}') from exc
    except Exception as exc:
        raise OAuthError(str(exc)) from exc


def exchange_code_for_token(code, redirect_uri=None):
    config = get_config().get('laosan_oauth', {})
    client_id = str(config.get('client_id') or '').strip()
    client_secret = str(config.get('client_secret') or '').strip()
    token_url = str(config.get('token_url') or '').strip()
    if not client_id or not client_secret:
        raise OAuthError('云端 OAuth client_id/client_secret 未配置')
    if not token_url:
        raise OAuthError('云端 OAuth token_url 未配置')

    data = {
        'grant_type': 'authorization_code',
        'code': code,
        'client_id': client_id,
        'client_secret': client_secret,
    }
    if redirect_uri:
        data['redirect_uri'] = redirect_uri

    payload = _request_json(token_url, method='POST', data=data)
    access_token = payload.get('access_token')
    if not access_token:
        raise OAuthError('老三账户未返回 access_token')
    return payload


def fetch_userinfo(access_token):
    config = get_config().get('laosan_oauth', {})
    userinfo_url = str(config.get('userinfo_url') or '').strip()
    if not userinfo_url:
        raise OAuthError('云端 OAuth userinfo_url 未配置')
    payload = _request_json(userinfo_url, method='GET', headers={
        'Authorization': f'Bearer {access_token}',
    })
    if not isinstance(payload, dict):
        raise OAuthError('老三账户 userinfo 返回格式错误')
    return payload


def _token_expires_at(token_payload):
    try:
        seconds = int(token_payload.get('expires_in') or 0)
    except (TypeError, ValueError):
        seconds = 0
    if seconds <= 0:
        return None
    return timezone.now() + timedelta(seconds=seconds)


def upsert_cloud_user(userinfo, token_payload):
    uid = str(
        userinfo.get('uid')
        or userinfo.get('sub')
        or userinfo.get('id')
        or userinfo.get('user_id')
        or ''
    ).strip()
    if not uid:
        raise OAuthError('老三账户 userinfo 缺少 uid')

    subscriptions = userinfo.get('subscriptions')
    if not isinstance(subscriptions, list):
        subscriptions = []
    tier, subscription_expires_at = determine_tier(subscriptions)

    user, _ = CloudUser.objects.update_or_create(
        uid=uid,
        defaults={
            'nickname': str(userinfo.get('nickname') or userinfo.get('name') or ''),
            'email': str(userinfo.get('email') or ''),
            'avatar_url': str(userinfo.get('avatar_url') or userinfo.get('avatar') or ''),
            'subscription_tier': tier,
            'subscription_expires_at': subscription_expires_at,
            'laosan_access_token': str(token_payload.get('access_token') or '')[:512],
            'laosan_token_expires_at': _token_expires_at(token_payload),
        },
    )
    return user


def fetch_subscriptions_via_developer_api(uid):
    """通过开发者订阅查询接口拉取用户订阅。

    该接口凭 client_id + client_secret + user_uid 鉴权，不依赖 OAuth access_token
    的有效期，因此即使 access_token 已过期也能正常查询。只要用户未撤销授权即可。

    返回 subscriptions 列表（结构与 userinfo.subscriptions 一致，可直接喂给 determine_tier）。
    """
    config = get_config().get('laosan_oauth', {})
    url = str(config.get('developer_subscriptions_url') or '').strip()
    client_id = str(config.get('client_id') or '').strip()
    client_secret = str(config.get('client_secret') or '').strip()
    if not url:
        raise OAuthError('云端 developer_subscriptions_url 未配置')
    if not client_id or not client_secret:
        raise OAuthError('云端 OAuth client_id/client_secret 未配置')

    body = json.dumps({'client_id': client_id, 'client_secret': client_secret, 'user_uid': str(uid)}).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': CLOUD_USER_AGENT,
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=20, context=_get_ssl_context()) as response:
            raw = response.read()
            payload = json.loads(raw.decode('utf-8')) if raw else {}
    except urllib.error.HTTPError as exc:
        error_body = ''
        try:
            error_body = exc.read().decode('utf-8', errors='replace')
        except Exception:
            pass
        print(f'[oauth developer_subscriptions] {exc.code} {exc.reason} uid={uid} body={error_body[:500]}')
        raise OAuthError(f'查询订阅失败：HTTP {exc.code} {exc.reason}') from exc
    except Exception as exc:
        raise OAuthError(f'查询订阅失败：{exc}') from exc

    if not isinstance(payload, dict) or not payload.get('success'):
        err = (payload.get('error') if isinstance(payload, dict) else None) or '服务端未返回成功结果'
        raise OAuthError(f'查询订阅失败：{err}')

    subscriptions = payload.get('subscriptions')
    if not isinstance(subscriptions, list):
        subscriptions = []
    return subscriptions


def refresh_user_subscription(user):
    """刷新用户订阅。

    使用开发者订阅查询接口（凭 user_uid），不依赖 access_token 有效期，
    因此即使 access_token 已过期也能正常刷新订阅。
    """
    subscriptions = fetch_subscriptions_via_developer_api(user.uid)
    tier, subscription_expires_at = determine_tier(subscriptions)
    user.subscription_tier = tier
    user.subscription_expires_at = subscription_expires_at
    user.save(update_fields=['subscription_tier', 'subscription_expires_at', 'updated_at'])
    return user
