from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from functools import wraps
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from django.http import JsonResponse

from .cloud import CLOUD_USER_AGENT, _get_ssl_context, get_cloud_server_url
from .models import FrontendKVStore


DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent / 'default_client_control.json'
CLIENT_ID_STORE_KEY = 'client_control_installation_id'
CONFIG_PATH = '/api/client-control/config.json'
ANNOUNCEMENT_PATH = '/api/client-control/announcement.txt'
CONFIG_CACHE_SECONDS = 60
ANNOUNCEMENT_CACHE_SECONDS = 30
MAX_REMOTE_CONFIG_BYTES = 256 * 1024
MAX_REMOTE_ANNOUNCEMENT_BYTES = 64 * 1024

_CACHE_LOCK = threading.RLock()
_CONFIG_CACHE: dict[str, Any] = {'expires_at': 0.0, 'value': None}
_ANNOUNCEMENT_CACHE: dict[str, Any] = {'expires_at': 0.0, 'value': None}


def _load_default_config() -> dict[str, Any]:
    with DEFAULT_CONFIG_PATH.open('r', encoding='utf-8') as file:
        payload = json.load(file)
    if not isinstance(payload, dict):
        raise ValueError('默认云控配置顶层必须是对象')
    return payload


DEFAULT_CLIENT_CONTROL = _load_default_config()


def reset_client_control_cache():
    with _CACHE_LOCK:
        _CONFIG_CACHE.update({'expires_at': 0.0, 'value': None})
        _ANNOUNCEMENT_CACHE.update({'expires_at': 0.0, 'value': None})


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def _safe_text(value: Any, fallback: str = '', limit: int = 1000) -> str:
    text = str(value if value is not None else fallback).strip()
    return text[:limit]


def _safe_url(value: Any, fallback: str) -> str:
    text = _safe_text(value, fallback, 500)
    parsed = urlparse(text)
    if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
        return fallback
    return text


def _percentage(value: Any, default: float = 100.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(0.0, min(100.0, number))


def _normalize_cards(value: Any, fallback: list[dict[str, str]], *, maximum: int) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return copy.deepcopy(fallback)
    cards = []
    for item in value[:maximum]:
        if not isinstance(item, dict):
            continue
        title = _safe_text(item.get('title'), limit=80)
        description = _safe_text(item.get('description'), limit=240)
        if not title or not description:
            continue
        cards.append({
            'title': title,
            'description': description,
            'icon': _safe_text(item.get('icon'), 'info', 32),
        })
    return cards or copy.deepcopy(fallback)


def normalize_client_control(payload: Any) -> dict[str, Any]:
    defaults = copy.deepcopy(DEFAULT_CLIENT_CONTROL)
    if not isinstance(payload, dict) or payload.get('enabled') is False:
        return defaults

    merged = _deep_merge(defaults, payload)
    merged['schema_version'] = 1
    merged['revision'] = _safe_text(merged.get('revision'), defaults['revision'], 80)
    merged['enabled'] = True
    merged['salt'] = _safe_text(merged.get('salt'), defaults['salt'], 160)

    features = {}
    incoming_features = merged.get('features') if isinstance(merged.get('features'), dict) else {}
    feature_names = list(defaults['features'])
    feature_names.extend(name for name in incoming_features if name not in defaults['features'])
    for name in feature_names[:64]:
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,63}', str(name)):
            continue
        default_item = defaults['features'].get(name, {
            'enabled': True,
            'rollout_percentage': 100,
            'mode': 'disable',
            'message': '此功能暂时不可用',
        })
        raw = incoming_features.get(name, default_item)
        if isinstance(raw, bool):
            raw = {'enabled': raw}
        if not isinstance(raw, dict):
            raw = default_item
        features[name] = {
            'enabled': bool(raw.get('enabled', default_item['enabled'])),
            'rollout_percentage': _percentage(raw.get('rollout_percentage'), default_item['rollout_percentage']),
            'mode': _safe_text(raw.get('mode'), default_item['mode'], 20) if raw.get('mode') in {'hide', 'disable'} else default_item['mode'],
            'message': _safe_text(raw.get('message'), default_item['message'], 180),
        }
    merged['features'] = features

    experiments = {}
    incoming_experiments = merged.get('experiments') if isinstance(merged.get('experiments'), dict) else {}
    for name, raw in incoming_experiments.items():
        if not isinstance(raw, dict):
            continue
        variants = raw.get('variants') if isinstance(raw.get('variants'), dict) else {}
        normalized_variants = {}
        for variant, weight in list(variants.items())[:12]:
            key = _safe_text(variant, limit=40)
            percentage = _percentage(weight, 0)
            if key and percentage > 0:
                normalized_variants[key] = percentage
        if normalized_variants:
            experiments[_safe_text(name, limit=60)] = {
                'enabled': bool(raw.get('enabled', False)),
                'rollout_percentage': _percentage(raw.get('rollout_percentage'), 100),
                'variants': normalized_variants,
            }
    merged['experiments'] = experiments

    default_about = defaults['about']
    about = merged.get('about') if isinstance(merged.get('about'), dict) else {}
    normalized_about = {
        'page_title': _safe_text(about.get('page_title'), default_about['page_title'], 80),
        'page_subtitle': _safe_text(about.get('page_subtitle'), default_about['page_subtitle'], 240),
        'product_name': _safe_text(about.get('product_name'), default_about['product_name'], 80),
        'product_tagline': _safe_text(about.get('product_tagline'), default_about['product_tagline'], 120),
        'product_description': _safe_text(about.get('product_description'), default_about['product_description'], 600),
        'hero_label': _safe_text(about.get('hero_label'), default_about['hero_label'], 80),
        'highlights': _normalize_cards(about.get('highlights'), default_about['highlights'], maximum=3),
        'core_features': _normalize_cards(about.get('core_features'), default_about['core_features'], maximum=8),
        'footer_line': _safe_text(about.get('footer_line'), default_about['footer_line'], 180),
    }
    product_info = about.get('product_info') if isinstance(about.get('product_info'), dict) else {}
    normalized_about['product_info'] = {
        'update_date': _safe_text(product_info.get('update_date'), default_about['product_info']['update_date'], 40),
        'audience': _safe_text(product_info.get('audience'), default_about['product_info']['audience'], 120),
        'license': _safe_text(product_info.get('license'), default_about['product_info']['license'], 160),
        'sync_label': _safe_text(product_info.get('sync_label'), default_about['product_info']['sync_label'], 80),
    }
    developer = about.get('developer') if isinstance(about.get('developer'), dict) else {}
    normalized_about['developer'] = {
        'name': _safe_text(developer.get('name'), default_about['developer']['name'], 80),
        'role': _safe_text(developer.get('role'), default_about['developer']['role'], 120),
        'description': _safe_text(developer.get('description'), default_about['developer']['description'], 400),
        'avatar_url': _safe_url(developer.get('avatar_url'), default_about['developer']['avatar_url']),
        'website': _safe_url(developer.get('website'), default_about['developer']['website']),
    }
    contact = about.get('contact') if isinstance(about.get('contact'), dict) else {}
    normalized_about['contact'] = {
        key: _safe_url(contact.get(key), default_about['contact'][key])
        for key in ('product_website', 'developer_website', 'feedback_url')
    }
    merged['about'] = normalized_about
    return merged


