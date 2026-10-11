/* 🚦 v3.72 — "Too Many Requests" HTML page ka poora flow.
   Pehle Google ka 429 page (normalize.css wala HTML) screen/JSON me leak ho jaata tha aur mapping
   lookup "StockDataa index nahi ban paya" par atak jaata tha. Ye test REAL server + ek chhota fake
   Google upstream chala kar verify karta hai:
     • /api/gviz rate limit par saaf JSON 429 deta hai (kabhi HTML nahi), Retry-After ke saath,
     • cooldown ke dauran Google par background/extra requests nahi jaati (purana cache serve hota hai),
     • StockDataa index rate limit par saaf error deta hai aur limit hatne par wahi index ban jaata hai,
     • /api/fastag-mapping/status + index-status live sthiti (building / rows / rateLimited) dete hain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GOOGLE_429 = '<!DOCTYPE html><html><head><title>Too Many Requests</title>' +
  '<link rel="stylesheet" href="/static/error/normalize.css"></head><body><h1>Too Many Requests</h1></body></html>';

const STOCK_ROWS = [
  { A: 'STOCK-1', B: 'Apna Payement', C: 'TAG-11111', D: '6081160110123456', E: '4', F: 'RFID', G: '01-01-2026 10:00:00 IST', H: 'OLD-1', I: 'Old Agent', J: '01-01-2026 10:00:00 IST', K: 'TL One' },
  { A: 'STOCK-2', B: 'Apna Payement', C: 'TAG-22222', D: '6081160110123457', E: 'VC12', F: 'RFID', G: '02-01-2026 10:00:00 IST', H: 'OLD-2', I: 'Old Agent 2', J: '02-01-2026 10:00:00 IST', K: 'TL Two' }
];

function gvizBody(cols, rows) {
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: cols.map((id) => ({ id, label: id, type: 'string' })), rows: rows.map((r) => ({ c: r.map((v) => ({ v })) })) } })});`;
}

/** Chhota fake Google: cfg.limitLeft > 0 → StockDataa par 429 HTML (network log ke saath). */
function makeUpstream(cfg) {
  const log = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const sheet = u.searchParams.get('sheet') || '';
    const tq = u.searchParams.get('tq') || '';
    log.push({ sheet, tq });
    if (sheet === 'StockDataa' && cfg.limitLeft > 0) {
      cfg.limitLeft--;
      res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '1' });
      return res.end(GOOGLE_429);
    }
    const limit = /limit (\d+)/.exec(tq), offset = /offset (\d+)/.exec(tq);
    const letters = (/select (.+?)(?: where | limit | offset |$)/i.exec(tq) || [])[1];
    const cols = letters ? letters.split(',').map((x) => x.trim()) : ['A'];
    const rows = STOCK_ROWS.slice(offset ? Number(offset[1]) : 0, limit ? (offset ? Number(offset[1]) : 0) + Number(limit[1]) : undefined);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(gvizBody(cols, rows.map((r) => cols.map((L) => r[L] ?? ''))));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, log, url: `http://127.0.0.1:${server.address().port}` })));
}

async function startApp(upstreamUrl, env = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-rl-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir,
      ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: upstreamUrl,
      RENDER: '', STOCK_AGE_WARM: '0', GVIZ_COOLDOWN_MS: '1500', GVIZ_GATE_WAIT_MS: '1500',
      STOCK_AGE_PAGE_ROWS: '50', ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', (d) => { logs += d; });
  const base = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`startup timeout ${logs}`)), 20000);
    child.stdout.on('data', (d) => { logs += d; const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m && m[1] !== '0') { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); } });
  });
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ username: 'owner', password: 'initial-password' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const H = { cookie, 'X-Forwarded-Proto': 'https' };
  const raw = (p, init) => fetch(`${base}${p}`, { ...(init || {}), headers: { ...H, ...(init && init.headers ? init.headers : {}) } });
  const get = async (p) => (await raw(p)).json();
  const post = async (p, body) => {
    const res = await raw(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
  };
  const stop = async () => { child.kill('SIGTERM'); await once(child, 'exit').catch(() => {}); };
  return { base, get, post, raw, stop, logs: () => logs };
}

const short = (s) => String(s || '').slice(0, 260);
const noHtmlLeak = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  assert.ok(!/<html|normalize\.css|<!DOCTYPE/i.test(text), 'jawab me Google ka HTML page nahi hona chahiye: ' + short(text));
};

