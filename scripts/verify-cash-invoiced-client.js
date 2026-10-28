// verify-cash-invoiced-client.js — v1.6.0 invoiced clients who pay cash.
//
// Run:  TZ=Europe/London node scripts/verify-cash-invoiced-client.js
// Prints ✓/✗ per check; exits non-zero on any failure.
//
// Guards against: an invoiced client switched to Cash silently losing every
// visit from the switch date onwards from its invoice — the queue then also
// counts the month as finished early, because no billable visit is left to
// come. The CONTROL check reproduces that with the cash rule
// (isBillableClientOnDate). Also guards the other half: the same client's
// money must stay out of Summary revenue, mileage, and Summary's unpaid and
// not-yet-generated invoice values; and a client who was cash and NOT
// invoiced in an old month must not grow a queue entry for it now.
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
  'monthKeysBetween', 'getClientCompletedOccurrencesInMonth', 'getInvoiceQueue', 'computeInvoiceFigures', 'invoiceDrift',
  'getUnpaidInvoicesTotal', 'invoiceBillableTotal', 'getUngeneratedInvoicesValue', 'getRevenueForRange',
  'getCashRevenueForRange', 'billableOccurrencesOnDate', 'isInEarlyInvoiceWindow'];
let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('✓ ' + msg); } else { fail++; console.log('✗ ' + msg); } }

const card = (o) => Object.assign({ clientType: 'domestic', vendorNumber: null, active: true, address: null,
  billingAddress: null, rateDurationHours: 1 }, o);
// H: invoiced commercial client, bank transfer to 30 Sep, cash from 1 Oct. £52.50 per 3h visit.
const H = { id: 'H', profileHistory: [
  { from: '2026-08-03', to: '2026-09-30', value: card({ name: 'H Ltd', clientType: 'commercial', paymentMethod: 'bank_transfer', isInvoiced: true, rateAmount: 52.5, rateDurationHours: 3 }) },
  { from: '2026-10-01', to: null, value: card({ name: 'H Ltd', clientType: 'commercial', paymentMethod: 'cash', isInvoiced: true, rateAmount: 52.5, rateDurationHours: 3 }) }] };
// L: cash and NOT invoiced in August; invoiced bank transfer from 1 Sep. £20/hr, 2h visits.
const L = { id: 'L', profileHistory: [
  { from: '2026-08-03', to: '2026-08-31', value: card({ name: 'L Person', paymentMethod: 'cash', isInvoiced: false, rateAmount: 20 }) },
  { from: '2026-09-01', to: null, value: card({ name: 'L Person', paymentMethod: 'bank_transfer', isInvoiced: true, rateAmount: 20 }) }] };
// Z: invoiced, bank transfer, £0 rate — never on an invoice.
const Z = { id: 'Z', profileHistory: [
  { from: '2026-08-03', to: null, value: card({ name: 'Z Friend', paymentMethod: 'bank_transfer', isInvoiced: true, rateAmount: 0 }) }] };
const tpl = (id, clientId, wk, day, hrs, from) => ({ id, type: 'template', template: wk, dayOfWeek: day, date: null,
  slotOrder: 1, clientId, durationHours: hrs, effectiveFrom: from, effectiveTo: null, cancelledDates: [] });
const APPTS = [
  tpl('h1', 'H', 'A', 'tue', 3, '2026-09-01'), tpl('h2', 'H', 'B', 'tue', 3, '2026-09-01'),
  tpl('h3', 'H', 'A', 'thu', 3, '2026-09-01'), tpl('h4', 'H', 'B', 'thu', 3, '2026-09-01'),
  tpl('l1', 'L', 'A', 'wed', 2, '2026-08-05'), tpl('l2', 'L', 'B', 'wed', 2, '2026-08-05'),
  tpl('z1', 'Z', 'A', 'mon', 2, '2026-08-03'), tpl('z2', 'Z', 'B', 'mon', 2, '2026-08-03')];

function mkCtx(today, invoices) {
  const ctx = {
    console, Math, Object, Set, String, Date, JSON,
    DAY_KEYS: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    appState: { clients: [H, L, Z], appointments: APPTS, invoices: invoices || [],
      settings: { weekAbReferenceMonday: '2026-08-03', holidays: [], dismissedQueueEntries: [] } },
    getLocalToday: () => today, EARLY_INVOICE_WINDOW_DAYS: 10,
  };
  vm.createContext(ctx);
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return ctx;
}
const q = (c) => c.getInvoiceQueue().map(e => e.clientId + '|' + e.monthKey);

