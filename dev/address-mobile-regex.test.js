// 🐛 v3.125.217 regression: Address book me agent ka mobile kabhi save nahi hota tha — server code me regex
// `/[^\\d+]/` (double backslash) tha jo saare DIGITS hata deta tha. Template-literal (browser JS) ke bahar
// aisa double-escaped regex kabhi nahi aana chahiye.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('server-side regex literals are not double-escaped (\\\\d / \\\\s / \\\\D)', () => {
  const lines = readFileSync(new URL('../server.js', import.meta.url), 'utf8').split('\n');
  // Browser ke liye string me likha JS (PERSONAL_PORTAL_JS = `(function () { … })();`) me double backslash sahi hai — use chhodo.
  let inTpl = false;
  const bad = [];
  lines.forEach((line, i) => {
    if (/= `\(function \(\) \{\s*$/.test(line)) { inTpl = true; return; }
    if (inTpl) { if (/^\s*\}\)\(\);`;?\s*$/.test(line)) inTpl = false; return; }
    const code = line.replace(/\/\/ .*$/, '');
    if (/\/[^/\n]*\\\\[dDsSwW][^/\n]*\/[gimuy]*/.test(code) && !code.includes('`') && !code.includes('new RegExp')) bad.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  assert.deepEqual(bad, []);
});

test('address book entry keeps the agent mobile digits', () => {
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const m = src.match(/const addressEntryFromRequest = \(req\) => \{[\s\S]*?const mobile = String\(a\.mobile \|\| a\.phone \|\| ''\)\.replace\((\/[^/]+\/g)/);
  assert.ok(m, 'mobile normaliser not found');
  const re = eval(m[1]); // eslint-disable-line no-eval
  assert.equal('98290 12345'.replace(re, ''), '9829012345');
});
