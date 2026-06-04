const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "public/app.js");
let s = fs.readFileSync(APP, "utf8");

function done(flag) {
  if (s.includes(flag)) console.log("skip", flag);
  return s.includes(flag);
}

if (!done("function setupPanelCascadeV2")) {
  s = s.replace(
    `function setupPanelCascade(panelFilters) {
  const matEl = document.getElementById("panel-mat");
  const colorEl = document.getElementById("panel-color");
  const thickEl = document.getElementById("panel-thick");
  const specEl = document.getElementById("panel-spec");
  const priceIdEl = document.getElementById("panel-price-id");
  if (!matEl) return;

  function reset(from) {
    if (from <= 1) {
      colorEl.innerHTML = '<option value="">选择颜色…</option>';
      colorEl.disabled = true;
    }
    if (from <= 2) {
      thickEl.innerHTML = '<option value="">选择厚度…</option>';
      thickEl.disabled = true;
    }
    if (from <= 3) {
      specEl.innerHTML = '<option value="">选择规格…</option>';
      specEl.disabled = true;
      priceIdEl.value = "";
    }
  }

  matEl.addEventListener("change", () => {
    reset(1);
    const mat = matEl.value;
    if (!mat || !panelFilters.byMaterial[mat]) return;
    colorEl.disabled = false;
    colorEl.innerHTML =
      '<option value="">选择颜色…</option>' +
      panelFilters.byMaterial[mat].colors.map((c) => \`<option value="\${escapeAttr(c)}">\${escapeHtml(c)}</option>\`).join("");
  });

  colorEl.addEventListener("change", () => {
    reset(2);
    const mat = matEl.value;
    const color = colorEl.value;
    if (!mat || !color) return;
    const items = panelFilters.byMaterial[mat].items.filter((i) => i.color === color);
    const thicknesses = [...new Set(items.map((i) => i.thickness_mm).filter((x) => x != null))].sort(
      (a, b) => a - b
    );
    thickEl.disabled = false;
    thickEl.innerHTML =
      '<option value="">选择厚度…</option>' +
      thicknesses.map((th) => \`<option value="\${th}">\${th}mm</option>\`).join("");
  });

  thickEl.addEventListener("change", () => {
    reset(3);
    const mat = matEl.value;
    const color = colorEl.value;
    const thick = Number(thickEl.value);
    if (!mat || !color || Number.isNaN(thick)) return;
    const items = panelFilters.byMaterial[mat].items.filter(
      (i) => i.color === color && i.thickness_mm === thick
    );
    specEl.disabled = false;
    specEl.innerHTML =
      '<option value="">选择规格…</option>' +
      items
        .map((i) => {
          const hint = i.pricing_mode === "fixed" ? \`\${i.unit_price}元/件\` : \`\${i.unit_price}元/㎡\`;
          return \`<option value="\${i.id}">\${escapeHtml(i.label)}（\${hint}）</option>\`;
        })
        .join("");
  });

  specEl.addEventListener("change", () => {
    priceIdEl.value = specEl.value || "";
  });
}`,
    `function setupPanelCascade(panelFilters) {
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
}`
  );
  console.log("setupPanelCascade");
}

if (!done("applyLastPanelSelectionV2")) {
  s = s.replace(
    `function applyLastPanelSelection(panelFilters) {
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
  colorEl.disabled = false;
  colorEl.innerHTML =
    '<option value="">选择颜色…</option>' +
    matData.colors.map((c) => \`<option value="\${escapeAttr(c)}">\${escapeHtml(c)}</option>\`).join("");
  colorEl.value = color;

  const colorItems = matData.items.filter((i) => i.color === color);
  const thicknesses = [...new Set(colorItems.map((i) => i.thickness_mm).filter((x) => x != null))].sort(
    (a, b) => a - b
  );
  thickEl.disabled = false;
  thickEl.innerHTML =
    '<option value="">选择厚度…</option>' +
    thicknesses.map((th) => \`<option value="\${th}">\${th}mm</option>\`).join("");
  thickEl.value = thickness_mm;

  const specItems = colorItems.filter((i) => i.thickness_mm === thickness_mm);
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
  priceIdEl.value = String(price_item_id);`,
    `function applyLastPanelSelection(panelFilters) {
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
  }`
  );
  console.log("applyLastPanelSelection");
}

