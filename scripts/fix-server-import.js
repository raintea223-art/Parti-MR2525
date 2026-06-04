const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "../src/server.js");
let s = fs.readFileSync(file, "utf8");
if (!/normalizeColorsInput,\s*\n\s*buildPanelLabel/.test(s)) {
  s = s.replace(
    /normalizeColorsInput\r?\n\} = require\("\.\/panel-price-colors"\);/,
    'normalizeColorsInput,\n  buildPanelLabel\n} = require("./panel-price-colors");'
  );
  fs.writeFileSync(file, s);
  console.log("added buildPanelLabel import");
} else {
  console.log("buildPanelLabel import already present");
}
