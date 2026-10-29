import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const a = src.indexOf('  function loadWelcome() {');
const b = src.indexOf('  function refreshCachedReport()', a);
assert.ok(a > 0 && b > a);
const code = src.slice(a, b);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness(payload, ok = true) {
  const retry = { addEventListener(_, cb) { this.click = cb; } };
  const buttons = [], tabs = [];
  const card = { isConnected: true, innerHTML: '', querySelector: () => retry, querySelectorAll: () => buttons };
  const holder = { querySelector(sel) { if (sel === '[data-pl-welcome]') return card; if (sel.includes('data-pl-tab="issuance"') || sel.includes('data-pl-tab="calendar"')) return {}; return null; } };
  let response = { ok, headers: { get: () => 'application/json' }, json: async () => payload };
  const fetch = async () => response;
  const run = new Function('holder', 'curCh', 'location', 'embed', 'fetch', 'activateTab', `${code}; return loadWelcome;`)(holder, 'ff', { pathname: '/p/test' }, false, fetch, (tab) => tabs.push(tab));
  return { card, retry, run, setResponse: (r) => { response = r; } };
}
test('welcome shows bounded EIR history, permitted resources, and escapes names', async () => {
  const h = harness({ ok: true, team: true, today: '2026-10-29', through: '2026-10-28', month: '2026-10', stale: true, rows: [
    { name: '<img>', source: 'ff', first: '2026-10-02', month: 3 },
    { name: 'Old Agent', source: 'ff', first: '2020-01-01', month: 200 },
    { name: 'No Record', source: 'ff', first: '', month: 0 }
  ] });
  h.run(); await tick(); await tick();
  assert.match(h.card.innerHTML, /&lt;img&gt;/); assert.doesNotMatch(h.card.innerHTML, /<img>/);
  assert.match(h.card.innerHTML, /No Record/); assert.doesNotMatch(h.card.innerHTML, /Old Agent/);
  assert.match(h.card.innerHTML, /not a joining date/); assert.match(h.card.innerHTML, /stale snapshot/);
  assert.match(h.card.innerHTML, /data-welcome-tab="calendar"/); assert.doesNotMatch(h.card.innerHTML, /data-welcome-tab="stock"/);
});
test('failed history is not represented as zero and retry can recover', async () => {
  const h = harness({}, false); h.run(); await tick(); await tick();
  assert.match(h.card.innerHTML, /could not be loaded/); assert.doesNotMatch(h.card.innerHTML, /0 tags/);
  h.setResponse({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, team: false, today: '2026-10-29', month: '2026-10', through: '2026-10-28', rows: [{ name: 'Agent', source: 'ff', first: '', month: 0 }] }) });
  h.retry.click(); await tick(); await tick();
  assert.match(h.card.innerHTML, /No record found/); assert.match(h.card.innerHTML, /0 tags/);
});
