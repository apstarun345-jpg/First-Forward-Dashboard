/* Stock Excel export header regression.

   Bug: Settings → manual range (e.g. A5:M) change karne par gviz range ki pehli ROW ko header
   maan leta hai — jo ki ek data row hai. Excel (Summary + StockDataa rows) download me "header"
   me hi IDs aur bahut saare naam aa jaate the, aur wo row export se gayab ho jaati thi.

   loadStockRows ab:
     1. data-like header pehchanta hai → config (stock.id='A' …) se sahi naam bana deta hai,
     2. gviz ne khedi data row ko wapas rows me jod deta hai (koi row drop nahi),
     3. column letters ko manual range ke START column se absolute maanta hai,
     4. sahi header aane par usi ko use karta hai (koi behaviour change nahi). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFile(path.join(ROOT, name), 'utf8');

// util.js ke zaroori helpers (model.js sirf inhe use karta hai yahan)
const U = {
  clean: (s) => String(s ?? '').trim(),
  colLetter: (index) => { let s = ''; let i = index + 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; },
  colIndex: (letter) => { let n = 0; for (const ch of String(letter).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
};
const cell = (v) => (v === null || v === undefined ? null : { v });

/** model.js load karo jisme data.query ek hi table return karta hai. */
async function loadModel(table, tab) {
  const context = vm.createContext({
    window: { FF: {
      util: U,
      config: { stock: {
        sheet: 'StockDataa',
        id: 'A', name: 'B', tagId: 'C', barcode: 'D', cls: 'E', tagType: 'F', bcAllocatedAt: 'G',
        agentId: 'H', agentName: 'I', agentAllocatedAt: 'J', tlName: 'K'
      }, sheetByName: (name) => (name === 'StockDataa' ? tab : null) },
      data: {
        query: async () => table,
        lit: (v) => `"${v}"`,
        textRows: (t) => t.rows.map((r) => t.cols.map((c, i) => (r[i] && r[i].v !== undefined && r[i].v !== null) ? String(r[i].v) : ''))
      }
    } },
    console
  });
  vm.runInContext(await read('model.js'), context, { filename: 'model.js' });
  return context.window.FF.model;
}

const CONFIG_HEADER = ['ID', 'Name', 'Tag ID', 'Barcode', 'Class', 'Tag Type', 'BC Allocated At', 'Agent ID', 'Agent Name', 'Agent Allocated At', 'TL Name'];

test('manual range ki data row header ban gayi thi → config se sahi header + row wapas milti hai', async () => {
  // gviz ne range ki pehli (data) row ko hi header maan liya — isi me IDs / naam the.
  const dataRow = ['100123', 'Rahul Sharma', 'FF99887766', '1234567890123', '4', '4', '15/03/2026 10:05', 'AGT-1052', 'Amit Verma', '16/03/2026 09:00', 'RAHUL TL', 'Direct', 'Extra'];
  const otherRows = [
    [cell('100124'), cell('Sunil Kumar'), cell('FF11223344'), cell('4567891234567'), cell('4'), cell('4'), cell('17/03/2026 11:00'), cell('AGT-1053'), cell('Sunil Kumar'), cell('17/03/2026 11:00'), cell('RAHUL TL'), cell('x'), cell('y')],
    [cell('100125'), cell('Asha Devi'), cell('FF55667788'), cell('9998887776665'), cell('20'), cell('20'), cell('18/03/2026 12:00'), cell('AGT-1054'), cell('Asha Devi'), cell('18/03/2026 12:00'), cell('RAHUL TL'), cell('x'), cell('y')]
  ];
  const table = {
    headers: 1,
    cols: dataRow.map((label, i) => ({ id: `c${i}`, label, type: 'string' })),
    rows: otherRows
  };
  // Manual range header row ke upar se shuru hoti hai (user ne Settings me range badli thi).
  const model = await loadModel(table, { id: 'StockDataa', tab: 'StockDataa', range: 'A5:M', startCol: 'A', startRow: '5' });
  const out = await model.loadStockRows({ agent: 'Rahul Sharma' });

  assert.deepEqual(out.header.slice(0, 11), CONFIG_HEADER, 'header me config ke sahi naam aane chahiye (IDs / naam nahi)');
  assert.equal(out.header.length, 13, 'L / M jaise non-config columns bhi header me hone chahiye');
  // gviz ne jo data row "header" banai thi wo wapas pehli row ban kar aani chahiye.
  assert.equal(out.rows.length, 3, 'ek bhi StockDataa row drop nahi honi chahiye');
  assert.deepEqual(out.rows[0], dataRow, 'khedi gayi data row wapas row-1 honi chahiye');
  assert.equal(out.rows[1][1], 'Sunil Kumar');
});

test('sahi header (real sheet header) ko waisa hi rehne diya jata hai', async () => {
  const labels = [...CONFIG_HEADER, 'Status', 'Remark'];
  const table = {
    headers: 1,
    cols: labels.map((label, i) => ({ id: `c${i}`, label, type: 'string' })),
    rows: [[cell('100123'), cell('Rahul Sharma'), cell('FF99887766'), cell('123'), cell('4'), cell('4'), cell('15/03/2026'), cell('AGT-1'), cell('Rahul Sharma'), cell('15/03/2026'), cell('T1'), cell('OK'), cell('')]]
  };
  const model = await loadModel(table, { id: 'StockDataa', tab: 'StockDataa', range: '', startCol: 'A', startRow: '1' });
  const out = await model.loadStockRows({});
  assert.deepEqual(out.header, labels, 'asli header text preserve rehna chahiye');
  assert.equal(out.rows.length, 1, 'data rows jaisi the waisi');
});

test('gviz ne header parse nahi kiya (letters) → config ke naam lagte hain', async () => {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
  const table = {
    headers: 0,
    cols: letters.map((label, i) => ({ id: label, label, type: 'string' })),
    rows: [[cell('100123'), cell('Rahul Sharma'), cell('FF99887766'), cell('123'), cell('4'), cell('4'), cell('15/03/2026'), cell('AGT-1'), cell('Rahul Sharma'), cell('15/03/2026'), cell('T1')]]
  };
  const model = await loadModel(table, { id: 'StockDataa', tab: 'StockDataa', range: 'A1:K', startCol: 'A', startRow: '1' });
  const out = await model.loadStockRows({});
  assert.deepEqual(out.header, CONFIG_HEADER, 'letter labels ko config naam se badalna chahiye');
  assert.equal(out.rows.length, 1);
});

test('range column A se na shuru ho (B2:M) to letters ABSOLUTE sheet columns se map hote hain', async () => {
  // Range B se shuru → pehli returned column sheet ka column B (Name), A (ID) bahar hai.
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const table = {
    headers: 0,
    cols: letters.map((label, i) => ({ id: label, label, type: 'string' })),
    rows: [[cell('Rahul Sharma'), cell('FF99887766'), cell('123'), cell('4'), cell('4'), cell('15/03/2026'), cell('AGT-1'), cell('Rahul Sharma'), cell('15/03/2026'), cell('T1'), cell('x'), cell('y')]]
  };
  const model = await loadModel(table, { id: 'StockDataa', tab: 'StockDataa', range: 'B2:M', startCol: 'B', startRow: '2' });
  const out = await model.loadStockRows({});
  assert.equal(out.header[0], 'Name', 'range B se shuru → pehla column ID nahi, Name hona chahiye');
  assert.equal(out.header[1], 'Tag ID');
  assert.equal(out.header[10], 'L', 'config ke bahar ka column letter me chahiye');
});
