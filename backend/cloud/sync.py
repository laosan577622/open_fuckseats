import copy
import json
import uuid

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .config import get_data_limit, get_effective_subscription_tier, get_tier_limits
from .models import CloudAIConversation, CloudClassroom, CloudHistoryEntry


FUCKSEATS_APP_MARKERS = {'fuckseats', '不想排座位'}
TOP_LEVEL_KEYS = {
    'meta',
    'classroom',
    'seats',
    'groups',
    'students',
    'constraints',
    'current_state',
    'history',
    'ai_conversations',
}
CLASSROOM_KEYS = {
    'name',
    'rows',
    'cols',
    'left_guardian_student_pk',
    'left_guardian_student_id',
    'left_guardian_student_name',
    'right_guardian_student_pk',
    'right_guardian_student_id',
    'right_guardian_student_name',
}
CURRENT_STATE_KEYS = {'classroom', 'students', 'groups', 'seats', 'constraints', 'layout_snapshots'}
STATE_CLASSROOM_KEYS = {'pk', 'name', 'rows', 'cols', 'left_guardian_student_pk', 'right_guardian_student_pk', 'created_at'}
STUDENT_KEYS = {'name', 'student_id', 'gender', 'score'}
STATE_STUDENT_KEYS = {'pk', 'name', 'student_id', 'gender', 'score'}
GROUP_KEYS = {'name', 'order'}
STATE_GROUP_KEYS = {'pk', 'name', 'order', 'leader_student_pk', 'created_at'}
SEAT_KEYS = {'row', 'col', 'cell_type', 'student_pk', 'student_id', 'student_name', 'group_name'}
STATE_SEAT_KEYS = {'row', 'col', 'cell_type', 'student_pk', 'group_pk'}
CONSTRAINT_KEYS = {
    'constraint_type',
    'student_pk',
    'student_id',
    'student_name',
    'target_student_pk',
    'target_student_id',
    'target_student_name',
    'row',
    'col',
    'distance',
    'enabled',
    'note',
}
STATE_CONSTRAINT_KEYS = {'pk', 'constraint_type', 'student_pk', 'target_student_pk', 'row', 'col', 'distance', 'enabled', 'note', 'created_at'}
LAYOUT_SNAPSHOT_KEYS = {'pk', 'name', 'data', 'created_at'}
HISTORY_KEYS = {'entries'}
HISTORY_ENTRY_KEYS = {'action_type', 'payload', 'is_applied', 'created_at'}
AI_CONVERSATION_KEYS = {'session_key', 'title', 'last_mode', 'last_response_id', 'created_at', 'updated_at', 'messages'}
AI_MESSAGE_KEYS = {'role', 'content', 'payload', 'created_at'}
CELL_TYPES = {'seat', 'aisle', 'podium', 'empty'}
CONSTRAINT_TYPES = {
    'must_seat',
    'forbid_seat',
    'must_row',
    'forbid_row',
    'must_col',
    'forbid_col',
    'must_together',
    'forbid_together',
}
AI_ROLES = {'user', 'assistant', 'system', 'tool'}


def payload_size_bytes(payload):
    return len(json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))


def check_payload_size(payload, limit_name='max_push_size_mb'):
    max_mb = get_data_limit(limit_name, 5)
    size = payload_size_bytes(payload)
    if size > max_mb * 1024 * 1024:
        raise ValueError(f'同步数据超过 {max_mb}MB 限制')
    return size


def _effective_limits_for_user(user):
    tier = get_effective_subscription_tier(
        getattr(user, 'subscription_tier', 'free'),
        getattr(user, 'subscription_expires_at', None),
    )
    return tier, get_tier_limits(tier)


def _format_path(path):
    return str(path or 'data')


def _ensure_dict(value, path):
    if not isinstance(value, dict):
        raise ValueError(f'{_format_path(path)} 必须是对象')
    return value


