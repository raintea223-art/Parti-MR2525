/** 单价库初始种子（首次建库写入；之后由你在「单价库」页面维护） */

const PANEL_MATERIAL_TYPES = [
  "免漆板",
  "海洋板",
  "烤漆木板",
  "烤漆金属板",
  "亚克力板",
  "透明板",
  "木饰面板",
  "钢板烤漆",
  "其他"
];

const PANEL_COLOR_SUGGESTIONS = [
  "木色",
  "金属砂银",
  "透明",
  "白色",
  "黑色",
  "透明磨砂",
  "砂面白",
  "砂面黑"
];

/** 颜色名称 → 色块（用于单价库与列表展示） */
const PANEL_COLOR_SWATCHES = {
  木色: "#C4A574",
  金属砂银: "#B8B8C0",
  透明: "transparent",
  白色: "#FFFFFF",
  黑色: "#1A1A1A",
  透明磨砂: "rgba(255,255,255,0.55)",
  砂面白: "#E8E8E8",
  砂面黑: "#2D2D2D"
};

const PRICE_SEED = {
  nuts: [
    { label: "六通 OL5050", nut_model: "OL5050", unit: "个", unit_price: 104 },
    { label: "六通 OL2550", nut_model: "OL2550", unit: "个", unit_price: 26 },
    { label: "六通 OL2525", nut_model: "OL2525", unit: "个", unit_price: 13 }
  ],
  hardware: [
    { label: "地脚", spec: "标准", unit: "个", unit_price: 20 },
    { label: "连接件", spec: "标准", unit: "个", unit_price: 4 },
    { label: "发光字灯带", spec: "500×20", unit: "条", unit_price: 100 },
    { label: "发光字灯带", spec: "500×12", unit: "条", unit_price: 100 },
    { label: "发光字灯带", spec: "500×18", unit: "条", unit_price: 100 },
    { label: "灯箱", spec: "标准", unit: "个", unit_price: 600 },
    { label: "灯带", spec: "标准", unit: "条", unit_price: 300 },
    { label: "亚克力灯箱", spec: "4米一组", unit: "组", unit_price: 520 },
    { label: "展示盒", spec: "标准", unit: "个", unit_price: 1200 },
    { label: "插座", spec: "标准", unit: "个", unit_price: 700 },
    { label: "小插座", spec: "标准", unit: "个", unit_price: 350 },
    { label: "锁具", spec: "标准", unit: "个", unit_price: 50 },
    { label: "铰链", spec: "标准", unit: "个", unit_price: 15 },
    { label: "层板托", spec: "标准", unit: "个", unit_price: 4 },
    { label: "贴膜", spec: "按项", unit: "项", unit_price: 8000 },
    { label: "贴膜包覆", spec: "按项", unit: "项", unit_price: 10000 }
  ],
  panels: [
    {
      material_type: "免漆板",
      color: "白色",
      thickness_mm: 12,
      pricing_mode: "per_sqm",
      unit_price: 800,
      label: "免漆板 · 白色 · 12mm"
    },
    {
      material_type: "免漆板",
      color: "白色",
      thickness_mm: 25,
      pricing_mode: "per_sqm",
      unit_price: 1000,
      label: "免漆板 · 白色 · 25mm"
    },
    {
      material_type: "免漆板",
      color: "木色",
      thickness_mm: 12,
      pricing_mode: "per_sqm",
      unit_price: 300,
      label: "砂面免漆板 · 木色 · 12mm"
    },
    {
      material_type: "亚克力板",
      color: "透明",
      thickness_mm: 8,
      pricing_mode: "per_sqm",
      unit_price: 1000,
      label: "亚克力板 · 透明 · 8mm"
    },
    {
      material_type: "亚克力板",
      color: "透明磨砂",
      thickness_mm: 8,
      pricing_mode: "per_sqm",
      unit_price: 1000,
      label: "亚克力板 · 透明磨砂 · 8mm"
    },
    {
      material_type: "透明板",
      color: "透明",
      thickness_mm: 8,
      pricing_mode: "per_sqm",
      unit_price: 1000,
      label: "透明板（钻孔）· 透明 · 8mm"
    },
    {
      material_type: "木饰面板",
      color: "木色",
      thickness_mm: 15,
      pricing_mode: "per_sqm",
      unit_price: 1200,
      label: "木饰面板 · 木色 · 15mm"
    },
    {
      material_type: "钢板烤漆",
      color: "黑色",
      thickness_mm: 1.2,
      pricing_mode: "fixed",
      unit_price: 500,
      label: "黑色钢板烤漆成品 · 1.2mm"
    },
    {
      material_type: "烤漆金属板",
      color: "金属砂银",
      thickness_mm: 1.2,
      pricing_mode: "per_sqm",
      unit_price: 1000,
      label: "砂面钢板烤漆 · 金属砂银 · 1.2mm"
    },
    {
      material_type: "烤漆金属板",
      color: "金属砂银",
      thickness_mm: 1.2,
      pricing_mode: "per_sqm",
      unit_price: 1500,
      label: "砂面钢板烤漆（高端）· 金属砂银 · 1.2mm"
    },
    {
      material_type: "海洋板",
      color: "木色",
      thickness_mm: 18,
      pricing_mode: "per_sqm",
      unit_price: 900,
      label: "海洋板 · 木色 · 18mm"
    },
    {
      material_type: "烤漆木板",
      color: "白色",
      thickness_mm: 18,
      pricing_mode: "per_sqm",
      unit_price: 1000,
      label: "烤漆木板 · 白色 · 18mm"
    }
  ]
};

module.exports = {
  PANEL_MATERIAL_TYPES,
  PANEL_COLOR_SUGGESTIONS,
  PANEL_COLOR_SWATCHES,
  PRICE_SEED
};
