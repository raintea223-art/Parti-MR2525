const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const { PRICE_SEED } = require("./price-seed");
const { computeQuoteSummary } = require("./pricing");
const { getProfileFormula, ensureProfileFormulaSchema } = require("./profile-formula");
const {
  ensureProfileColorsSchema,
  backfillQuoteProfileColors
} = require("./profile-colors");
const {
  getPriceItem,
  enrichPanelLine,
  enrichNutLine,
  enrichHardwareLine
} = require("./price-items");
const { getCustomItem, enrichBomLine } = require("./price-custom");
const { initTagsSchema, migrateTagsFromTemplates } = require("./tags");
const { TAGS } = require("./constants");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "catalog.db");
const { UPLOADS_DIR } = require("./storage");

function ensureDirs() {
  for (const dir of [DATA_DIR, UPLOADS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(UPLOADS_DIR, "审核存档"), { recursive: true });
}

function columnExists(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function ensureColumn(db, table, column, ddl) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function seedPriceItems(db) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM price_items").get().c;
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT INTO price_items (
      category, label, unit, unit_price, unit_price_internal, pricing_mode, nut_model, spec,
      material_type, color, thickness_mm, enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );

  db.exec("BEGIN");
  try {
    for (const n of PRICE_SEED.nuts) {
      insert.run(
        "nut",
        n.label,
        n.unit,
        n.unit_price,
        n.unit_price,
        "unit",
        n.nut_model,
        "",
        "",
        "",
        null
      );
    }
    for (const h of PRICE_SEED.hardware) {
      insert.run(
        "hardware",
        h.label,
        h.unit,
        h.unit_price,
        h.unit_price,
        "unit",
        "",
        h.spec || "",
        "",
        "",
        null
      );
    }
    for (const p of PRICE_SEED.panels) {
      insert.run(
        "panel",
        p.label,
        "块",
        p.unit_price,
        p.unit_price,
        p.pricing_mode,
        "",
        "",
        p.material_type,
        p.color,
        p.thickness_mm
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_code TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      scenario TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      one_liner TEXT DEFAULT '',
      panel_type TEXT DEFAULT '',
      panel_note TEXT DEFAULT '',
      assignee TEXT DEFAULT '',
      price_factors TEXT DEFAULT '[]',
      width_mm REAL,
      depth_mm REAL,
      height_mm REAL,
      cover_image TEXT,
      gallery_images TEXT DEFAULT '[]',
      skp_file TEXT,
      process_fee REAL DEFAULT 0,
      quote_note TEXT DEFAULT '',
      price_override_min REAL,
      price_override_max REAL,
      detail_doc_url TEXT DEFAULT '',
      inquiry_form_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending_quote',
      version TEXT DEFAULT 'v1',
      internal_note TEXT DEFAULT '',
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS price_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK(category IN ('nut', 'hardware', 'panel')),
      label TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT '个',
      unit_price REAL NOT NULL DEFAULT 0,
      pricing_mode TEXT NOT NULL DEFAULT 'unit',
      enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT DEFAULT '',
      nut_model TEXT DEFAULT '',
      spec TEXT DEFAULT '',
      material_type TEXT DEFAULT '',
      color TEXT DEFAULT '',
      thickness_mm REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quote_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      length_inch REAL NOT NULL,
      qty REAL NOT NULL DEFAULT 1,
      coefficient REAL NOT NULL DEFAULT 1,
      note TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quote_nuts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      price_item_id INTEGER REFERENCES price_items(id),
      nut_model TEXT DEFAULT '',
      item_name TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      unit TEXT DEFAULT '个',
      note TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quote_hardware (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      price_item_id INTEGER REFERENCES price_items(id),
      item_name TEXT NOT NULL,
      spec TEXT DEFAULT '',
      qty REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      unit TEXT DEFAULT '个',
      note TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quote_panels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      price_item_id INTEGER REFERENCES price_items(id),
      material_type TEXT DEFAULT '',
      color TEXT DEFAULT '',
      thickness_mm REAL,
      material_name TEXT NOT NULL,
      length_inch REAL NOT NULL,
      width_inch REAL NOT NULL,
      qty REAL NOT NULL DEFAULT 1,
      pricing_mode TEXT NOT NULL DEFAULT 'per_sqm',
      price_per_sqm REAL DEFAULT 0,
      fixed_unit_price REAL DEFAULT 0,
      note TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bom_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL DEFAULT 1,
      category TEXT NOT NULL,
      item_name TEXT NOT NULL,
      spec TEXT DEFAULT '',
      qty REAL NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT '个',
      unit_price REAL NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status);
    CREATE INDEX IF NOT EXISTS idx_templates_scenario ON templates(scenario);
    CREATE INDEX IF NOT EXISTS idx_bom_template ON bom_lines(template_id);
    CREATE INDEX IF NOT EXISTS idx_quote_profiles ON quote_profiles(template_id);
    CREATE INDEX IF NOT EXISTS idx_quote_nuts ON quote_nuts(template_id);
    CREATE INDEX IF NOT EXISTS idx_quote_hardware ON quote_hardware(template_id);
    CREATE INDEX IF NOT EXISTS idx_quote_panels ON quote_panels(template_id);
    CREATE INDEX IF NOT EXISTS idx_price_items_category ON price_items(category);
  `);

  ensureColumn(db, "quote_hardware", "price_item_id", "INTEGER REFERENCES price_items(id)");
  ensureColumn(db, "quote_hardware", "spec", "TEXT DEFAULT ''");
  if (columnExists(db, "quote_hardware", "model")) {
    db.exec(
      `UPDATE quote_hardware SET spec = model
       WHERE (spec IS NULL OR TRIM(spec) = '') AND model IS NOT NULL AND TRIM(model) != ''`
    );
  }
  ensureColumn(db, "quote_panels", "price_item_id", "INTEGER REFERENCES price_items(id)");
  ensureColumn(db, "quote_panels", "material_type", "TEXT DEFAULT ''");
  ensureColumn(db, "quote_panels", "color", "TEXT DEFAULT ''");
  ensureColumn(db, "quote_panels", "thickness_mm", "REAL");
  ensureColumn(db, "price_items", "unit_price_internal", "REAL");
  ensureColumn(db, "price_items", "link", "TEXT DEFAULT ''");
  ensureColumn(db, "price_items", "supplier", "TEXT DEFAULT ''");
  ensureColumn(db, "price_items", "color_hex", "TEXT DEFAULT ''");
  ensureColumn(db, "price_items", "image_url", "TEXT DEFAULT ''");
  ensureColumn(db, "templates", "photo_images", "TEXT DEFAULT '[]'");
  ensureColumn(db, "templates", "effect_images", "TEXT DEFAULT '[]'");
  ensureColumn(db, "templates", "render_images", "TEXT DEFAULT '[]'");
  ensureColumn(db, "templates", "skin_upgrade_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "templates", "cover_source", "TEXT DEFAULT ''");
  ensureColumn(db, "templates", "last_audit_note", "TEXT DEFAULT ''");
  ensureColumn(db, "templates", "last_audit_by", "TEXT DEFAULT ''");
  ensureColumn(db, "templates", "last_audit_at", "TEXT");
  ensureColumn(db, "bom_lines", "custom_price_item_id", "INTEGER");

  db.exec(`
    CREATE TABLE IF NOT EXISTS price_items_custom (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_category TEXT NOT NULL,
      item_name TEXT NOT NULL,
      spec TEXT DEFAULT '',
      unit TEXT NOT NULL DEFAULT '个',
      unit_price REAL NOT NULL DEFAULT 0,
      unit_price_internal REAL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT DEFAULT '',
      note TEXT DEFAULT '',
      merged_from_ids TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_custom_category ON price_items_custom(source_category);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      contact TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
  `);

  ensureProfileFormulaSchema(db);
  ensureProfileColorsSchema(db);
  ensureColumn(db, "quote_profiles", "color", "TEXT DEFAULT ''");
  backfillQuoteProfileColors(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE CHECK(length(code) = 2),
      slug_prefix TEXT NOT NULL,
      picker_image TEXT DEFAULT '',
      description TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS scenario_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('effect', 'render')),
      file_path TEXT NOT NULL,
      title TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS scenario_markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_image_id INTEGER NOT NULL REFERENCES scenario_images(id) ON DELETE CASCADE,
      template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
      x_pct REAL NOT NULL,
      y_pct REAL NOT NULL,
      label TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scenario_images_scenario ON scenario_images(scenario_id);
    CREATE INDEX IF NOT EXISTS idx_scenario_markers_image ON scenario_markers(scenario_image_id);
    CREATE INDEX IF NOT EXISTS idx_scenario_markers_template ON scenario_markers(template_id);
  `);

  const { seedScenarios } = require("./scenarios");
  seedScenarios(db);

  migrateScenarioMarkersNullableTemplate(db);

  db.exec(`UPDATE templates SET status = 'pending_quote' WHERE status = 'pending_model'`);

  db.exec(
    `UPDATE price_items SET unit_price_internal = unit_price WHERE unit_price_internal IS NULL`
  );

  seedPriceItems(db);

  initTagsSchema(db);
  migrateTagsFromTemplates(db, TAGS);

  const { initVersionLogSchema } = require("./version-log");
  initVersionLogSchema(db);
}

function migrateScenarioMarkersNullableTemplate(db) {
  const templateCol = db.prepare("PRAGMA table_info(scenario_markers)").all().find((c) => c.name === "template_id");
  if (!templateCol || templateCol.notnull === 0) return;

  db.exec(`
    CREATE TABLE scenario_markers_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_image_id INTEGER NOT NULL REFERENCES scenario_images(id) ON DELETE CASCADE,
      template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
      x_pct REAL NOT NULL,
      y_pct REAL NOT NULL,
      label TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO scenario_markers_new (id, scenario_image_id, template_id, x_pct, y_pct, label, sort_order, created_at)
      SELECT id, scenario_image_id, template_id, x_pct, y_pct, label, sort_order, created_at FROM scenario_markers;
    DROP TABLE scenario_markers;
    ALTER TABLE scenario_markers_new RENAME TO scenario_markers;
    CREATE INDEX IF NOT EXISTS idx_scenario_markers_image ON scenario_markers(scenario_image_id);
    CREATE INDEX IF NOT EXISTS idx_scenario_markers_template ON scenario_markers(template_id);
  `);
}

function parseJsonField(value, fallback) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getQuoteProfiles(db, templateId) {
  return db
    .prepare("SELECT * FROM quote_profiles WHERE template_id = ? ORDER BY sort_order ASC, id ASC")
    .all(templateId);
}

function getQuoteNuts(db, templateId) {
  return db
    .prepare("SELECT * FROM quote_nuts WHERE template_id = ? ORDER BY sort_order ASC, id ASC")
    .all(templateId)
    .map((row) => enrichNutLine(row, row.price_item_id ? getPriceItem(db, row.price_item_id) : null));
}

function getQuoteHardware(db, templateId) {
  return db
    .prepare("SELECT * FROM quote_hardware WHERE template_id = ? ORDER BY sort_order ASC, id ASC")
    .all(templateId)
    .map((row) =>
      enrichHardwareLine(row, row.price_item_id ? getPriceItem(db, row.price_item_id) : null)
    );
}

function getQuotePanels(db, templateId) {
  return db
    .prepare("SELECT * FROM quote_panels WHERE template_id = ? ORDER BY sort_order ASC, id ASC")
    .all(templateId)
    .map((row) =>
      enrichPanelLine(row, row.price_item_id ? getPriceItem(db, row.price_item_id) : null)
    );
}

function getBomLines(db, templateId) {
  return db
    .prepare(
      `SELECT *, (qty * unit_price) AS subtotal FROM bom_lines WHERE template_id = ?
       ORDER BY line_no ASC, id ASC`
    )
    .all(templateId)
    .map((row) =>
      enrichBomLine(row, row.custom_price_item_id ? getCustomItem(db, row.custom_price_item_id) : null)
    );
}

function buildQuoteSummary(db, templateRow) {
  if (!templateRow) return null;
  const profileFormula = getProfileFormula(db);
  return computeQuoteSummary({
    profiles: getQuoteProfiles(db, templateRow.id),
    nuts: getQuoteNuts(db, templateRow.id),
    hardware: getQuoteHardware(db, templateRow.id),
    panels: getQuotePanels(db, templateRow.id),
    legacyBom: getBomLines(db, templateRow.id),
    priceOverrideMin: templateRow.price_override_min,
    priceOverrideMax: templateRow.price_override_max,
    skinUpgradeEnabled: !!templateRow.skin_upgrade_enabled,
    profileFormula
  });
}

function mapTemplate(row, quoteSummary) {
  if (!row) return null;
  const summary = quoteSummary || {
    materialCost: 0,
    price_min: 0,
    price_max: 0,
    price_computed_min: 0,
    price_computed_max: 0
  };

  return {
    ...row,
    tags: parseJsonField(row.tags, []),
    price_factors: parseJsonField(row.price_factors, []),
    gallery_images: parseJsonField(row.gallery_images, []),
    photo_images: parseJsonField(row.photo_images, []),
    effect_images: parseJsonField(row.effect_images, []),
    render_images: parseJsonField(row.render_images, []),
    skin_upgrade_enabled: !!row.skin_upgrade_enabled,
    material_cost: summary.materialCost,
    internal_cost: summary.internalCost ?? 0,
    process_amount: summary.processAmount ?? 0,
    profile_amount: summary.profileAmount ?? 0,
    nut_amount: summary.nutAmount ?? 0,
    hardware_amount: summary.hardwareAmount ?? 0,
    panel_amount: summary.panelAmount ?? 0,
    legacy_amount: summary.legacyAmount ?? 0,
    price_min: summary.price_min,
    price_max: summary.price_max,
    price_computed_min: summary.price_computed_min,
    price_computed_max: summary.price_computed_max
  };
}

function getDb() {
  ensureDirs();
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
  return db;
}

function listTemplates(db, { status, scenario, q, tag, tags } = {}) {
  let sql = `SELECT t.* FROM templates t WHERE 1=1`;
  const params = [];

  if (status) {
    sql += " AND t.status = ?";
    params.push(status);
  }
  if (scenario) {
    sql += " AND t.scenario = ?";
    params.push(scenario);
  }
  const tagNames = [
    ...new Set(
      [...(tags || []), ...(tag ? [tag] : [])].map((n) => String(n || "").trim()).filter(Boolean)
    )
  ];
  if (tagNames.length) {
    const placeholders = tagNames.map(() => "?").join(", ");
    sql += ` AND (
      SELECT COUNT(DISTINCT g.id) FROM template_tags tt
      INNER JOIN tags g ON g.id = tt.tag_id
      WHERE tt.template_id = t.id AND g.name IN (${placeholders}) COLLATE NOCASE
    ) = ?`;
    params.push(...tagNames, tagNames.length);
  }
  if (q) {
    sql += " AND (t.name LIKE ? OR t.template_code LIKE ? OR t.one_liner LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  sql += " ORDER BY t.created_at DESC";
  return db
    .prepare(sql)
    .all(...params)
    .map((row) => mapTemplate(row, buildQuoteSummary(db, row)));
}

function getTemplate(db, id) {
  const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(id);
  if (!row) return null;
  const quote = buildQuoteSummary(db, row);
  return {
    ...mapTemplate(row, quote),
    quote,
    quote_profiles: quote.profileLines,
    quote_nuts: quote.nutLines,
    quote_hardware: quote.hardwareLines,
    quote_panels: quote.panelLines,
    bom: quote.legacyLines
  };
}

function nextSortOrder(db, table, templateId) {
  const row = db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM ${table} WHERE template_id = ?`)
    .get(templateId);
  return (row?.m ?? 0) + 1;
}

module.exports = {
  DATA_DIR,
  DB_PATH,
  UPLOADS_DIR,
  getDb,
  listTemplates,
  getTemplate,
  getBomLines,
  getQuoteProfiles,
  getQuoteNuts,
  getQuoteHardware,
  getQuotePanels,
  buildQuoteSummary,
  mapTemplate,
  parseJsonField,
  nextSortOrder
};
