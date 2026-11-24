/* ✨ v3.125.482 — Opening screen animation (canvas fireworks ki jagah).
   Pehle 1000 particles ka <canvas> main thread par chalta tha — usi waqt app ka JS load / parse hota tha,
   isliye opening atakti thi. Ab sirf CSS (transform + opacity) — browser ise GPU compositor par chalata hai,
   JS busy ho tab bhi 60fps smooth. Koi requestAnimationFrame / loop nahi; #app-boot hat-te hi sab khatam.
   Band karna ho: localStorage ff_fest = off. */
(function () {
  'use strict';
  try {
    var boot = document.getElementById('app-boot');
    if (!boot) return;
    try { if (localStorage.getItem('ff_fest') === 'off') return; } catch (e) { /* storage blocked */ }
    var H = document.documentElement;
    if (H.classList.contains('a11y-motion') || H.classList.contains('ff-no-anim')) return;

    var css = [
      '.app-boot .boot-fireworks{display:none!important}',
      '.app-boot>*:not(.boot-fx){position:relative;z-index:1}',
      '.boot-fx{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;contain:strict}',
      // aurora — 3 bade blurred orbs, dheere ghoomte (sirf transform)
      '.boot-fx .orb{position:absolute;width:62vmax;height:62vmax;border-radius:50%;filter:blur(60px);opacity:.55;will-change:transform}',
      '.boot-fx .o1{left:-18vmax;top:-22vmax;background:radial-gradient(circle,#38bdf8 0,rgba(56,189,248,0) 65%);animation:bfx1 9s ease-in-out infinite alternate}',
      '.boot-fx .o2{right:-20vmax;top:-10vmax;background:radial-gradient(circle,#a78bfa 0,rgba(167,139,250,0) 65%);animation:bfx2 11s ease-in-out infinite alternate}',
      '.boot-fx .o3{left:10vmax;bottom:-30vmax;background:radial-gradient(circle,#34d399 0,rgba(52,211,153,0) 65%);animation:bfx3 10s ease-in-out infinite alternate}',
      '@keyframes bfx1{to{transform:translate3d(14vmax,10vmax,0) scale(1.15)}}',
      '@keyframes bfx2{to{transform:translate3d(-12vmax,14vmax,0) scale(.9)}}',
      '@keyframes bfx3{to{transform:translate3d(8vmax,-12vmax,0) scale(1.1)}}',
      // sparkles — chhote tare, twinkle (opacity + scale)
      '.boot-fx .sp{position:absolute;width:4px;height:4px;border-radius:50%;background:#fff;box-shadow:0 0 10px 2px rgba(255,255,255,.8);opacity:0;will-change:transform,opacity;animation:bfxs 2.6s ease-in-out infinite}',
      '@keyframes bfxs{0%,100%{opacity:0;transform:scale(.3)}50%{opacity:1;transform:scale(1.2)}}',
      // shine sweep across the logo area
      '.boot-fx .sweep{position:absolute;top:0;bottom:0;width:30%;left:-40%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.12),transparent);will-change:transform;animation:bfxw 2.8s ease-in-out infinite}',
      '@keyframes bfxw{to{transform:translate3d(470%,0,0)}}'
    ].join('');
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var fx = document.createElement('div');
    fx.className = 'boot-fx'; fx.setAttribute('aria-hidden', 'true');
    var html = '<i class="orb o1"></i><i class="orb o2"></i><i class="orb o3"></i><i class="sweep"></i>';
    var small = Math.min(window.innerWidth || 999, window.innerHeight || 999) < 640;
    var N = small ? 14 : 26;
    for (var i = 0; i < N; i++) {
      var x = (Math.random() * 96 + 2).toFixed(1), y = (Math.random() * 90 + 4).toFixed(1);
      var d = (Math.random() * 2.6).toFixed(2), sz = (Math.random() * 3 + 2).toFixed(1);
      html += '<i class="sp" style="left:' + x + '%;top:' + y + '%;width:' + sz + 'px;height:' + sz + 'px;animation-delay:' + d + 's"></i>';
    }
    fx.innerHTML = html;
    boot.insertBefore(fx, boot.firstChild);

    // boot screen hat-te hi DOM se bhi hata do (hidden animations bhi GPU memory na lein)
    var mo = new MutationObserver(function () {
      if (!boot.isConnected || boot.hidden || boot.classList.contains('hide') || boot.classList.contains('done') || getComputedStyle(boot).display === 'none') {
        mo.disconnect(); if (fx.parentNode) fx.parentNode.removeChild(fx);
      }
    });
    mo.observe(boot, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    if (boot.parentNode) mo.observe(boot.parentNode, { childList: true });
  } catch (e) { /* animation optional */ }
})();
