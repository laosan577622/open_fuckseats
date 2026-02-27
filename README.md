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

## 开发者
- 名称：老三
- 网站：www.577622.xyz
