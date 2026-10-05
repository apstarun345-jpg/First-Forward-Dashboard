/* GV live feed regressions: short query cache, CCH/VCLASS parity, and stale-job protection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function extractedLiveQueries(fetchUpstreamCached, payloads) {
  const start = source.indexOf('function cchToken(value)');
  const end = source.indexOf('/**\n * ⚡ /api/today', start);
  assert.ok(start >= 0 && end > start, 'class mapping and live query helpers exist');
  const code = source.slice(start, end);
  const upstreamUrl = (params) => `https://upstream.test/gviz?${params.toString()}`;
  const parseGvizServer = (body) => payloads.get(body);
  const serverCell = (row, i) => String((row && row.c && row.c[i] && row.c[i].v) ?? '');
  const serverDate = (value) => {
    const m = /^Date\((\d+),(\d+),(\d+)\)$/.exec(String(value || ''));
    if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
    return `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  };
  const serverNumber = (value) => Number(value) || 0;
  const get = new Function(
    'upstreamUrl', 'fetchUpstreamCached', 'parseGvizServer', 'serverCell', 'serverDate', 'serverNumber',
    `${code}; return { daily: gvizDailyClassCounts, detail: gvizDayDetail, classBucket, mapVersion: gvClassMapVersion };`
  );
  return get(upstreamUrl, fetchUpstreamCached, parseGvizServer, serverCell, serverDate, serverNumber);
}

function gvizRow(...values) {
  return { c: values.map((v) => v === null ? null : ({ v })) };
}

function extractedColumnResolver(table) {
  const start = source.indexOf('const GV_SERVER_HEADER_SYNS = {');
  const end = source.indexOf('const GV_REPORT_HISTORY_TTL_MS', start);
  assert.ok(start >= 0 && end > start, 'GV server column resolver exists');
  const upstreamUrl = (params) => `https://upstream.test/gviz?${params.toString()}`;
  const fetchUpstreamCached = async () => ({ body: 'headers', cached: false });
  const parseGvizServer = () => table;
  const get = new Function('upstreamUrl', 'fetchUpstreamCached', 'parseGvizServer', `${source.slice(start, end)}; return resolveGvServerColumns;`);
  return get(upstreamUrl, fetchUpstreamCached, parseGvizServer);
}

test('GV live query retries toDate after a successful-but-empty text-date query', async () => {
  const calls = [], payloads = new Map();
  const fetchUpstreamCached = async (url, options) => {
    const tq = new URL(url).searchParams.get('tq');
    calls.push({ tq, options });
    const body = `row-${calls.length}`;
    payloads.set(body, calls.length === 1
      ? { rows: [] }
      : { rows: [gvizRow('Date(2026,9,3)', '20', 3)] });
    return { status: 200, body, cached: false };
  };
  const queries = extractedLiveQueries(fetchUpstreamCached, payloads);
  const result = await queries.daily({ sheetId: 'sheet', tab: 'GV Master', dateCol: 'P', classCol: 'G', countCol: 'I', from30: '2026-09-04', cacheMaxAgeMs: 30000 });
  assert.equal(result.via, 'toDate');
  assert.deepEqual(result.rows, [{ date: '2026-10-03', cls: 'VC20', n: 3 }]);
  assert.equal(calls.length, 2, 'second query handles Sheets dates stored as text');
  assert.deepEqual(calls[0].options, { maxAgeMs: 30000 });
});

test('GV daily count uses configured CCH first and VCLASS when CCH is unmapped', async () => {
  const calls = [], payloads = new Map();
  const fetchUpstreamCached = async (url, options) => {
    const tq = new URL(url).searchParams.get('tq');
    calls.push({ tq, options });
    const body = `mapped-rows-${calls.length}`;
    payloads.set(body, tq.includes('select P, G, count(I)')
      ? { rows: [gvizRow('Date(2026,9,3)', '20', 3)] }
      : { rows: [
        gvizRow('Date(2026,9,3)', 'CCH FOUR', 'VC20', 2), // mapped CCH is authoritative
        gvizRow('Date(2026,9,3)', 'opaque CCH', '20', 3), // unknown CCH falls back to VCLASS
        gvizRow('Date(2026,9,3)', 'another CCH', '4', 4)
      ] });
    return { status: 200, body, cached: false };
  };
  const queries = extractedLiveQueries(fetchUpstreamCached, payloads);
  const classMap = { enabled: true, groups: { VC4: ['CCH FOUR'], VC20: ['TRUCK'], VC5: ['CCH5'] } };
  const result = await queries.daily({
    sheetId: 'sheet', tab: 'GV Master', dateCol: 'P', classCol: 'G', fallbackClassCol: 'F', classMap,
    countCol: 'I', from30: '2026-09-04', cacheMaxAgeMs: 30000
  });
  assert.deepEqual(result.rows, [
    { date: '2026-10-03', cls: 'VC4', n: 2 },
    { date: '2026-10-03', cls: 'VC20', n: 3 },
    { date: '2026-10-03', cls: 'VC4', n: 4 }
  ]);
  assert.match(calls[0].tq, /select P, G, F, count\(I\)/, 'both class fields are queried in a stable order');

  const singleClass = await queries.daily({
    sheetId: 'sheet', tab: 'GV Master', dateCol: 'P', classCol: 'G', fallbackClassCol: 'G',
    countCol: 'I', from30: '2026-09-04', cacheMaxAgeMs: 30000
  });
  assert.deepEqual(singleClass.rows, [{ date: '2026-10-03', cls: 'VC20', n: 3 }]);
  assert.match(calls[1].tq, /select P, G, count\(I\)/, 'same CCH/VCLASS column is not selected twice');
});

test('server column resolver keeps CCH primary, VCLASS fallback, and avoids duplicate VCLASS selection', async () => {
  const labels = Array(24).fill('');
  labels[5] = 'VCLASS'; labels[6] = 'CCH'; labels[8] = 'TAG_ID_NUMBER';
  labels[13] = 'STATUS'; labels[15] = 'ISSUE_DATE'; labels[20] = 'TAG_TYPE';
  const table = { cols: labels.map((label, i) => ({ label, id: String.fromCharCode(65 + i) })) };
  const resolve = extractedColumnResolver(table);
  const settings = { gvSheetId: 'sheet', gv: { master: { tab: 'GV Master', cch: 'G', vClass: 'F', date: 'P', tagId: 'I', status: 'N', tagType: 'U' } } };
  const both = await resolve(settings, true);
  assert.equal(both.cls, 'G');
  assert.equal(both.vClass, 'F');
  assert.equal(both.date, 'P');
  assert.equal(both.tagId, 'I');

  labels[6] = 'NOTES';
  const vclassOnly = await extractedColumnResolver({ cols: labels.map((label, i) => ({ label, id: String.fromCharCode(65 + i) })) })(settings, true);
  assert.equal(vclassOnly.cls, 'F', 'if CCH is absent, detected VCLASS becomes the primary class field');
  assert.equal(vclassOnly.vClass, '', 'do not select VCLASS twice');
});

test('server/browser CCH map signatures match and normalize map ordering', async () => {
  const payloads = new Map();
  const serverFns = extractedLiveQueries(async () => ({ body: 'unused' }), payloads);
  const context = { FF: {} };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'), context);
  const config = context.FF.config;
  const mapA = { enabled: true, groups: { VC4: ['Car', '  CCH   4 '], VC20: ['Truck'], VC5: [] } };
  const mapB = { enabled: true, groups: { VC5: [], VC20: ['Truck'], VC4: ['CCH 4', 'CAR'] } };
  assert.equal(config.gvClassMapVersion(mapA), serverFns.mapVersion(mapA));
  assert.equal(config.gvClassMapVersion(mapA), config.gvClassMapVersion(mapB), 'ordering/extra whitespace does not change the signature');
  assert.notEqual(config.gvClassMapVersion(mapA), config.gvClassMapVersion({ ...mapA, enabled: false }));
});

test('GV day detail retries the text-date query and applies the same CCH/VCLASS rules', async () => {
  const calls = [], payloads = new Map();
  const fetchUpstreamCached = async (url, options) => {
    calls.push({ tq: new URL(url).searchParams.get('tq'), options });
    const body = `detail-${calls.length}`;
    payloads.set(body, calls.length === 1 ? { rows: [] } : {
      rows: [gvizRow('Date(2026,9,3)', 'opaque CCH', '20', 'Replacement', 'Chassis', 2)]
    });
    return { status: 200, body, cached: false };
  };
  const queries = extractedLiveQueries(fetchUpstreamCached, payloads);
  const result = await queries.detail({
    sheetId: 'sheet', tab: 'GV Master', dateCol: 'P', classCol: 'G', fallbackClassCol: 'F',
    classMap: { enabled: true, groups: { VC4: [], VC20: [], VC5: [] } },
    statusCol: 'N', typeCol: 'U', countCol: 'I', day: '2026-10-03', dateMode: 'date',
    expectRows: true, cacheMaxAgeMs: 30000
  });
  assert.equal(result.via, 'toDate');
  assert.deepEqual(result.rows, [{ date: '2026-10-03', cls: 'VC20', status: 'Replacement', type: 'Chassis', n: 2 }]);
  assert.match(calls[0].tq, /select P, G, F, N, U, count\(I\)/);
  assert.equal(calls.length, 2);
});

test('live-feed generations prevent an old job from overwriting newly saved mapping data', () => {
  assert.match(source, /let liveFeedGeneration = 0/);
  assert.match(source, /generation === liveFeedGeneration/, 'cache write is guarded by the job generation');
  assert.match(source, /todayFeedCache\.promise === tracked/, 'old finalizer cannot clear a newer promise');
  assert.match(source, /gvTodayFeedCache\.promise === tracked/);
  assert.match(source, /function liveFeedSettingsDiffer\(/);
  assert.match(source, /const liveFeedConfigChanged = !!body\.reset \|\| liveFeedSettingsDiffer\(previousSettings, next\)/);
  assert.match(source, /if \(liveFeedConfigChanged\) invalidateLiveFeedCaches\(\)/, 'saving data/CCH mapping invalidates both feed snapshots');
  assert.match(source, /liveFeedSettingsDiffer\(previousSettings, db\.settings\)/, 'restoring saved settings also invalidates live snapshots');
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
