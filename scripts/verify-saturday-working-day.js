// verify-saturday-working-day.js — v1.8.0 Saturday as a full working day.
//
// Run:  TZ=Europe/London node scripts/verify-saturday-working-day.js
// Prints ✓/✗ per check; exits non-zero on any failure.
//
// Guards against: Saturday being opened in the Diary but still treated as a
// "weekend" somewhere else. The old weekday gate lived in one helper plus
// three Mon–Fri loops, and every money path (invoice queue, Summary revenue,
// mileage) skipped weekend dates — so a Saturday visit could show in the
// Diary yet never be invoiced or counted. The CONTROL check reproduces that
// with the old Sat+Sun rule. Also guards: a new Saturday booking becomes a
// recurring A/B slot like any weekday; Sunday stays the one non-working day;
// Home steps Fri → Sat → Mon.
//
// It runs the REAL functions, extracted by name from index.html's inline
// scripts, against a stub DOM and a pinned "today" — no browser.
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
  'getMondayOfWeek', 'getWeekLetter', 'effectiveSlotOrder', 'getOccurrencesForDate', 'cancelledOccurrencesForDate',
  'isHolidayDate', 'isPastDate', 'emptySlotCount', 'formatHours', 'formatHoursShort', 'escapeHtml',
  'resolveVersionedValue', 'clientSnapshotOn', 'clientCurrentSnapshot', 'effectiveHourlyRate', 'roundUpToNearestTenPence',
  'isBillableClientOnDate', 'isInvoiceableClientOnDate', 'getClientCompletedOccurrencesInMonth', 'getRevenueForRange',
  'billableOccurrencesOnDate', 'dayUsedHours', 'weekTotalHours', 'renderDiaryWeek', 'homeShiftDay', 'homePickDate',
  'saveAppointment', 'templateResolvesToSingleDate', 'applyHistoricOccurrenceCorrection'];
let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('✓ ' + msg); } else { fail++; console.log('✗ ' + msg); } }

const C = { id: 'C', profileHistory: [{ from: '2026-08-03', to: null, value: { name: 'C Person', clientType: 'domestic',
  active: true, address: null, paymentMethod: 'bank_transfer', isInvoiced: true, rateAmount: 20, rateDurationHours: 1 } }] };
// A Week-A Saturday slot (2h) and a Sunday one-off (1h). 31 Oct 2026 is a Week-A Saturday.
const fixture = () => [
  { id: 'sat', type: 'template', template: 'A', dayOfWeek: 'sat', date: null, slotOrder: 1, clientId: 'C',
    durationHours: 2, effectiveFrom: '2026-10-01', effectiveTo: null, cancelledDates: [] },
  { id: 'sun', type: 'adhoc', template: null, dayOfWeek: null, date: '2026-11-01', slotOrder: 1, clientId: 'C',
    durationHours: 1, effectiveFrom: null, effectiveTo: null, cancelledDates: [] }];

