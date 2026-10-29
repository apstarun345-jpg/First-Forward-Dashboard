import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('welcome history respects verification, permissions, FF/GV scope, and fast cold shell', async () => {
  let slow = false, requests = [];
  const today = new Date(Date.now() + 5.5 * 3600e3); today.setUTCHours(0, 0, 0, 0);
  const yd = new Date(today); yd.setUTCDate(yd.getUTCDate() - 1);
  const date = `Date(${yd.getUTCFullYear()},${yd.getUTCMonth()},${yd.getUTCDate()})`;
  const mock = http.createServer((req, res) => {
    const tq = new URL(req.url, 'http://mock').searchParams.get('tq') || '';
    requests.push(tq);
    const isFirst = /select (?:L|AX), AU, min\(AA\)/i.test(tq);
    const isMonth = /select (?:L|AX), AU, count\(A\)/i.test(tq);
    const ff = tq.includes("'Nova FF'"), gv = tq.includes("'Nova GV'");
    const rows = [];
    if (isFirst || isMonth) {
      if (ff) rows.push({ c: [{ v: 'Nova FF' }, { v: '123' }, { v: isFirst ? date : 6 }] });
      if (gv) rows.push({ c: [{ v: 'Nova GV' }, { v: '5845036' }, { v: isFirst ? date : 9 }] });
      if (ff) rows.push({ c: [{ v: 'Wrong channel' }, { v: '5845036' }, { v: isFirst ? date : 999 }] });
    }
    const out = `google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: (isFirst || isMonth ? [{ id: 'name', type: 'string' }, { id: 'AU', type: 'string' }, { id: 'value', type: isFirst ? (tq.includes("'Text Date'") ? 'string' : 'date') : 'number' }] : ['AA', 'D', 'AU', 'BA', 'count'].map((id) => ({ id, type: 'string' }))), rows } })});`;
    if (slow) setTimeout(() => res.end(out), 1400); else res.end(out);
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pl-welcome-'));
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: `http://127.0.0.1:${mock.address().port}`, STOCK_AGE_WARM: '0', RENDER: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', (d) => { logs += d; });
  try {
    const base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(logs || 'timeout')), 15000); timeout.unref();
      child.stdout.on('data', (d) => { logs += d; const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m && m[1] !== '0') { clearTimeout(timeout); resolve(`http://127.0.0.1:${m[1]}`); } });
      child.on('exit', (code) => reject(new Error(`server exited ${code}: ${logs}`)));
    });
    const call = async (url, method = 'GET', data, cookie = '') => {
      const res = await fetch(base + url, { method, headers: { cookie, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: data ? JSON.stringify(data) : undefined });
      const text = await res.text(); let json = {}; try { json = JSON.parse(text); } catch {}
      return { res, text, json, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
    };
    const admin = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).cookie;
    const made = await call('/api/personal-links', 'POST', { kind: 'group', source: 'both', name: 'Nova team', personId: 'TEAM1', mobile: '9876543210', members: [{ name: 'Nova FF', source: 'ff' }, { name: 'Nova GV', source: 'gv' }], sections: ['issuance'] }, admin);
    assert.equal(made.res.status, 200); const token = made.json.link.token;
    const unauth = await call(`/p/${token}?welcome=1`);
    assert.doesNotMatch(unauth.text, /Nova FF|first recorded|"rows"/);
    const viewer = (await call('/api/public/personal-link/verify', 'POST', { token, personId: 'TEAM1', mobile: '9876543210' })).cookie;
    const all = await call(`/p/${token}?welcome=1`, 'GET', null, viewer);
    assert.equal(all.res.status, 200); assert.equal(all.json.team, true);
    assert.deepEqual(all.json.rows.map((r) => [r.name, r.source, r.first, r.month]).sort(), [
      ['Nova FF', 'ff', yd.toISOString().slice(0, 10), today.getUTCDate() === 1 ? 0 : 6],
      ['Nova GV', 'gv', yd.toISOString().slice(0, 10), today.getUTCDate() === 1 ? 0 : 9]
    ]);
    for (const src of ['ff', 'gv']) {
      const data = await call(`/p/${token}?welcome=1&ch=${src}`, 'GET', null, viewer);
      assert.deepEqual(data.json.rows.map((r) => r.source), [src]);
    }
    assert.ok(requests.some((q) => q.includes('min(AA)') && !q.includes('AA >= date')), 'first recorded date searches all EIR history');
    const page = await call(`/p/${token}?ch=ff`, 'GET', null, viewer);
    assert.match(page.text, /data-pl-welcome/);
    assert.match(page.text, /pb-wrap .pb-head h1 b/);
    assert.match((await call(`/p/${token}?ch=ff`, 'GET', null, viewer)).text, /data-pl-refresh/, 'cached page is visibly refreshed');
    const js = await call('/p-portal.js'); assert.doesNotThrow(() => new Function(js.text));
    assert.match(js.text, /first recorded activity is not a joining date/);
    assert.match(js.text, /EIR history could not be loaded/);
    const update = await call(`/api/personal-links/${made.json.link.id}`, 'PUT', { personId: 'TEAM1', mobile: '9876543210', sections: ['stock'] }, admin);
    assert.equal(update.res.status, 200);
    const viewer2 = (await call('/api/public/personal-link/verify', 'POST', { token, personId: 'TEAM1', mobile: '9876543210' })).cookie;
    assert.equal((await call(`/p/${token}?welcome=1`, 'GET', null, viewer2)).res.status, 403);
    assert.doesNotMatch((await call(`/p/${token}`, 'GET', null, viewer)).text, /data-pl-welcome/, 'revoked session does not see old content');

    // A fresh link with deliberately slow upstream responds with the authenticated skeleton first.
    const solo = await call('/api/personal-links', 'POST', { kind: 'agent', source: 'ff', name: 'Slow Agent', personId: 'AGENT2', mobile: '9876543210', sections: ['issuance'] }, admin);
    assert.equal(solo.res.status, 200); slow = true;
    const sToken = solo.json.link.token;
    const sViewer = (await call('/api/public/personal-link/verify', 'POST', { token: sToken, personId: 'AGENT2', mobile: '9876543210' })).cookie;
    const start = Date.now(); const cold = await call(`/p/${sToken}`, 'GET', null, sViewer); const elapsed = Date.now() - start;
    assert.match(cold.text, /data-pl-bootstrap/); assert.ok(elapsed < 1300, `shell took ${elapsed}ms`);
    slow = false;
    await new Promise((r) => setTimeout(r, 1600));
    const completed = await call(`/p/${sToken}?partial=1`, 'GET', null, sViewer);
    assert.equal(completed.res.status, 200); assert.match(completed.json.body, /data-pl-welcome/);
    const soloWelcome = await call(`/p/${sToken}?welcome=1`, 'GET', null, sViewer);
    assert.equal(soloWelcome.json.rows[0].first, '');
    assert.equal(soloWelcome.json.rows[0].name, 'Slow Agent');
    const badDate = await call('/api/personal-links', 'POST', { kind: 'agent', source: 'ff', name: 'Text Date', personId: 'AGENT4', mobile: '9876543210', sections: ['issuance'] }, admin);
    const badToken = badDate.json.link.token;
    const badCookie = (await call('/api/public/personal-link/verify', 'POST', { token: badToken, personId: 'AGENT4', mobile: '9876543210' })).cookie;
    assert.equal((await call(`/p/${badToken}?welcome=1`, 'GET', null, badCookie)).res.status, 503, 'text min cannot masquerade as chronological first activity');
    // Revocation while a history request is in flight must not leak the old scope.
    const rev = await call('/api/personal-links', 'POST', { kind: 'agent', source: 'ff', name: 'Revoked Agent', personId: 'AGENT3', mobile: '9876543210', sections: ['issuance'] }, admin);
    const revToken = rev.json.link.token;
    const revCookie = (await call('/api/public/personal-link/verify', 'POST', { token: revToken, personId: 'AGENT3', mobile: '9876543210' })).cookie;
    slow = true;
    const pending = call(`/p/${revToken}?welcome=1`, 'GET', null, revCookie);
    await new Promise((r) => setTimeout(r, 100));
    await call(`/api/personal-links/${rev.json.link.id}`, 'PUT', { personId: 'AGENT3', mobile: '9876543210', sections: ['stock'] }, admin);
    assert.equal((await pending).res.status, 403);
  } finally { child.kill('SIGTERM'); if (child.exitCode === null) await once(child, 'exit').catch(() => {}); mock.close(); mock.closeAllConnections?.(); await fs.rm(dir, { recursive: true, force: true }); }
});
