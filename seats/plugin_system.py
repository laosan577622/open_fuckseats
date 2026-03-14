import importlib.util
import inspect
import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from django.conf import settings

from .plugin_components import get_component_scope

LOGGER = logging.getLogger(__name__)

SAFE_SCRIPT_BUILTINS = {
    'abs': abs,
    'all': all,
    'any': any,
    'bool': bool,
    'dict': dict,
    'Exception': Exception,
    'TypeError': TypeError,
    'ValueError': ValueError,
    'enumerate': enumerate,
    'float': float,
    'int': int,
    'isinstance': isinstance,
    'getattr': getattr,
    'hasattr': hasattr,
    'len': len,
    'list': list,
    'max': max,
    'min': min,
    'range': range,
    'round': round,
    'set': set,
    'sorted': sorted,
    'str': str,
    'sum': sum,
    'tuple': tuple,
}


class PluginError(Exception):
    pass


class PluginNotFoundError(PluginError):
    pass


class PluginActionNotFoundError(PluginError):
    pass


class PluginActionMethodNotAllowedError(PluginError):
    pass


class PluginUIScriptNotFoundError(PluginError):
    pass


class PluginUIScriptMethodNotAllowedError(PluginError):
    pass


class PluginWorkspaceScriptNotFoundError(PluginError):
    pass


class PluginWorkspaceScriptMethodNotAllowedError(PluginError):
    pass


@dataclass
class PluginAction:
    name: str
    handler: Callable[..., Any]
    methods: tuple[str, ...] = ('POST',)
    description: str = ''


@dataclass
class PluginUIScript:
    name: str
    source: str
    code: Any
    methods: tuple[str, ...] = ('GET',)
    description: str = ''


@dataclass
class PluginWorkspaceScript:
    name: str
    source: str
    methods: tuple[str, ...] = ('GET',)
    description: str = ''
    requires_permission: bool = True
    auto_run: bool = False


@dataclass
class PluginRecord:
    plugin_id: str
    name: str
    version: str
    description: str = ''
    author: str = ''
    website: str = ''
    module_name: str = ''
    path: str = ''
    hooks: dict[str, int] = field(default_factory=dict)
    actions: dict[str, PluginAction] = field(default_factory=dict)
    ui_scripts: dict[str, PluginUIScript] = field(default_factory=dict)
    workspace_scripts: dict[str, PluginWorkspaceScript] = field(default_factory=dict)


