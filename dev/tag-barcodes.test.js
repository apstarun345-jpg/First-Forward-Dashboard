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
    const put = await (await fetch(`${base}/api/tag-requests/${r.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ lastBarcode: '608116-011-0558400 abc' }) })).json();
    assert.equal(put.request.lastBarcode, '608116-011-0558400');
    const cfg = await (await fetch(`${base}/api/tag-request-sheet`, { headers: H })).json();
    assert.equal(cfg.fields.firstBarcode, 'First barcode'); assert.equal(cfg.fields.lastBarcode, 'Last barcode');
  } finally { app.kill('SIGTERM'); await once(app, 'exit').catch(() => {}); }
});
