# Django 自动生成

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0004_alter_classroom_id_alter_layoutsnapshot_id_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='FutureModeConfig',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('api_key', models.CharField(blank=True, default='', max_length=512, verbose_name='OpenAI API Key')),
                ('base_url', models.CharField(blank=True, default='', max_length=300, verbose_name='OpenAI Base URL')),
                ('model', models.CharField(blank=True, default='', max_length=120, verbose_name='OpenAI Model')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('classroom', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='future_mode_config', to='seats.classroom')),
            ],
            options={
                'verbose_name': 'Future Mode 配置',
                'verbose_name_plural': 'Future Mode 配置',
            },
        ),
    ]
