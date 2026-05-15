import json
import secrets
import urllib.parse
from datetime import timedelta

from django.http import HttpResponseRedirect, JsonResponse
from django.views.decorators.http import require_http_methods
from django.utils import timezone

from .auth import issue_session, require_session, user_payload
from .config import (
    get_config,
    get_data_limit,
    get_server_base_url,
    get_tier_display_name,
    get_tier_limits,
    subscription_payload,
)
from .models import CloudClassroom, CloudSnapshot, PendingLogin, RedeemCode
from .oauth import OAuthError, exchange_code_for_token, fetch_userinfo, refresh_user_subscription, upsert_cloud_user
from .sync import check_payload_size, payload_size_bytes, push_classroom_snapshot, validate_push_payload, validate_snapshot_for_user
from .crypto import decrypt_payload, encrypt_payload, ensure_service_key, public_key_payload


def _json_body(request):
    try:
        return json.loads((request.body or b'{}').decode('utf-8') or '{}')
    except Exception:
        raise ValueError('请求数据格式错误')


def _json_error(message, status=400, **extra):
    payload = {'ok': False, 'status': 'error', 'message': str(message)}
    payload.update(extra)
    return JsonResponse(payload, status=status)


def _service_key_payload():
    return public_key_payload(ensure_service_key())


def _is_encrypted_request(data):
    return isinstance(data, dict) and isinstance(data.get('encrypted'), dict)


def _decrypt_request_if_needed(request, data, session=None):
    if not _is_encrypted_request(data):
        if session is not None:
            raise ValueError('云端接口已要求端到端加密请求')
        return data

    service_key = ensure_service_key()
    encrypted = data.get('encrypted')
    try:
        payload = decrypt_payload(encrypted, service_key.private_key_pem)
    except Exception as exc:
        raise ValueError(f'解密请求失败：{exc}')

    sender_key_id = str(encrypted.get('sender_key_id') or '')
    expected_key_id = ''
    if session is not None:
        expected_key_id = str(getattr(session, 'client_key_id', '') or '')
        if expected_key_id and sender_key_id and sender_key_id != expected_key_id:
            raise ValueError('客户端密钥标识不匹配')
    elif payload.get('client_key_id'):
        expected_key_id = str(payload.get('client_key_id') or '')

    payload['_encrypted_request'] = True
    payload['_sender_key_id'] = sender_key_id
    if expected_key_id:
        payload['_expected_client_key_id'] = expected_key_id
    return payload


def _encrypted_json_response(payload, *, session=None, client_public_key_pem='', client_key_id='', status=200):
    if session is not None:
        client_public_key_pem = str(getattr(session, 'client_public_key_pem', '') or client_public_key_pem or '')
        client_key_id = str(getattr(session, 'client_key_id', '') or client_key_id or '')
    if not client_public_key_pem:
        return _json_error('客户端未提供加密公钥，拒绝明文返回云端数据', status=400, error='missing_client_public_key')

    envelope = encrypt_payload(payload, client_public_key_pem, sender_key_id=ensure_service_key().key_id)
    response_payload = {
        'ok': True,
        'status': payload.get('status') or 'success',
        'encrypted': envelope,
        'server_key': _service_key_payload(),
    }
    if client_key_id:
        response_payload['client_key_id'] = client_key_id
    return JsonResponse(response_payload, status=status)


def _append_query(url, params):
    separator = '&' if urllib.parse.urlparse(url).query else '?'
    return f'{url}{separator}{urllib.parse.urlencode(params)}'


def _oauth_redirect_uri():
    return f'{get_server_base_url()}/auth/oauth-callback'


def _session_code_expired(pending):
    ttl = get_data_limit('session_code_ttl_seconds', 60)
    created_at = pending.session_code_created_at or pending.created_at
    return created_at + timedelta(seconds=ttl) < timezone.now()


def health(request):
    return JsonResponse({'ok': True, 'status': 'success', 'service': 'fuckseats-cloud-backend'})


