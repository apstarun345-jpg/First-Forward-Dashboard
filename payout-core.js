// 💰 v3.125.230 — IDFC payout (APN sheet) + FNF (payment release) parsing — pure functions (server + tests).
// APN sheet  : har mahine ka tab ("Oct 26"), row 2 = headers. Har row = ek agent; "Agent/TL ID" (APN####) = payee.
// FNF sheet  : har mahine ka tab ("Oct 26"), row 1 = headers. Har row = ek payee (APN ID): gross, TDS, final, releasing, REMARKS (Processed / Hold / Processing), UTR.
// Columns mahine-mahine badalte hain (Jul aur pehle 62 col, Aug se 72) → har field header NAAM se dhoondha jata hai.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const hnorm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
export const idNorm = (s) => { const t = String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^\d+$/.test(t) ? t.replace(/^0+/, '') : t; };
export const amt = (v) => { const s = String(v == null ? '' : v).replace(/[₹,\s]/g, ''); if (!s || s === '-') return 0; const n = Number(s.replace(/^\((.*)\)$/, '-$1')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };

/** "Oct 26" tab names for the last n months ending at `ym` (YYYY-MM). */
export function monthTabs(ym, n) {
  const [y, m] = String(ym).split('-').map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const yy = String(d.getUTCFullYear()).slice(2), mi = d.getUTCMonth();
    out.push({ tab: `${MONTHS[mi]} ${yy}`, ym: `${d.getUTCFullYear()}-${String(mi + 1).padStart(2, '0')}`, label: `${FULL[mi]} ${d.getUTCFullYear()}`, alt: mi === 5 ? `June ${yy}` : (mi === 6 ? `July ${yy}` : '') });
  }
  return out;
}

// [key, header (normalized), nth occurrence (0 = pehla)]
const APN_FIELDS = [
  ['agentId', 'agentid'], ['newId', 'newagentid'], ['name', 'agentname'], ['userId', 'userid'], ['payeeId', 'agenttlid'], ['status', 'agentstatus'], ['payeeName', 'agenttlname'],
  ['iss_vc4', 'vc4'], ['iss_vc20', 'vc20'], ['iss_rest', 'restclass'], ['iss_total', 'totalissuance'],
  ['rep_vc4', 'replacementvc4'], ['rep_vc20', 'replacementvc20'], ['rep_rest', 'replacementrestclass'],
  ['wv_vc4', 'wrongvrnvc4'], ['wv_vc20', 'wrongvrnvc20'], ['wv_rest', 'wrongvrnrestclass'],
  ['kb_vc4', 'kyvblacklistvc4'], ['kb_vc20', 'kyvblacklistvc20'], ['kb_rest', 'kyvblacklistrestclass'],
  ['ch_vc4', 'chassisvc4'], ['ch_vc20', 'chassisvc20'], ['ch_rest', 'restclasschasis', 0],
  ['kyc500_n', 'with500product', 0], ['kycw500_n', 'without500product', 0],
  ['pay_vc4', 'payablevc4'], ['pay_vc20', 'payablevc20'], ['pay_rest', 'payablerestclasswithoutkyc'], ['pay_total', 'totalpayabletags'],
  ['rate_vc4', 'vc4rate'], ['rate_vc20', 'vc20rate'], ['rate_vc4max', 'vc4ratewithmaxissuance'], ['rate_rest', 'restclassrate'],
  ['rate_kyc500', 'with500product', 1], ['rate_kycw500', 'without500product', 1],
  ['po_500', '500productpayout'], ['po_kyc', 'normalkycpayoutnvc4'], ['max_n', 'maxcount'], ['max_rate', 'rate'], ['po_max', 'maxpayout'],
  ['po_vc4', 'vc4payout'], ['po_vc20', 'vc20payout'], ['po_rest', 'restclasspayout'], ['po_total', 'totalpayout'],
  ['pen_wrongvrn', 'wrongvrnpenalty200'], ['po_rep_a', 'replacementpayoutvc20vc5'], ['po_rep_b', 'replacementpayoutvc6tovc16'],
  ['gross', 'grosspayout'], ['tds', 'tds2d'], ['pen_closure', 'tagclosurepenalty'], ['bank_complaint', 'bankcomplaint'], ['salary', 'salarypermonth'],
  ['pen_scanned', 'penaltyscannedtagsd'], ['secugen', 'secugendevicecharges'], ['pen_unaffixed', 'unaffixedtagpenalty'], ['bonus', 'bonusofferincentive'],
  ['opening', 'tlagentsopeningbalancead'], ['final_open', 'finalamountwithopeningbalance'], ['final', 'withoutopeningbalance'], ['payee_sum', 'tlagentsumwoopeningbalance'],
  ['bank', 'bankname'], ['ifsc', 'ifsccode'], ['account', 'accountno'], ['pan', 'pannumber'], ['panName', 'panname'], ['editRemark', 'editremark']
];
const FNF_FIELDS = [
  ['payeeId', 'agenttlid'], ['nameId', 'nameid'], ['tlName', 'tlname'], ['agentName', 'agentname'], ['opening', /opening/],
  ['gross', 'grosspayout'], ['tds', 'tds2'], ['gst', 'gst'], ['pen_scan', 'penaltynonactivescan'], ['after_tds', /^payoutaftertds/],
  ['salary', 'salary'], ['secugen', 'secugendevicecharges'], ['pen_closure', 'tagclosurepenalty'], ['incentive', 'campaignincentive'], ['pen_unaffixed', 'unaffixedpenalty'],
  ['final', 'finalpayout'], ['closing', 'closingbalance'], ['bank', 'bankname'], ['ifsc', 'ifsccode'], ['account', 'accountno'],
  ['releasing', 'releasingamount'], ['remark', 'remarks'], ['panName', 'nameinpan'], ['pan', 'panno'], ['adj', /^adjtomakezero/], ['gstApplicable', 'gstapplicability'],
  ['taxPaid', 'paidtaxamount'], ['invoice', 'invoicenumber'], ['r1', 'r1status'], ['utr', 'paymentutr'], ['adviceSent', 'advicesent'], ['emailOn', 'emailsenton'], ['tally', 'tallyid']
];

