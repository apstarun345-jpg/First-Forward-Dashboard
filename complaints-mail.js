// 📨 Agents Complaints Summary — bank (IDFC PartnersETC) POS-complaint mails → table + status.
//
// Flow: Apps Script (Gmail) `complaints` action mails ko thread-wise bhejta hai → yahan parse hoti hain:
//   • pehli mail ki HTML table (Case Number · VRN · Tag Id · Description · BC Name · Agent Name · agent id)
//   • thread ke baaki messages se status:  Pending · Solved by <owner> (humne reply kiya) · Solved by Bank
//     (bank ne khud debit/refund/close kar diya) · Solved by Team (kisi aur ne reply kiya)
// Server background me current month ko har N minute (Settings) me refresh karke cache rakhta hai —
// page khulte hi data tayyar milta hai. Pure functions export hain taaki test ho sakein.

const MONTH_RE = /^\d{4}-\d{2}-\d{2}$/;
export const COMPLAINT_STATUS = { PENDING: 'Pending', BANK: 'Solved by Bank', TEAM: 'Solved by Team' };
export const ownerStatus = (owner) => `Solved by ${String(owner || 'Tarun').trim() || 'Tarun'}`;
const RESOLVED_RE = /(debited|debit\b|deduct|refund|resolved|closed|settled|reversed|credited|processed|rejected|recovered)/i;
const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)/i;

export const DEFAULT_COMPLAINTS_CFG = { enabled: true, refreshMin: 10, subjects: ['POS Related-Request'], ownerName: 'Tarun', tatHours: 24 };

