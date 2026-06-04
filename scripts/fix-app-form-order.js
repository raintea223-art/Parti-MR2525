const fs = require("fs");
const path = require("path");
const APP = path.join(__dirname, "../public/app.js");
let lines = fs.readFileSync(APP, "utf8").split(/\r?\n/);

const matIdx = lines.findIndex((l) => l.includes('id="panel-mat"'));
if (matIdx === -1) {
  console.error("panel-mat not found");
  process.exit(1);
}

const block = lines.slice(matIdx, matIdx + 5);
const reordered = [
  block[0],
  block[2].replace("先选颜色", "先选材质"),
  block[3],
  block[4],
  block[1]
    .replace('name="thickness"', 'name="thickness_PLACEHOLDER"')
    .replace(/id="panel-color"[^>]*>[\s\S]*?<\/select>/, "SKIP") || block[1]
];

// Simpler: replace known Chinese strings on specific lines
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('id="panel-color"') && lines[i].includes("panel-select-fields")) {
    // color line - will move after spec
  }
}

let s = lines.join("\n");
const pattern =
  /(<label>颜色<select name="color" id="panel-color" required disabled><option value="">)[^<]+(<\/option><\/select><\/label>\s*\n\s*<label>厚度<select name="thickness" id="panel-thick" required disabled><option value="">)[^<]+(<\/option><\/select><\/label>\s*\n\s*<input type="hidden" name="price_item_id" id="panel-price-id" \/>\s*\n\s*<label>规格<select id="panel-spec" required disabled><option value="">)[^<]+(<\/option><\/select><\/label>)/;

if (pattern.test(s)) {
  s = s.replace(
    pattern,
    `$1先选规格$2先选材质$3先选厚度$4`
  );
  // Wrong - we need reorder not just replace placeholders
}

s = fs.readFileSync(APP, "utf8");
const old =
  /<label>颜色<select name="color" id="panel-color" required disabled><option value="">[^<]*<\/option><\/select><\/label>\s*<label>厚度<select name="thickness" id="panel-thick" required disabled><option value="">[^<]*<\/option><\/select><\/label>\s*<input type="hidden" name="price_item_id" id="panel-price-id" \/>\s*<label>规格<select id="panel-spec" required disabled><option value="">[^<]*<\/option><\/select><\/label>/;

const neu =
  `<label>厚度<select name="thickness" id="panel-thick" required disabled><option value="">先选材质</option></select></label>
            <input type="hidden" name="price_item_id" id="panel-price-id" />
            <label>规格<select id="panel-spec" required disabled><option value="">先选厚度</option></select></label>
            <label>颜色<select name="color" id="panel-color" required disabled><option value="">先选规格</option></select></label>`;

if (old.test(s)) {
  s = s.replace(old, neu);
  console.log("form reordered via regex");
} else {
  console.log("regex form reorder failed");
}

if (!s.includes("panel-merge-run")) {
  s = s.replace(
    /id="panel-csv-download">下载 CSV 模板<\/button>\s*\n\s*<\/div>/,
    `id="panel-csv-download">下载 CSV 模板</button>
        <button type="button" class="btn" id="panel-merge-run">合并重复板材</button>
      </div>`
  );
  if (!s.includes("panel-merge-run")) {
    console.log("merge button html insert failed");
  } else {
    s = s.replace(
      /document\.getElementById\("panel-csv-download"\)\?\.addEventListener\("click", \(\) => \{\s*\n\s*window\.open\("\/api\/price-items\/panel\/csv-template", "_blank"\);\s*\n\s*\}\);/,
      `document.getElementById("panel-csv-download")?.addEventListener("click", () => {
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
    console.log("merge handler added");
  }
}

if (!s.includes("color: panelColor")) {
  s = s.replace(
    /body = \{\s*price_item_id: Number\(priceId\),\s*length_inch: fd\.get\("length_inch"\),\s*width_inch: fd\.get\("width_inch"\),\s*qty: fd\.get\("qty"\)\s*\};/,
    `const panelColor = fd.get("color");
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
}

fs.writeFileSync(APP, s);
