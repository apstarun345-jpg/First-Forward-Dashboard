/* 🛡️ v3.58 — "Could not save … Save not confirmed" ke teen bugs ke contract guards.
 *
 * Behaviour tests (dev/apps-script-storage.test.js + dev/public-tag-request.test.js) asli
 * save/retry aur address-book flow pakadte hain. Yahan wo cheezein lock hoti hain jinhe sirf
 * behaviour se pakadna mushkil hai — kyunki asli Apps Script (LockService / SpreadsheetApp)
 * tests me available nahi hai:
 *
 *   1) Code.gs ka lock contract: 60s tak slices me tryLock, busy par {code:'busy', retry:true, version},
 *      read-only actions (ping/health/sheettest/readaddresses) LOCK KE BINA.
 *   2) writeRecord_ ka 18278-column guard — bada record chup-chaap truncate na ho.
 *   3) doPost catch me action + exception ka naam; quota/timeout par code:'busy', retry:true.
 *   4) Regex double-backslash bugs (mobile / address / GV master ID / pincode) wapas na aayein.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const BS = '\\';            // ek backslash
const DBL = BS + BS;        // do backslash — yahi bug tha

test('🔒 Code.gs v3.58 — lock 60s slices me, busy par code/retry/version (save permanently fail na ho)', () => {
  const gs = read('google-apps-script/Code.gs');
  assert.match(gs, /const SCRIPT_VERSION = 'v3\.58-storage';/, 'SCRIPT_VERSION constant');
  assert.match(gs, /const LOCK_WAIT_MS = 60000;/, 'lock 60s tak wait');
  assert.match(gs, /const LOCK_SLICE_MS = 8000;/, '8s slices');
  assert.match(gs, /function acquireLock_\(waitMs, sliceMs\)/, 'slice-wise lock helper');
  assert.match(gs, /lock\.tryLock\(Math\.min\(sliceMs \|\| LOCK_SLICE_MS/, 'har slice me dobara tryLock');
  assert.match(gs, /const lock = acquireLock_\(LOCK_WAIT_MS, LOCK_SLICE_MS\);/, 'doPost isi helper se lock leta hai');
  assert.match(gs, /function busyJson_\(action\)/, 'busy response helper');
  assert.match(gs, /code: 'busy',\s*\n\s*retry: true,/, "busy par code:'busy' + retry:true");
  assert.match(gs, /version: SCRIPT_VERSION\s*\n\s*\}\);/, 'busy response me version bhi');
  assert.ok(!gs.includes('tryLock(25000)'), 'purana 25s wala lock hata');
  assert.ok(!gs.includes("error: 'busy, retry' }"), 'purana retry-less busy payload hata');
});

test('🔓 Code.gs v3.58 — read-only actions (ping/health/sheettest/readaddresses) lock ke BINA chalte hain', () => {
  const gs = read('google-apps-script/Code.gs');
  const list = gs.match(/const READ_ONLY_ACTIONS = \[([^\]]*)\];/);
  assert.ok(list, 'READ_ONLY_ACTIONS list mili');
  const actions = list[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepEqual(actions, ['ping', 'health', 'sheettest', 'readaddresses'], 'lock-free actions wahi jo tay hue');
  const doPost = gs.slice(gs.indexOf('function doPost(e)'), gs.indexOf('function target_(ssId)'));
  const dispatchAt = doPost.indexOf('READ_ONLY_ACTIONS.indexOf(action) >= 0');
  const lockAt = doPost.indexOf('acquireLock_(LOCK_WAIT_MS, LOCK_SLICE_MS)');
  assert.ok(doPost.length > 500, 'doPost body mila');
  assert.ok(dispatchAt > 0 && lockAt > 0 && dispatchAt < lockAt, 'read-only dispatch lock lene se PEHLE hota hai');
  assert.match(gs, /function readOnlyAction_\(action, body\)/, 'read-only handler alag function me');
  assert.match(gs, /function healthOnce\(\)/, 'healthOnce() diagnosis function');
});

test('🧾 Code.gs v3.58 — SCRIPT_VERSION doGet/ping/health/write responses me jaati hai', () => {
  const gs = read('google-apps-script/Code.gs');
  assert.match(gs, /function doGet\(\) \{\s*\n\s*return json_\(\{ ok: true, service: 'apnapayment-storage', version: SCRIPT_VERSION/, 'doGet me version');
  assert.match(gs, /return \{ ok: true, version: SCRIPT_VERSION, tab: TAB, hasTab:/, 'ping me version');
  assert.match(gs, /ok: true, version: SCRIPT_VERSION, at: new Date\(\)\.toISOString\(\)/, 'health me version');
  assert.match(gs, /savedAt: nowIso, kinds: Object\.keys\(records\), version: SCRIPT_VERSION/, 'write me version');
  assert.match(gs, /errorName: 'UnknownAction', version: SCRIPT_VERSION/, 'unknown action bhi version ke saath');
});

test('🩺 Code.gs v3.58 — healthOnce() poora diagnosis deta hai (secret/user/sheet/rows/kinds/history/writable)', () => {
  const gs = read('google-apps-script/Code.gs');
  const fn = gs.slice(gs.indexOf('function healthOnce()'), gs.indexOf('function json_(obj)'));
  assert.ok(fn.length > 800, 'healthOnce body mila');
  for (const needle of [
    'secret: { set: false',                    // secret set + length
    'Session.getEffectiveUser().getEmail()',   // effective user
    'SpreadsheetApp.getActive()',              // spreadsheet
    'sh.getLastRow()',                         // APP_STORAGE rows
    'sh.getLastColumn()',                      // APP_STORAGE columns
    'kinds: { present: [], missing: KINDS.slice()', // kaunse kinds hain / MISSING
    'HISTORY_TAB',                             // history tab
    'writable',                                // scratch cell write test
    'setValue(token)',                         // likha
    'getValue()'                               // padha
  ]) assert.ok(fn.includes(needle), `healthOnce me "${needle}"`);
});

test('🛑 Code.gs v3.58 — writeRecord_ 18278 columns se bada record saaf error deta hai (chup-chaap truncate nahi)', () => {
  const gs = read('google-apps-script/Code.gs');
  assert.match(gs, /const MAX_SHEET_COLUMNS = 18278;/);
  const fn = gs.slice(gs.indexOf('function writeRecord_('), gs.indexOf('function json_(obj)'));
  assert.match(fn, /if \(width > MAX_SHEET_COLUMNS\) \{/, 'width par guard');
  assert.match(fn, /throw new Error\('record for "/, 'saaf error message');
  assert.ok(fn.indexOf('if (width > MAX_SHEET_COLUMNS)') < fn.indexOf('sh.insertColumnsAfter('), 'guard insert se pehle chalta hai');
});

test('🧯 Code.gs v3.58 — doPost catch me action + errorName, aur quota/timeout par code busy + retry', () => {
  const gs = read('google-apps-script/Code.gs');
  assert.match(gs, /function failJson_\(err, action\)/, 'failJson_ helper');
  assert.match(gs, /action: String\(action \|\| ''\)/, 'response me action naam');
  assert.match(gs, /errorName: name/, 'response me exception ka naam');
  assert.match(gs, /return failJson_\(err, action\);/, 'catch isi helper se jawab deta hai');
  const busyFn = gs.match(/function isBusyError_\(err\) \{\s*return (\/[^\n]*\/i)\.test\(/);
  assert.ok(busyFn, 'isBusyError_ regex mili');
  for (const word of ['busy', 'lock', 'timeout', 'rate limit', 'quota', 'temporar']) {
    assert.ok(new RegExp(word, 'i').test(busyFn[1]), `busy regex me "${word}"`);
  }
  assert.match(gs, /\.\.\.\(busy \? \{ code: 'busy', retry: true \} : \{\}\)/, 'transient par code busy + retry');
});

test('🔢 v3.58 — regex double-backslash bug wapas na aaye (mobile / address / GV master ID / pincode)', () => {
  const srv = read('server.js');
  const gs = read('google-apps-script/Code.gs');

  // 1) Address book: mobile ke digits aur address ke spaces sahi bache rahein
  assert.ok(srv.includes('replace(/[^' + BS + 'd+]/g'), 'mobile regex single-backslash ([^\\d+])');
  assert.ok(srv.includes('replace(/' + BS + 's+/g'), 'address regex single-backslash (\\s+)');
  const addrFn = srv.slice(srv.indexOf('const addressEntryFromRequest = (req) =>'), srv.indexOf('function addressBookMemoryEntries()'));
  assert.ok(addrFn.length > 100, 'addressEntryFromRequest body mila');
  assert.ok(!addrFn.includes(DBL + 'd'), 'addressEntryFromRequest me double-backslash \\\\d nahi');
  assert.ok(!addrFn.includes(DBL + 's'), 'addressEntryFromRequest me double-backslash \\\\s nahi');

  // 2) GV master ID ka ".0" strip (EIR overlay, 2 jagah) — single backslash
  assert.ok(!srv.includes('replace(/' + DBL + '.0+$/'), 'GV master ".0" strip single-backslash hai');

  // 3) Code.gs pincode cleanup (2 jagah) — single backslash
  assert.ok(!gs.includes('replace(/' + DBL + 'D/g'), 'Code.gs pincode cleanup single-backslash hai');
  assert.ok(gs.includes('replace(/' + BS + 'D/g'), 'Code.gs pincode cleanup mojood hai');

  // 4) Client JS template literals waisi hi rahein (wahan double backslash CORRECT hai)
  assert.ok(srv.includes('PERSONAL_PORTAL_JS = `'), 'client JS template literal waisa hi hai');
  assert.ok(srv.includes("replace(/" + DBL + "D/g, '')"), 'template literal ke andar ka \\\\D chhedna nahi tha');
});
