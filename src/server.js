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
  getPanelFilters,
  resolvePanelPricing,
  enrichPanelLine,
  enrichNutLine,
  enrichHardwareLine
} = require("./price-items");
const { PANEL_MATERIAL_TYPES, PANEL_COLOR_SUGGESTIONS, PANEL_COLOR_SWATCHES } = require("./price-seed");
const { PROFILE_FORMULA_NOTE, PANEL_FORMULA_NOTE, SCENARIOS, STATUS_LABELS, STATUS_FLOW, IMAGE_KINDS, AUDIT_CHECKLIST, BOM_CATEGORIES, BOM_UNITS, TAGS, PRICE_FACTORS, DEFAULT_QUOTE_NOTE, EXTERNAL_PROCESS_FEE_RATE } = require("./constants");
const { profileFactoryPrice, profileLineTotal } = require("./pricing");
const { nextTemplateCode } = require("./id");
const { saveAuditArchive } = require("./audit");
const {
  UPLOADS_DIR,
  ensureTemplateAssetDirs,
  getTemplateAssetDir,
  getSkpPath,
  toPublicUrl,
  syncTemplateImages
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

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/uploads", express.static(UPLOADS_DIR));

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
  res.json({
    scenarios: SCENARIOS,
    statusLabels: STATUS_LABELS,
    statusFlow: STATUS_FLOW,
    imageKinds: IMAGE_KINDS,
    auditChecklist: AUDIT_CHECKLIST,
    externalProcessFeeRate: EXTERNAL_PROCESS_FEE_RATE,
    bomCategories: BOM_CATEGORIES,
    bomUnits: BOM_UNITS,
    tags: TAGS,
    priceFactors: PRICE_FACTORS,
    defaultQuoteNote: DEFAULT_QUOTE_NOTE,
    profileFormulaNote: PROFILE_FORMULA_NOTE,
    panelFormulaNote: PANEL_FORMULA_NOTE,
    panelMaterialTypes: PANEL_MATERIAL_TYPES,
    panelColorSuggestions: PANEL_COLOR_SUGGESTIONS,
    panelColorSwatches: PANEL_COLOR_SWATCHES,
    priceCategories: [
      { id: "nut", label: "六通" },
      { id: "hardware", label: "五金配件" },
      { id: "panel", label: "板材" }
    ],
    roles: Object.entries(ROLES).map(([id, r]) => ({ id, label: r.label })),
    currentUser: req.user
  });
});

app.get("/api/templates", ...readAuth, (req, res) => {
  const items = listTemplates(db, {
    status: req.query.status,
    scenario: req.query.scenario,
    q: req.query.q
  });
  res.json(items);
});

app.get("/api/templates/:id", ...readAuth, (req, res) => {
  const template = getTemplate(db, req.params.id);
  if (!template) return res.status(404).json({ error: "模板不存在" });
  res.json({ ...template, bom: getBomLines(db, template.id) });
});

