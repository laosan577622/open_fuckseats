from django.conf import settings
import desktop_runtime


def app_runtime(request):
    ctx = {
        "app_runtime": {
            "shell": getattr(settings, "APP_SHELL", "browser"),
            "version": desktop_runtime.get_current_version(),
            "platform": desktop_runtime.get_platform_name(),
        },
        "onboarding_should_show": _onboarding_should_show(request),
        "onboarding_sample_pk": request.session.get('onboarding_sample_pk') if hasattr(request, 'session') else None,
        "wendao_ai_url": getattr(settings, "WENDAO_AI_URL", "https://ai.577622.xyz"),
    }
    return ctx


def _ensure_session_key(request):
    sk = request.session.session_key
    if not sk:
        request.session['ob_init'] = True
        request.session.save()
        sk = request.session.session_key
    return sk


def _onboarding_should_show(request):
    path = getattr(request, 'path', '') or ''
    if path.startswith('/admin') or path.startswith('/static') or path.startswith('/media'):
        return False
    if getattr(request, 'method', 'GET') != 'GET':
        return False
    try:
        from seats.models import (
            FrontendKVStore,
            ONBOARDING_SEEN_STORE_KEY,
            ONBOARDING_SEEN_STORE_VALUE,
            OnboardingState,
        )
    except Exception:
        return False
    try:
        value = FrontendKVStore.objects.filter(
            key=ONBOARDING_SEEN_STORE_KEY,
        ).values_list('value', flat=True).first()
        if str(value or '').strip().lower() in {'1', 'true', 'yes', 'seen'}:
            return False
    except Exception:
        pass
    try:
        if OnboardingState.objects.filter(seen=True).exists():
            FrontendKVStore.objects.update_or_create(
                key=ONBOARDING_SEEN_STORE_KEY,
                defaults={'value': ONBOARDING_SEEN_STORE_VALUE},
            )
            return False
    except Exception:
        pass
    try:
        sk = _ensure_session_key(request)
    except Exception:
        return False
    if not sk:
        return False
    try:
        state = OnboardingState.objects.filter(session_key=sk).first()
    except Exception:
        return False
    return state is None or not state.seen
