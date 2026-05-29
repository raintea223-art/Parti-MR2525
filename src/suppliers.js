function normalizeName(name) {
  return (name || "").trim();
}

function mapSupplier(row) {
  if (!row) return null;
  return {
    ...row,
    contact: row.contact || "",
    phone: row.phone || "",
    note: row.note || "",
    item_count: row.item_count ?? 0
  };
}

function syncSuppliersFromPriceItems(db) {
  const r = db
    .prepare(
      `INSERT OR IGNORE INTO suppliers (name)
       SELECT DISTINCT TRIM(supplier) FROM price_items
       WHERE category IN ('hardware', 'panel') AND TRIM(supplier) != ''`
    )
    .run();
  return r.changes;
}

function ensureSupplierRecord(db, name) {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  db.prepare(`INSERT OR IGNORE INTO suppliers (name) VALUES (?)`).run(normalized);
  return mapSupplier(db.prepare("SELECT * FROM suppliers WHERE name = ?").get(normalized));
}

function listSuppliers(db) {
  syncSuppliersFromPriceItems(db);
  const rows = db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM price_items p
         WHERE p.supplier = s.name AND p.category IN ('hardware', 'panel')) AS item_count
       FROM suppliers s
       ORDER BY s.name ASC`
    )
    .all();
  return rows.map(mapSupplier);
}

function getSupplier(db, id) {
  return mapSupplier(db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id));
}

function updateSupplier(db, id, data) {
  const existing = getSupplier(db, id);
  if (!existing) return null;

  const fields = ["contact", "phone", "note"];
  const sets = ["updated_at = datetime('now')"];
  const values = [];

  for (const key of fields) {
    if (!(key in data)) continue;
    sets.push(`${key} = ?`);
    values.push(data[key] ?? "");
  }
  if (sets.length === 1) return existing;

  values.push(id);
  db.prepare(`UPDATE suppliers SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return getSupplier(db, id);
}

module.exports = {
  syncSuppliersFromPriceItems,
  ensureSupplierRecord,
  listSuppliers,
  getSupplier,
  updateSupplier,
  mapSupplier
};
