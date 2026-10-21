/* 🆕 New IDs — EIR agents jo Agent master (Sheet4) me nahi: server endpoint + summary + settings validation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wait = (child, re) => new Promise((resolve, reject) => {
  let logs = ''; const t = setTimeout(() => reject(new Error(`timeout ${logs}`)), 25000);
  const on = (d) => { logs += d; const m = logs.match(re); if (m) { clearTimeout(t); resolve(m); } };
  child.stdout.on('data', on); child.stderr.on('data', on);
});

test('/api/new-ids: Sheet4 me missing agents (mock: 3) + summary + validation', async () => {
  const mock = spawn(process.execPath, ['dev/mock-gviz.js'], { cwd: ROOT, env: { ...process.env, MOCK_PORT: '19157', MOCK_AGENTS: '60' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await wait(mock, /mock gviz on :19157/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-nid-'));
  const app = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: 'http://127.0.0.1:19157', RENDER: '', STOCK_AGE_WARM: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const m = await wait(app, /http:\/\/0\.0\.0\.0:(\d+)/);
    const base = `http://127.0.0.1:${m[1]}`;
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ username: 'owner', password: 'initial-password' }) });
    const H = { cookie: (login.headers.get('set-cookie') || '').split(';')[0], 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' };
    const bad = await fetch(`${base}/api/settings`, { method: 'PUT', headers: H, body: JSON.stringify({ agentRegistry: { gid: 'abc' } }) });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${base}/api/settings`, { method: 'PUT', headers: H, body: JSON.stringify({ agentRegistry: { gid: '557', idCol: 'A', legacyCol: 'B' } }) });
    assert.equal(ok.status, 200);
    let out;
    for (let i = 0; i < 10; i++) { out = await (await fetch(`${base}/api/new-ids`, { headers: H })).json(); if (!out.pending) break; await new Promise((r) => setTimeout(r, 1000)); }
    assert.equal(out.ok, true, JSON.stringify(out).slice(0, 300));
    assert.equal(out.summary.count, 3, `rows=${out.rows && out.rows.length}`);
    assert.ok(out.rows.every((r) => r.id && r.total > 0 && Object.keys(r.months).length));
    assert.equal(out.rows.reduce((t, r) => t + r.total, 0), out.summary.tags);
    const sm = await (await fetch(`${base}/api/new-ids?summary=1`, { headers: H })).json();
    assert.equal(sm.summary.count, 3); assert.equal(sm.rows, undefined);
  } finally {
    app.kill('SIGTERM'); mock.kill('SIGTERM'); await Promise.all([once(app, 'exit'), once(mock, 'exit')]).catch(() => {});
  }
});
