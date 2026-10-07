/* 🔍📦 v3.52 — Master Search + Tag Request employee link: boxes me poora data, suggestions, VC4/VC20/VC5+ trend.
 *
 *   • Root cause: `performance.js` (FF REPORT reader) Master Search / Tag Request / public form par
 *     lazy-load hi nahi hota tha → FF agent/TL ke boxes me stock 0, priority —, suggested 0.
 *     Ab PROFILE_DEPS + tagRequest group + WARM me `performance`, aur masterProfile/tagRequest khud
 *     `FF.lazy.need('performance')` karte hain (self-heal).
 *   • Master Search: type karte hi `U.suggest` dropdown; result ke upar har channel ka KPI strip
 *     (stock · issuance · priority · suggested · growth); trend chart VC4 · VC20 · VC5+ stacked.
 *   • Tag Request employee link: agent / TL dono ke liye EK box-strip + EK class table — koi number
 *     do baar nahi (purane 🚗/🚚 KPI cells + double footer gaye).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFile(path.join(ROOT, f), 'utf8');
const require = createRequire(import.meta.url);
const ls = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'util.js'));
require(path.join(ROOT, 'tagRequest.js'));
const FF = globalThis.FF;
const TR = FF.pages.tagRequest;
FF.auth = { user: { role: 'admin', username: 'owner', name: 'Owner' }, can: () => true, settings: {} };

test('🧩 performance.js ab Master Search / Tag Request / public form par bhi load hota hai (lazy deps + self-heal)', async () => {
  const lazy = await read('lazy.js');
  const deps = /const PROFILE_DEPS = \[([^\]]+)\]/.exec(lazy);
  assert.ok(deps && /'performance'/.test(deps[1]) && /'agentBoard'/.test(deps[1]), 'PROFILE_DEPS me agentBoard + performance');
  const tagGroup = /tagRequest:\s*\[([^\]]+)\]/.exec(lazy);
  assert.ok(tagGroup && /'performance'/.test(tagGroup[1]), 'tagRequest group me performance');
  const warm = /const WARM = \[([^\]]+)\]/.exec(lazy);
  assert.ok(warm && /'performance'/.test(warm[1]), 'WARM me performance');

  const mp = await read('masterProfile.js');
  assert.match(mp, /function ensurePerfModule\(/, 'masterProfile self-heal helper');
  assert.match(mp, /FF\.lazy\.need\('performance'\)/, 'masterProfile lazy.need(performance)');
  const tr = await read('tagRequest.js');
  assert.match(tr, /if \(!FF\.pages\.performance && FF\.lazy[^\n]{0,80}await FF\.lazy\.need\('performance'\)/, 'tagRequest buildIndex performance load karta hai');
});

test('🔍 Master Search — type karte hi suggestions, result ke upar KPI strip, trend VC4 · VC20 · VC5+', async () => {
  const ms = await read('masterSearch.js');
  const page = ms.slice(ms.indexOf('function pageRender'));
  assert.match(page, /U\.suggest\(input, \{[\s\S]{0,400}items: \(\) => suggestItems\(/, '#msp-q par U.suggest dropdown');
  assert.match(page, /onIndexReady[\s\S]{0,200}sug\.refresh\(\)/, 'index ready hone par dropdown refresh');
  assert.match(ms, /function kpiStripHtml\(pr\)/, 'KPI strip builder');
  assert.match(ms, /async function paintKpis\(g, host\)/, 'quick → full upgrade painter');
  assert.match(ms, /<div id="msp-kpis"/, 'openGroup me KPI host');
  assert.match(ms, /paintKpis\(g, U\.\$\('#msp-kpis', out\)\)/, 'openGroup paintKpis call karta hai');
  for (const s of ['📦 Stock', 'Issued this month', 'Last month', '🚦 Priority', 'Sug. VC4', 'Sug. Commercial', 'Dispatch · all tags', '📈 Growth']) assert.ok(ms.includes(s), `KPI box "${s}"`);
  // trend: stacked VC4 / VC20 / VC5+ series (pehle sirf 'Total tags')
  const trend = ms.slice(ms.indexOf('function trendHtml'), ms.indexOf('function paintTrend'));
  assert.ok(!trend.includes("name: 'Total tags'"), 'single Total series gayi');
  for (const n of ['VC4', 'VC20', 'VC5+']) assert.ok(trend.includes(`name: '${n}'`), `series ${n}`);
  assert.match(trend, /msp-trend-sum[\s\S]*msp-tsum vc4[\s\S]*msp-tsum vc20[\s\S]*msp-tsum vc5p/, 'class-wise total chips');
  assert.ok(!trend.includes("'Sab (kul ${U.fmt"), 'header me literal ${} template bug nahi');
  const css = await read('styles.css');
  for (const c of ['.msp-kpis', '.msp-kpi-card', '.msp-trend-sum', '.tr-boxes', '.tr-box.prio']) assert.ok(css.includes(c), `css ${c}`);
});

const grp = (core, comm) => ({ core, comm });
const mkIdx = (withSelf) => {
  const agents = new Set(['ff|A ONE', 'ff|A TWO']);
  if (withSelf) agents.add('ff|TL ONE');
  const list = [
    { key: 'ff|A ONE', channel: 'ff', name: 'A ONE', agentId: '1', tlName: 'TL One', priority: 'High', stock: 10, last: 50, cur: 6, core: { stock: 7, last: 40, cur: 4 }, comm: { stock: 3, last: 10, cur: 2 } },
    { key: 'ff|A TWO', channel: 'ff', name: 'A TWO', agentId: '2', tlName: 'TL One', priority: 'Low', stock: 4, last: 20, cur: 2, core: { stock: 3, last: 15, cur: 1 }, comm: { stock: 1, last: 5, cur: 1 } }
  ];
  if (withSelf) list.push({ key: 'ff|TL ONE', channel: 'ff', name: 'TL One', agentId: '9', tlName: 'TL One', priority: 'Low', stock: 6, last: 30, cur: 2, core: { stock: 4, last: 20, cur: 1 }, comm: { stock: 2, last: 10, cur: 1 } });
  const tot = withSelf ? { core: { stock: 14, last: 75, cur: 6 }, comm: { stock: 6, last: 25, cur: 4 } } : { core: { stock: 10, last: 55, cur: 5 }, comm: { stock: 4, last: 15, cur: 3 } };
  return {
    at: Date.now(), cur: '2026-10', last: '2026-09', byKey: new Map(list.map((a) => [a.key, a])),
    tls: new Map([[`ff|TL ONE`, { key: 'ff|TL ONE', name: 'TL One', channel: 'ff', priority: 'Low', agents, stock: { VC4: 8 }, cur: { VC4: 4 }, last: { VC4: 40 }, grp: grp(tot.core, tot.comm) }]]),
    list
  };
};

test('👥 employee link TL — ek box-strip + ek class table + footer me total sirf EK baar', () => {
  TR._test.setIndex(mkIdx(false));
  const panel = TR._test.tlPanelHtml({ isTl: true, name: 'TL One', channel: 'ff' });
  assert.ok(panel.includes('tr-boxes') && !panel.includes('tr-tl-kpis') && !panel.includes('tr-tlk'), 'purane 🚗/🚚 KPI cells nahi');
  assert.match(panel, /📦 Stock · TL total<\/small><b>14<\/b><em>VC4 8 · VC20 2 · VC5\+ 4/, 'stock box: total 14 + class mix');
  assert.match(panel, /Last month · September 2026<\/small><b>70<\/b>/, 'last month box');
  assert.match(panel, /Current MTD · October 2026<\/small><b>8<\/b>/, 'MTD box');
  assert.ok(panel.includes('🎯 Suggested qty') && panel.includes('sug-chip wo') && panel.includes('🚦 Priority'), 'suggested (dono) + priority');
  assert.ok((panel.match(/tr-class-tbl/g) || []).length === 1, 'class table sirf ek');
  const foot = panel.slice(panel.indexOf('<tfoot>'), panel.indexOf('</tfoot>'));
  assert.ok(!foot.includes('Agents total'), 'TL ki apni row nahi → "Agents total" alag nahi (wahi TL total hota)');
  assert.ok((foot.match(/<tr/g) || []).length === 1 && foot.includes('= TL TOTAL (2 agents ka jod)'), 'footer me sirf ek total row');
  assert.ok(!/undefined|NaN/.test(panel));

  TR._test.setIndex(mkIdx(true));
  const p2 = TR._test.tlPanelHtml({ isTl: true, name: 'TL One', channel: 'ff' });
  const f2 = p2.slice(p2.indexOf('<tfoot>'), p2.indexOf('</tfoot>'));
  assert.ok(f2.includes('Agents total (2)') && f2.includes('TL own') && f2.includes('= TL TOTAL (own + agents)'), 'TL ki apni row ho to agents + own = total teeno rows');
  assert.ok(p2.includes('👥 2 agents + TL'), 'priority box me agents + TL');
  TR._test.setIndex(null);
});

test('🧑‍💼 employee link agent — boxes + ek class table, 🚗/🚚 group rows (duplicate) gayi', () => {
  const html = TR._test.agentGroupSummaryHtml({
    channel: 'gv', name: 'A', stock: { VC4: 12, VC5: 8, VC16: 3 }, last: { VC4: 20, VC5: 9, VC16: 4 }, cur: { VC4: 5, VC5: 3, VC16: 2 },
    grp: { core: { stock: 14, last: 25, cur: 8 }, comm: { stock: 17, last: 15, cur: 6 } }
  });
  assert.ok(!html.includes('tr-qty-group"') && !html.includes('tr-qty-groups'), 'purani group rows nahi');
  assert.match(html, /📦 Stock<\/small><b>31<\/b><em>VC4 12 · VC20 2 · VC5\+ 17/);
  assert.ok((html.match(/tr-class-tbl/g) || []).length === 1, 'ek class table');
  assert.ok(html.includes('🟩 GV') && html.includes('VC4 + VC20 group'), 'channel + VC20 note');
  assert.ok(!/undefined|NaN/.test(html));
});

test('Global search bar is eagerly mounted across the app and covers both channels + tag identifiers', async () => {
  const idx = await read('index.html');
  const lazy = await read('lazy.js');
  // v3.61: masterSearch ab eager nahi (pehle index.html me app.js se pehle load hota tha, ~100 KB
  // extra first paint se pehle). Ab ye shell-extra wave me aata hai — loader (lazy.js) shell se pehle
  // load hona chahiye, aur search module usi wave list me hona chahiye.
  const lazyAt = idx.indexOf('lazy.js?v=110');
  const appAt = idx.indexOf('app.js?v=110');
  assert.ok(lazyAt >= 0 && appAt > lazyAt, 'loader app shell se pehle load hota hai');
  assert.ok(!/src="masterSearch\.js/.test(idx), 'search module eager nahi — first paint halka');
  assert.match(lazy, /\['masterSearch', 'palette'\]/, 'search shell-extra wave me hai');
  assert.match(lazy, /masterSearch: \[\.\.\.PROFILE_DEPS, 'searchReport', 'masterSearch'\]/, 'search page route bhi lazy group me hai');
  const app = await read('app.js');
  assert.match(app, /Global search stays visible on every page/);
  assert.match(app, /FF\.masterSearch\.mountTopbar\(\)/, 'search bar har page par mount hota hai');
  // v3.61: module first paint ke baad shell-extra wave me load hota hai, isliye mount bhi wahi hook
  // karta hai + search button click par on-demand load hota hai (bar kabhi missing nahi lagta).
  assert.match(app, /startShellExtras\(\)/, 'login ke baad shell extras (search included) start hote hain');
  assert.match(app, /ensureShell\(\['masterSearch', 'palette'\]\)/, 'search click par module on-demand load');
  assert.match(app, /const inp = U\.\$\('#master-search-input'\);[\s\S]{0,100}inp\.focus\(\)/, 'topbar search button focuses the existing input');
  const search = await read('masterSearch.js');
  assert.match(search, /Search all — FF\/GV agent, TL, ID, barcode, tag ID/);
  assert.match(search, /ingest\.ffReport[\s\S]*ingest\.gvReport/);
  assert.match(search, /details\.stock/);
  assert.match(search, /details\.assignment/);
});

test('👥 TL Master Profile — missing agent name cannot crash localeCompare and TL agent table remains renderable', async () => {
  const mp = await read('masterProfile.js');
  assert.ok(!mp.includes("x.name.localeCompare(y.name)"), 'TL/GV agent sorting never calls localeCompare on an undefined name');
  assert.match(mp, /String\(x && x\.name \|\| ''\)\.localeCompare\(String\(y && y\.name \|\| ''\)\)/, 'sorting normalizes missing names');
  assert.match(mp, /const agents = selfSplit\.team\.filter\(\(a\) => a && clean\(a\.name \|\| a\.agentName\)\);/, 'FF TL agent roster ignores nameless rows before table/render');
  assert.match(mp, /const rowsA = agents\.filter\(\(a\) => a && clean\(a\.name \|\| a\.agentName\)\)\.map/, 'GV TL agent roster ignores nameless rows too');
  assert.match(mp, /function tlAgentsTable\(pr\)/, 'TL-specific agent box/table renderer remains wired');
  assert.match(mp, /<section class=\"mp-sec\" data-mp-sec=\"agents\">/, 'TL agent box section is rendered');
});
test('🔎 topbar search remounts and routes through canonical Master Search page', async () => {
  const app = await read('app.js');
  assert.match(app, /FF\.masterSearch\.mountTopbar\(true\)/, 'shell wave remounts topbar search');
  const search = await read('masterSearch.js');
  assert.match(search, /Canonical route: every topbar \/ Master Search selection opens the same Master Search renderer/);
  assert.match(search, /FF\.app\.navigate\('masterSearch', params\)/);
  assert.match(search, /const id = clean\(p\.id \|\| p\.sub\)/);
  assert.match(search, /const ch = \^\(gv-\|ff-\)/);
});

test('🛑 suggestion selection locks current instance until next typing', async () => {
  const u = await read('util.js');
  assert.match(u, /let list = \[\], active = -1, destroyed = false, suspended = false/);
  assert.match(u, /if \(suspended\) \{ close\(\); return; \}/);
  assert.match(u, /const suspend = \(\) => \{ suspended = true; close\(\); \}/);
  assert.match(u, /const onInput = debounce\(\(\) => \{ suspended = false; compute\(\); \}, 80\)/);
  assert.match(u, /function destroyAllSuggestions\(keep\)/);
  const ms = await read('masterSearch.js');
  assert.match(ms, /U\.destroyAllSuggestions\(sug\)/);
  assert.match(ms, /if \(sug && sug\.suspend\) sug\.suspend\(\)/);
});
test('🎨 settings/theme — dark mode is opt-in and Tag Request order rows stay readable', async () => {
  const app = await read('app.js');
  assert.match(app, /ff_theme_explicit/);
  assert.match(app, /return 'light'/);
  const css = await read('styles.css');
  assert.match(css, /\.tr-col-label[\s\S]{0,260}color: #0f172a !important/);
  const tr = await read('tagRequest.js');
  assert.match(tr, /tr-col-index/);
  assert.match(tr, /data-tr-order-key/);
  assert.match(tr, /columns: \[\.\.\.card\.querySelectorAll/);
});

test('📗 Tag Request Sheet — configurable column order + one Agent spacer row', async () => {
  const server = await read('server.js');
  assert.match(server, /rowMode: 'agent-class-gap'/);
  const gs = await read('google-apps-script/Code.gs');
  assert.match(gs, /Tag Requests: Agent groups are separated by exactly one blank row/);
  assert.match(gs, /sh\.insertRowsAfter\(lastDataRow, 1\)/);
  assert.match(gs, /var agentCol = -1/);
});

test('🧹 global Master Search suggestion closes before navigation', async () => {
  const ms = await read('masterSearch.js');
  assert.match(ms, /Close the portalled dropdown BEFORE navigation/, 'global suggestion popup is explicitly closed before route change');
  assert.match(ms, /try \{ if \(suggestApi && suggestApi\.close\) suggestApi\.close\(\); \} catch \{\}/, 'selected suggestion closes the portal');
  assert.match(ms, /onEnter: \(q\) => \{[\s\S]{0,220}suggestApi && suggestApi\.close/, 'Enter search also closes the portal');
});

test('🚀 workspace boot gate — wait for data + first route before revealing dashboard', async () => {
  const app = await read('app.js');
  assert.match(app, /const WORKSPACE_BOOT_MIN_MS = 3600/);
  assert.match(app, /window\.__FF_FINISH_BOOT = \(\) => \{/);
  assert.match(app, /if \(FF\.auth && FF\.auth\.user\) return/);
  assert.match(app, /const preloadPromise = FF\.preloader \? FF\.preloader\.preloadAll\(false\)/);
  assert.match(app, /await renderCurrent\(\{ bootGate: true \}\)/);
  assert.match(app, /await releaseWorkspaceBoot\(\)/);
  assert.match(app, /document\.body\.classList\.remove\('ready'\)/);
  assert.match(app, /const warmPromise = FF\.lazy && FF\.lazy\.ensureAll/);
});
test('🎆 workspace boot animation survives macOS Reduce Motion', async () => {
  const css = await read('styles.css');
  assert.match(css, /\.boot-fireworks \{ position: absolute; inset: 0; pointer-events: none; z-index: 1;/, 'fireworks stay above boot background');
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]{0,900}\.app-boot \.boot-fireworks \.fw \{ animation: boot-burst 2\.4s ease-out infinite !important;/, 'fireworks remain animated even when OS Reduce Motion is enabled');
  assert.match(css, /\.app-boot \.boot-welcome \{ animation: boot-title 1\.8s ease-in-out infinite !important;/, 'workspace title animation remains visible');
  assert.match(css, /html \.boot-progress::after \{ animation: boot-slide 1\.2s ease-in-out infinite alternate !important;/, 'moving progress line remains visible');
});
test('🔗 selected suggestion identity — route name comes from the selected person', async () => {
  const ms = await read('masterSearch.js');
  assert.match(ms, /const p = person \|\| \{\};[\s\S]{0,220}const name = clean\(p\.name \|\| q\);/, 'selected person name is authoritative for route q');
  assert.match(ms, /if \(id\) params\.id = id;/, 'selected person ID stays attached to route');
  assert.match(ms, /if \(ch\) params\.ch = ch;/, 'selected person channel stays attached to route');
});
test('🧭 identity routing — exact canonical GV ID cannot open the FF duplicate', async () => {
  const ms = await read('masterSearch.js');
  assert.match(ms, /function canonicalPerson\(p, idx\)/);
  assert.match(ms, /const canonical = idx\.ids && idx\.ids\.get\(id\)/);
  assert.match(ms, /if \(exactIdGroup && !chFilter\)/);
  assert.match(ms, /if \(matchId\(exactIdGroup\.gv\)\) exactIdChannel = 'gv'/);
  assert.match(ms, /openGroup\(preferred, exactIdChannel \|\| undefined\)/);
});

test('📋 summary lists — Agent/TL Summary inherits canonical Master Profile KPIs', async () => {
  const as = await read('agentSummary.js');
  assert.match(as, /Canonical KPI enrichment/);
  assert.match(as, /MP\(\) && MP\(\)\.quick/);
  assert.match(as, /base\.cur = Number\(q\.totals && q\.totals\.curTotal\)/);
  assert.match(as, /base\.stock = Number\(q\.stock && q\.stock\.total\)/);
  assert.match(as, /base\.last = Number\(q\.totals && q\.totals\.lastTotal\)/);
});
test('📈 Growth — empty comparable EIR rows must not produce false -100%', async () => {
  const mp = await read('masterProfile.js');
  assert.match(mp, /const comparableUsable = !!\(comparable && \(num\(comparable\.curRows\) > 0 \|\| num\(comparable\.lastRows\) > 0\)\)/);
  assert.match(mp, /const projectedCurrent = comparableUsable/);
  assert.match(mp, /: projFallback\(num\(t\.curTotal\), b\.days, ym\)/);
  assert.match(mp, /const projectedGrowth = num\(t\.lastTotal\) > 0/);
});

test('🧑‍💼 FF Agent report — exact ID/EIR fallback + linked TL KPIs', async () => {
  const mp = await read('masterProfile.js');
  assert.match(mp, /function ffAgentIssueRows\(name, ids, tlName, tlId\)/);
  assert.match(mp, /const personId = clean\(\(a && \(a\.agentId \|\| a\.id\)\) \|\| p\.sub\)/);
  assert.match(mp, /const eirBins = classBinsFromRows\(eirRows, curYm, lastYm\)/);
  assert.match(mp, /out\.totals\.lastTotal = num\(eirBins\.last\.total\)/);
  assert.match(mp, /function attachLinkedTl\(out, light\)/);
  assert.match(mp, /const agentTlKpis = lt \? /);
  assert.match(mp, /TL Class-wise Issuance/);
  assert.match(mp, /Agent Stock/);
});

test('🎯 FF/GV identity — same-name same-channel records stay separate without linked IDs', async () => {
  const sr = await read('searchReport.js');
  assert.match(sr, /g\[ch\] && identitiesLinked\(p, g\[ch\]\)/);
  const ms = await read('masterSearch.js');
  assert.match(ms, /const personKey = \(p\) => .*normId/);
});
test('📦 GV individual stock — card fallback matches Tag Assignment class-wise stock', async () => {
  const mp = await read('masterProfile.js');
  assert.match(mp, /GV individual-agent card must use the same Tag Assignment stock source/);
  assert.match(mp, /gvRows\('stockAgent'\)/);
  assert.match(mp, /const total = U\.sum\(mine, \(x\) => num\(x\.n\)\)/);
  assert.match(mp, /out\.stockSource = 'Tag Assignment'/);
  assert.match(mp, /out\.dispatch\.sugVc4 = suggest\(out\.dispatch\.avgVc4, vc4\)/);
});
test('📈 growth — compare yesterday MTD against same calendar day last month', async () => {
  const mp = await read('masterProfile.js');
  assert.match(mp, /Comparable MTD growth/);
  assert.match(mp, /const yesterday = new Date\(now\.getFullYear\(\), now\.getMonth\(\), now\.getDate\(\) - 1\)/);
  assert.match(mp, /const prevCutDay = Math\.min\(day, prevLastDay\)/);
  assert.match(mp, /const growth = last > 0 \? \(\(cur - last\) \/ last\) \* 100/);
  assert.match(mp, /growthThrough: gi\.growthThrough/);
  assert.match(await read('masterSearch.js'), /p1\.growthThrough/);
});
test('🔎 dropdown suggestions — partial names use direct fallback and both inputs use 1-char trigger', async () => {
  const ms = await read('masterSearch.js');
  assert.match(ms, /direct\/fallback matching/);
  assert.match(ms, /const all = allPeople\(\)/);
  assert.match(ms, /suggestApi = U\.suggest\(input, \{\s*min: 1, max: 16/);
  assert.match(ms, /sug = U\.suggest\(input, \{\s*min: 1, max: 14/);
  assert.doesNotMatch(ms, /clearTimeout\(t\).*run\(input\.value, \{ open: false \}\)/s);
});
test('🚦 startup readiness — Render health stays green and storage retry is bounded', async () => {
  const server = await read('server.js');
  assert.match(server, /const bootState = \{ startedAt: Date\.now\(\), stage: 'starting', error: null \}/);
  assert.match(server, /url\.pathname === '\/api\/health'.*ready: false/s);
  assert.match(server, /Retry-After.*3/);
  assert.match(server, /StorageStore|AppsScriptStore/);
  assert.match(server, /await waitForBoot\(\)/, 'API requests wait on one server-side boot promise');
  assert.doesNotMatch(server, /for \(let attempt = 0; attempt < 5; attempt\+\+\) \{[\s\S]{0,500}sheetsStore\.read\(\)/);
  const auth = await read('auth.js');
  assert.match(auth, /booting = err && err\.status === 503 && err\.data && err\.data\.booting/);
  assert.match(auth, /maxBootRetries = 2/);
  assert.match(auth, /path === '\/api\/auth\/me' \? 120000/, 'auth readiness call can wait for durable startup');
  const storage = await read('apps-script-storage.js');
  assert.match(storage, /APPS_SCRIPT_ATTEMPTS/);
  assert.match(storage, /APPS_SCRIPT_TIMEOUT_MS/);
  assert.match(storage, /this\.timeoutMs/);
});

test('🏷️ v3.61 wiring — version pins + automatic cache-busting', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.version, '3.64.0');
  assert.match(await read('server.js'), /APP_VERSION = '3\.62\.0'/);
  const idx = await read('index.html');
  assert.match(idx, /styles\.css\?v=114/); assert.match(idx, /config\.js\?v=110/); assert.match(idx, /home\.js\?v=91/); assert.match(idx, /app\.js\?v=110/); assert.match(idx, /lazy\.js\?v=110/);
  // masterSearch ab shell-extra hai (first paint ke baad load hota hai) — index.html me eager nahi.
  assert.ok(!/src="masterSearch\.js/.test(idx), 'masterSearch eager nahi (first paint ke baad aata hai)');
  const sw = await read('sw.js');
  assert.match(sw, /apnapayment-v117/);
  assert.match(sw, /async function shellAssets\(/, 'SW precache list index.html se derive hoti hai (pins drift nahi karte)');
  assert.match(sw, /const isVersioned = \/\[\?&\]v=\//, 'fingerprinted assets cache-first serve hote hain');
  const srv = await read('server.js');
  assert.match(srv, /async function shellHtml\(/, 'stamped shell + body-based ETag');
  assert.match(srv, /X-FF-Stamp/, 'stamped response marker');
});
