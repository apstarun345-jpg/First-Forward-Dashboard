/* v3.37 — Unusual Activity: 🎯 card = drawer (same data), 🚀 server-side tag scan, 🩺 diagnostics v2.
   User complaint: "KPI cards apna related data nahi dikhate, click par drawer me kuch aur aata hai, aur option lag karta hai."
   Ye tests wahi teen cheezein lock karte hain:
     1) har flag ka card metric == drawer/evidence ka count (parity invariant),
     2) tag-level scan server par hota hai (browser 25k-row pages nahi kheenchta) — /api/unusual/scan,
     3) Settings → 🩺 diagnostics ka "ek button se sab fix" layer (attr repairs + speed prefs + parity probe). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

globalThis.window = globalThis;
globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _map: m };
})();
globalThis.sessionStorage = globalThis.localStorage;
globalThis.document = {
  documentElement: { dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } },
  body: { classList: { add() {}, remove() {}, toggle() {} } },
  addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, getContext: () => null })
};
globalThis.addEventListener = () => {};
['config', 'util', 'unusual-scan', 'unusual'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const L = FF.unusualScan;

// ---- fixtures -----------------------------------------------------------------------------------
/** Ek EIR tag row (server/browser scan ka input record). */
const rec = (o) => ({
  ch: 'ff', key: o.date, tagId: o.tagId || `T${Math.random().toString(36).slice(2, 8)}`, vrn: o.vrn,
  cls: o.cls || 'VC4', vrnType: o.vrnType || 'New', agentId: o.agentId, agentName: o.agentName || o.agentId,
  tlName: o.tlName || 'TL1', type: o.type || 'ISSUANCE', status: o.status || 'Issued', masterId: o.masterId || ''
});
/** Daily aggregate row (FF.unusual.analyze ka input). */
const day = (key, agentId, n, extra) => ({
  key, ym: key.slice(0, 7), channel: 'First Forward', agentId, agentName: agentId, tlName: 'TL1',
  n, type: 'ISSUANCE', vrnType: 'New', ...(extra || {})
});

test('🧮 unusual-scan: VRN normalize, placeholder/chassis skip aur sirf n≥2 groups hi duplicate', () => {
  const records = [
    rec({ date: '2026-09-01', agentId: 'A1', vrn: 'RJ14AB1234' }),
    rec({ date: '2026-09-02', agentId: 'A1', vrn: 'RJ14AB 1234' }),        // wahi VRN, space ke saath
    rec({ date: '2026-09-03', agentId: 'A2', vrn: 'rj14ab1234' }),          // lower case
    rec({ date: '2026-09-04', agentId: 'A2', vrn: 'RJ14CD5678' }),          // sirf ek baar → duplicate NAHI
    rec({ date: '2026-09-05', agentId: 'A3', vrn: '000000' }),               // placeholder
    rec({ date: '2026-09-06', agentId: 'A3', vrn: '000000' }),               // placeholder → group nahi banta
    rec({ date: '2026-09-07', agentId: 'A3', vrn: '' }),                     // blank
    rec({ date: '2026-09-08', agentId: 'A4', vrn: 'CHASSIS1', vrnType: 'Chassis No' }),
    rec({ date: '2026-09-09', agentId: 'A4', vrn: 'CHASSIS1', vrnType: 'Chassis No' })
  ];
  const index = L.buildIndex({ records, from: '2026-09-01', to: '2026-09-30' });
  assert.equal(index.totals.dupGroups, 1, 'sirf RJ14AB1234 ek duplicate group hai');
  assert.equal(index.dup.length, 1);
  assert.equal(index.dup[0].v, 'RJ14AB1234');
  assert.equal(index.dup[0].n, 3, 'teen tag rows same VRN par');
  assert.equal(index.totals.dup, 3, 'duplicate tags = group ke saare rows');
  assert.equal(index.agents['ff|A1'].d, 2);
  assert.equal(index.agents['ff|A2'].d, 1);
  assert.equal(index.agents['ff|A3'].d, 0, 'placeholder/blank VRN duplicate nahi maana jaata');
  assert.equal(index.agents['ff|A4'].d, 0, 'chassis rows duplicate detection se bahar');
  assert.deepEqual(index.dup[0].d, ['2026-09-01', '2026-09-02', '2026-09-03'], 'dates sorted');
  assert.equal(L.duplicatesFor(index, ['ff|A1']).length, 1);
  assert.equal(L.duplicatesFor(index, ['ff|A3']).length, 0);
});

