const { panelLineTotal, hardwareLineTotal } = require("./pricing");
const { removePriceItemImageFile, toPublicUrl, relFromUploads } = require("./storage");

function defaultInternalPrice(external) {
  const ext = Number(external) || 0;
  return Math.round(ext * 0.5 * 100) / 100;
}

function mapPriceItem(row) {
  if (!row) return null;
  const external = Number(row.unit_price) || 0;
  const internal =
    row.unit_price_internal != null ? Number(row.unit_price_internal) : defaultInternalPrice(external);
  return {
    ...row,
    enabled: row.enabled !== 0,
    link: row.link || "",
    supplier: row.supplier || "",
    color_hex: row.color_hex || "",
    image_url: row.image_url || "",
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

function findPanelDuplicate(db, { material_type, color, thickness_mm }) {
  return mapPriceItem(
    db
      .prepare(
        `SELECT * FROM price_items WHERE category = 'panel'
         AND material_type = ? AND color = ? AND thickness_mm = ?`
      )
      .get(material_type, color, Number(thickness_mm))
  );
}

function getPriceItemReferences(db, id) {
  const nuts = db
    .prepare(
      `SELECT qn.id AS line_id, t.id AS template_id, t.template_code, t.name
       FROM quote_nuts qn JOIN templates t ON t.id = qn.template_id
       WHERE qn.price_item_id = ?`
    )
    .all(id);
  const hardware = db
    .prepare(
      `SELECT qh.id AS line_id, t.id AS template_id, t.template_code, t.name
       FROM quote_hardware qh JOIN templates t ON t.id = qh.template_id
       WHERE qh.price_item_id = ?`
    )
    .all(id);
  const panels = db
    .prepare(
      `SELECT qp.id AS line_id, t.id AS template_id, t.template_code, t.name
       FROM quote_panels qp JOIN templates t ON t.id = qp.template_id
       WHERE qp.price_item_id = ?`
    )
    .all(id);
  return {
    nuts,
    hardware,
    panels,
    total: nuts.length + hardware.length + panels.length
  };
}

function resolvePurchaseLink(url) {
  const raw = (url || "").trim();
  if (!raw) return { platform: null, hostname: "", hint: "" };
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("tmall.com")) return { platform: "天猫", hostname: host, hint: "识别为：天猫" };
    if (host.includes("taobao.com")) return { platform: "淘宝", hostname: host, hint: "识别为：淘宝" };
    if (host.includes("1688.com")) return { platform: "1688", hostname: host, hint: "识别为：1688" };
    if (host.includes("jd.com")) return { platform: "京东", hostname: host, hint: "识别为：京东" };
    if (host.includes("pinduoduo.com") || host.includes("yangkeduo.com")) {
      return { platform: "拼多多", hostname: host, hint: "识别为：拼多多" };
    }
    return { platform: host, hostname: host, hint: `识别为：${host}` };
  } catch {
    return { platform: null, hostname: "", hint: "", error: "无效链接" };
  }
}

function parsePricingMode(raw) {
  const v = (raw || "").trim().toLowerCase();
  if (["fixed", "件", "件价", "固定件价", "固定"].some((k) => v.includes(k))) return "fixed";
  return "per_sqm";
}

