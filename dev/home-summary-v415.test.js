import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; const __dirname = fileURLToPath(new URL('.', import.meta.url));
test('v415 hooks exist', () => {
  const h = fs.readFileSync(__dirname + '/../home.js', 'utf8'), s = fs.readFileSync(__dirname + '/../server.js', 'utf8'), m = fs.readFileSync(__dirname + '/../ui-motion.js', 'utf8');
  assert.ok(h.includes('id="home-summary"') && h.includes('paintSummary') && h.includes('hm-stock-badge'));
  assert.ok(h.includes('data-od-d') && h.includes('data-od-done'));
  assert.ok(s.includes("get('days')") && s.includes("get('status') === 'done'"));
  assert.ok(m.includes('countUp') && m.includes('barGrow'));
});
