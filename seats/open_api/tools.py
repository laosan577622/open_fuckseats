import base64
import copy
import json
import random
from io import BytesIO

import openpyxl
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, models, transaction
from django.test import RequestFactory
from django.contrib.sessions.backends.db import SessionStore

from seats.constraints import (
    ConstraintServiceError,
    normalize_constraint_payload,
    normalize_tag_rule_payload,
    validate_constraint_candidate,
    serialize_tag_rules,
)
from seats.models import (
    Classroom,
    ClassroomHistoryEntry,
    LayoutSnapshot,
    Seat,
    SeatCellType,
    SeatConstraint,
    SeatGroup,
    Student,
    StudentTag,
    StudentTagMembership,
)
from seats import views as legacy_views
from .registry import ToolResult, registry
from .serializers import (
    ARRANGE_MODE_DEFINITIONS,
    classroom_detail_payload,
    classroom_report,
    parse_bool,
    resolve_group,
    resolve_snapshot,
    resolve_student,
    resolve_tag,
    safe_int,
    seating_analysis,
    serialize_classroom,
    serialize_constraints_for_classroom,
    serialize_group,
    serialize_groups,
    serialize_history_entry,
    serialize_seat_map,
    serialize_snapshot,
    serialize_student,
    serialize_tags_for_classroom,
    student_sort_key,
    validate_seating_payload,
)


def _schema(properties=None, required=None, *, allow_extra=False):
    return {
        'type': 'object',
        'properties': properties or {},
        'required': required or [],
        'additionalProperties': bool(allow_extra),
    }


def _with_classroom(properties=None, required=None, *, allow_extra=False):
    props = {
        'classroom_id': {'type': 'integer', 'description': '教室 ID'},
    }
    props.update(properties or {})
    req = ['classroom_id']
    req.extend(required or [])
    return _schema(props, req, allow_extra=allow_extra)


def _string(description=''):
    data = {'type': 'string'}
    if description:
        data['description'] = description
    return data


def _int(description='', minimum=None):
    data = {'type': 'integer'}
    if description:
        data['description'] = description
    if minimum is not None:
        data['minimum'] = minimum
    return data


def _number(description=''):
    data = {'type': 'number'}
    if description:
        data['description'] = description
    return data


def _bool(description=''):
    data = {'type': 'boolean'}
    if description:
        data['description'] = description
    return data


def _array(items, description=''):
    data = {'type': 'array', 'items': items}
    if description:
        data['description'] = description
    return data


def _dummy_request():
    request = RequestFactory().post('/open_api/tool/')
    request.session = SessionStore()
    request.user = None
    return request


def _tool_request(ctx):
    request = ctx.request or _dummy_request()
    if not hasattr(request, 'session'):
        request.session = SessionStore()
    return request


def _invoke_legacy(ctx, view_func, *, json_payload=None, form_payload=None, extra_args=None):
    return legacy_views._invoke_classroom_action_view(
        ctx.classroom,
        _tool_request(ctx),
        view_func,
        json_payload=json_payload,
        form_payload=form_payload,
        extra_args=extra_args,
    )


def _invoke_export_view(ctx, view_func, *, query=None):
    request = RequestFactory().get('/open_api/export/', data=query or {})
    request.session = getattr(_tool_request(ctx), 'session', SessionStore())
    response = view_func(request, ctx.classroom.pk)
    content = response.content if hasattr(response, 'content') else b''
    return {
        'content_type': response.get('Content-Type', ''),
        'content_disposition': response.get('Content-Disposition', ''),
        'base64': base64.b64encode(content).decode('ascii'),
        'bytes': len(content),
    }


def _affected(description='', *, students=None, groups=None):
    data = {'description': description}
    if students:
        data['students'] = students
    if groups:
        data['groups'] = groups
    return data


def _student_payload(arguments, *, require_name=True):
    name = str(arguments.get('name') or '').strip()
    if require_name and not name:
        raise ValueError('姓名不能为空')
    gender = str(arguments.get('gender') or '').strip().upper()
    if gender not in {'M', 'F'}:
        gender = None
    try:
        score = float(arguments.get('score') or 0)
    except (TypeError, ValueError):
        score = 0
    return {
        'name': name,
        'student_id': str(arguments.get('student_id') or '').strip() or None,
        'gender': gender,
        'score': score,
    }


def _legacy_arrange_method(mode):
    return {
        'score_first': 'score_desc',
        'score_balanced': 'score_spread',
        'standard': 'standard',
        'student_id': 'student_id',
        'snake': 'snake',
        'random': 'random',
        'group_balanced': 'group_balanced',
        'group_mentor': 'group_mentor',
    }.get(str(mode or '').strip(), str(mode or 'random').strip() or 'random')


def _arrange_direct(ctx, mode):
    classroom = ctx.classroom
    mode = _legacy_arrange_method(mode)
    before_state = legacy_views._capture_history_state(classroom)
    students = list(classroom.students.all())
    seats = list(classroom.seats.filter(cell_type=SeatCellType.SEAT).order_by('row', 'col'))
    if len(seats) < len(students):
        raise ValueError('可用座位不足，无法排座')

    if mode == 'snake':
        snake_seats = []
        for row in range(1, classroom.rows + 1):
            row_seats = [seat for seat in seats if seat.row == row]
            snake_seats.extend(row_seats if row % 2 == 1 else list(reversed(row_seats)))
        seats = snake_seats
        students = sorted(students, key=lambda item: student_sort_key(item, 'standard'))
    elif mode in {'standard', 'student_id'}:
        students = sorted(students, key=lambda item: student_sort_key(item, mode))
    else:
        return _invoke_legacy(ctx, legacy_views.auto_arrange_seats, form_payload={'method': mode})

    with transaction.atomic():
        legacy_views._arrange_standard(classroom, students, seats, mode)
        violations = legacy_views._stabilize_layout_with_rules(classroom, _tool_request(ctx))
        if violations:
            raise ValueError(f'排座失败：{legacy_views._format_issues_preview(violations)}')
        hard_issues = legacy_views._layout_hard_issues(classroom)
        if hard_issues:
            raise ValueError(f'约束未满足，排座已回滚：{legacy_views._format_issues_preview(hard_issues)}')
    legacy_views._push_snapshot_action(_tool_request(ctx), classroom, before_state, 'open_api_arrange', extra={'method': mode})
    return {'status': 'success', 'method': mode}


def _student_filter_queryset(classroom, criteria):
    queryset = classroom.students.all()
    criteria = criteria or {}
    if criteria.get('keyword'):
        keyword = str(criteria.get('keyword')).strip()
        queryset = queryset.filter(models.Q(name__icontains=keyword) | models.Q(student_id__icontains=keyword))
    if criteria.get('gender') in {'M', 'F'}:
        queryset = queryset.filter(gender=criteria.get('gender'))
    if criteria.get('min_score') not in (None, ''):
        queryset = queryset.filter(score__gte=float(criteria.get('min_score')))
    if criteria.get('max_score') not in (None, ''):
        queryset = queryset.filter(score__lte=float(criteria.get('max_score')))
    if parse_bool(criteria.get('unseated'), default=False):
        queryset = queryset.filter(assigned_seat__isnull=True)
    if parse_bool(criteria.get('seated'), default=False):
        queryset = queryset.filter(assigned_seat__isnull=False)
    return queryset.distinct()


@registry.register(
    name='list_classrooms',
    description='列出所有教室，包含人数、座位和分组等基本统计。',
    parameters=_schema({
        'keyword': _string('按教室名称过滤'),
        'limit': _int('返回数量上限', 1),
        'offset': _int('偏移量', 0),
    }),
    category='classroom',
    read_only=True,
    requires_classroom=False,
)
def list_classrooms(ctx):
    qs = Classroom.objects.all().order_by('-created_at', '-pk')
    keyword = str(ctx.arguments.get('keyword') or '').strip()
    if keyword:
        qs = qs.filter(name__icontains=keyword)
    total = qs.count()
    limit = max(1, min(200, safe_int(ctx.arguments.get('limit'), 100)))
    offset = max(0, safe_int(ctx.arguments.get('offset'), 0))
    return {'items': [serialize_classroom(item) for item in qs[offset:offset + limit]], 'total': total}


@registry.register(
    name='get_classroom',
    description='获取单个教室完整信息，包括座位、学生、小组、约束、标签和快照。',
    parameters=_with_classroom(),
    category='classroom',
    read_only=True,
)
def get_classroom(ctx):
    return classroom_detail_payload(ctx.classroom, include_tools=True, tools=registry.schemas())


