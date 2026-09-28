// First Forward Dashboard — zero-dependency Node server.
//  • Serves the static app
//  • Proxies + caches Google Sheets gviz queries (/api/gviz) — login required
//  • Login / signup, sessions, per-user permissions (/api/auth/*, /api/users)
//  • Dashboard settings (branding, sheet mapping, thresholds, contacts) (/api/settings)
// Durable storage: local JSON files OR encrypted APP_STORAGE tab in the same Google spreadsheet.
// Run locally:  npm start   (PORT defaults to 8080; Render sets PORT automatically)
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sheetsStoreFromEnv } from './sheets-storage.js';
import { appsScriptStoreFromEnv, AppsScriptStore } from './apps-script-storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DEFAULT_SHEET_ID = process.env.SHEET_ID || '1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc';
const DEFAULT_CACHE_SECONDS = Math.max(0, Number(process.env.CACHE_SECONDS || 600));
const MAX_CACHE_ENTRIES = 400;
const UPSTREAM_TIMEOUT_MS = 45_000;
const GVIZ_BASE = process.env.GVIZ_BASE || 'https://docs.google.com'; // override only for local testing with a mock
const DATA_DIR = path.resolve(process.env.DATA_DIR || (process.env.RENDER && existsSync('/data') ? '/data' : path.join(__dirname, 'data')));
// Storage backend: 'appsscript' is chosen automatically when APPS_SCRIPT_URL is configured (recommended on
// Render free / no-disk plans — see STORAGE_SETUP.md). 'sheets' = service-account mode, 'files' = local JSON.
const STORAGE_BACKEND = process.env.STORAGE_BACKEND || ((process.env.APPS_SCRIPT_URL || '').trim() ? 'appsscript' : 'files');
const CLOUD_BACKEND = STORAGE_BACKEND === 'sheets' || STORAGE_BACKEND === 'appsscript';
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
const BLOCKED_FILES = new Set(['server.js', 'sheets-storage.js', 'apps-script-storage.js', 'DEPLOYMENT.md', 'SHEETS_STORAGE.md', 'STORAGE_SETUP.md', 'package.json', 'package-lock.json', 'render.yaml', 'README.md', '.env']);
const BLOCKED_DIRS = new Set(['data', 'dev', 'node_modules', '.git', 'google-apps-script']);

