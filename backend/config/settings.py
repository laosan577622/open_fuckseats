import os
from pathlib import Path

from cloud.config import get_config


BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG = get_config()
DB_NAME = os.getenv('CLOUD_SQLITE_PATH') or CONFIG.get('database', {}).get('name') or BASE_DIR / 'cloud.sqlite3'
if isinstance(DB_NAME, str) and not os.path.isabs(DB_NAME):
    DB_NAME = BASE_DIR / DB_NAME

SECRET_KEY = os.getenv('CLOUD_SECRET_KEY') or CONFIG.get('server', {}).get('secret_key') or 'django-insecure-change-me'
DEBUG = bool(CONFIG.get('server', {}).get('debug', False))

if os.getenv('CLOUD_DEBUG') is not None:
    DEBUG = os.getenv('CLOUD_DEBUG', '').strip().lower() in {'1', 'true', 'yes', 'on'}

ALLOWED_HOSTS = CONFIG.get('server', {}).get('allowed_hosts') or ['*']

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'cloud.apps.CloudConfig',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.middleware.common.CommonMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = []

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': DB_NAME,
    }
}

LANGUAGE_CODE = 'zh-hans'
TIME_ZONE = CONFIG.get('server', {}).get('timezone') or 'Asia/Shanghai'
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'

DATA_UPLOAD_MAX_MEMORY_SIZE = int(CONFIG.get('data_limits', {}).get('max_batch_push_size_mb', 20) or 20) * 1024 * 1024
