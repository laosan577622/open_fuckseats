import json

import desktop_access
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from seats.constraints import get_constraint_type_definitions, get_tag_rule_type_definitions
from seats.models import Classroom
from .auth import (
    get_or_create_open_api_key,
    read_access_error,
    read_access_state,
    require_open_api_auth,
)
from .openapi import build_openapi_schema
from .registry import ToolExecutionError, registry
from .serializers import (
    ARRANGE_MODE_DEFINITIONS,
    classroom_detail_payload,
    serialize_classroom,
    serialize_constraints_for_classroom,
    serialize_groups,
    serialize_seat_map,
    serialize_snapshot,
    serialize_student,
    serialize_tags_for_classroom,
)
from . import tools as _tools  # noqa: F401 - import registers tools


def _json_body(request):
    try:
        raw = request.body.decode('utf-8') if request.body else '{}'
        data = json.loads(raw or '{}')
    except json.JSONDecodeError as exc:
        raise ValueError('JSON 请求体格式错误') from exc
    if not isinstance(data, dict):
        raise ValueError('JSON 请求体必须是对象')
    return data


def _error_response(message, *, code='BAD_REQUEST', status=400):
    return JsonResponse({'status': 'error', 'error': str(message), 'code': code}, status=status)


def _categories(request=None):
    result = {}
    for tool in registry.available_tools(request):
        bucket = result.setdefault(tool.category, {'tools': [], 'read': 0, 'write': 0})
        bucket['tools'].append(tool.name)
        if tool.read_only:
            bucket['read'] += 1
        else:
            bucket['write'] += 1
    return result


def _read_access_payload(state):
    return {
        'status': 'ok', **state,
        'scopes': list(desktop_access.READ_ACCESS_SCOPES),
        'read_only': True, 'session_only': True,
        'base_url': 'http://127.0.0.1:23948/open_api',
    }


@csrf_exempt
@require_http_methods(['POST'])
def request_read_access(request):
    # A request only queues a native prompt. It never grants access itself.
    if request.META.get('REMOTE_ADDR') not in {'127.0.0.1', '::1'} or (
        request.headers.get('origin') or request.headers.get('sec-fetch-site')
    ):
        return _error_response('授权申请仅接受本机桌面程序', code='LOCAL_CLIENT_REQUIRED', status=403)
    if request.content_type != 'application/json':
        return _error_response('授权申请必须使用 application/json', status=415)
    try:
        content_length = int(request.META.get('CONTENT_LENGTH') or 0)
    except (TypeError, ValueError):
        return _error_response('Content-Length 格式错误')
    if content_length > 4096:
        return _error_response('授权申请过大', status=413)
    if not desktop_access.read_access_broker.running:
        return _error_response('桌面授权服务尚未就绪', code='DESKTOP_NOT_READY', status=503)
    try:
        if len(request.body) > 4096:
            return _error_response('授权申请过大', status=413)
        data = _json_body(request)
        access_request = desktop_access.ReadAccessRequest(data.get('client_name'), data.get('token'))
        state = desktop_access.read_access_broker.submit(access_request)
    except (ValueError, UnicodeDecodeError) as exc:
        return _error_response(exc)
    if state['authorization'] == 'denied':
        return read_access_error(state)
    return JsonResponse(_read_access_payload(state), status=200 if state['authorization'] == 'granted' else 202)


@require_http_methods(['GET'])
def read_access_status(request):
    state = read_access_state(request)
    if state is None or state['authorization'] == 'denied':
        return read_access_error(state)
    return JsonResponse(_read_access_payload(state), status=200 if state['authorization'] == 'granted' else 202)


@require_open_api_auth
@require_http_methods(['GET'])
def discovery(request):
    read_only = getattr(request, 'open_api_read_only', False)
    authentication = {'type': 'bearer', 'header': 'Authorization: Bearer <key>'}
    if read_only:
        authentication.update({
            'read_only': True, 'session_only': True,
            'client_name': request.open_api_client_name,
            'scopes': list(desktop_access.READ_ACCESS_SCOPES),
        })
    else:
        key = get_or_create_open_api_key()
        authentication['api_key_preview'] = f'{key[:8]}...{key[-4:]}' if len(key) > 16 else 'configured'
    tools = registry.schemas(request=request)
    return JsonResponse({
        'status': 'ok',
        'name': '不想排座位 Open API',
        'version': '0.3.0',
        'developer': {'name': '老三', 'website': 'www.577622.xyz'},
        'instructions': '此凭证仅允许读取班级、座位排列和学生资料。' if read_only else "本系统提供教室座位管理能力。对于标注了'请先向用户口头确认'的工具，请在调用前先询问用户的意见。",
        'authentication': authentication,
        'routes': {
            'classrooms': '/open_api/classrooms',
            'execute': '/open_api/tools/execute',
            'batch': '/open_api/tools/batch',
            'openapi': '/open_api/openapi.json',
            'access_status': '/open_api/access/status',
        },
        'tool_count': len(tools),
        'categories': _categories(request),
        'tools': tools,
    })


