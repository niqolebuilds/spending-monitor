// The ingest gate: pull from the configured source, validate, hold the result
// in staging, and require a person to accept it before any rule runs.
//
// Staged extracts are immutable and addressed by checksum, and acceptances are
// appended rather than overwritten, so "what exactly did we scan when this
// finding was approved" has an answer.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './load.js';
import { validateExtract } from './sources/contract.js';

const INGEST_DIR = path.join(ROOT, 'data', 'ingest');
const STATE_FILE = path.join(ROOT, 'data', 'state', 'ingest.json');

// Masters are hashed alongside the extract: findings depend on both, and the
// masters are edited freely.
export function checksumOf(masters, extract) {
  return createHash('sha256')
    .update(JSON.stringify({ masters, extract }))
    .digest('hex')
    .slice(0, 16);
}

// Derived from the data, never the clock: it drives SLA due dates, so reopening
// a period later must not re-age every request.
function asOfFor(extract) {
  const dates = (extract.poLines ?? []).map((line) => line.poDate).filter(Boolean).sort();
  const latest = dates[dates.length - 1];
  if (!latest) return null;
  const next = new Date(`${latest}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function readState() {
  if (!existsSync(STATE_FILE)) return { events: [] };
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return Array.isArray(parsed.events) ? parsed : { events: [] };
  } catch {
    return { events: [] };
  }
}

function appendEvent(event) {
  const state = readState();
  state.events.push({ ...event, at: new Date().toISOString() });
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  return event;
}

const stagePath = (periodId, checksum) => path.join(INGEST_DIR, periodId, checksum);

export async function stage(source, periodId, { actor = 'HO Finance' } = {}) {
  const masters = await source.loadMasters();
  const raw = await source.loadExtract(periodId);
  const { rows, report } = validateExtract(raw, masters);

  const checksum = checksumOf(masters, rows);
  const asOf = asOfFor(rows);
  const dir = stagePath(periodId, checksum);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'masters.json'), JSON.stringify(masters));
  writeFileSync(path.join(dir, 'extract.json'), JSON.stringify(rows));
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ ...report, periodId, checksum, asOf }, null, 2));

  appendEvent({ type: 'staged', periodId, checksum, sourceId: source.id, actor, ok: report.ok });
  return { periodId, checksum, sourceId: source.id, asOf, report };
}

function sourceOfStaged(periodId, checksum) {
  const { events } = readState();
  const staged = events.find((e) => e.type === 'staged' && e.periodId === periodId && e.checksum === checksum);
  return staged?.sourceId ?? null;
}

export function accept(periodId, checksum, actor = 'HO Finance', note = '') {
  if (!existsSync(stagePath(periodId, checksum))) return null;
  // The source is copied onto the acceptance so a later run configured against
  // a different source cannot adopt it.
  const sourceId = sourceOfStaged(periodId, checksum);
  return appendEvent({ type: 'accepted', periodId, checksum, sourceId, actor, note });
}

export function reject(periodId, checksum, actor = 'HO Finance', note = '') {
  if (!existsSync(stagePath(periodId, checksum))) return null;
  return appendEvent({ type: 'rejected', periodId, checksum, actor, note });
}

// The most recent acceptance for this source that has not since been rejected.
// Scoping by source matters: an acceptance made while pointed at the sample
// data must never be served once the app is configured against a real ERP feed.
export function activeIngest(sourceId) {
  const { events } = readState();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== 'accepted') continue;
    if (sourceId && event.sourceId !== sourceId) continue;
    const laterRejection = events
      .slice(i + 1)
      .some((e) => e.type === 'rejected' && e.periodId === event.periodId && e.checksum === event.checksum);
    if (!laterRejection && existsSync(stagePath(event.periodId, event.checksum))) return event;
  }
  return null;
}

export function latestStaged(sourceId, periodId) {
  const { events } = readState();
  const staged = events.filter((e) => e.type === 'staged'
    && (!sourceId || e.sourceId === sourceId)
    && (!periodId || e.periodId === periodId));
  return staged[staged.length - 1] ?? null;
}

export function readStaged(periodId, checksum) {
  const dir = stagePath(periodId, checksum);
  if (!existsSync(dir)) return null;
  return {
    masters: JSON.parse(readFileSync(path.join(dir, 'masters.json'), 'utf8')),
    extract: JSON.parse(readFileSync(path.join(dir, 'extract.json'), 'utf8')),
    report: JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'))
  };
}

export function history(limit = 40) {
  return readState().events.slice(-limit).reverse();
}

export function reset() {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ events: [] }, null, 2) + '\n');
}
