from django.db import IntegrityError, OperationalError, ProgrammingError
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .cloud import bump_local_version, ensure_sync_meta, is_sync_bump_suspended
from .models import (
    AIConversation,
    AIConversationMessage,
    Classroom,
    ClassroomHistoryEntry,
    FutureModeConfig,
    LayoutSnapshot,
    Seat,
    SeatConstraint,
    SeatGroup,
    Student,
    StudentTag,
    StudentTagMembership,
    StudentTagRule,
)


def _safe_bump(classroom_id):
    if is_sync_bump_suspended() or not classroom_id:
        return
    try:
        bump_local_version(classroom_id)
    except (IntegrityError, OperationalError, ProgrammingError):
        return


def _conversation_classroom_id(message):
    conversation = getattr(message, 'conversation', None)
    if conversation and conversation.classroom_id:
        return conversation.classroom_id
    if not message.conversation_id:
        return None
    try:
        return AIConversation.objects.filter(pk=message.conversation_id).values_list('classroom_id', flat=True).first()
    except (OperationalError, ProgrammingError):
        return None


@receiver(post_save, sender=Classroom)
def sync_meta_for_classroom(sender, instance, created, **kwargs):
    try:
        ensure_sync_meta(instance)
    except (IntegrityError, OperationalError, ProgrammingError):
        return
    if not created:
        _safe_bump(instance.pk)


@receiver(post_delete, sender=Classroom)
def classroom_deleted(sender, instance, **kwargs):
    return


def _register_classroom_child(model):
    @receiver(post_save, sender=model)
    def child_saved(sender, instance, **kwargs):
        _safe_bump(getattr(instance, 'classroom_id', None))

    @receiver(post_delete, sender=model)
    def child_deleted(sender, instance, **kwargs):
        _safe_bump(getattr(instance, 'classroom_id', None))


for _model in (
    Student,
    Seat,
    SeatGroup,
    LayoutSnapshot,
    SeatConstraint,
    StudentTag,
    StudentTagMembership,
    StudentTagRule,
    FutureModeConfig,
    AIConversation,
    ClassroomHistoryEntry,
):
    _register_classroom_child(_model)


@receiver(post_save, sender=AIConversationMessage)
def ai_message_saved(sender, instance, **kwargs):
    _safe_bump(_conversation_classroom_id(instance))


@receiver(post_delete, sender=AIConversationMessage)
def ai_message_deleted(sender, instance, **kwargs):
    _safe_bump(_conversation_classroom_id(instance))
