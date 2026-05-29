let meta = null;
let currentUser = null;
let selectedTags = new Set();
let selectedFactors = new Set();
let listTagFilters = [];
let listFilterDropdownItems = [];
let listFilterDropdownHighlight = -1;
let listFilterSearchTimer = null;
let listFilterAbort = null;
let detailTemplateTags = [];
let tagDropdownItems = [];
let tagDropdownHighlight = -1;
let tagSearchTimer = null;
let tagEditorAbort = null;
let currentDetailId = null;
let selectedSkpFile = null;
let activeQuoteTab = "profiles";
let lastPanelSelection = null;
let selectedCreateScenario = null;
let currentScenarioId = null;
let currentScenarioImageId = null;
let markerEditState = null;
let selectedMarkerId = null;
let markerTemplateOptions = [];
let markerRefreshGen = 0;
let markerLoadGen = 0;
let markerEditorAbort = null;
let markerCreateLock = false;
let markerDragSaveLock = false;
let markerSuppressCreateUntil = 0;
let markerAdding = false;
let markerDrag = null;
let markerJustDragged = false;
let pendingScenarioCoverFile = null;
let galleryPreviewEl = null;
let galleryPublishedItems = [];
let gallerySelectedIds = new Set();

const views = {
  create: { eyebrow: "录入", title: "新建模板", subtitle: "上传 skp 并选择应用场景，系统自动生成编号与名称" },
  list: { eyebrow: "协作", title: "模板列表", subtitle: "查看全部方案，点击进入详情继续协作" },
  published: { eyebrow: "图册", title: "模板图册", subtitle: "已发布方案展示，可下载展示图、方案手册 PDF 与内部清单 CSV" },
  scenarios: { eyebrow: "场景", title: "场景库", subtitle: "按场景浏览组合方案，下载场景手册" },
  tags: { eyebrow: "标签", title: "标签库", subtitle: "按标签浏览模板，字号表示关联数量" },
  "scenario-detail": { eyebrow: "场景", title: "场景详情", subtitle: "管理场景图片与模板标记" },
  "scenario-markers": { eyebrow: "场景", title: "标记编辑", subtitle: "在场景图上标注关联模板" },
  prices: { eyebrow: "定价", title: "单价库", subtitle: "维护型材公式、六通、五金、板材与非标件单价" },
  users: { eyebrow: "权限", title: "用户管理", subtitle: "为同事分配管理员 / 编辑 / 只读权限" },
  workflow: { eyebrow: "流程", title: "流程说明", subtitle: "新同事上手指南 · 分工 · 状态 · 流程图" },
  detail: { eyebrow: "详情", title: "模板详情", subtitle: "建模、BOM、报价与状态推进" }
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    const err = new Error(data.error || data.message || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (path.startsWith("/api/") && res.ok && !ct.includes("application/json")) {
    throw new Error("接口未返回 JSON，请重启服务（坚果云目录 npm start）后 Ctrl+F5");
  }
  return data;
}

/** @returns {Array<{id:number,name:string,template_count:number}>|null} */
function asTagRows(data) {
  return Array.isArray(data) ? data : null;
}

async function fetchTagRows({ q, limit } = {}) {
  let data;
  if (q) {
    data = await api(`/api/tags?q=${encodeURIComponent(q)}&limit=${limit || 20}`);
  } else if (limit) {
    try {
      data = await api(`/api/tags/top?limit=${limit}`);
    } catch {
      data = await api("/api/tags");
    }
  } else {
    data = await api("/api/tags");
  }
  const rows = asTagRows(data);
  if (!rows) {
    throw new Error("标签库接口未就绪，请在坚果云目录重启 npm start 后 Ctrl+F5");
  }
  if (limit && !q) return rows.slice(0, limit);
  return rows;
}

function canAdmin() {
  return currentUser?.role === "admin";
}

function canWrite() {
  return !!currentUser?.permissions?.canWrite;
}

function canManagePrices() {
  return !!currentUser?.permissions?.canManagePrices;
}

function profileColorSelectHtml(selected) {
  const colors = meta.profileColors || [];
  if (!colors.length) {
    return '<option value="">暂无可用颜色</option>';
  }
  return colors
    .map(
      (c) =>
        `<option value="${escapeAttr(c)}"${c === selected ? " selected" : ""}>${escapeHtml(c)}</option>`
    )
    .join("");
}

function canManageUsers() {
  return !!currentUser?.permissions?.canManageUsers;
}

function canExport() {
  return !!currentUser?.permissions?.canExport;
}

function canEditTemplateContent(template) {
  return canWrite() && template?.status !== "published";
}

function canChangeTemplateStatus(templateStatus) {
  if (templateStatus === "published") return canWrite();
  if (currentUser?.role === "admin") return true;
  if (templateStatus === "archived") return canWrite();
  return canWrite();
}

/** 状态推进区展示的下一步（待审核→已发布走审核面板，不在此重复） */
function getStatusActionTargets(currentStatus, nextStatuses) {
  return (nextStatuses || []).filter((s) => {
    if (s === "published" && currentStatus === "pending_review") return false;
    if (currentStatus === "published") return s === "archived";
    return true;
  });
}

function getStatusActionLabel(targetStatus, currentStatus) {
  if (currentStatus === "published" && targetStatus === "archived") return "下架";
  return `→ ${meta.statusLabels[targetStatus] || targetStatus}`;
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

let workflowMermaidReady = false;

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

  if (name === "workflow") {
    renderWorkflowPage();
    void renderWorkflowDiagrams();
  }
}

async function renderWorkflowDiagrams() {
  if (!window.mermaid) return;
  const root = document.getElementById("workflow-root");
  if (!root) return;
  if (!workflowMermaidReady) {
    mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
    workflowMermaidReady = true;
  }
  const nodes = root.querySelectorAll(".mermaid:not([data-processed])");
  if (!nodes.length) return;
  try {
    await mermaid.run({ nodes });
  } catch (e) {
    console.warn("Mermaid render failed", e);
  }
}

function renderWorkflowPage() {
  const root = document.getElementById("workflow-root");
  if (!root || !meta) return;

  const statusBadges = Object.entries(meta.statusLabels || {})
    .map(([k, v]) => `<span class="badge ${k}">${escapeHtml(v)}</span>`)
    .join("");

  const role = currentUser?.role || "viewer";
  const roleTips = {
    admin: "维护单价库与用户；可审核、下架与重新上架。",
    editor: "新建模板、补全 BOM 与图片、提交审核；可导出 CSV。",
    viewer: "浏览列表、详情、图册与场景库；不可改价与编辑。"
  };

  root.innerHTML = `
    <div class="card workflow-card workflow-intro">
      <h2>协作流程 · 上手指南</h2>
      <p>本地库负责 <strong>录入、算价、审核</strong>；飞书画册与模板图册负责 <strong>对外展示</strong>。完整规范见仓库 <code>docs/MR2525模板库协作SOP.md</code>。</p>
      <p class="hint workflow-you">你当前为 <strong>${escapeHtml(currentUser?.roleLabel || "只读")}</strong>：${escapeHtml(roleTips[role] || roleTips.viewer)}</p>
    </div>

    <div class="workflow-role-grid">
      <div class="card workflow-role-card">
        <h3>录入员</h3>
        <ol>
          <li><strong>新建模板</strong> → 上传 skp → 选场景</li>
          <li>详情：图片、尺寸、<strong>详细报价清单</strong>、标签</li>
          <li>保存基本信息 → <strong>→ 待审核</strong></li>
        </ol>
      </div>
      <div class="card workflow-role-card">
        <h3>审核员</h3>
        <ol>
          <li>打开模板 <strong>审核页</strong></li>
          <li>勾选 checklist（与 skp/BOM 一致）</li>
          <li><strong>通过并发布</strong> 或退回待清单深化</li>
        </ol>
      </div>
      <div class="card workflow-role-card">
        <h3>销售 / 对外</h3>
        <ol>
          <li>已发布后 <strong>导出主表 CSV</strong> → 飞书</li>
          <li>分享 <strong>画册视图</strong> 链接给客户</li>
          <li>客户询单后出正式报价（≠参考价）</li>
        </ol>
      </div>
    </div>

    <div class="card workflow-card">
      <h3>模板状态</h3>
      <div class="status-legend">${statusBadges}</div>
      <table class="workflow-status-table">
        <thead><tr><th>状态</th><th>说明</th></tr></thead>
        <tbody>
          <tr><td><span class="badge pending_quote">待清单深化</span></td><td>补全图片、尺寸、报价清单、标签</td></tr>
          <tr><td><span class="badge pending_review">待审核</span></td><td>审核页 checklist → 通过并发布</td></tr>
          <tr><td><span class="badge published">已发布</span></td><td><strong>仅可改标签</strong>；其它须先点 <strong>下架</strong></td></tr>
          <tr><td><span class="badge archived">已下架</span></td><td>可编辑；<strong>重新上架</strong> → 待审核（再发布版本 +0.1）</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card workflow-card workflow-diagram-card">
      <h3>已发布：修改与版本号</h3>
      <div class="mermaid workflow-diagram">
flowchart TD
  Pub[已发布] --> Tag[仅改标签]
  Pub --> Off[下架]
  Off --> Edit[编辑全部内容]
  Edit --> Relist[重新上架待审核]
  Relist --> Approve[审核通过]
  Approve --> Pub2[已发布 版本+0.1]
  Edit --> Skp[更换skp模型]
  Skp --> Ver[版本+1]
      </div>
      <table class="workflow-version-table">
        <thead><tr><th>触发</th><th>版本变化</th><th>示例</th></tr></thead>
        <tbody>
          <tr><td>首次审核发布</td><td>规范为 v主.次</td><td>v1 → v1.0</td></tr>
          <tr><td>再次审核发布</td><td><strong>+0.1</strong></td><td>v1.0 → v1.1</td></tr>
          <tr><td>下架后更换 skp</td><td><strong>+1</strong>（次版本归零）</td><td>v1.2 → v2.0</td></tr>
        </tbody>
      </table>
      <p class="hint">详情页「版本」只读；完整说明见 <code>docs/TEMPLATE-LIST-UPDATES.md</code> §7、<code>docs/WORKFLOW.md</code> §6。</p>
    </div>

    <div class="card workflow-card workflow-diagram-card">
      <h3>主流程</h3>
      <div class="mermaid workflow-diagram">
flowchart TD
  A[录入员：上传 skp 登记] --> B[系统生成 TPL-场景-序号-文件名]
  B --> C[待清单深化]
  C --> D[补全图·尺寸·报价清单·标签]
  D --> E[待审核]
  E -->|通过| F[已发布]
  E -->|退回| C
  F --> G[图册手册·清单·飞书]
  G --> H[客户询单]
  F --> I[已下架]
  I --> J[重新上架]
  J --> E
      </div>
    </div>

    <div class="card workflow-card workflow-diagram-card">
      <h3>状态流转</h3>
      <div class="mermaid workflow-diagram">
stateDiagram-v2
  [*] --> pending_quote: skp登记
  pending_quote --> pending_review: 提交审核
  pending_review --> published: 审核通过
  pending_review --> pending_quote: 退回
  published --> archived: 下架
  archived --> pending_review: 重新上架
      </div>
    </div>

    <div class="card workflow-card workflow-diagram-card">
      <h3>分工泳道</h3>
      <div class="mermaid workflow-diagram">
flowchart LR
  subgraph R[录入员]
    R1[skp登记] --> R2[BOM与图片] --> R3[待审核]
  end
  subgraph A[审核员]
    A1[checklist] --> A2[发布或退回]
  end
  subgraph S[销售]
    S1[飞书画册] --> S2[客户询单]
  end
  R3 --> A1 --> A2 --> S1
      </div>
    </div>

    <div class="card workflow-card workflow-diagram-card">
      <h3>详情 · 详细报价清单</h3>
      <div class="mermaid workflow-diagram">
flowchart TB
  D[模板详情] --> B1[基本信息]
  B1 --> B2[标签 hash打标]
  B2 --> B3[三类图片]
  B3 --> Q[详细报价清单]
  Q --> P1[型材 颜色+长度]
  Q --> P2[六通]
  Q --> P3[五金]
  Q --> P4[板材]
  Q --> P5[其他]
      </div>
    </div>

    <div class="card workflow-card workflow-diagram-card">
      <h3>对外交付</h3>
      <div class="mermaid workflow-diagram">
flowchart LR
  L[本地模板库] --> G[图册 PNG/手册PDF]
  L --> C[飞书主表CSV]
  C --> F[飞书画册]
  G --> U[客户浏览]
  F --> U
  U --> Q[询单]
      </div>
    </div>

    <div class="card workflow-card">
      <h3>模板图册 · 下载与批量</h3>
      <table class="workflow-status-table">
        <thead><tr><th>按钮</th><th>内容</th><th>权限</th></tr></thead>
        <tbody>
          <tr><td>下载图片</td><td>合成展示图 PNG</td><td>登录可读</td></tr>
          <tr><td>下载手册</td><td>对外方案 PDF（<code>{编号}_手册.pdf</code>）</td><td>登录可读</td></tr>
          <tr><td>下载清单</td><td>内部 BOM CSV（对内/对外价、供应商、链接）</td><td>导出权限</td></tr>
          <tr><td>批量</td><td>勾选或全选 → 一键 zip 图片/手册、合并 csv</td><td>清单需导出权限</td></tr>
        </tbody>
      </table>
      <p class="hint">详见 <code>docs/GALLERY-UPDATES.md</code> · <code>docs/WORKFLOW.md</code> §8.1</p>
    </div>

    <div class="card workflow-card">
      <h3>操作步骤（录入 → 审核 → 对外）</h3>
      <ol class="flow-steps">
        <li><strong>登记</strong>：新建模板 → 上传 skp → 选场景 → 系统生成编号（格式 <code>TPL-场景-序号-文件名</code>），进入<strong>待清单深化</strong>。</li>
        <li><strong>深化</strong>：上传实拍（可选）/ 效果图 / 渲染图；填宽×深×高；在报价清单录入型材（含颜色）、六通、五金、板材；<code>#</code> 打标签；填一句话卖点与报价口径；核对参考价 → <strong>→ 待审核</strong>。</li>
        <li><strong>审核</strong>：审核员在审核页勾选 checklist → <strong>通过并发布</strong>（生成审核单 PNG + 台账 CSV；非首次发布时版本 <strong>+0.1</strong>）或退回。</li>
        <li><strong>已发布维护</strong>：仅可改标签并「保存标签」；要改 BOM/图片等须 <strong>下架</strong> → 编辑 → 重新上架 → 再审核。</li>
        <li><strong>对外</strong>：<strong>模板图册</strong>下载展示图、<strong>方案手册</strong> PDF；有导出权限者可下内部<strong>清单</strong> CSV 并批量打包；<strong>导出主表 CSV</strong> 更新飞书；销售分享画册链接。</li>
      </ol>
    </div>

    <div class="card workflow-card workflow-links">
      <h3>延伸阅读</h3>
      <ul class="workflow-doc-list">
        <li>已发布只读 / 下架 / 版本号 — <code>docs/TEMPLATE-LIST-UPDATES.md</code> §7 · <code>docs/WORKFLOW.md</code> §6</li>
        <li>单价库（型材颜色、五金/板材）— <code>docs/PRICE-LIB-UPDATES.md</code></li>
        <li>标签库与列表筛选 — <code>docs/TAG-LIB-UPDATES.md</code></li>
        <li>详情基本信息栏 — <code>docs/DETAIL-BASIC-INFO-UPDATES.md</code></li>
        <li>模板图册（手册 / 清单 / 批量）— <code>docs/GALLERY-UPDATES.md</code> · <code>docs/WORKFLOW.md</code> §8.1</li>
        <li>飞书搭建 — <code>docs/FEISHU-SETUP.md</code></li>
      </ul>
      <p class="hint">数据：<code>data/catalog.db</code> · 附件：<code>data/uploads/&#123;模板编号&#125;/</code> · 审核存档：<code>data/uploads/审核存档/</code></p>
    </div>
  `;
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

  renderWorkflowPage();

  const roleSelect = document.getElementById("user-role-select");
  if (roleSelect && meta.roles) {
    fillSelect(
      roleSelect,
      meta.roles.map((r) => ({ value: r.id, label: r.label }))
    );
  }
}

function addListFilterTag(name) {
  const n = normalizeTagInput(name);
  if (!n) return false;
  if (listTagFilters.includes(n)) {
    toast("该标签已在筛选中");
    return false;
  }
  listTagFilters.push(n);
  renderListFilterPills();
  loadList();
  return true;
}

function removeListFilterTag(name) {
  listTagFilters = listTagFilters.filter((t) => t !== name);
  renderListFilterPills();
  loadList();
}

function clearListFilterTags() {
  listTagFilters = [];
  const input = document.getElementById("list-tag-filter-input");
  if (input) input.value = "";
  closeListFilterDropdown();
  renderListFilterPills();
  loadList();
}

function renderListFilterPills() {
  const box = document.getElementById("list-tag-filter-pills");
  const clearBtn = document.getElementById("clear-list-tags");
  if (!box) return;
  if (!listTagFilters.length) {
    box.innerHTML = '<span class="hint list-tag-filter-empty">未选标签</span>';
    clearBtn?.classList.add("hidden");
    return;
  }
  clearBtn?.classList.remove("hidden");
  box.innerHTML = listTagFilters
    .map(
      (name) =>
        `<span class="tag-pill tag-pill-filter">#${escapeHtml(name)}<button type="button" class="tag-pill-remove" data-list-filter-remove="${escapeAttr(name)}" aria-label="移除">×</button></span>`
    )
    .join("");
  box.querySelectorAll("[data-list-filter-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeListFilterTag(btn.dataset.listFilterRemove));
  });
}

let listFilterDropdownPositionHandler = null;

function getListTagFilterDropdownHome() {
  return document.querySelector(".list-tag-filter-compose");
}

function syncListFilterDropdownPosition() {
  const input = document.getElementById("list-tag-filter-input");
  const dd = document.getElementById("list-tag-filter-dropdown");
  if (!input || !dd || dd.hidden) return;
  if (dd.parentElement !== document.body) {
    document.body.appendChild(dd);
  }
  const r = input.getBoundingClientRect();
  dd.style.position = "fixed";
  dd.style.left = `${Math.round(r.left)}px`;
  dd.style.top = `${Math.round(r.bottom + 2)}px`;
  dd.style.width = `${Math.max(Math.round(r.width), 260)}px`;
  dd.style.maxWidth = "420px";
  dd.style.margin = "0";
  dd.style.right = "auto";
  dd.style.bottom = "auto";
  document.querySelector("#view-list .list-toolbar")?.classList.add("is-tag-dropdown-open");
}

function resetListFilterDropdownLayout() {
  const dd = document.getElementById("list-tag-filter-dropdown");
  const home = getListTagFilterDropdownHome();
  document.querySelector("#view-list .list-toolbar")?.classList.remove("is-tag-dropdown-open");
  if (listFilterDropdownPositionHandler) {
    window.removeEventListener("scroll", listFilterDropdownPositionHandler, true);
    window.removeEventListener("resize", listFilterDropdownPositionHandler);
    listFilterDropdownPositionHandler = null;
  }
  if (!dd) return;
  if (home && dd.parentElement === document.body) {
    home.appendChild(dd);
  }
  dd.style.position = "";
  dd.style.left = "";
  dd.style.top = "";
  dd.style.width = "";
  dd.style.maxWidth = "";
  dd.style.margin = "";
  dd.style.right = "";
  dd.style.bottom = "";
}