def _ensure_list(value, path):
    if not isinstance(value, list):
        raise ValueError(f'{_format_path(path)} 必须是数组')
    return value


def _reject_unknown_keys(value, allowed_keys, path):
    unknown = sorted(str(key) for key in value.keys() if key not in allowed_keys)
    if unknown:
        preview = '、'.join(unknown[:5])
        raise ValueError(f'{_format_path(path)} 包含不支持字段：{preview}')


def _normalize_app_marker(value):
    marker = str(value or '').strip().lower().replace(' ', '').replace('_', '').replace('-', '')
    if marker == '不想排座位':
        return marker
    if marker == 'fuckseats':
        return 'fuckseats'
    return marker


def _validate_meta(meta, path, require_full_schema=True):
    meta = _ensure_dict(meta, path)
    marker = _normalize_app_marker(meta.get('app') or meta.get('product') or meta.get('name'))
    if marker not in FUCKSEATS_APP_MARKERS:
        raise ValueError('仅允许上传 FuckSeats 生成的 .seats 数据')
    if require_full_schema:
        if str(meta.get('schema') or '').strip() != 'full':
            raise ValueError('FuckSeats 数据 schema 必须为 full')
        if str(meta.get('version') or '').strip() != '2.0':
            raise ValueError('FuckSeats 数据版本必须为 2.0')


def _to_int(value, path, minimum=None, maximum=None, allow_none=False):
    if value in (None, '') and allow_none:
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValueError(f'{_format_path(path)} 必须是整数')
    if minimum is not None and number < minimum:
        raise ValueError(f'{_format_path(path)} 不能小于 {minimum}')
    if maximum is not None and number > maximum:
        raise ValueError(f'{_format_path(path)} 不能大于 {maximum}')
    return number


def _to_float(value, path):
    if value in (None, ''):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f'{_format_path(path)} 必须是数字')


def _validate_student_payload(item, path, allowed_keys):
    item = _ensure_dict(item, path)
    _reject_unknown_keys(item, allowed_keys, path)
    if 'pk' in allowed_keys:
        _to_int(item.get('pk'), f'{path}.pk', minimum=1)
    name = str(item.get('name') or '').strip()
    if not name:
        raise ValueError(f'{_format_path(path)} 缺少学生姓名')
    gender = item.get('gender')
    if gender not in (None, '', 'M', 'F'):
        raise ValueError(f'{_format_path(path)} 性别字段不合法')
    _to_float(item.get('score'), f'{path}.score')


def _validate_group_payload(item, path, allowed_keys):
    item = _ensure_dict(item, path)
    _reject_unknown_keys(item, allowed_keys, path)
    if 'pk' in allowed_keys:
        _to_int(item.get('pk'), f'{path}.pk', minimum=1)
        _to_int(item.get('leader_student_pk'), f'{path}.leader_student_pk', minimum=1, allow_none=True)
    if not str(item.get('name') or '').strip():
        raise ValueError(f'{_format_path(path)} 缺少小组名称')
    _to_int(item.get('order') or 0, f'{path}.order')


def _validate_cell_type(value, path):
    if str(value or 'seat') not in CELL_TYPES:
        raise ValueError(f'{_format_path(path)} 单元类型不合法')


def _validate_seat_payload(item, path, allowed_keys, rows, cols):
    item = _ensure_dict(item, path)
    _reject_unknown_keys(item, allowed_keys, path)
    _to_int(item.get('row'), f'{path}.row', minimum=1, maximum=rows)
    _to_int(item.get('col'), f'{path}.col', minimum=1, maximum=cols)
    _validate_cell_type(item.get('cell_type'), f'{path}.cell_type')


