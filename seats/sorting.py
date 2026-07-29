import ast
import math
import re
from functools import cmp_to_key

from pypinyin import lazy_pinyin


MAX_SORT_RULES = 8
MAX_PYTHON_SORT_SOURCE = 8000
ALLOWED_FIELDS = {
    'name',
    'student_id',
    'classroom',
    'gender',
    'score',
    'group',
}
ALLOWED_TRANSFORMS = {'auto', 'text', 'natural', 'numeric', 'pinyin', 'pinyin_initial'}
ALLOWED_DIRECTIONS = {'asc', 'desc'}
ALLOWED_NULLS = {'first', 'last'}
PYTHON_SORT_FUNCTION = 'sort_students'
PYTHON_SORT_EXAMPLE = '''def sort_students(students):
    return sorted(
        students,
        key=lambda student: (
            -(student.get("score") or 0),
            natural_key(student.get("student_id")),
        ),
    )
'''

_PYTHON_SORT_SAFE_BUILTINS = {
    'abs': abs,
    'all': all,
    'any': any,
    'bool': bool,
    'dict': dict,
    'enumerate': enumerate,
    'filter': filter,
    'float': float,
    'int': int,
    'len': len,
    'list': list,
    'map': map,
    'max': max,
    'min': min,
    'reversed': reversed,
    'round': round,
    'set': set,
    'sorted': sorted,
    'str': str,
    'sum': sum,
    'tuple': tuple,
    'zip': zip,
}
_PYTHON_SORT_ALLOWED_CALL_NAMES = set(_PYTHON_SORT_SAFE_BUILTINS) | {
    'natural_key',
    'pinyin_key',
    'pinyin_initial_key',
}
_PYTHON_SORT_ALLOWED_METHODS = {
    'casefold',
    'count',
    'endswith',
    'find',
    'get',
    'index',
    'isdigit',
    'isnumeric',
    'items',
    'keys',
    'lower',
    'replace',
    'reverse',
    'sort',
    'split',
    'startswith',
    'strip',
    'upper',
    'values',
}
_PYTHON_SORT_BANNED_NODES = (
    ast.AsyncFor,
    ast.AsyncFunctionDef,
    ast.Await,
    ast.ClassDef,
    ast.Delete,
    ast.For,
    ast.Global,
    ast.Import,
    ast.ImportFrom,
    ast.Nonlocal,
    ast.Raise,
    ast.Try,
    ast.While,
    ast.With,
    ast.Yield,
    ast.YieldFrom,
)


class _PythonSortValidator(ast.NodeVisitor):
    def generic_visit(self, node):
        if isinstance(node, _PYTHON_SORT_BANNED_NODES):
            raise ValueError(f'Python 排序代码不支持 {node.__class__.__name__}')
        return super().generic_visit(node)

    def visit_Name(self, node):
        if node.id.startswith('__'):
            raise ValueError('Python 排序代码不能访问双下划线名称')
        return self.generic_visit(node)

    def visit_Attribute(self, node):
        if node.attr.startswith('__'):
            raise ValueError('Python 排序代码不能访问双下划线属性')
        return self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name):
            if node.func.id not in _PYTHON_SORT_ALLOWED_CALL_NAMES:
                raise ValueError(f'Python 排序代码不能调用 {node.func.id}')
        elif isinstance(node.func, ast.Attribute):
            if node.func.attr not in _PYTHON_SORT_ALLOWED_METHODS:
                raise ValueError(f'Python 排序代码不能调用方法 {node.func.attr}')
        else:
            raise ValueError('Python 排序代码包含不支持的调用形式')
        return self.generic_visit(node)

    def visit_BinOp(self, node):
        if isinstance(node.op, ast.Pow):
            raise ValueError('Python 排序代码不能使用幂运算')
        return self.generic_visit(node)

    def visit_Constant(self, node):
        if isinstance(node.value, str) and len(node.value) > 1000:
            raise ValueError('Python 排序代码中的单个字符串不能超过 1000 个字符')
        return self.generic_visit(node)


def natural_tokens(value):
    text = str(value or '').strip().casefold()
    if not text:
        return ()
    return tuple(
        (0, int(part)) if part.isdigit() else (1, part)
        for part in re.split(r'(\d+)', text)
        if part != ''
    )


def pinyin_text(value, *, initials=False):
    parts = [str(part or '').casefold() for part in lazy_pinyin(str(value or '')) if part]
    if initials:
        return ''.join(part[0] for part in parts if part)
    return ''.join(parts)