class PluginRegistry:
    def __init__(self):
        self._lock = threading.RLock()
        self._loaded = False
        self._current_plugin_id = None
        self._plugins: dict[str, PluginRecord] = {}
        self._hooks: dict[str, list[tuple[str, Callable[..., Any]]]] = {}
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
            self._load_errors = []

    def _iter_plugin_files(self, plugin_dirs):
        for raw_path in plugin_dirs:
            if not raw_path:
                continue
            path = Path(raw_path).expanduser()
            if not path.exists() or not path.is_dir():
                continue
            for child in sorted(path.iterdir(), key=lambda item: item.name):
                if child.name.startswith('_'):
                    continue
                if child.is_file() and child.suffix == '.py' and child.name != '__init__.py':
                    yield child
                    continue
                if not child.is_dir():
                    continue
                plugin_file = child / 'plugin.py'
                init_file = child / '__init__.py'
                if plugin_file.exists():
                    yield plugin_file
                elif init_file.exists():
                    yield init_file

    def _resolve_plugin_dirs(self):
        raw_dirs = list(getattr(settings, 'PLUGIN_DIRS', []))
        env_dirs = os.getenv('PLUGIN_DIRS', '').strip()
        if env_dirs:
            raw_dirs.extend([item.strip() for item in env_dirs.split(',') if item.strip()])
        if not raw_dirs:
            raw_dirs = [str(Path(settings.BASE_DIR) / 'plugins')]
        return raw_dirs

    def _module_name_from_path(self, file_path: Path):
        safe_name = file_path.stem.replace('-', '_').replace('.', '_')
        return f"seat_plugins.{safe_name}_{abs(hash(str(file_path)))}"

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

    def _normalize_methods(self, methods, default=('POST',)):
        method_tuple = tuple(sorted({str(item).upper() for item in methods if str(item).strip()}))
        if not method_tuple:
            method_tuple = default
        return method_tuple

    def _register_plugin_record(self, plugin_id, meta, module_name, path):
        if plugin_id in self._plugins:
            raise ValueError(f'插件 ID 冲突：{plugin_id}')
        self._plugins[plugin_id] = PluginRecord(
            plugin_id=plugin_id,
            name=str(meta.get('name') or plugin_id),
            version=str(meta.get('version') or '0.0.1'),
            description=str(meta.get('description') or ''),
            author=str(meta.get('author') or ''),
            website=str(meta.get('website') or ''),
            module_name=module_name,
            path=str(path),
        )

    def register_hook(self, event: str, handler: Callable[..., Any], plugin_id: str | None = None):
        pid = plugin_id or self._current_plugin_id
        if not pid:
            raise ValueError('register_hook 需要 plugin_id 或在 register() 内部调用')
        if pid not in self._plugins:
            raise PluginNotFoundError(f'插件不存在：{pid}')
        if not callable(handler):
            raise ValueError('hook handler 必须是可调用对象')

        event_name = str(event or '').strip()
        if not event_name:
            raise ValueError('hook event 不能为空')

        self._hooks.setdefault(event_name, []).append((pid, handler))
        plugin = self._plugins[pid]
        plugin.hooks[event_name] = plugin.hooks.get(event_name, 0) + 1

    def register_action(
        self,
        action: str,
        handler: Callable[..., Any],
        *,
        methods: tuple[str, ...] = ('POST',),
        description: str = '',
        plugin_id: str | None = None,
    ):
        pid = plugin_id or self._current_plugin_id
        if not pid:
            raise ValueError('register_action 需要 plugin_id 或在 register() 内部调用')
        if pid not in self._plugins:
            raise PluginNotFoundError(f'插件不存在：{pid}')
        if not callable(handler):
            raise ValueError('action handler 必须是可调用对象')

        action_name = str(action or '').strip()
        if not action_name:
            raise ValueError('action 名称不能为空')

        method_tuple = self._normalize_methods(methods, default=('POST',))

        record = self._plugins[pid]
        if action_name in record.actions:
            raise ValueError(f'重复 action：{action_name}')
        record.actions[action_name] = PluginAction(
            name=action_name,
            handler=handler,
            methods=method_tuple,
            description=str(description or ''),
        )

    def register_ui_script(
        self,
        ui_name: str,
        script: str,
        *,
        methods: tuple[str, ...] = ('GET',),
        description: str = '',
        plugin_id: str | None = None,
    ):
        pid = plugin_id or self._current_plugin_id
        if not pid:
            raise ValueError('register_ui_script 需要 plugin_id 或在 register() 内部调用')
        if pid not in self._plugins:
            raise PluginNotFoundError(f'插件不存在：{pid}')

        ui_key = str(ui_name or '').strip()
        if not ui_key:
            raise ValueError('ui_name 不能为空')

        source = str(script or '').strip()
        if not source:
            raise ValueError('UI 脚本内容不能为空')

        try:
            code = compile(source, f'<plugin-ui:{pid}:{ui_key}>', 'exec')
        except SyntaxError as exc:
            raise ValueError(f'UI 脚本语法错误：{exc}') from exc

        record = self._plugins[pid]
        if ui_key in record.ui_scripts:
            raise ValueError(f'重复 UI 脚本：{ui_key}')

        record.ui_scripts[ui_key] = PluginUIScript(
            name=ui_key,
            source=source,
            code=code,
            methods=self._normalize_methods(methods, default=('GET',)),
            description=str(description or ''),
        )

    def register_workspace_script(
        self,
        script_name: str,
        script: str,
        *,
        methods: tuple[str, ...] = ('GET',),
        description: str = '',
        requires_permission: bool = True,
        auto_run: bool = False,
        plugin_id: str | None = None,
    ):
        pid = plugin_id or self._current_plugin_id
        if not pid:
            raise ValueError('register_workspace_script 需要 plugin_id 或在 register() 内部调用')
        if pid not in self._plugins:
            raise PluginNotFoundError(f'插件不存在：{pid}')

        script_key = str(script_name or '').strip()
        if not script_key:
            raise ValueError('script_name 不能为空')

        source = str(script or '').strip()
        if not source:
            raise ValueError('workspace script 内容不能为空')

        record = self._plugins[pid]
        if script_key in record.workspace_scripts:
            raise ValueError(f'重复 workspace script：{script_key}')

        record.workspace_scripts[script_key] = PluginWorkspaceScript(
            name=script_key,
            source=source,
            methods=self._normalize_methods(methods, default=('GET',)),
            description=str(description or ''),
            requires_permission=bool(requires_permission),
            auto_run=bool(auto_run),
        )

    def ensure_loaded(self):
        with self._lock:
            if self._loaded:
                return
            self._loaded = True

            for file_path in self._iter_plugin_files(self._resolve_plugin_dirs()):
                try:
                    module_name = self._module_name_from_path(file_path)
                    spec = importlib.util.spec_from_file_location(module_name, file_path)
                    if spec is None or spec.loader is None:
                        raise RuntimeError('无法创建模块加载器')

                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)

                    meta = getattr(module, 'PLUGIN_META', {}) or {}
                    if not isinstance(meta, dict):
                        raise ValueError('PLUGIN_META 必须是 dict')

                    plugin_id = str(meta.get('id') or file_path.stem).strip()
                    if not plugin_id:
                        raise ValueError('插件 ID 不能为空')

                    self._register_plugin_record(plugin_id, meta, module_name, str(file_path))

                    register_fn = getattr(module, 'register', None)
                    if not callable(register_fn):
                        raise ValueError('插件缺少 register(registry) 函数')

                    self._current_plugin_id = plugin_id
                    try:
                        register_fn(self)
                    finally:
                        self._current_plugin_id = None

                except Exception as exc:
                    error = {
                        'path': str(file_path),
                        'error': str(exc),
                    }
                    self._load_errors.append(error)
                    LOGGER.exception('加载插件失败: %s', file_path)

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
                'module': record.module_name,
                'path': record.path,
                'hooks': sorted(record.hooks.keys()),
                'actions': [
                    {
                        'name': action.name,
                        'methods': list(action.methods),
                        'description': action.description,
                    }
                    for action in sorted(record.actions.values(), key=lambda item: item.name)
                ],
                'ui_scripts': [
                    {
                        'name': ui_script.name,
                        'methods': list(ui_script.methods),
                        'description': ui_script.description,
                    }
                    for ui_script in sorted(record.ui_scripts.values(), key=lambda item: item.name)
                ],
                'workspace_scripts': [
                    {
                        'name': script.name,
                        'methods': list(script.methods),
                        'description': script.description,
                        'requires_permission': bool(script.requires_permission),
                        'auto_run': bool(script.auto_run),
                    }
                    for script in sorted(record.workspace_scripts.values(), key=lambda item: item.name)
                ],
            })
        return rows

    def emit(self, event: str, **context):
        self.ensure_loaded()
        event_name = str(event or '').strip()
        if not event_name:
            return []

        rows = []
        for plugin_id, handler in self._hooks.get(event_name, []):
            try:
                result = self._invoke_callable(handler, context)
                rows.append({
                    'plugin_id': plugin_id,
                    'status': 'ok',
                    'result': result,
                })
            except Exception as exc:
                rows.append({
                    'plugin_id': plugin_id,
                    'status': 'error',
                    'error': str(exc),
                })
                LOGGER.exception('插件 hook 执行失败: %s/%s', plugin_id, event_name)
        return rows

    def run_action(self, plugin_id: str, action: str, *, method='POST', **context):
        self.ensure_loaded()
        plugin_key = str(plugin_id or '').strip()
        action_key = str(action or '').strip()
        if plugin_key not in self._plugins:
            raise PluginNotFoundError(f'插件不存在：{plugin_key}')

        record = self._plugins[plugin_key]
        plugin_action = record.actions.get(action_key)
        if not plugin_action:
            raise PluginActionNotFoundError(f'插件动作不存在：{plugin_key}/{action_key}')

        request_method = str(method or '').upper() or 'POST'
        if request_method not in plugin_action.methods:
            raise PluginActionMethodNotAllowedError(
                f'插件动作不支持请求方法 {request_method}，仅支持 {",".join(plugin_action.methods)}'
            )
        return self._invoke_callable(plugin_action.handler, context)

    def run_ui_script(self, plugin_id: str, ui_name: str, *, method='GET', **context):
        self.ensure_loaded()
        plugin_key = str(plugin_id or '').strip()
        ui_key = str(ui_name or '').strip()
        if plugin_key not in self._plugins:
            raise PluginNotFoundError(f'插件不存在：{plugin_key}')

        record = self._plugins[plugin_key]
        ui_script = record.ui_scripts.get(ui_key)
        if not ui_script:
            raise PluginUIScriptNotFoundError(f'插件 UI 不存在：{plugin_key}/{ui_key}')

        request_method = str(method or '').upper() or 'GET'
        if request_method not in ui_script.methods:
            raise PluginUIScriptMethodNotAllowedError(
                f'插件 UI 不支持请求方法 {request_method}，仅支持 {",".join(ui_script.methods)}'
            )

        local_vars = dict(context)
        local_vars.setdefault('payload', {})
        local_vars['plugin_id'] = plugin_key
        local_vars['ui_name'] = ui_key
        local_vars['components'] = get_component_scope(plugin_key)

        safe_globals = {
            '__builtins__': SAFE_SCRIPT_BUILTINS,
        }
        exec(ui_script.code, safe_globals, local_vars)

        if 'ui' in local_vars:
            result = local_vars['ui']
        elif 'result' in local_vars:
            result = local_vars['result']
        else:
            raise ValueError('UI 脚本必须设置 ui 或 result 变量')

        if not isinstance(result, (dict, list)):
            raise ValueError('UI 脚本输出必须是 dict 或 list')

        return result

    def run_workspace_script(self, plugin_id: str, script_name: str, *, method='GET'):
        self.ensure_loaded()
        plugin_key = str(plugin_id or '').strip()
        script_key = str(script_name or '').strip()
        if plugin_key not in self._plugins:
            raise PluginNotFoundError(f'插件不存在：{plugin_key}')

        record = self._plugins[plugin_key]
        script = record.workspace_scripts.get(script_key)
        if not script:
            raise PluginWorkspaceScriptNotFoundError(f'插件 workspace script 不存在：{plugin_key}/{script_key}')

        request_method = str(method or '').upper() or 'GET'
        if request_method not in script.methods:
            raise PluginWorkspaceScriptMethodNotAllowedError(
                f'插件 workspace script 不支持请求方法 {request_method}，仅支持 {",".join(script.methods)}'
            )

        return {
            'name': script.name,
            'source': script.source,
            'methods': list(script.methods),
            'description': script.description,
            'requires_permission': bool(script.requires_permission),
            'auto_run': bool(script.auto_run),
        }


plugin_registry = PluginRegistry()
