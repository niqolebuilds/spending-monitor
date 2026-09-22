// The canonical row shapes every source must produce, and the validator that
// holds a source to them. Rows that fail are quarantined into the report — never
// dropped quietly, because a row that disappears between the ERP and the scan
// looks exactly like a compliant one.
import { refFor, SCANNED_DATASETS } from '../refs.js';

const CAP = 200;

// Identifiers are opaque. Never parse them as numbers: Excel renders "0012345"
// as 12345, and the monitor would then fail to match it against the masters.
const asId = (value) => {
  const text = String(value ?? '').trim();
  return text ? { ok: true, value: text } : { ok: false, reason: 'missing' };
};

const asText = (value) => {
  const text = String(value ?? '').trim();
  return text ? { ok: true, value: text } : { ok: false, reason: 'missing' };
};

// Accepts 1250000, "1,250,000" and Indonesian "1.250.000". Rejects anything
// else rather than guessing, since a misread price becomes a false finding.
export function parseAmount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: 'not a number' };
  }
  const text = String(value ?? '').trim().replace(/\s/g, '');
  if (!text) return { ok: false, reason: 'missing' };

  let normalised = text;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    normalised = text.replace(/\./g, '').replace(',', '.');      // 1.250.000,50
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    normalised = text.replace(/,/g, '');                          // 1,250,000.50
  } else if (/^-?\d+(,\d+)$/.test(text)) {
    normalised = text.replace(',', '.');                          // 1250000,50
  } else if (!/^-?\d+(\.\d+)?$/.test(text)) {
    return { ok: false, reason: `unrecognised number format "${text}"` };
  }

  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false, reason: 'not a number' };
}

const asNumber = (value) => parseAmount(value);

const asInt = (value) => {
  const parsed = parseAmount(value);
  if (!parsed.ok) return parsed;
  return Number.isInteger(parsed.value)
    ? parsed
    : { ok: true, value: Math.round(parsed.value) };
};

// Dates are compared lexicographically against agreement validity windows, so
// a datetime would silently flip same-day expiry: '2026-09-16T00:00:00+07:00'
// sorts after '2026-09-16'. Only a plain calendar date is accepted.
const asDate = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { ok: false, reason: `date must be YYYY-MM-DD, got "${text}"` };
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? { ok: false, reason: `not a real date "${text}"` } : { ok: true, value: text };
};

const asArray = (value) => (Array.isArray(value) ? { ok: true, value } : { ok: false, reason: 'expected a list' });

export const DATASETS = {
  poLines: {
    label: 'PO lines',
    fields: {
      lineId: asId, poNumber: asId, poLine: asInt, unit: asId, vendorId: asId,
      sku: asId, qty: asNumber, uom: asText, unitPrice: asNumber, poDate: asDate
    }
  },
  rebateLedger: {
    label: 'Rebate ledger',
    fields: {
      vendorId: asId, ytdPurchaseIDR: asNumber, weeksElapsed: asInt, weeksRemaining: asInt
    }
  },
  usageLines: {
    label: 'Usage lines',
    fields: {
      unit: asId, sku: asId, purchasedQty90d: asNumber, dispensedQty90d: asNumber, onHandQty: asNumber
    }
  },
  priceHistory: {
    label: 'Price history',
    fields: { unit: asId, sku: asId, prices: asArray }
  },
  requestLog: {
    label: 'Request log',
    fields: { unit: asId, requestsSent: asInt, requestsAnswered: asInt, avgReplyDays: asNumber }
  }
};

function coerceRow(dataset, row, index) {
  const spec = DATASETS[dataset];
  const clean = { ...row };
  const problems = [];

  for (const [field, coerce] of Object.entries(spec.fields)) {
    const result = coerce(row[field]);
    if (result.ok) clean[field] = result.value;
    else problems.push({ field, value: row[field] ?? null, reason: result.reason });
  }

  return { clean, problems, index };
}

export function validateExtract(extract, masters) {
  const skus = new Set(masters.formulary.map((f) => f.sku));
  const units = new Set(masters.units.map((u) => u.id));
  const vendors = new Set(masters.principals.map((p) => p.vendorId));
  const agreements = new Set(masters.tradeAgreements.map((t) => `${t.vendorId}|${t.sku}`));

  const rows = { weekId: extract.weekId };
  const datasets = {};
  const rejects = [];
  const duplicates = [];
  const outOfRange = [];
  const joins = { unknownSku: [], unknownUnit: [], unknownVendor: [], noAgreement: [] };

  for (const [dataset, spec] of Object.entries(DATASETS)) {
    const incoming = extract[dataset] ?? [];
    const accepted = [];
    const seen = new Set();

    incoming.forEach((row, index) => {
      const { clean, problems } = coerceRow(dataset, row, index);
      if (problems.length) {
        rejects.push({ dataset, index, label: spec.label, problems });
        return;
      }

      const ref = SCANNED_DATASETS.includes(dataset) ? refFor(dataset, clean) : `${dataset}|${index}`;
      if (seen.has(ref)) {
        duplicates.push({ dataset, ref, index });
        return;
      }
      seen.add(ref);

      if (dataset === 'poLines') {
        if (clean.qty <= 0) outOfRange.push({ dataset, ref, field: 'qty', value: clean.qty });
        if (clean.unitPrice <= 0) outOfRange.push({ dataset, ref, field: 'unitPrice', value: clean.unitPrice });
        if (!skus.has(clean.sku)) joins.unknownSku.push({ ref, sku: clean.sku });
        if (!units.has(clean.unit)) joins.unknownUnit.push({ ref, unit: clean.unit });
        if (!vendors.has(clean.vendorId)) joins.unknownVendor.push({ ref, vendorId: clean.vendorId });
        if (!agreements.has(`${clean.vendorId}|${clean.sku}`)) {
          joins.noAgreement.push({ ref, vendorId: clean.vendorId, sku: clean.sku });
        }
      }
      if (dataset === 'usageLines' && !skus.has(clean.sku)) joins.unknownSku.push({ ref, sku: clean.sku });
      if (dataset === 'rebateLedger' && !vendors.has(clean.vendorId)) {
        joins.unknownVendor.push({ ref, vendorId: clean.vendorId });
      }

      accepted.push(clean);
    });

    rows[dataset] = accepted;
    datasets[dataset] = {
      label: spec.label,
      read: incoming.length,
      accepted: accepted.length,
      rejected: incoming.length - accepted.length
    };
  }

  const joinIssues = Object.values(joins).reduce((total, list) => total + list.length, 0);
  const read = Object.values(datasets).reduce((total, d) => total + d.read, 0);
  const accepted = Object.values(datasets).reduce((total, d) => total + d.accepted, 0);

  return {
    rows,
    report: {
      // "Clean" means nothing was rejected and every code resolved. Join misses
      // are not cosmetic: those rows reach no rule at all.
      ok: rejects.length === 0 && joinIssues === 0 && duplicates.length === 0,
      totals: { read, accepted, rejected: read - accepted, joinIssues, duplicates: duplicates.length },
      datasets,
      rejects: rejects.slice(0, CAP),
      duplicates: duplicates.slice(0, CAP),
      outOfRange: outOfRange.slice(0, CAP),
      joins: Object.fromEntries(Object.entries(joins).map(([key, list]) => [key, list.slice(0, CAP)])),
      joinCounts: Object.fromEntries(Object.entries(joins).map(([key, list]) => [key, list.length]))
    }
  };
}
