const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { buildDeliveryFileName } = require("./delivery");
const { normalizeVersion } = require("./version");
const { SCENARIO_MAP } = require("./constants");

const UPLOADS_DIR = path.join(__dirname, "..", "data", "uploads");

// ── 最小 xlsx 生成器（手写 OOXML + adm-zip，无第三方 xlsx 依赖）──

function xmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function colName(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function buildCell(ref, value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function buildSheetXml(rows) {
  const body = rows
    .map((row, r) => {
      const cells = row.map((v, c) => buildCell(`${colName(c)}${r + 1}`, v)).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function buildXlsxBuffer(sheetName, rows) {
  const zip = new AdmZip();
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;

  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes, "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(rootRels, "utf8"));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml, "utf8"));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels, "utf8"));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(buildSheetXml(rows), "utf8"));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml, "utf8"));
  return zip.toBuffer();
}

// ── BOM 表生成 ──

function numOrEmpty(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

function generateBomXlsx(template) {
  const header = [
    ["Parti 模板 BOM 表"],
    ["模板编号", template.template_code],
    ["中文名", template.name],
    ["场景", template.scenario],
    ["版本", normalizeVersion(template.version)],
    ["价格基准日", template.price_basis_date || ""],
    []
  ];

  const detailHeader = ["类别", "名称 / 型号", "规格", "数量", "单位", "单价(元)", "小计(元)"];
  const rows = [];

  for (const p of template.quote_profiles || []) {
    rows.push([
      "型材",
      p.color ? `${p.color} MR2525` : "MR2525 型材",
      `长 ${p.length_inch} in`,
      numOrEmpty(p.qty),
      "根",
      numOrEmpty(p.unit_price),
      numOrEmpty(p.subtotal)
    ]);
  }
  for (const n of template.quote_nuts || []) {
    rows.push([
      "六通",
      n.item_name || n.nut_model || "六通",
      n.nut_model || "",
      numOrEmpty(n.qty),
      n.unit || "个",
      numOrEmpty(n.unit_price),
      numOrEmpty(n.subtotal)
    ]);
  }
  for (const h of template.quote_hardware || []) {
    rows.push([
      "五金配件",
      h.item_name || "",
      h.spec || "",
      numOrEmpty(h.qty),
      h.unit || "个",
      numOrEmpty(h.unit_price),
      numOrEmpty(h.subtotal)
    ]);
  }
  for (const p of template.quote_panels || []) {
    rows.push([
      "板材",
      p.material_type || p.material_name || "板材",
      `${p.thickness_mm != null ? p.thickness_mm + "mm" : "—"} ${p.length_mm}×${p.width_mm}mm`,
      numOrEmpty(p.qty),
      "块",
      numOrEmpty(p.unit_price),
      numOrEmpty(p.subtotal)
    ]);
  }
  for (const b of template.bom || []) {
    rows.push([
      b.category || "其他",
      b.item_name || "",
      b.spec || "",
      numOrEmpty(b.qty),
      b.unit || "",
      numOrEmpty(b.unit_price),
      numOrEmpty(b.subtotal)
    ]);
  }

  const materialCost = numOrEmpty(template.material_cost);
  const processAmount = numOrEmpty(template.process_amount);
  const totalCost =
    Number.isFinite(Number(materialCost)) && Number.isFinite(Number(processAmount))
      ? Number(materialCost) + Number(processAmount)
      : "";

  const totals = [
    ["", "", "", "", "", "物料小计", materialCost],
    ["", "", "", "", "", "加工费(10%)", processAmount],
    ["", "", "", "", "", "内部算价合计", totalCost]
  ];

  const sheetRows = [...header, detailHeader, ...rows, [], ...totals];
  return buildXlsxBuffer("BOM", sheetRows);
}

// ── INF（项目基本信息）生成 ──

function scenarioCode(scenarioName) {
  return SCENARIO_MAP[scenarioName]?.code || "";
}

function sequenceOf(templateCode) {
  const m = String(templateCode || "").match(/-(\d{3})$/);
  return m ? m[1] : "";
}

function generateInfXlsx(template) {
  const code = template.template_code;
  const rows = [
    ["Parti 项目基本信息（INF）"],
    ["模板编号", code],
    ["场景码", scenarioCode(template.scenario)],
    ["场景", template.scenario],
    ["序号", sequenceOf(code)],
    ["中文名", template.name],
    ["部署环境", template.deploy_env || ""],
    ["面积区间", template.area_range || ""],
    ["第一购买理由", template.first_buying_reason || ""],
    ["整包价（含税）", numOrEmpty(template.package_price)],
    ["价格基准日", template.price_basis_date || ""],
    ["安装工时（人·h）", numOrEmpty(template.installation_hours)],
    ["版本", normalizeVersion(template.version)],
    ["状态", template.status],
    ["源模板", template.source_template || ""],
    ["关联项目 PRJ", template.related_prj || ""],
    ["一句话卖点", template.one_liner || ""],
    ["报价口径", template.quote_note || ""],
    ["交付备注 / 缺失件说明", template.delivery_note || ""],
    ["建档日期", template.created_at || ""],
    ["台账备注", template.ledger_note || ""],
    []
  ];
  rows.push(["交付文件清单"]);
  const list = Array.isArray(template.delivery_file_list)
    ? template.delivery_file_list
    : [];
  for (const name of list) rows.push(["", name]);
  return buildXlsxBuffer("项目信息", rows);
}

// ── 交付包打包 ──

function sanitizeFolderName(name) {
  return String(name || "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}

function resolveUploadPath(publicPath) {
  const rel = String(publicPath || "").replace(/^\/uploads\//, "");
  try {
    return path.resolve(UPLOADS_DIR, decodeURIComponent(rel));
  } catch (_) {
    return path.resolve(UPLOADS_DIR, rel);
  }
}

function buildDeliveryPackage(template) {
  const code = template.template_code;
  const folder = `${code} ${sanitizeFolderName(template.name)}`;
  const zip = new AdmZip();
  const ver = normalizeVersion(template.version);

  const addFromDisk = (filePath, zipName) => {
    const abs = resolveUploadPath(filePath);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      zip.addFile(`${folder}/${zipName}`, fs.readFileSync(abs));
      return true;
    }
    return false;
  };

  // SKP
  if (template.skp_file) {
    addFromDisk(template.skp_file, template.skp_delivery_name || path.basename(template.skp_file));
  }
  // EFF / RND 图片
  for (const asset of template.visual_assets || []) {
    addFromDisk(asset.file_path, asset.file_name);
  }
  // DWG / PDF / MAN 附件
  for (const asset of template.delivery_assets || []) {
    addFromDisk(asset.file_path, asset.file_name);
  }
  // BOM / INF 动态生成
  zip.addFile(
    `${folder}/${buildDeliveryFileName({ templateCode: code, typeCode: "BOM", description: "材料清单", version: ver, ext: "xlsx" })}`,
    generateBomXlsx(template)
  );
  zip.addFile(
    `${folder}/${buildDeliveryFileName({ templateCode: code, typeCode: "INF", description: "项目信息", version: ver, ext: "xlsx" })}`,
    generateInfXlsx(template)
  );

  return { buffer: zip.toBuffer(), folder };
}

module.exports = {
  buildXlsxBuffer,
  generateBomXlsx,
  generateInfXlsx,
  buildDeliveryPackage,
  resolveUploadPath,
  sanitizeFolderName
};