test('🧮 unusual-scan: wrong-type + malformed ka union exact (w + i - b), evidence per flag', () => {
  const records = [
    rec({ date: '2026-09-01', agentId: 'A1', vrn: 'RJ14AB1234', vrnType: 'Wrong VRN' }),  // wrong + valid format
    rec({ date: '2026-09-02', agentId: 'A1', vrn: 'XX', vrnType: 'New' }),                 // malformed only
    rec({ date: '2026-09-03', agentId: 'A1', vrn: 'YY', vrnType: 'Wrong VRN' }),           // BOTH
    rec({ date: '2026-09-04', agentId: 'A1', vrn: 'RJ14CD9999', type: 'REPLACEMENT' }),
    rec({ date: '2026-09-05', agentId: 'A1', vrn: 'CH123', vrnType: 'Chassis No' })
  ];
  const index = L.buildIndex({ records, from: '2026-09-01', to: '2026-09-30' });
  const a = index.agents['ff|A1'];
  assert.equal(a.w, 2, 'do tags Wrong VRN type ke');
  assert.equal(a.i, 2, 'do tags malformed (XX, YY)');
  assert.equal(a.b, 1, 'YY dono hai — union me ek hi baar gina jayega');
  assert.equal(a.w + a.i - a.b, 3, 'union(wrong, malformed) = 3 distinct tags');
  assert.equal(a.r, 1);
  assert.equal(a.c, 1);
  assert.equal(index.totals.wrong, 2);
  assert.equal(index.totals.invalid, 2);
  assert.equal(index.totals.repl, 1);
  assert.equal(index.totals.chassis, 1);
  const wrongEv = L.evidence(index, { flag: 'wrong', keys: ['ff|A1'] });
  assert.equal(wrongEv.total, 3, 'evidence rows = union count');
  assert.equal(wrongEv.rows.length, 3);
  assert.ok(wrongEv.head.length && wrongEv.head.length === wrongEv.rows[0].length, 'head aur row ki columns barabar');
  assert.equal(L.evidence(index, { flag: 'replace', keys: ['ff|A1'] }).total, 1);
  assert.equal(L.evidence(index, { flag: 'chassis', keys: ['ff|A1'] }).total, 1);
  assert.equal(L.evidence(index, { flag: 'wrong', keys: ['ff|NOPE'] }).total, 0, 'doosre agent ke rows leak nahi hone chahiye');
});

test('🧮 unusual-scan: evidence caps → counts exact rehte hain, sirf list truncate hoti hai', () => {
  const records = [];
  for (let i = 0; i < 30; i++) records.push(rec({ date: '2026-09-01', agentId: 'A1', vrn: 'XX', tagId: `T${i}` }));
  const index = L.buildIndex({ records, from: '2026-09-01', to: '2026-09-30', caps: { bad: 10 } });
  assert.equal(index.totals.invalid, 30, 'count exact');
  assert.equal(index.bad.length, 10, 'list capped');
  assert.equal(index.meta.truncated.bad, true, 'truncation flag set');
  const dupRecs = [];
  for (let i = 0; i < 6; i++) { dupRecs.push(rec({ date: '2026-09-01', agentId: 'A1', vrn: `RJ14AA${1000 + i}` })); dupRecs.push(rec({ date: '2026-09-02', agentId: 'A1', vrn: `RJ14AA${1000 + i}` })); }
  const capped = L.buildIndex({ records: dupRecs, from: '2026-09-01', to: '2026-09-30', caps: { dupGroups: 2 } });
  assert.equal(capped.totals.dupGroups, 6, 'groups exact count');
  assert.equal(capped.dup.length, 2, 'list capped');
  assert.equal(capped.meta.truncated.dup, true);
});

