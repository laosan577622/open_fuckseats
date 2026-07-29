from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0017_sortstrategy_python'),
    ]

    operations = [
        migrations.CreateModel(
            name='ClassroomGroupStudent',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=50, verbose_name='姓名')),
                ('student_id', models.CharField(blank=True, max_length=20, null=True, verbose_name='学号')),
                ('gender', models.CharField(blank=True, choices=[('M', '男'), ('F', '女')], max_length=1, null=True, verbose_name='性别')),
                ('score', models.FloatField(default=0, verbose_name='成绩')),
                ('custom_data', models.JSONField(blank=True, default=dict, verbose_name='自定义信息')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('classroom_group', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='unassigned_students', to='seats.classroomgroup', verbose_name='所属班级组')),
            ],
            options={
                'verbose_name': '班级组待分配学生',
                'verbose_name_plural': '班级组待分配学生',
                'ordering': ['name', 'pk'],
            },
        ),
        migrations.AddIndex(
            model_name='classroomgroupstudent',
            index=models.Index(fields=['classroom_group', 'student_id'], name='group_student_id_idx'),
        ),
    ]
