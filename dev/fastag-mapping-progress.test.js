/* 📊 v3.72 — FASTag Mapping ke live counters + rate-limit behaviour (client).
   Requirements:
     • Screen par lagataar dikhe ki kitne mapping ho gaye (done/total, success/failed, %, ETA),
     • mapping batch 25 rows ka ho (har batch par counters update),
     • mapping API 429 de to row "retryable" ho aur retry pass me dobara bheji jaaye,
     • Google rate limit par lookup bina HTML page ke saaf message + "🔁 Dobara try" button de. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(ROOT, 'fastagMapping.js'), 'utf8');

const letters = 'ABCDEFGHIJKLM'.split('');
const labels = { A: 'STOCK_ID', C: 'TAG_ID', D: 'BARCODE', E: 'TAG_CLASS', H: 'AGENT_ID', I: 'AGENT_NAME', K: 'TL_NAME' };
const cell = (v) => (v == null || v === '' ? null : { v, f: String(v) });
// D.parseGviz table.rows ko array-of-cells banata hai (row[colIndex]) — mock me bhi wahi shape.
const table = (rows) => ({ cols: letters.map((id) => ({ id, label: labels[id] || id, type: 'string' })), rows: rows.map((r) => letters.map((L) => cell(r[L]))) });

/** Dummy StockDataa: har `D = "value"` ke liye ek alag row. */
function stockFromQuery(tq) {
  const values = [...tq.matchAll(/\bD\s*=\s*(?:"([^"]*)"|(\d+))/gi)].map((m) => m[1] !== undefined ? m[1] : m[2]);
  const rows = values.map((v, i) => ({ A: 'S' + i, B: 'inv', C: 'TAG-' + v.slice(-4), D: v, E: '4', F: 'RFID', G: '', H: 'OLD-AGENT', I: 'Old', J: '', K: 'TL' }));
  const page = tq.match(/where\s+D\s+is\s+not\s+null\s+limit\s+(\d+)\s+offset\s+(\d+)/i);
  if (page) return table(Number(page[2]) === 0 ? [] : []);
  return table(rows);
}

function makePage(opts = {}) {
  const queryLog = [];
  const requests = { lookup: 0, map: [], index: 0, status: 0 };
  const mapPlans = (opts.mapPlans || []).slice();
  const selectors = new Map();
  const fakeNode = () => ({ value: '', innerHTML: '', textContent: '', className: '', disabled: false, files: [], checked: false });
  for (const sel of ['#fm-api-status', '#fm-index-status', '#fm-message', '#fm-summary', '#fm-results', '#fm-progress',
    '#fm-lookup', '#fm-map', '#fm-kind', '#fm-identifier', '#fm-agent-id', '#fm-first', '#fm-last', '#fm-range-agent',
    '#fm-file', '#fm-file-note']) selectors.set(sel, fakeNode());
  const root = {
    innerHTML: '',
    handlers: {},
    querySelector(sel) { if (!selectors.has(sel)) selectors.set(sel, fakeNode()); return selectors.get(sel); },
    querySelectorAll() { return []; },
    addEventListener(type, cb) { this.handlers[type] = cb; }
  };
  const rateState = { active: false, blockedSec: 30, hits: 0 };
  const D = {
    async query(sheet, tq) {
      queryLog.push(tq);
      return stockFromQuery(tq);
    },
    cellText(c) { return c && c.v != null ? String(c.v) : ''; },
    textRows(t) { return (t.rows || []).map((row) => (row.c || []).map((c) => (c && c.v != null ? String(c.f != null ? c.f : c.v) : ''))); },
    rateLimitStatus: () => ({ hits: rateState.hits, lastAt: 0, active: rateState.active, blockedSec: rateState.blockedSec, directBlockedSec: 0 })
  };
  const jsonRes = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => obj, text: async () => JSON.stringify(obj) });
  const fetchImpl = async (url, init) => {
    const path_ = String(url);
    if (path_.includes('/api/fastag-mapping/status')) { requests.status++; return jsonRes({ ok: true, configured: true, index: { ready: true, building: false, rows: 120 }, rateLimited: rateState.active }); }
    if (path_.includes('/api/fastag-mapping/index-status')) { requests.index++; return jsonRes({ ok: true, ready: true, building: false, rows: 120, ageSec: 3 }); }
    if (path_.includes('/api/fastag-mapping/lookup')) { requests.lookup++; return jsonRes({ error: 'missing' }, 404); }   // legacy → client fallback
    if (path_.includes('/api/fastag-mapping/map')) {
      const body = JSON.parse(init.body);
      requests.map.push(body.rows);
      const plan = mapPlans.length ? mapPlans.shift() : { ok: true, results: body.rows.map((_, i) => ({ index: i, success: true, status: 'Success', message: 'Mapped' })) };
      if (plan.status) return jsonRes(plan.body || {}, plan.status);
      return jsonRes(plan);
    }
    return jsonRes({}, 404);
  };
  const U = {
    $: (sel, r) => r.querySelector(sel),
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmt: (v) => Number(v || 0).toLocaleString('en-IN'),
    stamp: () => 'test',
    downloadCsv: () => {}
  };
  const FF = {
    util: U, data: D,
    config: { stock: { id: 'A', name: 'B', tagId: 'C', barcode: 'D', cls: 'E', tagType: 'F', bcAllocatedAt: 'G', agentId: 'H', agentName: 'I', agentAllocatedAt: 'J', tlName: 'K' } },
    pages: {}
  };
  const sandbox = {
    window: { FF }, fetch: fetchImpl, confirm: () => true,
    // Timers ko microtask banao: tests fast rehte hain par awaited delays resolve ho jaate hain.
    setTimeout: (fn) => { Promise.resolve().then(() => { try { fn(); } catch { /* test ke bahar ka kaam */ } }); return 0; },
    clearTimeout: () => {},
    Blob, URL, TextEncoder, TextDecoder, DataView, Uint8Array, Response, DecompressionStream, BigInt, console
  };
  vm.runInNewContext(source, sandbox, { filename: 'fastagMapping.js' });
  FF.pages.fastagMapping.render(root);
  return { root, selectors, FF, queryLog, requests, rateState };
}
async function click(root, id) {
  await root.handlers.click({ target: { closest: () => ({ id, hasAttribute: () => false, dataset: {} }) } });
}
const uploadCsv = async (root, selectors, csv) => {
  selectors.get('#fm-file').files = [{ name: 'rows.csv', text: async () => csv }];
  await click(root, 'fm-upload-add');
};

