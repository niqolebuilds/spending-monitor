// Boundary behaviour of the reference rule, against a hand-built fixture so the
// thresholds are exact rather than whatever the generator happened to produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import rule from '../src/rules/price-above-ta.rule.js';
import { buildIndexes } from '../src/normalize.js';
import { peerStats, priceTrend } from '../src/benchmark.js';

const SKU = {
  sku: 'SKU-1001', name: 'Test Stent', category: 'Cardiology Devices', vendorId: 'V-KEN',
  uom: 'pcs', formularyStatus: 'formulary', bpjsCovered: true, locked: false,
  equivalentSku: null, referencePrice: 16810000
};
const TA = {
  agreementNo: 'TA-2026-0001', vendorId: 'V-KEN', sku: 'SKU-1001',
  contractPrice: 16810000, toleranceIDR: 84050, validFrom: '2026-01-01', validTo: '2026-12-31'
};

function fixture(line, overrides = {}) {
  const masters = {
    units: [{ id: 'U21', name: 'Unit 21 · Jakarta', region: 'Jakarta' }],
    formulary: [SKU],
    tradeAgreements: [{ ...TA, ...overrides }],
    principals: [{ vendorId: 'V-KEN', name: 'PT Kenari Distribusi', category: 'Cardiology Devices' }]
  };
  const extract = {
    poLines: [line],
    priceHistory: [{ unit: 'U21', sku: 'SKU-1001', weeks: 12, prices: Array(12).fill(TA.contractPrice) }],
    usageLines: [],
    rebateLedger: []
  };
  return {
    idx: buildIndexes(masters, extract),
    masters,
    settings: { mode: 'L2', thresholdIDR: 25000000, slaDays: 5 },
    asOf: '2026-09-21',
    benchmark: { peerStats, priceTrend }
  };
}

const line = (unitPrice, extra = {}) => ({
  lineId: 'L-00001', poNumber: 'PO-U21-2609-000001', poLine: 2, unit: 'U21',
  vendorId: 'V-KEN', sku: 'SKU-1001', qty: 10, uom: 'pcs', unitPrice, poDate: '2026-09-16', ...extra
});

test('a line exactly at the tolerance ceiling is not flagged', () => {
  const row = line(TA.contractPrice + TA.toleranceIDR);
  const ctx = fixture(row);
  assert.ok(rule.applies(row, ctx));
  assert.equal(rule.evaluate(row, ctx), null);
});

test('one rupiah above the tolerance ceiling is flagged', () => {
  const row = line(TA.contractPrice + TA.toleranceIDR + 1);
  const ctx = fixture(row);
  const hit = rule.evaluate(row, ctx);
  assert.ok(hit);
  assert.equal(hit.savingsRaw, (TA.toleranceIDR + 1) * row.qty);
});

test('savings are the excess times quantity, in whole rupiah', () => {
  const row = line(20890000);
  const hit = rule.evaluate(row, fixture(row));
  assert.equal(hit.savingsRaw, (20890000 - 16810000) * 10);
  assert.equal(hit.amountRaw, 20890000 * 10);
  assert.equal(hit.metrics.variancePct, 24.3);
  assert.match(hit.finding, /Rp 20,890,000 vs trade agreement Rp 16,810,000 \(\+24\.3%\) × 10 pcs/);
});

test('the validity window is inclusive at both ends', () => {
  const onLastDay = line(20890000, { poDate: '2026-12-31' });
  assert.ok(rule.applies(onLastDay, fixture(onLastDay)), 'validTo should be inclusive');

  const onFirstDay = line(20890000, { poDate: '2026-01-01' });
  assert.ok(rule.applies(onFirstDay, fixture(onFirstDay)), 'validFrom should be inclusive');
});

test('a lapsed agreement is left to the expired-agreement rule', () => {
  const row = line(20890000, { poDate: '2026-09-16' });
  const ctx = fixture(row, { validTo: '2026-08-31' });
  assert.equal(rule.applies(row, ctx), false);
});

test('a UOM mismatch is left to the uom rule', () => {
  const row = line(20890000, { uom: 'box' });
  assert.equal(rule.applies(row, fixture(row)), false);
});

test('evidence bars express the agreed price as a share of what was paid', () => {
  const row = line(20890000);
  const hit = rule.evaluate(row, fixture(row));
  assert.equal(hit.evidenceBars.actualPct, 100);
  assert.equal(hit.evidenceBars.targetPct, Math.round((16810000 / 20890000) * 100));
  assert.ok(hit.evidenceBars.targetPct < 100);
});
