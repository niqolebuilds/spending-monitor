// The unit of measure on the line disagrees with the item master and the price
// moved by a multiple — almost always a keying error rather than real leakage.
import { formatIDRFull } from '../money.js';
import { displayDate } from '../normalize.js';
import { refFor } from '../refs.js';

export default {
  id: 'uom-mismatch',
  dataset: 'poLines',
  type: 'uom',
  issue: 'UOM mismatch',
  badgeClass: 'badge-slate',
  severity: 'low',
  savingsCategory: 'UOM Keying Errors',
  priority: 10,
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
    return row.uom !== sku.uom;
  },

  evaluate(row, ctx) {
    const sku = ctx.idx.formularyBySku.get(row.sku);
    const ta = ctx.idx.taByKey.get(`${row.vendorId}|${row.sku}`);
    const ratio = row.unitPrice / ta.contractPrice;
    // A modest difference is a legitimate alternate pack size, not a keying slip.
    if (ratio < 5) return null;

    const amountRaw = Math.round(row.unitPrice * row.qty);

    return {
      amountRaw,
      savingsRaw: 0,
      metrics: {
        lineUom: row.uom,
        masterUom: sku.uom,
        actualUnitPrice: row.unitPrice,
        contractPrice: ta.contractPrice,
        priceRatio: Number(ratio.toFixed(1)),
        qty: row.qty,
        exposureRaw: amountRaw
      },
      finding: `Line keyed in ${row.uom} but the item master is priced per ${sku.uom}. `
        + `${formatIDRFull(row.unitPrice)} is ${ratio.toFixed(1)}× the contracted `
        + `${formatIDRFull(ta.contractPrice)} per ${sku.uom}.`,
      trendNote: `A whole-multiple price gap with a mismatched UOM is the signature of a pack-size keying `
        + `error, not a negotiated price change. Treat as a data-quality finding until the unit confirms.`,
      rootCause: `${row.unit} raised the line against the pack UOM while D365 holds the per-${sku.uom} price, `
        + `so the extract compares a pack price against a unit schedule.`,
      suggestedAction: `Ask ${row.unit} Purchasing to confirm the UOM on ${row.poNumber} line ${row.poLine} `
        + `(raised ${displayDate(row.poDate)}) before any recovery is claimed. No savings booked.`
    };
  }
};
