const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const puppeteer = require("puppeteer-core");
const { UPLOADS_DIR } = require("./storage");
const { handbookDateLabel, renderLogoBar } = require("./design-system");

/** 16:9 横版幻灯片尺寸（px，与 @page / puppeteer 一致） */
const PAGE_W = 960;
const PAGE_H = 540;

/** 手册图片优化参数：页面只有 960×540，原图动辄十几 MB，必须下采样后交给 Chromium */
const SHEET_IMG_MAX_EDGE = 1400;
const SHEET_IMG_QUALITY = 0.82;
const SHEET_IMG_MIN_BYTES = 400 * 1024;
const SHEET_IMG_MIN_CHARS = Math.floor(SHEET_IMG_MIN_BYTES * 4 / 3);
const SHEET_CACHE_LIMIT = 120;

const compressedByPath = new Map(); // 文件指纹 -> 压缩后的 data URI
const compressedByHash = new Map(); // 兜底：data URI 内容指纹 -> 压缩后的 data URI
const optimizedB64 = new Set(); // 已是压缩产物的 base64，不再重复压缩

function rememberOptimized(dataUri) {
  const i = dataUri.indexOf(",");
  if (i > 0) optimizedB64.add(dataUri.slice(i + 1));
  return dataUri;
}

let browserPromise = null;

function cacheSet(map, key, value) {
  if (map.size >= SHEET_CACHE_LIMIT) map.delete(map.keys().next().value);
  map.set(key, value);
}

function isBrowserDeath(e) {
  return /Connection closed|Target closed|disconnected|Protocol error|browser has been closed|Failed to launch|Session closed/i.test(
    String((e && e.message) || e)
  );
}

function mimeOfPath(abs) {
  const ext = path.extname(abs).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function imageCacheKey(abs) {
  const st = fs.statSync(abs);
  return `${abs}|${st.size}|${Math.round(st.mtimeMs)}`;
}

/**
 * 用 Chromium 自身的 canvas 把单张大图缩到 1400px 内并转 JPEG。
 * 图片经本地拦截返回（同源，canvas 不会被污染），且一次只处理一张，避免撑爆容器内存。
 */
async function shrinkImageWithBrowser(browser, buf, mime) {
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(60000);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url === "http://sheet.local/") {
        req.respond({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>img</title>" }).catch(() => {});
      } else if (url === "http://sheet.local/image") {
        req.respond({ status: 200, contentType: mime, body: buf }).catch(() => {});
      } else {
        req.abort().catch(() => {});
      }
    });
    await page.goto("http://sheet.local/", { waitUntil: "domcontentloaded" });
    return await page.evaluate(
      async ({ url, maxEdge, quality }) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        return canvas.toDataURL("image/jpeg", quality);
      },
      { url: "http://sheet.local/image", maxEdge: SHEET_IMG_MAX_EDGE, quality: SHEET_IMG_QUALITY }
    );
  } finally {
    await page.close().catch(() => {});
  }
}

/** 生成手册前预热图片压缩缓存，让 generatePublicSheetHtml 直接拿到小图 */
async function prepareSheetImages(template) {
  const urls = [
    template.cover_image,
    ...(template.effect_images || []),
    ...(template.render_images || [])
  ].filter(Boolean);
  const todo = [];
  for (const url of new Set(urls)) {
    const abs = publicUrlToAbs(url);
    if (!abs) continue;
    let key;
    try {
      key = imageCacheKey(abs);
    } catch {
      continue;
    }
    if (compressedByPath.has(key)) continue;
    if (fs.statSync(abs).size < SHEET_IMG_MIN_BYTES) continue;
    todo.push({ abs, key });
  }
  if (!todo.length) return;

  const browser = await getBrowser();
  let done = 0;
  for (const { abs, key } of todo) {
    if (compressedByPath.has(key)) continue;
    try {
      const out = rememberOptimized(await shrinkImageWithBrowser(browser, fs.readFileSync(abs), mimeOfPath(abs)));
      cacheSet(compressedByPath, key, out);
      done += 1;
    } catch (e) {
      if (isBrowserDeath(e)) {
        await resetBrowser();
        throw e;
      }
      console.warn("[public-sheet] 图片压缩跳过:", path.basename(abs), e.message);
    }
  }
  console.log(`[public-sheet] 图片压缩 ${done}/${todo.length}`);
}

