// Coerces raw extract rows and builds the lookup indexes every rule reads through ctx.idx.

export function buildIndexes(masters, extract) {
  const taByKey = new Map();
  const taBySku = new Map();
  for (const ta of masters.tradeAgreements) {
    taByKey.set(`${ta.vendorId}|${ta.sku}`, ta);
    taBySku.set(ta.sku, ta);
  }

  const linesBySku = new Map();
  for (const line of extract.poLines) {
    if (!linesBySku.has(line.sku)) linesBySku.set(line.sku, []);
    linesBySku.get(line.sku).push(line);
  }

  return {
    taByKey,
    taBySku,
    linesBySku,
    formularyBySku: new Map(masters.formulary.map((f) => [f.sku, f])),
    unitById: new Map(masters.units.map((u) => [u.id, u])),
    principalById: new Map(masters.principals.map((p) => [p.vendorId, p])),
    historyByKey: new Map(extract.priceHistory.map((h) => [`${h.unit}|${h.sku}`, h])),
    usageByKey: new Map(extract.usageLines.map((u) => [`${u.unit}|${u.sku}`, u]))
  };
}

// "2026-09-16" -> "16 Sep 2026" for display, matching the existing UI.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function displayDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
