import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CURRENT_WEEK = '2026-W38';
export const AS_OF = '2026-09-21';

const readJSON = (...segments) => JSON.parse(readFileSync(path.join(ROOT, ...segments), 'utf8'));

export function loadMasters() {
  return {
    units: readJSON('data', 'masters', 'units.json'),
    formulary: readJSON('data', 'masters', 'formulary.json'),
    tradeAgreements: readJSON('data', 'masters', 'trade-agreements.json'),
    principals: readJSON('data', 'masters', 'principals.json')
  };
}

export function loadExtract(weekId = CURRENT_WEEK) {
  return {
    weekId,
    poLines: readJSON('data', 'extracts', weekId, 'po-lines.json'),
    rebateLedger: readJSON('data', 'extracts', weekId, 'rebate-ledger.json'),
    usageLines: readJSON('data', 'extracts', weekId, 'usage-lines.json'),
    priceHistory: readJSON('data', 'extracts', weekId, 'price-history.json'),
    requestLog: readJSON('data', 'extracts', weekId, 'request-log.json')
  };
}

export function loadSettings() {
  // L2: every finding is analyst-confirmed. thresholdIDR and autoDispatch are the
  // L3 seam — read by the gate that drops in when supervised mode is switched on.
  return { mode: 'L2', thresholdIDR: 25000000, autoDispatch: false, slaDays: 5 };
}
