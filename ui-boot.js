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
  } catch (error) {
    console.warn('Could not detect the mobile app display mode:', error);
  }

  try {
    if (localStorage.getItem('ff_theme') === 'dark') {
      document.documentElement.dataset.theme = 'dark';
    }
  } catch { /* local storage can be disabled in private browsing */ }
})();
