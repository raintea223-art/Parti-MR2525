const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { buildDeliveryFileName } = require("./delivery");
const { normalizeVersion } = require("./version");
const { SCENARIO_MAP, STATUS_LABELS } = require("./constants");
const { renderStyledXlsx, S } = require("./xlsx-styled");

const UPLOADS_DIR = path.join(__dirname, "..", "data", "uploads");

const TYPE_LABELS = {
  EFF: "效果图",
  RND: "渲染图",
  SKP: "SKP 模型",
  DWG: "加工图纸",
  PDF: "加工图 PDF",
  BOM: "BOM 表",
  MAN: "交付说明书",
  INF: "项目信息"
};

// ── 通用排版工具 ──

function text(value) {
  const s = String(value == null ? "" : value).trim();
  return s || "—";
}

function numOrEmpty(value) {
  const n = Number(value);
  return Number.isFinite(n) && String(value).trim() !== "" ? n : "";
}

function beijingToday() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const pick = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function titleRow(value, colCount) {
  return { height: 38, cells: [{ v: value, s: S.TITLE, span: colCount }] };
}

function subtitleRow(value, colCount) {
  return { height: 25, cells: [{ v: value, s: S.SUBTITLE, span: colCount }] };
}

function sectionRow(value, colCount) {
  return { height: 26, cells: [{ v: value, s: S.SECTION, span: colCount }] };
}

function blankRow(colCount, height = 9) {
  return { height, cells: Array.from({ length: colCount }, () => ({ v: "", s: S.DEFAULT })) };
}

function noteRow(value, colCount) {
  return { height: 20, cells: [{ v: value, s: S.NOTE, span: colCount }] };
}

// 一行两组「标签 / 值」，用于 5 列的 INF 信息区：A 标签 | B:C 值 | D 标签 | E 值
function metaPairRow(left, right) {
  const valueStyle = (item) => (item && item.money ? S.MONEY_PLAIN : S.META_VALUE);
  return {
    height: 24,
    cells: [
      { v: left.label, s: S.META_LABEL },
      { v: left.value, s: valueStyle(left), span: 2 },
      { v: right.label, s: S.META_LABEL },
      { v: right.value, s: valueStyle(right) }
    ]
  };
}

// 一行一组，值横跨 B:E，用于长文本
function metaWideRow(label, value) {
  return {
    height: 30,
    cells: [
      { v: label, s: S.META_LABEL },
      { v: value, s: S.META_VALUE, span: 4 }
    ]
  };
}

function headerRow(labels, extras = []) {
  return {
    height: 28,
    cells: labels.map((v) => ({ v, s: S.HEADER })).concat(extras)
  };
}

// 兼容旧调用：纯二维数组也走带版式的生成器
function buildXlsxBuffer(sheetName, rows) {
  const width = Math.max(1, ...rows.map((r) => (r || []).length));
  return renderStyledXlsx({
    sheetName,
    rows: rows.map((r, i) => ({
      height: i === 0 ? 28 : 20,
      cells: Array.from({ length: width }, (_, c) => ({
        v: (r || [])[c] ?? "",
        s: i === 0 ? S.HEADER : c === 0 ? S.CELL_CENTER : S.CELL
      }))
    }))
  });
}

// ── BOM 表生成（不含任何价格信息）──

function collectBomItems(template) {
  const items = [];

  for (const p of template.quote_profiles || []) {
    items.push({
      category: "型材",
      name: p.color ? `${p.color} MR2525 型材` : "MR2525 型材",
      spec: p.length_inch != null && p.length_inch !== "" ? `长 ${p.length_inch} in` : "—",
      qty: numOrEmpty(p.qty),
      unit: "根"
    });
  }
  for (const n of template.quote_nuts || []) {
    items.push({
      category: "六通",
      name: text(n.item_name || n.nut_model || "六通"),
      spec: text(n.nut_model),
      qty: numOrEmpty(n.qty),
      unit: text(n.unit || "个")
    });
  }
  for (const h of template.quote_hardware || []) {
    items.push({
      category: "五金配件",
      name: text(h.item_name),
      spec: text(h.spec),
      qty: numOrEmpty(h.qty),
      unit: text(h.unit || "个")
    });
  }
  for (const p of template.quote_panels || []) {
    // 板材录入口径：长 / 宽用英寸(in)，厚度用毫米(mm)，原样输出不做换算。
    const dims =
      p.length_inch != null && p.width_inch != null && p.length_inch !== "" && p.width_inch !== ""
        ? `${p.length_inch}×${p.width_inch} in`
        : "—";
    const thickness = p.thickness_mm != null && p.thickness_mm !== "" ? `t=${p.thickness_mm}mm` : "";
    const color = p.color ? ` · ${p.color}` : "";
    items.push({
      category: "板材",
      name: text(p.material_type || p.material_name || "板材"),
      spec: `${[thickness, dims].filter(Boolean).join(" · ") || "—"}${color}`,
      qty: numOrEmpty(p.qty),
      unit: text(p.unit || "块")
    });
  }
  for (const b of template.bom || []) {
    items.push({
      category: text(b.category || "其他"),
      name: text(b.item_name),
      spec: text(b.spec),
      qty: numOrEmpty(b.qty),
      unit: text(b.unit || "个")
    });
  }

  return items;
}