if (!s.includes("body.color = fd.get")) {
  s = s.replace(
    `      body = {
        price_item_id: Number(priceId),
        length_inch: fd.get("length_inch"),
        width_inch: fd.get("width_inch"),
        qty: fd.get("qty")
      };`,
    `      const panelColor = fd.get("color");
      if (!panelColor) {
        toast("请选择颜色", true);
        return;
      }
      body = {
        price_item_id: Number(priceId),
        color: panelColor,
        length_inch: fd.get("length_inch"),
        width_inch: fd.get("width_inch"),
        qty: fd.get("qty")
      };`
  );
  console.log("panel submit color");
}

if (!s.includes("renderPanelColorOptions")) {
  s = s.replace(
    `function renderPanelTable(lines) {
  if (!lines?.length) {
    return '<p class="hint">暂无板材行。请按材质/颜色/厚度从单价库选取。</p>';
  }
  return \`<table>
    <thead><tr>
      <th>材质</th><th>颜色</th><th>厚度</th><th>长×宽(in)</th><th>面积㎡</th><th>数量</th><th>件单价</th><th>小计</th><th></th>
    </tr></thead>
    <tbody>\${lines
      .map(
        (l) => \`<tr class="\${l.price_item_missing ? "row-price-missing" : ""}">
        <td>\${escapeHtml(l.material_type || "—")}</td>
        <td>\${renderColorLabel(l.color, l.color_hex)}\${priceMissingBadge(l)}</td>
        <td>\${l.thickness_mm != null ? l.thickness_mm + "mm" : "—"}</td>
        <td>\${l.length_inch}×\${l.width_inch}</td>
        <td>\${(l.area_sqm ?? 0).toFixed(4)}</td><td>\${l.qty}</td>
        <td>\${fmtMoney(l.unit_price)}</td><td>\${fmtMoney(l.subtotal)}</td>
        <td><button type="button" class="btn danger" data-del-panel="\${l.id}">删</button></td>
      </tr>\`
      )
      .join("")}</tbody>`,
    `function renderPanelColorOptions(line) {
  const names = (line.available_colors || []).map((c) => (typeof c === "string" ? c : c.color));
  if (!names.length) return escapeHtml(line.color || "—");
  const opts = names
    .map(
      (n) =>
        \`<option value="\${escapeAttr(n)}"\${n === line.color ? " selected" : ""}>\${escapeHtml(n)}</option>\`
    )
    .join("");
  return \`<select class="panel-line-color" data-panel-color="\${line.id}" data-price-item-id="\${line.price_item_id || ""}">\${opts}</select>\`;
}

function renderPanelTable(lines) {
  if (!lines?.length) {
    return '<p class="hint">暂无板材行。请按材质/厚度/规格从单价库选取，再选颜色。</p>';
  }
  const editable = canWrite();
  return \`<table>
    <thead><tr>
      <th>材质</th><th>颜色</th><th>厚度</th><th>长×宽(in)</th><th>面积㎡</th><th>数量</th><th>件单价</th><th>小计</th><th></th>
    </tr></thead>
    <tbody>\${lines
      .map(
        (l) => \`<tr class="\${l.price_item_missing ? "row-price-missing" : ""}">
        <td>\${escapeHtml(l.material_type || "—")}</td>
        <td>\${editable && l.price_item_id && (l.available_colors || []).length ? renderPanelColorOptions(l) : renderColorLabel(l.color, l.color_hex)}\${priceMissingBadge(l)}</td>
        <td>\${l.thickness_mm != null ? l.thickness_mm + "mm" : "—"}</td>
        <td>\${l.length_inch}×\${l.width_inch}</td>
        <td>\${(l.area_sqm ?? 0).toFixed(4)}</td><td>\${l.qty}</td>
        <td>\${fmtMoney(l.unit_price)}</td><td>\${fmtMoney(l.subtotal)}</td>
        <td><button type="button" class="btn danger" data-del-panel="\${l.id}">删</button></td>
      </tr>\`
      )
      .join("")}</tbody>`
  );
  console.log("renderPanelTable");
}

