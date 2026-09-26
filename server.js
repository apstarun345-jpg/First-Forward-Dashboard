// First Forward Dashboard — zero-dependency Node server.
//  • Serves the static app
//  • Proxies + caches Google Sheets gviz queries (/api/gviz) — login required
//  • Login / signup, sessions, per-user permissions (/api/auth/*, /api/users)
//  • Dashboard settings (branding, sheet mapping, thresholds, contacts) (/api/settings)
// Data (users, sessions, settings) is stored as JSON files in DATA_DIR (default ./data).
// Run locally:  npm start   (PORT defaults to 8080; Render sets PORT automatically)
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DEFAULT_SHEET_ID = process.env.SHEET_ID || '1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc';
const DEFAULT_CACHE_SECONDS = Math.max(0, Number(process.env.CACHE_SECONDS || 600));
const MAX_CACHE_ENTRIES = 400;
const UPSTREAM_TIMEOUT_MS = 45_000;
const GVIZ_BASE = process.env.GVIZ_BASE || 'https://docs.google.com'; // override only for local testing with a mock
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const FRAME_PROTECTION = process.env.FRAME_PROTECTION === '1';
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 30));
// Admin bootstrap: ADMIN_USER / ADMIN_PASSWORD (recommended on Render). If no user exists and no env is set,
// a default admin (admin / admin123) is created and must change its password.
const ADMIN_USER = (process.env.ADMIN_USER || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_BODY = 6 * 1024 * 1024; // settings may carry two base64 images

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8'
};
const BLOCKED_FILES = new Set(['server.js', 'package.json', 'package-lock.json', 'render.yaml', 'README.md', '.env']);
const BLOCKED_DIRS = new Set(['data', 'dev', 'node_modules', '.git']);

// ---------------------------------------------------------------------------------------------
// Permissions & settings schema
// ---------------------------------------------------------------------------------------------
export const PERMISSIONS = [
  { key: 'dashboard', label: 'Dashboard page', group: 'Pages' },
  { key: 'trend', label: 'Trend page', group: 'Pages' },
  { key: 'stock', label: 'Stock page', group: 'Pages' },
  { key: 'performance', label: 'Performance page', group: 'Pages' },
  { key: 'sheet:StockDataa', label: 'Sheet · StockDataa', group: 'Pages' },
  { key: 'sheet:REPORT', label: 'Sheet · REPORT', group: 'Pages' },
  { key: 'export', label: 'Download CSV / Excel', group: 'Actions' },
  { key: 'share', label: 'WhatsApp / Email share', group: 'Actions' },
  { key: 'refresh', label: 'Force refresh from Google', group: 'Actions' },
  { key: 'contacts', label: 'See mobile numbers', group: 'Actions' }
];
const ALL_PERMS = PERMISSIONS.map((p) => p.key);
const DEFAULT_USER_PERMS = ['dashboard', 'trend', 'stock', 'performance', 'sheet:StockDataa', 'sheet:REPORT', 'export'];

const DEFAULT_SETTINGS = {
  appName: 'First Forward Dashboard',
  brand: 'First Forward',
  tagline: 'Dashboard',
  logo: '',          // data URL (uploaded in Settings → Branding)
  loginImage: '',    // data URL (login page / hero image)
  theme: { sidebarBg: '#1e1b4b', sidebarBg2: '#4c1d95', sidebarText: '#e0e7ff', accent: '#6366f1', accent2: '#a855f7' },
  sheetId: DEFAULT_SHEET_ID,
  reportGid: '242489821',
  stockSheet: 'StockDataa',
  stockGid: '',
  eirSheet: 'EIR',
  eir: { tagId: 'A', vrn: 'B', cls: 'D', type: 'P', status: 'Z', date: 'AA', agentId: 'J', agentName: 'L', masterId: 'AU', tlId: 'AV', gvId: 'AW', gvName: 'AX', gvTl: 'AZ', tlName: 'BA', vrnType: 'BC', monthName: 'BD', regNumber: 'BH', gvMasterId: '5845036', gvChannelTl: 'ApnaPayment Pvt. Ltd.' },
  stock: { id: 'A', name: 'B', tagId: 'C', barcode: 'D', cls: 'E', tagType: 'F', bcAllocatedAt: 'G', agentId: 'H', agentName: 'I', agentAllocatedAt: 'J', tlName: 'K' },
  excludeTls: ['APS'],
  thresholds: { coverRed: 7, coverOrange: 15, coverAmber: 30, inactiveDays: 3, topN: 10 },
  contacts: { teamWhatsapp: '', teamEmail: '', teamGroupLink: '', signature: 'Team First Forward' },
  cacheSeconds: DEFAULT_CACHE_SECONDS,
  pageSize: 50,
  allowSignup: true,
  updatedAt: null,
  updatedBy: null
};

