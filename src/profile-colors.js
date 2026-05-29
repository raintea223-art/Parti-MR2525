const DEFAULT_COLORS = ["银色", "木色"];

function normalizeName(name) {
  return (name || "").trim();
}

function mapProfileColor(row) {
  if (!row) return null;
  return {
    ...row,
    active: !!row.active,
    usage_count: row.usage_count ?? 0
  };
}

function ensureProfileColorsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_colors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_profile_colors_active ON profile_colors(active);
  `);

  const count = db.prepare("SELECT COUNT(*) AS c FROM profile_colors").get().c;
  if (count === 0) {
    const ins = db.prepare(
      `INSERT INTO profile_colors (name, active, sort_order) VALUES (?, 1, ?)`
    );
    DEFAULT_COLORS.forEach((name, i) => ins.run(name, i));
  }
}

function listProfileColors(db, { activeOnly = false } = {}) {
  const where = activeOnly ? "WHERE c.active = 1" : "";
  const rows = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM quote_profiles p WHERE TRIM(p.color) = c.name) AS usage_count
       FROM profile_colors c
       ${where}
       ORDER BY c.sort_order ASC, c.name ASC`
    )
    .all();
  return rows.map(mapProfileColor);
}

function getProfileColor(db, id) {
  const row = db.prepare("SELECT * FROM profile_colors WHERE id = ?").get(id);
  if (!row) return null;
  const usage_count = db
    .prepare("SELECT COUNT(*) AS c FROM quote_profiles WHERE TRIM(color) = ?")
    .get(row.name).c;
  return mapProfileColor({ ...row, usage_count });
}

function getProfileColorByName(db, name) {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const row = db.prepare("SELECT * FROM profile_colors WHERE name = ? COLLATE NOCASE").get(normalized);
  if (!row) return null;
  return getProfileColor(db, row.id);
}

function getDefaultProfileColorName(db) {
  const row = db
    .prepare(
      `SELECT name FROM profile_colors WHERE active = 1 ORDER BY sort_order ASC, name ASC LIMIT 1`
    )
    .get();
  return row?.name || DEFAULT_COLORS[0];
}

function resolveProfileColorForWrite(db, color) {
  const normalized = normalizeName(color);
  const defaultName = getDefaultProfileColorName(db);
  if (!normalized) return defaultName;
  const row = getProfileColorByName(db, normalized);
  if (!row) throw new Error(`型材颜色「${normalized}」不存在，请从单价库选择有效颜色`);
  if (!row.active) throw new Error(`型材颜色「${normalized}」已停用，请选择其他颜色`);
  return row.name;
}

function createProfileColor(db, name) {
  const normalized = normalizeName(name);
  if (!normalized) throw new Error("请填写颜色名称");
  const dup = db.prepare("SELECT id FROM profile_colors WHERE name = ? COLLATE NOCASE").get(normalized);
  if (dup) throw new Error("该颜色名称已存在");
  const maxSort = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM profile_colors").get().m;
  const result = db
    .prepare(`INSERT INTO profile_colors (name, active, sort_order) VALUES (?, 1, ?)`)
    .run(normalized, maxSort + 1);
  return getProfileColor(db, result.lastInsertRowid);
}

function updateProfileColor(db, id, data) {
  const existing = getProfileColor(db, id);
  if (!existing) return null;

  const sets = ["updated_at = datetime('now')"];
  const values = [];

  if ("active" in data) {
    sets.push("active = ?");
    values.push(data.active ? 1 : 0);
  }
  if ("sort_order" in data && Number.isFinite(Number(data.sort_order))) {
    sets.push("sort_order = ?");
    values.push(Number(data.sort_order));
  }

  if (sets.length === 1) return existing;

  values.push(id);
  db.prepare(`UPDATE profile_colors SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return getProfileColor(db, id);
}

function backfillQuoteProfileColors(db) {
  const defaultName = getDefaultProfileColorName(db);
  db.prepare(
    `UPDATE quote_profiles SET color = ? WHERE color IS NULL OR TRIM(color) = ''`
  ).run(defaultName);
}

module.exports = {
  DEFAULT_COLORS,
  ensureProfileColorsSchema,
  listProfileColors,
  getProfileColor,
  getProfileColorByName,
  getDefaultProfileColorName,
  resolveProfileColorForWrite,
  createProfileColor,
  updateProfileColor,
  backfillQuoteProfileColors
};
