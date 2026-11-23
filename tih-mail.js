// 🏷️ Tag In Hand — bank (IDFC PartnersETC) "Tag In Hand Dated DD-MM-YYYY-AN01-Apna Payment" mails.
//
// Har mail me password-protected .xls attachment aata hai (password format IDFC@DDMM). Yahan:
//   • subject se report-day + password nikalna, attachment (Apps Script `complaintfiles`) padhna, header (aage-peeche ho to bhi) pehchanna
//   • rows ko mahine-wise ek jagah rakhna (durable: CACHE_TIH tab), sirf NAYI mails hi dobara padhna
//   • FF agent = file me agent id/name hai; blank = GV → GV Master se tag id par ek baar lookup (cache), naya tag aaye tabhi dobara
//   • TL name (FF: Agent master Sheet4, GV: GV Master), TL mail (user set karta hai), remark, date-wise bulk mail
// Pure functions export hain taaki test ho sakein.

export const TIH_SUBJECT_RE = /tag\s*in\s*hand\s*dated/i;
const pad = (n) => String(n).padStart(2, '0');
const istDay = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);

export const DEFAULT_TPL = {
  agent: { subject: 'Tag In Hand · Agent {name} · {dates} · {count} tags', body: 'Dear {name},\n\nBank ki Tag In Hand report ({dates}) ke hisaab se aapke {count} tag hotlist hue hain (tag hath me / dusri gaadi par use ho raha hai).\n\nKripya customer se sampark karke tag vehicle ki windshield par lagwayein aur IDFC CRM Portal par HTBO category me KYV images ke saath whitelisting request daalein.\n\n{table}\n\nThanks,\n{sender}' },
  tl: { subject: 'Tag In Hand · TL {name} · {dates} · {count} tags ({agents} agents)', body: 'Dear {name},\n\nBank ki Tag In Hand report ({dates}) me aapke {agents} agents ke total {count} tag hotlist hue hain.\n\nKripya apne agents ke through customer se sampark karke tag windshield par lagwayein aur IDFC CRM Portal par HTBO category me KYV images ke saath whitelisting request daalein.\n\n{table}\n\nThanks,\n{sender}' },
  gv: { subject: 'Tag In Hand · GV · {dates} · {count} tags ({agents} agents)', body: 'Hi Team,\n\nGV ki Tag In Hand report ({dates}): {agents} agents ke {count} tag hotlist hue hain. Agent-wise detail neeche aur CSV me hai.\n\n{table}\n\nThanks,\n{sender}' }
};
export const DEFAULT_TIH_CFG = { enabled: true, months: 3, gvTo: '', gvCc: '', ffCc: '', from: '', sender: 'Apna Payment Team', replyTo: '', tpl: DEFAULT_TPL };

export function normalizeCfg(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const m = Math.round(Number(c.months));
  const mails = (v) => String(v || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 10).join(', ');
  const t = c.tpl && typeof c.tpl === 'object' ? c.tpl : {};
  const tpl = {};
  for (const k of ['agent', 'tl', 'gv']) {
    const x = t[k] && typeof t[k] === 'object' ? t[k] : {};
    tpl[k] = { subject: String(x.subject || '').trim().slice(0, 200) || DEFAULT_TPL[k].subject, body: String(x.body || '').trim().slice(0, 4000) || DEFAULT_TPL[k].body };
  }
  return { enabled: c.enabled !== false && c.enabled !== 'false', months: m >= 1 && m <= 12 ? m : 3, gvTo: mails(c.gvTo), gvCc: mails(c.gvCc), ffCc: mails(c.ffCc),
    replyTo: String(c.replyTo || '').replace(/[\r\n,;\s]/g, '').slice(0, 120),
    from: String(c.from || '').replace(/[\r\n]/g, ' ').trim().slice(0, 160), sender: String(c.sender || '').replace(/[\r\n]/g, ' ').trim().slice(0, 80) || 'Apna Payment Team', tpl };
}
export const invalidEmails = (list) => String(list || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).filter((x) => !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(x));

