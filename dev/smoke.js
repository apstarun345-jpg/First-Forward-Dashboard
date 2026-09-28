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
  await run(`dataset ${ds}`, async () => { const v = await FF.store.need(ds); const n = Array.isArray(v) ? v.length : v && v.rows ? v.rows.length : -1; if (n <= 0) throw new Error(`empty (${n})`); log(`      ${ds}: ${n} rows`); });
}
await run('store.suggestions', async () => { const s = FF.store.suggestions({ agents: true, tls: true }); if (!s.length) throw new Error('no suggestions'); if (s.some((x) => /^APS$/i.test(x.label) && x.kind === 'tl')) throw new Error('APS leaked into TL suggestions'); log(`      ${s.length} suggestions, e.g. ${s.slice(0, 3).map((x) => `${x.kind}:${x.label}`).join(', ')}`); });

const pages = FF.pages;
await run('all permitted sheets preload before navigation (zero extra network requests on click)', async () => {
  await FF.preloader.preloadAll(false);
  const before = sheetNetworkRequests;
  for (const tab of FF.config.allTabs(true).filter(t => FF.auth.can('sheet:' + t.id))) {
    await pages.sheet.render(root(), { name: tab.id }, {});
  }
  if (sheetNetworkRequests !== before) throw new Error(`${sheetNetworkRequests - before} unexpected query requests after preload`);
  log('      sheet navigation: 0 new Google/proxy requests');
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
  if (!html.includes('Direct Agents · no dispatch')) throw new Error('alerts view me Direct Agents filter nahi');
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
await run('page home', async () => { const r = root(); await pages.home.render(r, {}, {}); await settle(150); const all = [r.innerHTML, ...REG.values().map((e) => e.innerHTML), ...body.children.map((c) => c.innerHTML)].join('\n'); if (!/Champions of/.test(all)) throw new Error('gamification champions card missing from home'); }, true);
await run('page gvDashboard', () => pages.gvDashboard.render(root(), {}, {}), true);
await run('gvDashboard 4-way + suggested dispatch card', async () => {
  const r = root(); await pages.gvDashboard.render(r, {}, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const s of ['VC20', 'VC5+', 'All Comm']) if (!html.includes(s)) throw new Error(`gvDashboard me "${s}" nahi mila`);
  if (!html.includes('Suggested dispatch plan')) throw new Error('gvDashboard me 🎯 dispatch plan card nahi');
  if (!html.includes('Direct Agents · no dispatch')) throw new Error('gvDashboard me Direct Agents filter nahi');
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
await run('page gvStockReport dispatch', async () => { const r = root(); await pages.gvStockReport.render(r, { view: 'dispatch' }, {}); const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n'); for (const s of ['Dispatch plan & Direct Agent status', 'Show Direct only', 'WhatsApp']) if (!html.includes(s)) throw new Error(`GV Stock Report me "${s}" nahi mila`); }, true);
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
}, true);
await run('professional page FF reported commission (dynamic mapping)', async () => {
  const mapping = await FF.insights.ffCommissionData();
  if (!mapping.amountCol) throw new Error('REPORT ka earned-commission heading detect nahi hua');
  if (!mapping.rateCol) throw new Error('REPORT ka commission-rate heading detect nahi hua');
  if (mapping.rateCol.letter !== 'CA' || mapping.amountCol.letter !== 'CB') throw new Error(`commission columns galat detect hue: ${mapping.rateCol.letter}/${mapping.amountCol.letter}`);
  if (!mapping.agents.some((a) => Number.isFinite(a.earned))) throw new Error('earned commission values read nahi hue');
  if (!mapping.agents.some((a) => Number.isFinite(a.computed))) { throw new Error('rate × tags fallback compute nahi hua'); }
  const r = root(); await pages.ffCommission.render(r, { headings: 'all' }, {});
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const s of ['REPORT commission column finder', 'Commission rate source', 'Rate range in sheet', 'Agent-wise commission', 'Rate × tags', 'Heading map', 'ffc-fresh-top']) if (!html.includes(s)) throw new Error(`FF commission me "${s}" nahi mila`);
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
await run('settings.render (all tabs)', async () => { for (const tab of ['account', 'brand', 'sources', 'access', 'data', 'rules', 'features', 'contacts', 'users', 'links', 'audit', 'backup']) { await pages.settings.render(root(), { tab }, {}); await settle(20); } });
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
  const daily = FF.store.get('daily') || [];
  const last = FF.model.latestDate(daily);
  const key = FF.util.dateKey(last);
  const t = await FF.data.query(e.sheet, `select ${e.date}, ${e.tagId}, ${e.cls} where toDate(${e.date}) >= date '${key}' and toDate(${e.date}) <= date '${key}' order by ${e.date} desc limit 60000`, {});
  const expect = daily.filter((r) => r.key === key).reduce((a, r) => a + r.n, 0);
  if (!t.rows.length) throw new Error('no raw rows for latest day');
  log(`      raw rows ${t.rows.length} · daily total ${expect}`);
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
await run('logout', async () => { await FF.auth.api('/api/auth/logout', 'POST', {}); });

log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nALL OK');
process.exit(failures.length ? 1 : 0);
