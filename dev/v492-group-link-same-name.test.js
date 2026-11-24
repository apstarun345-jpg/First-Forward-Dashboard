/* v3.125.492 — group personal link: same naam ke 2 agents (alag ID) dono alag member rehte hain aur ID se jude hain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('server: member dedup naam+ID se, GV query ID se, memBySrc ID rakhta hai', () => {
  const s = read('server.js');
  assert.match(s, /\$\{m\.source\}\|\$\{m\.name\.toLowerCase\(\)\}\|\$\{m\.id\.toUpperCase\(\)\}/);
  assert.match(s, /memBySrc\[src\]\.push\(\{ name: String\(m\.name\), id: String\(m\.id \|\| ''\) \}\)/);
  assert.match(s, /k\.id \? `upper\(\$\{col\.uid\}\) = \$\{gvizLiteral\(k\.id\)\}`/);
  assert.match(s, /function personalMemberKeys/);
  assert.match(s, /return gv && m && m\.id \? gvAgentName\(n, m\.id\) : n;/);
});

test('server: personalMemberKeys "Naam (ID)" se ID nikalta hai', () => {
  const s = read('server.js');
  const src = s.slice(s.indexOf('function personalMemberKeys'), s.indexOf('function personalMemberNames'));
  const fn = new Function(`${src}; return personalMemberKeys;`)();
  const out = fn({ members: [{ name: 'Ramesh (APS111)' }, { name: 'Ramesh', id: 'aps222' }, { name: 'Suresh' }] });
  assert.deepEqual(out, [{ name: 'Ramesh', id: 'APS111' }, { name: 'Ramesh', id: 'APS222' }, { name: 'Suresh', id: '' }]);
});

test('settings picker: same naam alag ID = alag chip + alag suggestion', () => {
  const s = read('settings.js');
  assert.match(s, /kind === 'agent' \? `\$\{src\}\|\$\{name\}\|\$\{String\(id \|\| ''\)\.toUpperCase\(\)\}`/);
  assert.match(s, /const twin = !want\.endsWith\('tl'\)/);
});
