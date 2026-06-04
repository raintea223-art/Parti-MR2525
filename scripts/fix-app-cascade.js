const fs = require("fs");
const path = require("path");
const APP = path.join(__dirname, "../public/app.js");
let s = fs.readFileSync(APP, "utf8");

const setupStart = s.indexOf("function setupPanelCascade(panelFilters)");
const bindStart = s.indexOf("function bindPanelLineColorEditors(root, templateId)");
const applyStart = s.indexOf("function applyLastPanelSelection(panelFilters)");
const priceLibStart = s.indexOf("let priceLibCategory = \"profile\"");

if ([setupStart, bindStart, applyStart, priceLibStart].some((i) => i === -1)) {
  console.error("markers missing", { setupStart, bindStart, applyStart, priceLibStart });
  process.exit(1);
}

const bindFn = s.slice(bindStart, applyStart);

const newCascade = `function setupPanelCascade(panelFilters) {
  const matEl = document.getElementById("panel-mat");
  const colorEl = document.getElementById("panel-color");
  const thickEl = document.getElementById("panel-thick");
  const specEl = document.getElementById("panel-spec");
  const priceIdEl = document.getElementById("panel-price-id");
  if (!matEl) return;

  function itemById(id) {
    return panelFilters.items.find((i) => String(i.id) === String(id));
  }

  function fillColorsForItem(item) {
    if (!item?.colors?.length) {
      colorEl.innerHTML = '<option value="">无可用颜色</option>';
      colorEl.disabled = true;
      return;
    }
    colorEl.disabled = false;
    colorEl.innerHTML =
      '<option value="">选择颜色…</option>' +
      item.colors
        .map((c) => \`<option value="\${escapeAttr(c.color)}">\${escapeHtml(c.color)}</option>\`)
        .join("");
  }

  function reset(from) {
    if (from <= 1) {
      thickEl.innerHTML = '<option value="">选择厚度…</option>';
      thickEl.disabled = true;
    }
    if (from <= 2) {
      specEl.innerHTML = '<option value="">选择规格…</option>';
      specEl.disabled = true;
      priceIdEl.value = "";
    }
    if (from <= 3) {
      colorEl.innerHTML = '<option value="">先选规格</option>';
      colorEl.disabled = true;
    }
  }

  matEl.addEventListener("change", () => {
    reset(1);
    const mat = matEl.value;
    if (!mat || !panelFilters.byMaterial[mat]) return;
    const thicknesses = [...panelFilters.byMaterial[mat].thicknesses].sort((a, b) => a - b);
    thickEl.disabled = false;
    thickEl.innerHTML =
      '<option value="">选择厚度…</option>' +
      thicknesses.map((th) => \`<option value="\${th}">\${th}mm</option>\`).join("");
  });

  thickEl.addEventListener("change", () => {
    reset(2);
    const mat = matEl.value;
    const thick = Number(thickEl.value);
    if (!mat || Number.isNaN(thick)) return;
    const items = panelFilters.byMaterial[mat].items.filter((i) => i.thickness_mm === thick);
    specEl.disabled = false;
    specEl.innerHTML =
      '<option value="">选择规格…</option>' +
      items
        .map((i) => {
          const hint = i.pricing_mode === "fixed" ? \`\${i.unit_price}元/件\` : \`\${i.unit_price}元/㎡\`;
          const sup = i.supplier ? \` · \${i.supplier}\` : "";
          return \`<option value="\${i.id}">\${escapeHtml(i.label)}（\${hint}）\${escapeHtml(sup)}</option>\`;
        })
        .join("");
  });

  specEl.addEventListener("change", () => {
    reset(3);
    const id = specEl.value;
    priceIdEl.value = id || "";
    if (!id) return;
    fillColorsForItem(itemById(id));
  });
}

`;

const newApply = `function applyLastPanelSelection(panelFilters) {
  if (!lastPanelSelection) return;
  const matEl = document.getElementById("panel-mat");
  const colorEl = document.getElementById("panel-color");
  const thickEl = document.getElementById("panel-thick");
  const specEl = document.getElementById("panel-spec");
  const priceIdEl = document.getElementById("panel-price-id");
  const form = document.getElementById("panel-add-form");
  if (!matEl || !panelFilters.byMaterial[lastPanelSelection.material_type]) return;

  const { material_type, color, thickness_mm, price_item_id } = lastPanelSelection;
  matEl.value = material_type;
  const matData = panelFilters.byMaterial[material_type];

  thickEl.disabled = false;
  thickEl.innerHTML =
    '<option value="">选择厚度…</option>' +
    matData.thicknesses.map((th) => \`<option value="\${th}">\${th}mm</option>\`).join("");
  thickEl.value = thickness_mm;

  const specItems = matData.items.filter((i) => i.thickness_mm === thickness_mm);
  specEl.disabled = false;
  specEl.innerHTML =
    '<option value="">选择规格…</option>' +
    specItems
      .map((i) => {
        const hint = i.pricing_mode === "fixed" ? \`\${i.unit_price}元/件\` : \`\${i.unit_price}元/㎡\`;
        return \`<option value="\${i.id}">\${escapeHtml(i.label)}（\${hint}）</option>\`;
      })
      .join("");
  specEl.value = String(price_item_id);
  priceIdEl.value = String(price_item_id);

  const item = panelFilters.items.find((i) => String(i.id) === String(price_item_id));
  if (item?.colors?.length) {
    colorEl.disabled = false;
    colorEl.innerHTML =
      '<option value="">选择颜色…</option>' +
      item.colors
        .map((c) => \`<option value="\${escapeAttr(c.color)}">\${escapeHtml(c.color)}</option>\`)
        .join("");
    if (color) colorEl.value = color;
  }

  if (form) {
    const lenInput = form.querySelector('#panel-select-fields input[name="length_inch"]');
    const widInput = form.querySelector('#panel-select-fields input[name="width_inch"]');
    const qtyInput = form.querySelector('#panel-select-fields input[name="qty"]');
    if (lenInput) lenInput.value = "";
    if (widInput) widInput.value = "";
    if (qtyInput) qtyInput.value = "1";
  }
}

`;

s = s.slice(0, setupStart) + newCascade + bindFn + newApply + s.slice(priceLibStart);

if (!s.includes("bindPanelLineColorEditors(root, t.id)")) {
  s = s.replace(
    "  root.querySelectorAll(\"[data-del-panel]\").forEach((btn) => {",
    "  bindPanelLineColorEditors(root, t.id);\n\n  root.querySelectorAll(\"[data-del-panel]\").forEach((btn) => {"
  );
}

fs.writeFileSync(APP, s);
console.log("cascade reordered ok");
