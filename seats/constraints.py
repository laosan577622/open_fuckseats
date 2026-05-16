from __future__ import annotations

from collections import defaultdict

from django.urls import reverse

from .models import SeatCellType, SeatConstraint, Student, StudentTag, StudentTagRule


class ConstraintServiceError(ValueError):
    """Raised when constraint data is invalid or cannot be applied."""


CONSTRAINT_TYPE_DEFINITIONS = (
    {
        "value": SeatConstraint.ConstraintType.MUST_SEAT,
        "label": "指定座位",
        "description": "学生必须坐在指定座位",
        "needs_row": True,
        "needs_col": True,
        "needs_target": False,
        "needs_distance": False,
    },
    {
        "value": SeatConstraint.ConstraintType.FORBID_SEAT,
        "label": "禁用座位",
        "description": "学生不能坐在指定座位",
        "needs_row": True,
        "needs_col": True,
        "needs_target": False,
        "needs_distance": False,
    },
    {
        "value": SeatConstraint.ConstraintType.MUST_ROW,
        "label": "指定行",
        "description": "学生只能坐在指定行",
        "needs_row": True,
        "needs_col": False,
        "needs_target": False,
        "needs_distance": False,
    },
    {
        "value": SeatConstraint.ConstraintType.FORBID_ROW,
        "label": "禁用行",
        "description": "学生不能坐在指定行",
        "needs_row": True,
        "needs_col": False,
        "needs_target": False,
        "needs_distance": False,
    },
    {
        "value": SeatConstraint.ConstraintType.MUST_COL,
        "label": "指定列",
        "description": "学生只能坐在指定列",
        "needs_row": False,
        "needs_col": True,
        "needs_target": False,
        "needs_distance": False,
    },
    {
        "value": SeatConstraint.ConstraintType.FORBID_COL,
        "label": "禁用列",
        "description": "学生不能坐在指定列",
        "needs_row": False,
        "needs_col": True,
        "needs_target": False,
        "needs_distance": False,
    },
    {
        "value": SeatConstraint.ConstraintType.MUST_TOGETHER,
        "label": "指定相邻",
        "description": "两名学生的距离必须不大于指定值",
        "needs_row": False,
        "needs_col": False,
        "needs_target": True,
        "needs_distance": True,
    },
    {
        "value": SeatConstraint.ConstraintType.FORBID_TOGETHER,
        "label": "禁止相邻",
        "description": "两名学生的距离必须大于指定值",
        "needs_row": False,
        "needs_col": False,
        "needs_target": True,
        "needs_distance": True,
    },
)

CONSTRAINT_TYPE_MAP = {item["value"]: item for item in CONSTRAINT_TYPE_DEFINITIONS}
PAIR_CONSTRAINT_TYPES = {
    SeatConstraint.ConstraintType.MUST_TOGETHER,
    SeatConstraint.ConstraintType.FORBID_TOGETHER,
}
SEAT_CONSTRAINT_TYPES = {
    SeatConstraint.ConstraintType.MUST_SEAT,
    SeatConstraint.ConstraintType.FORBID_SEAT,
}
ROW_CONSTRAINT_TYPES = {
    SeatConstraint.ConstraintType.MUST_ROW,
    SeatConstraint.ConstraintType.FORBID_ROW,
}
COL_CONSTRAINT_TYPES = {
    SeatConstraint.ConstraintType.MUST_COL,
    SeatConstraint.ConstraintType.FORBID_COL,
}
ISSUE_SEVERITY_ORDER = {"invalid": 0, "conflict": 1, "duplicate": 2, "violated": 3}

TAG_RULE_TYPE_DEFINITIONS = (
    {
        "value": StudentTagRule.RuleType.MUST_AREA,
        "label": "只能坐区域",
        "description": "带有该标签的学生只能坐在指定行列范围内，可只填行或只填列。",
        "needs_area": True,
        "needs_distance": False,
    },
    {
        "value": StudentTagRule.RuleType.FORBID_AREA,
        "label": "禁坐区域",
        "description": "带有该标签的学生不能坐在指定行列范围内，可只填行或只填列。",
        "needs_area": True,
        "needs_distance": False,
    },
    {
        "value": StudentTagRule.RuleType.SEPARATE_SAME_TAG,
        "label": "同标签保持距离",
        "description": "带有同一标签的学生两两之间必须大于指定曼哈顿距离。",
        "needs_area": False,
        "needs_distance": True,
    },
)
TAG_RULE_TYPE_MAP = {item["value"]: item for item in TAG_RULE_TYPE_DEFINITIONS}


def get_constraint_type_definitions():
    return [dict(item) for item in CONSTRAINT_TYPE_DEFINITIONS]


def get_tag_rule_type_definitions():
    return [dict(item) for item in TAG_RULE_TYPE_DEFINITIONS]


def _to_bool(value, default=True):
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_positive_int(raw_value, label, *, required=False, default=None):
    if raw_value in (None, ""):
        if required:
            raise ConstraintServiceError(f"{label}不能为空")
        return default
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        raise ConstraintServiceError(f"{label}必须是整数")
    if value <= 0:
        raise ConstraintServiceError(f"{label}必须大于 0")
    return value


def _parse_nonnegative_int(raw_value, label, *, default=0):
    if raw_value in (None, ""):
        return default
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        raise ConstraintServiceError(f"{label}必须是整数")
    if value < 0:
        raise ConstraintServiceError(f"{label}不能小于 0")
    return value


def _resolve_student(classroom, raw_value, label, *, required=False):
    if raw_value in (None, ""):
        if required:
            raise ConstraintServiceError(f"{label}不能为空")
        return None
    if isinstance(raw_value, Student):
        student = raw_value
    else:
        try:
            student_id = int(raw_value)
        except (TypeError, ValueError):
            raise ConstraintServiceError(f"{label}无效")
        student = classroom.students.filter(pk=student_id).first()
    if not student or student.classroom_id != classroom.pk:
        raise ConstraintServiceError(f"{label}不属于当前班级")
    return student


