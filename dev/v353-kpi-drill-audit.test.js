/* 🎯 v3.53 — "KPI par click karo to uska apna data khule" site-wide audit.
 *
 *   User complaint: kai KPI / clickable cards ek number dikhate the aur kholne par kuch aur data aata tha.
 *   Is audit me har page ka card ↔ drawer match kiya gaya; jo galat nikle wo ye the (aur ab guard hain):
 *
 *   1. Home "Today Highest Issued" — spec me `f=highest` tha jo kisi filter se match nahi karta → poora din khulta tha.
 *      Ab har class (VC4 / VC20 / VC5+) ki row apne top issuer ki aaj ki rows kholti hai.
 *   2. Agent / TL Summary (FF + GV) — Expected · Active days · Replacement/Chassis · GV REPORT sheet cards
 *      sab "is mahine ki poori list" kholte the. Ab: din-wise basis · active agents/days · sirf replacement+chassis rows ·
 *      ledger vs sheet farq.
 *   3. GV "TLs with Stock" / "Agents with Stock" drawer — VC4 column hamesha 0 tha (Commercial = poora stock).
 *   4. GV Stock page — "Biggest Class" / "Top TL by Stock" poora GV stock kholte the; ab apni class / TL ka stock.
 *   5. Master Search KPI strip — Priority (agent) · Dispatch all tags · Growth · Expected · Tags required par click nahi chalta tha.
 *   6. Trend + Tag Issued breakdown tiles clickable hi nahi the.
 *   7. Compare "Active Agents 53 vs 61" sirf 16 rows kholta tha.
 *   8. Static guard: koi bhi literal `data-kpi` spec ab unknown `f=` filter use nahi kar sakta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------------------------
// 8) static guard — unknown filter names (jaise `f=highest`) kabhi wapas na aayen
// ---------------------------------------------------------------------------------------------
test('every literal data-kpi spec uses a filter that kpiDetail really understands', () => {
  const kd = read('kpiDetail.js');
  const block = /const FILTERS = \{([\s\S]*?)\n  \};/.exec(kd);
  assert.ok(block, 'FILTERS map found');
  const known = new Set([...block[1].matchAll(/^\s{4}(\w+):\s*\{/gm)].map((m) => m[1]));
  for (const k of ['vc4', 'comm', 'vc20', 'vc5p', 'repl', 'chassis', 'wrong', 'gv', 'ff']) assert.ok(known.has(k), `known filter ${k}`);
  const files = fs.readdirSync(ROOT).filter((f) => /\.js$/.test(f) && !/^(sw|server|kpiDetail)\.js$/.test(f));
  const bad = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/scope=(?:day|mtd|month|range|stock|agents|status|stockreport)[^'"`\n]*?[&?]f=([a-z0-9,_]+)/gi)) {
      for (const v of m[1].split(',')) if (v && !known.has(v)) bad.push(`${f}: f=${v}`);
    }
  }
  assert.deepEqual(bad, [], 'unknown f= filter in a data-kpi spec (card ka drawer filter nahi lagayega)');
});

// ---------------------------------------------------------------------------------------------
// 1) Home — Today Highest Issued
// ---------------------------------------------------------------------------------------------
test('Home "Today Highest Issued" rows open the top issuer of that class (no bogus f=highest)', () => {
  const home = read('home.js');
  assert.ok(!/f=highest/.test(home), 'f=highest hat gaya');
  const block = home.slice(home.indexOf("kpi('g10', 'Today Highest Issued'"), home.indexOf("kpi('g10', 'Today Highest Issued'") + 1600);
  assert.match(block, /\[\['VC4', 'vc4'\], \['VC20', 'vc20'\], \['VC5\+', 'vc5p'\]\]/, 'teeno class rows');
  assert.match(block, /scope=day&date=\$\{tk\}&f=\$\{f\}&agent=/, 'class + top agent ki aaj ki rows');
  assert.match(block, /agentId=/, 'agent id bhi jaati hai (same naam ke do agents na milen)');
});

// ---------------------------------------------------------------------------------------------
// 5) Master Search KPI strip
// ---------------------------------------------------------------------------------------------
test('Master Search KPI strip: every card that shows a number opens data', () => {
  const ms = read('masterSearch.js');
  const strip = ms.slice(ms.indexOf('function kpiStripHtml(pr)'), ms.indexOf('const kpiLoadingHtml'));
  // box(cls, label, value, sub, kpi) — pichhla argument spec hona chahiye (No-dispatch info box ko chhod kar)
  const boxes = strip.split(/\n/).filter((l) => /box\('k\d+'/.test(l) && !/No dispatch/.test(l));
  assert.ok(boxes.length >= 8, `box lines found (${boxes.length})`);
  for (const key of ['Tags required', 'Priority', 'Dispatch · all tags', 'Growth', 'Expected this month']) {
    const line = strip.split('\n').find((l) => /box\('k\d+'/.test(l) && l.includes(key));
    assert.ok(line, `${key} line`);
    assert.match(line, /(spec\('(?:mtd|stock)'|peopleSpec)/, `${key} card ka spec hai`);
  }
});

// ---------------------------------------------------------------------------------------------
// 6) Trend + Tag Issued tiles
// ---------------------------------------------------------------------------------------------
test('Trend tiles carry a drill spec with the page channel + TL/agent filter', () => {
  const tr = read('trend.js');
  assert.match(tr, /function kpiMini\(label, value, foot, cls, spec\)/);
  assert.match(tr, /const drillSpec = \(extra, srcKey\) =>/);
  assert.match(tr, /if \(filter\.tl\) q\.set\('tl', filter\.tl\)/);
  assert.match(tr, /if \(filter\.agent\) q\.set\('agent', filter\.agent\)/);
  const calls = tr.split('\n').filter((l) => l.includes('kpiMini(') && !l.includes('function kpiMini'));
  assert.ok(calls.length >= 14, `kpiMini calls: ${calls.length}`);
  const without = calls.filter((l) => !/Spec\(/.test(l));
  assert.deepEqual(without.map((l) => l.trim().slice(0, 80)), [], 'har tile ke saath spec');
});
test('Tag Issued FF / GV breakdown tiles are clickable with their own channel + class filter', () => {
  const ti = read('tagIssued.js');
  assert.match(ti, /const mini = \(label, value, foot, cls, spec\)/);
  const lines = ti.split('\n').filter((l) => /FF Breakdown|GV Breakdown/.test(l));
  assert.equal(lines.length, 2);
  for (const l of lines) assert.equal((l.match(/mini\('/g) || []).length, 4, 'chaar tile');
  assert.ok(lines[0].includes('src=ff&scope=day') && !lines[0].includes('src=gv'), 'FF tiles sirf FF');
  assert.ok(lines[1].includes('src=gv&scope=day') && !lines[1].includes('src=ff'), 'GV tiles sirf GV');
  assert.match(lines[0], /f=vc4/); assert.match(lines[0], /f=comm/); assert.match(lines[0], /f=repl/);
  assert.match(lines[1], /f=vc4/); assert.match(lines[1], /f=comm/); assert.match(lines[1], /cls=/, 'Top class apni class kholta hai');
});

// ---------------------------------------------------------------------------------------------
// 4) GV Stock — Biggest Class / Top TL
// ---------------------------------------------------------------------------------------------
test('GV Stock "Biggest Class" and "Top TL by Stock" open their own class / TL stock', () => {
  const gp = read('gvpages.js');
  assert.match(gp, /kpiS\('g3', 'Biggest Class'[^\n]*scope=stock&cls=\$\{encodeURIComponent\(bigCls\)\}/);
  assert.match(gp, /kpiS\('g11', 'Top TL by Stock'[^\n]*scope=stock&tl=\$\{encodeURIComponent\(topTl\.tlName\)\}/);
});

// ---------------------------------------------------------------------------------------------
// 7) Compare — Active Agents lists everyone
// ---------------------------------------------------------------------------------------------
test('Compare "Active Agents" dialog lists all active agents, not just the top 8 + 8', () => {
  const c = read('compare.js');
  assert.match(c, /const allFF = U\.topEntries\(/);
  assert.match(c, /const allGV = /);
  const line = c.split('\n').find((l) => l.includes('[LBL.agents]:'));
  assert.ok(line.includes('allFF.map') && line.includes('allGV.map'), 'dialog rows = sab agents');
  assert.ok(!line.includes('topFF.map'), 'top-8 slice nahi');
});

// ---------------------------------------------------------------------------------------------
// 3) kpiDetail — GV holders table VC4 column
// ---------------------------------------------------------------------------------------------
globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { hash: '#/gvStock', href: '' };
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, title: '', hidden: false,
  body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, contains: () => true },
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
};
['config', 'util', 'model', 'gv', 'store', 'charts'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;

function mountGv() {
  const gvData = {
    stockClass: [{ cls: 'VC4', group: 'VC4', n: 100 }, { cls: 'VC20', group: 'VC20', n: 60 }],
    stockTl: [
      { tlId: 'GT1', tlName: 'GV TL One', n: 100 },
      { tlId: 'GT2', tlName: 'GV TL Two', n: 60 }
    ],
    stockTlClass: [
      { tlId: 'GT1', tlName: 'GV TL One', cls: 'VC4', group: 'VC4', n: 70 }, { tlId: 'GT1', tlName: 'GV TL One', cls: 'VC20', group: 'VC20', n: 30 },
      { tlId: 'GT2', tlName: 'GV TL Two', cls: 'VC4', group: 'VC4', n: 30 }, { tlId: 'GT2', tlName: 'GV TL Two', cls: 'VC20', group: 'VC20', n: 30 }
    ],
    stockAgent: [
      { agentId: 'G001', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'GV TL One', n: 100 },
      { agentId: 'G002', agentName: 'GV Suresh', tlId: 'GT2', tlName: 'GV TL Two', n: 60 }
    ],
    stockAgentClass: [
      { agentId: 'G001', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'GV TL One', cls: 'VC4', n: 70 }, { agentId: 'G001', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'GV TL One', cls: 'VC20', n: 30 },
      { agentId: 'G002', agentName: 'GV Suresh', tlId: 'GT2', tlName: 'GV TL Two', cls: 'VC4', n: 30 }, { agentId: 'G002', agentName: 'GV Suresh', tlId: 'GT2', tlName: 'GV TL Two', cls: 'VC20', n: 30 }
    ],
    report: [], master: []
  };
  const data = { stock: [], stockAgents: [], stockTypes: [], daily: [], agents: [], agentClass: [] };
  FF.store.need = async (k) => data[k] || [];
  FF.store.get = (k) => (k in data ? data[k] : []);
  FF.gv.need = async (k) => gvData[k] || [];
  FF.gv.get = (k) => (k in gvData ? gvData[k] : []);
  FF.gv.rows = () => []; FF.gv.enabled = () => true; FF.gv.issuanceRows = () => []; FF.gv.masterRows = () => [];
  FF.auth = { can: () => true, settings: {}, isAdmin: () => true };
  delete require.cache[require.resolve(path.join(ROOT, 'kpiDetail.js'))];
  require(path.join(ROOT, 'kpiDetail.js'));
}
/** drawer HTML me se ek holder row ki (#, naam, TL, stock, VC4, commercial) cells. */
function holderRow(body, name) {
  const row = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]).find((r) => r.includes(`<b>${name}</b>`));
  assert.ok(row, `${name} row mili`);
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
}
test('GV "TLs with Stock" drawer shows the real VC4 / Commercial split per TL (was VC4 0 for everyone)', async () => {
  mountGv();
  const d = await FF.kpiDetail._stockDetail({ src: 'gv', scope: 'stock', holders: 'tls' });
  const one = holderRow(d.body, 'GV TL One'), two = holderRow(d.body, 'GV TL Two');
  assert.deepEqual([one[3], one[4], one[5]], ['100', '70', '30'], 'TL One: stock 100 · VC4 70 · Commercial 30');
  assert.deepEqual([two[3], two[4], two[5]], ['60', '30', '30'], 'TL Two: stock 60 · VC4 30 · Commercial 30');
});
test('GV "Agents with Stock" drawer shows the real VC4 / Commercial split per agent', async () => {
  mountGv();
  const d = await FF.kpiDetail._stockDetail({ src: 'gv', scope: 'stock', holders: 'agents' });
  const a = holderRow(d.body, 'GV Ramesh'), b = holderRow(d.body, 'GV Suresh');
  assert.deepEqual([a[3], a[4], a[5]], ['100', '70', '30']);
  assert.deepEqual([b[3], b[4], b[5]], ['60', '30', '30']);
});

