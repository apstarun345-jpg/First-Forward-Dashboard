// First Forward Dashboard — zero-dependency Node server.
//  • Serves the static app
//  • Proxies + caches Google Sheets gviz queries (/api/gviz) — login required
//  • Login / signup, sessions, per-user permissions (/api/auth/*, /api/users)
//  • Dashboard settings (branding, sheet mapping, thresholds, contacts) (/api/settings)
// Durable storage: local JSON files OR encrypted APP_STORAGE tab in the same Google spreadsheet.
// Run locally:  npm start   (PORT defaults to 8080; Render sets PORT automatically)
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sheetsStoreFromEnv } from './sheets-storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DEFAULT_SHEET_ID = process.env.SHEET_ID || '1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc';
const DEFAULT_CACHE_SECONDS = Math.max(0, Number(process.env.CACHE_SECONDS || 600));
const MAX_CACHE_ENTRIES = 400;
const UPSTREAM_TIMEOUT_MS = 45_000;
const GVIZ_BASE = process.env.GVIZ_BASE || 'https://docs.google.com'; // override only for local testing with a mock
const DATA_DIR = path.resolve(process.env.DATA_DIR || (process.env.RENDER && existsSync('/data') ? '/data' : path.join(__dirname, 'data')));
const STORAGE_BACKEND = process.env.STORAGE_BACKEND || 'files';
let sheetsStore = null;
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
const BLOCKED_FILES = new Set(['server.js', 'sheets-storage.js', 'DEPLOYMENT.md', 'SHEETS_STORAGE.md', 'package.json', 'package-lock.json', 'render.yaml', 'README.md', '.env']);
const BLOCKED_DIRS = new Set(['data', 'dev', 'node_modules', '.git']);

// ---------------------------------------------------------------------------------------------
// Permissions & settings schema
// ---------------------------------------------------------------------------------------------
// Fixed page / action permissions. Sheet-tab permissions (`sheet:<tabId>`) are generated from the
// `tabs` registry below, so the admin can add or hide sheet tabs and control each one per user.
export const PAGE_PERMISSIONS = [
  { key: 'home', label: 'Home · highlights & charts', group: 'Pages' },
  { key: 'tagIssued', label: 'GV & FF Tag Issued (date-wise)', group: 'Pages' },
  { key: 'dashboard', label: 'First Forward · Dashboard', group: 'First Forward' },
  { key: 'trend', label: 'First Forward · Trend', group: 'First Forward' },
  { key: 'performance', label: 'First Forward · Performance', group: 'First Forward' },
  { key: 'stock', label: 'First Forward · Stock', group: 'First Forward' },
  { key: 'gvDashboard', label: 'GV Partner · Dashboard', group: 'GV Partner' },
  { key: 'gvTrend', label: 'GV Partner · Trend', group: 'GV Partner' },
  { key: 'gvPerformance', label: 'GV Partner · Performance', group: 'GV Partner' },
  { key: 'gvStock', label: 'GV Partner · Stock', group: 'GV Partner' },
  { key: 'compare', label: 'GV vs First Forward (comparison)', group: 'GV Partner' },
  { key: 'export', label: 'Download CSV / Excel', group: 'Actions' },
  { key: 'share', label: 'WhatsApp / Email share', group: 'Actions' },
  { key: 'refresh', label: 'Force refresh from Google', group: 'Actions' },
  { key: 'contacts', label: 'See mobile numbers', group: 'Actions' }
];

// Sheet-tab registry defaults (also mirrored in config.js). `enabled:false` hides a tab everywhere.
export const DEFAULT_TABS = [
  { id: 'StockDataa', group: 'First Forward', source: 'main', kind: 'stock', icon: '📦', label: 'StockDataa · Inventory', tab: 'StockDataa', gid: '', startCol: 'A', startRow: '1', endCol: 'M', endRow: '', range: '', desc: 'Field stock (tag-wise)', enabled: true, search: ['I', 'H', 'K', 'B', 'D', 'F', 'C'] },
  { id: 'REPORT', group: 'First Forward', source: 'main', kind: 'report', icon: '📑', label: 'REPORT', tab: 'REPORT', gid: '242489821', startCol: 'A', startRow: '1', endCol: '', endRow: '', range: '', desc: 'Agent-wise summary: stock + issuance + status', enabled: true },
  { id: 'EIR', group: 'First Forward', source: 'main', kind: 'issuance', icon: '🗂️', label: 'EIR · Issuance log', tab: 'EIR', gid: '', startCol: 'A', startRow: '1', endCol: '', endRow: '', range: '', desc: 'Har tag ka issuance record (bada tab)', enabled: false, search: ['B', 'L', 'G', 'AH', 'E'] },
  { id: 'GV Master', group: 'GV Partner', source: 'gv', kind: 'gv-issuance', icon: '🚀', label: 'GV Master · Issuance', tab: 'GV Master', gid: '', startCol: 'A', startRow: '1', endCol: 'X', endRow: '', range: '', desc: 'GV partner ka poora issuance data', enabled: true, search: ['B', 'A', 'D', 'E', 'I'] },
  { id: 'Tag Assignment', group: 'GV Partner', source: 'gv', kind: 'gv-stock', icon: '📦', label: 'Tag Assignment · Stock', tab: 'Tag Assignment', gid: '', startCol: 'A', startRow: '1', endCol: 'M', endRow: '', range: '', desc: 'GV partner stock (tag-wise, In Stock)', enabled: true, search: ['F', 'B', 'C', 'H', 'A'] },
  { id: 'GV REPORT', group: 'GV Partner', source: 'gv', kind: 'gv-report', icon: '📑', label: 'GV REPORT · Performance', tab: 'GV REPORT', gid: '1284424234', startCol: 'A', startRow: '4', endCol: 'BE', endRow: '', range: 'A4:BE', desc: 'GV agent-wise performance + stock', enabled: true }
];

