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

test('scheduled plan uses the shared run-rate formula and source priority (FF + GV)', () => {
  const config = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, sections: ['summary', 'agents', 'tls'], maxRows: 500 });
  const plan = buildDispatchPlan(sources, config, { settings, days: 25, now });
  const ravi = plan.agents.find((r) => r.name === 'Ravi Kumar');
  assert.equal(ravi.rate, 10); // 280 ÷ 28
  assert.equal(ravi.required, 250);
  assert.equal(ravi.gross, 250); // stock is not subtracted
  assert.equal(ravi.net, 150); // stock-subtracted quantity
  assert.equal(ravi.cover, 10);
  assert.equal(plan.agents.find((r) => r.name === 'Source Review').priority, 'Review soon');
  assert.equal(plan.agents.find((r) => r.name === 'Source Review').tagged, undefined, 'unknown priority is preserved, never promoted to High/Medium');
  assert.equal(plan.summary.agents, 5);
  assert.equal(plan.summary.high, 2);
  assert.equal(plan.summary.medium, 0);
  assert.equal(plan.summary.low, 2);
  assert.equal(plan.summary.source, 1);
  const tl = plan.tls.find((r) => r.name === 'TL One');
  assert.equal(tl.agents, 2);
  assert.equal(tl.curV, 336);
  assert.equal(tl.stockV, 320, 'TL stock in the source report wins over the sum of member stock');
  assert.equal(tl.priority, 'Medium');
  const gvTl = plan.tls.find((r) => r.ch === 'gv' && !r.direct);
  assert.equal(gvTl.priority, '', 'do not invent a GV TL priority');
});

test('channel / tag basis / source-priority filters apply to the emailed rows', () => {
  const vc4 = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, channel: 'gv', basis: 'vc4', priority: 'High', sections: ['agents'] });
  const plan = buildDispatchPlan(sources, vc4, { settings, days: 25, now });
  assert.deepEqual(plan.agents.map((r) => r.name), ['GV Ramesh']);
  assert.equal(plan.agents[0].rate, 5);
  assert.equal(plan.agents[0].required, 125);
  const other = buildDispatchPlan(sources, { ...vc4, channel: 'all', basis: 'total', priority: 'other' }, { settings, days: 25, now });
  assert.deepEqual(other.agents.map((r) => r.name), ['Source Review']);
  const mixedTl = sources.slice(0, 2);
  mixedTl[1] = { ...mixedTl[1], tlPriority: 'High' };
  const group = buildDispatchPlan(mixedTl, { ...vc4, channel: 'ff', priority: 'other' }, { settings, days: 25, now });
  assert.equal(group.tls[0].priority, 'Medium / High');
});

test('email builder includes selected CSV attachments and leaves unknown priority text intact', () => {
  const schedule = normalizeDispatchEmail({ ...DEFAULT_DISPATCH_EMAIL, sections: ['summary', 'agents', 'tls'], maxRows: 100 });
  const plan = buildDispatchPlan(sources, schedule, { settings, days: 25, now });
  const mail = dispatchEmailContent(plan, schedule, 'FF + GV', '2026-09-29');
  assert.match(mail.subject, /Dispatch Planner/);
  assert.match(mail.text, /without subtracting stock/);
  assert.match(mail.text, /Other \/ unchanged source value 1/);
  assert.equal(mail.attachments.length, 2);
  assert.match(mail.attachments[0].content, /Review soon/);
  assert.match(mail.attachments[0].content, /Dispatch W\/O stock/);
  assert.match(mail.attachments[1].name, /tl-summary/);
  const summaryOnly = dispatchEmailContent(plan, { ...schedule, sections: ['summary'] }, 'FF + GV', '2026-09-29');
  assert.equal(summaryOnly.attachments.length, 0);
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
  assert.deepEqual(plan.agents.map((r) => r.name).sort(), ['GV Ramesh', 'Ravi Kumar']);

  const two = buildDispatchPlan(sources, { ...multi, priority: 'High,Low' }, { settings, days: 25, now });
  assert.deepEqual(two.agents.map((r) => r.name).sort(), ['GV Free', 'GV Ramesh', 'Ravi Kumar', 'Sita Devi']);

  // single value = purana behaviour (regression lock)
  const single = buildDispatchPlan(sources, { ...multi, channel: 'gv', priority: 'High' }, { settings, days: 25, now });
  assert.deepEqual(single.agents.map((r) => r.name), ['GV Ramesh']);
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
