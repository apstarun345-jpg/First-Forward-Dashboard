/* 🎆 v212 — Opening screen fireworks (festival greeting hata diya). Bade, smooth, canvas par — GPU-friendly:
   ek hi <canvas>, requestAnimationFrame, DPR max 2, particle cap; #app-boot hat-te hi loop band.
   Band karna ho: localStorage ff_fest = off  ·  reduce-motion par nahi chalta. */
(function () {
  'use strict';
  try {
    var boot = document.getElementById('app-boot');
    if (!boot) return;
    try { if (localStorage.getItem('ff_fest') === 'off') return; } catch (e) { /* storage blocked */ }
    var H = document.documentElement;
    if ((window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || H.classList.contains('a11y-motion') || H.classList.contains('ff-no-anim')) return;

    var cv = document.createElement('canvas');
    cv.className = 'boot-fw-canvas'; cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';
    boot.insertBefore(cv, boot.firstChild);
    var st = document.createElement('style');
    st.textContent = '.app-boot .boot-fireworks{display:none!important}.app-boot>*:not(.boot-fw-canvas){position:relative;z-index:1}';
    document.head.appendChild(st);

    var ctx = cv.getContext('2d');
    if (!ctx) return;
    var W = 0, Ht = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    function size() { W = boot.clientWidth || window.innerWidth; Ht = boot.clientHeight || window.innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(Ht * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size();
    window.addEventListener('resize', size);

    var COLORS = ['#facc15', '#fb923c', '#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#f87171', '#22d3ee', '#fde047', '#ffffff'];
    var small = W < 640;
    var MAXP = small ? 650 : 1200;
    var rockets = [], parts = [];
    function rnd(a, b) { return a + Math.random() * (b - a); }

    function launch() {
      var tx = rnd(W * 0.15, W * 0.85), ty = rnd(Ht * 0.12, Ht * 0.42);
      rockets.push({ x: tx + rnd(-60, 60), y: Ht + 10, tx: tx, ty: ty, c: COLORS[(Math.random() * COLORS.length) | 0], t: 0, dur: rnd(0.75, 1.1) });
    }
    function burst(r) {
      var big = Math.min(W, Ht) * (small ? 0.5 : 0.38);   // bada dhamaka — screen ka ~1/3
      var n = small ? 70 : 110, two = Math.random() < 0.45, c2 = COLORS[(Math.random() * COLORS.length) | 0];
      var ring = Math.random() < 0.3;
      for (var i = 0; i < n && parts.length < MAXP; i++) {
        var a = (i / n) * Math.PI * 2 + rnd(-0.05, 0.05);
        var sp = ring ? big * 1.05 : big * Math.pow(Math.random(), 0.45) * 1.1;
        parts.push({ x: r.tx, y: r.ty, px: r.tx, py: r.ty, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rnd(1.3, 2.1), c: two && i % 2 ? c2 : r.c, w: rnd(1.6, 2.8), tw: Math.random() < 0.35 });
      }
      // beech me chamak
      parts.push({ x: r.tx, y: r.ty, px: r.tx, py: r.ty, vx: 0, vy: 0, life: 0, max: 0.35, c: '#fff', w: big * 0.22, flash: 1 });
    }

    var last = performance.now(), nextLaunch = 0, alive = true, started = last;
    function frame(now) {
      if (!alive) return;
      if (!boot.isConnected || boot.hidden || boot.style.display === 'none' || boot.classList.contains('hide') || boot.classList.contains('done')) { stop(); return; }
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      // halka fade = smooth trails
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, 0, W, Ht);
      ctx.globalCompositeOperation = 'lighter';

      if (now >= nextLaunch) { launch(); if (Math.random() < 0.4) launch(); nextLaunch = now + rnd(380, 750) + (now - started < 600 ? -300 : 0); }

      for (var i = rockets.length - 1; i >= 0; i--) {
        var r = rockets[i]; r.t += dt / r.dur;
        var e = 1 - Math.pow(1 - Math.min(1, r.t), 3);
        var x = r.x + (r.tx - r.x) * e, y = Ht + 10 + (r.ty - Ht - 10) * e;
        ctx.strokeStyle = r.c; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y + 16); ctx.lineTo(x, y); ctx.stroke();
        if (r.t >= 1) { burst(r); rockets.splice(i, 1); }
      }
      for (var j = parts.length - 1; j >= 0; j--) {
        var p = parts[j]; p.life += dt;
        var k = p.life / p.max;
        if (k >= 1) { parts.splice(j, 1); continue; }
        if (p.flash) {
          var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.w);
          g.addColorStop(0, 'rgba(255,255,255,' + (0.55 * (1 - k)) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.w, 0, 6.283); ctx.fill(); continue;
        }
        p.px = p.x; p.py = p.y;
        var drag = Math.pow(0.12, dt);          // hawa ka resistance — dheere ruk kar girte hain
        p.vx *= drag; p.vy = p.vy * drag + 60 * dt;   // gravity
        p.x += p.vx * dt; p.y += p.vy * dt;
        var al = (1 - k) * (p.tw ? (0.55 + 0.45 * Math.sin(now / 45 + j)) : 1);
        ctx.globalAlpha = al;
        ctx.strokeStyle = p.c; ctx.lineWidth = p.w;
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }
    function stop() { alive = false; window.removeEventListener('resize', size); try { cv.remove(); } catch (e) { /* ignore */ } }
    window.FF_FIREWORKS = { stop: stop };
    requestAnimationFrame(frame);
  } catch (e) { /* fireworks kabhi boot nahi rokte */ }
})();
