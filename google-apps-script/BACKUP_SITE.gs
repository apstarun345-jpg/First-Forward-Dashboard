/**
 * 🛟 ApnaPayment — BACKUP SITE (Apps Script web app)
 * Render band ho tab bhi dashboard (READ-ONLY) is Apps Script URL se chale.
 *
 * ⚠️ Naya ALAG Apps Script project banao (Storage wale Code.gs me paste MAT karo — dono me doGet hai).
 *
 * Kya chalega : Login (backup users) · Home · Tag Issued · Stock · Performance · Trend · Tag Request (dekhna) —
 *               sab data seedha Google Sheets se (gviz). Site ke saare page/CSS/JS Drive me roz copy hote hain.
 * Kya NAHI    : Live view, push/bell, robot, file upload, koi bhi save/edit (admin, tag request submit, settings).
 *
 * ONE-TIME SETUP
 *  1) Script Properties (Project Settings → Script properties):
 *       SITE_URL            = https://first-forward-dashboard.onrender.com
 *       APPS_SCRIPT_SECRET  = (Render ke env APPS_SCRIPT_SECRET wali wahi value)
 *       BACKUP_USERS        = {"tarun":"koi-password","office":"koi-dusra-password"}   (JSON)
 *  2) Editor me `bkSetup` ▶ Run (permission do). Ye Drive folder + roz ka auto-sync trigger banata hai
 *     aur pehla sync chalata hai. Agar "time budget" likhe to `bkSync` dobara Run karo (resume hota hai).
 *  3) Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone → Deploy → URL copy.
 *  4) URL kholo → BACKUP_USERS wale username/password se login.
 *
 * Roz sync hota hai (Render chal raha ho tab). Render band ho to last sync ki copy se chalta rahega.
 */
var BK = {
  FOLDER: 'ApnaPayment_Backup_Site',
  BUDGET_MS: 4 * 60 * 1000,
  CHUNK_BYTES: 900 * 1024,
  TOKEN_HOURS: 12,
  GVIZ: 'https://docs.google.com'
};

// ====================================================================== setup / sync
function bkProps_() { return PropertiesService.getScriptProperties(); }
function bkProp_(k, d) { var v = bkProps_().getProperty(k); return v == null || v === '' ? (d || '') : String(v); }
function bkSite_() { return bkProp_('SITE_URL', 'https://first-forward-dashboard.onrender.com').replace(/\/+$/, ''); }
function bkSecret_() { return bkProp_('APPS_SCRIPT_SECRET') || bkProp_('DASH_SECRET'); }

function bkSetup() {
  if (!bkSecret_()) throw new Error('Script property APPS_SCRIPT_SECRET set karo (Render wali wahi value).');
  if (!bkProp_('BACKUP_USERS')) throw new Error('Script property BACKUP_USERS set karo, jaise {"tarun":"password"}');
  JSON.parse(bkProp_('BACKUP_USERS'));
  bkFolder_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'bkSync') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('bkSync').timeBased().everyDays(1).atHour(3).create();
  return bkSync();
}

function bkFolder_() {
  var it = DriveApp.getFoldersByName(BK.FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BK.FOLDER);
}
function bkKey_(path) { return String(path).replace(/[^A-Za-z0-9._-]/g, '__'); }
function bkFile_(folder, name) { var it = folder.getFilesByName(name); return it.hasNext() ? it.next() : null; }
function bkWrite_(folder, name, content) {
  var f = bkFile_(folder, name);
  if (f) { f.setContent(content); return f; }
  return folder.createFile(name, content, MimeType.PLAIN_TEXT);
}
function bkRead_(name) {
  var f = bkFile_(bkFolder_(), name);
  return f ? f.getBlob().getDataAsString('UTF-8') : '';
}
function bkIsText_(path) { return /\.(js|css|svg|webmanifest|json|html)$/i.test(path); }

