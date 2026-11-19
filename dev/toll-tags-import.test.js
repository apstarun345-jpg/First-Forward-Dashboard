// 🛣️ Toll Tags import (Apps Script) — pure logic: mail parse, CSV filter/aggregate, tag-wise merge across days
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../google-apps-script/TOLL_TAGS_IMPORT.gs', import.meta.url), 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext(src + '\nthis.__x = { tollParseMail_, tollParseText_, tollMergeRows_, tollCsvLine_, TOLL_CFG };', ctx);
const X = ctx.__x;

const HDR = 'TAG_ID,TRANSACTION_TYPE,TRANSACTION_AMOUNT,TRANSACTION_SUCCESS_STATUS,TRANSACTION_DESCRIPTION,VRN,TAG_ISSUING_AGENT_NAME,TAG_ISSUING_AGENT_ID';
const csv = (...rows) => [HDR, ...rows].join('\r\n') + '\r\n';

test('mail → report date + download link (&amp; decoded)', () => {
  const html = '<b>covering the period from</b> <b>18-11-2026 00:00:00 IST</b> to x <a href="https://s3.ap-south-1.amazonaws.com/b/k/EToll_18-Nov-2026.csv?X-Amz-Date=1&amp;X-Amz-Signature=ab">Click here</a>';
  const m = X.tollParseMail_(html);
  assert.equal(m.reportDate, '2026-11-18');
  assert.equal(m.url, 'https://s3.ap-south-1.amazonaws.com/b/k/EToll_18-Nov-2026.csv?X-Amz-Date=1&X-Amz-Signature=ab');
  assert.equal(X.tollParseMail_('<p>hello</p>'), null);
});

test('only successful NETC-TOLL-PASS rows count; recharge/issuance ignored; tag-wise totals; agent id apostrophe stripped', () => {
  const st = { idx: null, tags: {}, txns: 0, amount: 0 };
  X.tollParseText_(csv(
    'AA11,NETC-TOLL-PASS,45,True,"toll, plaza ""A""",RJ14AB1234,RAM SINGH,\'1001',
    'AA11,NETC-TOLL-PASS-DEBIT-AUTOPAY,5,True,x,RJ14AB1234,RAM SINGH,\'1001',
    'AA11,BBPS-RECHARGE,500,True,x,RJ14AB1234,RAM SINGH,\'1001',
    'BB22,NETC-TOLL-PASS,0,True,x,GJ05RW3044,,',
    'CC33,NETC-TOLL-PASS,70,False,x,PB01,X,\'9'
  ), st);
  assert.equal(st.txns, 3);
  assert.equal(st.amount, 50);
  assert.deepEqual(Object.keys(st.tags).sort(), ['AA11', 'BB22']);
  assert.deepEqual(JSON.parse(JSON.stringify(st.tags.AA11)), { vrn: 'RJ14AB1234', an: 'RAM SINGH', ai: '1001', amt: 50, n: 2 });
  assert.equal(st.tags.BB22.an, '');
});

test('chunk boundary: header parsed once, rows split across calls aggregate together', () => {
  const st = { idx: null, tags: {}, txns: 0, amount: 0 };
  X.tollParseText_(HDR + '\r\nAA11,NETC-TOLL-PASS,10,True,x,V1,A,\'1\r\n', st);
  X.tollParseText_('AA11,NETC-TOLL-PASS,15,True,x,V1,A,\'1\r\nZZ99,NETC-TOLL-PASS,5,True,x,V2,B,\'2\r\n', st);
  assert.equal(st.tags.AA11.amt, 25); assert.equal(st.tags.AA11.n, 2); assert.equal(st.txns, 3);
});

test('missing column → clear error', () => {
  assert.throws(() => X.tollParseText_('A,B\r\n1,2\r\n', { idx: null, tags: {}, txns: 0, amount: 0 }), /column nahi mila/);
});

test('day 2: same tag adds to the SAME row (no duplicate), new tag appended, blanks filled, dates move forward only', () => {
  const day1 = { AA11: { vrn: 'V1', an: 'RAM', ai: '1', amt: 100, n: 4 }, BB22: { vrn: '', an: '', ai: '', amt: 20, n: 1 } };
  const r1 = X.tollMergeRows_([], day1, '2026-11-18');
  assert.equal(r1.fresh.length, 2); assert.equal(r1.updated, 0);
  const sheet = JSON.parse(JSON.stringify(r1.rows));
  const day2 = { AA11: { vrn: 'V1', an: 'RAM', ai: '1', amt: 50, n: 2 }, BB22: { vrn: 'V9', an: 'SHYAM', ai: '7', amt: 5, n: 1 }, CC33: { vrn: 'V3', an: 'X', ai: '3', amt: 9, n: 1 } };
  const r2 = X.tollMergeRows_(sheet, day2, '2026-11-19');
  assert.equal(r2.rows.length, 3, 'sirf ek nayi row (CC33)');
  assert.equal(r2.fresh.length, 1); assert.equal(r2.updated, 2); assert.ok(r2.filled);
  const by = Object.fromEntries(r2.rows.map((r) => [r[0], r]));
  assert.deepEqual([by.AA11[4], by.AA11[5], by.AA11[6], by.AA11[7]], [150, 6, '2026-11-18', '2026-11-19']);
  assert.deepEqual([by.BB22[1], by.BB22[2], by.BB22[3], by.BB22[4], by.BB22[5]], ['V9', 'SHYAM', '7', 25, 2]);
  assert.deepEqual([by.CC33[4], by.CC33[6], by.CC33[7]], [9, '2026-11-19', '2026-11-19']);
});

test('older report arriving late never moves Last Toll Date backwards; Date objects from Sheets are normalised', () => {
  const rows = [['AA11', 'V1', 'RAM', '1', 10, 1, new Date(2026, 10, 18), new Date(2026, 10, 19)]];
  const r = X.tollMergeRows_(rows, { AA11: { vrn: 'V1', an: 'RAM', ai: '1', amt: 5, n: 1 } }, '2026-11-17');
  assert.equal(r.rows[0][6], '2026-11-17'); assert.equal(r.rows[0][7], '2026-11-19'); assert.equal(r.rows[0][4], 15);
});

test('script keeps one-row-per-tag + log-before-notify + per-day idempotency guards', () => {
  assert.match(src, /String\(r\[8\]\) === 'OK'/, 'IMPORT_LOG se report-date dedupe');
  assert.match(src, /headers: \{ Range:/, 'Range se tukdon me download (220 MB file)');
  assert.match(src, /api\/push\/toll-import/, 'dashboard webhook');
});

test('dashboard side: secret-guarded webhook + info endpoint + Home row + notification', () => {
  const srv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(srv, /p === '\/api\/push\/toll-import' && method === 'POST'/);
  assert.match(srv, /Toll import webhook unauthorized/);
  assert.match(srv, /Toll Tags import ho gaya/);
  assert.match(srv, /p === '\/api\/toll-import-info'/);
  const home = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8');
  assert.match(home, /key: 'toll-tags'/);
});
