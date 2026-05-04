from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cloud', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='cloudsession',
            name='client_key_id',
            field=models.CharField(blank=True, default='', max_length=96),
        ),
        migrations.AddField(
            model_name='cloudsession',
            name='client_public_key_pem',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='pendinglogin',
            name='client_key_id',
            field=models.CharField(blank=True, default='', max_length=96),
        ),
        migrations.AddField(
            model_name='pendinglogin',
            name='client_public_key_pem',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.CreateModel(
            name='CloudServiceKey',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key_id', models.CharField(db_index=True, max_length=96, unique=True)),
                ('public_key_pem', models.TextField()),
                ('private_key_pem', models.TextField()),
                ('is_active', models.BooleanField(db_index=True, default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddIndex(
            model_name='cloudservicekey',
            index=models.Index(fields=['is_active', '-updated_at'], name='cloud_service_key_idx'),
        ),
    ]
