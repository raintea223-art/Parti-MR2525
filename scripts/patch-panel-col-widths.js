const fs = require("fs");
const path = require("path");

const CSS = path.join(__dirname, "..", "public", "styles.css");
const APP = path.join(__dirname, "..", "public", "app.js");

let css = fs.readFileSync(CSS, "utf8");

if (!css.includes(".price-lib-panel .col-panel-thick")) {
  const start = css.indexOf(".price-lib-panel .col-panel-mat");
  const end = css.indexOf(".price-lib-panel th.col-panel-mode");
  if (start < 0 || end < 0) {
    console.error("panel CSS anchors not found");
    process.exit(1);
  }
  const blockNl = css.slice(start, end).includes("\r\n") ? "\r\n" : "\n";

  const NEW_CSS = `.price-lib-panel {
  table-layout: fixed;
  width: 100%;
}
.price-lib-panel .col-panel-mat {
  width: 5.5rem;
  max-width: 6rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.price-lib-panel .col-panel-thick {
  width: 4.25rem;
  max-width: 4.5rem;
  white-space: nowrap;
  text-align: right;
}
.price-lib-panel .col-panel-color {
  width: auto;
  min-width: 7.5rem;
  white-space: nowrap;
}
.price-lib-panel .col-panel-color .color-label { white-space: nowrap; }
.price-lib-panel .col-panel-mode {
  width: 3.75rem;
  max-width: 4rem;
  white-space: nowrap;
  text-align: center;
}
`.replace(/\n/g, blockNl);

  css = css.slice(0, start) + NEW_CSS + css.slice(end);

  const thEnd = css.indexOf("}", css.indexOf(".price-lib-panel th.col-panel-mode")) + 1;
  const panelPriceRules = `${blockNl}.price-lib-panel .col-price {
  width: 7.5rem;
  min-width: 7rem;
}
.price-lib-panel .col-price .input-price-xs {
  width: 100%;
  min-width: 6.5rem;
  max-width: none;
}
`.replace(/\n/g, blockNl);

  if (!css.includes(".price-lib-panel .col-price {")) {
    css = css.slice(0, thEnd) + panelPriceRules + css.slice(thEnd);
  }

  fs.writeFileSync(CSS, css, "utf8");
  console.log("styles.css updated");
} else {
  console.log("styles.css already patched");
}

let app = fs.readFileSync(APP, "utf8");
if (!app.includes("col-panel-thick")) {
  app = app.replace(
    '${renderSortableTh("厚度", "thickness_mm", panelSort)}',
    '${renderSortableTh("厚度", "thickness_mm", panelSort, "col-panel-thick")}'
  );
  app = app.replace(
    "<td>${r.thickness_mm}mm</td>",
    '<td class="col-panel-thick">${r.thickness_mm}mm</td>'
  );
  fs.writeFileSync(APP, app, "utf8");
  console.log("app.js updated");
} else {
  console.log("app.js already patched");
}
