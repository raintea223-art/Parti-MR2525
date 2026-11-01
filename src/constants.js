/** @typedef {'draft'|'pending_quote'|'pending_review'|'published'|'archived'} TemplateStatus */

const SCENARIOS = [
  { value: "展厅", code: "SHW", slugPrefix: "zhanting" },
  { value: "零售", code: "RET", slugPrefix: "lingshou" },
  { value: "活动", code: "EVT", slugPrefix: "huodong" },
  { value: "办公", code: "OFF", slugPrefix: "bangong" },
  { value: "会展", code: "EXH", slugPrefix: "huizhan" },
  { value: "宠物", code: "PET", slugPrefix: "chongwu" },
  { value: "市集", code: "MKT", slugPrefix: "shiji" },
  { value: "其他", code: "OTH", slugPrefix: "qita" },
  { value: "轻餐饮", code: "FNB", slugPrefix: "qingcanyin" },
  { value: "公园商业", code: "PRK", slugPrefix: "gongyuanshangye" }
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
  effect: { folder: "效果图", label: "效果图", required: false },
  render: { folder: "渲染图", label: "渲染图", required: false }
};

const DELIVERY_FILE_KINDS = {
  dwg: { folder: "加工图纸", label: "DWG 加工图", typeCode: "DWG", extensions: [".dwg"], accept: ".dwg" },
  pdf: { folder: "加工图PDF", label: "PDF 加工图", typeCode: "PDF", extensions: [".pdf"], accept: ".pdf" },
  bom: { folder: "BOM表", label: "BOM 表", typeCode: "BOM", extensions: [".xlsx"], accept: ".xlsx" },
  man: { folder: "交付说明书", label: "交付说明书", typeCode: "MAN", extensions: [".pdf"], accept: ".pdf" },
  inf: { folder: "基本信息", label: "项目基本信息", typeCode: "INF", extensions: [".xlsx"], accept: ".xlsx" }
};

const SCENARIO_CLASSIFICATION_RULES = [
  { order: 1, condition: "同一场地有 ≥3 个独立售卖 / 展示单元聚集", code: "MKT", target: "市集" },
  { order: 2, condition: "存在餐饮出品行为，含后厨、吧台出品、现制饮品", code: "FNB", target: "轻餐饮" },
  { order: 3, condition: "部署在室外 / 公园 / 街区且可短期拆装", code: "PRK", target: "公园商业" },
  { order: 4, condition: "固定经营场所、有交易行为", code: "RET", target: "零售" },
  { order: 5, condition: "有明确起止日期、为单次展会搭建，对外参展", code: "EXH", target: "会展" },
  { order: 6, condition: "有明确起止日期、品牌自办活动", code: "EVT", target: "活动" },
  { order: 7, condition: "长期陈列、不售卖", code: "SHW", target: "展厅" },
  { order: 8, condition: "以工位、会议、协作为主", code: "OFF", target: "办公" },
  { order: 9, condition: "以宠物行为界面为主要设计约束", code: "PET", target: "宠物" },
  { order: 10, condition: "以上皆不成立", code: "OTH", target: "其他" }
];

const AUDIT_CHECKLIST = [
  { id: "code_name_scenario", label: "模板编号、名称、应用场景" },
  { id: "assignee", label: "负责人已记录" },
  { id: "dimensions", label: "宽 × 深 × 高（mm）" },
  { id: "cover", label: "封面已自动/手动选取" },
  { id: "visual_assets", label: "EFF / RND 至少一类；合并已留痕" },
  { id: "skp", label: "skp 已上传且路径正确" },
  { id: "delivery_package", label: "八类件齐备，文件名符合规范" },
  { id: "structure_bom", label: "结构 BOM 与 skp 一致" },
  { id: "panel_bom", label: "板材 BOM 完整（多行已分行）" },
  { id: "panel_colors", label: "每行标配颜色已填" },
  { id: "quote_note", label: "报价口径已写" },
  { id: "package_price", label: "整包价含税与价格基准日已填" },
  { id: "installation_hours", label: "安装工时为人·h 总量" },
  { id: "delivery_file_list", label: "交付文件清单与交付包一致" },
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
  DELIVERY_FILE_KINDS,
  SCENARIO_CLASSIFICATION_RULES,
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
