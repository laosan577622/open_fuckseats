import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('seats', '0025_ai_student_name_alias')]

    operations = [
        migrations.CreateModel(
            name='LocalSyncSnapshot',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('source', models.CharField(choices=[('local', '本地旧版'), ('cloud', '云端旧版')], max_length=8)),
                ('source_version', models.BigIntegerField(default=0)),
                ('operation_at', models.DateTimeField(blank=True, null=True)),
                ('content_hash', models.CharField(max_length=64)),
                ('data', models.TextField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('classroom', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='local_sync_snapshots', to='seats.classroom')),
            ],
            options={
                'verbose_name': '本地同步快照',
                'verbose_name_plural': '本地同步快照',
                'ordering': ['-created_at', '-pk'],
                'constraints': [models.UniqueConstraint(fields=('classroom', 'source', 'content_hash'), name='local_sync_snapshot_unique')],
            },
        ),
    ]
