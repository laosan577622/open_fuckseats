import copy
import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = Path(os.getenv('CLOUD_CONFIG_PATH') or BASE_DIR / 'cloud_config.yaml')

DEFAULT_CONFIG = {
    'server': {
        'base_url': 'http://127.0.0.1:8000',
        'host': '0.0.0.0',
        'port': 8000,
        'secret_key': 'django-insecure-change-me',
        'debug': False,
        'allowed_hosts': ['*'],
        'timezone': 'Asia/Shanghai',
    },
    'database': {
        'name': str(BASE_DIR / 'cloud.sqlite3'),
    },
    'metadata': {
        'developer_name': '老三',
        'developer_website': 'www.577622.xyz',
    },
    'laosan_oauth': {
        'client_id': '',
        'client_secret': '',
        'authorize_url': 'https://www.577622.xyz/oauth/authorize',
        'token_url': 'https://www.577622.xyz/oauth/token',
        'userinfo_url': 'https://www.577622.xyz/oauth/userinfo',
        'developer_subscriptions_url': 'https://www.577622.xyz/api/developer/subscriptions',
        'scope': 'email nickname subscriptions',
    },
    'subscription': {
        'fallback_tier': 'free',
        'purchase_url': '',
        'tiers': {
            'free': {
                'display_name': '免费版',
                'description': '基础功能，满足日常排座需求',
                'price': '免费',
                'purchase_url': '',
                'limits': {
                    'max_classrooms': 3,
                    'sync_enabled': True,
                    'max_history_steps': 0,
                    'sync_ai_conversations': False,
                    'max_snapshots_per_classroom': 3,
                },
            },
            'pro': {
                'display_name': 'Pro',
                'description': '更多班级和快照，适合多班教师',
                'price': '',
                'purchase_url': '',
                'service_identifier': 'fuckseats_pro',
                'limits': {
                    'max_classrooms': 10,
                    'sync_enabled': True,
                    'max_history_steps': 10,
                    'sync_ai_conversations': False,
                    'max_snapshots_per_classroom': 20,
                },
            },
            'pro_max': {
                'display_name': 'Pro Max',
                'description': '无限班级，完整功能，专业教师之选',
                'price': '',
                'purchase_url': '',
                'service_identifier': 'fuckseats_pro_max',
                'limits': {
                    'max_classrooms': -1,
                    'sync_enabled': True,
                    'max_history_steps': 100,
                    'sync_ai_conversations': False,
                    'max_snapshots_per_classroom': 50,
                },
            },
        },
        'priority': ['pro_max', 'pro', 'free'],
    },
    'data_limits': {
        'max_push_size_mb': 5,
        'max_batch_push_size_mb': 20,
        'session_token_ttl_days': 7,
        'session_code_ttl_seconds': 60,
    },
    'data_sharing': {
        'enabled': True,
        'database': 'improve_data.sqlite3',
        'usage_retention_days': 365,
        'log_retention_days': 90,
        'cleanup_interval_seconds': 3600,
        'max_events_per_request': 200,
        'max_logs_per_request': 200,
        'max_metadata_keys': 24,
        'max_metadata_value_length': 160,
        'hash_salt': '',
    },
}

_config = None


def _merge_dict(base, override):
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge_dict(result[key], value)
        else:
            result[key] = value
    return result


def _load_yaml(path):
    if not path.exists():
        return {}
    try:
        import yaml
    except Exception as exc:
        if os.getenv('CLOUD_REQUIRE_YAML', '').strip().lower() in {'1', 'true', 'yes', 'on'}:
            raise RuntimeError('云端配置需要 PyYAML，请先安装 backend/requirements.txt') from exc
        return {}
    with path.open('r', encoding='utf-8') as handle:
        return yaml.safe_load(handle) or {}


