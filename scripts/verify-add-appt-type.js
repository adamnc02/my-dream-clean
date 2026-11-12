// verify-add-appt-type.js — v1.9.0 "one-off or recurring?" step when adding an appointment.
//
// Run:  TZ=Europe/London node scripts/verify-add-appt-type.js
// Prints ✓/✗ per check; exits non-zero on any failure.
//
// Guards against: (1) a new working-day appointment being made recurring
// without asking, which is what every Mon–Sat add did before v1.9.0 — a
// one-off clean then repeated every other week until it was deleted;
// (2) a "one-off" leaking into later weeks; (3) a "recurring" slot landing on
// the wrong week letter or day; (4) anything being written before the
// question is answered, or twice on a double tap; (5) Sunday, which can never
// show a template, being offered "recurring" at all. The CONTROL check
// confirms a recurring slot IS seen two weeks on, so a one-off's absence
// there means something.
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
const names = ['toLocalDateStr','parseLocalDateStr','addDays','compareDateStr','getDayOfWeekKey','isNonWorkingDay',
 'getMondayOfWeek','getWeekLetter','isPastDate','effectiveSlotOrder','getOccurrencesForDate','saveAppointment',
 'openApptAddTypeModal','applyApptAddType','addNewAppointment','formatDateUK'];
// The modal markup must exist, or openModalEl throws on the real page.
let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('✓ ' + msg); } else { fail++; console.log('✗ ' + msg); } }
ok(/id="modal-appt-add-type"/.test(html) && /id="appt-add-type-hint"/.test(html), 'modal-appt-add-type markup is in index.html');
ok(html.indexOf('id="modal-appt-add-type"') > html.indexOf('id="modal-appointment"'), 'the type sheet comes after modal-appointment, so it stacks on top');

function mkCtx(today) {
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', style: {}, textContent: '', classList: { add(){}, remove(){} } });
  const ctx = {
    console, Promise, Object, Set, Math, Date, parseFloat, isNaN, String,
    DAY_KEYS: ['sun','mon','tue','wed','thu','fri','sat'],
    appState: { settings: { weekAbReferenceMonday: '2026-09-28', holidays: [] }, appointments: [],
      clients: [{ id: 'c1', name: 'Mrs Test' }] },
    document: { getElementById: el },
    opened: [], closed: [], alerts: [], persisted: [],
    uuid: (() => { let n = 0; return () => 'new' + (++n); })(),
    clientCurrentSnapshot: c => ({ name: c.name }),
    getLocalToday: () => today,
  };
  ctx.persistAppointments = ids => { ctx.persisted.push(...ids); return { then: f => { f(); } }; };
  ctx.openModalEl = id => ctx.opened.push(id);
  ctx.closeModal = id => ctx.closed.push(id);
  ctx.alert = m => ctx.alerts.push(m);
  vm.createContext(ctx);
  vm.runInContext(names.map(extract).join('\n') +
    '\nlet _editingAppointmentId=null, _apptModalCtx={}, _apptAddTypeCtx=null;' +
    '\nthis.setAdd=(d,r)=>{_editingAppointmentId=null;_apptModalCtx={date:d,refresh:r};};', ctx);
  ctx.el = el;
  return ctx;
}
const TODAY = '2026-10-01';          // Thu, week A (reference Monday 2026-09-28 = A)
const THU = '2026-10-15';            // Thu, week A
const THU_B = '2026-10-22';          // the next Thursday, week B
const THU_A2 = '2026-10-29';         // two weeks on, week A again
const SUN = '2026-10-18';
function add(c, date, client, dur) {
  c.el('appt-client-select').value = client; c.el('appt-duration-input').value = String(dur);
  c.setAdd(date, () => { c.refreshed = true; }); c.saveAppointment();
}
const on = (c, d) => c.getOccurrencesForDate(d).map(a => a.clientId + ':' + a.durationHours).join(',');

// 1 — Save on a working day asks, and writes nothing yet
let c = mkCtx(TODAY);
add(c, THU, 'c1', 2);
ok(c.opened.includes('modal-appt-add-type'), 'adding on a weekday opens the one-off/recurring step');
ok(c.appState.appointments.length === 0 && c.persisted.length === 0, '…and writes nothing until it is answered');
ok(!c.closed.includes('modal-appointment'), '…and leaves the Add form open underneath, so Back returns to it');
const hint = c.el('appt-add-type-hint').textContent;
ok(/Mrs Test/.test(hint) && /2 hours/.test(hint) && /Thursday/.test(hint) && /Week A/.test(hint), 'hint names the client, hours, weekday and week letter');
ok(/every other Thursday/.test(c.el('appt-add-type-recurring-btn').textContent) && /15 Oct 2026/.test(c.el('appt-add-type-once-btn').textContent), 'buttons say what each choice means');

// 2 — one-off
c.applyApptAddType('adhoc');
let a = c.appState.appointments;
ok(a.length === 1 && a[0].type === 'adhoc' && a[0].date === THU, 'one-off: one ad-hoc record on the tapped date');
ok(on(c, THU) === 'c1:2' && on(c, THU_A2) === '' && on(c, THU_B) === '', 'one-off: shows on that date only, not the weeks after');
ok(c.closed.includes('modal-appt-add-type') && c.closed.includes('modal-appointment') && c.refreshed, 'one-off: both sheets close and the page refreshes');
c.applyApptAddType('adhoc');
ok(c.appState.appointments.length === 1, 'a second tap after answering writes nothing more');

// 3 — recurring
c = mkCtx(TODAY);
add(c, THU, 'c1', 3); c.applyApptAddType('template');
a = c.appState.appointments;
ok(a.length === 1 && a[0].type === 'template' && a[0].template === 'A' && a[0].dayOfWeek === 'thu'
   && a[0].effectiveFrom === THU && a[0].effectiveTo === null, 'recurring: an open-ended week-A Thursday template from the tapped date');
ok(on(c, THU) === 'c1:3' && on(c, THU_A2) === 'c1:3', 'CONTROL: recurring shows on the tapped date and two weeks on');
ok(on(c, THU_B) === '' && on(c, '2026-10-01') === '', 'recurring: not on the week-B Thursday between, nor before it starts');

// 4 — slot order appends after what is already there
c = mkCtx(TODAY);
c.appState.appointments.push({ id: 'X', type: 'adhoc', date: THU, clientId: 'c1', durationHours: 1, slotOrder: 4 });
add(c, THU, 'c1', 2); c.applyApptAddType('template');
ok(c.appState.appointments[1].slotOrder === 5, 'new appointment goes to the end of that day\'s order');

// 5 — Sunday is always a one-off, no question
c = mkCtx(TODAY);
add(c, SUN, 'c1', 2);
ok(!c.opened.includes('modal-appt-add-type'), 'Sunday: no one-off/recurring question');
ok(c.appState.appointments.length === 1 && c.appState.appointments[0].type === 'adhoc' && c.appState.appointments[0].date === SUN, 'Sunday: saved straight away as a one-off');

// 6 — an invalid duration is refused before the question
c = mkCtx(TODAY);
add(c, THU, 'c1', 7);
ok(c.alerts.length === 1 && !c.opened.includes('modal-appt-add-type') && c.appState.appointments.length === 0, 'invalid duration: alert, no question, nothing written');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
