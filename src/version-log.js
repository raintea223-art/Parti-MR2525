const { bumpMinor, bumpMajor, normalizeVersion } = require("./version");

const FIELD_LABELS = {
  name: "名称",
  scenario: "应用场景",
  one_liner: "一句话卖点",
  quote_note: "报价口径",
  assignee: "负责人",
  width_mm: "宽度 mm",
  depth_mm: "深度 mm",
  height_mm: "高度 mm",
  price_override_min: "参考价下限",
  price_override_max: "参考价上限",
  skin_upgrade_enabled: "可定制",
  cover_image: "封面",
  cover_source: "封面来源",
  skp_file: "skp 模型"
};

const TRIGGER_LABELS = {
  first_publish: "首次发布",
  re_publish_minor: "内容修订",
  re_publish_major: "更换 skp 模型"
};

const QUOTE_SECTION_LABELS = {
  profiles: "型材",
  nuts: "六通",
  hardware: "五金",
  panels: "板材",
  legacy: "其他"
};

function pickProfileLine(row) {
  return {
    id: row.id,
    color: row.color || "",
    length_inch: row.length_inch,
    qty: row.qty,
    coefficient: row.coefficient ?? 1,
    factory_price: row.factory_price,
    quote_unit: row.quote_unit,
    unit_price: row.unit_price,
    subtotal: row.subtotal,
    note: row.note || ""
  };
}

function pickNutLine(row) {
  return {
    id: row.id,
    price_item_id: row.price_item_id,
    nut_model: row.nut_model || "",
    item_name: row.item_name || "",
    qty: row.qty,
    unit_price: row.unit_price,
    unit: row.unit || "个",
    subtotal: row.subtotal,
    note: row.note || ""
  };
}

function pickHardwareLine(row) {
  return {
    id: row.id,
    price_item_id: row.price_item_id,
    item_name: row.item_name || "",
    spec: row.spec || "",
    qty: row.qty,
    unit_price: row.unit_price,
    unit: row.unit || "个",
    subtotal: row.subtotal,
    note: row.note || ""
  };
}

function pickPanelLine(row) {
  return {
    id: row.id,
    price_item_id: row.price_item_id,
    material_name: row.material_name || "",
    material_type: row.material_type || "",
    color: row.color || "",
    thickness_mm: row.thickness_mm,
    length_inch: row.length_inch,
    width_inch: row.width_inch,
    area_sqm: row.area_sqm,
    qty: row.qty,
    pricing_mode: row.pricing_mode,
    price_per_sqm: row.price_per_sqm,
    fixed_unit_price: row.fixed_unit_price,
    unit_price: row.unit_price,
    subtotal: row.subtotal,
    note: row.note || ""
  };
}

function pickLegacyLine(row) {
  return {
    id: row.id,
    line_no: row.line_no,
    category: row.category || "",
    item_name: row.item_name || "",
    spec: row.spec || "",
    qty: row.qty,
    unit: row.unit || "",
    unit_price: row.unit_price,
    subtotal: row.subtotal,
    note: row.note || ""
  };
}

function lineKey(prefix, row, index) {
  if (row.id != null) return `${prefix}:${row.id}`;
  return `${prefix}:new:${index}`;
}

function stableJson(value) {
  return JSON.stringify(value);
}

function diffQuoteSection(prevLines, currLines, prefix, pickFn) {
  const prevMap = new Map();
  const currMap = new Map();
  (prevLines || []).forEach((row, index) => {
    prevMap.set(lineKey(prefix, row, index), { raw: row, picked: pickFn(row) });
  });
  (currLines || []).forEach((row, index) => {
    currMap.set(lineKey(prefix, row, index), { raw: row, picked: pickFn(row) });
  });

  const added = [];
  const removed = [];
  const modified = [];

  for (const [key, curr] of currMap.entries()) {
    const prev = prevMap.get(key);
    if (!prev) {
      added.push(curr.picked);
      continue;
    }
    if (stableJson(prev.picked) !== stableJson(curr.picked)) {
      modified.push({ before: prev.picked, after: curr.picked });
    }
  }
  for (const [key, prev] of prevMap.entries()) {
    if (!currMap.has(key)) removed.push(prev.picked);
  }

  return { added, removed, modified };
}

