// Shared across every page: one fetch helper, one toast, one nav badge.
// Loaded before each page's own script, which calls these as globals.

async function fetchJSON(url, options) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options?.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// The pending count used to be the literal "20" typed into four files.
function setPendingBadge(count) {
  document.querySelectorAll('.nav-badge').forEach((el) => { el.textContent = count; });
}

async function hydrateNav() {
  try {
    const { pendingCount } = await fetchJSON('/api/exceptions?status=pending');
    setPendingBadge(pendingCount);
  } catch {
    setPendingBadge('–');
  }
}

// Every page states its data's origin. Synthetic sample data is called out in
// amber; a source with nothing accepted blocks in rose rather than quietly
// showing something else.
async function hydrateProvenance() {
  const bar = document.createElement('div');
  bar.className = 'provenance-bar';
  const nav = document.querySelector('.app-nav');
  if (!nav) return;
  nav.insertAdjacentElement('afterend', bar);

  try {
    const p = await fetchJSON('/api/provenance');
    if (p.synthetic) bar.classList.add('synthetic');
    bar.innerHTML = `
      <b>${p.synthetic ? 'Sample data — not from the ERP.' : 'Source:'}</b>
      <span>${p.sourceLabel}</span>
      <span>· period <b>${p.periodId}</b></span>
      <span>· <code>${p.checksum}</code></span>
      <span>· ${p.totals.accepted} of ${p.totals.read} rows accepted${p.totals.joinIssues ? `, ${p.totals.joinIssues} unmatched` : ''}</span>
      <a href="ingest.html" style="margin-left:auto;font-weight:600;">Data review →</a>`;
  } catch (err) {
    bar.classList.add('blocked');
    bar.innerHTML = `<b>No data accepted.</b><span>${err.message}</span>
      <a href="ingest.html" style="margin-left:auto;font-weight:600;">Go to data review →</a>`;
  }
}

function renderError(containerId, error) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<p class="page-desc">Could not load data: ${error.message}</p>`;
}

document.addEventListener('DOMContentLoaded', () => {
  hydrateNav();
  hydrateProvenance();
});
