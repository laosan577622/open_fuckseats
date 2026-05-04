# Django 自动生成

import django.db.models.deletion
import django.utils.timezone
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='CloudUser',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('uid', models.CharField(db_index=True, max_length=64, unique=True)),
                ('nickname', models.CharField(blank=True, default='', max_length=100)),
                ('email', models.EmailField(blank=True, default='', max_length=254)),
                ('avatar_url', models.URLField(blank=True, default='')),
                ('subscription_tier', models.CharField(default='free', max_length=32)),
                ('subscription_expires_at', models.DateTimeField(blank=True, null=True)),
                ('laosan_access_token', models.CharField(blank=True, default='', max_length=512)),
                ('laosan_token_expires_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name='RedeemCode',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(db_index=True, max_length=64, unique=True)),
                ('tier', models.CharField(max_length=32)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('max_uses', models.PositiveIntegerField(default=1)),
                ('used_count', models.PositiveIntegerField(default=0)),
                ('active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.CreateModel(
            name='CloudSession',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('token', models.CharField(db_index=True, max_length=160, unique=True)),
                ('device_id', models.CharField(blank=True, default='', max_length=64)),
                ('expires_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sessions', to='cloud.clouduser')),
            ],
        ),
        migrations.CreateModel(
            name='PendingLogin',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('state', models.CharField(db_index=True, max_length=96, unique=True)),
                ('session_code', models.CharField(blank=True, db_index=True, max_length=96, null=True, unique=True)),
                ('session_code_created_at', models.DateTimeField(blank=True, null=True)),
                ('callback_url', models.URLField(max_length=1000)),
                ('used', models.BooleanField(default=False)),
                ('oauth_error', models.CharField(blank=True, default='', max_length=200)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, to='cloud.clouduser')),
            ],
        ),
        migrations.CreateModel(
            name='CloudClassroom',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('uuid', models.UUIDField(db_index=True, default=uuid.uuid4, unique=True)),
                ('name', models.CharField(max_length=100)),
                ('rows', models.IntegerField(default=6)),
                ('cols', models.IntegerField(default=8)),
                ('data_snapshot', models.JSONField(default=dict)),
                ('version', models.BigIntegerField(default=0)),
                ('last_modified_by', models.CharField(blank=True, default='', max_length=64)),
                ('last_modified_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('is_deleted', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='classrooms', to='cloud.clouduser')),
            ],
        ),
        migrations.CreateModel(
            name='CloudSnapshot',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=80)),
                ('data', models.JSONField(default=dict)),
                ('size_bytes', models.BigIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('classroom', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='snapshots', to='cloud.cloudclassroom')),
            ],
            options={
                'ordering': ['-created_at', '-pk'],
            },
        ),
        migrations.CreateModel(
            name='CloudHistoryEntry',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action_type', models.CharField(blank=True, default='', max_length=40)),
                ('payload', models.JSONField(blank=True, default=dict)),
                ('device_id', models.CharField(blank=True, default='', max_length=64)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('classroom', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='history_entries', to='cloud.cloudclassroom')),
            ],
            options={
                'ordering': ['created_at', 'pk'],
            },
        ),
        migrations.CreateModel(
            name='CloudAIConversation',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(blank=True, default='新对话', max_length=120)),
                ('messages', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('updated_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('classroom', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='ai_conversations', to='cloud.cloudclassroom')),
            ],
            options={
                'ordering': ['updated_at', 'pk'],
            },
        ),
        migrations.AddIndex(
            model_name='cloudclassroom',
            index=models.Index(fields=['user', 'is_deleted', 'updated_at'], name='cloud_classroom_list_idx'),
        ),
    ]
