"""Separate exam workflow pages; mutations use CSRF and snapshot history."""
import json
from copy import deepcopy
from uuid import uuid4

from django.db import transaction
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_GET, require_POST

from .exam_planner import (PlanningError, Router, fingerprint, number_desks,
                           plan_exam, plan_restore, target_snapshot, validate_doors)
from .models import Classroom, LayoutSnapshot


def _body(request):
    try:
        body = json.loads(request.body)
    except (ValueError, UnicodeError):
        raise PlanningError('请求须为有效 JSON')
    if not isinstance(body, dict):
        raise PlanningError('请求须为 JSON 对象')
    return body


def _snapshot(classroom):
    from .views import _snapshot_payload
    return _snapshot_payload(classroom, include_students=False)


def _layout_identity(snapshot):
    """Physical origins and desk owners, independent of export-only metadata."""
    room = snapshot['classroom']
    seats = snapshot.get('seats')
    if not isinstance(seats, list) or any(not isinstance(s, dict) for s in seats):
        raise PlanningError('来源快照缺少有效的桌位信息')
    return fingerprint({'classroom': {key: room.get(key) for key in ('rows', 'cols')},
                        'seats': [{key: s.get(key, 'seat' if key == 'cell_type' else None)
                                   for key in ('row', 'col', 'cell_type', 'student_pk')}
                                  for s in seats]})


def _plan(classroom, plan_id):
    snapshot = get_object_or_404(LayoutSnapshot, classroom=classroom, pk=plan_id)
    if not isinstance(snapshot.data.get('exam'), dict):
        raise Http404('该快照不是考场方案')
    return snapshot


def _url(classroom, snapshot, stage='movement'):
    return reverse('exam_stage', args=[classroom.pk, snapshot.pk, stage])


