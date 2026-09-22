// One definition of a row's stable identity, shared by the rules (which stamp it
// onto a finding) and the engine (which uses it for dedupe, coverage accounting
// and decision keys). A ref is derived from the row's own contents, so it
// survives re-ranking, re-scans and master-data corrections.
export const REF_BUILDERS = {
  poLines: (row) => `poLine|${row.lineId}`,
  rebateLedger: (row) => `rebate|${row.vendorId}`,
  usageLines: (row) => `usage|${row.unit}|${row.sku}`
};

export const SCANNED_DATASETS = Object.keys(REF_BUILDERS);

export function refFor(dataset, row) {
  const build = REF_BUILDERS[dataset];
  if (!build) throw new Error(`no ref builder registered for dataset "${dataset}"`);
  return build(row);
}

// Guards the API against arbitrary keys reaching the decision store.
export const REF_PATTERN = /^(poLine|rebate|usage)\|[A-Za-z0-9._|-]{1,120}$/;

export const isRef = (value) => typeof value === 'string' && REF_PATTERN.test(value);