@require_http_methods(['GET'])
def auth_login(request):
    callback_url = str(request.GET.get('callback') or '').strip()
    if not callback_url:
        return _json_error('缺少 callback')
    client_public_key = str(request.GET.get('client_public_key') or '').strip()
    client_key_id = str(request.GET.get('client_key_id') or '').strip()
    if not client_public_key:
        return _json_error('缺少客户端加密公钥', status=400, error='missing_client_public_key')
    if not client_key_id:
        return _json_error('缺少客户端密钥标识', status=400, error='missing_client_key_id')

    oauth_config = get_config().get('laosan_oauth', {})
    client_id = str(oauth_config.get('client_id') or '').strip()
    authorize_url = str(oauth_config.get('authorize_url') or '').strip()
    if not client_id or not authorize_url:
        return _json_error('云端 OAuth client_id 或 authorize_url 未配置', status=500)

    state = secrets.token_urlsafe(32)
    PendingLogin.objects.create(
        state=state,
        callback_url=callback_url,
        client_key_id=client_key_id[:96],
        client_public_key_pem=client_public_key,
    )

    query = urllib.parse.urlencode({
        'response_type': 'code',
        'client_id': client_id,
        'redirect_uri': _oauth_redirect_uri(),
        'scope': str(oauth_config.get('scope') or 'email nickname subscriptions'),
        'state': state,
    })
    return HttpResponseRedirect(f'{authorize_url}?{query}')


@require_http_methods(['GET'])
def auth_oauth_callback(request):
    state = str(request.GET.get('state') or '').strip()
    code = str(request.GET.get('code') or '').strip()
    oauth_error = str(request.GET.get('error') or '').strip()

    pending = PendingLogin.objects.filter(state=state, used=False).first()
    if not pending:
        return _json_error('登录状态不存在或已过期', status=400)

    if oauth_error:
        pending.oauth_error = oauth_error[:200]
        pending.save(update_fields=['oauth_error'])
        return HttpResponseRedirect(_append_query(pending.callback_url, {'error': oauth_error}))

    if not code:
        return HttpResponseRedirect(_append_query(pending.callback_url, {'error': 'missing_code'}))

    try:
        token_payload = exchange_code_for_token(code, redirect_uri=_oauth_redirect_uri())
        userinfo = fetch_userinfo(token_payload['access_token'])
        user = upsert_cloud_user(userinfo, token_payload)
    except OAuthError as exc:
        pending.oauth_error = str(exc)[:200]
        pending.save(update_fields=['oauth_error'])
        return HttpResponseRedirect(_append_query(pending.callback_url, {'error': 'oauth_failed'}))

    pending.user = user
    pending.session_code = secrets.token_urlsafe(32)
    pending.session_code_created_at = timezone.now()
    pending.save(update_fields=['user', 'session_code', 'session_code_created_at'])
    return HttpResponseRedirect(_append_query(pending.callback_url, {'code': pending.session_code}))


@require_http_methods(['POST'])
def auth_exchange(request):
    try:
        raw_data = _json_body(request)
    except ValueError as exc:
        return _json_error(exc)
    try:
        data = _decrypt_request_if_needed(request, raw_data)
    except ValueError as exc:
        return _json_error(exc)

    code = str(data.get('code') or '').strip()
    pending = PendingLogin.objects.select_related('user').filter(session_code=code, used=False).first()
    if not pending or not pending.user_id:
        return _json_error('session_code 无效', status=400, error='invalid_code')
    if _session_code_expired(pending):
        return _json_error('session_code 已过期', status=400, error='expired_code')

    client_key_id = str(data.get('client_key_id') or pending.client_key_id or '')[:96]
    client_public_key = str(data.get('client_public_key') or pending.client_public_key_pem or '')
    if not client_public_key:
        return _json_error('缺少客户端加密公钥，拒绝明文签发 session_token', status=400, error='missing_client_public_key')
    if not client_key_id:
        return _json_error('缺少客户端密钥标识，拒绝签发 session_token', status=400, error='missing_client_key_id')
    session = issue_session(
        pending.user,
        device_id=data.get('device_id') or '',
        client_key_id=client_key_id,
        client_public_key_pem=client_public_key,
    )
    pending.used = True
    pending.save(update_fields=['used'])

    user = pending.user
    response_payload = {
        'ok': True,
        'status': 'success',
        'session_token': session.token,
        'token_expires_at': session.expires_at.isoformat(),
        'uid': user.uid,
        'nickname': user.nickname,
        'email': user.email,
        'avatar_url': user.avatar_url,
        'subscription': subscription_payload(user.subscription_tier, user.subscription_expires_at),
        'server_key': _service_key_payload(),
        'client_key_id': client_key_id,
    }
    return _encrypted_json_response(
        response_payload,
        client_public_key_pem=client_public_key,
        client_key_id=client_key_id,
    )


