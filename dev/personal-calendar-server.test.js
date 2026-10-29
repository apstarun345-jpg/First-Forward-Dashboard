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

test('calendar is verified-session and issuance-scoped, and FF/GV team views use only their own daily totals', async () => {
  const yesterday = new Date(Date.now() + 5.5 * 3600e3); yesterday.setUTCHours(0, 0, 0, 0); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const iso = yesterday.toISOString().slice(0, 10), gdate = `Date(${yesterday.getUTCFullYear()},${yesterday.getUTCMonth()},${yesterday.getUTCDate()})`;
  const mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://mock'), tq = u.searchParams.get('tq') || '';
    const ff = tq.includes("'Calendar FF'"), gv = tq.includes("'Calendar GV'");
    const cols = ['AA', 'D', 'AU', 'BA', 'count'];
    const mk = (cls, master, n) => ({ c: [{ v: gdate }, { v: cls }, { v: master }, { v: 'TL' }, { v: n }] });
    let rows = [];
    if (/^select AA, D, AU, (?:BA|AZ), count\(/i.test(tq)) {
      if (ff) rows = [mk('4', '123', 4), mk('20', '123', 2)];
      if (gv) rows = [mk('4', '5845036', 7), mk('6', '5845036', 3)];
    }
    res.end(`google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: cols.map((id) => ({ id, type: 'string' })), rows } })});`);
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pl-cal-'));
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
      return { res, json: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
    };
    const admin = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).cookie;
    const made = await call('/api/personal-links', 'POST', { kind: 'group', source: 'both', name: 'Calendar team', personId: 'CAL-1', mobile: '9876543210', members: [{ name: 'Calendar FF', source: 'ff' }, { name: 'Calendar GV', source: 'gv' }], sections: ['issuance'] }, admin);
    assert.equal(made.res.status, 200);
    const token = made.json.link.token;
    const gate = await (await fetch(base + `/p/${token}`)).text();
    assert.doesNotMatch(gate, /id="pl-activity-calendar"/, 'unauthenticated page contains no calendar data');
    const viewer = (await call('/api/public/personal-link/verify', 'POST', { token, personId: 'CAL-1', mobile: '9876543210' })).cookie;
    const detail = async (channel) => {
      const html = await (await fetch(base + `/p/${token}?ch=${channel}`, { headers: { cookie: viewer } })).text();
      const data = (html.match(new RegExp(`<div class="pl-cal-detail" data-cal-detail="${iso}" hidden>(.*?)</div></div>`)) || [])[1];
      assert.ok(data, 'calendar detail is rendered for the completed date'); return data;
    };
    assert.match(await detail('all'), /16 tags/);
    assert.match(await detail('ff'), /6 tags/);
    assert.match(await detail('gv'), /10 tags/);
    const remove = await call(`/api/personal-links/${made.json.link.id}`, 'PUT', { personId: 'CAL-1', mobile: '9876543210', sections: ['stock'] }, admin);
    assert.equal(remove.res.status, 200);
    const viewer2 = (await call('/api/public/personal-link/verify', 'POST', { token, personId: 'CAL-1', mobile: '9876543210' })).cookie;
    const denied = await (await fetch(base + `/p/${token}`, { headers: { cookie: viewer2 } })).text();
    assert.doesNotMatch(denied, /id="pl-activity-calendar"|data-pl-pane="calendar"/);
  } finally { child.kill('SIGTERM'); if (child.exitCode === null) await once(child, 'exit').catch(() => {}); mock.close(); mock.closeAllConnections?.(); await fs.rm(dir, { recursive: true, force: true }); }
});
