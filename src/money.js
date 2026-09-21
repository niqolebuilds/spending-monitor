// The only place IDR display strings are produced.

export function formatIDR(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}Rp ${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) {
    const millions = abs / 1e6;
    // 999,950,000+ rounds to "1000.0M", which reads wrong — promote to B.
    if (millions >= 999.95) return `${sign}Rp ${(abs / 1e9).toFixed(2)}B`;
    return `${sign}Rp ${millions.toFixed(1)}M`;
  }
  return `${sign}Rp ${Math.round(abs).toLocaleString('en-US')}`;
}

export function formatIDRFull(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}Rp ${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
}

export function pct(a, b, digits = 1) {
  if (!b) return 0;
  return Number(((a / b) * 100).toFixed(digits));
}