/** "Tag In Hand Dated 21-11-2026-AN01-Apna Payment" → '2026-11-21' ('' agar na mile). */
export function subjectDay(subject) {
  const m = /dated\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/i.exec(String(subject || ''));
  if (!m) return '';
  const d = Number(m[1]), mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return '';
  return `${m[3]}-${pad(mo)}-${pad(d)}`;
}
/** Password format IDFC@DDMM — pehle subject ki date, phir mail ki date (IST), phir pichhla din. */
export function passwordCandidates(subject, mailMs) {
  const out = [];
  const add = (iso) => { if (/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) { const p = `IDFC@${iso.slice(8, 10)}${iso.slice(5, 7)}`; if (!out.includes(p)) out.push(p); } };
  const sd = subjectDay(subject);
  add(sd);
  if (mailMs) { add(istDay(mailMs)); add(istDay(mailMs - 86400e3)); }
  if (sd) { const d = new Date(`${sd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); add(d.toISOString().slice(0, 10)); }
  return out;
}

// ---------------------------------------------------------------- header pehchan (aage-peeche / alag naam)
const HEADER_KEYS = {
  file: ['filename', 'file'],
  vrn: ['vrn', 'vehiclenumber', 'vehicleno', 'vehiclenum', 'vehicleregistrationnumber', 'regno', 'registrationnumber'],
  tagId: ['tagid', 'tag', 'tagidno', 'tagnumber', 'tagno'],
  reason: ['reason', 'remark', 'remarks', 'hotlistreason', 'hotlistedreason'],
  issueDate: ['issuedate', 'issueddate', 'dateofissue', 'taggissuedate', 'tagissuedate', 'issuancedate'],
  agentId: ['agentid', 'agentcode', 'uniqueid', 'bcid', 'agentuniqueid'],
  agentName: ['agentname', 'agent', 'bcname'],
  distId: ['distributorid', 'distid', 'distributorcode'],
  distName: ['distributorname', 'distname', 'distributor']
};
const normH = (h) => String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '');
export function headerMap(cells) {
  const map = {};
  (cells || []).forEach((c, i) => {
    const n = normH(c); if (!n) return;
    for (const [k, alts] of Object.entries(HEADER_KEYS)) if (!(k in map) && alts.includes(n)) { map[k] = i; break; }
  });
  return map;
}
/** Date text (DD-MM-YYYY / DD/MM/YYYY / YYYY-MM-DD / DD-Mon-YY / excel serial) → 'YYYY-MM-DD' ya ''. */
export function toIso(v) {
  const s = String(v == null ? '' : v).trim(); if (!s) return '';
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]*(\d{2,4})/.exec(s);
  if (m) { const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].slice(0, 3).toLowerCase()); if (mo >= 0) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(mo + 1)}-${pad(m[1])}`; }
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400e3); return d.toISOString().slice(0, 10); }
  return '';
}
export const cleanTag = (v) => String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const cleanId = (v) => String(v == null ? '' : v).trim().replace(/\.0+$/, '');
const DEFAULT_ORDER = ['file', 'vrn', 'tagId', 'reason', 'issueDate', 'agentId', 'agentName', 'distId', 'distName'];

/** 2-D rows (header sahit) → [{vrn, tagId, reason, issueDate, agentId, agentName, distId, distName}] */
export function parseTable(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(list.length, 15); i++) {
    const m = headerMap(list[i]);
    if (('tagId' in m || 'vrn' in m) && Object.keys(m).length >= 3) { hi = i; map = m; break; }
  }
  if (!map) { map = {}; DEFAULT_ORDER.forEach((k, i) => { map[k] = i; }); hi = (list[0] && /tag|vrn|agent/i.test(list[0].join(' '))) ? 0 : -1; }
  const get = (r, k) => (k in map ? r[map[k]] : '');
  const out = [];
  for (let i = hi + 1; i < list.length; i++) {
    const r = list[i]; if (!Array.isArray(r)) continue;
    const tagId = cleanTag(get(r, 'tagId'));
    if (!tagId || normH(get(r, 'tagId')) === 'tagid') continue;
    out.push({
      vrn: String(get(r, 'vrn') || '').trim().toUpperCase(), tagId, reason: String(get(r, 'reason') || '').trim(),
      issueDate: toIso(get(r, 'issueDate')), agentId: cleanId(get(r, 'agentId')), agentName: String(get(r, 'agentName') || '').trim(),
      distId: cleanId(get(r, 'distId')), distName: String(get(r, 'distName') || '').trim()
    });
  }
  return out;
}
/** CSV text → 2-D rows (quotes support). */
export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

