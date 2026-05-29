const fs = require("fs");
const path = require("path");
const { SCENARIOS } = require("./constants");
const { listTemplates, getTemplate } = require("./db");
const { UPLOADS_DIR, toPublicUrl } = require("./storage");

const SCENARIO_IMAGE_KINDS = {
  effect: { folder: "效果图", label: "效果图" },
  render: { folder: "渲染图", label: "渲染图" }
};
const SCENARIO_PICKER_FOLDER = "封面";

function getScenarioDir(code) {
  return path.join(UPLOADS_DIR, "scenarios", code);
}

function ensureScenarioDirs(code) {
  const base = getScenarioDir(code);
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(path.join(base, SCENARIO_PICKER_FOLDER), { recursive: true });
  for (const kind of Object.values(SCENARIO_IMAGE_KINDS)) {
    fs.mkdirSync(path.join(base, kind.folder), { recursive: true });
  }
  return base;
}

function getFirstEffectImagePath(db, scenarioId) {
  return (
    db
      .prepare(
        `SELECT file_path FROM scenario_images
         WHERE scenario_id = ? AND kind = 'effect'
         ORDER BY sort_order ASC, id ASC LIMIT 1`
      )
      .get(scenarioId)?.file_path || null
  );
}

function attachPickerDisplay(db, scenario) {
  const firstEffect = getFirstEffectImagePath(db, scenario.id);
  const images = firstEffect ? [{ kind: "effect", file_path: firstEffect }] : [];
  return {
    ...scenario,
    picker_display: resolveScenarioPickerImage(scenario, images)
  };
}

function seedScenarios(db) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM scenarios").get().c;
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT INTO scenarios (name, code, slug_prefix, description, sort_order, enabled)
     VALUES (?, ?, ?, '', ?, 1)`
  );
  db.exec("BEGIN");
  try {
    SCENARIOS.forEach((s, i) => {
      insert.run(s.value, s.code, s.slugPrefix, i + 1);
      ensureScenarioDirs(s.code);
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function mapScenario(row, stats = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    slug_prefix: row.slug_prefix,
    slugPrefix: row.slug_prefix,
    value: row.name,
    picker_image: row.picker_image || null,
    description: row.description || "",
    sort_order: row.sort_order,
    enabled: !!row.enabled,
    image_count: stats.image_count ?? 0,
    published_template_count: stats.published_template_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function scenarioStats(db, scenarioId, scenarioName) {
  const image_count = db
    .prepare("SELECT COUNT(*) AS c FROM scenario_images WHERE scenario_id = ?")
    .get(scenarioId).c;
  const published_template_count = db
    .prepare("SELECT COUNT(*) AS c FROM templates WHERE scenario = ? AND status = 'published'")
    .get(scenarioName).c;
  return { image_count, published_template_count };
}

function listScenarios(db, { enabledOnly = false } = {}) {
  let sql = "SELECT * FROM scenarios WHERE 1=1";
  if (enabledOnly) sql += " AND enabled = 1";
  sql += " ORDER BY sort_order ASC, id ASC";
  return db
    .prepare(sql)
    .all()
    .map((row) => attachPickerDisplay(db, mapScenario(row, scenarioStats(db, row.id, row.name))));
}

function listScenariosForMeta(db) {
  return listScenarios(db).map((s) => ({
    value: s.name,
    code: s.code,
    slugPrefix: s.slug_prefix,
    enabled: s.enabled,
    picker_image: s.picker_image,
    picker_display: s.picker_display
  }));
}

function getScenario(db, id) {
  const row = db.prepare("SELECT * FROM scenarios WHERE id = ?").get(id);
  if (!row) return null;
  return mapScenario(row, scenarioStats(db, row.id, row.name));
}

function getScenarioByName(db, name) {
  const row = db.prepare("SELECT * FROM scenarios WHERE name = ?").get(name);
  if (!row) return null;
  return mapScenario(row, scenarioStats(db, row.id, row.name));
}

function getScenarioByCode(db, code) {
  const row = db.prepare("SELECT * FROM scenarios WHERE code = ?").get(code);
  if (!row) return null;
  return mapScenario(row, scenarioStats(db, row.id, row.name));
}

function validateScenarioCode(code) {
  const c = String(code || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) {
    throw new Error("场景代码须为 2 位大写字母");
  }
  return c;
}

function createScenario(db, data) {
  const name = String(data.name || "").trim();
  const code = validateScenarioCode(data.code);
  const slug_prefix = String(data.slug_prefix || data.slugPrefix || "").trim();
  if (!name) throw new Error("请填写场景名称");
  if (!slug_prefix) throw new Error("请填写 slug 前缀");

  const dup = db
    .prepare("SELECT id FROM scenarios WHERE name = ? OR code = ?")
    .get(name, code);
  if (dup) throw new Error("场景名称或代码已存在");

  const sort = db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM scenarios").get().n;
  const result = db
    .prepare(
      `INSERT INTO scenarios (name, code, slug_prefix, description, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name, code, slug_prefix, data.description || "", sort, data.enabled === false ? 0 : 1);

  ensureScenarioDirs(code);
  return getScenario(db, result.lastInsertRowid);
}