/** 兜底：场景手册等未走预热的路径，仍在打印前把超大 data URI 换掉 */
const BIG_DATA_URI_RE = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;

async function compactHtmlImages(html, browser) {
  const jobs = new Map();
  let m;
  BIG_DATA_URI_RE.lastIndex = 0;
  while ((m = BIG_DATA_URI_RE.exec(html))) {
    if (m[2].length < SHEET_IMG_MIN_CHARS || jobs.has(m[2]) || optimizedB64.has(m[2])) continue;
    jobs.set(m[2], {
      key: crypto.createHash("sha1").update(m[2]).digest("hex"),
      mime: `image/${m[1]}`
    });
  }
  if (!jobs.size) return { html, optimized: 0 };

  const replacements = new Map();
  for (const [b64, info] of jobs) {
    let out = compressedByHash.get(info.key);
    if (!out) {
      try {
        out = rememberOptimized(await shrinkImageWithBrowser(browser, Buffer.from(b64, "base64"), info.mime));
      } catch (e) {
        if (isBrowserDeath(e)) throw e;
        console.warn("[public-sheet] 兜底压缩失败，保留原图:", e.message);
        continue;
      }
      cacheSet(compressedByHash, info.key, out);
    }
    replacements.set(b64, out);
  }
  if (!replacements.size) return { html, optimized: 0 };
  BIG_DATA_URI_RE.lastIndex = 0;
  const compact = html.replace(BIG_DATA_URI_RE, (full, _mime, b64) => replacements.get(b64) || full);
  const before = (Buffer.byteLength(html) / 1048576).toFixed(1);
  const after = (Buffer.byteLength(compact) / 1048576).toFixed(1);
  console.log(`[public-sheet] HTML 图片兜底压缩 ${replacements.size} 张：${before}MB → ${after}MB`);
  return { html: compact, optimized: replacements.size };
}

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

function fmtPackagePrice(template) {
  const price = fmtMoney(template.package_price);
  const basisDate = String(template.price_basis_date || "").trim();
  return basisDate ? `${price}（含税，基准日 ${basisDate}）` : `${price}（含税）`;
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
  // 优先用预热阶段压缩过的图，避免整张原始 PNG 被 base64 塞进 HTML
  try {
    const hit = compressedByPath.get(imageCacheKey(abs));
    if (hit) return hit;
  } catch {
    // stat 失败时回退到读原图
  }
  return `data:${mimeOfPath(abs)};base64,${fs.readFileSync(abs).toString("base64")}`;
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
  color: var(--ds-black);
  background: var(--ds-white);
}
.page {
  width: ${PAGE_W}px;
  height: ${PAGE_H}px;
  position: relative;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
  background: var(--ds-white);
}
.page-info {
  background: var(--ds-off-white);
}
.page-cover .ds-logo-bar {
  top: 20px;
  left: auto;
  right: 28px;
  flex-direction: row-reverse;
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
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
  padding-bottom: 36px;
  color: #fff;
  font-size: 13px;
  letter-spacing: 0.4px;
}
.page-cover .cover-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.08) 0%,
    rgba(0, 0, 0, 0.15) 42%,
    rgba(0, 0, 0, 0.85) 100%
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
  background: var(--ds-black);
  color: var(--ds-muted);
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
  background: var(--ds-black);
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
  color: var(--ds-muted);
  font-size: 11px;
}
.info-grid dd {
  margin: 2px 0 0;
  font-weight: 600;
}
.note-block {
  background: var(--ds-white);
  border: 1px solid var(--ds-black);
  border-radius: 8px;
  padding: 12px 14px;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.55;
  margin-bottom: 14px;
}
.note-label {
  font-size: 11px;
  color: var(--ds-muted);
  margin: 0 0 6px;
  font-weight: 600;
}
.page-bom .page-inner {
  padding: 18px 36px 16px;
  background: var(--ds-white);
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
  color: var(--ds-muted);
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
  border: 1px solid var(--ds-black);
  padding: 2px 5px;
  text-align: left;
  line-height: 1.3;
}
.page-bom th {
  background: var(--ds-off-white);
  font-weight: 600;
  font-size: 8.5px;
}
.empty {
  color: var(--ds-muted);
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
  ${renderLogoBar()}
  ${coverData ? '<div class="cover-shade"></div>' : ""}
  <div class="cover-info">
    <h1 class="cover-name">${escapeHtml(template.name)}</h1>
    <div class="cover-price">${escapeHtml(fmtPackagePrice(template))}</div>
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
      <div><dt>整包价</dt><dd>${escapeHtml(fmtPackagePrice(template))}</dd></div>
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
  const { prependAppendBrandPages, wrapHandbookDocument } = require("./handbook-shell");
  const withBrand = prependAppendBrandPages(pageSections, "templateHandbook");
  return wrapHandbookDocument({
    title,
    extraStyles: "",
    bodySections: withBrand,
    versionLabel: handbookDateLabel()
  });
}

