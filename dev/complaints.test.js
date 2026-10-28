import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComplaintTable, parseThread, buildQuery, normalizeCfg, createComplaintsService, freshText } from '../complaints-mail.js';

const HTML = `<p>Hi Team,</p><table><tr><th>Case Number</th><th>Vehicle Registration Number</th><th>Tag Id</th><th>Description</th><th>BC Name</th><th>Agent Name</th><th>agent id</th></tr>
<tr><td style="color:red">1170081271</td><td>UP87K2812</td><td>34161FA820328EE84F0C1B20</td><td>cx did a replacement from near by pos agent charged 200rs &amp; 100rs debited from tag</td><td>APNA PAYMENT</td><td>Sunil Kumar Rudra</td><td>5845036</td></tr></table>`;
const T0 = Date.UTC(2026, 9, 26, 11, 35);
const first = { id: 'm1', from: 'PartnersETC <partners@idfcfirstbank.com>', date: T0, plain: 'Hi Team', html: HTML };
const thread = (more) => ({ id: 't1', subject: 'POS Related-Request _APNA PAYMENT_26.October.2026_1170081271', messages: [first, ...more] });
const bank = { id: 'm2', from: 'PartnersETC <partners@idfcfirstbank.com>', date: T0 + 30 * 3600e3, plain: 'Dear Team\n\nAs we do not received any response within TAT, hence we have debited your pool account for Rs.200/- and refunded back to the customer.\n\nOn Mon, 26 Oct wrote:\n> old' };
const mine = { id: 'm3', from: 'Tarun <me@gmail.com>', date: T0 + 3 * 3600e3, plain: 'Checked, refunded to customer.' };
const NOW = T0 + 40 * 3600e3;
const opt = { me: ['me@gmail.com'], now: NOW };

test('parses the bank complaint table', () => {
  const rows = parseComplaintTable(HTML);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { caseNo: '1170081271', vrn: 'UP87K2812', tagId: '34161FA820328EE84F0C1B20', description: 'cx did a replacement from near by pos agent charged 200rs & 100rs debited from tag', bcName: 'APNA PAYMENT', agentName: 'Sunil Kumar Rudra', agentId: '5845036' });
});

test('status: pending / solved by me / solved by bank (with deducted amount)', () => {
  const p = parseThread(thread([]), opt)[0];
  assert.equal(p.status, 'Pending'); assert.equal(p.tatBreached, true); assert.equal(p.caseNo, '1170081271');
  const m = parseThread(thread([mine]), opt)[0];
  assert.equal(m.status, 'Solved by Tarun'); assert.equal(m.tatBreached, false); assert.equal(m.repliedAt, mine.date);
  const b = parseThread(thread([bank]), opt)[0];
  assert.equal(b.status, 'Solved by Bank'); assert.equal(b.deducted, 200);
  const both = parseThread(thread([mine, bank]), opt)[0];
  assert.equal(both.status, 'Solved by Tarun'); // I replied first
  const late = parseThread(thread([bank, { ...mine, date: bank.date + 3600e3 }]), opt)[0];
  assert.equal(late.status, 'Solved by Bank'); // bank closed first
});

test('bank follow-up that is not a resolution keeps it pending; teammate reply = Solved by Team', () => {
  const ask = { ...bank, plain: 'Please share more details of the transaction.' };
  assert.equal(parseThread(thread([ask]), opt)[0].status, 'Pending');
  const tm = { id: 'm9', from: 'Ankit <ankit@apnapayment.com>', date: T0 + 3600e3, plain: 'done' };
  assert.equal(parseThread(thread([tm]), opt)[0].status, 'Solved by Team');
});

