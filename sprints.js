/* ⏰ HOURLY SPRINTS (v3.16) — ghadi-ghadi ki race!
   Har hour ek sprint: kaunsa TL / agent is ghante sabse zyada tags issue kar raha hai?
   • Live countdown + progress bar (hour khatam hone me kitna time)
   • TL + Agent leaderboard (is hour) — GV Master ke time-stamps se (real-time data)
   • Aaj ke pichhle sprints ka history (winner + bars)
   • Hour palat-te hi winner celebration (trophy + fanfare)
   Note: FF EIR sheet aggregated hai (time nahi milta), isliye race GV live rows se hai —
   FF ka aaj ka total context chip me dikhta hai. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, G = FF.gv, S = FF.store, C = FF.charts;
  const esc = U.esc;
  const fmt = (n, d) => U.fmt(n, d);

  const state = { lastSprintKey: '', timer: null, cdTimer: null, lastWinnerShown: '' };

  /** "12:53:56" / "12:53" / "2:05 pm" → hour (0-23), warna null. */
  function hourOf(timeStr) {
    const s = String(timeStr || '').trim();
    if (!s) return null;
    let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s);
    if (!m) m = /^(\d{1,2})\s*(am|pm)$/i.exec(s);
    if (!m) return null;
    let h = Number(m[1]);
    const ap = (m[4] || m[2] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return h >= 0 && h <= 23 ? h : null;
  }
  const todayKey = () => U.dateKey(new Date());

  function sprintData() {
    const today = todayKey();
    const rows = (G.rows ? G.rows() : []).filter((r) => r.date && U.dateKey(r.date) === today);
    const nowH = new Date().getHours();
    const byHour = new Array(24).fill(0);
    const hourTl = new Map();   // hour → Map(tl → { n, agents:Set })
    const hourAgent = new Map(); // hour → Map(agent → { n, tl })
    let withTime = 0;
    for (const r of rows) {
      const h = hourOf(r.time);
      if (h === null) continue;
      withTime++;
      byHour[h]++;
      const direct = FF.config.isDirectAgent(r, 'gv');
      const tl = direct ? FF.config.directLabel(r, 'gv') : (U.clean(r.tlName) || 'Unassigned');
      let tm = hourTl.get(h); if (!tm) { tm = new Map(); hourTl.set(h, tm); }
      const t = tm.get(tl) || { n: 0, agents: new Set() }; t.n++; t.agents.add(r.agentName); tm.set(tl, t);
      let am = hourAgent.get(h); if (!am) { am = new Map(); hourAgent.set(h, am); }
      const a = am.get(r.agentName) || { n: 0, tl }; a.n++; am.set(r.agentName, a);
    }
    const leaders = (map) => [...map.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
    const past = [];
    for (let h = 0; h < nowH; h++) {
      if (!byHour[h]) continue;
      const tl = leaders(hourTl.get(h) || new Map())[0];
      past.push({ h, n: byHour[h], winner: tl ? tl[0] : '—', wn: tl ? tl[1].n : 0 });
    }
    return { rows, today, nowH, byHour, hourTl, hourAgent, withTime, past, tlNow: leaders(hourTl.get(nowH) || new Map()), agentNow: leaders(hourAgent.get(nowH) || new Map()), totalToday: rows.length, hourTotal: byHour[nowH] || 0 };
  }

  function ffTodayTotal() {
    const daily = S.get('daily') || [];
    const today = todayKey();
    return daily.filter((r) => r.key === today && r.channel !== 'GV Partner').reduce((n, r) => n + (Number(r.n) || 0), 0);
  }

  function countdown() {
    const now = new Date();
    const left = (60 - now.getMinutes()) * 60 - now.getSeconds();
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function renderBars(root, d) {
    const nowH = d.nowH;
    const barHtml = `<div class="spr-track"><div class="spr-fill" style="width:${(new Date().getMinutes() / 60) * 100}%"></div></div>`;
    const leadRow = ([name, v], i, medals) => `<div class="spr-row ${i === 0 ? 'lead' : ''}"><span class="spr-rank">${medals[i] || `#${i + 1}`}</span><b class="spr-name">${esc(name)}</b><div class="spr-bar-wrap"><div class="spr-bar ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}" style="width:${v.n ? Math.max(6, (v.n / Math.max(1, d.tlNow[0] ? d.tlNow[0][1].n : v.n)) * 100) : 0}%"></div></div><em>${fmt(v.n)}</em>${v.agents ? `<small>${fmt(v.agents.size)} agents</small>` : `<small class="dim">${esc(v.tl || '')}</small>`}</div>`;
    const medals = ['🥇', '🥈', '🥉'];
    const pastBars = C ? C.bars({ labels: d.past.map((p) => `${p.h}:00`), height: 170, series: [{ name: 'Tags', values: d.past.map((p) => p.n), color: '#f59e0b' }], showValues: true }) : '';
    root.innerHTML = `
      <div class="page-head"><div><h1>⏰ Hourly Sprints</h1><p class="sub">Har ghanta ek race — is hour kaun sabse tez? (GV time-stamps se live)</p></div>
        <div class="head-actions"><button class="btn" id="spr-full">⛶ Fullscreen</button><button class="btn primary" data-action="refresh">↻ Fresh data</button></div></div>
      <section class="card spr-hero">
        <div class="spr-hero-in">
          <div class="spr-count"><span class="war-live-dot"></span><b>${nowH}:00 – ${nowH + 1}:00</b><small>SPRINT CHALU HAI · khatam hone me <em id="spr-cd">${countdown()}</em></small>${barHtml}</div>
          <div class="spr-kpis">
            <div class="kpi g4" data-kpi="src=gv&scope=day&date=${d.today}"><div class="kpi-top"><span class="kpi-title">Is hour · GV</span><span class="kpi-icon">⚡</span></div><div class="kpi-value">${fmt(d.hourTotal)}</div><div class="kpi-foot">tags is ghante</div></div>
            <div class="kpi g2" data-kpi="src=gv&scope=day&date=${d.today}"><div class="kpi-top"><span class="kpi-title">Aaj · GV</span><span class="kpi-icon">🟩</span></div><div class="kpi-value">${fmt(d.totalToday)}</div><div class="kpi-foot">${fmt(d.withTime)} with time-stamp</div></div>
            <div class="kpi g1" data-kpi="src=ff&scope=day&date=${d.today}"><div class="kpi-top"><span class="kpi-title">Aaj · FF</span><span class="kpi-icon">🟦</span></div><div class="kpi-value">${fmt(ffTodayTotal())}</div><div class="kpi-foot">EIR me time nahi — sirf total</div></div>
            <div class="kpi g6"><div class="kpi-top"><span class="kpi-title">Active agents</span><span class="kpi-icon">🧑‍💼</span></div><div class="kpi-value">${fmt(d.agentNow.length ? new Set(d.agentNow.map(([n]) => n)).size : 0)}</div><div class="kpi-foot">is hour me issue kiya</div></div>
          </div>
        </div>
      </section>
      <div class="grid g-2">
        <section class="card"><div class="card-head"><h3>🏆 TL Sprint Leaderboard <span class="dim">· ${nowH}:00–${nowH + 1}:00</span></h3></div>
          <div class="card-body">${d.tlNow.length ? d.tlNow.map((x, i) => leadRow(x, i, medals)).join('') : '<div class="card-body empty">Is hour abhi koi GV issuance nahi aayi. ⏳</div>'}</div></section>
        <section class="card"><div class="card-head"><h3>🧑‍💼 Agent Sprint Leaderboard <span class="dim">· ${nowH}:00–${nowH + 1}:00</span></h3></div>
          <div class="card-body">${d.agentNow.length ? d.agentNow.map((x, i) => leadRow(x, i, medals)).join('') : '<div class="card-body empty">Is hour abhi koi agent active nahi. ⏳</div>'}</div></section>
      </div>
      <div class="grid g-2-1">
        <section class="card"><div class="card-head"><h3>📊 Aaj ke sprints · hour-wise</h3></div><div class="card-body">${d.past.length ? pastBars : '<div class="empty-state compact">Aaj abhi koi poora sprint nahi beeta.</div>'}</div></section>
        <section class="card"><div class="card-head"><h3>🥇 Sprint winners · aaj</h3></div><div class="card-body">
          ${d.past.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Sprint</th><th class="num">Tags</th><th>Winner TL</th><th class="num">Winner tags</th></tr></thead><tbody>
            ${d.past.map((p) => `<tr><td><b>${p.h}:00–${p.h + 1}:00</b></td><td class="num">${fmt(p.n)}</td><td>${p.winner === '—' ? '<span class="dim">—</span>' : `<b>${esc(p.winner)}</b>`}</td><td class="num">${fmt(p.wn)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty-state compact">Pehla sprint abhi chal raha hai…</div>'}
        </div></section>
      </div>
      <p class="foot-note">Race GV Master ke <b>time-stamps</b> se banti hai (real-time) · FF EIR sheet me time nahi milta, isliye FF sirf total dikhata hai · data ↻ se fresh hota hai</p>`;
    if (C && C.mount) C.mount(root);
    const fs = root.querySelector('#spr-full');
    if (fs) fs.addEventListener('click', () => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch { /* n/a */ } });
  }

  async function render(root) {
    root.innerHTML = `<div class="page-head"><div><h1>⏰ Hourly Sprints</h1><p class="sub">Har ghanta ek race…</p></div></div>${U.spinner('GV Master load ho raha hai…')}`;
    try { await G.need('master'); S.need('daily').catch(() => []); } catch (err) { root.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    const d = sprintData();
    state.lastSprintKey = `${d.today}|${d.nowH}`;
    renderBars(root, d);
    // ⏱️ second-by-second countdown — smooth ticking (board 30s me refresh hota hai)
    if (state.cdTimer) clearInterval(state.cdTimer);
    state.cdTimer = setInterval(() => {
      if (!root.isConnected) { clearInterval(state.cdTimer); return; }
      const cd = root.querySelector('#spr-cd');
      if (cd) cd.textContent = countdown();
    }, 1000);
    const tick = () => {
      if (!root.isConnected) { clearInterval(state.timer); return; }
      const nd = sprintData();
      const key = `${nd.today}|${nd.nowH}`;
      if (key !== state.lastSprintKey) {
        // 🏁 sprint palat gaya — pichhle hour ka winner celebrate karo, phir fresh render
        const prev = state.lastSprintKey.split('|');
        const ph = Number(prev[1]);
        const finished = sprintDataAt(prev[0], ph);
        if (finished && FF.wow && FF.wow.celebrateOnce) FF.wow.celebrateOnce(`sprint-${prev[0]}-${ph}`, `🏁 Sprint ${ph}:00–${ph + 1}:00 khatam!`, `Winner: ${finished.winner} · ${fmt(finished.wn)} tags`);
        state.lastSprintKey = key;
        renderBars(root, nd);
        return;
      }
      // halka update har 30s — leaderboard/counters fresh
      renderBars(root, nd);
    };
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(tick, 30000);
    const mo = new MutationObserver(() => { if (!root.isConnected) { clearInterval(state.timer); mo.disconnect(); } });
    if (root.parentNode) mo.observe(root.parentNode, { childList: true });
  }

  /** Pichhle sprint ka winner nikalo (celebration ke liye). */
  function sprintDataAt(dateKey, hour) {
    const rows = (G.rows ? G.rows() : []).filter((r) => r.date && U.dateKey(r.date) === dateKey && hourOf(r.time) === hour);
    if (!rows.length) return null;
    const tl = new Map();
    for (const r of rows) {
      const direct = FF.config.isDirectAgent(r, 'gv');
      const name = direct ? FF.config.directLabel(r, 'gv') : (U.clean(r.tlName) || 'Unassigned');
      tl.set(name, (tl.get(name) || 0) + 1);
    }
    const top = [...tl.entries()].sort((a, b) => b[1] - a[1])[0];
    return { winner: top[0], wn: top[1] };
  }

  FF.pages.sprints = { title: 'Hourly Sprints', render };
})(window.FF);
