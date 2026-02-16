from django.shortcuts import render, redirect, get_object_or_404
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_POST
from django.db import transaction, models
from django.utils import timezone
from django.urls import reverse
from django.utils.encoding import escape_uri_path
from .models import Classroom, Student, Seat, SeatCellType, SeatGroup, LayoutSnapshot, SeatConstraint
import pandas as pd
import json
import random
import openpyxl
from openpyxl.styles import Alignment, Border, Side, Font, PatternFill
from openpyxl.utils import get_column_letter


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
    return True


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
    return True


def _apply_group_batch_action(classroom, action, forward=True):
    items = action.get('items', [])
    for item in items:
        row = item.get('row')
        col = item.get('col')
        seat = classroom.seats.filter(row=row, col=col).first()
        if not seat:
            continue
        target_group_id = item.get('after_group_id') if forward else item.get('before_group_id')
        if target_group_id:
            seat.group = classroom.groups.filter(pk=target_group_id).first()
        else:
            seat.group = None
        seat.save(update_fields=['group'])
    return True


def _evaluate_layout(classroom, request=None):
    issues = []
    seats = list(classroom.seats.select_related('student', 'group'))
    seat_map = _build_seat_map(seats)
    student_seat = {seat.student_id: seat for seat in seats if seat.student_id}

    unseated_count = classroom.students.filter(assigned_seat__isnull=True).count()
    if unseated_count:
        issues.append(f"当前有 {unseated_count} 名学生未入座")

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

    pass # 此部分代码未被披露至开源版本

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

    filtered_issues = []
    for issue in issues:
        if isinstance(issue, str):
            pass # 此部分代码未被披露至开源版本
        elif isinstance(issue, dict):
            if 'message' in issue:
                pass # 此部分代码未被披露至开源版本
        filtered_issues.append(issue)

    return filtered_issues


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


