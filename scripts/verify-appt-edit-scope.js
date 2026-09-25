// verify-appt-edit-scope.js — v1.5.0 edit-scope flow for recurring appointments.
//
// Run:  TZ=Europe/London node scripts/verify-appt-edit-scope.js
// Prints ✓/✗ per check; exits non-zero on any failure.
//
// Guards against: (1) a "just this occurrence" edit leaking into other weeks;
// (2) a forward edit from a past date, or from before/after the record's own
// window, splitting the template into a broken shape (the old "Changes apply
// from" picker allowed all three); (3) a one-off CLIENT change sprouting a
// "Cancelled · tap to reinstate" ghost beside its own stand-in once the date
// passes — the CONTROL check reproduces that without replacesTemplateId;
// (4) the historic-correction path (TECHNICAL.md §5.1) changing at all.
//
// It runs the REAL functions, extracted by name from index.html's inline
// scripts, against a stub DOM and a pinned "today" — no browser needed.
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
const names = ['toLocalDateStr','parseLocalDateStr','addDays','compareDateStr','getDayOfWeekKey','isWeekend',
 'getMondayOfWeek','getWeekLetter','isPastDate','effectiveSlotOrder','getOccurrencesForDate','cancelledOccurrencesForDate',
 'applyTemplateEditForward','templateResolvesToSingleDate','applyHistoricOccurrenceCorrection','saveAppointment',
 'openApptEditScopeModal','showApptScopeChoiceStep','showApptScopeDateStep','finishApptEditScope',
 'applyApptEditOnce','applyApptEditFuture','deleteAppointment','formatDateUK'];
let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('✓ ' + msg); } else { fail++; console.log('✗ ' + msg); } }
function mkCtx(today) {
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', min: '', max: '', style: {}, textContent: '', classList: { add(){}, remove(){} } });
  const ctx = {
    console, Promise, Object, Set, Math, Date, parseFloat, isNaN, String,
    DAY_KEYS: ['sun','mon','tue','wed','thu','fri','sat'],
    appState: { settings: { weekAbReferenceMonday: '2026-09-28', holidays: [] }, appointments: [] },
    document: { getElementById: el },
    opened: [], closed: [], alerts: [], confirmCb: null, deleted: [],
    uuid: (() => { let n = 0; return () => 'new' + (++n); })(),
    persistAppointments: () => ({ then: f => { f(); } }),
    dbDelete: (s, id) => { ctx.deleted.push(id); return { then: f => f() }; },
    getLocalToday: () => today,
  };
  ctx.openModalEl = id => ctx.opened.push(id);
  ctx.closeModal = id => ctx.closed.push(id);
  ctx.alert = m => ctx.alerts.push(m);
  ctx.showConfirm = (m, cb) => { ctx.confirmCb = cb; };
  vm.createContext(ctx);
  vm.runInContext(names.map(extract).join('\n') +
    '\nlet _editingAppointmentId=null, _apptModalCtx={}, _apptEditScopeCtx=null;' +
    '\nthis.get=()=>({_apptEditScopeCtx}); this.setEdit=(id,d,r)=>{_editingAppointmentId=id;_apptModalCtx={date:d,refresh:r};};', ctx);
  ctx.el = el;
  return ctx;
}
const T0 = () => ({ id: 'T', type: 'template', template: 'A', dayOfWeek: 'thu', date: null, slotOrder: 1,
  clientId: 'c1', durationHours: 2, effectiveFrom: '2026-09-03', effectiveTo: null, cancelledDates: [] });
const TODAY = '2026-10-01'; // Thu, week A
const FUT = '2026-10-15', FUT2 = '2026-10-29'; // Thursdays, week A
function save(c, id, date, client, dur) {
  c.el('appt-client-select').value = client; c.el('appt-duration-input').value = String(dur);
  c.setEdit(id, date, () => { c.refreshed = true; }); c.saveAppointment();
}
const dur = (c, d) => c.getOccurrencesForDate(d).map(a => a.clientId + ':' + a.durationHours).join(',');

// 1 — save with a change asks the question and writes nothing yet
let c = mkCtx(TODAY); c.appState.appointments.push(T0());
save(c, 'T', FUT, 'c1', 3);
ok(c.opened.includes('modal-appt-edit-scope'), 'changed duration on a future occurrence opens the scope modal');
ok(c.appState.appointments.length === 1 && c.appState.appointments[0].durationHours === 2, '…and writes nothing until a scope is picked');
ok(c.el('appt-effective-date').value === FUT && c.el('appt-effective-date').min === TODAY, 'picker defaults to the tapped date, floored at today');

// 2 — just this occurrence
c.applyApptEditOnce();
ok(dur(c, FUT) === 'c1:3', 'once: the tapped date is now 3h');
ok(dur(c, FUT2) === 'c1:2' && dur(c, TODAY) === 'c1:2', 'once: other occurrences (before and after) stay 2h');
ok(c.appState.appointments.find(a => a.type === 'adhoc').replacesTemplateId === 'T', 'once: stand-in records replacesTemplateId');
ok(c.closed.includes('modal-appt-edit-scope') && c.closed.includes('modal-appointment') && c.refreshed, 'once: both modals close and the page refreshes');

