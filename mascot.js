/* 🤖 v3.125.120 — Robot dost (site mascot)
   Site par ek chhota robot ghoomta hai (left→right, right→upar, upar se drop, zig-zag…), haath me board
   leke updates batata hai — high growth / de-growth agents & TLs, inactive, low stock cover, naye
   agents, mahine ka scoreboard, aur "naya data aaya". Mood ke hisaab se naachta / udaas hota / so jaata
   hai. Sound ON ho to bol kar bhi sunata hai. Board par click → poori list (Smart Q) khulti hai.
   Settings (per viewer, localStorage): on/off · sound · kitni der me (2/5/10/20 min).            */
(function (FF) {
  'use strict';
  if (!FF || typeof document === 'undefined' || FF.mascot) return;
  const U = FF.util || {};
  const esc = U.esc || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const fmt = (n) => (U.fmt ? U.fmt(Math.round(Number(n) || 0)) : String(Math.round(Number(n) || 0)));
  const IMG_V = 1;

  // ---------------------------------------------------------------- per-viewer settings
  const LS = 'ff_mascot_v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
  const cfg = Object.assign({ on: true, sound: false, every: 5, idx: 0, seen: {}, snoozeDay: '' }, load());
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch { /* private mode */ } };
  const today = () => new Date().toISOString().slice(0, 10);
  const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- insights (data → board)
  const sq = (id, n) => { try { return FF.smartQ && FF.smartQ.answer ? FF.smartQ.answer(id, n) : null; } catch { return null; } };
  const pct = (g) => (g == null ? '' : `${g > 0 ? '+' : ''}${fmt(g)}%`);
  const openQ = (id, n) => () => { try { if (FF.smartQ) FF.smartQ.open(id, n || 10); } catch { /* optional */ } };
  const first = (s) => String(s || '').split(/\s+/)[0];

  const BUILDERS = [
    function highAgents() {
      const a = sq('high|all', 3); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'high', mood: 'happy', icon: '🚀', title: pick(['Rocket mode ON!', 'Aag laga di! 🔥', 'Growth ke sitare']),
        head: `${r.name} ne ${pct(r.growth)} growth di`, view: 'bars',
        rows: a.rows.map((x) => ({ name: x.name, sub: `${x.ch}${x.tl ? ' · TL ' + x.tl : ''} · ${fmt(x.cur)} tags`, val: pct(x.growth), w: Math.max(0, Number(x.growth) || 0), tone: 'up' })),
        say: `Shabash! ${r.name} ne pichle mahine se ${fmt(r.growth)} percent zyada growth di hai.${a.rows[1] ? ` Uske baad ${a.rows[1].name}.` : ''}`,
        act: openQ('high|all')
      };
    },
    function degrowthAgents() {
      const a = sq('degrowth|all', 3); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'degrowth', mood: 'sad', icon: '📉', title: pick(['Thoda dhyaan do', 'Girawat alert', 'In par nazar rakho']),
        head: `${r.name} ${fmt(Math.abs(r.growth || 0))}% neeche chal rahe hain`, view: 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: `last ${fmt(x.last)} → abhi ${fmt(x.cur)}${x.tl ? ' · TL ' + x.tl : ''}`, val: pct(x.growth), tone: 'down' })),
        say: `${r.name} ki issuance pichle mahine se ${fmt(Math.abs(r.growth || 0))} percent kam chal rahi hai. Ek call kar lo.`,
        act: openQ('degrowth|all')
      };
    },
    function highTls() {
      const a = sq('highgrowthtl|all', 3); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'hightl', mood: 'happy', icon: '👑', title: pick(['TL champions', 'Team ka jalwa']),
        head: `TL ${r.name} ki team ${pct(r.growth)} upar`, view: 'bars',
        rows: a.rows.map((x) => ({ name: x.name, sub: `${fmt(x.agents)} agents · ${fmt(x.cur)} tags`, val: pct(x.growth), w: Math.max(0, Number(x.growth) || 0), tone: 'up' })),
        say: `T L ${r.name} ki team is mahine ${fmt(r.growth)} percent upar hai. Zabardast!`,
        act: openQ('highgrowthtl|all')
      };
    },
    function degrowthTls() {
      const a = sq('degrowthtl|all', 3); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'degrowthtl', mood: 'sad', icon: '🧭', title: pick(['TL team neeche', 'Team ko boost chahiye']),
        head: `TL ${r.name} ki team ${fmt(Math.abs(r.growth || 0))}% neeche`, view: 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: `${fmt(x.agents)} agents · last ${fmt(x.last)} → ${fmt(x.cur)}`, val: pct(x.growth), tone: 'down' })),
        say: `T L ${r.name} ki team pichle mahine se ${fmt(Math.abs(r.growth || 0))} percent peeche hai.`,
        act: openQ('degrowthtl|all')
      };
    },
    function inactive() {
      const a = sq('inactive|all', 500); if (!a || !a.rows.length) return null;
      const n = a.rows.length;
      return {
        key: 'inactive', mood: 'sleepy', icon: '😴', title: pick(['Kaun so raha hai?', 'Neend se jagao']),
        head: 'agents ne is month ek bhi tag nahi kiya', view: 'big', big: fmt(n),
        rows: a.rows.slice(0, 3).map((x) => ({ name: x.name, sub: `last month ${fmt(x.last)}${x.stock ? ' · stock ' + fmt(x.stock) : ''}`, val: '0', tone: 'down' })),
        say: `${n} agents ne is mahine abhi tak ek bhi tag issue nahi kiya. Inko jagao!`,
        act: openQ('inactive|all', 50)
      };
    },
    function lowCover() {
      const a = sq('lowcover|all', 3); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'lowcover', mood: 'alert', icon: '⛽', title: pick(['Stock khatam hone wala!', 'Tanki khaali ho rahi hai']),
        head: `${r.name} ke paas ${fmt(r.cover)} din ka stock`, view: 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: `stock ${fmt(x.stock)} · roz ${fmt(x.rate)}`, val: `${(Number(x.cover) || 0).toFixed(1)}d`, tone: 'warn' })),
        say: `Dhyaan do! ${r.name} ka stock sirf ${Math.max(1, Math.round(r.cover || 0))} din ka bacha hai. Dispatch plan kar lo.`,
        act: openQ('lowcover|all')
      };
    },
    function newAgents() {
      const a = sq('newagents|all', 3); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'newagents', mood: 'happy', icon: '👋', title: pick(['Welcome back!', 'Naye khiladi']),
        head: `${r.name} wapas aaye — ${fmt(r.cur)} tags`, view: 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: `last month 0 · ${x.ch}`, val: fmt(x.cur), tone: 'up' })),
        say: `${r.name} pichle mahine zero the, is mahine ${fmt(r.cur)} tags kar chuke hain. Welcome back!`,
        act: openQ('newagents|all')
      };
    },
    function drop() {
      const a = sq('biggestdrop|all', 3); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'drop', mood: 'alert', icon: '🧯', title: pick(['Sabse badi girawat', 'Yahan aag bujh rahi hai']),
        head: `${r.name}: ${fmt(r.last)} → ${fmt(r.cur)}`, view: 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: `last ${fmt(x.last)} → abhi ${fmt(x.cur)}`, val: `−${fmt(x.drop)}`, tone: 'down' })),
        say: `${r.name} last month ${fmt(r.last)} par the, abhi tak sirf ${fmt(r.cur)}.`,
        act: openQ('biggestdrop|all')
      };
    },
    function scoreboard() {
      const a = sq('summary|all'); if (!a || !a.rows.length) return null;
      const t = a.rows[0]; if (!t || !(t.cur || t.last)) return null;
      const d = new Date(), day = d.getDate(), days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const pace = day > 1 ? Math.round((t.cur / (day - 1 || 1)) * days) : 0;
      const prog = t.last ? Math.min(100, Math.round((t.cur / t.last) * 100)) : 100;
      return {
        key: 'summary', mood: pace >= t.last ? 'happy' : 'info', icon: '📊', title: pick(['Mahine ka scoreboard', 'Abhi tak ka hisaab']),
        head: `last month ${fmt(t.last)} ka ${prog}% ho gaya`, view: 'big', big: fmt(t.cur), prog,
        rows: [{ name: 'VC4', val: fmt(t.vc4) }, { name: 'VC20', val: fmt(t.vc20) }, { name: 'VC5+', val: fmt(t.vc5) }].map((x) => ({ ...x, sub: '', tone: 'chip' })),
        foot: pace ? `Isi speed se mahine ka andaaza ≈ ${fmt(pace)} ${pace >= t.last ? '🎯' : ''}` : '',
        say: `Is mahine abhi tak ${fmt(t.cur)} tags, last month ka ${prog} percent.${pace ? ` Isi speed se lagbhag ${fmt(pace)} tak jaayenge.` : ''}`,
        act: openQ('summary|all')
      };
    }
  ];

  function insights() {
    const out = [];
    BUILDERS.forEach((b) => { try { const x = b(); if (x) out.push(x); } catch { /* data abhi nahi */ } });
    return out;
  }

  // "🆕 naya data aaya" — server ke daily versions se
  const prio = [];
  async function checkVersions() {
    try {
      if (!FF.data || !FF.data.versions) return;
      const v = await FF.data.versions(true);
      const fresh = [];
      (v && v.sheets || []).forEach((s) => {
        const at = Date.parse(s.changedAt || '') || 0;
        if (!at) return;
        const seen = Number(cfg.seen[s.name]) || 0;
        if (at > seen) {
          if (seen || Date.now() - at < 12 * 3600e3) fresh.push({ name: s.name, at, rows: s.rows });
          cfg.seen[s.name] = at;
        }
      });
      save();
      if (fresh.length) {
        const t = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
        prio.push({
          key: 'data', mood: 'excited', icon: '🆕', title: pick(['Naya data aa gaya!', 'Taaza khabar!']),
          head: fresh.length === 1 ? `${fresh[0].name} update hua` : `${fresh.length} sheets update hui`, view: 'list',
          rows: fresh.slice(0, 4).map((x) => ({ name: x.name, sub: x.rows != null ? `${fmt(x.rows)} rows` : '', val: t(x.at), tone: 'chip' })),
          say: `Naya data aa gaya hai! ${fresh.map((x) => x.name).join(', ')} update ho gaya. Ab sab numbers taaza hain.`,
          act: () => { try { location.hash = '#home'; } catch { /* ignore */ } }
        });
        schedule(4000);
      }
    } catch { /* login nahi / offline */ }
  }

  // ---------------------------------------------------------------- DOM
  let el = null, bot = null, board = null, stick = null, busy = false, timer = 0, current = null, hover = false, skip = null;
  function build() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'ff-mascot';
    el.className = 'mc';
    el.hidden = true;
    el.innerHTML = `
      <div class="mc-stick" aria-hidden="true"></div>
      <div class="mc-board" role="status" aria-live="polite"></div>
      <div class="mc-bot" title="🤖 Robot dost — board par click karo">
        <i class="mc-glow" aria-hidden="true"></i>
        <img class="mc-body" src="./robot-body.png?v=${IMG_V}" alt="" draggable="false">
        <span class="mc-headwrap"><img class="mc-head" src="./robot-head.png?v=${IMG_V}" alt="" draggable="false"><i class="mc-lid l"></i><i class="mc-lid r"></i><i class="mc-mouth"></i></span>
        <span class="mc-fx" aria-hidden="true"></span>
      </div>`;
    document.body.appendChild(el);
    bot = el.querySelector('.mc-bot');
    board = el.querySelector('.mc-board');
    stick = el.querySelector('.mc-stick');
    el.addEventListener('mouseenter', () => { hover = true; });
    el.addEventListener('mouseleave', () => { hover = false; });
    board.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mc]');
      if (b) { e.stopPropagation(); onCtl(b.dataset.mc, b); return; }
      if (current && current.act) { current.act(); if (skip) skip(); }
    });
    bot.addEventListener('click', () => { if (current) dance('happy', 1400); });
  }

  function boardHtml(it) {
    const rows = it.rows || [];
    const max = Math.max(1, ...rows.map((r) => r.w || 0));
    let body = '';
    if (it.view === 'big') {
      body = `<div class="mc-big"><b>${esc(it.big)}</b><span>${esc(it.head)}</span></div>`
        + (it.prog != null ? `<div class="mc-prog"><i style="width:${it.prog}%"></i></div>` : '')
        + (rows.length ? `<div class="mc-chips">${rows.map((r) => `<span class="mc-chip ${r.tone || ''}"><small>${esc(r.name)}</small> <b>${esc(r.val)}</b></span>`).join('')}</div>` : '');
    } else {
      body = `<div class="mc-headline"><span class="mc-type" data-text="${esc(it.head)}"></span></div><ol class="mc-rows ${it.view === 'bars' ? 'bars' : ''}">${rows.map((r, i) => `
        <li style="--d:${0.5 + i * 0.25}s">${it.view === 'bars' ? `<i class="mc-bar" style="--w:${Math.max(8, Math.round((r.w || 0) / max * 100))}%"></i>` : ''}
          <span class="mc-n">${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><b class="mc-v ${r.tone || ''}">${esc(r.val)}</b></li>`).join('')}</ol>`;
    }
    return `<div class="mc-bh"><span class="mc-ic">${it.icon}</span><b>${esc(it.title)}</b></div>
      <div class="mc-bb">${body}${it.foot ? `<div class="mc-foot">${esc(it.foot)}</div>` : ''}</div>
      <div class="mc-ctl">
        <span class="mc-go">${it.act ? 'Tap → poori list' : ''}</span>
        <button type="button" data-mc="sound" title="Bol kar sunao (on/off)">${cfg.sound ? '🔊' : '🔇'}</button>
        <button type="button" data-mc="next" title="Agla update">⏭</button>
        <button type="button" data-mc="menu" title="Robot settings">⚙</button>
        <button type="button" data-mc="close" title="Abhi chhupao">✕</button>
      </div>
      <div class="mc-menu" hidden>
        <label>Kitni der me aaye
          <select data-mc="every">${[2, 5, 10, 20].map((m) => `<option value="${m}"${Number(cfg.every) === m ? ' selected' : ''}>${m} min</option>`).join('')}</select></label>
        <button type="button" data-mc="today">😴 Aaj ke liye band</button>
        <button type="button" data-mc="off">⛔ Robot band karo</button>
        <small>Wapas chalu: assistant panel → 🤖</small>
      </div>`;
  }

  function onCtl(k, b) {
    if (k === 'sound') {
      cfg.sound = !cfg.sound; save(); b.textContent = cfg.sound ? '🔊' : '🔇';
      if (cfg.sound && current) say(current.say); else stopSpeech();
    } else if (k === 'next') { if (skip) skip('next'); }
    else if (k === 'close') { if (skip) skip(); }
    else if (k === 'menu') { const m = board.querySelector('.mc-menu'); if (m) m.hidden = !m.hidden; hover = true; }
    else if (k === 'today') { cfg.snoozeDay = today(); save(); if (skip) skip(); }
    else if (k === 'off') { cfg.on = false; save(); if (skip) skip(); }
  }
  document.addEventListener('change', (e) => {
    const s = e.target && e.target.closest && e.target.closest('#ff-mascot select[data-mc="every"]');
    if (s) { cfg.every = Number(s.value) || 5; save(); }
  });

  // ---------------------------------------------------------------- voice
  let talking = false;
  function stopSpeech() { try { if (talking && window.speechSynthesis) window.speechSynthesis.cancel(); } catch { /* ignore */ } talking = false; if (el) el.classList.remove('talk'); }
  function say(text) {
    return new Promise((resolve) => {
      const act = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
      if (!cfg.sound || !text || !act || !('speechSynthesis' in window)) return resolve(false);
      const done = () => { talking = false; if (el) el.classList.remove('talk'); resolve(true); };
      talking = true; el.classList.add('talk');
      try {
        if (FF.assistant && FF.assistant.speak) { FF.assistant.speak(text, { force: true, onEnd: done, onError: done }); return; }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'hi-IN'; u.rate = 1.02; u.pitch = 1.15;
        u.onend = done; u.onerror = done;
        window.speechSynthesis.speak(u);
      } catch { done(); }
    });
  }

  // ---------------------------------------------------------------- motion
  function geo() {
    const vw = window.innerWidth, vh = window.innerHeight, mob = vw < 760;
    const W = mob ? 72 : 100, H = Math.round(W * 1.208);
    const BW = Math.min(mob ? 250 : 280, vw - W - 30);
    return { vw, vh, mob, W, H, BW, minY: mob ? 64 : 72, maxY: vh - H - (mob ? 150 : 28) };
  }
  const tf = (p, extra) => `translate3d(${Math.round(p[0])}px, ${Math.round(p[1])}px, 0)${extra || ''}`;

  // Har route: kahan se aaye, kis raste, kahan ruke (board kis taraf)
  function route(g, bh) {
    const yFor = (f) => Math.max(Math.min(g.maxY, g.minY + bh - g.W * 0.85 + 10), Math.min(g.maxY, g.minY + (g.maxY - g.minY) * f));
    const L = 12, R = g.vw - g.W - 12;
    const routes = [
      () => { const y = yFor(0.85); return { name: 'walk-lr', side: 'left', pts: [[-g.W - 30, y], [g.vw * 0.25, y - 14], [g.vw * 0.5, y], [g.vw * 0.72, y - 14], [R, y]] }; },
      () => { const y = yFor(0.4); return { name: 'rise-ru', side: 'left', pts: [[R, g.vh + 20], [R - 30, g.vh * 0.7], [R + 4, (g.vh * 0.7 + y) / 2], [R, y]] }; },
      () => { const y = yFor(0.6); return { name: 'drop', side: 'right', spin: true, pts: [[g.vw * 0.45, -g.H - 30], [g.vw * 0.3, y * 0.4], [L + 40, y - 30], [L, y]] }; },
      () => { const y = yFor(0.55); return { name: 'zigzag-rl', side: 'right', pts: [[g.vw + 30, g.minY + 10], [g.vw * 0.75, y + 40], [g.vw * 0.55, g.minY + 20], [g.vw * 0.3, y + 30], [L, y]] }; },
      () => { const y = yFor(0.3); return { name: 'swoop', side: 'right', spin: true, pts: [[-g.W - 30, g.vh], [g.vw * 0.35, g.vh * 0.55], [g.vw * 0.2, y - 40], [L, y]] }; },
      () => { const y = yFor(0.7); return { name: 'walk-rl', side: 'right', pts: [[g.vw + 30, y], [g.vw * 0.66, y - 12], [g.vw * 0.33, y], [L, y]] }; }
    ];
    return routes[Math.floor(Math.random() * routes.length)]();
  }

  async function fly(pts, ms, opts) {
    const o = opts || {};
    if (!el.animate || reduced()) { el.style.transform = tf(pts[pts.length - 1]); return; }
    const dx = pts[pts.length - 1][0] - pts[0][0];
    el.style.setProperty('--lean', `${Math.max(-14, Math.min(14, dx / 40))}deg`);
    el.classList.add('moving');
    const frames = pts.map((p, i) => ({ transform: tf(p, o.spin && i === 1 ? ' rotate(-200deg)' : o.spin && i === 2 ? ' rotate(-360deg)' : ''), offset: i / (pts.length - 1) }));
    const a = el.animate(frames, { duration: ms, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' });
    await new Promise((r) => { a.onfinish = r; a.oncancel = r; });
    el.style.transform = tf(pts[pts.length - 1]);
    try { a.cancel(); } catch { /* ignore */ }
    el.classList.remove('moving');
  }

  function layoutBoard(g, side) {
    board.style.width = `${g.BW}px`;
    el.dataset.side = side;
    // board bot ke seene ki height par, side me; danda haath se board tak
    const bTop = g.W * 0.85 - board.offsetHeight;
    board.style.top = `${Math.round(bTop)}px`;
    board.style.left = side === 'right' ? `${g.W + 10}px` : `${-g.BW - 10}px`;
    const hx = side === 'right' ? g.W * 0.9 : g.W * 0.1, hy = g.W * 1.06;
    const bx = side === 'right' ? g.W + 26 : -26, by = g.W * 0.85 - 6;
    const len = Math.hypot(bx - hx, by - hy), ang = Math.atan2(by - hy, bx - hx) * 180 / Math.PI;
    stick.style.cssText = `left:${hx}px;top:${hy}px;width:${len}px;transform:rotate(${ang}deg)`;
  }

  function typewriter() {
    const t = board.querySelector('.mc-type'); if (!t) return Promise.resolve();
    const s = t.dataset.text || '';
    if (reduced()) { t.textContent = s; return Promise.resolve(); }
    return new Promise((r) => {
      let i = 0; el.classList.add('talk');
      const step = () => { i += 1; t.textContent = s.slice(0, i); if (i < s.length) setTimeout(step, 28); else { if (!talking) el.classList.remove('talk'); r(); } };
      step();
    });
  }

  function confetti(kind) {
    const fx = el.querySelector('.mc-fx'); if (!fx || reduced()) return;
    const set = kind === 'sad' ? ['💧'] : kind === 'sleepy' ? ['💤', 'z', 'Z'] : kind === 'alert' ? ['❗', '⚠️'] : ['🎉', '✨', '⭐', '🎊', '💥'];
    const n = kind === 'happy' || kind === 'excited' ? 14 : 3;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.textContent = pick(set);
      s.style.setProperty('--tx', `${Math.round(rnd(-90, 90))}px`);
      s.style.setProperty('--ty', `${Math.round(rnd(-120, -40))}px`);
      s.style.setProperty('--r', `${Math.round(rnd(-180, 180))}deg`);
      s.style.animationDelay = `${(i * 0.06).toFixed(2)}s`;
      fx.appendChild(s);
      setTimeout(() => s.remove(), 2400);
    }
  }
  function dance(mood, ms) {
    el.dataset.mood = mood;
    confetti(mood);
    if (ms) setTimeout(() => { if (current) el.dataset.mood = current.mood; }, ms);
  }

  // ---------------------------------------------------------------- show one update
  async function show(it) {
    if (busy || !it) return '';
    busy = true; current = it; build();
    const g = geo();
    el.style.setProperty('--w', `${g.W}px`);
    el.dataset.mood = 'fly';
    board.innerHTML = boardHtml(it);
    board.classList.remove('in');
    el.classList.remove('rest', 'talk');
    el.hidden = false;
    board.style.width = `${g.BW}px`;
    const r = route(g, board.offsetHeight || 160);
    layoutBoard(g, r.side);
    el.style.transform = tf(r.pts[0]);
    await fly(r.pts, reduced() ? 0 : 2600 + r.pts.length * 150, { spin: r.spin });
    el.classList.add('rest');
    dance(it.mood);
    board.classList.add('in');
    await wait(350);
    let reason = '';
    const ended = new Promise((res) => { skip = (why) => { reason = why || 'skip'; res(); }; });
    const typed = typewriter();
    const spoken = typed.then(() => say(it.say));
    const minStay = wait(Math.max(9000, String(it.say || '').length * 70));
    const stay = (async () => {
      await Promise.all([spoken, minStay]);
      while (hover && !reason) await wait(500); // mouse board par → ruka rahe
    })();
    await Promise.race([stay, ended]);
    skip = null; stopSpeech();
    board.classList.remove('in');
    const m = board.querySelector('.mc-menu'); if (m) m.hidden = true;
    el.dataset.mood = 'fly';
    el.classList.remove('rest');
    // nikalna: ya rocket ki tarah upar, ya side se bahar
    const cur = [r.pts[r.pts.length - 1][0], r.pts[r.pts.length - 1][1]];
    const exits = [
      [cur, [cur[0], cur[1] - 30], [cur[0] + rnd(-60, 60), -g.H - 80]],
      [cur, [cur[0] + (r.side === 'left' ? 40 : -40), cur[1] - 20], [r.side === 'left' ? g.vw + 60 : -g.W - 60, cur[1] - 60]]
    ];
    await wait(250);
    await fly(pick(exits), reduced() ? 0 : 1500);
    el.hidden = true; current = null; busy = false; hover = false;
    return reason;
  }

  // ---------------------------------------------------------------- scheduler
  function blocked() {
    if (!cfg.on || cfg.snoozeDay === today()) return true;
    if (document.hidden) return true;
    if (document.body.classList.contains('no-scroll')) return true; // koi modal/drawer khula hai
    const ask = document.getElementById('ask-panel');
    if (ask && !ask.hidden) return true;
    return false;
  }
  function nextItem() {
    if (prio.length) return prio.shift();
    const list = insights();
    if (!list.length) return null;
    cfg.idx = (Number(cfg.idx) || 0) % list.length;
    const it = list[cfg.idx];
    cfg.idx += 1; save();
    return it;
  }
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms == null ? Math.max(1, Number(cfg.every) || 5) * 60e3 : ms);
  }
  async function tick() {
    if (busy) return schedule(30e3);
    if (blocked()) return schedule(45e3);
    if (!FF.smartQ && FF.lazy && FF.lazy.inject) { try { await FF.lazy.inject('smartQ'); } catch { /* optional */ } }
    const it = nextItem();
    if (!it) return schedule(60e3); // data abhi load nahi hua
    const why = await show(it);
    schedule(why === 'next' ? 600 : undefined);
  }

  // ---------------------------------------------------------------- public
  function now() { if (busy) return; cfg.on = true; cfg.snoozeDay = ''; save(); clearTimeout(timer); tick(); }
  function toggle(on) { cfg.on = on == null ? !cfg.on : !!on; if (cfg.on) cfg.snoozeDay = ''; save(); if (cfg.on) schedule(1500); else if (skip) skip(); return cfg.on; }
  FF.mascot = { now, toggle, get on() { return cfg.on; }, get sound() { return cfg.sound; }, setSound(v) { cfg.sound = !!v; save(); }, insights };

  const start = () => {
    schedule(25e3);
    setTimeout(checkVersions, 15e3);
    setInterval(checkVersions, 10 * 60e3);
    window.addEventListener('ff:data-fresh', () => setTimeout(checkVersions, 3000));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window.FF);