// ---------------------------------------------------------------- mail banana (date-wise / multi-date bulk)
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const normTl = (v) => String(v || '').toUpperCase().replace(/\s+/g, ' ').trim();
export const dmy = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : iso || '');
export const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function csvOf(rows) {
  const head = ['Report date', 'Channel', 'VRN', 'Tag ID', 'Reason', 'Issue date', 'Agent ID', 'Agent name', 'TL name', 'Remark'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) lines.push([dmy(r.day), String(r.ch || '').toUpperCase(), r.vrn, r.tagId, r.reason, dmy(r.issueDate), r.agentId, r.agentName, r.tlName, r.remark].map(csvCell).join(','));
  return lines.join('\r\n');
}
export function datesLabel(days) {
  const d = [...new Set(days || [])].filter(Boolean).sort();
  if (!d.length) return '';
  if (d.length === 1) return dmy(d[0]);
  return `${dmy(d[0])} → ${dmy(d[d.length - 1])} (${d.length} dates)`;
}
export const agentKeyOf = (r) => String(r.agentId || r.agentName || '—');
/** rows → agent-wise groups [{key, name, id, rows}] (zyada tags wale pehle). */
export function byAgent(rows) {
  const m = new Map();
  for (const r of rows) { const k = agentKeyOf(r); if (!m.has(k)) m.set(k, { key: k, name: r.agentName || r.agentId || 'Agent ?', id: r.agentId || '', rows: [] }); m.get(k).rows.push(r); }
  return [...m.values()].sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
}
const fillTpl = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (w, k) => (k in vars ? String(vars[k]) : w));
function tableText(groups) {
  const out = ['Agent-wise summary:'];
  groups.forEach((g, i) => out.push(`${i + 1}. ${g.name}${g.id ? ` (${g.id})` : ''} — ${g.rows.length} tags`));
  out.push('');
  for (const g of groups) {
    out.push(`▶ ${g.name}${g.id ? ` (${g.id})` : ''} — ${g.rows.length} tags`);
    g.rows.forEach((r, i) => out.push(`   ${i + 1}. ${dmy(r.day)} | ${r.vrn || '-'} | ${r.tagId} | ${r.reason || '-'} | issue ${dmy(r.issueDate) || '-'}${r.remark ? ` | ${r.remark}` : ''}`));
    out.push('');
  }
  return out.join('\n');
}
function tableHtml(groups, showTotal) {
  const th = 'style="background:#4f46e5;color:#fff;padding:7px 9px;text-align:left;font-size:12px;white-space:nowrap"';
  const td = (i) => `style="padding:6px 9px;font-size:12px;border-bottom:1px solid #e2e8f0;background:${i % 2 ? '#f8fafc' : '#fff'}"`;
  const sum = `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:8px 0 14px;min-width:320px"><thead><tr><th ${th}>#</th><th ${th}>Agent</th><th ${th}>ID</th><th ${th} align="right">Tags</th></tr></thead><tbody>${groups.map((g, i) => `<tr><td ${td(i)}>${i + 1}</td><td ${td(i)}><b>${esc(g.name)}</b></td><td ${td(i)}>${esc(g.id)}</td><td ${td(i)} align="right"><b>${g.rows.length}</b></td></tr>`).join('')}${showTotal ? `<tr><td colspan="3" style="padding:7px 9px;font-weight:800;background:#e0e7ff">Total</td><td align="right" style="padding:7px 9px;font-weight:800;background:#e0e7ff">${groups.reduce((n, g) => n + g.rows.length, 0)}</td></tr>` : ''}</tbody></table>`;
  const head = ['#', 'Date', 'VRN', 'Tag ID', 'Reason', 'Issue date', 'Remark'].map((h) => `<th ${th}>${h}</th>`).join('');
  const det = groups.map((g) => `<div style="margin:12px 0 4px;padding:6px 10px;border-radius:8px;background:linear-gradient(90deg,#ede9fe,#fce7f3);font-weight:800;color:#4338ca">👤 ${esc(g.name)}${g.id ? ` <span style="font-weight:600;color:#64748b">(${esc(g.id)})</span>` : ''} — ${g.rows.length} tags</div><table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%"><thead><tr>${head}</tr></thead><tbody>${g.rows.map((r, i) => `<tr><td ${td(i)}>${i + 1}</td><td ${td(i)}>${esc(dmy(r.day))}</td><td ${td(i)}><b>${esc(r.vrn)}</b></td><td ${td(i)}><code>${esc(r.tagId)}</code></td><td ${td(i)}>${esc(r.reason)}</td><td ${td(i)}>${esc(dmy(r.issueDate))}</td><td ${td(i)}>${esc(r.remark)}</td></tr>`).join('')}</tbody></table>`).join('');
  return `<div style="font-weight:800;margin-top:6px">Agent-wise summary</div>${sum}${det}`;
}
/** kind: 'agent' | 'tl' | 'gv'. name = agent / TL ka naam. tpl = cfg.tpl[kind]. */
export function buildMail({ kind = 'tl', name = '', days = [], rows, cfg }) {
  const c = normalizeCfg(cfg);
  const tpl = c.tpl[kind] || c.tpl.tl;
  const groups = byAgent(rows);
  const vars = { name: name || (kind === 'gv' ? 'GV' : ''), kind: kind === 'agent' ? 'Agent' : kind === 'tl' ? 'TL' : 'GV', dates: datesLabel(days), count: rows.length, agents: groups.length, sender: c.sender };
  const subject = fillTpl(tpl.subject, vars).replace(/\s+/g, ' ').trim();
  const bodyText = fillTpl(tpl.body, { ...vars, table: '\u0000T\u0000' });
  const textFinal = tpl.body.includes('{table}') ? bodyText.replace('\u0000T\u0000', tableText(groups)) : `${bodyText}\n\n${tableText(groups)}`;
  const parts = bodyText.split('\u0000T\u0000');
  const p2h = (t) => esc(t).replace(/\n/g, '<br>');
  const tbl = tableHtml(groups, groups.length > 1);
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;font-size:13px">${p2h(parts[0])}${parts.length > 1 ? `${tbl}${p2h(parts.slice(1).join(''))}` : `<br>${tbl}`}</div>`;
  const who = String(name || kind).replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
  const dd = [...new Set(days)].sort();
  return { subject, text: textFinal, html, csv: csvOf(rows), fileName: `TagInHand_${kind}_${who}_${dd.length > 1 ? `${dd[0]}_to_${dd[dd.length - 1]}` : dd[0] || ''}.csv`, agents: groups.length };
}

