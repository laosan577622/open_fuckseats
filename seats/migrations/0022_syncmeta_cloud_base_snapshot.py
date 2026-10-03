from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('seats', '0021_wendao_connection')]
    operations = [
        migrations.CreateModel(
            name='SyncBaseline',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version', models.BigIntegerField(default=0)),
                ('snapshot', models.JSONField(blank=True, default=dict)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('sync_meta', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='baseline', to='seats.syncmeta')),
            ],
        ),
    ]
