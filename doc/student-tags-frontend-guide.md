# 学生标签系统前端接入指南

本文档面向前端接入学生标签系统。后端已支持自定义标签、批量打标、标签搜索、标签排座规则、自动排座校验、手动移动校验、撤销/重做、`.seats` 导入导出和云同步。

## 推荐数据入口

班级主界面优先读取完整状态：

```http
GET /classroom/{classroom_id}/state/
```

响应中与标签相关的字段：

```json
{
  "tags": [
    {
      "id": 1,
      "name": "近视",
      "color": "#0a59f7",
      "description": "需要靠前",
      "sort_order": 0,
      "member_count": 3,
      "rule_count": 1,
      "update_url": "/classroom/1/tags/1/update/",
      "delete_url": "/classroom/1/tags/1/delete/"
    }
  ],
  "tag_rules": [
    {
      "pk": 1,
      "rule_type": "must_area",
      "rule_type_display": "只能坐区域",
      "tag_id": 1,
      "tag_name": "近视",
      "tag_color": "#0a59f7",
      "row_min": 1,
      "row_max": 2,
      "col_min": null,
      "col_max": null,
      "distance": 1,
      "enabled": true,
      "priority": 0,
      "note": "近视学生安排前两排",
      "summary": "“近视”只能坐：1-2 行",
      "status": "ok",
      "issues": [],
      "issue_count": 0,
      "student_count": 3,
      "update_url": "/classroom/1/tag-rules/1/update/",
      "toggle_url": "/classroom/1/tag-rules/1/toggle/",
      "delete_url": "/classroom/1/tag-rules/1/delete/"
    }
  ],
  "tag_rule_types": [],
  "tag_rule_metrics": {},
  "seats": [
    {
      "student": {
        "id": 1,
        "name": "张三",
        "student_id": "2026001",
        "tags": []
      }
    }
  ],
  "unseated": [
    {
      "id": 2,
      "name": "李四",
      "student_id": "2026002",
      "tags": []
    }
  ]
}
```

前端渲染建议：

- `tags` 作为班级标签库，用于筛选器、打标面板、规则编辑器。
- `seat.student.tags` 和 `unseated[].tags` 直接渲染学生标签胶囊。
- `tag_rules` 渲染规则列表，`issues` 和 `status` 用于显示冲突或违反状态。
- 标签、打标、规则变更成功后统一重新请求 `state/`，让座位图、未入座列表、筛选器和规则面板保持一致。

## 标签 CRUD

获取标签库与规则：

```http
GET /classroom/{classroom_id}/tags/
```

创建标签：

```http
POST /classroom/{classroom_id}/tags/
Content-Type: application/json

{
  "name": "近视",
  "color": "#0a59f7",
  "description": "需要安排靠前",
  "sort_order": 10
}
```

更新标签：

```http
POST /classroom/{classroom_id}/tags/{tag_id}/update/
Content-Type: application/json

{
  "name": "班干部",
  "color": "#0a59f7",
  "description": "可作为小组骨干",
  "sort_order": 20
}
```

删除标签：

```http
POST /classroom/{classroom_id}/tags/{tag_id}/delete/
```

删除标签会自动删除对应学生标签关系和标签规则。

## 给学生打标签

批量打标入口：

```http
POST /classroom/{classroom_id}/tags/assign/
Content-Type: application/json

{
  "student_ids": [1, 2, 3],
  "tag_ids": [5],
  "mode": "add"
}
```

`mode` 可选：

| 值 | 说明 |
|----|------|
| `add` | 在原有标签基础上追加 |
| `remove` | 从学生身上移除指定标签 |
| `set` | 将学生标签替换为本次传入的标签集合 |
| `toggle` | 有则移除，无则添加 |

也可以传 `tag_names`，不存在的标签会自动创建：

```json
{
  "student_ids": [1],
  "tag_names": ["多动", "需关注"],
  "mode": "add"
}
```

新增或更新学生时可以直接带标签：

```http
POST /classroom/{classroom_id}/student/add/
Content-Type: application/json

{
  "name": "王五",
  "student_id": "2026001",
  "gender": "M",
  "score": 88,
  "tag_names": ["班干部"],
  "tag_mode": "set"
}
```

## 按标签搜索学生

原学生搜索接口已支持标签名：

```http
GET /classroom/{classroom_id}/search-students/?q=近视
```

标签专用搜索接口：

```http
GET /classroom/{classroom_id}/tags/search/?tag_ids=1,2&match=all&q=张
```

参数说明：

| 参数 | 说明 |
|------|------|
| `q` | 姓名、学号、拼音、拼音首字母或标签名 |
| `tag_ids` | 逗号分隔的标签 ID |
| `tag_names` | 逗号分隔的标签名 |
| `match` | `any` 任一命中，`all` 全部命中，`none` 排除这些标签 |
| `untagged` | `1` 时只返回无标签学生 |
| `limit` | 返回数量，最大 300 |

## 标签排座规则

创建规则：

```http
POST /classroom/{classroom_id}/tag-rules/create/
Content-Type: application/json

{
  "tag_id": 1,
  "rule_type": "must_area",
  "row_min": 1,
  "row_max": 2,
  "enabled": true,
  "note": "近视学生安排前两排"
}
```

规则类型：

| `rule_type` | 含义 | 关键字段 |
|-------------|------|----------|
| `must_area` | 带该标签的学生只能坐指定区域 | `row_min` / `row_max` / `col_min` / `col_max` |
| `forbid_area` | 带该标签的学生不能坐指定区域 | `row_min` / `row_max` / `col_min` / `col_max` |
| `separate_same_tag` | 同标签学生之间保持距离 | `distance` |

区域规则可只填行或只填列；同时填行列时表示一个矩形区域。距离使用曼哈顿距离，例如同排相邻距离为 1。

更新规则：

```http
POST /classroom/{classroom_id}/tag-rules/{rule_id}/update/
Content-Type: application/json

{
  "tag_id": 1,
  "rule_type": "forbid_area",
  "row_min": 6,
  "row_max": 6,
  "enabled": true
}
```

启用或停用规则：

```http
POST /classroom/{classroom_id}/tag-rules/{rule_id}/toggle/
Content-Type: application/json

{
  "enabled": false
}
```

删除规则：

```http
POST /classroom/{classroom_id}/tag-rules/{rule_id}/delete/
```

自动排座不需要额外传参，后端会自动读取已启用的标签规则：

```http
POST /classroom/{classroom_id}/arrange/
Content-Type: application/x-www-form-urlencoded

method=random
```

如果手动拖拽或批量移动违反标签规则，后端会返回 `400`：

```json
{
  "status": "error",
  "message": "移动失败：张三 带有“近视”标签，未坐在要求区域"
}
```

## 前端调用顺序建议

1. 页面初始化调用 `GET /classroom/{id}/state/`。
2. 打开标签管理面板时可调用 `GET /classroom/{id}/tags/` 获取最新标签和规则。
3. 创建、更新、删除标签或规则后，重新调用 `state/`。
4. 批量打标成功后，只局部更新返回的学生标签也可以；为了避免规则状态滞后，推荐仍刷新 `state/`。
5. 自动排座、手动移动、批量移动失败时直接展示后端 `message`。

