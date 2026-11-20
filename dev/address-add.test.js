import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const srv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const cli = fs.readFileSync(new URL('../addressBook.js', import.meta.url), 'utf8');
test('address add/edit: server routes + validation + per-term stats', () => {
  assert.match(srv, /\/api\/address-book\/save/);
  assert.match(srv, /\/api\/address-book\/lookup/);
  assert.match(srv, /termStats/);
  assert.match(srv, /Mobile number 10 digit ka sahi likho/);
  assert.match(srv, /if \(ex\.src === 'Tag request'\) \{[\s\S]*?e0\.key !== key/);   // v3.125.376 — tag request address bhi edit hota hai
});
test('address add/edit: popup + not-found panel client', () => {
  assert.match(cli, /function addModal/);
  assert.match(cli, /data-addterm/);
  assert.match(cli, /nahi mile/);
  assert.match(cli, /address-book\/save/);
});
test('master search card: address block + cleanup tag-request safe', () => {
  const ms = fs.readFileSync(new URL('../masterSearch.js', import.meta.url), 'utf8');
  assert.match(ms, /Address with Pincode - /);
  assert.match(ms, /Mobile Number - /);
  assert.match(srv, /tag-request wale keys kabhi delete nahi hote/);
  assert.match(srv, /tagKeys\.forEach\(\(k\) => dropKeys\.delete\(k\)\)/);
});
