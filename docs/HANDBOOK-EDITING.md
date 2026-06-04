# 手册编辑指南

> 实施日期：2026-06-03  
> 构建标识：`20260603-handbook-design-system`（启动日志 `场景手册 PDF: …`）  
> 视觉令牌：[`data/handbook/design-system/design-system.json`](../data/handbook/design-system/design-system.json)

场景手册与方案手册的**固定品牌页**（产品前言、封底等）通过 [`data/handbook/brand.json`](../data/handbook/brand.json) 与 [`src/handbook-shell.js`](../src/handbook-shell.js) 维护；动态内容（场景图、标记、模板 BOM）仍来自数据库与现有 UI。

---

## 1. 编辑什么、改哪里

| 想改的内容 | 文件 / 位置 |
|------------|-------------|
| 产品前言、封底文案与是否插入 | `data/handbook/brand.json` → `pages`、`apply` |
| 全局配色 / 页脚 / Logo | `data/handbook/design-system/design-system.json` + `src/design-system.js` |
| 品牌页版式（字号、配色、间距） | `src/handbook-shell.js` → `handbookThemeStyles()` |
| 场景封面三行、标记点样式 | `brand.json` 的 `brand.*`；标记样式在 `scenario-handbook.js` → `handbookExtraStyles()` |
| 模板封面 / BOM / 方案信息 | `src/public-sheet.js` → `sheetStyles()` 与各 `render*`；Figma **02-图册方案手册**（[FIGMA 对照](HANDBOOK-FIGMA.md#02-图册方案手册模板输出)） |
| 场景图、标记、模板数据 | 场景库 / 模板库 UI（不变） |

修改 `brand.json` 或 `handbook-shell.js` 后需**重启 Node 服务**（或重建 Docker 容器）后生效。

---

## 2. `brand.json` 结构

```json
{
  "version": 1,
  "brand": {
    "productName": "Parti空间编辑系统",
    "tagline": "…",
    "scenarioTitleTemplate": "——{scenarioName}空间",
    "contact": { "web": "…", "email": "…" }
  },
  "pages": {
    "intro": [ { "layout": "hero", … }, { "layout": "split", … } ],
    "outro": [ { "layout": "closing", … } ],
    "beforePartB": []
  },
  "apply": {
    "scenarioHandbook": { "intro": true, "outro": true, "beforePartB": false },
    "templateHandbook": { "intro": false, "outro": true }
  }
}
```

### 页面 layout

| layout | 字段 | 说明 |
|--------|------|------|
| `hero` | `title`, `subtitle`, `bullets[]` | 深色全幅前言 |
| `split` | `title`, `body` | 白底说明页 |
| `closing` | `title`, `lines[]` | 封底 + `contact` |

### apply 开关

| 键 | 默认建议 | 效果 |
|----|----------|------|
| `scenarioHandbook.intro` | `true` | 场景手册最前插入 `pages.intro` |
| `scenarioHandbook.outro` | `true` | 场景手册最后插入 `pages.outro` |
| `scenarioHandbook.beforePartB` | `false` | 为 `true` 时在「模板方案」分隔页前插入 `pages.beforePartB` |
| `templateHandbook.intro` | `false` | 避免每套方案手册重复长前言 |
| `templateHandbook.outro` | `true` | 方案手册末尾封底 |

配置损坏或缺失时：服务降级为**仅动态页**，控制台 `[handbook-shell] 品牌配置加载失败` 告警，导出不 500。

---

## 3. 场景手册 PDF 页序（启用默认 apply）

1. 品牌 `intro` 页（配置）
2. 场景封面（代表图 + 品牌三行 + 版本 `VYYYYMMDD`）
3. 场景效果图 / 渲染图（标记 + 图例）
4. （可选）`beforePartB` 品牌页
5. 分隔页「模板方案」
6. 各模板图册页（Part B，`id="tpl-{id}"` 供内链）
7. 品牌 `outro` 页（配置）

---

## 4. 预览与下载

| 类型 | HTML 预览 | PDF |
|------|-----------|-----|
| 场景手册 | `GET /api/scenarios/:id/handbook.html` | `GET /api/scenarios/:id/handbook.pdf` |
| 方案手册 | `GET /api/templates/:id/public-sheet.html` | `GET /api/templates/:id/public-sheet.pdf` |
| 仅品牌页 | `GET /api/handbook/brand-preview.html` | — |

登录后即可在浏览器打开 HTML 预览；确认后再下载 PDF。图册批量 zip 手册会自动包含品牌壳层。

---

## 5. 版式与 Figma 编辑

- 页面尺寸：**960 × 540 px**（16:9），与 Puppeteer `@page` 一致。
- **Figma 设计稿（边缘团队）**：见 [手册 · Figma 设计稿](HANDBOOK-FIGMA.md)  
  - 文件：https://www.figma.com/design/D2Pf4pbnGiirt8LYjeWhsR  
  - 画板：`layout-hero` / `layout-split` / `layout-closing` 与 `brand.json` 的 `layout` 一一对应。
- 文件分三页：**01 品牌**、**02 图册方案手册**（`tpl-cover` / `tpl-image` / `tpl-info` / `tpl-bom`）、**03 场景手册**。
- 模板手册排版 → 改 **`public-sheet.js` 的 `sheetStyles()`**（不是 `brand.json`）。
- 在 Figma 改完后按 [HANDBOOK-FIGMA](HANDBOOK-FIGMA.md) 对照表同步；**无自动同步**，改完需重启服务并 HTML 预览。
- Figma MCP 可 `get_screenshot` 对照；`use_figma` 写入需桌面端打开该文件且具备编辑权限。

---

## 6. 相关文件

| 文件 | 职责 |
|------|------|
| `data/handbook/brand.json` | 品牌文案与 apply 开关 |
| `src/handbook-shell.js` | 加载配置、渲染品牌页、包装 HTML |
| `src/scenario-handbook.js` | 场景手册组装 |
| `src/public-sheet.js` | 方案手册组装 |
| `src/server.js` | `handbook.html`、`brand-preview.html` 路由 |

详见 [场景库说明](SCENARIO-LIB-UPDATES.md)、[模板图册说明](GALLERY-UPDATES.md)。
