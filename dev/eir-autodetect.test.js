// EIR columns are found by HEADER NAME (server.js detectEirColumns) and the importer script keeps the bank order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../google-apps-script/EIR_IMPORT.gs', import.meta.url), 'utf8');

function loadDetect() {
  const a = server.indexOf('const EIR_HEADER_MAP');
  const b = server.indexOf('const eirAuto = ');
  assert.ok(a > 0 && b > a, 'detect block present in server.js');
  const ctx = {};
  vm.runInNewContext(server.slice(a, b) + '\nthis.detectEirColumns = detectEirColumns; this.REQ = EIR_REQUIRED_KEYS;', ctx);
  return ctx;
}
const colsOf = (labels) => labels.map((l, i) => ({ id: String.fromCharCode(65 + (i % 26)).repeat(i < 26 ? 1 : 2), label: l }));

test('detectEirColumns maps header names to whatever letters they sit at', () => {
  const { detectEirColumns } = loadDetect();
  const r = detectEirColumns(colsOf(['TAG_ID', 'VRN', 'ISSUE_DATE', 'ISSUE_TIME', 'CCH', 'Master ID', 'is_full_kyc', 'CUSTOMER_FULL_KYC']));
  assert.equal(r.found.tagId, 'A');
  assert.equal(r.found.date, 'C');
  assert.equal(r.found.time, 'D');
  assert.equal(r.found.cls, 'E');
  assert.equal(r.found.masterId, 'F');
  assert.equal(r.found.kyc2, 'G');
  assert.equal(r.found.kyc, 'H');
  assert.ok(r.missing.includes('agentName'));
});

test('moving a column changes only that letter; duplicate header takes the first one', () => {
  const { detectEirColumns } = loadDetect();
  const r = detectEirColumns(colsOf(['ISSUE_DATE', 'TAG_ID', 'TL ID', 'x', 'TL ID', 'CCH', 'MASTER ID']));
  assert.equal(r.found.tagId, 'B');
  assert.equal(r.found.tlId, 'C');
  assert.equal(r.found.date, 'A');
});

test('required headers are reported when a header is gone', () => {
  const { detectEirColumns, REQ } = loadDetect();
  const r = detectEirColumns(colsOf(['TAG_ID', 'VRN']));
  assert.ok(REQ.some((k) => !r.found[k]));
});

test('server wires routes, boot + interval detection and Settings toggle', () => {
  assert.match(server, /\/api\/eir-columns\/detect/);
  assert.match(server, /eirAutoDetect\(\{ auto: true \}\)/);
});

// ---------- Apps Script ----------
function loadScript() {
  const fmt = (d, pattern) => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
    return pattern.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  };
  const ctx = { Utilities: { formatDate: fmt }, Logger: { log() {} } };
  vm.runInNewContext(script, ctx);
  return ctx;
}

test('script: ISSUE_TIME goes to column BA (found by header once set); never auto-inserted after ISSUE_DATE', () => {
  const s = loadScript();
  assert.match(script, /TIME_COLUMN: 53/);
  const blankBA = new Array(52).fill('X').concat(['', '', 'cardStage']);
  const p = s.planEIRTimeColumn(blankBA, 53);
  assert.equal(p.col, 53); assert.equal(p.setHeader, true);
  const named = new Array(60).fill('X'); named[56] = 'issue_time';
  const q = s.planEIRTimeColumn(named, 53);
  assert.equal(q.col, 57); assert.equal(q.setHeader, false);
  const busy = new Array(55).fill('X');
  const r = s.planEIRTimeColumn(busy, 53);
  assert.equal(r.col, 56); assert.equal(r.setHeader, true);
  assert.equal(s.planEIRTimeColumn(['A'], 53).col, 53);
});

