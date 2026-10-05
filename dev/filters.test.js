/* 🧭 Workspace filters + 🔁 FF issuance lag (T+1) — v3.21
   ---------------------------------------------------------------------------------------------
   User qaida:
     • FF (First Forward / EIR) ka issuance data T+1 aata hai — aaj ka data kal.
     • GV Partner (EIR me master ID 5845036 ki rows) live chalta hai.
     • TODAY  → GV ka live number dikhe, FF = 0 (with note).
     • YESTERDAY → GV + FF dono.
   Aur: workspace filter bar (period / channel / TL / agent / class) ka asar har page par ho —
   pehle Home par bilkul nahi hota tha. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ls = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'util.js'));
require(path.join(ROOT, 'filters.js'));
const FF = globalThis.FF;
const U = FF.util;

const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return U.dateKey(d); };
const TODAY = day(0), YESTERDAY = day(-1), DAYBEFORE = day(-2);
const dkey = (k) => U.fromDateKey(k);

/** EIR daily jaisa row (model.loadDaily ka shape). */
const row = (key, channel, agentName, tlName, cls, n, o = {}) => ({
  key, date: dkey(key), ym: key.slice(0, 7), day: Number(key.slice(8, 10)),
  channel, agentName, agentId: o.agentId || '', tlName, cls,
  group: o.group || (['4', '4A'].includes(cls) ? 'VC4' : ['20'].includes(cls) ? 'VC20' : 'VC5+'),
  type: o.type || 'ISSUANCE', vrnType: o.vrnType || 'NEW VRN', n
});

test('FF lag: aaj ki FF rows count me nahi aati, GV live rehta hai', () => {
  const rows = [
    row(TODAY, 'GV Partner', 'GV Ramesh', 'ApnaPayment Pvt. Ltd.', '20', 7),
    row(TODAY, 'First Forward', 'FF Suresh', 'TL One', '4', 3),
    row(YESTERDAY, 'First Forward', 'FF Suresh', 'TL One', '4', 5),
    row(YESTERDAY, 'GV Partner', 'GV Ramesh', 'ApnaPayment Pvt. Ltd.', '4', 2)
  ];
  assert.equal(FF.filters.ffLagDays(), 1, 'default lag 1 din');
  assert.equal(FF.filters.ffLagOn(), true);
  assert.equal(FF.filters.ffReportedThrough(), YESTERDAY);
  const kept = FF.filters.dropLaggedFf(rows);
  assert.equal(kept.length, 3, 'aaj ki FF row drop, GV row rahe');
  assert.ok(kept.some((r) => r.channel === 'GV Partner' && r.key === TODAY), 'GV aaj live');
  assert.ok(!kept.some((r) => r.channel === 'First Forward' && r.key === TODAY), 'FF aaj 0');
  assert.equal(FF.filters.isFfPending(TODAY), true);
  assert.equal(FF.filters.isFfPending(YESTERDAY), false, 'kal ka FF available hai');
});

test('today view → GV live, FF 0; yesterday view → GV + FF dono', () => {
  const rows = [
    row(TODAY, 'GV Partner', 'GV Ramesh', 'ApnaPayment Pvt. Ltd.', '4', 6),
    row(TODAY, 'First Forward', 'FF Suresh', 'TL One', '4', 9),
    row(YESTERDAY, 'First Forward', 'FF Suresh', 'TL One', '4', 4),
    row(YESTERDAY, 'GV Partner', 'GV Ramesh', 'ApnaPayment Pvt. Ltd.', '20', 1)
  ];
  const f = { ...FF.filters.DEFAULTS, period: 'today', month: '', from: TODAY, to: TODAY };
  const today = FF.filters.issuance(rows, { src: 'both', filters: f });
  assert.equal(FF.filters.sum(today.filter((r) => r.channel === 'GV Partner'), (r) => r.n), 6, 'GV aaj live');
  assert.equal(FF.filters.sum(today.filter((r) => r.channel !== 'GV Partner'), (r) => r.n), 0, 'FF aaj 0');

  const fy = { ...FF.filters.DEFAULTS, period: 'yesterday', month: '', from: YESTERDAY, to: YESTERDAY };
  const yest = FF.filters.issuance(rows, { src: 'both', filters: fy });
  assert.equal(FF.filters.sum(yest.filter((r) => r.channel === 'GV Partner'), (r) => r.n), 1);
  assert.equal(FF.filters.sum(yest.filter((r) => r.channel !== 'GV Partner'), (r) => r.n), 4, 'kal FF + GV dono');
});

