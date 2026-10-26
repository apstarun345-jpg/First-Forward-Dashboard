/* 📡 Personal links: live status endpoint, exact stats, visitors roll-up, device label, restart-safe feed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function startServer(dir) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', PL_LOG_FLUSH_MS: '200' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stderr.on('data', (d) => { logs += d; });
  const base = await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { logs += d; const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m && m[1] !== '0') resolve(`http://127.0.0.1:${m[1]}`); });
    child.on('exit', (code) => reject(new Error(`exit ${code}: ${logs}`)));
    setTimeout(() => reject(new Error('startup timeout ' + logs)), 10000).unref();
  });
  return { child, base, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

test('personal link live status: exact stats, visitors, device, survives restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-pllive-'));
  let server = await startServer(dir);
  const call = async (route, method = 'GET', body, cookie = '', headers = {}) => {
    const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { res, json: await res.json().catch(() => ({})), setCookie: res.headers.get('set-cookie') };
  };
  try {
    const admin = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).setCookie.split(';')[0];
    const made = await call('/api/personal-links', 'POST', { kind: 'agent', source: 'ff', name: 'Live Agent', personId: 'LA-1', mobile: '9876543210' }, admin);
    assert.equal(made.res.status, 200);
    const { id, token } = made.json.link;
    const SID = 'livesid_abcdefghijklmnop99';
    const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
    const ok = await call('/api/public/personal-link/verify', 'POST', { token, personId: 'LA-1', mobile: '9876543210', sid: SID }, '', { 'User-Agent': UA });
    assert.equal(ok.res.status, 200);
    const cookie = ok.setCookie.split(';')[0];
    await call('/api/public/personal-link/event', 'POST', { token, sid: SID, kind: 'search', label: 'Searched "abc"', ch: 'ff', tab: 'overview', q: 'abc' }, cookie, { 'User-Agent': UA });
    await call('/api/public/personal-link/event', 'POST', { token, sid: SID, kind: 'export', label: 'Exported CSV', ch: 'ff', tab: 'stock' }, cookie, { 'User-Agent': UA });
    await call('/api/public/personal-link/ping', 'POST', { token, sid: SID, ch: 'ff', tab: 'stock', q: 'abc' }, cookie, { 'User-Agent': UA });

    // admin-only live endpoint
    assert.ok([401, 403].includes((await call('/api/personal-links/live')).res.status));
    const live = await call('/api/personal-links/live', 'GET', null, admin);
    assert.equal(live.res.status, 200);
    const sess = live.json.sessions.find((x) => x.sessionId === SID);
    assert.ok(sess && sess.online === true, 'session is online');
    assert.equal(sess.linkId, id);
    assert.match(sess.ua, /Chrome · Android · Mobile/);
    assert.equal(sess.state.tab, 'stock');
    const st = live.json.status[id];
    assert.equal(st.online, true); assert.equal(st.logins, 1); assert.equal(st.searches, 1); assert.equal(st.exports, 1); assert.equal(st.failed, 0);
    assert.ok(st.firstActivity && st.lastActivity && st.visitors === 1);

    // activity: visitors roll-up + device on every event
    const feed = await call(`/api/personal-links/activity?linkId=${encodeURIComponent(id)}`, 'GET', null, admin);
    assert.equal(feed.json.visitors.length, 1);
    assert.equal(feed.json.visitors[0].sid, SID); assert.equal(feed.json.visitors[0].searches, 1);
    assert.ok(feed.json.events.every((e) => /Chrome · Android/.test(e.ua)));
    assert.ok(feed.json.live[0].events.length >= 2, 'live session returns its event feed');

    // restart: the feed is durable
    await new Promise((r) => setTimeout(r, 600));
    await server.stop();
    server = await startServer(dir);
    const admin2 = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).setCookie.split(';')[0];
    const feed2 = await call(`/api/personal-links/activity?linkId=${encodeURIComponent(id)}`, 'GET', null, admin2);
    const kinds = feed2.json.events.map((e) => e.kind);
    for (const k of ['login', 'search', 'export']) assert.ok(kinds.includes(k), `after restart feed still has ${k}: ${kinds}`);
    assert.equal(feed2.json.stats.searches, 1);
    assert.equal(feed2.json.stats.online, false, 'live sessions are ephemeral');
  } finally { await server.stop(); }
});

test('Personal Links tab: live status cell, strip, drawer detail are wired', async () => {
  const { readFileSync } = await import('node:fs');
  const s = readFileSync(new URL('../settings.js', import.meta.url), 'utf8');
  for (const needle of ['plStatusHtml', 'pl-live-strip', '/api/personal-links/live', 'data-pl-watch-now', 'Every action (latest first)', 'Visitors (session / IP wise)', 'Watch live screen']) assert.ok(s.includes(needle), needle);
});
