# 不想排座位 · FuckSeats

给班主任和教务人员用的排座工具。把现有名单导进来，按教室布局和学生情况排座，调整好后导出座次表；考试前还能规划桌子的搬运路线，考后再恢复日常布局。

日常排座不需要登录，数据保存在本机。需要在多台电脑之间接着用时，可以连接云同步。

[项目主页](https://fuckseats.577622.xyz/) · [项目仓库](https://github.com/laosan577622/open_fuckseats) · [开发者：老三](https://www.577622.xyz/)

## 可以做什么

- **直接用现有名单。** 导入 Excel 后选择工作表、数据范围和姓名、学号、成绩等字段，也能保留自定义信息。已有座位表可以按布局导入，另支持 BSCE 和本项目的 `.seats` 文件。
- **临时调座不用重新排一遍。** 拖拽即可换位，也可以双击座位，输入姓名、拼音首字母或学号找人。教室里的走廊、讲台和空位都能编辑，布局支持平移、镜像与行列增删。
- **把排座要求一起考虑进去。** 支持固定座位、指定或避开某个区域、两人相邻或不相邻等规则。自动排座有随机、成绩升降序、优生靠前或靠后、成绩分散、小组均衡和小组导师等策略；遇到无法满足的约束会提示，排座失败会回滚。
- **多个班一起管理。** 班级组支持批量建班、导入名单和跨班分配，可以选择优先留在原班，或尽量打散原班。班内还能设置学习小组、组长，进行小组轮换。
- **按自己的字段排序。** 姓名、学号、成绩和自定义信息都能作为排序依据，支持多字段规则、拼音和自然数字排序；也能通过接口保存 Python 排序策略。
- **排好的结果能导出，也能留底。** 座次表可导出为 Excel、SVG、PPTX，另有小组登记表和 CSIS 导出。调整过程中可以撤销、重做；满意的方案保存成快照，换电脑或留备份则导出 `.seats`。

第一次使用，可以先建一个班级，导入名单后试试手动换位，再设置约束和自动排座。应用内有操作引导和导入练习，使用模拟数据，不会改动真实班级。

## 考场排座

考场模式除了生成单人单列的桌位图，还会安排哪些桌子保留、哪些搬出、哪些需要补进来，并演示搬运顺序。规划时优先减少需要单独搬运的桌子：能保留的原列整体平移，其余桌子再逐张调整。

原布局中的空桌和无人入座的座位按走廊处理，不计入桌数，也不参与搬运或阻挡路线；考后恢复仍保留原布局中的空位设置。

1. 在教室图上设置门的位置，从工具栏进入「考场模式」。
2. 输入考生人数选择推荐布局，或自行设置组数和每组排数。页面会试算搬运数量，并对比调整前后的桌位。
3. 生成方案，查看搬运动画和逐桌清单。支持暂停、逐步播放和单独查看某张桌子的路线。
4. 按组、按排或 S 型编桌号，可调整方向和起点。确认后应用，并打印桌号标签、桌位图或搬运清单。
5. 考试结束后生成搬回路线，恢复原来的桌位和学生安排。

生成方案时会保存原布局。若之后又改动了教室，应用旧方案前会要求重新核对或生成，避免覆盖中途的调整。

搬运动画使用示意网格，节拍不是实际秒数，也没有测量教室和桌椅尺寸，现场仍需确认通道和间距。规划不保证全局最优；来源和目标各最多支持 1600 张桌子，目标行列各不超过 128。

## 从源码运行

桌面端使用 **Django + JavaScript + pywebview**，本地服务由 Waitress 提供。首页新建菜单使用独立的 React 组件，仓库已包含构建后的静态资源，运行应用不需要安装 Node.js 或构建前端。

修改新建菜单时，在 `frontend` 目录执行 `npm ci`、`npm run check` 和 `npm run build`，将更新后的 `static/js/create-menu.js` 一并提交。组件改编自 [Bencho Create menu](https://bencho.dev/licence)，源码保留原有几何与动效注释，构建产物包含其 MIT 版权声明和依赖许可。

建议使用 Python 3.12 或更高版本。除了 [Python 依赖](requirements.txt)，还需要 SQLCipher 系统库和可用的系统钥匙串；桌面窗口需要对应平台的 WebView。

下载源码后，在项目根目录执行：

macOS / Linux：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python run_app.py -dev
```

Windows PowerShell：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python run_app.py -dev
```

启动时会先显示「启动中，请稍后」提示框，初始化完成后自动关闭。提示框使用 Tk，源码环境需要 Python 的 Tk 支持；macOS 需要 Tk 8.6 或更新版本。Homebrew Python 可安装版本对应的 `python-tk`，例如 Python 3.14 使用 `brew install python-tk@3.14`。启动后会打开浏览器，地址是 [http://127.0.0.1:23948](http://127.0.0.1:23948)。首次启动会自动准备数据库并执行迁移。

需要桌面窗口时，去掉 `-dev`：

```bash
python run_app.py
```

Windows 桌面模式会申请管理员权限，并需要 Microsoft Edge WebView2 Runtime。两种模式都使用 Waitress；`-dev` 方便在浏览器里调试，但没有自动重载，修改 Python 代码后需要重启。

重复启动会提示「已有实例，请使用已打开的不想排座位」，随后退出新启动的进程，不会重复初始化数据库。

## 数据和备份

源码运行默认把数据库放在项目根目录的 `db.sqlite3`。数据库使用 SQLCipher 加密，密钥默认保存在系统钥匙串中。

备份班级时，直接在应用里导出 `.seats`；恢复时会替换目标班级的数据，建议先为当前班级留一份副本。只复制加密数据库到另一台电脑还不够，读取它也需要对应密钥。主动导出的 Excel、`.seats` 等文件不受数据库加密保护。

需要调整数据位置时，可在启动前设置：

| 环境变量 | 用途 |
| --- | --- |
| `FUCKSEATS_DATA_DIR` | 指定数据根目录，数据库放在其 `data/` 子目录 |
| `FUCKSEATS_USE_USER_DATA=1` | 改用系统用户数据目录 |
| `FUCKSEATS_DATABASE_PATH` | 直接指定数据库文件路径 |
| `FUCKSEATS_DATABASE_KEY` | 源码运行时自行提供数据库密钥 |

路径选择见 [app_paths.py](app_paths.py)。使用自行提供的密钥时，后续启动和迁移也要使用同一密钥。

## 云同步与闻道智能

### 云同步

在设置中登录老三账户，可以同步班级、班级组和云端快照。首次同步上传完整数据，后续优先传输变化部分；服务不支持增量时会回退到完整快照。

两台电脑都改过同一班级时，应用会保留两端数据并提示冲突，由你选择要保留的版本。处理前先导出本地 `.seats`，强制上传或从云端恢复会覆盖对应目标。

也可以连接兼容本应用协议的自建云服务，地址在设置中修改。切换服务会退出原云账户并重置同步状态，本地班级仍然保留。远程服务使用 HTTPS，本机调试允许 HTTP。

仓库中的 [backend/](backend/) 是独立的云同步后端。安装它的 [依赖](backend/requirements.txt)，将 [配置示例](backend/cloud_config.example.yaml) 另存为 `backend/cloud_config.yaml`，填写服务器地址、密钥和自己的老三账户 OAuth 应用，再在 `backend` 目录运行 `python run.py`。详细配置见 [CONFIG_GUIDE.md](backend/CONFIG_GUIDE.md)。

### 闻道智能

在「设置 → 闻道智能」完成登录授权后，可以在班级页面用自然语言提出排座要求。对话中会列出工具调用请求，由你允许或拒绝；获准读取的班级数据会发送给闻道服务。

「AI 加密脱敏」默认开启：发给模型的用户消息、历史对话和工具结果中，名单内的学生姓名会替换为随机名称。模型使用随机名称回复和调用工具，本机在执行工具与显示对话时自动还原真名。名称映射保存在本机，不发送给模型。可在「设置 → 闻道智能」关闭此能力；关闭后，后续模型请求会发送真名，已有回复仍能正常显示。

闻道连接与云同步分开设置，自建云服务不会改变闻道的服务地址。不使用闻道也能正常手动排座、使用内置策略和查看本地规则生成的排座建议。

## 接入其他工具

本地 HTTP Open API 和 MCP 可以让脚本或 AI 客户端查询班级、管理学生、调整座位、应用排序策略。

### Windows 第三方只读授权

第三方程序可以通过启动参数申请读取权限，无需配置完整 Open API 密钥。程序先生成一个随机凭证，再从应用目录启动：

```powershell
$token = 'fks-read-' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
Start-Process -FilePath '.\FuckSeats.exe' -ArgumentList @(
    '--request-read-access', '--client-name', '点名程序', '--access-token', $token
)
```

源码运行时，将启动命令改为 `python run_app.py --request-read-access --client-name "点名程序" --access-token $token`；可以同时加上 `-dev`。程序名称包含空格时，调用方需将名称作为一个完整参数传入。凭证必须以 `fks-read-` 开头，后接 32–128 个随机字母、数字、下划线或短横线。

应用会弹窗显示申请程序名称与读取范围，用户选择允许后才开放读取；默认选项为拒绝。读取范围包含所有班级、座位排列、名单、学号、成绩、自定义信息、小组、约束、标签、快照和历史记录。若应用已经打开，授权申请会交给已有实例处理。

应用启动后，第三方使用同一个凭证查询授权状态：

```powershell
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Uri 'http://127.0.0.1:23948/open_api/access/status' -Headers $headers
```

| HTTP 状态 | `authorization` | 处理方式 |
| --- | --- | --- |
| `202` | `pending` | 等待用户选择，稍后再次查询 |
| `200` | `granted` | 可以开始读取 |
| `403` | `denied` | 用户拒绝，停止调用 |
| `401` | — | 凭证无效或应用重启后授权失效，重新发起授权 |

本地服务启动前可能暂时无法连接，此时稍后重试。获准后可读取以下接口，均使用相同的 Bearer 凭证：

- `GET /open_api/classrooms`：班级列表。
- `GET /open_api/classrooms/<id>`：班级详情。
- `GET /open_api/classrooms/<id>/seats`：具体座位排列。
- `GET /open_api/classrooms/<id>/students`：班级名单与学生资料。
- `GET /open_api`、`GET /open_api/openapi.json`：当前凭证可用的读取工具与接口定义。

该凭证只在本次应用运行期间有效，关闭应用后自动失效。工具调用也受只读限制，修改、删除、排座和批量写入会返回 `403 READ_ONLY_ACCESS`。原有完整 Open API 密钥与 MCP 的使用方式见下文。

### HTTP Open API

在已激活虚拟环境的终端设置密钥，再启动应用。以下以 macOS / Linux 为例：

```bash
export FUCKSEATS_OPEN_API_KEY='替换为你自己的随机密钥'
python run_app.py -dev
```

在另一个终端使用相同密钥查询：

```bash
curl -H 'Authorization: Bearer 替换为你自己的随机密钥' \
  http://127.0.0.1:23948/open_api
```

`GET /open_api` 返回工具列表，`GET /open_api/openapi.json` 返回接口定义。单个工具通过 `POST /open_api/tools/execute` 调用，批量操作使用 `POST /open_api/tools/batch`。命令行请求使用 Bearer Key；浏览器来源的放行规则见 [auth.py](seats/open_api/auth.py)。

### MCP

源码环境提供 stdio MCP：

```bash
python manage.py open_api_mcp
```

客户端配置示例，将路径替换成自己的项目位置：

```json
{
  "mcpServers": {
    "fuckseats": {
      "command": "/absolute/path/to/fuckseats/.venv/bin/python",
      "args": ["/absolute/path/to/fuckseats/manage.py", "open_api_mcp"]
    }
  }
}
```

Windows 的 `command` 改为虚拟环境里的 `Scripts\python.exe` 路径。MCP 直接访问本地数据库，不需要 HTTP 密钥；应与应用使用同一数据目录和数据库密钥。写入工具会直接修改数据，没有桌面确认弹窗。

本地插件可以扩展命令、菜单和工作区。现成示例在 [plugins/](plugins/)，也可以运行 `python manage.py plugin scaffold my_plugin` 创建插件骨架。

## 遇到问题

- **安装 `sqlcipher3` 失败：** 检查 SQLCipher 开发库、编译工具和 Python 架构是否匹配。它包含本地编译依赖，仅安装普通 SQLite 不够。
- **桌面窗口打不开或空白：** 先用 `-dev` 查看浏览器能否正常访问；Windows 检查 WebView2 Runtime。
- **提示应用已在运行：** 使用已打开的实例。若端口 `23948` 被其他程序占用，先关闭占用该端口的程序再启动。
- **数据库无法打开：** 核对数据目录和系统钥匙串；若设置过 `FUCKSEATS_DATABASE_KEY`，确认密钥没有改变。保留原数据库再排查。

反馈问题时，请附上操作系统、Python 版本、启动命令和报错内容。复现导入或排座问题时，可以提供去掉真实姓名等信息后的最小样例。

## 许可证

使用与分发条件见 [LICENSE](LICENSE)。
