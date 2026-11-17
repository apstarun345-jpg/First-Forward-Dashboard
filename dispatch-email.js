/* Shared, pure helpers for scheduled Dispatch Planner email reports. */

export const DEFAULT_DISPATCH_EMAIL = Object.freeze({
  enabled: false,
  recipients: '',
  sections: ['summary', 'agents'],
  channel: 'all',
  basis: 'total',
  priority: 'all',
  agentType: 'all',   // v3.125.305 — 'all' | 'direct' (Direct agents, bina TL) | 'tl' (TL-managed)
  maxRows: 250,
  kind: 'daily',
  hour: 9,
  minute: 0,          // v3.125.305 — exact time (HH:MM IST), sirf ghanta nahi
  weekday: 1,
  day: 1
});

const ALLOWED_SECTIONS = new Set(['summary', 'agents', 'tls']);
const ALLOWED_CHANNELS = new Set(['all', 'ff', 'gv']);
const ALLOWED_BASES = new Set(['total', 'vc4', 'comm']);
const ALLOWED_PRIORITIES = new Set(['all', 'High', 'Medium', 'Low', 'other']);
const ALLOWED_KINDS = new Set(['daily', 'weekly', 'monthly']);
const ALLOWED_AGENT_TYPES = new Set(['all', 'direct', 'tl']);
const EMAIL_RE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

/** Multiple-select field → canonical comma string. Array / 'ff+gv' / 'High, Medium' sab chalta hai. */
function multiField(raw, allowed, allValue, message) {
  const parts = (Array.isArray(raw) ? raw : String(raw === null || raw === undefined ? '' : raw).split(/[,+]/))
    .map((x) => String(x).trim()).filter(Boolean);
  const uniq = [...new Set(parts)];
  if (!uniq.length || uniq.includes(allValue)) return allValue;
  const bad = uniq.filter((x) => !allowed.has(x));
  if (bad.length) throw new Error(message);
  return uniq.join(',');
}

/** Canonical comma string → Set of values (khaali/'all' = sab). */
export function multiValues(raw, allValue = 'all') {
  const parts = (Array.isArray(raw) ? raw : String(raw === null || raw === undefined ? '' : raw).split(/[,+]/))
    .map((x) => String(x).trim()).filter(Boolean);
  const uniq = [...new Set(parts)].filter((x) => x !== allValue);
  return new Set(uniq);
}

