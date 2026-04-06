# 插件开发文档

## 插件系统（Plugin System）

### 目标
- 以最小侵入方式扩展核心业务。
- 支持业务事件 Hook（监听系统动作）。
- 支持插件自定义 HTTP Action（被外部调用）。
- 支持脚本式 UI 生成（无需写前端框架代码）。
- 支持类 Chrome 扩展调用（manifest + runtime.sendMessage）。
- 支持插件在用户授权后直接改造工作页（Workspace Script）。

### 默认加载规则
- 默认插件目录：`项目根目录/plugins/`。
- Django 配置项：`PLUGIN_DIRS`（`config/settings.py` 已内置默认值）。
- 环境变量：`PLUGIN_DIRS`（多个目录用英文逗号分隔），会与 `settings.PLUGIN_DIRS` 合并。

### 插件文件结构
支持两种形式：
- 单文件插件：`plugins/xxx.py`
- 包插件：`plugins/xxx/plugin.py`（或 `plugins/xxx/__init__.py`）

每个插件必须暴露：
- `PLUGIN_META`（字典，推荐）
- `register(registry)`（函数，必需）

最小示例：
```python
PLUGIN_META = {
    'id': 'my_plugin',
    'name': '我的插件',
    'version': '1.0.0',
    'description': '演示插件',
    'author': '老三',
    'website': 'www.577622.xyz',
}


def on_created(context):
    classroom = context.get('classroom')
    return {'created': classroom.name if classroom else ''}


def ping(context):
    return {'ok': True, 'payload': context.get('payload') or {}}


def register(registry):
    registry.register_hook('classroom_created', on_created)
    registry.register_action('ping', ping, methods=('GET', 'POST'), description='插件连通性测试')
```

### `register(registry)` 可用 API
- `registry.register_hook(event, handler, plugin_id=None)`
- `registry.register_action(action, handler, methods=('POST',), description='', plugin_id=None)`
- `registry.register_ui_script(ui_name, script, methods=('GET',), description='', plugin_id=None)`
- `registry.register_workspace_script(script_name, script, methods=('GET',), description='', requires_permission=True, auto_run=False, plugin_id=None)`

说明：
- 在插件自身的 `register()` 中调用时，不需要手动传 `plugin_id`。
- `handler` 支持三种签名：
  - `def handler(context): ...`
  - `def handler(**kwargs): ...`
  - `def handler(request, classroom, payload, ...): ...`（按参数名自动注入）

### 脚本式 UI 生成
`register_ui_script()` 允许插件直接写 Python 脚本输出 UI Schema。

脚本约定：
- 最终必须设置 `ui` 或 `result` 变量。
- 输出类型必须是 `dict` 或 `list`。
- 可用上下文字段：`request`、`classroom`、`payload`、`plugin_id`、`ui_name`。
- 为安全起见，脚本运行在受限内建函数环境中（不提供 `import`）。

示例：
```python
UI_SCRIPT = """
student_count = classroom.students.count() if classroom else 0
ui = {
    'type': 'page',
    'title': '插件仪表盘',
    'theme': {'primary': '#0a59f7'},
    'blocks': [
        {'type': 'metric', 'label': '学生人数', 'value': student_count},
    ],
}
""".strip()


def register(registry):
    registry.register_ui_script('dashboard', UI_SCRIPT, methods=('GET', 'POST'))
```

### 可调用组件库（Component Library）
系统已内置可调用组件库，插件 UI 脚本里可直接使用 `components` 对象，无需 import。

常用 API：
- `components.page(title=..., subtitle=..., blocks=[...], theme={...})`
- `components.metric(label, value, hint='', span=None)`
- `components.text(title, text, span=None)`
- `components.list(title, items, empty_text='暂无数据', span=None)`
- `components.actions(title, items, span=None)`
- `components.table(title, columns, rows, span=None)`
- `components.progress(title, value, label='', hint='', span=None)`
- `components.divider()`
- `components.section(title, subtitle='')`
- `components.badge(text, variant='primary', span=None)`
- `components.call('metric', label='xx', value=1)`
- `components.names()` / `components.exists(name)`