/** Rows (view) → bhejne ke groups.
 *  mode: all | gv | ff | tl | agent ; target = TL naam / agent key (mode tl/agent) ; to = ek hi group ho to custom email.
 *  GV → gvTo (ek mail). FF: direct agent → us agent ko (subject me agent naam) · TL ke agents → TL ko ek mail (TL naam). */
export function planSend({ rows, mode = 'all', target = '', cfg, to = '' }) {
  const groups = [], skipped = [];
  const days = [...new Set(rows.map((r) => r.day))].filter(Boolean).sort();
  const c = normalizeCfg(cfg);
  const wantGv = mode === 'all' || mode === 'gv';
  const wantFf = mode === 'all' || mode === 'ff' || mode === 'tl' || mode === 'agent';
  if (wantGv) {
    const gv = rows.filter((r) => r.ch === 'gv');
    if (gv.length) { if (c.gvTo || to) groups.push({ key: 'gv', kind: 'gv', ch: 'gv', name: 'GV', label: 'GV', to: to || c.gvTo, cc: to ? '' : c.gvCc, rows: gv, days }); else skipped.push({ label: 'GV', n: gv.length, why: 'GV mail set nahi (⚙ Mail settings)' }); }
  }
  if (wantFf) {
    const by = new Map();
    for (const r of rows.filter((x) => x.ch === 'ff')) {
      const direct = !!r.direct;
      const k = direct ? `a:${agentKeyOf(r)}` : `t:${normTl(r.tlName) || '—'}`;
      if (mode === 'tl' && (direct || normTl(r.tlName) !== normTl(target))) continue;
      if (mode === 'agent' && agentKeyOf(r) !== target) continue;
      if (!by.has(k)) by.set(k, { direct, name: direct ? (r.agentName || r.agentId) : (r.tlName || ''), list: [] });
      by.get(k).list.push(r);
    }
    for (const [k, g] of by) {
      const mail = (g.list.find((r) => r.mailTo) || {}).mailTo || '';
      const label = g.direct ? `Agent ${g.name}` : `TL ${g.name || '—'}`;
      if (!g.direct && !g.name) { skipped.push({ label: 'FF · TL pata nahi', n: g.list.length, why: 'TL registry me nahi mila' }); continue; }
      if (to || mail) groups.push({ key: k, kind: g.direct ? 'agent' : 'tl', ch: 'ff', name: g.name, label, to: to || mail, cc: to ? '' : c.ffCc, rows: g.list, days });
      else skipped.push({ label, n: g.list.length, why: g.direct ? 'Agent ki mail nahi (sheet / table me daalo)' : 'TL mail nahi (sheet / table me daalo)' });
    }
  }
  if (to && groups.length > 1) return { days, groups: [], skipped: [{ label: 'Custom mail', n: groups.length, why: 'Custom email sirf ek TL / agent / GV ke liye — pehle ek chuno' }] };
  groups.sort((a, b) => (a.ch === b.ch ? a.label.localeCompare(b.label) : a.ch < b.ch ? 1 : -1));
  return { days, groups, skipped };
}