test('🎯 card = drawer: har flag ka metric value aur tag-level evidence count barabar', () => {
  // 4 agents, mixed anomalies — Sept 2026.
  // Tag-level records aur daily aggregates JAAN-BOOJH kar consistent rakhe hain — tabhi card ka
  // number aur drawer ki rows exact match karti hain (real life me yahi hota hai jab sheet fresh ho).
  const records = [];
  for (let i = 0; i < 5; i++) records.push(rec({ date: `2026-09-0${i + 1}`, agentId: 'DUP', vrn: 'RJ14AB1234' }));
  for (let i = 0; i < 10; i++) records.push(rec({ date: `2026-09-1${i % 9 + 1}`, agentId: 'WRG', vrn: `RJ14WR${3000 + i}`, vrnType: 'Wrong VRN' }));
  for (let i = 0; i < 4; i++) records.push(rec({ date: `2026-09-2${i}`, agentId: 'RPL', vrn: `RJ14CD${2000 + i}`, type: 'REPLACEMENT' }));
  for (let i = 0; i < 2; i++) records.push(rec({ date: `2026-09-2${i}`, agentId: 'CHS', vrn: `CH${i}`, vrnType: 'Chassis No' }));
  records.push(rec({ date: '2026-09-25', agentId: 'OK', vrn: 'RJ14EF7777' }));
  const index = L.buildIndex({ records, from: '2026-09-01', to: '2026-09-30' });

  const rows = [
    day('2026-09-01', 'DUP', 5), day('2026-09-02', 'DUP', 5),
    day('2026-09-10', 'WRG', 30), day('2026-09-11', 'WRG', 10, { vrnType: 'Wrong VRN' }),
    day('2026-09-20', 'RPL', 4, { type: 'REPLACEMENT' }), day('2026-09-21', 'RPL', 4),
    day('2026-09-22', 'CHS', 2, { vrnType: 'Chassis No' }), day('2026-09-23', 'CHS', 4),
    day('2026-09-25', 'OK', 12)
  ];
  // mult/min thoda dheela — fixture chhota hai, warna peer-average cut ki wajah se koi flag trigger hi na hota.
  const model = FF.unusual.analyze(rows, { period: 'custom', from: '2026-09-01', to: '2026-09-30', vrnIndex: index, mult: 1.2, min: 2 });
  assert.ok(model.index, 'index model par laga');
  const seen = {};
  for (const flag of Object.keys(FF.unusual.FLAGS)) {
    const m = FF.unusual.metricFor(model, flag);
    seen[flag] = m;
    assert.equal(typeof m.value, 'number', `${flag}: value numeric`);
    assert.ok(m.unit && m.noun && m.meta && m.meta.evidence, `${flag}: unit/noun/evidence label set`);
    assert.ok(FF.unusual.FLAGS[flag] && FF.unusual.FLAGS[flag].label, `${flag}: flag label set`);
    assert.equal(m.evidenceTotal, m.value, `${flag}: card ka number aur tag-level rows ka count BARABAR hone chahiye (matched=${m.matched})`);
    assert.equal(m.matched, true, `${flag}: parity flag`);
    // Drawer wahi metric use karta hai — evidence rows bhi wahi count deti hain.
    const ev = FF.unusual.evidenceFor(m, model, 0);
    assert.ok(ev && Array.isArray(ev.head) && Array.isArray(ev.rows), `${flag}: evidence shape`);
    if (flag === 'double' || flag === 'wrong' || flag === 'replace' || flag === 'chassis') {
      assert.equal(ev.total, m.value, `${flag}: drawer ki tag rows == card ka number`);
    } else {
      assert.equal(ev.rows.length, m.rows.length, `${flag}: agent-level rows == card ka number`);
    }
  }
  assert.ok(seen.double.value >= 5, 'double card me duplicate tags dikhe');
  assert.ok(seen.wrong.value >= 10, 'wrong card me wrong tags dikhe');
  assert.ok(seen.replace.value >= 4, 'replace card me replacement tags dikhe');
  assert.ok(seen.chassis.value >= 2, 'chassis card me chassis tags dikhe');
  assert.ok(seen.chassis.value >= 2, 'chassis card me chassis tags dikhe');
  assert.ok(seen.all.value >= 1, 'all card me flagged agents dikhe');
  // Purane semantics bhi zinda hain (regression guard)
  assert.ok(model.duplicateVrns.length >= 1);
  assert.equal(model.duplicateVrns[0].vrn, 'RJ14AB1234');
});

