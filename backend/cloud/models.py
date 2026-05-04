import uuid

from django.db import models
from django.utils import timezone


class CloudUser(models.Model):
    uid = models.CharField(max_length=64, unique=True, db_index=True)
    nickname = models.CharField(max_length=100, blank=True, default='')
    email = models.EmailField(blank=True, default='')
    avatar_url = models.URLField(blank=True, default='')
    subscription_tier = models.CharField(max_length=32, default='free')
    subscription_expires_at = models.DateTimeField(null=True, blank=True)
    laosan_access_token = models.CharField(max_length=512, blank=True, default='')
    laosan_token_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.uid}-{self.subscription_tier}'


class CloudSession(models.Model):
    user = models.ForeignKey(CloudUser, on_delete=models.CASCADE, related_name='sessions')
    token = models.CharField(max_length=160, unique=True, db_index=True)
    device_id = models.CharField(max_length=64, blank=True, default='')
    client_key_id = models.CharField(max_length=96, blank=True, default='')
    client_public_key_pem = models.TextField(blank=True, default='')
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    def is_valid(self):
        return self.expires_at > timezone.now()

    def __str__(self):
        return f'{self.user_id}-{self.device_id}'


class PendingLogin(models.Model):
    state = models.CharField(max_length=96, unique=True, db_index=True)
    session_code = models.CharField(max_length=96, unique=True, null=True, blank=True, db_index=True)
    session_code_created_at = models.DateTimeField(null=True, blank=True)
    callback_url = models.URLField(max_length=1000)
    client_key_id = models.CharField(max_length=96, blank=True, default='')
    client_public_key_pem = models.TextField(blank=True, default='')
    user = models.ForeignKey(CloudUser, on_delete=models.CASCADE, null=True, blank=True)
    used = models.BooleanField(default=False)
    oauth_error = models.CharField(max_length=200, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.state


class CloudClassroom(models.Model):
    user = models.ForeignKey(CloudUser, on_delete=models.CASCADE, related_name='classrooms')
    uuid = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    name = models.CharField(max_length=100)
    rows = models.IntegerField(default=6)
    cols = models.IntegerField(default=8)
    data_snapshot = models.JSONField(default=dict)
    version = models.BigIntegerField(default=0)
    last_modified_by = models.CharField(max_length=64, blank=True, default='')
    last_modified_at = models.DateTimeField(default=timezone.now)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['user', 'is_deleted', 'updated_at'], name='cloud_classroom_list_idx'),
        ]

    def __str__(self):
        return f'{self.user_id}-{self.name}'


class CloudHistoryEntry(models.Model):
    classroom = models.ForeignKey(CloudClassroom, on_delete=models.CASCADE, related_name='history_entries')
    action_type = models.CharField(max_length=40, blank=True, default='')
    payload = models.JSONField(default=dict, blank=True)
    device_id = models.CharField(max_length=64, blank=True, default='')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['created_at', 'pk']


class CloudAIConversation(models.Model):
    classroom = models.ForeignKey(CloudClassroom, on_delete=models.CASCADE, related_name='ai_conversations')
    title = models.CharField(max_length=120, blank=True, default='新对话')
    messages = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['updated_at', 'pk']


class CloudSnapshot(models.Model):
    classroom = models.ForeignKey(CloudClassroom, on_delete=models.CASCADE, related_name='snapshots')
    name = models.CharField(max_length=80)
    data = models.JSONField(default=dict)
    size_bytes = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-pk']

    def __str__(self):
        return f'{self.classroom_id}-{self.name}'


class CloudServiceKey(models.Model):
    key_id = models.CharField(max_length=96, unique=True, db_index=True)
    public_key_pem = models.TextField()
    private_key_pem = models.TextField()
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['is_active', '-updated_at'], name='cloud_service_key_idx'),
        ]

    def __str__(self):
        return f'{self.key_id}-{"active" if self.is_active else "inactive"}'


class RedeemCode(models.Model):
    code = models.CharField(max_length=64, unique=True, db_index=True)
    tier = models.CharField(max_length=32)
    expires_at = models.DateTimeField(null=True, blank=True)
    max_uses = models.PositiveIntegerField(default=1)
    used_count = models.PositiveIntegerField(default=0)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def can_use(self):
        if not self.active:
            return False
        if self.expires_at and self.expires_at <= timezone.now():
            return False
        return self.used_count < self.max_uses

    def __str__(self):
        return f'{self.code}-{self.tier}'
