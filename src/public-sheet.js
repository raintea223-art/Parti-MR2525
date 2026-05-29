const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { UPLOADS_DIR } = require("./storage");

/** 16:9 横版幻灯片尺寸（px，与 @page / puppeteer 一致） */
const PAGE_W = 960;
const PAGE_H = 540;

let browserPromise = null;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(n) {
  if (n == null || n === "") return "—";
  return `¥${Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

function fmtPriceRange(min, max) {
  if (min == null && max == null) return "—";
  if (min === max || max == null) return fmtMoney(min);
  return `${fmtMoney(min)} – ${fmtMoney(max)}`;
}

function publicUrlToAbs(publicUrl) {
  if (!publicUrl) return null;
  const rel = String(publicUrl).replace(/^\/uploads\//, "");
  const abs = path.join(UPLOADS_DIR, rel);
  if (!fs.existsSync(abs)) return null;
  return abs;
}

function imageToDataUri(publicUrl) {
  const abs = publicUrlToAbs(publicUrl);
  if (!abs) return null;
  const ext = path.extname(abs).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
}

function pricingModeLabel(mode) {
  return mode === "fixed" ? "固定件价" : "按㎡";
}

function assertPublished(template) {
  if (!template) {
    const err = new Error("模板不存在");
    err.status = 404;
    throw err;
  }
  if (template.status !== "published") {
    const err = new Error("仅已发布模板可导出手册");
    err.status = 403;
    throw err;
  }
}

function buildPublicBom(template) {
  return {
    profiles: (template.quote_profiles || []).map((l, i) => ({
      no: i + 1,
      color: l.color || "—",
      length_inch: l.length_inch,
      qty: l.qty,
      coefficient: l.coefficient ?? 1
    })),
    nuts: (template.quote_nuts || []).map((l, i) => ({
      no: i + 1,
      model: l.nut_model || "—",
      name: l.item_name || "—",
      qty: l.qty
    })),
    hardware: (template.quote_hardware || []).map((l, i) => ({
      no: i + 1,
      name: l.item_name || "—",
      spec: l.spec || "—",
      unit: l.unit || "—",
      qty: l.qty
    })),
    panels: (template.quote_panels || []).map((l, i) => ({
      no: i + 1,
      material: l.material_type || "—",
      color: l.color || "—",
      thickness: l.thickness_mm != null ? `${l.thickness_mm} mm` : "—",
      size: `${l.length_inch}×${l.width_inch} in`,
      area: l.area_sqm != null ? Number(l.area_sqm).toFixed(4) : "—",
      qty: l.qty,
      pricing: pricingModeLabel(l.pricing_mode)
    })),
    legacy: (template.bom || []).map((l) => ({
      no: l.line_no,
      category: l.category,
      name: l.item_name,
      spec: l.spec || "—",
      qty: l.qty,
      unit: l.unit
    }))
  };
}

function renderTable(headers, rows) {
  if (!rows.length) {
    return '<p class="empty">暂无明细</p>';
  }
  return `<table>
    <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .map(
        (cells) =>
          `<tr>${cells.map((c) => `<td>${typeof c === "number" ? c : escapeHtml(c)}</td>`).join("")}</tr>`
      )
      .join("")}</tbody>
  </table>`;
}

function renderBomSection(title, headers, rowCells) {
  if (!rowCells.length) return "";
  return `<div class="bom-block">
    <h3>${escapeHtml(title)}</h3>
    ${renderTable(headers, rowCells)}
  </div>`;
}

function renderCombinedBomPage(bom) {
  const sections = [
    renderBomSection(
      "MR2525 型材",
      ["#", "颜色", "长度(in)", "数量", "系数"],
      bom.profiles.map((l) => [l.no, l.color, l.length_inch, l.qty, l.coefficient])
    ),
    renderBomSection(
      "六通",
      ["#", "型号", "名称", "数量"],
      bom.nuts.map((l) => [l.no, l.model, l.name, l.qty])
    ),
    renderBomSection(
      "五金配件",
      ["#", "项目", "规格", "单位", "数量"],
      bom.hardware.map((l) => [l.no, l.name, l.spec, l.unit, l.qty])
    ),
    renderBomSection(
      "板材",
      ["#", "材质", "颜色", "厚度", "长×宽", "面积(㎡)", "数量", "计价"],
      bom.panels.map((l) => [l.no, l.material, l.color, l.thickness, l.size, l.area, l.qty, l.pricing])
    ),
    renderBomSection(
      "其他",
      ["#", "类别", "项目", "规格", "数量", "单位"],
      bom.legacy.map((l) => [l.no, l.category, l.name, l.spec, l.qty, l.unit])
    )
  ].filter(Boolean);

  const body = sections.length
    ? `<div class="bom-sections">${sections.join("")}</div>`
    : '<p class="empty">暂无 BOM 明细</p>';

  return `<section class="page page-bom">
  <div class="page-inner">
    <h2 class="page-title">BOM 清单</h2>
    ${body}
  </div>
