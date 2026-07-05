
import uuid
from django.db import migrations, models
import django.db.models.deletion


def create_sync_meta_for_existing_classrooms(apps, schema_editor):
    Classroom = apps.get_model('seats', 'Classroom')
    SyncMeta = apps.get_model('seats', 'SyncMeta')
    for classroom in Classroom.objects.all().only('pk'):
        SyncMeta.objects.get_or_create(classroom_id=classroom.pk)


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0010_classroom_left_guardian_classroom_right_guardian'),
    ]

    operations = [
        migrations.CreateModel(
            name='CloudSession',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('uid', models.CharField(max_length=64, unique=True, verbose_name='老三账户 UID')),
                ('nickname', models.CharField(blank=True, default='', max_length=100, verbose_name='昵称')),
                ('avatar_url', models.URLField(blank=True, default='', verbose_name='头像')),
                ('email', models.EmailField(blank=True, default='', max_length=254, verbose_name='邮箱')),
                ('session_token', models.CharField(max_length=160, verbose_name='云端会话令牌')),
                ('token_expires_at', models.DateTimeField(verbose_name='令牌过期时间')),
                ('subscription_tier', models.CharField(default='free', max_length=16, verbose_name='订阅等级')),
                ('subscription_display_name', models.CharField(default='免费版', max_length=32, verbose_name='订阅显示名')),
                ('subscription_expires_at', models.DateTimeField(blank=True, null=True, verbose_name='订阅过期时间')),
                ('limits', models.JSONField(blank=True, default=dict, verbose_name='订阅限制')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': '云端登录会话',
                'verbose_name_plural': '云端登录会话',
            },
        ),
        migrations.CreateModel(
            name='SyncMeta',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('uuid', models.UUIDField(db_index=True, default=uuid.uuid4, unique=True, verbose_name='云端班级 UUID')),
                ('cloud_version', models.BigIntegerField(default=0, verbose_name='云端版本号')),
                ('local_version', models.BigIntegerField(default=0, verbose_name='本地版本号')),
                ('last_sync_at', models.DateTimeField(blank=True, null=True, verbose_name='最近同步时间')),
                ('last_error', models.TextField(blank=True, default='', verbose_name='最近同步错误')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('classroom', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='sync_meta', to='seats.classroom')),
            ],
            options={
                'verbose_name': '云同步元数据',
                'verbose_name_plural': '云同步元数据',
            },
        ),
        migrations.RunPython(create_sync_meta_for_existing_classrooms, migrations.RunPython.noop),
    ]
