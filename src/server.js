const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
  getDb,
  listTemplates,
  getTemplate,
  getBomLines,
  parseJsonField,
  nextSortOrder
} = require("./db");
const {
  listPriceItems,
  getPriceItem,
  createPriceItem,
  updatePriceItem,
  deletePriceItem,
  setPriceItemImage,
  clearPriceItemImage,
  getPanelFilters,
  resolvePanelPricing,
  enrichPanelLine,
  enrichNutLine,
  enrichHardwareLine,
  resolvePurchaseLink,
  importPanelCsv
} = require("./price-items");
const {
  listSuppliers,
  updateSupplier,
  syncSuppliersFromPriceItems
} = require("./suppliers");
const {
  listProfileColors,
  createProfileColor,
  updateProfileColor
} = require("./profile-colors");
const {
  findCustomItem,
  listCustomItems,
  getCustomItem,
  createCustomItem,
  updateCustomItem,
  promoteCustomToHardware
} = require("./price-custom");
const {
  getProfileFormula,
  buildProfileFormulaNote,
  updateProfileFormula
} = require("./profile-formula");
const { PANEL_MATERIAL_TYPES, PANEL_COLOR_SUGGESTIONS, PANEL_COLOR_SWATCHES } = require("./price-seed");
const { PROFILE_FORMULA_NOTE, PANEL_FORMULA_NOTE, STATUS_LABELS, STATUS_FLOW, IMAGE_KINDS, AUDIT_CHECKLIST, BOM_CATEGORIES, CUSTOM_BOM_CATEGORIES, BOM_UNITS, TAGS, PRICE_FACTORS, DEFAULT_QUOTE_NOTE, EXTERNAL_PROCESS_FEE_RATE } = require("./constants");
const {
  listTagsCloud,
  searchTags,
  getTopTags,
  getOrCreateTag,
  syncTemplateTags,
  normalizeTagName,
  getTagByName,
  parseTagsQueryParam
} = require("./tags");
const {
  assertTemplateEditable,
  assertEditableById,
  validatePublishedTemplatePatch
} = require("./template-guard");
const { createVersionLogForPublish, listVersionLogs } = require("./version-log");
const {
  exportFormJson,
  exportFormZipBuffer,
  zipFilename,
  jsonFilename,
  parseUploadBuffer,
  previewDeepeningForm,
  applyDeepeningForm
} = require("./deepening-form");
const { profileFactoryPrice, profileLineTotal } = require("./pricing");
const { nextTemplateCode, resolveSkpBaseName } = require("./id");
const { saveAuditArchive } = require("./audit");
const {
  generatePublicSheetHtml,
  renderPublicSheetPdf,
  pdfFilename,
  contentDisposition,
  assertPublished
} = require("./public-sheet");
const {
  buildInternalSheetCsv,
  internalSheetFilename,
  batchInternalSheetFilename
} = require("./gallery-export");
const {
  listScenarios,
  listScenariosForMeta,
  getScenario,
  createScenario,
  updateScenario,
  deleteScenario,
  listScenarioImages,
  getScenarioImage,
  addScenarioImage,
  deleteScenarioImage,
  createMarker,
  updateMarker,
  deleteMarker,
  SCENARIO_IMAGE_KINDS,
  SCENARIO_PICKER_FOLDER,
  ensureScenarioDirs,
  listPublishedTemplatesForPicker,
  listPublishedTemplatesForScenario,
  listTemplatesForScenarioHandbook,
  resolveScenarioPickerImage,
  setScenarioPickerFromUpload,
  clearScenarioPicker
} = require("./scenarios");
const {
  HANDBOOK_BUILD,
  renderScenarioHandbookPdf,
  handbookFilename,
  contentDisposition: handbookContentDisposition
} = require("./scenario-handbook");
const {
  UPLOADS_DIR,
  ensureTemplateAssetDirs,
  getTemplateAssetDir,
  getSkpPath,
  toPublicUrl,
  syncTemplateImages,
  deleteTemplateAssets
} = require("./storage");
const {
  ROLES,
  initUsersSchema,
  seedAdminUser,
  verifyPassword,
  createSessionToken,
  attachUser,
  requireAuth,
  requirePermission,
  setSessionCookie,
  clearSessionCookie,
  getUserByUsername,
  getUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser
} = require("./auth");

const app = express();
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3847;
const db = getDb();
initUsersSchema(db);
seedAdminUser(db);

const readAuth = [requireAuth];
const writeAuth = [requireAuth, requirePermission("canWrite")];
const priceAdmin = [requireAuth, requirePermission("canManagePrices")];
const exportAuth = [requireAuth, requirePermission("canExport")];
const userAdmin = [requireAuth, requirePermission("canManageUsers")];

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "仅管理员可操作" });
  }
  next();
}

const adminAuth = [requireAuth, requireAdmin];

app.use(express.json({ limit: "2mb" }));
app.use(
  express.static(path.join(__dirname, "..", "public"), {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else if (/\.(css|js)$/.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      }
    }
  })
);
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(
  "/vendor/html2canvas",
  express.static(path.join(__dirname, "..", "node_modules", "html2canvas", "dist"))
);

const stagingDir = path.join(UPLOADS_DIR, "_staging");
fs.mkdirSync(stagingDir, { recursive: true });

const registerUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, stagingDir);
    },
    filename(_req, file, cb) {
      const safe = file.originalname.replace(/[^\w.\-()\u4e00-\u9fff]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (/\.skp$/i.test(file.originalname)) cb(null, true);
    else cb(new Error("请上传 .skp 文件"));
  }
});

const formUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (/\.(json|zip)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error("请上传 .json 或 .zip 文件"));
  }
});

function createTemplateUpload() {
  return multer({
    storage: multer.diskStorage({
      destination(req, file, cb) {
        const row = db.prepare("SELECT template_code FROM templates WHERE id = ?").get(req.params.id);
        if (!row) return cb(new Error("模板不存在"));
        const kind = req.params.kind;
        let dir = getTemplateAssetDir(row.template_code);
        if (IMAGE_KINDS[kind]) {
          dir = path.join(dir, IMAGE_KINDS[kind].folder);
        }
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename(req, file, cb) {
        const row = db.prepare("SELECT template_code FROM templates WHERE id = ?").get(req.params.id);
        if (req.params.kind === "skp" && row) {
          cb(null, `${row.template_code}.skp`);
          return;
        }
        const safe = file.originalname.replace(/[^\w.\-()\u4e00-\u9fff]/g, "_");
        cb(null, `${Date.now()}-${safe}`);
      }
    }),
    limits: { fileSize: 200 * 1024 * 1024 }
  });
}

app.use(attachUser(db));

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: "请填写用户名和密码" });
  }
  const row = getUserByUsername(db, username.trim());
  if (!row || row.enabled === 0 || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }
  const user = getUserById(db, row.id);
  setSessionCookie(res, createSessionToken(user.id));
  res.json({ user });
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "未登录" });
  res.json({ user: req.user });
});

