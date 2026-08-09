from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('seats', '0018_classroomgroupstudent'),
    ]

    operations = [
        migrations.AddField(
            model_name='classroomgroup',
            name='cloud_version',
            field=models.BigIntegerField(default=0, verbose_name='云端版本号'),
        ),
        migrations.AddField(
            model_name='classroomgroup',
            name='last_sync_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='最近云同步时间'),
        ),
        migrations.AddField(
            model_name='classroomgroup',
            name='last_synced_fingerprint',
            field=models.CharField(blank=True, default='', max_length=64, verbose_name='最近云同步指纹'),
        ),
    ]
