/* 🗺️ STOCK RADAR (v3.16) — TL stock ka radar view:
   • Har TL ek bubble: SIZE = VC4 stock · COLOUR = cover days (🔴 <7 · 🟠 <15 · 🟡 <30 · 🟢 30+)
   • Centre = sabse critical (cover kam) — bahar = safe
   • Bubble click → drawer: stock, avg/day, cover + 🎯 suggested qty DONO criteria
     (stock ke baad + bina stock ghataye) + top agents + links
   • FF (REPORT) / GV (GV REPORT) channel switch
   Data: FF.pages.performance (REPORT) + FF.gv report — koi naya sheet query nahi. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const fmt = (n, d) => U.fmt(n, d);
  const state = { ch: 'ff' };

  const coverTone = (c) => (c == null ? 'na' : c < 7 ? 'red' : c < 15 ? 'orange' : c < 30 ? 'amber' : 'green');
  const COVER_COLOR = { red: '#ef4444', orange: '#f97316', amber: '#f59e0b', green: '#22c55e', na: '#94a3b8' };

  /** TL-wise aggregate — [{ tl, ch, stockVc4, stockComm, avgVc4, avgComm, cover, agents }] */
  async function tlsOf(ch) {
    const out = [];
    if (ch === 'ff' || ch === 'both') {
      const P = FF.pages.performance;
      if (P && P.ensureLoaded) { await P.ensureLoaded().catch(() => {}); }
      const agents = P && P.agents ? P.agents() : [];
      const map = new Map();
      for (const a of agents) {
        if (a.tlExcluded) continue;
        const tl = U.clean(a.tlName);
        if (!tl || !FF.config.isRealTl(tl)) continue;
        const g = map.get(tl) || { tl, ch: 'ff', stockVc4: 0, stockComm: 0, avgVc4: 0, avgComm: 0, agents: 0 };
        g.stockVc4 += Number(a.stockVc4) || 0;
        g.stockComm += Number(a.stockNvc4) || 0;
        g.avgVc4 += U.runRate(Number(a.curVc4) || 0, 'ff');
        g.avgComm += U.runRate(Number(a.curNvc4) || 0, 'ff');
        g.agents++;
        map.set(tl, g);
      }
      map.forEach((g) => { g.cover = g.avgVc4 > 0 ? g.stockVc4 / g.avgVc4 : null; out.push(g); });
    }
    if (ch === 'gv' || ch === 'both') {
      const G = FF.gv;
      if (G && G.need) { await G.need('report').catch(() => {}); }
      const rows = G && G.get ? (G.get('report') || []) : [];
      const map = new Map();
      for (const r of rows) {
        if (FF.config.isDirectAgent(r, 'gv')) continue;
        const tl = U.clean(r.tlName);
        if (!tl) continue;
        const key = `gv|${tl}`;
        const g = map.get(key) || { tl, ch: 'gv', stockVc4: 0, stockComm: 0, avgVc4: 0, avgComm: 0, agents: 0 };
        g.stockVc4 += Number(r.stockVc4) || 0;
        g.stockComm += Number(r.stockComm) || 0;
        g.avgVc4 += U.runRate(Number(r.curVc4) || 0, 'gv');
        g.avgComm += U.runRate(Number(r.curComm) || 0, 'gv');
        g.agents++;
        map.set(key, g);
      }
      map.forEach((g) => { g.cover = g.avgVc4 > 0 ? g.stockVc4 / g.avgVc4 : null; out.push(g); });
    }
    return out.sort((a, b) => (a.cover ?? 999) - (b.cover ?? 999));
  }

  /** Golden-angle spiral: kam cover = centre ke paas, bubble size = stock. */
  function layout(tls) {
    const W = 760, CX = W / 2, CY = W / 2;
    const maxStock = Math.max(1, ...tls.map((t) => t.stockVc4));
    const sorted = [...tls].sort((a, b) => (a.cover ?? 9999) - (b.cover ?? 9999));
    const n = sorted.length;
    return sorted.map((t, i) => {
      const coverCap = Math.min(t.cover == null ? 60 : t.cover, 60);
      const r = 70 + (coverCap / 60) * 260;             // centre = critical
      const ang = i * 2.399963;                          // golden angle
      const jitter = (i % 5) * 4;
      const x = CX + Math.cos(ang) * (r + jitter);
      const y = CY + Math.sin(ang) * (r + jitter);
      const rad = 10 + Math.sqrt(t.stockVc4 / maxStock) * 34;
      return { t, x, y, r: rad };
    });
  }

  function radarSvg(tls) {
    const W = 760, C = W / 2;
    const rings = [
      { r: 70 + (7 / 60) * 260, label: '🔴 <7 din', color: '#ef4444' },
      { r: 70 + (15 / 60) * 260, label: '🟠 <15 din', color: '#f97316' },
      { r: 70 + (30 / 60) * 260, label: '🟡 <30 din', color: '#f59e0b' },
      { r: 70 + (60 / 60) * 260, label: '🟢 30+ din (safe)', color: '#22c55e' }
    ];
    const bubbles = layout(tls);
    return `<svg viewBox="0 0 ${W} ${W}" class="radar-svg" role="img" aria-label="Stock radar">
      ${rings.map((rg) => `<circle cx="${C}" cy="${C}" r="${rg.r}" fill="none" stroke="${rg.color}" stroke-opacity=".35" stroke-dasharray="5 6"/>
        <text x="${C + 6}" y="${C - rg.r - 4}" font-size="11" fill="${rg.color}" font-weight="800">${rg.label}</text>`).join('')}
      <circle cx="${C}" cy="${C}" r="6" fill="var(--brand)"/>
      <text x="${C + 10}" y="${C + 4}" font-size="11" fill="var(--muted)" font-weight="800">CRITICAL</text>
      ${bubbles.map((b, i) => {
        const tone = coverTone(b.t.cover);
        const col = COVER_COLOR[tone];
        return `<g class="radar-bub" data-radar-i="${i}" tabindex="0" role="button" aria-label="${esc(b.t.tl)} — stock ${fmt(b.t.stockVc4)}, cover ${b.t.cover == null ? '∞' : fmt(b.t.cover, true)} din">
          <circle cx="${b.x}" cy="${b.y}" r="${b.r}" fill="${col}" fill-opacity=".28" stroke="${col}" stroke-width="2.5"/>
          <text x="${b.x}" y="${b.y + 4}" text-anchor="middle" font-size="${b.r > 22 ? 11 : 9}" font-weight="900" fill="var(--ink)">${esc(b.t.tl.split(' ')[0].slice(0, 8))}</text>
          ${b.r > 18 ? `<text x="${b.x}" y="${b.y + 16}" text-anchor="middle" font-size="9" font-weight="700" fill="${col}">${fmt(b.t.stockVc4)}</text>` : ''}
        </g>`;
      }).join('')}
    </svg>`;
  }

  async function openTlDrawer(t) {
    if (!FF.app || !FF.app.openDrawer) return;
    const pair = U.suggestPair(t.avgVc4, t.stockVc4);
    const pairC = U.suggestPair(t.avgComm, t.stockComm);
    const coverTxt = t.cover == null ? '∞ (avg 0)' : `${fmt(t.cover, true)} din`;
    const chLabel = t.ch === 'gv' ? 'GV Partner' : 'First Forward';
    FF.app.openDrawer({
      age: { kind: 'tl', key: t.tl, ch: t.ch === 'gv' ? 'gv' : 'ff', title: t.tl },
      kicker: `🗺️ Stock Radar · ${chLabel}`, title: t.tl,
      sub: `${fmt(t.agents)} agents · VC4 cover ${coverTxt}`,
      body: `<div class="mp">
        <div class="mp-kpis">
          <div class="mp-kpi k1"><small>VC4 stock</small><b>${fmt(t.stockVc4)}</b><em>avg ${fmt(t.avgVc4, true)}/day</em></div>
          <div class="mp-kpi k2"><small>Comm. stock</small><b>${fmt(t.stockComm)}</b><em>avg ${fmt(t.avgComm, true)}/day</em></div>
          <div class="mp-kpi k3"><small>VC4 cover</small><b>${coverTxt}</b><em>${t.cover != null && t.cover < 7 ? '🔴 dispatch urgent' : t.cover != null && t.cover < 15 ? '🟠 jaldi bhejo' : '🟢 theek hai'}</em></div>
          <div class="mp-kpi k4"><small>Sug. VC4 · ${pair.days} din</small><b>${U.sugCell(pair.net, pair.gross)}</b><em>stock − · w/o stock</em></div>
          <div class="mp-kpi k5"><small>Sug. Comm. · ${pairC.days} din</small><b>${U.sugCell(pairC.net, pairC.gross)}</b><em>stock − · w/o stock</em></div>
        </div>
        <p class="dim small">🎯 Suggested = avg/day × ${pair.days} din · <b>stock ke baad</b> = net chip · <b>bina stock ghataye</b> = w/o stock · din/mode ⚙️ Settings → Features me badlo.</p>
        <div class="mp-actions">
          ${t.ch === 'ff' ? `<a class="btn small primary" href="#/performance?tl=${encodeURIComponent(t.tl)}">🏆 Performance TL view</a>` : `<a class="btn small primary" href="#/gvPerformance?view=tls">🟩 GV Performance · TLs</a>`}
          <a class="btn small" href="#/stockReport">📦 Stock Report</a>
          ${t.ch === 'ff' ? `<a class="btn small" href="#/dispatchPlan">🚚 Dispatch Planner</a>` : ''}
        </div>
      </div>`, actions: '', wide: false
    });
  }

  async function render(root, params) {
    if (params && ['ff', 'gv', 'both'].includes(params.ch)) state.ch = params.ch;
    root.innerHTML = `<div class="page-head"><div><h1>🗺️ Stock Radar</h1><p class="sub">Har TL ek bubble — size = VC4 stock · colour = cover days · centre = critical · bubble click → suggested qty (dono criteria)</p></div>
      <div class="head-actions"><div class="seg" id="sr-ch">
        <button class="seg-btn ${state.ch === 'ff' ? 'on' : ''}" data-ch="ff">🟦 First Forward</button>
        <button class="seg-btn ${state.ch === 'gv' ? 'on' : ''}" data-ch="gv">🟩 GV Partner</button>
        <button class="seg-btn ${state.ch === 'both' ? 'on' : ''}" data-ch="both">🔗 Dono</button>
      </div><button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div id="sr-body">${U.spinner('Radar scan ho raha hai…')}</div>`;
    root.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => { state.ch = b.dataset.ch; render(root, {}); }));
    const body = root.querySelector('#sr-body');
    let tls = [];
    try { tls = await tlsOf(state.ch); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    const critical = tls.filter((t) => t.cover != null && t.cover < 7).length;
    const low = tls.filter((t) => t.cover != null && t.cover < 15).length;
    if (!tls.length) { body.innerHTML = '<div class="card"><div class="card-body empty">Is channel ka TL stock data abhi load nahi hua (REPORT tab chahiye).</div></div>'; return; }
    body.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi g7"><div class="kpi-top"><span class="kpi-title">🔴 Critical &lt;7 din</span><span class="kpi-icon">🚨</span></div><div class="kpi-value">${fmt(critical)}</div><div class="kpi-foot">TLs — aaj dispatch chahiye</div></div>
        <div class="kpi g4"><div class="kpi-top"><span class="kpi-title">🟠 Low &lt;15 din</span><span class="kpi-icon">⚠️</span></div><div class="kpi-value">${fmt(low)}</div><div class="kpi-foot">TLs — jaldi plan karo</div></div>
        <div class="kpi g9"><div class="kpi-top"><span class="kpi-title">📦 Total VC4 stock</span><span class="kpi-icon">🗄️</span></div><div class="kpi-value">${fmt(U.sum(tls, (t) => t.stockVc4))}</div><div class="kpi-foot">${fmt(tls.length)} TLs · ${fmt(U.sum(tls, (t) => t.agents))} agents</div></div>
        <div class="kpi g6"><div class="kpi-top"><span class="kpi-title">🎯 Total suggested VC4</span><span class="kpi-icon">🎯</span></div><div class="kpi-value">${fmt(U.sum(tls, (t) => U.suggestPair(t.avgVc4, t.stockVc4).net))}</div><div class="kpi-foot">w/o stock ${fmt(U.sum(tls, (t) => U.suggestPair(t.avgVc4, t.stockVc4).gross))}</div></div>
      </div>
      <section class="card"><div class="card-head"><h3>📡 Radar — ${state.ch === 'ff' ? 'First Forward' : state.ch === 'gv' ? 'GV Partner' : 'FF + GV'} TLs</h3>
        <div class="card-right dim">bubble par click karo → poori detail + suggested (dono criteria)</div></div>
        <div class="card-body radar-wrap">${radarSvg(tls)}</div></section>
      <section class="card"><div class="card-head"><h3>🔴 Critical TLs — pehle inko dispatch karo</h3></div><div class="card-body">
        <div class="table-wrap"><table class="tbl compact"><thead><tr><th>TL</th><th>Channel</th><th class="num">VC4 stock</th><th class="num">Avg/day</th><th class="num">Cover</th><th class="num">Sug. (stock − · w/o)</th></tr></thead><tbody>
        ${[...tls].sort((a, b) => (a.cover ?? 999) - (b.cover ?? 999)).slice(0, 15).map((t) => {
          const p = U.suggestPair(t.avgVc4, t.stockVc4);
          return `<tr class="clickable" data-sr-open="${esc(t.ch + '|' + t.tl)}"><td><b>${esc(t.tl)}</b></td><td>${t.ch === 'gv' ? '🟩 GV' : '🟦 FF'}</td><td class="num">${fmt(t.stockVc4)}</td><td class="num">${fmt(t.avgVc4, true)}</td><td class="num"><span class="badge ${coverTone(t.cover) === 'red' ? 'red' : coverTone(t.cover) === 'orange' ? 'amber' : coverTone(t.cover) === 'amber' ? 'amber' : 'green'}">${t.cover == null ? '∞' : fmt(t.cover, true)}</span></td><td class="num">${U.sugCell(p.net, p.gross)}</td></tr>`;
        }).join('')}
        </tbody></table></div></div></section>`;
    const bub = body.querySelectorAll('.radar-bub');
    const bubblesArr = layout(tls);
    bub.forEach((el) => {
      const open = () => { const i = Number(el.dataset.radarI); const b = bubblesArr[i]; if (b) openTlDrawer(b.t); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    body.querySelectorAll('[data-sr-open]').forEach((tr) => tr.addEventListener('click', () => {
      const [ch, tl] = tr.dataset.srOpen.split('|');
      const t = tls.find((x) => x.ch === ch && x.tl === tl);
      if (t) openTlDrawer(t);
    }));
  }

  FF.pages.stockRadar = { title: 'Stock Radar', render };
})(window.FF);
