/* 🎉 WOW ENGINE (v3.10) — Badges & Levels · Daily Challenges · Celebration engine ·
   🏆 Wall of Fame + Winner PNG cards · 🔴 War Room live pulse · 🔮 Crystal Ball.
   Sab kuch existing FF + GV data se derive hota hai — koi nayi sheet nahi chahiye. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const fmt = (v) => U.fmt(v);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null || v === undefined ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
  };

  // ================= LEVELS =================
  const LEVELS = [
    { xp: 0, name: 'Rookie', icon: '🌱' },
    { xp: 100, name: 'Apprentice', icon: '🔧' },
    { xp: 300, name: 'Pro', icon: '⚡' },
    { xp: 700, name: 'Expert', icon: '🎯' },
    { xp: 1500, name: 'Master', icon: '🏅' },
    { xp: 3000, name: 'Elite', icon: '💎' },
    { xp: 6000, name: 'Legend', icon: '👑' },
    { xp: 10000, name: 'Tag Titan', icon: '🏛️' }
  ];
  function levelFor(xp) {
    let idx = 0;
    LEVELS.forEach((L, i) => { if (xp >= L.xp) idx = i; });
    const cur = LEVELS[idx], next = LEVELS[idx + 1] || null;
    return { ...cur, index: idx, next, intoLevel: xp - cur.xp, need: next ? next.xp - cur.xp : 0, progress: next ? Math.max(0, Math.min(1, (xp - cur.xp) / (next.xp - cur.xp))) : 1 };
  }

  // ================= BADGES =================
  const BADGES = [
    { id: 'century', icon: '💯', name: 'Century Club', desc: '100+ total tags', test: (s) => s.total >= 100 },
    { id: 'titan', icon: '🏛️', name: 'Tag Titan', desc: '1,000+ total tags', test: (s) => s.total >= 1000 },
    { id: 'legend', icon: '👑', name: 'Living Legend', desc: '5,000+ total tags', test: (s) => s.total >= 5000 },
    { id: 'vc4king', icon: '🚗', name: 'VC4 Specialist', desc: 'VC4 share 50%+ (min 50 tags is month)', test: (s) => s.ffCur >= 50 && s.vc4Share >= 50 },
    { id: 'streak', icon: '🔥', name: 'Streak Master', desc: '5+ din lagatar active', test: (s) => s.streakDays >= 5 },
    { id: 'consistent', icon: '📅', name: 'Roz Haazir', desc: 'Is month 15+ active days', test: (s) => s.activeDaysCur >= 15 },
    { id: 'highroller', icon: '⚡', name: 'High Roller', desc: 'Ek din me 15+ tags', test: (s) => s.bestDay >= 15 },
    { id: 'comeback', icon: '💪', name: 'Comeback Kid', desc: 'Zero last month, 20+ is month', test: (s) => s.cur >= 20 && s.prev === 0 },
    { id: 'riser', icon: '🚀', name: 'Fast Riser', desc: 'Is month ≥ 2× last month (min 10)', test: (s) => s.prev >= 10 && s.cur >= s.prev * 2 },
    { id: 'veteran', icon: '🎖️', name: 'Veteran', desc: '6+ active months', test: (s) => s.activeMonths >= 6 },
    { id: 'dual', icon: '🔗', name: 'Dual-channel Pro', desc: 'FF + GV dono me active is month', test: (s) => s.ffCur > 0 && s.gvCur > 0 }
  ];

  // ================= CHALLENGES (is month) =================
  const CHALLENGES = [
    { id: 'tags', icon: '🎯', name: 'Tag Machine', goal: `${120} tags is month`, target: 120, value: (s) => s.cur },
    { id: 'days', icon: '📅', name: 'Roz Haazir', goal: '18 active days', target: 18, value: (s) => s.activeDaysCur },
    { id: 'vc4', icon: '🚗', name: 'VC4 Focus', goal: '60 VC4 tags', target: 60, value: (s) => s.vc4 },
    { id: 'streak', icon: '🔥', name: 'Aag Lagao', goal: '7-din ka streak', target: 7, value: (s) => s.streakDays }
  ];

  // ================= STATS BUILDER =================
  const dayDiff = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 864e5);

  /** FF agents-month rows + agentClass rows + GV master rows → agent-wise wow stats. */
  /** TL display for arena rows — 🧍 direct agent ko uske channel ka direct label milta hai. */
  function arenaTlLabel(s) {
    const ch = (s && (s.ffTotal || s.ffCur)) ? 'ff' : (s && (s.gvTotal || s.gvCur) ? 'gv' : '');
    if (ch && FF.config && FF.config.isDirectAgent) {
      const row = { tlName: s.tlName, channel: ch === 'gv' ? 'GV Partner' : 'First Forward' };
      if (FF.config.isDirectAgent(row, ch)) return FF.config.directLabel(row, ch);
    }
    return (s && s.tlName) || '—';
  }

  function buildStats(agentsRows, agentClassRows, gvRows, ym) {
    const prevYm = U.prevMonthKey(ym);
    const map = new Map();
    const get = (name, tlName) => {
      const k = norm(name);
      if (!k) return null;
      let s = map.get(k);
      if (!s) { s = { key: k, name: String(name || '').trim(), tlName: tlName || '', ffTotal: 0, gvTotal: 0, ffCur: 0, gvCur: 0, gvPrev: 0, vc4: 0, byMonth: new Map(), months: new Set(), dayCounts: new Map(), activeDays: new Set() }; map.set(k, s); }
      if (tlName && !s.tlName) s.tlName = tlName;
      return s;
    };
    (agentsRows || []).forEach((r) => {
      if (r.channel === 'GV Partner') return; // GV channel FF EIR me master-ID rows hote hain — GV master se count hote hain
      const s = get(r.name || r.id, r.tlName);
      if (!s) return;
      s.ffTotal += r.n || 0;
      s.byMonth.set(r.ym, (s.byMonth.get(r.ym) || 0) + (r.n || 0));
      s.months.add(r.ym);
      if (r.ym === ym) s.ffCur += r.n || 0;
    });
    (agentClassRows || []).forEach((r) => {
      if (r.channel === 'GV Partner') return;
      if (r.ym !== ym || r.group !== 'VC4') return;
      const s = get(r.name, r.tlName);
      if (s) s.vc4 += r.n || 0;
    });
    (gvRows || []).forEach((r) => {
      const s = get(r.agentName || r.agentId, r.tlName);
      if (!s) return;
      s.gvTotal += 1;
      if (r.ym === ym) { s.gvCur += 1; if (r.date) s.activeDays.add(U.dateKey(r.date)); }
      if (r.ym === prevYm) s.gvPrev += 1;
      if (r.ym) s.months.add(r.ym);
      if (r.date) { const dk = U.dateKey(r.date); s.dayCounts.set(dk, (s.dayCounts.get(dk) || 0) + 1); }
    });
    const out = [];
    map.forEach((s) => {
      const days = [...s.dayCounts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      let bestDay = 0, streakDays = 0, run = 0, last = null;
      days.forEach(([dk, n]) => {
        bestDay = Math.max(bestDay, n);
        run = last !== null && dayDiff(last, dk) === 1 ? run + 1 : 1;
        streakDays = Math.max(streakDays, run);
        last = dk;
      });
      const cur = s.ffCur + s.gvCur;
      const prev = (s.byMonth.get(prevYm) || 0) + s.gvPrev;
      const bestPast = Math.max(0, ...[...s.byMonth.entries()].filter(([m]) => m !== ym).map(([, v]) => v));
      const stat = {
        key: s.key, name: s.name, tlName: s.tlName,
        total: s.ffTotal + s.gvTotal, ffTotal: s.ffTotal, gvTotal: s.gvTotal,
        cur, ffCur: s.ffCur, gvCur: s.gvCur, prev,
        vc4: s.vc4, vc4Share: s.ffCur ? (s.vc4 / s.ffCur) * 100 : 0,
        activeDaysCur: s.activeDays.size, bestDay, streakDays,
        activeMonths: s.months.size, bestPast, recordPace: cur > 0 && bestPast > 0 && cur >= bestPast
      };
      stat.badges = BADGES.filter((b) => { try { return b.test(stat); } catch { return false; } });
      stat.xp = Math.round(stat.total + stat.badges.length * 50);
      stat.level = levelFor(stat.xp);
      stat.challenges = CHALLENGES.map((c) => ({ ...c, value: c.value(stat), done: c.value(stat) >= c.target, pct: Math.min(100, (c.value(stat) / c.target) * 100) }));
      out.push(stat);
    });
    out.sort((a, b) => b.cur - a.cur || b.total - a.total);
    out.forEach((s, i) => { s.rank = i + 1; });
    return out;
  }

  async function loadWow(ym) {
    const month = ym || U.ymKey(new Date());
    const [agents, agentClass] = await Promise.all([S.need('agents'), S.need('agentClass')]);
    await G.need('master').catch(() => []);
    const gvRows = typeof G.rows === 'function' ? G.rows() : [];
    return { month, stats: buildStats(agents || [], agentClass || [], gvRows || [], month) };
  }

  // ================= 🎊 CELEBRATION ENGINE =================
  let confettiBusy = false;
  function fanfare() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        o.connect(g); g.connect(ctx.destination);
        const t = ctx.currentTime + i * 0.12;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        o.start(t); o.stop(t + 0.36);
      });
      setTimeout(() => { try { ctx.close(); } catch { /* done */ } }, 1200);
    } catch { /* audio blocked */ }
  }
  function confettiBurst() {
    if (typeof document === 'undefined' || confettiBusy) return;
    confettiBusy = true;
    try {
      const cv = document.createElement('canvas');
      cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:99999';
      cv.width = window.innerWidth; cv.height = window.innerHeight;
      document.body.appendChild(cv);
      const ctx = cv.getContext('2d');
      const colors = ['#6366f1', '#a855f7', '#f59e0b', '#22c55e', '#ef4444', '#06b6d4', '#f472b6', '#facc15'];
      const parts = Array.from({ length: 160 }, () => ({
        x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.4,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
        vy: 2.2 + Math.random() * 3.4, vx: -1.6 + Math.random() * 3.2,
        rot: Math.random() * Math.PI, vr: -0.12 + Math.random() * 0.24,
        color: colors[Math.floor(Math.random() * colors.length)]
      }));
      const start = Date.now();
      (function tick() {
        const t = Date.now() - start;
        ctx.clearRect(0, 0, cv.width, cv.height);
        parts.forEach((p) => {
          p.y += p.vy; p.x += p.vx + Math.sin((t / 300) + p.rot) * 0.6; p.rot += p.vr;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        });
        if (t < 2600) requestAnimationFrame(tick);
        else { cv.remove(); confettiBusy = false; }
      })();
    } catch { confettiBusy = false; }
  }
  /** 🏆 celebrate(title, sub) — trophy toast + fanfare + confetti blast. */
  function celebrate(title, sub) {
    if (typeof document === 'undefined') return;
    if (U.toast) U.toast(`🏆 ${title}${sub ? ` — ${sub}` : ''}`, 'ok', 6000);
    fanfare();
    confettiBurst();
  }
  /** Ek baar per key celebrate hota hai (localStorage guard) — true return agar naya hai. */
  function celebrateOnce(key, title, sub) {
    const seen = LS.get('ff-wow-seen', {});
    if (seen[key]) return false;
    seen[key] = Date.now();
    LS.set('ff-wow-seen', seen);
    celebrate(title, sub);
    return true;
  }

  // ================= 🎴 WINNER CARD (PNG) =================
  function winnerCardPng(opts) {
    const { name, rank, monthLabel, tags, sub, channel } = opts;
    const W = 1080, H = 1080;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const gv = /gv/i.test(channel || '');
    const grad = ctx.createLinearGradient(0, 0, W, H);
    if (gv) { grad.addColorStop(0, '#0f766e'); grad.addColorStop(0.55, '#115e59'); grad.addColorStop(1, '#1e1b4b'); }
    else { grad.addColorStop(0, '#4338ca'); grad.addColorStop(0.55, '#6d28d9'); grad.addColorStop(1, '#0f172a'); }
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.05})`;
      ctx.beginPath(); ctx.arc(Math.random() * W, Math.random() * H, 2 + Math.random() * 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.font = '150px serif';
    ctx.fillText(rank === 1 ? '🏆' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎖️', W / 2, 250);
    ctx.fillStyle = '#facc15';
    ctx.font = '700 44px system-ui, sans-serif';
    ctx.fillText(`RANK #${rank} — ${monthLabel}`, W / 2, 330);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 92px system-ui, sans-serif';
    const nm = String(name || 'Champion');
    ctx.fillText(nm.length > 18 ? nm.slice(0, 17) + '…' : nm, W / 2, 450);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '600 46px system-ui, sans-serif';
    ctx.fillText(`${fmt(tags)} tags`, W / 2, 540);
    if (sub) { ctx.font = '400 34px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.fillText(String(sub).slice(0, 48), W / 2, 600); }
    ctx.strokeStyle = 'rgba(250,204,21,.8)'; ctx.lineWidth = 6;
    ctx.strokeRect(60, 60, W - 120, H - 120);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '700 36px system-ui, sans-serif';
    ctx.fillText(gv ? 'GV PARTNER · FASTag CHAMPION' : 'FIRST FORWARD · FASTag CHAMPION', W / 2, 900);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = '400 28px system-ui, sans-serif';
    ctx.fillText('Apna Payment Dashboard', W / 2, 960);
    return cv.toDataURL('image/png');
  }
  function downloadWinnerCard(opts) {
    try {
      const url = winnerCardPng(opts);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${U.slug(`winner-${opts.name}-r${opts.rank}-${opts.monthLabel}`)}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      if (U.toast) U.toast('🎴 Winner card PNG download ho gaya', 'ok');
    } catch { if (U.toast) U.toast('Card nahi ban paya', 'err'); }
  }

  // ================= 🔮 CRYSTAL BALL =================
  function crystal(daily, stats, ym) {
    const ffRows = (daily || []).filter((r) => r.channel !== 'GV Partner');
    const ff = ffRows.length ? M.summary(ffRows, ym) : null;
    const gv = G && typeof G.summary === 'function' ? G.summary(ym) : null;
    const confOf = (s) => (s && s.activeDays ? Math.min(97, Math.round(38 + s.activeDays * 2.4)) : 0);
    const recordWatch = stats.filter((s) => s.recordPace && s.cur >= 15).slice(0, 6);
    return {
      ffProj: ff ? ff.projected : 0, gvProj: gv ? gv.projected : 0,
      combined: (ff ? ff.projected : 0) + (gv ? gv.projected : 0),
      ffConf: confOf(ff), gvConf: confOf(gv),
      ffSoFar: ff ? ff.total : 0, gvSoFar: gv ? gv.total : 0,
      recordWatch
    };
  }

  // ================= 🎮 AGENT ARENA PAGE =================
  async function renderArena(root, params) {
    const UI = (FF.insights && FF.insights.ui) || {};
    const ym = U.ymKey(new Date());
    root.innerHTML = UI.head('🎮', 'Agent Arena', 'Levels · badges · monthly challenges · crystal ball — sab kuch live data se', `<a class="btn" href="#/fame">🏆 Wall of Fame</a><a class="btn" href="#/warRoom">🔴 War Room</a>`) +
      `<div id="arena-body">${U.spinner('Arena ready ho raha hai…')}</div>`;
    const body = U.$('#arena-body', root);
    const clean = (v) => String(v || '').trim();
    try { var data = await loadWow(ym); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    const { stats } = data;
    const q = clean((params || {}).q).toLowerCase();
    const list = stats.filter((s) => !q || `${s.name} ${s.tlName}`.toLowerCase().includes(q));
    const totalBadges = U.sum(stats, (s) => s.badges.length);
    const totalXp = U.sum(stats, (s) => s.xp);
    const topLevel = stats.slice().sort((a, b) => b.xp - a.xp)[0];
    const challengesDone = U.sum(stats, (s) => s.challenges.filter((c) => c.done).length);
    const cr = crystal((S.get && S.get('daily')) || [], stats, ym);

    // naye badge unlocks + challenge completes par celebration (sirf top-50 list ke liye, spam na ho)
    const ymKey = ym;
    stats.slice(0, 50).forEach((s) => {
      s.badges.forEach((b) => { if (s.cur > 0) celebrateOnce(`${ymKey}-badge-${s.key}-${b.id}`, `${s.name} ne "${b.name}" badge unlock kiya`, `${b.icon} ${b.desc}`); });
      s.challenges.filter((c) => c.done).forEach((c) => celebrateOnce(`${ymKey}-ch-${s.key}-${c.id}`, `${s.name} ne challenge complete kiya`, `${c.icon} ${c.name}`));
    });
    // 🎖️ Level-Up Ceremony (v3.11) — jab koi agent naye level par promote ho to fullscreen golden
    // ceremony + trumpet (ek hi baar per level, localStorage guard se). Top-3 tak hi, spam control.
    const promotions = [];
    stats.slice(0, 3).forEach((s) => {
      const seen = LS.get('ff-levelup', {});
      const before = seen[s.key];
      const isUp = before && before !== s.level.name
        && LEVELS.map((l) => l.name).indexOf(s.level.name) > LEVELS.map((l) => l.name).indexOf(before);
      if (isUp && s.cur > 0) promotions.push({ name: s.name, icon: s.level.icon, from: before, to: s.level.name, stats: [{ label: 'Is month', value: fmt(s.cur) }, { label: 'XP', value: fmt(s.xp) }, { label: 'Badges', value: fmt(s.badges.length) }] });
    });
    if (FF.wowzone && FF.wowzone.celebratePromotion) {
      stats.slice(0, 50).forEach((s) => FF.wowzone.celebratePromotion(s.name, s.level.icon, s.level.name, [{ label: 'Is month', value: fmt(s.cur) }, { label: 'XP', value: fmt(s.xp) }, { label: 'Badges', value: fmt(s.badges.length) }]));
    }
    const promotionBanner = promotions.length ? `<section class="card card-warning"><div class="card-head"><h3>🎖️ Level-up ceremony ready</h3><span class="dim small">Promotion detect hui — dobara dekhne ke liye click karo</span></div>
      <div class="btn-row" style="padding:0 4px 6px">${promotions.map((p, i) => `<button class="btn small primary" data-levelup="${i}">${p.icon} ${esc(p.name)} — ${esc(p.from)} → ${esc(p.to)}</button>`).join('')}</div>
      <p class="dim small" style="margin:6px 0 0">Golden ceremony screen + trumpet bajta hai; poori team ke saath celebrate karo 🎉</p></section>` : '';

    const badgeIcon = (b) => `<span class="wow-badge-chip" data-tip="<b>${esc(b.name)}</b><br>${esc(b.desc)}">${b.icon}</span>`;
    const levelBar = (s) => `<div class="wow-levelbar"><div class="wow-levelbar-fill" style="width:${(s.level.progress * 100).toFixed(0)}%"></div></div>`;

    body.innerHTML = `
      ${UI.vividMetrics ? UI.vividMetrics([
        { label: 'Arena players', value: fmt(stats.length), foot: 'FF + GV dono channels ke agents', tone: 'g1', icon: '🎮' },
        { label: 'Badges earned', value: fmt(totalBadges), foot: `${BADGES.length} badge types available`, tone: 'g4', icon: '🎖️' },
        { label: 'Total XP', value: fmt(totalXp), foot: '1 tag = 1 XP · badge = +50 XP', tone: 'g6', icon: '✨' },
        { label: 'Highest level', value: topLevel ? `${topLevel.level.icon} ${esc(topLevel.level.name)}` : '—', foot: topLevel ? `${esc(topLevel.name)} · ${fmt(topLevel.xp)} XP` : 'data load nahi hua', tone: 'g11', icon: '👑' },
        { label: 'Challenges done', value: fmt(challengesDone), foot: `${CHALLENGES.length} monthly challenges × ${fmt(stats.length)} players`, tone: 'g9', icon: '🎯' },
        { label: 'Record-pace agents', value: fmt(cr.recordWatch.length), foot: 'apna best month todne ke pace par', tone: cr.recordWatch.length ? 'g7' : 'g9', icon: '🔮' }
      ]) : ''}
      ${promotionBanner}
      <section class="card wow-crystal">
        <div class="card-head"><h3>🔮 Crystal Ball · ${esc(U.labelYM(ym, true))}</h3><span class="dim small">Month-end projection + confidence · run-rate based</span></div>
        <div class="wow-crystal-grid">
          <div class="wow-orb ff"><small>First Forward</small><b>${fmt(cr.ffProj)}</b><span>${fmt(cr.ffSoFar)} ab tak · confidence ${cr.ffConf}%</span></div>
          <div class="wow-orb gv"><small>GV Partner</small><b>${fmt(cr.gvProj)}</b><span>${fmt(cr.gvSoFar)} ab tak · confidence ${cr.gvConf}%</span></div>
          <div class="wow-orb both"><small>Combined month-end</small><b>${fmt(cr.combined)}</b><span> dono channels ka projected total</span></div>
        </div>
        ${cr.recordWatch.length ? `<div class="wow-record"><b>🚨 Record watch:</b> ${cr.recordWatch.map((s) => `<span class="wow-record-chip" data-tip="Best month ${fmt(s.bestPast)} · ab tak ${fmt(s.cur)}">${esc(s.name)} <i>${fmt(s.cur)}</i></span>`).join('')} — ye agents apna personal best todne ke pace par hain!</div>` : '<p class="dim small">Abhi koi agent record pace par nahi hai.</p>'}
      </section>
      <section class="card">
        <div class="card-head"><h3>🎯 Is month ke challenges</h3><span class="dim small">Complete karo → confetti + celebration 🎊</span></div>
        <div class="wow-challenges">${CHALLENGES.map((c) => {
          const done = U.sum(stats, (s) => (s.challenges.find((x) => x.id === c.id) || {}).done ? 1 : 0);
          return `<div class="wow-challenge"><span class="wow-challenge-icon">${c.icon}</span><div><b>${esc(c.name)}</b><small>${esc(c.goal)}</small></div><div class="wow-challenge-count"><b>${fmt(done)}</b><span>players done</span></div></div>`;
        }).join('')}</div>
      </section>
      <section class="card">
        <div class="card-head"><h3>🏅 Leaderboard · level + badges</h3>
          <form id="arena-search" class="ins-search" style="margin:0"><input class="input" name="q" value="${esc((params || {}).q || '')}" placeholder="Agent ya TL search karo…"><button class="btn">Search</button></form>
        </div>
        <div class="table-wrap"><table class="data-table ins-table wow-table"><thead><tr><th class="tone-violet">#</th><th class="tone-violet">Agent</th><th class="tone-violet">Level</th><th class="tone-violet num">XP</th><th class="tone-violet">Badges</th><th class="tone-violet num">Is month</th><th class="tone-violet num">Streak</th><th class="tone-violet num">VC4</th><th class="tone-violet">Challenges</th></tr></thead><tbody>
          ${list.slice(0, 100).map((s) => `<tr>
            <td>${s.rank <= 3 ? ['🥇', '🥈', '🥉'][s.rank - 1] : s.rank}</td>
            <td><b>${esc(s.name)}</b><small>${esc(arenaTlLabel(s))} · total ${fmt(s.total)}</small></td>
            <td><span class="wow-level">${s.level.icon} ${esc(s.level.name)}</span>${levelBar(s)}<small class="dim">${s.level.next ? `${fmt(s.level.intoLevel)}/${fmt(s.level.need)} XP` : 'MAX level 🏆'}</small></td>
            <td class="num"><b>${fmt(s.xp)}</b></td>
            <td>${s.badges.map(badgeIcon).join('') || '<span class="dim">—</span>'}</td>
            <td class="num"><b>${fmt(s.cur)}</b><small class="dim">prev ${fmt(s.prev)}</small></td>
            <td class="num">${s.streakDays ? `🔥 ${s.streakDays}d` : '<span class="dim">—</span>'}</td>
            <td class="num">${fmt(s.vc4)}<small class="dim">${s.vc4Share.toFixed(0)}%</small></td>
            <td>${s.challenges.map((c) => `<span class="wow-chip ${c.done ? 'done' : ''}" data-tip="<b>${esc(c.name)}</b><br>${fmt(c.value)}/${fmt(c.target)} — ${esc(c.goal)}">${c.icon}</span>`).join('')}</td>
          </tr>`).join('') || '<tr><td colspan="9">Koi agent nahi mila.</td></tr>'}
        </tbody></table></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>🎖️ Badge gallery</h3><span class="dim small">Kitne players ne kaunsa badge jeeta</span></div>
        <div class="wow-gallery">${BADGES.map((b) => { const n = stats.filter((s) => s.badges.some((x) => x.id === b.id)).length; return `<div class="wow-gallery-item ${n ? 'won' : ''}"><span>${b.icon}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small><em>${fmt(n)} players</em></div>`; }).join('')}</div>
      </section>`;

    const search = U.$('#arena-search', root);
    if (search) search.addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(search).get('q') || '' }); });
    // 🎖️ ceremony ko dobara dekhne ke liye buttons
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-levelup]');
      if (!b || !FF.wowzone) return;
      const p = promotions[Number(b.dataset.levelup)];
      if (p) FF.wowzone.levelUpCeremony(p);
    });
    if (UI.bindMetricDetails) UI.bindMetricDetails(body, 'Agent Arena · full data', ['Rank', 'Agent', 'TL', 'Level', 'XP', 'Is month', 'Prev', 'Total', 'Streak', 'Badges'], stats.map((s) => [s.rank, s.name, arenaTlLabel(s), s.level.name, s.xp, s.cur, s.prev, s.total, s.streakDays, s.badges.map((b) => b.name).join(', ')]), {
      'Arena players': { title: 'Sab players XP order me', headers: ['Rank', 'Agent', 'Level', 'XP', 'Total tags'], rows: stats.slice().sort((a, b) => b.xp - a.xp).map((s) => [s.rank, s.name, `${s.level.icon} ${s.level.name}`, s.xp, s.total]) },
      'Badges earned': { title: 'Badge-wise winners', headers: ['Badge', 'Players'], rows: BADGES.map((b) => [`${b.icon} ${b.name} — ${b.desc}`, stats.filter((s) => s.badges.some((x) => x.id === b.id)).length]) },
      'Total XP': { title: 'XP leaderboard', headers: ['Rank', 'Agent', 'XP', 'Level', 'Badges'], rows: stats.slice().sort((a, b) => b.xp - a.xp).map((s) => [s.rank, s.name, s.xp, s.level.name, s.badges.length]) },
      'Challenges done': { title: 'Challenge completion', headers: ['Challenge', 'Goal', 'Players done'], rows: CHALLENGES.map((c) => [`${c.icon} ${c.name}`, c.goal, stats.filter((s) => (s.challenges.find((x) => x.id === c.id) || {}).done).length]) },
      'Record-pace agents': { title: 'Personal best todne ke pace par', headers: ['Agent', 'Is month', 'Best month', 'Total'], rows: cr.recordWatch.map((s) => [s.name, s.cur, s.bestPast, s.total]) }
    });
  }

  // ================= 🏆 WALL OF FAME PAGE =================
  async function renderFame(root) {
    const UI = (FF.insights && FF.insights.ui) || {};
    const ymNow = U.ymKey(new Date());
    root.innerHTML = UI.head('🏆', 'Wall of Fame', 'Har month ke FF + GV champions · winner card PNG banao aur WhatsApp par bhejo', `<a class="btn" href="#/arena">🎮 Agent Arena</a>`) +
      `<div id="fame-body">${U.spinner('Champions load ho rahe hain…')}</div>`;
    const body = U.$('#fame-body', root);
    try {
      const [agents] = await Promise.all([S.need('agents'), G.need('master').catch(() => [])]);
      var champions = [];
      const months = U.uniq((agents || []).map((r) => r.ym)).sort().reverse().slice(0, 6);
      months.forEach((m) => {
        const ff = (agents || []).filter((r) => r.ym === m && r.channel !== 'GV Partner');
        const ffTop = U.topEntries(U.groupSum(ff, (r) => r.name, (r) => r.n), 3);
        const gvTop = G.agentRollup && typeof G.agentRollup === 'function' ? (G.agentRollup(m) || []).slice(0, 3).map((a) => [a.agentName, a.total]) : [];
        champions.push({ month: m, ff: ffTop, gv: gvTop });
      });
    } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    const medal = (i) => ['🥇', '🥈', '🥉'][i] || '🎖️';
    const champCard = (name, tags, i, channel, month) => `
      <div class="fame-champ ${i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze'}">
        <span class="fame-medal">${medal(i)}</span>
        <b>${esc(name)}</b>
        <small>${fmt(tags)} tags</small>
        <button class="btn small fame-card-btn" data-fame="${esc(JSON.stringify({ name, rank: i + 1, monthLabel: U.labelYM(month, true), tags, channel }))}">🎴 Winner card</button>
      </div>`;
    const cur = champions.find((c) => c.month === ymNow);
    body.innerHTML = `
      <div class="card fame-hero">
        <div class="card-head"><h3>⭐ Is month ke champions · ${esc(U.labelYM(ymNow, true))}</h3><span class="dim small">Ab tak ke standings — month end tak race chalti rahegi!</span></div>
        <div class="fame-row">
          <div class="fame-col"><h4>🟦 First Forward</h4>${(cur && cur.ff.length ? cur.ff : [['—', 0]]).slice(0, 3).map(([n, v], i) => champCard(n, v, i, 'First Forward', ymNow)).join('')}</div>
          <div class="fame-col"><h4>🟩 GV Partner</h4>${(cur && cur.gv.length ? cur.gv : [['—', 0]]).slice(0, 3).map(([n, v], i) => champCard(n, v, i, 'GV Partner', ymNow)).join('')}</div>
        </div>
        <p class="dim small">🎴 Winner card = shareable PNG (1080×1080) — download karke WhatsApp status/group me bhejo. Employees ko unki jeet dikhao!</p>
      </div>
      ${champions.map((c) => `
      <div class="card">
        <div class="card-head"><h3>🗓️ ${esc(U.labelYM(c.month, true))}</h3>${c.month === ymNow ? '<span class="dim small">current month (live)</span>' : '<span class="dim small">final</span>'}</div>
        <div class="fame-row">
          <div class="fame-col"><h4>🟦 First Forward</h4>${(c.ff.length ? c.ff : [['—', 0]]).slice(0, 3).map(([n, v], i) => champCard(n, v, i, 'First Forward', c.month)).join('')}</div>
          <div class="fame-col"><h4>🟩 GV Partner</h4>${(c.gv.length ? c.gv : [['—', 0]]).slice(0, 3).map(([n, v], i) => champCard(n, v, i, 'GV Partner', c.month)).join('')}</div>
        </div>
      </div>`).join('')}`;
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fame]');
      if (!btn) return;
      try { downloadWinnerCard(JSON.parse(btn.dataset.fame)); } catch { /* bad json */ }
    });
  }

  // ================= 🔴 WAR ROOM =================
  async function renderWarRoom(root) {
    const ym = U.ymKey(new Date());
    root.innerHTML = `<div class="war-room" id="war-body"><div class="war-loading">🔴 War Room connect ho raha hai…</div></div>`;
    const body = U.$('#war-body', root);
    let timer = null;
    const draw = async () => {
      if (!root.isConnected) { if (timer) clearInterval(timer); return; }
      try {
        const [daily, agents] = await Promise.all([S.need('daily'), S.need('agents')]);
        await G.need('master').catch(() => []);
        if (!root.isConnected) return;
        const today = U.dateKey(new Date());
        const ffToday = (daily || []).filter((r) => r.key === today && r.channel !== 'GV Partner').reduce((n, r) => n + (Number(r.n) || 0), 0);
        const gvRows = typeof G.rows === 'function' ? G.rows() : [];
        const gvToday = gvRows.filter((r) => r.date && U.dateKey(r.date) === today).length;
        const ffM = (daily || []).filter((r) => r.ym === ym && r.channel !== 'GV Partner').reduce((n, r) => n + (Number(r.n) || 0), 0);
        const gvM = gvRows.filter((r) => r.ym === ym).length;
        const ffSum = (daily || []).filter((r) => r.channel !== 'GV Partner' && r.ym === ym).length ? M.summary((daily || []).filter((r) => r.channel !== 'GV Partner'), ym) : null;
        const gvSum = typeof G.summary === 'function' ? G.summary(ym) : null;
        const ffProj = ffSum ? ffSum.projected : ffM, gvProj = gvSum ? gvSum.projected : gvM;
        const ffTop = U.topEntries(U.groupSum((agents || []).filter((a) => a.ym === ym && a.channel !== 'GV Partner'), (a) => a.name, (a) => a.n), 5);
        const gvTop = typeof G.agentRollup === 'function' ? (G.agentRollup(ym) || []).slice(0, 5).map((a) => [a.agentName, a.total]) : [];
        const lastGv = gvRows.filter((r) => r.date && U.dateKey(r.date) === today).slice(-6).reverse();
        // ---- 📊 Detailed breakdown: VC4 / VC20 / VC5+ · chassis · replacement · wrong VRN (FF + GV) ----
        const ffTodayRows = (daily || []).filter((r) => r.key === today && r.channel !== 'GV Partner');
        const gvTodayRows = gvRows.filter((r) => r.date && U.dateKey(r.date) === today);
        const vc4Today = U.sum(ffTodayRows.filter((r) => r.group === 'VC4'), (r) => r.n) + gvTodayRows.filter((r) => r.group === 'VC4').length;
        const vc20Today = U.sum(ffTodayRows.filter((r) => r.group === 'VC20'), (r) => r.n) + gvTodayRows.filter((r) => r.group === 'VC20').length;
        const vc5Today = U.sum(ffTodayRows.filter((r) => r.group && r.group !== 'VC4' && r.group !== 'VC20'), (r) => r.n) + gvTodayRows.filter((r) => r.group && r.group !== 'VC4' && r.group !== 'VC20').length;
        const replToday = U.sum(ffTodayRows.filter((r) => /replacement/i.test(r.type || '')), (r) => r.n) + gvTodayRows.filter((r) => /replacement/i.test(r.status || '')).length;
        const chassisToday = U.sum(ffTodayRows.filter((r) => /chassis/i.test(r.type || '')), (r) => r.n) + gvTodayRows.filter((r) => /chassis/i.test(r.tagType || '')).length;
        const wrongToday = U.sum(ffTodayRows.filter((r) => /wrong/i.test(r.vrnType || '')), (r) => r.n);
        const agentsToday = new Set([...ffTodayRows.map((r) => r.name), ...gvTodayRows.map((r) => r.agentName)]).size;
        // per-TL breakdown (today)
        const tlToday = new Map();
        const bump = (tl, ch, r) => {
          // 🧍 Direct agents alag group — kisi asli TL ke under nahi.
          const direct = FF.config.isDirectAgent(r, ch === 'gv' ? 'gv' : 'ff');
          const key = direct ? FF.config.directLabel(r, ch === 'gv' ? 'gv' : 'ff') : (FF.config.isRealTl(tl) ? tl : 'Unassigned');
          const o = tlToday.get(key) || { tl: key, ff: 0, gv: 0, vc4: 0, comm: 0, repl: 0, chassis: 0 };
          if (ch === 'ff') { o.ff += r.n || 0; if (r.group === 'VC4') o.vc4 += r.n || 0; else o.comm += r.n || 0; if (/replacement/i.test(r.type || '')) o.repl += r.n || 0; if (/chassis/i.test(r.type || '')) o.chassis += r.n || 0; }
          else { o.gv += 1; if (r.group === 'VC4') o.vc4 += 1; else o.comm += 1; if (/replacement/i.test(r.status || '')) o.repl += 1; if (/chassis/i.test(r.tagType || '')) o.chassis += 1; }
          tlToday.set(key, o);
        };
        ffTodayRows.forEach((r) => bump(r.tlName, 'ff', r));
        gvTodayRows.forEach((r) => bump(r.tlName, 'gv', r));
        const tlTable = [...tlToday.values()].sort((a, b) => (b.ff + b.gv) - (a.ff + a.gv)).slice(0, 12);
        // month-to-date detail too (VC4/VC20/VC5+, chassis, replacement, wrong VRN)
        const ffMonthRows = (daily || []).filter((r) => r.ym === ym && r.channel !== 'GV Partner');
        const gvMonthRows = gvRows.filter((r) => r.ym === ym);
        const mtd = {
          vc4: U.sum(ffMonthRows.filter((r) => r.group === 'VC4'), (r) => r.n) + gvMonthRows.filter((r) => r.group === 'VC4').length,
          vc20: U.sum(ffMonthRows.filter((r) => r.group === 'VC20'), (r) => r.n) + gvMonthRows.filter((r) => r.group === 'VC20').length,
          vc5p: U.sum(ffMonthRows.filter((r) => r.group && r.group !== 'VC4' && r.group !== 'VC20'), (r) => r.n) + gvMonthRows.filter((r) => r.group && r.group !== 'VC4' && r.group !== 'VC20').length,
          repl: U.sum(ffMonthRows.filter((r) => /replacement/i.test(r.type || '')), (r) => r.n) + gvMonthRows.filter((r) => /replacement/i.test(r.status || '')).length,
          chassis: U.sum(ffMonthRows.filter((r) => /chassis/i.test(r.type || '')), (r) => r.n) + gvMonthRows.filter((r) => /chassis/i.test(r.tagType || '')).length,
          wrong: U.sum(ffMonthRows.filter((r) => /wrong/i.test(r.vrnType || '')), (r) => r.n)
        };
        const liveStamp = new Date().toLocaleTimeString('en-IN', { hour12: false });
        const dataStamps = [
          S.loadedAt ? `FF data ${new Date(S.loadedAt).toLocaleTimeString('en-IN', { hour12: false })}` : 'FF data —',
          G.loadedAt ? `GV data ${new Date(G.loadedAt).toLocaleTimeString('en-IN', { hour12: false })}` : 'GV data —'
        ].join(' · ');
        const daysIn = U.daysInMonth(ym), dayNow = new Date().getDate();
        const targetToday = Math.ceil((ffProj + gvProj) / daysIn);
        const combined = ffToday + gvToday;
        const leader = (ffTop[0] || [])[0] || '—', leaderGv = (gvTop[0] || [])[0] || '—';
        // 🚨 leader-change siren (per session)
        const prevLeader = LS.get('ff-war-leader', '');
        const curLeader = `${leader}|${leaderGv}`;
        if (prevLeader && prevLeader !== curLeader && combined > 0) { LS.set('ff-war-leader', curLeader); celebrate('🚨 Lead change!', `FF: ${leader} · GV: ${leaderGv}`); }
        else if (!prevLeader) LS.set('ff-war-leader', curLeader);
        body.innerHTML = `
          <div class="war-top">
            <div class="war-live-dot"></div>
            <h1>🔴 WAR ROOM · ${esc(new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }))}</h1>
            <span class="war-clock" id="war-clock">${new Date().toLocaleTimeString('en-IN')}</span>
            <button class="btn small" id="war-full">⛶ Fullscreen</button>
          </div>
          <div class="war-counters">
            <div class="war-counter ff"><small>AAJ · FIRST FORWARD</small><b data-count="${ffToday}">0</b></div>
            <div class="war-counter gv"><small>AAJ · GV PARTNER</small><b data-count="${gvToday}">0</b></div>
            <div class="war-counter total"><small>AAJ KA TOTAL</small><b data-count="${combined}">0</b><span>target pace ≈ ${fmt(targetToday)}/din</span></div>
            <div class="war-counter month"><small>MONTH ${esc(U.labelYM(ym))}</small><b data-count="${ffM + gvM}">0</b><span>projected ${fmt(Math.round(ffProj + gvProj))}</span></div>
          </div>
          <div class="war-mid">
            <div class="war-panel">
              <h3>🏁 Aaj ka race</h3>
              <div class="war-race">
                <div class="war-race-row"><span>🟦 FF</span><div class="war-race-track"><div class="war-race-fill ff" style="width:${combined ? (ffToday / combined) * 100 : 0}%"></div></div><b>${fmt(ffToday)}</b></div>
                <div class="war-race-row"><span>🟩 GV</span><div class="war-race-track"><div class="war-race-fill gv" style="width:${combined ? (gvToday / combined) * 100 : 0}%"></div></div><b>${fmt(gvToday)}</b></div>
              </div>
              <p class="war-note">Day ${dayNow} of ${daysIn} · month-end projection FF ${fmt(Math.round(ffProj))} + GV ${fmt(Math.round(gvProj))}</p>
            </div>
            <div class="war-panel">
              <h3>👑 Is month ke leaders</h3>
              <div class="war-leaders">
                <div><small>🟦 FF top</small><b>${esc(leader)}</b><span>${fmt((ffTop[0] || [])[1] || 0)} tags</span></div>
                <div><small>🟩 GV top</small><b>${esc(leaderGv)}</b><span>${fmt((gvTop[0] || [])[1] || 0)} tags</span></div>
              </div>
              <div class="war-toplist">${[...ffTop.slice(0, 3).map(([n, v]) => ({ ch: '🟦', n, v })), ...gvTop.slice(0, 3).map(([n, v]) => ({ ch: '🟩', n, v }))].sort((a, b) => b.v - a.v).slice(0, 5).map((r) => `<div class="war-toprow"><span>${r.ch}</span><b>${esc(r.n)}</b><em>${fmt(r.v)}</em></div>`).join('')}</div>
            </div>
            <div class="war-panel">
              <h3>⚡ Live ticker · GV latest</h3>
              <div class="war-ticker">${lastGv.map((r) => `<div class="war-tick"><span class="war-tick-dot"></span><b>${esc(r.agentName || r.agentId || 'Agent')}</b><small>${FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : (r.tlName || '')} · ${new Date(r.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></div>`).join('') || '<p class="war-note">Aaj abhi koi GV activity nahi.</p>'}</div>
            </div>
          </div>
          <div class="war-detail">
            <div class="war-detail-card">
              <h3>📊 Aaj ka detailed breakdown · ${esc(new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</h3>
              <div class="war-kv">
                <div class="issuance"><small>Issuance</small><b>${fmt(Math.max(0, combined - replToday))}</b></div>
                <div class="repl"><small>🔁 Replacement</small><b>${fmt(replToday)}</b></div>
                <div class="vc4"><small>🚗 VC4 tags</small><b>${fmt(vc4Today)}</b></div>
                <div class="vc20"><small>🚚 VC20 tags</small><b>${fmt(vc20Today)}</b></div>
                <div class="vc5p"><small>🚛 VC5+ tags</small><b>${fmt(vc5Today)}</b></div>
                <div class="chassis"><small>🔧 Chassis</small><b>${fmt(chassisToday)}</b></div>
                <div class="wrong"><small>🧩 Wrong VRN</small><b>${fmt(wrongToday)}</b></div>
                <div class="agents"><small>🧑‍💼 Active agents</small><b>${fmt(agentsToday)}</b></div>
              </div>
              <p class="war-note">Total aaj ${fmt(combined)} tags (FF ${fmt(ffToday)} · GV ${fmt(gvToday)}) · VC4 share ${combined ? (((vc4Today / combined) * 100).toFixed(0)) : 0}% · wrong-VRN ${combined ? (((wrongToday / combined) * 100).toFixed(2)) : 0}%</p>
            </div>
            <div class="war-detail-card">
              <h3>🗓️ Month-to-date detail · ${esc(U.labelYM(ym))}</h3>
              <div class="war-kv">
                <div class="vc4"><small>🚗 VC4 (payable)</small><b>${fmt(mtd.vc4)}</b></div>
                <div class="vc20"><small>🚚 VC20</small><b>${fmt(mtd.vc20)}</b></div>
                <div class="vc5p"><small>🚛 VC5+</small><b>${fmt(mtd.vc5p)}</b></div>
                <div class="repl"><small>🔁 Replacement</small><b>${fmt(mtd.repl)}</b></div>
                <div class="chassis"><small>🔧 Chassis</small><b>${fmt(mtd.chassis)}</b></div>
                <div class="wrong"><small>🧩 Wrong VRN (FF)</small><b>${fmt(mtd.wrong)}</b></div>
              </div>
              <p class="war-note">Commercial = VC20 + VC5+ = ${fmt(mtd.vc20 + mtd.vc5p)} · projected month-end ${fmt(Math.round(ffProj + gvProj))} · day ${dayNow}/${daysIn}</p>
            </div>
            <div class="war-detail-card" style="grid-column:1/-1">
              <h3>👥 TL-wise aaj ka detail</h3>
              ${tlTable.length ? `<table class="war-table"><thead><tr><th>TL</th><th class="num">FF</th><th class="num">GV</th><th class="num">VC4</th><th class="num">Comm.</th><th class="num">Repl.</th><th class="num">Chassis</th><th class="num">Total</th></tr></thead><tbody>
                ${tlTable.map((t) => `<tr><td><b>${esc(t.tl)}</b></td><td class="num">${fmt(t.ff)}</td><td class="num">${fmt(t.gv)}</td><td class="num">${fmt(t.vc4)}</td><td class="num">${fmt(t.comm)}</td><td class="num">${fmt(t.repl)}</td><td class="num">${fmt(t.chassis)}</td><td class="num"><b>${fmt(t.ff + t.gv)}</b></td></tr>`).join('')}
              </tbody></table>` : '<p class="war-note">Aaj abhi kisi TL ki activity nahi aayi.</p>'}
              <p class="war-note">Aaj ke tags channel + class + type ke hisaab se — TL-wise dispatch aur quality review ke liye.</p>
            </div>
          </div>
          <div class="war-foot">Auto-refresh har 30 sec · last render <span class="live-instant">${esc(liveStamp)}</span> · ${esc(dataStamps)} · data: EIR + GV Master · <a href="#/arena">🎮 Arena</a> · <a href="#/fame">🏆 Fame</a> · <a href="#/activity">📅 Calendar</a></div>`;
        // count-up animation
        body.querySelectorAll('[data-count]').forEach((el) => {
          const target = Number(el.dataset.count) || 0, t0 = Date.now(), dur = 900;
          const step = () => {
            const p = Math.min(1, (Date.now() - t0) / dur);
            el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - p, 3))));
            if (p < 1) requestAnimationFrame(step);
          };
          step();
        });
        const fs = body.querySelector('#war-full');
        if (fs) fs.addEventListener('click', () => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch { /* not supported */ } });
      } catch (err) {
        if (root.isConnected) body.innerHTML = U.errorBox(err, 'data-action="refresh"');
      }
    };
    await draw();
    timer = setInterval(draw, 30000);
    const clockTimer = setInterval(() => { const c = root.querySelector('#war-clock'); if (c) c.textContent = new Date().toLocaleTimeString('en-IN'); }, 1000);
    const mo = new MutationObserver(() => { if (!root.isConnected) { clearInterval(timer); clearInterval(clockTimer); mo.disconnect(); } });
    if (root.parentNode) mo.observe(root.parentNode, { childList: true });
  }

  FF.wow = { LEVELS, BADGES, CHALLENGES, levelFor, buildStats, crystal, celebrate, celebrateOnce, winnerCardPng, downloadWinnerCard, loadWow };
  FF.pages.arena = { title: 'Agent Arena', render: renderArena };
  FF.pages.fame = { title: 'Wall of Fame', render: renderFame };
  FF.pages.warRoom = { title: 'War Room', render: renderWarRoom };
})(window.FF);
