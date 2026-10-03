from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('cloud', '0007_pluginruntimekv')]
    operations = [
        migrations.CreateModel(
            name='CloudClassroomCommit',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version', models.BigIntegerField()),
                ('base_version', models.BigIntegerField(default=0)),
                ('protocol', models.CharField(default='delta-v1', max_length=24)),
                ('changes', models.JSONField(default=list)),
                ('snapshot_hash', models.CharField(blank=True, default='', max_length=64)),
                ('device_id', models.CharField(blank=True, default='', max_length=64)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('classroom', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='commits', to='cloud.cloudclassroom')),
            ],
            options={
                'ordering': ['version', 'pk'],
                'indexes': [models.Index(fields=['classroom', 'version'], name='cloud_commit_chain_idx')],
                'constraints': [models.UniqueConstraint(fields=('classroom', 'version'), name='cloud_commit_version_uniq')],
            },
        ),
    ]
