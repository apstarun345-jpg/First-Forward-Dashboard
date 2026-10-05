import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// v3.38 — employee link par "sabhi ka stock": dropdown me har agent/TL ka stock + last + MTD,
// aur ek 📦 stock board jahan se agent seedha form me jud jaata hai.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ls = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'util.js'));
require(path.join(ROOT, 'tagRequest.js'));
const FF = globalThis.FF;
const TR = FF.pages.tagRequest;
FF.auth = { user: { role: 'admin', username: 'owner', name: 'Owner' }, can: () => true, settings: {} };

const grp = (core, comm) => ({ core, comm });
const idx = {
  at: Date.now(), cur: '2026-10', last: '2026-09',
  byKey: new Map(),
  tls: new Map([
    ['ff|TL ONE', { key: 'ff|TL ONE', name: 'TL One', channel: 'ff', priority: 'High', agents: new Set(['ff|RAHUL SHARMA']), grp: grp({ stock: 30, last: 40, cur: 12 }, { stock: 20, last: 25, cur: 8 }) }]
  ]),
  list: [
    { key: 'ff|RAHUL SHARMA', channel: 'ff', name: 'RAHUL SHARMA', agentId: '1001', tlName: 'TL One', priority: 'High', stock: 30, last: 40, cur: 12, core: { stock: 20, last: 30, cur: 8 }, comm: { stock: 10, last: 10, cur: 4 } },
    { key: 'ff|PRIYA VERMA', channel: 'ff', name: 'PRIYA VERMA', agentId: '1002', tlName: 'TL One', priority: '', stock: 0, last: 5, cur: 0, core: { stock: 0, last: 5, cur: 0 }, comm: { stock: 0, last: 0, cur: 0 } },
    { key: 'gv|AMIT GUPTA', channel: 'gv', name: 'AMIT GUPTA', agentId: '2001', tlName: 'GV TL', priority: 'Medium', stock: 44, last: 12, cur: 30, core: { stock: 24, last: 7, cur: 18 }, comm: { stock: 20, last: 5, cur: 12 } }
  ]
};

test('recTotals — 🚗 core + 🚚 comm + total ek hi shape me', () => {
  const t = TR._test.recTotals({ grp: grp({ stock: 20, last: 30, cur: 8 }, { stock: 10, last: 10, cur: 4 }) });
  assert.deepEqual(t.core, { stock: 20, last: 30, cur: 8 });
  assert.deepEqual(t.comm, { stock: 10, last: 10, cur: 4 });
  assert.equal(t.stock, 30); assert.equal(t.last, 40); assert.equal(t.cur, 12);
  assert.deepEqual(TR._test.recTotals(null), { core: { stock: 0, last: 0, cur: 0 }, comm: { stock: 0, last: 0, cur: 0 }, stock: 0, last: 0, cur: 0 });
});

test('dropdown — naam likhte hi har agent ka stock · last · MTD dikhta hai', () => {
  TR._test.setIndex(idx);
  const row = { name: '', agentId: '', channel: '', tlFilter: '' };
  const items = TR._test.suggestItems('RAHUL', row);
  const rahul = items.find((x) => x.kind === 'agent' && x.name === 'RAHUL SHARMA');
  assert.ok(rahul, 'agent item mila');
  assert.equal(rahul.stock, 30); assert.equal(rahul.last, 40); assert.equal(rahul.cur, 12);
  const html = TR._test.suggestHtml(items);
  assert.match(html, /RAHUL SHARMA/);
  assert.match(html, /📦 stock <b>30<\/b> · last <b>40<\/b> · MTD <b>12<\/b>/, 'agent row par stock line');
  assert.match(html, /TL One/);
  // TL item par bhi stock (uske saare agents ka total)
  const tls = TR._test.suggestItems('TL ONE', row).filter((x) => x.kind === 'tl');
  assert.equal(tls.length, 1);
  assert.equal(tls[0].stock, 50); assert.equal(tls[0].last, 65); assert.equal(tls[0].cur, 20);
  assert.match(TR._test.suggestHtml(tls), /📦 stock <b>50<\/b>/);
  // khaali query par bhi stock line aati hai (employee link par list khulti hi dikhe)
  const all = TR._test.suggestHtml(TR._test.suggestItems('', row));
  assert.match(all, /📦 stock/);
  assert.ok(!/undefined|NaN/.test(all));
  TR._test.setIndex(null);
});

test('📦 stock board — sabhi agents ka stock · last · MTD + channel filter + search', () => {
  TR._test.setIndex(idx);
  TR._test.setStockBoard({ q: '', channel: 'both', limit: 40 });
  const shell = TR._test.stockBoardHtml();
  assert.match(shell, /id="tr-stock-card"/);
  assert.match(shell, /📦 Sabhi agents ka stock/);
  assert.match(shell, /data-tr-sb-search/);
  assert.match(shell, /data-tr-sb-ch="ff"/);
  assert.match(shell, /data-tr-sb-ch="gv"/);
  const table = TR._test.stockBoardTableHtml();
  for (const s of ['RAHUL SHARMA', 'PRIYA VERMA', 'AMIT GUPTA', '#1001', 'TL One', '🟩 GV', '🟦 FF']) assert.ok(table.includes(s), `board me "${s}"`);
  assert.match(table, /<td class="num tr-sb-total"><b>30<\/b><\/td>/, 'Rahul ka total stock');
  assert.match(table, /<td class="num tr-sb-total"><b>44<\/b><\/td>/, 'Amit ka total stock');
  assert.match(table, /3 agents<\/b>/, 'footer count');
  assert.match(table, /<b>74<\/b>/, 'grand total stock (30 + 0 + 44)');
  assert.ok(!/undefined|NaN/.test(table));

  // channel filter — sirf GV
  TR._test.setStockBoard({ channel: 'gv' });
  const gv = TR._test.stockBoardTableHtml();
  assert.ok(gv.includes('AMIT GUPTA') && !gv.includes('RAHUL SHARMA'), 'GV filter sirf GV agents');
  assert.match(TR._test.stockBoardChipsHtml(), /class="chip on" data-tr-sb-ch="gv"/, 'GV chip active hai');

  // search — zero stock wala agent bhi dikhe (employee ko pata chale kuch nahi bacha)
  TR._test.setStockBoard({ channel: 'both', q: 'priya' });
  const priya = TR._test.stockBoardTableHtml();
  assert.ok(priya.includes('PRIYA VERMA'), 'zero-stock agent bhi board me aata hai');
  assert.match(priya, /<td class="num tr-sb-total"><b>0<\/b><\/td>/, 'zero stock bhi saaf dikhta hai');

  // paging
  TR._test.setStockBoard({ q: '', limit: 2 });
  assert.match(TR._test.stockBoardTableHtml(), /⬇ Aur dikhao \(1 baaki\)/);
  TR._test.setIndex(null);
  TR._test.setStockBoard({ q: '', channel: 'both', limit: 40 });
});

test('stock board — admin ne OFF kiya to board bilkul nahi dikhta', () => {
  TR._test.setIndex(idx);
  assert.ok(TR._test.stockBoardHtml().includes('tr-stock-card'), 'default par board dikhta hai');
  assert.equal(TR._test.stockBoardHtml({ showStock: false }), '', 'showStock=false → koi board nahi');
  TR._test.setIndex(null);
});