// ---------------------------------------------------------------------------------------------
// JSON file store
// ---------------------------------------------------------------------------------------------
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const FILES = { users: path.join(DATA_DIR, 'users.json'), sessions: path.join(DATA_DIR, 'sessions.json'), settings: path.join(DATA_DIR, 'settings.json') };
const db = { users: [], sessions: {}, settings: { ...DEFAULT_SETTINGS } };
const writeQueue = new Map();

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
function persist(kind) {
  const file = FILES[kind];
  const prev = writeQueue.get(kind) || Promise.resolve();
  const next = prev.then(async () => {
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db[kind], null, 2));
    await fs.rename(tmp, file);
  }).catch((err) => console.error(`persist ${kind} failed:`, err.message));
  writeQueue.set(kind, next);
  return next;
}
function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch === undefined ? base : patch;
  if (base && typeof base === 'object' && patch && typeof patch === 'object') {
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
    return out;
  }
  return patch === undefined ? base : patch;
}

// ---------------------------------------------------------------------------------------------
// Passwords, sessions, users
// ---------------------------------------------------------------------------------------------
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return `${s}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}
const normUser = (u) => String(u || '').trim().toLowerCase().replace(/[^a-z0-9._@-]/g, '').slice(0, 60);
function publicUser(u) {
  if (!u) return null;
  return { username: u.username, name: u.name || u.username, email: u.email || '', mobile: u.mobile || '', role: u.role, approved: !!u.approved, permissions: u.role === 'admin' ? ALL_PERMS : (u.permissions || []), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, mustChangePassword: !!u.mustChangePassword };
}
function findUser(username) { return db.users.find((u) => u.username === normUser(username)) || null; }
function sha(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function createSession(username) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions[sha(token)] = { username, createdAt: Date.now(), expiresAt: Date.now() + SESSION_DAYS * 86400e3 };
  pruneSessions();
  persist('sessions');
  return token;
}
function pruneSessions() {
  const now = Date.now();
  for (const [k, s] of Object.entries(db.sessions)) if (!s || s.expiresAt < now) delete db.sessions[k];
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); });
  return out;
}
function sessionUser(req) {
  const token = parseCookies(req).ff_sid;
  if (!token) return null;
  const s = db.sessions[sha(token)];
  if (!s || s.expiresAt < Date.now()) return null;
  const u = findUser(s.username);
  if (!u || !u.approved) return null;
  return u;
}
function isSecure(req) { return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'; }
function cookieHeader(req, token, maxAgeSec) {
  return `ff_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isSecure(req) ? '; Secure' : ''}`;
}
async function bootstrapAdmin() {
  if (ADMIN_USER && ADMIN_PASSWORD) {
    let u = findUser(ADMIN_USER);
    if (!u) { u = { username: ADMIN_USER, name: 'Admin', createdAt: new Date().toISOString() }; db.users.unshift(u); }
    u.role = 'admin'; u.approved = true; u.permissions = ALL_PERMS.slice(); u.mustChangePassword = false;
    if (!verifyPassword(ADMIN_PASSWORD, u.password)) u.password = hashPassword(ADMIN_PASSWORD);
    await persist('users');
    console.log(`Admin "${ADMIN_USER}" ready (from environment).`);
  } else if (!db.users.some((u) => u.role === 'admin')) {
    const username = 'admin';
    if (!findUser(username)) {
      db.users.unshift({ username, name: 'Admin', role: 'admin', approved: true, permissions: ALL_PERMS.slice(), password: hashPassword('admin123'), mustChangePassword: true, createdAt: new Date().toISOString() });
      await persist('users');
      console.log('⚠️  No admin found → created default admin  user: admin  password: admin123  (change it in Settings → My account, or set ADMIN_USER / ADMIN_PASSWORD env).');
    }
  }
}

// login throttle (per IP)
const attempts = new Map();
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?'; }
function throttled(ip) { const a = attempts.get(ip); return a && a.count >= 8 && Date.now() - a.at < 10 * 60e3; }
function noteFail(ip) { const a = attempts.get(ip) || { count: 0, at: Date.now() }; if (Date.now() - a.at > 10 * 60e3) { a.count = 0; } a.count++; a.at = Date.now(); attempts.set(ip, a); }

// ---------------------------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------------------------
function headers(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(FRAME_PROTECTION ? { 'X-Frame-Options': 'SAMEORIGIN' } : {}),
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://docs.google.com",
    ...extra
  };
}
function sendJson(res, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, headers({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...extra }));
  res.end(body);
}
function sendText(res, status, text, extra = {}) {
  res.writeHead(status, headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...extra }));
  res.end(text);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ---------------------------------------------------------------------------------------------
// gviz proxy
// ---------------------------------------------------------------------------------------------
const cache = new Map();   // url → { at, body, status }
const inflight = new Map(); // url → Promise
const cacheMs = () => Math.max(0, Number(db.settings.cacheSeconds ?? DEFAULT_CACHE_SECONDS)) * 1000;

function upstreamUrl(params) {
  const p = new URLSearchParams();
  p.set('tqx', 'out:json');
  const gid = params.get('gid');
  const sheet = params.get('sheet');
  if (gid) p.set('gid', gid); else if (sheet) p.set('sheet', sheet);
  const tq = params.get('tq');
  if (tq) p.set('tq', tq);
  const sheetId = (params.get('id') || db.settings.sheetId || DEFAULT_SHEET_ID).replace(/[^A-Za-z0-9_-]/g, '');
  return `${GVIZ_BASE}/spreadsheets/d/${sheetId}/gviz/tq?${p.toString()}`;
}
async function fetchUpstream(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'FirstForwardDashboard/2.0' } });
    const body = await response.text();
    return { status: response.status, body };
  } finally { clearTimeout(timer); }
}
function sendCached(res, entry, tag) {
  res.writeHead(200, headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cache': tag, 'X-FF-Source': 'proxy', 'X-FF-Age': String(Math.round((Date.now() - entry.at) / 1000)) }));
  res.end(entry.body);
}
async function handleGviz(res, params) {
  const fresh = params.get('fresh') === '1';
  const url = upstreamUrl(params);
  const hit = cache.get(url);
  if (hit && !fresh && Date.now() - hit.at < cacheMs()) return sendCached(res, hit, 'HIT');
  try {
    let p = inflight.get(url);
    if (!p) { p = fetchUpstream(url).finally(() => inflight.delete(url)); inflight.set(url, p); }
    const { status, body } = await p;
    if (status >= 200 && status < 300 && body.includes('setResponse')) {
      const entry = { at: Date.now(), body, status };
      cache.set(url, entry);
      if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
      return sendCached(res, entry, 'MISS');
    }
    if (hit) return sendCached(res, hit, 'STALE');
    if (!(status >= 200 && status < 300)) return sendJson(res, 502, { error: `Google Sheets responded ${status}. Sheet public ("Anyone with the link") hai?` });
    res.writeHead(200, headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cache': 'MISS', 'X-FF-Source': 'proxy' }));
    return res.end(body);
  } catch (error) {
    if (hit) return sendCached(res, hit, 'STALE');
    return sendJson(res, 502, { error: `Google Sheet se data nahi mila: ${error.name === 'AbortError' ? 'timeout' : error.message}` });
  }
}

// ---------------------------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------------------------
function publicSettings() {
  const s = db.settings;
  return { appName: s.appName, brand: s.brand, tagline: s.tagline, logo: s.logo, loginImage: s.loginImage, theme: s.theme, allowSignup: s.allowSignup !== false };
}
function requireAdmin(user) { if (!user || user.role !== 'admin') throw new HttpError(403, 'Admin access required'); }
function validPassword(pw) { return typeof pw === 'string' && pw.length >= 6 && pw.length <= 200; }

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  const user = sessionUser(req);

  if (p === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, service: 'first-forward-dashboard', version: 2, users: db.users.length, cached: cache.size, cacheSeconds: cacheMs() / 1000, dataDir: DATA_DIR });
  }
  if (p === '/api/public-config' && method === 'GET') return sendJson(res, 200, publicSettings());

  // ---- auth ----
  if (p === '/api/auth/me' && method === 'GET') {
    return sendJson(res, 200, { user: publicUser(user), settings: user ? db.settings : publicSettings(), permissions: PERMISSIONS });
  }
  if (p === '/api/auth/signup' && method === 'POST') {
    if (db.settings.allowSignup === false && db.users.length) throw new HttpError(403, 'Sign up band hai — admin se account maango.');
    const body = await readBody(req);
    const username = normUser(body.username);
    if (username.length < 3) throw new HttpError(400, 'Username kam se kam 3 characters (a-z, 0-9, . _ -) ka ho.');
    if (!validPassword(body.password)) throw new HttpError(400, 'Password kam se kam 6 characters ka ho.');
    if (findUser(username)) throw new HttpError(409, 'Ye username pehle se hai. Login karo ya dusra username lo.');
    const first = db.users.length === 0;
    const u = { username, name: String(body.name || '').trim().slice(0, 80) || username, email: String(body.email || '').trim().slice(0, 120), mobile: String(body.mobile || '').replace(/[^\d+]/g, '').slice(0, 16), role: first ? 'admin' : 'user', approved: first, permissions: first ? ALL_PERMS.slice() : [], password: hashPassword(body.password), createdAt: new Date().toISOString(), lastLoginAt: null };
    db.users.push(u);
    await persist('users');
    if (first) {
      const token = createSession(username);
      u.lastLoginAt = new Date().toISOString(); persist('users');
      return sendJson(res, 200, { ok: true, user: publicUser(u), settings: db.settings, permissions: PERMISSIONS, first: true }, { 'Set-Cookie': cookieHeader(req, token, SESSION_DAYS * 86400) });
    }
    return sendJson(res, 200, { ok: true, pending: true, message: 'Account ban gaya. Admin approve karega, phir login kar paoge.' });
  }
  if (p === '/api/auth/login' && method === 'POST') {
    const ip = clientIp(req);
    if (throttled(ip)) throw new HttpError(429, 'Bahut galat attempts — 10 minute baad try karo.');
    const body = await readBody(req);
    const u = findUser(body.username);
    if (!u || !verifyPassword(body.password || '', u.password)) { noteFail(ip); throw new HttpError(401, 'Username ya password galat hai.'); }
    if (!u.approved) throw new HttpError(403, 'Account abhi admin approval ke wait me hai.');
    attempts.delete(ip);
    const token = createSession(u.username);
    u.lastLoginAt = new Date().toISOString(); persist('users');
    return sendJson(res, 200, { ok: true, user: publicUser(u), settings: db.settings, permissions: PERMISSIONS }, { 'Set-Cookie': cookieHeader(req, token, SESSION_DAYS * 86400) });
  }
  if (p === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(req).ff_sid;
    if (token) { delete db.sessions[sha(token)]; persist('sessions'); }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
  }

  if (!user) throw new HttpError(401, 'Login required');

  if (p === '/api/auth/password' && method === 'POST') {
    const body = await readBody(req);
    if (!verifyPassword(body.current || '', user.password)) throw new HttpError(400, 'Current password galat hai.');
    if (!validPassword(body.next)) throw new HttpError(400, 'Naya password kam se kam 6 characters ka ho.');
    user.password = hashPassword(body.next); user.mustChangePassword = false;
    await persist('users');
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }
  if (p === '/api/auth/profile' && method === 'POST') {
    const body = await readBody(req);
    if (body.name !== undefined) user.name = String(body.name).trim().slice(0, 80) || user.username;
    if (body.email !== undefined) user.email = String(body.email).trim().slice(0, 120);
    if (body.mobile !== undefined) user.mobile = String(body.mobile).replace(/[^\d+]/g, '').slice(0, 16);
    await persist('users');
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }

  // ---- gviz ----
  if (p === '/api/gviz' && method === 'GET') {
    if (url.searchParams.get('fresh') === '1' && user.role !== 'admin' && !(user.permissions || []).includes('refresh')) url.searchParams.delete('fresh');
    return handleGviz(res, url.searchParams);
  }

  // ---- settings ----
  if (p === '/api/settings' && method === 'GET') return sendJson(res, 200, { settings: db.settings, defaults: DEFAULT_SETTINGS });
  if (p === '/api/settings' && method === 'PUT') {
    requireAdmin(user);
    const body = await readBody(req);
    const patch = body && typeof body === 'object' ? (body.settings || body) : {};
    delete patch.updatedAt; delete patch.updatedBy;
    for (const key of ['logo', 'loginImage']) {
      if (patch[key] && !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(patch[key])) throw new HttpError(400, `${key}: sirf PNG/JPG/WEBP/SVG image (data URL) allowed.`);
      if (patch[key] && patch[key].length > 2.5 * 1024 * 1024) throw new HttpError(400, `${key}: image 1.8 MB se chhoti rakho.`);
    }
    if (patch.excludeTls !== undefined && !Array.isArray(patch.excludeTls)) patch.excludeTls = String(patch.excludeTls).split(',').map((s) => s.trim()).filter(Boolean);
    const next = body.reset ? { ...DEFAULT_SETTINGS } : deepMerge(db.settings, patch);
    next.updatedAt = new Date().toISOString(); next.updatedBy = user.username;
    if (next.sheetId !== db.settings.sheetId || next.cacheSeconds !== db.settings.cacheSeconds) cache.clear();
    db.settings = next;
    await persist('settings');
    return sendJson(res, 200, { ok: true, settings: db.settings });
  }
  if (p === '/api/cache/clear' && method === 'POST') { requireAdmin(user); cache.clear(); return sendJson(res, 200, { ok: true }); }

  // ---- users (admin) ----
  if (p === '/api/users' && method === 'GET') { requireAdmin(user); return sendJson(res, 200, { users: db.users.map(publicUser), permissions: PERMISSIONS, defaults: DEFAULT_USER_PERMS }); }
  if (p === '/api/users' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    const username = normUser(body.username);
    if (username.length < 3) throw new HttpError(400, 'Username kam se kam 3 characters ka ho.');
    if (findUser(username)) throw new HttpError(409, 'Username pehle se hai.');
    if (!validPassword(body.password)) throw new HttpError(400, 'Password kam se kam 6 characters ka ho.');
    const perms = Array.isArray(body.permissions) ? body.permissions.filter((k) => ALL_PERMS.includes(k)) : DEFAULT_USER_PERMS.slice();
    const u = { username, name: String(body.name || '').trim().slice(0, 80) || username, email: String(body.email || '').trim().slice(0, 120), mobile: String(body.mobile || '').replace(/[^\d+]/g, '').slice(0, 16), role: body.role === 'admin' ? 'admin' : 'user', approved: body.approved !== false, permissions: perms, password: hashPassword(body.password), mustChangePassword: true, createdAt: new Date().toISOString(), lastLoginAt: null };
    db.users.push(u); await persist('users');
    return sendJson(res, 200, { ok: true, user: publicUser(u) });
  }
  const um = p.match(/^\/api\/users\/([^/]+)$/);
  if (um) {
    requireAdmin(user);
    const target = findUser(decodeURIComponent(um[1]));
    if (!target) throw new HttpError(404, 'User nahi mila');
    if (method === 'PUT') {
      const body = await readBody(req);
      const admins = db.users.filter((u) => u.role === 'admin' && u.approved).length;
      if (body.role !== undefined) {
        const role = body.role === 'admin' ? 'admin' : 'user';
        if (target.role === 'admin' && role !== 'admin' && admins <= 1) throw new HttpError(400, 'Kam se kam ek admin rehna chahiye.');
        target.role = role;
      }
      if (body.approved !== undefined) {
        if (target.role === 'admin' && !body.approved && admins <= 1) throw new HttpError(400, 'Aakhri admin ko disable nahi kar sakte.');
        target.approved = !!body.approved;
      }
      if (Array.isArray(body.permissions)) target.permissions = body.permissions.filter((k) => ALL_PERMS.includes(k));
      if (body.name !== undefined) target.name = String(body.name).trim().slice(0, 80) || target.username;
      if (body.email !== undefined) target.email = String(body.email).trim().slice(0, 120);
      if (body.mobile !== undefined) target.mobile = String(body.mobile).replace(/[^\d+]/g, '').slice(0, 16);
      if (body.password) { if (!validPassword(body.password)) throw new HttpError(400, 'Password kam se kam 6 characters ka ho.'); target.password = hashPassword(body.password); target.mustChangePassword = true; }
      if (!target.approved) for (const [k, s] of Object.entries(db.sessions)) if (s.username === target.username) delete db.sessions[k];
      await persist('users'); persist('sessions');
      return sendJson(res, 200, { ok: true, user: publicUser(target) });
    }
    if (method === 'DELETE') {
      if (target.username === user.username) throw new HttpError(400, 'Apna hi account delete nahi kar sakte.');
      if (target.role === 'admin' && db.users.filter((u) => u.role === 'admin').length <= 1) throw new HttpError(400, 'Aakhri admin ko delete nahi kar sakte.');
      db.users = db.users.filter((u) => u !== target);
      for (const [k, s] of Object.entries(db.sessions)) if (s.username === target.username) delete db.sessions[k];
      await persist('users'); persist('sessions');
      return sendJson(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, 'Not found');
}

// ---------------------------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------------------------
async function serveStatic(res, pathname) {
  let requested = decodeURIComponent(pathname);
  if (requested === '/' || requested === '') requested = '/index.html';
  const candidates = [path.normalize(path.join(__dirname, requested))];
  if (requested.startsWith('/js/')) candidates.push(path.normalize(path.join(__dirname, path.basename(requested))));
  for (const candidate of candidates) {
    if (!candidate.startsWith(__dirname)) return sendText(res, 404, 'Not found');
    const rel = path.relative(__dirname, candidate);
    const top = rel.split(path.sep)[0];
    const base = path.basename(candidate);
    if (BLOCKED_FILES.has(base) || base.startsWith('.') || BLOCKED_DIRS.has(top)) return sendText(res, 404, 'Not found');
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) continue;
      const content = await fs.readFile(candidate);
      const ext = path.extname(candidate).toLowerCase();
      res.writeHead(200, headers({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=600' }));
      return res.end(content);
    } catch { /* try next */ }
  }
  if (!path.extname(requested)) return serveStatic(res, '/index.html'); // pretty URLs → app shell
  return sendText(res, 404, 'Not found');
}

// ---------------------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(req, res, url); } catch (err) {
        if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
        console.error(err);
        return sendJson(res, 500, { error: 'Server error' });
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    return await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return sendText(res, 500, 'Unexpected server error');
  }
});

async function start() {
  db.users = await readJson(FILES.users, []);
  db.sessions = await readJson(FILES.sessions, {});
  db.settings = deepMerge(DEFAULT_SETTINGS, await readJson(FILES.settings, {}));
  pruneSessions();
  await bootstrapAdmin();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`First Forward Dashboard → http://0.0.0.0:${PORT}`);
    console.log(`Sheet ${db.settings.sheetId} · cache ${cacheMs() / 1000}s · data ${DATA_DIR} · users ${db.users.length}${GVIZ_BASE !== 'https://docs.google.com' ? ` · upstream ${GVIZ_BASE}` : ''}`);
  });
}
start();
