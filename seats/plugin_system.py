from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from django.conf import settings

import desktop_runtime
from plugin_core import (
    BasePluginRegistry,
    DjangoModelStorageBackend,
    HookResult,
    PluginActionNotFoundError,
    PluginDisabledError,
    PluginError,
    PluginMethodNotAllowedError,
    PluginNotFoundError,
)
from plugin_core.actions import normalize_methods

from .plugin_components import get_component_scope
from .plugin_services import local_plugin_service_factories


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
    'zip': zip,
}


PluginActionMethodNotAllowedError = PluginMethodNotAllowedError


class PluginUIScriptNotFoundError(PluginError):
    pass


class PluginUIScriptMethodNotAllowedError(PluginMethodNotAllowedError):
    pass


class PluginWorkspaceScriptNotFoundError(PluginError):
    pass


class PluginWorkspaceScriptMethodNotAllowedError(PluginMethodNotAllowedError):
    pass


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
    permissions: tuple[str, ...] = ('workspace.dom',)
    requires_permission: bool = True
    auto_run: bool = False


def _plugin_storage_model():
    from .models import PluginRuntimeKV

    return PluginRuntimeKV


def _plugin_storage_secret():
    import hashlib
    from database_security import get_database_key

    return hashlib.sha256(get_database_key() + b'fuckseats-plugin-storage-v2').hexdigest()


# 旧密钥仅用于迁移插件密文，绝不能用于 Django 签名或新数据加密。
LEGACY_PLUGIN_STORAGE_KEY = 'django-insecure-1bux7tnh9ubww-d(pohhj#nw=n5ndw-&8tvns(!yx-pb*sn3xz'


class PluginRegistry(BasePluginRegistry):
    runtime_name = 'local'

    def __init__(self):
        super().__init__(
            app_version=desktop_runtime.get_current_version(),
            storage_backend=DjangoModelStorageBackend(
                _plugin_storage_model, _plugin_storage_secret,
                fallback_secret_keys=(LEGACY_PLUGIN_STORAGE_KEY,),
            ),
            services=local_plugin_service_factories(),
        )

    def resolve_plugin_dirs(self):
        raw_dirs = list(getattr(settings, 'PLUGIN_DIRS', []))
        env_dirs = os.getenv('PLUGIN_DIRS', '').strip()
        if env_dirs:
            raw_dirs.extend([item.strip() for item in env_dirs.split(',') if item.strip()])
        if not raw_dirs:
            raw_dirs = [str(Path(settings.BASE_DIR) / 'plugins')]
        return raw_dirs

    def register_ui_script(
        self,
        ui_name,
        script,
        *,
        methods=('GET',),
        description='',
        plugin_id=None,
    ):
        record = self._current_record(plugin_id)
        ui_key = str(ui_name or '').strip()
        if not ui_key:
            raise ValueError('ui_name 不能为空')
        source = str(script or '').strip()
        if not source:
            raise ValueError('UI 脚本内容不能为空')
        try:
            code = compile(source, f'<plugin-ui:{record.plugin_id}:{ui_key}>', 'exec')
        except SyntaxError as exc:
            raise ValueError(f'UI 脚本语法错误：{exc}') from exc
        if ui_key in record.ui_scripts:
            raise ValueError(f'重复 UI 脚本：{ui_key}')
        record.ui_scripts[ui_key] = PluginUIScript(
            name=ui_key,
            source=source,
            code=code,
            methods=normalize_methods(methods, default=('GET',)),
            description=str(description or ''),
        )

    def register_workspace_script(
        self,
        script_name,
        script,
        *,
        methods=('GET',),
        description='',
        permissions=('workspace.dom',),
        requires_permission=True,
        auto_run=False,
        plugin_id=None,
    ):
        record = self._current_record(plugin_id)
        script_key = str(script_name or '').strip()
        if not script_key:
            raise ValueError('script_name 不能为空')
        source = str(script or '').strip()
        if not source:
            raise ValueError('workspace script 内容不能为空')
        if script_key in record.workspace_scripts:
            raise ValueError(f'重复 workspace script：{script_key}')
        permission_rows = tuple(str(item) for item in (permissions or ()) if str(item).strip())
        for capability in permission_rows:
            self.require_permission(record.plugin_id, capability)
        record.workspace_scripts[script_key] = PluginWorkspaceScript(
            name=script_key,
            source=source,
            methods=normalize_methods(methods, default=('GET',)),
            description=str(description or ''),
            permissions=permission_rows,
            requires_permission=bool(requires_permission),
            auto_run=bool(auto_run),
        )

    def run_ui_script(self, plugin_id, ui_name, *, method='GET', **context):
        self.ensure_loaded()
        record = self._current_record(plugin_id)
        if not record.enabled:
            raise PluginDisabledError(f'插件已禁用：{record.plugin_id}')
        ui_key = str(ui_name or '').strip()
        ui_script = record.ui_scripts.get(ui_key)
        if ui_script is None:
            raise PluginUIScriptNotFoundError(f'插件 UI 不存在：{record.plugin_id}/{ui_key}')
        request_method = str(method or 'GET').upper()
        if request_method not in ui_script.methods:
            raise PluginUIScriptMethodNotAllowedError(
                f'插件 UI 不支持请求方法 {request_method}，仅支持 {",".join(ui_script.methods)}'
            )

        ctx = self.create_context(record.plugin_id, ui_name=ui_key, **context)
        local_vars = ctx.to_dict()
        local_vars['components'] = get_component_scope(record.plugin_id)
        safe_globals = {'__builtins__': SAFE_SCRIPT_BUILTINS}
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

    def run_workspace_script(self, plugin_id, script_name, *, method='GET'):
        self.ensure_loaded()
        record = self._current_record(plugin_id)
        if not record.enabled:
            raise PluginDisabledError(f'插件已禁用：{record.plugin_id}')
        script_key = str(script_name or '').strip()
        script = record.workspace_scripts.get(script_key)
        if script is None:
            raise PluginWorkspaceScriptNotFoundError(
                f'插件 workspace script 不存在：{record.plugin_id}/{script_key}'
            )
        request_method = str(method or 'GET').upper()
        if request_method not in script.methods:
            raise PluginWorkspaceScriptMethodNotAllowedError(
                f'插件 workspace script 不支持请求方法 {request_method}，仅支持 {",".join(script.methods)}'
            )
        return {
            'name': script.name,
            'source': script.source,
            'methods': list(script.methods),
            'description': script.description,
            'permissions': list(script.permissions),
            'requires_permission': script.requires_permission,
            'auto_run': script.auto_run,
        }

    def serialize_record(self, record, *, detailed=False):
        row = super().serialize_record(record, detailed=detailed)
        row['ui_scripts'] = [
            {
                'name': ui.name,
                'methods': list(ui.methods),
                'description': ui.description,
            }
            for ui in sorted(record.ui_scripts.values(), key=lambda item: item.name)
        ]
        row['workspace_scripts'] = [
            {
                'name': script.name,
                'methods': list(script.methods),
                'description': script.description,
                'permissions': list(script.permissions),
                'requires_permission': script.requires_permission,
                'auto_run': script.auto_run,
            }
            for script in sorted(record.workspace_scripts.values(), key=lambda item: item.name)
        ]
        return row


PluginHookResult = HookResult
plugin_registry = PluginRegistry()
