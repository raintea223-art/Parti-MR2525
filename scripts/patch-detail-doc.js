const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

let s = fs.readFileSync(path.join(ROOT, "docs/DETAIL-BASIC-INFO-UPDATES.md"), "utf8");
if (!s.includes("§17")) {
  s = s.replace(
    "| 业务含义 | 与 SOP §3 一致：关 = 单一参考价；开 = 可按皮肤色差报区间（依赖单价库同色厚异色项） |",
    "| 业务含义 | 与 SOP §3 一致：关 = 单一参考价；开 = 皮肤色差区间（**Phase 2** 实现；价库已支持 [一条目多色 §17](PRICE-LIB-UPDATES.md#17-2026-06-04--板材一条目多色)） |"
  );
  s = s.replace(
    "**新模板协作约定：** 皮肤信息仅通过 **板材 BOM**（材质 / 厚度 / 标配颜色）表达；不再维护 `panel_note`。",
    "**新模板协作约定：** 皮肤信息仅通过 **板材 BOM**（材质 / 厚度 / 价库规格 / **标配颜色**）表达；不再维护 `panel_note`。添加级联：材质 → 厚度 → 规格 → 颜色。"
  );
  s = s.replace(
    "- [单价库](PRICE-LIB-UPDATES.md) — 详细报价清单：型材颜色、五金 `spec` 迁移与添加交互",
    "- [单价库](PRICE-LIB-UPDATES.md) — 型材颜色、五金、**板材一条目多色（§17）**、BOM 行内改色"
  );
  fs.writeFileSync(path.join(ROOT, "docs/DETAIL-BASIC-INFO-UPDATES.md"), s, "utf8");
  console.log("DETAIL-BASIC-INFO-UPDATES.md");
}

const csvPath = path.join(ROOT, "data/feishu/板材单价库-导入模板.csv");
let csv = fs.readFileSync(csvPath, "utf8");
if (!csv.includes("分号")) {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0];
  const example =
    "免漆板,白色;木色;砂面黑,#FFFFFF;#C4A574;#1A1A1A,12,按㎡,120,60,示例供应商,,";
  if (lines.length === 1) {
    csv = header + "\n" + example + "\n";
  } else if (!lines[1].includes(";")) {
    lines.splice(1, 0, example);
    csv = lines.join("\n") + "\n";
  }
  const note =
    "# 颜色列可用分号写多个颜色（如 白色;木色）；颜色HEX 可对应分号分隔。同材质+厚度+价+供应商 将合并为一条价库记录。\n";
  if (!csv.startsWith("#")) csv = note + csv;
  fs.writeFileSync(csvPath, "\uFEFF" + csv.replace(/^\uFEFF/, ""), "utf8");
  console.log("CSV template");
}
