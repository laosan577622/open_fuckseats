PLUGIN_META = {
    'id': 'example_plugin',
    'name': '示例插件',
    'version': '2.0.0',
    'description': '演示插件系统全部能力：hook / action / UI script（含全组件）。',
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


def _reset_demo(context):
    return {'ok': True, 'message': '演示数据已重置'}


EXAMPLE_UI_SCRIPT = """
classroom_obj = classroom
student_count = classroom_obj.students.count() if classroom_obj else 0
group_count = classroom_obj.groups.count() if classroom_obj else 0
seat_count = classroom_obj.seats.filter(cell_type='seat').count() if classroom_obj else 0
seated_count = classroom_obj.seats.filter(cell_type='seat', student__isnull=False).count() if classroom_obj else 0
seat_rate = round(seated_count / seat_count * 100, 1) if seat_count > 0 else 0

ui = components.page(
    title='示例仪表盘',
    subtitle='展示全部组件类型，无需写前端代码',
    theme={'primary': '#0a59f7', 'style': 'apple-like'},
    blocks=[
        components.badge('运行中', 'success'),
        components.badge('v2.0.0', 'primary'),
        components.badge('示例插件', 'neutral'),
        components.badge('老三出品', 'neutral'),

        components.divider(),

        components.section('核心指标', '班级基本数据概览'),

        components.metric('学生人数', student_count, hint='已导入学生总数'),
        components.metric('小组数量', group_count, hint='当前分组数'),
        components.metric('座位总数', seat_count),
        components.metric('入座率', f"{seat_rate}%", hint=f"{seated_count}/{seat_count} 已入座"),

        components.divider(),

        components.section('进度与状态'),

        components.progress('入座进度', seat_rate, label='座位分配', hint=f"{seat_rate}%"),
        components.progress('数据完整度',
            min(100, round((1 if student_count > 0 else 0) * 33.3 + (1 if group_count > 0 else 0) * 33.3 + (1 if seated_count > 0 else 0) * 33.4, 1)),
            label='基础数据',
            hint='学生+分组+座位'
        ),

        components.divider(),

        components.section('详细信息'),

        components.text('插件说明', '这是一个示例插件，用于演示脚本式 UI 生成系统的全部组件类型。'
            '包括指标卡、进度条、徽章、分割线、段落标题、文本、列表、表格和动作按钮。'
            '所有组件均支持 span 参数控制列宽，渲染器基于 12 列 grid 自动排版。'),

        components.list('功能清单', [
            'metric - 指标卡，支持 label/value/hint',
            'text - 文本卡片，支持 title/text',
            'list - 列表卡片，支持 title/items',
            'table - 数据表格，支持 columns/rows',
            'actions - 动作按钮组，可调用插件 action',
            'progress - 进度条，支持 title/value/label/hint',
            'divider - 分割线',
            'section - 段落标题，支持 title/subtitle',
            'badge - 标签徽章，支持 5 种 variant',
        ]),

        components.table(
            '组件 Span 默认值',
            columns=[
                {'key': 'component', 'label': '组件'},
                {'key': 'default_span', 'label': '默认 Span'},
                {'key': 'desc', 'label': '说明'},
            ],
            rows=[
                {'component': 'metric', 'default_span': '3', 'desc': '紧凑指标卡'},
                {'component': 'text', 'default_span': '6', 'desc': '半宽文本'},
                {'component': 'list', 'default_span': '6', 'desc': '半宽列表'},
                {'component': 'progress', 'default_span': '6', 'desc': '半宽进度条'},
                {'component': 'badge', 'default_span': '3', 'desc': '紧凑徽章'},
                {'component': 'table', 'default_span': '12', 'desc': '全宽表格'},
                {'component': 'actions', 'default_span': '12', 'desc': '全宽按钮组'},
                {'component': 'divider', 'default_span': '12', 'desc': '全宽分割线'},
                {'component': 'section', 'default_span': '12', 'desc': '全宽段落标题'},
            ],
        ),

        components.divider(),

        components.section('快捷动作'),

        components.actions('插件操作', items=[
            {
                'label': '健康检查',
                'call': '/plugins/example_plugin/health/',
                'method': 'POST',
                'success_message': '插件运行正常',
            },
            {
                'label': '重置演示',
                'action': 'reset_demo',
                'method': 'POST',
                'variant': 'secondary',
                'success_message': '演示数据已重置',
            },
        ]),
    ],
)
""".strip()


def register(registry):
    registry.register_hook('classroom_created', _on_classroom_created)
    registry.register_action('health', _health, methods=('GET', 'POST'), description='插件健康检查与回显')
    registry.register_action('reset_demo', _reset_demo, methods=('POST',), description='重置演示数据')
    registry.register_ui_script('dashboard', EXAMPLE_UI_SCRIPT, methods=('GET', 'POST'), description='全组件演示仪表盘')
