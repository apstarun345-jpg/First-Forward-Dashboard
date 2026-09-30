#!/usr/bin/env node
/* 🌐 i18n vocabulary harvester — har page ka real rendered HTML collect karta hai aur
   user-dekhne wale text strings nikalta hai. Seede dictionary banane ke liye.

   Usage: node dev/harvest-i18n.js [baseUrl]   (server 8080 + mock 9099 chal raha hona chahiye) */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:8080';
let cookie = '';
const REG = new Map();
class ClassList { constructor() { this.s = new Set(); } add(...c) { c.forEach((x) => this.s.add(x)); } remove(...c) { c.forEach((x) => this.s.delete(x)); } toggle(c, f) { if (f === undefined) f = !this.s.has(c); f ? this.s.add(c) : this.s.delete(c); return f; } contains(c) { return this.s.has(c); } }
class El {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this._html = ''; this.children = []; this.classList = new ClassList(); this.dataset = {}; this.style = { setProperty() {}, removeProperty() {} }; this.attrs = {}; this.value = ''; this.checked = false; this.hidden = false; this.files = []; this.parentNode = null; this.listeners = {}; this.disabled = false; this.textContent = ''; }
  get innerHTML() { return this._html; } set innerHTML(v) { this._html = String(v); this.children = []; }
  get outerHTML() { return this._html; } get isConnected() { return true; } get childNodes() { return this.children; }
  get content() { const f = new El('fragment'); f.children = [new El('div')]; return f; }
  get firstElementChild() { return this.children[0] || new El(); } get nextElementSibling() { return new El(); }
  get offsetWidth() { return 800; } get offsetHeight() { return 400; } get clientWidth() { return 800; } get scrollWidth() { return 800; }
  getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 400, bottom: 400, right: 800 }; }
  querySelector(sel) { const m = /^#([\w-]+)$/.exec(sel || ''); if (m) { let e = REG.get(m[1]); if (!e) { e = new El(); e.id = m[1]; REG.set(m[1], e); } e.parentNode = this; return e; } const e = new El(); e.parentNode = this; return e; }
  querySelectorAll() { return []; } getElementsByTagName() { return []; } closest() { return null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); } removeEventListener() {} dispatchEvent() { return true; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; } append(...c) { c.forEach((x) => typeof x === 'object' && this.appendChild(x)); }
  prepend(c) { this.children.unshift(c); } insertBefore(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); } replaceChildren(...c) { this.children = []; c.forEach((x) => this.appendChild(x)); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); } replaceWith() {}
  insertAdjacentHTML(_, h) { this._html += h; } insertAdjacentElement(_, e) { this.appendChild(e); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; } hasAttribute(k) { return k in this.attrs; }
  focus() {} blur() {} click() {} select() {} scrollIntoView() {} scrollTo() {} showModal() { this.open = true; } show() { this.open = true; } close() { this.open = false; }
  contains() { return false; } matches() { return false; }
  getContext() { return { drawImage() {}, fillRect() {}, measureText: () => ({ width: 10 }) }; } toDataURL() { return 'data:image/png;base64,'; }
}
const body = new El('body'); const documentEl = new El('html');
const document = {
  body, documentElement: documentEl, title: '', hidden: false, readyState: 'complete', activeElement: null, visibilityState: 'visible',
  createElement: (t) => new El(t), createTextNode: (t) => ({ textContent: t }), createDocumentFragment: () => new El('fragment'),
  querySelector: (s) => body.querySelector(s), querySelectorAll: () => [], getElementById: (id) => body.querySelector('#' + id),
  addEventListener() {}, removeEventListener() {}, execCommand: () => true
};
const location = { hash: '#/dashboard', href: `${BASE}/#/dashboard`, origin: BASE, pathname: '/', search: '', reload() {}, replace() {} };
const storage = new Map();
const localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), clear: () => storage.clear() };
const fetchImpl = async (url, opts = {}) => {
  const abs = url.startsWith('http') ? url : BASE + url;
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(abs, { ...opts, headers, redirect: 'manual' });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return res;
};
const win = { document, location, localStorage, sessionStorage: localStorage, history: { replaceState() {}, pushState() {} }, navigator: { userAgent: 'harvest', clipboard: { writeText: async () => {} }, share: undefined }, innerWidth: 1400, innerHeight: 900, devicePixelRatio: 1, fetch: fetchImpl, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout, getComputedStyle: () => ({ getPropertyValue: () => '' }), scrollTo() {}, open() {}, alert() {}, confirm: () => true, prompt: () => '', setTimeout, clearTimeout, setInterval, clearInterval, console, URL, URLSearchParams, Blob, TextEncoder, TextDecoder, AbortController, Date, Math, JSON, Intl, Promise, Map, Set, Number, String, Array, Object, RegExp, Error, encodeURIComponent, decodeURIComponent, isNaN, isFinite, parseInt, parseFloat, Image: El, FileReader: El, CustomEvent: class {}, Event: class {}, structuredClone };
win.window = win; win.self = win; win.globalThis = win; win.top = win;
win.CSS = { escape: (s) => s };
win.ResizeObserver = class { observe() {} disconnect() {} };
win.IntersectionObserver = class { observe() {} disconnect() {} };
win.MutationObserver = class { observe() {} disconnect() {} };
win.HTMLElement = El; win.Element = El; win.Node = El;
const ctx = vm.createContext(win);
const htmlFile = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...htmlFile.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/\?.*$/, ''));
for (const s of scripts) vm.runInContext(fs.readFileSync(path.join(ROOT, s), 'utf8'), ctx, { filename: s });
const FF = win.FF;
process.stderr.write('stage: loaded scripts\n');
process.stderr.write('stage: handlers\n');

