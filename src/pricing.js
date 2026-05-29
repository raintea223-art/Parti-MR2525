const { EXTERNAL_PROCESS_FEE_RATE } = require("./constants");
const { DEFAULT_FORMULA } = require("./profile-formula");

/** 型材出厂价（对内）：ROUNDUP(长度 × rate + base, 0) */
function profileFactoryPrice(lengthInch, formula = DEFAULT_FORMULA) {
  const rate = Number(formula?.rate ?? DEFAULT_FORMULA.rate);
  const base = Number(formula?.base ?? DEFAULT_FORMULA.base);
  return Math.ceil(Number(lengthInch) * rate + base);
}

function profileLineTotal(
  lengthInch,
  qty,
  { external = true, coefficient = 1, formula = DEFAULT_FORMULA } = {}
) {
  const factory = profileFactoryPrice(lengthInch, formula);
  const mult = Number(formula?.external_multiplier ?? DEFAULT_FORMULA.external_multiplier) || 2;
  const externalUnit = factory * mult * Number(coefficient || 1);
  const unitPrice = external ? externalUnit : factory;
  const q = Number(qty) || 0;
  return {
    length_inch: Number(lengthInch),
    qty: q,
    coefficient: Number(coefficient || 1),
    factory_price: factory,
    external_unit: externalUnit,
    unit_price: unitPrice,
    quote_unit: externalUnit,
    subtotal: q * unitPrice
  };
}

/** 板材面积 m² = 长mm × 宽mm / 1e6 */
function panelAreaSqm(lengthInch, widthInch) {
  const lMm = Number(lengthInch) * 25.4;
  const wMm = Number(widthInch) * 25.4;
  return {
    length_mm: lMm,
    width_mm: wMm,
    area_sqm: (lMm * wMm) / 1_000_000
  };
}

function panelLineTotal(
  { length_inch, width_inch, qty, pricing_mode, price_per_sqm, fixed_unit_price },
  { external = true } = {}
) {
  const dims = panelAreaSqm(length_inch, width_inch);
  const q = Number(qty) || 0;
  let externalUnit = 0;

  if (pricing_mode === "fixed") {
    externalUnit = Number(fixed_unit_price) || 0;
  } else {
    externalUnit = dims.area_sqm * (Number(price_per_sqm) || 0);
  }

  const unitPrice = external ? externalUnit : externalUnit;
  return {
    ...dims,
    length_inch: Number(length_inch),
    width_inch: Number(width_inch),
    qty: q,
    pricing_mode,
    price_per_sqm: Number(price_per_sqm) || 0,
    fixed_unit_price: Number(fixed_unit_price) || 0,
    external_unit_price: externalUnit,
    unit_price: unitPrice,
    subtotal: q * unitPrice
  };
}

function hardwareLineTotal(qty, unitPrice, { external = true, internalUnitPrice = null } = {}) {
  const q = Number(qty) || 0;
  const ext = Number(unitPrice) || 0;
  const u = external ? ext : Number(internalUnitPrice ?? ext);
  return { qty: q, unit_price: u, external_unit_price: ext, subtotal: q * u };
}

function roundMoney(n) {
  return Math.round(Number(n) || 0);
}

function roundToHundred(n) {
  return roundMoney(Math.round(Number(n) / 100) * 100);
}

function sumLines(lines, field = "subtotal") {
  return lines.reduce((s, l) => s + (Number(l[field]) || 0), 0);
}