def _validate_constraint_payload(item, path, allowed_keys, rows, cols):
    item = _ensure_dict(item, path)
    _reject_unknown_keys(item, allowed_keys, path)
    constraint_type = str(item.get('constraint_type') or '').strip()
    if constraint_type not in CONSTRAINT_TYPES:
        raise ValueError(f'{_format_path(path)} 约束类型不合法')
    if 'pk' in allowed_keys:
        _to_int(item.get('pk'), f'{path}.pk', minimum=1)
    _to_int(item.get('row'), f'{path}.row', minimum=1, maximum=rows, allow_none=True)
    _to_int(item.get('col'), f'{path}.col', minimum=1, maximum=cols, allow_none=True)
    _to_int(item.get('distance') or 1, f'{path}.distance', minimum=1)
    if item.get('enabled') not in (None, True, False):
        raise ValueError(f'{_format_path(path)} enabled 必须是布尔值')


def _validate_classroom_payload(classroom, path, allowed_keys=CLASSROOM_KEYS):
    classroom = _ensure_dict(classroom, path)
    _reject_unknown_keys(classroom, allowed_keys, path)
    if 'pk' in allowed_keys:
        _to_int(classroom.get('pk'), f'{path}.pk', minimum=1)
    if not str(classroom.get('name') or '').strip():
        raise ValueError(f'{_format_path(path)} 缺少班级名称')
    rows = _to_int(classroom.get('rows'), f'{path}.rows', minimum=1)
    cols = _to_int(classroom.get('cols'), f'{path}.cols', minimum=1)
    return rows, cols


def _validate_seat_grid(seats, path, rows, cols, allowed_keys):
    seats = _ensure_list(seats, path)
    seen = set()
    for index, item in enumerate(seats):
        _validate_seat_payload(item, f'{path}[{index}]', allowed_keys, rows, cols)
        coord = (int(item.get('row')), int(item.get('col')))
        if coord in seen:
            raise ValueError(f'{_format_path(path)} 存在重复座位：{coord[0]}-{coord[1]}')
        seen.add(coord)
    expected = rows * cols
    if len(seats) != expected:
        raise ValueError(f'{_format_path(path)} 数量必须等于班级行列数 {expected}')


def _validate_layout_payload_data(data, path):
    data = _ensure_dict(data, path)
    allowed = {'meta', 'classroom', 'seats', 'groups', 'students', 'constraints'}
    _reject_unknown_keys(data, allowed, path)
    _validate_meta(data.get('meta'), f'{path}.meta', require_full_schema=False)
    rows, cols = _validate_classroom_payload(data.get('classroom'), f'{path}.classroom')
    _validate_seat_grid(data.get('seats'), f'{path}.seats', rows, cols, SEAT_KEYS)
    for index, item in enumerate(_ensure_list(data.get('groups'), f'{path}.groups')):
        _validate_group_payload(item, f'{path}.groups[{index}]', GROUP_KEYS)
    if 'students' in data:
        for index, item in enumerate(_ensure_list(data.get('students'), f'{path}.students')):
            _validate_student_payload(item, f'{path}.students[{index}]', STUDENT_KEYS)
    if 'constraints' in data:
        for index, item in enumerate(_ensure_list(data.get('constraints'), f'{path}.constraints')):
            _validate_constraint_payload(item, f'{path}.constraints[{index}]', CONSTRAINT_KEYS, rows, cols)