// ---------------------------------------------------------------------------------------------
// Permissions & settings schema
// ---------------------------------------------------------------------------------------------
// Fixed page / action permissions. Sheet-tab permissions (`sheet:<tabId>`) are generated from the
// `tabs` registry below, so the admin can add or hide sheet tabs and control each one per user.
export const PAGE_PERMISSIONS = [
  { key: 'home', label: 'Home · highlights & charts', group: 'Pages' },
  { key: 'tagIssued', label: 'GV & FF Tag Issued (date-wise)', group: 'Pages' },
  { key: 'targets', label: 'Targets · agent-wise monthly targets', group: 'Pages' },
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
const DEFAULT_USER_PERMS = ['home', 'tagIssued', 'targets', 'dashboard', 'trend', 'stock', 'performance', 'gvDashboard', 'gvTrend', 'gvStock', 'gvPerformance', 'compare',
  'sheet:StockDataa', 'sheet:REPORT', 'sheet:GV Master', 'sheet:Tag Assignment', 'sheet:GV REPORT', 'export'];

const DEFAULT_SETTINGS = {
  appName: 'First Forward & Gv Partner Dashboard',
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
  durable: CLOUD_BACKEND || persistentDiskMounted || !process.env.RENDER,
  encrypted: CLOUD_BACKEND,
  tab: CLOUD_BACKEND ? 'APP_STORAGE' : null,
  lastSavedAt: sheetsStore?.lastSavedAt || null,
  persistentDiskMounted,
  dataDir: STORAGE_BACKEND === 'files' ? DATA_DIR : null,
  error: [...storageFailures.values()].join(' ') || null,
  warning: STORAGE_BACKEND === 'files' && process.env.RENDER && !persistentDiskMounted
    ? 'Settings, users aur sessions abhi TEMPORARY folder me save ho rahe hain — Render har deploy/restart par unhe mita deta hai, isliye defaults wapas aa jaate hain. Google Sheet storage connect karo (Settings → Backup → Google Sheet storage setup, ya STORAGE_SETUP.md).' : null
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
  // Apps Script store batches + orders writes itself, so don't serialise (each call would wait seconds).
  const chain = STORAGE_BACKEND === 'appsscript' ? Promise.resolve() : prev.catch(() => {});
  const next = chain.then(async () => {
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
      ? `Could not save ${kind} to Google Sheets${STORAGE_BACKEND === 'appsscript' ? ' (Apps Script)' : ''}. Save not confirmed; check the Apps Script deployment / secret and retry.`
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
// `enabled` = master switch (UI me ek hi "Notifications ON/OFF" button hai). OFF → koi in-app toast
// nahi, koi browser alert nahi, koi mobile push nahi. Feed items phir bhi save hote hain (history).
const DEFAULT_NOTIFY_PREFS = { enabled: true, login: true, signup: true, report: true, monthly: true, digest: true, activity: true, click: true, search: true, settings: true, user: true, location: true, info: true, sound: true, push: true };
function normalizeNotifyPrefs(p) {
  const out = { ...DEFAULT_NOTIFY_PREFS };
  if (p && typeof p === 'object') for (const k of Object.keys(DEFAULT_NOTIFY_PREFS)) if (p[k] !== undefined) out[k] = !!p[k];
  return out;
}
function publicUser(u) {
  if (!u) return null;
  return { username: u.username, name: u.name || u.username, email: u.email || '', mobile: u.mobile || '', avatar: u.avatar || '', role: u.role, approved: !!u.approved, permissions: u.role === 'admin' ? allPermKeysNow() : (u.permissions || []), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, mustChangePassword: !!u.mustChangePassword, lastLocation: u.lastLocation || null, notificationsSeenAt: u.notificationsSeenAt || null, notifyAccess: u.role === 'admin' ? true : (u.notifyAccess !== false), notifyPrefs: normalizeNotifyPrefs(u.notifyPrefs) };
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
  // Admin ko HAR notification dikhta hai (sab users ki activity, reports, settings — total panel)
  if (user.role === 'admin') return true;
  // Non-admin user: sirf apne personal target wale notifications dikhte hain (login welcome, password change, account created, broadcast).
  // Aur bhi: admin ne us user ko notification access diya ho tab hi.
  if (user.notifyAccess === false) return false;
  if (item.target === 'broadcast') return true;
  return item.target === `user:${user.username}`;
}
function recordNotification({ type = 'info', title, body, target = 'admin', meta = {} }) {
  const item = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`, type, title: String(title || 'Notification').slice(0, 120), body: String(body || '').slice(0, 800), target, meta, createdAt: new Date().toISOString() };
  notifyItems().push(item);
  if (notifyItems().length > 500) db.notify.items = notifyItems().slice(-500);
  persist('notify');
  pushFanout(item); // 🔔 instant web push — app band ho tab bhi
  return item;
}
function visibleNotifications(user, since) {
  const after = since ? new Date(since).getTime() : 0;
  const prefs = user ? normalizeNotifyPrefs(user.notifyPrefs) : DEFAULT_NOTIFY_PREFS;
  return notifyItems().filter((item) => {
    if (!notificationVisible(item, user)) return false;
    if (after && new Date(item.createdAt).getTime() <= after) return false;
    if (prefs[item.type] === false) return false; // user ne is type ke notifications off kar rakhe hain
    return true;
  }).slice(-80);
}
// ---- change reports: what exactly changed (shown when the admin clicks a notification) ----------
function describeValue(v) {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'string' && /^data:image\//.test(v)) return `[image ${Math.round(v.length * 0.75 / 1024)} KB]`;
  if (typeof v === 'boolean') return v ? 'ON ✓' : 'OFF ✗';
  if (Array.isArray(v)) return v.length > 12 ? `${v.slice(0, 12).join(', ')} … (+${v.length - 12})` : v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 160);
  return String(v).slice(0, 160);
}
function flattenForDiff(obj, prefix = '', out = {}) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) flattenForDiff(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(obj) && obj.length && obj.every((x) => x && typeof x === 'object' && x.id)) {
    for (const item of obj) flattenForDiff(item, `${prefix}[${item.id}]`, out);
  } else out[prefix] = obj;
  return out;
}
function changeList(before, after, { skip = [] } = {}) {
  const a = flattenForDiff(before || {}), b = flattenForDiff(after || {});
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const out = [];
  for (const key of keys) {
    if (skip.some((s) => key === s || key.startsWith(`${s}.`))) continue;
    const x = a[key], y = b[key];
    if (JSON.stringify(x ?? null) === JSON.stringify(y ?? null)) continue;
    out.push({ field: key, before: describeValue(x), after: describeValue(y) });
  }
  return out.slice(0, 120);
}
const userSnapshot = (u) => u ? { name: u.name, email: u.email || '', mobile: u.mobile || '', role: u.role, approved: !!u.approved, permissions: (u.permissions || []).slice().sort(), avatar: u.avatar ? `[photo ${Math.round(String(u.avatar).length * 0.75 / 1024)} KB]` : '' } : {};
function permissionDiff(before, after) {
  const b = new Set(before || []), a = new Set(after || []);
  return { added: [...a].filter((k) => !b.has(k)), removed: [...b].filter((k) => !a.has(k)) };
}
const activityLast = new Map();
// Client routes (app.js PAGES) — notification tap par seedha usi page par le jao.
const CLIENT_PAGES = new Set(['home', 'tagIssued', 'targets', 'rangeReport', 'dashboard', 'trend', 'performance', 'stock', 'stockReport', 'gvDashboard', 'gvTrend', 'gvPerformance', 'gvStock', 'compare', 'charts']);
/** Search/click ki "option" se client route banao (deep link — mobile push tap → seedha page). */
function pageLinkFor(option, query) {
  const t = String(option || '').trim();
  if (!t) return '';
  if (/^sheet:/i.test(t)) return `#/sheet/${encodeURIComponent(t.replace(/^sheet:\s*/i, '').trim())}`;
  // GV wale options pehle — warna "GV Stock Find" generic /stock par chala jaata.
  if (/gv\s*stock/i.test(t)) return '#/gvStock';
  if (/gv\s*trend/i.test(t)) return '#/gvTrend';
  if (/gv\s*performance/i.test(t)) return '#/gvPerformance';
  if (/^gv\b/i.test(t)) return '#/gvDashboard';
  if (/performance/i.test(t)) return `#/performance${query ? `?q=${encodeURIComponent(String(query).slice(0, 60))}` : ''}`;
  if (/stock/i.test(t)) return '#/stock';
  if (/trend/i.test(t)) return '#/trend';
  if (/targets/i.test(t)) return '#/targets';
  if (/range\s*report/i.test(t)) return '#/rangeReport';
  if (/excel\s*bundle/i.test(t)) return '#/dashboard';
  if (/tag\s*issued/i.test(t)) return '#/tagIssued';
  if (/drawer|kpi/i.test(t)) return '#/dashboard';
  return '';
}
// Ephemeral in-memory presence: page + viewport-relative pointer only (never GPS or screen contents).
const livePresence = new Map();
function noteActivity(user, page) {
  if (!user || user.role === 'admin') return null;
  const cleanPage = String(page || 'dashboard').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80) || 'dashboard';
  const key = `${user.username}:${cleanPage}`;
  if (Date.now() - (activityLast.get(key) || 0) < 60e3) return null;
  activityLast.set(key, Date.now());
  return recordNotification({ type: 'activity', title: '👀 User ne page khola', body: `${user.name || user.username} ne "${cleanPage}" open kiya.`, target: 'admin', meta: { username: user.username, page: cleanPage, ...(CLIENT_PAGES.has(cleanPage) ? { link: `#/${cleanPage}` } : {}) } });
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
// ---- 📲 Web Push (VAPID + aes128gcm, zero dependencies) -----------------------------------------
// Admin ko har notification turant phone/desktop par mile — app band ho tab bhi.
//
// ⚠️ VAPID keys DURABLE honi chahiye. Ek browser subscription us applicationServerKey se bandhi hoti
// hai jis key se wo bani thi — keypair badalte hi push service har message ko 403 se reject kar deta
// hai aur phone ke notification panel me kuch nahi aata (in-app bell chalta rehta hai kyunki wo poll
// karta hai). Render par DATA_DIR CONTAINER ki disk hai — har deploy / free-tier spin-down par mit
// jaati hai — jabki users + notifications durable store (Apps Script sheet) me rehte hain. Isliye
// keys is order me resolve hoti hain:
//   1. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env (explicit pin)
//   2. durable store — db.notify.vapid (subscriptions ke saath hi)
//   3. DATA_DIR/vapid.json (local cache / files backend)
//   4. generate once → dono jagah (durable + file) save
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
// 24h TTL: phone off / doze / no-network ho to push service message drop na kare (pehle 120s tha).
const PUSH_TTL = String(Math.min(2419200, Math.max(60, Number(process.env.PUSH_TTL_SECONDS || 86400))));
// 4xx = subscription ya key kharab → drop karo taaki device fresh subscribe kare. 5xx/network = retry.
// ⚠️ 401/403 is list me JAAN-BOOJH kar nahi hain: wo push-service ki auth/header complaint bhi ho
// sakti hai (server config problem) — aisi halat me subscription drop karna galat hai, warna phone
// "permission granted par subscription active nahi" wale loop me phans jaata hai. Faisla message se
// hota hai (classifyPushFailure) + subscription kis VAPID key se bani thi (sub.vapid) se.
const PUSH_DEAD_STATUS = new Set([400, 404, 410, 413]);
// RFC 8292 §2.1 'sub' claim: mailto:/https: contact. FCM + Apple localhost/.local jaise subjects ko
// 403 BadJwtToken se reject kar dete hain, isliye default ek real domain hai (env se override karo).
const VAPID_SUBJECT = (() => {
  const env = String(process.env.VAPID_SUBJECT || '').trim();
  if (env) return /^(mailto:|https:)/i.test(env) ? env : `mailto:${env}`;
  return 'mailto:admin@apnapayment.com';
})();
/**
 * Push service ko bhejne wale auth headers.
 *
 * 🔴 PERMANENT FIX — pehle ka bug: sirf `Authorization: WebPush <jwt>` bheja jaata tha.
 * "WebPush" legacy scheme (draft-ietf-webpush-vapid-01) me public application server key
 * `Crypto-Key: p256ecdsa=<key>` header me bhejna ZAROORI hai. Uske bina FCM (Android Chrome ke
 * saare endpoints) ye 403 deta hai:
 *     permission denied: crypto-key header had no public application server key specified
 * — aur 403 ko "dead subscription" maan kar hum use delete kar dete the, isliye phone ka panel
 * hamesha silent reh jaata tha jabki in-app bell chalta rehta tha.
 *
 * Ab modern RFC 8292 scheme default hai (`Authorization: vapid t=<jwt>, k=<public key>`) — isme
 * public key Authorization header me hi hoti hai, koi Crypto-Key header nahi chahiye. Legacy-only
 * push services ke liye automatic fallback bhi hai (`WebPush` + `Crypto-Key: p256ecdsa=`).
 */
let pushAuthScheme = String(process.env.PUSH_AUTH_SCHEME || '').trim().toLowerCase() === 'legacy' ? 'legacy' : 'vapid';
/** Server-side VAPID config (headers/JWT/key) ki complaint — subscription isme BEKASOOR hai. */
const PUSH_CONFIG_ERROR_RE = /(crypto[- ]?key|public application server key|p256ecdsa|badjwttoken|jwt|vapid|permission denied|unauthorized|unauthorised|invalid[ _-]?(authorization|auth|token|key|header)|missing (required )?(header|key)|not authorized)/i;
/** Subscription khud kharab (key rotate / expired / unregister) — device ko re-subscribe karna chahiye. */
const PUSH_MISMATCH_RE = /(does ?n[o']?t match|not match|mismatch|different (application server )?key|wrong key|expired|invalid[ _-]?registration|not registered|unregistered|subscription (is )?(no longer|invalid|expired))/i;
let pushConfigError = null; // { status, error, at, host } — health + admin banner ke liye
let vapidKeys = null;
let vapidSource = 'none';
let vapidDurable = false; // keys durable store me safe hain? (health + banner ke liye)
const pushTestLast = new Map(); // /api/push/test rate limit (per user)

/**
 * Browser (Chrome/Edge/FCM) applicationServerKey ke roop me 65-byte RAW uncompressed P-256
 * point maangta hai (0x04 || X || Y) — SPKI DER (91 bytes) nahi. Purane build ne DER public key
 * serve ki thi, jisse pushManager.subscribe() "The provided applicationServerKey is not valid"
 * ke saath fail hota tha aur phone ka notification panel hamesha silent rehta tha.
 * Public key HAMESHA private key se derive karo: env / durable store / vapid.json me purana SPKI
 * format pada ho to bhi SAME keypair ke saath heal ho jaayega — koi subscription nahi tootti.
 */
function vapidPublicPoint(keyObject) {
  // Node ke kuch versions createPublicKey(KeyObject) reject karte hain — isliye seedha JWK export
  // karo: EC private AUR public dono JWK me public coordinates (x, y) hote hain.
  const jwk = keyObject.export({ format: 'jwk' });
  const x = Buffer.from(String(jwk.x || ''), 'base64url');
  const y = Buffer.from(String(jwk.y || ''), 'base64url');
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || x.length !== 32 || y.length !== 32) throw new Error('VAPID keypair P-256 (prime256v1) nahi hai');
  return Buffer.concat([Buffer.from([4]), x, y]).toString('base64url');
}
/** Private key dono roop me accept karo: hamara internal PKCS8 DER, YA web-push tool
 *  (`npx web-push generate-vapid-keys`) ka 32-byte raw P-256 scalar — dono se KeyObject banao. */
function privateKeyFromAny(privateKey) {
  const raw = Buffer.from(String(privateKey).trim(), 'base64url');
  if (raw.length === 32) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(raw);
    const pub = ecdh.getPublicKey(); // 65-byte uncompressed point
    return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url'), d: raw.toString('base64url') }, format: 'jwk' });
  }
  return crypto.createPrivateKey({ key: raw, format: 'der', type: 'pkcs8' });
}
function applyVapid(publicKey, privateKey) {
  const privateKeyObj = privateKeyFromAny(privateKey);
  const derived = vapidPublicPoint(privateKeyObj);
  if (publicKey && String(publicKey).trim() !== derived) console.warn('⚠️  Stored VAPID public key purane SPKI-DER format me thi — private key se sahi 65-byte uncompressed point derive kar liya (keypair same, subscriptions safe).');
  vapidKeys = { publicKey: derived, privateKey: privateKeyObj };
  return vapidKeys;
}
function exportVapid() {
  return { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url') };
}
function writeVapidFile() {
  // Cloud backend me DATA_DIR ephemeral container disk hai — wahan file sirf ek within-boot cache hai.
  // Use create mat karo: tests (aur operators) isi se confirm karte hain ki cloud mode local store nahi banata.
  if (CLOUD_BACKEND) return;
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(VAPID_FILE, JSON.stringify(exportVapid()), { mode: 0o600 });
  } catch (err) { console.warn('vapid file cache:', err.message); }
}
/** Keys ko durable store (users/notifications ke saath) me save karo — retries ke saath. */
async function saveVapidDurable() {
  try {
    if (!db.notify || typeof db.notify !== 'object') db.notify = { items: [], watch: {}, push: [] };
    db.notify.vapid = { ...exportVapid(), source: vapidSource, at: new Date().toISOString() };
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { await persist('notify'); vapidDurable = true; return true; } catch (err) {
        console.warn(`vapid durable save (attempt ${attempt}/3):`, err.message);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    console.error('⚠️  VAPID keys durable storage me save NAHI ho payi — next deploy par phone ke push toot sakte hain. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env set karo ya persistent disk lagao.');
    return false;
  } catch (err) { console.warn('vapid durable save:', err.message); return false; }
}
async function loadVapid() {
  const envPub = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPriv = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const durable = db.notify && db.notify.vapid;
  if (envPub && envPriv) {
    try {
      applyVapid(envPub, envPriv);
      vapidSource = 'env'; vapidDurable = true;
      if (durable && durable.publicKey && durable.publicKey !== vapidKeys.publicKey) console.warn('⚠️  VAPID_*_KEY env stored key se alag hai — phones app kholte hi re-subscribe kar lenge.');
      return;
    } catch (err) { console.warn('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY unusable:', err.message); }
  }
  if (durable && durable.publicKey && durable.privateKey) {
    try {
      applyVapid(durable.publicKey, durable.privateKey);
      vapidSource = 'durable'; vapidDurable = true; writeVapidFile();
      // Stored copy purane SPKI-DER format ki ho to healed 65-byte point wapas save kar do —
      // warna agle boot par phir warn karega (aur purane clients ko galat key milti rahegi).
      if (durable.publicKey !== vapidKeys.publicKey) void saveVapidDurable();
      return;
    } catch (err) { console.warn('stored VAPID key unusable, regenerating:', err.message); }
  }
  try {
    const j = JSON.parse(readFileSync(VAPID_FILE, 'utf8'));
    if (j.publicKey && j.privateKey) {
      applyVapid(j.publicKey, j.privateKey);
      vapidSource = 'file';
      vapidDurable = STORAGE_BACKEND === 'files'; // cloud backend me DATA_DIR ephemeral hai
      // Healed (65-byte raw point) copy file me bhi wapas likho — warna har boot par heal hota rahega.
      if (j.publicKey !== vapidKeys.publicKey) writeVapidFile();
      // Boot block mat karo: Apps Script store 'notify' writes ko 4s batch karta hai aur us timer ko
      // unref kar deta hai — await karne par server listen se pehle hi process exit ho jaata tha.
      void saveVapidDurable();
      return;
    }
  } catch { /* first boot */ }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  vapidKeys = { publicKey: vapidPublicPoint(publicKey), privateKey };
  vapidSource = 'generated';
  vapidDurable = STORAGE_BACKEND === 'files';
  writeVapidFile();
  void saveVapidDurable();
  console.log('📲 VAPID keypair generated — durable storage me save ho raha hai taaki push subscriptions redeploy/restart survive karein.');
}
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function hkdfExtract(salt, ikm) { return crypto.createHmac('sha256', salt).update(ikm).digest(); }
function hkdfExpand(prk, info, len) {
  let t = Buffer.alloc(0), out = Buffer.alloc(0), i = 1;
  while (out.length < len) { t = crypto.createHmac('sha256', prk).update(Buffer.concat([t, Buffer.from(info), Buffer.from([i])])).digest(); out = Buffer.concat([out, t]); i++; }
  return out.subarray(0, len);
}
function vapidJwt(endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  // exp ≤ 24h (RFC 8292) aur aud = push resource ka origin — dono push services strictly check karti hain.
  const payload = b64url(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT }));
  const sig = crypto.createSign('sha256').update(`${header}.${payload}`).sign({ key: vapidKeys.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}
/**
 * Auth headers — 'vapid' (RFC 8292, default) ya 'legacy' (draft-01: WebPush + Crypto-Key).
 * Dono me public key 65-byte raw uncompressed point (base64url) hi jaati hai.
 */
function vapidHeaders(endpoint, scheme) {
  const jwt = vapidJwt(endpoint);
  const pub = vapidKeys.publicKey;
  if (scheme === 'legacy') return { Authorization: `WebPush ${jwt}`, 'Crypto-Key': `p256ecdsa=${pub}` };
  return { Authorization: `vapid t=${jwt}, k=${pub}` };
}
/** 400/401/403 ka matlab: hamari config kharab, ya subscription kharab? */
function classifyPushFailure(status, error) {
  const text = String(error || '');
  if (status === 0) return 'transient';
  if (!PUSH_DEAD_STATUS.has(status) && ![401, 403].includes(status)) return 'transient';
  if (PUSH_MISMATCH_RE.test(text)) return 'mismatch';
  if (PUSH_CONFIG_ERROR_RE.test(text)) return 'config';
  // Message pehchaan me nahi aaya: 400/404/410/413 = subscription dead. 401/403 = server ki
  // auth problem maano (subscription drop karne se user ka panel hamesha ke liye toot jaata tha).
  return PUSH_DEAD_STATUS.has(status) ? 'mismatch' : 'config';
}
/**
 * Boot-time self test: apni hi public key se JWT verify karo + key ka format check karo.
 * Isse deploy ke turant baad pata chal jaata hai ki push bhejne layak hai ya nahi — phone par
 * trial karne ki zaroorat nahi. /api/health me bhi dikhta hai.
 */
function vapidSelfTest() {
  if (!vapidKeys) return { ok: false, error: 'VAPID keys load nahi hui' };
  const endpoint = 'https://fcm.googleapis.com/fcm/send/selftest';
  try {
    const bytes = Buffer.from(vapidKeys.publicKey, 'base64url');
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error(`public key ${bytes.length} bytes ki hai — browser/push service 65-byte raw point (0x04||X||Y) maangte hain`);
    const [h, p, s] = vapidJwt(endpoint).split('.');
    const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: bytes.subarray(1, 33).toString('base64url'), y: bytes.subarray(33, 65).toString('base64url') }, format: 'jwk' });
    if (!crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))) throw new Error('JWT apni hi public key se verify nahi hua (keypair corrupt)');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (claims.aud !== 'https://fcm.googleapis.com') throw new Error('JWT ka aud claim push service origin nahi hai');
    if (!/^(mailto:|https:)/.test(claims.sub)) throw new Error(`JWT ka sub claim mailto:/https: hona chahiye, mila: ${claims.sub}`);
    if (/localhost|\.local$/i.test(claims.sub)) throw new Error(`sub claim "${claims.sub}" localhost jaisa hai — FCM/Apple ise 403 BadJwtToken dete hain (VAPID_SUBJECT env set karo)`);
    const headers = vapidHeaders(endpoint, pushAuthScheme);
    if (pushAuthScheme === 'legacy' && !headers['Crypto-Key']) throw new Error('legacy scheme me Crypto-Key header missing');
    if (pushAuthScheme !== 'legacy' && !/k=/.test(headers.Authorization)) throw new Error('vapid scheme me public key (k=) missing — push service 403 degi');
    return { ok: true, scheme: pushAuthScheme, subject: claims.sub, publicKeyBytes: bytes.length, durable: vapidDurable, source: vapidSource };
  } catch (err) {
    return { ok: false, scheme: pushAuthScheme, subject: VAPID_SUBJECT, durable: vapidDurable, source: vapidSource, error: err.message };
  }
}
/** RFC 8291 aes128gcm encrypted push body. */
function encryptPush(subscription, data) {
  const uaPub = Buffer.from(subscription.keys.p256dh, 'base64url');
  const authSecret = Buffer.from(subscription.keys.auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPub);
  // RFC 8291 §3.4: ikm = HKDF-Expand(HKDF-Extract(auth_secret, ecdh_secret), "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const ikm = hkdfExpand(hkdfExtract(authSecret, sharedSecret), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, serverPub]), 32);
  const salt = crypto.randomBytes(16);
  const cek = hkdfExpand(hkdfExtract(salt, ikm), 'Content-Encoding: aes128gcm\0', 16);
  const nonce = hkdfExpand(hkdfExtract(salt, ikm), 'Content-Encoding: nonce\0', 12);
  const plain = Buffer.concat([Buffer.from(JSON.stringify(data), 'utf8'), Buffer.from([2])]); // pad 0x02 = final record
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const body = Buffer.concat([salt, Buffer.from([0, 0, 16, 0]), Buffer.from([65]), serverPub, ct]); // rs=4096, idlen=65
  return body;
}
function pushSubs() {
  if (!db.notify || typeof db.notify !== 'object') db.notify = { items: [], watch: {}, push: [] };
  if (!Array.isArray(db.notify.push)) db.notify.push = [];
  return db.notify.push;
}
function pushLog() {
  if (!db.notify || typeof db.notify !== 'object') db.notify = { items: [], watch: {}, push: [] };
  if (!Array.isArray(db.notify.pushLog)) db.notify.pushLog = [];
  return db.notify.pushLog;
}
const hostOf = (sub) => { try { return new URL(sub.endpoint).host; } catch { return 'unknown'; } };
function dropSub(sub) {
  const arr = pushSubs();
  const i = arr.indexOf(sub);
  if (i >= 0) arr.splice(i, 1);
}
/** Har delivery ka result record karo — mobile panel debug karne ke liye (silent failure nahi). */
function logPushEvent(ev) {
  const log = pushLog();
  log.push({ at: new Date().toISOString(), ...ev });
  if (log.length > 40) db.notify.pushLog = log.slice(-40);
}
async function pushRequest(sub, body, scheme) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { ...vapidHeaders(sub.endpoint, scheme), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: PUSH_TTL, Urgency: 'high' },
    body, signal: AbortSignal.timeout(15000)
  });
  const status = res.status;
  if (status >= 200 && status < 300) return { ok: true, status, scheme };
  const text = await res.text().catch(() => '');
  return { ok: false, status, scheme, error: String(text || res.statusText || '').slice(0, 200) };
}
async function deliverPush(sub, data) {
  if (!vapidKeys) return { ok: false, status: 0, error: 'VAPID keys not loaded', kind: 'config' };
  // Subscription kis VAPID key se bani thi? Key rotate ho gayi ho to request bhejne se pehle hi
  // bata do — push service ka 403 guess karne ki zaroorat nahi (device khud re-subscribe karega).
  if (sub.vapid && sub.vapid !== vapidKeys.publicKey) {
    return { ok: false, status: 0, error: 'subscription purani VAPID key se bani hai (key rotate hui) — device re-subscribe karega', kind: 'mismatch' };
  }
  let body;
  try { body = encryptPush(sub, data); } catch (err) { return { ok: false, status: 0, error: `encrypt failed: ${err.message}`, kind: 'config' }; }
  // Pehle preferred scheme; auth/header wali complaint (403 crypto-key / jwt) aaye to dusri scheme
  // se ek retry — isse koi bhi push service (FCM, Mozilla, Apple) miss nahi hoti.
  const order = pushAuthScheme === 'legacy' ? ['legacy', 'vapid'] : ['vapid', 'legacy'];
  let result = null;
  for (let i = 0; i < order.length; i++) {
    const scheme = order[i];
    try {
      result = await pushRequest(sub, body, scheme);
    } catch (err) {
      // Network hiccup / timeout — subscription rakho, next event par retry hoga.
      return { ok: false, status: 0, error: err.message, transient: true, kind: 'transient', scheme };
    }
    if (result.ok) {
      if (scheme !== pushAuthScheme) {
        pushAuthScheme = scheme;
        console.log(`📲 Push auth scheme "${scheme}" kaam kar gaya — aage ke saare push isi se bhejenge.`);
      }
      return result;
    }
    if (classifyPushFailure(result.status, result.error) !== 'config') break; // subscription dead → doosri scheme bekar
  }
  if (result) result.kind = classifyPushFailure(result.status, result.error);
  return result;
}
/** Delivery result ko handle karo: log + sirf genuinely dead subscription drop (taaki phone re-subscribe kare). */
function handlePushResult(sub, result, extra) {
  const host = hostOf(sub);
  if (result.ok) {
    if (pushConfigError) { pushConfigError = null; console.log('📲 Push delivery wapas sahi ho gayi — config warning hata di.'); }
    logPushEvent({ username: sub.username, host, status: result.status, ok: true, scheme: result.scheme || pushAuthScheme, ...extra });
    return true;
  }
  const kind = result.kind || classifyPushFailure(result.status, result.error);
  const transient = kind === 'transient' || !!result.transient;
  const dead = !transient && (kind === 'mismatch' || PUSH_DEAD_STATUS.has(result.status));
  const config = !transient && !dead;
  const verdict = dead ? 'subscription drop (device re-subscribe karega)' : config ? 'SERVER CONFIG problem — subscription rakhi gayi' : 'transient, subscription kept';
  console.warn(`push delivery failed: status ${result.status || 'network'} · ${host} · ${sub.username || '?'}${extra && extra.type ? ` · ${extra.type}` : ''} · scheme ${result.scheme || pushAuthScheme} · ${result.error || ''} — ${verdict}`);
  logPushEvent({ username: sub.username, host, status: result.status, ok: false, error: String(result.error || '').slice(0, 200), dead, config, scheme: result.scheme || pushAuthScheme, ...extra });
  if (config) {
    pushConfigError = { status: result.status, error: String(result.error || '').slice(0, 300), host, at: new Date().toISOString(), hint: 'Push service ne VAPID auth reject ki. /api/health ka push.selfTest dekho; zaroorat ho to VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env set karo.' };
    if (!db.notify || typeof db.notify !== 'object') db.notify = { items: [], watch: {}, push: [] };
    db.notify.pushHealth = pushConfigError;
  } else if (pushConfigError && db.notify) {
    delete db.notify.pushHealth;
  }
  if (dead) dropSub(sub);
  return false;
}
/**
 * Jinki subscription kisi PURANI VAPID key se bani thi unhe boot par hi hata do. Push service unhe
 * hamesha 403 degi; pehle wo har fan-out par fail hoti thin aur device ka panel silent reh jaata tha.
 * Hataane se client (notifications.js / sw.js) app khulte hi nayi subscription bana leta hai.
 */
