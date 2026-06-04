const fs = require("fs");
const path = require("path");

const DS_DIR = path.join(__dirname, "..", "data", "handbook", "design-system");
const ASSETS_DIR = path.join(__dirname, "..", "data", "handbook", "assets");
const DS_JSON = path.join(DS_DIR, "design-system.json");

const DEFAULT_DS = {
  colors: {
    black: "#000000",
    white: "#FFFFFF",
    offWhite: "#FCFBF7",
    accent: "#0055FF",
    muted: "#666666",
    border: "#000000"
  },
  fonts: {
    primary: "HarmonyOS Sans",
    fallback: "Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif",
    footer: "Consolas, Monaco, monospace"
  },
  footer: { rev: "REV A", segments: ["SYSTEM PARTI", "EDGEWARE EDGE MFG.", "REV A", null, null, "页"] },
  marker: { fill: "#0055FF" }
};

let cachedDs = null;

function loadDesignSystem(forceReload = false) {
  if (cachedDs && !forceReload) return cachedDs;
  try {
    cachedDs = { ...DEFAULT_DS, ...JSON.parse(fs.readFileSync(DS_JSON, "utf8")) };
    return cachedDs;
  } catch (e) {
    console.warn("[design-system] 加载失败，使用默认令牌:", e.message);
    cachedDs = { ...DEFAULT_DS };
    return cachedDs;
  }
}

function fontStack() {
  const ds = loadDesignSystem();
  const p = ds.fonts?.primary || "HarmonyOS Sans";
  const f = ds.fonts?.fallback || DEFAULT_DS.fonts.fallback;
  return `"${p}", ${f}`;
}

function footerFontStack() {
  const ds = loadDesignSystem();
  return ds.fonts?.footer || DEFAULT_DS.fonts.footer;
}

function colors() {
  return { ...DEFAULT_DS.colors, ...loadDesignSystem().colors };
}

function svgFileToDataUri(filename, { invert = false } = {}) {
  const abs = path.join(ASSETS_DIR, filename);
  if (!fs.existsSync(abs)) return null;
  let svg = fs.readFileSync(abs, "utf8");
  svg = svg.replace(/<rect[^>]*fill="white"[^>]*\/?>\s*/i, "");
  if (invert) {
    svg = svg.replace(/fill="black"/gi, 'fill="white"');
  }
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function renderLogoImg(name = "parti", heightPx = 28, options = {}) {
  const ds = loadDesignSystem();
  const file = name === "edgeware" ? ds.logos?.edgeware : ds.logos?.parti;
  if (!file) return "";
  const src = svgFileToDataUri(file, { invert: Boolean(options.invert) });
  if (!src) return "";
  const cls = options.invert ? "ds-logo ds-logo-invert" : "ds-logo";
  return `<img class="${cls}" src="${src}" alt="" height="${heightPx}" />`;
}

function renderLogoBar(options = {}) {
  const hParti = options.partiHeight || 22;
  const hEdge = options.edgewareHeight || 36;
  const parti = renderLogoImg("parti", hParti, { invert: options.invert });
  const edge = renderLogoImg("edgeware", hEdge, { invert: options.invert });
  if (!parti && !edge) return "";
  return `<div class="ds-logo-bar">${edge}${parti}</div>`;
}

function renderHandbookFooterHtml(versionLabel) {
  const ds = loadDesignSystem();
  const c = colors();
  const rev = ds.footer?.rev || "REV A";
  const date = versionLabel || handbookDateLabel();
  const pageSlot = '<span class="hf-page-num"></span>';
  const inner = `| SYSTEM PARTI | EDGEWARE EDGE MFG. | ${rev} | ${pageSlot} | DATE ${escapeHtml(date)} | 页 |`;
  return `<div class="handbook-footer" aria-hidden="true">${inner}</div>`;
}

function handbookDateLabel(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `V${y}${m}${d}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 在每页 </section> 前注入页脚；versionLabel 用于 DATE 段 */
function injectHandbookFooters(html, versionLabel) {
  const footer = renderHandbookFooterHtml(versionLabel);
  return html.replace(/<\/section>/gi, `${footer}</section>`);
}

function designSystemStyles() {
  const c = colors();
  const ds = loadDesignSystem();
  const accent = ds.marker?.fill || c.accent;
  return `
:root {
  --ds-black: ${c.black};
  --ds-white: ${c.white};
  --ds-off-white: ${c.offWhite};
  --ds-accent: ${accent};
  --ds-muted: ${c.muted};
  --ds-border: ${c.border};
}
html, body {
  font-family: ${fontStack()};
  color: var(--ds-black);
}
.page {
  padding-bottom: 36px;
}
.handbook-footer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 32px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  border-top: 1px solid var(--ds-border);
  background: var(--ds-white);
  font-family: ${footerFontStack()};
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ds-black);
  z-index: 5;
  white-space: nowrap;
  overflow: hidden;
}
.page-brand-hero .handbook-footer,
.page-brand-closing .handbook-footer,
.page-scenario-cover .handbook-footer,
.page-scenario-intro .handbook-footer,
.section-divider .handbook-footer {
  background: var(--ds-black);
  color: var(--ds-white);
  border-top-color: var(--ds-white);
}
.handbook-footer .hf-page-num::before {
  content: counter(handbook-page);
}
body {
  counter-reset: handbook-page;
}
.page {
  counter-increment: handbook-page;
}
.ds-logo-bar {
  position: absolute;
  top: 24px;
  left: 44px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 16px;
}
.ds-logo-bar .ds-logo { display: block; width: auto; }
.ds-logo-invert {
  filter: brightness(0) invert(1);
}
`;
}

module.exports = {
  loadDesignSystem,
  colors,
  fontStack,
  designSystemStyles,
  renderHandbookFooterHtml,
  injectHandbookFooters,
  handbookDateLabel,
  renderLogoImg,
  renderLogoBar,
  svgFileToDataUri,
  ASSETS_DIR
};
