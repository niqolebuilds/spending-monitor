// A drop folder of CSV exports. This is the adapter a scheduled ERP export
// feeds, and the one docs/data-contract.md describes to the IT team.
//
//   <dataDir>/masters/{units,formulary,trade-agreements,principals}.csv
//   <dataDir>/<periodId>/{po-lines,rebate-ledger,usage-lines,request-log}.csv
//   <dataDir>/<periodId>/price-history.csv   (optional: unit,sku,prices pipe-separated)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseRecords } from '../csv.js';
import { parseAmount } from './contract.js';

function readCSV(dir, name, { required = true } = {}) {
  const file = path.join(dir, `${name}.csv`);
  if (!existsSync(file)) {
    if (required) throw new Error(`missing required export: ${file}`);
    return [];
  }
  return parseRecords(readFileSync(file, 'utf8'));
}

// Masters carry a few typed fields the rules depend on; everything else stays
// as the string it arrived as.
const asBool = (value) => /^(true|yes|y|1)$/i.test(String(value ?? '').trim());
const asNum = (value) => (parseAmount(value).ok ? parseAmount(value).value : 0);

export default function createFilesSource(config) {
  const dataDir = config.dataDir ?? path.join(process.cwd(), 'data', 'inbox');

  return {
    id: 'files',
    synthetic: false,
    describe: () => `CSV exports from ${dataDir}`,

    async listPeriods() {
      if (!existsSync(dataDir)) return [];
      return readdirSync(dataDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== 'masters')
        .map((entry) => entry.name)
        .sort();
    },

    async loadMasters() {
      const dir = path.join(dataDir, 'masters');
      return {
        units: readCSV(dir, 'units').map((r) => ({ ...r, beds: asNum(r.beds) })),
        formulary: readCSV(dir, 'formulary').map((r) => ({
          ...r,
          bpjsCovered: asBool(r.bpjsCovered),
          locked: asBool(r.locked),
          equivalentSku: r.equivalentSku || null,
          referencePrice: asNum(r.referencePrice)
        })),
        tradeAgreements: readCSV(dir, 'trade-agreements').map((r) => ({
          ...r,
          contractPrice: asNum(r.contractPrice),
          toleranceIDR: asNum(r.toleranceIDR)
        })),
        principals: readCSV(dir, 'principals').map((r) => ({
          ...r,
          rebatePct: asNum(r.rebatePct),
          tier1TargetIDR: asNum(r.tier1TargetIDR),
          tier2TargetIDR: asNum(r.tier2TargetIDR)
        }))
      };
    },

    async loadExtract(periodId) {
      const dir = path.join(dataDir, periodId);
      if (!existsSync(dir)) throw new Error(`no export folder for period ${periodId} in ${dataDir}`);

      return {
        weekId: periodId,
        poLines: readCSV(dir, 'po-lines'),
        rebateLedger: readCSV(dir, 'rebate-ledger'),
        usageLines: readCSV(dir, 'usage-lines'),
        requestLog: readCSV(dir, 'request-log', { required: false }),
        priceHistory: readCSV(dir, 'price-history', { required: false }).map((r) => ({
          unit: r.unit,
          sku: r.sku,
          prices: String(r.prices ?? '').split('|').filter(Boolean).map(asNum)
        }))
      };
    }
  };
}