function closeListFilterDropdown() {
  const dd = document.getElementById("list-tag-filter-dropdown");
  if (dd) {
    dd.hidden = true;
    dd.classList.remove("is-open");
  }
  listFilterDropdownHighlight = -1;
  resetListFilterDropdownLayout();
}

function renderListFilterDropdown(items, query) {
  const dd = document.getElementById("list-tag-filter-dropdown");
  if (!dd) return;
  listFilterDropdownItems = items;
  const q = normalizeTagInput(query ?? "");
  const exact = q && items.some((t) => t.name.toLowerCase() === q.toLowerCase());
  let html = items
    .map(
      (t, i) =>
        `<button type="button" class="tag-dropdown-option${i === listFilterDropdownHighlight ? " is-active" : ""}" data-list-filter-pick="${escapeAttr(t.name)}">
      <span>#${escapeHtml(t.name)}</span>
      <span class="tag-dropdown-count">${t.template_count} 个模板</span>
    </button>`
    )
    .join("");
  if (q && !exact) {
    html += `<button type="button" class="tag-dropdown-option tag-dropdown-create${listFilterDropdownHighlight === items.length ? " is-active" : ""}" data-list-filter-create="1">
      <span>添加「#${escapeHtml(q)}」</span>
    </button>`;
  }
  if (!html) {
    closeListFilterDropdown();
    return;
  }
  dd.innerHTML = html;
  dd.hidden = false;
  dd.classList.add("is-open");
  dd.querySelectorAll("[data-list-filter-pick]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      addListFilterTag(btn.dataset.listFilterPick);
      document.getElementById("list-tag-filter-input").value = "";
      closeListFilterDropdown();
    });
  });
  dd.querySelector("[data-list-filter-create]")?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    addListFilterTag(q);
    document.getElementById("list-tag-filter-input").value = "";
    closeListFilterDropdown();
  });
  syncListFilterDropdownPosition();
  if (!listFilterDropdownPositionHandler) {
    listFilterDropdownPositionHandler = () => syncListFilterDropdownPosition();
    window.addEventListener("scroll", listFilterDropdownPositionHandler, true);
    window.addEventListener("resize", listFilterDropdownPositionHandler);
  }
}

async function searchListFilterTags(query) {
  const q = normalizeTagInput(query ?? "");
  try {
    const items = await fetchTagRows({ q: q || undefined, limit: 20 });
    const filtered = items.filter((t) => !listTagFilters.includes(t.name));
    listFilterDropdownHighlight = filtered.length || q ? 0 : -1;
    renderListFilterDropdown(filtered, q);
  } catch (e) {
    toast(e.message, true);
    closeListFilterDropdown();
  }
}

function bindListTagFilter() {
  closeListFilterDropdown();
  if (listFilterAbort) listFilterAbort.abort();
  listFilterAbort = new AbortController();
  const { signal } = listFilterAbort;
  const input = document.getElementById("list-tag-filter-input");
  if (!input) return;

  renderListFilterPills();
  document.getElementById("clear-list-tags")?.addEventListener(
    "click",
    () => clearListFilterTags(),
    { signal }
  );

  const schedule = () => {
    clearTimeout(listFilterSearchTimer);
    const query = getTagQueryFromInput(input.value);
    if (query == null) {
      closeListFilterDropdown();
      return;
    }
    listFilterSearchTimer = setTimeout(() => searchListFilterTags(query), 80);
  };

  input.addEventListener("input", schedule, { signal });
  input.addEventListener("compositionend", schedule, { signal });

  input.addEventListener(
    "keydown",
    (e) => {
      const query = getTagQueryFromInput(input.value);
      const dd = document.getElementById("list-tag-filter-dropdown");
      const open = dd && !dd.hidden;
      const q = query == null ? "" : query;
      const createRow =
        q && !listFilterDropdownItems.some((t) => t.name.toLowerCase() === q.toLowerCase());
      const total = listFilterDropdownItems.length + (createRow ? 1 : 0);

      if (e.key === "ArrowDown" && open && total) {
        e.preventDefault();
        listFilterDropdownHighlight = (listFilterDropdownHighlight + 1) % total;
        renderListFilterDropdown(listFilterDropdownItems, q);
        return;
      }
      if (e.key === "ArrowUp" && open && total) {
        e.preventDefault();
        listFilterDropdownHighlight = (listFilterDropdownHighlight - 1 + total) % total;
        renderListFilterDropdown(listFilterDropdownItems, q);
        return;
      }
      if (e.key === "Escape") {
        closeListFilterDropdown();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (query == null) return;
        if (open && listFilterDropdownHighlight >= 0 && listFilterDropdownHighlight < listFilterDropdownItems.length) {
          addListFilterTag(listFilterDropdownItems[listFilterDropdownHighlight].name);
        } else if (q) {
          const match = listFilterDropdownItems.find((t) => t.name.toLowerCase() === q.toLowerCase());
          addListFilterTag(match ? match.name : q);
        } else {
          return;
        }
        input.value = "";
        closeListFilterDropdown();
      }
    },
    { signal }
  );

  document.addEventListener(
    "click",
    (e) => {
      if (
        !e.target.closest(".list-tag-filter-compose") &&
        !e.target.closest("#list-tag-filter-dropdown")
      ) {
        closeListFilterDropdown();
      }
    },
    { signal }
  );
}

function openTemplatesByTag(tagName) {
  const n = normalizeTagInput(tagName);
  if (!n) return;
  if (!listTagFilters.includes(n)) listTagFilters.push(n);
  switchView("list");
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
  document.querySelector('.nav-item[data-view="list"]')?.classList.add("active");
  renderListFilterPills();
  loadList();
}

async function loadTagCloud() {
  const cloud = document.getElementById("tag-cloud");
  const empty = document.getElementById("tag-cloud-empty");
  if (!cloud) return;
  let tags;
  try {
    tags = await fetchTagRows();
  } catch (e) {
    toast(e.message, true);
    cloud.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  if (!tags.length) {
    cloud.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");
  const counts = tags.map((t) => t.template_count);
  const max = Math.max(...counts, 1);
  const min = Math.min(...counts.filter((c) => c > 0), 0);
  const minPx = 13;
  const maxPx = 36;
  cloud.innerHTML = tags
    .map((t) => {
      const c = t.template_count;
      let size = minPx;
      if (max > min && c > 0) {
        size = minPx + ((c - min) / (max - min)) * (maxPx - minPx);
      } else if (c > 0) {
        size = (minPx + maxPx) / 2;
      }
      return `<button type="button" class="tag-cloud-item" data-tag="${escapeAttr(t.name)}" style="font-size:${size.toFixed(1)}px" title="${escapeAttr(t.name)} · ${c} 个模板">#${escapeHtml(t.name)}<span class="tag-cloud-count">${c}</span></button>`;
    })
    .join("");
  cloud.querySelectorAll(".tag-cloud-item").forEach((btn) => {
    btn.addEventListener("click", () => openTemplatesByTag(btn.dataset.tag));
  });
}

function normalizeTagInput(raw) {
  if (raw == null) return "";
  let s = String(raw).trim().replace(/^#+/, "").trim();
  s = s.replace(/\s+/g, " ");
  return s.length > 40 ? s.slice(0, 40) : s;
}

function getTagQueryFromInput(value) {
  const v = value || "";
  const hash = v.indexOf("#");
  if (hash === -1) return null;
  return normalizeTagInput(v.slice(hash + 1));
}

function renderDetailTagPills() {
  const box = document.getElementById("tag-editor-pills");
  if (!box) return;
  if (!detailTemplateTags.length) {
    box.innerHTML = '<span class="hint">尚未添加标签</span>';
    return;
  }
  box.innerHTML = detailTemplateTags
    .map(
      (name) =>
        `<span class="tag-pill">#${escapeHtml(name)}<button type="button" class="tag-pill-remove" data-remove-tag="${escapeAttr(name)}" aria-label="移除标签">×</button></span>`
    )
    .join("");
  box.querySelectorAll("[data-remove-tag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      detailTemplateTags = detailTemplateTags.filter((n) => n !== btn.dataset.removeTag);
      renderDetailTagPills();
    });
  });
}

function addDetailTag(name) {
  const n = normalizeTagInput(name);
  if (!n) return false;
  if (detailTemplateTags.includes(n)) {
    toast("标签已存在");
    return false;
  }
  detailTemplateTags.push(n);
  renderDetailTagPills();
  return true;
}

function closeTagDropdown() {
  const dd = document.getElementById("tag-editor-dropdown");
  if (dd) {
    dd.hidden = true;
    dd.classList.remove("is-open");
  }
  tagDropdownHighlight = -1;
}

function renderTagDropdown(items, query) {
  const dd = document.getElementById("tag-editor-dropdown");
  if (!dd) return;
  tagDropdownItems = items;
  const q = normalizeTagInput(query ?? "");
  const exact = q && items.some((t) => t.name.toLowerCase() === q.toLowerCase());
  let html = items
    .map(
      (t, i) =>
        `<button type="button" class="tag-dropdown-option${i === tagDropdownHighlight ? " is-active" : ""}" data-idx="${i}" data-tag-name="${escapeAttr(t.name)}">
      <span>#${escapeHtml(t.name)}</span>
      <span class="tag-dropdown-count">${t.template_count} 个模板</span>
    </button>`
    )
    .join("");
  if (q && !exact) {
    html += `<button type="button" class="tag-dropdown-option tag-dropdown-create${tagDropdownHighlight === items.length ? " is-active" : ""}" data-create="1">
      <span>创建标签「#${escapeHtml(q)}」</span>
    </button>`;
  }
  if (!html) {
    closeTagDropdown();
    return;
  }
  dd.innerHTML = html;
  dd.hidden = false;
  dd.classList.add("is-open");
  dd.querySelectorAll(".tag-dropdown-option").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (btn.dataset.create) addDetailTag(q);
      else addDetailTag(btn.dataset.tagName);
      const input = document.getElementById("tag-editor-input");
      if (input) input.value = "";
      closeTagDropdown();
    });
  });
}

async function searchTagsForEditor(query) {
  const q = normalizeTagInput(query ?? "");
  try {
    const items = await fetchTagRows({ q: q || undefined, limit: 20 });
    const filtered = items.filter((t) => !detailTemplateTags.includes(t.name));
    tagDropdownHighlight = filtered.length || q ? 0 : -1;
    renderTagDropdown(filtered, q);
  } catch (e) {
    toast(e.message, true);
    closeTagDropdown();
  }
}

async function loadTagEditorTop() {
  const top = document.getElementById("tag-editor-top");
  if (!top) return;
  let tags;
  try {
    tags = await fetchTagRows({ limit: 5 });
  } catch {
    top.innerHTML = "";
    return;
  }
  if (!tags.length) {
    top.innerHTML = "";
    return;
  }
  top.innerHTML = `<span class="tag-editor-top-label">常用标签</span>${tags
    .map(
      (t) =>
        `<button type="button" class="tag-quick-add" data-quick-tag="${escapeAttr(t.name)}">#${escapeHtml(t.name)} <span class="tag-dropdown-count">${t.template_count}</span></button>`
    )
    .join("")}`;
  top.querySelectorAll("[data-quick-tag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      addDetailTag(btn.dataset.quickTag);
    });
  });
}

function renderDetailTagField() {
  return `<fieldset class="detail-section detail-section--full chip-field tag-editor-field">
      <legend>标签</legend>
      <div class="tag-editor-top" id="tag-editor-top"></div>
      <div class="tag-editor-pills" id="tag-editor-pills"></div>
      <div class="tag-editor-compose">
        <input type="text" id="tag-editor-input" class="tag-editor-input" placeholder="#标签" autocomplete="off" spellcheck="false" />
        <div id="tag-editor-dropdown" class="tag-editor-dropdown" role="listbox" hidden></div>
      </div>
    </fieldset>`;
}

function renderDetailTagReadonly(tags) {
  const list = tags || [];
  const pills = list.length
    ? list.map((name) => `<span class="tag-pill">#${escapeHtml(name)}</span>`).join("")
    : '<span class="hint">无标签</span>';
  return `<fieldset class="detail-section detail-section--full chip-field tag-editor-field">
      <legend>标签</legend>
      <div class="tag-editor-pills">${pills}</div>
    </fieldset>`;
}

function bindDetailTagEditor() {
  if (tagEditorAbort) tagEditorAbort.abort();
  tagEditorAbort = new AbortController();
  const { signal } = tagEditorAbort;
  const input = document.getElementById("tag-editor-input");
  if (!input) return;

  loadTagEditorTop();
  renderDetailTagPills();

  const scheduleTagSearch = () => {
    clearTimeout(tagSearchTimer);
    const query = getTagQueryFromInput(input.value);
    if (query == null) {
      closeTagDropdown();
      return;
    }
    tagSearchTimer = setTimeout(() => searchTagsForEditor(query), 80);
  };

  input.addEventListener("input", scheduleTagSearch, { signal });
  input.addEventListener("compositionend", scheduleTagSearch, { signal });

  input.addEventListener(
    "keydown",
    (e) => {
      const query = getTagQueryFromInput(input.value);
      const dd = document.getElementById("tag-editor-dropdown");
      const open = dd && !dd.hidden;
      const q = query == null ? "" : query;
      const createRow =
        q && !tagDropdownItems.some((t) => t.name.toLowerCase() === q.toLowerCase());
      const total = tagDropdownItems.length + (createRow ? 1 : 0);

      if (e.key === "ArrowDown" && open && total) {
        e.preventDefault();
        tagDropdownHighlight = (tagDropdownHighlight + 1) % total;
        renderTagDropdown(tagDropdownItems, q);
        return;
      }
      if (e.key === "ArrowUp" && open && total) {
        e.preventDefault();
        tagDropdownHighlight = (tagDropdownHighlight - 1 + total) % total;
        renderTagDropdown(tagDropdownItems, q);
        return;
      }
      if (e.key === "Escape") {
        closeTagDropdown();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (query == null) return;
        if (open && tagDropdownHighlight >= 0 && tagDropdownHighlight < tagDropdownItems.length) {
          addDetailTag(tagDropdownItems[tagDropdownHighlight].name);
        } else if (q) {
          const match = tagDropdownItems.find((t) => t.name.toLowerCase() === q.toLowerCase());
          addDetailTag(match ? match.name : q);
        } else {
          return;
        }
        input.value = "";
        closeTagDropdown();
      }
    },
    { signal }
  );

  document.addEventListener(
    "click",
    (e) => {
      if (!e.target.closest(".tag-editor-compose")) closeTagDropdown();
    },
    { signal }
  );
}

