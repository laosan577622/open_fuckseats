from django.db import migrations, models
import seats.models


class Migration(migrations.Migration):
    dependencies = [('seats', '0024_classroom_doors')]
    operations = [migrations.CreateModel(
        name='AIStudentNameAlias',
        fields=[
            ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('name', models.CharField(max_length=50, unique=True, verbose_name='学生真名')),
            ('alias', models.CharField(default=seats.models.generate_ai_student_alias, max_length=36, unique=True, verbose_name='AI 脱敏名')),
        ],
        options={'verbose_name': 'AI 学生名称映射', 'verbose_name_plural': 'AI 学生名称映射'},
    )]
