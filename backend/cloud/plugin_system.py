from __future__ import annotations

import importlib.util
import inspect
import json
import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.urls import path
from django.urls.resolvers import URLPattern, URLResolver
from django.views.decorators.http import require_http_methods

try:
    import yaml
except Exception:
    yaml = None

from .config import get_config


LOGGER = logging.getLogger(__name__)


class BackendPluginError(Exception):
    pass


class BackendPluginNotFoundError(BackendPluginError):
    pass


class BackendPluginActionNotFoundError(BackendPluginError):
    pass


class BackendPluginMethodNotAllowedError(BackendPluginError):
    pass


class BackendPluginAuthenticationError(BackendPluginError):
    pass


@dataclass
class BackendPluginAction:
    name: str
    handler: Callable[..., Any]
    methods: tuple[str, ...] = ('POST',)
    description: str = ''
    auth_required: bool = False


@dataclass
class BackendPluginRoute:
    route: str
    handler: Callable[..., Any]
    methods: tuple[str, ...] = ('GET',)
    name: str = ''
    description: str = ''
    auth_required: bool = False


@dataclass
class BackendPluginRecord:
    plugin_id: str
    name: str
    version: str
    description: str = ''
    author: str = ''
    website: str = ''
    module_name: str = ''
    path: str = ''
    manifest: dict[str, Any] = field(default_factory=dict)
    hooks: dict[str, int] = field(default_factory=dict)
    actions: dict[str, BackendPluginAction] = field(default_factory=dict)
    routes: dict[str, BackendPluginRoute] = field(default_factory=dict)
    url_patterns: list[Any] = field(default_factory=list)
    state: dict[str, Any] = field(default_factory=dict)


def _normalize_methods(methods, default=('POST',)):
    if isinstance(methods, str):
        methods = [methods]
    rows = tuple(sorted({str(item).strip().upper() for item in (methods or []) if str(item).strip()}))
    return rows or tuple(default)


def _json_error(message, status=400, **extra):
    payload = {'ok': False, 'status': 'error', 'message': str(message)}
    payload.update(extra)
    return JsonResponse(payload, status=status)


def _json_body(request):
    try:
        return json.loads((request.body or b'{}').decode('utf-8') or '{}')
    except Exception as exc:
        raise ValueError('请求数据格式错误') from exc


def _normalize_response(value):
    if isinstance(value, (HttpResponse, JsonResponse)):
        return value
    if value is None:
        value = {'ok': True, 'status': 'success'}
    if isinstance(value, dict):
        payload = dict(value)
        payload.setdefault('ok', True)
        payload.setdefault('status', 'success')
        return JsonResponse(payload)
    if isinstance(value, (list, tuple)):
        return JsonResponse({'ok': True, 'status': 'success', 'data': list(value)})
    return JsonResponse({'ok': True, 'status': 'success', 'data': value})


def _session_context(request, auth_required):
    if not auth_required:
        return {}
    if request is None:
        raise BackendPluginAuthenticationError('此插件能力需要登录态')

    from .auth import get_request_session

    session = get_request_session(request)
    if not session:
        raise BackendPluginAuthenticationError('session_token 无效或已过期')
    request.cloud_session = session
    request.cloud_user = session.user
    return {
        'session': session,
        'user': session.user,
        'cloud_session': session,
        'cloud_user': session.user,
    }


def _plugin_config():
    return get_config().get('plugins', {}) or {}


def _split_env_paths(value):
    return [item.strip() for item in str(value or '').split(',') if item.strip()]


def _resolve_plugin_dirs(base_dir=None):
    base = Path(base_dir or getattr(settings, 'BASE_DIR', Path(__file__).resolve().parent.parent)).resolve()
    configured = []

    django_dirs = getattr(settings, 'CLOUD_PLUGIN_DIRS', None)
    if django_dirs:
        configured.extend(django_dirs)

    config_dirs = _plugin_config().get('dirs') or []
    if isinstance(config_dirs, str):
        config_dirs = [config_dirs]
    configured.extend(config_dirs)

    configured.extend(_split_env_paths(os.getenv('CLOUD_PLUGIN_DIRS')))
    if not configured:
        configured = [base / 'plugins']

    result = []
    for raw_path in configured:
        path = Path(raw_path).expanduser()
        if not path.is_absolute():
            path = base / path
        result.append(path.resolve())
    return result


def _load_manifest(manifest_path: Path):
    if not manifest_path.exists() or not manifest_path.is_file():
        return {}
    try:
        if manifest_path.suffix.lower() == '.json':
            return json.loads(manifest_path.read_text(encoding='utf-8')) or {}
        if manifest_path.suffix.lower() in {'.yaml', '.yml'} and yaml is not None:
            return yaml.safe_load(manifest_path.read_text(encoding='utf-8')) or {}
    except Exception:
        LOGGER.exception('读取后端插件 manifest 失败: %s', manifest_path)
    return {}


