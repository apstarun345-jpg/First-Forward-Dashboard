// Versioned app shell + offline data cache.
// Auth login/logout/password endpoints are NEVER cached. Sheet data (gviz), /api/auth/me and
// /api/settings are network-first with a cached fallback — internet na ho to last loaded data se app khulta hai.
const CACHE_NAME = 'apnapayment-v101';
const DATA_CACHE = 'ff-data-v5';
const STASH_CACHE = 'ff-push-stash-v1'; // pushsubscriptionchange ke waqt bani subscription yahan rakho
// 🔊 v3.36 — app band hone par aaye alerts ki VOICE queue (page khulte hi bol kar sunata hai).
const VOICE_CACHE = 'ff-voice-v1';
const VOICE_KEY = '/__ff_voice__/pending';
const VOICE_MAX = 8;                    // itni lines se zyada catch-up nahi (spam nahi)
const VOICE_TTL = 12 * 3600e3;          // 12 ghante tak wapas kholte hi suna denge
// ⚡ Sirf eager core precache hota hai (pehla paint fast). Baaki page modules (lazy rollup)
//    pehli use par runtime-cache ho jaate hain — install par 2 MB extra download nahi hota.
// homeKpiFix.css bhi precache hota hai — Home ke KPI card text ke liye zaroori (offline/warm start par bhi).
const ASSETS = ['./', './index.html', './styles.css?v=101', './controlTower.css?v=1', './homeKpiFix.css?v=1', './config.js?v=101', './util.js?v=86', './i18n.js?v=86', './xlsx.js?v=86', './data.js?v=86', './stockAge.js?v=86', './charts.js?v=86', './model.js?v=86', './filters.js?v=86', './store.js?v=86', './gv.js?v=86', './preload.js?v=86', './auth.js?v=86', './notifications.js?v=86', './sheets.js?v=86', './liveView.js?v=86', './kpiDetail.js?v=86', './home.js?v=86', './performance.js?v=86', './agentBoard.js?v=86', './masterProfile.js?v=98', './masterSearch.js?v=98', './searchReport.js?v=86', './palette.js?v=86', './assistant.js?v=86', './officeBell.js?v=86', './pushVoice.js?v=86', './liveAssist.js?v=86', './morningCard.js?v=86', './lazy.js?v=101', './publicForm.js?v=86', './settings.js?v=101', './app.js?v=86', './logos/apna-payment.png', './favicon.svg?v=5', './icon-192.png?v=5', './icon-512.png?v=5'];
// Network-first snapshots survive a temporary connection loss; auth/actions remain live-only.
const OFFLINE_API = (path) => path === '/api/gviz' || path === '/api/today' || path === '/api/auth/me' || path === '/api/settings' || path === '/api/stock-history';

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

// ---- 🔊 Voice queue helpers ---------------------------------------------------------------------
// Web Speech API service worker me nahi chalti aur OS notification me sirf system sound hota hai —
// isliye har push ka "bolne layak" text yahan (Cache Storage me) queue hota hai:
//   1. app khuli (ya background tab) hai → turant page ko postMessage; page apne unlock/prefs
//      ke hisaab se bolta hai ya queue karta hai,
//   2. app poora band hai → text + sound + vibration OS panel me turant jaata hai, aur ye line
//      queue me rehti hai; app dobara khulte hi page use bol kar sunata hai (voice catch-up).
async function voiceQueue() {
  try {
    const cache = await caches.open(VOICE_CACHE);
    const hit = await cache.match(VOICE_KEY);
    if (!hit) return [];
    const list = await hit.json();
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    return list.filter(x => x && x.text && now - Number(x.at || 0) < VOICE_TTL);
  } catch { return []; }
}
async function voiceSave(list) {
  try {
    const cache = await caches.open(VOICE_CACHE);
    await cache.put(VOICE_KEY, new Response(JSON.stringify(list.slice(-VOICE_MAX))));
  } catch { /* cache full / private mode — voice optional hai */ }
}
async function voiceAdd(item) {
  const list = await voiceQueue();
  if (list.some(x => x.id === item.id)) return list;
  list.push(item);
  await voiceSave(list);
  return list;
}
async function voiceDrop(id) {
  const list = await voiceQueue();
  await voiceSave(list.filter(x => x.id !== id));
}
/** Khuli hui app windows ko message bhejo (page prefs/unlock ke hisaab se bolta ya queue karta hai). */
async function tellClients(message) {
  try {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let n = 0;
    for (const client of list) { try { client.postMessage(message); n++; } catch { /* controlled nahi hai */ } }
    return n;
  } catch { return 0; }
}
/** App icon par unread badge (Chromium; support na ho to chup-chaap skip). */
async function setBadge(count) {
  try {
    const nav = self.navigator || {};
    if (Number(count) > 0 && nav.setAppBadge) await nav.setAppBadge(Number(count));
    else if (nav.clearAppBadge) await nav.clearAppBadge();
  } catch { /* badge optional */ }
}