function buildSnapshot(template) {
  return {
    template: {
      name: template.name,
      scenario: template.scenario,
      one_liner: template.one_liner || "",
      quote_note: template.quote_note || "",
      assignee: template.assignee || "",
      width_mm: template.width_mm ?? null,
      depth_mm: template.depth_mm ?? null,
      height_mm: template.height_mm ?? null,
      price_override_min: template.price_override_min ?? null,
      price_override_max: template.price_override_max ?? null,
      skin_upgrade_enabled: !!template.skin_upgrade_enabled,
      cover_image: template.cover_image || "",
      cover_source: template.cover_source || "",
      skp_file: template.skp_file || "",
      tags: [...(template.tags || [])].sort(),
      photo_images: [...(template.photo_images || [])],
      effect_images: [...(template.effect_images || [])],
      render_images: [...(template.render_images || [])]
    },
    quote: {
      profiles: (template.quote_profiles || []).map(pickProfileLine),
      nuts: (template.quote_nuts || []).map(pickNutLine),
      hardware: (template.quote_hardware || []).map(pickHardwareLine),
      panels: (template.quote_panels || []).map(pickPanelLine),
      legacy: (template.bom || []).map(pickLegacyLine)
    },
    totals: {
      price_min: template.price_min,
      price_max: template.price_max,
      material_cost: template.material_cost,
      profile_amount: template.profile_amount,
      nut_amount: template.nut_amount,
      hardware_amount: template.hardware_amount,
      panel_amount: template.panel_amount,
      legacy_amount: template.legacy_amount
    }
  };
}

function diffTemplateFields(prevTpl, currTpl) {
  const fields = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const from = prevTpl?.[key];
    const to = currTpl?.[key];
    if (stableJson(from) !== stableJson(to)) {
      fields.push({ key, label, from, to });
    }
  }
  return fields;
}

function diffTags(prevTags, currTags) {
  const prev = new Set(prevTags || []);
  const curr = new Set(currTags || []);
  const added = [...curr].filter((t) => !prev.has(t));
  const removed = [...prev].filter((t) => !curr.has(t));
  return { added, removed };
}

function diffImages(prevTpl, currTpl) {
  const kinds = [
    ["photo", "photo_images", "实拍"],
    ["effect", "effect_images", "效果图"],
    ["render", "render_images", "渲染图"]
  ];
  const out = {};
  for (const [key, field, label] of kinds) {
    const from = (prevTpl?.[field] || []).length;
    const to = (currTpl?.[field] || []).length;
    if (from !== to) out[key] = { label, from, to };
  }
  return out;
}

function computeChanges(prevSnapshot, currentSnapshot) {
  if (!prevSnapshot) {
    return {
      mode: "initial",
      template: currentSnapshot.template,
      quote: currentSnapshot.quote,
      totals: currentSnapshot.totals
    };
  }

  const prevTpl = prevSnapshot.template || {};
  const currTpl = currentSnapshot.template || {};
  const quote = {};
  const pickers = {
    profiles: pickProfileLine,
    nuts: pickNutLine,
    hardware: pickHardwareLine,
    panels: pickPanelLine,
    legacy: pickLegacyLine
  };
  for (const [key, pickFn] of Object.entries(pickers)) {
    quote[key] = diffQuoteSection(
      prevSnapshot.quote?.[key],
      currentSnapshot.quote?.[key],
      key,
      pickFn
    );
  }

  return {
    mode: "diff",
    fields: diffTemplateFields(prevTpl, currTpl),
    tags: diffTags(prevTpl.tags, currTpl.tags),
    images: diffImages(prevTpl, currTpl),
    skp: {
      changed: (prevTpl.skp_file || "") !== (currTpl.skp_file || ""),
      from: prevTpl.skp_file || "",
      to: currTpl.skp_file || ""
    },
    quote,
    totals: {
      price_min: { from: prevSnapshot.totals?.price_min, to: currentSnapshot.totals?.price_min },
      price_max: { from: prevSnapshot.totals?.price_max, to: currentSnapshot.totals?.price_max },
      material_cost: {
        from: prevSnapshot.totals?.material_cost,
        to: currentSnapshot.totals?.material_cost
      }
    }
  };
}

