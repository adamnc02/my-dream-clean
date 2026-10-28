// verify-early-invoice-window.js — v1.7.0 early invoicing in the last 10 days of the month.
//
// Run:  TZ=Europe/London node scripts/verify-early-invoice-window.js
// Prints ✓/✗ per check; exits non-zero on any failure.
//
// Guards against: (1) the window opening on the wrong day — it is the last 10
// days of THAT month, so the 22nd of October but the 19th of a 28-day
// February; (2) an invoice generated early immediately reading as "changed"
// because its figures counted only visits that had already happened — the
// CONTROL check reproduces that with an occurred-only total; (3) a future
// visit cancelled after generating going unnoticed — drift must fire, and the
// Cancel/Delete confirm must say a new invoice is needed; (4) Summary's
// not-yet-generated value counting visits that have not happened yet.
//
// It runs the REAL functions, extracted by name from index.html's inline
// scripts, against synthetic clients and a pinned "today" — no browser.
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
function extract(name) {
  const re = new RegExp('(^|\\n)(async )?function ' + name + '\\s*\\(');
  const m = re.exec(src); if (!m) throw new Error('missing ' + name);
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) { const c = src[j]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break; } }
  return src.slice(m.index, j + 1);
}
const names = ['toLocalDateStr', 'parseLocalDateStr', 'addDays', 'compareDateStr', 'getDayOfWeekKey', 'isNonWorkingDay',
  'getMondayOfWeek', 'getWeekLetter', 'effectiveSlotOrder', 'getOccurrencesForDate', 'isHolidayDate',
  'resolveVersionedValue', 'clientSnapshotOn', 'clientCurrentSnapshot', 'effectiveHourlyRate', 'roundUpToNearestTenPence',
  'isBillableClientOnDate', 'isInvoiceableClientOnDate', 'invoicableClients', 'getClientEarliestPossibleDate',
  'monthKeysBetween', 'getClientCompletedOccurrencesInMonth', 'isInEarlyInvoiceWindow', 'getInvoiceQueue',
  'computeInvoiceFigures', 'invoiceDrift', 'getUngeneratedInvoicesValue', 'upcomingInvoiceWarning',
  'upcomingVisitsNoteHtml', 'invoiceUpcomingHtml', 'formatDateUK'];
let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('✓ ' + msg); } else { fail++; console.log('✗ ' + msg); } }

const card = (name) => ({ name, clientType: 'domestic', vendorNumber: null, active: true, address: null, billingAddress: null,
  paymentMethod: 'bank_transfer', isInvoiced: true, rateAmount: 20, rateDurationHours: 1 });
// C: Mon + Wed every week, 2h at £20/hr. October: Mon 5/12/19/26, Wed 7/14/21/28 (1 Oct is a Thursday).
const C = { id: 'C', profileHistory: [{ from: '2026-08-03', to: null, value: card('C Person') }] };
// F: a single one-off on Fri 30 Oct, 3h.
const F = { id: 'F', profileHistory: [{ from: '2026-08-03', to: null, value: card('F Person') }] };
const tpl = (id, wk, day) => ({ id, type: 'template', template: wk, dayOfWeek: day, date: null, slotOrder: 1,
  clientId: 'C', durationHours: 2, effectiveFrom: '2026-09-01', effectiveTo: null, cancelledDates: [] });
const fresh = () => [tpl('c1', 'A', 'mon'), tpl('c2', 'B', 'mon'), tpl('c3', 'A', 'wed'), tpl('c4', 'B', 'wed'),
  { id: 'f1', type: 'adhoc', template: null, dayOfWeek: null, date: '2026-10-30', clientId: 'F', durationHours: 3,
    slotOrder: 1, effectiveFrom: null, effectiveTo: null, cancelledDates: [] }];

function mkCtx(today, invoices, appts) {
  const ctx = {
    console, Math, Object, Set, String, Date, JSON,
    DAY_KEYS: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], EARLY_INVOICE_WINDOW_DAYS: 10,
    appState: { clients: [C, F], appointments: appts || fresh(), invoices: invoices || [],
      settings: { weekAbReferenceMonday: '2026-08-03', holidays: [], dismissedQueueEntries: [] } },
    getLocalToday: () => today,
  };
  vm.createContext(ctx);
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return ctx;
}
const entry = (c, id, mk) => c.getInvoiceQueue().find(e => e.clientId === id && e.monthKey === mk);

