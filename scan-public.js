/* 📷 Public scan link (/scan) — naam mandatory, camera / scanner gun se 16-digit FASTag barcode, list server par (admin ko live). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NAME_KEY = 'ff_scan_name', SND_KEY = 'ff_scan_snd', PEND_KEY = 'ff_scan_pending';
  const st = { name: '', rows: [], seen: new Set(), pend: [], sound: true, cam: { on: false, stream: null, det: null, reader: null, timer: 0, busy: false, torch: false }, hold: false, code: '', last: { k: '', at: 0 }, ctx: null };
  const fmt = (d) => d.slice(0, 6) + '-' + d.slice(6, 9) + '-' + d.slice(9);
  const valid = (raw) => { const r = String(raw || '').trim(); if (!/^[\d-]+$/.test(r)) return ''; const d = r.replace(/\D/g, ''); return /^\d{16}$/.test(d) ? fmt(d) : ''; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tm = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2600); }
  function note(t, cls) { const n = $('note'); n.textContent = t || ''; n.className = 'sp-note' + (cls ? ' ' + cls : ''); }
  function beep(kind) {
    if (!st.sound) return;
    try {
      const A = window.AudioContext || window.webkitAudioContext; if (!A) return; st.ctx = st.ctx || new A();
      const o = st.ctx.createOscillator(), g = st.ctx.createGain(); o.connect(g); g.connect(st.ctx.destination);
      o.frequency.value = kind === 'bad' ? 220 : kind === 'dup' ? 330 : 880; g.gain.value = 0.15; o.start(); o.stop(st.ctx.currentTime + (kind === 'ok' ? 0.09 : 0.2));
    } catch { /* optional */ }
  }
  async function api(method, path, body) {
    const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch { /* */ }
    if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return j;
  }
  function paint(newCode) {
    $('cnt').textContent = st.rows.length + ' scan';
    const L = $('list');
    if (!st.rows.length) { L.innerHTML = '<div class="sp-dim">Abhi koi scan nahi — upar se scan karo.</div>'; return; }
    L.innerHTML = st.rows.slice(0, 300).map((r) => `<div class="sp-it${r.code === newCode ? ' new' : ''}"><div><span class="sp-ic">${esc(r.code)}</span><small>${esc(tm(r.at))}${r.pending ? ' · ⏳ bhej rahe…' : ''}</small></div><button class="sp-x" data-del="${esc(r.code)}" title="Hatao">✕</button></div>`).join('');
  }
  async function load() {
    try {
      const j = await api('GET', '/api/public/scan?name=' + encodeURIComponent(st.name));
      st.rows = [...st.pend.map((c) => ({ code: c, at: new Date().toISOString(), pending: true })), ...j.rows]; st.seen = new Set(st.rows.map((r) => r.code));
      paint();
    } catch (e) { note('List load nahi hui: ' + e.message, 'bad'); }
  }
  const savePend = () => { try { localStorage.setItem(PEND_KEY, JSON.stringify({ n: st.name, p: st.pend })); } catch { /* */ } };
  async function send(code) {
    try {
      const j = await api('POST', '/api/public/scan', { name: st.name, code });
      st.pend = st.pend.filter((c) => c !== code); savePend();
      const row = st.rows.find((r) => r.code === code); if (row) { row.pending = false; if (j.at) row.at = j.at; }
      if (j.dup && !j.mine) { st.rows = st.rows.filter((r) => r.code !== code); st.seen.delete(code); note(`⚠️ Ye barcode pehle hi ${j.by} ne scan kar diya (${tm(j.at)})`, 'bad'); beep('dup'); }
      paint();
    } catch (e) {
      if (e.status === 400) { st.pend = st.pend.filter((c) => c !== code); st.rows = st.rows.filter((r) => r.code !== code); st.seen.delete(code); savePend(); note(e.message, 'bad'); paint(); return; }
      if (!st.pend.includes(code)) st.pend.push(code); savePend(); note('Net slow — list me hai, apne aap dobara bhejega', 'bad'); setTimeout(flushPend, 5000);
    }
  }
  function flushPend() { st.pend.slice().forEach((c) => send(c)); }
  function add(code) {
    if (st.seen.has(code)) { note('Ye barcode list me pehle se hai', 'bad'); beep('dup'); const el = document.querySelector('.sp-it'); return false; }
    st.seen.add(code); st.rows.unshift({ code, at: new Date().toISOString(), pending: true }); paint(code); beep('ok'); try { navigator.vibrate && navigator.vibrate(30); } catch { /* */ }
    note('✅ ' + code + ' save', 'ok'); send(code); check(code); return true;
  }
  /* ⛔ galat barcode alert: issued / stock me nahi */
  async function check(code) {
    for (let i = 0; i < 4; i++) {
      try {
        const j = await api('POST', '/api/public/scan-info', { codes: [code] }); const x = (j.info || {})[code]; if (!x) return;
        if (x.k === 'iss' || x.k === 'nf') alertBox(code, x);
        return;
      } catch (e) { if (e.status && e.status < 500 && e.status !== 429) return; await new Promise((r) => setTimeout(r, 2500 * (i + 1))); }
    }
  }
  function alertBox(code, x) {
    let el = $('alert'); if (!el) { el = document.createElement('div'); el.id = 'alert'; el.className = 'sp-alert'; el.onclick = () => { el.hidden = true; }; document.body.appendChild(el); }
    const iss = x.k === 'iss'; el.className = 'sp-alert ' + (iss ? 'red' : 'amber');
    el.innerHTML = '<b>' + (iss ? '⛔ ISSUED — ye tag pehle hi lag chuka hai' : '⚠️ Stock me nahi mila') + '</b><span>' + esc(code) + (iss && x.agent ? ' · ' + esc(x.agent) : '') + '</span><small>Hatane ke liye tap karo</small>';
    el.hidden = false; clearTimeout(alertBox.t); alertBox.t = setTimeout(() => { el.hidden = true; }, 7000);
    beep('bad'); setTimeout(() => beep('bad'), 260); try { navigator.vibrate && navigator.vibrate([220, 90, 220, 90, 220]); } catch { /* */ }
  }
  /* ---- confirm popup (camera) ---- */
  function askConfirm(code) {
    st.hold = true; st.code = code;
    $('ccode').textContent = code; $('cdup').textContent = st.seen.has(code) ? '⚠️ Ye barcode list me pehle se hai' : '';
    $('conf').hidden = false; try { navigator.vibrate && navigator.vibrate(40); } catch { /* */ } $('yes').focus({ preventScroll: true });
  }
  function closeConfirm(save) {
    $('conf').hidden = true; const c = st.code; st.code = ''; st.hold = false;
    if (save && c) { st.last = { k: c, at: Date.now() }; add(c); } else st.last = { k: '', at: 0 };
    $('msg').textContent = st.cam.on ? 'Agla barcode scan karo' : '';
  }
  function onRaw(raw) {
    if (st.hold) return; const c = valid(raw); if (!c) return;
    if (st.last.k === c && Date.now() - st.last.at < 1800) { st.last.at = Date.now(); return; }
    askConfirm(c);
  }
  /* ---- camera ---- */
  function loadZ() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/zxing.min.js?v=1'; s.onload = () => (window.ZXing ? ok(window.ZXing) : no(new Error('lib'))); s.onerror = () => no(new Error('Scanner library load nahi hui')); document.head.appendChild(s); });
  }
  async function camStart() {
    if (st.cam.on) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Is browser me camera nahi (HTTPS chahiye)'); return; }
    $('camBox').hidden = false; $('cam').textContent = '⏹ Camera band karo'; $('msg').textContent = 'Camera khul raha hai…';
    const v = $('vid');
    try { st.cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false }); }
    catch (e) { camStop(); toast(e && e.name === 'NotAllowedError' ? 'Camera allow nahi hua — address bar ke 🔒 se Allow karo' : 'Camera start nahi hua'); return; }
    st.cam.on = true; v.srcObject = st.cam.stream; try { await v.play(); } catch { /* */ }
    try { const t = st.cam.stream.getVideoTracks()[0], caps = t.getCapabilities ? t.getCapabilities() : {}; $('tor').hidden = !caps.torch; if (caps.focusMode && caps.focusMode.includes('continuous')) t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}); st.cam.zmax = caps.zoom ? Math.min(4, caps.zoom.max || 1) : 1; st.cam.zoom = 1; $('zm').hidden = st.cam.zmax <= 1; $('zm').textContent = '🔍 1x'; } catch { /* */ }
    $('msg').textContent = 'Barcode ko frame ke beech me rakho';
    let native = false;
    if ('BarcodeDetector' in window) {
      try { const sup = await window.BarcodeDetector.getSupportedFormats(); const fm = ['code_128', 'code_39', 'code_93', 'itf', 'codabar'].filter((f) => sup.includes(f)); if (fm.length) { st.cam.det = new window.BarcodeDetector({ formats: fm }); native = true; } } catch { /* */ }
    }
    if (native) {
      const tick = async () => {
        if (!st.cam.on) return;
        if (!st.cam.busy && !st.hold && v.readyState >= 2 && !document.hidden) { st.cam.busy = true; try { (await st.cam.det.detect(v)).forEach((f) => onRaw(f.rawValue)); } catch { /* */ } st.cam.busy = false; }
        st.cam.timer = setTimeout(tick, 30);
      };
      tick();
    } else {
      try {
        const Z = await loadZ(); const h = new Map(); h.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.CODABAR]); h.set(Z.DecodeHintType.TRY_HARDER, true);
        st.cam.reader = new Z.BrowserMultiFormatReader(h, 60); st.cam.reader.decodeFromStream(st.cam.stream, v, (r) => { if (r && st.cam.on) onRaw(r.getText()); });
      } catch (e) { camStop(); toast('Scanner start nahi hua'); }
    }
  }
  function camStop() {
    st.cam.on = false; clearTimeout(st.cam.timer); try { if (st.cam.reader) st.cam.reader.reset(); } catch { /* */ }
    try { if (st.cam.stream) st.cam.stream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    st.cam.stream = null; st.cam.reader = null; st.cam.det = null; st.hold = false; $('conf').hidden = true; $('camBox').hidden = true; $('cam').textContent = '📷 Camera scan shuru'; $('tor').hidden = true;
  }
  /* ---- name gate ---- */
  function enter(name) {
    st.name = name; try { localStorage.setItem(NAME_KEY, name); } catch { /* */ }
    $('gate').hidden = true; $('app').hidden = false; $('who').hidden = false; $('who').textContent = '👤 ' + name;
    try { const p = JSON.parse(localStorage.getItem(PEND_KEY) || '{}'); st.pend = p.n === name && Array.isArray(p.p) ? p.p : []; } catch { st.pend = []; }
    load().then(flushPend); setInterval(() => { if (!document.hidden) load(); }, 20000);
  }
  function init() {
    try { st.sound = localStorage.getItem(SND_KEY) !== '0'; } catch { /* */ } $('snd').textContent = st.sound ? '🔊' : '🔇';
    let saved = ''; try { saved = localStorage.getItem(NAME_KEY) || ''; } catch { /* */ }
    $('nm').value = saved;
    const go = () => { const n = $('nm').value.replace(/\s+/g, ' ').trim(); if (n.length < 2) { $('gerr').textContent = 'Naam likhna zaroori hai (kam se kam 2 akshar).'; return; } enter(n); };
    $('go').onclick = go; $('nm').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    if (saved.trim().length >= 2) enter(saved.trim());
    $('who').onclick = () => { camStop(); $('app').hidden = true; $('who').hidden = true; $('gate').hidden = false; $('nm').focus(); };
    $('cam').onclick = () => (st.cam.on ? camStop() : camStart());
    $('snd').onclick = () => { st.sound = !st.sound; $('snd').textContent = st.sound ? '🔊' : '🔇'; try { localStorage.setItem(SND_KEY, st.sound ? '1' : '0'); } catch { /* */ } };
    $('zm').onclick = async () => { try { const steps = [1, 2, 3, 4].filter((z) => z <= st.cam.zmax); st.cam.zoom = steps[(steps.indexOf(st.cam.zoom) + 1) % steps.length] || 1; await st.cam.stream.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: st.cam.zoom }] }); $('zm').textContent = '🔍 ' + st.cam.zoom + 'x'; } catch { toast('Zoom nahi chala'); } };
    $('tor').onclick = async () => { try { st.cam.torch = !st.cam.torch; await st.cam.stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: st.cam.torch }] }); } catch { toast('Torch nahi chala'); } };
    $('yes').onclick = () => closeConfirm(true); $('no').onclick = () => closeConfirm(false);
    document.addEventListener('keydown', (e) => { if (!st.hold) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeConfirm(true); } else if (e.key === 'Escape') closeConfirm(false); });
    $('kb').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return; e.preventDefault();
      const raw = $('kb').value; $('kb').value = ''; if (!raw.trim()) return;
      raw.split(/[\n,;\s]+/).filter(Boolean).forEach((x) => { const c = valid(x); if (c) add(c); else { note('Ye 16-digit FASTag barcode nahi hai', 'bad'); beep('bad'); } });
    });
    $('rf').onclick = load;
    $('list').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-del]'); if (!b) return; const c = b.dataset.del;
      if (!window.confirm(c + ' list se hatana hai?')) return;
      try { await api('DELETE', '/api/public/scan', { name: st.name, code: c }); st.rows = st.rows.filter((r) => r.code !== c); st.seen.delete(c); paint(); } catch (er) { toast(er.message); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) camStop(); });
    window.addEventListener('pagehide', camStop);
  }
  init();
})();