def _resolve_tag(classroom, raw_value, label, *, required=False):
    if raw_value in (None, ""):
        if required:
            raise ConstraintServiceError(f"{label}不能为空")
        return None
    if isinstance(raw_value, StudentTag):
        tag = raw_value
    else:
        try:
            tag_id = int(raw_value)
        except (TypeError, ValueError):
            tag_name = str(raw_value or "").strip()
            tag = classroom.student_tags.filter(name=tag_name).first()
        else:
            tag = classroom.student_tags.filter(pk=tag_id).first()
    if not tag or tag.classroom_id != classroom.pk:
        raise ConstraintServiceError(f"{label}不属于当前班级")
    return tag


def _parse_optional_axis_range(payload, min_key, max_key, limit, label):
    raw_min = payload.get(min_key)
    raw_max = payload.get(max_key)
    if raw_min in (None, "") and raw_max in (None, ""):
        return None, None
    start = _parse_positive_int(raw_min if raw_min not in (None, "") else raw_max, f"{label}起点", required=True)
    end = _parse_positive_int(raw_max if raw_max not in (None, "") else raw_min, f"{label}终点", required=True)
    if start > end:
        raise ConstraintServiceError(f"{label}起点不能大于终点")
    if end > limit:
        raise ConstraintServiceError(f"{label}超出当前布局范围（1-{limit}）")
    return start, end


def _axis_values(start, end):
    if start in (None, "") or end in (None, ""):
        return None
    return range(int(start), int(end) + 1)


def _area_has_seat(classroom, row_min=None, row_max=None, col_min=None, col_max=None):
    queryset = classroom.seats.filter(cell_type=SeatCellType.SEAT)
    if row_min is not None:
        queryset = queryset.filter(row__gte=row_min, row__lte=row_max)
    if col_min is not None:
        queryset = queryset.filter(col__gte=col_min, col__lte=col_max)
    return queryset.exists()


def _tag_rule_area_label(rule_or_record):
    row_min = rule_or_record.get("row_min") if isinstance(rule_or_record, dict) else rule_or_record.row_min
    row_max = rule_or_record.get("row_max") if isinstance(rule_or_record, dict) else rule_or_record.row_max
    col_min = rule_or_record.get("col_min") if isinstance(rule_or_record, dict) else rule_or_record.col_min
    col_max = rule_or_record.get("col_max") if isinstance(rule_or_record, dict) else rule_or_record.col_max
    parts = []
    if row_min is not None and row_max is not None:
        parts.append(f"{row_min}-{row_max} 行" if row_min != row_max else f"第 {row_min} 行")
    if col_min is not None and col_max is not None:
        parts.append(f"{col_min}-{col_max} 列" if col_min != col_max else f"第 {col_min} 列")
    return "，".join(parts) or "未指定区域"


def _has_seat_in_row(classroom, row):
    return classroom.seats.filter(row=row, cell_type=SeatCellType.SEAT).exists()


def _has_seat_in_col(classroom, col):
    return classroom.seats.filter(col=col, cell_type=SeatCellType.SEAT).exists()


def _seat_cell(classroom, row, col):
    return classroom.seats.filter(row=row, col=col).first()


def _seat_positions(classroom):
    return list(classroom.seats.filter(cell_type=SeatCellType.SEAT).values_list("row", "col"))


def _has_any_pair_within_distance(classroom, distance):
    positions = _seat_positions(classroom)
    if len(positions) < 2:
        return False
    for index, (row_a, col_a) in enumerate(positions):
        for row_b, col_b in positions[index + 1 :]:
            if abs(row_a - row_b) + abs(col_a - col_b) <= distance:
                return True
    return False


def _has_any_pair_beyond_distance(classroom, distance):
    positions = _seat_positions(classroom)
    if len(positions) < 2:
        return False
    for index, (row_a, col_a) in enumerate(positions):
        for row_b, col_b in positions[index + 1 :]:
            if abs(row_a - row_b) + abs(col_a - col_b) > distance:
                return True
    return False


def normalize_constraint_payload(classroom, payload, *, instance=None):
    constraint_type = str(payload.get("constraint_type") or "").strip()
    config = CONSTRAINT_TYPE_MAP.get(constraint_type)
    if not config:
        raise ConstraintServiceError("约束类型无效")

    student = _resolve_student(classroom, payload.get("student") or payload.get("student_id"), "学生", required=True)
    target_student = _resolve_student(
        classroom,
        payload.get("target_student") or payload.get("target_student_id"),
        "关联学生",
        required=config["needs_target"],
    )
    if target_student and target_student.pk == student.pk:
        raise ConstraintServiceError("关联学生不能和当前学生相同")

    row = _parse_positive_int(payload.get("row"), "行", required=config["needs_row"])
    col = _parse_positive_int(payload.get("col"), "列", required=config["needs_col"])
    distance = _parse_positive_int(
        payload.get("distance"),
        "距离",
        required=config["needs_distance"],
        default=1,
    )
    enabled = _to_bool(payload.get("enabled"), default=True if instance is None else instance.enabled)
    note = str(payload.get("note") or "").strip()
    note_max_length = SeatConstraint._meta.get_field("note").max_length
    if len(note) > note_max_length:
        raise ConstraintServiceError(f"备注不能超过 {note_max_length} 个字符")

    if row is not None and row > classroom.rows:
        raise ConstraintServiceError(f"行超出当前布局范围（1-{classroom.rows}）")
    if col is not None and col > classroom.cols:
        raise ConstraintServiceError(f"列超出当前布局范围（1-{classroom.cols}）")

    if constraint_type in SEAT_CONSTRAINT_TYPES:
        seat = _seat_cell(classroom, row, col)
        if not seat or seat.cell_type != SeatCellType.SEAT:
            raise ConstraintServiceError("目标位置不是可用座位")
    if constraint_type in ROW_CONSTRAINT_TYPES and not _has_seat_in_row(classroom, row):
        raise ConstraintServiceError("目标行当前没有可用座位")
    if constraint_type in COL_CONSTRAINT_TYPES and not _has_seat_in_col(classroom, col):
        raise ConstraintServiceError("目标列当前没有可用座位")

    if constraint_type == SeatConstraint.ConstraintType.MUST_TOGETHER and not _has_any_pair_within_distance(classroom, distance):
        raise ConstraintServiceError("当前布局中不存在满足该距离要求的双人座位组合")
    if constraint_type == SeatConstraint.ConstraintType.FORBID_TOGETHER and not _has_any_pair_beyond_distance(classroom, distance):
        raise ConstraintServiceError("当前布局中不存在满足该间隔要求的双人座位组合")

    if constraint_type in PAIR_CONSTRAINT_TYPES and target_student and target_student.pk < student.pk:
        student, target_student = target_student, student

    if not config["needs_target"]:
        target_student = None
    if not config["needs_row"]:
        row = None
    if not config["needs_col"]:
        col = None
    if not config["needs_distance"]:
        distance = 1

    return {
        "constraint_type": constraint_type,
        "student": student,
        "target_student": target_student,
        "row": row,
        "col": col,
        "distance": distance,
        "enabled": enabled,
        "note": note,
    }


