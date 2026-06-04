/**
 * Apply missing Phase 1 panel price form + submit patches to public/app.js
 */
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "public", "app.js");
let s = fs.readFileSync(APP, "utf8");
const nl = s.includes("\r\n") ? "\r\n" : "\n";

const OLD_SECTION = `      <div class="panel-color-section">
        <label class="color-field">
          颜色
          <div class="color-input-wrap">
            <span class="color-preview color-swatch-block" id="panel-color-preview" title="点击选择颜色"></span>
            <div class="color-picker-popover hidden" id="panel-color-popover">
              <label class="color-picker-rgb-label">
                RGB 色轮
                <input type="color" id="panel-color-picker" value="#cccccc" />
              </label>
              <button type="button" class="color-transparent-option" id="panel-color-transparent">
                <span class="color-swatch-block is-clear color-transparent-swatch"></span>
                <span>透明</span>
              </button>
            </div>
            <input name="color" id="panel-color-input" required placeholder="色块选色或输入颜色名" autocomplete="off" />
            <input type="hidden" name="color_hex" id="panel-color-hex" />
          </div>
        </label>
        <div class="color-swatch-grid" id="panel-color-swatches"></div>
      </div>`.replace(/\n/g, nl);

const NEW_SECTION = `      <div class="panel-color-section panel-price-colors-list">
        <span class="detail-section-label">颜色（可多个，同价）</span>
        <div id="panel-price-colors-chips" class="panel-price-colors-chips"></div>
        <label class="color-field">
          添加颜色
          <div class="color-input-wrap">
            <span class="color-preview color-swatch-block" id="panel-color-preview" title="点击选择颜色"></span>
            <div class="color-picker-popover hidden" id="panel-color-popover">
              <label class="color-picker-rgb-label">
                RGB 色轮
                <input type="color" id="panel-color-picker" value="#cccccc" />
              </label>
              <button type="button" class="color-transparent-option" id="panel-color-transparent">
                <span class="color-swatch-block is-clear color-transparent-swatch"></span>
                <span>透明</span>
              </button>
            </div>
            <input id="panel-color-input" placeholder="色块选色或输入颜色名" autocomplete="off" />
            <input type="hidden" id="panel-color-hex" />
          </div>
        </label>
        <button type="button" class="btn" id="panel-color-add-btn">加入颜色列表</button>
        <div class="color-swatch-grid" id="panel-color-swatches"></div>
        <input type="hidden" name="colors_json" id="panel-colors-json" value="[]" />
      </div>`.replace(/\n/g, nl);

const OLD_SUBMIT = `    if (category === "panel") {
      body.material_type = body.material_type?.trim();
      body.color = body.color?.trim();
      body.supplier = body.supplier?.trim();
      if (!body.material_type || !body.color) {
        toast("请填写材质与颜色", true);
        return;
      }
      if (!body.supplier) {
        toast("请填写供应商", true);
        return;
      }
      if (!body.label) {
        body.label = \`\${body.material_type} · \${body.color} · \${body.thickness_mm}mm\`;
      }
    }`;

const NEW_SUBMIT = `    if (category === "panel") {
      body.material_type = body.material_type?.trim();
      body.supplier = body.supplier?.trim();
      let colors = [];
      try {
        colors = JSON.parse(body.colors_json || "[]");
      } catch {
        colors = [];
      }
      if (!body.material_type) {
        toast("请填写材质", true);
        return;
      }
      if (!colors.length) {
        toast("请至少添加一种颜色", true);
        return;
      }
      if (!body.supplier) {
        toast("请填写供应商", true);
        return;
      }
      body.colors = colors;
      delete body.colors_json;
      if (!body.label) {
        body.label = \`\${body.material_type} · \${body.thickness_mm}mm\`;
      }
    }`.replace(/\n/g, nl);

const OLD_HEX_MAP = `function buildPanelColorHexMap(rows = []) {
  const map = { ...(meta?.panelColorSwatches || {}) };
  for (const r of rows) {
    if (r.color && r.color_hex) map[r.color] = r.color_hex;
  }
  return map;
}`.replace(/\n/g, nl);

const NEW_HEX_MAP = `function buildPanelColorHexMap(rows = []) {
  const map = { ...(meta?.panelColorSwatches || {}) };
  for (const r of rows) {
    if (r.colors?.length) {
      for (const c of r.colors) {
        if (c.color && c.color_hex) map[c.color] = c.color_hex;
      }
    } else if (r.color && r.color_hex) {
      map[r.color] = r.color_hex;
    }
  }
  return map;
}

function panelRowColorNames(rows = []) {
  const names = [];
  for (const r of rows) {
    if (r.colors?.length) {
      for (const c of r.colors) {
        if (c.color) names.push(c.color);
      }
    } else if (r.color) {
      names.push(r.color);
    }
  }
  return names;
}`.replace(/\n/g, nl);

const OLD_SUBMIT_NL = OLD_SUBMIT.replace(/\n/g, nl);
const NEW_SUBMIT_NL = NEW_SUBMIT.replace(/\n/g, nl);

let changed = 0;

if (!s.includes("panel-price-colors-list")) {
  if (!s.includes(OLD_SECTION)) {
    console.error("OLD_SECTION not found");
    process.exit(1);
  }
  s = s.replace(OLD_SECTION, NEW_SECTION);
  changed++;
  console.log("form section");
}

if (s.includes("body.color = body.color?.trim();") && s.includes('toast("请填写材质与颜色"')) {
  s = s.replace(OLD_SUBMIT_NL, NEW_SUBMIT_NL);
  changed++;
  console.log("submit handler");
}

if (!s.includes("function panelRowColorNames")) {
  if (!s.includes(OLD_HEX_MAP)) {
    console.error("OLD_HEX_MAP not found");
    process.exit(1);
  }
  s = s.replace(OLD_HEX_MAP, NEW_HEX_MAP);
  changed++;
  console.log("hex map");
}

if (s.includes("panelRows.map((r) => r.color)")) {
  s = s.replace(
    "panelRows.map((r) => r.color)",
    "panelRowColorNames(panelRows)"
  );
  changed++;
  console.log("color suggestions");
}

if (!changed) {
  console.log("nothing to patch");
} else {
  fs.writeFileSync(APP, s, "utf8");
  console.log("app.js updated");
}
