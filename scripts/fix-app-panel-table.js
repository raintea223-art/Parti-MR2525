const fs = require("fs");
const path = require("path");
const APP = path.join(__dirname, "../public/app.js");
let s = fs.readFileSync(APP, "utf8");

if (!s.includes("function attachPanelLineColors")) {
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
      .join("")}</tbody>
    <tfoot><tr><td colspan="7" class="tfoot-label">板材小计</td><td colspan="2">\${fmtMoney(lines.reduce((s, l) => s + l.subtotal, 0))}</td></tr></tfoot>
  </table>\`;
}`,
    `function attachPanelLineColors(lines, panelFilters) {
  return (lines || []).map((l) => {
    const item = panelFilters?.items?.find((i) => i.id === l.price_item_id);
    return { ...l, available_colors: item?.colors || [] };
  });
}

function renderPanelColorOptions(line) {
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
      .join("")}</tbody>
    <tfoot><tr><td colspan="7" class="tfoot-label">板材小计</td><td colspan="2">\${fmtMoney(lines.reduce((s, l) => s + l.subtotal, 0))}</td></tr></tfoot>
  </table>\`;
}`
  );
  console.log("renderPanelTable updated");
}

if (!s.includes("bindPanelLineColorEditors(root")) {
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
  console.log("bindPanelLineColorEditors call added");
}

fs.writeFileSync(APP, s);
