/* v3.32 — Unusual activity rules, PDF container, tag-request label PDF + TL record, retry wiring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { documentElement: { dataset: {}, style: {} }, body: { classList: { add() {}, remove() {} } }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, getContext: () => null }) };
globalThis.addEventListener = () => {};
['config', 'util', 'unusual', 'pdf'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const d = (key, agent, n, extra) => ({ key, ym: key.slice(0, 7), channel: 'First Forward', agentId: agent, agentName: agent, tlName: 'TL1', n, type: 'ISSUANCE', vrnType: 'New', ...(extra || {}) });

test('unusual: flags high wrong-VRN / replacement / chassis agents, leaves normal agents alone', () => {
  const rows = [];
  for (let i = 1; i <= 9; i++) { // 9 normal agents: 40 issuance, 1 wrong each
    for (let k = 1; k <= 4; k++) rows.push(d(`2026-09-0${k}`, `N${i}`, 10));
    rows.push(d('2026-09-05', `N${i}`, 1, { vrnType: 'Wrong VRN' }));
  }
  rows.push(d('2026-09-01', 'BAD', 20), d('2026-09-02', 'BAD', 10, { vrnType: 'Wrong VRN' }), d('2026-09-03', 'BAD', 10, { vrnType: 'Chassis No' }), d('2026-09-04', 'BAD', 15, { type: 'REPLACEMENT' }));
  // `today` pin karo — warna calendar date badalne par last30 window shift ho jaata hai aur fixture
  // (Sept 2026) window se bahar chala jaata hai (date-dependent flaky test).
  const out = FF.unusual.analyze(rows, { period: 'last30', today: '2026-09-30', mult: 2, min: 3 });
  const bad = out.rows.find((r) => r.id === 'BAD');
  assert.ok(bad.flags.includes('wrong') && bad.flags.includes('chassis') && bad.flags.includes('replace'), bad.flags.join());
  assert.equal(out.rows.filter((r) => r.flags.length && r.id !== 'BAD').length, 0);
  assert.equal(out.rows[0].id, 'BAD'); // highest score first
});

test('unusual: single-day spike needs >= 10 tags and 3x own average', () => {
  const rows = ['01', '02', '03', '04', '05'].map((k) => d(`2026-09-${k}`, 'S', 2));
  rows.push(d('2026-09-06', 'S', 30));
  const out = FF.unusual.analyze(rows, { period: 'last30', today: '2026-10-01' });
  assert.ok(out.rows[0].flags.includes('spike'));
});

test('unusual presets use calendar dates, not latest available data', () => {
  const today = '2026-10-01';
  const row = d('2026-09-28', 'A', 1);
  assert.deepEqual(FF.unusual.resolveRange([row], { period: 'today', today }), { from: today, to: today, label: 'Today (01 Oct 2026)' });
  assert.equal(FF.unusual.resolveRange([row], { period: 'yesterday', today }).from, '2026-09-30');
  assert.deepEqual([FF.unusual.resolveRange([row], { period: 'last', today }).from, FF.unusual.resolveRange([row], { period: 'last', today }).to], ['2026-09-01', '2026-09-30']);
  assert.deepEqual([FF.unusual.resolveRange([], { period: 'last7', today }).from, FF.unusual.resolveRange([], { period: 'last7', today }).to], ['2026-09-25', today]);
  assert.deepEqual([FF.unusual.resolveRange([], { period: 'last30', today }).from, FF.unusual.resolveRange([], { period: 'last30', today }).to], ['2026-09-02', today]);
});

test('unusual flags malformed VRNs and duplicate VRNs with channel peer thresholds and exact counts', () => {
  const rows = [];
  const days = ['05', '06', '07', '08'];
  for (const agent of ['N1', 'N2', 'N3', 'N4', 'BAD', 'DUP']) {
    days.forEach((day) => rows.push(d(`2026-09-${day}`, agent, 10)));
  }
  const vrnRecords = [];
  for (let i = 1; i <= 5; i++) vrnRecords.push({ ch: 'ff', key: '2026-09-06', vrn: 'AB', tagId: `BAD-${i}`, cls: 'VC4', vrnType: 'New', agentId: 'BAD', agentName: 'BAD', tlName: 'TL1' });
  vrnRecords.push(
    { ch: 'ff', key: '2026-09-05', vrn: 'RJ14CA1234', tagId: 'DUP-1', cls: 'VC4', vrnType: 'New', agentId: 'DUP', agentName: 'DUP', tlName: 'TL1' },
    { ch: 'ff', key: '2026-09-06', vrn: 'RJ14CA1234', tagId: 'DUP-2', cls: 'VC4', vrnType: 'New', agentId: 'DUP', agentName: 'DUP', tlName: 'TL1' }
  );
  const model = FF.unusual.analyze(rows, { period: 'last30', mult: 2, min: 3, today: '2026-10-01', vrnRecords });
  const bad = model.rows.find((r) => r.id === 'BAD');
  const dup = model.rows.find((r) => r.id === 'DUP');
  assert.ok(bad.flags.includes('wrong'), `malformed VRNs should flag: ${bad.flags}`);
  assert.equal(bad.invalidVrn, 5);
  assert.equal(bad.wrong, 5, 'Wrong/invalid count is a union; malformed records are not discarded as too short');
  assert.equal(bad.invalidList.length, 5);
  assert.ok(dup.flags.includes('double'));
  assert.equal(dup.doubleVrn, 2);
  assert.equal(model.duplicateVrns.length, 1);
  assert.equal(model.tagSums.wrong, 5, 'KPI tag total only includes agents flagged in that category');
});

test('pdf: build() makes a valid multi-object PDF container from canvases', () => {
  const fake = { width: 10, height: 10, toDataURL: () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' };
  const blob = FF.pdf.build([fake, fake]);
  assert.equal(blob.type, 'application/pdf');
  return blob.arrayBuffer().then((buf) => {
    const txt = Buffer.from(buf).toString('latin1');
    assert.match(txt, /^%PDF-1\.4/);
    assert.match(txt, /\/Count 2/);
    assert.match(txt, /startxref\n\d+\n%%EOF$/);
    assert.equal((txt.match(/\/DCTDecode/g) || []).length, 2);
  });
});

test('wiring: print popup no longer relies on inline script (CSP), PDF buttons + TL/dispatch name exist', () => {
  const tr = read('tagRequest.js'), srv = read('server.js'), lazy = read('lazy.js'), app = read('app.js');
  assert.ok(!/<script>\(function\(\)\{\s*var H=/.test(tr), 'inline script must be gone');
  assert.match(tr, /wireLabelWindow/);
  assert.match(tr, /data-tr-bulk="pdf"/);
  assert.match(tr, /data-tr-a="dispatchName"/);
  assert.match(srv, /dispatchName/);
  assert.match(lazy, /ffAgentSummary: \['pdf', 'agentSummary'\]/);
  assert.match(app, /id: 'gvAgentSummary'/); assert.match(app, /id: 'unusual'/);
  assert.match(srv, /key: 'agentSummary'/); assert.match(srv, /key: 'unusual'/);
  assert.match(read('store.js'), /scheduleRetry/); assert.match(read('gv.js'), /scheduleRetry/); assert.match(read('data.js'), /Auto-retry/);
});