export function normalizeCfg(raw, prev = null, nowMs = Date.now()) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const subjects = (Array.isArray(c.subjects) ? c.subjects : String(c.subjects || '').split(/\n/))
    .map((s) => String(s || '').replace(/["\r\n]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12);
  const refresh = Number(c.refreshMin);
  const tat = Number(c.tatHours);
  return {
    enabled: c.enabled !== false && c.enabled !== 'false',
    refreshMin: Number.isFinite(refresh) ? Math.min(1440, Math.max(2, Math.round(refresh))) : DEFAULT_COMPLAINTS_CFG.refreshMin,
    subjects: subjects.length ? subjects : DEFAULT_COMPLAINTS_CFG.subjects.slice(),
    ownerName: String(c.ownerName || '').trim().slice(0, 40) || DEFAULT_COMPLAINTS_CFG.ownerName,
    tatHours: Number.isFinite(tat) && tat > 0 ? Math.min(720, tat) : DEFAULT_COMPLAINTS_CFG.tatHours,
    mail: normalizeMailCfg(c.mail, prev && prev.mail, nowMs)
  };
}

// ---------------------------------------------------------------- 📧 mail alerts (rules + templates)
export const MAIL_PLACEHOLDERS = ['{case}', '{date}', '{agent}', '{agentId}', '{tl}', '{tlId}', '{vrn}', '{tag}', '{description}', '{bc}', '{status}', '{amount}', '{note}', '{age}', '{tat}', '{link}', '{owner}', '{count}', '{list}', '{table}'];
export const DEFAULT_MAIL_TEMPLATES = {
  newSubject: '🚨 New POS complaint · Case {case} · {agent}',
  newBody: 'Hello,\n\nA new POS complaint has come from the bank. Please check and reply to the bank within TAT ({tat}). If there is no response, the bank deducts the amount from the pool account.\n\n{table}\n\nOpen the mail: {link}\n\n— {owner}',
  deductSubject: '💸 Bank deducted ₹{amount} · Case {case} · {agent}',
  deductBody: 'Hello,\n\nThe bank has deducted ₹{amount} from the pool account for this POS complaint.\n\n{table}\n\nBank note: {note}\n\nPlease recover this amount from the agent / settle it.\nOpen the mail: {link}\n\n— {owner}',
  remindSubject: '⏰ Reminder · {count} pending POS complaint(s)',
  remindBody: 'Hello,\n\nThese POS complaints are still pending (no reply to the bank yet):\n\n{table}\n\nPlease reply to the bank before TAT ends, otherwise the amount is deducted from the pool account.\n\n— {owner}'
};
// v3.113 ke default body (jo settings me save ho chuke ho sakte hain) → naye {table} default par apne aap badal jayein
const OLD_DEFAULT_BODIES = {
  newBody: 'Hello,\n\nA new POS complaint has come from the bank.\n\nCase: {case}\nDate: {date}\nAgent: {agent} ({agentId})\nTL: {tl} ({tlId})\nVRN: {vrn}\nTag ID: {tag}\nIssue: {description}\n\nPlease check and reply to the bank within TAT ({tat}). If there is no response, the bank deducts the amount from the pool account.\n\nOpen the mail: {link}\n\n— {owner}',
  deductBody: 'Hello,\n\nThe bank has deducted ₹{amount} from the pool account for this POS complaint.\n\nCase: {case}\nAgent: {agent} ({agentId})\nTL: {tl} ({tlId})\nVRN: {vrn}\nTag ID: {tag}\nIssue: {description}\nBank note: {note}\n\nPlease recover this amount from the agent / settle it.\n\nOpen the mail: {link}\n\n— {owner}',
  remindBody: 'Hello,\n\nThese POS complaints are still pending (no reply to the bank yet):\n\n{list}\n\nPlease reply to the bank before TAT ends, otherwise the amount is deducted from the pool account.\n\n— {owner}'
};
const EMAIL_OK = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
export const splitEmails = (v) => String(v || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
export const invalidEmails = (v) => splitEmails(v).filter((x) => !EMAIL_OK.test(x));
const normKey = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export function normalizeMailCfg(raw, prev = null, nowMs = Date.now()) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const old = new Map(((prev && prev.rules) || []).map((r) => [r.id, r]));
  const rh = Number(m.remindHours);
  const tpl = {};
  for (const k of Object.keys(DEFAULT_MAIL_TEMPLATES)) {
    const t = m.templates && typeof m.templates[k] === 'string' ? m.templates[k].replace(/\r/g, '').trim() : '';
    tpl[k] = (!t || t === OLD_DEFAULT_BODIES[k] ? DEFAULT_MAIL_TEMPLATES[k] : t).slice(0, k.endsWith('Subject') ? 200 : 4000);
  }
  const list = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\n;|]+/)).map((x) => String(x || '').trim().slice(0, 80)).filter(Boolean))].slice(0, 100);
  const rules = (Array.isArray(m.rules) ? m.rules : []).slice(0, 30).map((r, i) => {
    const id = String((r && r.id) || '').replace(/[^\w-]/g, '').slice(0, 24) || `r${nowMs.toString(36)}${i}`;
    // purana shape (target + value) → naya (all / tls[] / agents[])
    const legacy = r && r.all === undefined && r.target !== undefined;
    const all = legacy ? r.target === 'all' : !(r && (r.all === false || r.all === 'false'));
    const tls = legacy ? (r.target === 'tl' ? list(r.value) : []) : list(r && r.tls);
    const agents = legacy ? (r.target === 'agent' ? list(r.value) : []) : list(r && r.agents);
    const prevRule = old.get(id);
    const enabled = !(r && (r.enabled === false || r.enabled === 'false'));
    // since: is waqt ke BAAD aayi complaints par hi mail — rule banate / ON karte waqt purani complaints par mail ki baarish nahi
    const since = prevRule && prevRule.enabled && prevRule.since ? prevRule.since : (!prev && Number(r && r.since) > 0 ? Number(r.since) : nowMs);
    return {
      id, enabled, label: String((r && r.label) || '').trim().slice(0, 60), all, tls: all ? [] : tls, agents: all ? [] : agents,
      to: splitEmails(r && r.to).filter((x) => EMAIL_OK.test(x)).slice(0, 10).join(', '),
      onNew: !(r && (r.onNew === false || r.onNew === 'false')), onDeduct: !(r && (r.onDeduct === false || r.onDeduct === 'false')), remind: !(r && (r.remind === false || r.remind === 'false')),
      attach: !(r && (r.attach === false || r.attach === 'false')),
      since
    };
  });
  return { enabled: m.enabled === true || m.enabled === 'true', remindHours: Number.isFinite(rh) ? Math.min(72, Math.max(1, Math.round(rh * 2) / 2)) : 4, rules, templates: tpl };
}

