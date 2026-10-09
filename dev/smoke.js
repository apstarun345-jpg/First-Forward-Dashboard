#!/usr/bin/env node
/* Headless smoke test: loads the browser scripts into a tiny fake DOM and runs every page's render path
   against a running server (default http://localhost:8080, login admin/admin123). It cannot check layout,
   but it catches ReferenceErrors / TypeErrors in the render logic and templates.
   Usage: node dev/smoke.js [baseUrl] */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:8080';
let cookie = '';
const failures = [];
const log = (...a) => console.log(...a);

// ---- fake DOM ----------------------------------------------------------------------------------
const REG = new Map();
class ClassList { constructor() { this.s = new Set(); } add(...c) { c.forEach((x) => this.s.add(x)); } remove(...c) { c.forEach((x) => this.s.delete(x)); } toggle(c, f) { if (f === undefined) f = !this.s.has(c); f ? this.s.add(c) : this.s.delete(c); return f; } contains(c) { return this.s.has(c); } }
class El {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this._html = ''; this.children = []; this.classList = new ClassList(); this.dataset = {}; this.style = { setProperty() {}, removeProperty() {} }; this.attrs = {}; this.value = ''; this.checked = false; this.hidden = false; this.files = []; this.parentNode = null; this.listeners = {}; this.disabled = false; this.textContent = ''; }
  get innerHTML() { return this._html; } set innerHTML(v) { this._html = String(v); this.children = []; }
  get outerHTML() { return this._html; }
  get isConnected() { return true; }
  get childNodes() { return this.children; }
  get content() { const f = new El('fragment'); f.children = [new El('div')]; return f; }
  get firstElementChild() { return this.children[0] || new El(); }
  get nextElementSibling() { return new El(); }
  get offsetWidth() { return 800; } get offsetHeight() { return 400; } get clientWidth() { return 800; } get scrollWidth() { return 800; }
  getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 400, bottom: 400, right: 800 }; }
  querySelector(sel) { const m = /^#([\w-]+)$/.exec(sel || ''); if (m) { let e = REG.get(m[1]); if (!e) { e = new El(); e.id = m[1]; REG.set(m[1], e); } e.parentNode = this; return e; } const e = new El(); e.parentNode = this; return e; }
  querySelectorAll() { return []; }
  getElementsByTagName() { return []; }
  closest() { return null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener() {}
  dispatchEvent() { return true; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  append(...c) { c.forEach((x) => typeof x === 'object' && this.appendChild(x)); }
  prepend(c) { this.children.unshift(c); }
  insertBefore(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  replaceChildren(...c) { this.children = []; c.forEach((x) => this.appendChild(x)); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith() {}
  insertAdjacentHTML(_, h) { this._html += h; }
  insertAdjacentElement(_, e) { this.appendChild(e); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  focus() {} blur() {} click() {} select() {} scrollIntoView() {} scrollTo() {}
  showModal() { this.open = true; } show() { this.open = true; } close() { this.open = false; }
  contains() { return false; }
  matches() { return false; }
  getContext() { return { drawImage() {}, fillRect() {}, measureText: () => ({ width: 10 }) }; }
  toDataURL() { return 'data:image/png;base64,'; }
}
const body = new El('body');
const documentEl = new El('html');
const document = {
  body, documentElement: documentEl, title: '', readyState: 'complete', activeElement: null, hidden: false, visibilityState: 'visible',
  createElement: (t) => new El(t), createTextNode: (t) => ({ textContent: t }), createDocumentFragment: () => new El('fragment'),
  querySelector: (sel) => body.querySelector(sel), querySelectorAll: () => [], getElementById: (id) => body.querySelector('#' + id),
  addEventListener() {}, removeEventListener() {}, execCommand() { return true; }
};
const location = { hash: '#/dashboard', href: `${BASE}/#/dashboard`, origin: BASE, pathname: '/', search: '', reload() {}, replace() {} };
const storage = new Map();
const localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), clear: () => storage.clear() };
let sheetNetworkRequests = 0;
const fetchImpl = async (url, opts = {}) => {
  if (url.includes('/api/gviz')) sheetNetworkRequests++;
  const abs = url.startsWith('http') ? url : BASE + url;
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(abs, { ...opts, headers, redirect: 'manual' });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return res;
};
const win = { document, location, localStorage, sessionStorage: localStorage, history: { replaceState() {}, pushState() {} }, navigator: { userAgent: 'smoke', clipboard: { writeText: async () => {} }, share: undefined }, innerWidth: 1400, innerHeight: 900, devicePixelRatio: 1, fetch: fetchImpl, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout, getComputedStyle: () => ({ getPropertyValue: () => '' }), scrollTo() {}, open() {}, alert() {}, confirm: () => true, prompt: () => '', setTimeout, clearTimeout, setInterval, clearInterval, console, URL, URLSearchParams, Blob, TextEncoder, TextDecoder, AbortController, Date, Math, JSON, Intl, Promise, Map, Set, Number, String, Array, Object, RegExp, Error, encodeURIComponent, decodeURIComponent, isNaN, isFinite, parseInt, parseFloat, Image: El, FileReader: El, CustomEvent: class {}, Event: class {}, structuredClone };
win.window = win; win.self = win; win.globalThis = win; win.top = win;
win.CSS = { escape: (s) => s };
win.ResizeObserver = class { observe() {} disconnect() {} };
win.IntersectionObserver = class { observe() {} disconnect() {} };
win.MutationObserver = class { observe() {} disconnect() {} };
win.HTMLElement = El; win.Element = El; win.Node = El;
const ctx = vm.createContext(win);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/\?.*$/, ''));
log('scripts:', scripts.join(' '));
for (const s of scripts) vm.runInContext(fs.readFileSync(path.join(ROOT, s), 'utf8'), ctx, { filename: s });
const FF = win.FF;
// ⚡ Lazy rollup: smoke test me saare page modules pehle se load kar do (warna pages.<x> undefined rehta
// hai) — aur FF.lazy.inject ko resolve-only bana do, kyunki fake DOM me <script> load nahi ho sakta.
try {
  const lazySrc = fs.readFileSync(path.join(ROOT, 'lazy.js'), 'utf8');
  const names = [...new Set([...lazySrc.matchAll(/'([A-Za-z][A-Za-z0-9-]*)'/g)].map((m) => m[1]))];
  // 🧹 v3.62 — retired pages (Control Tower · TV · Charts · Stock Radar · Sprints · Wow Zone) ke
  // module lazy GROUPS me nahi hain (sidebar se bhi hata diye gaye), lekin inka render logic smoke me
  // test hota rehta hai: file disk par hai aur feature wapas laana ho to yahi code chalta hai.
  const RETIRED_MODULES = ['controlTower', 'tv', 'chartExplorer', 'stockRadar', 'sprints', 'wow', 'wowzone'];
  const lazyFiles = [...new Set([...names, ...RETIRED_MODULES])].filter((n) => fs.existsSync(path.join(ROOT, `${n}.js`)) && !scripts.includes(`${n}.js`));
  for (const n of lazyFiles) vm.runInContext(fs.readFileSync(path.join(ROOT, `${n}.js`), 'utf8'), ctx, { filename: `${n}.js` });
  if (FF.lazy) FF.lazy.inject = (n) => Promise.resolve(n);
  log('lazy modules (smoke me pre-loaded):', lazyFiles.length, lazyFiles.join(' '));
} catch (err) { log('  ! lazy preload:', err.message); }
process.on('unhandledRejection', (e) => { log('  ! unhandled rejection:', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e); });
process.on('uncaughtException', (e) => { log('  ! uncaught:', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e); });

// keep app boot from redirecting to the login screen; we log in via the API directly
async function run(name, fn, check) {
  const t = Date.now();
  try { await fn(); await settle(120); log(`  ✓ ${name} (${Date.now() - t}ms)`); if (check) audit(name); }
  catch (err) { failures.push(name); log(`  ✗ ${name}: ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n      ') : err}`); }
}
const root = () => { const r = new El('main'); body.appendChild(r); return r; };
const BAD = /\bundefined\b|\bNaN\b|\[object Object\]/;
function audit(label) {
  const parts = [...REG.values()].map((e) => e.innerHTML).concat(body.children.map((c) => c.innerHTML));
  const all = parts.join('\n');
  const m = BAD.exec(all);
  if (m) { const i = m.index; failures.push(label + ' (leak)'); log(`  ✗ ${label}: suspicious "${m[0]}" in HTML: …${all.slice(Math.max(0, i - 160), i + 60).replace(/\s+/g, ' ')}…`); }
  else log(`      html ${all.length} chars ok`);
  if (process.env.DUMP) log('      >>> ' + all.replace(/\s+/g, ' ').slice(0, Number(process.env.DUMP) || 1500));
  REG.forEach((e) => { e.innerHTML = ''; }); body.children = [];
}
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

log(`\nSmoke against ${BASE}`);
await run('login via API', async () => {
  const res = await fetchImpl('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.SMOKE_USER || 'admin', password: process.env.SMOKE_PASS || 'admin123' }) });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
});
await run('auth.init (me + settings + theme)', async () => { const ok = await FF.auth.init(); if (!ok) throw new Error('auth.init returned false'); if (!FF.auth.user) throw new Error('no user'); });
await run('app.onLogin boot (sidebar/status)', async () => { await FF.app.onLogin(true); await settle(200); });
await run('v3.11 · topbar master search bar mount (dropdown input ke neeche, overlap nahi)', async () => {
  // onLogin ke baad bar khud mount ho jaata hai; DOM shim HTML strings nahi rakhta,
  // isliye module ka mount-flag + light index readiness verify karte hain.
  // mount async hota hai (agents + GV master ke aane par) — isliye thoda intezaar karo, warna test flaky.
  for (let i = 0; i < 30 && !FF.masterSearch.topbarMounted; i++) await settle(100);
  if (!FF.masterSearch.topbarMounted) throw new Error('topbar me master search bar mount nahi hua');
  await FF.masterSearch.buildLight();
  if (!FF.masterSearch.ready) throw new Error('search index ready nahi hua');
  const items = FF.masterSearch.suggestItems('a');
  if (!items.length) throw new Error('suggestions empty');
}, false);
await run('sidebar channel accordion hides unrelated groups', async () => {
  const nav = REG.get('nav'); const html = nav && nav.innerHTML || '';
  if (!html.includes('data-nav-group="First Forward"') || !html.includes('data-nav-group="GV Partner"') || !html.includes('data-nav-group="Cross Channel"')) throw new Error('channel groups missing');
  if (!/data-nav-group="First Forward"[^>]*aria-expanded="true"/.test(html)) throw new Error('current First Forward group is not expanded');
  if (!/id="nav-group-gv-partner" hidden/.test(html) || !/id="nav-group-cross-channel" hidden/.test(html)) throw new Error('unrelated channel groups are not hidden');
});
await run('autocomplete dropdown stays outside/below search input', async () => {
  const input = new El('input'); input.value = 'ra';
  input.getBoundingClientRect = () => ({ top: 20, left: 100, width: 320, height: 38, right: 420, bottom: 58 });
  body.appendChild(input);
  const ac = FF.util.suggest(input, { items: [{ kind: 'agent', label: 'Rahul', sub: 'Test TL' }] });
  ac.refresh(); await settle(10);
  const box = body.children[body.children.length - 1];
  if (box.parentNode !== body) throw new Error('suggestion list body portal me nahi hai');
  if (Number.parseFloat(box.style.top || '0') < 66) throw new Error(`dropdown input ko cover kar raha hai (top ${box.style.top})`);
  if (input.getAttribute('aria-expanded') !== 'true') throw new Error('autocomplete aria-expanded update nahi hua');
  ac.destroy(); input.remove();
});
await run('store.preload', async () => { await FF.store.preload(false); const st = FF.store.state; const errs = Object.entries(st.errors || {}).filter(([, e]) => e); if (errs.length) throw new Error('dataset errors: ' + errs.map(([k, e]) => `${k}: ${e.message || e}`).join(' | ')); });
for (const ds of FF.store.DATASETS ? Object.keys(FF.store.DATASETS) : ['daily', 'agents', 'agentClass', 'status', 'stock', 'stockAgents', 'stockTypes', 'report']) {
  await run(`dataset ${ds}`, async () => {
    const v = await FF.store.need(ds); const n = Array.isArray(v) ? v.length : v && v.rows ? v.rows.length : -1;
    // agentDailyClass = AAJ ka EIR agent × class — FF data T+1 hai (asli sheet jaisa mock), isliye aaj khaali ho sakta hai
    if (n <= 0 && !(n === 0 && ds === 'agentDailyClass' && FF.filters && FF.filters.ffLagOn && FF.filters.ffLagOn())) throw new Error(`empty (${n})`);
    log(`      ${ds}: ${n} rows${n === 0 ? ' (FF T+1 — aaj ka EIR kal aayega)' : ''}`);
  });
}
await run('store.suggestions', async () => { const s = FF.store.suggestions({ agents: true, tls: true }); if (!s.length) throw new Error('no suggestions'); if (s.some((x) => /^APS$/i.test(x.label) && x.kind === 'tl')) throw new Error('APS leaked into TL suggestions'); log(`      ${s.length} suggestions, e.g. ${s.slice(0, 3).map((x) => `${x.kind}:${x.label}`).join(', ')}`); });

const pages = FF.pages;
await run('Bulk Tag Status · paste / Excel upload / results page', async () => {
  if (!pages.bulkTagStatus || typeof pages.bulkTagStatus.render !== 'function') throw new Error('Bulk Tag Status page module register nahi hua');
  const r = root();
  await pages.bulkTagStatus.render(r, {}, {});
  const html = r.innerHTML || '';
  for (const label of ['Bulk Tag Status', 'bts-paste', 'bts-file', 'Check Status', 'GV Master', 'EIR', 'StockDataa', 'Tag Assignment', 'Download Excel template']) {
    if (!html.includes(label)) throw new Error('Bulk Tag Status UI me "' + label + '" missing');
  }
}, true);
await run('raw sheets stay lazy and load only when their tab opens', async () => {
  const before = sheetNetworkRequests;
  await FF.preloader.preloadAll(false);
  if (sheetNetworkRequests !== before) throw new Error('aggregate preload unexpectedly queried raw sheets');
  const tabs = FF.config.allTabs(true).filter(t => FF.auth.can('sheet:' + t.id));
  for (const tab of tabs) {
    const beforeTab = sheetNetworkRequests;
    await pages.sheet.render(root(), { name: tab.id }, {});
    if (sheetNetworkRequests <= beforeTab) throw new Error(`${tab.id} did not load on demand`);
  }
  log(`      aggregate preload: 0 raw-sheet requests · ${tabs.length} tabs queried only on open`);
});
await run('dashboard.render', () => pages.dashboard.render(root(), {}, {}), true);
await run('trend.render daily', () => pages.trend.render(root(), { mode: 'daily' }, {}), true);
await run('trend.render weekly', () => pages.trend.render(root(), { mode: 'weekly' }, {}), true);
await run('trend.render monthly', () => pages.trend.render(root(), { mode: 'monthly' }, {}), true);
await run('trend.render compare', () => pages.trend.render(root(), { mode: 'compare' }, {}), true);
const agents = await FF.store.need('agents');
const someAgent = agents.find((a) => a.n > 3)?.name; const someTl = agents.find((a) => !FF.config.isExcludedTl(a.tlName))?.tlName;
log(`      sample agent "${someAgent}" · TL "${someTl}"`);
await run('trend.render tl filter', () => pages.trend.render(root(), { mode: 'daily', tl: someTl }, {}), true);
await run('trend.render agent filter', () => pages.trend.render(root(), { mode: 'compare', agent: someAgent }, {}), true);
await run('targets.render', () => pages.targets.render(root(), {}, {}), true);
await run('targets.render gv+month', () => pages.targets.render(root(), { month: FF.util.prevMonthKey(FF.util.ymKey(new Date())) }, {}), true);
await run('targets.render achievements tab', () => pages.targets.render(root(), { tab: 'achieve' }, {}), true);
await run('targets.render tl rollup tab', () => pages.targets.render(root(), { tab: 'tl' }, {}), true);
await run('targets 4-way header (VC20 · VC5+ · All Comm)', async () => {
  const r = root(); await pages.targets.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const s of ['VC20', 'VC5+', 'All Comm']) if (!html.includes(s)) throw new Error(`targets table me "${s}" nahi mila`);
}, true);

await run('targets separate class-wise fields + bulk controls', async () => {
  const r = root(); await pages.targets.render(r, { tab: 'targets' }, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Overall target', 'VC4 target', 'VC20 target', 'VC5+ target', 'data-class-target="vc4"', 'data-class-target="vc20"', 'data-class-target="vc5p"', 'tg-bulk-class-apply', 'tg-bulk-class-all']) {
    if (!html.includes(label)) throw new Error(`class target UI me "${label}" missing`);
  }
}, true);

await run('Home Target Achievement class-wise maths and target-agent scope', async () => {
  const ym = FF.util.ymKey(new Date());
  const targets = [
    { ym, key: 'ff|ALPHA', source: 'ff', agent: 'Alpha', target: 25, classTargets: { vc4: 10, vc20: 2, vc5p: 0 } },
    { ym, key: 'gv|BETA', source: 'gv', agent: 'Beta', target: 10, classTargets: { vc4: 5, vc20: 0, vc5p: 3 } }
  ];
  const ffRows = [
    { ym, channel: 'First Forward', name: 'Alpha', group: 'VC4', n: 6 },
    { ym, channel: 'First Forward', name: 'Alpha', group: 'VC20', n: 4 },
    { ym, channel: 'First Forward', name: 'Alpha', group: 'VC5+', n: 50 },
    { ym, channel: 'First Forward', name: 'Unmatched Agent', group: 'VC4', n: 900 }
  ];
  const gvRows = [
    { agentName: 'Beta', vc4: 2, vc20: 500, vc5p: 4 },
    { agentName: 'Unmatched Agent', vc4: 900, vc20: 900, vc5p: 900 }
  ];
  const result = pages.home.targetAchievementSummary(targets, ym, ffRows, gvRows, ['ff', 'gv']);
  const expect = (got, wanted, label) => { if (Number(got) !== wanted) throw new Error(`${label}: expected ${wanted}, got ${got}`); };
  expect(result.classes.vc4.target, 15, 'VC4 target');
  expect(result.classes.vc4.issued, 8, 'VC4 issued should include only target agents');
  expect(result.classes.vc4.remaining, 7, 'VC4 remaining');
  expect(result.classes.vc20.target, 2, 'VC20 target');
  expect(result.classes.vc20.issued, 4, 'VC20 issued should skip GV agent with no VC20 target');
  expect(result.classes.vc5p.target, 3, 'VC5+ target');
  expect(result.classes.vc5p.issued, 4, 'VC5+ issued');
  expect(result.totalTarget, 20, 'Total class target');
  expect(result.totalIssued, 16, 'Total class issued');
  expect(result.totalRemaining, 7, 'Total remaining is sum of class gaps, not netted across classes');
  expect(result.totalPct, 80, 'Total achievement %');
  const html = pages.home.targetAchievementHtml(result, ym);
  for (const label of ['Target Achievement', 'VC4 Achievement', 'VC20 Achievement', 'VC5+ Achievement', 'Total Achievement', 'Remaining']) {
    if (!html.includes(label)) throw new Error(`Home achievement card me "${label}" missing`);
  }
}, true);
await run('rangeReport.render default', () => pages.rangeReport.render(root(), {}, {}), true);
await run('rangeReport.render custom range', () => { const d = new Date(); d.setDate(d.getDate() - 20); return pages.rangeReport.render(root(), { from: FF.util.dateKey(d), to: FF.util.dateKey(new Date()) }, {}); }, true);
await run('stock.render overview', () => pages.stock.render(root(), {}, {}), true);
await run('stock.render agent', () => pages.stock.render(root(), { agent: someAgent }, {}), true);
await run('stock.render tl', () => pages.stock.render(root(), { tl: someTl }, {}), true);
await run('stock.render cls', () => pages.stock.render(root(), { cls: 'VC4' }, {}), true);
await run('stock.render cls commercial', () => pages.stock.render(root(), { cls: '12' }, {}), true);
await run('stock 4-way class split (VC4/VC20/VC5+/All Comm)', async () => {
  const r = root(); await pages.stock.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const s of ['VC20', 'VC5+', 'All Comm']) if (!html.includes(s)) throw new Error(`stock overview me "${s}" nahi mila`);
}, true);
await run('model.loadStockRows (xlsx source)', async () => { const r = await FF.model.loadStockRows({ agent: someAgent, limit: 50 }); if (!r.rows.length) throw new Error('no rows'); log(`      ${r.rows.length} raw rows · ${r.header.length} cols`); });
await run('performance.render overview', () => pages.performance.render(root(), {}, {}), true);
await run('performance agents()', async () => { const list = pages.performance.agents(); if (!list.length) throw new Error('no agents parsed from REPORT'); const withTl = list.filter((a) => a.tlExcluded).length; log(`      ${list.length} agents · ${withTl} direct (APS) · months ${JSON.stringify(list[0] && pages.performance.months ? pages.performance.months() : '')}`); });
for (const view of ['agents', 'tls', 'alerts', 'columns']) await run(`performance.render view=${view}`, () => pages.performance.render(root(), { view }, {}));
await run('performance.render q=agent (auto-open drawer)', () => pages.performance.render(root(), { q: someAgent }, {}), true);
await run('performance.render q=tl', () => pages.performance.render(root(), { q: someTl }, {}), true);
await run('performance.render priority chip', () => pages.performance.render(root(), { view: 'agents', priority: 'High' }, {}), true);
await run('performance 4-way + suggested dispatch card', async () => {
  const r = root();
  await pages.performance.render(r, { view: 'overview' }, {});
  let html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const s of ['VC20', 'VC5+', 'All Comm']) if (!html.includes(s)) throw new Error(`performance overview me "${s}" nahi mila`);
  await pages.performance.render(r, { view: 'agents' }, {});
  html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!html.includes('Comm · V20/V5+')) throw new Error('agents table me 4-way column label nahi');
  await pages.performance.render(r, { view: 'alerts' }, {});
  html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!html.includes('Suggested dispatch plan')) throw new Error('alerts view me 🎯 dispatch plan card nahi');
  if (!html.includes('Direct Agents · all')) throw new Error('alerts view me Direct Agents filter nahi');
}, true);
// ---- GV Partner (second Google Sheet) ----
await run('gv.preload (master + stock + report)', async () => {
  await FF.gv.preload(false);
  const errs = Object.entries(FF.gv.state.errors || {}).filter(([, e]) => e);
  if (errs.length) throw new Error('gv errors: ' + errs.map(([k, e]) => `${k}: ${e && e.message ? e.message : e}`).join(' | '));
});
for (const ds of Object.keys(FF.gv.DATASETS)) {
  await run(`gv dataset ${ds}`, async () => { const v = await FF.gv.need(ds); const n = Array.isArray(v) ? v.length : -1; if (n <= 0) throw new Error(`empty (${n})`); log(`      ${ds}: ${n} rows`); });
}
await run('gv aggregations + people', async () => {
  const months = FF.gv.months(); const latest = months[months.length - 1];
  const s = FF.gv.summary(latest); if (!s.total) throw new Error('summary empty');
  const series = FF.gv.dailySeries(latest); const weekly = FF.gv.weekly(latest);
  const agents = FF.gv.agentRollup(latest); const tls = FF.gv.tlRollup(latest); const ppl = FF.gv.people();
  if (!series.totals.some((n) => n > 0)) throw new Error('dailySeries empty');
  log(`      months ${months.join(', ')} · latest ${FF.util.ymKey(FF.gv.latestDate())} total ${s.total} · week buckets ${weekly.length} · agents ${agents.length} · tls ${tls.length} · people ${ppl.agents.length}/${ppl.tls.length}`);
});
await run('page home — GV aaj live + month KPI + charts + stock (master search hata hua)', async () => {
  const r = root(); await pages.home.render(r, {}, {}); await settle(500);
  const all = [r.innerHTML, ...REG.values().map((e) => e.innerHTML), ...body.children.map((c) => c.innerHTML)].join('\n');
  // ❌ Home par master search nahi (ab Management → 🔎 Master Search page hai)
  if (/home-master-input|home-master-search/.test(all)) throw new Error('home par purana master search abhi bhi render ho raha hai');
  for (const mount of ['id="home-gv-live"', 'id="home-month"', 'id="home-charts"', 'id="home-stock"']) {
    if (!all.includes(mount)) throw new Error(`home section missing: ${mount}`);
  }
  for (const label of ['GV · Aaj ka live', 'Expected Today', 'Last day ·', 'total (MTD)', 'Expected in ', 'KPI cards',
    'First Forward · Stock in field', 'GV Partner · Stock in field', 'Stock split', 'Month-to-date · last vs current']) {
    if (!all.includes(label)) throw new Error(`home me "${label}" nahi mila`);
  }
  if (!/pct-inline (pos|neg|flat)/.test(all)) throw new Error('month KPI cards me last-month % chip nahi mila');
  if (!all.includes('Run Rate · Per Day') || !all.includes('hm-runrate-list')) throw new Error('Home class-wise run-rate KPI missing');
  if (!all.includes('Total Run Rate') || !all.includes('Total Expected')) throw new Error('Home KPI totals missing');
  if (!all.includes('hm-expected-list')) throw new Error('Expected-in-month class breakdown missing');
  for (const label of ['VC4', 'VC20', 'VC5+']) {
    if (!all.includes(label)) throw new Error(`Home KPI me class ${label} missing`);
  }
  if (process.env.HOME_DUMP) log('      HOME >>> ' + r.innerHTML.replace(/\s+/g, ' ').slice(0, Number(process.env.HOME_DUMP) || 4000));
}, true);
await run('🔎 v3.46 · Management → Master Search page (naam → poora data, koi list/box nahi)', async () => {
  if (!FF.pages.masterSearch || typeof FF.pages.masterSearch.render !== 'function') throw new Error('FF.pages.masterSearch register nahi hua');
  if (typeof FF.masterSearch.openSearchPage !== 'function') throw new Error('FF.masterSearch.openSearchPage export missing');
  const list = pages.performance.agents();
  const probe = (list[0] || {}).name || '';
  if (!probe) throw new Error('probe agent nahi mila');
  const r = root(); await pages.masterSearch.render(r, { q: probe.split(' ')[0] }, {}); await settle(700);
  const html = [r.innerHTML, ...REG.values().map((e) => e.innerHTML)].join('\n');
  for (const label of ['Master Search', 'msp-report', '🟩 GV']) { if (!html.includes(label)) throw new Error(`Master Search page me "${label}" nahi mila`); }
  if (!/sr-combined|sr-tab|mp-kpis/.test(html)) throw new Error('Master Search page me poora report render nahi hua');
  if (/ms-panel/.test(html)) throw new Error('purana results panel (list/box) khul gaya');
  log(`      master search page html ${html.length} chars ok`);
}, true);
await run('page gvDashboard', () => pages.gvDashboard.render(root(), {}, {}), true);
await run('gvDashboard 4-way + suggested dispatch card', async () => {
  const r = root(); await pages.gvDashboard.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const s of ['VC20', 'VC5+', 'All Comm']) if (!html.includes(s)) throw new Error(`gvDashboard me "${s}" nahi mila`);
  if (!html.includes('Suggested dispatch plan')) throw new Error('gvDashboard me 🎯 dispatch plan card nahi');
  if (!html.includes('Direct Agents · all')) throw new Error('gvDashboard me Direct Agents filter nahi');
}, true);
await run('page gvTrend daily', () => pages.gvTrend.render(root(), { mode: 'daily' }, {}), true);
await run('page gvTrend weekly', () => pages.gvTrend.render(root(), { mode: 'weekly' }, {}), true);
await run('page gvTrend monthly', () => pages.gvTrend.render(root(), { mode: 'monthly' }, {}), true);
await run('page gvTrend compare', () => pages.gvTrend.render(root(), { mode: 'compare' }, {}), true);
await run('page gvStock', () => pages.gvStock.render(root(), {}, {}), true);
const gvAgent = (FF.gv.people().agents[0] || {}).name;
log(`      sample GV agent "${gvAgent}"`);
await run('page gvStock tl filter', () => pages.gvStock.render(root(), { tl: (FF.gv.people().tls[0] || {}).name || '' }, {}), true);
await run('gvStock explicit tab clears stale TL param', async () => { const r = root(); await pages.gvStock.render(r, { view: 'class', tl: 'stale-TL' }, {}); const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n'); if (!html.includes('Class × TL matrix')) throw new Error('explicit class tab stale TL se override hua'); }, true);
await run('page gvStockReport agents', () => pages.gvStockReport.render(root(), { view: 'agents' }, {}), true);
await run('page gvStockReport dispatch', async () => { const r = root(); await pages.gvStockReport.render(r, { view: 'dispatch' }, {}); const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n'); for (const s of ['GV Dispatch plan', 'Other Direct Agents', 'Tag required', 'Direct filter', 'WhatsApp']) if (!html.includes(s)) throw new Error(`GV Stock Report me "${s}" nahi mila`); }, true);
await run('page gvPerformance', async () => { const r = root(); await pages.gvPerformance.render(r, {}, {}); const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n'); for (const s of ['WhatsApp report', 'GV Stock Report', 'Overview', 'Agents', 'TLs', 'Alerts']) if (!html.includes(s)) throw new Error(`GV Performance me "${s}" nahi mila`); }, true);
await run('page gvPerformance q=agent', () => pages.gvPerformance.render(root(), { q: gvAgent }, {}), true);
await run('page compare', () => pages.compare.render(root(), {}, {}), true);
await run('professional page executive cockpit', () => pages.executive.render(root(), {}, {}), true);
await run('FF commission wide-range fallback (right-side column bhi mile)', async () => {
  const store = FF.store.state.data;
  const full = store.report;
  if (!full || !full.rows) throw new Error('REPORT table store me nahi hai');
  const orig = FF.data.query.bind(FF.data);
  let wideAsked = 0;
  FF.data.query = async (sheet, tq, opts = {}) => { if (sheet === 'REPORT' && opts.range) wideAsked++; return orig(sheet, tq, opts); };
  store.report = { ...full, rows: full.rows.map((r) => r.slice(0, 40)), cols: (full.cols || []).slice(0, 40) };
  try {
    FF.data.clearCache();
    const mapping = await FF.insights.ffCommissionData();
    if (!wideAsked) throw new Error('wide (A1:ZZ) re-fetch trigger nahi hua');
    if (wideAsked < 1) throw new Error('koi wide query nahi gayi');
    if (mapping.lastColLetter !== 'CB') throw new Error(`wide ke baad trailing blanks trim nahi hue (last ${mapping.lastColLetter}, CB expected)`);
    if (!mapping.rateCol || mapping.rateCol.index < 40) throw new Error('wide range ke baad bhi commission rate column nahi mila');
    if (!mapping.wideUsed) throw new Error('wide table adopt nahi hua');
    if (!mapping.needsWiderRange || mapping.outOfRange < 1) throw new Error('chhota range detect nahi hua (needsWiderRange)');
  } finally { store.report = full; FF.data.query = orig; FF.data.clearCache(); }
  const mapping = await FF.insights.ffCommissionData();
  if (mapping.needsWiderRange) throw new Error('full-width table ke saath needsWiderRange galat true hai');
  if (!mapping.agents.some((a) => Number.isFinite(a.computed))) throw new Error('full width me computed commission nahi bana');
}, false);

await run('professional page GV commission · per-class boards', async () => {
  const r = root(); await pages.gvCommission.render(r, { group: 'weekday' }, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Class boards · agent-wise commission', 'VC4 · Car / Jeep', 'VC20 · Light commercial', 'VC5+ · Commercial', 'Class-wise commission summary']) {
    if (!html.includes(label)) throw new Error(`GV commission class board me "${label}" nahi mila`);
  }
  for (const id of ['gvc-class-vc4-csv', 'gvc-class-vc20-csv', 'gvc-class-vc5-csv']) if (!html.includes(id)) throw new Error(`class CSV button ${id} missing`);
  if (!/Effective rate/.test(html) || !/Commission \/ tag/.test(html)) throw new Error('class board columns missing');
  if (/commission-selfcheck|Rate column \(row 2 heading\)|ffc-tl-csv/.test(html)) throw new Error('FF-only markup GV page me leak ho gaya');
}, true);
await run('FF commission · row-2 heading (2-header REPORT) detect hota hai', async () => {
  const store = FF.store.state.data;
  const full = store.report;
  if (!full || !full.rows) throw new Error('REPORT table store me nahi hai');
  // Live sheet jaisa: row 1 section ka naam, row 2 me asli heading. Row 1 me commission ka zikr hi na ho
  // (sirf row 2 me "Commission Rate" / "Earned Commission") — detection ko phir bhi kaam karna chahiye.
  const rows = full.rows.map((r) => r.slice());
  rows[0] = rows[0].map((c, i) => (i === 78 || i === 79 ? '' : c));
  const cfg = FF.config.ffCommission; const before = { ...cfg };
  try {
    cfg.rateCol = ''; cfg.earnedCol = ''; cfg.categoryCol = ''; cfg.dateCol = '';
    store.report = { ...full, rows };
    FF.data.clearCache();
    const m = await FF.insights.ffCommissionData();
    if (!m.rateCol || m.rateCol.index !== 78) throw new Error(`row-2 rate heading detect nahi hui (got ${m.rateCol && m.rateCol.letter})`);
    if (!m.amountCol || m.amountCol.index !== 79) throw new Error('row-2 earned heading detect nahi hui');
    if (m.rateCol.sub !== 'Commission Rate') throw new Error(`rate heading ka sub row "${m.rateCol.sub}" hai`);
    if (m.rateIsPercent) throw new Error('per-tag rate ko percent maan liya gaya');
    if (!m.agents.some((a) => Number.isFinite(a.computed))) throw new Error('row-2 heading ke saath computed commission nahi bana');
    // duplicate heading: ek duplicate khaali column add karo — values wala column jeetna chahiye
    const dup = rows.map((r) => r.slice());
    dup[0] = dup[0].concat(['']);
    dup[1] = dup[1].concat(['Commission Rate']);
    for (let r = 2; r < dup.length; r++) dup[r] = dup[r].concat(['']);
    store.report = { ...full, rows: dup, cols: (full.cols || []).concat([{ id: 'CC', label: '', type: 'number' }]) };
    FF.data.clearCache();
    const m2 = await FF.insights.ffCommissionData();
    if (m2.rateCol.index !== 78) throw new Error(`duplicate heading me khaali column chun liya (${m2.rateCol.letter})`);
  } finally { Object.assign(cfg, before); store.report = full; FF.data.clearCache(); }
}, false);

await run('professional page FF reported commission (dynamic mapping)', async () => {
  const mapping = await FF.insights.ffCommissionData();
  if (!mapping.amountCol) throw new Error('REPORT ka earned-commission heading detect nahi hua');
  if (!mapping.rateCol) throw new Error('REPORT ka commission-rate heading detect nahi hua');
  if (mapping.rateCol.letter !== 'CA' || mapping.amountCol.letter !== 'CB') throw new Error(`commission columns galat detect hue: ${mapping.rateCol.letter}/${mapping.amountCol.letter}`);
  if (!mapping.agents.some((a) => Number.isFinite(a.earned))) throw new Error('earned commission values read nahi hue');
  if (!mapping.agents.some((a) => Number.isFinite(a.computed))) { throw new Error('rate × tags fallback compute nahi hua'); }
  const r = root(); await pages.ffCommission.render(r, { headings: 'all' }, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const s of ['REPORT commission column finder', 'Commission rate source', 'Rate range in sheet', 'Agent-wise commission', 'Rate × tags', 'Heading map', 'ffc-fresh-top', 'Commission source self-check', 'Rate column (row 2 heading)', 'TL-wise commission rollup', 'ffc-tl-csv']) if (!html.includes(s)) throw new Error(`FF commission me "${s}" nahi mila`);
  if (!/CA/.test(html) || !/CB/.test(html)) throw new Error('heading map me column letters nahi dikh rahe');
}, true);
await run('FF commission · Settings me heading ka naam (letter nahi) bhi chalta hai', async () => {
  const cfg = FF.config.ffCommission;
  const before = { ...cfg };
  try {
    cfg.rateCol = 'commission rate';           // chhote letters + space
    cfg.earnedCol = '  Earned   Commission  '; // extra spaces
    FF.data.clearCache();
    const m = await FF.insights.ffCommissionData();
    if (!m.rateCol || m.rateCol.letter !== 'CA' || m.rateCol.via !== 'name') throw new Error(`rate naam se resolve nahi hua: ${JSON.stringify(m.rateCol && { l: m.rateCol.letter, via: m.rateCol.via })}`);
    if (!m.amountCol || m.amountCol.letter !== 'CB' || m.amountCol.via !== 'name') throw new Error('earned naam se resolve nahi hua');
    if (m.warnings.length) throw new Error('resolved mapping ke liye warning nahi honi chahiye');
    cfg.rateCol = 'Aisi Heading Nahin Hai';
    FF.data.clearCache();
    const bad = await FF.insights.ffCommissionData();
    if (!bad.warnings.some((w) => w.key === 'rateCol')) throw new Error('galat heading naam par warning nahi mili');
    const r = root(); await pages.ffCommission.render(r, {}, {});
    const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
    if (!/REPORT me nahi mila/.test(html)) throw new Error('missing-heading warning page par nahi dikhi');
  } finally { Object.assign(cfg, before); FF.data.clearCache(); }
}, true);
await run('FF commission · payout sheet class rates + expected commission', async () => {
  const payout = await FF.insights.ffPayoutRates();
  if (!payout.found) throw new Error(`payout tab parse nahi hui: ${payout.error || ''}`);
  const vc4 = payout.byClass.get('VC4');
  if (!vc4 || Number(vc4.rate) !== 3.5) throw new Error(`VC4 payout rate galat: ${JSON.stringify(vc4 && vc4.rate)}`);
  if (!payout.penaltyRows.some((p) => p.key === 'wrong-vrn' && Number(p.penalty) === 50)) throw new Error('Wrong VRN penalty line nahi mili');
  const sample = { name: 'S', curVc4: 10, curC1: 2, curC2: 0, curC3: 0, curC4: 0, curC5: 0, curNvc4: 4, wrongVrn: 1 }; // NVC4=4 me VC5(2)+VC20(2)
  const calc = FF.insights.payoutExpected(sample, payout);
  if (!calc || calc.expected !== (10 * 3.5 + 2 * 5 + 2 * 8) - 50) throw new Error(`payout expected calc galat: ${JSON.stringify(calc)}`);
  const r = root(); await pages.ffCommission.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const s of ['Payout sheet · class-wise rates', 'Expected commission · payout rates', 'Payout expected', 'ffc-payout-csv', 'Wrong VRN penalty']) if (!html.includes(s)) throw new Error(`payout card me "${s}" nahi mila`);
}, true);
await run('GV commission · per-class agent matrix (exact sums, no average)', async () => {
  const r = root(); await pages.gvCommission.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const s of ['Agent × class commission', 'gvc-matrix-csv', 'VC5+ · exact class split', 'VC4 commission', 'VC20 commission', 'VC5+ commission', 'Commission (sum)']) if (!html.includes(s)) throw new Error(`GV class matrix me "${s}" nahi mila`);
  if (/commission-selfcheck|ffc-tl-csv/.test(html)) throw new Error('FF-only markup GV page me leak ho gaya');
}, true);
await run('stock forecasting · FF demand se GV rows (5845036) exclude', async () => {
  const rows = await FF.insights.forecastRows(0, 5);
  if (!rows.length) throw new Error('forecast rows khali hain');
  const r = root(); await pages.forecast.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/5845036 exclude/.test(html)) throw new Error('channel summary me GV-exclude note nahi');
}, true);
await run('executive cockpit · FF/GV combined me double count nahi + colourful clickable cards', async () => {
  const r = root(); await pages.executive.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/5845036/.test(html) || !/double count nahi/.test(html)) throw new Error('executive me GV-exclude note nahi');
  if (!/data-tone="g\d+"/.test(html)) throw new Error('executive KPI cards colourful (gradient tone) nahi hain');
  if (!/ins-metric-icon/.test(html)) throw new Error('executive KPI cards me icons nahi hain');
  if (!/Full data/.test(html)) throw new Error('executive KPI cards par click-hint (Full data) nahi hai');
  // 📦 Field stock: GV master ID 5845036 wali StockDataa rows FF total se exclude honi chahiye.
  const stockAgents = FF.store.get('stockAgents') || [];
  // GV parked = master ID 5845036 ke naam, ya TL "ApnaPayment Pvt. Ltd." (asli sheet me agent khaali master rows)
  const parked = (x) => String(x.agentId || '').trim() === '5845036' || /^apnapayment pvt\.? ltd\.?$/i.test(String(x.tlName || '').trim());
  const gvHeld = stockAgents.filter(parked).reduce((n, x) => n + (x.n || 0), 0);
  if (!(gvHeld > 0)) throw new Error('mock StockDataa me GV master ID wali rows hi nahi — exclusion test meaningless');
  const ffClean = stockAgents.filter((x) => !parked(x)).reduce((n, x) => n + (x.n || 0), 0);
  const gvStock = (FF.gv.get('stockClass') || []).reduce((n, x) => n + (x.n || 0), 0);
  const combined = FF.util.fmt(ffClean + gvStock);
  if (!html.includes(`<b>${combined}</b>`)) throw new Error(`Combined field stock <b>${combined}</b> executive me nahi dikha — GV master ${FF.util.fmt(gvHeld)} exclude hua?`);
}, true);
await run('professional page verified dual-channel agents', async () => {
  const identity = await FF.insights.buildCross();
  if (!identity.rows.length) throw new Error('mock identity join returned zero verified agents');
  if (!identity.rows.some((r) => r.methods.includes('barcode') && r.methods.includes('gv-id'))) throw new Error('two-signal overlap missing');
  const r = root(); await pages.dualChannel.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/barcode|unique-ID|unique ID/i.test(html)) throw new Error('identity evidence missing');
  for (const label of ['Double-mapped barcodes', 'Double-mapped barcodes CSV', 'FF tags · matched agents', 'GV tags · matched agents', 'cross-double-csv', 'FF TL', 'GV TL']) {
    if (!html.includes(label)) throw new Error(`dual-channel me "${label}" nahi mila`);
  }
  const onlyDouble = root(); await pages.dualChannel.render(onlyDouble, { dup: 'double' }, {});
  if (!/Doubled|Double-mapped|double-mapped/i.test(onlyDouble.innerHTML)) throw new Error('double-mapped filter view missing');
}, true);
await run('dual-channel ghost holders (Apna Payment / not-assigned) double count nahi hote', async () => {
  const r = root(); await pages.dualChannel.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['ghost-holder ignore', 'Exclude rule', 'Apna Payment']) {
    if (!html.includes(label)) throw new Error(`dual-channel me ghost exclude note "${label}" nahi mila`);
  }
  // Double-mapped table me APNA PAYEMENT holder FF-side nahi aana chahiye
  const doubleRows = [...r.querySelectorAll('table tbody tr')].map((tr) => tr.textContent || '');
  if (doubleRows.some((t) => /APNA\s*PAYEMENT/i.test(t) && /alag agent|FF me ek se zyada/i.test(t))) throw new Error('Apna Payment row double-mapped me count ho gaya');
}, true);
await run('professional page Master Stock (search + StockDataa ↔ Tag Assignment reconciliation)', async () => {
  const r = root(); await pages.masterStock.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Master Stock', 'StockDataa unique barcodes', 'Tag Assignment NOT in StockDataa', 'Matched in both', 'Owner mismatch', 'Top GV-only holder', 'Aged stock · 60+ din', 'ins-metric-tap', 'Barcode overlap']) {
    if (!html.includes(label)) throw new Error(`Master Stock me "${label}" nahi mila`);
  }
  // barcode prefix search — mock barcodes 34161FA82032… se shuru hote hain
  const r2 = root(); await pages.masterStock.render(r2, { q: '34161FA820' }, {});
  const html2 = r2.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!html2.includes('Search:')) throw new Error('Master Stock search section render nahi hui');
  if (!/tag · |tag matches/.test(html2)) throw new Error('barcode search results missing');
}, true);
await run('cross-channel KPI cards colorful + clickable (compare / charts / dispatch / TL)', async () => {
  const cmp = root(); await pages.compare.render(cmp, {}, {});
  const cmpHtml = cmp.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['ins-metric-tap', 'data-tone="g2"']) {
    if (!cmpHtml.includes(label)) throw new Error(`compare page me "${label}" nahi mila`);
  }
  const cx = root(); await pages.charts.render(cx, {}, {});
  const cxHtml = cx.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Combined total', 'ins-metric-tap']) {
    if (!cxHtml.includes(label)) throw new Error(`charts page me "${label}" nahi mila`);
  }
  const dp = root(); await pages.dispatchPlan.render(dp, {}, {});
  await settle(200);
  if (![...REG.values()].some((e) => String(e.innerHTML).includes('data-dp-kpi='))) throw new Error('dispatch planner KPI cards clickable nahi');
  const tl = root(); await pages.tlScorecard.render(tl, {}, {});
  if (!tl.innerHTML.includes('ins-metric-tap')) throw new Error('TL scorecard KPI cards clickable nahi');
}, true);
await run('wow zone · Agent Arena (levels, badges, challenges, crystal ball)', async () => {
  const r = root(); await pages.arena.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Agent Arena', 'Crystal Ball', 'Leaderboard', 'Badge gallery', 'Is month ke challenges', 'Tag Machine', 'Rookie', 'XP', 'ins-metric-tap']) {
    if (!html.includes(label)) throw new Error(`Agent Arena me "${label}" nahi mila`);
  }
}, true);
await run('wow zone · Wall of Fame (champions + winner cards)', async () => {
  const r = root(); await pages.fame.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Wall of Fame', 'Is month ke champions', 'First Forward', 'GV Partner', 'Winner card', 'fame-card-btn']) {
    if (!html.includes(label)) throw new Error(`Wall of Fame me "${label}" nahi mila`);
  }
}, true);
await run('wow zone · War Room live pulse', async () => {
  const r = root(); await pages.warRoom.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['WAR ROOM', 'AAJ KA TOTAL', 'war-counter', 'Live ticker', 'Fullscreen', 'war-race']) {
    if (!html.includes(label)) throw new Error(`War Room me "${label}" nahi mila`);
  }
}, true);await run('wow zone · Agent Arena (levels, badges, challenges, crystal ball)', async () => {
  const r = root(); await pages.arena.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Agent Arena', 'Crystal Ball', 'Leaderboard', 'Badge gallery', 'Is month ke challenges', 'Tag Machine', 'Rookie', 'XP', 'ins-metric-tap']) {
    if (!html.includes(label)) throw new Error(`Agent Arena me "${label}" nahi mila`);
  }
}, true);
await run('wow zone · Wall of Fame (champions + winner cards)', async () => {
  const r = root(); await pages.fame.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Wall of Fame', 'Is month ke champions', 'First Forward', 'GV Partner', 'Winner card', 'fame-card-btn']) {
    if (!html.includes(label)) throw new Error(`Wall of Fame me "${label}" nahi mila`);
  }
}, true);
await run('wow zone · War Room live pulse', async () => {
  const r = root(); await pages.warRoom.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['WAR ROOM', 'AAJ KA TOTAL', 'war-counter', 'Live ticker', 'Fullscreen', 'war-race']) {
    if (!html.includes(label)) throw new Error(`War Room me "${label}" nahi mila`);
  }
}, true);
await run('v3.11 · War Room detailed breakdown (VC4/VC20/VC5+ · chassis · replacement · wrong VRN · TL-wise)', async () => {
  const r = root(); await pages.warRoom.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Aaj ka detailed breakdown', 'VC4 tags', 'VC20 tags', 'VC5+ tags', 'Chassis', 'Wrong VRN', 'Replacement', 'Month-to-date detail', 'TL-wise aaj ka detail', 'war-kv', 'live-instant']) {
    if (!html.includes(label)) throw new Error(`War Room detail me "${label}" nahi mila`);
  }
}, true);
await run('v3.16 · Home GV aaj KPI cards (VC4/VC20/VC5+/Chassis/Replacement + Expected Today)', async () => {
  const r = root(); await pages.home.render(r, {}, {}); await settle(250);
  const html = [r.innerHTML, ...REG.values().map((e) => e.innerHTML), ...body.children.map((c) => c.innerHTML)].join('\n');
  for (const label of ['GV · Aaj ka live', 'Aaj Total', 'VC4', 'VC20', 'VC5+', 'Chassis', 'Replacement', 'Expected Today', 'home-morning-card']) {
    if (!html.includes(label)) throw new Error(`Home GV aaj section me "${label}" nahi mila`);
  }
  // spec attribute me & HTML-escape hota hai (&amp;) — browser dataset par wapas & ban jata hai
  if (!/data-kpi="src=gv&amp;scope=day&amp;date=\d{4}-\d{2}-\d{2}&amp;f=vc4"/.test(html)) throw new Error('VC4 card clickable data-kpi missing');
  if (!/data-kpi="src=gv&amp;scope=day&amp;date=\d{4}-\d{2}-\d{2}&amp;f=chassis"/.test(html)) throw new Error('Chassis card clickable data-kpi missing');
}, false);
await run('v3.16 · Hourly Sprints (countdown + TL/agent leaderboard + winners)', async () => {
  const r = root(); await pages.sprints.render(r, {}, {}); await settle(150);
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Hourly Sprints', 'SPRINT CHALU HAI', 'spr-cd', 'TL Sprint Leaderboard', 'Agent Sprint Leaderboard', 'Sprint winners', 'spr-full']) {
    if (!html.includes(label)) throw new Error(`Hourly Sprints me "${label}" nahi mila`);
  }
}, true);
await run('v3.16 · Stock Radar (bubbles + cover rings + suggested dono criteria)', async () => {
  const r = root(); await pages.stockRadar.render(r, { ch: 'ff' }, {}); await settle(150);
  let html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Stock Radar', 'radar-svg', 'radar-bub', 'Critical TLs', '🔴 <7 din', 'w/o stock']) {
    if (!html.includes(label)) throw new Error(`Stock Radar (FF) me "${label}" nahi mila`);
  }
  const r2 = root(); await pages.stockRadar.render(r2, { ch: 'gv' }, {}); await settle(150);
  html = r2.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!html.includes('radar-svg') && !html.includes('Is channel ka TL stock data')) throw new Error('Stock Radar (GV) render nahi hua');
}, true);
await run('v3.16 · Good Morning card (yesterday + MTD + expected calculations)', async () => {
  if (!FF.morningCard) throw new Error('FF.morningCard missing');
  const y = FF.morningCard.yesterdayStats();
  if (!Number.isFinite(y.yestTotal) || y.yestTotal < 0) throw new Error('yesterday total invalid');
  const m = FF.morningCard.mtdStats();
  if (!Number.isFinite(m.total) || m.daysElapsed < 1) throw new Error('mtd stats invalid');
  const e = FF.morningCard.expectedToday();
  if (e !== null && (!Number.isFinite(e) || e < 0)) throw new Error('expectedToday invalid');
  log(`      yesterday ${y.yestTotal} · MTD ${m.total} · expected ${e}`);
}, false);
await run('v3.16.1 · Office Bell + Voice Announcer (agent-wise query + announce text)', async () => {
  if (!FF.officeBell || typeof FF.officeBell.mount !== 'function') throw new Error('FF.officeBell.mount missing');
  const e = FF.config.eir;
  const today = FF.util.dateKey(new Date());
  const t = await FF.data.query(e.sheet, `select ${e.agentName}, count(${e.tagId}) where ${e.date} = date '${today}' group by ${e.agentName}`, { timeoutMs: 20000, fresh: true });
  // FF EIR T+1 hai — aaj ki FF rows kal aati hain (asli sheet jaisa mock); tab query khaali hona sahi hai
  if ((!t || !t.rows || !t.rows.length) && !(FF.filters && FF.filters.ffLagOn && FF.filters.ffLagOn())) throw new Error('agent-wise live query returned no rows');
  const single = FF.officeBell.announceText([{ ch: 'FF', agent: 'Rahul Sharma', n: 5 }], 5);
  if (!/Rahul/.test(single) || !/5/.test(single)) throw new Error('single-agent announce text galat: ' + single);
  const multi = FF.officeBell.announceText([{ ch: 'FF', agent: 'Rahul', n: 5 }, { ch: 'GV', agent: 'Priya', n: 3 }, { ch: 'FF', agent: 'Amit', n: 2 }], 10);
  if (!/Rahul/.test(multi) || !/Priya/.test(multi)) throw new Error('multi-agent announce text galat: ' + multi);
  const blast = FF.officeBell.announceText([], 55);
  if (!/55/.test(blast)) throw new Error('blast announce text galat: ' + blast);
  // 🔊 v3.18 — voice unlock + prefs + log (DOM shim me speechSynthesis nahi hai, isliye
  // sirf API surface + prefs round-trip verify karte hain; real browser path voice-unlock.test.js me hai)
  for (const fn of ['unlock', 'speakAnnounce', 'queueAnnounce', 'flushPending', 'prefs', 'setPrefs', 'logList']) {
    if (typeof FF.officeBell[fn] !== 'function') throw new Error(`FF.officeBell.${fn} missing`);
  }
  FF.officeBell.setPrefs({ minTags: 5, gv: false });
  if (FF.officeBell.prefs().minTags !== 5 || FF.officeBell.prefs().gv !== false) throw new Error('bell prefs save nahi hue');
  FF.officeBell.setPrefs({ minTags: 1, gv: true });
  FF.officeBell.logAdd({ at: Date.now(), ff: 2, gv: 1, total: 3, who: 'smoke (3)' });
  if (!FF.officeBell.logList().length) throw new Error('bell announcement log khali hai');
  log(`      agent-wise rows ${t.rows.length} · "${single}"`);
}, false);
await run('v3.11 · Activity Calendar (heatmap + streak + sparkline board)', async () => {
  const r = root(); await pages.activity.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Activity Calendar', 'heat-cols', 'heat-cell', 'heat-legend', 'Current streak', 'Longest streak', 'Sparkline board', 'Month-wise activity', 'Weekday pattern']) {
    if (!html.includes(label)) throw new Error(`Activity Calendar me "${label}" nahi mila`);
  }
}, true);
await run('v3.11 · Team Network (TL-agent constellation + hover tips)', async () => {
  const r = root(); await pages.network.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Team Network', 'net-wrap', 'data-net-tl', 'net-link', 'net-legend', 'net-orbit']) {
    if (!html.includes(label)) throw new Error(`Team Network me "${label}" nahi mila`);
  }
}, true);
await run('v3.11 · Anomaly Radar (rule engine + severity cards)', async () => {
  const findings = await FF.wowzone.anomalyFindings();
  if (!Array.isArray(findings)) throw new Error('anomalyFindings array nahi hai');
  const r = root(); await pages.radar.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/Anomaly Radar/.test(html)) throw new Error('radar page head missing');
  if (!/radar-card|Koi anomaly nahi mili/.test(html)) throw new Error('radar cards / empty state missing');
  log(`      ${findings.length} signals: ${findings.map((f) => f.id).join(', ') || 'none'}`);
}, true);
await run('v3.11 · Agent Report Cards (grades + auto remarks + sign block)', async () => {
  const list = pages.performance.agents();
  const name = (list[0] || {}).name;
  if (!name) throw new Error('koi agent nahi mila');
  const r = root(); await pages.reportCards.render(r, { q: name }, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Agent Report Card', 'rc-grade', 'Teacher remarks', 'TL sign', 'Issuance volume', 'VC4 share', 'Growth vs last month']) {
    if (!html.includes(label)) throw new Error(`Report Card me "${label}" nahi mila`);
  }
}, true);
await run('v3.11 · Master search (naam / TL / ID index + suggestions + results markup)', async () => {
  const list = pages.performance.agents();
  const probe = (list[0] || {}).name || '';
  if (!probe) throw new Error('probe agent nahi mila');
  await FF.masterSearch.buildLight();
  const res = FF.masterSearch.search(probe.slice(0, 5));
  if (!res.people.length) throw new Error(`"${probe.slice(0, 5)}" se koi person nahi mila`);
  const items = FF.masterSearch.suggestItems(probe.slice(0, 5));
  if (!items.length || !items[0].label) throw new Error('suggestions nahi bane');
  const html = FF.masterSearch.resultsHtml(res);
  if (!/ms-section|ms-kundli/.test(html)) throw new Error('results markup missing');
  await FF.masterSearch.buildFull();
  log(`      light match ${res.people.length} people · suggestions ${items.length} · heavy ready ${FF.masterSearch.heavyReady}`);
  // 🧾 v3.13 rich profile — real mock data se agent + TL + direct agent
  await FF.masterProfile.load();
  const person = FF.masterSearch.search(probe).people.find((p) => p.kind === 'ff-agent');
  const pr = await FF.masterProfile.build(person);
  const ph = FF.masterProfile.html(pr);
  // v3.44 — summary ab VC4 · VC20 · VC5+ teen alag rows (pehle VC4 + Commercial ka ek total tha)
  for (const label of ['mp-kpis', 'Issuance class-wise', 'Suggested', 'mp-charts']) if (!ph.includes(label)) throw new Error(`profile me \"${label}\" nahi mila`);
  // v3.44 — summary ab VC4 · VC20 · VC5+ teen alag rows (class data na ho to placeholder wahi 3 naam batata hai)
  if (!ph.includes('mp-group-tbl') && !ph.includes('Class-group (VC4 · VC20 · VC5+)')) throw new Error('profile me VC4 · VC20 · VC5+ summary nahi mili');
  for (const group of ['VC4', 'VC20', 'VC5+']) if (!ph.includes(group)) throw new Error(`profile me \"${group}\" group row nahi mila`);
  const tlName = (list.find((a) => !a.tlExcluded && a.tlName) || {}).tlName;
  if (tlName) {
    const tl = await FF.masterProfile.build({ kind: 'ff-tl', name: tlName, sub: '', tlSet: new Set(), classMap: new Map(), bars: new Set() });
    if (!tl.agentCount || !/TL ke agents/.test(FF.masterProfile.html(tl))) throw new Error('TL profile me agents table nahi');
    // v3.41 — agents table (stock · last · this month) + Agent × Class matrix + Search Report (⚖ FF + GV)
    const tlHtml = FF.masterProfile.html(tl);
    for (const label of ['mp-agents-tbl', 'data-mp-go=\"agents\"', 'scope=month', 'scope=mtd']) if (!tlHtml.includes(label)) throw new Error(`TL profile me \"${label}\" nahi mila`);
    const cmb = FF.searchReport.combinedHtml({ name: tlName }, { ff: tl, gv: null });
    for (const label of ['Last month', 'Current month', 'Stock in hand', 'Class-wise', 'data-sr-open=\"ff\"']) if (!cmb.includes(label)) throw new Error(`Search Report combined me \"${label}\" nahi mila`);
  }  const dr = list.find((a) => a.tlExcluded);
  if (dr) {
    const dp = await FF.masterProfile.build({ kind: 'ff-agent', name: dr.name, sub: dr.agentId || '', tlSet: new Set(), classMap: new Map(), bars: new Set() });
    if (!dp.direct) throw new Error('direct agent profile me direct flag nahi');
    if (/High|Medium/.test(dp.priority) && !dp.tagRequired) throw new Error('direct High/Medium par tagRequired nahi');
  }
  log(`      profile ${pr.name} · stock ${pr.stock.total} · class rows ${pr.classes.length} · html ${ph.length} chars`);
}, true);
await run('v3.45 · Agent/TL Summary v2 (FF + GV) — colourful KPI + sources + tag drill', async () => {
  const list = pages.performance.agents();
  const probe = (list.find((a) => !a.tlExcluded && a.tlName) || list[0] || {}).name || '';
  if (!probe) throw new Error('probe agent nahi mila');
  const r = root();
  await FF.pages.ffAgentSummary.render(r, { q: probe }, {});
  await settle(500);
  let html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Agent / TL Summary', 'gs-search', 'gs-kpi', 'data-gs-kpi', 'Issuance ·', 'Stock in hand', 'Ye numbers kahan se aaye', 'Class-wise', 'gs-hero']) {
    if (!html.includes(label)) throw new Error(`FF Summary page me "${label}" nahi mila`);
  }
  if (!/data-gs-kpi="stock"/.test(html)) throw new Error('FF Summary ke KPI cards clickable nahi');
  const r2 = root();
  await FF.pages.gvAgentSummary.render(r2, {}, {});
  await settle(600);
  html = r2.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['gs-kpi', 'Issuance ·', 'Last month', 'Stock in hand', 'GV Master', 'GV REPORT', 'Tag Assignment', 'Data check']) {
    if (!html.includes(label)) throw new Error(`GV Summary page me "${label}" nahi mila`);
  }
  // ledger-final truth: GV Master ki tag rows se number + sheet cross-check + tag-level drill
  const people = FF.gvTruth.people();
  if (!people.length) throw new Error('gvTruth.people() khali hai');
  const who = people.find((p) => p.kind === 'gv-agent' && p.cur > 0) || people[0];
  const truth = FF.gvTruth.person({ kind: who.kind, name: who.name, id: who.id });
  if (!truth.ledger.cur.total && !truth.ledger.last.total) throw new Error('GV truth me ledger numbers 0 hain');
  if (!truth.checks.length) throw new Error('GV truth me sheet-vs-ledger checks nahi');
  const d = await FF.gvTruth.drill({ kind: who.kind, name: who.name, id: who.id, scope: 'cur', truth });
  if (!d.rows.length) throw new Error('tag-level drill rows khali hain');
  for (const col of ['VRN / BARCODE', 'TAG_ID', 'SERIAL']) if (!d.columns.includes(col)) throw new Error(`drill me "${col}" column nahi`);
  const w = FF.gvTruth.health();
  if (!w.loaded.ledger) throw new Error('GV Master rows load nahi hui');
  log(`      GV truth: ${who.name} · ${truth.ledger.cur.total} MTD · ${truth.ledger.last.total} last · ${truth.stock.total} stock · drill ${d.rows.length} rows`);
}, true);
await run('🧑‍💼 v3.46 · Agent/TL Summary — GV TL search: last · current · today + stock (fast open)', async () => {
  const tls = FF.gvTruth.people().filter((p) => p.kind === 'gv-tl' && (p.cur + p.stock) > 0);
  const tl = tls[0];
  if (!tl) throw new Error('GV TL nahi mila');
  const t0 = Date.now();
  const r = root();
  await FF.pages.gvAgentSummary.render(r, { name: tl.name }, {});
  const firstPaint = Date.now() - t0;
  await settle(400);
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Last month', 'Today issued', 'Stock in hand', 'Issuance ·']) {
    if (!html.includes(label)) throw new Error(`GV TL summary me "${label}" nahi mila`);
  }
  if (!html.includes(tl.name)) throw new Error('GV TL summary me TL ka naam nahi mila (search nahi laga)');
  if (firstPaint > 6000) throw new Error(`GV TL summary slow khula (${firstPaint}ms)`);
  log(`      GV TL summary "${tl.name}" first paint ${firstPaint}ms · mtd ${tl.cur} · stock ${tl.stock}`);
}, true);
await run('T-1 basis · growth % + suggested dispatch (master search + performance drawer)', async () => {
  const list = pages.performance.agents();
  const basis = FF.util.reportBasis();
  if (!(basis.days > 0) || !basis.label) throw new Error('report basis nahi bana');
  // 1) Master search drawer: TL growth % + "till <date>" + T-1 projection
  const tlName = (list.find((a) => !a.tlExcluded && a.tlName) || {}).tlName;
  if (tlName) {
    const tl = await FF.masterProfile.build({ kind: 'ff-tl', name: tlName, sub: '', tlSet: new Set(), classMap: new Map(), bars: new Set() });
    if (tl.growthNum === null || tl.growthNum === undefined) throw new Error('TL growth % missing in master search drawer');
    if (!tl.projT1 || !tl.projT1.basis || tl.projT1.days !== basis.days) throw new Error('TL T-1 projection basis mismatch');
    const th = FF.masterProfile.html(tl);
    for (const label of ['Growth % &amp; month-end expected', 'Expected month-end', 'Data till', 'Aage kitne din bache', 'aaj ka data kal aata hai', 'pct pos', 'pct neg']) {
      if (!th.includes(label)) throw new Error(`TL profile drawer me "${label}" nahi mila`);
    }
    // Quick (kundli) snapshot me bhi growth dikhna chahiye
    const quick = FF.masterProfile.quick({ kind: 'ff-tl', name: tlName, sub: '' });
    if (!quick || quick.projT1 === undefined) throw new Error('kundli snapshot me growth/projection missing');
  }
  // 2) Performance drawers: agent + TL dono me suggested dispatch, T-1 divisor
  const ag = list.find((a) => !a.tlExcluded) || list[0];
  pages.performance.openAgent(ag.__row);
  let dh = (REG.get('drawer-body') || {}).innerHTML || '';
  for (const label of ['Suggested dispatch quantity', 'aaj ka data kal aata hai', 'Expected month-end', 'Run-rate VC4 / Comm']) {
    if (!dh.includes(label)) throw new Error(`agent drawer me "${label}" nahi mila`);
  }
  if (/undefined|NaN/.test(dh)) throw new Error('agent drawer me undefined/NaN');
  const tlg = list.find((a) => !a.tlExcluded && a.tlName);
  if (tlg) {
    pages.performance.openTl(tlg.tlName);
    dh = (REG.get('drawer-body') || {}).innerHTML || '';
    for (const label of ['Suggested dispatch quantity · TL level', 'Agents ka jod', 'Expected month-end', 'aaj ka data kal aata hai']) {
      if (!dh.includes(label)) throw new Error(`TL drawer me "${label}" nahi mila`);
    }
    if (/undefined|NaN/.test(dh)) throw new Error('TL drawer me undefined/NaN');
  }
  log(`      report day ${basis.label} (${basis.days} din${basis.fromReport ? ' · sheet header' : ' · fallback'})`);
}, true);
await run('v3.20 · expected-this-month (trend) + dispatch-ready + de-growth + cover forecast', async () => {
  // 1) Trend · Expected this month — dono channels, class-wise + bina replacement
  const rr = root();
  await pages.trend.render(rr, { mode: 'expected' }, {});
  let h = rr.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Expected this month', 'Expected month-end', 'Aage aur kitna', 'VC20', 'VC5+', 'All Commercial', 'bina replacement', 'Replacement', 'Run-rate / day']) {
    if (!h.includes(label)) throw new Error(`Trend expected me "${label}" nahi mila`);
  }
  if (!/First Forward/.test(h) || !/GV Partner/.test(h)) throw new Error('expected view me dono channels nahi dikhe');
  if (!/aaj ka data kal aata hai/.test(h)) throw new Error('FF data-basis ka explanation missing');
  if (!/Live data/.test(h)) throw new Error('GV live basis ka explanation missing');
  const ffOnly = root();
  await pages.trend.render(ffOnly, { mode: 'expected', ch: 'ff' }, {});
  h = ffOnly.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/First Forward/.test(h) || /GV Partner · expected/.test(h)) throw new Error('FF-only filter kaam nahi kar raha');
  // 2) Performance TL drawer — dispatch ready + cover/stock-out + growth breakdown
  const list = pages.performance.agents();
  const tlg = list.find((a) => !a.tlExcluded && a.tlName);
  pages.performance.openTl(tlg.tlName);
  h = (REG.get('drawer-body') || {}).innerHTML || '';
  for (const label of ['Dispatch ready', 'Stock khatam', 'agents ko chahiye', 'Turant bhejo', 'data-pf-share-wa', 'data-pf-share-csv', 'Growth kahan se aa raha hai', 'Expected month-end', 'Calculated', 'Share']) {
    if (!h.includes(label)) throw new Error(`TL drawer me "${label}" nahi mila`);
  }
  if (/undefined|NaN/.test(h)) throw new Error('TL drawer me undefined/NaN');
  // 3) Alerts view me TL de-growth list
  const ar = root();
  await pages.performance.render(ar, { view: 'alerts' }, {});
  h = ar.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!h.includes('De-growth TLs')) throw new Error('TL de-growth list nahi mili');
  if (/undefined|NaN/.test(h)) throw new Error('alerts view me undefined/NaN');
  // 4) UI me "T-1" jaisa technical shabd nahi rehna chahiye
  const all = [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (/\bT-1\b/.test(all)) throw new Error('UI me "T-1" shabd aa gaya');
  log('      expected + dispatch-ready + de-growth ok');
}, true);
await run('v3.20 · site-wide language: English + Hindi poori site par', async () => {
  if (!FF.i18n) throw new Error('FF.i18n load nahi hua');
  if (FF.i18n.size() < 500) throw new Error(`dictionary bahut chhoti: ${FF.i18n.size()}`);
  // Har shabd jo UI par dikhta hai, teeno bhasha me check hona chahiye.
  const MUST = [
    'Performance', 'Trend', 'Stock', 'Total', 'Stock Report', 'Data Quality Center', 'Dispatch Planner',
    'Expected month-end', 'Dispatch ready', 'Stock khatam', 'Turant bhejo', 'Growth kahan se aa raha hai',
    'De-growth TLs', 'Data till', 'aaj ka data kal aata hai', 'Suggested dispatch quantity', 'Total tags',
    'Run-rate', 'Cover', 'Monthly', 'Last vs Current', 'Class', 'Agent', 'Direct agents', 'Search', 'Refresh'
  ];
  for (const w of MUST) {
    if (FF.i18n.t(w, 'hinglish') !== w) throw new Error(`"${w}" Hinglish source me badal gaya`);
    if (!FF.i18n.has(w, 'en')) throw new Error(`"${w}" English me translate nahi hota`);
    if (!FF.i18n.has(w, 'hi')) throw new Error(`"${w}" Hindi me translate nahi hota`);
    const hi = FF.i18n.t(w, 'hi');
    if (!/[\u0900-\u097F]/.test(hi) && !/^(VC4|VC20|VC5\+|TL|FF|GV|REPORT|Total|Performance|Trend|Stock|Class|Agent|Search|Refresh)$/.test(w)) {
      throw new Error(`"${w}" ka Hindi Devanagari me nahi mila: ${hi}`);
    }
  }
  // Mutein numbers / company ke naam nahi badalne chahiye
  for (const keep of ['VC4', '2026-09-29', 'AJAY SINGH', 'TO2 Corporation', 'ApnaPayment Pvt. Ltd.']) {
    if (FF.i18n.t(keep, 'en') !== keep || FF.i18n.t(keep, 'hi') !== keep) throw new Error(`"${keep}" galat translate hua`);
  }
  // Hinglish = default
  if (FF.i18n.current() !== 'hinglish') throw new Error('default language Hinglish hona chahiye');
  // Mहीने ke नाम bhi bhasha ke hisaab se
  localStorage.setItem('ff_lang', 'hi');
  if (!/[\u0900-\u097F]/.test(FF.util.labelYM('2026-09', true))) throw new Error('labelYM Hindi me month nahi dikha');
  localStorage.setItem('ff_lang', 'hinglish');
  if (!/September/.test(FF.util.labelYM('2026-09', true))) throw new Error('labelYM Hinglish me English month hona chahiye');
  log(`      ${MUST.length} core words × 3 languages · ${FF.i18n.size()} dictionary entries`);
}, true);
await run('v3.14 · New Agents & TL Changes page (FF + GV, dono table)', async () => {
  const r = root(); await pages.newAgents.render(r, { months: '6' }, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['New Agents &amp; TL Changes', 'Naye agents', 'TL changes', 'metric-grid']) if (!html.includes(label)) throw new Error(`New Agents page me "${label}" nahi mila`);
  if (/undefined|NaN/.test(html)) throw new Error('New Agents page me undefined/NaN');
  const c = await FF.newAgents.collect(6);
  log(`      FF rows ${c.ff ? c.ff.rows.length : 0} (new ${c.ff ? c.ff.rows.filter((x) => x.isNew).length : 0}, TL events ${c.ff ? c.ff.rows.filter((x) => x.ev).length : 0}) · GV rows ${c.gv ? c.gv.rows.length : 0} (new ${c.gv ? c.gv.rows.filter((x) => x.isNew).length : 0}, TL events ${c.gv ? c.gv.rows.filter((x) => x.ev).length : 0})`);
}, true);
await run('v3.12 · Direct Agents rule (FF: TL Name APS · GV: TL ID + Name blank) — page + dono dispatch filters', async () => {
  // classifier contract (channel-specific)
  if (FF.config.isDirectAgent({ tlName: 'APS' }, 'ff') !== true) throw new Error('FF: TL Name APS → direct nahi bana');
  if (FF.config.isDirectAgent({ tlName: 'AJAY SINGH M', tlId: 'APN2354' }, 'ff') !== false) throw new Error('FF: TL-managed agent direct ban gaya');
  if (FF.config.isDirectAgent({ agentName: 'X', agentId: '5846001' }, 'gv') !== true) throw new Error('GV: TL ID + TL Name blank → direct nahi bana');
  if (FF.config.isDirectAgent({ agentName: 'X', tlId: 'APN2354' }, 'gv') !== false) throw new Error('GV: TL id present row direct ban gaya');
  if (FF.config.directLabel({}, 'gv') !== 'Direct Agent (no TL)') throw new Error('GV label galat');
  // GV data me direct agents milte hain + rollup TL list se alag hai
  const report = FF.gv.get('report') || [];
  const gvDirect = report.filter((r) => FF.config.isDirectAgent(r, 'gv'));
  if (!gvDirect.length) throw new Error('mock GV REPORT me koi no-TL direct agent nahi mila');
  const tlRoll = (FF.gv.tlRollup() || []).map((t) => t.tlName);
  if (tlRoll.some((n) => /^(APS|Direct|Unassigned|)$/i.test(n || ''))) throw new Error('TL rollup me direct/placeholder TL leak');
  // FF performance data me direct agents (APS) + TL dropdown me option
  const list = pages.performance.agents();
  if (!list.some((a) => a.tlExcluded)) throw new Error('FF REPORT me APS direct agents nahi mile');
  const r1 = root(); await pages.performance.render(r1, { view: 'alerts' }, {});
  let html = r1.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/Direct Agents · all/.test(html)) throw new Error('FF dispatch bar me Direct Agents filter nahi');
  // GV Stock Report dispatch + TL filter
  const r2 = root(); await pages.gvStockReport.render(r2, { view: 'dispatch' }, {});
  html = r2.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/Other Direct Agents/.test(html) || !/Tag required/.test(html)) throw new Error('GV dispatch me Direct Agents alag list / tag-required option nahi');
  if (!/Direct Agent \(no TL\)|no TL/.test(html)) throw new Error('GV direct reason label nahi');
  if (!/direct-rule-banner/.test(html)) throw new Error('GV Stock Report par direct rule banner nahi');
  const r3 = root(); await pages.gvStockReport.render(r3, { view: 'agents', tl: '__direct__' }, {});
  html = r3.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/Direct Agents · no TL/.test(html)) throw new Error('GV Stock Report TL dropdown me direct option nahi');
  // dedicated page
  const r4 = root(); await pages.directAgents.render(r4, {}, {});
  html = r4.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Direct Agents', 'direct-rule-card', 'GV Partner', 'First Forward', 'TL Name', 'no TL', 'direct-row']) {
    if (!html.includes(label)) throw new Error(`Direct Agents page me \"${label}\" nahi mila`);
  }
  // settings tab
  const roster = await FF.direct.roster();
  if (!roster.length) throw new Error('direct roster khali hai');
  log(`      GV direct ${gvDirect.length} · FF direct ${list.filter((a) => a.tlExcluded).length} · roster ${roster.length} · tls ${tlRoll.length}`);
}, true);
await run('v3.11 · Executive combined stock — GV-parked rows NAAM/TL se bhi exclude', async () => {
  const stockAgents = FF.store.get('stockAgents') || [];
  const gvId = String(FF.config.eir.gvMasterId || '5845036');
  const isGv = (r) => String(r.agentId || '').trim() === gvId || /^apna\s*pay/i.test(String(r.agentName || '')) || /^apnapayment pvt\.? ltd\.?$/i.test(String(r.tlName || ''));
  const gvHeld = stockAgents.filter(isGv).reduce((n, x) => n + (x.n || 0), 0);
  const ffClean = stockAgents.filter((r) => !isGv(r)).reduce((n, x) => n + (x.n || 0), 0);
  if (!(gvHeld > 0)) throw new Error('mock me GV-parked rows hi nahi');
  const r = root(); await pages.executive.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  const gvStock = (FF.gv.get('stockClass') || []).reduce((n, x) => n + (x.n || 0), 0);
  const combined = FF.util.fmt(ffClean + gvStock);
  if (!html.includes(`<b>${combined}</b>`)) throw new Error(`combined field stock ${combined} nahi mila (name/TL based exclusion?)`);
  if (!/GV-parked/.test(html)) throw new Error('exclusion ka naya label nahi dikha');
}, true);
await run('professional page FASTag Champions (vivid KPI + clickable full-data drill-down)', async () => {
  const r = root(); await pages.fastagChampions.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['FASTag Champions', 'ins-metric', 'data-tone', 'ins-metric-tap', 'FF issuance (month)', 'GV issuance (month)', 'Chassis tags', 'Replacement tags', 'Wrong VRN tags', 'Champion boards', 'fastag-export-csv', 'cert-winners']) {
    if (!html.includes(label)) throw new Error(`FASTag Champions me "${label}" nahi mila`);
  }
  if (!/data-tone="g[0-9]+"/.test(html)) throw new Error('KPI cards par data-tone gradient missing');
  // month filter + search par bhi render hona chahiye
  const r2 = root(); await pages.fastagChampions.render(r2, { scope: 'ff', top: '5' }, {});
  if (!/Top Agents/.test(r2.innerHTML)) throw new Error('scope=ff board render nahi hua');
}, true);
await run('professional page stock forecast', async () => {
  const r = root(); await pages.forecast.render(r, { growth: '20', safety: '7' }, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Urgent dispatch list', 'Channel summary', 'TL-wise replenishment rollup', 'Agent-level requirement forecast', '7-day replenishment need', 'Stock-out within 7 days', 'forecast-urgent-csv']) {
    if (!html.includes(label)) throw new Error(`stock forecast me "${label}" nahi mila`);
  }
  const pageRisks = (html.match(/class="risk-chip (critical|high|medium|covered|norate)"/g) || []).length;
  if (pageRisks !== 5) throw new Error(`risk strip ke 5 chips expected, mile ${pageRisks}`);
}, true);
await run('professional page forecast accuracy backtest', async () => {
  const accuracy = await FF.insights.forecastAccuracy(28), sample = accuracy.horizons[7].combined;
  if (!sample || !sample.agents || sample.predicted <= 0 || sample.actual <= 0) throw new Error('backtest sample coverage/predicted/actual is empty');
  for (const horizon of [7, 15, 30]) if (!accuracy.horizons[horizon].combined || !accuracy.horizons[horizon].combined.agents) throw new Error(`${horizon}-day backtest coverage is empty`);
  for (const key of ['accuracy', 'wape', 'bias', 'absoluteError', 'mae']) if (!Number.isFinite(sample[key])) throw new Error(`${key} metric is not finite`);
  if (accuracy.horizons[7].combinedWindows.length < 2) throw new Error('rolling accuracy trend needs multiple completed windows');
  if (!sample.sources.some((s) => s.channel === 'First Forward') || !sample.sources.some((s) => s.channel === 'GV Partner')) throw new Error('both channel backtests are not covered');
  const r = root(); await pages.forecast.render(r, { view: 'accuracy', horizon: '7', lookback: '28', channel: 'all' }, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const s of ['Forecast Accuracy', 'Forecast accuracy', 'WAPE', 'Predicted consumption', 'Actual consumption', 'Forecast bias', 'Agent-wise predicted vs actual consumption', 'Methodology']) if (!html.includes(s)) throw new Error(`forecast accuracy me "${s}" nahi mila`);
  if (!/\d+\.\d%/.test(html)) throw new Error('forecast accuracy metric missing');
  if (/0 exact daily agent groups/.test(html) || /0 issuance rows/.test(html)) throw new Error('forecast history coverage is zero');
}, true);
await run('stock-history API exposes FF + GV closing snapshots', async () => {
  const out = await FF.auth.api('/api/stock-history'), latest = (out.points || []).at(-1);
  if (!latest || !latest.ff || !latest.gv) throw new Error('channel-wise FF/GV stock snapshot missing');
  if (!(latest.ff.total > 0) || !(latest.gv.total > 0) || !(latest.combined.total > 0)) throw new Error('stock snapshot totals are empty');
  if (!out.mtd || !Number.isFinite(Number(out.mtd.ff)) || !Number.isFinite(Number(out.mtd.gv))) throw new Error('channel MTD issuance missing');
  if (!Array.isArray(out.issuance)) throw new Error('date-wise issuance reconciliation series missing');
});
await run('professional page stock-balance reconciliation', async () => {
  const originalApi = FF.auth.api, originalEnabled = FF.config.stockMovement && FF.config.stockMovement.enabled;
  const latest = FF.model.latestDate(await FF.store.need('daily')) || new Date();
  const key = (offset) => { const d = new Date(latest); d.setDate(d.getDate() + offset); return FF.util.dateKey(d); };
  FF.config.stockMovement.enabled = true;
  FF.auth.api = async (path, ...args) => path === '/api/stock-history' ? { points: [
    { date: key(-7), ff: { total: 4510, vc4: 3400, comm: 1110 }, gv: { total: 2200, vc4: 1700, comm: 500 } },
    { date: key(0), ff: { total: 4488, vc4: 3380, comm: 1108 }, gv: { total: 2185, vc4: 1688, comm: 497 } }
  ] } : originalApi(path, ...args);
  try {
    const r = root(); await pages.forecast.render(r, { view: 'balance', horizon: '7', lookback: '28', channel: 'all' }, {});
    const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
    for (const s of ['Stock Balance Reconciliation', 'Movement ledger connected', 'Closing-stock accuracy', 'Projected closing', 'Observed actual closing', 'Unexplained variance', 'Channel reconciliation detail', 'Balance methodology']) if (!html.includes(s)) throw new Error(`stock balance me "${s}" nahi mila`);
    if (!html.includes('First Forward') || !html.includes('GV Partner')) throw new Error('both stock-balance channels missing');
  } finally { FF.auth.api = originalApi; FF.config.stockMovement.enabled = originalEnabled; }
}, true);
await run('cockpit · payout reconciliation (sheet vs rate×tags vs slab)', async () => {
  const d = await FF.cockpit.payoutRecon();
  if (!d.rows.length) throw new Error('payout rows khali hain');
  const withFigure = d.rows.filter((r) => r.recommended !== null);
  if (!withFigure.length) throw new Error('kisi bhi agent ka payout figure nahi bana');
  if (!d.rows.some((r) => r.source === 'REPORT earned')) throw new Error('sheet earned source detect nahi hua');
  if (!d.rows.some((r) => r.source === 'Rate × tags')) throw new Error('rate × tags fallback use nahi hua');
  if (!d.rows.some((r) => (r.flags || []).includes('Rate missing'))) throw new Error('missing-rate flag nahi mila');
  if (!(d.totals.ffAmount > 0)) throw new Error('payout total 0 hai');
  if (!d.gvRows.length || !(d.totals.gvAmount > 0)) throw new Error('GV payout sheet khali hai');
  const r = root(); await pages.ffCommission.render(r, {}, {});
  await settle(250);
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Payout reconciliation', 'Payout to process', 'ffp-payout-csv', 'ffp-payout-xlsx', 'ffp-payout-copy', 'Rate × tags (verified)', 'Slab expected']) {
    if (!html.includes(label)) throw new Error(`payout card me "${label}" nahi mila`);
  }
}, false);

