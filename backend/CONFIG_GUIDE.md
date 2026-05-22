# FuckSeats 云端配置文件指南

云端服务通过 `cloud_config.yaml` 进行配置。该文件位于 `backend/` 目录下，首次部署时请复制示例文件并按需修改：

```bash
cp cloud_config.example.yaml cloud_config.yaml
```

也可通过环境变量 `CLOUD_CONFIG_PATH` 指定配置文件路径。

---

## 配置结构总览

```yaml
server:        # 服务器基础设置
metadata:      # 开发者信息
database:      # 数据库配置
laosan_oauth:  # OAuth 认证配置
subscription:  # 订阅计划与权限配置
rate_limit:    # 速率限制
data_limits:   # 数据传输限制
data_sharing:  # 帮助改进数据接收
```

---

## server - 服务器设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `base_url` | string | `http://127.0.0.1:8000` | 服务器对外访问地址，用于 OAuth 回调等场景 |
| `host` | string | `0.0.0.0` | 监听地址 |
| `port` | int | `8000` | 监听端口 |
| `secret_key` | string | - | Django SECRET_KEY，**生产环境必须修改** |
| `debug` | bool | `false` | 调试模式，生产环境务必设为 `false` |
| `allowed_hosts` | list | `["*"]` | Django ALLOWED_HOSTS |
| `timezone` | string | `Asia/Shanghai` | 时区 |

环境变量覆盖：
- `CLOUD_BASE_URL` -> `server.base_url`
- `CLOUD_SECRET_KEY` -> `server.secret_key`
- `CLOUD_DEBUG` -> `server.debug`
- `PORT` -> `server.port`

---

## metadata - 开发者信息

| 字段 | 类型 | 说明 |
|------|------|------|
| `developer_name` | string | 开发者名称，显示在前端页面 |
| `developer_website` | string | 开发者网站地址 |

---

## database - 数据库

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | string | `cloud.sqlite3` | SQLite 数据库文件路径，相对于 `backend/` 目录 |

环境变量覆盖：`CLOUD_SQLITE_PATH`

---

## laosan_oauth - OAuth 认证

用于接入老三账户系统的 OAuth 2.0 配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| `client_id` | string | OAuth 应用 Client ID |
| `client_secret` | string | OAuth 应用 Client Secret |
| `authorize_url` | string | 授权页面地址 |
| `token_url` | string | Token 交换地址 |
| `userinfo_url` | string | 用户信息接口地址 |
| `scope` | string | 请求的权限范围，空格分隔 |

环境变量覆盖：
- `LAOSAN_OAUTH_CLIENT_ID` -> `laosan_oauth.client_id`
- `LAOSAN_OAUTH_CLIENT_SECRET` -> `laosan_oauth.client_secret`

---

## subscription - 订阅计划配置

这是最核心的配置部分，定义了所有订阅等级及其权限。客户端会自动从服务端读取此配置并展示在设置页面。

### 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `fallback_tier` | string | 默认/回退等级，通常为 `free` |
| `purchase_url` | string | 全局购买链接（当某等级未单独配置时使用） |
| `tiers` | object | 各订阅等级的详细配置 |
| `priority` | list | 等级优先级，从高到低排列，用于匹配用户最高等级 |

### tiers - 等级配置

每个等级（如 `free`、`pro`、`pro_max`）支持以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `display_name` | string | 是 | 前端显示名称 |
| `description` | string | 否 | 等级描述，显示在订阅卡片上 |
| `price` | string | 否 | 价格文本，如 `免费`、`¥29/月` |
| `purchase_url` | string | 否 | 该等级的专属购买链接 |
| `service_identifier` | string | 否 | 对应老三账户系统中的服务标识符，用于自动匹配订阅 |
| `limits` | object | 是 | 功能权限限制 |

### limits - 权限限制

| 字段 | 类型 | 说明 |
|------|------|------|
| `max_classrooms` | int | 最大班级数量，`-1` 表示无限 |
| `sync_enabled` | bool | 是否启用云同步 |
| `max_history_steps` | int | 历史记录步数上限，`0` 表示不支持 |
| `sync_ai_conversations` | bool | 是否同步 AI 对话记录 |
| `max_snapshots_per_classroom` | int | 每个班级的最大快照数 |

你可以自由添加新的 limits 字段，前端会自动读取并展示。

---

## rate_limit - 速率限制

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `sync_per_minute` | int | `30` | 每分钟同步请求上限 |
| `auth_per_minute_per_ip` | int | `10` | 每 IP 每分钟认证请求上限 |
| `snapshot_per_hour` | int | `20` | 每小时快照操作上限 |

---

## data_limits - 数据限制

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `max_push_size_mb` | int | `5` | 单次推送最大数据量 (MB) |
| `max_batch_push_size_mb` | int | `20` | 批量推送最大数据量 (MB) |
| `session_token_ttl_days` | int | `7` | 会话 Token 有效期 (天) |
| `session_code_ttl_seconds` | int | `60` | 会话交换码有效期 (秒) |

---

## 环境变量汇总

| 环境变量 | 对应配置 |
|----------|----------|
| `CLOUD_CONFIG_PATH` | 配置文件路径 |
| `CLOUD_BASE_URL` | `server.base_url` |
| `CLOUD_SECRET_KEY` | `server.secret_key` |
| `CLOUD_DEBUG` | `server.debug` |
| `PORT` | `server.port` |
| `CLOUD_SQLITE_PATH` | `database.name` |
| `LAOSAN_OAUTH_CLIENT_ID` | `laosan_oauth.client_id` |
| `LAOSAN_OAUTH_CLIENT_SECRET` | `laosan_oauth.client_secret` |
| `CLOUD_REQUIRE_YAML` | 设为 `1` 时，缺少 PyYAML 会报错而非静默跳过 |
| `FUCKSEATS_IMPROVE_ENABLED` | `data_sharing.enabled` |
| `FUCKSEATS_IMPROVE_DB_PATH` | `data_sharing.database` |

---

## 完整示例

参见同目录下的 `cloud_config.example.yaml`。
