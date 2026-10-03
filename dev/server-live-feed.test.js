/* GV live feed regressions: short per-query cache + successful-empty date query fallback. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function extractedLiveQueries(fetchUpstreamCached, payloads) {
  const start = source.indexOf('function countByDateClass(');
  const end = source.indexOf('/**\n * ⚡ /api/today', start);
  assert.ok(start >= 0 && end > start, 'count and live query helpers exist');
  const code = source.slice(start, end);
  const upstreamUrl = (params) => `https://upstream.test/gviz?${params.toString()}`;
  const parseGvizServer = (body) => payloads.get(body);
  const serverCell = (row, i) => String((row && row.c && row.c[i] && row.c[i].v) ?? '');
  const serverDate = (v) => String(v).startsWith('Date(2026,9,3)') ? '2026-10-03' : '';
  const serverNumber = (v) => Number(v) || 0;
  const classBucket = (v) => /^20$/.test(String(v)) ? 'VC20' : `VC${v}`;
  const get = new Function('upstreamUrl', 'fetchUpstreamCached', 'parseGvizServer', 'serverCell', 'serverDate', 'serverNumber', 'classBucket', `${code}; return { daily: gvizDailyClassCounts, detail: gvizDayDetail };`);
  return get(upstreamUrl, fetchUpstreamCached, parseGvizServer, serverCell, serverDate, serverNumber, classBucket);
}

test('GV live query retries toDate after a successful-but-empty text-date query', async () => {
  const calls = [], payloads = new Map();
  const fetchUpstreamCached = async (url, options) => {
    const tq = new URL(url).searchParams.get('tq');
    calls.push({ tq, options });
    const body = `row-${calls.length}`;
    payloads.set(body, calls.length === 1
      ? { rows: [] }
      : { rows: [{ c: [{ v: 'Date(2026,9,3)' }, { v: '20' }, { v: 3 }] }] });
    return { status: 200, body, cached: false };
  };
  const queries = extractedLiveQueries(fetchUpstreamCached, payloads);
  const result = await queries.daily({ sheetId: 'sheet', tab: 'GV Master', dateCol: 'P', classCol: 'G', countCol: 'I', from30: '2026-09-04', cacheMaxAgeMs: 30000 });
  assert.equal(result.via, 'toDate');
  assert.deepEqual(result.rows, [{ date: '2026-10-03', cls: 'VC20', n: 3 }]);
  assert.equal(calls.length, 2, 'second query handles Sheets dates stored as text');
  assert.deepEqual(calls[0].options, { maxAgeMs: 30000 });
});

test('GV day detail retries the text-date query when aggregate feed proves today has rows', async () => {
  const calls = [], payloads = new Map();
  const fetchUpstreamCached = async (url, options) => {
    const tq = new URL(url).searchParams.get('tq');
    calls.push({ tq, options });
    const body = `detail-${calls.length}`;
    payloads.set(body, calls.length === 1 ? { rows: [] } : {
      rows: [{ c: [{ v: 'Date(2026,9,3)' }, { v: '20' }, { v: 'Replacement' }, { v: 'Chassis' }, { v: 2 }] }]
    });
    return { status: 200, body, cached: false };
  };
  const queries = extractedLiveQueries(fetchUpstreamCached, payloads);
  const result = await queries.detail({
    sheetId: 'sheet', tab: 'GV Master', dateCol: 'P', classCol: 'G', statusCol: 'N', typeCol: 'U', countCol: 'I',
    day: '2026-10-03', dateMode: 'date', expectRows: true, cacheMaxAgeMs: 30000
  });
  assert.equal(result.via, 'toDate');
  assert.deepEqual(result.rows, [{ date: '2026-10-03', cls: 'VC20', status: 'Replacement', type: 'Chassis', n: 2 }]);
  assert.equal(calls.length, 2);
});

test('live query cache override expires old CACHE_SECONDS entries and force bypasses cache', async () => {
  const start = source.indexOf('async function fetchUpstreamCached(url, options)');
  const end = source.indexOf('\n}\n\n// The watcher', start) + 2;
  assert.ok(start >= 0 && end > start, 'fetchUpstreamCached implementation exists');
  const cache = new Map(), inflight = new Map();
  const url = 'https://upstream.test/live';
  cache.set(url, { at: Date.now() - 60_000, body: 'old', status: 200 });
  let upstreamCalls = 0;
  const fetchUpstream = async () => ({ status: 200, body: `google.visualization.Query.setResponse(fresh-${++upstreamCalls})` });
  const fetchCached = new Function('cache', 'inflight', 'cacheMs', 'fetchUpstream', 'MAX_CACHE_ENTRIES', `${source.slice(start, end)}; return fetchUpstreamCached;`)(cache, inflight, () => 600_000, fetchUpstream, 100);

  const refreshed = await fetchCached(url, { maxAgeMs: 30_000 });
  assert.match(refreshed.body, /fresh-1/, 'ten-minute generic cache is bypassed for live feed');
  const recent = await fetchCached(url, { maxAgeMs: 30_000 });
  assert.equal(recent.cached, true, 'fresh live query is reused inside its short TTL');
  const forced = await fetchCached(url, { maxAgeMs: 0 });
  assert.match(forced.body, /fresh-2/, 'manual fresh query bypasses even the short TTL');
});