await run('cockpit · commission alerts rule engine', async () => {
  const list = await FF.cockpit.commissionAlerts();
  if (!Array.isArray(list) || !list.length) throw new Error('koi alert nahi mila');
  const ids = list.map((a) => a.id);
  for (const id of ['rate-missing', 'rate-outlier']) if (!ids.includes(id)) throw new Error(`${id} alert nahi bana`);
  const first = list[0];
  if (!first.title || !first.detail || !first.count) throw new Error('alert shape adhoora hai');
  if (!first.samples.length) throw new Error('alert samples khali hain');
  if (!['critical', 'high', 'medium', 'info'].includes(first.severity)) throw new Error(`severity galat: ${first.severity}`);
  const r = root(); await pages.ffCommission.render(r, {}, {});
  await settle(250);
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Commission alerts', 'alert-row sev-', 'ffa-alerts-csv', 'ffa-alerts-wa', 'data-alert-samples']) {
    if (!html.includes(label)) throw new Error(`alerts card me "${label}" nahi mila`);
  }
  // ghata hua mapping → source alert
  const cfg = FF.config.ffCommission; const before = { ...cfg };
  try {
    cfg.rateCol = 'aisi heading nahi'; cfg.earnedCol = '';
    FF.data.clearCache();
    const again = await FF.cockpit.commissionAlerts();
    if (!again.some((a) => a.id === 'rate-missing')) throw new Error('mapping tootne par alert nahi aaya');
  } finally { Object.assign(cfg, before); FF.data.clearCache(); }
}, false);

