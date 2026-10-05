/* 🔊 CLOSED-APP VOICE (v3.36) — "app / web band ho tab bhi voice + text"

   Sach kya hai (aur kya nahi):
   • TEXT + sound + vibration → jab app poora band ho (phone locked) tab bhi OS notification panel
     me pahunchta hai. Ye Web Push karta hai (server → sw.js), aur pehle se chal raha hai.
   • VOICE (bol kar sunana) → Web Speech API **service worker me available hi nahi hoti** aur
     OS notification me sirf device ka system sound hota hai, koi custom awaaz nahi. Isliye:
       1. app khula hai (chahe background tab) → sw.js push aate hi page ko message bhejta hai,
          page office bell ke unlock/prefs path se TURANT bol deta hai,
       2. app poora band tha → sw.js bolne ki line queue me rakhta hai; app dobara khulte hi
          ye module wahi line bol kar sunata hai (voice catch-up — "app band the tab ye aaya tha").
   Ye module #1 aur #2 dono ko jodta hai, aur saare existing switches ka respect karta hai:
     master (`enabled`) · sound · 🎙 Office Bell voice · mute · per-user `voice` pref (server me).

   API: FF.pushVoice.{ start, flush, pending, clear, test, isOn, setLocalOn } */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const VOICE_CACHE = 'ff-voice-v1';            // sw.js isi cache me job rakhta hai
  const VOICE_KEY = '/__ff_voice__/pending';
  const LS_ON = 'ff-voice-closed';              // local switch (browser-wise quick on/off)
  const MAX_PER_FLUSH = 3;                      // ek baar me itni lines (spam nahi)
  const GAP_MS = 1400;                          // do lines ke beech ka gap
  const MIN_GAP = 2500;                         // flush calls ke beech minimum gap
  const POLL_MS = 20e3;                         // background me halka check
  const st = { started: false, bound: false, timer: null, speaking: false, lastFlush: 0, lastNudge: 0, lastToastAt: 0, spoken: 0 };

  const localOn = () => { try { return localStorage.getItem(LS_ON) !== '0'; } catch { return true; } };
  function setLocalOn(v) {
    try { localStorage.setItem(LS_ON, v ? '1' : '0'); } catch { /* private mode */ }
    if (v) flush('local-on');
    return localOn();
  }
  const nPrefs = () => (FF.notifications && FF.notifications.prefs) || {};
  /** Sab switches ON hone chahiye — warna user ne voice band maanga hai. */
  function enabled() {
    const p = nPrefs();
    if (p.enabled === false || p.sound === false) return false; // master ya sound OFF = koi awaaz nahi
    if (p.voice === false) return false;                        // "app band ho tab bhi voice" switch
    return localOn();
  }
  function bellVoiceOk() {
    const b = FF.officeBell;
    if (!b) return true;
    try {
      if (typeof b.isVoiceOn === 'function') return !!b.isVoiceOn();
      if (typeof b.voiceOn !== 'undefined') return b.voiceOn !== false;
    } catch { /* prefs optional */ }
    return true;
  }
  function bellMuted() {
    try { const b = FF.officeBell; return !!(b && b.prefs && Number(b.prefs().muteUntil || 0) > Date.now()); } catch { return false; }
  }
  const currentUser = () => ((FF.auth && FF.auth.user && FF.auth.user.username) || '');
  /**
   * Shared device: sirf logged-in user ke alerts bole jayenge (dusre user ki job queue me safe rehti
   * hai). Login se pehle (login screen) kuch bhi nahi bolna — warna admin ki khabar sabke saamne.
   */
  function mine(job) {
    const me = currentUser();
    if (!me) return false;
    if (!job || !job.user) return true;
    return job.user === me;
  }

  // ---- queue (Cache Storage — sw.js aur page dono same cache padhte/likhte hain) -------------------
  const canCache = () => typeof caches !== 'undefined' && caches && typeof caches.open === 'function';
  async function readQueue() {
    if (!canCache()) return [];
    try {
      const cache = await caches.open(VOICE_CACHE);
      const hit = await cache.match(VOICE_KEY);
      if (!hit) return [];
      const list = await hit.json();
      if (!Array.isArray(list)) return [];
      const now = Date.now();
      return list.filter((x) => x && x.text && now - Number(x.at || 0) < 12 * 3600e3);
    } catch { return []; }
  }
  async function writeQueue(list) {
    if (!canCache()) return;
    try {
      const cache = await caches.open(VOICE_CACHE);
      await cache.put(VOICE_KEY, new Response(JSON.stringify((list || []).slice(-8))));
    } catch { /* optional */ }
  }
  async function dropJob(id) {
    if (!id) return;
    const list = await readQueue();
    await writeQueue(list.filter((x) => x.id !== id));
    // SW ke andar bhi ack bhej do (agar wo job abhi add kar raha ho to double na ho).
    try {
      const reg = navigator.serviceWorker && (navigator.serviceWorker.controller || null);
      if (reg && reg.postMessage) reg.postMessage({ type: 'ff-voice-ack', id: String(id) });
    } catch { /* ignore */ }
  }
  async function clear() { await writeQueue([]); return true; }

  // ---- 🔊 bolna -----------------------------------------------------------------------------------
  /** Office Bell ke speaker path se bolo (assistant voice profile + autoplay unlock + queue). */
  function speak(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return Promise.resolve(false);
    const bell = FF.officeBell;
    const hidden = typeof document !== 'undefined' && document.hidden;
    try {
      if (bell && typeof bell.speakAnnounce === 'function') {
        if (hidden && typeof bell.queueAnnounce === 'function') { bell.queueAnnounce(t, 3); return Promise.resolve(true); }
        return Promise.resolve(bell.speakAnnounce(t, 3));
      }
      if (bell && typeof bell.queueAnnounce === 'function') { bell.queueAnnounce(t, 3); return Promise.resolve(true); }
    } catch { /* fall through to raw speechSynthesis */ }
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve(false);
      const u = new SpeechSynthesisUtterance(t);
      u.lang = 'hi-IN'; u.rate = 1.02;
      return new Promise((resolve) => {
        let done = false;
        const end = (v) => { if (!done) { done = true; resolve(v); } };
        u.onend = () => end(true);
        u.onerror = () => end(false);
        window.speechSynthesis.speak(u);
        setTimeout(() => end(true), 9000); // kuch browsers onend nahi dete
      });
    } catch { return Promise.resolve(false); }
  }

  /** Ek baar ka chhota nudge (agar browser ne autoplay block kiya ho). */
  function nudge(count) {
    const now = Date.now();
    if (now - st.lastNudge < 10 * 60e3) return;
    st.lastNudge = now;
    try {
      if (U && U.toast) U.toast(`🔊 App band the tab ${count} alert aaya tha — sunane ke liye screen par ek baar tap karo.`, 'info');
    } catch { /* toast optional */ }
  }

  // ---- catch-up -----------------------------------------------------------------------------------
  /** Queue me pada hua sunao (jaise hi page visible + unlocked ho). */
  async function flush(reason) {
    if (!st.started) return 0;
    if (!enabled() || !bellVoiceOk() || bellMuted()) return 0;
    // Chal rahi awaaz khatam hone do — live push ko chhodna nahi hai, bas line ke baad bolna hai.
    for (let i = 0; i < 100 && st.speaking; i++) await new Promise((r) => setTimeout(r, 120));
    if (st.speaking) return 0;
    const now = Date.now();
    if (now - st.lastFlush < 900) return 0;
    st.lastFlush = now;
    let queue = [];
    try { queue = (await readQueue()).filter(mine); } catch { return 0; }
    if (!queue.length) return 0;
    st.speaking = true;
    let spoken = 0;
    try {
      const batch = queue.slice(0, MAX_PER_FLUSH);
      for (const job of batch) {
        // Slot reserve karo — isi khabar ko notifications.js ka poll dobara na bole.
        try { if (FF.notifications && FF.notifications.noteVoiced) FF.notifications.noteVoiced(job.type); } catch { /* optional */ }
        const ok = await speak(job.text);
        if (!ok) { nudge(queue.length); break; }   // autoplay block — gesture par dobara try hoga
        await dropJob(job.id);
        spoken++; st.spoken++;
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      if (spoken) {
        try {
          if (U && U.toast && Date.now() - st.lastToastAt > 60e3) {
            st.lastToastAt = Date.now();
            U.toast(spoken === 1 ? '🔊 App band hone ke dauraan aaya 1 alert bol diya.' : `🔊 App band hone ke dauraan aaye ${spoken} alerts bol diye.`, 'ok');
          }
        } catch { /* optional */ }
      }
      if (queue.length > batch.length) setTimeout(() => flush('rest'), 4000).unref?.();
    } finally { st.speaking = false; }
    return spoken;
  }

  // ---- wiring -------------------------------------------------------------------------------------
  function onSwMessage(e) {
    const m = e && e.data;
    if (!m || m.type !== 'ff-speak-push' || !m.item) return;
    // Live push: page khula hai (chahe background tab) → turant bolne ki koshish karo.
    setTimeout(() => flush('push'), 60).unref?.();
  }
  function bind() {
    if (st.bound || typeof document === 'undefined') return;
    st.bound = true;
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) navigator.serviceWorker.addEventListener('message', onSwMessage);
    } catch { /* SW optional */ }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      try { if (FF.officeBell && FF.officeBell.unlock) FF.officeBell.unlock('retry'); } catch { /* ignore */ }
      flush('visible');
    });
    ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => {
      try { document.addEventListener(ev, () => { if (enabled()) setTimeout(() => flush('gesture'), 250).unref?.(); }, { passive: true }); } catch { /* ignore */ }
    });
    try { window.addEventListener('focus', () => flush('focus')); } catch { /* ignore */ }
  }
  function start() {
    if (st.started) return FF.pushVoice;
    st.started = true;
    bind();
    // Login hone ke baad hi queue flush hoti hai (mine() user check) — isliye boot par 3 try
    // (login flows kuch second me poore ho jaate hain) + halka background poll.
    [2500, 8000, 20000].forEach((ms) => setTimeout(() => flush('boot'), ms).unref?.());
    st.timer = setInterval(() => { if (!document.hidden) flush('tick'); }, POLL_MS);
    st.timer.unref?.();
    return FF.pushVoice;
  }

  FF.pushVoice = {
    start, flush, clear, speak,
    /** Abhi test karo — wahi awaaz jo app band hone ke baad aayi alert par bajegi. */
    test: () => {
      try { if (FF.officeBell && FF.officeBell.unlock) FF.officeBell.unlock('retry'); } catch { /* ignore */ }
      return speak('Test alert. App band hone par aane wala alert aise bol kar sunaya jayega.');
    },
    pending: async () => (await readQueue()).filter(mine),
    isOn: enabled, localOn, setLocalOn,
    get spoken() { return st.spoken; },
    get supported() { return typeof window !== 'undefined' && ('speechSynthesis' in window); }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => start());
    else start();
  }
})(window.FF);
