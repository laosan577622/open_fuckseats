"""自动排座的本地偏好及同桌搭配优化。"""

import json
import math

from .models import FrontendKVStore, SeatCellType


DEFAULT_PREFERENCES = {
    'gender': 'none',
    'score': 'none',
    'avoid_previous': False,
}
BUILTIN_METHODS = {
    'random', 'score_desc', 'score_asc', 'good_front', 'good_back',
    'score_spread', 'group_balanced', 'group_mentor',
}


def preferences_key(classroom):
    return f'fuckseats_arrange_preferences_{classroom.pk}'


def normalize_preferences(value):
    if not isinstance(value, dict):
        raise ValueError('偏好选项格式错误')
    if set(value) - set(DEFAULT_PREFERENCES):
        raise ValueError('包含不支持的偏好选项')
    result = {**DEFAULT_PREFERENCES, **value}
    if result['gender'] not in ('none', 'same', 'different'):
        raise ValueError('不支持的同桌性别偏好')
    if result['score'] not in ('none', 'similar', 'complementary'):
        raise ValueError('不支持的成绩搭配偏好')
    if not isinstance(result['avoid_previous'], bool):
        raise ValueError('更换同桌选项必须为布尔值')
    return result


def load_preferences(classroom):
    raw = FrontendKVStore.objects.filter(key=preferences_key(classroom)).values_list('value', flat=True).first()
    try:
        return normalize_preferences(json.loads(raw)) if raw else DEFAULT_PREFERENCES.copy()
    except (ValueError, TypeError):
        return DEFAULT_PREFERENCES.copy()


def save_preferences(classroom, value):
    preferences = normalize_preferences(value)
    FrontendKVStore.objects.update_or_create(
        key=preferences_key(classroom),
        defaults={'value': json.dumps(preferences)},
    )
    return preferences


def preferences_enabled(preferences):
    return preferences != DEFAULT_PREFERENCES


def desk_pairs(seats):
    """每段连续座位从左到右两两配对，不跨排、走廊或小组边界。"""
    pairs = []
    pending = None
    for seat in sorted(seats, key=lambda item: (item.row, item.col)):
        if seat.cell_type != SeatCellType.SEAT:
            pending = None
            continue
        if (pending and seat.row == pending.row and seat.col == pending.col + 1
                and seat.group_id == pending.group_id):
            pairs.append((pending, seat))
            pending = None
        else:
            pending = seat
    return pairs


def current_deskmates(seats):
    return {
        frozenset((left.student_id, right.student_id))
        for left, right in desk_pairs(seats)
        if left.student_id and right.student_id
    }


def _score(student):
    try:
        value = float(student.score)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def optimize_deskmates(students, seats, assignments, preferences, previous_pairs, is_valid,
                       *, preserve_rows=False, preserve_groups=False):
    """只接受改善偏好且不违反约束的交换；性别、更换同桌、成绩依次优先。"""
    if not preferences_enabled(preferences) or len(assignments) != len(students):
        return
    pairs = desk_pairs(seats)
    if not pairs:
        return
    student_map = {student.pk: student for student in students}
    occupants = {seat.pk: None for seat in seats}
    for student_id, seat in assignments.items():
        occupants[seat.pk] = student_id
    pair_by_seat = {seat.pk: index for index, pair in enumerate(pairs) for seat in pair}
    scores = {student.pk: _score(student) for student in students}
    known_scores = [value for value in scores.values() if value is not None]
    score_range = max(known_scores) - min(known_scores) if known_scores else 0
    score_range = score_range or 1

    def pair_cost(index):
        left, right = pairs[index]
        left_id, right_id = occupants[left.pk], occupants[right.pk]
        if not left_id or not right_id:
            return (0, 0, 0, 0)
        gender_cost = 0
        if preferences['gender'] != 'none':
            left_gender, right_gender = student_map[left_id].gender, student_map[right_id].gender
            if left_gender not in ('M', 'F') or right_gender not in ('M', 'F'):
                gender_cost = 0.5
            else:
                same = left_gender == right_gender
                gender_cost = int(same != (preferences['gender'] == 'same'))
        repeat_cost = int(preferences['avoid_previous'] and frozenset((left_id, right_id)) in previous_pairs)
        score_cost = 0
        if preferences['score'] != 'none':
            left_score, right_score = scores[left_id], scores[right_id]
            if left_score is None or right_score is None:
                score_cost = 0.5
            else:
                difference = abs(left_score - right_score) / score_range
                score_cost = difference if preferences['score'] == 'similar' else 1 - difference
        # 优先保留完整同桌，避免用拆成单人座的方式规避偏好。
        return (-1, gender_cost, repeat_cost, round(score_cost, 8))

    def cost(indices):
        costs = [pair_cost(index) for index in indices]
        return tuple(sum(item[part] for item in costs) for part in range(4))

    # 使用局部增量评分，不在交换循环中访问数据库；限制大布局的计算量。
    comparisons = 0
    for _ in range(6):
        changed = False
        for left_index, left in enumerate(seats):
            for right in seats[left_index + 1:]:
                comparisons += 1
                if comparisons > 100000:
                    return
                left_id, right_id = occupants[left.pk], occupants[right.pk]
                if left_id == right_id:
                    continue
                if preserve_rows and left.row != right.row:
                    continue
                if preserve_groups and left.group_id != right.group_id:
                    continue
                affected = {pair_by_seat[seat.pk] for seat in (left, right) if seat.pk in pair_by_seat}
                if not affected:
                    continue
                before = cost(affected)
                occupants[left.pk], occupants[right.pk] = right_id, left_id
                after = cost(affected)
                if after >= before:
                    occupants[left.pk], occupants[right.pk] = left_id, right_id
                    continue
                if left_id:
                    assignments[left_id] = right
                if right_id:
                    assignments[right_id] = left
                valid = (not left_id or is_valid(student_map[left_id], right, assignments)) and (
                    not right_id or is_valid(student_map[right_id], left, assignments))
                if valid:
                    changed = True
                else:
                    occupants[left.pk], occupants[right.pk] = left_id, right_id
                    if left_id:
                        assignments[left_id] = left
                    if right_id:
                        assignments[right_id] = right
        if not changed:
            break


def arrangement_message(seats, preferences, *, auto_fixed=False):
    message = '已自动调整并满足约束' if auto_fixed else '排座完成'
    if preferences['gender'] == 'none':
        return message
    occupied = [(left.student, right.student) for left, right in desk_pairs(seats)
                if left.student_id and right.student_id]
    if not occupied:
        return message + '；当前没有可配对的同桌'
    known = [(left, right) for left, right in occupied
             if left.gender in ('M', 'F') and right.gender in ('M', 'F')]
    matched = sum((left.gender == right.gender) == (preferences['gender'] == 'same') for left, right in known)
    label = '同性' if preferences['gender'] == 'same' else '异性'
    if known:
        message += f'；{label}同桌 {matched}/{len(known)} 对'
    unknown = len(occupied) - len(known)
    if unknown:
        message += f'；{unknown} 对同桌性别未填写完整'
    return message
