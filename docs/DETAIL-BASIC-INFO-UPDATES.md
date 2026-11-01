# 模板详情 · 基本信息栏 · 实施说明

> 实施日期：2026-05-31  
> 状态：**已实施**  
> 前端版本：**UI 20261102a**（含交付与发布区域）

本文档记录模板 **详情页 → 基本信息** 区域的布局重组、字段取舍与交互变更。与 [模板列表](TEMPLATE-LIST-UPDATES.md)、[详情状态流](TEMPLATE-LIST-UPDATES.md#7-2026-05-29--已发布模板只读与版本号) 互补。

**运行目录（唯一开发副本）：**

```powershell
cd "c:\Users\zl450\Nutstore\1\我的坚果云\Cursor\mr2525-template-catalog"
npm start
```

修改 `src/constants.js`（审核 checklist）后需 **重启 Node**；仅前端改动请 **Ctrl+F5**。

---

## 1. 分组布局

原 `.detail-grid` 两列平铺改为 `.detail-form` 多段分组：

| 分组 | 字段 | 布局 |
|------|------|------|
| 标识 | 名称、负责人、版本 | 3 列（`detail-section--grid3`） |
| 尺寸 | 宽 / 深 / 高（mm） | 3 列，小节标题「尺寸」 |
| 卖点 | 一句话卖点 | 整行 |
| 报价说明 | 报价口径 | 整行 textarea |
| 参考价 | 下限、上限（留空自动） | 2 列 |
| 可定制 | `skin_upgrade_enabled` | 整行，见 §3 |
| 封面来源 | `cover_source` | 缩略图下拉，见 §4 |
| 标签 | `#` 打标（常用 Top5 + 搜索下拉）；保存基本信息时写入 |
| 其他 | 内部备注、保存按钮 | 整行 / 原逻辑 |
| 交付与发布 | 整包价含税、价格基准日、安装工时、交付文件清单、EFF/RND 合并、交付备注 | 独立分组保存 |
| 交付附件 | DWG / PDF / BOM / MAN / INF | 分类上传、列表、删除 |

窄屏（≤720px）下 3 列 / 2 列自动折为单列。

---

## 2. 移除与保留的字段

| 字段 | 详情表单 | 数据库 / API | 对外展示 |
|------|----------|--------------|----------|
| **皮肤选配说明** `panel_note` | **已移除编辑**；有历史数据时显示只读块「皮肤选配说明（历史记录）」 | 保留列；保存基本信息 **不再提交** `panel_note` | [模板图册](GALLERY-UPDATES.md) 方案信息页：**有内容仍展示**，新模板不再填写 |
| **询单表单链接** `inquiry_form_url` | **已移除** | 保留列；保存时不再提交 | 飞书 Doc 模板可自建询单区，见 [FEISHU-SETUP](FEISHU-SETUP.md) |
| 整包价含税 `package_price` | 交付与发布分组 | 大于 0；提交审核与发布时服务端校验 | 图册与方案手册对外展示 |
| 价格基准日 `price_basis_date` | 交付与发布分组 | 有效 `YYYY-MM-DD` | 随整包价展示 |
| 安装工时 `installation_hours` | 交付与发布分组 | 大于 0 的人·h 总量 | 审核单与飞书主表 |
| 交付文件清单 `delivery_file_list` | 每行一个文件名全称 | JSON 存储；校验六段定式、缺项与重复 | 飞书主表与版本历史 |
| EFF/RND 合并与交付备注 | 只有 EFF 时两项必填 | `eff_rnd_merged` / `delivery_note` | 审核、飞书与版本历史 |
| 其余基本信息字段 | 不变 | 不变 | 不变 |

**新模板协作约定：** 皮肤信息仅通过 **板材 BOM**（材质 / 厚度 / 价库规格 / **标配颜色**）表达；不再维护 `panel_note`。添加级联：材质 → 厚度 → 规格 → 颜色。

---

## 3. 「可定制」开关（原「可升级」）

| 项 | 说明 |
|----|------|
| 界面文案 | **可定制**（替代「可升级（皮肤色差区间）」） |
| 控件形态 | 仍为 `checkbox`（`#d-skin-upgrade`），使用 `.checkbox-chip` 将勾选框与文字合成 **一块可点区域** |
| 系统字段 | 仍为 `skin_upgrade_enabled`（未改库名） |
| 业务含义 | 与 SOP §3 一致：关 = 单一参考价；开 = 皮肤色差区间（**Phase 2** 实现；价库已支持 [一条目多色 §17](PRICE-LIB-UPDATES.md#17-2026-06-04--板材一条目多色)） |
| 审核 checklist | `skin_upgrade` 文案改为「可定制开关状态正确」；**已删除** `skin_note`（皮肤选配说明）项 |
| CSV 导出列名 | 「可升级」→ **「可定制」**（`src/server.js`） |

保存方式：随 **保存基本信息** 一并提交（非即时 PATCH）。

---

## 4. 封面来源 · 缩略图选择器

| 项 | 说明 |
|----|------|
| 替代 | 原生 `<select>` 文字选项 |
| 组件 | `renderCoverSourcePicker` · `bindCoverSourcePicker` · `refreshCoverSourcePicker` |
| 选项来源 | `buildCoverOptions(t)`：实拍 `photo:N`、效果图 `effect:N`、渲染图 `render:N`，含缩略图 URL |
| 交互 | 触发器显示当前缩略图 + 标签；下拉列表为图 + 标签；选中后 **即时 PATCH** `cover_source` 并刷新详情 |
| 上传后 | `refreshDetailAssets` 重建选择器，保留当前选中值（若仍有效） |
| 只读用户 | 无下拉，仅静态缩略图 + 标签 |

隐藏域 `#d-cover-source` 仍供保存逻辑兼容；封面变更以选择器 PATCH 为主。

---

## 5. 交付与发布校验

- EFF / RND 至少一类；只有 EFF 时，必须勾选合并并填写交付备注。
- DWG / PDF / BOM / MAN / INF 五类附件上传后写入 `template_delivery_assets`，保留原始交付文件名。
- 文件名采用 `模板号_类型码_[序号_]描述_vX.Y.扩展名`；描述不超过 8 字，不含空格、圆括号、全角符号或下划线。
- 提交 `pending_review` 与 `audit/approve` 都执行服务端发布准入校验；已发布模板的交付字段与附件同样只读。
- 五类交付附件目录需要登录后下载，不通过公开静态路径暴露 INF。
- 图片可在可编辑状态删除，用于清理历史未登记图片；删除后封面自动重选。SKP 先暂存再替换，保留原始交付文件名并在失败时恢复旧模型。

---

## 6. 改动文件

| 文件 | 改动 |
|------|------|
| `public/app.js` | 基本信息、交付与发布、五类附件 UI；封面选择器；`saveDetail` 提交新字段 |
| `public/styles.css` | `.detail-form`、`.detail-section*`、`.checkbox-chip`、`.cover-source-*` |
| `public/index.html` | UI / 静态资源缓存版本 `20261102a` |
| `src/constants.js` | `AUDIT_CHECKLIST`：可定制文案；移除 `skin_note` |
| `src/server.js` | 新字段 PATCH、五类附件上传/删除、双入口发布校验、交付目录鉴权、飞书 CSV |
| `src/delivery.js` | 文件名、交付清单与发布准入领域校验 |
| `src/db.js` | 新字段、`template_delivery_assets` 与 `template_visual_assets` 增量迁移 |

**未改：** `PATCH /api/templates/:id` 仍接受 `panel_note`、`inquiry_form_url`（兼容脚本/旧客户端）；图册 `public-sheet.js` 仍按 `panel_note` 有值输出。

---

## 7. 关联文档

- [UI 更新 2026-05-31](UI-UPDATES-20260531.md) — MakerWorld 全局 UI；`app.js` 回归修复（§2）
- [标签库](TAG-LIB-UPDATES.md) — 详情「标签」区 `#` 打标（替代原固定 chip）；列表交集筛选见该文档 §3、§9  
- [单价库](PRICE-LIB-UPDATES.md) — 型材颜色、五金、**板材一条目多色（§17）**、BOM 行内改色  
- [模板列表 §7](TEMPLATE-LIST-UPDATES.md) — **已发布** 仅可改标签、下架、版本 +0.1 / 换模型 +1  
- [MR2525 模板库协作 SOP](MR2525模板库协作SOP.md) — v1.6 同步基本信息栏与可定制命名  
- [模板图册](GALLERY-UPDATES.md) — 方案信息页对皮肤选配说明的展示规则  
- [飞书搭建指南](FEISHU-SETUP.md) — 询单链接不再在 catalog 详情维护  
- [模板列表](TEMPLATE-LIST-UPDATES.md) — 列表页与详情状态流  
- [协作流程图](WORKFLOW.md) — 录入 → 审核主流程不变  

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-05-31 | 基本信息分组布局；移除皮肤选配说明/询单表单编辑；可定制 chip；封面缩略图选择器；审核 checklist 调整 |
| 2026-05-31 | `app.js` 回归修复（见 [UI-UPDATES-20260531](UI-UPDATES-20260531.md) §2） |
| 2026-11-02 | 新增交付与发布字段、五类附件、EFF/RND 组合规则、渲染图封面和双入口服务端校验 |