function colMap(headers, fields) {
  const H = headers.map(hnorm), map = {};
  for (const [key, want, nth] of fields) {
    let seen = 0;
    for (let i = 0; i < H.length; i++) {
      const ok = want instanceof RegExp ? want.test(H[i]) : H[i] === want;
      if (!ok) continue;
      if (seen++ === (nth || 0)) { map[key] = i; break; }
    }
  }
  return map;
}
const TEXT = new Set(['agentId', 'newId', 'name', 'userId', 'payeeId', 'status', 'payeeName', 'bank', 'ifsc', 'account', 'pan', 'panName', 'editRemark', 'nameId', 'tlName', 'agentName', 'remark', 'gstApplicable', 'invoice', 'r1', 'utr', 'adviceSent', 'emailOn', 'tally']);

/** values (2D) → { rows: [{...fields}], cols } . headerMatch: header cell test. */
export function parseGrid(values, kind) {
  const V = Array.isArray(values) ? values : [];
  const fields = kind === 'fnf' ? FNF_FIELDS : APN_FIELDS;
  const want = kind === 'fnf' ? 'agenttlid' : 'agentid';
  let hi = -1;
  for (let i = 0; i < Math.min(V.length, 6); i++) if ((V[i] || []).some((c) => hnorm(c) === want)) { hi = i; break; }
  if (hi < 0) return { rows: [], cols: {}, error: 'header row nahi mili' };
  const cols = colMap(V[hi], fields);
  const rows = [];
  for (let r = hi + 1; r < V.length; r++) {
    const row = V[r] || [];
    const o = {};
    for (const [k, i] of Object.entries(cols)) { const v = row[i]; o[k] = TEXT.has(k) ? String(v == null ? '' : v).trim() : amt(v); }
    const key = kind === 'fnf' ? o.payeeId : (o.agentId || o.newId || o.userId);
    if (!key) continue;
    rows.push(o);
  }
  return { rows, cols };
}

export const maskPan = (p) => { const s = String(p || '').trim().toUpperCase(); return /^[A-Z]{5}\d{4}[A-Z]$/.test(s) ? `${s.slice(0, 2)}XXX${s.slice(5, 7)}XX${s.slice(9)}` : (s ? 'XXXXXXXXXX' : ''); };
export const maskAcc = (a) => { const s = String(a || '').replace(/\s/g, ''); return s.length >= 4 ? `XXXXXX${s.slice(-4)}` : ''; };
const safe = (o) => { if (!o) return o; const x = { ...o }; if ('pan' in x) x.pan = maskPan(x.pan); if ('account' in x) x.account = maskAcc(x.account); return x; };

