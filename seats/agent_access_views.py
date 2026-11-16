"""应用界面处理 Agent 授权：列出待确认的申请，由用户允许或拒绝；查看和撤销已有授权。"""
import json

from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

from .open_api import realtime
from .open_api.agent_access import agent_access_broker


def pending_payload():
    return [
        {
            'id': item['request_id'],
            'client_name': item['client_name'],
            'reason': item['reason'],
            'scope': item['requested_scope'],
        }
        for item in agent_access_broker.pending()
    ]


def grants_payload():
    return [
        {
            'id': item['request_id'],
            'client_name': item['client_name'],
            'scope': item['scope'],
            'duration': item['duration'],
            'granted_at': item['granted_at'],
            'expires_at': item['expires_at'],
        }
        for item in agent_access_broker.grants()
    ]


@require_GET
def pending(request):
    return JsonResponse({'status': 'success', 'requests': pending_payload()})


@require_POST
def decide(request, request_id):
    try:
        data = json.loads(request.body or b'{}')
        if not isinstance(data, dict):
            raise ValueError
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'status': 'error', 'message': '请求格式错误'}, status=400)
    try:
        state = agent_access_broker.decide(request_id, data.get('decision'), data.get('duration') or 'session')
    except LookupError as exc:
        return JsonResponse({'status': 'error', 'message': str(exc), 'requests': pending_payload()}, status=404)
    except ValueError as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=400)
    except (OverflowError, RuntimeError) as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=409)
    realtime.bump()
    return JsonResponse({
        'status': 'success',
        'authorization': state['authorization'],
        'scope': state['scope'],
        'duration': state['duration'],
        'expires_at': state['expires_at'],
        'client_name': state['client_name'],
        'requests': pending_payload(),
    })


@require_GET
def grants(request):
    return JsonResponse({'status': 'success', 'grants': grants_payload()})


@require_POST
def revoke(request, grant_id):
    try:
        agent_access_broker.revoke(grant_id)
    except LookupError as exc:
        return JsonResponse({'status': 'error', 'message': str(exc), 'grants': grants_payload()}, status=404)
    except RuntimeError as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=409)
    return JsonResponse({'status': 'success', 'grants': grants_payload()})
