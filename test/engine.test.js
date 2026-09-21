import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEngine, gate } from '../src/engine.js';
import { loadMasters, loadExtract, loadSettings, AS_OF } from '../src/load.js';

const masters = loadMasters();
const extract = loadExtract();
const settings = loadSettings();
// Decisions are passed explicitly so the suite never depends on saved state.
const run = await runEngine({ masters, extract, settings, asOf: AS_OF, decisions: {} });

test('the run covers the whole extract and every rule', () => {
  assert.equal(run.linesScanned, extract.poLines.length);
  assert.ok(run.rulesApplied.length >= 7);
  assert.ok(run.exceptions.length > 0);
});

test('exception ids are sequential, unique and stable across runs', async () => {
  const ids = run.exceptions.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], 'EXP-01');

  const second = await runEngine({ masters, extract, settings, asOf: AS_OF, decisions: {} });
  assert.deepEqual(second.exceptions.map((e) => e.id), ids, 'ids must not move between runs');
  assert.deepEqual(second.exceptions.map((e) => e.ref), run.exceptions.map((e) => e.ref));
});

test('findings are ordered by recoverable value', () => {
  for (let i = 1; i < run.exceptions.length; i++) {
    assert.ok(
      run.exceptions[i - 1].savingsRaw >= run.exceptions[i].savingsRaw,
      `out of order at ${run.exceptions[i].id}`
    );
  }
});

test('one source row produces at most one finding', () => {
  const refs = run.exceptions.map((e) => e.ref);
  assert.equal(new Set(refs).size, refs.length, 'a row was counted by two rules');
});

test('a row is owned by the highest-precedence rule that matches it', () => {
  // A mis-keyed UOM line also looks overpriced; uom-mismatch outranks price-above-ta.
  const uom = run.exceptions.filter((e) => e.ruleId === 'uom-mismatch');
  assert.ok(uom.length > 0);
  for (const e of uom) {
    assert.equal(e.savingsRaw, 0, 'a keying error must not book recoverable savings');
  }
});

test('every exception carries both display and raw values', () => {
  for (const e of run.exceptions) {
    assert.equal(typeof e.amount, 'string');
    assert.equal(typeof e.amountRaw, 'number');
    assert.equal(typeof e.savings, 'string');
    assert.equal(typeof e.savingsRaw, 'number');
    assert.ok(e.exposureRaw >= 0);
    assert.equal(e.status, 'pending');
    assert.ok(e.badgeClass.startsWith('badge-'), 'renderer reads badgeClass directly');
  }
});

test('persisted decisions are merged onto the matching finding', async () => {
  const target = run.exceptions[0].id;
  const withDecision = await runEngine({
    masters, extract, settings, asOf: AS_OF,
    decisions: { [target]: { status: 'approved', actor: 'tester', at: '2026-09-21T00:00:00Z' } }
  });
  const merged = withDecision.exceptions.find((e) => e.id === target);
  assert.equal(merged.status, 'approved');
  assert.equal(merged.decidedBy, 'tester');
});

test('under L2 every finding is routed to a human, whatever it is worth', () => {
  for (const e of run.exceptions) assert.equal(e.lane, 'review');
  assert.equal(gate(1, { autoEligible: true }, { mode: 'L2', thresholdIDR: 25000000 }), 'review');
});

test('the L3 gate holds anything at or above the threshold', () => {
  const l3 = { mode: 'L3', thresholdIDR: 25000000 };
  const eligible = { autoEligible: true };
  assert.equal(gate(24999999, eligible, l3), 'auto');
  assert.equal(gate(25000000, eligible, l3), 'review', 'boundary must be held for review');
  assert.equal(gate(1, { autoEligible: false }, l3), 'review');
});
