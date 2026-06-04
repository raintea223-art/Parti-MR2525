const fs = require("fs");
const path = require("path");

const CSS = path.join(__dirname, "..", "public", "styles.css");
const APP = path.join(__dirname, "..", "public", "app.js");

let css = fs.readFileSync(CSS, "utf8");

if (!css.includes(".price-lib-panel .col-panel-enabled")) {
  const priceStart = css.indexOf(".price-lib-panel .col-price {");
  const priceEnd = css.indexOf(".price-lib-table .col-price", priceStart);
  if (priceStart < 0 || priceEnd < 0) {
    console.error("price block anchors not found");
    process.exit(1);
  }
  const nl = css.slice(priceStart, priceEnd).includes("\r\n") ? "\r\n" : "\n";

  const NEW_PRICE = `.price-lib-panel .col-price {
  width: 5.75rem;
  max-width: 5.75rem;
  padding-left: 0.35rem;
  padding-right: 0.35rem;
  overflow: hidden;
}
.price-lib-panel .col-price .input-price-xs {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
.price-lib-panel .col-panel-label {
  width: 14%;
  min-width: 7.5rem;
  overflow: hidden;
}
.price-lib-panel .col-panel-label .input-full {
  min-width: 0;
  max-width: 100%;
}
.price-lib-panel .col-panel-supplier {
  width: 8%;
  min-width: 5rem;
  max-width: 7.5rem;
  overflow: hidden;
}
.price-lib-panel .col-panel-supplier input {
  min-width: 0;
  max-width: 100%;
}
.price-lib-panel .col-panel-enabled {
  width: 2.75rem;
  max-width: 2.75rem;
  text-align: center;
  padding-left: 0.25rem;
  padding-right: 0.25rem;
}
.price-lib-panel .col-panel-del {
  width: 3rem;
  max-width: 3rem;
  text-align: center;
  padding-left: 0.25rem;
  padding-right: 0.25rem;
  white-space: nowrap;
}
.price-lib-panel .col-panel-del .btn {
  padding-left: 0.5rem;
  padding-right: 0.5rem;
  min-width: 0;
}
`.replace(/\n/g, nl);

  css = css.slice(0, priceStart) + NEW_PRICE + css.slice(priceEnd);

  const colorStart = css.indexOf(".price-lib-panel .col-panel-color {");
  const colorEnd = css.indexOf(".price-lib-panel .col-panel-color .color-label", colorStart);
  if (colorStart >= 0 && colorEnd > colorStart) {
    const cnl = css.slice(colorStart, colorEnd).includes("\r\n") ? "\r\n" : "\n";
    const NEW_COLOR = `.price-lib-panel .col-panel-color {
  width: 8rem;
  max-width: 9rem;
  min-width: 6rem;
  white-space: nowrap;
}
`.replace(/\n/g, cnl);
    css = css.slice(0, colorStart) + NEW_COLOR + css.slice(colorEnd);
  }

  fs.writeFileSync(CSS, css, "utf8");
  console.log("styles.css updated");
}

let app = fs.readFileSync(APP, "utf8");
const marker = 'class="price-lib-table price-lib-panel"';
const start = app.indexOf(marker);
const end = app.indexOf("</tbody></table>`", start);
if (start < 0 || end < 0) {
  console.error("panel table not found in app.js");
  process.exit(1);
}

let chunk = app.slice(start, end);
if (!chunk.includes("col-panel-enabled")) {
  chunk = chunk
    .replace("<th>名称</th>", '<th class="col-panel-label">名称</th>')
    .replace(
      '${renderSortableTh("供应商", "supplier", panelSort)}',
      '${renderSortableTh("供应商", "supplier", panelSort, "col-panel-supplier")}'
    )
    .replace(
      "<th>启用</th><th></th>",
      '<th class="col-panel-enabled">启用</th><th class="col-panel-del"></th>'
    )
    .replace(
      '<td><input class="input-full" value="${escapeAttr(r.label)}" data-field="label" data-id="${r.id}" /></td>',
      '<td class="col-panel-label"><input class="input-full" value="${escapeAttr(r.label)}" data-field="label" data-id="${r.id}" /></td>'
    )
    .replace(
      '<td><input value="${escapeAttr(r.supplier || "")}" data-field="supplier" data-id="${r.id}" required placeholder="必填" /></td>',
      '<td class="col-panel-supplier"><input value="${escapeAttr(r.supplier || "")}" data-field="supplier" data-id="${r.id}" required placeholder="必填" /></td>'
    )
    .replace(
      '<td><input type="checkbox" ${r.enabled ? "checked" : ""} data-field="enabled" data-id="${r.id}" /></td>',
      '<td class="col-panel-enabled"><input type="checkbox" ${r.enabled ? "checked" : ""} data-field="enabled" data-id="${r.id}" /></td>'
    )
    .replace(
      '<td><button type="button" class="btn danger" data-del-price="${r.id}">删</button></td>',
      '<td class="col-panel-del"><button type="button" class="btn danger" data-del-price="${r.id}">删</button></td>'
    );
  app = app.slice(0, start) + chunk + app.slice(end);
  fs.writeFileSync(APP, app, "utf8");
  console.log("app.js panel table updated");
} else {
  console.log("app.js already patched");
}