function computeQuoteSummary({
  profiles = [],
  nuts = [],
  hardware = [],
  panels = [],
  legacyBom = [],
  priceOverrideMin = null,
  priceOverrideMax = null,
  skinUpgradeEnabled = false,
  profileFormula = DEFAULT_FORMULA
}) {
  const formula = profileFormula || DEFAULT_FORMULA;

  const profileLines = profiles.map((p) => ({
    ...p,
    ...profileLineTotal(p.length_inch, p.qty, {
      external: true,
      coefficient: p.coefficient,
      formula
    })
  }));

  const nutLines = nuts.map((n) => {
    const ext = n.unit_price_external ?? n.unit_price ?? 0;
    const line = hardwareLineTotal(n.qty, ext, { external: true });
    return { ...n, unit_price: ext, ...line };
  });

  const hardwareLines = hardware.map((h) => {
    const ext = h.unit_price_external ?? h.unit_price ?? 0;
    const line = hardwareLineTotal(h.qty, ext, { external: true });
    return { ...h, unit_price: ext, ...line };
  });

  const panelLines = panels.map((p) => {
    const extPerSqm = p.price_per_sqm_external ?? p.price_per_sqm ?? 0;
    const extFixed = p.fixed_unit_price_external ?? p.fixed_unit_price ?? 0;
    const line = panelLineTotal(
      {
        length_inch: p.length_inch,
        width_inch: p.width_inch,
        qty: p.qty,
        pricing_mode: p.pricing_mode,
        price_per_sqm: extPerSqm,
        fixed_unit_price: extFixed
      },
      { external: true }
    );
    return { ...p, ...line };
  });

  const legacyLines = legacyBom.map((b) => ({
    ...b,
    subtotal: (Number(b.qty) || 0) * (Number(b.unit_price) || 0)
  }));

  const profileAmount = sumLines(profileLines);
  const nutAmount = sumLines(nutLines);
  const hardwareAmount = sumLines(hardwareLines);
  const panelAmount = sumLines(panelLines);
  const legacyAmount = sumLines(legacyLines);

  const materialCostExternal = profileAmount + nutAmount + hardwareAmount + panelAmount + legacyAmount;
  const processAmountExternal = materialCostExternal * EXTERNAL_PROCESS_FEE_RATE;
  const totalExternal = materialCostExternal + processAmountExternal;

  const profileInternal = profiles.map((p) =>
    profileLineTotal(p.length_inch, p.qty, {
      external: false,
      coefficient: p.coefficient,
      formula
    })
  );
  const nutInternal = nuts.map((n) => {
    const internal = n.unit_price_internal ?? (n.unit_price_external ?? n.unit_price ?? 0);
    return { ...n, ...hardwareLineTotal(n.qty, internal, { external: false }) };
  });
  const hardwareInternal = hardware.map((h) => {
    const internal = h.unit_price_internal ?? (h.unit_price_external ?? h.unit_price ?? 0);
    return { ...h, ...hardwareLineTotal(h.qty, internal, { external: false }) };
  });
  const panelInternal = panels.map((p) => {
    const intPerSqm = p.price_per_sqm_internal ?? p.price_per_sqm_external ?? p.price_per_sqm ?? 0;
    const intFixed = p.fixed_unit_price_internal ?? p.fixed_unit_price_external ?? p.fixed_unit_price ?? 0;
    return {
      ...p,
      ...panelLineTotal(
        {
          length_inch: p.length_inch,
          width_inch: p.width_inch,
          qty: p.qty,
          pricing_mode: p.pricing_mode,
          price_per_sqm: intPerSqm,
          fixed_unit_price: intFixed
        },
        { external: false }
      )
    };
  });

  const internalCost =
    sumLines(profileInternal) +
    sumLines(nutInternal) +
    sumLines(hardwareInternal) +
    sumLines(panelInternal) +
    legacyAmount;

  let baseMin = roundToHundred(totalExternal);
  let baseMax = skinUpgradeEnabled ? roundToHundred(totalExternal) : baseMin;

  if (!skinUpgradeEnabled) {
    baseMax = baseMin;
  }

  return {
    profileAmount: roundMoney(profileAmount),
    nutAmount: roundMoney(nutAmount),
    hardwareAmount: roundMoney(hardwareAmount),
    panelAmount: roundMoney(panelAmount),
    legacyAmount: roundMoney(legacyAmount),
    materialCost: roundMoney(materialCostExternal),
    materialCostExternal: roundMoney(materialCostExternal),
    internalCost: roundMoney(internalCost),
    processAmount: roundMoney(processAmountExternal),
    processAmountExternal: roundMoney(processAmountExternal),
    totalCost: roundMoney(totalExternal),
    totalExternal: roundMoney(totalExternal),
    price_min: priceOverrideMin ?? baseMin,
    price_max: priceOverrideMax ?? baseMax,
    price_computed_min: baseMin,
    price_computed_max: baseMax,
    profileLines,
    nutLines,
    hardwareLines,
    panelLines,
    legacyLines,
    profileCount: profileLines.reduce((s, l) => s + l.qty, 0),
    nutCount: nutLines.reduce((s, l) => s + l.qty, 0),
    hardwareCount: hardwareLines.reduce((s, l) => s + l.qty, 0),
    panelCount: panelLines.reduce((s, l) => s + l.qty, 0)
  };
}

module.exports = {
  profileFactoryPrice,
  profileLineTotal,
  panelAreaSqm,
  panelLineTotal,
  hardwareLineTotal,
  computeQuoteSummary,
  roundMoney,
  roundToHundred
};
