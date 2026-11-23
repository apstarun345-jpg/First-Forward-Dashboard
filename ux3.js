/* v3.125.450 — ux3 (animations pack 2). Sab html.ff-no-anim par band; low-end/touch par heavy parts skip. */
(function (W) {
  'use strict';
  const D = document, H = D.documentElement;
  W.FF = W.FF || {};
  const off = () => H.classList.contains('ff-no-anim');
  const fine = () => { try { return matchMedia('(hover: hover) and (pointer: fine)').matches; } catch { return false; } };
  const lowEnd = () => { try { return (navigator.deviceMemory && navigator.deviceMemory < 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 3); } catch { return false; } };
  const WA = typeof Element !== 'undefined' && Element.prototype.animate;
  const q = (s, r) => Array.from((r || D).querySelectorAll(s));

  /* (3) charts draw-in */
  function charts(root) {
    if (!WA || off()) return;
    q('.linesvg path[fill="none"]:not([data-ux3])', root).forEach((p) => {
      p.dataset.ux3 = '1'; if (p.getAttribute('stroke-dasharray')) return;
      let L = 0; try { L = p.getTotalLength(); } catch { /* */ } if (!L) return;
      p.animate([{ strokeDasharray: `${L} ${L}`, strokeDashoffset: L }, { strokeDasharray: `${L} ${L}`, strokeDashoffset: 0 }], { duration: Math.min(1600, 600 + L * 0.8), easing: 'cubic-bezier(.4,.1,.2,1)', fill: 'backwards' }).onfinish = () => { /* style restore auto */ };
    });
    q('.linesvg path[fill]:not([fill="none"]):not([data-ux3]), .linesvg circle:not([data-ux3])', root).forEach((p) => { p.dataset.ux3 = '1'; p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 350, fill: 'backwards' }); });
    q('.vcol-stack:not([data-ux3])', root).forEach((b, i) => {
      b.dataset.ux3 = '1'; b.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 650, delay: Math.min(i, 30) * 22, easing: 'cubic-bezier(.2,1.1,.3,1)', fill: 'backwards' });
      b.style.transformOrigin = 'bottom';
    });
    q('svg circle[stroke-dasharray][data-tip]:not([data-ux3])', root).forEach((c, i) => {
      c.dataset.ux3 = '1'; const da = c.getAttribute('stroke-dasharray'); const [a, b] = String(da).split(/[ ,]+/).map(Number); if (!(a >= 0) || !(b >= 0)) return;
      c.animate([{ strokeDasharray: `0 ${a + b}` }, { strokeDasharray: `${a} ${b}` }], { duration: 900, delay: i * 90, easing: 'ease-out', fill: 'backwards' });
    });
  }

  /* (4) ring burst at 100% */
  function rings(root) {
    q('.abx-hs.ring:not([data-ux3r]), [data-ring]:not([data-ux3r])', root).forEach((r) => {
      r.dataset.ux3r = '1'; const p = parseFloat(getComputedStyle(r).getPropertyValue('--p')) || parseFloat(r.getAttribute('data-ring')) || 0;
      if (p >= 100 && !off()) setTimeout(() => { if (getComputedStyle(r).position === 'static') r.style.position = 'relative'; const b = D.createElement('i'); b.className = 'ux3-burst'; r.appendChild(b); setTimeout(() => b.remove(), 1000); }, 1100);
    });
  }

  /* (5) card flip — scan cards */
  function flips(root) {
    q('.trs-card:not([data-ux3f])', root).forEach((c) => {
      c.dataset.ux3f = '1';
      const code = (c.querySelector('.trs-bc') || {}).textContent || ''; if (!code) return;
      const kids = Array.from(c.childNodes); const front = D.createElement('div'); front.className = 'ux3-front'; kids.forEach((k) => front.appendChild(k));
      const fl = D.createElement('div'); fl.className = 'ux3-flipper'; fl.appendChild(front);
      const back = D.createElement('div'); back.className = 'ux3-back'; back.innerHTML = '<b></b><div class="row"><button type="button" data-ux3-copy>📋 Copy</button><button type="button" data-ux3-back>↩ Wapas</button></div>';
      back.querySelector('b').textContent = code; fl.appendChild(back); c.appendChild(fl);
      c.classList.add('ux3-flipwrap');
      const btn = D.createElement('button'); btn.type = 'button'; btn.className = 'ux3-flipbtn'; btn.title = 'Palto'; btn.textContent = '⟲'; btn.setAttribute('data-ux3-flip', ''); c.appendChild(btn);
    });
  }
  D.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-ux3-flip],[data-ux3-back],[data-ux3-copy]'); if (!t) return;
    const c = t.closest('.trs-card'); if (!c) return;
    if (t.hasAttribute('data-ux3-copy')) { const code = (c.querySelector('.ux3-back b') || {}).textContent || ''; try { navigator.clipboard.writeText(code); t.textContent = '✅ Copy hua'; setTimeout(() => { t.textContent = '📋 Copy'; }, 1200); } catch { /* */ } return; }
    c.classList.toggle('ux3-flipped', t.hasAttribute('data-ux3-flip') ? !c.classList.contains('ux3-flipped') : false);
  });

  /* (6) magnetic buttons */
  function magnet() {
    if (!fine() || lowEnd()) return;
    let cur = null;
    const SEL = '.btn.primary, .btn.big, #wow-gd-btn';
    const reset = () => { if (cur) { cur.style.transform = ''; cur = null; } };
    D.addEventListener('pointermove', (e) => {
      if (off() || e.pointerType !== 'mouse') return;
      const b = e.target.closest && e.target.closest(SEL);
      if (!b) { reset(); return; }
      if (cur && cur !== b) reset();
      cur = b; b.classList.add('ux3-mag');
      const r = b.getBoundingClientRect(), dx = (e.clientX - (r.left + r.width / 2)) / r.width, dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      b.style.transform = `translate(${(dx * 8).toFixed(1)}px,${(dy * 6).toFixed(1)}px)`;
    }, { passive: true });
    D.addEventListener('pointerleave', reset);
  }

  /* (7) morphing tab ink */
  const lastInk = new Map();
  function tabs(root) {
    q('.seg:not([data-ux3s])', root).forEach((s) => {
      if (!s.querySelector(':scope > .seg-btn')) return;
      s.dataset.ux3s = '1'; s.classList.add('ux3-seg');
      const key = s.id || (s.className.replace(/\s*ux3-seg\s*/, '') + ':' + (s.closest('[id]') ? s.closest('[id]').id : ''));
      const ink = D.createElement('i'); ink.className = 'ux3-ink'; s.insertBefore(ink, s.firstChild);
      const place = (anim) => {
        const on = s.querySelector(':scope > .seg-btn.on'); if (!on || !on.offsetWidth) { ink.style.width = '0px'; return; }
        const l = on.offsetLeft, w = on.offsetWidth;
        if (anim) { const prev = lastInk.get(key); if (prev) { ink.style.transition = 'none'; ink.style.left = prev.l + 'px'; ink.style.width = prev.w + 'px'; void ink.offsetWidth; ink.style.transition = ''; } }
        ink.style.left = l + 'px'; ink.style.width = w + 'px'; lastInk.set(key, { l, w });
      };
      requestAnimationFrame(() => place(true));
      new MutationObserver(() => place(false)).observe(s, { attributes: true, subtree: true, attributeFilter: ['class'] });
      W.addEventListener('resize', () => place(false)); s.addEventListener('click', () => setTimeout(() => place(false), 30)); setTimeout(() => place(false), 500);
    });
  }

  /* (13) glare on KPI */
  function glare(root) {
    if (!fine() || lowEnd()) return;
    q('.kpi:not([data-ux3g])', root).forEach((k) => {
      k.dataset.ux3g = '1'; const g = D.createElement('i'); g.className = 'ux3-glare'; k.appendChild(g);
      k.addEventListener('pointermove', (e) => { const r = k.getBoundingClientRect(); g.style.setProperty('--gx', ((e.clientX - r.left) / r.width * 100).toFixed(0) + '%'); g.style.setProperty('--gy', ((e.clientY - r.top) / r.height * 100).toFixed(0) + '%'); }, { passive: true });
    });
  }

  /* (8)(9)(10)(14) scan feedback */
  const BAD = { iss: 1, nf: 1 };
  let lastFx = 0;
  const vib = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* */ } };
  const chime = (k) => { try { W.FF.motion && W.FF.motion.chime && W.FF.motion.chime(k); } catch { /* */ } };
  function tick() {
    const s = D.createElement('div'); s.innerHTML = '<svg class="ux3-tick" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M14 27l9 9 17-19"/></svg>';
    const el = s.firstChild; D.body.appendChild(el); setTimeout(() => el.remove(), 1050);
  }
  function bad(d) {
    const f = D.createElement('div'); f.className = 'ux3-flash'; D.body.appendChild(f); setTimeout(() => f.remove(), 650);
    const t = D.querySelector('.trs-card.bad') || D.querySelector('#trs-alert') || D.querySelector('.bcc-cam-confirm') ;
    if (t) { t.classList.remove('ux3-shake'); void t.offsetWidth; t.classList.add('ux3-shake'); setTimeout(() => t.classList.remove('ux3-shake'), 600); }
  }
  function truck() { const t = D.createElement('div'); t.className = 'ux3-truck'; t.textContent = '🚚'; D.body.appendChild(t); setTimeout(() => t.remove(), 2200); }
  W.addEventListener('ff-scan', (e) => {
    if (off()) return; const d = (e && e.detail) || {}, now = Date.now(); if (now - lastFx < 350) return; lastFx = now;
    if (BAD[d.kind]) { bad(d); vib([70, 40, 70]); chime('alert'); return; }
    tick(); vib(25); chime('ok');
    if (d.dispatch) setTimeout(truck, 450);
  });
  W.FF.ux3 = { tick, bad, truck };

  /* wiring */
  let raf = 0; const pend = new Set();
  function run() { raf = 0; const roots = Array.from(pend); pend.clear(); roots.forEach((r) => { if (!r.isConnected) return; charts(r); rings(r); flips(r); tabs(r); glare(r); }); }
  function init() {
    magnet();
    const main = D.getElementById('main') || D.body; pend.add(D.body); raf = requestAnimationFrame(run);
    new MutationObserver((ms) => { ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && !(n.classList && (n.classList.contains('ux3-ink') || n.classList.contains('ux3-glare') || n.classList.contains('ux3-tick')))) pend.add(n); })); if (!raf && pend.size) raf = requestAnimationFrame(run); }).observe(D.body, { childList: true, subtree: true });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})(window);
