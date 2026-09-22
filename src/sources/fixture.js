// The committed synthetic extract. This is demo data, and it says so — the
// provenance banner reads `trusted: false` so nobody reviews generated findings
// believing they came from the ERP.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../load.js';

const read = (...segments) => JSON.parse(readFileSync(path.join(ROOT, ...segments), 'utf8'));

export default function createFixtureSource() {
  const extractsDir = path.join(ROOT, 'data', 'extracts');

  return {
    id: 'fixture',
    synthetic: true,
    describe: () => 'Committed sample extract — synthetic demo data, not from the ERP',

    async listPeriods() {
      if (!existsSync(extractsDir)) return [];
      return readdirSync(extractsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    },

    async loadMasters() {
      return {
        units: read('data', 'masters', 'units.json'),
        formulary: read('data', 'masters', 'formulary.json'),
        tradeAgreements: read('data', 'masters', 'trade-agreements.json'),
        principals: read('data', 'masters', 'principals.json')
      };
    },

    async loadExtract(periodId) {
      return {
        weekId: periodId,
        poLines: read('data', 'extracts', periodId, 'po-lines.json'),
        rebateLedger: read('data', 'extracts', periodId, 'rebate-ledger.json'),
        usageLines: read('data', 'extracts', periodId, 'usage-lines.json'),
        priceHistory: read('data', 'extracts', periodId, 'price-history.json'),
        requestLog: read('data', 'extracts', periodId, 'request-log.json')
      };
    }
  };
}