`span` 参数说明：
- 渲染器使用 12 列 grid 布局，`span` 控制组件占据的列数（1~12）。
- 不传 `span` 时，各组件有默认值：`metric=3`、`text=6`、`list=6`、`progress=6`、`table=12`、`actions=12`、`badge=3`。
- `divider` 和 `section` 始终占满整行。

`badge` 的 `variant` 可选值：`primary`、`success`、`warning`、`danger`、`neutral`。

示例：
```python
count = classroom.students.count() if classroom else 0
ui = components.page(
    title='统计看板',
    blocks=[
        components.badge('运行中', 'success'),
        components.metric('学生人数', count),
        components.metric('小组数', 5, span=3),
        components.progress('导入进度', 75, label='正在处理', hint='75%'),
        components.divider(),
        components.section('详细信息', '以下为扩展数据'),
        components.text('提示', '这个页面由组件库生成'),
    ],
)
```

工作页注入脚本（Workspace Script）同样可调用前端组件库：
- `api.components.card(...)`
- `api.components.title(...)`
- `api.components.text(...)`
- `api.components.pillButton(...)`
- `api.components.badge(...)`
- `api.components.stack(...)`
- `window.SeatsComponentLibrary.*`（全局调用）

### Workspace Script（授权后页面改造）
用于让插件直接增强工作页（例如插入搜索栏、视图增强、快捷工具）。

示例：
```python
WORKSPACE_SCRIPT = """
const panel = document.createElement('div')
panel.textContent = '插件已注入'
document.body.appendChild(panel)
return () => panel.remove()
""".strip()


def register(registry):
    registry.register_workspace_script(
        'inject_panel',
        WORKSPACE_SCRIPT,
        requires_permission=True,
        auto_run=True,
        description='注入页面增强面板',
    )
```

字段说明：
- `requires_permission=True`：要求用户先授权，才能执行脚本。
- `auto_run=True`：在授权后，工作页加载插件时自动注入（无感体验）。
- 脚本返回函数时，会作为卸载回调，在撤销授权时被调用。

### 通用渲染页面（零前端）
系统提供了一个开箱即用的渲染器页面，可直接把脚本输出的 `ui` 渲染成界面：
- `GET /plugins/<plugin_id>/ui/<ui_name>/page/`

你只要访问：
```text
/plugins/example_plugin/ui/dashboard/page/?classroom_id=1
```
就能看到自动渲染后的页面。

当前渲染器支持的 block：
- `metric`：指标卡（`label/value/hint`，默认 span 3）
- `text`：文字卡片（`title/text`，默认 span 6）
- `list`：列表卡片（`title/items`，默认 span 6）
- `actions`：动作按钮组（`items`，可触发插件 action，默认 span 12）
- `table`：数据表格（`title/columns/rows`，默认 span 12）
- `progress`：进度条（`title/value/label/hint`，默认 span 6）
- `divider`：分割线（始终全宽）
- `section`：段落标题（`title/subtitle`，始终全宽）
- `badge`：标签徽章（`text/variant`，默认 span 3，variant 可选 primary/success/warning/danger/neutral）
- 其他类型会自动按 JSON 卡片展示

所有 block 均支持 `span` 字段（1~12），用于自定义在 12 列 grid 中占据的列数。
渲染器会根据 block 类型自动分配默认 span，也可由脚本显式覆盖。
卡片出现时带有模糊渐入动效，交错入场。

`actions.items` 常用字段：
- `label`：按钮文本
- `call`：直接调用地址（如 `/plugins/example_plugin/health/`）
- `action`：动作名（自动映射为 `/plugins/<plugin>/<action>/`）
- `method`：`GET/POST`，默认 `POST`
- `payload`：请求参数
- `refresh_ui`：是否执行后刷新 UI（默认 `true`）

### Hook 事件与上下文
当前内置事件：
- `app_ready`：应用启动、插件装载完成后触发。
- `classroom_created`：创建班级后触发。
- `students_imported`：学生导入成功后触发。
- `seats_arranged`：自动排座成功后触发（包含 `auto_fixed` 标记）。
- `group_created`：创建小组成功后触发。
- `student_moved`：单人移动成功后触发。
- `students_moved_batch`：批量移动成功后触发。
- `student_assigned`：手动指派成功后触发。

