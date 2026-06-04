const fs = require("fs");
const path = require("path");
const { sheetStyles, PAGE_W, PAGE_H } = require("./public-sheet");
const {
  designSystemStyles,
  injectHandbookFooters,
  handbookDateLabel,
  renderLogoBar
} = require("./design-system");

const BRAND_CONFIG_PATH = path.join(__dirname, "..", "data", "handbook", "brand.json");

const DEFAULT_BRAND = {
  version: 1,
  brand: {
    productName: "Parti空间编辑系统",
    tagline: "",
    scenarioTitleTemplate: "——{scenarioName}空间",
    contact: {}
  },
  pages: { intro: [], outro: [], beforePartB: [] },
  apply: {
    scenarioHandbook: { intro: false, outro: false, beforePartB: false },
    templateHandbook: { intro: false, outro: false }
  }
};

let cachedConfig = null;
let configLoadWarned = false;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadHandbookBrandConfig(forceReload = false) {
  if (cachedConfig && !forceReload) return cachedConfig;
  try {
    const raw = fs.readFileSync(BRAND_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.brand?.productName) {
      throw new Error("brand.productName 必填");
    }
    parsed.pages = parsed.pages || {};
    parsed.pages.intro = Array.isArray(parsed.pages.intro) ? parsed.pages.intro : [];
    parsed.pages.outro = Array.isArray(parsed.pages.outro) ? parsed.pages.outro : [];
    parsed.pages.beforePartB = Array.isArray(parsed.pages.beforePartB) ? parsed.pages.beforePartB : [];
    parsed.apply = parsed.apply || DEFAULT_BRAND.apply;
    cachedConfig = parsed;
    configLoadWarned = false;
    return cachedConfig;
  } catch (e) {
    if (!configLoadWarned) {
      console.warn("[handbook-shell] 品牌配置加载失败，使用降级:", e.message);
      configLoadWarned = true;
    }
    cachedConfig = { ...DEFAULT_BRAND, _degraded: true };
    return cachedConfig;
  }
}

function getBrandMeta() {
  const cfg = loadHandbookBrandConfig();
  return cfg.brand || DEFAULT_BRAND.brand;
}

function formatScenarioTitle(scenarioName) {
  const tpl =
    getBrandMeta().scenarioTitleTemplate || DEFAULT_BRAND.brand.scenarioTitleTemplate;
  return tpl.replace(/\{scenarioName\}/g, String(scenarioName ?? ""));
}

function handbookThemeStyles() {
  return `
.page-brand {
  width: ${PAGE_W}px;
  height: ${PAGE_H}px;
  position: relative;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
}
.page-brand-hero {
  background: var(--ds-black);
  color: var(--ds-white);
  padding: 52px 56px 48px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.page-brand-hero .brand-kicker {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.75;
}
.page-brand-hero h1 {
  margin: 0 0 14px;
  font-size: 36px;
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: 0.5px;
}
.page-brand-hero .brand-subtitle {
  margin: 0 0 22px;
  font-size: 16px;
  line-height: 1.5;
  max-width: 82%;
  opacity: 0.92;
}
.page-brand-hero ul {
  margin: 0;
  padding: 0 0 0 20px;
  font-size: 13px;
  line-height: 1.55;
  max-width: 88%;
}
.page-brand-hero li { margin-bottom: 8px; }
.page-brand-split {
  background: var(--ds-off-white);
  padding: 44px 52px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.page-brand-split h2 {
  margin: 0 0 16px;
  font-size: 28px;
  font-weight: 700;
  color: var(--ds-black);
}
.page-brand-split h2::after {
  content: "";
  display: block;
  width: 48px;
  height: 3px;
  background: var(--ds-black);
  margin-top: 10px;
}
.page-brand-split .brand-body {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
  color: var(--ds-muted);
  max-width: 90%;
  white-space: pre-wrap;
}
.page-brand-closing {
  background: var(--ds-black);
  color: var(--ds-white);
  padding: 48px 56px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.page-brand-closing h2 {
  margin: 0 0 20px;
  font-size: 30px;
  font-weight: 700;
}
.page-brand-closing .brand-lines {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 15px;
  line-height: 1.6;
  opacity: 0.92;
}
.page-brand-closing .brand-lines li { margin-bottom: 10px; }
.page-brand-closing .brand-contact {
  margin-top: 28px;
  font-size: 12px;
  opacity: 0.8;
  line-height: 1.5;
}
.handbook-brand-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 48px 56px 52px;
  background: linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.85) 100%);
  pointer-events: none;
}
.handbook-brand-title {
  margin: 0 0 10px;
  color: var(--ds-white);
  font-size: 38px;
  font-weight: 700;
  letter-spacing: 1px;
  line-height: 1.15;
  text-shadow: 0 2px 12px rgba(0,0,0,.45);
}
.handbook-brand-scenario {
  margin: 0 0 8px;
  color: var(--ds-white);
  font-size: 26px;
  font-weight: 700;
  line-height: 1.2;
  text-shadow: 0 2px 10px rgba(0,0,0,.4);
}
.handbook-brand-version {
  margin: 0;
  color: var(--ds-white);
  font-size: 15px;
  font-weight: 700;
  opacity: 0.95;
  letter-spacing: 0.5px;
}`;
}

