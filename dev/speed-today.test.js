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
  assert.match(src, /function identifierText\(/, 'BARCODE/TAG_ID ke liye dedicated ID normalizer');
  assert.match(src, /function isIdentifierColumn\(/, 'normalization EIR/StockDataa identifier columns par apply hoti hai');
  assert.match(src, /expandScientificIdentifier\(/, 'scientific notation ko precision-safe digits me badla jata hai');
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
  // 🧹 v3.62 — ye pages app se hata di gayi hain (sidebar + lazy groups dono se). Unke module files
  // disk par hain (purana code/test toota na ho), par koi route ya lazy entry nahi — isliye ye
  // check se bahar hain. app.js RETIRED_PAGES me har id honi chahiye, warna purana link dead page
  // khol dega.
  const appSrc = await read('app.js');
  const RETIRED = ['controlTower', 'executive', 'tv', 'ffCommission', 'gvCommission', 'charts', 'forecast',
    'tlScorecard', 'stockRadar', 'savedViews', 'reportStudio', 'followups',
    'arena', 'fame', 'warRoom', 'activity', 'network', 'radar', 'reportCards', 'sprints'];
  for (const page of RETIRED) {
    assert.ok(new RegExp(`\\b${page}: '[a-zA-Z]+'`).test(appSrc), `retired page "${page}" app.js RETIRED_PAGES me hona chahiye`);
    assert.ok(!map.has(page), `retired page "${page}" lazy GROUPS me wapas nahi aana chahiye`);
  }
  for (const file of files) {
    const src = await read(file);
    for (const m of src.matchAll(/FF\.pages\.([A-Za-z][\w]*) =/g)) {
      const page = m[1];
      if (eager.has(file)) continue; // page ka module eager core me hai (home/sheets) — lazy group ki zaroorat nahi
      if (RETIRED.includes(page)) continue;   // 🧹 v3.62 retired page — lazy group jaan-boojh kar nahi hai
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

test('index.html: sirf critical shell eager hai — bell/search/assistant first paint ke baad aate hain', async () => {
  const idx = await read('index.html');
  const app = await read('app.js');
  const lazy = await read('lazy.js');
  // Ye 11 modules pehle eager the (~550 KB JS first paint se PEHLE parse hota tha → phone par Home
  // 1-3s late + scroll leg). Ab ye first paint ke baad waves me aate hain, aur click par on-demand.
  const SHELL_EXTRAS = ['notifications', 'kpiDetail', 'stockAge', 'masterSearch', 'palette', 'assistant',
    'officeBell', 'pushVoice', 'liveAssist', 'morningCard', 'liveView'];
  for (const mod of SHELL_EXTRAS) {
    assert.ok(!new RegExp(`src="${mod}\\.js`).test(idx), `${mod}.js index.html me eager nahi hona chahiye`);
    assert.ok(lazy.includes(`'${mod}'`), `${mod} lazy.js SHELL_WAVES me hai`);
  }
  for (const mod of ['config', 'util', 'i18n', 'data', 'charts', 'model', 'filters', 'store', 'gv', 'preload', 'auth', 'sheets', 'home', 'lazy', 'app']) {
    assert.ok(new RegExp(`src="${mod}\\.js\\?v=`).test(idx), `${mod}.js eager core me zaroori hai`);
  }
  assert.match(app, /function startShellExtras\(/, 'app.js shell extras first paint ke baad start karta hai');
  assert.match(app, /FF\.lazy\.shell\(\{ afterWave: hooks \}\)/, 'waves ke baad hooks (bell start, search mount) chalte hain');
  assert.match(app, /const ensureShell = /, 'click par on-demand shell module load hota hai');
  assert.match(app, /if \(FF\.notifications\) return;[\s\S]{0,120}openNotifications\(\);/, 'bell click kabhi dead nahi hota (module load karke kholta hai)');
  assert.match(app, /shellNeed\(\['kpiDetail', 'stockAge'\]\)/, 'KPI drill click par module load hota hai');
  assert.match(lazy, /const SHELL_WAVES = \[/, 'wave order lazy.js me defined hai');
});

test('app.js: page render se pehle us page ka module ensure hota hai + login ke baad warm', async () => {
  const src = await read('app.js');
  assert.match(src, /await FF\.lazy\.ensure\(page\)/, 'renderCurrent lazy ensure karta hai');
  assert.match(src, /FF\.lazy\.ensureAll\(\)/, 'fallback: sab modules');
  assert.match(src, /FF\.lazy\.warm\(\)/, 'login ke baad idle warm');
  const lazy = await read('lazy.js');
  assert.match(lazy, /requestIdleCallback/, 'warm idle me chalta hai');
  assert.match(lazy, /el\.async = true/, 'lazy scripts async/defer');
  // 📱 v3.61 — warm ab device-aware hai: phone par ~2 MB JS background me parse karwana hi sabse bada
  // leg ka karan tha. Touch device par sirf 3 roz kaam aane wale modules (25s baad), data-saver par 0.
  assert.match(lazy, /const WARM_TOUCH = \['performance', 'tagIssued', 'stock'\]/, 'phone ke liye chhoti warm list');
  assert.match(lazy, /if \(dev\.saveData\) return;/, 'data-saver / 2G par warm band');
  assert.match(lazy, /const startDelay = dev\.coarse \? 25000 : 6000;/, 'phone par warm bahut baad me (pehle scroll smooth)');
  assert.match(lazy, /document\.visibilityState === 'hidden'/, 'background tab me warm rukta hai');
  const sw = await read('sw.js');
  // 🧬 v3.61 — SW ki precache list index.html se derive hoti hai. Pehle yahan 44 hard-coded ?v= pins the
  // jo index.html/lazy.js se match nahi karte the (./performance.js?v=105 jabki app ?v=109 maangta tha):
  // install par ~2.5 MB extra download hota tha aur wo cache kabhi use nahi hota tha.
  assert.match(sw, /async function shellAssets\(/, 'SW shell assets index.html se padhta hai');
  assert.match(sw, /fetch\('\.\/index\.html'/, 'install par real (stamped) shell HTML se list banti hai');
  assert.match(sw, /Promise\.allSettled/, 'ek asset fail ho to poora SW install fail na ho');
  assert.match(sw, /const isVersioned = \/\[\?&\]v=\//, 'versioned assets cache-first (immutable) serve hote hain');
  assert.ok(!/\.\/performance\.js\?v=/.test(sw), 'lazy page module hard-coded precache me nahi');
  assert.ok(!/\.\/insights\.js\?v=/.test(sw), 'insights.js lazy hai — precache me nahi (pehla load halka)');
  const idx = await read('index.html');
  for (const mod of ['lazy.js', 'home.js', 'app.js']) assert.ok(idx.includes(mod), `eager shell me ${mod} hai`);
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

test('⏱️ polling budget: phone/server par background requests ka cadence sane hai', async () => {
  const notif = await read('notifications.js');
  const assist = await read('liveAssist.js');
  const voice = await read('pushVoice.js');
  const app = await read('app.js');
  const home = await read('home.js');
  // Bell poll pehle 5s tha (+ presence 15s + live-assist 3s + push-voice 20s + install-btn 3s):
  // ~41 requests/min per open tab. Render + Apps Script par ye sab ko slow karta tha ("leg").
  assert.match(notif, /pollMs = \(\) => \(document\.visibilityState === 'visible' \? 15e3 : 60e3\)/, 'bell poll 15s visible / 60s hidden');
  assert.match(notif, /setInterval\(\(\) => sendPresence\(\), 45e3\)/, 'presence 45s (pehle 15s)');
  assert.match(notif, /if \(state\.pollBusy\) return;/, 'slow server par requests stack nahi hoti');
  assert.match(notif, /state\.shareWatchTimer/, 'pointer-share timer sirf admin live-view ON par chalta hai');
  assert.match(notif, /if \(force !== true && pop\.hidden && sig === state\.renderSig\) return;/, 'band bell par bekaar DOM rebuild nahi');
  assert.match(assist, /\}, 20000\);/, 'live-assist inbox poll 20s (pehle 3s)');
  assert.match(voice, /const POLL_MS = 60e3;/, 'push voice catch-up poll 60s (pehle 20s)');
  assert.match(app, /setInterval\(updateInstallBtn, 60000\)/, 'install button check 60s (pehle har 3s)');
  assert.match(home, /if \(document\.hidden\) return;/, 'home sync pill background tab me update nahi karta');
  assert.ok(!/new MutationObserver/.test(home), 'poore <body> par subtree MutationObserver hata diya (har mutation par DOM walk = scroll leg)');
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
  // 🧹 v3.62 — `executive` page retire ho gayi, isliye yahi INSIGHT_DEPS check ab dualChannel par
  // hota hai (dono ka module set same hai: insights → directAgents → certificates → cockpit).
  assert.equal((lazy.GROUPS.dualChannel || []).join(','), 'insights,directAgents,certificates,cockpit', 'transitive dependencies resolve before page module');
  await lazy.ensure('dualChannel');
  assert.deepEqual(requested, ['./insights.js?v=45', './directAgents.js?v=45', './certificates.js?v=45', './cockpit.js?v=45'], 'order + version sahi');
  await lazy.ensure('dualChannel');
  assert.equal(requested.length, 4, 'dedup: dobara request nahi');
  assert.ok(lazy.WARM.length >= 5 && lazy.WARM.includes('insights'), 'warm list me bhaari modules aakhir me');
  assert.ok(lazy.GROUPS.settings.includes('settings'), 'settings page ka module lazy hai');
});
