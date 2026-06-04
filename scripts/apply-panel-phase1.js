/**
 * One-off patch script for Phase 1 panel multi-color (run: node scripts/apply-panel-phase1.js)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function write(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content, "utf8");
}

function patchPriceItems() {
  const rel = "src/price-items.js";
  let s = read(rel);
  if (s.includes("panel-price-colors")) {
    console.log("price-items.js already patched");
    return;
  }

  s = s.replace(
    'const { removePriceItemImageFile, toPublicUrl, relFromUploads } = require("./storage");',
    `const { removePriceItemImageFile, toPublicUrl, relFromUploads } = require("./storage");
const {
  buildPanelLabel,
  normalizeColorsInput,
  parseColorTokens,
  addPanelColors,
  setPanelColors,
  attachColorsToPanelItem,
  attachColorsToPanelItems,
  getPanelColorHex,
  colorAllowedOnItem
} = require("./panel-price-colors");`
  );

  s = s.replace(
    `  sql += " ORDER BY category ASC, material_type ASC, color ASC, thickness_mm ASC, label ASC";
  return db.prepare(sql).all(...params).map(mapPriceItem);
}

function getPriceItem(db, id) {
  return mapPriceItem(db.prepare("SELECT * FROM price_items WHERE id = ?").get(id));
}

function findPanelDuplicate(db, { material_type, color, thickness_mm }) {
  return mapPriceItem(
    db
      .prepare(
        \`SELECT * FROM price_items WHERE category = 'panel'
         AND material_type = ? AND color = ? AND thickness_mm = ?\`
      )
      .get(material_type, color, Number(thickness_mm))
  );
}`,
    `  sql += " ORDER BY category ASC, material_type ASC, thickness_mm ASC, label ASC";
  const rows = db.prepare(sql).all(...params).map(mapPriceItem);
  if (category === "panel") return attachColorsToPanelItems(db, rows);
  return rows.map((r) => (r.category === "panel" ? attachColorsToPanelItem(db, r) : r));
}

function getPriceItem(db, id) {
  const item = mapPriceItem(db.prepare("SELECT * FROM price_items WHERE id = ?").get(id));
  if (!item) return null;
  return item.category === "panel" ? attachColorsToPanelItem(db, item) : item;
}

function findPanelEntry(db, data) {
  const thickness = Number(data.thickness_mm);
  const unit_price = Number(data.unit_price) || 0;
  const internal =
    data.unit_price_internal != null && data.unit_price_internal !== ""
      ? Number(data.unit_price_internal)
      : defaultInternalPrice(unit_price);
  const row = db
    .prepare(
      \`SELECT * FROM price_items WHERE category = 'panel'
       AND material_type = ? AND thickness_mm = ?
       AND pricing_mode = ? AND unit_price = ?
       AND COALESCE(unit_price_internal, -1) = COALESCE(?, -1)
       AND TRIM(COALESCE(supplier, '')) = ?\`
    )
    .get(
      data.material_type,
      thickness,
      data.pricing_mode || "per_sqm",
      unit_price,
      internal,
      (data.supplier || "").trim()
    );
  return row ? attachColorsToPanelItem(db, mapPriceItem(row)) : null;
}

function findPanelDuplicate(db, data) {
  return findPanelEntry(db, data);
}`
  );

  s = s.replace(
    `    label:
      label ||
      (material_type && color && thickness_mm != null
        ? \`\${material_type} · \${color} · \${thickness_mm}mm\`
        : "")
  };
}`,
    `    colors: parseColorTokens(color, color_hex),
    label:
      label ||
      (material_type && thickness_mm != null ? buildPanelLabel(material_type, thickness_mm) : "")
  };
}`
  );

  s = s.replace(
    `function validatePanelRow(data) {
  const errors = [];
  if (!data.material_type) errors.push("缺少材质");
  if (!data.color) errors.push("缺少颜色");
  if (data.thickness_mm == null || Number.isNaN(data.thickness_mm)) errors.push("缺少有效厚度");
  if (!data.supplier) errors.push("缺少供应商");
  if (!data.unit_price || data.unit_price <= 0) errors.push("缺少有效对外价");
  if (!["per_sqm", "fixed"].includes(data.pricing_mode)) errors.push("计价单位无效");
  return errors;
}`,
    `function validatePanelRow(data) {
  const errors = [];
  if (!data.material_type) errors.push("缺少材质");
  const colors = data.colors?.length ? data.colors : parseColorTokens(data.color, data.color_hex);
  if (!colors.length) errors.push("缺少颜色");
  if (data.thickness_mm == null || Number.isNaN(data.thickness_mm)) errors.push("缺少有效厚度");
  if (!data.supplier) errors.push("缺少供应商");
  if (!data.unit_price || data.unit_price <= 0) errors.push("缺少有效对外价");
  if (!["per_sqm", "fixed"].includes(data.pricing_mode)) errors.push("计价单位无效");
  return errors;
}`
  );

  s = s.replace(
    `  for (const raw of parsed) {
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
  }`,
    `  for (const raw of parsed) {
    const data = mapCsvPanelRow(raw);
    data.colors = data.colors?.length ? data.colors : parseColorTokens(data.color, data.color_hex);
    const line = raw._line;
    const fieldErrors = validatePanelRow(data);
    if (fieldErrors.length) {
      result.errors.push({ line, errors: fieldErrors, row: data });
      result.stats.errors += 1;
      continue;
    }
    if (!data.label && data.material_type && data.thickness_mm != null) {
      data.label = buildPanelLabel(data.material_type, data.thickness_mm);
    }

    const existing = findPanelEntry(db, data);
    if (existing) {
      result.duplicates.push({ line, existing, row: data, merge: true });
      if (preview || !duplicateDecisions) continue;
      const action = duplicateDecisions[line] || duplicateDecisions[String(line)] || "merge";
      if (action === "skip") {
        result.stats.skipped += 1;
        continue;
      }
      if (action === "overwrite") {
        updatePriceItem(db, existing.id, {
          material_type: data.material_type,
          thickness_mm: data.thickness_mm,
          pricing_mode: data.pricing_mode,
          unit_price: data.unit_price,
          unit_price_internal: data.unit_price_internal,
          supplier: data.supplier,
          label: data.label,
          colors: data.colors
        });
        result.stats.overwritten += 1;
        continue;
      }
      try {
        addPanelColors(db, existing.id, data.colors);
        result.stats.merged = (result.stats.merged || 0) + 1;
      } catch (err) {
        result.errors.push({ line, errors: [err.message], row: data });
        result.stats.errors += 1;
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
      colors: data.colors,
      thickness_mm: data.thickness_mm,
      pricing_mode: data.pricing_mode,
      unit_price: data.unit_price,
      unit_price_internal: data.unit_price_internal,
      supplier: data.supplier
    });
    result.stats.created += 1;
  }`
  );

  s = s.replace(
    `  const item = getPriceItem(db, result.lastInsertRowid);
  if (data.supplier?.trim()) {
    const { ensureSupplierRecord } = require("./suppliers");
    ensureSupplierRecord(db, data.supplier);
  }
  return item;
}`,
    `  const item = getPriceItem(db, result.lastInsertRowid);
  if (data.category === "panel") {
    const colors = normalizeColorsInput(data);
    if (colors.length) setPanelColors(db, item.id, colors);
    if (!data.label && data.material_type && data.thickness_mm != null) {
      updatePriceItem(db, item.id, {
        label: buildPanelLabel(data.material_type, data.thickness_mm)
      });
    }
  }
  if (data.supplier?.trim()) {
    const { ensureSupplierRecord } = require("./suppliers");
    ensureSupplierRecord(db, data.supplier);
  }
  return getPriceItem(db, item.id);
}`
  );

  s = s.replace(
    `        \`UPDATE quote_panels SET
          material_type = ?, color = ?, thickness_mm = ?, material_name = ?,
          pricing_mode = ?, price_per_sqm = ?, fixed_unit_price = ?
         WHERE price_item_id = ?\`
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
      );`,
    `        \`UPDATE quote_panels SET
          material_type = ?, thickness_mm = ?, material_name = ?,
          pricing_mode = ?, price_per_sqm = ?, fixed_unit_price = ?
         WHERE price_item_id = ?\`
      )
      .run(
        item.material_type || "",
        item.thickness_mm ?? null,
        item.label,
        pricing.pricing_mode,
        pricing.price_per_sqm,
        pricing.fixed_unit_price,
        priceItemId
      );`
  );

  s = s.replace(
    `  db.prepare(\`UPDATE price_items SET \${sets.join(", ")} WHERE id = ?\`).run(...values);
  const updated = getPriceItem(db, id);

  if ("supplier" in data && data.supplier?.trim()) {`,
    `  db.prepare(\`UPDATE price_items SET \${sets.join(", ")} WHERE id = ?\`).run(...values);

  if (existing.category === "panel" && "colors" in data && Array.isArray(data.colors)) {
    setPanelColors(db, id, normalizeColorsInput({ colors: data.colors }));
  }

  const updated = getPriceItem(db, id);

  if ("supplier" in data && data.supplier?.trim()) {`
  );

  s = s.replace(
    `function getPanelFilters(db) {
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
}`,
    `function getPanelFilters(db) {
  const panels = listPriceItems(db, { category: "panel" });
  const materialTypes = [...new Set(panels.map((p) => p.material_type).filter(Boolean))].sort();
  const byMaterial = {};
  for (const p of panels) {
    if (!p.material_type) continue;
    if (!byMaterial[p.material_type]) {
      byMaterial[p.material_type] = { colors: new Set(), thicknesses: new Set(), items: [] };
    }
    for (const c of p.colors || []) {
      if (c.color) byMaterial[p.material_type].colors.add(c.color);
    }
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
}`
  );

  s = s.replace(
    `function enrichPanelLine(row, priceItem) {
  const pricing = resolvePanelPricing(priceItem);
  const material_name =
    row.material_name ||
    priceItem?.label ||
    [priceItem?.material_type, priceItem?.color, priceItem?.thickness_mm != null ? \`\${priceItem.thickness_mm}mm\` : ""]
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
    price_item_missing: !!(row.price_item_id && !priceItem),`,
    `function enrichPanelLine(row, priceItem, db = null) {
  const pricing = resolvePanelPricing(priceItem);
  const lineColor = row.color || "";
  const color_hex =
    db && row.price_item_id && lineColor
      ? getPanelColorHex(db, row.price_item_id, lineColor)
      : priceItem?.color_hex || "";
  const colorMissing =
    db &&
    row.price_item_id &&
    lineColor &&
    priceItem &&
    !colorAllowedOnItem(db, row.price_item_id, lineColor);
  const material_name =
    row.material_name ||
    priceItem?.label ||
    (priceItem?.material_type && priceItem?.thickness_mm != null
      ? buildPanelLabel(priceItem.material_type, priceItem.thickness_mm)
      : "");

  return {
    ...row,
    material_name,
    material_type: row.material_type || priceItem?.material_type || "",
    color: lineColor,
    color_hex,
    thickness_mm: row.thickness_mm ?? priceItem?.thickness_mm ?? null,
    pricing_mode: pricing.pricing_mode,
    price_per_sqm: pricing.price_per_sqm,
    fixed_unit_price: pricing.fixed_unit_price,
    price_per_sqm_external: pricing.price_per_sqm_external,
    price_per_sqm_internal: pricing.price_per_sqm_internal,
    fixed_unit_price_external: pricing.fixed_unit_price_external,
    fixed_unit_price_internal: pricing.fixed_unit_price_internal,
    price_item_missing: !!(row.price_item_id && !priceItem) || colorMissing,`
  );

  s = s.replace(
    `  findPanelDuplicate,
  resolvePurchaseLink,`,
    `  findPanelDuplicate,
  findPanelEntry,
  resolvePurchaseLink,`
  );

  write(rel, s);
  console.log("patched price-items.js");
}

patchPriceItems();