// 3 — once with a client change: no ghost once the date is past; control without the field
c = mkCtx(TODAY); c.appState.appointments.push(T0());
save(c, 'T', FUT, 'c2', 2); c.applyApptEditOnce();
ok(dur(c, FUT) === 'c2:2', 'once client swap: tapped date shows the new client only');
c.getLocalToday = () => '2026-11-01';
ok(c.cancelledOccurrencesForDate(FUT).length === 0, 'client swap: no "cancelled" ghost once the date has passed');
delete c.appState.appointments.find(a => a.type === 'adhoc').replacesTemplateId;
ok(c.cancelledOccurrencesForDate(FUT).length === 1, 'CONTROL: without replacesTemplateId the ghost would appear (the bug this prevents)');

// 4 — all future from a picked date
c = mkCtx(TODAY); c.appState.appointments.push(T0());
save(c, 'T', FUT, 'c1', 4); c.showApptScopeDateStep(); c.el('appt-effective-date').value = FUT2; c.applyApptEditFuture();
ok(dur(c, TODAY) === 'c1:2' && dur(c, FUT) === 'c1:2', 'future: occurrences before the picked date keep 2h');
ok(dur(c, FUT2) === 'c1:4' && dur(c, '2026-11-12') === 'c1:4', 'future: picked date and later are 4h');
ok(c.alerts.length === 0, 'future: no validation alert on a valid date');

// 5 — validation: past date, before effectiveFrom, after effectiveTo
c = mkCtx(TODAY); c.appState.appointments.push(T0());
save(c, 'T', FUT, 'c1', 4); c.el('appt-effective-date').value = '2026-09-17'; c.applyApptEditFuture();
ok(c.alerts.length === 1 && c.appState.appointments.length === 1 && c.appState.appointments[0].effectiveTo === null, 'future: a PAST effective date is refused, template untouched');
c = mkCtx(TODAY); c.appState.appointments.push(Object.assign(T0(), { effectiveFrom: FUT }));
save(c, 'T', FUT2, 'c1', 4);
ok(c.el('appt-effective-date').min === FUT, 'picker floor is the record\'s own start when that is after today');
c.el('appt-effective-date').value = '2026-10-08'; c.applyApptEditFuture();
ok(c.alerts.length === 1 && c.appState.appointments[0].effectiveTo === null, 'future: a date before the record starts is refused');
c = mkCtx(TODAY); c.appState.appointments.push(Object.assign(T0(), { effectiveTo: FUT2 }));
save(c, 'T', FUT, 'c1', 4); c.el('appt-effective-date').value = '2026-11-12'; c.applyApptEditFuture();
ok(c.alerts.length === 1 && c.appState.appointments.length === 1, 'future: a date after the record ends is refused');

// 6 — no change: close, no question, no split
c = mkCtx(TODAY); c.appState.appointments.push(T0());
save(c, 'T', FUT, 'c1', 2);
ok(!c.opened.includes('modal-appt-edit-scope') && c.closed.includes('modal-appointment') && c.appState.appointments.length === 1, 'unchanged save closes without asking or splitting');

// 7 — historic stays on its own path
c = mkCtx(TODAY); c.appState.appointments.push(T0());
save(c, 'T', '2026-09-17', 'c1', 3);
ok(!c.opened.includes('modal-appt-edit-scope'), 'historic: no scope question');
ok(dur(c, '2026-09-17') === 'c1:3' && dur(c, FUT) === 'c1:2', 'historic: corrected that date only, as before');
ok(!('replacesTemplateId' in c.appState.appointments.find(a => a.type === 'adhoc')), 'historic: record shape unchanged (no new field)');

// 8 — today counts as editable-with-scope, ad-hoc edits in place
c = mkCtx(TODAY); c.appState.appointments.push(T0());
save(c, 'T', TODAY, 'c1', 3);
ok(c.opened.includes('modal-appt-edit-scope'), 'today\'s occurrence gets the scope question');
c = mkCtx(TODAY); c.appState.appointments.push({ id: 'X', type: 'adhoc', date: '2026-10-17', clientId: 'c1', durationHours: 2, slotOrder: 1 });
save(c, 'X', '2026-10-17', 'c1', 3);
ok(!c.opened.includes('modal-appt-edit-scope') && c.appState.appointments[0].durationHours === 3, 'ad-hoc: edited in place, no scope question');

// 9 — delete ends the series from the tapped date
c = mkCtx(TODAY); c.appState.appointments.push(T0());
c.setEdit('T', FUT, () => {}); c.deleteAppointment(); c.confirmCb();
ok(c.appState.appointments[0].effectiveTo === '2026-10-14', 'delete: series ends the day before the tapped occurrence');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
