// 🛰️ v3.125.284 — NPCI Status page helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function boot() {
  const FF = { util: { esc: (s) => String(s), fmt: (n) => String(n), dateKey: () => '2026-11-14' }, pages: {} };
  const ctx = { window: { FF }, FF, console, Date, Number, String, Set, Map, Object, Math };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../npciStatus.js', import.meta.url), 'utf8'), ctx);
  return FF.pages.npciStatus._test;
}

test('inputs: paste / CSV cells, header skip, dedupe, kind detect', () => {
  const T = boot();
  const items = T.splitInputs('Tag ID,VRN\n34161FA820328EE84D7F6D40, mh14ey3466\nMA1RV2TUKT6H20555;MH14EY3466');
  assert.deepEqual([...items], ['34161FA820328EE84D7F6D40', 'MH14EY3466', 'MA1RV2TUKT6H20555']);
  assert.equal(T.kindOf('34161FA820328EE84D7F6D40'), 'Tag ID');
  assert.equal(T.kindOf('MH14EY3466'), 'VRN');
  assert.equal(T.kindOf('MA1RV2TUKT6H20555'), 'Chassis');
});

test('primary = Active tag; VRN update = REGNUMBER 1-10 chars; summary', () => {
  const T = boot();
  const recs = [{ TAGID: 'OLD', npci_ExcCode: 'Replaced/Closed', TAGSTATUS: 'C', REGNUMBER: 'MH14EY3466' }, { TAGID: 'NEW', npci_ExcCode: 'Active', TAGSTATUS: 'A', REGNUMBER: 'MH14EY3466' }];
  assert.equal(T.primaryOf(recs).TAGID, 'NEW');
  assert.equal(T.vrnUpdated('RJ14AB1234'), true);
  assert.equal(T.vrnUpdated('MA1RV2TUKT6H20555'), false);
  T.st.rows = [
    { input: 'MH14EY3466', kind: 'VRN', ok: true, records: recs },
    { input: 'MA1RV2TUKT6H20555', kind: 'Chassis', ok: true, records: [{ TAGID: 'T2', npci_ExcCode: 'Low Balance', REGNUMBER: 'MA1RV2TUKT6H20555' }] },
    { input: '34161FA820328EE84D7F6D40', kind: 'Tag ID', ok: true, records: [{ TAGID: 'T3', npci_ExcCode: 'Active', TAGSTATUS: 'A', REGNUMBER: 'RJ14AB1234' }] },
    { input: 'XX12345', kind: 'Chassis', ok: false, msg: 'Unregistered.', records: [] }
  ];
  const s = T.summary();
  assert.equal(s.total, 4); assert.equal(s.found, 3); assert.equal(s.failed, 1);
  assert.equal(s.upd, 1); assert.equal(s.notUpd, 1);
  assert.equal(s.status.Active, 2); assert.equal(s.status['Low Balance'], 1);
  assert.equal(T.flatRows(false).length, 4, 'har input ki ek row');
  assert.equal(T.flatRows(true).length, 5, 'VRN ke saare tags');
});
