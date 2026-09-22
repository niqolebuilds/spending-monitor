import express from 'express';
import { loadSettings } from './load.js';
import { loadConfig } from './config.js';
import { resolveSource, SOURCE_IDS } from './sources/index.js';
import { runEngine } from './engine.js';
import { buildKpis, buildLeaderboard, buildRebateSummary } from './aggregate.js';
import { draftRevision } from './requests.js';
import * as store from './store.js';
import * as ingest from './ingest.js';
import { isRef } from './refs.js';

const DECISIONS = new Set(['approved', 'false_positive']);

const config = loadConfig();
const source = resolveSource(config);

// Keyed by the accepted period and checksum, so accepting a different extract
// cannot be served from a stale slot.
let cached = null;

class NoAcceptedData extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
  }
}

// Synthetic demo data announces itself on every page, so an explicitly
// configured fixture source may stage and accept itself. A real source never
// does: with nothing accepted the app says so rather than scanning an extract
// no one has reviewed.
async function ensureAccepted() {
  const active = ingest.activeIngest(source.id);
  if (active) return active;

  if (!source.synthetic) {
    throw new NoAcceptedData(
      `No ingested data has been accepted for source "${source.id}". Stage an extract on the Data Review page first.`
    );
  }

  const periods = await source.listPeriods();
  const periodId = config.periodId ?? periods[periods.length - 1];
  if (!periodId) throw new NoAcceptedData(`Source "${source.id}" offers no periods to scan.`);
  const staged = await ingest.stage(source, periodId, { actor: 'system' });
  return ingest.accept(staged.periodId, staged.checksum, 'system', 'sample data accepted automatically');
}

async function state() {
  const active = await ensureAccepted();
  if (cached && cached.key === `${active.periodId}|${active.checksum}`) return cached;

  const staged = ingest.readStaged(active.periodId, active.checksum);
  const settings = loadSettings();
  const run = await runEngine({
    masters: staged.masters,
    extract: staged.extract,
    settings,
    asOf: staged.report.asOf,
    decisions: store.decisionsFor(active.periodId)
  });

  cached = {
    key: `${active.periodId}|${active.checksum}`,
    masters: staged.masters,
    extract: staged.extract,
    report: staged.report,
    settings,
    run,
    provenance: {
      sourceId: source.id,
      sourceLabel: source.describe(),
      synthetic: source.synthetic,
      periodId: active.periodId,
      checksum: active.checksum,
      acceptedAt: active.at,
      acceptedBy: active.actor
    }
  };
  return cached;
}

// Express 4 does not catch async throws, so every handler is wrapped. Any of
// them may hit the 409 raised when nothing has been accepted yet.
const guard = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (res.headersSent) return;
    if (error.status === 409) return res.status(409).json({ error: error.message, needsIngest: true });
    res.status(500).json({ error: error.message });
  }
};

// Findings are addressed by their content-derived ref, not the positional
// EXP-NN label, so a decision cannot land on the wrong row after a re-rank.
function resolveRef(run, ref) {
  if (!isRef(ref)) return { error: 'invalid finding reference' };
  const exception = run.exceptions.find((e) => e.ref === ref);
  return exception ? { exception } : { error: 'finding not found' };
}

const invalidate = () => { cached = null; };

const requestCtx = (settings, run) => ({ asOf: run.asOf, slaDays: settings.slaDays, weekId: run.weekId });

