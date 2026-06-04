const fs = require("fs");
const path = require("path");
const shell = require("../src/handbook-shell");
const sh = require("../src/scenario-handbook");
const ps = require("../src/public-sheet");

const cfg = shell.loadHandbookBrandConfig();
const intro = shell.renderBrandIntroPages("scenarioHandbook");
const outro = shell.renderBrandOutroPages("scenarioHandbook");
const brandPreview = shell.generateBrandPreviewHtml();
const scenario = { id: 1, code: "SC-TEST", name: "测试展厅", description: "desc" };
const html = sh.generateScenarioHandbookHtml(scenario, [], []);
const tpl = {
  id: 2,
  status: "published",
  template_code: "TPL-T",
  name: "测",
  scenario: "测试",
  version: "1",
  tags: [],
  effect_images: [],
  render_images: [],
  quote_profiles: [],
  quote_nuts: [],
  quote_hardware: [],
  quote_panels: [],
  bom: []
};
const tplHtml = ps.generatePublicSheetHtml(tpl);

const checks = [
  ["HANDBOOK_BUILD", sh.HANDBOOK_BUILD === "20260603-handbook-design-system"],
  ["design-system footer", html.includes("SYSTEM PARTI")],
  ["design-system css vars", html.includes("--ds-accent")],
  ["tpl footer", tplHtml.includes("EDGEWARE EDGE MFG")],
  ["intro pages", intro.length === 2],
  ["outro pages", outro.length === 1],
  ["brand productName", cfg.brand.productName.includes("Parti")],
  ["scenario html intro", (html.match(/page-brand-hero/g) || []).length >= 1],
  ["scenario html closing", html.includes("page-brand-closing")],
  ["template html closing", tplHtml.includes("page-brand-closing")],
  [
    "template no intro hero",
    !tplHtml.includes("page-brand-hero") || tplHtml.indexOf("page-cover") < tplHtml.indexOf("page-brand-hero")
  ],
  ["brand preview", brandPreview.includes("品牌页预览")]
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? "OK" : "FAIL", name);
  if (!pass) ok = false;
}

const brandPath = path.join(__dirname, "..", "data", "handbook", "brand.json");
const bak = brandPath + ".bak-test";
fs.copyFileSync(brandPath, bak);
fs.writeFileSync(brandPath, "{invalid");
shell.loadHandbookBrandConfig(true);
const degraded = shell.renderBrandIntroPages("scenarioHandbook");
fs.copyFileSync(bak, brandPath);
fs.unlinkSync(bak);
shell.loadHandbookBrandConfig(true);
const degOk = degraded.length === 0;
console.log(degOk ? "OK" : "FAIL", "degraded intro empty");
if (!degOk) ok = false;

process.exit(ok ? 0 : 1);