function fmtDims(tpl) {
  if (tpl.width_mm && tpl.depth_mm && tpl.height_mm) {
    return `${tpl.width_mm}×${tpl.depth_mm}×${tpl.height_mm} mm`;
  }
  return "—";
}

function fmtMoney(n) {
  if (n == null || n === "") return "—";
  return `¥${Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

function countQuoteLines(quote) {
  return {
    profiles: quote?.profiles?.length || 0,
    nuts: quote?.nuts?.length || 0,
    hardware: quote?.hardware?.length || 0,
    panels: quote?.panels?.length || 0,
    legacy: quote?.legacy?.length || 0
  };
}

function buildSummary({ changes, trigger, version, previousVersion, auditor, auditNote, template }) {
  const lines = [];
  const triggerLabel = TRIGGER_LABELS[trigger] || trigger;
  const head =
    trigger === "first_publish"
      ? `${version} · ${triggerLabel} · ${auditor} · ${new Date().toISOString().slice(0, 10)}`
      : `${previousVersion} → ${version} · ${triggerLabel} · ${auditor} · ${new Date().toISOString().slice(0, 10)}`;
  lines.push(head);

  if (changes.mode === "initial") {
    const tpl = changes.template || {};
    const counts = countQuoteLines(changes.quote);
    lines.push(`- 场景 ${tpl.scenario || "—"} · 尺寸 ${fmtDims(tpl)}`);
    lines.push(
      `- 图片：实拍 ${(tpl.photo_images || []).length} · 效果 ${(tpl.effect_images || []).length} · 渲染 ${(tpl.render_images || []).length}`
    );
    lines.push(
      `- BOM：型材 ${counts.profiles} · 六通 ${counts.nuts} · 五金 ${counts.hardware} · 板材 ${counts.panels} · 其他 ${counts.legacy}`
    );
    lines.push(`- 参考价：${fmtMoney(changes.totals?.price_min)} – ${fmtMoney(changes.totals?.price_max)}`);
  } else {
    for (const field of changes.fields || []) {
      lines.push(`- ${field.label}：${field.from ?? "—"} → ${field.to ?? "—"}`);
    }
    const tagDiff = changes.tags || {};
    if ((tagDiff.added || []).length || (tagDiff.removed || []).length) {
      const parts = [];
      if (tagDiff.added?.length) parts.push(`+${tagDiff.added.join("、")}`);
      if (tagDiff.removed?.length) parts.push(`-${tagDiff.removed.join("、")}`);
      lines.push(`- 标签：${parts.join(" ")}`);
    }
    for (const img of Object.values(changes.images || {})) {
      lines.push(`- ${img.label}：${img.from} → ${img.to} 张`);
    }
    if (changes.skp?.changed) {
      lines.push("- skp 模型已更换");
    }
    for (const [key, label] of Object.entries(QUOTE_SECTION_LABELS)) {
      const section = changes.quote?.[key];
      if (!section) continue;
      const { added, removed, modified } = section;
      if (!added.length && !removed.length && !modified.length) continue;
      lines.push(`- BOM ${label}：+${added.length} / -${removed.length} / 改 ${modified.length}`);
    }
    const t = changes.totals || {};
    if (t.price_min?.from !== t.price_min?.to || t.price_max?.from !== t.price_max?.to) {
      lines.push(
        `- 参考价：${fmtMoney(t.price_min?.from)} – ${fmtMoney(t.price_max?.from)} → ${fmtMoney(t.price_min?.to)} – ${fmtMoney(t.price_max?.to)}`
      );
    } else if (t.material_cost?.from !== t.material_cost?.to) {
      lines.push(`- 物料合计：${fmtMoney(t.material_cost?.from)} → ${fmtMoney(t.material_cost?.to)}`);
    }
    if (lines.length === 1) {
      lines.push("- 与上一发布版相比未检测到字段或 BOM 差异");
    }
  }

  const note = (auditNote || "").trim();
  if (note) lines.push(`[审核备注：${note}]`);
  return lines.join("\n");
}

function resolvePublishVersion(template, prevSnapshot, lastLog) {
  if (!template.published_at) {
    return {
      version: normalizeVersion(template.version),
      previous_version: null,
      trigger: "first_publish"
    };
  }

  const prevVer = lastLog?.version || template.version;
  const skpChanged =
    !!prevSnapshot &&
    (prevSnapshot.template?.skp_file || "") !== (template.skp_file || "");

  if (skpChanged) {
    return {
      version: bumpMajor(prevVer),
      previous_version: prevVer,
      trigger: "re_publish_major"
    };
  }
  return {
    version: bumpMinor(prevVer),
    previous_version: prevVer,
    trigger: "re_publish_minor"
  };
}

function initVersionLogSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS template_version_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      previous_version TEXT,
      trigger TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      changes_json TEXT NOT NULL DEFAULT '{}',
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      audit_note TEXT DEFAULT '',
      audit_image_rel TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_version_logs_template ON template_version_logs(template_id, id DESC);
  `);
}