function generateBomXlsx(template) {
  const COLS = 6;
  const code = template.template_code;
  const ver = normalizeVersion(template.version);
  const items = collectBomItems(template);
  const rows = [];

  rows.push(titleRow("Parti 模板 · BOM 材料清单", COLS));
  rows.push(subtitleRow(`${code} · ${text(template.name)} · ${ver} · 生成日期 ${beijingToday()}`, COLS));
  rows.push(blankRow(COLS));

  rows.push(sectionRow("模板标识", COLS));
  rows.push(
    metaPairRow6(
      { label: "模板编号", value: text(code) },
      { label: "中文名", value: text(template.name) }
    )
  );
  rows.push(
    metaPairRow6(
      { label: "应用场景", value: text(template.scenario) },
      { label: "版本", value: ver }
    )
  );
  rows.push(
    metaPairRow6(
      { label: "物料项数", value: `${items.length} 项` },
      { label: "单位口径", value: "按录入单位，不换算" }
    )
  );
  rows.push(blankRow(COLS));

  rows.push(sectionRow("材料明细", COLS));
  const headRowNo = rows.length + 1;
  rows.push(headerRow(["序号", "类别", "名称 / 型号", "规格（按录入单位）", "数量", "单位"]));

  if (!items.length) {
    // 不合并：该行落在 autoFilter 区域内，合并单元格会让 Excel 提示修复
    rows.push({
      height: 24,
      cells: [
        { v: "—", s: S.CELL_CENTER },
        { v: "暂无物料明细", s: S.CELL },
        { v: "", s: S.CELL },
        { v: "", s: S.CELL },
        { v: "", s: S.CELL },
        { v: "", s: S.CELL }
      ]
    });
  } else {
    items.forEach((item, i) => {
      const alt = i % 2 === 1;
      rows.push({
        height: 23,
        cells: [
          { v: i + 1, s: alt ? S.CELL_CENTER_ALT : S.CELL_CENTER },
          { v: item.category, s: alt ? S.CELL_CENTER_ALT : S.CELL_CENTER },
          { v: item.name, s: alt ? S.CELL_ALT : S.CELL },
          { v: item.spec, s: alt ? S.CELL_ALT : S.CELL },
          {
            v: item.qty === "" ? "—" : item.qty,
            s: item.qty === "" ? (alt ? S.CELL_CENTER_ALT : S.CELL_CENTER) : alt ? S.CELL_NUM_ALT : S.CELL_NUM
          },
          { v: item.unit, s: alt ? S.CELL_CENTER_ALT : S.CELL_CENTER }
        ]
      });
    });
  }
  const lastDataRow = rows.length;

  rows.push(blankRow(COLS));
  rows.push(noteRow("单位口径：型材长度按 in（英寸）录入；板材长宽按 in（英寸）录入、厚度按 mm 录入；各行数量单位见「单位」列，均原样保留，不做换算。", COLS));
  rows.push(noteRow("本表只列材料与规格，商务信息见 INF 项目基本信息。", COLS));

  return renderStyledXlsx({
    sheetName: "BOM",
    columnWidths: [7, 13, 28, 42, 11, 10],
    freezeRow: headRowNo,
    autoFilter: { firstRow: headRowNo, lastRow: lastDataRow, lastCol: COLS },
    rows
  });
}

// 6 列的 BOM 用两组成对信息：A 标签 | B:C 值 | D 标签 | E:F 值
function metaPairRow6(left, right) {
  return {
    height: 24,
    cells: [
      { v: left.label, s: S.META_LABEL },
      { v: left.value, s: S.META_VALUE, span: 2 },
      { v: right.label, s: S.META_LABEL },
      { v: right.value, s: S.META_VALUE, span: 2 }
    ]
  };
}

// ── INF（项目基本信息）生成 ──

