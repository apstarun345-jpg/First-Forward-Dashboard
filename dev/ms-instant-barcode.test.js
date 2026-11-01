/* Barcode Enter must dispatch immediately and repaint without a second keypress.
   Run the real util/masterSearch event handlers in a tiny DOM (no browser/test dependency). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scripts = ['config', 'util', 'masterSearch'].map((name) => [name, fs.readFileSync(new URL(`../${name}.js`, import.meta.url), 'utf8')]);
const BAR = '608116-011-0558357', NEXT = '608116-039-0119734';
const hit = (barcode = BAR, agent = 'Ravi Kumar', ch = 'ff') => ({ ch, barcode, tagId: '34161FA820328EE84F0CE500', cls: 'VC4', agent, agentId: 'R101', tl: 'TL One', date: '2026-10-20' });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness(t, { api = async () => ({ ok: true, rows: [] }), query = async () => ({ rows: [] }), coldPeople = false } = {}) {
  const timers = new Set();
  const later = (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; };
  const cancel = (timer) => { clearTimeout(timer); timers.delete(timer); };
  t.after(() => timers.forEach(clearTimeout));
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  class El {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.style = { setProperty() {}, removeProperty() {} };
      this.attrs = {}; this.dataset = {}; this.events = new Map(); this.children = []; this.cache = new Map();
      this.value = ''; this.hidden = false; this.isConnected = true; this._html = ''; this.parentNode = null;
      const classes = new Set();
      this.classList = { add: (...xs) => xs.forEach((x) => classes.add(x)), remove: (...xs) => xs.forEach((x) => classes.delete(x)), contains: (x) => classes.has(x), toggle(x, on = !classes.has(x)) { on ? classes.add(x) : classes.delete(x); } };
    }
    set innerHTML(html) { this.cache.forEach((el) => { el.isConnected = false; }); this.cache.clear(); this._html = String(html); }
    get innerHTML() { return this._html; }
    get content() { return { firstElementChild: fromTag((this._html.match(/<[a-z][^>]*>/i) || ['<div>'])[0], this._html) }; }
    get firstChild() { return this.children[0] || null; }
    querySelector(sel) {
      if (this.cache.has(sel)) return this.cache.get(sel);
      for (const child of this.children) { if (sel === '#' + child.id) return child; const found = child.querySelector(sel); if (found) return found; }
      const matches = (tag) => sel[0] === '#' ? tag.includes(`id="${sel.slice(1)}"`)
        : sel[0] === '.' ? (tag.match(/class="([^"]*)"/) || ['', ''])[1].split(/\s+/).includes(sel.slice(1))
          : sel[0] === '[' ? tag.includes(sel.slice(1, -1)) : new RegExp(`^<${sel}(?:\\s|>)`, 'i').test(tag);
      const tag = (this._html.match(/<[a-z][^>]*>/gi) || []).find(matches);
      if (!tag) return null;
      const el = fromTag(tag); el.parentNode = this; this.cache.set(sel, el); return el;
    }
    querySelectorAll() { return []; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.classList.add(...String(v).split(/\s+/)); if (k === 'value') this.value = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
    removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
    fire(type, data = {}) { const e = { target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...data }; this.events.get(type)?.forEach((fn) => fn(e)); return e; }
    dispatchEvent(e) { this.fire(e.type, e); }
    appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
    insertBefore(el) { return this.appendChild(el); }
    insertAdjacentElement(_, el) { return this.appendChild(el); }
    remove() { this.isConnected = false; this.cache.forEach((el) => { el.isConnected = false; }); if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((el) => el !== this); }
    contains(el) { return this === el || this.children.includes(el); }
    closest() { return null; }
    focus() { doc.activeElement = this; this.fire('focus'); }
    getBoundingClientRect() { return { top: 20, bottom: 60, left: 20, width: 400 }; }
    scrollIntoView() {}
  }
  function fromTag(tag, html = '') {
    const el = new El((tag.match(/^<([a-z]+)/i) || ['', 'div'])[1]); el._html = html;
    for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(m[1], decode(m[2]));
    el.hidden = /\shidden(?:\s|>)/.test(tag); return el;
  }
  const doc = { body: new El('body'), documentElement: new El('html'), activeElement: null, addEventListener() {}, removeEventListener() {}, createElement: (tag) => new El(tag), querySelector: (sel) => doc.body.querySelector(sel), querySelectorAll: () => [], getElementById: (id) => doc.body.querySelector('#' + id) };
  const ls = new Map();
  const context = { console, document: doc, setTimeout: later, clearTimeout: cancel, requestAnimationFrame: (fn) => fn(), addEventListener() {}, removeEventListener() {}, localStorage: { getItem: (k) => ls.get(k) || null, setItem: (k, v) => ls.set(k, String(v)) }, location: { hash: '#/home' }, Event: class { constructor(type) { this.type = type; } }, URLSearchParams };
  context.window = context;
  vm.createContext(context);
  for (const [name, source] of scripts.slice(0, 2)) vm.runInContext(source, context, { filename: `${name}.js` });
  const FF = context.FF, blocked = new Promise(() => {}), need = () => coldPeople ? blocked : Promise.resolve([]);
  FF.store = { need, get: () => [] };
  FF.gv = { need, get: () => [], normClass: (c) => c };
  FF.data = { query, cellText: (c) => String(c?.v || ''), identifierText: (c) => String(c?.v || '') };
  FF.auth = { api, can: () => true };
  const navigations = [];
  FF.app = { navigate: (...args) => navigations.push(args), enhanceTables() {} };
  vm.runInContext(scripts[2][1], context, { filename: 'masterSearch.js' });
  FF.masterSearch._limits.lightSoftMs = 1000;
  return { FF, doc, El, navigations };
}

test('cold barcode lookup starts synchronously, without the people or full register', async (t) => {
  const response = deferred(), calls = [], sql = [];
  const { FF } = harness(t, { coldPeople: true, api: (url) => { calls.push(url); return response.promise; }, query: async (...args) => { sql.push(args); return { rows: [] }; } });
  const first = FF.masterSearch.search(BAR);
  assert.equal(FF.masterSearch.ready, false);
  assert.equal(calls.length, 1, 'dispatch in the same Enter call, not after buildLight');
  assert.equal(first.livePending, true);
  assert.doesNotMatch(FF.masterSearch.resultsHtml(first), /kuch nahi mila/);
  response.resolve({ ok: true, rows: [hit(), hit(BAR, 'GV Ravi', 'gv')] });
  await tick();
  const result = FF.masterSearch.search(BAR.replace(/-/g, ''));
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0].ff[0].agentName, 'Ravi Kumar');
  assert.equal(result.tags[0].gv[0].agentName, 'GV Ravi');
  assert.equal(result.livePending, false);
  assert.equal(calls.length, 1, 'dashed/digits-only repeat uses the same cache');
  assert.equal(sql.length, 0, 'warm index hit needs no Google query');
  assert.equal(FF.masterSearch.heavyReady, false);
});

test('Enter on a loading/no-match row submits the barcode, never the placeholder label', (t) => {
  const { FF, El } = harness(t), input = new El('input'), entered = [], picked = [];
  input.value = BAR;
  const suggest = FF.util.suggest(input, { items: [{ label: `“${BAR}” dhoondh raha hu…`, none: true }], onEnter: (q) => entered.push(q), onPick: (it) => picked.push(it) });
  suggest.refresh(); input.fire('keydown', { key: 'Enter' });
  assert.deepEqual(entered, [BAR]); assert.deepEqual(picked, []);
  assert.equal(input.value, BAR); assert.equal(suggest._box.hidden, true);
});

test('scanner Enter before the 80ms debounce submits current text, not an old result', async (t) => {
  const { FF, El } = harness(t), input = new El('input'), entered = [], picked = [];
  input.value = BAR;
  const suggest = FF.util.suggest(input, { items: [{ label: BAR }], onEnter: (q) => entered.push(q), onPick: (it) => picked.push(it) });
  suggest.refresh(); input.value = NEXT; input.fire('input'); input.fire('keydown', { key: 'Enter' });
  assert.deepEqual(entered, [NEXT]); assert.deepEqual(picked, []); assert.equal(input.value, NEXT);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(suggest._box.hidden, true, 'cancelled debounce cannot reopen the dropdown');
});

test('barcode raw Enter keeps partial query; explicit arrow selection and normal name picks still work', (t) => {
  const { FF, El } = harness(t), input = new El('input'), entered = [], picked = [];
  input.value = '608116';
  const suggest = FF.util.suggest(input, { items: [{ label: BAR }, { label: NEXT }], submitOnEnter: () => true, onEnter: (q) => entered.push(q), onPick: (it) => picked.push(it.label) });
  suggest.refresh(); input.fire('keydown', { key: 'Enter' }); assert.deepEqual(entered, ['608116']);
  suggest.refresh(); input.fire('keydown', { key: 'ArrowDown' }); input.fire('keydown', { key: 'Enter' });
  assert.deepEqual(picked, [NEXT]);
  suggest.destroy(); input.value = 'Ravi';
  const names = FF.util.suggest(input, { items: [{ label: 'Ravi Kumar' }], onPick: (it) => picked.push(it.label) });
  names.refresh(); input.fire('keydown', { key: 'Enter' });
  assert.equal(picked.at(-1), 'Ravi Kumar');
});

test('topbar barcode Enter opens immediately and auto-paints the response, without navigation', async (t) => {
  const response = deferred(), calls = [];
  const { FF, doc, El, navigations } = harness(t, { coldPeople: true, api: (url) => { calls.push(url); return response.promise; } });
  const actions = new El(); actions.id = 'top-actions'; doc.body.appendChild(actions);
  assert.equal(FF.masterSearch.mountTopbar(), true);
  const input = doc.querySelector('#master-search-input');
  input.value = BAR; input.fire('input'); input.fire('keydown', { key: 'Enter' });
  assert.equal(calls.length, 1);
  const panel = doc.querySelector('#ms-panel'), body = panel.querySelector('.ms-panel-body');
  assert.match(body.innerHTML, /barcode dhoondha/);
  assert.equal(navigations.length, 0, 'do not lazy-load profile/report pages for a barcode');
  response.resolve({ ok: true, rows: [hit()] }); await tick();
  assert.match(body.innerHTML, /Ravi Kumar/); assert.match(body.innerHTML, /34161FA820328EE84F0CE500/);
  assert.match(panel.querySelector('[data-ms-result-state]').textContent, /search complete/);
  const previous = body.innerHTML;
  FF.masterSearch.closePanel(); FF.masterSearch.invalidate(); await tick();
  assert.equal(body.innerHTML, previous, 'closed panel unsubscribes from index updates');
  assert.equal(calls.length, 1);
});

test('page/deep-link barcode lookup paints without awaiting light index and ignores an older response', async (t) => {
  const first = deferred(), second = deferred(), calls = [];
  const { FF, doc, El } = harness(t, { coldPeople: true, api: (url) => { calls.push(url); return calls.length === 1 ? first.promise : second.promise; } });
  const root = new El(); doc.body.appendChild(root);
  FF.pages.masterSearch.render(root, { q: BAR });
  assert.equal(calls.length, 1); assert.equal(FF.masterSearch.ready, false);
  const input = root.querySelector('#msp-q'), out = root.querySelector('#msp-out');
  assert.match(out.innerHTML, /barcode dhoondha/);
  input.value = NEXT; input.fire('input'); input.fire('keydown', { key: 'Enter' });
  assert.equal(calls.length, 2, 'new Enter dispatches immediately');
  first.resolve({ ok: true, rows: [hit(BAR, 'Old Holder')] }); await tick();
  assert.doesNotMatch(out.innerHTML, /Old Holder/);
  second.resolve({ ok: true, rows: [hit(NEXT, 'Current Holder')] }); await tick();
  assert.match(out.innerHTML, /Current Holder/); assert.doesNotMatch(out.innerHTML, /Old Holder|kuch nahi mila/);
});

test('late server hit is not discarded after prompt fallback has started', async (t) => {
  const response = deferred(), sheets = deferred(), calls = [];
  const { FF } = harness(t, { api: () => response.promise, query: (...args) => { calls.push(args); return sheets.promise; } });
  FF.masterSearch._limits.liveFallbackMs = 5;
  FF.masterSearch.search(BAR);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(calls.length, 2, 'FF + GV fallback, no EIR for barcode');
  response.resolve({ ok: true, rows: [hit()] }); await tick();
  assert.equal(FF.masterSearch.search(BAR).tags[0].ff[0].agentName, 'Ravi Kumar');
  assert.equal(FF.masterSearch.search(BAR).livePending, false, 'do not wait for slower sheets');
  sheets.resolve({ rows: [] }); await tick();
  assert.equal(FF.masterSearch.search(BAR).tags.length, 1);
});

test('invalidate clears barcode cache; failed lookups can retry instead of sticking forever', async (t) => {
  let available = false, count = 0;
  const { FF } = harness(t, { api: async () => { count++; return available ? { ok: true, rows: [hit()] } : { ok: true, pending: true }; }, query: async () => { throw new Error('temporarily offline'); } });
  FF.masterSearch._limits.liveRetryMs = 0;
  FF.masterSearch.search(BAR); await tick();
  available = true;
  assert.equal(FF.masterSearch.search(BAR).livePending, true); await tick();
  assert.equal(FF.masterSearch.search(BAR).tags.length, 1); assert.equal(count, 2);
  FF.masterSearch.invalidate(); FF.masterSearch.search(BAR); await tick();
  assert.equal(count, 3, 'index refresh must also clear per-barcode cache');
});


test('an empty fast fallback cannot finish the search before a late index hit', async (t) => {
  const response = deferred();
  const { FF, doc, El } = harness(t, { api: () => response.promise });
  FF.masterSearch._limits.liveFallbackMs = 5;
  FF.masterSearch.openPanel(BAR);
  const body = doc.querySelector('#ms-panel').querySelector('.ms-panel-body');
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(FF.masterSearch.search(BAR).livePending, true);
  assert.doesNotMatch(body.innerHTML, /kuch nahi mila/);
  response.resolve({ ok: true, rows: [hit()] }); await tick();
  assert.match(body.innerHTML, /Ravi Kumar/);
});


test('country-code mobile and legacy agent IDs keep the normal profile route', async (t) => {
  const { FF, navigations } = harness(t);
  for (const q of ['+91 98765 43210', '919876543210', '537700000000000001']) {
    assert.equal(FF.masterSearch.openSearchPage(q), true);
    assert.equal(navigations.at(-1)[0], 'masterSearch');
    assert.equal(navigations.at(-1)[1].q, q);
  }
  FF.store.need = async (kind) => kind === 'agents' ? [{ name: 'Known Agent', id: '123456789012', tlName: 'TL One' }] : [];
  await FF.masterSearch.buildLight();
  FF.masterSearch.openSearchPage('123456789012');
  assert.equal(navigations.at(-1)[1].q, '123456789012', 'known long agent ID is not mistaken for a barcode');
});


test('a ready channel in a partial server index is visible while the other channel loads', async (t) => {
  const gv = deferred();
  const { FF, doc } = harness(t, { api: async () => ({ ok: true, pending: true, rows: [hit()] }), query: (sheet) => sheet === 'Tag Assignment' ? gv.promise : Promise.resolve({ rows: [] }) });
  FF.masterSearch.openPanel(BAR); await tick();
  const body = doc.querySelector('#ms-panel').querySelector('.ms-panel-body');
  assert.match(body.innerHTML, /Ravi Kumar/);
  assert.equal(FF.masterSearch.search(BAR).livePending, true);
  gv.resolve({ rows: [] }); await tick();
  assert.equal(FF.masterSearch.search(BAR).livePending, false);
  assert.match(body.innerHTML, /Ravi Kumar/);
});


test('choosing a quick person chip cancels a pending barcode result repaint', async (t) => {
  const response = deferred();
  const { FF, doc, El } = harness(t, { api: () => response.promise });
  FF.store.need = async (kind) => kind === 'agents' ? [{ name: 'Selected Agent', id: 'R101' }] : [];
  await FF.masterSearch.buildLight();
  const root = new El(); doc.body.appendChild(root);
  FF.pages.masterSearch.render(root, { q: BAR });
  const out = root.querySelector('#msp-out'), chip = root.querySelector('#msp-quick').querySelector('[data-msp-name]');
  root.fire('click', { target: { closest: (sel) => sel === '[data-msp-name]' ? chip : null } });
  assert.match(out.innerHTML, /Selected Agent/);
  response.resolve({ ok: true, rows: [hit(BAR, 'Old Barcode Holder')] }); await tick();
  assert.match(out.innerHTML, /Selected Agent/); assert.doesNotMatch(out.innerHTML, /Old Barcode Holder/);
});

test('digits-only barcode still appears when suggestion label is formatted with dashes', async (t) => {
  const { FF, El } = harness(t, { api: async () => ({ ok: true, rows: [hit()] }) });
  FF.masterSearch.search(BAR); await tick();
  const input = new El('input'); input.value = BAR.replace(/-/g, '');
  const suggest = FF.util.suggest(input, { items: () => FF.masterSearch.suggestItems(input.value) });
  suggest.refresh();
  assert.match(suggest._box.innerHTML, /Ravi Kumar/); assert.doesNotMatch(suggest._box.innerHTML, /Koi match nahi/);
});
