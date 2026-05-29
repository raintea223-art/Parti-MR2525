# 场景库 · 规划与实施说明

> 规划日期：2026-05-28  
> 状态：**已实施**（P1–P4 + 2026-05-30 UI/标记/场景手册 PDF 修订）

MR2525 型材可应用于多种意想不到的场景。在现有固定 8 场景（`constants.js`）基础上，新增 **场景库**：可配置场景、管理场景级效果图/渲染图、在图上标注关联模板，并导出 **场景手册 PDF**；与 **模板图册**、**新建模板** 联动。

**运行目录（唯一开发副本）：**

```powershell
cd "c:\Users\zl450\Nutstore\1\我的坚果云\Cursor\mr2525-template-catalog"
npm start
```

浏览器 **Ctrl+F5** 强刷；侧栏底部 **UI 版本号** 用于确认前端已更新（场景标记：`UI 20260530d`；详情基本信息：`UI 20260531c`；标签/列表筛选：`UI 20260601c`，见 [DETAIL-BASIC-INFO-UPDATES](DETAIL-BASIC-INFO-UPDATES.md)、[TAG-LIB-UPDATES](TAG-LIB-UPDATES.md)）。

---

## 1. 已确认的产品决策

| # | 议题 | 决策 |
|---|------|------|
| D1 | **一级页面粒度** | **每个场景一张 card**（非每张图片一张） |
| D2 | **导航结构** | **一级**：场景库列表 → **二级**：场景详情（全部场景图）→ **三级**：单图标记编辑 |
| D3 | **手册 Part B 模板范围** | 仅 **`status = published`** |
| D4 | **标记关联模板** | **允许跨场景引用**（标记可指向其他场景的已发布模板） |
| D5 | **场景代码** | **固定 2 位大写字母**（如 `ZT`、`CW`），唯一 |
| D6 | **手册 Part B 内容** | **完整模板图册页**（封面 → 效果图 → 渲染图 → 方案信息 → BOM） |
| D7 | **场景禁用** | `enabled = 0` 后 **不可新建模板**，历史模板保留 |
| D8 | **场景封面** | `picker_image` 独立存储，**不可**在场景图上打标记 |
| D9 | **新建标记** | **双击**图片空白处（非单击），减少误触 |
| D10 | **未关联模板** | 允许先打点再选模板；未关联显示橙色标记 |
| D11 | **手册封面** | 代表图上叠加 Parti 品牌三行 + 导出日版本 `VYYYYMMDD` |
| D12 | **手册标记跳转** | 已关联模板的标记点/图例可 PDF 内链至 Part B 模板封面页 |

---

## 2. 与现状的关系

| 现状 | 场景库后 |
|------|----------|
| `SCENARIOS` 硬编码于 `constants.js` | 迁入 DB 表 `scenarios`，启动 seed 现有 8 条 |
| 新建模板 `<select>` 选场景 | SKP 选定后 **场景卡片网格**（显示 picker 图） |
| 模板 `scenario` 存中文名称 | 继续存 **名称**（兼容飞书 CSV）；编号仍 `TPL-{code}-序号-文件名` |
| 模板图册 PDF | Part B **复用** `public-sheet.js` 页生成逻辑 |

---

## 3. 信息架构与页面流

```
侧栏「场景库」
│
├─ 一级 · 场景列表
│     每场景 1 张 poster card
│     卡片图：picker_image → 否则首张效果图
│     悬停：「下载场景手册」
│     admin：拖拽/点击上传场景封面（picker）
│
├─ 二级 · 场景详情（view-scenario-detail）
│     顶栏：封面 + 名称/统计 + 已发布模板缩略图（可悬停预览）
│     网格：效果图 / 渲染图（拖拽上传到对应区域）
│     点击某张图 → 三级
│
└─ 三级 · 标记编辑（view-scenario-markers）
      大图 + 标记层（#marker-pins-layer）
      双击空白：新建标记（可暂不选模板）
      单击标记：选中，右侧编辑面板 + 图上模板下拉（已关联时选中态可改）
      拖动标记：调整位置（移动 >5px 才进入拖动，避免与单击冲突）
      单击图上空白：取消选中
      右侧列表：选中行高亮，可删
```

**admin 专属：** 场景 CRUD、上传/删除 `picker_image`。

---

## 4. 数据模型

### 4.1 `scenarios`

