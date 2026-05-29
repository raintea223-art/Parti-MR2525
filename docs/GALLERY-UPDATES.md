# 模板图册 · 实施说明

> 实施日期：2026-05-28  
> 最后更新：2026-06-03（手册/清单命名、内部 CSV、批量下载）  
> 状态：**已实施**

原「对外展示」模块重命名为 **模板图册**，提供合成展示图浏览与下载（PNG 展示图 / PDF 方案手册 / 内部清单 CSV），并支持勾选后批量打包下载。

---

## 1. 命名与入口

| 原 | 新 |
|----|-----|
| 对外展示 | **模板图册** |
| 复制对外摘要 | **已移除** |
| 打开详情链接（飞书 Doc） | **已移除** |

侧栏、页眉 eyebrow/title/subtitle 均已更新。

---

## 2. 展示图（Gallery Poster）

每个已发布模板一张 **3:4 合成展示图**：

| 区域 | 内容 | 层级 |
|------|------|------|
| 上半 | 封面图（`cover_image`） | — |
| 下半 | 名称 | **主** |
| 下半 | 参考价（`price_min` – `price_max`） | **主** |
| 下半 | 一句话简介（`one_liner`） | **主** |
| 下半 | 编号 · 场景 · 尺寸 | 次 |
| 下半 | 标签（`tags`） | 次 |

### 悬停操作

鼠标移入展示图 → 半透明遮罩 + 按钮：

| 按钮 | 行为 | 文件名 | 权限 |
|------|------|--------|------|
| **下载图片** | 前端 `html2canvas` 截取展示图 DOM | `{模板编号}.png` | 登录可读 |
| **下载手册** | 服务端 Puppeteer 渲染对外版 HTML → PDF（原「下载清单」） | `{模板编号}_手册.pdf` | 登录可读 |
| **下载清单** | 服务端导出 BOM + 对内/对外价、供应商、采购链接 | `{模板编号}_清单.csv` | `canExport` |

### 批量下载（图册顶栏）

- 每张卡片左上角可勾选；顶栏 **全选** 与 **已选 N / 总数**
- **一键下载图片**：打包为 `图册-展示图-YYYYMMDD.zip`（每张 `{编号}.png`）
- **一键下载手册**：打包为 `图册-手册-YYYYMMDD.zip`（每份 `{编号}_手册.pdf`）
- **一键下载清单**：合并为一份 `图册-清单-YYYYMMDD.csv`（`GET /api/export/gallery-sheet?ids=`）

触控设备：点击展示图展开/收起按钮层，再点按钮下载。

---

## 3. 方案清单 PDF

### 3.1 生成方式

- 服务端 `src/public-sheet.js` 组装 **对外版 HTML**（图片 base64 内嵌）
- **`puppeteer-core` + 系统 Chromium/Chrome/Edge** 打印 PDF（`printBackground: true`）
- 响应体须 `Buffer.from(pdf)` 发送（Puppeteer 返回 `Uint8Array`，直接 `res.send` 会变成 JSON 损坏文件）
- 仅 `status = published` 的模板可导出（403 拦截）

### 3.2 PDF 版式（16:9 横版）

页面尺寸：**960×540 px（16:9）**，零边距全幅输出。

| 顺序 | 页面 | 说明 |
|------|------|------|
| 1 | **封面** | 封面图撑满整页，底部渐变叠加：名称、参考价、一句话、编号·场景·尺寸、标签 |
| 2… | **效果图** | 每张效果图单独一页，`object-fit: cover` 撑满 |
| … | **渲染图** | 每张渲染图单独一页，同上 |
| 下一页 | **方案信息** | 编号/场景/尺寸/参考价/标签、报价口径；**皮肤选配说明**仅当 `panel_note` 有历史内容时输出（新模板不再在详情填写，见 [详情基本信息栏](DETAIL-BASIC-INFO-UPDATES.md)） |
| 最后一页 | **BOM 清单** | 型材 → 六通 → 五金 → 板材 → 其他，**同一页连续排版**；无数据的分类跳过 |

**BOM 页说明：**

- 不再按分类分页（型材后紧跟六通，以此类推）
- 使用紧凑表格（约 9px 字号、窄行距），尽量一页放下
- 页内小标题（h3）区分各类，非独立整页

**已移除的 PDF 文案：**

- 页脚「本清单不含物料单价、供应商及采购链接。正式报价以确认尺寸与清单为准。」— **不再输出**

### 3.3 BOM 对外脱敏

**保留：** 名称、规格、材质、颜色、厚度、尺寸、数量、单位、系数、计价方式  

**剔除：** 单价、小计、链接、供应商、对内价、物料成本、负责人、内部备注、skp 路径

**方案信息页保留参考价区间**（与图册展示图一致）；BOM 表内不出价格。

### 3.4 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/templates/:id/public-sheet.html` | 预览 HTML（需登录） |
| GET | `/api/templates/:id/public-sheet.pdf` | 下载 PDF（需登录） |