@registry.register(
    name='create_classroom',
    description='创建一个新教室并自动生成座位网格。注意：此操作会修改数据，请先向用户口头确认是否继续。',
    parameters=_schema({
        'name': _string('教室名称'),
        'rows': _int('行数', 1),
        'cols': _int('列数', 1),
    }, ['name']),
    category='classroom',
    read_only=False,
    requires_classroom=False,
)
def create_classroom_tool(ctx):
    name = str(ctx.arguments.get('name') or '').strip()
    if not name:
        raise ValueError('教室名称不能为空')
    rows = max(1, min(30, safe_int(ctx.arguments.get('rows'), 6)))
    cols = max(1, min(30, safe_int(ctx.arguments.get('cols'), 8)))
    classroom = Classroom.objects.create(name=name, rows=rows, cols=cols)
    return ToolResult(
        result={'classroom': serialize_classroom(classroom)},
        affected=_affected(f'已创建教室：{classroom.name}'),
    )


@registry.register(
    name='delete_classroom',
    description='注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。删除教室及其全部学生、座位、约束、标签、快照和历史。',
    parameters=_with_classroom(),
    category='classroom',
    read_only=False,
    danger_level='dangerous',
)
def delete_classroom_tool(ctx):
    classroom_id = ctx.classroom.pk
    classroom_name = ctx.classroom.name
    _invoke_legacy(ctx, legacy_views.delete_classroom)
    return ToolResult(
        result={'deleted': True, 'classroom_id': classroom_id, 'name': classroom_name},
        affected=_affected(f'已删除教室：{classroom_name}'),
    )


@registry.register(
    name='rename_classroom',
    description='重命名教室。注意：此操作会修改数据，请先向用户口头确认是否继续。',
    parameters=_with_classroom({'name': _string('新名称')}, ['name']),
    category='classroom',
    read_only=False,
)
def rename_classroom_tool(ctx):
    new_name = str(ctx.arguments.get('name') or ctx.arguments.get('new_name') or '').strip()
    if not new_name:
        raise ValueError('新名称不能为空')
    old_name = ctx.classroom.name
    payload = _invoke_legacy(ctx, legacy_views.rename_classroom, json_payload={'name': new_name})
    ctx.classroom.refresh_from_db()
    return ToolResult(
        result={'classroom': serialize_classroom(ctx.classroom), 'payload': payload},
        affected=_affected(f'已将教室“{old_name}”重命名为“{new_name}”'),
    )


@registry.register(
    name='set_podium_guardian',
    description='设置讲台左护法和右护法学生，可传学生姓名、学号或 ID；传空值表示清空对应位置。',
    parameters=_with_classroom({
        'left_student': _string('左护法学生'),
        'left_student_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']},
        'right_student': _string('右护法学生'),
        'right_student_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']},
    }),
    category='classroom',
    read_only=False,
)
def set_podium_guardian_tool(ctx):
    left = ctx.arguments.get('left_student')
    right = ctx.arguments.get('right_student')
    left_student = resolve_student(ctx.classroom, left, ctx.arguments.get('left_student_by', 'auto')) if left not in (None, '') else None
    right_student = resolve_student(ctx.classroom, right, ctx.arguments.get('right_student_by', 'auto')) if right not in (None, '') else None
    payload = _invoke_legacy(
        ctx,
        legacy_views.set_podium_guards,
        json_payload={
            'left_student_id': left_student.pk if left_student else '',
            'right_student_id': right_student.pk if right_student else '',
        },
    )
    return ToolResult(
        result=payload,
        affected=_affected('已更新讲台左右护法'),
    )


@registry.register(
    name='list_students',
    description='列出学生，支持 keyword、性别、分数范围、已坐状态、标签、行列号过滤、排序和分页。',
    parameters=_with_classroom({
        'keyword': _string('搜索关键词'),
        'gender': {'type': 'string', 'enum': ['M', 'F', '']},
        'min_score': _number('最低成绩'),
        'max_score': _number('最高成绩'),
        'seated': _bool('是否已入座'),
        'untagged': _bool('是否无标签'),
        'tag_ids': _array(_int(), '标签 ID 列表'),
        'row': _int('行号', 1),
        'col': _int('列号', 1),
        'sort_by': {'type': 'string', 'enum': ['id', 'name', 'student_id', 'gender', 'score', 'seat_row', 'seat_col', 'group']},
        'sort_order': {'type': 'string', 'enum': ['asc', 'desc']},
        'limit': _int('返回数量', 1),
        'offset': _int('偏移量', 0),
    }),
    category='student',
    read_only=True,
)
def list_students_tool(ctx):
    filters = {}
    for key in ('keyword', 'gender', 'min_score', 'max_score', 'seated', 'untagged', 'tag_ids', 'row', 'col'):
        if key in ctx.arguments:
            filters[key] = ctx.arguments.get(key)
    return legacy_views._build_student_list_payload(ctx.classroom, {
        'filters': filters,
        'sort_by': ctx.arguments.get('sort_by') or 'name',
        'sort_order': ctx.arguments.get('sort_order') or 'asc',
        'limit': ctx.arguments.get('limit') or 50,
        'offset': ctx.arguments.get('offset') or 0,
    })


@registry.register(
    name='get_student',
    description='获取单个学生详情，包含座位、小组、标签和固定座位状态。',
    parameters=_with_classroom({
        'student': _string('学生姓名、学号或 ID'),
        'student_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']},
    }, ['student']),
    category='student',
    read_only=True,
)
def get_student_tool(ctx):
    student = resolve_student(ctx.classroom, ctx.arguments.get('student'), ctx.arguments.get('student_by', 'auto'))
    return {'student': serialize_student(student, ctx.classroom)}


@registry.register(
    name='add_student',
    description='添加单个学生。注意：此操作会修改数据，请先向用户口头确认是否继续。',
    parameters=_with_classroom({
        'name': _string('姓名'),
        'student_id': _string('学号'),
        'gender': {'type': 'string', 'enum': ['M', 'F', '']},
        'score': _number('成绩'),
        'tag_ids': _array(_int(), '标签 ID 列表'),
        'tag_names': _array(_string(), '标签名称列表'),
    }, ['name']),
    category='student',
    read_only=False,
)
def add_student_tool(ctx):
    payload = _student_payload(ctx.arguments)
    for key in ('tag_ids', 'tag_names'):
        if key in ctx.arguments:
            payload[key] = ctx.arguments[key]
    result = _invoke_legacy(ctx, legacy_views.add_student, json_payload=payload)
    return ToolResult(
        result=result,
        affected=_affected(f'已添加学生：{payload["name"]}', students=[payload['name']]),
    )


@registry.register(
    name='add_students_batch',
    description='批量添加学生，一次最多 200 人。注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。',
    parameters=_with_classroom({
        'students': _array(_schema({
            'name': _string('姓名'),
            'student_id': _string('学号'),
            'gender': {'type': 'string', 'enum': ['M', 'F', '']},
            'score': _number('成绩'),
        }, ['name']), '学生数组'),
    }, ['students']),
    category='student',
    read_only=False,
    danger_level='dangerous',
)
def add_students_batch_tool(ctx):
    students_payload = ctx.arguments.get('students') or []
    if not isinstance(students_payload, list) or not students_payload:
        raise ValueError('students 必须是非空数组')
    if len(students_payload) > 200:
        raise ValueError('一次最多添加 200 名学生')
    before_state = legacy_views._capture_history_state(ctx.classroom)
    created = []
    with transaction.atomic():
        for item in students_payload:
            payload = _student_payload(item)
            created.append(Student.objects.create(classroom=ctx.classroom, **payload))
    legacy_views._push_snapshot_action(
        _tool_request(ctx),
        ctx.classroom,
        before_state,
        'open_api_add_students_batch',
        extra={'student_ids': [student.pk for student in created]},
    )
    return ToolResult(
        result={'created': [serialize_student(student, ctx.classroom) for student in created], 'count': len(created)},
        affected=_affected(f'已批量添加 {len(created)} 名学生', students=[student.name for student in created]),
    )


