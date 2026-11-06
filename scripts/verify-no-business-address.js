// verify-no-business-address.js — v1.8.1 business address off invoices.
//
// Run:  TZ=Europe/London node scripts/verify-no-business-address.js
// Prints ✓/✗ per check; exits non-zero on any failure.
//
// Guards against: the business address printing on an invoice PDF. The PDF is
// rebuilt on every Share/Download, so this covers invoices generated before
// v1.8.1 as well. The CONTROL check confirms the stored business address is
// still there to print, so a pass is not just an empty history.
//
// Also guards the mileage side. Mileage used to fall back to the business
// address when no home address had coordinates; that address is no longer
// editable, so promoteBusinessAddressToHome copies it into homeAddress once.
// The checks assert it copies the coordinates unchanged (so cached mileage
// stays valid), never overwrites a home address that already has
// coordinates, and that getMileageOriginAddress never reads the business
// address itself.
//
// It runs the REAL functions, extracted by name from index.html's inline
// scripts, against a stub jsPDF that records every text() call — no browser.
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
const names = ['resolveVersionedValue', 'addDays', 'toLocalDateStr', 'parseLocalDateStr', 'compareDateStr',
  'clientSnapshotOn', 'clientCurrentSnapshot', 'invoiceVendorNumber', 'buildInvoicePdfBlob',
  'promoteBusinessAddressToHome', 'getMileageOriginAddress'];
let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('✓ ' + msg); } else { fail++; console.log('✗ ' + msg); } }

const TODAY = '2026-11-06';
const BIZ = { line1: '7 Private Road', line2: 'Altrincham', postcode: 'WA15 9ZZ', lat: 53.38, lng: -2.34, manual: false };
const NO_HOME = { line1: '', postcode: '', lat: null, lng: null, manual: true };
function hist(v) { return [{ from: '2020-01-01', to: null, value: v }]; }
function mkCtx(settings) {
  const texts = [];
  const doc = new Proxy({}, { get: (t, k) => k === 'text' ? (s => { texts.push(String(s)); return doc; })
    : k === 'output' ? (() => 'blob') : (() => doc) });
  const ctx = {
    console, Math, Object, String, JSON,
    window: { jspdf: { jsPDF: function () { return doc; } } },
    appState: { settings: Object.assign({ businessNameHistory: hist('My Dream Clean'), businessAddressHistory: hist(BIZ),
      bankDetailsHistory: hist(null), homeAddress: NO_HOME }, settings), invoices: [] },
    getLocalToday: () => TODAY,
    formatDateUK: d => d, formatCurrency: n => Number(n).toFixed(2), titleCaseText: s => s,
    texts,
  };
  vm.createContext(ctx);
  vm.runInContext(names.map(extract).join('\n') + '\nthis.buildInvoicePdfBlob = buildInvoicePdfBlob;' +
    ' this.promoteBusinessAddressToHome = promoteBusinessAddressToHome; this.getMileageOriginAddress = getMileageOriginAddress;' +
    ' this.resolveVersionedValue = resolveVersionedValue;', ctx);
  return ctx;
}

const client = { id: 'c1', profileHistory: [{ from: '2026-01-01', to: null, value: { name: 'Acme Ltd', clientType: 'commercial',
  vendorNumber: '00417', address: { line1: '1 High St', line2: 'Hale', postcode: 'WA14 1AA' }, rateAmount: 20, rateDurationHours: 1, active: true } }] };
const invoice = { invoiceNumber: 'Acme Ltd - 2026-27-001', statementDate: '2026-10-01', periodKey: '2026-09',
  status: 'ready', lineItems: [{ date: '2026-09-10', hours: 2, rate: 20, total: 40 }], total: 40 };

// 1. Invoice PDF
{
  const ctx = mkCtx({});
  const stored = ctx.resolveVersionedValue(ctx.appState.settings.businessAddressHistory, invoice.statementDate);
  ok(stored && stored.line1 === BIZ.line1, 'CONTROL: a business address is stored for the statement date — v1.8.0 printed it');
  ctx.buildInvoicePdfBlob(invoice, client);
  const t = ctx.texts;
  ok(![BIZ.line1, BIZ.line2, BIZ.postcode].some(x => t.includes(x)), 'no business address line is printed on the invoice');
  ok(t.includes('My Dream Clean'), 'business name is still printed');
  ok(t.includes('1 High St') && t.includes('Hale') && t.includes('WA14 1AA'), "client's address is still printed");
  ok(t.includes('Vendor #: 00417'), 'vendor number is still printed');
}

// 2. Mileage origin and the one-off promotion
{
  const ctx = mkCtx({});
  ok(ctx.getMileageOriginAddress() === null, 'mileage never falls back to the business address');
  const s = ctx.appState.settings;
  ok(ctx.promoteBusinessAddressToHome(s) === true, 'no home coordinates + business coordinates → promoted');
  ok(s.homeAddress.lat === BIZ.lat && s.homeAddress.lng === BIZ.lng, 'coordinates copied unchanged, so route fingerprints match');
  ok(s.homeAddress.line1 === BIZ.line1 && s.homeAddress.line2 === BIZ.line2 && s.homeAddress.postcode === BIZ.postcode,
    'address lines and postcode copied, so Settings → Home Address shows them');
  ok(ctx.getMileageOriginAddress() === s.homeAddress, 'mileage then reads the home address');
  ok(ctx.promoteBusinessAddressToHome(s) === false, 'second run is a no-op');
  ok(s.businessAddressHistory[0].value === BIZ, 'business address history is left as stored');
}
{
  const HOME = { line1: '2 Other St', line2: '', postcode: 'M1 1AA', lat: 53.48, lng: -2.24, manual: false };
  const ctx = mkCtx({ homeAddress: HOME });
  ok(ctx.promoteBusinessAddressToHome(ctx.appState.settings) === false && ctx.appState.settings.homeAddress === HOME,
    'a home address with coordinates is never overwritten');
}
{
  const ctx = mkCtx({ businessAddressHistory: hist({ line1: '', postcode: '' }) });
  ok(ctx.promoteBusinessAddressToHome(ctx.appState.settings) === false && ctx.appState.settings.homeAddress === NO_HOME,
    'a business address with no coordinates (the default) promotes nothing');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
