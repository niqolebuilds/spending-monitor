# Spend Compliance & Savings Monitor

Weekly compliance and savings monitor for a 41-unit hospital group. It reads the weekly
purchase-order, rebate and usage extracts, benchmarks them against the formulary and vendor trade
agreements, quantifies recoverable savings and non-compliance, and drafts the PO revision requests
that go back to the units.

Every figure on every page is computed by the rule engine. Nothing is hard-coded in the HTML.

## Running it

```bash
npm install
npm run data     # regenerate the synthetic weekly extract (deterministic)
npm run seed     # put the queue into a part-worked state for a demo
npm start        # http://localhost:3000
npm test         # node --test, no dependencies
```

`npm run seed -- --reset` clears all decisions and returns the queue to untouched.

### Pointing it at real data

Configuration is environment variables only, so the same build runs anywhere:

| Variable | Default | |
|---|---|---|
| `SPEND_SOURCE` | `fixture` | `fixture` (committed sample data) or `files` (a CSV drop folder) |
| `SPEND_DATA_DIR` | `./data/inbox` | Where the `files` source reads exports from |
| `SPEND_PERIOD` | latest available | Pin a period instead of taking the newest |
| `PORT` | `3000` | |

```bash
node scripts/export-csv.js /tmp/inbox          # worked example in the expected layout
SPEND_SOURCE=files SPEND_DATA_DIR=/tmp/inbox npm start
```

With a real source, **nothing is scanned until a person accepts it** on the Data Review page —
the API answers `409` until then. The sample source is allowed to accept itself because every
page carries a banner saying the data is synthetic. Absence of data never selects the data.

[docs/data-contract.md](docs/data-contract.md) is the column-level specification to hand the
ERP team; connecting a new system means adding one file under `src/sources/`.

## How it works

The pipeline is **extract → benchmark → flag → notify**, and it is generic over that pattern:
ten processes share it, so a new one is a new rule file rather than an edit to existing code.

```
data/masters/      formulary, trade agreements, units, principals
data/extracts/     the weekly PO lines, rebate ledger, usage lines, price history, request log
data/state/        analyst decisions, closures and the ingest log (runtime, gitignored)
data/ingest/       staged extracts, immutable and addressed by checksum (runtime, gitignored)
src/sources/       one adapter per system + the field contract and validator
src/ingest.js      stage -> validate -> accept, so a person gates what gets scanned
src/rules/         one file per rule, auto-discovered by registry.js
src/engine.js      runs every rule over its dataset, owns ids, ordering, coverage and formatting
src/aggregate.js   turns a run into the KPIs, funnel, leakage and leaderboard the pages render
src/requests.js    drafts the revision request a confirmed finding produces
src/api.js         the JSON API the five pages fetch from
```

### Adding a rule

Drop a `*.rule.js` file in `src/rules/`. `registry.js` discovers it; no other file changes.
The contract is enforced by `test/rules.contract.test.js`:

```js
export default {
  id, dataset, type, issue, badgeClass, severity, savingsCategory, priority, autoEligible,
  identity(row, ctx),   // { ref, unit, region, item, vendor, poNumber, poLine, poDate }
  applies(row, ctx),    // boolean
  evaluate(row, ctx)    // null | { amountRaw, savingsRaw, metrics, finding,
                        //          trendNote, rootCause, suggestedAction, exposureRaw?, evidenceBars? }
};
```

`src/rules/price-above-ta.rule.js` is the reference implementation.

The seven shipped rules span all three datasets: price above trade agreement, expired agreement,
non-formulary, BPJS non-formulary and UOM mismatch (PO lines); rebate tier gap (rebate ledger);
overstock against usage (usage lines).

### Measurement rules that keep the numbers honest

- **One finding per source row.** Rules carry a `priority`; the highest-precedence match owns the
  row, so a line that is both off-formulary and overpriced cannot be counted twice.
- **Savings vs exposure are separate.** `savingsRaw` is recoverable rupiah. `exposureRaw` is money
  at risk. A BPJS coverage gap, a mis-keyed UOM and 90-day overstock all carry exposure and zero
  savings, so they can never inflate the savings headline.
- **Percentages are derived from the sums they label.** Funnel widths *are* their percentages, and
  leakage shares are computed from the same total they sit under.
- **Achieved savings are never inferred.** `validatedSavings` only moves when a person closes a
  finding through `POST /api/exceptions/close`.
- **A row that matched nothing is not a clean row.** Every rule resolves codes against the
  masters, and a miss means `applies()` returns false — the line would produce no finding and
  no error. Coverage is tracked separately (`rowsRead` vs `rowsAssessed`) and surfaced, so an
  unmatched code reads as unexamined rather than compliant.
- **Decisions are keyed to rows, not to rank.** `EXP-NN` is a display label; approvals are
  stored against the period and the row's content-derived ref, so re-ranking a run or
  correcting a master price cannot move a decision onto a different finding.

## API

Findings are addressed by `ref` (e.g. `poLine|L-00341`), never by the `EXP-NN` label.

| Method | Path | |
|---|---|---|
| GET | `/api/run/latest`, `/api/kpis`, `/api/settings` | the current scan and its aggregates |
| POST | `/api/run` | re-run the engine |
| GET | `/api/exceptions?type=&status=&unit=&q=` | the review queue |
| GET | `/api/exceptions/:ref`, `/api/exceptions/:ref/request` | one finding, and its drafted request |
| POST | `/api/exceptions/decision` | `{ref, decision: "approved" \| "false_positive", actor}` |
| POST | `/api/exceptions/decisions` | batch `{refs[], decision, actor}` |
| POST | `/api/exceptions/respond` | the unit's reply `{ref, action, note, actor}` |
| POST | `/api/exceptions/close` | human gate `{ref, achievedSavingsRaw, actor, note}` |
| GET | `/api/units`, `/api/units/:id`, `/api/rebates`, `/api/requests?unit=` | page payloads |
| GET | `/api/provenance` | which source, period and checksum the page is showing |
| GET | `/api/ingest/sources`, `/api/ingest/latest`, `/api/ingest/history` | the ingest gate |
| POST | `/api/ingest/stage`, `/api/ingest/accept`, `/api/ingest/reject` | stage and gate an extract |

## Autonomy

Running at **L2 (Copilot)**: the scan tags every line, proposes root cause and savings category, and
drafts the request — an analyst confirms each one and nothing dispatches on its own. The seams for
L3 and L4 are built but not switched on; see [docs/autonomy.md](docs/autonomy.md).

## Data

The extract is synthetic and generated from a fixed seed, so `npm run data` is reproducible.
It is sized and weighted to look like a real week — purchasing is overwhelmingly on-formulary,
deviations are a few percent of lines — rather than tuned to hit any particular headline number.