async function loadList() {
  const q = document.getElementById("search-input").value.trim();
  const status = document.getElementById("filter-status").value;
  const scenario = document.getElementById("filter-scenario").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (scenario) params.set("scenario", scenario);
  listTagFilters.forEach((t) => params.append("tag", t));

  const items = await api("/api/templates?" + params.toString());
  const wrap = document.getElementById("template-table-wrap");

  if (!items.length) {
    wrap.innerHTML = listTagFilters.length
      ? `<div class="empty-state">同时包含标签 ${listTagFilters.map((t) => `#${escapeHtml(t)}`).join("、")} 的模板暂无。</div>`
      : '<div class="empty-state">暂无模板，请先新建。</div>';
    return;
  }

  const sorted = sortTemplateRows(items, listSort.field, listSort.dir);
  const showDelete = canAdmin();
  wrap.innerHTML = `<table class="template-list-table">
    <thead><tr>
      <th class="seq-col">#</th>
      <th>编号</th>
      <th class="list-cover-col">封面</th>
      <th>名称</th>
      ${renderListSortableTh("场景", "scenario", listSort)}
      ${renderListSortableTh("状态", "status", listSort)}
      ${renderListSortableTh("参考价", "price_min", listSort)}
      ${renderListSortableTh("负责人", "assignee", listSort)}
      <th>更新</th>${showDelete ? "<th></th>" : ""}
    </tr></thead>
    <tbody>${sorted
      .map(
        (t, i) => `<tr>
        <td class="seq-col">${i + 1}</td>
        <td class="clickable" data-id="${t.id}">${t.template_code}</td>
        <td class="list-cover-col">${renderListCover(t)}</td>
        <td class="clickable" data-id="${t.id}">${escapeHtml(t.name)}</td>
        <td>${t.scenario}</td>
        <td><span class="badge ${t.status}">${meta.statusLabels[t.status]}</span></td>
        <td>${fmtMoney(t.price_min)}${t.price_max !== t.price_min ? " – " + fmtMoney(t.price_max) : ""}</td>
        <td>${escapeHtml(t.assignee || "—")}</td>
        <td>${(t.updated_at || "").slice(0, 16)}</td>
        ${showDelete ? `<td><button type="button" class="btn danger" data-del-template="${t.id}" data-code="${escapeAttr(t.template_code)}" data-name="${escapeAttr(t.name)}">删除</button></td>` : ""}
      </tr>`
      )
      .join("")}</tbody></table>`;

  wrap.querySelectorAll(".clickable").forEach((el) => {
    el.addEventListener("click", () => openDetail(Number(el.dataset.id)));
  });
  wrap.querySelectorAll("[data-list-sort]").forEach((btn) => {
    btn.addEventListener("click", () => cycleListSort(btn.dataset.listSort));
  });
  wrap.querySelectorAll("[data-del-template]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.delTemplate);
      const msg = `确定删除模板 ${btn.dataset.code}「${btn.dataset.name}」？\n此操作不可恢复，关联数据与上传文件将一并清除。`;
      if (!confirm(msg)) return;
      try {
        await api(`/api/templates/${id}`, { method: "DELETE" });
        toast("模板已删除");
        loadList();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

async function loadPublished() {
  const items = await api("/api/templates?status=published");
  galleryPublishedItems = items;
  const grid = document.getElementById("published-grid");
  const toolbar = document.getElementById("gallery-batch-toolbar");

  if (!items.length) {
    gallerySelectedIds.clear();
    if (toolbar) toolbar.classList.add("hidden");
    grid.innerHTML = '<div class="card">暂无已发布模板。请在详情页审核通过并发布。</div>';
    return;
  }

  const validIds = new Set(items.map((t) => String(t.id)));
  for (const id of [...gallerySelectedIds]) {
    if (!validIds.has(id)) gallerySelectedIds.delete(id);
  }

  if (toolbar) {
    toolbar.classList.remove("hidden");
    toolbar.innerHTML = renderGalleryBatchToolbar(items.length);
    bindGalleryBatchToolbar(items);
  }

  grid.innerHTML = items.map((t) => renderGalleryPoster(t)).join("");
  bindGalleryPosterActions(items);
}

function renderGalleryBatchToolbar(total) {
  const n = gallerySelectedIds.size;
  const exportBtns = canExport()
    ? `<button type="button" class="btn primary" id="gallery-batch-csv" ${n ? "" : "disabled"}>一键下载清单</button>`
    : "";
  return `
    <div class="gallery-batch-toolbar-inner">
      <label class="gallery-batch-select-all">
        <input type="checkbox" id="gallery-select-all" ${n === total && total > 0 ? "checked" : ""} />
        全选 <span class="gallery-batch-count">（${n} / ${total}）</span>
      </label>
      <div class="gallery-batch-actions">
        <button type="button" class="btn" id="gallery-batch-png" ${n ? "" : "disabled"}>一键下载图片</button>
        <button type="button" class="btn" id="gallery-batch-pdf" ${n ? "" : "disabled"}>一键下载手册</button>
        ${exportBtns}
      </div>
    </div>`;
}

function bindGalleryBatchToolbar(items) {
  const total = items.length;
  const updateToolbar = () => {
    const toolbar = document.getElementById("gallery-batch-toolbar");
    if (toolbar && !toolbar.classList.contains("hidden")) {
      toolbar.innerHTML = renderGalleryBatchToolbar(total);
      bindGalleryBatchToolbar(items);
    }
    document.querySelectorAll(".gallery-card-select").forEach((cb) => {
      cb.checked = gallerySelectedIds.has(String(cb.dataset.gallerySelect));
    });
  };

  document.getElementById("gallery-select-all")?.addEventListener("change", (e) => {
    if (e.target.checked) {
      items.forEach((t) => gallerySelectedIds.add(String(t.id)));
    } else {
      gallerySelectedIds.clear();
    }
    updateToolbar();
  });

  document.getElementById("gallery-batch-png")?.addEventListener("click", () => runGalleryBatchDownload("png", items));
  document.getElementById("gallery-batch-pdf")?.addEventListener("click", () => runGalleryBatchDownload("pdf", items));
  document.getElementById("gallery-batch-csv")?.addEventListener("click", () => runGalleryBatchDownload("csv", items));
}

function getGallerySelectedItems(items) {
  return items.filter((t) => gallerySelectedIds.has(String(t.id)));
}

async function runGalleryBatchDownload(kind, items) {
  const selected = getGallerySelectedItems(items);
  if (!selected.length) {
    toast("请先勾选要下载的模板", true);
    return;
  }
  if (kind === "csv" && !canExport()) {
    toast("无导出权限", true);
    return;
  }
  const btn = document.getElementById(
    kind === "png" ? "gallery-batch-png" : kind === "pdf" ? "gallery-batch-pdf" : "gallery-batch-csv"
  );
  if (btn) btn.disabled = true;
  try {
    if (kind === "png") await batchDownloadGalleryPngZip(selected);
    else if (kind === "pdf") await batchDownloadGalleryPdfZip(selected);
    else await batchDownloadGalleryCsv(selected);
    toast(
      kind === "png"
        ? `已打包 ${selected.length} 张展示图`
        : kind === "pdf"
          ? `已打包 ${selected.length} 份手册`
          : `已下载 ${selected.length} 个模板的清单 CSV`
    );
  } catch (err) {
    toast(err.message || "批量下载失败", true);
  } finally {
    if (btn) btn.disabled = gallerySelectedIds.size === 0;
  }
}

function renderGalleryPoster(t) {
  const price =
    t.price_min != null
      ? `${fmtMoney(t.price_min)}${t.price_max !== t.price_min && t.price_max != null ? " – " + fmtMoney(t.price_max) : ""}`
      : "—";
  const dims =
    t.width_mm && t.depth_mm && t.height_mm
      ? `${t.width_mm}×${t.depth_mm}×${t.height_mm} mm`
      : "";
  const tags = (t.tags || []).length
    ? `<div class="gallery-poster-tags">${t.tags.map((tag) => `<span class="gallery-tag">${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const cover = t.cover_image
    ? `<img class="gallery-poster-cover-img" src="${escapeAttr(t.cover_image)}" alt="" crossorigin="anonymous" />`
    : `<div class="gallery-poster-cover-placeholder">暂无封面</div>`;

  const checked = gallerySelectedIds.has(String(t.id)) ? "checked" : "";
  const csvBtn = canExport()
    ? `<button type="button" class="btn gallery-overlay-btn" data-download-csv="${t.id}">下载清单</button>`
    : "";

  return `<article class="gallery-card" data-id="${t.id}">
    <label class="gallery-card-select-wrap" title="加入批量下载">
      <input type="checkbox" class="gallery-card-select" data-gallery-select="${t.id}" ${checked} />
    </label>
    <div class="gallery-poster" data-template-id="${t.id}" data-template-code="${escapeAttr(t.template_code)}" tabindex="0">
      <div class="gallery-poster-cover">${cover}</div>
      <div class="gallery-poster-info">
        <h3 class="gallery-poster-name">${escapeHtml(t.name)}</h3>
        <div class="gallery-poster-price">${price}</div>
        <p class="gallery-poster-liner">${escapeHtml(t.one_liner || "—")}</p>
        <div class="gallery-poster-secondary">
          <span>${escapeHtml(t.template_code)}</span>
          <span>${escapeHtml(t.scenario)}</span>
          ${dims ? `<span>${escapeHtml(dims)}</span>` : ""}
        </div>
        ${tags}
      </div>
      <div class="gallery-poster-overlay" aria-hidden="true">
        <button type="button" class="btn gallery-overlay-btn" data-download-png="${t.id}">下载图片</button>
        <button type="button" class="btn primary gallery-overlay-btn" data-download-pdf="${t.id}">下载手册</button>
        ${csvBtn}
      </div>
    </div>
  </article>`;
}

function bindGalleryPosterActions(items) {
  const byId = Object.fromEntries(items.map((t) => [String(t.id), t]));

  document.querySelectorAll(".gallery-card-select").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      const id = cb.dataset.gallerySelect;
      if (cb.checked) gallerySelectedIds.add(id);
      else gallerySelectedIds.delete(id);
      const toolbar = document.getElementById("gallery-batch-toolbar");
      if (toolbar && !toolbar.classList.contains("hidden")) {
        toolbar.innerHTML = renderGalleryBatchToolbar(items.length);
        bindGalleryBatchToolbar(items);
      }
    });
    cb.addEventListener("click", (e) => e.stopPropagation());
  });

  document.querySelectorAll(".gallery-card-select-wrap").forEach((label) => {
    label.addEventListener("click", (e) => e.stopPropagation());
  });

  document.querySelectorAll(".gallery-poster").forEach((poster) => {
    poster.addEventListener("click", (e) => {
      if (e.target.closest(".gallery-overlay-btn")) return;
      if (e.target.closest(".gallery-card-select-wrap")) return;
      if (window.matchMedia("(hover: none)").matches) {
        poster.classList.toggle("is-actions-open");
      }
    });
  });

  document.querySelectorAll("[data-download-png]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const t = byId[btn.dataset.downloadPng];
      const poster = btn.closest(".gallery-poster");
      if (!t || !poster) return;
      btn.disabled = true;
      try {
        await downloadGalleryPosterPng(poster, t.template_code);
        toast("展示图已下载");
      } catch (err) {
        toast(err.message || "下载失败", true);
      } finally {
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-download-pdf]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const t = byId[btn.dataset.downloadPdf];
      if (!t) return;
      btn.disabled = true;
      try {
        await downloadPublicSheetPdf(t.id, t.template_code);
        toast("方案手册已下载");
      } catch (err) {
        toast(err.message || "PDF 生成失败", true);
      } finally {
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-download-csv]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!canExport()) {
        toast("无导出权限", true);
        return;
      }
      const t = byId[btn.dataset.downloadCsv];
      if (!t) return;
      btn.disabled = true;
      try {
        await downloadInternalSheetCsv(t.id, t.template_code);
        toast("内部清单 CSV 已下载");
      } catch (err) {
        toast(err.message || "CSV 导出失败", true);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

let html2canvasLoadPromise = null;

function ensureHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (!html2canvasLoadPromise) {
    html2canvasLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/html2canvas/html2canvas.min.js";
      script.onload = () => resolve(window.html2canvas);
      script.onerror = () => reject(new Error("无法加载截图组件"));
      document.head.appendChild(script);
    });
  }
  return html2canvasLoadPromise;
}

async function downloadGalleryPosterPng(posterEl, templateCode) {
  const html2canvas = await ensureHtml2Canvas();
  const overlay = posterEl.querySelector(".gallery-poster-overlay");
  if (overlay) overlay.style.visibility = "hidden";
  try {
    const canvas = await html2canvas(posterEl, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG 生成失败");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${templateCode}.png`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    if (overlay) overlay.style.visibility = "";
  }
}

async function downloadPublicSheetPdf(templateId, templateCode) {
  const res = await fetch(`/api/templates/${templateId}/public-sheet.pdf`, { credentials: "include" });
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText || "PDF 生成失败");
  }
  if (!contentType.includes("application/pdf")) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "PDF 生成失败");
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, `${templateCode}_手册.pdf`);
}

async function downloadInternalSheetCsv(templateId, templateCode) {
  await downloadExport(`/api/templates/${templateId}/internal-sheet.csv`, `${templateCode}_清单.csv`);
}

let jsZipLoadPromise = null;

function ensureJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jsZipLoadPromise) {
    jsZipLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
      script.onload = () => resolve(window.JSZip);
      script.onerror = () => reject(new Error("无法加载打包组件"));
      document.head.appendChild(script);
    });
  }
  return jsZipLoadPromise;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function galleryBatchZipName(kind) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  if (kind === "png") return `图册-展示图-${stamp}.zip`;
  if (kind === "pdf") return `图册-手册-${stamp}.zip`;
  return `图册-清单-${stamp}.zip`;
}

async function batchDownloadGalleryCsv(templates) {
  const ids = templates.map((t) => t.id).join(",");
  const filename =
    templates.length === 1 ? `${templates[0].template_code}_清单.csv` : galleryBatchZipName("csv").replace(".zip", ".csv");
  await downloadExport(`/api/export/gallery-sheet?ids=${encodeURIComponent(ids)}`, filename);
}

async function batchDownloadGalleryPngZip(templates) {
  const JSZip = await ensureJSZip();
  const zip = new JSZip();
  const html2canvas = await ensureHtml2Canvas();
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    const poster = document.querySelector(
      `.gallery-poster[data-template-id="${t.id}"]`
    );
    if (!poster) continue;
    const overlay = poster.querySelector(".gallery-poster-overlay");
    if (overlay) overlay.style.visibility = "hidden";
    try {
      const canvas = await html2canvas(poster, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false
      });
      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1];
      zip.file(`${t.template_code}.png`, base64, { base64: true });
    } finally {
      if (overlay) overlay.style.visibility = "";
    }
  }
  const blob = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(blob, galleryBatchZipName("png"));
}

async function batchDownloadGalleryPdfZip(templates) {
  const JSZip = await ensureJSZip();
  const zip = new JSZip();
  for (const t of templates) {
    const res = await fetch(`/api/templates/${t.id}/public-sheet.pdf`, { credentials: "include" });
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `${t.template_code} 手册生成失败`);
    }
    if (!contentType.includes("application/pdf")) {
      throw new Error(`${t.template_code} 手册生成失败`);
    }
    const blob = await res.blob();
    zip.file(`${t.template_code}_手册.pdf`, blob);
  }
  const out = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(out, galleryBatchZipName("pdf"));
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

function resolveCoverSelection(t, preferredValue) {
  const opts = buildCoverOptions(t);
  if (!opts.length) return null;
  if (preferredValue && opts.some((o) => o.value === preferredValue)) {
    return opts.find((o) => o.value === preferredValue);
  }
  if (t.cover_source && opts.some((o) => o.value === t.cover_source)) {
    return opts.find((o) => o.value === t.cover_source);
  }
  return opts[0];
}

function renderCoverSourcePicker(t, preferredValue) {
  const selected = resolveCoverSelection(t, preferredValue);
  if (!selected) {
    return `<div class="detail-section detail-section--cover full"><span class="detail-section-label">封面来源</span><p class="hint">上传实拍或效果图后可选择封面</p></div>`;
  }
  const opts = buildCoverOptions(t);
  if (!canEditTemplateContent(t)) {
    return `<div class="detail-section detail-section--cover full">
      <span class="detail-section-label">封面来源</span>
      <div class="cover-source-static">
        <img src="${escapeAttr(selected.url)}" alt="" class="cover-source-trigger-thumb" />
        <span>${escapeHtml(selected.label)}</span>
      </div>
    </div>`;
  }
  return `<div class="detail-section detail-section--cover full" id="cover-source-picker-wrap">
      <span class="detail-section-label">封面来源</span>
      <div class="cover-source-picker" id="cover-source-picker">
        <input type="hidden" id="d-cover-source" value="${escapeAttr(selected.value)}" />
        <button type="button" class="cover-source-trigger" id="cover-source-trigger" aria-haspopup="listbox" aria-expanded="false">
          <img src="${escapeAttr(selected.url)}" alt="" class="cover-source-trigger-thumb" />
          <span class="cover-source-trigger-label">${escapeHtml(selected.label)}</span>
          <span class="cover-source-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="cover-source-menu" id="cover-source-menu" role="listbox" hidden>
          ${opts
            .map(
              (o) =>
                `<button type="button" role="option" class="cover-source-option${o.value === selected.value ? " is-selected" : ""}" data-value="${escapeAttr(o.value)}">
              <img src="${escapeAttr(o.url)}" alt="" />
              <span>${escapeHtml(o.label)}</span>
            </button>`
            )
            .join("")}
        </div>
      </div>
    </div>`;
}

let coverPickerDocAbort = null;

function bindCoverSourcePicker(templateId) {
  if (coverPickerDocAbort) coverPickerDocAbort.abort();
  const picker = document.getElementById("cover-source-picker");
  const hidden = document.getElementById("d-cover-source");
  const trigger = document.getElementById("cover-source-trigger");
  const menu = document.getElementById("cover-source-menu");
  if (!picker || !hidden || !trigger || !menu) return;

  const closeMenu = () => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    } else {
      closeMenu();
    }
  });

  menu.querySelectorAll(".cover-source-option").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = btn.dataset.value;
      if (value === hidden.value) {
        closeMenu();
        return;
      }
      hidden.value = value;
      const img = btn.querySelector("img");
      const label = btn.querySelector("span")?.textContent || "";
      trigger.querySelector(".cover-source-trigger-thumb").src = img?.src || "";
      trigger.querySelector(".cover-source-trigger-label").textContent = label;
      menu.querySelectorAll(".cover-source-option").forEach((b) =>
        b.classList.toggle("is-selected", b.dataset.value === value)
      );
      closeMenu();
      try {
        await api(`/api/templates/${templateId}`, {
          method: "PATCH",
          body: JSON.stringify({ cover_source: value })
        });
        toast("封面已更新");
        openDetail(templateId);
      } catch (e) {
        toast(e.message, true);
      }
    });
  });

  coverPickerDocAbort = new AbortController();
  document.addEventListener(
    "click",
    (e) => {
      if (!document.getElementById("cover-source-picker")?.contains(e.target)) closeMenu();
    },
    { signal: coverPickerDocAbort.signal }
  );
}

