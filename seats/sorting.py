import ast
import collections
import functools
import itertools
import math
import operator
import random
import re
import statistics
import sys
import time
import types
from functools import cmp_to_key

from pypinyin import lazy_pinyin


MAX_SORT_RULES = 8
MAX_PYTHON_SORT_SOURCE = 20000
MAX_PYTHON_SORT_NODES = 4000
MAX_PYTHON_SORT_STRING = 2000
MAX_PYTHON_SORT_POWER = 64
PYTHON_SORT_TIME_LIMIT = 5.0
PYTHON_SORT_STEP_LIMIT = 20_000_000
PYTHON_SORT_RANGE_LIMIT = 1_000_000
PYTHON_SORT_SOURCE_NAME = '<python-sort-strategy>'
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


def _safe_range(*args):
    try:
        result = range(*args)
        size = len(result)
    except OverflowError as exc:
        raise ValueError(f'range 的长度不能超过 {PYTHON_SORT_RANGE_LIMIT}') from exc
    if size > PYTHON_SORT_RANGE_LIMIT:
        raise ValueError(f'range 的长度不能超过 {PYTHON_SORT_RANGE_LIMIT}')
    return result


def _safe_pow(base, exponent, modulus=None):
    if modulus is not None:
        return pow(base, exponent, modulus)
    if isinstance(exponent, int) and abs(exponent) > MAX_PYTHON_SORT_POWER:
        raise ValueError(f'pow 的指数绝对值不能超过 {MAX_PYTHON_SORT_POWER}')
    return pow(base, exponent)


def _ignore_print(*args, **kwargs):
    return None