def import_students(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    
    if request.method == 'POST':
        action = request.POST.get('action', 'upload')
        
        # 处理第一次上传
        if action == 'upload' and request.FILES.get('excel_file'):
            excel_file = request.FILES['excel_file']
            clear_existing = request.POST.get('clear_existing') == '1'
            
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

                    count = _process_import(classroom, df, name_col, student_id_col, gender_col, score_col, clear_existing)
                    return JsonResponse({'status': 'success', 'message': f'成功导入 {count} 名学生'})
                
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
                
                count = _process_import(classroom, df_data, name_col, None, None, score_col, clear_existing)
                
                # 清理文件
                os.remove(temp_path)
                
                return JsonResponse({'status': 'success', 'message': f'成功导入 {count} 名学生'})
            except Exception as e:
                return JsonResponse({'status': 'error', 'message': str(e)}, status=400)

    return redirect('classroom_detail', pk=pk)


def _process_import(classroom, df, name_col, student_id_col, gender_col, score_col, clear_existing):
    if clear_existing:
        classroom.students.all().delete()
    
    count = 0
    with transaction.atomic():
        for _, row in df.iterrows():
            name = row[name_col]
            if pd.isna(name) or str(name).strip() == '':
                continue
                
            # 处理可能的标题行混入（如果手动选择时不准确）
            if str(name).strip() in ['姓名', 'Name']: 
                continue

            student_id = row.get(student_id_col, '') if student_id_col is not None else ''
            gender_raw = row.get(gender_col, '') if gender_col is not None else ''
            score = row.get(score_col, 0) if score_col is not None else 0

            gender = 'M' if gender_raw == '男' else 'F' if gender_raw == '女' else None
            score_value = score if pd.notna(score) else 0
            if isinstance(score_value, str):
                try:
                    score_value = float(score_value.strip())
                except Exception:
                    score_value = 0

            Student.objects.create(
                classroom=classroom,
                name=str(name).strip(),
                student_id=str(student_id).strip() if pd.notna(student_id) else '',
                gender=gender,
                score=score_value
            )
            count += 1
    return count


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


pass # 此部分代码未被披露至开源版本
    



def _seat_is_valid(student, seat, assignments, maps):
    fixed_seats, must_rows, must_cols, forbid_rows, forbid_cols, forbid_seats, must_pairs, forbid_pairs = maps
    sid = student.pk

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


def _assign_pairs(students, seats, seat_map, assignments, maps):
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
                        if _seat_is_valid(student, seat, assignments, maps):
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
                if not _seat_is_valid(student, seat, assignments, maps):
                    continue
                for r in range(-dist, dist + 1):
                    for c in range(-dist, dist + 1):
                        if abs(r) + abs(c) > dist:
                            continue
                        neighbor = seat_map.get((seat.row + r, seat.col + c))
                        if neighbor and neighbor in available_set:
                            if _seat_is_valid(other_student, neighbor, assignments, maps):
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

    remaining_students = [s for s in students if s.pk not in assignments]
    remaining_seats = [seat for seat in seats if seat not in assignments.values()]
    for student, seat in zip(remaining_students, remaining_seats):
        assignments[student.pk] = seat

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

    Seat.objects.filter(classroom=classroom).update(student=None)

    assigned_ids = set()
    for group in groups:
        seats = group_seats.get(group.pk, [])
        bucket = group_buckets[group.pk]
        
        # 分配座位
        for seat, student in zip(seats, bucket):
            seat.student = student
            seat.save(update_fields=['student'])
            assigned_ids.add(student.pk)

    remaining_students = [s for s in students if s.pk not in assigned_ids]
    if remaining_students:
        remaining_seats = list(classroom.seats.filter(cell_type=SeatCellType.SEAT, student__isnull=True).order_by('row', 'col'))
        for seat, student in zip(remaining_seats, remaining_students):
            seat.student = student
            seat.save(update_fields=['student'])

    return True


def auto_arrange_seats(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    if request.method == 'POST':
        method = request.POST.get('method', 'random')

        students = list(classroom.students.all())
        seats = list(classroom.seats.select_related('student'))
        seat_cells = [s for s in seats if s.cell_type == SeatCellType.SEAT]

        if len(seat_cells) < len(students):
            message = f'可用座位不足(座位:{len(seat_cells)} < 学生:{len(students)})，无法保证100%入座，请在布局编辑中增加座位。'
            if request.headers.get('x-requested-with') == 'XMLHttpRequest':
                return JsonResponse({'status': 'error', 'message': message}, status=400)
            return HttpResponse(message, status=400)
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
            if _arrange_grouped(classroom, students, method):
                pass # 此部分代码未被披露至开源版本
                _reset_history(request, pk)
                if request.headers.get('x-requested-with') == 'XMLHttpRequest':
                    return JsonResponse({'status': 'success'})
                return redirect('classroom_detail', pk=pk)
            if request.headers.get('x-requested-with') == 'XMLHttpRequest':
                return JsonResponse({'status': 'error', 'message': '未设置小组或小组没有座位'}, status=400)
            return redirect('classroom_detail', pk=pk)

        _arrange_standard(classroom, students, seats, method)
        pass # 此部分代码未被披露至开源版本
        _reset_history(request, pk)
        if request.headers.get('x-requested-with') == 'XMLHttpRequest':
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

            action = _perform_move(classroom, student, target_seat)
            _push_action(request, pk, action)
            return JsonResponse({'status': 'success'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
    return JsonResponse({'status': 'error'}, status=400)


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
        if seat.student:
            student = seat.student
            led_group = getattr(student, 'led_group', None)
            if led_group:
                led_group.leader = None
                led_group.save(update_fields=['leader'])
        
        seat.student = None
        seat.save(update_fields=['student'])
        _push_action(request, pk, action)
        return JsonResponse({'status': 'success'})
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
        action = _perform_move(classroom, student, target_seat)
        _push_action(request, pk, action)
        return JsonResponse({'status': 'success'})
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
        return redirect('classroom_detail', pk=pk)
    SeatGroup.objects.get_or_create(classroom=classroom, name=name)
    return redirect('classroom_detail', pk=pk)


@require_POST
def rename_group(request, pk, group_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    group = get_object_or_404(SeatGroup, classroom=classroom, pk=group_id)
    new_name = request.POST.get('name')
    if new_name:
        group.name = new_name.strip()
        group.save()
    return redirect('classroom_detail', pk=pk)


@require_POST
def delete_group(request, pk, group_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    group = get_object_or_404(SeatGroup, pk=group_id, classroom=classroom)
    group.delete()
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
        if group_id:
            group = get_object_or_404(SeatGroup, pk=group_id, classroom=classroom)
            seat.group = group
        else:
            seat.group = None
        seat.save(update_fields=['group'])
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
        for seat_data in seats_payload:
            row = int(seat_data.get('row'))
            col = int(seat_data.get('col'))
            seat = classroom.seats.filter(row=row, col=col).first()
            if not seat or seat.cell_type != SeatCellType.SEAT:
                continue
            before_group_id = seat.group.pk if seat.group else None
            seat.group = group
            seat.save(update_fields=['group'])
            items.append({
                'row': row,
                'col': col,
                'before_group_id': before_group_id,
                'after_group_id': group.pk if group else None
            })

        if items:
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
    except Exception:
        pass
    return redirect('classroom_detail', pk=pk)


@require_POST
def delete_constraint(request, pk, constraint_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    constraint = get_object_or_404(SeatConstraint, pk=constraint_id, classroom=classroom)
    constraint.delete()
    return redirect('classroom_detail', pk=pk)


def export_students(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    
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
    font_name = 'HarmonyOS Sans SC' 
    header_font = Font(name=font_name, bold=True, size=20)
    normal_font = Font(name=font_name, size=12)
    podium_font = Font(name=font_name, bold=True, size=14)
    seat_font = Font(name=font_name, size=12, bold=False)
    note_font = Font(name=font_name, size=10, color="808080")
    
    # 标题
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=classroom.cols)
    cell = ws.cell(row=1, column=1, value=f"{classroom.name} 座位表")
    cell.font = header_font
    cell.alignment = center_align
    ws.row_dimensions[1].height = 40
    
    # 讲台
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=classroom.cols)
    cell = ws.cell(row=2, column=1, value="讲台")
    cell.font = podium_font
    cell.alignment = center_align
    ws.row_dimensions[2].height = 30
    
    seats = classroom.seats.select_related('student').all()
    seat_map = _build_seat_map(seats)
    
    start_row = 3
    
    for r in range(1, classroom.rows + 1):
        ws.row_dimensions[start_row + r - 1].height = 50
        for c in range(1, classroom.cols + 1):
            cell = ws.cell(row=start_row + r - 1, column=c)
            seat = seat_map.get((r, c))
            
            value = ""
            is_seat = False
            if seat:
                if seat.cell_type == SeatCellType.SEAT:
                    is_seat = True
                    if seat.student:
                        value = seat.student.name
                    else:
                        value = "" # 空座位空白
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
            
            # 设置列宽（近似值）
            ws.column_dimensions[get_column_letter(c)].width = 14

    ws.column_dimensions[get_column_letter(c)].width = 14
        
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
    response['Content-Disposition'] = f'attachment; filename="{classroom.name}_座次图.xlsx"'
    wb.save(response)

    return response


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
    font_name = 'HarmonyOS Sans SC'
    group_font = Font(name=font_name, bold=True, size=13)
    name_font  = Font(name=font_name, size=11)
    center     = Alignment(horizontal='center', vertical='center')

    # 页眉
    # &"Font,Bold"&Size Title
    header_text = f"&\"{font_name},Bold\"&14{classroom.name} (          ) 登记表"
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
    elif action['type'] == 'cell_type':
        _apply_cell_type_action(classroom, action, forward=False)
    elif action['type'] == 'group':
        _apply_group_action(classroom, action, forward=False)
    elif action['type'] == 'group_batch':
        _apply_group_batch_action(classroom, action, forward=False)
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
    elif action['type'] == 'cell_type':
        _apply_cell_type_action(classroom, action, forward=True)
    elif action['type'] == 'group':
        _apply_group_action(classroom, action, forward=True)
    elif action['type'] == 'group_batch':
        _apply_group_batch_action(classroom, action, forward=True)
    history['undo'].append(action)
    request.session.modified = True
    return JsonResponse({'status': 'success'})


def delete_classroom(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    classroom.delete()
    return redirect('index')


@require_POST
def apply_suggestion(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    suggestion_type = request.GET.get('type')
    
    pass # 此部分代码未被披露至开源版本
    
    if suggestion_type == 'swap_balance':
        s1_id = request.GET.get('s1')
        s2_id = request.GET.get('s2')
        try:
            s1 = Student.objects.get(pk=s1_id)
            s2 = Student.objects.get(pk=s2_id)
            seat1 = getattr(s1, 'assigned_seat', None)
            seat2 = getattr(s2, 'assigned_seat', None)
            
            # 交换座位
            _swap_seats(seat1, seat2)
            return JsonResponse({'status': 'success', 'message': f'已交换 {s1.name} 和 {s2.name}'})
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
