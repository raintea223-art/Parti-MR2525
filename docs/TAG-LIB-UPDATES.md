# 标签库 · 实施说明

> 实施日期：2026-05-31 — 2026-06-01  
> 状态：**已实施**  
> 前端版本：**UI 20260601c**（`public/index.html` · `app.js?v=20260601c`）

标签由固定常量列表（`constants.js` 中 `TAGS`）改为 **标签库 + 自由打标 + 列表多标签交集筛选**。侧栏 **标签库** 与场景库、单价库同级。

**运行目录：**

```powershell
cd "c:\Users\zl450\Nutstore\1\我的坚果云\Cursor\mr2525-template-catalog"
npm start
```

修改 `src/tags.js` / `src/db.js` / `src/server.js` 后需 **重启 Node**；仅前端改动请 **Ctrl+F5**。

---

## 1. 数据模型

| 表 / 字段 | 说明 |
|-----------|------|
| `tags` | `id`, `name`（`COLLATE NOCASE` 唯一）, `created_at` |
| `template_tags` | `template_id` + `tag_id` 多对多 |
| `templates.tags` | JSON 字符串数组（与关联表同步，兼容 CSV / 图册 / 导出） |

**启动迁移：**

1. `initTagsSchema` 建表  
2. 将原 `TAGS` 常量种子写入 `tags`  
3. 若 `template_tags` 为空，从各模板既有 JSON `tags` 迁移关联（**不**刷新 `updated_at`）

**写入路径：** `PATCH /api/templates/:id` 带 `tags: string[]` → `syncTemplateTags()` 更新关联表 + JSON。

---

## 2. 标签库页（字云）

| 项 | 说明 |
|----|------|
| 入口 | 侧栏 **标签库** |
| 数据 | `GET /api/tags` → `[{ id, name, template_count }]` |
| 字云 | 浮动排版；字号约 13–36px，随 `template_count` 变化 |
| 点击 | 跳转 **模板列表**，**追加**该标签到列表筛选（可叠多个，见 [模板列表 §9](TEMPLATE-LIST-UPDATES.md)） |

---

## 3. 模板列表 · 按标签筛选（交集）

| 项 | 说明 |
|----|------|
| 位置 | 列表工具栏第二行（与搜索/场景/状态同一卡片） |
| 已选 | 标签 pill，单个 `×` 移除；**清除标签** 清空全部 |
| 输入 | `#添加筛选`；逻辑与详情打标一致（`#` 后搜索 / 创建） |
| 多标签 | **交集（AND）**：须同时拥有全部已选标签 |
| API | `GET /api/templates?tag=A&tag=B` 或 `?tags=A,B`（`parseTagsQueryParam`） |
| SQL | `COUNT(DISTINCT tag_id)` 匹配标签数 = 筛选个数 |

**下拉层 UI（列表专用）：**

- 打开时挂到 `document.body`，`position: fixed`，紧贴输入框下缘（避免被下方表格遮挡、避免卡片 `transform` 导致错位）  
- 列表工具栏 `z-index` 高于表格区域  

详见 [模板列表 §9](TEMPLATE-LIST-UPDATES.md)。

---

## 4. 详情 · 打标签

| 区域 | 行为 |
|------|------|
| **常用标签** | `GET /api/tags/top?limit=5`，点击加入当前模板 |
| **已选标签** | pill + `×` 移除 |
| **输入框** | 占位 `#标签`；输入 `#` 后下拉最多 **20** 条（空查询为库内前 20） |
| **筛选** | 逐字 `GET /api/tags?q=…&limit=20` |
| **新建** | 无匹配时「创建标签」或 **Enter**；保存时写入标签库 |
| **保存** | **保存基本信息** 一并提交 `tags` |

只读账号：仅展示已选标签（无输入框）。

**与列表筛选区别：** 详情下拉在表单位置内 `absolute` 定位；列表筛选下拉为 `fixed` + 挂 `body`（见 §3）。

---

## 5. API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tags` | 全量字云；`?q=关键字&limit=20` 为搜索 |
| GET | `/api/tags/top?limit=5` | 关联数 Top N（须注册在 `/api/tags/:name/templates` 之前） |
| POST | `/api/tags` | `{ name }` 创建（编辑权限） |
| GET | `/api/tags/:name/templates` | 单标签下的模板列表 |
| GET | `/api/templates` | 支持 `tag` 重复参数或 `tags=` 多标签交集 |
| PATCH | `/api/templates/:id` | `tags: string[]` → `syncTemplateTags` |

**前端辅助：** `fetchTagRows()` / `asTagRows()` 校验接口返回必须为 JSON 数组。

**`meta`：** 不再下发固定 `tags` 列表；可选使用 `tagTop`（Top5 名称）。

---

## 6. 改动文件

| 文件 | 改动 |
|------|------|
| `src/tags.js` | 规范化、`syncTemplateTags`、`listTagsCloud`、`searchTags`、`parseTagsQueryParam`、迁移 |
| `src/db.js` | 建表迁移；`listTemplates({ tags })` 交集查询 |
| `src/server.js` | 标签 CRUD 路由；模板列表解析多 `tag` |
| `public/app.js` | 字云、`fetchTagRows`、详情 `bindDetailTagEditor`、列表 `bindListTagFilter` |
| `public/index.html` | 侧栏标签库、列表标签工具栏、移除列表页说明文案 |
| `public/styles.css` | 字云、`.tag-editor-*`、`.list-toolbar-tags`、`#list-tag-filter-dropdown` |

**废弃：**

- 详情固定 chip（`meta.tags` + `renderChips("detail-tags-box")`）  
- `meta.tags` 作为可选标签全集  

---

## 7. 关联文档

- [模板列表](TEMPLATE-LIST-UPDATES.md) — §9 列表标签交集筛选  
- [详情基本信息栏](DETAIL-BASIC-INFO-UPDATES.md) — 基本信息分组；标签区改为 # 打标  
- [MR2525 模板库协作 SOP](MR2525模板库协作SOP.md) — §6 步骤 2 打标签；v1.7+  
- [协作流程图](WORKFLOW.md)  
- [模板图册](GALLERY-UPDATES.md) — 展示图 / PDF 仍输出 `tags`  

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-05-31 | 初版：标签库字云、详情 `#` 打标、`tags` / `template_tags` 表与 API |
| 2026-05-31 | `fetchTagRows` 修复非数组响应；`#` 空查询展示前 20 条 |
| 2026-06-01 | 列表多标签交集筛选；列表下拉 `fixed` + 挂 `body` 防遮挡与错位 |
| 2026-06-01 | 移除列表页 `formula-hint` 说明文案；UI `20260601c` |