def normalize_tag_rule_payload(classroom, payload, *, instance=None):
    rule_type = str(payload.get("rule_type") or "").strip()
    config = TAG_RULE_TYPE_MAP.get(rule_type)
    if not config:
        raise ConstraintServiceError("标签规则类型无效")

    tag = _resolve_tag(classroom, payload.get("tag") or payload.get("tag_id"), "标签", required=True)
    row_min, row_max = _parse_optional_axis_range(payload, "row_min", "row_max", classroom.rows, "行")
    col_min, col_max = _parse_optional_axis_range(payload, "col_min", "col_max", classroom.cols, "列")
    distance = _parse_positive_int(
        payload.get("distance"),
        "距离",
        required=config["needs_distance"],
        default=1,
    )
    enabled = _to_bool(payload.get("enabled"), default=True if instance is None else instance.enabled)
    priority = _parse_nonnegative_int(payload.get("priority"), "优先级", default=0)
    note = str(payload.get("note") or "").strip()
    note_max_length = StudentTagRule._meta.get_field("note").max_length
    if len(note) > note_max_length:
        raise ConstraintServiceError(f"备注不能超过 {note_max_length} 个字符")

    if config["needs_area"]:
        if row_min is None and col_min is None:
            raise ConstraintServiceError("标签区域规则至少需要设置行范围或列范围")
        if not _area_has_seat(classroom, row_min=row_min, row_max=row_max, col_min=col_min, col_max=col_max):
            raise ConstraintServiceError("标签规则区域当前没有可用座位")
    else:
        row_min = row_max = col_min = col_max = None

    if not config["needs_distance"]:
        distance = 1

    return {
        "tag": tag,
        "rule_type": rule_type,
        "row_min": row_min,
        "row_max": row_max,
        "col_min": col_min,
        "col_max": col_max,
        "distance": distance,
        "enabled": enabled,
        "priority": priority,
        "note": note,
    }


def _constraint_record(raw_constraint):
    if isinstance(raw_constraint, dict):
        data = dict(raw_constraint)
        constraint_type = data["constraint_type"]
        student = data["student"]
        target_student = data.get("target_student")
        return {
            "pk": data.get("pk"),
            "constraint_type": constraint_type,
            "constraint_type_display": CONSTRAINT_TYPE_MAP.get(constraint_type, {}).get("label", constraint_type),
            "student_id": student.pk,
            "student_name": student.name,
            "target_student_id": target_student.pk if target_student else None,
            "target_student_name": target_student.name if target_student else "",
            "row": data.get("row"),
            "col": data.get("col"),
            "distance": int(data.get("distance") or 1),
            "enabled": bool(data.get("enabled", True)),
            "note": str(data.get("note") or ""),
            "object": data.get("object"),
        }
    return {
        "pk": raw_constraint.pk,
        "constraint_type": raw_constraint.constraint_type,
        "constraint_type_display": raw_constraint.get_constraint_type_display(),
        "student_id": raw_constraint.student_id,
        "student_name": raw_constraint.student.name,
        "target_student_id": raw_constraint.target_student_id,
        "target_student_name": raw_constraint.target_student.name if raw_constraint.target_student else "",
        "row": raw_constraint.row,
        "col": raw_constraint.col,
        "distance": int(raw_constraint.distance or 1),
        "enabled": bool(raw_constraint.enabled),
        "note": str(raw_constraint.note or ""),
        "object": raw_constraint,
    }


def _record_signature(record):
    pair_key = None
    if record["constraint_type"] in PAIR_CONSTRAINT_TYPES and record["target_student_id"]:
        pair_key = tuple(sorted((record["student_id"], record["target_student_id"])))
    return (
        record["constraint_type"],
        pair_key if pair_key is not None else record["student_id"],
        record["target_student_id"] if pair_key is None else None,
        record["row"],
        record["col"],
        int(record["distance"] or 1),
    )


