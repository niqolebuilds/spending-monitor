// extract -> benchmark -> flag. Rules supply the domain knowledge; the engine
// owns identity, ordering, id assignment, money formatting and status merge.
import { buildIndexes } from './normalize.js';
import { peerStats, priceTrend } from './benchmark.js';
import { loadRules } from './rules/registry.js';
import { formatIDR } from './money.js';

// The L3 seam. Under L2 every finding is analyst-confirmed, so this always
// returns "review"; a supervised run routes sub-threshold findings to "auto".
export function gate(savingsRaw, rule, settings) {
  if (settings.mode !== 'L3' || !rule.autoEligible) return 'review';
  return savingsRaw < settings.thresholdIDR ? 'auto' : 'review';
}

export async function runEngine({ masters, extract, settings, asOf, decisions = {} }) {
  const idx = buildIndexes(masters, extract);
  const ctx = { idx, masters, settings, asOf, benchmark: { peerStats, priceTrend } };
  const rules = await loadRules();

  // One finding per source row: the highest-precedence rule owns the row, so a
  // line that is both off-formulary and overpriced cannot be counted twice.
  const byRef = new Map();
  for (const rule of rules) {
    for (const row of extract[rule.dataset] ?? []) {
      if (!rule.applies(row, ctx)) continue;
      const hit = rule.evaluate(row, ctx);
      if (!hit) continue;
      const identity = rule.identity(row, ctx);
      const held = byRef.get(identity.ref);
      if (held && held.rule.priority <= rule.priority) continue;
      byRef.set(identity.ref, { rule, identity, hit });
    }
  }

  // Deterministic order: biggest exposure first, ref breaks ties so ids are
  // stable across runs and persisted decisions keep pointing at the same finding.
  const found = [...byRef.values()];
  found.sort((a, b) => b.hit.savingsRaw - a.hit.savingsRaw || a.identity.ref.localeCompare(b.identity.ref));

  const exceptions = found.map(({ rule, identity, hit }, i) => {
    const id = `EXP-${String(i + 1).padStart(2, '0')}`;
    const decision = decisions[id];
    return {
      id,
      ref: identity.ref,
      ruleId: rule.id,
      type: rule.type,
      issue: rule.issue,
      badgeClass: rule.badgeClass,
      severity: hit.severity ?? rule.severity,
      savingsCategory: rule.savingsCategory,
      unit: identity.unit,
      region: identity.region,
      item: identity.item,
      vendor: identity.vendor,
      poNumber: identity.poNumber,
      poLine: identity.poLine,
      poDate: identity.poDate,
      amount: formatIDR(hit.amountRaw),
      amountRaw: hit.amountRaw,
      savings: formatIDR(hit.savingsRaw),
      savingsRaw: hit.savingsRaw,
      // What is genuinely at risk in this category. Defaults to the recoverable
      // amount; rules whose exposure is not a price recovery override it.
      exposureRaw: hit.exposureRaw ?? hit.savingsRaw,
      exposure: formatIDR(hit.exposureRaw ?? hit.savingsRaw),
      status: decision?.status ?? 'pending',
      decidedBy: decision?.actor ?? null,
      decidedAt: decision?.at ?? null,
      closedAt: decision?.closedAt ?? null,
      achievedSavingsRaw: decision?.achievedSavingsRaw ?? null,
      response: decision?.response ?? null,
      lane: gate(hit.savingsRaw, rule, settings),
      finding: hit.finding,
      trendNote: hit.trendNote,
      rootCause: hit.rootCause,
      suggestedAction: hit.suggestedAction,
      metrics: hit.metrics,
      evidenceBars: hit.evidenceBars ?? null
    };
  });

  return {
    runId: `RUN-${extract.weekId}`,
    weekId: extract.weekId,
    asOf,
    linesScanned: extract.poLines.length,
    rulesApplied: rules.map((r) => r.id),
    exceptions
  };
}