function refreshCoverSourcePicker(t, templateId, preferredValue) {
  const wrap = document.getElementById("cover-source-picker-wrap");
  if (!wrap) return;
  wrap.outerHTML = renderCoverSourcePicker(t, preferredValue);
  if (canWrite() && document.getElementById("cover-source-picker")) bindCoverSourcePicker(templateId);
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
        <button type="button" class="btn" id="audit-reject-quote">退回至待清单深化</button>
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
        (l) => `<tr class="${l.price_item_missing ? "row-price-missing" : ""}">
        <td>${escapeHtml(l.nut_model || "—")}</td>
        <td>${escapeHtml(l.item_name)}${priceMissingBadge(l)}</td>
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
      <th>颜色</th><th>长度(in)</th><th>数量</th><th>系数</th><th>出厂参考价</th><th>报价单价</th><th>小计</th><th></th>
    </tr></thead>
    <tbody>${lines
      .map(
        (l) => `<tr>
        <td>${escapeHtml(l.color || "—")}</td>
        <td>${l.length_inch}</td><td>${l.qty}</td><td>${l.coefficient ?? 1}</td>
        <td>${fmtMoney(l.factory_price)}</td><td>${fmtMoney(l.quote_unit)}</td><td>${fmtMoney(l.subtotal)}</td>
        <td><button type="button" class="btn danger" data-del-profile="${l.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody>
    <tfoot><tr><td colspan="6" class="tfoot-label">型材小计</td><td colspan="2">${fmtMoney(lines.reduce((s, l) => s + l.subtotal, 0))}</td></tr></tfoot>
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
        (l) => `<tr class="${l.price_item_missing ? "row-price-missing" : ""}">
        <td>${escapeHtml(l.item_name)}${priceMissingBadge(l)}</td><td>${escapeHtml(l.spec || "—")}</td>
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
        (l) => `<tr class="${l.price_item_missing ? "row-price-missing" : ""}">
        <td>${escapeHtml(l.material_type || "—")}</td>
        <td>${renderColorLabel(l.color, l.color_hex)}${priceMissingBadge(l)}</td>
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

function priceMissingBadge(line) {
  if (!line.price_item_missing && !line.custom_price_item_missing) return "";
  return '<span class="price-missing-badge">单价库已失效</span>';
}

function hasPriceItemIssues(t) {
  const quoteLines = [...(t.quote_nuts || []), ...(t.quote_hardware || []), ...(t.quote_panels || [])];
  if (quoteLines.some((l) => l.price_item_missing)) return true;
  return (t.bom || []).some((l) => l.custom_price_item_missing);
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
  const statusActions = getStatusActionTargets(t.status, nextStatuses);
  const isPublishedLocked = t.status === "published" && canWrite();
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

  const legacyPanelNote = (t.panel_note || "").trim()
    ? `<div class="detail-section detail-section--legacy full">
        <span class="detail-section-label">皮肤选配说明（历史记录）</span>
        <div class="detail-legacy-note">${escapeHtml(t.panel_note)}</div>
      </div>`
    : "";

  root.innerHTML = `
    ${hasPriceItemIssues(t) ? '<div class="price-missing-banner">部分报价行引用的单价库条目已失效，请尽快在下方清单中更新对应条目。</div>' : ""}
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
          : isPublishedLocked
            ? `<p class="hint">当前<strong>已发布</strong>：除标签外不可修改。需改其它内容请先<strong>下架</strong>，改完后重新审核上架（版本 +0.1）；更换 skp 模型时版本 +1。</p>
              <div class="status-actions">
                <button type="button" class="btn" data-status="archived">下架</button>
              </div>`
            : t.status === "archived" && canChangeTemplateStatus(t.status)
              ? `<p class="hint">当前已下架。点击「重新上架」将进入<strong>待审核</strong>，请在下方 <strong>审核发布</strong> 完成 checklist 后发布（版本 +0.1）。</p>
              <div class="status-actions">
                <button type="button" class="btn primary" data-relist-template>重新上架</button>
              </div>`
            : statusActions.length
              ? `<div class="status-actions">${statusActions
                  .map(
                    (s) =>
                      `<button type="button" class="btn primary" data-status="${s}">${escapeHtml(getStatusActionLabel(s, t.status))}</button>`
                  )
                  .join("")}</div>`
              : '<p class="hint">当前状态无可推进的下一步。</p>'
      }
    </div>

    ${renderAuditPanel(t)}

    <div class="card detail-form">
      <h3>基本信息</h3>
      <div class="detail-section detail-section--grid3">
        <label>名称<input id="d-name" value="${escapeAttr(t.name)}" /></label>
        <label>负责人<input id="d-assignee" value="${escapeAttr(t.assignee)}" readonly title="登记时自动拾取" /></label>
        <label>版本<input id="d-version" value="${escapeAttr(t.version)}" readonly title="审核上架 +0.1；更换 skp 模型 +1" /></label>
      </div>
      <div class="detail-section detail-section--grid3">
        <span class="detail-section-label detail-section-label--inline">尺寸</span>
        <label>宽 mm<input id="d-w" type="number" value="${t.width_mm ?? ""}" /></label>
        <label>深 mm<input id="d-d" type="number" value="${t.depth_mm ?? ""}" /></label>
        <label>高 mm<input id="d-h" type="number" value="${t.height_mm ?? ""}" /></label>
      </div>
      <div class="detail-section detail-section--full">
        <label class="field-stacked">一句话卖点<input id="d-liner" value="${escapeAttr(t.one_liner)}" /></label>
      </div>
      ${legacyPanelNote}
      <div class="detail-section detail-section--full">
        <label class="field-stacked">报价口径<textarea id="d-quote-note" rows="2">${escapeHtml(t.quote_note)}</textarea></label>
      </div>
      <div class="detail-section detail-section--grid2">
        <label>参考价下限（留空自动）<input id="d-price-min" type="number" value="${t.price_override_min ?? ""}" /></label>
        <label>参考价上限（留空自动）<input id="d-price-max" type="number" value="${t.price_override_max ?? ""}" /></label>
      </div>
      <div class="detail-section detail-section--full">
        <label class="checkbox-chip${t.skin_upgrade_enabled ? " is-checked" : ""}">
          <input type="checkbox" id="d-skin-upgrade" ${t.skin_upgrade_enabled ? "checked" : ""} />
          <span class="checkbox-chip-text">可定制</span>
        </label>
      </div>
      ${renderCoverSourcePicker(t)}
      <div class="detail-section detail-section--full">
        <label class="field-stacked">内部备注<textarea id="d-note" rows="2">${escapeHtml(t.internal_note)}</textarea></label>
      </div>
      ${canWrite() ? renderDetailTagField() : renderDetailTagReadonly(t.tags)}
      <div class="form-actions"><button type="button" class="btn primary" id="save-detail">${isPublishedLocked ? "保存标签" : "保存基本信息"}</button></div>
    </div>

    <div class="card" id="detail-assets-card">
      <h3>文件与图片</h3>
      <p class="hint">资产目录：<code>data/uploads/${escapeHtml(t.template_code)}/</code></p>
      <div class="detail-drop-zones">
        <div class="drop-zone detail-drop-zone" id="drop-zone-photo" tabindex="0" role="button" aria-label="上传实拍照片">
          <div class="drop-zone-inner">
            <p class="drop-zone-title">实拍照片</p>
            <p class="drop-zone-hint">拖拽图片或 <button type="button" class="drop-zone-link">选择文件</button></p>
          </div>
          <input type="file" accept="image/*" multiple hidden />
        </div>
        <div class="drop-zone detail-drop-zone" id="drop-zone-effect" tabindex="0" role="button" aria-label="上传效果图">
          <div class="drop-zone-inner">
            <p class="drop-zone-title">效果图</p>
            <p class="drop-zone-hint">拖拽图片或 <button type="button" class="drop-zone-link">选择文件</button></p>
          </div>
          <input type="file" accept="image/*" multiple hidden />
        </div>
        <div class="drop-zone detail-drop-zone" id="drop-zone-render" tabindex="0" role="button" aria-label="上传渲染图">
          <div class="drop-zone-inner">
            <p class="drop-zone-title">渲染图</p>
            <p class="drop-zone-hint">拖拽图片或 <button type="button" class="drop-zone-link">选择文件</button></p>
          </div>
          <input type="file" accept="image/*" multiple hidden />
        </div>
        <div class="drop-zone detail-drop-zone" id="drop-zone-skp" tabindex="0" role="button" aria-label="更新 skp">
          <div class="drop-zone-inner">
            <p class="drop-zone-title">更新 SKP</p>
            <p class="drop-zone-hint">拖拽 .skp 或 <button type="button" class="drop-zone-link">选择文件</button></p>
          </div>
          <input type="file" accept=".skp" hidden />
        </div>
      </div>
      <div id="detail-cover-info">${t.cover_image ? `<p class="hint">当前封面：<a href="${t.cover_image}" target="_blank"><img src="${t.cover_image}" alt="" class="cover-thumb" /></a></p>` : ""}</div>
      <div id="detail-skp-info">${t.skp_file ? `<p class="hint">skp：<a href="${t.skp_file}" target="_blank">${t.skp_file}</a></p>` : ""}</div>
      <h4>实拍照片（可选）</h4>
      <div id="detail-photo-gallery">${renderImageGallery(t.photo_images)}</div>
      <h4>效果图（必填 ≥1）</h4>
      <div id="detail-effect-gallery">${renderImageGallery(t.effect_images)}</div>
      <h4>渲染图（必填 ≥1）</h4>
      <div id="detail-render-gallery">${renderImageGallery(t.render_images)}</div>
    </div>

    <div class="card">
      <h3>详细报价清单</h3>
      ${renderQuoteBreakdown(q)}
      <div class="quote-tabs">
        <button type="button" class="quote-tab ${activeQuoteTab === "profiles" ? "active" : ""}" data-quote-tab="profiles">MR2525 型材</button>
        <button type="button" class="quote-tab ${activeQuoteTab === "nuts" ? "active" : ""}" data-quote-tab="nuts">六通</button>
        <button type="button" class="quote-tab ${activeQuoteTab === "hardware" ? "active" : ""}" data-quote-tab="hardware">五金配件</button>
        <button type="button" class="quote-tab ${activeQuoteTab === "panels" ? "active" : ""}" data-quote-tab="panels">板材</button>
        <button type="button" class="quote-tab ${activeQuoteTab === "legacy" ? "active" : ""}" data-quote-tab="legacy">其他</button>
      </div>

      <div class="quote-panel ${activeQuoteTab === "profiles" ? "active" : ""}" data-quote-panel="profiles">
        <p class="formula-hint">${escapeHtml(meta.profileFormulaNote || "")}</p>
        <form id="profile-add-form" class="profile-add">
          <label>颜色<select name="color" required>${profileColorSelectHtml(meta.profileColors?.[0])}</select></label>
          <label>长度(in)<input name="length_inch" type="number" step="0.1" required placeholder="如 31.1" /></label>
          <label>数量<input name="qty" type="number" step="1" value="1" /></label>
          <label>系数<input name="coefficient" type="number" step="0.01" value="1" /></label>
          <label>预览出厂价<input id="profile-preview" readonly placeholder="自动计算" /></label>
          <button type="submit" class="btn primary">添加型材</button>
        </form>
        <div id="profile-table">${renderProfileTable(t.quote_profiles)}</div>
      </div>

      <div class="quote-panel ${activeQuoteTab === "nuts" ? "active" : ""}" data-quote-panel="nuts">
        ${canAdmin() ? `<label class="manual-toggle"><input type="checkbox" id="nut-manual-toggle" /> 手动输入</label>` : ""}
        <form id="nut-add-form" class="hardware-add">
          <div id="nut-select-fields">
            <label>六通型号<select name="price_item_id" required><option value="">从单价库选择…</option>${nutOptions}</select></label>
            <label>数量<input name="qty" type="number" step="1" value="1" /></label>
          </div>
          <div id="nut-manual-fields" class="hidden">
            <label>名称<input name="label" placeholder="六通 OL2525" /></label>
            <label>型号<input name="nut_model" placeholder="OL2525" /></label>
            <label>对外单价<input name="unit_price" type="number" step="0.01" /></label>
            <label>数量<input name="qty" type="number" step="1" value="1" /></label>
          </div>
          <button type="submit" class="btn primary">添加</button>
        </form>
        <div id="nut-table">${renderNutTable(t.quote_nuts)}</div>
      </div>

      <div class="quote-panel ${activeQuoteTab === "hardware" ? "active" : ""}" data-quote-panel="hardware">
        ${canAdmin() ? `<label class="manual-toggle"><input type="checkbox" id="hardware-manual-toggle" /> 手动输入</label>` : ""}
        <form id="hardware-add-form" class="hardware-add">
          <div id="hardware-select-fields">
            <label>配件<select name="price_item_id" required><option value="">从单价库选择…</option>${hwOptions}</select></label>
            <label>数量<input name="qty" type="number" step="1" value="1" /></label>
          </div>
          <div id="hardware-manual-fields" class="hidden">
            <label>名称<input name="label" placeholder="地脚" /></label>
            <label>规格<input name="spec" placeholder="500×20" /></label>
            <label>单位<select name="unit">${meta.bomUnits.map((u) => `<option>${u}</option>`).join("")}</select></label>
            <label>对外单价<input name="unit_price" type="number" step="0.01" /></label>
            <label>数量<input name="qty" type="number" step="1" value="1" /></label>
          </div>
          <button type="submit" class="btn primary">添加</button>
        </form>
        <div id="hardware-table">${renderHardwareTable(t.quote_hardware)}</div>
      </div>

      <div class="quote-panel ${activeQuoteTab === "panels" ? "active" : ""}" data-quote-panel="panels">
        <p class="formula-hint">${escapeHtml(meta.panelFormulaNote || "")}</p>
        ${canAdmin() ? `<label class="manual-toggle"><input type="checkbox" id="panel-manual-toggle" /> 手动输入</label>` : ""}
        <form id="panel-add-form" class="panel-add">
          <div id="panel-select-fields">
            <label>材质<select name="material_type" id="panel-mat" required><option value="">选择材质…</option>${materialOptions}</select></label>
            <label>颜色<select name="color" id="panel-color" required disabled><option value="">先选材质</option></select></label>
            <label>厚度<select name="thickness" id="panel-thick" required disabled><option value="">先选颜色</option></select></label>
            <input type="hidden" name="price_item_id" id="panel-price-id" />
            <label>规格<select id="panel-spec" required disabled><option value="">先选厚度</option></select></label>
            <label>长(in)<input name="length_inch" type="number" step="0.1" required /></label>
            <label>宽(in)<input name="width_inch" type="number" step="0.1" required /></label>
            <label>数量<input name="qty" type="number" step="1" value="1" /></label>
          </div>
          <div id="panel-manual-fields" class="hidden">
            <label>材质<input name="material_type" placeholder="如 防火板" /></label>
            <label>颜色<input name="color" placeholder="如 白色" /></label>
            <label>厚度(mm)<input name="thickness_mm" type="number" step="0.1" /></label>
            <label>计价<select name="pricing_mode"><option value="per_sqm">按㎡</option><option value="fixed">固定件价</option></select></label>
            <label>对外单价<input name="unit_price" type="number" step="0.01" /></label>
            <label>长(in)<input name="length_inch" type="number" step="0.1" required /></label>
            <label>宽(in)<input name="width_inch" type="number" step="0.1" required /></label>
            <label>数量<input name="qty" type="number" step="1" value="1" /></label>
          </div>
          <button type="submit" class="btn primary">添加板材</button>
        </form>
        <div id="panel-table">${renderPanelTable(t.quote_panels)}</div>
      </div>

      <div class="quote-panel ${activeQuoteTab === "legacy" ? "active" : ""}" data-quote-panel="legacy">
        <form id="bom-add-form" class="bom-add">
          <label>类别<select name="category">${(meta.customBomCategories || meta.bomCategories).map((c) => `<option>${c}</option>`).join("")}</select></label>
          <label>项目<input name="item_name" required /></label>
          <label>规格<input name="spec" /></label>
          <label>数量<input name="qty" type="number" step="0.01" value="1" /></label>
          <label>单价<input name="unit_price" type="number" step="0.01" min="0.01" required /></label>
          <button type="submit" class="btn primary">添加</button>
        </form>
        <div id="bom-table"></div>
      </div>
    </div>
  `;

  stripDetailEditing(root);
  detailTemplateTags = [...(t.tags || [])];

  if (!canWrite()) {
    renderBomTable(t.bom || []);
    return;
  }

  if (isPublishedLocked) {
    applyPublishedReadOnly(root);
  }

  document.getElementById("save-detail")?.addEventListener("click", () => saveDetail(t.id, t.status));
  bindDetailTagEditor();
  root.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => updateStatus(t.id, btn.dataset.status, t.status));
  });
  root.querySelector("[data-relist-template]")?.addEventListener("click", () => requestRelistTemplate(t.id));

  if (canEditTemplateContent(t)) {
    initDetailDropZone({ zoneId: "drop-zone-photo", kind: "photo", multiple: true, templateId: t.id });
    initDetailDropZone({ zoneId: "drop-zone-effect", kind: "effect", multiple: true, templateId: t.id });
    initDetailDropZone({ zoneId: "drop-zone-render", kind: "render", multiple: true, templateId: t.id });
    initDetailDropZone({ zoneId: "drop-zone-skp", kind: "skp", multiple: false, templateId: t.id });
    bindCoverSourcePicker(t.id);
  }

  const approveBtn = document.getElementById("audit-approve");
  if (approveBtn) {
    approveBtn.addEventListener("click", () => submitAudit(t.id, "approve"));
  }
  document.getElementById("audit-reject-quote")?.addEventListener("click", () =>
    submitAudit(t.id, "reject", "pending_quote")
  );

  if (canEditTemplateContent(t)) {
  const skinUpgrade = document.getElementById("d-skin-upgrade");
  const skinChip = skinUpgrade?.closest(".checkbox-chip");
  skinUpgrade?.addEventListener("change", () => {
    skinChip?.classList.toggle("is-checked", skinUpgrade.checked);
  });

  root.querySelectorAll(".quote-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeQuoteTab = tab.dataset.quoteTab;
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

  setupManualToggle("nut-manual-toggle", "nut-select-fields", "nut-manual-fields");
  setupManualToggle("hardware-manual-toggle", "hardware-select-fields", "hardware-manual-fields");
  setupManualToggle("panel-manual-toggle", "panel-select-fields", "panel-manual-fields");

  document.getElementById("nut-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const manual = document.getElementById("nut-manual-toggle")?.checked;
    const fd = new FormData(e.target);
    const body = manual
      ? { manual: true, label: fd.get("label"), nut_model: fd.get("nut_model"), unit_price: fd.get("unit_price"), qty: fd.get("qty") }
      : Object.fromEntries(fd.entries());
    await api(`/api/templates/${t.id}/nuts`, { method: "POST", body: JSON.stringify(body) });
    toast("六通已添加");
    openDetail(t.id);
  });

  document.getElementById("hardware-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const manual = document.getElementById("hardware-manual-toggle")?.checked;
    const fd = new FormData(e.target);
    let body;
    if (manual) {
      body = {
        manual: true,
        label: fd.get("label"),
        spec: fd.get("spec"),
        unit: fd.get("unit"),
        unit_price: fd.get("unit_price"),
        qty: fd.get("qty")
      };
    } else {
      const priceItemId = fd.get("price_item_id");
      if (!priceItemId) {
        toast("请从单价库选择五金配件", true);
        return;
      }
      body = { price_item_id: Number(priceItemId), qty: fd.get("qty") || 1 };
    }
    try {
      await api(`/api/templates/${t.id}/hardware`, { method: "POST", body: JSON.stringify(body) });
      toast("五金已添加");
      activeQuoteTab = "hardware";
      openDetail(t.id);
    } catch (err) {
      toast(err.message, true);
    }
  });

  setupPanelCascade(panelFilters);
  applyLastPanelSelection(panelFilters);

  document.getElementById("panel-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const manual = document.getElementById("panel-manual-toggle")?.checked;
    const fd = new FormData(e.target);
    let body;
    if (manual) {
      body = {
        manual: true,
        material_type: fd.get("material_type"),
        color: fd.get("color"),
        thickness_mm: fd.get("thickness_mm"),
        pricing_mode: fd.get("pricing_mode"),
        unit_price: fd.get("unit_price"),
        length_inch: fd.get("length_inch"),
        width_inch: fd.get("width_inch"),
        qty: fd.get("qty")
      };
    } else {
      const priceId = document.getElementById("panel-price-id").value;
      if (!priceId) {
        toast("请选择完整板材规格", true);
        return;
      }
      body = {
        price_item_id: Number(priceId),
        length_inch: fd.get("length_inch"),
        width_inch: fd.get("width_inch"),
        qty: fd.get("qty")
      };
    }
    await api(`/api/templates/${t.id}/panels`, { method: "POST", body: JSON.stringify(body) });
    if (!manual) {
      const matEl = document.getElementById("panel-mat");
      const colorEl = document.getElementById("panel-color");
      const thickEl = document.getElementById("panel-thick");
      const specEl = document.getElementById("panel-spec");
      lastPanelSelection = {
        material_type: matEl?.value,
        color: colorEl?.value,
        thickness_mm: Number(thickEl?.value),
        price_item_id: Number(document.getElementById("panel-price-id")?.value),
        spec_label: specEl?.options[specEl.selectedIndex]?.text
      };
    }
    toast("板材已添加，已沿用上一行板材规格，请填写长宽");
    openDetail(t.id);
  });

  document.getElementById("bom-add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const price = Number(fd.get("unit_price"));
    if (!price || price <= 0) {
      toast("请填写有效单价（> 0）", true);
      return;
    }
    addBomLine(t.id, fd);
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
  }

  renderBomTable(t.bom || []);
}

function applyPublishedReadOnly(root) {
  root.querySelector("#detail-assets-card")?.remove();
  root.querySelectorAll(".quote-panel form, #bom-add-form").forEach((el) => el.remove());
  root.querySelectorAll(".manual-toggle").forEach((el) => el.remove());
  root.querySelectorAll("[data-del-profile], [data-del-nut], [data-del-hardware], [data-del-panel]").forEach(
    (btn) => btn.remove()
  );
  root.querySelectorAll("input, select, textarea").forEach((el) => {
    if (el.closest(".tag-editor-field")) return;
    el.disabled = true;
  });
}

