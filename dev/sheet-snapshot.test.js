/* v3.125.50 — sheet snapshot: browser me pichhla result turant, naya peeche se + 'ff:data-fresh'. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const events = [];
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.dispatchEvent = (e) => { events.push(e.type); return true; };
globalThis.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.location = { hash: '#/home', href: '', origin: 'http://x' };
globalThis.document = { documentElement: { dataset: {}, style: { setProperty() {} } }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {}, classList: { add() {}, remove() {} } } };
// tiny in-memory IndexedDB
const store = new Map();
const req = (fn) => { const r = {}; setTimeout(() => { r.result = fn(); r.onsuccess && r.onsuccess(); }, 0); return r; };
globalThis.indexedDB = { open() { const r = {}; setTimeout(() => { r.result = { transaction: () => { const tx = { objectStore: () => ({ get: (k) => req(() => store.get(k)), put: (v, k) => { store.set(k, v); }, clear: () => store.clear() }) }; return tx; }, createObjectStore() {} }; r.onsuccess && r.onsuccess(); }, 0); return r; } };
['config', 'util', 'data'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
FF.auth = { user: { username: 'admin' } };
FF.config._applied = true;

test('second load returns the saved table instantly and refreshes in the background', async () => {
  let calls = 0, slow = false;
  const body = (n) => `google.visualization.Query.setResponse({"version":"0.6","status":"ok","table":{"cols":[{"id":"A","label":"X","type":"number"}],"rows":[{"c":[{"v":${n}}]}]}});`;
  globalThis.fetch = async () => { calls++; if (slow) await new Promise((r) => setTimeout(r, 80)); return { ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => body(calls) }; };
  const t1 = await FF.data.query('EIR', 'select count(A)');
  assert.equal(t1.rows[0][0].v, 1);
  await new Promise((r) => setTimeout(r, 10));
  FF.data.clearCache();                       // jaise page reload
  slow = true;
  const start = Date.now();
  const t2 = await FF.data.query('EIR', 'select count(A)');
  assert.ok(Date.now() - start < 60, 'snapshot served without waiting for the network');
  assert.equal(t2.stale, true); assert.equal(t2.rows[0][0].v, 1);
  await new Promise((r) => setTimeout(r, 1200));
  assert.ok(events.includes('ff:data-fresh'));
  const t3 = await FF.data.query('EIR', 'select count(A)');
  assert.equal(t3.rows[0][0].v, 2, 'fresh data after background refresh');
});
