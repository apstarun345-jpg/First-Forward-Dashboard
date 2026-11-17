/* Regression coverage for Dispatch Planner scheduled-email calculations and settings. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DISPATCH_EMAIL, normalizeDispatchEmail, sourcePriority, buildDispatchPlan, dispatchEmailContent } from '../dispatch-email.js';

const sources = [
  {
    ch: 'ff', kind: 'agent', name: 'Ravi Kumar', agentId: 'R1', id: 'R1', tl: 'TL One', tlName: 'TL One', tlId: 'T1', direct: false,
    priority: '🔴 High', tlPriority: '🟡 Medium', status: 'Active',
    cur: { vc4: 280, comm: 0, total: 280 }, last: { vc4: 200, comm: 0, total: 200 },
    stock: { vc4: 100, comm: 0, total: 100 }, tlStock: { vc4: 300, comm: 20, total: 320 }
  },
  {
    ch: 'ff', kind: 'agent', name: 'Sita Devi', agentId: 'R2', id: 'R2', tl: 'TL One', tlName: 'TL One', tlId: 'T1', direct: false,
    priority: 'Low', tlPriority: '🟡 Medium', status: 'Active',
    cur: { vc4: 56, comm: 0, total: 56 }, last: { vc4: 90, comm: 0, total: 90 },
    stock: { vc4: 500, comm: 0, total: 500 }, tlStock: { vc4: 300, comm: 20, total: 320 }
  },
  {
    ch: 'ff', kind: 'agent', name: 'Source Review', agentId: 'D1', id: 'D1', tl: '', tlName: '', tlId: '', direct: true, directLabel: 'Direct Agent (APS)',
    priority: 'Review soon', tlPriority: '', status: '',
    cur: { vc4: 40, comm: 0, total: 40 }, last: { vc4: 0, comm: 0, total: 0 },
    stock: { vc4: 0, comm: 0, total: 0 }, tlStock: { vc4: 0, comm: 0, total: 0 }
  },
  {
    ch: 'gv', kind: 'agent', name: 'GV Ramesh', agentId: 'G1', id: 'G1', tl: 'GV TL', tlName: 'GV TL', tlId: 'GT1', direct: false,
    priority: 'High', tlPriority: '', status: 'Active',
    cur: { vc4: 140, comm: 28, total: 168 }, last: { vc4: 100, comm: 20, total: 120 },
    stock: { vc4: 0, comm: 0, total: 0 }, tlStock: { vc4: 0, comm: 0, total: 0 }
  },
  {
    ch: 'gv', kind: 'agent', name: 'GV Free', agentId: 'G2', id: 'G2', tl: '', tlName: '', tlId: '', direct: true, directLabel: 'Direct Agent (no TL)',
    priority: 'Low', tlPriority: '', status: 'Active',
    cur: { vc4: 28, comm: 0, total: 28 }, last: { vc4: 0, comm: 0, total: 0 },
    stock: { vc4: 5, comm: 0, total: 5 }, tlStock: { vc4: 0, comm: 0, total: 0 }
  }
];
const now = new Date('2026-09-29T12:00:00.000Z'); // 28 elapsed run-rate days
const settings = { direct: { labelFf: 'Direct Agent (APS)', labelGv: 'Direct Agent (no TL)' } };

test('dispatch email settings validate recipients, data sections and IST schedule', () => {
  const v = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, enabled: true, recipients: 'ops@example.com; Manager <manager@example.org>', sections: ['summary', 'agents', 'agents'], hour: 0, kind: 'weekly', weekday: 1 });
  assert.equal(v.enabled, true);
  assert.equal(v.hour, 0);
  assert.deepEqual(v.sections, ['summary', 'agents']);
  assert.throws(() => normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, recipients: 'not-an-email' }), /valid email/i);
  assert.throws(() => normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, sections: [] }), /at least|kam se kam/i);
  assert.throws(() => normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, day: 31 }), /1 se 28/i);
});

test('source priority wording normalizes only known labels and preserves unknown sheet text', () => {
  assert.equal(sourcePriority('🔴 High priority'), 'High');
  assert.equal(sourcePriority('🟡 Slight'), 'Medium');
  assert.equal(sourcePriority('🟢 Low'), 'Low');
  assert.equal(sourcePriority('Review soon'), 'Review soon');
  assert.equal(sourcePriority(''), '');
});

test('scheduled plan uses the page run-rate formula and stock-cover priority (FF + GV)', () => {
  const config = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, sections: ['summary', 'agents', 'tls'], maxRows: 500 });
  const plan = buildDispatchPlan(sources, config, { settings, days: 25, now });
  const ravi = plan.agents.find((r) => r.name === 'Ravi Kumar');
  assert.equal(ravi.rate, 10); // 280 ÷ 28
  assert.equal(ravi.required, 250);
  assert.equal(ravi.gross, 250); // stock is not subtracted
  assert.equal(ravi.net, 150); // stock-subtracted quantity (VC4/VC20 150 + VC5+ 0)
  assert.equal(ravi.netA, 150); assert.equal(ravi.netB, 0);
  assert.equal(ravi.cover, 10);
  assert.equal(ravi.priority, 'Medium', 'cover 10 din → Medium (page jaisa), sheet "High" nahi');
  assert.equal(ravi.sheetPriority, 'High');
  assert.equal(plan.agents.find((r) => r.name === 'Sita Devi').priority, 'Low');      // cover 250 din
  assert.equal(plan.agents.find((r) => r.name === 'Source Review').priority, 'High'); // issuance hai, stock 0
  assert.equal(plan.agents.find((r) => r.name === 'GV Free').priority, 'High', 'GV sheet "Low" ho tab bhi cover 5 din → High');
  assert.equal(plan.summary.agents, 5);
  assert.equal(plan.summary.ff, 3); assert.equal(plan.summary.gv, 2);
  assert.equal(plan.summary.high, 3);
  assert.equal(plan.summary.medium, 1);
  assert.equal(plan.summary.low, 1);
  assert.equal(plan.summary.source, 0);
  const tl = plan.tls.find((r) => r.name === 'TL One');
  assert.equal(tl.agents, 2);
  assert.equal(tl.curV, 336);
  assert.equal(tl.stockV, 320, 'TL stock in the source report wins over the sum of member stock');
  assert.equal(tl.priority, 'Low', 'TL cover (VC4 300 ÷ 12/din = 25 din) → Low');
  assert.equal(tl.sheetPriority, 'Medium');
  const gvTl = plan.tls.find((r) => r.ch === 'gv' && !r.direct);
  assert.equal(gvTl.priority, 'High');
});

test('channel / tag basis / priority filters apply to the emailed rows', () => {
  const vc4 = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, channel: 'gv', basis: 'vc4', priority: 'High', sections: ['agents'] });
  const plan = buildDispatchPlan(sources, vc4, { settings, days: 25, now });
  assert.deepEqual(plan.agents.map((r) => r.name), ['GV Ramesh', 'GV Free']);
  assert.equal(plan.agents[0].rate, 5);
  assert.equal(plan.agents[0].required, 125);
  // issuance 0 + sheet ka unknown text → "other" (page jaisa, badla nahi jaata)
  const idle = [...sources, { ...sources[2], name: 'Idle Review', agentId: 'D9', id: 'D9', cur: { vc4: 0, comm: 0, total: 0 } }];
  const other = buildDispatchPlan(idle, { ...vc4, channel: 'all', basis: 'total', priority: 'other' }, { settings, days: 25, now });
  assert.deepEqual(other.agents.map((r) => r.name), ['Idle Review']);
  assert.equal(other.agents[0].priority, 'Review soon');
  const lowIdle = buildDispatchPlan([{ ...sources[1], priority: 'High', cur: { vc4: 0, comm: 0, total: 0 } }], { ...vc4, channel: 'ff', priority: 'Low' }, { settings, days: 25, now });
  assert.equal(lowIdle.agents.length, 1, 'issuance 0 → Low (sheet High ho tab bhi), page jaisa');
});

test('email builder includes selected CSV attachments with mobile + page priority', () => {
  const schedule = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, sections: ['summary', 'agents', 'tls'], maxRows: 100 });
  const withMobile = sources.map((r) => ({ ...r }));
  Object.defineProperty(withMobile[3], 'mobile', { value: '9876543210', enumerable: false });
  withMobile[0].mobile = '9123456780';
  const plan = buildDispatchPlan(withMobile, schedule, { settings, days: 25, now });
  const mail = dispatchEmailContent(plan, schedule, 'FF + GV', '2026-09-29');
  assert.match(mail.subject, /Dispatch Planner/);
  assert.match(mail.text, /without subtracting stock/);
  assert.match(mail.text, /First Forward 3 · GV Partner 2/);
  assert.match(mail.text, /High 3 · Medium 1 · Low 1\./);
  assert.equal(mail.attachments.length, 2);
  const csv = mail.attachments[0].content.split('\r\n');
  assert.match(csv[0], /^"Name","ID","Mobile","Channel"/);
  assert.match(csv[0], /Dispatch W\/O stock/);
  assert.ok(csv.some((l) => l.startsWith('"GV Ramesh","G1","9876543210","GV Partner"')), 'GV agent ka mobile');
  assert.ok(csv.some((l) => l.startsWith('"Ravi Kumar","R1","9123456780","First Forward"')), 'FF agent ka mobile');
  assert.match(mail.attachments[1].name, /tl-summary/);
  const summaryOnly = dispatchEmailContent(plan, { ...schedule, sections: ['summary'] }, 'FF + GV', '2026-09-29');
  assert.equal(summaryOnly.attachments.length, 0);
});

test('v3.125.306: FF + GV + High/Medium — GV REPORT ki sheet priority "Low" ho tab bhi GV agents mail me (bug fix)', () => {
  const gvLow = sources.map((r) => (r.ch === 'gv' ? { ...r, priority: 'Low' } : { ...r }));
  const cfg = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, channel: ['ff', 'gv'], priority: 'High,Medium', sections: ['summary', 'agents'], maxRows: 500 });
  const plan = buildDispatchPlan(gvLow, cfg, { settings, days: 30, now });
  assert.ok(plan.summary.gv > 0, 'GV agents aane chahiye');
  assert.deepEqual(plan.agents.filter((r) => r.ch === 'gv').map((r) => r.name).sort(), ['GV Free', 'GV Ramesh']);
  assert.ok(plan.agents.some((r) => r.ch === 'ff'));
  // thresholds settings se (FF.config.thresholds jaisa)
  const strict = buildDispatchPlan(gvLow, cfg, { settings: { ...settings, thresholds: { coverRed: 3, coverOrange: 4 } }, days: 30, now });
  assert.ok(!strict.agents.some((r) => r.name === 'GV Free'), 'cover 5 din > 4 → Low');
});

/* 🔠 v3.18 — multiple selection in the scheduled dispatch email. */
test('channel + priority accept multiple values (array, comma or plus separated)', () => {
  const both = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, channel: ['ff', 'gv'], priority: 'High,Medium', sections: ['agents'] });
  assert.equal(both.channel, 'ff,gv');
  assert.equal(both.priority, 'High,Medium');
  assert.equal(normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, channel: 'ff+gv' }).channel, 'ff,gv');
  assert.equal(normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, channel: [] }).channel, 'all', 'khaali = All');
  assert.equal(normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, priority: 'all' }).priority, 'all');
  assert.throws(() => normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, channel: 'ff,xv' }), /Channel/i);
  assert.throws(() => normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, priority: 'High,URGENT' }), /Priority/i);
});