// 1 — the window is the last 10 days of THAT month
let c = mkCtx('2026-10-22');
ok(!c.isInEarlyInvoiceWindow('2026-10-21') && c.isInEarlyInvoiceWindow('2026-10-22') && c.isInEarlyInvoiceWindow('2026-10-31'), 'October (31 days): opens on the 22nd');
ok(!c.isInEarlyInvoiceWindow('2026-04-20') && c.isInEarlyInvoiceWindow('2026-04-21'), 'April (30 days): opens on the 21st');
ok(!c.isInEarlyInvoiceWindow('2027-02-18') && c.isInEarlyInvoiceWindow('2027-02-19'), 'February 2027 (28 days): opens on the 19th');

// 2 — before the window: unchanged, nothing offered for the current month
let before = mkCtx('2026-10-21');
ok(!entry(before, 'C', '2026-10') && !entry(before, 'F', '2026-10'), '21 Oct: October not offered yet (window shut)');
ok(entry(before, 'C', '2026-09'), '21 Oct: September (finished) still offered as before');

// 3 — inside the window: offered, with the visits still to come
const e = entry(c, 'C', '2026-10');
ok(e && e.occurred.length === 6 && e.upcoming.map(o => o.date).join() === '2026-10-26,2026-10-28', '22 Oct: C October offered — 6 done, 26 + 28 Oct still to come');
ok(e && e.totalHours === 16, '…totalling 16h, still-to-come visits included');
const fig = c.computeInvoiceFigures('C', '2026-10');
ok(fig.lineItems.length === 8 && fig.total === 320, '…and the invoice figures cover all 8 visits, £320');
ok(entry(c, 'F', '2026-10') && entry(c, 'F', '2026-10').upcoming.length === 1, 'F (only visit 30 Oct) is offered too — every visit still to come');
ok(!c.getInvoiceQueue().some(x => x.monthKey === '2026-11'), 'next month is never offered');
ok(c.getUngeneratedInvoicesValue('2026-10-01', '2026-10-31') === 240, 'Summary not-yet-generated counts only the 6 visits done (£240), not 26/28/30 Oct');
ok(c.upcomingVisitsNoteHtml(e.upcoming.map(o => o.date), false).includes('26 Oct 2026, 28 Oct 2026'), 'queue row note lists the dates still to come');

// 4 — generated early: matches at once; CONTROL shows why figures must include upcoming
const inv = { id: 'i1', invoiceNumber: 'C Person - 2026-27-004', clientId: 'C', periodKey: '2026-10', status: 'ready',
  lineItems: fig.lineItems, total: fig.total };
c = mkCtx('2026-10-22', [inv]);
ok(c.invoiceDrift(inv) === null, 'an early-generated invoice shows no drift straight away');
const occurredOnly = c.getClientCompletedOccurrencesInMonth('C', '2026-10').occurred.reduce((s, o) => s + o.hours * 20, 0);
ok(occurredOnly !== inv.total, 'CONTROL: counting only visits already done (£' + occurredOnly + ') would flag it as changed at once');
ok(!entry(c, 'C', '2026-10'), '…and its period leaves the queue once generated');
ok(c.invoiceUpcomingHtml(inv).includes('2 visits still to come'), 'the generated invoice row says 2 visits still to come');
ok(mkCtx('2026-10-28', [inv]).invoiceUpcomingHtml(inv) === '', 'that note disappears once the last listed date has arrived');

// 5 — a future visit cancelled after generating
const appts = fresh(); appts.find(a => a.id === 'c1').cancelledDates.push('2026-10-26');
c = mkCtx('2026-10-23', [inv], appts);
const d = c.invoiceDrift(inv);
ok(d && d.lineItems.length === 7 && d.delta === -40, 'cancelling 26 Oct after generating → drift: 7 lines, −£40');
c = mkCtx('2026-10-23', [inv]);
ok(c.upcomingInvoiceWarning('C', '2026-10-26', false).includes('Update'), 'Cancel confirm on 26 Oct (unsent invoice) says a new invoice is needed — Update');
const sent = Object.assign({}, inv, { status: 'outstanding' });
ok(mkCtx('2026-10-23', [sent]).upcomingInvoiceWarning('C', '2026-10-26', false).includes('void it and re-issue'), '…and once sent, says void and re-issue');
ok(c.upcomingInvoiceWarning('C', '2026-11-02', false) === '', 'a date not on any invoice adds nothing to the confirm');
ok(c.upcomingInvoiceWarning('C', '2026-10-27', true).includes(inv.invoiceNumber), 'deleting the slot from 27 Oct (28 Oct still on the invoice) warns too');
ok(mkCtx('2026-10-23', [Object.assign({}, inv, { status: 'void' })]).upcomingInvoiceWarning('C', '2026-10-26', false) === '', 'a void invoice never triggers the warning');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
