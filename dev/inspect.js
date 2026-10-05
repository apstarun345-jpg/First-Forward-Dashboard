#!/usr/bin/env node
/* dev/inspect.js — page inspector: loads the browser scripts into a fake DOM against a running server,
   renders one page and prints structural stats (KPI tones, tables, rows, CSV buttons, bytes).
   Usage:  PAGE=dispatchPlan node dev/inspect.js        (server on :8080, admin/admin123)
           PAGE=tlScorecard PARAMS='{"channel":"gv"}' LABELS=1 node dev/inspect.js                  */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.INSPECT_BASE || 'http://localhost:8080';
let cookie = '';
const REG = new Map();
class ClassList { constructor() { this.s = new Set(); } add(...c) { c.forEach((x) => this.s.add(x)); } remove(...c) { c.forEach((x) => this.s.delete(x)); } toggle(c, f) { if (f === undefined) f = !this.s.has(c); f ? this.s.add(c) : this.s.delete(c); return f; } contains(c) { return this.s.has(c); } }
class El {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this._html = ''; this.children = []; this.classList = new ClassList(); this.dataset = {}; this.style = { setProperty() {}, removeProperty() {} }; this.attrs = {}; this.value = ''; this.files = []; this.parentNode = null; this.listeners = {}; }
  get innerHTML() { return this._html; } set innerHTML(v) { this._html = String(v); this.children = []; }
  get outerHTML() { return this._html; } get isConnected() { return true; }
  get childNodes() { return this.children; }
  get content() { const f = new El('fragment'); f.children = [new El('div')]; return f; }
  get firstElementChild() { return this.children[0] || new El(); } get nextElementSibling() { return new El(); }
  get offsetWidth() { return 800; } get offsetHeight() { return 400; } get clientWidth() { return 800; } get scrollWidth() { return 800; }
  getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 400, bottom: 400, right: 800 }; }
  querySelector(sel) { const m = /^#([\w-]+)$/.exec(sel || ''); if (m) { let e = REG.get(m[1]); if (!e) { e = new El(); e.id = m[1]; REG.set(m[1], e); } e.parentNode = this; return e; } const e = new El(); e.parentNode = this; return e; }
  querySelectorAll() { return []; } getElementsByTagName() { return []; } closest() { return null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); } removeEventListener() {}
  dispatchEvent() { return true; } appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  append(...c) { c.forEach((x) => typeof x === 'object' && this.appendChild(x)); } prepend(c) { this.children.unshift(c); }
  insertBefore(c) { this.children.push(c); return c; } removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  replaceChildren(...c) { this.children = []; c.forEach((x) => this.appendChild(x)); } remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith() {} insertAdjacentHTML(_, h) { this._html += h; } insertAdjacentElement(_, e) { this.appendChild(e); }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; } hasAttribute(k) { return k in this.attrs; }
  focus() {} blur() {} click() {} select() {} scrollIntoView() {} scrollTo() {} contains() { return false; } matches() { return false; }
  showModal() { this.open = true; } show() { this.open = true; } close() { this.open = false; }
  getContext() { return { drawImage() {}, fillRect() {}, measureText: () => ({ width: 10 }) }; } toDataURL() { return 'data:image/png;base64,'; }
}
const body = new El('body');
const document = { body, documentElement: new El('html'), title: '', readyState: 'complete', activeElement: null, hidden: false, visibilityState: 'visible', createElement: (t) => new El(t), createTextNode: (t) => ({ textContent: t }), createDocumentFragment: () => new El('fragment'), querySelector: (s) => body.querySelector(s), querySelectorAll: () => [], getElementById: (i) => body.querySelector('#' + i), addEventListener() {}, removeEventListener() {}, execCommand() { return true; } };
const location = { hash: '#/dashboard', href: `${BASE}/#/dashboard`, origin: BASE, pathname: '/', search: '', reload() {}, replace() {} };
const storage = new Map();
const localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), clear: () => storage.clear() };
const fetchImpl = async (url, opts = {}) => { const abs = url.startsWith('http') ? url : BASE + url; const headers = { ...(opts.headers || {}) }; if (cookie) headers.cookie = cookie; const res = await fetch(abs, { ...opts, headers, redirect: 'manual' }); const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return res; };
const win = { document, location, localStorage, sessionStorage: localStorage, history: { replaceState() {}, pushState() {} }, navigator: { userAgent: 'inspect', clipboard: { writeText: async () => {} } }, innerWidth: 1400, innerHeight: 900, devicePixelRatio: 1, fetch: fetchImpl, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout, getComputedStyle: () => ({ getPropertyValue: () => '' }), scrollTo() {}, open() {}, alert() {}, confirm: () => true, prompt: () => '', print() {}, setTimeout, clearTimeout, setInterval, clearInterval, console, URL, URLSearchParams, Blob, TextEncoder, TextDecoder, AbortController, Date, Math, JSON, Intl, Promise, Map, Set, Number, String, Array, Object, RegExp, Error, encodeURIComponent, decodeURIComponent, isNaN, isFinite, parseInt, parseFloat, Image: El, FileReader: El, CustomEvent: class {}, Event: class {}, structuredClone };
win.window = win; win.self = win; win.globalThis = win; win.top = win;
win.CSS = { escape: (s) => s }; win.ResizeObserver = class { observe() {} disconnect() {} }; win.IntersectionObserver = class { observe() {} disconnect() {} }; win.MutationObserver = class { observe() {} disconnect() {} };
win.HTMLElement = El; win.Element = El; win.Node = El;
const ctx = vm.createContext(win);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const s of [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/\?.*$/, ''))) vm.runInContext(fs.readFileSync(path.join(ROOT, s), 'utf8'), ctx, { filename: s });
const FF = win.FF;
await fetchImpl('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.SMOKE_USER || 'admin', password: process.env.SMOKE_PASS || 'admin123' }) });
await FF.auth.init();
await FF.app.onLogin(true);
await new Promise((r) => setTimeout(r, 300));
const root = () => { const r = new El('main'); body.appendChild(r); return r; };
const allHtml = () => [...REG.values()].map((e) => e.innerHTML).concat(body.children.map((c) => c.innerHTML)).join('\n');
// ---- data probes (no page render) ---------------------------------------------------------------
if (process.env.PROBE) {
  const probe = process.env.PROBE;
  const out = {};
  if (probe === 'payout') {
    const d = await FF.cockpit.payoutRecon();
    out.totals = d.totals; out.first = d.rows[0]; out.gvFirst = d.gvRows[0]; out.rows = d.rows.length;
  } else if (probe === 'alerts') {
    const list = await FF.cockpit.commissionAlerts();
    out.alerts = list.map((a) => ({ id: a.id, sev: a.severity, count: a.count }));
  } else if (probe === 'dispatch') {
    const d = await FF.cockpit.dispatchPlan({ horizon: 7 });
    out.totals = d.totals; out.first = d.rows[0] && { name: d.rows[0].name, need: d.rows[0].need, boxes: d.rows[0].boxes, classes: d.rows[0].classes };
  } else if (probe === 'scorecard') {
    const d = await FF.cockpit.tlScorecard();
    out.month = d.month; out.rows = d.rows.length; out.top = d.rows.slice(0, 3).map((r) => ({ tl: r.tl, ch: r.channel, score: Number(r.score.toFixed(1)), grade: r.grade, agents: r.agents, active: r.active, issuance: r.issuance, commission: Number(r.commission.toFixed(2)), focus: r.focus.slice(0, 2) }));
  } else if (probe === 'agent360') {
    await FF.pages.performance.ensureLoaded();
    const agents = FF.pages.performance.agents();
    const target = process.env.AGENT ? agents.find((a) => new RegExp(process.env.AGENT, 'i').test(a.name)) : agents[0];
    const res = await FF.cockpit.agent360({ name: target.name, id: target.agentId || target.id });
    out.agent = res && res.displayName; out.blocks = res && res.blocks; out.csv = res && res.rows.length;
    const dh = (REG.get('drawer-body') && REG.get('drawer-body').innerHTML) || '';
    out.drawer = dh.length;
    out.drawerSections = (dh.match(/class="dsec"/g) || []).length;
    out.drawerTables = (dh.match(/<table/g) || []).length;
    out.drawerKpis = (dh.match(/class="dkpi"/g) || []).length;
    out.drawerHas = ['Agent 360', 'blocker', 'Issuance trend', 'Class split', 'Data quality', 'Cross-channel', 'Notes & follow-ups'].filter((t) => new RegExp(t, 'i').test(dh));
    if (process.env.DRAWERDUMP) console.log(dh.replace(/\s+/g, ' ').slice(0, Number(process.env.DRAWERDUMP)));
  }
  console.log(JSON.stringify(out, null, 2).slice(0, Number(process.env.LIMIT || 3000)));
  process.exit(0);
}

const p = process.env.PAGE || 'dashboard';
const r = root();
let failed = false;
try { await FF.pages[p].render(r, JSON.parse(process.env.PARAMS || '{}'), {}); }
catch (e) { console.log(`RENDER ERROR ${p}: ${e.message}`); failed = true; }
await new Promise((x) => setTimeout(x, Number(process.env.SETTLE || 400)));
const h = allHtml();
const tone = [...h.matchAll(/data-tone="(g\d+)"/g)].map((m) => m[1]);
const kpi = [...h.matchAll(/class="kpi (g\d+)"/g)].map((m) => m[1]);
console.log(`${p}: ${failed ? 'FAILED ' : ''}tone=${tone.length} classic-kpi=${kpi.length} tables=${(h.match(/<table/g) || []).length} rows=${(h.match(/<tr/g) || []).length} csv=${(h.match(/csv"/g) || []).length} bytes=${h.length}`);
if (process.env.LABELS) {
  const labels = [...new Set([...h.matchAll(/<small>([^<]{2,42})<\/small>/g)].map((m) => m[1]))];
  console.log('  labels:', labels.slice(0, 20).join(' | '));
}
if (process.env.GREP) {
  const re = new RegExp(process.env.GREP, 'g');
  console.log('  matched:', (h.match(re) || []).length, re.source);
}
if (process.env.DUMP) console.log('  >>>', (r.innerHTML || h).replace(/\s+/g, ' ').slice(0, Number(process.env.DUMP)));
if (process.env.DUMPREG) console.log('  REG>>>', allHtml().replace(/\s+/g, ' ').slice(0, Number(process.env.DUMPREG)));
process.exit(failed ? 1 : 0);
