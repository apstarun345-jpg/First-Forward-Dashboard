/* 📨 Agents Complaints Summary — bank POS-complaint mails (Gmail) → colourful table with status.
   Server keeps the current month fresh in the background (Settings → Agents Complaints → refresh minutes), so this page
   just reads the ready cache: GET /api/complaints?from&to. Older months are fetched from Gmail on demand.
   Status: Pending · Solved by <you> (you replied) · Solved by Bank (bank debited / refunded / closed) · Solved by Team. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const ymd = (d) => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 10); };
  const today = () => ymd(new Date());
  const monthStart = (d) => `${String(d).slice(0, 7)}-01`;
  const state = {
    root: null, data: null, busy: false, err: '', tab: 'list',
    from: '', to: '', status: 'all', tl: '', agent: '', q: '', sort: 'date', dir: -1, timer: null, req: 0, setOpen: false, draft: null, setMsg: ''
  };
  state.from = monthStart(today()); state.to = today();

  const STATUS_CLS = (s) => (/^pending/i.test(s) ? 'pend' : /bank/i.test(s) ? 'bank' : /team/i.test(s) ? 'team' : 'me');
  const rupee = (n) => (n ? `₹${U.fmt(n)}` : '—');
  const when = (ms) => { if (!ms) return '—'; try { return new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return '—'; } };
  const dayLabel = (iso) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; } };
  const ageText = (r) => {
    const end = r.status === 'Pending' ? Date.now() : (r.resolvedAt || Date.now());
    const h = Math.max(0, Math.round((end - r.date) / 3600e3));
    return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
  };
  const rowsAll = () => (state.data && state.data.rows) || [];
  const statuses = () => [...new Set(rowsAll().map((r) => r.status))];

  function visible() {
    const q = state.q.trim().toLowerCase();
    let rows = rowsAll().filter((r) => {
      if (state.status === 'tat') { if (!r.tatBreached) return false; } else if (state.status !== 'all' && r.status !== state.status) return false;
      if (state.tl && (r.tlName || '— not found —') !== state.tl) return false;
      if (state.agent && `${r.agentName}|${r.agentId}` !== state.agent) return false;
      if (q && ![r.caseNo, r.vrn, r.tagId, r.description, r.bcName, r.agentName, r.agentId, r.tlName, r.tlId, r.status].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const key = state.sort, dir = state.dir;
    rows = rows.slice().sort((a, b) => {
      const x = a[key], y = b[key];
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x || '').localeCompare(String(y || ''), 'en', { numeric: true });
      return c * dir || b.date - a.date;
    });
    return rows;
  }

  function kpis(rows) {
    const by = {}; rows.forEach((r) => { by[r.status] = (by[r.status] || 0) + 1; });
    const ded = rows.reduce((t, r) => t + (r.deducted || 0), 0);
    const tat = rows.filter((r) => r.tatBreached).length;
    return { total: rows.length, by, ded, tat };
  }

  function tilesHtml() {
    const all = rowsAll(), k = kpis(all);
    const owner = (state.data && state.data.meta && state.data.meta.config && state.data.meta.config.ownerName) || 'Tarun';
    const tile = (cls, label, val, key, sub) => `<button type="button" class="cmp-tile cmp-${cls}${state.status === key ? ' on' : ''}" data-cmp-status="${esc(key)}"><span>${esc(label)}</span><b>${val}</b>${sub ? `<em>${sub}</em>` : ''}</button>`;
    return `<div class="cmp-tiles">
      ${tile('all', 'All complaints', U.fmt(k.total), 'all', `${dayLabel(state.from)} → ${dayLabel(state.to)}`)}
      ${tile('pend', 'Pending', U.fmt(k.by['Pending'] || 0), 'Pending', 'no reply · bank not closed')}
      ${tile('me', `Solved by ${esc(owner)}`, U.fmt(k.by[`Solved by ${owner}`] || 0), `Solved by ${owner}`, 'you replied')}
      ${tile('bank', 'Solved by Bank', U.fmt(k.by['Solved by Bank'] || 0), 'Solved by Bank', k.ded ? `deducted ${rupee(k.ded)}` : 'bank closed / refunded')}
      ${k.by['Solved by Team'] ? tile('team', 'Solved by Team', U.fmt(k.by['Solved by Team']), 'Solved by Team', 'teammate replied') : ''}
      ${tile('tat', 'TAT breached', U.fmt(k.tat), 'tat', 'pending past TAT')}
    </div>`;
  }

  function filtersHtml() {
    const rows = rowsAll();
    const tls = [...new Set(rows.map((r) => r.tlName || '— not found —'))].sort((a, b) => a.localeCompare(b));
    const agents = [...new Map(rows.map((r) => [`${r.agentName}|${r.agentId}`, r])).values()].sort((a, b) => String(a.agentName).localeCompare(String(b.agentName)));
    const chip = (id, label) => `<button type="button" class="chip" data-cmp-quick="${id}">${label}</button>`;
    return `<div class="cmp-filters card"><div class="card-body">
      <div class="cmp-frow">
        <label>📅 From <input type="date" class="input" data-cmp-from value="${esc(state.from)}" max="${today()}"></label>
        <label>To <input type="date" class="input" data-cmp-to value="${esc(state.to)}" max="${today()}"></label>
        <div class="cmp-quick">${chip('today', 'Today')}${chip('7d', 'Last 7 days')}${chip('month', 'This month')}${chip('last', 'Last month')}${chip('90d', 'Last 90 days')}</div>
      </div>
      <div class="cmp-frow">
        <label>Status <select class="input" data-cmp-statussel><option value="all">All</option>${statuses().map((s) => `<option value="${esc(s)}"${state.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}<option value="tat"${state.status === 'tat' ? ' selected' : ''}>TAT breached</option></select></label>
        <label>TL <select class="input" data-cmp-tl><option value="">All TLs</option>${tls.map((t) => `<option value="${esc(t)}"${state.tl === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Agent <select class="input" data-cmp-agent><option value="">All agents</option>${agents.map((a) => `<option value="${esc(`${a.agentName}|${a.agentId}`)}"${state.agent === `${a.agentName}|${a.agentId}` ? ' selected' : ''}>${esc(a.agentName || '—')} · ${esc(a.agentId || '—')}</option>`).join('')}</select></label>
        <label class="cmp-search">Search <input class="input" data-cmp-q placeholder="Case · VRN · Tag · agent · TL · description" value="${esc(state.q)}"></label>
        <button type="button" class="btn small" data-cmp-clear>✖ Clear</button>
      </div></div></div>`;
  }

  const TH = [['date', 'Date'], ['caseNo', 'Case Number'], ['vrn', 'Vehicle Registration Number'], ['tagId', 'Tag Id'], ['description', 'Description'], ['bcName', 'BC Name'], ['agentName', 'Agent Name'], ['agentId', 'Agent ID'], ['tlName', 'TL Name'], ['tlId', 'TL ID'], ['status', 'Status'], ['deducted', 'Deducted'], ['date', 'Age'], ['', 'Mail']];
  function listHtml(rows) {
    if (!rows.length) return '<div class="empty">No complaints found for these filters.</div>';
    const showMail = !!logOf();
    const head = TH.filter(([k]) => k || showMail).map(([k, l], i) => `<th class="cmp-th${state.sort === k && i < 12 ? ' on' : ''}" ${k ? `data-cmp-sort="${k}" title="Sort"` : ''}>${l}${state.sort === k && i < 12 ? (state.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('');
    const by = mailByCase();
    const body = rows.map((r, i) => `<tr class="cmp-r-${STATUS_CLS(r.status)}${r.tatBreached ? ' cmp-tat' : ''}">
      <td class="cmp-d"><b>${esc(dayLabel(r.day))}</b><small>${esc(when(r.date))}</small></td>
      <td class="cmp-case"><a href="${esc(r.link)}" target="_blank" rel="noopener" title="Open the mail in Gmail">${esc(r.caseNo || '—')}</a></td>
      <td class="mono cmp-c">${esc(r.vrn || '—')}</td>
      <td class="mono cmp-tag">${esc(r.tagId || '—')}</td>
      <td class="cmp-desc">${esc(r.description || '—')}</td>
      <td class="cmp-c">${esc(r.bcName || '—')}</td>
      <td><b>${esc(r.agentName || '—')}</b>${r.issuerSrc ? `<small class="cmp-gvm" title="Bank mail showed: ${esc(r.mailAgentName || '')} (${esc(r.mailAgentId || '')})">✓ GV Master</small>` : ''}</td>
      <td class="mono cmp-c">${esc(r.agentId || '—')}</td>
      <td>${r.tlName ? `<b>${esc(r.tlName)}</b>` : '<span class="dim">—</span>'}</td>
      <td class="mono cmp-c">${esc(r.tlId || '—')}</td>
      <td class="cmp-st"><span class="cmp-pill cmp-${STATUS_CLS(r.status)}" title="${esc(r.bankNote || '')}">${esc(r.status)}</span>${r.resolvedAt ? `<small>${esc(when(r.resolvedAt))}</small>` : (r.tatBreached ? '<small class="cmp-late">TAT breached</small>' : `<small>TAT ${esc(when(r.tatDueAt))}</small>`)}</td>
      <td class="num cmp-ded">${r.deducted ? `<b>${rupee(r.deducted)}</b>` : '—'}</td>
      <td class="num cmp-age">${esc(ageText(r))}</td>${showMail ? `<td class="cmp-c cmp-mailc">${mailCell(r, by)}</td>` : ''}</tr>`).join('');
    return `<div class="table-wrap cmp-wrap"><table class="tbl cmp-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }


  // ---- 📧 Mail history: kis complaint ki mail kise gayi / nahi gayi ---------------------------------------------------
  const KIND_L = { new: ['New complaint', 'cmp-pend'], deduct: ['Bank deducted', 'cmp-bank'], remind: ['Reminder', 'cmp-team'] };
  const logOf = () => (state.data && state.data.mailLog) || null;
  function mailByCase() {
    const m = new Map();
    (logOf() || []).forEach((l) => { if (l.caseNo) { const a = m.get(l.caseNo) || []; a.push(l); m.set(l.caseNo, a); } });
    return m;
  }
  function mailCell(r, by) {
    const list = by.get(r.caseNo);
    if (!list || !list.length) return '<span class="dim" title="No alert mail for this complaint yet">—</span>';
    const ok = list.filter((l) => l.ok), bad = list.filter((l) => !l.ok);
    const tip = list.map((l) => `${(KIND_L[l.kind] || [l.kind])[0]} → ${l.to} · ${when(l.at)} · ${l.ok ? 'sent' : `FAILED ${l.error || ''}`}`).join('\n');
    return `<span title="${esc(tip)}">${ok.length ? `<span class="cmp-mok">✅ ${ok.length}</span>` : ''}${bad.length ? ` <span class="cmp-err">❌ ${bad.length}</span>` : ''}<small>${esc(when((ok[0] || bad[0]).at))}</small></span>`;
  }
  function historyHtml() {
    const log = logOf();
    if (!log) return '<div class="empty">Mail history is visible to admins only.</div>';
    const q = state.q.trim().toLowerCase();
    const byCase = new Map(rowsAll().map((r) => [r.caseNo, r]));
    const rows = log.filter((l) => {
      const r = byCase.get(l.caseNo) || {};
      return !q || [l.to, l.subject, l.caseNo, l.kind, r.agentName, r.agentId, r.tlName, r.tlId].some((v) => String(v || '').toLowerCase().includes(q));
    });
    const sentN = log.filter((l) => l.ok).length, failN = log.length - sentN;
    const head = `<div class="cmp-hsum"><span class="cmp-pill cmp-me">✅ ${sentN} sent</span><span class="cmp-pill ${failN ? 'cmp-tatp' : 'cmp-team'}">${failN ? '❌' : '•'} ${failN} failed</span><span class="dim small">Last ${log.length} mails · ${state.data.mailErr ? `<b class="cmp-err">Mail problem: ${esc(state.data.mailErr)}</b>` : 'mail provider OK'}</span></div>`;
    if (!rows.length) return `${head}<div class="empty">${log.length ? 'No mail matches the search.' : 'No alert mail has been sent yet. Turn on Mail alerts, add a recipient and save — mails appear here as they go out.'}</div>`;
    const body = rows.map((l) => {
      const r = byCase.get(l.caseNo) || {};
      const k = KIND_L[l.kind] || [l.kind, 'cmp-team'];
      return `<tr class="${l.ok ? '' : 'cmp-hfail'}"><td class="cmp-d"><b>${esc(when(l.at))}</b></td><td><span class="cmp-pill ${k[1]}">${esc(k[0])}</span>${l.kind === 'remind' ? `<small>${l.count} pending</small>` : ''}</td><td class="cmp-case">${l.caseNo ? `<a href="${esc(r.link || '#')}" target="_blank" rel="noopener">${esc(l.caseNo)}</a>` : '—'}</td><td>${r.agentName ? `<b>${esc(r.agentName)}</b><small>${esc(r.agentId || '')}</small>` : '—'}</td><td>${esc(r.tlName || '—')}</td><td>${esc(l.to)}</td><td>${esc(l.subject)}${l.files ? ` <span title="${l.files} attachment(s)">📎${l.files}</span>` : ''}${l.note ? `<small>${esc(l.note)}</small>` : ''}</td><td class="cmp-st">${l.ok ? '<span class="cmp-pill cmp-me">✅ Sent</span>' : `<span class="cmp-pill cmp-tatp">❌ Failed${l.tries > 1 ? ` ×${l.tries}` : ''}</span><small class="cmp-err">${esc(l.error || '')}</small>`}</td></tr>`;
    }).join('');
    return `${head}<div class="table-wrap cmp-wrap"><table class="tbl cmp-tbl cmp-sum"><thead><tr><th>When</th><th>Type</th><th>Case</th><th>Agent</th><th>TL</th><th>Mailed to</th><th>Subject</th><th>Result</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function groupHtml(rows, by) {
    const m = new Map();
    rows.forEach((r) => {
      const key = by === 'tl' ? (r.tlName || '— not found —') : `${r.agentName || '—'}|${r.agentId || ''}`;
      const g = m.get(key) || { key, name: by === 'tl' ? key : (r.agentName || '—'), id: by === 'tl' ? (r.tlId || '') : r.agentId, tl: r.tlName, total: 0, pend: 0, me: 0, bank: 0, team: 0, ded: 0, tat: 0 };
      g.total++; g.ded += r.deducted || 0; if (r.tatBreached) g.tat++;
      const c = STATUS_CLS(r.status); g[c]++;
      m.set(key, g);
    });
    const list = [...m.values()].sort((a, b) => b.pend - a.pend || b.total - a.total);
    if (!list.length) return '<div class="empty">No complaints found for these filters.</div>';
    const owner = (state.data && state.data.meta && state.data.meta.config && state.data.meta.config.ownerName) || 'Tarun';
    return `<div class="table-wrap cmp-wrap"><table class="tbl cmp-tbl cmp-sum"><thead><tr><th>#</th><th>${by === 'tl' ? 'TL' : 'Agent'}</th><th>ID</th>${by === 'agent' ? '<th>TL</th>' : ''}<th class="num">Total</th><th class="num">Pending</th><th class="num">Solved by ${esc(owner)}</th><th class="num">Solved by Bank</th><th class="num">Solved by Team</th><th class="num">TAT breached</th><th class="num">Deducted</th></tr></thead><tbody>${list.map((g, i) => `<tr><td class="dim">${i + 1}</td><td><button type="button" class="smap-link" data-cmp-pick="${by}" data-key="${esc(g.key)}"><b>${esc(g.name)}</b></button></td><td class="mono cmp-c">${esc(g.id || '—')}</td>${by === 'agent' ? `<td>${esc(g.tl || '—')}</td>` : ''}<td class="num"><b>${g.total}</b></td><td class="num">${g.pend ? `<span class="cmp-pill cmp-pend">${g.pend}</span>` : 0}</td><td class="num">${g.me || 0}</td><td class="num">${g.bank || 0}</td><td class="num">${g.team || 0}</td><td class="num">${g.tat ? `<span class="cmp-late">${g.tat}</span>` : 0}</td><td class="num">${g.ded ? `<b>${rupee(g.ded)}</b>` : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function metaLine() {
    const m = state.data && state.data.meta;
    if (!m) return '';
    const c = m.config || {};
    const t = m.okAt ? new Date(m.okAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
    const err = m.error ? `<span class="cmp-err">⚠ ${esc(m.error)}</span>` : (m.enrichErr ? `<span class="cmp-err">⚠ GV Master lookup: ${esc(m.enrichErr)}</span>` : '');
    return `<p class="dim small cmp-meta">${m.running ? '⏳ Syncing with Gmail… · ' : ''}Last Gmail sync <b>${esc(t)}</b> · auto-refresh every <b>${esc(c.refreshMin || 10)} min</b> · subjects: ${(c.subjects || []).map((s) => `<code>${esc(s)}</code>`).join(' ')}${m.account ? ` · mailbox ${esc(m.account)}` : ''}${c.enabled === false ? ' · <b>auto-refresh is OFF</b>' : ''} ${err}</p>`;
  }


  // ---- ⚙ Settings + 📧 mail alerts (admin) -------------------------------------------------------------------------
  const clone = (v) => JSON.parse(JSON.stringify(v || {}));
  const TPL = [['newSubject', 'New complaint · subject', 1], ['newBody', 'New complaint · mail body', 0], ['deductSubject', 'Bank deducted · subject', 1], ['deductBody', 'Bank deducted · mail body', 0], ['remindSubject', 'Reminder · subject', 1], ['remindBody', 'Reminder · mail body', 0]];
  const chipBox = (kind, label, list) => `<div class="cmp-chipbox" data-chips="${kind}"><span class="cmp-chip-l">${label}</span>
      <div class="cmp-chips">${(list || []).map((v) => `<span class="cmp-chip" data-v="${esc(v)}">${esc(v)}<button type="button" data-chip-x title="Remove">×</button></span>`).join('') || '<span class="dim small">none selected</span>'}</div>
      <div class="cmp-chip-add"><input class="input" data-chip-in list="cmp-dl-${kind === 'tls' ? 'tl' : 'agent'}" placeholder="${kind === 'tls' ? 'Pick / type TL name or ID → Enter' : 'Pick / type agent name or ID → Enter'}"><button type="button" class="btn small" data-chip-add>＋ Add</button></div></div>`;
  function ruleRow(r) {
    const all = r.all !== false;
    return `<div class="cmp-rule" data-rule="${esc(r.id)}" data-since="${esc(r.since || '')}">
      <div class="cmp-rule-top">
        <label class="check cmp-rule-on"><input type="checkbox" data-r="enabled" ${r.enabled !== false ? 'checked' : ''}> <b>Rule ON</b></label>
        <label class="check"><input type="radio" name="cmp-all-${esc(r.id)}" data-r="all" value="1" ${all ? 'checked' : ''}> All complaints</label>
        <label class="check"><input type="radio" name="cmp-all-${esc(r.id)}" data-r="all" value="0" ${all ? '' : 'checked'}> Only selected TLs / agents</label>
        <button type="button" class="btn small cmp-rdel" data-cmp-rdel title="Remove rule">🗑 Remove</button>
      </div>
      ${all ? '' : `<div class="cmp-pick">${chipBox('tls', '👥 TLs', r.tls)}${chipBox('agents', '👤 Agents', r.agents)}</div>`}
      <label class="cmp-rule-to">Mail to <input class="input" data-r="to" placeholder="name@example.com, other@example.com" value="${esc(r.to || '')}"></label>
      <div class="cmp-rule-ev"><span class="dim small">Send when:</span><label class="check"><input type="checkbox" data-r="onNew" ${r.onNew !== false ? 'checked' : ''}> New complaint</label><label class="check"><input type="checkbox" data-r="onDeduct" ${r.onDeduct !== false ? 'checked' : ''}> Bank deducted</label><label class="check"><input type="checkbox" data-r="remind" ${r.remind !== false ? 'checked' : ''}> Reminder</label><label class="check"><input type="checkbox" data-r="attach" ${r.attach !== false ? 'checked' : ''}> 📎 Attach the mail’s screenshots / files</label></div></div>`;
  }
  function datalists() {
    const rows = rowsAll();
    const tl = [...new Set(rows.flatMap((r) => [r.tlName, r.tlId]).filter(Boolean))].sort();
    const ag = [...new Set(rows.flatMap((r) => [r.agentName, r.agentId]).filter(Boolean))].sort();
    return `<datalist id="cmp-dl-tl">${tl.map((v) => `<option value="${esc(v)}">`).join('')}</datalist><datalist id="cmp-dl-agent">${ag.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
  }
  function panelHtml() {
    const d = state.draft; if (!d) return '';
    const m = d.mail || {};
    return `<div class="card cmp-panel" data-cmp-panel><div class="card-head"><h3>⚙ Settings · 📧 Mail alerts</h3><div class="card-right"><button type="button" class="btn small" data-cmp-setclose>✖ Close</button></div></div><div class="card-body">
      <h4>Gmail fetch</h4>
      <div class="form-grid cmp-fg">
        <label class="check"><input type="checkbox" data-f="enabled" ${d.enabled !== false ? 'checked' : ''}> <b>Auto-refresh ON</b></label>
        <label>Refresh every (minutes)<input class="input" type="number" min="2" max="1440" data-f="refreshMin" value="${esc(d.refreshMin ?? 10)}"></label>
        <label>Your name (shown in “Solved by …”)<input class="input" data-f="ownerName" value="${esc(d.ownerName || '')}"></label>
        <label>TAT (hours)<input class="input" type="number" min="1" max="720" data-f="tatHours" value="${esc(d.tatHours ?? 24)}"></label>
        <label class="cmp-wide">Mail subjects to watch (one per line)<textarea class="input" rows="3" data-f="subjects" placeholder="POS Related-Request">${esc((d.subjects || []).join('\n'))}</textarea></label>
      </div>
      <h4>📧 Mail alerts — who gets which complaints</h4>
      <p class="dim small">As soon as a new bank complaint is found (checked at every refresh), when the bank deducts the amount, and a reminder digest every few hours while complaints stay pending — mailed to whoever you set below. A new rule only mails complaints that arrive <b>after</b> it is saved.</p>
      <div class="form-grid cmp-fg"><label class="check"><input type="checkbox" data-f="mailEnabled" ${m.enabled ? 'checked' : ''}> <b>Mail alerts ON</b></label><label>Reminder every (hours)<input class="input" type="number" min="1" max="72" step="0.5" data-f="remindHours" value="${esc(m.remindHours ?? 4)}"></label></div>
      <div class="cmp-rules">${(m.rules || []).map(ruleRow).join('') || '<p class="dim small">No recipient yet — click “Add recipient / TL / agent rule”.</p>'}</div>
      <div class="btn-row"><button type="button" class="btn small" data-cmp-radd>➕ Add another recipient (TL / agent rule)</button></div>
      ${datalists()}
      <h4>✉️ Message</h4>
      <p class="dim small">Placeholders: ${(state.data.placeholders || []).map((x) => `<code>${esc(x)}</code>`).join(' ')} · <code>{list}</code> / <code>{count}</code> are for the reminder only.</p>
      <div class="cmp-tpls">${TPL.map(([k, l, one]) => `<label>${l}${one ? `<input class="input" data-t="${k}" value="${esc((m.templates || {})[k] || '')}">` : `<textarea class="input" rows="8" data-t="${k}">${esc((m.templates || {})[k] || '')}</textarea>`}</label>`).join('')}</div>
      <div class="cmp-testrow"><input class="input" data-cmp-testto placeholder="Test recipient email"><button type="button" class="btn small" data-cmp-test="new">📨 Test “new”</button><button type="button" class="btn small" data-cmp-test="deduct">📨 Test “deducted”</button><button type="button" class="btn small" data-cmp-test="remind">📨 Test “reminder”</button></div>
      <div class="save-bar"><button type="button" class="btn primary" data-cmp-save>💾 Save settings</button><span class="dim small">${esc(state.setMsg)}</span></div>
      ${state.data.mailErr ? `<p class="cmp-err">Mail problem: ${esc(state.data.mailErr)}</p>` : ''}
    </div></div>`;
  }
  function collectDraft() {
    const p = state.root && state.root.querySelector('[data-cmp-panel]'); if (!p || !state.draft) return state.draft;
    const d = state.draft, q = (sel) => p.querySelector(sel);
    d.enabled = q('[data-f="enabled"]').checked;
    d.refreshMin = Number(q('[data-f="refreshMin"]').value) || 10;
    d.ownerName = q('[data-f="ownerName"]').value.trim();
    d.tatHours = Number(q('[data-f="tatHours"]').value) || 24;
    d.subjects = q('[data-f="subjects"]').value.split(/\n/).map((x) => x.trim()).filter(Boolean);
    d.mail = d.mail || {};
    d.mail.enabled = q('[data-f="mailEnabled"]').checked;
    d.mail.remindHours = Number(q('[data-f="remindHours"]').value) || 4;
    d.mail.rules = [...p.querySelectorAll('[data-rule]')].map((row) => {
      const g = (k) => row.querySelector(`[data-r="${k}"]`);
      const chips = (kind) => [...row.querySelectorAll(`[data-chips="${kind}"] .cmp-chip`)].map((c) => c.dataset.v);
      const allEl = row.querySelector('[data-r="all"]:checked');
      const old = ((state.draft.mail || {}).rules || []).find((x) => x.id === row.dataset.rule) || {};
      const all = allEl ? allEl.value === '1' : true;
      return { id: row.dataset.rule, since: Number(row.dataset.since) || undefined, enabled: g('enabled').checked, all, tls: row.querySelector('[data-chips]') ? chips('tls') : (old.tls || []), agents: row.querySelector('[data-chips]') ? chips('agents') : (old.agents || []), to: g('to').value.trim(), onNew: g('onNew').checked, onDeduct: g('onDeduct').checked, remind: g('remind').checked, attach: g('attach').checked };
    });
    d.mail.templates = d.mail.templates || {};
    p.querySelectorAll('[data-t]').forEach((el) => { d.mail.templates[el.dataset.t] = el.value; });
    return d;
  }
  /** Chip box me TL / agent jodo (Enter, ＋ ya list se chun-ne par) — DOM me chip daalke draft me collect karta hai. */
  function addChip(input) {
    const v = String((input && input.value) || '').trim(); if (!v) return;
    const box = input.closest('[data-chips]'), wrap = box.querySelector('.cmp-chips');
    if (![...wrap.querySelectorAll('.cmp-chip')].some((c) => c.dataset.v.toLowerCase() === v.toLowerCase())) {
      const chip = document.createElement('span'); chip.className = 'cmp-chip'; chip.dataset.v = v; chip.textContent = v;
      const x = document.createElement('button'); x.type = 'button'; x.setAttribute('data-chip-x', ''); x.title = 'Remove'; x.textContent = '×'; chip.appendChild(x);
      const none = wrap.querySelector('.dim'); if (none) none.remove();
      wrap.appendChild(chip);
    }
    collectDraft(); paint();
    const again = state.root.querySelector(`[data-rule="${CSS.escape(box.closest('[data-rule]').dataset.rule)}"] [data-chips="${box.dataset.chips}"] [data-chip-in]`); if (again) again.focus();
  }
  async function saveSettings(btn) {
    // jo naam chip box me type hua par Enter/Add nahi hua — wo bhi save me aa jaye
    state.root.querySelectorAll('[data-chip-in]').forEach((i) => { if (i.value.trim()) addChip(i); });
    const d = collectDraft();
    d.mail.rules = (d.mail.rules || []).filter((r) => r.to || r.all || (r.tls || []).length || (r.agents || []).length);   // untouched blank rule save na ho
    await U.withButtonBusy(btn, async () => {
      try {
        const out = await FF.auth.api('/api/settings', 'PUT', { settings: { complaints: d } });
        if (FF.auth.applySettings && out && out.settings) FF.auth.applySettings(out.settings);
        state.setMsg = `Saved ✓ ${U.timeLabel ? U.timeLabel(Date.now()) : ''}`;
        U.toast('Complaints settings saved ✓', 'ok');
        state.draft = clone(out && out.settings && out.settings.complaints ? out.settings.complaints : d);
        await load();
      } catch (e) { state.setMsg = ''; U.toast((e && e.message) || 'Could not save', 'err'); }
    }, 'Saving…');
  }
  async function sendTest(btn) {
    const d = collectDraft();
    const to = (state.root.querySelector('[data-cmp-testto]') || {}).value || '';
    await U.withButtonBusy(btn, async () => {
      try {
        const out = await FF.auth.api('/api/complaints/mail-test', 'POST', { to, kind: btn.dataset.cmpTest, mail: d.mail });
        if (out && out.ok) U.toast('Test mail sent ✓', 'ok'); else U.toast((out && out.error) || 'Test mail failed', 'err');
      } catch (e) { U.toast((e && e.message) || 'Test mail failed', 'err'); }
    }, 'Sending…');
  }

  function exportXlsx() {
    const rows = visible();
    const header = ['Date', 'Case Number', 'Vehicle Registration Number', 'Tag Id', 'Description', 'BC Name', 'Agent Name', 'Agent ID', 'Agent source', 'Mail showed (name · ID)', 'TL Name', 'TL ID', 'Status', 'Replied at', 'Resolved at', 'Deducted (₹)', 'Bank note', 'TAT breached', 'Mail link'];
    const iso = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '');
    const body = rows.map((r) => [iso(r.date), r.caseNo, r.vrn, r.tagId, r.description, r.bcName, r.agentName, r.agentId, r.issuerSrc || 'Bank mail', r.issuerSrc ? `${r.mailAgentName} · ${r.mailAgentId}` : '', r.tlName, r.tlId, r.status, iso(r.repliedAt), iso(r.resolvedAt), r.deducted || '', r.bankNote, r.tatBreached ? 'Yes' : '', r.link]);
    FF.xlsx.download(`agents-complaints-${state.from}_${state.to}-${U.stamp()}.xlsx`, [{ name: 'Complaints', header, rows: body }]);
  }

  function paint() {
    const root = state.root; if (!root) return;
    const mount = root.querySelector('[data-cmp-body]'); if (!mount) return;
    if (state.setOpen) collectDraft();
    const keepQ = root.querySelector('[data-cmp-q]');
    const hadFocus = keepQ && document.activeElement === keepQ; const pos = hadFocus ? keepQ.selectionStart : 0;
    const rows = visible();
    const tabs = `<div class="seg cmp-tabs"><button type="button" class="seg-btn${state.tab === 'list' ? ' on' : ''}" data-cmp-tab="list">📋 Complaints</button><button type="button" class="seg-btn${state.tab === 'agent' ? ' on' : ''}" data-cmp-tab="agent">👤 By agent</button><button type="button" class="seg-btn${state.tab === 'tl' ? ' on' : ''}" data-cmp-tab="tl">👥 By TL</button>${logOf() ? `<button type="button" class="seg-btn${state.tab === 'mail' ? ' on' : ''}" data-cmp-tab="mail">📧 Mail history</button>` : ''}</div>`;
    const err = state.err ? `<div class="notice err">${esc(state.err)}</div>` : '';
    const loading = state.busy ? '<p class="dim small">⏳ Loading… (older months are read from Gmail, this can take up to a minute)</p>' : '';
    mount.innerHTML = `${metaLine()}${err}${loading}${state.data && state.setOpen && state.draft ? panelHtml() : ''}${state.data ? tilesHtml() + filtersHtml() : ''}
      ${state.data ? `<div class="cmp-bar">${tabs}<span class="dim small">${U.fmt(rows.length)} of ${U.fmt(rowsAll().length)} complaints</span><span class="cmp-bar-r">${state.data.cfg ? '<button type="button" class="btn small" data-cmp-settings>⚙ Settings & Mail alerts</button>' : ''}<button type="button" class="btn small" data-cmp-refresh>🔄 Sync Gmail now</button><button type="button" class="btn small primary" data-cmp-xlsx>⬇ Excel</button></span></div>
      <div class="card"><div class="card-body cmp-card">${state.tab === 'list' ? listHtml(rows) : state.tab === 'mail' ? historyHtml() : groupHtml(rows, state.tab)}</div></div>` : (state.busy ? U.spinner('Reading complaints…') : '')}`;
    if (hadFocus) { const q = root.querySelector('[data-cmp-q]'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch { /* ignore */ } } }
  }

  async function load(opts) {
    const my = ++state.req;
    state.busy = true; state.err = ''; paint();
    try {
      const d = await FF.auth.api(`/api/complaints?from=${encodeURIComponent(state.from)}&to=${encodeURIComponent(state.to)}`);
      if (my !== state.req) return;
      state.data = d;
      if (d && d.meta && d.meta.error && !(d.rows || []).length) state.err = d.meta.error;
    } catch (e) { if (my === state.req) state.err = (e && e.message) || 'Could not load complaints'; }
    if (my === state.req) { state.busy = false; paint(); }
    void opts;
  }
  async function syncNow(btn) {
    await U.withButtonBusy(btn, async () => {
      try {
        const r = await FF.auth.api('/api/complaints/refresh', 'POST', {});
        if (r && r.ok === false) { state.err = r.error || 'Gmail sync failed'; paint(); return; }
        await load();
      } catch (e) { state.err = (e && e.message) || 'Gmail sync failed'; paint(); }
    }, 'Syncing…');
  }
  function quick(id) {
    const t = today(), d = new Date();
    if (id === 'today') { state.from = t; state.to = t; }
    else if (id === '7d') { d.setDate(d.getDate() - 6); state.from = ymd(d); state.to = t; }
    else if (id === 'month') { state.from = monthStart(t); state.to = t; }
    else if (id === 'last') { const f = new Date(d.getFullYear(), d.getMonth() - 1, 1), l = new Date(d.getFullYear(), d.getMonth(), 0); state.from = ymd(f); state.to = ymd(l); }
    else if (id === '90d') { d.setDate(d.getDate() - 89); state.from = ymd(d); state.to = t; }
    state.tl = ''; state.agent = '';
    load();
  }

  function render(root) {
    state.root = root;
    root.innerHTML = `<div class="page cmp-page"><div class="page-head"><div><h1>📨 Agents Complaints Summary</h1>
      <p class="sub">Bank POS-complaint mails from Gmail — case, VRN, tag, agent, TL and status. The current month refreshes in the background; pick any date range to look back.</p></div></div>
      <div data-cmp-body></div></div>`;
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-r="all"]')) { collectDraft(); paint(); return; }
      if (t.matches('[data-chip-in]')) { addChip(t); return; }
      if (t.matches('[data-cmp-from]')) { if (t.value) { state.from = t.value; if (state.to < state.from) state.to = state.from; load(); } return; }
      if (t.matches('[data-cmp-to]')) { if (t.value) { state.to = t.value; if (state.from > state.to) state.from = state.to; load(); } return; }
      if (t.matches('[data-cmp-statussel]')) { state.status = t.value; paint(); return; }
      if (t.matches('[data-cmp-tl]')) { state.tl = t.value; paint(); return; }
      if (t.matches('[data-cmp-agent]')) { state.agent = t.value; paint(); }
    });
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-chip-in]')) { e.preventDefault(); addChip(e.target); } });
    root.addEventListener('input', (e) => { if (e.target.matches('[data-cmp-q]')) { state.q = e.target.value; paint(); } });
    root.addEventListener('click', (e) => {
      const t = e.target;
      const tile = t.closest('[data-cmp-status]'); if (tile) { state.status = state.status === tile.dataset.cmpStatus ? 'all' : tile.dataset.cmpStatus; paint(); return; }
      const qk = t.closest('[data-cmp-quick]'); if (qk) { quick(qk.dataset.cmpQuick); return; }
      const tab = t.closest('[data-cmp-tab]'); if (tab) { state.tab = tab.dataset.cmpTab; paint(); return; }
      const so = t.closest('[data-cmp-sort]'); if (so) { const k = so.dataset.cmpSort; state.dir = state.sort === k ? -state.dir : (k === 'date' || k === 'deducted' ? -1 : 1); state.sort = k; paint(); return; }
      const pick = t.closest('[data-cmp-pick]'); if (pick) { if (pick.dataset.cmpPick === 'tl') { state.tl = pick.dataset.key; state.agent = ''; } else { state.agent = pick.dataset.key; } state.tab = 'list'; paint(); return; }
      if (t.closest('[data-cmp-clear]')) { state.status = 'all'; state.tl = ''; state.agent = ''; state.q = ''; paint(); return; }
      if (t.closest('[data-cmp-xlsx]')) { exportXlsx(); return; }
      const rf = t.closest('[data-cmp-refresh]'); if (rf) { syncNow(rf); return; }
      if (t.closest('[data-cmp-settings]')) { state.setOpen = !state.setOpen; if (state.setOpen && state.data && state.data.cfg) {
          state.draft = clone(state.data.cfg); state.draft.mail = state.draft.mail || {};
          if (!(state.draft.mail.rules || []).length) state.draft.mail.rules = [{ id: `n${Date.now().toString(36)}`, enabled: true, all: false, tls: [], agents: [], to: '', onNew: true, onDeduct: true, remind: true, attach: true }];
        }
        paint(); return; }
      if (t.closest('[data-cmp-setclose]')) { state.setOpen = false; paint(); return; }
      if (t.closest('[data-cmp-radd]')) { collectDraft(); state.draft.mail.rules = (state.draft.mail.rules || []).concat([{ id: `n${Date.now().toString(36)}`, enabled: true, all: false, tls: [], agents: [], to: '', onNew: true, onDeduct: true, remind: true, attach: true }]); paint(); return; }
      const cx = t.closest('[data-chip-x]'); if (cx) { cx.closest('.cmp-chip').remove(); collectDraft(); paint(); return; }
      const ca = t.closest('[data-chip-add]'); if (ca) { addChip(ca.closest('.cmp-chip-add').querySelector('[data-chip-in]')); return; }
      const rd = t.closest('[data-cmp-rdel]'); if (rd) { collectDraft(); const id = rd.closest('[data-rule]').dataset.rule; state.draft.mail.rules = state.draft.mail.rules.filter((x) => x.id !== id); paint(); return; }
      const sv = t.closest('[data-cmp-save]'); if (sv) { saveSettings(sv); return; }
      const ts = t.closest('[data-cmp-test]'); if (ts) sendTest(ts);
    });
    load();
    // background cache is refreshed by the server; the page just re-reads it quietly every minute
    clearInterval(state.timer);
    state.timer = setInterval(async () => {
      if (!state.root || !state.root.isConnected) { clearInterval(state.timer); return; }
      if (document.hidden || state.busy) return;
      const ae = document.activeElement; if (state.setOpen) return;
      if (ae && state.root.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;   // user is typing / picking
      try { const d = await FF.auth.api(`/api/complaints?from=${encodeURIComponent(state.from)}&to=${encodeURIComponent(state.to)}`); if (state.root.isConnected) { state.data = d; paint(); } } catch { /* keep last data */ }
    }, 60000);
  }
  FF.pages.complaints = { title: 'Agents Complaints Summary', render };
})(window.FF);