def normalize_python_sort_code(source):
    source = str(source or '').strip()
    if not source:
        raise ValueError('Python 排序代码不能为空')
    if len(source) > MAX_PYTHON_SORT_SOURCE:
        raise ValueError(f'Python 排序代码不能超过 {MAX_PYTHON_SORT_SOURCE} 个字符')
    try:
        tree = ast.parse(source, filename='<python-sort-strategy>', mode='exec')
    except SyntaxError as exc:
        raise ValueError(f'Python 排序代码语法错误：第 {exc.lineno or 1} 行') from exc
    if len(list(ast.walk(tree))) > 500:
        raise ValueError('Python 排序代码过于复杂')
    _PythonSortValidator().visit(tree)
    if len(tree.body) != 1 or not isinstance(tree.body[0], ast.FunctionDef):
        raise ValueError(f'Python 排序代码必须只定义一个 {PYTHON_SORT_FUNCTION}(students) 函数')
    function = tree.body[0]
    if function.name != PYTHON_SORT_FUNCTION:
        raise ValueError(f'函数名必须是 {PYTHON_SORT_FUNCTION}')
    if (
        len(function.args.args) != 1
        or function.args.args[0].arg != 'students'
        or function.args.posonlyargs
        or function.args.kwonlyargs
        or function.args.vararg
        or function.args.kwarg
        or function.decorator_list
    ):
        raise ValueError(f'{PYTHON_SORT_FUNCTION} 必须且只能接收 students 参数')
    if not any(isinstance(node, ast.Return) for node in ast.walk(function)):
        raise ValueError(f'{PYTHON_SORT_FUNCTION} 必须返回排序后的学生列表')
    compile(tree, '<python-sort-strategy>', 'exec')
    return source


def _python_student_record(student):
    seat = getattr(student, 'assigned_seat', None)
    group = getattr(seat, 'group', None) if seat else None
    custom_data = normalize_custom_data(getattr(student, 'custom_data', None))
    return {
        'id': student.pk,
        'name': student.name,
        'student_id': student.student_id,
        'gender': student.gender or '',
        'score': student.score,
        'classroom': getattr(getattr(student, 'classroom', None), 'name', ''),
        'group': getattr(group, 'name', ''),
        'custom_data': custom_data,
        'custom': custom_data,
        'seat': {
            'row': getattr(seat, 'row', None),
            'col': getattr(seat, 'col', None),
        },
    }


def sort_students_with_python(students, source):
    source = normalize_python_sort_code(source)
    student_list = list(students)
    records = [_python_student_record(student) for student in student_list]
    namespace = {
        '__builtins__': dict(_PYTHON_SORT_SAFE_BUILTINS),
        'natural_key': natural_tokens,
        'pinyin_key': lambda value: natural_tokens(pinyin_text(value)),
        'pinyin_initial_key': lambda value: natural_tokens(pinyin_text(value, initials=True)),
    }
    try:
        exec(compile(source, '<python-sort-strategy>', 'exec'), namespace, namespace)
        output = namespace[PYTHON_SORT_FUNCTION](records)
        ordered_items = list(output)
    except Exception as exc:
        raise ValueError(f'Python 排序代码执行失败：{exc}') from exc

    ordered_ids = []
    for item in ordered_items:
        raw_id = item.get('id') if isinstance(item, dict) else item
        if isinstance(raw_id, bool):
            raise ValueError('Python 排序结果包含无效学生 ID')
        try:
            ordered_ids.append(int(raw_id))
        except (TypeError, ValueError) as exc:
            raise ValueError('Python 排序结果必须返回学生字典或学生 ID') from exc

    expected_ids = [student.pk for student in student_list]
    if len(ordered_ids) != len(expected_ids):
        raise ValueError('Python 排序结果必须包含全部学生，且数量保持不变')
    if len(set(ordered_ids)) != len(ordered_ids):
        raise ValueError('Python 排序结果不能包含重复学生')
    if set(ordered_ids) != set(expected_ids):
        raise ValueError('Python 排序结果不能新增或遗漏学生')
    by_id = {student.pk: student for student in student_list}
    return [by_id[student_id] for student_id in ordered_ids]


def normalize_custom_data(value):
    if not isinstance(value, dict):
        return {}
    normalized = {}
    for raw_key, raw_value in value.items():
        key = str(raw_key or '').strip()
        if not key:
            continue
        if isinstance(raw_value, (dict, list)):
            normalized[key[:80]] = str(raw_value)[:500]
        elif raw_value is None or isinstance(raw_value, (str, int, float, bool)):
            normalized[key[:80]] = raw_value
        else:
            normalized[key[:80]] = str(raw_value)[:500]
        if len(normalized) >= 40:
            break
    return normalized


