import json
import sys
from urllib.parse import urlparse

from django.test import RequestFactory
from django.contrib.sessions.backends.db import SessionStore

from seats.models import Classroom
from .registry import ToolExecutionError, registry
from .serializers import classroom_detail_payload, serialize_classroom, serialize_seat_map, serialize_student
from . import tools as _tools  # noqa: F401 - import registers tools


SERVER_INSTRUCTIONS = (
    "本系统提供教室座位管理能力。对于标注了'请先向用户口头确认'的工具，"
    "请在调用前先询问用户的意见。你拥有全部操作权限，但请对用户的教室数据负责。"
)


def _mcp_request():
    request = RequestFactory().post('/open_api/mcp')
    request.session = SessionStore()
    request.user = None
    return request


def _json_text(data):
    return json.dumps(data, ensure_ascii=False, indent=2)


def _result(request_id, result):
    return {'jsonrpc': '2.0', 'id': request_id, 'result': result}


def _error(request_id, code, message, data=None):
    payload = {'jsonrpc': '2.0', 'id': request_id, 'error': {'code': code, 'message': str(message)}}
    if data is not None:
        payload['error']['data'] = data
    return payload


def _resource_list():
    resources = [{
        'uri': 'fuckseats://classrooms',
        'name': 'classrooms',
        'title': '所有教室',
        'mimeType': 'application/json',
    }]
    for classroom in Classroom.objects.all().order_by('name', 'pk'):
        resources.extend([
            {
                'uri': f'fuckseats://classrooms/{classroom.pk}',
                'name': f'classroom-{classroom.pk}',
                'title': classroom.name,
                'mimeType': 'application/json',
            },
            {
                'uri': f'fuckseats://classrooms/{classroom.pk}/seats',
                'name': f'classroom-{classroom.pk}-seats',
                'title': f'{classroom.name} 座位',
                'mimeType': 'application/json',
            },
            {
                'uri': f'fuckseats://classrooms/{classroom.pk}/students',
                'name': f'classroom-{classroom.pk}-students',
                'title': f'{classroom.name} 学生',
                'mimeType': 'application/json',
            },
        ])
    return resources


def _read_resource(uri):
    parsed = urlparse(uri)
    if parsed.scheme != 'fuckseats':
        raise ValueError('不支持的资源 URI')
    parts = [part for part in parsed.path.strip('/').split('/') if part]
    if parsed.netloc == 'classrooms' and not parts:
        payload = {'classrooms': [serialize_classroom(item) for item in Classroom.objects.all().order_by('name', 'pk')]}
    elif parsed.netloc == 'classrooms' and len(parts) == 1:
        classroom = Classroom.objects.get(pk=int(parts[0]))
        payload = classroom_detail_payload(classroom, include_tools=False)
    elif parsed.netloc == 'classrooms' and len(parts) == 2 and parts[1] == 'seats':
        classroom = Classroom.objects.get(pk=int(parts[0]))
        payload = serialize_seat_map(classroom)
    elif parsed.netloc == 'classrooms' and len(parts) == 2 and parts[1] == 'students':
        classroom = Classroom.objects.get(pk=int(parts[0]))
        payload = {
            'students': [
                serialize_student(student, classroom)
                for student in classroom.students.select_related('assigned_seat__group').order_by('name', 'pk')
            ],
        }
    else:
        raise ValueError('资源不存在')
    return {
        'contents': [{
            'uri': uri,
            'mimeType': 'application/json',
            'text': _json_text(payload),
        }],
    }


def handle_mcp_message(message):
    method = message.get('method')
    request_id = message.get('id')
    params = message.get('params') or {}

    if method == 'initialize':
        protocol_version = params.get('protocolVersion') or '2024-11-05'
        return _result(request_id, {
            'protocolVersion': protocol_version,
            'serverInfo': {
                'name': 'fuckseats',
                'version': '0.3.0',
                'instructions': SERVER_INSTRUCTIONS,
            },
            'capabilities': {
                'tools': {'listChanged': False},
                'resources': {'subscribe': False, 'listChanged': False},
            },
        })

    if method in {'notifications/initialized', 'notifications/cancelled'}:
        return None

    if method == 'tools/list':
        return _result(request_id, {'tools': registry.mcp_schemas()})

    if method == 'tools/call':
        name = params.get('name')
        arguments = params.get('arguments') or {}
        try:
            payload = registry.execute(
                name,
                classroom_id=arguments.get('classroom_id'),
                arguments=arguments,
                request=_mcp_request(),
            )
            return _result(request_id, {
                'content': [{'type': 'text', 'text': _json_text(payload)}],
                'isError': False,
            })
        except ToolExecutionError as exc:
            return _result(request_id, {
                'content': [{'type': 'text', 'text': _json_text({'status': 'error', 'error': str(exc), 'code': exc.code})}],
                'isError': True,
            })
        except Exception as exc:
            return _result(request_id, {
                'content': [{'type': 'text', 'text': _json_text({'status': 'error', 'error': str(exc), 'code': 'INTERNAL_ERROR'})}],
                'isError': True,
            })

    if method == 'resources/list':
        return _result(request_id, {'resources': _resource_list()})

    if method == 'resources/read':
        try:
            return _result(request_id, _read_resource(params.get('uri') or ''))
        except Exception as exc:
            return _error(request_id, -32004, str(exc))

    return _error(request_id, -32601, f'未知 MCP 方法：{method}')


def _read_content_length_message(stream):
    headers = {}
    while True:
        line = stream.readline()
        if not line:
            return None
        if isinstance(line, bytes):
            line = line.decode('utf-8')
        line = line.rstrip('\r\n')
        if not line:
            break
        if ':' in line:
            key, value = line.split(':', 1)
            headers[key.strip().lower()] = value.strip()
    length = int(headers.get('content-length') or 0)
    if length <= 0:
        return None
    body = stream.read(length)
    if isinstance(body, bytes):
        body = body.decode('utf-8')
    return json.loads(body)


def _write_content_length_message(stream, message):
    body = json.dumps(message, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    stream.write(f'Content-Length: {len(body)}\r\n\r\n'.encode('utf-8'))
    stream.write(body)
    stream.flush()


def serve_stdio(stdin=None, stdout=None):
    stdin = stdin or sys.stdin.buffer
    stdout = stdout or sys.stdout.buffer
    while True:
        try:
            message = _read_content_length_message(stdin)
            if message is None:
                break
            response = handle_mcp_message(message)
            if response is not None:
                _write_content_length_message(stdout, response)
        except KeyboardInterrupt:
            break
        except Exception as exc:
            response = _error(None, -32603, str(exc))
            _write_content_length_message(stdout, response)
