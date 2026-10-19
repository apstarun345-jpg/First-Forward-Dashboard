/* Early PWA/mobile layout detection and theme boot. Kept external so the server CSP can
   block inline script without accidentally disabling the standalone/mobile layout. */
(() => {
  // 🧼 v3.73 — yeh logic pehle index.html ka inline <script> tha; server CSP (`script-src 'self'`)
  // inline scripts ko block karta hai → feature silently dead tha (logout ke baad splash phir dikhta
  // tha). Ab external: ui-boot.js head me body-parse se pehle chalta hai, isliye class #app-boot ke
  // paint hone se pehle lag jaati hai (CSS splash turant hide karta hai — koi flash nahi).
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ff_skip_workspace_boot_once') === '1') {
      document.documentElement.classList.add('skip-workspace-boot');
    }
  } catch { /* storage blocked — normal splash is fine */ }
  try {
    const media = (query) => !!(window.matchMedia && window.matchMedia(query).matches);
    const standalone = media('(display-mode: standalone)') || navigator.standalone === true;
    const touch = Number(navigator.maxTouchPoints || 0) > 0 || media('(pointer: coarse)') || ('ontouchstart' in window);
    const userAgent = String(navigator.userAgent || '');
    const mobilePlatform = !!(navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|iPod/i.test(userAgent);
    const screenShort = Math.min(Number(screen.width || 9999), Number(screen.height || 9999));
    const viewportShort = Math.min(Number(window.innerWidth || 9999), Number(window.innerHeight || 9999));

    // Android "Desktop site" can report a wide viewport. Use the physical screen,
    // touch capability and standalone display mode instead of relying on CSS width only.
    if (standalone || (touch && (mobilePlatform || screenShort <= 900 || viewportShort <= 900))) {
      document.documentElement.classList.add('mobile-ui');
    }
    // Installed (home-screen) app window — CSS isse browser-feel hataane ke liye use karta hai
    // (no pull-to-refresh, no text-selection on chrome, native-style page transitions).
    if (standalone) document.documentElement.classList.add('pwa-standalone');

    // Register the root-scoped worker before the login/network boot starts.  Waiting until
    // onLogin() meant Chrome could treat the page as an ordinary tab on the first visit and
    // the install prompt/push setup raced the auth request.  This is deliberately best-effort:
    // a private/unsupported browser must still be able to use the dashboard normally.
    if (navigator.serviceWorker && window.isSecureContext !== false) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
        // The worker uses this small hint to prefer an already-open standalone client when a
        // notification is tapped.  Without it, an unrelated normal Chrome tab could win.
        const tellWorker = () => {
          try {
            const target = navigator.serviceWorker.controller || registration.active;
            if (target) target.postMessage({ type: 'ff-client-mode', standalone, at: Date.now() });
          } catch { /* optional */ }
        };
        tellWorker();
        if (navigator.serviceWorker.addEventListener) navigator.serviceWorker.addEventListener('controllerchange', tellWorker, { once: true });
      }).catch((error) => console.warn('Early service worker registration failed:', error));
    }
  } catch (error) {
    console.warn('Could not detect the mobile app display mode:', error);
  }

  try {
    // One-time migration after the previous global dark-paint bug: restore the normal light
    // appearance once, then continue remembering future theme changes made with the toolbar.
    if (localStorage.getItem('ff_theme_scope_migrated_v1') !== '1') {
      localStorage.setItem('ff_theme_explicit', 'light');
      localStorage.setItem('ff_theme', 'light');
      localStorage.setItem('ff_theme_scope_migrated_v1', '1');
    }
    const explicitTheme = localStorage.getItem('ff_theme_explicit');
    const osDark = explicitTheme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = (explicitTheme === 'dark' || osDark) ? 'dark' : 'light';
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
  // 🎨 Theme pack + saved branding — PAINT SE PEHLE (login screen aur login ke baad ka flash khatam).
  // Pehle pack wowzone.js se aata tha jo login ke BAAD load hota tha, aur branding rang server settings
  // se login ke baad — isliye pehle default theme dikhta tha, phir badalta tha. Ab dono device par
  // yaad rehte hain aur head me hi lag jaate hain; themes.css pack ke saare rang CSS se deta hai.
  const PACK_MODES = { desk: 'light', navy: 'light', ocean: 'light', forest: 'light', sunset: 'light', royal: 'light', gold: 'light', mono: 'light', glass: 'light', midnight: 'dark', neon: 'dark', diwali: 'dark' };
  window.FF_PACK_MODES = PACK_MODES;
  try {
    const root = document.documentElement;
    // 💙 v223 — Royal Blue Desk sabka default look (ek baar migrate; dark chunne wale / koi aur pack wale jaise the waise)
    const wantsDark = localStorage.getItem('ff_theme_explicit') === 'dark';
    let pack = localStorage.getItem('ff_theme_pack');
    if (localStorage.getItem('ff_desk_default_v1') !== '1') {
      if ((!pack || pack === 'default') && !wantsDark) { pack = 'desk'; try { localStorage.setItem('ff_theme_pack', 'desk'); } catch { /* ignore */ } }
      try { localStorage.setItem('ff_desk_default_v1', '1'); } catch { /* ignore */ }
    }
    pack = pack || (wantsDark ? 'default' : 'desk');
    if (PACK_MODES[pack]) {
      root.dataset.themePack = pack;
      root.dataset.theme = PACK_MODES[pack];
    } else {
      root.dataset.themePack = '';
      const b = JSON.parse(localStorage.getItem('ff_brand_cache') || 'null');
      if (b && typeof b === 'object') {
        const set = (k, v) => { if (v && /^#[0-9a-f]{3,8}$/i.test(String(v))) root.style.setProperty(k, v); };
        set('--side-bg', b.sidebarBg); set('--side-bg2', b.sidebarBg2); set('--side-ink', b.sidebarText);
        set('--brand', b.accent); set('--brand-2', b.accent2); set('--gv', b.gvAccent);
      }
    }
  } catch { /* storage blocked — desk look */ try { document.documentElement.dataset.themePack = 'desk'; document.documentElement.dataset.theme = 'light'; } catch { /* ignore */ } }
})();