await run('cockpit · Agent 360 drawer (FF + GV + risk + quality + notes)', async () => {
  await FF.pages.performance.ensureLoaded();
  const agent = FF.pages.performance.agents().find((a) => Number(a.curTotal || 0) > 0);
  const res = await FF.cockpit.agent360({ name: agent.name, id: agent.agentId || agent.id });
  if (!res || res.displayName !== agent.name) throw new Error('agent 360 resolve nahi hua');
  if (!Array.isArray(res.rows) || res.rows.length < 10) throw new Error('agent CSV rows kam hain');
  const body = (REG.get('drawer-body') && REG.get('drawer-body').innerHTML) || '';
  for (const label of ['FF tags · MTD', 'GV tags', 'Commission', 'Stock risk', 'Issuance trend', 'Class split', 'Data quality', 'Cross-channel', 'Notes &amp; follow-ups']) {
    if (!body.includes(label)) throw new Error(`Agent 360 me "${label}" section nahi mila`);
  }
  if (!(body.match(/class="dkpi"/g) || []).length) throw new Error('Agent 360 KPI cards nahi bane');
  const ff = root(); await pages.ffCommission.render(ff, {}, {});
  await settle(250);
  const html = ff.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/data-agent360="/.test(html)) throw new Error('FF commission page par Agent 360 links nahi hain');
  const gv = root(); await pages.gvCommission.render(gv, {}, {});
  await settle(200);
  const gvHtml = gv.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/data-agent360="/.test(gvHtml)) throw new Error('GV commission page par Agent 360 links nahi hain');
}, false);

