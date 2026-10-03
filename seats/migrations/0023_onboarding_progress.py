from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('seats', '0022_syncmeta_cloud_base_snapshot')]
    operations = [
        migrations.AddField('onboardingstate', 'returning', models.BooleanField(default=False, verbose_name='旧版用户')),
        migrations.AddField('onboardingstate', 'version', models.CharField(max_length=16, default='', blank=True)),
        migrations.AddField('onboardingstate', 'progress', models.JSONField(default=dict, blank=True)),
    ]
