/* 🚦 v3.72 — data.js ka rate-limit behaviour.
   Google 429 ("Too Many Requests" + normalize.css wala HTML page) pehle UI me raw HTML dikha deta tha
   aur browser direct Google calls karta rehta tha (aur 429 badhta rehta tha). Ab:
     • HTML page kabhi UI tak nahi jaata — saaf "rate limit" message + Retry-After,
     • 429 ke baad browser se direct Google calls band (circuit breaker), server proxy hi use hota hai,
     • proxy bhi rate limit de to query chup-chaap retry hoti hai. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(ROOT, 'data.js'), 'utf8');
const GOOGLE_429 = '<!DOCTYPE html><html><head><title>Too Many Requests</title>' +
  '<link rel="stylesheet" href="/static/error/normalize.css"></head><body><h1>Too Many Requests</h1></body></html>';
const GOOD = '/*O_o*/\ngoogle.visualization.Query.setResponse({"status":"ok","table":{"cols":[{"id":"A","label":"A","type":"string"}],"rows":[{"c":[{"v":"OK-1"}]}]}});';

function makeData(fetchImpl) {
  const calls = [];
  const sandbox = {
    window: {},
    fetch: (url, init) => { calls.push(String(url)); return fetchImpl(String(url), init); },
    AbortController, URLSearchParams, setTimeout, clearTimeout, Blob, Response, console, TextDecoder, TextEncoder
  };
  const FF = {
    util: { clean: (v) => String(v == null ? '' : v).trim(), num: (v) => Number(v) || 0, parseDate: () => null, labelDate: () => '' },
    config: {
      proxyPath: '/api/gviz', proxy: true, directFallback: true,
      sheetId: 'SHEET-ID-12345678901234567890', gvSheetId: 'GV-SHEET-ID-1234567890123456',
      sheetByName: () => ({ id: 'StockDataa', tab: 'StockDataa', gid: '0', source: 'main' }),
      gvizRateLimitRetryMs: 1   // rate-limit retry ka wait test me ~250ms (real app: Retry-After tak)
    }
  };
  sandbox.window.FF = FF;
  vm.runInNewContext(source, sandbox, { filename: 'data.js' });
  return { FF, calls };
}

const res = (status, text, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  text: async () => text
});

test('429 HTML: direct Google call fail hoti hai, proxy se data aata hai, aur HTML UI me nahi jaata', async () => {
  const { FF, calls } = makeData(async (url) => (url.startsWith('https://docs.google.com')
    ? res(429, GOOGLE_429, { 'retry-after': '2' })
    : res(200, GOOD)));
  const table = await FF.data.query('StockDataa', 'select A', { directFirst: true, fresh: true });
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0][0].v, 'OK-1');
  assert.equal(calls.filter((u) => u.startsWith('https://docs.google.com')).length, 1, 'direct ek hi baar try');
  const rl = FF.data.rateLimitStatus();
  assert.equal(rl.hits, 1);
  assert.ok(rl.directBlockedSec > 0, 'direct Google calls block ho gayi');
});

test('rate limit ke baad direct Google call dobara nahi hoti (proxy-first circuit breaker)', async () => {
  const { FF, calls } = makeData(async (url) => (url.startsWith('https://docs.google.com')
    ? res(429, GOOGLE_429, { 'retry-after': '5' })
    : res(200, GOOD)));
  await FF.data.query('StockDataa', 'select A', { fresh: true });
  const directBefore = calls.filter((u) => u.startsWith('https://docs.google.com')).length;
  await FF.data.query('StockDataa', 'select A limit 2', { fresh: true });
  const directAfter = calls.filter((u) => u.startsWith('https://docs.google.com')).length;
  assert.equal(directAfter, directBefore, 'cooldown me direct call bilkul nahi');
  assert.ok(calls.some((u) => u.startsWith('/api/gviz')), 'proxy use hota raha');
});

test('proxy bhi rate limit de to saaf RateLimitError (raw HTML kabhi nahi)', async () => {
  const { FF } = makeData(async () => res(429, GOOGLE_429, { 'retry-after': '3' }));
  let error = null;
  try { await FF.data.query('StockDataa', 'select A', { fresh: true, retries: 0 }); } catch (err) { error = err; }
  assert.ok(error, 'query fail hui');
  assert.equal(error.name, 'RateLimitError');
  assert.match(error.message, /rate limit/i);
  assert.doesNotMatch(error.message, /normalize\.css|<html|Too Many Requests<\/h1>/i, 'HTML raw message me nahi');
  assert.ok(error.retryAfterMs >= 3000, 'Retry-After aage pass hota hai');
});

test('200 ke saath HTML page aaye to bhi HTML screen par nahi (saaf message)', async () => {
  const { FF } = makeData(async () => res(200, GOOGLE_429));
  let error = null;
  try { await FF.data.query('StockDataa', 'select A', { fresh: true, retries: 0 }); } catch (err) { error = err; }
  assert.ok(error, 'query fail hui');
  assert.match(String(error.message), /HTML|rate limit|Too Many Requests/i);
  assert.ok(String(error.message).length < 400, 'message chhota aur saaf rehta hai');
  assert.doesNotMatch(String(error.message), /normalize\.css|<!DOCTYPE/i);
});
