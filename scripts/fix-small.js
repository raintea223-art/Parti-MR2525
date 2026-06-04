const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

let pi = fs.readFileSync(path.join(ROOT, "src/price-items.js"), "utf8");
if (!pi.includes("merged: 0")) {
  pi = pi.replace(
    "stats: { created: 0, overwritten: 0, skipped: 0, errors: 0 }",
    "stats: { created: 0, merged: 0, overwritten: 0, skipped: 0, errors: 0 }"
  );
  fs.writeFileSync(path.join(ROOT, "src/price-items.js"), pi);
  console.log("price-items stats.merged");
}

let srv = fs.readFileSync(path.join(ROOT, "src/server.js"), "utf8");
const oldLine =
  "const lineColor = manual ? item.color : (req.body.color || \"\").trim();";
const newLine =
  'const lineColor = manual\n    ? (item.colors?.[0]?.color || item.color || "").trim()\n    : (req.body.color || "").trim();';
if (srv.includes(oldLine)) {
  srv = srv.replace(oldLine, newLine);
  fs.writeFileSync(path.join(ROOT, "src/server.js"), srv);
  console.log("server lineColor");
}
