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

## How it works

The pipeline is **extract → benchmark → flag → notify**, and it is generic over that pattern:
ten processes share it, so a new one is a new rule file rather than an edit to existing code.

```
data/masters/      formulary, trade agreements, units, principals
data/extracts/     the weekly PO lines, rebate ledger, usage lines, price history, request log
data/state/        analyst decisions and closures (runtime, gitignored)
src/rules/         one file per rule, auto-discovered by registry.js
src/engine.js      runs every rule over its dataset, owns ids, ordering and money formatting
src/aggregate.js   turns a run into the KPIs, funnel, leakage and leaderboard the pages render
src/requests.js    drafts the revision request a confirmed finding produces
src/api.js         the JSON API the four pages fetch from
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
  finding through `POST /api/exceptions/:id/close`.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/run/latest`, `/api/kpis`, `/api/settings` | the current scan and its aggregates |
| POST | `/api/run` | re-run the engine |
| GET | `/api/exceptions?type=&status=&unit=&q=` | the review queue |
| GET | `/api/exceptions/:id`, `/api/exceptions/:id/request` | one finding, and its drafted request |
| POST | `/api/exceptions/:id/decision` | `{decision: "approved" \| "false_positive", actor}` |
| POST | `/api/exceptions/decisions` | batch `{ids[], decision, actor}` |
| POST | `/api/exceptions/:id/respond` | the unit's reply `{action, note, actor}` |
| POST | `/api/exceptions/:id/close` | human gate `{achievedSavingsRaw, actor, note}` |
| GET | `/api/units`, `/api/units/:id`, `/api/rebates`, `/api/requests?unit=` | page payloads |

## Autonomy

Running at **L2 (Copilot)**: the scan tags every line, proposes root cause and savings category, and
drafts the request — an analyst confirms each one and nothing dispatches on its own. The seams for
L3 and L4 are built but not switched on; see [docs/autonomy.md](docs/autonomy.md).

## Data

The extract is synthetic and generated from a fixed seed, so `npm run data` is reproducible.
It is sized and weighted to look like a real week — purchasing is overwhelmingly on-formulary,
deviations are a few percent of lines — rather than tuned to hit any particular headline number.