/** FF stock datasets me TL ID column nahi hota — profile "&tlId=…" ke saath bhi drawer card jitna hi total dikhaye. */
test('FF TL / agent stock drill with tlId: VC4 · VC20 · VC5+ totals match the card (was 0)', async () => {
  mountGv();
  const rows = (agent, id, tl, cls, group, n) => ({ agentId: id, agentName: agent, tlName: tl, cls, group, n });
  const ffAgents = [
    rows('AMIT KUMAR', '5846001', 'SUNIL MATALE', 'VC4', 'VC4', 44), rows('AMIT KUMAR', '5846001', 'SUNIL MATALE', 'VC20', 'VC20', 4), rows('AMIT KUMAR', '5846001', 'SUNIL MATALE', 'VC6', 'VC5+', 8),
    rows('RAJ SHAH', '5846002', 'SUNIL MATALE', 'VC4', 'VC4', 30), rows('RAJ SHAH', '5846002', 'SUNIL MATALE', 'VC5', 'VC5+', 10),
    rows('OTHER AGENT', '5846003', 'ANOTHER TL', 'VC4', 'VC4', 999)
  ];
  FF.store.get = (k) => (k === 'stockAgents' ? ffAgents : k === 'stock' ? [] : []);
  FF.store.need = async (k) => FF.store.get(k);
  const sub = async (extra) => String((await FF.kpiDetail._stockDetail({ src: 'ff', scope: 'stock', tl: 'SUNIL MATALE', tlId: 'APN2405', ...extra })).sub).replace(/<[^>]+>/g, '');
  assert.match(await sub({}), /Total 96 tags/, 'TL total (999 wale doosre TL ke nahi)');
  assert.match(await sub({ f: 'vc4' }), /Total 74 tags.*VC4/);
  assert.match(await sub({ f: 'vc20' }), /Total 4 tags.*VC20/);
  assert.match(await sub({ f: 'vc5p' }), /Total 18 tags.*VC5\+/);
  assert.match(await sub({ f: 'comm' }), /Total 22 tags/);
  const ag = String((await FF.kpiDetail._stockDetail({ src: 'ff', scope: 'stock', agent: 'AMIT KUMAR', agentId: '5846001', tl: 'SUNIL MATALE', tlId: 'APN2405' })).sub).replace(/<[^>]+>/g, '');
  assert.match(ag, /Total 56 tags/, 'agent + tlId bhi 0 nahi');
});