function getLatestVersionLog(db, templateId) {
  return db
    .prepare(
      `SELECT * FROM template_version_logs WHERE template_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(templateId);
}

function listVersionLogs(db, templateId) {
  return db
    .prepare(
      `SELECT id, template_id, version, previous_version, trigger, created_at, created_by,
              summary, changes_json, audit_note, audit_image_rel
       FROM template_version_logs WHERE template_id = ? ORDER BY id DESC`
    )
    .all(templateId);
}

function insertVersionLog(db, row) {
  const result = db
    .prepare(
      `INSERT INTO template_version_logs (
        template_id, version, previous_version, trigger, created_by,
        summary, changes_json, snapshot_json, audit_note, audit_image_rel
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.template_id,
      row.version,
      row.previous_version,
      row.trigger,
      row.created_by,
      row.summary,
      row.changes_json,
      row.snapshot_json,
      row.audit_note || "",
      row.audit_image_rel || ""
    );
  return result.lastInsertRowid;
}

function createVersionLogForPublish(db, { template, auditor, auditNote, auditImageRel }) {
  const lastLog = getLatestVersionLog(db, template.id);
  const prevSnapshot = lastLog?.snapshot_json ? JSON.parse(lastLog.snapshot_json) : null;
  const currentSnapshot = buildSnapshot(template);
  const changes = computeChanges(prevSnapshot, currentSnapshot);
  const { version, previous_version, trigger } = resolvePublishVersion(template, prevSnapshot, lastLog);
  const summary = buildSummary({
    changes,
    trigger,
    version,
    previousVersion: previous_version,
    auditor,
    auditNote,
    template
  });

  insertVersionLog(db, {
    template_id: template.id,
    version,
    previous_version,
    trigger,
    created_by: auditor,
    summary,
    changes_json: JSON.stringify(changes),
    snapshot_json: JSON.stringify(currentSnapshot),
    audit_note: auditNote || "",
    audit_image_rel: auditImageRel || ""
  });

  return { version, previous_version, trigger, summary, changes };
}

module.exports = {
  buildSnapshot,
  computeChanges,
  buildSummary,
  resolvePublishVersion,
  initVersionLogSchema,
  getLatestVersionLog,
  listVersionLogs,
  insertVersionLog,
  createVersionLogForPublish,
  TRIGGER_LABELS
};
