/**
 * 单价库：与《海智详细清单》对齐
 * - 型材：按长度 inch 公式计价（见 pricing.js）
 * - 五金：出厂参考单价 × 数量
 * - 板材：按 m² 单价 或 固定件价
 */

const HARDWARE_CATALOG = [
  { key: "nut_ol5050", label: "六通 OL5050", unit: "个", unit_price: 104, category: "六通" },
  { key: "nut_ol2550", label: "六通 OL2550", unit: "个", unit_price: 26, category: "六通" },
  { key: "nut_ol2525", label: "六通 OL2525", unit: "个", unit_price: 13, category: "六通" },
  { key: "foot", label: "地脚", unit: "个", unit_price: 20, category: "五金" },
  { key: "connector", label: "连接件", unit: "个", unit_price: 4, category: "五金" },
  { key: "light_strip_500x20", label: "发光字灯带（500×20）", unit: "条", unit_price: 100, category: "灯带" },
  { key: "light_strip_500x12", label: "发光字灯带（500×12）", unit: "条", unit_price: 100, category: "灯带" },
  { key: "light_strip_500x18", label: "发光字灯带（500×18）", unit: "条", unit_price: 100, category: "灯带" },
  { key: "light_strip_400x16", label: "发光字灯带（400×16）", unit: "条", unit_price: 100, category: "灯带" },
  { key: "light_strip_300x28", label: "发光字灯带（300×28）", unit: "条", unit_price: 100, category: "灯带" },
  { key: "light_box", label: "灯箱", unit: "个", unit_price: 600, category: "灯带" },
  { key: "led_strip", label: "灯带", unit: "条", unit_price: 300, category: "灯带" },
  { key: "acrylic_light_box", label: "亚克力灯箱（4米一组）", unit: "组", unit_price: 520, category: "灯带" },
  { key: "display_box", label: "展示盒", unit: "个", unit_price: 1200, category: "辅料" },
  { key: "socket", label: "插座", unit: "个", unit_price: 700, category: "辅料" },
  { key: "socket_small", label: "小插座", unit: "个", unit_price: 350, category: "辅料" },
  { key: "lock", label: "锁具", unit: "个", unit_price: 50, category: "辅料" },
  { key: "hinge", label: "铰链", unit: "个", unit_price: 15, category: "辅料" },
  { key: "shelf_support", label: "层板托", unit: "个", unit_price: 4, category: "辅料" },
  { key: "velcro", label: "魔术贴", unit: "条", unit_price: 40, category: "辅料" },
  { key: "carpet_tape", label: "布基胶带", unit: "卷", unit_price: 200, category: "辅料" },
  { key: "film_laminate", label: "贴膜", unit: "项", unit_price: 8000, category: "辅料" },
  { key: "film_wrap", label: "贴膜包覆", unit: "项", unit_price: 10000, category: "辅料" }
];

const PANEL_MATERIAL_CATALOG = [
  {
    key: "transparent_drilled",
    label: "透明板（钻孔）",
    pricing_mode: "per_sqm",
    price_per_sqm: 1000,
    thickness: "透明"
  },
  {
    key: "acrylic_8",
    label: "8mm 亚克力",
    pricing_mode: "per_sqm",
    price_per_sqm: 1000,
    thickness: "8mm"
  },
  {
    key: "acrylic_8_frost",
    label: "8mm 透明磨砂亚克力",
    pricing_mode: "per_sqm",
    price_per_sqm: 1000,
    thickness: "8mm"
  },
  {
    key: "acrylic_8_frost_blue",
    label: "8mm 透明磨砂亚克力（蓝",
    pricing_mode: "per_sqm",
    price_per_sqm: 750,
    thickness: "8mm"
  },
  {
    key: "melamine_12",
    label: "免漆板-12",
    pricing_mode: "per_sqm",
    price_per_sqm: 800,
    thickness: "12mm"
  },
  {
    key: "melamine_25",
    label: "免漆板-25",
    pricing_mode: "per_sqm",
    price_per_sqm: 1000,
    thickness: "25mm"
  },
  {
    key: "melamine_white_12",
    label: "白色免漆板-12",
    pricing_mode: "per_sqm",
    price_per_sqm: 800,
    thickness: "12mm"
  },
  {
    key: "melamine_white_25",
    label: "白色免漆板-25",
    pricing_mode: "per_sqm",
    price_per_sqm: 1000,
    thickness: "25mm"
  },
  {
    key: "wood_black_drilled",
    label: "黑色木饰面板（钻孔）",
    pricing_mode: "per_sqm",
    price_per_sqm: 1200,
    thickness: "木饰面"
  },
  {
    key: "sand_melamine_12",
    label: "砂面免漆板-12",
    pricing_mode: "per_sqm",
    price_per_sqm: 300,
    thickness: "12mm"
  },
  {
    key: "sand_melamine_white_12",
    label: "砂面白色免漆-12",
    pricing_mode: "per_sqm",
    price_per_sqm: 800,
    thickness: "12mm"
  },
  {
    key: "sand_steel_baked",
    label: "砂面钢板烤漆",
    pricing_mode: "per_sqm",
    price_per_sqm: 1000,
    thickness: "钢板"
  },
  {
    key: "sand_steel_baked_premium",
    label: "砂面钢板烤漆（高端）",
    pricing_mode: "per_sqm",
    price_per_sqm: 1500,
    thickness: "钢板"
  },
  {
    key: "metal_black_baked",
    label: "黑色钢板烤漆成品",
    pricing_mode: "fixed",
    fixed_unit_price: 500,
    thickness: "钢板"
  },
  {
    key: "metal_black_baked_700",
    label: "黑色钢板烤漆成品（加强）",
    pricing_mode: "fixed",
    fixed_unit_price: 700,
    thickness: "钢板"
  },
  {
    key: "sand_steel_baked_trans",
    label: "砂面钢板烤漆半透",
    pricing_mode: "fixed",
    fixed_unit_price: 150,
    thickness: "钢板"
  },
  {
    key: "steel_baked_product",
    label: "钢板烤漆成品",
    pricing_mode: "fixed",
    fixed_unit_price: 500,
    thickness: "钢板"
  },
  {
    key: "super_white_5",
    label: "5 厘超白玻",
    pricing_mode: "fixed",
    fixed_unit_price: 100,
    thickness: "5mm 玻璃"
  },
  {
    key: "hanging_cabinet",
    label: "吊柜",
    pricing_mode: "per_sqm",
    price_per_sqm: 1000,
    thickness: "—"
  },
  {
    key: "custom",
    label: "自定义板材（手动单价）",
    pricing_mode: "per_sqm",
    price_per_sqm: 800,
    thickness: "—"
  }
];

const HARDWARE_MAP = Object.fromEntries(HARDWARE_CATALOG.map((h) => [h.key, h]));
const PANEL_MAP = Object.fromEntries(PANEL_MATERIAL_CATALOG.map((p) => [p.key, p]));

const PROFILE_FORMULA_NOTE =
  "出厂参考价 = ROUNDUP(长度(in) × 1.778 + 42, 0)；报价单价 = 出厂价 × 系数；小计 = 数量 × 报价单价";

const PANEL_FORMULA_NOTE =
  "面积(㎡) = 长(mm) × 宽(mm) / 10⁶；按面积计价时 单价 = 面积 × ㎡单价；固定件价时直接填件单价";

module.exports = {
  HARDWARE_CATALOG,
  PANEL_MATERIAL_CATALOG,
  HARDWARE_MAP,
  PANEL_MAP,
  PROFILE_FORMULA_NOTE,
  PANEL_FORMULA_NOTE
};
