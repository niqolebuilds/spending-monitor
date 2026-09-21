// The "notify" step: drafts the PO revision request a confirmed finding produces.
// Read-only against Outlook — this renders the draft, a person sends it.
import { formatIDR } from './money.js';

const ROUTING = {
  price: { role: 'Purchasing', cc: ['Finance Controller'] },
  expired: { role: 'Purchasing', cc: ['Sourcing & Procurement'] },
  formulary: { role: 'Pharmacy', cc: ['Finance Controller'] },
  bpjs: { role: 'Pharmacy', cc: ['Casemix & Claims'] },
  uom: { role: 'Purchasing', cc: [] },
  usage: { role: 'Pharmacy', cc: ['Logistics'] },
  rebate: { role: 'Sourcing & Procurement', cc: ['Head Office Finance'] }
};

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const LONG_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function displayDue(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${LONG_MONTHS[Number(m) - 1]} ${y}`;
}

export function draftRevision(exception, { asOf, slaDays = 5, weekId = '' } = {}) {
  const routing = ROUTING[exception.type] ?? { role: 'Purchasing', cc: [] };
  const isGroup = exception.unit === 'GROUP';
  const dueDate = addDays(asOf, slaDays);

  const recovery = exception.savingsRaw > 0
    ? `Recoverable value: ${formatIDR(exception.savingsRaw)}.`
    : 'No recovery is claimed on this line — this is a compliance and data-quality action.';

  const subject = isGroup
    ? `[Spend Monitor ${weekId}] ${exception.issue} — ${exception.vendor}`
    : `[Spend Monitor ${weekId}] ${exception.issue} — ${exception.unit} ${exception.poNumber}`;

  const body = [
    `To: ${isGroup ? routing.role : `${exception.unit} ${routing.role}`}`,
    routing.cc.length ? `Cc: ${routing.cc.join(', ')}` : null,
    '',
    `The weekly spend compliance scan flagged the following for your review.`,
    '',
    `Item:        ${exception.item}`,
    `Vendor:      ${exception.vendor}`,
    isGroup ? null : `Reference:   ${exception.poNumber} line ${exception.poLine} (${exception.poDate})`,
    `Value:       ${exception.amount}`,
    '',
    `FINDING`,
    exception.finding,
    '',
    `BENCHMARK`,
    exception.trendNote,
    '',
    `LIKELY CAUSE`,
    exception.rootCause,
    '',
    `REQUESTED ACTION`,
    exception.suggestedAction,
    recovery,
    '',
    `Please respond by ${displayDue(dueDate)} (${slaDays} working days).`,
    `Reply to this request in the Unit Inbox so closure is tracked against the weekly scan.`,
    '',
    `— Spend Compliance & Savings Monitor, Head Office Finance`
  ].filter((line) => line !== null).join('\n');

  return {
    id: `REQ-${exception.id}`,
    exceptionId: exception.id,
    unit: exception.unit,
    to: isGroup ? routing.role : `${exception.unit} ${routing.role}`,
    cc: routing.cc,
    subject,
    body,
    dueDate,
    dueDateDisplay: displayDue(dueDate),
    slaDays,
    channel: 'outlook',
    status: exception.status === 'approved' ? 'ready-to-send' : 'draft'
  };
}
