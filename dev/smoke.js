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
await run('stock.render overview', () => pages.stock.render(root(), {}, {}), true);
await run('stock.render agent', () => pages.stock.render(root(), { agent: someAgent }, {}), true);
await run('stock.render tl', () => pages.stock.render(root(), { tl: someTl }, {}), true);
await run('stock.render cls', () => pages.stock.render(root(), { cls: 'VC4' }, {}), true);
await run('stock.render cls commercial', () => pages.stock.render(root(), { cls: '12' }, {}), true);
await run('model.loadStockRows (xlsx source)', async () => { const r = await FF.model.loadStockRows({ agent: someAgent, limit: 50 }); if (!r.rows.length) throw new Error('no rows'); log(`      ${r.rows.length} raw rows · ${r.header.length} cols`); });
await run('performance.render overview', () => pages.performance.render(root(), {}, {}), true);
await run('performance agents()', async () => { const list = pages.performance.agents(); if (!list.length) throw new Error('no agents parsed from REPORT'); const withTl = list.filter((a) => a.tlExcluded).length; log(`      ${list.length} agents · ${withTl} direct (APS) · months ${JSON.stringify(list[0] && pages.performance.months ? pages.performance.months() : '')}`); });
for (const view of ['agents', 'tls', 'alerts', 'columns']) await run(`performance.render view=${view}`, () => pages.performance.render(root(), { view }, {}));
await run('performance.render q=agent (auto-open drawer)', () => pages.performance.render(root(), { q: someAgent }, {}), true);
await run('performance.render q=tl', () => pages.performance.render(root(), { q: someTl }, {}), true);
await run('performance.render priority chip', () => pages.performance.render(root(), { view: 'agents', priority: 'High' }, {}), true);
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
await run('page home', () => pages.home.render(root(), {}, {}), true);
await run('page gvDashboard', () => pages.gvDashboard.render(root(), {}, {}), true);
await run('page gvTrend daily', () => pages.gvTrend.render(root(), { mode: 'daily' }, {}), true);
await run('page gvTrend weekly', () => pages.gvTrend.render(root(), { mode: 'weekly' }, {}), true);
await run('page gvTrend monthly', () => pages.gvTrend.render(root(), { mode: 'monthly' }, {}), true);
await run('page gvTrend compare', () => pages.gvTrend.render(root(), { mode: 'compare' }, {}), true);
await run('page gvStock', () => pages.gvStock.render(root(), {}, {}), true);
const gvAgent = (FF.gv.people().agents[0] || {}).name;
log(`      sample GV agent "${gvAgent}"`);
await run('page gvStock tl filter', () => pages.gvStock.render(root(), { tl: (FF.gv.people().tls[0] || {}).name || '' }, {}), true);
await run('page gvPerformance', () => pages.gvPerformance.render(root(), {}, {}), true);
await run('page gvPerformance q=agent', () => pages.gvPerformance.render(root(), { q: gvAgent }, {}), true);
await run('page compare', () => pages.compare.render(root(), {}, {}), true);
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
await run('settings.render (all tabs)', async () => { for (const tab of ['account', 'brand', 'sources', 'access', 'data', 'rules', 'contacts', 'users', 'backup']) { await pages.settings.render(root(), { tab }, {}); await settle(20); } });
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