def _record_summary(record):
    constraint_type = record["constraint_type"]
    student_name = record["student_name"]
    target_name = record["target_student_name"]
    row = record["row"]
    col = record["col"]
    distance = int(record["distance"] or 1)
    if constraint_type == SeatConstraint.ConstraintType.MUST_SEAT:
        return f"{student_name} 固定在 {row} 行 {col} 列"
    if constraint_type == SeatConstraint.ConstraintType.FORBID_SEAT:
        return f"{student_name} 不可坐 {row} 行 {col} 列"
    if constraint_type == SeatConstraint.ConstraintType.MUST_ROW:
        return f"{student_name} 只能坐第 {row} 行"
    if constraint_type == SeatConstraint.ConstraintType.FORBID_ROW:
        return f"{student_name} 不可坐第 {row} 行"
    if constraint_type == SeatConstraint.ConstraintType.MUST_COL:
        return f"{student_name} 只能坐第 {col} 列"
    if constraint_type == SeatConstraint.ConstraintType.FORBID_COL:
        return f"{student_name} 不可坐第 {col} 列"
    if constraint_type == SeatConstraint.ConstraintType.MUST_TOGETHER:
        return f"{student_name} 与 {target_name} 距离不超过 {distance}"
    if constraint_type == SeatConstraint.ConstraintType.FORBID_TOGETHER:
        return f"{student_name} 与 {target_name} 距离必须大于 {distance}"
    return f"{student_name} - {record['constraint_type_display']}"


def _issue(issue_type, message):
    return {"type": issue_type, "message": message}


def _append_issue(issue_map, pk, issue):
    if pk is None:
        return
    bucket = issue_map[pk]
    key = (issue["type"], issue["message"])
    if key not in bucket["seen"]:
        bucket["seen"].add(key)
        bucket["issues"].append(issue)


def _pairwise_constraint_issues(left, right):
    issues = []
    left_type = left["constraint_type"]
    right_type = right["constraint_type"]

    if _record_signature(left) == _record_signature(right):
        issues.append(("duplicate", "已存在完全相同的约束"))
        return issues

    if (
        left_type == SeatConstraint.ConstraintType.MUST_SEAT
        and right_type == SeatConstraint.ConstraintType.MUST_SEAT
        and left["student_id"] != right["student_id"]
        and left["row"] == right["row"]
        and left["col"] == right["col"]
    ):
        issues.append(("conflict", "两个学生不能同时被固定到同一个座位"))

    same_student = left["student_id"] == right["student_id"]
    same_pair = (
        left["constraint_type"] in PAIR_CONSTRAINT_TYPES
        and right["constraint_type"] in PAIR_CONSTRAINT_TYPES
        and tuple(sorted((left["student_id"], left["target_student_id"] or 0)))
        == tuple(sorted((right["student_id"], right["target_student_id"] or 0)))
    )

    if same_student:
        if (
            left_type == SeatConstraint.ConstraintType.MUST_SEAT
            and right_type == SeatConstraint.ConstraintType.MUST_SEAT
            and (left["row"], left["col"]) != (right["row"], right["col"])
        ):
            issues.append(("conflict", "同一学生不能同时指定多个固定座位"))

        if left_type == SeatConstraint.ConstraintType.MUST_ROW and right_type == SeatConstraint.ConstraintType.MUST_ROW:
            if left["row"] != right["row"]:
                issues.append(("conflict", "同一学生不能同时指定多个不同行"))

        if left_type == SeatConstraint.ConstraintType.MUST_COL and right_type == SeatConstraint.ConstraintType.MUST_COL:
            if left["col"] != right["col"]:
                issues.append(("conflict", "同一学生不能同时指定多个不同列"))

        if {
            left_type,
            right_type,
        } == {SeatConstraint.ConstraintType.MUST_ROW, SeatConstraint.ConstraintType.FORBID_ROW}:
            must_row = left["row"] if left_type == SeatConstraint.ConstraintType.MUST_ROW else right["row"]
            forbid_row = left["row"] if left_type == SeatConstraint.ConstraintType.FORBID_ROW else right["row"]
            if must_row == forbid_row:
                issues.append(("conflict", "同一行不能同时被指定和禁用"))

        if {
            left_type,
            right_type,
        } == {SeatConstraint.ConstraintType.MUST_COL, SeatConstraint.ConstraintType.FORBID_COL}:
            must_col = left["col"] if left_type == SeatConstraint.ConstraintType.MUST_COL else right["col"]
            forbid_col = left["col"] if left_type == SeatConstraint.ConstraintType.FORBID_COL else right["col"]
            if must_col == forbid_col:
                issues.append(("conflict", "同一列不能同时被指定和禁用"))

        if {
            left_type,
            right_type,
        } == {SeatConstraint.ConstraintType.MUST_SEAT, SeatConstraint.ConstraintType.FORBID_SEAT}:
            must_pos = (left["row"], left["col"]) if left_type == SeatConstraint.ConstraintType.MUST_SEAT else (right["row"], right["col"])
            forbid_pos = (left["row"], left["col"]) if left_type == SeatConstraint.ConstraintType.FORBID_SEAT else (right["row"], right["col"])
            if must_pos == forbid_pos:
                issues.append(("conflict", "同一座位不能同时被指定和禁用"))

        if left_type == SeatConstraint.ConstraintType.MUST_SEAT and right_type == SeatConstraint.ConstraintType.MUST_ROW:
            if left["row"] != right["row"]:
                issues.append(("conflict", "固定座位所在行与指定行不一致"))
        if left_type == SeatConstraint.ConstraintType.MUST_ROW and right_type == SeatConstraint.ConstraintType.MUST_SEAT:
            if left["row"] != right["row"]:
                issues.append(("conflict", "固定座位所在行与指定行不一致"))

        if left_type == SeatConstraint.ConstraintType.MUST_SEAT and right_type == SeatConstraint.ConstraintType.FORBID_ROW:
            if left["row"] == right["row"]:
                issues.append(("conflict", "固定座位所在行被禁用"))
        if left_type == SeatConstraint.ConstraintType.FORBID_ROW and right_type == SeatConstraint.ConstraintType.MUST_SEAT:
            if left["row"] == right["row"]:
                issues.append(("conflict", "固定座位所在行被禁用"))

        if left_type == SeatConstraint.ConstraintType.MUST_SEAT and right_type == SeatConstraint.ConstraintType.MUST_COL:
            if left["col"] != right["col"]:
                issues.append(("conflict", "固定座位所在列与指定列不一致"))
        if left_type == SeatConstraint.ConstraintType.MUST_COL and right_type == SeatConstraint.ConstraintType.MUST_SEAT:
            if left["col"] != right["col"]:
                issues.append(("conflict", "固定座位所在列与指定列不一致"))

        if left_type == SeatConstraint.ConstraintType.MUST_SEAT and right_type == SeatConstraint.ConstraintType.FORBID_COL:
            if left["col"] == right["col"]:
                issues.append(("conflict", "固定座位所在列被禁用"))
        if left_type == SeatConstraint.ConstraintType.FORBID_COL and right_type == SeatConstraint.ConstraintType.MUST_SEAT:
            if left["col"] == right["col"]:
                issues.append(("conflict", "固定座位所在列被禁用"))

    if same_pair:
        must_distance = None
        forbid_distance = None
        if left_type == SeatConstraint.ConstraintType.MUST_TOGETHER:
            must_distance = left["distance"]
        if right_type == SeatConstraint.ConstraintType.MUST_TOGETHER:
            must_distance = right["distance"]
        if left_type == SeatConstraint.ConstraintType.FORBID_TOGETHER:
            forbid_distance = left["distance"]
        if right_type == SeatConstraint.ConstraintType.FORBID_TOGETHER:
            forbid_distance = right["distance"]
        if must_distance is not None and forbid_distance is not None and forbid_distance >= must_distance:
            issues.append(("conflict", "双人约束冲突：既要求靠近，又要求至少保持更大距离"))

    return issues