</section>`;
}

function sheetStyles() {
  return `@page {
  size: ${PAGE_W}px ${PAGE_H}px;
  margin: 0;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
  color: #0f172a;
  background: #fff;
}
.page {
  width: ${PAGE_W}px;
  height: ${PAGE_H}px;
  position: relative;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
  background: #fff;
}
.page:last-child {
  page-break-after: auto;
  break-after: auto;
}
.page-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.page-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 28px 14px;
  background: linear-gradient(transparent, rgba(15, 23, 42, 0.72));
  color: #fff;
  font-size: 13px;
  letter-spacing: 0.4px;
}
.page-cover .cover-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(15, 23, 42, 0.08) 0%,
    rgba(15, 23, 42, 0.15) 42%,
    rgba(15, 23, 42, 0.82) 100%
  );
}
.page-cover .cover-info {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 28px 40px 34px;
  color: #fff;
}
.page-cover .cover-name {
  margin: 0 0 8px;
  font-size: 34px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: 0.5px;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
}
.page-cover .cover-price {
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 8px;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.3);
}
.page-cover .cover-liner {
  margin: 0 0 12px;
  font-size: 15px;
  line-height: 1.45;
  opacity: 0.95;
  max-width: 88%;
}
.page-cover .cover-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  font-size: 12px;
  opacity: 0.9;
  margin-bottom: 10px;
}
.page-cover .cover-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.page-cover .cover-tag {
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.28);
  font-size: 11px;
}
.page-cover-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #1e293b, #334155);
  color: #94a3b8;
  font-size: 18px;
}
.page-inner {
  position: absolute;
  inset: 0;
  padding: 36px 44px 32px;
  display: flex;
  flex-direction: column;
}
.page-title {
  margin: 0 0 18px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}
