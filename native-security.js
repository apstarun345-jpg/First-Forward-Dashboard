/* Native device lock + offline read-only mode.
   Mobile/PWA only. WebAuthn uses the phone's platform authenticator.
   The private key and biometric template stay with the OS authenticator.
   IndexedDB stores only a public key and credential ID for the signed-in user.
   This is an additional local privacy barrier, never a replacement for server auth. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  if (!document.documentElement.classList.contains('mobile-ui')) return;

  const DB_NAME = 'ff-native-device-lock';
  const STORE = 'credentials';
  const DEFAULT_LOCK_MS = 60000;
  const TIMEOUTS = [
    { value: 0, label: 'Whenever the app is backgrounded' },
    { value: 60000, label: 'After 1 minute' },
    { value: 300000, label: 'After 5 minutes' },
    { value: 900000, label: 'After 15 minutes' }
  ];
  const state = { username: '', config: null, locked: false, lockEl: null, wait: null, resolveWait: null, hiddenAt: 0, panel: null, panelHistory: false, lastOfflineToast: 0 };
  let dbPromise = null;

  const $ = (selector, root) => (root || document).querySelector(selector);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usernameOf = (user) => String(user && user.username || '').trim().toLowerCase();
  const toBytes = (value) => value instanceof Uint8Array ? value : new Uint8Array(value || 0);

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        if (!window.indexedDB) { resolve(null); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'username' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    return dbPromise;
  }
  async function readConfig(username) {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return null;
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }
  async function writeConfig(record) {
    const db = await openDb();
    if (!db) throw new Error('Secure browser storage available nahi hai. Browser storage enable karke retry karein.');
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Device lock save nahi hua.'));
        tx.onabort = () => reject(tx.error || new Error('Device lock save cancel ho gaya.'));
      } catch (err) { reject(err); }
    });
  }
  async function deleteConfig(username) {
    const db = await openDb();
    if (!db) throw new Error('Device storage open nahi ho pa raha.');
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(String(username || '').trim().toLowerCase());
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Device lock disable nahi hua.'));
      } catch (err) { reject(err); }
    });
  }

  function randomBytes(length) {
    const result = new Uint8Array(length);
    crypto.getRandomValues(result);
    return result;
  }
  function base64url(value) {
    const input = toBytes(value);
    let binary = '';
    for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function unbase64url(value) {
    const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(raw + '='.repeat((4 - raw.length % 4) % 4));
    const result = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
    return result;
  }
  function concatBytes(a, b) {
    const left = toBytes(a), right = toBytes(b), result = new Uint8Array(left.length + right.length);
    result.set(left, 0); result.set(right, left.length);
    return result;
  }
  async function digest(value) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', value));
  }
  function equalBytes(a, b) {
    const left = toBytes(a), right = toBytes(b);
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
    return difference === 0;
  }
  async function platformAuthenticatorAvailable() {
    if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials || !crypto.subtle) return false;
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return false;
    try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
    catch (_) { return false; }
  }
  function validateClientData(raw, expectedType, challenge) {
    let data;
    try { data = JSON.parse(new TextDecoder().decode(raw)); }
    catch (_) { throw new Error('Device verification response invalid hai.'); }
    if (data.type !== expectedType) throw new Error('Device verification type match nahi hua.');
    if (data.challenge !== base64url(challenge)) throw new Error('Security challenge match nahi hua. Dobara try karein.');
    if (data.origin !== location.origin || data.crossOrigin === true) throw new Error('Device verification origin match nahi hua.');
    return data;
  }
  function derToP1363(signature) {
    const input = toBytes(signature);
    if (input.length === 64) return input;
    if (input.length < 8 || input[0] !== 0x30) throw new Error('Device signature format unsupported hai.');
    let at = 1;
    const readLength = () => {
      const first = input[at++];
      if (first < 0x80) return first;
      const count = first & 0x7f;
      if (!count || count > 2 || at + count > input.length) throw new Error('Device signature length invalid hai.');
      let length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + input[at++];
      return length;
    };
    const sequenceLength = readLength();
    if (at + sequenceLength !== input.length || input[at++] !== 0x02) throw new Error('Device signature sequence invalid hai.');
    const readInteger = () => {
      const length = readLength();
      let value = input.slice(at, at + length); at += length;
      while (value.length > 32 && value[0] === 0) value = value.slice(1);
      if (!value.length || value.length > 32) throw new Error('Device signature integer invalid hai.');
      const result = new Uint8Array(32);
      result.set(value, 32 - value.length);
      return result;
    };
    const r = readInteger();
    if (input[at++] !== 0x02) throw new Error('Device signature second integer missing hai.');
    const s = readInteger();
    if (at !== input.length) throw new Error('Device signature trailing data invalid hai.');
    return concatBytes(r, s);
  }
  async function createDeviceCredential(user) {
    if (!(await platformAuthenticatorAvailable())) {
      throw new Error('Is phone/browser me platform biometric authenticator available nahi hai. Updated Chrome/Safari aur HTTPS use karein.');
    }
    const username = usernameOf(user);
    if (!username) throw new Error('Signed-in account identify nahi hua.');
    const challenge = randomBytes(32);
    let credential;
    try {
      credential = await navigator.credentials.create({ publicKey: {
        challenge: challenge,
        rp: { name: 'First Forward Dashboard', id: location.hostname },
        user: { id: randomBytes(16), name: username, displayName: String(user.name || username).slice(0, 64) },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'discouraged', userVerification: 'required' },
        attestation: 'none',
        timeout: 60000
      } });
    } catch (err) {
      if (err && err.name === 'NotAllowedError') throw new Error('Biometric setup cancel hua ya device screen lock available nahi hai.');
      throw err;
    }
    if (!credential || !credential.response || typeof credential.response.getPublicKey !== 'function') {
      throw new Error('Browser local public key expose nahi karta. Updated Android Chrome / iOS Safari try karein.');
    }
    if (credential.authenticatorAttachment && credential.authenticatorAttachment !== 'platform') {
      throw new Error('Phone ka built-in biometric authenticator select karein, external security key nahi.');
    }
    validateClientData(credential.response.clientDataJSON, 'webauthn.create', challenge);
    const publicKey = credential.response.getPublicKey();
    const algorithm = credential.response.getPublicKeyAlgorithm();
    if (!publicKey || algorithm !== -7) throw new Error('Device ne supported P-256 / ES256 key nahi diya.');
    await crypto.subtle.importKey('spki', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const record = {
      username: username,
      credentialId: base64url(credential.rawId),
      publicKey: base64url(publicKey),
      algorithm: 'ES256',
      rpId: location.hostname,
      enabled: true,
      lockAfterMs: DEFAULT_LOCK_MS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await writeConfig(record);
    return record;
  }
  async function verifyDeviceCredential(config) {
    if (!config || !config.enabled || config.algorithm !== 'ES256') throw new Error('Device lock configuration missing hai.');
    if (!window.isSecureContext || !navigator.credentials || !crypto.subtle) throw new Error('Secure device verification available nahi hai.');
    const challenge = randomBytes(32);
    let credential;
    try {
      credential = await navigator.credentials.get({ publicKey: {
        challenge: challenge,
        rpId: config.rpId,
        allowCredentials: [{ type: 'public-key', id: unbase64url(config.credentialId) }],
        userVerification: 'required',
        timeout: 60000
      } });
    } catch (err) {
      if (err && err.name === 'NotAllowedError') throw new Error('Unlock cancel hua. Fingerprint / Face ID ya device PIN se dobara try karein.');
      throw err;
    }
    if (!credential || !credential.response) throw new Error('Device verification response nahi mila.');
    if (!equalBytes(credential.rawId, unbase64url(config.credentialId))) throw new Error('Ye device credential registered account se match nahi karti.');
    const response = credential.response;
    validateClientData(response.clientDataJSON, 'webauthn.get', challenge);
    const authData = toBytes(response.authenticatorData);
    if (authData.length < 37) throw new Error('Authenticator data incomplete hai.');
    const expectedRpHash = await digest(new TextEncoder().encode(config.rpId));
    if (!equalBytes(authData.slice(0, 32), expectedRpHash)) throw new Error('Credential app domain se match nahi karti.');
    const flags = authData[32];
    if (!(flags & 0x01)) throw new Error('Device presence confirm nahi hui.');
    if (!(flags & 0x04)) throw new Error('Device ne biometric / screen-lock verification confirm nahi ki.');
    const publicKey = await crypto.subtle.importKey('spki', unbase64url(config.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const clientHash = await digest(response.clientDataJSON);
    const signedData = concatBytes(authData, clientHash);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, derToP1363(response.signature), signedData);
    if (!valid) throw new Error('Device signature verify nahi hui. Password se login karke biometric setup dobara karein.');
    config.lastUsedAt = new Date().toISOString();
    writeConfig(config).catch(() => {});
    return true;
  }

  function lockWaiter() {
    if (!state.wait) state.wait = new Promise((resolve) => { state.resolveWait = resolve; });
    return state.wait;
  }
  function finishUnlock() {
    const resolve = state.resolveWait;
    state.resolveWait = null;
    state.wait = null;
    if (typeof resolve === 'function') resolve(true);
  }
  function renderLock(user, config) {
    if (state.lockEl && state.lockEl.isConnected) return state.lockEl;
    const name = String(user && (user.name || user.username) || 'Workspace');
    const el = document.createElement('section');
    el.id = 'native-device-lock';
    el.className = 'nsec-lock-screen';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'nsec-lock-title');
    el.innerHTML = '<div class="nsec-lock-card">' +
      '<img class="nsec-lock-icon" src="/icon-192.png" width="64" height="64" alt="">' +
      '<p class="nsec-eyebrow">FIRST FORWARD · SECURE WORKSPACE</p>' +
      '<h1 id="nsec-lock-title">App locked</h1>' +
      '<p class="nsec-lock-user">Welcome back, <b>' + esc(name) + '</b></p>' +
      '<p class="nsec-lock-copy">Unlock with your phone fingerprint, Face ID or screen lock.</p>' +
      '<button type="button" class="nsec-primary" data-nsec-unlock>Unlock with device</button>' +
      '<p class="nsec-message" data-nsec-message role="status" aria-live="polite">Your private device key never leaves this phone.</p>' +
      '<button type="button" class="nsec-secondary" data-nsec-password>Use password instead</button>' +
      '</div>';
    document.body.appendChild(el);
    state.lockEl = el;
    state.locked = true;
    document.documentElement.classList.add('native-security-locked');
    const boot = $('#app-boot');
    if (boot && !FF.auth.user) boot.remove();
    const unlockButton = $('[data-nsec-unlock]', el);
    const message = $('[data-nsec-message]', el);
    unlockButton.addEventListener('click', async () => {
      unlockButton.disabled = true;
      unlockButton.textContent = 'Verifying…';
      message.textContent = 'Phone authenticator se verification ho rahi hai…';
      try {
        await verifyDeviceCredential(config);
        state.locked = false;
        state.lockEl = null;
        state.config = config;
        el.remove();
        document.documentElement.classList.remove('native-security-locked');
        if (navigator.vibrate) navigator.vibrate(12);
        finishUnlock();
      } catch (err) {
        message.textContent = String(err && err.message || 'Unlock nahi hua. Dobara try karein.');
        unlockButton.disabled = false;
        unlockButton.textContent = 'Unlock with device';
      }
    });
    $('[data-nsec-password]', el).addEventListener('click', async () => {
      const button = $('[data-nsec-password]', el);
      if (navigator.onLine === false) {
        message.textContent = 'Password sign-in ke liye internet connect karein. Offline me sirf device unlock available hai.';
        return;
      }
      button.disabled = true;
      message.textContent = 'Secure password sign-in khol rahe hain…';
      try {
        await FF.auth.logout();
      } catch (err) {
        message.textContent = String(err && err.message || 'Password sign-in open nahi hua.');
        button.disabled = false;
      }
    });
    setTimeout(() => { try { unlockButton.focus(); } catch (_) {} }, 60);
    return el;
  }
  function showLock(user, config, waitForUnlock) {
    renderLock(user, config);
    return waitForUnlock ? lockWaiter() : Promise.resolve(true);
  }
  async function prepareRestoredSession(user) {
    const username = usernameOf(user);
    state.username = username;
    state.config = username ? await readConfig(username) : null;
    if (state.config && state.config.enabled) return showLock(user, state.config, true);
    return true;
  }
  function visibilityChanged() {
    if (document.visibilityState === 'hidden') { state.hiddenAt = Date.now(); return; }
    if (!state.hiddenAt) return;
    const away = Date.now() - state.hiddenAt;
    state.hiddenAt = 0;
    const user = FF.auth && FF.auth.user;
    if (!user || !state.config || !state.config.enabled || state.locked) return;
    if (away >= Math.max(0, Number(state.config.lockAfterMs))) showLock(user, state.config, false);
  }
  function installAuthHooks() {
    if (FF.auth && typeof FF.auth.init === 'function' && !FF.auth.__nativeDeviceLockWrapped) {
      const original = FF.auth.init.bind(FF.auth);
      FF.auth.init = async function () {
        const ok = await original();
        if (!ok || !FF.auth.user) return ok;
        return await prepareRestoredSession(FF.auth.user);
      };
      FF.auth.__nativeDeviceLockWrapped = true;
    }
    window.addEventListener('ff-login', (event) => {
      const user = event && event.detail && event.detail.user;
      if (!user) return;
      state.username = usernameOf(user);
      state.config = null;
      readConfig(state.username).then((config) => { state.config = config; }).catch(() => {});
    });
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pagehide', () => { state.hiddenAt = Date.now(); });
    window.addEventListener('pageshow', () => { if (state.hiddenAt && document.visibilityState === 'visible') visibilityChanged(); });
    window.addEventListener('popstate', () => {
      if (state.locked) {
        try { history.pushState({ ...(history.state || {}), ffDeviceLocked: 1 }, '', location.href); } catch (_) {}
      }
      if (state.panel) closePanel(true);
    });
    window.addEventListener('hashchange', () => { if (state.panel) closePanel(false); });
  }

  function panelMarkup(config, error) {
    const enabled = !!(config && config.enabled);
    const timeout = enabled ? Number(config.lockAfterMs) : DEFAULT_LOCK_MS;
    const options = TIMEOUTS.map((item) => '<option value="' + item.value + '"' + (item.value === timeout ? ' selected' : '') + '>' + esc(item.label) + '</option>').join('');
    let actions;
    if (enabled) {
      actions = '<button type="button" class="nsec-primary" data-nsec-lock>Lock app now</button>' +
        '<button type="button" class="nsec-secondary" data-nsec-replace>Replace device credential</button>' +
        '<button type="button" class="nsec-danger" data-nsec-disable>Disable device lock</button>';
    } else {
      actions = '<button type="button" class="nsec-primary" data-nsec-enable>Enable device biometric lock</button>';
    }
    return '<div class="nsec-panel-head"><span class="nsec-panel-icon">🔐</span><div><h2 id="nsec-panel-title">Device security</h2><p>Face ID · fingerprint · phone screen lock</p></div></div>' +
      '<div class="nsec-status ' + (enabled ? 'is-enabled' : 'is-disabled') + '"><span></span><b>' + (enabled ? 'Enabled on this device' : 'Not enabled') + '</b><small>' + (enabled ? 'This account is protected on this browser.' : 'Optional device-only protection for this account.') + '</small></div>' +
      (error ? '<p class="nsec-error" role="alert">' + esc(error) + '</p>' : '') +
      (enabled ? '<label class="nsec-timeout-label">Automatically lock the app<select data-nsec-timeout>' + options + '</select></label>' : '') +
      '<div class="nsec-actions">' + actions + '</div>' +
      '<div class="nsec-note"><b>Privacy and recovery</b><p>Fingerprint/Face ID templates and the private key stay inside the phone authenticator. This browser stores only the credential ID and public key. Server login and permissions remain active. If this browser data is cleared, use password sign-in while online and set up the device lock again.</p></div>' +
      '<button type="button" class="nsec-close" data-nsec-close>Done</button>';
  }
  async function openPanel() {
    if (state.panel) closePanel(false);
    const user = FF.auth && FF.auth.user;
    const username = usernameOf(user);
    if (!username) return;
    const overlay = document.createElement('div');
    overlay.id = 'native-security-panel';
    overlay.className = 'nsec-panel-backdrop';
    overlay.innerHTML = '<section class="nsec-panel-card" role="dialog" aria-modal="true" aria-labelledby="nsec-panel-title"><div class="nsec-grab"></div><div class="nsec-panel-body"><p class="nsec-loading">Checking this device…</p></div></section>';
    document.body.appendChild(overlay);
    state.panel = overlay;
    try { history.pushState({ ...(history.state || {}), ffNativeSecurityPanel: 1 }, '', location.href); state.panelHistory = true; } catch (_) {}
    const body = $('.nsec-panel-body', overlay);
    const redraw = async (message) => {
      const config = await readConfig(username);
      state.config = config;
      body.innerHTML = panelMarkup(config, message || '');
    };
    await redraw('');
    overlay.addEventListener('click', async (event) => {
      if (event.target === overlay || event.target.closest('[data-nsec-close]')) { closePanel(false); return; }
      if (event.target.closest('[data-nsec-enable]')) {
        const button = event.target.closest('[data-nsec-enable]');
        button.disabled = true;
        button.textContent = 'Setting up…';
        try {
          const config = await createDeviceCredential(user);
          state.config = config;
          await redraw('');
          if (FF.util && FF.util.toast) FF.util.toast('Device biometric lock enabled ✓', 'ok');
        } catch (err) { await redraw(String(err && err.message || 'Biometric setup fail hua.')); }
        return;
      }
      if (event.target.closest('[data-nsec-replace]')) {
        const button = event.target.closest('[data-nsec-replace]');
        const current = await readConfig(username);
        button.disabled = true;
        try {
          if (current && current.enabled) await verifyDeviceCredential(current);
          const config = await createDeviceCredential(user);
          state.config = config;
          await redraw('');
          if (FF.util && FF.util.toast) FF.util.toast('Device credential replaced ✓', 'ok');
        } catch (err) { await redraw(String(err && err.message || 'Credential replace fail hua.')); }
        return;
      }
      if (event.target.closest('[data-nsec-lock]')) {
        closePanel(false);
        setTimeout(() => showLock(user, state.config, false), 120);
        return;
      }
      if (event.target.closest('[data-nsec-disable]')) {
        const button = event.target.closest('[data-nsec-disable]');
        const current = await readConfig(username);
        button.disabled = true;
        try {
          if (current && current.enabled) await verifyDeviceCredential(current);
          await deleteConfig(username);
          state.config = null;
          await redraw('');
          if (FF.util && FF.util.toast) FF.util.toast('Device lock disabled on this browser.', 'ok');
        } catch (err) { await redraw(String(err && err.message || 'Device lock disable nahi hua.')); }
      }
    });
    overlay.addEventListener('change', async (event) => {
      if (!event.target.matches('[data-nsec-timeout]')) return;
      const config = await readConfig(username);
      if (!config) return;
      config.lockAfterMs = Math.max(0, Number(event.target.value) || 0);
      config.updatedAt = new Date().toISOString();
      try {
        await writeConfig(config);
        state.config = config;
        if (FF.util && FF.util.toast) FF.util.toast('Auto-lock timing saved ✓', 'ok');
      } catch (err) { await redraw(String(err && err.message || 'Auto-lock timing save nahi hua.')); }
    });
    const grip = $('.nsec-grab', overlay);
    const card = $('.nsec-panel-card', overlay);
    let startY = 0, distance = 0, dragging = false;
    grip.addEventListener('touchstart', (event) => { if (event.touches.length !== 1) return; dragging = true; startY = event.touches[0].clientY; distance = 0; }, { passive: true });
    grip.addEventListener('touchmove', (event) => { if (!dragging) return; distance = Math.max(0, event.touches[0].clientY - startY); card.style.transform = 'translateY(' + distance + 'px)'; }, { passive: true });
    const endDrag = () => { if (!dragging) return; dragging = false; card.style.transform = ''; if (distance > 110) closePanel(false); };
    grip.addEventListener('touchend', endDrag);
    grip.addEventListener('touchcancel', endDrag);
  }
  function closePanel(fromHistory) {
    const panel = state.panel;
    if (!panel) return;
    state.panel = null;
    panel.remove();
    if (state.panelHistory && !fromHistory && history.state && history.state.ffNativeSecurityPanel) {
      state.panelHistory = false;
      history.back();
    } else state.panelHistory = false;
  }
  function addMenuItem() {
    const list = $('.nsheet .nsheet-list');
    if (!list || $('[data-native-security-open]', list) || !FF.auth || !FF.auth.user) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nsheet-item nsec-menu-item';
    button.setAttribute('data-native-security-open', '1');
    button.innerHTML = '<span class="nsheet-ico" aria-hidden="true">🔐</span><span class="nsheet-txt"><b>Device security</b><small>Fingerprint · Face ID · automatic app lock</small></span>';
    button.addEventListener('click', () => {
      if (FF.nativeApp && FF.nativeApp.closeSheet) FF.nativeApp.closeSheet(true);
      setTimeout(openPanel, 120);
    });
    list.appendChild(button);
  }

  function installOfflineGuard() {
    if (!FF.auth || typeof FF.auth.api !== 'function' || FF.auth.__nativeOfflineGuard) return;
    const original = FF.auth.api.bind(FF.auth);
    // These endpoints are read-only POST lookups. All other writes remain blocked offline.
    const readOnlyPost = /^\/api\/(?:dispatch-by|dispatch-lookup|stock-age|gv-agent-commission|kyc)(?:\/|$)/;
    FF.auth.api = function (path, method, body) {
      const verb = String(method || 'GET').toUpperCase();
      const readOnly = verb === 'GET' || (verb === 'POST' && readOnlyPost.test(String(path || '')));
      if (navigator.onLine === false && !readOnly) {
        const error = new Error('Offline read-only mode: internet reconnect hone tak request ya update submit nahi hogi.');
        error.name = 'OfflineWriteBlockedError';
        error.offline = true;
        if (Date.now() - state.lastOfflineToast > 4000) {
          state.lastOfflineToast = Date.now();
          if (FF.util && FF.util.toast) FF.util.toast('📴 Offline mode: saved reports dekh sakte hain; requests aur updates reconnect hone tak band hain.', 'warn');
        }
        return Promise.reject(error);
      }
      return original(path, method, body);
    };
    FF.auth.__nativeOfflineGuard = true;
  }
  function updateOfflineLabel() {
    const label = $('#offline-state');
    if (!label) return;
    if (navigator.onLine === false) {
      label.textContent = '📴 Offline · View only';
      label.title = 'Saved snapshot only. Requests and updates are paused until the internet reconnects.';
      label.classList.add('is-offline');
      label.hidden = false;
    } else {
      label.title = '';
    }
  }
  function start() {
    installAuthHooks();
    installOfflineGuard();
    document.addEventListener('click', (event) => {
      if (event.target && event.target.closest && event.target.closest('#nab-more, #top-more')) setTimeout(addMenuItem, 0);
    }, true);
    const observer = new MutationObserver(addMenuItem);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('offline', updateOfflineLabel);
    window.addEventListener('online', updateOfflineLabel);
    updateOfflineLabel();
  }

  FF.nativeSecurity = {
    supported: platformAuthenticatorAvailable,
    openSettings: openPanel,
    lockNow: async function () {
      const user = FF.auth && FF.auth.user;
      if (!user) return false;
      const config = await readConfig(usernameOf(user));
      if (!config || !config.enabled) {
        if (FF.util && FF.util.toast) FF.util.toast('Pehle Device security enable karein.', 'warn');
        return false;
      }
      state.config = config;
      await showLock(user, config, false);
      return true;
    },
    status: function () { return { enabled: !!(state.config && state.config.enabled), locked: state.locked, username: state.username }; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window.FF);