test('🎯 card 0 bolta hai to drawer me bhi 0 rows (khali selection = poora index nahi)', () => {
  const records = [];
  for (let i = 0; i < 6; i++) records.push(rec({ date: `2026-09-0${i + 1}`, agentId: 'WRG', vrn: `RJ14WR${4000 + i}`, vrnType: 'Wrong VRN' }));
  const index = L.buildIndex({ records, from: '2026-09-01', to: '2026-09-30' });
  // Daily aggregate me WRG normal hai (peer cut ke neeche) → 'wrong' card par 0 agents/0 tags.
  const rows = [day('2026-09-01', 'WRG', 200), day('2026-09-02', 'A2', 100), day('2026-09-03', 'A3', 100)];
  const model = FF.unusual.analyze(rows, { period: 'custom', from: '2026-09-01', to: '2026-09-30', vrnIndex: index });
  const m = FF.unusual.metricFor(model, 'wrong');
  assert.equal(m.value, 0, 'card par 0');
  const ev = FF.unusual.evidenceFor(m, model, 0);
  assert.equal(ev.total, 0, 'drawer me bhi 0 rows — index ke saare wrong rows leak nahi hone chahiye');
  assert.equal(ev.rows.length, 0);
  assert.ok(Array.isArray(ev.head) && ev.head.length > 1, 'table head phir bhi sahi (CSV export ke liye)');
});

test('🎯 card = drawer: bina index ke bhi numbers consistent (daily aggregate fallback)', () => {
  const rows = [day('2026-09-01', 'A', 20), day('2026-09-02', 'A', 10, { vrnType: 'Wrong VRN' }), day('2026-09-03', 'B', 5)];
  const model = FF.unusual.analyze(rows, { period: 'custom', from: '2026-09-01', to: '2026-09-30' });
  assert.equal(model.index, null);
  for (const flag of Object.keys(FF.unusual.FLAGS)) {
    const m = FF.unusual.metricFor(model, flag);
    assert.equal(m.evidenceTotal, m.value, `${flag}: fallback me bhi card == drawer`);
  }
});