@require_http_methods(['POST'])
@require_session
def auth_logout(request):
    request.cloud_session.delete()
    return _encrypted_json_response({'ok': True, 'status': 'success'}, session=request.cloud_session)


@require_http_methods(['GET'])
@require_session
def api_me(request):
    return _encrypted_json_response({'ok': True, 'status': 'success', **user_payload(request.cloud_user)}, session=request.cloud_session)


@require_http_methods(['POST'])
@require_session
def api_refresh_subscription(request):
    try:
        user = refresh_user_subscription(request.cloud_user)
    except OAuthError as exc:
        return _json_error(f'刷新订阅失败：{exc}', status=502)
    return _encrypted_json_response({'ok': True, 'status': 'success', **user_payload(user)}, session=request.cloud_session)


@require_http_methods(['GET'])
@require_session
def sync_status(request):
    classrooms = CloudClassroom.objects.filter(user=request.cloud_user, is_deleted=False).order_by('-updated_at')
    rows = [
        {
            'uuid': str(item.uuid),
            'name': item.name,
            'version': item.version,
            'updated_at': item.updated_at.isoformat(),
            'last_operation_at': item.last_modified_at.isoformat() if item.last_modified_at else None,
            'last_modified_at': item.last_modified_at.isoformat() if item.last_modified_at else None,
        }
        for item in classrooms
    ]
    return _encrypted_json_response({
        'ok': True,
        'status': 'success',
        'classrooms': rows,
        'versions': {item['uuid']: item['version'] for item in rows},
        'operation_times': {item['uuid']: item['last_operation_at'] for item in rows if item.get('last_operation_at')},
    }, session=request.cloud_session)


@require_http_methods(['POST'])
@require_session
def sync_push(request):
    try:
        raw_payload = _json_body(request)
        payload = _decrypt_request_if_needed(request, raw_payload, session=request.cloud_session)
        result = push_classroom_snapshot(request.cloud_user, payload)
        if result.get('conflict'):
            return _encrypted_json_response({'status': 'error', **result}, session=request.cloud_session, status=409)
        return _encrypted_json_response({'status': 'success', **result}, session=request.cloud_session)
    except PermissionError as exc:
        return _json_error(exc, status=403)
    except ValueError as exc:
        return _json_error(exc, status=400)


@require_http_methods(['POST'])
@require_session
def sync_push_batch(request):
    try:
        raw_payload = _json_body(request)
    except ValueError as exc:
        return _json_error(exc)
    try:
        payload = _decrypt_request_if_needed(request, raw_payload, session=request.cloud_session)
    except ValueError as exc:
        return _json_error(exc)

    items = payload.get('items') or payload.get('classrooms') or []
    if not isinstance(items, list):
        return _json_error('items 必须是数组')
    try:
        check_payload_size(items, 'max_batch_push_size_mb')
    except ValueError as exc:
        return _json_error(exc, status=413)

    try:
        for item in items:
            validate_push_payload(request.cloud_user, item)
    except ValueError as exc:
        return _json_error(exc, status=400)
    except PermissionError as exc:
        return _json_error(exc, status=403)

    results = []
    for item in items:
        try:
            result = push_classroom_snapshot(request.cloud_user, item)
            results.append({'status': 'conflict' if result.get('conflict') else 'ok', **result})
        except PermissionError as exc:
            results.append({'status': 'error', 'message': str(exc)})
        except ValueError as exc:
            results.append({'status': 'error', 'message': str(exc)})
    return _encrypted_json_response({'ok': True, 'status': 'success', 'results': results}, session=request.cloud_session)


