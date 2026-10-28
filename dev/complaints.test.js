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
  assert.match(read('complaints.js'), /data-f="refreshMin"/);
  assert.match(read('complaints.js'), /data-f="subjects"/);
  assert.match(read('server.js'), /complaintsMailTick/);
  assert.ok(fs.existsSync(new URL('../styles-complaints.css', import.meta.url)));
});

import { normalizeMailCfg, ruleMatches, planMails, normalizeCfg as nc } from '../complaints-mail.js';
const NOW2 = Date.UTC(2026, 9, 28, 9, 0);
const mk = (o) => ({ key: `t:${o.caseNo}:x`, caseNo: o.caseNo, date: NOW2 - 2 * 3600e3, agentName: 'Ramdev', agentId: '15037228', tlName: 'RAMDEV SIYAG', tlId: 'APN2233', vrn: 'PB15Y5557', tagId: 'T1', description: 'd', bcName: 'B', status: 'Pending', deducted: 0, resolvedAt: 0, bankNote: '', tatBreached: false, link: 'https://mail.google.com/x', ...o });
const cfgWith = (rules, extra = {}) => nc({ ownerName: 'Tarun', tatHours: 24, mail: { enabled: true, remindHours: 4, rules, ...extra } }, null, NOW2 - 3 * 3600e3);

test('mail rule normalization: since is set once, invalid emails dropped, templates default', () => {
  const m1 = normalizeMailCfg({ enabled: true, rules: [{ id: 'a', all: false, tls: ['X'], to: 'ok@x.com, nope' }] }, null, 1000);
  assert.equal(m1.rules[0].since, 1000); assert.equal(m1.rules[0].to, 'ok@x.com');
  const m2 = normalizeMailCfg({ enabled: true, rules: [{ id: 'a', all: false, tls: ['X'], to: 'ok@x.com' }, { id: 'b', all: true, to: 'z@x.com' }] }, m1, 5000);
  assert.equal(m2.rules[0].since, 1000, 'existing enabled rule keeps its since'); assert.equal(m2.rules[1].since, 5000, 'new rule starts now');
  const off = normalizeMailCfg({ rules: [{ id: 'a', enabled: false, to: 'ok@x.com' }] }, m1, 7000);
  const on = normalizeMailCfg({ rules: [{ id: 'a', enabled: true, to: 'ok@x.com' }] }, off, 9000);
  assert.equal(on.rules[0].since, 9000, 're-enabled rule restarts from now');
  assert.match(m1.templates.newSubject, /\{case\}/); assert.equal(m1.remindHours, 4);
});

test('rule matching: all, or any of the selected TLs / agents (name or ID)', () => {
  const r = mk({ caseNo: '1' });
  assert.equal(ruleMatches({ all: true }, r), true);
  assert.equal(ruleMatches({ all: false, tls: ['ramdev siyag'] }, r), true);
  assert.equal(ruleMatches({ all: false, tls: ['Other TL', 'APN2233'] }, r), true);
  assert.equal(ruleMatches({ all: false, agents: ['15037228'] }, r), true);
  assert.equal(ruleMatches({ all: false, tls: ['Other'], agents: ['nobody'] }, r), false);
  assert.equal(ruleMatches({ all: false, tls: [], agents: [] }, r), false);
});

test('legacy single-target rules migrate to the multi-select shape; attach defaults ON', () => {
  const m = normalizeMailCfg({ rules: [{ id: 'o', target: 'agent', value: 'Ramdev', to: 'a@x.com' }, { id: 'p', target: 'all', to: 'a@x.com' }] }, null, 1);
  assert.deepEqual([m.rules[0].all, m.rules[0].agents, m.rules[0].tls], [false, ['Ramdev'], []]);
  assert.equal(m.rules[1].all, true); assert.equal(m.rules[0].attach, true);
});