/** Rule ka target is complaint par lagta hai? all, ya chune hue TL / agent (naam ya ID) me se koi ek. */
export function ruleMatches(rule, row) {
  if (!rule) return false;
  if (rule.all) return true;
  const hit = (list, ...fields) => (list || []).some((v) => { const k = normKey(v); return k && fields.some((f) => normKey(f) === k); });
  return hit(rule.tls, row.tlName, row.tlId) || hit(rule.agents, row.agentName, row.agentId);
}

const fmtDate = (ms) => { try { return new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) + ' IST'; } catch { return ''; } };
const ageOf = (ms, now) => { const h = Math.max(0, Math.round((now - ms) / 3600e3)); return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`; };
const fill = (tpl, map) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in map ? String(map[k] ?? '') : m));
export function rowVars(row, cfg, now = Date.now()) {
  return { case: row.caseNo, date: fmtDate(row.date), agent: row.agentName || '—', agentId: row.agentId || '—', tl: row.tlName || '—', tlId: row.tlId || '—', vrn: row.vrn || '—', tag: row.tagId || '—', description: row.description || '—', bc: row.bcName || '—', status: row.status, amount: row.deducted ? String(row.deducted) : '', note: row.bankNote || '—', age: ageOf(row.date, now), tat: `${cfg.tatHours || 24}h`, link: row.link || '', owner: cfg.ownerName || '' };
}
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TABLE_TOKEN = '\u0001TABLE\u0001';
const TH = 'background:#ffff00;border:1px solid #000000;padding:7px 9px;text-align:center;font-weight:bold;font-size:13px;color:#000000;white-space:nowrap';
const TD = 'border:1px solid #000000;padding:7px 9px;text-align:center;font-size:13px;color:#111111;vertical-align:middle';
/** Bank ki mail jaisi table (peela header, gulabi Case cell). Single complaint = 1 row; reminder = pending rows. */
export function complaintTableHtml(rows, kind, cfg, now = Date.now()) {
  const cols = [['Case Number', 'case'], ['Vehicle Registration Number', 'vrn'], ['Tag Id', 'tag'], ['Description', 'desc'], ['BC Name', 'bc'], ['Agent Name', 'agent'], ['Agent ID', 'agentId'], ['TL Name', 'tl'], ['TL ID', 'tlId']];
  if (kind === 'deduct') cols.push(['Deducted (₹)', 'ded']);
  if (kind === 'remind') cols.push(['Pending', 'age'], ['TAT', 'tat']);
  const cell = (r, k) => {
    switch (k) {
      case 'case': return `<td style="${TD};background:#f8c9d0;color:#d6193b;font-weight:bold;font-size:14px">${r.link ? `<a href="${esc(r.link)}" style="color:#d6193b;text-decoration:none">${esc(r.caseNo)}</a>` : esc(r.caseNo)}</td>`;
      case 'vrn': return `<td style="${TD}">${esc(r.vrn || '—')}</td>`;
      case 'tag': return `<td style="${TD};font-family:Consolas,Menlo,monospace;font-size:12px;word-break:break-all">${esc(r.tagId || '—')}</td>`;
      case 'desc': return `<td style="${TD};text-align:left;min-width:220px">${esc(r.description || '—')}</td>`;
      case 'bc': return `<td style="${TD}">${esc(r.bcName || '—')}</td>`;
      case 'agent': return `<td style="${TD};font-weight:bold">${esc(r.agentName || '—')}${r.issuerSrc ? '<br><span style="font-weight:normal;font-size:11px;color:#2563eb">✓ GV Master</span>' : ''}</td>`;
      case 'agentId': return `<td style="${TD}">${esc(r.agentId || '—')}</td>`;
      case 'tl': return `<td style="${TD};font-weight:bold">${esc(r.tlName || '—')}</td>`;
      case 'tlId': return `<td style="${TD}">${esc(r.tlId || '—')}</td>`;
      case 'ded': return `<td style="${TD};color:#b91c1c;font-weight:bold">₹${esc(r.deducted || '')}</td>`;
      case 'age': return `<td style="${TD}${r.tatBreached ? ';color:#e11d48;font-weight:bold' : ''}">${esc(ageOf(r.date, now))}${r.tatBreached ? '<br>TAT breached' : ''}</td>`;
      case 'tat': return `<td style="${TD}">${esc(`${cfg.tatHours || 24}h`)}</td>`;
      default: return '<td></td>';
    }
  };
  const note = rows.filter((r) => r.issuerSrc).length ? `<p style="font-size:12px;color:#475569;margin:6px 0 0">✓ Agent name / ID taken from <b>GV Master</b> (looked up by Tag ID / VRN) — the bank mail only shows “${esc(rows.find((r) => r.issuerSrc).mailAgentName || 'APNA PAYMENT')} · ${esc(rows.find((r) => r.issuerSrc).mailAgentId || '')}”.</p>` : '';
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #000000;font-family:Arial,Helvetica,sans-serif;width:100%"><thead><tr>${cols.map(([l]) => `<th style="${TH}">${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map(([, k]) => cell(r, k)).join('')}</tr>`).join('')}</tbody></table>${note}`;
}
export function complaintTableText(rows, kind, cfg, now = Date.now()) {
  if (kind === 'remind') {
    return rows.map((r) => `• Case ${r.caseNo} · ${r.agentName || '—'} (${r.agentId || '—'}) · TL ${r.tlName || '—'} (${r.tlId || '—'}) · pending ${ageOf(r.date, now)}${r.tatBreached ? ' · TAT BREACHED' : ''}\n  VRN ${r.vrn || '—'} · Tag ${r.tagId || '—'}\n  ${r.description ? r.description.slice(0, 160) : ''}\n  ${r.link}`).join('\n');
  }
  return rows.map((r) => [`Case Number: ${r.caseNo}`, `Vehicle Registration Number: ${r.vrn || '—'}`, `Tag Id: ${r.tagId || '—'}`, `Description: ${r.description || '—'}`, `BC Name: ${r.bcName || '—'}`, `Agent Name: ${r.agentName || '—'}`, `Agent ID: ${r.agentId || '—'}`, `TL Name: ${r.tlName || '—'}`, `TL ID: ${r.tlId || '—'}`, ...(kind === 'deduct' ? [`Deducted: ₹${r.deducted}`] : [])].join('\n')).join('\n\n');
}
/** Plain text → HTML mail; TABLE_TOKEN ki jagah asli table lagti hai. */
export function htmlOf(text, tableHtml = '') {
  const body = esc(text).replace(/(https?:\/\/[^\s<&]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>').replace(esc(TABLE_TOKEN), `</div>${tableHtml}<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#0f172a">`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#0f172a">${body}</div>`;
}
export function buildMail(kind, rowsOrRow, cfg, now = Date.now()) {
  const t = cfg.mail.templates;
  const rows = Array.isArray(rowsOrRow) ? rowsOrRow : [rowsOrRow];
  const tk = kind === 'remind' ? 'remind' : kind === 'deduct' ? 'deduct' : 'new';
  const tableText = complaintTableText(rows, tk, cfg, now), tableHtml = complaintTableHtml(rows, tk, cfg, now);
  let vars;
  if (kind === 'remind') vars = { count: rows.length, list: complaintTableText(rows, 'remind', cfg, now), owner: cfg.ownerName || '', tat: `${cfg.tatHours || 24}h` };
  else vars = rowVars(rows[0], cfg, now);
  const render = (tpl, forHtml) => fill(tpl, { ...vars, table: forHtml ? TABLE_TOKEN : tableText });
  const body = kind === 'remind' ? t.remindBody : kind === 'deduct' ? t.deductBody : t.newBody;
  const subj = kind === 'remind' ? t.remindSubject : kind === 'deduct' ? t.deductSubject : t.newSubject;
  return { subject: fill(subj, vars), text: render(body, false), html: htmlOf(render(body, true), tableHtml) };
}

/**
 * Kaun si mail ab jaani chahiye (pure — state mutate nahi karta).
 *   state: { sent: { '<rowKey>|<ruleId>': { n: ts, d: ts } }, remind: { '<ruleId>': ts } }
 * Return: [{ kind, ruleId, to, subject, text, html, marks: [{ type:'sent', key, f }, { type:'remind', ruleId }] }]
 */
export function planMails({ rows, cfg, state, now = Date.now(), max = 15 }) {
  const mail = cfg.mail;
  if (!mail || !mail.enabled) return [];
  const out = [];
  const sent = (state && state.sent) || {}, remindAt = (state && state.remind) || {};
  const recent = (rows || []).filter((r) => now - r.date < 35 * 86400e3);
  for (const rule of mail.rules) {
    if (!rule.enabled || !rule.to) continue;
    const mine = recent.filter((r) => ruleMatches(rule, r));
    for (const r of mine) {
      const key = `${r.key}|${rule.id}`, done = sent[key] || {};
      if (rule.onNew && !done.n && r.status === COMPLAINT_STATUS.PENDING && r.date >= rule.since) {
        out.push({ kind: 'new', ruleId: rule.id, to: rule.to, ...buildMail('new', r, cfg, now), marks: [{ type: 'sent', key, f: 'n' }], caseNo: r.caseNo, threadId: r.threadId, attach: rule.attach !== false });
      }
      if (rule.onDeduct && !done.d && r.status === COMPLAINT_STATUS.BANK && r.deducted > 0 && (r.resolvedAt || 0) >= rule.since) {
        out.push({ kind: 'deduct', ruleId: rule.id, to: rule.to, ...buildMail('deduct', r, cfg, now), marks: [{ type: 'sent', key, f: 'd' }], caseNo: r.caseNo, threadId: r.threadId, attach: rule.attach !== false });
      }
    }
    if (rule.remind) {
      const last = remindAt[rule.id] || rule.since;
      const pend = mine.filter((r) => r.status === COMPLAINT_STATUS.PENDING).sort((a, b) => a.date - b.date);
      if (pend.length && now - last >= mail.remindHours * 3600e3) {
        out.push({ kind: 'remind', ruleId: rule.id, to: rule.to, ...buildMail('remind', pend.slice(0, 40), cfg, now), marks: [{ type: 'remind', ruleId: rule.id }], count: pend.length });
      }
    }
  }
  return out.slice(0, max);
}

const pad = (n) => String(n).padStart(2, '0');
/** Gmail search `after:/before:` ke liye YYYY/MM/DD (before exclusive → +1 din). */
const gmailDay = (iso, plus = 0) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + plus); return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`; };
export function buildQuery(subjects, from, to) {
  const subs = (subjects || []).map((s) => `"${String(s).replace(/"/g, '')}"`);
  if (!subs.length) throw new Error('Kam se kam ek subject chahiye.');
  let q = `subject:(${subs.join(' OR ')})`;
  if (MONTH_RE.test(from || '')) q += ` after:${gmailDay(from, -1)}`;   // 1 din pad: Gmail ka date timezone alag hota hai
  if (MONTH_RE.test(to || '')) q += ` before:${gmailDay(to, 2)}`;
  return q;
}