await run('professional page dispatch planner (boxes + pick-list)', async () => {
  const data = await FF.cockpit.dispatchPlan({ horizon: 7 });
  if (!data.rows.length) throw new Error('dispatch rows khali hain');
  const first = data.rows[0];
  if (!(first.boxes >= 1) || !(first.dispatchTags >= first.need)) throw new Error('box math galat hai');
  if (first.dispatchTags !== first.boxes * 25) throw new Error('dispatch tags = boxes × box-size nahi hai');
  if (!data.rows.every((r) => r.priority >= 1)) throw new Error('priority rank missing');
  // 🚚 Dispatch Planner v2 (dispatchPlanner.js): GV + FF, filters, sortable columns, run-rate formula, clickable rows
  const r = root(); const info = await pages.dispatchPlan.render(r, {}, {});
  await settle(300);
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Dispatch Planner', 'dp2-hero', 'Run-rate', 'dp2-formula', 'dp2-csv', 'dp2-xlsx', 'dp2-wa', 'dp2-tabs', 'dp2-chips', 'dp2-kpis']) {
    if (!html.includes(label)) throw new Error(`dispatch planner v2 me "${label}" nahi mila`);
  }
  if (!info || !info.agents) throw new Error('planner me agents load nahi hue');
  const DP = FF.dispatchPlanner;
  const rows = DP.collectAgents().map((x) => DP.withCalc(x, 'total'));
  if (!rows.some((x) => x.ch === 'ff') || !rows.some((x) => x.ch === 'gv')) throw new Error('planner me FF + GV dono nahi hain');
  const days = FF.util.suggestDays(), el = FF.util.runRateDays();
  const one = rows.find((x) => x.cur.total > 0);
  if (one && (Math.abs(one.rate - one.cur.total / el) > 1e-9 || one.required !== Math.max(0, Math.ceil(one.rate * days)) || one.net !== Math.max(0, Math.ceil(one.rate * days - one.stock.total)))) throw new Error('run-rate / required / with-stock formula galat');
  const table = DP.tableHtml(DP.sortRows(rows, { key: 'net', dir: 'desc' }), 'agents');
  for (const label of ['data-dp-sort="net"', 'data-dp-open="', 'WITH stock', 'W/O stock', 'Cover']) if (!table.includes(label)) throw new Error(`planner table me "${label}" nahi mila`);
  // 📦 v3.56 — class-wise stock summary ("kis class ka kitna") view + TL roll-up me render hona chahiye
  const mix = DP.classStockSummary(rows);
  if (!mix.available) throw new Error('class-wise stock summary data available nahi (mock me class columns hone chahiye)');
  if (!mix.items.length || !mix.items.every((c) => c.total === c.ff + c.gv)) throw new Error('class-wise FF/GV split galat hai');
  if (!html.includes('dp2-classmix') || !html.includes('Stock · class-wise')) throw new Error('dispatch planner me class-wise stock panel nahi mila');
  if (!/dp2-class-chip/.test(html)) throw new Error('class-wise stock panel me class chips nahi hain');
  const tlMix = DP.classStockSummary(DP.collectTls(DP.collectAgents()).map((x) => DP.withCalc(x, 'total')));
  if (!tlMix.items.length) throw new Error('TL view me class-wise stock summary khali hai');
  if (/NaN|undefined/.test(DP.classMixHtml(rows))) throw new Error('class-wise stock panel me NaN/undefined');
  const tls = DP.collectTls(DP.collectAgents());
  if (!tls.length) throw new Error('TL-wise rows nahi bane');
  // 🔠 v3.18 — multiple selection: multi-select controls, row picks + bulk bar, saved filters
  for (const id of ['dp2-tl', 'dp2-prio', 'dp2-need', 'dp2-ch', 'dp2-selbar']) {
    if (!html.includes(id)) throw new Error(`dispatch planner me multi-select control "${id}" nahi mila`);
  }
  if (!/data-dp-pick-all/.test(html)) throw new Error('dispatch table me select-all checkbox nahi hai');
  if (!/aria-pressed=/.test(html)) throw new Error('filter pills multi-select (aria-pressed) nahi hain');
  DP.state.ch = new Set(['ff', 'gv']); DP.state.prio = new Set(['High', 'Medium']);
  const both = DP.collectAgents().map((x) => DP.withCalc(x, 'total')).filter((x) => DP.passes(x));
  if (!both.some((x) => x.ch === 'ff') || !both.some((x) => x.ch === 'gv')) throw new Error('dono channel ek saath select nahi ho rahe');
  const multiChips = DP.chipsHtml(DP.collectAgents().map((x) => DP.withCalc(x, 'total')));
  if (!/data-dp-f="prio:High" aria-pressed="true"/.test(multiChips) || !/data-dp-f="prio:Medium" aria-pressed="true"/.test(multiChips)) throw new Error('multiple selected pills pressed mark nahi ho rahe');
  DP.clearPicks(); DP.togglePick(rows[0].uid); DP.togglePick(rows[1].uid);
  if (DP.pickedCount !== 2) throw new Error('row multi-select kaam nahi kar raha');
  DP.state.ch = new Set(); DP.state.prio = new Set(); DP.clearPicks();
  if (!FF.util.multiSelect || !FF.util.asValueSet || !FF.util.valueSetLabel) throw new Error('U.multiSelect helpers missing');
  if (FF.util.valueSetLabel(['High', 'Medium'], [{ value: 'High', label: 'High' }, { value: 'Medium', label: 'Medium' }]) !== 'High + Medium') throw new Error('multi-select label galat');
}, true);

