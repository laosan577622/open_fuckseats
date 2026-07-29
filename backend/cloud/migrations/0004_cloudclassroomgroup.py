import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('cloud', '0003_alter_cloudservicekey_id'),
    ]

    operations = [
        migrations.CreateModel(
            name='CloudClassroomGroup',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('uuid', models.UUIDField(db_index=True, default=uuid.uuid4)),
                ('name', models.CharField(max_length=100)),
                ('classroom_uuids', models.JSONField(blank=True, default=list)),
                ('version', models.BigIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='classroom_groups', to='cloud.clouduser')),
            ],
            options={
                'ordering': ['name', 'pk'],
            },
        ),
        migrations.AddConstraint(
            model_name='cloudclassroomgroup',
            constraint=models.UniqueConstraint(fields=('user', 'uuid'), name='cloud_group_user_uuid_uniq'),
        ),
    ]