/** Render se snapshot + saare assets Drive me copy. Resume-safe: jo file same size ki ho use chhod deta hai. */
function bkSync() {
  var t0 = Date.now();
  var site = bkSite_(), folder = bkFolder_();
  var res = UrlFetchApp.fetch(site + '/api/backup/snapshot', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ secret: bkSecret_() })
  });
  if (res.getResponseCode() !== 200) throw new Error('Snapshot nahi mila (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  var snap = JSON.parse(res.getContentText());
  var html = UrlFetchApp.fetch(site + '/', { muteHttpExceptions: true });
  if (html.getResponseCode() !== 200) throw new Error('index.html nahi mila (' + html.getResponseCode() + ')');
  bkWrite_(folder, 'index.html.txt', html.getContentText());

  var sizes = {};
  try { sizes = JSON.parse(bkRead_('sizes.json') || '{}'); } catch (e) { sizes = {}; }
  var sameVer = sizes.__ver === snap.version;
  if (!sameVer) sizes = { __ver: snap.version };
  var todo = snap.assets.filter(function (a) { return !(sameVer && sizes[a.path] === a.size && bkFile_(folder, bkKey_(a.path))); });
  var done = 0;
  for (var i = 0; i < todo.length; i += 15) {
    if (Date.now() - t0 > BK.BUDGET_MS) break;
    var batch = todo.slice(i, i + 15);
    var reqs = batch.map(function (a) { return { url: site + '/' + a.path, muteHttpExceptions: true }; });
    var out = UrlFetchApp.fetchAll(reqs);
    out.forEach(function (r, j) {
      var a = batch[j];
      if (r.getResponseCode() !== 200) return;
      var key = bkKey_(a.path), old = bkFile_(folder, key);
      if (old) old.setTrashed(true);
      if (bkIsText_(a.path)) folder.createFile(key, r.getContentText(), MimeType.PLAIN_TEXT);
      else folder.createFile(r.getBlob().setName(key));
      sizes[a.path] = a.size; done++;
    });
    bkWrite_(folder, 'sizes.json', JSON.stringify(sizes));
  }
  var remaining = todo.length - done;
  // config snapshot sabse aakhir me: pura ho gaya tabhi version "complete" maana jaye
  snap.assetsComplete = remaining === 0;
  snap.syncedAt = new Date().toISOString();
  bkWrite_(folder, 'snapshot.json', JSON.stringify(snap));
  var msg = 'Backup sync: ' + done + ' files copy, ' + remaining + ' baaki, version ' + snap.version + (remaining ? ' — "bkSync" dobara Run karo.' : ' ✅ complete.');
  Logger.log(msg);
  return msg;
}

// ====================================================================== web app
function bkSnap_() {
  var c = CacheService.getScriptCache().get('bk_snap');
  if (c) { try { return JSON.parse(c); } catch (e) { /* fall through */ } }
  var raw = bkRead_('snapshot.json');
  if (!raw) return null;
  var s = JSON.parse(raw);
  try { var js = JSON.stringify({ version: s.version, assets: s.assets, user: s.user, settings: s.settings, publicSettings: s.publicSettings, permissions: s.permissions, tabs: s.tabs, sheetId: s.sheetId, syncedAt: s.syncedAt }); if (js.length < 95000) CacheService.getScriptCache().put('bk_snap', js, 600); } catch (e) { /* too big for cache */ }
  return s;
}