test('live counters: mapping ke dauraan done/total + success/failed screen par update hote hain (25-row batches)', async () => {
  const { root, selectors, requests } = makePage();
  const csv = ['barcode,agentId'].concat(Array.from({ length: 30 }, (_, i) => `8900000000${String(1000 + i)},AGT-${i}`)).join('\n');
  await uploadCsv(root, selectors, csv);
  await click(root, 'fm-lookup');
  assert.match(selectors.get('#fm-progress').innerHTML, /StockDataa lookup/, 'lookup ka live counter dikhta hai');

  await click(root, 'fm-map');
  const html = selectors.get('#fm-progress').innerHTML;
  assert.match(html, /Mapped \/ done/, 'success counter');
  assert.match(html, /Failed/, 'failed counter');
  assert.match(html, /30\s*\/\s*30|30 \/ 30/, 'done == total');
  assert.match(html, /100%/, 'progress 100%');
  assert.match(html, /Mapping complete/, 'summary line');
  assert.equal(requests.map.length, 2, '30 rows = 25 + 5 ke do batch');
  assert.equal(requests.map[0].length, 25, 'pehla batch 25 rows');
  assert.equal(requests.map[1].length, 5, 'doosra batch 5 rows');
  assert.equal(requests.map.flat().length, 30, 'sab rows API par gayi');
});

test('mapping API 429: rows retryable mark hote hain aur retry pass me dobara bheji jaati hain', async () => {
  const plans = [
    { status: 429, body: { error: 'Mapping API rate limit (429 Too Many Requests)', rateLimited: true } },
    { ok: true, results: [{ index: 0, success: true, status: 'Success', message: 'Mapping successful' }] }
  ];
  const { root, selectors, requests } = makePage({ mapPlans: plans });
  await uploadCsv(root, selectors, 'barcode,agentId\n8900000000111111,AGT-1');
  await click(root, 'fm-lookup');
  await click(root, 'fm-map');
  assert.equal(requests.map.length, 2, 'pehli call 429, retry pass me dobara');
  assert.equal(requests.map[1].length, 1, 'retry pass wahi row bhejta hai');
  const html = selectors.get('#fm-progress').innerHTML;
  assert.match(html, /Mapping complete/, 'retry ke baad complete');
  assert.match(html, /Mapped \/ done <b>1<\/b>/, 'retry se success ginti 1');
});

test('Google rate limit par lookup saaf message + retry button deta hai (HTML page nahi)', async () => {
  const { root, selectors, rateState } = makePage();
  rateState.active = true;
  selectors.get('#fm-kind').value = 'barcode';
  selectors.get('#fm-identifier').value = '8900000000999999';
  selectors.get('#fm-agent-id').value = 'AGT-RL';
  await click(root, 'fm-add-single');
  await click(root, 'fm-lookup');
  const progress = selectors.get('#fm-progress').innerHTML;
  assert.match(progress, /rate limit/i, 'rate limit message progress panel me');
  assert.match(progress, /fm-retry|Dobara try/, 'retry button dikhta hai');
  assert.doesNotMatch(progress, /<html|normalize\.css/i, 'Google ka HTML kabhi nahi');
  assert.match(selectors.get('#fm-message').textContent, /rate limit|Lookup fail/i, 'status line bhi saaf');
  assert.match(selectors.get('#fm-message').textContent, /queue me wapas/, 'inputs queue me safe');
});