export function normalizeDispatchEmail(input, base = DEFAULT_DISPATCH_EMAIL) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Dispatch email settings object hona chahiye.');
  const value = { ...DEFAULT_DISPATCH_EMAIL, ...(base || {}), ...input };
  value.enabled = value.enabled === true || value.enabled === 'true';
  value.recipients = String(value.recipients || '').replace(/[\r\n]/g, '').trim().slice(0, 1200);
  const recipients = value.recipients.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (recipients.length > 20) throw new Error('Dispatch email me maximum 20 recipients allowed hain.');
  if (recipients.some((x) => !EMAIL_RE.test(x.replace(/^.*<([^<>]+)>.*$/, '$1')))) throw new Error('Recipients me valid email addresses comma ya semicolon se alag likho.');
  value.sections = [...new Set((Array.isArray(value.sections) ? value.sections : []).filter((x) => ALLOWED_SECTIONS.has(x)))];
  if (!value.sections.length) throw new Error('Email me kam se kam Summary, Agent-wise ya TL-wise data select karo.');
  // 🔠 v3.18 — MULTIPLE SELECTION: channel aur priority ab ek saath kai ho sakte hain
  // ('ff,gv' / 'High,Medium' ya array). Khaali ya 'all' = koi restriction nahi.
  value.channel = multiField(value.channel, ALLOWED_CHANNELS, 'all', 'Channel all, ff ya gv hona chahiye.');
  if (!ALLOWED_BASES.has(value.basis)) throw new Error('Tag basis total, vc4 ya comm hona chahiye.');
  value.priority = multiField(value.priority, ALLOWED_PRIORITIES, 'all', 'Priority filter all, High, Medium, Low ya other hona chahiye.');
  if (!ALLOWED_KINDS.has(value.kind)) throw new Error('Schedule daily, weekly ya monthly hona chahiye.');
  value.agentType = String(value.agentType || 'all');
  if (!ALLOWED_AGENT_TYPES.has(value.agentType)) throw new Error('Agent type all, direct ya tl hona chahiye.');
  // "09:30" jaisa time bhi chalta hai → hour + minute
  if (typeof value.time === 'string' && /^\d{1,2}:\d{2}$/.test(value.time.trim())) { const [hh, mm] = value.time.trim().split(':').map(Number); value.hour = hh; value.minute = mm; }
  delete value.time;
  const integer = (raw, fallback, min, max, label) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} ${min} se ${max} ke beech whole number hona chahiye.`);
    return n;
  };
  value.hour = integer(value.hour, 9, 0, 23, 'Hour');
  value.minute = integer(value.minute === undefined || value.minute === null || value.minute === '' ? 0 : value.minute, 0, 0, 59, 'Minute');
  value.weekday = integer(value.weekday, 1, 0, 6, 'Weekday');
  value.day = integer(value.day, 1, 1, 28, 'Month day');
  value.maxRows = integer(value.maxRows, 250, 1, 500, 'Maximum rows');
  return value;
}

/** Normalize source-sheet priority wording; unknown values (including blank) stay source-authentic. */
export function sourcePriority(raw) {
  const value = String(raw === null || raw === undefined ? '' : raw).trim();
  const text = value.toLowerCase();
  if (/high|urgent|critical/.test(text)) return 'High';
  if (/medium|slight/.test(text)) return 'Medium';
  if (/\blow\b/.test(text)) return 'Low';
  return value;
}

const normName = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const num = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const trio = (r, key) => r[key] || { vc4: 0, comm: 0, total: 0 };
const directTitle = (channel, settings = {}) => {
  const rules = settings.direct || {};
  const fallback = channel === 'gv' ? 'Direct Agent (no TL)' : 'Direct Agent (APS)';
  return String((channel === 'gv' ? rules.labelGv : rules.labelFf) || fallback);
};

const KNOWN_PRIORITIES = new Set(['High', 'Medium', 'Low']);
/** VC4/VC20 (core) ya VC5+ (comm) hissa — Dispatch Planner page (withCalc) jaisa. */
const part = (o, k) => { const tot = Math.max(0, num(o && o.total)), cm = Math.max(0, num(o && o.comm)); return k === 'comm' ? Math.min(cm, tot || cm) : Math.max(0, tot - cm); };
function rateCalc(cur, last, stock, days, elapsed) {
  const rate = cur / elapsed;
  const required = Math.max(0, Math.ceil(rate * days));
  return { cur, last, stock, rate, required, net: Math.max(0, Math.ceil(rate * days - stock)), cover: rate > 0 ? stock / rate : null };
}
/**
 * 🧮 v3.125.306 — page (dispatchPlanner.js withCalc) jaisa hi hisaab, taaki mail aur screen ke numbers same hon:
 *  • Priority stock cover se: cover < coverRed (7) din = High, < coverOrange (15) = Medium, warna Low.
 *    Sheet ka "Priority Level" column (GV REPORT me lagbhag hamesha "Low") sirf `sheetPriority` me rehta hai —
 *    pehle mail usi se filter karta tha, isliye High + Medium chunne par GV ke agents mail se gayab ho jaate the.
 *  • All tags basis par dispatch = VC4/VC20 + VC5+ alag-alag (page ka "Dispatch total").
 */
function calculate(row, basis, days, elapsed, thresholds = {}) {
  const c = rateCalc(num(trio(row, 'cur')[basis]), num(trio(row, 'last')[basis]), num(trio(row, 'stock')[basis]), days, elapsed);
  const gA = rateCalc(part(row.cur, 'core'), part(row.last, 'core'), part(row.stock, 'core'), days, elapsed);
  const gB = rateCalc(part(row.cur, 'comm'), part(row.last, 'comm'), part(row.stock, 'comm'), days, elapsed);
  const redD = num(thresholds.coverRed) || 7, orgD = num(thresholds.coverOrange) || 15;
  const covers = [gA, gB].filter((g) => g.rate > 0 && g.cover !== null && (g !== gB || g.stock > 0)).map((g) => g.cover);
  const coverMin = covers.length ? Math.min(...covers) : c.cover;
  const sheetPriority = row.kind === 'tl' ? String(row.priority || '').trim() : sourcePriority(row.priority);
  let priority = sheetPriority;
  if (c.rate > 0) priority = coverMin === null ? 'Low' : coverMin < redD ? 'High' : coverMin < orgD ? 'Medium' : 'Low';
  else if (!sheetPriority || KNOWN_PRIORITIES.has(sheetPriority)) priority = 'Low';
  const split = basis === 'total';
  const netA = split ? gA.net : (basis === 'vc4' ? c.net : 0), netB = split ? gB.net : (basis === 'comm' ? c.net : 0);
  return {
    ...row,
    mobile: row.mobile || '',
    priority,
    sheetPriority,
    curV: c.cur,
    lastV: c.last,
    stockV: c.stock,
    rate: c.rate,
    required: c.required,
    gross: c.required,
    net: split ? netA + netB : c.net,
    netA,
    netB,
    cover: coverMin,
    growth: c.last > 0 ? ((c.cur - c.last) / c.last) * 100 : null
  };
}

function priorityMatches(row, selected) {
  // 🔠 multiple selection — selected 'High,Medium' jaisa canonical list ho sakta hai; koi bhi match kare to pass.
  // Ek value ke liye behaviour bilkul pehle jaisa hai: TL ka combined "Medium / High" sheet-authentic
  // rehta hai, isliye use 'other' hi maana jaata hai (High ya Medium nahi).
  const chosen = multiValues(selected);
  if (!chosen.size) return true;                                   // 'all' / khaali = koi filter nahi
  const value = String(row.priority || '').trim();   // calculate() ke baad: cover-based (page jaisa)
  return [...chosen].some((c) => (c === 'other' ? !KNOWN_PRIORITIES.has(value) : value === c));
}

/** Calculate the same run-rate / required / stock-subtraction figures used by Dispatch Planner. */
export function buildDispatchPlan(sourceAgents, schedule, options = {}) {
  const cfg = schedule || DEFAULT_DISPATCH_EMAIL;
  const settings = options.settings || {};
  const now = options.now instanceof Date ? options.now : new Date();
  const days = Math.max(1, Number(options.days) || 15);
  // 📐 v3.31 — run-rate ÷ (aaj − 1) jaisa sheet karti hai, par DATE ke hisaab se: 1 tareekh ko (aaj − 1) =
  // pichhle month ka aakhri din (30 Sep → 30 din), 1 nahi. Server EIR overlay har channel ka asli data month
  // + din `options.elapsed = { ff, gv }` me bhejta hai; na mile to (now − 1 din).getDate().
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)); // now is shifted to IST by the caller
  const fallback = Math.max(1, yesterday.getUTCDate());
  const given = options.elapsed;
  const elapsedOf = (ch) => {
    if (given && typeof given === 'object' && Number(given[ch]) > 0) return Number(given[ch]);
    if (Number(given) > 0) return Number(given);
    return fallback;
  };
  const elapsedFf = elapsedOf('ff'), elapsedGv = elapsedOf('gv');
  const elapsed = elapsedFf === elapsedGv ? elapsedFf : { ff: elapsedFf, gv: elapsedGv };
  const chosenChannel = cfg.channel || 'all';
  const channels = multiValues(chosenChannel);
  // 🧑 v3.125.305 — agent type: 'direct' = sirf Direct agents (bina TL), 'tl' = sirf TL-managed
  const agentType = cfg.agentType || 'all';
  const typeOk = (r) => agentType === 'all' || (agentType === 'direct' ? !!r.direct : !r.direct);
  const channelOk = (r) => (!channels.size || channels.has(r.ch)) && typeOk(r);
  const basis = cfg.basis || 'total';
  const agents = (sourceAgents || []).filter(channelOk)
    .map((r) => calculate(r, basis, days, elapsedOf(r.ch), settings.thresholds || {}))
    .filter((r) => priorityMatches(r, cfg.priority || 'all'));

  const groups = new Map();
  for (const agent of (sourceAgents || []).filter(channelOk)) {
    const key = agent.direct ? `${agent.ch}|__direct__` : `${agent.ch}|${normName(agent.tl) || '__unmapped__'}`;
    if (!groups.has(key)) groups.set(key, { ch: agent.ch, direct: !!agent.direct, name: agent.direct ? agent.directLabel || directTitle(agent.ch, settings) : (agent.tl || 'Unmapped (TL blank)'), members: [] });
    groups.get(key).members.push(agent);
  }
  const tls = [];
  for (const group of groups.values()) {
    const members = group.members;
    const sum = (key) => members.reduce((n, r) => n + num(trio(r, key)[basis]), 0);
    const sourceStock = !group.direct ? members.find((r) => r.tlStock) : null;
    const sourcePriorities = group.direct ? [] : [...new Set(members.map((r) => sourcePriority(r.tlPriority)).filter(Boolean))];
    const priority = sourcePriorities.length === 1 ? sourcePriorities[0] : sourcePriorities.join(' / ');
    const tlRow = {
      kind: 'tl', ch: group.ch, name: group.name,
      id: (members.find((r) => r.tlId) || {}).tlId || '',
      tl: group.direct ? '' : group.name,
      direct: group.direct,
      directLabel: group.direct ? group.name : '',
      priority,
      status: '',
      agents: members.length,
      cur: { vc4: sum('cur'), comm: sum('cur'), total: sum('cur') },
      last: { vc4: sum('last'), comm: sum('last'), total: sum('last') },
      stock: sourceStock ? sourceStock.tlStock : { vc4: sum('stock'), comm: sum('stock'), total: sum('stock') },
      tlPriority: priority
    };
    // For VC4 and Commercial TL exports, preserve the component sums; source TL stock overrides totals
    // just as it does in collectTls() when the sheet provides a TL stock field.
    const components = (key) => ({
      vc4: members.reduce((n, r) => n + num(trio(r, key).vc4), 0),
      comm: members.reduce((n, r) => n + num(trio(r, key).comm), 0),
      total: members.reduce((n, r) => n + num(trio(r, key).total), 0)
    });
    tlRow.cur = components('cur');
    tlRow.last = components('last');
    if (sourceStock) tlRow.stock = sourceStock.tlStock;
    else tlRow.stock = components('stock');
    const calc = calculate(tlRow, basis, days, elapsedOf(group.ch), settings.thresholds || {});
    if (priorityMatches(calc, cfg.priority || 'all')) tls.push(calc);
  }

  const sum = (list, key) => list.reduce((n, r) => n + num(r[key]), 0);
  const summary = {
    agents: agents.length,
    tls: tls.length,
    current: sum(agents, 'curV'),
    last: sum(agents, 'lastV'),
    stock: sum(agents, 'stockV'),
    rate: sum(agents, 'rate'),
    required: sum(agents, 'required'),
    net: sum(agents, 'net'),
    gross: sum(agents, 'gross'),
    high: agents.filter((r) => r.priority === 'High').length,
    medium: agents.filter((r) => r.priority === 'Medium').length,
    low: agents.filter((r) => r.priority === 'Low').length,
    source: agents.filter((r) => !['High', 'Medium', 'Low'].includes(r.priority)).length,
    ff: agents.filter((r) => r.ch === 'ff').length,
    gv: agents.filter((r) => r.ch === 'gv').length
  };
  const sort = (a, b) => b.net - a.net || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  agents.sort(sort); tls.sort(sort);
  const cap = Math.max(1, Number(cfg.maxRows) || 250);
  return { agents: agents.slice(0, cap), tls: tls.slice(0, cap), summary, days, elapsed, months: options.months || null, basis, channel: chosenChannel, priority: cfg.priority || 'all', agentType };
}

const csvCell = (value) => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
function csvFor(rows) {
  const header = ['Name', 'ID', 'Mobile', 'Channel', 'Type', 'Team leader', 'Priority (stock cover)', 'Sheet priority', 'Last month', 'This month', 'Run-rate / day', 'Required', 'Stock', 'Dispatch WITH stock', 'Dispatch VC4/VC20', 'Dispatch VC5+', 'Dispatch W/O stock', 'Cover days', 'Status'];
  const body = rows.map((r) => [
    r.name, r.id, r.kind === 'tl' ? '' : (r.mobile || ''), r.ch === 'gv' ? 'GV Partner' : 'First Forward', r.direct ? 'Direct' : 'TL-managed',
    r.kind === 'tl' ? (r.direct ? r.directLabel : r.name) : (r.direct ? r.directLabel : r.tl),
    r.priority, r.sheetPriority === r.priority ? '' : (r.sheetPriority || ''), r.lastV, r.curV, Number(r.rate.toFixed(2)), r.required, r.stockV, r.net, r.netA, r.netB, r.gross,
    r.cover === null ? '' : Number(r.cover.toFixed(1)), r.status
  ]);
  return [header, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function htmlEscape(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** "28" ya "FF 30 (2026-09) · GV 1 (2026-10)" — per-channel divisor readable text. */
function elapsedText(plan) {
  const e = plan.elapsed;
  const m = plan.months || {};
  if (e && typeof e === 'object') return ['ff', 'gv'].filter((c) => e[c]).map((c) => `${c === 'gv' ? 'GV' : 'FF'} ${e[c]}${m[c] ? ` (${m[c]})` : ''}`).join(' · ');
  const months = [...new Set(Object.values(m).filter(Boolean))];
  return `${e}${months.length === 1 ? ` (${months[0]})` : ''}`;
}

export function dispatchEmailContent(plan, schedule, brand = 'Dashboard', date = '') {
  const chosen = new Set(schedule.sections || []);
  const s = plan.summary;
  // 🔠 multiple selection — "ff,gv" jaisa canonical value readable label ban jaata hai.
  const CH_NAME = { ff: 'First Forward', gv: 'GV Partner' };
  const chSet = multiValues(plan.channel);
  const channel = !chSet.size || chSet.size > 1 ? 'First Forward + GV Partner' : (CH_NAME[[...chSet][0]] || 'First Forward');
  const basis = plan.basis === 'vc4' ? 'VC4' : plan.basis === 'comm' ? 'Commercial' : 'All tags';
  const prSet = multiValues(plan.priority);
  const priority = !prSet.size ? 'All source priorities'
    : [...prSet].map((p) => (p === 'other' ? 'Other / source value' : `${p} priority`)).join(' + ');
  const typeLabel = plan.agentType === 'direct' ? 'Direct agents (no TL)' : plan.agentType === 'tl' ? 'TL-managed agents' : '';
  const subject = `Dispatch Planner · ${date}${chSet.size === 1 ? ` · ${channel}` : ''}${typeLabel ? ` · ${typeLabel}` : ''}`;
  const text = [
    `${brand} · Dispatch Planner · ${date}`,
    `${channel} · ${basis} · ${priority}${typeLabel ? ` · ${typeLabel}` : ''}`,
    `Run-rate uses ${elapsedText(plan)} elapsed day(s) — issuance ÷ (today − 1); required horizon ${plan.days} day(s).`,
    chosen.has('summary') ? `Summary: ${s.agents} agents (First Forward ${s.ff} · GV Partner ${s.gv}) · current ${s.current} · last month ${s.last} · run-rate ${s.rate.toFixed(2)}/day · required ${s.required} · stock ${s.stock} · dispatch with stock ${s.net} · without subtracting stock ${s.gross}.` : '',
    chosen.has('summary') ? `Priority (stock cover, same as Dispatch Planner page): High ${s.high} · Medium ${s.medium} · Low ${s.low}${s.source ? ` · Other ${s.source}` : ''}.` : '',
    chosen.has('agents') ? `Agent-wise CSV: ${plan.agents.length} row(s) attached (maximum ${schedule.maxRows}).` : '',
    chosen.has('tls') ? `TL-wise CSV: ${plan.tls.length} row(s) attached (maximum ${schedule.maxRows}).` : '',
    '',
    'Priority = stock cover (stock ÷ run-rate): under 7 days High, under 15 days Medium, otherwise Low — same as the Dispatch Planner page. CSV includes agent mobile numbers.'
  ].filter(Boolean).join('\n');
  const attachments = [];
  if (chosen.has('agents')) attachments.push({ name: `dispatch-agents-${date}.csv`, content: csvFor(plan.agents), type: 'text/csv' });
  if (chosen.has('tls')) attachments.push({ name: `dispatch-tl-summary-${date}.csv`, content: csvFor(plan.tls), type: 'text/csv' });
  const summaryHtml = chosen.has('summary') ? `<table cellpadding="7" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px"><tbody>${[
    ['Agents', s.agents], ['First Forward agents', s.ff], ['GV Partner agents', s.gv], ['Current', s.current], ['Last month', s.last], ['Run-rate / day', s.rate.toFixed(2)], ['Required', s.required], ['Stock', s.stock], ['Dispatch with stock', s.net], ['Dispatch without subtracting stock', s.gross], ['High priority (cover)', s.high], ['Medium priority (cover)', s.medium], ['Low priority (cover)', s.low], ['Other', s.source]
  ].map(([k, v]) => `<tr><th align="left">${htmlEscape(k)}</th><td>${htmlEscape(v)}</td></tr>`).join('')}</tbody></table>` : '<p>See attached dispatch data.</p>';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a"><h2>${htmlEscape(brand)} · Dispatch Planner · ${htmlEscape(date)}</h2><p>${htmlEscape(channel)} · ${htmlEscape(basis)} · ${htmlEscape(priority)}${typeLabel ? ` · ${htmlEscape(typeLabel)}` : ''}</p><p>Run-rate = issuance ÷ ${htmlEscape(elapsedText(plan))} elapsed day(s) (today − 1) · Required horizon = ${plan.days} day(s).</p>${summaryHtml}<p style="color:#64748b;font-size:12px">Priority = stock cover (stock ÷ run-rate) — same as the Dispatch Planner page. Agent mobile numbers are in the CSV.</p></div>`;
  return { subject, text, html, attachments };
}
