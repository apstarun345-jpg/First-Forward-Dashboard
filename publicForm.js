/* 🌐 PUBLIC EMPLOYEE TAG REQUEST (v3.27) — bina login wala form.
 *
 * Kyun: employees ko tag request lagane ke liye account banana/lena padta tha. Ab admin ek link
 * share karta hai —
 *
 *      https://<app>/tag-request          (ya  https://<app>/#/tagRequest?public=1)
 *
 * — jo koi bhi khol sakta hai: koi login nahi, koi signup nahi. Upar sirf **Employee name**
 * mandatory hai (mobile/branch optional, Settings se on/off), phir wahi form — agent search →
 * class-wise qty → system check (stock/issuance/priority/suggestion) → submit. Request admin ke
 * "🏷️ Tag Request" section me 'employee link' badge ke saath aati hai, aur Google Sheet sync bhi
 * chalti hai (agar admin ne ON ki ho).
 *
 * Data: public form sirf /api/public/gviz se padhta hai (server side scoped + throttled — EIR par
 * sirf aggregated queries). Public link se dashboard ka koi doosra page nahi khulta.
 */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const state = { config: null, error: '', at: 0 };
  const LIVE_SHARE_KEY = 'ff_public_tag_live_share_v1';
  const liveShare = { sessionId: '', token: '', enabled: false, busy: false, sending: false, timer: null, heartbeat: null, events: [], pointer: null, scrollY: 0, lastInteraction: Date.now(), lastSent: 0, dirty: false, banner: null, listenersBound: false, lastPointerAt: 0 };
  const isLiveMirror = () => { try { return new URLSearchParams(location.search).get('embed') === 'live'; } catch { return false; } };
  const liveEsc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function addLiveShareStyles() {
    if (document.getElementById('tr-live-share-styles')) return;
    const style = document.createElement('style');
    style.id = 'tr-live-share-styles';
    style.textContent = `.tr-live-share{margin:0 auto 14px;max-width:1180px;border:1px solid var(--line,#dbe3ef);border-radius:16px;padding:14px 16px;background:linear-gradient(135deg,rgba(79,70,229,.07),rgba(14,165,233,.06));box-shadow:0 4px 18px rgba(15,23,42,.04)}.tr-live-share-main{display:flex;align-items:flex-start;gap:12px}.tr-live-share-icon{width:42px;height:42px;flex:0 0 42px;display:grid;place-items:center;border-radius:13px;background:rgba(79,70,229,.12);font-size:22px}.tr-live-share-copy{flex:1;min-width:0}.tr-live-share-copy b{display:block;font-size:14px}.tr-live-share-copy p{margin:4px 0 0;font-size:12px;line-height:1.55;color:var(--muted,#64748b)}.tr-live-share-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}.tr-live-share-status{font-size:12px;color:var(--muted,#64748b)}.tr-live-share-status.is-live{color:#047857;font-weight:700}.tr-live-share .btn{min-height:36px}.tr-live-share .tr-live-on{background:#047857;color:white;border-color:#047857}@media(max-width:600px){.tr-live-share{margin:0 0 12px;padding:12px}.tr-live-share-main{gap:9px}.tr-live-share-icon{width:36px;height:36px;flex-basis:36px}}`;
    document.head.appendChild(style);
  }
  function persistLiveShare() {
    try {
      if (liveShare.sessionId && liveShare.token && liveShare.enabled) sessionStorage.setItem(LIVE_SHARE_KEY, JSON.stringify({ sessionId: liveShare.sessionId, token: liveShare.token }));
      else sessionStorage.removeItem(LIVE_SHARE_KEY);
    } catch { /* storage can be blocked; live sharing still works for this tab */ }
  }
  function restoreLiveShare() {
    try {
      const raw = sessionStorage.getItem(LIVE_SHARE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || !saved.sessionId || !saved.token) return false;
      liveShare.sessionId = String(saved.sessionId);
      liveShare.token = String(saved.token);
      liveShare.enabled = true;
      return true;
    } catch { return false; }
  }
  function fieldLabel(target) {
    if (!target || !target.tagName) return 'Page action';
    const el = target.closest('button,a,[role="tab"],label,select,input,textarea,[data-tr-act]') || target;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      const label = (el.labels && el.labels.length ? el.labels[0].innerText : '') || el.getAttribute('aria-label') || el.name || 'form field';
      return `Form field: ${String(label).replace(/\s+/g, ' ').trim().slice(0, 60)}`;
    }
    const label = (el.getAttribute('aria-label') || el.title || el.innerText || el.textContent || 'Page action').replace(/\s+/g, ' ').trim();
    return label.slice(0, 80) || 'Page action';
  }
  function queueLiveEvent(kind, label) {
    if (!liveShare.enabled) return;
    liveShare.events.push({ at: Date.now(), kind, label: String(label || '').slice(0, 100), page: 'tag-request' });
    if (liveShare.events.length > 40) liveShare.events.splice(0, liveShare.events.length - 40);
    liveShare.dirty = true;
  }
  async function sendLivePresence(force = false) {
    if (!liveShare.enabled || !liveShare.sessionId || !liveShare.token || liveShare.sending) return;
    if (!force && liveShare.lastSent && Date.now() - liveShare.lastSent < 750) return;
    if (!force && !liveShare.dirty && Date.now() - liveShare.lastSent < 3000) return;
    liveShare.sending = true;
    const events = liveShare.events.slice(0, 15);
    const payload = {
      sessionId: liveShare.sessionId, token: liveShare.token, page: 'tag-request',
      visible: document.visibilityState === 'visible',
      engaged: Date.now() - liveShare.lastInteraction < 90e3,
      pointer: liveShare.pointer,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scroll: { y: Math.round(window.scrollY || liveShare.scrollY), h: document.documentElement.scrollHeight || 0 },
      events
    };
    try {
      await api('/api/public/live-presence', 'POST', payload);
      if (events.length) liveShare.events.splice(0, events.length);
      liveShare.lastSent = Date.now();
      liveShare.dirty = false;
    } catch (err) {
      if (err && (err.status === 401 || err.status === 403)) {
        liveShare.enabled = false; liveShare.sessionId = ''; liveShare.token = '';
        clearInterval(liveShare.timer); clearInterval(liveShare.heartbeat);
        liveShare.timer = liveShare.heartbeat = null;
        persistLiveShare(); syncLiveShareBanner();
      }
    } finally { liveShare.sending = false; }
  }
  function bindLiveShareEvents() {
    if (liveShare.listenersBound) return;
    liveShare.listenersBound = true;
    document.addEventListener('pointermove', (e) => {
      if (!liveShare.enabled) return;
      const now = Date.now();
      liveShare.lastInteraction = now;
      if (now - liveShare.lastPointerAt < 80) return;
      liveShare.lastPointerAt = now;
      liveShare.pointer = { x: Math.round((e.clientX / Math.max(1, window.innerWidth)) * 1000) / 10, y: Math.round((e.clientY / Math.max(1, window.innerHeight)) * 1000) / 10 };
      liveShare.dirty = true;
    }, { passive: true });
    document.addEventListener('pointerdown', (e) => {
      if (!liveShare.enabled) return;
      liveShare.lastInteraction = Date.now();
      liveShare.pointer = { x: Math.round((e.clientX / Math.max(1, window.innerWidth)) * 1000) / 10, y: Math.round((e.clientY / Math.max(1, window.innerHeight)) * 1000) / 10 };
      queueLiveEvent('click', fieldLabel(e.target));
    }, { passive: true, capture: true });
    document.addEventListener('focusin', (e) => {
      if (!liveShare.enabled) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
        liveShare.lastInteraction = Date.now();
        queueLiveEvent('focus', fieldLabel(e.target));
      }
    }, true);
    document.addEventListener('change', (e) => {
      if (!liveShare.enabled || !e.target || !/^(SELECT)$/.test(e.target.tagName) && !/^(checkbox|radio)$/.test(String(e.target.type || ''))) return;
      liveShare.lastInteraction = Date.now();
      queueLiveEvent('change', fieldLabel(e.target));
    }, true);
    window.addEventListener('scroll', () => {
      if (!liveShare.enabled) return;
      liveShare.scrollY = Math.round(window.scrollY || 0);
      liveShare.lastInteraction = Date.now();
      liveShare.dirty = true;
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!liveShare.enabled) return;
      queueLiveEvent('tab', document.visibilityState === 'visible' ? 'Tag Request tab visible' : 'Tag Request tab hidden');
      sendLivePresence(true);
    });
  }
  function syncLiveShareBanner() {
    const banner = liveShare.banner;
    if (!banner) return;
    const button = banner.querySelector('[data-public-live-toggle]');
    const status = banner.querySelector('[data-public-live-status]');
    if (button) {
      button.disabled = liveShare.busy;
      button.classList.toggle('tr-live-on', !!liveShare.enabled);
      button.textContent = liveShare.enabled ? '■ Stop Live Share' : '👁 Start Live Share';
    }
    if (status) {
      status.classList.toggle('is-live', !!liveShare.enabled);
      status.textContent = liveShare.enabled ? '● LIVE SHARING ON · Admin ko page activity dikh rahi hai' : 'Live sharing OFF · Aap jab chahein enable kar sakte hain';
    }
  }
  async function startLiveShare() {
    if (liveShare.enabled || liveShare.busy) return;
    liveShare.busy = true; syncLiveShareBanner();
    try {
      const out = await api('/api/public/live-presence/start', 'POST', { consent: true });
      liveShare.sessionId = String(out.sessionId || '');
      liveShare.token = String(out.token || '');
      if (!liveShare.sessionId || !liveShare.token) throw new Error('Live sharing session start nahi hua.');
      liveShare.enabled = true;
      liveShare.lastInteraction = Date.now();
      liveShare.events = [];
      persistLiveShare(); bindLiveShareEvents();
      queueLiveEvent('share', 'Employee enabled live page sharing');
      clearInterval(liveShare.timer); clearInterval(liveShare.heartbeat);
      liveShare.timer = setInterval(() => sendLivePresence(), 250);
      liveShare.heartbeat = setInterval(() => sendLivePresence(true), 3000);
      liveShare.busy = false; syncLiveShareBanner();
      await sendLivePresence(true);
      if (FF.util && FF.util.toast) FF.util.toast('Live page sharing ON — aap kabhi bhi Stop kar sakte hain.', 'ok');
    } catch (err) {
      if (FF.util && FF.util.toast) FF.util.toast('Live sharing start nahi hua: ' + (err.message || 'Network error'), 'err');
    } finally { liveShare.busy = false; syncLiveShareBanner(); }
  }
  async function stopLiveShare() {
    if (liveShare.busy) return;
    const credentials = { sessionId: liveShare.sessionId, token: liveShare.token };
    liveShare.busy = true; syncLiveShareBanner();
    clearInterval(liveShare.timer); clearInterval(liveShare.heartbeat);
    liveShare.timer = liveShare.heartbeat = null;
    liveShare.enabled = false; liveShare.events = []; liveShare.pointer = null;
    try { if (credentials.sessionId && credentials.token) await api('/api/public/live-presence/stop', 'POST', credentials); } catch { /* session can already have expired */ }
    liveShare.sessionId = ''; liveShare.token = '';
    persistLiveShare();
    if (FF.util && FF.util.toast) FF.util.toast('Live sharing band kar di gayi.', 'ok');
    liveShare.busy = false; syncLiveShareBanner();
  }
  function installLiveShareBanner(main, root) {
    if (isLiveMirror() || !main || !root || liveShare.banner) return;
    addLiveShareStyles();
    const banner = document.createElement('section');
    banner.className = 'tr-live-share';
    banner.innerHTML = `<div class="tr-live-share-main"><div class="tr-live-share-icon" aria-hidden="true">👁️</div><div class="tr-live-share-copy"><b>Optional Live View · Admin Support</b><p>Aap Live Share enable karenge to Admin is page ka layout, cursor/scroll position aur generic action labels real-time dekh sakega. Form mein type kiye gaye naam, mobile, address, quantities ya doosre field values live monitoring ke through share nahi honge. Sharing ko kabhi bhi band kar sakte hain.</p><div class="tr-live-share-controls"><button class="btn primary" type="button" data-public-live-toggle>👁 Start Live Share</button><span class="tr-live-share-status" data-public-live-status>Live sharing OFF · Aap jab chahein enable kar sakte hain</span></div></div></div>`;
    banner.querySelector('[data-public-live-toggle]').addEventListener('click', () => liveShare.enabled ? stopLiveShare() : startLiveShare());
    liveShare.banner = banner;
    main.insertBefore(banner, root);
    if (restoreLiveShare()) {
      bindLiveShareEvents();
      queueLiveEvent('share', 'Live sharing resumed after page reload');
      sendLivePresence(true);
      liveShare.timer = setInterval(() => sendLivePresence(), 250);
      liveShare.heartbeat = setInterval(() => sendLivePresence(true), 3000);
    }
    syncLiveShareBanner();
  }

  /** Is URL par public form chalana hai? (clean path ya purana hash wala link) */
  function active() {
    try {
      const path = String(location.pathname || '').replace(/\/+$/, '').toLowerCase();
      if (path === '/tag-request' || path === '/employee-tag-request') return true;
      const hash = String(location.hash || '');
      if (/tagrequest/i.test(hash) && /(^|[?&])public=1(&|$)/.test(hash)) return true;
    } catch { /* SSR / test env */ }
    return false;
  }

  async function api(path, method, body) {
    const res = await fetch(path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin', cache: 'no-store'
    });
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    if (!res.ok) { const err = new Error((json && json.error) || `HTTP ${res.status}`); err.status = res.status; throw err; }
    return json || {};
  }

  /** Login screen ki jagah public form ka shell — sidebar/topbar chhupa hua (body.public-form). */
  function shell() {
    document.body.classList.add('public-form');
    const boot = U.$('#app-boot'); if (boot) boot.remove();
    const main = U.$('#main');
    if (main) main.innerHTML = '';
    return main;
  }

  function messageCard(title, body, extra) {
    return `<section class="card tr-public-msg"><div class="card-body">
      <h2 style="margin:0 0 6px">${title}</h2>
      <p class="dim" style="margin:0 0 10px">${body}</p>${extra || ''}</div></section>`;
  }

  async function boot() {
    const main = shell();
    try { document.title = 'Tag Request · Employee form'; } catch { /* ignore */ }
    if (main) main.innerHTML = `<div class="tr-public-wrap">${U.spinner('Tag request form khul raha hai…')}</div>`;
    let cfg;
    try {
      const out = await api('/api/public/tag-request');
      cfg = (out && out.config) || {};
      state.config = cfg; state.at = Date.now();
    } catch (err) {
      if (main) main.innerHTML = `<div class="tr-public-wrap">${messageCard('⚠️ Form load nahi hua', esc(err.message || 'Server se baat nahi hui.'),
        '<button class="btn primary" onclick="location.reload()">↻ Dobara koshish karo</button>')}</div>`;
      return false;
    }
    if (cfg.brand) { const b = U.$('#brand-name'); if (b) b.textContent = cfg.brand; }
    if (cfg.enabled === false) {
      if (main) main.innerHTML = `<div class="tr-public-wrap">${messageCard('🔒 Ye form abhi band hai',
        'Admin ne employee link filhaal OFF kar rakha hai. Apne manager se naya link maango.')}</div>`;
      return false;
    }
    // Public form ka data sirf scoped public proxy se aata hai (login wala /api/gviz band rehta hai).
    FF.config.proxyPath = '/api/public/gviz';
    try {
      if (FF.lazy && FF.lazy.ensure) await FF.lazy.ensure('tagRequest');
    } catch { /* neeche check */ }
    if (!FF.pages || !FF.pages.tagRequest) {
      if (main) main.innerHTML = `<div class="tr-public-wrap">${messageCard('⚠️ Form module load nahi hua',
        'Internet check karke dobara try karo.', '<button class="btn primary" onclick="location.reload()">↻ Retry</button>')}</div>`;
      return false;
    }
    const root = document.createElement('div');
    root.className = 'page page-tagRequest tr-public-page';
    if (main) main.replaceChildren(root);
    document.body.classList.add('ready');
    try {
      await FF.pages.tagRequest.render(root, { view: 'form', public: '1' }, { publicConfig: cfg });
      // Employee link par live preview opt-in hai; embed mirror me banner/telemetry nahi dikhate.
      if (!isLiveMirror()) installLiveShareBanner(main, root);
    } catch (err) {
      console.error(err);
      root.innerHTML = messageCard('⚠️ Form render nahi hua', esc(err.message || ''));
    }
    return true;
  }

  FF.publicForm = { active, boot, api, get config() { return state.config; }, liveShareCredentials() { return liveShare.enabled && liveShare.sessionId && liveShare.token ? { sessionId: liveShare.sessionId, token: liveShare.token } : null; } };
})(window.FF);
