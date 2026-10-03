import copy
import hashlib
import json


DELTA_PROTOCOL = 'delta-v1'
MAX_DELTA_OPERATIONS = 20000


def snapshot_hash(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), default=str).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def build_delta(before, after):
    changes = []

    def visit(left, right, path):
        if left == right:
            return
        if isinstance(left, dict) and isinstance(right, dict):
            for key in sorted(left.keys() - right.keys()):
                changes.append({'op': 'delete', 'path': [*path, key]})
            for key in sorted(right.keys()):
                if key not in left:
                    changes.append({'op': 'set', 'path': [*path, key], 'value': copy.deepcopy(right[key])})
                else:
                    visit(left[key], right[key], [*path, key])
            return
        if isinstance(left, list) and isinstance(right, list) and len(left) == len(right):
            for index, (left_item, right_item) in enumerate(zip(left, right)):
                visit(left_item, right_item, [*path, index])
            return
        changes.append({'op': 'set', 'path': list(path), 'value': copy.deepcopy(right)})

    visit(before, after, [])
    return changes


def apply_delta(base, changes):
    if not isinstance(changes, list):
        raise ValueError('增量 changes 必须是数组')
    if len(changes) > MAX_DELTA_OPERATIONS:
        raise ValueError(f'单次增量最多包含 {MAX_DELTA_OPERATIONS} 项修改')
    result = copy.deepcopy(base)
    for item in changes:
        if not isinstance(item, dict):
            raise ValueError('增量修改项格式错误')
        op = str(item.get('op') or '')
        path = item.get('path')
        if op not in {'set', 'delete'} or not isinstance(path, list) or len(path) > 64:
            raise ValueError('增量修改项无效')
        if not path:
            result = None if op == 'delete' else copy.deepcopy(item.get('value'))
            continue
        parent = result
        for part in path[:-1]:
            if isinstance(parent, dict) and isinstance(part, str) and part in parent:
                parent = parent[part]
            elif isinstance(parent, list) and isinstance(part, int) and 0 <= part < len(parent):
                parent = parent[part]
            else:
                raise ValueError('增量路径与基线快照不匹配')
        leaf = path[-1]
        if isinstance(parent, dict) and isinstance(leaf, str):
            if op == 'delete':
                parent.pop(leaf, None)
            else:
                parent[leaf] = copy.deepcopy(item.get('value'))
        elif isinstance(parent, list) and isinstance(leaf, int) and 0 <= leaf < len(parent):
            if op == 'delete':
                parent.pop(leaf)
            else:
                parent[leaf] = copy.deepcopy(item.get('value'))
        else:
            raise ValueError('增量路径与基线快照不匹配')
    return result