test('channel / class / TL / agent filters sach me rows hataate hain', () => {
  const rows = [
    row(YESTERDAY, 'GV Partner', 'GV Ramesh', 'ApnaPayment Pvt. Ltd.', '4', 5),
    row(YESTERDAY, 'First Forward', 'FF Suresh', 'TL One', '20', 3),
    row(DAYBEFORE, 'First Forward', 'FF Meena', 'TL Two', '5', 2)
  ];
  const base = { ...FF.filters.DEFAULTS, from: DAYBEFORE, to: YESTERDAY, month: '' };
  assert.equal(FF.filters.issuance(rows, { filters: base }).length, 3);
  assert.equal(FF.filters.issuance(rows, { filters: { ...base, channel: 'gv' } }).length, 1, 'channel=GV');
  assert.equal(FF.filters.issuance(rows, { filters: { ...base, channel: 'ff' } }).length, 2, 'channel=FF');
  assert.equal(FF.filters.issuance(rows, { filters: { ...base, cls: 'VC20' } }).length, 1, 'class');
  assert.equal(FF.filters.issuance(rows, { filters: { ...base, cls: 'VC4' } }).length, 1, 'class VC4 → group match');
  assert.equal(FF.filters.issuance(rows, { filters: { ...base, tl: 'TL One' } }).length, 1, 'TL');
  assert.equal(FF.filters.issuance(rows, { filters: { ...base, agent: 'meena' } }).length, 1, 'agent (case-insensitive)');
});

test('legacy saved workspace filters no longer affect a page without URL filters', () => {
  localStorage.setItem('ff_global_filters', JSON.stringify({ period: 'today', channel: 'gv', tl: 'stale TL', agent: 'stale agent', cls: 'VC4' }));
  FF.app = { current: { page: 'home', params: {} } };
  const filters = FF.filters.current();
  assert.equal(filters.period, 'month', 'page default remains current month');
  assert.equal(filters.channel, '', 'old saved channel is ignored');
  assert.equal(filters.tl, '', 'old saved TL is ignored');
  assert.equal(filters.agent, '', 'old saved agent is ignored');
  assert.equal(filters.cls, '', 'old saved class is ignored');
  localStorage.removeItem('ff_global_filters');
});

test('period bounds: today / yesterday / week / month / all', () => {
  assert.deepEqual(FF.filters.bounds({ period: 'today', month: '' }), { from: TODAY, to: TODAY });
  assert.deepEqual(FF.filters.bounds({ period: 'yesterday', month: '' }), { from: YESTERDAY, to: YESTERDAY });
  const week = FF.filters.bounds({ period: 'week', month: '' });
  assert.equal(week.to, TODAY);
  assert.equal(week.from, day(-6));
  const all = FF.filters.bounds({ period: 'all', month: '' });
  assert.deepEqual(all, { from: '', to: '' });
  const month = FF.filters.bounds({ period: 'month', month: TODAY.slice(0, 7) });
  assert.equal(month.from, `${TODAY.slice(0, 7)}-01`);
});

test('lag off karne par (ffIssuanceLagDays = 0) purana behaviour wapas', () => {
  const rows = [row(TODAY, 'First Forward', 'FF Suresh', 'TL One', '4', 3)];
  const prev = FF.config.ffIssuanceLagDays;
  try {
    FF.config.ffIssuanceLagDays = 0;
    assert.equal(FF.filters.ffLagOn(), false);
    assert.equal(FF.filters.ffVisible(rows[0]), true);
    assert.equal(FF.filters.dropLaggedFf(rows).length, 1, 'lag off → aaj ki FF rows bhi dikhein');
  } finally { FF.config.ffIssuanceLagDays = prev; }
});

test('lag note sirf un filters par jahan aaj shaamil ho', () => {
  const withToday = FF.filters.lagNote({ from: YESTERDAY, to: TODAY });
  assert.match(withToday, /FF data T\+1/, 'aaj wale range par note');
  const past = FF.filters.lagNote({ from: DAYBEFORE, to: YESTERDAY });
  assert.equal(past, '', 'poora past range → koi note nahi');
});
