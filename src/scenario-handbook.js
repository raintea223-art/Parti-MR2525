const {
  buildTemplatePages,
  renderPdfFromHtml,
  contentDisposition,
  imageToDataUri,
  sheetStyles,
  PAGE_W
} = require("./public-sheet");

/** 启动日志用，便于确认已加载最新场景手册逻辑 */
const HANDBOOK_BUILD = "20260530-handbook-v2";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function handbookVersionLabel(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `V${y}${m}${d}`;
}

function templateAnchorId(templateId) {
  return `tpl-${templateId}`;
}

function handbookExtraStyles() {
  return `
.marker-layer { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.marker-pin {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 24px;
}
a.marker-pin-link {
  text-decoration: none;
  color: inherit;
  pointer-events: auto;
  cursor: pointer;
}
.marker-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #dc2626;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: grid;
  place-items: center;
  border: 2px solid #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
}
.marker-label {
  margin-top: 4px;
  max-width: 160px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.88);
  color: #fff;
  font-size: 9px;
  line-height: 1.3;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.marker-legend {
  position: absolute;
  left: 28px;
  top: 28px;
  max-width: 340px;
  background: rgba(255,255,255,0.92);
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 10px;
  line-height: 1.45;
  z-index: 3;
  pointer-events: auto;
}
.marker-legend h4 { margin: 0 0 6px; font-size: 11px; }
.marker-legend li { margin: 0 0 3px; }
.marker-legend a {
  color: #1d4ed8;
  text-decoration: underline;
  font-weight: 600;
}
.handbook-brand-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 48px 56px 52px;
  background: linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.72) 100%);
  pointer-events: none;
}
.handbook-brand-title {
  margin: 0 0 10px;
  color: #fff;
  font-size: 38px;
  font-weight: 700;
  letter-spacing: 1px;
  line-height: 1.15;
  text-shadow: 0 2px 12px rgba(0,0,0,.45);
}
.handbook-brand-scenario {
  margin: 0 0 8px;
  color: #fff;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.2;
  text-shadow: 0 2px 10px rgba(0,0,0,.4);
}
.handbook-brand-version {
  margin: 0;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  opacity: 0.95;
  letter-spacing: 0.5px;
}
.page-scenario-intro .intro-inner {
  position: absolute;
  inset: 0;
  padding: 48px 56px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: linear-gradient(135deg, #0f172a 0%, #334155 100%);
  color: #fff;
}
.page-scenario-intro .intro-inner h1 { margin: 16px 0 8px; font-size: 32px; font-weight: 600; }
.page-scenario-intro .code { font-size: 16px; opacity: 0.85; margin-bottom: 12px; }
.page-scenario-intro p { margin: 0; max-width: 70%; font-size: 14px; line-height: 1.5; opacity: 0.92; }
.section-divider {
  page-break-after: always;
  break-after: page;
  width: ${PAGE_W}px;
  height: 540px;
  display: grid;
  place-items: center;
  background: #0f172a;
  color: #fff;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 2px;
}`;
}

function renderHandbookBrandBlock(scenario, version) {
  return `<div class="handbook-brand-title">Parti空间编辑系统</div>
    <div class="handbook-brand-scenario">——${escapeHtml(scenario.name)}空间</div>
    <div class="handbook-brand-version">${escapeHtml(version)}</div>`;
}

function renderScenarioIntroPage(scenario, coverDataUri, version) {
  const brand = renderHandbookBrandBlock(scenario, version);
  if (coverDataUri) {
    return `<section class="page page-image page-scenario-cover">
  <img class="page-bg" src="${coverDataUri}" alt="" />
  <div class="handbook-brand-overlay">${brand}</div>
</section>`;
  }
  return `<section class="page page-scenario-intro">
  <div class="intro-inner">
    ${brand}
    <h1>${escapeHtml(scenario.name)}</h1>
    <div class="code">${escapeHtml(scenario.code)}</div>
    ${scenario.description ? `<p>${escapeHtml(scenario.description)}</p>` : ""}
  </div>
</section>`;
}