// CONTROL — the cash rule alone drops every October visit from H's invoice.
let c = mkCtx('2026-10-30');
const octDates = []; for (let d = 1; d <= 31; d++) octDates.push(`2026-10-${String(d).padStart(2, '0')}`);
const hOct = octDates.filter(d => c.getOccurrencesForDate(d).some(a => a.clientId === 'H'));
ok(hOct.length === 9, 'fixture: H has 9 October visits (Tue 6/13/20/27, Thu 1/8/15/22/29)');
ok(hOct.filter(d => c.isBillableClientOnDate(H, d)).length === 0, 'CONTROL: the cash rule would leave all 9 off the invoice');

// Invoices — all visits, payment method ignored
let e = c.getInvoiceQueue().find(x => x.clientId === 'H' && x.monthKey === '2026-10');
ok(e && e.occurred.length === 9 && e.totalHours === 27, 'H October queue entry carries all 9 cash-period visits (27h)');
ok(c.computeInvoiceFigures('H', '2026-10').total === 472.5, 'H October invoice figures £472.50 (9 × £52.50)');
ok(c.computeInvoiceFigures('H', '2026-09').lineItems.length === 9, 'H September (bank transfer) unchanged: 9 lines');

// Month-complete still waits for the last visit, cash or not (21 Oct is the
// day before v1.7.0's early-invoicing window opens)
let early = mkCtx('2026-10-21');
const g = early.getClientCompletedOccurrencesInMonth('H', '2026-10');
ok(g.occurred.length === 6 && g.hasFuture === true, 'on 21 Oct: 6 visits done, 22/27/29 Oct still to come');
ok(!q(early).includes('H|2026-10'), '…so October is NOT offered before the month is finished');

// Invoiced-at-the-date, not today's card
ok(!q(c).includes('L|2026-08'), 'L (cash, not invoiced in August) gets no August queue entry now it is invoiced');
ok(q(c).includes('L|2026-09') && q(c).includes('L|2026-10'), 'L gets September and October (invoiced, bank)');
ok(!q(c).some(k => k.startsWith('Z|')), 'Z (£0 rate) never reaches the queue');

// Drift: a Ready invoice generated under the cash rule is flagged for update
const stale = { id: 'i3', clientId: 'H', periodKey: '2026-10', status: 'ready', total: 210,
  lineItems: ['2026-10-01', '2026-10-06', '2026-10-08', '2026-10-13'].map(d => ({ date: d, hours: 3, rate: 17.5, total: 52.5 })) };
c = mkCtx('2026-10-30', [stale]);
const dr = c.invoiceDrift(stale);
ok(dr && dr.total === 472.5 && dr.lineItems.length === 9 && dr.delta === 262.5, 'a 4-line Ready invoice for H October shows drift +£262.50 → 9 lines');

// Summary stays cash-free
ok(c.getRevenueForRange('2026-10-01', '2026-10-31') === 160, 'October revenue £160 — L only (4 × £40), H excluded');
ok(c.getCashRevenueForRange('2026-10-01', '2026-10-31') === 472.5, 'H counts in the cash revenue line instead (£472.50)');
ok(c.getRevenueForRange('2026-09-01', '2026-09-30') === 472.5 + 200, 'September revenue includes H while it was bank transfer');
ok(!c.billableOccurrencesOnDate('2026-10-01').some(a => a.clientId === 'H'), 'mileage leaves out H from 1 Oct');
ok(c.billableOccurrencesOnDate('2026-09-29').some(a => a.clientId === 'H'), '…but still counts H on 29 Sep');
ok(c.getUngeneratedInvoicesValue('2026-10-01', '2026-10-31') === 160, 'not-yet-generated value leaves out H\'s queued October (L\'s £160 only)');

const sept = { id: 'i2', clientId: 'H', periodKey: '2026-09', status: 'outstanding', total: 472.5,
  lineItems: [{ date: '2026-09-29', hours: 3, rate: 17.5, total: 52.5 }] };
const oct = Object.assign({}, stale, { total: 472.5, lineItems: dr.lineItems });
c = mkCtx('2026-10-30', [sept, oct]);
ok(c.getUnpaidInvoicesTotal('2026-09-01', '2026-10-31') === 472.5, 'unpaid total counts H\'s September invoice in full and its October one not at all');
const mixed = { clientId: 'H', total: 105, lineItems: [{ date: '2026-09-29', total: 52.5 }, { date: '2026-10-01', total: 52.5 }] };
ok(c.invoiceBillableTotal(mixed) === 52.5, 'an invoice straddling the switch counts only its bank-transfer line');
ok(c.invoiceBillableTotal(sept) === 472.5, 'an invoice with no cash line returns its stored total untouched');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
