import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseRecords } from '../src/csv.js';

test('splits plain rows', () => {
  assert.deepEqual(parseCSV('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('handles quoted fields containing commas and newlines', () => {
  const rows = parseCSV('sku,name\nSKU-1,"Stent, drug-eluting"\nSKU-2,"Two\nlines"\n');
  assert.deepEqual(rows[1], ['SKU-1', 'Stent, drug-eluting']);
  assert.deepEqual(rows[2], ['SKU-2', 'Two\nlines']);
});

test('unescapes doubled quotes', () => {
  assert.deepEqual(parseCSV('a\n"he said ""hi"""\n')[1], ['he said "hi"']);
});

test('tolerates CRLF line endings', () => {
  assert.deepEqual(parseCSV('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('strips a UTF-8 BOM so the first header is not mangled', () => {
  const records = parseRecords('﻿sku,qty\nSKU-1,5\n');
  assert.deepEqual(Object.keys(records[0]), ['sku', 'qty']);
  assert.equal(records[0].sku, 'SKU-1');
});

test('keeps a trailing field and a final row without a newline', () => {
  assert.deepEqual(parseCSV('a,b\n1,'), [['a', 'b'], ['1', '']]);
});

test('skips fully blank lines', () => {
  assert.equal(parseRecords('a,b\n1,2\n\n3,4\n').length, 2);
});

test('records keep values as strings, preserving leading zeros', () => {
  const [record] = parseRecords('sku,qty\n0012345,5\n');
  assert.equal(record.sku, '0012345', 'a leading zero must survive the reader');
  assert.equal(typeof record.qty, 'string');
});