def _discover_candidates(base_dir=None):
    candidates = []
    for plugin_dir in _resolve_plugin_dirs(base_dir):
        if not plugin_dir.exists() or not plugin_dir.is_dir():
            continue
        for child in sorted(plugin_dir.iterdir(), key=lambda item: item.name):
            if child.name.startswith('_'):
                continue
            if child.is_file() and child.suffix == '.py' and child.name != '__init__.py':
                candidates.append((child, {}))
                continue
            if not child.is_dir():
                continue

            manifest = {}
            for manifest_name in ('plugin.yaml', 'plugin.yml', 'plugin.json'):
                manifest = _load_manifest(child / manifest_name)
                if manifest:
                    break

            entry = child / str(manifest.get('entry') or 'plugin.py')
            if not entry.exists():
                entry = child / '__init__.py'
            if entry.exists():
                candidates.append((entry, manifest))
    return candidates


def _manifest_list_value(manifest, key):
    value = manifest.get(key)
    if value is None:
        value = manifest.get('django', {}).get(key)
    if not value:
        return []
    if isinstance(value, str):
        return [value]
    return [str(item) for item in value if str(item).strip()]


def get_plugin_installed_apps(base_dir=None):
    apps = []
    for _, manifest in _discover_candidates(base_dir):
        apps.extend(_manifest_list_value(manifest, 'installed_apps'))
    return apps


def get_plugin_middleware(base_dir=None):
    middleware = []
    for _, manifest in _discover_candidates(base_dir):
        middleware.extend(_manifest_list_value(manifest, 'middleware'))
    return middleware