_PYTHON_SORT_SAFE_BUILTINS = {
    'abs': abs,
    'all': all,
    'any': any,
    'bool': bool,
    'callable': callable,
    'chr': chr,
    'dict': dict,
    'divmod': divmod,
    'enumerate': enumerate,
    'filter': filter,
    'float': float,
    'format': format,
    'frozenset': frozenset,
    'hash': hash,
    'int': int,
    'isinstance': isinstance,
    'iter': iter,
    'len': len,
    'list': list,
    'map': map,
    'max': max,
    'min': min,
    'next': next,
    'ord': ord,
    'pow': _safe_pow,
    'print': _ignore_print,
    'range': _safe_range,
    'repr': repr,
    'reversed': reversed,
    'round': round,
    'set': set,
    'slice': slice,
    'sorted': sorted,
    'str': str,
    'sum': sum,
    'tuple': tuple,
    'zip': zip,
    'ArithmeticError': ArithmeticError,
    'AttributeError': AttributeError,
    'Exception': Exception,
    'IndexError': IndexError,
    'KeyError': KeyError,
    'LookupError': LookupError,
    'OverflowError': OverflowError,
    'RuntimeError': RuntimeError,
    'StopIteration': StopIteration,
    'TypeError': TypeError,
    'ValueError': ValueError,
    'ZeroDivisionError': ZeroDivisionError,
}
_PYTHON_SORT_HELPER_NAMES = {
    'natural_key',
    'pinyin_key',
    'pinyin_initial_key',
    'cmp_to_key',
}
# 只导出列出的成员：真实模块对象会带出 sys、os 等引用，不能直接交给策略代码。
# 不含无限迭代器（count、cycle、repeat）和按字符串取属性的工具（attrgetter、methodcaller）。
_PYTHON_SORT_MODULE_EXPORTS = {
    'math': (
        math,
        (
            'ceil', 'copysign', 'cos', 'degrees', 'dist', 'e', 'exp', 'fabs', 'floor', 'fmod', 'fsum',
            'gcd', 'hypot', 'inf', 'isclose', 'isfinite', 'isinf', 'isnan', 'log', 'log10', 'log2',
            'modf', 'nan', 'pi', 'pow', 'prod', 'radians', 'sin', 'sqrt', 'tan', 'atan', 'atan2', 'trunc',
        ),
    ),
    'itertools': (
        itertools,
        (
            'accumulate', 'batched', 'chain', 'combinations', 'combinations_with_replacement', 'compress',
            'dropwhile', 'filterfalse', 'groupby', 'islice', 'pairwise', 'permutations', 'product',
            'starmap', 'takewhile', 'zip_longest',
        ),
    ),
    'functools': (functools, ('cmp_to_key', 'partial', 'reduce')),
    'collections': (collections, ('Counter', 'OrderedDict', 'defaultdict', 'deque')),
    'statistics': (
        statistics,
        (
            'fmean', 'mean', 'median', 'median_high', 'median_low', 'mode', 'multimode', 'pstdev',
            'pvariance', 'quantiles', 'stdev', 'variance',
        ),
    ),
    'operator': (operator, ('itemgetter',)),
    're': (
        re,
        (
            'DOTALL', 'I', 'IGNORECASE', 'M', 'MULTILINE', 'S', 'compile', 'escape', 'findall',
            'finditer', 'fullmatch', 'match', 'search', 'split', 'sub',
        ),
    ),
}
_PYTHON_SORT_RANDOM_EXPORTS = (
    'choice', 'choices', 'gauss', 'randint', 'random', 'randrange', 'sample', 'seed', 'shuffle', 'uniform',
)
PYTHON_SORT_MODULES = tuple(sorted([*_PYTHON_SORT_MODULE_EXPORTS, 'random']))
_PYTHON_SORT_MODULE_MEMBERS = {
    **{name: frozenset(exports) for name, (_, exports) in _PYTHON_SORT_MODULE_EXPORTS.items()},
    'random': frozenset(_PYTHON_SORT_RANDOM_EXPORTS),
}
# 属性一律走白名单。gi_frame、f_globals 这类自省属性不带双下划线，
# 只拦双下划线挡不住它们顺着调用栈取回真实的内置函数。
_PYTHON_SORT_ALLOWED_ATTRIBUTES = {
    # str
    'capitalize', 'casefold', 'center', 'count', 'endswith', 'find', 'index', 'isalnum', 'isalpha',
    'isdecimal', 'isdigit', 'islower', 'isnumeric', 'isspace', 'isupper', 'join', 'ljust', 'lower',
    'lstrip', 'partition', 'removeprefix', 'removesuffix', 'replace', 'rfind', 'rindex', 'rjust',
    'rpartition', 'rsplit', 'rstrip', 'split', 'splitlines', 'startswith', 'strip', 'swapcase', 'title',
    'upper', 'zfill',
    # list / deque
    'append', 'appendleft', 'clear', 'copy', 'extend', 'extendleft', 'insert', 'pop', 'popleft',
    'remove', 'reverse', 'rotate', 'sort',
    # dict / Counter / OrderedDict
    'elements', 'fromkeys', 'get', 'items', 'keys', 'most_common', 'move_to_end', 'popitem',
    'setdefault', 'subtract', 'total', 'update', 'values',
    # set
    'add', 'difference', 'difference_update', 'discard', 'intersection', 'intersection_update',
    'isdisjoint', 'issubset', 'issuperset', 'symmetric_difference', 'union',
    # 数字、异常、正则匹配结果
    'args', 'bit_length', 'end', 'from_iterable', 'group', 'groupdict', 'groups', 'is_integer', 'span',
    'start',
}
for _members in _PYTHON_SORT_MODULE_MEMBERS.values():
    _PYTHON_SORT_ALLOWED_ATTRIBUTES |= _members
del _members

_PYTHON_SORT_BANNED_NODES = tuple(
    getattr(ast, name)
    for name in (
        'AsyncFor', 'AsyncFunctionDef', 'AsyncWith', 'Await', 'ClassDef', 'Interpolation', 'Match',
        'TemplateStr', 'TryStar', 'TypeAlias', 'With',
    )
    if hasattr(ast, name)
)
PYTHON_SORT_CONTRACT = {
    'function': f'{PYTHON_SORT_FUNCTION}(students)',
    'example': PYTHON_SORT_EXAMPLE,
    'student_fields': [
        'id', 'name', 'student_id', 'gender', 'score', 'classroom', 'group', 'custom_data', 'seat',
    ],
    'returns': '包含全部学生的排序后列表，元素可以是学生字典或学生 ID',
    'syntax': (
        '支持 for / while 循环、try / except / raise、辅助函数、嵌套函数、lambda、生成器、推导式、'
        'f-string，以及顶层常量赋值；不支持 class、with、match、async、装饰器、finally 和不带类型的 except'
    ),
    'modules': list(PYTHON_SORT_MODULES),
    'helpers': sorted(_PYTHON_SORT_HELPER_NAMES),
    'limits': {
        'source_chars': MAX_PYTHON_SORT_SOURCE,
        'seconds': PYTHON_SORT_TIME_LIMIT,
        'range_length': PYTHON_SORT_RANGE_LIMIT,
        'power_exponent': MAX_PYTHON_SORT_POWER,
    },
    'notes': (
        '模块可以直接使用，也可以 import；只开放列出的模块成员。不能访问以双下划线开头的名称，'
        '不能读写文件、联网或启动进程；属性只能用常见的字符串、列表、字典、集合方法。'
    ),
}


