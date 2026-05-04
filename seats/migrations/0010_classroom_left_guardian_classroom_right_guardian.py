from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('seats', '0009_classroomhistoryentry'),
    ]

    operations = [
        migrations.AddField(
            model_name='classroom',
            name='left_guardian',
            field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='left_guardian_classroom', to='seats.student', verbose_name='左护法'),
        ),
        migrations.AddField(
            model_name='classroom',
            name='right_guardian',
            field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='right_guardian_classroom', to='seats.student', verbose_name='右护法'),
        ),
    ]