test('gviz proxy: Google 429 HTML → saaf JSON 429 (Retry-After ke saath), HTML kabhi client tak nahi', async () => {
  const cfg = { limitLeft: 5 };
  const up = await makeUpstream(cfg);
  const app = await startApp(up.url);
  try {
    const res = await app.raw('/api/gviz?sheet=StockDataa&tq=' + encodeURIComponent('select A limit 5'));
    assert.equal(res.status, 429, 'rate limit par saaf 429');
    assert.equal(res.headers.get('x-ff-rate-limited'), '1');
    assert.ok(Number(res.headers.get('retry-after')) >= 1, 'Retry-After header');
    const json = await res.json();
    assert.match(json.error, /rate limit/i);
    assert.equal(json.rateLimited, true);
    noHtmlLeak(JSON.stringify(json));

    // Cooldown ke dauran background refresh nahi hona chahiye — thodi der me upstream calls na badhein.
    const before = up.log.length;
    await new Promise((r) => setTimeout(r, 400));
    const status = await app.get('/api/fastag-mapping/status');
    assert.equal(status.rateLimited, true);
    assert.ok(status.cooldownSec >= 1, 'cooldown status me dikhe');
    assert.ok(up.log.length <= before + 1, 'cooldown me upstream par extra requests nahi (' + up.log.length + ' vs ' + before + ')');

    // Cooldown khatam hone par wahi query wapas kaam karti hai (naya data + cache).
    cfg.limitLeft = 0;
    await new Promise((r) => setTimeout(r, 1700));
    const okRes = await app.raw('/api/gviz?sheet=StockDataa&tq=' + encodeURIComponent('select A limit 5'));
    const okText = await okRes.text();
    assert.equal(okRes.status, 200, 'limit hatne par data milta hai');
    assert.match(okText, /setResponse/);
    assert.match(okText, /STOCK-1/, 'sach me StockDataa row aayi');
  } finally { await app.stop(); up.server.close(); up.server.closeAllConnections?.(); }
});

test('StockDataa index: rate limit par saaf error + live status, limit hatne par lookup theek', async () => {
  const cfg = { limitLeft: 99 };
  const up = await makeUpstream(cfg);
  const app = await startApp(up.url);
  try {
    // Pehli lookup rate-limit wale HTML page se takrayegi — error saaf hona chahiye, HTML nahi.
    const first = await app.post('/api/fastag-mapping/lookup', { items: [{ type: 'barcode', barcode: '6081160110123456' }] });
    assert.equal(first.status, 502);
    assert.match(String(first.json && first.json.error), /rate limit|StockDataa|Google/i);
    noHtmlLeak(first.json);

    const st = await app.get('/api/fastag-mapping/index-status');
    assert.equal(st.ok, true);
    assert.equal(st.ready, false);
    assert.ok(st.error, 'index error status me dikhta hai');
    noHtmlLeak(st);

    // Limit hat gayi → agla lookup index bana kar exact row deta hai.
    cfg.limitLeft = 0;
    await new Promise((r) => setTimeout(r, 1700));   // cooldown khatam
    const second = await app.post('/api/fastag-mapping/lookup', { items: [{ type: 'barcode', barcode: '6081160110123456' }] });
    assert.equal(second.status, 200);
    assert.equal(second.json.results[0].rows.length, 1, 'exact barcode mil gaya');
    assert.equal(second.json.results[0].rows[0].tagId, 'TAG-11111');
    assert.equal(second.json.results[0].rows[0].vcType, 'VC4', 'plain 4 → VC4 canonical');
    assert.ok(second.json.meta.rows >= 2, 'index me dono rows');

    const after = await app.get('/api/fastag-mapping/index-status');
    assert.equal(after.ready, true);
    assert.equal(after.rows, 2);
    assert.ok(after.build && after.build.pages >= 1, 'build progress report hoti hai');
  } finally { await app.stop(); up.server.close(); up.server.closeAllConnections?.(); }
});

test('rate-limit HTML ke saath 200 aaye to bhi proxy JSON error deta hai (raw page screen par nahi)', async () => {
  const up = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><head><title>Too Many Requests</title><link rel="stylesheet" href="normalize.css"></head><body>slow down</body></html>');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
  const app = await startApp(up.url);
  try {
    const res = await app.raw('/api/gviz?sheet=StockDataa&tq=' + encodeURIComponent('select A limit 5'));
    assert.ok(res.status >= 400, 'HTML page 200 me passthrough nahi hota');
    const json = await res.json();
    noHtmlLeak(JSON.stringify(json));
    assert.match(String(json.error), /rate limit|HTML/i);
  } finally { await app.stop(); up.server.close(); up.server.closeAllConnections?.(); }
});