**响应头：** `Content-Disposition` 的 `filename=` 仅 ASCII 回退名；中文文件名走 `filename*=UTF-8''`（避免 Node 报 `Invalid character in header content`）。

---

## 4. 依赖与部署

| 包 | 用途 |
|----|------|
| `puppeteer-core` | 服务端 PDF（使用系统 Chrome / Edge / 容器内 Chromium） |
| `html2canvas` | 前端展示图 PNG（静态路径 `/vendor/html2canvas/`） |

**本地 Windows：** 自动检测 Chrome 或 Edge；亦可设置 `PUPPETEER_EXECUTABLE_PATH`。

**Docker（NAS）：** 基础镜像 `node:22-slim`，安装系统 `chromium` + `fonts-noto-cjk`：

```dockerfile
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

首次 PDF 生成可能需数秒（启动浏览器实例）。Nutstore 同步盘下 `npm install` 可能因文件锁失败，建议在非同步目录安装或暂停同步后重装。

---

## 5. 改动文件

| 文件 | 改动 |
|------|------|
| `src/public-sheet.js` | HTML 组装、16:9 分页、BOM 合并、PDF 生成；PDF 文件名 `{编号}_手册.pdf` |
| `src/gallery-export.js` | **新建** 内部清单 CSV（对内/对外价、供应商、采购链接） |
| `src/server.js` | 手册 PDF、单/批清单 CSV API；html2canvas 静态路由 |
| `public/app.js` | 图册 UI、手册/清单下载、批量勾选与 zip 打包 |
| `public/styles.css` | `.gallery-*` 样式 |
| `public/index.html` | 侧栏改名、提示文案 |
| `package.json` | `puppeteer-core`、`html2canvas` |
| `Dockerfile` | `node:22-slim` + chromium + 中文字体 |
| `docs/GALLERY-UPDATES.md` | 本文档 |
| `README.md` / `docs/SOP.md` / `WORKFLOW.md` / `MR2525模板库协作SOP.md` / `NAS-DEPLOY.md` | 对外交付与部署说明同步 |

---

## 6. 变更记录

### 2026-05-28 迭代

| 阶段 | 内容 |
|------|------|
| v1 | 「对外展示」→「模板图册」；合成展示图；悬停下载 PNG / PDF；移除复制摘要与详情链接 |
| v2 | 修复 PDF 无法打开：`res.send(Buffer.from(pdf))` |
| v2 | 修复下载报错：中文 `Content-Disposition` 头改为 ASCII + `filename*` |
| v3 | PDF 由 A4 竖版改为 **16:9 横版**；封面独立首页；效果图/渲染图各一页全幅 |
| v4 | 删除 PDF 页脚免责声明 |
| v5 | BOM **合并为单页**连续排版，取消按分类分页 |

### 2026-05-30（场景库联动）

| 项 | 内容 |
|----|------|
| 场景手册 Part B | 继续调用 `buildTemplatePages()`；每套模板首页增加 `id="tpl-{id}"` 供手册内链锚点 |

---

## 9. 2026-05-31 修订

- PDF **方案信息页**：`panel_note`（皮肤选配说明）**仅在有历史内容时**出现在 PDF；新模板不在 catalog 详情维护该字段（皮肤以板材 BOM 为准）。
- 与 [详情基本信息栏](DETAIL-BASIC-INFO-UPDATES.md) 一致；`src/public-sheet.js` 逻辑未改（有值则输出）。

### 2026-06-03 · 手册 / 清单 / 批量下载

| 变更 | 说明 |
|------|------|
| 下载手册 | 原悬停「下载清单」PDF 改名；内容不变；`{编号}_手册.pdf` |
| 下载清单 | 新增内部 CSV；`src/gallery-export.js`；`canExport` |
| 批量 | 卡片勾选 + 顶栏全选；一键 zip 图片/手册、合并 csv（`?ids=`） |
| 流程说明 | [WORKFLOW.md](WORKFLOW.md) §8.1、系统内 **流程说明** 页已同步 |

---


## 7. 关联文档

- [详情基本信息栏](DETAIL-BASIC-INFO-UPDATES.md)
- [标签库](TAG-LIB-UPDATES.md) — 详情打标写入 `tags`；图册/展示图/PDF 仍展示标签
- [单价库](PRICE-LIB-UPDATES.md) — 型材 BOM 含颜色列；五金清单字段与迁移说明
- [模板列表变更](TEMPLATE-LIST-UPDATES.md)
- [场景库](SCENARIO-LIB-UPDATES.md) — 场景手册 Part B 复用图册页；标记点 PDF 内链至各模板封面（`tpl-{id}`）
- [单价库微调](PRICE-LIB-UPDATES.md)
- [协作 SOP](MR2525模板库协作SOP.md) § 对外交付
- [NAS 部署](NAS-DEPLOY.md) — PDF 依赖说明

---

## 8. 未纳入

- 图册内搜索 / 筛选（仍展示全部已发布模板）
- 未登录公开分享链接（仍须登录后访问）
- BOM 超长自动续页（当前优先单页紧凑排版；若模板行数极多可能溢出，需再调字号或续页策略）