await run('professional page TL scorecard (score · grade · target)', async () => {
  const data = await FF.cockpit.tlScorecard();
  if (!data.rows.length) throw new Error('TL rows khali hain');
  const first = data.rows[0];
  if (!(first.score >= 0 && first.score <= 120)) throw new Error(`score range galat: ${first.score}`);
  if (!/^[ABCD]\+?$/.test(first.grade)) throw new Error(`grade galat: ${first.grade}`);
  if (!first.agents) throw new Error('agents count missing');
  if (!data.rows.every((r, i, arr) => i === 0 || arr[i - 1].score >= r.score)) throw new Error('rows score ke hisaab se sorted nahi hain');
  const r = root(); await pages.tlScorecard.render(r, {}, {});
  await settle(300);
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['TL-wise scoreboard', 'Top 3 TLs', 'Focus needed', 'tl-csv', 'tl-xlsx', 'tl-wa', 'Average TL score', 'Comm. %', 'commission completeness']) {
    if (!html.includes(label)) throw new Error(`TL scorecard me "${label}" nahi mila`);
  }
}, true);

await run('professional page data quality', async () => {
  const quality = await FF.insights.qualityIssues();
  if (!quality.scanned.stock || !quality.scanned.assignment || !quality.scanned.master) throw new Error('quality source scan incomplete');
  if (!quality.checksRun || quality.passed > quality.checksRun) throw new Error('quality check counters invalid');
  if (!quality.sources.length || !quality.categoryRows.length) throw new Error('quality source/category summary missing');
  const r = root(); await pages.dataQuality.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Findings table', 'Sample rows', 'Category-wise check summary', 'Checks passed', 'dq-findings-csv', 'dq-samples-csv']) {
    if (!html.includes(label)) throw new Error(`data quality me "${label}" nahi mila`);
  }
  if (/<details class="quality-item/.test(html)) throw new Error('purana accordion layout abhi bhi render ho raha hai');
  const dialog = FF.insights.openInsDialog(root(), 'Sample rows · smoke', ['Field', 'Value'], [['TAG_ID', '34161FA820320001'], ['VRN', 'RJ14' + '1'.repeat(4)]], 'smoke note');
  if (!dialog || !/34161FA820320001/.test(dialog.innerHTML)) throw new Error('shared sample dialog rows render nahi kar raha');
  if (!/smoke note/.test(dialog.innerHTML) || !/ins-detail-dialog/.test(dialog.className)) throw new Error('dialog header/note missing');
}, true);
await run('workspace saved views API + page', async () => {
  const created = await FF.auth.api('/api/workspace/views', 'POST', { title: 'Smoke view', route: '#/forecast?risk=High', shared: false });
  await pages.savedViews.render(root(), {}, {});
  if (created.view && created.view.id) await FF.auth.api(`/api/workspace/views/${created.view.id}`, 'DELETE');
}, true);
await run('professional report studio', () => pages.reportStudio.render(root(), {}, {}), true);
await run('workspace note timeline API + page', async () => {
  const created = await FF.auth.api('/api/workspace/notes', 'POST', { entityName: 'Smoke Agent', entityKey: 'SMOKE-1', entityType: 'agent', channel: 'both', text: 'Smoke follow-up', status: 'open' });
  await FF.auth.api(`/api/workspace/notes/${created.note.id}`, 'PATCH', { status: 'done' });
  await pages.followups.render(root(), { status: 'done' }, {});
  await FF.auth.api(`/api/workspace/notes/${created.note.id}`, 'DELETE');
}, true);
await run('sheet.render GV Master', () => pages.sheet.render(root(), { name: 'GV Master' }, {}), true);
await run('sheet.render Tag Assignment', () => pages.sheet.render(root(), { name: 'Tag Assignment' }, {}), true);
await run('sheet.render GV REPORT', () => pages.sheet.render(root(), { name: 'GV REPORT' }, {}), true);
await run('app.updateParams + drawer', async () => {
  FF.app.updateParams({ mode: 'monthly' });
  FF.app.openDrawer({ kicker: 'k', title: 't', body: '<b>hi</b>', actions: '<button class="btn small">x</button>' });
  FF.app.closeDrawer();
});
await run('auth helpers (avatar/role)', async () => {
  const html = FF.auth.avatarHtml(FF.auth.user, 'top');
  if (!html || !html.includes('av')) throw new Error('avatarHtml returned nothing');
  if (!FF.auth.roleLabel(FF.auth.user)) throw new Error('roleLabel empty');
  if (typeof FF.auth.refreshUser !== 'function') throw new Error('refreshUser missing');
});
await run('sheet.render StockDataa', () => pages.sheet.render(root(), { name: 'StockDataa' }, {}), true);
await run('sheet.render REPORT', () => pages.sheet.render(root(), { name: 'REPORT' }, {}), true);
await run('settings.render (all tabs)', async () => { for (const tab of ['account', 'diagnostics', 'sound', 'brand', 'sources', 'access', 'data', 'rules', 'features', 'contacts', 'users', 'links', 'audit', 'backup']) { const r = root(); await pages.settings.render(r, { tab }, {}); await settle(20); if (tab === 'diagnostics') { const h = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join(''); if (!h.includes('id="diag-scan"') || !h.includes('id="diag-scan-all"') || !h.includes('diag-results')) throw new Error('site diagnostics tab render nahi hua (scan / scan-all / results missing)'); } } });
await run('v3.16.1 · My access me sirf granted cards (locked ⛔ cards nahi)', async () => {
  const realCan = FF.auth.can;
  // member simulation: sirf Management ke 4 pages + ek sheet + ek action
  FF.auth.can = (perm) => ['home', 'targets', 'rangeReport', 'masterSearch', 'sheet:EIR', 'refresh'].includes(perm);
  try {
    const r = root(); await pages.settings.render(r, { tab: 'account' }, {}); await settle(20);
    const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
    if (html.includes('data-acc-locked')) throw new Error('locked card abhi bhi dikh raha hai');
    if (html.includes('acc-lock')) throw new Error('lock icon abhi bhi dikh raha hai');
    if (!html.includes('acc-card')) throw new Error('granted cards gayab');
    if (!/4 pages/.test(html)) throw new Error('Management panel me sirf granted pages count nahi');
    if (/<b>First Forward<\/b>/.test(html) || /<b>GV Partner<\/b>/.test(html)) throw new Error('bina access wale panels bhi dikh rahe hain');
    if (!html.includes('EIR')) throw new Error('granted sheet card missing');
  } finally { FF.auth.can = realCan; }
});
await run('settings notification audience matrix', async () => { const r = root(); await pages.settings.render(r, { tab: 'features' }, {}); await settle(30); const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n'); for (const s of ['Notification audience', 'Low-stock / cover alert', 'Monthly champions', 'Sirf admin', 'Admin + users', 'Kisi ko nahi']) if (!html.includes(s)) throw new Error(`notification matrix me "${s}" nahi mila`); });
await run('teamMap.render (admin location map)', () => pages.teamMap.render(root(), {}, {}), true);
await run('tv.render (TV mode rotation)', () => pages.tv.render(root(), {}, {}), true);
await run('tv unmount', () => { if (pages.tv.unmount) pages.tv.unmount(); });
await run('app.refresh (manual ↻)', async () => { await FF.app.refresh(); await settle(100); });
await run('xlsx builder', async () => { let got = null; FF.util.downloadBlob = (name, blob) => { got = { name, size: blob.size }; }; FF.xlsx.download('t.xlsx', [{ name: 'Summary', header: ['a', 'b'], rows: [['x', 1], ['y', 2]] }, { name: 'StockDataa', header: ['c'], rows: [['z']] }]); if (!got || got.size < 200) throw new Error('xlsx not produced'); log(`      ${got.name} ${got.size} bytes`); });
const drawerHtml = () => (REG.get('drawer-body') || {}).innerHTML || '';
const kpiSpecs = [
  { src: 'both', scope: 'day', title: 'Yesterday total' }, { src: 'ff', scope: 'mtd', title: 'FF MTD', f: 'vc4' }, { src: 'gv', scope: 'mtd', title: 'GV MTD' },
  { src: 'both', scope: 'mtd', f: 'ff,vc4', title: 'FF VC4' }, { src: 'ff', scope: 'stock', title: 'Stock' }, { src: 'ff', scope: 'stockreport', title: 'Stock Report' },
  { src: 'ff', scope: 'agents', title: 'Agents' }, { src: 'ff', scope: 'status', title: 'Status' }
];
for (const spec of kpiSpecs) {
  await run(`kpiDetail.open ${spec.src}/${spec.scope}${spec.f ? `/${spec.f}` : ''}`, async () => {
    await FF.kpiDetail.open(spec);
    const h = drawerHtml();
    if (!h.includes('kd-')) throw new Error('KPI drawer did not render a breakdown: ' + h.slice(0, 200));
    if (/error-box|Error:/i.test(h)) throw new Error('KPI drawer error: ' + h.slice(0, 300));
    log(`      drawer ${h.length} chars ok · ${(REG.get('drawer-title') || {}).textContent} · ${String((REG.get('drawer-sub') || {}).innerHTML).replace(/<[^>]+>/g, '').slice(0, 90)}`);
  });
}
await run('kpiDetail raw EIR toDate range query', async () => {
  const e = FF.config.eir;
  const daily = (FF.store.get('daily') || []).filter((r) => r.channel !== 'GV Partner');   // EIR = FF ledger (GV live rows GV Master se)
  const last = FF.model.latestDate(daily);
  const key = FF.util.dateKey(last);
  const t = await FF.data.query(e.sheet, `select ${e.date}, ${e.tagId}, ${e.cls} where toDate(${e.date}) >= date '${key}' and toDate(${e.date}) <= date '${key}' order by ${e.date} desc limit 60000`, {});
  const expect = daily.filter((r) => r.key === key).reduce((a, r) => a + r.n, 0);
  if (!t.rows.length) throw new Error('no raw rows for latest day');
  log(`      raw rows ${t.rows.length} · daily total ${expect}`);
});
await run('🏷️ Tag Request — form + system check (class-wise stock / issuance / priority / suggestion)', async () => {
  // panel/sidebar me option dikhna chahiye (lazy page ka link)
  const navHtml = (REG.get('nav') || {}).innerHTML || '';
  if (navHtml && !/Tag Request/.test(navHtml)) throw new Error('sidebar (panel) me Tag Request option nahi mila');
  const r = root();
  await pages.tagRequest.render(r, {}, {});
  await settle(400);
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  // v3.30 — upar employee, neeche har agent ka block (mobile · address · pincode · vertical class qty)
  for (const s of ['Employee name *', 'Add new agent', 'Agent ID / Naam', 'Agent mobile number', 'Full address', 'Pincode', 'Request submit karo']) {
    if (!html.includes(s)) throw new Error(`Tag Request form me "${s}" nahi mila`);
  }
  for (const a of ['mobile', 'address', 'pincode']) if (!html.includes(`data-tr-a="${a}"`)) throw new Error(`agent ${a} field missing`);
  if (!/data-tr-view="settings"/.test(html)) throw new Error('admin ko ⚙️ Link & Sheet tab nahi mila');
  if (/data-tr-view="result"/.test(html)) throw new Error('Result tab ab nahi hona chahiye');
  for (const c of ['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16']) {
    if (!html.includes(`data-tr-cls="${c}"`)) throw new Error(`Tag class chip ${c} missing`);
  }
  // 🔍 system check (headless) — real agent par class-wise numbers + suggestion aana chahiye
  const perfAgents = pages.performance.agents() || [];
  const testAgent = (perfAgents.find((a) => a.name && a.name !== someAgent && !a.tlExcluded) || perfAgents[0] || {}).name;
  if (!testAgent) throw new Error('performance.agents() khali — test agent nahi mila');
  const res = await pages.tagRequest.preview([{ name: testAgent, classes: ['VC4', 'VC6'] }]);
  const info = pages.tagRequest.indexInfo ? pages.tagRequest.indexInfo() : {};
  if (!res || !res.rows || !res.rows.length) throw new Error(`system check ne koi row nahi di (agent=${testAgent} · index=${JSON.stringify(info)})`);
  const row = res.rows[0];
  for (const k of ['agentName', 'cls', 'last', 'cur', 'stock', 'priority', 'sugNet', 'sugGross', 'approved', 'cover', 'growth']) {
    if (row[k] === undefined) throw new Error(`result row me ${k} missing — ${JSON.stringify(row)}`);
  }
  if (!['High', 'Medium', 'Low'].includes(row.priority)) throw new Error('priority band galat: ' + row.priority);
  if (Number(row.sugNet) < 0 && Number(row.sugNet) === 0) throw new Error('suggestion NaN lag raha hai');
  if (row.cls !== 'VC4') throw new Error('pehli row VC4 honi chahiye');
  // qty diya to approve me wahi aana chahiye (editable default = system suggestion)
  const forced = await pages.tagRequest.preview([{ name: testAgent, cls: 'VC4', qty: 7 }]);
  if (Number(forced.rows[0].approved) !== 7) throw new Error('user qty approve me reflect nahi hui');
  log(`      ${res.rows.length} class-rows · ${row.agentName} · ${row.cls} stock ${row.stock} · ${row.priority} · sug ${row.sugNet}/${row.sugGross}`);
  // 📊 purana ?view=result deep link — ab form hi khulta hai (system check submit ke saath hota hai)
  const r2 = root();
  await pages.tagRequest.render(r2, { view: 'result' }, {});
  await settle(200);
  const h2 = r2.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!h2.includes('Add new agent')) throw new Error('view=result par form nahi khula');
  // 📥 requests view — har request ek row, upar ☑ select → 🖨️ print / ✅ approve / ⬇ CSV
  const r3 = root();
  await pages.tagRequest.render(r3, { view: 'requests' }, {});
  await settle(600);
  const h3 = r3.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/Tag Requests|koi tag request nahi/.test(h3)) throw new Error('requests view render nahi hua');
  for (const s of ['Select all', 'Print selected', 'Approve selected', 'CSV', '🚗 VC4/VC20', '🚚 VC5+', 'Run rate', 'Expected', 'Growth', 'Requested (class-wise)']) {
    if (!h3.includes(s)) throw new Error(`requests table me "${s}" nahi mila`);
  }
  if (/Kholo/.test(h3)) throw new Error('requests table me "Kholo" button nahi hona chahiye (sab ek row me)');
  // ⚙️ Link & Sheet tab — public link + sheet sync cards (requests tab me ab nahi)
  const r4 = root();
  await pages.tagRequest.render(r4, { view: 'settings' }, {});
  await settle(400);
  const h4 = r4.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/tr-public-card/.test(h4) || !/tr-sheet-card/.test(h4)) throw new Error('settings tab me link/sheet cards nahi');
}, false);
await run('🌐 Public employee link — bina login form (naam mandatory) + status view', async () => {
  // share link /tag-request par jaata hai (login nahi)
  const link = pages.tagRequest.shareLink();
  if (!/\/tag-request$/.test(link)) throw new Error('employee share link /tag-request nahi hai: ' + link);
  const pubCfg = { enabled: true, showCheck: true, askMobile: true, askOffice: false, askNote: true, title: 'IDFC Agents Tag Request', brand: 'First Forward', requireEmployeeName: true };
  const r = root();
  await pages.tagRequest.render(r, { view: 'form', public: '1' }, { publicConfig: pubCfg });
  await settle(400);
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const s of ['Employee details', 'Employee name *', 'Agent mobile number', 'Full address', 'Pincode *', 'IDFC Agents Tag Request', 'Add new agent', 'Request submit karo']) {
    if (!html.includes(s)) throw new Error(`public form me "${s}" nahi mila`);
  }
  if (!/data-tr-emp="name"/.test(html)) throw new Error('employee name input missing');
  for (const a of ['mobile', 'address', 'pincode']) if (!html.includes(`data-tr-a="${a}"`)) throw new Error(`agent ${a} field nahi mila (mandatory)`);
  for (const c of ['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16']) if (!html.includes(`data-tr-cls="${c}"`)) throw new Error(`class ${c} qty input missing`);
  if (!/class="tr-qty-list/.test(html)) throw new Error('class qty vertical list nahi mili');
  if (!/data-tr-view="status"/.test(html)) throw new Error('public mode me status tab missing');
  if (/data-tr-view="result"|data-tr-view="requests"/.test(html)) throw new Error('public link par sirf Form + Status tab hone chahiye');
  // 📊 purana ?view=result public link — ab form hi
  const r2 = root();
  await pages.tagRequest.render(r2, { view: 'result', public: '1' }, { publicConfig: pubCfg });
  await settle(150);
  const h2 = r2.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!h2.includes('Request submit karo')) throw new Error('public view=result par form nahi khula');
  if (h2.includes('Admin ko submit karo')) throw new Error('public form me admin wala submit label dikh raha hai');
  // 🔎 status view (Request ID daal kar status dekhne ka raasta)
  const r3 = root();
  await pages.tagRequest.render(r3, { view: 'status', public: '1' }, { publicConfig: pubCfg });
  await settle(150);
  const h3 = r3.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/Request status/.test(h3) || !/tr-status-id/.test(h3)) throw new Error('public status view render nahi hua');
  if (!/Agent mobile/.test(h3)) throw new Error('status view me agent mobile se search ka option nahi');
  // 🔁 duplicate warning card — "already pending" wala block (same agent×class dobara bhejne par)
  const dupHtml = pages.tagRequest.dupWarning([{ id: 'tagreq_test_1', status: 'pending', total: 33, rows: 2, at: new Date().toISOString(), matched: ['1001 · VC4'] }], 'Suresh Yadav');
  if (!/Ye entry pehle se hai/.test(dupHtml)) throw new Error('duplicate warning heading nahi mili');
  if (!/Phir bhi bhejo/.test(dupHtml) || !/Status dekho/.test(dupHtml)) throw new Error('duplicate card ke buttons nahi mile');
  if (!/tagreq_test_1/.test(dupHtml) || !/Suresh Yadav/.test(dupHtml)) throw new Error('duplicate card me request ID/naam nahi');
  if (/undefined|NaN/.test(dupHtml)) throw new Error('duplicate card me undefined/NaN leak');
  const dupNone = pages.tagRequest.dupWarning([], 'Suresh Yadav');
  if (dupHtml.length < 100 || dupNone !== '') throw new Error('duplicate card empty case galat');
  log(`      employee link ${link} · public form + result + status + 🔁 duplicate warning render ok`);
});
await run('🧓 Stock ageing — Agent Allocated At se 1/3/5/6+ mahine · VC4+VC20 alag, VC5+ alag · CSV', async () => {
  if (!FF.stockAge) throw new Error('stockAge module load nahi hua (index.html/sw.js me hai?)');
  const idx = await FF.stockAge.ready();
  if (!idx) throw new Error('stock ageing index nahi bana — ' + (FF.stockAge.error || 'unknown'));
  if (!idx.data || !idx.data.ff || !idx.data.ff.total) throw new Error('StockDataa se koi dated row nahi mili');
  if (!idx.data.gv || !idx.data.gv.total) throw new Error('v3.31: GV (Tag Assignment) ageing nahi bani');
  if (!(idx.data.gv.matched > 0)) throw new Error('GV tags StockDataa se match nahi hue (tag ID / serial)');
  const allHtml = FF.stockAge.html({ kind: 'all', key: 'all' });
  if ((allHtml.match(/data-age-block=/g) || []).length !== 2) throw new Error('network ageing me FF + GV dono blocks chahiye');
  if (!/VC4 \+ VC20/.test(allHtml)) throw new Error('VC4+VC20 group row nahi mili');
  if (!/VC5\+ \(commercial\)/.test(allHtml)) throw new Error('VC5+ group row nahi mili');
  for (const s of ['≥ 1 mahina', '≥ 3 mahine', '≥ 5 mahine', '≥ 6 mahine']) if (!allHtml.includes(s)) throw new Error(`bucket column nahi mila: ${s}`);
  for (const m of [1, 3, 5, 6]) if (!allHtml.includes(`data-age-csv="${m}"`)) throw new Error(`month ${m} ke saath CSV button nahi mila`);
  if (!/data-age-open=/.test(allHtml)) throw new Error('count click (tag list) button nahi mila');
  // Agent level: pehla FF agent — chip + CSV count match hone chahiye
  const list = (FF.pages.performance && FF.pages.performance.agents ? FF.pages.performance.agents() : []).filter((a) => !a.isMaster && (a.stockTotal || 0) > 0);
  if (!list.length) throw new Error('stock wala koi agent nahi mila');
  const a = list[0];
  const scope = { kind: 'agent', key: a.id || a.name, keys: [a.agentId, a.name], ch: 'ff' };
  const node = FF.stockAge.forAgent([a.id, a.agentId, a.name], 'ff');
  if (!node) throw new Error('agent ka ageing node nahi mila: ' + scope.key);
  const n6 = (node.counts.core[6] || 0) + (node.counts.comm[6] || 0);
  const older6 = await FF.stockAge.fetchTags(scope, 6, '', 5000);
  if (!older6.total || older6.total !== n6) throw new Error(`6 mahine se purane tags: list ${older6.total} vs bucket ${n6}`);
  const csvN = await FF.stockAge.csv(scope, 6);
  if (csvN !== older6.total) throw new Error(`CSV count mismatch: ${csvN} vs ${older6.total}`);
  if (!FF.stockAge.chipText(scope)) throw new Error('agent chip text khaali hai');
  if (FF.stockAge.groupOf('VC4') !== 'core' || FF.stockAge.groupOf('VC20') !== 'core' || FF.stockAge.groupOf('VC5') !== 'comm' || FF.stockAge.groupOf('VC16') !== 'comm') throw new Error('class grouping galat (VC4/VC20 → core, VC5+ → comm)');
  // 🧓 v3.31 — har drawer me ageing: performance agent drawer kholo → section aana chahiye
  pages.performance.openAgent(a.__row);
  const dh = (REG.get('drawer-body') || {}).innerHTML || '';
  if (!/data-drawer-age/.test(dh)) throw new Error('agent drawer me stock ageing section nahi');
  log(`      ageing: FF ${FF.util.fmt(idx.data.ff.total)} · GV ${FF.util.fmt(idx.data.gv.total)} (${FF.util.fmt(idx.data.gv.matched)} matched) · ${older6.total} tags ≥6M (${a.name}) · CSV ok · drawer ok`);
});
await run('🖨️ Dispatch label — A4 print me FROM+TO left·right repeat + text size + share/copy', async () => {
  const r = {
    id: 'tagreq_smoke_1234', at: '2026-10-01T04:00:00.000Z', status: 'approved',
    byName: 'Ramesh Yadav',
    employee: { name: 'Ramesh Yadav', mobile: '9812345678', address: '24, Shanti Nagar, Sodala, Jaipur', pincode: '302019' },
    rows: [
      { agentId: '1001', agentName: 'APNA PAYEMENT', cls: 'VC4', approved: 25 },
      { agentId: '1001', agentName: 'APNA PAYEMENT', cls: 'VC5', approved: 10 }
    ]
  };
  if (!pages.tagRequest.dispatchLabelHtml) throw new Error('dispatchLabelHtml export nahi mila');
  if (typeof pages.tagRequest.labelText !== 'function') throw new Error('labelText export nahi mila');
  const html = pages.tagRequest.dispatchLabelHtml(r, { size: 12, rows: 4 });
  if (!/A4/.test(html) || !html.includes('@page')) throw new Error('A4 print CSS nahi mili');
  // v3.30 — har request ka label sirf EK baar (pehle wahi label 8/10/12 baar repeat hota tha)
  const lblCount = (html.match(/class="lbl"/g) || []).length;
  if (lblCount !== 1) throw new Error(`labels count mismatch: ${lblCount} vs 1 — label repeat nahi hona chahiye`);
  const pinCount = (html.match(/302019/g) || []).length;
  if (pinCount !== 1) throw new Error(`pincode count mismatch: ${pinCount} vs 1`);
  if (!html.includes('Ramesh Yadav')) throw new Error('TO naam label par nahi');
  const r2 = { ...r, id: 'tagreq_smoke_5678', employee: undefined, agent: { name: 'Neha Gupta', agentId: '3003', channel: 'ff', mobile: '9811100003', address: '7, Station Road, Ajmer', pincode: '305001' } };
  const multi = pages.tagRequest.labelsHtml([r, r2, r], { size: 10.5, rows: 5 });
  if ((multi.match(/class="lbl"/g) || []).length !== 2) throw new Error('print selected me har request ek hi baar aani chahiye');
  if (!multi.includes('305001') || !multi.includes('Neha Gupta')) throw new Error('agent wali request ka TO = agent ka address nahi');
  if (!/FROM:/.test(html)) throw new Error('FROM block nahi mila (company address — Settings me set karo)');
  if (!html.includes('font-size: 12pt')) throw new Error('text size 12pt set nahi hua');
  if (!/data-sz="14"/.test(html)) throw new Error('text size chhota/bada buttons nahi mile (print view me)');
  if (!/Download PDF/.test(html) || !/id="pdfbtn"/.test(html)) throw new Error("Print/PDF toolbar button nahi mila");
  if (!html.includes('35 tags') && !html.includes('🏷️ 35')) throw new Error('request summary (total tags) nahi mili');
  const txt = pages.tagRequest.labelText(r);
  for (const snip of ['FROM:', 'TO: Ramesh Yadav', '302019', 'tagreq_smoke_1234', '35 tags']) if (!txt.includes(snip)) throw new Error(`label text me "${snip}" nahi mila`);
  log('      label: 1 label/request · print selected unique · FROM · meta ok · text: ' + txt.split('\n').length + ' lines');
});
await run('liveView.openNotification (report / settings / login)', async () => {
  FF.liveView.openNotification({ id: 'a', type: 'report', title: 'First Forward report update', body: 'x', createdAt: new Date().toISOString(), meta: { source: 'ff', snapshot: { date: '2026-09-26', total: 120, classes: { VC4: 100, VC5: 20 } }, previous: { date: '2026-09-26', total: 90, classes: { VC4: 80, VC5: 10 } }, delta: { total: 30, classes: { VC4: 20, VC5: 10 } } } });
  if (!drawerHtml().includes('+30')) throw new Error('report delta missing');
  FF.liveView.openNotification({ id: 'b', type: 'settings', title: 'Settings changed', body: 'x', createdAt: new Date().toISOString(), meta: { username: 'admin', changes: [{ field: 'brand', before: 'A', after: 'B' }] } });
  if (!drawerHtml().includes('brand')) throw new Error('settings diff missing');
  FF.liveView.openNotification({ id: 'c', type: 'login', title: 'Login', body: 'x', createdAt: new Date().toISOString(), meta: { username: 'ravi', loginId: 'ravi' } });
  if (!drawerHtml().includes('data-lv-watch')) throw new Error('live view button missing');
  FF.app.closeDrawer();
});
// 🚨 v3.37 — Unusual Activity: card ka number == drawer ka number, server-side tag scan, page diagnose.
await run('🚨 unusual · card = drawer parity + 🚀 server scan + 🩺 diagnose', async () => {
  const r = root();
  await pages.unusual.render(r, { period: 'last' }, {});
  await settle(2500);                       // instant paint ke baad background server scan
  const kpis = (REG.get('ua-kpis') || {}).innerHTML || '';
  if (!kpis.includes('data-ua-flag=')) throw new Error('anomaly KPI cards nahi bane');
  if (!/data-kpi-self="1"/.test(kpis)) throw new Error('cards par data-kpi-self nahi — global kpiDetail handler click hijack karega');
  const scan = FF.unusual.scan;
  if (!scan || scan.via !== 'server') throw new Error(`server scan use nahi hua (via=${scan && scan.via}, error=${FF.unusual.state.scanError || '—'})`);
  const model = FF.unusual.model;
  if (!model || !model.index) throw new Error('model par tag-level index nahi laga');
  if (!(model.index.totals.rows > 0)) throw new Error('scan me 0 tag rows');
  // 🎯 har card ka metric == drawer/evidence ka count
  for (const flag of Object.keys(FF.unusual.FLAGS)) {
    const m = FF.unusual.metricFor(model, flag);
    if (m.evidenceTotal !== m.value) throw new Error(`${flag}: card ${m.value} ${m.unit} vs evidence ${m.evidenceTotal}`);
    if (m.value === 0 && FF.unusual.evidenceFor(m, model, 0).total !== 0) throw new Error(`${flag}: card 0 par drawer me rows leak`);
  }
  // 🔬 asli click-path probe (drawer title/value/unit)
  const out = new El('div');
  const results = (await FF.unusual.probeCards(out)) || [];
  if (results.length !== Object.keys(FF.unusual.FLAGS).length) throw new Error(`probeCards ne ${results.length} flags test kiye`);
  const bad = results.filter((x) => !x.ok);
  if (bad.length) throw new Error(`card↔drawer mismatch: ${bad.map((b) => `${b.flag} (card "${b.card}" vs "${b.drawerTitle}")`).join(', ')}`);
  // 🩺 page-level diagnose drawer
  FF.unusual.openDiagnose(model, null);
  const dh = (REG.get('drawer-body') || {}).innerHTML || '';
  if (!dh.includes('Tag-level scan health')) throw new Error('diagnose drawer me scan health section nahi');
  if (!dh.includes('Har flag ka hisaab')) throw new Error('diagnose drawer me flag-wise hisaab nahi');
  FF.app.closeDrawer();
}, true);