test('🔌 /api/unusual/scan: auth, validation, compact index (server-side parallel scan)', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ff-ua-scan-'));
  const mockPort = 9000 + Math.floor(Math.random() * 800);
  const mock = spawn(process.execPath, [path.join(ROOT, 'dev/mock-gviz.js')], { env: { ...process.env, MOCK_PORT: String(mockPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await once(mock.stdout, 'data');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: `http://127.0.0.1:${mockPort}`, RENDER: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', (d) => { logs += d; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { logs += d; const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m && m[1] !== '0') resolve(`http://127.0.0.1:${m[1]}`); });
    child.on('exit', (code) => reject(new Error(`server exited ${code}: ${logs}`)));
  });
  let base;
  let cookie = '';
  try {
    base = await Promise.race([ready, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('startup timeout: ' + logs)), 15000); t.unref(); })]);
    const call = async (route, method = 'GET', body) => {
      const res = await fetch(base + route, { method, headers: { cookie, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* non-json */ }
      const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      return { status: res.status, json, bytes: text.length };
    };

    // 1) bina login → 401
    const anon = await call('/api/unusual/scan?from=2026-09-01&to=2026-09-30');
    assert.equal(anon.status, 401, 'anonymous scan blocked');

    const login = await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' });
    assert.equal(login.status, 200, 'admin login');

    // 2) validation
    assert.equal((await call('/api/unusual/scan')).status, 400, 'from/to required');
    assert.equal((await call('/api/unusual/scan?from=2026-09-10&to=2026-09-01')).status, 400, 'from > to rejected');
    assert.equal((await call('/api/unusual/scan?from=2024-01-01&to=2026-09-01')).status, 400, '>366 din ka range rejected');

    // 3) real scan — compact index, browser ko 25k-row pages nahi bhejne padte
    const t0 = Date.now();
    const ok = await call('/api/unusual/scan?from=2026-09-01&to=2026-09-30');
    const ms = Date.now() - t0;
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true, `scan ok hona chahiye: ${JSON.stringify(ok.json).slice(0, 200)}`);
    assert.equal(ok.json.spanDays, 30);
    const index = ok.json.index;
    assert.equal(index.v, L.VERSION, 'index version = shared lib version');
    assert.equal(index.from, '2026-09-01'); assert.equal(index.to, '2026-09-30');
    assert.ok(index.totals.rows > 0, 'EIR tag rows padi gayin');
    assert.equal(index.meta.complete, true, 'scan poora hua (cap/paging warning nahi)');
    assert.ok(index.meta.source.includes('server-scan'), `source: ${index.meta.source}`);
    assert.ok(Object.keys(index.agents).length > 0, 'agents index me hain');
    assert.ok(Array.isArray(index.dup) && Array.isArray(index.bad) && Array.isArray(index.rep) && Array.isArray(index.cha), 'evidence lists');
    // Duplicate detection asli data par bhi kaam karti hai
    assert.ok(index.totals.dupGroups > 0, 'mock data me duplicate VRN groups milne chahiye');
    assert.equal(index.totals.dup, index.dup.reduce((a, d) => a + d.a.reduce((x, [, n]) => x + n, 0), 0), 'totals.dup == per-agent group counts ka sum');
    // 4) cache — doosri call turant (server TTL) aur same numbers
    const again = await call('/api/unusual/scan?from=2026-09-01&to=2026-09-30');
    assert.equal(again.json.ok, true);
    assert.deepEqual(again.json.index.totals, index.totals, 'cached scan ke totals same');
    assert.ok(ok.bytes > 1000, 'payload me asli data hai');
    assert.ok(ms < 20000, `scan ${ms}ms me ho gaya`);
    // 5) permission gate — bina 'unusual' permission wala member 403 paata hai
    await call('/api/users', 'POST', { username: 'member', name: 'Member', password: 'member-password', role: 'user', permissions: ['home'] });
    const savedCookie = cookie;
    const memberLogin = await call('/api/auth/login', 'POST', { username: 'member', password: 'member-password' });
    assert.equal(memberLogin.status, 200);
    const forbidden = await call('/api/unusual/scan?from=2026-09-01&to=2026-09-30');
    assert.equal(forbidden.status, 403, 'member bina unusual permission ke scan nahi kar sakta');
    cookie = savedCookie;
  } finally {
    child.kill('SIGTERM'); mock.kill('SIGTERM');
    await Promise.allSettled([once(child, 'exit'), once(mock, 'exit')]);
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('🃏 app.js: global KPI click handler `data-kpi-self` cards ko hijack nahi karta', () => {
  const app = read('app.js');
  const handler = app.slice(app.indexOf("const kpi = e.target.closest('.kpi, [data-kpi]')"));
  assert.ok(handler.includes("closest('[data-kpi-self]')"), 'global handler me data-kpi-self guard hona chahiye');
  const ua = read('unusual.js');
  assert.ok(/data-ua-flag="\$\{[^}]+\}"[^>]*data-kpi-self="1"|data-kpi-self="1"[^>]*data-ua-flag/.test(ua) || ua.includes('data-kpi-self="1"'), 'unusual cards par data-kpi-self hai');
  const as = read('agentSummary.js');
  assert.ok(as.includes('data-kpi-self="1" data-as-age="30"') && as.includes('data-kpi-self="1" data-as-age="60"'), 'agent summary age cards par data-kpi-self hai');
  // Ek hi source of truth: card, drawer, CSV aur PDF sab metricFor se bante hain.
  assert.ok(ua.includes('function metricFor(model, flagKey)'), 'metricFor single source of truth');
  assert.ok(/metricFor\(model, (k|flagKey|drawerState\.flag)\)/.test(ua), 'drawer/cards metricFor use karte hain');
  assert.ok(ua.includes('data-ua-modal-evcsv') && ua.includes('data-ua-modal-pdf'), 'drawer ke CSV/PDF actions wahi flag use karte hain');
});

test('🚀 lazy group + current cache busting: unusual-scan pehle load hota hai', () => {
  const lazy = read('lazy.js');
  const m = lazy.match(/unusual:\s*\[([^\]]+)\]/);
  assert.ok(m, 'GROUPS.unusual mila');
  const list = m[1].split(',').map((x) => x.trim().replace(/['"]/g, ''));
  assert.deepEqual(list, ['pdf', 'unusual-scan', 'unusual'], 'PDF helper aa sakta hai pehle, shared scan lib unusual page se pehle load hoti hai');
  assert.ok(list.indexOf('unusual-scan') < list.indexOf('unusual'), 'shared scan lib page module se pehle load ho');
  const idx = read('index.html'), sw = read('sw.js');
  assert.ok(!idx.includes('?v=59') && !sw.includes('?v=59'), 'purana ?v=59 kahin nahi bacha');
  assert.ok(idx.includes('config.js?v=105') && sw.includes('./config.js?v=105'), 'CCH signature helper cache-busted in shell + SW');
  assert.ok(idx.includes('home.js?v=87') && sw.includes('./home.js?v=87'), 'Home map-mismatch guard cache-busted in shell + SW');
  assert.ok(idx.includes('app.js?v=105') && sw.includes('./app.js?v=105'), 'root service-worker registration cache-busted in shell + SW');
  assert.match(sw, /CACHE_NAME = 'apnapayment-v109'/, 'SW cache bust hua');
  const server = read('server.js');
  assert.ok(server.includes("import './unusual-scan.js'"), 'server shared scan lib import karta hai');
  assert.ok(server.includes("'/api/unusual/scan'"), 'server route hai');
  assert.ok(server.includes("includes('unusual')"), 'route permission-gated hai');
});

test('🩺 Settings diagnostics v2: attr repairs, speed prefs, parity probe, filters + exports', () => {
  const st = read('settings.js');
  // API surface (exports) — purane keys bhi barkaraar
  for (const key of ['scanDom:', 'applyFix:', 'repairs:', 'clearRepairs:', 'stableSelector:', 'repairCss:', 'saved:',
    'attrFix:', 'attrRepairs:', 'applyAttrRepairs', 'speedPrefs', 'setSpeedPref', 'applySpeedPrefs', 'pageStats:',
    'history:', 'visibleFindings:', 'export:', 'probeParity:', 'runSite:', 'scanEveryPage']) {
    assert.ok(st.includes(key), `diagnostics export missing: ${key}`);
  }
  // Root-cause detector + persistent attribute repair
  assert.ok(st.includes("const SELF_KPI_ATTRS = ['data-ua-flag', 'data-as-age']"), 'page-owned KPI attrs registered');
  assert.ok(st.includes("const LS_ATTR_REPAIRS = 'ff_diag_attr_repairs'"), 'attr repairs persist hote hain');
  assert.ok(st.includes("ATTR_FIX = { kpiSelf: { attr: 'data-kpi-self', value: '1'"), 'kpiSelf repair rule');
  assert.ok(st.includes('function startAttrRepairWatcher'), 're-render par repair dobara lagta hai');
  assert.ok(st.includes("if (ATTR_FIX[f.fixType])"), 'applyDiagnosticFix attribute repairs handle karta hai');
  assert.ok(st.includes('async function runCardParityProbe(body)'), '🔬 card↔drawer parity probe');
  assert.ok(st.includes('probeCards'), 'parity probe FF.unusual.probeCards use karta hai');
  assert.ok(st.includes('function diagPageWeightFindings') && st.includes('function diagDataHealthFindings'), 'page speed + data health detectors');
  assert.ok(st.includes('id="diag-filter-sev"') && st.includes('id="diag-search"') && st.includes('id="diag-group"'), 'findings filter/search/group UI');
  assert.ok(st.includes('id="diag-export-csv"') && st.includes('id="diag-export-json"') && st.includes('id="diag-copy"'), 'export UI');
  assert.ok(st.includes('LS_DIAG_HISTORY') && st.includes('function pushDiagHistory'), 'scan history');
  // ⚡ Speed doctor prefs + eager boot hook
  assert.ok(st.includes("const LS_SPEED_PREFS = 'ff_speed_prefs'"), 'speed prefs key');
  for (const pref of ['reduceMotion', 'lite', 'uaFastScan']) assert.ok(st.includes(pref), `speed pref ${pref}`);
  const app = read('app.js');
  assert.ok(app.includes('ff_speed_prefs') && app.includes('ff_diag_attr_repairs'), 'app.js boot par saved prefs/repairs lagata hai');
  assert.ok(app.includes('applySavedTweaks(root)'), 'har page render ke baad repairs dobara lagte hain');
  const css = read('styles.css');
  assert.ok(css.includes('html.ff-no-anim') && css.includes('html.ff-lite'), 'speed prefs ke CSS rules');
  assert.ok(css.includes('.ua-match') && css.includes('.dkpi-hero') && css.includes('.diag-toolbar'), 'naye UI classes styled hain');
  // Unusual page ka apna 🩺 diagnose (page-level) + fast mode
  const ua = read('unusual.js');
  assert.ok(ua.includes('function openDiagnose') && ua.includes('function diagnoseData'), 'page-level diagnose');
  assert.ok(ua.includes('runSiteDiagHere'), 'page se Settings site-diagnostics reuse hota hai');
  assert.ok(ua.includes('ff_speed_prefs') && ua.includes('uaFastScan'), 'fast mode pref persist hota hai');
  assert.ok(ua.includes('CAP_LEDGER') && ua.includes('CAP_DRAWER') && ua.includes('data-ua-more-'), 'bade tables chunked (freeze nahi)');
});