/** Home "Expected" / "Run Rate" cards ab MTD ke tags nahi, apna forecast table kholte hain (reported ÷ din × month-days). */
test('Expected / Run Rate drawer shows the class-wise forecast table with the card formula', async () => {
  mountGv();
  const mk = (key, group, cls, n) => ({ key, ym: key.slice(0, 7), day: Number(key.slice(8)), d: new Date(key + 'T00:00:00'), cls, group, n, type: 'ISSUANCE', vrnType: '', channel: 'First Forward', agentName: 'A', agentId: '1', tlName: 'T' });
  const daily = [];
  for (let d = 1; d <= 4; d++) { const k = `2026-10-0${d}`; daily.push(mk(k, 'VC4', 'VC4', 10), mk(k, 'VC20', 'VC20', 2), mk(k, 'VC5+', 'VC5', 3)); }
  daily.push(mk('2026-09-15', 'VC4', 'VC4', 100), mk('2026-09-16', 'VC20', 'VC20', 20), mk('2026-09-17', 'VC5+', 'VC5', 30));
  FF.store.get = (k) => (k === 'daily' ? daily : []);
  FF.store.need = async (k) => FF.store.get(k);
  const exp = await FF.kpiDetail._issuanceDetail({ src: 'both', scope: 'range', from: '2026-10-01', to: '2026-10-04', view: 'expected', title: 'Expected in Oct 2026' });
  assert.match(exp.body, /Expected in .* kaise bana/);
  const cell = (label, idx) => { const tr = [...exp.body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]).find((r) => r.includes(`<b>${label}</b></td>`)); assert.ok(tr, label); return [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim())[idx]; };
  assert.equal(cell('VC4', 1), '40', 'reported VC4 (4 din)');
  assert.equal(cell('VC4', 3), '310', 'VC4 expected = 40 ÷ 4 × 31');
  assert.equal(cell('VC4', 4), '100', 'last month full VC4');
  assert.equal(cell('Total', 1), '60');
  assert.equal(cell('Total', 3), '465', 'Total expected = 60 ÷ 4 × 31');
  assert.match(exp.body, /Month-end expected = 60 tags ÷ 4 reported din × 31 din = <b>465<\/b>/);
  const run = await FF.kpiDetail._issuanceDetail({ src: 'both', scope: 'range', from: '2026-10-01', to: '2026-10-04', view: 'runrate', title: 'Run Rate · Per Day' });
  assert.match(run.body, /Run rate = 60 tags ÷ 4 reported din = <b>15(\.0)? \/ day<\/b>/);
  const plain = await FF.kpiDetail._issuanceDetail({ src: 'both', scope: 'range', from: '2026-10-01', to: '2026-10-04', title: 'Something' });
  assert.ok(!/kaise bana/.test(plain.body), 'view ke bina forecast table nahi');
});

