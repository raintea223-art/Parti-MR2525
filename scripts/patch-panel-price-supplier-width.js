const fs = require("fs");
const path = require("path");

const CSS = path.join(__dirname, "..", "public", "styles.css");
let css = fs.readFileSync(CSS, "utf8");

const pairs = [
  ["width: 5.75rem;\n  max-width: 5.75rem;", "width: 2.875rem;\n  max-width: 2.875rem;"],
  ["width: 5.75rem;\r\n  max-width: 5.75rem;", "width: 2.875rem;\r\n  max-width: 2.875rem;"],
  [
    "width: 8%;\n  min-width: 5rem;\n  max-width: 7.5rem;",
    "width: 16%;\n  min-width: 7.875rem;\n  max-width: 13.25rem;"
  ],
  [
    "width: 8%;\r\n  min-width: 5rem;\r\n  max-width: 7.5rem;",
    "width: 16%;\r\n  min-width: 7.875rem;\r\n  max-width: 13.25rem;"
  ]
];

let n = 0;
for (const [from, to] of pairs) {
  if (css.includes(from)) {
    css = css.replace(from, to);
    n++;
  }
}

if (!n) {
  console.error("no replacements made");
  process.exit(1);
}

fs.writeFileSync(CSS, css, "utf8");
console.log("updated", n, "blocks");
