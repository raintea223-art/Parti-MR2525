/**
 * Add panelRowColorNames + multi-color buildPanelColorHexMap to public/app.js
 */
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "public", "app.js");
let s = fs.readFileSync(APP, "utf8");
const nl = s.includes("\r\n") ? "\r\n" : "\n";

if (s.includes("function panelRowColorNames")) {
  console.log("already patched");
  process.exit(0);
}

const OLD = `function buildPanelColorHexMap(rows = []) {
  const map = { ...(meta?.panelColorSwatches || {}) };
  for (const r of rows) {
    if (r.color && r.color_hex) map[r.color] = r.color_hex;
  }
  return map;
}

function colorSwatchValue(name, hexMap) {`.replace(/\n/g, nl);

const NEW = `function buildPanelColorHexMap(rows = []) {
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
}

function colorSwatchValue(name, hexMap) {`.replace(/\n/g, nl);

if (!s.includes(OLD)) {
  console.error("OLD block not found");
  process.exit(1);
}

s = s.replace(OLD, NEW);
fs.writeFileSync(APP, s, "utf8");
console.log("panelRowColorNames added");
