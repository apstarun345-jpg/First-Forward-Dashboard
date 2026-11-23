import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { subjectDay, passwordCandidates, parseTable, headerMap, toIso, planSend, buildMail, createTihService, normalizeCfg } from '../tih-mail.js';
test('subject day + password', () => {
  assert.equal(subjectDay('Tag In Hand Dated 21-11-2026-AN01-Apna Payment'), '2026-11-21');
  assert.equal(passwordCandidates('Tag In Hand Dated 21-11-2026-AN01', Date.UTC(2026, 10, 21, 7))[0], 'IDFC@2111');
});
test('header aage-peeche + blank agent', () => {
  const rows = [['junk'], ['Agent Name', 'Tag ID', 'VRN', 'Reason', 'ISSUE_DATE', 'Agent ID'], ['RAJ', '34161fa8 2032', 'gj01ab1234', 'Not affixed', '13-01-2026', '594795463333393468.0'], ['', '34161FA820328EE8464DF821', 'MH01', 'x', '12/11/2026', '']];
  const m = headerMap(rows[1]); assert.equal(m.tagId, 1);
  const out = parseTable(rows);
  assert.equal(out.length, 2); assert.equal(out[0].tagId, '34161FA82032'); assert.equal(out[0].agentId, '594795463333393468'); assert.equal(out[0].issueDate, '2026-01-13'); assert.equal(out[1].agentId, ''); assert.equal(out[1].issueDate, '2026-11-12');
  assert.equal(toIso('2026-11-02'), '2026-11-02');
});
test('planSend: GV one mail, FF per TL, missing skipped', () => {
  const rows = [{ day: '2026-11-21', ch: 'gv', tagId: 'A' }, { day: '2026-11-21', ch: 'ff', tlName: 'T1', tlMail: 't1@x.com', tagId: 'B' }, { day: '2026-11-21', ch: 'ff', tlName: 'T2', tlMail: '', tagId: 'C' }];
  const p = planSend({ rows, ch: 'all', cfg: normalizeCfg({ gvTo: 'gv@x.com' }) });
  assert.equal(p.groups.length, 2); assert.equal(p.skipped.length, 1);
  const p2 = planSend({ rows, ch: 'gv', cfg: normalizeCfg({}) }); assert.equal(p2.groups.length, 0); assert.equal(p2.skipped.length, 1);
  assert.match(buildMail({ day: '2026-11-21', label: 'GV', rows: [{ vrn: 'V', tagId: 'A', day: '2026-11-21', ch: 'gv' }] }).subject, /21-11-2026/);
});
test('service: only new threads read, GV lookup once', async () => {
  let files = 0, gvCalls = 0, saved = 0;
  const store = { call: async (a) => { if (a === 'complaints') return { ok: true, more: false, threads: [{ id: 't1', subject: 'Tag In Hand Dated 21-11-2026-AN01', messages: [{ date: Date.now() }] }, { id: 'x', subject: 'IHMCL Loose Tag Data TIH', messages: [{ date: 1 }] }] }; files++; return { files: [{ name: 'a.xls', b64: 'AA==' }] }; } };
  const svc = createTihService({ getStore: () => store, load: async () => null, save: async () => { saved++; return true; }, lookupGv: async (items) => { gvCalls++; return new Map([[items[0].key, { id: '77', name: 'GV A', tlName: 'GT' }]]); }, lookupTl: () => ({ tlName: 'FT' }),
    readXls: async () => ({ password: 'x', sheets: [{ rows: [['VRN', 'Tag ID', 'Agent ID', 'Agent Name'], ['V1', 'T1', '', ''], ['V2', 'T2', '9', 'FFA']] }] }), getCfg: () => ({}) });
  await svc.sync({ force: true }); await svc.sync({ force: true });
  assert.equal(files, 1); assert.equal(gvCalls, 1); assert.ok(saved >= 1);
  const v = await svc.view();
  assert.equal(v.rows.length, 2);
  const g = v.rows.find((r) => r.tagId === 'T1'), f = v.rows.find((r) => r.tagId === 'T2');
  assert.equal(g.ch, 'gv'); assert.equal(g.agentName, 'GV A'); assert.equal(g.tlName, 'GT'); assert.equal(f.ch, 'ff'); assert.equal(f.tlName, 'FT');
  await svc.setTlMail('FT', 'ft@x.com'); await svc.setRemark(f.k, 'call kiya', 'u');
  const v2 = await svc.view(); assert.equal(v2.rows.find((r) => r.tagId === 'T2').tlMail, 'ft@x.com'); assert.equal(v2.rows.find((r) => r.tagId === 'T2').remark, 'call kiya');
});
test('wired', () => {
  assert.match(fs.readFileSync('server.js', 'utf8'), /\/api\/tih\/send/); assert.match(fs.readFileSync('app.js', 'utf8'), /id: 'tagInHand'/); assert.match(fs.readFileSync('lazy.js', 'utf8'), /tagInHand: \['tagInHand'\]/);
});
test('real xls bundle decrypts', async () => {
  if (!fs.existsSync('/tmp/tih/s.xls')) return;
  const { readEncryptedXls } = await import('../vendor/tih-xls.mjs');
  const r = await readEncryptedXls(fs.readFileSync('/tmp/tih/s.xls'), ['IDFC@0000', 'IDFC@2111']);
  assert.equal(r.password, 'IDFC@2111'); assert.ok(parseTable(r.sheets[0].rows).length >= 10);
});
