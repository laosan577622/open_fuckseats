from dataclasses import dataclass, field
from typing import Any, Callable

from django.db import transaction
from django.conf import settings
from django.http import Http404

from seats.models import Classroom


class ToolExecutionError(Exception):
    def __init__(self, message, *, code='BAD_REQUEST', status=400):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class ToolResult:
    result: dict[str, Any] = field(default_factory=dict)
    affected: dict[str, Any] = field(default_factory=dict)
    oral_confirmation_required: bool = False


@dataclass
class ToolContext:
    tool_name: str
    arguments: dict[str, Any]
    classroom: Classroom | None = None
    request: Any = None


@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[ToolContext], ToolResult | dict[str, Any]]
    category: str = 'general'
    read_only: bool = True
    requires_classroom: bool = True
    danger_level: str = 'safe'

    def schema(self):
        return {
            'type': 'function',
            'function': {
                'name': self.name,
                'description': self.description,
                'parameters': self.parameters,
            },
            'metadata': {
                'category': self.category,
                'read_only': self.read_only,
                'requires_classroom': self.requires_classroom,
                'danger_level': self.danger_level,
            },
        }

    def mcp_schema(self):
        return {
            'name': self.name,
            'description': self.description,
            'inputSchema': self.parameters,
        }


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, ToolDefinition] = {}

    def register(
        self,
        *,
        name,
        description,
        parameters,
        category='general',
        read_only=True,
        requires_classroom=True,
        danger_level='safe',
    ):
        def decorator(func):
            if name in self._tools:
                raise RuntimeError(f'Open API tool already registered: {name}')
            self._tools[name] = ToolDefinition(
                name=name,
                description=description,
                parameters=parameters,
                handler=func,
                category=category,
                read_only=read_only,
                requires_classroom=requires_classroom,
                danger_level=danger_level,
            )
            return func

        return decorator

    def get(self, name):
        tool = self._tools.get(str(name or '').strip())
        if tool and tool.category == 'ai' and not bool(getattr(settings, 'AI_FEATURE_ENABLED', False)):
            tool = None
        if not tool:
            raise ToolExecutionError(f'未知工具：{name}', code='TOOL_NOT_FOUND', status=404)
        return tool

    def all(self):
        tools = [self._tools[name] for name in sorted(self._tools)]
        if not bool(getattr(settings, 'AI_FEATURE_ENABLED', False)):
            tools = [tool for tool in tools if tool.category != 'ai']
        return tools

    def schemas(self, *, category=None):
        tools = self.all()
        if category:
            tools = [tool for tool in tools if tool.category == category]
        return [tool.schema() for tool in tools]

    def mcp_schemas(self):
        return [tool.mcp_schema() for tool in self.all()]

    def execute(self, name, *, classroom_id=None, arguments=None, request=None):
        tool = self.get(name)
        arguments = dict(arguments or {})
        classroom = None
        effective_classroom_id = classroom_id or arguments.get('classroom_id')
        if tool.requires_classroom:
            if not effective_classroom_id:
                raise ToolExecutionError('缺少 classroom_id', code='CLASSROOM_ID_REQUIRED', status=400)
            try:
                classroom = Classroom.objects.get(pk=int(effective_classroom_id))
            except (TypeError, ValueError):
                raise ToolExecutionError('classroom_id 必须是整数', code='INVALID_CLASSROOM_ID', status=400)
            except Classroom.DoesNotExist:
                raise ToolExecutionError(f'未找到教室：{effective_classroom_id}', code='CLASSROOM_NOT_FOUND', status=404)

        try:
            raw = tool.handler(ToolContext(
                tool_name=tool.name,
                arguments=arguments,
                classroom=classroom,
                request=request,
            ))
        except ToolExecutionError:
            raise
        except Http404 as exc:
            raise ToolExecutionError(str(exc) or '资源不存在', code='NOT_FOUND', status=404)
        except ValueError as exc:
            raise ToolExecutionError(str(exc), code='BAD_REQUEST', status=400)
        except Exception as exc:
            raise ToolExecutionError(str(exc), code='INTERNAL_ERROR', status=500)

        if isinstance(raw, ToolResult):
            payload = {
                'status': 'ok',
                'tool': tool.name,
                'result': raw.result,
                'affected': raw.affected,
                '_oral_confirmation_required': bool(raw.oral_confirmation_required),
            }
        elif isinstance(raw, dict) and raw.get('status') == 'ok' and 'result' in raw:
            payload = raw
        else:
            payload = {
                'status': 'ok',
                'tool': tool.name,
                'result': raw if isinstance(raw, dict) else {'value': raw},
                'affected': {},
                '_oral_confirmation_required': False,
            }

        if not tool.read_only and tool.category != 'ai':
            from . import realtime
            changed_classroom_id = classroom.pk if classroom is not None else None
            changed_classroom_ids = []
            affected = payload.get('affected') if isinstance(payload.get('affected'), dict) else {}
            if isinstance(affected.get('classroom_ids'), list):
                changed_classroom_ids.extend(affected.get('classroom_ids'))
            if changed_classroom_id is None:
                result_classroom = payload.get('result', {}).get('classroom') if isinstance(payload.get('result'), dict) else None
                if isinstance(result_classroom, dict):
                    changed_classroom_id = result_classroom.get('id')
            if changed_classroom_id is not None:
                changed_classroom_ids.append(changed_classroom_id)
            normalized_ids = []
            for value in changed_classroom_ids:
                try:
                    value = int(value)
                except (TypeError, ValueError):
                    continue
                if value not in normalized_ids:
                    normalized_ids.append(value)

            def bump_changed(ids=normalized_ids):
                if not ids:
                    realtime.bump(None, data=True)
                    return
                for index, classroom_value in enumerate(ids):
                    realtime.bump(classroom_value, data=index == 0)

            transaction.on_commit(bump_changed)

        return payload


registry = ToolRegistry()
