const { getScenarioByName } = require("./scenarios");

/** Busboy/multer often mis-decodes UTF-8 filenames as latin1. */
function decodeMultipartFilename(name) {
  const raw = String(name || "");
  if (!raw) return "";
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  try {
    const decoded = Buffer.from(raw, "latin1").toString("utf8");
    if (decoded && /[\u4e00-\u9fff]/.test(decoded)) return decoded;
  } catch (_) {}
  return raw;
}

/** Prefer client-provided base name (reliable for drag-drop); fall back to multipart filename. */
function resolveSkpBaseName(body, originalname) {
  const fromClient = String(body?.skpBaseName || "").trim();
  if (fromClient) return fromClient;
  return decodeMultipartFilename(originalname).replace(/\.skp$/i, "").trim();
}

function sanitizeNameSegment(name) {
  const base = String(name || "")
    .replace(/\.skp$/i, "")
    .trim()
    .replace(/[^\w\u4e00-\u9fff\-()（）]/g, "")
    .slice(0, 40);
  return base || "未命名";
}

function buildSlug(meta, seq) {
  return `${meta.slugPrefix}-${String(seq).padStart(3, "0")}`;
}

/** Max sequence for a scenario; supports new (3-digit) and legacy (4-digit / name-suffixed) formats. */
function maxSeqForScenario(db, scenarioCode) {
  const like = `TPL-${scenarioCode.replace(/[%_]/g, "\\$&")}-%`;
  const rows = db
    .prepare(`SELECT template_code FROM templates WHERE template_code LIKE ? ESCAPE '\\'`)
    .all(like);

  let max = 0;
  const re = new RegExp(`^TPL-${scenarioCode}-(\\d+)(?:-|$)`);

  for (const { template_code: tc } of rows) {
    const m = tc.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

function resolveScenarioMeta(db, scenarioName) {
  const row = getScenarioByName(db, scenarioName);
  if (!row) return null;
  if (!row.enabled) {
    const err = new Error(`场景「${scenarioName}」已禁用，不可新建模板`);
    err.status = 403;
    throw err;
  }
  return { code: row.code, slugPrefix: row.slug_prefix, name: row.name };
}

/**
 * Template code: TPL-{场景编号}-{3位顺序号}（模板编号规范 v1.3，不带文件名段）
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} scenario
 * @param {string} nameFromSkp
 */
function nextTemplateCode(db, scenario, nameFromSkp) {
  const meta = resolveScenarioMeta(db, scenario);
  if (!meta) throw new Error(`未知应用场景: ${scenario}`);

  const nameSeg = sanitizeNameSegment(nameFromSkp);
  let seq = maxSeqForScenario(db, meta.code) + 1;

  const existsStmt = db.prepare(
    "SELECT 1 FROM templates WHERE template_code = ? OR slug = ? LIMIT 1"
  );

  let templateCode;
  let slug;
  for (;;) {
    templateCode = `TPL-${meta.code}-${String(seq).padStart(3, "0")}`;
    slug = buildSlug(meta, seq);
    if (!existsStmt.get(templateCode, slug)) break;
    seq += 1;
  }

  return { templateCode, slug, seq, nameSegment: nameSeg };
}

module.exports = {
  nextTemplateCode,
  maxSeqForScenario,
  sanitizeNameSegment,
  decodeMultipartFilename,
  resolveSkpBaseName,
  buildSlug,
  resolveScenarioMeta
};