def normalize_sort_definition(definition):
    if not isinstance(definition, dict):
        raise ValueError('排序规则必须是对象')
    raw_rules = definition.get('rules') or definition.get('keys') or []
    if not isinstance(raw_rules, list) or not raw_rules:
        raise ValueError('排序方式至少需要一条规则')
    if len(raw_rules) > MAX_SORT_RULES:
        raise ValueError(f'排序规则最多 {MAX_SORT_RULES} 条')

    rules = []
    for raw in raw_rules:
        if not isinstance(raw, dict):
            raise ValueError('排序规则格式错误')
        field = str(raw.get('field') or '').strip()
        if field.startswith('custom:'):
            custom_key = field.split(':', 1)[1].strip()
            if not custom_key:
                raise ValueError('自定义信息字段不能为空')
            field = f'custom:{custom_key[:80]}'
        elif field not in ALLOWED_FIELDS:
            raise ValueError(f'不支持的排序字段：{field}')
        direction = str(raw.get('direction') or 'asc').strip().lower()
        nulls = str(raw.get('nulls') or 'last').strip().lower()
        transform = str(raw.get('transform') or 'auto').strip().lower()
        if direction not in ALLOWED_DIRECTIONS:
            raise ValueError('排序方向只能是 asc 或 desc')
        if nulls not in ALLOWED_NULLS:
            raise ValueError('空值位置只能是 first 或 last')
        if transform not in ALLOWED_TRANSFORMS:
            raise ValueError(f'不支持的转换方式：{transform}')
        rules.append({
            'field': field,
            'direction': direction,
            'nulls': nulls,
            'transform': transform,
        })
    return {
        'rules': rules,
        'seat_order': str(definition.get('seat_order') or 'row_major').strip() or 'row_major',
    }


def _student_field_value(student, field):
    if field == 'name':
        return student.name
    if field == 'student_id':
        return student.student_id
    if field == 'classroom':
        return getattr(getattr(student, 'classroom', None), 'name', '')
    if field == 'gender':
        return student.gender
    if field == 'score':
        return student.score
    if field == 'group':
        seat = getattr(student, 'assigned_seat', None)
        return getattr(getattr(seat, 'group', None), 'name', '')
    if field.startswith('custom:'):
        custom_data = student.custom_data if isinstance(student.custom_data, dict) else {}
        return custom_data.get(field.split(':', 1)[1])
    return None


def _is_null(value):
    return value is None or value == '' or (isinstance(value, float) and math.isnan(value))


def _transformed_value(value, transform, field):
    if transform == 'auto':
        if field == 'score':
            transform = 'numeric'
        elif field == 'name':
            transform = 'pinyin'
        else:
            transform = 'natural'
    if transform == 'numeric':
        try:
            return float(value)
        except (TypeError, ValueError):
            return float('-inf')
    if transform == 'pinyin':
        return natural_tokens(pinyin_text(value))
    if transform == 'pinyin_initial':
        return natural_tokens(pinyin_text(value, initials=True))
    if transform == 'text':
        return str(value or '').casefold()
    return natural_tokens(value)


def _compare_values(left, right):
    if left == right:
        return 0
    try:
        return -1 if left < right else 1
    except TypeError:
        left_text = str(left)
        right_text = str(right)
        return -1 if left_text < right_text else 1


def sort_students(students, definition):
    normalized = normalize_sort_definition(definition)

    def compare(left, right):
        for rule in normalized['rules']:
            left_raw = _student_field_value(left, rule['field'])
            right_raw = _student_field_value(right, rule['field'])
            left_null = _is_null(left_raw)
            right_null = _is_null(right_raw)
            if left_null or right_null:
                if left_null and right_null:
                    continue
                result = -1 if left_null else 1
                if rule['nulls'] == 'last':
                    result *= -1
                return result
            result = _compare_values(
                _transformed_value(left_raw, rule['transform'], rule['field']),
                _transformed_value(right_raw, rule['transform'], rule['field']),
            )
            if result:
                return -result if rule['direction'] == 'desc' else result
        return _compare_values(left.pk or 0, right.pk or 0)

    return sorted(list(students), key=cmp_to_key(compare))


def definition_for_field(field, direction='asc', transform='auto'):
    return normalize_sort_definition({
        'rules': [{
            'field': field,
            'direction': direction,
            'nulls': 'last',
            'transform': transform,
        }],
    })
