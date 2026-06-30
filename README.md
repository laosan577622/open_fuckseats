# 不想排座位

> 让排座位这件事，不再是一件事。

一个面向班主任和教务人员的智能教室排座系统。覆盖班级管理、名单导入、布局编辑、自动排座、约束规则、小组管理、AI 赋能和多格式导出等完整工作流。桌面版通过 pywebview 提供原生窗口体验，开发模式下也可直接使用浏览器访问。

项目总代码量约 48000 行，核心业务逻辑 13000+ 行，前端交互 4500+ 行。

---

## 特性一览

- 8 种自动排座算法，覆盖随机、成绩、小组等多种策略
- 8 种约束类型，支持指定/禁用座位、行、列、相邻关系
- AI 赋能工作台，基于 OpenAI API function calling 实现自然语言操控座位
- 多格式导出：Excel、SVG、PPTX、`.seats` 快照
- 插件系统：Hook + Action + UI Script + Workspace Script 四种扩展方式
- 桌面端原生体验：pywebview + EdgeChromium，支持 Windows 自动更新
- 完整撤销/重做历史、Spotlight 命令面板、3D Toast 通知

---

## 核心能力

### 班级与布局
- 新建、重命名、删除班级
- 编辑行列网格，支持座位、走廊、讲台、空位四种单元类型
- 行列插入/删除、布局整体平移、镜像翻转
- 布局快照保存与加载，支持 `.seats` 文件导入导出

### 学生管理
- 手动添加单个学生（姓名、学号、性别、成绩）
- 右键编辑未入座学生信息
- Excel 批量导入（自动识别列或手动映射）
- 拖拽入座、单人/批量移动、框选多选操作
- 讲台左右护法设置

### 自动排座
内置 8 种排座算法：
- `random` 随机排座
- `score_desc` / `score_asc` 按成绩降序/升序
- `good_front` / `good_back` 优生靠前/靠后
- `score_spread` 成绩均匀分散
- `group_balanced` 小组均衡分布
- `group_mentor` 小组导师模式

### 约束系统
- 指定座位 / 禁用座位
- 指定行 / 禁用行
- 指定列 / 禁用列
- 指定相邻 / 禁止相邻（支持自定义距离）
- 约束冲突检测与违反状态实时诊断

### 小组系统
- 创建、重命名、删除小组
- 批量分配、自动编组、合并组、轮换组
- 组长设置
- 小组登记表 Excel 导出

### 数据导入
- 学生 Excel 导入：自动识别姓名/成绩列，支持匹配更新或清空全量导入
- 座位表 Excel 导入：识别合并单元格、讲台/走廊/空位/姓名，支持手工词典覆盖
- `.seats` 快照导入：覆盖当前班级的学生、座位、小组和约束
- BSCE 格式导入（含云端导入）

### 数据导出
- 座次 Excel（`.xlsx`）
- 座次 SVG（可配置主题与显示内容，适用于 PPT 嵌入）
- 座次 PPTX（单页 16:9 横屏）
- 小组登记表 Excel
- `.seats` 快照文件
- 导出均采用独立配置页面（左侧设置、右侧预览），桌面版调用系统原生保存对话框

### AI 赋能模式
- 顶部 AI 选项卡打开闻道赋能工作台
- 基于 OpenAI API + function calling
- 支持交换座位、查询学生信息、统计小组评分、发送结构化图卡
- 多轮对话、对话隔离、消息持久化
- 学生列表工具支持排序、分页、筛选
- 兼容 OpenAI Compatible API（非官方地址自动切换 Chat Completions）
- 工具调用前需用户授权确认

### 云同步
- 班级数据推送/拉取，冲突检测与解决
- 云端快照备份与恢复
- 订阅套餐管理（免费版/付费版）
- 自动同步与手动同步
- 登录/注册阶段完成非对称密钥交换，后续同步、快照、订阅相关云请求统一采用端到端加密信封传输（RSA-OAEP + AES-GCM 混合加密）

### 插件系统
- 基于 Python 文件的插件加载机制
- 支持 hook（事件钩子）、action（动作）、UI script（脚本式 UI）、workspace script（工作区注入脚本）
- 内置示例插件和学生搜索插件
- 插件 UI 采用组件化渲染（metric、table、list、progress、badge 等）
- 扩展系统支持 manifest、权限管理、运行时消息通信

