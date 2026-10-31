import re

from django.db import migrations
from django.utils import timezone


def rename_exam_snapshots(apps, schema_editor):
    snapshot_model = apps.get_model('seats', 'LayoutSnapshot')
    pattern = re.compile(r'^(考场前原布局|考后恢复|考场 \d+组×\d+排) [0-9a-f]{8}$')
    for snapshot in snapshot_model.objects.order_by('created_at', 'pk').iterator():
        match = pattern.fullmatch(snapshot.name)
        if not match:
            continue
        timestamp = timezone.localtime(snapshot.created_at).strftime('%Y-%m-%d %H:%M:%S')
        stem = f'{match[1]} {timestamp}'
        name, sequence = stem, 1
        while snapshot_model.objects.filter(classroom_id=snapshot.classroom_id, name=name).exclude(pk=snapshot.pk).exists():
            sequence += 1
            name = f'{stem}（{sequence}）'
        snapshot.name = name
        snapshot.save(update_fields=['name'])


class Migration(migrations.Migration):
    dependencies = [('seats', '0026_local_sync_snapshot')]

    operations = [migrations.RunPython(rename_exam_snapshots, migrations.RunPython.noop)]