await run('🩺 diagnostics · safe fix site-wide persist hota hai (reload ke baad bhi)', async () => {
  const dg = FF.pages.settings && FF.pages.settings.diagnostics;
  if (!dg || typeof dg.applyFix !== 'function') throw new Error('diagnostics API missing');
  dg.clearRepairs();
  if (dg.repairs().length) throw new Error('clearRepairs ke baad bhi rules bache');
  const el = new El('div'); el.classList.add('kpi'); el.style = {};
  const ok = dg.applyFix({ safe: true, fixType: 'wrap', element: el, repairSelector: '.kd-tbl tr.clickable' });
  if (!ok) throw new Error('safe fix apply nahi hua');
  const rules = dg.repairs();
  if (!rules.some((r) => r.selector === '.kd-tbl tr.clickable' && r.fixType === 'wrap')) throw new Error('repair rule localStorage me save nahi hui');
  if (localStorage.getItem('ff_diag_repairs') === null) throw new Error('ff_diag_repairs persist nahi hua');
  if (!dg.saved({ safe: true, fixType: 'wrap', repairSelector: '.kd-tbl tr.clickable' })) throw new Error('saved() rule ko nahi pehchanta — reload ke baad "fixed" nahi dikhega');
  if (dg.saved({ safe: true, fixType: 'wrap', repairSelector: '.something-else' })) throw new Error('saved() galat selector par true');
  // unsafe finding browser se fix nahi hona chahiye
  if (dg.applyFix({ safe: false, fixType: 'wrap', element: el, repairSelector: '.x' })) throw new Error('unsafe finding fix ho gayi');
  dg.clearRepairs();
  if (dg.repairs().length) throw new Error('cleanup fail');
});

