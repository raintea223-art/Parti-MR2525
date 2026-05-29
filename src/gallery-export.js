const { getPriceItem } = require("./price-items");
const { getProfileFormula } = require("./profile-formula");
const { profileLineTotal } = require("./pricing");

function csvEscape(val) {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function priceItemMeta(db, priceItemId) {
  if (!priceItemId) return { supplier: "", link: "" };
  const item = getPriceItem(db, priceItemId);
  return {
    supplier: item?.supplier || "",
    link: item?.link || ""
  };
}

const INTERNAL_SHEET_HEADERS = [
  "所属模板编号",
  "模板名称",
  "应用场景",
  "版本",
  "宽mm",
  "深mm",
  "高mm",
  "参考价下限",
  "参考价上限",
  "负责人",
  "内部备注",
  "区块",
  "类别",
  "项目名称",
  "规格/尺寸",
  "颜色",
  "数量",
  "单位",
  "对内单价",
  "对外单价",
  "小计",
  "供应商",
  "采购链接",
  "行备注"
];

function templateMetaRow(t) {
  return {
    code: t.template_code,
    name: t.name,
    scenario: t.scenario,
    version: t.version || "",
    width: t.width_mm ?? "",
    depth: t.depth_mm ?? "",
    height: t.height_mm ?? "",
    priceMin: t.price_min ?? "",
    priceMax: t.price_max ?? "",
    assignee: t.assignee || "",
    internalNote: t.internal_note || ""
  };
}

function pushRow(lines, meta, cells) {
  lines.push(
    [
      meta.code,
      meta.name,
      meta.scenario,
      meta.version,
      meta.width,
      meta.depth,
      meta.height,
      meta.priceMin,
      meta.priceMax,
      meta.assignee,
      meta.internalNote,
      ...cells
    ]
      .map(csvEscape)
      .join(",")
  );
}

function appendTemplateBomRows(db, lines, template) {
  const meta = templateMetaRow(template);
  const q = template.quote;
  if (!q) return;

  const formula = getProfileFormula(db);

  for (const p of q.profileLines || []) {
    const internal = profileLineTotal(p.length_inch, 1, {
      external: false,
      coefficient: p.coefficient,
      formula
    }).unit_price;
    pushRow(lines, meta, [
      "MR2525型材",
      "型材",
      "MR2525",
      [p.color, `${p.length_inch} inch`].filter(Boolean).join(" · "),
      p.color || "",
      p.qty,
      "根",
      internal,
      p.quote_unit ?? p.unit_price,
      p.subtotal,
      "",
      "",
      p.note || ""
    ]);
  }

  for (const n of q.nutLines || []) {
    const pi = priceItemMeta(db, n.price_item_id);
    pushRow(lines, meta, [
      "六通",
      "六通",
      n.item_name,
      n.nut_model || "",
      "",
      n.qty,
      n.unit || "个",
      n.unit_price_internal ?? n.unit_price,
      n.unit_price_external ?? n.unit_price,
      n.subtotal,
      pi.supplier,
      pi.link,
      n.note || ""
    ]);
  }

  for (const h of q.hardwareLines || []) {
    const pi = priceItemMeta(db, h.price_item_id);
    pushRow(lines, meta, [
      "五金配件",
      "配件",
      h.item_name,
      h.spec || "",
      "",
      h.qty,
      h.unit || "个",
      h.unit_price_internal ?? h.unit_price,
      h.unit_price_external ?? h.unit_price,
      h.subtotal,
      pi.supplier,
      pi.link,
      h.note || ""
    ]);
  }

  for (const p of q.panelLines || []) {
    const pi = priceItemMeta(db, p.price_item_id);
    const internalUnit =
      p.pricing_mode === "fixed"
        ? p.fixed_unit_price_internal ?? p.fixed_unit_price
        : p.price_per_sqm_internal ?? p.price_per_sqm;
    pushRow(lines, meta, [
      "板材",
      "面板",
      p.material_name || p.material_type,
      `${p.material_type}/${p.color}/${p.thickness_mm}mm · ${p.length_inch}×${p.width_inch}in`,
      p.color || "",
      p.qty,
      "块",
      internalUnit,
      p.unit_price,
      p.subtotal,
      pi.supplier,
      pi.link,
      p.note || ""
    ]);
  }

  for (const b of q.legacyLines || []) {
    pushRow(lines, meta, [
      "其他",
      b.category,
      b.item_name,
      b.spec,
      "",
      b.qty,
      b.unit,
      b.unit_price,
      b.unit_price,
      b.subtotal,
      "",
      "",
      b.note || ""
    ]);
  }
}

/** 内部生产/采购用清单 CSV（含对内/对外价、供应商、采购链接） */
function buildInternalSheetCsv(db, templates) {
  const lines = [INTERNAL_SHEET_HEADERS.join(",")];
  for (const t of templates) {
    if (t.status !== "published") continue;
    appendTemplateBomRows(db, lines, t);
  }
  return lines.join("\n");
}

function internalSheetFilename(templateCode) {
  return `${templateCode}_清单.csv`;
}

function batchInternalSheetFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `图册-清单-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`;
}

module.exports = {
  csvEscape,
  buildInternalSheetCsv,
  internalSheetFilename,
  batchInternalSheetFilename,
  INTERNAL_SHEET_HEADERS
};
