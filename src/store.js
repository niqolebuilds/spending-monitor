// Analyst decisions and closure tracking. Survives restarts so "approve" means
// something — the L2 human gate is recorded, not just rendered.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './load.js';

const STATE_DIR = path.join(ROOT, 'data', 'state');
const STATE_FILE = path.join(STATE_DIR, 'decisions.json');

export function load() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function persist(decisions) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(decisions, null, 2) + '\n');
  return decisions;
}

export function applyDecision(id, status, actor, at = new Date().toISOString()) {
  const decisions = load();
  decisions[id] = { ...decisions[id], status, actor, at };
  return persist(decisions)[id];
}

export function applyDecisions(ids, status, actor) {
  const at = new Date().toISOString();
  const decisions = load();
  for (const id of ids) decisions[id] = { ...decisions[id], status, actor, at };
  persist(decisions);
  return ids.length;
}

// The unit's reply to a dispatched request. This is what closure tracking reads.
export function applyResponse(id, action, note, actor) {
  const decisions = load();
  const existing = decisions[id];
  if (!existing || existing.status !== 'approved') return null;
  decisions[id] = {
    ...existing,
    response: { action, note, actor, at: new Date().toISOString() }
  };
  return persist(decisions)[id];
}

// The human gate that stays: achieved savings are validated by a person,
// never inferred from the scan.
export function markClosed(id, achievedSavingsRaw, actor, note = '') {
  const decisions = load();
  const existing = decisions[id];
  if (!existing || existing.status !== 'approved') return null;
  decisions[id] = {
    ...existing,
    closedAt: new Date().toISOString(),
    achievedSavingsRaw,
    closedBy: actor,
    note
  };
  return persist(decisions)[id];
}

export function reset() {
  return persist({});
}