function scenarioCode(scenarioName) {
  return SCENARIO_MAP[scenarioName]?.code || "";
}

function sequenceOf(templateCode) {
  const m = String(templateCode || "").match(/-(\d{3})$/);
  return m ? m[1] : "";
}

function typeCodeOf(fileName) {
  const parts = String(fileName || "").split("_");
  return parts.length > 1 ? parts[1] : "";
}

function generateInfXlsx(template) {
  const COLS = 5;
  const code = template.template_code;
  const ver = normalizeVersion(template.version);
  const rows = [];

  rows.push(titleRow("Parti 项目基本信息 · INF", COLS));
  rows.push(subtitleRow(`${code} · ${text(template.name)} · ${ver} · 生成日期 ${beijingToday()}`, COLS));
  rows.push(blankRow(COLS));

  rows.push(sectionRow("基础标识", COLS));
  rows.push(
    metaPairRow(
      { label: "模板编号", value: text(code) },
      { label: "场景码", value: text(scenarioCode(template.scenario)) }
    )
  );
  rows.push(
    metaPairRow(
      { label: "中文名", value: text(template.name) },
      { label: "序号", value: text(sequenceOf(code)) }
    )
  );
  rows.push(
    metaPairRow(
      { label: "应用场景", value: text(template.scenario) },
      { label: "版本", value: ver }
    )
  );
  rows.push(
    metaPairRow(
      { label: "状态", value: text(STATUS_LABELS[template.status] || template.status) },
      { label: "建档日期", value: text(String(template.created_at || "").slice(0, 10)) }
    )
  );
  rows.push(blankRow(COLS));

  rows.push(sectionRow("部署与需求", COLS));
  rows.push(
    metaPairRow(
      { label: "部署环境", value: text(template.deploy_env) },
      { label: "面积区间", value: text(template.area_range) }
    )
  );
  rows.push(
    metaPairRow(
      { label: "第一购买理由", value: text(template.first_buying_reason) },
      { label: "源模板", value: text(template.source_template) }
    )
  );
  rows.push(metaWideRow("一句话卖点", text(template.one_liner)));
  rows.push(blankRow(COLS));

  rows.push(sectionRow("商务口径", COLS));
  const price = numOrEmpty(template.package_price);
  rows.push(
    metaPairRow(
      { label: "整包价（含税）", value: price === "" ? "—" : price, money: price !== "" },
      { label: "价格基准日", value: text(template.price_basis_date) }
    )
  );
  rows.push(
    metaPairRow(
      { label: "安装工时（人·h）", value: text(numOrEmpty(template.installation_hours) || "") },
      { label: "关联项目 PRJ", value: text(template.related_prj) }
    )
  );
  rows.push(metaWideRow("报价口径", text(template.quote_note)));
  rows.push(blankRow(COLS));

  rows.push(sectionRow("交付与备注", COLS));
  rows.push(metaWideRow("交付备注 / 缺失件说明", text(template.delivery_note)));
  rows.push(metaWideRow("台账备注", text(template.ledger_note)));
  rows.push(blankRow(COLS));

  rows.push(sectionRow("交付文件清单", COLS));
  rows.push(
    headerRow(["序号", "类型码", "交付件"], [{ v: "文件名全称", s: S.HEADER, span: 2 }])
  );
  const list = Array.isArray(template.delivery_file_list) ? template.delivery_file_list : [];
  if (!list.length) {
    rows.push({
      height: 24,
      cells: [
        { v: "—", s: S.CELL_CENTER },
        { v: "—", s: S.CELL_CENTER },
        { v: "未登记交付文件", s: S.CELL, span: 2 }
      ]
    });
  } else {
    list.forEach((name, i) => {
      const alt = i % 2 === 1;
      const tc = typeCodeOf(name);
      rows.push({
        height: 23,
        cells: [
          { v: i + 1, s: alt ? S.CELL_CENTER_ALT : S.CELL_CENTER },
          { v: text(tc), s: S.TYPE_CODE },
          { v: text(TYPE_LABELS[tc]), s: alt ? S.CELL_ALT : S.CELL },
          { v: text(name), s: alt ? S.CELL_ALT : S.CELL, span: 2 }
        ]
      });
    });
  }
  rows.push(blankRow(COLS));
  rows.push(noteRow("交付包内文件以实际下载结果为准；清单与台账、系统附件三处应保持一致。", COLS));

  return renderStyledXlsx({
    sheetName: "项目信息",
    columnWidths: [20, 26, 18, 22, 46],
    freezeRow: 0,
    landscape: false,
    rows
  });
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
