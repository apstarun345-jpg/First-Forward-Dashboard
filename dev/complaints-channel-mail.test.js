/* v3.125.21 — Complaints: channel default mail (GV Master agents / FF agents). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeMailCfg, ruleMatches, planMails, normalizeCfg } from '../complaints-mail.js';

test('channel rule keeps channel, forces all, and matches by GV Master issuer', () => {
  const m = normalizeMailCfg({ enabled: true, rules: [
    { id: 'ch-gv', channel: 'gv', enabled: true, all: false, tls: ['X'], to: 'gv@ex.com' },
    { id: 'ch-ff', channel: 'ff', enabled: true, to: 'ff@ex.com' },
    { id: 'r1', channel: 'zzz', all: true, to: 'a@ex.com' }
  ] }, null, 1000);
  const [gv, ff, plain] = m.rules;
  assert.equal(gv.channel, 'gv'); assert.equal(gv.all, true); assert.deepEqual(gv.tls, []);
  assert.equal(plain.channel, '');
  const gvRow = { issuerSrc: 'GV Master', agentName: 'A' }, ffRow = { agentName: 'B' };
  assert.equal(ruleMatches(gv, gvRow), true); assert.equal(ruleMatches(gv, ffRow), false);
  assert.equal(ruleMatches(ff, ffRow), true); assert.equal(ruleMatches(ff, gvRow), false);
  assert.equal(ruleMatches(plain, gvRow), true);
});

test('planMails sends a GV Master complaint only to the GV channel email', () => {
  const now = Date.now();
  const cfg = normalizeCfg({ mail: { enabled: true, rules: [
    { id: 'ch-gv', channel: 'gv', enabled: true, to: 'gv@ex.com', since: 1, remind: false },
    { id: 'ch-ff', channel: 'ff', enabled: true, to: 'ff@ex.com', since: 1, remind: false }
  ] } }, null, 1);
  const rows = [{ key: 'k1', caseNo: '1', date: now - 1000, status: 'Pending', issuerSrc: 'GV Master', agentName: 'GV Agent' }];
  const out = planMails({ rows, cfg, state: {}, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].to, 'gv@ex.com');
});

test('complaints settings UI has the channel default section with its own Save', () => {
  const ui = fs.readFileSync(new URL('../complaints.js', import.meta.url), 'utf8');
  assert.match(ui, /function channelSection\(m\)/);
  assert.match(ui, /data-chrule="\$\{ch\}"/);
  assert.match(ui, /💾 Save mail/);
  assert.match(ui, /filter\(\(r\) => !r\.channel\)\.map\(ruleRow\)/);
});
