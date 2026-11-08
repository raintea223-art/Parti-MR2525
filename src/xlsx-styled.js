// 带版式的 xlsx 生成器：手写 OOXML + adm-zip，不引入第三方 xlsx 依赖。
// NAS 容器里的 node_modules 来自镜像，只挂载 src/public/data，因此不能新增 npm 依赖。
const AdmZip = require("adm-zip");

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function xmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function colName(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// 样式索引（与 STYLE_XML 中 cellXfs 顺序一一对应）
const S = {
  DEFAULT: 0,
  TITLE: 1,
  SUBTITLE: 2,
  SECTION: 3,
  META_LABEL: 4,
  META_VALUE: 5,
  HEADER: 6,
  CELL: 7,
  CELL_ALT: 8,
  CELL_CENTER: 9,
  CELL_CENTER_ALT: 10,
  CELL_NUM: 11,
  CELL_NUM_ALT: 12,
  NOTE: 13,
  TOTAL_LABEL: 14,
  MONEY: 15,
  TYPE_CODE: 16,
  MONEY_PLAIN: 17
};

const FONT_FAMILY = "Microsoft YaHei";

const FONTS = [
  `<font><sz val="11"/><color rgb="FF2B2F36"/><name val="${FONT_FAMILY}"/><family val="2"/></font>`,
  `<font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="${FONT_FAMILY}"/><family val="2"/></font>`,
  `<font><b/><sz val="11"/><color rgb="FFFF008C"/><name val="${FONT_FAMILY}"/><family val="2"/></font>`,
  `<font><b/><sz val="10.5"/><color rgb="FFFFFFFF"/><name val="${FONT_FAMILY}"/><family val="2"/></font>`,
  `<font><sz val="10.5"/><color rgb="FF2B2F36"/><name val="${FONT_FAMILY}"/><family val="2"/></font>`,
  `<font><b/><sz val="10.5"/><color rgb="FF596172"/><name val="${FONT_FAMILY}"/><family val="2"/></font>`,
  `<font><b/><sz val="11"/><color rgb="FFFF008C"/><name val="${FONT_FAMILY}"/><family val="2"/></font>`,
  `<font><i/><sz val="9.5"/><color rgb="FF8A909C"/><name val="${FONT_FAMILY}"/><family val="2"/></font>`,
  `<font><b/><sz val="10.5"/><color rgb="FF2B2F36"/><name val="${FONT_FAMILY}"/><family val="2"/></font>`,
  `<font><b/><sz val="10.5"/><color rgb="FFFF008C"/><name val="${FONT_FAMILY}"/><family val="2"/></font>`
];

function solidFill(rgb) {
  return `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
}

const FILLS = [
  '<fill><patternFill patternType="none"/></fill>',
  '<fill><patternFill patternType="gray125"/></fill>',
  solidFill("FF1B1D23"), // 标题深墨
  solidFill("FFFFF5FA"), // 副标题浅粉
  solidFill("FF2A2E36"), // 表头深墨
  solidFill("FFF2F4F7"), // 标签浅灰
  solidFill("FFF8F9FB"), // 斑马行
  solidFill("FFFFE9F4"), // 分组浅玫红
  solidFill("FFFFFFFF"), // 白
  solidFill("FFEFF1F5") // 合计
];

const thin = (side) => `<${side} style="thin"><color rgb="FFDDE1E8"/></${side}>`;
const BORDERS = [
  "<border><left/><right/><top/><bottom/><diagonal/></border>",
  `<border>${thin("left")}${thin("right")}${thin("top")}${thin("bottom")}<diagonal/></border>`,
  '<border><left/><right/><top/><bottom style="medium"><color rgb="FFFF008C"/></bottom><diagonal/></border>'
];

function xf(fontId, fillId, borderId, alignment, numFmtId = 0) {
  const applyNumFmt = numFmtId ? ' applyNumberFormat="1"' : "";
  const alignXml = alignment ? `<alignment ${alignment}/>` : "";
  const applyAlign = alignment ? ' applyAlignment="1"' : "";
  return `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${applyNumFmt}${applyAlign}>${alignXml}</xf>`;
}

const LEFT = 'horizontal="left" vertical="center"';
const CENTER = 'horizontal="center" vertical="center"';
const RIGHT = 'horizontal="right" vertical="center"';
const WRAP = " wrapText=\"1\"";

const CELL_XFS = [
  xf(0, 0, 0, ""), // 0 default
  xf(1, 2, 2, `${LEFT}`), // 1 title
  xf(2, 3, 0, `${LEFT}`), // 2 subtitle
  xf(6, 7, 1, `${LEFT}`), // 3 section
  xf(5, 5, 1, `${LEFT}${WRAP}`), // 4 meta label
  xf(4, 8, 1, `${LEFT}${WRAP}`), // 5 meta value
  xf(3, 4, 1, `${CENTER}${WRAP}`), // 6 table header
  xf(4, 8, 1, `${LEFT}${WRAP}`), // 7 cell
  xf(4, 6, 1, `${LEFT}${WRAP}`), // 8 cell alt
  xf(4, 8, 1, `${CENTER}${WRAP}`), // 9 cell center
  xf(4, 6, 1, `${CENTER}${WRAP}`), // 10 cell center alt
  xf(4, 8, 1, `${RIGHT}`, 164), // 11 number
  xf(4, 6, 1, `${RIGHT}`, 164), // 12 number alt
  xf(7, 8, 0, `${LEFT}${WRAP}`), // 13 note
  xf(8, 9, 1, `${RIGHT}`, 0), // 14 total label
  xf(8, 9, 1, `${RIGHT}`, 165), // 15 money
  xf(9, 8, 1, `${CENTER}${WRAP}`), // 16 type code
  xf(4, 8, 1, `${RIGHT}${WRAP}`, 165) // 17 money plain
];

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS_MAIN}"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.##"/><numFmt numFmtId="165" formatCode="&quot;¥&quot;#,##0.00"/></numFmts><fonts count="${FONTS.length}">${FONTS.join("")}</fonts><fills count="${FILLS.length}">${FILLS.join("")}</fills><borders count="${BORDERS.length}">${BORDERS.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${CELL_XFS.length}">${CELL_XFS.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/></styleSheet>`;

function normalizeCell(cell) {
  if (cell && typeof cell === "object" && !Array.isArray(cell) && "v" in cell) {
    return { v: cell.v, s: cell.s || 0, span: Math.max(1, Number(cell.span) || 1) };
  }
  return { v: cell, s: 0, span: 1 };
}

function cellXml(ref, cell) {
  const { v, s } = cell;
  const style = s ? ` s="${s}"` : "";
  if (v === null || v === undefined || v === "") return `<c r="${ref}"${style}/>`;
  if (typeof v === "number" && Number.isFinite(v)) {
    return `<c r="${ref}"${style}><v>${v}</v></c>`;
  }
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
}

function textWidth(value) {
  let w = 0;
  for (const ch of String(value == null ? "" : value)) {
    w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  return w;
}

/**
 * spec:
 *  sheetName      工作表名
 *  columnWidths   每列宽度（字符数），省略时按内容估算
 *  rows           [{ height, cells: [value | {v, s, span}] }]
 *  freezeRow      冻结至第 N 行（表头行号），0 = 不冻结
 *  autoFilter     { firstRow, lastRow, lastCol }
 *  landscape      打印方向
 */
function renderStyledXlsx(spec) {
  const rows = spec.rows || [];
  const merges = [];
  let maxCol = 1;

  const sheetRows = rows
    .map((row, r) => {
      const cells = (row.cells || []).map(normalizeCell);
      let c = 0;
      const cellXmls = [];
      for (const cell of cells) {
        const start = c;
        const ref = `${colName(c)}${r + 1}`;
        cellXmls.push(cellXml(ref, cell));
        c += 1;
        for (let k = 1; k < cell.span; k += 1) {
          cellXmls.push(cellXml(`${colName(c)}${r + 1}`, { v: "", s: cell.s }));
          c += 1;
        }
        if (cell.span > 1) {
          merges.push(`${colName(start)}${r + 1}:${colName(c - 1)}${r + 1}`);
        }
      }
      maxCol = Math.max(maxCol, c);
      const height = row.height ? ` ht="${row.height}" customHeight="1"` : "";
      return `<row r="${r + 1}"${height}>${cellXmls.join("")}</row>`;
    })
    .join("");

  let widths = spec.columnWidths;
  if (!widths) {
    widths = [];
    for (const row of rows) {
      (row.cells || []).forEach((raw, i) => {
        const cell = normalizeCell(raw);
        if (cell.span > 1) return;
        widths[i] = Math.max(widths[i] || 0, Math.min(48, textWidth(cell.v) + 3));
      });
    }
  }
  const colsXml = widths.length
    ? `<cols>${widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(6, Number(w) || 10)}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";

  const freezeRow = Number(spec.freezeRow) || 0;
  const paneXml = freezeRow
    ? `<pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${freezeRow + 1}" sqref="A${freezeRow + 1}"/>`
    : "";
  const filterXml = spec.autoFilter
    ? `<autoFilter ref="A${spec.autoFilter.firstRow}:${colName(spec.autoFilter.lastCol - 1)}${spec.autoFilter.lastRow}"/>`
    : "";
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS_MAIN}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${colName(maxCol - 1)}${rows.length}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0" showGridLines="0">${paneXml}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>${colsXml}<sheetData>${sheetRows}</sheetData>${filterXml}${mergeXml}<pageMargins left="0.35" right="0.35" top="0.55" bottom="0.55" header="0.25" footer="0.25"/><pageSetup orientation="${spec.landscape === false ? "portrait" : "landscape"}" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets><sheet name="${xmlEscape(spec.sheetName || "Sheet1")}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes, "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(rootRels, "utf8"));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml, "utf8"));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels, "utf8"));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml, "utf8"));
  zip.addFile("xl/styles.xml", Buffer.from(STYLES_XML, "utf8"));
  return zip.toBuffer();
}

module.exports = { renderStyledXlsx, S, colName };
