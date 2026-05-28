let meta = null;
let currentUser = null;
let selectedTags = new Set();
let selectedFactors = new Set();
let currentDetailId = null;

const views = {
  create: { eyebrow: "录入", title: "新建模板", subtitle: "上传 skp 并选择应用场景，系统自动生成编号与名称" },
  list: { eyebrow: "协作", title: "模板列表", subtitle: "查看全部方案，点击进入详情继续协作" },
  published: { eyebrow: "对外", title: "对外展示", subtitle: "已发布方案，可复制信息发给客户" },
  prices: { eyebrow: "定价", title: "单价库", subtitle: "维护六通、五金配件、板材单价；模板详情从此选取" },
  users: { eyebrow: "权限", title: "用户管理", subtitle: "为同事分配管理员 / 编辑 / 只读权限" },
  workflow: { eyebrow: "流程", title: "流程说明", subtitle: "团队协作标准操作流程" },
  detail: { eyebrow: "详情", title: "模板详情", subtitle: "建模、BOM、报价与状态推进" }
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function canWrite() {
  return !!currentUser?.permissions?.canWrite;
}

function canManagePrices() {
  return !!currentUser?.permissions?.canManagePrices;
}

function canManageUsers() {
  return !!currentUser?.permissions?.canManageUsers;
}

function canExport() {
  return !!currentUser?.permissions?.canExport;
}

function canChangeTemplateStatus(templateStatus) {
  if (currentUser?.role === "admin") return true;
  if (templateStatus === "published" || templateStatus === "archived") return false;
  return canWrite();
}

async function downloadExport(path, filename) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "导出失败");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2800);
}

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return "¥" + Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));

  const viewEl = document.getElementById(`view-${name}`);
  if (viewEl) viewEl.classList.add("active");

  const navBtn = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (navBtn) navBtn.classList.add("active");

  const info = views[name] || views.list;
  const eyebrowEl = document.getElementById("page-eyebrow");
  if (eyebrowEl) eyebrowEl.textContent = info.eyebrow || "";
  document.getElementById("page-title").textContent = info.title;
  document.getElementById("page-subtitle").textContent = info.subtitle;
}

function renderChips(containerId, items, selectedSet) {
  const box = document.getElementById(containerId);
  if (!box) return;
  box.innerHTML = items
    .map(
      (t) =>
        `<button type="button" class="chip ${selectedSet.has(t) ? "selected" : ""}" data-value="${t}">${t}</button>`
    )
    .join("");

  box.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const v = chip.dataset.value;
      if (selectedSet.has(v)) selectedSet.delete(v);
      else selectedSet.add(v);
      chip.classList.toggle("selected");
    });
  });
}

function fillSelect(el, options, { emptyLabel } = {}) {
  el.innerHTML = "";
  if (emptyLabel) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = emptyLabel;
    el.appendChild(o);
  }
  for (const opt of options) {
    const o = document.createElement("option");
    if (typeof opt === "string") {
      o.value = opt;
      o.textContent = opt;
    } else {
      o.value = opt.value;
      o.textContent = opt.label || opt.value;
    }
    el.appendChild(o);
  }
}

async function loadMeta() {
  meta = await api("/api/meta");

  fillSelect(
    document.getElementById("scenario-select"),
    meta.scenarios.map((s) => ({ value: s.value, label: `${s.value} (${s.code})` }))
  );

  fillSelect(
    document.getElementById("filter-status"),
    Object.entries(meta.statusLabels).map(([k, v]) => ({ value: k, label: v })),
    { emptyLabel: "全部状态" }
  );
  fillSelect(
    document.getElementById("filter-scenario"),
    meta.scenarios.map((s) => ({ value: s.value, label: s.value })),
    { emptyLabel: "全部场景" }
  );

  renderChips("tags-box", meta.tags, selectedTags);
  renderChips("factors-box", meta.priceFactors, selectedFactors);

  document.getElementById("status-legend").innerHTML = Object.entries(meta.statusLabels)
    .map(([k, v]) => `<span class="badge ${k}">${v}</span>`)
    .join("");

  const roleSelect = document.getElementById("user-role-select");
  if (roleSelect && meta.roles) {
    fillSelect(
      roleSelect,
      meta.roles.map((r) => ({ value: r.id, label: r.label }))
    );
  }
}

async function loadList() {
  const q = document.getElementById("search-input").value.trim();
  const status = document.getElementById("filter-status").value;
  const scenario = document.getElementById("filter-scenario").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (scenario) params.set("scenario", scenario);

  const items = await api("/api/templates?" + params.toString());
  const wrap = document.getElementById("template-table-wrap");

  if (!items.length) {
    wrap.innerHTML = '<div class="empty-state">暂无模板，请先新建。</div>';
    return;
  }

  wrap.innerHTML = `<table>
    <thead><tr>
      <th>编号</th><th>名称</th><th>场景</th><th>状态</th><th>参考价</th><th>负责人</th><th>更新</th>
    </tr></thead>
    <tbody>${items
      .map(
        (t) => `<tr>
        <td class="clickable" data-id="${t.id}">${t.template_code}</td>
        <td class="clickable" data-id="${t.id}">${escapeHtml(t.name)}</td>
        <td>${t.scenario}</td>
        <td><span class="badge ${t.status}">${meta.statusLabels[t.status]}</span></td>
        <td>${fmtMoney(t.price_min)}${t.price_max !== t.price_min ? " – " + fmtMoney(t.price_max) : ""}</td>
        <td>${escapeHtml(t.assignee || "—")}</td>
        <td>${(t.updated_at || "").slice(0, 16)}</td>
      </tr>`
      )
      .join("")}</tbody></table>`;

  wrap.querySelectorAll(".clickable").forEach((el) => {
    el.addEventListener("click", () => openDetail(Number(el.dataset.id)));
  });
}

async function loadPublished() {
  const items = await api("/api/templates?status=published");
  const grid = document.getElementById("published-grid");

  if (!items.length) {
    grid.innerHTML = '<div class="card">暂无已发布模板。请在详情页将状态改为「已发布」。</div>';
    return;
  }

  grid.innerHTML = items
    .map((t) => {
      const cover = t.cover_image
        ? `<img src="${t.cover_image}" alt="" />`
        : "暂无封面";
      return `<article class="pub-card">
        <div class="pub-cover">${t.cover_image ? `<img src="${t.cover_image}" alt="" />` : cover}</div>
        <div class="pub-body">
          <div class="pub-meta">${t.template_code} · ${t.scenario}</div>
          <h3>${escapeHtml(t.name)}</h3>
          <p class="pub-desc">${escapeHtml(t.one_liner || "")}</p>
          <div class="pub-price">${fmtMoney(t.price_min)}${t.price_max !== t.price_min ? " – " + fmtMoney(t.price_max) : ""}</div>
          <div class="pub-dims">
            ${t.width_mm ? `${t.width_mm}×${t.depth_mm}×${t.height_mm} mm · ` : ""}${escapeHtml(t.one_liner || t.panel_note || "")}
          </div>
          <div class="pub-actions">
            <button type="button" class="btn primary" data-copy="${t.id}">复制对外摘要</button>
            ${t.detail_doc_url ? `<a class="btn" href="${escapeHtml(t.detail_doc_url)}" target="_blank" rel="noopener">打开详情链接</a>` : ""}
          </div>
        </div>
      </article>`;
    })
    .join("");

  grid.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const t = items.find((x) => x.id === Number(btn.dataset.copy));
      const text = buildPublicSummary(t);
      await navigator.clipboard.writeText(text);
      toast("已复制对外摘要");
    });
  });
}

