const fs = require("fs");
const path = require("path");
const { DELIVERY_FILE_KINDS } = require("./constants");

const DEFAULT_UPLOADS_DIR = path.join(__dirname, "..", "data", "uploads");

const DELIVERY_TYPE_RULES = {
  EFF: { extensions: ["jpg", "png"] },
  RND: { extensions: ["jpg", "png"] },
  SKP: { extensions: ["skp"] },
  DWG: { extensions: ["dwg"] },
  PDF: { extensions: ["pdf"] },
  BOM: { extensions: ["xlsx"] },
  MAN: { extensions: ["pdf"] },
  INF: { extensions: ["xlsx"] }
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDeliveryFileList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return normalizeDeliveryFileList(parsed);
    } catch (_) {}
  }
  return text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function isValidDateText(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function validateDeliveryFileName(templateCode, fileName) {
  const name = String(fileName || "").trim();
  const match = name.match(
    new RegExp(
      `^${escapeRegExp(templateCode)}_(EFF|RND|SKP|DWG|PDF|BOM|MAN|INF)_(?:(\\d{2})_)?([^_]+)_v(\\d+)\\.(\\d+)\\.([A-Za-z0-9]+)$`
    )
  );
  if (!match) return `文件名不符合六段定式：${name}`;

  const typeCode = match[1];
  const description = match[3];
  const extension = match[6].toLowerCase();
  if (!DELIVERY_TYPE_RULES[typeCode].extensions.includes(extension)) {
    return `${typeCode} 文件扩展名不正确：${name}`;
  }
  if (/[\s()（）\u3000-\u303f\uff00-\uffef]/.test(description)) {
    return `文件描述含空格、圆括号或全角符号：${name}`;
  }
  if (/[\\/:*?"<>|\x00-\x1f]/.test(description)) {
    return `文件描述含路径分隔符或系统保留字符：${name}`;
  }
  if (Array.from(description).length > 8) {
    return `文件描述超过 8 字：${name}`;
  }
  return null;
}

function listDeliveryAssets(db, templateId) {
  return db
    .prepare(
      `SELECT * FROM template_delivery_assets
       WHERE template_id = ? ORDER BY kind ASC, id ASC`
    )
    .all(templateId);
}

function listVisualAssets(db, templateId) {
  return db
    .prepare(
      `SELECT * FROM template_visual_assets
       WHERE template_id = ? ORDER BY kind ASC, id ASC`
    )
    .all(templateId);
}

function addVisualAsset(db, { templateId, kind, fileName, filePath, uploadedBy }) {
  const result = db
    .prepare(
      `INSERT INTO template_visual_assets (
        template_id, kind, file_name, file_path, uploaded_by
      ) VALUES (?, ?, ?, ?, ?)`
    )
    .run(templateId, kind, fileName, filePath, uploadedBy || "");
  return db.prepare("SELECT * FROM template_visual_assets WHERE id = ?").get(result.lastInsertRowid);
}

function removeVisualAsset(db, { templateId, kind, filePath }) {
  return db
    .prepare(
      `DELETE FROM template_visual_assets
       WHERE template_id = ? AND kind = ? AND file_path = ?`
    )
    .run(templateId, kind, filePath);
}

function getDeliveryAsset(db, assetId) {
  return db.prepare("SELECT * FROM template_delivery_assets WHERE id = ?").get(assetId);
}

function addDeliveryAsset(db, { templateId, kind, fileName, filePath, uploadedBy }) {
  const result = db
    .prepare(
      `INSERT INTO template_delivery_assets (
        template_id, kind, file_name, file_path, uploaded_by
      ) VALUES (?, ?, ?, ?, ?)`
    )
    .run(templateId, kind, fileName, filePath, uploadedBy || "");
  return getDeliveryAsset(db, result.lastInsertRowid);
}

function removeDeliveryAsset(db, assetId) {
  const asset = getDeliveryAsset(db, assetId);
  if (!asset) return null;
  db.prepare("DELETE FROM template_delivery_assets WHERE id = ?").run(assetId);
  return asset;
}

function isProtectedDeliveryAssetPath(requestPath) {
  let decodedPath = String(requestPath || "");
  try {
    decodedPath = decodeURIComponent(decodedPath);
  } catch (_) {}
  const folders = new Set(Object.values(DELIVERY_FILE_KINDS).map((item) => item.folder));
  return decodedPath
    .replace(/\\/g, "/")
    .split("/")
    .some((part) => folders.has(part));
}

function deliveryTypeCode(fileName) {
  return String(fileName || "").match(/_(EFF|RND|SKP|DWG|PDF|BOM|MAN|INF)_/)?.[1] || "";
}

function validatePublishReadiness(template, { uploadsDir = DEFAULT_UPLOADS_DIR } = {}) {
  const errors = [];
  const files = normalizeDeliveryFileList(template.delivery_file_list);
  const assets = template.delivery_assets || [];
  const visualAssets = template.visual_assets || [];
  const photoImages = template.photo_images || [];
  const effectImages = template.effect_images || [];
  const renderImages = template.render_images || [];

  const checkActualFile = (publicPath, extensions, label, expectedFolder = "") => {
    const value = String(publicPath || "");
    const extension = path.extname(value).toLowerCase();
    if (!extensions.includes(extension)) {
      errors.push(`${label}扩展名不正确：${value || "—"}`);
      return;
    }
    const normalized = value.replace(/\\/g, "/");
    if (expectedFolder && !normalized.includes(`/${expectedFolder}/`)) {
      errors.push(`${label}未存放在 ${expectedFolder} 目录：${value}`);
    }
    if (!uploadsDir) return;
    if (!normalized.startsWith("/uploads/")) {
      errors.push(`${label}路径不在 uploads 下：${value}`);
      return;
    }
    let relativePath = normalized.slice("/uploads/".length);
    try {
      relativePath = decodeURIComponent(relativePath);
    } catch (_) {}
    const templateDir = path.resolve(uploadsDir, template.template_code);
    const absolutePath = path.resolve(uploadsDir, relativePath);
    if (!absolutePath.startsWith(templateDir + path.sep)) {
      errors.push(`${label}路径越出当前模板目录：${value}`);
      return;
    }
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      errors.push(`${label}物理文件不存在：${value}`);
    }
  };

  const packagePrice = Number(template.package_price);
  if (!Number.isFinite(packagePrice) || packagePrice <= 0) {
    errors.push("整包价含税必须为大于 0 的数值");
  }
  if (!isValidDateText(template.price_basis_date)) {
    errors.push("价格基准日必须为有效日期，格式 YYYY-MM-DD");
  }
  const installationHours = Number(template.installation_hours);
  if (!Number.isFinite(installationHours) || installationHours <= 0) {
    errors.push("安装工时必须为大于 0 的人·h 总量");
  }
  if (!files.length) errors.push("交付文件清单不能为空");

  const counts = Object.fromEntries(Object.keys(DELIVERY_TYPE_RULES).map((key) => [key, 0]));
  const seen = new Set();
  for (const fileName of files) {
    if (seen.has(fileName)) errors.push(`交付文件清单存在重复项：${fileName}`);
    seen.add(fileName);
    const fileError = validateDeliveryFileName(template.template_code, fileName);
    if (fileError) {
      errors.push(fileError);
      continue;
    }
    counts[deliveryTypeCode(fileName)] += 1;
  }

  if (counts.EFF + counts.RND < 1) errors.push("交付清单中 EFF / RND 至少一类");
  if (counts.SKP !== 1) errors.push("交付清单应且仅含 1 个 SKP 文件");
  for (const typeCode of ["DWG", "PDF", "BOM", "MAN", "INF"]) {
    if (counts[typeCode] < 1) errors.push(`交付清单缺少 ${typeCode} 文件`);
  }
  if (counts.RND === 0 && counts.EFF > 0 && !template.eff_rnd_merged) {
    errors.push("RND 并入 EFF 时必须勾选合并留痕");
  }
  if (template.eff_rnd_merged && !String(template.delivery_note || "").trim()) {
    errors.push("EFF/RND 合并时须在交付备注中留痕");
  }

  if (!template.skp_file) errors.push("系统缺少 SKP 源文件");
  else checkActualFile(template.skp_file, [".skp"], "SKP 源文件");
  const skpDeliveryName = String(template.skp_delivery_name || "").trim();
  if (!skpDeliveryName) {
    errors.push("SKP 缺少原始交付文件名登记，请重新上传 SKP");
  } else {
    const skpNameError = validateDeliveryFileName(template.template_code, skpDeliveryName);
    if (skpNameError) errors.push(skpNameError);
    if (deliveryTypeCode(skpDeliveryName) !== "SKP") {
      errors.push(`SKP 与原始交付文件名类型不一致：${skpDeliveryName}`);
    }
    if (!files.includes(skpDeliveryName)) {
      errors.push(`系统 SKP 未列入交付文件清单：${skpDeliveryName}`);
    }
  }
  for (const image of photoImages) checkActualFile(image, [".jpg", ".jpeg", ".png", ".webp"], "实拍照片", "实拍照片");
  if (effectImages.length + renderImages.length < 1) {
    errors.push("系统须上传效果图或渲染图至少一类");
  }
  if (!renderImages.length && effectImages.length && !template.eff_rnd_merged) {
    errors.push("系统未上传渲染图时须勾选 EFF/RND 合并留痕");
  }

  for (const [kind, images, typeCode, folder] of [
    ["effect", effectImages, "EFF", "效果图"],
    ["render", renderImages, "RND", "渲染图"]
  ]) {
    const registered = visualAssets.filter((asset) => asset.kind === kind);
    for (const image of images) {
      checkActualFile(image, [".jpg", ".png"], typeCode, folder);
      if (!registered.some((asset) => asset.file_path === image)) {
        errors.push(`${typeCode} 图片缺少原始交付文件名登记，请重新上传：${image}`);
      }
    }
    for (const asset of registered) {
      const fileError = validateDeliveryFileName(template.template_code, asset.file_name);
      if (fileError) errors.push(fileError);
      if (deliveryTypeCode(asset.file_name) !== typeCode) {
        errors.push(`${typeCode} 图片与原始文件名类型不一致：${asset.file_name}`);
      }
      if (!files.includes(asset.file_name)) {
        errors.push(`系统图片未列入交付文件清单：${asset.file_name}`);
      }
      if (!images.includes(asset.file_path)) {
        errors.push(`${typeCode} 图片登记未同步到模板：${asset.file_path}`);
      }
      checkActualFile(asset.file_path, [".jpg", ".png"], typeCode, folder);
    }
  }

  for (const [kind, definition] of Object.entries(DELIVERY_FILE_KINDS)) {
    const typedAssets = assets.filter((asset) => asset.kind === kind);
    if (!typedAssets.length) errors.push(`系统缺少${definition.label}附件`);
    for (const asset of typedAssets) {
      const fileError = validateDeliveryFileName(template.template_code, asset.file_name);
      if (fileError) errors.push(fileError);
      if (deliveryTypeCode(asset.file_name) !== definition.typeCode) {
        errors.push(`${definition.label}与原始文件名类型不一致：${asset.file_name}`);
      }
      if (!files.includes(asset.file_name)) {
        errors.push(`系统附件未列入交付文件清单：${asset.file_name}`);
      }
      checkActualFile(asset.file_path, definition.extensions, definition.label, definition.folder);
    }
  }

  for (const fileName of files) {
    const typeCode = deliveryTypeCode(fileName);
    if (["DWG", "PDF", "BOM", "MAN", "INF"].includes(typeCode)) {
      const kind = typeCode.toLowerCase();
      if (!assets.some((asset) => asset.kind === kind && asset.file_name === fileName)) {
        errors.push(`交付清单中的 ${typeCode} 文件尚未实际上传：${fileName}`);
      }
    }
    if (typeCode === "EFF" || typeCode === "RND") {
      const kind = typeCode === "EFF" ? "effect" : "render";
      if (!visualAssets.some((asset) => asset.kind === kind && asset.file_name === fileName)) {
        errors.push(`交付清单中的 ${typeCode} 图片尚未实际上传：${fileName}`);
      }
    }
  }

  const actualFileNames = [...visualAssets, ...assets].map((asset) => asset.file_name);
  const actualSeen = new Set();
  for (const fileName of actualFileNames) {
    if (actualSeen.has(fileName)) errors.push(`系统存在重复的原始交付文件名：${fileName}`);
    actualSeen.add(fileName);
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

module.exports = {
  DELIVERY_TYPE_RULES,
  normalizeDeliveryFileList,
  isValidDateText,
  validateDeliveryFileName,
  listDeliveryAssets,
  listVisualAssets,
  addVisualAsset,
  removeVisualAsset,
  getDeliveryAsset,
  addDeliveryAsset,
  removeDeliveryAsset,
  validatePublishReadiness,
  isProtectedDeliveryAssetPath
};