function updateScenario(db, id, data) {
  const existing = getScenario(db, id);
  if (!existing) throw new Error("场景不存在");

  const hasTemplates = db
    .prepare("SELECT 1 FROM templates WHERE template_code LIKE ? LIMIT 1")
    .get(`TPL-${existing.code}-%`);

  const sets = [];
  const values = [];

  if (data.name != null) {
    const name = String(data.name).trim();
    if (!name) throw new Error("场景名称不能为空");
    const clash = db.prepare("SELECT id FROM scenarios WHERE name = ? AND id != ?").get(name, id);
    if (clash) throw new Error("场景名称已存在");
    sets.push("name = ?");
    values.push(name);
  }

  if (data.code != null) {
    const code = validateScenarioCode(data.code);
    if (code !== existing.code && hasTemplates) {
      throw new Error("已有模板使用该场景代码，不可修改");
    }
    const clash = db.prepare("SELECT id FROM scenarios WHERE code = ? AND id != ?").get(code, id);
    if (clash) throw new Error("场景代码已存在");
    sets.push("code = ?");
    values.push(code);
  }

  if (data.slug_prefix != null || data.slugPrefix != null) {
    sets.push("slug_prefix = ?");
    values.push(String(data.slug_prefix ?? data.slugPrefix).trim());
  }
  if (data.description != null) {
    sets.push("description = ?");
    values.push(String(data.description));
  }
  if (data.picker_image != null) {
    sets.push("picker_image = ?");
    values.push(data.picker_image || "");
  }
  if (data.sort_order != null) {
    sets.push("sort_order = ?");
    values.push(Number(data.sort_order));
  }
  if (data.enabled != null) {
    sets.push("enabled = ?");
    values.push(data.enabled ? 1 : 0);
  }

  if (!sets.length) return existing;

  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE scenarios SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  if (data.name != null && data.name !== existing.name) {
    db.prepare("UPDATE templates SET scenario = ? WHERE scenario = ?").run(data.name, existing.name);
  }

  return getScenario(db, id);
}

