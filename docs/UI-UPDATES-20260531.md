# 全局 UI · 2026-05-31 实施说明

> 实施日期：2026-05-31  
> 状态：**已实施**  
> 前端版本：**UI 20260531h**（`styles.css?v=20260531h` · `app.js?v=20260531h`）

本文档汇总 **2026-05-31** 前端视觉改造、回归修复，以及单价库五金栏布局微调。仅改 `public/styles.css`、`public/index.html`、`public/app.js`，**无** API / 数据库变更。

**验证：** 浏览器 **Ctrl+F5**；侧栏底部应显示 **UI 20260531h**。

---

## 0. 批次号规则

- 格式：`YYYYMMDD` + 小写字母后缀（`a`、`b`、`c`…），表示**同一自然日**内的多次前端修正。
- 日历日期以文档/提交实施日为准，**不得**把批次号当作未来日期。
- 2026-05-31 当日已知批次（按时间先后）：

| 批次 | 说明 |
|------|------|
| **20260531c** | 详情基本信息栏分组布局（见 [DETAIL-BASIC-INFO-UPDATES](DETAIL-BASIC-INFO-UPDATES.md)） |
| **20260531d** | 列表多标签交集筛选（见 [TAG-LIB-UPDATES](TAG-LIB-UPDATES.md)） |
| **20260531e** | 后端升级批次前端（版本历史/深化表单/单价库图片，见 [UPGRADE-20260531](UPGRADE-20260531.md)） |
| **20260531f** | MakerWorld 风格全局 UI（配色/字体/侧栏/全宽） |
| **20260531g** | `app.js` 回归修复 + 五金表格列宽/图片列 |
| **20260531h** | 五金添加栏单行全宽（**当前**侧栏显示） |

---

## 1. MakerWorld 风格全局 UI

参考 [MakerWorld](https://makerworld.com.cn) / Bambu Lab 中文版视觉。

| 项 | 说明 |
|----|------|
| 主色 | `#00AE42`，悬停 `#009A3A`，浅底 `#E8F8EF` |
| 背景 | 页面 `#F5F5F5`，卡片 `#FFFFFF`，边框 `#E8E8E8` |
| 字体 | **HarmonyOS Sans SC**（CDN），回退 PingFang SC / 微软雅黑 |
| 侧栏 | 白色固定 **220px**，不折叠；仅 ≤720px 时改顶部横向 |
| 主内容 | 去掉 `max-width: 1320px` / 流程页 `960px` 限制，**全宽** |
| 其它 | 去掉蓝图网格背景；登录页浅色；表头/标签去大写工业风 |

**改动文件：** `public/styles.css`、`public/index.html`（字体 CDN、样式缓存参数）

---

## 2. 前端回归修复（`app.js`）

提交 `a6e932d` 曾用旧版 `app.js` 覆盖约 1350 行，导致详情/标签/报价 Tab 异常。已从 `7a2a0bd` **恢复**完整前端，并保留 `a6e932d` 的 **六通/五金图片** 能力。

| 现象 | 原因 | 修复 |
|------|------|------|
| 详情基本信息回到旧两列、无分组 | `renderDetail` 回退为 `.detail-grid` | 恢复 `.detail-form` 分组、封面缩略图选择器、`#` 打标 |
| 报价清单仅「型材」Tab 可点 | 回退版 `renderChips(..., meta.tags)` 在 `meta.tags` 为 `undefined` 时报错，后续事件未绑定 | 恢复标签编辑器；新增 `bindQuoteTabs()` 且在只读账号下也可切换 Tab |
| 标签库空白 | 删除 `loadTagCloud()` 与导航加载 | 恢复 `GET /api/tags` 字云渲染 |

详见 [详情基本信息栏](DETAIL-BASIC-INFO-UPDATES.md)、[标签库](TAG-LIB-UPDATES.md)。

---

## 3. 单价库 · 五金配件表格列宽

表格 class：`price-lib-table price-lib-hardware`。

| 列 | 调整 |
|----|------|
| **对外价 / 对内价** | 五金专用 `12rem`（约为通用 `6rem` 两倍）；规则须写在 `.price-lib-table .col-price` **之后**，选择器 `.price-lib-table.price-lib-hardware .col-price` |
| **图片** | 列宽 `6rem`；缩略图 / 上传区 **5rem × 5rem** 近方形 |
| **规格** | 缩小为 `8%` / `min-width: 4rem` |
| **链接** | 由 `24%` 调整为 **16%** |
| **名称** | `12%` / `6.5rem`（为价格列让位） |

样式：`.price-item-thumb`、`.col-price-image`、`.price-item-image-cell`

详见 [单价库 §14–§15](PRICE-LIB-UPDATES.md)。

---

## 4. 单价库 · 五金配件「添加」栏

| 项 | 说明 |
|----|------|
| 布局 | 单行 **`flex` + `nowrap`**，class：`hardware-add hardware-add-wide` |
| 屏宽 | `width: 100%`；名称/规格/供应商等 `flex: 1`；**链接** `flex: 2`；单位与单价列固定宽度 |
| 图片 | 与 **六通栏相同** 的 `priceAddImageFieldHtml`（可选拖拽区，`min-height: 72px`） |
| 坑点 | `.hardware-add { display: grid }` 写在后面会覆盖 flex；须用 **`.hardware-add.hardware-add-wide`** 且放在 `.hardware-add` **之后** |
| 小屏 | 媒体查询仅对 `.hardware-add:not(.hardware-add-wide)` 折行；五金添加栏保持单行，必要时横向滚动 |

---

## 5. 改动文件清单

| 文件 | 内容 |
|------|------|
| `public/styles.css` | MakerWorld 色板/字体/侧栏/全宽；五金列宽；五金添加栏 flex |
| `public/index.html` | HarmonyOS 字体 CDN；`styles.css` / `app.js` 缓存版本；UI 版本号 |
| `public/app.js` | 从 `7a2a0bd` 恢复详情/标签/列表；合并单价库图片；`bindQuoteTabs`；五金添加栏 HTML |

---

## 6. 关联文档

- [单价库微调](PRICE-LIB-UPDATES.md) — §14 列宽 · §15 添加栏  
- [详情基本信息栏](DETAIL-BASIC-INFO-UPDATES.md) — 分组布局（本次回归后仍有效）  
- [标签库](TAG-LIB-UPDATES.md) — 字云与 `#` 打标（本次回归后仍有效）  
- [升级摘要 2026-05-31](UPGRADE-20260531.md) — 后端能力（与本次 UI 独立）

---

## 7. 修订记录

| 日期 | 批次 | 说明 |
|------|------|------|
| 2026-05-31 | **f** | MakerWorld 全局 UI |
| 2026-05-31 | **g** | `app.js` 回归修复；五金表格列宽 |
| 2026-05-31 | **h** | 五金添加栏单行全宽（当前） |