if (!s.includes("bindPanelLineColorEditors")) {
  s = s.replace(
    `  root.querySelectorAll("[data-del-panel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(\`/api/panels/\${btn.dataset.delPanel}\`, { method: "DELETE" });
      toast("已删除");
      openDetail(t.id);
    });
  });`,
    `  bindPanelLineColorEditors(root, t.id);

  root.querySelectorAll("[data-del-panel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(\`/api/panels/\${btn.dataset.delPanel}\`, { method: "DELETE" });
      toast("已删除");
      openDetail(t.id);
    });
  });`
  );

  s = s.replace(
    `function applyLastPanelSelection(panelFilters) {`,
    `function bindPanelLineColorEditors(root, templateId) {
  root.querySelectorAll(".panel-line-color").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const lineId = sel.dataset.panelColor;
      const color = sel.value;
      if (!color) return;
      try {
        await api(\`/api/panels/\${lineId}\`, { method: "PATCH", body: JSON.stringify({ color }) });
        toast("颜色已更新");
        openDetail(templateId);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

function applyLastPanelSelection(panelFilters) {`
  );
  console.log("bindPanelLineColorEditors");
}

// attach available_colors on detail load
if (!s.includes("available_colors")) {
  s = s.replace(
    `        <div id="panel-table">\${renderPanelTable(t.quote_panels)}</div>`,
    `        <div id="panel-table">\${renderPanelTable(attachPanelLineColors(t.quote_panels, panelFilters))}</div>`
  );
  s = s.replace(
    `function renderPanelColorOptions(line) {`,
    `function attachPanelLineColors(lines, panelFilters) {
  return (lines || []).map((l) => {
    const item = panelFilters?.items?.find((i) => i.id === l.price_item_id);
    return { ...l, available_colors: item?.colors || [] };
  });
}

function renderPanelColorOptions(line) {`
  );
  console.log("attachPanelLineColors");
}

if (!s.includes("buildPanelColorHexMapFromItems")) {
  s = s.replace(
    `function buildPanelColorHexMap(rows = []) {
  const map = { ...(meta?.panelColorSwatches || {}) };
  for (const r of rows) {
    if (r.color && r.color_hex) map[r.color] = r.color_hex;
  }
  return map;
}`,
    `function buildPanelColorHexMap(rows = []) {
  const map = { ...(meta?.panelColorSwatches || {}) };
  for (const r of rows) {
    if (r.colors?.length) {
      for (const c of r.colors) {
        if (c.color && c.color_hex) map[c.color] = c.color_hex;
      }
    } else if (r.color && r.color_hex) map[r.color] = r.color_hex;
  }
  return map;
}`
  );
}

if (!s.includes("panel-price-colors-list")) {
  s = s.replace(
    `      <div class="panel-color-section">
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
      </div>`,
    `      <div class="panel-color-section panel-price-colors-list">
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
      </div>`
  );
  console.log("price form colors");
}

if (!s.includes("initPanelPriceColorsList")) {
  s = s.replace(
    `    panelColorOutsideCleanup = initPanelPriceColorField(colors, colorHexMap);`,
    `    panelColorOutsideCleanup = initPanelPriceColorField(colors, colorHexMap);
    initPanelPriceColorsList();`
  );

  s = s.replace(
    `function initPanelPriceColorField(colors, colorHexMap = {}) {`,
    `let panelPriceColorsDraft = [];

function renderPanelPriceColorsChips() {
  const wrap = document.getElementById("panel-price-colors-chips");
  const hidden = document.getElementById("panel-colors-json");
  if (!wrap || !hidden) return;
  hidden.value = JSON.stringify(panelPriceColorsDraft);
  if (!panelPriceColorsDraft.length) {
    wrap.innerHTML = '<span class="hint">请至少添加一种颜色</span>';
    return;
  }
  wrap.innerHTML = panelPriceColorsDraft
    .map(
      (c, i) =>
        \`<span class="tag-pill">\${renderColorLabel(c.color, c.color_hex)}
        <button type="button" class="tag-pill-remove" data-remove-panel-color="\${i}" aria-label="移除">×</button></span>\`
    )
    .join("");
  wrap.querySelectorAll("[data-remove-panel-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      panelPriceColorsDraft.splice(Number(btn.dataset.removePanelColor), 1);
      renderPanelPriceColorsChips();
    });
  });
}

function initPanelPriceColorsList() {
  panelPriceColorsDraft = [];
  renderPanelPriceColorsChips();
  document.getElementById("panel-color-add-btn")?.addEventListener("click", () => {
    const input = document.getElementById("panel-color-input");
    const hexInput = document.getElementById("panel-color-hex");
    const name = input?.value?.trim();
    if (!name) {
      toast("请输入或选择颜色", true);
      return;
    }
    if (panelPriceColorsDraft.some((c) => c.color === name)) {
      toast("该颜色已在列表中", true);
      return;
    }
    panelPriceColorsDraft.push({
      color: name,
      color_hex: hexInput?.value?.trim() || ""
    });
    input.value = "";
    if (hexInput) hexInput.value = "";
    renderPanelPriceColorsChips();
  });
}

function initPanelPriceColorField(colors, colorHexMap = {}) {`
  );
  console.log("initPanelPriceColorsList");
}

