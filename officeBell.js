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
    unlocked: false, unlockBound: false, pending: [], lastErr: '', nudge: null, menu: null
  };

  // ---- prefs (localStorage) -----------------------------------------------------------------------
  const DEFAULTS = { minTags: 1, ff: true, gv: true, ting: true, muteUntil: 0 };
  function prefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(LS_PREFS) || '{}') || {}; } catch { p = {}; }
    return { ...DEFAULTS, ...p };
  }
  function setPrefs(patch) {
    const next = { ...prefs(), ...(patch || {}) };
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
      const notes = delta >= 25 ? [880, 1108.7, 1318.5] : delta >= 10 ? [783.99, 987.77] : [659.25];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f * (1 + Math.min(delta, 50) / 400);
        g.gain.setValueAtTime(0.0001, t0 + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.6);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0 + i * 0.09); o.stop(t0 + i * 0.09 + 0.7);
      });
    } catch { /* sound blocked — ignore */ }
  }

  // ---- 🔊 audio unlock (autoplay policy) --------------------------------------------------------
  /** Browser sirf user gesture ke andar audio kholne deta hai. Pehle click/keypress par ek baar
      AudioContext resume + ek silent utterance bol do — uske baad background speak allowed hai. */
  function unlock(force) {
    if (st.unlocked && force !== 'retry') return st.unlocked;
    try {
      if (!st.audio) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) st.audio = new AC(); }
      if (st.audio && st.audio.state === 'suspended' && st.audio.resume) st.audio.resume();
    } catch { /* no WebAudio */ }
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

  /** Bol kar sunao. Fail ho (autoplay block / koi voice nahi) to ting + nudge. Promise<boolean>. */
  function speakAnnounce(text, fallbackDelta) {
    return new Promise((resolve) => {
      let settled = false;
      let retried = false;
      const ok = () => { if (!settled) { settled = true; st.unlocked = true; st.lastErr = ''; hideNudge(); resolve(true); } };
      const speakDirect = () => {
        try {
          const u = new SpeechSynthesisUtterance(String(text));
          u.lang = 'hi-IN'; u.rate = 1.02;
          u.onend = ok;
          u.onerror = (ev) => bad((ev && ev.error) || 'error', true);
          window.speechSynthesis.speak(u);
        } catch (err) { bad(err && err.message ? err.message : 'exception', true); }
      };
      const bad = (reason, viaDirect) => {
        if (settled) return;
        // 🔁 interrupted/canceled = browser ne pehle wali awaaz kaati — dobara try karo, block mat kaho.
        if (isBenignError(reason) && !retried) {
          retried = true;
          setTimeout(() => { if (!settled) { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } speakDirect(); } }, 160);
          return;
        }
        settled = true;
        st.lastErr = String(reason || 'error');
        // Policy block sirf tab jab browser ne sach me mana kiya ho; warna unlock state waisi hi rehne do.
        if (isPolicyError(reason) || reason === 'unsupported') st.unlocked = false;
        ting(fallbackDelta || 3);
        showNudge();
        resolve(false);
      };
      try {
        if (!('speechSynthesis' in window)) { bad('unsupported'); return; }
        // Assistant ka voice path pehle (wo "Meri awaaz" profile + voice prefs use karta hai).
        if (FF.assistant && typeof FF.assistant.speak === 'function') {
          let called = false;
          FF.assistant.speak(text, { force: true, onEnd: () => { called = true; ok(); }, onError: (reason) => { called = true; bad(reason); } });
          // Assistant chup-chaap kuch na kare (edge cases) → 900ms baad seedha khud bol do.
          setTimeout(() => { if (!settled && !called) speakDirect(); }, 900);
          return;
        }
        speakDirect();
      } catch (err) { bad(err && err.message ? err.message : 'exception', true); }
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
  function showNudge() {
    if (typeof document === 'undefined' || !document.body) return;
    let dismissed = 0;
    try { dismissed = Number(localStorage.getItem(LS_NUDGE) || 0); } catch { dismissed = 0; }
    if (Date.now() - dismissed < 10 * 60 * 1000) return;   // 10 min me ek hi baar pareshan karo
    if (st.nudge) return;
    const el = U.h(`<div class="bell-unlock" role="status">
      <span aria-hidden="true">🔊</span>
      <span><b>Naye tags ki awaaz ready hai</b><small>Browser ne autoplay roka tha — ek baar <b>Enable sound</b> dabao, phir har naya tag bol kar sunayi dega.</small></span>
      <button class="btn small primary" data-bell-unlock="1" type="button">Enable sound</button>
      <button class="bell-unlock-x" data-bell-nudge-x="1" type="button" aria-label="Dismiss">✕</button></div>`);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-bell-unlock]')) {
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
  /** { ff, gv, agents: Map('FF|name' → count), ok: { ff, gv } }. Query rows are arrays from FF.data. */
  async function countsToday() {
    const today = U.dateKey(new Date());
    const D = FF.data;
    const out = { ff: 0, gv: 0, agents: new Map(), ok: { ff: false, gv: false } };
    const cellText = (row, index) => U.clean(D.cellText ? D.cellText(row[index]) : (row[index] && row[index].v));
    const cellNumber = (row, index) => Number(D.cellNumber ? D.cellNumber(row[index]) : row[index] && row[index].v) || 0;
    const add = (ch, name, n) => {
      if (!name || n <= 0) return;
      const key = `${ch}|${name}`;
      out.agents.set(key, (out.agents.get(key) || 0) + n);
      out[ch.toLowerCase()] += n;
    };
    const e = FF.config.eir;
    const m = FF.config.gv && FF.config.gv.master;
    const jobs = [
      D.query(e.sheet, `select ${e.agentName}, ${e.gvName}, ${e.masterId}, ${e.tlName}, count(${e.tagId}) where ${e.date} = date '${today}' group by ${e.agentName}, ${e.gvName}, ${e.masterId}, ${e.tlName}`, { timeoutMs: 20000, fresh: true }),
      FF.config.gvSheetId && m
        ? D.query('GV Master', `select ${m.agentName}, ${m.uniqueId}, count(${m.uniqueId}) where ${m.date} = date '${today}' group by ${m.agentName}, ${m.uniqueId}`, { timeoutMs: 20000, fresh: true })
        : Promise.reject(new Error('GV Master is not configured'))
    ];
    const [eirResult, gvResult] = await Promise.allSettled(jobs);
    if (eirResult.status === 'fulfilled') {
      const table = eirResult.value;
      for (const row of (table.rows || [])) {
        const name = cellText(row, 0) || cellText(row, 1) || cellText(row, 2);
        const masterId = cellText(row, 2), tlName = cellText(row, 3), n = cellNumber(row, 4);
        const isGv = FF.model && FF.model.channelOf
          ? FF.model.channelOf(masterId, tlName) === 'GV Partner'
          : String(masterId).replace(/\.0+$/, '') === String(e.gvMasterId || '5845036') || U.clean(tlName).toLowerCase() === U.clean(e.gvChannelTl || 'ApnaPayment Pvt. Ltd.').toLowerCase();
        // EIR contains both channels in some deployments. GV is announced from GV Master only;
        // otherwise each new GV tag would be announced twice and falsely counted as FF.
        if (!isGv) add('FF', name, n);
      }
      out.ok.ff = true;
    }
    if (gvResult.status === 'fulfilled') {
      for (const row of (gvResult.value.rows || [])) {
        const name = cellText(row, 0) || cellText(row, 1);
        add('GV', name, cellNumber(row, 2));
      }
      out.ok.gv = true;
    }
    return out;
  }

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
    if (st.timer) clearInterval(st.timer);
    st.timer = setInterval(poll, 30000);
    setTimeout(poll, 4000); // baseline jaldi le lo
  }

  FF.officeBell = {
    mount, announceText, countsToday, unlock, speakAnnounce, queueAnnounce, flushPending, prefs, setPrefs, logList, logAdd, openMenu, closeMenu,
    get on() { return on(); }, get voiceOn() { return voiceOn(); }, get pings() { return st.pings; },
    get unlocked() { return st.unlocked; }, get lastError() { return st.lastErr; }, get pending() { return st.pending.length; }
  };
})(window.FF);
