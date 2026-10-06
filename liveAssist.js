/* 🎙️ LIVE ASSIST (v3.26) — admin user ki awaaz (+ chaaho to camera) LIVE sun/dekh sakta hai.
 *
 * TRANSPARENCY BY DESIGN (ye feature chup-chaap kuch NAHI karta):
 *   • User ko full-screen consent popup dikhta hai — Allow / Decline uski marzi hai (60s timeout).
 *   • Accept karne par hi mic/camera khulta hai.
 *   • Session ke dauran user ki screen par hamesha 🔴 LIVE pill dikhta hai, End button ke saath.
 *   • Har request/accept/end server audit log me darj hota hai.
 *
 * Tech: WebRTC (RTCPeerConnection) — media seedha browser↔browser jaata hai; server sirf
 * signalling (SDP offer/answer + ICE candidates) relay karta hai. STUN default me Google ka;
 * strict NAT ke liye LIVE_ASSIST_ICE_JSON env me TURN add kar sakte ho.
 *
 * Roles:
 *   • Admin  — presence panel me 🎙 Assist button → mode chuno (voice/video) → request jaati hai.
 *              Panel me "waiting → LIVE player" dikhta hai; End kabhi bhi.
 *   • User   — inbox poll se request milti hai → consent popup → accept par answerer PC banta hai.
 */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = () => FF.util; // module load order safe — hamesha call-time par hi use karo
  const esc = (s) => (U() && U().esc ? U().esc(s) : String(s == null ? '' : s));
  const toast = (msg, tone) => { try { U().toast(msg, tone); } catch { /* optional */ } };

  const st = {
    started: false, inboxTimer: null, inboxBusy: false,
    // user side
    consentSession: null, consentEl: null, consentPoll: null,
    localStream: null, pillEl: null,
    // shared / admin side
    session: null, side: '', pc: null, seq: 0, pollTimer: null, panelEl: null,
    remoteStream: null, playBtn: null, closedAt: 0
  };
  const api = (path, method, body) => FF.auth.api(path, method, body);
  const hasMedia = () => !!(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const hasRTC = () => typeof RTCPeerConnection !== 'undefined';

  // ---- 🎙️ One-time mic permission -------------------------------------------------------------
  // Site khulte hi EK BAAR browser ka mic prompt dikhta hai (pehle user gesture par). Grant hote
  // hi Chrome permission ko origin ke liye HAMESHA ke liye yaad rakhta hai — phir kabhi prompt
  // nahi aata, har Live Assist session turant connect hota hai. Deny kiya to bhi dobara kabhi
  // nahi poochte (flag localStorage me) — user khud site settings se allow kar sakta hai.
  const MIC_ASKED_KEY = 'ff_mic_permission_asked';
  const micAsked = () => { try { return localStorage.getItem(MIC_ASKED_KEY) === '1'; } catch { return true; } };
  const markMicAsked = () => { try { localStorage.setItem(MIC_ASKED_KEY, '1'); } catch { /* private mode */ } };
  async function micPermissionState() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const p = await navigator.permissions.query({ name: 'microphone' });
        return p.state; // 'granted' | 'denied' | 'prompt'
      }
    } catch { /* firefox etc. — fallback below */ }
    return '';
  }
  /** Ek baar mic permission le lo. Return: true = granted (ya pehle se), false = denied/unsupported. */
  async function ensureMicPermission() {
    if (!hasMedia()) return false;
    const known = await micPermissionState();
    if (known === 'granted') { markMicAsked(); return true; }
    if (known === 'denied') { markMicAsked(); return false; }
    if (micAsked()) return false; // pooch chuke hain — dobara kabhi nahi
    markMicAsked(); // prompt se PEHLE flag — doosre tabs ya double-call par prompt repeat na ho
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } }); // turant chhodo — sirf permission chahiye thi
      toast('🎙️ Mic ready — Live Assist ab bina kisi prompt ke turant chalega', 'ok');
      return true;
    } catch {
      return false; // denied/unsupported — chup-chaap; dobara kabhi nahi poochenge
    }
  }

  function teardownMedia() {
    if (st.localStream) { try { st.localStream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } st.localStream = null; }
    if (st.pc) { try { st.pc.ontrack = null; st.pc.onicecandidate = null; st.pc.onconnectionstatechange = null; st.pc.close(); } catch { /* ignore */ } st.pc = null; }
    st.remoteStream = null;
    if (st.pollTimer) { clearTimeout(st.pollTimer); st.pollTimer = null; }
  }

  // =====================================================================================
  // 🧑 USER SIDE — consent + answerer
  // =====================================================================================
  async function pollInbox() {
    if (!FF.auth || !FF.auth.user) return;
    if (st.inboxBusy) return;
    st.inboxBusy = true;
    try {
      const out = await api('/api/live-assist/inbox');
      const list = Array.isArray(out && out.sessions) ? out.sessions : [];
      const active = list.find((s) => s.status === 'active');
      const requested = list.find((s) => s.status === 'requested');
      if (st.session && st.session.status === 'active') {
        // Humara live session server par khatam ho gaya? (admin ne End kiya / timeout)
        if (!active || active.id !== st.session.id) { finishUserSession('ended', active ? ' Session update hua.' : ' Admin ne session band kar diya.'); return; }
      } else if (active) {
        // Page reload ke beech active session — media wapas nahi aa sakta; clean end + pill.
        showPill(active);
        st.session = { ...active };
        st.side = 'user';
      } else if (requested) {
        showConsent(requested);
      } else if (st.consentSession) {
        hideConsent(); // request expire ho gayi (missed)
      }
      // Active session jo server par 'ended/missed/declined' ho gaya → consent/pill hatao
      if (st.consentSession && !requested) hideConsent();
    } catch { /* network — agle poll par retry */ }
    finally { st.inboxBusy = false; }
  }

  function showConsent(s) {
    if (st.consentSession && st.consentSession.id === s.id) return;
    hideConsent();
    if (typeof document === 'undefined' || !document.body || !document.createElement) return;
    st.consentSession = s;
    const el = document.createElement('div');
    el.className = 'la-consent';
    el.innerHTML = `<div class="la-consent-card" role="alertdialog" aria-modal="true" aria-label="Live Assist request">
      <div class="la-consent-icon" aria-hidden="true">🎙️</div>
      <h2>Live Assist request</h2>
      <p><b>${esc(s.adminName)}</b> (admin) aapse abhi live baat karna chahte hain.</p>
      <ul>
        <li>${s.mode === 'video' ? 'Aapki <b>awaaz + camera</b>' : 'Sirf aapki <b>awaaz</b>'} admin ko live jayegi.</li>
        <li>Aapki haan ke bina kuch nahi chalega — browser mic/camera permission bhi poochega.</li>
        <li>Session chalu rehte upar <b>🔴 LIVE</b> indicator dikhega — wahan se kabhi bhi End kar sakte ho.</li>
      </ul>
      <div class="la-consent-btns">
        <button type="button" class="btn primary la-accept">✅ Allow karo</button>
        <button type="button" class="btn la-decline">❌ Decline</button>
      </div>
      <small class="dim">60 second me jawab nahi diya to request apne aap cancel ho jayegi.</small>
    </div>`;
    document.body.appendChild(el);
    st.consentEl = el;
    const accept = el.querySelector('.la-accept');
    const decline = el.querySelector('.la-decline');
    if (accept) accept.addEventListener('click', () => acceptSession(s));
    if (decline) decline.addEventListener('click', () => declineSession(s));
    try { if (FF.notifications && FF.notifications.beep) FF.notifications.beep(true); } catch { /* optional */ }
  }
  function hideConsent() {
    if (st.consentEl) { try { st.consentEl.remove(); } catch { /* ignore */ } st.consentEl = null; }
    st.consentSession = null;
  }
  async function acceptSession(s) {
    if (!hasMedia() || !hasRTC()) { toast('Is browser me mic/WebRTC support nahi hai — Chrome ya Edge try karo.', 'err'); return; }
    const btn = st.consentEl ? st.consentEl.querySelector('.la-accept') : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Connect ho raha hai…'; }
    try {
      await api(`/api/live-assist/${encodeURIComponent(s.id)}/accept`, 'POST', {});
    } catch (err) {
      toast('Allow nahi ho paya: ' + ((err && err.message) || ''), 'err');
      if (btn) { btn.disabled = false; btn.textContent = '✅ Allow karo'; }
      return;
    }
    hideConsent();
    st.session = { ...s, status: 'active' };
    st.side = 'user';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: s.mode === 'video' ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
      });
    } catch (err) {
      toast('Mic/camera permission nahi mili — address bar ke 🔒 lock icon → Site settings → Microphone/Camera Allow karo, phir dobara Allow dabao. Session end kiya.', 'err');
      api(`/api/live-assist/${encodeURIComponent(s.id)}/end`, 'POST', {}).catch(() => {});
      st.session = null;
      return;
    }
    st.localStream = stream;
    showPill(s);
    startSignalPoll(s);
    toast('🎙️ Live session chalu — admin ko awaaz ja rahi hai. Upar 🔴 LIVE se kabhi bhi End karo.', 'ok');
  }
  async function declineSession(s) {
    const btn = st.consentEl ? st.consentEl.querySelector('.la-decline') : null;
    if (btn) btn.disabled = true;
    try { await api(`/api/live-assist/${encodeURIComponent(s.id)}/decline`, 'POST', {}); toast('Request decline kar di ✓', 'info'); }
    catch (err) { toast('Decline fail: ' + ((err && err.message) || ''), 'err'); }
    hideConsent();
  }
  function showPill(s) {
    removePill();
    if (typeof document === 'undefined' || !document.body || !document.createElement) return;
    const el = document.createElement('div');
    el.className = 'la-pill';
    el.id = 'la-pill';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="la-dot" aria-hidden="true"></span>
      <span class="la-pill-text">🔴 LIVE — ${esc(s.adminName || 'admin')} ${s.mode === 'video' ? 'aapko dekh & sun' : 'aapki awaaz sun'} rahe hain</span>
      <button type="button" class="la-pill-end">End</button>`;
    const end = el.querySelector('.la-pill-end');
    if (end) end.addEventListener('click', () => endUserSession());
    document.body.appendChild(el);
    st.pillEl = el;
  }
  function removePill() { if (st.pillEl) { try { st.pillEl.remove(); } catch { /* ignore */ } st.pillEl = null; } }
  async function endUserSession() {
    if (!st.session) { removePill(); return; }
    const id = st.session.id;
    teardownMedia();
    removePill();
    st.session = null; st.side = '';
    try { await api(`/api/live-assist/${encodeURIComponent(id)}/end`, 'POST', {}); } catch { /* already ended */ }
    toast('🎙️ Live session end ho gaya', 'info');
  }
  function finishUserSession(reason, extra) {
    teardownMedia();
    removePill();
    hideConsent();
    st.session = null; st.side = '';
    const msg = reason === 'ended' ? `🎙️ Live session khatam ho gaya.${extra || ''}` : '🎙️ Live session band.';
    toast(msg, 'info');
  }

  // =====================================================================================
  // 🔁 SIGNALLING POLL (dono sides) — SDP offer/answer + ICE relay
  // =====================================================================================
  function startSignalPoll(session) {
    st.seq = 0;
    if (st.pollTimer) clearTimeout(st.pollTimer);
    const tick = async () => {
      if (!st.session || st.session.id !== session.id) return;
      let out;
      try {
        out = await api(`/api/live-assist/${encodeURIComponent(session.id)}/signal?since=${st.seq}`);
      } catch (err) {
        if (err && err.status === 404) { onSessionGone(session); return; }
        st.pollTimer = setTimeout(tick, 2500);
        return;
      }
      if (!st.session || st.session.id !== session.id) return;
      if (out && (out.status === 'ended' || out.status === 'missed' || out.status === 'declined')) { onSessionGone(session); return; }
      st.seq = Number(out.seq) || st.seq;
      for (const m of out.signals || []) { await handleSignal(session, m); if (!st.session || st.session.id !== session.id) return; }
      st.pollTimer = setTimeout(tick, 900);
    };
    st.pollTimer = setTimeout(tick, 250);
  }
  function onSessionGone(session) {
    if (st.side === 'admin') finishAdminPanel('Session band ho gaya.');
    else finishUserSession('ended');
    void session;
  }
  async function handleSignal(session, m) {
    if (m.kind === 'sdp' && m.data) {
      if (!st.pc) createPeerConnection(session);
      try {
        await st.pc.setRemoteDescription(m.data);
        if (m.data.type === 'offer') {
          const answer = await st.pc.createAnswer();
          await st.pc.setLocalDescription(answer);
          await api(`/api/live-assist/${encodeURIComponent(session.id)}/signal`, 'POST', { kind: 'sdp', data: { type: answer.type, sdp: answer.sdp } });
        }
      } catch (err) { console.warn('liveAssist SDP:', err && err.message); }
    } else if (m.kind === 'ice' && m.data) {
      try { if (st.pc) await st.pc.addIceCandidate(m.data); } catch { /* late/dup candidate — ignore */ }
    }
  }
  function createPeerConnection(session) {
    const ice = Array.isArray(session.ice) && session.ice.length ? session.ice : [{ urls: 'stun:stun.l.google.com:19302' }];
    const pc = new RTCPeerConnection({ iceServers: ice });
    st.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate && st.session && st.session.id === session.id) {
        api(`/api/live-assist/${encodeURIComponent(session.id)}/signal`, 'POST', { kind: 'ice', data: e.candidate.toJSON() }).catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      if (!st.pc || st.pc !== pc || !st.session || st.session.id !== session.id) return;
      if (pc.connectionState === 'connected' && st.side === 'admin') setAdminPanelState('live');
      if (['failed', 'closed'].includes(pc.connectionState)) onSessionGone(session);
      if (pc.connectionState === 'disconnected') {
        setTimeout(() => { if (st.pc === pc && pc.connectionState === 'disconnected' && st.session && st.session.id === session.id) onSessionGone(session); }, 6000);
      }
    };
    if (st.side === 'user') {
      if (st.localStream) st.localStream.getTracks().forEach((t) => pc.addTrack(t, st.localStream));
    } else {
      pc.ontrack = (e) => {
        const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
        st.remoteStream = stream;
        attachRemoteStream(stream, session);
      };
    }
    return pc;
  }

  // =====================================================================================
  // 🧑‍💼 ADMIN SIDE — request bhejo, wait karo, LIVE player chalao
  // =====================================================================================
  async function adminRequest(username, mode) {
    const adminOk = FF.auth && FF.auth.user && (FF.auth.isAdmin ? FF.auth.isAdmin() : FF.auth.user.role === 'admin'); // 👁 preview-aware
    if (!adminOk) { toast('Admin access chahiye', 'err'); return; }
    if (!hasRTC()) { toast('Is browser me WebRTC nahi hai — Chrome/Edge use karo.', 'err'); return; }
    let out;
    try {
      out = await api('/api/live-assist/request', 'POST', { user: username, mode });
    } catch (err) { toast('Request nahi gayi: ' + ((err && err.message) || ''), 'err'); return; }
    const s = out.session;
    if (st.session && st.session.id === s.id && st.session.status === 'active') { openAdminPanel(s, true); return; }
    if (st.session && st.session.status === 'active') { toast('Ek live session pehle se chalu hai — pehle use end karo.', 'warn'); return; }
    openAdminPanel(s, !!out.existing && s.status === 'active');
  }
  function openAdminPanel(s, alreadyActive) {
    closeAdminPanel(true);
    if (typeof document === 'undefined' || !document.body || !document.createElement) return;
    st.session = { ...s };
    st.side = 'admin';
    const el = document.createElement('div');
    el.className = 'la-admin';
    el.innerHTML = `<div class="la-admin-card" role="dialog" aria-label="Live Assist">
      <div class="la-admin-head">
        <h3>🎙️ Live Assist — ${esc(s.userName)}</h3>
        <button type="button" class="la-admin-x" aria-label="Close">✕</button>
      </div>
      <div class="la-admin-status"><span class="la-spinner"></span> <span data-la-status>Request bheji gayi — user ki marzi ka wait hai…</span></div>
      <div class="la-admin-note dim small">User ko consent popup dikha hai. ${s.mode === 'video' ? 'Awaaz + video' : 'Sirf awaaz'} aayegi jab wo <b>Allow</b> karega. Bina uski haan ke kuch nahi milega.</div>
      <div class="la-player-wrap" data-la-player hidden>
        <video data-la-video autoplay playsinline ${s.mode === 'video' ? '' : 'style="display:none"'}></video>
        <audio data-la-audio autoplay ${s.mode === 'video' ? 'style="display:none"' : ''}></audio>
        <button type="button" class="btn primary la-play" data-la-play hidden>▶️ Sound chalu karo</button>
      </div>
      <div class="la-admin-btns">
        <button type="button" class="btn small danger" data-la-end>⏹ End session</button>
        <span class="dim small" data-la-state>${alreadyActive ? 'Session active hai' : 'Waiting…'}</span>
      </div>
    </div>`;
    document.body.appendChild(el);
    st.panelEl = el;
    const x = el.querySelector('.la-admin-x');
    if (x) x.addEventListener('click', () => closeAdminPanel());
    const endBtn = el.querySelector('[data-la-end]');
    if (endBtn) endBtn.addEventListener('click', () => { endAdminSession(); });
    if (alreadyActive) { setAdminPanelState('connecting'); startAdminMedia(s); }
    else startSessionWatch(s);
  }
  /** Requested session ki status poll karo — active hote hi media shuru, decline/missed par panel update. */
  function startSessionWatch(s) {
    let tries = 0;
    const tick = async () => {
      if (!st.session || st.session.id !== s.id || st.side !== 'admin') return;
      tries++;
      let out;
      try { out = await api(`/api/live-assist/${encodeURIComponent(s.id)}`); }
      catch (err) { if (err && err.status === 404) { finishAdminPanel('Session nahi mila.'); return; } st.pollTimer = setTimeout(tick, 2000); return; }
      if (!st.session || st.session.id !== s.id) return;
      const sess = out.session;
      if (sess.status === 'active') { setAdminPanelState('connecting'); startAdminMedia(sess); return; }
      if (sess.status === 'declined') { finishAdminPanel(`${sess.userName} ne request decline kar di.`); return; }
      if (sess.status === 'missed' || sess.status === 'ended') { finishAdminPanel(sess.status === 'missed' ? 'User ne 60s me jawab nahi diya — request cancel.' : 'Session khatam ho gaya.'); return; }
      if (tries > 45) { finishAdminPanel('Timeout — user ka jawab nahi aaya.'); return; }
      st.pollTimer = setTimeout(tick, 1400);
    };
    st.pollTimer = setTimeout(tick, 800);
  }
  async function startAdminMedia(s) {
    if (!st.pc) createPeerConnection(s);
    try {
      const offer = await st.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: s.mode === 'video' });
      await st.pc.setLocalDescription(offer);
      await api(`/api/live-assist/${encodeURIComponent(s.id)}/signal`, 'POST', { kind: 'sdp', data: { type: offer.type, sdp: offer.sdp } });
    } catch (err) { console.warn('liveAssist offer:', err && err.message); }
    startSignalPoll(s);
  }
  function setAdminPanelState(kind) {
    const el = st.panelEl;
    if (!el || !el.querySelector) return;
    const status = el.querySelector('[data-la-status]');
    const state = el.querySelector('[data-la-state]');
    const player = el.querySelector('[data-la-player]');
    if (kind === 'connecting') {
      if (status) status.innerHTML = '<span class="la-spinner"></span> User ne allow kar diya — connection ban rahi hai…';
      if (state) state.textContent = 'Connecting…';
    } else if (kind === 'live') {
      if (status) status.textContent = '🔴 LIVE — stream chal rahi hai';
      if (state) state.textContent = 'LIVE';
      if (player) player.hidden = false;
    }
  }
  function attachRemoteStream(stream, session) {
    const el = st.panelEl;
    if (!el || !el.querySelector) return;
    const player = el.querySelector('[data-la-player]');
    if (player) player.hidden = false;
    const video = el.querySelector('[data-la-video]');
    const audio = el.querySelector('[data-la-audio]');
    const target = session.mode === 'video' ? video : audio;
    if (!target) return;
    try { target.srcObject = stream; } catch { /* ignore */ }
    const tryPlay = () => {
      const p = target.play && target.play();
      if (p && p.catch) p.catch(() => {
        // Chrome autoplay — ek explicit play button dikha do
        const btn = el.querySelector('[data-la-play]');
        if (btn) {
          btn.hidden = false;
          btn.onclick = () => { target.play().then(() => { btn.hidden = true; }).catch(() => {}); };
        }
      });
    };
    tryPlay();
  }
  async function endAdminSession() {
    if (!st.session) { closeAdminPanel(); return; }
    const id = st.session.id;
    teardownMedia();
    try { await api(`/api/live-assist/${encodeURIComponent(id)}/end`, 'POST', {}); } catch { /* already ended */ }
    finishAdminPanel('Session aapne end kar diya.');
  }
  function finishAdminPanel(msg) {
    teardownMedia();
    st.session = null; st.side = '';
    const el = st.panelEl;
    if (el && el.querySelector) {
      const status = el.querySelector('[data-la-status]');
      const state = el.querySelector('[data-la-state]');
      const player = el.querySelector('[data-la-player]');
      if (status) status.textContent = `⏹ ${msg || 'Session khatam.'}`;
      if (state) state.textContent = 'Ended';
      if (player) player.hidden = true;
      setTimeout(() => closeAdminPanel(true), 2600);
    } else closeAdminPanel(true);
  }
  function closeAdminPanel(silent) {
    if (st.panelEl) { try { st.panelEl.remove(); } catch { /* ignore */ } st.panelEl = null; }
    if (!silent && st.session) {
      const id = st.session.id;
      teardownMedia();
      st.session = null; st.side = '';
      api(`/api/live-assist/${encodeURIComponent(id)}/end`, 'POST', {}).catch(() => {});
    }
  }

  // =====================================================================================
  // ▶️ lifecycle
  // =====================================================================================
  function start() {
    if (st.started) return;
    if (typeof window === 'undefined' || !window.setInterval) return;
    st.started = true;
    if (st.inboxTimer) clearInterval(st.inboxTimer);
    // ⚡ v3.60 — inbox poll 3s → 20s. Live Assist request aane par admin ke paas waise bhi
    // notification + push jaata hai (turant); ye poll sirf consent popup ko sync rakhta hai.
    // 3s ka matlab tha har user ke phone se din bhar 20 requests/min — server + connection queue
    // dono par load, aur app "leg" karti thi.
    st.inboxTimer = setInterval(() => {
      if (document && document.visibilityState === 'hidden') return; // background me poll mat karo
      pollInbox();
    }, 20000);
    setTimeout(pollInbox, 1200);
    // 🎙️ Mic permission — site khulne par pehle user gesture par EK HI BAAR (baad me kabhi nahi).
    if (typeof document !== 'undefined' && document.addEventListener && hasMedia()) {
      const onceGesture = () => {
        document.removeEventListener('pointerdown', onceGesture);
        document.removeEventListener('keydown', onceGesture);
        document.removeEventListener('touchstart', onceGesture);
        if (micAsked()) return;
        if (document && document.visibilityState === 'hidden') return;
        ensureMicPermission();
      };
      ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, onceGesture, { passive: true }));
      // Agar permission pehle se granted hai to gesture ka wait hi mat karo — flag set kar do.
      micPermissionState().then((s) => { if (s === 'granted' || s === 'denied') markMicAsked(); });
    }
  }
  function stop() {
    if (st.inboxTimer) { clearInterval(st.inboxTimer); st.inboxTimer = null; }
    teardownMedia();
    hideConsent();
    removePill();
    closeAdminPanel(true);
    st.session = null; st.side = '';
    st.started = false;
  }

  FF.liveAssist = {
    start, stop,
    adminRequest,
    endUserSession,
    ensureMicPermission,
    get session() { return st.session ? { ...st.session } : null; },
    get supported() { return hasMedia() && hasRTC(); }
  };
})(window.FF);