// ---------------------------------------------------------------- service
export function createTihService({ getStore, load, save, lookupGv, lookupTl, getBook, readXls, getCfg, now = () => Date.now(), log = () => {} }) {
  let data = null;                    // { v, threads, rows, gv, remarks, tlMails, sent }
  const st = { at: 0, ok: 0, error: '', running: null, loaded: false, lastNew: 0, pending: 0, gvErr: '' };
  const fresh = () => ({ v: 1, threads: {}, rows: [], gv: {}, remarks: {}, tlMails: {}, sent: {} });
  let saveTimer = null;

  async function ensure() {
    if (data) return data;
    let obj = null;
    try { obj = await load(); } catch (e) { st.error = `load: ${String((e && e.message) || e).slice(0, 100)}`; }
    data = obj && typeof obj === 'object' && Array.isArray(obj.rows) ? { ...fresh(), ...obj } : fresh();
    st.loaded = true;
    return data;
  }
  async function flush() {
    if (!data) return false;
    clearTimeout(saveTimer); saveTimer = null;
    try { return await save(data, { rows: data.rows.length, at: now() }); } catch { return false; }
  }
  const saveSoon = () => { if (saveTimer) return; saveTimer = setTimeout(() => { saveTimer = null; flush().catch(() => {}); }, 4000); if (saveTimer.unref) saveTimer.unref(); };

  function queryFor(months) {
    const t = new Date(now() + 5.5 * 3600e3);
    const s = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - (months - 1), 1));
    return { q: `subject:("Tag In Hand Dated") has:attachment after:${s.getUTCFullYear()}/${pad(s.getUTCMonth() + 1)}/01`, since: s.toISOString().slice(0, 10) };
  }

  async function processThread(store, th, cfg) {
    const subject = th.subject || '';
    const m0 = (th.messages || [])[0] || {};
    const day = subjectDay(subject) || (m0.date ? istDay(m0.date) : '');
    const rec = { id: th.id, subject: subject.slice(0, 120), day, mailAt: m0.date || 0, at: now(), n: 0, err: '', tries: ((data.threads[th.id] || {}).tries || 0) + 1 };
    try {
      const out = await store.call('complaintfiles', { threadId: th.id });
      const files = ((out && out.files) || []).filter((f) => /\.(xls|xlsx|csv)$/i.test(f.name || ''));
      if (!files.length) throw new Error('attachment nahi mila');
      let all = [];
      for (const f of files) {
        const buf = Buffer.from(f.b64 || '', 'base64');
        let tables;
        if (/\.csv$/i.test(f.name)) tables = [parseCsv(buf.toString('utf8'))];
        else { const r = await readXls(buf, passwordCandidates(subject, m0.date)); tables = r.sheets.map((s) => s.rows); rec.pw = r.password ? 'ok' : 'open'; }
        for (const t of tables) all = all.concat(parseTable(t));
      }
      const seen = new Set();
      const rows = [];
      for (const r of all) { const k = `${th.id}:${r.tagId}`; if (seen.has(k)) continue; seen.add(k); rows.push({ k, tid: th.id, day, ...r }); }
      data.rows = data.rows.filter((r) => r.tid !== th.id).concat(rows);
      rec.n = rows.length; rec.tries = 0;
    } catch (e) { rec.err = String((e && e.message) || e).slice(0, 140); }
    data.threads[th.id] = rec;
    return rec;
  }

  async function fillGv() {
    if (!lookupGv) return 0;
    const t = now();
    const need = [];
    const seen = new Set();
    for (const r of data.rows) {
      if (r.agentId || r.agentName) continue;
      const g = data.gv[r.tagId];
      if (seen.has(r.tagId)) continue;
      if (g && (!g.miss || (g.tries || 0) >= 3 || t - g.at < 6 * 3600e3)) continue;
      seen.add(r.tagId); need.push({ key: r.tagId, tagId: r.tagId, vrn: r.vrn });
    }
    if (!need.length) return 0;
    let found;
    try { found = await lookupGv(need); st.gvErr = ''; } catch (e) { st.gvErr = String((e && e.message) || e).slice(0, 120); return 0; }
    for (const it of need) {
      const hit = found && found.get(it.key);
      const prev = data.gv[it.tagId] || {};
      data.gv[it.tagId] = hit ? { id: hit.id || '', name: hit.name || '', tlName: hit.tlName || '', tlId: hit.tlId || '', at: t } : { miss: true, at: t, tries: (prev.tries || 0) + 1 };
    }
    return need.length;
  }

  async function sync({ force = false, max = 10 } = {}) {
    if (st.running) return st.running;
    st.running = (async () => {
      const cfg = normalizeCfg(getCfg ? getCfg() : null);
      if (!cfg.enabled && !force) return { skipped: true };
      await ensure();
      const store = getStore ? getStore() : null;
      if (!store) { st.error = 'Apps Script connect nahi'; return { error: st.error }; }
      st.at = now();
      try {
        const { q, since } = queryFor(cfg.months);
        let threads = [], start = 0;
        for (let page = 0; page < 4; page++) {
          const out = await store.call('complaints', { query: q, start, max: 100 });
          if (!out || out.ok === false) throw new Error((out && out.error) || 'Gmail read fail');
          threads = threads.concat((out.threads || []).filter((t) => TIH_SUBJECT_RE.test(t.subject || '')));
          if (!out.more) break; start += 100;
        }
        const todo = threads.filter((t) => { const r = data.threads[t.id]; return !r || (r.err && r.tries < 4 && now() - r.at > 20 * 60e3) || (force && r.err); });
        todo.sort((a, b) => ((b.messages[0] || {}).date || 0) - ((a.messages[0] || {}).date || 0));
        st.pending = Math.max(0, todo.length - max);
        let done = 0;
        for (const th of todo.slice(0, max)) { await processThread(store, th, cfg); done++; }
        // purane (months se bahar) rows + threads hatao
        data.rows = data.rows.filter((r) => !r.day || r.day >= since);
        for (const [id, r] of Object.entries(data.threads)) if (r.day && r.day < since) delete data.threads[id];
        const gvN = await fillGv();
        if (done || gvN) { st.lastNew = now(); await flush(); }
        st.ok = now(); st.error = '';
        return { threads: threads.length, processed: done, gv: gvN };
      } catch (e) { st.error = String((e && e.message) || e).slice(0, 160); return { error: st.error }; }
    })().finally(() => { st.running = null; });
    return st.running;
  }

  /** Page ke liye rows (enriched). */
  async function view() {
    await ensure();
    const cfg = normalizeCfg(getCfg ? getCfg() : null);
    const memo = new Map();
    const tlOf = (r) => { const k = `${r.agentId}|${r.agentName}`; if (!memo.has(k)) { let v = null; try { v = lookupTl ? lookupTl({ agentId: r.agentId, agentName: r.agentName }) : null; } catch { v = null; } memo.set(k, v || {}); } return memo.get(k); };
    const book = getBook ? getBook() : null;
    const idn = (v) => String(v || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const mailOk = (v) => (/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(String(v || '').trim()) ? String(v).trim() : '');
    const rows = data.rows.map((r) => {
      const ff = !!(r.agentId || r.agentName);
      const g = ff ? null : data.gv[r.tagId];
      const hit = g && !g.miss ? g : null;
      const tl = ff ? tlOf(r) : null;
      const tlName = ff ? (tl && tl.tlName) || '' : (hit && hit.tlName) || '';
      const tlId = ff ? (tl && tl.tlId) || '' : (hit && hit.tlId) || '';
      const agentId = ff ? r.agentId : (hit ? hit.id : ''), agentName = ff ? r.agentName : (hit ? hit.name : '');
      // direct agent = TL ID uska apna ID, ya TL ka naam = agent ka naam, ya TL hi nahi
      const direct = ff && (!tlName || (tl && ((tl.tlId && [tl.newId, tl.id, agentId].some((x) => idn(x) && idn(x) === idn(tl.tlId))) || normTl(tlName) === normTl(tl.name || agentName))));
      const entKey = direct ? `A:${idn(agentId) || normTl(agentName)}` : `T:${normTl(tlName)}`;
      const manual = ff ? (data.tlMails[entKey] || (!direct ? data.tlMails[normTl(tlName)] : '') || '') : '';
      let sheet = '';
      if (ff && !manual && book) sheet = direct ? mailOk(book.agentMail && book.agentMail({ agentId, newId: tl && tl.newId, id: tl && tl.id })) : mailOk(book.tlMail && book.tlMail({ tlId, tlName }));
      const rm = data.remarks[r.k], sent = data.sent[r.k];
      return { k: r.k, tid: r.tid, day: r.day, vrn: r.vrn, tagId: r.tagId, reason: r.reason, issueDate: r.issueDate, ch: ff ? 'ff' : 'gv',
        agentId, agentName, src: ff ? 'mail' : (hit ? 'gv' : (g && g.miss ? 'miss' : 'wait')),
        tlName, tlId, direct, ent: ff ? entKey : '', mailTo: manual || sheet, mailSrc: manual ? 'manual' : sheet ? 'sheet' : '',
        remark: rm ? rm.t : '', sentAt: sent ? sent.at : 0, sentTo: sent ? sent.to : '' };
    });
    rows.sort((a, b) => (b.day || '').localeCompare(a.day || '') || (a.ch < b.ch ? -1 : 1) || (a.agentName || '').localeCompare(b.agentName || ''));
    const months = [...new Set(rows.map((r) => (r.day || '').slice(0, 7)).filter(Boolean))].sort().reverse();
    const threads = Object.values(data.threads).sort((a, b) => (b.day || '').localeCompare(a.day || '')).slice(0, 80);
    return { rows, months, threads, cfg, meta: { at: st.at ? new Date(st.at).toISOString() : '', okAt: st.ok ? new Date(st.ok).toISOString() : '', running: !!st.running, error: st.error, gvErr: st.gvErr, pending: st.pending, mails: Object.keys(data.threads).length, loaded: st.loaded } };
  }

  async function setRemark(key, text, by) {
    await ensure();
    if (!data.rows.some((r) => r.k === key)) return false;
    const t = String(text || '').trim().slice(0, 300);
    if (t) data.remarks[key] = { t, at: now(), by: by || '' }; else delete data.remarks[key];
    saveSoon(); return true;
  }
  async function setTlMail(ent, email) {
    await ensure();
    let k = String(ent || '').trim();
    if (!/^[AT]:/.test(k)) k = `T:${normTl(k)}`; else k = `${k[0]}:${k.slice(2).toUpperCase().replace(/\s+/g, ' ').trim()}`;
    if (k.length < 3) return false;
    const e = String(email || '').trim().slice(0, 200);
    if (e) data.tlMails[k] = e; else delete data.tlMails[k];
    saveSoon(); return true;
  }
  async function markSent(keys, to, by) { await ensure(); const t = now(); for (const k of keys) data.sent[k] = { at: t, to: String(to || '').slice(0, 120), by: by || '' }; await flush(); }
  async function resetGvMisses() { await ensure(); let n = 0; for (const [k, g] of Object.entries(data.gv)) if (g.miss) { delete data.gv[k]; n++; } if (n) saveSoon(); return n; }

  return { sync, view, ensure, flush, setRemark, setTlMail, markSent, resetGvMisses, state: st, _data: () => data };
}
