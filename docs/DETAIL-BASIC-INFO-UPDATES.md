# 模板详情 · 基本信息栏 · 实施说明

> 实施日期：2026-05-31  
> 状态：**已实施**  
> 前端版本：**UI 20260531c**（`public/index.html` · `app.js?v=20260531c`）

本文档记录模板 **详情页 → 基本信息** 区域的布局重组、字段取舍与交互变更。与 [模板列表](TEMPLATE-LIST-UPDATES.md)、[详情状态流](TEMPLATE-LIST-UPDATES.md#7-2026-05-31--详情状态已下架重新上架) 互补。

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

窄屏（≤720px）下 3 列 / 2 列自动折为单列。

---

## 2. 移除与保留的字段

| 字段 | 详情表单 | 数据库 / API | 对外展示 |
|------|----------|--------------|----------|
| **皮肤选配说明** `panel_note` | **已移除编辑**；有历史数据时显示只读块「皮肤选配说明（历史记录）」 | 保留列；保存基本信息 **不再提交** `panel_note` | [模板图册](GALLERY-UPDATES.md) 方案信息页：**有内容仍展示**，新模板不再填写 |
| **询单表单链接** `inquiry_form_url` | **已移除** | 保留列；保存时不再提交 | 飞书 Doc 模板可自建询单区，见 [FEISHU-SETUP](FEISHU-SETUP.md) |
| 其余基本信息字段 | 不变 | 不变 | 不变 |

**新模板协作约定：** 皮肤信息仅通过 **板材 BOM**（材质 / 厚度 / 标配颜色）表达；不再维护 `panel_note`。

---

## 3. 「可定制」开关（原「可升级」）

| 项 | 说明 |
|----|------|
| 界面文案 | **可定制**（替代「可升级（皮肤色差区间）」） |
| 控件形态 | 仍为 `checkbox`（`#d-skin-upgrade`），使用 `.checkbox-chip` 将勾选框与文字合成 **一块可点区域** |
| 系统字段 | 仍为 `skin_upgrade_enabled`（未改库名） |
| 业务含义 | 与 SOP §3 一致：关 = 单一参考价；开 = 可按皮肤色差报区间（依赖单价库同色厚异色项） |
| 审核 checklist | `skin_upgrade` 文案改为「可定制开关状态正确」；**已删除** `skin_note`（皮肤选配说明）项 |
| CSV 导出列名 | 「可升级」→ **「可定制」**（`src/server.js`） |

保存方式：随 **保存基本信息** 一并提交（非即时 PATCH）。

---

## 4. 封面来源 · 缩略图选择器

| 项 | 说明 |
|----|------|
| 替代 | 原生 `<select>` 文字选项 |
| 组件 | `renderCoverSourcePicker` · `bindCoverSourcePicker` · `refreshCoverSourcePicker` |
| 选项来源 | `buildCoverOptions(t)`：实拍 `photo:N`、效果图 `effect:N`，含缩略图 URL |
| 交互 | 触发器显示当前缩略图 + 标签；下拉列表为图 + 标签；选中后 **即时 PATCH** `cover_source` 并刷新详情 |
| 上传后 | `refreshDetailAssets` 重建选择器，保留当前选中值（若仍有效） |
| 只读用户 | 无下拉，仅静态缩略图 + 标签 |

隐藏域 `#d-cover-source` 仍供保存逻辑兼容；封面变更以选择器 PATCH 为主。

---

## 5. 改动文件

| 文件 | 改动 |
|------|------|
| `public/app.js` | `renderDetail` 基本信息 HTML；封面选择器函数；`saveDetail` 去掉 `panel_note` / `inquiry_form_url` |
| `public/styles.css` | `.detail-form`、`.detail-section*`、`.checkbox-chip`、`.cover-source-*` |
| `public/index.html` | UI / `app.js` 缓存版本 `20260531c` |
| `src/constants.js` | `AUDIT_CHECKLIST`：可定制文案；移除 `skin_note` |
| `src/server.js` | CSV 列「可定制」 |

**未改：** `PATCH /api/templates/:id` 仍接受 `panel_note`、`inquiry_form_url`（兼容脚本/旧客户端）；图册 `public-sheet.js` 仍按 `panel_note` 有值输出。

---

## 6. 关联文档

- [标签库](TAG-LIB-UPDATES.md) — 详情「标签」区 `#` 打标（替代原固定 chip）；列表交集筛选见该文档 §3、§9  
- [单价库](PRICE-LIB-UPDATES.md) — 详细报价清单：型材颜色、五金 `spec` 迁移与添加交互  
- [模板列表 §7](TEMPLATE-LIST-UPDATES.md) — **已发布** 仅可改标签、下架、版本 +0.1 / 换模型 +1  
- [MR2525 模板库协作 SOP](MR2525模板库协作SOP.md) — v1.6 同步基本信息栏与可定制命名  
- [模板图册](GALLERY-UPDATES.md) — 方案信息页对皮肤选配说明的展示规则  
- [飞书搭建指南](FEISHU-SETUP.md) — 询单链接不再在 catalog 详情维护  
- [模板列表](TEMPLATE-LIST-UPDATES.md) — 列表页与详情状态流  
- [协作流程图](WORKFLOW.md) — 录入 → 审核主流程不变  

---

## 7. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-05-31 | 基本信息分组布局；移除皮肤选配说明/询单表单编辑；可定制 chip；封面缩略图选择器；审核 checklist 调整 |
