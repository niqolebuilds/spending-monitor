#!/usr/bin/env node
// Writes the current fixture out as CSV in exactly the layout the files source
// reads. Doubles as the worked example to hand IT alongside docs/data-contract.md.
// Usage: node scripts/export-csv.js [targetDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import createFixtureSource from '../src/sources/fixture.js';

const target = process.argv[2] ?? path.join(process.cwd(), 'data', 'inbox');
const source = createFixtureSource({});

function toCSV(rows) {
  if (!rows.length) return '';
  const header = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header.join(','), ...rows.map((row) => header.map((key) => escape(row[key])).join(','))].join('\n') + '\n';
}

const write = (dir, name, rows) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.csv`), toCSV(rows));
  console.log(`wrote ${path.relative(process.cwd(), path.join(dir, `${name}.csv`))} (${rows.length} rows)`);
};

const masters = await source.loadMasters();
const mastersDir = path.join(target, 'masters');
write(mastersDir, 'units', masters.units);
write(mastersDir, 'formulary', masters.formulary);
write(mastersDir, 'trade-agreements', masters.tradeAgreements);
write(mastersDir, 'principals', masters.principals);

for (const periodId of await source.listPeriods()) {
  const extract = await source.loadExtract(periodId);
  const dir = path.join(target, periodId);
  write(dir, 'po-lines', extract.poLines);
  write(dir, 'rebate-ledger', extract.rebateLedger);
  write(dir, 'usage-lines', extract.usageLines);
  write(dir, 'request-log', extract.requestLog);
  // Price history carries a list per row; the CSV form joins it with pipes.
  write(dir, 'price-history', extract.priceHistory.map((row) => ({
    unit: row.unit, sku: row.sku, prices: row.prices.join('|')
  })));
}

console.log(`\nCSV export written to ${target}`);
