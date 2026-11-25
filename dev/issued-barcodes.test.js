// v3.125.374 — issued barcode register: diff, store, apply (pure logic) + server wiring locks.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIssuedStore, diffLeft, applyResolved, deriveTagId, digits } from '../issuedBarcodes.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('diffLeft: sirf wahi jo stock se nikle', () => {
  const prev = { 111111111111111: 'TAGA|VC4|ff', 222222222222222: 'TAGB|VC5|ff', 333333333333333: 'TAGC|VC4|gv' };
  const cur = { 222222222222222: 'TAGB|VC5|ff' };
  const l = diffLeft(prev, cur);
  assert.deepEqual(l.map((x) => x.bc).sort(), ['111111111111111', '333333333333333']);
  assert.equal(l.find((x) => x.bc === '333333333333333').ch, 'gv');
  assert.deepEqual(diffLeft(null, cur), [], 'pehli baar (prev nahi) → kuch left nahi');
});
test('store: pending → resolved, disk par save/load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issued-'));
  const a = createIssuedStore({ dir });
  a.addPending('608116-038-0796415', 'abc123', 'VC4', 'ff');
  assert.equal(a.getPending('608116038079641 5'.replace(' ', '')).t, 'ABC123');
  a.setResolved('608116-038-0796415', { t: 'ABC123', v: 'KA05A39623', d: '2026-11-20', a: 'X', s: 'eir' });
  assert.equal(a.getPending('608116038079641 5'.replace(' ', '')), null, 'resolve hote hi pending se hata');
  a.flush();
  const b = createIssuedStore({ dir }); b.load();
  assert.equal(b.get('608116038079641' + '5').v, 'KA05A39623');
  assert.equal(digits('608116-038-0796415'), '6081160380796415');
});
test('applyResolved: khaali fields bharta hai, source note GV/EIR', () => {
  const r = { barcode: 'x', status: 'issued', agent: '', tagId: '' };
  assert.ok(applyResolved(r, { t: 'T1', c: 'VC4', v: 'RJ14AB1234', d: '2026-11-20', tm: '12:03:19 AM', a: 'Ravi', ai: 'APS1', tl: 'TL1', s: 'gv' }));
  assert.equal(r.agent, 'Ravi'); assert.equal(r.time, '12:03:19 AM'); assert.equal(r.src, 'gv'); assert.match(r.note, /GV Master/);
  const r2 = { agent: 'Existing' }; applyResolved(r2, { a: 'Other', s: 'eir' });
  assert.equal(r2.agent, 'Existing', 'pehle se bhara field nahi badalta');
});
test('server wiring: GV Master pehle, phir EIR; dispatch-status enrich; nightly', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const got = await ibGvmByTags\(part\)/);
  assert.match(src, /const got = await ibEirByTags\(part\)/);
  assert.ok(src.indexOf('ibGvmByTags(part)') < src.indexOf('ibEirByTags(part)'), 'GV Master pehle');
  assert.equal((src.match(/await dspEnrichBounded\(out, ranges, onLate\)/g) || []).length, 2, "dono branch me enrich (v3.125.495: bounded)");
  assert.match(src, /getUTCHours\(\) >= 3 && issuedStore\.meta\(\)\.lastRunDay !== istTodayKey\(\)/);
  assert.match(src, /curN < prevN \* 0\.5/, 'adhoore stock list par snapshot nahi badalta');
});

test('deriveTagId: Tag ID barcode ke saath +32 se badhta hai (live EIR se verify)', () => {
  const ref = ['608116-038-0796455', '34161FA820328EE84D84E4E0'];
  assert.equal(deriveTagId(...ref, '608116-038-0796419'), '34161FA820328EE84D84E060', 'EIR me KUMAR SUNIL VC4 ka asli tag');
  assert.equal(deriveTagId(...ref, '608116-038-0796415'), '34161FA820328EE84D84DFE0');
  assert.equal(deriveTagId(...ref, '608116-038-0796455'), '34161FA820328EE84D84E4E0');
  assert.equal(deriveTagId(...ref, '608116-039-0796419'), '', 'batch alag → nahi');
  assert.equal(deriveTagId(...ref, '608116-038-0899999'), '', 'bahut door → nahi');
  assert.equal(deriveTagId('123', 'ZZ', '125'), '');
});