test('planMails: new once, deduction once, reminder every N hours as a digest, rules filter, old complaints skipped', () => {
  const cfg = cfgWith([{ id: 'r1', all: false, tls: ['RAMDEV SIYAG'], to: 'tl@x.com' }, { id: 'r2', all: false, agents: ['nobody'], to: 'n@x.com' }]);
  const rows = [mk({ caseNo: '10' }), mk({ caseNo: '11', date: NOW2 - 9 * 86400e3 }), mk({ caseNo: '12', status: 'Solved by Bank', deducted: 300, resolvedAt: NOW2 - 600e3 })];
  const st = { sent: {}, remind: {} };
  let plan = planMails({ rows, cfg, state: st, now: NOW2 });
  assert.deepEqual(plan.map((m) => m.kind).sort(), ['deduct', 'new'], 'old pending 11 gets no instant mail; no reminder yet (since < 4h)');
  assert.ok(plan.every((m) => m.ruleId === 'r1' && m.to === 'tl@x.com'));
  assert.ok(plan.filter((m) => m.kind !== 'remind').every((m) => m.attach === true && m.threadId === undefined || m.threadId));
  assert.match(plan.find((m) => m.kind === 'new').subject, /Case 10 · Ramdev/);
  assert.match(plan.find((m) => m.kind === 'deduct').text, /₹300/);
  for (const m of plan) for (const k of m.marks) st.sent[k.key] = { ...(st.sent[k.key] || {}), [k.f]: NOW2 };
  assert.equal(planMails({ rows, cfg, state: st, now: NOW2 }).length, 0, 'nothing repeats');
  const later = NOW2 + 5 * 3600e3;
  const rem = planMails({ rows, cfg, state: st, now: later });
  assert.equal(rem.length, 1); assert.equal(rem[0].kind, 'remind'); assert.equal(rem[0].count, 2);
  assert.match(rem[0].text, /Case 10/); assert.match(rem[0].text, /Case 11/);
  st.remind.r1 = later;
  assert.equal(planMails({ rows, cfg, state: st, now: later + 3 * 3600e3 }).length, 0);
  assert.equal(planMails({ rows, cfg, state: st, now: later + 4.1 * 3600e3 }).length, 1);
  assert.equal(planMails({ rows, cfg: { ...cfg, mail: { ...cfg.mail, enabled: false } }, state: { sent: {}, remind: {} }, now: later }).length, 0);
});

import { sendMail } from '../mailer.js';
test('binary (already base64) attachments are passed through untouched; text ones still get encoded', async () => {
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_u, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => '{"id":"1"}', json: async () => ({ id: '1' }) }; };
  try {
    await sendMail({ provider: 'resend', to: 'a@b.com', from: 'Dash <d@b.com>', resendKey: 're_test' }, 's', 't', { attachments: [{ name: 'shot.png', type: 'image/png', content: 'iVBORw0KGgo=', base64: true }, { name: 'r.csv', content: 'a,b' }] }, {});
  } finally { globalThis.fetch = realFetch; }
  const att = bodies[0].attachments;
  assert.equal(att[0].content, 'iVBORw0KGgo=');
  assert.equal(att[1].content, Buffer.from('a,b').toString('base64'));
});