function parseCsvRows(text) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line, idx) => {
    const cols = line.split(",").map((c) => c.trim());
    const row = { _line: idx + 2 };
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function mapCsvPanelRow(row) {
  const material_type = (row["材质"] || row.material_type || "").trim();
  const color = (row["颜色"] || row.color || "").trim();
  const color_hex = (row["颜色HEX(可选)"] || row["颜色HEX"] || row.color_hex || "").trim();
  const thicknessRaw = row["厚度mm"] ?? row["厚度"] ?? row.thickness_mm;
  const thickness_mm = thicknessRaw === "" || thicknessRaw == null ? null : Number(thicknessRaw);
  const pricing_mode = parsePricingMode(row["计价单位"] || row.pricing_mode);
  const unit_price = Number(row["对外价"] ?? row.unit_price);
  const unit_price_internal =
    row["对内价"] !== "" && row["对内价"] != null
      ? Number(row["对内价"])
      : defaultInternalPrice(unit_price);
  const supplier = (row["供应商"] || row.supplier || "").trim();
  const label = (row["名称(可选)"] || row["名称"] || row.label || "").trim();
  return {
    material_type,
    color,
    color_hex,
    thickness_mm,
    pricing_mode,
    unit_price,
    unit_price_internal,
    supplier,
    label:
      label ||
      (material_type && color && thickness_mm != null
        ? `${material_type} · ${color} · ${thickness_mm}mm`
        : "")
  };
}

function validatePanelRow(data) {
  const errors = [];
  if (!data.material_type) errors.push("缺少材质");
  if (!data.color) errors.push("缺少颜色");
  if (data.thickness_mm == null || Number.isNaN(data.thickness_mm)) errors.push("缺少有效厚度");
  if (!data.supplier) errors.push("缺少供应商");
  if (!data.unit_price || data.unit_price <= 0) errors.push("缺少有效对外价");
  if (!["per_sqm", "fixed"].includes(data.pricing_mode)) errors.push("计价单位无效");
  return errors;
}

function importPanelCsv(db, { csv, duplicateDecisions = null, preview = false } = {}) {
  const parsed = parseCsvRows(csv);
  const result = {
    preview: !!preview,
    newRows: [],
    duplicates: [],
    errors: [],
    stats: { created: 0, overwritten: 0, skipped: 0, errors: 0 }
  };

  for (const raw of parsed) {
    const data = mapCsvPanelRow(raw);
    const line = raw._line;
    const fieldErrors = validatePanelRow(data);
    if (fieldErrors.length) {
      result.errors.push({ line, errors: fieldErrors, row: data });
      result.stats.errors += 1;
      continue;
    }

    const existing = findPanelDuplicate(db, data);
    if (existing) {
      result.duplicates.push({ line, existing, row: data });
      if (preview || !duplicateDecisions) continue;
      const action = duplicateDecisions[line] || duplicateDecisions[String(line)];
      if (action === "skip") {
        result.stats.skipped += 1;
        continue;
      }
      if (action === "overwrite") {
        updatePriceItem(db, existing.id, {
          material_type: data.material_type,
          color: data.color,
          color_hex: data.color_hex,
          thickness_mm: data.thickness_mm,
          pricing_mode: data.pricing_mode,
          unit_price: data.unit_price,
          unit_price_internal: data.unit_price_internal,
          supplier: data.supplier,
          label: data.label
        });
        result.stats.overwritten += 1;
        continue;
      }
      continue;
    }

    if (preview) {
      result.newRows.push({ line, row: data });
      continue;
    }

    createPriceItem(db, {
      category: "panel",
      label: data.label,
      unit: "块",
      material_type: data.material_type,
      color: data.color,
      color_hex: data.color_hex,
      thickness_mm: data.thickness_mm,
      pricing_mode: data.pricing_mode,
      unit_price: data.unit_price,
      unit_price_internal: data.unit_price_internal,
      supplier: data.supplier
    });
    result.stats.created += 1;
  }

  return result;
}

function createPriceItem(db, data) {
  const external = Number(data.unit_price) || 0;
  const internal =
    data.unit_price_internal != null && data.unit_price_internal !== ""
      ? Number(data.unit_price_internal)
      : defaultInternalPrice(external);
  const result = db
    .prepare(
      `INSERT INTO price_items (
        category, label, unit, unit_price, unit_price_internal, pricing_mode, enabled, note,
        nut_model, spec, material_type, color, thickness_mm, link, supplier, color_hex
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      data.thickness_mm ?? null,
      data.link || "",
      data.supplier || "",
      data.color_hex || ""
    );
  const item = getPriceItem(db, result.lastInsertRowid);
  if (data.supplier?.trim()) {
    const { ensureSupplierRecord } = require("./suppliers");
    ensureSupplierRecord(db, data.supplier);
  }
  return item;
}

function propagatePriceItemChange(db, priceItemId) {
  const item = getPriceItem(db, priceItemId);
  if (!item) return null;

  const stats = { quote_nuts: 0, quote_hardware: 0, quote_panels: 0 };

  if (item.category === "nut") {
    const r = db
      .prepare(
        `UPDATE quote_nuts SET
          unit_price = ?, item_name = ?, nut_model = ?, unit = ?
         WHERE price_item_id = ?`
      )
      .run(item.unit_price, item.label, item.nut_model || "", item.unit, priceItemId);
    stats.quote_nuts = r.changes;
  } else if (item.category === "hardware") {
    const r = db
      .prepare(
        `UPDATE quote_hardware SET
          unit_price = ?, item_name = ?, spec = ?, unit = ?
         WHERE price_item_id = ?`
      )
      .run(item.unit_price, item.label, item.spec || "", item.unit, priceItemId);
    stats.quote_hardware = r.changes;
  } else if (item.category === "panel") {
    const pricing = resolvePanelPricing(item);
    const r = db
      .prepare(
        `UPDATE quote_panels SET
          material_type = ?, color = ?, thickness_mm = ?, material_name = ?,
          pricing_mode = ?, price_per_sqm = ?, fixed_unit_price = ?
         WHERE price_item_id = ?`
      )
      .run(
        item.material_type || "",
        item.color || "",
        item.thickness_mm ?? null,
        item.label,
        pricing.pricing_mode,
        pricing.price_per_sqm,
        pricing.fixed_unit_price,
        priceItemId
      );
    stats.quote_panels = r.changes;
  }

  stats.total = stats.quote_nuts + stats.quote_hardware + stats.quote_panels;
  return stats;
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
    "thickness_mm",
    "link",
    "supplier",
    "color_hex"
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
  const updated = getPriceItem(db, id);

  if ("supplier" in data && data.supplier?.trim()) {
    const { ensureSupplierRecord } = require("./suppliers");
    ensureSupplierRecord(db, data.supplier);
  }

  const externalFields = [
    "unit_price",
    "label",
    "nut_model",
    "spec",
    "material_type",
    "color",
    "thickness_mm",
    "pricing_mode"
  ];
  const shouldPropagate = externalFields.some((k) => k in data);
  if (shouldPropagate) {
    updated._propagation = propagatePriceItemChange(db, id);
  }

  return updated;
}

function setPriceItemImage(db, id, uploadedAbsPath) {
  const item = getPriceItem(db, id);
  if (!item) {
    const err = new Error("记录不存在");
    err.status = 404;
    throw err;
  }
  if (!["nut", "hardware"].includes(item.category)) {
    throw new Error("仅六通/五金支持图片");
  }
  removePriceItemImageFile(item.image_url);
  const image_url = toPublicUrl(relFromUploads(uploadedAbsPath));
  db.prepare("UPDATE price_items SET image_url = ?, updated_at = datetime('now') WHERE id = ?").run(
    image_url,
    id
  );
  return getPriceItem(db, id);
}

function clearPriceItemImage(db, id) {
  const item = getPriceItem(db, id);
  if (!item) {
    const err = new Error("记录不存在");
    err.status = 404;
    throw err;
  }
  if (!["nut", "hardware"].includes(item.category)) {
    throw new Error("仅六通/五金支持图片");
  }
  removePriceItemImageFile(item.image_url);
  db.prepare("UPDATE price_items SET image_url = '', updated_at = datetime('now') WHERE id = ?").run(id);
  return getPriceItem(db, id);
}

function deletePriceItem(db, id) {
  const refs = getPriceItemReferences(db, id);
  if (refs.total > 0) {
    const err = new Error("该条目已被模板引用，无法删除");
    err.code = "REFERENCED";
    err.references = refs;
    throw err;
  }
  const item = getPriceItem(db, id);
  removePriceItemImageFile(item?.image_url);
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
  const internal = priceItem.unit_price_internal ?? defaultInternalPrice(ext);
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
    fixed_unit_price_internal: internal
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
    color_hex: priceItem?.color_hex || "",
    thickness_mm: row.thickness_mm ?? priceItem?.thickness_mm ?? null,
    pricing_mode: pricing.pricing_mode,
    price_per_sqm: pricing.price_per_sqm,
    fixed_unit_price: pricing.fixed_unit_price,
    price_per_sqm_external: pricing.price_per_sqm_external,
    price_per_sqm_internal: pricing.price_per_sqm_internal,
    fixed_unit_price_external: pricing.fixed_unit_price_external,
    fixed_unit_price_internal: pricing.fixed_unit_price_internal,
    price_item_missing: !!(row.price_item_id && !priceItem),
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
  const internal = priceItem?.unit_price_internal ?? defaultInternalPrice(ext);
  return {
    ...row,
    nut_model: row.nut_model || priceItem?.nut_model || "",
    item_name: row.item_name || priceItem?.label || "",
    unit: row.unit || priceItem?.unit || "个",
    unit_price: ext,
    unit_price_external: ext,
    unit_price_internal: internal,
    price_item_missing: !!(row.price_item_id && !priceItem),
    ...hardwareLineTotal(row.qty, ext, { external: true })
  };
}

function enrichHardwareLine(row, priceItem) {
  const ext = row.unit_price ?? priceItem?.unit_price_external ?? priceItem?.unit_price ?? 0;
  const internal = priceItem?.unit_price_internal ?? defaultInternalPrice(ext);
  return {
    ...row,
    item_name: row.item_name || priceItem?.label || "",
    spec: row.spec || row.model || priceItem?.spec || "",
    unit: row.unit || priceItem?.unit || "个",
    unit_price: ext,
    unit_price_external: ext,
    unit_price_internal: internal,
    price_item_missing: !!(row.price_item_id && !priceItem),
    ...hardwareLineTotal(row.qty, ext, { external: true })
  };
}

module.exports = {
  listPriceItems,
  getPriceItem,
  createPriceItem,
  updatePriceItem,
  propagatePriceItemChange,
  deletePriceItem,
  setPriceItemImage,
  clearPriceItemImage,
  getPriceItemReferences,
  findPanelDuplicate,
  resolvePurchaseLink,
  importPanelCsv,
  getPanelFilters,
  resolvePanelPricing,
  enrichPanelLine,
  enrichNutLine,
  enrichHardwareLine,
  mapPriceItem,
  defaultInternalPrice
};