@registry.register(
    name='update_student',
    description='更新学生姓名、学号、性别、成绩和标签。注意：此操作会修改数据，请先向用户口头确认是否继续。',
    parameters=_with_classroom({
        'student': _string('学生姓名、学号或 ID'),
        'student_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']},
        'name': _string('姓名'),
        'student_id': _string('学号'),
        'gender': {'type': 'string', 'enum': ['M', 'F', '']},
        'score': _number('成绩'),
        'tag_ids': _array(_int(), '标签 ID 列表'),
        'tag_names': _array(_string(), '标签名称列表'),
    }, ['student', 'name']),
    category='student',
    read_only=False,
)
def update_student_tool(ctx):
    student = resolve_student(ctx.classroom, ctx.arguments.get('student'), ctx.arguments.get('student_by', 'auto'))
    payload = _student_payload(ctx.arguments)
    for key in ('tag_ids', 'tag_names'):
        if key in ctx.arguments:
            payload[key] = ctx.arguments[key]
    result = _invoke_legacy(ctx, legacy_views.update_student, json_payload=payload, extra_args=[student.pk])
    return ToolResult(
        result=result,
        affected=_affected(f'已更新学生：{payload["name"]}', students=[payload['name']]),
    )


@registry.register(
    name='delete_student',
    description='注意：此操作会修改数据，请先向用户口头确认是否继续。删除未入座学生；已入座学生需先清空座位。',
    parameters=_with_classroom({
        'student': _string('学生姓名、学号或 ID'),
        'student_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']},
    }, ['student']),
    category='student',
    read_only=False,
    danger_level='medium',
)
def delete_student_tool(ctx):
    student = resolve_student(ctx.classroom, ctx.arguments.get('student'), ctx.arguments.get('student_by', 'auto'))
    name = student.name
    result = _invoke_legacy(ctx, legacy_views.delete_student, extra_args=[student.pk])
    return ToolResult(result=result, affected=_affected(f'已删除学生：{name}', students=[name]))


@registry.register(
    name='search_students',
    description='按姓名、学号、拼音、拼音首字母或标签名模糊搜索学生。',
    parameters=_with_classroom({
        'q': _string('搜索关键词'),
        'limit': _int('返回数量', 1),
    }, ['q']),
    category='student',
    read_only=True,
)
def search_students_tool(ctx):
    keyword = str(ctx.arguments.get('q') or ctx.arguments.get('keyword') or '').strip()
    limit = max(1, min(200, safe_int(ctx.arguments.get('limit'), 50)))
    matches = []
    tag_map = legacy_views._build_student_tag_map(ctx.classroom)
    for student in ctx.classroom.students.select_related('assigned_seat__group').order_by('name', 'pk'):
        text = ' '.join([
            student.name,
            str(student.student_id or ''),
            ''.join(lazy for lazy in []),
            ''.join(legacy_views.lazy_pinyin(student.name)),
            ''.join(part[0] for part in legacy_views.lazy_pinyin(student.name) if part),
            ' '.join(tag['name'] for tag in tag_map.get(student.pk, [])),
        ]).lower()
        if keyword.lower() in text:
            matches.append(serialize_student(student, ctx.classroom))
            if len(matches) >= limit:
                break
    return {'students': matches, 'total': len(matches)}


@registry.register(
    name='get_seat_map',
    description='获取完整座位网格矩阵。',
    parameters=_with_classroom(),
    category='seating',
    read_only=True,
)
def get_seat_map_tool(ctx):
    return serialize_seat_map(ctx.classroom)


@registry.register(
    name='move_student',
    description='将指定学生移动到目标座位。注意：此操作会修改数据，请先向用户口头确认是否继续。',
    parameters=_with_classroom({
        'student': _string('学生姓名、学号或 ID'),
        'student_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']},
        'row': _int('目标行', 1),
        'col': _int('目标列', 1),
        'group_move_mode': {'type': 'string', 'enum': ['fixed', 'follow']},
    }, ['student', 'row', 'col']),
    category='seating',
    read_only=False,
)
def move_student_tool(ctx):
    student = resolve_student(ctx.classroom, ctx.arguments.get('student'), ctx.arguments.get('student_by', 'auto'))
    row = safe_int(ctx.arguments.get('row'))
    col = safe_int(ctx.arguments.get('col'))
    result = _invoke_legacy(ctx, legacy_views.move_student, json_payload={
        'student_id': student.pk,
        'row': row,
        'col': col,
        'group_move_mode': ctx.arguments.get('group_move_mode') or 'fixed',
    })
    return ToolResult(result=result, affected=_affected(f'已移动 {student.name} 到 {row}-{col}', students=[student.name]))


@registry.register(
    name='move_students_batch',
    description='批量移动多个学生到指定座位；row/col 同时为空可清空该学生座位。注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。',
    parameters=_with_classroom({
        'moves': _array(_schema({
            'student': _string('学生姓名、学号或 ID'),
            'student_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']},
            'row': _int('目标行', 1),
            'col': _int('目标列', 1),
        }, ['student']), '移动列表'),
        'group_move_mode': {'type': 'string', 'enum': ['fixed', 'follow']},
    }, ['moves']),
    category='seating',
    read_only=False,
    danger_level='dangerous',
)
def move_students_batch_tool(ctx):
    moves = ctx.arguments.get('moves') or []
    payload_moves = []
    names = []
    for item in moves:
        student = resolve_student(ctx.classroom, item.get('student'), item.get('student_by', 'auto'))
        payload_moves.append({'student_id': student.pk, 'row': item.get('row'), 'col': item.get('col')})
        names.append(student.name)
    result = _invoke_legacy(ctx, legacy_views.move_students_batch, json_payload={
        'moves': payload_moves,
        'group_move_mode': ctx.arguments.get('group_move_mode') or 'fixed',
    })
    return ToolResult(result=result, affected=_affected(f'已批量移动 {len(names)} 名学生', students=names))


@registry.register(
    name='swap_students',
    description='交换两名已入座学生的座位。注意：此操作会修改数据，请先向用户口头确认是否继续。',
    parameters=_with_classroom({
        'student_a': _string('学生 A'),
        'student_a_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']},
        'student_b': _string('学生 B'),
        'student_b_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']},
    }, ['student_a', 'student_b']),
    category='seating',
    read_only=False,
)
def swap_students_tool(ctx):
    student_a = resolve_student(ctx.classroom, ctx.arguments.get('student_a'), ctx.arguments.get('student_a_by', 'auto'))
    student_b = resolve_student(ctx.classroom, ctx.arguments.get('student_b'), ctx.arguments.get('student_b_by', 'auto'))
    result = legacy_views._execute_ai_tool(
        ctx.classroom,
        'swap_students',
        {'student_a': str(student_a.pk), 'student_b': str(student_b.pk)},
        request=_tool_request(ctx),
    )
    return ToolResult(result=result.get('data') or result, affected=_affected(f'已交换 {student_a.name} 和 {student_b.name} 的座位', students=[student_a.name, student_b.name]))


@registry.register(
    name='assign_unseated',
    description='将未入座学生按当前空位顺序分配到空座位。注意：此操作会修改数据，请先向用户口头确认是否继续。',
    parameters=_with_classroom({
        'order_by': {'type': 'string', 'enum': ['name', 'student_id', 'score_desc', 'score_asc', 'random']},
        'limit': _int('最多分配人数', 1),
    }),
    category='seating',
    read_only=False,
)
def assign_unseated_tool(ctx):
    students = list(ctx.classroom.students.filter(assigned_seat__isnull=True))
    order_by = str(ctx.arguments.get('order_by') or 'name')
    if order_by == 'random':
        random.shuffle(students)
    elif order_by == 'score_desc':
        students.sort(key=lambda item: (-(item.score or 0), item.name))
    elif order_by == 'score_asc':
        students.sort(key=lambda item: ((item.score or 0), item.name))
    else:
        students.sort(key=lambda item: student_sort_key(item, 'student_id' if order_by == 'student_id' else 'standard'))
    limit = safe_int(ctx.arguments.get('limit'), len(students))
    students = students[:max(0, limit)]
    seats = list(ctx.classroom.seats.filter(cell_type=SeatCellType.SEAT, student__isnull=True).order_by('row', 'col'))
    if len(seats) < len(students):
        raise ValueError('空座位不足')
    moves = [{'student': str(student.pk), 'student_by': 'id', 'row': seat.row, 'col': seat.col} for student, seat in zip(students, seats)]
    result = registry.execute('move_students_batch', classroom_id=ctx.classroom.pk, arguments={'moves': moves}, request=_tool_request(ctx))
    return ToolResult(result=result['result'], affected=_affected(f'已分配 {len(students)} 名未入座学生', students=[student.name for student in students]))


@registry.register(
    name='clear_seat',
    description='注意：此操作会修改数据，请先向用户口头确认是否继续。清空指定座位上的学生。',
    parameters=_with_classroom({'row': _int('行号', 1), 'col': _int('列号', 1)}, ['row', 'col']),
    category='seating',
    read_only=False,
    danger_level='medium',
)
def clear_seat_tool(ctx):
    row = safe_int(ctx.arguments.get('row'))
    col = safe_int(ctx.arguments.get('col'))
    result = _invoke_legacy(ctx, legacy_views.clear_seat, json_payload={'row': row, 'col': col})
    return ToolResult(result=result, affected=_affected(f'已清空座位 {row}-{col}'))