import vm from 'node:vm';
test('page smoke: list shows the Mail column, history tab renders sent / failed rows', async () => {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mount = { innerHTML: '' };
  const handlers = {};
  const rootEl = { innerHTML: '', isConnected: true, addEventListener(t, f) { handlers[t] = f; }, contains: () => false, querySelector: (sel) => (sel === '[data-cmp-body]' ? mount : null), querySelectorAll: () => [] };
  const row = { key: 'k', threadId: 't', caseNo: '1170081271', date: Date.now() - 3600e3, day: '2026-10-28', vrn: 'UP87K2812', tagId: 'T1', description: 'cx did', bcName: 'APNA', agentName: 'Ramdev', agentId: '15037228', tlName: 'TL X', tlId: 'APN2233', status: 'Pending', resolvedAt: 0, deducted: 0, bankNote: '', tatBreached: true, tatDueAt: Date.now(), link: 'https://mail.google.com/x' };
  const data = { ok: true, rows: [row], meta: { okAt: new Date().toISOString(), config: { refreshMin: 10, subjects: ['POS'], ownerName: 'Tarun' } }, cfg: { mail: { rules: [] } }, placeholders: [],
    mailLog: [{ at: Date.now(), kind: 'new', to: 'tl@x.com', subject: 'New POS complaint', ok: true, caseNo: '1170081271', files: 2 }, { at: Date.now() - 1000, kind: 'deduct', to: 'tl@x.com', subject: 'Bank deducted', ok: false, error: 'SMTP timeout', caseNo: '1170081271', tries: 3 }], mailErr: '' };
  const ctx = { console, setInterval() {}, clearInterval() {}, document: { activeElement: null, hidden: false }, CSS: { escape: (x) => x } };
  ctx.window = ctx;
  ctx.FF = { pages: {}, util: { esc, fmt: (n) => String(n), spinner: () => '', stamp: () => '', withButtonBusy: async () => {}, toast() {} }, auth: { api: async () => data } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../complaints.js', import.meta.url), 'utf8'), ctx);
  ctx.FF.pages.complaints.render(rootEl);
  await new Promise((r) => setTimeout(r, 30));
  assert.match(mount.innerHTML, /<th[^>]*>Mail<\/th>/);
  assert.match(mount.innerHTML, /cmp-mok/);                 // ✅ count in the complaint row
  assert.match(mount.innerHTML, /data-cmp-tab="mail"/);
  assert.match(mount.innerHTML, /1170081271/);
  handlers.click({ target: { closest: (sel) => (sel === '[data-cmp-tab]' ? { dataset: { cmpTab: 'mail' } } : null) } });
  assert.match(mount.innerHTML, /✅ 1 sent/);
  assert.match(mount.innerHTML, /❌ Failed ×3/);
  assert.match(mount.innerHTML, /SMTP timeout/);
  assert.match(mount.innerHTML, /tl@x\.com/);
});

import { complaintTableHtml, buildMail as bm, DEFAULT_MAIL_TEMPLATES } from '../complaints-mail.js';
test('GV Master issuer replaces the bank-mail agent (APNA PAYMENT / master ID) in table + mail; TL falls back to GV Master', async () => {
  const master = new Set(['5845036']);
  const lookups = [];
  const store = { call: async () => ({ ok: true, me: ['me@gmail.com'], threads: [thread([])], more: false }) };
  const svc = createComplaintsService({
    getStore: () => store, getConfig: () => ({}), now: () => NOW, getMasterIds: () => master,
    lookupAgent: ({ agentId }) => { lookups.push(agentId); return agentId === '20354013' ? { found: true, tlName: 'Registry TL', tlId: 'APN9' } : null; },
    enrichIssuers: async (items) => { assert.equal(items[0].tagId, '34161FA820328EE84F0C1B20'); return new Map([[items[0].key, { id: '20354013', name: 'Real Agent', tlName: 'GV TL', tlId: 'G1' }]]); }
  });
  await svc.sync({ full: true });
  const r = svc.rows({})[0];
  assert.deepEqual([r.agentId, r.agentName, r.tlName, r.tlId, r.issuerSrc, r.mailAgentId], ['20354013', 'Real Agent', 'Registry TL', 'APN9', 'GV Master', '5845036']);
  // no registry hit → GV Master TL
  const svc2 = createComplaintsService({ getStore: () => store, getConfig: () => ({}), now: () => NOW, getMasterIds: () => master, lookupAgent: () => null, enrichIssuers: async (it) => new Map([[it[0].key, { id: '1', name: 'X', tlName: 'GV TL', tlId: 'G1' }]]) });
  await svc2.sync({ full: true });
  assert.deepEqual([svc2.rows({})[0].tlName, svc2.rows({})[0].tlId], ['GV TL', 'G1']);
  // not found → stays as the mail says and is retried only after 30 min
  let calls = 0;
  const svc3 = createComplaintsService({ getStore: () => store, getConfig: () => ({}), now: () => NOW, getMasterIds: () => master, enrichIssuers: async () => { calls++; return new Map(); } });
  await svc3.sync({ full: true }); await svc3.sync({ full: true });
  assert.equal(calls, 1); assert.equal(svc3.rows({})[0].agentId, '5845036');
  // mail carries the resolved name / id in a bank-style table
  const cfg = nc({ ownerName: 'Tarun', tatHours: 24, mail: { enabled: true } }, null, 1);
  const mail = bm('new', r, cfg, NOW);
  assert.match(mail.html, /background:#ffff00/); assert.match(mail.html, /Real Agent/); assert.match(mail.html, /20354013/); assert.match(mail.html, /✓ GV Master/); assert.match(mail.html, /Registry TL/);
  assert.doesNotMatch(mail.html, />Sunil Kumar Rudra</);
  assert.match(mail.text, /Agent Name: Real Agent/); assert.match(mail.text, /Agent ID: 20354013/);
  assert.match(DEFAULT_MAIL_TEMPLATES.newBody, /\{table\}/);
  const rem = bm('remind', [r], cfg, NOW);
  assert.match(rem.html, /<th[^>]*>Pending<\/th>/);
});

test('old default mail bodies (saved earlier) migrate to the new {table} default; custom text is kept', () => {
  const old = normalizeMailCfg({ templates: { newBody: 'Hello,\n\nA new POS complaint has come from the bank.\n\nCase: {case}\nDate: {date}\nAgent: {agent} ({agentId})\nTL: {tl} ({tlId})\nVRN: {vrn}\nTag ID: {tag}\nIssue: {description}\n\nPlease check and reply to the bank within TAT ({tat}). If there is no response, the bank deducts the amount from the pool account.\n\nOpen the mail: {link}\n\n— {owner}', deductBody: 'my own text {case}' } }, null, 1);
  assert.match(old.templates.newBody, /\{table\}/); assert.equal(old.templates.deductBody, 'my own text {case}');
});