test('multiple channels + priorities widen the emailed rows, single values behave as before', () => {
  const multi = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, channel: 'ff,gv', priority: 'High', sections: ['agents'] });
  const plan = buildDispatchPlan(sources, multi, { settings, days: 25, now });
  assert.deepEqual(plan.agents.map((r) => r.name).sort(), ['GV Free', 'GV Ramesh', 'Source Review']);

  const two = buildDispatchPlan(sources, { ...multi, priority: 'High,Low' }, { settings, days: 25, now });
  assert.deepEqual(two.agents.map((r) => r.name).sort(), ['GV Free', 'GV Ramesh', 'Sita Devi', 'Source Review']);

  const single = buildDispatchPlan(sources, { ...multi, channel: 'gv', priority: 'High' }, { settings, days: 25, now });
  assert.deepEqual(single.agents.map((r) => r.name), ['GV Ramesh', 'GV Free']);
  const ffOnly = buildDispatchPlan(sources, { ...multi, channel: 'ff', priority: 'Medium' }, { settings, days: 25, now });
  assert.deepEqual(ffOnly.agents.map((r) => r.name), ['Ravi Kumar']);
});

test('email subject/labels read well for a multi-selection', () => {
  const multi = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, channel: 'ff,gv', priority: 'High,other', sections: ['summary', 'agents'] });
  const plan = buildDispatchPlan(sources, multi, { settings, days: 25, now });
  const email = dispatchEmailContent(plan, multi, 'ApnaPayment', '29 Sep 2026');
  assert.match(email.subject, /^Dispatch Planner · 29 Sep 2026$/);
  assert.match(email.text, /First Forward \+ GV Partner · All tags · High priority \+ Other \/ source value/);

  const one = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, channel: 'gv', priority: 'High', sections: ['summary'] });
  const oneEmail = dispatchEmailContent(buildDispatchPlan(sources, one, { settings, days: 25, now }), one, 'ApnaPayment', '29 Sep 2026');
  assert.match(oneEmail.subject, /· GV Partner$/);
  assert.match(oneEmail.text, /GV Partner · All tags · High priority/);
});

