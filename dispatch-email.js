/* Shared, pure helpers for scheduled Dispatch Planner email reports. */

export const DEFAULT_DISPATCH_EMAIL = Object.freeze({
  enabled: false,
  recipients: '',
  sections: ['summary', 'agents'],
  channel: 'all',
  basis: 'total',
  priority: 'all',
  maxRows: 250,
  kind: 'daily',
  hour: 9,
  weekday: 1,
  day: 1
});

const ALLOWED_SECTIONS = new Set(['summary', 'agents', 'tls']);
const ALLOWED_CHANNELS = new Set(['all', 'ff', 'gv']);
const ALLOWED_BASES = new Set(['total', 'vc4', 'comm']);
const ALLOWED_PRIORITIES = new Set(['all', 'High', 'Medium', 'Low', 'other']);
const ALLOWED_KINDS = new Set(['daily', 'weekly', 'monthly']);
const EMAIL_RE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

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
  if (!ALLOWED_CHANNELS.has(value.channel)) throw new Error('Channel all, ff ya gv hona chahiye.');
  if (!ALLOWED_BASES.has(value.basis)) throw new Error('Tag basis total, vc4 ya comm hona chahiye.');
  if (!ALLOWED_PRIORITIES.has(value.priority)) throw new Error('Priority filter all, High, Medium, Low ya other hona chahiye.');
  if (!ALLOWED_KINDS.has(value.kind)) throw new Error('Schedule daily, weekly ya monthly hona chahiye.');
  const integer = (raw, fallback, min, max, label) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} ${min} se ${max} ke beech whole number hona chahiye.`);
    return n;
  };
  value.hour = integer(value.hour, 9, 0, 23, 'Hour');
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

function calculate(row, basis, days, elapsed) {
  const cur = num(trio(row, 'cur')[basis]);
  const last = num(trio(row, 'last')[basis]);
  const stock = num(trio(row, 'stock')[basis]);
  const rate = cur / elapsed;
  const required = Math.max(0, Math.ceil(rate * days));
  return {
    ...row,
    priority: sourcePriority(row.priority),
    curV: cur,
    lastV: last,
    stockV: stock,
    rate,
    required,
    gross: required,
    net: Math.max(0, Math.ceil(rate * days - stock)),
    cover: rate > 0 ? stock / rate : null,
    growth: last > 0 ? ((cur - last) / last) * 100 : null
  };
}

function priorityMatches(row, selected) {
  if (selected === 'all') return true;
  const value = row.kind === 'tl' ? String(row.priority || '').trim() : sourcePriority(row.priority);
  if (selected === 'other') return !['High', 'Medium', 'Low'].includes(value);
  return value === selected;
}

/** Calculate the same run-rate / required / stock-subtraction figures used by Dispatch Planner. */
export function buildDispatchPlan(sourceAgents, schedule, options = {}) {
  const cfg = schedule || DEFAULT_DISPATCH_EMAIL;
  const settings = options.settings || {};
  const now = options.now instanceof Date ? options.now : new Date();
  const days = Math.max(1, Number(options.days) || 15);
  const elapsed = Math.max(1, now.getUTCDate() - 1); // now is shifted to IST by the caller
  const chosenChannel = cfg.channel || 'all';
  const basis = cfg.basis || 'total';
  const agents = (sourceAgents || []).filter((r) => chosenChannel === 'all' || r.ch === chosenChannel)
    .map((r) => calculate(r, basis, days, elapsed))
    .filter((r) => priorityMatches(r, cfg.priority || 'all'));

  const groups = new Map();
  for (const agent of (sourceAgents || []).filter((r) => chosenChannel === 'all' || r.ch === chosenChannel)) {
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
    const calc = calculate(tlRow, basis, days, elapsed);
    calc.priority = priority; // TL priority is the sheet TL value; keep a combined "High / Medium" unchanged.
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
    source: agents.filter((r) => !['High', 'Medium', 'Low'].includes(r.priority)).length
  };
  const sort = (a, b) => b.net - a.net || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  agents.sort(sort); tls.sort(sort);
  const cap = Math.max(1, Number(cfg.maxRows) || 250);
  return { agents: agents.slice(0, cap), tls: tls.slice(0, cap), summary, days, elapsed, basis, channel: chosenChannel, priority: cfg.priority || 'all' };
}

const csvCell = (value) => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
function csvFor(rows) {
  const header = ['Name', 'ID', 'Channel', 'Type', 'Team leader', 'Priority (source sheet)', 'Last month', 'This month', 'Run-rate / day', 'Required', 'Stock', 'Dispatch WITH stock', 'Dispatch W/O stock', 'Cover days', 'Status'];
  const body = rows.map((r) => [
    r.name, r.id, r.ch === 'gv' ? 'GV Partner' : 'First Forward', r.direct ? 'Direct' : 'TL-managed',
    r.kind === 'tl' ? (r.direct ? r.directLabel : r.name) : (r.direct ? r.directLabel : r.tl),
    r.priority, r.lastV, r.curV, Number(r.rate.toFixed(2)), r.required, r.stockV, r.net, r.gross,
    r.cover === null ? '' : Number(r.cover.toFixed(1)), r.status
  ]);
  return [header, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function htmlEscape(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function dispatchEmailContent(plan, schedule, brand = 'Dashboard', date = '') {
  const chosen = new Set(schedule.sections || []);
  const s = plan.summary;
  const channel = plan.channel === 'all' ? 'First Forward + GV Partner' : plan.channel === 'gv' ? 'GV Partner' : 'First Forward';
  const basis = plan.basis === 'vc4' ? 'VC4' : plan.basis === 'comm' ? 'Commercial' : 'All tags';
  const priority = plan.priority === 'all' ? 'All source priorities' : plan.priority === 'other' ? 'Other / source value' : `${plan.priority} priority`;
  const subject = `Dispatch Planner · ${date}${plan.channel !== 'all' ? ` · ${channel}` : ''}`;
  const text = [
    `${brand} · Dispatch Planner · ${date}`,
    `${channel} · ${basis} · ${priority}`,
    `Run-rate uses ${plan.elapsed} elapsed day(s); required horizon ${plan.days} day(s).`,
    chosen.has('summary') ? `Summary: ${s.agents} agents · current ${s.current} · last month ${s.last} · run-rate ${s.rate.toFixed(2)}/day · required ${s.required} · stock ${s.stock} · dispatch with stock ${s.net} · without subtracting stock ${s.gross}.` : '',
    chosen.has('summary') ? `Source priority rows: High ${s.high} · Medium ${s.medium} · Low ${s.low} · Other / unchanged source value ${s.source}.` : '',
    chosen.has('agents') ? `Agent-wise CSV: ${plan.agents.length} row(s) attached (maximum ${schedule.maxRows}).` : '',
    chosen.has('tls') ? `TL-wise CSV: ${plan.tls.length} row(s) attached (maximum ${schedule.maxRows}).` : '',
    '',
    'Priority values are taken from the source reports. Unknown / blank source values are not reclassified.'
  ].filter(Boolean).join('\n');
  const attachments = [];
  if (chosen.has('agents')) attachments.push({ name: `dispatch-agents-${date}.csv`, content: csvFor(plan.agents), type: 'text/csv' });
  if (chosen.has('tls')) attachments.push({ name: `dispatch-tl-summary-${date}.csv`, content: csvFor(plan.tls), type: 'text/csv' });
  const summaryHtml = chosen.has('summary') ? `<table cellpadding="7" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px"><tbody>${[
    ['Agents', s.agents], ['Current', s.current], ['Last month', s.last], ['Run-rate / day', s.rate.toFixed(2)], ['Required', s.required], ['Stock', s.stock], ['Dispatch with stock', s.net], ['Dispatch without subtracting stock', s.gross], ['High priority (source)', s.high], ['Medium priority (source)', s.medium], ['Low priority (source)', s.low], ['Other / source value', s.source]
  ].map(([k, v]) => `<tr><th align="left">${htmlEscape(k)}</th><td>${htmlEscape(v)}</td></tr>`).join('')}</tbody></table>` : '<p>See attached dispatch data.</p>';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a"><h2>${htmlEscape(brand)} · Dispatch Planner · ${htmlEscape(date)}</h2><p>${htmlEscape(channel)} · ${htmlEscape(basis)} · ${htmlEscape(priority)}</p><p>Run-rate = issuance ÷ ${plan.elapsed} elapsed day(s) · Required horizon = ${plan.days} day(s).</p>${summaryHtml}<p style="color:#64748b;font-size:12px">Priority values are from the source reports. Unknown / blank values were left unchanged.</p></div>`;
  return { subject, text, html, attachments };
}
