from django.shortcuts import render, redirect, get_object_or_404
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_POST
from django.db import transaction, models, IntegrityError
from django.utils import timezone
from django.urls import reverse
from django.utils.encoding import escape_uri_path
from django.conf import settings
from .models import Classroom, Student, Seat, SeatCellType, SeatGroup, LayoutSnapshot, SeatConstraint
import pandas as pd
from io import BytesIO
import json
import random
import os
import re
import uuid
import html
import openpyxl
import math
from collections import defaultdict
from openpyxl.styles import Alignment, Border, Side, Font, PatternFill
from openpyxl.utils import get_column_letter

DISABLED_SUGGESTION_TYPES = {'jqj_hzh'}


def index(request):
    classrooms = Classroom.objects.all().order_by('-created_at')
    return render(request, 'seats/index.html', {'classrooms': classrooms})


def create_classroom(request):
    if request.method == 'POST':
        name = request.POST.get('name')
        rows = int(request.POST.get('rows', 6))
        cols = int(request.POST.get('cols', 8))
        Classroom.objects.create(name=name, rows=rows, cols=cols)
        return redirect('index')
    return render(request, 'seats/create_classroom.html')


def _seat_key(row, col):
    return f"{row}-{col}"


def _build_seat_map(seats):
    return {(s.row, s.col): s for s in seats}


SVG_EXPORT_THEME_MAP = {
    'classic': {
        'bg': '#f7faff',
        'title': '#0f172a',
        'name': '#111827',
        'sub': '#667085',
        'type': '#475467',
        'podium_fill': '#e7efff',
        'podium_stroke': '#c9dbff',
        'seat_fill_occupied': '#eef4ff',
        'seat_stroke_occupied': '#bfd4ff',
        'seat_fill_empty': '#f8fbff',
        'seat_stroke_empty': '#d3e1ff',
        'nonseat_stroke': '#d0d5dd',
        'nonseat_aisle': '#eff3f8',
        'nonseat_podium': '#fff3e8',
        'nonseat_empty': '#f2f4f7',
        'tag_text': '#ffffff',
        'group_palette': ['#0a59f7', '#00a38c', '#ff8b00', '#e45193', '#6b64ff', '#2ca2ff', '#13a44a', '#c85a0f'],
    },
    'minimal': {
        'bg': '#f8fafc',
        'title': '#1f2937',
        'name': '#111827',
        'sub': '#6b7280',
        'type': '#4b5563',
        'podium_fill': '#edf2f7',
        'podium_stroke': '#d2dae6',
        'seat_fill_occupied': '#f9fafb',
        'seat_stroke_occupied': '#cbd5e1',
        'seat_fill_empty': '#ffffff',
        'seat_stroke_empty': '#d1d5db',
        'nonseat_stroke': '#d1d5db',
        'nonseat_aisle': '#f1f5f9',
        'nonseat_podium': '#f3f4f6',
        'nonseat_empty': '#f8fafc',
        'tag_text': '#ffffff',
        'group_palette': ['#0a59f7', '#64748b', '#0f766e', '#b45309', '#be123c', '#1d4ed8', '#065f46', '#7c3aed'],
    },
    'contrast': {
        'bg': '#0b1220',
        'title': '#e5ecff',
        'name': '#ffffff',
        'sub': '#b7c7e9',
        'type': '#d2dbf5',
        'podium_fill': '#1c2f5d',
        'podium_stroke': '#33509c',
        'seat_fill_occupied': '#172a55',
        'seat_stroke_occupied': '#3b5db7',
        'seat_fill_empty': '#111b34',
        'seat_stroke_empty': '#30477f',
        'nonseat_stroke': '#2e426f',
        'nonseat_aisle': '#1d2a44',
        'nonseat_podium': '#2a2f4d',
        'nonseat_empty': '#202c47',
        'tag_text': '#ffffff',
        'group_palette': ['#0a59f7', '#0fa968', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#f97316', '#14b8a6'],
    },
}


def _name_emphasis_font_size(text):
    length = max(1, len(str(text or '')))
    size = 30 - length * 2
    if size < 16:
        size = 16
    if size > 26:
        size = 26
    return size


def _hex_to_rgb_parts(color):
    raw = str(color or '').strip().lstrip('#')
    if len(raw) == 3:
        raw = ''.join(ch * 2 for ch in raw)
    if len(raw) != 6:
        return 0, 0, 0
    try:
        return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)
    except ValueError:
        return 0, 0, 0


def _sync_seats(classroom, rows, cols):
    if classroom.rows != rows or classroom.cols != cols:
        classroom.rows = rows
        classroom.cols = cols
        classroom.save(update_fields=['rows', 'cols'])
    classroom.seats.filter(models.Q(row__gt=rows) | models.Q(col__gt=cols)).delete()
    classroom.generate_seats()


def _snapshot_payload(classroom, include_students=True, include_constraints=True):
    seats = list(classroom.seats.select_related('student', 'group'))
    groups = list(classroom.groups.all())
    students = list(classroom.students.all())
    constraints = list(classroom.constraints.all())

    data = {
        'meta': {
            'app': '不想排座位',
            'version': '1.0',
            'exported_at': timezone.now().isoformat()
        },
        'classroom': {
            'name': classroom.name,
            'rows': classroom.rows,
            'cols': classroom.cols
        },
        'seats': [
            {
                'row': seat.row,
                'col': seat.col,
                'cell_type': seat.cell_type,
                'student_pk': seat.student.pk if seat.student else None,
                'student_id': seat.student.student_id if seat.student else None,
                'student_name': seat.student.name if seat.student else None,
                'group_name': seat.group.name if seat.group else None
            }
            for seat in seats
        ],
        'groups': [
            {
                'name': group.name,
                'order': group.order
            }
            for group in groups
        ]
    }

    if include_students:
        data['students'] = [
            {
                'name': student.name,
                'student_id': student.student_id,
                'gender': student.gender,
                'score': student.score
            }
            for student in students
        ]

    if include_constraints:
        data['constraints'] = [
            {
                'constraint_type': c.constraint_type,
                'student_pk': c.student.pk,
                'student_id': c.student.student_id,
                'student_name': c.student.name,
                'target_student_pk': c.target_student.pk if c.target_student else None,
                'target_student_id': c.target_student.student_id if c.target_student else None,
                'target_student_name': c.target_student.name if c.target_student else None,
                'row': c.row,
                'col': c.col,
                'distance': c.distance,
                'enabled': c.enabled,
                'note': c.note
            }
            for c in constraints
        ]

    return data


def _find_student(classroom, payload):
    if payload.get('student_pk'):
        student = classroom.students.filter(pk=payload['student_pk']).first()
        if student:
            return student
    student_id = payload.get('student_id')
    name = payload.get('student_name') or payload.get('name')
    if student_id:
        student = classroom.students.filter(student_id=student_id).first()
        if student:
            return student
    if name:
        return classroom.students.filter(name=name).first()
    return None


def _apply_layout_data(classroom, data, replace_students=False):
    with transaction.atomic():
        classroom_data = data.get('classroom', {})
        rows = int(classroom_data.get('rows', classroom.rows))
        cols = int(classroom_data.get('cols', classroom.cols))
        _sync_seats(classroom, rows, cols)

        if replace_students:
            SeatConstraint.objects.filter(classroom=classroom).delete()
            SeatGroup.objects.filter(classroom=classroom).delete()
            Student.objects.filter(classroom=classroom).delete()

        group_map = {}
        for group_data in data.get('groups', []):
            name = str(group_data.get('name', '')).strip()
            if not name:
                continue
            group, _ = SeatGroup.objects.get_or_create(
                classroom=classroom,
                name=name,
                defaults={'order': int(group_data.get('order', 0))}
            )
            group.order = int(group_data.get('order', group.order))
            group.save(update_fields=['order'])
            group_map[name] = group

        if data.get('students') is not None:
            for student_data in data.get('students', []):
                name = str(student_data.get('name', '')).strip()
                if not name:
                    continue
                student_id = str(student_data.get('student_id') or '').strip()
                student = None
                if not replace_students:
                    if student_id:
                        student = classroom.students.filter(student_id=student_id).first()
                    if not student:
                        student = classroom.students.filter(name=name).first()
                if not student:
                    student = Student(classroom=classroom)
                student.name = name
                student.student_id = student_id
                student.gender = student_data.get('gender') or None
                student.score = float(student_data.get('score') or 0)
                student.save()

        seats = list(classroom.seats.select_related('student', 'group'))
        seat_map = _build_seat_map(seats)
        for seat in seats:
            seat.student = None
            seat.group = None
            seat.cell_type = seat.cell_type or SeatCellType.SEAT
            seat.save(update_fields=['student', 'group', 'cell_type'])

        for seat_data in data.get('seats', []):
            row = int(seat_data.get('row', 0))
            col = int(seat_data.get('col', 0))
            seat = seat_map.get((row, col))
            if not seat:
                continue
            cell_type = seat_data.get('cell_type') or SeatCellType.SEAT
            seat.cell_type = cell_type
            group_name = seat_data.get('group_name')
            if cell_type == SeatCellType.SEAT and group_name:
                seat.group = group_map.get(group_name)
            else:
                seat.group = None
            seat.student = None
            student_payload = {
                'student_pk': seat_data.get('student_pk'),
                'student_id': seat_data.get('student_id'),
                'student_name': seat_data.get('student_name')
            }
            student = _find_student(classroom, student_payload)
            if student and cell_type == SeatCellType.SEAT:
                seat.student = student
            seat.save()

        if data.get('constraints') is not None:
            SeatConstraint.objects.filter(classroom=classroom).delete()
            for cdata in data.get('constraints', []):
                student = _find_student(classroom, cdata)
                if not student:
                    continue
                target_payload = {
                    'student_pk': cdata.get('target_student_pk'),
                    'student_id': cdata.get('target_student_id'),
                    'student_name': cdata.get('target_student_name')
                }
                target_student = _find_student(classroom, target_payload)
                SeatConstraint.objects.create(
                    classroom=classroom,
                    constraint_type=cdata.get('constraint_type'),
                    student=student,
                    target_student=target_student,
                    row=cdata.get('row') or None,
                    col=cdata.get('col') or None,
                    distance=int(cdata.get('distance') or 1),
                    enabled=bool(cdata.get('enabled', True)),
                    note=str(cdata.get('note') or '')
                )


def _get_history(request, classroom_id):
    history = request.session.get('history', {})
    key = str(classroom_id)
    if key not in history:
        history[key] = {'undo': [], 'redo': []}
    request.session['history'] = history
    return history[key]


def _push_action(request, classroom_id, action):
    history = _get_history(request, classroom_id)
    history['undo'].append(action)
    history['redo'] = []
    request.session.modified = True


def _reset_history(request, classroom_id):
    history = _get_history(request, classroom_id)
    history['undo'] = []
    history['redo'] = []
    request.session.modified = True


def _is_ajax_request(request):
    return request.headers.get('x-requested-with') == 'XMLHttpRequest'


def _normalize_group_leaders(classroom, group_ids=None):
    groups = classroom.groups.all()
    if group_ids is not None:
        groups = groups.filter(pk__in=list(group_ids))
    for group in groups:
        if not group.leader_id:
            continue
        still_in_group = group.seats.filter(cell_type=SeatCellType.SEAT, student_id=group.leader_id).exists()
        if not still_in_group:
            group.leader = None
            group.save(update_fields=['leader'])


def _invert_move_action(action):
    return {
        'type': 'move',
        'student_id': action.get('student_id'),
        'from_row': action.get('to_row'),
        'from_col': action.get('to_col'),
        'to_row': action.get('from_row'),
        'to_col': action.get('from_col'),
        'target_student_id': action.get('target_student_id')
    }


def _apply_move_action(classroom, action):
    student = classroom.students.filter(pk=action.get('student_id')).first()
    if not student:
        return False
    from_row = action.get('from_row')
    from_col = action.get('from_col')
    to_row = action.get('to_row')
    to_col = action.get('to_col')
    target_student_id = action.get('target_student_id')

    seat_to = None
    if to_row is not None and to_col is not None:
        seat_to = classroom.seats.filter(row=to_row, col=to_col).first()

    if seat_to and seat_to.cell_type != SeatCellType.SEAT:
        return False

    target_student = None
    if target_student_id:
        target_student = classroom.students.filter(pk=target_student_id).first()

    current_seat = getattr(student, 'assigned_seat', None)
    

    seat_from = None
    if from_row is not None and from_col is not None:
        seat_from = classroom.seats.filter(row=from_row, col=from_col).first()

    with transaction.atomic():
        # 先清空相关座位的学生，防止唯一性冲突
        if seat_from:
            seat_from.student = None
            seat_from.save(update_fields=['student'])
        
        if seat_to:
            seat_to.student = None
            seat_to.save(update_fields=['student'])

        # 重新赋值
        if seat_from and target_student:
             seat_from.student = target_student
             seat_from.save(update_fields=['student'])
        
        if seat_to and student:
            seat_to.student = student
            seat_to.save(update_fields=['student'])
    _normalize_group_leaders(classroom)
    return True


def _apply_move_batch_action(classroom, action, forward=True):
    items = action.get('items', [])
    if not isinstance(items, list):
        return False
    if forward:
        sequence = items
    else:
        sequence = [_invert_move_action(item) for item in reversed(items)]
    success = True
    for item in sequence:
        ok = _apply_move_action(classroom, item)
        if not ok:
            success = False
    return success


def _apply_cell_type_action(classroom, action, forward=True):
    row = action.get('row')
    col = action.get('col')
    seat = classroom.seats.filter(row=row, col=col).first()
    if not seat:
        return False
    target_type = action.get('after') if forward else action.get('before')
    prev_student_id = action.get('prev_student_id')
    prev_group_id = action.get('prev_group_id')

    seat.cell_type = target_type
    if target_type == SeatCellType.SEAT:
        if prev_group_id:
            seat.group = classroom.groups.filter(pk=prev_group_id).first()
        if prev_student_id:
            seat.student = classroom.students.filter(pk=prev_student_id).first()
    else:
        seat.student = None
        seat.group = None
    seat.save(update_fields=['cell_type', 'student', 'group'])
    return True


def _apply_group_action(classroom, action, forward=True):
    row = action.get('row')
    col = action.get('col')
    seat = classroom.seats.filter(row=row, col=col).first()
    if not seat:
        return False
    target_group_id = action.get('after_group_id') if forward else action.get('before_group_id')
    if target_group_id:
        seat.group = classroom.groups.filter(pk=target_group_id).first()
    else:
        seat.group = None
    seat.save(update_fields=['group'])
    affected_group_ids = {gid for gid in [action.get('before_group_id'), action.get('after_group_id')] if gid}
    if affected_group_ids:
        _normalize_group_leaders(classroom, affected_group_ids)
    return True


def _apply_group_batch_action(classroom, action, forward=True):
    items = action.get('items', [])
    affected_group_ids = set()
    for item in items:
        row = item.get('row')
        col = item.get('col')
        seat = classroom.seats.filter(row=row, col=col).first()
        if not seat:
            continue
        target_group_id = item.get('after_group_id') if forward else item.get('before_group_id')
        if target_group_id:
            seat.group = classroom.groups.filter(pk=target_group_id).first()
            affected_group_ids.add(target_group_id)
        else:
            seat.group = None
        if item.get('before_group_id'):
            affected_group_ids.add(item.get('before_group_id'))
        if item.get('after_group_id'):
            affected_group_ids.add(item.get('after_group_id'))
        seat.save(update_fields=['group'])
    if affected_group_ids:
        _normalize_group_leaders(classroom, affected_group_ids)
    return True


def _apply_seat_layout_action(classroom, action, forward=True):
    items = action.get('items', [])
    if not isinstance(items, list):
        return False

    seat_map = {}
    student_ids = set()
    group_ids = set()
    affected_group_ids = set()

    for item in items:
        try:
            row = int(item.get('row'))
            col = int(item.get('col'))
        except Exception:
            continue
        seat = classroom.seats.filter(row=row, col=col, cell_type=SeatCellType.SEAT).first()
        if not seat:
            continue
        key = (row, col)
        seat_map[key] = {
            'seat': seat,
            'item': item,
        }

        before_student_id = item.get('before_student_id')
        after_student_id = item.get('after_student_id')
        if before_student_id:
            student_ids.add(before_student_id)
        if after_student_id:
            student_ids.add(after_student_id)

        before_group_id = item.get('before_group_id')
        after_group_id = item.get('after_group_id')
        if before_group_id:
            group_ids.add(before_group_id)
            affected_group_ids.add(before_group_id)
        if after_group_id:
            group_ids.add(after_group_id)
            affected_group_ids.add(after_group_id)

    if not seat_map:
        return False

    student_map = {s.pk: s for s in classroom.students.filter(pk__in=list(student_ids))}
    group_map = {g.pk: g for g in classroom.groups.filter(pk__in=list(group_ids))}

    with transaction.atomic():
        # 先清空，避免 Student.assigned_seat 的唯一性冲突
        for payload in seat_map.values():
            seat = payload['seat']
            seat.student = None
            seat.group = None
            seat.save(update_fields=['student', 'group'])

        for payload in seat_map.values():
            seat = payload['seat']
            item = payload['item']
            student_id = item.get('after_student_id') if forward else item.get('before_student_id')
            group_id = item.get('after_group_id') if forward else item.get('before_group_id')
            seat.student = student_map.get(student_id) if student_id else None
            seat.group = group_map.get(group_id) if group_id else None
            seat.save(update_fields=['student', 'group'])

    if affected_group_ids:
        _normalize_group_leaders(classroom, affected_group_ids)
    return True


