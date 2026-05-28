const { SCENARIO_MAP } = require("./constants");

function sanitizeNameSegment(name) {
  const base = String(name || "")
    .replace(/\.skp$/i, "")
    .trim()
    .replace(/[^\w\u4e00-\u9fff\-()（）]/g, "")
    .slice(0, 40);
  return base || "未命名";
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} scenario
 * @param {string} nameFromSkp
 */
function nextTemplateCode(db, scenario, nameFromSkp) {
  const meta = SCENARIO_MAP[scenario];
  if (!meta) throw new Error(`未知应用场景: ${scenario}`);

  const nameSeg = sanitizeNameSegment(nameFromSkp);
  const prefix = `TPL-${meta.code}-${nameSeg}-`;

  const row = db
    .prepare(
      `SELECT MAX(CAST(SUBSTR(template_code, -4) AS INTEGER)) AS max_seq
       FROM templates
       WHERE template_code LIKE ? ESCAPE '\\'`
    )
    .get(prefix.replace(/[%_]/g, "\\$&") + "%");

  const seq = (row?.max_seq ?? 0) + 1;
  const templateCode = `${prefix}${String(seq).padStart(4, "0")}`;
  const slug = `${meta.slugPrefix}-${nameSeg}-${String(seq).padStart(4, "0")}`
    .toLowerCase()
    .replace(/[^\w-]/g, "-")
    .replace(/-+/g, "-");

  return { templateCode, slug, seq, nameSegment: nameSeg };
}

module.exports = { nextTemplateCode, sanitizeNameSegment };
