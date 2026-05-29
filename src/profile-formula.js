const DEFAULT_FORMULA = {
  rate: 0.889,
  base: 21,
  external_multiplier: 2
};

function mapFormula(row) {
  if (!row) return { ...DEFAULT_FORMULA };
  return {
    rate: Number(row.rate) || DEFAULT_FORMULA.rate,
    base: Number(row.base) ?? DEFAULT_FORMULA.base,
    external_multiplier: Number(row.external_multiplier) || DEFAULT_FORMULA.external_multiplier,
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || ""
  };
}

function ensureProfileFormulaSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pricing_profile_formula (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      rate REAL NOT NULL DEFAULT 0.889,
      base REAL NOT NULL DEFAULT 21,
      external_multiplier REAL NOT NULL DEFAULT 2,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT DEFAULT ''
    );
  `);
  const row = db.prepare("SELECT id FROM pricing_profile_formula WHERE id = 1").get();
  if (!row) {
    db.prepare(
      `INSERT INTO pricing_profile_formula (id, rate, base, external_multiplier)
       VALUES (1, ?, ?, ?)`
    ).run(DEFAULT_FORMULA.rate, DEFAULT_FORMULA.base, DEFAULT_FORMULA.external_multiplier);
  }
}

function getProfileFormula(db) {
  const row = db.prepare("SELECT * FROM pricing_profile_formula WHERE id = 1").get();
  return mapFormula(row);
}

function buildProfileFormulaNote(formula) {
  const f = formula || DEFAULT_FORMULA;
  const mult = f.external_multiplier ?? 2;
  return (
    `出厂价 = ROUNDUP(长度(in) × ${f.rate} + ${f.base}, 0)；` +
    `对外报价单价 = 出厂价 × ${mult} × 系数；小计 = 数量 × 对外报价单价`
  );
}

function updateProfileFormula(db, { rate, base, external_multiplier, updated_by = "" }) {
  const existing = getProfileFormula(db);
  const nextRate = rate != null ? Number(rate) : existing.rate;
  const nextBase = base != null ? Number(base) : existing.base;
  const nextMult =
    external_multiplier != null ? Number(external_multiplier) : existing.external_multiplier;

  if (!(nextRate > 0)) throw new Error("rate 必须大于 0");
  if (!(nextMult > 0)) throw new Error("external_multiplier 必须大于 0");

  db.prepare(
    `UPDATE pricing_profile_formula SET
      rate = ?, base = ?, external_multiplier = ?,
      updated_at = datetime('now'), updated_by = ?
     WHERE id = 1`
  ).run(nextRate, nextBase, nextMult, updated_by);

  return getProfileFormula(db);
}

module.exports = {
  DEFAULT_FORMULA,
  ensureProfileFormulaSchema,
  getProfileFormula,
  buildProfileFormulaNote,
  updateProfileFormula,
  mapFormula
};