function stripDetailEditing(root) {
  if (canWrite()) return;
  root.querySelectorAll(".status-actions, .form-actions, form, .detail-drop-zones, .btn.danger").forEach((el) => el.remove());
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

const TRANSPARENT_COLOR_NAME = "透明";
const TRANSPARENT_COLOR_HEX = "transparent";

function hashColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 42%, 52%)`;
}

function buildPanelColorHexMap(rows = []) {
  const map = { ...(meta?.panelColorSwatches || {}) };
  for (const r of rows) {
    if (r.color && r.color_hex) map[r.color] = r.color_hex;
  }
  return map;
}

function colorSwatchValue(name, hexMap) {
  if (!name) return "#e2e8f0";
  const map = hexMap || meta?.panelColorSwatches || {};
  return map[name] || hashColor(name);
}

function isClearSwatch(value) {
  return value === "transparent" || (typeof value === "string" && value.startsWith("rgba"));
}

function colorSwatchBlockClass(name, hexMap) {
  return isClearSwatch(colorSwatchValue(name, hexMap)) ? "color-swatch-block is-clear" : "color-swatch-block";
}

function colorSwatchBlockStyle(name, hexMap, hexOverride) {
  const value = hexOverride || colorSwatchValue(name, hexMap);
  if (isClearSwatch(value)) return `--swatch-color:${value}`;
  return `--swatch-color:${value}`;
}

function renderColorLabel(name, hexOverride) {
  if (!name) return "—";
  const style = hexOverride ? `--swatch-color:${hexOverride}` : colorSwatchBlockStyle(name);
  const cls = hexOverride
    ? isClearSwatch(hexOverride)
      ? "color-swatch-block is-clear"
      : "color-swatch-block"
    : colorSwatchBlockClass(name);
  return `<span class="color-label"><span class="${cls}" style="${style}"></span><span>${escapeHtml(name)}</span></span>`;
}

function bindInternalPriceAutoFill(form) {
  const extInput = form?.querySelector('[name="unit_price"]');
  const intInput = form?.querySelector('[name="unit_price_internal"]');
  if (!extInput || !intInput) return;
  extInput.addEventListener("input", () => {
    if (intInput.dataset.userEdited === "1") return;
    const val = Number(extInput.value);
    intInput.value = Number.isFinite(val) ? (val * 0.5).toFixed(2) : "";
  });
  intInput.addEventListener("input", () => {
    intInput.dataset.userEdited = "1";
  });
}

let panelColorOutsideCleanup = null;

function initPanelPriceColorField(colors, colorHexMap = {}) {
  const input = document.getElementById("panel-color-input");
  const preview = document.getElementById("panel-color-preview");
  const grid = document.getElementById("panel-color-swatches");
  const picker = document.getElementById("panel-color-picker");
  const hexInput = document.getElementById("panel-color-hex");
  const popover = document.getElementById("panel-color-popover");
  const transparentBtn = document.getElementById("panel-color-transparent");
  if (!input || !grid) return;

  const mergedHexMap = {
    ...colorHexMap,
    [TRANSPARENT_COLOR_NAME]: TRANSPARENT_COLOR_HEX
  };

  function resolveHex(colorName) {
    const name = colorName.trim();
    if (name === TRANSPARENT_COLOR_NAME) return TRANSPARENT_COLOR_HEX;
    if (hexInput?.value && name === input.value.trim()) return hexInput.value;
    return mergedHexMap[name] || "";
  }

  function closePopover() {
    popover?.classList.add("hidden");
  }

  function openPopover() {
    popover?.classList.remove("hidden");
  }

  function syncPreview() {
    const value = input.value.trim();
    const hex = resolveHex(value);
    if (preview) {
      const hexOverride = hex || undefined;
      preview.className = colorSwatchBlockClass(value, mergedHexMap);
      if (hexOverride && isClearSwatch(hexOverride)) {
        preview.className = "color-preview color-swatch-block is-clear";
      }
      preview.style.cssText = colorSwatchBlockStyle(value, mergedHexMap, hexOverride);
      preview.title = value
        ? value === TRANSPARENT_COLOR_NAME
          ? "透明（无 RGB）"
          : `${value}${hex && !isClearSwatch(hex) ? " · " + hex : ""}`
        : "点击选择颜色";
    }
    grid.querySelectorAll(".color-swatch").forEach((el) => {
      el.classList.toggle("active", el.dataset.color === value);
    });
  }

  grid.innerHTML = colors
    .map((c) => {
      const hex = mergedHexMap[c] || "";
      const style = colorSwatchBlockStyle(c, mergedHexMap, hex || undefined);
      return `<button type="button" class="color-swatch" data-color="${escapeAttr(c)}" title="${escapeHtml(c)}">
        <span class="${colorSwatchBlockClass(c, mergedHexMap)}" style="${style}"></span>
        <span class="color-swatch-name">${escapeHtml(c)}</span>
      </button>`;
    })
    .join("");

  grid.querySelectorAll(".color-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      input.value = btn.dataset.color;
      if (hexInput) {
        hexInput.value =
          btn.dataset.color === TRANSPARENT_COLOR_NAME
            ? TRANSPARENT_COLOR_HEX
            : mergedHexMap[btn.dataset.color] || "";
      }
      syncPreview();
      closePopover();
      input.focus();
    });
  });

  preview?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popover?.classList.contains("hidden")) openPopover();
    else closePopover();
  });

  transparentBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    input.value = TRANSPARENT_COLOR_NAME;
    if (hexInput) hexInput.value = TRANSPARENT_COLOR_HEX;
    syncPreview();
    closePopover();
    input.focus();
  });

  picker?.addEventListener("input", () => {
    if (hexInput) hexInput.value = picker.value;
    if (!input.value.trim() || input.value.trim() === TRANSPARENT_COLOR_NAME) {
      input.value = "";
    }
    syncPreview();
  });

  input.addEventListener("input", () => {
    const val = input.value.trim();
    if (hexInput) {
      if (val === TRANSPARENT_COLOR_NAME) {
        hexInput.value = TRANSPARENT_COLOR_HEX;
      } else if (!mergedHexMap[val]) {
        hexInput.value = "";
      } else {
        hexInput.value = mergedHexMap[val];
      }
    }
    syncPreview();
  });

  document.addEventListener("click", onOutsideClick);
  function onOutsideClick(e) {
    if (!popover || popover.classList.contains("hidden")) return;
    if (popover.contains(e.target) || preview?.contains(e.target)) return;
    closePopover();
  }

  syncPreview();

  return () => document.removeEventListener("click", onOutsideClick);
}

async function handlePanelCsvImport(file) {
  const csv = await file.text();
  const preview = await api("/api/price-items/panel/import", {
    method: "POST",
    body: JSON.stringify({ csv, preview: true })
  });
  if (preview.errors?.length) {
    toast(`CSV 有 ${preview.errors.length} 行格式错误，请检查后再导入`, true);
    return;
  }
  const duplicateDecisions = {};
  for (const dup of preview.duplicates || []) {
    const label = `${dup.row.material_type} · ${dup.row.color} · ${dup.row.thickness_mm}mm`;
    const overwrite = confirm(
      `第 ${dup.line} 行与已有条目重复（${label}）。\n确定 = 覆盖已有条目\n取消 = 跳过此行`
    );
    duplicateDecisions[dup.line] = overwrite ? "overwrite" : "skip";
  }
  const result = await api("/api/price-items/panel/import", {
    method: "POST",
    body: JSON.stringify({ csv, duplicateDecisions })
  });
  const s = result.stats || {};
  toast(`导入完成：新增 ${s.created || 0}，覆盖 ${s.overwritten || 0}，跳过 ${s.skipped || 0}`);
  loadPrices("panel");
}

function sortPanelPriceRows(rows, field, dir) {
  if (!field) return rows;
  const mult = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    let av = a[field];
    let bv = b[field];
    if (field === "unit_price") {
      av = Number(a.unit_price) || 0;
      bv = Number(b.unit_price) || 0;
    } else if (field === "thickness_mm") {
      av = Number(a.thickness_mm) || 0;
      bv = Number(b.thickness_mm) || 0;
    } else {
      av = (av ?? "").toString();
      bv = (bv ?? "").toString();
    }
    if (av < bv) return -1 * mult;
    if (av > bv) return 1 * mult;
    return 0;
  });
}

function bindLinkResolver(input) {
  input?.addEventListener("blur", async () => {
    const url = input.value.trim();
    if (!url) return;
    try {
      const data = await api("/api/price-items/resolve-link", {
        method: "POST",
        body: JSON.stringify({ url })
      });
      if (data.hint) toast(data.hint);
    } catch {
      /* ignore */
    }
  });
}

async function saveDetail(id, templateStatus) {
  try {
    if (templateStatus === "published") {
      await api(`/api/templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ tags: [...detailTemplateTags] })
      });
      toast("标签已保存");
      openDetail(id);
      return;
    }
    const body = {
      name: document.getElementById("d-name").value,
      assignee: document.getElementById("d-assignee").value,
      width_mm: numOrNull(document.getElementById("d-w").value),
      depth_mm: numOrNull(document.getElementById("d-d").value),
      height_mm: numOrNull(document.getElementById("d-h").value),
      one_liner: document.getElementById("d-liner").value,
      quote_note: document.getElementById("d-quote-note").value,
      price_override_min: numOrNull(document.getElementById("d-price-min").value),
      price_override_max: numOrNull(document.getElementById("d-price-max").value),
      skin_upgrade_enabled: document.getElementById("d-skin-upgrade").checked,
      internal_note: document.getElementById("d-note").value,
      tags: [...detailTemplateTags]
    };
    const coverSel = document.getElementById("d-cover-source");
    if (coverSel) body.cover_source = coverSel.value;
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

async function updateStatus(id, status, currentStatus) {
  if (currentStatus === "published" && status === "archived") {
    const ok = confirm(
      "确认下架？下架后可修改除标签外的内容；修改完成须重新审核上架（版本 +0.1）。更换 skp 模型时版本 +1。"
    );
    if (!ok) return;
  }
  try {
    await api(`/api/templates/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    toast(status === "archived" ? "已下架，可继续编辑后重新提交审核" : `状态已更新为：${meta.statusLabels[status]}`);
    openDetail(id);
  } catch (e) {
    toast(e.message, true);
  }
}

async function requestRelistTemplate(id) {
  try {
    await api(`/api/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "pending_review" })
    });
    toast("已进入待审核，请在下方「审核发布」完成 checklist 后发布");
    await openDetail(id);
    requestAnimationFrame(() => {
      document.querySelector(".audit-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

async function uploadFile(id, kind, file, { refreshOnly = false } = {}) {
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
    if (refreshOnly) await refreshDetailAssets(id);
    else openDetail(id);
  } catch (e) {
    toast(e.message, true);
  }
}

async function refreshDetailAssets(id) {
  const t = await api(`/api/templates/${id}`);
  const coverInfo = document.getElementById("detail-cover-info");
  if (coverInfo) {
    coverInfo.innerHTML = t.cover_image
      ? `<p class="hint">当前封面：<a href="${t.cover_image}" target="_blank"><img src="${t.cover_image}" alt="" class="cover-thumb" /></a></p>`
      : "";
  }
  const skpInfo = document.getElementById("detail-skp-info");
  if (skpInfo) {
    skpInfo.innerHTML = t.skp_file
      ? `<p class="hint">skp：<a href="${t.skp_file}" target="_blank">${t.skp_file}</a></p>`
      : "";
  }
  const photoGal = document.getElementById("detail-photo-gallery");
  if (photoGal) photoGal.innerHTML = renderImageGallery(t.photo_images);
  const effectGal = document.getElementById("detail-effect-gallery");
  if (effectGal) effectGal.innerHTML = renderImageGallery(t.effect_images);
  const renderGal = document.getElementById("detail-render-gallery");
  if (renderGal) renderGal.innerHTML = renderImageGallery(t.render_images);

  refreshCoverSourcePicker(t, id, document.getElementById("d-cover-source")?.value);
}

function initDetailDropZone({ zoneId, kind, multiple, templateId }) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  const input = zone.querySelector('input[type="file"]');
  const browseBtn = zone.querySelector(".drop-zone-link");

  async function handleFiles(fileList) {
    if (!fileList?.length) return;
    const files = multiple ? [...fileList] : [fileList[0]];
    for (const file of files) {
      if (kind === "skp" && !/\.skp$/i.test(file.name)) {
        toast("仅支持 .skp 文件", true);
        continue;
      }
      await uploadFile(templateId, kind, file, { refreshOnly: true });
    }
  }

  browseBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    input.click();
  });

  zone.addEventListener("click", (e) => {
    if (e.target.closest(".drop-zone-link")) return;
    input.click();
  });

  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });

  input.addEventListener("change", () => {
    handleFiles(input.files);
    input.value = "";
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
    handleFiles(e.dataTransfer?.files);
  });
}

function renderDropZoneHtml({ id, title, hint, accept = "image/*", multiple = false, extraClass = "" }) {
  const cls = ["drop-zone", extraClass].filter(Boolean).join(" ");
  const multiAttr = multiple ? " multiple" : "";
  return `<div class="${cls}" id="${id}" tabindex="0" role="button" aria-label="${escapeAttr(title)}">
    <div class="drop-zone-inner">
      <p class="drop-zone-title">${escapeHtml(title)}</p>
      <p class="drop-zone-hint">${hint || "拖拽图片或"} <button type="button" class="drop-zone-link">选择文件</button></p>
    </div>
    <input type="file" accept="${escapeAttr(accept)}"${multiAttr} hidden />
  </div>`;
}

function initGenericDropZone({ zoneId, onFiles }) {
  const zone = document.getElementById(zoneId);
  if (!zone || !onFiles) return;
  const input = zone.querySelector('input[type="file"]');
  const browseBtn = zone.querySelector(".drop-zone-link");

  async function handleFiles(fileList) {
    if (!fileList?.length) return;
    await onFiles(fileList);
  }

  browseBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    input.click();
  });

  zone.addEventListener("click", (e) => {
    if (e.target.closest(".drop-zone-link")) return;
    input.click();
  });

  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });

  input.addEventListener("change", () => {
    handleFiles(input.files);
    input.value = "";
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
    handleFiles(e.dataTransfer?.files);
  });
}

async function uploadScenarioPicker(scenarioId, file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/scenarios/${scenarioId}/picker`, {
    method: "POST",
    credentials: "include",
    body: fd
  });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error(
      res.status === 404
        ? "封面上传接口不可用，请重启服务后再试"
        : `封面上传失败（${res.status}）`
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "封面上传失败");
  return data;
}

async function uploadScenarioImage(scenarioId, kind, file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  const res = await fetch(`/api/scenarios/${scenarioId}/images`, {
    method: "POST",
    credentials: "include",
    body: fd
  });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error(
      res.status === 404
        ? "上传接口不可用，请重启服务后再试"
        : `上传失败（${res.status}）`
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "上传失败");
  return data;
}

function renderGalleryPosterPreview(t) {
  const price =
    t.price_min != null
      ? `${fmtMoney(t.price_min)}${t.price_max !== t.price_min && t.price_max != null ? " – " + fmtMoney(t.price_max) : ""}`
      : "—";
  const dims =
    t.width_mm && t.depth_mm && t.height_mm
      ? `${t.width_mm}×${t.depth_mm}×${t.height_mm} mm`
      : "";
  const tags = (t.tags || []).length
    ? `<div class="gallery-poster-tags">${t.tags.map((tag) => `<span class="gallery-tag">${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const cover = t.cover_image
    ? `<img class="gallery-poster-cover-img" src="${escapeAttr(t.cover_image)}" alt="" />`
    : `<div class="gallery-poster-cover-placeholder">暂无封面</div>`;

  return `<div class="gallery-poster gallery-poster-preview">
    <div class="gallery-poster-cover">${cover}</div>
    <div class="gallery-poster-info">
      <h3 class="gallery-poster-name">${escapeHtml(t.name)}</h3>
      <div class="gallery-poster-price">${price}</div>
      <p class="gallery-poster-liner">${escapeHtml(t.one_liner || "—")}</p>
      <div class="gallery-poster-secondary">
        <span>${escapeHtml(t.template_code)}</span>
        <span>${escapeHtml(t.scenario)}</span>
        ${dims ? `<span>${escapeHtml(dims)}</span>` : ""}
      </div>
      ${tags}
    </div>
  </div>`;
}

function ensureGalleryPreviewEl() {
  if (!galleryPreviewEl) {
    galleryPreviewEl = document.createElement("div");
    galleryPreviewEl.id = "gallery-poster-popover";
    galleryPreviewEl.className = "gallery-poster-popover hidden";
    galleryPreviewEl.innerHTML = '<div class="gallery-poster-popover-inner"></div>';
    document.body.appendChild(galleryPreviewEl);
  }
  return galleryPreviewEl;
}

function positionGalleryPreview(anchor) {
  const pop = ensureGalleryPreviewEl();
  const rect = anchor.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  let top = rect.bottom + 12;
  left = Math.max(12, Math.min(left, window.innerWidth - popRect.width - 12));
  if (top + popRect.height > window.innerHeight - 12) {
    top = rect.top - popRect.height - 12;
  }
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function bindTemplateThumbPreview(templates) {
  const pop = ensureGalleryPreviewEl();
  const inner = pop.querySelector(".gallery-poster-popover-inner");
  const byId = Object.fromEntries(templates.map((t) => [String(t.id), t]));

  document.querySelectorAll(".scenario-template-thumb[data-template-id]").forEach((thumb) => {
    thumb.addEventListener("mouseenter", () => {
      const t = byId[thumb.dataset.templateId];
      if (!t) return;
      inner.innerHTML = renderGalleryPosterPreview(t);
      pop.classList.remove("hidden");
      requestAnimationFrame(() => positionGalleryPreview(thumb));
    });
    thumb.addEventListener("mouseleave", () => {
      pop.classList.add("hidden");
    });
    thumb.addEventListener("focus", () => {
      const t = byId[thumb.dataset.templateId];
      if (!t) return;
      inner.innerHTML = renderGalleryPosterPreview(t);
      pop.classList.remove("hidden");
      requestAnimationFrame(() => positionGalleryPreview(thumb));
    });
    thumb.addEventListener("blur", () => pop.classList.add("hidden"));
  });
}

function setupPendingCoverDropZone(zoneId, previewId) {
  pendingScenarioCoverFile = null;
  initGenericDropZone({
    zoneId,
    onFiles: async (fileList) => {
      const file = fileList[0];
      if (!file || !/^image\//i.test(file.type)) {
        toast("请上传图片文件", true);
        return;
      }
      pendingScenarioCoverFile = file;
      const preview = document.getElementById(previewId);
      const zone = document.getElementById(zoneId);
      if (preview) {
        preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="" class="scenario-cover-preview-img" />`;
        preview.classList.remove("hidden");
      }
      zone?.classList.add("has-file");
      toast("封面已选择，提交表单后将一并上传");
    }
  });
}

