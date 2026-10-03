"""Device-wide onboarding metadata, independent of browser cookies and classrooms."""
import secrets

from django.db import transaction
from .models import Classroom, OnboardingState, FrontendKVStore, ONBOARDING_SEEN_STORE_KEY

VERSION = '3.0'
KEY = 'device-onboarding-v3'
REQUEST_TOKEN = secrets.token_urlsafe(32)


def get_state():
    existing = OnboardingState.objects.filter(session_key=KEY).first()
    if existing is not None:
        return existing
    legacy = FrontendKVStore.objects.filter(key=ONBOARDING_SEEN_STORE_KEY).values_list('value', flat=True).first()
    returning = Classroom.objects.exists() or str(legacy).strip().lower() in {'1', 'true', 'seen', 'yes'} or OnboardingState.objects.exclude(session_key=KEY).filter(seen=True).exists()
    state, _ = OnboardingState.objects.get_or_create(session_key=KEY, defaults={'returning': returning, 'version': VERSION})
    return state


def payload(state):
    return {'seen': state.seen, 'returning': state.returning, 'version': state.version, 'progress': state.progress}


@transaction.atomic
def save_state(progress):
    current = get_state()
    current = OnboardingState.objects.select_for_update().get(pk=current.pk)
    current.seen = current.seen or progress.get('finished') is True
    current.returning = current.returning or progress.get('returning') is True
    current.progress = progress
    current.version = VERSION
    current.save(update_fields=['seen', 'returning', 'progress', 'version', 'updated_at'])
    return current
