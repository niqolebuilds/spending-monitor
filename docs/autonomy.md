# Autonomy ladder

The monitor runs at **L2**. L3 and L4 are designed for, with the seams built and tested, but not
switched on. This document says exactly what exists and what each step up would take.

## L2 — Copilot (assist) · live

The scan reads the weekly PO, rebate and usage extracts, benchmarks each line against the formulary
and trade agreements, tags what deviates, proposes a root cause and savings category, and drafts
the revision request. An analyst confirms every finding.

What makes it real rather than decorative:

- `engine.gate()` returns `review` for every finding while `settings.mode` is `L2`.
- Nothing reaches a unit inbox until `POST /api/exceptions/:id/decision` records a person's
  confirmation. The unit-inbox page only renders findings whose status is `approved`.
- Decisions persist to `data/state/decisions.json`, so the queue is genuinely worked, not re-rendered.

## L3 — Supervised agent · designed, not enabled

Runs on schedule across all units, dispatches revision requests, tracks closure, and escalates only
exceptions above a rupiah threshold.

The seams already in place:

| Seam | Where | State |
|---|---|---|
| Threshold gate | `engine.gate(savingsRaw, rule, settings)` | Implemented and tested at the boundary (`>= thresholdIDR` holds for review). Inert while mode is `L2`. |
| Per-rule eligibility | `rule.autoEligible` | Declared on all seven rules. Price and non-formulary are eligible; BPJS, expired agreements, UOM and overstock are not — they need judgement. |
| Threshold value | `settings.thresholdIDR` (Rp 25,000,000) | Served read-only at `GET /api/settings`. |
| Closure tracking | `store.applyResponse` / `store.markClosed`, `GET /api/units/:id` | Live now — units reply and Finance verifies. |
| Request dispatch | `requests.draftRevision()` | Drafts a complete Outlook-ready request with routing, SLA and due date. It renders; it does not send. |

To enable L3:

1. Set `mode: 'L3'` in `src/load.js:loadSettings()`. `gate()` then routes sub-threshold, auto-eligible
   findings to `lane: 'auto'`.
2. In `runEngine`, self-approve `lane === 'auto'` findings and stamp `dispatchedAt` via the store.
3. Add a scheduler (`setInterval` or cron) calling `POST /api/run`, stamping a new `runId` per week.
4. Show the auto-dispatched count on the reviewer queue so the analyst sees what went out without them.

The reviewer queue would then show only above-threshold findings plus a banner reading
"N items auto-dispatched below Rp 25M".

## L4 — Orchestrated · designed, not enabled

Hands savings gaps to a Sourcing Copilot as renegotiation targets and feeds a Report Composer.

The data is already shaped for both handoffs:

- **Sourcing targets.** `rebate-tier-gap.rule.js` already distinguishes a steering problem from an
  over-set threshold — when the required uplift exceeds 40% it recommends renegotiation at renewal
  rather than chasing volume. Each finding carries `metrics.gapIDR`, `requiredWeekly` and
  `upliftPct`, which is the whole payload a sourcing agent needs.
- **Report payload.** `aggregate.buildKpis()` returns the entire weekly picture — funnel, leakage by
  category, counts, validated vs potential savings — as one JSON object. That is the Report
  Composer's input; it needs no further shaping.

To enable L4, add `GET /api/handoffs` emitting `{target: 'sourcing-copilot', principal, gapIDR, ask}`
per rebate finding, and post `buildKpis()` output to the composer on each scheduled run.

## The human gate that stays

Two things do not move up the ladder at any level:

1. **Validating achieved savings.** `validatedSavings` only changes through
   `POST /api/exceptions/:id/close` with an actor and an explicit rupiah figure. The engine never
   infers what was banked from what it flagged — the seed data closes at 86% of the flagged figure
   precisely because the two are not the same number.
2. **Escalations to principals.** Rebate findings produce a recommendation and a drafted request.
   The conversation with the principal stays with Sourcing.

## System access

Read-only against AX, D365, Power BI, Excel and Outlook. The agent can approve within its own queue
and save memory (decisions, responses, closures in `data/state/`), but it writes nothing back to
source systems at any level on this ladder.
