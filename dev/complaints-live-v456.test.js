import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
test('v456 complaints live', () => {
  const s = fs.readFileSync('server.js', 'utf8'), c = fs.readFileSync('smartCenter.js', 'utf8');
  assert.match(s, /\/api\/complaints\/live/); assert.match(c, /cmpMount/); assert.match(c, /sc-cmp/);
  assert.doesNotMatch(fs.readFileSync('ux2.css', 'utf8'), /#ux2-spot/);
});
