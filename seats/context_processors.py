from django.conf import settings


def app_runtime(request):
    return {
        "app_runtime": {
            "shell": getattr(settings, "APP_SHELL", "browser"),
        }
    }
