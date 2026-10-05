/* Parse the two dispatch report Gviz tables into the common rows consumed by dispatch-email.js. */

const SOURCE_TL_PLACEHOLDERS = ['DIRECT', 'DIRECT AGENT', 'DIRECTS', 'NO TL', 'NO TL ASSIGNED', 'NO SUPERVISOR', 'UNASSIGNED', 'NOT ASSIGNED', 'N/A', 'NA', '-', '--', '—'];
const norm = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

function textCell(row, index) {
  const cell = row && row.c && row.c[index];
  if (!cell) return '';
  return String(cell.f !== undefined && cell.f !== null ? cell.f : cell.v === null || cell.v === undefined ? '' : cell.v).trim();
}
function numberCell(row, index) {
  const cell = row && row.c && row.c[index];
  if (!cell) return 0;
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return cell.v;
  const raw = cell.v === null || cell.v === undefined ? cell.f : cell.v;
  const match = String(raw === undefined || raw === null ? '' : raw).replace(/,/g, '').match(/[-+]?(?:\d+\.?\d*|\.\d+)/);
  return match ? Number(match[0]) || 0 : 0;
}
function isDirect(agent, channel, settings = {}) {
  if (agent.directAgent === true || agent.tlExcluded === true || agent.isDirect === true) return true;
  const rules = settings.direct || {};
  if (rules.enabled === false) return false;
  const tl = String(agent.tlName || agent.tl || '').trim();
  const tlId = String(agent.tlId || agent.supervisorId || '').trim();
  const placeholders = new Set([
    ...SOURCE_TL_PLACEHOLDERS,
    ...(Array.isArray(settings.excludeTls) ? settings.excludeTls : ['APS']),
    ...(Array.isArray(rules.ffTlNames) ? rules.ffTlNames : []),
    ...(Array.isArray(settings.directPlaceholderTls) ? settings.directPlaceholderTls : [])
  ].map(norm));
  const excludedTl = (name) => !String(name || '').trim() || placeholders.has(norm(name));
  const selfSupervised = rules.gvSelfSupervised !== false && (
    (tl && norm(tl) === norm(agent.agentName || agent.name))
    || (tlId && norm(tlId) === norm(agent.agentId || agent.id))
  );
  if (channel === 'gv') {
    return (rules.gvNoTl !== false && !tl && !tlId) || (tl && excludedTl(tl)) || !!selfSupervised;
  }
  return (tl && excludedTl(tl)) || (!tl && !tlId) || !!selfSupervised;
}
function directLabel(channel, settings = {}) {
  const rules = settings.direct || {};
  return String((channel === 'gv' ? rules.labelGv : rules.labelFf) || (channel === 'gv' ? 'Direct Agent (no TL)' : 'Direct Agent (APS)'));
}
function sectionStart(headerRow, pattern, fallback, occurrence = 0) {
  const matches = [];
  (headerRow || []).forEach((cell, i) => { if (pattern.test(String(cell || ''))) matches.push(i); });
  return matches[occurrence] === undefined ? fallback : matches[occurrence];
}
const matrixCell = (row, i) => row && row[i] ? String(row[i].f !== undefined && row[i].f !== null ? row[i].f : row[i].v === null || row[i].v === undefined ? '' : row[i].v).trim() : '';