### 桌面端能力
- pywebview 原生窗口（Windows 使用 EdgeChromium 内核）
- 系统原生文件保存对话框（导出时自动调用）
- Windows 右键菜单桥接（复制/粘贴/全选等原生操作）
- Windows 管理员权限自动提权
- 自动更新：检测新版本 -> 下载安装包 -> 静默安装
- 版本清单通过 `runtime/release.json` 管理

### 其他
- 撤销/重做（完整操作历史，基于 `ClassroomHistoryEntry` 模型）
- Spotlight 命令面板（快速执行操作）
- 3D 卡片翻转 Toast 通知系统
- 前端 KV 存储（主题、偏好等持久化到数据库）
- 水波纹点击特效、Metaball 动画效果
- 新手引导（真实界面气泡式）：首次进入应用时，系统自动为你创建一个「示例班级」并填入示例名单（12 名带成绩的学生）和两个示例小组；在首页高亮示例班级卡片引导你点进，进入后用气泡一步步带你体验「自动排座 → 布局编辑 → 讲台左右护法 → 拖拽换座 → 右键菜单 → 小组管理 → 导入导出 → 登录云服务」全流程。是否已看过引导由 `OnboardingState` 会话记录和 `FrontendKVStore` 本机稳定标记共同落库判定，完成后会自动删除示例班级，跳过后不再自动弹出；可在班级页「帮助」标签页点击「新手引导」手动重看。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | Django 6.0 |
| 数据库 | SQLite3 |
| 生产服务器 | Waitress（端口 23948） |
| 桌面壳 | pywebview（Windows 使用 EdgeChromium） |
| 静态文件 | WhiteNoise + CompressedManifestStaticFilesStorage |
| 数据处理 | pandas, openpyxl, python-pptx, xlrd |
| AI | OpenAI SDK（Responses API / Chat Completions） |
| 拼音排序 | pypinyin |
| SSL | certifi |
| 前端 | Django Template + 原生 JavaScript（无框架依赖） |
| 字体 | HarmonyOS Sans SC（7 种字重） |

---

## 项目结构

```
.
├── manage.py                  # Django 管理入口
├── run_app.py                 # 统一启动脚本（迁移 + Waitress + pywebview/浏览器）
├── desktop_shell.py           # 桌面桥接层（原生对话框、文件导入导出、Windows 右键菜单）
├── desktop_runtime.py         # 桌面运行时（版本管理、自动更新、Windows 提权）
├── package.py                 # PyInstaller 打包脚本（清理数据库、环境变量脱敏）
├── config/                    # Django 配置
│   ├── settings.py            # 全局设置（数据库、插件目录、OpenAI 配置）
│   ├── urls.py                # 根路由
│   ├── wsgi.py                # WSGI 入口
│   └── asgi.py                # ASGI 入口
├── seats/                     # 核心业务应用
│   ├── models.py              # 数据模型
│   ├── views.py               # 视图层（13000+ 行，120+ 个路由处理函数）
│   ├── urls.py                # 业务路由（120+ 条）
│   ├── constraints.py         # 约束系统（校验、诊断、编译、冲突检测）
│   ├── cloud.py               # 云同步客户端
│   ├── plugin_system.py       # 插件注册中心（加载、沙箱、调度）
│   ├── plugin_components.py   # 插件 UI 组件库（metric/table/list/progress/badge 等）
│   ├── context_processors.py  # 模板上下文注入（运行时信息、Shell 类型）
│   └── migrations/            # 11 个数据库迁移文件
├── templates/                 # 页面模板
│   ├── base.html              # 基础模板（全局样式、Toast、Modal、顶栏）
│   └── seats/                 # 14 个业务页面模板
│       ├── index.html         # 首页（班级列表）
│       ├── classroom_detail.html  # 班级详情（座位表主界面）
│       ├── ai_workspace.html  # AI 闻道赋能工作台
│       ├── layout_editor.html # 布局编辑器
│       ├── settings.html      # 全局设置页
│       ├── extensions_overview.html  # 扩展管理页
│       ├── export_*.html      # 导出配置页（Excel/SVG/PPTX）
│       └── import_*.html      # 导入配置页（学生/布局）
├── static/
│   ├── css/                   # 样式文件
│   │   ├── styles.css         # 主样式（3800+ 行）
│   │   ├── ai_workspace.css   # AI 工作台样式
│   │   ├── dynamic-island.css # 灵动岛样式
│   │   └── plugin_ui.css      # 插件 UI 样式
│   ├── js/                    # 前端脚本
│   │   ├── classroom.js       # 班级详情页核心交互（4500+ 行）
│   │   ├── ai_workspace.js    # AI 赋能工作台（850+ 行）
│   │   ├── desktop_bridge.js  # 桌面端导出桥接
│   │   ├── layout_editor.js   # 布局编辑器
│   │   ├── toast.js           # 3D Toast 通知系统
│   │   ├── theme.js           # 主题管理
│   │   ├── effects.js         # 视觉特效
│   │   ├── water-ripple.js    # 水波纹效果
│   │   ├── metaball.js        # Metaball 动画
│   │   ├── dynamic-island.js  # 灵动岛交互
│   │   ├── update.js          # 桌面端自动更新 UI
│   │   └── export_options.js  # 导出配置页通用逻辑
│   ├── favicon.svg            # 站点图标
│   └── update.svg             # 更新图标
├── plugins/                   # 插件目录
│   ├── example_plugin.py      # 示例插件（全组件演示）
│   └── student_search_plugin.py # 学生搜索插件（浮层搜索 + 座位高亮）
├── fonts/                     # HarmonyOS Sans SC 字体（7 种字重）
├── runtime/                   # 运行时版本清单
│   └── release.json           # 当前版本号
├── doc/                       # 开发文档
│   └── plugin-system.md       # 插件系统开发文档
└── requirements.txt           # Python 依赖（13 个包）
```