function doGet() {
  var snap = null;
  try { snap = bkSnap_(); } catch (e) { snap = null; }
  var idx = bkRead_('index.html.txt');
  if (!snap || !idx) {
    return HtmlService.createHtmlOutput('<body style="font-family:sans-serif;padding:24px"><h2>Backup site abhi taiyar nahi</h2><p>Apps Script editor me <b>bkSetup</b> / <b>bkSync</b> Run karo.</p></body>').setTitle('Backup site');
  }
  var scripts = [], styles = [];
  idx = idx.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, function (m, src) { scripts.push(bkNorm_(src)); return ''; });
  idx = idx.replace(/<link\b[^>]*>/gi, function (m) {
    if (/rel=["']stylesheet["']/i.test(m)) { var h = m.match(/href=["']([^"']+)["']/i); if (h) styles.push(bkNorm_(h[1])); return ''; }
    return /rel=["'](manifest|icon|apple-touch-icon|preload|modulepreload|prefetch)/i.test(m) ? '' : m;
  });
  idx = idx.replace(/<base\b[^>]*>/gi, '');
  var boot = {
    scripts: scripts, styles: styles, version: snap.version, syncedAt: snap.syncedAt || '',
    sizes: (snap.assets || []).reduce(function (o, a) { o[a.path] = a.size; return o; }, {}),
    chunk: BK.CHUNK_BYTES
  };
  var head = '<script>window.__BK=' + JSON.stringify(boot).replace(/</g, '\\u003c') + ';</script><script>' + bkClient_() + '</script>';
  if (/<head[^>]*>/i.test(idx)) idx = idx.replace(/<head[^>]*>/i, function (m) { return m + head; }); else idx = head + idx;
  var banner = '<div id="bk-banner" style="position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#7c2d12;color:#fff;font:12px/1.3 sans-serif;padding:4px 10px;text-align:center;opacity:.92">🛟 BACKUP MODE · sirf dekhne ke liye (save / live view / push band)' + (snap.syncedAt ? ' · data copy: ' + String(snap.syncedAt).slice(0, 16).replace('T', ' ') + ' UTC' : '') + '</div>';
  idx = /<\/body>/i.test(idx) ? idx.replace(/<\/body>/i, banner + '</body>') : idx + banner;
  return HtmlService.createHtmlOutput(idx).setTitle('ApnaPayment · Backup')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function bkNorm_(src) { return String(src).replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/^\.?\//, ''); }

// ---------------------------------------------------------------------- assets (browser → google.script.run)
/** names ki list → { name: text } (text files). Image/binary ke liye bkAssetB64. */
function bkAssets(names) {
  var folder = bkFolder_(), out = {}, total = 0;
  (names || []).slice(0, 60).forEach(function (n) {
    var f = bkFile_(folder, bkKey_(n));
    if (!f) { out[n] = null; return; }
    if (!bkIsText_(n)) { out[n] = { b64: Utilities.base64Encode(f.getBlob().getBytes()), mime: f.getBlob().getContentType() }; return; }
    var t = f.getBlob().getDataAsString('UTF-8'); total += t.length; out[n] = t;
  });
  return out;
}

// ---------------------------------------------------------------------- tokens + users
function bkSign_(s) {
  var sig = Utilities.computeHmacSha256Signature(s, bkSecret_() + '|bk');
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}
function bkMakeToken_(user) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify({ u: user, e: Date.now() + BK.TOKEN_HOURS * 3600e3 })).replace(/=+$/, '');
  return body + '.' + bkSign_(body);
}
function bkTokenUser_(token) {
  try {
    var parts = String(token || '').split('.');
    if (parts.length !== 2 || bkSign_(parts[0]) !== parts[1]) return '';
    var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    return p.e > Date.now() ? String(p.u) : '';
  } catch (e) { return ''; }
}
function bkUsers_() { try { return JSON.parse(bkProp_('BACKUP_USERS', '{}')); } catch (e) { return {}; } }
function bkUserObj_(snap, name) {
  var u = JSON.parse(JSON.stringify(snap.user || {}));
  u.username = name; u.name = name; u.role = 'user'; u.approved = true; u.mustChangePassword = false;
  return u;
}

// ---------------------------------------------------------------------- API (browser fetch('/api/...') yahin aata hai)
function bkJson_(status, obj) { return { status: status, ct: 'application/json', body: JSON.stringify(obj) }; }

function bkApi(token, method, path, bodyStr) {
  method = String(method || 'GET').toUpperCase();
  var q = String(path || '').split('?'), route = q[0], query = q.slice(1).join('?');
  var snap = bkSnap_();
  if (!snap) return bkJson_(503, { error: 'Backup abhi sync nahi hua — bkSync Run karo.' });
  var user = bkTokenUser_(token);
  var body = {}; try { body = bodyStr ? JSON.parse(bodyStr) : {}; } catch (e) { body = {}; }

  if (route === '/api/auth/me') {
    return bkJson_(200, { user: user ? bkUserObj_(snap, user) : null, settings: user ? snap.settings : (snap.publicSettings || snap.settings), permissions: snap.permissions, tabs: snap.tabs, backup: true });
  }
  if (route === '/api/auth/login' && method === 'POST') {
    var id = String(body.username || '').trim().toLowerCase(), users = bkUsers_(), pw = String(body.password || '');
    var found = ''; Object.keys(users).forEach(function (k) { if (k.toLowerCase() === id) found = k; });
    if (!found || String(users[found]) !== pw) { Utilities.sleep(700); return bkJson_(401, { error: 'Invalid login — backup username / password check karo.' }); }
    return bkJson_(200, { ok: true, user: bkUserObj_(snap, found), settings: snap.settings, permissions: snap.permissions, tabs: snap.tabs, token: bkMakeToken_(found), backup: true });
  }
  if (route === '/api/auth/logout') return bkJson_(200, { ok: true });
  if (route === '/api/health') return bkJson_(200, { ok: true, backup: true, version: snap.version, syncedAt: snap.syncedAt || '', storage: { backend: 'backup', durable: false, error: null } });
  if (route === '/api/version') return bkJson_(200, { version: snap.version, backup: true });

  if (!user) return bkJson_(401, { error: 'Login required' });

  if (route === '/api/gviz' && method === 'GET') return bkGviz_(query, snap);
  if (route === '/api/settings' && method === 'GET') return bkJson_(200, { settings: snap.settings });

  if (method !== 'GET') return bkJson_(503, { error: 'Backup mode: ye kaam (save / edit) abhi available nahi — Render chalne par karo.', backup: true });
  // baaki sab GET (notifications, presence, live…) — khali jawab, page todna nahi
  return bkJson_(200, { ok: true, backup: true, items: [], notifications: [], unread: 0, rows: [], data: null });
}

/** /api/gviz?sheet=…&gid=…&tq=…&range=…&headers=…&id=… → Google gviz (server.js upstreamUrl ka chhota rup). */
function bkGviz_(query, snap) {
  var p = {};
  String(query || '').split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); var k = i < 0 ? kv : kv.slice(0, i); var v = i < 0 ? '' : kv.slice(i + 1); try { p[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { p[k] = v; } });
  var parts = ['tqx=' + encodeURIComponent('out:json')];
  if (p.gid) parts.push('gid=' + encodeURIComponent(p.gid)); else if (p.sheet) parts.push('sheet=' + encodeURIComponent(p.sheet));
  if (p.tq) parts.push('tq=' + encodeURIComponent(p.tq));
  if (p.headers && /^\d{1,2}$/.test(p.headers)) parts.push('headers=' + p.headers);
  var range = p.range || '';
  if (!range) {
    var own = !p.id || String(p.id).replace(/[^A-Za-z0-9_-]/g, '') === String(snap.sheetId || '');
    var tabs = snap.tabs || [];
    var tm = own ? tabs.filter(function (t) { return t && ((p.sheet && (t.tab === p.sheet || t.id === p.sheet)) || (p.gid && String(t.gid) === String(p.gid))); })[0] : null;
    if (tm && tm.range) range = tm.range;
    else if (tm && (tm.startCol || tm.startRow || tm.endCol || tm.endRow)) {
      var from = (tm.startCol || 'A') + (tm.startRow || 1), end = (tm.endCol || '') + (tm.endRow || '');
      range = end ? from + ':' + end : (from === 'A1' ? '' : from + ':ZZZ');
    }
  }
  if (/^[A-Z]+[0-9]+:$/i.test(range)) range = range.toUpperCase() === 'A1:' ? '' : range + 'ZZZ';
  if (range) parts.push('range=' + encodeURIComponent(String(range).slice(0, 40).replace(/[^A-Za-z0-9:$]/g, '')));
  var sid = String(p.id || snap.sheetId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!sid) return bkJson_(502, { error: 'Sheet id nahi mila (snapshot).' });
  var url = BK.GVIZ + '/spreadsheets/d/' + sid + '/gviz/tq?' + parts.join('&');
  var key = 'g_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url)).slice(0, 40);
  var cache = CacheService.getScriptCache(), hit = cache.get(key);
  if (hit) return { status: 200, ct: 'text/plain; charset=utf-8', body: hit };
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var text = r.getContentText();
  if (r.getResponseCode() !== 200 || /^\s*</.test(text)) return bkJson_(502, { error: 'Google Sheets ne data nahi diya (' + r.getResponseCode() + '). Sheet public hai?' });
  if (text.length < 90000) { try { cache.put(key, text, 300); } catch (e) { /* skip */ } }
  return { status: 200, ct: 'text/plain; charset=utf-8', body: text };
}

// ====================================================================== browser side (shell me inline chalta hai)
function bkClient_() {
  return String.raw`
(function(){
  var B = window.__BK || {};
  var TOKEN = '';
  try { TOKEN = sessionStorage.getItem('bk_token') || ''; } catch (e) {}
  var run = function () { return google.script.run; };
  function call(fn, args) {
    return new Promise(function (resolve, reject) {
      var r = run().withSuccessHandler(resolve).withFailureHandler(function (e) { reject(new Error(e && e.message || String(e))); });
      r[fn].apply(r, args);
    });
  }
  var cache = {};        // path -> text | {b64,mime}
  var inflight = {};
  function norm(u) { return String(u || '').replace(/^https?:\/\/[^\/]+/i, '').replace(/[?#].*$/, '').replace(/^\.?\//, ''); }
  function load(names) {
    var need = names.filter(function (n) { return cache[n] === undefined; });
    var groups = [], cur = [], size = 0;
    need.forEach(function (n) {
      var s = B.sizes && B.sizes[n] || 20000;
      if (cur.length && (size + s > B.chunk || cur.length >= 50)) { groups.push(cur); cur = []; size = 0; }
      cur.push(n); size += s;
    });
    if (cur.length) groups.push(cur);
    var jobs = groups.map(function (g) {
      var key = g.join('|');
      if (!inflight[key]) inflight[key] = call('bkAssets', [g]).then(function (res) { g.forEach(function (n) { cache[n] = res[n] == null ? null : res[n]; }); });
      return inflight[key];
    });
    // thodi parallelism: 3 ek saath
    return Promise.all(jobs);
  }
  function one(path) { return load([path]).then(function () { return cache[path]; }); }
  window.__bkLoad = load;

  // ---------------- fetch shim: /api/* → Apps Script, static file → Drive copy
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  function mkResp(r) { return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.ct || 'application/json' } }); }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var a = document.createElement('a'); a.href = url;
    var isLocal = a.host === location.host || url.charAt(0) === '/' || !/^[a-z]+:/i.test(url);
    if (isLocal && /^\/?api\//.test(a.pathname.replace(/^\/+/, '/').replace(/^\//, ''))) {
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var body = init && init.body ? (typeof init.body === 'string' ? init.body : '') : '';
      var path = a.pathname.replace(/^.*?(\/api\/)/, '/api/') + (a.search || '');
      return call('bkApi', [TOKEN, method, path, body]).then(function (r) {
        try { var j = JSON.parse(r.body); if (j && j.token) { TOKEN = j.token; try { sessionStorage.setItem('bk_token', TOKEN); } catch (e) {} } } catch (e) {}
        if (/\/api\/auth\/logout/.test(path)) { TOKEN = ''; try { sessionStorage.removeItem('bk_token'); } catch (e) {} }
        return mkResp(r);
      }).catch(function (e) { return new Response(JSON.stringify({ error: 'Backup server: ' + e.message }), { status: 502, headers: { 'Content-Type': 'application/json' } }); });
    }
    if (isLocal && B.sizes && B.sizes[norm(url)] !== undefined) {
      return one(norm(url)).then(function (t) { return typeof t === 'string' ? new Response(t) : new Response('', { status: 404 }); });
    }
    return realFetch ? realFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
  };
  window.EventSource = function () { return { close: function () {}, addEventListener: function () {}, removeEventListener: function () {}, readyState: 2 }; };
  try { navigator.sendBeacon = function () { return true; }; } catch (e) {}
  try { Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true }); } catch (e) {}

  // ---------------- lazy <script src> / <link rel=stylesheet>: Drive copy se inline chalao
  function runScript(text, el) {
    var s = document.createElement('script');
    s.text = text + '\n//# sourceURL=bk/' + (el && el.getAttribute && norm(el.getAttribute('src')) || 'inline');
    origAppend.call(document.head, s);
  }
  function fire(el, type) { try { var h = el['on' + type]; if (typeof h === 'function') h.call(el, new Event(type)); el.dispatchEvent(new Event(type)); } catch (e) {} }
  var origAppend = Node.prototype.appendChild, origInsert = Node.prototype.insertBefore;
  function intercept(node) {
    if (!node || node.nodeType !== 1) return false;
    var tag = node.tagName;
    if (tag === 'SCRIPT' && node.getAttribute('src') && !node.__bk) {
      var p = norm(node.getAttribute('src'));
      if (B.sizes && B.sizes[p] === undefined) return false;
      node.__bk = 1;
      one(p).then(function (t) { if (typeof t === 'string') { runScript(t, node); fire(node, 'load'); } else fire(node, 'error'); }).catch(function () { fire(node, 'error'); });
      return true;
    }
    if (tag === 'LINK' && /stylesheet/i.test(node.getAttribute('rel') || '') && node.getAttribute('href') && !node.__bk) {
      var h = norm(node.getAttribute('href'));
      if (B.sizes && B.sizes[h] === undefined) return false;
      node.__bk = 1;
      one(h).then(function (t) { if (typeof t === 'string') { var st = document.createElement('style'); st.textContent = t; origAppend.call(document.head, st); fire(node, 'load'); } else fire(node, 'error'); });
      return true;
    }
    return false;
  }
  Node.prototype.appendChild = function (n) { return intercept(n) ? n : origAppend.call(this, n); };
  Node.prototype.insertBefore = function (n, ref) { return intercept(n) ? n : origInsert.call(this, n, ref); };
  var origElAppend = Element.prototype.append;
  Element.prototype.append = function () { var self = this, rest = []; Array.prototype.forEach.call(arguments, function (n) { if (!intercept(n)) rest.push(n); }); if (rest.length) origElAppend.apply(self, rest); };

  // ---------------- boot: sab css + deferred scripts Drive se laao, order me chalao
  var loading = document.createElement('div');
  loading.id = 'bk-loading';
  loading.style.cssText = 'position:fixed;inset:0;z-index:2147483001;display:grid;place-items:center;background:#0b1020;color:#e2e8f0;font:15px/1.5 sans-serif;text-align:center';
  loading.innerHTML = '<div><div style="font-size:34px">🛟</div><b>Backup site khul rahi hai…</b><div id="bk-pct" style="opacity:.7;margin-top:6px">0%</div></div>';
  function start() {
    (document.body || document.documentElement).appendChild(loading);
    var all = (B.styles || []).concat(B.scripts || []);
    var done = 0, groupsDone = function () { done++; var el = document.getElementById('bk-pct'); if (el) el.textContent = Math.min(99, Math.round(done / Math.max(1, all.length / 12) * 100)) + '%'; };
    var chunks = [], i = 0;
    for (; i < all.length; i += 8) chunks.push(all.slice(i, i + 8));
    var p = Promise.resolve();
    // 3-3 chunk ek saath (parallel), result cache me
    var par = [];
    for (i = 0; i < chunks.length; i += 3) par.push(chunks.slice(i, i + 3));
    par.forEach(function (grp) { p = p.then(function () { return Promise.all(grp.map(function (c) { return load(c).then(groupsDone); })); }); });
    p.then(function () {
      (B.styles || []).forEach(function (s) { var t = cache[s]; if (typeof t === 'string') { var st = document.createElement('style'); st.textContent = t; origAppend.call(document.head, st); } });
      (B.scripts || []).forEach(function (s) {
        var t = cache[s];
        if (typeof t !== 'string') { try { console.warn('backup: asset missing', s); } catch (e) {} return; }
        try { var sc = document.createElement('script'); sc.text = t + '\n//# sourceURL=bk/' + s; origAppend.call(document.head, sc); } catch (e) { try { console.error('backup script error', s, e); } catch (e2) {} }
      });
      // scripts DOM-ready ke baad chali — unke DOMContentLoaded listeners ko ek baar bula do
      try { document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true })); } catch (e) {}
      try { window.dispatchEvent(new Event('load')); } catch (e) {}
      setTimeout(function () { var l = document.getElementById('bk-loading'); if (l) l.remove(); }, 400);
    }).catch(function (e) {
      loading.innerHTML = '<div><div style="font-size:34px">⚠️</div><b>Backup site load nahi hui</b><div style="opacity:.7;margin-top:6px">' + String(e && e.message || e).slice(0, 160) + '</div></div>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
`;
}