/** FF REPORT has section titles in row 1 and sub-headings in row 2. Support both raw rows and Gviz-parsed headers. */
export function loadFfDispatchRows(table, settings = {}) {
  const labels = (table.cols || []).map((c) => String(c.label || c.id || '').trim());
  const sourceRows = table.rows || [];
  const width = Math.max(labels.length, ...sourceRows.map((r) => (r.c || []).length), 80);
  const grid = sourceRows.map((r) => Array.from({ length: width }, (_, i) => matrixCell(r.c || [], i)));
  const addLabels = labels.some((x) => /agent profile/i.test(x)) || Number(table.parsedNumHeaders) > 0;
  if (addLabels) grid.unshift(Array.from({ length: width }, (_, i) => labels[i] || ''));
  const headerIndex = grid.findIndex((row, i) => i < 8 && row.some((cell) => /agent profile/i.test(String(cell || ''))));
  if (headerIndex < 0) throw new Error('FF REPORT ka Agent Profile header nahi mila; scheduled dispatch email nahi bana.');
  const header = grid[headerIndex];
  const c = {
    agentId: sectionStart(header, /agent profile/i, 0, 0),
    tl: sectionStart(header, /tl\'?s master data/i, 3, 0),
    stock: sectionStart(header, /agent inventory summary/i, 7, 0),
    dispatch: sectionStart(header, /dispatch details\s*\(vc4\)/i, 15, 0),
    tlStock: sectionStart(header, /tl\'?s stock details/i, 19, 0),
    last: sectionStart(header, /performance in\s*-/i, 22, 0),
    current: sectionStart(header, /performance in\s*-/i, 26, 1),
    status: sectionStart(header, /agents? performance status/i, 40, 0),
    agentWise: sectionStart(header, /^agent wise/i, 65, 0)
  };
  // The second report row contains labels like "Agent ID" / "Name"; skip those by content
  // instead of relying on a fixed offset, since Gviz may include row 1 in cols or rows.
  const rows = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const display = grid[i];
    const rawIndex = i - (addLabels ? 1 : 0);
    const raw = sourceRows[rawIndex];
    if (!raw) continue;
    const text = (index) => display[index] || '';
    const agentId = text(c.agentId), name = text(c.agentId + 2) || text(c.agentId + 1) || agentId;
    if (!agentId && !name || /^(agent[_\s-]*id|agent profile details)$/i.test(agentId) || /^(grand\s*)?total$/i.test(name)) continue;
    const tlId = text(c.tl + 1), rawTl = text(c.tl + 3);
    const tlName = rawTl || (tlId ? `TL ${tlId}` : '');
    // FF's report includes a channel/master aggregate with its own issuance; the browser excludes it.
    if (agentId && norm(agentId) === norm(tlId) && /apna\s*paye?ment/i.test(name)) continue;
    const numeric = (index) => numberCell(raw, index);
    const row = {
      ch: 'ff', kind: 'agent', agentId, id: agentId, name, agentName: name,
      tlId, tl: tlName, tlName,
      priority: text(c.agentWise + 2), tlPriority: text(c.dispatch + 2),
      status: text(c.status + 2),
      cur: { vc4: numeric(c.current + 2), comm: numeric(c.current + 8), total: numeric(c.current + 9) },
      last: { vc4: numeric(c.last + 1), comm: numeric(c.last + 2), total: numeric(c.last + 3) },
      stock: { vc4: numeric(c.stock), comm: numeric(c.stock + 7), total: numeric(c.stock + 6) },
      tlStock: { vc4: numeric(c.tlStock), comm: numeric(c.tlStock + 1), total: numeric(c.tlStock + 2) }
    };
    row.direct = isDirect(row, 'ff', settings);
    row.directLabel = row.direct ? directLabel('ff', settings) : '';
    rows.push(row);
  }
  return rows;
}

/** GV REPORT starts at A4; range loading already removes its header row, leaving A as column zero. */
export function loadGvDispatchRows(table, settings = {}) {
  const rows = [];
  for (const raw of table.rows || []) {
    const text = (i) => textCell(raw, i);
    const numeric = (i) => numberCell(raw, i);
    const agentId = text(1), name = text(2) || agentId;
    if (!agentId || /^AGENT_ID$/i.test(agentId) || !name) continue;
    const tlId = text(3) || text(51), rawTl = text(4);
    const tlName = rawTl || (tlId ? `TL ${tlId}` : '');
    const row = {
      ch: 'gv', kind: 'agent', agentId, id: agentId, name, agentName: name,
      tlId, tl: tlName, tlName,
      priority: text(15), tlPriority: '', status: text(24),
      cur: { vc4: numeric(30), comm: numeric(36), total: numeric(37) },
      last: { vc4: numeric(20), comm: numeric(21), total: numeric(22) },
      stock: { vc4: numeric(7), comm: numeric(12), total: numeric(11) },
      tlStock: { vc4: numeric(16), comm: numeric(17), total: numeric(18) }
    };
    row.direct = isDirect(row, 'gv', settings);
    row.directLabel = row.direct ? directLabel('gv', settings) : '';
    rows.push(row);
  }
  return rows;
}