test('script: a new bank column is inserted after the previous bank column, never at the far end', () => {
  const s = loadScript();
  const sheet = ['TAG_ID', 'ISSUE_DATE', 'KYC_MODE', 'CUSTOMER_FULL_KYC', 'Master ID', 'TL ID'];
  const plan = s.planEIRInsertions(sheet, ['TAG_ID', 'ISSUE_DATE', 'KYC_MODE', 'CUSTOMER_FULL_KYC', 'IS_FULL_KYC']);
  assert.deepEqual(Array.from(plan.inserts, (i) => [i.header, i.col]), [['IS_FULL_KYC', 5]]);
  assert.deepEqual(Array.from(plan.layout), ['TAG_ID', 'ISSUE_DATE', 'KYC_MODE', 'CUSTOMER_FULL_KYC', 'IS_FULL_KYC', 'MASTER ID', 'TL ID']);
});

test('script: no change when the sheet already follows the bank order', () => {
  const s = loadScript();
  const plan = s.planEIRInsertions(['A', 'B', 'C'], ['A', 'B', 'C']);
  assert.equal(plan.inserts.length, 0);
  assert.equal(s.planEIRMoves(['A', 'B', 'C', 'X'], ['A', 'B', 'C']).moves.length, 0);
});

test('script: an out-of-order bank column (IS_FULL_KYC at the far end) is moved next to its neighbour', () => {
  const s = loadScript();
  const existing = ['TAG_ID', 'KYC_MODE', 'CUSTOMER_FULL_KYC', 'Master ID', 'TL ID', 'IS_FULL_KYC'];
  const mv = s.planEIRMoves(existing, ['TAG_ID', 'KYC_MODE', 'CUSTOMER_FULL_KYC', 'IS_FULL_KYC']);
  assert.equal(mv.moves.length, 1);
  assert.deepEqual(Array.from(mv.layout), ['TAG_ID', 'KYC_MODE', 'CUSTOMER_FULL_KYC', 'IS_FULL_KYC', 'MASTER ID', 'TL ID']);
  assert.equal(mv.moves[0].from, 6);
  assert.equal(mv.moves[0].destination, 4);   // moveColumns: before column 4
});

test('script: time is read from the bank ISSUE_DATE; the date stays a date', () => {
  const s = loadScript();
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(s.extractEIRTime('29-10-2026 21:17:40 IST'), (21 * 3600 + 17 * 60 + 40) / 86400));
  assert.ok(near(s.extractEIRTime('2026-10-29T09:05:00'), (9 * 3600 + 5 * 60) / 86400));
  assert.ok(near(s.extractEIRTime('29/10/2026 9:05 PM'), (21 * 3600 + 5 * 60) / 86400));
  assert.equal(s.extractEIRTime('29-10-2026'), '');
  assert.equal(s.extractEIRTime(''), '');
  const d = s.parseEIRDate('29-10-2026 21:17:40 IST');
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 9);
  assert.equal(d.getUTCDate(), 29);
});

test('script: other behaviour kept (dedupe, 65-day retention, markDataArrived)', () => {
  assert.match(script, /DAYS_TO_KEEP: 65/);
  assert.match(script, /existingTagIds\.has\(tagId\)/);
  assert.match(script, /function markDataArrived/);
  assert.match(script, /'dd-mmmm-yyyy'/);
});

test('script: IS_FULL_KYC from the bank goes into CUSTOMER_FULL_KYC (no new column)', () => {
  const s = loadScript();
  assert.deepEqual(Array.from(s.withoutEIRAliases(['TAG_ID', 'CUSTOMER_FULL_KYC', 'Is_Full_KYC', 'CCH'])), ['TAG_ID', 'CUSTOMER_FULL_KYC', 'CCH']);
  assert.match(script, /ALIASES: \{ 'IS_FULL_KYC': 'CUSTOMER_FULL_KYC' \}/);
  assert.match(script, /function backfillCustomerFullKyc/);
  assert.match(script, /EIR_CONFIG\.ALIASES\[header\]/);
});