def _remote_url(path: str) -> str:
    base_url = (
        os.getenv('FUCKSEATS_CLIENT_CONTROL_BASE_URL')
        or get_cloud_server_url()
    ).strip().rstrip('/')
    return f"{base_url}/{path.lstrip('/')}"


def _fetch_remote(path: str, *, accept: str, limit: int, timeout: float = 2.5):
    request = urllib.request.Request(
        _remote_url(path),
        headers={
            'Accept': accept,
            'User-Agent': CLOUD_USER_AGENT,
            'Cache-Control': 'no-cache',
        },
        method='GET',
    )
    with urllib.request.urlopen(request, timeout=timeout, context=_get_ssl_context()) as response:
        raw = response.read(limit + 1)
        if len(raw) > limit:
            raise ValueError('远程云控响应超过大小限制')
        return raw, response.headers


def _fetch_remote_config() -> dict[str, Any]:
    raw, _ = _fetch_remote(CONFIG_PATH, accept='application/json', limit=MAX_REMOTE_CONFIG_BYTES)
    payload = json.loads(raw.decode('utf-8'))
    if not isinstance(payload, dict):
        raise ValueError('远程云控配置顶层必须是对象')
    return payload


def load_client_control_config(*, force: bool = False) -> tuple[dict[str, Any], str]:
    now = time.monotonic()
    with _CACHE_LOCK:
        if not force and _CONFIG_CACHE['value'] is not None and _CONFIG_CACHE['expires_at'] > now:
            cached = _CONFIG_CACHE['value']
            return copy.deepcopy(cached['config']), cached['source']

    source = 'remote'
    try:
        config = normalize_client_control(_fetch_remote_config())
    except (OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError, urllib.error.URLError):
        config = copy.deepcopy(DEFAULT_CLIENT_CONTROL)
        source = 'default'

    with _CACHE_LOCK:
        _CONFIG_CACHE.update({
            'expires_at': now + CONFIG_CACHE_SECONDS,
            'value': {'config': copy.deepcopy(config), 'source': source},
        })
    return config, source


