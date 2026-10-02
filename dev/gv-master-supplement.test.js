/* 🩹 v3.42 — GV ledger = EIR + GV Master ka per-tag supplement.

   Pehle `eirDailyRows()` ek mahine ko poora skip kar deta tha jaise hi EIR me us mahine ka koi bhi GV row mil
   jaye. Natija: jo agent EIR me missing tha (ya jiska data GV Master me tha) uska „last month“ drawer me 0
   dikhta tha jabki GV REPORT / GV Master me uska issuance maujood tha — KPI aur drill alag-alag numbers dete
   the. Ab dedupe per tag (tagId → vrn → date|agent|class) hota hai, isliye GV Master ke sirf WOH rows judte
   hain jo EIR me nahi hain (double count nahi). */
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
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, title: '', hidden: false,
  body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, contains: () => true },
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
};
['config', 'util', 'model', 'store', 'charts', 'gv'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const U = FF.util;
const now = new Date();
const ym = U.ymKey(now), lastYm = U.prevMonthKey(ym);
const dayOf = (ymKey, d) => { const [y, m] = ymKey.split('-').map(Number); return new Date(y, m - 1, d); };

/** EIR daily (store) me sirf do GV rows — baaki GV Master me (jo EIR me nahi hai). */
function world() {
  const d1 = dayOf(lastYm, 5), d2 = dayOf(lastYm, 9);
  const store = {
    daily: [
      { channel: 'GV Partner', d: d1, key: U.dateKey(d1), ym: lastYm, day: 5, cls: 'VC4', group: 'VC4', type: 'ISSUANCE', vrnType: 'VRN', agentId: 'G1', agentName: 'GV One', tlId: 'GT1', tlName: 'GV TL', tagId: 'TAG-1', n: 1 },
      { channel: 'GV Partner', d: d2, key: U.dateKey(d2), ym: lastYm, day: 9, cls: 'VC4', group: 'VC4', type: 'ISSUANCE', vrnType: 'VRN', agentId: 'G2', agentName: 'GV Two', tlId: 'GT1', tlName: 'GV TL', tagId: 'TAG-2', n: 1 }
    ],
    agents: [], agentClass: [], stockAgents: []
  };
  const masterRow = (o) => ({ date: o.date, ym: lastYm, day: o.date.getDate(), agentId: o.id, agentName: o.name, tlId: 'GT1', tlName: 'GV TL', channel: 'GV Partner', cls: o.cls || 'VC4', group: (o.cls || 'VC4') === 'VC4' ? 'VC4' : 'VC20', status: 'Completed', tagType: 'VRN', tagId: o.tagId, vrn: o.vrn || '', serial: o.serial || '', n: 1 });
  FF.gv.state.data = {
    master: [
      masterRow({ id: 'G1', name: 'GV One', date: d1, tagId: 'TAG-1' }),                     // EIR me hai → duplicate nahi
      masterRow({ id: 'G1', name: 'GV One', date: d1, tagId: 'TAG-9', cls: 'VC20' }),        // EIR me nahi → judna chahiye
      masterRow({ id: 'G3', name: 'GV Three', date: d2, tagId: 'TAG-3' }),                   // poora agent hi EIR me nahi
      masterRow({ id: 'G3', name: 'GV Three', date: d2, tagId: 'TAG-4', cls: 'VC5' })
    ],
    report: [], stockAgent: [], stockAgentClass: []
  };
  FF.store.get = (k) => store[k];
  FF.store.need = async (k) => store[k] || [];
  FF.gv.need = async (k) => FF.gv.state.data[k] || [];
  return store;
}

test('GV Master ke missing tags EIR ke saath judte hain (aur duplicate nahi hote)', () => {
  world();
  const rows = FF.gv.issuanceRows();
  assert.equal(rows.length, 5, 'EIR (2) + Master ke sirf missing rows (3) — duplicate nahi');
  const one = rows.filter((r) => r.agentId === 'G1');
  assert.equal(one.length, 2, 'G1 ke dono tags (EIR ka TAG-1 + Master ka TAG-9)');
  assert.equal(rows.filter((r) => r.agentId === 'G2').length, 1, 'G2 ka EIR row ek hi baar');
  assert.equal(rows.filter((r) => r.agentId === 'G3').length, 2, 'G3 sirf Master se aata hai');
  assert.ok(rows.every((r) => r.channel === 'GV Partner'), 'sab GV rows');
});

test('purana per-month skip wapas na aaye — ek agent ka mahina doosre agent ke liye nahi khota', () => {
  const store = world();
  // EIR me is mahine ka sirf G2 hai; G1 ka data sirf GV Master me.
  store.daily = store.daily.filter((r) => r.agentId !== 'G1');
  const rows = FF.gv.issuanceRows().filter((r) => r.agentId === 'G1');
  assert.equal(rows.length, 2, 'G1 ke dono Master tags jud gaye (month-level skip nahi)');
  assert.ok(rows.every((r) => r.ym === lastYm), 'mahina sahi');
});

test('kpiDetail GV ka ledger bhi isi source se leta hai (KPI aur drill ek jaise)', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(path.join(ROOT, 'kpiDetail.js'), 'utf8'));
  assert.match(src, /FF\.gv\.issuanceRows\(\)/, 'GV rows gv layer se');
  assert.match(src, /rows\.filter\(\(r\) => r\.channel !== 'GV Partner'\)\.concat\(gvRows\.map\(mapGv\)\)/, 'store ke GV rows replace hote hain (double count nahi)');
});