// ---------------------------------------------------------------- HTML table parse
const ENT = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
const cellText = (h) => String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENT[m] || m).replace(/\s+/g, ' ').trim();
const HEAD_MAP = [
  [/^case\s*(number|no|id)?$/i, 'caseNo'], [/^(vehicle\s*registration\s*number|vehicle\s*(no|number)|vrn|reg(istration)?\s*(no|number)?)$/i, 'vrn'],
  [/^tag\s*id$/i, 'tagId'], [/^(description|complaint|issue|remarks?)$/i, 'description'], [/^bc\s*name$/i, 'bcName'],
  [/^agent\s*name$/i, 'agentName'], [/^agent\s*id$/i, 'agentId']
];
const headKey = (t) => { const s = String(t || '').trim(); for (const [re, k] of HEAD_MAP) if (re.test(s)) return k; return ''; };

/** Mail HTML → [{caseNo, vrn, tagId, description, bcName, agentName, agentId}] (ek mail me kai rows ho sakti hain). */
export function parseComplaintTable(html) {
  const rows = [];
  const trs = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  let cols = null;
  for (const tr of trs) {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) => cellText(c.replace(/^<t[dh][^>]*>/i, '').replace(/<\/t[dh]>$/i, '')));
    if (cells.length < 3) continue;
    const keys = cells.map(headKey);
    if (keys.filter(Boolean).length >= 3 && keys.includes('caseNo')) { cols = keys; continue; }
    if (!cols) continue;
    const o = {};
    cols.forEach((k, i) => { if (k && cells[i] !== undefined) o[k] = cells[i]; });
    if (!o.caseNo || !/\d{5,}/.test(o.caseNo)) continue;
    o.caseNo = o.caseNo.replace(/\D/g, '') || o.caseNo;
    rows.push({ caseNo: o.caseNo, vrn: (o.vrn || '').toUpperCase(), tagId: (o.tagId || '').toUpperCase(), description: o.description || '', bcName: o.bcName || '', agentName: o.agentName || '', agentId: String(o.agentId || '').replace(/\.0+$/, '') });
  }
  return rows;
}

