// The invariants that make the pages unable to contradict each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEngine } from '../src/engine.js';
import { buildKpis, buildLeaderboard, buildRebateSummary } from '../src/aggregate.js';
import { loadMasters, loadExtract, loadSettings, AS_OF } from '../src/load.js';

const masters = loadMasters();
const extract = loadExtract();
const settings = loadSettings();

const run = await runEngine({ masters, extract, settings, asOf: AS_OF, decisions: {} });
const kpis = buildKpis(run, masters, extract);
const leaderboard = buildLeaderboard(run, masters, extract);
const rebates = buildRebateSummary(run, masters, extract);

test('counts agree with the findings they describe', () => {
  assert.equal(kpis.pendingCount, run.exceptions.filter((e) => e.status === 'pending').length);
  assert.equal(kpis.exceptionCount, run.exceptions.filter((e) => e.status !== 'false_positive').length);
  assert.equal(kpis.linesScanned, extract.poLines.length);
  assert.equal(kpis.unitCount, masters.units.length);
});

test('potential savings is the sum of what the findings claim', () => {
  const expected = run.exceptions
    .filter((e) => e.status !== 'false_positive')
    .reduce((total, e) => total + e.savingsRaw, 0);
  assert.equal(kpis.potentialSavingsRaw, expected);
});

test('the funnel never widens and starts at 100%', () => {
  assert.equal(kpis.funnel[0].pct, 100);
  for (let i = 1; i < kpis.funnel.length; i++) {
    assert.ok(kpis.funnel[i].pct <= kpis.funnel[i - 1].pct, 'a later funnel step exceeded an earlier one');
    assert.ok(kpis.funnel[i].amountRaw <= kpis.funnel[i - 1].amountRaw);
  }
});

test('leakage percentages total 100 within rounding', () => {
  const total = kpis.leakage.reduce((sum, row) => sum + row.pct, 0);
  assert.ok(Math.abs(total - 100) <= 1, `leakage percentages summed to ${total}`);
});

test('leakage rupiah reconcile with the percentages that label them', () => {
  const totalExposure = kpis.leakage.reduce((sum, row) => sum + row.exposureRaw, 0);
  for (const row of kpis.leakage) {
    assert.equal(row.pct, Math.round((row.exposureRaw / totalExposure) * 100));
  }
});

test('categories with nothing at risk are left out of the breakdown', () => {
  for (const row of kpis.leakage) assert.ok(row.exposureRaw > 0);
  // A UOM keying error inflates its own line total, so it must not appear.
  assert.ok(!kpis.leakage.some((row) => row.category === 'UOM Keying Errors'));
});

test('validated savings stay at zero until a person closes something', () => {
  assert.equal(kpis.validatedSavingsRaw, 0);
  assert.equal(kpis.closedCount, 0);
});

test('every unit is ranked exactly once, best first', () => {
  assert.equal(leaderboard.length, masters.units.length);
  assert.deepEqual(leaderboard.map((u) => u.rank), masters.units.map((_, i) => i + 1));
  for (let i = 1; i < leaderboard.length; i++) {
    assert.ok(leaderboard[i - 1].compliancePct >= leaderboard[i].compliancePct);
  }
});

test('unit compliance is bounded and its bar colour follows it', () => {
  for (const u of leaderboard) {
    assert.ok(u.compliancePct >= 0 && u.compliancePct <= 100, `${u.unit} at ${u.compliancePct}%`);
    const expected = u.compliancePct >= 95 ? 'emerald' : u.compliancePct >= 90 ? 'blue' : 'rose';
    assert.equal(u.barClass, expected);
  }
});

test('rebate tier counts are derived from the rows they sit above', () => {
  assert.equal(rebates.counts.total, rebates.principals.length);
  assert.equal(rebates.counts.total, masters.principals.length);
  assert.equal(
    rebates.counts.top + rebates.counts.reach + rebates.counts.risk,
    rebates.counts.total,
    'tier counts must partition the principal list'
  );
});

test('only principals short of a tier carry a gap', () => {
  for (const p of rebates.principals) {
    if (p.category === 'top') assert.equal(p.gap, '—');
    else assert.ok(p.gapRaw > 0, `${p.name} is below tier but has no gap`);
  }
});
