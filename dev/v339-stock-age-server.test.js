/* 🧓 v3.39 — Agent / TL Summary, Master Search aur drawers me stock "hamesha loading" par atakta tha.
   Server side: stock-ageing index ab page-by-page banta hai (memory lean), request ko latkata nahi (`pending`),
   fail hone par 10 min tak cache nahi hota, aur gviz proxy cache ki memory par hard cap hai.
   Real server + chhota gviz upstream (limit / offset samajhne wala). */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStockAgeBuilder, buildStockAgeIndex, summaryOf } from '../stock-age.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400e3;
const TODAY = Math.floor(Date.now() / DAY);
const ago = (n) => { const d = new Date((TODAY - n) * DAY); return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()} 10:00:00 IST`; };

// ---- fixture: 11 FF rows (StockDataa) + 7 GV rows (Tag Assignment) --------------------------------------------
const FF_ROWS = Array.from({ length: 11 }, (_, i) => ({
  A: '5845036', C: `T${i + 1}`, D: `608116-011-${String(i + 1).padStart(7, '0')}`, E: i % 3 === 0 ? '12' : '4',
  G: ago(20 + i * 9), H: i % 2 ? '537700000000000001' : '537700000000000002', I: i % 2 ? 'Ravi Kumar' : 'Sita Devi', J: i % 4 === 0 ? '' : ago(10 + i * 9), K: 'TL One'
}));
const GV_ROWS = Array.from({ length: 7 }, (_, i) => ({
  A: i % 2 ? 'VC4' : 'VC7', B: i < 4 ? `T${i + 1}` : `GVX${i}`, C: `x${i}`, D: 'In Stock', E: `APS0${100 + (i % 3)}`, F: `GV Agent ${i % 3}`, G: 'APS09675', H: 'Sheela Prajapat'
}));
const FF_LETTERS = ['A', 'C', 'D', 'E', 'G', 'H', 'I', 'J', 'K'];

function gvizBody(cols, rows) {
  return `google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: cols.map((id) => ({ id, label: id, type: 'string' })), rows: rows.map((r) => ({ c: r.map((v) => ({ v })) })) } })});`;
}

/** Upstream jo `select … limit N offset M` samajhta hai. cfg: delay{sheet:ms} · fail{sheet:(req)=>bool} · ignorePaging · ff · gv · big{n,bytes} */
function makeUpstream(cfg) {
  const log = [];
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const sheet = u.searchParams.get('sheet') || '';
    const tq = u.searchParams.get('tq') || '';
    const limit = /\blimit (\d+)/.exec(tq), offset = /\boffset (\d+)/.exec(tq);
    const entry = { sheet, tq, offset: offset ? Number(offset[1]) : 0, limit: limit ? Number(limit[1]) : null };
    log.push(entry);
    if (cfg.delay && cfg.delay[sheet]) await new Promise((r) => setTimeout(r, cfg.delay[sheet]));
    if (cfg.fail && cfg.fail[sheet] && cfg.fail[sheet](entry)) { res.statusCode = 500; return res.end('upstream boom'); }
    if (sheet === 'Big') {
      // gviz proxy cache test: har distinct query par ~`bytes` ka body
      const pad = 'x'.repeat(cfg.bigBytes || 3 * 1024 * 1024);
      return res.end(gvizBody(['A'], [[`${tq}|${pad}`]]));
    }
    const src = sheet === 'StockDataa' ? cfg.ff() : sheet === 'Tag Assignment' ? cfg.gv() : [];
    const letters = (/select (.+?)(?: where | limit | offset |$)/i.exec(tq) || [])[1];
    const cols = letters ? letters.split(',').map((x) => x.trim()) : [];
    let rows = src;
    if (!cfg.ignorePaging) rows = rows.slice(entry.offset, limit ? entry.offset + entry.limit : undefined);
    res.setHeader('Content-Type', 'text/plain');
    return res.end(gvizBody(cols, rows.map((r) => cols.map((L) => r[L] ?? ''))));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, log, url: `http://127.0.0.1:${server.address().port}` })));
}