def _bool_env(value):
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _build_config():
    config = _merge_dict(DEFAULT_CONFIG, _load_yaml(CONFIG_PATH))

    if os.getenv('CLOUD_BASE_URL'):
        config['server']['base_url'] = os.getenv('CLOUD_BASE_URL').strip()
    if os.getenv('CLOUD_SECRET_KEY'):
        config['server']['secret_key'] = os.getenv('CLOUD_SECRET_KEY').strip()
    if os.getenv('CLOUD_DEBUG') is not None:
        config['server']['debug'] = _bool_env(os.getenv('CLOUD_DEBUG'))
    if os.getenv('PORT'):
        config['server']['port'] = int(os.getenv('PORT'))
    if os.getenv('LAOSAN_OAUTH_CLIENT_ID'):
        config['laosan_oauth']['client_id'] = os.getenv('LAOSAN_OAUTH_CLIENT_ID').strip()
    if os.getenv('LAOSAN_OAUTH_CLIENT_SECRET'):
        config['laosan_oauth']['client_secret'] = os.getenv('LAOSAN_OAUTH_CLIENT_SECRET').strip()
    if os.getenv('CLOUD_SQLITE_PATH'):
        config['database']['name'] = os.getenv('CLOUD_SQLITE_PATH').strip()
    if os.getenv('FUCKSEATS_IMPROVE_DB_PATH'):
        config.setdefault('data_sharing', {})['database'] = os.getenv('FUCKSEATS_IMPROVE_DB_PATH').strip()
    if os.getenv('FUCKSEATS_IMPROVE_ENABLED') is not None:
        config.setdefault('data_sharing', {})['enabled'] = _bool_env(os.getenv('FUCKSEATS_IMPROVE_ENABLED'))

    return config


def get_config():
    global _config
    if _config is not None:
        if not _config.get('server', {}).get('debug'):
            return _config
    _config = _build_config()
    return _config


def get_server_base_url():
    return str(get_config().get('server', {}).get('base_url') or '').strip().rstrip('/')


def get_data_limit(name, default):
    try:
        return int(get_config().get('data_limits', {}).get(name, default))
    except (TypeError, ValueError):
        return default


def get_tier_config(tier_name):
    config = get_config()
    tiers = config.get('subscription', {}).get('tiers', {})
    fallback = config.get('subscription', {}).get('fallback_tier', 'free')
    return tiers.get(tier_name) or tiers.get(fallback) or {}


def get_fallback_tier():
    return str(get_config().get('subscription', {}).get('fallback_tier') or 'free')


def get_effective_subscription_tier(tier_name, expires_at=None):
    from django.utils import timezone

    config = get_config()
    tiers = config.get('subscription', {}).get('tiers', {})
    fallback = get_fallback_tier()
    tier_name = str(tier_name or fallback).strip() or fallback
    if tier_name not in tiers:
        return fallback
    if expires_at and expires_at <= timezone.now() and tier_name != fallback:
        return fallback
    return tier_name


def get_tier_limits(tier_name):
    return copy.deepcopy(get_tier_config(tier_name).get('limits') or {})


def get_tier_display_name(tier_name):
    return str(get_tier_config(tier_name).get('display_name') or tier_name)


def subscription_payload(tier_name, expires_at=None):
    effective_tier = get_effective_subscription_tier(tier_name, expires_at)
    return {
        'tier': effective_tier,
        'display_name': get_tier_display_name(effective_tier),
        'expires_at': expires_at.isoformat() if expires_at and effective_tier == tier_name else None,
        'limits': get_tier_limits(effective_tier),
    }


def determine_tier(subscriptions):
    from django.utils import timezone
    from django.utils.dateparse import parse_datetime

    config = get_config()
    subscription = config.get('subscription', {})
    tiers = subscription.get('tiers', {})
    priority = subscription.get('priority') or []
    fallback = subscription.get('fallback_tier', 'free')

    id_to_tier = {}
    for tier_name, tier in tiers.items():
        service_identifier = tier.get('service_identifier')
        if service_identifier:
            id_to_tier[service_identifier] = tier_name

    matched = {}
    for item in subscriptions or []:
        if not isinstance(item, dict):
            continue
        tier_name = id_to_tier.get(item.get('service_identifier'))
        if not tier_name:
            continue
        expires = parse_datetime(str(item.get('expires_at') or ''))
        if expires and timezone.is_naive(expires):
            expires = timezone.make_aware(expires, timezone.get_current_timezone())
        if expires and expires > timezone.now():
            current = matched.get(tier_name)
            if not current or expires > current:
                matched[tier_name] = expires

    for tier_name in priority:
        if tier_name in matched:
            return tier_name, matched[tier_name]

    return fallback, None