@registry.register(
    name='clear_all_seats',
    description='注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。清空当前教室所有座位上的学生。',
    parameters=_with_classroom(),
    category='seating',
    read_only=False,
    danger_level='dangerous',
)
def clear_all_seats_tool(ctx):
    before_state = legacy_views._capture_history_state(ctx.classroom)
    seated_names = list(ctx.classroom.seats.filter(student__isnull=False).values_list('student__name', flat=True))
    with transaction.atomic():
        ctx.classroom.seats.update(student=None)
        ctx.classroom.groups.update(leader=None)
    legacy_views._push_snapshot_action(_tool_request(ctx), ctx.classroom, before_state, 'open_api_clear_all_seats')
    return ToolResult(result={'cleared': len(seated_names)}, affected=_affected(f'已清空 {len(seated_names)} 个座位', students=seated_names))


@registry.register(
    name='toggle_fixed_seat',
    description='固定或解除固定某座位上的学生，固定后自动排座不会移动该学生。',
    parameters=_with_classroom({
        'row': _int('行号', 1),
        'col': _int('列号', 1),
        'enabled': _bool('是否固定'),
    }, ['row', 'col']),
    category='seating',
    read_only=False,
)
def toggle_fixed_seat_tool(ctx):
    result = _invoke_legacy(ctx, legacy_views.toggle_fixed_seat, json_payload={
        'row': safe_int(ctx.arguments.get('row')),
        'col': safe_int(ctx.arguments.get('col')),
        'enabled': ctx.arguments.get('enabled'),
    })
    return ToolResult(result=result, affected=_affected(result.get('message') or '已更新固定座位状态'))


@registry.register(
    name='get_layout',
    description='获取布局，包含所有 cell_type、学生和小组信息。',
    parameters=_with_classroom(),
    category='layout',
    read_only=True,
)
def get_layout_tool(ctx):
    return serialize_seat_map(ctx.classroom)


@registry.register(
    name='update_cell_type',
    description='修改单元格类型：seat、aisle、podium、empty。注意：此操作会修改数据，请先向用户口头确认是否继续。',
    parameters=_with_classroom({
        'row': _int('行号', 1),
        'col': _int('列号', 1),
        'cell_type': {'type': 'string', 'enum': ['seat', 'aisle', 'podium', 'empty']},
    }, ['row', 'col', 'cell_type']),
    category='layout',
    read_only=False,
)
def update_cell_type_tool(ctx):
    result = _invoke_legacy(ctx, legacy_views.update_cell_type, json_payload={
        'row': safe_int(ctx.arguments.get('row')),
        'col': safe_int(ctx.arguments.get('col')),
        'cell_type': ctx.arguments.get('cell_type'),
    })
    return ToolResult(result=result, affected=_affected('已更新单元格类型'))


@registry.register(
    name='shift_layout',
    description='整体平移布局，direction 支持 left、right、front、back、up、down。',
    parameters=_with_classroom({
        'direction': {'type': 'string', 'enum': ['left', 'right', 'front', 'back', 'up', 'down']},
        'steps': _int('步数', 1),
        'use_large_groups': _bool('是否使用大组识别'),
    }, ['direction']),
    category='layout',
    read_only=False,
)
def shift_layout_tool(ctx):
    result = _invoke_legacy(ctx, legacy_views.shift_layout, json_payload={
        'direction': ctx.arguments.get('direction'),
        'steps': ctx.arguments.get('steps') or 1,
        'use_large_groups': ctx.arguments.get('use_large_groups'),
    })
    return ToolResult(result=result, affected=_affected(result.get('message') or '已平移布局'))


@registry.register(
    name='mirror_layout',
    description='镜像翻转布局，axis 支持 lr/horizontal 或 tb/vertical。',
    parameters=_with_classroom({
        'axis': {'type': 'string', 'enum': ['lr', 'tb', 'horizontal', 'vertical']},
    }, ['axis']),
    category='layout',
    read_only=False,
)
def mirror_layout_tool(ctx):
    axis = ctx.arguments.get('axis')
    axis = 'lr' if axis == 'horizontal' else 'tb' if axis == 'vertical' else axis
    result = _invoke_legacy(ctx, legacy_views.mirror_layout, json_payload={'axis': axis})
    return ToolResult(result=result, affected=_affected(result.get('message') or '已镜像布局'))


def _row_col_tool(action_name, description):
    @registry.register(
        name=action_name,
        description=description,
        parameters=_with_classroom({'index': _int('行/列索引，从 1 开始', 1)}, ['index']),
        category='layout',
        read_only=False,
        danger_level='dangerous' if action_name in {'delete_row', 'delete_col'} else 'medium',
    )
    def handler(ctx, _action_name=action_name):
        result = _invoke_legacy(ctx, legacy_views.insert_delete_row_col, json_payload={
            'action': _action_name,
            'index': safe_int(ctx.arguments.get('index')),
        })
        return ToolResult(result=result, affected=_affected(result.get('message') or f'已执行 {_action_name}'))
    return handler


_row_col_tool('insert_row', '插入行。注意：此操作会修改数据，请先向用户口头确认是否继续。')
_row_col_tool('insert_col', '插入列。注意：此操作会修改数据，请先向用户口头确认是否继续。')
_row_col_tool('delete_row', '注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。删除指定行。')
_row_col_tool('delete_col', '注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。删除指定列。')


@registry.register(
    name='arrange_seats',
    description='自动排座。支持 standard、student_id、score_first、score_balanced、snake、random、group_balanced、group_mentor。',
    parameters=_with_classroom({
        'mode': {'type': 'string', 'enum': [item['value'] for item in ARRANGE_MODE_DEFINITIONS]},
    }, ['mode']),
    category='arrange',
    read_only=False,
)
def arrange_seats_tool(ctx):
    mode = ctx.arguments.get('mode') or 'random'
    result = _arrange_direct(ctx, mode)
    return ToolResult(result=result, affected=_affected(f'已执行自动排座：{mode}'))


@registry.register(
    name='arrange_with_custom_rules',
    description='按自定义规则排座。可通过 rules 描述排序、固定前排、标签区域等规则；当前会转换为最接近的内置排座模式后执行。',
    parameters=_with_classroom({
        'description': _string('自然语言规则描述'),
        'rules': _array(_schema({}, allow_extra=True), '结构化规则列表'),
        'fallback_mode': {'type': 'string', 'enum': [item['value'] for item in ARRANGE_MODE_DEFINITIONS]},
    }),
    category='arrange',
    read_only=False,
)
def arrange_with_custom_rules_tool(ctx):
    description = str(ctx.arguments.get('description') or '').lower()
    fallback = ctx.arguments.get('fallback_mode') or 'score_balanced'
    mode = fallback
    if '随机' in description or 'random' in description:
        mode = 'random'
    elif '高分' in description and ('靠前' in description or '前排' in description):
        mode = 'score_first'
    elif '学号' in description:
        mode = 'student_id'
    result = _arrange_direct(ctx, mode)
    return ToolResult(result={'chosen_mode': mode, 'payload': result}, affected=_affected(f'已按自定义规则执行排座，使用模式：{mode}'))


@registry.register(name='list_groups', description='列出所有小组及成员统计。', parameters=_with_classroom(), category='group', read_only=True)
def list_groups_tool(ctx):
    return {'groups': serialize_groups(ctx.classroom)}


