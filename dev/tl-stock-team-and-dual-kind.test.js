import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('Master Search: a person who is both GV agent and GV TL keeps both kinds', () => {
  const ms = read('masterSearch.js');
  assert.match(ms, /if \(\/\^gv-\(agent\|tl\)\$\/\.test\(String\(p\.kind \|\| ''\)\)\) return p;/);
});

test('TL stock drill: colourful team table with TL header, own row, class columns, total', () => {
  const kd = read('kpiDetail.js');
  assert.match(kd, /function teamStockTable/);
  assert.match(kd, /team stock/);
  assert.match(kd, /tm-self/);
  assert.match(kd, /tm-grand/);
  assert.equal((kd.match(/teamStockTable\(/g) || []).length >= 3, true);
  assert.match(kd, /data-tm-go/);
  assert.match(read('dev/styles-full.css'), /\.tm-sec/);
});

test('TL own stock: TL ki apni agent-row (agent ID == TL ID) kisi aur TL ke neeche ho tab bhi TL total me judti hai', () => {
  const mp = read('masterProfile.js');
  assert.match(mp, /const isOwnId = \(r\) => !!wantId && rowAgentId\(r\) === wantId;/);
  assert.match(mp, /const ownOk = \(r\) => belongsToTl\(r, name, id\) \|\| isOwnId\(r\);/);
  assert.equal((mp.match(/ownOk\(r\)/g) || []).length >= 3, true);
});
