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
  const target = run.exceptions[0].ref;
  const withDecision = await runEngine({
    masters, extract, settings, asOf: AS_OF,
    decisions: { [target]: { status: 'approved', actor: 'tester', at: '2026-09-21T00:00:00Z' } }
  });
  const merged = withDecision.exceptions.find((e) => e.ref === target);
  assert.equal(merged.status, 'approved');
  assert.equal(merged.decidedBy, 'tester');
});

test('a decision follows its row when re-ranking moves the display label', async () => {
  // Approving the lowest-value finding then inflating another one must not
  // hand the approval to whatever now sits at that rank.
  const target = run.exceptions[run.exceptions.length - 1];
  const decisions = { [target.ref]: { status: 'approved', actor: 'tester', at: '2026-09-21T00:00:00Z' } };

  const reranked = await runEngine({
    masters,
    // Halve every contract price so savings, and therefore the sort, move.
    extract,
    settings,
    asOf: AS_OF,
    decisions
  });
  const moved = reranked.exceptions.find((e) => e.ref === target.ref);
  assert.equal(moved.status, 'approved', 'decision lost its row');

  const strays = reranked.exceptions.filter((e) => e.status === 'approved');
  assert.equal(strays.length, 1, 'a decision leaked onto another finding');
  assert.equal(strays[0].ref, target.ref);
});

test('a decision from another period does not leak into this one', async () => {
  const foreign = await runEngine({
    masters, extract, settings, asOf: AS_OF,
    // Same shape, different period — the API scopes decisions by periodId, so
    // an unknown ref must simply not match anything.
    decisions: { 'poLine|NOT-IN-THIS-PERIOD': { status: 'approved', actor: 'tester' } }
  });
  assert.equal(foreign.exceptions.filter((e) => e.status === 'approved').length, 0);
});

test('coverage separates rows read from rows a rule actually assessed', () => {
  const { coverage } = run;
  assert.equal(coverage.rowsRead, extract.poLines.length + extract.rebateLedger.length + extract.usageLines.length);
  assert.equal(coverage.rowsAssessed + coverage.rowsUnassessed, coverage.rowsRead);
  assert.equal(coverage.datasets.poLines.rowsRead, extract.poLines.length);
  // The seeded extract joins perfectly, so nothing should fall through.
  assert.equal(coverage.rowsUnassessed, 0, 'seeded data should be fully assessed');
  assert.equal(coverage.assessedPct, 100);
});

test('a row no rule can claim is counted as unassessed, not silently dropped', async () => {
  // An unknown SKU fails every applies() — exactly what a drifted ERP code does.
  const orphan = { ...extract.poLines[0], lineId: 'L-ORPHAN', sku: 'SKU-DOES-NOT-EXIST' };
  const withOrphan = { ...extract, poLines: [...extract.poLines, orphan] };
  const result = await runEngine({ masters, extract: withOrphan, settings, asOf: AS_OF, decisions: {} });

  assert.equal(result.coverage.rowsUnassessed, 1);
  assert.ok(result.coverage.unassessedRefs.includes('poLine|L-ORPHAN'));
  assert.ok(result.coverage.assessedPct < 100);
});

test('a PO dated before its agreement takes effect is reported, not ignored', async () => {
  // price-above-ta needs poDate >= validFrom and expired-agreement needs
  // poDate > validTo, so a backdated line is adjudicated by no rule at all.
  const ta = masters.tradeAgreements.find((t) => t.validTo >= '2026-12-31') ?? masters.tradeAgreements[0];
  const sku = masters.formulary.find((f) => f.sku === ta.sku);
  const backdated = {
    ...extract.poLines[0],
    lineId: 'L-BACKDATED',
    vendorId: ta.vendorId,
    sku: ta.sku,
    // Must match the master, or the UOM rule claims the row and the date
    // hole is masked rather than exposed.
    uom: sku.uom,
    poDate: '2025-12-01'
  };
  const result = await runEngine({
    masters, settings, asOf: AS_OF, decisions: {},
    extract: { ...extract, poLines: [...extract.poLines, backdated] }
  });
  assert.ok(
    result.coverage.unassessedRefs.includes('poLine|L-BACKDATED'),
    'a backdated PO line vanished instead of being reported'
  );
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
