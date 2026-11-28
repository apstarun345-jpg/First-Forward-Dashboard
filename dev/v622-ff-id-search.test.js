import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const rd = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
test('FF own-ID keeps FF card', () => { const s = rd('masterSearch.js'); assert.match(s, /keepFf \? p : canonicalPerson/); assert.match(s, /canonicalPeople\(out\.people, idx, ni\)/); });
test('multi-customer drawer uses quick gviz + cache', () => { const s = rd('server.js'); assert.match(s, /async function gvizPageQuick/); assert.match(s, /mcTagCache\.get\(ckey\)/); });
