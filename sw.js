// Versioned app shell + offline data cache.
// Auth login/logout/password endpoints are NEVER cached. Sheet data (gviz), /api/auth/me and
// /api/settings are network-first with a cached fallback — internet na ho to last loaded data se app khulta hai.
const CACHE_NAME = 'apnapayment-v39';
const DATA_CACHE = 'ff-data-v3';
const STASH_CACHE = 'ff-push-stash-v1'; // pushsubscriptionchange ke waqt bani subscription yahan rakho
const ASSETS = ['./', './index.html', './styles.css?v=34', './assistant.js?v=34', './masterSearch.js?v=34', './directAgents.js?v=34', './masterSearch.js?v=34', './wowzone.js?v=34', './favicon.svg?v=5', './icon-192.png?v=5', './icon-512.png?v=5'];
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
  const sound = data.sound !== false;
  const options = {
    body: data.body || 'Naya update aaya hai — app khol ke dekho.',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag || 'ff',
    renotify: true,
    requireInteraction: !!data.persist,
    // Mobile vibration pattern (Android Chrome): 200ms vibrate, 100ms gap, 200ms vibrate
    vibrate: sound ? [200, 100, 200] : undefined,
    data: { link: data.link || '', sound }
  };
  // Chrome ka rule: har push event par ek notification dikhani hi padti hai, warna
  // "notification not shown" error aata hai aur future push band ho sakte hain.
  e.waitUntil(self.registration.showNotification(title, options).catch(err => console.warn('showNotification:', err && err.message)));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const raw = (e.notification.data && e.notification.data.link) || '';
  // Link '#/targets' jaisa hash hota hai — SW ki script URL ('/sw.js') se resolve karne par
  // '/sw.js#/targets' ban jaata tha. Isliye registration.scope (app root) se banao.
  let target = self.registration.scope || './';
  try { target = new URL(raw || './', self.registration.scope || self.location.origin + '/').href; } catch { /* keep scope */ }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if ('focus' in client) {
        client.navigate(target).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});

// ---- 🔁 Subscription refresh: push service khud subscription badal deta hai (Android par aksar) ----
// Purana code kuch nahi karta tha → subscription chup-chaap dead ho jaati thi aur panel silent.
// Ab: nayi subscription banao, server ko bhejo; session na ho to stash kar do (app khulte hi flush).
async function stashPut(key, value) {
  const cache = await caches.open(STASH_CACHE);
  await cache.put(new Request(`/__ff_push_stash__/${key}`), new Response(JSON.stringify(value)));
}
async function stashGet(key) {
  const cache = await caches.open(STASH_CACHE);
  const res = await cache.match(new Request(`/__ff_push_stash__/${key}`));
  return res ? res.json().catch(() => null) : null;
}
async function stashDel(key) {
  const cache = await caches.open(STASH_CACHE);
  await cache.delete(new Request(`/__ff_push_stash__/${key}`));
}
async function serverVapidKey() {
  try {
    const res = await fetch('/api/push/vapid', { credentials: 'include' });
    if (!res.ok) return null;
    const out = await res.json();
    return out && out.publicKey ? out.publicKey : null;
  } catch { return null; }
}
/** Current VAPID key se (re)subscribe karo aur server ko bhejo. 'ok' | 'stashed' | 'failed' */
async function resubscribe(reason) {
  if (!self.registration || !self.registration.pushManager) return 'failed';
  const publicKey = await serverVapidKey();
  if (!publicKey) return 'failed'; // logged out ya server down — page kholne par dobara try hoga
  const pad = '='.repeat((4 - (publicKey.length % 4)) % 4);
  const bin = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + pad);
  let key = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) key[i] = bin.charCodeAt(i);
  // Browser applicationServerKey ke roop me sirf 65-byte raw uncompressed P-256 point (0x04 || X || Y)
  // accept karta hai — kahin se SPKI DER (91 bytes) aaye to raw point uski aakhri 65 bytes me hota hai.
  // Warna subscribe "The provided applicationServerKey is not valid" se crash ho jaata hai.
  if (key.length > 65 && key[key.length - 65] === 4) key = key.slice(key.length - 65);
  let sub = null;
  try {
    const old = await self.registration.pushManager.getSubscription();
    sub = old;
    if (old) {
      // Purani subscription kisi AUR VAPID key se bani hai? Drop karke nayi banao.
      const cur = old.options && old.options.applicationServerKey ? new Uint8Array(old.options.applicationServerKey) : null;
      const same = !!cur && cur.length === key.length && cur.every((b, i) => b === key[i]);
      if (!same) { await old.unsubscribe().catch(() => {}); sub = null; }
    }
    if (!sub) sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch (err) { console.warn('push resubscribe:', (err && err.message) || err); return 'failed'; }
  if (!sub) return 'failed';
  try {
    const res = await fetch('/api/push/subscribe', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), reason: reason || 'sw' })
    });
    if (res.ok) { await stashDel('pending'); return 'ok'; }
  } catch { /* network */ }
  // Session expire / offline → subscription stash kar do, app khulte hi page ise server ko bhej dega.
  try { await stashPut('pending', { subscription: sub.toJSON(), reason: reason || 'sw', at: new Date().toISOString() }); } catch { /* ignore */ }
  return 'stashed';
}
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(resubscribe('pushsubscriptionchange').catch(() => {}));
});
// Page se commands: pending subscription flush, forced re-subscribe, aur OS-panel test notification.
self.addEventListener('message', e => {
  const msg = e.data || {};
  if (msg.type === 'ff-push-flush') {
    e.waitUntil((async () => {
      const pending = await stashGet('pending');
      if (!pending || !pending.subscription) return;
      try {
        const res = await fetch('/api/push/subscribe', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) });
        if (res.ok) await stashDel('pending');
      } catch { /* offline — next open par retry */ }
    })());
    return;
  }
  if (msg.type === 'ff-push-resubscribe') { e.waitUntil(resubscribe(msg.reason || 'manual')); return; }
  if (msg.type === 'ff-local-test') {
    e.waitUntil(self.registration.showNotification('🔔 Test notification', {
      body: 'Ye alert phone ke notification panel me aaya — OS notifications kaam kar rahe hain ✓',
      icon: 'icon-192.png', badge: 'icon-192.png', tag: 'ff-test', vibrate: [200, 100, 200]
    }).catch(() => {}));
  }
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