@registry.register(name='create_group', description='创建小组。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'name': _string('小组名称')}, ['name']), category='group', read_only=False)
def create_group_tool(ctx):
    name = str(ctx.arguments.get('name') or '').strip()
    result = _invoke_legacy(ctx, legacy_views.create_group, form_payload={'name': name})
    return ToolResult(result=result, affected=_affected(f'已创建小组：{name}', groups=[name]))


@registry.register(name='rename_group', description='重命名小组。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'group': _string('小组名称或 ID'), 'new_name': _string('新名称')}, ['group', 'new_name']), category='group', read_only=False)
def rename_group_tool(ctx):
    group = resolve_group(ctx.classroom, ctx.arguments.get('group'))
    old_name = group.name
    new_name = str(ctx.arguments.get('new_name') or '').strip()
    result = _invoke_legacy(ctx, legacy_views.rename_group, form_payload={'name': new_name}, extra_args=[group.pk])
    return ToolResult(result=result, affected=_affected(f'已将小组“{old_name}”重命名为“{new_name}”', groups=[new_name]))


@registry.register(name='delete_group', description='删除小组。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'group': _string('小组名称或 ID')}, ['group']), category='group', read_only=False, danger_level='medium')
def delete_group_tool(ctx):
    group = resolve_group(ctx.classroom, ctx.arguments.get('group'))
    name = group.name
    result = _invoke_legacy(ctx, legacy_views.delete_group, extra_args=[group.pk])
    return ToolResult(result=result, affected=_affected(f'已删除小组：{name}', groups=[name]))


@registry.register(name='assign_to_group', description='将一个座位分配到小组。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'row': _int('行号', 1), 'col': _int('列号', 1), 'group': _string('小组名称或 ID，空值表示取消分组')}, ['row', 'col']), category='group', read_only=False)
def assign_to_group_tool(ctx):
    group_value = ctx.arguments.get('group')
    group = resolve_group(ctx.classroom, group_value) if group_value not in (None, '') else None
    result = _invoke_legacy(ctx, legacy_views.assign_group, json_payload={
        'row': safe_int(ctx.arguments.get('row')),
        'col': safe_int(ctx.arguments.get('col')),
        'group_id': group.pk if group else None,
    })
    return ToolResult(result=result, affected=_affected('已更新座位小组'))


@registry.register(name='assign_to_group_batch', description='批量将座位分配到小组。注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。', parameters=_with_classroom({'group': _string('小组名称或 ID，空值表示取消分组'), 'seats': _array(_schema({'row': _int('行', 1), 'col': _int('列', 1)}, ['row', 'col']))}, ['seats']), category='group', read_only=False, danger_level='dangerous')
def assign_to_group_batch_tool(ctx):
    group_value = ctx.arguments.get('group')
    group = resolve_group(ctx.classroom, group_value) if group_value not in (None, '') else None
    result = _invoke_legacy(ctx, legacy_views.assign_group_batch, json_payload={
        'group_id': group.pk if group else None,
        'seats': ctx.arguments.get('seats') or [],
    })
    return ToolResult(result=result, affected=_affected('已批量更新小组'))


@registry.register(name='auto_assign_groups', description='自动分组。支持按成绩、随机或蛇形生成学生小组。注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。', parameters=_with_classroom({'mode': {'type': 'string', 'enum': ['score', 'random', 'snake']}, 'group_count': _int('小组数量', 1), 'prefix': _string('小组名前缀')}, ['group_count']), category='group', read_only=False, danger_level='dangerous')
def auto_assign_groups_tool(ctx):
    group_count = max(1, min(100, safe_int(ctx.arguments.get('group_count'), 1)))
    mode = str(ctx.arguments.get('mode') or 'score')
    prefix = str(ctx.arguments.get('prefix') or '第').strip()
    before_state = legacy_views._capture_history_state(ctx.classroom)
    students = list(ctx.classroom.students.order_by('name', 'pk'))
    if mode == 'random':
        random.shuffle(students)
    elif mode == 'score':
        students.sort(key=lambda item: (-(item.score or 0), item.name))
    groups = []
    with transaction.atomic():
        ctx.classroom.groups.update(leader=None)
        ctx.classroom.groups.all().delete()
        for index in range(1, group_count + 1):
            name = f'{prefix}{index}组' if prefix == '第' else f'{prefix}{index}'
            groups.append(SeatGroup.objects.create(classroom=ctx.classroom, name=name, order=index))
        seats = list(ctx.classroom.seats.filter(cell_type=SeatCellType.SEAT).order_by('row', 'col'))
        for idx, seat in enumerate(seats):
            seat.group = groups[idx % group_count]
            seat.save(update_fields=['group'])
    legacy_views._push_snapshot_action(_tool_request(ctx), ctx.classroom, before_state, 'open_api_auto_assign_groups', extra={'group_count': group_count, 'mode': mode})
    return ToolResult(result={'groups': [serialize_group(group) for group in groups]}, affected=_affected(f'已自动创建并分配 {group_count} 个小组', groups=[group.name for group in groups]))


@registry.register(name='rotate_groups', description='轮换小组位置。注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。', parameters=_with_classroom(), category='group', read_only=False, danger_level='dangerous')
def rotate_groups_tool(ctx):
    result = _invoke_legacy(ctx, legacy_views.rotate_groups, json_payload={})
    return ToolResult(result=result, affected=_affected(result.get('message') or '已轮换小组'))


@registry.register(name='merge_groups', description='合并多个来源小组到目标小组。注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。', parameters=_with_classroom({'target_group': _string('目标小组'), 'source_groups': _array(_string(), '来源小组列表')}, ['target_group', 'source_groups']), category='group', read_only=False, danger_level='dangerous')
def merge_groups_tool(ctx):
    target = resolve_group(ctx.classroom, ctx.arguments.get('target_group'))
    sources = [resolve_group(ctx.classroom, item) for item in (ctx.arguments.get('source_groups') or [])]
    result = _invoke_legacy(ctx, legacy_views.merge_groups, json_payload={'target_group_id': target.pk, 'source_group_ids': [group.pk for group in sources]})
    return ToolResult(result=result, affected=_affected(result.get('message') or '已合并小组', groups=[target.name] + [group.name for group in sources]))


@registry.register(name='set_group_leader', description='设置学生为其所在小组的小组长；如果已是组长则取消。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'student': _string('学生姓名、学号或 ID'), 'student_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']}}, ['student']), category='group', read_only=False)
def set_group_leader_tool(ctx):
    student = resolve_student(ctx.classroom, ctx.arguments.get('student'), ctx.arguments.get('student_by', 'auto'))
    result = _invoke_legacy(ctx, legacy_views.set_group_leader, json_payload={'student_id': student.pk})
    return ToolResult(result=result, affected=_affected(f'已更新小组长状态：{student.name}', students=[student.name]))


@registry.register(name='get_group_stats', description='获取小组统计数据：人数、平均分、最高分、最低分、成员和组长。', parameters=_with_classroom(), category='group', read_only=True)
def get_group_stats_tool(ctx):
    return {'groups': legacy_views._get_group_score_rows(ctx.classroom)}


@registry.register(name='list_constraints', description='列出所有排座约束。', parameters=_with_classroom(), category='constraint', read_only=True)
def list_constraints_tool(ctx):
    return serialize_constraints_for_classroom(ctx.classroom)


def _constraint_payload_from_args(classroom, args, instance=None):
    student = resolve_student(classroom, args.get('student'), args.get('student_by', 'auto')) if args.get('student') else (instance.student if instance else None)
    target = resolve_student(classroom, args.get('target_student'), args.get('target_student_by', 'auto')) if args.get('target_student') else (instance.target_student if instance else None)
    return {
        'constraint_type': args.get('constraint_type') or (instance.constraint_type if instance else ''),
        'student': student,
        'target_student': target,
        'row': args.get('row') if args.get('row') is not None else (instance.row if instance else None),
        'col': args.get('col') if args.get('col') is not None else (instance.col if instance else None),
        'distance': args.get('distance') if args.get('distance') is not None else (instance.distance if instance else 1),
        'enabled': args.get('enabled') if args.get('enabled') is not None else (instance.enabled if instance else True),
        'note': args.get('note') if args.get('note') is not None else (instance.note if instance else ''),
    }


@registry.register(name='add_constraint', description='添加排座约束。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'constraint_type': _string('约束类型'), 'student': _string('学生'), 'target_student': _string('目标学生'), 'row': _int('行', 1), 'col': _int('列', 1), 'distance': _int('距离', 1), 'enabled': _bool('启用'), 'note': _string('备注')}, ['constraint_type', 'student']), category='constraint', read_only=False)
def add_constraint_tool(ctx):
    cleaned = normalize_constraint_payload(ctx.classroom, _constraint_payload_from_args(ctx.classroom, ctx.arguments))
    validate_constraint_candidate(ctx.classroom, cleaned)
    before_state = legacy_views._capture_history_state(ctx.classroom)
    constraint = SeatConstraint.objects.create(classroom=ctx.classroom, **cleaned)
    legacy_views._push_snapshot_action(_tool_request(ctx), ctx.classroom, before_state, 'open_api_add_constraint', extra={'constraint_id': constraint.pk})
    return ToolResult(result=serialize_constraints_for_classroom(ctx.classroom), affected=_affected('已添加排座约束'))


@registry.register(name='update_constraint', description='更新排座约束。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'constraint_id': _int('约束 ID', 1), 'constraint_type': _string('约束类型'), 'student': _string('学生'), 'target_student': _string('目标学生'), 'row': _int('行', 1), 'col': _int('列', 1), 'distance': _int('距离', 1), 'enabled': _bool('启用'), 'note': _string('备注')}, ['constraint_id']), category='constraint', read_only=False)
def update_constraint_tool(ctx):
    constraint = ctx.classroom.constraints.filter(pk=safe_int(ctx.arguments.get('constraint_id'))).first()
    if not constraint:
        raise ValueError('约束不存在')
    cleaned = normalize_constraint_payload(ctx.classroom, _constraint_payload_from_args(ctx.classroom, ctx.arguments, instance=constraint), instance=constraint)
    validate_constraint_candidate(ctx.classroom, cleaned, instance=constraint)
    before_state = legacy_views._capture_history_state(ctx.classroom)
    for key, value in cleaned.items():
        setattr(constraint, key, value)
    constraint.save()
    legacy_views._push_snapshot_action(_tool_request(ctx), ctx.classroom, before_state, 'open_api_update_constraint', extra={'constraint_id': constraint.pk})
    return ToolResult(result=serialize_constraints_for_classroom(ctx.classroom), affected=_affected('已更新排座约束'))


@registry.register(name='delete_constraint', description='删除排座约束。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'constraint_id': _int('约束 ID', 1)}, ['constraint_id']), category='constraint', read_only=False, danger_level='medium')
def delete_constraint_tool(ctx):
    result = _invoke_legacy(ctx, legacy_views.delete_constraint, extra_args=[safe_int(ctx.arguments.get('constraint_id'))])
    return ToolResult(result=result, affected=_affected('已删除排座约束'))


@registry.register(name='toggle_constraint', description='启用或禁用排座约束。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'constraint_id': _int('约束 ID', 1), 'enabled': _bool('启用')}, ['constraint_id']), category='constraint', read_only=False)
def toggle_constraint_tool(ctx):
    form_payload = {}
    if ctx.arguments.get('enabled') is not None:
        form_payload['enabled'] = '1' if parse_bool(ctx.arguments.get('enabled')) else '0'
    result = _invoke_legacy(ctx, legacy_views.toggle_constraint, form_payload=form_payload, extra_args=[safe_int(ctx.arguments.get('constraint_id'))])
    return ToolResult(result=result, affected=_affected('已切换排座约束状态'))


@registry.register(name='list_tags', description='列出所有学生标签和标签排座规则。', parameters=_with_classroom(), category='tag', read_only=True)
def list_tags_tool(ctx):
    return serialize_tags_for_classroom(ctx.classroom)


@registry.register(name='create_tag', description='创建学生标签。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'name': _string('标签名'), 'color': _string('颜色'), 'description': _string('说明'), 'sort_order': _int('排序', 0)}, ['name']), category='tag', read_only=False)
def create_tag_tool(ctx):
    result = _invoke_legacy(ctx, legacy_views.student_tags, json_payload={
        'name': ctx.arguments.get('name'),
        'color': ctx.arguments.get('color') or '#0a59f7',
        'description': ctx.arguments.get('description') or '',
        'sort_order': ctx.arguments.get('sort_order') or 0,
    })
    return ToolResult(result=result, affected=_affected(f'已创建标签：{ctx.arguments.get("name")}'))


@registry.register(name='update_tag', description='更新学生标签。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'tag': _string('标签名或 ID'), 'name': _string('新标签名'), 'color': _string('颜色'), 'description': _string('说明'), 'sort_order': _int('排序', 0)}, ['tag']), category='tag', read_only=False)
def update_tag_tool(ctx):
    tag = resolve_tag(ctx.classroom, ctx.arguments.get('tag'))
    payload = {key: ctx.arguments[key] for key in ('name', 'color', 'description', 'sort_order') if key in ctx.arguments}
    result = _invoke_legacy(ctx, legacy_views.update_student_tag, json_payload=payload, extra_args=[tag.pk])
    return ToolResult(result=result, affected=_affected(f'已更新标签：{tag.name}'))


@registry.register(name='delete_tag', description='删除学生标签。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'tag': _string('标签名或 ID')}, ['tag']), category='tag', read_only=False, danger_level='medium')
def delete_tag_tool(ctx):
    tag = resolve_tag(ctx.classroom, ctx.arguments.get('tag'))
    name = tag.name
    result = _invoke_legacy(ctx, legacy_views.delete_student_tag, extra_args=[tag.pk])
    return ToolResult(result=result, affected=_affected(f'已删除标签：{name}'))


def _assign_tag(ctx, mode):
    student = resolve_student(ctx.classroom, ctx.arguments.get('student'), ctx.arguments.get('student_by', 'auto'))
    tags = ctx.arguments.get('tags')
    if tags is None:
        tags = [ctx.arguments.get('tag')]
    tag_ids = [resolve_tag(ctx.classroom, tag).pk for tag in tags if tag not in (None, '')]
    result = _invoke_legacy(ctx, legacy_views.assign_student_tags, json_payload={'student_ids': [student.pk], 'tag_ids': tag_ids, 'mode': mode})
    return ToolResult(result=result, affected=_affected(f'已更新 {student.name} 的标签', students=[student.name]))


@registry.register(name='assign_tag_to_student', description='给学生打标签。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'student': _string('学生'), 'student_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']}, 'tag': _string('标签名或 ID'), 'tags': _array(_string(), '多个标签')}, ['student']), category='tag', read_only=False)
def assign_tag_to_student_tool(ctx):
    return _assign_tag(ctx, 'add')


@registry.register(name='remove_tag_from_student', description='移除学生标签。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'student': _string('学生'), 'student_by': {'type': 'string', 'enum': ['auto', 'name', 'student_id', 'id']}, 'tag': _string('标签名或 ID'), 'tags': _array(_string(), '多个标签')}, ['student']), category='tag', read_only=False)
def remove_tag_from_student_tool(ctx):
    return _assign_tag(ctx, 'remove')


@registry.register(name='bulk_tag_by_criteria', description='按条件批量打标签，例如给所有成绩大于 90 的学生打优秀标签。注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。', parameters=_with_classroom({'tag': _string('标签名或 ID'), 'create_if_missing': _bool('标签不存在时创建'), 'criteria': _schema({}, allow_extra=True)}, ['tag']), category='tag', read_only=False, danger_level='dangerous')
def bulk_tag_by_criteria_tool(ctx):
    tag_value = ctx.arguments.get('tag')
    tag = None
    try:
        tag = resolve_tag(ctx.classroom, tag_value)
    except ValueError:
        if parse_bool(ctx.arguments.get('create_if_missing'), default=False):
            tag = StudentTag.objects.create(classroom=ctx.classroom, name=str(tag_value).strip(), color='#0a59f7')
        else:
            raise
    students = list(_student_filter_queryset(ctx.classroom, ctx.arguments.get('criteria') or {}))
    result = _invoke_legacy(ctx, legacy_views.assign_student_tags, json_payload={'student_ids': [student.pk for student in students], 'tag_ids': [tag.pk], 'mode': 'add'})
    return ToolResult(result=result, affected=_affected(f'已给 {len(students)} 名学生打上标签：{tag.name}', students=[student.name for student in students]))


@registry.register(name='list_tag_rules', description='列出所有标签排座规则。', parameters=_with_classroom(), category='tag', read_only=True)
def list_tag_rules_tool(ctx):
    rules, metrics = serialize_tag_rules(ctx.classroom)
    return {'tag_rules': rules, 'metrics': metrics}


def _tag_rule_args(ctx, instance=None):
    tag = resolve_tag(ctx.classroom, ctx.arguments.get('tag')) if ctx.arguments.get('tag') else (instance.tag if instance else None)
    payload = {
        'tag': tag,
        'tag_id': tag.pk if tag else None,
        'rule_type': ctx.arguments.get('rule_type') or (instance.rule_type if instance else ''),
        'row_min': ctx.arguments.get('row_min') if ctx.arguments.get('row_min') is not None else (instance.row_min if instance else None),
        'row_max': ctx.arguments.get('row_max') if ctx.arguments.get('row_max') is not None else (instance.row_max if instance else None),
        'col_min': ctx.arguments.get('col_min') if ctx.arguments.get('col_min') is not None else (instance.col_min if instance else None),
        'col_max': ctx.arguments.get('col_max') if ctx.arguments.get('col_max') is not None else (instance.col_max if instance else None),
        'distance': ctx.arguments.get('distance') if ctx.arguments.get('distance') is not None else (instance.distance if instance else 1),
        'enabled': ctx.arguments.get('enabled') if ctx.arguments.get('enabled') is not None else (instance.enabled if instance else True),
        'priority': ctx.arguments.get('priority') if ctx.arguments.get('priority') is not None else (instance.priority if instance else 0),
        'note': ctx.arguments.get('note') if ctx.arguments.get('note') is not None else (instance.note if instance else ''),
    }
    return payload


TAG_RULE_PROPS = {'tag': _string('标签名或 ID'), 'rule_type': _string('规则类型'), 'row_min': _int('起始行', 1), 'row_max': _int('结束行', 1), 'col_min': _int('起始列', 1), 'col_max': _int('结束列', 1), 'distance': _int('距离', 1), 'enabled': _bool('启用'), 'priority': _int('优先级', 0), 'note': _string('备注')}


@registry.register(name='create_tag_rule', description='创建标签排座规则。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom(TAG_RULE_PROPS, ['tag', 'rule_type']), category='tag', read_only=False)
def create_tag_rule_tool(ctx):
    cleaned = normalize_tag_rule_payload(ctx.classroom, _tag_rule_args(ctx))
    before_state = legacy_views._capture_history_state(ctx.classroom)
    rule = ctx.classroom.student_tag_rules.create(**cleaned)
    legacy_views._push_snapshot_action(_tool_request(ctx), ctx.classroom, before_state, 'open_api_create_tag_rule', extra={'tag_rule_id': rule.pk})
    return ToolResult(result=serialize_tags_for_classroom(ctx.classroom), affected=_affected('已创建标签规则'))


@registry.register(name='update_tag_rule', description='更新标签排座规则。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({**TAG_RULE_PROPS, 'rule_id': _int('规则 ID', 1)}, ['rule_id']), category='tag', read_only=False)
def update_tag_rule_tool(ctx):
    rule = ctx.classroom.student_tag_rules.filter(pk=safe_int(ctx.arguments.get('rule_id'))).first()
    if not rule:
        raise ValueError('标签规则不存在')
    cleaned = normalize_tag_rule_payload(ctx.classroom, _tag_rule_args(ctx, rule), instance=rule)
    before_state = legacy_views._capture_history_state(ctx.classroom)
    for key, value in cleaned.items():
        setattr(rule, key, value)
    rule.save()
    legacy_views._push_snapshot_action(_tool_request(ctx), ctx.classroom, before_state, 'open_api_update_tag_rule', extra={'tag_rule_id': rule.pk})
    return ToolResult(result=serialize_tags_for_classroom(ctx.classroom), affected=_affected('已更新标签规则'))


@registry.register(name='toggle_tag_rule', description='启用或禁用标签排座规则。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'rule_id': _int('规则 ID', 1), 'enabled': _bool('启用')}, ['rule_id']), category='tag', read_only=False)
def toggle_tag_rule_tool(ctx):
    result = _invoke_legacy(ctx, legacy_views.toggle_tag_rule, json_payload={'enabled': ctx.arguments.get('enabled')}, extra_args=[safe_int(ctx.arguments.get('rule_id'))])
    return ToolResult(result=result, affected=_affected('已切换标签规则状态'))


@registry.register(name='delete_tag_rule', description='删除标签排座规则。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'rule_id': _int('规则 ID', 1)}, ['rule_id']), category='tag', read_only=False, danger_level='medium')
def delete_tag_rule_tool(ctx):
    result = _invoke_legacy(ctx, legacy_views.delete_tag_rule, extra_args=[safe_int(ctx.arguments.get('rule_id'))])
    return ToolResult(result=result, affected=_affected('已删除标签规则'))


@registry.register(name='list_snapshots', description='列出布局快照。', parameters=_with_classroom(), category='snapshot', read_only=True)
def list_snapshots_tool(ctx):
    return {'snapshots': [serialize_snapshot(snapshot) for snapshot in ctx.classroom.layout_snapshots.order_by('-created_at', '-pk')]}


@registry.register(name='create_snapshot', description='保存当前布局为快照。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'name': _string('快照名称')}, ['name']), category='snapshot', read_only=False)
def create_snapshot_tool(ctx):
    name = str(ctx.arguments.get('name') or '').strip()
    result = _invoke_legacy(ctx, legacy_views.save_layout_snapshot, form_payload={'snapshot_name': name})
    return ToolResult(result=result, affected=_affected(f'已保存快照：{name}'))


@registry.register(name='load_snapshot', description='加载快照并恢复布局。注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。', parameters=_with_classroom({'snapshot': _string('快照名称或 ID')}, ['snapshot']), category='snapshot', read_only=False, danger_level='dangerous')
def load_snapshot_tool(ctx):
    snapshot = resolve_snapshot(ctx.classroom, ctx.arguments.get('snapshot'))
    result = _invoke_legacy(ctx, legacy_views.load_layout_snapshot, extra_args=[snapshot.pk])
    return ToolResult(result=result, affected=_affected(f'已加载快照：{snapshot.name}'))


@registry.register(name='delete_snapshot', description='删除布局快照。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom({'snapshot': _string('快照名称或 ID')}, ['snapshot']), category='snapshot', read_only=False, danger_level='medium')
def delete_snapshot_tool(ctx):
    snapshot = resolve_snapshot(ctx.classroom, ctx.arguments.get('snapshot'))
    name = snapshot.name
    result = _invoke_legacy(ctx, legacy_views.delete_layout_snapshot, extra_args=[snapshot.pk])
    return ToolResult(result=result, affected=_affected(f'已删除快照：{name}'))


@registry.register(name='undo', description='撤销上一步操作。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom(), category='history', read_only=False)
def undo_tool(ctx):
    result = _invoke_legacy(ctx, legacy_views.undo_action)
    return ToolResult(result=result, affected=_affected('已撤销上一步操作'))


@registry.register(name='redo', description='重做被撤销的操作。注意：此操作会修改数据，请先向用户口头确认是否继续。', parameters=_with_classroom(), category='history', read_only=False)
def redo_tool(ctx):
    result = _invoke_legacy(ctx, legacy_views.redo_action)
    return ToolResult(result=result, affected=_affected('已重做操作'))


@registry.register(name='get_history', description='查看操作历史记录。', parameters=_with_classroom({'limit': _int('返回数量', 1), 'applied': _bool('是否只看已应用记录') }), category='history', read_only=True)
def get_history_tool(ctx):
    qs = ClassroomHistoryEntry.objects.filter(classroom=ctx.classroom).order_by('-pk')
    if ctx.arguments.get('applied') is not None:
        qs = qs.filter(is_applied=parse_bool(ctx.arguments.get('applied')))
    limit = max(1, min(500, safe_int(ctx.arguments.get('limit'), 100)))
    return {'history': [serialize_history_entry(entry) for entry in qs[:limit]]}


@registry.register(name='export_seats_file', description='导出 .seats 文件，返回 base64 内容。', parameters=_with_classroom(), category='data', read_only=True)
def export_seats_file_tool(ctx):
    return _invoke_export_view(ctx, legacy_views.export_seats_file)


@registry.register(name='export_excel', description='导出 Excel 座位图，返回 base64 内容。', parameters=_with_classroom({'rotate_180': _bool('是否旋转 180 度')}), category='data', read_only=True)
def export_excel_tool(ctx):
    return _invoke_export_view(ctx, legacy_views.export_students, query={'rotate_180': '1' if parse_bool(ctx.arguments.get('rotate_180')) else ''})


@registry.register(name='export_svg', description='导出 SVG 座位图，返回 base64 内容。', parameters=_with_classroom({'theme': _string('主题')}), category='data', read_only=True)
def export_svg_tool(ctx):
    return _invoke_export_view(ctx, legacy_views.export_students_svg, query={'theme': ctx.arguments.get('theme') or 'classic'})


@registry.register(name='export_pptx', description='导出 PPTX 座位图，返回 base64 内容。', parameters=_with_classroom({'theme': _string('主题')}), category='data', read_only=True)
def export_pptx_tool(ctx):
    return _invoke_export_view(ctx, legacy_views.export_students_pptx, query={'theme': ctx.arguments.get('theme') or 'classic'})


@registry.register(name='import_students_from_excel', description='从 Excel base64 或 students 数组导入学生。注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。', parameters=_with_classroom({'file_base64': _string('Excel 文件 base64'), 'students': _array(_schema({'name': _string(), 'student_id': _string(), 'gender': _string(), 'score': _number()}, ['name'])), 'mode': {'type': 'string', 'enum': ['append', 'replace']} }), category='data', read_only=False, danger_level='dangerous')
def import_students_from_excel_tool(ctx):
    if ctx.arguments.get('students'):
        if ctx.arguments.get('mode') == 'replace':
            before_state = legacy_views._capture_history_state(ctx.classroom)
            ctx.classroom.students.all().delete()
            legacy_views._push_snapshot_action(_tool_request(ctx), ctx.classroom, before_state, 'open_api_replace_students')
        return add_students_batch_tool(ctx)
    file_b64 = str(ctx.arguments.get('file_base64') or '').strip()
    if not file_b64:
        raise ValueError('缺少 file_base64 或 students')
    raw = base64.b64decode(file_b64)
    wb = openpyxl.load_workbook(BytesIO(raw))
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise ValueError('Excel 没有数据')
    headers = [str(value or '').strip() for value in rows[0]]
    def find_header(candidates, default=None):
        for candidate in candidates:
            if candidate in headers:
                return headers.index(candidate)
        return default
    name_idx = find_header(['姓名', 'name', 'Name'], 0)
    sid_idx = find_header(['学号', 'student_id', 'Student ID'])
    gender_idx = find_header(['性别', 'gender'])
    score_idx = find_header(['成绩', 'score'])
    students = []
    for row in rows[1:]:
        name = str(row[name_idx] or '').strip() if name_idx is not None and name_idx < len(row) else ''
        if not name:
            continue
        students.append({
            'name': name,
            'student_id': str(row[sid_idx] or '').strip() if sid_idx is not None and sid_idx < len(row) else '',
            'gender': str(row[gender_idx] or '').strip() if gender_idx is not None and gender_idx < len(row) else '',
            'score': row[score_idx] if score_idx is not None and score_idx < len(row) else 0,
        })
    return registry.execute('add_students_batch', classroom_id=ctx.classroom.pk, arguments={'students': students}, request=_tool_request(ctx))


@registry.register(name='import_layout_from_excel', description='从 .seats JSON/base64 或结构化 layout 对象导入布局。注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。', parameters=_with_classroom({'file_base64': _string('seats/json 文件 base64'), 'layout': _schema({}, allow_extra=True)}, allow_extra=True), category='data', read_only=False, danger_level='dangerous')
def import_layout_from_excel_tool(ctx):
    payload = ctx.arguments.get('layout')
    if not payload and ctx.arguments.get('file_base64'):
        payload = json.loads(base64.b64decode(str(ctx.arguments.get('file_base64'))).decode('utf-8'))
    if not isinstance(payload, dict):
        raise ValueError('缺少 layout 或 file_base64')
    before_state = legacy_views._capture_history_state(ctx.classroom)
    legacy_views._import_seats_file_payload(ctx.classroom, payload, request=_tool_request(ctx))
    legacy_views._push_snapshot_action(_tool_request(ctx), ctx.classroom, before_state, 'open_api_import_layout')
    return ToolResult(result={'imported': True, 'classroom': serialize_classroom(ctx.classroom)}, affected=_affected('已导入布局'))


@registry.register(name='analyze_seating', description='全面座位分析：密度、成绩分布、男女分布、小组均衡度和异常信息。', parameters=_with_classroom(), category='advanced', read_only=True)
def analyze_seating_tool(ctx):
    return seating_analysis(ctx.classroom)


@registry.register(name='validate_seating', description='校验座位问题：未入座、约束冲突和标签规则违规。', parameters=_with_classroom(), category='advanced', read_only=True)
def validate_seating_tool(ctx):
    return validate_seating_payload(ctx.classroom)


@registry.register(name='suggest_improvements', description='基于当前座位状态给出可优化方向。', parameters=_with_classroom(), category='advanced', read_only=True)
def suggest_improvements_tool(ctx):
    validation = validate_seating_payload(ctx.classroom)
    analysis = seating_analysis(ctx.classroom)
    suggestions = []
    if analysis['density']['empty_seats'] > 0 and analysis['unseated_students']:
        suggestions.append('当前有未入座学生且仍有空座位，可调用 assign_unseated 自动补齐。')
    if validation['issue_count']:
        suggestions.append('当前存在约束或标签规则问题，建议先查看 validate_seating 的 issues。')
    group_scores = [row.get('avg_score') or row.get('average_score') or 0 for row in analysis.get('group_stats') or []]
    if group_scores and max(group_scores) - min(group_scores) >= 10:
        suggestions.append('小组平均分差距较大，可考虑 arrange_seats(mode="group_balanced")。')
    if not suggestions:
        suggestions.append('当前座位状态整体稳定，暂无明显高优先级调整。')
    return {'suggestions': suggestions, 'analysis': analysis, 'validation': validation}


@registry.register(name='cross_classroom_report', description='跨教室对比报告。', parameters=_schema({'classroom_ids': _array(_int(), '教室 ID 列表') }), category='advanced', read_only=True, requires_classroom=False)
def cross_classroom_report_tool(ctx):
    ids = ctx.arguments.get('classroom_ids') or []
    qs = Classroom.objects.all().order_by('name', 'pk')
    if ids:
        qs = qs.filter(pk__in=[int(item) for item in ids])
    return classroom_report(list(qs))


@registry.register(name='batch_operation', description='注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。原子化批量执行多个工具操作。', parameters=_with_classroom({'operations': _array(_schema({'tool': _string('工具名'), 'arguments': _schema({}, allow_extra=True)}, ['tool'], allow_extra=True), '操作列表')}, ['operations']), category='advanced', read_only=False, danger_level='dangerous')
def batch_operation_tool(ctx):
    operations = ctx.arguments.get('operations') or []
    results = []
    with transaction.atomic():
        for operation in operations:
            results.append(registry.execute(
                operation.get('tool'),
                classroom_id=operation.get('classroom_id') or ctx.classroom.pk,
                arguments=operation.get('arguments') or {},
                request=_tool_request(ctx),
            ))
    return ToolResult(result={'results': results, 'count': len(results)}, affected=_affected(f'已批量执行 {len(results)} 个操作'))


@registry.register(name='rearrange_by_description', description='按自然语言描述排座，会选择最接近的内置或自定义排座流程执行。注意：此操作会大规模修改数据，请务必先向用户口头确认并获得明确同意后再执行。', parameters=_with_classroom({'description': _string('排座描述')}, ['description']), category='advanced', read_only=False, danger_level='dangerous')
def rearrange_by_description_tool(ctx):
    return arrange_with_custom_rules_tool(ctx)



@registry.register(
    name='ai_operation_begin',
    description='通知前端 AI 即将开始操作 FuckSeats，前端会显示「AI 操作中」全屏提示并暂时阻挡用户操作。在开始任何会修改教室数据的任务前调用一次。可选提供 task_id 用于配对结束信号，message 展示给用户。',
    parameters=_schema({
        'task_id': _string('任务标识，可选，用于与 ai_operation_end 配对'),
        'message': _string('展示给用户的操作说明，例如「正在为三班排座位」'),
    }),
    category='ai',
    read_only=False,
    requires_classroom=False,
    danger_level='safe',
)
def ai_operation_begin_tool(ctx):
    from . import ai_session
    snap = ai_session.begin(
        task_id=ctx.arguments.get('task_id'),
        message=str(ctx.arguments.get('message') or 'AI 正在操作中，请稍候'),
    )
    return ToolResult(result=snap, affected={})


@registry.register(
    name='ai_operation_progress',
    description='更新「AI 操作中」提示上的进度文案或百分比，不改变提示的显示状态。可在长时间任务中段调用以反馈进度。',
    parameters=_schema({
        'task_id': _string('任务标识，可选，需与 ai_operation_begin 一致才会更新'),
        'message': _string('新的操作说明文案'),
        'progress': _number('进度百分比 0-100，可选'),
    }),
    category='ai',
    read_only=False,
    requires_classroom=False,
    danger_level='safe',
)
def ai_operation_progress_tool(ctx):
    from . import ai_session
    snap = ai_session.update(
        task_id=ctx.arguments.get('task_id'),
        message=ctx.arguments.get('message'),
        progress=ctx.arguments.get('progress'),
    )
    return ToolResult(result=snap, affected={})


@registry.register(
    name='ai_operation_end',
    description='通知前端 AI 操作全部结束，关闭「AI 操作中」全屏提示。在所有操作（含校验）完成后必须调用一次。若提供了与 begin 一致的 task_id，仅结束该任务；否则结束当前任务。',
    parameters=_schema({
        'task_id': _string('任务标识，可选，仅当与 begin 的 task_id 一致时才会结束'),
    }),
    category='ai',
    read_only=False,
    requires_classroom=False,
    danger_level='safe',
)
def ai_operation_end_tool(ctx):
    from . import ai_session
    snap = ai_session.end(task_id=ctx.arguments.get('task_id'))
    return ToolResult(result=snap, affected={})