function buildPublicSummary(t) {
  const parts = [
    `【${t.name}】${t.template_code}`,
    t.one_liner,
    t.width_mm ? `尺寸：${t.width_mm} × ${t.depth_mm} × ${t.height_mm} mm` : "",
    `皮肤：${t.panel_note || "—"}`
  ];
  if (t.profile_amount || t.nut_amount || t.hardware_amount || t.panel_amount) {
    parts.push(
      `报价构成：型材 ${fmtMoney(t.profile_amount)} / 六通 ${fmtMoney(t.nut_amount)} / 五金 ${fmtMoney(t.hardware_amount)} / 板材 ${fmtMoney(t.panel_amount)}`
    );
  }
  parts.push(
    `参考价：${fmtMoney(t.price_min)}${t.price_max !== t.price_min ? " – " + fmtMoney(t.price_max) : ""}`,
    t.quote_note,
    t.detail_doc_url ? `详情：${t.detail_doc_url}` : "",
    t.inquiry_form_url ? `询单：${t.inquiry_form_url}` : ""
  );
  return parts.filter(Boolean).join("\n");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function openDetail(id) {
  currentDetailId = id;
  switchView("detail");
  document.getElementById("view-detail").classList.add("active");
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));

  const data = await api(`/api/templates/${id}`);
  await renderDetail(data);
}

function renderQuoteBreakdown(q) {
  if (!q) return "";
  return `<div class="breakdown-grid">
    <div class="breakdown-item"><span>MR2525 型材</span><strong>${fmtMoney(q.profileAmount)}</strong></div>
    <div class="breakdown-item"><span>六通</span><strong>${fmtMoney(q.nutAmount)}</strong></div>
    <div class="breakdown-item"><span>五金配件</span><strong>${fmtMoney(q.hardwareAmount)}</strong></div>
    <div class="breakdown-item"><span>板材</span><strong>${fmtMoney(q.panelAmount)}</strong></div>
    <div class="breakdown-item"><span>其他</span><strong>${fmtMoney(q.legacyAmount)}</strong></div>
    <div class="breakdown-item"><span>物料小计</span><strong>${fmtMoney(q.materialCost)}</strong></div>
    <div class="breakdown-item"><span>加工费 (10%)</span><strong>${fmtMoney(q.processAmount)}</strong></div>
    <div class="breakdown-item"><span>对外参考价</span><strong>${fmtMoney(q.totalCost)}</strong></div>
    <div class="breakdown-item"><span>对内成本</span><strong>${fmtMoney(q.internalCost)}</strong></div>
  </div>`;
}

function renderImageGallery(urls) {
  if (!urls?.length) return '<p class="hint">暂无图片</p>';
  return `<div class="gallery">${urls.map((u) => `<a href="${u}" target="_blank"><img src="${u}" alt="" /></a>`).join("")}</div>`;
}

function buildCoverOptions(t) {
  const opts = [];
  (t.photo_images || []).forEach((url, i) => {
    opts.push({ value: `photo:${i}`, label: `实拍 ${i + 1}`, url });
  });
  (t.effect_images || []).forEach((url, i) => {
    opts.push({ value: `effect:${i}`, label: `效果图 ${i + 1}`, url });
  });
  return opts;
}

function renderAuditPanel(t) {
  if (t.status !== "pending_review" || !canWrite()) return "";
  const items = (meta.auditChecklist || []).map(
    (item) =>
      `<label class="audit-check"><input type="checkbox" data-audit-id="${item.id}" /> ${escapeHtml(item.label)}</label>`
  );
  return `
    <div class="card audit-card">
      <h3>审核发布</h3>
      <p class="hint">逐项勾选后点击「通过并发布」，系统将生成审核单并写入 <code>data/uploads/审核存档/</code></p>
      <div class="audit-checklist">${items.join("")}</div>
      <label class="full">审核备注<textarea id="audit-note" rows="2" placeholder="选填"></textarea></label>
      <label class="full">退回原因<textarea id="audit-reject-reason" rows="2" placeholder="退回时必填"></textarea></label>
      <div class="form-actions">
        <button type="button" class="btn success" id="audit-approve">通过并发布</button>
        <button type="button" class="btn" id="audit-reject-quote">退回至待清单报价</button>
        <button type="button" class="btn" id="audit-reject-model">退回至待建模</button>
      </div>
    </div>`;
}