app.get("/api/auth/users", ...userAdmin, (_req, res) => {
  res.json(listUsers(db));
});

app.post("/api/auth/users", ...userAdmin, (req, res) => {
  const { username, password, display_name, role = "editor" } = req.body || {};
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: "请填写用户名和密码" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "密码至少 6 位" });
  }
  try {
    const user = createUser(db, { username: username.trim(), password, display_name, role });
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message.includes("UNIQUE") ? "用户名已存在" : err.message });
  }
});

app.patch("/api/auth/users/:id", ...userAdmin, (req, res) => {
  try {
    const user = updateUser(db, req.params.id, req.body || {});
    if (!user) return res.status(404).json({ error: "用户不存在" });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/auth/users/:id", ...userAdmin, (req, res) => {
  try {
    if (req.user.id === Number(req.params.id)) {
      return res.status(400).json({ error: "不能删除当前登录账号" });
    }
    if (!deleteUser(db, req.params.id)) return res.status(404).json({ error: "用户不存在" });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/meta", ...readAuth, (req, res) => {
  const profileFormula = getProfileFormula(db);
  res.json({
    scenarios: listScenariosForMeta(db),
    scenarioImageKinds: SCENARIO_IMAGE_KINDS,
    statusLabels: STATUS_LABELS,
    statusFlow: STATUS_FLOW,
    imageKinds: IMAGE_KINDS,
    auditChecklist: AUDIT_CHECKLIST,
    externalProcessFeeRate: EXTERNAL_PROCESS_FEE_RATE,
    bomCategories: BOM_CATEGORIES,
    customBomCategories: CUSTOM_BOM_CATEGORIES,
    bomUnits: BOM_UNITS,
    tagTop: getTopTags(db, 5).map((t) => t.name),
    priceFactors: PRICE_FACTORS,
    defaultQuoteNote: DEFAULT_QUOTE_NOTE,
    profileFormulaNote: buildProfileFormulaNote(profileFormula),
    profileFormula,
    panelFormulaNote: PANEL_FORMULA_NOTE,
    panelMaterialTypes: PANEL_MATERIAL_TYPES,
    panelColorSuggestions: PANEL_COLOR_SUGGESTIONS,
    panelColorSwatches: PANEL_COLOR_SWATCHES,
    profileColors: listProfileColors(db, { activeOnly: true }).map((c) => c.name),
    priceCategories: [
      { id: "profile", label: "型材" },
      { id: "nut", label: "六通" },
      { id: "hardware", label: "五金配件" },
      { id: "panel", label: "板材" },
      { id: "custom", label: "非标件" }
    ],
    roles: Object.entries(ROLES).map(([id, r]) => ({ id, label: r.label })),
    currentUser: req.user
  });
});

function createScenarioImageUpload() {
  return multer({
    storage: multer.diskStorage({
      destination(req, _file, cb) {
        const row = db.prepare("SELECT code FROM scenarios WHERE id = ?").get(req.params.id);
        if (!row) return cb(new Error("场景不存在"));
        const kind = req.body?.kind === "render" ? "render" : "effect";
        const folder = SCENARIO_IMAGE_KINDS[kind]?.folder || SCENARIO_IMAGE_KINDS.effect.folder;
        const dir = path.join(UPLOADS_DIR, "scenarios", row.code, folder);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename(_req, file, cb) {
        const ext = path.extname(file.originalname) || ".jpg";
        cb(null, `${Date.now()}${ext}`);
      }
    }),
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
      const okExt = /\.(jpe?g|png|webp|gif)$/i.test(file.originalname);
      const okMime = /^image\//i.test(file.mimetype || "");
      if (okExt || okMime) cb(null, true);
      else cb(new Error("请上传图片文件"));
    }
  });
}

function createScenarioPickerUpload() {
  return multer({
    storage: multer.diskStorage({
      destination(req, _file, cb) {
        const row = db.prepare("SELECT code FROM scenarios WHERE id = ?").get(req.params.id);
        if (!row) return cb(new Error("场景不存在"));
        const dir = path.join(UPLOADS_DIR, "scenarios", row.code, SCENARIO_PICKER_FOLDER);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename(_req, file, cb) {
        const ext = path.extname(file.originalname) || ".jpg";
        cb(null, `cover${ext}`);
      }
    }),
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
      const okExt = /\.(jpe?g|png|webp|gif)$/i.test(file.originalname);
      const okMime = /^image\//i.test(file.mimetype || "");
      if (okExt || okMime) cb(null, true);
      else cb(new Error("请上传图片文件"));
    }
  });
}

function createPriceItemImageUpload() {
  return multer({
    storage: multer.diskStorage({
      destination(req, _file, cb) {
        const row = db.prepare("SELECT category FROM price_items WHERE id = ?").get(req.params.id);
        if (!row) return cb(new Error("记录不存在"));
        if (!["nut", "hardware"].includes(row.category)) return cb(new Error("仅六通/五金支持图片"));
        const dir = path.join(UPLOADS_DIR, "price-items", row.category);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename(req, file, cb) {
        const row = db.prepare("SELECT label FROM price_items WHERE id = ?").get(req.params.id);
        const safe = String(row?.label || "item")
          .replace(/[\\/:*?"<>|]/g, "_")
          .slice(0, 40);
        const ext = path.extname(file.originalname) || ".jpg";
        cb(null, `${req.params.id}-${safe}${ext}`);
      }
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
      const okExt = /\.(jpe?g|png|webp|gif)$/i.test(file.originalname);
      const okMime = /^image\//i.test(file.mimetype || "");
      if (okExt || okMime) cb(null, true);
      else cb(new Error("请上传图片文件"));
    }
  });
}

app.get("/api/scenarios", ...readAuth, (req, res) => {
  const enabledOnly = req.query.enabled === "1";
  res.json(listScenarios(db, { enabledOnly }));
});

app.post("/api/scenarios", ...adminAuth, (req, res) => {
  try {
    res.status(201).json(createScenario(db, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/scenarios/:id/handbook.pdf", ...readAuth, async (req, res) => {
  const scenario = getScenario(db, req.params.id);
  if (!scenario) return res.status(404).json({ error: "场景不存在" });
  try {
    const images = listScenarioImages(db, scenario.id);
    const templates = listTemplatesForScenarioHandbook(db, scenario, images);
    const pdf = await renderScenarioHandbookPdf(scenario, images, templates);
    const filename = handbookFilename(scenario.code);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", handbookContentDisposition(filename));
    res.send(pdf);
  } catch (e) {
    console.error("[handbook.pdf]", e);
    res.status(500).json({ error: e.message || "PDF 生成失败" });
  }
});

app.get("/api/scenarios/:id", ...readAuth, (req, res) => {
  const scenario = getScenario(db, req.params.id);
  if (!scenario) return res.status(404).json({ error: "场景不存在" });
  const images = listScenarioImages(db, scenario.id);
  const published_templates = listPublishedTemplatesForScenario(db, scenario.name);
  res.json({
    ...scenario,
    images,
    published_templates,
    picker_display: resolveScenarioPickerImage(scenario, images)
  });
});

app.patch("/api/scenarios/:id", ...adminAuth, (req, res) => {
  try {
    res.json(updateScenario(db, req.params.id, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/scenarios/:id", ...adminAuth, (req, res) => {
  try {
    deleteScenario(db, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/scenarios/:id/picker", ...adminAuth, (req, res) => {
  createScenarioPickerUpload().single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "上传失败" });
    if (!req.file) return res.status(400).json({ error: "请选择图片" });
    try {
      const scenario = setScenarioPickerFromUpload(db, req.params.id, req.file.path);
      res.json(scenario);
    } catch (e) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(400).json({ error: e.message });
    }
  });
});

app.delete("/api/scenarios/:id/picker", ...adminAuth, (req, res) => {
  try {
    res.json(clearScenarioPicker(db, req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/scenarios/:id/images", ...writeAuth, (req, res) => {
  createScenarioImageUpload().single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "上传失败" });
    const scenario = getScenario(db, req.params.id);
    if (!scenario) return res.status(404).json({ error: "场景不存在" });
    if (!req.file) return res.status(400).json({ error: "请选择图片" });
    const kind = req.body?.kind === "render" ? "render" : "effect";
    const rel = path.relative(UPLOADS_DIR, req.file.path).replace(/\\/g, "/");
    const file_path = toPublicUrl(rel);
    try {
      const image = addScenarioImage(db, scenario.id, { kind, file_path, title: req.body?.title || "" });
      res.status(201).json(image);
    } catch (e) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(400).json({ error: e.message });
    }
  });
});

app.delete("/api/scenario-images/:imageId", ...writeAuth, (req, res) => {
  try {
    deleteScenarioImage(db, req.params.imageId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/scenario-images/:imageId", ...readAuth, (req, res) => {
  const image = getScenarioImage(db, req.params.imageId);
  if (!image) return res.status(404).json({ error: "图片不存在" });
  res.json(image);
});

app.get("/api/templates/published-picker", ...readAuth, (req, res) => {
  res.json(listPublishedTemplatesForPicker(db, req.query.q));
});

app.post("/api/scenario-images/:imageId/markers", ...writeAuth, (req, res) => {
  try {
    const marker = createMarker(db, req.params.imageId, req.body || {});
    res.status(201).json(marker);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/scenario-markers/:markerId", ...writeAuth, (req, res) => {
  try {
    res.json(updateMarker(db, req.params.markerId, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/scenario-markers/:markerId", ...writeAuth, (req, res) => {
  deleteMarker(db, req.params.markerId);
  res.json({ ok: true });
});

app.get("/api/tags", ...readAuth, (req, res) => {
  if (req.query.q != null && String(req.query.q).trim() !== "") {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    return res.json(searchTags(db, req.query.q, limit));
  }
  res.json(listTagsCloud(db));
});

app.get("/api/tags/top", ...readAuth, (req, res) => {
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
  res.json(getTopTags(db, limit));
});

app.post("/api/tags", ...writeAuth, (req, res) => {
  try {
    const tag = getOrCreateTag(db, req.body?.name || "");
    const row = listTagsCloud(db).find((t) => t.id === tag.id) || { ...tag, template_count: 0 };
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/tags/:name/templates", ...readAuth, (req, res) => {
  const tag = getTagByName(db, decodeURIComponent(req.params.name));
  if (!tag) return res.status(404).json({ error: "标签不存在" });
  const items = listTemplates(db, {
    status: req.query.status,
    scenario: req.query.scenario,
    q: req.query.q,
    tags: [tag.name]
  });
  res.json({ tag: { id: tag.id, name: tag.name }, templates: items });
});

app.get("/api/templates", ...readAuth, (req, res) => {
  const tags = parseTagsQueryParam(req.query);
  const items = listTemplates(db, {
    status: req.query.status,
    scenario: req.query.scenario,
    q: req.query.q,
    tags
  });
  res.json(items);
});

app.get("/api/templates/:id", ...readAuth, (req, res) => {
  const template = getTemplate(db, req.params.id);
  if (!template) return res.status(404).json({ error: "模板不存在" });
  res.json({ ...template, bom: getBomLines(db, template.id) });
});

app.get("/api/templates/:id/version-logs", ...readAuth, (req, res) => {
  const template = getTemplate(db, req.params.id);
  if (!template) return res.status(404).json({ error: "模板不存在" });
  const rows = listVersionLogs(db, template.id).map((row) => ({
    ...row,
    changes: JSON.parse(row.changes_json || "{}")
  }));
  res.json(rows);
});

function deepeningFormDisposition(filename) {
  const encoded = encodeURIComponent(filename);
  const ascii = String(filename).replace(/[^\x20-\x7E]/g, "_") || "form";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

app.get("/api/templates/:id/deepening-form.json", ...writeAuth, (req, res) => {
  const template = getTemplate(db, req.params.id);
  if (!template) return res.status(404).json({ error: "模板不存在" });
  const empty = req.query.empty === "1";
  const payload = exportFormJson(template, db, { empty });
  const filename = jsonFilename(template.template_code);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", deepeningFormDisposition(filename));
  res.send(JSON.stringify(payload, null, 2));
});

app.get("/api/templates/:id/deepening-form.zip", ...writeAuth, (req, res) => {
  const template = getTemplate(db, req.params.id);
  if (!template) return res.status(404).json({ error: "模板不存在" });
  const empty = req.query.empty === "1";
  const buf = exportFormZipBuffer(template, db, { empty });
  const filename = zipFilename(template.template_code);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", deepeningFormDisposition(filename));
  res.send(buf);
});

function handleDeepeningFormUpload(apply) {
  return (req, res) => {
    const template = getTemplate(db, req.params.id);
    if (!template) return res.status(404).json({ error: "模板不存在" });
    if (apply) {
      try {
        assertEditableById(db, template.id);
      } catch (err) {
        return guardError(res, err);
      }
    }
    if (!req.file?.buffer) return res.status(400).json({ error: "请上传 .json 或 .zip 文件" });
    try {
      const payload = parseUploadBuffer(req.file.buffer, req.file.originalname);
      if (apply) {
        const result = applyDeepeningForm(db, template, payload, req.user);
        res.json({ template: getTemplate(db, template.id), ...result });
      } else {
        res.json(previewDeepeningForm(db, template, payload));
      }
    } catch (err) {
      res.status(err.status || 500).json({
        error: err.message || "处理失败",
        details: err.details || null
      });
    }
  };
}

app.post(
  "/api/templates/:id/deepening-form/preview",
  ...writeAuth,
  formUpload.single("file"),
  handleDeepeningFormUpload(false)
);
app.post(
  "/api/templates/:id/deepening-form/apply",
  ...writeAuth,
  formUpload.single("file"),
  handleDeepeningFormUpload(true)
);

app.get("/api/templates/:id/public-sheet.html", ...readAuth, (req, res) => {
  const template = getTemplate(db, req.params.id);
  try {
    assertPublished(template);
    res.type("html; charset=utf-8").send(generatePublicSheetHtml(template));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "生成失败" });
  }
});

app.get("/api/templates/:id/public-sheet.pdf", ...readAuth, async (req, res) => {
  const template = getTemplate(db, req.params.id);
  try {
    assertPublished(template);
    const pdf = await renderPublicSheetPdf(template);
    const filename = pdfFilename(template.template_code);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", contentDisposition(filename));
    res.send(Buffer.from(pdf));
  } catch (e) {
    console.error("[public-sheet.pdf]", e);
    res.status(e.status || 500).json({ error: e.message || "PDF 生成失败" });
  }
});

app.get("/api/templates/:id/internal-sheet.csv", ...exportAuth, (req, res) => {
  const template = getTemplate(db, req.params.id);
  try {
    assertPublished(template);
    const body = buildInternalSheetCsv(db, [template]);
    sendCsv(res, "internal-sheet.csv", internalSheetFilename(template.template_code), body);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "导出失败" });
  }
});

function parseTemplateIdsParam(raw) {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(",");
  const ids = [...new Set(parts.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
  return ids;
}

app.get("/api/export/gallery-sheet", ...exportAuth, (req, res) => {
  const ids = parseTemplateIdsParam(req.query.ids);
  if (!ids.length) return res.status(400).json({ error: "请指定模板 id（ids=1,2,3）" });
  const templates = ids
    .map((id) => getTemplate(db, id))
    .filter((t) => t && t.status === "published");
  if (!templates.length) return res.status(404).json({ error: "未找到可导出的已发布模板" });
  const body = buildInternalSheetCsv(db, templates);
  sendCsv(res, "gallery-sheet.csv", batchInternalSheetFilename(), body);
});

app.post("/api/templates/register", ...writeAuth, (req, res) => {
  registerUpload.single("skp")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "上传失败" });

    const { scenario } = req.body || {};
    if (!scenario) return res.status(400).json({ error: "请选择应用场景" });
    if (!req.file) return res.status(400).json({ error: "请上传 skp 文件" });

    try {
      const originalBase = resolveSkpBaseName(req.body, req.file.originalname);
      const { templateCode, slug, nameSegment } = nextTemplateCode(db, scenario, originalBase);
      ensureTemplateAssetDirs(templateCode);

      const skpDest = getSkpPath(templateCode);
      fs.renameSync(req.file.path, skpDest);

      const assignee = req.user.display_name || req.user.username;
      const name = nameSegment;
      const skpUrl = toPublicUrl(`${templateCode}/${templateCode}.skp`);

      const result = db
        .prepare(
          `INSERT INTO templates (
            template_code, slug, name, scenario, assignee, skp_file,
            quote_note, status, skin_upgrade_enabled
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_quote', 0)`
        )
        .run(templateCode, slug, name, scenario, assignee, skpUrl, DEFAULT_QUOTE_NOTE);

      const template = getTemplate(db, result.lastInsertRowid);
      syncTemplateImages(db, db.prepare("SELECT * FROM templates WHERE id = ?").get(template.id));
      res.status(201).json(getTemplate(db, template.id));
    } catch (e) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: e.message });
    }
  });
});

app.post("/api/templates", ...writeAuth, (_req, res) => {
  res.status(410).json({
    error: "请使用「上传 skp + 选择场景」登记模板（POST /api/templates/register）"
  });
});

app.patch("/api/templates/:id", ...writeAuth, (req, res) => {
  const existing = getTemplate(db, req.params.id);
  if (!existing) return res.status(404).json({ error: "模板不存在" });

  try {
    validatePublishedTemplatePatch(existing, req.body);
  } catch (err) {
    return guardError(res, err);
  }

  const allowed = [
    "name",
    "tags",
    "one_liner",
    "panel_note",
    "assignee",
    "price_factors",
    "width_mm",
    "depth_mm",
    "height_mm",
    "quote_note",
    "price_override_min",
    "price_override_max",
    "inquiry_form_url",
    "version",
    "internal_note",
    "skin_upgrade_enabled",
    "cover_source",
    "status"
  ];

  const sets = [];
  const values = [];

  if ("tags" in req.body) {
    const names = Array.isArray(req.body.tags) ? req.body.tags : [];
    syncTemplateTags(db, req.params.id, names);
  }

  for (const key of allowed) {
    if (!(key in req.body) || key === "tags" || key === "version") continue;
    let val = req.body[key];
    if (key === "price_factors") val = JSON.stringify(val);
    if (key === "skin_upgrade_enabled") val = val ? 1 : 0;
    sets.push(`${key} = ?`);
    values.push(val);
  }

  if (req.body.status && req.body.status !== existing.status) {
    if (req.body.status === "published") {
      return res.status(400).json({ error: "请通过审核页「通过并发布」" });
    }
    const nextAllowed = STATUS_FLOW[existing.status] || [];
    if (!nextAllowed.includes(req.body.status)) {
      return res.status(400).json({
        error: `不能从「${STATUS_LABELS[existing.status]}」直接变为「${STATUS_LABELS[req.body.status]}」`
      });
    }
  }

  if (sets.length === 0) {
    return res.json(existing);
  }

  sets.push("updated_at = datetime('now')");
  values.push(req.params.id);

  db.prepare(`UPDATE templates SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id);
  if ("cover_source" in req.body) {
    syncTemplateImages(db, row);
  }
  res.json(getTemplate(db, req.params.id));
});

app.delete("/api/templates/:id", ...adminAuth, (req, res) => {
  const row = db.prepare("SELECT id, template_code FROM templates WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "模板不存在" });

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM templates WHERE id = ?").run(row.id);
    deleteTemplateAssets(row.template_code);
    db.exec("COMMIT");
    res.json({ ok: true, deleted_code: row.template_code });
  } catch (err) {
    db.exec("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/templates/:id/bom", ...writeAuth, (req, res) => {
  const template = guardEditableTemplateId(db, req.params.id, res);
  if (!template) return;

  const {
    category,
    item_name,
    spec = "",
    qty = 1,
    unit = "个",
    unit_price,
    note = "",
    update_price = false
  } = req.body;

  if (!category || !item_name?.trim()) {
    return res.status(400).json({ error: "请填写类别与项目名称" });
  }
  if (!CUSTOM_BOM_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "无效的类别" });
  }
  const price = Number(unit_price);
  if (!price || price <= 0) {
    return res.status(400).json({ error: "请填写有效单价" });
  }

  const existing = findCustomItem(db, {
    source_category: category,
    item_name: item_name.trim(),
    spec
  });

  if (existing && existing.unit_price !== price && !update_price) {
    return res.status(409).json({
      duplicate: true,
      existing,
      message: `已存在同名非标件（当前单价 ¥${existing.unit_price}），是否更新单价？`
    });
  }

  let customItem = existing;
  if (!customItem) {
    customItem = createCustomItem(db, {
      source_category: category,
      item_name: item_name.trim(),
      spec,
      unit,
      unit_price: price,
      created_by: req.user.display_name || req.user.username
    });
  } else if (update_price && existing.unit_price !== price) {
    customItem = updateCustomItem(db, existing.id, { unit_price: price });
  }

  const maxLine = db
    .prepare("SELECT COALESCE(MAX(line_no), 0) AS m FROM bom_lines WHERE template_id = ?")
    .get(template.id).m;

  const result = db
    .prepare(
      `INSERT INTO bom_lines (
        template_id, line_no, category, item_name, spec, qty, unit, unit_price, note, custom_price_item_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      template.id,
      maxLine + 1,
      category,
      item_name.trim(),
      spec || "",
      Number(qty) || 1,
      unit,
      price,
      note,
      customItem.id
    );

  const line = db
    .prepare("SELECT *, (qty * unit_price) AS subtotal FROM bom_lines WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(line);
});

app.patch("/api/bom/:lineId", ...writeAuth, (req, res) => {
  const line = db.prepare("SELECT * FROM bom_lines WHERE id = ?").get(req.params.lineId);
  if (!line) return res.status(404).json({ error: "BOM 行不存在" });
  if (!guardEditableTemplateId(db, line.template_id, res)) return;

  const fields = ["category", "item_name", "spec", "qty", "unit", "unit_price", "note", "line_no"];
  const sets = [];
  const values = [];
  for (const key of fields) {
    if (!(key in req.body)) continue;
    sets.push(`${key} = ?`);
    values.push(req.body[key]);
  }
  if (sets.length === 0) return res.json(line);
  values.push(req.params.lineId);
  db.prepare(`UPDATE bom_lines SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  res.json(
    db.prepare("SELECT *, (qty * unit_price) AS subtotal FROM bom_lines WHERE id = ?").get(req.params.lineId)
  );
});

app.delete("/api/bom/:lineId", ...writeAuth, (req, res) => {
  if (!guardEditableQuoteLine(db, "bom_lines", req.params.lineId, res)) return;
  const result = db.prepare("DELETE FROM bom_lines WHERE id = ?").run(req.params.lineId);
  if (result.changes === 0) return res.status(404).json({ error: "BOM 行不存在" });
  res.json({ ok: true });
});

function ensureTemplate(id) {
  const row = db.prepare("SELECT id FROM templates WHERE id = ?").get(id);
  return row ? row.id : null;
}

function guardError(res, err) {
  return res.status(err.status || 500).json({ error: err.message });
}

function guardEditableTemplateId(db, id, res) {
  try {
    return assertEditableById(db, id);
  } catch (err) {
    guardError(res, err);
    return null;
  }
}

function guardEditableQuoteLine(db, table, lineId, res) {
  const row = db.prepare(`SELECT template_id FROM ${table} WHERE id = ?`).get(lineId);
  if (!row) {
    guardError(res, Object.assign(new Error("记录不存在"), { status: 404 }));
    return false;
  }
  return guardEditableTemplateId(db, row.template_id, res);
}

app.post("/api/templates/:id/profiles", ...writeAuth, (req, res) => {
  const template = guardEditableTemplateId(db, req.params.id, res);
  if (!template) return;
  const templateId = template.id;
  const { length_inch, qty = 1, coefficient = 1, note = "", color } = req.body;
  if (!length_inch) return res.status(400).json({ error: "请填写长度(inch)" });
  let colorName;
  try {
    const { resolveProfileColorForWrite } = require("./profile-colors");
    colorName = resolveProfileColorForWrite(db, color);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const sort = nextSortOrder(db, "quote_profiles", templateId);
  const result = db
    .prepare(
      `INSERT INTO quote_profiles (template_id, length_inch, qty, coefficient, color, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      templateId,
      Number(length_inch),
      Number(qty) || 1,
      Number(coefficient) || 1,
      colorName,
      note,
      sort
    );
  const row = db.prepare("SELECT * FROM quote_profiles WHERE id = ?").get(result.lastInsertRowid);
  const formula = getProfileFormula(db);
  res.status(201).json({
    ...row,
    ...profileLineTotal(row.length_inch, row.qty, { coefficient: row.coefficient, formula })
  });
});

app.delete("/api/profiles/:lineId", ...writeAuth, (req, res) => {
  if (!guardEditableQuoteLine(db, "quote_profiles", req.params.lineId, res)) return;
  const r = db.prepare("DELETE FROM quote_profiles WHERE id = ?").run(req.params.lineId);
  if (r.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ ok: true });
});

app.post("/api/templates/:id/nuts", ...writeAuth, (req, res) => {
  const template = guardEditableTemplateId(db, req.params.id, res);
  if (!template) return;
  const templateId = template.id;
  const { price_item_id, qty = 1, note = "", manual = false } = req.body;

  let item;
  if (manual) {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "手动输入仅管理员可用" });
    }
    const { label, nut_model, unit_price, unit = "个" } = req.body;
    if (!label?.trim() || !nut_model?.trim()) {
      return res.status(400).json({ error: "请填写名称与型号" });
    }
    item = createPriceItem(db, {
      category: "nut",
      label: label.trim(),
      nut_model: nut_model.trim(),
      unit,
      unit_price
    });
  } else {
    if (!price_item_id) return res.status(400).json({ error: "请从单价库选择六通型号" });
    item = getPriceItem(db, price_item_id);
    if (!item || item.category !== "nut") {
      return res.status(400).json({ error: "无效的六通单价项" });
    }
  }

  const sort = nextSortOrder(db, "quote_nuts", templateId);
  const result = db
    .prepare(
      `INSERT INTO quote_nuts (template_id, price_item_id, nut_model, item_name, qty, unit_price, unit, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      templateId,
      item.id,
      item.nut_model,
      item.label,
      Number(qty) || 1,
      item.unit_price,
      item.unit,
      note,
      sort
    );
  const row = db.prepare("SELECT * FROM quote_nuts WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(enrichNutLine(row, item));
});

app.delete("/api/nuts/:lineId", ...writeAuth, (req, res) => {
  if (!guardEditableQuoteLine(db, "quote_nuts", req.params.lineId, res)) return;
  const r = db.prepare("DELETE FROM quote_nuts WHERE id = ?").run(req.params.lineId);
  if (r.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ ok: true });
});

app.post("/api/templates/:id/hardware", ...writeAuth, (req, res) => {
  const template = guardEditableTemplateId(db, req.params.id, res);
  if (!template) return;
  const templateId = template.id;
  const { price_item_id, qty = 1, note = "", manual = false } = req.body;

  let item;
  if (manual) {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "手动输入仅管理员可用" });
    }
    const { label, spec = "", unit = "个", unit_price } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: "请填写名称" });
    item = createPriceItem(db, {
      category: "hardware",
      label: label.trim(),
      spec,
      unit,
      unit_price
    });
  } else {
    if (!price_item_id) return res.status(400).json({ error: "请从单价库选择五金配件" });
    item = getPriceItem(db, price_item_id);
    if (!item || item.category !== "hardware") {
      return res.status(400).json({ error: "无效的五金单价项" });
    }
  }

  const sort = nextSortOrder(db, "quote_hardware", templateId);
  const result = db
    .prepare(
      `INSERT INTO quote_hardware (template_id, price_item_id, item_name, spec, qty, unit_price, unit, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      templateId,
      item.id,
      item.label,
      item.spec || "",
      Number(qty) || 1,
      item.unit_price,
      item.unit,
      note,
      sort
    );
  const row = db.prepare("SELECT * FROM quote_hardware WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(enrichHardwareLine(row, item));
});

app.delete("/api/hardware/:lineId", ...writeAuth, (req, res) => {
  if (!guardEditableQuoteLine(db, "quote_hardware", req.params.lineId, res)) return;
  const r = db.prepare("DELETE FROM quote_hardware WHERE id = ?").run(req.params.lineId);
  if (r.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ ok: true });
});

app.post("/api/templates/:id/panels", ...writeAuth, (req, res) => {
  const template = guardEditableTemplateId(db, req.params.id, res);
  if (!template) return;
  const templateId = template.id;
  const {
    price_item_id,
    length_inch,
    width_inch,
    qty = 1,
    note = "",
    manual = false
  } = req.body;

  if (!length_inch || !width_inch) return res.status(400).json({ error: "请填写长宽(inch)" });

  let item;
  if (manual) {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "手动输入仅管理员可用" });
    }
    const {
      label,
      material_type,
      color,
      thickness_mm,
      unit_price,
      pricing_mode = "per_sqm"
    } = req.body;
    if (!material_type || !color || thickness_mm == null) {
      return res.status(400).json({ error: "请填写材质、颜色、厚度" });
    }
    item = createPriceItem(db, {
      category: "panel",
      label: label?.trim() || `${material_type} · ${color} · ${thickness_mm}mm`,
      material_type,
      color,
      thickness_mm: Number(thickness_mm),
      unit_price,
      pricing_mode: pricing_mode || "per_sqm",
      unit: "块"
    });
  } else {
    if (!price_item_id) return res.status(400).json({ error: "请从单价库选择板材规格" });
    item = getPriceItem(db, price_item_id);
    if (!item || item.category !== "panel") {
      return res.status(400).json({ error: "无效的板材单价项" });
    }
  }

  const pricing = resolvePanelPricing(item);
  const sort = nextSortOrder(db, "quote_panels", templateId);
  const result = db
    .prepare(
      `INSERT INTO quote_panels (
        template_id, price_item_id, material_type, color, thickness_mm, material_name,
        length_inch, width_inch, qty, pricing_mode, price_per_sqm, fixed_unit_price, note, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      templateId,
      item.id,
      item.material_type,
      item.color,
      item.thickness_mm,
      item.label,
      Number(length_inch),
      Number(width_inch),
      Number(qty) || 1,
      pricing.pricing_mode,
      pricing.price_per_sqm,
      pricing.fixed_unit_price,
      note,
      sort
    );
  const row = db.prepare("SELECT * FROM quote_panels WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(enrichPanelLine(row, item));
});

app.delete("/api/panels/:lineId", ...writeAuth, (req, res) => {
  if (!guardEditableQuoteLine(db, "quote_panels", req.params.lineId, res)) return;
  const r = db.prepare("DELETE FROM quote_panels WHERE id = ?").run(req.params.lineId);
  if (r.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ ok: true });
});

app.get("/api/pricing/preview-profile", ...readAuth, (req, res) => {
  const { length_inch, qty = 1, coefficient = 1 } = req.query;
  if (!length_inch) return res.status(400).json({ error: "缺少 length_inch" });
  const formula = getProfileFormula(db);
  const factory_price = profileFactoryPrice(length_inch, formula);
  res.json({
    factory_price,
    ...profileLineTotal(length_inch, qty, { coefficient, formula })
  });
});

app.get("/api/pricing/profile-formula", ...readAuth, (_req, res) => {
  res.json(getProfileFormula(db));
});

app.patch("/api/pricing/profile-formula", ...priceAdmin, (req, res) => {
  try {
    const formula = updateProfileFormula(db, {
      ...req.body,
      updated_by: req.user.display_name || req.user.username
    });
    res.json(formula);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/price-items/custom", ...readAuth, (req, res) => {
  res.json(listCustomItems(db, { enabledOnly: req.query.all !== "1" }));
});

app.post("/api/price-items/custom", ...writeAuth, (req, res) => {
  const { source_category, item_name, spec = "", unit = "个", unit_price } = req.body || {};
  if (!source_category || !item_name?.trim()) {
    return res.status(400).json({ error: "请填写类别与项目名称" });
  }
  const price = Number(unit_price);
  if (!price || price <= 0) return res.status(400).json({ error: "请填写有效单价" });

  const existing = findCustomItem(db, {
    source_category,
    item_name: item_name.trim(),
    spec
  });
  if (existing) {
    return res.status(409).json({ duplicate: true, existing });
  }

  res.status(201).json(
    createCustomItem(db, {
      source_category,
      item_name: item_name.trim(),
      spec,
      unit,
      unit_price: price,
      created_by: req.user.display_name || req.user.username
    })
  );
});

app.patch("/api/price-items/custom/:id", ...priceAdmin, (req, res) => {
  const updated = updateCustomItem(db, req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "记录不存在" });
  const { _propagation, ...item } = updated;
  res.json({ ...item, propagation: _propagation || null });
});

app.post("/api/price-items/custom/:id/promote", ...priceAdmin, (req, res) => {
  try {
    const result = promoteCustomToHardware(db, req.params.id, req.body || {});
    if (!result) return res.status(404).json({ error: "记录不存在" });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/price-items", ...readAuth, (req, res) => {
  const enabledOnly = req.query.all !== "1";
  res.json(listPriceItems(db, { category: req.query.category, enabledOnly }));
});

app.get("/api/price-items/panel-filters", ...readAuth, (_req, res) => {
  res.json(getPanelFilters(db));
});

app.get("/api/price-items/panel/csv-template", ...readAuth, (_req, res) => {
  const templatePath = path.join(__dirname, "..", "data", "feishu", "板材单价库-导入模板.csv");
  if (!fs.existsSync(templatePath)) {
    return res.status(404).json({ error: "模板文件不存在" });
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="板材单价库-导入模板.csv"');
  res.send(fs.readFileSync(templatePath, "utf8"));
});

app.post("/api/price-items/panel/import", ...priceAdmin, (req, res) => {
  const { csv, duplicateDecisions, preview } = req.body || {};
  if (!csv?.trim()) return res.status(400).json({ error: "请上传 CSV 内容" });
  try {
    const isPreview = preview === true || (preview !== false && duplicateDecisions == null);
    const result = importPanelCsv(db, {
      csv,
      duplicateDecisions: duplicateDecisions ?? null,
      preview: isPreview
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/price-items/resolve-link", ...readAuth, (req, res) => {
  res.json(resolvePurchaseLink(req.body?.url || ""));
});

app.get("/api/suppliers", ...readAuth, (_req, res) => {
  res.json(listSuppliers(db));
});

app.post("/api/suppliers/sync", ...priceAdmin, (_req, res) => {
  const added = syncSuppliersFromPriceItems(db);
  res.json({ ok: true, added, suppliers: listSuppliers(db) });
});

app.patch("/api/suppliers/:id", ...priceAdmin, (req, res) => {
  const updated = updateSupplier(db, req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "供应商不存在" });
  res.json(updated);
});

app.get("/api/profile-colors", ...readAuth, (req, res) => {
  const activeOnly = req.query.all !== "1" || !req.user?.permissions?.canManagePrices;
  res.json(listProfileColors(db, { activeOnly }));
});

app.post("/api/profile-colors", ...priceAdmin, (req, res) => {
  try {
    const created = createProfileColor(db, req.body?.name);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/profile-colors/:id", ...priceAdmin, (req, res) => {
  const updated = updateProfileColor(db, req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "颜色不存在" });
  res.json(updated);
});

app.post("/api/price-items", ...priceAdmin, (req, res) => {
  const {
    category,
    label,
    unit,
    unit_price,
    unit_price_internal,
    pricing_mode,
    nut_model,
    spec,
    material_type,
    color,
    color_hex,
    thickness_mm,
    link,
    supplier,
    note
  } = req.body;
  if (!category || !label?.trim()) {
    return res.status(400).json({ error: "请填写分类与名称" });
  }
  if (!["nut", "hardware", "panel"].includes(category)) {
    return res.status(400).json({ error: "无效分类" });
  }
  if ((category === "hardware" || category === "panel") && !supplier?.trim()) {
    return res.status(400).json({ error: "请填写供应商" });
  }
  res.status(201).json(
    createPriceItem(db, {
      category,
      label: label.trim(),
      unit,
      unit_price,
      unit_price_internal,
      pricing_mode: category === "panel" ? pricing_mode || "per_sqm" : "unit",
      nut_model,
      spec,
      material_type,
      color,
      color_hex,
      thickness_mm,
      link,
      supplier: supplier?.trim() || "",
      note
    })
  );
});

app.patch("/api/price-items/:id", ...priceAdmin, (req, res) => {
  const existing = getPriceItem(db, req.params.id);
  if (!existing) return res.status(404).json({ error: "记录不存在" });
  if (
    (existing.category === "hardware" || existing.category === "panel") &&
    "supplier" in (req.body || {}) &&
    !req.body.supplier?.trim()
  ) {
    return res.status(400).json({ error: "请填写供应商" });
  }
  const updated = updatePriceItem(db, req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "记录不存在" });
  const { _propagation, ...item } = updated;
  res.json({ ...item, propagation: _propagation || null });
});

app.delete("/api/price-items/:id", ...priceAdmin, (req, res) => {
  try {
    const r = deletePriceItem(db, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: "记录不存在" });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "REFERENCED") {
      return res.status(409).json({
        error: err.message,
        references: err.references
      });
    }
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/price-items/:id/image", ...priceAdmin, (req, res) => {
  createPriceItemImageUpload().single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "上传失败" });
    if (!req.file) return res.status(400).json({ error: "请选择图片" });
    try {
      res.json(setPriceItemImage(db, req.params.id, req.file.path));
    } catch (e) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(e.status || 400).json({ error: e.message });
    }
  });
});

app.delete("/api/price-items/:id/image", ...priceAdmin, (req, res) => {
  try {
    const item = clearPriceItemImage(db, req.params.id);
    res.json(item);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

app.post("/api/templates/:id/audit/approve", ...writeAuth, (req, res) => {
  const template = getTemplate(db, req.params.id);
  if (!template) return res.status(404).json({ error: "模板不存在" });
  if (template.status !== "pending_review") {
    return res.status(400).json({ error: "仅「待审核」模板可通过审核发布" });
  }

  const { checklist = {}, audit_note = "" } = req.body || {};
  for (const item of AUDIT_CHECKLIST) {
    if (!checklist[item.id]) {
      return res.status(400).json({ error: `审核项未全部勾选：${item.label}` });
    }
  }

  const auditor = req.user.display_name || req.user.username;
  try {
    const auditResult = saveAuditArchive({ template, checklist, auditor, auditNote: audit_note });
    const versionInfo = createVersionLogForPublish(db, {
      template,
      auditor,
      auditNote: audit_note,
      auditImageRel: auditResult.audit_image_rel
    });

    db.prepare(
      `UPDATE templates SET
        status = 'published',
        published_at = datetime('now'),
        version = ?,
        last_audit_note = ?,
        last_audit_by = ?,
        last_audit_at = datetime('now'),
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(versionInfo.version, audit_note.trim(), auditor, template.id);
    res.json(getTemplate(db, template.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/templates/:id/audit/reject", ...writeAuth, (req, res) => {
  const template = getTemplate(db, req.params.id);
  if (!template) return res.status(404).json({ error: "模板不存在" });
  if (template.status !== "pending_review") {
    return res.status(400).json({ error: "仅「待审核」模板可退回" });
  }

  const { reject_reason = "", target_status = "pending_quote" } = req.body || {};
  if (!reject_reason.trim()) return res.status(400).json({ error: "请填写退回原因" });
  if (target_status !== "pending_quote") {
    return res.status(400).json({ error: "无效的退回目标状态" });
  }

  db.prepare(
    `UPDATE templates SET
      status = ?,
      internal_note = CASE WHEN internal_note = '' THEN ? ELSE internal_note || char(10) || ? END,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    target_status,
    `[审核退回] ${reject_reason.trim()}`,
    `[审核退回] ${reject_reason.trim()}`,
    template.id
  );
  res.json(getTemplate(db, template.id));
});

app.post("/api/templates/:id/upload/:kind", ...writeAuth, (req, res) => {
  const template = guardEditableTemplateId(db, req.params.id, res);
  if (!template) return;

  const kind = req.params.kind;
  if (!["photo", "effect", "render", "skp"].includes(kind)) {
    return res.status(400).json({ error: "未知上传类型，可用：photo / effect / render / skp" });
  }

  createTemplateUpload().single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "上传失败" });
    if (!req.file) return res.status(400).json({ error: "未收到文件" });

    try {
      const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(template.id);
      if (kind === "skp") {
        const skpUrl = toPublicUrl(`${row.template_code}/${row.template_code}.skp`);
        db.prepare(
          "UPDATE templates SET skp_file = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(skpUrl, template.id);
      }
      syncTemplateImages(db, db.prepare("SELECT * FROM templates WHERE id = ?").get(template.id));
      res.json(getTemplate(db, template.id));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

function csvEscape(val) {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function sendCsv(res, asciiFilename, utf8Filename, body) {
  const encodedName = encodeURIComponent(utf8Filename);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedName}`
  );
  res.send("\uFEFF" + body);
}

app.get("/api/export/feishu-main", ...exportAuth, (_req, res) => {
  const rows = listTemplates(db);
  const headers = [
    "模板编号",
    "slug",
    "模板名称",
    "应用场景",
    "标签",
    "一句话描述",
    "皮肤选配说明",
    "宽mm",
    "深mm",
    "高mm",
    "参考价下限",
    "参考价上限",
    "报价口径",
    "变价因素",
    "负责人",
    "状态",
    "版本",
    "可定制",
    "询单链接",
    "内部备注"
  ];
  const lines = [headers.join(",")];
  for (const t of rows) {
    lines.push(
      [
        t.template_code,
        t.slug,
        t.name,
        t.scenario,
        t.tags.join(";"),
        t.one_liner,
        t.panel_note,
        t.width_mm ?? "",
        t.depth_mm ?? "",
        t.height_mm ?? "",
        t.price_min,
        t.price_max,
        t.quote_note,
        t.price_factors.join(";"),
        t.assignee,
        STATUS_LABELS[t.status] || t.status,
        t.version,
        t.skin_upgrade_enabled ? "是" : "否",
        t.inquiry_form_url,
        t.internal_note
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  sendCsv(res, "feishu-templates-main.csv", "feishu-模板主表.csv", lines.join("\n"));
});

app.get("/api/export/feishu-bom", ...exportAuth, (_req, res) => {
  const headers = [
    "所属模板编号",
    "区块",
    "类别",
    "项目名称",
    "规格/尺寸",
    "数量",
    "单位",
    "出厂参考价",
    "报价单价",
    "小计",
    "备注"
  ];
  const lines = [headers.join(",")];
  const templates = db.prepare("SELECT id, template_code FROM templates ORDER BY template_code").all();

  for (const t of templates) {
    const full = getTemplate(db, t.id);
    if (!full?.quote) continue;
    const q = full.quote;

    for (const p of q.profileLines) {
      lines.push(
        [
          t.template_code,
          "MR2525型材",
          "型材",
          "MR2525",
          [p.color, `${p.length_inch} inch`].filter(Boolean).join(" · "),
          p.qty,
          "根",
          p.factory_price,
          p.quote_unit,
          p.subtotal,
          p.note || ""
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    for (const n of q.nutLines) {
      lines.push(
        [
          t.template_code,
          "六通",
          "六通",
          n.item_name,
          n.nut_model || "",
          n.qty,
          n.unit || "个",
          n.unit_price,
          n.unit_price,
          n.subtotal,
          n.note || ""
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    for (const h of q.hardwareLines) {
      lines.push(
        [
          t.template_code,
          "五金配件",
          "配件",
          h.item_name,
          h.spec || "",
          h.qty,
          h.unit || "个",
          h.unit_price,
          h.unit_price,
          h.subtotal,
          h.note || ""
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    for (const p of q.panelLines) {
      lines.push(
        [
          t.template_code,
          "板材",
          "面板",
          p.material_name,
          `${p.material_type}/${p.color}/${p.thickness_mm}mm · ${p.length_inch}×${p.width_inch}in`,
          p.qty,
          "块",
          p.pricing_mode === "fixed" ? p.fixed_unit_price : p.price_per_sqm,
          p.unit_price?.toFixed(2),
          p.subtotal?.toFixed(2),
          p.note || ""
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    for (const b of q.legacyLines) {
      lines.push(
        [
          t.template_code,
          "其他",
          b.category,
          b.item_name,
          b.spec,
          b.qty,
          b.unit,
          b.unit_price,
          b.unit_price,
          b.subtotal,
          b.note || ""
        ]
          .map(csvEscape)
          .join(",")
      );
    }
  }

  sendCsv(res, "feishu-quote-lines.csv", "feishu-报价底表.csv", lines.join("\n"));
});

app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, HOST, () => {
  const projectRoot = path.join(__dirname, "..");
  console.log(`MR2525 模板库已启动: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  if (HOST === "0.0.0.0") {
    console.log(`局域网访问: http://<本机IP>:${PORT}`);
  }
  console.log(`项目目录: ${projectRoot}`);
  console.log(`数据文件: ${path.join(projectRoot, "data", "catalog.db")}`);
  console.log(`场景手册 PDF: ${HANDBOOK_BUILD}`);
  console.log(`状态流·已下架可转至: ${(STATUS_FLOW.archived || []).join(", ") || "(无)"}`);
});
