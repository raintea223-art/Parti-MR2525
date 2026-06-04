/**
 * Panel price items: multi-color per entry (same material/thickness/price).
 */

const MIGRATION_NAME = "panel_multi_color_v1";

function buildPanelLabel(material_type, thickness_mm) {
  return `${material_type} · ${thickness_mm}mm`;
}

function panelEntryKeyFields(row) {
  return {
    material_type: (row.material_type || "").trim(),
    thickness_mm: Number(row.thickness_mm),
    pricing_mode: row.pricing_mode || "per_sqm",
    unit_price: Number(row.unit_price) || 0,
    unit_price_internal:
      row.unit_price_internal != null ? Number(row.unit_price_internal) : null,
    supplier: (row.supplier || "").trim()
  };
}

function panelEntryKey(row) {
  const f = panelEntryKeyFields(row);
  return [
    f.material_type,
    f.thickness_mm,
    f.pricing_mode,
    f.unit_price,
    f.unit_price_internal ?? "",
    f.supplier
  ].join("\u0001");
}

function parseColorTokens(colorStr, hexStr = "") {
  const colors = String(colorStr || "")
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hexes = String(hexStr || "")
    .split(/[;；]/)
    .map((s) => s.trim());
  return colors.map((color, i) => ({
    color,
    color_hex: hexes[i] || ""
  }));
}

function normalizeColorsInput(data) {
  if (Array.isArray(data.colors) && data.colors.length) {
    return data.colors
      .map((c) => ({
        color: String(c.color || c.name || "").trim(),
        color_hex: String(c.color_hex || "").trim()
      }))
      .filter((c) => c.color);
  }
  const color = (data.color || "").trim();
  if (!color) return [];
  if (color.includes(";") || color.includes("；")) {
    return parseColorTokens(color, data.color_hex || "");
  }
  return [{ color, color_hex: (data.color_hex || "").trim() }];
}

function ensurePanelColorsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_item_panel_colors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price_item_id INTEGER NOT NULL REFERENCES price_items(id) ON DELETE CASCADE,
      color TEXT NOT NULL,
      color_hex TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(price_item_id, color)
    );
    CREATE INDEX IF NOT EXISTS idx_panel_colors_item ON price_item_panel_colors(price_item_id);

    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function migrationApplied(db, name) {
  const row = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(name);
  return !!row;
}

function markMigration(db, name) {
  db.prepare("INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)").run(name);
}

function listPanelColors(db, priceItemId) {
  return db
    .prepare(
      `SELECT color, color_hex, sort_order FROM price_item_panel_colors
       WHERE price_item_id = ? ORDER BY sort_order ASC, id ASC`
    )
    .all(priceItemId);
}

function getPanelColorHex(db, priceItemId, colorName) {
  if (!priceItemId || !colorName) return "";
  const row = db
    .prepare(
      `SELECT color_hex FROM price_item_panel_colors
       WHERE price_item_id = ? AND color = ?`
    )
    .get(priceItemId, colorName);
  return row?.color_hex || "";
}

function colorAllowedOnItem(db, priceItemId, colorName) {
  if (!priceItemId || !colorName) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM price_item_panel_colors WHERE price_item_id = ? AND color = ?`
    )
    .get(priceItemId, colorName);
  return !!row;
}

function setPanelColors(db, priceItemId, colors) {
  db.prepare("DELETE FROM price_item_panel_colors WHERE price_item_id = ?").run(priceItemId);
  const ins = db.prepare(
    `INSERT INTO price_item_panel_colors (price_item_id, color, color_hex, sort_order)
     VALUES (?, ?, ?, ?)`
  );
  colors.forEach((c, i) => {
    ins.run(priceItemId, c.color, c.color_hex || "", i);
  });
  const first = colors[0];
  if (first) {
    db.prepare(
      `UPDATE price_items SET color = ?, color_hex = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(first.color, first.color_hex || "", priceItemId);
  }
}

function mergePanelColors(existingColors, incomingColors) {
  const byName = new Map(existingColors.map((c) => [c.color, { ...c }]));
  const conflicts = [];
  for (const inc of incomingColors) {
    const prev = byName.get(inc.color);
    if (!prev) {
      byName.set(inc.color, inc);
      continue;
    }
    const prevHex = (prev.color_hex || "").toLowerCase();
    const incHex = (inc.color_hex || "").toLowerCase();
    if (prevHex && incHex && prevHex !== incHex) {
      conflicts.push({ color: inc.color, existing_hex: prev.color_hex, incoming_hex: inc.color_hex });
      continue;
    }
    if (!prevHex && incHex) byName.set(inc.color, inc);
  }
  return {
    colors: [...byName.values()],
    conflicts
  };
}