function deleteScenario(db, id) {
  const existing = getScenario(db, id);
  if (!existing) throw new Error("场景不存在");
  const tpl = db.prepare("SELECT COUNT(*) AS c FROM templates WHERE scenario = ?").get(existing.name).c;
  if (tpl > 0) throw new Error("该场景下仍有模板，无法删除（可改为禁用）");

  db.prepare("DELETE FROM scenarios WHERE id = ?").run(id);
  const dir = getScenarioDir(existing.code);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function mapScenarioImage(row, markers = []) {
  return {
    id: row.id,
    scenario_id: row.scenario_id,
    kind: row.kind,
    kind_label: SCENARIO_IMAGE_KINDS[row.kind]?.label || row.kind,
    file_path: row.file_path,
    title: row.title || "",
    sort_order: row.sort_order,
    markers
  };
}

function listScenarioImages(db, scenarioId) {
  const rows = db
    .prepare(
      "SELECT * FROM scenario_images WHERE scenario_id = ? ORDER BY sort_order ASC, id ASC"
    )
    .all(scenarioId);
  return rows.map((row) => {
    const markers = listMarkersForImage(db, row.id);
    return mapScenarioImage(row, markers);
  });
}

function getScenarioImage(db, imageId) {
  const row = db.prepare("SELECT * FROM scenario_images WHERE id = ?").get(imageId);
  if (!row) return null;
  const scenario = getScenario(db, row.scenario_id);
  return {
    ...mapScenarioImage(row, listMarkersForImage(db, row.id)),
    scenario
  };
}

function addScenarioImage(db, scenarioId, { kind, file_path, title }) {
  if (!SCENARIO_IMAGE_KINDS[kind]) throw new Error("无效图片类型");
  const scenario = getScenario(db, scenarioId);
  if (!scenario) throw new Error("场景不存在");
  const sort = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM scenario_images WHERE scenario_id = ?")
    .get(scenarioId).n;
  const result = db
    .prepare(
      `INSERT INTO scenario_images (scenario_id, kind, file_path, title, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(scenarioId, kind, file_path, title || "", sort);
  return getScenarioImage(db, result.lastInsertRowid);
}

function deleteScenarioImage(db, imageId) {
  const img = getScenarioImage(db, imageId);
  if (!img) throw new Error("图片不存在");
  const abs = path.join(UPLOADS_DIR, String(img.file_path).replace(/^\/uploads\//, ""));
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  db.prepare("DELETE FROM scenario_images WHERE id = ?").run(imageId);
}

function mapMarker(row) {
  if (!row) return null;
  return {
    id: row.id,
    scenario_image_id: row.scenario_image_id,
    template_id: row.template_id ?? null,
    template_code: row.template_code ?? null,
    template_name: row.template_name ?? null,
    template_scenario: row.template_scenario ?? null,
    x_pct: row.x_pct,
    y_pct: row.y_pct,
    label: row.label || "",
    sort_order: row.sort_order
  };
}

function getMarker(db, markerId) {
  const row = db
    .prepare(
      `SELECT m.*, t.template_code, t.name AS template_name, t.scenario AS template_scenario
       FROM scenario_markers m
       LEFT JOIN templates t ON t.id = m.template_id
       WHERE m.id = ?`
    )
    .get(Number(markerId));
  return mapMarker(row);
}

function listMarkersForImage(db, imageId) {
  return db
    .prepare(
      `SELECT m.*, t.template_code, t.name AS template_name, t.scenario AS template_scenario
       FROM scenario_markers m
       LEFT JOIN templates t ON t.id = m.template_id
       WHERE m.scenario_image_id = ?
       ORDER BY m.sort_order ASC, m.id ASC`
    )
    .all(imageId)
    .map(mapMarker);
}

function getPublishedTemplate(db, templateId) {
  const row = db.prepare("SELECT id, template_code, name, scenario, status FROM templates WHERE id = ?").get(templateId);
  if (!row) throw new Error("模板不存在");
  if (row.status !== "published") throw new Error("仅可关联已发布模板");
  return row;
}

function findRecentMarkerNear(db, imageId, x_pct, y_pct, windowSec = 2) {
  const row = db
    .prepare(
      `SELECT id FROM scenario_markers
       WHERE scenario_image_id = ?
         AND ABS(x_pct - ?) < 0.2
         AND ABS(y_pct - ?) < 0.2
         AND created_at >= datetime('now', printf('-%d seconds', ?))
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(imageId, Number(x_pct), Number(y_pct), windowSec);
  return row?.id ?? null;
}

function createMarker(db, imageId, data) {
  const img = db.prepare("SELECT * FROM scenario_images WHERE id = ?").get(imageId);
  if (!img) throw new Error("图片不存在");

  const xPct = Number(data.x_pct);
  const yPct = Number(data.y_pct);
  const recentId = findRecentMarkerNear(db, imageId, xPct, yPct);
  if (recentId) return getMarker(db, recentId);

  const templateId =
    data.template_id != null && data.template_id !== "" && Number(data.template_id) > 0
      ? Number(data.template_id)
      : null;
  if (templateId) getPublishedTemplate(db, templateId);

  const sort = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM scenario_markers WHERE scenario_image_id = ?")
    .get(imageId).n;

  const label =
    data.label != null && String(data.label).trim()
      ? String(data.label).trim()
      : templateId
        ? db.prepare("SELECT name FROM templates WHERE id = ?").get(templateId).name
        : "未关联模板";

  const result = db
    .prepare(
      `INSERT INTO scenario_markers (scenario_image_id, template_id, x_pct, y_pct, label, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(imageId, templateId, xPct, yPct, label, sort);

  return getMarker(db, result.lastInsertRowid);
}

function updateMarker(db, markerId, data) {
  const id = Number(markerId);
  const row = db.prepare("SELECT * FROM scenario_markers WHERE id = ?").get(id);
  if (!row) throw new Error("标记不存在");

  const sets = [];
  const values = [];

  if (data.template_id != null) {
    const tid = Number(data.template_id);
    if (tid > 0) {
      getPublishedTemplate(db, tid);
      sets.push("template_id = ?");
      values.push(tid);
      if (data.label == null) {
        sets.push("label = ?");
        values.push(db.prepare("SELECT name FROM templates WHERE id = ?").get(tid).name);
      }
    } else {
      sets.push("template_id = NULL");
      if (data.label == null) {
        sets.push("label = ?");
        values.push("未关联模板");
      }
    }
  }
  if (data.x_pct != null) {
    sets.push("x_pct = ?");
    values.push(Number(data.x_pct));
  }
  if (data.y_pct != null) {
    sets.push("y_pct = ?");
    values.push(Number(data.y_pct));
  }
  if (data.label != null) {
    sets.push("label = ?");
    values.push(String(data.label));
  }

  if (!sets.length) return getMarker(db, id);

  values.push(id);
  db.prepare(`UPDATE scenario_markers SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return getMarker(db, id);
}

function deleteMarker(db, markerId) {
  db.prepare("DELETE FROM scenario_markers WHERE id = ?").run(Number(markerId));
}

function resolveScenarioPickerImage(scenario, images) {
  if (scenario.picker_image) return scenario.picker_image;
  const first = images.find((i) => i.kind === "effect") || images[0];
  return first?.file_path || null;
}

function removeScenarioPickerFile(scenario) {
  if (!scenario?.picker_image) return;
  const rel = String(scenario.picker_image).replace(/^\/uploads\//, "");
  const abs = path.join(UPLOADS_DIR, rel);
  if (!fs.existsSync(abs)) return;
  const pickerDir = path.join(getScenarioDir(scenario.code), SCENARIO_PICKER_FOLDER);
  if (abs.startsWith(pickerDir)) fs.unlinkSync(abs);
}

function setScenarioPickerFromUpload(db, scenarioId, uploadedAbsPath) {
  const scenario = getScenario(db, scenarioId);
  if (!scenario) throw new Error("场景不存在");
  removeScenarioPickerFile(scenario);
  const rel = path.relative(UPLOADS_DIR, uploadedAbsPath).replace(/\\/g, "/");
  const file_path = toPublicUrl(rel);
  return updateScenario(db, scenarioId, { picker_image: file_path });
}

function clearScenarioPicker(db, scenarioId) {
  const scenario = getScenario(db, scenarioId);
  if (!scenario) throw new Error("场景不存在");
  removeScenarioPickerFile(scenario);
  return updateScenario(db, scenarioId, { picker_image: "" });
}

function listPublishedTemplatesForScenario(db, scenarioName) {
  return listTemplates(db, { scenario: scenarioName, status: "published" })
    .sort((a, b) => a.template_code.localeCompare(b.template_code))
    .map((t) => ({
    id: t.id,
    template_code: t.template_code,
    name: t.name,
    scenario: t.scenario,
    cover_image: t.cover_image,
    one_liner: t.one_liner,
    price_min: t.price_min,
    price_max: t.price_max,
    width_mm: t.width_mm,
    depth_mm: t.depth_mm,
    height_mm: t.height_mm,
    tags: t.tags || []
  }));
}

/** 场景手册 Part B：本场景已发布模板 + 标记引用的跨场景已发布模板 */
function listTemplatesForScenarioHandbook(db, scenario, images = []) {
  const byId = new Map();
  for (const row of listTemplates(db, { scenario: scenario.name, status: "published" })) {
    const full = getTemplate(db, row.id);
    if (full) byId.set(full.id, full);
  }
  for (const img of images) {
    for (const m of img.markers || []) {
      const tid = m.template_id != null ? Number(m.template_id) : 0;
      if (!tid || byId.has(tid)) continue;
      const full = getTemplate(db, tid);
      if (full?.status === "published") byId.set(full.id, full);
    }
  }
  return [...byId.values()].sort((a, b) =>
    String(a.template_code).localeCompare(String(b.template_code), "zh-CN")
  );
}

function listPublishedTemplatesForPicker(db, q) {
  return listTemplates(db, { status: "published", q })
    .sort((a, b) => a.template_code.localeCompare(b.template_code))
    .slice(0, 100)
    .map((t) => ({
    id: t.id,
    template_code: t.template_code,
    name: t.name,
    scenario: t.scenario,
    cover_image: t.cover_image,
    one_liner: t.one_liner,
    price_min: t.price_min,
    price_max: t.price_max
  }));
}

module.exports = {
  SCENARIO_IMAGE_KINDS,
  seedScenarios,
  getScenarioDir,
  ensureScenarioDirs,
  listScenarios,
  listScenariosForMeta,
  getScenario,
  getScenarioByName,
  getScenarioByCode,
  createScenario,
  updateScenario,
  deleteScenario,
  listScenarioImages,
  getScenarioImage,
  addScenarioImage,
  deleteScenarioImage,
  getMarker,
  createMarker,
  updateMarker,
  deleteMarker,
  resolveScenarioPickerImage,
  listPublishedTemplatesForPicker,
  listPublishedTemplatesForScenario,
  listTemplatesForScenarioHandbook,
  setScenarioPickerFromUpload,
  clearScenarioPicker,
  SCENARIO_PICKER_FOLDER,
  toPublicUrl
};