function renderNutTable(lines) {
  if (!lines?.length) {
    return '<p class="hint">暂无六通行。请从单价库选择型号与数量。</p>';
  }
  return `<table>
    <thead><tr><th>型号</th><th>名称</th><th>数量</th><th>单价</th><th>小计</th><th></th></tr></thead>
    <tbody>${lines
      .map(
        (l) => `<tr>
        <td>${escapeHtml(l.nut_model || "—")}</td>
        <td>${escapeHtml(l.item_name)}</td>
        <td>${l.qty}</td><td>${fmtMoney(l.unit_price)}</td><td>${fmtMoney(l.subtotal)}</td>
        <td><button type="button" class="btn danger" data-del-nut="${l.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody>
    <tfoot><tr><td colspan="4" class="tfoot-label">六通小计</td><td colspan="2">${fmtMoney(lines.reduce((s, l) => s + l.subtotal, 0))}</td></tr></tfoot>
  </table>`;
}

function renderProfileTable(lines) {
  if (!lines?.length) {
    return '<p class="hint">暂无型材行。按《海智详细清单》填写各长度(inch)与数量。</p>';
  }
  return `<table>
    <thead><tr>
      <th>长度(in)</th><th>数量</th><th>系数</th><th>出厂参考价</th><th>报价单价</th><th>小计</th><th></th>
    </tr></thead>
    <tbody>${lines
      .map(
        (l) => `<tr>
        <td>${l.length_inch}</td><td>${l.qty}</td><td>${l.coefficient ?? 1}</td>
        <td>${fmtMoney(l.factory_price)}</td><td>${fmtMoney(l.quote_unit)}</td><td>${fmtMoney(l.subtotal)}</td>
        <td><button type="button" class="btn danger" data-del-profile="${l.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody>
    <tfoot><tr><td colspan="5" class="tfoot-label">型材小计</td><td colspan="2">${fmtMoney(lines.reduce((s, l) => s + l.subtotal, 0))}</td></tr></tfoot>
  </table>`;
}

function renderHardwareTable(lines) {
  if (!lines?.length) {
    return '<p class="hint">暂无五金行。请从单价库选择配件。</p>';
  }
  return `<table>
    <thead><tr><th>项目</th><th>规格</th><th>数量</th><th>单价</th><th>小计</th><th></th></tr></thead>
    <tbody>${lines
      .map(
        (l) => `<tr>
        <td>${escapeHtml(l.item_name)}</td><td>${escapeHtml(l.spec || "—")}</td>
        <td>${l.qty}</td><td>${fmtMoney(l.unit_price)}</td><td>${fmtMoney(l.subtotal)}</td>
        <td><button type="button" class="btn danger" data-del-hardware="${l.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody>
    <tfoot><tr><td colspan="4" class="tfoot-label">五金小计</td><td colspan="2">${fmtMoney(lines.reduce((s, l) => s + l.subtotal, 0))}</td></tr></tfoot>
  </table>`;
}

function renderPanelTable(lines) {
  if (!lines?.length) {
    return '<p class="hint">暂无板材行。请按材质/颜色/厚度从单价库选取。</p>';
  }
  return `<table>
    <thead><tr>
      <th>材质</th><th>颜色</th><th>厚度</th><th>长×宽(in)</th><th>面积㎡</th><th>数量</th><th>件单价</th><th>小计</th><th></th>
    </tr></thead>
    <tbody>${lines
      .map(
        (l) => `<tr>
        <td>${escapeHtml(l.material_type || "—")}</td>
        <td>${escapeHtml(l.color || "—")}</td>
        <td>${l.thickness_mm != null ? l.thickness_mm + "mm" : "—"}</td>
        <td>${l.length_inch}×${l.width_inch}</td>
        <td>${(l.area_sqm ?? 0).toFixed(4)}</td><td>${l.qty}</td>
        <td>${fmtMoney(l.unit_price)}</td><td>${fmtMoney(l.subtotal)}</td>
        <td><button type="button" class="btn danger" data-del-panel="${l.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody>
    <tfoot><tr><td colspan="7" class="tfoot-label">板材小计</td><td colspan="2">${fmtMoney(lines.reduce((s, l) => s + l.subtotal, 0))}</td></tr></tfoot>
  </table>`;
}

function priceItemOptions(items, formatter) {
  return items.map((i) => `<option value="${i.id}">${formatter(i)}</option>`).join("");
}

async function renderDetail(t) {
  const [nutItems, hwItems, panelFilters] = await Promise.all([
    api("/api/price-items?category=nut"),
    api("/api/price-items?category=hardware"),
    api("/api/price-items/panel-filters")
  ]);
  const nextStatuses = canChangeTemplateStatus(t.status) ? meta.statusFlow[t.status] || [] : [];
  const statusLocked = !canChangeTemplateStatus(t.status) && (t.status === "published" || t.status === "archived");
  const q = t.quote || {};
  const root = document.getElementById("detail-root");
  const nutOptions = priceItemOptions(
    nutItems,
    (i) => `${i.label}（${i.unit_price}元/${i.unit}）`
  );
  const hwOptions = priceItemOptions(
    hwItems,
    (i) => `${i.label}${i.spec ? " · " + i.spec : ""}（${i.unit_price}元/${i.unit}）`
  );
  const materialOptions = panelFilters.materialTypes
    .map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`)
    .join("");

  const coverOpts = buildCoverOptions(t);
  const coverSelect = coverOpts.length
    ? `<label>封面来源<select id="d-cover-source">${coverOpts
        .map(
          (o) =>
            `<option value="${escapeAttr(o.value)}" ${t.cover_source === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`
        )
        .join("")}</select></label>`
    : `<p class="hint">上传实拍或效果图后可选择封面</p>`;

  root.innerHTML = `
    <div class="card detail-header">
      <div>
        <div class="detail-code">${t.template_code} · ${t.slug}</div>
        <h2>${escapeHtml(t.name)}</h2>
        <span class="badge ${t.status}">${meta.statusLabels[t.status]}</span>
      </div>
      <div class="summary-row">
        <div>参考价 <strong>${fmtMoney(t.price_min)} – ${fmtMoney(t.price_max)}</strong></div>
      </div>
    </div>

    <div class="card">
      <h3>状态推进</h3>
      ${
        t.status === "pending_review"
          ? '<p class="hint">请在下方的 <strong>审核发布</strong> 区域完成 checklist 并发布。</p>'
          : statusLocked
            ? '<p class="hint">当前为「' +
              escapeHtml(meta.statusLabels[t.status]) +
              "」，仅管理员可修改状态。</p>"
            : nextStatuses.length
              ? `<div class="status-actions">${nextStatuses
                  .filter((s) => s !== "published")
                  .map(
                    (s) =>
                      `<button type="button" class="btn primary" data-status="${s}">→ ${meta.statusLabels[s]}</button>`
                  )
                  .join("")}</div>`
              : '<p class="hint">当前状态无可推进的下一步。</p>'
      }
    </div>

    ${renderAuditPanel(t)}

    <div class="card detail-grid">
      <h3 class="full">基本信息</h3>
      <label>名称<input id="d-name" value="${escapeAttr(t.name)}" /></label>
      <label>负责人<input id="d-assignee" value="${escapeAttr(t.assignee)}" readonly title="登记时自动拾取" /></label>
      <label>宽 mm<input id="d-w" type="number" value="${t.width_mm ?? ""}" /></label>
      <label>深 mm<input id="d-d" type="number" value="${t.depth_mm ?? ""}" /></label>
      <label>高 mm<input id="d-h" type="number" value="${t.height_mm ?? ""}" /></label>
      <label>版本<input id="d-version" value="${escapeAttr(t.version)}" /></label>
      <label class="full">一句话卖点<input id="d-liner" value="${escapeAttr(t.one_liner)}" /></label>
      <label class="full">皮肤选配说明<textarea id="d-panel-note" rows="2">${escapeHtml(t.panel_note)}</textarea></label>
      <label class="full">报价口径<textarea id="d-quote-note" rows="2">${escapeHtml(t.quote_note)}</textarea></label>
      <label>参考价下限（留空自动）<input id="d-price-min" type="number" value="${t.price_override_min ?? ""}" /></label>
      <label>参考价上限（留空自动）<input id="d-price-max" type="number" value="${t.price_override_max ?? ""}" /></label>
      <label><input type="checkbox" id="d-skin-upgrade" ${t.skin_upgrade_enabled ? "checked" : ""} /> 可升级（皮肤色差区间）</label>
      ${coverSelect}
      <label class="full">询单表单链接<input id="d-inquiry-url" value="${escapeAttr(t.inquiry_form_url)}" /></label>
      <label class="full">内部备注<textarea id="d-note" rows="2">${escapeHtml(t.internal_note)}</textarea></label>
      <fieldset class="full chip-field">
        <legend>标签</legend>
        <div id="detail-tags-box" class="chips"></div>
      </fieldset>
      <div class="full form-actions"><button type="button" class="btn primary" id="save-detail">保存基本信息</button></div>
    </div>

    <div class="card">
      <h3>文件与图片</h3>
      <p class="hint">资产目录：<code>data/uploads/${escapeHtml(t.template_code)}/</code></p>
      <div class="upload-row">
        <label class="file-btn">实拍照片<input type="file" accept="image/*" data-kind="photo" multiple /></label>
        <label class="file-btn">效果图<input type="file" accept="image/*" data-kind="effect" multiple /></label>
        <label class="file-btn">渲染图<input type="file" accept="image/*" data-kind="render" multiple /></label>
        <label class="file-btn">更新 skp<input type="file" accept=".skp" data-kind="skp" /></label>
      </div>
      ${t.cover_image ? `<p class="hint">当前封面：<a href="${t.cover_image}" target="_blank"><img src="${t.cover_image}" alt="" class="cover-thumb" /></a></p>` : ""}
      ${t.skp_file ? `<p class="hint">skp：<a href="${t.skp_file}" target="_blank">${t.skp_file}</a></p>` : ""}
      <h4>实拍照片（可选）</h4>
      ${renderImageGallery(t.photo_images)}
      <h4>效果图（必填 ≥1）</h4>
      ${renderImageGallery(t.effect_images)}
      <h4>渲染图（必填 ≥1）</h4>
      ${renderImageGallery(t.render_images)}
    </div>

    <div class="card">
      <h3>详细报价清单</h3>
      ${renderQuoteBreakdown(q)}
      <div class="quote-tabs">
        <button type="button" class="quote-tab active" data-quote-tab="profiles">MR2525 型材</button>
        <button type="button" class="quote-tab" data-quote-tab="nuts">六通</button>
        <button type="button" class="quote-tab" data-quote-tab="hardware">五金配件</button>
        <button type="button" class="quote-tab" data-quote-tab="panels">板材</button>
        <button type="button" class="quote-tab" data-quote-tab="legacy">其他</button>
      </div>

      <div class="quote-panel active" data-quote-panel="profiles">
        <p class="formula-hint">${escapeHtml(meta.profileFormulaNote || "")}</p>
        <form id="profile-add-form" class="profile-add">
          <label>长度(in)<input name="length_inch" type="number" step="0.1" required placeholder="如 31.1" /></label>
          <label>数量<input name="qty" type="number" step="1" value="1" /></label>
          <label>系数<input name="coefficient" type="number" step="0.01" value="1" /></label>
          <label>预览出厂价<input id="profile-preview" readonly placeholder="自动计算" /></label>
          <button type="submit" class="btn primary">添加型材</button>
        </form>
        <div id="profile-table">${renderProfileTable(t.quote_profiles)}</div>
      </div>

      <div class="quote-panel" data-quote-panel="nuts">
        <form id="nut-add-form" class="hardware-add">
          <label>六通型号<select name="price_item_id" required><option value="">从单价库选择…</option>${nutOptions}</select></label>
          <label>数量<input name="qty" type="number" step="1" value="1" /></label>
          <button type="submit" class="btn primary">添加</button>
        </form>
        <div id="nut-table">${renderNutTable(t.quote_nuts)}</div>
      </div>

      <div class="quote-panel" data-quote-panel="hardware">
        <form id="hardware-add-form" class="hardware-add">
          <label>配件<select name="price_item_id" required><option value="">从单价库选择…</option>${hwOptions}</select></label>
          <label>数量<input name="qty" type="number" step="1" value="1" /></label>
          <button type="submit" class="btn primary">添加</button>
        </form>
        <div id="hardware-table">${renderHardwareTable(t.quote_hardware)}</div>
      </div>

      <div class="quote-panel" data-quote-panel="panels">
        <p class="formula-hint">${escapeHtml(meta.panelFormulaNote || "")}</p>
        <form id="panel-add-form" class="panel-add">
          <label>材质<select name="material_type" id="panel-mat" required><option value="">选择材质…</option>${materialOptions}</select></label>
          <label>颜色<select name="color" id="panel-color" required disabled><option value="">先选材质</option></select></label>
          <label>厚度<select name="thickness" id="panel-thick" required disabled><option value="">先选颜色</option></select></label>
          <input type="hidden" name="price_item_id" id="panel-price-id" />
          <label>规格<select id="panel-spec" required disabled><option value="">先选厚度</option></select></label>
          <label>长(in)<input name="length_inch" type="number" step="0.1" required /></label>
          <label>宽(in)<input name="width_inch" type="number" step="0.1" required /></label>
          <label>数量<input name="qty" type="number" step="1" value="1" /></label>
          <button type="submit" class="btn primary">添加板材</button>
        </form>
        <div id="panel-table">${renderPanelTable(t.quote_panels)}</div>
      </div>

      <div class="quote-panel" data-quote-panel="legacy">
        <form id="bom-add-form" class="bom-add">
          <label>类别<select name="category">${meta.bomCategories.map((c) => `<option>${c}</option>`).join("")}</select></label>
          <label>项目<input name="item_name" required /></label>
          <label>规格<input name="spec" /></label>
          <label>数量<input name="qty" type="number" step="0.01" value="1" /></label>
          <label>单位<select name="unit">${meta.bomUnits.map((u) => `<option>${u}</option>`).join("")}</select></label>
          <label>单价<input name="unit_price" type="number" step="0.01" value="0" /></label>
          <button type="submit" class="btn primary">添加</button>
        </form>
        <div id="bom-table"></div>
      </div>
    </div>
  `;

  stripDetailEditing(root);
  selectedTags = new Set(t.tags || []);
  if (document.getElementById("detail-tags-box")) {
    renderChips("detail-tags-box", meta.tags, selectedTags);
  }

  if (!canWrite()) {
    renderBomTable(t.bom || []);
    return;
  }

  document.getElementById("save-detail").addEventListener("click", () => saveDetail(t.id));
  root.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => updateStatus(t.id, btn.dataset.status));
  });
  root.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener("change", async () => {
      const files = input.files;
      if (!files?.length) return;
      for (const file of files) {
        await uploadFile(t.id, input.dataset.kind, file);
      }
      input.value = "";
    });
  });

  const approveBtn = document.getElementById("audit-approve");
  if (approveBtn) {
    approveBtn.addEventListener("click", () => submitAudit(t.id, "approve"));
  }
  document.getElementById("audit-reject-quote")?.addEventListener("click", () =>
    submitAudit(t.id, "reject", "pending_quote")
  );
  document.getElementById("audit-reject-model")?.addEventListener("click", () =>
    submitAudit(t.id, "reject", "pending_model")
  );

  const coverSel = document.getElementById("d-cover-source");
  if (coverSel) {
    coverSel.addEventListener("change", async () => {
      await api(`/api/templates/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ cover_source: coverSel.value })
      });
      toast("封面已更新");
      openDetail(t.id);
    });
  }

  root.querySelectorAll(".quote-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      root.querySelectorAll(".quote-tab").forEach((x) => x.classList.remove("active"));
      root.querySelectorAll(".quote-panel").forEach((x) => x.classList.remove("active"));
      tab.classList.add("active");
      root.querySelector(`[data-quote-panel="${tab.dataset.quoteTab}"]`)?.classList.add("active");
    });
  });

  const profileForm = document.getElementById("profile-add-form");
  const previewInput = document.getElementById("profile-preview");
  async function refreshProfilePreview() {
    const len = profileForm.length_inch.value;
    if (!len) return (previewInput.value = "");
    try {
      const p = await api(
        `/api/pricing/preview-profile?length_inch=${encodeURIComponent(len)}&qty=${profileForm.qty.value || 1}&coefficient=${profileForm.coefficient.value || 1}`
      );
      previewInput.value = `出厂 ${p.factory_price} → 单价 ${p.quote_unit}`;
    } catch {
      previewInput.value = "";
    }
  }
  profileForm.length_inch.addEventListener("input", refreshProfilePreview);
  profileForm.qty.addEventListener("input", refreshProfilePreview);
  profileForm.coefficient.addEventListener("input", refreshProfilePreview);

  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api(`/api/templates/${t.id}/profiles`, {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(fd.entries()))
    });
    toast("型材已添加");
    openDetail(t.id);
  });

  document.getElementById("nut-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api(`/api/templates/${t.id}/nuts`, {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(fd.entries()))
    });
    toast("六通已添加");
    openDetail(t.id);
  });

  document.getElementById("hardware-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api(`/api/templates/${t.id}/hardware`, {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(fd.entries()))
    });
    toast("五金已添加");
    openDetail(t.id);
  });

  setupPanelCascade(panelFilters);

  document.getElementById("panel-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const priceId = document.getElementById("panel-price-id").value;
    if (!priceId) {
      toast("请选择完整板材规格", true);
      return;
    }
    const fd = new FormData(e.target);
    const body = {
      price_item_id: Number(priceId),
      length_inch: fd.get("length_inch"),
      width_inch: fd.get("width_inch"),
      qty: fd.get("qty")
    };
    await api(`/api/templates/${t.id}/panels`, { method: "POST", body: JSON.stringify(body) });
    toast("板材已添加");
    openDetail(t.id);
  });

  document.getElementById("bom-add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    addBomLine(t.id, new FormData(e.target));
  });

  root.querySelectorAll("[data-del-profile]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/profiles/${btn.dataset.delProfile}`, { method: "DELETE" });
      toast("已删除");
      openDetail(t.id);
    });
  });
  root.querySelectorAll("[data-del-nut]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/nuts/${btn.dataset.delNut}`, { method: "DELETE" });
      toast("已删除");
      openDetail(t.id);
    });
  });
  root.querySelectorAll("[data-del-hardware]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/hardware/${btn.dataset.delHardware}`, { method: "DELETE" });
      toast("已删除");
      openDetail(t.id);
    });
  });
  root.querySelectorAll("[data-del-panel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/panels/${btn.dataset.delPanel}`, { method: "DELETE" });
      toast("已删除");
      openDetail(t.id);
    });
  });

  renderBomTable(t.bom || []);
}

