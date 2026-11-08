// 🤖 Gems Robot — har tab par sirf robot (koi window nahi). Dashboard tab "dimaag" hai: wahan se khabar aati hai,
// yahan robot udta, naachta, haath hilata aur board par dikhata hai. Click → 24h history · drag → jagah badlo.
(() => {
  if (window.top !== window || window.__ffGemsRobot) return;
  window.__ffGemsRobot = true;
  const IMG = (f) => chrome.runtime.getURL(`img/${f}`);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const today = () => new Date().toISOString().slice(0, 10);
  const host = location.hostname;
  let cfg = { off: {}, snooze: '', dock: null };

  const hostEl = document.createElement('div');
  hostEl.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
  const root = hostEl.attachShadow({ mode: 'open' });
  root.innerHTML = `<link rel="stylesheet" href="${chrome.runtime.getURL('robot.css')}">
    <div class="mc" id="ff-mascot">
      <div class="mc-stick" aria-hidden="true"></div>
      <div class="mc-board" role="status" aria-live="polite"></div>
      <button type="button" class="mc-bot" title="🤖 Gems — click: kya bataya (24h) · drag: jagah badlo">
        <i class="mc-glow"></i>
        <span class="mc-arm l"><img src="${IMG('robot-arm-l.png')}" alt="" draggable="false"></span>
        <span class="mc-arm r"><img src="${IMG('robot-arm-r.png')}" alt="" draggable="false"></span>
        <img class="mc-body" src="${IMG('robot-torso.png')}" alt="" draggable="false">
        <span class="mc-headwrap"><img class="mc-head" src="${IMG('robot-head.png')}" alt="" draggable="false"><i class="mc-eye l"><b></b></i><i class="mc-eye r"><b></b></i><i class="mc-mouth"><b></b></i></span>
        <span class="mc-fx"></span><span class="mc-dot" hidden></span>
      </button>
    </div>`;
  const el = root.getElementById('ff-mascot'), bot = el.querySelector('.mc-bot'), board = el.querySelector('.mc-board'), stick = el.querySelector('.mc-stick');
  let pos = [0, 0], busy = false, mode = 'dock', skip = null, hover = false;

  const geo = () => {
    const vw = window.innerWidth, vh = window.innerHeight, mob = vw < 760, W = mob ? 62 : 80, H = Math.round(W * 1.208);
    return { vw, vh, W, H, BW: Math.min(320, vw - W - 30), minY: 10, maxY: vh - H - 14 };
  };
  const tf = (p) => `translate3d(${Math.round(p[0])}px, ${Math.round(p[1])}px, 0)`;
  function place(p) { pos = [p[0], p[1]]; el.style.setProperty('--w', `${geo().W}px`); el.style.transform = tf(pos); }
  function dockPos() { const g = geo(), d = cfg.dock || { r: 18, b: 18 }; return [Math.max(4, Math.min(g.vw - g.W - 4, g.vw - g.W - d.r)), Math.max(8, Math.min(g.vh - g.H - 4, g.vh - g.H - d.b))]; }
  const clampP = (g, p) => [Math.max(6, Math.min(g.vw - g.W - 6, p[0])), Math.max(g.minY, Math.min(g.vh - g.H - 6, p[1]))];
  function path(from, to, style) {
    const g = geo(), [x0, y0] = from, [x1, y1] = to, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    let pts;
    if (style === 'zigzag') pts = [from, [x0 + (x1 - x0) * 0.33, my - 80], [x0 + (x1 - x0) * 0.66, my + 60], to];
    else if (style === 'loop') { const r = 60, c = [mx, my - 40]; pts = [from, [c[0], c[1] + r]]; for (let i = 1; i <= 6; i++) { const a = Math.PI / 2 + (i * Math.PI) / 3; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } pts.push(to); }
    else if (style === 'hop') pts = [from, [x0 + (x1 - x0) / 3, Math.min(y0, y1) - 100], [mx, Math.max(y0, y1)], [x0 + (x1 - x0) * 2 / 3, Math.min(y0, y1) - 80], to];
    else pts = [from, [mx, Math.min(y0, y1) - 120], to];
    return pts.map((p) => clampP(g, p));
  }
  async function fly(pts, ms) {
    const last = pts[pts.length - 1];
    el.style.setProperty('--lean', `${Math.max(-14, Math.min(14, (last[0] - pts[0][0]) / 40))}deg`);
    el.classList.add('moving');
    const a = el.animate(pts.map((p, i) => ({ transform: tf(p), offset: i / (pts.length - 1) })), { duration: ms, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' });
    await new Promise((r) => { a.onfinish = r; a.oncancel = r; });
    place(last); try { a.cancel(); } catch { /* ignore */ }
    el.classList.remove('moving');
  }
  function confetti(kind) {
    const fx = el.querySelector('.mc-fx');
    const set = kind === 'laugh' ? ['😂', '🤣', 'ha'] : kind === 'sad' ? ['💧'] : kind === 'sleepy' ? ['💤', 'z'] : kind === 'alert' ? ['❗', '⚠️'] : kind === 'curious' ? ['❔', '👀'] : ['🎉', '✨', '⭐', '🎊'];
    const n = kind === 'happy' || kind === 'excited' ? 12 : 3;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i'); s.textContent = pick(set);
      s.style.setProperty('--tx', `${Math.round(rnd(-80, 80))}px`); s.style.setProperty('--ty', `${Math.round(rnd(-110, -40))}px`); s.style.setProperty('--r', `${Math.round(rnd(-180, 180))}deg`);
      s.style.animationDelay = `${(i * 0.06).toFixed(2)}s`; fx.appendChild(s); setTimeout(() => s.remove(), 2400);
    }
  }
  function sideFor(g) { return pos[0] + g.W / 2 > g.vw / 2 ? 'left' : 'right'; }
  function layoutBoard(g, side) {
    board.style.width = `${g.BW}px`; el.dataset.side = side;
    const bh = board.offsetHeight;
    let bTop = g.W * 0.85 - bh; bTop = Math.max(bTop, 8 - pos[1]); bTop = Math.min(bTop, g.vh - 8 - pos[1] - bh);
    board.style.top = `${Math.round(bTop)}px`;
    board.style.left = side === 'right' ? `${g.W + 10}px` : `${-g.BW - 10}px`;
    const aW = g.W * 0.196, aH = g.W * 0.292, aT = g.W * 0.8064, L = aH * 0.85;
    const px = side === 'right' ? g.W * 0.798 + aW * 0.3 : g.W * 0.006 + aW * 0.7, py = aT + aH * 0.08;
    const hx = side === 'right' ? px + L * 0.866 : px - L * 0.866, hy = py + L * 0.5;
    const bx = side === 'right' ? g.W + 26 : -26, by = Math.min(bTop + bh - 8, Math.max(bTop + 20, g.W * 0.85 - 6));
    stick.style.cssText = `left:${hx}px;top:${hy}px;width:${Math.hypot(bx - hx, by - hy)}px;transform:rotate(${Math.atan2(by - hy, bx - hx) * 180 / Math.PI}deg)`;
  }
  function rowsHtml(it) {
    const rows = it.rows || [], max = Math.max(1, ...rows.map((r) => r.w || 0));
    if (it.view === 'text') return `<div class="mc-headline mc-textv"><span class="mc-type" data-text="${esc(it.head)}"></span></div>`;
    if (it.view === 'big') return `<div class="mc-big"><b>${esc(it.big)}</b><span>${esc(it.head)}</span></div>${it.prog != null ? `<div class="mc-prog"><i style="width:${it.prog}%"></i></div>` : ''}${rows.length ? `<div class="mc-chips">${rows.map((r) => `<span class="mc-chip"><small>${esc(r.name)}</small> <b>${esc(r.val)}</b></span>`).join('')}</div>` : ''}`;
    return `<div class="mc-headline"><span class="mc-type" data-text="${esc(it.head)}"></span></div><ol class="mc-rows">${rows.map((r, i) => `<li style="--d:${0.5 + i * 0.2}s">${it.view === 'bars' ? `<i class="mc-bar" style="--w:${Math.max(8, Math.round((r.w || 0) / max * 100))}%"></i>` : ''}<span class="mc-n">${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><b class="mc-v ${esc(r.tone || '')}">${esc(r.val)}</b></li>`).join('')}</ol>`;
  }
  function typewriter() {
    const t = board.querySelector('.mc-type'); if (!t) return Promise.resolve();
    const s = t.dataset.text || '';
    return new Promise((r) => { let i = 0; el.classList.add('talk'); const step = () => { i += 1; t.textContent = s.slice(0, i); if (i < s.length) setTimeout(step, 26); else { el.classList.remove('talk'); r(); } }; step(); });
  }
  const ctl = (extra) => `<div class="mc-ctl">${extra || '<span class="mc-go"></span>'}<button type="button" data-k="dash" title="Dashboard kholo">📊</button><button type="button" data-k="menu" title="Settings">⚙</button><button type="button" data-k="close" title="Band">✕</button></div>
    <div class="mc-menu" hidden><button type="button" data-k="site">🚫 Is site (${esc(host)}) par mat dikhao</button><button type="button" data-k="today">😴 Aaj ke liye chhupao</button><button type="button" data-k="home">🏠 Wapas kone me</button></div>`;

  async function show(it) {
    if (busy || !it || blocked()) return;
    busy = true; mode = 'show';
    const g = geo();
    board.className = 'mc-board';
    board.innerHTML = `<div class="mc-bh"><span class="mc-ic">${esc(it.icon || '🤖')}</span><b>${esc(it.title)}</b></div><div class="mc-bb">${rowsHtml(it)}${it.foot ? `<div class="mc-foot">${esc(it.foot)}</div>` : ''}</div>${ctl(it.q ? '<span class="mc-go">Tap → dashboard par poori list</span>' : '')}`;
    board.style.width = `${g.BW}px`;
    const goLeft = pos[0] + g.W / 2 > g.vw / 2, bh = board.offsetHeight || 180;
    const rest = [goLeft ? 14 : g.vw - g.W - 14, Math.round(rnd(Math.min(g.maxY, bh - g.W * 0.85 + 20), g.maxY))];
    el.dataset.mood = 'fly'; el.classList.remove('rest');
    await fly(path(pos, rest, pick(['arc', 'zigzag', 'loop', 'hop'])), 2200);
    layoutBoard(g, goLeft ? 'right' : 'left');
    el.dataset.mood = it.mood || 'happy'; el.classList.add('rest', 'holding'); confetti(it.mood);
    current = it;
    setTimeout(() => board.classList.add('in'), 30);
    let reason = '';
    const ended = new Promise((res) => { skip = (why) => { reason = why || 'skip'; res(); }; });
    const stay = (async () => { await typewriter(); await wait(it.stay || 10000); while (hover && !reason) await wait(500); })();
    await Promise.race([stay, ended]);
    skip = null; current = null;
    board.classList.remove('in'); el.classList.remove('holding', 'rest'); el.dataset.mood = 'fly';
    await wait(250);
    await fly(path(pos, dockPos(), 'arc'), 1600);
    el.dataset.mood = ''; busy = false; mode = 'dock';
    if (!it.fun) el.querySelector('.mc-dot').hidden = false;
  }
  let current = null;
  async function openHist() {
    if (busy) return;
    mode = 'hist'; el.querySelector('.mc-dot').hidden = true;
    let a = [];
    try { a = await chrome.runtime.sendMessage({ type: 'hist' }) || []; } catch { /* ignore */ }
    const g = geo();
    board.className = 'mc-board hist';
    board.innerHTML = `<div class="mc-bh"><span class="mc-ic">🕘</span><b>Maine kya bataya · 24h</b><small class="mc-cnt">${a.length} unique</small></div><div class="mc-bb">${a.length
      ? `<ol class="mc-hist">${a.map((h) => `<li data-q="${esc(h.q || '')}" class="m-${esc(h.mood || 'info')}"><span class="mc-hi">${esc(h.icon || '🤖')}</span><span class="mc-n">${esc(h.title)}<small>${h.big ? `<b>${esc(h.big)}</b> ` : ''}${esc(h.head)}</small></span><b class="mc-v">${ago(h.at)}</b></li>`).join('')}</ol>`
      : '<div class="mc-empty">Abhi kuch nahi bataya.<br>Dashboard tab khula rakho — wahi se khabar aati hai 📊</div>'}</div>${ctl('<span class="mc-go"></span>')}`;
    layoutBoard(g, sideFor(g));
    el.classList.add('rest', 'holding'); el.dataset.mood = 'info';
    setTimeout(() => board.classList.add('in'), 30);
  }
  function closeHist() { if (mode !== 'hist') return; board.classList.remove('in'); el.classList.remove('rest', 'holding'); el.dataset.mood = ''; mode = 'dock'; }
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'abhi' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`; };

  board.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (b) {
      e.stopPropagation();
      const k = b.dataset.k;
      if (k === 'close') { if (mode === 'hist') closeHist(); else if (skip) skip(); }
      else if (k === 'menu') { const m = board.querySelector('.mc-menu'); m.hidden = !m.hidden; hover = true; layoutBoard(geo(), el.dataset.side || 'left'); }
      else if (k === 'dash') { chrome.runtime.sendMessage({ type: 'open' }).catch(() => {}); closeHist(); }
      else if (k === 'site') { cfg.off[host] = 1; save(); closeHist(); if (skip) skip(); apply(); }
      else if (k === 'today') { cfg.snooze = today(); save(); closeHist(); if (skip) skip(); apply(); }
      else if (k === 'home') { cfg.dock = null; save(); closeHist(); fly([pos, dockPos()], 800); }
      return;
    }
    const li = e.target.closest('[data-q]');
    const q = li ? li.dataset.q : (current && current.q) || '';
    if (li || current) { chrome.runtime.sendMessage({ type: 'open', q }).catch(() => {}); closeHist(); if (skip) skip(); }
  });
  el.addEventListener('mouseenter', () => { hover = true; });
  el.addEventListener('mouseleave', () => { hover = false; });
  // drag + click
  let start = null, dragged = false;
  bot.addEventListener('pointerdown', (e) => { if (mode === 'show') return; start = { x: e.clientX, y: e.clientY, p: pos.slice() }; dragged = false; try { bot.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
  bot.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!dragged && Math.hypot(dx, dy) < 8) return;
    if (!dragged) { dragged = true; closeHist(); el.classList.add('drag'); }
    const g = geo(); place([Math.max(4, Math.min(g.vw - g.W - 4, start.p[0] + dx)), Math.max(4, Math.min(g.vh - g.H - 4, start.p[1] + dy))]);
  });
  const end = () => { if (!start) return; start = null; el.classList.remove('drag'); if (dragged) { const g = geo(); cfg.dock = { r: Math.round(g.vw - g.W - pos[0]), b: Math.round(g.vh - g.H - pos[1]) }; save(); } };
  bot.addEventListener('pointerup', end); bot.addEventListener('pointercancel', end);
  bot.addEventListener('click', (e) => { e.stopPropagation(); if (dragged) { dragged = false; return; } if (mode === 'show') { el.dataset.mood = 'laugh'; confetti('laugh'); return; } if (mode === 'hist') closeHist(); else openHist(); });
  document.addEventListener('click', (e) => { if (mode === 'hist' && !e.composedPath().includes(hostEl)) closeHist(); }, true);
  window.addEventListener('resize', () => { if (mode === 'dock') place(dockPos()); });

  // 🎭 masti jab khaali ho — kabhi khada nahi
  const ACTS = ['mc-disco', 'mc-spin', 'mc-wave', 'mc-robot', 'mc-nap', 'peek', 'moon'];
  let ai = Math.floor(Math.random() * ACTS.length);
  async function fun() {
    if (busy || mode !== 'dock' || blocked() || document.hidden) return;
    busy = true; mode = 'fun';
    const g = geo(), a = ACTS[ai++ % ACTS.length];
    const act = async (cls, ms, mood) => { el.dataset.mood = mood; el.classList.add('rest', cls); confetti(mood); await wait(ms); el.classList.remove(cls, 'rest'); el.dataset.mood = ''; };
    try {
      if (a === 'peek') { const right = Math.random() < 0.5; el.dataset.mood = 'fly'; await fly(path(pos, [right ? g.vw - g.W * 0.45 : -g.W * 0.55, rnd(60, g.maxY)], 'arc'), 2000); await act(right ? 'mc-peek-r' : 'mc-peek-l', 3200, 'curious'); }
      else if (a === 'moon') { el.dataset.mood = 'happy'; el.classList.add('rest', 'mc-moon'); await fly([pos, [Math.max(10, pos[0] - g.vw * 0.3), pos[1]]], 3400); el.classList.remove('mc-moon', 'rest'); }
      else if (a === 'mc-nap' || a === 'mc-wave') await act(a, 3600, a === 'mc-nap' ? 'sleepy' : 'happy');
      else { el.dataset.mood = 'fly'; await fly(path(pos, [rnd(g.vw * 0.2, g.vw * 0.8), rnd(g.vh * 0.3, g.maxY)], pick(['loop', 'zigzag', 'hop'])), 2400); await act(a, 3600, 'excited'); }
      if (!['mc-nap', 'mc-wave'].includes(a)) { el.dataset.mood = 'fly'; await fly(path(pos, dockPos(), 'arc'), 1800); el.dataset.mood = ''; }
    } finally { busy = false; mode = 'dock'; }
  }
  setInterval(fun, 22000);

  function blocked() { return !!cfg.off[host] || cfg.snooze === today(); }
  function apply() { hostEl.style.display = blocked() ? 'none' : ''; }
  function save() { try { chrome.storage.local.set({ robotCfg: cfg }); } catch { /* ignore */ } }

  chrome.runtime.onMessage.addListener((m) => {
    if (!m) return;
    if (m.type === 'show' && !document.hidden) show(m.item);
    if (m.type === 'nodash' && !busy && !blocked() && !document.hidden && Math.random() < 0.2) show({ key: 'nodash', fun: true, mood: 'curious', icon: '📊', title: 'Dashboard band hai', head: 'Dashboard ka tab khula rakho — tabhi main har tab par updates de paunga 🙂', view: 'text', q: '#/', stay: 6000 });
  });

  chrome.storage.local.get('robotCfg').then(({ robotCfg }) => {
    if (robotCfg) cfg = Object.assign(cfg, robotCfg);
    (document.body || document.documentElement).appendChild(hostEl);
    place(dockPos()); apply();
    setTimeout(() => { if (!blocked()) { el.dataset.mood = 'happy'; el.classList.add('rest', 'greet'); setTimeout(() => { el.classList.remove('rest', 'greet'); el.dataset.mood = ''; }, 2600); } }, 800);
  });
})();
