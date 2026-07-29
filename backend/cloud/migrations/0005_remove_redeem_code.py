from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('cloud', '0004_cloudclassroomgroup'),
    ]

    operations = [
        migrations.DeleteModel(
            name='RedeemCode',
        ),
    ]
