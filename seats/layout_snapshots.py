"""自动快照使用可读时间，并处理同一秒内的重名。"""

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import FrontendKVStore, LayoutSnapshot


SNAPSHOT_ON_EXPORT_KEY = 'seats_snapshot_on_export'


def export_snapshot_enabled():
    return FrontendKVStore.objects.filter(key=SNAPSHOT_ON_EXPORT_KEY).values_list('value', flat=True).first() == '1'


def create_timed_snapshot(classroom, prefix, data, *, at=None):
    timestamp = timezone.localtime(at or timezone.now()).strftime('%Y-%m-%d %H:%M:%S')
    stem = f'{prefix} {timestamp}'
    sequence = 1
    while True:
        name = stem if sequence == 1 else f'{stem}（{sequence}）'
        try:
            with transaction.atomic():
                return LayoutSnapshot.objects.create(classroom=classroom, name=name, data=data)
        except IntegrityError:
            if not LayoutSnapshot.objects.filter(classroom=classroom, name=name).exists():
                raise
            sequence += 1