def _current_violation_message(record, student_seat_map):
    constraint_type = record["constraint_type"]
    student_name = record["student_name"]
    seat = student_seat_map.get(record["student_id"])

    if constraint_type == SeatConstraint.ConstraintType.MUST_SEAT:
        if not seat or seat.row != record["row"] or seat.col != record["col"]:
            return f"{student_name} 未坐在指定座位"
        return ""
    if constraint_type == SeatConstraint.ConstraintType.FORBID_SEAT:
        if seat and seat.row == record["row"] and seat.col == record["col"]:
            return f"{student_name} 坐到了禁用座位"
        return ""
    if constraint_type == SeatConstraint.ConstraintType.MUST_ROW:
        if not seat or seat.row != record["row"]:
            return f"{student_name} 未坐在指定行"
        return ""
    if constraint_type == SeatConstraint.ConstraintType.FORBID_ROW:
        if seat and seat.row == record["row"]:
            return f"{student_name} 坐到了禁用行"
        return ""
    if constraint_type == SeatConstraint.ConstraintType.MUST_COL:
        if not seat or seat.col != record["col"]:
            return f"{student_name} 未坐在指定列"
        return ""
    if constraint_type == SeatConstraint.ConstraintType.FORBID_COL:
        if seat and seat.col == record["col"]:
            return f"{student_name} 坐到了禁用列"
        return ""
    if constraint_type in PAIR_CONSTRAINT_TYPES:
        target_seat = student_seat_map.get(record["target_student_id"])
        if not seat or not target_seat:
            return f"{record['student_name']} 与 {record['target_student_name']} 未同时入座"
        distance = abs(seat.row - target_seat.row) + abs(seat.col - target_seat.col)
        if constraint_type == SeatConstraint.ConstraintType.MUST_TOGETHER and distance > record["distance"]:
            return f"{record['student_name']} 与 {record['target_student_name']} 未满足相邻要求"
        if constraint_type == SeatConstraint.ConstraintType.FORBID_TOGETHER and distance <= record["distance"]:
            return f"{record['student_name']} 与 {record['target_student_name']} 距离过近"
    return ""


def build_constraint_diagnostics(classroom, constraints=None):
    if constraints is None:
        constraints = classroom.constraints.select_related("student", "target_student").all()
    records = [_constraint_record(item) for item in constraints]
    issue_map = defaultdict(lambda: {"issues": [], "seen": set()})

    for record in records:
        constraint_type = record["constraint_type"]
        if constraint_type in SEAT_CONSTRAINT_TYPES:
            seat = _seat_cell(classroom, record["row"], record["col"])
            if not seat or seat.cell_type != SeatCellType.SEAT:
                _append_issue(issue_map, record["pk"], _issue("invalid", "目标位置已不是可用座位"))
        if constraint_type in ROW_CONSTRAINT_TYPES and not _has_seat_in_row(classroom, record["row"]):
            _append_issue(issue_map, record["pk"], _issue("invalid", "目标行当前没有可用座位"))
        if constraint_type in COL_CONSTRAINT_TYPES and not _has_seat_in_col(classroom, record["col"]):
            _append_issue(issue_map, record["pk"], _issue("invalid", "目标列当前没有可用座位"))
        if constraint_type == SeatConstraint.ConstraintType.MUST_TOGETHER and not _has_any_pair_within_distance(classroom, record["distance"]):
            _append_issue(issue_map, record["pk"], _issue("invalid", "当前布局中不存在满足该距离要求的双人座位组合"))
        if constraint_type == SeatConstraint.ConstraintType.FORBID_TOGETHER and not _has_any_pair_beyond_distance(classroom, record["distance"]):
            _append_issue(issue_map, record["pk"], _issue("invalid", "当前布局中不存在满足该间隔要求的双人座位组合"))

    active_records = [record for record in records if record["enabled"]]
    for index, left in enumerate(active_records):
        for right in active_records[index + 1 :]:
            for issue_type, message in _pairwise_constraint_issues(left, right):
                left_message = message
                right_message = message
                if issue_type in {"duplicate", "conflict"}:
                    left_message = f"{message}：{_record_summary(right)}"
                    right_message = f"{message}：{_record_summary(left)}"
                _append_issue(issue_map, left["pk"], _issue(issue_type, left_message))
                _append_issue(issue_map, right["pk"], _issue(issue_type, right_message))

    student_seat_map = {
        seat.student_id: seat
        for seat in classroom.seats.select_related("student").filter(student__isnull=False)
    }
    for record in active_records:
        violation = _current_violation_message(record, student_seat_map)
        if violation:
            _append_issue(issue_map, record["pk"], _issue("violated", violation))

    diagnostics = {}
    for record in records:
        issues = issue_map[record["pk"]]["issues"]
        issues.sort(key=lambda item: (ISSUE_SEVERITY_ORDER.get(item["type"], 99), item["message"]))
        issue_types = [item["type"] for item in issues]
        if not record["enabled"]:
            status = "disabled"
        elif any(item_type in {"invalid", "conflict", "duplicate"} for item_type in issue_types):
            status = "error"
        elif "violated" in issue_types:
            status = "warning"
        else:
            status = "ok"
        diagnostics[record["pk"]] = {
            "status": status,
            "issues": issues,
            "summary": _record_summary(record),
        }
    return diagnostics


