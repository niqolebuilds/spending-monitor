// Minimal RFC4180 reader: quoted fields, embedded commas and newlines, CRLF,
// and a BOM. Every value comes back as a string — coercion happens in the
// contract layer, because Excel turning "0012345" into 12345 is exactly the
// kind of damage that later shows up as an unmatched SKU.

export function parseCSV(input) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (text[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }

  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseRecords(input) {
  const rows = parseCSV(input).filter((row) => row.some((cell) => cell.trim() !== ''));
  if (!rows.length) return [];

  const header = rows[0].map((name) => name.trim());
  return rows.slice(1).map((cells) => {
    const record = {};
    header.forEach((name, i) => { record[name] = (cells[i] ?? '').trim(); });
    return record;
  });
}