function mkCtx(today) {
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', style: {} });
  const ctx = {
    console, Math, Object, Set, String, Date, JSON, parseFloat, isNaN, Promise,
    DAY_KEYS: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    appState: { clients: [C], appointments: fixture(), invoices: [],
      settings: { weekAbReferenceMonday: '2026-08-03', holidays: [] } },
    document: { getElementById: el, createElement: () => ({ set textContent(v) { this.innerHTML = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;'); } }) },
    getLocalToday: () => today,
    uuid: (() => { let n = 0; return () => 'new' + (++n); })(),
    persistAppointments: () => ({ then: f => f() }),
    closeModal: () => {}, alert: () => {}, renderHome: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(names.map(extract).join('\n') +
    '\nlet diaryWeekMonday=null, homeSelectedDate=null, _editingAppointmentId=null, _apptModalCtx={};' +
    '\nthis.setDiary=d=>{diaryWeekMonday=d;}; this.setHome=d=>{homeSelectedDate=d;}; this.home=()=>homeSelectedDate;' +
    '\nthis.setAdd=(d)=>{_editingAppointmentId=null;_apptModalCtx={date:d,refresh:()=>{}};};', ctx);
  ctx.el = el;
  return ctx;
}

let c = mkCtx('2026-10-26'); // Monday of the week containing Sat 31 Oct
// 1 — the working week
ok(!c.isNonWorkingDay('2026-10-31') && c.isNonWorkingDay('2026-11-01') && !c.isNonWorkingDay('2026-10-26'), 'Saturday is a working day; Sunday is not; Monday is');

// 2 — Diary: six columns, Saturday included
c.setDiary('2026-10-26'); c.renderDiaryWeek();
const gridHtml = c.el('diary-grid').innerHTML;
ok((gridHtml.match(/class="diary-day-col /g) || []).length === 6, 'Diary renders 6 day columns (Mon–Sat)');
ok(gridHtml.includes("'2026-10-31'") && !gridHtml.includes("'2026-11-01'"), '…with Saturday 31 Oct and no Sunday');
ok(gridHtml.includes('C Person'), 'the Saturday slot shows its client');
ok(c.el('diary-week-total').textContent.startsWith('2'), 'the week total counts the Saturday 2h');
ok(c.weekTotalHours('2026-10-26') === 2, 'weekTotalHours includes Saturday');

// 3 — Saturday template resolves like a weekday (A/B), Sunday stays ad-hoc only
ok(c.getOccurrencesForDate('2026-10-31').length === 1, 'Week-A Saturday slot appears on Sat 31 Oct');
ok(c.getOccurrencesForDate('2026-11-07').length === 0, '…and not on Sat 7 Nov (Week B)');
ok(c.getOccurrencesForDate('2026-11-01').length === 1, 'a Sunday one-off still resolves on its date');

// 4 — money paths count Saturday; CONTROL with the old Sat+Sun rule
c = mkCtx('2026-11-02');
const nov = c.getClientCompletedOccurrencesInMonth('C', '2026-10');
ok(nov.occurred.some(o => o.date === '2026-10-31'), 'invoice queue includes the Saturday visit');
ok(c.getRevenueForRange('2026-10-31', '2026-10-31') === 40, 'Summary revenue counts Saturday (£40)');
ok(c.billableOccurrencesOnDate('2026-10-31').length === 1, 'mileage includes the Saturday stop');
ok(c.getRevenueForRange('2026-11-01', '2026-11-01') === 0, 'Sunday still excluded from revenue');
vm.runInContext("isNonWorkingDay = function (d) { const k = getDayOfWeekKey(d); return k === 'sat' || k === 'sun'; };", c);
ok(c.getRevenueForRange('2026-10-31', '2026-10-31') === 0 && c.getOccurrencesForDate('2026-10-31').length === 0,
  'CONTROL: the old Sat+Sun rule drops the Saturday slot and its £40 entirely');

// 5 — a new booking on a Saturday is a recurring A/B slot, as on a weekday
c = mkCtx('2026-10-26');
c.setAdd('2026-11-07'); c.el('appt-client-select').value = 'C'; c.el('appt-duration-input').value = '3';
c.saveAppointment();
const made = c.appState.appointments.find(a => a.id === 'new1');
ok(made && made.type === 'template' && made.dayOfWeek === 'sat' && made.template === 'B' && made.effectiveFrom === '2026-11-07',
  'adding on Sat 7 Nov creates a Week-B Saturday recurring slot');
ok(c.getOccurrencesForDate('2026-11-21').some(a => a.id === 'new1'), '…which recurs two weeks later (Sat 21 Nov)');

// 6 — Home steps over Sunday only
c = mkCtx('2026-10-26');
c.setHome('2026-10-30'); c.homeShiftDay(1); ok(c.home() === '2026-10-31', 'Home: Fri → next is Saturday');
c.homeShiftDay(1); ok(c.home() === '2026-11-02', 'Home: Sat → next skips Sunday to Monday');
c.homeShiftDay(-1); ok(c.home() === '2026-10-31', 'Home: Mon → previous is Saturday');
c.homePickDate('2026-11-01'); ok(c.home() === '2026-11-02', 'Home: picking a Sunday rolls to Monday');
c.homePickDate('2026-11-07'); ok(c.home() === '2026-11-07', 'Home: picking a Saturday stays on Saturday');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
