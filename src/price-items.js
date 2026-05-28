const { panelLineTotal, hardwareLineTotal } = require("./pricing");

function mapPriceItem(row) {
  if (!row) return null;
  const external = Number(row.unit_price) || 0;
  const internal =
    row.unit_price_internal != null ? Number(row.unit_price_internal) : external;
  return {
    ...row,
    enabled: row.enabled !== 0,
    unit_price_external: external,
    unit_price_internal: internal
  };
}

function listPriceItems(db, { category, enabledOnly = true } = {}) {
  let sql = "SELECT * FROM price_items WHERE 1=1";
  const params = [];
  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }
  if (enabledOnly) {
    sql += " AND enabled = 1";
  }
  sql += " ORDER BY category ASC, material_type ASC, color ASC, thickness_mm ASC, label ASC";
  return db.prepare(sql).all(...params).map(mapPriceItem);
}

function getPriceItem(db, id) {
  return mapPriceItem(db.prepare("SELECT * FROM price_items WHERE id = ?").get(id));
}

function createPriceItem(db, data) {
  const external = Number(data.unit_price) || 0;
  const internal =
    data.unit_price_internal != null ? Number(data.unit_price_internal) : external;
  const result = db
    .prepare(
      `INSERT INTO price_items (
        category, label, unit, unit_price, unit_price_internal, pricing_mode, enabled, note,
        nut_model, spec, material_type, color, thickness_mm
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.category,
      data.label,
      data.unit || "个",
      external,
      internal,
      data.pricing_mode || "unit",
      data.enabled === false ? 0 : 1,
      data.note || "",
      data.nut_model || "",
      data.spec || "",
      data.material_type || "",
      data.color || "",
      data.thickness_mm ?? null
    );
  return getPriceItem(db, result.lastInsertRowid);
}

function updatePriceItem(db, id, data) {
  const existing = getPriceItem(db, id);
  if (!existing) return null;

  const fields = [
    "label",
    "unit",
    "unit_price",
    "unit_price_internal",
    "pricing_mode",
    "enabled",
    "note",
    "nut_model",
    "spec",
    "material_type",
    "color",
    "thickness_mm"
  ];
  const sets = ["updated_at = datetime('now')"];
  const values = [];

  for (const key of fields) {
    if (!(key in data)) continue;
    let val = data[key];
    if (key === "enabled") val = val ? 1 : 0;
    sets.push(`${key} = ?`);
    values.push(val);
  }
  values.push(id);
  db.prepare(`UPDATE price_items SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return getPriceItem(db, id);
}

function deletePriceItem(db, id) {
  return db.prepare("DELETE FROM price_items WHERE id = ?").run(id);
}

function getPanelFilters(db) {
  const panels = listPriceItems(db, { category: "panel" });
  const materialTypes = [...new Set(panels.map((p) => p.material_type).filter(Boolean))].sort();
  const byMaterial = {};
  for (const p of panels) {
    if (!p.material_type) continue;
    if (!byMaterial[p.material_type]) {
      byMaterial[p.material_type] = { colors: new Set(), thicknesses: new Set(), items: [] };
    }
    if (p.color) byMaterial[p.material_type].colors.add(p.color);
    if (p.thickness_mm != null) byMaterial[p.material_type].thicknesses.add(p.thickness_mm);
    byMaterial[p.material_type].items.push(p);
  }
  const structured = {};
  for (const [mat, data] of Object.entries(byMaterial)) {
    structured[mat] = {
      colors: [...data.colors].sort(),
      thicknesses: [...data.thicknesses].sort((a, b) => a - b),
      items: data.items
    };
  }
  return { materialTypes, byMaterial: structured, items: panels };
}

function resolvePanelPricing(priceItem) {
  if (!priceItem) {
    return {
      pricing_mode: "per_sqm",
      price_per_sqm: 0,
      fixed_unit_price: 0,
      price_per_sqm_external: 0,
      price_per_sqm_internal: 0,
      fixed_unit_price_external: 0,
      fixed_unit_price_internal: 0
    };
  }
  const ext = priceItem.unit_price_external ?? priceItem.unit_price ?? 0;
  const internal = priceItem.unit_price_internal ?? ext;
  if (priceItem.pricing_mode === "fixed") {
    return {
      pricing_mode: "fixed",
      price_per_sqm: 0,
      fixed_unit_price: ext,
      price_per_sqm_external: 0,
      price_per_sqm_internal: 0,
      fixed_unit_price_external: ext,
      fixed_unit_price_internal: internal
    };
  }
  return {
    pricing_mode: "per_sqm",
    price_per_sqm: ext,
    fixed_unit_price: 0,
    price_per_sqm_external: ext,
    price_per_sqm_internal: internal,
    fixed_unit_price_external: 0,
    fixed_unit_price_internal: 0
  };
}

function enrichPanelLine(row, priceItem) {
  const pricing = resolvePanelPricing(priceItem);
  const material_name =
    row.material_name ||
    priceItem?.label ||
    [priceItem?.material_type, priceItem?.color, priceItem?.thickness_mm != null ? `${priceItem.thickness_mm}mm` : ""]
      .filter(Boolean)
      .join(" · ");

  return {
    ...row,
    material_name,
    material_type: row.material_type || priceItem?.material_type || "",
    color: row.color || priceItem?.color || "",
    thickness_mm: row.thickness_mm ?? priceItem?.thickness_mm ?? null,
    pricing_mode: pricing.pricing_mode,
    price_per_sqm: pricing.price_per_sqm,
    fixed_unit_price: pricing.fixed_unit_price,
    price_per_sqm_external: pricing.price_per_sqm_external,
    price_per_sqm_internal: pricing.price_per_sqm_internal,
    fixed_unit_price_external: pricing.fixed_unit_price_external,
    fixed_unit_price_internal: pricing.fixed_unit_price_internal,
    ...panelLineTotal(
      {
        length_inch: row.length_inch,
        width_inch: row.width_inch,
        qty: row.qty,
        pricing_mode: pricing.pricing_mode,
        price_per_sqm: pricing.price_per_sqm_external,
        fixed_unit_price: pricing.fixed_unit_price_external
      },
      { external: true }
    )
  };
}

function enrichNutLine(row, priceItem) {
  const ext = row.unit_price ?? priceItem?.unit_price_external ?? priceItem?.unit_price ?? 0;
  const internal = priceItem?.unit_price_internal ?? ext;
  return {
    ...row,
    nut_model: row.nut_model || priceItem?.nut_model || "",
    item_name: row.item_name || priceItem?.label || "",
    unit: row.unit || priceItem?.unit || "个",
    unit_price: ext,
    unit_price_external: ext,
    unit_price_internal: internal,
    ...hardwareLineTotal(row.qty, ext, { external: true })
  };
}

function enrichHardwareLine(row, priceItem) {
  const ext = row.unit_price ?? priceItem?.unit_price_external ?? priceItem?.unit_price ?? 0;
  const internal = priceItem?.unit_price_internal ?? ext;
  return {
    ...row,
    item_name: row.item_name || priceItem?.label || "",
    spec: row.spec || priceItem?.spec || "",
    unit: row.unit || priceItem?.unit || "个",
    unit_price: ext,
    unit_price_external: ext,
    unit_price_internal: internal,
    ...hardwareLineTotal(row.qty, ext, { external: true })
  };
}

module.exports = {
  listPriceItems,
  getPriceItem,
  createPriceItem,
  updatePriceItem,
  deletePriceItem,
  getPanelFilters,
  resolvePanelPricing,
  enrichPanelLine,
  enrichNutLine,
  enrichHardwareLine,
  mapPriceItem
};
