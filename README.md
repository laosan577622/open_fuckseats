# 不想排座位

> 让排座位这件事，不再是一件事。

一个面向班主任和教务人员的智能教室排座系统。覆盖班级组管理、名单导入、布局编辑、自动排座、约束规则、小组管理、自定义排序和多格式导出等完整工作流。桌面版通过 pywebview 提供原生窗口体验，开发模式下也可直接使用浏览器访问。

项目总代码量约 48000 行，核心业务逻辑 13000+ 行，前端交互 4500+ 行。

---

## 特性一览

- 8 种自动排座算法，覆盖随机、成绩、小组等多种策略
- 8 种约束类型，支持指定/禁用座位、行、列、相邻关系
- 班级组批量创建、批量导入、原子云备份与订阅配额校验
- 按姓名、学号、成绩和自定义信息进行自然数字、拼音及升降序排序
- 多格式导出：Excel、SVG、PPTX、`.seats` 快照
- 插件系统：Hook + Action + UI Script + Workspace Script 四种扩展方式
- 桌面端原生体验：pywebview + EdgeChromium，支持 Windows 在线更新与 macOS 本地 PKG 保数据升级
- 完整撤销/重做历史、Spotlight 命令面板、3D Toast 通知

---

## 核心能力

### 班级与布局
- 新建、重命名、删除班级及班级组
- 快速生成仅用于地点分区的大组、组间走廊和自动居中的独立讲台行，不自动建立学生小组
- 批量创建班级并复用现有班级的布局与小组分配
- 编辑行列网格，支持座位、走廊、讲台、空位四种单元类型
- 行列插入/删除、布局整体平移、镜像翻转
- 布局快照保存与加载，支持 `.seats` 文件导入导出

### 学生管理
- 手动添加单个学生（姓名、学号、性别、成绩、自定义信息）
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

### 自定义排序
- 班级页保留原有 8 种自动排座算法
- 自定义策略设置使用独立页面，不与原有算法控件混排
- 支持自然数字、文本、拼音、首字母、纯数字转换
- Open API Agent 可创建、预览、保存和应用声明式多字段排序策略

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
- Windows 更新：检测新版本 -> 下载安装包 -> 系统安装器覆盖升级
- macOS 更新：用户自行准备官方 `.pkg` -> 应用本地验签和备份 -> 系统安装器覆盖升级；应用不会联网下载安装包
- 用户数据库、插件和设置位于系统用户数据目录，替换应用本体不会覆盖数据
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
| 数据库 | SQLCipher（SQLite 兼容，AES-256 整库加密） |
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
├── app_paths.py               # 系统用户数据目录与只读资源目录
├── database_security.py       # Keychain/Credential Locker 密钥、明文库迁移与备份
├── desktop_shell.py           # 桌面桥接层（原生对话框、文件导入导出、Windows 右键菜单）
├── desktop_runtime.py         # 桌面运行时（版本管理、自动更新、Windows 提权）
├── package.py                 # PyInstaller 打包脚本（清理数据库、环境变量脱敏）
├── config/                    # Django 配置
│   ├── settings.py            # 全局设置（SQLCipher、插件目录、OpenAI 配置）
│   ├── sqlcipher_backend/     # Django 6 SQLCipher 数据库适配层
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
│       ├── layout_editor.html # 布局编辑器
│       ├── settings.html      # 全局设置页
│       ├── extensions_overview.html  # 扩展管理页
│       ├── export_*.html      # 导出配置页（Excel/SVG/PPTX）
│       └── import_*.html      # 导入配置页（学生/布局）
├── static/
│   ├── css/                   # 样式文件
│   │   ├── styles.css         # 主样式（3800+ 行）
│   │   └── plugin_ui.css      # 插件 UI 样式
│   ├── js/                    # 前端脚本
│   │   ├── classroom.js       # 班级详情页核心交互（4500+ 行）
│   │   ├── desktop_bridge.js  # 桌面端导出桥接
│   │   ├── layout_editor.js   # 布局编辑器
│   │   ├── toast.js           # 3D Toast 通知系统
│   │   ├── theme.js           # 主题管理
│   │   ├── effects.js         # 视觉特效
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
└── requirements.txt           # Python 依赖
```

---

## 数据模型

系统共包含 21 个 Django 模型，覆盖班级组、排座、云同步和保留的内部数据结构：

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| `ClassroomGroup` | 班级组 | 名称、UUID、排序、组内班级 |
| `ClassroomGroupStudent` | 班级组待分配学生 | 未选择班级时保存姓名、学号、成绩和自定义信息 |
| `Classroom` | 班级/教室 | 名称、行列数、左右护法 |
| `Student` | 学生 | 姓名、学号、性别、成绩、自定义信息 |
| `SortStrategy` | 自定义排序 | 班级或班级组范围、声明式排序规则 |
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

数据库加密依赖 `sqlcipher3`，桌面密钥通过 `keyring` 写入 macOS Keychain 或 Windows Credential Locker。

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

### Agent Skill 安装

项目随仓库和正式安装包分发 `fuckseats-agent-operator` skill，用于指导 Codex/Agents 启动项目、接入 `/open_api`、配置 MCP、处理 Windows 闭源安装版和打包发布坑点。

源码用户：
```bash
python skill/install_fuckseats_skill.py
```

Windows 直接安装版用户：
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\LaosanApps\fuckseats\skill\install_fuckseats_skill.ps1"
```

