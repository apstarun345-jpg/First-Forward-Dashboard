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
  const agentKey = (id, name) => id ? `id:${String(id).trim()}` : `name:${String(name || '').trim().toLowerCase()}`;

  function topAgentsForToday(rows) {
    const map = new Map();
    for (const r of rows || []) {
      const name = U.clean(r.agentName || r.name || r.gvName || r.agentId || r.id);
      if (!name) continue;
      const id = U.clean(r.agentId || r.id || r.gvId || '');
      const key = agentKey(id, name);
      const item = map.get(key) || { key, agentId: id, agentName: name, tl: U.clean(r.tlName || r.tl || ''), n: 0 };
      item.n += Number(r.n) > 0 ? Number(r.n) : 1;
      item.tl = item.tl || U.clean(r.tlName || r.tl || '');
      map.set(key, item);
    }
    return [...map.values()].sort((a, b) => b.n - a.n || a.agentName.localeCompare(b.agentName)).slice(0, 12);
  }

  function sprintData() {
    const today = todayKey();
    const rows = (G.rows ? G.rows() : []).filter((r) => r.date && U.dateKey(r.date) === today);
    const ffTodayRows = (S.get('agentDailyClass') || []).filter((r) => r.dateKey === today && r.channel === 'First Forward');
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
      const agentName = U.clean(r.agentName || r.agentId || 'Unknown agent');
      const agentId = U.clean(r.agentId || r.id || '');
      const aKey = agentKey(agentId, agentName);
      const a = am.get(aKey) || { agentId, agentName, n: 0, tl }; a.n++; am.set(aKey, a);
    }
    const leaders = (map) => [...map.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
    const past = [];
    for (let h = 0; h < nowH; h++) {
      if (!byHour[h]) continue;
      const tl = leaders(hourTl.get(h) || new Map())[0];
      past.push({ h, n: byHour[h], winner: tl ? tl[0] : '—', wn: tl ? tl[1].n : 0 });
    }
    return {
      rows, today, nowH, byHour, hourTl, hourAgent, withTime, past,
      tlNow: leaders(hourTl.get(nowH) || new Map()), agentNow: leaders(hourAgent.get(nowH) || new Map()),
      todayGvTop: topAgentsForToday(rows), todayFfTop: topAgentsForToday(ffTodayRows),
      totalToday: rows.length, hourTotal: byHour[nowH] || 0
    };
  }

  function ffTodayTotal() {
    const daily = S.get('daily') || [];
    const today = todayKey();
    return daily.filter((r) => r.key === today && r.channel !== 'GV Partner').reduce((n, r) => n + (Number(r.n) || 0), 0);
  }

  function openTodayAgent(channel, agentId, agentName) {
    const today = todayKey();
    const match = (r) => {
      const rowId = String(r.agentId || r.id || '').trim();
      const selectedId = String(agentId || '').trim();
      // ID is authoritative when available: same-name agents must not get mixed into the drill-down.
      if (selectedId && rowId) return rowId === selectedId;
      return String(r.agentName || r.name || '').trim().toLowerCase() === String(agentName || '').trim().toLowerCase();
    };
    const rows = channel === 'gv'
      ? (G.rows ? G.rows() : []).filter((r) => r.date && U.dateKey(r.date) === today && match(r))
      : (S.get('agentDailyClass') || []).filter((r) => r.dateKey === today && r.channel === 'First Forward' && match(r));
    const byClass = new Map();
    for (const r of rows) {
      const cls = U.clean(r.cls) || 'Unknown class';
      const n = Number(r.n) > 0 ? Number(r.n) : 1;
      const item = byClass.get(cls) || { total: 0, issuance: 0, replacement: 0, detail: new Map() };
      const type = U.clean(channel === 'gv' ? r.status : r.type).toUpperCase() || 'ISSUANCE';
      const replacement = /replacement/i.test(type);
      item.total += n;
      item[replacement ? 'replacement' : 'issuance'] += n;
      const tagType = U.clean(channel === 'gv' ? r.tagType : r.vrnType) || (channel === 'gv' ? 'Other' : 'Tag type not set');
      const label = `${type} · ${tagType}`;
      item.detail.set(label, (item.detail.get(label) || 0) + n);
      byClass.set(cls, item);
    }
    const total = [...byClass.values()].reduce((n, x) => n + x.total, 0);
    const breakdown = byClass.size ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">Tags</th><th class="num">Issuance</th><th class="num">Replacement</th><th>Tag / EIR type</th></tr></thead><tbody>${[...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([cls, v]) => `<tr><td><b>${esc(cls)}</b></td><td class="num"><b>${fmt(v.total)}</b></td><td class="num">${fmt(v.issuance)}</td><td class="num">${fmt(v.replacement)}</td><td>${[...v.detail.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => `<span class="today-tag-detail">${esc(label)} · <b>${fmt(n)}</b></span>`).join(' ')}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th class="num">${fmt(total)}</th><th class="num">${fmt([...byClass.values()].reduce((n, x) => n + x.issuance, 0))}</th><th class="num">${fmt([...byClass.values()].reduce((n, x) => n + x.replacement, 0))}</th><th></th></tr></tfoot></table></div>` : `<div class="empty">Aaj is agent ki issuance rows nahi mili.</div>`;
    FF.app.openDrawer({
      kicker: channel === 'gv' ? 'GV PARTNER · TODAY' : 'FIRST FORWARD · TODAY',
      title: agentName,
      sub: `Class-wise tag breakdown · ${today} · ${fmt(total)} total tags`,
      body: `<section class="dsec"><h4>🏅 Today’s class-wise tags</h4>${breakdown}</section>`
    });
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
    const leadRow = ([name, v], i, medals, channel, chartMax) => {
      const agentName = v.agentName || (channel ? name : '');
      const clickable = !!channel && !!agentName;
      const max = Math.max(1, Number(chartMax) || Number(v.n) || 1);
      return `<div class="spr-row ${i === 0 ? 'lead' : ''} ${clickable ? 'agent-clickable' : ''}"${clickable ? ` role="button" tabindex="0" data-sprint-agent="${esc(agentName)}" data-sprint-id="${esc(v.agentId || '')}" data-sprint-channel="${esc(channel)}" aria-label="Open ${esc(agentName)}\'s class-wise tags for today"` : ''}><span class="spr-rank">${medals[i] || `#${i + 1}`}</span><b class="spr-name">${esc(agentName || name)}</b><div class="spr-bar-wrap"><div class="spr-bar ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}" style="width:${v.n ? Math.max(6, (v.n / max) * 100) : 0}%"></div></div><em>${fmt(v.n)}</em>${v.agents ? `<small>${fmt(v.agents.size)} agents</small>` : `<small class="dim">${esc(v.tl || (clickable ? 'View class breakdown' : ''))}</small>`}</div>`;
    };
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
        <section class="card"><div class="card-head"><h3>🏅 GV Partner · Today top performers</h3><span class="dim">Click a name for class-wise tags</span></div>
          <div class="card-body">${d.todayGvTop.length ? d.todayGvTop.map((x, i) => leadRow([x.key, x], i, medals, 'gv', d.todayGvTop[0].n)).join('') : '<div class="empty">No GV issuance recorded today.</div>'}</div></section>
        <section class="card"><div class="card-head"><h3>🏅 First Forward · Today top performers</h3><span class="dim">Click a name for class-wise tags</span></div>
          <div class="card-body">${d.todayFfTop.length ? d.todayFfTop.map((x, i) => leadRow([x.key, x], i, medals, 'ff', d.todayFfTop[0].n)).join('') : '<div class="empty">No First Forward issuance found in today’s EIR data.</div>'}</div></section>
      </div>
      <div class="grid g-2">
        <section class="card"><div class="card-head"><h3>🏆 TL Sprint Leaderboard <span class="dim">· ${nowH}:00–${nowH + 1}:00</span></h3></div>
          <div class="card-body">${d.tlNow.length ? d.tlNow.map((x, i) => leadRow(x, i, medals, '', d.tlNow[0][1].n)).join('') : '<div class="card-body empty">Is hour abhi koi GV issuance nahi aayi. ⏳</div>'}</div></section>
        <section class="card"><div class="card-head"><h3>🧑‍💼 Agent Sprint Leaderboard <span class="dim">· ${nowH}:00–${nowH + 1}:00</span></h3></div>
          <div class="card-body">${d.agentNow.length ? d.agentNow.map((x, i) => leadRow(x, i, medals, 'gv', d.agentNow[0][1].n)).join('') : '<div class="card-body empty">Is hour abhi koi agent active nahi. ⏳</div>'}</div></section>
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
    if (!root.dataset.sprintBound) {
      root.dataset.sprintBound = '1';
      const openRow = (row) => row && openTodayAgent(row.dataset.sprintChannel, row.dataset.sprintId, row.dataset.sprintAgent);
      root.addEventListener('click', (e) => { const row = e.target.closest('[data-sprint-agent]'); if (row && root.contains(row)) openRow(row); });
      root.addEventListener('keydown', (e) => { const row = e.target.closest('[data-sprint-agent]'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openRow(row); } });
    }
  }

  async function render(root) {
    root.innerHTML = `<div class="page-head"><div><h1>⏰ Hourly Sprints</h1><p class="sub">Har ghanta ek race…</p></div></div>${U.spinner('GV Master load ho raha hai…')}`;
    try { await G.need('master'); await Promise.allSettled([S.need('daily'), S.need('agentDailyClass')]); } catch (err) { root.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
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

  FF.sprints = { hourOf, topAgentsForToday, sprintData, openTodayAgent, renderBars };
  FF.pages.sprints = { title: 'Hourly Sprints', render };
})(window.FF);