def _validate_current_state(state, path):
    state = _ensure_dict(state, path)
    _reject_unknown_keys(state, CURRENT_STATE_KEYS, path)
    rows, cols = _validate_classroom_payload(state.get('classroom'), f'{path}.classroom', STATE_CLASSROOM_KEYS)
    for index, item in enumerate(_ensure_list(state.get('students'), f'{path}.students')):
        _validate_student_payload(item, f'{path}.students[{index}]', STATE_STUDENT_KEYS)
    for index, item in enumerate(_ensure_list(state.get('groups'), f'{path}.groups')):
        _validate_group_payload(item, f'{path}.groups[{index}]', STATE_GROUP_KEYS)
    _validate_seat_grid(state.get('seats'), f'{path}.seats', rows, cols, STATE_SEAT_KEYS)
    for index, item in enumerate(_ensure_list(state.get('constraints'), f'{path}.constraints')):
        _validate_constraint_payload(item, f'{path}.constraints[{index}]', STATE_CONSTRAINT_KEYS, rows, cols)
    for index, item in enumerate(_ensure_list(state.get('layout_snapshots'), f'{path}.layout_snapshots')):
        item = _ensure_dict(item, f'{path}.layout_snapshots[{index}]')
        _reject_unknown_keys(item, LAYOUT_SNAPSHOT_KEYS, f'{path}.layout_snapshots[{index}]')
        _to_int(item.get('pk'), f'{path}.layout_snapshots[{index}].pk', minimum=1)
        if not str(item.get('name') or '').strip():
            raise ValueError(f'{_format_path(path)}.layout_snapshots[{index}] 缺少快照名称')
        _validate_layout_payload_data(item.get('data'), f'{path}.layout_snapshots[{index}].data')


def _history_entries(data):
    history = data.get('history')
    if isinstance(history, dict) and isinstance(history.get('entries'), list):
        return history.get('entries')
    return []


def _validate_history(data):
    history = _ensure_dict(data.get('history'), 'history')
    _reject_unknown_keys(history, HISTORY_KEYS, 'history')
    entries = _ensure_list(history.get('entries'), 'history.entries')
    for index, item in enumerate(entries):
        item = _ensure_dict(item, f'history.entries[{index}]')
        _reject_unknown_keys(item, HISTORY_ENTRY_KEYS, f'history.entries[{index}]')
        if not isinstance(item.get('payload'), dict):
            raise ValueError(f'history.entries[{index}].payload 必须是对象')
        if item.get('is_applied') not in (None, True, False):
            raise ValueError(f'history.entries[{index}].is_applied 必须是布尔值')
    return entries


def _validate_ai_conversations(value):
    conversations = _ensure_list(value, 'ai_conversations')
    for index, item in enumerate(conversations):
        item = _ensure_dict(item, f'ai_conversations[{index}]')
        _reject_unknown_keys(item, AI_CONVERSATION_KEYS, f'ai_conversations[{index}]')
        messages = _ensure_list(item.get('messages'), f'ai_conversations[{index}].messages')
        for message_index, message in enumerate(messages):
            message = _ensure_dict(message, f'ai_conversations[{index}].messages[{message_index}]')
            _reject_unknown_keys(message, AI_MESSAGE_KEYS, f'ai_conversations[{index}].messages[{message_index}]')
            role = str(message.get('role') or '').strip()
            if role not in AI_ROLES:
                raise ValueError(f'ai_conversations[{index}].messages[{message_index}].role 不合法')
            if not isinstance(message.get('payload'), dict):
                raise ValueError(f'ai_conversations[{index}].messages[{message_index}].payload 必须是对象')


def validate_fuckseats_snapshot(data):
    data = _ensure_dict(data, 'data')
    if 'future_mode_config' in data:
        raise PermissionError('云端同步不接收 Future Mode 配置')
    _reject_unknown_keys(data, TOP_LEVEL_KEYS, 'data')
    required = {'meta', 'classroom', 'seats', 'groups', 'students', 'constraints', 'current_state', 'history'}
    missing = sorted(key for key in required if key not in data)
    if missing:
        raise ValueError(f'FuckSeats 数据缺少字段：{"、".join(missing)}')

    _validate_meta(data.get('meta'), 'meta', require_full_schema=True)
    rows, cols = _validate_classroom_payload(data.get('classroom'), 'classroom')
    for index, item in enumerate(_ensure_list(data.get('students'), 'students')):
        _validate_student_payload(item, f'students[{index}]', STUDENT_KEYS)
    for index, item in enumerate(_ensure_list(data.get('groups'), 'groups')):
        _validate_group_payload(item, f'groups[{index}]', GROUP_KEYS)
    _validate_seat_grid(data.get('seats'), 'seats', rows, cols, SEAT_KEYS)
    for index, item in enumerate(_ensure_list(data.get('constraints'), 'constraints')):
        _validate_constraint_payload(item, f'constraints[{index}]', CONSTRAINT_KEYS, rows, cols)
    _validate_current_state(data.get('current_state'), 'current_state')
    history_entries = _validate_history(data)
    if 'ai_conversations' in data:
        _validate_ai_conversations(data.get('ai_conversations'))
    return history_entries


