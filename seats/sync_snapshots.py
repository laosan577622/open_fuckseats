import base64
import copy
import hashlib
import json
import zlib

from .models import LocalSyncSnapshot


def sync_content_hash(data):
    """Compare classroom contents without transport timestamps."""
    content = copy.deepcopy(data)
    if isinstance(content, dict) and isinstance(content.get('meta'), dict):
        for key in ('exported_at', 'last_operation_at', 'operation_time'):
            content['meta'].pop(key, None)
    raw = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def save_local_sync_snapshot(classroom, data, *, source, version=0, operation_at=None):
    if not isinstance(data, dict) or not data:
        raise ValueError('旧版数据为空，无法保存本地快照')
    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    snapshot, _ = LocalSyncSnapshot.objects.get_or_create(
        classroom=classroom,
        source=source,
        content_hash=sync_content_hash(data),
        defaults={
            'source_version': int(version or 0),
            'operation_at': operation_at,
            'data': base64.b64encode(zlib.compress(raw, level=6)).decode('ascii'),
        },
    )
    return snapshot


def local_sync_snapshot_data(snapshot):
    try:
        raw = zlib.decompress(base64.b64decode(snapshot.data.encode('ascii'), validate=True))
        data = json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeError, zlib.error) as exc:
        raise ValueError('本地同步快照无法读取') from exc
    if not isinstance(data, dict) or not data:
        raise ValueError('本地同步快照数据为空')
    return data
