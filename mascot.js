/* 🤖 v3.125.121 — Gems robot (assistant ka hi robot) site par
   Purana 🎙 FAB ki jagah yahi robot kone me rehta hai, beech-beech me idhar-udhar ghoomta/naachta hai,
   aur naya update ho to board leke batata hai (growth / de-growth agents & TLs, inactive, low cover,
   wapas aaye agents, girawat, scoreboard, naya data). Click → last 24h ki unique history; drag → jagah
   badlo. Gems se baat: history board → 🎙. Sound ON → bol kar. Settings per viewer (localStorage). */
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

  const BUILDERS = [
    function highAgents() {
      const a = sq('high|all', 3); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'high', mood: 'happy', icon: '🚀', title: pick(['Rocket mode ON!', 'Aag laga di! 🔥', 'Growth ke sitare']),
        head: `${r.name} ne ${pct(r.growth)} growth di`, view: 'bars',
        rows: a.rows.map((x) => ({ name: x.name, sub: `${x.ch}${x.tl ? ' · TL ' + x.tl : ''} · ${fmt(x.cur)} tags`, val: pct(x.growth), w: Math.max(0, Number(x.growth) || 0), tone: 'up' })),
        say: `Shabash! ${r.name} ne pichle mahine se ${fmt(r.growth)} percent zyada growth di hai.${a.rows[1] ? ` Uske baad ${a.rows[1].name}.` : ''}`,
        q: 'high|all'
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
        q: 'degrowth|all'
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
        q: 'highgrowthtl|all'
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
        q: 'degrowthtl|all'
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
        q: 'inactive|all'
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
        q: 'lowcover|all'
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
        q: 'newagents|all'
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
        q: 'biggestdrop|all'
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
        q: 'summary|all'
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
          q: '#home'
        });
        schedule(4000);
      }
    } catch { /* login nahi / offline */ }
  }

  // ---------------------------------------------------------------- history: last 24h, sirf unique
  const HK = 'ff_mascot_hist_v1', DAY = 24 * 3600e3;
  const sigOf = (it) => `${it.key}|${it.head}|${(it.rows || []).map((r) => `${r.name}:${r.val}`).join(',')}|${it.big || ''}`;
  function histLoad() {
    try { const a = JSON.parse(localStorage.getItem(HK) || '[]'); return Array.isArray(a) ? a.filter((h) => h && Date.now() - h.at < DAY) : []; } catch { return []; }
  }
  function histSave(a) { try { localStorage.setItem(HK, JSON.stringify(a.slice(0, 60))); } catch { /* private mode */ } }
  function histAdd(it) {
    const sig = sigOf(it);
    const a = histLoad().filter((h) => h.sig !== sig); // same baat dobara → purani entry hatao, ek hi rahe
    a.unshift({ sig, at: Date.now(), key: it.key, icon: it.icon, title: it.title, head: it.head, big: it.big || '', q: it.q || '', mood: it.mood });
    histSave(a);
  }
  const saidWithin = (it, ms) => { const sig = sigOf(it); return histLoad().some((h) => h.sig === sig && Date.now() - h.at < ms); };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'abhi' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim(); };
  function runQ(q) {
    if (!q) return;
    try { if (q[0] === '#') location.hash = q; else if (FF.smartQ) FF.smartQ.open(q, /inactive/.test(q) ? 50 : 10); } catch { /* optional */ }
  }
  function openAssistant() { const f = document.getElementById('ask-fab'); if (f) f.click(); }

  // ---------------------------------------------------------------- DOM — assistant ka hi robot (Gems) site par
  let el = null, bot = null, board = null, stick = null, mode = 'dock', busy = false, timer = 0, wtimer = 0;
  let current = null, hover = false, skip = null, pos = [0, 0], dragged = false;
  const root = document.documentElement;
  function build() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'ff-mascot';
    el.className = 'mc';
    el.innerHTML = `
      <div class="mc-stick" aria-hidden="true"></div>
      <div class="mc-board" role="status" aria-live="polite"></div>
      <button type="button" class="mc-bot" aria-label="Gems robot — kya kya bataya (24h history)" title="🤖 Gems — click: maine kya bataya (24h) · drag: jagah badlo">
        <i class="mc-glow" aria-hidden="true"></i>
        <img class="mc-body" src="./robot-body.png?v=${IMG_V}" alt="" draggable="false">
        <span class="mc-headwrap"><img class="mc-head" src="./robot-head.png?v=${IMG_V}" alt="" draggable="false"><i class="mc-lid l"></i><i class="mc-lid r"></i><i class="mc-mouth"></i></span>
        <span class="mc-fx" aria-hidden="true"></span>
        <span class="mc-dot" hidden></span>
      </button>`;
    document.body.appendChild(el);
    bot = el.querySelector('.mc-bot');
    board = el.querySelector('.mc-board');
    stick = el.querySelector('.mc-stick');
    el.addEventListener('mouseenter', () => { hover = true; });
    el.addEventListener('mouseleave', () => { hover = false; });
    board.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mc]');
      if (b) { e.stopPropagation(); onCtl(b.dataset.mc, b); return; }
      const li = e.target.closest('[data-q]');
      if (li) { runQ(li.dataset.q); closeHist(); return; }
      if (mode === 'show' && current) { runQ(current.q); if (skip) skip(); }
    });
    // drag → nayi jagah (dock) · click → history
    let start = null;
    bot.addEventListener('pointerdown', (e) => {
      if (mode !== 'dock' && mode !== 'hist') return;
      start = { x: e.clientX, y: e.clientY, p: pos.slice() }; dragged = false;
      try { bot.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    bot.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < 8) return;
      if (!dragged) { dragged = true; closeHist(); el.classList.add('drag'); }
      const g = geo();
      place([Math.max(4, Math.min(g.vw - g.W - 4, start.p[0] + dx)), Math.max(g.minY, Math.min(g.vh - g.H - 4, start.p[1] + dy))]);
    });
    const end = () => {
      if (!start) return;
      start = null; el.classList.remove('drag');
      if (dragged) { const g = geo(); cfg.dock = { r: Math.round(g.vw - g.W - pos[0]), b: Math.round(g.vh - g.H - pos[1]) }; save(); }
    };
    bot.addEventListener('pointerup', end);
    bot.addEventListener('pointercancel', end);
    bot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragged) { dragged = false; return; }
      if (mode === 'show') { dance('happy', 1400); return; }
      if (mode === 'hist') closeHist(); else openHist();
    });
    document.addEventListener('click', (e) => { if (mode === 'hist' && !el.contains(e.target)) closeHist(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (mode === 'hist') closeHist(); else if (skip) skip(); } });
    window.addEventListener('resize', () => { if (mode === 'dock') place(dockPos()); });
    // Gems assistant ki state robot par bhi: sun raha / soch raha / bol raha
    const fab = document.getElementById('ask-fab');
    if (fab && window.MutationObserver) {
      const sync = () => { el.dataset.astate = fab.dataset.state || 'idle'; };
      new MutationObserver(sync).observe(fab, { attributes: true, attributeFilter: ['data-state'] });
      sync();
    }
    place(dockPos());
    applyOn();
  }
  function applyOn() {
    root.classList.toggle('mc-on', !!cfg.on);
    if (el) el.hidden = !cfg.on;
  }

  function rowsHtml(it) {
    const rows = it.rows || [];
    const max = Math.max(1, ...rows.map((r) => r.w || 0));
    if (it.view === 'big') {
      return `<div class="mc-big"><b>${esc(it.big)}</b><span>${esc(it.head)}</span></div>`
        + (it.prog != null ? `<div class="mc-prog"><i style="width:${it.prog}%"></i></div>` : '')
        + (rows.length ? `<div class="mc-chips">${rows.map((r) => `<span class="mc-chip ${r.tone || ''}"><small>${esc(r.name)}</small> <b>${esc(r.val)}</b></span>`).join('')}</div>` : '');
    }
    return `<div class="mc-headline"><span class="mc-type" data-text="${esc(it.head)}"></span></div><ol class="mc-rows ${it.view === 'bars' ? 'bars' : ''}">${rows.map((r, i) => `
      <li style="--d:${0.5 + i * 0.25}s">${it.view === 'bars' ? `<i class="mc-bar" style="--w:${Math.max(8, Math.round((r.w || 0) / max * 100))}%"></i>` : ''}
        <span class="mc-n">${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><b class="mc-v ${r.tone || ''}">${esc(r.val)}</b></li>`).join('')}</ol>`;
  }
  const menuHtml = () => `
      <div class="mc-menu" hidden>
        <label>Naya update kitni der me
          <select data-mc="every">${[2, 5, 10, 20].map((m) => `<option value="${m}"${Number(cfg.every) === m ? ' selected' : ''}>${m} min</option>`).join('')}</select></label>
        <label>Idhar-udhar ghoomna <input type="checkbox" data-mc="roam"${cfg.roam !== false ? ' checked' : ''}></label>
        <button type="button" data-mc="home">🏠 Wapas kone me (default jagah)</button>
        <button type="button" data-mc="today">😴 Aaj ke liye updates band</button>
        <button type="button" data-mc="off">⛔ Robot band karo (purana 🎙 button)</button>
        <small>Wapas chalu: Gems panel → 🤖</small>
      </div>`;
  function boardHtml(it) {
    return `<div class="mc-bh"><span class="mc-ic">${it.icon}</span><b>${esc(it.title)}</b></div>
      <div class="mc-bb">${rowsHtml(it)}${it.foot ? `<div class="mc-foot">${esc(it.foot)}</div>` : ''}</div>
      <div class="mc-ctl">
        <span class="mc-go">${it.q ? 'Tap → poori list' : ''}</span>
        <button type="button" data-mc="sound" title="Bol kar sunao (on/off)">${cfg.sound ? '🔊' : '🔇'}</button>
        <button type="button" data-mc="next" title="Agla update">⏭</button>
        <button type="button" data-mc="menu" title="Robot settings">⚙</button>
        <button type="button" data-mc="close" title="Abhi chhupao">✕</button>
      </div>${menuHtml()}`;
  }
  function histHtml() {
    const a = histLoad();
    const list = a.length
      ? `<ol class="mc-hist">${a.map((h) => `<li${h.q ? ` data-q="${esc(h.q)}"` : ''} class="m-${esc(h.mood || 'info')}"><span class="mc-hi">${h.icon || '🤖'}</span>
          <span class="mc-n">${esc(h.title)}<small>${h.big ? `<b>${esc(h.big)}</b> ` : ''}${esc(h.head)}</small></span><b class="mc-v">${ago(h.at)}</b></li>`).join('')}</ol>`
      : '<div class="mc-empty">Pichle 24 ghante me abhi kuch nahi bataya.<br>✨ <b>Naya update</b> dabao — main abhi batata hoon!</div>';
    return `<div class="mc-bh"><span class="mc-ic">🕘</span><b>Maine kya bataya · 24h</b><small class="mc-cnt">${a.length} unique</small></div>
      <div class="mc-bb">${list}</div>
      <div class="mc-ctl wide">
        <button type="button" class="mc-pill" data-mc="ask">🎙 Gems se poochho</button>
        <button type="button" class="mc-pill" data-mc="now">✨ Naya update</button>
        <span class="mc-go"></span>
        <button type="button" data-mc="sound" title="Bol kar sunao (on/off)">${cfg.sound ? '🔊' : '🔇'}</button>
        <button type="button" data-mc="menu" title="Robot settings">⚙</button>
        <button type="button" data-mc="close" title="Band karo">✕</button>
      </div>${menuHtml()}`;
  }

  function onCtl(k, b) {
    if (k === 'sound') {
      cfg.sound = !cfg.sound; save(); b.textContent = cfg.sound ? '🔊' : '🔇';
      if (cfg.sound && current) say(current.say); else stopSpeech();
    } else if (k === 'next') { if (skip) skip('next'); }
    else if (k === 'close') { if (mode === 'hist') closeHist(); else if (skip) skip(); }
    else if (k === 'menu') { const m = board.querySelector('.mc-menu'); if (m) { m.hidden = !m.hidden; layoutBoard(geo(), el.dataset.side || 'left'); } hover = true; }
    else if (k === 'today') { cfg.snoozeDay = today(); save(); if (skip) skip(); closeHist(); }
    else if (k === 'off') { cfg.on = false; save(); if (skip) skip(); closeHist(); applyOn(); }
    else if (k === 'home') { delete cfg.dock; save(); closeHist(); fly([pos, dockPos()], 900); }
    else if (k === 'ask') { closeHist(); openAssistant(); }
    else if (k === 'now') { closeHist(); now(true); }
  }
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.closest || !t.closest('#ff-mascot')) return;
    if (t.dataset.mc === 'every') { cfg.every = Number(t.value) || 5; save(); schedule(); }
    if (t.dataset.mc === 'roam') { cfg.roam = !!t.checked; save(); }
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
    const W = mob ? 62 : 84, H = Math.round(W * 1.208);
    const BW = Math.min(mob ? 250 : 290, vw - W - 30);
    return { vw, vh, mob, W, H, BW, minY: mob ? 64 : 72, maxY: vh - H - (mob ? 84 : 16) };
  }
  function dockPos() {
    const g = geo(), d = cfg.dock || { r: g.mob ? 10 : 16, b: g.mob ? 84 : 14 };
    return [Math.max(4, Math.min(g.vw - g.W - 4, g.vw - g.W - d.r)), Math.max(g.minY, Math.min(g.vh - g.H - 4, g.vh - g.H - d.b))];
  }
  const tf = (p, extra) => `translate3d(${Math.round(p[0])}px, ${Math.round(p[1])}px, 0)${extra || ''}`;
  function place(p) { pos = [p[0], p[1]]; if (el) { el.style.setProperty('--w', `${geo().W}px`); el.style.transform = tf(pos); } }
  const clampP = (g, p) => [Math.max(6, Math.min(g.vw - g.W - 6, p[0])), Math.max(g.minY - 20, Math.min(g.vh - g.H - 6, p[1]))];

  // Raste: arc · zig-zag · loop-de-loop · pehle upar phir side (right→up) · hop-hop
  function path(from, to, style) {
    const g = geo(), [x0, y0] = from, [x1, y1] = to, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    let pts;
    switch (style) {
      case 'zigzag': pts = [from, [x0 + (x1 - x0) * 0.25, my - 90], [x0 + (x1 - x0) * 0.5, my + 70], [x0 + (x1 - x0) * 0.75, my - 70], to]; break;
      case 'loop': { const r = 70, c = [mx, my - 40]; pts = [from, [c[0], c[1] + r]]; for (let i = 1; i <= 6; i++) { const a = Math.PI / 2 + (i * Math.PI) / 3; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } pts.push(to); break; }
      case 'up': pts = [from, [x0, g.minY + 10], [x1, g.minY + 10], to]; break;
      case 'hop': pts = [from, [x0 + (x1 - x0) / 3, Math.min(y0, y1) - 110], [x0 + (x1 - x0) * 0.5, Math.max(y0, y1)], [x0 + (x1 - x0) * 2 / 3, Math.min(y0, y1) - 90], to]; break;
      default: pts = [from, [mx, Math.min(y0, y1) - 130], to];
    }
    return pts.map((p) => clampP(g, p));
  }
  async function fly(pts, ms, opts) {
    const o = opts || {};
    const last = pts[pts.length - 1];
    if (!el.animate || reduced() || !ms) { place(last); return; }
    const dx = last[0] - pts[0][0];
    el.style.setProperty('--lean', `${Math.max(-14, Math.min(14, dx / 40))}deg`);
    el.classList.add('moving');
    const frames = pts.map((p, i) => ({ transform: tf(p, o.spin ? ` rotate(${Math.round((-360 * i) / (pts.length - 1))}deg)` : ''), offset: i / (pts.length - 1) }));
    const a = el.animate(frames, { duration: ms, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' });
    await new Promise((r) => { a.onfinish = r; a.oncancel = r; });
    place(last);
    try { a.cancel(); } catch { /* ignore */ }
    el.classList.remove('moving');
  }

  function layoutBoard(g, side) {
    board.style.width = `${g.BW}px`;
    el.dataset.side = side;
    const bh = board.offsetHeight;
    // board seene ki height par; screen ke upar se bahar na jaye, neeche bhi na kate
    let bTop = g.W * 0.85 - bh;
    bTop = Math.max(bTop, g.minY - 8 - pos[1]);
    bTop = Math.min(bTop, g.vh - 8 - pos[1] - bh);
    board.style.top = `${Math.round(bTop)}px`;
    board.style.left = side === 'right' ? `${g.W + 10}px` : `${-g.BW - 10}px`;
    const hx = side === 'right' ? g.W * 0.9 : g.W * 0.1, hy = g.W * 1.06;
    const bx = side === 'right' ? g.W + 26 : -26, by = Math.min(bTop + bh - 8, Math.max(bTop + 20, g.W * 0.85 - 6));
    const len = Math.hypot(bx - hx, by - hy), ang = Math.atan2(by - hy, bx - hx) * 180 / Math.PI;
    stick.style.cssText = `left:${hx}px;top:${hy}px;width:${len}px;transform:rotate(${ang}deg)`;
  }
  const sideFor = (g) => (pos[0] + g.W / 2 > g.vw / 2 ? 'left' : 'right');

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
    const set = kind === 'sad' ? ['💧'] : kind === 'sleepy' ? ['💤', 'z', 'Z'] : kind === 'alert' ? ['❗', '⚠️'] : kind === 'curious' ? ['❔', '👀'] : ['🎉', '✨', '⭐', '🎊', '💥'];
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
    el.classList.add('rest');
    confetti(mood);
    if (ms) setTimeout(() => { el.dataset.mood = current ? current.mood : ''; if (!current) el.classList.remove('rest'); }, ms);
  }
  function dot(on) { const d = el && el.querySelector('.mc-dot'); if (d) d.hidden = !on; }

  // ---------------------------------------------------------------- history board (bot par click)
  function openHist() {
    if (busy) return;
    mode = 'hist'; dot(false);
    const g = geo();
    board.innerHTML = histHtml();
    board.classList.add('hist');
    layoutBoard(g, sideFor(g));
    el.classList.add('rest'); el.dataset.mood = 'info';
    requestAnimationFrame(() => board.classList.add('in'));
  }
  function closeHist() {
    if (mode !== 'hist') return;
    board.classList.remove('in', 'hist');
    el.classList.remove('rest'); el.dataset.mood = '';
    mode = 'dock';
  }

  // ---------------------------------------------------------------- announce one update
  async function show(it) {
    if (busy || !it) return '';
    busy = true; current = it; build(); closeHist();
    mode = 'show';
    const g = geo();
    el.dataset.mood = 'fly';
    board.innerHTML = boardHtml(it);
    board.classList.remove('in', 'hist');
    el.classList.remove('rest', 'talk');
    // jahan hai uske ulti taraf jao — left↔right, kabhi pehle upar
    const goLeft = pos[0] + g.W / 2 > g.vw / 2;
    board.style.width = `${g.BW}px`;
    const bh = board.offsetHeight || 170;
    const yLo = Math.min(g.maxY, g.minY + bh - g.W * 0.85 + 10);
    const rest = [goLeft ? 12 : g.vw - g.W - 12, Math.round(rnd(Math.min(yLo, g.maxY), g.maxY))];
    const style = pick(['arc', 'zigzag', 'loop', 'up', 'hop']);
    await fly(path(pos, rest, style), 2400 + (style === 'loop' ? 900 : 300), { spin: style === 'loop' ? false : Math.random() < 0.25 });
    layoutBoard(g, goLeft ? 'right' : 'left');
    dance(it.mood);
    board.classList.add('in');
    histAdd(it);
    await wait(350);
    let reason = '';
    const ended = new Promise((res) => { skip = (why) => { reason = why || 'skip'; res(); }; });
    const spoken = typewriter().then(() => say(it.say));
    const minStay = wait(Math.max(9000, String(it.say || '').length * 70));
    const stay = (async () => { await Promise.all([spoken, minStay]); while (hover && !reason) await wait(500); })();
    await Promise.race([stay, ended]);
    skip = null; stopSpeech();
    board.classList.remove('in');
    el.dataset.mood = 'fly';
    el.classList.remove('rest');
    await wait(250);
    await fly(path(pos, dockPos(), pick(['arc', 'hop'])), 1700);
    el.dataset.mood = ''; current = null; busy = false; hover = false; mode = 'dock';
    if (reason !== 'next') dot(true); // history me naya hai
    return reason;
  }

  // ---------------------------------------------------------------- idle: idhar-udhar ghoomna
  async function wander() {
    if (busy || mode !== 'dock' || blocked(true) || cfg.roam === false || reduced()) return;
    busy = true;
    const g = geo();
    const spots = [[12, rnd(g.minY + 40, g.maxY)], [g.vw - g.W - 12, rnd(g.minY + 40, g.maxY)], [rnd(g.vw * 0.2, g.vw * 0.8), g.maxY], [rnd(g.vw * 0.3, g.vw * 0.7), g.minY + 10]];
    const to = pick(spots);
    el.dataset.mood = 'fly';
    await fly(path(pos, to, pick(['arc', 'zigzag', 'hop', 'loop'])), 2600);
    const mood = pick(['curious', 'happy', 'info', 'wave']);
    dance(mood === 'wave' ? 'happy' : mood, 3600);
    await wait(rnd(4500, 7500));
    if (!current) { el.dataset.mood = 'fly'; el.classList.remove('rest'); await fly(path(pos, dockPos(), 'arc'), 2000); el.dataset.mood = ''; }
    busy = false;
  }
  function scheduleWander() {
    clearTimeout(wtimer);
    wtimer = setTimeout(async () => { await wander(); scheduleWander(); }, rnd(35e3, 70e3));
  }

  // ---------------------------------------------------------------- scheduler
  function blocked(soft) {
    if (!cfg.on) return true;
    if (!soft && cfg.snoozeDay === today()) return true;
    if (document.hidden) return true;
    if (document.body.classList.contains('no-scroll')) return true; // modal/drawer khula hai
    const ask = document.getElementById('ask-panel');
    if (ask && !ask.hidden) return true;
    return false;
  }
  function nextItem(force) {
    if (prio.length) return prio.shift();
    const list = insights();
    if (!list.length) return null;
    // jo baat pichle 3 ghante me bata chuka (same numbers) wo dobara nahi
    for (let k = 0; k < list.length; k++) {
      const i = ((Number(cfg.idx) || 0) + k) % list.length;
      if (force || !saidWithin(list[i], 3 * 3600e3)) { cfg.idx = i + 1; save(); return list[i]; }
    }
    return null;
  }
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms == null ? Math.max(1, Number(cfg.every) || 5) * 60e3 : ms);
  }
  async function tick(force) {
    if (busy || mode === 'hist') return schedule(30e3);
    if (!force && blocked()) return schedule(45e3);
    if (!FF.smartQ && FF.lazy && FF.lazy.inject) { try { await FF.lazy.inject('smartQ'); } catch { /* optional */ } }
    const it = nextItem(force);
    if (!it) { if (force) dance('curious', 2000); return schedule(force ? undefined : 60e3); }
    const why = await show(it);
    schedule(why === 'next' ? 600 : undefined);
  }

  // ---------------------------------------------------------------- public
  function now(force) {
    if (busy) return;
    cfg.on = true; cfg.snoozeDay = ''; save(); build(); applyOn();
    clearTimeout(timer); tick(force !== false);
  }
  function toggle(on) {
    cfg.on = on == null ? !cfg.on : !!on; if (cfg.on) cfg.snoozeDay = ''; save(); build(); applyOn();
    if (cfg.on) schedule(1500); else if (skip) skip();
    return cfg.on;
  }
  FF.mascot = { now, toggle, history: histLoad, openHistory: () => { build(); openHist(); }, get on() { return cfg.on; }, get sound() { return cfg.sound; }, setSound(v) { cfg.sound = !!v; save(); }, insights };

  const start = () => {
    build();
    schedule(25e3);
    scheduleWander();
    setTimeout(checkVersions, 15e3);
    setInterval(checkVersions, 10 * 60e3);
    window.addEventListener('ff:data-fresh', () => setTimeout(checkVersions, 3000));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window.FF);
