from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('seats', '0023_onboarding_progress')]
    operations = [migrations.AddField(
        model_name='classroom', name='doors',
        field=models.JSONField(default=list, blank=True, verbose_name='教室门'))]