@require_open_api_auth
@require_http_methods(['GET'])
def classrooms(request):
    qs = Classroom.objects.all().order_by('-created_at', '-pk')
    keyword = str(request.GET.get('keyword') or '').strip()
    if keyword:
        qs = qs.filter(name__icontains=keyword)
    return JsonResponse({
        'status': 'ok',
        'classrooms': [serialize_classroom(classroom) for classroom in qs],
        'total': qs.count(),
    })


@require_open_api_auth
@require_http_methods(['GET'])
def classroom_detail(request, classroom_id):
    classroom = Classroom.objects.get(pk=classroom_id)
    return JsonResponse({
        'status': 'ok',
        **classroom_detail_payload(classroom, include_tools=True, tools=registry.schemas(request=request)),
    })


@require_open_api_auth
@require_http_methods(['GET'])
def classroom_enums(request, classroom_id):
    Classroom.objects.get(pk=classroom_id)
    return JsonResponse({
        'status': 'ok',
        'arrange_modes': ARRANGE_MODE_DEFINITIONS,
        'cell_types': [{'value': value, 'label': label} for value, label in [
            ('seat', '座位'),
            ('aisle', '走廊'),
            ('podium', '讲台'),
            ('empty', '空位'),
        ]],
        'constraint_types': get_constraint_type_definitions(),
        'tag_rule_types': get_tag_rule_type_definitions(),
        'gender': [{'value': 'M', 'label': '男'}, {'value': 'F', 'label': '女'}],
    })


@require_open_api_auth
@require_http_methods(['GET'])
def classroom_seats(request, classroom_id):
    classroom = Classroom.objects.get(pk=classroom_id)
    return JsonResponse({'status': 'ok', **serialize_seat_map(classroom)})


@require_open_api_auth
@require_http_methods(['GET'])
def classroom_students(request, classroom_id):
    classroom = Classroom.objects.get(pk=classroom_id)
    students = classroom.students.select_related('assigned_seat__group').order_by('name', 'pk')
    return JsonResponse({'status': 'ok', 'students': [serialize_student(student, classroom) for student in students]})


@require_open_api_auth
@require_http_methods(['GET'])
def classroom_constraints(request, classroom_id):
    classroom = Classroom.objects.get(pk=classroom_id)
    return JsonResponse({'status': 'ok', **serialize_constraints_for_classroom(classroom)})


@require_open_api_auth
@require_http_methods(['GET'])
def classroom_groups(request, classroom_id):
    classroom = Classroom.objects.get(pk=classroom_id)
    return JsonResponse({'status': 'ok', 'groups': serialize_groups(classroom)})


@require_open_api_auth
@require_http_methods(['GET'])
def classroom_snapshots(request, classroom_id):
    classroom = Classroom.objects.get(pk=classroom_id)
    return JsonResponse({
        'status': 'ok',
        'snapshots': [serialize_snapshot(snapshot) for snapshot in classroom.layout_snapshots.order_by('-created_at', '-pk')],
    })


@require_open_api_auth
@require_http_methods(['GET'])
def classroom_tags(request, classroom_id):
    classroom = Classroom.objects.get(pk=classroom_id)
    return JsonResponse({'status': 'ok', **serialize_tags_for_classroom(classroom)})


@require_open_api_auth
@require_http_methods(['POST'])
def execute_tool(request):
    try:
        data = _json_body(request)
        tool_name = str(data.get('tool') or '').strip()
        if not tool_name:
            raise ToolExecutionError('缺少 tool', code='TOOL_REQUIRED', status=400)
        payload = registry.execute(
            tool_name,
            classroom_id=data.get('classroom_id'),
            arguments=data.get('arguments') or {},
            request=request,
        )
        return JsonResponse(payload)
    except ToolExecutionError as exc:
        return _error_response(exc, code=exc.code, status=exc.status)
    except Classroom.DoesNotExist:
        return _error_response('教室不存在', code='CLASSROOM_NOT_FOUND', status=404)
    except ValueError as exc:
        return _error_response(exc)


@require_open_api_auth
@require_http_methods(['POST'])
def batch_tools(request):
    try:
        data = _json_body(request)
        operations = data.get('operations') or []
        if not isinstance(operations, list) or not operations:
            raise ToolExecutionError('operations 必须是非空数组', code='OPERATIONS_REQUIRED', status=400)
        if len(operations) > 200:
            raise ToolExecutionError('单批最多 200 个操作', code='BATCH_TOO_LARGE', status=400)
        results = []
        with transaction.atomic():
            for operation in operations:
                if not isinstance(operation, dict):
                    raise ToolExecutionError('operation 必须是对象', code='INVALID_OPERATION', status=400)
                results.append(registry.execute(
                    operation.get('tool'),
                    classroom_id=operation.get('classroom_id') or data.get('classroom_id'),
                    arguments=operation.get('arguments') or {},
                    request=request,
                ))
        return JsonResponse({'status': 'ok', 'results': results, 'count': len(results)})
    except ToolExecutionError as exc:
        return _error_response(exc, code=exc.code, status=exc.status)
    except Classroom.DoesNotExist:
        return _error_response('教室不存在', code='CLASSROOM_NOT_FOUND', status=404)
    except ValueError as exc:
        return _error_response(exc)


@require_open_api_auth
@require_http_methods(['GET'])
def openapi_json(request):
    return JsonResponse(build_openapi_schema('/open_api', request=request))
