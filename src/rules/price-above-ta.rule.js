// Reference implementation of the rule contract.
// A PO line invoiced above the price schedule of a trade agreement that was
// live on the PO date. Recoverable rupiah = the excess, times quantity.
import { formatIDR, formatIDRFull, pct } from '../money.js';
import { displayDate } from '../normalize.js';
import { refFor } from '../refs.js';

export default {
  id: 'price-above-ta',
  dataset: 'poLines',
  type: 'price',
  issue: 'Price above TA',
  badgeClass: 'badge-rose',
  severity: 'high',
  savingsCategory: 'Price Above Trade Agreement',
  priority: 30,
  autoEligible: true,

  identity(row, ctx) {
    const sku = ctx.idx.formularyBySku.get(row.sku);
    const unit = ctx.idx.unitById.get(row.unit);
    return {
      ref: refFor('poLines', row),
      unit: row.unit,
      region: unit.region,
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
    // A UOM keying error is a different finding; a lapsed agreement is another.
    if (row.uom !== sku.uom) return false;
    if (sku.formularyStatus !== 'formulary') return false;
    return row.poDate >= ta.validFrom && row.poDate <= ta.validTo;
  },

  evaluate(row, ctx) {
    const ta = ctx.idx.taByKey.get(`${row.vendorId}|${row.sku}`);
    const excess = row.unitPrice - ta.contractPrice;
    if (excess <= ta.toleranceIDR) return null;

    const savingsRaw = Math.round(excess * row.qty);
    const variancePct = pct(excess, ta.contractPrice);
    const peers = ctx.benchmark.peerStats(row.sku, row.unit, ctx.idx);
    const trend = ctx.benchmark.priceTrend(row.sku, row.unit, ctx.idx);

    return {
      amountRaw: Math.round(row.unitPrice * row.qty),
      savingsRaw,
      severity: savingsRaw >= 25000000 ? 'high' : savingsRaw >= 5000000 ? 'medium' : 'low',
      metrics: {
        actualUnitPrice: row.unitPrice,
        targetUnitPrice: ta.contractPrice,
        variancePct,
        qty: row.qty,
        uom: row.uom,
        agreementNo: ta.agreementNo,
        peerCount: peers.n,
        peerMedian: peers.medianUnit
      },
      evidenceBars: {
        actualPct: 100,
        targetPct: Math.round((ta.contractPrice / row.unitPrice) * 100)
      },
      finding: `PO price ${formatIDRFull(row.unitPrice)} vs trade agreement `
        + `${formatIDRFull(ta.contractPrice)} (+${variancePct}%) × ${row.qty} ${row.uom}`,
      trendNote: peers.allAtTarget
        ? `All ${peers.n} other units bought at the agreed price (${formatIDR(peers.medianUnit)}). `
          + `${row.unit} has been clean for ${trend.weeksClean} of the last ${trend.weeksObserved} weeks.`
        : `${peers.n} peer lines this week, median ${formatIDR(peers.medianUnit)}. `
          + `${row.unit} shows ${trend.priorViolations} prior variance week(s) in the last ${trend.weeksObserved}.`,
      rootCause: `Agreement ${ta.agreementNo} (effective ${ta.validFrom}) is not reflected in the `
        + `${row.unit} unit master in D365, so the line pulled list price instead of the contracted schedule.`,
      suggestedAction: `Confirm the finding and dispatch a PO revision request to ${row.unit} Purchasing `
        + `to recover ${formatIDR(savingsRaw)} against ${ta.agreementNo}.`
    };
  }
};
