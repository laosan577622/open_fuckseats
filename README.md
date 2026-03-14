# 不想排座位

不想排座位是一个基于 Django 的教室排座系统，覆盖班级管理、名单导入、布局编辑、自动排座、约束规则、小组管理和多格式导出。

## 核心能力
- 班级管理：新建、重命名、删除班级。
- 教室布局：编辑行列网格，支持座位、走廊、讲台、空位类型。
- 学生入座：拖拽、单人移动、批量移动、批量框选、多选操作。
- 自动排座：`random`、`score_desc`、`score_asc`、`good_front`、`good_back`、`score_spread`、`group_balanced`、`group_mentor`。
- 约束系统：指定/禁用座位、指定/禁用行列、指定相邻、禁止相邻。
- 小组系统：创建、重命名、删除、批量分配、自动编组、合并组、轮换组、组长设置。
- 数据导入：学生 Excel 导入（自动识别或手动列映射）、座位表 Excel 导入（含预览、翻转/旋转、词典识别）。
  - 导入 Excel 成绩 / 导入座位表均采用独立配置页面，左侧设置、右侧预览；成功或取消后自动返回班级页。
- 数据导出：座次 Excel、座次 SVG（可配置主题与显示内容，用于 PPT）、座次 PPTX（单页 16:9 横屏）、小组登记表 Excel、`.seats` 快照文件。
  - 导出 Excel / SVG / PPTX 时采用独立配置页面（非弹窗），左侧设置、右侧预览；确认导出或取消后自动返回班级页。
- 历史操作：撤销/重做。
- AI 赋能模式：顶部 `AI` 选项卡可打开闻道赋能页面，支持通过 OpenAI API + function calling 执行交换座位、查询学生信息、统计小组评分。
  - 支持多轮对话、对话隔离（同班级可创建多个独立会话）与对话消息持久化入库（SQLite）。
  - 新增学生工具：`get_student_list`（可选排序、排序方向、字段裁剪、分页、筛选器）。
  - 新增卡片工具：`send_card_info`（部分座位图、学生详情图、整体座位图、班级报告图）。
  - 支持 OpenAI Compatible：当 `Base URL` 不是 `api.openai.com` 时，自动切换到兼容的 `chat.completions + tools` 调用链。

## 技术栈
- 后端：Django 6.0.1
- 数据库：SQLite3
- 生产服务：Waitress
- 静态文件：WhiteNoise
- 数据处理：pandas、openpyxl、python-pptx、xlrd
- 前端：Django Template + 原生 JavaScript
- 宣传站：React 19 + Vite 7（`website/`）

## 项目结构
- `manage.py`：Django 管理入口
- `run_app.py`：生产启动脚本（自动迁移 + Waitress，端口 `23948`）
- `config/`：Django 配置（settings/urls/wsgi/asgi）
- `seats/`：业务模型、视图、路由、测试与迁移
- `templates/`：页面模板
- `static/`：CSS 与前端交互脚本
- `website/`：独立 React 宣传站
- `package.py`：PyInstaller 打包脚本


## 快速开始

1. 安装 Python 依赖
```bash
pip install -r requirements.txt
```

2. 初始化数据库
```bash
python manage.py migrate
```

3. 生产模式启动（推荐）
```bash
python run_app.py
```
默认地址：`http://127.0.0.1:23948`

4. 开发模式启动
```bash
python manage.py runserver 127.0.0.1:8000
```

## OpenAI AI 未来模式配置
- 服务端环境变量：
```bash
export OPENAI_API_KEY="你的 OpenAI API Key"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_MODEL="gpt-4.1-mini"
```
- 浏览器前端配置：进入班级详情页顶部 `AI` 选项卡，点击 `使用未来模式（Beta)` 打开独立工作台；右侧可直接填写 `API Key`、`Base URL`、`Model ID`，保存后会写入数据库并同步到当前浏览器 `localStorage`。
- 授权机制：AI 每次准备调用 tool（读取班级数据、学生信息、学生列表、小组评分、卡片发送、交换座位、班级动作）前，都会先请求用户授权；只有点允许后才会真正执行。
- 留空策略：如果前端未填写配置，系统会自动回退到服务端环境变量。
- 兼容策略：官方 OpenAI 地址默认走 Responses API；非官方 Compatible 地址默认走 Chat Completions Tool Calling。
- 主要能力：交换两名已入座学生的座位、获取学生座位/分数/小组信息、按条件读取学生列表、统计小组评分排行、发送结构化图卡。

## 前端宣传站（可选）
``` bash
cd website
```

2. 安装依赖并启动
```bash
npm install
npm run dev
```

## 常用导入导出说明
- 学生 Excel 导入：需包含“姓名”列；“总分/学生总分”可自动识别，否则进入手动映射；支持“匹配现有学生更新成绩（未匹配自动新增）”与“清空后全量导入”两种模式。
- 座位表 Excel 导入：支持自动识别合并单元格、讲台/走廊/空位/姓名，并支持手工词典覆盖。
- `.seats` 导入：会覆盖当前班级的学生、座位、小组和约束。
- 导出支持：`xlsx`、`svg`、`pptx`、`.seats`。

## 快捷键
- `Ctrl+Z`：撤销
- `Ctrl+Y`：重做
- `Ctrl+C`：复制当前学生
- `Ctrl+X`：剪切当前学生
- `Ctrl+V`：粘贴到当前座位
- `Delete`：清空当前座位
- `Ctrl+D`：移动到未入座区
- `Ctrl+U`：从未入座区填入当前座位

## 测试
```bash
python manage.py test
```

## 打包（Windows）
```bash
python package.py
```
- 打包脚本已包含 OpenAI Future Mode 依赖收集，支持 `openai/httpx/pydantic` 等运行时模块。
- 打包后的程序可继续读取 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 环境变量；若未配置，也可以在 Future Mode 页面右侧直接填写连接参数并保存到数据库。

## 开发者
- 名称：老三
- 网站：www.577622.xyz