function setupManualToggle(toggleId, selectId, manualId) {
  const toggle = document.getElementById(toggleId);
  const selectFields = document.getElementById(selectId);
  const manualFields = document.getElementById(manualId);
  if (!selectFields || !manualFields) return;
  function sync() {
    const manual = !!toggle?.checked;
    selectFields.classList.toggle("hidden", manual);
    manualFields.classList.toggle("hidden", !manual);
    selectFields.querySelectorAll("input, select").forEach((el) => {
      el.disabled = manual;
    });
    manualFields.querySelectorAll("input, select").forEach((el) => {
      el.disabled = !manual;
    });
  }
  toggle?.addEventListener("change", sync);
  sync();
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
        (l) => `<tr class="${l.custom_price_item_missing ? "row-price-missing" : ""}">
        <td>${l.line_no}</td><td>${l.category}</td><td>${escapeHtml(l.item_name)}${priceMissingBadge(l)}</td>
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

async function addBomLine(templateId, fd, { updatePrice = false } = {}) {
  const body = Object.fromEntries(fd.entries());
  body.qty = Number(body.qty);
  body.unit_price = Number(body.unit_price);
  if (updatePrice) body.update_price = true;
  try {
    await api(`/api/templates/${templateId}/bom`, { method: "POST", body: JSON.stringify(body) });
    toast("BOM 行已添加");
    openDetail(templateId);
  } catch (e) {
    if (e.status === 409 && e.data?.duplicate) {
      const msg =
        e.data.message ||
        `已存在同名非标件（当前单价 ¥${e.data.existing?.unit_price}），是否更新单价并添加？`;
      if (confirm(msg)) return addBomLine(templateId, fd, { updatePrice: true });
      return;
    }
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

function applyLastPanelSelection(panelFilters) {
  if (!lastPanelSelection) return;
  const matEl = document.getElementById("panel-mat");
  const colorEl = document.getElementById("panel-color");
  const thickEl = document.getElementById("panel-thick");
  const specEl = document.getElementById("panel-spec");
  const priceIdEl = document.getElementById("panel-price-id");
  const form = document.getElementById("panel-add-form");
  if (!matEl || !panelFilters.byMaterial[lastPanelSelection.material_type]) return;

  const { material_type, color, thickness_mm, price_item_id } = lastPanelSelection;
  matEl.value = material_type;

  const matData = panelFilters.byMaterial[material_type];
  colorEl.disabled = false;
  colorEl.innerHTML =
    '<option value="">选择颜色…</option>' +
    matData.colors.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  colorEl.value = color;

  const colorItems = matData.items.filter((i) => i.color === color);
  const thicknesses = [...new Set(colorItems.map((i) => i.thickness_mm).filter((x) => x != null))].sort(
    (a, b) => a - b
  );
  thickEl.disabled = false;
  thickEl.innerHTML =
    '<option value="">选择厚度…</option>' +
    thicknesses.map((th) => `<option value="${th}">${th}mm</option>`).join("");
  thickEl.value = thickness_mm;

  const specItems = colorItems.filter((i) => i.thickness_mm === thickness_mm);
  specEl.disabled = false;
  specEl.innerHTML =
    '<option value="">选择规格…</option>' +
    specItems
      .map((i) => {
        const hint = i.pricing_mode === "fixed" ? `${i.unit_price}元/件` : `${i.unit_price}元/㎡`;
        return `<option value="${i.id}">${escapeHtml(i.label)}（${hint}）</option>`;
      })
      .join("");
  specEl.value = String(price_item_id);
  priceIdEl.value = String(price_item_id);

  if (form) {
    const lenInput = form.querySelector('#panel-select-fields input[name="length_inch"]');
    const widInput = form.querySelector('#panel-select-fields input[name="width_inch"]');
    const qtyInput = form.querySelector('#panel-select-fields input[name="qty"]');
    if (lenInput) lenInput.value = "";
    if (widInput) widInput.value = "";
    if (qtyInput) qtyInput.value = "1";
  }
}

let priceLibCategory = "profile";
let panelSort = { field: null, dir: "asc" };
let listSort = { field: null, dir: null };

const STATUS_SORT_ORDER = ["draft", "pending_quote", "pending_review", "published", "archived"];

function scenarioSortIndex(scenario) {
  const idx = (meta.scenarios || []).findIndex((s) => s.value === scenario);
  return idx >= 0 ? idx : 999;
}

function sortTemplateRows(items, field, dir) {
  if (!field || !dir) {
    return [...items].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }
  const mult = dir === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "scenario":
        cmp = scenarioSortIndex(a.scenario) - scenarioSortIndex(b.scenario);
        break;
      case "status":
        cmp =
          (STATUS_SORT_ORDER.indexOf(a.status) >= 0 ? STATUS_SORT_ORDER.indexOf(a.status) : 99) -
          (STATUS_SORT_ORDER.indexOf(b.status) >= 0 ? STATUS_SORT_ORDER.indexOf(b.status) : 99);
        break;
      case "price_min":
        cmp = (Number(a.price_min) || 0) - (Number(b.price_min) || 0);
        break;
      case "assignee": {
        const aa = (a.assignee || "").trim();
        const bb = (b.assignee || "").trim();
        if (!aa && bb) cmp = 1;
        else if (aa && !bb) cmp = -1;
        else cmp = aa.localeCompare(bb, "zh-CN");
        break;
      }
      default:
        cmp = 0;
    }
    if (cmp === 0) return (b.created_at || "").localeCompare(a.created_at || "");
    return cmp * mult;
  });
}

function cycleListSort(field) {
  if (listSort.field !== field) {
    listSort.field = field;
    listSort.dir = "asc";
  } else if (listSort.dir === "asc") {
    listSort.dir = "desc";
  } else {
    listSort.field = null;
    listSort.dir = null;
  }
  loadList();
}

function renderListSortableTh(label, field, current) {
  const active = current.field === field && current.dir;
  const arrow = active ? (current.dir === "asc" ? " ↑" : " ↓") : "";
  return `<th><button type="button" class="sortable-th" data-list-sort="${field}">${label}${arrow}</button></th>`;
}

function renderListCover(t) {
  if (t.cover_image) {
    return `<img class="list-cover-thumb clickable" data-id="${t.id}" src="${escapeAttr(t.cover_image)}" alt="" width="72" height="72" loading="lazy" />`;
  }
  return `<span class="list-cover-placeholder clickable" data-id="${t.id}">无</span>`;
}

function renderSortableTh(label, field, current, thClass = "") {
  const active = current.field === field;
  const arrow = active ? (current.dir === "asc" ? " ↑" : " ↓") : "";
  const cls = thClass ? ` ${thClass}` : "";
  return `<th class="sortable-th-wrap${cls}"><button type="button" class="sortable-th" data-sort-field="${field}">${label}${arrow}</button></th>`;
}

function renderPriceForm(category, extra = {}) {
  const wrap = document.getElementById("price-form-wrap");
  if (category === "profile") {
    const formula = extra.formula || extra;
    const profileColors = extra.profileColors || [];
    wrap.innerHTML = `<div class="profile-formula-card">
      <p class="formula-hint">${escapeHtml(meta.profileFormulaNote || "")}</p>
      <p class="hint">型材颜色仅用于清单标注，<strong>银色与木色单价相同</strong>（均按上方公式计算）。</p>
      ${canAdmin() ? `<form id="profile-formula-form" class="hardware-add">
        <label>rate<input name="rate" type="number" step="0.001" value="${formula.rate}" required /></label>
        <label>base<input name="base" type="number" step="1" value="${formula.base}" required /></label>
        <button type="submit" class="btn primary">保存公式</button>
      </form>` : ""}
      <div class="hardware-add">
        <label>试算长度(in)<input id="profile-formula-preview-len" type="number" step="0.1" placeholder="如 31.1" /></label>
        <input id="profile-formula-preview-out" readonly placeholder="自动计算" />
      </div>
      ${formula.updated_at ? `<p class="hint">最后更新：${formula.updated_at.slice(0, 16)}${formula.updated_by ? " · " + escapeHtml(formula.updated_by) : ""}</p>` : ""}
      <h4 class="profile-colors-heading">型材颜色</h4>
      ${canManagePrices() ? `<form id="profile-color-add-form" class="hardware-add profile-color-add">
        <label>颜色名称<input name="name" required placeholder="如 黑色" maxlength="32" /></label>
        <button type="submit" class="btn primary">添加颜色</button>
      </form>` : ""}
      <p class="hint">管理员可添加或停用颜色；停用后不可在新行中选择，已有行仍保留原颜色。</p>
    </div>`;

    const lenInput = document.getElementById("profile-formula-preview-len");
    const outInput = document.getElementById("profile-formula-preview-out");
    async function refreshFormulaPreview() {
      const len = lenInput?.value;
      if (!len) return (outInput.value = "");
      try {
        const p = await api(
          `/api/pricing/preview-profile?length_inch=${encodeURIComponent(len)}&qty=1&coefficient=1`
        );
        outInput.value = `出厂 ${p.factory_price} → 对外 ${p.quote_unit}`;
      } catch {
        outInput.value = "";
      }
    }
    lenInput?.addEventListener("input", refreshFormulaPreview);

    document.getElementById("profile-formula-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api("/api/pricing/profile-formula", {
        method: "PATCH",
        body: JSON.stringify({ rate: Number(fd.get("rate")), base: Number(fd.get("base")) })
      });
      toast("已更新，所有模板型材报价将按新公式计算");
      loadPrices("profile");
    });

    document.getElementById("profile-color-add-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = (fd.get("name") || "").toString().trim();
      if (!name) {
        toast("请填写颜色名称", true);
        return;
      }
      await api("/api/profile-colors", { method: "POST", body: JSON.stringify({ name }) });
      toast("已添加型材颜色");
      const m = await api("/api/meta");
      meta.profileColors = m.profileColors;
      loadPrices("profile");
    });
    return;
  }

  if (category === "custom") {
    wrap.innerHTML = `<p class="hint">非标件由模板详情「其他」Tab 录入时自动同步至此。管理员可将条目转移至五金配件。</p>`;
    return;
  }

  if (category === "supplier") {
    wrap.innerHTML = `<div class="supplier-lib-header">
      <p class="hint">自动汇总<strong>五金配件</strong>与<strong>板材</strong>中填写的供应商名称。可在此维护联系人、联系电话与备注；新增单价条目时会自动收录。</p>
      <button type="button" class="btn" id="supplier-sync-btn">从单价条目同步</button>
    </div>`;
    document.getElementById("supplier-sync-btn")?.addEventListener("click", async () => {
      const data = await api("/api/suppliers/sync", { method: "POST" });
      toast(data.added ? `已同步，新增 ${data.added} 个供应商` : "已同步，无新增供应商");
      loadPrices("supplier");
    });
    return;
  }

  if (category === "nut") {
    wrap.innerHTML = `<form id="price-add-form" class="hardware-add">
      <label>名称<input name="label" required placeholder="六通 OL2525" /></label>
      <label>型号<input name="nut_model" required placeholder="OL2525" /></label>
      <label>对外单价<input name="unit_price" type="number" step="0.01" required /></label>
      <label>对内单价<input name="unit_price_internal" type="number" step="0.01" placeholder="默认对外×0.5" /></label>
      <button type="submit" class="btn primary">添加六通</button>
    </form>`;
  } else if (category === "hardware") {
    wrap.innerHTML = `<form id="price-add-form" class="hardware-add hardware-add-wide">
      <label>名称<input name="label" required placeholder="地脚" /></label>
      <label>规格<input name="spec" placeholder="500×20" /></label>
      <label>单位<select name="unit">${meta.bomUnits.map((u) => `<option>${u}</option>`).join("")}</select></label>
      <label>对外单价<input name="unit_price" type="number" step="0.01" required /></label>
      <label>对内单价<input name="unit_price_internal" type="number" step="0.01" placeholder="默认对外×0.5" /></label>
      <label>链接<input name="link" id="hardware-link-input" placeholder="采购链接（可选）" /></label>
      <label>供应商<input name="supplier" required placeholder="必填" /></label>
      <button type="submit" class="btn primary">添加五金</button>
    </form>`;
  } else {
    const panelRows = Array.isArray(extra) ? extra : extra.rows || [];
    const materials = mergeUnique(
      meta.panelMaterialTypes || [],
      panelRows.map((r) => r.material_type)
    ).sort((a, b) => a.localeCompare(b, "zh-CN"));
    const colors = mergeUnique(
      meta.panelColorSuggestions || [],
      panelRows.map((r) => r.color)
    ).sort((a, b) => a.localeCompare(b, "zh-CN"));
    const colorHexMap = buildPanelColorHexMap(panelRows);
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
      <label>对内单价<input name="unit_price_internal" type="number" step="0.01" placeholder="默认对外×0.5" /></label>
      <label>供应商<input name="supplier" required placeholder="必填" /></label>
      <div class="panel-form-actions">
        <button type="submit" class="btn primary">添加板材</button>
        <label class="btn primary panel-csv-upload-btn">上传 CSV<input type="file" id="panel-csv-upload" accept=".csv,text/csv" hidden /></label>
        <button type="button" class="btn panel-csv-download-btn" id="panel-csv-download">下载 CSV 模板</button>
      </div>
      <div class="panel-color-section">
        <label class="color-field">
          颜色
          <div class="color-input-wrap">
            <span class="color-preview color-swatch-block" id="panel-color-preview" title="点击选择颜色"></span>
            <div class="color-picker-popover hidden" id="panel-color-popover">
              <label class="color-picker-rgb-label">
                RGB 色轮
                <input type="color" id="panel-color-picker" value="#cccccc" />
              </label>
              <button type="button" class="color-transparent-option" id="panel-color-transparent">
                <span class="color-swatch-block is-clear color-transparent-swatch"></span>
                <span>透明</span>
              </button>
            </div>
            <input name="color" id="panel-color-input" required placeholder="色块选色或输入颜色名" autocomplete="off" />
            <input type="hidden" name="color_hex" id="panel-color-hex" />
          </div>
        </label>
        <div class="color-swatch-grid" id="panel-color-swatches"></div>
      </div>
    </form>`;
    if (panelColorOutsideCleanup) panelColorOutsideCleanup();
    panelColorOutsideCleanup = initPanelPriceColorField(colors, colorHexMap);
    document.getElementById("panel-csv-download")?.addEventListener("click", () => {
      window.open("/api/price-items/panel/csv-template", "_blank");
    });
    document.getElementById("panel-csv-upload")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await handlePanelCsvImport(file);
      } catch (err) {
        toast(err.message, true);
      }
      e.target.value = "";
    });
  }

  const addForm = document.getElementById("price-add-form");
  bindInternalPriceAutoFill(addForm);
  bindLinkResolver(document.getElementById("hardware-link-input"));

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.category = category;
    body.unit = body.unit || (category === "panel" ? "块" : "个");
    if (category === "panel") {
      body.material_type = body.material_type?.trim();
      body.color = body.color?.trim();
      body.supplier = body.supplier?.trim();
      if (!body.material_type || !body.color) {
        toast("请填写材质与颜色", true);
        return;
      }
      if (!body.supplier) {
        toast("请填写供应商", true);
        return;
      }
      if (!body.label) {
        body.label = `${body.material_type} · ${body.color} · ${body.thickness_mm}mm`;
      }
    }
    if (category === "hardware" && !body.supplier?.trim()) {
      toast("请填写供应商", true);
      return;
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

  const wrap = document.getElementById("price-table-wrap");

  if (category === "profile") {
    const [formula, profileColors] = await Promise.all([
      api("/api/pricing/profile-formula"),
      api("/api/profile-colors?all=1")
    ]);
    renderPriceForm(category, { formula, profileColors });
    wrap.innerHTML = profileColors.length
      ? `<table class="profile-colors-table"><thead><tr>
        <th class="seq-col">#</th><th>颜色</th><th>状态</th><th>引用行数</th><th>操作</th>
      </tr></thead><tbody>${profileColors
        .map(
          (c, i) => `<tr class="${c.active ? "" : "row-inactive"}">
          <td class="seq-col">${i + 1}</td>
          <td>${escapeHtml(c.name)}</td>
          <td>${c.active ? "启用" : "已停用"}</td>
          <td>${c.usage_count ?? 0}</td>
          <td>${
            canManagePrices()
              ? `<button type="button" class="btn" data-profile-color-toggle="${c.id}" data-active="${c.active ? "0" : "1"}">${c.active ? "停用" : "启用"}</button>`
              : "—"
          }</td>
        </tr>`
        )
        .join("")}</tbody></table>`
      : '<p class="hint">暂无型材颜色，请添加。</p>';
    wrap.querySelectorAll("[data-profile-color-toggle]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.profileColorToggle;
        const active = btn.dataset.active === "1";
        await api(`/api/profile-colors/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ active })
        });
        toast(active ? "已启用" : "已停用");
        const m = await api("/api/meta");
        meta.profileColors = m.profileColors;
        loadPrices("profile");
      });
    });
    return;
  }

  if (category === "supplier") {
    const rows = await api("/api/suppliers");
    renderPriceForm(category);
    wrap.innerHTML = rows.length
      ? `<table><thead><tr>
        <th class="seq-col">#</th><th>供应商名称</th><th>引用条目</th>
        <th>联系人</th><th>联系电话</th><th>备注</th>
      </tr></thead><tbody>${rows
        .map(
          (r, i) => `<tr>
          <td class="seq-col">${i + 1}</td>
          <td>${escapeHtml(r.name)}</td>
          <td>${r.item_count}</td>
          <td><input value="${escapeAttr(r.contact)}" data-supplier-field="contact" data-supplier-id="${r.id}" placeholder="联系人" /></td>
          <td><input value="${escapeAttr(r.phone)}" data-supplier-field="phone" data-supplier-id="${r.id}" placeholder="电话" /></td>
          <td><input class="input-full" value="${escapeAttr(r.note)}" data-supplier-field="note" data-supplier-id="${r.id}" placeholder="备注" /></td>
        </tr>`
        )
        .join("")}</tbody></table>`
      : '<p class="hint">暂无供应商。请先在五金配件或板材 Tab 填写供应商，再点击「从单价条目同步」。</p>';

    wrap.querySelectorAll("[data-supplier-field]").forEach((el) => {
      el.addEventListener("change", async () => {
        const id = el.dataset.supplierId;
        const field = el.dataset.supplierField;
        await api(`/api/suppliers/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ [field]: el.value })
        });
        toast("供应商信息已更新");
      });
    });
    return;
  }

  if (category === "custom") {
    const rows = await api("/api/price-items/custom?all=1");
    renderPriceForm(category);
    wrap.innerHTML = `<table class="price-lib-table price-lib-custom"><thead><tr><th class="seq-col">#</th><th>类别</th><th>项目</th><th>规格</th><th>单位</th><th class="col-price">对外价</th><th class="col-price">对内价</th><th>备注</th><th>启用</th><th></th></tr></thead><tbody>${rows
      .map(
        (r, i) => `<tr>
        <td class="seq-col">${i + 1}</td>
        <td><input value="${escapeAttr(r.source_category)}" data-custom-field="source_category" data-custom-id="${r.id}" /></td>
        <td><input value="${escapeAttr(r.item_name)}" data-custom-field="item_name" data-custom-id="${r.id}" /></td>
        <td>${escapeHtml(r.spec || "—")}</td>
        <td>${r.unit}</td>
        <td class="col-price"><input class="input-price-xs" type="number" step="0.01" value="${r.unit_price}" data-custom-field="unit_price" data-custom-id="${r.id}" /></td>
        <td class="col-price"><input class="input-price-xs" type="number" step="0.01" value="${r.unit_price_internal ?? r.unit_price * 0.5}" data-custom-field="unit_price_internal" data-custom-id="${r.id}" /></td>
        <td><input class="input-full" value="${escapeAttr(r.note || "")}" data-custom-field="note" data-custom-id="${r.id}" placeholder="备注" /></td>
        <td><input type="checkbox" ${r.enabled ? "checked" : ""} data-custom-field="enabled" data-custom-id="${r.id}" /></td>
        <td>${canAdmin() ? `<button type="button" class="btn" data-promote-custom="${r.id}" data-name="${escapeAttr(r.item_name)}" data-spec="${escapeAttr(r.spec || "")}" data-price="${r.unit_price}">转移至五金配件</button>` : ""}</td>
      </tr>`
      )
      .join("")}</tbody></table>`;

    wrap.querySelectorAll("[data-custom-field]").forEach((el) => {
      el.addEventListener("change", async () => {
        const id = el.dataset.customId;
        const field = el.dataset.customField;
        let val = el.type === "checkbox" ? el.checked : el.value;
        if (field === "unit_price" || field === "unit_price_internal") val = Number(val);
        const data = await api(`/api/price-items/custom/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ [field]: val })
        });
        if (data.propagation?.total) {
          toast(`非标件已更新，已同步 ${data.propagation.total} 条 BOM 行`);
        } else {
          toast("非标件已更新");
        }
      });
    });
    wrap.querySelectorAll("[data-promote-custom]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const label = prompt("五金配件名称", btn.dataset.name);
        if (label == null) return;
        const spec = prompt("规格", btn.dataset.spec) ?? "";
        const priceStr = prompt("对外单价", btn.dataset.price);
        if (priceStr == null) return;
        const supplier = prompt("供应商（必填）", "");
        if (supplier == null || !supplier.trim()) {
          toast("转移五金配件需填写供应商", true);
          return;
        }
        try {
          await api(`/api/price-items/custom/${btn.dataset.promoteCustom}/promote`, {
            method: "POST",
            body: JSON.stringify({
              label: label.trim(),
              spec,
              unit_price: Number(priceStr),
              supplier: supplier.trim()
            })
          });
          toast("已转移至五金配件，新条目可在五金 Tab 选取");
          loadPrices("custom");
        } catch (e) {
          toast(e.message, true);
        }
      });
    });
    return;
  }

  const rows = await api(`/api/price-items?category=${category}&all=1`);
  renderPriceForm(category, category === "panel" ? rows : []);

  if (category === "nut") {
    wrap.innerHTML = `<table><thead><tr><th class="seq-col">#</th><th>名称</th><th>型号</th><th>对外价</th><th>对内价</th><th>启用</th><th></th></tr></thead><tbody>${rows
      .map(
        (r, i) => `<tr>
        <td class="seq-col">${i + 1}</td>
        <td><input class="input-full" value="${escapeAttr(r.label)}" data-field="label" data-id="${r.id}" /></td>
        <td><input value="${escapeAttr(r.nut_model)}" data-field="nut_model" data-id="${r.id}" /></td>
        <td><input class="input-narrow" type="number" step="0.01" value="${r.unit_price}" data-field="unit_price" data-id="${r.id}" /></td>
        <td><input class="input-narrow" type="number" step="0.01" value="${r.unit_price_internal ?? r.unit_price * 0.5}" data-field="unit_price_internal" data-id="${r.id}" /></td>
        <td><input type="checkbox" ${r.enabled ? "checked" : ""} data-field="enabled" data-id="${r.id}" /></td>
        <td><button type="button" class="btn danger" data-del-price="${r.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody></table>`;
  } else if (category === "hardware") {
    wrap.innerHTML = `<table class="price-lib-table price-lib-hardware"><thead><tr>
      <th class="seq-col">#</th>
      <th class="col-hw-name">名称</th>
      <th class="col-hw-spec">规格</th>
      <th class="col-hw-unit">单位</th>
      <th class="col-price">对外价</th>
      <th class="col-price">对内价</th>
      <th class="col-hw-link">链接</th>
      <th class="col-hw-supplier">供应商</th>
      <th>启用</th><th></th>
    </tr></thead><tbody>${rows
      .map(
        (r, i) => `<tr>
        <td class="seq-col">${i + 1}</td>
        <td class="col-hw-name"><input value="${escapeAttr(r.label)}" data-field="label" data-id="${r.id}" /></td>
        <td class="col-hw-spec"><input value="${escapeAttr(r.spec)}" data-field="spec" data-id="${r.id}" /></td>
        <td class="col-hw-unit">${r.unit}</td>
        <td class="col-price"><input class="input-price-xs" type="number" step="0.01" value="${r.unit_price}" data-field="unit_price" data-id="${r.id}" /></td>
        <td class="col-price"><input class="input-price-xs" type="number" step="0.01" value="${r.unit_price_internal ?? r.unit_price * 0.5}" data-field="unit_price_internal" data-id="${r.id}" /></td>
        <td class="col-hw-link"><input value="${escapeAttr(r.link || "")}" data-field="link" data-id="${r.id}" data-link-field="1" placeholder="采购链接" /></td>
        <td class="col-hw-supplier"><input value="${escapeAttr(r.supplier || "")}" data-field="supplier" data-id="${r.id}" required placeholder="必填" /></td>
        <td><input type="checkbox" ${r.enabled ? "checked" : ""} data-field="enabled" data-id="${r.id}" /></td>
        <td><button type="button" class="btn danger" data-del-price="${r.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody></table>`;
    wrap.querySelectorAll("[data-link-field]").forEach((el) => bindLinkResolver(el));
  } else {
    const sorted = sortPanelPriceRows(rows, panelSort.field, panelSort.dir);
    wrap.innerHTML = `<table class="price-lib-table price-lib-panel"><thead><tr>
      <th class="seq-col">#</th>
      ${renderSortableTh("材质", "material_type", panelSort, "col-panel-mat")}
      ${renderSortableTh("颜色", "color", panelSort, "col-panel-color")}
      ${renderSortableTh("厚度", "thickness_mm", panelSort)}
      <th class="col-panel-mode">计价</th>
      ${renderSortableTh("对外价", "unit_price", panelSort, "col-price")}
      <th class="col-price sortable-th-wrap">对内价</th>
      <th>名称</th>
      ${renderSortableTh("供应商", "supplier", panelSort)}
      <th>启用</th><th></th>
    </tr></thead><tbody>${sorted
      .map(
        (r, i) => `<tr>
        <td class="seq-col">${i + 1}</td>
        <td class="col-panel-mat">${escapeHtml(r.material_type)}</td>
        <td class="col-panel-color">${renderColorLabel(r.color, r.color_hex)}</td>
        <td>${r.thickness_mm}mm</td>
        <td class="col-panel-mode">${r.pricing_mode === "fixed" ? "件价" : "㎡"}</td>
        <td class="col-price"><input class="input-price-xs" type="number" step="0.01" value="${r.unit_price}" data-field="unit_price" data-id="${r.id}" /></td>
        <td class="col-price"><input class="input-price-xs" type="number" step="0.01" value="${r.unit_price_internal ?? r.unit_price * 0.5}" data-field="unit_price_internal" data-id="${r.id}" /></td>
        <td><input class="input-full" value="${escapeAttr(r.label)}" data-field="label" data-id="${r.id}" /></td>
        <td><input value="${escapeAttr(r.supplier || "")}" data-field="supplier" data-id="${r.id}" required placeholder="必填" /></td>
        <td><input type="checkbox" ${r.enabled ? "checked" : ""} data-field="enabled" data-id="${r.id}" /></td>
        <td><button type="button" class="btn danger" data-del-price="${r.id}">删</button></td>
      </tr>`
      )
      .join("")}</tbody></table>`;

    wrap.querySelectorAll("[data-sort-field]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const field = btn.dataset.sortField;
        if (panelSort.field === field) {
          panelSort.dir = panelSort.dir === "asc" ? "desc" : "asc";
        } else {
          panelSort.field = field;
          panelSort.dir = "asc";
        }
        loadPrices("panel");
      });
    });
  }

  wrap.querySelectorAll("[data-field]").forEach((el) => {
    el.addEventListener("change", async () => {
      const id = el.dataset.id;
      const field = el.dataset.field;
      let val = el.type === "checkbox" ? el.checked : el.value;
      if (field === "unit_price" || field === "unit_price_internal") val = Number(val);
      try {
        const data = await api(`/api/price-items/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: val }) });
        if (data.propagation?.total) {
          toast(`单价库已更新，已同步 ${data.propagation.total} 条报价行`);
        } else {
          toast("单价库已更新");
        }
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
  wrap.querySelectorAll("[data-del-price]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确定删除该单价项？")) return;
      try {
        await api(`/api/price-items/${btn.dataset.delPrice}`, { method: "DELETE" });
        toast("已删除");
        loadPrices(category);
      } catch (err) {
        if (err.status === 409 && err.data?.references) {
          const refs = [
            ...(err.data.references.nuts || []),
            ...(err.data.references.hardware || []),
            ...(err.data.references.panels || [])
          ];
          const codes = [...new Set(refs.map((r) => r.template_code))].join("、");
          toast(`无法删除：已被模板引用（${codes}）`, true);
        } else {
          toast(err.message, true);
        }
      }
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
      if (view === "scenarios") await loadScenarios();
      if (view === "tags") await loadTagCloud();
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
    const skp = selectedSkpFile || fd.get("skp");
    if (!skp || !skp.name) {
      toast("请选择或拖拽 skp 文件", true);
      return;
    }
    const scenario = fd.get("scenario") || selectedCreateScenario;
    if (!scenario) {
      toast("请选择应用场景", true);
      return;
    }
    const skpBaseName = skp.name.replace(/\.skp$/i, "");
    const uploadFd = new FormData();
    uploadFd.append("skp", skp, skp.name);
    uploadFd.append("skpBaseName", skpBaseName);
    uploadFd.append("scenario", scenario);

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
      selectedCreateScenario = null;
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

  selectedSkpFile = file;
  if (!isSkpFile(file)) {
    toast("仅支持 .skp 文件", true);
    input.value = "";
    selectedSkpFile = null;
    return false;
  }

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;

  nameEl.textContent = file.name;
  inner.classList.add("hidden");
  selected.classList.remove("hidden");
  zone.classList.add("has-file");
  renderCreateScenarioPicker();
  return true;
}

function resetSkpDropZone() {
  const input = document.getElementById("skp-input");
  const zone = document.getElementById("skp-drop-zone");
  const inner = document.getElementById("skp-drop-inner");
  const selected = document.getElementById("skp-selected");

  input.value = "";
  selectedSkpFile = null;
  inner.classList.remove("hidden");
  selected.classList.add("hidden");
  zone.classList.remove("has-file", "is-dragover");
  selectedCreateScenario = null;
  document.getElementById("scenario-picker-wrap")?.classList.add("hidden");
  document.getElementById("scenario-select").value = "";
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
  bindListTagFilter();
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

function renderCreateScenarioPicker() {
  const wrap = document.getElementById("scenario-picker-wrap");
  const grid = document.getElementById("scenario-picker-grid");
  const select = document.getElementById("scenario-select");
  if (!wrap || !grid || !meta?.scenarios) return;

  const items = meta.scenarios.filter((s) => s.enabled !== false);
  wrap.classList.remove("hidden");
  grid.innerHTML = items
    .map((s) => {
      const display = s.picker_display || s.picker_image;
      const img = display
        ? `<img src="${escapeAttr(display)}" alt="" />`
        : `<div class="scenario-pick-placeholder">${escapeHtml(s.code)}</div>`;
      const selected = selectedCreateScenario === s.value ? " selected" : "";
      return `<button type="button" class="scenario-pick-card${selected}" data-scenario-name="${escapeAttr(s.value)}">
        ${img}
        <div class="scenario-pick-label"><strong>${escapeHtml(s.value)}</strong>${escapeHtml(s.code)}</div>
      </button>`;
    })
    .join("");

  grid.querySelectorAll(".scenario-pick-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedCreateScenario = btn.dataset.scenarioName;
      select.value = selectedCreateScenario;
      grid.querySelectorAll(".scenario-pick-card").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
  });

  if (selectedCreateScenario) select.value = selectedCreateScenario;
}

function renderScenarioListCard(s) {
  const display = s.picker_display || s.picker_image;
  const img = display
    ? `<img class="gallery-poster-cover-img" src="${escapeAttr(display)}" alt="" />`
    : `<div class="gallery-poster-cover-placeholder">${escapeHtml(s.code)}</div>`;
  return `<article class="gallery-card">
    <div class="gallery-poster gallery-poster-clickable" data-scenario-id="${s.id}">
      <div class="gallery-poster-cover">${img}</div>
      <div class="gallery-poster-info">
        <h3 class="gallery-poster-name">${escapeHtml(s.name)}</h3>
        <div class="gallery-poster-price">${escapeHtml(s.code)}</div>
        <p class="gallery-poster-liner">${s.image_count || 0} 张场景图 · ${s.published_template_count || 0} 个已发布模板</p>
        <div class="gallery-poster-secondary">
          ${s.enabled ? "" : `<span>已禁用</span>`}
          ${s.description ? `<span>${escapeHtml(s.description.slice(0, 24))}${s.description.length > 24 ? "…" : ""}</span>` : ""}
        </div>
      </div>
      <div class="gallery-poster-overlay" aria-hidden="true">
        <button type="button" class="btn primary gallery-overlay-btn" data-handbook="${s.id}">下载场景手册</button>
      </div>
    </div>
  </article>`;
}

async function loadScenarios() {
  const items = await api("/api/scenarios");
  const grid = document.getElementById("scenario-list-grid");
  const adminBar = document.getElementById("scenario-admin-bar");

  if (canAdmin()) {
    adminBar.classList.remove("hidden");
    adminBar.innerHTML = `<form id="scenario-add-form" class="hardware-add full">
      <label>场景名称<input name="name" required placeholder="如 快闪店" /></label>
      <label>代码(2位)<input name="code" required maxlength="2" pattern="[A-Za-z]{2}" placeholder="KS" /></label>
      <label>slug 前缀<input name="slug_prefix" required placeholder="kuaishandian" /></label>
      <label>简介<input name="description" placeholder="可选" /></label>
      <button type="submit" class="btn primary">添加场景</button>
    </form>
    <div class="scenario-add-cover card">
      <h3>场景封面（可选）</h3>
      <p class="hint">封面仅用于卡片展示，不可标记模板；缺失时将显示首张效果图。</p>
      ${renderDropZoneHtml({ id: "scenario-add-picker-drop", title: "拖拽封面图到此处", extraClass: "scenario-cover-drop" })}
      <div id="scenario-add-cover-preview" class="scenario-cover-preview hidden"></div>
    </div>`;
    setupPendingCoverDropZone("scenario-add-picker-drop", "scenario-add-cover-preview");
    document.getElementById("scenario-add-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const created = await api("/api/scenarios", {
          method: "POST",
          body: JSON.stringify({
            name: fd.get("name"),
            code: String(fd.get("code")).toUpperCase(),
            slug_prefix: fd.get("slug_prefix"),
            description: fd.get("description")
          })
        });
        if (pendingScenarioCoverFile) {
          await uploadScenarioPicker(created.id, pendingScenarioCoverFile);
          pendingScenarioCoverFile = null;
        }
        toast("场景已添加");
        e.target.reset();
        document.getElementById("scenario-add-cover-preview")?.classList.add("hidden");
        document.getElementById("scenario-add-picker-drop")?.classList.remove("has-file");
        await loadMeta();
        loadScenarios();
      } catch (err) {
        toast(err.message, true);
      }
    });
  } else {
    adminBar.classList.add("hidden");
  }

  if (!items.length) {
    grid.innerHTML = '<div class="card">暂无场景。</div>';
    return;
  }

  grid.innerHTML = items.map((s) => renderScenarioListCard(s)).join("");

  grid.querySelectorAll("[data-scenario-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-handbook]")) return;
      openScenarioDetail(Number(el.dataset.scenarioId));
    });
  });

  grid.querySelectorAll("[data-handbook]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      try {
        const s = items.find((x) => x.id === Number(btn.dataset.handbook));
        await downloadExport(`/api/scenarios/${btn.dataset.handbook}/handbook.pdf`, `${s.code}_场景手册.pdf`);
        toast("场景手册已下载");
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function openScenarioDetail(id) {
  currentScenarioId = id;
  switchView("scenario-detail");
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
  document.querySelector('.nav-item[data-view="scenarios"]')?.classList.add("active");
  loadScenarioDetail(id).catch((err) => {
    toast(err.message || "加载场景详情失败", true);
    switchView("scenarios");
  });
}

async function loadScenarioDetail(id) {
  const data = await api(`/api/scenarios/${id}`);
  const root = document.getElementById("scenario-detail-root");
  if (!root) return;
  const templates = data.published_templates || [];
  const coverDisplay = data.picker_image || data.picker_display;
  const coverHint = !data.picker_image && data.picker_display ? "当前显示为首张效果图" : "";

  const coverBlock = coverDisplay
    ? `<div class="scenario-detail-cover-img">
        <img src="${escapeAttr(coverDisplay)}" alt="" />
        ${coverHint ? `<p class="hint scenario-cover-fallback-hint">${coverHint}</p>` : ""}
      </div>`
    : `<div class="scenario-detail-cover-img scenario-detail-cover-empty">
        <div class="gallery-poster-cover-placeholder">${escapeHtml(data.code)}</div>
      </div>`;

  const adminCoverUpload = canAdmin()
    ? `<div class="scenario-cover-upload">
        <p class="hint">封面仅用于展示，不可标记模板。</p>
        ${renderDropZoneHtml({ id: "scenario-picker-drop", title: "拖拽上传场景封面", extraClass: "scenario-cover-drop detail-drop-zone" })}
        ${data.picker_image ? `<button type="button" class="btn danger" id="scenario-picker-clear">移除封面</button>` : ""}
      </div>`
    : "";

  const templateThumbs = templates.length
    ? `<div class="scenario-template-thumbs">
        <span class="scenario-template-thumbs-label">已发布模板 ${templates.length}</span>
        <div class="scenario-template-thumb-row">
          ${templates
            .map((t) => {
              const thumb = t.cover_image
                ? `<img src="${escapeAttr(t.cover_image)}" alt="" loading="lazy" />`
                : `<span class="scenario-template-thumb-placeholder">${escapeHtml(t.template_code.slice(-2))}</span>`;
              return `<button type="button" class="scenario-template-thumb" data-template-id="${t.id}" title="${escapeAttr(t.template_code + " · " + t.name)}" tabindex="0">${thumb}</button>`;
            })
            .join("")}
        </div>
      </div>`
    : `<p class="hint scenario-template-thumbs-empty">暂无已发布模板</p>`;

  const uploadBlock = canWrite()
    ? `<div class="card">
        <h3>上传场景图</h3>
        <p class="hint">效果图 / 渲染图可点击进入标记编辑；封面图请使用上方专用上传区。</p>
        <div class="detail-drop-zones">
          ${renderDropZoneHtml({ id: "scenario-drop-effect", title: "效果图", extraClass: "detail-drop-zone", multiple: true })}
          ${renderDropZoneHtml({ id: "scenario-drop-render", title: "渲染图", extraClass: "detail-drop-zone", multiple: true })}
        </div>
      </div>`
    : "";

  root.innerHTML = `
    <div class="card detail-header scenario-detail-header">
      <div class="scenario-detail-cover-wrap">
        ${coverBlock}
        ${adminCoverUpload}
      </div>
      <div class="scenario-detail-main">
        <div class="detail-code">${escapeHtml(data.code)} · ${data.image_count} 张场景图 · ${data.published_template_count} 个已发布模板</div>
        <h2>${escapeHtml(data.name)}</h2>
        ${data.description ? `<p class="hint">${escapeHtml(data.description)}</p>` : ""}
        ${templateThumbs}
      </div>
    </div>
    ${uploadBlock}
    <div class="gallery-grid" id="scenario-images-grid">${(data.images || [])
      .map(
        (img) => `<article class="gallery-card scenario-image-card" data-image-id="${img.id}">
        <div class="gallery-poster">
          <div class="gallery-poster-cover"><img class="gallery-poster-cover-img" src="${escapeAttr(img.file_path)}" alt="" /></div>
          <div class="gallery-poster-info">
            <h3 class="gallery-poster-name">${escapeHtml(img.kind_label)}</h3>
            <p class="gallery-poster-liner">${escapeHtml(img.title || "—")}</p>
            <div class="gallery-poster-secondary"><span>${(img.markers || []).length} 个标记</span></div>
          </div>
        </div>
      </article>`
      )
      .join("") || '<p class="hint">暂无场景图，请拖拽上传。</p>'}
    </div>`;

  root.querySelectorAll("[data-image-id]").forEach((card) => {
    card.addEventListener("click", () => openScenarioMarkers(Number(card.dataset.imageId)));
  });

  bindTemplateThumbPreview(templates);

  if (canAdmin()) {
    initGenericDropZone({
      zoneId: "scenario-picker-drop",
      onFiles: async (fileList) => {
        const file = fileList[0];
        if (!file || !/^image\//i.test(file.type)) {
          toast("请上传图片文件", true);
          return;
        }
        try {
          await uploadScenarioPicker(id, file);
          toast("封面已更新");
          loadScenarioDetail(id);
          loadMeta();
        } catch (err) {
          toast(err.message, true);
        }
      }
    });

    document.getElementById("scenario-picker-clear")?.addEventListener("click", async () => {
      try {
        await api(`/api/scenarios/${id}/picker`, { method: "DELETE" });
        toast("封面已移除");
        loadScenarioDetail(id);
        loadMeta();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  if (canWrite()) {
    initGenericDropZone({
      zoneId: "scenario-drop-effect",
      onFiles: async (fileList) => {
        for (const file of fileList) {
          if (!/^image\//i.test(file.type)) {
            toast("请上传图片文件", true);
            continue;
          }
          try {
            await uploadScenarioImage(id, "effect", file);
          } catch (err) {
            toast(err.message, true);
          }
        }
        toast("效果图已上传");
        loadScenarioDetail(id);
      }
    });

    initGenericDropZone({
      zoneId: "scenario-drop-render",
      onFiles: async (fileList) => {
        for (const file of fileList) {
          if (!/^image\//i.test(file.type)) {
            toast("请上传图片文件", true);
            continue;
          }
          try {
            await uploadScenarioImage(id, "render", file);
          } catch (err) {
            toast(err.message, true);
          }
        }
        toast("渲染图已上传");
        loadScenarioDetail(id);
      }
    });
  }
}

function teardownMarkerEditor() {
  markerEditorAbort?.abort();
  markerEditorAbort = null;
  resetMarkerDragUi();
  markerCreateLock = false;
  markerDragSaveLock = false;
}

function openScenarioMarkers(imageId) {
  teardownMarkerEditor();
  currentScenarioImageId = imageId;
  selectedMarkerId = null;
  markerAdding = false;
  markerSuppressCreateUntil = 0;
  switchView("scenario-markers");
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
  document.querySelector('.nav-item[data-view="scenarios"]')?.classList.add("active");
  loadScenarioMarkers(imageId).catch((err) => toast(err.message || "加载失败", true));
}

async function loadScenarioMarkers(imageId) {
  const gen = ++markerLoadGen;
  teardownMarkerEditor();

  const data = await api(`/api/scenario-images/${imageId}`);
  if (gen !== markerLoadGen || imageId !== currentScenarioImageId) return;

  markerEditState = data;
  selectedMarkerId = null;
  const root = document.getElementById("scenario-marker-root");
  const canEdit = canWrite();

  root.innerHTML = `
    <div class="card">
      <h3>${escapeHtml(data.scenario?.name || "")} · ${escapeHtml(data.kind_label)} ${data.title ? "· " + escapeHtml(data.title) : ""}</h3>
      <p class="hint">${canEdit ? "双击图片空白处添加标记；单击标记可选模板；拖动标记可调整位置；右侧列表可删除。" : "只读浏览模式。"}</p>
    </div>
    <div class="marker-editor-wrap">
      <div class="card marker-canvas" id="marker-canvas">
        <img id="marker-base-img" src="${escapeAttr(data.file_path)}" alt="" />
        <div id="marker-pins-layer"></div>
      </div>
      <div class="card marker-sidebar">
        <h4>标记列表</h4>
        <div id="marker-list"></div>
        <div id="marker-editor-panel" class="marker-editor-panel hidden"></div>
        ${canEdit ? `<button type="button" class="btn danger" id="delete-scenario-image">删除此图</button>` : ""}
      </div>
    </div>`;

  if (gen !== markerLoadGen) return;
  if (canEdit) await loadMarkerTemplateOptions();
  if (gen !== markerLoadGen) return;
  await refreshMarkersFromServer(imageId);
  if (gen !== markerLoadGen) return;
  const wrap = root.querySelector(".marker-editor-wrap");
  if (wrap) bindMarkerEditorEvents(wrap);

  if (canEdit) {
    document.getElementById("delete-scenario-image")?.addEventListener("click", async () => {
      if (!confirm("确定删除此场景图及全部标记？")) return;
      try {
        await api(`/api/scenario-images/${imageId}`, { method: "DELETE" });
        toast("已删除");
        openScenarioDetail(currentScenarioId);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }
}

function getActiveMarkerWrap() {
  return document.querySelector("#view-scenario-markers.active .marker-editor-wrap");
}

function resetMarkerDragUi() {
  markerDrag = null;
  markerJustDragged = false;
  const wrap = getActiveMarkerWrap();
  wrap?.querySelector("#marker-drag-preview")?.remove();
  wrap
    ?.querySelectorAll("#marker-pins-layer .marker-pin-ui.is-marker-hidden")
    .forEach((p) => p.classList.remove("is-marker-hidden"));
}

function removeMarkerDragPreview() {
  getActiveMarkerWrap()?.querySelector("#marker-drag-preview")?.remove();
}

function suppressMarkerCreate(ms = 900) {
  markerSuppressCreateUntil = Math.max(markerSuppressCreateUntil, Date.now() + ms);
}

function createMarkerPinElement(m, index) {
  const pin = document.createElement("div");
  const selected = m.id == selectedMarkerId;
  const unassigned = !m.template_id;
  pin.className = `marker-pin-ui${selected ? " is-selected" : ""}${unassigned ? " is-unassigned" : ""}`;
  pin.dataset.markerId = String(m.id);
  pin.style.left = `${Number(m.x_pct)}%`;
  pin.style.top = `${Number(m.y_pct)}%`;

  const dot = document.createElement("div");
  dot.className = "marker-dot";
  dot.textContent = String(index + 1);
  pin.appendChild(dot);

  if (canWrite() && (!m.template_id || selected)) {
    const sel = document.createElement("select");
    sel.className = "marker-pin-select";
    sel.dataset.markerSelect = String(m.id);
    sel.innerHTML = buildMarkerTemplateSelectOptions(m.template_id || "");
    pin.appendChild(sel);
  } else if (m.template_id) {
    const label = document.createElement("div");
    label.className = "marker-label";
    label.textContent = m.template_id
      ? m.label || m.template_name || m.template_code || "模板"
      : "未选模板";
    pin.appendChild(label);
  }
  return pin;
}

function canvasPointFromEvent(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x_pct: Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100)),
    y_pct: Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100))
  };
}

function patchMarkerPositionLocal(markerId, x_pct, y_pct) {
  if (!markerEditState?.markers) return;
  markerEditState = {
    ...markerEditState,
    markers: markerEditState.markers.map((m) =>
      m.id == markerId ? { ...m, x_pct, y_pct } : m
    )
  };
}

function getValidMarkers() {
  const seen = new Set();
  return (markerEditState?.markers || []).filter((m) => {
    if (!m || m.id == null) return false;
    const id = Number(m.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

let lastMarkerAddAt = 0;

async function refreshMarkersFromServer(imageId = currentScenarioImageId) {
  if (!imageId) return;
  const gen = ++markerRefreshGen;
  const data = await api(`/api/scenario-images/${imageId}`);
  if (gen !== markerRefreshGen) return;
  markerEditState = data;
  if (selectedMarkerId != null && !getValidMarkers().some((m) => m.id == selectedMarkerId)) {
    selectedMarkerId = null;
  }
  renderMarkerPins();
}

function bindMarkerEditorEvents(wrap) {
  if (!wrap) return;
  const canvas = wrap.querySelector("#marker-canvas");
  if (!canvas) return;

  markerEditorAbort?.abort();
  const ac = new AbortController();
  markerEditorAbort = ac;
  const opt = { signal: ac.signal };

  const img = wrap.querySelector("#marker-base-img");
  if (img && !img.complete) {
    img.addEventListener("load", () => renderMarkerPins(), { once: true, ...opt });
  }

  canvas.addEventListener(
    "dblclick",
    (e) => {
      if (!canWrite() || markerCreateLock || markerAdding || markerDrag) return;
      if (Date.now() < markerSuppressCreateUntil) return;
      if (e.target.closest(".marker-pin-ui")) return;
      e.preventDefault();
      e.stopPropagation();
      const pt = canvasPointFromEvent(canvas, e);
      if (!pt) return;
      addMarkerAt(pt.x_pct, pt.y_pct);
    },
    opt
  );

  wrap.addEventListener("click", (e) => {
    const delBtn = e.target.closest("[data-del-marker]");
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      removeMarker(Number(delBtn.dataset.delMarker));
      return;
    }

    if (e.target.closest("#marker-edit-delete")) {
      e.preventDefault();
      if (selectedMarkerId != null) removeMarker(selectedMarkerId);
      return;
    }

    const rowBtn = e.target.closest(".marker-row-main");
    if (rowBtn) {
      const row = rowBtn.closest("[data-select-marker]");
      if (row) selectMarker(Number(row.dataset.selectMarker));
      return;
    }

    const pin = e.target.closest(".marker-pin-ui");
    if (
      pin &&
      pin.id !== "marker-drag-preview" &&
      !pin.classList.contains("is-marker-hidden") &&
      !e.target.closest(".marker-pin-select")
    ) {
      if (markerJustDragged) {
        markerJustDragged = false;
        return;
      }
      selectMarker(Number(pin.dataset.markerId));
      return;
    }

    if (markerJustDragged) {
      markerJustDragged = false;
      return;
    }

    const canvasEl = wrap.querySelector("#marker-canvas");
    if (
      canvasEl &&
      canvasEl.contains(e.target) &&
      !e.target.closest(".marker-pin-ui") &&
      selectedMarkerId != null
    ) {
      clearMarkerSelection();
    }
  }, opt);

  wrap.addEventListener("change", (e) => {
    const pinSel = e.target.closest("[data-marker-select]");
    if (pinSel) {
      const templateId = Number(pinSel.value);
      if (!templateId) return;
      assignMarkerTemplate(Number(pinSel.dataset.markerSelect), templateId);
      return;
    }
    if (e.target.id === "marker-edit-template" && selectedMarkerId != null) {
      const templateId = Number(e.target.value);
      if (!templateId) return;
      assignMarkerTemplate(selectedMarkerId, templateId);
    }
  }, opt);

  wrap.addEventListener("pointerdown", (e) => {
    const pin = e.target.closest(".marker-pin-ui");
    if (!pin || pin.id === "marker-drag-preview" || !canWrite() || e.target.closest(".marker-pin-select")) return;
    if (e.button !== 0) return;

    e.stopPropagation();
    suppressMarkerCreate();

    markerDrag = {
      id: Number(pin.dataset.markerId),
      pin,
      preview: null,
      layer: wrap.querySelector("#marker-pins-layer"),
      canvas,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      x_pct: Number.parseFloat(pin.style.left) || 0,
      y_pct: Number.parseFloat(pin.style.top) || 0
    };
  }, opt);

  wrap.addEventListener("pointermove", (e) => {
    if (!markerDrag || e.pointerId !== markerDrag.pointerId) return;
    const dx = e.clientX - markerDrag.startX;
    const dy = e.clientY - markerDrag.startY;
    if (!markerDrag.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      markerDrag.moved = true;
      const layer = markerDrag.layer;
      const pin = markerDrag.pin;
      if (!layer || !pin) return;
      removeMarkerDragPreview();
      pin.classList.add("is-marker-hidden");
      const preview = document.createElement("div");
      preview.id = "marker-drag-preview";
      preview.className = pin.className.replace(/\bis-marker-hidden\b/g, "").trim() + " is-dragging";
      preview.innerHTML = pin.innerHTML;
      preview.style.left = pin.style.left;
      preview.style.top = pin.style.top;
      layer.appendChild(preview);
      markerDrag.preview = preview;
    }
    if (!markerDrag.moved || !markerDrag.preview) return;

    const pt = canvasPointFromEvent(markerDrag.canvas, e);
    if (!pt) return;
    markerDrag.x_pct = pt.x_pct;
    markerDrag.y_pct = pt.y_pct;
    markerDrag.preview.style.left = `${pt.x_pct}%`;
    markerDrag.preview.style.top = `${pt.y_pct}%`;
  }, opt);

  wrap.addEventListener("pointerup", async (e) => {
    if (!markerDrag || e.pointerId !== markerDrag.pointerId) return;
    const drag = markerDrag;
    markerDrag = null;

    if (!drag.moved) {
      drag.pin.classList.remove("is-marker-hidden");
      removeMarkerDragPreview();
      selectMarker(drag.id);
      return;
    }

    suppressMarkerCreate();
    markerJustDragged = true;
    patchMarkerPositionLocal(drag.id, drag.x_pct, drag.y_pct);
    selectedMarkerId = drag.id;
    renderMarkerPins();

    if (markerDragSaveLock) return;
    markerDragSaveLock = true;
    try {
      await api(`/api/scenario-markers/${drag.id}`, {
        method: "PATCH",
        body: JSON.stringify({ x_pct: drag.x_pct, y_pct: drag.y_pct })
      });
      await refreshMarkersFromServer();
    } catch (err) {
      toast(err.message, true);
      await refreshMarkersFromServer();
    } finally {
      markerDragSaveLock = false;
    }
  }, opt);

  wrap.addEventListener("pointercancel", () => {
    suppressMarkerCreate();
    resetMarkerDragUi();
  }, opt);
}

async function loadMarkerTemplateOptions() {
  markerTemplateOptions = await api("/api/templates/published-picker");
}

function buildMarkerTemplateSelectOptions(selectedId) {
  const sel = selectedId ? String(selectedId) : "";
  return (
    `<option value="">选择已发布模板…</option>` +
    markerTemplateOptions
      .map(
        (t) =>
          `<option value="${t.id}"${String(t.id) === sel ? " selected" : ""}>${escapeHtml(t.template_code)} · ${escapeHtml(t.name)} (${escapeHtml(t.scenario)})</option>`
      )
      .join("")
  );
}

function clearMarkerSelection() {
  if (selectedMarkerId == null) return;
  selectedMarkerId = null;
  renderMarkerPins();
}

function selectMarker(markerId) {
  selectedMarkerId = markerId;
  updateMarkerSelectionUi();
}

function updateMarkerSelectionUi() {
  const layer = getActiveMarkerWrap()?.querySelector("#marker-pins-layer");
  layer?.querySelectorAll(".marker-pin-ui").forEach((pin) => {
    if (pin.id === "marker-drag-preview") return;
    pin.classList.toggle("is-selected", Number(pin.dataset.markerId) == selectedMarkerId);
  });
  document.querySelectorAll(".marker-row").forEach((row) => {
    row.classList.toggle("is-active", Number(row.dataset.selectMarker) == selectedMarkerId);
  });
  renderMarkerEditorPanel();
}

function renderMarkerPins() {
  const wrap = getActiveMarkerWrap();
  const layer = wrap?.querySelector("#marker-pins-layer");
  const list = wrap?.querySelector("#marker-list");
  if (!layer || !list || !markerEditState) return;

  resetMarkerDragUi();
  const markers = getValidMarkers();
  const pins = markers.map((m, i) => createMarkerPinElement(m, i));
  layer.replaceChildren(...pins);

  list.innerHTML = markers.length
    ? markers
        .map((m, i) => {
          const active = m.id == selectedMarkerId ? " is-active" : "";
          const title = m.template_id
            ? `${escapeHtml(m.template_code || "—")} · ${escapeHtml(m.label || m.template_name || "")}`
            : "未关联模板";
          return `<div class="marker-row${active}" data-select-marker="${m.id}">
            <button type="button" class="marker-row-main">${i + 1}. ${title}</button>
            ${canWrite() ? `<button type="button" class="btn danger" data-del-marker="${m.id}">删</button>` : ""}
          </div>`;
        })
        .join("")
    : '<p class="hint">暂无标记，双击图片添加。</p>';

  renderMarkerEditorPanel();
}

async function addMarkerAt(x_pct, y_pct) {
  const now = Date.now();
  if (markerCreateLock || markerAdding || markerDrag || now < markerSuppressCreateUntil || now - lastMarkerAddAt < 600) {
    return;
  }
  markerCreateLock = true;
  lastMarkerAddAt = now;
  markerAdding = true;
  try {
    const created = await api(`/api/scenario-images/${currentScenarioImageId}/markers`, {
      method: "POST",
      body: JSON.stringify({ x_pct, y_pct })
    });
    if (created?.id) selectedMarkerId = created.id;
    await refreshMarkersFromServer();
  } catch (err) {
    toast(err.message, true);
  } finally {
    markerAdding = false;
    markerCreateLock = false;
  }
}

async function assignMarkerTemplate(markerId, templateId) {
  try {
    await api(`/api/scenario-markers/${markerId}`, {
      method: "PATCH",
      body: JSON.stringify({ template_id: templateId })
    });
    selectedMarkerId = markerId;
    await refreshMarkersFromServer();
  } catch (err) {
    toast(err.message, true);
  }
}

function renderMarkerEditorPanel() {
  const panel = document.getElementById("marker-editor-panel");
  if (!panel || !canWrite()) return;
  const marker = getValidMarkers().find((m) => m.id == selectedMarkerId);
  if (!marker) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <h4>编辑标记 ${getValidMarkers().findIndex((m) => m.id == marker.id) + 1}</h4>
    <label class="full">关联模板
      <select id="marker-edit-template">${buildMarkerTemplateSelectOptions(marker.template_id)}</select>
    </label>
    <p class="hint">单击标记可选中并在此修改模板；拖动标记点可调整位置；选中后图上也会出现模板下拉框。</p>
    <button type="button" class="btn danger" id="marker-edit-delete">删除此标记</button>`;
}

async function removeMarker(markerId) {
  try {
    await api(`/api/scenario-markers/${markerId}`, { method: "DELETE" });
    if (selectedMarkerId == markerId) selectedMarkerId = null;
    await refreshMarkersFromServer();
    toast("标记已删除");
  } catch (err) {
    toast(err.message, true);
    await refreshMarkersFromServer();
  }
}

function initScenarioUi() {
  document.getElementById("back-to-scenarios")?.addEventListener("click", () => {
    switchView("scenarios");
    document.querySelector('.nav-item[data-view="scenarios"]')?.classList.add("active");
    loadScenarios();
  });
  document.getElementById("back-to-scenario-detail")?.addEventListener("click", () => {
    teardownMarkerEditor();
    if (currentScenarioId) openScenarioDetail(currentScenarioId);
  });
}

async function startApp() {
  initNav();
  initCreateForm();
  initScenarioUi();
  initListFilters();
  initPriceLibrary();
  await loadMeta();
  currentUser = meta.currentUser || currentUser;
  applyPermissions();
  if (!canWrite()) switchView("list");
}

async function boot() {
  initAuthUi();
  requestAnimationFrame(() => document.body.classList.add("loaded"));
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
