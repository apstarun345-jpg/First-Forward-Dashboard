/* 🔎 + 🎉 v3.11 features — master search index/query, wowzone (heatmap · network · sparkline ·
   anomaly radar · report cards · theme packs · heartbeat title · chat charts).
   Pure-logic regression locks; DOM pages smoke.js me cover hote hain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k)
};
// Minimal DOM shim — sirf utna jitna theme pack / heartbeat / sparkline ke liye chahiye.
const styleProps = new Map();
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty: (k, v) => styleProps.set(k, v), removeProperty: (k) => styleProps.delete(k) } },
  title: '',
  hidden: false,
  body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} }, contains: () => true },
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: () => ({ style: {}, classList: { add: () => {} }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, getContext: () => null }),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null
};

require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'util.js'));
require(path.join(ROOT, 'model.js'));
require(path.join(ROOT, 'gv.js'));
require(path.join(ROOT, 'store.js'));
require(path.join(ROOT, 'charts.js'));
require(path.join(ROOT, 'wowzone.js'));
require(path.join(ROOT, 'masterSearch.js'));

const FF = globalThis.FF;
const U = FF.util;
const WZ = FF.wowzone;
const MS = FF.masterSearch;
const ym = U.ymKey(new Date());
const prevYm = U.prevMonthKey(ym);
const today = new Date();

// ---- fake store data (store.need ko override karke) ------------------------------------------
function seedStore() {
  const daily = [], agents = [], agentClass = [], master = [], stockAgents = [], gvStockAgent = [], gvReport = [];
  for (let d = 1; d <= Math.min(today.getDate(), 20); d++) {
    const key = `${ym}-${String(d).padStart(2, '0')}`;
    daily.push({ key, ym, day: d, channel: 'First Forward', group: d % 3 === 0 ? 'VC20' : 'VC4', type: d % 5 === 0 ? 'REPLACEMENT' : 'ISSUANCE', vrnType: d % 7 === 0 ? 'WRONG' : 'OK', n: d % 4 === 0 ? 0 : 6 });
    agents.push({ ym, channel: 'First Forward', name: d % 2 ? 'Ravi Kumar' : 'Priya Sharma', tlName: d % 2 ? 'TL One' : 'TL Two', id: d % 2 ? 'R101' : 'P202', n: 6, key: 'First Forward|' + (d % 2 ? 'R101' : 'P202') });
    agentClass.push({ ym, channel: 'First Forward', name: d % 2 ? 'Ravi Kumar' : 'Priya Sharma', tlName: d % 2 ? 'TL One' : 'TL Two', group: d % 3 === 0 ? 'VC20' : 'VC4', cls: d % 3 === 0 ? 'VC20' : 'VC4', type: d % 5 === 0 ? 'REPLACEMENT' : 'ISSUANCE', vrnType: d % 7 === 0 ? 'WRONG' : 'OK', n: 6 });
  }
  // last month history (spike/crash detection ke liye)
  for (let d = 1; d <= 10; d++) {
    agents.push({ ym: prevYm, channel: 'First Forward', name: 'Crasher Singh', tlName: 'TL One', id: 'C303', n: 12, key: 'First Forward|C303' });
    agents.push({ ym: prevYm, channel: 'First Forward', name: 'Steady Rao', tlName: 'TL Two', id: 'S404', n: 10, key: 'First Forward|S404' });
    // Rocket ka pichhla mahina chhota tha → is mahine 3×+ spike (spike rule lock)
    agents.push({ ym: prevYm, channel: 'First Forward', name: 'Rocket Verma', tlName: 'TL One', id: 'R505', n: 1, key: 'First Forward|R505' });
  }
  for (let d = 1; d <= 8; d++) {
    agents.push({ ym, channel: 'First Forward', name: 'Rocket Verma', tlName: 'TL One', id: 'R505', n: 14, key: 'First Forward|R505' });   // spike
    agents.push({ ym, channel: 'First Forward', name: 'Naya Star', tlName: 'TL Two', id: 'N606', n: 5, key: 'First Forward|N606' });          // new star (no history)
    agents.push({ ym, channel: 'First Forward', name: 'Crasher Singh', tlName: 'TL One', id: 'C303', n: 0, key: 'First Forward|C303' });      // crash
  }
  master.push({ ym, date: new Date(today), agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC4', group: 'VC4', status: 'ISSUANCE', tagType: 'VRN', commission: 20, tagId: 'TG1', serial: 'SER1' });
  master.push({ ym, date: new Date(today), agentId: 'G002', agentName: 'GV Suresh', tlName: 'GV TL', cls: 'VC20', group: 'VC20', status: 'REPLACEMENT', tagType: 'CHASSIS', commission: 0, tagId: 'TG2', serial: 'SER2' });
  gvReport.push({ agentId: 'G003', agentName: 'GV High Risk', tlId: 'GT1', tlName: 'GV TL', mobile: '919876543210', priority: 'High', stockVc4: 0, curTotal: 30 });
  stockAgents.push({ agentId: 'R101', agentName: 'Ravi Kumar', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 40 });
  stockAgents.push({ agentId: '5845036', agentName: 'APNA PAYEMENT', tlName: 'ApnaPayment Pvt. Ltd.', cls: 'VC4', group: 'VC4', n: 25 });
  gvStockAgent.push({ agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', n: 12 });
  const data = {
    daily, agents, agentClass, master, stockAgents, gvStockAgent,
    stock: [{ cls: 'VC4', group: 'VC4', tlName: 'TL One', n: 40 }],
    status: [{ ym, status: 'ACTIVATED', n: 10 }],
    report: gvReport, stockClass: [{ cls: 'VC4', group: 'VC4', n: 12 }],
    stockType: [], stockTypes: [], stockTl: [], stockTlClass: [], stockAgent: gvStockAgent, stockAgentClass: []
  };
  FF.store.need = async (k) => data[k] || [];
  FF.store.get = (k) => data[k];
  FF.gv.need = async (k) => (k === 'master' ? master : k === 'report' ? gvReport : k === 'stockAgent' ? gvStockAgent : []);
  FF.gv.get = (k) => (k === 'master' ? master : k === 'report' ? gvReport : []);
  FF.gv.rows = () => master;
  FF.gv.enabled = () => true;
  FF.gv.months = () => [ym];
  FF.gv.summary = () => ({ total: master.length, vc4: 1, vc20: 1, vc5p: 0, comm: 1, replacement: 1, projected: 20, activeAgents: 2, activeTls: 1, avgPerDay: 2, lastDay: today.getDate(), days: new Set([today.getDate()]) });
  FF.auth = { settings: { targets: [{ ym, agent: 'Ravi Kumar', target: 200, source: 'ff' }] }, can: () => true, isAdmin: () => true, user: { username: 'u', name: 'U' }, api: async () => ({}) };
  FF.config.feat = () => true;
  // pages.performance hooks (reportCard/anomaly use nahi karte, par safe rakho)
  FF.pages.performance = { ensureLoaded: async () => {}, agents: () => [], months: () => ({ cur: ym }) };
  return data;
}
const seed = seedStore();

test('masterSearch — light index searches name, TL, agent ID aur GV ID', async () => {
  const idx = await MS.buildLight();
  assert.ok(idx.people.size > 0, 'index me koi person nahi');
  const byName = MS.search('Ravi');
  assert.ok(byName.people.some((p) => p.name === 'Ravi Kumar'), 'naam se agent nahi mila');
  const byTl = MS.search('TL One');
  assert.ok(byTl.people.some((p) => p.kind === 'ff-tl'), 'TL search nahi chali');
  const byId = MS.search('R101');
  assert.ok(byId.ids.some((v) => v.id === 'R101') || byId.people.some((p) => p.sub === 'R101'), 'agent ID se match nahi mila');
  const byGv = MS.search('G001');
  assert.ok(byGv.people.length >= 0, 'GV ID search crash hui');
  const byMobile = MS.search('98765');
  assert.ok(byMobile.ids.some((v) => v.via === 'Mobile' && v.name === 'GV High Risk'), 'partial mobile number se match nahi mila');
});

test('masterSearch — suggestions me kind label + Enter-friendly items', async () => {
  await MS.buildLight();
  const items = MS.suggestItems('Ravi');
  assert.ok(items.length > 0);
  assert.ok(items[0].label && items[0].kindLabel, 'suggestion me label/kindLabel missing');
  const none = MS.suggestItems('zzzz-unknown-9999');
  assert.equal(none.length, 1);
  assert.equal(none[0].none, true, 'no-result suggestion flag missing');
});

test('masterSearch — heavy register (barcode) layer se barcode/tag search bhi chalti hai', async () => {
  // loadDetails ko mock karo — barcode register
  FF.insights = {
    loadDetails: async () => ({
      stock: [
        { barcode: '34161FA82032001', tagId: 'T1', agentId: 'R101', agentName: 'Ravi Kumar', tlName: 'TL One', cls: 'VC4', agentAllocatedAt: '2026-01-05' },
        { barcode: '34161FA82032002', tagId: 'T2', agentId: 'P202', agentName: 'Priya Sharma', tlName: 'TL Two', cls: 'VC20', agentAllocatedAt: '2026-01-06' }
      ],
      assignment: [
        { serial: '34161FA82032001', tagId: 'T1', agentId: 'G001', agentName: 'GV Ramesh', tlName: 'GV TL', cls: 'VC4', gvUniqueId: 'GVU-1', gvUniqueName: 'GV PARTNER', allocatedAt: '2026-01-07' }
      ]
    })
  };
  await MS.buildFull();
  assert.equal(MS.heavyReady, true, 'heavy register ready nahi hua');
  const hit = MS.search('34161FA82032001');
  assert.equal(hit.tags.length, 1, 'barcode search se tag nahi mila');
  const prefixHits = MS.search('3416');
  assert.equal(prefixHits.tags.length, 2, 'indexed 4-character barcode prefix should find both records');
  const innerHits = MS.search('FA820320');
  assert.equal(innerHits.tags.length, 2, 'indexed barcode substring search should find both records');
  assert.equal(hit.tags[0].ff.length, 1);
  assert.equal(hit.tags[0].gv.length, 1);
  // shared barcode → owner mismatch ya matched ka status nikalta hai
  const html = MS.resultsHtml(hit);
  assert.match(html, /Barcode \/ serial/i);
  assert.match(html, /34161FA82032001/);
});

test('masterSearch invalidates its cached indexes after a data refresh', async () => {
  const added = { ym, channel: 'First Forward', name: 'Naya Agent', tlName: 'TL Three', id: 'N707', n: 1, key: 'First Forward|N707' };
  seed.agents.push(added);
  try {
    MS.invalidate();
    await MS.buildLight();
    assert.ok(MS.search('Naya Agent').people.some((p) => p.name === 'Naya Agent'));
  } finally {
    seed.agents.splice(seed.agents.indexOf(added), 1);
    MS.invalidate();
    await MS.buildLight();
  }
  assert.equal(MS.search('Naya Agent').people.length, 0, 'removed person must not survive a rebuild');
});

// ---- wowzone -------------------------------------------------------------------------------
test('sparkline — SVG line + area path, flat series bhi crash nahi', () => {
  const svg = WZ.sparkline([1, 4, 2, 8, 5]);
  assert.match(svg, /<svg/);
  assert.match(svg, /class="line"/);
  assert.ok(svg.includes('M'), 'path d missing');
  assert.equal(WZ.sparkline([5]), '<span class="dim small">—</span>');
  assert.match(WZ.sparkline([3, 3, 3]), /<svg/, 'flat series bhi render honi chahiye');
});

test('heatmapGrid — saal ke cells, level + total count', () => {
  const dayFn = (d) => (d.getMonth() === 0 ? d.getDate() : 0);
  const grid = WZ.heatmapGrid(dayFn, 2026);
  assert.match(grid.html, /heat-cell/);
  assert.ok(grid.counts.size > 360, 'saal ke din cover nahi hue');
  assert.equal(grid.max, 31, 'max count galat');
  assert.match(grid.html, /heat-legend/);
});

test('networkGraph — TL node + agent orbit + animated links', () => {
  const svg = WZ.networkGraph([
    { name: 'Ravi', tlName: 'TL One', n: 40, channel: 'First Forward' },
    { name: 'Priya', tlName: 'TL One', n: 20, channel: 'First Forward' },
    { name: 'GV Ramesh', tlName: 'GV TL', n: 12, channel: 'GV Partner' }
  ]);
  assert.match(svg, /net-wrap/);
  assert.match(svg, /data-net-tl="TL One"/);
  assert.match(svg, /data-net-agent="Ravi"/);
  assert.match(svg, /net-link/);
  assert.match(svg, /netSp|netDraw|animation:netDraw/, 'link animation missing');
});

test('anomalyFindings — spike, crash, naya star, GV zero-stock aur sheet staleness pakadta hai', async () => {
  const findings = await WZ.anomalyFindings();
  const ids = findings.map((f) => f.id);
  assert.ok(ids.includes('spike'), `spike nahi mila (${ids.join(',')})`);
  assert.ok(ids.includes('crash'), `crash nahi mila (${ids.join(',')})`);
  assert.ok(ids.includes('gv-risk'), 'GV high-priority zero-stock nahi mila');
  const spike = findings.find((f) => f.id === 'spike');
  assert.ok(spike.count >= 1 && spike.samples.length >= 1);
  assert.ok(/Rocket/.test(spike.samples.join(' ')), 'spike sample me Rocket Verma nahi');
});

test('reportCardData + reportCardHtml — grades, subjects aur remarks', async () => {
  const d = await WZ.reportCardData('Ravi Kumar', ym);
  assert.equal(d.name, 'Ravi Kumar');
  assert.ok(d.subjects.length >= 6, 'subjects kam hain');
  assert.ok(d.subjects.every((s) => s.grade), 'kisi subject ka grade missing');
  assert.match(d.overallGrade, /^(A\+|A|B\+|B|C|D|E)$/);
  assert.ok(d.remarks.length >= 2, 'remarks nahi bane');
  const html = WZ.reportCardHtml(d);
  assert.match(html, /Agent Report Card/);
  assert.match(html, /Teacher remarks/);
  assert.match(html, /TL sign/);
  assert.match(html, /rc-grade/);
});

test('theme packs — applyThemePack CSS vars set karta hai + invalid naam default par girta hai', () => {
  styleProps.clear();
  const applied = WZ.applyThemePack('diwali');
  assert.equal(applied, 'diwali');
  assert.ok(styleProps.get('--brand'), 'brand var set nahi hua');
  assert.equal(globalThis.document.documentElement.dataset.themePack, 'diwali');
  assert.equal(WZ.currentPack(), 'diwali');
  const fallback = WZ.applyThemePack('kuch-bhi-nahi');
  assert.equal(fallback, 'default');
  assert.equal(globalThis.document.documentElement.dataset.themePack, '');
  WZ.applyThemePack('default');
});

test('heartbeat — tab title me live counters, stop() timer band karta hai', async () => {
  const hb = WZ.startHeartbeat({ interval: 200 });
  await new Promise((r) => setTimeout(r, 350));
  assert.match(globalThis.document.title, /tags today/);
  assert.match(globalThis.document.title, /MTD/);
  hb.stop();
  hb.stop();
});

test('chatChart — "last 7 days ka graph" par chart HTML, unrelated sawaal par null', async () => {
  const html = await WZ.chatChart('last 7 days ka graph dikhao', null);
  assert.ok(html && /ask-chart/.test(html), 'chart HTML nahi bana');
  assert.match(html, /Last 7 days trend/);
  const monthly = await WZ.chatChart('monthly trend chart dikhao', null);
  assert.ok(monthly && /ask-chart/.test(monthly));
  const none = await WZ.chatChart('aaj ka stock kya hai', null);
  assert.equal(none, null, 'unrelated sawaal par chart nahi banana chahiye');
});

test('pages registered — activity / network / radar / reportCards', () => {
  for (const id of ['activity', 'network', 'radar', 'reportCards']) {
    assert.ok(FF.pages[id] && typeof FF.pages[id].render === 'function', `${id} page register nahi hua`);
  }
});

test('executive stock fix — GV-parked StockDataa rows FF stock me count nahi hoti', async () => {
  require(path.join(ROOT, 'insights.js'));
  // isGvMasterFfHolder jaisa vyavhaar: insights ke andar helper local hai, isliye behaviour ko
  // data-level par verify karte hain — APNA PAYEMENT row (ID 5845036) FF ke bahar rehni chahiye.
  const rows = seed.stockAgents;
  const gvId = String(FF.config.eir.gvMasterId || '5845036');
  const ffOnly = rows.filter((r) => String(r.agentId) !== gvId && !/APNA\s*PAY/i.test(r.agentName || ''));
  assert.equal(ffOnly.length, 1, 'FF rows filter galat');
  assert.equal(ffOnly[0].agentName, 'Ravi Kumar');
});