/** Permission descriptors: fixed pages/actions + one per registered sheet tab. */
export function permissionsFor(settings) {
  const tabs = (settings && Array.isArray(settings.tabs) && settings.tabs.length) ? settings.tabs : DEFAULT_TABS;
  return [
    ...PAGE_PERMISSIONS,
    ...tabs.filter((t) => t && t.id).map((t) => ({ key: `sheet:${t.id}`, label: `Sheet · ${t.label || t.id}`, group: `Sheets · ${t.group || 'Main'}` }))
  ];
}
const allPermKeys = (settings) => permissionsFor(settings).map((p) => p.key);
const allPermKeysNow = () => allPermKeys(db.settings);
// Back-compat export (some tooling imported PERMISSIONS).
export const PERMISSIONS = permissionsFor({ tabs: DEFAULT_TABS });
const DEFAULT_USER_PERMS = ['home', 'tagIssued', 'dashboard', 'trend', 'stock', 'performance', 'gvDashboard', 'gvTrend', 'gvStock', 'gvPerformance', 'compare',
  'sheet:StockDataa', 'sheet:REPORT', 'sheet:GV Master', 'sheet:Tag Assignment', 'sheet:GV REPORT', 'export'];

const DEFAULT_SETTINGS = {
  appName: 'First Forward Dashboard',
  brand: 'First Forward',
  tagline: 'Dashboard',
  logo: '',          // data URL (uploaded in Settings → Branding)
  loginImage: '',    // data URL (login page / hero image)
  loginAnimation: true, // animated login page + "Welcome back" splash
  theme: { sidebarBg: '#1e1b4b', sidebarBg2: '#4c1d95', sidebarText: '#e0e7ff', accent: '#6366f1', accent2: '#a855f7', gvAccent: '#0d9488' },
  sheetId: DEFAULT_SHEET_ID,
  gvSheetId: '1LkYX746lGZQKhl5ueoKe3kYOo4SNtu47p5-jkVNUiBA',
  tabs: DEFAULT_TABS.map((t) => ({ ...t })),
  reportGid: '242489821',
  gv: {
    master: { tab: 'GV Master', gid: '', uniqueId: 'A', agentName: 'B', tlId: 'C', tlName: 'D', vrn: 'E', vClass: 'F', cch: 'G', serial: 'H', tagId: 'I', amount: 'J', customer: 'K', productId: 'L', commission: 'M', status: 'N', commissionStatus: 'O', date: 'P', time: 'Q', gvTlId: 'R', masterCch: 'S', monthName: 'T', tagType: 'U', gvUniqueId: 'W', gvUniqueName: 'X' },
    assignment: { tab: 'Tag Assignment', gid: '', cls: 'A', tagId: 'B', serial: 'C', status: 'D', agentId: 'E', agentName: 'F', tlId: 'G', tlName: 'H', gvUniqueId: 'L', gvUniqueName: 'M' },
    report: { tab: 'GV REPORT', gid: '1284424234', headerRow: 4, lastCol: 'AZ' }
  },
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
const FILES = { users: path.join(DATA_DIR, 'users.json'), sessions: path.join(DATA_DIR, 'sessions.json'), settings: path.join(DATA_DIR, 'settings.json'), resets: path.join(DATA_DIR, 'resets.json'), notify: path.join(DATA_DIR, 'notifications.json') };
// Notifications are deliberately kept server-side so the admin can see activity even after a
// refresh. `watch` stores the last Google Sheet snapshot used by the lightweight report watcher.
const db = { users: [], sessions: {}, settings: { ...DEFAULT_SETTINGS }, resets: [], notify: { items: [], watch: {} } };
const writeQueue = new Map();

const storageFailures = new Map();
const durableSnapshots = new Map();
let persistentDiskMounted = false;
const storageStatus = () => ({
  backend: STORAGE_BACKEND,
  encrypted: STORAGE_BACKEND === 'sheets',
  tab: STORAGE_BACKEND === 'sheets' ? 'APP_STORAGE' : null,
  lastSavedAt: sheetsStore?.lastSavedAt || null,
  persistentDiskMounted,
  dataDir: STORAGE_BACKEND === 'files' ? DATA_DIR : null,
  error: [...storageFailures.values()].join(' ') || null,
  warning: STORAGE_BACKEND === 'files' && process.env.RENDER && !persistentDiskMounted
    ? 'Persistent disk not detected. Back up existing data, attach a Render disk at /data and set DATA_DIR=/data before redeploying.' : null
});
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') return fallback;
    // Never silently replace corrupt/unreadable accounts with a new default admin.
    throw new Error(`Cannot read persistent data ${path.basename(file)}: ${err.message}`);
  }
}
function persist(kind) {
  const file = FILES[kind];
  const snapshot = JSON.stringify(db[kind], null, 2);
  const prev = writeQueue.get(kind) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    if (sheetsStore) {
      await sheetsStore.save(kind, JSON.parse(snapshot));
    } else {
      const tmp = `${file}.tmp`;
      const handle = await fs.open(tmp, 'w', 0o600);
      try { await handle.writeFile(snapshot); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(tmp, file);
    }
    durableSnapshots.set(kind, snapshot);
    storageFailures.delete(kind);
  }).catch((err) => {
    const storageError = sheetsStore
      ? `Could not save ${kind} to Google Sheets. Save not confirmed; check API access/quota and retry.`
      : `Could not save ${kind}. Check DATA_DIR disk permissions and free space.`;
    storageFailures.set(kind, storageError);
    if (JSON.stringify(db[kind], null, 2) === snapshot && durableSnapshots.has(kind)) db[kind] = JSON.parse(durableSnapshots.get(kind));
    console.error(storageError, err.message);
    throw new HttpError(503, storageError);
  });
  // Observe background notification writes too, without hiding failures from API callers.
  next.catch(() => {});
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
  return { username: u.username, name: u.name || u.username, email: u.email || '', mobile: u.mobile || '', avatar: u.avatar || '', role: u.role, approved: !!u.approved, permissions: u.role === 'admin' ? allPermKeysNow() : (u.permissions || []), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, mustChangePassword: !!u.mustChangePassword, lastLocation: u.lastLocation || null, notificationsSeenAt: u.notificationsSeenAt || null };
}
function findUser(username) { return db.users.find((u) => u.username === normUser(username)) || null; }
function findUserByLogin(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;
  // 1) exact username (normalized)
  const norm = normUser(input);
  let u = db.users.find((x) => x.username === norm) || null;
  if (u) return u;
  // 2) email exact (case-insensitive)
  const lower = input.toLowerCase();
  u = db.users.find((x) => x.email && String(x.email).trim().toLowerCase() === lower) || null;
  if (u) return u;
  // 3) mobile: digits match (last 10 digits)
  const digits = input.replace(/\D/g, '');
  if (digits.length >= 7) {
    u = db.users.find((x) => {
      if (!x.mobile) return false;
      const md = String(x.mobile).replace(/\D/g, '');
      if (!md) return false;
      if (md === digits) return true;
      // compare last 10 digits for Indian numbers etc.
      if (md.length >= 10 && digits.length >= 10) return md.slice(-10) === digits.slice(-10);
      return md.endsWith(digits) || digits.endsWith(md);
    }) || null;
    if (u) return u;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// In-app + browser notification feed
// ---------------------------------------------------------------------------------------------
function notifyItems() {
  if (!db.notify || !Array.isArray(db.notify.items)) db.notify = { items: [], watch: {} };
  return db.notify.items;
}
function notificationVisible(item, user) {
  if (!item || !user) return false;
  if (item.target === 'broadcast') return true;
  if (item.target === 'admin') return user.role === 'admin';
  return item.target === `user:${user.username}`;
}
function recordNotification({ type = 'info', title, body, target = 'admin', meta = {} }) {
  const item = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`, type, title: String(title || 'Notification').slice(0, 120), body: String(body || '').slice(0, 800), target, meta, createdAt: new Date().toISOString() };
  notifyItems().push(item);
  if (notifyItems().length > 500) db.notify.items = notifyItems().slice(-500);
  persist('notify');
  return item;
}
function visibleNotifications(user, since) {
  const after = since ? new Date(since).getTime() : 0;
  return notifyItems().filter((item) => notificationVisible(item, user) && (!after || new Date(item.createdAt).getTime() > after)).slice(-80);
}
const activityLast = new Map();
function noteActivity(user, page) {
  if (!user || user.role === 'admin') return null;
  const cleanPage = String(page || 'dashboard').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80) || 'dashboard';
  const key = `${user.username}:${cleanPage}`;
  if (Date.now() - (activityLast.get(key) || 0) < 60e3) return null;
  activityLast.set(key, Date.now());
  return recordNotification({ type: 'activity', title: 'User ne app kholi', body: `${user.name || user.username} ne ${cleanPage} open kiya.`, target: 'admin', meta: { username: user.username, page: cleanPage } });
}
function sha(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
async function createSession(username) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions[sha(token)] = { username, createdAt: Date.now(), expiresAt: Date.now() + SESSION_DAYS * 86400e3 };
  pruneSessions();
  try { await persist('sessions'); }
  catch (err) { delete db.sessions[sha(token)]; throw err; }
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
    if (findUser(ADMIN_USER)) return; // Environment credentials bootstrap ONCE, not every restart.
    const u = { username: ADMIN_USER, name: 'Admin', createdAt: new Date().toISOString(),
      role: 'admin', approved: true, permissions: allPermKeysNow(), mustChangePassword: false,
      password: hashPassword(ADMIN_PASSWORD) };
    db.users.unshift(u);
    await persist('users');
    console.log(`Admin "${ADMIN_USER}" created from environment.`);
  } else if (!db.users.some((u) => u.role === 'admin')) {
    const username = 'admin';
    if (!findUser(username)) {
      db.users.unshift({ username, name: 'Admin', role: 'admin', approved: true, permissions: allPermKeysNow(), password: hashPassword('admin123'), mustChangePassword: true, createdAt: new Date().toISOString() });
      await persist('users');
      console.log('⚠️  No admin found → created default admin  user: admin  password: admin123  (change it in Settings → My account, or set ADMIN_USER / ADMIN_PASSWORD env).');
    }
  }
}

// login / password-reset throttle (per IP)
const attempts = new Map();
const forgotHits = new Map();
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
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
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
  let range = params.get('range');
  if (!range) {
    const tabs = (db.settings && Array.isArray(db.settings.tabs)) ? db.settings.tabs : DEFAULT_TABS;
    const tabMatch = tabs.find((t) => (sheet && (t.tab === sheet || t.id === sheet)) || (gid && t.gid === gid));
    if (tabMatch && tabMatch.range) range = tabMatch.range;
    else if (tabMatch && (tabMatch.startCol || tabMatch.startRow || tabMatch.endCol || tabMatch.endRow)) {
      const from = `${tabMatch.startCol || 'A'}${tabMatch.startRow || 1}`;
      const end = `${tabMatch.endCol || ''}${tabMatch.endRow || ''}`;
      range = end ? `${from}:${end}` : (from === 'A1' ? '' : `${from}:ZZZ`);
    }
  }
  if (/^[A-Z]+[0-9]+:$/i.test(range)) range = range.toUpperCase() === 'A1:' ? '' : `${range}ZZZ`;
  if (range) p.set('range', range.slice(0, 40).replace(/[^A-Za-z0-9:$]/g, ''));
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

// The watcher only asks Google for grouped counts for the newest day. It does not download
// the full EIR/REPORT tabs. Render can sleep, so the same check also runs when the feed is opened.
function parseGvizServer(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('gviz response parse failed');
  const json = JSON.parse(text.slice(start, end + 1));
  if (json.status === 'error') throw new Error((json.errors || []).map((e) => e.detailed_message || e.message).join('; ') || 'Google query error');
  return json.table || { cols: [], rows: [] };
}
function serverCell(row, index) {
  const cell = row && row.c && row.c[index];
  return cell && cell.v !== null && cell.v !== undefined ? String(cell.v) : '';
}
function serverDate(value) {
  const m = String(value || '').match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
  if (m) return `${m[1]}-${String(+m[2] + 1).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  const iso = String(value || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return iso ? `${iso[1]}-${String(+iso[2]).padStart(2, '0')}-${String(+iso[3]).padStart(2, '0')}` : '';
}
function serverNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function classBucket(value) {
  const c = String(value || '').toUpperCase().replace(/\s+/g, '');
  if (c === '4' || c === 'VC4') return 'VC4';
  if (c === '20' || c === 'VC20') return 'VC20';
  return 'VC5+';
}
async function reportSnapshot(source) {
  const s = db.settings;
  const isGv = source === 'gv';
  const e = isGv ? (s.gv && s.gv.master) : s.eir;
  const sheetId = isGv ? s.gvSheetId : s.sheetId;
  const sheet = isGv ? ((e && e.tab) || 'GV Master') : (s.eirSheet || (e && e.sheet) || 'EIR');
  const dateCol = isGv ? ((e && e.date) || 'P') : ((e && e.date) || 'AA');
  const classCol = isGv ? ((e && (e.cch || e.vClass)) || 'G') : ((e && e.cls) || 'D');
  const tagCol = isGv ? ((e && e.tagId) || 'I') : ((e && e.tagId) || 'A');
  const masterCol = !isGv ? ((e && e.masterId) || 'AU') : '';
  const select = isGv ? `${dateCol}, ${classCol}, count(${tagCol})` : `${dateCol}, ${classCol}, ${masterCol}, count(${tagCol})`;
  const group = isGv ? `${dateCol}, ${classCol}` : `${dateCol}, ${classCol}, ${masterCol}`;
  const tq = `select ${select} where ${dateCol} is not null group by ${group} order by ${dateCol} desc limit 100`;
  const params = new URLSearchParams({ id: String(sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet, tq });
  const out = await fetchUpstream(upstreamUrl(params));
  if (out.status < 200 || out.status >= 300) throw new Error(`Google responded ${out.status}`);
  const table = parseGvizServer(out.body);
  const rows = [];
  for (const row of table.rows || []) {
    const date = serverDate(serverCell(row, 0));
    if (!date) continue;
    const master = isGv ? '' : serverCell(row, 2).trim();
    const configuredGvId = String((s.eir && s.eir.gvMasterId) || '5845036').trim().replace(/\.0+$/, '');
    const excluded = !isGv && master && master.replace(/\.0+$/, '') === configuredGvId;
    if (excluded) continue;
    const classIndex = 1;
    const countIndex = isGv ? 2 : 3;
    rows.push({ date, cls: classBucket(serverCell(row, classIndex)), n: serverNumber(serverCell(row, countIndex)) });
  }
  if (!rows.length) return { date: '', total: 0, classes: {} };
  const date = rows.map((r) => r.date).sort().pop();
  const latest = rows.filter((r) => r.date === date);
  const classes = {};
  latest.forEach((r) => { classes[r.cls] = (classes[r.cls] || 0) + r.n; });
  return { date, total: Object.values(classes).reduce((a, b) => a + b, 0), classes };
}
function snapshotDelta(prev, next) {
  if (!prev || !prev.date || !next || !next.date) return null;
  const keys = new Set([...Object.keys(prev.classes || {}), ...Object.keys(next.classes || {})]);
  const classes = {};
  for (const key of keys) { const d = (next.classes[key] || 0) - (prev.classes[key] || 0); if (d) classes[key] = d; }
  const total = (next.total || 0) - (prev.total || 0);
  return { total, classes, changed: next.date !== prev.date || total !== 0 };
}
function deltaText(delta) {
  const pieces = Object.entries(delta.classes || {}).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`);
  return `${delta.total > 0 ? '+' : ''}${delta.total} tags${pieces.length ? ` · ${pieces.join(' · ')}` : ''}`;
}
let reportCheckAt = 0;
let reportCheckPromise = null;
async function checkReports(force = false) {
  if (reportCheckPromise) return reportCheckPromise;
  if (!force && Date.now() - reportCheckAt < 5 * 60e3) return;
  reportCheckAt = Date.now();
  reportCheckPromise = (async () => {
    for (const source of ['ff', 'gv']) {
      try {
        const next = await reportSnapshot(source);
        const previous = db.notify.watch[source];
        db.notify.watch[source] = next;
        const delta = snapshotDelta(previous, next);
        if (delta && delta.changed && (delta.total > 0 || next.date !== previous.date)) {
          const label = source === 'gv' ? 'GV Partner' : 'First Forward';
          recordNotification({ type: 'report', title: `${label} report update`, body: `${next.date}: ${deltaText(delta)} — Google Sheet me naya data aaya.`, target: 'admin', meta: { source, snapshot: next } });
        }
      } catch (err) { console.warn(`report watcher ${source}:`, err.message); }
    }
    await persist('notify');
  })().finally(() => { reportCheckPromise = null; });
  return reportCheckPromise;
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
    const okBody = body.includes('setResponse') && !/"status"\s*:\s*"error"/.test(body);
    if (status >= 200 && status < 300 && okBody) {
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
  return { appName: s.appName, brand: s.brand, tagline: s.tagline, logo: s.logo, loginImage: s.loginImage, loginAnimation: s.loginAnimation !== false, theme: s.theme, allowSignup: s.allowSignup !== false };
}
function requireAdmin(user) { if (!user || user.role !== 'admin') throw new HttpError(403, 'Admin access required'); }
function validPassword(pw) { return typeof pw === 'string' && pw.length >= 6 && pw.length <= 200; }

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  const user = sessionUser(req);

  if (p === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, service: 'first-forward-dashboard', version: '3.2.0', storage: storageStatus(), users: db.users.length, cached: cache.size, cacheSeconds: cacheMs() / 1000, dataDir: STORAGE_BACKEND === 'files' ? DATA_DIR : null });
  }
  if (p === '/api/public-config' && method === 'GET') return sendJson(res, 200, publicSettings());

  // ---- auth ----
  if (p === '/api/auth/me' && method === 'GET') {
    return sendJson(res, 200, { user: publicUser(user), settings: user ? db.settings : publicSettings(), permissions: permissionsFor(db.settings), tabs: db.settings.tabs });
  }
  if (p === '/api/auth/signup' && method === 'POST') {
    if (db.settings.allowSignup === false && db.users.length) throw new HttpError(403, 'Sign up band hai — admin se account maango.');
    const body = await readBody(req);
    const username = normUser(body.username);
    if (username.length < 3) throw new HttpError(400, 'Username kam se kam 3 characters (a-z, 0-9, . _ -) ka ho.');
    if (!validPassword(body.password)) throw new HttpError(400, 'Password kam se kam 6 characters ka ho.');
    if (findUser(username)) throw new HttpError(409, 'Ye username pehle se hai. Login karo ya dusra username lo.');
    const first = db.users.length === 0;
    const u = { username, name: String(body.name || '').trim().slice(0, 80) || username, email: String(body.email || '').trim().slice(0, 120), mobile: String(body.mobile || '').replace(/[^\d+]/g, '').slice(0, 16), role: first ? 'admin' : 'user', approved: first, permissions: first ? allPermKeysNow() : [], password: hashPassword(body.password), createdAt: new Date().toISOString(), lastLoginAt: null };
    db.users.push(u);
    await persist('users');
    if (first) {
      const token = await createSession(username);
      u.lastLoginAt = new Date().toISOString(); await persist('users');
      return sendJson(res, 200, { ok: true, user: publicUser(u), settings: db.settings, permissions: permissionsFor(db.settings), tabs: db.settings.tabs, first: true }, { 'Set-Cookie': cookieHeader(req, token, SESSION_DAYS * 86400) });
    }
    return sendJson(res, 200, { ok: true, pending: true, message: 'Account ban gaya. Admin approve karega, phir login kar paoge.' });
  }
  if (p === '/api/auth/login' && method === 'POST') {
    const ip = clientIp(req);
    if (throttled(ip)) throw new HttpError(429, 'Too many failed attempts — try again after 10 minutes.');
    const body = await readBody(req);
    const loginId = String(body.username || body.email || body.mobile || '').trim();
    const u = findUserByLogin(loginId) || findUserByLogin(body.username);
    if (!u || !verifyPassword(body.password || '', u.password)) { noteFail(ip); throw new HttpError(401, 'Invalid login — check username / email / mobile and password.'); }
    if (!u.approved) throw new HttpError(403, 'Account pending admin approval.');
    attempts.delete(ip);
    u.lastLoginAt = new Date().toISOString();
    // One Google Sheets batch can confirm the user timestamp and session together.
    const [token] = await Promise.all([createSession(u.username), persist('users')]);
    if (u.role !== 'admin') recordNotification({ type: 'login', title: 'New user login', body: `${u.name || u.username} logged in via ${loginId}.`, target: 'admin', meta: { username: u.username, loginId } });
    return sendJson(res, 200, { ok: true, user: publicUser(u), settings: db.settings, permissions: permissionsFor(db.settings), tabs: db.settings.tabs }, { 'Set-Cookie': cookieHeader(req, token, SESSION_DAYS * 86400) });
  }
  // ---- activity + notifications ---------------------------------------------------------------
  if (p === '/api/notifications' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    checkReports().catch(() => {});
    const since = url.searchParams.get('since') || '';
    const items = visibleNotifications(user, since);
    const all = visibleNotifications(user, '1970-01-01T00:00:00.000Z');
    const seen = user.notificationsSeenAt ? new Date(user.notificationsSeenAt).getTime() : 0;
    const unread = all.filter((item) => new Date(item.createdAt).getTime() > seen).length;
    return sendJson(res, 200, { items, unread, checkAt: new Date().toISOString() });
  }
  if (p === '/api/notifications/read' && method === 'POST') {
    if (!user) throw new HttpError(401, 'Login required');
    user.notificationsSeenAt = new Date().toISOString();
    await persist('users');
    return sendJson(res, 200, { ok: true, at: user.notificationsSeenAt });
  }
  if (p === '/api/activity' && method === 'POST') {
    if (!user) throw new HttpError(401, 'Login required');
    const body = await readBody(req);
    const type = String(body.type || (body.query ? 'search' : 'activity'));
    if (type === 'search' || body.query) {
      const q = String(body.query || '').trim().slice(0, 120);
      const opt = String(body.option || body.page || 'Search').trim().slice(0, 80);
      if (q) {
        recordNotification({
          type: 'search',
          title: `🔍 Search: ${q}`,
          body: `${user.name || user.username} (${user.mobile || 'No Mobile'}) ne ${opt} me "${q}" search kiya.`,
          target: 'broadcast',
          meta: { username: user.username, name: user.name, mobile: user.mobile, option: opt, query: q, at: new Date().toISOString() }
        });
      }
    } else if (type === 'click' || body.action === 'click') {
      const opt = String(body.option || body.page || 'Option').trim().slice(0, 80);
      const det = String(body.details || '').trim().slice(0, 120);
      recordNotification({
        type: 'click',
        title: `👆 Option: ${opt}`,
        body: `${user.name || user.username} (${user.mobile || 'No Mobile'}) ne "${opt}" option click kiya${det ? ` (${det})` : ''}.`,
        target: 'broadcast',
        meta: { username: user.username, name: user.name, mobile: user.mobile, option: opt, details: det, at: new Date().toISOString() }
      });
    } else {
      noteActivity(user, body.page);
    }
    return sendJson(res, 200, { ok: true });
  }
  // ---- forgot password ("Forgot password?" on the login screen) ----
  // No email service: the request is queued for the admin, who either sets a new password or
  // generates a 6-digit one-time code the user can redeem below. Rate-limited per IP.
  if (p === '/api/auth/forgot' && method === 'POST') {
    const ip = clientIp(req);
    const hits = (forgotHits.get(ip) || []).filter((t) => Date.now() - t < 60 * 60e3);
    if (hits.length >= 6) throw new HttpError(429, 'Too many reset requests — wait a while or contact admin directly.');
    hits.push(Date.now()); forgotHits.set(ip, hits);
    const body = await readBody(req);
    const key = String(body.username || body.email || '').trim();
    const u = findUserByLogin(key) || db.users.find((x) => x.email && String(x.email).toLowerCase() === key.toLowerCase());
    const c = db.settings.contacts || {};
    const help = { whatsapp: c.teamWhatsapp || '', email: c.teamEmail || '' };
    if (!u) {
      return sendJson(res, 200, { ok: true, found: false, help, message: 'If this account exists, request has been sent to admin. If not found, ask admin for new account.' });
    }
    db.resets = db.resets.filter((r) => r.username !== u.username || r.resolved);
    db.resets.push({ username: u.username, name: u.name || u.username, email: u.email || '', mobile: u.mobile || '', at: new Date().toISOString(), code: '', codeExpiresAt: null, resolved: false });
    await persist('resets');
    return sendJson(res, 200, { ok: true, found: true, help, message: `Request sent ✓ — admin will provide new password or 6-digit code (user: ${u.username}).` });
  }
  if (p === '/api/auth/reset' && method === 'POST') {
    const body = await readBody(req);
    const u = findUserByLogin(body.username) || findUser(body.username);
    const code = String(body.code || '').replace(/\D/g, '').slice(0, 8);
    if (!u || !code) throw new HttpError(400, 'Username or code invalid.');
    const reqRow = db.resets.slice().reverse().find((r) => r.username === u.username && !r.resolved && r.code);
    if (!reqRow || !reqRow.code || reqRow.code !== code) throw new HttpError(400, 'Code did not match. Ask admin for new code.');
    if (!reqRow.codeExpiresAt || new Date(reqRow.codeExpiresAt).getTime() < Date.now()) throw new HttpError(400, 'Code expired — ask admin for new code.');
    if (!validPassword(body.password)) throw new HttpError(400, 'New password must be at least 6 characters.');
    u.password = hashPassword(body.password);
    u.mustChangePassword = false;
    reqRow.resolved = true; reqRow.resolvedAt = new Date().toISOString();
    for (const [k, sess] of Object.entries(db.sessions)) if (sess.username === u.username) delete db.sessions[k];
    await persist('users'); await persist('sessions'); await persist('resets');
    return sendJson(res, 200, { ok: true, message: 'Password set ✓ — now login with new password.' });
  }

  if (p === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(req).ff_sid;
    if (token) { delete db.sessions[sha(token)]; await persist('sessions'); }
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
    if (body.avatar !== undefined) {
      const a = String(body.avatar || '');
      if (a && !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(a)) throw new HttpError(400, 'Photo: sirf PNG/JPG/WEBP/SVG image allowed.');
      if (a.length > 1.5 * 1024 * 1024) throw new HttpError(400, 'Photo 1 MB se chhoti rakho.');
      user.avatar = a;
    }
    await persist('users');
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }
  if (p === '/api/auth/location' && method === 'POST') {
    const body = await readBody(req);
    const lat = Number(body.latitude), lon = Number(body.longitude), accuracy = Number(body.accuracy);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) throw new HttpError(400, 'Location coordinates valid nahi hain.');
    user.lastLocation = { latitude: Number(lat.toFixed(6)), longitude: Number(lon.toFixed(6)), accuracy: Number.isFinite(accuracy) ? Math.max(0, Math.min(100000, Math.round(accuracy))) : null, at: new Date().toISOString() };
    await persist('users');
    if (user.role !== 'admin') recordNotification({ type: 'location', title: 'User location shared', body: `${user.name || user.username} ne consent ke saath apni location share ki.`, target: 'admin', meta: { username: user.username, location: user.lastLocation } });
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }

  // ---- gviz ----
  if (p === '/api/gviz' && method === 'GET') {
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
    if (patch.tabs !== undefined) {
      if (!Array.isArray(patch.tabs)) throw new HttpError(400, 'tabs array hona chahiye');
      patch.tabs = patch.tabs.filter((t) => t && t.id).map((t) => ({
        id: String(t.id).slice(0, 60), group: String(t.group || 'First Forward').slice(0, 40), source: t.source === 'gv' ? 'gv' : 'main',
        kind: String(t.kind || 'sheet').slice(0, 30), icon: String(t.icon || '📄').slice(0, 8), label: String(t.label || t.id).slice(0, 80),
        tab: String(t.tab || t.id).slice(0, 80), gid: String(t.gid || '').slice(0, 30), desc: String(t.desc || '').slice(0, 160),
        startCol: String(t.startCol || '').slice(0, 8).toUpperCase(),
        startRow: String(t.startRow || '').slice(0, 12),
        endCol: String(t.endCol || '').slice(0, 8).toUpperCase(),
        endRow: String(t.endRow || '').slice(0, 12),
        range: String(t.range || '').slice(0, 40).toUpperCase(),
        search: Array.isArray(t.search) ? t.search.map((s) => String(s).slice(0, 6).toUpperCase()) : undefined,
        enabled: t.enabled !== false
      }));
    }
    if (patch.gv && typeof patch.gv === 'object') cache.clear();
    const next = body.reset ? { ...DEFAULT_SETTINGS } : deepMerge(db.settings, patch);
    next.updatedAt = new Date().toISOString(); next.updatedBy = user.username;
    if (next.sheetId !== db.settings.sheetId || next.cacheSeconds !== db.settings.cacheSeconds) cache.clear();
    db.settings = next;
    await persist('settings');
    return sendJson(res, 200, { ok: true, settings: db.settings });
  }
  if (p === '/api/cache/clear' && method === 'POST') { requireAdmin(user); cache.clear(); return sendJson(res, 200, { ok: true }); }

  // ---- users (admin) ----
  if (p === '/api/users' && method === 'GET') {
    requireAdmin(user);
    return sendJson(res, 200, { users: db.users.map(publicUser), permissions: permissionsFor(db.settings), defaults: DEFAULT_USER_PERMS, tabs: db.settings.tabs, resetRequests: db.resets.map((r) => ({ username: r.username, name: r.name || '', email: r.email || '', at: r.at, code: r.code || '', codeExpiresAt: r.codeExpiresAt || null, resolved: !!r.resolved })).filter((r) => !r.resolved) });
  }
  if (p === '/api/users' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    const username = normUser(body.username);
    if (username.length < 3) throw new HttpError(400, 'Username kam se kam 3 characters ka ho.');
    if (findUser(username)) throw new HttpError(409, 'Username pehle se hai.');
    if (!validPassword(body.password)) throw new HttpError(400, 'Password kam se kam 6 characters ka ho.');
    const allow = allPermKeysNow();
    const perms = Array.isArray(body.permissions) ? body.permissions.filter((k) => allow.includes(k)) : DEFAULT_USER_PERMS.slice();
    const u = { username, name: String(body.name || '').trim().slice(0, 80) || username, email: String(body.email || '').trim().slice(0, 120), mobile: String(body.mobile || '').replace(/[^\d+]/g, '').slice(0, 16), role: body.role === 'admin' ? 'admin' : 'user', approved: body.approved !== false, permissions: perms, password: hashPassword(body.password), mustChangePassword: true, createdAt: new Date().toISOString(), lastLoginAt: null };
    db.users.push(u); await persist('users');
    return sendJson(res, 200, { ok: true, user: publicUser(u), permissions: permissionsFor(db.settings) });
  }
  if (p === '/api/users/reset-requests' && method === 'GET') {
    requireAdmin(user);
    const pending = db.resets.filter((r) => !r.resolved).map((r) => {
      const u = findUser(r.username);
      return { username: r.username, name: r.name || (u && u.name) || '', email: (u && u.email) || r.email || '', mobile: (u && u.mobile) || r.mobile || '', at: r.at, code: r.code || '', codeExpiresAt: r.codeExpiresAt || null, approved: !!r.code };
    });
    return sendJson(res, 200, { requests: pending });
  }
  const rr = p.match(/^\/api\/users\/reset-requests\/([^/]+)$/);
  if (rr && method === 'DELETE') {
    requireAdmin(user);
    const target = decodeURIComponent(rr[1]);
    let touched = false;
    db.resets.forEach((r) => { if (r.username === target && !r.resolved) { r.resolved = true; r.resolvedAt = new Date().toISOString(); touched = true; } });
    if (touched) await persist('resets');
    return sendJson(res, 200, { ok: true });
  }
  const rc = p.match(/^\/api\/users\/([^/]+)\/reset-code$/);
  if (rc && method === 'POST') {
    requireAdmin(user);
    const target = findUser(decodeURIComponent(rc[1]));
    if (!target) throw new HttpError(404, 'User nahi mila');
    const code = String(crypto.randomInt(100000, 999999));
    const expires = new Date(Date.now() + 30 * 60e3).toISOString();
    let row = db.resets.filter((r) => r.username === target.username && !r.resolved).pop();
    if (!row) { row = { username: target.username, name: target.name, email: target.email || '', mobile: target.mobile || '', at: new Date().toISOString(), resolved: false }; db.resets.push(row); }
    row.code = code; row.codeExpiresAt = expires; row.codeIssuedBy = user.username; row.resolved = false;
    await persist('resets');
    return sendJson(res, 200, { ok: true, username: target.username, code, expiresAt: expires, message: `Code ${code} (30 min valid) — user ko bata do; wo login page par "Forgot password → Code se reset" me daalega.` });
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
      if (Array.isArray(body.permissions)) { const allow = allPermKeysNow(); target.permissions = body.permissions.filter((k) => allow.includes(k)); }
      if (body.name !== undefined) target.name = String(body.name).trim().slice(0, 80) || target.username;
      if (body.email !== undefined) target.email = String(body.email).trim().slice(0, 120);
      if (body.mobile !== undefined) target.mobile = String(body.mobile).replace(/[^\d+]/g, '').slice(0, 16);
      if (body.password) { if (!validPassword(body.password)) throw new HttpError(400, 'Password kam se kam 6 characters ka ho.'); target.password = hashPassword(body.password); target.mustChangePassword = true; }
      if (!target.approved) for (const [k, s] of Object.entries(db.sessions)) if (s.username === target.username) delete db.sessions[k];
      await persist('users'); await persist('sessions');
      return sendJson(res, 200, { ok: true, user: publicUser(target) });
    }
    if (method === 'DELETE') {
      if (target.username === user.username) throw new HttpError(400, 'Apna hi account delete nahi kar sakte.');
      if (target.role === 'admin' && db.users.filter((u) => u.role === 'admin').length <= 1) throw new HttpError(400, 'Aakhri admin ko delete nahi kar sakte.');
      db.users = db.users.filter((u) => u !== target);
      for (const [k, s] of Object.entries(db.sessions)) if (s.username === target.username) delete db.sessions[k];
      await persist('users'); await persist('sessions');
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
    if (BLOCKED_FILES.has(base) || base.startsWith('.') || BLOCKED_DIRS.has(top) || ['.json', '.pem', '.key', '.env'].includes(path.extname(base).toLowerCase())) return sendText(res, 404, 'Not found');
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) continue;
      const content = await fs.readFile(candidate);
      const ext = path.extname(candidate).toLowerCase();
      res.writeHead(200, headers({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=600' }));
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

async function readLocalStore() {
  return {
    users: await readJson(FILES.users, []),
    sessions: await readJson(FILES.sessions, {}),
    settings: deepMerge(DEFAULT_SETTINGS, await readJson(FILES.settings, {})),
    resets: await readJson(FILES.resets, []),
    notify: await readJson(FILES.notify, { items: [], watch: {} })
  };
}
async function start() {
  if (!['files', 'sheets'].includes(STORAGE_BACKEND)) throw new Error('STORAGE_BACKEND must be files or sheets.');
  let stored;
  if (STORAGE_BACKEND === 'sheets') {
    // Google is authoritative. Never fall back to ephemeral files or a new default admin.
    sheetsStore = await sheetsStoreFromEnv(DEFAULT_SHEET_ID);
    stored = await sheetsStore.read();
    if (!stored) {
      if (process.env.STORAGE_INITIALIZE !== '1') throw new Error('APP_STORAGE is missing/empty. Follow SHEETS_STORAGE.md to migrate existing data once. No accounts were reset.');
      stored = await readLocalStore();
      if (stored.settings.sheetId && stored.settings.sheetId !== sheetsStore.sheetId) throw new Error('Set STORAGE_SHEET_ID to the existing main sheet ID from settings before migration.');
      await sheetsStore.initialize(stored);
      console.log('Encrypted APP_STORAGE initialized and verified. Remove STORAGE_INITIALIZE from the environment now.');
    }
  } else {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    // Optional migration to a newly attached persistent disk. Validate every file BEFORE copying.
    const localDir = path.join(__dirname, 'data');
    if (DATA_DIR !== localDir && existsSync(localDir) && !(await fs.readdir(DATA_DIR)).length) {
      const copies = [];
      for (const file of Object.values(FILES)) {
        const src = path.join(localDir, path.basename(file));
        if (existsSync(src)) { const content = await fs.readFile(src, 'utf8'); JSON.parse(content); copies.push([file, content]); }
      }
      for (const [file, content] of copies) await fs.writeFile(file, content, { mode: 0o600 });
    }
    stored = await readLocalStore();
    const mountInfo = await fs.readFile('/proc/self/mountinfo', 'utf8').catch(() => '');
    persistentDiskMounted = mountInfo.split('\n').some(line => {
      const mount = (line.split(' ')[4] || '').replace(/\\040/g, ' ');
      return mount !== '/' && mount !== '' && (DATA_DIR === mount || DATA_DIR.startsWith(mount + '/'));
    });
    if (storageStatus().warning) console.warn('⚠️ ', storageStatus().warning);
    const probe = path.join(DATA_DIR, '.write-check');
    await fs.writeFile(probe, 'ok', { mode: 0o600 }); await fs.unlink(probe);
  }
  db.users = stored.users;
  db.sessions = stored.sessions;
  db.settings = deepMerge(DEFAULT_SETTINGS, stored.settings);
  db.resets = stored.resets;
  const storedNotify = stored.notify;
  db.notify = { items: Array.isArray(storedNotify.items) ? storedNotify.items.slice(-500) : [], watch: storedNotify.watch && typeof storedNotify.watch === 'object' ? storedNotify.watch : {} };
  for (const kind of Object.keys(FILES)) durableSnapshots.set(kind, JSON.stringify(db[kind], null, 2));
  pruneSessions();
  await bootstrapAdmin();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`First Forward Dashboard → http://0.0.0.0:${server.address().port}`);
    console.log(`Sheet ${db.settings.sheetId} · cache ${cacheMs() / 1000}s · storage ${sheetsStore ? 'Google Sheets / encrypted APP_STORAGE' : DATA_DIR} · users ${db.users.length}${GVIZ_BASE !== 'https://docs.google.com' ? ` · upstream ${GVIZ_BASE}` : ''}`);
    setTimeout(() => checkReports(true).catch(() => {}), 5000);
    setInterval(() => checkReports(false).catch(() => {}), 5 * 60e3).unref();
  });
}
start().catch((err) => { console.error('Startup stopped to protect stored data:', err); process.exitCode = 1; });
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(async () => {
      await Promise.allSettled([...writeQueue.values()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
