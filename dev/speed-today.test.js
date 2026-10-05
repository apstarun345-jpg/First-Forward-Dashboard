/* ⚡ Speed + "aaj ka live" rollup contract — regression guard for:
     1. GV aaj = GV Master sheet (live), FF aaj = EIR (T+1)   → gv.js / model.js
     2. Barcode display    6081160110558601 → 608116-011-0558601
     3. Lazy page modules  (index.html sirf eager core, lazy.js baaki sab)
     4. Server speed      /api/today feed, /api/perf diagnostics, ETag/304
   Har check ka reason comment me likha hai — warna koi bhi "chhoti si" clean-up inhe wapas tod deti hai. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (f) => fs.readFile(path.join(ROOT, f), 'utf8');

// ------------------------------------------------------------------------------------------------
// 1) Barcode display + search key
// ------------------------------------------------------------------------------------------------
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
require(path.join(ROOT, 'util.js'));
const U = globalThis.FF.util;

test('barcode: 16-digit serial dash format me dikhta hai (608116-011-0558601)', () => {
  assert.equal(U.barcode('6081160110558601'), '608116-011-0558601');
  assert.equal(U.barcode('608116-011-0558601'), '608116-011-0558601', 'pehle se dashed value normalise hoti hai');
  assert.equal(U.barcode('6081160110558601.0'), '608116-011-0558601', 'sheet ke number cell ka trailing .0');
  assert.equal(U.barcode(6081160110558601), '608116-011-0558601', 'numeric cell (gviz number)');
  assert.equal(U.barcode('BC1234'), 'BC1234', 'alphanumeric tag ID waisa hi rehta hai');
  assert.equal(U.barcode(''), '');
  // search key: dash/space hata kar match karta hai, isliye "bina dash" search bhi chalti hai
  assert.equal(U.barcodeKey('608116-011-0558601'), '6081160110558601');
  assert.equal(U.barcodeKey('608116 011 0558601'), '6081160110558601');
});

test('data.cellText: bade numeric barcode par formatted 6.08E+15 nahi, exact digits', async () => {
  const src = await read('data.js');
  assert.match(src, /Math\.abs\(v0\) >= 1e15/, 'bade integer ke liye exact digits (formatted text nahi)');
  assert.match(src, /e\+?\d+/i, 'scientific-notation string bhi digits me convert hoti hai');
});

// ------------------------------------------------------------------------------------------------
// 2) GV aaj = GV Master · FF aaj = EIR
// ------------------------------------------------------------------------------------------------
test('gv.js: GV aaj ka number GV Master se (aaj ki EIR rows replace hoti hain, add nahi)', async () => {
  const src = await read('gv.js');
  assert.match(src, /function gvToday\(\)/, 'gvToday() API hai');
  assert.match(src, /function liveDailyRows\(\)/, 'liveDailyRows() API hai');
  assert.match(src, /const rest = eir\.filter/, 'aaj ki EIR GV rows hatai jaati hain');
  assert.match(src, /issuanceRows\(\) \{ return eirReady\(\) \? liveDailyRows\(\) : rows\(\); \}/,
    'GV issuance rows live series se aati hain (GV Master ka aaj included)');
  const model = await read('model.js');
  assert.match(model, /applyGvLiveToday/, 'model.loadDaily bhi wahi splice karta hai');
  assert.match(model, /G\.masterTodayRows\(\)/, 'aaj ke rows GV Master se');
});

test('kpiDetail: aakhri level = sheet ki asli rows (GV Master / EIR / StockDataa / Tag Assignment)', async () => {
  const src = await read('kpiDetail.js');
  assert.match(src, /function gvMasterRawRows\(/, 'GV rows GV Master tab se');
  assert.match(src, /barcode: r\.serial \|\| ''/, 'GV row me serial (barcode) aata hai');
  assert.match(src, /U\.barcode\(v\)/, 'raw table barcode display format me');
  assert.match(src, /function loadStockSheetRows\(/, 'stock drawer se sheet rows load hoti hain');
  assert.match(src, /data-kd-sheetrows/, 'stock drawer me "sheet rows" button');
});

// ------------------------------------------------------------------------------------------------
// 3) Lazy page modules
// ------------------------------------------------------------------------------------------------
test('lazy.js: har FF.pages module ya eager core me hai ya lazy group me', async () => {
  const files = (await fs.readdir(ROOT)).filter((f) => f.endsWith('.js'));
  const html = await read('index.html');
  const eager = new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/\?.*$/, '')));
  const lazy = await read('lazy.js');
  const arrayDefs = new Map([...lazy.matchAll(/const ([A-Z_]+) = \[([^\]]*)\];/g)].map((m) => [m[1], m[2]]));
  const expand = (expr, stack = []) => [...expr.matchAll(/'([\w-]+)'|\.\.\.([A-Z_]+)/g)].flatMap((m) => {
    if (m[1]) return [m[1]];
    if (stack.includes(m[2]) || !arrayDefs.has(m[2])) return [];
    return expand(arrayDefs.get(m[2]), stack.concat(m[2]));
  });
  const groups = [...lazy.matchAll(/^\s{4}([A-Za-z][\w]*): \[([^\]]*)\]/gm)].map((m) => [m[1], expand(m[2])]);
  assert.ok(groups.length >= 20, `lazy groups parse hue (${groups.length})`);
  const map = new Map(groups);
  for (const file of files) {
    const src = await read(file);
    for (const m of src.matchAll(/FF\.pages\.([A-Za-z][\w]*) =/g)) {
      const page = m[1];
      if (eager.has(file)) continue; // page ka module eager core me hai (home/sheets) — lazy group ki zaroorat nahi
      if (page === 'stockReport') {
        assert.ok((map.get('performance') || []).includes('performance'), 'stockReport /performance route ka alias hai');
        continue;
      }
      assert.ok(map.has(page), `page "${page}" (${file}) lazy.js GROUPS me hona chahiye`);
      const mods = map.get(page);
      assert.ok(mods.length, `page "${page}" ke liye modules listed hain`);
      for (const mod of mods) {
        assert.ok(files.includes(`${mod}.js`), `lazy module ${mod}.js (page ${page}) file exist karti hai`);
        assert.ok(eager.has(`${mod}.js`) || !html.includes(`${mod}.js`), `${mod}.js index.html me galti se eager nahi`);
      }
    }
  }
  // Jo module lazy hai uske naam ka <script> index.html me nahi hona chahiye (warna lazy ka faayda khatam).
  for (const [page, mods] of map) {
    for (const mod of mods) {
      if (eager.has(`${mod}.js`)) continue;
      assert.ok(!new RegExp(`src="${mod}\\.js`).test(html), `${mod}.js lazy hona chahiye (page ${page})`);
    }
  }
});

test('app.js: page render se pehle us page ka module ensure hota hai + login ke baad warm', async () => {
  const src = await read('app.js');
  assert.match(src, /await FF\.lazy\.ensure\(page\)/, 'renderCurrent lazy ensure karta hai');
  assert.match(src, /FF\.lazy\.ensureAll\(\)/, 'fallback: sab modules');
  assert.match(src, /FF\.lazy\.warm\(\)/, 'login ke baad idle warm');
  const lazy = await read('lazy.js');
  assert.match(lazy, /requestIdleCallback/, 'warm idle me chalta hai');
  assert.match(lazy, /el\.async = true/, 'lazy scripts async/defer');
  const sw = await read('sw.js');
  for (const mod of ['lazy.js', 'home.js', 'app.js', 'performance.js']) assert.ok(sw.includes(`./${mod}?v=`), `sw precache me ${mod}`);
  assert.ok(!/\.\/insights\.js\?v=/.test(sw), 'insights.js lazy hai — precache me nahi (pehla load halka)');
});

// ------------------------------------------------------------------------------------------------
// 4) Server: fast today feed, perf diagnostics, ETag
// ------------------------------------------------------------------------------------------------
test('server: /api/today (GV Master + EIR), /api/perf diagnostics, ETag/304', async () => {
  const src = await read('server.js');
  assert.match(src, /p === '\/api\/today'/, '/api/today route hai');
  assert.match(src, /const classCols = \[classCol, \.\.\.\(hasFallbackClass \? \[fallbackClassCol\] : \[\]\)\]/, 'GV query selects CCH plus optional VCLASS fallback');
  assert.match(src, /const select = `select \$\{dateCol\}, \$\{classCols\.join\(', '\)\}, count\(\$\{countCol\}\)`/, 'aaj ka count grouped query se (poora tab download nahi)');
  assert.match(src, /result\.gv = \{[\s\S]*source: 'GV Master'/, 'GV side GV Master tab se');
  assert.match(src, /result\.ff = \{[\s\S]*source: 'EIR'/, 'FF side EIR tab se');
  assert.match(src, /async function gvizDailyClassCounts\(/, 'date column text ho ya date — dono ke liye fallback chain');
  assert.match(src, /toDate\(\$\{dateCol\}\)/, 'text date ke liye toDate() attempt');
  assert.match(src, /kind: 'full-tab'/, 'aakhri fallback: poora chhota tab');
  assert.match(src, /todayFeedCache/, 'today feed server par cached (45s)');
  assert.match(src, /async function fetchUpstreamCached\(url, options\)/, 'per-query cache age override hai');
  assert.match(src, /liveQueryCacheMs = force \? 0 : 30e3/, 'GV live feed 30s se zyada stale cache use nahi karta; force bypass karta hai');
  assert.match(src, /successful-but-empty result/, 'text-date column par empty date query toDate fallback try karti hai');
  assert.match(src, /p === '\/api\/perf'/, 'admin ke liye query timing diagnostics');
  assert.match(src, /function perfReport\(\)/, 'perfReport() slowest queries + cache hit rate deta hai');
  assert.match(src, /if-none-match/i, 'ETag revalidation (304) support');
  assert.match(src, /function bodyEtag\(/, 'gviz responses par bhi ETag');
  const data = await read('data.js');
  assert.match(data, /todayPath: '\/api\/today'|todayPath/, 'config me today path');
  assert.match(data, /function today\(/, 'FF.data.today() client API');
});

test('Lite mode keeps Home KPI text readable after removing gradient backgrounds', async () => {
  const css = await read('styles.css');
  assert.match(css, /html\.ff-lite \.kpi \{[^}]*background-color:\s*#3730a3\s*!important/i, 'solid dark fallback behind white KPI text');
  assert.match(css, /html\.ff-lite \.kpi \.dim \{[^}]*color:\s*rgba\(255,255,255,\.84\)\s*!important/i, 'muted footnote text stays legible');
});

test('app.js: auto-sync 5 min + turant sync triggers (16 heavy queries nahi)', async () => {
  const src = await read('app.js');
  assert.match(src, /5 \* 60 \* 1000/, 'auto-sync interval 5 min (v3.23 — pehle 15 min tha)');
  assert.match(src, /function lightSync\(|lightSync/, 'halka refresh use hota hai');
  assert.match(src, /saveData|effectiveType/, 'data-saver / 2G par auto-sync band');
  assert.match(src, /visibilitychange', onVisibleSync/, 'tab wapas visible ho to turant sync');
  assert.match(src, /function syncNow\(/, 'syncNow — office bell / interval / manual sab isi se sync karte hain');
  assert.match(src, /function checkFeedChange\(/, 'feed snapshot compare — naya data aane par notification');
  assert.match(src, /localAlert/, 'data update ki notification (bell + toast + browser)');
  assert.match(src, /voiceText/, 'data update voice announcement');
  const pre = await read('preload.js');
  assert.match(pre, /function lightSync\(/, 'lightSync sirf daily + GV master + today feed refresh karta hai');
  assert.match(pre, /FF\.store\.refresh\(\['daily', 'report'\]\)/, 'sirf halke datasets');
  const store = await read('store.js');
  assert.match(store, /async function refresh\(keys\)/, 'store.refresh selective hai');
  const gv = await read('gv.js');
  assert.match(gv, /async function refresh\(keys\)/, 'gv.refresh selective hai');
  assert.match(store, /const LOAD_WORKERS = 3/, 'startup par 16 queries ek saath nahi (3 workers me queue)');
  assert.match(gv, /const LOAD_WORKERS = 3/, 'GV bhi 3 workers');
});

// ------------------------------------------------------------------------------------------------
// 5) lazy.js ka asli loader — fake DOM me (kaunsa script, kis order me, dedup)
// ------------------------------------------------------------------------------------------------
test('lazy.js: page ka module load karta hai, order sahi, dobara load nahi', async () => {
  const vm = await import('node:vm');
  const src = await read('lazy.js');
  const requested = [];
  const makeEl = () => ({ set src(v) { this._src = v; requested.push(v); setTimeout(() => this.onload && this.onload(), 0); }, get src() { return this._src; } });
  const document = {
    head: { appendChild(el) { /* onload async */ } },
    createElement: () => makeEl(),
    querySelector: (sel) => (/config\.js/.test(sel) ? { getAttribute: () => './config.js?v=45' } : null)
  };
  const win = { document, FF: {}, console };
  win.window = win;
  vm.runInNewContext(src, win);
  const lazy = win.FF.lazy;
  assert.ok(lazy && typeof lazy.ensure === 'function');
  assert.equal((lazy.GROUPS.trend || []).join(','), 'trend');
  assert.equal((lazy.GROUPS.executive || []).join(','), 'insights,directAgents,certificates,cockpit', 'transitive dependencies resolve before page module');
  await lazy.ensure('executive');
  assert.deepEqual(requested, ['./insights.js?v=45', './directAgents.js?v=45', './certificates.js?v=45', './cockpit.js?v=45'], 'order + version sahi');
  await lazy.ensure('executive');
  assert.equal(requested.length, 4, 'dedup: dobara request nahi');
  assert.ok(lazy.WARM.length >= 5 && lazy.WARM.includes('insights'), 'warm list me bhaari modules aakhir me');
  assert.ok(lazy.GROUPS.settings.includes('settings'), 'settings page ka module lazy hai');
});
