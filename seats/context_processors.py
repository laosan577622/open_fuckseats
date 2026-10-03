from django.conf import settings
import os
import desktop_runtime


def app_runtime(request):
    from seats.models import Classroom
    selected = request.GET.get('classroom', '')
    ai_classroom = Classroom.objects.filter(pk=int(selected)).first() if selected.isdecimal() and len(selected) < 10 else None
    shell = getattr(settings, "APP_SHELL", "browser")
    platform = desktop_runtime.get_platform_name()
    # 浏览器端统一采用 Windows 信息架构；桌面壳仍按运行时系统适配。
    # 如需本地截图或回归测试覆盖，可显式设置 FUCKSEATS_APP_PLATFORM。
    if shell == "browser" and not (os.getenv("FUCKSEATS_APP_PLATFORM") or "").strip():
        platform = "windows"
    ctx = {
        "ai_context_classroom": ai_classroom,
        "app_runtime": {
            "shell": shell,
            "version": desktop_runtime.get_current_version(),
            "platform": platform,
        },
        "onboarding_bootstrap": onboarding_bootstrap(request),
        "is_onboarding": request.path == "/welcome/",
        "wendao_ai_url": getattr(settings, "WENDAO_AI_URL", "https://ai.577622.xyz"),
    }
    return ctx


def onboarding_bootstrap(request):
    """Database state is shared by browser sessions and the desktop shell."""
    if request.path not in ('/', '/welcome/'):
        return None
    from seats.models import Classroom, CloudSession
    from django.utils import timezone
    from seats.onboarding import REQUEST_TOKEN, get_state, payload
    state = get_state()
    has_data = Classroom.objects.exists()
    user = CloudSession.objects.filter(token_expires_at__gt=timezone.now()).values('nickname').first()
    return {**payload(state), 'hasData': has_data, 'cloudUser': user, 'requestToken': REQUEST_TOKEN}
