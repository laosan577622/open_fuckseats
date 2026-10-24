"""SDES v1 import, based on https://github.com/Braydenccc/SDES/blob/main/SPEC.md."""
import json
import math
import re


FORMAT = 'student-data-exchange-schema'
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_DIMENSION = 128
KINDS = {'seat', 'guard', 'platform', 'door', 'aisle', 'empty'}


def _integer(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f'{label}必须是大于等于 {minimum} 的整数')
    return value


def _records(value, label):
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise ValueError(f'{label}必须是对象列表')
    return value


def _ids(records, label, *, optional=False):
    result = {}
    for index, item in enumerate(records):
        key = item.get('id')
        if optional and key is None:
            continue
        if not isinstance(key, str) or not key.strip():
            raise ValueError(f'{label}第 {index + 1} 项缺少有效 ID')
        if key in result:
            raise ValueError(f'{label}中 ID 重复：{key}')
        result[key] = item
    return result


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'JSON 字段重复：{key}')
        result[key] = value
    return result


def _invalid_json_constant(value):
    raise ValueError(f'无效数值：{value}')


def parse_sdes(raw):
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError('SDES 文件不能超过 8 MB')
    try:
        data = json.loads(raw.decode('utf-8-sig'), object_pairs_hook=_unique_json_object,
                          parse_constant=_invalid_json_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('文件不是有效的 UTF-8 JSON') from exc
    validate_sdes(data)
    return data


def validate_sdes(data):
    if not isinstance(data, dict) or data.get('format') != FORMAT:
        raise ValueError('不是 SDES 文件，缺少 student-data-exchange-schema 格式标识')
    if type(data.get('version')) is not int or data['version'] != 1:
        raise ValueError('目前仅支持 SDES v1')
    classes = _records(data.get('classes'), '班级')
    if not classes:
        raise ValueError('SDES 文件中没有班级数据')
    _ids(classes, '班级', optional=True)
    for classroom in classes:
        _ids(_records(classroom.get('seatCharts'), '座位表'), '座位表')
    return classes


def sdes_catalog(data):
    classes = validate_sdes(data)
    catalog = []
    for index, classroom in enumerate(classes):
        metadata = classroom.get('metadata') if isinstance(classroom.get('metadata'), dict) else {}
        charts = _records(classroom.get('seatCharts'), '座位表')
        catalog.append({
            'index': index, 'name': str(metadata.get('name') or f'班级 {index + 1}'),
            'charts': [{'index': number, 'name': str(chart.get('name') or f'座位表 {number + 1}'),
                        'model': chart.get('layoutModel')} for number, chart in enumerate(charts)],
        })
    if not any(item['charts'] for item in catalog):
        raise ValueError('SDES 文件中没有座位表')
    return catalog


def _roster(classroom, warnings):
    source_students = _records(classroom.get('students'), '学生')
    _ids(source_students, '学生')
    source_tags = _records(classroom.get('tags'), '标签')
    tag_ids = _ids(source_tags, '标签')
    definitions = _ids(_records(classroom.get('attributeDefinitions'), '属性定义'), '属性定义')
    for definition in definitions.values():
        if not isinstance(definition.get('name'), str) or not definition['name'].strip() or definition.get('type') not in {'string', 'number', 'boolean', 'color'}:
            raise ValueError('属性定义缺少名称或有效类型')
    tags, tag_pks, tag_names = [], {}, {}
    for tag in source_tags:
        name = str(tag.get('name') or '').strip()
        if not name or len(name) > 40:
            raise ValueError('标签名称不能为空，且最多 40 个字符')
        color = str(tag.get('color') or '#0a59f7')
        if not re.fullmatch(r'#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?', color):
            raise ValueError(f'标签「{name}」颜色无效')
        if len(color) == 9:
            warnings.add('标签颜色已保留，透明度按不透明显示。')
        if name not in tag_names:
            pk = len(tags) + 1
            tags.append({'pk': pk, 'name': name, 'color': color[:7], 'sort_order': len(tags), 'description': ''})
            tag_names[name] = pk
        else:
            warnings.add('名称相同的标签已合并。')
        tag_pks[tag['id']] = tag_names[name]

    students, memberships, student_pks = [], [], {}
    for index, source in enumerate(source_students):
        name_data = source.get('name')
        name = str(name_data.get('display') or '').strip() if isinstance(name_data, dict) else ''
        if not name or len(name) > 50:
            raise ValueError(f'学生 {source["id"]} 的姓名不能为空，且最多 50 个字符')
        number = source.get('number')
        if number is not None and (not isinstance(number, str) or len(number) > 20):
            raise ValueError(f'学生「{name}」的学号必须是字符串，且最多 20 个字符')
        source_gender = source.get('gender')
        if source_gender is not None and not isinstance(source_gender, str):
            raise ValueError(f'学生「{name}」的性别必须是字符串')
        gender = {'male': 'M', 'female': 'F', 'M': 'M', 'F': 'F', '男': 'M', '女': 'F'}.get(source_gender)
        attributes = source.get('attributes', {})
        if not isinstance(attributes, dict):
            raise ValueError(f'学生「{name}」的属性必须是对象')
        custom, score, score_set = {}, 0, False
        for key, value in attributes.items():
            definition = definitions.get(key)
            if not definition:
                raise ValueError(f'学生「{name}」引用了不存在的属性：{key}')
            label = str(definition.get('name') or key).strip()
            value_type = definition.get('type')
            valid = (
                value_type in {'string', 'color'} and isinstance(value, str)
                or value_type == 'boolean' and isinstance(value, bool)
                or value_type == 'number' and not isinstance(value, bool) and isinstance(value, (int, float)) and abs(value) <= 9007199254740991 and math.isfinite(value)
            )
            if not valid:
                raise ValueError(f'学生「{name}」的属性「{label}」类型无效')
            if value_type == 'color' and not re.fullmatch(r'#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?', value):
                raise ValueError(f'学生「{name}」的属性「{label}」颜色无效')
            if not score_set and value_type == 'number' and (label.lower() in {'成绩', '分数', '总分', 'score', 'total score'} or key.lower().split(':')[-1] == 'score'):
                score = value
                score_set = True
            else:
                unique_label = label if label not in custom else f'{label}（{key}）'
                if len(unique_label) > 80 or isinstance(value, str) and len(value) > 2000:
                    raise ValueError(f'学生「{name}」的自定义信息过长')
                custom[unique_label] = value
        if not gender and source.get('gender') not in {None, '', 'unknown'}:
            custom['原始性别'] = source['gender']
        if len(custom) > 40:
            raise ValueError(f'学生「{name}」的自定义信息超过 40 项')
        pk = index + 1
        student_pks[source['id']] = pk
        students.append({'pk': pk, 'name': name, 'student_id': number or None, 'gender': gender, 'score': score, 'custom_data': custom})
        referenced_tags = source.get('tags', [])
        if not isinstance(referenced_tags, list) or any(not isinstance(key, str) or key not in tag_ids for key in referenced_tags):
            raise ValueError(f'学生「{name}」引用了不存在的标签')
        for tag_pk in dict.fromkeys(tag_pks[key] for key in referenced_tags):
            memberships.append({'pk': len(memberships) + 1, 'student_pk': pk, 'tag_pk': tag_pk, 'note': ''})
    return students, student_pks, tags, memberships


def _layout(chart):
    groups, group_lookup, aisles = [], {}, []
    model = chart.get('layoutModel')
    if model == 'grid':
        grid = chart.get('grid')
        if not isinstance(grid, dict):
            raise ValueError('网格座位表缺少 grid')
        rows = _integer(grid.get('rows'), '网格行数', 1)
        cols = _integer(grid.get('columns'), '网格列数', 1)
    elif model == 'groupedColumns':
        structure = chart.get('groupedColumns')
        definitions = _records(structure.get('groups') if isinstance(structure, dict) else None, '大组')
        if not definitions:
            raise ValueError('分组座位表中没有大组')
        _ids(definitions, '大组', optional=True)
        rows, cols = 0, 0
        for index, group in enumerate(definitions):
            width = _integer(group.get('columns'), '大组列数', 1)
            height = _integer(group.get('rows'), '大组行数', 1)
            if index:
                aisles.append(cols)
                cols += 1
            record = {'pk': index + 1, 'name': f'第 {index + 1} 组', 'order': index,
                      'start': cols, 'columns': width, 'rows': height}
            groups.append(record)
            group_lookup[index] = record
            if group.get('id') is not None:
                group_lookup[group['id']] = record
            rows = max(rows, height)
            cols += width
    else:
        raise ValueError('座位表布局必须是 grid 或 groupedColumns')
    if rows > MAX_DIMENSION or cols > MAX_DIMENSION:
        raise ValueError('座位表最多支持 128 行、128 列')
    return model, rows, cols, groups, group_lookup, aisles


def _seat_primary_guards(cells, rows, cols, platform, guards, doors, warnings):
    primary = {side: source for source, side, index in guards if index == 0}
    if not primary:
        return cells, rows, cols

    def empty_cell(row, col):
        return {'row': row + 1, 'col': col + 1, 'cell_type': 'empty', 'student_pk': None, 'group_pk': None}

    podium_rows = sorted({row for (row, _), cell in cells.items() if cell['cell_type'] == 'podium'})
    if not podium_rows:
        for row in range(rows):
            for col in range(cols, max(3, cols)):
                cells[row, col] = empty_cell(row, col)
        cols = max(3, cols)
        if platform == 'top':
            cells = {(row + 1, col): {**cell, 'row': row + 2} for (row, col), cell in cells.items()}
            podium_row = 0
        else:
            podium_row = rows
        for col in range(cols):
            cells[podium_row, col] = empty_cell(podium_row, col)
        cells[podium_row, cols // 2]['cell_type'] = 'podium'
        rows += 1
        for door in doors:
            if door['corner'].startswith('front_' if platform == 'top' else 'back_'):
                door['offset'] += 1
    else:
        podium_row = podium_rows[0]

    for side in ('left', 'right'):
        if side not in primary:
            continue
        podium_cols = [col for (row, col), cell in cells.items() if row == podium_row and cell['cell_type'] == 'podium']
        boundary = min(podium_cols) if side == 'left' else max(podium_cols)
        guard_col = boundary - 1 if side == 'left' else boundary + 1
        target = cells.get((podium_row, guard_col))
        if not target or target['student_pk'] is not None or target['cell_type'] not in {'seat', 'empty'}:
            insert_at = boundary if side == 'left' else boundary + 1
            cells = {(row, col + int(col >= insert_at)): {**cell, 'col': col + 1 + int(col >= insert_at)}
                     for (row, col), cell in cells.items()}
            for row in range(rows):
                cells[row, insert_at] = empty_cell(row, insert_at)
            cols += 1
            guard_col = insert_at
        cells[podium_row, guard_col].update(cell_type='seat', student_pk=primary[side].get('_student_pk'), group_pk=None)
    warnings.add('讲台旁护法已转换为座位。')
    return cells, rows, cols


def convert_sdes(data, class_index=0, chart_index=0, *, classroom_name=None):
    classes = validate_sdes(data)
    class_index = _integer(class_index, '班级序号')
    chart_index = _integer(chart_index, '座位表序号')
    if class_index >= len(classes):
        raise ValueError('选择的班级不存在')
    source_class = classes[class_index]
    charts = _records(source_class.get('seatCharts'), '座位表')
    if chart_index >= len(charts):
        raise ValueError('选择的座位表不存在')
    chart = charts[chart_index]
    warnings = set()
    students, student_pks, tags, memberships = _roster(source_class, warnings)
    model, grid_rows, grid_cols, groups, group_lookup, aisles = _layout(chart)
    source_seats = _records(chart.get('seats'), '座位')
    seat_ids = _ids(source_seats, '座位')
    assignments, assigned_students = {}, set()
    for assignment in _records(chart.get('assignments'), '座位分配'):
        seat_id, student_id = assignment.get('seatId'), assignment.get('studentId')
        if not isinstance(seat_id, str) or seat_id not in seat_ids:
            raise ValueError('座位分配引用了不存在的座位')
        if not isinstance(student_id, str) or student_id not in student_pks:
            raise ValueError('座位分配引用了不存在的学生')
        if student_id in assigned_students:
            raise ValueError(f'同一学生被重复分配：{student_id}')
        if seat_id in assignments:
            raise ValueError('目前每个座位只能安排一名学生，请拆分多人座位后导入')
        if seat_ids[seat_id].get('kind') not in {'seat', 'guard'} or seat_ids[seat_id].get('capacity', 1) == 0:
            raise ValueError('学生只能安排在可用座位或护法位置')
        assignments[seat_id] = student_pks[student_id]
        assigned_students.add(student_id)

    guards, guard_positions = [], set()
    for seat in source_seats:
        if seat.get('kind') not in KINDS:
            raise ValueError(f'座位 {seat["id"]} 的类型无效')
        capacity = _integer(seat.get('capacity', 1), '座位容量')
        if capacity > 1:
            warnings.add('多人座位按一人一座导入。')
        if seat['kind'] == 'guard':
            position = seat.get('guardPos')
            if not isinstance(position, dict) or position.get('side') not in {'left', 'right'}:
                raise ValueError('护法位置必须包含有效的 guardPos.side')
            index = _integer(position.get('index'), '护法序号')
            if index >= MAX_DIMENSION:
                raise ValueError('护法序号不能超过 127')
            key = (position['side'], index)
            if key in guard_positions:
                raise ValueError('同侧护法位置重复')
            guard_positions.add(key)
            guards.append((seat, position['side'], index))

    rows = max([grid_rows, *[index + 1 for _, _, index in guards]])
    left_extra = any(side == 'left' and index > 0 for _, side, index in guards)
    right_extra = any(side == 'right' and index > 0 for _, side, index in guards)
    left_offset = 2 if left_extra else 0
    cols = grid_cols + left_offset + (2 if right_extra else 0)
    coordinates = chart.get('coordinateSystem') or {}
    if not isinstance(coordinates, dict):
        raise ValueError('坐标系统必须是对象')
    origin = coordinates.get('origin', 'front-left')
    if origin not in {'front-left', 'front-right', 'back-left', 'back-right'}:
        raise ValueError('坐标原点无效')
    x_direction = coordinates.get('xDirection', 'right-to-left' if origin.endswith('right') else 'left-to-right')
    y_direction = coordinates.get('yDirection', 'back-to-front' if origin.startswith('back') else 'front-to-back')
    if x_direction not in {'left-to-right', 'right-to-left'} or y_direction not in {'front-to-back', 'back-to-front'}:
        raise ValueError('坐标方向无效')
    platform = chart.get('platformPosition', 'top')
    if platform not in {'top', 'bottom'} or chart.get('doorPosition', 'right') not in {'left', 'right'}:
        raise ValueError('讲台或门的显示位置无效')

    cells = {(row, col): {'row': row + 1, 'col': col + 1, 'cell_type': 'empty', 'student_pk': None, 'group_pk': None}
             for row in range(rows) for col in range(cols)}
    for col in [*[(grid_cols - 1 - col if x_direction == 'right-to-left' else col) + left_offset for col in aisles], *([1] if left_extra else []), *([cols - 2] if right_extra else [])]:
        for row in range(rows):
            cells[row, col]['cell_type'] = 'aisle'
    positions, doors, has_platform = set(), [], False
    grid_group_keys = {}
    def display_row(row):
        return rows - 1 - row if platform == 'bottom' else row

    for source in source_seats:
        kind = source['kind']
        if kind == 'guard':
            continue
        group = None
        if model == 'groupedColumns' and kind in {'seat', 'aisle', 'empty'}:
            reference = source.get('group')
            if isinstance(reference, bool) or not isinstance(reference, (str, int)) or reference not in group_lookup:
                raise ValueError(f'座位 {source["id"]} 引用了不存在的大组')
            group = group_lookup[reference]
            x = _integer(source.get('column'), '组内列')
            y = _integer(source.get('row'), '组内行')
            if x >= group['columns'] or y >= group['rows']:
                raise ValueError(f'座位 {source["id"]} 超出大组范围')
            x += group['start']
        else:
            x, y = source.get('x'), source.get('y')
            if kind in {'platform', 'door'} and (x is None or y is None):
                x, y = grid_cols // 2, grid_rows if y_direction == 'back-to-front' else -1
            if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, int) or not isinstance(y, int):
                raise ValueError(f'座位 {source["id"]} 缺少有效坐标')
        if x_direction == 'right-to-left':
            x = grid_cols - 1 - x
        if y_direction == 'back-to-front':
            y = grid_rows - 1 - y
        if kind == 'door':
            side = 'left' if x < grid_cols / 2 else 'right'
            if source.get('x') is None:
                side = chart.get('doorPosition', 'right')
            displayed = display_row(max(0, min(rows - 1, y)))
            front = displayed < rows / 2
            offset = max(0, y if y < rows / 2 else rows - 1 - y)
            doors.append({'id': f'sdes-door-{len(doors) + 1}', 'name': '门',
                          'corner': ('front_' if front else 'back_') + side, 'offset': offset})
            continue
        if not (0 <= x < grid_cols and 0 <= y < grid_rows):
            if kind == 'platform':
                continue
            raise ValueError(f'座位 {source["id"]} 超出网格范围')
        position = (display_row(y), x + left_offset)
        if position in positions:
            raise ValueError(f'网格位置重复：{source["id"]}')
        positions.add(position)
        cell = cells[position]
        cell['cell_type'] = 'podium' if kind == 'platform' else kind
        cell['student_pk'] = assignments.get(source['id'])
        has_platform |= kind == 'platform'
        if model == 'grid' and kind == 'seat' and source.get('group') is not None:
            reference = source['group']
            if isinstance(reference, bool) or not isinstance(reference, (str, int)):
                raise ValueError('网格分组提示必须是字符串或整数')
            key = (type(reference).__name__, reference)
            if key not in grid_group_keys:
                pk = len(groups) + 1
                name = f'第 {reference + 1} 组' if isinstance(reference, int) else reference.strip() or f'第 {pk} 组'
                if len(name) > 50:
                    name = f'第 {pk} 组'
                used_names = {item['name'] for item in groups}
                base_name, suffix = name, 2
                while name in used_names:
                    ending = f'（{suffix}）'
                    name = base_name[:50 - len(ending)] + ending
                    suffix += 1
                groups.append({'pk': pk, 'name': name, 'order': pk - 1})
                grid_group_keys[key] = groups[-1]
            group = grid_group_keys[key]
        if kind == 'seat' and group:
            cell['group_pk'] = group['pk']

    left_guardian = right_guardian = None
    for source, side, index in guards:
        student_pk = assignments.get(source['id'])
        if index == 0:
            if side == 'left':
                left_guardian = student_pk
            else:
                right_guardian = student_pk
        else:
            cell = cells[display_row(index), 0 if side == 'left' else cols - 1]
            cell.update(cell_type='seat', student_pk=student_pk)
            warnings.add('同侧的额外护法已放入侧边辅助座位。')
    if platform == 'bottom' and not has_platform:
        for col in range(cols):
            cells[rows, col] = {'row': rows + 1, 'col': col + 1, 'cell_type': 'podium' if col == cols // 2 else 'empty', 'student_pk': None, 'group_pk': None}
        rows += 1
    primary_guards = [(dict(source, _student_pk=assignments.get(source['id'])), side, index) for source, side, index in guards]
    cells, rows, cols = _seat_primary_guards(cells, rows, cols, platform, primary_guards, doors, warnings)
    if rows > MAX_DIMENSION or cols > MAX_DIMENSION:
        raise ValueError('转换后的座位表超过 128 行或 128 列')
    if not doors and 'doorPosition' in chart:
        doors.append({'id': 'sdes-door-1', 'name': '门', 'corner': ('back_' if platform == 'bottom' else 'front_') + chart['doorPosition'], 'offset': 0})
    metadata = source_class.get('metadata') if isinstance(source_class.get('metadata'), dict) else {}
    state = {
        'classroom': {'pk': 0, 'name': classroom_name or str(metadata.get('name') or '导入班级'),
                      'rows': rows, 'cols': cols, 'doors': doors,
                      'left_guardian_student_pk': left_guardian, 'right_guardian_student_pk': right_guardian},
        'students': students, 'groups': [{key: group[key] for key in ('pk', 'name', 'order')} for group in groups],
        'seats': list(cells.values()), 'student_tags': tags, 'student_tag_memberships': memberships,
        'constraints': [], 'student_tag_rules': [], 'layout_snapshots': [],
    }
    bundle = {'meta': {'app': '不想排座位', 'version': '2.0', 'schema': 'full'},
              'current_state': state, 'history': {'entries': []}}
    labels = {'seat': '空座', 'aisle': '走廊', 'podium': '讲台', 'empty': ''}
    student_names = {student['pk']: student['name'] for student in students}
    preview = [[{**cells[row, col], 'label': student_names.get(cells[row, col]['student_pk'], labels[cells[row, col]['cell_type']])}
                for col in range(cols)] for row in range(rows)]
    summary = {'rows': rows, 'cols': cols, 'students': len(students), 'assigned': len(assignments),
               'groups': len(groups), 'tags': len(tags), 'warnings': sorted(warnings), 'preview': preview,
               'left_guardian': student_names.get(left_guardian, ''), 'right_guardian': student_names.get(right_guardian, '')}
    return bundle, summary
