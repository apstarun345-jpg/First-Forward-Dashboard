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
// Fixed page / action permissions. Sheet-tab permissions (`sheet:<tabId>`) are generated from the
// `tabs` registry below, so the admin can add or hide sheet tabs and control each one per user.
export const PAGE_PERMISSIONS = [
  { key: 'home', label: 'Home · greeting & overview', group: 'Pages' },
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
  { id: 'StockDataa', group: 'First Forward', source: 'main', kind: 'stock', icon: '📦', label: 'StockDataa · Inventory', tab: 'StockDataa', gid: '', desc: 'Field stock (tag-wise)', enabled: true },
  { id: 'REPORT', group: 'First Forward', source: 'main', kind: 'report', icon: '📑', label: 'REPORT', tab: 'REPORT', gid: '242489821', desc: 'Agent-wise summary: stock + issuance + status', enabled: true },
  { id: 'EIR', group: 'First Forward', source: 'main', kind: 'issuance', icon: '🗂️', label: 'EIR · Issuance log', tab: 'EIR', gid: '', desc: 'Har tag ka issuance record (bada tab)', enabled: false },
  { id: 'GV Master', group: 'GV Partner', source: 'gv', kind: 'gv-issuance', icon: '🚀', label: 'GV Master · Issuance', tab: 'GV Master', gid: '', desc: 'GV partner ka poora issuance data', enabled: true },
  { id: 'Tag Assignment', group: 'GV Partner', source: 'gv', kind: 'gv-stock', icon: '📦', label: 'Tag Assignment · Stock', tab: 'Tag Assignment', gid: '', desc: 'GV partner stock (tag-wise, In Stock)', enabled: true },
  { id: 'GV REPORT', group: 'GV Partner', source: 'gv', kind: 'gv-report', icon: '📑', label: 'GV REPORT · Performance', tab: 'GV REPORT', gid: '1284424234', desc: 'GV agent-wise performance + stock', enabled: true }
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
const DEFAULT_USER_PERMS = ['home', 'dashboard', 'trend', 'stock', 'performance', 'gvDashboard', 'gvTrend', 'gvStock', 'gvPerformance', 'compare',
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
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const FILES = { users: path.join(DATA_DIR, 'users.json'), sessions: path.join(DATA_DIR, 'sessions.json'), settings: path.join(DATA_DIR, 'settings.json'), resets: path.join(DATA_DIR, 'resets.json'), notifications: path.join(DATA_DIR, 'notifications.json'), watch: path.join(DATA_DIR, 'report-watch.json') };
const db = { users: [], sessions: {}, settings: { ...DEFAULT_SETTINGS }, resets: [], notifications: [] };
let reportWatch = { signature: '', lastCheckAt: null, lastReportDate: null, lastSummary: null };
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
  return { username: u.username, name: u.name || u.username, email: u.email || '', mobile: u.mobile || '', avatar: u.avatar || '', role: u.role, approved: !!u.approved, permissions: u.role === 'admin' ? allPermKeysNow() : (u.permissions || []), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, mustChangePassword: !!u.mustChangePassword, lastSeenAt: u.lastSeenAt || null, lastLocation: u.lastLocation || null, lastIp: u.lastIp || '' };
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
    u.role = 'admin'; u.approved = true; u.permissions = allPermKeysNow(); u.mustChangePassword = false;
    if (!verifyPassword(ADMIN_PASSWORD, u.password)) u.password = hashPassword(ADMIN_PASSWORD);
    await persist('users');
    console.log(`Admin "${ADMIN_USER}" ready (from environment).`);
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
function userAgentLabel(req) {
  const ua = String((req.headers['user-agent'] || '')).slice(0, 160);
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad/i.test(ua)) return 'iOS';
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua)) return 'Linux';
  return ua ? 'Browser' : 'Unknown';
}