const SUMS = ['iss_vc4', 'iss_vc20', 'iss_rest', 'iss_total', 'rep_vc4', 'rep_vc20', 'rep_rest', 'wv_vc4', 'wv_vc20', 'wv_rest', 'kb_vc4', 'kb_vc20', 'kb_rest', 'ch_vc4', 'ch_vc20', 'ch_rest', 'kyc500_n', 'kycw500_n',
  'pay_vc4', 'pay_vc20', 'pay_rest', 'pay_total', 'po_500', 'po_kyc', 'max_n', 'po_max', 'po_vc4', 'po_vc20', 'po_rest', 'po_total', 'pen_wrongvrn', 'po_rep_a', 'po_rep_b', 'gross', 'tds', 'pen_closure', 'bank_complaint',
  'salary', 'pen_scanned', 'secugen', 'pen_unaffixed', 'bonus', 'opening', 'final_open', 'final'];

/**
 * Ek mahine me is insaan (agent ya TL/payee) ki payout nikaalo.
 * want: { ids: [..], name } — ids me agent ID / new ID / user ID / APN payee ID kuch bhi.
 */
export function matchMonth(apn, fnf, want) {
  const ids = new Set((want.ids || []).map(idNorm).filter((x) => x && x.length >= 3));
  const nm = hnorm(want.name);
  const A = (apn && apn.rows) || [], F = (fnf && fnf.rows) || [];
  let role = '', payeeId = '';
  // 1) payee (TL / direct APN ID)
  const asPayee = A.filter((r) => ids.has(idNorm(r.payeeId)));
  const asFnf = F.filter((r) => ids.has(idNorm(r.payeeId)));
  let agents = [];
  if (asPayee.length || asFnf.length) { role = 'payee'; payeeId = (asPayee[0] || asFnf[0]).payeeId; agents = A.filter((r) => idNorm(r.payeeId) === idNorm(payeeId)); }
  else {
    agents = A.filter((r) => [r.agentId, r.newId, r.userId].some((v) => ids.has(idNorm(v))));
    if (!agents.length && nm.length >= 4) { const byName = A.filter((r) => hnorm(r.name) === nm); const pays = new Set(byName.map((r) => r.payeeId)); if (byName.length && pays.size === 1) agents = byName; }
    if (!agents.length && nm.length >= 4) {      // TL naam se (payee name)
      const byTl = A.filter((r) => hnorm(r.payeeName) === nm); const pays = new Set(byTl.map((r) => r.payeeId));
      if (byTl.length && pays.size === 1) { role = 'payee'; payeeId = byTl[0].payeeId; agents = A.filter((r) => r.payeeId === payeeId); }
    }
    if (agents.length && !role) { role = 'agent'; payeeId = agents[0].payeeId; }
  }
  if (!role) return null;
  const totals = {};
  SUMS.forEach((k) => { totals[k] = Math.round(agents.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100; });
  const f = F.find((r) => idNorm(r.payeeId) === idNorm(payeeId)) || null;
  const head = agents.find((r) => idNorm(r.payeeId) === idNorm(payeeId)) || agents[0] || {};
  return {
    role, payeeId, payeeName: head.payeeName || (f && (f.tlName || f.agentName)) || '',
    agents: agents.map(safe), totals, fnf: safe(f),
    bank: f ? { bank: f.bank, ifsc: f.ifsc, account: maskAcc(f.account), panName: f.panName, pan: maskPan(f.pan) } : (head.bank ? { bank: head.bank, ifsc: head.ifsc, account: maskAcc(head.account), panName: head.panName, pan: maskPan(head.pan) } : null)
  };
}

/** FNF remark → status (Processed / Hold / Processing / Not processed) */
export function statusOf(f) {
  if (!f) return { key: 'none', label: 'Not in FNF' };
  const r = String(f.remark || '').trim();
  if (!r) return { key: 'none', label: 'No remark' };
  if (/hold/i.test(r)) return { key: 'hold', label: r };
  if (/processing|in\s*process|pending|under/i.test(r)) return { key: 'proc', label: r };
  if (/processed|paid|released?|done|success|complete/i.test(r)) return { key: 'paid', label: r };
  return { key: 'other', label: r };
}