def validate_constraint_candidate(classroom, cleaned_payload, *, instance=None):
    if not cleaned_payload.get("enabled", True):
        return cleaned_payload

    candidate = _constraint_record(
        {
            **cleaned_payload,
            "pk": getattr(instance, "pk", None),
            "object": instance,
        }
    )

    existing_constraints = classroom.constraints.select_related("student", "target_student").all()
    for existing in existing_constraints:
        if instance is not None and existing.pk == instance.pk:
            continue
        other = _constraint_record(existing)
        if not other["enabled"]:
            continue
        pair_issues = _pairwise_constraint_issues(candidate, other)
        if pair_issues:
            issue_type, message = pair_issues[0]
            label = _record_summary(other)
            if issue_type == "duplicate":
                raise ConstraintServiceError(f"已存在相同约束：{label}")
            raise ConstraintServiceError(f"{message}：{label}")
    return cleaned_payload


def _tag_rule_member_ids(rule):
    tag = getattr(rule, "tag", None)
    if not tag:
        return []
    memberships = getattr(tag, "_prefetched_objects_cache", {}).get("memberships")
    if memberships is not None:
        return [
            membership.student_id
            for membership in memberships
            if membership.classroom_id == rule.classroom_id
        ]
    return list(tag.memberships.filter(classroom_id=rule.classroom_id).values_list("student_id", flat=True))


def _apply_tag_rule_to_maps(rule, must_rows, must_cols, forbid_rows, forbid_cols, forbid_seats, forbid_pairs):
    if not getattr(rule, "enabled", True):
        return
    student_ids = [int(student_id) for student_id in _tag_rule_member_ids(rule) if student_id]
    if not student_ids:
        return

    row_values = _axis_values(rule.row_min, rule.row_max)
    col_values = _axis_values(rule.col_min, rule.col_max)

    if rule.rule_type == StudentTagRule.RuleType.MUST_AREA:
        if row_values is not None:
            for student_id in student_ids:
                must_rows[student_id].update(row_values)
        if col_values is not None:
            for student_id in student_ids:
                must_cols[student_id].update(col_values)
        return

    if rule.rule_type == StudentTagRule.RuleType.FORBID_AREA:
        if row_values is not None and col_values is None:
            for student_id in student_ids:
                forbid_rows[student_id].update(row_values)
            return
        if col_values is not None and row_values is None:
            for student_id in student_ids:
                forbid_cols[student_id].update(col_values)
            return
        if row_values is not None and col_values is not None:
            blocked_positions = {(row, col) for row in row_values for col in col_values}
            for student_id in student_ids:
                forbid_seats[student_id].update(blocked_positions)
        return

    if rule.rule_type == StudentTagRule.RuleType.SEPARATE_SAME_TAG:
        distance = int(rule.distance or 1)
        for index, left_id in enumerate(student_ids):
            for right_id in student_ids[index + 1 :]:
                forbid_pairs[left_id].add((right_id, distance))
                forbid_pairs[right_id].add((left_id, distance))


def compile_constraint_maps(classroom, constraints=None, tag_rules=None):
    fixed_seats = {}
    must_rows = defaultdict(set)
    must_cols = defaultdict(set)
    forbid_rows = defaultdict(set)
    forbid_cols = defaultdict(set)
    forbid_seats = defaultdict(set)
    must_pairs = defaultdict(set)
    forbid_pairs = defaultdict(set)

    if constraints is None:
        constraints = classroom.constraints.filter(enabled=True)

    for raw_constraint in constraints:
        constraint = _constraint_record(raw_constraint)
        if not constraint["enabled"]:
            continue
        student_id = constraint["student_id"]
        constraint_type = constraint["constraint_type"]
        if constraint_type == SeatConstraint.ConstraintType.MUST_SEAT and constraint["row"] and constraint["col"]:
            fixed_seats.setdefault(student_id, (constraint["row"], constraint["col"]))
        elif constraint_type == SeatConstraint.ConstraintType.FORBID_SEAT and constraint["row"] and constraint["col"]:
            forbid_seats[student_id].add((constraint["row"], constraint["col"]))
        elif constraint_type == SeatConstraint.ConstraintType.MUST_ROW and constraint["row"]:
            must_rows[student_id].add(constraint["row"])
        elif constraint_type == SeatConstraint.ConstraintType.FORBID_ROW and constraint["row"]:
            forbid_rows[student_id].add(constraint["row"])
        elif constraint_type == SeatConstraint.ConstraintType.MUST_COL and constraint["col"]:
            must_cols[student_id].add(constraint["col"])
        elif constraint_type == SeatConstraint.ConstraintType.FORBID_COL and constraint["col"]:
            forbid_cols[student_id].add(constraint["col"])
        elif constraint_type in PAIR_CONSTRAINT_TYPES and constraint["target_student_id"]:
            pair = (constraint["target_student_id"], int(constraint["distance"] or 1))
            reverse_pair = (student_id, int(constraint["distance"] or 1))
            if constraint_type == SeatConstraint.ConstraintType.MUST_TOGETHER:
                must_pairs[student_id].add(pair)
                must_pairs[constraint["target_student_id"]].add(reverse_pair)
            else:
                forbid_pairs[student_id].add(pair)
                forbid_pairs[constraint["target_student_id"]].add(reverse_pair)

    if tag_rules is None:
        tag_rules = (
            classroom.student_tag_rules
            .filter(enabled=True)
            .select_related("tag")
            .prefetch_related("tag__memberships")
        )

    for rule in tag_rules:
        _apply_tag_rule_to_maps(rule, must_rows, must_cols, forbid_rows, forbid_cols, forbid_seats, forbid_pairs)

    return (
        fixed_seats,
        dict(must_rows),
        dict(must_cols),
        dict(forbid_rows),
        dict(forbid_cols),
        dict(forbid_seats),
        {key: list(value) for key, value in must_pairs.items()},
        {key: list(value) for key, value in forbid_pairs.items()},
    )