def validate_snapshot_for_tier(data, tier, limits=None):
    limits = limits if isinstance(limits, dict) else get_tier_limits(tier)
    history_entries = validate_fuckseats_snapshot(data)
    max_history_steps = int(limits.get('max_history_steps', 0) or 0)
    if max_history_steps != -1 and len(history_entries) > max_history_steps:
        if max_history_steps <= 0:
            raise PermissionError('当前订阅不支持同步历史记录')
        raise PermissionError(f'当前订阅最多同步 {max_history_steps} 条历史记录，文件包含 {len(history_entries)} 条')
    if not bool(limits.get('sync_ai_conversations', False)) and data.get('ai_conversations'):
        raise PermissionError('当前订阅不支持同步 AI 对话')


def validate_snapshot_for_user(user, data):
    tier, limits = _effective_limits_for_user(user)
    if not limits.get('sync_enabled', True):
        raise PermissionError('当前订阅不支持云同步')
    validate_snapshot_for_tier(data, tier, limits)
    return tier, limits


def validate_push_payload(user, payload):
    if not isinstance(payload, dict):
        raise ValueError('同步数据必须是对象')
    data = payload.get('data') if isinstance(payload.get('data'), dict) else None
    if not data:
        raise ValueError('缺少 data')
    check_payload_size(data, 'max_push_size_mb')
    tier, limits = validate_snapshot_for_user(user, data)
    classroom_uuid = payload.get('uuid')
    if not classroom_uuid:
        raise ValueError('缺少 uuid')
    try:
        classroom_uuid = str(uuid.UUID(str(classroom_uuid)))
    except (TypeError, ValueError):
        raise ValueError('uuid 格式错误')
    return data, classroom_uuid, tier, limits


def _trim_entries(entries, max_steps):
    if not isinstance(entries, list):
        return []
    if max_steps == -1:
        return entries
    if max_steps <= 0:
        return []
    return entries[-max_steps:]


def trim_snapshot_for_tier(data, tier):
    limits = get_tier_limits(tier)
    max_history_steps = int(limits.get('max_history_steps', 0) or 0)
    sync_ai_conversations = bool(limits.get('sync_ai_conversations', False))

    snapshot = copy.deepcopy(data if isinstance(data, dict) else {})
    history = snapshot.get('history')
    if isinstance(history, dict):
        history['entries'] = _trim_entries(history.get('entries'), max_history_steps)
        snapshot['history'] = history

    if isinstance(snapshot.get('history_entries'), list):
        snapshot['history_entries'] = _trim_entries(snapshot.get('history_entries'), max_history_steps)

    if not sync_ai_conversations:
        snapshot.pop('ai_conversations', None)

    return snapshot


def extract_classroom_fields(data):
    classroom = data.get('classroom') if isinstance(data.get('classroom'), dict) else {}
    name = str(classroom.get('name') or data.get('name') or '未命名班级').strip() or '未命名班级'
    rows = int(classroom.get('rows') or data.get('rows') or 6)
    cols = int(classroom.get('cols') or data.get('cols') or 8)
    return name[:100], rows, cols


def _parse_created_at(value):
    if not value:
        return timezone.now()
    parsed = parse_datetime(str(value))
    if parsed and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed or timezone.now()


