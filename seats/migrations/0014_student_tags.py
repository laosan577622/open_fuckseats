import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0013_syncmeta_last_operation_at'),
    ]

    operations = [
        migrations.CreateModel(
            name='StudentTag',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=40, verbose_name='标签名称')),
                ('color', models.CharField(default='#0a59f7', max_length=20, verbose_name='标签颜色')),
                ('description', models.CharField(blank=True, default='', max_length=160, verbose_name='标签说明')),
                ('sort_order', models.PositiveIntegerField(default=0, verbose_name='排序')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('classroom', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='student_tags', to='seats.classroom', verbose_name='所属班级')),
            ],
            options={
                'verbose_name': '学生标签',
                'verbose_name_plural': '学生标签',
                'ordering': ['sort_order', 'name', 'pk'],
                'unique_together': {('classroom', 'name')},
            },
        ),
        migrations.CreateModel(
            name='StudentTagMembership',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('note', models.CharField(blank=True, default='', max_length=120, verbose_name='备注')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('classroom', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='student_tag_memberships', to='seats.classroom', verbose_name='所属班级')),
                ('student', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tag_memberships', to='seats.student', verbose_name='学生')),
                ('tag', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='memberships', to='seats.studenttag', verbose_name='标签')),
            ],
            options={
                'verbose_name': '学生标签关系',
                'verbose_name_plural': '学生标签关系',
                'ordering': ['tag__sort_order', 'tag__name', 'student__name'],
                'unique_together': {('student', 'tag')},
            },
        ),
        migrations.CreateModel(
            name='StudentTagRule',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('rule_type', models.CharField(choices=[('must_area', '只能坐区域'), ('forbid_area', '禁坐区域'), ('separate_same_tag', '同标签保持距离')], max_length=32, verbose_name='规则类型')),
                ('row_min', models.PositiveIntegerField(blank=True, null=True, verbose_name='起始行')),
                ('row_max', models.PositiveIntegerField(blank=True, null=True, verbose_name='结束行')),
                ('col_min', models.PositiveIntegerField(blank=True, null=True, verbose_name='起始列')),
                ('col_max', models.PositiveIntegerField(blank=True, null=True, verbose_name='结束列')),
                ('distance', models.PositiveIntegerField(default=1, verbose_name='距离')),
                ('enabled', models.BooleanField(default=True, verbose_name='启用')),
                ('priority', models.PositiveIntegerField(default=0, verbose_name='优先级')),
                ('note', models.CharField(blank=True, default='', max_length=120, verbose_name='备注')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('classroom', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='student_tag_rules', to='seats.classroom', verbose_name='所属班级')),
                ('tag', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='rules', to='seats.studenttag', verbose_name='标签')),
            ],
            options={
                'verbose_name': '学生标签排座规则',
                'verbose_name_plural': '学生标签排座规则',
                'ordering': ['priority', 'created_at', 'pk'],
            },
        ),
        migrations.AddIndex(
            model_name='studenttag',
            index=models.Index(fields=['classroom', 'name'], name='student_tag_name_idx'),
        ),
        migrations.AddIndex(
            model_name='studenttagmembership',
            index=models.Index(fields=['classroom', 'tag'], name='tag_member_tag_idx'),
        ),
        migrations.AddIndex(
            model_name='studenttagmembership',
            index=models.Index(fields=['classroom', 'student'], name='tag_member_student_idx'),
        ),
        migrations.AddIndex(
            model_name='studenttagrule',
            index=models.Index(fields=['classroom', 'enabled'], name='tag_rule_enabled_idx'),
        ),
        migrations.AddIndex(
            model_name='studenttagrule',
            index=models.Index(fields=['classroom', 'tag'], name='tag_rule_tag_idx'),
        ),
    ]
