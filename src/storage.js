const fs = require("fs");
const path = require("path");
const { IMAGE_KINDS } = require("./constants");

const UPLOADS_DIR = path.join(__dirname, "..", "data", "uploads");

const AUDIT_ARCHIVE_DIR = path.join(UPLOADS_DIR, "审核存档");
const AUDIT_CSV_PATH = path.join(AUDIT_ARCHIVE_DIR, "审核记录.csv");

function getTemplateAssetDir(templateCode) {
  return path.join(UPLOADS_DIR, templateCode);
}

function ensureTemplateAssetDirs(templateCode) {
  const base = getTemplateAssetDir(templateCode);
  fs.mkdirSync(base, { recursive: true });
  for (const kind of Object.values(IMAGE_KINDS)) {
    fs.mkdirSync(path.join(base, kind.folder), { recursive: true });
  }
  return base;
}

function ensureAuditArchiveDir() {
  fs.mkdirSync(AUDIT_ARCHIVE_DIR, { recursive: true });
  return AUDIT_ARCHIVE_DIR;
}

function getAuditTemplateDir(templateCode) {
  return path.join(AUDIT_ARCHIVE_DIR, templateCode);
}

function toPublicUrl(relativePath) {
  return `/uploads/${String(relativePath).replace(/\\/g, "/")}`;
}

function relFromUploads(absPath) {
  return path.relative(UPLOADS_DIR, absPath).replace(/\\/g, "/");
}

function listImageFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .sort()
    .map((f) => toPublicUrl(path.join(relFromUploads(dir), f)));
}

function parseCoverSource(coverSource) {
  if (!coverSource) return null;
  const m = String(coverSource).match(/^(photo|effect):(\d+)$/);
  if (!m) return null;
  return { kind: m[1], index: Number(m[2]) };
}

function resolveCover({ photo_images = [], effect_images = [], cover_source = null, cover_image = null }) {
  const parsed = parseCoverSource(cover_source);
  if (parsed) {
    const list = parsed.kind === "photo" ? photo_images : effect_images;
    if (list[parsed.index]) return list[parsed.index];
  }
  if (cover_image) return cover_image;
  if (photo_images.length) return photo_images[0];
  if (effect_images.length) return effect_images[0];
  return null;
}

function syncTemplateImages(db, templateRow) {
  const code = templateRow.template_code;
  const base = getTemplateAssetDir(code);
  const photoDir = path.join(base, IMAGE_KINDS.photo.folder);
  const effectDir = path.join(base, IMAGE_KINDS.effect.folder);
  const renderDir = path.join(base, IMAGE_KINDS.render.folder);

  const photo_images = listImageFiles(photoDir);
  const effect_images = listImageFiles(effectDir);
  const render_images = listImageFiles(renderDir);
  const cover_image = resolveCover({
    photo_images,
    effect_images,
    cover_source: templateRow.cover_source,
    cover_image: templateRow.cover_image
  });

  db.prepare(
    `UPDATE templates SET
      photo_images = ?,
      effect_images = ?,
      render_images = ?,
      cover_image = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    JSON.stringify(photo_images),
    JSON.stringify(effect_images),
    JSON.stringify(render_images),
    cover_image,
    templateRow.id
  );

  return { photo_images, effect_images, render_images, cover_image };
}

function getSkpPath(templateCode) {
  return path.join(getTemplateAssetDir(templateCode), `${templateCode}.skp`);
}

function deleteTemplateAssets(templateCode) {
  const dir = getTemplateAssetDir(templateCode);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = {
  UPLOADS_DIR,
  AUDIT_ARCHIVE_DIR,
  AUDIT_CSV_PATH,
  getTemplateAssetDir,
  ensureTemplateAssetDirs,
  ensureAuditArchiveDir,
  getAuditTemplateDir,
  toPublicUrl,
  relFromUploads,
  listImageFiles,
  resolveCover,
  syncTemplateImages,
  getSkpPath,
  parseCoverSource,
  deleteTemplateAssets
};