def get_or_create_client_control_id() -> str:
    value = FrontendKVStore.objects.filter(key=CLIENT_ID_STORE_KEY).values_list('value', flat=True).first()
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        generated = str(uuid.uuid4())
        FrontendKVStore.objects.update_or_create(key=CLIENT_ID_STORE_KEY, defaults={'value': generated})
        return generated


def _bucket(client_id: str, salt: str, key: str) -> float:
    digest = hashlib.sha256(f'{client_id}:{salt}:{key}'.encode('utf-8')).digest()
    return int.from_bytes(digest[:8], 'big') / float(2**64) * 100.0


def resolve_client_control(config: dict[str, Any], client_id: str) -> dict[str, Any]:
    salt = str(config.get('salt') or DEFAULT_CLIENT_CONTROL['salt'])
    resolved_features = {}
    feature_flags = {}
    for name, item in config.get('features', {}).items():
        enabled = bool(item.get('enabled')) and _bucket(client_id, salt, f'feature:{name}') < float(item.get('rollout_percentage', 100))
        feature_flags[name] = enabled
        resolved_features[name] = {**item, 'available': enabled}

    resolved_experiments = {}
    for name, experiment in config.get('experiments', {}).items():
        variant = 'control'
        enrolled = bool(experiment.get('enabled')) and _bucket(client_id, salt, f'experiment:{name}:enroll') < float(experiment.get('rollout_percentage', 100))
        if enrolled:
            variants = experiment.get('variants') or {}
            total = sum(float(weight) for weight in variants.values())
            if total > 0:
                point = _bucket(client_id, salt, f'experiment:{name}:variant') / 100.0 * total
                cursor = 0.0
                for candidate, weight in variants.items():
                    cursor += float(weight)
                    if point < cursor:
                        variant = candidate
                        break
        resolved_experiments[name] = variant

    return {
        'schema_version': config.get('schema_version', 1),
        'revision': config.get('revision', ''),
        'features': resolved_features,
        'feature_flags': feature_flags,
        'experiments': resolved_experiments,
        'about': copy.deepcopy(config.get('about') or DEFAULT_CLIENT_CONTROL['about']),
    }


def get_resolved_client_control(*, force: bool = False) -> dict[str, Any]:
    config, source = load_client_control_config(force=force)
    resolved = resolve_client_control(config, get_or_create_client_control_id())
    resolved['source'] = source
    return resolved


def feature_is_available(name: str) -> tuple[bool, dict[str, Any]]:
    resolved = get_resolved_client_control()
    feature = resolved.get('features', {}).get(name) or {
        'available': True,
        'mode': 'disable',
        'message': '此功能暂时不可用',
    }
    return bool(feature.get('available', True)), feature


def feature_gate(name: str):
    def decorator(view_func):
        @wraps(view_func)
        def wrapped(request, *args, **kwargs):
            available, feature = feature_is_available(name)
            if not available:
                return JsonResponse({
                    'status': 'error',
                    'error': 'feature_unavailable',
                    'feature': name,
                    'message': feature.get('message') or '此功能暂时不可用',
                }, status=503)
            return view_func(request, *args, **kwargs)
        return wrapped
    return decorator


def load_announcement(*, force: bool = False) -> dict[str, Any]:
    resolved = get_resolved_client_control(force=force)
    if not resolved.get('feature_flags', {}).get('announcement', True):
        return {'id': '', 'content': '', 'source': resolved.get('source', 'default')}

    now = time.monotonic()
    with _CACHE_LOCK:
        if not force and _ANNOUNCEMENT_CACHE['value'] is not None and _ANNOUNCEMENT_CACHE['expires_at'] > now:
            return copy.deepcopy(_ANNOUNCEMENT_CACHE['value'])

    result = {'id': '', 'content': '', 'source': 'default'}
    try:
        raw, headers = _fetch_remote(
            ANNOUNCEMENT_PATH,
            accept='text/plain',
            limit=MAX_REMOTE_ANNOUNCEMENT_BYTES,
        )
        content = raw.decode('utf-8').strip()
        if content:
            result = {
                'id': _safe_text(headers.get('X-Announcement-ID'), hashlib.sha256(raw).hexdigest(), 128),
                'content': content[:MAX_REMOTE_ANNOUNCEMENT_BYTES],
                'source': 'remote',
            }
    except (OSError, ValueError, UnicodeDecodeError, urllib.error.URLError):
        pass

    with _CACHE_LOCK:
        _ANNOUNCEMENT_CACHE.update({
            'expires_at': now + ANNOUNCEMENT_CACHE_SECONDS,
            'value': copy.deepcopy(result),
        })
    return result
