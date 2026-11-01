const fs = require("fs");
const path = require("path");
const { AUDIT_CHECKLIST } = require("./constants");
const {
  AUDIT_CSV_PATH,
  ensureAuditArchiveDir,
  getAuditTemplateDir,
  relFromUploads
} = require("./storage");

const AUDIT_CSV_HEADERS = [
  "模板编号",
  "模板名称",
  "应用场景",
  "通过日期",
  "审核人",
  "审核备注",
  "参考价下限",
  "参考价上限",
  "审核单图片",
  "审核结论"
];

function csvEscape(val) {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function appendAuditRecord(row) {
  ensureAuditArchiveDir();
  const values = [
    row.template_code,
    row.name,
    row.scenario,
    row.passed_at,
    row.auditor,
    row.audit_note,
    row.price_min,
    row.price_max,
    row.audit_image_rel,
    row.conclusion || "通过"
  ]
    .map(csvEscape)
    .join(",");

  if (!fs.existsSync(AUDIT_CSV_PATH)) {
    fs.writeFileSync(AUDIT_CSV_PATH, "\uFEFF" + AUDIT_CSV_HEADERS.join(",") + "\n", "utf8");
  }
  fs.appendFileSync(AUDIT_CSV_PATH, values + "\n", "utf8");
}

function escapeXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateAuditSvg({ template, checklist, auditor, auditNote, passedAt }) {
  let y = 220;
  const itemTexts = AUDIT_CHECKLIST.map((item) => {
    const checked = checklist[item.id] ? "✓" : "✗";
    y += 26;
    return `<text x="40" y="${y}" class="item">${checked} ${escapeXml(item.label)}</text>`;
  }).join("\n  ");
  const height = y + (auditNote ? 94 : 68);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}">
  <style>
    text { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; fill: #1e293b; }
    .title { font-size: 22px; font-weight: bold; }
    .meta { font-size: 14px; fill: #475569; }
    .section { font-size: 16px; font-weight: bold; }
    .item { font-size: 14px; }
    .pass { font-size: 18px; font-weight: bold; fill: #15803d; }
  </style>
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <text x="40" y="48" class="title">MR2525 模板审核单</text>
  <text x="40" y="78" class="meta">模板编号：${escapeXml(template.template_code)}</text>
  <text x="40" y="102" class="meta">名称：${escapeXml(template.name)} · 场景：${escapeXml(template.scenario)}</text>
  <text x="40" y="126" class="meta">负责人：${escapeXml(template.assignee || "—")} · 审核人：${escapeXml(auditor)}</text>
  <text x="40" y="150" class="meta">通过时间：${escapeXml(passedAt)} · 整包价含税：${template.package_price ?? "—"}</text>
  <text x="40" y="174" class="meta">价格基准日：${escapeXml(template.price_basis_date || "—")} · 安装工时：${template.installation_hours ?? "—"} 人·h</text>
  <text x="40" y="198" class="section">审核清单</text>
  ${itemTexts}
  <text x="40" y="${y + 36}" class="pass">结论：通过</text>
  ${auditNote ? `<text x="40" y="${y + 62}" class="meta">备注：${escapeXml(auditNote)}</text>` : ""}
</svg>`;
}

function saveAuditArchive({ template, checklist, auditor, auditNote }) {
  const passedAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const stamp = passedAt.replace(/[-: ]/g, "").slice(0, 14);
  const dir = getAuditTemplateDir(template.template_code);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${template.template_code}_审核单_${stamp}.svg`;
  const absPath = path.join(dir, filename);
  fs.writeFileSync(
    absPath,
    generateAuditSvg({ template, checklist, auditor, auditNote, passedAt }),
    "utf8"
  );

  const audit_image_rel = relFromUploads(absPath);
  const deliverySummary = [
    `整包价含税=${template.package_price ?? "—"}`,
    `价格基准日=${template.price_basis_date || "—"}`,
    `安装工时=${template.installation_hours ?? "—"}人·h`,
    `交付文件=${Array.isArray(template.delivery_file_list) ? template.delivery_file_list.length : 0}项`,
    `EFF/RND合并=${template.eff_rnd_merged ? "是" : "否"}`
  ].join("；");
  appendAuditRecord({
    template_code: template.template_code,
    name: template.name,
    scenario: template.scenario,
    passed_at: passedAt,
    auditor,
    audit_note: [auditNote || "", deliverySummary].filter(Boolean).join("\n"),
    price_min: template.price_min,
    price_max: template.price_max,
    audit_image_rel,
    conclusion: "通过"
  });

  return { passedAt, audit_image_rel, filename };
}

module.exports = { saveAuditArchive, generateAuditSvg, AUDIT_CHECKLIST };
