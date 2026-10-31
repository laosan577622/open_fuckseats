"""只参考已保存的布局快照，在原排座策略内尽量避免重复位置。"""

from collections import Counter, defaultdict

from .models import SeatCellType


ROTATION_HISTORY_LIMIT = 8


def _axis_regions(coordinates):
    coordinates = sorted(set(coordinates))
    count = len(coordinates)
    return {
        coordinate: (1 if count == 1 else index * 2 if count == 2 else index * 3 // count)
        for index, coordinate in enumerate(coordinates)
    }


def _layout_positions(cells, resolve_student):
    valid_cells = []
    for cell in cells:
        if not isinstance(cell, dict) or cell.get('cell_type', SeatCellType.SEAT) != SeatCellType.SEAT:
            continue
        try:
            row, col = int(cell['row']), int(cell['col'])
        except (KeyError, TypeError, ValueError):
            continue
        if row > 0 and col > 0:
            valid_cells.append({**cell, 'row': row, 'col': col})
    cells = valid_cells
    rows = _axis_regions(cell['row'] for cell in cells)
    cols = _axis_regions(cell['col'] for cell in cells)
    positions = {}
    for cell in cells:
        student_id = resolve_student(cell)
        if student_id is not None:
            positions[student_id] = (rows[cell['row']], cols[cell['col']], cell['row'], cell['col'])
    return positions


class RotationContext:
    def __init__(self, seats, students, snapshots=()):
        students = list(students)
        student_pks = {student.pk for student in students}
        by_student_id, by_name = defaultdict(list), defaultdict(list)
        for student in students:
            if student.student_id:
                by_student_id[str(student.student_id).strip()].append(student.pk)
            by_name[student.name].append(student.pk)

        def resolve_student(cell):
            try:
                pk = int(cell.get('student_pk'))
            except (ValueError, TypeError):
                pk = None
            if pk in student_pks:
                return pk
            student_id = str(cell.get('student_id') or '').strip()
            candidates = by_student_id.get(student_id, []) if student_id else by_name.get(cell.get('student_name'), [])
            return candidates[0] if len(candidates) == 1 else None

        self.previous = {}
        seat_cells = [seat for seat in seats if seat.cell_type == SeatCellType.SEAT]
        rows = _axis_regions(seat.row for seat in seat_cells)
        cols = _axis_regions(seat.col for seat in seat_cells)
        self.axis = 0 if len(rows) > 1 else 1 if len(cols) > 1 else 2
        self.regions = {seat.pk: (rows[seat.row], cols[seat.col]) for seat in seat_cells}
        self.visits = defaultdict(lambda: (Counter(), Counter()))
        self.snapshot_count = 0
        for state in snapshots:
            if not isinstance(state, dict) or not isinstance(state.get('seats'), list):
                continue
            if 'exam' in state:
                continue
            positions = _layout_positions(state['seats'], resolve_student)
            if not positions:
                continue
            self.snapshot_count += 1
            for student_id, position in positions.items():
                # 每个人以最近一次包含自己的正式快照为准，不读取临时座位。
                self.previous.setdefault(student_id, position)
                for axis in (0, 1):
                    self.visits[student_id][axis][position[axis]] += 1
            if self.snapshot_count >= ROTATION_HISTORY_LIMIT:
                break
        self._costs = {}

    def cost(self, student_id, seat):
        key = (student_id, seat.pk)
        if key not in self._costs:
            previous = self.previous.get(student_id)
            if previous is None:
                self._costs[key] = (0, 0, 0, 0, 0)
            else:
                row_region, col_region = self.regions[seat.pk]
                row_visits, col_visits = self.visits[student_id]
                self._costs[key] = (
                    int(previous[0] == row_region),
                    row_visits[row_region],
                    int(previous[1] == col_region),
                    col_visits[col_region],
                    int(previous[2:] == (seat.row, seat.col)),
                )
        return self._costs[key]

    def report(self, seats):
        compared = changed = moved = 0
        for seat in seats:
            previous = self.previous.get(seat.student_id)
            if previous is None or seat.cell_type != SeatCellType.SEAT:
                continue
            compared += 1
            moved += previous[2:] != (seat.row, seat.col)
            if self.axis < 2:
                changed += previous[self.axis] != self.regions[seat.pk][self.axis]
            else:
                changed += previous[2:] != (seat.row, seat.col)
        return {
            'compared': compared,
            'changed_region': changed,
            'unchanged_region': compared - changed,
            'changed_seat': moved,
            'snapshot_count': self.snapshot_count,
            'axis': ('front_back', 'left_right', 'seat')[self.axis],
        }

    def message(self, report):
        if not report['compared']:
            return '位置偏好：没有可匹配的已保存快照，已按原策略排座；可先保存正式布局快照'
        label = ('前中后区域', '左右区域', '座位')[self.axis]
        message = (f"位置偏好：对比 {report['snapshot_count']} 个快照，"
                   f"{report['changed_seat']}/{report['compared']} 人更换座位，"
                   f"{report['changed_region']}/{report['compared']} 人更换{label}")
        if report['unchanged_region']:
            message += '；已在原策略和约束范围内尽量换位'
        return message


def match_rotation_seats(students, seats, context, is_valid):
    """矩形最小费用匹配，避免两两交换无法消除的多人成环局部最优。"""
    count, capacity = len(students), len(seats)
    # 大布局沿用有计算上限的局部优化，避免阻塞桌面窗口。
    if not count or count > capacity or count * count * capacity > 8_000_000:
        return None
    costs = []
    for student in students:
        row = []
        for seat in seats:
            if not is_valid(student, seat):
                row.append(None)
                continue
            value = 0
            for part, upper_bound in zip(context.cost(student.pk, seat), (1, 9, 1, 9, 1)):
                # 每项权重高于所有学生的后续项之和，保留偏好的先后顺序。
                value = value * (count * upper_bound + 1) + part
            row.append(value)
        costs.append(row)
    infinity = (max((value for row in costs for value in row if value is not None), default=0) + 1) * (count + 1)
    row_potential = [0] * (count + 1)
    col_potential = [0] * (capacity + 1)
    matched_row = [0] * (capacity + 1)
    for row_index in range(1, count + 1):
        matched_row[0] = row_index
        current_col = 0
        distances = [infinity] * (capacity + 1)
        used = [False] * (capacity + 1)
        previous_col = [0] * (capacity + 1)
        while True:
            used[current_col] = True
            current_row = matched_row[current_col]
            delta, next_col = infinity, 0
            for col in range(1, capacity + 1):
                if used[col]:
                    continue
                value = costs[current_row - 1][col - 1]
                reduced = (infinity if value is None else value) - row_potential[current_row] - col_potential[col]
                if reduced < distances[col]:
                    distances[col] = reduced
                    previous_col[col] = current_col
                if distances[col] < delta:
                    delta, next_col = distances[col], col
            if delta >= infinity:
                return None
            for col in range(capacity + 1):
                if used[col]:
                    row_potential[matched_row[col]] += delta
                    col_potential[col] -= delta
                else:
                    distances[col] -= delta
            current_col = next_col
            if not matched_row[current_col]:
                break
        while current_col:
            source = previous_col[current_col]
            matched_row[current_col] = matched_row[source]
            current_col = source
    assignments = {students[row - 1].pk: seats[col - 1]
                   for col, row in enumerate(matched_row) if col and row}
    if any(not is_valid(student, assignments[student.pk]) for student in students):
        return None
    return assignments


def optimize_positions(students, seats, assignments, context, is_valid, *, preserve_rows=False, preserve_groups=False):
    if context is None or not context.previous:
        return

    def candidate_valid(student, seat):
        original = assignments.get(student.pk)
        if original is not None:
            if preserve_rows and original.row != seat.row:
                return False
            if preserve_groups and original.group_id != seat.group_id:
                return False
        return is_valid(student, seat, {})

    matched = match_rotation_seats(students, seats, context, candidate_valid)
    if matched is not None and all(is_valid(student, matched[student.pk], matched) for student in students):
        assignments.clear()
        assignments.update(matched)
