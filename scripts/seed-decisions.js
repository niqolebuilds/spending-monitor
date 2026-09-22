#!/usr/bin/env node
// Puts the workbench into a part-worked state so the funnel and closure
// tracking have something to show. Deterministic; safe to re-run.
// Usage: node scripts/seed-decisions.js [--reset]
import { loadMasters, loadExtract, loadSettings, AS_OF } from '../src/load.js';
import { runEngine } from '../src/engine.js';
import * as store from '../src/store.js';

if (process.argv.includes('--reset')) {
  store.reset();
  console.log('cleared all decisions');
  process.exit(0);
}

store.reset();
const run = await runEngine({
  masters: loadMasters(),
  extract: loadExtract(),
  settings: loadSettings(),
  asOf: AS_OF
});

const recoverable = run.exceptions.filter((e) => e.savingsRaw > 0);
const noise = run.exceptions.filter((e) => e.type === 'uom');

// An analyst has worked the top of the queue but not all of it.
const confirmed = recoverable.slice(0, Math.ceil(recoverable.length * 0.55));
const dismissed = noise.slice(0, Math.ceil(noise.length * 0.6));

const periodId = run.periodId;
store.applyDecisions(periodId, confirmed.map((e) => e.ref), 'approved', 'Nicole Celia Wangga');
store.applyDecisions(periodId, dismissed.map((e) => e.ref), 'false_positive', 'Nicole Celia Wangga');

// Units have replied to roughly two-thirds of what was dispatched.
const replied = confirmed.filter((_, i) => i % 3 !== 2);
for (const e of replied) {
  store.applyResponse(periodId, e.ref, 'PO revised in D365', 'Revised against current agreement', `${e.unit} Purchasing`);
}

// Finance has verified a portion of those, at slightly under the flagged figure.
const closed = replied.filter((_, i) => i % 2 === 0);
let banked = 0;
for (const e of closed) {
  const achieved = Math.round(e.savingsRaw * 0.86);
  store.markClosed(periodId, e.ref, achieved, 'Nicole Celia Wangga', 'Verified against revised PO');
  banked += achieved;
}

console.log(`confirmed ${confirmed.length} · dismissed ${dismissed.length} · replied ${replied.length} · closed ${closed.length}`);
console.log(`validated savings seeded: Rp ${(banked / 1e6).toFixed(1)}M`);
