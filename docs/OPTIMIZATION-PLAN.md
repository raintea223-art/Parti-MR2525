# MR2525 模板库 · 优化方案（v3.1）

> 状态：**已实施并部署 NAS（2026-05-28）**  
> 最后更新：2026-05-28（v3.1：型材出厂价默认参数修正为 rate=0.889、base=21）  
> 本文档汇总协作使用中的优化需求、已确认的产品决策与实现思路，**不含代码改动**。

---

## 目录

1. [背景与现状](#1-背景与现状)
2. [已确认的产品决策](#2-已确认的产品决策)
3. [优化项一览](#3-优化项一览)
4. [分项实现方案](#4-分项实现方案)
   - [4.1 状态机：废除「待建模」，统一为「待清单深化」](#41-状态机废除待建模统一为待清单深化)
   - [4.2 管理员删除模板](#42-管理员删除模板)
   - [4.3 文件与图片：拖拽上传优先](#43-文件与图片拖拽上传优先)
   - [4.4 报价清单 Tab 记忆](#44-报价清单-tab-记忆)
   - [4.5 板材连续添加：继承上一条规格](#45-板材连续添加继承上一条规格)
   - [4.6 「其他」类别：非标件录入与单价库同步](#46-其他类别非标件录入与单价库同步)
   - [4.7 六通 / 五金 / 板材：管理员手动输入](#47-六通--五金--板材管理员手动输入)
   - [4.8 非标件转移至五金配件（管理员）](#48-非标件转移至五金配件管理员)
   - [4.9 单价库变更 → 全库报价行同步](#49-单价库变更--全库报价行同步)
   - [4.10 单价库 · 型材计价公式（可配置）](#410-单价库--型材计价公式可配置)
   - [4.11 型材对内 / 对外价格关系修正](#411-型材对内--对外价格关系修正)
5. [数据模型变更摘要](#5-数据模型变更摘要)
6. [API 变更摘要](#6-api-变更摘要)
7. [实施顺序与风险](#7-实施顺序与风险)
8. [关联文档同步清单](#8-关联文档同步清单)

---

## 1. 背景与现状

| 模块 | 当前行为 | 问题 |
|------|----------|------|
| 登记模板 | SKP 上传后状态为 `pending_model`（「待建模」） | 实际上 SKP 已存在，建模已完成 |
| 状态机 | `待建模 → 待清单报价 → 待审核 → 已发布` | 「待建模」阶段多余 |
| 模板列表 | 无删除入口 | 误建模板无法清理 |
| 详情页上传 | 四个「点选文件」按钮 | 与新建页拖拽体验不一致 |
| 报价 Tab | 每次添加后 `openDetail()` 全量重渲染 | 默认回到「MR2525 型材」Tab |
| 板材添加 | 提交后表单完全重置 | 同规格连加需重复选材质/颜色/厚度 |
| 「其他」 | 走 `bom_lines`，固定类别枚举 | 不同步单价库；无法沉淀非标件 |
| 六通/五金/板材 | 只能从单价库下拉 | 管理员无法在录入时快速补新条目 |
| 单价库更新 | 仅更新 `price_items` 表 | 已引用该条目的模板报价行**不跟随变更** |
| 型材算价 | 公式硬编码于 `pricing.js`（`1.778`、`+42`） | 参数不可维护；模板报价未走单价库（见 §4.10） |
| 型材内外价 | `profileLineTotal` 内外价逻辑 | **对外 / 对内关系与业务规则不符**（见 §4.11） |

---

## 2. 已确认的产品决策

| # | 决策 | 说明 |
|---|------|------|
| D1 | **「待清单深化」= 原「待清单报价」** | 同一阶段，仅改显示文案；内部 key 可继续用 `pending_quote` |
| D2 | **彻底废除「待建模」** | 全流程不再出现该状态；SKP 登记后直接进入「待清单深化」 |
| D3 | **非标件重复录入：合并 + 确认** | 按「类别 + 项目 + 规格」匹配已有条目时，提示可能重复，询问是否更新单价 |
| D4 | **非标件可转移至五金配件** | 仅管理员，在单价库「非标件」Tab 操作 |
| D5 | **单价库改价 → 全库同步** | 凡通过 `price_item_id` 关联的报价行，单价随库更新 |
| D6 | **型材出厂价 = 对外报价的一半** | 对内成本按出厂价计；对外报价单价 = 出厂价 × 2 × 系数（见 §4.11） |
| D7 | **型材公式纳入单价库** | 出厂价 = `rate × 长度 + base`；`rate`（默认 **0.889**）与 `base`（默认 **21**）由管理员维护；模板报价清单实时调用单价库公式（见 §4.10） |

---

## 3. 优化项一览

| 优先级 | 编号 | 优化项 | 类型 |
|--------|------|--------|------|
| P0 | 4.1 | 状态机调整 | 后端 + 前端 + 迁移 |
| P0 | 4.10 | 单价库 · 型材公式（可配置） | 后端 + 单价库 UI + 算价链路 |
| P0 | 4.11 | 型材内外价修正 | 算价逻辑 + UI 文案 |
| P0 | 4.4 | 报价 Tab 记忆 | 前端 |
| P1 | 4.5 | 板材规格继承 | 前端 |
| P1 | 4.3 | 拖拽上传 | 前端 |
| P1 | 4.2 | 管理员删除模板 | 后端 + 前端 |
| P1 | 4.9 | 单价库变更同步 | 后端 |
| P2 | 4.6 | 非标件录入与单价库 | 后端 + 前端 + 新表 |
| P2 | 4.7 | 三分类管理员手动输入 | 后端 + 前端 |
| P2 | 4.8 | 非标件转移五金 | 后端 + 前端 |

---

## 4. 分项实现方案

### 4.1 状态机：废除「待建模」，统一为「待清单深化」

> 状态：**已实施**（2026-05-28）

#### 目标

SKP 登记完成即进入清单深化阶段；列表、详情、筛选、审核退回均不再出现「待建模」。

#### 状态定义（`constants.js`）

```
移除：pending_model / 「待建模」

保留 key：pending_quote
显示文案：「待清单深化」（取代原「待清单报价」）

新状态流：
  登记(SKP) ──→ 待清单深化 ──→ 待审核 ──→ 已发布 ↔ 已下架
                    ↑_______________|  （审核退回）
```

`STATUS_FLOW` 调整为：

| 当前状态 | 可流转至 |
|----------|----------|
| `draft`（若有） | `pending_quote` |
| `pending_quote` | `pending_review` |
| `pending_review` | `published`、`pending_quote` |
| `published` | `archived` |
| `archived` | `published` |

#### 后端

- `POST /api/templates/register`：INSERT 时 `status = 'pending_quote'`（现为 `pending_model`）
- `db.js`：`templates.status` 默认值改为 `pending_quote`
- 启动迁移：`UPDATE templates SET status = 'pending_quote' WHERE status = 'pending_model'`
- 审核退回 API：移除 `target_status = 'pending_model'`；仅允许退回 `pending_quote`

#### 前端

- 新建成功面板、列表 badge、筛选下拉、流程说明：显示「待清单深化」
- 审核页：删除「退回至待建模」按钮；「退回至待清单报价」改为「退回至待清单深化」
- CSS：移除 `.badge.pending_model`；`pending_quote` badge 文案更新

---

### 4.2 管理员删除模板

#### 目标

管理员在模板列表可删除条目；数据库关联数据与 `data/uploads/{template_code}/` 一并清除。

#### API

```
DELETE /api/templates/:id
权限：admin only
```

#### 删除逻辑（事务）

1. 读取 `template_code`
2. `DELETE FROM templates WHERE id = ?`  
   （`quote_profiles`、`quote_nuts`、`quote_hardware`、`quote_panels`、`bom_lines` 已有 `ON DELETE CASCADE`）
3. 递归删除 `data/uploads/{template_code}/` 目录
4. 返回 `{ ok: true, deleted_code }`

#### 前端

- 列表增加「操作」列；`role === 'admin'` 时显示「删除」
- 二次确认弹窗：展示编号 + 名称 + 「不可恢复」提示
- 已发布模板允许强制删除（admin 专属）

#### 安全

- API 与 UI 双重校验 admin 角色
- 编辑 / 只读账户不可见、不可调用

---

### 4.3 文件与图片：拖拽上传优先

#### 目标

详情页「文件与图片」与新建页一致：**拖拽为主、点选为辅**。

#### 实现

1. 抽取通用函数 `initDropZone({ container, accept, multiple, label, onFiles })`，复用现有 `.drop-zone` 样式（`styles.css` 已有完整样式）
2. 详情页替换现有 `.upload-row` 四个按钮，改为四个独立 drop-zone：

   | Drop-zone | accept | multiple | 对应 API |
   |-----------|--------|----------|----------|
   | 实拍照片 | `image/*` | ✓ | `POST .../upload/photo` |
   | 效果图 | `image/*` | ✓ | `POST .../upload/effect` |
   | 渲染图 | `image/*` | ✓ | `POST .../upload/render` |
   | 更新 SKP | `.skp` | ✗ | `POST .../upload/skp` |

3. 多文件拖拽：逐个调用现有 `uploadFile()`，toast 汇总结果
4. 上传成功后局部刷新 gallery，**不必**整页 `openDetail()`（减少 Tab 重置副作用）

---

### 4.4 报价清单 Tab 记忆

#### 问题根因

`renderDetail()` 写死「MR2525 型材」Tab 为 `active`；各分类提交成功后调用 `openDetail(id)` 导致 Tab 跳回型材。

#### 实现

1. 模块级变量 `activeQuoteTab`（默认 `profiles`）
2. 用户点击 Tab 时更新 `activeQuoteTab`
3. `renderDetail(t)` 根据 `activeQuoteTab` 设置对应 Tab / Panel 的 `active` class
4. 各 add / delete 成功后：`openDetail(id)` 前不重置 `activeQuoteTab`

#### 可选增强（二期）

局部刷新对应 table + `renderQuoteBreakdown`，避免整页闪烁。

---

### 4.5 板材连续添加：继承上一条规格

#### 目标

同一板材类型连加时，**材质 / 颜色 / 厚度 / 规格**沿用上一行，仅**长、宽**需手动填写。

#### 实现

1. 提交成功后保存 `lastPanelSelection`：

   ```js
   {
     material_type,
     color,
     thickness_mm,
     price_item_id,
     spec_label
   }
   ```

2. `setupPanelCascade()` 完成后，若存在 `lastPanelSelection`，程序化回填四级联动（赋值 + 启用控件）
3. 清空 `length_inch`、`width_inch`；数量默认 `1`
4. Toast：「已沿用上一行板材规格，请填写长宽」

---

### 4.6 「其他」类别：非标件录入与单价库同步

#### 目标

- 所有可写账户（admin + editor）可手动录入非标件
- 录入后自动写入单价库「非标件」
- 重复时合并并提示是否更新单价（**D3**）

#### 录入表单（「其他」Tab）

| 字段 | 规则 |
|------|------|
| 类别 | 下拉：型材 / 五金配件 / 其他 |
| 项目 | 必填，名称 |
| 规格 | 可选 |
| 单价 | 必填，> 0 |
| 数量 | 保留，默认 1 |

#### 新表：`price_items_custom`（非标件）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| source_category | TEXT | 型材 / 五金配件 / 其他 |
| item_name | TEXT NOT NULL | 项目名称 |
| spec | TEXT | 规格，可空 |
| unit | TEXT | 默认「个」 |
| unit_price | REAL NOT NULL | 对外单价 |
| unit_price_internal | REAL | 对内单价，默认同对外 |
| enabled | INTEGER | 1=启用 |
| created_by | TEXT | 录入人 display_name |
| merged_from_ids | TEXT | 可选，合并来源 id 列表（JSON） |
| created_at / updated_at | TEXT | |

**唯一性约束（逻辑层）：**  
`(source_category, item_name, spec)` 三元组视为同一非标件。规格为空与空字符串视为等价。

#### 重复合并流程（D3）

```
录入提交
  → 查询 price_items_custom 是否存在匹配三元组
  → 若不存在：INSERT 新条目 + INSERT bom_lines（关联 custom_price_item_id）
  → 若存在：
       前端弹窗：「已存在同名非标件（当前单价 ¥X），是否更新为 ¥Y？」
         [更新单价并添加] → UPDATE custom item 单价 + INSERT bom_lines
         [取消]           → 不写入
       若新单价与旧单价相同：跳过弹窗，直接 INSERT bom_lines
```

#### 模板侧存储

- `bom_lines` 增加列 `custom_price_item_id INTEGER REFERENCES price_items_custom(id)`
- 算价仍用行内 `unit_price`（写入时从 custom item 复制，便于历史追溯）

#### 单价库 UI

- 新增第 4 个 Tab：**「非标件」**
- 列表只读展示（所有账户可见）；admin 可编辑单价 / 禁用
- 导出 CSV 增加非标件 sheet 或合并段

---

### 4.7 六通 / 五金 / 板材：管理员手动输入

#### 目标

管理员在对应 Tab 除「从单价库选择」外，可手动输入新条目；**同时**在单价库生成标准条目并添加报价行。

#### UI

每个 Tab 增加模式切换（仅 admin 可见）：

- **从单价库选择**（默认，所有可写账户）
- **手动输入**（仅 admin）

手动表单字段对齐单价库维护表单：

| Tab | 字段 |
|-----|------|
| 六通 | 名称、型号、对外单价 |
| 五金配件 | 名称、规格、单位、对外单价 |
| 板材 | 材质、颜色、厚度、计价方式、单价 |

#### API（推荐：单事务）

扩展现有 POST 接口，支持 `manual: true`：

```
POST /api/templates/:id/nuts
POST /api/templates/:id/hardware
POST /api/templates/:id/panels

body: { manual: true, ...fields }
权限：manual 模式仅 admin；服务端校验
```

服务端在同一事务中：

1. `createPriceItem(...)` → `price_items`
2. INSERT 对应 `quote_*` 行，写入 `price_item_id` 与快照单价

#### 与非标件的边界

| 入口 | 写入表 | 单价库 Tab |
|------|--------|------------|
| 六通 / 五金 / 板材 · 管理员手动 | `price_items` | 六通 / 五金 / 板材 |
| 「其他」· 全员手动 | `price_items_custom` | 非标件 |

---

### 4.8 非标件转移至五金配件（管理员）

#### 目标

管理员在单价库「非标件」Tab 可将条目**升级**为标准五金配件（**D4**）。

#### 操作入口

非标件列表每行：`[转移至五金配件]` 按钮（admin only）

#### 转移流程

```
1. 管理员点击「转移至五金配件」
2. 弹窗预填：名称 ← item_name，规格 ← spec，单价 ← unit_price
   允许管理员微调
3. 确认后（事务）：
   a. INSERT price_items (category='hardware', ...)
   b. UPDATE price_items_custom SET enabled=0, note='已转移至 hardware #{new_id}'
   c. 可选：UPDATE bom_lines SET custom_price_item_id=NULL
      并标记 note 指向新 hardware price_item
   d. 不自动改已有模板的 quote_hardware（非标件走 bom_lines，不走 quote_hardware）
4. Toast：「已转移至五金配件，新条目可在五金 Tab 选取」
```

#### 说明

- 转移是**单价库层面**的标准化，不强制回溯改写历史 `bom_lines`
- 后续新模板可从五金配件 Tab 直接选取该条目
- 若需批量把历史 bom_lines 迁移到 quote_hardware，可作为二期增强

---

### 4.9 单价库变更 → 全库报价行同步

#### 目标

`price_items` 中条目价格更新后，**所有模板**中引用该 `price_item_id` 的报价行单价同步更新（**D5**）。

#### 现状问题

- `quote_nuts` / `quote_hardware` / `quote_panels` 在 INSERT 时将 `unit_price`、`price_per_sqm`、`fixed_unit_price` 等**快照**写入
- `PATCH /api/price-items/:id`（`updatePriceItem`）仅更新 `price_items`，**不传播**到报价行
- 导致单价库与模板详情显示不一致

#### 同步策略

在 `updatePriceItem` 成功后（或独立函数 `propagatePriceItemChange(db, priceItemId)`），按 category 批量 UPDATE：

| category | 同步目标表 | 更新字段 |
|----------|------------|----------|
| `nut` | `quote_nuts` | `unit_price` ← 新 `unit_price`；`item_name`、`nut_model` 若 label/model 变更也同步 |
| `hardware` | `quote_hardware` | `unit_price`、`item_name`、`spec` |
| `panel` | `quote_panels` | `price_per_sqm` / `fixed_unit_price`（按 `pricing_mode`）、`material_name` 等展示字段 |

匹配条件：`WHERE price_item_id = ?`

#### 非标件同步

`price_items_custom` 更新单价时，同步：

```sql
UPDATE bom_lines SET unit_price = ?
WHERE custom_price_item_id = ?
```

#### 事务与日志

- 与 `updatePriceItem` 同一事务执行
- 返回受影响行数：`{ updated, quote_nuts: n, quote_hardware: n, quote_panels: n, bom_lines: n }`
- 前端 toast：「单价已更新，已同步 N 个模板的报价行」

#### 边界

| 场景 | 处理 |
|------|------|
| 仅改 `unit_price_internal`（对内） | 不同步报价行快照（对外单价未变）；对内成本在 `computeQuoteSummary` 时从 price_item 实时读取 |
| 禁用条目（`enabled=0`） | 不删除已有报价行；下拉不再展示 |
| 删除条目 | 现有逻辑：报价行保留快照，`price_item_id` 可能 dangling；建议改为禁止删除已被引用的条目，或软删除 |

#### 型材：公式参数变更 → 全库自动生效

型材（`quote_profiles`）**不存单价快照**，只存 `length_inch / qty / coefficient`。  
出厂价在读取时由单价库公式实时计算，因此管理员修改 `rate` 或 `base` 后，**所有模板参考价自动更新**，无需像六通/五金/板材那样逐行 UPDATE（见 §4.10）。

---

### 4.10 单价库 · 型材计价公式（可配置）

#### 目标（D7）

1. 型材**出厂价（对内）**公式：**`rate × 型材长度(in) + base`**
2. **`rate`（默认 0.889）** 与 **`base`（默认 21）** 由管理员在单价库中维护
3. 模板「详细报价清单」中 MR2525 型材行的价格**统一从单价库读取公式**计算，不再硬编码于 `pricing.js`

#### 公式定义

```
出厂价（对内）= ROUNDUP(长度(in) × rate + base, 0)
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `rate` | **`0.889`** | 出厂价长度系数（元/in） |
| `base` | **`21`** | 出厂价固定加项（元） |

> **取整规则：** 业务公式为 `rate × 长度 + base`；金额展示与算价沿用 **`ROUNDUP(…, 0)` 向上取整至元**。  
> **与对外价的关系：** 在默认倍率 `external_multiplier = 2` 下，对外报价等价于 `ROUNDUP(长度 × rate×2 + base×2, 0)`，即 **`ROUNDUP(长度 × 1.778 + 42, 0)`**——与旧版硬编码对外公式一致；单价库维护的是**出厂价侧**参数（0.889 / 21），而非对外侧参数。  
> 上线时在 `pricing_profile_formula` 初始化/迁移脚本中写入 `rate = 0.889`、`base = 21`。

对外报价关系见 §4.11（出厂价 × 2 × 系数）。

#### 数据模型

新增单例配置表（全局唯一一份型材公式，非逐条 price_item）：

```sql
CREATE TABLE pricing_profile_formula (
  id INTEGER PRIMARY KEY CHECK (id = 1),   -- 强制单例
  rate REAL NOT NULL DEFAULT 0.889,
  base REAL NOT NULL DEFAULT 21,
  external_multiplier REAL NOT NULL DEFAULT 2,  -- 对外倍率，配合 §4.11
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);
```

启动时若不存在则 `INSERT` 默认值 `(1, 0.889, 21, 2)`。

#### 单价库 UI

在侧边栏 **单价库** 增加 **「型材」** Tab（置于首位，与 MR2525 型材在报价清单中的优先级一致）：

| 区域 | 内容 |
|------|------|
| 公式说明 | 动态展示：`出厂价 = ROUNDUP(长度 × {rate} + {base}, 0)`（默认 0.889 / 21）；对外单价 = 出厂价 × 2 × 系数 |
| 可编辑字段 | `rate`（数字，步进 0.001）、`base`（数字，步进 1）— **仅管理员** |
| 试算预览 | 输入示例长度(in) → 实时显示出厂价 / 对外单价（系数=1） |
| 保存 | `[保存公式]` → PATCH API；toast 提示「已更新，所有模板型材报价将按新公式计算」 |

只读账户（editor / viewer）可查看公式与试算，不可编辑。

#### 算价链路（模板报价清单直接调用单价库）

```
GET /api/meta 或 GET /api/pricing/profile-formula
        ↓
  pricing_profile_formula { rate, base, external_multiplier }
        ↓
  profileFactoryPrice(length, formula)     ← 唯一公式入口
        ↓
  profileLineTotal(length, qty, coeff, formula)
        ↓
  computeQuoteSummary / 模板详情 / CSV 导出 / 预览 API
```

**改造要点：**

| 调用点 | 改动 |
|--------|------|
| `src/pricing.js` · `profileFactoryPrice` | 签名改为 `(lengthInch, { rate, base })`；移除硬编码 `0.889` / `21`（及旧版 `1.778` / `42`） |
| `src/db.js` · `buildQuoteSummary` | 读取 formula 后传入 `computeQuoteSummary` |
| `GET /api/pricing/preview-profile` | 读取单价库 formula 再预览 |
| `public/app.js` · 型材添加预览 | 调用 preview API（已含最新 formula） |
| `public/app.js` · 详情页 formula-hint | 由 meta 动态渲染，展示当前 `rate` / `base` |
| `public/index.html` · 单价库 Tabs | 增加「型材」Tab |

**原则：** 禁止在前端或 `pricing.js` 中硬编码 `0.889` / `21`（或对外侧 `1.778` / `42`）；所有型材单价必须经 `getProfileFormula(db)` 取得参数后计算。

#### API

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/pricing/profile-formula` | 已登录 | 返回 `{ rate, base, external_multiplier, updated_at, updated_by }` |
| PATCH | `/api/pricing/profile-formula` | admin | 更新 `rate` / `base`；校验 `rate > 0` |
| GET | `/api/meta` | 已登录 | 增加 `profileFormula` 字段，供详情页 hint 与试算 |

#### 与 §4.9 单价同步的关系

| 类别 | 存储方式 | 单价库变更后 |
|------|----------|--------------|
| 六通 / 五金 / 板材 | 报价行存快照 + `price_item_id` | 需 propagate 同步（§4.9） |
| **型材** | 报价行只存长度 / 数量 / 系数 | **无需同步**；改 formula 后下次读取自动重算 |

#### 验证用例（默认 rate=0.889, base=21）

| 长度(in) | 计算过程（出厂价） | 出厂价 | 系数 | 对外单价（×2） |
|----------|-------------------|--------|------|----------------|
| 31.1 | 31.1×0.889+21=48.65 → ⌈⌉ | **49** | 1 | 98 |
| 31.1 | 同上 | 49 | 1.5 | 147 |
| 10 | 10×0.889+21=29.89 → ⌈⌉ | **30** | 1 | 60 |

> 长度 31.1、系数 1 时对外单价 **98**，与旧版 `ROUNDUP(31.1×1.778+42)` 一致；修正的是内外价角色划分，而非对外报价数值。

---

### 4.11 型材对内 / 对外价格关系修正

#### 业务规则（D6）

在 §4.10 单价库公式得出**出厂价（对内）**之后：

```
对外报价单价   = 出厂价 × external_multiplier × 系数   （external_multiplier 默认 2）
对内成本小计   = 数量 × 出厂价
对外报价小计   = 数量 × 对外报价单价
```

**核心关系：出厂价（对内）= 对外报价单价 ÷ 2**（当系数 = 1、倍率 = 2 时）。

#### 现状问题（`src/pricing.js` · `profileLineTotal`）

当前实现：

```js
factory         = ROUNDUP(len × 1.778 + 42)   // 硬编码；实际应对内用 0.889×len+21
externalUnit    = factory × coefficient        // 缺少 ×2 对外倍率
external=true   → unit_price = externalUnit
external=false  → unit_price = externalUnit × 0.5  // 对内多除了一半
```

当系数 = 1 时：

| 项目 | 当前值 | 应为 |
|------|--------|------|
| 出厂价（对内） | `factory × 0.5` | `factory`（来自单价库公式） |
| 对外报价单价 | `factory` | `factory × 2` |
| 对外小计 | 按 `factory` 计 | 按 `factory × 2` 计 |

#### 修正方案

```js
function profileLineTotal(lengthInch, qty, { external = true, coefficient = 1, formula } = {}) {
  const factory = profileFactoryPrice(lengthInch, formula);
  const mult = formula.external_multiplier ?? 2;
  const externalUnit = factory * mult * Number(coefficient || 1);
  const unitPrice = external ? externalUnit : factory;
  const q = Number(qty) || 0;
  return {
    length_inch: Number(lengthInch),
    qty: q,
    coefficient: Number(coefficient || 1),
    factory_price: factory,
    quote_unit: externalUnit,
    external_unit: externalUnit,
    unit_price: unitPrice,
    subtotal: q * unitPrice
  };
}
```

#### 连带修改

| 位置 | 改动 |
|------|------|
| `pricing-catalog.js` / `constants.js` · `PROFILE_FORMULA_NOTE` | 动态：`ROUNDUP(长度×{rate}+{base})`；对外 = 出厂价×2×系数 |
| `README.md` · 参考价计算 | 公式来源改为单价库；出厂价默认 rate=0.889、base=21 |
| `public/app.js` · 型材预览 | 出厂 X → 单价 Y，Y = X × 2 × 系数 |
| `server.js` · CSV 导出 | 型材行对齐新公式 |
| 已有模板数据 | **无需迁移**（`quote_profiles` 只存 length/qty/coefficient） |

#### 验证用例（rate=0.889, base=21）

| 长度(in) | 出厂价 | 系数 | 对外单价 | 数量 | 对外小计 | 对内小计 |
|----------|--------|------|----------|------|----------|----------|
| 31.1 | 49 | 1 | 98 | 2 | 196 | 98 |
| 31.1 | 49 | 1.5 | 147 | 1 | 147 | 49 |

---

## 5. 数据模型变更摘要

| 变更 | 说明 |
|------|------|
| `templates.status` 默认值 | `'pending_quote'` |
| 迁移 | `pending_model` → `pending_quote` |
| 新表 `price_items_custom` | 非标件单价库 |
| 新表 `pricing_profile_formula` | 型材公式单例（`rate`, `base`, `external_multiplier`） |
| `bom_lines.custom_price_item_id` | 关联非标件 |

---

## 6. API 变更摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/pricing/profile-formula` | 读取型材公式参数 |
| PATCH | `/api/pricing/profile-formula` | 管理员更新 `rate` / `base` |
| DELETE | `/api/templates/:id` | 管理员删除模板 |
| POST | `/api/templates/register` | 初始状态改为 `pending_quote` |
| POST | `/api/templates/:id/audit/reject` | 移除 `pending_model` 目标 |
| PATCH | `/api/price-items/:id` | 增加报价行传播逻辑 |
| PATCH | `/api/price-items/custom/:id` | 新增：非标件更新 + bom_lines 同步 |
| POST | `/api/price-items/custom` | 新增：非标件创建（含重复检测） |
| POST | `/api/price-items/custom/:id/promote` | 新增：转移至五金配件 |
| POST | `/api/templates/:id/nuts` 等 | 扩展 `manual: true`（admin） |
| POST | `/api/templates/:id/bom` | 扩展非标件录入 + 重复确认流程 |

---

## 7. 实施顺序与风险

### 推荐顺序

```
Phase 1（基础正确性 · 型材）
  4.10 单价库型材公式（表 + API + 单价库 Tab）
  4.11 型材内外价修正 + 算价链路改读单价库
  4.1  状态机调整 + 数据迁移

Phase 2（录入体验）
  4.4  Tab 记忆
  4.5  板材规格继承
  4.3  拖拽上传

Phase 3（管理能力）
  4.2  管理员删除模板
  4.9  单价库变更同步（六通/五金/板材/非标件）

Phase 4（非标件体系）
  4.6  非标件录入与单价库
  4.7  三分类管理员手动输入
  4.8  非标件转移五金
```

### 风险与注意

| 风险 | 缓解 |
|------|------|
| 型材内外价角色修正后，对外报价数值应与旧版对齐（默认参数下） | 上线前用试算对比（如 31.1in → 对外 98）；`quote_profiles` 无快照，打开即新价 |
| 管理员误改 `rate`/`base` 影响全库 | 单价库试算预览 + 保存确认；记录 `updated_by` / `updated_at` |
| 单价库同步误改历史报价 | 同步前返回受影响模板数；仅改对外字段；可考虑 admin 确认框 |
| 删除模板误操作 | 二次确认 + 仅 admin |
| 非标件合并误更新单价 | 弹窗明确展示旧价 / 新价，默认「取消」 |
| 非标件转移后历史 bom_lines 仍引用 custom id | 转移后 custom item 置 `enabled=0` 但保留记录；bom_lines 仍可读 |

---

## 8. 关联文档同步清单

实施完成后需同步更新：

- [ ] `docs/MR2525模板库协作SOP.md` — 状态说明、型材公式来源改为单价库
- [ ] `docs/WORKFLOW.md` — Mermaid 状态机
- [ ] `docs/FEISHU-SETUP.md` — 飞书状态枚举；单价库增加型材公式说明
- [ ] `README.md` — 参考价计算、单价库 Tab 说明（含型材公式）
- [ ] `data/feishu/单价库.csv` — 可增加型材公式参数行或单独说明 sheet

---

## 附录：当前代码锚点

| 文件 | 相关位置 |
|------|----------|
| `src/constants.js` | `STATUSES`、`STATUS_LABELS`、`PROFILE_FORMULA_NOTE`（改为动态） |
| `src/pricing.js` | `profileFactoryPrice`、`profileLineTotal` — 改读 formula 参数 |
| `src/db.js` | 新增 `pricing_profile_formula`；`buildQuoteSummary` 传入 formula |
| `src/server.js` | `/api/templates/register` L268；`/api/pricing/preview-profile`；新增 profile-formula API |
| `src/price-items.js` | `updatePriceItem`（需加传播，型材不在此列） |
| `public/app.js` | `renderDetail` 型材 hint / 预览；单价库增加「型材」Tab |
| `public/index.html` | L101 单价库 Tabs；L49–65（drop-zone 参考） |

---

*本文档随需求确认迭代；开发时以本文档为准，完成后勾选 §8 同步清单。*