const harvest = new Set();
const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'IFRAME', 'CANVAS', 'TEMPLATE']);
/** Ek HTML string me se user-dekhne wala text nikaalo (tags, numbers, dates, emojis hata kar). */
function collect(html) {
  const s = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, '\n');
  const dec = s.replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&times;/g, '×').replace(/&rarr;/g, '→').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
  for (let raw of dec.split('\n')) {
    let t = raw.replace(/\s+/g, ' ').trim();
    if (!t || t.length < 2 || t.length > 90) continue;            // chhote/lamba noise chhod do
    if (/^[\d\s.,%+\-–—/():|]*$/.test(t)) continue;              // pure number / date / symbol
    if (/^[A-Z]{2,5}[\d%]*$/.test(t)) continue;                  // VC4, GV, FF, APS
    t = t.replace(/[│|]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length < 2) continue;
    harvest.add(t);
  }
}
const root = () => { const e = new El('div'); e.id = 'harvest-root'; REG.set('harvest-root', e); return e; };
const allHtml = () => [...REG.values()].map((e) => e.innerHTML).join('\n');

await fetchImpl('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
await FF.store.preload(false);
await FF.pages.performance.ensureLoaded().catch(() => {});
try { await FF.masterProfile.load(); } catch { /* ignore */ }
await FF.masterSearch.buildLight().catch(() => {});

const list = FF.pages.performance.agents();
const tl = (list.find((a) => !a.tlExcluded && a.tlName) || {}).tlName;
const ag = list.find((a) => !a.tlExcluded) || list[0];
const dr = list.find((a) => a.tlExcluded);

// har page + har view render karo, aur saara HTML (root + REG + drawers) collect karo
for (const key of Object.keys(FF.pages)) {
  const p = FF.pages[key];
  if (!p || typeof p.render !== 'function') continue;
  const views = [{}, { view: 'agents' }, { view: 'tls' }, { view: 'stock' }, { view: 'alerts' }, { view: 'columns' }, { view: 'accuracy' }];
  for (const v of views) {
    try { await p.render(root(), v, {}); } catch { /* page-specific params */ }
    collect(root().innerHTML); collect(allHtml());
  }
}
// drawers
try { FF.pages.performance.openAgent(ag && ag.__row); collect(allHtml()); } catch { /* ignore */ }
try { FF.pages.performance.openTl(tl); collect(allHtml()); } catch { /* ignore */ }
if (dr) { try { FF.pages.performance.openAgent(dr.__row); collect(allHtml()); } catch { /* ignore */ } }
try {
  const person = FF.masterSearch.search((ag || {}).name.slice(0, 6)).people[0];
  if (person) { const pr = await FF.masterProfile.build(person); collect(FF.masterProfile.html(pr)); }
  if (tl) { const t = await FF.masterProfile.build({ kind: 'ff-tl', name: tl, sub: '', tlSet: new Set(), classMap: new Map(), bars: new Set() }); collect(FF.masterProfile.html(t)); }
} catch { /* ignore */ }

const strings = [...harvest].sort((a, b) => a.localeCompare(b));
fs.writeFileSync(path.join(ROOT, 'dev/i18n-words.json'), JSON.stringify(strings, null, 0));
console.log(`${strings.length} unique strings harvested → dev/i18n-words.json`);
console.log(strings.slice(0, 40).join('\n'));