---

## 数据模型

系统共包含 11 个 Django 模型，覆盖班级管理、排座、AI 全链路：

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| `Classroom` | 班级/教室 | 名称、行列数、左右护法 |
| `Student` | 学生 | 姓名、学号、性别、成绩 |
| `Seat` | 座位 | 行列坐标、单元类型（座位/走廊/讲台/空位）、入座学生、所属小组 |
| `SeatGroup` | 小组 | 名称、组长、排序 |
| `SeatConstraint` | 排座约束 | 8 种约束类型、启用/禁用、距离参数 |
| `LayoutSnapshot` | 布局快照 | JSON 格式布局数据 |
| `FutureModeConfig` | AI 模式配置 | API Key、Base URL、Model、思考模式 |
| `AIConversation` | AI 对话 | 会话归属、标题、推理模式、响应 ID |
| `AIConversationMessage` | AI 消息 | 角色（user/assistant/system/tool）、正文、扩展载荷 |
| `ClassroomHistoryEntry` | 操作历史 | 动作类型、载荷、是否已应用（撤销/重做） |
| `FrontendKVStore` | 前端键值存储 | 键值对（主题、偏好、新手引导已读标记等） |
| `OnboardingState` | 新手引导状态 | 会话 key、是否已看过、已完成步骤 |

---

## 快速开始

### 环境要求
- Python 3.10+
- pip

### 安装依赖
```bash
pip install -r requirements.txt
```

依赖清单（13 个包）：Django, certifi, pandas, openai, openpyxl, python-pptx, xlrd, waitress, whitenoise, tzdata, pytz, pypinyin, pywebview

### 初始化数据库
```bash
python manage.py migrate
```

### 生产模式启动
```bash
python run_app.py
```
启动本地 Waitress 服务（端口 23948），自动执行数据库迁移，然后打开原生桌面窗口。Windows 下会自动申请管理员权限。

### 开发模式启动
```bash
python run_app.py -dev
```
保留浏览器访问（http://127.0.0.1:23948），不打开桌面壳，便于调试前端与网络请求。

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `FUCKSEATS_APP_SHELL` | 运行模式（`browser` / `webview`） | 由启动参数自动设置 |
| `OPENAI_API_KEY` | OpenAI API 密钥 | 空 |
| `OPENAI_BASE_URL` | OpenAI API 地址 | 空（使用官方地址） |
| `OPENAI_MODEL` | AI 模型 ID | `gpt-4.1-mini` |
| `PLUGIN_DIRS` | 额外插件目录（逗号分隔） | 空 |

