/* 🔎 v3.41 — Home search ka "Search Report": same naam ke FF + GV ek group, channel toggle, ⚖ combined table,
   TL ke agents table me last / current (VC4 · Comm · Total) + Agent × Class stock, section nav, Summary channel switch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { hash: '#/home', href: '' };
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, title: '', hidden: false,
  body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, contains: () => true },
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
};
['config', 'util', 'model', 'gv', 'gvTruth', 'store', 'charts'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const U = FF.util;
U.runRateDays = () => 15;
const ym = U.ymKey(new Date());

const perfAgent = (o) => ({ week: [1, 2, 3, 0, 0, 1, 2], curVc4: 0, curNvc4: 0, curTotal: 0, lastVc4: 0, lastNvc4: 0, lastTotal: 0, stockVc4: 0, stockNvc4: 0, stockTotal: 0, tlExcluded: false, agentStatus: 'Active', lastActive: 'Today', ...o });
function ffFixture() {
  const agents = [
    perfAgent({ name: 'TL One', agentId: 'R100', id: 'R100', tlName: 'TL One', tlId: 'T1', priority: 'Medium', stockVc4: 30, stockNvc4: 10, stockTotal: 40, curVc4: 60, curNvc4: 10, curTotal: 70, lastVc4: 50, lastNvc4: 10, lastTotal: 60, tlStockVc4: 90, tlStockNvc4: 30, tlStockTotal: 120 }),
    perfAgent({ name: 'Ravi Kumar', agentId: 'R101', id: 'R101', tlName: 'TL One', tlId: 'T1', priority: 'High', stockVc4: 40, stockNvc4: 10, stockTotal: 50, curVc4: 100, curNvc4: 20, curTotal: 120, lastVc4: 80, lastNvc4: 20, lastTotal: 100, tlStockVc4: 90, tlStockNvc4: 30, tlStockTotal: 120 }),
    perfAgent({ name: 'Priya Sharma', agentId: 'R102', id: 'R102', tlName: 'TL One', tlId: 'T1', priority: 'Low', stockVc4: 20, stockNvc4: 10, stockTotal: 30, curVc4: 40, curNvc4: 10, curTotal: 50, lastVc4: 30, lastNvc4: 10, lastTotal: 40, tlStockVc4: 90, tlStockNvc4: 30, tlStockTotal: 120 })
  ];
  const mk = (id, name, cls, n) => ({ agentId: id, agentName: name, tlId: 'T1', tlName: 'TL One', cls, group: cls === 'VC4' ? 'VC4' : cls, n });
  const stockAgents = [mk('R100', 'TL One', 'VC4', 30), mk('R100', 'TL One', 'VC20', 10), mk('R101', 'Ravi Kumar', 'VC4', 40), mk('R101', 'Ravi Kumar', 'VC20', 10), mk('R102', 'Priya Sharma', 'VC4', 20), mk('R102', 'Priya Sharma', 'VC5', 10)];
  const agentClass = [
    { ym, channel: 'First Forward', name: 'TL One', tlName: 'TL One', cls: 'VC4', n: 60 }, { ym, channel: 'First Forward', name: 'TL One', tlName: 'TL One', cls: 'VC20', n: 10 },
    { ym, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC4', n: 100 }, { ym, channel: 'First Forward', name: 'Ravi Kumar', tlName: 'TL One', cls: 'VC20', n: 20 },
    { ym, channel: 'First Forward', name: 'Priya Sharma', tlName: 'TL One', cls: 'VC4', n: 40 }, { ym, channel: 'First Forward', name: 'Priya Sharma', tlName: 'TL One', cls: 'VC20', n: 10 }
  ];
  return { agents, stockAgents, agentClass };
}
/** GV me bhi wahi TL ("TL One") — 2 agents + TL ki apni stock rows */
function gvFixture() {
  return {
    report: [
      { agentId: 'G001', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'TL One', priority: 'High', stockVc4: 20, stockComm: 10, stockTotal: 30, stockByClass: { VC4: 20, VC20: 10 }, curDays: 15, curVc4: 60, curComm: 10, curTotal: 70, lastVc4: 40, lastComm: 10, lastTotal: 50, tlStockVc4: 60, tlStockComm: 40, tlStockTotal: 100 },
      { agentId: 'G002', agentName: 'GV Suresh', tlId: 'GT1', tlName: 'TL One', priority: 'Low', stockVc4: 20, stockComm: 20, stockTotal: 40, stockByClass: { VC4: 20, VC20: 20 }, curDays: 15, curVc4: 30, curComm: 10, curTotal: 40, lastVc4: 30, lastComm: 10, lastTotal: 40, tlStockVc4: 60, tlStockComm: 40, tlStockTotal: 100 }
    ],
    stockAgent: [{ agentId: 'G001', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'TL One', n: 30 }, { agentId: 'G002', agentName: 'GV Suresh', tlId: 'GT1', tlName: 'TL One', n: 40 }, { agentId: 'GT1', agentName: 'TL One', tlId: 'GT1', tlName: 'TL One', n: 30 }],
    stockAgentClass: [
      { agentId: 'G001', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'TL One', cls: 'VC4', n: 20 }, { agentId: 'G001', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'TL One', cls: 'Commercial', n: 10 },
      { agentId: 'G002', agentName: 'GV Suresh', tlId: 'GT1', tlName: 'TL One', cls: 'VC4', n: 20 }, { agentId: 'G002', agentName: 'GV Suresh', tlId: 'GT1', tlName: 'TL One', cls: 'Commercial', n: 20 },
      { agentId: 'GT1', agentName: 'TL One', tlId: 'GT1', tlName: 'TL One', cls: 'VC4', n: 20 }, { agentId: 'GT1', agentName: 'TL One', tlId: 'GT1', tlName: 'TL One', cls: 'Commercial', n: 10 }
    ]
  };
}
const person = (kind, name, sub = '') => ({ kind, name, sub, tlSet: new Set(), classMap: new Map(), bars: new Set() });