def serialize_constraint(classroom, constraint, diagnostics=None):
    record = _constraint_record(constraint)
    diagnostics = diagnostics or {"status": "ok", "issues": [], "summary": _record_summary(record)}
    return {
        "pk": record["pk"],
        "constraint_type": record["constraint_type"],
        "constraint_type_display": record["constraint_type_display"],
        "student_pk": record["student_id"],
        "student_name": record["student_name"],
        "target_student_pk": record["target_student_id"],
        "target_student_name": record["target_student_name"],
        "row": record["row"],
        "col": record["col"],
        "distance": record["distance"],
        "enabled": record["enabled"],
        "note": record["note"],
        "summary": diagnostics["summary"],
        "status": diagnostics["status"],
        "issues": list(diagnostics["issues"]),
        "issue_count": len(diagnostics["issues"]),
        "delete_url": reverse("delete_constraint", args=[classroom.pk, record["pk"]]) if record["pk"] else "",
        "update_url": reverse("update_constraint", args=[classroom.pk, record["pk"]]) if record["pk"] else "",
        "toggle_url": reverse("toggle_constraint", args=[classroom.pk, record["pk"]]) if record["pk"] else "",
    }


def serialize_constraints(classroom, constraints=None):
    if constraints is None:
        constraints = classroom.constraints.select_related("student", "target_student").all()
    constraints = list(constraints)
    diagnostics = build_constraint_diagnostics(classroom, constraints)
    items = [serialize_constraint(classroom, constraint, diagnostics.get(constraint.pk)) for constraint in constraints]
    metrics = {
        "total": len(items),
        "enabled": sum(1 for item in items if item["enabled"]),
        "disabled": sum(1 for item in items if not item["enabled"]),
        "with_issues": sum(1 for item in items if item["issue_count"] > 0),
        "violated": sum(1 for item in items if any(issue["type"] == "violated" for issue in item["issues"])),
    }
    return items, metrics


def _tag_rule_record(raw_rule):
    return {
        "pk": raw_rule.pk,
        "rule_type": raw_rule.rule_type,
        "rule_type_display": raw_rule.get_rule_type_display(),
        "tag_id": raw_rule.tag_id,
        "tag_name": raw_rule.tag.name,
        "tag_color": raw_rule.tag.color,
        "row_min": raw_rule.row_min,
        "row_max": raw_rule.row_max,
        "col_min": raw_rule.col_min,
        "col_max": raw_rule.col_max,
        "distance": int(raw_rule.distance or 1),
        "enabled": bool(raw_rule.enabled),
        "priority": int(raw_rule.priority or 0),
        "note": str(raw_rule.note or ""),
        "object": raw_rule,
    }


def _seat_matches_tag_rule_area(seat, record):
    if not seat:
        return False
    row_min = record["row_min"]
    row_max = record["row_max"]
    col_min = record["col_min"]
    col_max = record["col_max"]
    if row_min is not None and not (row_min <= seat.row <= row_max):
        return False
    if col_min is not None and not (col_min <= seat.col <= col_max):
        return False
    return True


def _tag_rule_summary(record):
    tag_name = record["tag_name"]
    if record["rule_type"] == StudentTagRule.RuleType.MUST_AREA:
        return f"“{tag_name}”只能坐：{_tag_rule_area_label(record)}"
    if record["rule_type"] == StudentTagRule.RuleType.FORBID_AREA:
        return f"“{tag_name}”禁坐：{_tag_rule_area_label(record)}"
    if record["rule_type"] == StudentTagRule.RuleType.SEPARATE_SAME_TAG:
        return f"“{tag_name}”同标签距离必须大于 {record['distance']}"
    return f"“{tag_name}”{record['rule_type_display']}"


