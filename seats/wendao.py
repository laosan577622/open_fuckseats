"""Local desktop OAuth client. Credentials never enter frontend storage or exports."""
import base64
import hashlib
import json
import secrets
from datetime import timedelta
from functools import wraps
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings
from django.db import transaction
from django.db.models import Count
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render, redirect
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from database_security import get_database_key
from .models import Classroom, FrontendKVStore, WendaoAuthorization, WendaoConnection
from .ai_privacy import STORE_KEY as NAME_PRIVACY_STORE_KEY, name_privacy_enabled


class ConnectionError(RuntimeError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def local_only(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        host = urlsplit('http://' + request.get_host()).hostname
        remote = request.META.get('REMOTE_ADDR', '')
        if host not in {'127.0.0.1', 'localhost', '::1'} or remote not in {'127.0.0.1', '::1'}:
            return JsonResponse({'status': 'error', 'message': '仅允许本机访问'}, status=403)
        origin = request.headers.get('Origin')
        if origin and origin != request.scheme + '://' + request.get_host():
            return JsonResponse({'status': 'error', 'message': '请求来源不匹配'}, status=403)
        try:
            response = view(request, *args, **kwargs)
        except ConnectionError as exc:
            response = JsonResponse({'status': 'error', 'message': str(exc)}, status=exc.status)
        response['Cache-Control'] = 'no-store'
        response['Referrer-Policy'] = 'no-referrer'
        return response
    return wrapped


def seal(value):
    key = hashlib.sha256(get_database_key() + b'wendao-oauth-v1').digest()
    nonce = secrets.token_bytes(12)
    data = json.dumps(value, ensure_ascii=False).encode()
    return base64.urlsafe_b64encode(nonce + AESGCM(key).encrypt(nonce, data, b'wendao')).decode()


def unseal(value):
    try:
        data = base64.urlsafe_b64decode(value)
        key = hashlib.sha256(get_database_key() + b'wendao-oauth-v1').digest()
        return json.loads(AESGCM(key).decrypt(data[:12], data[12:], b'wendao'))
    except Exception as exc:
        raise ConnectionError('无法读取本机授权，请重新连接闻道智能。') from exc


def site_url():
    site = settings.WENDAO_OAUTH_SITE.rstrip('/')
    parsed = urlsplit(site)
    if (parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1', 'localhost', '::1'})) or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise ConnectionError('闻道智能服务地址配置无效。')
    return site


def remote_json(method, path, *, key='', data=None):
    # Follow no redirects: a gateway redirect must not forward credentials elsewhere.
    try:
        response = httpx.request(method, site_url() + path, headers={'Authorization': 'Bearer ' + key} if key else {}, data=data, timeout=25, follow_redirects=False)
    except httpx.HTTPError as exc:
        raise ConnectionError('暂时无法连接闻道智能，请稍后重试。', 502) from exc
    if response.status_code in {401, 403}:
        raise ConnectionError('授权已失效或权限不足，请重新连接闻道智能。', response.status_code)
    if not 200 <= response.status_code < 300:
        message = '闻道智能服务尚未就绪，请确认服务端已更新。' if response.status_code == 404 else '闻道智能请求失败，请稍后重试。'
        raise ConnectionError(message, 502)
    if not response.content:
        return {}
    try:
        value = response.json()
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except ValueError as exc:
        raise ConnectionError('闻道智能返回了无效数据。', 502) from exc


def connection():
    row, _ = WendaoConnection.objects.get_or_create(pk=1)
    return row


def credentials(row=None):
    row = row or connection()
    if not row.credentials:
        raise ConnectionError('请先连接闻道智能。', 401)
    value = unseal(row.credentials)
    if value.get('site') != site_url():
        raise ConnectionError('服务地址已变更，请重新授权。', 401)
    expiry = value.get('expires_at')
    if expiry:
        from django.utils.dateparse import parse_datetime
        at = parse_datetime(expiry)
        if not at or timezone.is_naive(at) or at <= timezone.now():
            raise ConnectionError('授权已过期，请重新连接闻道智能。', 401)
    return value


def read_payload(request):
    try:
        if len(request.body) > 65536:
            raise ValueError()
        data = json.loads(request.body or '{}')
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except (ValueError, UnicodeDecodeError) as exc:
        raise ConnectionError('请求数据无效。') from exc


@local_only
@ensure_csrf_cookie
@require_GET
def workspace(request, pk=None):
    classroom = get_object_or_404(Classroom, pk=pk) if pk else None
    classrooms = Classroom.objects.all()
    if classroom is None:
        classrooms = classrooms.annotate(student_count=Count('students'))
    return render(request, 'seats/ai_workspace.html' if classroom else 'seats/wendao_workspace.html', {'classroom': classroom, 'classrooms': classrooms})


@local_only
@ensure_csrf_cookie
@require_GET
def connect_page(request):
    return redirect('/settings/#wendao')


@local_only
@require_POST
def begin(request):
    data = read_payload(request)
    classroom_id = data.get('classroom')
    classroom = get_object_or_404(Classroom, pk=classroom_id) if str(classroom_id or '').isdecimal() else None
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    digest = hashlib.sha256(state.encode()).hexdigest()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    redirect_uri = settings.WENDAO_OAUTH_REDIRECT_URI
    parsed = urlsplit(redirect_uri)
    if parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost', '::1'} or parsed.path != '/ai/connect/callback/' or parsed.query or parsed.fragment or parsed.username:
        raise ConnectionError('本地回调地址配置无效。')
    site = site_url()
    with transaction.atomic():
        row = connection()
        WendaoAuthorization.objects.filter(status='pending').update(status='superseded', payload='')
        WendaoAuthorization.objects.filter(expires_at__lt=timezone.now()).delete()
        WendaoAuthorization.objects.create(state_hash=digest, payload=seal({'verifier': verifier, 'redirect_uri': redirect_uri, 'site': site, 'classroom': classroom.pk if classroom else None}), expires_at=timezone.now() + timedelta(minutes=5))
        row.pending_state = digest
        row.save(update_fields=['pending_state', 'updated_at'])
    query = urlencode({'client_id': settings.WENDAO_OAUTH_CLIENT_ID, 'redirect_uri': redirect_uri, 'response_type': 'code', 'scope': 'models:read chat:write api_key:issue', 'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256'})
    try:
        authorize_url = resolve_authorize_url(site + '/api/v1/oauth/authorize?' + query)
    except ConnectionError:
        WendaoAuthorization.objects.filter(state_hash=digest).update(status='failed', payload='')
        WendaoConnection.objects.filter(pk=1, pending_state=digest).update(pending_state='')
        raise
    return JsonResponse({'authorize_url': authorize_url})


def resolve_authorize_url(url):
    try:
        response = httpx.get(url, timeout=25, follow_redirects=False)
    except httpx.HTTPError as exc:
        raise ConnectionError('暂时无法连接闻道智能，请稍后重试。', 502) from exc
    if response.status_code == 404:
        raise ConnectionError('闻道智能线上授权接口尚未就绪（404）。请部署包含 OAuth 和不想排座位客户端配置的服务端版本，并检查 /api/v1/oauth/authorize 的转发。', 502)
    location = response.headers.get('Location', '')
    parsed = urlsplit(location)
    if response.status_code != 302 or parsed.scheme + '://' + parsed.netloc != site_url() or parsed.path != '/oauth/authorize':
        raise ConnectionError('无法开始授权，请检查服务端客户端登记、回调地址和公开网站地址配置。', 502)
    return location


@local_only
@require_GET
def callback(request):
    state = request.GET.get('state', '')
    digest = hashlib.sha256(state.encode()).hexdigest()
    attempt = WendaoAuthorization.objects.filter(state_hash=digest, expires_at__gt=timezone.now(), status='pending').first()
    if not state or not attempt:
        return render(request, 'seats/wendao_callback.html', {'error': '授权链接已失效，请回到应用重新连接。'}, status=400)
    claimed = WendaoAuthorization.objects.filter(pk=attempt.pk, status='pending').update(status='exchanging', payload='')
    if not claimed:
        return render(request, 'seats/wendao_callback.html', {'error': '此授权已处理，请返回应用。'}, status=400)
    try:
        if request.GET.get('error'):
            raise ConnectionError('你已取消授权，可以回到应用重新连接。')
        if not request.GET.get('code'):
            raise ConnectionError('授权回调缺少授权码。')
        pending = unseal(attempt.payload)
        if pending['site'] != site_url() or connection().pending_state != digest:
            raise ConnectionError('已开始其他授权，请返回应用。')
        token = remote_json('POST', '/api/v1/oauth/token', data={'grant_type': 'authorization_code', 'client_id': settings.WENDAO_OAUTH_CLIENT_ID, 'code': request.GET['code'], 'redirect_uri': pending['redirect_uri'], 'code_verifier': pending['verifier']})
        if not isinstance(token.get('access_token'), str) or not token['access_token']:
            raise ConnectionError('授权响应缺少令牌，请重新连接。', 502)
        value = remote_json('POST', '/api/v1/oauth/credentials', key=token['access_token'])
        if not isinstance(value.get('api_key'), str) or not value['api_key'] or not isinstance(value.get('base_url'), str) or value['base_url'].rstrip('/') != site_url() + '/api/openai/v1':
            raise ConnectionError('返回的 API 凭证或地址无效，请重新连接。', 502)
        value['site'] = site_url()
        changed = WendaoConnection.objects.filter(pk=1, pending_state=digest).update(credentials=seal(value), model='', pending_state='', updated_at=timezone.now())
        if not changed:
            remote_json('POST', '/api/v1/oauth/revoke', key=value['api_key'])
            raise ConnectionError('授权已取消，请返回应用。')
        WendaoAuthorization.objects.filter(pk=attempt.pk).update(status='completed')
        classroom = Classroom.objects.filter(pk=pending.get('classroom')).first() if pending.get('classroom') else None
        return render(request, 'seats/wendao_callback.html', {'classroom': classroom})
    except ConnectionError as exc:
        WendaoAuthorization.objects.filter(pk=attempt.pk).update(status='failed')
        WendaoConnection.objects.filter(pk=1, pending_state=digest).update(pending_state='')
        return render(request, 'seats/wendao_callback.html', {'error': str(exc)}, status=400)


@local_only
@require_GET
def status(request):
    row = connection()
    pending = bool(row.pending_state and WendaoAuthorization.objects.filter(state_hash=row.pending_state, status__in=['pending', 'exchanging'], expires_at__gt=timezone.now()).exists())
    result = {'connected': bool(row.credentials), 'pending': pending, 'model': row.model, 'site': site_url(), 'name_privacy_enabled': name_privacy_enabled()}
    last = WendaoAuthorization.objects.order_by('-pk').first()
    result['authorization_status'] = ('expired' if last.expires_at <= timezone.now() and last.status in {'pending', 'exchanging'} else last.status) if last else None
    if not row.credentials:
        return JsonResponse(result)
    try:
        value = credentials(row)
        result['expires_at'] = value.get('expires_at')
        result['usage'] = remote_json('GET', '/api/openai/v1/usage', key=value['api_key'])
    except ConnectionError as exc:
        result['error'] = str(exc)
        result['reauthorize'] = exc.status in {401, 403}
    return JsonResponse(result)


@local_only
@require_http_methods(['GET', 'POST'])
def name_privacy(request):
    if request.method == 'POST':
        enabled = read_payload(request).get('enabled')
        if not isinstance(enabled, bool):
            raise ConnectionError('请提供有效的脱敏开关状态。')
        FrontendKVStore.objects.update_or_create(
            key=NAME_PRIVACY_STORE_KEY, defaults={'value': 'true' if enabled else 'false'},
        )
    return JsonResponse({'name_privacy_enabled': name_privacy_enabled()})


@local_only
@require_GET
def models(request):
    value = credentials()
    data = remote_json('GET', '/api/openai/v1/models', key=value['api_key'])
    return JsonResponse({'models': [item['id'] for item in data.get('data', []) if isinstance(item, dict) and isinstance(item.get('id'), str)]})


@local_only
@require_POST
def select_model(request):
    value = credentials()
    selected = str(read_payload(request).get('model') or '')
    catalog = remote_json('GET', '/api/openai/v1/models', key=value['api_key'])
    if selected not in [item.get('id') for item in catalog.get('data', []) if isinstance(item, dict)] or len(selected) > 200:
        raise ConnectionError('该模型当前不可用，请刷新模型列表。')
    WendaoConnection.objects.filter(pk=1).update(model=selected)
    return JsonResponse({'model': selected})


@local_only
@require_POST
def disconnect(request):
    row = connection()
    # Invalidate pending callbacks first; retain the key if remote revocation fails.
    WendaoConnection.objects.filter(pk=1).update(pending_state='')
    if row.credentials:
        value = unseal(row.credentials)
        if value.get('site') != site_url():
            raise ConnectionError('请恢复原服务地址后解除授权。')
        try:
            remote_json('POST', '/api/v1/oauth/revoke', key=value['api_key'])
        except ConnectionError as exc:
            if exc.status not in {401, 403}:
                raise
    WendaoConnection.objects.filter(pk=1, credentials=row.credentials).update(credentials='', model='')
    return JsonResponse({'connected': False})


@local_only
@require_POST
def chat(request, pk):
    from . import views
    prepare_chat(request)
    return views.ai_chat(request, pk)


@local_only
@require_POST
def chat_stream(request, pk):
    from . import views
    prepare_chat(request)
    return views.ai_chat_stream(request, pk)


def prepare_chat(request):
    data = read_payload(request)
    action = data.get('action', 'message')
    if action not in {'message', 'tool_approval', 'conversation_init', 'conversation_create', 'conversation_switch', 'conversation_delete'}:
        raise ConnectionError('不支持此操作。')
    data.pop('client_config', None)
    if action in {'message', 'tool_approval'}:
        row = connection()
        value = credentials(row)
        if not row.model:
            raise ConnectionError('请先选择模型。')
        data['client_config'] = {'api_key': value['api_key'], 'base_url': value['base_url'], 'model': row.model}
    request._body = json.dumps(data).encode()
    request._wendao_authorized = True
