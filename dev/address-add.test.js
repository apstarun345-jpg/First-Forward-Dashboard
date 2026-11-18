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
  assert.match(srv, /Tag request ka address yahan edit nahi hota/);
});
test('address add/edit: popup + not-found panel client', () => {
  assert.match(cli, /function addModal/);
  assert.match(cli, /data-addterm/);
  assert.match(cli, /nahi mile/);
  assert.match(cli, /address-book\/save/);
});
