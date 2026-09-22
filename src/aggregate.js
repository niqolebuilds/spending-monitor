// Every figure the pages used to hard-code, derived from one run.
// Percentages are computed from the sums they label, so they cannot disagree.
import { formatIDR } from './money.js';

const live = (e) => e.status !== 'false_positive';
const fromPoLine = (e) => e.ref.startsWith('poLine|');
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);

function barClass(compliancePct) {
  if (compliancePct >= 95) return 'emerald';
  if (compliancePct >= 90) return 'blue';
  return 'rose';
}

export function buildKpis(run, masters, extract) {
  const counted = run.exceptions.filter(live);
  const closed = run.exceptions.filter((e) => e.closedAt);

  const potentialSavingsRaw = sum(counted, 'savingsRaw');
  const validatedSavingsRaw = sum(closed, 'achievedSavingsRaw');
  const valueAtStakeRaw = sum(counted, 'amountRaw');
  const confirmedSavingsRaw = sum(counted.filter((e) => e.status === 'approved'), 'savingsRaw');

  const flaggedLines = new Set(run.exceptions.filter(fromPoLine).filter(live).map((e) => e.ref));
  const compliancePct = Number((((extract.poLines.length - flaggedLines.size) / extract.poLines.length) * 100).toFixed(1));

  // Three steps, because three is what the monitor actually tracks: what the
  // rules found, what a reviewer confirmed, and what a person verified as banked.
  const funnelSteps = [
    { label: 'Identified by scan rules', amountRaw: potentialSavingsRaw },
    { label: 'Confirmed by HO reviewer', amountRaw: confirmedSavingsRaw },
    { label: 'Achieved & verified in revised POs', amountRaw: validatedSavingsRaw }
  ];
  const funnelBase = funnelSteps[0].amountRaw || 1;
  const funnel = funnelSteps.map((step) => ({
    ...step,
    amount: formatIDR(step.amountRaw),
    pct: Math.round((step.amountRaw / funnelBase) * 100)
  }));

  // Leakage is measured on exposure, not gross line value: a UOM keying error
  // inflates its own line total, and counting that as leakage would swamp the
  // categories where money is actually at risk.
  const byCategory = new Map();
  for (const e of counted) {
    const current = byCategory.get(e.savingsCategory)
      ?? { category: e.savingsCategory, exposureRaw: 0, amountRaw: 0, savingsRaw: 0, count: 0 };
    current.exposureRaw += e.exposureRaw;
    current.amountRaw += e.amountRaw;
    current.savingsRaw += e.savingsRaw;
    current.count += 1;
    byCategory.set(e.savingsCategory, current);
  }
  const leakageRows = [...byCategory.values()].filter((row) => row.exposureRaw > 0);
  const leakageTotal = sum(leakageRows, 'exposureRaw') || 1;
  const leakage = leakageRows
    .sort((a, b) => b.exposureRaw - a.exposureRaw)
    .map((row) => ({
      ...row,
      exposure: formatIDR(row.exposureRaw),
      amount: formatIDR(row.amountRaw),
      savings: formatIDR(row.savingsRaw),
      pct: Math.round((row.exposureRaw / leakageTotal) * 100)
    }));

  return {
    weekId: run.weekId,
    asOf: run.asOf,
    linesScanned: run.linesScanned,
    // Rows read vs rows a rule actually assessed. A gap means codes did not
    // resolve against the masters, and those rows are invisible to every rule.
    coverage: run.coverage,
    unitCount: masters.units.length,
    exceptionCount: counted.length,
    highSeverityCount: counted.filter((e) => e.severity === 'high').length,
    pendingCount: run.exceptions.filter((e) => e.status === 'pending').length,
    approvedCount: run.exceptions.filter((e) => e.status === 'approved').length,
    dismissedCount: run.exceptions.filter((e) => e.status === 'false_positive').length,
    closedCount: closed.length,
    unitsAffected: new Set(counted.filter((e) => e.unit !== 'GROUP').map((e) => e.unit)).size,
    potentialSavingsRaw,
    potentialSavings: formatIDR(potentialSavingsRaw),
    validatedSavingsRaw,
    validatedSavings: formatIDR(validatedSavingsRaw),
    valueAtStakeRaw,
    valueAtStake: formatIDR(valueAtStakeRaw),
    compliancePct,
    funnel,
    leakage
  };
}