// ---- 📱 Mobile + desktop web push: server se instant notification (app band ho tab bhi) ----
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Dashboard update', body: '' }; }
  const title = data.title || 'First Forward Dashboard';
  const sound = data.sound !== false;
  const tone = ['classic', 'soft', 'double', 'chime', 'alert'].includes(data.tone) ? data.tone : 'classic';
  // Web Push cannot select a platform's native notification sound; the selected tone drives
  // in-app Web Audio, while these distinct vibration patterns carry into supported Android PWAs.
  const vibration = { classic: [200, 100, 200], soft: [70], double: [70, 80, 70], chime: [50, 60, 50, 60, 100], alert: [250, 70, 250] }[tone];
  const link = data.link || '';
  const voiceText = String(data.voice || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const wantVoice = data.speak !== false && data.silent !== true && !!voiceText;
  const id = String(data.id || `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`);
  const actions = Array.isArray(data.actions)
    ? data.actions.filter(a => a && a.action && a.title).slice(0, 2).map(a => ({ action: String(a.action).slice(0, 24), title: String(a.title).slice(0, 24) }))
    : [];
  const options = {
    body: data.body || 'Naya update aaya hai — app khol ke dekho.',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag || `ff-${String(data.type || 'info').replace(/[^a-z0-9_-]/gi, '-').slice(0, 24)}-${id}`,
    renotify: true,
    requireInteraction: !!data.persist,
    vibrate: sound ? vibration : undefined,
    timestamp: Number(data.at) || Date.now(),
    lang: data.lang || 'hi-IN',
    ...(actions.length ? { actions } : {}),
    data: { link, sound, tone, voice: wantVoice ? voiceText : '', id, type: data.type || 'info', user: data.user || '', at: Date.now() }
  };
  const job = wantVoice ? { id, at: Date.now(), text: voiceText, title, type: data.tag || 'ff', tone, link, user: data.user || '' } : null;
  // Chrome ka rule: har push event par ek notification dikhani hi padti hai, warna
  // "notification not shown" error aata hai aur future push band ho sakte hain.
  e.waitUntil((async () => {
    // Notification PEHLE (Chrome ki requirement + user ko turant dikhe), uske baad voice/badge.
    try { await self.registration.showNotification(title, options); }
    catch (err) { console.warn('showNotification:', err && err.message); }
    if (job) { await voiceAdd(job); await tellClients({ type: 'ff-speak-push', item: job }); }
    if (data.badge !== undefined) await setBadge(data.badge);
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const info = e.notification.data || {};
  const raw = info.link || '';
  // "Theek hai" action = user ne alert dekh liya → voice catch-up queue se hata do.
  if (e.action === 'dismiss') {
    if (info.id) e.waitUntil(voiceDrop(String(info.id)));
    return;
  }
  // Link '#/targets' jaisa hash hota hai — SW ki script URL ('/sw.js') se resolve karne par
  // '/sw.js#/targets' ban jaata tha. Isliye registration.scope (app root) se banao.
  let target = self.registration.scope || './';
  try { target = new URL(raw || './', self.registration.scope || self.location.origin + '/').href; } catch { /* keep scope */ }
  e.waitUntil((async () => {
    // Tap = user gesture → awaaz ab pakka chalegi (autoplay policy block nahi karti).
    if (info.voice) await tellClients({ type: 'ff-speak-push', item: { id: info.id, text: info.voice, at: Date.now(), type: info.type || 'ff', tone: info.tone, link: raw, user: info.user || '' } });
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if ('focus' in client) {
        if (client.navigate) client.navigate(target).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
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
  // 🔊 Voice catch-up: page bol kar sunane ke baad job ko queue se hata deta hai; badge bhi yahin se.
  if (msg.type === 'ff-voice-ack') { e.waitUntil(voiceDrop(String(msg.id || ''))); return; }
  if (msg.type === 'ff-voice-clear') { e.waitUntil(voiceSave([])); return; }
  if (msg.type === 'ff-badge') { e.waitUntil(setBadge(Number(msg.count) || 0)); return; }
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