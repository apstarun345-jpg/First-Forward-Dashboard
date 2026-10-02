/* 🔎 SEARCH REPORT (v3.41) — Home / Master Search me naam search karne par "poori kundli" ek jagah.
   Pehle: ek naam par FF aur GV ke alag-alag kundli cards aate the, aur poori report sirf tab khulti thi jab
   result me EXACTLY ek person hota. Ab:

     • Same naam (FF + GV) = ek group — upar channel toggle:  [⚖ FF + GV]  [🟦 First Forward]  [🟩 GV Partner]
     • ⚖ FF + GV  : last month · current month · stock (own / agents / TL total) · class-wise — FF, GV aur jod
                    side-by-side. Har FF / GV number clickable → drawer → class → din → tag / barcode row.
     • 🟦 / 🟩     : us channel ki poori profile (FF.masterProfile) — KPI, last vs current, class-wise, TL ke agents
                    (stock + last + current, VC4 / Comm / Total), Agent × Class stock, charts.
     • Kai alag log match hon to har card par "📂 Yahin poori report" — card ke neeche inline khulti hai.

   Hisaab / numbers 100 % masterProfile ke hain (ek hi source of truth) — yahan sirf layout aur channel merge hai. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const fmt = (n, d) => U.fmt(n, d);
  const num = (v) => Number(v) || 0;
  const MP = () => (FF.masterProfile && FF.masterProfile.supports ? FF.masterProfile : null);
  const normName = (v) => U.clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const isTlKind = (k) => /tl$/.test(String(k || ''));
  const chOf = (kind) => (/^gv/.test(String(kind || '')) ? 'gv' : 'ff');
  const CH = { ff: { icon: '🟦', label: 'First Forward' }, gv: { icon: '🟩', label: 'GV Partner' } };
  const roleOf = (kind) => (isTlKind(kind) ? 'TL' : 'Agent');
  const monthLabel = (ym) => { try { return U.labelYM(ym); } catch { return String(ym || ''); } };

  /** Matched people → groups (ek naam = ek group). Har channel me TL kind agent kind par jeetta hai
   *  (sheet me TL ki apni row \"agent\" ban kar aati hai — wo alag insaan nahi). */
  function groupPeople(people) {
    const map = new Map();
    (people || []).forEach((p) => {
      if (!p || !MP() || !MP().supports(p)) return;
      const key = normName(p.name);
      if (!key) return;
      const g = map.get(key) || { key, name: p.name, ff: null, gv: null };
      const ch = chOf(p.kind);
      if (!g[ch] || (isTlKind(p.kind) && !isTlKind(g[ch].kind))) g[ch] = p;
      map.set(key, g);
    });
    return [...map.values()];
  }
  const groupKey = (g) => g.key;
  const channelsOf = (g) => ['ff', 'gv'].filter((c) => g[c]);

  // ------------------------------------------------------------------ combined (FF + GV) view
  const scopeOf = (pr) => (isTlKind(pr.kind) ? `tl=${encodeURIComponent(pr.name)}` : `agent=${encodeURIComponent(pr.name)}${pr.id ? `&agentId=${encodeURIComponent(pr.id)}` : ''}`);
  const specOf = (pr, scope, extra) => {
    const m = pr.months || {};
    const base = scope === 'mtd' ? `src=${pr.ch}&scope=mtd&ym=${encodeURIComponent(m.cur || '')}`
      : scope === 'month' ? `src=${pr.ch}&scope=month&ym=${encodeURIComponent(m.last || '')}`
        : `src=${pr.ch}&scope=stock`;
    return `${base}&${scopeOf(pr)}${extra || ''}`;
  };
  const cellHtml = (value, spec, title) => (spec
    ? `<td class="num sr-drill" data-kpi="${esc(spec)}" role="button" tabindex="0" title="${esc(title || 'Detail kholo')}">${fmt(value)}</td>`
    : `<td class="num">${fmt(value)}</td>`);
  const sumCell = (a, b) => `<td class="num sr-sum"><b>${fmt(num(a) + num(b))}</b></td>`;
  const missCell = '<td class="num dim" title="Is channel me ye naam nahi mila">—</td>';

  /** ek metric row: ff / gv numbers (clickable) + jod. `get(pr)` → number · `spec(pr)` → drill spec. */
  function metricRow(label, prs, get, spec, opts) {
    const o = opts || {};
    const f = prs.ff, g = prs.gv;
    const fv = f ? num(get(f)) : 0, gvv = g ? num(get(g)) : 0;
    const f1 = f ? cellHtml(fv, spec ? spec(f) : '', `${CH.ff.label} · ${label}`) : missCell;
    const g1 = g ? cellHtml(gvv, spec ? spec(g) : '', `${CH.gv.label} · ${label}`) : missCell;
    return `<tr${o.cls ? ` class="${o.cls}"` : ''}><td>${o.indent ? '<span class="sr-ind"></span>' : ''}${o.strong ? `<b>${label}</b>` : label}</td>${f1}${g1}${sumCell(fv, gvv)}</tr>`;
  }
  function sectionRow(text) { return `<tr class="sr-sec"><td colspan="4">${text}</td></tr>`; }

  function classMapOf(pr) {
    const m = new Map();
    (pr && pr.classes || []).forEach((c) => m.set(String(c.cls).toUpperCase(), c));
    return m;
  }
  const clsRank = (c) => { const n = parseInt(String(c).replace(/\D/g, ''), 10); return /^VC4$/i.test(c) ? 4 : Number.isFinite(n) ? n : 999; };

  function combinedHtml(g, prs) {
    const f = prs.ff, v = prs.gv;
    const any = f || v;
    if (!any) return '<div class="ms-empty small"><b>Dono channel me data nahi mila</b></div>';
    const mf = (f && f.months) || {}, mg = (v && v.months) || {};
    const lastLbl = [f ? `${CH.ff.icon} ${monthLabel(mf.last)}` : '', v ? `${CH.gv.icon} ${monthLabel(mg.last)}` : ''].filter(Boolean).join(' · ');
    const curLbl = [f ? `${CH.ff.icon} ${monthLabel(mf.cur)}` : '', v ? `${CH.gv.icon} ${monthLabel(mg.cur)}` : ''].filter(Boolean).join(' · ');
    const T = (pr, k) => num((pr.totals || {})[k]);
    const S = (pr, k) => num((pr.stock || {})[k]);
    const hasTlStock = (pr) => pr.tlStock && (pr.tlStock.has || isTlKind(pr.kind));
    const tlSpec = (pr, part) => (isTlKind(pr.kind) ? `src=${pr.ch}&scope=stock&tl=${encodeURIComponent(pr.name)}${part ? `&part=${part}` : ''}`
      : (pr.tl && pr.tl.name ? `src=${pr.ch}&scope=stock&tl=${encodeURIComponent(pr.tl.name)}${part ? `&part=${part}` : ''}` : ''));
    const rows = [];
    // 1) Last month
    rows.push(sectionRow(`⏮ <b>Last month</b> <span class="dim small">${esc(lastLbl)}</span>`));
    rows.push(metricRow('VC4', prs, (p) => T(p, 'lastVc4'), (p) => specOf(p, 'month', '&group=VC4'), { indent: true }));
    rows.push(metricRow('Commercial', prs, (p) => T(p, 'lastComm'), (p) => specOf(p, 'month', '&group=COMM'), { indent: true }));
    rows.push(metricRow('Total issued', prs, (p) => T(p, 'lastTotal'), (p) => specOf(p, 'month'), { strong: true, cls: 'row-total' }));
    // 2) Current month
    rows.push(sectionRow(`▶ <b>Current month (MTD)</b> <span class="dim small">${esc(curLbl)}</span>`));
    rows.push(metricRow('VC4', prs, (p) => T(p, 'curVc4'), (p) => specOf(p, 'mtd', '&group=VC4'), { indent: true }));
    rows.push(metricRow('Commercial', prs, (p) => T(p, 'curComm'), (p) => specOf(p, 'mtd', '&group=COMM'), { indent: true }));
    rows.push(metricRow('Total issued', prs, (p) => T(p, 'curTotal'), (p) => specOf(p, 'mtd'), { strong: true, cls: 'row-total' }));
    // growth
    const gr = (pr) => (T(pr, 'lastTotal') ? ((T(pr, 'curTotal') - T(pr, 'lastTotal')) / T(pr, 'lastTotal')) * 100 : null);
    const grAll = (T(f || {}, 'lastTotal') + T(v || {}, 'lastTotal')) ? (((T(f || {}, 'curTotal') + T(v || {}, 'curTotal')) - (T(f || {}, 'lastTotal') + T(v || {}, 'lastTotal'))) / (T(f || {}, 'lastTotal') + T(v || {}, 'lastTotal'))) * 100 : null;
    rows.push(`<tr><td>Growth (MTD vs last month)</td><td class="num">${f && gr(f) != null ? U.pctHtml(gr(f)) : '—'}</td><td class="num">${v && gr(v) != null ? U.pctHtml(gr(v)) : '—'}</td><td class="num sr-sum">${grAll != null ? U.pctHtml(grAll) : '—'}</td></tr>`);
    // 3) Stock
    rows.push(sectionRow('📦 <b>Stock in hand</b>'));
    rows.push(metricRow('VC4', prs, (p) => S(p, 'vc4'), (p) => specOf(p, 'stock', '&f=vc4'), { indent: true }));
    rows.push(metricRow('Commercial', prs, (p) => S(p, 'comm'), (p) => specOf(p, 'stock', '&f=comm'), { indent: true }));
    rows.push(metricRow(`${[f, v].some((p) => p && isTlKind(p.kind)) ? 'TL stock (own + agents)' : 'Agent stock'}`, prs, (p) => S(p, 'total'), (p) => specOf(p, 'stock'), { strong: true, cls: 'row-total' }));
    const tlRows = [f, v].some((p) => p && hasTlStock(p) && p.tlStock.own && p.tlStock.agents);
    if (tlRows) {
      const okTl = (p) => (p && hasTlStock(p) && p.tlStock.own && p.tlStock.agents ? p : null);
      const tl = { ff: okTl(f), gv: okTl(v) };
      rows.push(metricRow('👤 TL ke paas (own)', tl, (p) => p.tlStock.own.total, (p) => tlSpec(p, 'own'), { indent: true }));
      rows.push(metricRow('🧑‍💼 Agents ke paas', tl, (p) => p.tlStock.agents.total, (p) => tlSpec(p, 'team'), { indent: true }));
      rows.push(metricRow('= TL total (own + agents)', tl, (p) => p.tlStock.total, (p) => tlSpec(p, ''), { indent: true, cls: 'row-total' }));
    }
    // 4) Team
    if ([f, v].some((p) => p && isTlKind(p.kind))) {
      rows.push(sectionRow('🧑‍💼 <b>Team</b>'));
      rows.push(metricRow('Agents (TL ko chhod kar)', { ff: f && isTlKind(f.kind) ? f : null, gv: v && isTlKind(v.kind) ? v : null }, (p) => p.agentCount, (p) => `src=${p.ch}&scope=people&tl=${encodeURIComponent(p.name)}&self=0&sort=stock`, { indent: true }));
    }
    const mainTable = `<div class="table-wrap"><table class="tbl compact sr-tbl"><thead><tr><th>Metric</th><th class="num">${f ? `${CH.ff.icon} FF <small class="dim">${roleOf(f.kind)}</small>` : `${CH.ff.icon} FF`}</th><th class="num">${v ? `${CH.gv.icon} GV <small class="dim">${roleOf(v.kind)}</small>` : `${CH.gv.icon} GV`}</th><th class="num">⚖ FF + GV</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

    // 5) Class-wise (union)
    const cf = classMapOf(f), cg = classMapOf(v);
    const classes = [...new Set([...cf.keys(), ...cg.keys()])].sort((a, b) => clsRank(a) - clsRank(b) || a.localeCompare(b));
    const val = (map, c, k) => (map.get(c) ? num(map.get(c)[k]) : 0);
    const classCell = (pr, map, c, k, which) => {
      if (!pr) return missCell;
      const n = val(map, c, k);
      if (!n) return '<td class="num dim">·</td>';
      const scope = which === 'stock' ? 'stock' : which;
      return cellHtml(n, specOf(pr, scope, `&cls=${encodeURIComponent(c)}`), `${pr.channel} · ${c}`);
    };
    const classBody = classes.map((c) => `<tr><td><b>${esc(c)}</b></td>${classCell(f, cf, c, 'last', 'month')}${classCell(v, cg, c, 'last', 'month')}${classCell(f, cf, c, 'cur', 'mtd')}${classCell(v, cg, c, 'cur', 'mtd')}${classCell(f, cf, c, 'stock', 'stock')}${classCell(v, cg, c, 'stock', 'stock')}<td class="num sr-sum"><b>${fmt(val(cf, c, 'stock') + val(cg, c, 'stock'))}</b></td></tr>`).join('');
    const colSum = (map, k) => U.sum(classes, (c) => val(map, c, k));
    const classFoot = `<tr class="row-total"><td>Total</td><td class="num">${fmt(colSum(cf, 'last'))}</td><td class="num">${fmt(colSum(cg, 'last'))}</td><td class="num">${fmt(colSum(cf, 'cur'))}</td><td class="num">${fmt(colSum(cg, 'cur'))}</td><td class="num">${fmt(colSum(cf, 'stock'))}</td><td class="num">${fmt(colSum(cg, 'stock'))}</td><td class="num sr-sum"><b>${fmt(colSum(cf, 'stock') + colSum(cg, 'stock'))}</b></td></tr>`;
    const classTable = classes.length
      ? `<div class="table-wrap"><table class="tbl compact sr-tbl"><thead><tr><th rowspan="2">Class</th><th colspan="2" class="num">⏮ Last month</th><th colspan="2" class="num">▶ Current</th><th colspan="3" class="num">📦 Stock</th></tr><tr><th class="num">${CH.ff.icon} FF</th><th class="num">${CH.gv.icon} GV</th><th class="num">${CH.ff.icon} FF</th><th class="num">${CH.gv.icon} GV</th><th class="num">${CH.ff.icon} FF</th><th class="num">${CH.gv.icon} GV</th><th class="num">⚖ Total</th></tr></thead><tbody>${classBody}</tbody><tfoot>${classFoot}</tfoot></table></div>`
      : '<p class="dim small">Class-wise data abhi load nahi hua.</p>';

    const open = (c) => (prs[c] ? `<button type="button" class="btn small" data-sr-open="${c}">${CH[c].icon} ${CH[c].label} — poori report 👉</button>` : '');
    const partial = [f, v].some((p) => p && p.partial) ? '<div class="mp-partial dim small" role="status">⏳ Kuch data abhi load ho raha hai — numbers poore hote hi apne aap update ho jayenge.</div>' : '';
    return `<div class="sr-combined">${partial}
      <p class="dim small">Har <b>FF / GV number par click</b> karo → drawer → class → din → tag / barcode row (issuance ki poori detail). ⚖ jod sirf dono channel ka total hai.</p>
      ${mainTable}
      <h4 class="sr-h">🎯 Class-wise — last month · current · stock</h4>${classTable}
      <div class="sr-open-row">${open('ff')}${open('gv')}</div></div>`;
  }

  // ------------------------------------------------------------------ the component
  const loadingHtml = (name) => `<div class="mp-loading" role="status" aria-live="polite">${U.loader ? U.loader('', { size: 'md' }) : ''} <span><b>${esc(name)}</b> ka FF + GV hisaab ban raha hai${U.ellipsis ? U.ellipsis() : '…'}</span></div>`;

  async function fillCombined(pane, g) {
    const chans = channelsOf(g);
    pane.innerHTML = loadingHtml(g.name);
    const prs = { ff: null, gv: null };
    const paint = () => { if (pane.isConnected !== false) pane.innerHTML = combinedHtml(g, prs); };
    try {
      await Promise.all(chans.map(async (c) => {
        prs[c] = await MP()._buildSoon(g[c], (late) => { prs[c] = late; paint(); });
      }));
      paint();
    } catch (err) {
      pane.innerHTML = `<div class="ms-empty small"><b>FF + GV report nahi ban payi</b><p class="dim">${esc(err && err.message || err)}</p></div>`;
    }
  }

  /** `slot` me group ki poori report (channel toggle ke saath) render karo. */
  function render(slot, g) {
    if (!slot || !g) return null;
    const chans = channelsOf(g);
    if (!chans.length) return null;
    const tabs = chans.length > 1 ? ['both', ...chans] : [chans[0]];
    const tabLabel = (t) => (t === 'both' ? '⚖ FF + GV' : `${CH[t].icon} ${CH[t].label} <small>${roleOf(g[t].kind)}</small>`);
    const sub = chans.map((c) => `${CH[c].icon} ${CH[c].label} · ${roleOf(g[c].kind)}${g[c].sub ? ` ${esc(g[c].sub)}` : ''}`).join('  |  ');
    slot.innerHTML = `<div class="sr" data-sr-key="${esc(groupKey(g))}">
      <div class="sr-head"><span class="ms-avatar">${esc(String(g.name).slice(0, 1).toUpperCase())}</span><div class="sr-id"><b>${esc(g.name)}</b><small>${sub}</small></div></div>
      <div class="sr-tabs" role="tablist" aria-label="Channel">${tabs.map((t) => `<button type="button" role="tab" class="sr-tab" data-sr-tab="${t}">${tabLabel(t)}</button>`).join('')}</div>
      ${tabs.map((t) => `<div class="sr-pane" data-sr-pane="${t}" role="tabpanel" hidden></div>`).join('')}
    </div>`;
    const root = slot.querySelector('.sr');
    const show = (t) => {
      root.querySelectorAll('.sr-tab').forEach((b) => { const on = b.dataset.srTab === t; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      root.querySelectorAll('.sr-pane').forEach((p) => { p.hidden = p.dataset.srPane !== t; });
      const pane = root.querySelector(`.sr-pane[data-sr-pane="${t}"]`);
      if (pane && !pane.dataset.ready) {
        pane.dataset.ready = '1';
        if (t === 'both') fillCombined(pane, g);
        else MP().renderInto(pane, g[t]);
      }
    };
    root.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-sr-tab]');
      if (tab) { show(tab.dataset.srTab); return; }
      const open = e.target.closest('[data-sr-open]');
      if (open) { show(open.dataset.srOpen); root.scrollIntoView && root.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
    show(tabs[0]);
    return { show };
  }

  FF.searchReport = { groupPeople, render, combinedHtml, groupKey, channelsOf };
})(window.FF);