export function buildLeaderboard(run, masters, extract) {
  const requestByUnit = new Map(extract.requestLog.map((r) => [r.unit, r]));
  const linesByUnit = new Map();
  for (const line of extract.poLines) {
    linesByUnit.set(line.unit, (linesByUnit.get(line.unit) ?? 0) + 1);
  }

  const flaggedByUnit = new Map();
  const savingsByUnit = new Map();
  for (const e of run.exceptions) {
    if (!live(e) || e.unit === 'GROUP') continue;
    if (fromPoLine(e)) flaggedByUnit.set(e.unit, (flaggedByUnit.get(e.unit) ?? 0) + 1);
    savingsByUnit.set(e.unit, (savingsByUnit.get(e.unit) ?? 0) + e.savingsRaw);
  }

  const rows = masters.units.map((unit) => {
    const lines = linesByUnit.get(unit.id) ?? 0;
    const flagged = flaggedByUnit.get(unit.id) ?? 0;
    const compliancePct = lines ? Number((((lines - flagged) / lines) * 100).toFixed(1)) : 100;
    const log = requestByUnit.get(unit.id) ?? { requestsSent: 0, requestsAnswered: 0, avgReplyDays: 0 };
    const savingsRaw = savingsByUnit.get(unit.id) ?? 0;
    return {
      unit: unit.id,
      name: unit.name,
      region: unit.region,
      linesScanned: lines,
      exceptionCount: flagged,
      compliancePct,
      barClass: barClass(compliancePct),
      savingsRaw,
      savings: formatIDR(savingsRaw),
      requestsSent: log.requestsSent,
      requestsAnswered: log.requestsAnswered,
      answeredPct: log.requestsSent ? Math.round((log.requestsAnswered / log.requestsSent) * 100) : 0,
      avgReplyDays: log.avgReplyDays
    };
  });

  rows.sort((a, b) => b.compliancePct - a.compliancePct || b.savingsRaw - a.savingsRaw || a.unit.localeCompare(b.unit));
  return rows.map((row, i) => ({ ...row, rank: i + 1, rankOf: rows.length }));
}

export function buildRebateSummary(run, masters, extract) {
  const ledgerByVendor = new Map(extract.rebateLedger.map((r) => [r.vendorId, r]));
  const exceptionByVendor = new Map(
    run.exceptions.filter((e) => e.ruleId === 'rebate-tier-gap').map((e) => [e.ref.split('|')[1], e])
  );

  const principals = masters.principals.map((p) => {
    const ledger = ledgerByVendor.get(p.vendorId);
    const exception = exceptionByVendor.get(p.vendorId);
    const ytd = ledger?.ytdPurchaseIDR ?? 0;

    const atTier2 = ytd >= p.tier2TargetIDR;
    const atTier1 = !atTier2 && ytd >= p.tier1TargetIDR;
    const category = atTier2 ? 'top' : atTier1 ? 'reach' : 'risk';
    const gapRaw = atTier2 ? 0 : (atTier1 ? p.tier2TargetIDR : p.tier1TargetIDR) - ytd;

    return {
      vendorId: p.vendorId,
      name: p.name,
      category,
      tier: atTier2 ? 'Tier 2' : atTier1 ? 'Tier 1' : 'Tier 0',
      tierClass: atTier2 ? 'badge-emerald' : atTier1 ? 'badge-indigo' : 'badge-rose',
      status: atTier2 ? 'Tier 2 secured' : atTier1 ? 'Tier 2 within reach' : 'At risk: below Tier 1',
      ytdPurchase: formatIDR(ytd),
      ytdPurchaseRaw: ytd,
      gap: gapRaw ? formatIDR(gapRaw) : '—',
      gapRaw,
      rebateAtStake: exception ? exception.savings : '—',
      rebateAtStakeRaw: exception?.savingsRaw ?? 0,
      weeksRemaining: ledger?.weeksRemaining ?? 0,
      move: exception ? exception.suggestedAction : 'Tier secured — hold current volume allocation.',
      exceptionId: exception?.id ?? null
    };
  });

  principals.sort((a, b) => b.rebateAtStakeRaw - a.rebateAtStakeRaw || a.name.localeCompare(b.name));

  const counts = {
    total: principals.length,
    top: principals.filter((p) => p.category === 'top').length,
    reach: principals.filter((p) => p.category === 'reach').length,
    risk: principals.filter((p) => p.category === 'risk').length
  };
  const atStakeRaw = sum(principals, 'rebateAtStakeRaw');

  return {
    principals,
    counts,
    weeksRemaining: extract.rebateLedger[0]?.weeksRemaining ?? 0,
    atStakeRaw,
    atStake: formatIDR(atStakeRaw),
    closestGap: principals.filter((p) => p.gapRaw > 0).sort((a, b) => a.gapRaw - b.gapRaw)[0] ?? null
  };
}