安装脚本会写入 `~/.codex/skills/fuckseats-agent-operator` 和 `~/.agents/skills/fuckseats-agent-operator`，安装后重启对应 agent 应用。

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `FUCKSEATS_APP_SHELL` | 运行模式（`browser` / `webview`） | 由启动参数自动设置 |
| `FUCKSEATS_DATA_DIR` | 覆盖用户数据根目录，主要用于开发和测试 | 安装版使用系统规范目录 |
| `FUCKSEATS_DATABASE_PATH` | 覆盖桌面数据库路径 | 用户数据目录下 `data/db.sqlite3` |
| `FUCKSEATS_DATABASE_KEY` | 源码开发/CI 注入数据库密钥，正式桌面包不使用 | 系统钥匙串 |
| `OPENAI_API_KEY` | 原有 AI 赋能模式的兼容配置（页面入口保持关闭） | 空 |
| `OPENAI_BASE_URL` | 原有 AI 赋能模式的兼容配置（页面入口保持关闭） | 空 |
| `OPENAI_MODEL` | 原有 AI 赋能模式的兼容配置（页面入口保持关闭） | `gpt-4.1-mini` |
| `OPEN_API_AI_TOOLS_ENABLED` | 是否在 Open API/MCP 中发现 AI 类工具 | `True` |
| `PLUGIN_DIRS` | 额外插件目录（逗号分隔） | 空 |

### 数据库加密与数据目录

正式桌面版首次启动会生成随机 256 位数据库密钥，并写入当前系统用户的安全钥匙串。旧版明文 `db.sqlite3` 会在 Django 建立连接前转换成 SQLCipher 数据库，完成完整性检查后再原子切换；密钥缺失、错误或迁移失败时应用停止启动，不会创建一个看似正常的空库。

macOS 用户数据目录：

```text
~/Library/Application Support/xyz.577622.fuckseats/
```

Windows 用户数据目录：

```text
%LOCALAPPDATA%\FuckSeats\
```

`.seats` 便携文件默认不再导出 OpenAI API Key。Excel 等用户主动导出的文件仍属于明文文件，应由用户自行妥善保管。

云端服务可通过以下变量启用两套服务端 SQLite 加密：

```text
FUCKSEATS_CLOUD_DB_KEY
FUCKSEATS_IMPROVE_DB_KEY
FUCKSEATS_REQUIRE_SERVER_DB_ENCRYPTION=1
```

启用强制开关后，任一服务端密钥缺失都会阻止服务启动。

### macOS 本地保数据升级

macOS 不执行远程版本检查，也不会请求服务器下载升级包。进入“设置 -> 软件更新”，点击“选择升级包”，选择自行准备的官方 `Fuckseats_vX.Y.Z_macos.pkg`。应用会验证文件类型、版本、SHA-256、Bundle ID、Developer ID Installer 签名和 macOS 安全策略，随后备份加密数据库并打开系统安装器。

首次从旧版迁移时，PKG 的安装前脚本会先从旧 App Bundle 中抢救数据库到 Application Support；只有数据复制和完整性检查成功后才允许覆盖旧应用。

本地构建 macOS 首次安装 DMG 与升级 PKG：

```bash
python package_macos.py 2.3.0
```

输出：

```text
artifacts/macos/Fuckseats_v2.3.0_macos.dmg
artifacts/macos/Fuckseats_v2.3.0_macos.pkg
```

正式签名构建使用 `MACOS_APP_SIGNING_IDENTITY`、`MACOS_INSTALLER_SIGNING_IDENTITY`；设置 `MACOS_REQUIRE_SIGNING=1` 可在缺少签名时直接让构建失败。公证可以使用 `MACOS_NOTARY_PROFILE`，也可以配置 `MACOS_NOTARY_APPLE_ID`、`MACOS_NOTARY_PASSWORD`、`MACOS_NOTARY_TEAM_ID`，并通过 `MACOS_REQUIRE_NOTARIZATION=1` 强制执行。

GitHub Actions 的 macOS 发布任务默认强制签名与公证，需配置以下仓库 Secrets：

```text
MACOS_CERTIFICATE_P12_BASE64
MACOS_CERTIFICATE_PASSWORD
MACOS_APP_SIGNING_IDENTITY
MACOS_INSTALLER_SIGNING_IDENTITY
MACOS_NOTARY_APPLE_ID
MACOS_NOTARY_PASSWORD
MACOS_NOTARY_TEAM_ID
```

P12 中需要同时包含 `Developer ID Application` 和 `Developer ID Installer` 证书及私钥。Actions 会把 Team ID 写入应用内发布清单，运行时除系统验签外还会核对签名团队，任何证书、公证凭据或 Team ID 缺失都会中止发布。

---

## AI 功能状态

原有 AI 赋能工作台、聊天接口和状态接口由 `AI_FEATURE_ENABLED=False` 保持关闭，班级页不再加载 AI 选项卡、入口、浮层和对应前端资源；访问原有页面或状态接口会返回 404。

Open API/MCP 的 AI 类工具由 `OPEN_API_AI_TOOLS_ENABLED=True` 独立控制，默认开放 `ai_operation_begin`、`ai_operation_progress` 和 `ai_operation_end`，用于外部 AI 工具记录操作生命周期，不会重新启用原有 AI 前端。将该设置改为 `False` 可从 Open API 发现、MCP 列表和工具执行中隐藏这三个工具。

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
