/* 🌙 v3.125.537 — Raat ka gviz save: IST 01:05+ ke baad roz ek baar hot queries force-refresh + snapshot/disk save;
   restore ages 26h (raat ka save din bhar chale); nav hover/tap par page ka store data bhi warm (rows instant). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const S = read('server.js');
const A = read('app.js');
const L = read('lazy.js');

test('nightly save: function + boot/interval wiring (IST 01:05+ gate, once per day, memory defer)', () => {
  assert.match(S, /async function nightlyGvizSave\(/, 'raat ka save function defined');
  assert.match(S, /nightlyGvizSave\('boot'\)/, 'boot par bhi check (01:05+ ho to abhi save)');
  assert.match(S, /nightlyGvizSave\('tick'\)/, '10-min interval se roz check');
  assert.match(S, /mins < 65/, '01:05 IST se pehle nahi — raat ka data aane do');
  assert.match(S, /nightlyState\.day === istDay\(\)/, 'IST day gate — roz ek hi baar');
  assert.match(S, /rssMB\(\) > 360/, 'memory ooncha ho to defer (restart/502 se bachne ke liye)');
});

test('nightly save: force warm + Sheet snapshot + disk save, single-flight with boot warm', () => {
  assert.match(S, /hotWarm\('night', true\)/, 'raat ko force=true — freshness bypass, cooldown on');
  assert.match(S, /async function hotWarm\(reason, force\)/, 'hotWarm ka force param');
  assert.match(S, /!force && hit && cacheFresh\(u, hit\)/, 'force par cacheFresh skip hota hai');
  assert.match(S, /hotSaveMaybe\(true\)/, 'aaj ki hot list durable settings me');
  assert.match(S, /nightlyState\.day = istDay\(\);/, 'pehle mark — double-run band');
  assert.match(S, /if \(hotState\.running\) return nightlyState/, 'boot warm chal raha to wait');
  // wiring: boot setTimeout + interval, hotWarm('boot') ke saath
  assert.match(S, /setTimeout\(\(\) => \{ nightlyGvizSave\('boot'\)/, 'boot timeout wiring');
  assert.match(S, /setInterval\(\(\) => \{ nightlyGvizSave\('tick'\)/, 'interval wiring');
});

test('restore ages 26h: disk cache + gviz Sheet snapshot + save-side entry filter', () => {
  assert.match(S, /CACHE_DISK_MAX_AGE_MS = 26 \* 3600e3/, 'disk cache restore/save window 26h');
  assert.match(S, /GVIZ_SNAP_AGE = 26 \* 3600e3/, 'Sheet snapshot restore window 12h → 26h');
  // save-side filter bhi 26h — warna raat ki entries save hi nahi hoti
  assert.match(S, /now - e\.at > GVIZ_SNAP_AGE\) continue/, 'gvizSnapSave entry filter GVIZ_SNAP_AGE par');
  // freshness semantics wahi: daily tab signature + 26h, baaki cacheMs
  assert.match(S, /const DAILY_MAX_MS = 26 \* 3600e3/, 'DAILY_MAX_MS alignment');
  assert.match(S, /hit\.ver === dailySig\(k\) && Date\.now\(\) - hit\.at < DAILY_MAX_MS/, 'cacheFresh daily window');
});

test('app.js: DATA_WARM map + prefetchFrom hover/tap par store data warm (rows instant)', () => {
  assert.match(A, /const DATA_WARM = \{/, 'page id → store dataset keys map');
  assert.match(A, /stock: \['stock', 'stockAgents', 'stockTypes', 'daily', 'agents', 'agentClass'\]/, 'Stock page datasets');
  assert.match(A, /tagIssued: \['daily'\]/, 'Issuance page dataset');
  assert.match(A, /masterSearch: \['agents', 'stockAgents', 'daily', 'agentClass'\]/, 'Master Search datasets (person views: masterProfile.js needs)');
  assert.match(A, /function warmPageData|const warmPageData/, 'warm helper');
  assert.match(A, /FF\.store\.need\(k, \{ only: true \}\)/, 'store.need only:true — full preload nahi');
  assert.match(A, /warmPageData\(id\)/, 'prefetchFrom se warm call');
  assert.match(A, /FF\.warmPageData = warmPageData/, 'lazy.js intent se bhi warm (focusin)');
  // auth guard: login se pehle data load nahi
  assert.match(A, /!FF\.auth \|\| !FF\.auth\.user \|\| !FF\.store \|\| !FF\.store\.need/, 'auth/store guard');
});

test('lazy.js: intent prefetch module ke saath data bhi warm karta hai', () => {
  assert.match(L, /FF\.warmPageData\(id\)/, 'pointerover/touchstart/focusin par data warm');
});

test('release: package.json ↔ sw.js CACHE_NAME aligned (update toast fires)', () => {
  const [maj, min, pat] = JSON.parse(read('package.json')).version.split('.').map(Number);
  const v = maj * 100000 + min * 100 + pat;
  const cache = (read('sw.js').match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  assert.equal(cache, `apnapayment-v${v}`);
  assert.ok(fs.existsSync(path.join(ROOT, `WHATS-NEW-v3.${min}.${pat}.md`)), 'WHATS-NEW file exists');
});
