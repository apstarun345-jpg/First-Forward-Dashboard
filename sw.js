// Versioned app shell + offline data cache.
// Auth login/logout/password endpoints are NEVER cached. Sheet data (gviz), /api/auth/me and
// /api/settings are network-first with a cached fallback — internet na ho to last loaded data se app khulta hai.
const CACHE_NAME = 'apnapayment-v12';
const DATA_CACHE = 'ff-data-v3';
const ASSETS = ['./', './index.html', './styles.css?v=13', './favicon.svg?v=5', './icon-192.png?v=5', './icon-512.png?v=5'];
const OFFLINE_API = (path) => path === '/api/gviz' || path === '/api/auth/me' || path === '/api/settings';

// ---- 🔊 Short notification beep (generated with Web Audio on push, no external asset needed) ----
// Base64-encoded silent fallback + a simple beep tone via AudioContext doesn't work from SW global scope
// reliably, so we use a tiny embedded WAV (200ms beep @ 880Hz) generated at build-time.
// Using the showNotification vibration pattern + badge is the most mobile-reliable approach.

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith('ff-dashboard-') || k.startsWith('apnapayment-')) && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// ---- 📱 Mobile + desktop web push: server se instant notification (app band ho tab bhi) ----
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Dashboard update', body: '' }; }
  const title = data.title || 'First Forward Dashboard';
  const options = {
    body: data.body || 'Naya update aaya hai — app khol ke dekho.',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag || 'ff',
    renotify: true,
    requireInteraction: !!data.persist,
    silent: data.sound === false,
    // Mobile vibration pattern (works on Android Chrome): 200ms vibrate, 100ms gap, 200ms vibrate
    vibrate: data.sound === false ? undefined : [200, 100, 200],
    data: { link: data.link || '', sound: data.sound !== false }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if ('focus' in client) { if (link) client.navigate(link).catch(() => {}); return client.focus(); }
    }
    return self.clients.openWindow(link || './');
  }));
});
self.addEventListener('pushsubscriptionchange', e => {
  // Naya subscription chahiye hoga — app khulte hi notifications.js re-subscribe kar lega.
  e.waitUntil(Promise.resolve());
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
