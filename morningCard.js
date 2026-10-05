/* 📲 GOOD MORNING CARD (v3.16) — roz subah boss ke liye ek WhatsApp-ready daily card.
   Ek click me PNG banti hai (1080×1080 canvas) jisme:
   • Kal ka total (FF + GV) aur uska vs pichhla din delta
   • MTD total + month-end projection + pace (kitne din beete)
   • Top-3 agents (combined MTD)
   • Risk list — low stock cover TLs (radar se)
   • Aaj ka expected (pichhle 4 same-weekday ki run-rate)
   PNG download hoti hai + WhatsApp share link khulta hai (text ke saath). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util, S = FF.store, G = FF.gv;

  function ffDailyRows() { return (S.get('daily') || []).filter((r) => r.channel !== 'GV Partner'); }
  function gvDailyTotals() {
    const map = new Map();
    for (const r of (G.issuanceRows ? G.issuanceRows() : (G.rows ? G.rows() : []))) {
      if (!r.date) continue;
      const k = U.dateKey(r.date);
      map.set(k, (map.get(k) || 0) + (Number(r.n) || 1));
    }
    return map;
  }

  function yesterdayStats() {
    const yd = new Date(); yd.setDate(yd.getDate() - 1);
    const yk = U.dateKey(yd);
    const pd = new Date(); pd.setDate(pd.getDate() - 2);
    const pk = U.dateKey(pd);
    const ff = ffDailyRows();
    const gvMap = gvDailyTotals();
    const yestFf = U.sum(ff.filter((r) => r.key === yk), (r) => r.n);
    const prevFf = U.sum(ff.filter((r) => r.key === pk), (r) => r.n);
    const yestGv = gvMap.get(yk) || 0, prevGv = gvMap.get(pk) || 0;
    return { yk, yestTotal: yestFf + yestGv, prevTotal: prevFf + prevGv, yestFf, yestGv };
  }

  function mtdStats() {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const ff = ffDailyRows().filter((r) => r.ym === ym);
    const gvMap = gvDailyTotals();
    let gvTotal = 0, gvDays = new Set();
    gvMap.forEach((n, k) => { if (k.startsWith(ym) && k <= U.dateKey(now)) { gvTotal += n; gvDays.add(k); } });
    const ffTotal = U.sum(ff, (r) => r.n);
    const total = ffTotal + gvTotal;
    const daysElapsed = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const projected = daysElapsed > 0 ? Math.round((total / daysElapsed) * daysInMonth) : 0;
    return { ym, total, ffTotal, gvTotal, daysElapsed, daysInMonth, projected };
  }

  function topAgents() {
    const out = [];
    // FF — performance report se (agar loaded ho)
    const P = FF.pages.performance;
    if (P && P.agents) {
      for (const a of P.agents()) { if (a.curTotal > 0) out.push({ name: a.name, n: a.curTotal, ch: 'FF' }); }
    }
    // GV — master rows se MTD counts
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const gv = new Map();
    for (const r of (G.issuanceRows ? G.issuanceRows() : (G.rows ? G.rows() : []))) {
      if (!r.date || r.ym !== ym) continue;
      const name = r.agentName || r.agentId || 'Unknown';
      gv.set(name, (gv.get(name) || 0) + (Number(r.n) || 1));
    }
    gv.forEach((n, name) => out.push({ name, n, ch: 'GV' }));
    return out.sort((a, b) => b.n - a.n).slice(0, 3);
  }

  function expectedToday() {
    const now = new Date();
    const tk = U.dateKey(now);
    const wd = now.getDay();
    const byDay = new Map();
    for (const r of (G.issuanceRows ? G.issuanceRows() : (G.rows ? G.rows() : []))) {
      if (!r.date || r.date.getDay() !== wd) continue;
      const k = U.dateKey(r.date);
      if (k === tk) continue;
      byDay.set(k, (byDay.get(k) || 0) + (Number(r.n) || 1));
    }
    const last4 = [...byDay.values()].slice(-4);
    return last4.length ? Math.round(last4.reduce((a, b) => a + b, 0) / last4.length) : null;
  }

  async function risks() {
    try {
      const P = FF.pages.performance;
      if (P && P.ensureLoaded) await P.ensureLoaded().catch(() => {});
      const agents = (P && P.agents) ? P.agents() : [];
      const tl = new Map();
      for (const a of agents) {
        if (a.tlExcluded) continue;
        const name = U.clean(a.tlName);
        if (!name || !FF.config.isRealTl(name)) continue;
        const g = tl.get(name) || { name, stock: 0, avg: 0 };
        g.stock += Number(a.stockVc4) || 0; g.avg += Number(a.avgVc4) || 0;
        tl.set(name, g);
      }
      const list = [];
      tl.forEach((g) => { if (g.avg > 0) { const cover = g.stock / g.avg; if (cover < 7) list.push({ name: g.name, cover }); } });
      return list.sort((a, b) => a.cover - b.cover).slice(0, 3);
    } catch { return []; }
  }

  // ---- canvas painting -------------------------------------------------------------------------
  function paintCard(stats) {
    const W = 1080, H = 1080;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#1e3a8a'); grad.addColorStop(0.5, '#312e81'); grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.05})`;
      ctx.beginPath(); ctx.arc(Math.random() * W, Math.random() * H, 1.5 + Math.random() * 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(250,204,21,.7)'; ctx.lineWidth = 5;
    ctx.strokeRect(46, 46, W - 92, H - 92);
    const center = (y, txt, size, weight, color) => { ctx.textAlign = 'center'; ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.fillText(txt, W / 2, y); };
    const left = (x, y, txt, size, weight, color) => { ctx.textAlign = 'left'; ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.fillText(txt, x, y); };
    const right = (x, y, txt, size, weight, color) => { ctx.textAlign = 'right'; ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.fillText(txt, x, y); };
    const row = (y, labelTxt, valueTxt, tone) => {
      left(110, y, labelTxt, 30, '600', 'rgba(255,255,255,.75)');
      right(970, y, valueTxt, 32, '800', tone || '#ffffff');
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(110, y + 14); ctx.lineTo(970, y + 14); ctx.stroke();
    };
    center(130, '☀️ Good Morning', 52, '800', '#facc15');
    center(176, stats.dateLabel, 28, '600', 'rgba(255,255,255,.8)');
    // Kal ka hero number
    center(268, 'KAL KA TOTAL', 26, '700', 'rgba(255,255,255,.6)');
    center(352, U.fmt(stats.yest.yestTotal), 88, '800', '#ffffff');
    const g = U.growth(stats.yest.yestTotal, stats.yest.prevTotal);
    center(396, `${g >= 0 ? '▲' : '▼'} ${U.fmtPct(Math.abs(g), 1)} vs pichhla din · FF ${U.fmt(stats.yest.yestFf)} + GV ${U.fmt(stats.yest.yestGv)}`, 24, '600', g >= 0 ? '#4ade80' : '#f87171');
    // MTD block
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(90, 436, W - 180, 150);
    left(110, 476, `MTD (${U.labelYM(stats.mtd.ym)})`, 28, '800', '#facc15');
    row(522, 'Issued so far', `${U.fmt(stats.mtd.total)}  ·  FF ${U.fmt(stats.mtd.ffTotal)} | GV ${U.fmt(stats.mtd.gvTotal)}`);
    row(566, 'Month-end projection', `${U.fmt(stats.mtd.projected)}  ·  din ${stats.mtd.daysElapsed}/${stats.mtd.daysInMonth}`, '#a5b4fc');
    // Top-3 agents
    left(110, 656, '🏆 Top Agents (MTD)', 30, '800', '#facc15');
    const medals = ['🥇', '🥈', '🥉'];
    stats.top3.forEach((a, i) => {
      left(110, 700 + i * 44, `${medals[i]} ${a.name} (${a.ch})`, 28, '700', '#ffffff');
      right(970, 700 + i * 44, U.fmt(a.n), 30, '800', '#4ade80');
    });
    if (!stats.top3.length) left(110, 700, '— agent data load nahi hua', 26, '600', 'rgba(255,255,255,.5)');
    // Risk list
    left(110, 862, '🚨 Stock Risks (<7 din cover)', 28, '800', '#f87171');
    if (stats.riskList.length) {
      stats.riskList.forEach((r, i) => {
        left(110, 902 + i * 34, `• ${r.name}`, 24, '600', 'rgba(255,255,255,.85)');
        right(970, 902 + i * 34, `${U.fmt(r.cover, true)} din`, 24, '800', '#f87171');
      });
    } else left(110, 902, '• Koi critical TL nahi — sab badhiya! 🎉', 24, '600', '#4ade80');
    // Expected today strip
    ctx.fillStyle = 'rgba(250,204,21,.12)'; ctx.fillRect(90, H - 128, W - 180, 62);
    center(H - 88, stats.expect != null ? `🎯 Aaj ka expected (GV, same-weekday run-rate): ${U.fmt(stats.expect)} tags` : '🎯 Aaj ka expected: history abhi kam hai', 26, '800', '#fde68a');
    center(H - 44, `${FF.config.brand || 'Apna Payment'} · Dashboard`, 22, '600', 'rgba(255,255,255,.55)');
    return cv.toDataURL('image/png');
  }

  function waText(stats) {
    const L = [];
    L.push(`☀️ *Good Morning* — ${stats.dateLabel}`);
    L.push(`🏷️ *Kal ka total*: ${U.fmt(stats.yest.yestTotal)} (FF ${U.fmt(stats.yest.yestFf)} + GV ${U.fmt(stats.yest.yestGv)})`);
    const g = U.growth(stats.yest.yestTotal, stats.yest.prevTotal);
    L.push(`${g >= 0 ? '📈' : '📉'} ${U.fmtPct(Math.abs(g), 1)} vs pichhla din`);
    L.push(`📅 *MTD* (${U.labelYM(stats.mtd.ym)}): ${U.fmt(stats.mtd.total)} · projection ${U.fmt(stats.mtd.projected)} · din ${stats.mtd.daysElapsed}/${stats.mtd.daysInMonth}`);
    if (stats.top3.length) { L.push('🏆 *Top agents*:'); stats.top3.forEach((a, i) => L.push(`   ${['🥇', '🥈', '🥉'][i]} ${a.name} — ${U.fmt(a.n)}`)); }
    if (stats.riskList.length) { L.push('🚨 *Stock risk (<7 din)*:'); stats.riskList.forEach((r) => L.push(`   • ${r.name} — ${U.fmt(r.cover, true)} din`)); }
    if (stats.expect != null) L.push(`🎯 *Aaj ka expected*: ${U.fmt(stats.expect)} tags (same-weekday run-rate)`);
    L.push('— Apna Payment Dashboard');
    return L.join('\n');
  }

  /** Full flow — data collect → PNG → download + WhatsApp share. */
  async function generate(rootEl) {
    const btn = rootEl && rootEl.querySelector ? rootEl.querySelector('#home-morning-card') : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Card ban raha hai…'; }
    try {
      await Promise.allSettled([S.need('daily'), G.need ? G.need('master') : Promise.resolve()]);
      const stats = {
        dateLabel: new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        yest: yesterdayStats(), mtd: mtdStats(), top3: topAgents(), riskList: await risks(), expect: expectedToday()
      };
      const url = paintCard(stats);
      const a = document.createElement('a');
      a.href = url;
      a.download = U.slug(`good-morning-${U.dateKey(new Date())}`) + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      const text = waText(stats);
      const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
      U.toast('📲 Card download ho gaya — ab WhatsApp me attach karo', 'ok');
      try { window.open(wa, '_blank', 'noopener'); } catch { /* popup blocked */ }
    } catch (err) {
      U.toast('Card banate waqt error: ' + (err && err.message ? err.message : err), 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📲 Morning Card'; }
    }
  }

  FF.morningCard = { generate, yesterdayStats, mtdStats, expectedToday };
})(window.FF);
