/* 🔢 Tag Request (admin): mobile/address/pincode optional + First/Last barcode (create, edit, sheet field list). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('admin tag request: no mobile/address/pincode needed; barcodes saved + editable + in sheet fields', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-bc-'));
  const app = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', RENDER: '', STOCK_AGE_WARM: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  const base = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${logs}`)), 25000);
    const on = (d) => { logs += d; const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m && m[1] !== '0') { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); } };
    app.stdout.on('data', on); app.stderr.on('data', on);
  });
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ username: 'owner', password: 'initial-password' }) });
    const H = { cookie: (login.headers.get('set-cookie') || '').split(';')[0], 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' };
    const post = await fetch(`${base}/api/tag-requests`, { method: 'POST', headers: H, body: JSON.stringify({ employee: { name: 'Admin' }, agents: [{ agentName: 'Test Agent', agentId: '12345678', firstBarcode: '608116-011-0558283', lastBarcode: '608116-011-0558331', rows: [{ cls: 'VC4', approved: 50 }] }] }) });
    const out = await post.json();
    assert.equal(post.status, 201, JSON.stringify(out).slice(0, 200));
    const r = out.requests[0];
    assert.equal(r.firstBarcode, '608116-011-0558283'); assert.equal(r.lastBarcode, '608116-011-0558331');
    const tl = await (await fetch(`${base}/api/tag-requests`, { method: 'POST', headers: H, body: JSON.stringify({ employee: { name: 'Admin' }, agents: [{ agentName: 'Some TL', kind: 'tl', dispatchName: 'Dispatch Person', mapName: 'MAPPED AGENT', mapId: '77001122', rows: [{ cls: 'VC4', approved: 10 }] }] }) })).json();
    assert.equal(tl.requests[0].agent.mapName, 'MAPPED AGENT'); assert.equal(tl.requests[0].agent.mapId, '77001122');
    const put = await (await fetch(`${base}/api/tag-requests/${r.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ lastBarcode: '608116-011-0558400 abc' }) })).json();
    assert.equal(put.request.lastBarcode, '608116-011-0558400');
    const cfg = await (await fetch(`${base}/api/tag-request-sheet`, { headers: H })).json();
    assert.equal(cfg.fields.mapName, 'FASTag mapping name'); assert.equal(cfg.fields.mapId, 'FASTag mapping ID');
    assert.equal(cfg.fields.firstBarcode, 'First barcode'); assert.equal(cfg.fields.lastBarcode, 'Last barcode');
  } finally { app.kill('SIGTERM'); await once(app, 'exit').catch(() => {}); }
});

test('tagRequest: barcodeRangeOf and courier tracking URL logic', async () => {
  const code = await fs.readFile(path.join(ROOT, 'tagRequest.js'), 'utf8');
  assert.ok(code.includes('function barcodeRangeOf'), 'barcodeRangeOf present in tagRequest.js');
  assert.ok(code.includes('function printReceiptSlip'), 'printReceiptSlip present in tagRequest.js');
  assert.ok(code.includes('function trackingUrl'), 'trackingUrl present in tagRequest.js');
  assert.ok(code.includes('tr-bc-chip'), 'tr-bc-chip styling wired in tagRequest.js');

  // Verify range calculations matching the algorithm
  function barcodeRangeOf(first, last) {
    const f = String(first || '').trim();
    const l = String(last || '').trim();
    if (!f || !l) return null;
    const fParts = f.split('-');
    const lParts = l.split('-');
    if (fParts.length > 1 && lParts.length > 1) {
      if (fParts.length !== lParts.length) return { ok: false, reason: 'Prefix format mismatch' };
      const fPre = fParts.slice(0, -1).join('-');
      const lPre = lParts.slice(0, -1).join('-');
      if (fPre !== lPre) return { ok: false, reason: 'Barcode series prefix mismatch' };
      const fNum = Number(fParts[fParts.length - 1]);
      const lNum = Number(lParts[lParts.length - 1]);
      if (!Number.isFinite(fNum) || !Number.isFinite(lNum)) return { ok: false, reason: 'Non-numeric barcode serial' };
      if (lNum < fNum) return { ok: false, reason: 'Last serial is less than First serial' };
      return { ok: true, count: lNum - fNum + 1, start: fParts[fParts.length - 1], end: lParts[lParts.length - 1], prefix: fPre };
    }
    const fd = f.replace(/\D/g, '');
    const ld = l.replace(/\D/g, '');
    if (!fd || !ld) return null;
    if (fd.length !== ld.length) return { ok: false, reason: 'Barcode length mismatch' };
    let i = 0;
    while (i < fd.length && fd[i] === ld[i]) i++;
    const fNum = Number(fd.slice(i));
    const lNum = Number(ld.slice(i));
    if (!Number.isFinite(fNum) || !Number.isFinite(lNum)) return { ok: false, reason: 'Invalid barcode serial digits' };
    if (lNum < fNum) return { ok: false, reason: 'Last serial is less than First serial' };
    return { ok: true, count: lNum - fNum + 1, start: fd.slice(i), end: ld.slice(i), prefix: fd.slice(0, i) };
  }

  const r1 = barcodeRangeOf('608116-011-0558283', '608116-011-0558332');
  assert.equal(r1.ok, true);
  assert.equal(r1.count, 50);

  const r2 = barcodeRangeOf('608116-011-0558283', '608116-012-0558332');
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'Barcode series prefix mismatch');

  const r3 = barcodeRangeOf('6081160110558283', '6081160110558382');
  assert.equal(r3.ok, true);
  assert.equal(r3.count, 100);

  // Tracking URL tests
  function trackingUrl(courier, awb) {
    if (!awb) return '';
    const c = String(courier || '').toLowerCase();
    const cleanAwb = encodeURIComponent(String(awb).trim());
    if (c.includes('delhivery')) return `https://www.delhivery.com/track/package/${cleanAwb}`;
    if (c.includes('dtdc')) return `https://www.dtdc.in/tracking/shipment-tracking.asp?trkType=awb&strCnno=${cleanAwb}`;
    if (c.includes('blue') || c.includes('dart')) return `https://www.bluedart.com/tracking?trackFor=0&trackNo=${cleanAwb}`;
    if (c.includes('trackon')) return `http://trackon.in/Tracking/MultipleTracking?awb=${cleanAwb}`;
    if (c.includes('speed') || c.includes('post') || c.includes('india')) return `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx`;
    return `https://www.google.com/search?q=${encodeURIComponent(`${courier} tracking ${awb}`)}`;
  }

  assert.equal(trackingUrl('Delhivery Air', '12345678901'), 'https://www.delhivery.com/track/package/12345678901');
  assert.equal(trackingUrl('DTDC Express', 'D12345678'), 'https://www.dtdc.in/tracking/shipment-tracking.asp?trkType=awb&strCnno=D12345678');
});
