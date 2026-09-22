// extract -> benchmark -> flag. Rules supply the domain knowledge; the engine
// owns identity, ordering, id assignment, money formatting and status merge.
import { buildIndexes } from './normalize.js';
import { peerStats, priceTrend } from './benchmark.js';
import { loadRules } from './rules/registry.js';
import { formatIDR } from './money.js';
import { refFor, SCANNED_DATASETS } from './refs.js';

// The L3 seam. Under L2 every finding is analyst-confirmed, so this always
// returns "review"; a supervised run routes sub-threshold findings to "auto".
export function gate(savingsRaw, rule, settings) {
  if (settings.mode !== 'L3' || !rule.autoEligible) return 'review';
  return savingsRaw < settings.thresholdIDR ? 'auto' : 'review';
}

// A row no rule claimed was never assessed against anything — usually an
// unmatched vendor or SKU code, or a PO dated before its agreement takes
// effect. Reporting rows read as rows scanned would overstate coverage.
function buildCoverage(extract, assessedByDataset) {
  const datasets = {};
  let rowsRead = 0;
  let rowsAssessed = 0;
  const unassessedRefs = [];

  for (const dataset of SCANNED_DATASETS) {
    const rows = extract[dataset] ?? [];
    const assessed = assessedByDataset.get(dataset) ?? new Set();
    const missed = rows.map((row) => refFor(dataset, row)).filter((ref) => !assessed.has(ref));

    datasets[dataset] = {
      rowsRead: rows.length,
      rowsAssessed: rows.length - missed.length,
      rowsUnassessed: missed.length
    };
    rowsRead += rows.length;
    rowsAssessed += rows.length - missed.length;
    unassessedRefs.push(...missed);
  }

  return {
    rowsRead,
    rowsAssessed,
    rowsUnassessed: rowsRead - rowsAssessed,
    assessedPct: rowsRead ? Number(((rowsAssessed / rowsRead) * 100).toFixed(1)) : 100,
    datasets,
    // Capped: this is a signal to investigate, not a data dump.
    unassessedRefs: unassessedRefs.slice(0, 200)
  };
}

export async function runEngine({ masters, extract, settings, asOf, decisions = {} }) {
  const idx = buildIndexes(masters, extract);
  const ctx = { idx, masters, settings, asOf, benchmark: { peerStats, priceTrend } };
  const rules = await loadRules();

  // One finding per source row: the highest-precedence rule owns the row, so a
  // line that is both off-formulary and overpriced cannot be counted twice.
  // Rows that no rule even claimed are tracked, because a row that silently
  // matches nothing is indistinguishable from a compliant one otherwise.
  const byRef = new Map();
  const assessedByDataset = new Map(SCANNED_DATASETS.map((dataset) => [dataset, new Set()]));

  for (const rule of rules) {
    for (const row of extract[rule.dataset] ?? []) {
      if (!rule.applies(row, ctx)) continue;
      assessedByDataset.get(rule.dataset)?.add(refFor(rule.dataset, row));
      const hit = rule.evaluate(row, ctx);
      if (!hit) continue;
      const identity = rule.identity(row, ctx);
      const held = byRef.get(identity.ref);
      if (held && held.rule.priority <= rule.priority) continue;
      byRef.set(identity.ref, { rule, identity, hit });
    }
  }

  const coverage = buildCoverage(extract, assessedByDataset);

  // Deterministic order: biggest exposure first, ref breaks ties so ids are
  // stable across runs and persisted decisions keep pointing at the same finding.
  const found = [...byRef.values()];
  found.sort((a, b) => b.hit.savingsRaw - a.hit.savingsRaw || a.identity.ref.localeCompare(b.identity.ref));

  const exceptions = found.map(({ rule, identity, hit }, i) => {
    // EXP-NN is a display label only. Decisions are keyed by ref, which is
    // derived from the row, so re-ranking or a master-data fix cannot move a
    // recorded decision onto a different finding.
    const decision = decisions[identity.ref];
    return {
      id: `EXP-${String(i + 1).padStart(2, '0')}`,
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
    periodId: extract.weekId,
    asOf,
    linesScanned: extract.poLines.length,
    coverage,
    rulesApplied: rules.map((r) => r.id),
    exceptions
  };
}
