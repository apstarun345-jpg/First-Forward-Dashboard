/* 🧍 Direct Agents & TLs — poore site ka ek hi "kaun direct agent hai" layer.
   Rules ki single source of truth: FF.config.direct (Settings → 🧍 Direct Agents se editable):
     • First Forward : TL Name = APS (ya excludeTls/placeholder) → Direct Agent (APS)
     • GV Partner    : TL ID aur TL Name dono khaali (jinke paas TL hi nahi) → Direct Agent (no TL)
   Yahi rule GV Stock Report dispatch, FF dispatch planner, TL lists/rankings, network graph,
   search suggestions, report cards aur naye Direct Agents page — sab jagah use hota hai.
   Direct agents: TL list me kabhi nahi, dispatch exempt (default), aur label hamesha ek jaisa. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean;

  const rules = () => FF.config.directRules();
  const channelOf = (row, channel) => FF.config.directChannelOf(row, channel);
  const isDirect = (row, channel) => FF.config.isDirectAgent(row, channel);
  const isRealTl = (name) => FF.config.isRealTl(name);

  const CH = { gv: { key: 'gv', label: 'GV Partner', icon: '🟩', channel: 'GV Partner' }, ff: { key: 'ff', label: 'First Forward', icon: '🟦', channel: 'First Forward' } };

  function tlNameOf(row) { return clean((row && (row.tlName || row.tl || row.supervisorName)) || ''); }
  function tlIdOf(row) { return clean((row && (row.tlId || row.supervisorId || row.supervisor_id)) || ''); }

  /** High / Medium dispatch priority? (sheet ka Priority Level text) */
  const isHighMedium = (priority) => /high|medium/i.test(clean(priority));
  /** Direct agent + High/Medium priority = stock dispatch nahi, par TAG chahiye → alag list / option. */
  function tagRequired(row, channel, priority) {
    return isDirect(row, channel) && isHighMedium(priority !== undefined ? priority : (row && (row.priority || row.agentPriority)));
  }
  /** Suggested TAG qty = avg VC4/day × target days − VC4 stock (sheet ki value ho to wahi). */
  function suggestQty(o) {
    const days = Number(FF.config.features && FF.config.features.suggestDays) || 15;
    const given = Number(o && o.given) > 0 ? Number(o.given) : null;
    if (given != null) return given;
    return Math.max(0, Math.ceil((Number(o && o.daily) || 0) * days - (Number(o && o.stock) || 0)));
  }
  /** Bina stock ghataye — pure run-rate requirement (avg VC4/day × target days). */
  function suggestGrossQty(o) {
    const days = Number(FF.config.features && FF.config.features.suggestDays) || 15;
    return Math.max(0, Math.ceil((Number(o && o.daily) || 0) * days));
  }

  /** Human label: "Direct Agent (APS)" / "Direct Agent (no TL)" / asli TL naam. */
  function label(row, channel) {
    const ch = channelOf(row, channel);
    if (isDirect(row, ch)) return FF.config.directLabel(row, ch);
    return tlNameOf(row) || '—';
  }

  /** Kyun direct hai — chhota Hinglish reason (UI chips / kundli ke liye). */
  function reason(row, channel) {
    if (!isDirect(row, channel)) return '';
    const ch = channelOf(row, channel);
    const tl = tlNameOf(row), id = tlIdOf(row);
    if (row && (row.isDirect === true || row.directAgent === true || row.tlExcluded === true) && !tl && !id) return 'Sheet me direct flag';
    if (ch === 'gv') {
      if (!tl && !id) return 'GV rule: TL ID + TL Name dono khaali';
      if (FF.config.isSelfSupervised(row)) return 'GV rule: agent hi apna supervisor (self)';
      if (tl && FF.config.isExcludedTl(tl)) return `GV placeholder TL "${tl}"`;
      return 'GV direct rule';
    }
    if (ch === 'ff') {
      if (tl && FF.config.isExcludedTl(tl)) return `FF rule: TL Name "${tl}" (APS/direct)`;
      if (!tl && !id) return 'FF rule: koi TL assign hi nahi';
      if (FF.config.isSelfSupervised(row)) return 'FF rule: agent hi apna TL (self)';
      return 'FF direct rule';
    }
    if (tl && FF.config.isExcludedTl(tl)) return `TL Name "${tl}" placeholder hai`;
    if (!tl && !id) return 'TL ID + TL Name dono khaali';
    return 'Direct rule';
  }

  /** Filter chips HTML — har page same shape me use karta hai. `attr` = data attribute name. */
  function filterButtons(o) {
    const counts = o.counts || {};
    const cur = o.current || 'all';
    const attr = o.attr || 'direct-scope';
    const btn = (value, text, n, cls) => `<button class="btn small ${cls || ''} ${cur === value ? 'primary' : ''}" data-${attr}="${value}">${text}${n === undefined ? '' : ` <b>${U.fmt(n)}</b>`}</button>`;
    return `<div class="dispatch-scope direct-scope" role="group" aria-label="Direct agent filter">${btn('all', '👥 All', counts.all)}${btn('managed', '🧑‍💼 TL-managed', counts.managed)}${btn('direct', '🚫 Direct Agents · all', counts.direct, 'direct-filter')}${counts.tag !== undefined ? btn('tag', '🏷️ Direct · High/Medium · Tag required', counts.tag, 'direct-tag') : ''}${o.gv !== undefined && o.ff !== undefined ? `${btn('gv-direct', '🟩 GV direct', o.gv, 'direct-gv')}${btn('ff-direct', '🟦 FF direct', o.ff, 'direct-ff')}` : ''}</div>`;
  }

  /** Counts of a list. */
  function counts(list, channel) {
    const rows = list || [];
    let direct = 0, gvDirect = 0, ffDirect = 0, tag = 0;
    const tls = new Set();
    rows.forEach((r) => {
      const ch = channelOf(r, channel);
      if (isDirect(r, ch)) { direct++; if (tagRequired(r, ch)) tag++; if (ch === 'gv') gvDirect++; else if (ch === 'ff') ffDirect++; }
      else { const t = tlNameOf(r); if (t) tls.add(t.toUpperCase()); }
    });
    return { all: rows.length, direct, managed: rows.length - direct, gv: gvDirect, ff: ffDirect, tag, tls: tls.size };
  }

  /** Split a list into {direct, managed, tls:Map}. */
  function split(list, channel) {
    const rows = list || [];
    const direct = [], managed = [], tls = new Map();
    rows.forEach((r) => {
      const ch = channelOf(r, channel);
      if (isDirect(r, ch)) { direct.push(r); return; }
      managed.push(r);
      const key = tlNameOf(r) || 'Unmapped';
      if (!tls.has(key)) tls.set(key, []);
      tls.get(key).push(r);
    });
    return { direct, managed, tls };
  }

  /** Short rule banner (Hinglish) — pages ke top par. */
  function ruleBanner(channel) {
    const d = rules();
    const ffNames = (d.ffTlNames || []).join(', ') || 'APS';
    const parts = [];
    if (channel !== 'gv') parts.push(`🟦 <b>First Forward</b>: TL Name <b>${esc(ffNames)}</b> → Direct Agent (APS)`);
    if (channel !== 'ff') parts.push('🟩 <b>GV Partner</b>: jinke <b>TL ID + TL Name dono khaali</b> → Direct Agent (no TL)');
    parts.push('🚫 Direct agents TL lists / rankings me nahi · stock dispatch exempt');
    return `<div class="direct-rule-banner"><span>🧍</span><div>${parts.join(' · ')}</div><a class="btn small" href="#/directAgents">Poora rule &amp; list →</a></div>`;
  }

  /** Poore site ke direct agents ka roster (FF REPORT + GV REPORT + GV Master + Tag Assignment). */
  async function roster() {
    const out = [];
    // ---- First Forward (REPORT) ----
    try {
      if (FF.pages.performance && FF.pages.performance.ensureLoaded) await FF.pages.performance.ensureLoaded();
      const list = (FF.pages.performance && FF.pages.performance.agents && FF.pages.performance.agents()) || [];
      list.forEach((a) => {
        if (!isDirect(a, 'ff')) return;
        out.push({
          key: `ff:${a.agentId || a.id || a.name}`, channel: 'First Forward', ch: 'ff',
          id: clean(a.agentId || a.id || ''), name: clean(a.name || a.agentId || ''),
          tlName: tlNameOf(a), tlId: tlIdOf(a), reason: reason(a, 'ff'),
          stock: Number(a.stockTotal || 0), issued: Number(a.curTotal || 0),
          status: clean(a.agentStatus || ''), priority: clean(a.priority || a.agentPriority || ''),
          vc4Stock: Number(a.stockVc4 || 0),
          suggested: suggestQty({ daily: a.avgVc4 || ((FF.pages.performance.daysElapsed && FF.pages.performance.daysElapsed()) ? a.curVc4 / FF.pages.performance.daysElapsed() : 0), stock: a.stockVc4 }),
          suggestedGross: suggestGrossQty({ daily: a.avgVc4 || ((FF.pages.performance.daysElapsed && FF.pages.performance.daysElapsed()) ? a.curVc4 / FF.pages.performance.daysElapsed() : 0) }),
          route: `#/performance?q=${encodeURIComponent(a.name || '')}`
        });
      });
    } catch (err) { /* FF data optional */ }
    // ---- GV Partner (GV REPORT + Tag Assignment + GV Master) ----
    const gvMap = new Map();
    const pushGv = (id, name, extra) => {
      const key = clean(id) || `name:${clean(name).toUpperCase()}`;
      if (!key) return;
      const cur = gvMap.get(key) || { key: `gv:${key}`, channel: 'GV Partner', ch: 'gv', id: clean(id), name: clean(name || id), tlName: '', tlId: '', reason: '', stock: 0, issued: 0, status: '', priority: '', route: '' };
      cur.name = cur.name || clean(name || id);
      Object.assign(cur, extra || {});
      gvMap.set(key, cur);
    };
    try {
      const report = await FF.gv.need('report');
      (report || []).forEach((r) => {
        if (!isDirect(r, 'gv')) return;
        pushGv(r.agentId, r.agentName, {
          tlName: tlNameOf(r), tlId: tlIdOf(r), reason: reason(r, 'gv'),
          stock: Number(r.stockTotal || 0), issued: Number(r.curTotal || 0),
          status: clean(r.agentStatus || ''), priority: clean(r.priority || ''),
          vc4Stock: Number(r.stockVc4 || 0),
          suggested: suggestQty({ given: r.suggestedDispatch, daily: (r.curVc4 || 0) / Math.max(1, r.curDays || 0), stock: r.stockVc4 }),
          suggestedGross: suggestGrossQty({ daily: (r.curVc4 || 0) / Math.max(1, r.curDays || 0) }),
          route: `#/gvPerformance?q=${encodeURIComponent(r.agentName || '')}`
        });
      });
    } catch (err) { /* GV REPORT optional */ }
    try {
      const stockAgents = await FF.gv.need('stockAgent');
      (stockAgents || []).forEach((r) => {
        if (!isDirect(r, 'gv')) return;
        const existing = gvMap.get(clean(r.agentId));
        if (existing) { existing.stock = Math.max(existing.stock, Number(r.n || 0)); return; }
        pushGv(r.agentId, r.agentName, { tlName: tlNameOf(r), tlId: tlIdOf(r), reason: reason(r, 'gv'), stock: Number(r.n || 0), route: `#/gvStock?q=${encodeURIComponent(r.agentName || '')}` });
      });
    } catch (err) { /* Tag Assignment optional */ }
    try {
      const master = (FF.gv.rows && FF.gv.rows()) || [];
      const agg = new Map();
      master.forEach((r) => {
        if (!isDirect(r, 'gv')) return;
        const key = clean(r.agentId) || `name:${clean(r.agentName).toUpperCase()}`;
        const o = agg.get(key) || { issued: 0, last: null, commission: 0 };
        o.issued++; if (!o.last || (r.date && r.date > o.last)) o.last = r.date; o.commission += Number(r.commission || 0);
        agg.set(key, o);
      });
      agg.forEach((o, key) => {
        const existing = gvMap.get(key);
        if (existing) { existing.issued = Math.max(existing.issued, o.issued); return; }
        const source = master.find((r) => (clean(r.agentId) || `name:${clean(r.agentName).toUpperCase()}`) === key) || {};
        pushGv(source.agentId, source.agentName, {
          tlName: tlNameOf(source), tlId: tlIdOf(source), reason: reason(source, 'gv'),
          issued: o.issued, route: `#/gvTrend?agent=${encodeURIComponent(source.agentName || '')}`
        });
      });
    } catch (err) { /* GV Master optional */ }
    gvMap.forEach((v) => out.push(v));
    out.sort((a, b) => a.channel.localeCompare(b.channel) || b.issued - a.issued || b.stock - a.stock || a.name.localeCompare(b.name));
    return out;
  }

  // ---- page -------------------------------------------------------------------------------------
  const PAGE_HEADERS = ['Channel', 'Agent', 'Agent ID', 'Rule / reason', 'TL', 'Stock', 'MTD issued', 'Status', 'Priority', 'Tag required?', 'Suggested tags (stock − · w/o stock)'];

  async function render(root, params) {
    const p = params || {};
    const scope = ['all', 'direct', 'gv-direct', 'ff-direct', 'managed', 'tag'].includes(p.direct) ? p.direct : 'all';
    const q = clean(p.q || '').toLowerCase();
    root.innerHTML = U.spinner('Direct agents ka rule + roster bana rahe hain…');
    let rows = [];
    try { rows = await roster(); } catch (err) { root.innerHTML = U.errorBox(err); return; }
    const cnt = counts(rows, '');
    const byCh = { gv: rows.filter((r) => r.ch === 'gv'), ff: rows.filter((r) => r.ch === 'ff') };
    const tagRows = rows.filter((r) => isHighMedium(r.priority));
    const filtered = rows.filter((r) => {
      if (scope === 'gv-direct' && r.ch !== 'gv') return false;
      if (scope === 'ff-direct' && r.ch !== 'ff') return false;
      if (scope === 'tag' && !isHighMedium(r.priority)) return false;
      if (!q) return true;
      return [r.name, r.id, r.channel, r.reason, r.tlName, r.tlId].join(' ').toLowerCase().includes(q);
    });
    const d = rules();
    const ruleCard = (icon, title, rule, count, note) => `<div class="direct-rule-card"><div class="direct-rule-head"><span>${icon}</span><b>${title}</b><small>${U.fmt(count)} direct agents</small></div><p>${rule}</p><p class="dim small">${note}</p></div>`;
    const kpi = (label, value, foot, tone) => `<div class="kpi ${tone || 'g4'}"><div class="kpi-top"><span class="kpi-title">${label}</span><span class="kpi-icon">🧍</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;
    root.innerHTML = `<div class="page-head"><div><h1>🧍 Direct Agents &amp; TLs</h1><p class="sub">Ek hi rule poore site par — <b>GV</b>: TL ID + TL Name dono khaali = Direct Agent · <b>FF</b>: TL Name “${esc((d.ffTlNames || ['APS']).join(', '))}” = Direct Agent. Ye agents kisi TL list / ranking me nahi aate aur dispatch-exempt hain.</p></div>
      <div class="head-actions"><a class="btn small" href="#/settings?tab=direct">⚙️ Rule edit karo</a>${FF.auth.can('export') ? '<button class="btn small" id="da-csv">⬇ CSV</button>' : ''}</div></div>
      <div class="direct-rule-grid">
        ${ruleCard('🟩', 'GV Partner direct rule', `TL ID + TL Name dono khaali (+ self-supervised / placeholder)`, byCh.gv.length, 'Example: agent ke row me supervisor columns blank hain — wo apna hi kaam karta hai, kisi TL ka part nahi.')}
        ${ruleCard('🟦', 'First Forward direct rule', `TL Name <b>${esc((d.ffTlNames || ['APS']).join(', '))}</b> (ya excluded TL naam)`, byCh.ff.length, 'Example: FF REPORT me TL Name “APS” — ye asli TL nahi, direct agent ka placeholder hai.')}
        <div class="direct-rule-card"><div class="direct-rule-head"><span>⚙️</span><b>Effective settings</b><small>live</small></div><p>Direct agents: <b>TL lists me nahi</b> · <b>stock dispatch ${d.dispatchExempt === false ? 'allowed' : 'exempt'}</b> · <b>High/Medium = 🏷️ tag required</b> · labels site-wide same</p><p class="dim small">Rule badalna ho to Settings → 🧍 Direct Agents. Iske baad har page (GV Stock Report dispatch, Dispatch Planner, Performance, Stock, Network, Search) wahi rule use karta hai.</p></div>
      </div>
      <div class="metric-grid">${kpi('Direct agents', U.fmt(rows.length), `${U.fmt(byCh.gv.length)} GV · ${U.fmt(byCh.ff.length)} FF`, 'g7')}${kpi('GV direct (no TL)', U.fmt(byCh.gv.length), `${U.fmt(U.sum(byCh.gv, (r) => r.stock))} tags stock`, 'g9')}${kpi('FF direct (APS)', U.fmt(byCh.ff.length), `${U.fmt(U.sum(byCh.ff, (r) => r.issued))} MTD issued`, 'g1')}${kpi('🏷️ Tag required', U.fmt(tagRows.length), `High/Medium priority · ${U.fmt(tagRows.filter((r) => r.ch === 'gv').length)} GV · ${U.fmt(tagRows.filter((r) => r.ch === 'ff').length)} FF · <b>${U.fmt(U.sum(tagRows, (r) => r.suggested))}</b> tags (stock −) · w/o stock <b>${U.fmt(U.sum(tagRows, (r) => r.suggestedGross || 0))}</b>`, 'g5')}</div>
      <section class="card"><div class="card-head"><h3>🧍 Direct agent roster <span class="dim">${U.fmt(filtered.length)} / ${U.fmt(rows.length)}</span></h3><div class="card-right">${FF.auth.can('export') ? '<button class="btn small" id="da-csv2">⬇ CSV</button>' : ''}</div></div>
        <div class="card-body">
          <div class="dispatch-filter-bar"><span><b>Filter:</b> Direct agents ko stock dispatch nahi — par <b>High/Medium priority</b> waalon ko <b>TAG chahiye</b> (alag option)</span>${filterButtons({ current: scope, counts: cnt, attr: 'da-scope', gv: byCh.gv.length, ff: byCh.ff.length })}</div>
          <form id="da-search" class="ins-search" style="margin:10px 0"><input class="input" name="q" value="${esc(p.q || '')}" placeholder="Agent, ID, TL naam ya reason…"><button class="btn">Search</button></form>
          <div class="table-wrap tall"><table class="tbl compact"><thead><tr>${PAGE_HEADERS.map((h, i) => `<th class="${(i >= 5 && i <= 6) || i === 10 ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${filtered.length ? filtered.map((r) => `<tr class="direct-row" data-link="${esc(r.route || '#/directAgents')}"><td><span class="tag ${r.ch === 'gv' ? 'ok' : 'info'}">${r.ch === 'gv' ? '🟩 GV' : '🟦 FF'}</span></td><td><b>${esc(r.name)}</b></td><td class="mono">${esc(r.id || '—')}</td><td><span class="direct-chip">🚫 ${esc(r.reason)}</span></td><td class="dim">no TL (direct)</td><td class="num">${U.fmt(r.stock)}</td><td class="num">${U.fmt(r.issued)}</td><td>${esc(r.status || '—')}</td><td>${esc(r.priority || '—')}</td><td>${isHighMedium(r.priority) ? '<span class="tag warn">🏷️ Tag required</span>' : '<span class="tag ok">No dispatch</span>'}</td><td class="num">${isHighMedium(r.priority) ? U.sugCell(r.suggested, r.suggestedGross || 0, 'direct') : '<span class="dim">—</span>'}</td></tr>`).join('') : `<tr><td colspan="${PAGE_HEADERS.length}" class="dim">Koi direct agent nahi mila — filter badlo ya data load hone do.</td></tr>`}</tbody></table></div>
          <p class="dim small">🚫 Direct agents = jinke paas asli TL nahi. Ye TL ranking / TL table / network graph me kabhi nahi aate; inko stock dispatch bhi nahi jaata (GV Stock Report “Need stock” list se hat jate hain).</p>
        </div>
      </section>`;
    const csv = () => U.downloadCsv(`direct-agents-${U.stamp()}.csv`, PAGE_HEADERS, filtered.map((r) => [r.channel, r.name, r.id, r.reason, 'Direct (no TL)', r.stock, r.issued, r.status, r.priority, isHighMedium(r.priority) ? 'Tag required' : 'No dispatch', isHighMedium(r.priority) ? `${r.suggested} (stock−) · ${r.suggestedGross || 0} (w/o stock)` : '']));
    const b1 = U.$('#da-csv', root), b2 = U.$('#da-csv2', root);
    if (b1) b1.addEventListener('click', csv);
    if (b2) b2.addEventListener('click', csv);
    U.$$('[data-da-scope]', root).forEach((b) => b.addEventListener('click', () => FF.app.updateParams({ direct: b.dataset.daScope === 'all' ? '' : b.dataset.daScope })));
    const form = U.$('#da-search', root);
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(form).get('q') || '' }); });
  }

  FF.direct = { rules, channelOf, isDirect, isRealTl, isHighMedium, tagRequired, suggestQty, suggestGrossQty, label, reason, filterButtons, counts, split, ruleBanner, roster, render, PAGE_HEADERS };
  FF.pages.directAgents = { title: 'Direct Agents & TLs', render };
})(FF);
