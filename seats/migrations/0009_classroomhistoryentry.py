from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0008_frontendkvstore'),
    ]

    operations = [
        migrations.CreateModel(
            name='ClassroomHistoryEntry',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action_type', models.CharField(blank=True, default='', max_length=40, verbose_name='动作类型')),
                ('payload', models.JSONField(blank=True, default=dict, verbose_name='动作载荷')),
                ('is_applied', models.BooleanField(default=True, verbose_name='已应用')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('classroom', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='history_entries', to='seats.classroom')),
            ],
            options={
                'verbose_name': '班级历史记录',
                'verbose_name_plural': '班级历史记录',
                'ordering': ['pk'],
            },
        ),
        migrations.AddIndex(
            model_name='classroomhistoryentry',
            index=models.Index(fields=['classroom', 'is_applied', 'id'], name='class_history_idx'),
        ),
    ]