def _parse_operation_time(value):
    if not value:
        return None
    parsed = parse_datetime(str(value))
    if parsed and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def sync_child_records(classroom, snapshot, device_id=''):
    CloudHistoryEntry.objects.filter(classroom=classroom).delete()
    history = snapshot.get('history')
    entries = []
    if isinstance(history, dict) and isinstance(history.get('entries'), list):
        entries = history.get('entries')
    elif isinstance(snapshot.get('history_entries'), list):
        entries = snapshot.get('history_entries')

    CloudHistoryEntry.objects.bulk_create([
        CloudHistoryEntry(
            classroom=classroom,
            action_type=str(item.get('action_type') or item.get('type') or '')[:40] if isinstance(item, dict) else '',
            payload=copy.deepcopy(item.get('payload') if isinstance(item, dict) and isinstance(item.get('payload'), dict) else item if isinstance(item, dict) else {}),
            device_id=str(device_id or '')[:64],
            created_at=_parse_created_at(item.get('created_at')) if isinstance(item, dict) else timezone.now(),
        )
        for item in entries
        if isinstance(item, dict)
    ])

    CloudAIConversation.objects.filter(classroom=classroom).delete()
    conversations = snapshot.get('ai_conversations')
    if isinstance(conversations, list):
        CloudAIConversation.objects.bulk_create([
            CloudAIConversation(
                classroom=classroom,
                title=str(item.get('title') or '新对话')[:120],
                messages=copy.deepcopy(item.get('messages') if isinstance(item.get('messages'), list) else []),
                created_at=_parse_created_at(item.get('created_at')),
                updated_at=_parse_created_at(item.get('updated_at')),
            )
            for item in conversations
            if isinstance(item, dict)
        ])


def push_classroom_snapshot(user, payload):
    data, classroom_uuid, tier, limits = validate_push_payload(user, payload)

    device_id = str(payload.get('device_id') or '')[:64]
    force = bool(payload.get('force'))
    operation_at = _parse_operation_time(
        payload.get('last_operation_at') or payload.get('local_operation_at') or payload.get('operation_time')
    )
    client_version_value = payload.get('base_version')
    if client_version_value in (None, ''):
        client_version_value = payload.get('cloud_version')
    if client_version_value in (None, ''):
        client_version_value = payload.get('local_version')
    client_version = int(client_version_value or 0)
    classroom = CloudClassroom.objects.filter(uuid=classroom_uuid, user=user).first()
    if classroom and classroom.is_deleted:
        classroom.is_deleted = False

    if classroom and client_version < classroom.version and not force:
        return {
            'ok': False,
            'conflict': True,
            'version': classroom.version,
            'message': '云端版本更新，请先拉取或让用户选择保留版本',
        }

    if classroom is None:
        max_classrooms = int(limits.get('max_classrooms', 3) or 3)
        if max_classrooms != -1:
            count = CloudClassroom.objects.filter(user=user, is_deleted=False).count()
            if count >= max_classrooms:
                raise PermissionError(f'当前订阅最多同步 {max_classrooms} 个班级')
        classroom = CloudClassroom(user=user, uuid=classroom_uuid)

    snapshot = copy.deepcopy(data)
    name, rows, cols = extract_classroom_fields(snapshot)
    classroom.name = name
    classroom.rows = rows
    classroom.cols = cols
    classroom.data_snapshot = snapshot
    classroom.version = int(classroom.version or 0) + 1
    classroom.last_modified_by = device_id
    classroom.last_modified_at = operation_at or timezone.now()
    classroom.is_deleted = False
    classroom.save()
    sync_child_records(classroom, snapshot, device_id=device_id)

    return {
        'ok': True,
        'uuid': str(classroom.uuid),
        'version': classroom.version,
        'updated_at': classroom.updated_at.isoformat(),
        'last_operation_at': classroom.last_modified_at.isoformat() if classroom.last_modified_at else None,
        'last_modified_at': classroom.last_modified_at.isoformat() if classroom.last_modified_at else None,
    }
