// The ingest gate's job is to make bad input visible. These cases are the ones
// that would otherwise reach the engine and quietly produce nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateExtract, parseAmount } from '../src/sources/contract.js';

const masters = {
  units: [{ id: 'U21', name: 'Unit 21 · Jakarta', region: 'Jakarta' }],
  formulary: [{ sku: 'SKU-1001', name: 'Stent', vendorId: 'V-KEN', uom: 'pcs', formularyStatus: 'formulary', bpjsCovered: true, locked: false, equivalentSku: null, referencePrice: 16810000 }],
  principals: [{ vendorId: 'V-KEN', name: 'PT Kenari Distribusi', tier1TargetIDR: 1, tier2TargetIDR: 2, rebatePct: 1 }],
  tradeAgreements: [{ agreementNo: 'TA-1', vendorId: 'V-KEN', sku: 'SKU-1001', contractPrice: 16810000, toleranceIDR: 1000, validFrom: '2026-01-01', validTo: '2026-12-31' }]
};

const line = (over = {}) => ({
  lineId: 'L-1', poNumber: 'PO-1', poLine: '1', unit: 'U21', vendorId: 'V-KEN',
  sku: 'SKU-1001', qty: '10', uom: 'pcs', unitPrice: '20890000', poDate: '2026-09-16', ...over
});

const run = (poLines) => validateExtract(
  { weekId: '2026-W38', poLines, rebateLedger: [], usageLines: [], priceHistory: [], requestLog: [] },
  masters
);

test('a clean extract passes and is reported as clean', () => {
  const { rows, report } = run([line()]);
  assert.equal(report.ok, true);
  assert.equal(rows.poLines.length, 1);
  assert.equal(report.totals.rejected, 0);
});

test('string numbers are coerced so the rules get real numbers', () => {
  const { rows } = run([line()]);
  assert.equal(rows.poLines[0].qty, 10);
  assert.equal(rows.poLines[0].unitPrice, 20890000);
  assert.equal(rows.poLines[0].poLine, 1);
});

test('Indonesian thousands separators are accepted, not rejected', () => {
  const { rows, report } = run([line({ unitPrice: '1.250.000' })]);
  assert.equal(report.totals.rejected, 0);
  assert.equal(rows.poLines[0].unitPrice, 1250000);
});

test('an ISO datetime is rejected, because it breaks validity-window comparison', () => {
  // '2026-09-16T00:00:00+07:00' sorts after '2026-09-16', which would flip
  // same-day expiry when compared against an agreement's validTo.
  const { report } = run([line({ poDate: '2026-09-16T00:00:00+07:00' })]);
  assert.equal(report.totals.rejected, 1);
  assert.match(report.rejects[0].problems[0].reason, /YYYY-MM-DD/);
});

test('identifiers keep their leading zeros', () => {
  const withZeros = { ...masters, formulary: [{ ...masters.formulary[0], sku: '0012345' }],
    tradeAgreements: [{ ...masters.tradeAgreements[0], sku: '0012345' }] };
  const { rows } = validateExtract(
    { weekId: 'W', poLines: [line({ sku: '0012345' })], rebateLedger: [], usageLines: [], priceHistory: [], requestLog: [] },
    withZeros
  );
  assert.equal(rows.poLines[0].sku, '0012345');
  assert.equal(typeof rows.poLines[0].sku, 'string');
});

test('a missing required field drops the row and says which field', () => {
  const { rows, report } = run([line({ qty: '' })]);
  assert.equal(rows.poLines.length, 0);
  assert.equal(report.rejects[0].problems[0].field, 'qty');
});

test('an unmatched vendor or SKU is reported rather than passed through', () => {
  const { report } = run([
    line({ lineId: 'L-BADVENDOR', vendorId: 'V-KAIROSS-9931' }),
    line({ lineId: 'L-BADSKU', sku: 'SKU-9999' })
  ]);
  assert.equal(report.joinCounts.unknownVendor, 1);
  assert.equal(report.joinCounts.unknownSku, 1);
  assert.equal(report.joinCounts.noAgreement, 2);
  assert.equal(report.ok, false, 'unmatched codes must not read as a clean extract');
});

test('duplicate line ids are dropped once and counted', () => {
  const { rows, report } = run([line(), line()]);
  assert.equal(rows.poLines.length, 1);
  assert.equal(report.totals.duplicates, 1);
});

test('non-positive quantities and prices are flagged as out of range', () => {
  const { report } = run([line({ lineId: 'L-2', qty: '0' }), line({ lineId: 'L-3', unitPrice: '0' })]);
  const fields = report.outOfRange.map((x) => x.field);
  assert.ok(fields.includes('qty'));
  assert.ok(fields.includes('unitPrice'));
});

test('unparseable numbers are refused rather than guessed at', () => {
  assert.equal(parseAmount('abc').ok, false);
  assert.equal(parseAmount('').ok, false);
  assert.equal(parseAmount('1,250,000').value, 1250000);
});