function renderBrandPage(pageDef) {
  if (!pageDef || !pageDef.layout) return "";
  const layout = pageDef.layout;
  if (layout === "hero") {
    const bullets = (pageDef.bullets || [])
      .map((b) => `<li>${escapeHtml(b)}</li>`)
      .join("");
    return `<section class="page page-brand page-brand-hero">
  ${renderLogoBar({ invert: true })}
  <p class="brand-kicker">${escapeHtml(getBrandMeta().tagline || "")}</p>
  <h1>${escapeHtml(pageDef.title || "")}</h1>
  ${pageDef.subtitle ? `<p class="brand-subtitle">${escapeHtml(pageDef.subtitle)}</p>` : ""}
  ${bullets ? `<ul>${bullets}</ul>` : ""}
</section>`;
  }
  if (layout === "split") {
    return `<section class="page page-brand page-brand-split">
  <h2>${escapeHtml(pageDef.title || "")}</h2>
  <p class="brand-body">${escapeHtml(pageDef.body || "")}</p>
</section>`;
  }
  if (layout === "closing") {
    const lines = (pageDef.lines || [])
      .map((l) => `<li>${escapeHtml(l)}</li>`)
      .join("");
    const contact = getBrandMeta().contact || {};
    const contactBits = [contact.web, contact.email].filter(Boolean).map(escapeHtml);
    const contactHtml = contactBits.length
      ? `<div class="brand-contact">${contactBits.join(" · ")}</div>`
      : "";
    return `<section class="page page-brand page-brand-closing">
  ${renderLogoBar({ invert: true })}
  <h2>${escapeHtml(pageDef.title || "")}</h2>
  <ul class="brand-lines">${lines}</ul>
  ${contactHtml}
</section>`;
  }
  console.warn("[handbook-shell] 未知 layout:", layout);
  return "";
}

function renderBrandIntroPages(applyKey = "scenarioHandbook") {
  const cfg = loadHandbookBrandConfig();
  const apply = cfg.apply?.[applyKey];
  if (!apply?.intro) return [];
  return (cfg.pages?.intro || []).map(renderBrandPage).filter(Boolean);
}

function renderBrandOutroPages(applyKey = "scenarioHandbook") {
  const cfg = loadHandbookBrandConfig();
  const apply = cfg.apply?.[applyKey];
  if (!apply?.outro) return [];
  return (cfg.pages?.outro || []).map(renderBrandPage).filter(Boolean);
}

function renderBrandBeforePartBPages(applyKey = "scenarioHandbook") {
  const cfg = loadHandbookBrandConfig();
  const apply = cfg.apply?.[applyKey];
  if (!apply?.beforePartB) return [];
  const extra = cfg.pages?.beforePartB || [];
  return extra.map(renderBrandPage).filter(Boolean);
}

function renderHandbookBrandBlock(scenarioName, version) {
  const brand = getBrandMeta();
  return `<div class="handbook-brand-title">${escapeHtml(brand.productName)}</div>
    <div class="handbook-brand-scenario">${escapeHtml(formatScenarioTitle(scenarioName))}</div>
    <div class="handbook-brand-version">${escapeHtml(version)}</div>`;
}

function prependAppendBrandPages(pages, applyKey) {
  const intro = renderBrandIntroPages(applyKey);
  const outro = renderBrandOutroPages(applyKey);
  return [...intro, ...pages, ...outro];
}

function wrapHandbookDocument({ title, extraStyles = "", bodySections, versionLabel }) {
  const version = versionLabel || handbookDateLabel();
  const styles =
    sheetStyles() + designSystemStyles() + handbookThemeStyles() + (extraStyles || "");
  const raw = Array.isArray(bodySections) ? bodySections.join("\n") : bodySections;
  const body = injectHandbookFooters(raw, version);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>${styles}</style>
</head>
<body>
  ${body}
</body>
</html>`;
}

function generateBrandPreviewHtml() {
  const intro = renderBrandIntroPages("scenarioHandbook");
  const outro = renderBrandOutroPages("scenarioHandbook");
  const tplIntro = renderBrandIntroPages("templateHandbook");
  const tplOutro = renderBrandOutroPages("templateHandbook");
  const sections = [
    '<section class="page section-divider">场景手册 · 品牌页预览</section>',
    ...intro,
    ...outro,
    '<section class="page section-divider">方案手册 · 品牌页预览</section>',
    ...tplIntro,
    ...tplOutro
  ];
  const dividerStyle = `
.section-divider {
  page-break-after: always;
  break-after: page;
  width: ${PAGE_W}px;
  height: ${PAGE_H}px;
  display: grid;
  place-items: center;
  background: var(--ds-black);
  color: var(--ds-white);
  font-size: 22px;
  font-weight: 700;
}`;
  return wrapHandbookDocument({
    title: "手册品牌页预览",
    extraStyles: dividerStyle,
    bodySections: sections,
    versionLabel: handbookDateLabel()
  });
}

module.exports = {
  BRAND_CONFIG_PATH,
  loadHandbookBrandConfig,
  getBrandMeta,
  formatScenarioTitle,
  handbookThemeStyles,
  renderHandbookBrandBlock,
  renderBrandIntroPages,
  renderBrandOutroPages,
  renderBrandBeforePartBPages,
  prependAppendBrandPages,
  wrapHandbookDocument,
  generateBrandPreviewHtml,
  escapeHtml
};
