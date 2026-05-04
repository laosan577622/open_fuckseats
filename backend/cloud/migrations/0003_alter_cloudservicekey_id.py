from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cloud', '0002_e2ee_keys'),
    ]

    operations = [
        migrations.AlterField(
            model_name='cloudservicekey',
            name='id',
            field=models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID'),
        ),
    ]