test('dow filter keeps only that weekday (Expected Today drawer)', () => {
  mountGv();
  const wed = '2026-10-14', thu = '2026-10-15';
  assert.equal(new Date(`${wed}T00:00:00`).getDay(), 3);
  const spec = { src: 'gv', dow: '3' };
  assert.equal(FF.kpiDetail._rowMatchesSpec({ key: wed, group: 'VC4', cls: 'VC4', channel: 'GV Partner' }, spec), true);
  assert.equal(FF.kpiDetail._rowMatchesSpec({ key: thu, group: 'VC4', cls: 'VC4', channel: 'GV Partner' }, spec), false);
  assert.equal(FF.kpiDetail._rowMatchesSpec({ key: thu, group: 'VC4', cls: 'VC4', channel: 'GV Partner' }, { src: 'gv' }), true, 'dow ke bina sab din');
});

// ---------------------------------------------------------------------------------------------
// 2) Agent / TL Summary — derived drills
// ---------------------------------------------------------------------------------------------
test('Agent / TL Summary cards: Expected · Active days · Replacement · REPORT sheet each carry their own drill', () => {
  const s = read('summaryUI.js');
  const gvBlock = s.slice(s.indexOf('async function gvView') > 0 ? s.indexOf('function gvView') : 0, s.indexOf('async function ffView'));
  assert.match(gvBlock, /key: 'expected'[\s\S]{0,600}drill: \{ scope: 'days'/);
  assert.match(gvBlock, /key: 'days'[\s\S]{0,400}drill: \{ scope: 'days'/);
  assert.match(gvBlock, /key: 'repl'[\s\S]{0,400}drill: \{ scope: 'repl'/);
  assert.match(gvBlock, /key: 'sheet'[\s\S]{0,700}drill: \{ scope: 'sheet'/);
  const ffBlock = s.slice(s.indexOf('async function ffView'), s.indexOf('FF.summaryUI ='));
  assert.match(ffBlock, /key: 'expected'[\s\S]{0,500}drill: \{ scope: 'days'/);
  assert.match(ffBlock, /key: 'days'[\s\S]{0,700}drill: isTl \? \{ scope: 'agents'/);
});

test('Summary derived drills: replacement/chassis rows only · day-wise totals · agents · ledger vs sheet', () => {
  FF.pages = FF.pages || {};
  delete require.cache[require.resolve(path.join(ROOT, 'summaryUI.js'))];
  require(path.join(ROOT, 'summaryUI.js'));
  const S = FF.summaryUI;
  const v = { ch: 'gv', name: 'GV Ramesh', ym: '2026-10', lastYm: '2026-09', kind: 'agent', sheetTotals: { cur: 8, last: null, stock: 30 }, totals: { cur: 10, last: 20, stock: 30 } };
  const raw = [
    { key: '2026-10-01', n: 1, group: 'VC4', cls: 'VC4', type: 'ISSUANCE', status: 'Issuance', vrnType: 'REGULAR', vrn: 'V1', tagId: 'T1', agentName: 'GV Ramesh', tlName: 'TL' },
    { key: '2026-10-01', n: 1, group: 'VC4', cls: 'VC4', type: 'REPLACEMENT', status: 'Replacement', vrnType: 'REGULAR', vrn: 'V2', tagId: 'T2', agentName: 'GV Ramesh', tlName: 'TL' },
    { key: '2026-10-02', n: 1, group: 'VC5+', cls: 'VC5', type: 'ISSUANCE', status: 'Issuance', vrnType: 'Chassis', vrn: 'V3', tagId: 'T3', agentName: 'GV Ramesh', tlName: 'TL' },
    { key: '2026-10-02', n: 1, group: 'VC20', cls: 'VC20', type: 'ISSUANCE', status: 'Issuance', vrnType: 'REGULAR', vrn: 'V4', tagId: 'T4', agentName: 'GV Ramesh', tlName: 'TL' }
  ];
  const base = { source: 'GV Master', raw };
  const repl = S._deriveDrill('repl', base, { title: 'x' }, v);
  assert.equal(repl.rows.length, 2, 'sirf replacement + chassis rows (4 me se 2)');
  assert.deepEqual(repl.rows.map((r) => r[1]).sort(), ['V2', 'V3']);
  assert.match(repl.note, /Replacement 1/); assert.match(repl.note, /Chassis 1/);
  const days = S._deriveDrill('days', base, { title: 'x', basis: '4 tags ÷ 2 din' }, v);
  assert.deepEqual(days.rows.map((r) => r[0]), ['2026-10-01', '2026-10-02', 'TOTAL']);
  assert.deepEqual(days.rows[0].slice(1), ['2', '2', '0', '1', '0'], '1 Oct: 2 tags · 2 VC4 · 0 comm · 1 repl · 0 chassis');
  assert.deepEqual(days.rows[2].slice(1, 3), ['4', '2'], 'TOTAL = 4 tags, 2 VC4');
  assert.match(days.note, /2 din/); assert.match(days.note, /4 tags ÷ 2 din/);
  const sheet = S._sheetDrill(v, { title: 's' });
  assert.deepEqual(sheet.rows[0], ['Issuance · 2026-10', '10', '8', '+2'], 'ledger 10 vs sheet 8');
  assert.deepEqual(sheet.rows[1], ['Last month · 2026-09', '20', '—', '—'], 'sheet blank → farq nahi');
  const tl = { ch: 'ff', kind: 'tl', name: 'TL One', ym: '2026-10', team: [
    { name: 'A', id: '1', curTotal: 10, curVc4: 6, curComm: 4, lastTotal: 5, stockTotal: 20 },
    { name: 'B', id: '2', curTotal: 0, curVc4: 0, curComm: 0, lastTotal: 3, stockTotal: 9 },
    { name: 'C', id: '3', curTotal: 30, curVc4: 10, curComm: 20, lastTotal: 8, stockTotal: 4 }] };
  const ag = S._agentsDrill(tl, { title: 'a' });
  assert.deepEqual(ag.rows.map((r) => r[0]), ['C', 'A', 'TOTAL'], 'sirf active agents, bade se chhota');
  assert.equal(ag.rows[2][2], '40', 'TOTAL this month = 40');
  assert.match(ag.note, /2 \/ 3 agents/);
});
