from django.conf import settings
import desktop_runtime


def app_runtime(request):
    return {
        "app_runtime": {
            "shell": getattr(settings, "APP_SHELL", "browser"),
            "version": desktop_runtime.get_current_version(),
        }
    }