test('v3.125.305: exact HH:MM time — "time" field se hour+minute, purane hour-only schedule bhi chalte hain', () => {
  const a = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, time: '18:45' });
  assert.equal(a.hour, 18); assert.equal(a.minute, 45); assert.equal('time' in a, false);
  const old = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, hour: 7, minute: undefined });
  assert.equal(old.hour, 7); assert.equal(old.minute, 0);
  const keep = normalizeDispatchEmail({ time: '06:05' }, { ...DEFAULT_DISPATCH_EMAIL, hour: 9, minute: 30 });
  assert.equal(keep.hour, 6); assert.equal(keep.minute, 5);
  assert.throws(() => normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, minute: 60 }), /Minute/);
  assert.throws(() => normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, time: '25:00' }), /Hour/);
});

test('v3.125.305: agent type filter — sirf Direct agents / sirf TL-managed', () => {
  assert.equal(normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL }).agentType, 'all');
  assert.throws(() => normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, agentType: 'boss' }), /Agent type/);
  const base = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, sections: ['summary', 'agents', 'tls'] });
  const direct = buildDispatchPlan(sources, { ...base, agentType: 'direct' }, { settings, days: 15, now });
  assert.deepEqual(direct.agents.map((r) => r.id).sort(), ['D1', 'G2']);
  assert.ok(direct.agents.every((r) => r.direct));
  assert.ok(direct.tls.every((r) => r.direct), 'TL-wise CSV me sirf Direct group');
  assert.equal(direct.summary.agents, 2);
  const tl = buildDispatchPlan(sources, { ...base, agentType: 'tl' }, { settings, days: 15, now });
  assert.deepEqual(tl.agents.map((r) => r.id).sort(), ['G1', 'R1', 'R2']);
  assert.ok(tl.tls.every((r) => !r.direct));
  const all = buildDispatchPlan(sources, base, { settings, days: 15, now });
  assert.equal(all.summary.agents, 5);
  const mail = dispatchEmailContent(direct, { ...base, agentType: 'direct' }, 'FF', '2026-09-29');
  assert.match(mail.subject, /Direct agents \(no TL\)/);
  assert.match(mail.text, /Direct agents \(no TL\)/);
  assert.doesNotMatch(dispatchEmailContent(all, base, 'FF', '2026-09-29').subject, /Direct agents/);
});
