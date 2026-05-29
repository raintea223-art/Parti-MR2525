function normalizeSpec(spec) {
  return (spec || "").trim();
}

function defaultInternalPrice(external) {
  const ext = Number(external) || 0;
  return Math.round(ext * 0.5 * 100) / 100;
}

function mapCustomItem(row) {
  if (!row) return null;
  const external = Number(row.unit_price) || 0;
  const internal =
    row.unit_price_internal != null ? Number(row.unit_price_internal) : defaultInternalPrice(external);
  return {
    ...row,
    spec: row.spec || "",
    enabled: row.enabled !== 0,
    unit_price_external: external,
    unit_price_internal: internal
  };
}

function findCustomItem(db, { source_category, item_name, spec }) {
  const normSpec = normalizeSpec(spec);
  const rows = db
    .prepare(
      `SELECT * FROM price_items_custom
       WHERE source_category = ? AND item_name = ? AND enabled = 1`
    )
    .all(source_category, item_name.trim());
  return (
    rows.find((r) => normalizeSpec(r.spec) === normSpec) ||
    rows.find((r) => !normalizeSpec(r.spec) && !normSpec) ||
    null
  );
}

function listCustomItems(db, { enabledOnly = false } = {}) {
  let sql = "SELECT * FROM price_items_custom WHERE 1=1";
  if (enabledOnly) sql += " AND enabled = 1";
  sql += " ORDER BY source_category ASC, item_name ASC, spec ASC";
  return db.prepare(sql).all().map(mapCustomItem);
}

function getCustomItem(db, id) {
  return mapCustomItem(db.prepare("SELECT * FROM price_items_custom WHERE id = ?").get(id));
}

function createCustomItem(db, data) {
  const external = Number(data.unit_price) || 0;
  const internal =
    data.unit_price_internal != null && data.unit_price_internal !== ""
      ? Number(data.unit_price_internal)
      : defaultInternalPrice(external);
  const result = db
    .prepare(
      `INSERT INTO price_items_custom (
        source_category, item_name, spec, unit, unit_price, unit_price_internal,
        enabled, created_by, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.source_category,
      data.item_name.trim(),
      normalizeSpec(data.spec),
      data.unit || "个",
      external,
      internal,
      data.enabled === false ? 0 : 1,
      data.created_by || "",
      data.note || ""
    );
  return getCustomItem(db, result.lastInsertRowid);
}

function propagateCustomItemChange(db, customId, item) {
  const stats = { bom_lines: 0 };
  const r = db
    .prepare(
      `UPDATE bom_lines SET
        unit_price = ?, item_name = ?, category = ?, spec = ?
       WHERE custom_price_item_id = ?`
    )
    .run(item.unit_price, item.item_name, item.source_category, item.spec || "", customId);
  stats.bom_lines = r.changes;
  stats.total = stats.bom_lines;
  return stats;
}

function updateCustomItem(db, id, data) {
  const existing = getCustomItem(db, id);
  if (!existing) return null;

  const fields = [
    "source_category",
    "item_name",
    "spec",
    "unit",
    "unit_price",
    "unit_price_internal",
    "enabled",
    "note"
  ];
  const sets = ["updated_at = datetime('now')"];
  const values = [];

  for (const key of fields) {
    if (!(key in data)) continue;
    let val = data[key];
    if (key === "enabled") val = val ? 1 : 0;
    if (key === "spec") val = normalizeSpec(val);
    if (key === "item_name") val = val.trim();
    sets.push(`${key} = ?`);
    values.push(val);
  }
  values.push(id);
  db.prepare(`UPDATE price_items_custom SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  const updated = getCustomItem(db, id);
  const syncFields = ["unit_price", "item_name", "source_category", "spec"];
  if (syncFields.some((k) => k in data)) {
    updated._propagation = propagateCustomItemChange(db, id, updated);
  }
  return updated;
}

function enrichBomLine(row, customItem) {
  return {
    ...row,
    custom_price_item_missing: !!(row.custom_price_item_id && !customItem)
  };
}

function promoteCustomToHardware(db, customId, hardwareData) {
  const custom = getCustomItem(db, customId);
  if (!custom) return null;
  if (!custom.enabled) throw new Error("该非标件已停用");
  if (!hardwareData.supplier?.trim()) throw new Error("请填写供应商");

  const { createPriceItem } = require("./price-items");
  let hardware;
  db.exec("BEGIN");
  try {
    hardware = createPriceItem(db, {
      category: "hardware",
      label: hardwareData.label?.trim() || custom.item_name,
      spec: hardwareData.spec != null ? hardwareData.spec : custom.spec,
      unit: hardwareData.unit || custom.unit || "个",
      unit_price: hardwareData.unit_price ?? custom.unit_price,
      unit_price_internal: hardwareData.unit_price_internal ?? custom.unit_price_internal,
      supplier: hardwareData.supplier || ""
    });
    db.prepare(
      `UPDATE price_items_custom SET enabled = 0, note = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(`已转移至 hardware #${hardware.id}`, customId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { hardware, custom: getCustomItem(db, customId) };
}

module.exports = {
  normalizeSpec,
  findCustomItem,
  listCustomItems,
  getCustomItem,
  createCustomItem,
  updateCustomItem,
  propagateCustomItemChange,
  enrichBomLine,
  promoteCustomToHardware,
  mapCustomItem
};
