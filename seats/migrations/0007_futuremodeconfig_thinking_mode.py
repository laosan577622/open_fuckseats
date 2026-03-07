from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0006_aiconversation_aiconversationmessage'),
    ]

    operations = [
        migrations.AddField(
            model_name='futuremodeconfig',
            name='thinking_mode',
            field=models.CharField(blank=True, default='', max_length=32, verbose_name='思考模式'),
        ),
    ]
