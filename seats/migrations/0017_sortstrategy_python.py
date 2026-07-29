from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0016_classroom_groups_custom_info_sorting'),
    ]

    operations = [
        migrations.AddField(
            model_name='sortstrategy',
            name='language',
            field=models.CharField(
                choices=[('declarative', '声明式'), ('python', 'Python')],
                default='declarative',
                max_length=16,
                verbose_name='策略语言',
            ),
        ),
        migrations.AddField(
            model_name='sortstrategy',
            name='python_code',
            field=models.TextField(blank=True, default='', verbose_name='Python 排序代码'),
        ),
    ]
