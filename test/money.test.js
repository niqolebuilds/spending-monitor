import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatIDR, formatIDRFull, pct } from '../src/money.js';

test('formatIDR switches scale at the right boundaries', () => {
  assert.equal(formatIDR(0), 'Rp 0');
  assert.equal(formatIDR(850000), 'Rp 850,000');
  assert.equal(formatIDR(999999), 'Rp 999,999');
  assert.equal(formatIDR(1000000), 'Rp 1.0M');
  assert.equal(formatIDR(40800000), 'Rp 40.8M');
  assert.equal(formatIDR(1000000000), 'Rp 1.00B');
  assert.equal(formatIDR(1600000000), 'Rp 1.60B');
});

test('formatIDR promotes to billions rather than printing 1000.0M', () => {
  assert.equal(formatIDR(999999999), 'Rp 1.00B');
  assert.equal(formatIDR(999000000), 'Rp 999.0M');
});

test('formatIDR handles negatives', () => {
  assert.equal(formatIDR(-40800000), '-Rp 40.8M');
  assert.equal(formatIDRFull(-20890000), '-Rp 20,890,000');
});

test('formatIDRFull prints whole rupiah with separators', () => {
  assert.equal(formatIDRFull(20890000), 'Rp 20,890,000');
  assert.equal(formatIDRFull(16810000), 'Rp 16,810,000');
  assert.ok(!formatIDRFull(1234.56).includes('.'), 'no fractional rupiah');
});

test('pct rounds to one decimal by default', () => {
  assert.equal(pct(4080000, 16810000), 24.3);
  assert.equal(pct(1, 4), 25);
  assert.equal(pct(0, 100), 0);
});

test('pct returns 0 rather than Infinity when the base is zero', () => {
  assert.equal(pct(5, 0), 0);
});
