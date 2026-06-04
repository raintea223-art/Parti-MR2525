/**
 * Patch documentation for panel multi-color Phase 1.
 * Run: node scripts/patch-docs-panel-multi-color.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function write(rel, s) {
  fs.writeFileSync(path.join(ROOT, rel), s, "utf8");
  console.log("updated", rel);
}

const SECTION_17 = `

---

## 17. 2026-06-04 · 板材一条目多色

> **Phase 1 已实施。** 参考价「可定制」区间算法（按同色厚异色取 max）为 **Phase 2**，本期未改 \`computeQuoteSummary\`。

### 17.1 产品约定

| 概念 | 定义 |
|------|------|
| **价库板材条目** | 一条 = 材质 + 厚度(mm) + 计价方式 + 对外价 + 对内价 + 供应商（**同色厚同价**） |
| **可选颜色** | 挂在该条目下，多个 \`{ 颜色名, color_hex }\`；**同条目内价格相同** |
| **模板 BOM 行** | 引用 \`price_item_id\` + 本行 **标配色** \`quote_panels.color\` |
| **行内可选色** | = 该 \`price_item_id\` 下 **全部颜色**（无 per-line 子集） |
| **展示名称 \`label\`** | \`材质 · 厚度mm\`（**不含颜色**）；列表「颜色」列为多色块 |

### 17.2 数据模型

**新表 \`price_item_panel_colors\`**

| 字段 | 类型 | 说明 |
|------|------|------|
| \`price_item_id\` | INTEGER FK | 指向 \`price_items.id\`，CASCADE 删除 |
| \`color\` | TEXT | 颜色名（如 白色、透明） |
| \`color_hex\` | TEXT | RGB 或 \`transparent\` |
| \`sort_order\` | INTEGER | 展示顺序 |

唯一约束：\`(price_item_id, color)\`。

**去重键（板材条目，不含颜色）**

\`material_type\` + \`thickness_mm\` + \`pricing_mode\` + \`unit_price\` + \`unit_price_internal\` + \`supplier\`

**迁移 \`panel_multi_color_v1\`**

1. 启动时自动：旧 \`price_items.color\` 回填子表；同色厚同价多行合并为一条并重绑 \`quote_panels.price_item_id\`
2. 同名颜色、不同 \`color_hex\` 的合并组 → **跳过**，需人工处理
3. 价库 Tab：**合并重复板材**（预览 + 确认）与自动迁移规则一致

### 17.3 单价库 UI

| 操作 | 说明 |
|------|------|
| 添加板材 | 填材质、厚度、计价、价、供应商；**颜色列表**（chip，可多个） |
| 列表 | 「颜色」列展示多色标签；\`label\` 为 \`材质 · 厚度mm\` |
| CSV | **一行多色**：\`颜色\` 用分号，如 \`白色;木色;砂面黑\`；\`颜色HEX\` 可对应分号分隔 |
| CSV 重复 | 与已有**同条目键** → **合并追加颜色**（非覆盖整行）；仍支持单行覆盖价字段 |
| 合并按钮 | **合并重复板材** → \`GET/POST .../panel/merge-*\` |

### 17.4 模板详情 · 板材 BOM

**级联顺序：** 材质 → 厚度 → 规格（价库条目，含供应商提示）→ **颜色**

| 操作 | 说明 |
|------|------|
| 添加行 | \`POST .../panels\` 传 \`price_item_id\` + \`color\` + 长宽 + 数量 |
| 改色 | 已有行表格内下拉 → \`PATCH /api/panels/:lineId\` \`{ color }\` |
| 改价库价 | 传播更新单价/材质/厚度/\`label\`；**不覆盖** BOM 行上的 \`color\` |

### 17.5 API 补充

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | \`/api/price-items/panel/merge-preview\` | 预览可合并组与 HEX 冲突 |
| POST | \`/api/price-items/panel/merge-run\` | 执行合并 |
| PATCH | \`/api/panels/:lineId\` | 仅改板材行颜色 |
| POST | \`/api/price-items\` | 板材支持 \`colors: [{ color, color_hex }, ...]\` |
| GET | \`/api/price-items/panel-filters\` | 每条 \`panel\` 带 \`colors[]\` |

### 17.6 代码位置

| 文件 | 职责 |
|------|------|
| \`src/panel-price-colors.js\` | 子表、迁移、合并、颜色解析 |
| \`src/price-items.js\` | CRUD、CSV、\`getPanelFilters\`、传播（不含 color） |
| \`src/server.js\` | 路由与校验 |
| \`public/app.js\` | 价库多色表单、级联、BOM 改色 |
| \`public/styles.css\` | \`.panel-price-colors-chips\` 等 |

### 17.7 与 SOP 的对应

- [MR2525模板库协作SOP](MR2525模板库协作SOP.md) §3、§11 已按「一条目多色」更新说明。
- **可定制 = 开** 时参考价区间仍依赖 Phase 2；本期同色同价下 min/max 通常相同。

`;

function patchPriceLib() {
  let s = read("docs/PRICE-LIB-UPDATES.md");
  if (!s.includes("## 17. 2026-06-04")) {
    s = s.replace(
      "> 实施日期：2026-05-28 — 2026-05-31",
      "> 实施日期：2026-05-28 — 2026-06-04"
    );
    if (!s.includes("板材多色合并见")) {
      s = s.replace(
        "> 状态：**已实施**",
        "> 状态：**已实施**（板材多色合并见 [§17](#17-2026-06-04--板材一条目多色)）"
      );
    }
    s = s.replace(
      "**重复判定：** 同 `材质 + 颜色 + 厚度_mm` 视为重复行",
      "**重复判定（2026-06-04 前）：** 同 `材质 + 颜色 + 厚度_mm` → **现：** 同条目键（不含颜色），颜色在子表；见 [§17](#17-2026-06-04--板材一条目多色)"
    );
    if (s.includes("| 板材 | 单价、名称、材质等，`propagatePriceItemChange` |")) {
      s = s.replace(
        "| 板材 | 单价、名称、材质等，`propagatePriceItemChange` |",
        "| 板材 | 单价、名称、材质、厚度等；**不同步** `quote_panels.color` |"
      );
    }
    const apiTable = "| PATCH | `/api/pricing/profile-formula` | 管理员更新公式 |";
    if (s.includes(apiTable) && !s.includes("panel/merge-preview")) {
      s = s.replace(
        apiTable,
        `${apiTable}
| GET | \`/api/price-items/panel/merge-preview\` | 预览板材重复条目合并 |
| POST | \`/api/price-items/panel/merge-run\` | 执行合并 |
| PATCH | \`/api/panels/:lineId\` | 修改模板板材 BOM 行颜色 |`
      );
    }
    const filesTable = "| `data/feishu/板材单价库-导入模板.csv` | 新建 |";
    if (s.includes(filesTable) && !s.includes("panel-price-colors.js")) {
      s = s.replace(
        filesTable,
        `${filesTable}
| \`src/panel-price-colors.js\` | **新建** 板材多色子表与迁移 |
| \`price_item_panel_colors\` | **新建** 表（迁移创建） |`
      );
    }
    s = s.replace(
      "| 2026-05-31 | 五金列宽与添加栏 UI（§15）；全局 UI 见 `app.js` 重构与 [UI-UPDATES-20260531](UI-UPDATES-20260531.md) |",
      `| 2026-05-31 | 五金列宽与添加栏 UI（§15）；全局 UI 见 [UI-UPDATES-20260531](UI-UPDATES-20260531.md) |
| 2026-06-04 | 板材一条目多色（§17）；CSV 合并导入；BOM 行内改色 |`
    );
    s += SECTION_17;
  }
  write("docs/PRICE-LIB-UPDATES.md", s);
}

function patchReadme() {
  let s = read("README.md");
  if (s.includes("一条目多色")) return;
  const oldBlock =
    "### 板材\n- 面积(㎡) = 长(mm) × 宽(mm) / 10⁶，边长由 inch × 25.4 换算\n- 按㎡计价：件单价 = 面积 × ㎡单价；固定件价：直接填件单价\n- 小计 = 数量 × 件单价\n- **同一模板可添加多种板材**";
  const newBlock =
    oldBlock +
    "（不同材质/厚度可多行）\n- **单价库**：同色厚同价的多色合并为 **一条价库条目**；模板每行选 **标配颜色**（详见 [单价库 §17](docs/PRICE-LIB-UPDATES.md#17-2026-06-04--板材一条目多色)）";
  s = s.replace(oldBlock, newBlock);
  s = s.replace(
    "| **板材** | 材质、颜色（RGB / **透明**）、厚度、计价、**供应商（必填）**、CSV 批量导入 |",
    "| **板材** | 材质、厚度、计价、供应商；**一条目多色**（RGB / **透明**）；CSV（支持分号多色）；合并重复条目 |"
  );
  s = s.replace(
    "板材颜色支持 **透明**（`color_hex=transparent`，无 RGB）。五金/板材改价后，已引用模板的报价行自动同步。",
    "板材颜色支持 **透明**（color_hex=transparent）。改价后同步单价与规格字段，**不覆盖** BOM 行已选颜色。五金/板材改价后，已引用模板的报价行自动同步。"
  );
  write("README.md", s);
}

function patchSop() {
  let s = read("docs/MR2525模板库协作SOP.md");
  if (s.includes("price_item_panel_colors")) return;
  s = s.replace(
    "**板材键**：材质类型 + 厚度(mm) + 颜色 — 每个组合一条记录。",
    `**板材条目（价库）**：材质类型 + 厚度(mm) + 计价 + 对内/对外价 + 供应商 — **一条记录**。

**板材颜色**：挂在该条目下（表 \`price_item_panel_colors\`），可多个；**同条目内同价**。模板 BOM 每行选其中一个颜色作为 **标配色**（\`quote_panels.color\`），可选范围 = 该条目全部颜色。`
  );
  s = s.replace(
    "- **皮肤选配说明**中引用的可选颜色，必须已在单价库中存在（同材质、同厚度）。",
    "- 模板 BOM 行引用的价库条目下，**标配色与升级可选色**均须已在该条目的颜色列表中维护。"
  );
  s = s.replace(
    "6. 录入 **板材 BOM**（一行或多行）：\n   - 每行：材质类型、厚度、**标配颜色**、长宽（inch）、数量",
    `6. 录入 **板材 BOM**（一行或多行）：\n   - 级联：材质 → 厚度 → 价库规格 → **颜色** → 长宽（inch）、数量\n   - 每行保存：价库条目 ID + **标配颜色**（与材质/厚度一致）`
  );
  const verTable = "| v1.9 | 2026-05-29 | 型材颜色";
  if (s.includes(verTable) && !s.includes("v2.0")) {
    s = s.replace(
      verTable,
      `| v2.0 | 2026-06-04 | 板材价库一条目多色；BOM 行内改色；见 [PRICE-LIB-UPDATES §17](PRICE-LIB-UPDATES.md#17-2026-06-04--板材一条目多色) |\n${verTable}`
    );
  }
  write("docs/MR2525模板库协作SOP.md", s);
}

function patchArchitecture() {
  let s = read("architecture.md");
  if (s.includes("price_item_panel_colors")) return;
  s = s.replace(
    "| `price_items` | 六通(nut) / 五金(hardware) / 板材(panel)；含对内/对外价、供应商、链接 |",
    "| `price_items` | 六通(nut) / 五金(hardware) / 板材(panel)；含对内/对外价、供应商、链接 |\n| `price_item_panel_colors` | 板材条目下的多色（color、color_hex）；FK → price_items |"
  );
  s = s.replace(
    "- **改价传播**：PATCH `price_items` 后，已引用行的 `unit_price` 自动同步",
    "- **改价传播**：PATCH `price_items` 后，已引用行单价等自动同步；板材 **不覆盖** `quote_panels.color`"
  );
  if (s.includes("#### 单价库 `/api/price-items/*`")) {
    s = s.replace(
      "- **板材 CSV 批量导入**：管理员专用接口",
      "- **板材 CSV 批量导入**：支持分号多色、同条目合并颜色\n- **板材多色**：`panel-price-colors.js`；`GET/POST .../panel/merge-*`；`PATCH /api/panels/:lineId`"
    );
  }
  write("architecture.md", s);
}

function patchWorkflow() {
  const rel = "docs/WORKFLOW.md";
  if (!fs.existsSync(path.join(ROOT, rel))) return;
  let s = read(rel);
  if (s.includes("一条目多色")) return;
  if (s.includes("PRICE-LIB-UPDATES")) {
    s = s.replace(
      "- 单价库（型材颜色、五金/板材）— `docs/PRICE-LIB-UPDATES.md`",
      "- 单价库（型材颜色、五金/板材、**板材一条目多色**）— [PRICE-LIB-UPDATES.md](PRICE-LIB-UPDATES.md) §17"
    );
    write(rel, s);
  }
}

patchPriceLib();
patchReadme();
patchSop();
patchArchitecture();
patchWorkflow();
console.log("docs patch done");