| 列 | 说明 |
|----|------|
| `id` | 主键 |
| `name` | 场景名称（唯一） |
| `code` | **2 位**大写字母，唯一 |
| `slug_prefix` | slug 前缀 |
| `picker_image` | 列表卡 / 新建选场景 / 详情顶栏封面（**不参与标记**） |
| `description` | 场景简介 |
| `sort_order` / `enabled` | 排序、是否可选 |
| `created_at` / `updated_at` | 时间戳 |

### 4.2 `scenario_images`

| 列 | 说明 |
|----|------|
| `id` | 主键 |
| `scenario_id` | FK |
| `kind` | `effect` / `render` |
| `file_path` | `/uploads/scenarios/{code}/效果图|渲染图/…` |
| `title` | 可选 |
| `sort_order` | 排序 |

### 4.3 `scenario_markers`

| 列 | 说明 |
|----|------|
| `id` | 主键 |
| `scenario_image_id` | FK（仅 `scenario_images`，不含 picker） |
| `template_id` | FK → `templates.id`，**可为 NULL**（未关联模板） |
| `x_pct` / `y_pct` | 0–100 归一化坐标 |
| `label` | 显示文案（默认模板名或「未关联模板」） |
| `sort_order` | 同图内序号 |
| `created_at` | 创建时间（用于服务端防重复插入） |

**校验：** 关联时 `template_id` 须为 **`status = published`**。

**迁移：** `migrateScenarioMarkersNullableTemplate()` 将 `template_id` 改为可空。

---

## 5. 权限

| 操作 | admin | editor | viewer |
|------|-------|--------|--------|
| 场景 CRUD、picker 封面 | ✅ | ❌ | ❌ |
| 上传/删场景图片、编辑标记 | ✅ | ✅ | ❌ |
| 浏览、下载场景手册 | ✅ | ✅ | ✅ |

---

## 6. 场景手册 PDF

**文件名：** `{场景代码}_场景手册.pdf`

### 封面（Part A 首页）

在场景代表图（`picker_image` 或首张场景图）上叠加 **白色加粗** 文案：

| 行 | 内容 |
|----|------|
| 1 | `Parti空间编辑系统` |
| 2 | `——{场景名称}空间`（如 `——展厅空间`） |
| 3 | 版本号 `VYYYYMMDD`（导出当日，如 `V20260530`） |

无代表图时使用深色渐变底，同样显示上述三行。

### Part A · 场景图页

- 效果图/渲染图全幅；叠加标记点与图例  
- **已关联模板**的标记点与图例项为 PDF 内链，点击跳转 Part B 对应模板**封面页**（锚点 `tpl-{模板id}`）  
- 跨场景引用的已发布模板也会纳入 Part B，以保证链接有效  

### Part B · 模板篇

本场景已发布模板 + 标记引用但属其他场景的已发布模板（去重后按编号排序），每套模板复用图册完整页序列；**第一页**带 `id="tpl-{id}"` 供锚点跳转。

**实现要点：**

| 项 | 说明 |
|----|------|
| 构建标识 | `HANDBOOK_BUILD = 20260530-handbook-v2`，`npm start` 时打印，用于确认已加载新逻辑 |
| 模板范围 | `listTemplatesForScenarioHandbook()`：本场景已发布 + 全图标记引用的跨场景已发布（去重、按编号排序） |
| 锚点 | 每套模板第一页 `<section id="tpl-{模板id}">` |
| 内链 | 标记点 `<a href="#tpl-{id}">`；图例项同锚点；未关联或无对应页的标记不可点 |
| 版本号 | `handbookVersionLabel()` → 导出当日 `VYYYYMMDD` |

**验证清单（下载新 PDF 后）：**

1. 终端启动日志含 `场景手册 PDF: 20260530-handbook-v2`  
2. 封面有三行白字：Parti空间编辑系统 / ——{场景名}空间 / V日期  
3. 在 Adobe Acrobat 等阅读器中，点击效果图标记可跳到对应模板封面页  

---

## 7. 新建模板 · 场景卡片选择

SKP 选定后展示场景卡片网格；图源 `picker_image` → 首张效果图 → 占位。

---

