"""单科王同桌：每人取最高分的一科，同科的学生优先排成同桌。"""

import math
from collections import defaultdict

from .arrangement_preferences import desk_pairs
from .models import SeatCellType


METHOD = 'subject_champion'
MAX_SUBJECT_SCORE = 1000
# 自定义信息里的数值字段不一定是科目成绩，下列字段不参与比较。
NON_SUBJECT_KEYWORDS = (
    '总分', '总成绩', '总计', '合计', '平均', '均分', '排名', '名次', '位次', '序号', '编号', '学号',
    '考号', '座号', '座位', '班级', '年级', '年龄', '身高', '体重', '视力', '电话', '手机', '宿舍',
    '寝室', '学籍', '身份证', '证件', '日期', '生日', '时间', '房间',
)


def _subject_score(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, str):
        value = value.strip().removesuffix('分').strip()
        if not value:
            return None
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(score) or score < 0 or score > MAX_SUBJECT_SCORE:
        return None
    return score


def subject_scores(student):
    """返回学生自定义信息中可以当作科目成绩的字段，保持录入顺序。"""
    custom_data = getattr(student, 'custom_data', None)
    if not isinstance(custom_data, dict):
        return {}
    scores = {}
    for key, value in custom_data.items():
        name = str(key or '').strip()
        if not name or any(keyword in name for keyword in NON_SUBJECT_KEYWORDS):
            continue
        score = _subject_score(value)
        if score is not None:
            scores[name] = score
    return scores


def best_subject(student):
    """最高分科目；同分时取录入顺序靠前的一科。没有分科成绩时返回 None。"""
    best = None
    for name, score in subject_scores(student).items():
        if best is None or score > best[1]:
            best = (name, score)
    return best


def champion_subjects(students):
    return {
        student.pk: subject[0]
        for student in students
        if (subject := best_subject(student)) is not None
    }


def plan_subject_champions(students):
    """排出入座顺序：同科目两两相邻在前，各科落单的学生随后，没有分科成绩的排在最后。"""
    students = list(students)
    best = {student.pk: best_subject(student) for student in students}
    groups = defaultdict(list)
    without_subject = []
    for student in students:
        if best[student.pk] is None:
            without_subject.append(student)
        else:
            groups[best[student.pk][0]].append(student)

    paired, leftovers = [], []
    for subject in sorted(groups, key=lambda name: (-len(groups[name]), name)):
        members = sorted(groups[subject], key=lambda student: (-best[student.pk][1], student.pk))
        even = len(members) - len(members) % 2
        paired.extend(members[:even])
        leftovers.extend(members[even:])
    without_subject.sort(key=lambda student: student.pk)
    ordered = paired + leftovers + without_subject
    return ordered, {pk: value[0] for pk, value in best.items() if value is not None}


def champion_seat_order(seats):
    """同桌位在前、单人位在后，让按顺序入座的学生两两落在同一张桌上。"""
    seat_cells = [seat for seat in seats if seat.cell_type == SeatCellType.SEAT]
    pairs = desk_pairs(seat_cells)
    paired_ids = {seat.pk for pair in pairs for seat in pair}
    ordered = [seat for pair in pairs for seat in pair]
    ordered.extend(
        seat for seat in sorted(seat_cells, key=lambda item: (item.row, item.col))
        if seat.pk not in paired_ids
    )
    return ordered


def champion_report(seats):
    seats = list(seats)
    subjects = champion_subjects(seat.student for seat in seats if seat.student_id)
    occupied = [
        (left, right) for left, right in desk_pairs(seats)
        if left.student_id and right.student_id
    ]
    matched = sum(
        subjects.get(left.student_id) is not None
        and subjects.get(left.student_id) == subjects.get(right.student_id)
        for left, right in occupied
    )
    seated = [seat.student_id for seat in seats if seat.student_id]
    return {
        'pairs': len(occupied),
        'matched_pairs': matched,
        'students': len(seated),
        'without_subject': sum(student_id not in subjects for student_id in seated),
        'subjects': sorted(set(subjects.values())),
    }


def champion_message(report):
    if not report['pairs']:
        return '单科王同桌：当前布局没有可配对的同桌'
    message = f"单科王同桌：{report['matched_pairs']}/{report['pairs']} 对同桌最高分科目相同"
    if report['without_subject']:
        message += f"；{report['without_subject']} 人没有分科成绩"
    return message
