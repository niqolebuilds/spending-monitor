// Formulary items that BPJS does not cover. The money here is claim-rejection
// exposure, not a price recovery, so no savings are claimed against it.
import { formatIDR, formatIDRFull } from '../money.js';
import { displayDate } from '../normalize.js';
import { refFor } from '../refs.js';

export default {
  id: 'bpjs-non-formulary',
  dataset: 'poLines',
  type: 'bpjs',
  issue: 'BPJS non-formulary',
  badgeClass: 'badge-amber',
  severity: 'high',
  savingsCategory: 'BPJS Non-Formulary',
  priority: 50,
  autoEligible: false,

  identity(row, ctx) {
    const sku = ctx.idx.formularyBySku.get(row.sku);
    return {
      ref: refFor('poLines', row),
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
    if (sku.formularyStatus !== 'formulary' || sku.bpjsCovered) return false;
    return row.poDate >= ta.validFrom && row.poDate <= ta.validTo;
  },

  evaluate(row, ctx) {
    const sku = ctx.idx.formularyBySku.get(row.sku);
    const amountRaw = Math.round(row.unitPrice * row.qty);
    // Below the cost of a reviewer's time to chase; the exposure is immaterial.
    if (amountRaw < 2000000) return null;

    const peers = ctx.benchmark.peerStats(row.sku, row.unit, ctx.idx);

    return {
      amountRaw,
      savingsRaw: 0,
      exposureRaw: amountRaw,
      metrics: {
        actualUnitPrice: row.unitPrice,
        qty: row.qty,
        uom: row.uom,
        exposureRaw: amountRaw,
        bpjsCovered: false,
        peerLines: peers.n
      },
      finding: `${sku.name} is not covered under BPJS. ${row.qty} ${row.uom} at `
        + `${formatIDRFull(row.unitPrice)} — ${formatIDR(amountRaw)} is exposed to claim rejection.`,
      trendNote: `${peers.n} other lines for this SKU were raised group-wide this week, so the exposure `
        + `is systemic rather than isolated to ${row.unit}.`,
      rootCause: `The item sits on the hospital formulary but outside the BPJS benefit list. Cases billed to `
        + `BPJS using it will be rejected or down-coded at claim review.`,
      suggestedAction: `Confirm with ${row.unit} Pharmacy that usage is restricted to non-BPJS cases, and flag `
        + `${formatIDR(amountRaw)} to Finance as claim-rejection exposure. No price recovery is claimed.`
    };
  }
};
