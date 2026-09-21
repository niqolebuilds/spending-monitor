// This is what keeps rule #11 honest: every rule in the directory is loaded and
// held to the same contract, so a new process file cannot quietly skip a field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRules, ruleFiles, REQUIRED_RULE_KEYS, REQUIRED_HIT_KEYS } from '../src/rules/registry.js';
import { buildIndexes } from '../src/normalize.js';
import { peerStats, priceTrend } from '../src/benchmark.js';
import { loadMasters, loadExtract, loadSettings, AS_OF } from '../src/load.js';

const rules = await loadRules();
const masters = loadMasters();
const extract = loadExtract();
const ctx = {
  idx: buildIndexes(masters, extract),
  masters,
  settings: loadSettings(),
  asOf: AS_OF,
  benchmark: { peerStats, priceTrend }
};

test('every rule file in the directory is registered', () => {
  assert.equal(rules.length, ruleFiles().length);
  assert.ok(rules.length >= 7, `expected the full rule set, got ${rules.length}`);
});

test('every rule declares the full contract', () => {
  for (const rule of rules) {
    for (const key of REQUIRED_RULE_KEYS) {
      assert.notEqual(rule[key], undefined, `${rule.id} is missing ${key}`);
    }
    assert.equal(typeof rule.applies, 'function', `${rule.id}.applies`);
    assert.equal(typeof rule.evaluate, 'function', `${rule.id}.evaluate`);
    assert.equal(typeof rule.identity, 'function', `${rule.id}.identity`);
    assert.equal(typeof rule.priority, 'number', `${rule.id}.priority`);
  }
});

test('rule ids, types and priorities are unique', () => {
  const ids = rules.map((r) => r.id);
  const priorities = rules.map((r) => r.priority);
  assert.equal(new Set(ids).size, ids.length, 'duplicate rule id');
  assert.equal(new Set(priorities).size, priorities.length, 'duplicate priority makes precedence ambiguous');
});

test('every rule reads a dataset the extract actually provides', () => {
  for (const rule of rules) {
    assert.ok(Array.isArray(extract[rule.dataset]), `${rule.id} reads missing dataset ${rule.dataset}`);
  }
});

test('evaluate returns either null or a complete hit, and identity is well formed', () => {
  for (const rule of rules) {
    let evaluated = 0;
    for (const row of extract[rule.dataset]) {
      if (!rule.applies(row, ctx)) continue;
      const hit = rule.evaluate(row, ctx);
      if (hit === null) continue;
      evaluated++;

      for (const key of REQUIRED_HIT_KEYS) {
        assert.notEqual(hit[key], undefined, `${rule.id} hit is missing ${key}`);
      }
      assert.ok(Number.isFinite(hit.amountRaw) && hit.amountRaw >= 0, `${rule.id} amountRaw`);
      assert.ok(Number.isFinite(hit.savingsRaw) && hit.savingsRaw >= 0, `${rule.id} savingsRaw`);
      assert.equal(hit.savingsRaw, Math.round(hit.savingsRaw), `${rule.id} produced fractional rupiah`);
      for (const field of ['finding', 'trendNote', 'rootCause', 'suggestedAction']) {
        assert.ok(hit[field].length > 0, `${rule.id}.${field} is empty`);
        assert.ok(!hit[field].includes('undefined'), `${rule.id}.${field} leaked "undefined"`);
        assert.ok(!hit[field].includes('NaN'), `${rule.id}.${field} leaked "NaN"`);
      }

      const identity = rule.identity(row, ctx);
      for (const field of ['ref', 'unit', 'region', 'item', 'vendor', 'poNumber']) {
        assert.ok(identity[field], `${rule.id} identity.${field} is empty`);
      }
      // Refs must namespace by row, not by rule, or dedupe cannot work.
      assert.ok(identity.ref.includes('|'), `${rule.id} ref is not namespaced`);
      assert.ok(!identity.ref.includes(rule.id), `${rule.id} ref must identify the row, not the rule`);
    }
    assert.ok(evaluated > 0, `${rule.id} never fired against the seeded extract`);
  }
});
