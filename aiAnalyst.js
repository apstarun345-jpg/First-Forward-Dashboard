/* 🧠 AI Business Analyst — GV + FF ka poora business review ek page par.
   Rule-based analyst (koi bahari API nahi): growth kiski wajah se, kaun down, kaun gaya / naya aaya,
   class mix, momentum, stock cover, concentration aur "ab kya karein" list — sab live sheet data se.
   Compare basis: current month ka run-rate (MTD ÷ din × mahine ke din) vs pichhla poora mahina. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;
  const clean = (v) => U.clean(v);
  const norm = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const fmt = (n) => U.fmt(Math.round(Number(n) || 0));
  const sgn = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
  const pct = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
  const pctTxt = (p) => (p === null ? 'new' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(0) + '%');
  const tone = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
  const CH = { ff: { label: 'First Forward', icon: '🟦', color: '#6366f1' }, gv: { label: 'GV Partner', icon: '🟩', color: '#0d9488' } };

  // ---------------------------------------------------------------- analysis core
  function peopleFromFf(agents, cur, last) {
    const map = new Map();
    (agents || []).filter((r) => r.channel !== 'GV Partner' && (r.ym === cur || r.ym === last)).forEach((r) => {
      const key = clean(r.id) ? 'I' + norm(r.id) : 'N' + norm(r.name);
      if (!map.has(key)) map.set(key, { key, name: r.name, id: clean(r.id), tl: '', cur: 0, last: 0, tlCurN: 0 });
      const o = map.get(key);
      if (r.ym === cur) { o.cur += r.n; if (r.n >= o.tlCurN) { o.tlCurN = r.n; o.tl = r.tlName; } } else { o.last += r.n; if (!o.tl) o.tl = r.tlName; }
    });
    return [...map.values()].map((o) => ({ ...o, direct: FF.config.isDirectAgent ? !!FF.config.isDirectAgent({ tlName: o.tl, name: o.name, agentName: o.name }, 'ff') : false }));
  }
  function peopleFromGv(cur, last) {
    const map = new Map();
    const add = (list, f) => (list || []).forEach((a) => {
      const key = clean(a.agentId) ? 'I' + norm(a.agentId) : 'N' + norm(a.agentName);
      if (!map.has(key)) map.set(key, { key, name: a.agentName, id: clean(a.agentId), tl: a.tlName || '', cur: 0, last: 0, direct: !!a.directAgent });
      const o = map.get(key); o[f] += a.total || 0; if (f === 'cur' && a.tlName) o.tl = a.tlName; if (!o.tl && a.tlName) o.tl = a.tlName;
    });
    add(G.agentRollup(cur), 'cur'); add(G.agentRollup(last), 'last');
    return [...map.values()];
  }
  function drivers(people, day, dimCur) {
    // proj = current run-rate (MTD ÷ din × mahine ke din); delta = proj − pichhla poora mahina
    const rows = people.map((p) => {
      const proj = day ? (p.cur / day) * dimCur : p.cur;
      const delta = proj - p.last;
      const kind = p.cur === 0 && p.last > 0 ? 'lost' : p.last === 0 && p.cur > 0 ? 'new' : 'regular';
      return { ...p, proj, delta, kind, growth: pct(proj, p.last) };
    });
    const net = rows.reduce((s, r) => s + r.delta, 0);
    return { rows, net,
      up: rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta),
      down: rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta),
      lost: rows.filter((r) => r.kind === 'lost').sort((a, b) => b.last - a.last),
      fresh: rows.filter((r) => r.kind === 'new').sort((a, b) => b.cur - a.cur) };
  }
  function tlRoll(rows) {
    const map = new Map();
    rows.forEach((r) => {
      if (r.direct) return;
      const k = clean(r.tl) || 'Unknown TL';
      if (!map.has(k)) map.set(k, { name: k, cur: 0, last: 0, proj: 0, delta: 0, agents: 0, active: 0 });
      const t = map.get(k); t.cur += r.cur; t.last += r.last; t.proj += r.proj; t.delta += r.delta; t.agents++; if (r.cur > 0) t.active++;
    });
    return [...map.values()].map((t) => ({ ...t, growth: pct(t.proj, t.last) }));
  }
  function concentration(rows, total) {
    const sorted = rows.filter((r) => r.cur > 0).sort((a, b) => b.cur - a.cur);
    const top5 = sorted.slice(0, 5).reduce((s, r) => s + r.cur, 0);
    let run = 0, n80 = 0; for (const r of sorted) { run += r.cur; n80++; if (run >= total * 0.8) break; }
    return { top5Share: total ? (top5 / total) * 100 : 0, n80, active: sorted.length, top: sorted.slice(0, 5) };
  }
  function momentum(lastTotals, curTotals, day) {
    const series = [...(lastTotals || []), ...(curTotals || []).slice(0, day)];
    const a = series.slice(-7), b = series.slice(-14, -7);
    const s = (x) => x.reduce((t, v) => t + (v || 0), 0);
    return { week: s(a), prev: s(b), growth: pct(s(a), s(b)), hasPrev: b.length >= 7 };
  }

  async function analyse() {
    const [dailyR, agentsR, stockR, masterR, gvStockR] = await Promise.allSettled([S.need('daily'), S.need('agents'), S.need('stock'), G.need('master'), G.need('stockClass')]);
    const out = { errors: [] };
    const ffDaily = dailyR.status === 'fulfilled' ? dailyR.value.filter((r) => r.channel !== 'GV Partner') : null;
    if (dailyR.status !== 'fulfilled') out.errors.push('First Forward EIR data load nahi hua');
    if (masterR.status !== 'fulfilled') out.errors.push('GV Master data load nahi hua');
    const gvOk = masterR.status === 'fulfilled';
    const agents = agentsR.status === 'fulfilled' ? agentsR.value : [];
    const ffLatest = ffDaily ? M.latestDate(ffDaily) : null, gvLatest = gvOk ? G.latestDate() : null;
    const latest = ffLatest && gvLatest ? (ffLatest > gvLatest ? ffLatest : gvLatest) : (ffLatest || gvLatest);
    if (!latest) return { ...out, empty: true };
    out.latest = latest; out.cur = U.ymKey(latest); out.last = U.prevMonthKey(out.cur);
    out.day = latest.getDate(); out.dimCur = U.daysInMonth(out.cur); out.dimLast = U.daysInMonth(out.last);
    out.channels = {};
    const stocks = { ff: U.sum(stockR.status === 'fulfilled' ? stockR.value : [], (r) => r.n), gv: U.sum(gvStockR.status === 'fulfilled' ? gvStockR.value : [], (r) => r.n) };
    const build = (ch) => {
      const isFf = ch === 'ff';
      if (isFf ? !ffDaily : !gvOk) return null;
      const sum = (ym, d) => (isFf ? M.summary(ffDaily, ym, d) : G.summary(ym, d));
      const cur = sum(out.cur), last = sum(out.last), lastMtd = sum(out.last, out.day);
      const people = isFf ? peopleFromFf(agents, out.cur, out.last) : peopleFromGv(out.cur, out.last);
      const d = drivers(people, out.day, out.dimCur);
      const proj = out.day ? (cur.total / out.day) * out.dimCur : cur.total;
      const ser = (ym) => (isFf ? M.dailySeries(ffDaily, ym) : G.dailySeries(ym));
      let mo = { week: 0, prev: 0, growth: null, hasPrev: false };
      try { mo = momentum(ser(out.last).totals, ser(out.cur).totals, out.day); } catch { /* ignore */ }
      const avg = cur.activeDays ? cur.total / cur.activeDays : 0;
      return { ch, cur, last, lastMtd, proj, projGrowth: pct(proj, last.total), mtdGrowth: pct(cur.total, lastMtd.total), d,
        tls: tlRoll(d.rows), conc: concentration(d.rows, cur.total), mo, stock: stocks[ch], cover: avg ? stocks[ch] / avg : 0, avg,
        vc4Share: cur.total ? (cur.vc4 / cur.total) * 100 : 0, vc4ShareLast: last.total ? (last.vc4 / last.total) * 100 : 0,
        replShare: cur.total ? (cur.replacement / cur.total) * 100 : 0, wrongShare: cur.total ? (cur.wrongVrn / cur.total) * 100 : 0 };
    };
    out.channels.ff = build('ff'); out.channels.gv = build('gv');
    return out;
  }

  // ---------------------------------------------------------------- narrative
  const healthOf = (g) => (g === null ? ['Naya', 'flat'] : g >= 5 ? ['Growing', 'up'] : g <= -5 ? ['Declining', 'down'] : ['Stable', 'flat']);
  function narrative(a) {
    const lines = [], actions = [];
    const ff = a.channels.ff, gv = a.channels.gv, all = [ff, gv].filter(Boolean);
    const lastLbl = U.labelYM(a.last), curLbl = U.labelYM(a.cur);
    const totalCur = all.reduce((s, c) => s + c.cur.total, 0), totalProj = all.reduce((s, c) => s + c.proj, 0), totalLast = all.reduce((s, c) => s + c.last.total, 0);
    const g = pct(totalProj, totalLast);
    lines.push({ k: g === null || g >= 0 ? 'up' : 'down', t: `<b>Overall:</b> ${curLbl} ab tak <b>${fmt(totalCur)}</b> tags (${a.day} din). Isi raftaar se month-end <b>~${fmt(totalProj)}</b> — ${lastLbl} ke <b>${fmt(totalLast)}</b> se <b>${pctTxt(g)}</b>.` });
    if (ff && gv) {
      const dFf = ff.proj - ff.last.total, dGv = gv.proj - gv.last.total, net = dFf + dGv;
      const lead = Math.abs(dFf) >= Math.abs(dGv) ? ['First Forward', dFf] : ['GV Partner', dGv];
      lines.push({ k: net >= 0 ? 'up' : 'down', t: `<b>Kiski wajah se ${net >= 0 ? 'growth' : 'girawat'}:</b> FF ${sgn(dFf)} aur GV ${sgn(dGv)} tags (projected vs ${lastLbl}). Sabse bada asar <b>${lead[0]}</b> ka hai (${sgn(lead[1])}).` });
    }
    all.forEach((c) => {
      const L = CH[c.ch].label, [h] = healthOf(c.projGrowth);
      const topUp = c.d.up[0], topDown = c.d.down[0];
      lines.push({ k: tone(c.projGrowth || 0), t: `<b>${CH[c.ch].icon} ${L} — ${h}:</b> projected ${fmt(c.proj)} vs ${fmt(c.last.total)} (${pctTxt(c.projGrowth)}). ${topUp ? `Growth me sabse aage <b>${esc(topUp.name)}</b> (${sgn(topUp.delta)}). ` : ''}${topDown ? `Sabse zyada gira <b>${esc(topDown.name)}</b> (${sgn(topDown.delta)}).` : ''}` });
      if (c.d.lost.length) {
        const lostTags = c.d.lost.reduce((s, r) => s + r.last, 0);
        lines.push({ k: 'down', t: `<b>${L}:</b> ${fmt(c.d.lost.length)} agents jo ${lastLbl} me chal rahe the is mahine <b>zero</b> hain (pichhle mahine ${fmt(lostTags)} tags).` });
        actions.push(`${L}: ${fmt(c.d.lost.length)} zero-activity agents ko call karo — pehle top 5: ${c.d.lost.slice(0, 5).map((r) => esc(r.name)).join(', ')}.`);
      }
      if (c.mo.hasPrev && c.mo.growth !== null && Math.abs(c.mo.growth) >= 10) {
        lines.push({ k: tone(c.mo.growth), t: `<b>${L} momentum:</b> pichhle 7 din ${fmt(c.mo.week)} tags vs usse pehle ke 7 din ${fmt(c.mo.prev)} (${pctTxt(c.mo.growth)}).` });
        if (c.mo.growth <= -10) actions.push(`${L}: haftawar raftaar ${pctTxt(c.mo.growth)} gir rahi hai — top decliner agents/TLs se isi hafte baat karo.`);
      }
      if (c.conc.top5Share >= 50) actions.push(`${L}: top 5 agents hi ${c.conc.top5Share.toFixed(0)}% issuance de rahe hain — dependency risk, mid-level agents ko push karo.`);
      if (c.cover && c.cover < 7) actions.push(`${L}: stock cover sirf ${c.cover.toFixed(0)} din — dispatch jaldi plan karo (Dispatch Planner).`);
      else if (c.cover && c.cover > 60) actions.push(`${L}: stock cover ${c.cover.toFixed(0)} din (bahut zyada) — idle stock wale agents/TLs se redistribute karo.`);
      if (c.vc4Share < c.vc4ShareLast - 3) actions.push(`${L}: VC4 mix ${c.vc4ShareLast.toFixed(0)}% → ${c.vc4Share.toFixed(0)}% gira — payable class par focus badhao.`);
      if (c.wrongShare >= 3) actions.push(`${L}: Wrong-VRN ${c.wrongShare.toFixed(1)}% hai — Unusual Activity page me flagged agents dekho.`);
    });
    if (!actions.length) actions.push('Koi bada risk nahi dikha — current raftaar banaye rakho.');
    return { lines, actions, totalCur, totalProj, totalLast, g };
  }

  // ---------------------------------------------------------------- UI helpers
  const chip = (g) => { const [t, k] = healthOf(g); return `<span class="aa-chip ${k}">${t}</span>`; };
  const delta = (n) => `<b class="aa-d ${tone(n)}">${sgn(n)}</b>`;
  const gcell = (p) => `<span class="aa-d ${p === null ? 'flat' : tone(p)}">${pctTxt(p)}</span>`;
  const personLink = (r, ch) => `<a href="#/${ch === 'gv' ? 'gvPerformance' : 'performance'}?q=${encodeURIComponent(r.name || r.id)}"><b>${esc(r.name || r.id || '—')}</b></a>${r.id ? `<small class="cell-sub">${esc(r.id)}</small>` : ''}`;

  function driverTable(list, ch, mode) {
    if (!list.length) return '<div class="empty-state compact">Is list me koi nahi.</div>';
    const rows = list.slice(0, 12).map((r) => `<tr><td>${personLink(r, ch)}</td><td>${esc(r.direct ? 'Direct' : (clean(r.tl) || '—'))}</td><td class="num">${fmt(r.last)}</td><td class="num">${fmt(r.cur)}</td><td class="num">${fmt(r.proj)}</td><td class="num">${delta(r.delta)}</td><td class="num">${mode === 'lost' ? '<span class="aa-d down">zero</span>' : gcell(r.growth)}</td></tr>`).join('');
    return `<div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Agent</th><th>TL</th><th class="num">Pichhla mahina</th><th class="num">Ab tak</th><th class="num">Projected</th><th class="num">Change</th><th class="num">%</th></tr></thead><tbody>${rows}</tbody></table></div>${list.length > 12 ? `<p class="dim small">Top 12 dikhe · ${fmt(list.length)} total — poori list CSV me.</p>` : ''}`;
  }
  function tlTable(tls, which) {
    const list = tls.filter((t) => (which === 'up' ? t.delta > 0 : t.delta < 0)).sort((a, b) => which === 'up' ? b.delta - a.delta : a.delta - b.delta).slice(0, 8);
    if (!list.length) return '<div class="empty-state compact">Koi TL nahi.</div>';
    return `<div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>TL</th><th class="num">Active / Agents</th><th class="num">Pichhla</th><th class="num">Projected</th><th class="num">Change</th><th class="num">%</th></tr></thead><tbody>${list.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td class="num">${t.active}/${t.agents}</td><td class="num">${fmt(t.last)}</td><td class="num">${fmt(t.proj)}</td><td class="num">${delta(t.delta)}</td><td class="num">${gcell(t.growth)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  const card = (title, body, extra) => `<section class="card aa-card"><div class="card-head"><h3>${title}</h3>${extra ? `<div class="card-right">${extra}</div>` : ''}</div><div class="card-body">${body}</div></section>`;

  function channelSection(c) {
    const m = CH[c.ch];
    const contribBars = C && C.hbars ? C.hbars({ items: [...c.d.up.slice(0, 5).map((r) => ({ label: r.name, value: Math.round(r.delta), color: '#10b981' })), ...c.d.down.slice(0, 5).map((r) => ({ label: r.name, value: Math.round(r.delta), color: '#ef4444' }))], valueLabel: 'Δ tags', format: (v) => sgn(v) }) : '';
    return `<div class="aa-chan" data-ch="${c.ch}">
      <h2 class="aa-h2">${m.icon} ${m.label} ${chip(c.projGrowth)}</h2>
      <div class="aa-mini">
        <div><small>Ab tak (${esc(U.labelYM(c.cur.ym))})</small><b>${fmt(c.cur.total)}</b><span>${c.mtdGrowth === null ? '' : pctTxt(c.mtdGrowth) + ' vs pichhle mahine ka same period'}</span></div>
        <div><small>Month-end projection</small><b>${fmt(c.proj)}</b><span>${pctTxt(c.projGrowth)} vs ${fmt(c.last.total)}</span></div>
        <div><small>VC4 mix</small><b>${c.vc4Share.toFixed(0)}%</b><span>pichhle mahine ${c.vc4ShareLast.toFixed(0)}%</span></div>
        <div><small>Avg / active din</small><b>${fmt(c.avg)}</b><span>${c.cur.activeDays} active din</span></div>
        <div><small>Stock cover</small><b>${c.cover ? c.cover.toFixed(0) + ' din' : '—'}</b><span>${fmt(c.stock)} tags stock</span></div>
        <div><small>Top-5 share</small><b>${c.conc.top5Share.toFixed(0)}%</b><span>80% ke liye ${c.conc.n80} agents</span></div>
      </div>
      <div class="grid g-2">
        ${card('📈 Growth kiski wajah se (Top 12)', driverTable(c.d.up, c.ch, 'up'))}
        ${card('📉 Kaun down hai (Top 12)', driverTable(c.d.down, c.ch, 'down'))}
      </div>
      <div class="grid g-2">
        ${card('🏢 TL — growth', tlTable(c.tls, 'up'))}
        ${card('🏢 TL — down', tlTable(c.tls, 'down'))}
      </div>
      <div class="grid g-2">
        ${card(`🚪 Gaye / zero-activity <span class="dim">${fmt(c.d.lost.length)}</span>`, driverTable(c.d.lost, c.ch, 'lost'))}
        ${card(`🆕 Naye / pehli baar active <span class="dim">${fmt(c.d.fresh.length)}</span>`, driverTable(c.d.fresh, c.ch, 'new'))}
      </div>
      ${contribBars ? card('⚖️ Top 5 gainers vs top 5 decliners (projected Δ tags)', contribBars) : ''}
    </div>`;
  }

  function csvOf(a) {
    const rows = [];
    ['ff', 'gv'].forEach((ch) => { const c = a.channels[ch]; if (!c) return; c.d.rows.forEach((r) => rows.push([CH[ch].label, r.name, r.id, r.direct ? 'Direct' : r.tl, r.last, r.cur, Math.round(r.proj), Math.round(r.delta), r.growth === null ? 'new' : r.growth.toFixed(1) + '%', r.kind])); });
    rows.sort((x, y) => Math.abs(y[7]) - Math.abs(x[7]));
    return [['Channel', 'Agent', 'ID', 'TL', `${a.last} total`, `${a.cur} MTD`, 'Projected', 'Change', 'Change %', 'Type'], rows];
  }

  // ---------------------------------------------------------------- page
  async function render(root, params) {
    const sel = ['ff', 'gv'].includes(params && params.ch) ? params.ch : 'all';
    root.innerHTML = `<div class="page-head"><div><h1>🧠 AI Business Analyst</h1><p class="sub">GV + First Forward ka poora review — growth kiski wajah se, kaun down, kaun gaya, TL-wise asar aur ab kya karna hai. Basis: current month run-rate vs pichhla poora mahina.</p></div>
      <div class="head-actions"><button class="btn small" id="aa-csv">⬇ CSV</button><button class="btn small primary" id="aa-refresh">↻ Refresh</button></div></div>
      <div id="aa-body">${U.spinner('Analyst poora data padh raha hai…')}</div>`;
    const body = U.$('#aa-body', root);
    let a;
    try { a = await analyse(); } catch (err) { body.innerHTML = U.errorBox(err); return; }
    if (!root.isConnected) return;
    if (a.empty) { body.innerHTML = '<div class="empty-state">Abhi analysis ke liye data nahi mila.</div>'; return; }
    const n = narrative(a);
    const all = [a.channels.ff, a.channels.gv].filter(Boolean);
    const shown = sel === 'all' ? all : all.filter((c) => c.ch === sel);
    const kpis = [
      { tone: 'g1', icon: '🏷️', label: `Ab tak · ${U.labelYM(a.cur)}`, value: fmt(n.totalCur), foot: `${a.day} din · FF ${fmt(a.channels.ff ? a.channels.ff.cur.total : 0)} · GV ${fmt(a.channels.gv ? a.channels.gv.cur.total : 0)}` },
      { tone: 'g6', icon: '🎯', label: 'Month-end projection', value: fmt(n.totalProj), foot: `${pctTxt(n.g)} vs ${U.labelYM(a.last)} (${fmt(n.totalLast)})` },
      { tone: n.g !== null && n.g < 0 ? 'g2' : 'g5', icon: n.g !== null && n.g < 0 ? '📉' : '📈', label: 'Business health', value: healthOf(n.g)[0], foot: all.map((c) => `${CH[c.ch].label}: ${healthOf(c.projGrowth)[0]}`).join(' · ') },
      { tone: 'g4', icon: '🚪', label: 'Zero-activity agents', value: fmt(all.reduce((s, c) => s + c.d.lost.length, 0)), foot: `${fmt(all.reduce((s, c) => s + c.d.fresh.length, 0))} naye agents active` }
    ];
    const bits = ['<div class="aa-switch">' + [['all', '🌐 GV + FF'], ['ff', '🟦 First Forward'], ['gv', '🟩 GV Partner']].map(([k, l]) => `<button class="btn small ${sel === k ? 'primary' : ''}" data-aa-ch="${k}">${l}</button>`).join('') + '</div>'];
    body.innerHTML = `${a.errors.length ? `<div class="alert warn">${a.errors.map(esc).join(' · ')}</div>` : ''}
      ${FF.insights && FF.insights.ui ? FF.insights.ui.vividMetrics(kpis) : ''}
      ${card('🧠 Analyst ka nichod', `<ul class="aa-lines">${n.lines.map((l) => `<li class="${l.k}">${l.t}</li>`).join('')}</ul>`)}
      ${card('✅ Ab kya karein', `<ol class="aa-actions">${n.actions.map((t) => `<li>${t}</li>`).join('')}</ol>`)}
      ${bits.join('')}
      ${shown.map(channelSection).join('')}
      <p class="foot-note">Projected = ab tak ÷ din × mahine ke din. "Gaye" = pichhle mahine tags the, is mahine 0. Sources: FF → EIR · GV → GV Master/EIR · stock → StockDataa / Tag Assignment.</p>`;
    if (C && C.mount) { try { C.mount(body); } catch { /* ignore */ } }
    body.querySelectorAll('[data-aa-ch]').forEach((b) => b.addEventListener('click', () => FF.app.updateParams({ ch: b.dataset.aaCh === 'all' ? '' : b.dataset.aaCh })));
    U.$('#aa-refresh', root).addEventListener('click', () => { if (FF.app.refresh) FF.app.refresh(); else render(root, params); });
    U.$('#aa-csv', root).addEventListener('click', () => { const [h, r] = csvOf(a); U.downloadCsv(`ai-analyst-${U.stamp()}.csv`, h, r); });
  }

  FF.aiAnalyst = { analyse, narrative, drivers };
  FF.pages.aiAnalyst = { title: 'AI Business Analyst', render };
})(window.FF);