export function createApiRouter() {
  const router = express.Router();
  const get = (route, handler) => router.get(route, guard(handler));
  const post = (route, handler) => router.post(route, guard(handler));

  get('/run/latest', async (req, res) => {
    const { run, masters, extract } = await state();
    res.json({ ...run, kpis: buildKpis(run, masters, extract) });
  });

  post('/run', async (req, res) => {
    invalidate();
    const { run, masters, extract } = await state();
    res.json({ ...run, kpis: buildKpis(run, masters, extract) });
  });

  get('/kpis', async (req, res) => {
    const { run, masters, extract } = await state();
    res.json(buildKpis(run, masters, extract));
  });

  get('/settings', async (req, res) => {
    const { settings } = await state();
    res.json(settings);
  });

  get('/exceptions', async (req, res) => {
    const { run } = await state();
    const { type, status, unit, q } = req.query;
    const needle = typeof q === 'string' ? q.trim().toLowerCase() : '';

    const items = run.exceptions.filter((e) => {
      if (type && type !== 'all' && e.type !== type) return false;
      if (status && e.status !== status) return false;
      if (unit && e.unit !== unit) return false;
      if (!needle) return true;
      return [e.unit, e.region, e.item, e.vendor, e.issue, e.poNumber]
        .some((field) => String(field).toLowerCase().includes(needle));
    });

    res.json({
      items,
      total: items.length,
      pendingCount: run.exceptions.filter((e) => e.status === 'pending').length,
      totalCount: run.exceptions.length
    });
  });

  post('/exceptions/decisions', async (req, res) => {
    const { refs, decision, actor = 'HO Finance' } = req.body ?? {};
    if (!Array.isArray(refs) || !refs.every(isRef)) {
      return res.status(400).json({ error: 'refs must be an array of finding references' });
    }
    if (!DECISIONS.has(decision)) {
      return res.status(400).json({ error: `decision must be one of ${[...DECISIONS].join(', ')}` });
    }
    const { run } = await state();
    const known = new Set(run.exceptions.map((e) => e.ref));
    const applicable = refs.filter((ref) => known.has(ref));
    store.applyDecisions(run.periodId, applicable, decision, actor);
    invalidate();
    const refreshed = await state();
    res.json({
      updated: applicable.length,
      decision,
      pendingCount: refreshed.run.exceptions.filter((e) => e.status === 'pending').length
    });
  });

  post('/exceptions/decision', async (req, res) => {
    const { ref, decision, actor = 'HO Finance' } = req.body ?? {};
    if (!DECISIONS.has(decision)) {
      return res.status(400).json({ error: `decision must be one of ${[...DECISIONS].join(', ')}` });
    }
    const { run } = await state();
    const { exception, error } = resolveRef(run, ref);
    if (error) return res.status(error === 'finding not found' ? 404 : 400).json({ error });

    store.applyDecision(run.periodId, ref, decision, actor);
    invalidate();
    const refreshed = await state();
    const updated = refreshed.run.exceptions.find((e) => e.ref === ref);
    res.json({
      exception: updated,
      request: decision === 'approved'
        ? draftRevision(updated, requestCtx(refreshed.settings, refreshed.run))
        : null,
      pendingCount: refreshed.run.exceptions.filter((e) => e.status === 'pending').length
    });
  });

  post('/exceptions/respond', async (req, res) => {
    const { ref, action, note = '', actor = 'Unit Purchasing' } = req.body ?? {};
    if (typeof action !== 'string' || !action.trim()) {
      return res.status(400).json({ error: 'action is required' });
    }
    const { run } = await state();
    const { error } = resolveRef(run, ref);
    if (error) return res.status(error === 'finding not found' ? 404 : 400).json({ error });

    const responded = store.applyResponse(
      run.periodId, ref, action.trim().slice(0, 200), String(note).slice(0, 500), actor
    );
    if (!responded) return res.status(409).json({ error: 'a request must be dispatched before a unit can reply' });
    invalidate();
    const refreshed = await state();
    res.json({ exception: refreshed.run.exceptions.find((e) => e.ref === ref) });
  });

  get('/exceptions/:ref', async (req, res) => {
    const { run } = await state();
    const { exception, error } = resolveRef(run, req.params.ref);
    if (error) return res.status(error === 'finding not found' ? 404 : 400).json({ error });
    res.json(exception);
  });

  get('/exceptions/:ref/request', async (req, res) => {
    const { run, settings } = await state();
    const { exception, error } = resolveRef(run, req.params.ref);
    if (error) return res.status(error === 'finding not found' ? 404 : 400).json({ error });
    res.json(draftRevision(exception, requestCtx(settings, run)));
  });

  // The human gate that stays: a person validates what was actually banked.
  post('/exceptions/close', async (req, res) => {
    const { ref, achievedSavingsRaw, actor = 'HO Finance', note = '' } = req.body ?? {};
    if (!Number.isFinite(achievedSavingsRaw) || achievedSavingsRaw < 0) {
      return res.status(400).json({ error: 'achievedSavingsRaw must be a non-negative number' });
    }
    const { run } = await state();
    const { error } = resolveRef(run, ref);
    if (error) return res.status(error === 'finding not found' ? 404 : 400).json({ error });

    const closed = store.markClosed(run.periodId, ref, Math.round(achievedSavingsRaw), actor, note);
    if (!closed) return res.status(409).json({ error: 'finding must be confirmed before it can be closed' });
    invalidate();
    const refreshed = await state();
    res.json({
      exception: refreshed.run.exceptions.find((e) => e.ref === ref),
      kpis: buildKpis(refreshed.run, refreshed.masters, refreshed.extract)
    });
  });

  get('/units', async (req, res) => {
    const { run, masters, extract } = await state();
    res.json({ units: buildLeaderboard(run, masters, extract) });
  });

  get('/units/:id', async (req, res) => {
    const { run, masters, extract, settings } = await state();
    const scorecard = buildLeaderboard(run, masters, extract).find((u) => u.unit === req.params.id);
    if (!scorecard) return res.status(404).json({ error: 'unit not found' });

    const exceptions = run.exceptions.filter((e) => e.unit === scorecard.unit && e.status !== 'false_positive');
    res.json({
      ...scorecard,
      groupCompliancePct: buildKpis(run, masters, extract).compliancePct,
      exceptions,
      requests: exceptions.map((e) => draftRevision(e, requestCtx(settings, run)))
    });
  });

  get('/rebates', async (req, res) => {
    const { run, masters, extract } = await state();
    res.json(buildRebateSummary(run, masters, extract));
  });

  get('/requests', async (req, res) => {
    const { run, settings } = await state();
    const { unit } = req.query;
    const source = run.exceptions.filter((e) => {
      if (e.status === 'false_positive') return false;
      return unit ? e.unit === unit : true;
    });
    res.json({ requests: source.map((e) => draftRevision(e, requestCtx(settings, run))) });
  });

  // --- ingest gate ------------------------------------------------------
  // Where the data came from, shown on every page so nobody mistakes demo
  // output for the ERP.
  get('/provenance', async (req, res) => {
    const { provenance, report } = await state();
    res.json({ ...provenance, totals: report.totals, ok: report.ok });
  });

  get('/ingest/sources', async (req, res) => {
    res.json({
      active: source.id,
      label: source.describe(),
      synthetic: source.synthetic,
      known: SOURCE_IDS,
      periods: await source.listPeriods(),
      configuredPeriod: config.periodId
    });
  });

  get('/ingest/latest', async (req, res) => {
    const periodId = typeof req.query.period === 'string' ? req.query.period : undefined;
    const staged = ingest.latestStaged(source.id, periodId);
    if (!staged) return res.status(404).json({ error: 'nothing has been staged yet' });

    const held = ingest.readStaged(staged.periodId, staged.checksum);
    const active = ingest.activeIngest(source.id);
    res.json({
      ...staged,
      report: held?.report ?? null,
      isAccepted: Boolean(active && active.periodId === staged.periodId && active.checksum === staged.checksum)
    });
  });

  get('/ingest/history', async (req, res) => res.json({ events: ingest.history() }));

  post('/ingest/stage', async (req, res) => {
    const periods = await source.listPeriods();
    const requested = req.body?.periodId ?? config.periodId ?? periods[periods.length - 1];
    if (!requested) return res.status(400).json({ error: `source "${source.id}" offers no periods` });
    if (!periods.includes(requested)) {
      return res.status(404).json({ error: `period "${requested}" not available from source "${source.id}"` });
    }
    const staged = await ingest.stage(source, requested, { actor: req.body?.actor ?? config.actor });
    res.json(staged);
  });

  post('/ingest/accept', async (req, res) => {
    const { periodId, checksum, actor = config.actor, note = '' } = req.body ?? {};
    const accepted = ingest.accept(periodId, checksum, actor, String(note).slice(0, 500));
    if (!accepted) return res.status(404).json({ error: 'no staged extract with that period and checksum' });
    invalidate();
    res.json({ accepted });
  });

  post('/ingest/reject', async (req, res) => {
    const { periodId, checksum, actor = config.actor, note = '' } = req.body ?? {};
    const rejected = ingest.reject(periodId, checksum, actor, String(note).slice(0, 500));
    if (!rejected) return res.status(404).json({ error: 'no staged extract with that period and checksum' });
    invalidate();
    res.json({ rejected });
  });

  // Without this a GET to an unknown /api path falls through to the SPA
  // fallback and returns index.html as if it were JSON.
  router.use((req, res) => res.status(404).json({ error: `no such endpoint: ${req.method} ${req.originalUrl}` }));

  return router;
}