@require_http_methods(['GET'])
@require_session
def sync_pull(request, classroom_uuid):
    classroom = CloudClassroom.objects.filter(user=request.cloud_user, uuid=classroom_uuid, is_deleted=False).first()
    if not classroom:
        return _json_error('班级不存在', status=404)
    return _encrypted_json_response({
        'ok': True,
        'status': 'success',
        'uuid': str(classroom.uuid),
        'name': classroom.name,
        'version': classroom.version,
        'data': classroom.data_snapshot,
        'updated_at': classroom.updated_at.isoformat(),
        'last_operation_at': classroom.last_modified_at.isoformat() if classroom.last_modified_at else None,
        'last_modified_at': classroom.last_modified_at.isoformat() if classroom.last_modified_at else None,
    }, session=request.cloud_session)


@require_http_methods(['DELETE'])
@require_session
def sync_delete(request, classroom_uuid):
    try:
        raw_payload = _json_body(request)
    except ValueError:
        raw_payload = {}
    try:
        payload = _decrypt_request_if_needed(request, raw_payload, session=request.cloud_session)
    except ValueError as exc:
        return _json_error(exc)

    classroom = CloudClassroom.objects.filter(user=request.cloud_user, uuid=classroom_uuid).first()
    if not classroom:
        return _json_error('班级不存在', status=404)

    if not classroom.is_deleted:
        classroom.is_deleted = True
        classroom.version = int(classroom.version or 0) + 1
        classroom.last_modified_by = str(payload.get('device_id') or '')[:64]
        classroom.last_modified_at = timezone.now()
        classroom.save(update_fields=['is_deleted', 'version', 'last_modified_by', 'last_modified_at', 'updated_at'])

    return _encrypted_json_response({'ok': True, 'status': 'success', 'uuid': str(classroom.uuid), 'version': classroom.version}, session=request.cloud_session)


@require_http_methods(['GET'])
@require_session
def snapshots_list(request, classroom_uuid):
    classroom = CloudClassroom.objects.filter(user=request.cloud_user, uuid=classroom_uuid, is_deleted=False).first()
    if not classroom:
        return _json_error('班级不存在', status=404)
    snapshots = [
        {
            'id': item.pk,
            'name': item.name,
            'size_bytes': item.size_bytes,
            'created_at': item.created_at.isoformat(),
        }
        for item in classroom.snapshots.all()
    ]
    return _encrypted_json_response({'ok': True, 'status': 'success', 'classroom_uuid': str(classroom.uuid), 'snapshots': snapshots}, session=request.cloud_session)


@require_http_methods(['POST'])
@require_session
def snapshots_create(request):
    try:
        raw_payload = _json_body(request)
    except ValueError as exc:
        return _json_error(exc)
    try:
        payload = _decrypt_request_if_needed(request, raw_payload, session=request.cloud_session)
    except ValueError as exc:
        return _json_error(exc)

    classroom = CloudClassroom.objects.filter(user=request.cloud_user, uuid=payload.get('classroom_uuid'), is_deleted=False).first()
    if not classroom:
        return _json_error('班级不存在', status=404)

    limits = get_tier_limits(request.cloud_user.subscription_tier)
    max_snapshots = int(limits.get('max_snapshots_per_classroom', 3) or 3)
    if max_snapshots != -1 and classroom.snapshots.count() >= max_snapshots:
        return _json_error(f'当前订阅每班最多保留 {max_snapshots} 个快照', status=403)

    data = payload.get('data') if isinstance(payload.get('data'), dict) else classroom.data_snapshot
    try:
        check_payload_size(data, 'max_push_size_mb')
        validate_snapshot_for_user(request.cloud_user, data)
    except PermissionError as exc:
        return _json_error(exc, status=403)
    except ValueError as exc:
        return _json_error(exc, status=400)

    size_bytes = payload_size_bytes(data)
    snapshot = CloudSnapshot.objects.create(
        classroom=classroom,
        name=str(payload.get('name') or '手动快照')[:80],
        data=data,
        size_bytes=size_bytes,
    )
    return _encrypted_json_response({
        'ok': True,
        'status': 'success',
        'snapshot': {
            'id': snapshot.pk,
            'name': snapshot.name,
            'size_bytes': snapshot.size_bytes,
            'created_at': snapshot.created_at.isoformat(),
        },
    }, session=request.cloud_session)


