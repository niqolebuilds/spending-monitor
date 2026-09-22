import express from 'express';
import { loadMasters, loadExtract, loadSettings, AS_OF } from './load.js';
import { runEngine } from './engine.js';
import { buildKpis, buildLeaderboard, buildRebateSummary } from './aggregate.js';
import { draftRevision } from './requests.js';
import * as store from './store.js';
import { isRef } from './refs.js';

const DECISIONS = new Set(['approved', 'false_positive']);

let cached = null;

async function state() {
  if (cached) return cached;
  const masters = loadMasters();
  const extract = loadExtract();
  const settings = loadSettings();
  const run = await runEngine({
    masters, extract, settings, asOf: AS_OF,
    decisions: store.decisionsFor(extract.weekId)
  });
  cached = { masters, extract, settings, run };
  return cached;
}

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

  router.get('/run/latest', async (req, res) => {
    const { run, masters, extract } = await state();
    res.json({ ...run, kpis: buildKpis(run, masters, extract) });
  });

  router.post('/run', async (req, res) => {
    invalidate();
    const { run, masters, extract } = await state();
    res.json({ ...run, kpis: buildKpis(run, masters, extract) });
  });

  router.get('/kpis', async (req, res) => {
    const { run, masters, extract } = await state();
    res.json(buildKpis(run, masters, extract));
  });

  router.get('/settings', async (req, res) => {
    const { settings } = await state();
    res.json(settings);
  });

  router.get('/exceptions', async (req, res) => {
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

  router.post('/exceptions/decisions', async (req, res) => {
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

  router.post('/exceptions/decision', async (req, res) => {
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

  router.post('/exceptions/respond', async (req, res) => {
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

  router.get('/exceptions/:ref', async (req, res) => {
    const { run } = await state();
    const { exception, error } = resolveRef(run, req.params.ref);
    if (error) return res.status(error === 'finding not found' ? 404 : 400).json({ error });
    res.json(exception);
  });

  router.get('/exceptions/:ref/request', async (req, res) => {
    const { run, settings } = await state();
    const { exception, error } = resolveRef(run, req.params.ref);
    if (error) return res.status(error === 'finding not found' ? 404 : 400).json({ error });
    res.json(draftRevision(exception, requestCtx(settings, run)));
  });

  // The human gate that stays: a person validates what was actually banked.
  router.post('/exceptions/close', async (req, res) => {
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

  router.get('/units', async (req, res) => {
    const { run, masters, extract } = await state();
    res.json({ units: buildLeaderboard(run, masters, extract) });
  });

  router.get('/units/:id', async (req, res) => {
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

  router.get('/rebates', async (req, res) => {
    const { run, masters, extract } = await state();
    res.json(buildRebateSummary(run, masters, extract));
  });

  router.get('/requests', async (req, res) => {
    const { run, settings } = await state();
    const { unit } = req.query;
    const source = run.exceptions.filter((e) => {
      if (e.status === 'false_positive') return false;
      return unit ? e.unit === unit : true;
    });
    res.json({ requests: source.map((e) => draftRevision(e, requestCtx(settings, run))) });
  });

  // Without this a GET to an unknown /api path falls through to the SPA
  // fallback and returns index.html as if it were JSON.
  router.use((req, res) => res.status(404).json({ error: `no such endpoint: ${req.method} ${req.originalUrl}` }));

  return router;
}