// -------------------------------------------------------------------------------------------
// Notifications — in-app bell + browser notifications. Every important event lands here:
// daily bank-report (Google Sheet watcher), logins, site opens, signups, password resets,
// settings/user changes and user locations. Admin sees everything; users see broadcasts.
// -------------------------------------------------------------------------------------------
function notify(type, title, body, opts = {}) {
  const item = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    type, title, body,
    at: new Date().toISOString(),
    audience: opts.audience === 'all' ? 'all' : 'admin',
    user: opts.user || '',
    by: opts.by || '',
    icon: opts.icon || '🔔',
    meta: opts.meta || null,
    read: {}
  };
  db.notifications.unshift(item);
  if (db.notifications.length > 250) db.notifications.length = 250;
  persist('notifications');
  return item;
}
function visibleNotifications(user) {
  if (!user) return [];
  const admin = user.role === 'admin';
  return db.notifications.filter((n) => admin || n.audience === 'all' || n.user === user.username);
}
function lastNotifAt(type, user) {
  const n = db.notifications.find((x) => x.type === type && (!user || x.user === user));
  return n ? new Date(n.at).getTime() : 0;
}

// ---- daily bank-report watcher -------------------------------------------------------------
// Polls the EIR (First Forward) + GV Master (GV Partner) sheets every few minutes. When the
// newest report day's issuance numbers change (bank report add / update ho gaya), all users get
// a notification with yesterday's tag issuance: GV vs First Forward + VC4 / VC20 / VC5+ split.
function parseGvizBody(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    const json = JSON.parse(text.slice(start, end + 1));
    if (!json || json.status === 'error' || !json.table) return null;
    return (json.table.rows || []).map((r) => (r.c || []).map((c) => (c ? c.v : null)));
  } catch { return null; }
}
function gvizDateKey(v) {
  if (typeof v === 'string') {
    const m = /^Date\((\d+),(\d+),(\d+)/.exec(v);
    if (m) return `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
  }
  return '';
}
function istDay(offsetDays = 0) {
  // Report "days" follow IST (bank data) — keep the watcher consistent with India time.
  const t = new Date(Date.now() + (5.5 * 60 + new Date().getTimezoneOffset()) * 60e3 + offsetDays * 86400e3);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
function normCls(raw) {
  const c = String(raw || '').trim().toUpperCase();
  if (!c) return 'VC5+';
  if (/^\d+$/.test(c)) return Number(c) <= 4 ? 'VC4' : Number(c) <= 20 ? 'VC20' : 'VC5+';
  if (c === 'VC4' || c === '4') return 'VC4';
  if (c === 'VC20' || c === '20') return 'VC20';
  return 'VC5+';
}
async function gvizCached(sheetId, sheet, gid, tq) {
  const params = new URLSearchParams();
  if (gid) params.set('gid', String(gid));
  if (sheet) params.set('sheet', String(sheet));
  params.set('tq', tq);
  params.set('id', String(sheetId));
  const url = upstreamUrl(params);
  let entry = cache.get(url);
  if (!entry || Date.now() - entry.at > Math.max(cacheMs(), 10 * 60e3)) {
    try {
      const { status, body } = await fetchUpstream(url);
      if (status >= 200 && status < 300 && body.includes('setResponse')) {
        entry = { at: Date.now(), body, status };
        cache.set(url, entry);
      }
    } catch (err) { console.error('watcher fetch:', err.message); }
  }
  return entry ? parseGvizBody(entry.body) : null;
}
function emptyBuckets() {
  const b = () => ({ total: 0, vc4: 0, vc20: 0, vc5p: 0 });
  return { ff: b(), gv: b() };
}
function addRow(acc, channel, cls, n) {
  const k = channel === 'gv' ? 'gv' : 'ff';
  acc[k].total += n;
  if (cls === 'VC4') acc[k].vc4 += n;
  else if (cls === 'VC20') acc[k].vc20 += n;
  else acc[k].vc5p += n;
}
function fmtBucket(b) {
  return `${b.total} tags (VC4 ${b.vc4} · VC20 ${b.vc20} · VC5+ ${b.vc5p})`;
}
function fmtDay(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  if (!y) return key;
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
async function checkDailyReport() {
  reportWatch.lastCheckAt = new Date().toISOString();
  try {
    const e = db.settings.eir || DEFAULT_SETTINGS.eir;
    const gv = (db.settings.gv && db.settings.gv.master) || DEFAULT_SETTINGS.gv.master;
    const [eirRows, gvRows] = await Promise.all([
      gvizCached(db.settings.sheetId, e.sheet || 'EIR', '',
        `select ${e.date}, ${e.cls}, ${e.masterId}, count(${e.tagId}) where ${e.date} is not null group by ${e.date}, ${e.cls}, ${e.masterId}`),
      gvizCached(db.settings.gvSheetId, gv.tab || 'GV Master', gv.gid || '',
        `select ${gv.date}, ${gv.vClass}, count(${gv.tagId}) where ${gv.date} is not null group by ${gv.date}, ${gv.vClass}`)
    ]);

    // per-day buckets — FF side EXCLUDES the GV master id (e.g. 5845036) rows so the two
    // channels never double-count (same rule as the GV-vs-FF compare page).
    // GV Partner numbers come from the GV Master sheet; EIR's GV rows are only a fallback.
    const byDay = new Map();
    const day = (k) => { if (!byDay.has(k)) byDay.set(k, emptyBuckets()); return byDay.get(k); };
    const gvFallback = new Map();
    if (eirRows) {
      for (const r of eirRows) {
        const d = gvizDateKey(r[0]);
        const n = Number(r[3]) || 0;
        if (!d || !n) continue;
        const isGv = String(r[2] || '').trim() === String(e.gvMasterId || '5845036').trim();
        if (isGv) {
          if (!gvFallback.has(d)) gvFallback.set(d, emptyBuckets());
          addRow(gvFallback.get(d), 'gv', normCls(r[1]), n);
        } else {
          addRow(day(d), 'ff', normCls(r[1]), n);
        }
      }
    }
    if (gvRows) {
      for (const r of gvRows) {
        const d = gvizDateKey(r[0]);
        const n = Number(r[2]) || 0;
        if (!d || !n) continue;
        addRow(day(d), 'gv', normCls(r[1]), n);
      }
    } else {
      for (const [d, acc] of gvFallback) {
        const t = day(d);
        t.gv.total += acc.gv.total; t.gv.vc4 += acc.gv.vc4; t.gv.vc20 += acc.gv.vc20; t.gv.vc5p += acc.gv.vc5p;
      }
    }
    if (!byDay.size) return;

    // Newest day with activity — that's the "report" that just arrived.
    const dates = [...byDay.keys()].sort();
    const reportDate = dates[dates.length - 1];
    const acc = byDay.get(reportDate);
    const signature = `${reportDate}|ff:${acc.ff.total}.${acc.ff.vc4}.${acc.ff.vc20}.${acc.ff.vc5p}|gv:${acc.gv.total}.${acc.gv.vc4}.${acc.gv.vc20}.${acc.gv.vc5p}`;
    if (signature === reportWatch.signature) return; // nothing new

    const firstEver = !reportWatch.signature;
    reportWatch.signature = signature;
    reportWatch.lastReportDate = reportDate;
    reportWatch.lastSummary = { date: reportDate, ff: acc.ff, gv: acc.gv, at: new Date().toISOString() };
    persist('watch');

    if (firstEver && reportDate < istDay(-1)) return; // purana data — pehli baar baseline hi rakho
    const isYesterday = reportDate === istDay(-1);
    const when = isYesterday ? `Yesterday (${fmtDay(reportDate)})` : fmtDay(reportDate);
    notify('daily-report', `📊 Daily bank report · ${when}`, [
      `Yesterday tag issuance (${fmtDay(reportDate)}):`,
      `First Forward — ${fmtBucket(acc.ff)}`,
      `GV Partner — ${fmtBucket(acc.gv)}`,
      `Total — ${acc.ff.total + acc.gv.total} tags`
    ].join('\n'), {
      audience: 'all', icon: '📊',
      meta: { date: reportDate, ff: acc.ff, gv: acc.gv, total: acc.ff.total + acc.gv.total }
    });
  } catch (err) {
    console.error('daily report watcher:', err.message);
  }
}
function startReportWatcher() {
  setTimeout(() => checkDailyReport().catch(() => {}), 20 * 1000);
  setInterval(() => checkDailyReport().catch(() => {}), 10 * 60e3);
}

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
  const range = params.get('range');
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
    return sendJson(res, 200, { ok: true, service: 'first-forward-dashboard', version: 3, users: db.users.length, cached: cache.size, cacheSeconds: cacheMs() / 1000, dataDir: DATA_DIR });
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
      const token = createSession(username);
      u.lastLoginAt = new Date().toISOString(); u.lastSeenAt = u.lastLoginAt; u.lastIp = clientIp(req); persist('users');
      notify('first-admin', '👑 First admin account bana', `"${u.name}" (@${u.username}) pehla user hai — admin access mil gayi.`, { audience: 'all', user: u.username, by: u.username, icon: '👑' });
      return sendJson(res, 200, { ok: true, user: publicUser(u), settings: db.settings, permissions: permissionsFor(db.settings), tabs: db.settings.tabs, first: true }, { 'Set-Cookie': cookieHeader(req, token, SESSION_DAYS * 86400) });
    }
    notify('signup', `🆕 Naya signup · @${username}`, `"${u.name}" (@${username}) ne sign up kiya — approve karke permissions do (Settings → Users & access).`, { user: username, by: username, icon: '🆕', meta: { email: u.email, mobile: u.mobile } });
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
    const now = new Date().toISOString();
    u.lastLoginAt = now; u.lastSeenAt = now; u.lastIp = ip; persist('users');
    notify('login', `🔔 Login · ${u.name || u.username}`, `"${u.name || u.username}" (@${u.username}) ne login kiya · ${userAgentLabel(req)} · IP ${ip}`, { user: u.username, by: u.username, icon: '🔔', meta: { ip, device: userAgentLabel(req) } });
    return sendJson(res, 200, { ok: true, user: publicUser(u), settings: db.settings, permissions: permissionsFor(db.settings), tabs: db.settings.tabs }, { 'Set-Cookie': cookieHeader(req, token, SESSION_DAYS * 86400) });
  }
  // ---- forgot password ("Forgot password?" on the login screen) ----
  // No email service: the request is queued for the admin, who either sets a new password or
  // generates a 6-digit one-time code the user can redeem below. Rate-limited per IP.
  if (p === '/api/auth/forgot' && method === 'POST') {
    const ip = clientIp(req);
    const hits = (forgotHits.get(ip) || []).filter((t) => Date.now() - t < 60 * 60e3);
    if (hits.length >= 6) throw new HttpError(429, 'Bahut reset requests — thodi der baad try karo ya admin ko seedha message karo.');
    hits.push(Date.now()); forgotHits.set(ip, hits);
    const body = await readBody(req);
    const key = String(body.username || '').trim();
    const u = findUser(key) || db.users.find((x) => x.email && String(x.email).toLowerCase() === key.toLowerCase());
    const c = db.settings.contacts || {};
    const help = { whatsapp: c.teamWhatsapp || '', email: c.teamEmail || '' };
    if (!u) {
      return sendJson(res, 200, { ok: true, found: false, help, message: 'Agar ye account hai to request admin ko chali gayi hai. Nahi mila to admin se naya account maango.' });
    }
    db.resets = db.resets.filter((r) => r.username !== u.username || r.resolved);
    db.resets.push({ username: u.username, name: u.name || u.username, email: u.email || '', mobile: u.mobile || '', at: new Date().toISOString(), code: '', codeExpiresAt: null, resolved: false });
    await persist('resets');
    notify('reset-request', `🔑 Password reset request · @${u.username}`, `"${u.name || u.username}" ne forgot-password request bheji — Settings → Users & access me naya password ya 6-digit code do.`, { user: u.username, by: u.username, icon: '🔑' });
    return sendJson(res, 200, { ok: true, found: true, help, message: `Request bhej di gayi ✓ — admin approve karke aapko naya password ya 6-digit code dega (user: ${u.username}).` });
  }
  if (p === '/api/auth/reset' && method === 'POST') {
    const body = await readBody(req);
    const u = findUser(body.username);
    const code = String(body.code || '').replace(/\D/g, '').slice(0, 8);
    if (!u || !code) throw new HttpError(400, 'Username ya code galat hai.');
    const reqRow = db.resets.slice().reverse().find((r) => r.username === u.username && !r.resolved && r.code);
    if (!reqRow || !reqRow.code || reqRow.code !== code) throw new HttpError(400, 'Code match nahi hua. Admin se naya code maango.');
    if (!reqRow.codeExpiresAt || new Date(reqRow.codeExpiresAt).getTime() < Date.now()) throw new HttpError(400, 'Code expire ho gaya — admin se naya code maango.');
    if (!validPassword(body.password)) throw new HttpError(400, 'Naya password kam se kam 6 characters ka ho.');
    u.password = hashPassword(body.password);
    u.mustChangePassword = false;
    reqRow.resolved = true; reqRow.resolvedAt = new Date().toISOString();
    for (const [k, sess] of Object.entries(db.sessions)) if (sess.username === u.username) delete db.sessions[k];
    await persist('users'); await persist('sessions'); await persist('resets');
    notify('reset-done', `🔓 Password reset · @${u.username}`, `"${u.name || u.username}" ne forgot-password code se naya password set kar liya.`, { user: u.username, by: u.username, icon: '🔓' });
    return sendJson(res, 200, { ok: true, message: 'Password set ho gaya ✓ — ab naye password se login karo.' });
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
    if (body.avatar !== undefined) {
      const a = String(body.avatar || '');
      if (a && !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(a)) throw new HttpError(400, 'Photo: sirf PNG/JPG/WEBP/SVG image allowed.');
      if (a.length > 1.5 * 1024 * 1024) throw new HttpError(400, 'Photo 1 MB se chhoti rakho.');
      user.avatar = a;
    }
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
    if (patch.tabs !== undefined) {
      if (!Array.isArray(patch.tabs)) throw new HttpError(400, 'tabs array hona chahiye');
      patch.tabs = patch.tabs.filter((t) => t && t.id).map((t) => ({
        id: String(t.id).slice(0, 60), group: String(t.group || 'First Forward').slice(0, 40), source: t.source === 'gv' ? 'gv' : 'main',
        kind: String(t.kind || 'sheet').slice(0, 30), icon: String(t.icon || '📄').slice(0, 8), label: String(t.label || t.id).slice(0, 80),
        tab: String(t.tab || t.id).slice(0, 80), gid: String(t.gid || '').slice(0, 30), desc: String(t.desc || '').slice(0, 160),
        enabled: t.enabled !== false
      }));
    }
    if (patch.gv && typeof patch.gv === 'object') cache.clear();
    const next = body.reset ? { ...DEFAULT_SETTINGS } : deepMerge(db.settings, patch);
    next.updatedAt = new Date().toISOString(); next.updatedBy = user.username;
    if (next.sheetId !== db.settings.sheetId || next.cacheSeconds !== db.settings.cacheSeconds) cache.clear();
    db.settings = next;
    await persist('settings');
    notify('settings', `⚙️ Settings updated · ${user.name || user.username}`, `${user.name || user.username} ne settings badli: ${Object.keys(patch).slice(0, 8).join(', ') || 'reset to defaults'}${Object.keys(patch).length > 8 ? '…' : ''}`, { by: user.username, icon: '⚙️', meta: { keys: Object.keys(patch) } });
    return sendJson(res, 200, { ok: true, settings: db.settings });
  }
  if (p === '/api/cache/clear' && method === 'POST') { requireAdmin(user); cache.clear(); return sendJson(res, 200, { ok: true }); }

  // ---- notifications (bell + browser) ----
  if (p === '/api/notifications' && method === 'GET') {
    const items = visibleNotifications(user).slice(0, 60);
    const unread = items.filter((n) => !(n.read || {})[user.username]).length;
    return sendJson(res, 200, { items, unread, serverTime: new Date().toISOString() });
  }
  if (p === '/api/notifications/read' && method === 'POST') {
    const body = await readBody(req);
    const ids = Array.isArray(body && body.ids) ? new Set(body.ids.map(String)) : null;
    const now = new Date().toISOString();
    let n = 0;
    for (const item of db.notifications) {
      if (ids && !ids.has(item.id)) continue;
      if (!(item.read || {})[user.username]) { item.read = item.read || {}; item.read[user.username] = now; n++; }
    }
    if (n) await persist('notifications');
    return sendJson(res, 200, { ok: true, marked: n });
  }
  if (p === '/api/notifications/test' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    const t = String((body && body.title) || '').slice(0, 120);
    const b = String((body && body.body) || '').slice(0, 400);
    const item = notify('test', `🧪 ${t || 'Test notification'}`, b || 'Ye test notification hai — bell + browser dono me aana chahiye. 🎉', { audience: 'all', by: user.username, icon: '🧪' });
    return sendJson(res, 200, { ok: true, item });
  }

  // ---- activity tracking: site open + user location ----
  if (p === '/api/track/open' && method === 'POST') {
    const now = new Date().toISOString();
    const ip = clientIp(req);
    user.lastSeenAt = now; user.lastIp = ip;
    persist('users');
    // at most one "site opened" notification per user per 30 minutes (admin feed)
    if (Date.now() - lastNotifAt('visit', user.username) > 30 * 60e3) {
      notify('visit', `👋 Site opened · ${user.name || user.username}`, `"${user.name || user.username}" (@${user.username}) ne dashboard open kiya · ${userAgentLabel(req)} · IP ${ip}`, { user: user.username, by: user.username, icon: '👋', meta: { ip, device: userAgentLabel(req) } });
    }
    return sendJson(res, 200, { ok: true, lastSeenAt: now });
  }
  if (p === '/api/track/location' && method === 'POST') {
    const body = await readBody(req);
    const lat = Number(body.lat), lng = Number(body.lng), accuracy = Number(body.accuracy) || 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Location valid nahi hai (lat/lng).');
    user.lastLocation = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, accuracy: Math.round(accuracy), at: new Date().toISOString() };
    persist('users');
    if (Date.now() - lastNotifAt('location', user.username) > 60 * 60e3) {
      notify('location', `📍 Location · ${user.name || user.username}`, `"${user.name || user.username}" (@${user.username}) ki location: ${user.lastLocation.lat}, ${user.lastLocation.lng} (±${user.lastLocation.accuracy}m) · https://maps.google.com/?q=${user.lastLocation.lat},${user.lastLocation.lng}`, { user: user.username, by: user.username, icon: '📍', meta: { ...user.lastLocation } });
    }
    return sendJson(res, 200, { ok: true, location: user.lastLocation });
  }

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
    notify('user-create', `➕ User created · @${username}`, `${user.name || user.username} ne naya account banaya: "${u.name}" (@${username}) · role ${u.role} · password user ko bata do.`, { user: username, by: user.username, icon: '➕', meta: { role: u.role } });
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
    notify('reset-code', `🔢 Reset code issued · @${target.username}`, `${user.name || user.username} ne "@${target.username}" ko 6-digit reset code diya (30 min valid).`, { user: target.username, by: user.username, icon: '🔢' });
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
      await persist('users'); persist('sessions');
      notify('user-update', `👤 User updated · @${target.username}`, `${user.name || user.username} ne "@${target.username}" ka account update kiya (role: ${target.role} · ${target.approved ? 'active' : 'disabled'} · permissions: ${target.permissions.length}).`, { user: target.username, by: user.username, icon: '👤' });
      return sendJson(res, 200, { ok: true, user: publicUser(target) });
    }
    if (method === 'DELETE') {
      if (target.username === user.username) throw new HttpError(400, 'Apna hi account delete nahi kar sakte.');
      if (target.role === 'admin' && db.users.filter((u) => u.role === 'admin').length <= 1) throw new HttpError(400, 'Aakhri admin ko delete nahi kar sakte.');
      db.users = db.users.filter((u) => u !== target);
      for (const [k, s] of Object.entries(db.sessions)) if (s.username === target.username) delete db.sessions[k];
      await persist('users'); persist('sessions');
      notify('user-delete', `🗑️ User deleted · @${target.username}`, `${user.name || user.username} ne "@${target.username}" (${target.name}) ka account delete kar diya.`, { user: target.username, by: user.username, icon: '🗑️' });
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
  db.resets = await readJson(FILES.resets, []);
  db.notifications = await readJson(FILES.notifications, []);
  reportWatch = { signature: '', lastCheckAt: null, lastReportDate: null, lastSummary: null, ...(await readJson(FILES.watch, {})) };
  pruneSessions();
  await bootstrapAdmin();
  startReportWatcher();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`First Forward Dashboard → http://0.0.0.0:${PORT}`);
    console.log(`Sheet ${db.settings.sheetId} · cache ${cacheMs() / 1000}s · data ${DATA_DIR} · users ${db.users.length}${GVIZ_BASE !== 'https://docs.google.com' ? ` · upstream ${GVIZ_BASE}` : ''}`);
  });
}
start();
