/* 🎛️ Operations Control Tower — v3.62 me page retire ho gaya (client request: simple dashboard).
   Ye test do cheezein lock karta hai:
     1. page sidebar/lazy se hat chuka hai (warna module background me load hota rahega),
     2. backend (/api/control-tower + snapshot compare) intact hai — module file bhi disk par hai,
        isliye purana code ya koi admin script toota nahi.
   (Purana "wiring is present" test retired behaviour ko lock karta tha — ab ulta lock hai.) */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('operations control tower page retired hai (sidebar + lazy se hata)', () => {
  const app = read('app.js');
  const lazy = read('lazy.js');
  assert.ok(!/id: 'controlTower'/.test(app), 'app.js PAGES me controlTower nahi hona chahiye');
  assert.ok(!/^\s{4}controlTower: \[/m.test(lazy), 'lazy GROUPS me controlTower nahi hona chahiye');
  assert.match(app, /controlTower: 'home'/, 'purana link home par redirect hota hai');
});

test('operations control tower ka backend + module abhi bhi safe hai', () => {
  const server = read('server.js');
  const page = read('controlTower.js');
  assert.match(server, /p === '\/api\/control-tower'/, 'API endpoint intact');
  assert.match(server, /resolveGvServerColumns/);
  assert.match(server, /Google Sheets serial date/);
  assert.match(page, /Operations Control Tower/);
  assert.match(page, /Snapshot Compare/);
  assert.match(page, /What Changed/);
  assert.match(page, /Action Center/);
});
