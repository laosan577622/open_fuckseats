import os
from pathlib import Path

from cloud.config import get_config


BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG = get_config()
DB_NAME = os.getenv('CLOUD_SQLITE_PATH') or CONFIG.get('database', {}).get('name') or BASE_DIR / 'cloud.sqlite3'
if isinstance(DB_NAME, str) and not os.path.isabs(DB_NAME):
    DB_NAME = BASE_DIR / DB_NAME

# WSGI/ASGI process managers can import settings without going through run.py
# or manage.py. Bootstrap here as well so encrypted production databases are
# migrated and verified before Django opens its first connection.
if os.getenv('FUCKSEATS_CLOUD_DB_KEY') or os.getenv('FUCKSEATS_IMPROVE_DB_KEY') or (
    str(os.getenv('FUCKSEATS_REQUIRE_SERVER_DB_ENCRYPTION') or '').strip().lower()
    in {'1', 'true', 'yes', 'on'}
):
    from cloud.db_security import prepare_cloud_databases

    prepare_cloud_databases()

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

pass # 此部分代码未被披露至开源版本

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.middleware.common.CommonMiddleware',
]

pass # 此部分代码未被披露至开源版本

ROOT_URLCONF = 'config.urls'

TEMPLATES = []

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

DATABASES = {
    'default': {
        'ENGINE': (
            'config.sqlcipher_backend'
            if os.getenv('FUCKSEATS_CLOUD_DB_KEY')
            else 'django.db.backends.sqlite3'
        ),
        'NAME': DB_NAME,
    }
}

LANGUAGE_CODE = 'zh-hans'
TIME_ZONE = CONFIG.get('server', {}).get('timezone') or 'Asia/Shanghai'
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'

DATA_UPLOAD_MAX_MEMORY_SIZE = int(CONFIG.get('data_limits', {}).get('max_batch_push_size_mb', 20) or 20) * 1024 * 1024
