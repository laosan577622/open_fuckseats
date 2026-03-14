PLUGIN_META = {
    'id': 'example_plugin',
    'name': '示例插件',
    'version': '1.1.0',
    'description': '演示插件系统的 hook / action / UI script 开发方式。',
    'author': '老三',
    'website': 'www.577622.xyz',
}


def _on_classroom_created(context):
    classroom = context.get('classroom')
    if classroom is None:
        return None
    return {'message': f'班级已创建：{classroom.name}'}


def _health(context):
    payload = context.get('payload') or {}
    classroom = context.get('classroom')
    return {
        'ok': True,
        'plugin': 'example_plugin',
        'classroom_id': classroom.pk if classroom else None,
        'echo': payload,
    }


EXAMPLE_UI_SCRIPT = """
classroom_obj = classroom
student_count = classroom_obj.students.count() if classroom_obj else 0
group_count = classroom_obj.groups.count() if classroom_obj else 0

ui = {
    'type': 'page',
    'title': '插件示例仪表盘',
    'subtitle': '无需写前端代码，直接由脚本生成界面',
    'theme': {
        'primary': '#0a59f7',
        'style': 'apple-like',
    },
    'blocks': [
        {
            'type': 'metric',
            'label': '学生人数',
            'value': student_count,
        },
        {
            'type': 'metric',
            'label': '小组数量',
            'value': group_count,
        },
        {
            'type': 'text',
            'title': '说明',
            'text': '下面按钮会直接调用插件 action，并在执行后自动刷新界面。',
        },
        {
            'type': 'actions',
            'title': '快捷动作',
            'items': [
                {
                    'label': '健康检查',
                    'call': '/plugins/example_plugin/health/',
                    'method': 'POST',
                }
            ],
        },
    ],
}
""".strip()


def register(registry):
    registry.register_hook('classroom_created', _on_classroom_created)
    registry.register_action('health', _health, methods=('GET', 'POST'), description='插件健康检查与回显')
    registry.register_ui_script('dashboard', EXAMPLE_UI_SCRIPT, methods=('GET', 'POST'), description='脚本式 UI 生成示例')
