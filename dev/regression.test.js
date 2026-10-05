import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFile(path.join(ROOT, name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

async function startServer(dir, upstream) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: upstream, RENDER: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stderr.on('data', data => { logs += data; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', data => { logs += data; const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m && m[1] !== '0') resolve(`http://127.0.0.1:${m[1]}`); });
    child.on('exit', code => reject(new Error(`Server exited ${code}: ${logs}`)));
  });
  const base = await Promise.race([ready, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout: ' + logs)), 10000); timer.unref(); })]);
  return { child, base, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

test('durable sessions, settings, users and changed admin credentials survive restart; failed writes are not success', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-regression-'));
  const urls = [];
  const upstream = http.createServer((req, res) => {
    urls.push(new URL(req.url, 'http://mock'));
    res.end('google.visualization.Query.setResponse({"status":"ok","table":{"cols":[{"id":"A","type":"number"}],"rows":[{"c":[{"v":42}]}]}});');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  let server;
  let cookie = '';
  const request = async (route, method = 'GET', body) => {
    const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    return { res, json };
  };
  try {
    server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
    const login = await request('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' });
    assert.equal(login.res.status, 200);
    const setCookie = login.res.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Max-Age=2592000/); assert.match(setCookie, /Secure/);
    cookie = setCookie.split(';')[0];
    // Session must be ON DISK before login responds, not queued for later.
    assert.equal(Object.keys(JSON.parse(await fs.readFile(path.join(dir, 'sessions.json')))).length, 1);
    assert.equal((await request('/api/auth/profile', 'POST', { name: 'Saved Owner', email: 'owner@example.test', mobile: '9000000000' })).res.status, 200);
    assert.equal((await request('/api/auth/password', 'POST', { current: 'initial-password', next: 'changed-password' })).res.status, 200);
    assert.equal((await request('/api/settings', 'PUT', { settings: { brand: 'Saved Brand', theme: { accent: '#123456' } } })).res.status, 200);
    assert.equal((await request('/api/users', 'POST', { username: 'member', name: 'Saved Member', password: 'member-password', role: 'user' })).res.status, 200);
    assert.equal((await request('/api/auth/me')).json.user.name, 'Saved Owner');

    const sheetUrl = '/api/gviz?sheet=EIR&tq=select%20count(A)';
    assert.equal((await fetch(server.base + sheetUrl, { headers: { cookie } })).headers.get('x-cache'), 'MISS');
    assert.equal((await fetch(server.base + sheetUrl, { headers: { cookie } })).headers.get('x-cache'), 'HIT');
    assert.equal(urls.length, 1);
    assert.equal(urls[0].searchParams.has('range'), false, 'unbounded EIR must NOT be restricted to A1');

    await server.stop();
    server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
    const me = (await request('/api/auth/me')).json;
    assert.equal(me.user.name, 'Saved Owner');
    assert.equal(me.user.email, 'owner@example.test');
    assert.equal(me.settings.theme.accent, '#123456');
    assert.equal(me.settings.brand, 'Saved Brand');
    assert.equal((await request('/api/users')).json.users.length, 2);
    assert.equal((await request('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).res.status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { username: 'owner', password: 'changed-password' })).res.status, 200);

    // A directory at the atomic-write target reliably simulates a write failure, even under root.
    await fs.mkdir(path.join(dir, 'settings.json.tmp'));
    const failure = await request('/api/settings', 'PUT', { settings: { brand: 'NOT SAVED' } });
    assert.equal(failure.res.status, 503);
    assert.match(failure.json.error, /Could not save settings/);
    assert.equal((await request('/api/settings')).json.settings.brand, 'Saved Brand', 'failed edit rolls back');
    assert.match((await request('/api/health')).json.storage.error, /settings/);
    await fs.rmdir(path.join(dir, 'settings.json.tmp'));
    assert.equal((await request('/api/settings', 'PUT', { settings: { brand: 'Recovered' } })).res.status, 200, 'write queue recovers');

    await request('/api/auth/logout', 'POST', {});
    await server.stop();
    server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
    assert.equal((await request('/api/auth/me')).json.user, null, 'logout revocation survives restart');
  } finally {
    if (server) await server.stop();
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('corrupt account file stops startup instead of silently resetting accounts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-corrupt-'));
  try {
    await fs.writeFile(path.join(dir, 'users.json'), '{broken');
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, STORAGE_BACKEND: 'files', DATA_DIR: dir, PORT: '0' }, stdio: 'pipe' });
    let log = ''; child.stderr.on('data', data => { log += data; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1); assert.match(log, /Cannot read persistent data users.json/);
    assert.equal(await fs.readFile(path.join(dir, 'users.json'), 'utf8'), '{broken');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('normal and fresh concurrent queries deduplicate; cache includes spreadsheet identity and correct open range', async () => {
  const gate = deferred(); let calls = 0; const urls = [];
  const context = vm.createContext({ window: {}, URLSearchParams, AbortController, setTimeout, clearTimeout, console,
    fetch: async url => { calls++; urls.push(url); await gate.promise; return { ok: true, headers: new Headers(), text: async () => '{"status":"ok","table":{"cols":[],"rows":[]}}' }; } });
  context.FF = {}; context.window.FF = context.FF;
  await vm.runInContext(await read('config.js'), context);
  context.window.FF.util = {};
  await vm.runInContext(await read('data.js'), context);
  const { config, data } = context.window.FF;
  assert.equal(config.formatRange('A', '1', '', ''), '');
  assert.equal(config.formatRange('A', '4', 'BE', ''), 'A4:BE');
  assert.equal(config.formatRange('B', '2', '', ''), 'B2:ZZZ');
  const first = data.query('EIR', 'select count(A)');
  const second = data.query('EIR', 'select count(A)', { fresh: true });
  assert.equal(calls, 1); gate.resolve(); await Promise.all([first, second]);
  assert.equal(new URL(urls[0], 'http://test').searchParams.has('range'), false);
  await data.query('EIR', 'select count(A)'); assert.equal(calls, 1);
  config.sheetId = 'different-sheet'; await data.query('EIR', 'select count(A)'); assert.equal(calls, 2);
});

test('dataset need resolves without unrelated slow queries, fresh sync is single-flight, reset discards late results', async () => {
  const slow = deferred(); let calls = 0;
  const model = Object.fromEntries(['loadDaily', 'loadAgents', 'loadAgentClassMonthly', 'loadStatus', 'loadStock', 'loadStockAgents', 'loadStockAgentTypes'].map(name => [name, async () => { calls++; return name === 'loadStock' ? slow.promise : [name]; }]));
  const context = vm.createContext({ window: { FF: { util: {}, model, config: { report: { sheet: 'REPORT' } }, data: { query: async () => ({}), clearCache() {} } } }, console });
  vm.runInContext(await read('store.js'), context);
  const store = context.window.FF.store;
  const all = store.preload(false);
  assert.equal(store.preload(true), all);
  await tick();
  assert.equal((await store.need('daily'))[0], 'loadDaily');
  assert.equal(store.loading, true, 'stock is still pending');
  assert.equal(calls, 7);
  store.reset(); slow.resolve(['old-stock']); await all;
  assert.equal(store.get('stock'), undefined, 'late response cannot repopulate reset store');
});

test('raw sheets stay lazy so login does not spend requests warming every permitted tab', async () => {
  const core = deferred(); const calls = []; let clears = 0;
  const context = vm.createContext({ window: { FF: {
    config: { allTabs: () => [{ id: 'large' }, { id: 'small' }, { id: 'unknown' }, { id: 'denied' }] },
    auth: { can: permission => permission !== 'sheet:denied' },
    store: { preload: () => core.promise, state: { errors: {} } },
    data: { clearCache() { clears++; }, cellNumber: c => c && c.v, query: async (sheet, tq, opts) => {
      calls.push({ sheet, tq, opts });
      if (tq.includes('count')) { if (sheet === 'unknown') throw new Error('count unavailable'); return { rows: [[{ v: sheet === 'large' ? 100000 : 12 }]] }; }
      return { rows: Array.from({ length: 100 }, () => []) };
    } }
  } }, console });
  vm.runInContext(await read('preload.js'), context);
  const pre = context.window.FF.preloader;
  const ready = pre.preloadAll();
  await tick();
  assert.equal(calls.length, 0, 'raw tabs are loaded only when opened');
  assert.equal(pre.running, true, 'core aggregate preload is still pending');
  assert.equal(pre.state.progress.total, 1, 'only the core data store is scheduled');
  core.resolve(); await ready;
  assert.equal(pre.done, true); assert.equal(clears, 0);
});
