/* v3.125.30 — Master Search deep link (?q=SUNIL MATALE&id=APN2405) must open the TL, not an agent whose TL ID is APN2405. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../masterSearch.js', import.meta.url), 'utf8');
const normId = (v) => String(v || '').replace(/\.0+$/, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const body = /function ownIdMatch[\s\S]*?\n  \}\n/.exec(src)[0];
const ownIdMatch = new Function('normId', `${body}; return ownIdMatch;`)(normId);

test('agent tlIds are not the agent\'s own identity; TL ids are', () => {
  const agent = { kind: 'ff-agent', name: 'CHOUHAN DHIRENDRA', sub: '30417192', ids: new Set(['30417192']), tlIds: new Set(['APN2405']) };
  const tl = { kind: 'ff-tl', name: 'SUNIL MATALE', sub: '', ids: new Set(), tlIds: new Set(['APN2405']) };
  assert.equal(ownIdMatch(agent, 'APN2405'), false);
  assert.equal(ownIdMatch(tl, 'APN2405'), true);
  assert.equal(ownIdMatch(agent, '30417192'), true);
});

test('deep link prefers the typed name among ID matches', () => {
  assert.match(src, /cands\.find\(\(p\) => normName\(p\.name\) === qn\)/);
  assert.match(src, /hits\.find\(\(g\) => normName\(g\.name\) === qn\) \|\| hits\[0\]/);
  assert.doesNotMatch(src, /\.\.\.\(p\.alias \|\| \[\]\), \.\.\.\(p\.tlIds \|\| \[\]\)\]\.some/);
});