class _SortBudgetExceeded(BaseException):
    """继承 BaseException，策略代码里的 except Exception 接不住它。"""


def _is_private_name(name):
    return str(name or '').startswith('__')


def _defined_names(tree):
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.Lambda)):
            if isinstance(node, ast.FunctionDef):
                names.add(node.name)
            arguments = node.args
            for argument in (*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs):
                names.add(argument.arg)
            for argument in (arguments.vararg, arguments.kwarg):
                if argument is not None:
                    names.add(argument.arg)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            names.add(node.id)
        elif isinstance(node, ast.alias):
            names.add(node.asname or node.name.split('.')[0])
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
    return names


class _PythonSortValidator(ast.NodeVisitor):
    def __init__(self, defined_names=()):
        self.callable_names = (
            set(_PYTHON_SORT_SAFE_BUILTINS) | _PYTHON_SORT_HELPER_NAMES | set(PYTHON_SORT_MODULES)
            | set(defined_names)
        )

    def generic_visit(self, node):
        if isinstance(node, _PYTHON_SORT_BANNED_NODES):
            raise ValueError(f'Python 排序代码不支持 {node.__class__.__name__}')
        return super().generic_visit(node)

    def visit_Name(self, node):
        if _is_private_name(node.id):
            raise ValueError('Python 排序代码不能访问双下划线名称')
        return self.generic_visit(node)

    def visit_arg(self, node):
        if _is_private_name(node.arg):
            raise ValueError('Python 排序代码不能使用双下划线参数名')
        return self.generic_visit(node)

    def visit_keyword(self, node):
        if _is_private_name(node.arg):
            raise ValueError('Python 排序代码不能使用双下划线参数名')
        return self.generic_visit(node)

    def visit_Global(self, node):
        if any(_is_private_name(name) for name in node.names):
            raise ValueError('Python 排序代码不能访问双下划线名称')
        return self.generic_visit(node)

    visit_Nonlocal = visit_Global

    def visit_FunctionDef(self, node):
        if _is_private_name(node.name):
            raise ValueError('Python 排序代码不能定义双下划线函数')
        if node.decorator_list:
            raise ValueError('Python 排序代码不支持装饰器')
        return self.generic_visit(node)

    def visit_Attribute(self, node):
        if _is_private_name(node.attr):
            raise ValueError('Python 排序代码不能访问双下划线属性')
        if not isinstance(node.ctx, ast.Load):
            raise ValueError('Python 排序代码不能给属性赋值或删除属性')
        if node.attr not in _PYTHON_SORT_ALLOWED_ATTRIBUTES:
            raise ValueError(f'Python 排序代码不能访问属性 {node.attr}')
        return self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name):
            if node.func.id not in self.callable_names:
                raise ValueError(f'Python 排序代码不能调用 {node.func.id}')
        elif not isinstance(node.func, ast.Attribute):
            raise ValueError('Python 排序代码包含不支持的调用形式')
        return self.generic_visit(node)

    def _check_power(self, operator_node, exponent):
        if not isinstance(operator_node, ast.Pow):
            return
        if isinstance(exponent, ast.UnaryOp) and isinstance(exponent.op, (ast.USub, ast.UAdd)):
            exponent = exponent.operand
        value = exponent.value if isinstance(exponent, ast.Constant) else None
        if isinstance(value, bool) or not isinstance(value, (int, float)) or abs(value) > MAX_PYTHON_SORT_POWER:
            raise ValueError(
                f'Python 排序代码的幂运算指数必须是绝对值不超过 {MAX_PYTHON_SORT_POWER} 的数字常量'
            )

    def visit_BinOp(self, node):
        self._check_power(node.op, node.right)
        return self.generic_visit(node)

    def visit_AugAssign(self, node):
        self._check_power(node.op, node.value)
        return self.generic_visit(node)

    def visit_Try(self, node):
        if node.finalbody:
            raise ValueError('Python 排序代码不支持 finally')
        return self.generic_visit(node)

    def visit_ExceptHandler(self, node):
        if node.type is None:
            raise ValueError('Python 排序代码的 except 必须写明异常类型')
        if _is_private_name(node.name):
            raise ValueError('Python 排序代码不能访问双下划线名称')
        return self.generic_visit(node)

    def _check_module(self, name):
        if name not in _PYTHON_SORT_MODULE_MEMBERS:
            raise ValueError(
                f'Python 排序代码不能导入 {name}，可用模块：{"、".join(PYTHON_SORT_MODULES)}'
            )

    def visit_Import(self, node):
        for alias in node.names:
            self._check_module(alias.name)
            if _is_private_name(alias.asname):
                raise ValueError('Python 排序代码不能访问双下划线名称')
        return self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if node.level:
            raise ValueError('Python 排序代码不能使用相对导入')
        self._check_module(node.module)
        for alias in node.names:
            if alias.name not in _PYTHON_SORT_MODULE_MEMBERS[node.module]:
                raise ValueError(f'Python 排序代码不能从 {node.module} 导入 {alias.name}')
            if _is_private_name(alias.asname):
                raise ValueError('Python 排序代码不能访问双下划线名称')
        return self.generic_visit(node)

    def visit_Constant(self, node):
        if isinstance(node.value, (str, bytes)) and len(node.value) > MAX_PYTHON_SORT_STRING:
            raise ValueError(f'Python 排序代码中的单个字符串不能超过 {MAX_PYTHON_SORT_STRING} 个字符')
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


