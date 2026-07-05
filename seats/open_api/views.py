import json

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from seats.constraints import get_constraint_type_definitions, get_tag_rule_type_definitions
from seats.models import Classroom
from .auth import get_or_create_open_api_key, require_open_api_auth
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


def _categories():
    result = {}
    for tool in registry.all():
        bucket = result.setdefault(tool.category, {'tools': [], 'read': 0, 'write': 0})
        bucket['tools'].append(tool.name)
        if tool.read_only:
            bucket['read'] += 1
        else:
            bucket['write'] += 1
    return result


@require_open_api_auth
@require_http_methods(['GET'])
def discovery(request):
    key = get_or_create_open_api_key()
    return JsonResponse({
        'status': 'ok',
        'name': '不想排座位 Open API',
        'version': '0.3.0',
        'developer': {'name': '老三', 'website': 'www.577622.xyz'},
        'instructions': "本系统提供教室座位管理能力。对于标注了'请先向用户口头确认'的工具，请在调用前先询问用户的意见。",
        'authentication': {
            'type': 'bearer',
            'header': 'Authorization: Bearer <key>',
            'api_key_preview': f'{key[:8]}...{key[-4:]}' if len(key) > 16 else 'configured',
        },
        'routes': {
            'classrooms': '/open_api/classrooms',
            'execute': '/open_api/tools/execute',
            'batch': '/open_api/tools/batch',
            'openapi': '/open_api/openapi.json',
        },
        'tool_count': len(registry.all()),
        'categories': _categories(),
        'tools': registry.schemas(),
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
        **classroom_detail_payload(classroom, include_tools=True, tools=registry.schemas()),
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
    return JsonResponse(build_openapi_schema('/open_api'))
