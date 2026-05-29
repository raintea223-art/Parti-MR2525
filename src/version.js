/** 模板版本号：主版本.次版本，如 v1.0 → v1.1（小改）→ v2.0（换模型） */

function parseVersion(raw) {
  const s = (raw || "v1").trim().replace(/^v/i, "");
  const parts = s.split(".");
  const major = Math.max(1, parseInt(parts[0], 10) || 1);
  const minor = parts.length > 1 ? Math.max(0, parseInt(parts[1], 10) || 0) : 0;
  return { major, minor };
}

function formatVersion({ major, minor }) {
  return `v${major}.${minor}`;
}

function normalizeVersion(raw) {
  return formatVersion(parseVersion(raw));
}

/** 审核再次上架（非首次发布）：+0.1 */
function bumpMinor(raw) {
  const v = parseVersion(raw);
  v.minor += 1;
  return formatVersion(v);
}

/** 更换 skp 模型：主版本 +1，次版本归零 */
function bumpMajor(raw) {
  const v = parseVersion(raw);
  v.major += 1;
  v.minor = 0;
  return formatVersion(v);
}

module.exports = {
  parseVersion,
  formatVersion,
  normalizeVersion,
  bumpMinor,
  bumpMajor
};
