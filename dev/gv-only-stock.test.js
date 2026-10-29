// v3.124.6 — Home KPI card `GV tags · not in FF stock` (#hm-gvonly):
//   • Scope = all GV in-stock tags in Tag Assignment (both assigned & "Not Assigned", matching GV Partner · Stock in field;
//     out-of-stock statuses like ISSUED / RETURNED / BLOCKED excluded).
//   • Match rule = strictly by Barcode / Serial (`barcode_only`): count every GV in-stock tag whose normalized SERIAL_NUMBER
//     does not exist anywhere in FF StockDataa's BARCODE column (even if TAG_ID exists in StockDataa, and even if StockDataa
//     has barcodes on blank-TAG_ID or Office-stock rows).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildStockAgeIndex,
  createStockAgeBuilder,
  gvOnlySummary,
  mapRows,
  normBarcode,
  isGvInStock,
  GVONLY_REMARK_NONE,
  GVONLY_REMARK_UNASSIGNED
} from '../stock-age.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('normBarcode normalizes leading zeros, decimals, hyphens, scientific notation, and rejects placeholders', () => {
  assert.equal(normBarcode('00608116-00101.0'), '60811600101');
  assert.equal(normBarcode('60811600101'), '60811600101');
  assert.equal(normBarcode('1.2345e+11'), '123450000000');
  assert.equal(normBarcode('0000'), '');
  assert.equal(normBarcode('Not Assigned'), '');
  assert.equal(normBarcode('BARCODE'), '');
  assert.equal(normBarcode('x'), '');
  assert.equal(normBarcode('1'), '1');
});

test('gvOnly counts all GV in-stock tags (including Not Assigned) whose barcode is missing from FF StockDataa BARCODE', () => {
  const ff = [
    // 1. Matched in FF field stock by barcode
    { id: '1', tagId: 'TAG-BOTH', barcode: '60811600101', cls: 'VC4', agentId: '70100', agentName: 'Rahul', tl: 'Sandeep' },
    // 2. Matched in FF office stock by barcode (in StockDataa BARCODE -> MUST NOT be in gvOnly)
    { id: '2', tagId: 'TAG-OFF', barcode: '00608116-00102.0', cls: 'VC4', agentId: '', agentName: '', tl: 'ApnaPayment Pvt. Ltd.' },
    // 3. TAG_ID matches TAG-SAME-ID, but BARCODE is blank in StockDataa -> GV barcode 60811600103 is NOT in FF BARCODE -> MUST count!
    { id: '3', tagId: 'TAG-SAME-ID', barcode: '', cls: 'VC4', agentId: '70100', agentName: 'Rahul', tl: 'Sandeep' },
    // 4. Blank TAG_ID row in StockDataa that DOES have barcode 60811600104 -> barcode exists in StockDataa -> MUST NOT be in gvOnly
    { id: '4', tagId: '', barcode: '60811600104', cls: 'VC20', agentId: '', agentName: '', tl: '' }
  ];
  const gv = [
    // Present in FF field barcode -> excluded
    { cls: '4', tagId: 'TAG-BOTH', serial: '60811600101', status: 'IN STOCK', agentId: '9001', agentName: 'GV One', tlName: 'GV TL' },
    // Present in FF office barcode (formatted differently) -> excluded
    { cls: '4', tagId: 'TAG-OFF-DIFF-ID', serial: '60811600102', status: 'AVAILABLE', agentId: '9001', agentName: 'GV One', tlName: 'GV TL' },
    // Same TAG_ID in FF, but FF barcode is blank -> included (barcode_only rule!)
    { cls: '4', tagId: 'TAG-SAME-ID', serial: '60811600103', status: 'IN STOCK', agentId: '9002', agentName: 'GV Two', tlName: 'GV TL' },
    // Present on blank-TAG_ID FF row -> excluded
    { cls: '20', tagId: 'TAG-HAS-FF-BC', serial: '60811600104', status: 'IN STOCK', agentId: 'Not Assigned', agentName: 'Not Assigned', tlName: 'Not Assigned' },
    // GV Assigned, barcode missing in FF -> included
    { cls: '20', tagId: 'TAG-MISS-1', serial: '60811600105', status: 'AVAILABLE', agentId: '9003', agentName: 'GV Three', tlName: 'GV TL' },
    // GV Not Assigned (in-stock in GV Partner · Stock in field), barcode missing in FF -> included!
    { cls: '4', tagId: 'TAG-UNASSIGNED-1', serial: '60811600106', status: 'AVAILABLE', agentId: 'Not Assigned', agentName: 'Not Assigned', tlName: 'Not Assigned' },
    // GV blank TAG_ID but valid in-stock barcode missing in FF -> included!
    { cls: '12', tagId: '', serial: '60811600107', status: 'IN STOCK', agentId: '', agentName: '', tlName: '' },
    // Out-of-stock status rows in GV -> excluded!
    { cls: '4', tagId: 'TAG-ISSUED', serial: '60811600108', status: 'ISSUED', agentId: '9004', agentName: 'GV Four', tlName: 'GV TL' },
    { cls: '4', tagId: 'TAG-RETURNED', serial: '60811600109', status: 'RETURNED', agentId: 'Not Assigned', agentName: 'Not Assigned', tlName: '' },
    // Duplicate of TAG-MISS-1 barcode -> deduplicated
    { cls: '20', tagId: 'TAG-MISS-1-DUP', serial: '0060811600105.0', status: 'AVAILABLE', agentId: '9003', agentName: 'GV Three', tlName: 'GV TL' }
  ];

  const idx = buildStockAgeIndex({ ffRows: ff, gvRows: gv, todayDay: 20000 });
  const sum = gvOnlySummary(idx);

  assert.equal(sum.total, 4);
  assert.equal(sum.notIn, 4);
  assert.equal(sum.assigned, 2);
  assert.equal(sum.unassigned, 2);
  assert.equal(sum.office, 0);
  assert.equal(idx.map.gv.notInStockData, 4);
  assert.equal(idx.map.gv.outStatus, 2);

  const byCls = Object.fromEntries(sum.rows.map((r) => [r.cls, r.n]));
  assert.deepEqual(byCls, { VC12: 1, VC4: 2, VC20: 1 });

  const list = mapRows(idx, { bucket: 'gvonly' });
  assert.equal(list.length, 4);
  const byBc = Object.fromEntries(list.map((r) => [r.barcode, r]));
  assert.equal(byBc['60811600103'].remark, GVONLY_REMARK_NONE);
  assert.equal(byBc['60811600105'].remark, GVONLY_REMARK_NONE);
  assert.equal(byBc['60811600106'].remark, GVONLY_REMARK_UNASSIGNED);
  assert.equal(byBc['60811600107'].remark, GVONLY_REMARK_UNASSIGNED);

  assert.equal(mapRows(idx, { bucket: 'gvonly', cls: 'VC4' }).length, 2);
  assert.equal(mapRows(idx, { bucket: 'gvonly', q: 'not assigned' }).length, 2);
  assert.equal(mapRows(idx, { bucket: 'gvonly', q: '60811600105' }).length, 1);
});