function stripDetailEditing(root) {
  if (canWrite()) return;
  root.querySelectorAll(".status-actions, .form-actions, form, .upload-row, .btn.danger").forEach((el) => el.remove());
  root.querySelectorAll("input, select, textarea").forEach((el) => {
    el.disabled = true;
  });
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function mergeUnique(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

function hashColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 42%, 52%)`;
}

function colorSwatchValue(name) {
  if (!name) return "#e2e8f0";
  const map = meta?.panelColorSwatches || {};
  return map[name] || hashColor(name);
}

function isClearSwatch(value) {
  return value === "transparent" || (typeof value === "string" && value.startsWith("rgba"));
}

function colorSwatchBlockClass(name) {
  return isClearSwatch(colorSwatchValue(name)) ? "color-swatch-block is-clear" : "color-swatch-block";
}

function colorSwatchBlockStyle(name) {
  const value = colorSwatchValue(name);
  if (isClearSwatch(value)) return `--swatch-color:${value}`;
  return `--swatch-color:${value}`;
}

function renderColorLabel(name) {
  if (!name) return "—";
  return `<span class="color-label"><span class="${colorSwatchBlockClass(name)}" style="${colorSwatchBlockStyle(name)}"></span><span>${escapeHtml(name)}</span></span>`;
}

function initPanelPriceColorField(colors) {
  const input = document.getElementById("panel-color-input");
  const preview = document.getElementById("panel-color-preview");
  const grid = document.getElementById("panel-color-swatches");
  if (!input || !grid) return;

  function syncPreview() {
    const value = input.value.trim();
    if (preview) {
      preview.className = colorSwatchBlockClass(value);
      preview.style.cssText = colorSwatchBlockStyle(value);
      preview.title = value;
    }
    grid.querySelectorAll(".color-swatch").forEach((el) => {
      el.classList.toggle("active", el.dataset.color === value);
    });
  }

  grid.innerHTML = colors
    .map(
      (c) => `<button type="button" class="color-swatch" data-color="${escapeAttr(c)}" title="${escapeHtml(c)}">
        <span class="${colorSwatchBlockClass(c)}" style="${colorSwatchBlockStyle(c)}"></span>
        <span class="color-swatch-name">${escapeHtml(c)}</span>
      </button>`
    )
    .join("");

  grid.querySelectorAll(".color-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      input.value = btn.dataset.color;
      syncPreview();
      input.focus();
    });
  });
  input.addEventListener("input", syncPreview);
  syncPreview();
}

async function saveDetail(id) {
  const body = {
    name: document.getElementById("d-name").value,
    assignee: document.getElementById("d-assignee").value,
    width_mm: numOrNull(document.getElementById("d-w").value),
    depth_mm: numOrNull(document.getElementById("d-d").value),
    height_mm: numOrNull(document.getElementById("d-h").value),
    version: document.getElementById("d-version").value,
    one_liner: document.getElementById("d-liner").value,
    panel_note: document.getElementById("d-panel-note").value,
    quote_note: document.getElementById("d-quote-note").value,
    price_override_min: numOrNull(document.getElementById("d-price-min").value),
    price_override_max: numOrNull(document.getElementById("d-price-max").value),
    skin_upgrade_enabled: document.getElementById("d-skin-upgrade").checked,
    inquiry_form_url: document.getElementById("d-inquiry-url").value,
    internal_note: document.getElementById("d-note").value,
    tags: [...selectedTags]
  };
  const coverSel = document.getElementById("d-cover-source");
  if (coverSel) body.cover_source = coverSel.value;
  try {
    await api(`/api/templates/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    toast("已保存");
    openDetail(id);
  } catch (e) {
    toast(e.message, true);
  }
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