@require_GET
def setup(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    snapshots = classroom.layout_snapshots.only('pk', 'name', 'created_at')
    source = _snapshot(classroom)
    current = fingerprint(source)
    plans = []
    for saved in snapshots.filter(data__has_key='exam')[:6]:
        exam = saved.data['exam']
        if not isinstance(exam, dict) or not isinstance(exam.get('plan'), dict):
            continue
        plans.append({'saved': saved, 'restore': exam['plan'].get('kind') == 'restore',
                      'applied': current == exam.get('applied_hash'),
                      'usable': current in (exam.get('active_hash'), exam.get('applied_hash'))})
    return render(request, 'seats/exam_setup.html', {
        'classroom': classroom, 'snapshots': snapshots.exclude(data__has_key='exam'),
        'plans': plans, 'source': source})


def doors(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    if request.method == 'GET':
        return redirect(f"{reverse('classroom_detail', args=[classroom.pk])}?cloud_sync=return#classroom-door-stage")
    if request.method != 'POST':
        return JsonResponse({'error': '请使用 POST 保存门'}, status=405)
    try:
        payload = _body(request)
        validated = validate_doors(payload.get('doors'))
        Router(2 * classroom.cols + 2, 2 * classroom.rows + 2, validated)
        with transaction.atomic():
            from .views import _capture_history_state, _push_snapshot_action
            classroom = Classroom.objects.select_for_update().get(pk=pk)
            if payload.get('previous') != classroom.doors:
                return JsonResponse({'error': '门设置已变化，请刷新后重试'}, status=409)
            before = _capture_history_state(classroom)
            classroom.doors = validated
            classroom.save(update_fields=['doors'])
            _push_snapshot_action(request, classroom, before, 'exam_doors')
        return JsonResponse({'doors': validated})
    except PlanningError as error:
        return JsonResponse({'error': str(error)}, status=400)


class SourceMismatch(PlanningError):
    pass


def _source(classroom, body):
    """Current classroom state, verified against an optional historical snapshot."""
    active = _snapshot(classroom)
    if body.get('snapshot_id'):
        source = deepcopy(get_object_or_404(LayoutSnapshot, classroom=classroom,
                                           pk=body['snapshot_id']).data)
        if not isinstance(source, dict) or not isinstance(source.get('classroom'), dict):
            raise PlanningError('来源快照缺少有效的教室信息')
        source.pop('exam', None)
        source['classroom']['doors'] = classroom.doors
        if _layout_identity(source) != _layout_identity(active):
            raise SourceMismatch('所选快照与当前教室桌位或学生位置不一致，请先恢复该快照，再生成搬运方案')
    # Keep current names, groups and other classroom data; an old snapshot
    # may describe the same origins while carrying stale non-layout fields.
    return active, deepcopy(active)


def _summary(plan):
    """Compact preview: where every original desk goes and how each target is filled."""
    carried = {task['desk_id'] for task in plan['tasks'] if task['action'] != 'import'}
    source, target = [], []
    for desk in plan['desks']:
        kind = 'import' if desk['action'] == 'import' else 'export' if desk['action'] == 'export' \
            else 'carry' if desk['id'] in carried else 'keep'
        name = (desk['source'] or {}).get('student_name') or ''
        if desk['position']:
            source.append({'row': desk['source']['row'], 'col': desk['source']['col'],
                           'kind': kind, 'name': name})
        if desk['target']:
            target.append({'row': desk['target']['row'], 'col': desk['target']['col'],
                           'kind': kind, 'name': name})
    return {'metrics': plan['metrics'], 'instructions': plan['instructions'],
            'source': source, 'target': target, 'rows': plan['rows'], 'cols': plan['cols']}


@require_POST
def estimate(request, pk):
    """Dry run for the setup page; nothing is saved."""
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        body = _body(request)
        _, source = _source(classroom, body)
        return JsonResponse(_summary(plan_exam(source, body.get('rows'), body.get('cols'))))
    except SourceMismatch as error:
        return JsonResponse({'error': str(error)}, status=409)
    except (PlanningError, TypeError, ValueError) as error:
        return JsonResponse({'error': str(error)}, status=400)


@require_POST
def generate(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        body = _body(request)
        active, source = _source(classroom, body)
        plan = plan_exam(source, body.get('rows'), body.get('cols'))
        data = target_snapshot(source, plan)
        data['exam'].update(source=source, active_hash=fingerprint(active), revision=1)
        with transaction.atomic():
            classroom = Classroom.objects.select_for_update().get(pk=pk)
            if fingerprint(_snapshot(classroom)) != fingerprint(active):
                return JsonResponse({'error': '生成期间教室发生变化，请重新生成'}, status=409)
            suffix = uuid4().hex[:8]
            LayoutSnapshot.objects.create(classroom=classroom, name=f'考场前原布局 {suffix}', data=active)
            saved = LayoutSnapshot.objects.create(classroom=classroom, name=f"考场 {plan['cols']}组×{plan['rows']}排 {suffix}", data=data)
        return JsonResponse({'id': saved.pk, 'url': _url(classroom, saved), 'metrics': plan['metrics']})
    except SourceMismatch as error:
        return JsonResponse({'error': str(error)}, status=409)
    except (PlanningError, TypeError, ValueError) as error:
        return JsonResponse({'error': str(error)}, status=400)


@require_GET
def stage(request, pk, plan_id, stage):
    if stage not in ('movement', 'numbering', 'result', 'print'):
        raise Http404()
    classroom = get_object_or_404(Classroom, pk=pk)
    saved = _plan(classroom, plan_id)
    exam = saved.data['exam']
    current_hash = fingerprint(_snapshot(classroom))
    stale = current_hash not in (exam['active_hash'], exam.get('applied_hash'))
    return render(request, 'seats/exam_stage.html', {
        'classroom': classroom, 'saved': saved, 'stage': stage, 'exam': exam,
        'stale': stale, 'applied': current_hash == exam.get('applied_hash'),
        'plan': exam['plan'], 'plan_json': {**exam['plan'], 'revision': exam['revision']},
    })


@require_POST
def numbering(request, pk, plan_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        body = _body(request)
        with transaction.atomic():
            saved = _plan(classroom, plan_id)
            exam = saved.data['exam']
            if body.get('revision') != exam['revision']:
                return JsonResponse({'error': '方案已更新，请刷新后重试'}, status=409)
            plan = exam['plan']
            if plan.get('kind') == 'restore':
                raise PlanningError('恢复日常布局不生成考场桌号')
            for field in ('reverse_rows', 'reverse_cols'):
                if not isinstance(body.get(field, False), bool):
                    raise PlanningError('编号方向须为布尔值')
            options = {key: body[key] for key in ('mode', 'start', 'reverse_rows', 'reverse_cols', 'snake_axis') if key in body}
            plan['numbering'] = number_desks(plan['rows'], plan['cols'], **options)
            plan['numbering_options'] = options
            exam['revision'] += 1
            saved.save(update_fields=['data'])
        return JsonResponse({'url': _url(classroom, saved, 'result')})
    except PlanningError as error:
        return JsonResponse({'error': str(error)}, status=400)


@require_POST
def restore(request, pk, plan_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        body = _body(request)
        saved = _plan(classroom, plan_id)
        exam = saved.data['exam']
        current = _snapshot(classroom)
        if body.get('revision') != exam['revision'] or fingerprint(current) != exam.get('applied_hash'):
            return JsonResponse({'error': '当前教室与已应用考场不一致，请先核对布局'}, status=409)
        if exam['plan'].get('kind') == 'restore':
            raise PlanningError('当前已经是恢复方案')
        plan = plan_restore(current, exam['source'], exam['plan'])
        target = deepcopy(exam['source'])
        target['exam'] = {'source': current, 'plan': plan, 'version': 1,
                          'active_hash': fingerprint(current), 'revision': 1}
        with transaction.atomic():
            classroom = Classroom.objects.select_for_update().get(pk=pk)
            if fingerprint(_snapshot(classroom)) != fingerprint(current):
                return JsonResponse({'error': '规划期间教室发生变化，请重新生成恢复方案'}, status=409)
            result = LayoutSnapshot.objects.create(classroom=classroom,
                name=f'考后恢复 {uuid4().hex[:8]}', data=target)
        return JsonResponse({'url': _url(classroom, result)})
    except PlanningError as error:
        return JsonResponse({'error': str(error)}, status=400)


@require_POST
def apply(request, pk, plan_id):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        body = _body(request)
        with transaction.atomic():
            classroom = Classroom.objects.select_for_update().get(pk=pk)
            saved = _plan(classroom, plan_id)
            exam = saved.data['exam']
            if body.get('revision') != exam['revision']:
                return JsonResponse({'error': '方案已更新，请刷新后重试'}, status=409)
            current = fingerprint(_snapshot(classroom))
            if current == exam.get('applied_hash'):
                return JsonResponse({'url': _url(classroom, saved, 'result')})
            if current != exam['active_hash']:
                return JsonResponse({'error': '教室已变化，请重新生成方案'}, status=409)
            from .views import _apply_layout_data, _capture_history_state, _push_snapshot_action
            before = _capture_history_state(classroom)
            _apply_layout_data(classroom, saved.data)
            exam['applied_hash'] = fingerprint(_snapshot(classroom))
            saved.save(update_fields=['data'])
            _push_snapshot_action(request, classroom, before, 'exam_apply')
        return JsonResponse({'url': _url(classroom, saved, 'result')})
    except PlanningError as error:
        return JsonResponse({'error': str(error)}, status=400)


def active_exam(classroom, seats, snapshots):
    """Latest applied exam whose desk positions are the classroom's current desks.

    Desk numbers belong to positions, so students swapped inside the exam
    layout keep showing the number of the desk they now sit at.
    """
    current = {(s.row, s.col) for s in seats if s.cell_type == 'seat'}
    # The page already lists snapshot names; only exam plans (named by
    # generate()) are loaded with their data, so ordinary pages stay cheap.
    candidates = [item.pk for item in snapshots if item.name.startswith('考场 ')][:20]
    if not current or not candidates:
        return None
    for saved in classroom.layout_snapshots.filter(pk__in=candidates):
        exam = saved.data.get('exam')
        plan = exam.get('plan') if isinstance(exam, dict) else None
        if not isinstance(plan, dict) or plan.get('kind') == 'restore' or not exam.get('applied_hash'):
            continue
        positions = {(d['target']['row'], d['target']['col']): (d['target']['position'][1] // 2,
                                                                  d['target']['position'][0] // 2)
                     for d in plan.get('desks', []) if d.get('target')}
        if set(positions.values()) != current:
            continue
        numbers = {positions[(n['row'], n['col'])]: n['number'] for n in plan.get('numbering', [])
                   if (n['row'], n['col']) in positions}
        width = max(2, len(str(max(numbers.values(), default=0))))
        return {'snapshot': saved, 'numbers': {key: str(value).zfill(width) for key, value in numbers.items()}}
    return None