await run('🔁 FF T+1 lag · aaj FF 0 (kal aayega), GV live · kpiDetail bhi lag-aware', async () => {
  const K = FF.filters;
  if (!K || !K.ffLagOn || !K.ffLagOn()) throw new Error('filters lag API missing/off');
  const daily = FF.store.get('daily') || [];
  const ffToday = daily.filter((r) => r.channel !== 'GV Partner' && r.key === FF.util.dateKey(new Date()));
  const kept = K.dropLaggedFf(ffToday);
  if (kept.length) throw new Error('aaj ki FF rows lag ke bawajood count me aa rahi hain');
  const gvToday = daily.filter((r) => r.channel === 'GV Partner' && r.key === FF.util.dateKey(new Date()));
  if (K.dropLaggedFf(gvToday).length !== gvToday.length) throw new Error('GV rows lag se hat gayi — GV hamesha live hona chahiye');
  // kpiDetail: aaj ka FF card 0 dikhaye, note ke saath
  const d = FF.kpiDetail.specFrom({ dataset: { kpi: 'src=ff&scope=day&date=' + FF.util.dateKey(new Date()) }, getAttribute: () => 'FF aaj', querySelector: () => null, classList: { contains: () => false } });
  await FF.kpiDetail.open(d);
  const html = drawerHtml();
  if (!/T\+1|kal aayega|0 tags/i.test(html)) throw new Error('aaj ke FF drawer me T+1 note nahi mila');
  FF.app.closeDrawer();
});