## 8. API

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/scenarios` | read | 列表（图片数、已发布模板数） |
| POST | `/api/scenarios` | admin | 新建场景 |
| PATCH | `/api/scenarios/:id` | admin | 更新 |
| DELETE | `/api/scenarios/:id` | admin | 删除（无模板时） |
| GET | `/api/scenarios/:id` | read | 详情 + `images` + `published_templates` + `picker_display` |
| POST | `/api/scenarios/:id/picker` | admin | 上传场景封面（multipart） |
| DELETE | `/api/scenarios/:id/picker` | admin | 删除场景封面 |
| POST | `/api/scenarios/:id/images` | write | 上传效果图/渲染图 |
| DELETE | `/api/scenario-images/:id` | write | 删图（级联删标记） |
| GET | `/api/scenario-images/:id` | read | 单图 + `markers[]` |
| POST | `/api/scenario-images/:id/markers` | write | 新建标记（`template_id` 可省略） |
| PATCH | `/api/scenario-markers/:id` | write | 位置 / 模板 / label |
| DELETE | `/api/scenario-markers/:id` | write | 删标记 |
| GET | `/api/templates/published-picker` | read | 标记用已发布模板下拉（支持 `?q=`） |
| GET | `/api/scenarios/:id/handbook.pdf` | read | 场景手册 PDF |

`/api/meta` 的 `scenarios` 由 DB 动态返回。

**创建标记防重复（服务端）：** 2 秒内、同图、坐标接近（±0.2%）的重复 `POST` 返回已有记录，不二次插入。

---

## 9. 前端实现要点（`public/app.js`）

| 模块 | 说明 |
|------|------|
| 视图 ID | `scenario-detail`、`scenario-markers`（与 `switchView` 一致） |
| 标记状态 | `markerEditState`、`markerRefreshGen`、`markerLoadGen` |
| 事件绑定 | `AbortController` 单例绑定，离开页 `teardownMarkerEditor()` |
| 新建 | `dblclick` + `markerCreateLock` + 600ms 防抖；拖动后短时禁止误触新建 |
| 拖动 | 移动阈值 5px 后显示 `#marker-drag-preview`；松手 **乐观更新坐标** 再 PATCH，避免闪回 |
| 选中 | 单击标记选中；**单击图上空白** `clearMarkerSelection()` |
| 已关联模板 | 选中后图上显示模板下拉，右侧 `marker-editor-panel` 可改模板 |
| 列表/图层 | `replaceChildren` 重建 pin；`getValidMarkers()` 按 `id` 去重 |

**缓存：** `index.html` 中 `app.js?v=…` 与侧栏 `UI 20xxxxxx` 版本号一并递增。

---

## 10. 改动文件索引

| 文件 | 说明 |
|------|------|
| `src/scenarios.js` | CRUD、图片、标记、`findRecentMarkerNear`、`listTemplatesForScenarioHandbook` |
| `src/scenario-handbook.js` | 手册 HTML/PDF、封面叠字、标记内链、`HANDBOOK_BUILD` |
| `src/db.js` | 表结构 + `template_id` 可空迁移 |
| `src/server.js` | 路由；启动日志输出项目目录与手册构建版本 |
| `public/app.js` | 三级 UI、标记编辑 |
| `public/styles.css` | `#marker-pins-layer`、拖动预览、详情/上传样式 |
| `public/index.html` | 视图容器、脚本版本 |

---

## 11. 实施阶段

| 阶段 | 交付 |
|------|------|
| **P1** | DB + 场景 CRUD + meta + 新建场景卡片 |
| **P2** | 一级列表 + 二级图片网格 + 拖拽上传 |
| **P3** | 三级标记编辑 + 跨场景选模板 |
| **P4** | 场景手册 PDF（基础 Part A + Part B） |
| **P5** | 手册标记 → 模板页 PDF 内链（**已实施** `20260530-handbook-v2`）；一级 PNG 导出等待做 |
| **P6** | 2026-05-30：封面 picker、详情模板条、标记 Web 交互与稳定性修订 |
| **P7** | 2026-05-30：手册封面 Parti 品牌叠字 + 跨场景模板纳入 Part B + 内链锚点 |

---

## 12. 重启服务（必读）

在 PowerShell 中**依次**执行（路径不要写错，也不要在 `public` 子目录里启动）：

```powershell
# 1. 停掉占用 3847 的旧进程（无输出即正常）
Get-NetTCPConnection -LocalPort 3847 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

# 2. 进入项目根目录（坚果云副本）
cd "c:\Users\zl450\Nutstore\1\我的坚果云\Cursor\mr2525-template-catalog"

# 3. 启动
npm start
```

终端里应出现：

```
项目目录: ...\我的坚果云\Cursor\mr2525-template-catalog
场景手册 PDF: 20260530-handbook-v2
```