def _is_docstring(node):
    return isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)


def normalize_python_sort_code(source):
    source = str(source or '').strip()
    if not source:
        raise ValueError('Python 排序代码不能为空')
    if len(source) > MAX_PYTHON_SORT_SOURCE:
        raise ValueError(f'Python 排序代码不能超过 {MAX_PYTHON_SORT_SOURCE} 个字符')
    try:
        tree = ast.parse(source, filename=PYTHON_SORT_SOURCE_NAME, mode='exec')
    except SyntaxError as exc:
        raise ValueError(f'Python 排序代码语法错误：第 {exc.lineno or 1} 行') from exc
    except (RecursionError, MemoryError, ValueError) as exc:
        raise ValueError('Python 排序代码过于复杂') from exc
    if len(list(ast.walk(tree))) > MAX_PYTHON_SORT_NODES:
        raise ValueError('Python 排序代码过于复杂')
    _PythonSortValidator(_defined_names(tree)).visit(tree)
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign)) and (
            not _is_docstring(node)
        ):
            raise ValueError('Python 排序代码的顶层只能包含函数定义、import 和常量赋值')
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == PYTHON_SORT_FUNCTION]
    if len(functions) != 1:
        raise ValueError(f'Python 排序代码必须定义一个 {PYTHON_SORT_FUNCTION}(students) 函数')
    function = functions[0]
    if (
        len(function.args.args) != 1
        or function.args.args[0].arg != 'students'
        or function.args.posonlyargs
        or function.args.kwonlyargs
        or function.args.vararg
        or function.args.kwarg
    ):
        raise ValueError(f'{PYTHON_SORT_FUNCTION} 必须且只能接收 students 参数')
    if not any(isinstance(node, ast.Return) for node in ast.walk(function)):
        raise ValueError(f'{PYTHON_SORT_FUNCTION} 必须返回排序后的学生列表')
    try:
        compile(tree, PYTHON_SORT_SOURCE_NAME, 'exec')
    except (SyntaxError, ValueError, RecursionError) as exc:
        raise ValueError(f'Python 排序代码无法编译：{exc}') from exc
    return source


