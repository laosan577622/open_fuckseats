from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ('cloud', '0005_remove_redeem_code'),
    ]

    operations = [
        migrations.AddField(
            model_name='cloudclassroomgroup',
            name='data_snapshot',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='cloudclassroomgroup',
            name='last_modified_at',
            field=models.DateTimeField(default=django.utils.timezone.now),
        ),
    ]