function renderMarkerPin(m, index, scenario, anchorTemplateIds) {
  const label = escapeHtml(m.label || m.template_code || "未关联模板");
  const inner = `<div class="marker-dot">${index + 1}</div><div class="marker-label">${label}</div>`;
  const style = `left:${Number(m.x_pct)}%;top:${Number(m.y_pct)}%`;
  const tid = m.template_id != null ? Number(m.template_id) : 0;
  if (tid > 0 && anchorTemplateIds.has(tid)) {
    const href = `#${templateAnchorId(tid)}`;
    return `<a class="marker-pin marker-pin-link" href="${href}" style="${style}">${inner}</a>`;
  }
  return `<div class="marker-pin" style="${style}">${inner}</div>`;
}

function renderLegendItem(m, index, scenario, anchorTemplateIds) {
  const tid = m.template_id != null ? Number(m.template_id) : 0;
  const text = `${index + 1}. ${escapeHtml(m.template_code || "—")} · ${escapeHtml(m.label || m.template_name || "")}${
    m.template_scenario !== scenario.name ? ` (${escapeHtml(m.template_scenario)})` : ""
  }`;
  if (tid > 0 && anchorTemplateIds.has(tid)) {
    return `<li><a href="#${templateAnchorId(tid)}">${text}</a></li>`;
  }
  return `<li>${text}</li>`;
}

function renderScenarioImageWithMarkersPage(image, scenario, markers, anchorTemplateIds) {
  const src = imageToDataUri(image.file_path);
  if (!src) return "";

  const sorted = [...(markers || [])].sort((a, b) => a.sort_order - b.sort_order);
  const pins = sorted.map((m, i) => renderMarkerPin(m, i, scenario, anchorTemplateIds)).join("");

  const legend = sorted.length
    ? `<div class="marker-legend"><h4>模板标记（点击跳转方案页）</h4><ol>${sorted
        .map((m, i) => renderLegendItem(m, i, scenario, anchorTemplateIds))
        .join("")}</ol></div>`
    : "";

  const caption = `${image.kind_label || ""}${image.title ? " · " + image.title : ""}`;

  return `<section class="page page-image page-scenario-marked">
  <img class="page-bg" src="${src}" alt="" />
  <div class="marker-layer">${pins}</div>
  ${legend}
  <div class="page-caption">${escapeHtml(caption)}</div>
</section>`;
}

function renderPartDivider(title) {
  return `<section class="page section-divider">${escapeHtml(title)}</section>`;
}

function buildTemplatePagesWithAnchor(template) {
  const pages = buildTemplatePages(template);
  if (!pages.length) return pages;
  const anchor = templateAnchorId(template.id);
  pages[0] = pages[0].replace("<section ", `<section id="${anchor}" `);
  return pages;
}

function generateScenarioHandbookHtml(scenario, images, templates, options = {}) {
  const version = options.version || handbookVersionLabel(options.generatedAt);
  const anchorTemplateIds = new Set((templates || []).map((t) => t.id));

  const pages = [];
  const picker = scenario.picker_image || images[0]?.file_path;
  pages.push(renderScenarioIntroPage(scenario, picker ? imageToDataUri(picker) : null, version));

  for (const img of images) {
    const page = renderScenarioImageWithMarkersPage(
      img,
      scenario,
      img.markers || [],
      anchorTemplateIds
    );
    if (page) pages.push(page);
  }

  if (templates.length) {
    pages.push(renderPartDivider("模板方案"));
    for (const t of templates) {
      pages.push(...buildTemplatePagesWithAnchor(t));
    }
  }

  const styles = sheetStyles() + handbookExtraStyles();
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(scenario.code)} 场景手册</title>
  <style>${styles}</style>
</head>
<body>
  ${pages.join("\n")}
</body>
</html>`;
}

async function renderScenarioHandbookPdf(scenario, images, templates, options) {
  return renderPdfFromHtml(generateScenarioHandbookHtml(scenario, images, templates, options));
}

function handbookFilename(scenarioCode) {
  return `${scenarioCode}_场景手册.pdf`;
}

module.exports = {
  HANDBOOK_BUILD,
  generateScenarioHandbookHtml,
  renderScenarioHandbookPdf,
  handbookFilename,
  handbookVersionLabel,
  contentDisposition
};
