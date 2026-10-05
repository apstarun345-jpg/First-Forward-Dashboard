/* 🔔 OFFICE BELL + 🎙️ VOICE ANNOUNCER (v3.18)
   Naya tag issue hua to office me live khabar:
   • Topbar me bell toggle 🔔 (on/off) + voice toggle 🔊 (bol kar sunao / sirf ting)
   • Har 30 sec halka agent-wise live query (EIR + GV Master — sirf aaj ka group-by count)
   • Kis agent ke kitne naye tags aaye ye pata chalta hai:
     - Voice ON  → "Rahul ne 5 naye tags issue kiye" bol kar sunata hai (ting ki jagah)
     - Voice OFF → WebAudio "ting" (jitne zyada tags, utna full sound)
   • Right-bottom me floating "+N 🏷️" ticker chip hamesha dikhta hai
   • Bahut bada burst (40+) → "zabardast" announcement
   Sheet me time nahi hota isliye ye poll-based hai — naye rows sheet me aate hi pata chalta hai.

   ⚠️ v3.18 — VOICE FIX: Chrome/Edge autoplay policy ki wajah se `speechSynthesis.speak()` bina
   user gesture ke "not-allowed" error deta tha, isliye naye tags ki awaaz kabhi aati hi nahi thi.
   Ab:
     1. pehle click/tap/keypress par audio unlock hota hai (AudioContext.resume + silent utterance),
     2. unlock se pehle aaye announcements queue me rakhe jaate hain aur unlock hote hi bole jaate hain,
     3. speak fail ho to WebAudio "ting" bajta hai + ek "🔊 Awaaz chalu karo" nudge dikhta hai,
     4. tab background me ho to bhi poll chalta hai, awaaz tab visible hote hi nikalti hai,
     5. 🔊 button par click → options menu (test voice · min tags · FF/GV · mute · aaj ka log). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const LS_KEY = 'ff-office-bell';
  const LS_VOICE = 'ff-office-bell-voice';
  const LS_PREFS = 'ff-office-bell-prefs';
  const LS_LOG = 'ff-office-bell-log';
  const LS_NUDGE = 'ff-office-bell-nudge';
  const st = {
    mounted: false, timer: null, last: null, fails: 0, pings: 0, audio: null,
    unlocked: false, unlockBound: false, pending: [], lastErr: '', nudge: null, menu: null,
    lastSpokeAt: 0     // 🔊 aakhri baar SACH ME bola kab tha (notifications.js duplicate-suppression ise padhta hai)
  };

  // ---- prefs (localStorage) -----------------------------------------------------------------------
  const TONE_OPTIONS = [
    { id: 'classic', label: 'Classic · rising with update size' },
    { id: 'soft', label: 'Soft · gentle single note' },
    { id: 'double', label: 'Double · two quick notes' },
    { id: 'chime', label: 'Chime · three rising notes' },
    { id: 'alert', label: 'Alert · alternating notes' }
  ];
  const VALID_TONES = new Set(TONE_OPTIONS.map((x) => x.id));
  const DEFAULTS = { minTags: 1, ff: true, gv: true, ting: true, tone: 'classic', muteUntil: 0 };
  function prefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(LS_PREFS) || '{}') || {}; } catch { p = {}; }
    const out = { ...DEFAULTS, ...p };
    if (!VALID_TONES.has(String(out.tone))) out.tone = DEFAULTS.tone;
    return out;
  }
  function setPrefs(patch) {
    const next = { ...prefs(), ...(patch || {}) };
    if (!VALID_TONES.has(String(next.tone))) next.tone = DEFAULTS.tone;
    try { localStorage.setItem(LS_PREFS, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  }
  const on = () => { try { return localStorage.getItem(LS_KEY) !== '0'; } catch { return true; } };
  const setOn = (v) => { try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch { /* ignore */ } };
  const voiceOn = () => { try { return localStorage.getItem(LS_VOICE) !== '0'; } catch { return true; } };
  const setVoice = (v) => { try { localStorage.setItem(LS_VOICE, v ? '1' : '0'); } catch { /* ignore */ } };
  const featOn = () => !(FF.config.features && FF.config.features.officeBell === false);
  const muted = () => Number(prefs().muteUntil || 0) > Date.now();

  // ---- announcement log (aaj ki poori khabar, drawer/menu me dikhti hai) ----------------------------
  function logList() {
    try { const l = JSON.parse(localStorage.getItem(LS_LOG) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
  }
  function logAdd(entry) {
    try { localStorage.setItem(LS_LOG, JSON.stringify([entry, ...logList()].slice(0, 60))); } catch { /* full */ }
  }

  // ---- sound -----------------------------------------------------------------------------------
  function ting(delta) {
    if (prefs().ting === false) return;
    try {
      if (!st.audio) st.audio = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = st.audio;
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime;
      const tone = prefs().tone;
      const notes = tone === 'soft' ? [523.25]
        : tone === 'double' ? [659.25, 880]
          : tone === 'chime' ? [659.25, 880, 1174.66]
            : tone === 'alert' ? [1046.5, 784, 1046.5]
              : (delta >= 25 ? [880, 1108.7, 1318.5] : delta >= 10 ? [783.99, 987.77] : [659.25]);
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        const at = t0 + i * (tone === 'soft' ? 0 : 0.11);
        const duration = tone === 'soft' ? 0.34 : 0.19;
        o.type = tone === 'alert' ? 'triangle' : 'sine'; o.frequency.value = f * (tone === 'classic' ? 1 + Math.min(delta, 50) / 400 : 1);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(tone === 'soft' ? 0.07 : 0.12, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        o.connect(g); g.connect(ctx.destination);
        o.start(at); o.stop(at + duration + 0.02);
      });
    } catch { /* sound blocked — ignore */ }
  }
  function testTing() { unlock('retry'); ting(1); }

  // ---- 🔊 audio unlock (autoplay policy) --------------------------------------------------------
  /** Browser sirf user gesture ke andar audio kholne deta hai. Pehle click/keypress par ek baar
      AudioContext resume + ek silent utterance bol do — uske baad background speak allowed hai. */
  function unlock(force) {
    if (st.unlocked && force !== 'retry') return st.unlocked;
    try {
      if (!st.audio) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) st.audio = new AC(); }
      if (st.audio && st.audio.state === 'suspended' && st.audio.resume) st.audio.resume();
    } catch { /* no WebAudio */ }
    // 🔗 Notifications ka apna beep-context bhi isi gesture me unlock karo — dono alag AudioContext
    //    hain, isliye ek ko unlock karna doosre ke liye kaafi nahi tha (Chrome website silent bug).
    try { if (FF.notifications && FF.notifications.unlockAudio) FF.notifications.unlockAudio(); } catch { /* optional */ }
    try {
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0.001; u.rate = 2;
        u.onend = () => { st.unlocked = true; hideNudge(); flushPending(); };
        u.onerror = () => { st.unlocked = true; hideNudge(); flushPending(); };
        window.speechSynthesis.speak(u);
        st.unlocked = true;                     // gesture ke andar call ho gaya
        setTimeout(flushPending, 350);
      }
    } catch { /* ignore */ }
    updateBtn();
    return st.unlocked;
  }
  function bindUnlock() {
    if (st.unlockBound || typeof document === 'undefined' || !document.addEventListener) return;
    st.unlockBound = true;
    const once = () => unlock();
    ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, once, { once: false, passive: true }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { unlock(); flushPending(); } });
  }
  /** 🎙️ v3.38 — boot par voice list garam karo. macOS/Safari/Chrome me `getVoices()` shuruaat me
   *  khaali hoti hai aur `voiceschanged` par baad me aati hai; agar hum pehli announce par intezaar
   *  karein to voice pick fail ho ke default (ya kuch bhi na) milta hai. Isliye mount par hi
   *  getVoices() bulao + voiceschanged suno — list pehli awaaz se pehle ready hoti hai. */
  function warmVoices() {
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const synth = window.speechSynthesis;
      try { synth.getVoices(); } catch { /* optional */ }
      const onChanged = () => { try { synth.getVoices(); } catch { /* optional */ } };
      if (synth.addEventListener) synth.addEventListener('voiceschanged', onChanged);
      else if ('onvoiceschanged' in synth) synth.onvoiceschanged = onChanged;
    } catch { /* TTS available hi nahi */ }
  }

  // ---- 🎙️ voice announce ------------------------------------------------------------------------
  function announceText(movers, totalNew, sourceDeltas) {
    const hi = !(FF.assistant && FF.assistant.getLang && FF.assistant.getLang() === 'en');
    const top = [...(movers || [])].sort((a, b) => b.n - a.n);
    const firstName = (m) => String((m && m.agent) || '').split(/\s+/)[0] || 'Ek agent';
    const sourceName = (ch) => ch === 'GV' ? 'GV Partner' : 'First Forward';
    if (totalNew >= 40) {
      if (sourceDeltas && sourceDeltas.ff > 0 && sourceDeltas.gv > 0) {
        return hi ? `Zabardast! ${totalNew} naye tags — First Forward ${U.fmt(sourceDeltas.ff)}, GV Partner ${U.fmt(sourceDeltas.gv)}.`
          : `Amazing! ${totalNew} new tags — First Forward ${U.fmt(sourceDeltas.ff)}, GV Partner ${U.fmt(sourceDeltas.gv)}.`;
      }
      return hi ? `Zabardast! ${totalNew} naye tags aa gaye — sab kaam par lage hain!`
        : `Amazing! ${totalNew} new tags just came in — everyone is firing!`;
    }
    if (!top.length) return hi ? `${totalNew} naye tags update hue.` : `${totalNew} new tags were updated.`;
    if (top.length === 1) {
      const m = top[0];
      return hi ? `${firstName(m)} ne ${m.n} ${sourceName(m.ch)} ke naye tags issue kiye.`
        : `${firstName(m)} issued ${m.n} new ${sourceName(m.ch)} tags.`;
    }
    const first = top[0], second = top[1];
    const rest = top.length - 2, restN = top.slice(2).reduce((s, m) => s + m.n, 0);
    let text = hi
      ? `${sourceName(first.ch)} me ${firstName(first)} ne ${first.n}, ${sourceName(second.ch)} me ${firstName(second)} ne ${second.n} naye tags issue kiye.`
      : `${sourceName(first.ch)}: ${firstName(first)} issued ${first.n}; ${sourceName(second.ch)}: ${firstName(second)} issued ${second.n} new tags.`;
    if (rest > 0) text += hi ? ` Aur ${rest} agents ne mil kar ${restN} tags.` : ` Plus ${rest} more agents added ${rest}.`;
    return text;
  }

  /** 🔇 Chrome kabhi kabhi pehli utterance ko 'interrupted'/'canceled' bol kar band kar deta hai
      (jaise jab pehle se kuch bol raha ho ya silent unlock utterance cancel ho). Ye policy block
      NAHI hai — isse pehle hum galat me "BLOCKED" dikha dete the. Sirf asli policy error block hai. */
  const POLICY_ERRORS = ['not-allowed', 'not-allowed-error', 'NotAllowedError'];
  const BENIGN_ERRORS = ['interrupted', 'canceled', 'cancelled', 'audio-busy', 'audio-hardware', 'network', 'synthesis-unavailable', 'aborted', 'no-voice'];
  const isPolicyError = (reason) => POLICY_ERRORS.some((x) => String(reason || '').toLowerCase().includes(String(x).toLowerCase()));
  const isBenignError = (reason) => BENIGN_ERRORS.some((x) => String(reason || '').toLowerCase().includes(String(x).toLowerCase()));

  function speechVoices(synth, waitMs) {
    const read = () => {
      try { const list = synth && synth.getVoices ? synth.getVoices() : []; return Array.isArray(list) ? list : []; }
      catch { return []; }
    };
    const initial = read();
    // macOS/Safari can publish its installed voices asynchronously. Wait briefly for voiceschanged;
    // browsers without that event still get an immediate system-default fallback.
    if (initial.length || !synth || (!synth.addEventListener && !('onvoiceschanged' in synth))) return Promise.resolve(initial);
    return new Promise((resolve) => {
      let done = false, timer = null, oldHandler = null, installedHandler = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (synth.removeEventListener) synth.removeEventListener('voiceschanged', changed);
        else if (installedHandler && synth.onvoiceschanged === installedHandler) synth.onvoiceschanged = oldHandler || null;
      };
      const finish = (force) => {
        const voices = read();
        if (!force && !voices.length) return;
        if (done) return;
        done = true; cleanup(); resolve(voices);
      };
      const changed = () => finish(false);
      if (synth.addEventListener) synth.addEventListener('voiceschanged', changed);
      else {
        oldHandler = synth.onvoiceschanged;
        installedHandler = (...args) => { try { if (typeof oldHandler === 'function') oldHandler.apply(synth, args); } catch { /* listener */ } changed(); };
        synth.onvoiceschanged = installedHandler;
      }
      timer = setTimeout(() => finish(true), waitMs || 500);
    });
  }

  /** Bol kar sunao. System voices late-load hon ya synthesis paused ho to resume/retry; asli error
      par ting + nudge. Office Bell apni utterance banata hai (assistant callback ke duplicate fallback se bache). */
  function speakAnnounce(text, fallbackDelta) {
    return new Promise((resolve) => {
      let settled = false, retried = false, attempt = 0, watchdog = null, retryTimer = null;
      const finish = (ok, reason) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog); clearTimeout(retryTimer);
        if (ok) {
          st.unlocked = true; st.lastErr = ''; st.lastSpokeAt = Date.now(); hideNudge(); resolve(true);
          return;
        }
        st.lastErr = String(reason || 'error');
        if (isPolicyError(reason) || reason === 'unsupported') st.unlocked = false;
        ting(fallbackDelta || 3); showNudge(); resolve(false);
      };
      const ok = (id) => { if (id === attempt) finish(true); };
      const bad = (reason, id) => {
        if (settled || id !== attempt) return;
        clearTimeout(watchdog);
        // interrupted/canceled/audio-busy aksar Safari/macOS TTS queue se aata hai — ek clean retry.
        if ((isBenignError(reason) || reason === 'speech-timeout') && !retried) {
          retried = true;
          st.lastErr = String(reason || 'error');
          retryTimer = setTimeout(() => { if (!settled) speakDirect(); }, 180);
          return;
        }
        finish(false, reason);
      };
      const armWatchdog = (id, ms, graceUsed) => {
        watchdog = setTimeout(() => {
          if (settled || id !== attempt) return;
          const synth = window.speechSynthesis;
          let active = false;
          try { active = !!(synth.speaking || synth.pending); if (synth.resume) synth.resume(); } catch { /* retry below */ }
          if (active && !graceUsed) armWatchdog(id, 6500, true);
          else bad('speech-timeout', id);
        }, ms);
      };
      const speakDirect = async () => {
        const id = ++attempt;
        clearTimeout(watchdog);
        try {
          const synth = window.speechSynthesis;
          const voices = await speechVoices(synth, 650);
          if (settled || id !== attempt) return;
          const Utterance = typeof SpeechSynthesisUtterance === 'function' ? SpeechSynthesisUtterance : window.SpeechSynthesisUtterance;
          if (typeof Utterance !== 'function') { bad('unsupported', id); return; }
          const langKey = FF.assistant && FF.assistant.getLang && FF.assistant.getLang() === 'en' ? 'en' : 'hi';
          let voicePrefs = {}, profile = null, voice = null;
          try { voicePrefs = U.voicePrefs ? (U.voicePrefs() || {}) : {}; } catch { /* defaults */ }
          try { profile = U.voiceProfile ? U.voiceProfile() : null; } catch { /* optional */ }
          try { voice = U.matchVoice ? U.matchVoice(voices, langKey, profile) : null; } catch { /* default voice */ }
          const plain = String(text).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
          const u = new Utterance(plain);
          if (voice) u.voice = voice;
          u.lang = (voice && voice.lang) || (langKey === 'en' ? 'en-IN' : 'hi-IN');
          u.rate = Number(voicePrefs.rate) > 0 ? Number(voicePrefs.rate) : 1.02;
          u.pitch = Number(voicePrefs.pitch) > 0 ? Number(voicePrefs.pitch) : 1;
          u.volume = 1;
          u.onend = () => ok(id);
          u.onerror = (ev) => bad((ev && ev.error) || 'error', id);
          // Safari/macOS may leave SpeechSynthesis paused after a silent unlock utterance.
          // Resume before each speak.
          try { if (synth.resume) synth.resume(); } catch { /* optional */ }
          // ⚠️ v3.38 — Chrome (khaaskar macOS) me `cancel()` ke TURANT baad `speak()` ki gayi
          //   utterance chup-chaap gir jaati hai: na onstart, na onend, na onerror — awaaz bilkul
          //   nahi aati (mobile Chrome par ye race aksar nahi dikhti, isliye "Mac me hi band").
          //   Isliye cancel sirf tab jab pehle se kuch bol raha ho / queue me ho, aur speak ko
          //   cancel ke BAAD ek tick baad karo (Chrome ko cancel process karne do).
          let queued = false;
          try { queued = !!(synth.speaking || synth.pending); } catch { /* optional */ }
          const arm = () => armWatchdog(id, Math.max(10000, Math.min(30000, plain.length * 75)), false);
          const fire = () => {
            try { synth.speak(u); } catch (err) { bad((err && err.message) || 'exception', id); return; }
            arm();
          };
          if (queued && synth.cancel) {
            try { synth.cancel(); } catch { /* optional */ }
            setTimeout(fire, 90);
          } else {
            fire();
          }
        } catch (err) { bad(err && err.message ? err.message : 'exception', id); }
      };
      try {
        if (!('speechSynthesis' in window)) { finish(false, 'unsupported'); return; }
        speakDirect(false);
      } catch (err) { finish(false, err && err.message ? err.message : 'exception'); }
    });
  }

  /** Abhi bolna possible nahi (unlock nahi hua / tab background) → queue + nudge, ting abhi baja do. */
  function queueAnnounce(text, delta) {
    st.pending.push({ text, delta, at: Date.now() });
    if (st.pending.length > 6) st.pending.shift();     // bahut purani khabar mat sunao
    ting(delta);
    showNudge();
  }
  function flushPending() {
    if (!st.pending.length) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!st.unlocked) { unlock(); return; }
    // Ek saath sirf sabse nayi khabar bolo — baaki ka total ek line me.
    const list = st.pending.splice(0, st.pending.length);
    const total = list.reduce((s, x) => s + (x.delta || 0), 0);
    const text = list.length === 1 ? list[0].text
      : `${list.length} updates me ${total} naye tags aa gaye. ${list[list.length - 1].text}`;
    speakAnnounce(text, total);
  }

  // ---- 🔊 "awaaz chalu karo" nudge ---------------------------------------------------------------
  // ⚠️ v3.25 — popup BAAR BAAR nahi aayega:
  //   • ek baar "Enable sound" dabaya → kabhi dobara nahi (permanent flag),
  //   • ✕ se dismiss kiya → 24 ghante tak koi popup nahi (pehle sirf 10 min tha),
  //   • is session me awaaz ek baar bhi aa chuki ho, ya sound/voice khud OFF kiya ho → kabhi nahi.
  const LS_NUDGE_OK = 'ff-office-bell-nudge-ok';
  function soundPrefsOn() {
    if (!voiceOn() && prefs().ting === false) return false;
    try { if (FF.notifications && FF.notifications.soundOn && !FF.notifications.soundOn()) return false; } catch { /* optional */ }
    return true;
  }
  function showNudge() {
    if (typeof document === 'undefined' || !document.body) return;
    if (typeof document.hidden === 'boolean' && document.hidden) return; // background tab par popup ka matlab nahi
    if (!soundPrefsOn()) return;                                        // khud OFF kiya hai to pareshan mat karo
    if (st.lastSpokeAt > 0) return;                                     // awaaz already kaam kar rahi hai
    try { if (localStorage.getItem(LS_NUDGE_OK) === '1') return; } catch { /* ignore */ }
    let dismissed = 0;
    try { dismissed = Number(localStorage.getItem(LS_NUDGE) || 0); } catch { dismissed = 0; }
    if (Date.now() - dismissed < 24 * 60 * 60 * 1000) return; // dismiss ke baad 24h chup
    if (st.nudge) return;
    const el = U.h(`<div class="bell-unlock" role="status">
      <span aria-hidden="true">🔊</span>
      <span><b>Naye tags ki awaaz ready hai</b><small>Browser ne autoplay roka ya system voice ready nahi thi — ek baar <b>Enable sound</b> dabao, phir har naya tag bol kar sunayi dega.</small></span>
      <button class="btn small primary" data-bell-unlock="1" type="button">Enable sound</button>
      <button class="bell-unlock-x" data-bell-nudge-x="1" type="button" aria-label="Dismiss">✕</button></div>`);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-bell-unlock]')) {
        try { localStorage.setItem(LS_NUDGE_OK, '1'); } catch { /* ignore */ }
        unlock('retry');
        const text = FF.assistant && FF.assistant.getLang && FF.assistant.getLang() === 'en'
          ? 'Voice announcer is on. I will announce every new tag.'
          : 'Awaaz chalu ho gayi — ab har naya tag bol kar sunaunga.';
        speakAnnounce(text, 3).then((okk) => { if (okk) U.toast('🔊 Voice announcer chalu ✓', 'ok'); });
        hideNudge();
      }
      if (e.target.closest('[data-bell-nudge-x]')) {
        try { localStorage.setItem(LS_NUDGE, String(Date.now())); } catch { /* ignore */ }
        hideNudge();
      }
    });
    document.body.appendChild(el);
    st.nudge = el;
  }
  function hideNudge() { if (st.nudge) { st.nudge.remove(); st.nudge = null; } }

  // ---- floating ticker -------------------------------------------------------------------------
  function floatChip(text, tone) {
    let host = document.getElementById('bell-floats');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bell-floats';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `bell-float ${tone || ''}`;
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, 4200);
    while (host.children.length > 5) host.firstChild.remove();
  }

  // ---- live agent-wise queries ------------------------------------------------------------------
  /** { ff, gv, agents: Map('FF|name' → count), classes: {FF:{VC4:n},GV:{}}, ok: { ff, gv } }.
   *  Query rows are arrays from FF.data. Class letter bhi select/group-by me hai — isse
   *  notification ke drawer me "class-wise kitna update hua" (chassis / replace / wrong VRN
   *  ke saath) bilkul wahi number dikhata hai jo announcement bolti hai. */
  async function countsToday() {
    const today = U.dateKey(new Date());
    const D = FF.data;
    const out = { ff: 0, gv: 0, agents: new Map(), classes: { FF: {}, GV: {} }, ok: { ff: false, gv: false } };
    const cellText = (row, index) => U.clean(D.cellText ? D.cellText(row[index]) : (row[index] && row[index].v));
    const cellNumber = (row, index) => Number(D.cellNumber ? D.cellNumber(row[index]) : row[index] && row[index].v) || 0;
    // model.normClass ke saath same normalisation — '4' → 'VC4' (EIR/REPORT me dono shapes aate hain).
    const clsOf = (raw) => { const t = U.clean(raw).toUpperCase(); return !t ? 'NA' : (/^\d+$/.test(t) ? `VC${t}` : t); };
    const add = (ch, name, n, cls) => {
      if (n <= 0) return;
      if (name) { const key = `${ch}|${name}`; out.agents.set(key, (out.agents.get(key) || 0) + n); }
      out[ch.toLowerCase()] += n;
      const c = clsOf(cls);
      const bucket = out.classes[ch] || (out.classes[ch] = {});
      bucket[c] = (bucket[c] || 0) + n;
    };
    const e = FF.config.eir;
    const m = FF.config.gv && FF.config.gv.master;
    const jobs = [
      D.query(e.sheet, `select ${e.agentName}, ${e.gvName}, ${e.masterId}, ${e.tlName}, ${e.cls}, count(${e.tagId}) where ${e.date} = date '${today}' group by ${e.agentName}, ${e.gvName}, ${e.masterId}, ${e.tlName}, ${e.cls}`, { timeoutMs: 20000, fresh: true }),
      FF.config.gvSheetId && m
        ? D.query('GV Master', `select ${m.agentName}, ${m.uniqueId}, ${m.vClass}, count(${m.uniqueId}) where ${m.date} = date '${today}' group by ${m.agentName}, ${m.uniqueId}, ${m.vClass}`, { timeoutMs: 20000, fresh: true })
        : Promise.reject(new Error('GV Master is not configured'))
    ];
    const [eirResult, gvResult] = await Promise.allSettled(jobs);
    if (eirResult.status === 'fulfilled') {
      const table = eirResult.value;
      for (const row of (table.rows || [])) {
        const name = cellText(row, 0) || cellText(row, 1) || cellText(row, 2);
        const masterId = cellText(row, 2), tlName = cellText(row, 3), cls = cellText(row, 4), n = cellNumber(row, 5);
        const isGv = FF.model && FF.model.channelOf
          ? FF.model.channelOf(masterId, tlName) === 'GV Partner'
          : String(masterId).replace(/\.0+$/, '') === String(e.gvMasterId || '5845036') || U.clean(tlName).toLowerCase() === U.clean(e.gvChannelTl || 'ApnaPayment Pvt. Ltd.').toLowerCase();
        // EIR contains both channels in some deployments. GV is announced from GV Master only;
        // otherwise each new GV tag would be announced twice and falsely counted as FF.
        if (!isGv) add('FF', name, n, cls);
      }
      out.ok.ff = true;
    }
    if (gvResult.status === 'fulfilled') {
      for (const row of (gvResult.value.rows || [])) {
        const name = cellText(row, 0) || cellText(row, 1);
        add('GV', name, cellNumber(row, 3), cellText(row, 2));
      }
      out.ok.gv = true;
    }
    return out;
  }
  /** Do class-map ka positive diff — sirf wahi classes jinme is poll me naya tag aaya. */
  function classDelta(prev, cur) {
    const out = {};
    Object.entries(cur || {}).forEach(([cls, n]) => {
      const d = Number(n) - Number((prev || {})[cls] || 0);
      if (d > 0) out[cls] = d;
    });
    return out;
  }
  const classMerge = (...maps) => {
    const out = {};
    maps.forEach((map) => Object.entries(map || {}).forEach(([cls, n]) => { out[cls] = (out[cls] || 0) + (Number(n) || 0); }));
    return out;
  };

  async function poll() {
    if (!on() || !featOn()) return;
    let c;
    try { c = await countsToday(); } catch { st.fails++; return; }
    st.fails = 0;
    if (!st.last) { st.last = c; return; } // pehla poll = baseline (chup-chaap)
    const previous = st.last;
    const current = { ...c, agents: new Map(c.agents), ok: { ...c.ok } };
    // Query failure ko zero mat samjho: preserve that source's last good reading so recovery doesn't
    // erase its baseline or cause a duplicate burst on the following poll.
    for (const ch of ['FF', 'GV']) {
      const key = ch.toLowerCase();
      if (!current.ok[key] && previous.ok[key]) {
        current[key] = previous[key]; current.ok[key] = true;
        for (const [agentKey, n] of previous.agents) if (agentKey.startsWith(`${ch}|`)) current.agents.set(agentKey, n);
      }
    }
    const dFf = current.ok.ff && previous.ok.ff ? current.ff - previous.ff : 0;
    const dGv = current.ok.gv && previous.ok.gv ? current.gv - previous.gv : 0;
    // Agent-wise movers — channel ko safely split karo (agent name me bhi '|' ho sakta hai).
    const movers = [];
    current.agents.forEach((n, key) => {
      const split = key.indexOf('|');
      if (split < 0) return;
      const ch = key.slice(0, split), channel = ch.toLowerCase();
      if (!current.ok[channel] || !previous.ok[channel]) return;
      const agent = key.slice(split + 1), old = previous.agents.get(key) || 0;
      if (n > old) movers.push({ ch, agent, n: n - old });
    });
    st.last = current;
    // 🔊 prefs: channel filter (FF/GV) lagao — jo band hai uske tags announce nahi honge.
    const p = prefs();
    const ffOn = p.ff !== false, gvOn = p.gv !== false;
    const keptFf = ffOn ? Math.max(0, dFf) : 0;
    const keptGv = gvOn ? Math.max(0, dGv) : 0;
    const keptMovers = movers.filter((m) => (m.ch === 'FF' ? ffOn : gvOn));
    const totalNew = keptFf + keptGv;
    if (totalNew <= 0) return;
    if (totalNew < Math.max(1, Number(p.minTags) || 1)) return;   // chhote bursts par chup raho
    const parts = [];
    if (keptFf > 0) parts.push(`+${U.fmt(keptFf)} 🏷️ FF`);
    if (keptGv > 0) parts.push(`+${U.fmt(keptGv)} 🏷️ GV`);
    st.pings += 1;
    logAdd({ at: Date.now(), ff: keptFf, gv: keptGv, total: totalNew, who: keptMovers.slice(0, 3).map((m) => `${m.agent} (${m.n})`).join(', ') });
    const text = announceText(keptMovers, totalNew, { ff: keptFf, gv: keptGv });
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (!hidden) floatChip(parts.join(' · '), keptFf > 0 && keptGv > 0 ? 'both' : keptFf > 0 ? 'ff' : 'gv');
    // 🔔 "Data update ki notification" — bell feed + toast + phone panel (voice neeche alag se).
    //    Mute ho tab bhi notification aani chahiye — sirf awaaz band hoti hai.
    //    📊 meta me snapshot / previous / delta + class-wise maps isliye jaate hain ki notification
    //    par click karte hi drawer me "kya badla" poora dikhe — class-wise naye tags, aaj ka total
    //    aur (async) EIR se type-wise detail: chassis · replacement · wrong VRN. Ye numbers wahi
    //    hain jo announcement bolti hai (same live query).
    const today = U.dateKey(new Date());
    //    (jo channel prefs me OFF hai uske naye tags announcement me bhi nahi hain — class
    //    delta bhi wahi dikhaye, warna number aur table aapas me match nahi karenge.)
    const ffClasses = ffOn ? classDelta(previous.classes && previous.classes.FF, current.classes && current.classes.FF) : {};
    const gvClasses = gvOn ? classDelta(previous.classes && previous.classes.GV, current.classes && current.classes.GV) : {};
    const deltaClasses = classMerge(ffClasses, gvClasses);
    const nowClasses = classMerge(current.classes && current.classes.FF, current.classes && current.classes.GV);
    const prevClasses = classMerge(previous.classes && previous.classes.FF, previous.classes && previous.classes.GV);
    if (FF.notifications && FF.notifications.localAlert) {
      try {
        FF.notifications.localAlert({
          type: 'report',
          title: `📊 Sheet update — +${U.fmt(totalNew)} tags`,
          body: `${parts.join(' · ')}${keptMovers.length ? ` · ${keptMovers.slice(0, 3).map((m) => `${m.agent} (${m.n})`).join(', ')}` : ''}`,
          meta: {
            dataChange: true,
            link: '#/tagIssued',
            date: today,
            source: keptFf > 0 && keptGv > 0 ? '' : keptFf > 0 ? 'ff' : 'gv',
            ff: keptFf, gv: keptGv,
            channels: { ff: keptFf, gv: keptGv },
            ffClasses, gvClasses,
            delta: { total: totalNew, classes: deltaClasses },
            snapshot: { date: today, total: (current.ok.ff ? current.ff : 0) + (current.ok.gv ? current.gv : 0), classes: nowClasses },
            previous: { date: today, total: (previous.ok.ff ? previous.ff : 0) + (previous.ok.gv ? previous.gv : 0), classes: prevClasses }
          }
        });
      } catch { /* notification optional */ }
    }
    // ⚡ Page ke numbers bhi turant taaza — light sync (throttled) + current page re-render.
    if (FF.app && FF.app.syncNow) { try { FF.app.syncNow({ auto: true }).catch(() => {}); } catch { /* optional */ } }
    if (muted()) { updateBtn(); return; }
    if (!voiceOn()) { if (!hidden) ting(parts.length > 1 ? totalNew + 5 : totalNew); updateBtn(); return; }
    if (hidden || !st.unlocked) queueAnnounce(text, totalNew);
    else speakAnnounce(text, totalNew);
    updateBtn();
    refreshMenu();
  }

  // ---- 🔊 options menu ---------------------------------------------------------------------------
  function menuHtml() {
    const p = prefs();
    const log = logList().slice(0, 12);
    const clock = (t) => { try { return new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
    const status = st.unlocked
      ? `<span class="badge green">SOUND READY ✓</span>`
      : isPolicyError(st.lastErr)
        ? `<span class="badge red">BROWSER BLOCK (${U.esc(st.lastErr)})</span>`
        : `<span class="badge amber">${st.lastErr ? `RETRY (${U.esc(st.lastErr)})` : 'EK TAP ME CHALU'}</span>`;
    return `<h4>🔊 Office Bell · voice ${status} ${voiceOn() ? '' : '<span class="badge red">OFF</span>'}</h4>
      ${!st.unlocked || isPolicyError(st.lastErr) ? `<div class="bell-acts"><button class="btn small primary" type="button" data-bell-act="enable">🔊 Enable sound (ek baar)</button></div><p class="dim small" style="margin:4px 0 8px">Browser pehli awaaz ke liye ek click maangta hai. Ye button dabate hi sound unlock ho jaata hai — phir har naya tag bol kar sunayi dega.</p>` : ''}
      <label class="bell-opt"><input type="checkbox" data-bell-opt="voice" ${voiceOn() ? 'checked' : ''}> 🎙️ Voice announcer (bol kar sunao)</label>
      <label class="bell-opt"><input type="checkbox" data-bell-opt="ting" ${p.ting !== false ? 'checked' : ''}> 🔔 Ting sound</label>
      <label class="bell-opt">🎵 New-tag update tone <select data-bell-opt="tone">${TONE_OPTIONS.map((x) => `<option value="${x.id}" ${p.tone === x.id ? 'selected' : ''}>${U.esc(x.label)}</option>`).join('')}</select></label>
      <label class="bell-opt"><input type="checkbox" data-bell-opt="ff" ${p.ff !== false ? 'checked' : ''}> 🟦 First Forward tags</label>
      <label class="bell-opt"><input type="checkbox" data-bell-opt="gv" ${p.gv !== false ? 'checked' : ''}> 🟩 GV Partner tags</label>
      <label class="bell-opt">🏷️ Kam se kam <select data-bell-opt="min">
        ${[1, 2, 5, 10, 25].map((n) => `<option value="${n}" ${Number(p.minTags) === n ? 'selected' : ''}>${n} tag${n > 1 ? 's' : ''}</option>`).join('')}
      </select></label>
      <div class="bell-acts">
        <button class="btn small" type="button" data-bell-act="test">🔊 Test voice</button>
        <button class="btn small" type="button" data-bell-act="mute">${muted() ? '🔔 Unmute' : '🔕 Mute 30 min'}</button>
        <button class="btn small" type="button" data-bell-act="poll">↻ Check now</button>
      </div>
      <h4>🕘 Aaj ki khabar · ${log.length}</h4>
      <div class="bell-log">${log.length ? log.map((l) => `<div class="bell-log-row"><time>${clock(l.at)}</time><span><b>+${U.fmt(l.total || 0)}</b> 🏷️ ${l.ff ? `FF ${U.fmt(l.ff)}` : ''}${l.ff && l.gv ? ' · ' : ''}${l.gv ? `GV ${U.fmt(l.gv)}` : ''}${l.who ? `<br><small>${U.esc(l.who)}</small>` : ''}</span></div>`).join('') : '<div class="bell-log-empty">Abhi tak koi naya tag announce nahi hua.</div>'}</div>`;
  }
  function refreshMenu() { if (st.menu) st.menu.innerHTML = menuHtml(); }
  function closeMenu() { if (st.menu) { st.menu.remove(); st.menu = null; } }
  function openMenu(anchor) {
    if (st.menu) { closeMenu(); return; }
    const el = U.h(`<div class="bell-menu" role="dialog" aria-label="Office bell options"></div>`);
    el.innerHTML = menuHtml();
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = Math.min(330, window.innerWidth - 22);
    el.style.position = 'fixed';
    el.style.top = `${Math.min(r.bottom + 8, window.innerHeight - 120)}px`;
    el.style.right = `${Math.max(11, window.innerWidth - r.right)}px`;
    el.style.width = `${w}px`;
    st.menu = el;
    el.addEventListener('change', (e) => {
      const k = e.target.dataset && e.target.dataset.bellOpt;
      if (!k) return;
      if (k === 'voice') {
        setVoice(e.target.checked);
        if (e.target.checked) {
          unlock('retry');
          const hi = !(FF.assistant && FF.assistant.getLang && FF.assistant.getLang() === 'en');
          speakAnnounce(hi ? 'Voice announcer chalu ho gaya.' : 'Voice announcer is on.', 3)
            .then((ok) => U.toast(ok ? '🎙️ Voice Announcer ON · sound ready ✓' : `🎙️ ON, par browser ne awaaz roki (${st.lastErr || 'tap needed'}) — "Enable sound" dabao`, ok ? 'ok' : 'warn'));
        } else U.toast('🔇 Voice Announcer OFF — sirf ting bajega', 'warn');
      }
      else if (k === 'min') setPrefs({ minTags: Number(e.target.value) || 1 });
      else if (k === 'tone') { setPrefs({ tone: e.target.value }); ting(1); }
      else setPrefs({ [k]: e.target.checked });
      refreshMenu(); updateBtn();
    });
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-bell-act]');
      if (!act) return;
      const a = act.dataset.bellAct;
      if (a === 'enable') {
        if (!voiceOn()) setVoice(true);
        unlock('retry');
        setPrefs({ muteUntil: 0 });
        const hi = !(FF.assistant && FF.assistant.getLang && FF.assistant.getLang() === 'en');
        speakAnnounce(hi ? 'Awaaz chalu ho gayi — ab har naya tag bol kar sunaunga.' : 'Sound is on — I will announce every new tag.', 3)
          .then((okk) => { U.toast(okk ? '🔊 Sound unlocked ✓ — ab har naya tag bolega' : `⚠️ Browser ne roka (${st.lastErr || 'unknown'}) — page par ek baar click karke dobara try karo`, okk ? 'ok' : 'err'); refreshMenu(); updateBtn(); });
      }
      if (a === 'test') {
        unlock('retry');
        const hi = !(FF.assistant && FF.assistant.getLang && FF.assistant.getLang() === 'en');
        speakAnnounce(hi ? 'Ye ek test hai — naye tags aate hi main aise hi bol kar sunaunga.' : 'This is a test — I will announce new tags like this.', 5)
          .then((okk) => U.toast(okk ? '🔊 Voice test chal gaya ✓' : `⚠️ Voice block hai (${st.lastErr || 'browser'}) — Enable sound dabao`, okk ? 'ok' : 'err'));
      }
      if (a === 'mute') { setPrefs({ muteUntil: muted() ? 0 : Date.now() + 30 * 60 * 1000 }); refreshMenu(); updateBtn(); U.toast(muted() ? '🔕 30 minute ke liye mute' : '🔔 Unmute ho gaya', 'ok'); }
      if (a === 'poll') { st.last = null; poll().then(() => U.toast('↻ Live count le liya — agle naye tag par khabar milegi', 'ok')); }
    });
    const outside = (ev) => { if (st.menu && !st.menu.contains(ev.target) && ev.target !== anchor) { closeMenu(); document.removeEventListener('mousedown', outside); } };
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
  }

  // ---- topbar buttons --------------------------------------------------------------------------
  let btn = null, vbtn = null;
  function updateBtn() {
    if (btn) {
      const isOn = on() && featOn();
      const isMuted = muted();
      btn.textContent = isOn ? (isMuted ? '🔕' : '🔔') : '🔕';
      btn.classList.toggle('off', !isOn);
      btn.classList.toggle('muted', isOn && isMuted);
      btn.title = !isOn ? 'Office Bell OFF — click karke on karo'
        : isMuted ? `Office Bell muted (${Math.ceil((Number(prefs().muteUntil) - Date.now()) / 60000)} min) — 🔊 se unmute karo`
          : `Office Bell ON — naya tag aate hi pata chalega (aaj ${st.pings} pings)`;
    }
    if (vbtn) {
      const v = voiceOn();
      vbtn.textContent = v ? '🔊' : '🔇';
      vbtn.classList.toggle('off', !v);
      vbtn.title = v
        ? `🎙️ Voice Announcer ON${st.unlocked ? ' · sound unlocked ✓' : ' · ek click me unlock hoga'} — click for options`
        : 'Voice Announcer OFF — sirf ting bajega (click for options)';
    }
  }
  function mount() {
    if (st.mounted || !featOn()) return;
    const actions = U.$('#top-actions');
    if (!actions || U.$('#bell-btn')) return;
    st.mounted = true;
    btn = U.h(`<button class="bell-btn" id="bell-btn" type="button" aria-label="Office bell on/off">🔔</button>`);
    btn.addEventListener('click', () => {
      unlock('retry');
      setOn(!on());
      updateBtn();
      if (on()) { st.last = null; poll().catch(() => {}); U.toast('🔔 Office Bell ON — naye tags ka live pata chalega', 'ok'); }
      else U.toast('🔕 Office Bell OFF', 'warn');
    });
    vbtn = U.h(`<button class="bell-btn" id="bell-voice-btn" type="button" aria-label="Voice announcer options">🔊</button>`);
    vbtn.addEventListener('click', (e) => { e.stopPropagation(); unlock('retry'); openMenu(vbtn); });
    // Long-press / right-click par bhi menu (desktop shortcut).
    vbtn.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(vbtn); });
    const ref = U.$('#master-search');
    if (ref && typeof actions.insertBefore === 'function') { actions.insertBefore(btn, ref.nextSibling); actions.insertBefore(vbtn, ref.nextSibling); }
    else { actions.appendChild(btn); actions.appendChild(vbtn); }
    updateBtn();
    bindUnlock();
    warmVoices();
    if (st.timer) clearInterval(st.timer);
    st.timer = setInterval(poll, 30000);
    setTimeout(poll, 4000); // baseline jaldi le lo
  }

  FF.officeBell = {
    mount, announceText, countsToday, unlock, speakAnnounce, queueAnnounce, flushPending, prefs, setPrefs, testTing, toneOptions: TONE_OPTIONS, logList, logAdd, openMenu, closeMenu, poll,
    /** 🔊 Voice ON hai? (function form — notifications.js isi ko call karta hai; `voiceOn` getter bhi hai) */
    isVoiceOn: () => voiceOn(),
    get on() { return on(); }, get voiceOn() { return voiceOn(); }, get pings() { return st.pings; },
    get unlocked() { return st.unlocked; }, get lastError() { return st.lastErr; }, get lastSpokeAt() { return st.lastSpokeAt; }, get pending() { return st.pending.length; }
  };
})(window.FF);