def _python_sort_namespace():
    generator = random.Random()
    modules = {
        name: types.SimpleNamespace(**{
            export: getattr(module, export) for export in exports if hasattr(module, export)
        })
        for name, (module, exports) in _PYTHON_SORT_MODULE_EXPORTS.items()
    }
    modules['random'] = types.SimpleNamespace(**{
        export: getattr(generator, export) for export in _PYTHON_SORT_RANDOM_EXPORTS
    })

    def import_module(name, globals=None, locals=None, fromlist=(), level=0):
        if level or name not in modules:
            raise ImportError(f'不能导入 {name}')
        return modules[name]

    return {
        '__builtins__': {**_PYTHON_SORT_SAFE_BUILTINS, '__import__': import_module},
        **modules,
        'natural_key': natural_tokens,
        'pinyin_key': lambda value: natural_tokens(pinyin_text(value)),
        'pinyin_initial_key': lambda value: natural_tokens(pinyin_text(value, initials=True)),
        'cmp_to_key': cmp_to_key,
    }


def _run_with_budget(function, *args):
    """只跟踪策略代码自身的帧，超出步数或时间时中止；库函数内部不逐行计数。"""
    deadline = time.monotonic() + PYTHON_SORT_TIME_LIMIT
    steps = 0

    def charge():
        nonlocal steps
        steps += 1
        if steps > PYTHON_SORT_STEP_LIMIT or (steps % 512 == 0 and time.monotonic() > deadline):
            raise _SortBudgetExceeded()

    def trace_lines(frame, event, arg):
        if event == 'line':
            charge()
        return trace_lines

    def trace_calls(frame, event, arg):
        if frame.f_code.co_filename != PYTHON_SORT_SOURCE_NAME:
            return None
        charge()
        return trace_lines

    previous = sys.gettrace()
    sys.settrace(trace_calls)
    try:
        return function(*args)
    finally:
        sys.settrace(previous)


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
    namespace = _python_sort_namespace()

    def run():
        exec(compile(source, PYTHON_SORT_SOURCE_NAME, 'exec'), namespace, namespace)
        return list(namespace[PYTHON_SORT_FUNCTION](records))

    try:
        ordered_items = _run_with_budget(run)
    except _SortBudgetExceeded as exc:
        raise ValueError(
            f'Python 排序代码执行超时：运行超过 {PYTHON_SORT_TIME_LIMIT:g} 秒或循环次数过多，请检查是否存在死循环'
        ) from exc
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


def _normalize_custom_value(value, depth=0):
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        return value[:2000]
    if depth >= 8:
        return str(value)[:2000]
    if isinstance(value, dict):
        normalized = {}
        for raw_key, raw_value in value.items():
            key = str(raw_key or '').strip()
            if not key:
                continue
            normalized[key[:80]] = _normalize_custom_value(raw_value, depth + 1)
            if len(normalized) >= 100:
                break
        return normalized
    if isinstance(value, (list, tuple)):
        return [_normalize_custom_value(item, depth + 1) for item in list(value)[:200]]
    return str(value)[:2000]


def normalize_custom_data(value):
    if not isinstance(value, dict):
        return {}
    normalized = _normalize_custom_value(value)
    return dict(list(normalized.items())[:40])


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
    students = list(students)
    prepared = {}
    for student in students:
        values = []
        for rule in normalized['rules']:
            raw = _student_field_value(student, rule['field'])
            is_null = _is_null(raw)
            values.append((
                is_null,
                None if is_null else _transformed_value(raw, rule['transform'], rule['field']),
            ))
        prepared[id(student)] = values

    def compare(left, right):
        for index, rule in enumerate(normalized['rules']):
            left_null, left_value = prepared[id(left)][index]
            right_null, right_value = prepared[id(right)][index]
            if left_null or right_null:
                if left_null and right_null:
                    continue
                result = -1 if left_null else 1
                if rule['nulls'] == 'last':
                    result *= -1
                return result
            result = _compare_values(
                left_value,
                right_value,
            )
            if result:
                return -result if rule['direction'] == 'desc' else result
        return _compare_values(left.pk or 0, right.pk or 0)

    return sorted(students, key=cmp_to_key(compare))


def definition_for_field(field, direction='asc', transform='auto'):
    return normalize_sort_definition({
        'rules': [{
            'field': field,
            'direction': direction,
            'nulls': 'last',
            'transform': transform,
        }],
    })