await run('👥 KPI drill: agent drawer (kisne lagaye) + us agent ka day-wise detail', async () => {
  const daily = FF.store.get('daily') || [];
  const ym = FF.util.ymKey(new Date());
  // is mahine ka GV agent (mahine ki 1 tareekh ko sirf aaj ke live rows hote hain — purane month ka agent drill khaali deta)
  const gv = daily.filter((r) => r.channel === 'GV Partner' && r.ym === ym);
  const pick = (rows) => rows.slice().sort((a, b) => (b.n || 0) - (a.n || 0))[0];
  const gvAgent = pick(gv);
  await FF.kpiDetail.open({ src: 'both', scope: 'mtd', ym, title: 'KPI drill test' });
  let html = drawerHtml();
  if (!/Kisne lagaye/.test(html)) throw new Error('issuance drawer me agent-wise (kisne lagaye) section nahi mila');
  if (!/data-kd-agent=/.test(html)) throw new Error('agent rows clickable nahi hain');
  if (!/kd-badge (gv|ff)/.test(html)) throw new Error('GV/FF channel badge missing');
  if (gvAgent) {
    await FF.kpiDetail.open({ src: 'both', scope: 'mtd', ym, agent: gvAgent.agentName, channel: 'gv', title: `${gvAgent.agentName} · GV agent` });
    html = drawerHtml();
    if (!html.includes(encodeURIComponent(gvAgent.agentName))) throw new Error('agent drawer me agent ka naam/links nahi mile');
    if (!/data-kd-agent-day=/.test(html)) throw new Error('agent drawer me day-wise drill rows nahi hain');
    if (!/GV Partner agent/.test(html)) throw new Error('agent drawer me GV channel kicker nahi mila');
  }
  FF.app.closeDrawer();
});

await run('🧩 GV agent issuance/class and stock drawers drill progressively', async () => {
  const gvRows = FF.gv.issuanceRows();
  const stockRows = FF.gv.get('stockAgentClass') || [];
  const ymNow = FF.util.ymKey(new Date());
  const profile = gvRows.find((r) => r.agentName && r.n > 0 && r.ym === ymNow) || gvRows.find((r) => r.agentName && r.n > 0);
  const stockProfile = stockRows.find((r) => r.agentName && r.n > 0);
  if (!profile || !stockProfile) throw new Error('GV agent / stock fixtures unavailable');
  const ym = FF.util.ymKey(new Date());
  await FF.kpiDetail.open({ src: 'gv', scope: 'mtd', ym, agent: profile.agentName, agentId: profile.agentId, channel: 'gv', title: `${profile.agentName} · GV agent` });
  let html = drawerHtml();
  if (!html.includes('data-kd-spec=') || !html.includes('Class-wise')) throw new Error('GV agent class rows are not clickable');
  await FF.kpiDetail.open({ src: 'gv', scope: 'stock', agent: stockProfile.agentName, channel: 'gv', title: `${stockProfile.agentName} · stock` });
  html = drawerHtml();
  if (!html.includes('Agent stock by class') || !html.includes('data-kd-spec=')) throw new Error(`GV agent stock class breakdown is not clickable: ${html.slice(0, 240)}`);
  const className = stockProfile.cls;
  if (className) {
    await FF.kpiDetail.open({ src: 'gv', scope: 'stock', agent: stockProfile.agentName, channel: 'gv', cls: className, title: `${stockProfile.agentName} · ${className} stock` });
    html = drawerHtml();
    if (!html.includes('Tag Assignment source')) throw new Error('class click did not open Tag Assignment rows');
  }
  FF.app.closeDrawer();
});

await run('🧾 v3.44 · GV REPORT sheet-first: TL APS011919 = sheet ka 332 / 27 / 1054 + VC4 · VC20 · VC5+ + TL ID-wise stock', async () => {
  await FF.masterProfile.load();
  const person = { kind: 'gv-tl', name: 'Hemalbhai Bhavsar', sub: 'APS011919', tlSet: new Set(), classMap: new Map(), bars: new Set() };
  const pr = await FF.masterProfile.build(person);
  const want = { lastTotal: 332, lastVc4: 311, curTotal: 27, curVc4: 25 };
  for (const [key, value] of Object.entries(want)) if (Number(pr.totals[key]) !== value) throw new Error(`TL ${key} sheet ke ${value} ke barabar nahi (mila ${pr.totals[key]})`);
  if (Number(pr.stock.total) !== 1054 || Number(pr.stock.vc4) !== 657) throw new Error(`TL stock sheet ke 657 / 1054 ke barabar nahi (mila ${pr.stock.vc4} / ${pr.stock.total})`);
  const bins = pr.groupBins || {};
  const check = (period, group, value) => { if (Number(bins[period] && bins[period][group]) !== value) throw new Error(`groupBins.${period}.${group} = ${value} expect tha (mila ${bins[period] && bins[period][group]})`); };
  check('last', 'VC4', 311); check('last', 'total', 332);
  check('cur', 'VC4', 25); check('cur', 'VC20', 2); check('cur', 'total', 27);
  // commercial ka batwara (VC20 + VC5+) sheet ke NVC4 = 21 ke barabar hona chahiye
  const commSplit = Number(bins.last.VC20) + Number(bins.last['VC5+']);
  if (commSplit !== 21) throw new Error(`last month ka commercial batwara 21 hona chahiye (mila ${commSplit})`);
  const html = FF.masterProfile.html(pr);
  for (const label of ['mp-group-tbl', 'data-mp-sec="tlstock"', 'TL ID-wise stock', 'APS011919', 'Stock Comm', '= TL TOTAL', 'APS04505']) {
    if (!html.includes(label)) throw new Error(`TL drawer me \"${label}\" nahi mila`);
  }
  const board = FF.agentBoard.sections(person);
  for (const label of ['Class group · VC4 · VC20 · VC5+', 'TL ID-wise stock', '1,054', 'data-ab-open=']) {
    if (!board.html.includes(label)) throw new Error(`TL 360 board me \"${label}\" nahi mila`);
  }
  FF.app.closeDrawer();
});

await run('🧭 Removed workspace filter UI + GV live and FF T+1 behavior', async () => {
  const htmlOf = (r) => r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  // URL-level today view → FF aaj 0 + "kal aayega" note, GV live; no saved workspace UI.
  const r1 = root(); await pages.home.render(r1, {}, {}); await settle(500);
  const h1 = htmlOf(r1);
  if (!/T\+1|kal aata hai/.test(h1)) throw new Error('today view me "FF T+1 / kal aata hai" note nahi mila');
  if (!/GV aaj · GV Master \(live\)/.test(h1.replace(/[▲▼]/g, ''))) throw new Error('today view me GV live chip nahi mila');
  if (/home-filter-banner|Workspace filters|Saved workspace filters/i.test(h1)) throw new Error('removed workspace filter UI is still rendered');
  // 2) FF ka aaj 0 (T+1) — GV live number > 0 (mock me GV data hai)
  if (!/🟦 FF <b>0<\/b>/.test(h1) && !/FF ka issuance T\+1/.test(h1)) throw new Error('Home view me FF T+1 state nahi mili');
});

await run('logout', async () => { await FF.auth.api('/api/auth/logout', 'POST', {}); });

log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nALL OK');
process.exit(failures.length ? 1 : 0);
