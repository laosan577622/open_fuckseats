from collections import defaultdict

from django.db import models
from pypinyin import lazy_pinyin

from seats.constraints import (
    get_constraint_type_definitions,
    get_tag_rule_type_definitions,
    serialize_constraints,
    serialize_tag_rules,
)
from seats.models import (
    Classroom,
    ClassroomGroup,
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


ARRANGE_MODE_DEFINITIONS = [
    {'value': 'standard', 'label': '按姓名拼音首字母'},
    {'value': 'student_id', 'label': '按学号'},
    {'value': 'score_first', 'label': '高分靠前'},
    {'value': 'score_balanced', 'label': '高低搭配'},
    {'value': 'snake', 'label': '蛇形排列'},
    {'value': 'random', 'label': '随机'},
    {'value': 'group_balanced', 'label': '小组内成绩均衡'},
    {'value': 'group_mentor', 'label': '小组导师制'},
]


def safe_int(value, default=0):
    return legacy_views._safe_int(value, default)


def parse_bool(value, default=False):
    if value in (None, ''):
        return default
    return legacy_views._parse_bool(value)


def serialize_classroom(classroom, *, include_metrics=True):
    data = {
        'id': classroom.pk,
        'name': classroom.name,
        'rows': classroom.rows,
        'cols': classroom.cols,
        'created_at': classroom.created_at.isoformat() if classroom.created_at else '',
        'classroom_group': {
            'id': classroom.classroom_group_id,
            'name': classroom.classroom_group.name,
            'uuid': str(classroom.classroom_group.uuid),
        } if classroom.classroom_group_id and classroom.classroom_group else None,
        'podium_guards': legacy_views._serialize_podium_guards(classroom),
    }
    if include_metrics:
        data['metrics'] = {
            'students': classroom.students.count(),
            'seated_students': classroom.students.filter(assigned_seat__isnull=False).count(),
            'unseated_students': classroom.students.filter(assigned_seat__isnull=True).count(),
            'seats': classroom.seats.count(),
            'available_seats': classroom.seats.filter(cell_type=SeatCellType.SEAT).count(),
            'groups': classroom.groups.count(),
            'constraints': classroom.constraints.count(),
            'tags': classroom.student_tags.count(),
            'snapshots': classroom.layout_snapshots.count(),
        }
    return data


def serialize_classroom_group(classroom_group, *, include_classrooms=True):
    data = {
        'id': classroom_group.pk,
        'uuid': str(classroom_group.uuid),
        'name': classroom_group.name,
        'sort_order': classroom_group.sort_order,
        'created_at': classroom_group.created_at.isoformat() if classroom_group.created_at else '',
        'classroom_count': classroom_group.classrooms.count(),
    }
    if include_classrooms:
        data['classrooms'] = [
            serialize_classroom(item)
            for item in classroom_group.classrooms.select_related('classroom_group').order_by(
                'group_order',
                'created_at',
                'pk',
            )
        ]
    return data


def serialize_student(student, classroom=None):
    classroom = classroom or student.classroom
    return legacy_views._serialize_student_profile(
        student,
        classroom=classroom,
        tag_map=legacy_views._build_student_tag_map(classroom, [student.pk]),
    )


def serialize_seat(seat):
    return {
        'row': seat.row,
        'col': seat.col,
        'cell_type': seat.cell_type,
        'cell_type_display': seat.get_cell_type_display(),
        'student': serialize_student(seat.student, seat.classroom) if seat.student_id and seat.student else None,
        'group': {
            'id': seat.group_id,
            'name': seat.group.name,
        } if seat.group_id and seat.group else None,
    }


def serialize_seat_map(classroom):
    seats = list(classroom.seats.select_related('student', 'group').order_by('row', 'col'))
    by_coord = {(seat.row, seat.col): serialize_seat(seat) for seat in seats}
    matrix = []
    for row in range(1, classroom.rows + 1):
        matrix.append([by_coord.get((row, col)) for col in range(1, classroom.cols + 1)])
    return {
        'classroom': serialize_classroom(classroom, include_metrics=False),
        'rows': classroom.rows,
        'cols': classroom.cols,
        'seats': [by_coord[(seat.row, seat.col)] for seat in seats],
        'matrix': matrix,
    }


def serialize_group(group):
    seats = list(group.seats.select_related('student').filter(cell_type=SeatCellType.SEAT).order_by('row', 'col'))
    members = []
    for seat in seats:
        if seat.student_id and seat.student:
            item = serialize_student(seat.student, group.classroom)
            item['seat'] = {'row': seat.row, 'col': seat.col}
            members.append(item)
    scores = [member.get('score') or 0 for member in members]
    return {
        'id': group.pk,
        'name': group.name,
        'order': group.order,
        'leader': serialize_student(group.leader, group.classroom) if group.leader_id and group.leader else None,
        'seat_count': len(seats),
        'member_count': len(members),
        'members': members,
        'stats': {
            'average_score': round(sum(scores) / len(scores), 2) if scores else 0,
            'max_score': max(scores) if scores else 0,
            'min_score': min(scores) if scores else 0,
        },
    }


def serialize_groups(classroom):
    return [serialize_group(group) for group in classroom.groups.select_related('leader').order_by('order', 'created_at', 'pk')]


def serialize_constraints_for_classroom(classroom):
    items, metrics = serialize_constraints(classroom)
    return {'items': items, 'metrics': metrics, 'types': get_constraint_type_definitions()}


def serialize_tags_for_classroom(classroom):
    tag_rules, tag_rule_metrics = serialize_tag_rules(classroom)
    return {
        'tags': legacy_views._serialize_student_tag_catalog(classroom),
        'tag_rules': tag_rules,
        'tag_rule_types': get_tag_rule_type_definitions(),
        'tag_rule_metrics': tag_rule_metrics,
    }


def serialize_snapshot(snapshot):
    return {
        'id': snapshot.pk,
        'name': snapshot.name,
        'created_at': snapshot.created_at.isoformat() if snapshot.created_at else '',
        'data': snapshot.data,
    }


def serialize_history_entry(entry):
    return {
        'id': entry.pk,
        'action_type': entry.action_type,
        'payload': entry.payload or {},
        'is_applied': entry.is_applied,
        'created_at': entry.created_at.isoformat() if entry.created_at else '',
    }


def classroom_detail_payload(classroom, *, include_tools=False, tools=None):
    payload = {
        'classroom': serialize_classroom(classroom),
        'seat_map': serialize_seat_map(classroom),
        'students': [
            serialize_student(student, classroom)
            for student in classroom.students.select_related('assigned_seat__group').order_by('name', 'pk')
        ],
        'groups': serialize_groups(classroom),
        'constraints': serialize_constraints_for_classroom(classroom),
        'tags': serialize_tags_for_classroom(classroom),
        'snapshots': [
            serialize_snapshot(snapshot)
            for snapshot in classroom.layout_snapshots.order_by('-created_at', '-pk')
        ],
    }
    if include_tools:
        payload['tools'] = tools or []
    return payload


def resolve_student(classroom, value, by='auto'):
    text = str(value or '').strip()
    if not text:
        raise ValueError('学生查询不能为空')
    mode = str(by or 'auto').strip().lower()
    queryset = classroom.students.select_related('assigned_seat__group')
    if mode == 'id' or (mode == 'auto' and text.isdigit()):
        student = queryset.filter(pk=int(text)).first()
        if student:
            return student
        if mode == 'id':
            raise ValueError(f'未找到学生 ID：{text}')
    if mode == 'student_id':
        matches = list(queryset.filter(student_id=text)[:2])
    elif mode == 'name':
        matches = list(queryset.filter(name=text)[:2])
    else:
        matches = list(queryset.filter(models.Q(name=text) | models.Q(student_id=text))[:2])
        if not matches:
            matches = list(queryset.filter(models.Q(name__icontains=text) | models.Q(student_id__icontains=text))[:3])
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValueError(f'找到多个学生匹配“{text}”，请改用学生 ID 或学号')
    raise ValueError(f'未找到学生：{text}')


def resolve_group(classroom, value, by='auto'):
    text = str(value or '').strip()
    if not text:
        raise ValueError('小组查询不能为空')
    if str(by or 'auto').lower() == 'id' or text.isdigit():
        group = classroom.groups.filter(pk=int(text)).first()
        if group:
            return group
    matches = list(classroom.groups.filter(name=text)[:2])
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValueError(f'存在多个同名小组：{text}')
    matches = list(classroom.groups.filter(name__icontains=text)[:3])
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValueError(f'找到多个小组匹配“{text}”')
    raise ValueError(f'未找到小组：{text}')


def resolve_tag(classroom, value, by='auto'):
    text = str(value or '').strip()
    if not text:
        raise ValueError('标签查询不能为空')
    if str(by or 'auto').lower() == 'id' or text.isdigit():
        tag = classroom.student_tags.filter(pk=int(text)).first()
        if tag:
            return tag
    tag = classroom.student_tags.filter(name=text).first()
    if tag:
        return tag
    raise ValueError(f'未找到标签：{text}')


def resolve_snapshot(classroom, value):
    text = str(value or '').strip()
    if not text:
        raise ValueError('快照查询不能为空')
    if text.isdigit():
        snapshot = classroom.layout_snapshots.filter(pk=int(text)).first()
        if snapshot:
            return snapshot
    matches = list(classroom.layout_snapshots.filter(name=text).order_by('-created_at', '-pk')[:2])
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValueError('存在同名快照，请使用快照 ID')
    raise ValueError(f'未找到快照：{text}')


def student_sort_key(student, mode):
    mode = str(mode or 'standard')
    if mode == 'student_id':
        return (str(student.student_id or ''), student.name, student.pk)
    if mode in {'score_first', 'score_desc'}:
        return (-(student.score or 0), student.name, student.pk)
    if mode == 'score_asc':
        return (student.score or 0, student.name, student.pk)
    return (''.join(lazy_pinyin(student.name)), student.name, student.pk)


def seating_analysis(classroom):
    students = list(classroom.students.select_related('assigned_seat__group'))
    seats = list(classroom.seats.select_related('student', 'group'))
    seat_cells = [seat for seat in seats if seat.cell_type == SeatCellType.SEAT]
    seated = [student for student in students if getattr(student, 'assigned_seat', None)]
    unseated = [student for student in students if not getattr(student, 'assigned_seat', None)]
    row_scores = defaultdict(list)
    col_scores = defaultdict(list)
    gender_counts = defaultdict(lambda: {'M': 0, 'F': 0, 'unknown': 0})
    for seat in seat_cells:
        if not seat.student_id or not seat.student:
            continue
        score = seat.student.score or 0
        row_scores[seat.row].append(score)
        col_scores[seat.col].append(score)
        gender = seat.student.gender if seat.student.gender in {'M', 'F'} else 'unknown'
        gender_counts[seat.row][gender] += 1
    group_rows = legacy_views._get_group_score_rows(classroom)
    return {
        'classroom': serialize_classroom(classroom),
        'density': {
            'available_seats': len(seat_cells),
            'occupied_seats': len(seated),
            'empty_seats': max(0, len(seat_cells) - len(seated)),
            'occupancy_rate': round(len(seated) / len(seat_cells), 4) if seat_cells else 0,
        },
        'unseated_students': [serialize_student(student, classroom) for student in unseated],
        'score_distribution': {
            'by_row': {
                str(row): round(sum(scores) / len(scores), 2)
                for row, scores in sorted(row_scores.items())
                if scores
            },
            'by_col': {
                str(col): round(sum(scores) / len(scores), 2)
                for col, scores in sorted(col_scores.items())
                if scores
            },
        },
        'gender_distribution_by_row': dict(gender_counts),
        'group_stats': group_rows,
    }


def validate_seating_payload(classroom):
    issues = []
    constraints, constraint_metrics = serialize_constraints(classroom)
    tag_rules, tag_rule_metrics = serialize_tag_rules(classroom)
    unseated = list(classroom.students.filter(assigned_seat__isnull=True).order_by('name', 'pk'))
    for student in unseated:
        issues.append({
            'type': 'unseated_student',
            'severity': 'warning',
            'message': f'{student.name} 尚未入座',
            'student': serialize_student(student, classroom),
        })
    for item in constraints:
        for message in item.get('issues') or []:
            issues.append({
                'type': 'constraint',
                'severity': 'error',
                'message': message,
                'constraint': item,
            })
    for item in tag_rules:
        for message in item.get('issues') or []:
            issues.append({
                'type': 'tag_rule',
                'severity': 'error',
                'message': message,
                'tag_rule': item,
            })
    return {
        'ok': not any(issue['severity'] == 'error' for issue in issues),
        'issue_count': len(issues),
        'issues': issues,
        'constraint_metrics': constraint_metrics,
        'tag_rule_metrics': tag_rule_metrics,
    }


def classroom_report(classrooms):
    rows = []
    for classroom in classrooms:
        analysis = seating_analysis(classroom)
        rows.append({
            'classroom': serialize_classroom(classroom),
            'density': analysis['density'],
            'group_count': classroom.groups.count(),
            'average_score': round(classroom.students.aggregate(avg=models.Avg('score')).get('avg') or 0, 2),
        })
    return {'classrooms': rows, 'count': len(rows)}
