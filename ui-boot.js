/* Early PWA/mobile layout detection and theme boot. Kept external so the server CSP can
   block inline script without accidentally disabling the standalone/mobile layout. */
(() => {
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
    // Only honour the explicit toolbar choice. Legacy ff_theme values from older releases
    // must not switch the whole application into dark mode during initial paint.
    const explicitTheme = localStorage.getItem('ff_theme_explicit');
    document.documentElement.dataset.theme = explicitTheme === 'dark' ? 'dark' : 'light';
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