def _constraint_issues(classroom):
    issues = []
    seats = list(classroom.seats.select_related('student'))
    student_seat = {seat.student_id: seat for seat in seats if seat.student_id}

    for constraint in classroom.constraints.filter(enabled=True):
        student = constraint.student
        seat = student_seat.get(student.pk)
        ctype = constraint.constraint_type
        if ctype == SeatConstraint.ConstraintType.MUST_SEAT:
            if not seat or seat.row != constraint.row or seat.col != constraint.col:
                issues.append(f"{student.name} 未坐在指定座位")
        elif ctype == SeatConstraint.ConstraintType.FORBID_SEAT:
            if seat and seat.row == constraint.row and seat.col == constraint.col:
                issues.append(f"{student.name} 坐到了禁用座位")
        elif ctype == SeatConstraint.ConstraintType.MUST_ROW:
            if not seat or seat.row != constraint.row:
                issues.append(f"{student.name} 未坐在指定行")
        elif ctype == SeatConstraint.ConstraintType.FORBID_ROW:
            if seat and seat.row == constraint.row:
                issues.append(f"{student.name} 坐到了禁用行")
        elif ctype == SeatConstraint.ConstraintType.MUST_COL:
            if not seat or seat.col != constraint.col:
                issues.append(f"{student.name} 未坐在指定列")
        elif ctype == SeatConstraint.ConstraintType.FORBID_COL:
            if seat and seat.col == constraint.col:
                issues.append(f"{student.name} 坐到了禁用列")
        elif ctype in [SeatConstraint.ConstraintType.MUST_TOGETHER, SeatConstraint.ConstraintType.FORBID_TOGETHER]:
            target = constraint.target_student
            if not target:
                continue
            seat_a = student_seat.get(student.pk)
            seat_b = student_seat.get(target.pk)
            if not seat_a or not seat_b:
                issues.append(f"{student.name} 与 {target.name} 未同时入座")
                continue
            distance = abs(seat_a.row - seat_b.row) + abs(seat_a.col - seat_b.col)
            if ctype == SeatConstraint.ConstraintType.MUST_TOGETHER and distance > constraint.distance:
                issues.append(f"{student.name} 与 {target.name} 未满足相邻要求")
            if ctype == SeatConstraint.ConstraintType.FORBID_TOGETHER and distance <= constraint.distance:
                issues.append(f"{student.name} 与 {target.name} 距离过近")

    return issues


def _format_issues_preview(issues, limit=3):
    preview = '；'.join(issues[:limit])
    if len(issues) > limit:
        preview += '；...'
    return preview


def _layout_hard_issues(classroom):
    issues = []
    unseated_count = classroom.students.filter(assigned_seat__isnull=True).count()
    if unseated_count:
        issues.append(f"当前有 {unseated_count} 名学生未入座")
    issues.extend(_constraint_issues(classroom))
    return issues


def _distance(seat_a, seat_b):
    if not seat_a or not seat_b:
        return 10 ** 9
    return abs(seat_a.row - seat_b.row) + abs(seat_a.col - seat_b.col)


def _current_assignments(classroom):
    return {seat.student_id: seat for seat in classroom.seats.select_related('student').filter(student__isnull=False)}


def _candidate_seats(classroom, predicate=None):
    seats = list(classroom.seats.filter(cell_type=SeatCellType.SEAT).order_by('row', 'col'))
    if predicate is None:
        return seats
    return [s for s in seats if predicate(s)]


def _simulate_move_valid(student, target_seat, assignments, maps):
    sid = student.pk
    current = assignments.get(sid)
    occupant = target_seat.student

    if occupant and occupant.pk == sid:
        return True
    if occupant and not current:
        return False

    simulated = dict(assignments)
    simulated[sid] = target_seat
    if occupant and current:
        simulated[occupant.pk] = current

    others_for_student = {k: v for k, v in simulated.items() if k != sid}
    if not _seat_is_valid(student, target_seat, others_for_student, maps):
        return False

    if occupant and current:
        others_for_occupant = {k: v for k, v in simulated.items() if k != occupant.pk}
        if not _seat_is_valid(occupant, current, others_for_occupant, maps):
            return False

    return True


def _pick_best_target(student, candidates, assignments, maps):
    sid = student.pk
    current = assignments.get(sid)
    best = None
    best_score = None
    for seat in candidates:
        if not _simulate_move_valid(student, seat, assignments, maps):
            continue
        occupied_penalty = 3 if seat.student_id else 0
        score = _distance(current, seat) + occupied_penalty
        if best is None or score < best_score:
            best = seat
            best_score = score
    return best


def _enforce_constraints_by_moves(classroom, max_rounds=6):
    constraints = list(
        classroom.constraints.filter(enabled=True).select_related('student', 'target_student').order_by('created_at', 'pk')
    )
    if not constraints:
        return True

    students = list(classroom.students.all())
    maps = _build_constraint_maps(classroom, students)

    for _ in range(max_rounds):
        if not _constraint_issues(classroom):
            return True
        changed = False

        for c in constraints:
            assignments = _current_assignments(classroom)
            student = c.student
            target_student = c.target_student
            seat = assignments.get(student.pk)
            ctype = c.constraint_type

            if ctype == SeatConstraint.ConstraintType.MUST_SEAT and c.row and c.col:
                target = classroom.seats.filter(row=c.row, col=c.col, cell_type=SeatCellType.SEAT).first()
                if target and (not seat or seat.pk != target.pk):
                    if _simulate_move_valid(student, target, assignments, maps):
                        _perform_move(classroom, student, target)
                        changed = True
                continue

            if ctype == SeatConstraint.ConstraintType.FORBID_SEAT and c.row and c.col:
                if seat and seat.row == c.row and seat.col == c.col:
                    candidates = _candidate_seats(classroom, predicate=lambda s: not (s.row == c.row and s.col == c.col))
                    target = _pick_best_target(student, candidates, assignments, maps)
                    if target:
                        _perform_move(classroom, student, target)
                        changed = True
                continue

            if ctype == SeatConstraint.ConstraintType.MUST_ROW and c.row:
                if not seat or seat.row != c.row:
                    candidates = _candidate_seats(classroom, predicate=lambda s: s.row == c.row)
                    target = _pick_best_target(student, candidates, assignments, maps)
                    if target:
                        _perform_move(classroom, student, target)
                        changed = True
                continue

            if ctype == SeatConstraint.ConstraintType.FORBID_ROW and c.row:
                if seat and seat.row == c.row:
                    candidates = _candidate_seats(classroom, predicate=lambda s: s.row != c.row)
                    target = _pick_best_target(student, candidates, assignments, maps)
                    if target:
                        _perform_move(classroom, student, target)
                        changed = True
                continue

            if ctype == SeatConstraint.ConstraintType.MUST_COL and c.col:
                if not seat or seat.col != c.col:
                    candidates = _candidate_seats(classroom, predicate=lambda s: s.col == c.col)
                    target = _pick_best_target(student, candidates, assignments, maps)
                    if target:
                        _perform_move(classroom, student, target)
                        changed = True
                continue

            if ctype == SeatConstraint.ConstraintType.FORBID_COL and c.col:
                if seat and seat.col == c.col:
                    candidates = _candidate_seats(classroom, predicate=lambda s: s.col != c.col)
                    target = _pick_best_target(student, candidates, assignments, maps)
                    if target:
                        _perform_move(classroom, student, target)
                        changed = True
                continue

            if ctype in [SeatConstraint.ConstraintType.MUST_TOGETHER, SeatConstraint.ConstraintType.FORBID_TOGETHER] and target_student:
                assignments = _current_assignments(classroom)
                seat_a = assignments.get(student.pk)
                seat_b = assignments.get(target_student.pk)
                dist = c.distance or 1
                cur_distance = _distance(seat_a, seat_b)

                if ctype == SeatConstraint.ConstraintType.MUST_TOGETHER:
                    if cur_distance <= dist:
                        continue
                    if seat_b:
                        candidates = _candidate_seats(classroom, predicate=lambda s: _distance(s, seat_b) <= dist)
                        target = _pick_best_target(student, candidates, assignments, maps)
                        if target:
                            _perform_move(classroom, student, target)
                            changed = True
                            continue
                    assignments = _current_assignments(classroom)
                    seat_a = assignments.get(student.pk)
                    if seat_a:
                        candidates = _candidate_seats(classroom, predicate=lambda s: _distance(s, seat_a) <= dist)
                        target = _pick_best_target(target_student, candidates, assignments, maps)
                        if target:
                            _perform_move(classroom, target_student, target)
                            changed = True
                else:
                    if cur_distance > dist:
                        continue
                    if seat_b:
                        candidates = _candidate_seats(classroom, predicate=lambda s: _distance(s, seat_b) > dist)
                        target = _pick_best_target(student, candidates, assignments, maps)
                        if target:
                            _perform_move(classroom, student, target)
                            changed = True
                            continue
                    assignments = _current_assignments(classroom)
                    seat_a = assignments.get(student.pk)
                    if seat_a:
                        candidates = _candidate_seats(classroom, predicate=lambda s: _distance(s, seat_a) > dist)
                        target = _pick_best_target(target_student, candidates, assignments, maps)
                        if target:
                            _perform_move(classroom, target_student, target)
                            changed = True

        if not changed:
            break

    return not _constraint_issues(classroom)


def _stabilize_layout_with_rules(classroom, request=None, trigger_student_id=None):
    _apply_internal_policy(classroom, request, trigger_student_id=trigger_student_id)
    _enforce_constraints_by_moves(classroom)
    _apply_internal_policy(classroom, request, trigger_student_id=trigger_student_id)
    _normalize_group_leaders(classroom)
    return _constraint_issues(classroom)


def _filter_internal_issues(issues):
    return issues


def _is_internal_policy_student(student):
    return False


def _evaluate_layout(classroom, request=None):
    issues = []
    seats = list(classroom.seats.select_related('student', 'group'))

    unseated_count = classroom.students.filter(assigned_seat__isnull=True).count()
    if unseated_count:
        issues.append(f"当前有 {unseated_count} 名学生未入座")

    issues.extend(_constraint_issues(classroom))
    _apply_internal_policy(classroom, request)

    # 小组平衡
    groups = list(classroom.groups.all())

    # 导出建议
    ignore_export = request.session.get(f'ignore_export_{classroom.pk}', False) if request else False
    # 检查所有入座学生是否都已分配小组
    ungrouped_count = sum(1 for s in seats if s.student_id and not s.group_id)
    if unseated_count == 0 and ungrouped_count == 0 and len(groups) > 0 and not ignore_export:
        issues.append({
            'type': 'export_suggestion',
            'message': '所有学生已入座并分组，建议导出小组作业登记表。',
            'action_label': '立即导出',
            'action_url': reverse('export_group_report', args=[classroom.pk]),
            'ignore_label': '不再提示',
            'ignore_url': f'/classroom/{classroom.pk}/suggestion/dismiss/?type=export'
        })

    if groups:
        group_data = []
        for g in groups:
             seats = g.seats.filter(cell_type=SeatCellType.SEAT).select_related('student')
             students = [s.student for s in seats if s.student]
             if not students: continue
             current_sum = sum(s.score or 0 for s in students)
             count = len(students)
             avg = current_sum / count
             group_data.append({
                 'group': g, 
                 'students': students, 
                 'sum': current_sum, 
                 'count': count, 
                 'avg': avg
             })
        
        if len(group_data) > 1:
            group_data.sort(key=lambda x: x['avg'])
            min_g = group_data[0]
            max_g = group_data[-1]
            diff = max_g['avg'] - min_g['avg']
            
            if diff > 5: # 阈值
                 best_swap = None
                 current_improvement = 0
                 
                 for s_high in max_g['students']:
                     for s_low in min_g['students']:
                         if _is_internal_policy_student(s_high) or _is_internal_policy_student(s_low):
                             continue
                         score_diff = (s_high.score or 0) - (s_low.score or 0)
                         # 尝试交换以减少分差
                         if score_diff > 0:
                             new_max_sum = max_g['sum'] - score_diff
                             new_min_sum = min_g['sum'] + score_diff
                             
                             new_max_avg = new_max_sum / max_g['count']
                             new_min_avg = new_min_sum / min_g['count']
                             
                             # 新的分差
                             new_diff = abs(new_max_avg - new_min_avg)
                             improvement = diff - new_diff
                             
                             if improvement > 1 and improvement > current_improvement:
                                 current_improvement = improvement
                                 best_swap = (s_high, s_low)
                 
                 if best_swap:
                     s1, s2 = best_swap
                     issues.append({
                        'type': 'group_balance',
                        'message': f'建议交换 {s1.name} 和 {s2.name} 以平衡小组均分 (分差 {diff:.1f} → {(diff - current_improvement):.1f})',
                        'action_label': '交换优化',
                        'action_url': reverse('apply_suggestion', args=[classroom.pk]) + f'?type=swap_balance&s1={s1.pk}&s2={s2.pk}',
                        'ignore_label': '忽略此条',
                        'ignore_url': '#'
                     })

    return _filter_internal_issues(issues)