function generatePublicSheetHtml(template) {
  return wrapSheetHtml(`${template.template_code} 方案清单`, buildTemplatePages(template));
}

async function printPdf(browser, html) {
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(60000);
    await page.setViewport({ width: PAGE_W, height: PAGE_H });
    await page.setContent(html, { waitUntil: "load" });
    // 等图片真正解码完成再打印，避免 PDF 出现空白页
    await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images || []).map((img) =>
          img.decode ? img.decode().catch(() => {}) : Promise.resolve()
        )
      );
    });
    const pdf = await page.pdf({
      width: `${PAGE_W}px`,
      height: `${PAGE_H}px`,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
    return Buffer.from(pdf);
  } finally {
    // 浏览器已崩溃时 close 会再抛一次，不能让它盖住真实错误
    await page.close().catch(() => {});
  }
}

async function renderPdfFromHtml(html) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const browser = await getBrowser();
      const compact = await compactHtmlImages(html, browser);
      return await printPdf(browser, compact.html);
    } catch (e) {
      if (!isBrowserDeath(e) || attempt === 1) throw e;
      console.warn("[public-sheet] 浏览器连接断开，重建后重试一次");
      await resetBrowser();
    }
  }
}

async function getBrowser() {
  if (!browserPromise) {
    const executablePath = resolveExecutablePath();
    const p = puppeteer
      .launch({
        headless: true,
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--font-render-hinting=none",
          // 容器 /dev/shm 默认只有 64MB，Chromium 渲染大图极易在此崩溃
          "--disable-dev-shm-usage",
          "--disable-gpu"
        ]
      })
      .then((browser) => {
        browser.on("disconnected", () => {
          if (browserPromise === p) browserPromise = null;
        });
        return browser;
      });
    browserPromise = p;
    p.catch(() => {
      if (browserPromise === p) browserPromise = null;
    });
  }
  return browserPromise;
}

async function resetBrowser() {
  const p = browserPromise;
  browserPromise = null;
  if (!p) return;
  try {
    const browser = await p;
    await browser.close();
  } catch {
    // 已经断开的浏览器无需再关
  }
}

function resolveExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await prepareSheetImages(template);
      return await renderPdfFromHtml(generatePublicSheetHtml(template));
    } catch (e) {
      if (!isBrowserDeath(e) || attempt === 1) throw e;
      await resetBrowser();
    }
  }
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
