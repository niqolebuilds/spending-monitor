// Same contract, different dataset: the rebate ledger rather than PO lines.
// Principals trailing a volume tier, with the incremental rebate at stake.
import { formatIDR } from '../money.js';
import { refFor } from '../refs.js';

export default {
  id: 'rebate-tier-gap',
  dataset: 'rebateLedger',
  type: 'rebate',
  issue: 'Rebate tier gap',
  badgeClass: 'badge-indigo',
  severity: 'medium',
  savingsCategory: 'Rebate Tier Shortfall',
  priority: 60,
  autoEligible: false,

  identity(row, ctx) {
    const principal = ctx.idx.principalById.get(row.vendorId);
    return {
      ref: refFor('rebateLedger', row),
      unit: 'GROUP',
      region: 'All units',
      item: `${principal.name} — volume rebate`,
      vendor: principal.name,
      poNumber: `REB-${row.vendorId}-2026`,
      poLine: 0,
      poDate: '20 Sep 2026'
    };
  },

  // Responsibility only. A principal that has already secured the top tier is
  // assessed and fine, not a row this rule failed to understand.
  applies(row, ctx) {
    return ctx.idx.principalById.has(row.vendorId);
  },

  evaluate(row, ctx) {
    const principal = ctx.idx.principalById.get(row.vendorId);
    if (row.ytdPurchaseIDR >= principal.tier2TargetIDR) return null;

    const { tier1TargetIDR: tier1, tier2TargetIDR: tier2, rebatePct } = principal;
    const atTier1 = row.ytdPurchaseIDR >= tier1;

    const currentTier = atTier1 ? 'Tier 1' : 'Tier 0';
    const nextTier = atTier1 ? 'Tier 2' : 'Tier 1';
    const nextTarget = atTier1 ? tier2 : tier1;
    const gapIDR = nextTarget - row.ytdPurchaseIDR;

    const earnedNow = atTier1 ? Math.round((tier1 * rebatePct) / 100) : 0;
    const earnedNext = Math.round((nextTarget * rebatePct) / 100);
    const savingsRaw = earnedNext - earnedNow;

    const weeklyRunRate = Math.round(row.ytdPurchaseIDR / row.weeksElapsed);
    const requiredWeekly = Math.round(gapIDR / row.weeksRemaining);
    const upliftPct = weeklyRunRate ? Math.round(((requiredWeekly - weeklyRunRate) / weeklyRunRate) * 100) : 0;

    return {
      amountRaw: savingsRaw,
      savingsRaw,
      severity: upliftPct > 40 ? 'low' : 'medium',
      metrics: {
        currentTier,
        nextTier,
        ytdPurchaseIDR: row.ytdPurchaseIDR,
        nextTarget,
        gapIDR,
        rebatePct,
        weeklyRunRate,
        requiredWeekly,
        upliftPct,
        weeksRemaining: row.weeksRemaining
      },
      finding: `${principal.name} is at ${formatIDR(row.ytdPurchaseIDR)} YTD against a ${nextTier} threshold of `
        + `${formatIDR(nextTarget)} — a ${formatIDR(gapIDR)} gap with ${row.weeksRemaining} weeks left. `
        + `${formatIDR(savingsRaw)} of rebate is at stake at ${rebatePct}%.`,
      trendNote: `Current run rate is ${formatIDR(weeklyRunRate)}/wk; closing the gap needs `
        + `${formatIDR(requiredWeekly)}/wk, a ${upliftPct}% uplift over the remaining ${row.weeksRemaining} weeks.`,
      rootCause: upliftPct > 40
        ? `The required uplift is beyond what organic demand will deliver. The gap reflects an over-set `
          + `threshold at contracting time rather than a steering failure.`
        : `Volume is leaking to off-contract substitutes in the ${principal.category} category, holding the `
          + `group below the ${nextTier} threshold.`,
      suggestedAction: upliftPct > 40
        ? `Hand ${principal.name} to Sourcing as a renegotiation target — reset the ${nextTier} threshold at `
          + `renewal rather than chase ${formatIDR(gapIDR)} in ${row.weeksRemaining} weeks.`
        : `Steer ${principal.category} volume to ${principal.name} to close ${formatIDR(gapIDR)} and unlock `
          + `${formatIDR(savingsRaw)} before year end.`
    };
  }
};