async function updateStatus(id, status) {
  try {
    await api(`/api/templates/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    toast(`状态已更新为：${meta.statusLabels[status]}`);
    openDetail(id);
  } catch (e) {
    toast(e.message, true);
  }
}

async function submitAudit(id, action, targetStatus) {
  try {
    if (action === "approve") {
      const checklist = {};
      document.querySelectorAll("[data-audit-id]").forEach((el) => {
        checklist[el.dataset.auditId] = el.checked;
      });
      await api(`/api/templates/${id}/audit/approve`, {
        method: "POST",
        body: JSON.stringify({
          checklist,
          audit_note: document.getElementById("audit-note")?.value || ""
        })
      });
      toast("审核通过，已发布");
    } else {
      const reason = document.getElementById("audit-reject-reason")?.value || "";
      if (!reason.trim()) {
        toast("请填写退回原因", true);
        return;
      }
      await api(`/api/templates/${id}/audit/reject`, {
        method: "POST",
        body: JSON.stringify({ reject_reason: reason, target_status: targetStatus })
      });
      toast("已退回");
    }
    openDetail(id);
  } catch (e) {
    toast(e.message, true);
  }
}

async function uploadFile(id, kind, file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch(`/api/templates/${id}/upload/${kind}`, {
      method: "POST",
      credentials: "include",
      body: fd
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast("上传成功");
    openDetail(id);
  } catch (e) {
    toast(e.message, true);
  }
}

function renderBomTable(lines) {
  const wrap = document.getElementById("bom-table");
  if (!lines.length) {
    wrap.innerHTML = '<p class="hint">暂无 BOM 行，请添加明细。</p>';
    return;
  }
  const total = lines.reduce((s, l) => s + (l.subtotal || l.qty * l.unit_price), 0);
  wrap.innerHTML = `<table>
    <thead><tr><th>#</th><th>类别</th><th>项目</th><th>规格</th><th>数量</th><th>单位</th><th>单价</th><th>小计</th><th></th></tr></thead>
    <tbody>${lines
      .map(
        (l) => `<tr>
        <td>${l.line_no}</td><td>${l.category}</td><td>${escapeHtml(l.item_name)}</td>
        <td>${escapeHtml(l.spec)}</td><td>${l.qty}</td><td>${l.unit}</td>
        <td>${l.unit_price}</td><td>${fmtMoney(l.subtotal ?? l.qty * l.unit_price)}</td>
        <td><button type="button" class="btn danger" data-del-bom="${l.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody></table>
    <p class="total-row">物料合计：${fmtMoney(total)}</p>`;

  wrap.querySelectorAll("[data-del-bom]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/bom/${btn.dataset.delBom}`, { method: "DELETE" });
      toast("已删除");
      openDetail(currentDetailId);
    });
  });
}

async function addBomLine(templateId, fd) {
  const body = Object.fromEntries(fd.entries());
  body.qty = Number(body.qty);
  body.unit_price = Number(body.unit_price);
  try {
    await api(`/api/templates/${templateId}/bom`, { method: "POST", body: JSON.stringify(body) });
    toast("BOM 行已添加");
    openDetail(templateId);
  } catch (e) {
    toast(e.message, true);
  }
}

function setupPanelCascade(panelFilters) {
  const matEl = document.getElementById("panel-mat");
  const colorEl = document.getElementById("panel-color");
  const thickEl = document.getElementById("panel-thick");
  const specEl = document.getElementById("panel-spec");
  const priceIdEl = document.getElementById("panel-price-id");
  if (!matEl) return;

  function reset(from) {
    if (from <= 1) {
      colorEl.innerHTML = '<option value="">选择颜色…</option>';
      colorEl.disabled = true;
    }
    if (from <= 2) {
      thickEl.innerHTML = '<option value="">选择厚度…</option>';
      thickEl.disabled = true;
    }
    if (from <= 3) {
      specEl.innerHTML = '<option value="">选择规格…</option>';
      specEl.disabled = true;
      priceIdEl.value = "";
    }
  }

  matEl.addEventListener("change", () => {
    reset(1);
    const mat = matEl.value;
    if (!mat || !panelFilters.byMaterial[mat]) return;
    colorEl.disabled = false;
    colorEl.innerHTML =
      '<option value="">选择颜色…</option>' +
      panelFilters.byMaterial[mat].colors.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  });

  colorEl.addEventListener("change", () => {
    reset(2);
    const mat = matEl.value;
    const color = colorEl.value;
    if (!mat || !color) return;
    const items = panelFilters.byMaterial[mat].items.filter((i) => i.color === color);
    const thicknesses = [...new Set(items.map((i) => i.thickness_mm).filter((x) => x != null))].sort(
      (a, b) => a - b
    );
    thickEl.disabled = false;
    thickEl.innerHTML =
      '<option value="">选择厚度…</option>' +
      thicknesses.map((th) => `<option value="${th}">${th}mm</option>`).join("");
  });

  thickEl.addEventListener("change", () => {
    reset(3);
    const mat = matEl.value;
    const color = colorEl.value;
    const thick = Number(thickEl.value);
    if (!mat || !color || Number.isNaN(thick)) return;
    const items = panelFilters.byMaterial[mat].items.filter(
      (i) => i.color === color && i.thickness_mm === thick
    );
    specEl.disabled = false;
    specEl.innerHTML =
      '<option value="">选择规格…</option>' +
      items
        .map((i) => {
          const hint = i.pricing_mode === "fixed" ? `${i.unit_price}元/件` : `${i.unit_price}元/㎡`;
          return `<option value="${i.id}">${escapeHtml(i.label)}（${hint}）</option>`;
        })
        .join("");
  });

  specEl.addEventListener("change", () => {
    priceIdEl.value = specEl.value || "";
  });
}

let priceLibCategory = "nut";

function renderPriceForm(category, panelRows = []) {
  const wrap = document.getElementById("price-form-wrap");
  if (category === "nut") {
    wrap.innerHTML = `<form id="price-add-form" class="hardware-add">
      <label>名称<input name="label" required placeholder="六通 OL2525" /></label>
      <label>型号<input name="nut_model" required placeholder="OL2525" /></label>
      <label>对外单价<input name="unit_price" type="number" step="0.01" required /></label>
      <label>对内单价<input name="unit_price_internal" type="number" step="0.01" placeholder="默认同对外" /></label>
      <button type="submit" class="btn primary">添加六通</button>
    </form>`;
  } else if (category === "hardware") {
    wrap.innerHTML = `<form id="price-add-form" class="hardware-add">
      <label>名称<input name="label" required placeholder="地脚" /></label>
      <label>规格<input name="spec" placeholder="500×20" /></label>
      <label>单位<select name="unit">${meta.bomUnits.map((u) => `<option>${u}</option>`).join("")}</select></label>
      <label>对外单价<input name="unit_price" type="number" step="0.01" required /></label>
      <label>对内单价<input name="unit_price_internal" type="number" step="0.01" placeholder="默认同对外" /></label>
      <button type="submit" class="btn primary">添加五金</button>
    </form>`;
  } else {
    const materials = mergeUnique(
      meta.panelMaterialTypes || [],
      panelRows.map((r) => r.material_type)
    ).sort((a, b) => a.localeCompare(b, "zh-CN"));
    const colors = mergeUnique(
      meta.panelColorSuggestions || [],
      panelRows.map((r) => r.color)
    ).sort((a, b) => a.localeCompare(b, "zh-CN"));
    const matOpts = materials.map((m) => `<option value="${escapeAttr(m)}"></option>`).join("");
    wrap.innerHTML = `<form id="price-add-form" class="panel-price-form">
      <label class="combo-field">
        材质
        <input name="material_type" list="panel-mat-list" required placeholder="选择或输入新材质" autocomplete="off" />
        <datalist id="panel-mat-list">${matOpts}</datalist>
      </label>
      <label>厚度(mm)<input name="thickness_mm" type="number" step="0.1" required /></label>
      <label>计价<select name="pricing_mode"><option value="per_sqm">按㎡</option><option value="fixed">固定件价</option></select></label>
      <label>对外单价<input name="unit_price" type="number" step="0.01" required /></label>
      <label>对内单价<input name="unit_price_internal" type="number" step="0.01" placeholder="默认同对外" /></label>
      <button type="submit" class="btn primary">添加板材</button>
      <div class="panel-color-section">
        <label class="color-field">
          颜色
          <div class="color-input-wrap">
            <span class="color-preview color-swatch-block" id="panel-color-preview"></span>
            <input name="color" id="panel-color-input" required placeholder="点击色块或输入新颜色" autocomplete="off" />
          </div>
        </label>
        <div class="color-swatch-grid" id="panel-color-swatches"></div>
      </div>
    </form>`;
    initPanelPriceColorField(colors);
  }

  document.getElementById("price-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.category = category;
    body.unit = body.unit || (category === "panel" ? "块" : "个");
    if (category === "panel") {
      body.material_type = body.material_type?.trim();
      body.color = body.color?.trim();
      if (!body.material_type || !body.color) {
        toast("请填写材质与颜色", true);
        return;
      }
      if (!body.label) {
        body.label = `${body.material_type} · ${body.color} · ${body.thickness_mm}mm`;
      }
    }
    await api("/api/price-items", { method: "POST", body: JSON.stringify(body) });
    toast("已添加到单价库");
    loadPrices(category);
  });
}