/** Plain body ka sirf naya hissa (quoted purani mail hata ke). */
export function freshText(plain) {
  const t = String(plain || '').replace(/\r/g, '');
  const cut = t.search(/^(on .{5,160}wrote:|from:\s.+|-{2,}\s*(original|forwarded)|_{5,}|>.*)$/im);
  return (cut > 0 ? t.slice(0, cut) : t).trim();
}
const addrOf = (from) => { const m = String(from || '').match(/<([^<>]+)>/); return (m ? m[1] : String(from || '')).trim().toLowerCase(); };
const domainOf = (a) => (String(a).split('@')[1] || '').toLowerCase();

/**
 * Thread → complaint rows.
 *   thread: { id, subject, messages: [{ id, from, date(ms), plain, html }] }
 *   me: ['you@gmail.com', ...] — Apps Script account (aur aliases)
 */
export function parseThread(thread, { me = [], cfg = DEFAULT_COMPLAINTS_CFG, now = Date.now() } = {}) {
  const msgs = (thread.messages || []).slice().sort((a, b) => (a.date || 0) - (b.date || 0));
  if (!msgs.length) return [];
  const first = msgs[0];
  const mine = new Set((me || []).map((x) => String(x).toLowerCase()));
  const firstAddr = addrOf(first.from);
  const bankDomain = domainOf(firstAddr);
  const kind = (m) => {
    const a = addrOf(m.from);
    if (mine.has(a)) return 'me';
    if (a === firstAddr || (bankDomain && domainOf(a) === bankDomain)) return 'bank';
    return 'team';
  };
  let table = [];
  for (const m of msgs) { if (m.html) { table = parseComplaintTable(m.html); if (table.length) break; } }
  const subjCase = (String(thread.subject || '').match(/(\d{8,})\s*$/) || [])[1] || '';
  if (!table.length) table = [{ caseNo: subjCase, vrn: '', tagId: '', description: '', bcName: '', agentName: '', agentId: '' }];

  const after = msgs.slice(1);
  const myReply = after.find((m) => kind(m) === 'me');
  const teamReply = after.find((m) => kind(m) === 'team');
  const bankDone = after.find((m) => kind(m) === 'bank' && RESOLVED_RE.test(freshText(m.plain)));
  const bankAny = after.find((m) => kind(m) === 'bank');
  const t = (m) => (m ? m.date || 0 : Infinity);
  const winners = [['me', t(myReply)], ['bank', t(bankDone)], ['team', t(teamReply)]].filter(([, v]) => v !== Infinity).sort((a, b) => a[1] - b[1]);
  const who = winners.length ? winners[0][0] : '';
  const status = who === 'me' ? ownerStatus(cfg.ownerName) : who === 'bank' ? COMPLAINT_STATUS.BANK : who === 'team' ? COMPLAINT_STATUS.TEAM : COMPLAINT_STATUS.PENDING;
  const resolvedAt = winners.length ? winners[0][1] : 0;
  const amt = bankDone ? (freshText(bankDone.plain).match(AMOUNT_RE) || [])[1] : '';
  const deducted = amt ? Number(String(amt).replace(/,/g, '')) : 0;
  const tatDueAt = (first.date || 0) + (Number(cfg.tatHours) || 24) * 3600e3;
  const pending = status === COMPLAINT_STATUS.PENDING;
  return table.map((r) => ({
    key: `${thread.id}:${r.caseNo || subjCase}:${r.tagId || ''}`,
    threadId: thread.id, caseNo: r.caseNo || subjCase, subject: thread.subject || '',
    date: first.date || 0, vrn: r.vrn, tagId: r.tagId, description: r.description, bcName: r.bcName, agentName: r.agentName, agentId: r.agentId,
    status, resolvedAt: resolvedAt || 0, repliedAt: myReply ? myReply.date || 0 : 0, bankRepliedAt: bankAny ? bankAny.date || 0 : 0,
    deducted, bankNote: bankDone ? freshText(bankDone.plain).replace(/\s+/g, ' ').slice(0, 240) : '',
    messages: msgs.length, lastAt: msgs[msgs.length - 1].date || 0,
    tatDueAt, tatBreached: pending && now > tatDueAt, link: `https://mail.google.com/mail/u/0/#all/${thread.id}`
  }));
}