test('quoted text is ignored, query builder + config clamp', () => {
  assert.equal(freshText(bank.plain).includes('old'), false);
  const q = buildQuery(['POS Related-Request', 'Other "x"'], '2026-10-01', '2026-10-28');
  assert.match(q, /subject:\("POS Related-Request" OR "Other x"\) after:2026\/09\/30 before:2026\/10\/30/);
  const c = normalizeCfg({ refreshMin: 0, subjects: 'A\n\nB', enabled: 'false' });
  assert.equal(c.refreshMin, 2); assert.deepEqual(c.subjects, ['A', 'B']); assert.equal(c.enabled, false);
});

test('service: syncs through the store, fills TL, filters by date, extends range on demand', async () => {
  const calls = [];
  const store = { call: async (action, body) => { calls.push({ action, body }); return { ok: true, me: ['me@gmail.com'], threads: [thread([mine])], more: false }; } };
  let clock = NOW;
  const svc = createComplaintsService({
    getStore: () => store, getConfig: () => ({ subjects: ['POS Related-Request'], refreshMin: 10 }), now: () => clock,
    lookupAgent: ({ agentName }) => (/sunil/i.test(agentName) ? { found: true, tlName: 'Rahul TL', tlId: '777' } : null)
  });
  await svc.sync({ full: true });
  assert.equal(calls[0].action, 'complaints');
  assert.match(calls[0].body.query, /after:2026\/09\/30/);
  const rows = svc.rows({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(rows.length, 1); assert.equal(rows[0].tlName, 'Rahul TL'); assert.equal(rows[0].status, 'Solved by Tarun');
  assert.equal(svc.rows({ from: '2026-10-27', to: '2026-10-31' }).length, 0);
  await svc.ensureRange('2026-08-10');      // older month → one more Gmail call
  assert.equal(calls.length, 2); assert.match(calls[1].body.query, /after:2026\/07\/31/);
  assert.equal(svc.meta().coverFrom, '2026-08-01');
});

test('service: old Apps Script (unknown action) gives a clear fix hint; tick respects refreshMin', async () => {
  const store = { call: async () => { throw new Error('Apps Script storage: unknown action'); } };
  const svc = createComplaintsService({ getStore: () => store, getConfig: () => ({}), now: () => NOW });
  await assert.rejects(() => svc.sync({ full: true }), /Code\.gs/);
  assert.match(svc.meta().error, /New version/);
  let n = 0; const ok = { call: async () => { n++; return { ok: true, me: [], threads: [], more: false }; } };
  let clock = NOW;
  const s2 = createComplaintsService({ getStore: () => ok, getConfig: () => ({ refreshMin: 10 }), now: () => clock });
  s2.tick(); await new Promise((r) => setTimeout(r, 20)); assert.equal(n, 1);
  clock += 5 * 60e3; s2.tick(); await new Promise((r) => setTimeout(r, 20)); assert.equal(n, 1);   // not due
  clock += 6 * 60e3; s2.tick(); await new Promise((r) => setTimeout(r, 20)); assert.equal(n, 2);   // due after 10 min
});

import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
test('complaints is wired: permission, nav, lazy module, blocked server file, Apps Script action, settings', () => {
  assert.match(read('server.js'), /key: 'complaints', label: 'Management · Agents Complaints Summary/);
  assert.match(read('server.js'), /BLOCKED_FILES = new Set\(\[[^\]]*'complaints-mail\.js'/);
  assert.match(read('server.js'), /p === '\/api\/complaints' && method === 'GET'/);
  assert.match(read('server.js'), /complaintsSvc\.tick\(\)/);
  assert.match(read('app.js'), /id: 'complaints'[^\n]*perm: 'complaints', group: 'Management'/);
  assert.match(read('lazy.js'), /complaints: \['complaints'\]/);
  assert.match(read('google-apps-script/Code.gs'), /body\.action === 'complaints'/);
  assert.match(read('google-apps-script/Code.gs'), /function authorizeComplaints\(\)/);
  assert.match(read('settings.js'), /data-path="complaints\.enabled"/);
  assert.match(read('settings.js'), /complaints\.subjects/);
  assert.ok(fs.existsSync(new URL('../styles-complaints.css', import.meta.url)));
});
