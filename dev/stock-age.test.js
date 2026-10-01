/* 🧓 v3.31 — Stock ageing server side: StockDataa (FF) + Tag Assignment (GV) → compact bucket index.
   Pure functions (stock-age.js) + /api/stock-age endpoints (login, summary, tag list). */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStockDay, groupOf, buildStockAgeIndex, summaryOf, tagsFor, AGE_THRESH } from '../stock-age.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400e3;
const TODAY = Date.UTC(2026, 9, 1) / DAY;                     // 1 Oct 2026
const ago = (n) => { const d = new Date((TODAY - n) * DAY); return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()} 10:00:00 IST`; };

test('parseStockDay: sheet ke saare date formats', () => {
  assert.equal(parseStockDay('11-07-2025 18:38:03 IST'), Date.UTC(2025, 6, 11) / DAY, 'DD-MM-YYYY (StockDataa)');
  assert.equal(parseStockDay('Date(2026,8,30,10,5,0)'), Date.UTC(2026, 8, 30) / DAY, 'gviz Date()');
  assert.equal(parseStockDay('2026-09-30'), Date.UTC(2026, 8, 30) / DAY);
  assert.equal(parseStockDay('30/09/26'), Date.UTC(2026, 8, 30) / DAY);
  assert.equal(parseStockDay('30-Sep-2026'), Date.UTC(2026, 8, 30) / DAY);
  assert.equal(parseStockDay(''), 0);
  assert.equal(parseStockDay('kal'), 0);
  assert.equal(groupOf('4'), 0); assert.equal(groupOf('VC20'), 0); assert.equal(groupOf('16'), 1); assert.equal(groupOf('VC5'), 1);
});

const ffRows = [
  { id: 'H', tagId: 'TAG_ID', barcode: 'BARCODE', cls: 'TAG_CLASS', agentId: 'AGENT_ID', agentName: 'AGENT_NAME', agentDate: 'AGENT_ALLOCATED_AT', tl: 'TL Name' },   // header row (gviz)
  { id: '5845036', tagId: 'T1', barcode: '608116-011-0000001', cls: '4', bcDate: ago(12), agentId: '537700000000000001', agentName: 'Ravi Kumar', agentDate: ago(10), tl: 'TL One' },
  { id: '5845036', tagId: 'T2', barcode: '608116-011-0000002', cls: '4', bcDate: ago(45), agentId: '537700000000000001', agentName: 'Ravi Kumar', agentDate: ago(40), tl: 'TL One' },
  { id: '5845036', tagId: 'T3', barcode: '608116-011-0000003', cls: '12', bcDate: ago(100), agentId: '537700000000000001', agentName: 'Ravi Kumar', agentDate: '', tl: 'TL One' },     // agent date khaali → BC
  { id: '5845036', tagId: 'T4', barcode: '608116-011-0000004', cls: '20', bcDate: ago(200), agentId: '537700000000000001', agentName: 'Ravi Kumar', agentDate: ago(195), tl: 'TL One' },
  { id: '5845036', tagId: 'T5', barcode: '608116-011-0000005', cls: '5', bcDate: '', agentId: '537700000000000002', agentName: 'Sita Devi', agentDate: '', tl: 'TL One' },          // koi date nahi
  // master / GV parked (agent khaali, ApnaPayment TL) — GV tags isi BC date se age paate hain
  { id: '5845036', tagId: 'GVT1', barcode: '608116-039-0534277', cls: '4', bcDate: ago(26), agentId: '', agentName: '', agentDate: '', tl: 'ApnaPayment Pvt. Ltd.' },
  { id: '5845036', tagId: 'GVT2', barcode: '6081160390534278', cls: '7', bcDate: ago(160), agentId: '', agentName: '', agentDate: '', tl: 'ApnaPayment Pvt. Ltd.' }
];
const gvRows = [
  { cls: 'VEHICLE_CLASS', tagId: 'TAG_ID', serial: 'SERIAL_NUMBER', agentId: 'AGENT_ID', agentName: 'AGENT_NAME' },                                                      // header row
  { cls: 'VC4', tagId: 'GVT1', serial: 'x', status: 'In Stock', agentId: 'APS01662', agentName: 'Suneel Kumar', tlId: 'APS09675', tlName: 'Sheela Prajapat' },          // tag ID match
  { cls: 'VC7', tagId: 'NOPE', serial: '608116-039-0534278', status: 'In Stock', agentId: 'APS01662', agentName: 'Suneel Kumar', tlId: 'APS09675', tlName: 'Sheela Prajapat' }, // serial ↔ barcode (digits) match
  { cls: 'VC5', tagId: 'GV-UNKNOWN', serial: '608116-999-0000000', status: 'In Stock', agentId: 'APS02000', agentName: 'Direct Dev', tlId: '', tlName: '' },             // match nahi → date nahi
  { cls: 'VC4', tagId: 'GV-OWN', serial: '1', status: 'In Stock', agentId: 'APS02000', agentName: 'Direct Dev', tlId: '', tlName: '', date: ago(400) }                   // sheet ki apni date
];

test('buildStockAgeIndex: FF agent / TL / field / parked buckets (cumulative 1/3/5/6 mahine)', () => {
  const idx = buildStockAgeIndex({ ffRows, gvRows, todayDay: TODAY });
  assert.equal(idx.ff.total, 7, 'header row skip');
  assert.equal(idx.ff.unknown, 1, 'T5 ki date nahi');
  const ravi = idx.ff.agents.get('537700000000000001');
  assert.ok(ravi, 'agent key = digits(AGENT_ID)');
  assert.deepEqual(ravi.t, [3, 1], '🚗 VC4/VC20 = T1 T2 T4 · 🚚 = T3');
  // ages: T1 10 · T2 40 · T4 195 (core) · T3 100 (comm, BC fallback)
  assert.deepEqual(ravi.c[0], [2, 1, 1, 1], 'core ≥30: T2,T4 · ≥90: T4 · ≥150: T4 · ≥180: T4');
  assert.deepEqual(ravi.c[1], [1, 1, 0, 0], 'comm ≥30 + ≥90: T3 (100 din)');
  assert.deepEqual(ravi.o, [195, 100]);
  const sita = idx.ff.agents.get('537700000000000002');
  assert.deepEqual(sita.u, [0, 1], 'date-nahi tag total me hai, bucket me nahi');
  assert.equal(idx.ff.tls.get('TL ONE').t[0] + idx.ff.tls.get('TL ONE').t[1], 5);
  assert.equal(idx.ff.parked.t[0] + idx.ff.parked.t[1], 2, 'ApnaPayment / bina agent = parked');
  assert.equal(idx.ff.field.t[0] + idx.ff.field.t[1], 5);
  assert.deepEqual(AGE_THRESH, [30, 90, 150, 180]);
});

test('buildStockAgeIndex: GV tag ki umr StockDataa (tag ID / barcode = serial) se, warna sheet date / unknown', () => {
  const idx = buildStockAgeIndex({ ffRows, gvRows, todayDay: TODAY });
  assert.equal(idx.gv.total, 4);
  assert.equal(idx.gv.matched, 2, 'GVT1 tag ID se · NOPE serial↔barcode (sirf digits) se');
  assert.equal(idx.gv.own, 1, 'GV-OWN sheet ki date');
  assert.equal(idx.gv.unknown, 1);
  const su = idx.gv.agents.get('APS01662');
  assert.deepEqual(su.t, [1, 1]);
  assert.deepEqual(su.o, [26, 160]);
  assert.deepEqual(su.c[1], [1, 1, 1, 0], 'VC7 160 din: ≥1, ≥3, ≥5');
  assert.ok(idx.gv.tls.get('SHEELA PRAJAPAT'));
  assert.ok(idx.gv.tls.get('__direct__'), 'TL ID + naam khaali = direct');
  const dd = idx.gv.agents.get('APS02000');
  assert.deepEqual(dd.u, [0, 1]);
  assert.equal(dd.o[0], 400);
});

test('summaryOf + tagsFor: compact shape, agent / TL / months / group / unknown / field filters', () => {
  const idx = buildStockAgeIndex({ ffRows, gvRows, todayDay: TODAY });
  const sum = summaryOf(idx);
  assert.equal(sum.ok, true);
  assert.equal(sum.today, '2026-10-01');
  assert.ok(sum.ff.agents['537700000000000001'].a[0] > 0, 'avg age');
  assert.ok(sum.ff.field && sum.ff.parked);
  assert.equal(sum.gv.matched, 2);
  const byName = tagsFor(idx, { ch: 'ff', kind: 'agent', key: 'ravi kumar', months: 3 });
  assert.equal(byName.total, 2, 'naam se bhi · ≥3 mahine: T3 (100), T4 (195)');
  assert.deepEqual(byName.rows.map((r) => r.tagId), ['T4', 'T3'], 'sabse purana pehle');
  assert.equal(byName.rows[1].source, 'bc', 'T3 ki date BC Allocated At se');
  assert.equal(tagsFor(idx, { ch: 'ff', kind: 'agent', key: '537700000000000001', group: 'comm' }).total, 1);
  assert.equal(tagsFor(idx, { ch: 'ff', kind: 'tl', key: 'TL One', unknown: true }).total, 1, 'date-nahi wale');
  assert.equal(tagsFor(idx, { ch: 'ff', kind: 'field' }).total, 5);
  assert.equal(tagsFor(idx, { ch: 'ff', kind: 'parked', months: 5 }).total, 1, 'GVT2 160 din');
  assert.equal(tagsFor(idx, { ch: 'gv', kind: 'agents', keys: ['APS01662', 'Direct Dev'] }).total, 4);
  assert.equal(tagsFor(idx, { ch: 'gv', kind: 'all', months: 6 }).total, 1, 'GV-OWN 400 din');
  assert.equal(tagsFor(idx, { ch: 'ff', kind: 'all', limit: 2 }).rows.length, 2);
});

// ---- /api/stock-age endpoints (real server + tiny gviz upstream) -------------------------------------
function gvizBody(cols, rows) {
  return `google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: cols.map((id) => ({ id, label: id, type: 'string' })), rows: rows.map((r) => ({ c: r.map((v) => ({ v })) })) } })});`;
}
test('/api/stock-age: login zaroori · summary FF + GV · tag list endpoint', async () => {
  const upstream = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const sheet = u.searchParams.get('sheet') || '';
    if (sheet === 'StockDataa') return res.end(gvizBody(['A', 'C', 'D', 'E', 'G', 'H', 'I', 'J', 'K'], ffRows.slice(1).map((r) => [r.id, r.tagId, r.barcode, r.cls, r.bcDate || '', r.agentId, r.agentName, r.agentDate || '', r.tl])));
    if (sheet === 'Tag Assignment') return res.end(gvizBody(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], gvRows.slice(1).map((r) => [r.cls, r.tagId, r.serial, r.status, r.agentId, r.agentName, r.tlId, r.tlName])));
    return res.end(gvizBody(['A'], []));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-stockage-'));
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: `http://127.0.0.1:${upstream.address().port}`, RENDER: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stderr.on('data', (d) => { logs += d; });
  try {
    const base = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`startup timeout ${logs}`)), 10000);
      child.stdout.on('data', (d) => { logs += d; const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m && m[1] !== '0') { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); } });
    });
    const anon = await fetch(`${base}/api/stock-age`, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(anon.status, 401, 'bina login nahi');
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ username: 'owner', password: 'initial-password' }) });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const H = { cookie, 'X-Forwarded-Proto': 'https' };
    const sum = await (await fetch(`${base}/api/stock-age`, { headers: H })).json();
    assert.equal(sum.ok, true);
    assert.equal(sum.ff.total, 7);
    assert.equal(sum.gv.total, 4);
    assert.equal(sum.gv.matched, 2, 'GV tags StockDataa se match');
    assert.ok(sum.ff.agents['537700000000000001'], 'FF agent node');
    assert.ok(sum.gv.agents.APS01662, 'GV agent node');
    const tags = await (await fetch(`${base}/api/stock-age/tags?ch=ff&kind=agent&key=${encodeURIComponent('Ravi Kumar')}&months=1`, { headers: H })).json();
    assert.equal(tags.ok, true);
    assert.equal(tags.total, 3, '≥1 mahina: T2 T3 T4');
    assert.ok(tags.rows.every((r) => r.age >= 30));
    const gvTags = await (await fetch(`${base}/api/stock-age/tags?ch=gv&kind=agents&keys=APS01662|APS02000`, { headers: H })).json();
    assert.equal(gvTags.total, 4);
  } finally {
    child.kill('SIGTERM'); await once(child, 'exit').catch(() => {});
    upstream.close();
  }
});
