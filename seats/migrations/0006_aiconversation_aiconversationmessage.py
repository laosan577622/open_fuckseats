
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0005_alter_classroom_id_alter_layoutsnapshot_id_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='AIConversation',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('session_key', models.CharField(blank=True, db_index=True, default='', max_length=64, verbose_name='会话归属')),
                ('title', models.CharField(blank=True, default='新对话', max_length=120, verbose_name='对话标题')),
                ('last_mode', models.CharField(blank=True, default='', max_length=16, verbose_name='最近推理模式')),
                ('last_response_id', models.CharField(blank=True, default='', max_length=120, verbose_name='最近响应ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('classroom', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='ai_conversations', to='seats.classroom')),
            ],
            options={
                'verbose_name': 'AI 对话',
                'verbose_name_plural': 'AI 对话',
                'ordering': ['-updated_at', '-pk'],
                'indexes': [models.Index(fields=['classroom', 'session_key', '-updated_at'], name='ai_conv_owner_idx')],
            },
        ),
        migrations.CreateModel(
            name='AIConversationMessage',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(choices=[('user', '用户'), ('assistant', '助手'), ('system', '系统'), ('tool', '工具')], default='user', max_length=16, verbose_name='角色')),
                ('content', models.TextField(blank=True, default='', verbose_name='消息正文')),
                ('payload', models.JSONField(blank=True, default=dict, verbose_name='扩展载荷')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('conversation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='messages', to='seats.aiconversation')),
            ],
            options={
                'verbose_name': 'AI 对话消息',
                'verbose_name_plural': 'AI 对话消息',
                'ordering': ['created_at', 'pk'],
                'indexes': [models.Index(fields=['conversation', 'created_at', 'id'], name='ai_msg_order_idx')],
            },
        ),
    ]