def build_tag_rule_diagnostics(classroom, tag_rules=None):
    if tag_rules is None:
        tag_rules = classroom.student_tag_rules.select_related("tag").prefetch_related("tag__memberships").all()
    tag_rules = list(tag_rules)
    records = [_tag_rule_record(rule) for rule in tag_rules]
    issue_map = defaultdict(lambda: {"issues": [], "seen": set()})
    student_ids = set()
    rule_members = {}

    for record in records:
        rule = record["object"]
        member_ids = [int(student_id) for student_id in _tag_rule_member_ids(rule) if student_id]
        rule_members[record["pk"]] = member_ids
        student_ids.update(member_ids)

        if record["rule_type"] in {StudentTagRule.RuleType.MUST_AREA, StudentTagRule.RuleType.FORBID_AREA}:
            if not _area_has_seat(
                classroom,
                row_min=record["row_min"],
                row_max=record["row_max"],
                col_min=record["col_min"],
                col_max=record["col_max"],
            ):
                _append_issue(issue_map, record["pk"], _issue("invalid", "标签规则区域当前没有可用座位"))

    seat_map = {
        seat.student_id: seat
        for seat in classroom.seats.select_related("student").filter(student_id__in=list(student_ids))
    }
    student_map = {student.pk: student for student in classroom.students.filter(pk__in=list(student_ids))}

    for record in records:
        if not record["enabled"]:
            continue
        member_ids = rule_members.get(record["pk"], [])
        if record["rule_type"] == StudentTagRule.RuleType.MUST_AREA:
            for student_id in member_ids:
                seat = seat_map.get(student_id)
                if seat and not _seat_matches_tag_rule_area(seat, record):
                    student = student_map.get(student_id)
                    if student:
                        _append_issue(
                            issue_map,
                            record["pk"],
                            _issue("violated", f"{student.name} 带有“{record['tag_name']}”标签，未坐在要求区域"),
                        )
        elif record["rule_type"] == StudentTagRule.RuleType.FORBID_AREA:
            for student_id in member_ids:
                seat = seat_map.get(student_id)
                if seat and _seat_matches_tag_rule_area(seat, record):
                    student = student_map.get(student_id)
                    if student:
                        _append_issue(
                            issue_map,
                            record["pk"],
                            _issue("violated", f"{student.name} 带有“{record['tag_name']}”标签，坐到了禁坐区域"),
                        )
        elif record["rule_type"] == StudentTagRule.RuleType.SEPARATE_SAME_TAG:
            distance_limit = int(record["distance"] or 1)
            for index, left_id in enumerate(member_ids):
                left_seat = seat_map.get(left_id)
                if not left_seat:
                    continue
                for right_id in member_ids[index + 1 :]:
                    right_seat = seat_map.get(right_id)
                    if not right_seat:
                        continue
                    distance = abs(left_seat.row - right_seat.row) + abs(left_seat.col - right_seat.col)
                    if distance <= distance_limit:
                        left_student = student_map.get(left_id)
                        right_student = student_map.get(right_id)
                        if left_student and right_student:
                            _append_issue(
                                issue_map,
                                record["pk"],
                                _issue(
                                    "violated",
                                    f"{left_student.name} 与 {right_student.name} 同为“{record['tag_name']}”，距离过近",
                                ),
                            )

    diagnostics = {}
    for record in records:
        issues = issue_map[record["pk"]]["issues"]
        issues.sort(key=lambda item: (ISSUE_SEVERITY_ORDER.get(item["type"], 99), item["message"]))
        issue_types = [item["type"] for item in issues]
        if not record["enabled"]:
            status = "disabled"
        elif any(item_type in {"invalid", "conflict", "duplicate"} for item_type in issue_types):
            status = "error"
        elif "violated" in issue_types:
            status = "warning"
        else:
            status = "ok"
        diagnostics[record["pk"]] = {
            "status": status,
            "issues": issues,
            "summary": _tag_rule_summary(record),
            "student_count": len(rule_members.get(record["pk"], [])),
        }
    return diagnostics


def serialize_tag_rule(classroom, tag_rule, diagnostics=None):
    record = _tag_rule_record(tag_rule)
    diagnostics = diagnostics or {
        "status": "ok",
        "issues": [],
        "summary": _tag_rule_summary(record),
        "student_count": 0,
    }
    return {
        "pk": record["pk"],
        "rule_type": record["rule_type"],
        "rule_type_display": record["rule_type_display"],
        "tag_id": record["tag_id"],
        "tag_name": record["tag_name"],
        "tag_color": record["tag_color"],
        "row_min": record["row_min"],
        "row_max": record["row_max"],
        "col_min": record["col_min"],
        "col_max": record["col_max"],
        "distance": record["distance"],
        "enabled": record["enabled"],
        "priority": record["priority"],
        "note": record["note"],
        "summary": diagnostics["summary"],
        "status": diagnostics["status"],
        "issues": list(diagnostics["issues"]),
        "issue_count": len(diagnostics["issues"]),
        "student_count": diagnostics.get("student_count", 0),
        "delete_url": reverse("delete_tag_rule", args=[classroom.pk, record["pk"]]) if record["pk"] else "",
        "update_url": reverse("update_tag_rule", args=[classroom.pk, record["pk"]]) if record["pk"] else "",
        "toggle_url": reverse("toggle_tag_rule", args=[classroom.pk, record["pk"]]) if record["pk"] else "",
    }


def serialize_tag_rules(classroom, tag_rules=None):
    if tag_rules is None:
        tag_rules = classroom.student_tag_rules.select_related("tag").prefetch_related("tag__memberships").all()
    tag_rules = list(tag_rules)
    diagnostics = build_tag_rule_diagnostics(classroom, tag_rules)
    items = [serialize_tag_rule(classroom, rule, diagnostics.get(rule.pk)) for rule in tag_rules]
    metrics = {
        "total": len(items),
        "enabled": sum(1 for item in items if item["enabled"]),
        "disabled": sum(1 for item in items if not item["enabled"]),
        "with_issues": sum(1 for item in items if item["issue_count"] > 0),
        "violated": sum(1 for item in items if any(issue["type"] == "violated" for issue in item["issues"])),
    }
    return items, metrics


def tag_rule_issue_messages(classroom, tag_rules=None):
    if tag_rules is None:
        tag_rules = classroom.student_tag_rules.select_related("tag").prefetch_related("tag__memberships").all()
    tag_rules = list(tag_rules)
    diagnostics = build_tag_rule_diagnostics(classroom, tag_rules)
    messages = []
    for rule in tag_rules:
        if not rule.enabled:
            continue
        for issue in diagnostics.get(rule.pk, {}).get("issues", []):
            messages.append(issue["message"])
    return messages


def constraint_issue_messages(classroom, constraints=None):
    if constraints is None:
        constraints = classroom.constraints.select_related("student", "target_student").all()
    constraints = list(constraints)
    diagnostics = build_constraint_diagnostics(classroom, constraints)
    messages = []
    for constraint in constraints:
        if not constraint.enabled:
            continue
        for issue in diagnostics.get(constraint.pk, {}).get("issues", []):
            messages.append(issue["message"])
    return messages
