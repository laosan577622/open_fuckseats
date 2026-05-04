from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0011_cloudsession_syncmeta'),
    ]

    operations = [
        migrations.AddField(
            model_name='cloudsession',
            name='client_key_id',
            field=models.CharField(blank=True, default='', max_length=96, verbose_name='本地加密密钥 ID'),
        ),
        migrations.AddField(
            model_name='cloudsession',
            name='client_private_key_pem',
            field=models.TextField(blank=True, default='', verbose_name='本地加密私钥'),
        ),
        migrations.AddField(
            model_name='cloudsession',
            name='client_public_key_pem',
            field=models.TextField(blank=True, default='', verbose_name='本地加密公钥'),
        ),
        migrations.AddField(
            model_name='cloudsession',
            name='server_key_id',
            field=models.CharField(blank=True, default='', max_length=96, verbose_name='云端加密密钥 ID'),
        ),
        migrations.AddField(
            model_name='cloudsession',
            name='server_public_key_pem',
            field=models.TextField(blank=True, default='', verbose_name='云端加密公钥'),
        ),
        migrations.CreateModel(
            name='LocalCloudKeyMaterial',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('scope', models.CharField(default='default', max_length=32, unique=True, verbose_name='密钥作用域')),
                ('key_id', models.CharField(blank=True, default='', max_length=96, verbose_name='本地密钥 ID')),
                ('public_key_pem', models.TextField(blank=True, default='', verbose_name='本地公钥')),
                ('private_key_pem', models.TextField(blank=True, default='', verbose_name='本地私钥')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': '本地云加密密钥',
                'verbose_name_plural': '本地云加密密钥',
            },
        ),
    ]
