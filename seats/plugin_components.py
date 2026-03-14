from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Callable


ComponentFactory = Callable[[dict[str, Any]], dict[str, Any]]


class PluginComponentLibrary:
    def __init__(self):
        self._components: dict[str, ComponentFactory] = {}
        self._register_defaults()

    def _register_defaults(self):
        self.register('metric', self._build_metric)
        self.register('text', self._build_text)
        self.register('list', self._build_list)
        self.register('actions', self._build_actions)
        self.register('table', self._build_table)

    def register(self, name: str, factory: ComponentFactory):
        key = str(name or '').strip()
        if not key:
            raise ValueError('组件名称不能为空')
        if not callable(factory):
            raise ValueError('组件工厂必须是可调用对象')
        self._components[key] = factory

    def names(self) -> list[str]:
        return sorted(self._components.keys())

    def exists(self, name: str) -> bool:
        return str(name or '').strip() in self._components

    def call(self, name: str, **props):
        key = str(name or '').strip()
        if key not in self._components:
            raise ValueError(f'组件不存在：{key}')
        result = self._components[key](dict(props))
        if not isinstance(result, dict):
            raise ValueError('组件返回值必须是 dict')
        return deepcopy(result)

    def page(self, *, title: str, subtitle: str = '', blocks: list[dict[str, Any]] | None = None, theme=None):
        payload = {
            'type': 'page',
            'title': str(title or ''),
            'blocks': list(blocks or []),
        }
        if subtitle:
            payload['subtitle'] = str(subtitle)
        if isinstance(theme, dict) and theme:
            payload['theme'] = deepcopy(theme)
        return payload

    def metric(self, label: str, value: Any, hint: str = ''):
        props = {
            'label': label,
            'value': value,
        }
        if hint:
            props['hint'] = hint
        return self.call('metric', **props)

    def text(self, title: str, text: str):
        return self.call('text', title=title, text=text)

    def list(self, title: str, items: list[Any] | None = None, empty_text: str = '暂无数据'):
        return self.call('list', title=title, items=items or [], empty_text=empty_text)

    def actions(self, title: str, items: list[dict[str, Any]] | None = None):
        return self.call('actions', title=title, items=items or [])

    def table(self, title: str, columns: list[dict[str, Any]] | None = None, rows: list[dict[str, Any]] | None = None):
        return self.call('table', title=title, columns=columns or [], rows=rows or [])

    @staticmethod
    def _build_metric(props: dict[str, Any]):
        return {
            'type': 'metric',
            'label': str(props.get('label') or '指标'),
            'value': props.get('value'),
            **({'hint': str(props.get('hint'))} if props.get('hint') not in (None, '') else {}),
        }

    @staticmethod
    def _build_text(props: dict[str, Any]):
        return {
            'type': 'text',
            'title': str(props.get('title') or '说明'),
            'text': str(props.get('text') or ''),
        }

    @staticmethod
    def _build_list(props: dict[str, Any]):
        items = props.get('items')
        if not isinstance(items, list):
            items = []
        if not items:
            empty_text = str(props.get('empty_text') or '暂无数据')
            items = [empty_text]
        return {
            'type': 'list',
            'title': str(props.get('title') or '列表'),
            'items': items,
        }

    @staticmethod
    def _build_actions(props: dict[str, Any]):
        items = props.get('items')
        if not isinstance(items, list):
            items = []
        normalized = []
        for item in items:
            if not isinstance(item, dict):
                continue
            row = {
                'label': str(item.get('label') or '执行动作'),
            }
            for key in ('action', 'call', 'method', 'variant', 'success_message'):
                if key in item and item.get(key) not in (None, ''):
                    row[key] = item.get(key)
            payload = item.get('payload')
            if isinstance(payload, dict):
                row['payload'] = payload
            if item.get('refresh_ui') is False:
                row['refresh_ui'] = False
            normalized.append(row)

        return {
            'type': 'actions',
            'title': str(props.get('title') or '动作'),
            'items': normalized,
        }

    @staticmethod
    def _build_table(props: dict[str, Any]):
        columns = props.get('columns')
        rows = props.get('rows')
        if not isinstance(columns, list):
            columns = []
        if not isinstance(rows, list):
            rows = []
        return {
            'type': 'table',
            'title': str(props.get('title') or '表格'),
            'columns': columns,
            'rows': rows,
        }


@dataclass
class PluginComponentScope:
    plugin_id: str
    library: PluginComponentLibrary

    def names(self):
        return self.library.names()

    def exists(self, name: str):
        return self.library.exists(name)

    def call(self, name: str, **props):
        return self.library.call(name, **props)

    def page(self, **kwargs):
        return self.library.page(**kwargs)

    def metric(self, label, value, hint=''):
        return self.library.metric(label, value, hint)

    def text(self, title, text):
        return self.library.text(title, text)

    def list(self, title, items=None, empty_text='暂无数据'):
        return self.library.list(title, items or [], empty_text)

    def actions(self, title, items=None):
        return self.library.actions(title, items or [])

    def table(self, title, columns=None, rows=None):
        return self.library.table(title, columns or [], rows or [])


plugin_component_library = PluginComponentLibrary()


def get_component_scope(plugin_id: str):
    return PluginComponentScope(plugin_id=str(plugin_id or ''), library=plugin_component_library)
