/** @typedef {{ id: number, name: string, template_count: number }} TagRow */

function parseJsonField(raw, fallback = []) {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/** @param {string} raw */
function normalizeTagName(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (!s) return "";
  s = s.replace(/^#+/, "").trim();
  s = s.replace(/\s+/g, " ");
  if (!s) return "";
  if (s.length > 40) s = s.slice(0, 40);
  return s;
}

function initTagsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS template_tags (
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (template_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_template_tags_tag ON template_tags(tag_id);
  `);
}

function getOrCreateTag(db, name) {
  const normalized = normalizeTagName(name);
  if (!normalized) throw new Error("标签名称无效");
  const existing = db.prepare("SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE").get(normalized);
  if (existing) return existing;
  const r = db.prepare("INSERT INTO tags (name) VALUES (?)").run(normalized);
  return { id: Number(r.lastInsertRowid), name: normalized };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} templateId
 * @param {string[]} tagNames
 */
function syncTemplateTags(db, templateId, tagNames, { touchTemplate = true } = {}) {
  const normalized = [...new Set(tagNames.map(normalizeTagName).filter(Boolean))];
  const tagIds = normalized.map((n) => getOrCreateTag(db, n).id);

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM template_tags WHERE template_id = ?").run(templateId);
    const insert = db.prepare("INSERT INTO template_tags (template_id, tag_id) VALUES (?, ?)");
    for (const tagId of tagIds) {
      insert.run(templateId, tagId);
    }
    if (touchTemplate) {
      db.prepare("UPDATE templates SET tags = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(normalized),
        templateId
      );
    } else {
      db.prepare("UPDATE templates SET tags = ? WHERE id = ?").run(JSON.stringify(normalized), templateId);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return normalized;
}

/** @returns {TagRow[]} */
function listTagsCloud(db) {
  return db
    .prepare(
      `SELECT g.id, g.name, COUNT(tt.template_id) AS template_count
       FROM tags g
       LEFT JOIN template_tags tt ON tt.tag_id = g.id
       GROUP BY g.id
       ORDER BY template_count DESC, g.name ASC`
    )
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      template_count: Number(r.template_count) || 0
    }));
}

/** @returns {TagRow[]} */
function searchTags(db, q, limit = 20) {
  const needle = normalizeTagName(q);
  if (!needle) return listTagsCloud(db).slice(0, limit);
  return db
    .prepare(
      `SELECT g.id, g.name, COUNT(tt.template_id) AS template_count
       FROM tags g
       LEFT JOIN template_tags tt ON tt.tag_id = g.id
       WHERE g.name LIKE ? ESCAPE '\\'
       GROUP BY g.id
       ORDER BY template_count DESC, g.name ASC
       LIMIT ?`
    )
    .all(`%${needle.replace(/[%_\\]/g, "\\$&")}%`, limit)
    .map((r) => ({
      id: r.id,
      name: r.name,
      template_count: Number(r.template_count) || 0
    }));
}

/** @returns {TagRow[]} */
function getTopTags(db, limit = 5) {
  return listTagsCloud(db).slice(0, limit);
}

function getTagByName(db, name) {
  const normalized = normalizeTagName(name);
  if (!normalized) return null;
  return db.prepare("SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE").get(normalized);
}

/** @param {Record<string, string | string[] | undefined>} query */
function parseTagsQueryParam(query) {
  let raw = query.tag;
  if (query.tags != null) raw = query.tags;
  if (raw == null) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(/[,;，]/);
  return [...new Set(parts.map(normalizeTagName).filter(Boolean))];
}

function migrateTagsFromTemplates(db, seedNames = []) {
  initTagsSchema(db);
  for (const n of seedNames) {
    try {
      getOrCreateTag(db, n);
    } catch {
      /* ignore */
    }
  }
  const linkCount = db.prepare("SELECT COUNT(*) AS c FROM template_tags").get().c;
  if (linkCount > 0) return;
  const rows = db.prepare("SELECT id, tags FROM templates").all();
  for (const row of rows) {
    const names = parseJsonField(row.tags, []);
    if (names.length) syncTemplateTags(db, row.id, names, { touchTemplate: false });
  }
}

module.exports = {
  normalizeTagName,
  initTagsSchema,
  getOrCreateTag,
  syncTemplateTags,
  listTagsCloud,
  searchTags,
  getTopTags,
  getTagByName,
  migrateTagsFromTemplates,
  parseJsonField,
  parseTagsQueryParam
};
