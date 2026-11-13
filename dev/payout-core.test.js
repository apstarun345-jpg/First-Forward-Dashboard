// 💰 v3.125.230 — APN + FNF payout sheet parsing / matching / masking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../payout-core.js';

const APN_H = ['Agent ID', 'New Agent ID', 'AGENT NAME', 'User_ID', 'Agent/TL ID', 'Agent Status', 'Agent/TL Name', 'VC4', 'VC20', 'Rest Class', 'Total Issuance',
  'Payable VC4', 'Payable VC20', 'Payable Rest Class (Without KYC)', 'Total Payable Tags', 'VC4 Rate', 'VC20 Rate', 'Rest Class Rate',
  'VC4 Payout', 'VC20 Payout', 'Rest Class Payout', 'Total Payout', 'Gross Payout', 'TDS 2% (D)', 'Final Amount With Opening Balance', 'Without Opening Balance',
  'Bank Name', 'IFSC Code', 'Account No', 'PAN Number', 'PAN NAME', 'Edit Remark'];
const row = (o) => APN_H.map((h) => (h in o ? o[h] : ''));
const apnValues = [['IDFC payout Oct 26'], APN_H,
  row({ 'Agent ID': '6203633', 'New Agent ID': 'X1', 'AGENT NAME': 'ABHISHEK', 'Agent/TL ID': 'APN2201', 'Agent/TL Name': 'ABHISHEK', VC4: '100', 'Payable VC4': '95', 'Total Payable Tags': '95', 'VC4 Rate': '40', 'VC4 Payout': '3,800', 'Total Payout': '3800', 'Gross Payout': '3800', 'TDS 2% (D)': '(76)', 'Without Opening Balance': '3724', 'PAN Number': 'ABCDE1234F', 'Account No': '123456789012' }),
  row({ 'Agent ID': '7001', 'AGENT NAME': 'RAVI', 'Agent/TL ID': 'APN2421', 'Agent/TL Name': 'UMESH SHARMA', VC4: '50', 'Total Payable Tags': '48', 'Without Opening Balance': '1000' }),
  row({ 'Agent ID': '7002', 'AGENT NAME': 'GITA', 'Agent/TL ID': 'APN2421', 'Agent/TL Name': 'UMESH SHARMA', VC4: '30', 'Total Payable Tags': '30', 'Without Opening Balance': '600' }),
  row({})];
const FNF_H = ['AGENT /TL ID', 'NAME & ID', 'TL Name', 'Agent Name', "October'26 Opening (+)", 'GROSS PAYOUT (+)', 'TDS 2% (-)', 'GST', 'FINAL PAYOUT', 'Closing Balance', 'Releasing Amount', 'REMARKS', 'Payment UTR', 'PAN NO', 'Account No'];
const fnfValues = [FNF_H,
  ['APN2421', 'UMESH SHARMA APN2421', 'UMESH SHARMA', '', '0', '324,355', '6487', '0', '321122', '0', '321122', 'Processed', 'UTR123', 'ABCDE1234F', '99998888'],
  ['APN2201', 'ABHISHEK', '', 'ABHISHEK', '0', '3800', '76', '0', '3724', '0', '0', 'Hold', '', '', '']];

test('monthTabs → "Oct 26" style, newest first', () => {
  const m = P.monthTabs('2026-11', 3);
  assert.deepEqual(m.map((x) => x.tab), ['Nov 26', 'Oct 26', 'Sep 26']);
  assert.equal(m[1].label, 'October 2026'); assert.equal(m[1].ym, '2026-10');
});

test('parseGrid finds header row + amounts', () => {
  const a = P.parseGrid(apnValues, 'apn');
  assert.equal(a.rows.length, 3);
  assert.equal(a.rows[0].po_vc4, 3800); assert.equal(a.rows[0].tds, -76); assert.equal(a.rows[0].rate_vc4, 40);
  const f = P.parseGrid(fnfValues, 'fnf');
  assert.equal(f.rows.length, 2); assert.equal(f.rows[0].gross, 324355); assert.equal(f.rows[0].remark, 'Processed');
});

test('matchMonth: TL / payee → all agents; agent → own row; masking', () => {
  const a = P.parseGrid(apnValues, 'apn'), f = P.parseGrid(fnfValues, 'fnf');
  const tl = P.matchMonth(a, f, { ids: ['APN2421'] });
  assert.equal(tl.role, 'payee'); assert.equal(tl.agents.length, 2); assert.equal(tl.totals.final, 1600); assert.equal(tl.fnf.releasing, 321122);
  assert.equal(tl.bank.account, 'XXXXXX8888'); assert.equal(tl.bank.pan, 'ABXXX12XXF');
  const ag = P.matchMonth(a, f, { ids: ['7002'] });
  assert.equal(ag.role, 'agent'); assert.equal(ag.agents.length, 1); assert.equal(ag.payeeId, 'APN2421');
  const byName = P.matchMonth(a, f, { ids: [], name: 'Umesh Sharma' });
  assert.equal(byName.role, 'payee');
  assert.equal(P.matchMonth(a, f, { ids: ['nope1'] }), null);
  assert.equal(a.rows[0].pan, 'ABCDE1234F');
  const ab = P.matchMonth(a, f, { ids: ['6203633'] });
  assert.equal(ab.agents[0].pan, 'ABXXX12XXF'); assert.equal(ab.agents[0].account, 'XXXXXX9012');
});

test('statusOf', () => {
  assert.equal(P.statusOf({ remark: 'Processed' }).key, 'paid');
  assert.equal(P.statusOf({ remark: 'Processing' }).key, 'proc');
  assert.equal(P.statusOf({ remark: 'HOLD - KYC' }).key, 'hold');
  assert.equal(P.statusOf(null).key, 'none');
});