Hook 的 `context` 关键字段：
- `hook`：事件名称
- `request`：当前 Django Request（可能为 `None`）
- `classroom`：当前班级对象（可能为 `None`）
- `payload`：动作附加数据
- `timestamp`：ISO 时间戳

### 插件 HTTP API
系统内置扩展与插件接口：

1. 查看插件注册状态
- `GET /plugins/`
- 返回：插件列表、每个插件的 Hook/Action/WorkspaceScript，以及加载错误 `load_errors`

1.1 查看可调用组件库
- `GET /plugins/components/`
- 返回：内置组件名称列表（可在 UI 脚本中通过 `components` 调用）

2. 调用插件 Action
- `GET|POST /plugins/<plugin_id>/<action>/`
- `POST application/json` 请求体会作为 `payload`
- 可选 `classroom_id` 字段会自动解析为班级对象并注入 `context['classroom']`

调用示例：
```bash
curl -X POST http://127.0.0.1:23948/plugins/example_plugin/health/ \
  -H "Content-Type: application/json" \
  -d '{"classroom_id": 1, "hello": "world"}'
```

3. 调用插件脚本式 UI
- `GET|POST /plugins/<plugin_id>/ui/<ui_name>/`
- 参数规则与 Action 相同，响应体关键字段为 `ui`

4. 打开通用渲染页面
- `GET /plugins/<plugin_id>/ui/<ui_name>/page/`
- 适合直接给教师或运营同学访问，不需要写前端

5. 类 Chrome 扩展清单
- `GET /extensions/`
- 浏览器直接访问：返回可视化“扩展清单”页面
- Ajax/XHR（`X-Requested-With: XMLHttpRequest`）或 `?format=json`：返回 JSON 扩展列表
- 可追加 `classroom_id` 查询参数，以返回当前班级的插件授权状态

6. 类 Chrome 扩展 Manifest
- `GET /extensions/<plugin_id>/manifest.json`

7. 插件页面改造授权（必须用户显式授权）
- 查询：`GET /extensions/<plugin_id>/permissions/?classroom_id=1`
- 更新：`POST /extensions/<plugin_id>/permissions/`
- 请求体：`{"classroom_id": 1, "granted": true}`

8. 类 Chrome runtime.sendMessage
- `POST /extensions/<plugin_id>/runtime/send-message/`
- 兼容别名：`/extensions/<plugin_id>/runtime/sendMessage/`
- `type` 支持：`action`、`ui`、`workspace_script`、`manifest`

请求示例：
```json
{
  "classroom_id": 1,
  "message": {
    "type": "workspace_script",
    "name": "inject_search_panel",
    "method": "GET"
  }
}
```

### 无感调用（工作页）
班级工作页已内置：
- “插件”标签 + 插件中心
- 快捷入口（Ribbon 内联）
- 命令面板（`Ctrl+K`）
- 页面改造授权按钮
- 授权后自动执行 `auto_run` 的 Workspace Script

并且提供前端兼容调用：
- `chrome.runtime.sendMessage(...)`
- `window.SeatsPlugins.runAction(...)`
- `window.SeatsPlugins.getUI(...)`
- `window.SeatsPlugins.runWorkspace(...)`

### 返回约定
- Action 返回 `HttpResponse`：直接透传。
- Action 返回其他对象：统一包装为 JSON：`{status, plugin, action, result}`。
- 常见错误码：
  - `404` 插件或动作不存在
  - `405` 动作不支持当前请求方法
  - `400` 请求体格式不正确
  - `403` 页面改造脚本未授权
  - `500` 插件执行异常

### 内置示例插件
- `plugins/example_plugin.py`：基础示例（Hook + Action + UI Script）
- `plugins/student_search_plugin.py`：学生搜索插件（Action + UI Script + Workspace Script）

### 调试建议
- 先访问 `GET /plugins/` 确认是否加载成功。
- 若加载失败，优先看返回体中的 `load_errors`。
- 开发期修改插件后重启服务，确保重新装载。

### 安全建议
- 插件代码与主进程同权限执行，请仅加载可信插件。
- 页面改造能力默认要求用户授权，不建议跳过授权流程。
- 插件 Action 建议自行校验参数、做鉴权与限流。
- 建议将副作用逻辑放在明确 Action 内，Hook 尽量保持轻量。
