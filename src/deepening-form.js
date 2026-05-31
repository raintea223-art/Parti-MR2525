const AdmZip = require("adm-zip");
const { CUSTOM_BOM_CATEGORIES } = require("./constants");
const { listPriceItems, getPriceItem, resolvePanelPricing } = require("./price-items");
const { findCustomItem, createCustomItem } = require("./price-custom");
const { resolveProfileColorForWrite, listProfileColors } = require("./profile-colors");
const { syncTemplateTags } = require("./tags");

const FORM_FORMAT = "mr2525-template-form-v1";

function csvEscape(val) {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(values) {
  return values.map(csvEscape).join(",");
}

function parseCsvRows(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line, idx) => {
    const cols = line.split(",").map((c) => c.trim());
    const row = { _line: idx + 2 };
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function parseBool(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "是" || s === "yes";
}

function normalizeSource(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (s === "catalog" || s === "单价库" || s === "库") return "catalog";
  if (s === "manual" || s === "手动" || s === "手动录入") return "manual";
  return s || "catalog";
}

function buildCatalogSnapshot(db) {
  const nuts = listPriceItems(db, { category: "nut", enabledOnly: true });
  const hardware = listPriceItems(db, { category: "hardware", enabledOnly: true });
  const panels = listPriceItems(db, { category: "panel", enabledOnly: true });
  const profileColors = listProfileColors(db, { activeOnly: true }).map((c) => c.name);
  return { nuts, hardware, panels, profileColors };
}

function templateToFormPayload(template, { empty = false } = {}) {
  const basic = empty
    ? {
        name: "",
        width_mm: null,
        depth_mm: null,
        height_mm: null,
        one_liner: "",
        quote_note: "",
        price_override_min: null,
        price_override_max: null,
        skin_upgrade_enabled: false,
        internal_note: "",
        tags: []
      }
    : {
        name: template.name,
        width_mm: template.width_mm ?? null,
        depth_mm: template.depth_mm ?? null,
        height_mm: template.height_mm ?? null,
        one_liner: template.one_liner || "",
        quote_note: template.quote_note || "",
        price_override_min: template.price_override_min ?? null,
        price_override_max: template.price_override_max ?? null,
        skin_upgrade_enabled: !!template.skin_upgrade_enabled,
        internal_note: template.internal_note || "",
        tags: [...(template.tags || [])]
      };

  const quote = empty
    ? { profiles: [], nuts: [], hardware: [], legacy: [] }
    : {
        profiles: (template.quote_profiles || []).map((p) => ({
          color: p.color || "",
          length_inch: p.length_inch,
          qty: p.qty,
          coefficient: p.coefficient ?? 1,
          note: p.note || ""
        })),
        nuts: (template.quote_nuts || []).map((n) => ({
          price_item_id: n.price_item_id,
          qty: n.qty,
          note: n.note || ""
        })),
        hardware: (template.quote_hardware || []).map((h) => ({
          source: "catalog",
          price_item_id: h.price_item_id,
          qty: h.qty,
          note: h.note || ""
        })),
        panels: (template.quote_panels || []).map((p) => ({
          price_item_id: p.price_item_id,
          length_inch: p.length_inch,
          width_inch: p.width_inch,
          qty: p.qty,
          note: p.note || ""
        })),
        legacy: (template.bom || []).map((b) => ({
          category: b.category,
          item_name: b.item_name,
          spec: b.spec || "",
          qty: b.qty,
          unit: b.unit || "个",
          unit_price: b.unit_price,
          note: b.note || ""
        }))
      };

  return {
    format: FORM_FORMAT,
    template_code: template.template_code,
    exported_at: new Date().toISOString(),
    readonly: {
      template_code: template.template_code,
      scenario: template.scenario,
      assignee: template.assignee || "",
      version: template.version || ""
    },
    basic,
    quote
  };
}

function buildBasicCsv(payload) {
  const b = payload.basic;
  const lines = [
    "字段,值",
    `模板编号(只读),${payload.readonly.template_code}`,
    `场景(只读),${payload.readonly.scenario}`,
    `负责人(只读),${payload.readonly.assignee}`,
    `版本(只读),${payload.readonly.version}`,
    `名称,${b.name || ""}`,
    `宽mm,${b.width_mm ?? ""}`,
    `深mm,${b.depth_mm ?? ""}`,
    `高mm,${b.height_mm ?? ""}`,
    `一句话卖点,${b.one_liner || ""}`,
    `报价口径,${b.quote_note || ""}`,
    `参考价下限,${b.price_override_min ?? ""}`,
    `参考价上限,${b.price_override_max ?? ""}`,
    `可定制,${b.skin_upgrade_enabled ? "是" : "否"}`,
    `内部备注,${b.internal_note || ""}`,
    `标签,${(b.tags || []).join(";")}`
  ];
  return lines.join("\n");
}

function buildProfilesCsv(quote) {
  const lines = ["颜色,长度in,数量,系数,备注"];
  for (const p of quote.profiles || []) {
    lines.push(
      csvRow([p.color, p.length_inch, p.qty, p.coefficient ?? 1, p.note || ""])
    );
  }
  return lines.join("\n");
}

function buildNutsCsv(quote) {
  const lines = ["price_item_id,数量,备注"];
  for (const n of quote.nuts || []) {
    lines.push(csvRow([n.price_item_id, n.qty, n.note || ""]));
  }
  return lines.join("\n");
}

function buildHardwareCsv(quote) {
  const lines = ["source,price_item_id,名称,规格,单位,单价,数量,备注"];
  for (const h of quote.hardware || []) {
    lines.push(
      csvRow([
        h.source || "catalog",
        h.price_item_id ?? "",
        h.item_name || "",
        h.spec || "",
        h.unit || "",
        h.unit_price ?? "",
        h.qty,
        h.note || ""
      ])
    );
  }
  return lines.join("\n");
}

function buildPanelsCsv(quote) {
  const lines = ["price_item_id,长in,宽in,数量,备注"];
  for (const p of quote.panels || []) {
    lines.push(csvRow([p.price_item_id, p.length_inch, p.width_inch, p.qty, p.note || ""]));
  }
  return lines.join("\n");
}

function buildLegacyCsv(quote) {
  const lines = ["类别,项目名称,规格,数量,单位,单价,备注"];
  for (const b of quote.legacy || []) {
    lines.push(
      csvRow([
        b.category,
        b.item_name,
        b.spec || "",
        b.qty,
        b.unit || "个",
        b.unit_price,
        b.note || ""
      ])
    );
  }
  return lines.join("\n");
}

function buildCatalogCsvs(catalog) {
  const nutLines = ["price_item_id,名称,型号,单位,对外单价"];
  for (const n of catalog.nuts) {
    nutLines.push(csvRow([n.id, n.label, n.nut_model || "", n.unit, n.unit_price_external ?? n.unit_price]));
  }
  const hwLines = ["price_item_id,名称,规格,单位,对外单价"];
  for (const h of catalog.hardware) {
    hwLines.push(csvRow([h.id, h.label, h.spec || "", h.unit, h.unit_price_external ?? h.unit_price]));
  }
  const panelLines = ["price_item_id,材质,颜色,厚度mm,计价方式,对外单价"];
  for (const p of catalog.panels) {
    panelLines.push(
      csvRow([
        p.id,
        p.material_type,
        p.color,
        p.thickness_mm,
        p.pricing_mode === "fixed" ? "固定件价" : "按㎡",
        p.unit_price_external ?? p.unit_price
      ])
    );
  }
  const colorLines = ["颜色名称", ...catalog.profileColors.map((c) => csvRow([c]))].join("\n");
  return {
    "catalog-六通.csv": nutLines.join("\n"),
    "catalog-五金.csv": hwLines.join("\n"),
    "catalog-板材.csv": panelLines.join("\n"),
    "catalog-型材颜色.csv": colorLines
  };
}

function buildInstructionsText() {
  return `MR2525 模板深化表单 · 填写说明

1. 先在 catalog-*.csv 中查找单价库 ID。
2. 六通、板材：仅填写 price_item_id（必填），须在对应 catalog 中存在。
3. 五金：source 填 catalog 或 manual。
   - catalog：填写 price_item_id
   - manual：填写名称、规格、单位、单价；若无法匹配单价库，导入时将自动归入「其他」
4. 型材颜色见 catalog-型材颜色.csv。
5. 填写完成后保留 form.json 或整个 ZIP 包，交回录入员拖拽导入。

请勿修改「只读」字段。`;
}

function exportFormJson(template, db, { empty = false } = {}) {
  return templateToFormPayload(template, { empty });
}

function exportFormZipBuffer(template, db, { empty = false } = {}) {
  const payload = templateToFormPayload(template, { empty });
  const catalog = buildCatalogSnapshot(db);
  const zip = new AdmZip();
  zip.addFile("00-填写说明.txt", Buffer.from("\uFEFF" + buildInstructionsText(), "utf8"));
  zip.addFile("01-基本信息.csv", Buffer.from("\uFEFF" + buildBasicCsv(payload), "utf8"));
  zip.addFile("02-型材.csv", Buffer.from("\uFEFF" + buildProfilesCsv(payload.quote), "utf8"));
  zip.addFile("03-六通.csv", Buffer.from("\uFEFF" + buildNutsCsv(payload.quote), "utf8"));
  zip.addFile("04-五金.csv", Buffer.from("\uFEFF" + buildHardwareCsv(payload.quote), "utf8"));
  zip.addFile("05-板材.csv", Buffer.from("\uFEFF" + buildPanelsCsv(payload.quote), "utf8"));
  zip.addFile("06-其他.csv", Buffer.from("\uFEFF" + buildLegacyCsv(payload.quote), "utf8"));
  const catalogCsvs = buildCatalogCsvs(catalog);
  for (const [name, body] of Object.entries(catalogCsvs)) {
    zip.addFile(name, Buffer.from("\uFEFF" + body, "utf8"));
  }
  zip.addFile("form.json", Buffer.from(JSON.stringify(payload, null, 2), "utf8"));
  return zip.toBuffer();
}

function zipFilename(templateCode) {
  return `${templateCode}_深化表单.zip`;
}

function jsonFilename(templateCode) {
  return `${templateCode}_深化表单.json`;
}

function parseBasicCsv(text) {
  const rows = parseCsvRows(text);
  const map = Object.fromEntries(rows.map((r) => [r["字段"], r["值"]]));
  const tagsRaw = map["标签"] || "";
  const tags = tagsRaw
    .split(/[;；]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    name: map["名称"] || "",
    width_mm: numOrNull(map["宽mm"]),
    depth_mm: numOrNull(map["深mm"]),
    height_mm: numOrNull(map["高mm"]),
    one_liner: map["一句话卖点"] || "",
    quote_note: map["报价口径"] || "",
    price_override_min: numOrNull(map["参考价下限"]),
    price_override_max: numOrNull(map["参考价上限"]),
    skin_upgrade_enabled: parseBool(map["可定制"]),
    internal_note: map["内部备注"] || "",
    tags,
    _template_code: map["模板编号(只读)"] || map["模板编号"] || ""
  };
}

function parseProfilesCsv(text) {
  return parseCsvRows(text).map((r) => ({
    color: r["颜色"] || r.color || "",
    length_inch: numOrNull(r["长度in"] ?? r.length_inch),
    qty: numOrNull(r["数量"] ?? r.qty) ?? 1,
    coefficient: numOrNull(r["系数"] ?? r.coefficient) ?? 1,
    note: r["备注"] || r.note || "",
    _line: r._line
  }));
}

function parseNutsCsv(text) {
  return parseCsvRows(text).map((r) => ({
    price_item_id: numOrNull(r.price_item_id ?? r["price_item_id"]),
    qty: numOrNull(r["数量"] ?? r.qty) ?? 1,
    note: r["备注"] || r.note || "",
    _line: r._line
  }));
}

function parseHardwareCsv(text) {
  return parseCsvRows(text).map((r) => ({
    source: normalizeSource(r.source ?? r["source"]),
    price_item_id: numOrNull(r.price_item_id ?? r["price_item_id"]),
    item_name: r["名称"] || r.item_name || "",
    spec: r["规格"] || r.spec || "",
    unit: r["单位"] || r.unit || "个",
    unit_price: numOrNull(r["单价"] ?? r.unit_price),
    qty: numOrNull(r["数量"] ?? r.qty) ?? 1,
    note: r["备注"] || r.note || "",
    _line: r._line
  }));
}

function parsePanelsCsv(text) {
  return parseCsvRows(text).map((r) => ({
    price_item_id: numOrNull(r.price_item_id ?? r["price_item_id"]),
    length_inch: numOrNull(r["长in"] ?? r.length_inch),
    width_inch: numOrNull(r["宽in"] ?? r.width_inch),
    qty: numOrNull(r["数量"] ?? r.qty) ?? 1,
    note: r["备注"] || r.note || "",
    _line: r._line
  }));
}

function parseLegacyCsv(text) {
  return parseCsvRows(text).map((r) => ({
    category: r["类别"] || r.category || "其他",
    item_name: r["项目名称"] || r.item_name || "",
    spec: r["规格"] || r.spec || "",
    qty: numOrNull(r["数量"] ?? r.qty) ?? 1,
    unit: r["单位"] || r.unit || "个",
    unit_price: numOrNull(r["单价"] ?? r.unit_price),
    note: r["备注"] || r.note || "",
    _line: r._line
  }));
}

function parseUploadBuffer(buffer, originalName) {
  const name = String(originalName || "").toLowerCase();
  if (name.endsWith(".json")) {
    const payload = JSON.parse(buffer.toString("utf8"));
    return normalizePayload(payload);
  }
  if (name.endsWith(".zip")) {
    const zip = new AdmZip(buffer);
    const jsonEntry = zip.getEntry("form.json");
    if (jsonEntry) {
      return normalizePayload(JSON.parse(jsonEntry.getData().toString("utf8")));
    }
    const read = (fn) => {
      const e = zip.getEntry(fn);
      return e ? e.getData().toString("utf8") : "";
    };
    const basic = parseBasicCsv(read("01-基本信息.csv"));
    return normalizePayload({
      format: FORM_FORMAT,
      template_code: basic._template_code,
      basic,
      quote: {
        profiles: parseProfilesCsv(read("02-型材.csv")),
        nuts: parseNutsCsv(read("03-六通.csv")),
        hardware: parseHardwareCsv(read("04-五金.csv")),
        panels: parsePanelsCsv(read("05-板材.csv")),
        legacy: parseLegacyCsv(read("06-其他.csv"))
      }
    });
  }
  const err = new Error("仅支持 .json 或 .zip 文件");
  err.status = 400;
  throw err;
}

function normalizePayload(payload) {
  if (!payload || payload.format !== FORM_FORMAT) {
    const err = new Error(`无效的表单格式，需要 ${FORM_FORMAT}`);
    err.status = 400;
    throw err;
  }
  if (!payload.template_code) {
    const err = new Error("表单缺少 template_code");
    err.status = 400;
    throw err;
  }
  payload.basic = payload.basic || {};
  payload.quote = payload.quote || {};
  payload.quote.profiles = payload.quote.profiles || [];
  payload.quote.nuts = payload.quote.nuts || [];
  payload.quote.hardware = payload.quote.hardware || [];
  payload.quote.panels = payload.quote.panels || [];
  payload.quote.legacy = payload.quote.legacy || [];
  return payload;
}

function findHardwareByNameSpec(db, item_name, spec) {
  const name = String(item_name || "").trim();
  const normSpec = String(spec || "").trim();
  if (!name) return null;
  return (
    listPriceItems(db, { category: "hardware", enabledOnly: true }).find(
      (i) => i.label.trim() === name && String(i.spec || "").trim() === normSpec
    ) || null
  );
}

function resolveForm(db, template, payload) {
  const errors = [];
  const warnings = [];
  const resolved = {
    basic: { ...payload.basic },
    profiles: [],
    nuts: [],
    hardware: [],
    panels: [],
    legacy: []
  };

  if (payload.template_code !== template.template_code) {
    errors.push({
      section: "form",
      message: `模板编号不匹配：表单为 ${payload.template_code}，当前为 ${template.template_code}`
    });
    return { valid: false, errors, warnings, resolved };
  }

  for (const row of payload.quote.profiles || []) {
    const line = row._line ? `第 ${row._line} 行` : "";
    if (!row.length_inch) {
      errors.push({ section: "profiles", message: `${line}缺少长度(inch)` });
      continue;
    }
    try {
      const color = resolveProfileColorForWrite(db, row.color);
      resolved.profiles.push({
        color,
        length_inch: Number(row.length_inch),
        qty: Number(row.qty) || 1,
        coefficient: Number(row.coefficient) || 1,
        note: row.note || ""
      });
    } catch (e) {
      errors.push({ section: "profiles", message: `${line}${e.message}` });
    }
  }

  for (const row of payload.quote.nuts || []) {
    const line = row._line ? `第 ${row._line} 行` : "";
    const id = Number(row.price_item_id);
    const item = getPriceItem(db, id);
    if (!item || item.category !== "nut") {
      errors.push({ section: "nuts", message: `${line}无效的六通 price_item_id：${row.price_item_id}` });
      continue;
    }
    resolved.nuts.push({ item, qty: Number(row.qty) || 1, note: row.note || "" });
  }

  for (const row of payload.quote.hardware || []) {
    const line = row._line ? `第 ${row._line} 行` : "";
    const source = normalizeSource(row.source);
    if (source === "catalog") {
      const id = Number(row.price_item_id);
      const item = getPriceItem(db, id);
      if (!item || item.category !== "hardware") {
        errors.push({
          section: "hardware",
          message: `${line}无效的五金 price_item_id：${row.price_item_id}`
        });
        continue;
      }
      resolved.hardware.push({ item, qty: Number(row.qty) || 1, note: row.note || "" });
      continue;
    }

    const name = String(row.item_name || "").trim();
    const spec = String(row.spec || "").trim();
    const unit = String(row.unit || "个").trim() || "个";
    const price = Number(row.unit_price);
    const qty = Number(row.qty) || 1;
    if (!name) {
      errors.push({ section: "hardware", message: `${line}手动五金缺少名称` });
      continue;
    }
    if (!price || price <= 0) {
      errors.push({ section: "hardware", message: `${line}手动五金缺少有效单价` });
      continue;
    }

    const matched = findHardwareByNameSpec(db, name, spec);
    if (matched) {
      resolved.hardware.push({ item: matched, qty, note: row.note || "" });
      warnings.push({
        section: "hardware",
        message: `${line}手动行已匹配单价库「${matched.label}」，写入五金配件`
      });
    } else {
      resolved.legacy.push({
        category: "五金配件",
        item_name: name,
        spec,
        unit,
        unit_price: price,
        qty,
        note: row.note || "",
        _fallbackFromHardware: true
      });
      warnings.push({
        section: "hardware",
        message: `${line}「${name}」未匹配单价库，将归入「其他」`
      });
    }
  }

  for (const row of payload.quote.panels || []) {
    const line = row._line ? `第 ${row._line} 行` : "";
    const id = Number(row.price_item_id);
    const item = getPriceItem(db, id);
    if (!item || item.category !== "panel") {
      errors.push({ section: "panels", message: `${line}无效的板材 price_item_id：${row.price_item_id}` });
      continue;
    }
    if (!row.length_inch || !row.width_inch) {
      errors.push({ section: "panels", message: `${line}缺少长宽(inch)` });
      continue;
    }
    resolved.panels.push({
      item,
      length_inch: Number(row.length_inch),
      width_inch: Number(row.width_inch),
      qty: Number(row.qty) || 1,
      note: row.note || ""
    });
  }

  for (const row of payload.quote.legacy || []) {
    const line = row._line ? `第 ${row._line} 行` : "";
    const category = String(row.category || "其他").trim();
    const item_name = String(row.item_name || "").trim();
    if (!CUSTOM_BOM_CATEGORIES.includes(category)) {
      errors.push({ section: "legacy", message: `${line}无效的类别：${category}` });
      continue;
    }
    if (!item_name) {
      errors.push({ section: "legacy", message: `${line}缺少项目名称` });
      continue;
    }
    const price = Number(row.unit_price);
    if (!price || price <= 0) {
      errors.push({ section: "legacy", message: `${line}缺少有效单价` });
      continue;
    }
    resolved.legacy.push({
      category,
      item_name,
      spec: row.spec || "",
      unit: row.unit || "个",
      unit_price: price,
      qty: Number(row.qty) || 1,
      note: row.note || ""
    });
  }

  return { valid: errors.length === 0, errors, warnings, resolved };
}

function countSection(arr) {
  return Array.isArray(arr) ? arr.length : 0;
}

function buildPreviewDiff(template, resolved) {
  return {
    basic: {
      name: { from: template.name, to: resolved.basic.name },
      dimensions: {
        from: [template.width_mm, template.depth_mm, template.height_mm],
        to: [resolved.basic.width_mm, resolved.basic.depth_mm, resolved.basic.height_mm]
      }
    },
    quote: {
      profiles: { from: countSection(template.quote_profiles), to: resolved.profiles.length },
      nuts: { from: countSection(template.quote_nuts), to: resolved.nuts.length },
      hardware: { from: countSection(template.quote_hardware), to: resolved.hardware.length },
      panels: { from: countSection(template.quote_panels), to: resolved.panels.length },
      legacy: { from: countSection(template.bom), to: resolved.legacy.length }
    }
  };
}

function previewDeepeningForm(db, template, payload) {
  const { valid, errors, warnings, resolved } = resolveForm(db, template, payload);
  return {
    valid,
    errors,
    warnings,
    diff: buildPreviewDiff(template, resolved),
    resolved: valid ? resolved : null
  };
}

function applyDeepeningForm(db, template, payload, user) {
  const { valid, errors, warnings, resolved } = resolveForm(db, template, payload);
  if (!valid) {
    const err = new Error(errors[0]?.message || "表单校验失败");
    err.status = 400;
    err.details = { errors, warnings };
    throw err;
  }

  const createdBy = user.display_name || user.username || "";
  const templateId = template.id;
  const b = resolved.basic;

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM quote_profiles WHERE template_id = ?").run(templateId);
    db.prepare("DELETE FROM quote_nuts WHERE template_id = ?").run(templateId);
    db.prepare("DELETE FROM quote_hardware WHERE template_id = ?").run(templateId);
    db.prepare("DELETE FROM quote_panels WHERE template_id = ?").run(templateId);
    db.prepare("DELETE FROM bom_lines WHERE template_id = ?").run(templateId);

    db.prepare(
      `UPDATE templates SET
        name = ?, width_mm = ?, depth_mm = ?, height_mm = ?,
        one_liner = ?, quote_note = ?,
        price_override_min = ?, price_override_max = ?,
        skin_upgrade_enabled = ?, internal_note = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      b.name,
      b.width_mm,
      b.depth_mm,
      b.height_mm,
      b.one_liner,
      b.quote_note,
      b.price_override_min,
      b.price_override_max,
      b.skin_upgrade_enabled ? 1 : 0,
      b.internal_note,
      templateId
    );

    syncTemplateTags(db, templateId, b.tags || []);

    const insProfile = db.prepare(
      `INSERT INTO quote_profiles (template_id, length_inch, qty, coefficient, color, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    resolved.profiles.forEach((p, i) => {
      insProfile.run(
        templateId,
        p.length_inch,
        p.qty,
        p.coefficient,
        p.color,
        p.note,
        i + 1
      );
    });

    const insNut = db.prepare(
      `INSERT INTO quote_nuts (template_id, price_item_id, nut_model, item_name, qty, unit_price, unit, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    resolved.nuts.forEach((n, i) => {
      insNut.run(
        templateId,
        n.item.id,
        n.item.nut_model || "",
        n.item.label,
        n.qty,
        n.item.unit_price_external ?? n.item.unit_price,
        n.item.unit || "个",
        n.note,
        i + 1
      );
    });

    const insHw = db.prepare(
      `INSERT INTO quote_hardware (template_id, price_item_id, item_name, spec, qty, unit_price, unit, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    resolved.hardware.forEach((h, i) => {
      insHw.run(
        templateId,
        h.item.id,
        h.item.label,
        h.item.spec || "",
        h.qty,
        h.item.unit_price_external ?? h.item.unit_price,
        h.item.unit || "个",
        h.note,
        i + 1
      );
    });

    const insPanel = db.prepare(
      `INSERT INTO quote_panels (
        template_id, price_item_id, material_type, color, thickness_mm, material_name,
        length_inch, width_inch, qty, pricing_mode, price_per_sqm, fixed_unit_price, note, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    resolved.panels.forEach((p, i) => {
      const pricing = resolvePanelPricing(p.item);
      insPanel.run(
        templateId,
        p.item.id,
        p.item.material_type,
        p.item.color,
        p.item.thickness_mm,
        p.item.label,
        p.length_inch,
        p.width_inch,
        p.qty,
        pricing.pricing_mode,
        pricing.price_per_sqm,
        pricing.fixed_unit_price,
        p.note,
        i + 1
      );
    });

    const insLegacy = db.prepare(
      `INSERT INTO bom_lines (
        template_id, line_no, category, item_name, spec, qty, unit, unit_price, note, custom_price_item_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    resolved.legacy.forEach((row, i) => {
      let customItem = findCustomItem(db, {
        source_category: row.category,
        item_name: row.item_name,
        spec: row.spec
      });
      if (!customItem) {
        customItem = createCustomItem(db, {
          source_category: row.category,
          item_name: row.item_name,
          spec: row.spec,
          unit: row.unit,
          unit_price: row.unit_price,
          created_by: createdBy
        });
      }
      insLegacy.run(
        templateId,
        i + 1,
        row.category,
        row.item_name,
        row.spec,
        row.qty,
        row.unit,
        row.unit_price,
        row.note,
        customItem.id
      );
    });

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return { warnings, diff: buildPreviewDiff(template, resolved) };
}

module.exports = {
  FORM_FORMAT,
  exportFormJson,
  exportFormZipBuffer,
  zipFilename,
  jsonFilename,
  parseUploadBuffer,
  previewDeepeningForm,
  applyDeepeningForm
};