若**没有**第二行，说明仍在跑旧代码。导出 PDF 后封面应有 **Parti空间编辑系统** 三行白字，标记点可点击跳转。

---

## 13. 运维提示

| 问题 | 处理 |
|------|------|
| 改了代码页面不变 | 确认在 **坚果云路径** 下 `npm start`；**Ctrl+F5**；看 UI 版本号 |
| 改了代码 PDF 不变 | 多为 **未真正重启**（见 `EADDRINUSE`）；看启动日志是否有 `20260530-handbook-v2` |
| 改后端无效 | **必须先停掉旧进程** 再启动（见 §12） |
| `EADDRINUSE :3847` | 端口被旧 Node 占用，新代码**没有加载**；先 `Stop-Process` 再 `npm start` |
| 在 `public` 里 `npm start` | 可启动但不直观；请在 **项目根目录**（含 `package.json` 的目录）执行 |
| `Nutstore\1\Cursor` 旧副本 | 已弃用；仅以 `我的坚果云\Cursor\mr2525-template-catalog` 为准 |
| 上传封面报 `Unexpected token '<'` | 多为旧进程未加载 `POST /api/scenarios/:id/picker`，需重启服务 |
| 历史重复标记 | 在标记列表手动删除多余条；刷新后仍多则为 DB 脏数据 |

---

## 14. 关联文档

- [模板图册](GALLERY-UPDATES.md)  
- [详情基本信息栏](DETAIL-BASIC-INFO-UPDATES.md)  
- [模板列表](TEMPLATE-LIST-UPDATES.md)  
- [单价库](PRICE-LIB-UPDATES.md)  
- [模板编号规则](MR2525模板库协作SOP.md) §12  
- [协作流程](WORKFLOW.md) · [SOP 索引](SOP.md)  
- [NAS 部署](NAS-DEPLOY.md)

---

## 15. 变更记录

| 日期 | 内容 |
|------|------|
| 2026-05-28 | 初版规划；用户确认 D1–D7 |
| 2026-05-28 | **已实施** P1–P4：DB、场景 CRUD、三级 UI、标记、场景手册 PDF、新建模板卡片选场景 |
| 2026-05-30 | **场景库 UI 增强**：admin 封面上传（`picker` API）；二级详情顶栏 `published_templates` 缩略图；效果图/渲染图拖拽上传；视图 ID 修正（`scenario-detail`） |
| 2026-05-30 | **标记编辑修订**：`template_id` 可空；双击新建；服务端同位防重复插入；修复重复 POST/重复监听导致的「幽灵标记」；拖动预览层 + 乐观坐标；单击选中/空白取消选中；已关联模板选中后可再编辑；前端 `UI 20260530d` |
| 2026-05-30 | **场景手册 PDF**：封面 Parti 品牌三行文案 + `VYYYYMMDD` 版本；标记点/图例 PDF 内链跳转模板页；Part B 含跨场景被引用模板 |
| 2026-05-30 | **运维**：`server.js` 启动时打印 `项目目录` 与 `场景手册 PDF: 20260530-handbook-v2`；文档补充 `EADDRINUSE` 与双目录说明 |

---

## 17. 2026-05-30 修订摘要（本次）

### 场景库 Web（三级标记页）

- 修复「幽灵标记」：取消重复事件监听、双击新建防抖、拖动预览层、`replaceChildren` 重绘、服务端近距防重复插入  
- 拖动：移动超 5px 才拖动；松手乐观更新坐标，避免闪回旧位置  
- 交互：单击选中；单击图上空白取消选中；已关联模板选中后可改模板  
- 前端缓存版本：`UI 20260530d`（`public/index.html`）

### 场景手册 PDF

- 封面叠字：Parti空间编辑系统 / ——{场景名}空间 / VYYYYMMDD  
- 标记点与图例支持跳转模板方案封面（`tpl-{id}`）  
- `listTemplatesForScenarioHandbook` 收录跨场景被引用模板  

### 开发与部署注意

- **唯一运行目录**：`c:\Users\zl450\Nutstore\1\我的坚果云\Cursor\mr2525-template-catalog`  
- 修改后端后必须释放 3847 端口再 `npm start`，否则仍跑内存中的旧代码  

---

## 16. 未纳入 / 后续

- 场景库内搜索、标签  
- 手册批量打包  
- 未登录公开分享  
- 标记取消关联模板（清空 `template_id`）的 UI 入口（API 已支持 PATCH 为 null）