// ---------------------------------------------------------------- service (cache + background refresh)
const istDay = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
const monthStart = (day) => `${day.slice(0, 7)}-01`;

export function createComplaintsService({ getStore, getConfig, lookupAgent, enrichIssuers = null, getMasterIds = () => new Set(), now = () => Date.now(), log = () => {} }) {
  const byThread = new Map();      // threadId → [rows]
  const issuerCache = new Map();   // rowKey → { issuer|null, at } — refresh me thread dobara parse hota hai, lookup dobara na chale
  const st = { enrichErr: '', at: 0, ok: 0, running: null, error: '', coverFrom: '', month: '', sig: '', me: [], threads: 0, lastRun: 0, runs: 0 };
  const cfg = () => normalizeCfg(getConfig());

  async function fetchWindow(from, to) {
    const c = cfg();
    const store = getStore();
    if (!store) throw new Error('Apps Script connect nahi hai (APPS_SCRIPT_URL / SECRET) — Gmail se complaints padhne ke liye zaroori.');
    const query = buildQuery(c.subjects, from, to);
    let n = 0;
    for (let start = 0; start < 1000; start += 100) {
      let out;
      try { out = await store.call('complaints', { query, start, max: 100 }); }
      catch (err) {
        const msg = String((err && err.message) || err);
        if (/unknown action|invalid action|not supported|unauthorized.*action/i.test(msg)) throw new Error('Apps Script me naya Gmail code nahi hai — google-apps-script/Code.gs dobara paste karke Deploy → New version karo (Gmail permission Allow karna).');
        throw err;
      }
      if (!out || !Array.isArray(out.threads)) throw new Error('Apps Script ne complaints data nahi diya — Code.gs update + New version deploy karo.');
      st.me = Array.isArray(out.me) ? out.me : st.me;
      for (const th of out.threads) {
        const rows = parseThread(th, { me: st.me, cfg: c, now: now() });
        for (const r of rows) { const c = issuerCache.get(r.key); if (c) { if (c.issuer) r.issuer = c.issuer; r.issuerTriedAt = c.at; } }
        if (rows.length) byThread.set(th.id, rows); n++;
      }
      if (!out.more) break;
    }
    return n;
  }


  const idKey = (v) => String(v ?? '').replace(/\.0+$/, '').replace(/\s+/g, '').toUpperCase();
  /** Bank mail me agent = APNA PAYMENT (master ID 5845036) hoti hai — asli issue karne wala GV Master se Tag ID / VRN par nikalo. */
  async function enrich() {
    if (!enrichIssuers) return;
    const masters = getMasterIds();
    const todo = [];
    for (const list of byThread.values()) for (const r of list) {
      const needs = !idKey(r.agentId) || masters.has(idKey(r.agentId));
      if (!needs || r.issuer || (r.issuerTriedAt && now() - r.issuerTriedAt < 30 * 60e3)) continue;
      if (!r.tagId && !r.vrn) continue;
      todo.push(r);
    }
    if (!todo.length) return;
    try {
      const found = await enrichIssuers(todo.map((r) => ({ key: r.key, tagId: r.tagId, vrn: r.vrn })));
      for (const r of todo) { const hit = found && found.get(r.key); if (hit) r.issuer = hit; else r.issuerTriedAt = now(); issuerCache.set(r.key, { issuer: hit || null, at: now() }); }
      st.enrichErr = '';
    } catch (err) { st.enrichErr = String((err && err.message) || err).slice(0, 200); for (const r of todo) { r.issuerTriedAt = now(); issuerCache.set(r.key, { issuer: null, at: now() }); } }
  }

  /** Current month (ya jo window do) refresh. full=true → mahine ka poora; warna pichhle 3 din (naye messages). */
  async function sync({ full = false, from = '', to = '' } = {}) {
    if (st.running) return st.running;
    const run = (async () => {
      const today = istDay(now());
      const c = cfg();
      const sig = JSON.stringify([c.subjects, c.ownerName, c.tatHours]);
      if (st.sig !== sig || st.month !== today.slice(0, 7)) { byThread.clear(); issuerCache.clear(); st.coverFrom = ''; full = true; st.sig = sig; st.month = today.slice(0, 7); }
      let f = from, t = to;
      if (!f) {
        const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 3);
        f = full || !st.coverFrom ? monthStart(today) : istDay(d.getTime());
      }
      try {
        const n = await fetchWindow(f, t || '');
        await enrich();
        st.threads = byThread.size; st.error = ''; st.ok = now(); st.at = now();
        if (!from && (!st.coverFrom || f < st.coverFrom)) st.coverFrom = f;
        if (from && (!st.coverFrom || from < st.coverFrom)) st.coverFrom = from;
        log(`complaints sync ${f}${t ? '→' + t : ''}: ${n} threads`);
      } catch (err) { st.error = String((err && err.message) || err).slice(0, 300); st.at = now(); throw err; }
    })().finally(() => { st.running = null; st.lastRun = now(); st.runs++; });
    st.running = run; run.catch(() => {});
    return run;
  }

  async function ensureRange(from) {
    if (!MONTH_RE.test(from || '')) return;
    if (!st.coverFrom) { try { await sync({ full: true }); } catch { /* error state me */ } }
    if (st.coverFrom && from < st.coverFrom) {
      const upto = st.coverFrom;
      await sync({ from: monthStart(from), to: upto });   // purane mahine ka hissa (status abhi ke hisaab se)
    }
  }

  /** Due ho to background refresh (timer har 30s yahi call karta hai). */
  function tick() {
    const c = cfg();
    if (!c.enabled || st.running || !getStore()) return;
    if (st.ok && now() - st.lastRun < c.refreshMin * 60e3) return;
    if (!st.ok && st.lastRun && now() - st.lastRun < Math.min(c.refreshMin, 5) * 60e3) return;   // fail par bhi jaldi-jaldi nahi
    sync({ full: !st.coverFrom }).catch((e) => log(`complaints sync fail: ${String((e && e.message) || e).slice(0, 160)}`));
  }

  function rows({ from = '', to = '' } = {}) {
    const out = [];
    for (const list of byThread.values()) for (const r of list) {
      const d = istDay(r.date);
      if (MONTH_RE.test(from) && d < from) continue;
      if (MONTH_RE.test(to) && d > to) continue;
      out.push(r);
    }
    out.sort((a, b) => b.date - a.date);
    const lookups = new Map();
    return out.map((r) => {
      const iss = r.issuer || null;
      const agentId = iss ? iss.id : r.agentId, agentName = iss ? iss.name : r.agentName;
      const k = `${agentId}|${agentName}`;
      if (!lookups.has(k)) { let v = null; try { v = lookupAgent ? lookupAgent({ agentId, agentName }) : null; } catch { v = null; } lookups.set(k, v || {}); }
      const a = lookups.get(k);
      const tlName = a.tlName || (iss && iss.tlName) || '', tlId = a.tlId || (iss && iss.tlId) || '';
      const { issuer, issuerTriedAt, ...rest } = r; void issuer; void issuerTriedAt;
      return { ...rest, agentId, agentName, ...(iss ? { issuerSrc: 'GV Master', mailAgentId: r.agentId, mailAgentName: r.agentName } : {}), day: istDay(r.date), tlName, tlId, agentFound: !!a.found || !!iss };
    });
  };
  const meta = () => ({ at: st.at ? new Date(st.at).toISOString() : '', okAt: st.ok ? new Date(st.ok).toISOString() : '', running: !!st.running, error: st.error, enrichErr: st.enrichErr, coverFrom: st.coverFrom, threads: byThread.size, config: (({ mail, ...rest }) => rest)(cfg()), account: st.me[0] || '' });
  return { sync, ensureRange, tick, rows, meta, getStore, _state: st, _byThread: byThread };
}
