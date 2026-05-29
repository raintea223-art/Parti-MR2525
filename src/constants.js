/** @typedef {'draft'|'pending_quote'|'pending_review'|'published'|'archived'} TemplateStatus */

const SCENARIOS = [
  { value: "展厅", code: "ZT", slugPrefix: "zhanting" },
  { value: "零售", code: "LS", slugPrefix: "lingshou" },
  { value: "活动", code: "HD", slugPrefix: "huodong" },
  { value: "办公", code: "BG", slugPrefix: "bangong" },
  { value: "会展", code: "HZ", slugPrefix: "huizhan" },
  { value: "宠物", code: "CW", slugPrefix: "chongwu" },
  { value: "市集", code: "SJ", slugPrefix: "shiji" },
  { value: "其他", code: "OT", slugPrefix: "qita" }
];

const SCENARIO_MAP = Object.fromEntries(SCENARIOS.map((s) => [s.value, s]));

/** @type {TemplateStatus[]} */
const STATUSES = ["draft", "pending_quote", "pending_review", "published", "archived"];

const STATUS_LABELS = {
  draft: "草稿",
  pending_quote: "待清单深化",
  pending_review: "待审核",
  published: "已发布",
  archived: "已下架"
};

const STATUS_FLOW = {
  draft: ["pending_quote"],
  pending_quote: ["pending_review"],
  pending_review: ["published", "pending_quote"],
  published: ["archived"],
  archived: ["pending_review"]
};

const IMAGE_KINDS = {
  photo: { folder: "实拍照片", label: "实拍照片", required: false },
  effect: { folder: "效果图", label: "效果图", required: true },
  render: { folder: "渲染图", label: "渲染图", required: true }
};

const AUDIT_CHECKLIST = [
  { id: "code_name_scenario", label: "模板编号、名称、应用场景" },
  { id: "assignee", label: "负责人已记录" },
  { id: "dimensions", label: "宽 × 深 × 高（mm）" },
  { id: "cover", label: "封面已自动/手动选取" },
  { id: "effect_images", label: "效果图 ≥ 1 张" },
  { id: "render_images", label: "渲染图 ≥ 1 张" },
  { id: "skp", label: "skp 已上传且路径正确" },
  { id: "structure_bom", label: "结构 BOM 与 skp 一致" },
  { id: "panel_bom", label: "板材 BOM 完整（多行已分行）" },
  { id: "panel_colors", label: "每行标配颜色已填" },
  { id: "quote_note", label: "报价口径已写" },
  { id: "one_liner", label: "一句话卖点已写" },
  { id: "reference_price", label: "参考价百位正确" },
  { id: "skin_upgrade", label: "可定制开关状态正确" }
];

const CUSTOM_BOM_CATEGORIES = ["型材", "五金配件", "其他"];

const BOM_CATEGORIES = CUSTOM_BOM_CATEGORIES;

const BOM_UNITS = ["根", "个", "m", "m²", "项"];

const TAGS = [
  "可拆装",
  "可阵列",
  "带灯带",
  "高柜",
  "L型",
  "隔断",
  "展架",
  "装置",
  "宠物",
  "市集",
  "会展"
];

const PRICE_FACTORS = ["改宽度", "换面板材质", "加灯带", "加安装", "异地运输"];

const DEFAULT_QUOTE_NOTE =
  "含 MR2525 骨架、标准连接件及表中面板；不含运输、现场安装、税费。正式报价以确认尺寸与清单为准。";

const PROFILE_FORMULA_NOTE =
  "出厂价 = ROUNDUP(长度(in) × rate + base, 0)；对外报价单价 = 出厂价 × 2 × 系数（参数见单价库·型材）";

const PANEL_FORMULA_NOTE =
  "面积(㎡) = 长(in)×25.4 × 宽(in)×25.4 / 10⁶；对外参考价含物料小计 × 10% 加工费，百位取整";

const EXTERNAL_PROCESS_FEE_RATE = 0.1;

const DEFAULT_PRICE_LIBRARY = [];

module.exports = {
  SCENARIOS,
  SCENARIO_MAP,
  STATUSES,
  STATUS_LABELS,
  STATUS_FLOW,
  IMAGE_KINDS,
  AUDIT_CHECKLIST,
  BOM_CATEGORIES,
  CUSTOM_BOM_CATEGORIES,
  BOM_UNITS,
  TAGS,
  PRICE_FACTORS,
  DEFAULT_QUOTE_NOTE,
  PROFILE_FORMULA_NOTE,
  PANEL_FORMULA_NOTE,
  EXTERNAL_PROCESS_FEE_RATE,
  DEFAULT_PRICE_LIBRARY
};