def classroom_detail(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    suggestions = _evaluate_layout(classroom, request)
    seats = list(classroom.seats.select_related('student', 'group').all())
    seat_map = _build_seat_map(seats)

    seat_grid = []
    for r in range(1, classroom.rows + 1):
        row_seats = []
        for c in range(1, classroom.cols + 1):
            row_seats.append(seat_map.get((r, c)))
        seat_grid.append(row_seats)

    unseated_students = classroom.students.filter(assigned_seat__isnull=True).order_by('name')
    groups = classroom.groups.all()
    snapshots = classroom.layout_snapshots.all()
    constraints = classroom.constraints.select_related('student', 'target_student').all()
    
    return render(request, 'seats/classroom_detail.html', {
        'classroom': classroom,
        'seat_grid': seat_grid,
        'students': classroom.students.all().order_by('name'),
        'unseated_students': unseated_students,
        'groups': groups,
        'snapshots': snapshots,
        'constraints': constraints,
        'suggestions': suggestions
    })


def classroom_state(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    suggestions = _evaluate_layout(classroom, request)
    seats = list(classroom.seats.select_related('student', 'group').all())
    unseated_students = classroom.students.filter(assigned_seat__isnull=True).order_by('name')

    seat_payload = []
    for seat in seats:
        student = seat.student
        group = seat.group
        score_value = student.display_score if student and (student.score or 0) > 0 else None
        seat_payload.append({
            'row': seat.row,
            'col': seat.col,
            'cell_type': seat.cell_type,
            'cell_type_display': seat.get_cell_type_display(),
            'student': {
                'id': student.pk,
                'name': student.name,
                'score_display': score_value,
                'is_leader': (group and getattr(group, 'leader_id', None) == student.pk)
            } if student else None,
            'group': {
                'id': group.pk,
                'name': group.name
            } if group else None
        })

    unseated_payload = []
    for student in unseated_students:
        score_value = student.display_score if (student.score or 0) > 0 else None
        unseated_payload.append({
            'id': student.pk,
            'name': student.name,
            'score_display': score_value,
            'delete_url': reverse('delete_student', args=[classroom.pk, student.pk])
        })

    return JsonResponse({
        'seats': seat_payload,
        'unseated': unseated_payload,
        'suggestions': suggestions,
        'unseated_count': len(unseated_payload)
    })


def layout_editor(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    seats = list(classroom.seats.all())
    seat_map = _build_seat_map(seats)
    seat_grid = []
    for r in range(1, classroom.rows + 1):
        row_seats = []
        for c in range(1, classroom.cols + 1):
            row_seats.append(seat_map.get((r, c)))
        seat_grid.append(row_seats)
    return render(request, 'seats/layout_editor.html', {
        'classroom': classroom,
        'seat_grid': seat_grid
    })


@require_POST
def update_layout_grid(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    rows = int(request.POST.get('rows', classroom.rows))
    cols = int(request.POST.get('cols', classroom.cols))
    rows = max(1, min(rows, 30))
    cols = max(1, min(cols, 30))
    _sync_seats(classroom, rows, cols)
    return redirect('layout_editor', pk=pk)


def _ensure_temp_import_dir():
    temp_dir = os.path.join(settings.BASE_DIR, 'temp_imports')
    os.makedirs(temp_dir, exist_ok=True)
    return temp_dir


def _save_uploaded_temp_file(uploaded_file, suffix):
    file_id = str(uuid.uuid4())
    temp_path = os.path.join(_ensure_temp_import_dir(), f'{file_id}{suffix}')
    with open(temp_path, 'wb+') as destination:
        for chunk in uploaded_file.chunks():
            destination.write(chunk)
    return file_id, temp_path


def _parse_bool(value):
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _normalize_cell_text(value):
    if value is None:
        return ''
    text = str(value).strip()
    if not text:
        return ''
    return re.sub(r'\s+', '', text)


def _parse_manual_terms(raw):
    if not raw:
        return set()
    parts = re.split(r'[\n,，;；\s]+', str(raw))
    return {p.strip() for p in parts if p.strip()}


def _is_name_like_text(text):
    if not text:
        return False
    if not (2 <= len(text) <= 5):
        return False
    if any(ch.isdigit() for ch in text):
        return False
    return bool(re.fullmatch(r'[^\d\s]{2,5}', text))


def _build_merged_value_map(ws, min_row, max_row, min_col, max_col):
    merged_map = {}
    for merged_range in ws.merged_cells.ranges:
        c1, r1, c2, r2 = merged_range.bounds
        if r2 < min_row or r1 > max_row or c2 < min_col or c1 > max_col:
            continue
        master_val = ws.cell(row=r1, column=c1).value
        rr1 = max(r1, min_row)
        rr2 = min(r2, max_row)
        cc1 = max(c1, min_col)
        cc2 = min(c2, max_col)
        for r in range(rr1, rr2 + 1):
            for c in range(cc1, cc2 + 1):
                merged_map[(r, c)] = master_val
    return merged_map


def _detect_layout_bounds(ws):
    min_row = None
    max_row = None
    min_col = None
    max_col = None
    for row in ws.iter_rows(min_row=1, max_row=ws.max_row, min_col=1, max_col=ws.max_column):
        for cell in row:
            if _normalize_cell_text(cell.value):
                r, c = cell.row, cell.column
                min_row = r if min_row is None else min(min_row, r)
                max_row = r if max_row is None else max(max_row, r)
                min_col = c if min_col is None else min(min_col, c)
                max_col = c if max_col is None else max(max_col, c)
    if min_row is None:
        return {
            'min_row': 1,
            'max_row': 1,
            'min_col': 1,
            'max_col': 1
        }
    return {
        'min_row': min_row,
        'max_row': max_row,
        'min_col': min_col,
        'max_col': max_col
    }


def _calc_col_bounds_for_rows(ws, start_row, end_row, base_min_col, base_max_col):
    min_col = None
    max_col = None
    merged_map = _build_merged_value_map(ws, start_row, end_row, base_min_col, base_max_col)
    for r in range(start_row, end_row + 1):
        for c in range(base_min_col, base_max_col + 1):
            val = merged_map.get((r, c), ws.cell(row=r, column=c).value)
            if _normalize_cell_text(val):
                min_col = c if min_col is None else min(min_col, c)
                max_col = c if max_col is None else max(max_col, c)
    if min_col is None:
        return base_min_col, base_max_col
    return min_col, max_col


def _transform_layout_rows(rows, layout_transform):
    transform = str(layout_transform or 'none').strip().lower()
    if transform == 'flip_ud':
        return list(reversed(rows))
    if transform == 'flip_lr':
        return [list(reversed(row)) for row in rows]
    if transform in {'rotate_180', 'rot180', '180'}:
        return [list(reversed(row)) for row in reversed(rows)]
    return rows


def _detect_layout_import_defaults(temp_path, options):
    wb = openpyxl.load_workbook(temp_path, data_only=True)
    ws = wb.active
    bounds = _detect_layout_bounds(ws)
    min_row = bounds['min_row']
    max_row = bounds['max_row']
    min_col = bounds['min_col']
    max_col = bounds['max_col']
    merged_map = _build_merged_value_map(ws, min_row, max_row, min_col, max_col)

    row_podium_count = defaultdict(int)
    row_name_count = defaultdict(int)

    for r in range(min_row, max_row + 1):
        for c in range(min_col, max_col + 1):
            raw_val = merged_map.get((r, c), ws.cell(row=r, column=c).value)
            text = _normalize_cell_text(raw_val)
            cell_type, student_name, _ = _classify_layout_cell(text, options)
            if cell_type == SeatCellType.PODIUM:
                row_podium_count[r] += 1
            if student_name:
                row_name_count[r] += 1

    wb.close()

    start_row = min_row
    end_row = max_row
    layout_transform = 'none'

    podium_row = None
    if row_podium_count:
        podium_row = max(
            row_podium_count.keys(),
            key=lambda row: (row_podium_count[row], -row)
        )

    if podium_row and row_name_count.get(podium_row, 0) == 0:
        above_names = sum(row_name_count[r] for r in range(min_row, podium_row))
        below_names = sum(row_name_count[r] for r in range(podium_row + 1, max_row + 1))

        if below_names > above_names and below_names > 0:
            start_row = min(max_row, podium_row + 1)
        elif above_names > 0:
            end_row = max(min_row, podium_row - 1)

        if podium_row != min_row:
            layout_transform = 'rotate_180'

    if start_row > end_row:
        start_row = min_row
        end_row = max_row

    return {
        'start_row': start_row,
        'end_row': end_row,
        'layout_transform': layout_transform,
        'podium_row': podium_row
    }


LAYOUT_PODIUM_KEYWORDS = {'讲台', '教师', '老师', '黑板', '主席台'}
LAYOUT_AISLE_KEYWORDS = {'走廊', '过道', '通道'}
LAYOUT_EMPTY_KEYWORDS = {'空位', '留空', '空座', '无人'}


def _classify_layout_cell(text, options):
    manual_name_terms = options.get('manual_name_terms', set())
    manual_podium_terms = options.get('manual_podium_terms', set())
    manual_empty_terms = options.get('manual_empty_terms', set())
    manual_aisle_terms = options.get('manual_aisle_terms', set())
    auto_detect_names = options.get('auto_detect_names', True)

    if not text:
        return SeatCellType.AISLE, None, '空白识别为走廊'

    if text in manual_name_terms:
        return SeatCellType.SEAT, text, '手动姓名'
    if text in manual_podium_terms or any(k in text for k in LAYOUT_PODIUM_KEYWORDS):
        return SeatCellType.PODIUM, None, '讲台关键词'
    if text in manual_empty_terms or any(k in text for k in LAYOUT_EMPTY_KEYWORDS):
        return SeatCellType.EMPTY, None, '空位关键词'
    if text in manual_aisle_terms or any(k in text for k in LAYOUT_AISLE_KEYWORDS):
        return SeatCellType.AISLE, None, '走廊关键词'

    if auto_detect_names and _is_name_like_text(text):
        return SeatCellType.SEAT, text, '自动姓名'

    return SeatCellType.SEAT, None, '默认座位'


def _build_layout_grid_from_excel(temp_path, start_row, end_row, options):
    wb = openpyxl.load_workbook(temp_path, data_only=True)
    ws = wb.active
    bounds = _detect_layout_bounds(ws)

    start_row = max(bounds['min_row'], int(start_row or bounds['min_row']))
    end_row = min(bounds['max_row'], int(end_row or bounds['max_row']))
    if end_row < start_row:
        end_row = start_row

    min_col, max_col = _calc_col_bounds_for_rows(
        ws,
        start_row,
        end_row,
        bounds['min_col'],
        bounds['max_col']
    )
    merged_map = _build_merged_value_map(ws, start_row, end_row, min_col, max_col)

    rows = []
    stats = {
        'seat': 0,
        'aisle': 0,
        'podium': 0,
        'empty': 0,
        'named': 0
    }

    for r in range(start_row, end_row + 1):
        row_items = []
        for c in range(min_col, max_col + 1):
            raw_val = merged_map.get((r, c), ws.cell(row=r, column=c).value)
            text = _normalize_cell_text(raw_val)
            cell_type, student_name, reason = _classify_layout_cell(text, options)
            row_items.append({
                'sheet_row': r,
                'sheet_col': c,
                'raw_text': text,
                'cell_type': cell_type,
                'student_name': student_name,
                'reason': reason
            })
            stats[cell_type] += 1
            if student_name:
                stats['named'] += 1
        rows.append(row_items)

    rows = _transform_layout_rows(rows, options.get('layout_transform', 'none'))

    wb.close()
    return {
        'start_row': start_row,
        'end_row': end_row,
        'min_col': min_col,
        'max_col': max_col,
        'rows': rows,
        'bounds': bounds,
        'stats': stats
    }


def _preview_rows_payload(grid_rows):
    total = len(grid_rows)
    if total == 0:
        return [], []
    front = [(idx, grid_rows[idx]) for idx in range(min(2, total))]
    back_start = max(0, total - 2)
    back = [(idx, grid_rows[idx]) for idx in range(back_start, total)]
    if total <= 2:
        back = []

    def render_row(idx, row):
        return {
            'row_index': idx + 1,
            'cells': [
                {
                    'cell_type': item['cell_type'],
                    'label': item['student_name'] or (
                        '讲台' if item['cell_type'] == SeatCellType.PODIUM else
                        '空位' if item['cell_type'] == SeatCellType.EMPTY else
                        '走廊' if item['cell_type'] == SeatCellType.AISLE else
                        '座位'
                    )
                }
                for item in row
            ]
        }

    return [render_row(i, row) for i, row in front], [render_row(i, row) for i, row in back]


def _build_layout_preview_response(temp_path, start_row, end_row, options):
    grid_data = _build_layout_grid_from_excel(temp_path, start_row, end_row, options)
    front_rows, back_rows = _preview_rows_payload(grid_data['rows'])
    return {
        'layout_transform': options.get('layout_transform', 'none'),
        'start_row': grid_data['start_row'],
        'end_row': grid_data['end_row'],
        'bounds': grid_data['bounds'],
        'grid_rows': len(grid_data['rows']),
        'grid_cols': (grid_data['max_col'] - grid_data['min_col'] + 1),
        'front_preview': front_rows,
        'back_preview': back_rows,
        'stats': grid_data['stats']
    }


def _apply_layout_excel_import(classroom, temp_path, start_row, end_row, options):
    grid_data = _build_layout_grid_from_excel(temp_path, start_row, end_row, options)
    rows = grid_data['rows']
    row_count = len(rows)
    col_count = len(rows[0]) if rows else 0
    if row_count == 0 or col_count == 0:
        return 0, 0

    replace_students = options.get('replace_students', False)

    with transaction.atomic():
        _sync_seats(classroom, row_count, col_count)

        if replace_students:
            SeatConstraint.objects.filter(classroom=classroom).delete()
            Student.objects.filter(classroom=classroom).delete()

        seats = list(classroom.seats.select_related('student').all())
        seat_map = _build_seat_map(seats)

        # Clear seat occupancy first to avoid one-to-one conflicts when students move to new seats.
        for seat in seats:
            seat.student = None
            seat.group = None
            seat.save(update_fields=['student', 'group'])

        existing_by_name = defaultdict(list)
        if not replace_students:
            for student in classroom.students.all().order_by('pk'):
                existing_by_name[student.name].append(student)
        consumed_student_ids = set()

        imported_student_count = 0

        for local_r, row in enumerate(rows, start=1):
            for local_c, item in enumerate(row, start=1):
                seat = seat_map.get((local_r, local_c))
                if not seat:
                    continue
                target_student = None
                student_name = item.get('student_name')
                if item['cell_type'] == SeatCellType.SEAT and student_name:
                    candidates = existing_by_name.get(student_name, [])
                    for cand in candidates:
                        if cand.pk not in consumed_student_ids:
                            target_student = cand
                            break
                    if not target_student:
                        target_student = Student.objects.create(
                            classroom=classroom,
                            name=student_name,
                            student_id='',
                            score=0
                        )
                        existing_by_name[student_name].append(target_student)
                        imported_student_count += 1
                    consumed_student_ids.add(target_student.pk)

                seat.student = target_student
                seat.group = None
                seat.cell_type = item['cell_type']
                seat.save(update_fields=['student', 'group', 'cell_type'])

    return row_count * col_count, imported_student_count


def import_layout_excel(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    if request.method != 'POST':
        return redirect('classroom_detail', pk=pk)

    action = request.POST.get('action', 'upload')
    auto_detect_names = _parse_bool(request.POST.get('auto_detect_names', '1'))
    options = {
        'manual_name_terms': _parse_manual_terms(request.POST.get('manual_name_terms')),
        'manual_podium_terms': _parse_manual_terms(request.POST.get('manual_podium_terms')),
        'manual_empty_terms': _parse_manual_terms(request.POST.get('manual_empty_terms')),
        'manual_aisle_terms': _parse_manual_terms(request.POST.get('manual_aisle_terms')),
        'auto_detect_names': auto_detect_names,
        'layout_transform': request.POST.get('layout_transform', 'none'),
    }

    if action == 'upload':
        excel_file = request.FILES.get('layout_excel_file')
        if not excel_file:
            return JsonResponse({'status': 'error', 'message': '请先选择 Excel 座位表文件'}, status=400)
        suffix = os.path.splitext(excel_file.name)[1].lower() or '.xlsx'
        file_id, temp_path = _save_uploaded_temp_file(excel_file, suffix)
        try:
            defaults = _detect_layout_import_defaults(temp_path, options)
            preview_options = dict(options)
            preview_options['layout_transform'] = defaults['layout_transform']
            preview = _build_layout_preview_response(
                temp_path,
                defaults['start_row'],
                defaults['end_row'],
                preview_options
            )
            return JsonResponse({
                'status': 'ready',
                'file_id': file_id,
                'message': '文件解析完成，请确认范围后导入',
                'auto_selected': {
                    'podium_row': defaults['podium_row'],
                    'start_row': defaults['start_row'],
                    'end_row': defaults['end_row'],
                    'layout_transform': defaults['layout_transform'],
                },
                **preview
            })
        except Exception as e:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            return JsonResponse({'status': 'error', 'message': f'解析失败：{e}'}, status=400)

    file_id = request.POST.get('file_id', '').strip()
    if not file_id:
        return JsonResponse({'status': 'error', 'message': '缺少文件标识，请重新上传'}, status=400)
    temp_path = None
    for ext in ('.xlsx', '.xlsm', '.xls', ''):
        candidate = os.path.join(_ensure_temp_import_dir(), f'{file_id}{ext}')
        if os.path.exists(candidate):
            temp_path = candidate
            break
    if not temp_path:
        return JsonResponse({'status': 'error', 'message': '临时文件已过期，请重新上传'}, status=400)

    start_row = request.POST.get('start_row')
    end_row = request.POST.get('end_row')

    if action == 'preview':
        try:
            preview = _build_layout_preview_response(temp_path, start_row, end_row, options)
            return JsonResponse({
                'status': 'ready',
                'file_id': file_id,
                **preview
            })
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': f'预览失败：{e}'}, status=400)

    if action == 'confirm':
        options['replace_students'] = _parse_bool(request.POST.get('replace_students'))
        try:
            imported_cells, created_students = _apply_layout_excel_import(
                classroom,
                temp_path,
                start_row,
                end_row,
                options
            )
            _reset_history(request, pk)
            if os.path.exists(temp_path):
                os.remove(temp_path)
            return JsonResponse({
                'status': 'success',
                'message': f'导入完成：共处理 {imported_cells} 个网格，新建学生 {created_students} 人'
            })
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': f'导入失败：{e}'}, status=400)

    return JsonResponse({'status': 'error', 'message': '未知操作'}, status=400)


def import_layout_excel_options_page(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    return render(request, 'seats/import_layout_options.html', {
        'classroom': classroom
    })


def import_students(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    
    if request.method == 'POST':
        action = request.POST.get('action', 'upload')
        
        # 处理第一次上传
        if action == 'upload' and request.FILES.get('excel_file'):
            excel_file = request.FILES['excel_file']
            clear_existing = request.POST.get('clear_existing') == '1'
            import_mode = _resolve_student_import_mode(request.POST.get('import_mode'), clear_existing)
            
            try:
                # 先读取一次尝试自动识别
                df = pd.read_excel(excel_file)
                columns = list(df.columns)

                def find_column(keys):
                    for key in keys:
                        for col in columns:
                            if key in str(col):
                                return col
                    return None

                def find_exact_column(candidates):
                    normalized_candidates = {str(item).strip().lower() for item in candidates}
                    for col in columns:
                        normalized_col = str(col).strip().lower()
                        if normalized_col in normalized_candidates:
                            return col
                    return None

                name_col = find_column(['姓名', '名字', '学生姓名', '学生'])
                score_col = find_exact_column(['总分', '学生总分'])
                
                # 如果自动识别成功，直接导入
                if name_col and score_col:
                    student_id_col = find_column(['学号', '学生号', '编号', 'ID'])
                    gender_col = find_column(['性别', '男女性别'])

                    result = _process_import(
                        classroom,
                        df,
                        name_col,
                        student_id_col,
                        gender_col,
                        score_col,
                        import_mode
                    )
                    return JsonResponse({'status': 'success', 'message': _format_import_result_message(result)})
                
                # 自动识别失败，保存临时文件并返回预览数据
                import os
                import uuid
                from django.conf import settings
                
                file_id = str(uuid.uuid4())
                temp_dir = os.path.join(settings.BASE_DIR, 'temp_imports')
                os.makedirs(temp_dir, exist_ok=True)
                temp_path = os.path.join(temp_dir, f'{file_id}.xlsx')
                
                # 重新定位指针或直接保存上传的文件
                with open(temp_path, 'wb+') as destination:
                    for chunk in excel_file.chunks():
                        destination.write(chunk)
                
                # 读取前20行（无标题模式）返回给前端预览
                df_preview = pd.read_excel(temp_path, header=None)
                preview_data = df_preview.head(20).fillna('').values.tolist()
                
                return JsonResponse({
                    'status': 'ambiguous',
                    'file_id': file_id,
                    'preview_data': preview_data,
                    'message': '仅当列名精确为“总分”或“学生总分”时才会自动导入，请手动匹配列'
                })

            except Exception as e:
                return JsonResponse({'status': 'error', 'message': str(e)}, status=400)

        # 处理确认映射
        elif action == 'confirm':
            file_id = request.POST.get('file_id')
            start_row = int(request.POST.get('start_row', 0)) # 0-indexed
            name_col_idx = int(request.POST.get('name_col_index'))
            score_col_idx = request.POST.get('score_col_index')
            clear_existing = request.POST.get('clear_existing') == 'true'
            import_mode = _resolve_student_import_mode(request.POST.get('import_mode'), clear_existing)
            
            import os
            from django.conf import settings
            temp_path = os.path.join(settings.BASE_DIR, 'temp_imports', f'{file_id}.xlsx')
            
            if not os.path.exists(temp_path):
                return JsonResponse({'status': 'error', 'message': '临时文件已过期，请重新上传'}, status=400)
                
            try:
                # 读取原始文件（无header）
                df = pd.read_excel(temp_path, header=None)
                
                # 切片获取数据区域
                # start_row 是用户选择的标题行，数据从下一行开始
                df_data = df.iloc[start_row + 1:].copy()
                
                # 获取列名（用于_process_import，虽然我们这里用索引）
                # 为了复用逻辑，我们重构 DataFrame
                df_data.columns = [i for i in range(df_data.shape[1])]
                
                name_col = name_col_idx
                score_col = int(score_col_idx) if score_col_idx and score_col_idx != '' else None
                
                result = _process_import(
                    classroom,
                    df_data,
                    name_col,
                    None,
                    None,
                    score_col,
                    import_mode
                )
                
                # 清理文件
                os.remove(temp_path)
                
                return JsonResponse({'status': 'success', 'message': _format_import_result_message(result)})
            except Exception as e:
                return JsonResponse({'status': 'error', 'message': str(e)}, status=400)

    return redirect('classroom_detail', pk=pk)


def import_students_options_page(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    return render(request, 'seats/import_students_options.html', {
        'classroom': classroom
    })


IMPORT_MODE_REPLACE = 'replace'
IMPORT_MODE_MATCH = 'match'
VALID_IMPORT_MODES = {IMPORT_MODE_REPLACE, IMPORT_MODE_MATCH}


def _resolve_student_import_mode(raw_mode, clear_existing=False):
    mode = str(raw_mode or '').strip().lower()
    if mode in VALID_IMPORT_MODES:
        return mode
    return IMPORT_MODE_REPLACE if clear_existing else IMPORT_MODE_MATCH


def _normalize_import_text(value):
    if value is None or pd.isna(value):
        return ''
    return str(value).strip()


def _parse_import_gender(value):
    text = _normalize_import_text(value).lower()
    if text in {'男', 'm', 'male'}:
        return 'M'
    if text in {'女', 'f', 'female'}:
        return 'F'
    return None


def _parse_import_score(value):
    if value is None or pd.isna(value):
        return 0
    numeric_value = pd.to_numeric(value, errors='coerce')
    if pd.isna(numeric_value):
        return 0
    return float(numeric_value)


def _format_import_result_message(result):
    if result['mode'] == IMPORT_MODE_REPLACE:
        return f"成功导入 {result['created']} 名学生"

    parts = [f"匹配更新 {result['updated']} 人"]
    if result['created'] > 0:
        parts.append(f"新增 {result['created']} 人")
    if result['skipped'] > 0:
        parts.append(f"未匹配 {result['skipped']} 人")
    return "匹配导入完成：" + "，".join(parts)


def _process_import(classroom, df, name_col, student_id_col, gender_col, score_col, import_mode=IMPORT_MODE_MATCH):
    import_mode = _resolve_student_import_mode(import_mode)
    created_count = 0
    updated_count = 0
    skipped_count = 0
    has_score_column = score_col is not None

    with transaction.atomic():
        if import_mode == IMPORT_MODE_REPLACE:
            classroom.students.all().delete()

        existing_students = list(classroom.students.all())
        should_match_existing = import_mode == IMPORT_MODE_MATCH and len(existing_students) > 0

        existing_by_id = {}
        existing_names = defaultdict(list)
        if should_match_existing:
            for student in existing_students:
                sid = _normalize_import_text(student.student_id).lower()
                if sid and sid not in existing_by_id:
                    existing_by_id[sid] = student
                normalized_name = _normalize_import_text(student.name).lower()
                if normalized_name:
                    existing_names[normalized_name].append(student)

        unique_name_map = {
            name_key: students[0]
            for name_key, students in existing_names.items()
            if len(students) == 1
        }

        def index_student(student):
            sid = _normalize_import_text(student.student_id).lower()
            if sid and sid not in existing_by_id:
                existing_by_id[sid] = student
            name_key = _normalize_import_text(student.name).lower()
            if not name_key:
                return
            if student not in existing_names[name_key]:
                existing_names[name_key].append(student)
            if len(existing_names[name_key]) == 1:
                unique_name_map[name_key] = student
            else:
                unique_name_map.pop(name_key, None)

        for _, row in df.iterrows():
            name = _normalize_import_text(row[name_col])
            if not name:
                continue

            # 处理可能的标题行混入（如果手动选择时不准确）
            if name.lower() in {'姓名', 'name'}:
                continue

            student_id = _normalize_import_text(row.get(student_id_col, '')) if student_id_col is not None else ''
            gender = _parse_import_gender(row.get(gender_col, '')) if gender_col is not None else None
            score_value = _parse_import_score(row.get(score_col, 0)) if has_score_column else 0

            if should_match_existing:
                matched_student = None
                if student_id:
                    matched_student = existing_by_id.get(student_id.lower())
                if not matched_student:
                    matched_student = unique_name_map.get(name.lower())

                if not matched_student:
                    created_student = Student.objects.create(
                        classroom=classroom,
                        name=name,
                        student_id=student_id,
                        gender=gender,
                        score=score_value
                    )
                    index_student(created_student)
                    created_count += 1
                    continue

                update_fields = []
                if matched_student.name != name:
                    matched_student.name = name
                    update_fields.append('name')
                if student_id and _normalize_import_text(matched_student.student_id) != student_id:
                    matched_student.student_id = student_id
                    update_fields.append('student_id')
                    existing_by_id[student_id.lower()] = matched_student
                if gender is not None and matched_student.gender != gender:
                    matched_student.gender = gender
                    update_fields.append('gender')
                if has_score_column and matched_student.score != score_value:
                    matched_student.score = score_value
                    update_fields.append('score')

                if update_fields:
                    matched_student.save(update_fields=update_fields)
                updated_count += 1
                continue

            Student.objects.create(
                classroom=classroom,
                name=name,
                student_id=student_id,
                gender=gender,
                score=score_value
            )
            created_count += 1

    return {
        'mode': import_mode,
        'created': created_count,
        'updated': updated_count,
        'skipped': skipped_count,
    }


def _build_constraint_maps(classroom, students):
    must_rows = {}
    must_cols = {}
    forbid_rows = {}
    forbid_cols = {}
    forbid_seats = {}
    must_pairs = {}
    forbid_pairs = {}
    fixed_seats = {}

    constraints = list(classroom.constraints.filter(enabled=True))
    for c in constraints:
        sid = c.student_id
        if c.constraint_type == SeatConstraint.ConstraintType.MUST_SEAT and c.row and c.col:
            fixed_seats[sid] = (c.row, c.col)
        elif c.constraint_type == SeatConstraint.ConstraintType.FORBID_SEAT and c.row and c.col:
            forbid_seats.setdefault(sid, set()).add((c.row, c.col))
        elif c.constraint_type == SeatConstraint.ConstraintType.MUST_ROW and c.row:
            must_rows.setdefault(sid, set()).add(c.row)
        elif c.constraint_type == SeatConstraint.ConstraintType.FORBID_ROW and c.row:
            forbid_rows.setdefault(sid, set()).add(c.row)
        elif c.constraint_type == SeatConstraint.ConstraintType.MUST_COL and c.col:
            must_cols.setdefault(sid, set()).add(c.col)
        elif c.constraint_type == SeatConstraint.ConstraintType.FORBID_COL and c.col:
            forbid_cols.setdefault(sid, set()).add(c.col)
        elif c.constraint_type == SeatConstraint.ConstraintType.MUST_TOGETHER and c.target_student_id:
            must_pairs.setdefault(sid, []).append((c.target_student_id, c.distance))
        elif c.constraint_type == SeatConstraint.ConstraintType.FORBID_TOGETHER and c.target_student_id:
            forbid_pairs.setdefault(sid, []).append((c.target_student_id, c.distance))



    return fixed_seats, must_rows, must_cols, forbid_rows, forbid_cols, forbid_seats, must_pairs, forbid_pairs


def _swap_seats(seat_a, seat_b):
    if not seat_a or not seat_b or seat_a.pk == seat_b.pk:
        return
    student_a = seat_a.student
    student_b = seat_b.student
    with transaction.atomic():
        # 防止唯一性冲突
        seat_a.student = None
        seat_a.save(update_fields=['student'])
        
        seat_b.student = None
        seat_b.save(update_fields=['student'])

        # 交换
        seat_a.student = student_b
        seat_b.student = student_a
        seat_a.save(update_fields=['student'])
        seat_b.save(update_fields=['student'])


def _get_adjacent_seats(classroom, seat):
    """返回与给定座位相邻的有效座位对象列表。"""
    if not seat:
        return []
    # 优先级：左、右、前、后
    coords = [
        (seat.row, seat.col - 1),
        (seat.row, seat.col + 1),
        (seat.row - 1, seat.col),
        (seat.row + 1, seat.col),
    ]
    seats = []
    for r, c in coords:
        s = classroom.seats.filter(row=r, col=c, cell_type=SeatCellType.SEAT).first()
        if s:
            seats.append(s)
    return seats


def _apply_internal_policy(classroom, request=None, trigger_student_id=None):
    return False


pass # 此部分代码未被披露至开源版本
    



def _seat_is_valid(student, seat, assignments, maps, required_group_map=None):
    fixed_seats, must_rows, must_cols, forbid_rows, forbid_cols, forbid_seats, must_pairs, forbid_pairs = maps
    sid = student.pk

    if required_group_map and sid in required_group_map:
        if seat.group_id != required_group_map[sid]:
            return False

    if sid in fixed_seats and (seat.row, seat.col) != fixed_seats[sid]:
        return False

    if sid in must_rows and seat.row not in must_rows[sid]:
        return False
    if sid in must_cols and seat.col not in must_cols[sid]:
        return False
    if sid in forbid_rows and seat.row in forbid_rows[sid]:
        return False
    if sid in forbid_cols and seat.col in forbid_cols[sid]:
        return False
    if sid in forbid_seats and (seat.row, seat.col) in forbid_seats[sid]:
        return False

    for other_id, dist in forbid_pairs.get(sid, []):
        if other_id in assignments:
            other_seat = assignments[other_id]
            if abs(seat.row - other_seat.row) + abs(seat.col - other_seat.col) <= dist:
                return False

    for other_id, dist in must_pairs.get(sid, []):
        if other_id in assignments:
            other_seat = assignments[other_id]
            if abs(seat.row - other_seat.row) + abs(seat.col - other_seat.col) > dist:
                return False

    return True


def _assign_pairs(students, seats, seat_map, assignments, maps, required_group_map=None):
    must_pairs = maps[6]
    available = seats[:]
    available_set = set(available)

    for student in students:
        if student.pk in assignments:
            continue
        pairs = must_pairs.get(student.pk, [])
        for other_id, dist in pairs:
            if other_id in assignments:
                other_seat = assignments[other_id]
                for seat in list(available):
                    if abs(seat.row - other_seat.row) + abs(seat.col - other_seat.col) <= dist:
                        if _seat_is_valid(student, seat, assignments, maps, required_group_map):
                            assignments[student.pk] = seat
                            if seat in available_set:
                                available_set.remove(seat)
                                available.remove(seat)
                            break
                continue
            other_student = next((s for s in students if s.pk == other_id), None)
            if not other_student or other_student.pk in assignments:
                continue

            for seat in list(available):
                if not _seat_is_valid(student, seat, assignments, maps, required_group_map):
                    continue
                for r in range(-dist, dist + 1):
                    for c in range(-dist, dist + 1):
                        if abs(r) + abs(c) > dist:
                            continue
                        if r == 0 and c == 0:
                            continue
                        neighbor = seat_map.get((seat.row + r, seat.col + c))
                        if neighbor and neighbor in available_set and neighbor.pk != seat.pk:
                            if _seat_is_valid(other_student, neighbor, assignments, maps, required_group_map):
                                assignments[student.pk] = seat
                                assignments[other_student.pk] = neighbor
                                if seat in available_set:
                                    available_set.remove(seat)
                                    available.remove(seat)
                                if neighbor in available_set:
                                    available_set.remove(neighbor)
                                    available.remove(neighbor)
                                break
                    if student.pk in assignments:
                        break
                if student.pk in assignments:
                    break
    return available


def _arrange_standard(classroom, students, seats, method):
    seats = [s for s in seats if s.cell_type == SeatCellType.SEAT]
    seat_map = _build_seat_map(seats)

    fixed_seats, must_rows, must_cols, forbid_rows, forbid_cols, forbid_seats, must_pairs, forbid_pairs = _build_constraint_maps(classroom, students)
    maps = (fixed_seats, must_rows, must_cols, forbid_rows, forbid_cols, forbid_seats, must_pairs, forbid_pairs)

    assignments = {}
    available = seats.copy()

    for student in students:
        if student.pk in fixed_seats:
            target = seat_map.get(fixed_seats[student.pk])
            if target and _seat_is_valid(student, target, assignments, maps):
                assignments[student.pk] = target
                if target in available:
                    available.remove(target)

    available = _assign_pairs(students, available, seat_map, assignments, maps)

    for student in students:
        if student.pk in assignments:
            continue
        for seat in list(available):
            if _seat_is_valid(student, seat, assignments, maps):
                assignments[student.pk] = seat
                available.remove(seat)
                break

    Seat.objects.filter(classroom=classroom).update(student=None)

    for student in students:
        seat = assignments.get(student.pk)
        if seat:
            seat.student = student
            seat.save(update_fields=['student'])


def _arrange_grouped(classroom, students, method):
    groups = list(classroom.groups.all())
    if not groups:
        return False

    group_seats = {group.pk: list(group.seats.filter(cell_type=SeatCellType.SEAT).order_by('row', 'col')) for group in groups}
    if not any(group_seats.values()):
        return False

    students_sorted = sorted(students, key=lambda s: s.score or 0, reverse=True)
    group_buckets = {group.pk: [] for group in groups}

    if method == 'group_balanced':
        for student in students_sorted:
            target_group = min(groups, key=lambda g: sum(s.score or 0 for s in group_buckets[g.pk]) / max(len(group_buckets[g.pk]), 1))
            group_buckets[target_group.pk].append(student)
    elif method == 'group_mentor':
        # 高级分组：平衡各组的高低分学生配对
        # 1. 首尾配对
        pairs = []
        left = 0
        right = len(students_sorted) - 1
        while left <= right:
            if left == right:
                pairs.append([students_sorted[left]])
            else:
                pairs.append([students_sorted[left], students_sorted[right]])
            left += 1
            right -= 1
        
        # 2. 贪心分配：总分高者优先
        pairs_with_sum = []
        for p in pairs:
             s = sum(st.score or 0 for st in p)
             pairs_with_sum.append((s, p))
        pairs_with_sum.sort(key=lambda x: x[0], reverse=True)
        

        group_sums = {g.pk: 0.0 for g in groups}
        
        for s_sum, p_students in pairs_with_sum:

            target_group = min(groups, key=lambda g: group_sums[g.pk])
            group_buckets[target_group.pk].extend(p_students)
            group_sums[target_group.pk] += s_sum
    else:
        return False

    fixed_seats, must_rows, must_cols, forbid_rows, forbid_cols, forbid_seats, must_pairs, forbid_pairs = _build_constraint_maps(classroom, students)
    maps = (fixed_seats, must_rows, must_cols, forbid_rows, forbid_cols, forbid_seats, must_pairs, forbid_pairs)

    group_candidate_seats = []
    required_group_map = {}
    for group in groups:
        seats = group_seats.get(group.pk, [])
        group_candidate_seats.extend(seats)
        if seats:
            for student in group_buckets[group.pk]:
                required_group_map[student.pk] = group.pk

    all_seat_cells = list(classroom.seats.filter(cell_type=SeatCellType.SEAT).order_by('row', 'col'))
    all_seat_map = _build_seat_map(all_seat_cells)
    assignments = {}
    available = group_candidate_seats[:]

    students_priority = sorted(students, key=lambda s: (s.pk not in required_group_map, -(s.score or 0), s.pk))

    for student in students_priority:
        if student.pk in fixed_seats:
            target = all_seat_map.get(fixed_seats[student.pk])
            if target and target in available and _seat_is_valid(student, target, assignments, maps, required_group_map):
                assignments[student.pk] = target
                available.remove(target)

    available = _assign_pairs(students_priority, available, all_seat_map, assignments, maps, required_group_map)

    for student in students_priority:
        if student.pk in assignments:
            continue
        for seat in list(available):
            if _seat_is_valid(student, seat, assignments, maps, required_group_map):
                assignments[student.pk] = seat
                available.remove(seat)
                break

    remaining_seats = [seat for seat in all_seat_cells if seat.pk not in {s.pk for s in assignments.values()}]
    remaining_students = [s for s in students_priority if s.pk not in assignments]

    for student in list(remaining_students):
        for seat in list(remaining_seats):
            if _seat_is_valid(student, seat, assignments, maps, required_group_map):
                assignments[student.pk] = seat
                remaining_seats.remove(seat)
                break

    Seat.objects.filter(classroom=classroom).update(student=None)
    for student in students:
        seat = assignments.get(student.pk)
        if seat:
            seat.student = student
            seat.save(update_fields=['student'])

    _normalize_group_leaders(classroom)
    return True


def _run_arrangement(classroom, method):
    students = list(classroom.students.all())
    seats = list(classroom.seats.select_related('student'))
    seat_cells = [s for s in seats if s.cell_type == SeatCellType.SEAT]
    if len(seat_cells) < len(students):
        return False

    if method == 'random':
        random.shuffle(students)
    elif method == 'score_desc':
        students.sort(key=lambda s: s.score or 0, reverse=True)
    elif method == 'score_asc':
        students.sort(key=lambda s: s.score or 0)
    elif method == 'good_front':
        students.sort(key=lambda s: s.score or 0, reverse=True)
    elif method == 'good_back':
        students.sort(key=lambda s: s.score or 0, reverse=True)
        seats = list(reversed(seats))
    elif method == 'score_spread':
        students.sort(key=lambda s: s.score or 0)
        spread = []
        while students:
            spread.append(students.pop())
            if students:
                spread.append(students.pop(0))
        students = spread
    elif method in ['group_balanced', 'group_mentor']:
        return _arrange_grouped(classroom, students, method)

    _arrange_standard(classroom, students, seats, method)
    return True


def _attempt_auto_constraint_fix(classroom, preferred_method=None):
    methods = []
    if preferred_method:
        methods.append(preferred_method)
    methods.extend([
        'random',
        'score_spread',
        'score_desc',
        'score_asc',
        'good_front',
        'good_back',
        'group_balanced',
        'group_mentor',
    ])

    seen = set()
    ordered_methods = []
    for m in methods:
        if m not in seen:
            ordered_methods.append(m)
            seen.add(m)

    for method in ordered_methods:
        tries = 16 if method in ['random', 'score_spread'] else 5
        for _ in range(tries):
            try:
                with transaction.atomic():
                    ok = _run_arrangement(classroom, method)
                    if not ok:
                        raise ValueError('arrange_failed')
                    _stabilize_layout_with_rules(classroom)
                    issues = _layout_hard_issues(classroom)
                    if issues:
                        raise ValueError('constraint_failed')
                return True
            except Exception:
                continue
    return False


def auto_arrange_seats(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    if request.method == 'POST':
        is_ajax = request.headers.get('x-requested-with') == 'XMLHttpRequest'

        def _arrange_error(message, status=400):
            if is_ajax:
                return JsonResponse({'status': 'error', 'message': message}, status=status)
            return HttpResponse(message, status=status)

        method = request.POST.get('method', 'random')
        students_count = classroom.students.count()
        seat_cells_count = classroom.seats.filter(cell_type=SeatCellType.SEAT).count()
        if seat_cells_count < students_count:
            message = f'可用座位不足(座位:{seat_cells_count} < 学生:{students_count})，无法保证100%入座，请在布局编辑中增加座位。'
            return _arrange_error(message, status=400)

        try:
            with transaction.atomic():
                if not _run_arrangement(classroom, method):
                    raise ValueError('未设置小组或小组没有座位')

                _stabilize_layout_with_rules(classroom, request)
                violations = _layout_hard_issues(classroom)
                if violations:
                    raise ValueError(f'约束未满足，排座已回滚：{_format_issues_preview(violations)}')
        except ValueError as e:
            # 自动尝试修复，不直接失败
            if _attempt_auto_constraint_fix(classroom, preferred_method=method):
                _reset_history(request, pk)
                if is_ajax:
                    return JsonResponse({'status': 'success', 'message': '已自动调整并满足约束'})
                return redirect('classroom_detail', pk=pk)
            return _arrange_error(str(e), status=400)

        _reset_history(request, pk)
        if is_ajax:
            return JsonResponse({'status': 'success'})
        return redirect('classroom_detail', pk=pk)
    if request.headers.get('x-requested-with') == 'XMLHttpRequest':
        return JsonResponse({'status': 'error'}, status=400)
    return redirect('classroom_detail', pk=pk)


def _perform_move(classroom, student, target_seat):
    with transaction.atomic():
        current_seat = getattr(student, 'assigned_seat', None)
        target_student = target_seat.student

        # 1. 释放当前座位
        if current_seat:
            current_seat.student = None
            current_seat.save(update_fields=['student'])

        # 2. 释放目标座位
        if target_student:
            target_seat.student = None
            target_seat.save(update_fields=['student'])
        
        # 3. 交换目标学生至旧座
        if current_seat and target_student:
            current_seat.student = target_student
            current_seat.save(update_fields=['student'])

        # 4. 安置学生至新座
        target_seat.student = student
        target_seat.save(update_fields=['student'])

    # 检查组长身份变更
    def _check_leader_lost(stu):
        if not stu: return
        led_group = getattr(stu, 'led_group', None)
        if led_group:
            current_s = getattr(stu, 'assigned_seat', None)
            # 如果没座位，或者座位所在的组不是他领导的组
            if not current_s or current_s.group != led_group:
                # 只有当他确实离开了这个组，才取消他的组长身份
                led_group.leader = None
                led_group.save(update_fields=['leader'])

    # 刷新对象状态以检查最新关联
    if student: student.refresh_from_db()
    if target_student: target_student.refresh_from_db()
    
    _check_leader_lost(student)
    _check_leader_lost(target_student)

    action = {
        'type': 'move',
        'student_id': student.pk,
        'from_row': current_seat.row if current_seat else None,
        'from_col': current_seat.col if current_seat else None,
        'to_row': target_seat.row,
        'to_col': target_seat.col,
        'target_student_id': target_student.pk if target_student else None
    }
    return action


def move_student(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            student_id = data.get('student_id')
            target_row = int(data.get('row'))
            target_col = int(data.get('col'))

            student = get_object_or_404(Student, pk=student_id, classroom=classroom)
            target_seat = get_object_or_404(Seat, classroom=classroom, row=target_row, col=target_col)

            if target_seat.cell_type != SeatCellType.SEAT:
                return JsonResponse({'status': 'error', 'message': '目标位置不可入座'}, status=400)

            with transaction.atomic():
                action = _perform_move(classroom, student, target_seat)
                violations = _stabilize_layout_with_rules(classroom, request, trigger_student_id=student.pk)
                if violations:
                    raise ValueError(f'移动失败：{_format_issues_preview(violations)}')
            _push_action(request, pk, action)
            return JsonResponse({'status': 'success'})
        except ValueError as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
    return JsonResponse({'status': 'error'}, status=400)


@require_POST
def move_students_batch(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        data = json.loads(request.body or '{}')
        moves = data.get('moves') or []
        if not isinstance(moves, list) or not moves:
            return JsonResponse({'status': 'error', 'message': '缺少批量移动数据'}, status=400)

        student_ids = []
        target_coords = []
        seen_students = set()
        seen_targets = set()

        for item in moves:
            sid = int(item.get('student_id'))
            row = int(item.get('row'))
            col = int(item.get('col'))
            if sid in seen_students:
                raise ValueError('同一学生重复出现在批量移动中')
            if (row, col) in seen_targets:
                raise ValueError('目标座位存在重复')
            seen_students.add(sid)
            seen_targets.add((row, col))
            student_ids.append(sid)
            target_coords.append((row, col))

        students_map = classroom.students.in_bulk(student_ids)
        if len(students_map) != len(student_ids):
            raise ValueError('存在不属于当前班级的学生')

        seat_q = models.Q()
        for row, col in target_coords:
            seat_q |= (models.Q(row=row) & models.Q(col=col))
        seat_map = {}
        if seat_q:
            for seat in classroom.seats.filter(seat_q):
                seat_map[(seat.row, seat.col)] = seat

        for row, col in target_coords:
            seat = seat_map.get((row, col))
            if not seat:
                raise ValueError(f'目标座位不存在: {row}-{col}')
            if seat.cell_type != SeatCellType.SEAT:
                raise ValueError(f'目标位置不可入座: {row}-{col}')

        actions = []
        trigger_student_id = None
        with transaction.atomic():
            for item in moves:
                sid = int(item.get('student_id'))
                row = int(item.get('row'))
                col = int(item.get('col'))
                student = students_map.get(sid)
                target_seat = seat_map.get((row, col))
                action = _perform_move(classroom, student, target_seat)
                actions.append(action)
                if trigger_student_id is None:
                    trigger_student_id = sid

            violations = _stabilize_layout_with_rules(classroom, request, trigger_student_id=trigger_student_id)
            if violations:
                raise ValueError(f'批量移动失败：{_format_issues_preview(violations)}')

        _push_action(request, pk, {'type': 'move_batch', 'items': actions})
        return JsonResponse({'status': 'success', 'moved': len(actions)})
    except ValueError as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)


@require_POST
def clear_seat(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        data = json.loads(request.body)
        row = int(data.get('row'))
        col = int(data.get('col'))
        seat = get_object_or_404(Seat, classroom=classroom, row=row, col=col)
        if not seat.student:
            return JsonResponse({'status': 'error', 'message': '座位为空'}, status=400)
        action = {
            'type': 'move',
            'student_id': seat.student.pk,
            'from_row': seat.row,
            'from_col': seat.col,
            'to_row': None,
            'to_col': None,
            'target_student_id': None
        }
        with transaction.atomic():
            if seat.student:
                student = seat.student
                led_group = getattr(student, 'led_group', None)
                if led_group:
                    led_group.leader = None
                    led_group.save(update_fields=['leader'])

            seat.student = None
            seat.save(update_fields=['student'])

            violations = _stabilize_layout_with_rules(classroom, request)
            if violations:
                raise ValueError(f'清空失败：{_format_issues_preview(violations)}')
        _push_action(request, pk, action)
        return JsonResponse({'status': 'success'})
    except ValueError as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)


@require_POST
def assign_student(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        data = json.loads(request.body)
        student_id = data.get('student_id')
        row = int(data.get('row'))
        col = int(data.get('col'))
        student = get_object_or_404(Student, pk=student_id, classroom=classroom)
        target_seat = get_object_or_404(Seat, classroom=classroom, row=row, col=col)
        if target_seat.cell_type != SeatCellType.SEAT:
            return JsonResponse({'status': 'error', 'message': '目标位置不可入座'}, status=400)
        with transaction.atomic():
            action = _perform_move(classroom, student, target_seat)
            violations = _stabilize_layout_with_rules(classroom, request, trigger_student_id=student.pk)
            if violations:
                raise ValueError(f'指派失败：{_format_issues_preview(violations)}')
        _push_action(request, pk, action)
        return JsonResponse({'status': 'success'})
    except ValueError as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)


def delete_student(request, pk, student_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    student = get_object_or_404(Student, pk=student_id, classroom=classroom)
    student.delete()
    is_ajax = request.headers.get('x-requested-with') == 'XMLHttpRequest' or request.headers.get('sec-fetch-mode') == 'cors'
    if is_ajax:
        return JsonResponse({'status': 'success'})
    return redirect('classroom_detail', pk=pk)


@require_POST
def update_cell_type(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        data = json.loads(request.body)
        row = int(data.get('row'))
        col = int(data.get('col'))
        cell_type = data.get('cell_type')
        if cell_type not in [c.value for c in SeatCellType]:
            return JsonResponse({'status': 'error', 'message': '类型不合法'}, status=400)
        seat = get_object_or_404(Seat, classroom=classroom, row=row, col=col)
        action = {
            'type': 'cell_type',
            'row': seat.row,
            'col': seat.col,
            'before': seat.cell_type,
            'after': cell_type,
            'prev_student_id': seat.student.pk if seat.student else None,
            'prev_group_id': seat.group.pk if seat.group else None
        }
        seat.cell_type = cell_type
        if cell_type != SeatCellType.SEAT:
            seat.student = None
            seat.group = None
        seat.save(update_fields=['cell_type', 'student', 'group'])
        _push_action(request, pk, action)
        return JsonResponse({'status': 'success'})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)


@require_POST
def create_group(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    name = str(request.POST.get('name', '')).strip()
    if not name:
        if _is_ajax_request(request):
            return JsonResponse({'status': 'error', 'message': '小组名称不能为空'}, status=400)
        return redirect('classroom_detail', pk=pk)
    group, created = SeatGroup.objects.get_or_create(classroom=classroom, name=name)
    if not created:
        if _is_ajax_request(request):
            return JsonResponse({'status': 'error', 'message': '小组名称已存在'}, status=400)
        return redirect('classroom_detail', pk=pk)
    if _is_ajax_request(request):
        return JsonResponse({'status': 'success', 'group': {'id': group.pk, 'name': group.name}})
    return redirect('classroom_detail', pk=pk)


def _next_group_names(reference_name, existing_names, count):
    if count <= 0:
        return []
    existing = set(str(name) for name in existing_names if str(name).strip())
    generated = []
    ref = str(reference_name or '').strip()
    if not ref:
        ref = '小组'

    if ref.isdigit():
        n = int(ref) + 1
        while len(generated) < count:
            candidate = str(n)
            if candidate not in existing:
                generated.append(candidate)
                existing.add(candidate)
            n += 1
        return generated

    prefix = ref
    start = 1
    m = re.match(r'^(.*?)(\d+)$', ref)
    if m and m.group(1):
        prefix = m.group(1)
        start = int(m.group(2)) + 1

    max_used = 0
    pattern = re.compile(rf'^{re.escape(prefix)}(\d+)$')
    for name in existing:
        mm = pattern.match(name)
        if mm:
            max_used = max(max_used, int(mm.group(1)))
    n = max(start, max_used + 1)
    while len(generated) < count:
        candidate = f'{prefix}{n}'
        if candidate not in existing:
            generated.append(candidate)
            existing.add(candidate)
        n += 1
    return generated


def _detect_group_style(reference_group):
    seats = list(
        reference_group.seats
        .filter(cell_type=SeatCellType.SEAT)
        .order_by('row', 'col')
    )
    if len(seats) < 2:
        return 'horizontal'

    rows = [s.row for s in seats]
    cols = [s.col for s in seats]
    unique_rows = len(set(rows))
    unique_cols = len(set(cols))
    if unique_cols == 1 and unique_rows > 1:
        return 'vertical'
    if unique_rows == 1 and unique_cols > 1:
        return 'horizontal'

    min_row, max_row = min(rows), max(rows)
    min_col, max_col = min(cols), max(cols)
    area = (max_row - min_row + 1) * (max_col - min_col + 1)
    density = len(seats) / max(area, 1)
    if unique_rows > 1 and unique_cols > 1 and density >= 0.6:
        return 'nearby'

    horizontal_pairs = 0
    vertical_pairs = 0
    adjacent_pairs = 0
    for i in range(len(seats)):
        for j in range(i + 1, len(seats)):
            a = seats[i]
            b = seats[j]
            if a.row == b.row:
                horizontal_pairs += 1
            if a.col == b.col:
                vertical_pairs += 1
            if abs(a.row - b.row) + abs(a.col - b.col) == 1:
                adjacent_pairs += 1

    if vertical_pairs > horizontal_pairs * 1.3:
        return 'vertical'
    if horizontal_pairs > vertical_pairs * 1.3:
        return 'horizontal'

    if density >= 0.5 or adjacent_pairs > 0:
        return 'nearby'
    return 'horizontal'


def _normalize_shape_points(points):
    if not points:
        return []
    min_row = min(r for r, _ in points)
    min_col = min(c for _, c in points)
    return sorted((r - min_row, c - min_col) for r, c in points)


def _transform_shape_points(points, mode):
    transformed = []
    for r, c in points:
        if mode == 'r90':
            transformed.append((c, -r))
        elif mode == 'r180':
            transformed.append((-r, -c))
        elif mode == 'r270':
            transformed.append((-c, r))
        else:
            transformed.append((r, c))
    return transformed


def _build_nearby_shape_profile(reference_group):
    seats = list(
        reference_group.seats
        .filter(cell_type=SeatCellType.SEAT)
        .order_by('row', 'col')
    )
    if len(seats) < 2:
        return None

    raw_points = [(s.row, s.col) for s in seats]
    normalized_points = _normalize_shape_points(raw_points)
    if not normalized_points:
        return None

    max_r = max(r for r, _ in normalized_points)
    max_c = max(c for _, c in normalized_points)
    height = max_r + 1
    width = max_c + 1
    count = len(normalized_points)
    area = max(1, height * width)
    density = count / area

    if count == area:
        shape_name = f'block_{height}x{width}'
    elif count == 3 and height == 2 and width == 2:
        shape_name = 'corner_2x2'
    elif height == 1 or width == 1:
        shape_name = 'line'
    else:
        shape_name = 'irregular'

    variants = []
    seen = set()
    for mode in ('r0', 'r90', 'r180', 'r270'):
        variant_points = tuple(_normalize_shape_points(_transform_shape_points(normalized_points, mode)))
        if variant_points and variant_points not in seen:
            seen.add(variant_points)
            variants.append(list(variant_points))

    return {
        'shape_name': shape_name,
        'count': count,
        'width': width,
        'height': height,
        'density': density,
        'variants': variants,
    }


def _pick_nearby_cluster_greedy(remaining, target_count):
    if not remaining or target_count <= 0:
        return []
    cluster = [remaining[0]]
    while len(cluster) < target_count and len(cluster) < len(remaining):
        best_idx = None
        best_key = None
        for idx, seat in enumerate(remaining):
            if seat in cluster:
                continue
            min_dist = min(abs(seat.row - s.row) + abs(seat.col - s.col) for s in cluster)
            key = (min_dist, seat.row, seat.col)
            if best_key is None or key < best_key:
                best_key = key
                best_idx = idx
        if best_idx is None:
            break
        cluster.append(remaining[best_idx])
    return cluster


def _pick_nearby_cluster_by_shape(remaining, target_count, shape_profile):
    if not remaining or target_count <= 0:
        return []
    variants = (shape_profile or {}).get('variants') or []
    if not variants:
        return _pick_nearby_cluster_greedy(remaining, target_count)

    remaining = sorted(remaining, key=lambda s: (s.row, s.col))
    anchor = remaining[0]
    anchor_pos = (anchor.row, anchor.col)
    pos_to_seat = {(s.row, s.col): s for s in remaining}
    pos_set = set(pos_to_seat.keys())
    best_translated_positions = None
    best_matched_positions = None
    best_score = None

    for variant_idx, variant in enumerate(variants):
        if not variant:
            continue
        variant_points = [tuple(p) for p in variant]
        for pattern_point in variant_points:
            dr = anchor_pos[0] - pattern_point[0]
            dc = anchor_pos[1] - pattern_point[1]
            translated_positions = [(dr + pr, dc + pc) for pr, pc in variant_points]
            matched = [pos for pos in translated_positions if pos in pos_set]
            if anchor_pos not in matched:
                continue
            if not matched:
                continue

            rows = [r for r, _ in matched]
            cols = [c for _, c in matched]
            bbox_area = (max(rows) - min(rows) + 1) * (max(cols) - min(cols) + 1)
            distance_sum = sum(abs(r - anchor.row) + abs(c - anchor.col) for r, c in matched)
            score = (len(matched), -bbox_area, -variant_idx, -distance_sum)
            if best_score is None or score > best_score:
                best_score = score
                best_translated_positions = translated_positions
                best_matched_positions = matched

    if not best_translated_positions or not best_matched_positions:
        return _pick_nearby_cluster_greedy(remaining, target_count)

    expected_count = min(target_count, len(best_translated_positions))
    min_required = max(2, int(math.ceil(expected_count * 0.6)))
    if len(best_matched_positions) < min_required:
        return _pick_nearby_cluster_greedy(remaining, target_count)

    selected = [pos_to_seat[pos] for pos in best_translated_positions if pos in pos_set][:target_count]
    selected_pos = {(s.row, s.col) for s in selected}
    candidates = [s for s in remaining if (s.row, s.col) not in selected_pos]

    while len(selected) < target_count and candidates:
        best_idx = None
        best_key = None
        for idx, seat in enumerate(candidates):
            min_dist = min(abs(seat.row - s.row) + abs(seat.col - s.col) for s in selected)
            key = (min_dist, seat.row, seat.col)
            if best_key is None or key < best_key:
                best_key = key
                best_idx = idx
        if best_idx is None:
            break
        selected.append(candidates.pop(best_idx))

    return selected


def _ordered_seats_by_style(seats, style, group_size, groups_needed, nearby_shape_profile=None):
    seats = list(seats)
    if not seats:
        return seats
    style = str(style or 'horizontal').strip().lower()

    if style == 'vertical':
        return sorted(seats, key=lambda s: (s.col, s.row))
    if style == 'horizontal':
        return sorted(seats, key=lambda s: (s.row, s.col))
    if style != 'nearby':
        return sorted(seats, key=lambda s: (s.row, s.col))

    remaining = list(sorted(seats, key=lambda s: (s.row, s.col)))
    ordered = []
    if groups_needed <= 0:
        return remaining

    for g_idx in range(groups_needed):
        if not remaining:
            break
        target_count = group_size
        if g_idx == groups_needed - 1:
            target_count = len(remaining)

        if nearby_shape_profile:
            cluster = _pick_nearby_cluster_by_shape(remaining, target_count, nearby_shape_profile)
        else:
            cluster = _pick_nearby_cluster_greedy(remaining, target_count)
        if not cluster:
            break

        selected_ids = {s.pk for s in cluster}
        remaining = [s for s in remaining if s.pk not in selected_ids]
        ordered.extend(cluster)

    ordered.extend(remaining)
    return ordered


def _line_group_key(seat, style):
    if style == 'vertical':
        return seat.col
    return seat.row


@require_POST
def auto_group_from_reference(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)

    try:
        if request.content_type and 'application/json' in request.content_type:
            data = json.loads(request.body or '{}')
            ref_group_id = data.get('reference_group_id')
            remainder_strategy = data.get('remainder_strategy')
            auto_detect_group_style = data.get('auto_detect_group_style')
        else:
            ref_group_id = request.POST.get('reference_group_id')
            remainder_strategy = request.POST.get('remainder_strategy')
            auto_detect_group_style = request.POST.get('auto_detect_group_style')
        ref_group_id = int(ref_group_id)
    except Exception:
        return JsonResponse({'status': 'error', 'message': '请选择参考小组'}, status=400)

    remainder_strategy = str(remainder_strategy or 'new_group').strip().lower()
    if remainder_strategy not in {'merge_prev', 'new_group', 'skip'}:
        remainder_strategy = 'new_group'
    auto_detect_group_style = _parse_bool(auto_detect_group_style if auto_detect_group_style is not None else '1')

    ref_group = get_object_or_404(SeatGroup, classroom=classroom, pk=ref_group_id)
    reference_size = ref_group.seats.filter(cell_type=SeatCellType.SEAT).count()
    if reference_size <= 0:
        reference_size = ref_group.seats.filter(cell_type=SeatCellType.SEAT, student__isnull=False).count()
    if reference_size <= 0:
        return JsonResponse({'status': 'error', 'message': '参考小组没有可用规模，请先给该组分配座位'}, status=400)

    target_seats = list(
        classroom.seats
        .filter(cell_type=SeatCellType.SEAT, student__isnull=False, group__isnull=True)
        .order_by('row', 'col')
    )
    if not target_seats:
        return JsonResponse({'status': 'error', 'message': '没有可继续编组的未分组学生'}, status=400)

    detected_group_style = _detect_group_style(ref_group) if auto_detect_group_style else 'horizontal'
    linear_grouping = auto_detect_group_style and detected_group_style in {'horizontal', 'vertical'}
    nearby_shape_profile = _build_nearby_shape_profile(ref_group) if detected_group_style == 'nearby' else None
    total_target_count = len(target_seats)
    assign_target_seats = []
    groups_needed = 0
    full_groups = 0
    remainder = 0
    ordered_target_seats = []
    line_key_map = {}

    if linear_grouping:
        ordered_target_seats = sorted(
            target_seats,
            key=lambda s: (_line_group_key(s, detected_group_style), s.col if detected_group_style == 'horizontal' else s.row)
        )
        assign_target_seats = ordered_target_seats
        line_keys = sorted({_line_group_key(s, detected_group_style) for s in ordered_target_seats})
        groups_needed = len(line_keys)
        line_key_map = {_line_group_key(s, detected_group_style): None for s in ordered_target_seats}
    else:
        full_groups = total_target_count // reference_size
        remainder = total_target_count % reference_size

        if remainder_strategy == 'skip':
            assignable_count = full_groups * reference_size
            assign_target_seats = target_seats[:assignable_count]
            groups_needed = full_groups
        else:
            assign_target_seats = target_seats
            if remainder_strategy == 'new_group':
                groups_needed = full_groups + (1 if remainder > 0 else 0)
            else:
                # merge_prev: 余数并入上一组；若连一整组都凑不出，则退化为单组
                if full_groups > 0:
                    groups_needed = full_groups
                else:
                    groups_needed = 1

        ordered_target_seats = _ordered_seats_by_style(
            target_seats,
            detected_group_style,
            reference_size,
            groups_needed,
            nearby_shape_profile=nearby_shape_profile,
        )
        if remainder_strategy == 'skip':
            assign_target_seats = ordered_target_seats[:assignable_count]
        else:
            assign_target_seats = ordered_target_seats

    reusable_groups = list(
        classroom.groups
        .exclude(pk=ref_group.pk)
        .annotate(
            used_seat_count=models.Count(
                'seats',
                filter=models.Q(seats__cell_type=SeatCellType.SEAT),
            )
        )
        .filter(used_seat_count=0)
        .order_by('order', 'pk')
    )
    selected_reusable_groups = reusable_groups[:groups_needed]
    remaining_groups_needed = max(0, groups_needed - len(selected_reusable_groups))

    existing_names = list(classroom.groups.values_list('name', flat=True))
    new_group_names = _next_group_names(ref_group.name, existing_names, remaining_groups_needed)

    created_groups = []
    target_groups = list(selected_reusable_groups)
    action_items = []
    affected_group_ids = set()

    with transaction.atomic():
        current_max_order = classroom.groups.aggregate(m=models.Max('order')).get('m') or 0
        for idx, name in enumerate(new_group_names):
            group = SeatGroup.objects.create(
                classroom=classroom,
                name=name,
                order=current_max_order + idx + 1
            )
            created_groups.append(group)
            target_groups.append(group)

        if assign_target_seats and not target_groups:
            return JsonResponse({'status': 'error', 'message': '没有可用小组可分配'}, status=400)

        if linear_grouping:
            line_keys_in_use = []
            for seat in assign_target_seats:
                key = _line_group_key(seat, detected_group_style)
                if key not in line_key_map:
                    line_key_map[key] = None
                if key not in line_keys_in_use:
                    line_keys_in_use.append(key)
            for idx, key in enumerate(line_keys_in_use):
                line_key_map[key] = target_groups[idx]

        for idx, seat in enumerate(assign_target_seats):
            if linear_grouping:
                group = line_key_map[_line_group_key(seat, detected_group_style)]
            else:
                group = target_groups[min(idx // reference_size, len(target_groups) - 1)]
            before_group_id = seat.group_id
            seat.group = group
            seat.save(update_fields=['group'])
            if before_group_id:
                affected_group_ids.add(before_group_id)
            affected_group_ids.add(group.pk)
            action_items.append({
                'row': seat.row,
                'col': seat.col,
                'before_group_id': before_group_id,
                'after_group_id': group.pk
            })

        if affected_group_ids:
            _normalize_group_leaders(classroom, affected_group_ids)
        if action_items:
            _push_action(request, pk, {'type': 'group_batch', 'items': action_items})

    unassigned_count = total_target_count - len(assign_target_seats)
    strategy_label = {
        'merge_prev': '并入上一组',
        'new_group': '剩余单独成组',
        'skip': '不编组余数'
    }.get(remainder_strategy, remainder_strategy)

    return JsonResponse({
        'status': 'success',
        'assigned_count': len(assign_target_seats),
        'unassigned_count': unassigned_count,
        'group_size': reference_size,
        'linear_grouping': linear_grouping,
        'remainder_strategy': remainder_strategy,
        'group_style': detected_group_style,
        'group_shape': (nearby_shape_profile or {}).get('shape_name'),
        'auto_detect_group_style': auto_detect_group_style,
        'reused_groups': [{'id': g.pk, 'name': g.name} for g in selected_reusable_groups],
        'created_groups': [{'id': g.pk, 'name': g.name} for g in created_groups],
        'message': (
            f'自动编组完成（{strategy_label}，样式：{detected_group_style}'
            + ('/整行列直编' if linear_grouping else '')
            + (f'/{nearby_shape_profile["shape_name"]}' if nearby_shape_profile else '')
            + f'）：复用 {len(selected_reusable_groups)} 组，'
            f'新增 {len(created_groups)} 组，分配 {len(assign_target_seats)} 人'
            + (f'，未编组 {unassigned_count} 人' if unassigned_count > 0 else '')
        )
    })


@require_POST
def merge_groups(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)

    try:
        if request.content_type and 'application/json' in request.content_type:
            data = json.loads(request.body or '{}')
            target_group_id = int(data.get('target_group_id'))
            source_group_ids = data.get('source_group_ids') or []
        else:
            target_group_id = int(request.POST.get('target_group_id'))
            source_group_ids = request.POST.getlist('source_group_ids')
        source_group_ids = [int(gid) for gid in source_group_ids]
    except Exception:
        return JsonResponse({'status': 'error', 'message': '参数错误'}, status=400)

    source_group_ids = list({gid for gid in source_group_ids if gid != target_group_id})
    if not source_group_ids:
        return JsonResponse({'status': 'error', 'message': '请至少选择一个来源组'}, status=400)

    target_group = get_object_or_404(SeatGroup, classroom=classroom, pk=target_group_id)
    source_groups = list(classroom.groups.filter(pk__in=source_group_ids))
    if not source_groups:
        return JsonResponse({'status': 'error', 'message': '来源组不存在'}, status=400)

    source_ids = [g.pk for g in source_groups]
    source_names = [g.name for g in source_groups]

    with transaction.atomic():
        affected_rows = list(
            classroom.seats
            .filter(cell_type=SeatCellType.SEAT, group_id__in=source_ids)
            .values('row', 'col', 'group_id')
        )
        moved_count = len(affected_rows)

        if moved_count:
            classroom.seats.filter(cell_type=SeatCellType.SEAT, group_id__in=source_ids).update(group=target_group)

        if not target_group.leader_id:
            for gid in source_ids:
                g = next((item for item in source_groups if item.pk == gid), None)
                if not g or not g.leader_id:
                    continue
                in_target = classroom.seats.filter(
                    cell_type=SeatCellType.SEAT,
                    group=target_group,
                    student_id=g.leader_id
                ).exists()
                if in_target:
                    target_group.leader_id = g.leader_id
                    target_group.save(update_fields=['leader'])
                    break

        if affected_rows:
            action_items = [
                {
                    'row': item['row'],
                    'col': item['col'],
                    'before_group_id': item['group_id'],
                    'after_group_id': target_group.pk
                }
                for item in affected_rows
            ]
            _push_action(request, pk, {'type': 'group_batch', 'items': action_items})

        SeatGroup.objects.filter(classroom=classroom, pk__in=source_ids).delete()
        _normalize_group_leaders(classroom, [target_group.pk])

    return JsonResponse({
        'status': 'success',
        'target_group': {'id': target_group.pk, 'name': target_group.name},
        'deleted_groups': [{'id': gid, 'name': gname} for gid, gname in zip(source_ids, source_names)],
        'moved_count': moved_count,
        'message': f'已合并 {len(source_ids)} 个来源组到 {target_group.name}'
    })


@require_POST
def rotate_groups(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)

    groups = list(classroom.groups.all())
    if len(groups) < 2:
        return JsonResponse({'status': 'error', 'message': '至少需要 2 个小组才能轮换'}, status=400)

    ordered_groups = []
    expected_size = None
    for group in groups:
        group_seats = list(
            group.seats
            .filter(cell_type=SeatCellType.SEAT)
            .select_related('student', 'group')
            .order_by('row', 'col')
        )
        if not group_seats:
            return JsonResponse({'status': 'error', 'message': f'小组【{group.name}】没有可轮换的座位'}, status=400)
        if expected_size is None:
            expected_size = len(group_seats)
        elif len(group_seats) != expected_size:
            return JsonResponse({'status': 'error', 'message': '小组座位数量不一致，无法执行平移轮换'}, status=400)

        avg_row = sum(seat.row for seat in group_seats) / len(group_seats)
        avg_col = sum(seat.col for seat in group_seats) / len(group_seats)
        ordered_groups.append({
            'group': group,
            'seats': group_seats,
            'avg_row': avg_row,
            'avg_col': avg_col,
        })

    ordered_groups.sort(
        key=lambda item: (
            round(item['avg_row'], 6),
            round(item['avg_col'], 6),
            item['group'].order,
            item['group'].pk
        )
    )

    action_items = []
    for idx, source in enumerate(ordered_groups):
        target = ordered_groups[(idx + 1) % len(ordered_groups)]
        source_group = source['group']
        source_seats = source['seats']
        target_seats = target['seats']

        for source_seat, target_seat in zip(source_seats, target_seats):
            action_items.append({
                'row': target_seat.row,
                'col': target_seat.col,
                'before_student_id': target_seat.student_id,
                'after_student_id': source_seat.student_id,
                'before_group_id': target_seat.group_id,
                'after_group_id': source_group.pk
            })

    if not action_items:
        return JsonResponse({'status': 'error', 'message': '没有可轮换的数据'}, status=400)

    action = {'type': 'seat_layout_batch', 'items': action_items}

    try:
        with transaction.atomic():
            if not _apply_seat_layout_action(classroom, action, forward=True):
                raise ValueError('轮换失败：无法应用座位布局')
            violations = _stabilize_layout_with_rules(classroom, request)
            if violations:
                raise ValueError(f'轮换失败：{_format_issues_preview(violations)}')
            _push_action(request, pk, action)
    except ValueError as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f'轮换失败：{e}'}, status=400)

    order_preview = ' -> '.join(item['group'].name for item in ordered_groups)
    return JsonResponse({
        'status': 'success',
        'message': f'已完成小组平移轮换：{order_preview}'
    })


@require_POST
def rename_group(request, pk, group_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    group = get_object_or_404(SeatGroup, classroom=classroom, pk=group_id)
    new_name = str(request.POST.get('name') or '').strip()
    if not new_name:
        if _is_ajax_request(request):
            return JsonResponse({'status': 'error', 'message': '小组名称不能为空'}, status=400)
        return redirect('classroom_detail', pk=pk)
    if new_name == group.name:
        if _is_ajax_request(request):
            return JsonResponse({'status': 'success'})
        return redirect('classroom_detail', pk=pk)
    if classroom.groups.exclude(pk=group.pk).filter(name=new_name).exists():
        if _is_ajax_request(request):
            return JsonResponse({'status': 'error', 'message': '小组名称已存在'}, status=400)
        return redirect('classroom_detail', pk=pk)
    try:
        group.name = new_name
        group.save(update_fields=['name'])
    except IntegrityError:
        if _is_ajax_request(request):
            return JsonResponse({'status': 'error', 'message': '小组名称已存在'}, status=400)
        return redirect('classroom_detail', pk=pk)
    if _is_ajax_request(request):
        return JsonResponse({'status': 'success', 'group': {'id': group.pk, 'name': group.name}})
    return redirect('classroom_detail', pk=pk)


@require_POST
def delete_group(request, pk, group_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    group = get_object_or_404(SeatGroup, pk=group_id, classroom=classroom)
    deleted_group_id = group.pk
    group.delete()
    if _is_ajax_request(request):
        return JsonResponse({'status': 'success', 'deleted_group_id': deleted_group_id})
    return redirect('classroom_detail', pk=pk)


@require_POST
def assign_group(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        data = json.loads(request.body)
        row = int(data.get('row'))
        col = int(data.get('col'))
        group_id = data.get('group_id')
        seat = get_object_or_404(Seat, classroom=classroom, row=row, col=col)
        if seat.cell_type != SeatCellType.SEAT:
            return JsonResponse({'status': 'error', 'message': '当前单元不可分组'}, status=400)
        before_group_id = seat.group.pk if seat.group else None
        affected_group_ids = set()
        if before_group_id:
            affected_group_ids.add(before_group_id)
        if group_id:
            group = get_object_or_404(SeatGroup, pk=group_id, classroom=classroom)
            seat.group = group
            affected_group_ids.add(group.pk)
        else:
            seat.group = None
        seat.save(update_fields=['group'])
        _normalize_group_leaders(classroom, affected_group_ids)
        action = {
            'type': 'group',
            'row': seat.row,
            'col': seat.col,
            'before_group_id': before_group_id,
            'after_group_id': seat.group.pk if seat.group else None
        }
        _push_action(request, pk, action)
        return JsonResponse({'status': 'success'})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)


@require_POST
def assign_group_batch(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        data = json.loads(request.body)
        seats_payload = data.get('seats', [])
        group_id = data.get('group_id') or None

        group = None
        if group_id:
            group = get_object_or_404(SeatGroup, pk=group_id, classroom=classroom)

        items = []
        affected_group_ids = set()
        if group:
            affected_group_ids.add(group.pk)
        for seat_data in seats_payload:
            row = int(seat_data.get('row'))
            col = int(seat_data.get('col'))
            seat = classroom.seats.filter(row=row, col=col).first()
            if not seat or seat.cell_type != SeatCellType.SEAT:
                continue
            before_group_id = seat.group.pk if seat.group else None
            if before_group_id:
                affected_group_ids.add(before_group_id)
            seat.group = group
            seat.save(update_fields=['group'])
            items.append({
                'row': row,
                'col': col,
                'before_group_id': before_group_id,
                'after_group_id': group.pk if group else None
            })

        if items:
            _normalize_group_leaders(classroom, affected_group_ids)
            action = {'type': 'group_batch', 'items': items}
            _push_action(request, pk, action)
        return JsonResponse({'status': 'success'})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)


@require_POST
def create_constraint(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        constraint_type = request.POST.get('constraint_type')
        student_id = request.POST.get('student_id')
        target_student_id = request.POST.get('target_student_id') or None
        row = request.POST.get('row') or None
        col = request.POST.get('col') or None
        distance = int(request.POST.get('distance') or 1)
        note = request.POST.get('note', '')

        if constraint_type in ['must_seat', 'forbid_seat'] and (not row or not col):
            return redirect('classroom_detail', pk=pk)
        if constraint_type in ['must_row', 'forbid_row'] and not row:
            return redirect('classroom_detail', pk=pk)
        if constraint_type in ['must_col', 'forbid_col'] and not col:
            return redirect('classroom_detail', pk=pk)
        if constraint_type in ['must_together', 'forbid_together'] and not target_student_id:
            return redirect('classroom_detail', pk=pk)

        student = get_object_or_404(Student, pk=student_id, classroom=classroom)
        target_student = None
        if target_student_id:
            target_student = get_object_or_404(Student, pk=target_student_id, classroom=classroom)

        SeatConstraint.objects.create(
            classroom=classroom,
            constraint_type=constraint_type,
            student=student,
            target_student=target_student,
            row=int(row) if row else None,
            col=int(col) if col else None,
            distance=distance,
            note=note
        )
    except Exception as e:
        if request.headers.get('x-requested-with') == 'XMLHttpRequest':
            return JsonResponse({'status': 'error', 'message': f'创建约束失败: {e}'}, status=400)
        return HttpResponse(f'创建约束失败: {e}', status=400)
    return redirect('classroom_detail', pk=pk)


@require_POST
def delete_constraint(request, pk, constraint_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    constraint = get_object_or_404(SeatConstraint, pk=constraint_id, classroom=classroom)
    constraint.delete()
    return redirect('classroom_detail', pk=pk)


def export_students(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)

    layout_transform = str(request.GET.get('layout_transform', 'none')).strip().lower()
    rotate_180 = layout_transform in {'rotate_180', 'rot180', '180'}
    if not rotate_180:
        rotate_flag = str(request.GET.get('rotate_180', '')).strip().lower()
        rotate_180 = rotate_flag in {'1', 'true', 'yes', 'on'}

    # 导出网格布局
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = classroom.name

    # 样式设置
    thin_border = Border(left=Side(style='thin'),
                         right=Side(style='thin'),
                         top=Side(style='thin'),
                         bottom=Side(style='thin'))
    center_align = Alignment(horizontal='center', vertical='center', wrap_text=True)

    # 字体设置
    font_name = '鸿蒙黑体'
    header_font = Font(name=font_name, bold=True, size=20)
    podium_font = Font(name=font_name, bold=True, size=14)
    seat_font = Font(name=font_name, size=12, bold=False)

    # 标题
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=classroom.cols)
    title_suffix = "（180°翻转）" if rotate_180 else ""
    cell = ws.cell(row=1, column=1, value=f"{classroom.name} 座位表{title_suffix}")
    cell.font = header_font
    cell.alignment = center_align
    ws.row_dimensions[1].height = 40

    seat_start_row = 2 if rotate_180 else 3
    podium_row = seat_start_row + classroom.rows if rotate_180 else 2

    # 讲台（翻转模式下展示在底部）
    ws.merge_cells(start_row=podium_row, start_column=1, end_row=podium_row, end_column=classroom.cols)
    podium_cell = ws.cell(row=podium_row, column=1, value="讲台")
    podium_cell.font = podium_font
    podium_cell.alignment = center_align
    ws.row_dimensions[podium_row].height = 30

    seats = classroom.seats.select_related('student').all()
    seat_map = _build_seat_map(seats)

    for c in range(1, classroom.cols + 1):
        ws.column_dimensions[get_column_letter(c)].width = 14

    for visual_row in range(1, classroom.rows + 1):
        row_index = seat_start_row + visual_row - 1
        ws.row_dimensions[row_index].height = 50
        for c in range(1, classroom.cols + 1):
            cell = ws.cell(row=row_index, column=c)
            source_row = classroom.rows - visual_row + 1 if rotate_180 else visual_row
            source_col = classroom.cols - c + 1 if rotate_180 else c
            seat = seat_map.get((source_row, source_col))

            value = ""
            is_seat = False
            if seat:
                if seat.cell_type == SeatCellType.SEAT:
                    is_seat = True
                    if seat.student:
                        value = seat.student.name
                    else:
                        value = ""
                elif seat.cell_type == SeatCellType.AISLE or seat.cell_type == SeatCellType.EMPTY:
                    value = ""
                else:
                    value = seat.get_cell_type_display()

            cell.value = value
            cell.alignment = center_align
            cell.font = seat_font

            # 仅对入座座位加边框
            if is_seat and seat.student:
                cell.border = thin_border

    # A4 横向打印
    from openpyxl.worksheet.page import PageMargins
    ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.margins = PageMargins(left=0.25, right=0.25, top=0.25, bottom=0.25, header=0, footer=0)
    ws.print_options.horizontalCentered = True
    ws.print_options.verticalCentered = True

    # 适应页面
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToHeight = 1
    ws.page_setup.fitToWidth = 1

    response = HttpResponse(content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    filename_suffix = "_座次图_180度翻转.xlsx" if rotate_180 else "_座次图.xlsx"
    response['Content-Disposition'] = f'attachment; filename="{classroom.name}{filename_suffix}"'
    wb.save(response)

    return response


def export_students_options_page(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    return render(request, 'seats/export_excel_options.html', {
        'classroom': classroom
    })


def export_students_svg(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    seats = list(classroom.seats.select_related('student', 'group').all())
    seat_map = _build_seat_map(seats)

    def _qbool(key, default=True):
        raw = request.GET.get(key)
        if raw is None or raw == '':
            return default
        return str(raw).strip().lower() in {'1', 'true', 'yes', 'on'}

    show_title = _qbool('show_title', True)
    show_podium = _qbool('show_podium', True)
    show_coords = _qbool('show_coords', True)
    show_name = _qbool('show_name', True)
    show_score = _qbool('show_score', True)
    show_group = _qbool('show_group', True)
    show_empty_label = _qbool('show_empty_label', True)
    show_seat_type = _qbool('show_seat_type', True)
    name_emphasis_mode = show_name and (not show_coords) and (not show_score)

    theme = str(request.GET.get('theme', 'classic')).strip().lower()
    if theme not in SVG_EXPORT_THEME_MAP:
        theme = 'classic'
    style = SVG_EXPORT_THEME_MAP[theme]

    cell_w = 120
    cell_h = 86
    gap = 10
    padding_x = 24
    padding_y = 24
    if show_title and show_podium:
        header_h = 90
    elif show_title or show_podium:
        header_h = 64
    else:
        header_h = 16

    grid_w = classroom.cols * cell_w + max(0, classroom.cols - 1) * gap
    grid_h = classroom.rows * cell_h + max(0, classroom.rows - 1) * gap

    width = padding_x * 2 + grid_w
    height = padding_y * 2 + header_h + grid_h
    grid_top = padding_y + header_h

    podium_w = min(340, max(180, int(grid_w * 0.42)))
    podium_h = 34
    podium_x = padding_x + (grid_w - podium_w) // 2

    def group_color(group_id):
        if not group_id:
            return '#9aa6c2'
        group_palette = style['group_palette']
        return group_palette[(int(group_id) - 1) % len(group_palette)]

    chunks = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<defs>',
        '<style><![CDATA['
        '.title{font:700 24px "鸿蒙黑体","PingFang SC","Microsoft YaHei",sans-serif;}'
        '.cell-name{font:600 16px "鸿蒙黑体","PingFang SC","Microsoft YaHei",sans-serif;}'
        '.cell-sub{font:500 12px "鸿蒙黑体","PingFang SC","Microsoft YaHei",sans-serif;}'
        '.tag{font:700 11px "鸿蒙黑体","PingFang SC","Microsoft YaHei",sans-serif;}'
        '.cell-type{font:600 13px "鸿蒙黑体","PingFang SC","Microsoft YaHei",sans-serif;}'
        ']]></style>',
        '</defs>',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="{style["bg"]}"/>',
    ]

    if show_title:
        title_y = padding_y + 28 if show_podium else padding_y + 30
        chunks.append(
            f'<text x="{padding_x}" y="{title_y}" class="title" fill="{style["title"]}">{html.escape(classroom.name)} 座次图</text>'
        )

    if show_podium:
        podium_y = padding_y + 32 if show_title else padding_y + 14
        chunks.append(
            f'<rect x="{podium_x}" y="{podium_y}" width="{podium_w}" height="{podium_h}" rx="12" fill="{style["podium_fill"]}" stroke="{style["podium_stroke"]}"/>'
        )
        chunks.append(
            f'<text x="{podium_x + podium_w / 2}" y="{podium_y + 22}" text-anchor="middle" class="cell-type" fill="{style["type"]}">讲台</text>'
        )

    for r in range(1, classroom.rows + 1):
        for c in range(1, classroom.cols + 1):
            seat = seat_map.get((r, c))
            if not seat:
                continue

            x = padding_x + (c - 1) * (cell_w + gap)
            y = grid_top + (r - 1) * (cell_h + gap)

            if seat.cell_type == SeatCellType.SEAT:
                if seat.student_id:
                    fill = style['seat_fill_occupied']
                    stroke = style['seat_stroke_occupied']
                else:
                    fill = style['seat_fill_empty']
                    stroke = style['seat_stroke_empty']

                chunks.append(
                    f'<rect x="{x}" y="{y}" width="{cell_w}" height="{cell_h}" rx="16" fill="{fill}" stroke="{stroke}"/>'
                )
                if show_coords:
                    chunks.append(
                        f'<text x="{x + 8}" y="{y + 16}" class="cell-sub" fill="{style["sub"]}">({r}-{c})</text>'
                    )

                if show_group and seat.group_id and seat.group:
                    tag_w = max(36, min(66, 18 + len(seat.group.name) * 12))
                    tag_color = group_color(seat.group_id)
                    chunks.append(
                        f'<rect x="{x + cell_w - tag_w - 8}" y="{y + 8}" width="{tag_w}" height="20" rx="10" fill="{tag_color}"/>'
                    )
                    chunks.append(
                        f'<text x="{x + cell_w - tag_w / 2 - 8}" y="{y + 22}" text-anchor="middle" class="tag" fill="{style["tag_text"]}">{html.escape(seat.group.name)}</text>'
                    )

                if seat.student:
                    base_name_y = y + (48 if show_coords else 42)
                    if show_name:
                        if name_emphasis_mode:
                            name_size = _name_emphasis_font_size(seat.student.name)
                            center_y = y + cell_h / 2 + (6 if (show_group and seat.group_id) else 0)
                            chunks.append(
                                f'<text x="{x + cell_w / 2}" y="{center_y}" text-anchor="middle" dominant-baseline="middle" class="cell-name" font-size="{name_size}" fill="{style["name"]}">{html.escape(seat.student.name)}</text>'
                            )
                        else:
                            chunks.append(
                                f'<text x="{x + 12}" y="{base_name_y}" class="cell-name" fill="{style["name"]}">{html.escape(seat.student.name)}</text>'
                            )
                    if show_score and (seat.student.score or 0) > 0:
                        score_y = base_name_y + 20 if show_name else y + (56 if show_coords else 50)
                        chunks.append(
                            f'<text x="{x + 12}" y="{score_y}" class="cell-sub" fill="{style["sub"]}">{seat.student.display_score}分</text>'
                        )
                elif show_empty_label:
                    empty_y = y + (56 if show_coords else 50)
                    chunks.append(
                        f'<text x="{x + 12}" y="{empty_y}" class="cell-sub" fill="{style["sub"]}">空座位</text>'
                    )
                continue

            if seat.cell_type == SeatCellType.AISLE:
                fill = style['nonseat_aisle']
            elif seat.cell_type == SeatCellType.PODIUM:
                fill = style['nonseat_podium']
            else:
                fill = style['nonseat_empty']

            chunks.append(
                f'<rect x="{x}" y="{y}" width="{cell_w}" height="{cell_h}" rx="16" fill="{fill}" stroke="{style["nonseat_stroke"]}"/>'
            )
            if show_seat_type:
                chunks.append(
                    f'<text x="{x + cell_w / 2}" y="{y + 50}" text-anchor="middle" class="cell-type" fill="{style["type"]}">{html.escape(seat.get_cell_type_display())}</text>'
                )

    chunks.append('</svg>')
    svg_content = ''.join(chunks)

    response = HttpResponse(svg_content, content_type='image/svg+xml; charset=utf-8')
    filename = escape_uri_path(f'{classroom.name}_座次图.svg')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def export_students_svg_preview_student(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    student_ids = list(classroom.students.values_list('pk', flat=True))
    if not student_ids:
        return JsonResponse({'status': 'empty', 'message': '当前班级暂无学生'})

    random_student_id = random.choice(student_ids)
    student = classroom.students.filter(pk=random_student_id).first()
    if not student:
        return JsonResponse({'status': 'empty', 'message': '当前班级暂无学生'})

    seat = getattr(student, 'assigned_seat', None)
    group_name = ''
    group_index = 0
    coord = ''
    if seat:
        coord = f'{seat.row}-{seat.col}'
        if seat.group_id and seat.group:
            group_name = seat.group.name
            group_index = int(seat.group_id)

    score_display = student.display_score if (student.score or 0) > 0 else ''

    return JsonResponse({
        'status': 'success',
        'sample': {
            'classroom': classroom.name,
            'name': student.name,
            'score': score_display,
            'group': group_name,
            'group_index': group_index,
            'coord': coord
        }
    })


def export_students_svg_options_page(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    return render(request, 'seats/export_svg_options.html', {
        'classroom': classroom
    })


def export_students_pptx(request, pk):
    try:
        from pptx import Presentation
        from pptx.dml.color import RGBColor
        from pptx.enum.shapes import MSO_SHAPE
        from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
        from pptx.oxml import parse_xml
        from pptx.oxml.ns import nsdecls, qn
        from pptx.util import Inches, Pt
    except ImportError:
        return HttpResponse('缺少 python-pptx 依赖，请先安装 requirements.txt', status=500)

    classroom = get_object_or_404(Classroom, pk=pk)
    seats = list(classroom.seats.select_related('student', 'group').all())
    seat_map = _build_seat_map(seats)

    def _qbool(key, default=True):
        raw = request.GET.get(key)
        if raw is None or raw == '':
            return default
        return str(raw).strip().lower() in {'1', 'true', 'yes', 'on'}

    show_title = _qbool('show_title', True)
    show_podium = _qbool('show_podium', True)
    show_coords = _qbool('show_coords', True)
    show_name = _qbool('show_name', True)
    show_score = _qbool('show_score', True)
    show_group = _qbool('show_group', True)
    show_empty_label = _qbool('show_empty_label', True)
    show_seat_type = _qbool('show_seat_type', True)
    name_emphasis_mode = show_name and (not show_coords) and (not show_score)

    theme = str(request.GET.get('theme', 'classic')).strip().lower()
    if theme not in SVG_EXPORT_THEME_MAP:
        theme = 'classic'
    style = SVG_EXPORT_THEME_MAP[theme]

    cell_w = 120
    cell_h = 86
    gap = 10
    padding_x = 24
    padding_y = 24
    if show_title and show_podium:
        header_h = 90
    elif show_title or show_podium:
        header_h = 64
    else:
        header_h = 16

    grid_w = classroom.cols * cell_w + max(0, classroom.cols - 1) * gap
    grid_h = classroom.rows * cell_h + max(0, classroom.rows - 1) * gap
    grid_top = padding_y + header_h

    content_w = padding_x * 2 + grid_w
    content_h = padding_y * 2 + header_h + grid_h

    podium_w = min(340, max(180, int(grid_w * 0.42)))
    podium_h = 34
    podium_x = padding_x + (grid_w - podium_w) // 2

    slide_w = 13.333
    slide_h = 7.5
    margin = 0.3
    usable_w = max(0.1, slide_w - margin * 2)
    usable_h = max(0.1, slide_h - margin * 2)
    scale = min(usable_w / max(1, content_w), usable_h / max(1, content_h))
    offset_x = (slide_w - content_w * scale) / 2
    offset_y = (slide_h - content_h * scale) / 2

    def sx(value):
        return offset_x + value * scale

    def sy(value):
        return offset_y + value * scale

    def sw(value):
        return value * scale

    def sh(value):
        return value * scale

    def font_pt(base_px):
        return max(8, base_px * scale * 72)

    def rgb(hex_color):
        return RGBColor(*_hex_to_rgb_parts(hex_color))

    def group_color(group_id):
        if not group_id:
            return '#9aa6c2'
        group_palette = style['group_palette']
        return group_palette[(int(group_id) - 1) % len(group_palette)]

    prs = Presentation()
    prs.slide_width = Inches(slide_w)
    prs.slide_height = Inches(slide_h)
    slide = prs.slides.add_slide(prs.slide_layouts[6])

    bg = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(0),
        Inches(0),
        Inches(slide_w),
        Inches(slide_h),
    )
    bg.fill.solid()
    bg.fill.fore_color.rgb = rgb(style['bg'])
    bg.line.fill.background()

    def add_round_rect(x, y, w, h, fill_color, stroke_color=None):
        shape = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(sx(x)),
            Inches(sy(y)),
            Inches(sw(w)),
            Inches(sh(h)),
        )
        shape.fill.solid()
        shape.fill.fore_color.rgb = rgb(fill_color)
        if stroke_color:
            shape.line.color.rgb = rgb(stroke_color)
            shape.line.width = Pt(max(0.75, scale * 72))
        else:
            shape.line.fill.background()
        # 控制阴影透明度，避免默认主题阴影过重
        sp_pr = shape._element.spPr
        for child in list(sp_pr):
            if child.tag == qn('a:effectLst'):
                sp_pr.remove(child)
        effect_xml = parse_xml(
            f'<a:effectLst {nsdecls("a")}>'
            '<a:outerShdw blurRad="38100" dist="19050" dir="5400000" algn="ctr" rotWithShape="0">'
            '<a:srgbClr val="000000"><a:alpha val="12000"/></a:srgbClr>'
            '</a:outerShdw>'
            '</a:effectLst>'
        )
        sp_pr.append(effect_xml)
        return shape

    def add_text(x, y, w, h, text, color, size_px, bold=False, center=False, middle=True):
        if text is None:
            return
        font_name = '鸿蒙黑体'
        shape = slide.shapes.add_textbox(
            Inches(sx(x)),
            Inches(sy(y)),
            Inches(sw(w)),
            Inches(sh(h)),
        )
        tf = shape.text_frame
        tf.clear()
        tf.margin_left = 0
        tf.margin_right = 0
        tf.margin_top = 0
        tf.margin_bottom = 0
        tf.word_wrap = False
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE if middle else MSO_ANCHOR.TOP
        paragraph = tf.paragraphs[0]
        paragraph.alignment = PP_ALIGN.CENTER if center else PP_ALIGN.LEFT
        run = paragraph.add_run()
        run.text = str(text)
        run.font.name = font_name
        run.font.bold = bool(bold)
        run.font.size = Pt(font_pt(size_px))
        run.font.color.rgb = rgb(color)
        # 同时设置 latin/eastAsia/cs，确保中文文本在 PPT 中按指定字体渲染
        r_pr = run._r.get_or_add_rPr()
        for tag in ('latin', 'ea', 'cs'):
            node = r_pr.find(qn(f'a:{tag}'))
            if node is None:
                node = parse_xml(f'<a:{tag} {nsdecls("a")} typeface="{font_name}"/>')
                r_pr.append(node)
            else:
                node.set('typeface', font_name)

    if show_title:
        title_y = padding_y + 28 if show_podium else padding_y + 30
        add_text(
            padding_x,
            title_y - 24,
            grid_w,
            32,
            f'{classroom.name} 座次图',
            style['title'],
            24,
            bold=True,
            center=False,
            middle=True,
        )

    if show_podium:
        podium_y = padding_y + 32 if show_title else padding_y + 14
        add_round_rect(podium_x, podium_y, podium_w, podium_h, style['podium_fill'], style['podium_stroke'])
        add_text(
            podium_x,
            podium_y + 4,
            podium_w,
            24,
            '讲台',
            style['type'],
            13,
            bold=True,
            center=True,
            middle=True,
        )

    for r in range(1, classroom.rows + 1):
        for c in range(1, classroom.cols + 1):
            seat = seat_map.get((r, c))
            if not seat:
                continue

            x = padding_x + (c - 1) * (cell_w + gap)
            y = grid_top + (r - 1) * (cell_h + gap)

            if seat.cell_type == SeatCellType.SEAT:
                if seat.student_id:
                    fill = style['seat_fill_occupied']
                    stroke = style['seat_stroke_occupied']
                else:
                    fill = style['seat_fill_empty']
                    stroke = style['seat_stroke_empty']

                add_round_rect(x, y, cell_w, cell_h, fill, stroke)

                if show_coords:
                    add_text(
                        x + 8,
                        y + 5,
                        cell_w - 16,
                        16,
                        f'({r}-{c})',
                        style['sub'],
                        12,
                        bold=False,
                        center=False,
                        middle=False,
                    )

                if show_group and seat.group_id and seat.group:
                    tag_w = max(36, min(66, 18 + len(seat.group.name) * 12))
                    tag_color = group_color(seat.group_id)
                    add_round_rect(x + cell_w - tag_w - 8, y + 8, tag_w, 20, tag_color, None)
                    add_text(
                        x + cell_w - tag_w - 8,
                        y + 8,
                        tag_w,
                        20,
                        seat.group.name,
                        style['tag_text'],
                        11,
                        bold=True,
                        center=True,
                        middle=True,
                    )

                if seat.student:
                    base_name_y = y + (48 if show_coords else 42)
                    if show_name:
                        if name_emphasis_mode:
                            name_size = _name_emphasis_font_size(seat.student.name)
                            center_y = y + cell_h / 2 + (6 if (show_group and seat.group_id) else 0)
                            add_text(
                                x + 10,
                                center_y - 18,
                                cell_w - 20,
                                36,
                                seat.student.name,
                                style['name'],
                                name_size,
                                bold=True,
                                center=True,
                                middle=True,
                            )
                        else:
                            add_text(
                                x + 12,
                                base_name_y - 16,
                                cell_w - 24,
                                22,
                                seat.student.name,
                                style['name'],
                                16,
                                bold=True,
                                center=False,
                                middle=False,
                            )
                    if show_score and (seat.student.score or 0) > 0:
                        score_y = base_name_y + 20 if show_name else y + (56 if show_coords else 50)
                        add_text(
                            x + 12,
                            score_y - 14,
                            cell_w - 24,
                            20,
                            f'{seat.student.display_score}分',
                            style['sub'],
                            12,
                            bold=False,
                            center=False,
                            middle=False,
                        )
                elif show_empty_label:
                    empty_y = y + (56 if show_coords else 50)
                    add_text(
                        x + 12,
                        empty_y - 14,
                        cell_w - 24,
                        20,
                        '空座位',
                        style['sub'],
                        12,
                        bold=False,
                        center=False,
                        middle=False,
                    )
                continue

            if seat.cell_type == SeatCellType.AISLE:
                fill = style['nonseat_aisle']
            elif seat.cell_type == SeatCellType.PODIUM:
                fill = style['nonseat_podium']
            else:
                fill = style['nonseat_empty']

            add_round_rect(x, y, cell_w, cell_h, fill, style['nonseat_stroke'])
            if show_seat_type:
                add_text(
                    x + 8,
                    y + 33,
                    cell_w - 16,
                    28,
                    seat.get_cell_type_display(),
                    style['type'],
                    13,
                    bold=True,
                    center=True,
                    middle=True,
                )

    buffer = BytesIO()
    prs.save(buffer)
    response = HttpResponse(
        buffer.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
    filename = escape_uri_path(f'{classroom.name}_座次图.pptx')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def export_students_pptx_options_page(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    return render(request, 'seats/export_pptx_options.html', {
        'classroom': classroom
    })


def export_group_report(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    groups = list(classroom.groups.all())

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = '小组作业登记表'
    
    from openpyxl.worksheet.page import PageMargins

    # 样式
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin'),
    )
    font_name = '鸿蒙黑体'
    group_font = Font(name=font_name, bold=True, size=13)
    name_font  = Font(name=font_name, size=11)
    center     = Alignment(horizontal='center', vertical='center')

    # 页眉
    header_text = f"&\"{font_name},Bold\"&14 {classroom.name} (          ) 登记表"
    ws.oddHeader.center.text = header_text
    ws.evenHeader.center.text = header_text

    # 1. 生成线性列表
    # 类型: 'header', 'member', 'gap'
    
    flat_entries = []
    
    WEIGHT_HEADER = 26
    WEIGHT_MEMBER = 24
    WEIGHT_GAP = 10
    
    total_weight = 0
    
    for i, group in enumerate(groups):
        # 组头
        flat_entries.append({
            'type': 'header', 
            'text': group.name, 
            'group_id': group.pk,
            'weight': WEIGHT_HEADER
        })
        total_weight += WEIGHT_HEADER
        
        # 成员
        seats = group.seats.select_related('student').filter(student__isnull=False)
        members = []
        for s in seats:
             is_ldr = (group.leader_id == s.student_id)
             members.append({'name': s.student.name, 'is_leader': is_ldr})
        
        # 组长排第一
        members.sort(key=lambda x: not x['is_leader'])

        for m in members:
            flat_entries.append({
                'type': 'member', 
                'text': m['name'], 
                'is_leader': m['is_leader'],
                'group_id': group.pk,
                'group_name': group.name, # 用于断行时补标题
                'weight': WEIGHT_MEMBER
            })
            total_weight += WEIGHT_MEMBER
            
        # 组间间隔
        if i < len(groups) - 1:
            flat_entries.append({'type': 'gap', 'weight': WEIGHT_GAP})
            total_weight += WEIGHT_GAP

    # 2. 寻找最佳切分点
    target_weight = total_weight / 2
    current_weight = 0
    split_index = 0
    
    for i, entry in enumerate(flat_entries):
        current_weight += entry.get('weight', 0)
        if current_weight >= target_weight:
            split_index = i + 1
            break
            
    left_entries = flat_entries[:split_index]
    right_entries = flat_entries[split_index:]
    
    # 3. 处理断行衔接
    if right_entries:
        first = right_entries[0]
        # 移除首行间隔
        if first['type'] == 'gap':
            right_entries.pop(0)
            if right_entries:
                first = right_entries[0]
                
        # 如果切断，补标题
        if right_entries and first['type'] == 'member':
            continuation_header = {
                'type': 'header',
                'text': f"{first['group_name']} (续)",
                'group_id': first['group_id'],
                'weight': WEIGHT_HEADER
            }
            right_entries.insert(0, continuation_header)

    # 4. 动态计算布局参数
    # A4: 210mm x 297mm
    # 垂直方向 (1mm ≈ 2.835pts)
    PAGE_H_MM = 297
    MARGIN_V_MM = 12.7 * 2  # 上下留白
    HEADER_RES_MM = 15      # 页眉预留
    AVAILABLE_H_MM = PAGE_H_MM - MARGIN_V_MM - HEADER_RES_MM
    AVAILABLE_H_PTS = AVAILABLE_H_MM * 2.835
    
    # 计算总行数
    max_rows = max(len(left_entries), len(right_entries))
    if max_rows == 0:
        max_rows = 1
        
    # 定义高度权重 (relative weights)
    W_HEADER = 1.0
    W_MEMBER = 1.0
    W_GAP    = 0.4
    
    # 计算总权重
    total_weight = 0
    row_weights = [] # 记录每一行的权重
    
    for i in range(max_rows):
        l = left_entries[i] if i < len(left_entries) else None
        r = right_entries[i] if i < len(right_entries) else None
        
        # 取本行最大特征权重
        w_l = 0
        if l:
            if l['type'] == 'header': w_l = W_HEADER
            elif l['type'] == 'member': w_l = W_MEMBER
            elif l['type'] == 'gap': w_l = W_GAP
            
        w_r = 0
        if r:
            if r['type'] == 'header': w_r = W_HEADER
            elif r['type'] == 'member': w_r = W_MEMBER
            elif r['type'] == 'gap': w_r = W_GAP
            
        # 默认权重
        cur_w = max(w_l, w_r)
        if cur_w == 0: cur_w = W_GAP
        
        row_weights.append(cur_w)
        total_weight += cur_w
        
    # 计算单位高度 (points)
    unit_h = AVAILABLE_H_PTS / total_weight
    
    # 高度限制
    MAX_UNIT_H = 45 
    MIN_UNIT_H = 18
    
    if unit_h > MAX_UNIT_H:
        unit_h = MAX_UNIT_H
    if unit_h < MIN_UNIT_H:
        unit_h = MIN_UNIT_H # 此时可能会溢出第一页，依赖fitToHeight压回来，或者自然分页
        
    # 水平方向 (单位: Excel Column Width Units)
    # 1 unit ≈ 2mm
    TOTAL_COL_WIDTH = 98
    
    boxes_count = 5
    box_width = 4.5
    gap_width = 2
    
    fixed_used = (2 * boxes_count * box_width) + gap_width
    remain_for_names = TOTAL_COL_WIDTH - fixed_used
    name_col_width = remain_for_names / 2
    
    # 保证最小名宽
    if name_col_width < 12: name_col_width = 12

    # 列索引
    left_col_idx  = 1
    gap_col_idx   = 1 + boxes_count + 1
    right_col_idx = gap_col_idx + 1

    # 应用列宽
    ws.column_dimensions[get_column_letter(left_col_idx)].width = name_col_width
    for b in range(1, boxes_count + 1):
        ws.column_dimensions[get_column_letter(left_col_idx + b)].width = box_width
    ws.column_dimensions[get_column_letter(gap_col_idx)].width = gap_width
    ws.column_dimensions[get_column_letter(right_col_idx)].width = name_col_width
    for b in range(1, boxes_count + 1):
        ws.column_dimensions[get_column_letter(right_col_idx + b)].width = box_width

    # 5. 渲染内容
    def _write_entry(ws, row, start_col, entry):
        kind = entry['type']
        
        if kind == 'header':
            ws.merge_cells(
                start_row=row, start_column=start_col,
                end_row=row, end_column=start_col + boxes_count
            )
            cell = ws.cell(row=row, column=start_col, value=entry['text'])
            cell.font = group_font
            cell.alignment = center
            cell.fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
            for c in range(start_col, start_col + boxes_count + 1):
                ws.cell(row=row, column=c).border = thin_border
            
        elif kind == 'member':
            cell_name = ws.cell(row=row, column=start_col, value=entry['text'])
            cell_name.font = Font(name='微软雅黑', size=11, color="FF0000" if entry.get('is_leader') else "000000")
            cell_name.alignment = center
            cell_name.border = thin_border
            for b in range(1, boxes_count + 1):
                ws.cell(row=row, column=start_col + b).border = thin_border

    start_row = 1
    
    for i in range(max_rows):
        r = start_row + i
        
        # 写入内容
        l_entry = left_entries[i] if i < len(left_entries) else None
        r_entry = right_entries[i] if i < len(right_entries) else None
        
        if l_entry: _write_entry(ws, r, left_col_idx, l_entry)
        if r_entry: _write_entry(ws, r, right_col_idx, r_entry)
            
        # 动态行高
        h_pts = row_weights[i] * unit_h
        ws.row_dimensions[r].height = h_pts
            
    # 设置打印区域
    last_col_letter = get_column_letter(right_col_idx + boxes_count)
    ws.print_area = f"A1:{last_col_letter}{start_row + max_rows - 1}"

    # 6. 页面设置
    ws.page_setup.orientation = ws.ORIENTATION_PORTRAIT
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.margins = PageMargins(
        left=0.25, right=0.25,
        top=0.5, bottom=0.25,
        header=0.3, footer=0.2
    )
    ws.print_options.horizontalCentered = True
    
    # 强制一页
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1

    response = HttpResponse(content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response['Content-Disposition'] = f'attachment; filename="{classroom.name}_小组作业表.xlsx"'
    wb.save(response)

    return response


def save_layout_snapshot(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    if request.method == 'POST':
        name = str(request.POST.get('snapshot_name', '')).strip()
        if not name:
            return redirect('classroom_detail', pk=pk)
        data = _snapshot_payload(classroom, include_students=False)
        LayoutSnapshot.objects.update_or_create(
            classroom=classroom,
            name=name,
            defaults={'data': data}
        )
    return redirect('classroom_detail', pk=pk)


def load_layout_snapshot(request, pk, snapshot_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    snapshot = get_object_or_404(LayoutSnapshot, pk=snapshot_id, classroom=classroom)
    _apply_layout_data(classroom, snapshot.data, replace_students=False)
    return redirect('classroom_detail', pk=pk)


def delete_layout_snapshot(request, pk, snapshot_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    snapshot = get_object_or_404(LayoutSnapshot, pk=snapshot_id, classroom=classroom)
    snapshot.delete()
    return redirect('classroom_detail', pk=pk)


def export_seats_file(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    data = _snapshot_payload(classroom, include_students=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    response = HttpResponse(payload, content_type='application/octet-stream')
    filename = escape_uri_path(f'{classroom.name}.seats')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def import_seats_file(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    if request.method == 'POST' and request.FILES.get('seats_file'):
        seats_file = request.FILES['seats_file']
        try:
            raw = seats_file.read().decode('utf-8')
            data = json.loads(raw)
            _apply_layout_data(classroom, data, replace_students=True)
            _reset_history(request, pk)
        except Exception:
            pass
    return redirect('classroom_detail', pk=pk)


def undo_action(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    history = _get_history(request, pk)
    if not history['undo']:
        return JsonResponse({'status': 'error', 'message': '没有可撤销操作'}, status=400)
    action = history['undo'].pop()
    if action['type'] == 'move':
        inverse = _invert_move_action(action)
        _apply_move_action(classroom, inverse)
    elif action['type'] == 'move_batch':
        _apply_move_batch_action(classroom, action, forward=False)
    elif action['type'] == 'cell_type':
        _apply_cell_type_action(classroom, action, forward=False)
    elif action['type'] == 'group':
        _apply_group_action(classroom, action, forward=False)
    elif action['type'] == 'group_batch':
        _apply_group_batch_action(classroom, action, forward=False)
    elif action['type'] == 'seat_layout_batch':
        _apply_seat_layout_action(classroom, action, forward=False)
    history['redo'].append(action)
    request.session.modified = True
    return JsonResponse({'status': 'success'})


def redo_action(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    history = _get_history(request, pk)
    if not history['redo']:
        return JsonResponse({'status': 'error', 'message': '没有可重做操作'}, status=400)
    action = history['redo'].pop()
    if action['type'] == 'move':
        _apply_move_action(classroom, action)
    elif action['type'] == 'move_batch':
        _apply_move_batch_action(classroom, action, forward=True)
    elif action['type'] == 'cell_type':
        _apply_cell_type_action(classroom, action, forward=True)
    elif action['type'] == 'group':
        _apply_group_action(classroom, action, forward=True)
    elif action['type'] == 'group_batch':
        _apply_group_batch_action(classroom, action, forward=True)
    elif action['type'] == 'seat_layout_batch':
        _apply_seat_layout_action(classroom, action, forward=True)
    history['undo'].append(action)
    request.session.modified = True
    return JsonResponse({'status': 'success'})


def delete_classroom(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    classroom.delete()
    return redirect('index')


@require_POST
def rename_classroom(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    is_json = bool(request.content_type and 'application/json' in request.content_type)
    try:
        if is_json:
            payload = json.loads(request.body or '{}')
            new_name = str(payload.get('name') or '').strip()
        else:
            new_name = str(request.POST.get('name') or '').strip()
    except Exception:
        return JsonResponse({'status': 'error', 'message': '请求数据格式错误'}, status=400)

    if not new_name:
        return JsonResponse({'status': 'error', 'message': '班级名称不能为空'}, status=400)
    if len(new_name) > 100:
        return JsonResponse({'status': 'error', 'message': '班级名称不能超过 100 个字符'}, status=400)

    classroom.name = new_name
    classroom.save(update_fields=['name'])

    if is_json or _is_ajax_request(request):
        return JsonResponse({'status': 'success', 'name': classroom.name})
    return redirect('classroom_detail', pk=pk)


@require_POST
def apply_suggestion(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    suggestion_type = (request.GET.get('type') or '').strip()

    if suggestion_type in DISABLED_SUGGESTION_TYPES:
        return JsonResponse({'status': 'success', 'message': '该建议已停用'})
    
    if suggestion_type == 'swap_balance':
        s1_id = request.GET.get('s1')
        s2_id = request.GET.get('s2')
        try:
            if not s1_id or not s2_id:
                return JsonResponse({'status': 'error', 'message': '缺少学生参数'}, status=400)
            if str(s1_id) == str(s2_id):
                return JsonResponse({'status': 'error', 'message': '不能交换同一名学生'}, status=400)
            s1 = classroom.students.filter(pk=s1_id).first()
            s2 = classroom.students.filter(pk=s2_id).first()
            if not s1 or not s2:
                return JsonResponse({'status': 'error', 'message': '学生不属于当前班级'}, status=400)
            seat1 = getattr(s1, 'assigned_seat', None)
            seat2 = getattr(s2, 'assigned_seat', None)
            if not seat1 or not seat2:
                return JsonResponse({'status': 'error', 'message': '学生未入座，无法交换'}, status=400)
            if seat1.classroom_id != classroom.pk or seat2.classroom_id != classroom.pk:
                return JsonResponse({'status': 'error', 'message': '座位不属于当前班级'}, status=400)
            
            # 交换座位（违反约束则回滚）
            with transaction.atomic():
                _swap_seats(seat1, seat2)
                violations = _stabilize_layout_with_rules(classroom, request)
                if violations:
                    raise ValueError(f'交换失败：{_format_issues_preview(violations)}')
            return JsonResponse({'status': 'success', 'message': f'已执行交换并自动校正约束：{s1.name} / {s2.name}'})
        except ValueError as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
    
    return JsonResponse({'status': 'error', 'message': '未知建议'}, status=400)


@require_POST
def dismiss_suggestion(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    suggestion_type = request.GET.get('type')
    
    if suggestion_type == 'export':
        request.session[f'ignore_export_{pk}'] = True
        return JsonResponse({'status': 'success'})
        
    return JsonResponse({'status': 'success'})

@require_POST
def set_group_leader(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        data = json.loads(request.body)
        student_id = data.get('student_id')
        
        student = get_object_or_404(Student, pk=student_id, classroom=classroom)
        seat = getattr(student, 'assigned_seat', None)
        if not seat or not seat.group:
            return JsonResponse({'status': 'error', 'message': '该学生未分配或未在小组中'}, status=400)
            
        group = seat.group
        
        # Toggle: if already leader, unset
        if group.leader == student:
            group.leader = None
        else:
            group.leader = student
            
        group.save()
        
        return JsonResponse({'status': 'success'})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
