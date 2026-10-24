"""Deterministic exam layout planning on an explicitly schematic floor grid.

Adjacent desk cells touch. Routes connect cell centres through actual empty
cells, aisles and the front/back passage; midpoints are animation samples only.
Coordinates are schematic, not a survey of physical room dimensions.
Routes are planned against changing occupancy, then compacted using swept-edge
and stationary occupancy intervals. A conservative validated schedule remains
the bounded fallback. No globally optimal multi-agent routing claim is made.
"""
from collections import defaultdict, deque
from bisect import bisect_left, insort
from copy import deepcopy
from heapq import heappop, heappush
import hashlib
import json


class PlanningError(ValueError):
    pass


MAX_DESKS = 1600
MAX_DIMENSION = 128
MAX_SEARCH_NODES = 2_000_000
MAX_SCHEDULE_COMPARISONS = 10_000_000
CORNERS = ('front_left', 'front_right', 'back_left', 'back_right')


def integer(value, label, minimum=1, maximum=MAX_DIMENSION):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise PlanningError(f'{label}须为 {minimum}～{maximum} 的整数')
    return value


def validate_doors(doors):
    if not isinstance(doors, list):
        raise PlanningError('门设置须为列表')
    result, ids = [], set()
    for i, door in enumerate(doors):
        if not isinstance(door, dict) or door.get('corner') not in CORNERS:
            raise PlanningError('门须位于教室四角区域')
        key = str(door.get('id', i + 1))
        if not key or key in ids:
            raise PlanningError('门的标识不能为空或重复')
        ids.add(key)
        result.append({'id': key, 'name': str(door.get('name') or f'门 {i + 1}')[:80],
                       'corner': door['corner'],
                       'offset': integer(door.get('offset', 0), '门偏移', 0)})
    return result


