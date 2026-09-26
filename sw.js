// First Forward Dashboard — Service Worker for PWA + fast caching
const CACHE_NAME = 'ff-dashboard-v3.2-robo';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './util.js',
  './xlsx.js',
  './data.js',
  './charts.js',
  './model.js',
  './store.js',
  './gv.js',
  './preload.js',
  './auth.js',
  './notifications.js',
  './sheets.js',
  './dashboard.js',
  './trend.js',
  './stock.js',
  './performance.js',
  './home.js',
  './gvpages.js',
  './compare.js',
  './tagIssued.js',
  './settings.js',
  './app.js',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Network-first for API, cache-first for assets
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API always network
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Google sheets proxy — network only
  if (url.pathname.startsWith('/api/gviz') || url.hostname.includes('docs.google.com')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Assets: cache-first with network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // background update
        e.waitUntil(fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE_NAME).then(c => c.put(e.request, res));
        }).catch(()=>{}));
        return cached;
      }
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        if (e.request.destination === 'document') return caches.match('./index.html');
      });
    })
  );
});
