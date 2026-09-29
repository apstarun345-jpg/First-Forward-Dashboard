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
await run('page gvStockReport dispatch', async () => { const r = root(); await pages.gvStockReport.render(r, { view: 'dispatch' }, {}); const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n'); for (const s of ['GV Dispatch plan', 'Direct Agents — alag list', 'Direct filter', 'WhatsApp']) if (!html.includes(s)) throw new Error(`GV Stock Report me "${s}" nahi mila`); }, true);
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
  const gvHeld = stockAgents.filter((x) => String(x.agentId || '').trim() === '5845036').reduce((n, x) => n + (x.n || 0), 0);
  if (!(gvHeld > 0)) throw new Error('mock StockDataa me GV master ID wali rows hi nahi — exclusion test meaningless');
  const ffClean = stockAgents.filter((x) => String(x.agentId || '').trim() !== '5845036').reduce((n, x) => n + (x.n || 0), 0);
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
  if (!dp.innerHTML.includes('ins-metric-tap')) throw new Error('dispatch planner KPI cards clickable nahi');
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
  const r = root(); await pages.dispatchPlan.render(r, { horizon: '7' }, {});
  await settle(300);
  const html = r.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  for (const label of ['Auto dispatch plan', 'Printable pick-list', 'slip-block', 'dp-csv', 'dp-xlsx', 'dp-wa', 'dp-log', 'dp-controls', 'Need 7d', 'Buffer tags']) {
    if (!html.includes(label)) throw new Error(`dispatch planner me "${label}" nahi mila`);
  }
  const r15 = root(); await pages.dispatchPlan.render(r15, { horizon: '15', box: '50' }, {});
  await settle(250);
  const h15 = r15.innerHTML + [...REG.values()].map((e) => e.innerHTML).join('\n');
  if (!/Need 15d/.test(h15) || !/1 box = 50/.test(h15)) throw new Error('horizon/box param page par reflect nahi hua');
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
