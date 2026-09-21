// Peer and price-history benchmarking — the "benchmark" step of
// extract -> benchmark -> flag -> notify. Shared by every rule.

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function peerStats(sku, excludeUnit, idx) {
  const ta = idx.taBySku.get(sku);
  const peers = (idx.linesBySku.get(sku) ?? []).filter((l) => l.unit !== excludeUnit);
  const prices = peers.map((l) => l.unitPrice);
  const ceiling = ta ? ta.contractPrice + ta.toleranceIDR : Infinity;
  return {
    n: peers.length,
    medianUnit: median(prices),
    minUnit: prices.length ? Math.min(...prices) : 0,
    maxUnit: prices.length ? Math.max(...prices) : 0,
    allAtTarget: prices.length > 0 && prices.every((p) => p <= ceiling)
  };
}

export function priceTrend(sku, unit, idx) {
  const ta = idx.taBySku.get(sku);
  const history = idx.historyByKey.get(`${unit}|${sku}`);
  if (!ta || !history) return { weeksObserved: 0, weeksClean: 0, priorViolations: 0 };
  const ceiling = ta.contractPrice + ta.toleranceIDR;
  const priorViolations = history.prices.filter((p) => p > ceiling).length;
  return {
    weeksObserved: history.prices.length,
    weeksClean: history.prices.length - priorViolations,
    priorViolations
  };
}
