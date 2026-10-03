from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('seats', '0020_pluginruntimekv')]
    operations = [
        migrations.CreateModel(name='WendaoConnection', fields=[
            ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('credentials', models.TextField(blank=True, default='')),
            ('model', models.CharField(blank=True, default='', max_length=200)),
            ('pending_state', models.CharField(blank=True, default='', max_length=64)),
            ('updated_at', models.DateTimeField(auto_now=True)),
        ]),
        migrations.CreateModel(name='WendaoAuthorization', fields=[
            ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('state_hash', models.CharField(max_length=64, unique=True)),
            ('payload', models.TextField()),
            ('status', models.CharField(default='pending', max_length=20)),
            ('expires_at', models.DateTimeField()),
        ]),
    ]
