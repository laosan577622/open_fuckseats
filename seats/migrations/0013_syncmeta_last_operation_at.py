from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0012_cloudsession_e2ee_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='syncmeta',
            name='last_operation_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='最近操作时间'),
        ),
    ]