@require_http_methods(['GET'])
@require_session
def snapshots_download(request, snapshot_id):
    snapshot = CloudSnapshot.objects.select_related('classroom').filter(
        pk=snapshot_id,
        classroom__user=request.cloud_user,
        classroom__is_deleted=False,
    ).first()
    if not snapshot:
        return _json_error('快照不存在', status=404)
    return _encrypted_json_response({
        'ok': True,
        'status': 'success',
        'id': snapshot.pk,
        'name': snapshot.name,
        'classroom_uuid': str(snapshot.classroom.uuid),
        'data': snapshot.data,
        'created_at': snapshot.created_at.isoformat(),
    }, session=request.cloud_session)


@require_http_methods(['DELETE'])
@require_session
def snapshots_delete(request, snapshot_id):
    snapshot = CloudSnapshot.objects.filter(
        pk=snapshot_id,
        classroom__user=request.cloud_user,
    ).first()
    if not snapshot:
        return _json_error('快照不存在', status=404)
    snapshot.delete()
    return _encrypted_json_response({'ok': True, 'status': 'success'}, session=request.cloud_session)


@require_http_methods(['GET'])
def subscription_plans(request):
    subscription = get_config().get('subscription', {})
    tiers = subscription.get('tiers', {})
    priority = subscription.get('priority') or []
    order = priority + [k for k in tiers if k not in priority]
    plans = []
    for name in order:
        tier = tiers.get(name)
        if not tier:
            continue
        plans.append({
            'tier': name,
            'key': name,
            'display_name': get_tier_display_name(name),
            'description': tier.get('description', ''),
            'price': tier.get('price', ''),
            'purchase_url': tier.get('purchase_url', ''),
            'service_identifier': tier.get('service_identifier'),
            'limits': get_tier_limits(name),
        })
    return JsonResponse({'ok': True, 'status': 'success', 'plans': plans})


@require_http_methods(['POST'])
@require_session
def subscription_redeem(request):
    try:
        raw_payload = _json_body(request)
    except ValueError as exc:
        return _json_error(exc)
    try:
        payload = _decrypt_request_if_needed(request, raw_payload, session=request.cloud_session)
    except ValueError as exc:
        return _json_error(exc)

    code = str(payload.get('code') or '').strip()
    redeem_code = RedeemCode.objects.filter(code=code).first()
    if not redeem_code or not redeem_code.can_use():
        return _json_error('兑换码无效或已用完', status=400)

    request.cloud_user.subscription_tier = redeem_code.tier
    request.cloud_user.subscription_expires_at = redeem_code.expires_at
    request.cloud_user.save(update_fields=['subscription_tier', 'subscription_expires_at', 'updated_at'])
    redeem_code.used_count += 1
    redeem_code.save(update_fields=['used_count'])
    return _encrypted_json_response({'ok': True, 'status': 'success', **user_payload(request.cloud_user)}, session=request.cloud_session)


@require_http_methods(['GET'])
def subscription_purchase_url(request):
    tier = str(request.GET.get('tier') or request.GET.get('plan') or '').strip()
    subscription = get_config().get('subscription', {})
    tiers = subscription.get('tiers', {})
    tier_config = tiers.get(tier, {})
    purchase_url = str(tier_config.get('purchase_url') or '').strip()
    if not purchase_url:
        purchase_url = str(subscription.get('purchase_url') or '').strip()
    if purchase_url and tier:
        purchase_url = _append_query(purchase_url, {'tier': tier})
    return JsonResponse({
        'ok': bool(purchase_url),
        'status': 'success' if purchase_url else 'not_configured',
        'tier': tier,
        'url': purchase_url,
    })
