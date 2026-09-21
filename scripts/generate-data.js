#!/usr/bin/env node
// Regenerates the synthetic weekly extract. Deterministic: same SEED -> byte-identical output.
// Usage: node scripts/generate-data.js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mastersDir = path.join(root, 'data', 'masters');
const WEEK_ID = '2026-W38';
const WEEK_DAYS = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
const SEED = 20260921;
const PO_LINE_COUNT = 515;
const HISTORY_WEEKS = 12;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));
const chance = (p) => rnd() < p;
const write = (rel, data) => {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${rel} (${Array.isArray(data) ? data.length + ' rows' : 'object'})`);
};

const formulary = JSON.parse(readFileSync(path.join(mastersDir, 'formulary.json'), 'utf8'));
const principals = JSON.parse(readFileSync(path.join(mastersDir, 'principals.json'), 'utf8'));

// --- units -------------------------------------------------------------
const REGIONS = [
  'Jakarta', 'Jakarta', 'Jakarta', 'Banten', 'Banten', 'West Java', 'West Java', 'West Java',
  'Central Java', 'Central Java', 'Central Java', 'East Java', 'East Java', 'East Java',
  'Yogyakarta', 'Bali', 'Bali', 'North Sumatra', 'North Sumatra', 'South Sumatra', 'South Sumatra',
  'Riau', 'Lampung', 'West Kalimantan', 'East Kalimantan', 'South Kalimantan',
  'North Sulawesi', 'South Sulawesi', 'South Sulawesi', 'Central Sulawesi',
  'Nusa Tenggara', 'Nusa Tenggara', 'Papua', 'West Papua', 'Maluku',
  'Aceh', 'Jambi', 'Bengkulu', 'West Sumatra', 'Gorontalo', 'East Java'
];
const units = REGIONS.map((region, i) => {
  const id = `U${String(i + 1).padStart(2, '0')}`;
  return { id, name: `Unit ${String(i + 1).padStart(2, '0')} · ${region}`, region, beds: intBetween(80, 420) };
});
write('data/masters/units.json', units);

// --- trade agreements --------------------------------------------------
// One agreement per SKU with its primary principal. A minority have lapsed.
const tradeAgreements = formulary.map((f, i) => {
  const expired = chance(0.045);
  const contractPrice = f.referencePrice;
  return {
    agreementNo: `TA-2026-${String(i + 1).padStart(4, '0')}`,
    vendorId: f.vendorId,
    sku: f.sku,
    contractPrice,
    toleranceIDR: Math.max(500, Math.round(contractPrice * 0.005)),
    validFrom: chance(0.3) ? '2026-07-01' : '2026-01-01',
    validTo: expired ? '2026-08-31' : '2026-12-31'
  };
});
write('data/masters/trade-agreements.json', tradeAgreements);

const taBySku = new Map(tradeAgreements.map((t) => [t.sku, t]));
const skuById = new Map(formulary.map((f) => [f.sku, f]));
const vendorName = new Map(principals.map((p) => [p.vendorId, p.name]));

// Typical order quantity band by unit price, so line values stay plausible.
function qtyFor(price) {
  if (price >= 10000000) return intBetween(1, 12);
  if (price >= 1000000) return intBetween(4, 40);
  if (price >= 100000) return intBetween(20, 200);
  if (price >= 10000) return intBetween(100, 800);
  return intBetween(500, 4000);
}

// Purchasing is overwhelmingly on-formulary and BPJS-covered; off-formulary and
// restricted lines are the exception, so sample the catalogue accordingly.
const skuPool = [];
for (const f of formulary) {
  let weight = 20;
  if (f.formularyStatus === 'non-formulary') weight = 2;
  else if (!f.bpjsCovered) weight = 3;
  if (f.locked) weight = 1;
  for (let i = 0; i < weight; i++) skuPool.push(f);
}

// --- PO lines ----------------------------------------------------------
// Baseline is a compliant line at contract price. Deviations are injected at
// rates meant to look like a real week, not to hit a target headline number.
const poLines = [];
const poCounter = new Map();
for (let i = 0; i < PO_LINE_COUNT; i++) {
  const unit = pick(units);
  const sku = pick(skuPool);
  const ta = taBySku.get(sku.sku);
  const seq = (poCounter.get(unit.id) ?? 0) + 1;
  poCounter.set(unit.id, seq);

  let unitPrice = ta.contractPrice;
  let uom = sku.uom;

  if (chance(0.045)) {
    // price drifts above the agreed schedule (stale unit master / spot quote)
    unitPrice = Math.round(ta.contractPrice * between(1.12, 1.34));
  } else if (chance(0.015)) {
    // unit-of-measure keying error: box price keyed against each-quantity
    unitPrice = Math.round(ta.contractPrice * between(18, 60));
    uom = sku.uom === 'box' ? 'pcs' : 'box';
  } else if (chance(0.05)) {
    // benign variance inside tolerance
    unitPrice = ta.contractPrice + intBetween(0, ta.toleranceIDR);
  }

  poLines.push({
    lineId: `L-${String(i + 1).padStart(5, '0')}`,
    poNumber: `PO-${unit.id}-2609-${String(100000 + intBetween(1, 99999)).slice(0, 6)}`,
    poLine: intBetween(1, 8),
    unit: unit.id,
    vendorId: sku.vendorId,
    sku: sku.sku,
    qty: qtyFor(ta.contractPrice),
    uom,
    unitPrice,
    poDate: pick(WEEK_DAYS)
  });
}
write(`data/extracts/${WEEK_ID}/po-lines.json`, poLines);

// --- 12-week price history --------------------------------------------
// Compact: one row per unit+sku actually purchased, holding the weekly paid price.
const pairs = new Map();
for (const line of poLines) {
  const key = `${line.unit}|${line.sku}`;
  if (!pairs.has(key)) pairs.set(key, { unit: line.unit, sku: line.sku });
}
const priceHistory = [...pairs.values()].map(({ unit, sku }) => {
  const ta = taBySku.get(sku);
  const prices = [];
  for (let w = 0; w < HISTORY_WEEKS; w++) {
    prices.push(chance(0.06) ? Math.round(ta.contractPrice * between(1.1, 1.3)) : ta.contractPrice);
  }
  return { unit, sku, weeks: HISTORY_WEEKS, prices };
});
write(`data/extracts/${WEEK_ID}/price-history.json`, priceHistory);

// --- rebate ledger -----------------------------------------------------
// YTD purchase value per principal against their tier thresholds.
const rebateLedger = principals.map((p) => {
  const roll = rnd();
  const factor = roll < 0.2 ? between(1.55, 1.85)   // clear of tier 2
    : roll < 0.45 ? between(1.02, 1.28)             // past tier 1, chasing tier 2
      : between(0.72, 0.97);                        // short of tier 1
  return {
    vendorId: p.vendorId,
    ytdPurchaseIDR: Math.round((p.tier1TargetIDR * factor) / 1000000) * 1000000,
    weeksElapsed: 37,
    weeksRemaining: 15
  };
});
write(`data/extracts/${WEEK_ID}/rebate-ledger.json`, rebateLedger);

// --- usage lines -------------------------------------------------------
// 90-day purchased vs dispensed per unit+sku, for overstock / expiry exposure.
const usageLines = [...pairs.values()].map(({ unit, sku }) => {
  const price = skuById.get(sku).referencePrice;
  const weeklyUse = Math.max(1, Math.round(qtyFor(price) / 4));
  // High-cost items are ordered against named cases, so they do not sit overstocked.
  const overstocked = price < 2000000 && chance(0.06);
  const purchased = Math.round(weeklyUse * 13 * (overstocked ? between(1.7, 2.3) : between(0.95, 1.12)));
  const dispensed = Math.round(weeklyUse * 13 * (overstocked ? between(0.7, 0.95) : between(0.9, 1.0)));
  return {
    unit,
    sku,
    purchasedQty90d: purchased,
    dispensedQty90d: dispensed,
    onHandQty: Math.max(0, purchased - dispensed)
  };
});
write(`data/extracts/${WEEK_ID}/usage-lines.json`, usageLines);

// --- request log -------------------------------------------------------
// The monitor's own closure tracking from prior weeks: how many revision
// requests each unit was sent, how many it answered, and how fast.
const requestLog = units.map((u) => {
  const sent = intBetween(18, 54);
  const answered = Math.min(sent, Math.round(sent * between(0.74, 1.0)));
  return {
    unit: u.id,
    requestsSent: sent,
    requestsAnswered: answered,
    avgReplyDays: Number(between(1.1, 11.5).toFixed(1))
  };
});
write(`data/extracts/${WEEK_ID}/request-log.json`, requestLog);

console.log(`\n${poLines.length} PO lines · ${priceHistory.length} history pairs · ${vendorName.size} principals · week ${WEEK_ID}`);
