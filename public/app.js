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

function renderError(containerId, error) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<p class="page-desc">Could not load data: ${error.message}</p>`;
}

document.addEventListener('DOMContentLoaded', hydrateNav);