class BackendPluginRegistry:
    def __init__(self):
        self._lock = threading.RLock()
        self._loaded = False
        self._current_plugin_id = None
        self._plugins: dict[str, BackendPluginRecord] = {}
        self._hooks: dict[str, list[tuple[str, Callable[..., Any]]]] = {}
        self._routes_loaded = False
        self._load_errors: list[dict[str, str]] = []

    @property
    def load_errors(self):
        return list(self._load_errors)

    def reset_for_tests(self):
        with self._lock:
            self._loaded = False
            self._current_plugin_id = None
            self._plugins = {}
            self._hooks = {}
            self._routes_loaded = False
            self._load_errors = []

    def _module_name_from_path(self, file_path: Path):
        safe_name = file_path.stem.replace('-', '_').replace('.', '_')
        return f'cloud_backend_plugins.{safe_name}_{abs(hash(str(file_path)))}'

    def _invoke_callable(self, func: Callable[..., Any], context: dict[str, Any]):
        signature = inspect.signature(func)
        if not signature.parameters:
            return func()
        if len(signature.parameters) == 1:
            return func(context)
        if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in signature.parameters.values()):
            return func(**context)
        accepted = {
            key: value
            for key, value in context.items()
            if key in signature.parameters
        }
        return func(**accepted)

    def _register_plugin_record(self, plugin_id, meta, module_name, file_path, manifest):
        if plugin_id in self._plugins:
            raise ValueError(f'后端插件 ID 冲突：{plugin_id}')
        self._plugins[plugin_id] = BackendPluginRecord(
            plugin_id=plugin_id,
            name=str(meta.get('name') or plugin_id),
            version=str(meta.get('version') or '0.0.1'),
            description=str(meta.get('description') or ''),
            author=str(meta.get('author') or ''),
            website=str(meta.get('website') or ''),
            module_name=module_name,
            path=str(file_path),
            manifest=dict(manifest or {}),
        )

    def ensure_loaded(self):
        with self._lock:
            if self._loaded:
                return
            self._loaded = True

            for file_path, manifest in _discover_candidates():
                try:
                    module_name = self._module_name_from_path(file_path)
                    spec = importlib.util.spec_from_file_location(module_name, file_path)
                    if spec is None or spec.loader is None:
                        raise RuntimeError('无法创建模块加载器')

                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)

                    module_meta = getattr(module, 'PLUGIN_META', {}) or {}
                    if not isinstance(module_meta, dict):
                        raise ValueError('PLUGIN_META 必须是 dict')
                    meta = {**(manifest or {}), **module_meta}

                    fallback_id = file_path.parent.name if file_path.name in {'plugin.py', '__init__.py'} else file_path.stem
                    plugin_id = str(meta.get('id') or fallback_id).strip()
                    if not plugin_id:
                        raise ValueError('插件 ID 不能为空')

                    self._register_plugin_record(plugin_id, meta, module_name, file_path, manifest)

                    register_fn = getattr(module, 'register', None)
                    if callable(register_fn):
                        self._current_plugin_id = plugin_id
                        try:
                            register_fn(self)
                        finally:
                            self._current_plugin_id = None

                    module_urlpatterns = getattr(module, 'urlpatterns', None)
                    if module_urlpatterns:
                        self.register_urlpatterns(module_urlpatterns, plugin_id=plugin_id)

                    self.emit('plugin_loaded', plugin_id=plugin_id, plugin=self._plugins[plugin_id])
                except Exception as exc:
                    self._load_errors.append({'path': str(file_path), 'error': str(exc)})
                    LOGGER.exception('加载后端插件失败: %s', file_path)

    def _current_record(self, plugin_id=None):
        pid = plugin_id or self._current_plugin_id
        if not pid:
            raise ValueError('需要 plugin_id 或在 register() 内部调用')
        if pid not in self._plugins:
            raise BackendPluginNotFoundError(f'后端插件不存在：{pid}')
        return self._plugins[pid]

    def get_state(self, plugin_id: str | None = None):
        return self._current_record(plugin_id).state

    def register_hook(self, event: str, handler: Callable[..., Any], plugin_id: str | None = None):
        record = self._current_record(plugin_id)
        if not callable(handler):
            raise ValueError('hook handler 必须是可调用对象')
        event_name = str(event or '').strip()
        if not event_name:
            raise ValueError('hook event 不能为空')

        self._hooks.setdefault(event_name, []).append((record.plugin_id, handler))
        record.hooks[event_name] = record.hooks.get(event_name, 0) + 1

    def hook(self, event: str):
        def decorator(func):
            self.register_hook(event, func)
            return func
        return decorator

    def register_action(
        self,
        action: str,
        handler: Callable[..., Any],
        *,
        methods=('POST',),
        description: str = '',
        auth_required: bool = False,
        plugin_id: str | None = None,
    ):
        record = self._current_record(plugin_id)
        if not callable(handler):
            raise ValueError('action handler 必须是可调用对象')
        action_name = str(action or '').strip()
        if not action_name:
            raise ValueError('action 名称不能为空')
        if action_name in record.actions:
            raise ValueError(f'重复 action：{action_name}')
        record.actions[action_name] = BackendPluginAction(
            name=action_name,
            handler=handler,
            methods=_normalize_methods(methods, default=('POST',)),
            description=str(description or ''),
            auth_required=bool(auth_required),
        )

    def action(self, name: str, **options):
        def decorator(func):
            self.register_action(name, func, **options)
            return func
        return decorator

    def register_route(
        self,
        route: str,
        handler: Callable[..., Any],
        *,
        methods=('GET',),
        name: str = '',
        description: str = '',
        auth_required: bool = False,
        plugin_id: str | None = None,
    ):
        record = self._current_record(plugin_id)
        if not callable(handler):
            raise ValueError('route handler 必须是可调用对象')
        route_key = str(route or '').strip().lstrip('/')
        if not route_key:
            raise ValueError('route 不能为空')
        if route_key in record.routes:
            raise ValueError(f'重复 route：{route_key}')
        record.routes[route_key] = BackendPluginRoute(
            route=route_key,
            handler=handler,
            methods=_normalize_methods(methods, default=('GET',)),
            name=str(name or route_key.replace('/', '_').replace('-', '_').replace('<', '').replace('>', '').replace(':', '_')),
            description=str(description or ''),
            auth_required=bool(auth_required),
        )

    def route(self, route: str, **options):
        def decorator(func):
            self.register_route(route, func, **options)
            return func
        return decorator

    def register_urlpattern(self, pattern, plugin_id: str | None = None):
        record = self._current_record(plugin_id)
        if not isinstance(pattern, (URLPattern, URLResolver)):
            raise ValueError('urlpattern 必须是 django.urls.path/re_path/include 生成的对象')
        record.url_patterns.append(pattern)

    def register_urlpatterns(self, patterns, plugin_id: str | None = None):
        for pattern in patterns or []:
            self.register_urlpattern(pattern, plugin_id=plugin_id)

    def emit(self, event: str, **context):
        self.ensure_loaded()
        event_name = str(event or '').strip()
        if not event_name:
            return []

        rows = []
        for plugin_id, handler in self._hooks.get(event_name, []):
            try:
                result = self._invoke_callable(handler, context)
                rows.append({'plugin_id': plugin_id, 'status': 'ok', 'result': result})
            except Exception as exc:
                rows.append({'plugin_id': plugin_id, 'status': 'error', 'error': str(exc)})
                LOGGER.exception('后端插件 hook 执行失败: %s/%s', plugin_id, event_name)
        return rows

    def list_plugins(self):
        self.ensure_loaded()
        rows = []
        for record in sorted(self._plugins.values(), key=lambda item: item.plugin_id):
            rows.append({
                'id': record.plugin_id,
                'name': record.name,
                'version': record.version,
                'description': record.description,
                'author': record.author,
                'website': record.website,
                'path': record.path,
                'hooks': sorted(record.hooks.keys()),
                'actions': [
                    {
                        'name': action.name,
                        'methods': list(action.methods),
                        'description': action.description,
                        'auth_required': action.auth_required,
                    }
                    for action in sorted(record.actions.values(), key=lambda item: item.name)
                ],
                'routes': [
                    {
                        'route': route.route,
                        'methods': list(route.methods),
                        'name': route.name,
                        'description': route.description,
                        'auth_required': route.auth_required,
                    }
                    for route in sorted(record.routes.values(), key=lambda item: item.route)
                ],
                'url_patterns': len(record.url_patterns),
            })
        return rows

    def run_action(self, plugin_id: str, action: str, *, method='POST', request=None, payload=None, **context):
        self.ensure_loaded()
        plugin_key = str(plugin_id or '').strip()
        action_key = str(action or '').strip()
        if plugin_key not in self._plugins:
            raise BackendPluginNotFoundError(f'后端插件不存在：{plugin_key}')
        plugin_action = self._plugins[plugin_key].actions.get(action_key)
        if not plugin_action:
            raise BackendPluginActionNotFoundError(f'后端插件动作不存在：{plugin_key}/{action_key}')

        request_method = str(method or '').upper() or 'POST'
        if request_method not in plugin_action.methods:
            raise BackendPluginMethodNotAllowedError(
                f'后端插件动作不支持请求方法 {request_method}，仅支持 {",".join(plugin_action.methods)}'
            )

        context.update(_session_context(request, plugin_action.auth_required))
        payload = payload if payload is not None else {}
        context.update({
            'request': request,
            'payload': payload,
            'plugin_id': plugin_key,
            'action': action_key,
            'registry': self,
        })
        return self._invoke_callable(plugin_action.handler, context)

    def _build_route_view(self, plugin_id, plugin_route: BackendPluginRoute):
        @require_http_methods(plugin_route.methods)
        def view(request, *args, **kwargs):
            try:
                payload = _json_body(request) if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'} else {}
            except ValueError as exc:
                return _json_error(exc)
            try:
                auth_context = _session_context(request, plugin_route.auth_required)
                result = self._invoke_callable(plugin_route.handler, {
                    'request': request,
                    'payload': payload,
                    'plugin_id': plugin_id,
                    'route': plugin_route.route,
                    'registry': self,
                    'args': args,
                    'kwargs': kwargs,
                    **auth_context,
                    **kwargs,
                })
                return _normalize_response(result)
            except BackendPluginAuthenticationError as exc:
                return _json_error(exc, status=401, error='unauthorized')
            except Exception as exc:
                LOGGER.exception('后端插件路由执行失败: %s/%s', plugin_id, plugin_route.route)
                return _json_error(exc, status=500)

        return view

    def get_urlpatterns(self):
        self.ensure_loaded()
        patterns = [
            path('api/plugins', backend_plugins_list, name='backend_plugins_list'),
            path('api/plugins/<str:plugin_id>/actions/<str:action>', backend_plugins_action, name='backend_plugins_action'),
        ]
        for record in sorted(self._plugins.values(), key=lambda item: item.plugin_id):
            for route in sorted(record.routes.values(), key=lambda item: item.route):
                route_name = f'backend_plugin_{record.plugin_id}_{route.name}'.replace('-', '_')
                patterns.append(path(route.route, self._build_route_view(record.plugin_id, route), name=route_name))
            patterns.extend(record.url_patterns)
        return patterns


backend_plugin_registry = BackendPluginRegistry()


@require_http_methods(['GET'])
def backend_plugins_list(request):
    return JsonResponse({
        'ok': True,
        'status': 'success',
        'plugins': backend_plugin_registry.list_plugins(),
        'load_errors': backend_plugin_registry.load_errors,
    })


@require_http_methods(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
def backend_plugins_action(request, plugin_id, action):
    try:
        payload = _json_body(request) if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'} else {}
    except ValueError as exc:
        return _json_error(exc)

    try:
        result = backend_plugin_registry.run_action(
            plugin_id,
            action,
            method=request.method,
            request=request,
            payload=payload,
        )
        return _normalize_response(result)
    except BackendPluginNotFoundError as exc:
        return _json_error(exc, status=404)
    except BackendPluginActionNotFoundError as exc:
        return _json_error(exc, status=404)
    except BackendPluginMethodNotAllowedError as exc:
        return _json_error(exc, status=405)
    except BackendPluginAuthenticationError as exc:
        return _json_error(exc, status=401, error='unauthorized')
    except Exception as exc:
        LOGGER.exception('后端插件 action 执行失败: %s/%s', plugin_id, action)
        return _json_error(exc, status=500)