function mount({ ff, gv } = {}) {
  const data = { agentClass: [], agents: [], stockAgents: [], daily: [], ...ff };
  const gvData = { report: [], stockAgent: [], stockAgentClass: [], stockTl: [], ...gv };
  FF.store.need = async (k) => data[k] || [];
  FF.store.get = (k) => (k in data ? data[k] : []);
  FF.gv.need = async () => [];
  FF.gv.get = (k) => (k in gvData ? gvData[k] : []);
  FF.gv.rows = () => []; FF.gv.enabled = () => true; FF.gv.issuanceRows = () => []; FF.gv.masterRows = () => [];
  if (FF.gvTruth && FF.gvTruth.invalidateIndex) FF.gvTruth.invalidateIndex();
  FF.auth = { can: () => true, settings: {}, isAdmin: () => true };
  FF.pages = {
    performance: { ensureLoaded: async () => {}, agents: () => data.agents || [], daysElapsed: () => 15, dayLabels: () => ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
    gvPerformance: { sourceRows: () => gvData.report, ensureLoaded: async () => {} }
  };
  for (const f of ['masterProfile', 'kpiDetail', 'searchReport']) { delete require.cache[require.resolve(path.join(ROOT, `${f}.js`))]; require(path.join(ROOT, `${f}.js`)); }
  FF.masterProfile.invalidate();
  return { MP: FF.masterProfile, SR: FF.searchReport };
}
const html = (s) => String(s).replace(/&amp;/g, '&');

test('groupPeople: same naam FF + GV = ek group, TL kind agent kind par jeetta hai, alag naam alag group', () => {
  const { SR } = mount({ ff: ffFixture(), gv: gvFixture() });
  const groups = SR.groupPeople([
    person('ff-agent', 'TL One', 'R100'), person('ff-tl', 'TL One', 'T100'), person('gv-tl', 'tl one', 'T100'),
    person('ff-agent', 'Ravi Kumar', 'R101'), person('gv-id', 'zzz')
  ]);
  assert.equal(groups.length, 2, `TL One (FF+GV) aur Ravi Kumar: ${groups.map((g) => `${g.name}[${g.ff?.kind || '-'}:${g.ff?.sub || '-'}|${g.gv?.kind || '-'}:${g.gv?.sub || '-'}]`).join(', ')}`);
  const tl = groups.find((g) => /tl one/i.test(g.name));
  assert.equal(tl.ff.kind, 'ff-tl', 'FF me TL kind ne agent row ko replace kiya');
  assert.equal(tl.gv.kind, 'gv-tl');
  assert.deepEqual(SR.channelsOf(tl), ['ff', 'gv']);
  const ravi = groups.find((g) => /ravi/i.test(g.name));
  assert.equal(ravi.gv, null);
});

test('⚖ combined: last month · current · stock (own / agents / total) · class-wise — FF, GV aur jod', async () => {
  const { MP, SR } = mount({ ff: ffFixture(), gv: gvFixture() });
  const f = await MP.build(person('ff-tl', 'TL One', 'T1'));
  const g = await MP.build(person('gv-tl', 'TL One', 'GT1'));
  const out = html(SR.combinedHtml({ name: 'TL One' }, { ff: f, gv: g }));
  // numbers
  assert.ok(f.totals.curTotal > 0 && g.totals.curTotal > 0, 'dono channel ka current month aaya');
  const sumTxt = (a, b) => U.fmt(a + b);
  assert.ok(out.includes(`<b>${sumTxt(f.totals.curTotal, g.totals.curTotal)}</b>`), 'current month ka FF + GV jod');
  assert.ok(out.includes(`<b>${sumTxt(f.totals.lastTotal, g.totals.lastTotal)}</b>`), 'last month ka FF + GV jod');
  assert.ok(out.includes(`<b>${sumTxt(f.stock.total, g.stock.total)}</b>`), 'stock ka FF + GV jod');
  assert.equal(f.tlStock.own.total + f.tlStock.agents.total, f.stock.total);
  assert.equal(g.tlStock.own.total + g.tlStock.agents.total, g.stock.total);
  assert.match(out, /TL ke paas \(own\)/); assert.match(out, /Agents ke paas/); assert.match(out, /= TL total \(own \+ agents\)/);
  // drill-down har channel ke number par
  assert.match(out, /data-kpi="src=ff&scope=mtd&ym=[^"]*&tl=TL%20One"/, 'FF current → mtd drawer');
  assert.match(out, /data-kpi="src=gv&scope=mtd&ym=[^"]*&tl=TL%20One"/, 'GV current → mtd drawer');
  assert.match(out, /data-kpi="src=ff&scope=month&ym=[^"]*&tl=TL%20One&group=VC4"/, 'FF last month VC4');
  assert.match(out, /data-kpi="src=gv&scope=stock&tl=TL%20One&part=team"/, 'GV agents ke paas');
  assert.match(out, /data-kpi="src=ff&scope=stock&tl=TL%20One&f=vc4"/, 'FF VC4 stock');
  assert.match(out, /scope=people&tl=TL%20One&self=0&sort=stock/, 'Agents count → people drawer');
  // class-wise (union of FF + GV classes)
  assert.match(out, /Class-wise/);
  assert.match(out, /scope=stock&tl=TL%20One&cls=VC20/, 'class cell → us class ka stock');
  assert.match(out, /data-sr-open="ff"/); assert.match(out, /data-sr-open="gv"/);
});

test('combined: sirf ek channel me naam ho to dusra column "—" aur jod wahi', async () => {
  const { MP, SR } = mount({ ff: ffFixture(), gv: gvFixture() });
  const f = await MP.build(person('ff-agent', 'Ravi Kumar', 'R101'));
  const out = html(SR.combinedHtml({ name: 'Ravi Kumar' }, { ff: f, gv: null }));
  assert.match(out, /Is channel me ye naam nahi mila/);
  assert.ok(out.includes(`<b>${U.fmt(f.totals.curTotal)}</b>`), 'jod = FF ka hi number');
  assert.match(out, /src=ff&scope=mtd&ym=[^"]*&agent=Ravi%20Kumar&agentId=R101/);
});

test('⚖ missing Tag Assignment stock stays unavailable in combined reports; channel choice is explicit', () => {
  const { SR } = mount();
  const ff = {
    kind: 'ff-agent', ch: 'ff', channel: 'First Forward', months: { last: '2026-09', cur: '2026-10' },
    totals: { lastVc4: 2, lastComm: 1, lastTotal: 3, curVc4: 4, curComm: 1, curTotal: 5 },
    stock: { vc4: 5, comm: 2, total: 7 }, stockAvailable: true, stockClassAvailable: true,
    classes: [{ cls: 'VC4', last: 2, cur: 4, stock: 5 }]
  };
  const gv = {
    kind: 'gv-agent', ch: 'gv', channel: 'GV Partner', months: { last: '2026-09', cur: '2026-10' },
    totals: { lastVc4: 1, lastComm: 2, lastTotal: 3, curVc4: 2, curComm: 3, curTotal: 5 },
    stock: { vc4: 0, comm: 0, total: 0 }, stockAvailable: false, stockClassAvailable: false,
    classes: [{ cls: 'VC4', last: 1, cur: 2, stock: null }]
  };
  const group = { key: 'RAVI|both|R101', name: 'Ravi Kumar', ff: person('ff-agent', 'Ravi Kumar', 'R101'), gv: person('gv-agent', 'Ravi Kumar', 'G101') };
  assert.match(SR.channelChoiceHtml(group), /FF aur GV dono me mila/);
  assert.match(SR.channelChoiceHtml({ ...group, gv: null }), /Sirf First Forward match mila/);

  const out = html(SR.combinedHtml(group, { ff, gv }));
  const stockRow = out.match(/<tr class="row-total"><td><b>Agent stock<\/b>[\s\S]*?<\/tr>/);
  assert.ok(stockRow, 'stock total row exists');
  assert.match(stockRow[0], />7<\/td>/, 'known First Forward stock remains visible');
  assert.match(stockRow[0], /Tag Assignment stock unavailable/);
  assert.match(stockRow[0], /<td class="num sr-sum"><b>—<\/b><\/td>/, 'FF+GV total is not shown as an incomplete zero-filled sum');
});

test('render(): FF + GV dono ho to ⚖ / 🟦 / 🟩 tabs, ek hi channel ho to sirf wahi tab', () => {
  const { SR } = mount({ ff: ffFixture(), gv: gvFixture() });
  const pane = { dataset: {}, hidden: false };
  const root = { querySelectorAll: () => [], querySelector: () => pane, addEventListener() {} };
  const slot = { innerHTML: '', querySelector: () => root };
  const MPrenderInto = FF.masterProfile.renderInto; FF.masterProfile.renderInto = () => {}; FF.masterProfile._buildSoon = async () => ({});
  SR.render(slot, { key: 'TL ONE', name: 'TL One', ff: person('ff-tl', 'TL One', 'T1'), gv: person('gv-tl', 'TL One', 'GT1') });
  assert.match(slot.innerHTML, /data-sr-tab="both"/); assert.match(slot.innerHTML, /data-sr-tab="ff"/); assert.match(slot.innerHTML, /data-sr-tab="gv"/);
  SR.render(slot, { key: 'RAVI', name: 'Ravi', ff: person('ff-agent', 'Ravi', 'R1'), gv: null });
  assert.ok(!/data-sr-tab="both"/.test(slot.innerHTML) && !/data-sr-tab="gv"/.test(slot.innerHTML) && /data-sr-tab="ff"/.test(slot.innerHTML));
  FF.masterProfile.renderInto = MPrenderInto;
});

test('TL profile: agents table me Stock · Last · This month — VC4 / Comm / Total, har cell drill-down', async () => {
  const { MP } = mount({ ff: ffFixture() });
  const pr = await MP.build(person('ff-tl', 'TL One', 'T1'));
  const ravi = pr.agents.find((a) => a.name === 'Ravi Kumar');
  assert.deepEqual([ravi.lastVc4, ravi.lastComm, ravi.last, ravi.curVc4, ravi.curComm, ravi.cur], [80, 20, 100, 100, 20, 120]);
  const out = html(MP.html(pr));
  assert.match(out, /scope=month&ym=[^"]*&agent=Ravi%20Kumar&agentId=R101&group=VC4"/, 'last month VC4 → agent drawer');
  assert.match(out, /scope=mtd&ym=[^"]*&agent=Ravi%20Kumar&agentId=R101&group=COMM"/, 'current Comm → agent drawer');
  assert.match(out, /scope=mtd&ym=[^"]*&agent=Ravi%20Kumar&agentId=R101"[^>]*>120</, 'current total → agent drawer');
  assert.match(out, /mp-agents-tbl/);
  // footer: agents total + TL own + TL total — issuance bhi
  assert.match(out, /Agents total \(2\)/); assert.match(out, /= TL TOTAL \(own \+ agents\)/);
  // section nav
  for (const k of ['kpis', 'issuance', 'class', 'agents', 'agentclass', 'charts']) assert.match(out, new RegExp(`data-mp-go="${k}"`), `nav chip ${k}`);
  assert.match(out, /data-mp-sec="agents"/);
});

test('TL profile: Agent × Class stock matrix — cell = agent + class drill, totals reconcile', async () => {
  const { MP } = mount({ ff: ffFixture(), gv: gvFixture() });
  const pr = await MP.build(person('ff-tl', 'TL One', 'T1'));
  const ravi = pr.agents.find((a) => a.name === 'Ravi Kumar');
  assert.deepEqual(ravi.classStock, { VC4: 40, VC20: 10 });
  assert.deepEqual(pr.selfAgent.classStock, { VC4: 30, VC20: 10 });
  const out = html(MP.html(pr));
  assert.match(out, /Agent-wise × Class stock/);
  assert.match(out, /scope=stock&agent=Ravi%20Kumar&agentId=R101&cls=VC20"/);
  assert.match(out, /scope=stock&agent=Priya%20Sharma&agentId=R102&cls=VC5"/, 'agent ki apni class (VC5) bhi matrix me');
  const rowSum = pr.agents.concat(pr.selfAgent).reduce((s, a) => s + Object.values(a.classStock).reduce((x, y) => x + y, 0), 0);
  assert.equal(rowSum, pr.stock.total, 'matrix rows ka jod = TL total (120)');
  const gv = await MP.build(person('gv-tl', 'TL One', 'GT1'));
  const gvOut = html(MP.html(gv));
  assert.match(gvOut, /Agent-wise × Class stock/, 'GV TL ke liye bhi');
  assert.deepEqual(gv.agents.find((a) => a.name === 'GV Suresh').classStock, { VC4: 20, Commercial: 20 });
  assert.match(gvOut, /src=gv&scope=stock&agent=GV%20Suresh&agentId=G002&cls=Commercial/);
});

test('agent profile: matrix / nav ke "agents" chips nahi (sirf TL ke liye)', async () => {
  const { MP } = mount({ ff: ffFixture() });
  const pr = await MP.build(person('ff-agent', 'Ravi Kumar', 'R101'));
  const out = MP.html(pr);
  assert.ok(!/data-mp-go="agents"/.test(out) && !/Agent-wise × Class/.test(out));
  assert.match(out, /data-mp-go="issuance"/);
});

test('Agent / TL Summary: dusre channel me dekho switch (FF ↔ GV) + naam na mile to toast', async () => {
  mount({ ff: ffFixture(), gv: gvFixture() });
  delete require.cache[require.resolve(path.join(ROOT, 'agentSummary.js'))];
  require(path.join(ROOT, 'agentSummary.js'));
  const src = (await import('node:fs')).readFileSync(path.join(ROOT, 'agentSummary.js'), 'utf8');
  assert.match(src, /data-as-switch="\$\{otherCh\}"/);
  assert.match(src, /navigate\(`\$\{target\}AgentSummary`, \{ name: state\.report\.p\.name \}\)/);
  assert.match(src, /nahi mila — \$\{isGv \? 'FF' : 'GV'\} se dekho/);
});

test('wiring: searchReport.js masterSearch ke lazy dependencies me hai + SW shell derive', async () => {
  const fs = await import('node:fs');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'), lazy = fs.readFileSync(path.join(ROOT, 'lazy.js'), 'utf8');
  assert.ok(!idx.includes('searchReport.js'), 'searchReport core shell me eager nahi');
  assert.match(lazy, /masterSearch: \[\.\.\.PROFILE_DEPS, 'searchReport', 'masterSearch'\]/, 'masterSearch load order dependencies me hai');
  // v3.61: lazy modules SW me hard-coded nahi hote — precache list index.html se derive hoti hai aur
  // ?v= content fingerprint server deta hai (warna install par bekaar 2.5 MB download hota tha).
  assert.ok(!/searchReport\.js\?v=/.test(sw), 'lazy module SW precache me hard-coded nahi');
  assert.match(sw, /async function shellAssets\(/, 'SW shell assets index.html se padhta hai');
  assert.match(pkg, /searchReport/);
  const ms = fs.readFileSync(path.join(ROOT, 'masterSearch.js'), 'utf8');
  assert.match(ms, /data-ms-inline/); assert.match(ms, /groups\.length === 1/);
});