---

## AI 赋能模式

AI 赋能模式（闻道工作台）基于 OpenAI API 的 function calling 能力，让班主任可以用自然语言操控座位表。

### 支持的工具调用
- 交换两个学生的座位
- 查询学生信息（姓名、学号、成绩、座位位置）
- 统计小组评分
- 发送结构化图卡
- 学生列表查询（支持排序、分页、筛选）

### 配置方式

**方式一：环境变量**
```bash
export OPENAI_API_KEY="你的 API Key"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_MODEL="gpt-4.1-mini"
```

**方式二：前端配置**
进入班级详情页顶部 AI 选项卡，打开闻道赋能工作台，右侧可直接填写 API Key、Base URL、Model ID，保存后写入数据库（`FutureModeConfig` 模型）并同步到 localStorage。

### API 兼容性
- 未填写时自动回退到服务端环境变量
- 官方 OpenAI 地址走 Responses API
- 非官方 Compatible 地址自动切换 Chat Completions Tool Calling
- 支持思考模式配置

### 安全机制
- 工具调用前需用户授权确认
- 多轮对话支持、对话隔离
- 消息持久化到数据库

---

## 插件开发

插件系统支持以最小侵入方式扩展核心业务，无需修改主代码。

### 插件形式
- 单文件插件：`plugins/xxx.py`
- 包插件：`plugins/xxx/plugin.py` 或 `plugins/xxx/__init__.py`

### 最小示例

在 `plugins/` 目录下创建 `.py` 文件，定义 `PLUGIN_META` 和 `register(registry)` 函数：

```python
PLUGIN_META = {
    'id': 'my_plugin',
    'name': '我的插件',
    'version': '1.0.0',
    'description': '插件描述',
    'author': '作者',
    'website': 'https://example.com',
}

def register(registry):
    registry.register_hook('classroom_created', on_created)
    registry.register_action('my_action', handler, methods=('POST',))
    registry.register_ui_script('dashboard', UI_SCRIPT)
    registry.register_workspace_script('inject', JS_CODE, auto_run=True)
```

### 四种注册类型

| 类型 | API | 说明 |
|------|-----|------|
| Hook | `register_hook(event, handler)` | 事件钩子，监听系统动作（如 `classroom_created`） |
| Action | `register_action(action, handler, methods)` | HTTP 动作端点，可被外部调用 |
| UI Script | `register_ui_script(ui_name, script)` | 脚本式 UI，Python 代码生成组件树（无需前端框架） |
| Workspace Script | `register_workspace_script(name, script, auto_run)` | 工作区注入脚本，直接改造前端页面 |

### UI 组件库
插件 UI 采用组件化渲染，内置组件：metric、table、list、progress、badge、text、divider 等。

### 扩展系统
支持类 Chrome 扩展模式：manifest 声明、权限管理、`runtime.sendMessage` 通信。

详细文档参见 `doc/plugin-system.md`。

### 内置插件
- `example_plugin.py` - 全组件演示插件
- `student_search_plugin.py` - 学生搜索插件（浮层搜索 + 座位高亮，快捷键 `Ctrl+Shift+F`）

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Z` | 撤销 |
| `Ctrl+Y` | 重做 |
| `Ctrl+C` | 复制当前学生 |
| `Ctrl+X` | 剪切当前学生 |
| `Ctrl+V` | 粘贴到当前座位 |
| `Delete` | 清空当前座位 |
| `Ctrl+D` | 移动到未入座区 |
| `Ctrl+U` | 从未入座区填入当前座位 |
| `Ctrl+Shift+F` | 聚焦搜索框（需启用搜索插件） |

---

## 测试

```bash
python manage.py test
```

---

## 许可证

本程序使用 GPL-3.0 license，附以下例外：
1. 现有大型商业项目且与作者洽谈后经本人允许，可以不开源
2. 对开源流程不熟悉，仅对 vibe coding 有一定了解，且非商业项目，无任何资助/捐款渠道且软件分发范围在 50 人以下的个人开发者，可以暂时在标明原作者的情况下不开源
3. 经特殊许可的，可以不开源