test('custom gvOutWords are respected by createStockAgeBuilder and isGvInStock', () => {
  assert.equal(isGvInStock({ status: 'SCRAPPED' }, ['SCRAP']), false);
  assert.equal(isGvInStock({ status: 'AVAILABLE' }, ['SCRAP']), true);

  const b = createStockAgeBuilder({ todayDay: 20000, gvOutWords: ['SCRAP'] });
  b.addFf([{ id: '1', tagId: 'T1', barcode: '90001', cls: 'VC4' }]);
  b.addGv([
    { cls: '4', tagId: 'T2', serial: '90002', status: 'SCRAPPED', agentName: 'A' },
    { cls: '4', tagId: 'T3', serial: '90003', status: 'AVAILABLE', agentName: 'Not Assigned' }
  ]);
  const idx = b.finish();
  const sum = gvOnlySummary(idx);
  assert.equal(sum.total, 1);
  assert.equal(sum.unassigned, 1);
  assert.equal(mapRows(idx, { bucket: 'gvonly' })[0].barcode, '90003');
});

test('server /api/stock-map + tags + csv preserve gviz numeric barcodes (v vs scientific f) and refresh on ?fresh=1', async () => {
  let extraGv = [];
  const ffSrc = [
    // Numeric barcode in StockDataa whose formatted string `f` was truncated scientific notation ("6.08E+10"),
    // while `v` holds the exact integer 60811600999 -> identifierText MUST preserve 60811600999!
    { A: '5845036', C: 'FF-T1', D: { v: 60811600999, f: '6.08E+10' }, E: '4', G: '01-10-2026', H: '701', I: 'Agent A', J: '', K: 'TL A' },
    // Blank TAG_ID row in StockDataa with barcode 60811600888 -> query `C is not null or D is not null` includes it!
    { A: '5845036', C: '', D: '60811600888', E: '4', G: '01-10-2026', H: '', I: '', J: '', K: '' }
  ];
  const baseGv = [
    // Matches FF-T1 barcode 60811600999 -> NOT missing
    { A: 'VC4', B: 'GV-1', C: '60811600999', D: 'In Stock', E: 'APS1', F: 'GV Agent', G: 'TL1', H: 'GV TL' },
    // Matches blank-TAG_ID FF barcode 60811600888 -> NOT missing
    { A: 'VC4', B: 'GV-2', C: '60811600888', D: 'In Stock', E: 'Not Assigned', F: 'Not Assigned', G: '', H: '' },
    // Missing in FF, GV Not Assigned -> counted!
    { A: 'VC4', B: 'GV-3', C: { v: 60811600777, f: '6.08E+10' }, D: 'In Stock', E: 'Not Assigned', F: 'Not Assigned', G: '', H: '' },
    // Issued in GV -> excluded!
    { A: 'VC4', B: 'GV-4', C: '60811600666', D: 'ISSUED', E: 'APS2', F: 'GV Two', G: 'TL1', H: 'GV TL' }
  ];
  const queries = [];
  const upstream = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const sheet = u.searchParams.get('sheet') || '';
    const tq = u.searchParams.get('tq') || '';
    queries.push({ sheet, tq });
    const letters = ((/select (.+?)(?: where | limit | offset |$)/i.exec(tq) || [])[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
    const offsetM = /\boffset (\d+)/.exec(tq), limitM = /\blimit (\d+)/.exec(tq);
    const off = offsetM ? Number(offsetM[1]) : 0, lim = limitM ? Number(limitM[1]) : undefined;
    const all = sheet === 'StockDataa' ? ffSrc : sheet === 'Tag Assignment' ? baseGv.concat(extraGv) : [];
    const slice = all.slice(off, lim ? off + lim : undefined);
    const cellObj = (x) => (x && typeof x === 'object' && 'v' in x ? x : { v: x ?? '' });
    const body = `google.visualization.Query.setResponse(${JSON.stringify({
      status: 'ok',
      table: {
        cols: letters.map((id) => ({ id, label: id, type: 'string' })),
        rows: slice.map((r) => ({ c: letters.map((L) => cellObj(r[L])) }))
      }
    })});`;
    res.setHeader('Content-Type', 'text/plain');
    res.end(body);
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upUrl = `http://127.0.0.1:${upstream.address().port}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-gvo-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: upUrl, RENDER: '', STOCK_AGE_WARM: '0', STOCK_AGE_WAIT_MS: '15000' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', (d) => { logs += d; });
  try {
    const base = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`startup timeout ${logs}`)), 15000);
      child.stdout.on('data', (d) => { logs += d; const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m && m[1] !== '0') { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); } });
    });
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ username: 'owner', password: 'initial-password' }) });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const H = { cookie, 'X-Forwarded-Proto': 'https' };

    const map1 = await (await fetch(`${base}/api/stock-map`, { headers: H })).json();
    assert.equal(map1.ok, true);
    assert.equal(map1.gvOnly.total, 1);
    assert.equal(map1.gvOnly.unassigned, 1);
    assert.equal(map1.gvOnly.assigned, 0);

    // Check gviz WHERE clause queried both Tag ID and Barcode/Serial columns
    assert.ok(queries.some((q) => q.sheet === 'StockDataa' && /C is not null or D is not null/i.test(q.tq)));
    assert.ok(queries.some((q) => q.sheet === 'Tag Assignment' && /B is not null or C is not null/i.test(q.tq)));

    const tags1 = await (await fetch(`${base}/api/stock-map/tags?bucket=gvonly&all=1`, { headers: H })).json();
    assert.equal(tags1.total, 1);
    assert.equal(tags1.rows[0].barcode, '60811600777');
    assert.equal(tags1.rows[0].remark, GVONLY_REMARK_UNASSIGNED);

    const csv1 = await (await fetch(`${base}/api/stock-map/csv?bucket=gvonly`, { headers: H })).text();
    assert.match(csv1, /60811600777/);
    assert.match(csv1, /GV Not Assigned/);

    // Add a new assigned GV tag missing in FF and verify ?fresh=1 rebuilds the index
    extraGv = [{ A: 'VC20', B: 'GV-5', C: '60811600555', D: 'AVAILABLE', E: 'APS9', F: 'GV Nine', G: 'TL1', H: 'GV TL' }];
    let map2 = null;
    for (let i = 0; i < 30; i++) {
      map2 = await (await fetch(`${base}/api/stock-map${i === 0 ? '?fresh=1' : ''}`, { headers: H })).json();
      if (!map2.pending && !map2.building && map2.gvOnly && map2.gvOnly.total === 2) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(map2.gvOnly.total, 2);
    assert.equal(map2.gvOnly.assigned, 1);
    assert.equal(map2.gvOnly.unassigned, 1);

    // A list as large as the Home KPI must not be cut off at the default 300-row page.
    extraGv = Array.from({ length: 5630 }, (_, i) => ({ A: 'VC4', B: `BULK-${i}`, C: String(70000000000 + i), D: 'AVAILABLE', E: 'APS9', F: 'GV Nine', G: 'TL1', H: 'GV TL' }));
    let bulk;
    for (let i = 0; i < 60; i++) {
      bulk = await (await fetch(`${base}/api/stock-map${i === 0 ? '?fresh=1' : ''}`, { headers: H })).json();
      if (!bulk.pending && !bulk.building && bulk.gvOnly?.total === 5631) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(bulk.gvOnly.total, 5631);
    const all = await (await fetch(`${base}/api/stock-map/tags?bucket=gvonly&all=1`, { headers: H })).json();
    assert.equal(all.total, 5631);
    assert.equal(all.rows.length, 5631);
    const csv = await (await fetch(`${base}/api/stock-map/csv?bucket=gvonly`, { headers: H })).text();
    assert.equal(csv.trim().split('\r\n').length, 5632); // header + every matching tag
    assert.match(csv, /BULK-5629/);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => {});
    upstream.close();
    upstream.closeAllConnections?.();
  }
});