function pruneStalePushSubs() {
  if (!vapidKeys) return 0;
  const arr = pushSubs();
  const keep = arr.filter((s) => !s.vapid || s.vapid === vapidKeys.publicKey);
  const removed = arr.length - keep.length;
  if (removed > 0) {
    db.notify.push = keep;
    console.warn(`📲 ${removed} purani VAPID key wali subscription hata di — ye devices app khulte hi dobara subscribe kar lenge.`);
    persist('notify').catch(() => {});
  }
  return removed;
}
/** Global push health — /api/health (public) me dikhta hai taaki deploy ke turant baad confirm ho. */
function pushHealth() {
  const selfTest = vapidSelfTest();
  const warnings = [];
  if (!vapidKeys) warnings.push('VAPID keypair load nahi hui — mobile push band hai.');
  else if (!vapidDurable) warnings.push('VAPID keys sirf temporary container disk par hain — deploy/restart par phone push toot jaayenge. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env set karo.');
  if (!selfTest.ok) warnings.push(`VAPID self-test fail: ${selfTest.error}`);
  if (pushConfigError) warnings.push(`Push service ne delivery reject ki (${pushConfigError.status}): ${pushConfigError.error}`);
  return {
    enabled: !!vapidKeys,
    keySource: vapidSource,
    durable: vapidDurable,
    scheme: pushAuthScheme,
    subject: VAPID_SUBJECT,
    devices: pushSubs().length,
    ttl: Number(PUSH_TTL),
    selfTest,
    configError: pushConfigError,
    warning: warnings.join(' ') || null
  };
}
/** Keys durable store me na ja saki ho (Apps Script timeout) to background me retry karte raho. */
function ensureVapidDurable() {
  if (vapidDurable || STORAGE_BACKEND === 'files') return;
  const timer = setInterval(() => {
    if (vapidDurable) { clearInterval(timer); return; }
    console.warn('📲 VAPID keys abhi durable nahi hain — dobara save karne ki koshish…');
    void saveVapidDurable();
  }, 60e3);
  timer.unref();
}
/** Push health for the signed-in user (bell panel + Settings → Push diagnostics). */
function pushStatusFor(user) {
  const mine = pushSubs().filter((s) => s.username === user.username);
  const events = pushLog().filter((e) => e.username === user.username).slice(-10).reverse();
  const lastError = events.find((e) => !e.ok) || null;
  const lastOk = events.find((e) => e.ok) || null;
  const prefs = normalizeNotifyPrefs(user.notifyPrefs);
  const staleKey = mine.filter((s) => s.vapid && vapidKeys && s.vapid !== vapidKeys.publicKey).length;
  return {
    ok: true,
    supported: !!vapidKeys,
    keySource: vapidSource,
    keyDurable: vapidDurable,
    scheme: pushAuthScheme,
    subject: VAPID_SUBJECT,
    selfTest: vapidSelfTest(),
    configError: pushConfigError,
    publicKey: vapidKeys ? vapidKeys.publicKey : '',
    ttl: Number(PUSH_TTL),
    subs: mine.length,
    staleKeySubs: staleKey,
    devices: mine.map((s) => ({ host: hostOf(s), at: s.at || '', staleKey: !!(s.vapid && vapidKeys && s.vapid !== vapidKeys.publicKey) })),
    enabled: prefs.enabled !== false,
    prefsPush: prefs.push !== false,
    notifyAccess: user.role === 'admin' || user.notifyAccess !== false,
    lastOk: lastOk ? { at: lastOk.at, status: lastOk.status, host: lastOk.host } : null,
    lastError: lastError ? { at: lastError.at, status: lastError.status, error: lastError.error, host: lastError.host, dead: !!lastError.dead, config: !!lastError.config } : null,
    // Admin ko poora picture: sab devices + global config health (normal user ko sirf apna).
    ...(user.role === 'admin' ? { allSubs: pushSubs().length, totalDevices: pushSubs().length } : {})
  };
}
/** Fan-out a notification to push subscriptions (admin-targeted → admin subs, broadcast → everyone). Per-user push + sound preference bhi respect karo. */
function pushFanout(item) {
  if (!vapidKeys || !item) return;
  const subs = pushSubs().filter((s) => {
    const u = findUser(s.username);
    if (!u) return false;
    if (u.role !== 'admin' && u.notifyAccess === false) return false;
    const prefs = normalizeNotifyPrefs(u.notifyPrefs);
    if (prefs.enabled === false) return false; // master switch OFF → koi push nahi
    if (prefs.push === false) return false;
    if (prefs[item.type] === false) return false;
    // Admin ko HAR notification push hota hai; normal user ko sirf apna personal/broadcast
    if (u.role === 'admin') return true;
    if (item.target === 'broadcast') return true;
    return item.target === `user:${s.username}`;
  });
  if (!subs.length) return;
  Promise.all(subs.map(async (s) => {
    const u = findUser(s.username);
    const prefs = u ? normalizeNotifyPrefs(u.notifyPrefs) : DEFAULT_NOTIFY_PREFS;
    const data = {
      title: item.title,
      body: (item.body || '').replace(/\s+/g, ' ').slice(0, 180),
      tag: item.type || 'ff',
      link: (item.meta && item.meta.link) || '',
      sound: prefs.sound !== false,
      persist: item.type === 'signup' || item.type === 'report' || item.type === 'user' // important types don't auto-dismiss
    };
    handlePushResult(s, await deliverPush(s, data), { type: item.type });
  })).then(() => persist('notify')).catch(() => {});
}
// ---- monthly auto-report: har mahine ki 1–5 tarikh ko pichhle mahine ka FF-vs-GV compare broadcast ----
function maybeMonthlyReport() {
  try {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (!db.notify.watch || typeof db.notify.watch !== 'object') db.notify.watch = {};
    if (now.getDate() > 5 || db.notify.watch.monthlyReport === ym) return;
    db.notify.watch.monthlyReport = ym;
    const [y, m] = ym.split('-').map(Number);
    const prevY = m === 1 ? y - 1 : y, prevM = m === 1 ? 12 : m - 1;
    const prev = `${prevY}-${String(prevM).padStart(2, '0')}`;
    const prevPrev = prevM === 1 ? `${prevY - 1}-12` : `${prevY}-${String(prevM - 1).padStart(2, '0')}`;
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    recordNotification({
      type: 'monthly',
      title: `📅 Monthly report ready · ${MON[prevM - 1]} ${prevY}`,
      body: `${MON[prevM - 1]} ${prevY} ka FF vs GV comparison ready hai. Click karke Compare page par dono months side-by-side dekho.`,
      target: 'broadcast',
      meta: { monthlyReport: prev, link: `#/compare?monthA=${prev}&monthB=${prevPrev}` }
    });
    console.log(`monthly report notification sent for ${prev}`);
  } catch (err) { console.warn('monthly report:', err.message); }
}
// ---- 🌅 daily digest: roz ek baar (IST subah 8 ke baad) — kal ki issuance, MTD, abhi ka stock ----
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function istNow() { return new Date(Date.now() + 5.5 * 3600e3); } // sirf date/hour ke liye (UTC+5:30)
/** StockDataa ka current total + class split (ek gviz group-by query). */
async function stockSnapshot() {
  try {
    const s = db.settings;
    const cfg = s.stock || {};
    const clsCol = cfg.cls || 'E', tagCol = cfg.tagId || 'C';
    const sheet = s.stockSheet || 'StockDataa';
    const tq = `select ${clsCol}, count(${tagCol}) where ${tagCol} is not null group by ${clsCol}`;
    const params = new URLSearchParams({ id: String(s.sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet, tq });
    const out = await fetchUpstream(upstreamUrl(params));
    if (out.status < 200 || out.status >= 300) throw new Error(`Google responded ${out.status}`);
    const table = parseGvizServer(out.body);
    const classes = {}; let total = 0;
    for (const row of table.rows || []) {
      const n = serverNumber(serverCell(row, 1));
      if (!n) continue;
      const b = classBucket(serverCell(row, 0));
      classes[b] = (classes[b] || 0) + n;
      total += n;
    }
    return total ? { total, classes } : null;
  } catch (err) { console.warn('digest stock snapshot:', err.message); return null; }
}
/**
 * Subah ek baar admin ko ek compact digest push: kal ki FF/GV issuance, MTD + avg per day,
 * abhi ka stock (VC4/Comm) aur approx VC4 cover (threshold emoji ke saath).
 * Server free-tier par sote waqt fir jaata hai — isliye window "8 baje ke baad, roz ek baar" hai
 * (pehla wake-up us din digest bhej dega). force=true se Settings ka button kabhi bhi bhej sakta hai.
 */
async function maybeDailyDigest(force = false) {
  try {
    if (!db.notify || typeof db.notify !== 'object') db.notify = { items: [], watch: {} };
    if (!db.notify.watch || typeof db.notify.watch !== 'object') db.notify.watch = {};
    const ist = istNow();
    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
    if (!force) {
      if (ist.getUTCHours() < 8) return null; // subah 8 baje se pehle nahi
      if (db.notify.watch.digestDate === dateKey) return null; // aaj ka digest already gaya
    }
    await checkReports(false).catch(() => {}); // taaza FF/GV snapshots (5-min throttle respected)
    const ff = db.notify.watch.ff && db.notify.watch.ff.date ? db.notify.watch.ff : null;
    const gv = db.notify.watch.gv && db.notify.watch.gv.date ? db.notify.watch.gv : null;
    const daily = db.notify.watch.daily && typeof db.notify.watch.daily === 'object' ? db.notify.watch.daily : {};
    const monthKey = dateKey.slice(0, 7);
    let ffMtd = 0, mtdDays = 0;
    for (const [d, v] of Object.entries(daily)) if (d.startsWith(monthKey) && v && Number(v.ff)) { ffMtd += Number(v.ff); mtdDays++; }
    const stock = await stockSnapshot();
    const th = db.settings.thresholds || {};
    const coverRed = Number(th.coverRed) || 7, coverOrange = Number(th.coverOrange) || 15, coverAmber = Number(th.coverAmber) || 30;
    const parts = [];
    const topClass = (classes) => { const e = Object.entries(classes || {}).sort((a, b) => b[1] - a[1])[0]; return e ? `${e[0]} ${e[1]}` : ''; };
    const dLabel = (iso) => { const d = Number(String(iso).slice(8, 10)), m = Number(String(iso).slice(5, 7)) - 1; return `${d} ${MON_SHORT[m] || ''}`.trim(); };
    if (ff) parts.push(`🟦 FF ${dLabel(ff.date)} · ${ff.total} tags${topClass(ff.classes) ? ` (${topClass(ff.classes)})` : ''}`);
    if (gv) parts.push(`🟩 GV · ${gv.total} tags${topClass(gv.classes) ? ` (${topClass(gv.classes)})` : ''}`);
    const avg = mtdDays ? ffMtd / mtdDays : 0;
    if (mtdDays) parts.push(`📈 MTD ${ffMtd} · ${mtdDays} din · ≈${Math.round(avg)}/din`);
    if (stock) {
      const vc4 = (stock.classes && stock.classes.VC4) || 0;
      parts.push(`📦 Stock ${stock.total} (VC4 ${vc4} | Comm ${stock.total - vc4})`);
      if (vc4 && avg > 0) {
        const cover = vc4 / avg;
        const emo = cover < coverRed ? '🔴' : cover < coverOrange ? '🟠' : cover < coverAmber ? '🟡' : '🟢';
        parts.push(`VC4 cover ≈ ${Math.round(cover)} din ${emo}`);
      }
    }
    if (!parts.length) parts.push('Abhi tak koi fresh sheet data nahi mila — sheet update hote hi kal ye digest sahi numbers dikhayega.');
    const item = recordNotification({
      type: 'digest',
      title: `🌅 Daily digest · ${dLabel(dateKey)}`,
      body: parts.join(' · '),
      target: 'admin',
      meta: { date: dateKey, link: '#/dashboard', ffMtd, mtdDays, stock: stock ? stock.total : null }
    });
    db.notify.watch.digestDate = dateKey;
    persist('notify').catch(() => {});
    console.log(`daily digest sent for ${dateKey} (${parts.length} lines)`);
    return item;
  } catch (err) { console.warn('daily digest:', err.message); return null; }
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
        // Per-date issuance history (daily digest ke liye): jab tak server alive hai, har snapshot
        // date ka latest total store hota rehta hai — digest MTD / avg / cover nikaal sakta hai.
        if (next && next.date && next.total) {
          if (!db.notify.watch.daily || typeof db.notify.watch.daily !== 'object') db.notify.watch.daily = {};
          const prevEntry = db.notify.watch.daily[next.date] || {};
          if (prevEntry[source] !== next.total) {
            db.notify.watch.daily[next.date] = { ...prevEntry, [source]: next.total };
            const keys = Object.keys(db.notify.watch.daily).sort();
            for (let i = 0; i < keys.length - 400; i++) delete db.notify.watch.daily[keys[i]];
          }
        }
        const delta = snapshotDelta(previous, next);
        if (delta && delta.changed && (delta.total > 0 || next.date !== previous.date)) {
          const label = source === 'gv' ? 'GV Partner' : 'First Forward';
          recordNotification({ type: 'report', title: `${label} report update`, body: `${next.date}: ${deltaText(delta)} — Google Sheet me naya data aaya.`, target: 'admin', meta: { source, snapshot: next, previous, delta } });
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
    // pendingSignups sirf admin ko (sidebar badge ke liye) — public health me leak nahi.
    return sendJson(res, 200, { ok: true, service: 'first-forward-dashboard', version: '3.2.0', storage: storageStatus(), push: pushHealth(), users: db.users.length, cached: cache.size, cacheSeconds: cacheMs() / 1000, dataDir: STORAGE_BACKEND === 'files' ? DATA_DIR : null, ...(user && user.role === 'admin' ? { pendingSignups: db.users.filter((u) => !u.approved).length } : {}) });
  }
  if (p === '/api/public-config' && method === 'GET') return sendJson(res, 200, publicSettings());

  // ---- auth ----
  if (p === '/api/auth/me' && method === 'GET') {
    return sendJson(res, 200, { user: publicUser(user), settings: user ? db.settings : publicSettings(), permissions: permissionsFor(db.settings), tabs: db.settings.tabs, ...(user && user.role === 'admin' ? { storage: storageStatus(), pendingSignups: db.users.filter((u) => !u.approved).length } : {}) });
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
      recordNotification({ type: 'user', title: 'Welcome — Admin account ready', body: 'Aap first user hain, admin privileges mil gaye hain. Settings se branding aur data source set kar sakte ho.', target: `user:${username}`, meta: { first: true } });
      return sendJson(res, 200, { ok: true, user: publicUser(u), settings: db.settings, permissions: permissionsFor(db.settings), tabs: db.settings.tabs, first: true }, { 'Set-Cookie': cookieHeader(req, token, SESSION_DAYS * 86400) });
    }
    // 🔔 Admin ko turant notification (type 'signup' — Settings me "New account signup" toggle isi ko
    // control karta hai) + new user ko welcome notification
    recordNotification({ type: 'signup', title: '🆕 Naya signup', body: `${u.name || username} ne account banaya hai (${u.email || u.mobile || 'no contact'}). Approval pending.`, target: 'admin', meta: { username, name: u.name, email: u.email, mobile: u.mobile, link: '#/settings?tab=users' } });
    recordNotification({ type: 'user', title: 'Account created ✓', body: 'Aapka account ban gaya hai. Admin approve karega, phir aap login kar paoge.', target: `user:${username}` });
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
    const ipLabel = ip ? ` · IP ${ip}` : '';
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    // 🔔 Admin ko user login notification (throttle: repeat every 10 min per user)
    if (u.role !== 'admin') {
      const k = `login:${u.username}`;
      if (!activityLast.has(k) || Date.now() - activityLast.get(k) > 10 * 60e3) {
        activityLast.set(k, Date.now());
        recordNotification({ type: 'login', title: '🔐 User login', body: `${u.name || u.username} logged in via ${loginId}${ipLabel}.`, target: 'admin', meta: { username: u.username, loginId, ip, link: '#/settings?tab=users' } });
      }
    }
    // 🔔 User ko bhi unka apna login confirm / security notice (throttled 1/min)
    const selfKey = `self-login:${u.username}`;
    if (!activityLast.has(selfKey) || Date.now() - activityLast.get(selfKey) > 60e3) {
      activityLast.set(selfKey, Date.now());
      recordNotification({ type: 'login', title: `${greeting}, ${u.name || u.username} 👋`, body: 'Login successful. Dashboard ready hai — data background me load ho raha hai.', target: `user:${u.username}`, meta: { loginId, ip } });
    }
    return sendJson(res, 200, { ok: true, user: publicUser(u), settings: db.settings, permissions: permissionsFor(db.settings), tabs: db.settings.tabs }, { 'Set-Cookie': cookieHeader(req, token, SESSION_DAYS * 86400) });
  }
  // ---- admin-only live presence ---------------------------------------------------------------
  if (p === '/api/presence' && method === 'POST') {
    if (!user) throw new HttpError(401, 'Login required');
    if (user.role === 'admin') return sendJson(res, 200, { ok: true });
    const body = await readBody(req);
    const cleanText = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, n);
    const page = String(body.page || 'dashboard').replace(/[^a-zA-Z0-9 _/#?&=.%:-]/g, '').slice(0, 160) || 'dashboard';
    const previous = livePresence.get(user.username) || { events: [] };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
    const pointer = Object.prototype.hasOwnProperty.call(body, 'pointer')
      ? (body.pointer && typeof body.pointer === 'object' ? { x: clamp(body.pointer.x, 0, 100), y: clamp(body.pointer.y, 0, 100), down: !!body.pointer.down } : null)
      : previous.pointer || null;
    const viewport = body.viewport && typeof body.viewport === 'object' ? { w: clamp(body.viewport.w, 200, 8000), h: clamp(body.viewport.h, 200, 8000) } : previous.viewport || null;
    const scroll = body.scroll && typeof body.scroll === 'object' ? { y: clamp(body.scroll.y, 0, 1e6), h: clamp(body.scroll.h, 0, 1e6), el: cleanText(body.scroll.el, 20) } : previous.scroll || null;
    const events = Array.isArray(previous.events) ? previous.events.slice() : [];
    if (Array.isArray(body.events)) {
      for (const ev of body.events.slice(-20)) {
        if (!ev || typeof ev !== 'object') continue;
        events.push({ at: Number(ev.at) || Date.now(), kind: cleanText(ev.kind, 20) || 'action', label: cleanText(ev.label, 140), page: cleanText(ev.page, 80) });
      }
    }
    const now = Date.now();
    const lastSeen = body.engaged === true ? now : (previous.lastSeen || now);
    livePresence.set(user.username, { username: user.username, name: user.name || user.username, mobile: user.mobile || '', page, title: cleanText(body.title, 80) || previous.title || '', overlay: body.overlay !== undefined ? cleanText(body.overlay, 120) : (previous.overlay || ''), visible: body.visible !== false, pointer, viewport, scroll, events: events.slice(-60), lastSeen, updatedAt: now });
    for (const [key, entry] of livePresence) if (Date.now() - entry.lastSeen > 7 * 86400e3) livePresence.delete(key);
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/presence' && method === 'GET') {
    if (!user || user.role !== 'admin') throw new HttpError(403, 'Admin only');
    const now = Date.now();
    const one = url.searchParams.get('user');
    if (one) {
      const entry = livePresence.get(normUser(one));
      if (!entry) return sendJson(res, 200, { person: null, checkAt: new Date(now).toISOString() });
      return sendJson(res, 200, { person: { ...entry, active: now - entry.lastSeen < 90e3, online: now - (entry.updatedAt || entry.lastSeen) < 45e3 }, checkAt: new Date(now).toISOString() });
    }
    const people = [...livePresence.values()].filter((entry) => now - entry.lastSeen < 7 * 86400e3)
      .sort((a,b) => b.lastSeen - a.lastSeen)
      .map(({ events, ...entry }) => ({ ...entry, lastEvent: events && events.length ? events[events.length - 1] : null, active: now - entry.lastSeen < 90e3, online: now - (entry.updatedAt || entry.lastSeen) < 45e3 }));
    return sendJson(res, 200, { people, checkAt: new Date(now).toISOString() });
  }
  // ---- activity + notifications ---------------------------------------------------------------
  if (p === '/api/notifications' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    checkReports().catch(() => {});
    maybeMonthlyReport();
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
  // ---- notification preferences (per user: which types show, sound on/off, mobile push) ----
  if (p === '/api/notifications/digest' && method === 'POST') {
    if (!user) throw new HttpError(401, 'Login required');
    requireAdmin(user);
    const item = await maybeDailyDigest(true);
    return sendJson(res, 200, { ok: !!item, item: item || null });
  }
  if (p === '/api/notifications/prefs' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    return sendJson(res, 200, { prefs: normalizeNotifyPrefs(user.notifyPrefs), defaults: DEFAULT_NOTIFY_PREFS });
  }
  if (p === '/api/notifications/prefs' && method === 'PUT') {
    if (!user) throw new HttpError(401, 'Login required');
    const body = await readBody(req);
    const patch = body.prefs || {};
    const before = normalizeNotifyPrefs(user.notifyPrefs);
    const next = { ...before };
    for (const k of Object.keys(DEFAULT_NOTIFY_PREFS)) if (patch[k] !== undefined) next[k] = !!patch[k];
    user.notifyPrefs = next;
    persist('users').catch(() => {}); // don't block
    return sendJson(res, 200, { ok: true, prefs: next });
  }
  // ---- 📲 web push subscription ----
  if (p === '/api/push/vapid' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    return sendJson(res, 200, { publicKey: vapidKeys ? vapidKeys.publicKey : '', ttl: Number(PUSH_TTL), keySource: user.role === 'admin' ? vapidSource : undefined });
  }
  // Push health: kitne devices registered hain, last delivery ka result — mobile panel debug karne ke liye.
  if (p === '/api/push/status' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    return sendJson(res, 200, pushStatusFor(user));
  }
  // Apne hi devices par ek test push bhejo — panel me aaya ya nahi, turant confirm hota hai.
  if (p === '/api/push/test' && method === 'POST') {
    if (!user) throw new HttpError(401, 'Login required');
    const now = Date.now();
    if (pushTestLast.get(user.username) && now - pushTestLast.get(user.username) < 5000) throw new HttpError(429, 'Test push 5 second me ek baar — thoda ruko.');
    pushTestLast.set(user.username, now);
    const mine = pushSubs().filter((s) => s.username === user.username);
    if (!mine.length) {
      return sendJson(res, 200, { ok: false, delivered: 0, failed: 0, results: [], hint: 'Is account par koi push device register nahi hai. Bell panel me "📲 Mobile notifications on karo" dabao (mobile par PWA install karke).' });
    }
    const results = await Promise.all(mine.map(async (s) => {
      const result = await deliverPush(s, {
        title: '🔔 Test push notification',
        body: `${user.name || user.username} — ye test alert hai. Phone ke notification panel me dikhna chahiye (app band ho tab bhi).`,
        tag: 'ff-test', link: '#/home', sound: true, persist: false
      });
      handlePushResult(s, result, { type: 'test' });
      return { host: hostOf(s), status: result.status, ok: result.ok, error: result.error || '' };
    }));
    persist('notify').catch(() => {});
    return sendJson(res, 200, { ok: results.every((r) => r.ok), delivered: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
  }
  if (p === '/api/push/subscribe' && method === 'POST') {
    if (!user) throw new HttpError(401, 'Login required');
    if (user.role !== 'admin' && user.notifyAccess === false) throw new HttpError(403, 'Notifications access disabled by admin.');
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub || !String(sub.endpoint || '').startsWith('http') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new HttpError(400, 'Subscription invalid hai.');
    const arr = pushSubs();
    const clean = { username: user.username, endpoint: String(sub.endpoint).slice(0, 600), keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) }, at: new Date().toISOString(), vapid: vapidKeys ? vapidKeys.publicKey : '' };
    // Same device (same p256dh key) ka purana endpoint replace karo — warna dead subscriptions
    // accumulate hoti hain aur har fan-out par bekar ke failed requests jaate hain.
    const i = arr.findIndex((s) => s.endpoint === clean.endpoint || (s.username === clean.username && s.keys.p256dh === clean.keys.p256dh));
    if (i >= 0) arr[i] = clean; else arr.push(clean);
    if (arr.length > 300) arr.splice(0, arr.length - 300);
    await persist('notify');
    return sendJson(res, 200, { ok: true, subs: arr.filter((s) => s.username === user.username).length, total: arr.length });
  }
  if (p === '/api/push/unsubscribe' && method === 'POST') {
    if (!user) throw new HttpError(401, 'Login required');
    const body = await readBody(req);
    const ep = String((body && body.endpoint) || '');
    db.notify.push = pushSubs().filter((s) => s.endpoint !== ep);
    await persist('notify');
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/activity' && method === 'POST') {
    if (!user) throw new HttpError(401, 'Login required');
    const body = await readBody(req);
    const type = String(body.type || (body.query ? 'search' : 'activity'));
    if (type === 'search' || body.query) {
      const q = String(body.query || '').trim().slice(0, 120);
      const opt = String(body.option || body.page || 'Search').trim().slice(0, 80);
      if (q && user.role !== 'admin') {
        // Search notifications SIRF admin ko (throttle: same query 15s me ek baar per user)
        const sk = `search:${user.username}:${q}`;
        if (!activityLast.has(sk) || Date.now() - activityLast.get(sk) > 15e3) {
          activityLast.set(sk, Date.now());
          recordNotification({
            type: 'search',
            title: `🔍 Search: ${q}`,
            body: `${user.name || user.username}${user.mobile ? ` (${user.mobile})` : ''} ne ${opt} me "${q}" search kiya.`,
            target: 'admin',
            meta: { username: user.username, name: user.name, mobile: user.mobile, option: opt, query: q, link: pageLinkFor(opt, q) }
          });
        }
      }
    } else if (type === 'click' || body.action === 'click') {
      const opt = String(body.option || body.page || 'Option').trim().slice(0, 80);
      const det = String(body.details || '').trim().slice(0, 120);
      if (user.role !== 'admin') {
        // Click/use notifications SIRF admin ko (throttle: 8s per option per user)
        const ck = `click:${user.username}:${opt}`;
        if (!activityLast.has(ck) || Date.now() - activityLast.get(ck) > 8e3) {
          activityLast.set(ck, Date.now());
          recordNotification({
            type: 'click',
            title: `👆 ${opt}`,
            body: `${user.name || user.username} ne "${opt}"${det ? ` — ${det}` : ''} use kiya.`,
            target: 'admin',
            meta: { username: user.username, name: user.name, mobile: user.mobile, option: opt, details: det, link: pageLinkFor(opt) }
          });
        }
      }
    } else if (type === 'settings') {
      const det = String(body.details || '').trim().slice(0, 200);
      recordNotification({
        type: 'settings',
        title: '⚙️ Settings update',
        body: `${user.name || user.username} ne settings update ki${det ? `: ${det}` : 'ya'}.`,
        target: 'admin',
        meta: { username: user.username, name: user.name, fields: det, link: '#/settings' }
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
    // 🔔 Admin ko password-reset request ki notification (in-app feed + mobile push dono me).
    recordNotification({ type: 'user', title: '🔑 Password reset request', body: `${u.name || u.username} ne password reset ki request ki (${u.email || u.mobile || 'no contact'}). Settings → Users se ye account update kar sakte ho.`, target: 'admin', meta: { username: u.username, name: u.name, email: u.email, mobile: u.mobile, link: '#/settings?tab=users' } });
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
    if (token) { delete db.sessions[sha(token)]; persist('sessions').catch(() => {}); } // ⚡ don't await persistence — client already moved on
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
  }

  if (!user) throw new HttpError(401, 'Login required');

  if (p === '/api/auth/password' && method === 'POST') {
    const body = await readBody(req);
    if (!verifyPassword(body.current || '', user.password)) throw new HttpError(400, 'Current password galat hai.');
    if (!validPassword(body.next)) throw new HttpError(400, 'Naya password kam se kam 6 characters ka ho.');
    user.password = hashPassword(body.next); user.mustChangePassword = false;
    persist('users').catch(() => {});
    recordNotification({ type: 'user', title: '🔑 Password changed', body: `${user.name || user.username} ne apna password change kiya.`, target: `user:${user.username}`, meta: { link: '#/settings?tab=account' } });
    if (user.role !== 'admin') recordNotification({ type: 'user', title: '🔑 Password changed', body: `${user.name || user.username} ne apna password change kiya.`, target: 'admin', meta: { username: user.username, link: '#/settings?tab=users' } });
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }
  if (p === '/api/auth/profile' && method === 'POST') {
    const body = await readBody(req);
    const beforeProfile = userSnapshot(user);
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
    const profileChanges = changeList(beforeProfile, userSnapshot(user));
    if (profileChanges.length) recordNotification({ type: 'user', title: `👤 Profile updated · ${user.name || user.username}`, body: `${user.name || user.username} ne apni details badli: ${profileChanges.map((c) => c.field).join(', ')}.`, target: 'admin', meta: { username: user.username, name: user.name, subject: user.username, changes: profileChanges, link: '#/settings?tab=account' } });
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }
  if (p === '/api/auth/location' && method === 'POST') {
    const body = await readBody(req);
    const lat = Number(body.latitude), lon = Number(body.longitude), accuracy = Number(body.accuracy);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) throw new HttpError(400, 'Location coordinates valid nahi hain.');
    user.lastLocation = { latitude: Number(lat.toFixed(6)), longitude: Number(lon.toFixed(6)), accuracy: Number.isFinite(accuracy) ? Math.max(0, Math.min(100000, Math.round(accuracy))) : null, at: new Date().toISOString() };
    await persist('users');
    if (user.role !== 'admin') recordNotification({ type: 'location', title: 'User location shared', body: `${user.name || user.username} ne consent ke saath apni location share ki.`, target: 'admin', meta: { username: user.username, location: user.lastLocation, link: '#/settings?tab=users' } });
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }

  // ---- gviz ----
  if (p === '/api/gviz' && method === 'GET') {
    return handleGviz(res, url.searchParams);
  }

  // ---- Google Sheet storage setup helpers (admin) --------------------------------------------
  if (p === '/api/storage/apps-script' && method === 'GET') {
    requireAdmin(user);
    const code = await fs.readFile(path.join(__dirname, 'google-apps-script', 'Code.gs'), 'utf8');
    return sendJson(res, 200, { code, storage: storageStatus() });
  }
  if ((p === '/api/storage/test' || p === '/api/storage/migrate') && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    let probe;
    try { probe = new AppsScriptStore({ url: String(body.url || '').trim(), secret: String(body.secret || '').trim() }); }
    catch (err) { throw new HttpError(400, err.message); }
    try {
      const ping = await probe.ping();
      const existing = await probe.read();
      if (p === '/api/storage/test') return sendJson(res, 200, { ok: true, spreadsheet: ping.spreadsheet || '', hasData: !!existing, users: existing && Array.isArray(existing.users) ? existing.users.length : 0 });
      if (existing && !body.force) throw new HttpError(409, `Is sheet me pehle se data hai (${Array.isArray(existing.users) ? existing.users.length : 0} users). Wahi data use hoga — migrate ki zaroorat nahi.`);
      const saves = Object.keys(FILES).map((kind) => probe.save(kind, db[kind]));
      await probe.flush();
      await Promise.all(saves);
      const verify = await probe.read();
      if (!verify || !Array.isArray(verify.users) || verify.users.length !== db.users.length) throw new Error('Verification failed');
      recordNotification({ type: 'settings', title: '☁️ Data copied to Google Sheet storage', body: `${user.name || user.username} ne users/settings/sessions Google Sheet (APP_STORAGE) me copy kiye.`, target: 'admin', meta: { username: user.username, changes: [{ field: 'storage', before: STORAGE_BACKEND, after: 'appsscript (copied, set Render env next)' }] } });
      return sendJson(res, 200, { ok: true, migrated: true, users: verify.users.length, spreadsheet: ping.spreadsheet || '' });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Apps Script connection failed: ${err.message}`);
    }
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
    const changes = changeList(db.settings, next, { skip: ['updatedAt', 'updatedBy'] });
    db.settings = next;
    await persist('settings');
    if (changes.length || body.reset) recordNotification({ type: 'settings', title: body.reset ? '⚙️ Settings reset to defaults' : `⚙️ Settings changed (${changes.length})`, body: `${user.name || user.username} ne ${changes.slice(0, 4).map((c) => c.field).join(', ')}${changes.length > 4 ? ` +${changes.length - 4} more` : ''} update kiya.`, target: 'admin', meta: { username: user.username, name: user.name, changes, reset: !!body.reset, link: '#/settings' } });
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
    recordNotification({ type: 'user', title: `👤 New user created · ${u.name}`, body: `${user.name || user.username} ne ${u.username} (${u.role}) account banaya.`, target: 'admin', meta: { username: user.username, subject: u.username, changes: changeList({}, userSnapshot(u)), permissions: { added: perms, removed: [] }, link: '#/settings?tab=users' } });
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
      const beforeUser = userSnapshot(target);
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
      // notifyAccess: admin control karta hai ki user ko notifications/bell dikhegi ya nahi
      if (Object.prototype.hasOwnProperty.call(body, 'notifyAccess')) target.notifyAccess = body.notifyAccess !== false;
      if (body.password) { if (!validPassword(body.password)) throw new HttpError(400, 'Password kam se kam 6 characters ka ho.'); target.password = hashPassword(body.password); target.mustChangePassword = true; }
      // Agar admin ne user ki notification access band ki ya user ko unapproved kiya → uske push subscriptions hata do
      if (target.notifyAccess === false || !target.approved) {
        for (let i = pushSubs().length - 1; i >= 0; i--) if (pushSubs()[i].username === target.username) pushSubs().splice(i, 1);
      }
      if (!target.approved) for (const [k, s] of Object.entries(db.sessions)) if (s.username === target.username) delete db.sessions[k];
      await persist('users'); await persist('sessions');
      const afterUser = userSnapshot(target);
      const userChanges = changeList({ ...beforeUser, permissions: undefined }, { ...afterUser, permissions: undefined });
      const perms = permissionDiff(beforeUser.permissions, afterUser.permissions);
      if (body.password) userChanges.push({ field: 'password', before: '••••', after: 'reset by admin' });
      if (userChanges.length || perms.added.length || perms.removed.length) recordNotification({ type: 'user', title: `👥 User updated · ${target.name || target.username}`, body: `${user.name || user.username} ne ${target.username} update kiya${perms.added.length || perms.removed.length ? ` · access +${perms.added.length} / −${perms.removed.length}` : ''}${userChanges.length ? ` · ${userChanges.map((c) => c.field).join(', ')}` : ''}.`, target: 'admin', meta: { username: user.username, subject: target.username, changes: userChanges, permissions: perms, link: '#/settings?tab=users' } });
      return sendJson(res, 200, { ok: true, user: publicUser(target) });
    }
    if (method === 'DELETE') {
      if (target.username === user.username) throw new HttpError(400, 'Apna hi account delete nahi kar sakte.');
      if (target.role === 'admin' && db.users.filter((u) => u.role === 'admin').length <= 1) throw new HttpError(400, 'Aakhri admin ko delete nahi kar sakte.');
      db.users = db.users.filter((u) => u !== target);
      for (const [k, s] of Object.entries(db.sessions)) if (s.username === target.username) delete db.sessions[k];
      await persist('users'); await persist('sessions');
      recordNotification({ type: 'user', title: `🗑️ User deleted · ${target.name || target.username}`, body: `${user.name || user.username} ne ${target.username} ka account delete kiya.`, target: 'admin', meta: { username: user.username, subject: target.username, changes: changeList(userSnapshot(target), {}), link: '#/settings?tab=users' } });
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
  if (!['files', 'sheets', 'appsscript'].includes(STORAGE_BACKEND)) throw new Error('STORAGE_BACKEND must be files, sheets or appsscript.');
  let stored;
  let cloudWasEmpty = false;
  if (STORAGE_BACKEND === 'appsscript') {
    // Google Sheet (via Apps Script web app) is authoritative. Never start with defaults if it can't be read.
    sheetsStore = appsScriptStoreFromEnv();
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { stored = await sheetsStore.read(); lastErr = null; break; }
      catch (err) { lastErr = err; if (/decrypt|no users row|unauthorized|Set SECRET|HTML page/i.test(err.message)) break; await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
    }
    if (lastErr) throw lastErr;
    if (!stored) {
      // First run: seed the sheet from whatever this instance has (local files if any, else defaults).
      cloudWasEmpty = true;
      stored = await readLocalStore();
      console.log('APP_STORAGE (Apps Script) is empty → seeding it from the current local data.');
    } else {
      stored = {
        users: Array.isArray(stored.users) ? stored.users : [],
        sessions: stored.sessions && typeof stored.sessions === 'object' ? stored.sessions : {},
        settings: stored.settings && typeof stored.settings === 'object' ? stored.settings : {},
        resets: Array.isArray(stored.resets) ? stored.resets : [],
        notify: stored.notify && typeof stored.notify === 'object' ? stored.notify : { items: [], watch: {} }
      };
      console.log(`Loaded users/settings/sessions from Google Sheet APP_STORAGE (Apps Script) · users ${stored.users.length}`);
    }
  } else if (STORAGE_BACKEND === 'sheets') {
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
  // `vapid` + `pushLog` bhi durable hain — inke bina har restart par nayi VAPID key banti thi aur
  // phone ke notification panel me push aana band ho jaata tha (subscriptions 403 par reject hoti thin).
  db.notify = { items: Array.isArray(storedNotify.items) ? storedNotify.items.slice(-500) : [], watch: storedNotify.watch && typeof storedNotify.watch === 'object' ? storedNotify.watch : {}, push: Array.isArray(storedNotify.push) ? storedNotify.push.slice(-300) : [], pushLog: Array.isArray(storedNotify.pushLog) ? storedNotify.pushLog.slice(-40) : [], vapid: storedNotify.vapid && typeof storedNotify.vapid === 'object' ? storedNotify.vapid : null };
  for (const kind of Object.keys(FILES)) durableSnapshots.set(kind, JSON.stringify(db[kind], null, 2));
  // Upgrade the known previous/default product title in durable settings; preserve admin custom names.
  if (/^First Forward Dashboard(?:\s*[-–—]\s*Robo\s*v?3\.2)?$/i.test(String(db.settings.appName || '').trim())) {
    db.settings.appName = 'First Forward & Gv Partner Dashboard';
    await persist('settings');
    console.log('Updated saved app name to First Forward & Gv Partner Dashboard.');
  }
  pruneSessions();
  await bootstrapAdmin();
  if (cloudWasEmpty) {
    await Promise.all(Object.keys(FILES).map((kind) => persist(kind)));
    console.log('APP_STORAGE seeded ✓ — users, settings and sessions now survive every deploy/restart.');
  }
  await loadVapid(); // durable keys load hone ke baad hi push bhejo — warna subscriptions 403 khaati hain
  const selfTest = vapidSelfTest();
  if (selfTest.ok) console.log(`📲 Push ready — VAPID ${vapidSource}${vapidDurable ? ' (durable ✓)' : ' (⚠️ TEMPORARY — deploy par tootegi)'}, auth scheme "${pushAuthScheme}", subject ${VAPID_SUBJECT}, ${pushSubs().length} device registered.`);
  else console.error(`🔴 Push self-test FAIL: ${selfTest.error} — phone par notifications nahi aayengi jab tak ye theek nahi hota.`);
  pruneStalePushSubs();
  ensureVapidDurable();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`First Forward Dashboard → http://0.0.0.0:${server.address().port}`);
    console.log(`Sheet ${db.settings.sheetId} · cache ${cacheMs() / 1000}s · storage ${sheetsStore ? `Google Sheets / encrypted APP_STORAGE (${STORAGE_BACKEND})` : DATA_DIR} · users ${db.users.length} · push ${vapidKeys ? `${pushSubs().length} device(s), VAPID from ${vapidSource}, TTL ${PUSH_TTL}s` : 'DISABLED (no VAPID key)'}${GVIZ_BASE !== 'https://docs.google.com' ? ` · upstream ${GVIZ_BASE}` : ''}`);
    setTimeout(() => checkReports(true).catch(() => {}), 5000);
    setInterval(() => checkReports(false).catch(() => {}), 5 * 60e3).unref();
    setTimeout(() => maybeMonthlyReport(), 8000);
    setInterval(() => maybeMonthlyReport(), 60 * 60e3).unref();
    // 🌅 Daily digest: subah 8 (IST) ke baad pehli wake-up par roz ek baar.
    setTimeout(() => maybeDailyDigest(false).catch(() => {}), 15000);
    setInterval(() => maybeDailyDigest(false).catch(() => {}), 30 * 60e3).unref();
  });
}
start().catch((err) => { console.error('Startup stopped to protect stored data:', err); process.exitCode = 1; });
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (sheetsStore && sheetsStore.drain) sheetsStore.drain().catch(() => {});
    server.close(async () => {
      await Promise.allSettled([...writeQueue.values()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
