# 手册 · Figma 设计稿

> 与 [手册编辑指南](HANDBOOK-EDITING.md) 配合使用。PDF 由 HTML + Puppeteer 生成；Figma 用于**全手册版式定稿**，改完后按画板同步到对应 **JSON / CSS 文件**（无自动同步）。  
> **已接入**桌面 `design-system` 令牌：黑白配色、`#0055FF` 标记、页脚条、Parti/Edgeware Logo（见 `src/design-system.js`）。

## 设计文件（边缘团队）

| 项 | 值 |
|----|-----|
| 名称 | MR2525 手册模板 960x540 |
| 链接 | https://www.figma.com/design/D2Pf4pbnGiirt8LYjeWhsR |
| 画板尺寸 | **960 × 540**（与 `PAGE_W` × `PAGE_H` 一致） |

文件内按 **3 个页面（Page）** 分组，对应三类 PDF 内容来源。

---

## 01-品牌固定页

与 [`data/handbook/brand.json`](../data/handbook/brand.json) + [`handbook-shell.js`](../src/handbook-shell.js) → `handbookThemeStyles()` 对应。

| Figma 帧名 | `layout` | 同步目标 |
|------------|----------|----------|
| `layout-hero` | `hero` | `brand.json` → `pages.intro[]`；样式 → `handbookThemeStyles()` |
| `layout-split` | `split` | 同上 |
| `layout-closing` | `closing` | `brand.json` → `pages.outro[]`；样式 → `handbookThemeStyles()` |

---

## 02-图册方案手册（模板输出）

图册「下载手册」/ 场景手册 Part B 复用 [`public-sheet.js`](../src/public-sheet.js) → `buildTemplatePages()`。  
**改排版主要改 `sheetStyles()`**（约 L172–387），结构 HTML 见同文件 `renderCoverPage` / `renderInfoPage` / `renderCombinedBomPage`。

| Figma 帧名 | PDF 页类型 | CSS 类 / 区块 | 说明 |
|------------|------------|---------------|------|
| `tpl-cover` | 方案封面 | `.page-cover`、`.cover-info`、`.cover-name`… | 封面图 + 底部渐变叠字：名称、参考价、简介、编号·场景·尺寸、标签 |
| `tpl-image` | 效果图 / 渲染图 | `.page-image`、`.page-caption` | 全幅图 + 底栏标题（如「效果图 1 / 3」） |
| `tpl-info` | 方案信息 | `.page-info`、`.info-grid`、`.note-block` | 双列字段 + 报价口径等说明块 |
| `tpl-bom` | BOM 清单 | `.page-bom`、`.bom-block`、表格 `th/td` | 紧凑表：型材→六通→五金→板材→其他 |

**预览：** 登录后打开  
`GET /api/templates/{模板id}/public-sheet.html`  
再下载 `public-sheet.pdf` 对比。

---

## 03-场景手册（场景专属）

与 [`scenario-handbook.js`](../src/scenario-handbook.js) → `handbookExtraStyles()` 对应（标记点、图例、分隔页等）。  
品牌三行叠字样式与 `handbook-shell.js` 中 `.handbook-brand-*` 共用。

| Figma 帧名 | PDF 页类型 | 同步目标 |
|------------|------------|----------|
| `layout-scenario-cover` | 场景代表图封面 | `handbookThemeStyles()` + `renderScenarioIntroPage` |
| `layout-scenario-marked` | 场景图 + 标记 | `handbookExtraStyles()`（`.marker-*`、`.marker-legend`、`.page-caption`） |
| `layout-section-divider` | 「模板方案」分隔页 | `handbookExtraStyles()` → `.section-divider` |

场景手册完整预览：`GET /api/scenarios/{场景id}/handbook.html`

---

## 同步到 catalog 的步骤

```text
Figma 定稿
  ├─ 01 品牌页 → brand.json（文案）+ handbook-shell.js handbookThemeStyles（样式）
  ├─ 02 方案页 → public-sheet.js sheetStyles（样式）；字段标签若在 HTML 写死则改 render* 函数
  └─ 03 场景页 → scenario-handbook.js handbookExtraStyles（样式）
→ 重启 npm start
→ HTML 预览（见上表）
→ 下载 PDF 确认
```

| 手册类型 | 主要改动的代码文件 |
|----------|-------------------|
| 品牌前言/封底 | `data/handbook/brand.json`、`src/handbook-shell.js` |
| **模板方案手册** | **`src/public-sheet.js`**（`sheetStyles` + 各 `render*`） |
| 场景标记/分隔/封面叠字 | `src/scenario-handbook.js` + `handbook-shell.js` |

**无自动同步。** 可用 Figma Dev Mode 量字号/色值后抄进 CSS。

---

## Cursor + Figma MCP

- 团队：**边缘团队**（`planKey`: `team::1623597386312239643`）
- 文件 key：`D2Pf4pbnGiirt8LYjeWhsR`
- 只读：`get_design_context`、`get_screenshot`（对照某一帧）
- 写入：`use_figma`（需桌面端打开该文件；View 席位若无法保存需申请编辑权限）

---

## 可选：导出 PNG 固定页

若某页希望完全以设计稿为准，可导出 PNG 至 `data/handbook/assets/` 并扩展 `layout: "image"`（需开发）。当前默认仍为 **HTML/CSS 排版**。
