// Third dataset: 90-day usage against purchasing. Stock bought well ahead of
// dispensing ties up working capital and carries expiry risk.
import { formatIDR } from '../money.js';
import { refFor } from '../refs.js';

const COVER_WEEKS = 4;

export default {
  id: 'usage-vs-purchase',
  dataset: 'usageLines',
  type: 'usage',
  issue: 'Overstock vs usage',
  badgeClass: 'badge-amber',
  severity: 'low',
  savingsCategory: 'Overstock & Expiry Risk',
  priority: 70,
  autoEligible: false,

  identity(row, ctx) {
    const sku = ctx.idx.formularyBySku.get(row.sku);
    return {
      ref: refFor('usageLines', row),
      unit: row.unit,
      region: ctx.idx.unitById.get(row.unit).region,
      item: sku.name,
      vendor: ctx.idx.principalById.get(sku.vendorId).name,
      poNumber: `USG-${row.unit}-2026W38`,
      poLine: 0,
      poDate: '20 Sep 2026'
    };
  },

  // Responsibility only. Whether the row is actually overstocked is decided in
  // evaluate(), so a healthy row counts as assessed rather than unexamined.
  applies(row, ctx) {
    return ctx.idx.formularyBySku.has(row.sku) && row.purchasedQty90d > 0;
  },

  evaluate(row, ctx) {
    if (row.dispensedQty90d / row.purchasedQty90d >= 0.6) return null;

    const sku = ctx.idx.formularyBySku.get(row.sku);
    const ta = ctx.idx.taBySku.get(row.sku);
    const unitPrice = ta ? ta.contractPrice : sku.referencePrice;

    // Keep a month of cover at the observed run rate; only the surplus is excess.
    const weeklyUse = row.dispensedQty90d / 13;
    const coverQty = Math.round(weeklyUse * COVER_WEEKS);
    const excessQty = row.onHandQty - coverQty;
    if (excessQty <= 0) return null;

    const excessValue = Math.round(excessQty * unitPrice);
    if (excessValue < 1000000) return null;

    const weeksOfCover = weeklyUse > 0 ? Math.round(row.onHandQty / weeklyUse) : 999;

    return {
      amountRaw: excessValue,
      // Working capital already committed over 90 days, not a weekly recovery —
      // booking it as savings would overstate what this week's scan can recover.
      savingsRaw: 0,
      exposureRaw: excessValue,
      metrics: {
        excessValueRaw: excessValue,
        purchasedQty90d: row.purchasedQty90d,
        dispensedQty90d: row.dispensedQty90d,
        onHandQty: row.onHandQty,
        coverQty,
        excessQty,
        weeksOfCover,
        unitPrice
      },
      finding: `${row.unit} purchased ${row.purchasedQty90d} ${sku.uom} over 90 days but dispensed `
        + `${row.dispensedQty90d}. ${row.onHandQty} on hand is ${weeksOfCover} weeks of cover; `
        + `${excessQty} ${sku.uom} beyond a ${COVER_WEEKS}-week target is ${formatIDR(excessValue)} committed early.`,
      trendNote: `At the observed run rate of ${Math.round(weeklyUse)} ${sku.uom}/wk, the surplus clears in `
        + `${weeksOfCover} weeks — beyond that the exposure is expiry, not just working capital.`,
      rootCause: `Ordering at ${row.unit} is tracking a pack or reorder quantity rather than the dispensing `
        + `run rate, so replenishment outpaces consumption.`,
      suggestedAction: `Ask ${row.unit} Pharmacy to suspend replenishment of ${sku.sku} until cover falls below `
        + `${COVER_WEEKS} weeks, and redeploy ${formatIDR(excessValue)} of stock across the region where possible.`
    };
  }
};