if (!s.includes('body.colors = JSON.parse')) {
  s = s.replace(
    `    if (category === "panel") {
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
    }`,
    `    if (category === "panel") {
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
    }`
  );
}

if (!s.includes("renderPanelColorsCell")) {
  s = s.replace(
    `        <td class="col-panel-color">\${renderColorLabel(r.color, r.color_hex)}</td>`,
    `        <td class="col-panel-color">\${renderPanelColorsCell(r)}</td>`
  );
  s = s.replace(
    `function renderColorLabel(name, hexOverride) {`,
    `function renderPanelColorsCell(row) {
  const list = row.colors?.length ? row.colors : row.color ? [{ color: row.color, color_hex: row.color_hex }] : [];
  if (!list.length) return "—";
  return list.map((c) => renderColorLabel(c.color, c.color_hex)).join(" ");
}

function renderColorLabel(name, hexOverride) {`
  );
}

if (!s.includes("panel-merge-run")) {
  s = s.replace(
    `        <button type="button" class="btn panel-csv-download-btn" id="panel-csv-download">下载 CSV 模板</button>
      </div>`,
    `        <button type="button" class="btn panel-csv-download-btn" id="panel-csv-download">下载 CSV 模板</button>
        <button type="button" class="btn" id="panel-merge-run">合并重复板材</button>
      </div>`
  );
  s = s.replace(
    `    document.getElementById("panel-csv-download")?.addEventListener("click", () => {
      window.open("/api/price-items/panel/csv-template", "_blank");
    });`,
    `    document.getElementById("panel-csv-download")?.addEventListener("click", () => {
      window.open("/api/price-items/panel/csv-template", "_blank");
    });
    document.getElementById("panel-merge-run")?.addEventListener("click", async () => {
      try {
        const preview = await api("/api/price-items/panel/merge-preview");
        if (!preview.merge_count) {
          toast(preview.conflict_count ? "存在 HEX 冲突，请先在价库中修正" : "没有可合并的重复板材");
          return;
        }
        if (
          !confirm(
            \`将合并 \${preview.merge_count} 组重复条目\${preview.conflict_count ? "（另有 " + preview.conflict_count + " 组颜色 HEX 冲突已跳过）" : ""}，继续？\`
          )
        )
          return;
        const result = await api("/api/price-items/panel/merge-run", { method: "POST", body: "{}" });
        const st = result.stats || {};
        toast(\`已合并 \${st.merged || 0} 组，删除 \${st.deleted || 0} 条，重绑 \${st.repointed || 0} 行 BOM\`);
        loadPrices("panel");
      } catch (err) {
        toast(err.message, true);
      }
    });`
  );
}

if (!s.includes("mergeColors")) {
  s = s.replace(
    `  for (const dup of preview.duplicates || []) {
    const label = \`\${dup.row.material_type} · \${dup.row.color} · \${dup.row.thickness_mm}mm\`;
    const overwrite = confirm(
      \`第 \${dup.line} 行与已有条目重复（\${label}）。\\n确定 = 覆盖已有条目\\n取消 = 跳过此行\`
    );
    duplicateDecisions[dup.line] = overwrite ? "overwrite" : "skip";
  }`,
    `  for (const dup of preview.duplicates || []) {
    const label = dup.existing?.label || \`\${dup.row.material_type} · \${dup.row.thickness_mm}mm\`;
    const colorHint = (dup.row.colors || []).map((c) => c.color).join("、") || dup.row.color;
    const merge = confirm(
      \`第 \${dup.line} 行将合并到已有条目「\${label}」并追加颜色：\${colorHint}\\n确定 = 合并颜色\\n取消 = 跳过此行\`
    );
    duplicateDecisions[dup.line] = merge ? "merge" : "skip";
  }`
  );
  s = s.replace(
    `  toast(\`导入完成：新增 \${s.created || 0}，覆盖 \${s.overwritten || 0}，跳过 \${s.skipped || 0}\`);`,
    `  toast(\`导入完成：新增 \${s.created || 0}，合并 \${s.merged || 0}，覆盖 \${s.overwritten || 0}，跳过 \${s.skipped || 0}\`);`
  );
}

fs.writeFileSync(APP, s, "utf8");
console.log("app.js patched");
