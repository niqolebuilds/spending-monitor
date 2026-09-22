// Analyst decisions and closure tracking. Survives restarts so "approve" means
// something — the L2 human gate is recorded, not just rendered.
//
// Decisions are keyed by period and by the row's content-derived ref, never by
// the positional EXP-NN label: re-ranking a run, correcting a master price, or
// scanning a new week must never move a recorded decision onto a different row.
//
//   { "2026-W38": { "poLine|L-00341": { status, actor, at, ... } } }
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './load.js';
import { isRef } from './refs.js';

const STATE_DIR = path.join(ROOT, 'data', 'state');
const STATE_FILE = path.join(STATE_DIR, 'decisions.json');

function readFile() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Pre-migration files were a flat map keyed by EXP-NN with no period scope.
// Those keys cannot be resolved back to a row, so they are dropped rather than
// silently reattached to whatever now sits at that rank.
function isLegacy(data) {
  const keys = Object.keys(data);
  return keys.length > 0 && keys.every((key) => /^EXP-\d+$/.test(key));
}

export function load() {
  const data = readFile();
  return isLegacy(data) ? {} : data;
}

export function decisionsFor(periodId) {
  return load()[periodId] ?? {};
}

function persist(all) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(all, null, 2) + '\n');
  return all;
}

function mutate(periodId, ref, change) {
  if (!isRef(ref)) return null;
  const all = load();
  const period = all[periodId] ?? {};
  const existing = period[ref];
  const next = change(existing);
  if (next === null) return null;
  all[periodId] = { ...period, [ref]: next };
  persist(all);
  return next;
}

export function applyDecision(periodId, ref, status, actor, at = new Date().toISOString()) {
  return mutate(periodId, ref, (existing) => ({ ...existing, status, actor, at }));
}

export function applyDecisions(periodId, refs, status, actor) {
  const at = new Date().toISOString();
  const all = load();
  const period = { ...(all[periodId] ?? {}) };
  let updated = 0;
  for (const ref of refs) {
    if (!isRef(ref)) continue;
    period[ref] = { ...period[ref], status, actor, at };
    updated++;
  }
  all[periodId] = period;
  persist(all);
  return updated;
}

// The unit's reply to a dispatched request. This is what closure tracking reads.
export function applyResponse(periodId, ref, action, note, actor) {
  return mutate(periodId, ref, (existing) => {
    if (!existing || existing.status !== 'approved') return null;
    return { ...existing, response: { action, note, actor, at: new Date().toISOString() } };
  });
}

// The human gate that stays: achieved savings are validated by a person,
// never inferred from the scan.
export function markClosed(periodId, ref, achievedSavingsRaw, actor, note = '') {
  return mutate(periodId, ref, (existing) => {
    if (!existing || existing.status !== 'approved') return null;
    return {
      ...existing,
      closedAt: new Date().toISOString(),
      achievedSavingsRaw,
      closedBy: actor,
      note
    };
  });
}

export function reset() {
  return persist({});
}
