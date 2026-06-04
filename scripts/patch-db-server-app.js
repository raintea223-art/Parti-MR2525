/**
 * Patch db.js, server.js, app.js for panel Phase 1
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function write(rel, s) {
  fs.writeFileSync(path.join(ROOT, rel), s, "utf8");
  console.log("wrote", rel);
}

function patchDb() {
  let s = read("src/db.js");
  if (!s.includes("migratePanelMultiColor")) {
    s = s.replace(
      'const {\n  getPriceItem,\n  enrichPanelLine,',
      'const {\n  getPriceItem,\n  enrichPanelLine,'
    );
    s = s.replace(
      '} = require("./price-items");',
      `} = require("./price-items");
const { migratePanelMultiColor } = require("./panel-price-colors");`
    );
    s = s.replace(
      "  const { initVersionLogSchema } = require(\"./version-log\");\n  initVersionLogSchema(db);\n}",
      `  const { initVersionLogSchema } = require("./version-log");
  initVersionLogSchema(db);

  try {
    migratePanelMultiColor(db);
  } catch (err) {
    console.error("[panel-multi-color migration]", err.message);
  }
}`
    );
    s = s.replace(
      "      enrichPanelLine(row, row.price_item_id ? getPriceItem(db, row.price_item_id) : null)",
      "      enrichPanelLine(row, row.price_item_id ? getPriceItem(db, row.price_item_id) : null, db)"
    );
    write("src/db.js", s);
  }
}

function patchServer() {
  let s = read("src/server.js");
  if (!s.includes("previewMergePanelDuplicates")) {
    s = s.replace(
      "  importPanelCsv\n} = require(\"./price-items\");",
      `  importPanelCsv,
  findPanelEntry
} = require("./price-items");
const {
  previewMergePanelDuplicates,
  executePanelMerge,
  colorAllowedOnItem,
  normalizeColorsInput
} = require("./panel-price-colors");`
    );
  }

  if (!s.includes("panel/merge-preview")) {
    const insertAfter = `app.get("/api/price-items/panel-filters", ...readAuth, (_req, res) => {
  res.json(getPanelFilters(db));
});`;
    const block = `${insertAfter}

app.get("/api/price-items/panel/merge-preview", ...priceAdmin, (_req, res) => {
  res.json(previewMergePanelDuplicates(db));
});

app.post("/api/price-items/panel/merge-run", ...priceAdmin, (_req, res) => {
  try {
    const result = executePanelMerge(db);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});`;
    s = s.replace(insertAfter, block);
  }

  if (!s.includes("patchPanelLine")) {
    const panelPost = `app.post("/api/templates/:id/panels", ...writeAuth, (req, res) => {`;
    const patchRoute = `app.patch("/api/panels/:lineId", ...writeAuth, (req, res) => {
  if (!guardEditableQuoteLine(db, "quote_panels", req.params.lineId, res)) return;
  const { color } = req.body || {};
  if (!color?.trim()) return res.status(400).json({ error: "请选择颜色" });
  const row = db.prepare("SELECT * FROM quote_panels WHERE id = ?").get(req.params.lineId);
  if (!row) return res.status(404).json({ error: "记录不存在" });
  if (!row.price_item_id) return res.status(400).json({ error: "该行无单价库引用" });
  const item = getPriceItem(db, row.price_item_id);
  if (!item || item.category !== "panel") {
    return res.status(400).json({ error: "无效的板材单价项" });
  }
  if (!colorAllowedOnItem(db, row.price_item_id, color.trim())) {
    return res.status(400).json({ error: "该颜色不在单价库条目可选范围内" });
  }
  db.prepare("UPDATE quote_panels SET color = ? WHERE id = ?").run(color.trim(), req.params.lineId);
  const updated = db.prepare("SELECT * FROM quote_panels WHERE id = ?").get(req.params.lineId);
  res.json(enrichPanelLine(updated, item, db));
});

`;
    s = s.replace(panelPost, patchRoute + panelPost);
  }

  // POST panels: add color validation
  if (!s.includes("colorAllowedOnItem(db, price_item_id")) {
    s = s.replace(
      `  } else {
    if (!price_item_id) return res.status(400).json({ error: "请从单价库选择板材规格" });
    item = getPriceItem(db, price_item_id);
    if (!item || item.category !== "panel") {
      return res.status(400).json({ error: "无效的板材单价项" });
    }
  }

  const pricing = resolvePanelPricing(item);
  const sort = nextSortOrder(db, "quote_panels", templateId);
  const result = db
    .prepare(
      \`INSERT INTO quote_panels (
        template_id, price_item_id, material_type, color, thickness_mm, material_name,
        length_inch, width_inch, qty, pricing_mode, price_per_sqm, fixed_unit_price, note, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`
    )
    .run(
      templateId,
      item.id,
      item.material_type,
      item.color,
      item.thickness_mm,
      item.label,`,
      `  } else {
    const { color: panelColor } = req.body;
    if (!price_item_id) return res.status(400).json({ error: "请从单价库选择板材规格" });
    if (!panelColor?.trim()) return res.status(400).json({ error: "请选择颜色" });
    item = getPriceItem(db, price_item_id);
    if (!item || item.category !== "panel") {
      return res.status(400).json({ error: "无效的板材单价项" });
    }
    if (!colorAllowedOnItem(db, price_item_id, panelColor.trim())) {
      return res.status(400).json({ error: "该颜色不在单价库条目可选范围内" });
    }
  }

  const pricing = resolvePanelPricing(item);
  const lineColor = manual ? item.color : (req.body.color || "").trim();
  const sort = nextSortOrder(db, "quote_panels", templateId);
  const result = db
    .prepare(
      \`INSERT INTO quote_panels (
        template_id, price_item_id, material_type, color, thickness_mm, material_name,
        length_inch, width_inch, qty, pricing_mode, price_per_sqm, fixed_unit_price, note, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`
    )
    .run(
      templateId,
      item.id,
      item.material_type,
      lineColor,
      item.thickness_mm,
      item.label,`
    );
    s = s.replace(
      "  res.status(201).json(enrichPanelLine(row, item));",
      "  res.status(201).json(enrichPanelLine(row, item, db));"
    );
  }

  if (!s.includes('colors: normalizeColorsInput')) {
    s = s.replace(
      `      material_type,
      color,
      color_hex,
      thickness_mm,
      link,
      supplier: supplier?.trim() || "",
      note
    })
  );`,
      `      material_type,
      color,
      color_hex,
      colors: body.colors,
      thickness_mm,
      link,
      supplier: supplier?.trim() || "",
      note
    })
  );`
    );
  }

  // manual create panel with colors
  s = s.replace(
    `    item = createPriceItem(db, {
      category: "panel",
      label: label?.trim() || \`\${material_type} · \${color} · \${thickness_mm}mm\`,
      material_type,
      color,
      thickness_mm: Number(thickness_mm),
      unit_price,
      pricing_mode: pricing_mode || "per_sqm",
      unit: "块"
    });`,
    `    item = createPriceItem(db, {
      category: "panel",
      label: label?.trim() || buildPanelLabel(material_type, Number(thickness_mm)),
      material_type,
      colors: normalizeColorsInput({ color, color_hex: req.body.color_hex }),
      thickness_mm: Number(thickness_mm),
      unit_price,
      pricing_mode: pricing_mode || "per_sqm",
      unit: "块",
      supplier: req.body.supplier || ""
    });`
  );

  if (!s.includes('buildPanelLabel')) {
    s = s.replace(
      "  findPanelEntry\n} = require(\"./price-items\");",
      `  findPanelEntry
} = require("./price-items");
const { buildPanelLabel } = require("./panel-price-colors");`
    );
  }

  write("src/server.js", s);
}

function patchApp() {
  let s = read("public/app.js");
  // panel add form order: mat, thick, spec, color
  if (!s.includes("panel-entry")) {
    s = s.replace(
      `<label>材质<select name="material_type" id="panel-mat" required><option value="">选择材质…</option>\${materialOptions}</select></label>
            <label>颜色<select name="color" id="panel-color" required disabled><option value="">先选材质</option></select></label>
            <label>厚度<select name="thickness" id="panel-thick" required disabled><option value="">先选颜色</option></select></label>
            <input type="hidden" name="price_item_id" id="panel-price-id" />
            <label>规格<select id="panel-spec" required disabled><option value="">先选厚度</option></select></label>`,
      `<label>材质<select name="material_type" id="panel-mat" required><option value="">选择材质…</option>\${materialOptions}</select></label>
            <label>厚度<select name="thickness" id="panel-thick" required disabled><option value="">先选材质</option></select></label>
            <input type="hidden" name="price_item_id" id="panel-price-id" />
            <label>规格<select id="panel-spec" required disabled><option value="">先选厚度</option></select></label>
            <label>颜色<select name="color" id="panel-color" required disabled><option value="">先选规格</option></select></label>`
    );
  }

  write("public/app.js", s);
}

patchDb();
patchServer();
patchApp();
