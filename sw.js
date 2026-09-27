// Versioned app shell + offline data cache.
// Auth login/logout/password endpoints are NEVER cached. Sheet data (gviz), /api/auth/me and
// /api/settings are network-first with a cached fallback — internet na ho to last loaded data se app khulta hai.
const CACHE_NAME = 'apnapayment-v10';
const DATA_CACHE = 'ff-data-v3';
const ASSETS = ['./index.html', './styles.css?v=11', './favicon.svg?v=5', './icon-192.png?v=5', './icon-512.png?v=5'];
const OFFLINE_API = (path) => path === '/api/gviz' || path === '/api/auth/me' || path === '/api/settings';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith('ff-dashboard-') || k.startsWith('apnapayment-')) && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // ---- API: cacheable endpoints only (gviz + me + settings) — network first, offline fallback ----
  if (url.pathname.startsWith('/api/')) {
    if (!OFFLINE_API(url.pathname)) return; // auth/users/notifications etc. hamesha live
    e.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      const wantsFresh = url.searchParams.get('fresh') === '1';
      try {
        const response = await fetch(e.request);
        if (response.ok) await cache.put(e.request, response.clone());
        return response;
      } catch (err) {
        if (!wantsFresh) {
          const hit = await cache.match(e.request);
          if (hit) return hit;
        }
        throw err;
      }
    })());
    return;
  }

  // ---- static assets: network first, runtime-cached, offline fallback ----
  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(e.request);
      if (response.ok) {
        await cache.put(e.request, response.clone());
        if (e.request.mode === 'navigate') await cache.put('./index.html', response.clone());
      }
      return response;
    } catch (err) {
      const cached = await cache.match(e.request);
      if (cached) return cached;
      if (e.request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