async function startApp(upstreamUrl, env = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-v339-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: upstreamUrl, RENDER: '', STOCK_AGE_WARM: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', (d) => { logs += d; });
  const base = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`startup timeout ${logs}`)), 15000);
    child.stdout.on('data', (d) => { logs += d; const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m && m[1] !== '0') { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); } });
  });
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ username: 'owner', password: 'initial-password' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const H = { cookie, 'X-Forwarded-Proto': 'https' };
  const raw = (p) => fetch(`${base}${p}`, { headers: H });
  const get = async (p) => (await raw(p)).json();
  const stop = async () => { child.kill('SIGTERM'); await once(child, 'exit').catch(() => {}); };
  return { base, get, raw, stop, logs: () => logs };
}
async function until(fn, ok, { timeout = 20000, every = 120 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - t0 > timeout) throw new Error(`condition not met in ${timeout} ms — last: ${JSON.stringify(v).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, every));
  }
}
const withApp = (cfg0, env, fn) => async () => {
  const cfg = { ff: () => FF_ROWS, gv: () => GV_ROWS, ...cfg0 };   // test cfg ko beech me badal sakta hai (upstream wahi object padhta hai)
  const up = await makeUpstream(cfg);
  const app = await startApp(up.url, env);
  try { await fn({ app, up, cfg }); } finally { await app.stop(); up.server.close(); up.server.closeAllConnections?.(); }
};

// ---------------------------------------------------------------------------------------------------------
test('builder: chunk-by-chunk (createStockAgeBuilder) == one-shot buildStockAgeIndex', () => {
  const ff = FF_ROWS.map((r) => ({ id: r.A, tagId: r.C, barcode: r.D, cls: r.E, bcDate: r.G, agentId: r.H, agentName: r.I, agentDate: r.J, tl: r.K }));
  const gv = GV_ROWS.map((r) => ({ cls: r.A, tagId: r.B, serial: r.C, status: r.D, agentId: r.E, agentName: r.F, tlId: r.G, tlName: r.H }));
  const whole = summaryOf(buildStockAgeIndex({ ffRows: ff, gvRows: gv, todayDay: TODAY }));
  for (const size of [1, 3, 4, 100]) {
    const b = createStockAgeBuilder({ todayDay: TODAY });
    for (let i = 0; i < ff.length; i += size) b.addFf(ff.slice(i, i + size));
    for (let i = 0; i < gv.length; i += size) b.addGv(gv.slice(i, i + size));
    const piece = summaryOf(b.finish());
    delete piece.at; const ref = { ...whole }; delete ref.at;
    assert.deepEqual(piece, ref, `chunk size ${size}: same buckets / agents / TLs / GV matches`);
  }
  assert.equal(whole.ff.total, 11); assert.equal(whole.gv.total, 7); assert.equal(whole.gv.matched, 4, 'GV tags StockDataa tag-ID se age paate hain');
});

test('server: StockDataa / Tag Assignment limit+offset pages me padhe jaate hain, totals poore', withApp({}, { STOCK_AGE_PAGE_ROWS: '3', STOCK_AGE_PAGE_WINDOW: '2', STOCK_AGE_WAIT_MS: '15000' }, async ({ app, up }) => {
  const sum = await app.get('/api/stock-age');
  assert.equal(sum.ok, true); assert.ok(!sum.pending);
  assert.equal(sum.ff.total, 11, 'sab FF pages jude');
  assert.equal(sum.gv.total, 7, 'sab GV pages jude');
  assert.equal(sum.gv.matched, 4);
  assert.equal(sum.errors, undefined);
  const ffReq = up.log.filter((r) => r.sheet === 'StockDataa'), gvReq = up.log.filter((r) => r.sheet === 'Tag Assignment');
  assert.ok(ffReq.every((r) => r.limit === 3), 'har query par page limit');
  for (const off of [0, 3, 6, 9]) assert.ok(ffReq.some((r) => r.offset === off), `FF offset ${off} maanga gaya`);
  for (const off of [0, 3, 6]) assert.ok(gvReq.some((r) => r.offset === off), `GV offset ${off} maanga gaya`);
  assert.ok(ffReq.every((r) => /where C is not null/.test(r.tq)), 'where filter har page par');
  const tags = await app.get('/api/stock-age/tags?ch=ff&kind=agent&key=Ravi%20Kumar');
  assert.equal(tags.ok, true);
  assert.equal(tags.total, FF_ROWS.filter((r) => r.I === 'Ravi Kumar').length);
  const health = await app.get('/api/health');
  assert.equal(health.stockAge.ready, true); assert.equal(health.stockAge.building, false); assert.deepEqual(health.stockAge.errors, []);
}));

test('server: upstream limit/offset ignore kare to rows duplicate nahi hote', withApp({ ignorePaging: true }, { STOCK_AGE_PAGE_ROWS: '3', STOCK_AGE_PAGE_WINDOW: '2', STOCK_AGE_WAIT_MS: '15000' }, async ({ app }) => {
  const sum = await app.get('/api/stock-age');
  assert.equal(sum.ff.total, 11, 'wahi page baar-baar aaye to bhi ek hi baar gina');
  assert.equal(sum.gv.total, 7);
}));

test('server: index ban raha ho to request latkti nahi — pending, build peeche chalta hai, phir data', withApp({ delay: { StockDataa: 1500 } }, { STOCK_AGE_PAGE_ROWS: '5', STOCK_AGE_WAIT_MS: '120' }, async ({ app }) => {
  const t0 = Date.now();
  const tags = await app.get('/api/stock-age/tags?ch=ff&kind=all');
  const first = await app.get('/api/stock-age');
  assert.ok(Date.now() - t0 < 1200, `pending jawab jaldi aana chahiye (${Date.now() - t0} ms)`);
  assert.equal(first.ok, true); assert.equal(first.pending, true); assert.ok(first.retryAfterMs > 0, 'browser ko kab dobara poochna hai');
  assert.equal(tags.pending, true); assert.deepEqual(tags.rows, [], 'tags endpoint bhi pending (khaali list) deta hai');
  const mid = await app.get('/api/health');
  assert.equal(mid.stockAge.building, true, 'health me build chalta dikhta hai'); assert.equal(mid.stockAge.ready, false);
  const done = await until(() => app.get('/api/stock-age'), (v) => v.ok && !v.pending);
  assert.equal(done.ff.total, 11); assert.equal(done.gv.total, 7);
  const after = await app.get('/api/health');
  assert.equal(after.stockAge.ready, true); assert.equal(after.stockAge.building, false);
}));

test('server: Tag Assignment fail ho to FF ageing phir bhi aati hai (errors.gv), recover hone par saaf', withApp({ fail: { 'Tag Assignment': () => true } }, { STOCK_AGE_PAGE_ROWS: '4', STOCK_AGE_WAIT_MS: '15000' }, async ({ app, cfg }) => {
  const bad = await app.get('/api/stock-age');
  assert.equal(bad.ok, true);
  assert.equal(bad.ff.total, 11, 'FF poora');
  assert.equal(bad.gv.total, 0);
  assert.ok(bad.errors && bad.errors.gv, 'GV ka error saaf dikhta hai (chup-chaap khaali nahi)');
  assert.ok(!bad.errors.ff);
  assert.deepEqual((await app.get('/api/health')).stockAge.errors, ['gv']);
  cfg.fail = {};
  const good = await app.get('/api/stock-age?fresh=1');
  assert.equal(good.gv.total, 7); assert.equal(good.errors, undefined, 'recover ke baad errors hata diye');
}));

test('server: beech ka FF page fail ho to adhura FF kabhi nahi dikhta; pehle ka accha data bacha rehta hai', withApp({}, { STOCK_AGE_PAGE_ROWS: '4', STOCK_AGE_PAGE_WINDOW: '2', STOCK_AGE_WAIT_MS: '15000' }, async ({ app, cfg }) => {
  const good = await app.get('/api/stock-age');
  assert.equal(good.ff.total, 11); assert.equal(good.errors, undefined);
  cfg.fail = { StockDataa: (r) => r.offset >= 4 };   // pehla page theek, doosra fail (retry ke baad bhi)
  const blip = await app.get('/api/stock-age?fresh=1');
  assert.equal(blip.ff.total, 11, 'Google ke blip par purana poora FF data rakha (adhura 4 rows nahi)');
  assert.equal(blip.gv.total, 7);
  assert.ok(blip.errors && blip.errors.ff, 'par error flag hai — UI Retry dikha sakti hai');
  cfg.fail = {};
  const healed = await app.get('/api/stock-age?fresh=1');
  assert.equal(healed.ff.total, 11); assert.equal(healed.errors, undefined);
}));

test('server: pehli hi build me FF page fail → adhura FF discard (kam ginti sahi jaisi nahi dikhti)', withApp({ fail: { StockDataa: (r) => r.offset >= 4 } }, { STOCK_AGE_PAGE_ROWS: '4', STOCK_AGE_PAGE_WINDOW: '2', STOCK_AGE_WAIT_MS: '15000' }, async ({ app }) => {
  const sum = await app.get('/api/stock-age');
  assert.equal(sum.ff.total, 0, 'half-built FF index serve nahi hota');
  assert.ok(sum.errors && sum.errors.ff);
  assert.equal(sum.gv.total, 7, 'GV phir bhi aaya');
}));

test('server: fail hui build 10 min cache nahi hoti — thodi der baad khud dobara try, bina fresh=1', withApp({ fail: { StockDataa: () => true, 'Tag Assignment': () => true } }, { STOCK_AGE_PAGE_ROWS: '5', STOCK_AGE_WAIT_MS: '15000', STOCK_AGE_ERROR_RETRY_MS: '200' }, async ({ app, cfg }) => {
  const bad = await app.get('/api/stock-age');
  assert.ok(bad.errors && bad.errors.ff && bad.errors.gv, 'dono fail');
  cfg.fail = {};                       // Google wapas theek
  await new Promise((r) => setTimeout(r, 300));
  // pehla request purana (fail) jawab turant deta hai aur peeche rebuild shuru karta hai …
  const healed = await until(() => app.get('/api/stock-age'), (v) => v.ok && !v.pending && !v.errors, { timeout: 15000 });
  assert.equal(healed.ff.total, 11); assert.equal(healed.gv.total, 7);
}));

test('server: gviz proxy cache bytes par capped (CACHE_MAX_MB) — bade bodies memory nahi bharte', withApp({ bigBytes: 3 * 1024 * 1024 }, { CACHE_MAX_MB: '8' }, async ({ app, cfg }) => {
  const big = async (n) => {
    const r = await app.raw(`/api/gviz?sheet=Big&tq=${encodeURIComponent(`select A where A = ${n}`)}`);
    assert.equal(r.status, 200);
    return (await r.text()).length;
  };
  for (let n = 1; n <= 5; n++) assert.ok(await big(n) > 3 * 1024 * 1024, 'poora body client ko milta hai');
  const perf = (await app.get('/api/perf')).perf;
  assert.equal(perf.cacheMBMax, 8);
  assert.ok(perf.cacheMB <= 8, `cache ${perf.cacheMB} MB cap 8 MB se zyada`);
  assert.ok(perf.cacheEntries >= 1 && perf.cacheEntries <= 2, `3 MB × 5 par sirf ≤2 entries bachni chahiye (${perf.cacheEntries})`);
  // cap ke aadhe (4 MB) se bada akela body cache me jaata hi nahi — baaki entries bhi nahi nikalti
  cfg.bigBytes = 5 * 1024 * 1024;
  assert.ok(await big(99) > 5 * 1024 * 1024, 'bada body bhi client ko poora milta hai');
  const after = (await app.get('/api/perf')).perf;
  assert.equal(after.cacheEntries, perf.cacheEntries, 'over-sized entry cache me nahi gayi');
  assert.equal(after.cacheMB, perf.cacheMB);
}));
