// Every *.rule.js in this directory is discovered and loaded automatically.
// Adding process #11 is a new file here — never an edit to a switch statement.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RULES_DIR = path.dirname(fileURLToPath(import.meta.url));

export const REQUIRED_RULE_KEYS = [
  'id', 'dataset', 'type', 'issue', 'badgeClass', 'severity', 'savingsCategory',
  'priority', 'identity', 'applies', 'evaluate'
];

export const REQUIRED_HIT_KEYS = [
  'amountRaw', 'savingsRaw', 'metrics', 'finding', 'trendNote', 'rootCause', 'suggestedAction'
];

export function ruleFiles() {
  return readdirSync(RULES_DIR).filter((f) => f.endsWith('.rule.js')).sort();
}

export async function loadRules() {
  const rules = [];
  for (const file of ruleFiles()) {
    const mod = await import(pathToFileURL(path.join(RULES_DIR, file)).href);
    const rule = mod.default;
    const missing = REQUIRED_RULE_KEYS.filter((k) => rule?.[k] === undefined);
    if (missing.length) throw new Error(`${file}: rule is missing ${missing.join(', ')}`);
    rules.push(rule);
  }
  return rules;
}
