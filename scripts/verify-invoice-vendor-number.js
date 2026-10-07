// verify-invoice-vendor-number.js — v1.5.1 vendor number on invoice PDFs.
//
// Run:  TZ=Europe/London node scripts/verify-invoice-vendor-number.js
// Prints ✓/✗ per check; exits non-zero on any failure.
//
// Guards against: a commercial client's vendor number missing from an invoice
// generated BEFORE the number was added to the card. The PDF is rebuilt on
// every Share/Download, but from the card as it was on the statement date, so
// reading the statement-date card alone never picks the number up — the
// CONTROL check reproduces that. Also guards the other direction: an invoice
// whose statement-date card already had a vendor number keeps that one, and a
// domestic client never gets one.
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
const names = ['resolveVersionedValue', 'endVersionedRecord', 'createInitialVersionedHistory', 'addDays',
  'toLocalDateStr', 'parseLocalDateStr', 'compareDateStr', 'clientSnapshotOn', 'clientCurrentSnapshot',
  'invoiceVendorNumber', 'buildInvoicePdfBlob'];
let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('✓ ' + msg); } else { fail++; console.log('✗ ' + msg); } }

const TODAY = '2026-10-07';
function mkCtx() {
  const texts = [];
  const doc = new Proxy({}, { get: (t, k) => k === 'text' ? (s => { texts.push(String(s)); return doc; })
    : k === 'output' ? (() => 'blob') : (() => doc) });
  const ctx = {
    console, Math, Object, String, JSON,
    window: { jspdf: { jsPDF: function () { return doc; } } },
    appState: { settings: { businessNameHistory: createHist('My Dream Clean'), businessAddressHistory: createHist(null), bankDetailsHistory: createHist(null) }, invoices: [] },
    getLocalToday: () => TODAY,
    formatDateUK: d => d, formatCurrency: n => Number(n).toFixed(2), titleCaseText: s => s,
    texts,
  };
  vm.createContext(ctx);
  vm.runInContext(names.map(extract).join('\n') + '\nthis.endVersionedRecord = endVersionedRecord; this.buildInvoicePdfBlob = buildInvoicePdfBlob; this.invoiceVendorNumber = invoiceVendorNumber;', ctx);
  return ctx;
}
function createHist(v) { return [{ from: '2026-01-01', to: null, value: v }]; }

const card = over => Object.assign({ name: 'Acme Ltd', clientType: 'commercial', vendorNumber: null,
  address: { line1: '1 High St', postcode: 'WA14 1AA' }, rateAmount: 20, rateDurationHours: 1, active: true }, over);
const invoice = { invoiceNumber: 'Acme Ltd - 2026-27-001', statementDate: '2026-10-01', periodKey: '2026-09',
  status: 'ready', lineItems: [{ date: '2026-09-10', hours: 2, rate: 20, total: 40 }], total: 40 };

function vendorLines(ctx, client) {
  ctx.texts.length = 0;
  ctx.buildInvoicePdfBlob(invoice, client);
  return ctx.texts.filter(t => t.startsWith('Vendor #'));
}

// 1. Vendor number added AFTER the invoice was generated (blank effective date → yesterday).
{
  const ctx = mkCtx();
  const client = { id: 'c1', profileHistory: [{ from: '2026-09-01', to: null, value: card({}) }] };
  ctx.endVersionedRecord(client.profileHistory, '2026-10-06', card({ vendorNumber: '00417' }));
  // CONTROL — the pre-fix read: the statement-date card has no vendor number.
  const statementSnap = vm.runInContext('clientSnapshotOn', ctx)(client, invoice.statementDate);
  ok(statementSnap.vendorNumber === null, 'CONTROL: statement-date card (1 Oct) has no vendor number — the old code printed nothing');
  ok(JSON.stringify(vendorLines(ctx, client)) === '["Vendor #: 00417"]', 'vendor number added on 7 Oct prints on the invoice dated 1 Oct');
}

// 2. Vendor number already on the statement-date card, changed later → the invoice keeps the original.
{
  const ctx = mkCtx();
  const client = { id: 'c2', profileHistory: [{ from: '2026-09-01', to: null, value: card({ vendorNumber: '111' }) }] };
  ctx.endVersionedRecord(client.profileHistory, '2026-10-06', card({ vendorNumber: '222' }));
  ok(JSON.stringify(vendorLines(ctx, client)) === '["Vendor #: 111"]', 'a vendor number on the statement-date card wins over a later change');
}

// 3. Domestic client → never a vendor line.
{
  const ctx = mkCtx();
  const client = { id: 'c3', profileHistory: [{ from: '2026-09-01', to: null, value: card({ clientType: 'domestic', name: 'J Smith' }) }] };
  ok(vendorLines(ctx, client).length === 0, 'domestic client: no vendor line');
}

// 4. Commercial then, domestic now with no number → no line (the fallback only takes a commercial card's number).
{
  const ctx = mkCtx();
  const client = { id: 'c4', profileHistory: [{ from: '2026-09-01', to: null, value: card({}) }] };
  ctx.endVersionedRecord(client.profileHistory, '2026-10-06', card({ clientType: 'domestic' }));
  ok(vendorLines(ctx, client).length === 0, 'no vendor number on either card: no vendor line');
}

// 5. Commercial client, no vendor number anywhere → no line, no "Vendor #: null".
{
  const ctx = mkCtx();
  const client = { id: 'c5', profileHistory: [{ from: '2026-09-01', to: null, value: card({}) }] };
  ok(vendorLines(ctx, client).length === 0, 'commercial client with no vendor number: no vendor line');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
