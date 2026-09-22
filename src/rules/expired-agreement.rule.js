// Buying against a trade agreement whose validity window has lapsed.
// Non-compliance even when the price held; recoverable rupiah only if it drifted.
import { formatIDR, formatIDRFull } from '../money.js';
import { displayDate } from '../normalize.js';
import { refFor } from '../refs.js';

export default {
  id: 'expired-agreement',
  dataset: 'poLines',
  type: 'expired',
  issue: 'Expired agreement',
  badgeClass: 'badge-rose',
  severity: 'medium',
  savingsCategory: 'Expired Agreements',
  priority: 20,
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
    return row.poDate > ta.validTo;
  },

  evaluate(row, ctx) {
    const ta = ctx.idx.taByKey.get(`${row.vendorId}|${row.sku}`);
    const excess = row.unitPrice - ta.contractPrice;
    const savingsRaw = Math.max(0, Math.round(excess * row.qty));
    const amountRaw = Math.round(row.unitPrice * row.qty);
    const peers = ctx.benchmark.peerStats(row.sku, row.unit, ctx.idx);

    return {
      amountRaw,
      savingsRaw,
      metrics: {
        agreementNo: ta.agreementNo,
        validTo: ta.validTo,
        actualUnitPrice: row.unitPrice,
        lapsedContractPrice: ta.contractPrice,
        qty: row.qty,
        uom: row.uom,
        peerMedian: peers.medianUnit
      },
      finding: `Purchased ${row.qty} ${row.uom} on ${displayDate(row.poDate)} against ${ta.agreementNo}, `
        + `which expired ${displayDate(ta.validTo)}. Paid ${formatIDRFull(row.unitPrice)} vs lapsed schedule `
        + `${formatIDRFull(ta.contractPrice)}.`,
      trendNote: `Group median paid for this item this week is ${formatIDR(peers.medianUnit)} across ${peers.n} other lines. `
        + `No successor agreement is loaded, so every unit is exposed until sourcing renews it.`,
      rootCause: `Agreement ${ta.agreementNo} lapsed on ${ta.validTo} and no renewal has been loaded in D365. `
        + `Purchasing continued to transact on the expired schedule.`,
      suggestedAction: savingsRaw > 0
        ? `Escalate to Sourcing for renewal and recover ${formatIDR(savingsRaw)} of price drift from ${row.unit}.`
        : `Escalate ${ta.agreementNo} to Sourcing for renewal. Price held, so no recovery is claimed on this line.`
    };
  }
};