async function loadPrices(category = priceLibCategory) {
  priceLibCategory = category;
  if (!canManagePrices()) {
    document.getElementById("price-form-wrap").innerHTML =
      '<p class="hint">单价库仅管理员可维护。你当前为「' +
      escapeHtml(currentUser?.roleLabel || "只读") +
      "」账号，可在模板详情中从单价库选取，但不可修改单价。</p>";
    document.getElementById("price-table-wrap").innerHTML = "";
    return;
  }
  document.querySelectorAll("#price-lib-tabs .quote-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.priceCat === category);
  });

  const rows = await api(`/api/price-items?category=${category}&all=1`);
  renderPriceForm(category, category === "panel" ? rows : []);
  const wrap = document.getElementById("price-table-wrap");

  if (category === "nut") {
    wrap.innerHTML = `<table><thead><tr><th>名称</th><th>型号</th><th>对外价</th><th>对内价</th><th>启用</th><th></th></tr></thead><tbody>${rows
      .map(
        (r) => `<tr>
        <td><input class="input-full" value="${escapeAttr(r.label)}" data-field="label" data-id="${r.id}" /></td>
        <td><input value="${escapeAttr(r.nut_model)}" data-field="nut_model" data-id="${r.id}" /></td>
        <td><input class="input-narrow" type="number" step="0.01" value="${r.unit_price}" data-field="unit_price" data-id="${r.id}" /></td>
        <td><input class="input-narrow" type="number" step="0.01" value="${r.unit_price_internal ?? r.unit_price}" data-field="unit_price_internal" data-id="${r.id}" /></td>
        <td><input type="checkbox" ${r.enabled ? "checked" : ""} data-field="enabled" data-id="${r.id}" /></td>
        <td><button type="button" class="btn danger" data-del-price="${r.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody></table>`;
  } else if (category === "hardware") {
    wrap.innerHTML = `<table><thead><tr><th>名称</th><th>规格</th><th>单位</th><th>对外价</th><th>对内价</th><th>启用</th><th></th></tr></thead><tbody>${rows
      .map(
        (r) => `<tr>
        <td><input value="${escapeAttr(r.label)}" data-field="label" data-id="${r.id}" /></td>
        <td><input value="${escapeAttr(r.spec)}" data-field="spec" data-id="${r.id}" /></td>
        <td>${r.unit}</td>
        <td><input class="input-narrow" type="number" step="0.01" value="${r.unit_price}" data-field="unit_price" data-id="${r.id}" /></td>
        <td><input class="input-narrow" type="number" step="0.01" value="${r.unit_price_internal ?? r.unit_price}" data-field="unit_price_internal" data-id="${r.id}" /></td>
        <td><input type="checkbox" ${r.enabled ? "checked" : ""} data-field="enabled" data-id="${r.id}" /></td>
        <td><button type="button" class="btn danger" data-del-price="${r.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody></table>`;
  } else {
    wrap.innerHTML = `<table><thead><tr><th>材质</th><th>颜色</th><th>厚度</th><th>计价</th><th>对外价</th><th>对内价</th><th>名称</th><th>启用</th><th></th></tr></thead><tbody>${rows
      .map(
        (r) => `<tr>
        <td>${escapeHtml(r.material_type)}</td>
        <td>${renderColorLabel(r.color)}</td>
        <td>${r.thickness_mm}mm</td>
        <td>${r.pricing_mode === "fixed" ? "件价" : "㎡"}</td>
        <td><input class="input-narrow" type="number" step="0.01" value="${r.unit_price}" data-field="unit_price" data-id="${r.id}" /></td>
        <td><input class="input-narrow" type="number" step="0.01" value="${r.unit_price_internal ?? r.unit_price}" data-field="unit_price_internal" data-id="${r.id}" /></td>
        <td><input class="input-full" value="${escapeAttr(r.label)}" data-field="label" data-id="${r.id}" /></td>
        <td><input type="checkbox" ${r.enabled ? "checked" : ""} data-field="enabled" data-id="${r.id}" /></td>
        <td><button type="button" class="btn danger" data-del-price="${r.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody></table>`;
  }

  wrap.querySelectorAll("[data-field]").forEach((el) => {
    el.addEventListener("change", async () => {
      const id = el.dataset.id;
      const field = el.dataset.field;
      let val = el.type === "checkbox" ? el.checked : el.value;
      if (field === "unit_price" || field === "unit_price_internal") val = Number(val);
      await api(`/api/price-items/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: val }) });
      toast("单价库已更新");
    });
  });
  wrap.querySelectorAll("[data-del-price]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确定删除该单价项？")) return;
      await api(`/api/price-items/${btn.dataset.delPrice}`, { method: "DELETE" });
      toast("已删除");
      loadPrices(category);
    });
  });
}

function initNav() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const view = btn.dataset.view;
      if (view === "prices" && !canManagePrices()) {
        toast("单价库仅管理员可访问", true);
        return;
      }
      if (view === "users" && !canManageUsers()) {
        toast("用户管理仅管理员可访问", true);
        return;
      }
      if (view === "create" && !canWrite()) {
        toast("当前账号为只读，无法新建模板", true);
        return;
      }
      switchView(view);
      if (view === "list") await loadList();
      if (view === "published") await loadPublished();
      if (view === "prices") await loadPrices();
      if (view === "users") await loadUsers();
    });
  });

  document.getElementById("back-to-list").addEventListener("click", () => {
    switchView("list");
    document.querySelector('.nav-item[data-view="list"]').classList.add("active");
    loadList();
  });
}

function initCreateForm() {
  initSkpDropZone();

  document.getElementById("create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const skp = fd.get("skp");
    if (!skp || !skp.name) {
      toast("请选择或拖拽 skp 文件", true);
      return;
    }
    const uploadFd = new FormData();
    uploadFd.append("skp", skp);
    uploadFd.append("scenario", fd.get("scenario"));

    try {
      const res = await fetch("/api/templates/register", {
        method: "POST",
        credentials: "include",
        body: uploadFd
      });
      const t = await res.json();
      if (!res.ok) throw new Error(t.error || "登记失败");

      const panel = document.getElementById("create-result");
      panel.classList.remove("hidden");
      panel.innerHTML = `
        <h3>已登记：${t.template_code}</h3>
        <p>名称：<strong>${escapeHtml(t.name)}</strong> · 负责人：${escapeHtml(t.assignee)} · 状态：${meta.statusLabels[t.status]}</p>
        <p>skp 已保存至 <code>data/uploads/${escapeHtml(t.template_code)}/</code></p>
        <button type="button" class="btn primary" id="goto-detail">打开详情继续补全</button>
      `;
      document.getElementById("goto-detail").addEventListener("click", () => openDetail(t.id));
      e.target.reset();
      resetSkpDropZone();
      toast("模板已登记：" + t.template_code);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function isSkpFile(file) {
  return file && /\.skp$/i.test(file.name);
}

function setSkpFile(file) {
  const input = document.getElementById("skp-input");
  const zone = document.getElementById("skp-drop-zone");
  const inner = document.getElementById("skp-drop-inner");
  const selected = document.getElementById("skp-selected");
  const nameEl = document.getElementById("skp-file-name");

  if (!file) {
    resetSkpDropZone();
    return false;
  }
  if (!isSkpFile(file)) {
    toast("仅支持 .skp 文件", true);
    input.value = "";
    return false;
  }

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;

  nameEl.textContent = file.name;
  inner.classList.add("hidden");
  selected.classList.remove("hidden");
  zone.classList.add("has-file");
  return true;
}

function resetSkpDropZone() {
  const input = document.getElementById("skp-input");
  const zone = document.getElementById("skp-drop-zone");
  const inner = document.getElementById("skp-drop-inner");
  const selected = document.getElementById("skp-selected");

  input.value = "";
  inner.classList.remove("hidden");
  selected.classList.add("hidden");
  zone.classList.remove("has-file", "is-dragover");
}

function initSkpDropZone() {
  const zone = document.getElementById("skp-drop-zone");
  const input = document.getElementById("skp-input");
  const browseBtn = document.getElementById("skp-browse-btn");
  const changeBtn = document.getElementById("skp-change-btn");

  function openPicker() {
    input.click();
  }

  browseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPicker();
  });

  changeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPicker();
  });

  zone.addEventListener("click", (e) => {
    if (e.target.closest(".drop-zone-link")) return;
    if (!zone.classList.contains("has-file")) openPicker();
  });

  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) setSkpFile(file);
  });

  zone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    zone.classList.add("is-dragover");
  });

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("is-dragover");
  });

  zone.addEventListener("dragleave", (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove("is-dragover");
  });

  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) setSkpFile(file);
  });
}

function initListFilters() {
  document.getElementById("refresh-list").addEventListener("click", loadList);
  document.getElementById("search-input").addEventListener("input", debounce(loadList, 300));
  document.getElementById("filter-status").addEventListener("change", loadList);
  document.getElementById("filter-scenario").addEventListener("change", loadList);
}

function initPriceLibrary() {
  document.querySelectorAll("#price-lib-tabs .quote-tab").forEach((tab) => {
    tab.addEventListener("click", () => loadPrices(tab.dataset.priceCat));
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function applyPermissions() {
  const role = currentUser?.roleLabel || "";
  document.getElementById("user-badge").textContent = `${currentUser?.display_name || ""} · ${role}`;

  document.querySelector('.nav-item[data-view="create"]').classList.toggle("hidden", !canWrite());
  document.querySelector('.nav-item[data-view="prices"]').classList.toggle("hidden", !canManagePrices());
  document.querySelector('.nav-item[data-view="users"]').classList.toggle("hidden", !canManageUsers());
  document.getElementById("export-foot").classList.toggle("hidden", !canExport());
}

async function loadUsers() {
  const rows = await api("/api/auth/users");
  const wrap = document.getElementById("users-table-wrap");
  wrap.innerHTML = `<table>
    <thead><tr><th>用户名</th><th>显示名</th><th>角色</th><th>启用</th><th>操作</th></tr></thead>
    <tbody>${rows
      .map(
        (u) => `<tr>
        <td>${escapeHtml(u.username)}</td>
        <td><input value="${escapeAttr(u.display_name)}" data-user-field="display_name" data-user-id="${u.id}" /></td>
        <td><select data-user-field="role" data-user-id="${u.id}">${(meta.roles || [])
          .map((r) => `<option value="${r.id}" ${r.id === u.role ? "selected" : ""}>${escapeHtml(r.label)}</option>`)
          .join("")}</select></td>
        <td><input type="checkbox" ${u.enabled ? "checked" : ""} data-user-field="enabled" data-user-id="${u.id}" ${u.id === currentUser.id ? "disabled" : ""} /></td>
        <td>
          <input type="password" class="input-pass" placeholder="新密码" data-user-pass="${u.id}" />
          <button type="button" class="btn" data-reset-pass="${u.id}">改密</button>
          ${u.id === currentUser.id ? "" : `<button type="button" class="btn danger" data-del-user="${u.id}">删</button>`}
        </td>
      </tr>`
      )
      .join("")}</tbody></table>`;

  wrap.querySelectorAll("[data-user-field]").forEach((el) => {
    el.addEventListener("change", async () => {
      const id = el.dataset.userId;
      const field = el.dataset.userField;
      let val = el.type === "checkbox" ? el.checked : el.value;
      await api(`/api/auth/users/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: val }) });
      toast("用户已更新");
      if (Number(id) === currentUser.id && field === "role") await refreshSession();
    });
  });
  wrap.querySelectorAll("[data-reset-pass]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.resetPass;
      const input = wrap.querySelector(`[data-user-pass="${id}"]`);
      if (!input.value || input.value.length < 6) {
        toast("密码至少 6 位", true);
        return;
      }
      await api(`/api/auth/users/${id}`, { method: "PATCH", body: JSON.stringify({ password: input.value }) });
      input.value = "";
      toast("密码已更新");
    });
  });
  wrap.querySelectorAll("[data-del-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确定删除该用户？")) return;
      await api(`/api/auth/users/${btn.dataset.delUser}`, { method: "DELETE" });
      toast("用户已删除");
      loadUsers();
    });
  });
}

