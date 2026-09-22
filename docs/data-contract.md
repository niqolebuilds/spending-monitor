# Data contract — what the Spend Monitor needs from the ERP

For the IT / ERP team. This is the complete specification of the data the weekly
spend-compliance scan reads. Nothing outside this document is required, and no data is
written back to any source system — the monitor is read-only.

A worked example of every file below can be generated from the repository with
`node scripts/export-csv.js <folder>`, which writes exactly the layout described here.

---

## 1. Delivery

**Preferred: a scheduled CSV export to a folder the monitor can read.**

```
<root>/masters/units.csv
<root>/masters/formulary.csv
<root>/masters/trade-agreements.csv
<root>/masters/principals.csv
<root>/2026-W38/po-lines.csv
<root>/2026-W38/rebate-ledger.csv
<root>/2026-W38/usage-lines.csv
<root>/2026-W38/price-history.csv      (optional)
<root>/2026-W38/request-log.csv        (optional)
```

- One folder per period, named `YYYY-Www` (ISO week). Masters sit in their own folder and
  are re-exported whenever they change.
- Cadence: weekly, after the period closes. The monitor never reads a folder until a person
  has reviewed and accepted it.
- **CSV, not .xlsx.** Excel is the single largest source of silent corruption here — see §4.
- UTF-8. A byte-order mark is tolerated. Quote any field containing a comma, quote or newline,
  and double embedded quotes (`""`), per RFC 4180.

A read-only database view or an HTTP/OData endpoint works equally well and is preferred once
available — the monitor reads through a small adapter, and adding one is a single file. If that
route is easier for you, we need the same columns and the same rules below; the transport does
not matter.

---

## 2. Required files

Column names are the CSV headers and must match exactly. Extra columns are ignored.

### `po-lines.csv` — one row per purchase-order line in the period

| Column | Type | Notes |
|---|---|---|
| `lineId` | string | **Unique within the period.** The monitor keys analyst decisions to this value, so it must be stable — the same PO line must carry the same `lineId` if the period is re-exported. |
| `poNumber` | string | Purchase order number, as shown to users. |
| `poLine` | integer | Line number within the PO. |
| `unit` | string | Hospital unit code. Must exist in `units.csv`. |
| `vendorId` | string | Supplier code. Must exist in `principals.csv`. |
| `sku` | string | Item code. Must exist in `formulary.csv`. |
| `qty` | number | Quantity ordered. Must be greater than zero. |
| `uom` | string | Unit of measure **as keyed on the PO**. Compared against the item master — do not normalise it for us; a mismatch is a finding we want to see. |
| `unitPrice` | number | Price per `uom`, in IDR, excluding tax. Must be greater than zero. |
| `poDate` | date | `YYYY-MM-DD`. See §4. |

### `rebate-ledger.csv` — one row per principal

| Column | Type | Notes |
|---|---|---|
| `vendorId` | string | Must exist in `principals.csv`. |
| `ytdPurchaseIDR` | number | Year-to-date purchase value against this principal. |
| `weeksElapsed` | integer | Weeks elapsed in the rebate programme year. |
| `weeksRemaining` | integer | Weeks left in the programme year. |

### `usage-lines.csv` — one row per unit and item, 90-day window

| Column | Type | Notes |
|---|---|---|
| `unit` | string | Must exist in `units.csv`. |
| `sku` | string | Must exist in `formulary.csv`. |
| `purchasedQty90d` | number | Quantity purchased in the trailing 90 days. |
| `dispensedQty90d` | number | Quantity dispensed or consumed in the same window. |
| `onHandQty` | number | Current stock on hand. |

### `price-history.csv` — optional, improves benchmarking

| Column | Type | Notes |
|---|---|---|
| `unit` | string | |
| `sku` | string | |
| `prices` | string | The last 12 weekly prices paid, oldest first, separated by `\|` (e.g. `16810000\|16810000\|20890000`). |