.page-title::after {
  content: "";
  display: block;
  width: 48px;
  height: 3px;
  background: #0f172a;
  margin-top: 10px;
}
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 28px;
  font-size: 13px;
  margin-bottom: 18px;
}
.info-grid dt {
  margin: 0;
  color: #64748b;
  font-size: 11px;
}
.info-grid dd {
  margin: 2px 0 0;
  font-weight: 600;
}
.note-block {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px 14px;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.55;
  margin-bottom: 14px;
}
.note-label {
  font-size: 11px;
  color: #64748b;
  margin: 0 0 6px;
  font-weight: 600;
}
.page-bom .page-inner {
  padding: 18px 36px 16px;
}
.page-bom .page-title {
  margin-bottom: 10px;
  font-size: 18px;
}
.page-bom .page-title::after {
  margin-top: 6px;
  height: 2px;
}
.bom-sections {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bom-block h3 {
  margin: 0 0 3px;
  font-size: 10px;
  font-weight: 700;
  color: #475569;
  letter-spacing: 0.2px;
}
.bom-block table {
  margin-bottom: 2px;
}
.page-bom table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9px;
}
.page-bom th,
.page-bom td {
  border: 1px solid #e2e8f0;
  padding: 2px 5px;
  text-align: left;
  line-height: 1.3;
}
.page-bom th {
  background: #f1f5f9;
  font-weight: 600;
  font-size: 8.5px;
}
.empty {
  color: #94a3b8;
  font-size: 13px;
}`;
}

function renderCoverPage(template, coverData, tags, dims) {
  const bg = coverData
    ? `<img class="page-bg" src="${coverData}" alt="" />`
    : `<div class="page-cover-fallback">暂无封面</div>`;
  const tagHtml = tags.length
    ? `<div class="cover-tags">${tags.map((t) => `<span class="cover-tag">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";

  return `<section class="page page-cover">
  ${bg}
  ${coverData ? '<div class="cover-shade"></div>' : ""}
  <div class="cover-info">
    <h1 class="cover-name">${escapeHtml(template.name)}</h1>
    <div class="cover-price">${escapeHtml(fmtPriceRange(template.price_min, template.price_max))}</div>
    ${template.one_liner ? `<p class="cover-liner">${escapeHtml(template.one_liner)}</p>` : ""}
    <div class="cover-meta">
      <span>${escapeHtml(template.template_code)}</span>
      <span>${escapeHtml(template.scenario)}</span>
      <span>${escapeHtml(dims)}</span>
    </div>
    ${tagHtml}
  </div>
</section>`;
}

function renderFullImagePage(src, caption) {
  return `<section class="page page-image">
  <img class="page-bg" src="${src}" alt="" />
  <div class="page-caption">${escapeHtml(caption)}</div>
</section>`;
}

function renderInfoPage(template, dims, tags) {
  const tagLine = tags.length ? tags.map(escapeHtml).join(" · ") : "—";
  return `<section class="page page-info">
  <div class="page-inner">
    <h2 class="page-title">方案信息</h2>
    <dl class="info-grid">
      <div><dt>模板编号</dt><dd>${escapeHtml(template.template_code)}</dd></div>
      <div><dt>应用场景</dt><dd>${escapeHtml(template.scenario)}</dd></div>
      <div><dt>外形尺寸</dt><dd>${escapeHtml(dims)}</dd></div>
      <div><dt>版本</dt><dd>${escapeHtml(template.version || "—")}</dd></div>
      <div><dt>参考价</dt><dd>${escapeHtml(fmtPriceRange(template.price_min, template.price_max))}</dd></div>
      <div><dt>标签</dt><dd>${tagLine}</dd></div>
    </dl>
    ${
      template.one_liner
        ? `<p class="note-label">一句话简介</p><div class="note-block">${escapeHtml(template.one_liner)}</div>`
        : ""
    }
    ${
      template.panel_note
        ? `<p class="note-label">皮肤选配说明</p><div class="note-block">${escapeHtml(template.panel_note)}</div>`
        : ""
    }
    ${
      template.quote_note
        ? `<p class="note-label">报价口径</p><div class="note-block">${escapeHtml(template.quote_note)}</div>`
        : ""
    }
  </div>
</section>`;
}

function buildTemplatePages(template) {
  assertPublished(template);
  const bom = buildPublicBom(template);
  const tags = template.tags || [];
  const coverData = imageToDataUri(template.cover_image);

  const dims =
    template.width_mm && template.depth_mm && template.height_mm
      ? `${template.width_mm} × ${template.depth_mm} × ${template.height_mm} mm`
      : "—";

  const pages = [];

  pages.push(renderCoverPage(template, coverData, tags, dims));

  (template.effect_images || []).forEach((url, i, arr) => {
    const src = imageToDataUri(url);
    if (src) {
      pages.push(renderFullImagePage(src, `效果图 ${i + 1} / ${arr.length}`));
    }
  });

  (template.render_images || []).forEach((url, i, arr) => {
    const src = imageToDataUri(url);
    if (src) {
      pages.push(renderFullImagePage(src, `渲染图 ${i + 1} / ${arr.length}`));
    }
  });

  pages.push(renderInfoPage(template, dims, tags));
  pages.push(renderCombinedBomPage(bom));

  return pages;
}

function wrapSheetHtml(title, pageSections) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>${sheetStyles()}</style>
</head>
<body>
  ${pageSections.join("\n")}
</body>
</html>`;
}

function generatePublicSheetHtml(template) {
  return wrapSheetHtml(`${template.template_code} 方案清单`, buildTemplatePages(template));
}

async function renderPdfFromHtml(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: PAGE_W, height: PAGE_H });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      width: `${PAGE_W}px`,
      height: `${PAGE_H}px`,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

async function getBrowser() {
  if (!browserPromise) {
    const executablePath = resolveExecutablePath();
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"]
    });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

function resolveExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  const err = new Error(
    "未找到 Chrome/Chromium。请安装 Chrome/Edge，或设置环境变量 PUPPETEER_EXECUTABLE_PATH"
  );
  err.status = 500;
  throw err;
}

async function renderPublicSheetPdf(template) {
  return renderPdfFromHtml(generatePublicSheetHtml(template));
}

function pdfFilename(templateCode) {
  return `${templateCode}_手册.pdf`;
}

function contentDisposition(filename) {
  const encoded = encodeURIComponent(filename);
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "") || "sheet.pdf";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

module.exports = {
  generatePublicSheetHtml,
  buildTemplatePages,
  wrapSheetHtml,
  renderPdfFromHtml,
  renderPublicSheetPdf,
  pdfFilename,
  contentDisposition,
  assertPublished,
  sheetStyles,
  imageToDataUri,
  PAGE_W,
  PAGE_H
};
