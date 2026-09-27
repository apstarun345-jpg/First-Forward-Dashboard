// Versioned app shell only. Auth/API data must NEVER live in a service-worker cache.
const CACHE_NAME = 'apnapayment-v7';
const ASSETS = ['./index.html', './styles.css?v=8', './favicon.svg?v=5', './icon-192.png?v=5', './icon-512.png?v=5'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ff-dashboard-') || (k.startsWith('apnapayment-') && k !== CACHE_NAME)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Navigation uses the current HTML, including new script versions. Never fall back to HTML for JS/images.
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