Without this file the monitor still works; it simply cannot say whether a unit has a repeat
pattern or a one-off.

### `request-log.csv` — optional, drives the unit scorecards

| Column | Type | Notes |
|---|---|---|
| `unit` | string | |
| `requestsSent` | integer | Revision requests sent to this unit historically. |
| `requestsAnswered` | integer | How many were answered. |
| `avgReplyDays` | number | Average reply time in days. |

---

## 3. Master files

### `units.csv`
`id` (string, unique), `name` (string), `region` (string), `beds` (integer, optional).

### `formulary.csv`
| Column | Type | Notes |
|---|---|---|
| `sku` | string | Unique. |
| `name` | string | Item name as clinicians know it. |
| `category` | string | Therapeutic or device category. |
| `vendorId` | string | Primary supplier. |
| `uom` | string | The unit the contracted price is quoted per. |
| `formularyStatus` | string | Exactly `formulary` or `non-formulary`. |
| `bpjsCovered` | boolean | `true`/`false` (also accepts `yes`/`no`/`1`/`0`). |
| `locked` | boolean | Item is restricted or inactive. |
| `equivalentSku` | string | For a non-formulary item, the formulary item it should be substituted with. Blank if none — the monitor then reports a formulary coverage gap rather than a unit error. |
| `referencePrice` | number | Indicative price in IDR. |

### `trade-agreements.csv`
| Column | Type | Notes |
|---|---|---|
| `agreementNo` | string | Contract reference, shown to units in revision requests. |
| `vendorId` | string | |
| `sku` | string | |
| `contractPrice` | number | Agreed price per the item master's `uom`, in IDR. |
| `toleranceIDR` | number | Allowed variance before a line is flagged. Use `0` for none. |
| `validFrom` | date | `YYYY-MM-DD`, inclusive. |
| `validTo` | date | `YYYY-MM-DD`, inclusive. |

A `vendorId` + `sku` pair must be unique for any overlapping validity window.

### `principals.csv`
`vendorId` (string, unique), `name` (string), `category` (string), `rebatePct` (number),
`tier1TargetIDR` (number), `tier2TargetIDR` (number).

---

## 4. Two rules that matter more than the rest

**Identifiers are text, never numbers.** `sku`, `vendorId`, `unit`, `poNumber` and `lineId`
must be exported as strings. If Excel touches the file it will render `0012345` as `12345`,
and the monitor will then fail to match that item against the formulary. When a code does not
match, no rule can assess the line: it produces no finding and no error, so it silently
disappears from the scan. Format the columns as Text, or export from the database directly.

**Dates are plain calendar dates: `YYYY-MM-DD`.** Not `16/09/2026`, and not a timestamp.
The monitor compares `poDate` against agreement validity windows as text, so
`2026-09-16T00:00:00+07:00` sorts *after* `2026-09-16` and would flip same-day expiry.
A date that is not exactly `YYYY-MM-DD` is rejected at the gate rather than guessed at.

Related: decimal separators are handled either way — `1250000`, `1,250,000` and `1.250.000`
all read as one million two hundred fifty thousand. Anything else is refused rather than
interpreted.

---

## 5. What happens to data that does not comply

Nothing is silently dropped. Every export is staged and validated before any rule runs, and a
person accepts or rejects it on the Data Review screen. The report shows:

- rows that could not be parsed, with the offending column and the reason
- duplicate `lineId` values
- codes that do not resolve against the masters, split by unknown SKU, unknown unit, unknown
  vendor, and no trade agreement for that vendor-and-SKU pair
- quantities or prices at or below zero

If the export is rejected, the previously accepted one stays live. The scan never runs against
data nobody has reviewed.

---

## 6. What we do not need

- No patient, clinical or personally identifying data of any kind.
- No write access, and no stored procedures. The monitor reads and never updates a source system.
- No real-time feed. Weekly, after period close, is the design point.