function addPanelColors(db, priceItemId, incomingColors) {
  const existing = listPanelColors(db, priceItemId);
  const { colors, conflicts } = mergePanelColors(existing, incomingColors);
  if (conflicts.length) {
    const err = new Error(`颜色 ${conflicts.map((c) => c.color).join("、")} 的 HEX 与已有记录冲突`);
    err.code = "COLOR_HEX_CONFLICT";
    err.conflicts = conflicts;
    throw err;
  }
  setPanelColors(db, priceItemId, colors);
  return colors;
}

function attachColorsToPanelItem(db, item) {
  if (!item || item.category !== "panel") return item;
  const colors = listPanelColors(db, item.id);
  return {
    ...item,
    colors,
    color_names: colors.map((c) => c.color)
  };
}

function attachColorsToPanelItems(db, items) {
  return items.map((item) =>
    item.category === "panel" ? attachColorsToPanelItem(db, item) : item
  );
}

function backfillPanelColorsFromMainRow(db) {
  const panels = db
    .prepare(`SELECT id, color, color_hex FROM price_items WHERE category = 'panel'`)
    .all();
  for (const p of panels) {
    const count = db
      .prepare("SELECT COUNT(*) AS c FROM price_item_panel_colors WHERE price_item_id = ?")
      .get(p.id).c;
    if (count > 0) continue;
    const color = (p.color || "").trim();
    if (!color) continue;
    setPanelColors(db, p.id, [{ color, color_hex: p.color_hex || "" }]);
  }
}

function previewMergePanelDuplicates(db) {
  const panels = db
    .prepare(`SELECT * FROM price_items WHERE category = 'panel' ORDER BY id ASC`)
    .all();
  const groups = new Map();
  for (const p of panels) {
    const key = panelEntryKey(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const merges = [];
  const conflicts = [];

  for (const [, items] of groups) {
    if (items.length < 2) continue;
    const keeper = items[0];
    const dropIds = items.slice(1).map((i) => i.id);
    const colorMap = new Map();
    const groupConflicts = [];

    for (const item of items) {
      const fromSub = listPanelColors(db, item.id);
      const sources =
        fromSub.length > 0
          ? fromSub
          : item.color
            ? [{ color: item.color, color_hex: item.color_hex || "" }]
            : [];
      for (const c of sources) {
        const prev = colorMap.get(c.color);
        if (!prev) {
          colorMap.set(c.color, c);
          continue;
        }
        const a = (prev.color_hex || "").toLowerCase();
        const b = (c.color_hex || "").toLowerCase();
        if (a && b && a !== b) {
          groupConflicts.push({
            material_type: keeper.material_type,
            thickness_mm: keeper.thickness_mm,
            color: c.color,
            hex_a: prev.color_hex,
            hex_b: c.color_hex
          });
        }
      }
    }

    if (groupConflicts.length) {
      conflicts.push(...groupConflicts);
      continue;
    }

    merges.push({
      keeper_id: keeper.id,
      drop_ids: dropIds,
      label: buildPanelLabel(keeper.material_type, keeper.thickness_mm),
      colors: [...colorMap.values()],
      material_type: keeper.material_type,
      thickness_mm: keeper.thickness_mm
    });
  }

  return { merges, conflicts, merge_count: merges.length, conflict_count: conflicts.length };
}

function executePanelMerge(db) {
  const preview = previewMergePanelDuplicates(db);
  const stats = { merged: 0, deleted: 0, repointed: 0 };

  db.exec("BEGIN");
  try {
    for (const m of preview.merges) {
      setPanelColors(db, m.keeper_id, m.colors);
      db.prepare(
        `UPDATE price_items SET label = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(m.label, m.keeper_id);

      for (const dropId of m.drop_ids) {
        const r = db
          .prepare(`UPDATE quote_panels SET price_item_id = ? WHERE price_item_id = ?`)
          .run(m.keeper_id, dropId);
        stats.repointed += r.changes;
        db.prepare("DELETE FROM price_items WHERE id = ?").run(dropId);
        stats.deleted += 1;
      }
      stats.merged += 1;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { ...preview, stats };
}

function migratePanelMultiColor(db) {
  ensurePanelColorsSchema(db);
  if (migrationApplied(db, MIGRATION_NAME)) return { skipped: true };

  backfillPanelColorsFromMainRow(db);
  const result = executePanelMerge(db);
  markMigration(db, MIGRATION_NAME);
  return { skipped: false, ...result };
}

module.exports = {
  buildPanelLabel,
  panelEntryKey,
  panelEntryKeyFields,
  parseColorTokens,
  normalizeColorsInput,
  ensurePanelColorsSchema,
  migratePanelMultiColor,
  previewMergePanelDuplicates,
  executePanelMerge,
  listPanelColors,
  getPanelColorHex,
  colorAllowedOnItem,
  setPanelColors,
  addPanelColors,
  attachColorsToPanelItem,
  attachColorsToPanelItems,
  mergePanelColors
};
