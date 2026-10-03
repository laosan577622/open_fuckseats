"""Mask names at the model boundary; keep reversible aliases on this device."""
import json
import re
from functools import wraps

from .models import AIStudentNameAlias, ClassroomGroupStudent, FrontendKVStore, Student


STORE_KEY = 'fuckseats_ai_name_privacy'
ALIAS_PATTERN = re.compile(r'STU_[0-9a-f]{32}')
MODEL_INSTRUCTION = (
    '学生姓名已在本机进行 AI 加密脱敏，STU_ 开头的随机字符串是加密后的学生名称。'
    '同一个字符串始终代表同一姓名；不要猜测、解密、缩写或改写这些名称。'
    '调用工具和回复用户时，必须原样使用完整加密名，本机会自动还原并显示真名。'
)


def name_privacy_enabled():
    return FrontendKVStore.objects.filter(key=STORE_KEY).values_list('value', flat=True).first() != 'false'


def _map_strings(value, transform):
    if isinstance(value, str):
        return transform(value)
    if isinstance(value, list):
        return [_map_strings(item, transform) for item in value]
    if isinstance(value, dict):
        return {transform(key): _map_strings(item, transform) for key, item in value.items()}
    return value


def restore_student_names(value):
    aliases = set(ALIAS_PATTERN.findall(json.dumps(value, ensure_ascii=False)))
    if not aliases:
        return value
    names = dict(AIStudentNameAlias.objects.filter(alias__in=aliases).values_list('alias', 'name'))
    return _map_strings(value, lambda text: ALIAS_PATTERN.sub(lambda match: names.get(match[0], match[0]), text))


class AINamePrivacy:
    def __init__(self):
        self.enabled = name_privacy_enabled()
        self.names = {}
        self.used = set()
        self.display_names = {}
        self.sent_aliases = set()

    def refresh_names(self):
        # Include group-level students and retained aliases for names in old chats.
        names = set(Student.objects.values_list('name', flat=True))
        names.update(ClassroomGroupStudent.objects.values_list('name', flat=True))
        existing = dict(AIStudentNameAlias.objects.values_list('name', 'alias'))
        missing = sorted(name for name in names - existing.keys() if name.strip())
        if missing:
            AIStudentNameAlias.objects.bulk_create(
                [AIStudentNameAlias(name=name) for name in missing], ignore_conflicts=True,
            )
            existing = dict(AIStudentNameAlias.objects.values_list('name', 'alias'))
            if any(name not in existing for name in missing):
                raise RuntimeError('无法生成学生脱敏名称，请重试。')
        self.names = existing
        self.display_names.update({alias: name for name, alias in existing.items()})
        patterns = []
        for name in sorted(existing, key=lambda item: (-len(item), item)):
            # Latin names must not replace a substring inside another word.
            left = r'(?<![A-Za-z0-9_])' if re.match(r'[A-Za-z0-9_]', name) else ''
            right = r'(?![A-Za-z0-9_])' if re.search(r'[A-Za-z0-9_]$', name) else ''
            patterns.append(left + re.escape(name) + right)
        self.pattern = re.compile('|'.join(patterns)) if patterns else None

    def mask_text(self, text):
        # JSON tool output may use escaped Unicode; parse it before matching names.
        if text.lstrip().startswith(('{', '[', '"')):
            try:
                parsed = json.loads(text)
            except ValueError:
                pass
            else:
                return json.dumps(self.mask(parsed), ensure_ascii=False)
        if not self.pattern:
            return text

        def replace(match):
            alias = self.names[match[0]]
            self.used.add(alias)
            return alias

        # Never match a real name inside an alias or remask an already masked name.
        parts, start = [], 0
        for match in ALIAS_PATTERN.finditer(text):
            parts.extend((self.pattern.sub(replace, text[start:match.start()]), match[0]))
            start = match.end()
        parts.append(self.pattern.sub(replace, text[start:]))
        return ''.join(parts)

    def mask(self, value):
        return _map_strings(value, self.mask_text)

    def protect_item(self, item):
        if not isinstance(item, dict):
            return item
        result = dict(item)
        for field in ('content', 'reasoning_content', 'output'):
            if field in result:
                content = result[field]
                if isinstance(content, list):
                    # Keep multipart protocol fields (type, image_url, etc.) intact.
                    result[field] = [dict(part, text=self.mask_text(part['text']))
                                     if isinstance(part, dict) and isinstance(part.get('text'), str)
                                     else part for part in content]
                else:
                    result[field] = self.mask(content)
        if 'tool_calls' in result:
            result['tool_calls'] = [
                dict(call, function=dict(
                    call['function'], arguments=self.mask(call['function'].get('arguments', '{}')),
                )) for call in result['tool_calls']
            ]
        return result

    def protect_request(self, kwargs, *, mode):
        if not self.enabled:
            # Old masked pending calls can still be continued after disabling.
            return {key: restore_student_names(value) if key in {'messages', 'input', 'instructions'} else value
                    for key, value in kwargs.items()}
        self.refresh_names()
        result = dict(kwargs)
        field = 'messages' if mode == 'chat' else 'input'
        if field in result:
            result[field] = [self.protect_item(item) for item in result[field]]
        if mode == 'chat':
            result[field] = [{'role': 'system', 'content': MODEL_INSTRUCTION}, *result.get(field, [])]
        else:
            result['instructions'] = self.mask_text(str(result.get('instructions') or '') + '\n' + MODEL_INSTRUCTION).strip()
        if 'tools' in result:
            def protect_schema(value):
                if isinstance(value, list):
                    return [protect_schema(item) for item in value]
                if isinstance(value, dict):
                    return {key: self.mask(item) if key in {'description', 'examples', 'default', 'enum', 'const'}
                            else protect_schema(item) for key, item in value.items()}
                return value
            result['tools'] = protect_schema(result['tools'])
        return result

    def frontend_payload(self, payload, *, incremental=False):
        # This metadata stays in the local response and never enters model requests.
        aliases = self.used | set(ALIAS_PATTERN.findall(json.dumps(payload, ensure_ascii=False)))
        missing = aliases - self.display_names.keys()
        if missing:
            self.display_names.update(AIStudentNameAlias.objects.filter(alias__in=missing).values_list('alias', 'name'))
        if incremental:
            aliases -= self.sent_aliases
            self.sent_aliases.update(aliases)
        names = {alias: self.display_names[alias] for alias in sorted(aliases) if alias in self.display_names}
        return {**payload, 'name_privacy_enabled': self.enabled, 'student_name_aliases': names}


def get_ai_privacy(request=None):
    privacy = getattr(request, '_ai_name_privacy', None)
    if privacy is None:
        privacy = AINamePrivacy()
        if request is not None:
            request._ai_name_privacy = privacy
    return privacy


def with_ai_name_rendering(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        response = view(request, *args, **kwargs)
        privacy = get_ai_privacy(request)
        if response.streaming:
            chunks = response.streaming_content

            def events():
                for chunk in chunks:
                    text = chunk.decode('utf-8') if isinstance(chunk, bytes) else chunk
                    lines = text.splitlines()
                    for index, line in enumerate(lines):
                        if line.startswith('data: '):
                            payload = privacy.frontend_payload(json.loads(line[6:]), incremental=True)
                            lines[index] = 'data: ' + json.dumps(payload, ensure_ascii=False)
                    yield '\n'.join(lines) + '\n\n'
            response.streaming_content = events()
        elif response.get('Content-Type', '').startswith('application/json'):
            response.content = json.dumps(privacy.frontend_payload(json.loads(response.content)), ensure_ascii=False)
        return response
    return wrapped
