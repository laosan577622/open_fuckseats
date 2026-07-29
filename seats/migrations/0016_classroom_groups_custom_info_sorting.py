import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0015_onboarding_state'),
    ]

    operations = [
        migrations.CreateModel(
            name='ClassroomGroup',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100, verbose_name='班级组名称')),
                ('uuid', models.UUIDField(db_index=True, default=uuid.uuid4, unique=True, verbose_name='班级组 UUID')),
                ('sort_order', models.PositiveIntegerField(default=0, verbose_name='排序')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': '班级组',
                'verbose_name_plural': '班级组',
                'ordering': ['sort_order', 'created_at', 'pk'],
            },
        ),
        migrations.AddField(
            model_name='classroom',
            name='classroom_group',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='classrooms', to='seats.classroomgroup', verbose_name='所属班级组'),
        ),
        migrations.AddField(
            model_name='classroom',
            name='group_order',
            field=models.PositiveIntegerField(default=0, verbose_name='组内排序'),
        ),
        migrations.AddField(
            model_name='student',
            name='custom_data',
            field=models.JSONField(blank=True, default=dict, verbose_name='自定义信息'),
        ),
        migrations.CreateModel(
            name='SortStrategy',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=80, verbose_name='排序方式名称')),
                ('description', models.CharField(blank=True, default='', max_length=240, verbose_name='说明')),
                ('definition', models.JSONField(blank=True, default=dict, verbose_name='排序规则')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('classroom', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='sort_strategies', to='seats.classroom', verbose_name='所属班级')),
                ('classroom_group', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='sort_strategies', to='seats.classroomgroup', verbose_name='所属班级组')),
            ],
            options={
                'verbose_name': '自定义排序方式',
                'verbose_name_plural': '自定义排序方式',
                'ordering': ['name', 'pk'],
            },
        ),
        migrations.AddConstraint(
            model_name='sortstrategy',
            constraint=models.UniqueConstraint(fields=('classroom', 'name'), name='sort_strategy_class_name_uniq'),
        ),
        migrations.AddConstraint(
            model_name='sortstrategy',
            constraint=models.UniqueConstraint(fields=('classroom_group', 'name'), name='sort_strategy_group_name_uniq'),
        ),
    ]