async function refreshSession() {
  const { user } = await api("/api/auth/me");
  currentUser = user;
  applyPermissions();
}

function initAuthUi() {
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { user } = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") })
      });
      currentUser = user;
      document.getElementById("auth-screen").classList.add("hidden");
      await startApp();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    location.reload();
  });

  document.getElementById("export-main-btn").addEventListener("click", async () => {
    try {
      await downloadExport("/api/export/feishu-main", "feishu-模板主表.csv");
    } catch (e) {
      toast(e.message, true);
    }
  });
  document.getElementById("export-bom-btn").addEventListener("click", async () => {
    try {
      await downloadExport("/api/export/feishu-bom", "feishu-报价底表.csv");
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("user-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/users", {
        method: "POST",
        body: JSON.stringify({
          username: fd.get("username"),
          password: fd.get("password"),
          display_name: fd.get("display_name"),
          role: fd.get("role")
        })
      });
      e.target.reset();
      toast("用户已创建");
      loadUsers();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function startApp() {
  initNav();
  initCreateForm();
  initListFilters();
  initPriceLibrary();
  await loadMeta();
  currentUser = meta.currentUser || currentUser;
  applyPermissions();
  if (!canWrite()) switchView("list");
}

async function boot() {
  initAuthUi();
  try {
    const { user } = await api("/api/auth/me");
    currentUser = user;
    document.getElementById("auth-screen").classList.add("hidden");
    await startApp();
  } catch {
    document.getElementById("auth-screen").classList.remove("hidden");
  }
}

boot();
