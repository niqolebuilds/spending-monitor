// Purchasing off-formulary when a formulary equivalent exists.
// Recoverable rupiah = the premium over the equivalent's contracted price.
import { formatIDR, formatIDRFull, pct } from '../money.js';
import { displayDate } from '../normalize.js';

export default {
  id: 'non-formulary',
  dataset: 'poLines',
  type: 'formulary',
  issue: 'Non-formulary',
  badgeClass: 'badge-amber',
  severity: 'medium',
  savingsCategory: 'Non-Formulary Items',
  priority: 40,
  autoEligible: true,

  identity(row, ctx) {
    const sku = ctx.idx.formularyBySku.get(row.sku);
    return {
      ref: `poLine|${row.lineId}`,
      unit: row.unit,
      region: ctx.idx.unitById.get(row.unit).region,
      item: sku.name,
      vendor: ctx.idx.principalById.get(row.vendorId).name,
      poNumber: row.poNumber,
      poLine: row.poLine,
      poDate: displayDate(row.poDate)
    };
  },

  applies(row, ctx) {
    const sku = ctx.idx.formularyBySku.get(row.sku);
    const ta = ctx.idx.taByKey.get(`${row.vendorId}|${row.sku}`);
    if (!sku || !ta) return false;
    if (row.uom !== sku.uom) return false;
    if (sku.formularyStatus !== 'non-formulary') return false;
    return row.poDate >= ta.validFrom && row.poDate <= ta.validTo;
  },

  evaluate(row, ctx) {
    const sku = ctx.idx.formularyBySku.get(row.sku);
    const equivalent = sku.equivalentSku ? ctx.idx.formularyBySku.get(sku.equivalentSku) : null;
    const equivalentTA = equivalent ? ctx.idx.taBySku.get(equivalent.sku) : null;
    const amountRaw = Math.round(row.unitPrice * row.qty);

    const premiumPerUnit = equivalentTA ? row.unitPrice - equivalentTA.contractPrice : 0;
    const savingsRaw = Math.max(0, Math.round(premiumPerUnit * row.qty));

    return {
      amountRaw,
      savingsRaw,
      severity: savingsRaw >= 25000000 ? 'high' : 'medium',
      metrics: {
        actualUnitPrice: row.unitPrice,
        equivalentSku: equivalent?.sku ?? null,
        equivalentPrice: equivalentTA?.contractPrice ?? null,
        premiumPct: equivalentTA ? pct(premiumPerUnit, equivalentTA.contractPrice) : null,
        qty: row.qty,
        uom: row.uom
      },
      evidenceBars: equivalentTA
        ? { actualPct: 100, targetPct: Math.round((equivalentTA.contractPrice / row.unitPrice) * 100) }
        : null,
      finding: equivalent
        ? `${sku.name} is off-formulary. ${row.qty} ${row.uom} bought at ${formatIDRFull(row.unitPrice)} `
          + `vs formulary equivalent ${equivalent.name} at ${formatIDRFull(equivalentTA.contractPrice)} `
          + `(+${pct(premiumPerUnit, equivalentTA.contractPrice)}%).`
        : `${sku.name} is off-formulary with no listed equivalent. ${row.qty} ${row.uom} bought at `
          + `${formatIDRFull(row.unitPrice)}.`,
      trendNote: equivalent
        ? `The formulary equivalent ${equivalent.sku} is on contract and stocked group-wide. `
          + `Switching this line alone releases ${formatIDR(savingsRaw)}.`
        : `No formulary equivalent is listed for this SKU — this is a formulary coverage gap, not a unit error.`,
      rootCause: equivalent
        ? `${row.unit} ordered outside the formulary while ${equivalent.sku} was available on agreement. `
          + `Typically a catalogue search defaulting to the vendor's preferred line.`
        : `The item has no formulary entry to substitute toward. Pharmacy & Therapeutics review is required.`,
      suggestedAction: equivalent
        ? `Confirm and request ${row.unit} Pharmacy substitute to ${equivalent.sku} on the next cycle `
          + `(${formatIDR(savingsRaw)} avoidable).`
        : `Refer ${sku.sku} to the P&T committee for a formulary decision before the next cycle.`
    };
  }
};