app.post("/api/templates/register", ...writeAuth, (req, res) => {
  registerUpload.single("skp")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "上传失败" });

    const { scenario } = req.body || {};
    if (!scenario) return res.status(400).json({ error: "请选择应用场景" });
    if (!req.file) return res.status(400).json({ error: "请上传 skp 文件" });

    try {
      const originalBase = path.basename(
        req.file.originalname,
        path.extname(req.file.originalname)
      );
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_model', 0)`
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

  for (const key of allowed) {
    if (!(key in req.body)) continue;
    let val = req.body[key];
    if (key === "tags" || key === "price_factors") val = JSON.stringify(val);
    if (key === "skin_upgrade_enabled") val = val ? 1 : 0;
    sets.push(`${key} = ?`);
    values.push(val);
  }

  if (req.body.status && req.body.status !== existing.status) {
    if (req.body.status === "published") {
      return res.status(400).json({ error: "请通过审核页「通过并发布」" });
    }
    if (
      (existing.status === "published" || existing.status === "archived") &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ error: "已发布/已下架的模板仅管理员可修改状态" });
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

app.post("/api/templates/:id/bom", ...writeAuth, (req, res) => {
  const template = getTemplate(db, req.params.id);
  if (!template) return res.status(404).json({ error: "模板不存在" });

  const { category, item_name, spec = "", qty = 1, unit = "个", unit_price = 0, note = "" } =
    req.body;

  if (!category || !item_name?.trim()) {
    return res.status(400).json({ error: "请填写类别与项目名称" });
  }

  const maxLine = db
    .prepare("SELECT COALESCE(MAX(line_no), 0) AS m FROM bom_lines WHERE template_id = ?")
    .get(template.id).m;

  const result = db
    .prepare(
      `INSERT INTO bom_lines (template_id, line_no, category, item_name, spec, qty, unit, unit_price, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      template.id,
      maxLine + 1,
      category,
      item_name.trim(),
      spec,
      Number(qty) || 0,
      unit,
      Number(unit_price) || 0,
      note
    );

  const line = db.prepare("SELECT *, (qty * unit_price) AS subtotal FROM bom_lines WHERE id = ?").get(
    result.lastInsertRowid
  );
  res.status(201).json(line);
});

app.patch("/api/bom/:lineId", ...writeAuth, (req, res) => {
  const line = db.prepare("SELECT * FROM bom_lines WHERE id = ?").get(req.params.lineId);
  if (!line) return res.status(404).json({ error: "BOM 行不存在" });

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
  const result = db.prepare("DELETE FROM bom_lines WHERE id = ?").run(req.params.lineId);
  if (result.changes === 0) return res.status(404).json({ error: "BOM 行不存在" });
  res.json({ ok: true });
});

function ensureTemplate(id) {
  const row = db.prepare("SELECT id FROM templates WHERE id = ?").get(id);
  return row ? row.id : null;
}

app.post("/api/templates/:id/profiles", ...writeAuth, (req, res) => {
  const templateId = ensureTemplate(req.params.id);
  if (!templateId) return res.status(404).json({ error: "模板不存在" });
  const { length_inch, qty = 1, coefficient = 1, note = "" } = req.body;
  if (!length_inch) return res.status(400).json({ error: "请填写长度(inch)" });
  const sort = nextSortOrder(db, "quote_profiles", templateId);
  const result = db
    .prepare(
      `INSERT INTO quote_profiles (template_id, length_inch, qty, coefficient, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(templateId, Number(length_inch), Number(qty) || 1, Number(coefficient) || 1, note, sort);
  const row = db.prepare("SELECT * FROM quote_profiles WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ ...row, ...profileLineTotal(row.length_inch, row.qty, row.coefficient) });
});

app.delete("/api/profiles/:lineId", ...writeAuth, (req, res) => {
  const r = db.prepare("DELETE FROM quote_profiles WHERE id = ?").run(req.params.lineId);
  if (r.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ ok: true });
});

app.post("/api/templates/:id/nuts", ...writeAuth, (req, res) => {
  const templateId = ensureTemplate(req.params.id);
  if (!templateId) return res.status(404).json({ error: "模板不存在" });
  const { price_item_id, qty = 1, note = "" } = req.body;
  if (!price_item_id) return res.status(400).json({ error: "请从单价库选择六通型号" });

  const item = getPriceItem(db, price_item_id);
  if (!item || item.category !== "nut") {
    return res.status(400).json({ error: "无效的六通单价项" });
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
  const r = db.prepare("DELETE FROM quote_nuts WHERE id = ?").run(req.params.lineId);
  if (r.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ ok: true });
});

app.post("/api/templates/:id/hardware", ...writeAuth, (req, res) => {
  const templateId = ensureTemplate(req.params.id);
  if (!templateId) return res.status(404).json({ error: "模板不存在" });
  const { price_item_id, qty = 1, note = "" } = req.body;
  if (!price_item_id) return res.status(400).json({ error: "请从单价库选择五金配件" });

  const item = getPriceItem(db, price_item_id);
  if (!item || item.category !== "hardware") {
    return res.status(400).json({ error: "无效的五金单价项" });
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
  const r = db.prepare("DELETE FROM quote_hardware WHERE id = ?").run(req.params.lineId);
  if (r.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ ok: true });
});

app.post("/api/templates/:id/panels", ...writeAuth, (req, res) => {
  const templateId = ensureTemplate(req.params.id);
  if (!templateId) return res.status(404).json({ error: "模板不存在" });
  const { price_item_id, length_inch, width_inch, qty = 1, note = "" } = req.body;

  if (!price_item_id) return res.status(400).json({ error: "请从单价库选择板材规格" });
  if (!length_inch || !width_inch) return res.status(400).json({ error: "请填写长宽(inch)" });

  const item = getPriceItem(db, price_item_id);
  if (!item || item.category !== "panel") {
    return res.status(400).json({ error: "无效的板材单价项" });
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
  const r = db.prepare("DELETE FROM quote_panels WHERE id = ?").run(req.params.lineId);
  if (r.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ ok: true });
});

app.get("/api/pricing/preview-profile", ...readAuth, (req, res) => {
  const { length_inch, qty = 1, coefficient = 1 } = req.query;
  if (!length_inch) return res.status(400).json({ error: "缺少 length_inch" });
  res.json({
    factory_price: profileFactoryPrice(length_inch),
    ...profileLineTotal(length_inch, qty, coefficient)
  });
});

app.get("/api/price-items", ...readAuth, (req, res) => {
  const enabledOnly = req.query.all !== "1";
  res.json(listPriceItems(db, { category: req.query.category, enabledOnly }));
});

app.get("/api/price-items/panel-filters", ...readAuth, (_req, res) => {
  res.json(getPanelFilters(db));
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
    thickness_mm,
    note
  } = req.body;
  if (!category || !label?.trim()) {
    return res.status(400).json({ error: "请填写分类与名称" });
  }
  if (!["nut", "hardware", "panel"].includes(category)) {
    return res.status(400).json({ error: "无效分类" });
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
      thickness_mm,
      note
    })
  );
});

app.patch("/api/price-items/:id", ...priceAdmin, (req, res) => {
  const updated = updatePriceItem(db, req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "记录不存在" });
  res.json(updated);
});

app.delete("/api/price-items/:id", ...priceAdmin, (req, res) => {
  const r = deletePriceItem(db, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ ok: true });
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
    saveAuditArchive({ template, checklist, auditor, auditNote: audit_note });
    db.prepare(
      `UPDATE templates SET
        status = 'published',
        published_at = datetime('now'),
        last_audit_note = ?,
        last_audit_by = ?,
        last_audit_at = datetime('now'),
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(audit_note.trim(), auditor, template.id);
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

  const { reject_reason = "", target_status = "pending_model" } = req.body || {};
  if (!reject_reason.trim()) return res.status(400).json({ error: "请填写退回原因" });
  if (!["pending_model", "pending_quote"].includes(target_status)) {
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
  const template = getTemplate(db, req.params.id);
  if (!template) return res.status(404).json({ error: "模板不存在" });

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
    "可升级",
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
          `${p.length_inch} inch`,
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
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`MR2525 模板库已启动: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  if (HOST === "0.0.0.0") {
    console.log(`局域网访问: http://<本机IP>:${PORT}`);
  }
  console.log(`数据文件: ${path.join(__dirname, "..", "data", "catalog.db")}`);
});