def fingerprint(snapshot):
    """Export timestamps are deliberately excluded from stale-plan detection."""
    data = deepcopy(snapshot)
    data.pop('meta', None)
    data.pop('exam', None)
    for key in ('seats', 'groups', 'students', 'constraints'):
        if isinstance(data.get(key), list):
            data[key].sort(key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()


def number_desks(rows, cols, mode='column', start=(0, 0), reverse_rows=False,
                 reverse_cols=False, snake_axis='column'):
    integer(rows, '排数')
    integer(cols, '组数')
    if rows * cols > MAX_DESKS:
        raise PlanningError(f'本次最多规划 {MAX_DESKS} 张桌子')
    if mode not in ('row', 'column', 'snake') or snake_axis not in ('row', 'column'):
        raise PlanningError('未知的编号方式')
    if (not isinstance(start, (tuple, list)) or len(start) != 2
            or any(isinstance(v, bool) or not isinstance(v, int) for v in start)
            or not (0 <= start[0] < rows and 0 <= start[1] < cols)):
        raise PlanningError('起始桌不在考场中')
    rr = list(range(rows))[::(-1 if reverse_rows else 1)]
    cc = list(range(cols))[::(-1 if reverse_cols else 1)]
    column = mode == 'column' or (mode == 'snake' and snake_axis == 'column')
    order = []
    for index, outer in enumerate(cc if column else rr):
        inner = rr if column else cc
        if mode == 'snake' and index % 2:
            inner = inner[::-1]
        order.extend((v, outer) if column else (outer, v) for v in inner)
    pivot = order.index(tuple(start))
    order = order[pivot:] + order[:pivot]
    return [{'row': r + 1, 'col': c + 1, 'number': n + 1}
            for n, (r, c) in enumerate(order)]


def _distance(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


class Router:
    def __init__(self, width, height, doors, obstacles=()):
        self.width, self.height = width, height
        self.obstacles = set(obstacles)
        self.doors = {}
        self.expansions = 0
        for door in doors:
            y = 1 if door['offset'] == 0 else 2 + 2 * door['offset']
            if door['corner'].startswith('back'):
                y = height - y
            if not 1 <= y < height:
                raise PlanningError(f"{door['name']}超出墙面范围，请减少偏移")
            x = 0 if door['corner'].endswith('left') else width
            self.doors.setdefault((x, y), door['id'])

    def neighbors(self, point):
        x, y = point
        if point in self.doors:
            step = 1 if y in (1, self.height - 1) else 2
            return [(step if x == 0 else self.width - step, y)]
        if y in (1, self.height - 1):
            result = [(nx, y) for nx in (x - 1, x + 1) if 0 < nx < self.width or (nx, y) in self.doors]
            if x % 2 == 0:
                result.append((x, 2 if y == 1 else self.height - 2))
            return result
        if x % 2 or y % 2:
            return []
        result = [(nx, ny) for nx, ny in ((x - 2, y), (x + 2, y), (x, y - 2), (x, y + 2))
                  if (0 < nx < self.width and 0 < ny < self.height) or (nx, ny) in self.doors]
        if y == 2:
            result.append((x, 1))
        if y == self.height - 2:
            result.append((x, self.height - 1))
        return result

    @staticmethod
    def segment(start, goal):
        dx = (goal[0] > start[0]) - (goal[0] < start[0])
        dy = (goal[1] > start[1]) - (goal[1] < start[1])
        return [(start[0] + dx * step, start[1] + dy * step)
                for step in range(1, _distance(start, goal) + 1)]

    def _visit(self):
        self.expansions += 1
        if self.expansions > MAX_SEARCH_NODES:
            raise PlanningError('路线搜索达到计算预算，请减少规模或增加通道后重试')

    def path(self, start, goal, occupied):
        return self._path(start, {goal}, occupied, goal)

    def path_to_any(self, start, goals, occupied):
        return self._path(start, set(goals), occupied)

    def _path(self, start, goals, occupied, goal=None):
        goals -= occupied | self.obstacles
        if not goals:
            return None
        if start in goals:
            return [start]
        blocked = occupied | self.obstacles
        heuristic = (lambda p: _distance(p, goal)) if goal is not None else (lambda p: 0)
        queue = [(heuristic(start), 0, start)]
        parents, costs = {}, {start: 0}
        while queue:
            _, negative_cost, pos = heappop(queue)
            cost = -negative_cost
            if cost != costs[pos]:
                continue
            if pos in goals:
                path = [pos]
                while pos != start:
                    pos = parents[pos]
                    path.append(pos)
                points = path[::-1]
                return [start] + [p for a, b in zip(points, points[1:]) for p in self.segment(a, b)]
            self._visit()
            for nxt in self.neighbors(pos):
                following = cost + _distance(pos, nxt)
                if any(point in blocked for point in self.segment(pos, nxt)) or following >= costs.get(nxt, float('inf')):
                    continue
                parents[nxt], costs[nxt] = pos, following
                # Prefer deeper equal-f nodes: breadth-first ties exhaust huge
                # empty rectangles in long-row/long-column conversions.
                heappush(queue, (following + heuristic(nxt), -following, nxt))
        return None

    def door_distances(self, occupied):
        return self._door_search(occupied)[0]

    def export_order(self, desks, count):
        """Clear reachable desks nearest a door before assigning any exam targets."""
        if count <= 0:
            return []
        by_position = {tuple(desk['position']): desk for desk in desks}
        _, order = self._door_search(set(by_position), count)
        if len(order) < count:
            raise PlanningError('需要搬出的桌子被阻挡，无法通过前后通道、走廊或空位到达门口')
        return [by_position[point] for point in order]

    def _door_search(self, occupied, export_count=0, seeds=None):
        seeds = list(self.doors) if seeds is None else seeds
        distances = {point: 0 for point in seeds}
        queue = [(0, point) for point in seeds]
        queue.sort()
        remaining, order = set(occupied), []
        while queue:
            distance, pos = heappop(queue)
            if distance != distances[pos]:
                continue
            self._visit()
            if pos in remaining:
                if not export_count:
                    continue
                order.append(pos)
                remaining.remove(pos)
                if len(order) == export_count:
                    break
            for point in self.neighbors(pos):
                segment = self.segment(pos, point)
                if any(p in self.obstacles or p in remaining for p in segment[:-1]) or point in self.obstacles:
                    continue
                following = distance + len(segment)
                if following < distances.get(point, float('inf')):
                    distances[point] = following
                    heappush(queue, (following, point))
        return distances, order

    def nearest_door(self, pos, occupied, entering=False, reserved=None):
        best = None
        best_rank = None
        for point in sorted(self.doors, key=lambda p: (_distance(pos, p), p)):
            if best and reserved is None and _distance(pos, point) > len(best[0]) - 1:
                continue
            path = self.path(point, pos, occupied) if entering else self.path(pos, point, occupied)
            if not path:
                continue
            start = max((reserved.get(p, 0) for p in path), default=0) if reserved is not None else 0
            rank = (start + len(path) - 1, len(path))
            if best is None or rank < best_rank:
                best = path, self.doors[point]
                best_rank = rank
        return best


def conservative_schedule(tasks):
    """Conservative space reservations; intersecting paths retain serial order."""
    last_use, desk_end = {}, {}
    for i, task in enumerate(tasks):
        cells = {tuple(p) for p in task['path']}
        dependencies = {last_use[p][1] for p in cells if p in last_use}
        if task['desk_id'] in desk_end:
            dependencies.add(desk_end[task['desk_id']])
        start = max((tasks[d]['end'] for d in dependencies), default=0)
        task.update(index=i, start=start, end=start + max(1, len(task['path']) - 1),
                    after=sorted(dependencies))
        for point in cells:
            last_use[point] = task['end'], i
        desk_end[task['desk_id']] = i
    return tasks


def schedule(tasks, desks):
    """Reserve swept edges in time, including stationary desks before/after moves.

    Each unit edge reserves both endpoints for its full duration. This also
    excludes perpendicular corner clipping for the documented .86-unit desks.
    Tasks keep their routes; only their departure times are optimized. A bounded
    fallback retains the independently valid conservative schedule.
    """
    conservative_schedule(tasks)
    baseline = [{key: t[key] for key in ('index', 'start', 'end', 'after')} for t in tasks]
    baseline_end = max((t['end'] for t in tasks), default=0)
    occupied = defaultdict(list)
    holds, desk_end = {}, {}
    for desk in desks:
        if desk['position']:
            point = tuple(desk['position'])
            hold = [0, float('inf'), desk['id'], -1]
            insort(occupied[point], hold)
            holds[desk['id']] = (point, hold)
    work = 0
    fallback = False
    for index, task in enumerate(tasks):
        key = task['desk_id']
        path = [tuple(p) for p in task['path']]
        steps = max(1, len(path) - 1)
        old_hold = holds.pop(key, None)
        if old_hold:
            occupied[old_hold[0]].remove(old_hold[1])
        start = desk_end.get(key, 0)
        blockers = set()
        # Do not arrive before previously scheduled traffic has left the target.
        if task['action'] != 'export':
            for begin, end, owner, previous in occupied[path[-1]][-1:]:
                work += 1
                if end > start + steps:
                    if end == float('inf'):
                        fallback = True
                        break
                    start = end - steps
                    if previous >= 0:
                        blockers.add(previous)
        if fallback:
            break
        windows = [(point, max(0, i - 1), min(steps, i + 1)) for i, point in enumerate(path)]
        while True:
            shifted = start
            for point, offset_begin, offset_end in windows:
                intervals = occupied[point]
                # Reservations at a point are disjoint and sorted. Only the
                # preceding interval and intervals starting inside this window
                # can conflict; do not rescan the entire traffic history.
                first = max(0, bisect_left(intervals, [start + offset_begin]) - 1)
                for position in range(first, len(intervals)):
                    begin, end, owner, previous = intervals[position]
                    if begin >= start + offset_end:
                        break
                    work += 1
                    if work > MAX_SCHEDULE_COMPARISONS:
                        fallback = True
                        break
                    if start + offset_begin < end and begin < start + offset_end:
                        if end == float('inf'):
                            fallback = True
                            break
                        shifted = max(shifted, end - offset_begin)
                        if previous >= 0:
                            blockers.add(previous)
                if fallback:
                    break
            if fallback or shifted == start:
                break
            start = shifted
        if fallback:
            break
        end = start + steps
        task.update(index=index, start=start, end=end,
                    after=sorted(i for i in blockers if tasks[i]['end'] <= start))
        if old_hold:
            old_hold[1][1] = start
            if old_hold[1][0] < start:
                insort(occupied[old_hold[0]], old_hold[1])
        for point, begin, finish in windows:
            insort(occupied[point], [start + begin, start + finish, key, index])
        if task['action'] != 'export':
            hold = [end, float('inf'), key, index]
            insort(occupied[path[-1]], hold)
            holds[key] = (path[-1], hold)
        desk_end[key] = end
    optimized_end = max((t['end'] for t in tasks), default=0)
    if fallback or optimized_end > baseline_end:
        for task, original in zip(tasks, baseline):
            task.update(original)
        return {'method': 'conservative', 'comparisons': work, 'baseline_duration': baseline_end,
                'budget_reached': work > MAX_SCHEDULE_COMPARISONS}
    return {'method': 'space_time', 'comparisons': work, 'baseline_duration': baseline_end,
            'budget_reached': False}


MAX_ASSIGNMENT = 600
MAX_CANDIDATE_DESKS = 800
PRE_ALIGNMENT_DURATION = 2
UNREACHABLE_COST = 10 ** 7


def _assignment(cost):
    """Minimum-cost perfect matching of a square matrix (Hungarian, row-vectorized)."""
    import numpy as np
    cost = np.asarray(cost, dtype=float)
    n = len(cost)
    u, v = np.zeros(n + 1), np.zeros(n + 1)
    owner, way = np.zeros(n + 1, dtype=int), np.zeros(n + 1, dtype=int)
    for row in range(1, n + 1):
        owner[0], column = row, 0
        slack, used = np.full(n + 1, np.inf), np.zeros(n + 1, dtype=bool)
        while owner[column]:
            used[column] = True
            current = cost[owner[column] - 1] - u[owner[column]] - v[1:]
            better = ~used[1:] & (current < slack[1:])
            slack[1:][better] = current[better]
            way[1:][better] = column
            candidates = np.where(used[1:], np.inf, slack[1:])
            following = int(np.argmin(candidates)) + 1
            delta = candidates[following - 1]
            u[owner[used]] += delta
            v[used] -= delta
            slack[~used] -= delta
            column = following
        while column:
            previous = way[column]
            owner[column] = owner[previous]
            column = previous
    result = [0] * n
    for column in range(1, n + 1):
        result[owner[column] - 1] = column - 1
    return result


def _allocate(extra, vacancies, door_distance, route_point, door_points):
    """Choose which extra desks fill vacancies, leave, or which vacancies get new desks.

    Filling, leaving and entering are one assignment problem: surplus desks are
    matched to vacancies plus "leave through a door" slots, or vacancies to
    extra desks plus "carry in" slots, minimizing total schematic distance.
    Oversized problems keep a deterministic greedy allocation.
    """
    fill = lambda desk, target: _distance(desk['position'], route_point(target))
    leave = lambda desk: min(door_distance(desk), UNREACHABLE_COST)
    enter = lambda target: min((_distance(p, route_point(target)) for p in door_points),
                               default=UNREACHABLE_COST)
    size = max(len(extra), len(vacancies))
    if not size:
        return [], [], []
    if len(extra) >= len(vacancies):
        if size <= MAX_ASSIGNMENT:
            matrix = [[fill(d, t) for t in vacancies] + [leave(d)] * (size - len(vacancies)) for d in extra]
            chosen = _assignment(matrix)
        else:
            order = sorted(range(size), key=lambda i: (leave(extra[i]), i))
            keep = sorted(order[size - len(vacancies):], key=lambda i: tuple(extra[i]['position']))
            spots = sorted(range(len(vacancies)), key=lambda j: route_point(vacancies[j]))
            chosen = [len(vacancies)] * size
            for i, j in zip(keep, spots):
                chosen[i] = j
        fills = [(extra[i], vacancies[j]) for i, j in enumerate(chosen) if j < len(vacancies)]
        return fills, [extra[i] for i, j in enumerate(chosen) if j >= len(vacancies)], []
    if size <= MAX_ASSIGNMENT:
        matrix = [[fill(d, t) for d in extra] + [enter(t)] * (size - len(extra)) for t in vacancies]
        chosen = _assignment(matrix)
    else:
        order = sorted(range(size), key=lambda j: (-enter(vacancies[j]), j))
        spots = sorted(order[:len(extra)], key=lambda j: route_point(vacancies[j]))
        chosen = [len(extra)] * size
        for i, j in zip(sorted(range(len(extra)), key=lambda i: tuple(extra[i]['position'])), spots):
            chosen[j] = i
    fills = [(extra[i], vacancies[j]) for j, i in enumerate(chosen) if i < len(extra)]
    return fills, [], [vacancies[j] for j, i in enumerate(chosen) if i >= len(extra)]


def plan_exam(snapshot, rows, cols, doors=None):
    integer(rows, '排数')
    integer(cols, '组数')
    if rows * cols > MAX_DESKS:
        raise PlanningError(f'本次最多规划 {MAX_DESKS} 张桌子')
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get('seats'), list):
        raise PlanningError('缺少有效的来源布局')
    classroom = snapshot.get('classroom', {})
    if not isinstance(classroom, dict):
        raise PlanningError('来源教室信息须为对象')
    source_rows = integer(classroom.get('rows'), '原教室排数', maximum=2 * MAX_DIMENSION)
    source_cols = integer(classroom.get('cols'), '原教室列数', maximum=2 * MAX_DIMENSION - 1)
    doors = validate_doors(classroom.get('doors', []) if doors is None else doors)
    width, height = 2 * max(source_cols, 2 * cols - 1) + 2, 2 * max(source_rows, rows) + 2
    desks, obstacles, coords, student_ids = [], set(), set(), set()
    for seat in snapshot['seats']:
        if not isinstance(seat, dict):
            raise PlanningError('来源座位格式错误')
        r = integer(seat.get('row'), '原座位排数', maximum=source_rows)
        c = integer(seat.get('col'), '原座位列数', maximum=source_cols)
        if (r, c) in coords:
            raise PlanningError('来源布局含重复位置')
        coords.add((r, c))
        kind = seat.get('cell_type', 'seat')
        if kind == 'seat':
            student_id = seat.get('student_pk')
            # Vacant source seats are free floor cells, just like aisles.
            # Older snapshots may identify seated students only by name.
            if student_id is None and ('student_pk' in seat or not seat.get('student_name')):
                continue
            if student_id is not None:
                integer(student_id, '学生标识', maximum=2**63-1)
                if student_id in student_ids:
                    raise PlanningError('同一学生不能同时位于两张桌子')
                student_ids.add(student_id)
            desks.append({'id': f'desk-{r}-{c}', 'source': deepcopy(seat),
                          'position': [2 * c, 2 * r], 'target': None, 'action': 'retain'})
        elif kind == 'podium':
            obstacles.add((2 * c, 2 * r))
        elif kind not in ('aisle', 'empty'):
            raise PlanningError('来源布局含未知单元类型')
    if len(desks) > MAX_DESKS:
        raise PlanningError(f'来源布局最多支持 {MAX_DESKS} 张桌子')
    desks.sort(key=lambda d: (d['source']['col'], d['source']['row']))
    row_offset = max((p[1] // 2 for p in obstacles), default=0)
    if rows + row_offset > 2 * MAX_DIMENSION:
        raise PlanningError('讲台区域与目标排数超出可表示范围，请减少排数或调整讲台位置')
    height = 2 * max(source_rows, rows + row_offset) + 2
    router = Router(width, height, doors, obstacles)
    difference = len(desks) - rows * cols
    if difference and not doors:
        raise PlanningError('搬入或搬出桌子前，请先设置教室门')
    columns = defaultdict(list)
    for desk in desks:
        columns[desk['source']['col']].append(desk)
    for index, column in enumerate(sorted(columns), 1):
        for desk in columns[column]:
            desk['source_col'] = index
    targets = [{'row': r + 1, 'col': c + 1, 'position': [2 + 4 * c, 2 + 2 * (r + row_offset)]}
               for c in range(cols) for r in range(rows)]
    if any(tuple(t['position']) in obstacles for t in targets):
        raise PlanningError('目标桌位与讲台重叠，请调整来源布局或考场行列')
    removal = router.export_order(desks, max(0, difference))
    removal_ids = [desk['id'] for desk in removal]
    removed = set(removal_ids)
    columns = {c: [desk for desk in values if desk['id'] not in removed] for c, values in columns.items()}
    columns = {c: values for c, values in columns.items() if values}
    distances = router.door_distances({tuple(d['position']) for d in desks if d['id'] not in removed}) if doors else {}
    door_distance = lambda desk: distances.get(tuple(desk['position']), float('inf'))
    column_distance = {c: min(map(door_distance, ds)) for c, ds in columns.items()}
    centre = (min(columns, default=0) + max(columns, default=0)) / 2
    usable = lambda c: -min(rows, len(columns[c]))
    # Exports are fixed by door accessibility. Only the remaining columns and
    # target assignment compete on carrying count, duration and route length.
    candidates = []
    for order in ((lambda c: (usable(c), -column_distance[c], c)),
                  (lambda c: (usable(c), c)), (lambda c: (usable(c), -c)),
                  (lambda c: (usable(c), abs(c - centre), c)),
                  (lambda c: (usable(c), column_distance[c], c))):
        main = tuple(sorted(sorted(columns, key=order)[:cols]))
        if main not in candidates:
            candidates.append(main)
    if len(desks) + rows * cols > MAX_CANDIDATE_DESKS:
        # Large rooms: every extra candidate is a full route-and-schedule pass.
        candidates = candidates[:2]
    best, best_key, failure, nodes = None, None, None, 0
    for main in candidates:
        trial = deepcopy(desks)
        try:
            allocation = _allocate_candidate(trial, rows, cols, targets, main, distances,
                                             list(router.doors), obstacles, removal_ids)
            trial_router = Router(width, height, doors, obstacles)
            result = _finish_plan(snapshot, rows, cols, trial + allocation['incoming'], doors, width, height,
                                  obstacles, allocation['removal'], router=trial_router)
        except PlanningError as error:
            failure = failure or error
            continue
        metrics = result['metrics']
        nodes += metrics['search_nodes']
        key = (metrics['carried'], metrics['duration'], metrics['distance'])
        if best_key is None or key < best_key:
            best, best_key, chosen = result, key, allocation
        if nodes > MAX_SEARCH_NODES:
            break
    if best is None:
        raise failure
    result = best
    result['row_offset'] = row_offset
    result['metrics']['minimum_carried'] = max(len(desks), rows * cols) - max(
        sum(-usable(c) for c in main) for main in candidates)
    result['metrics']['candidates'] = len(candidates)
    removed = {d['id'] for d in chosen['removal']}
    surplus, main_columns = chosen['surplus'], chosen['main_columns']
    by_column = defaultdict(list)
    for desk in result['desks']:
        if desk['position']:
            by_column[desk['source']['col']].append(desk)
    instructions, segments = [], {}
    for column in sorted(by_column):
        exported = [d for d in by_column[column] if d['id'] in removed]
        if exported:
            segment = '全部' if len(exported) == len(by_column[column]) else '第' + '、'.join(str(d['source']['row']) for d in exported) + '排'
            segments.setdefault((segment, len(exported)), []).append(exported[0]['source_col'])
    # Columns sharing the same exported rows read as one instruction.
    for (segment, count), names in segments.items():
        each = '各' if len(names) > 1 else ''
        instructions.append(f"原第{'、'.join(map(str, names))}列{segment}，{each}搬出 {count} 张桌子。")
    if main_columns:
        source_names = '、'.join(str(by_column[c][0]['source_col']) for c in main_columns)
        target_names = '、'.join(str(chosen['group_offset'] + c + 1) for c in range(len(main_columns)))
        instructions.append(f'原第{source_names}列，按搬运清单调整为第{target_names}组。')
    if surplus:
        if len({d['source_col'] for d in surplus}) == 1 and all(d['target']['row'] == rows for d in surplus):
            target_names = '、'.join(str(d['target']['col']) for d in surplus)
            instructions.append(f"原第{surplus[0]['source_col']}列剩余 {len(surplus)} 张桌子，按原前后顺序补到第{target_names}组最后一排。")
        else:
            instructions.append(f'其余 {len(surplus)} 张桌子按对应清单补齐目标缺位。')
    if chosen['incoming']:
        instructions.append(f"从门口搬入 {len(chosen['incoming'])} 张桌子，按对应清单放入缺位。")
    result['instructions'] = instructions
    return result


def _allocate_candidate(desks, rows, cols, targets, main_columns, distances, door_points, obstacles, removal_ids):
    """Assign targets on a private desk copy; returns exports, carried-in desks and fills."""
    door_distance = lambda desk: distances.get(tuple(desk['position']), float('inf'))
    by_id = {desk['id']: desk for desk in desks}
    removal = [by_id[key] for key in removal_ids]
    removed = set(removal_ids)
    columns = defaultdict(list)
    for desk in desks:
        if desk['id'] not in removed:
            columns[desk['source']['col']].append(desk)
    offset = _group_offset(main_columns, cols)
    base = offset or 0
    assigned, used_targets = set(), set()
    for c, source_col in enumerate(main_columns):
        for r, desk in enumerate(columns[source_col][:rows]):
            desk['target'] = targets[(base + c) * rows + r]
            assigned.add(desk['id'])
            used_targets.add((r + 1, base + c + 1))
    vacancies = [t for t in targets if (t['row'], t['col']) not in used_targets]
    # Kept columns wait at their source x while desks are carried, then shift
    # as whole columns; other groups are filled directly at their final spot.
    staging_x = ({base + index + 1: 2 * source_col for index, source_col in enumerate(main_columns)}
                 if offset is not None else {})
    extra = [d for d in desks if d['id'] not in removed | assigned]
    route_point = lambda t: (staging_x.get(t['col'], t['position'][0]), t['position'][1])
    fills, _, incoming = _allocate(extra, vacancies, door_distance, route_point, door_points)
    incoming.sort(key=lambda t: (t['row'], t['col']))
    for desk, target in fills:
        desk['target'] = target
    for desk in removal:
        desk['action'] = 'export'
    incoming = [{'id': f'incoming-{n + 1}', 'source': None, 'position': None,
                 'target': target, 'action': 'import'} for n, target in enumerate(incoming)]
    # Keep each surviving source column together while desks are carried. The
    # whole-column spacing change happens only after those routes are finished.
    # This avoids inventing a separate carrying trip for every retained desk.
    if staging_x:
        pre_points = []
        for desk in desks + incoming:
            if desk['target']:
                target = desk['target']
                desk['routing_position'] = [staging_x.get(target['col'], target['position'][0]), target['position'][1]]
                pre_points.append(tuple(desk['routing_position']))
        if len(set(pre_points)) != len(pre_points) or set(pre_points) & obstacles:
            for desk in desks + incoming:
                desk.pop('routing_position', None)
    return {'removal': removal, 'incoming': incoming, 'surplus': [d for d, _ in fills],
            'main_columns': list(main_columns), 'group_offset': base}


def _group_offset(main_columns, cols):
    """First group of a contiguous block for the kept columns, or None.

    Each kept column later shifts horizontally from its source x to its group
    x. A block is valid only when no other group's desks stand inside any of
    those swept ranges, so the whole-column shift never crosses a filled desk.
    Among valid blocks the one with the least total shifting is chosen.
    """
    count = len(main_columns)
    if not count:
        return None
    best = None
    for start in range(cols - count + 1):
        spans = sorted((min(2 * source, 2 + 4 * (start + index)), max(2 * source, 2 + 4 * (start + index)))
                       for index, source in enumerate(main_columns))
        merged = []
        for low, high in spans:
            if merged and low <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], high)
            else:
                merged.append([low, high])
        others = [2 + 4 * group for group in range(cols) if not start <= group < start + count]
        lows = [low for low, _ in merged]
        blocked = False
        for x in others:
            position = bisect_left(lows, x + 1) - 1
            if position >= 0 and merged[position][0] <= x <= merged[position][1]:
                blocked = True
                break
        if blocked:
            continue
        shift = sum(high - low for low, high in spans)
        if best is None or shift < best[0]:
            best = (shift, start)
    return None if best is None else best[1]


def _finish_plan(snapshot, rows, cols, desks, doors, width, height, obstacles, removal=None, numbering=True, router=None, replay=None):
    router = router or Router(width, height, doors, obstacles)
    if removal is None:
        removal = [d for d in desks if d['action'] == 'export']
    targets = [d['target'] for d in desks if d['target']]
    positions = {d['id']: tuple(d['position']) for d in desks if d['position']}
    tasks = []
    reservations, desk_finish = {}, {}
    route_target = lambda desk: tuple(desk.get('routing_position', desk['target']['position']))
    target_points = {route_target(d) for d in desks if d['target']}
    parking = {(x, y) for y in (1, height - 1) for x in range(2, width, 2)}
    floor_parking = {(x, y) for x in range(2, width, 2) for y in range(2, height, 2)} - target_points
    parking |= floor_parking
    parked, deferred, pending = set(), [], []
    restoring = False

    def move(desk, path, action, door_id=None):
        tasks.append({'desk_id': desk['id'], 'action': action, 'path': [list(p) for p in path],
                      'door_id': door_id})
        start = max([desk_finish.get(desk['id'], 0)] + [reservations.get(p, 0) for p in path])
        end = start + max(1, len(path) - 1)
        for point in path:
            reservations[point] = end
        desk_finish[desk['id']] = end
        if action == 'export':
            positions.pop(desk['id'])
        else:
            positions[desk['id']] = path[-1]

    if replay is not None:
        by_id = {desk['id']: desk for desk in desks}
        for task in replay:
            move(by_id[task['desk_id']], [tuple(point) for point in task['path']], task['action'], task.get('door_id'))
    else:
        def stage_one(focus):
            candidates = [d for d in desks if d['target'] and d['id'] in positions and d['id'] not in parked]
            candidates.sort(key=lambda d: (_distance(positions[d['id']], focus), d['id']))
            for desk in candidates:
                pos = positions[desk['id']]
                occupied = set(positions.values()) - {pos}
                route = router.path_to_any(pos, parking - {pos}, occupied)
                if route:
                    move(desk, route, 'stage')
                    parked.add(desk['id'])
                    if desk not in pending:
                        if restoring:
                            pending.append(desk)
                        else:
                            deferred.append(desk)
                    return True
            return False

        class _SlideFallback(Exception):
            pass

        def slide_remaining():
            by_id = {desk['id']: desk for desk in desks}
            vertices = {(x, y) for x in range(2, width, 2) for y in range(2, height, 2)}
            vertices |= {(x, y) for y in (1, height - 1) for x in range(1, width)}
            vertices -= obstacles
            seeds = list(router.doors) or [(2, 1)]
            depths = router._door_search(set(), seeds=seeds)[0]
            locked = set()

            def waypoints(path):
                return [tuple(point) for point in path if point[1] in (1, height - 1)
                        or (point[0] % 2 == 0 and point[1] % 2 == 0)]

            ordered = sorted((d for d in desks if d['target']),
                             key=lambda d: (-depths.get(route_target(d), float('inf')), d['id']))
            visited_states = set()

            def can_close(desk):
                goal = route_target(desk)
                needed = {route_target(other) for other in ordered if other is not desk}
                needed |= {point for key, point in positions.items() if key != desk['id'] and point not in locked}
                needed.discard(goal)
                visited, queue = set(seeds), deque(seeds)
                while queue:
                    point = queue.popleft()
                    for following in router.neighbors(point):
                        if following in visited or following in locked or following == goal:
                            continue
                        if any(p in obstacles for p in router.segment(point, following)):
                            continue
                        visited.add(following)
                        queue.append(following)
                return needed <= visited
            def unlock_path(path):
                owners = {point: key for key, point in positions.items()}
                for point in map(tuple, path):
                    if point in locked:
                        locked.remove(point)
                        displaced = by_id[owners[point]]
                        if displaced not in ordered:
                            ordered.append(displaced)

            while ordered:
                state = (tuple(sorted(positions.items())), frozenset(locked), tuple(d['id'] for d in ordered))
                if state in visited_states:
                    raise PlanningError('搬运周转形成循环，请调整目标分配')
                visited_states.add(state)
                index = next((i for i, desk in enumerate(ordered) if can_close(desk)), 0)
                desk = ordered.pop(index)
                goal = route_target(desk)
                entering = desk['id'] not in positions
                if entering:
                    result = router.nearest_door(goal, locked, entering=True)
                    if not result:
                        result = router.nearest_door(goal, set(), entering=True)
                        if not result:
                            raise PlanningError('新增桌子无法到达目标空位')
                        unlock_path(result[0])
                    path, door_id = result
                else:
                    path = router.path(positions[desk['id']], goal, locked)
                    door_id = None
                    if not path:
                        path = router.path(positions[desk['id']], goal, set())
                        if not path:
                            raise PlanningError('目标桌位无法通过现有通道到达')
                        unlock_path(path)
                points = waypoints(path)
                for current, following in zip(points, points[1:]):
                    owners = {point: key for key, point in positions.items()}
                    if following in owners:
                        blank = router.path_to_any(following, vertices - set(owners), locked | {current})
                        if not blank:
                            blank = router.path_to_any(following, vertices - set(owners), {current})
                            if not blank:
                                raise PlanningError('没有可用于周转的可达空位')
                            unlock_path(blank)
                        chain = waypoints(blank)
                        for origin, destination in reversed(list(zip(chain, chain[1:]))):
                            key = owners.pop(origin, None)
                            if key is not None:
                                move(by_id[key], [origin] + router.segment(origin, destination), 'stage')
                                owners[destination] = key
                    action = 'import' if entering else 'move'
                    move(desk, [current] + router.segment(current, following), action, door_id if entering else None)
                    entering = False
                locked.add(goal)

        exports = list(removal)
        while exports:
            progress = False
            for desk in list(exports):
                pos = positions[desk['id']]
                result = router.nearest_door(pos, set(positions.values()) - {pos}, reserved=reservations)
                if result:
                    move(desk, result[0], 'export', result[1])
                    exports.remove(desk)
                    progress = True
            if not progress and not stage_one(positions[exports[0]['id']]):
                raise PlanningError('待搬出的桌子无法到达门口，请调整布局或通道')
        try:
            pending = [d for d in desks if d['target'] and d['action'] != 'import'
                       and positions[d['id']] != route_target(d) and d not in deferred]
            pending.sort(key=lambda d: (-route_target(d)[1], route_target(d)[0], d['id']))
            while pending:
                progress = False
                for desk in list(pending):
                    pos = positions[desk['id']]
                    route = router.path(pos, route_target(desk), set(positions.values()) - {pos})
                    if route:
                        move(desk, route, 'move')
                        pending.remove(desk)
                        progress = True
                if progress:
                    continue
                if not stage_one(route_target(pending[0])):
                    raise _SlideFallback
            incoming = [desk for desk in desks if desk['action'] == 'import']
            incoming_distances = router.door_distances(set(positions.values())) if incoming else {}
            # Fill the deepest vacancies first so a desk placed near a door never
            # seals the only route to another vacancy behind it.
            for desk in sorted(incoming, key=lambda d: (-incoming_distances.get(route_target(d), float('inf')), d['id'])):
                while True:
                    result = router.nearest_door(route_target(desk), set(positions.values()), entering=True, reserved=reservations)
                    if result:
                        move(desk, result[0], 'import', result[1])
                        break
                    if not stage_one(route_target(desk)):
                        raise _SlideFallback
            restoring, pending = True, list(reversed(deferred))
            while pending:
                progress = False
                for desk in list(pending):
                    pos = positions[desk['id']]
                    route = router.path(pos, route_target(desk), set(positions.values()) - {pos})
                    if route:
                        move(desk, route, 'move')
                        pending.remove(desk)
                        progress = True
                if not progress and not stage_one(route_target(pending[0])):
                    raise _SlideFallback
        except _SlideFallback:
            slide_remaining()
    scheduling = schedule(tasks, desks)
    alignment = [{'desk_id': d['id'], 'from': list(route_target(d)), 'to': d['target']['position']}
                 for d in desks if d['target'] and route_target(d) != tuple(d['target']['position'])]
    alignment_start = max((t['end'] for t in tasks), default=0)
    duration = alignment_start + (2 if alignment else 0)
    return {'version': 1, 'source_hash': fingerprint(snapshot), 'rows': rows, 'cols': cols,
            'doors': doors, 'width': width, 'height': height, 'obstacles': [list(p) for p in sorted(obstacles)],
            'desks': desks, 'tasks': tasks, 'scheduling': scheduling,
            'alignment': alignment, 'alignment_start': alignment_start,
            'numbering': number_desks(rows, cols) if numbering else [],
            'metrics': {'original': sum(d['position'] is not None for d in desks), 'target': len(targets),
                        'exported': len(removal), 'imported': sum(d['action'] == 'import' for d in desks),
                        'carried': len({t['desk_id'] for t in tasks}),
                        'distance': sum(len(t['path']) - 1 for t in tasks),
                        'duration': duration,
                        'serial_duration': sum(t['end'] - t['start'] for t in tasks),
                        'search_nodes': router.expansions},
            'geometry': 'desk-cell-grid',
            'notes': []}


def target_snapshot(source, plan):
    result = deepcopy(source)
    podiums = [s for s in source['seats'] if s.get('cell_type') == 'podium']
    physical_rows = plan['rows'] + plan.get('row_offset', 0)
    physical_cols = max([2 * plan['cols'] - 1] + [s['col'] for s in podiums])
    result['classroom'].update(rows=physical_rows, cols=physical_cols, doors=plan['doors'])
    cells = {(r, c): {'row': r, 'col': c, 'cell_type': 'aisle'}
             for r in range(1, physical_rows + 1) for c in range(1, physical_cols + 1)}
    result['groups'] = [{'name': f'第{c}组', 'order': c} for c in range(1, plan['cols'] + 1)]
    for desk in plan['desks']:
        if desk['target']:
            seat = deepcopy(desk['source'] or {})
            target = desk['target']
            seat.update(row=target['position'][1] // 2, col=target['position'][0] // 2,
                        cell_type='seat', group_name=f"第{target['col']}组")
            cells[(seat['row'], seat['col'])] = seat
    for seat in podiums:
        cells[(seat['row'], seat['col'])] = deepcopy(seat)
    result['seats'] = list(cells.values())
    result['exam'] = {'version': 1, 'plan': deepcopy(plan)}
    return result


def plan_restore(current, original, previous):
    """Close the groups, then undo verified carrying routes in reverse order."""
    desks = []
    current_cells = {(s['row'], s['col']): s for s in current['seats']}
    # Undo the forward whole-column spacing first: close every exam group back
    # to its source column, then carry only desks that are still out of place.
    spread = {item['desk_id']: item for item in previous.get('alignment', [])}
    for old in previous['desks']:
        position = old['target']['position'] if old['target'] else None
        source = current_cells.get((position[1] // 2, position[0] // 2)) if position else None
        if old['id'] in spread:
            position = spread[old['id']]['from']
        target = None
        if old['position']:
            target = {'row': old['source']['row'], 'col': old['source']['col'],
                      'display_col': old.get('source_col', old['source']['col']), 'position': old['position']}
        desks.append({'id': old['id'], 'position': position,
                      'source': deepcopy(source if position else old['source']),
                      'source_col': old['target']['col'] if old['target'] else old.get('source_col'),
                      'target': target, 'action': 'import' if position is None else 'export' if target is None else 'retain'})
    replay = None
    if previous.get('geometry') == 'desk-cell-grid':
        inverse = {'export': 'import', 'import': 'export', 'stage': 'move', 'move': 'move'}
        replay = [{**task, 'path': list(reversed(task['path'])), 'action': inverse[task['action']]}
                  for task in reversed(previous['tasks'])]
    result = _finish_plan(current, original['classroom']['rows'], original['classroom']['cols'],
                          desks, previous['doors'], previous['width'], previous['height'],
                          {tuple(p) for p in previous['obstacles']}, numbering=False, replay=replay)
    result['kind'] = 'restore'
    closing = [{'desk_id': d['id'], 'from': spread[d['id']]['to'], 'to': spread[d['id']]['from']}
               for d in desks if d['id'] in spread]
    if closing:
        for task in result['tasks']:
            task['start'] += PRE_ALIGNMENT_DURATION
            task['end'] += PRE_ALIGNMENT_DURATION
        result['alignment_start'] += PRE_ALIGNMENT_DURATION
        result['metrics']['duration'] += PRE_ALIGNMENT_DURATION
    result['pre_alignment'] = closing
    return result
