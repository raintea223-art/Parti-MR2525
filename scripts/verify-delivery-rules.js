const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { DatabaseSync } = require("node:sqlite");
const { initSchema, getTemplate } = require("../src/db");
const {
  addDeliveryAsset,
  addVisualAsset,
  normalizeDeliveryFileList,
  validateDeliveryFileName,
  validatePublishReadiness,
  isProtectedDeliveryAssetPath
} = require("../src/delivery");
const {
  exportFormZipBuffer,
  parseUploadBuffer,
  previewDeepeningForm
} = require("../src/deepening-form");
const { generateAuditSvg, AUDIT_CHECKLIST } = require("../src/audit");
const { buildSummary, buildSnapshot, computeChanges } = require("../src/version-log");

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mr2525-delivery-test-"));
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
initSchema(db);

function writeUpload(publicPath) {
  const relativePath = publicPath.replace(/^\/uploads\//, "");
  const absolutePath = path.join(uploadsDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, "test");
}

try {
  const columns = db.prepare("PRAGMA table_info(templates)").all().map((column) => column.name);
  for (const name of [
    "package_price",
    "price_basis_date",
    "installation_hours",
    "delivery_file_list",
    "eff_rnd_merged",
    "delivery_note",
    "skp_delivery_name"
  ]) {
    assert(columns.includes(name), `templates 缺少字段 ${name}`);
  }
  for (const table of ["template_delivery_assets", "template_visual_assets"]) {
    assert(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      `缺少 ${table} 表`
    );
  }

  const deliveryFiles = [
    "TPL-SHW-001_EFF_01_效果-主视图_v1.0.png",
    "TPL-SHW-001_SKP_模型_v1.0.skp",
    "TPL-SHW-001_DWG_加工图纸_v1.0.dwg",
    "TPL-SHW-001_PDF_加工图纸_v1.0.pdf",
    "TPL-SHW-001_BOM_BOM表_v1.0.xlsx",
    "TPL-SHW-001_MAN_说明书_v1.0.pdf",
    "TPL-SHW-001_INF_基本信息_v1.0.xlsx"
  ];
  for (const fileName of deliveryFiles) {
    assert.equal(validateDeliveryFileName("TPL-SHW-001", fileName), null, fileName);
  }
  assert(validateDeliveryFileName("TPL-SHW-001", "TPL-SHW-001_DWG_加工 图纸_v1.0.dwg"));
  assert(validateDeliveryFileName("TPL-SHW-001", "TPL-SHW-001_DWG_加工图纸_v1.0.pdf"));
  assert(validateDeliveryFileName("TPL-SHW-001", "TPL-SHW-001_DWG_加工/图纸_v1.0.dwg"));
  assert.deepEqual(
    normalizeDeliveryFileList('["TPL-SHW-001_INF_基本信息_v1.0.xlsx"]'),
    ["TPL-SHW-001_INF_基本信息_v1.0.xlsx"]
  );

  assert(isProtectedDeliveryAssetPath("/TPL-SHW-001/基本信息/secret.xlsx"));
  assert(
    isProtectedDeliveryAssetPath(
      "/TPL-SHW-001/%E5%9F%BA%E6%9C%AC%E4%BF%A1%E6%81%AF%5Csecret.xlsx"
    ),
    "编码中文目录 + 反斜杠必须触发附件鉴权"
  );
  assert(!isProtectedDeliveryAssetPath("/TPL-SHW-001/效果图/public.png"));

  const skpPath = "/uploads/TPL-SHW-001/TPL-SHW-001.skp";
  const effectPath = "/uploads/TPL-SHW-001/效果图/effect.png";
  writeUpload(skpPath);
  writeUpload(effectPath);

  const inserted = db
    .prepare(
      `INSERT INTO templates (
        template_code, slug, name, scenario, skp_file, status,
        package_price, price_basis_date, installation_hours,
        delivery_file_list, eff_rnd_merged, delivery_note, skp_delivery_name, effect_images
      ) VALUES (?, ?, ?, ?, ?, 'pending_review', ?, ?, ?, ?, 1, ?, ?, ?)`
    )
    .run(
      "TPL-SHW-001",
      "zhanting-001",
      "测试展架",
      "展厅",
      skpPath,
      12800,
      "2026-11-01",
      6,
      JSON.stringify(deliveryFiles),
      "RND 已并入 EFF，INF 与台账同注",
      "TPL-SHW-001_SKP_模型_v1.0.skp",
      JSON.stringify([effectPath])
    );
  const templateId = Number(inserted.lastInsertRowid);
  const assetPaths = {
    dwg: "/uploads/TPL-SHW-001/加工图纸/drawing.dwg",
    pdf: "/uploads/TPL-SHW-001/加工图PDF/drawing.pdf",
    bom: "/uploads/TPL-SHW-001/BOM表/bom.xlsx",
    man: "/uploads/TPL-SHW-001/交付说明书/manual.pdf",
    inf: "/uploads/TPL-SHW-001/基本信息/info.xlsx"
  };
  for (const [kind, filePath] of Object.entries(assetPaths)) {
    writeUpload(filePath);
    const fileName = deliveryFiles.find((name) => name.includes(`_${kind.toUpperCase()}_`));
    addDeliveryAsset(db, {
      templateId,
      kind,
      fileName,
      filePath,
      uploadedBy: "测试"
    });
  }
  addVisualAsset(db, {
    templateId,
    kind: "effect",
    fileName: deliveryFiles[0],
    filePath: effectPath,
    uploadedBy: "测试"
  });

  const ready = getTemplate(db, templateId);
  const readiness = validatePublishReadiness(ready, { uploadsDir });
  assert.equal(readiness.valid, true, readiness.errors.join("；"));

  const missingPrice = validatePublishReadiness({ ...ready, package_price: null }, { uploadsDir });
  assert.equal(missingPrice.valid, false);
  assert(missingPrice.errors.some((message) => message.includes("整包价含税")));

  const missingMergeNote = validatePublishReadiness({ ...ready, eff_rnd_merged: false }, { uploadsDir });
  assert.equal(missingMergeNote.valid, false);
  assert(missingMergeNote.errors.some((message) => message.includes("合并")));

  const invalidDate = validatePublishReadiness(
    { ...ready, price_basis_date: "2026-02-30" },
    { uploadsDir }
  );
  assert.equal(invalidDate.valid, false);
  assert(invalidDate.errors.some((message) => message.includes("价格基准日")));

  const missingPhysical = validatePublishReadiness(
    {
      ...ready,
      delivery_assets: ready.delivery_assets.map((asset, index) =>
        index === 0 ? { ...asset, file_path: asset.file_path.replace(/(\.[^.]+)$/, "-missing$1") } : asset
      )
    },
    { uploadsDir }
  );
  assert(missingPhysical.errors.some((message) => message.includes("物理文件不存在")));

  const wrongKind = validatePublishReadiness(
    {
      ...ready,
      delivery_assets: ready.delivery_assets.map((asset) =>
        asset.kind === "bom"
          ? { ...asset, file_name: "TPL-SHW-001_INF_基本信息_v1.0.xlsx" }
          : asset
      )
    },
    { uploadsDir }
  );
  assert(wrongKind.errors.some((message) => message.includes("类型不一致")));

  const nonImage = validatePublishReadiness(
    { ...ready, effect_images: ["/uploads/TPL-SHW-001/效果图/not-image.txt"], visual_assets: [] },
    { uploadsDir }
  );
  assert(nonImage.errors.some((message) => message.includes("扩展名不正确")));

  const extraListedFile = "TPL-SHW-001_DWG_02_补充图纸_v1.0.dwg";
  const missingUpload = validatePublishReadiness(
    { ...ready, delivery_file_list: [...ready.delivery_file_list, extraListedFile] },
    { uploadsDir }
  );
  assert(missingUpload.errors.some((message) => message.includes("尚未实际上传")));

  const wrongSkpName = validatePublishReadiness(
    {
      ...ready,
      delivery_file_list: ready.delivery_file_list.map((name) =>
        name.includes("_SKP_") ? "TPL-SHW-001_SKP_其他模型_v1.0.skp" : name
      )
    },
    { uploadsDir }
  );
  assert(wrongSkpName.errors.some((message) => message.includes("系统 SKP 未列入交付文件清单")));

  const duplicateActualName = validatePublishReadiness(
    {
      ...ready,
      visual_assets: [
        ...ready.visual_assets,
        { ...ready.visual_assets[0], file_path: "/uploads/TPL-SHW-001/效果图/duplicate.png" }
      ]
    },
    { uploadsDir }
  );
  assert(duplicateActualName.errors.some((message) => message.includes("重复的原始交付文件名")));

  const renderPath = "/uploads/TPL-SHW-001/渲染图/render.png";
  const renderFile = "TPL-SHW-001_RND_01_渲染-主视图_v1.0.png";
  writeUpload(renderPath);
  const rndOnlyFiles = deliveryFiles.map((name) => (name.includes("_EFF_") ? renderFile : name));
  const rndOnly = validatePublishReadiness(
    {
      ...ready,
      effect_images: [],
      render_images: [renderPath],
      visual_assets: [{ kind: "render", file_name: renderFile, file_path: renderPath }],
      delivery_file_list: rndOnlyFiles,
      eff_rnd_merged: false,
      delivery_note: ""
    },
    { uploadsDir }
  );
  assert.equal(rndOnly.valid, true, rndOnly.errors.join("；"));

  const oldZip = new AdmZip();
  oldZip.addFile(
    "01-基本信息.csv",
    Buffer.from(
      "\uFEFF字段,值\n模板编号(只读),TPL-SHW-001\n名称,旧表单展架\n宽mm,1000\n深mm,500\n高mm,2000\n",
      "utf8"
    )
  );
  for (const [name, header] of [
    ["02-型材.csv", "颜色,长度in,数量,系数,备注"],
    ["03-六通.csv", "price_item_id,数量,备注"],
    ["04-五金.csv", "source,price_item_id,名称,规格,单位,单价,数量,备注"],
    ["05-板材.csv", "price_item_id,长in,宽in,数量,备注"],
    ["06-其他.csv", "类别,项目名称,规格,数量,单位,单价,备注"]
  ]) {
    oldZip.addFile(name, Buffer.from(`\uFEFF${header}\n`, "utf8"));
  }
  const oldPayload = parseUploadBuffer(oldZip.toBuffer(), "old.zip");
  assert(!Object.hasOwn(oldPayload.basic, "price_basis_date"));
  assert(!Object.hasOwn(oldPayload.basic, "delivery_file_list"));
  const oldPreview = previewDeepeningForm(db, ready, oldPayload);
  assert.equal(oldPreview.valid, true, JSON.stringify(oldPreview.errors));
  assert.equal(oldPreview.diff.basic.package_price.to, ready.package_price);
  assert.equal(oldPreview.diff.basic.price_basis_date.to, ready.price_basis_date);
  assert.deepEqual(oldPreview.diff.basic.delivery_file_list.to, ready.delivery_file_list);
  assert.equal(oldPreview.diff.basic.eff_rnd_merged.to, true);

  const explicitClearPayload = {
    ...oldPayload,
    basic: { ...oldPayload.basic, package_price: null, installation_hours: null }
  };
  const explicitClearPreview = previewDeepeningForm(db, ready, explicitClearPayload);
  assert.equal(explicitClearPreview.diff.basic.package_price.to, null);
  assert.equal(explicitClearPreview.diff.basic.installation_hours.to, null);

  const specialFiles = [...ready.delivery_file_list];
  specialFiles[0] = "TPL-SHW-001_EFF_01_效果,主;视图_v1.0.png";
  const roundTripTemplate = {
    ...ready,
    delivery_file_list: specialFiles,
    delivery_note: "含\"引号\",逗号\n第二行"
  };
  const roundTripZip = new AdmZip(exportFormZipBuffer(roundTripTemplate, db));
  roundTripZip.deleteEntry("form.json");
  const roundTripPayload = parseUploadBuffer(roundTripZip.toBuffer(), "round-trip.zip");
  assert.deepEqual(roundTripPayload.basic.delivery_file_list, specialFiles);
  assert.equal(roundTripPayload.basic.delivery_note, roundTripTemplate.delivery_note);

  const svg = generateAuditSvg({
    template: ready,
    checklist: Object.fromEntries(AUDIT_CHECKLIST.map((item) => [item.id, true])),
    auditor: "测试员",
    auditNote: "备注",
    passedAt: "2026-11-01 12:00:00"
  });
  const svgHeight = Number(svg.match(/height="(\d+)"/)[1]);
  const yValues = [...svg.matchAll(/y="(\d+)"/g)].map((match) => Number(match[1]));
  assert(Math.max(...yValues) < svgHeight, "审核单文字不得落在画布外");

  const versionSummary = buildSummary({
    changes: {
      mode: "diff",
      fields: [
        {
          key: "delivery_assets",
          label: "交付附件",
          from: [],
          to: [{ kind: "dwg", file_name: deliveryFiles[2] }]
        }
      ],
      tags: {},
      images: {},
      quote: {},
      totals: {}
    },
    trigger: "re_publish_minor",
    version: "v1.1",
    previousVersion: "v1.0",
    auditor: "测试员",
    auditNote: "",
    template: ready
  });
  assert(!versionSummary.includes("[object Object]"));
  assert(versionSummary.includes(deliveryFiles[2]));

  const previousSnapshot = buildSnapshot(ready);
  const changedVisualTemplate = {
    ...ready,
    effect_images: ["/uploads/TPL-SHW-001/效果图/effect-v2.png"],
    visual_assets: [
      {
        kind: "effect",
        file_name: "TPL-SHW-001_EFF_01_效果-新视图_v1.1.png",
        file_path: "/uploads/TPL-SHW-001/效果图/effect-v2.png"
      }
    ]
  };
  const visualChanges = computeChanges(previousSnapshot, buildSnapshot(changedVisualTemplate));
  assert(visualChanges.fields.some((field) => field.key === "visual_assets"));
  assert(visualChanges.images.effect, "同数量替换图片也应形成版本差异");

  console.log(
    "PASS: schema、鉴权路径、物理文件、附件映射、EFF/RND、旧 CSV 兜底、CSV 往返、审核单与版本摘要"
  );
} finally {
  db.close();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
}
