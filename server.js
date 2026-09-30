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
import { sendMail, mailConfigured, diagnoseMail, mailHint, availableProviders, resolveProviders, resetMailMemo, MAIL_PROVIDERS, splitRecipients } from './mailer.js';
import { DEFAULT_DISPATCH_EMAIL, normalizeDispatchEmail, buildDispatchPlan, dispatchEmailContent } from './dispatch-email.js';
import { loadFfDispatchRows, loadGvDispatchRows } from './dispatch-report.js';

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
const BLOCKED_FILES = new Set(['server.js', 'sheets-storage.js', 'apps-script-storage.js', 'mailer.js', 'DEPLOYMENT.md', 'SHEETS_STORAGE.md', 'STORAGE_SETUP.md', 'package.json', 'package-lock.json', 'render.yaml', 'README.md', '.env']);
const BLOCKED_DIRS = new Set(['data', 'dev', 'node_modules', '.git', 'google-apps-script']);

// ---------------------------------------------------------------------------------------------
// Permissions & settings schema
// ---------------------------------------------------------------------------------------------
// Fixed page / action permissions. Sheet-tab permissions (`sheet:<tabId>`) are generated from the
// `tabs` registry below, so the admin can add or hide sheet tabs and control each one per user.
export const PAGE_PERMISSIONS = [
  { key: 'home', label: 'Home · highlights & charts', group: 'Pages' },
  { key: 'rangeReport', label: 'Management · Range Report (custom from→to)', group: 'Management' },
  { key: 'tv', label: 'Management · TV Mode (big-screen rotation)', group: 'Management' },
  { key: 'teamMap', label: 'Management · Team map (location, admin-only page)', group: 'Management' },
  { key: 'executive', label: 'Management · Executive Cockpit', group: 'Professional Insights' },
  { key: 'forecast', label: 'Management · Forecast Accuracy & Stock Balance', group: 'Professional Insights' },
  { key: 'dataQuality', label: 'Management · Data Quality Center', group: 'Professional Insights' },
  { key: 'savedViews', label: 'Workspace · Saved views & report studio', group: 'Professional Insights' },
  { key: 'reportStudio', label: 'Workspace · Report Studio (scheduled emails, share)', group: 'Professional Insights' },
  { key: 'followups', label: 'Workspace · Agent/TL notes & follow-ups', group: 'Professional Insights' },
  { key: 'tagIssued', label: 'GV & FF Tag Issued (date-wise)', group: 'Pages' },
  { key: 'targets', label: 'Targets · agent-wise monthly targets', group: 'Pages' },
  { key: 'dashboard', label: 'First Forward · Dashboard', group: 'First Forward' },
  { key: 'trend', label: 'First Forward · Trend', group: 'First Forward' },
  { key: 'performance', label: 'First Forward · Performance', group: 'First Forward' },
  { key: 'stock', label: 'First Forward · Stock', group: 'First Forward' },
  { key: 'stockReport', label: 'First Forward · Stock Report (REPORT-wise)', group: 'First Forward' },
  { key: 'ffCommission', label: 'First Forward · Commission Intelligence', group: 'First Forward' },
  { key: 'gvDashboard', label: 'GV Partner · Dashboard', group: 'GV Partner' },
  { key: 'gvTrend', label: 'GV Partner · Trend', group: 'GV Partner' },
  { key: 'gvPerformance', label: 'GV Partner · Performance', group: 'GV Partner' },
  { key: 'gvStock', label: 'GV Partner · Stock', group: 'GV Partner' },
  { key: 'gvStockReport', label: 'GV Partner · GV Stock Report (GV REPORT-wise)', group: 'GV Partner' },
  { key: 'gvCommission', label: 'GV Partner · Commission Intelligence', group: 'GV Partner' },
  { key: 'directAgents', label: 'Cross-channel · Direct Agents & TLs (FF APS + GV no-TL rule)', group: 'Cross Channel' },
  { key: 'newAgents', label: 'Cross-channel · New Agents & TL Changes (FF + GV)', group: 'Cross Channel' },
  { key: 'dualChannel', label: 'Cross-channel · Identity & combined analysis', group: 'Cross Channel' },
  { key: 'masterStock', label: 'Cross-channel · Master Stock (barcode/agent/TL/GV search)', group: 'Cross Channel' },
  { key: 'fastagChampions', label: 'Cross-channel · FASTag Champions (top agents/TLs)', group: 'Cross Channel' },
  { key: 'dispatchPlan', label: 'Cross-channel · Dispatch planner (auto box plan)', group: 'Cross Channel' },
  { key: 'tlScorecard', label: 'Cross-channel · TL scorecard', group: 'Cross Channel' },
  { key: 'compare', label: 'GV vs First Forward (comparison)', group: 'Cross Channel' },
  { key: 'charts', label: 'Cross-channel · Charts-only GV vs FF view', group: 'Cross Channel' },
  { key: 'export', label: 'Download CSV / Excel', group: 'Actions' },
  { key: 'share', label: 'WhatsApp / Email share', group: 'Actions' },
  { key: 'refresh', label: 'Force refresh from Google', group: 'Actions' },
  { key: 'contacts', label: 'See mobile numbers', group: 'Actions' },
  { key: 'voiceAssistant', label: 'Voice assistant (🎙️ panel + 👂 wake word)', group: 'Actions' },
  { key: 'arena', label: 'Wow Zone · Agent Arena (levels, badges, challenges)', group: 'Wow Zone' },
  { key: 'fame', label: 'Wow Zone · Wall of Fame (champions + winner cards)', group: 'Wow Zone' },
  { key: 'warRoom', label: 'Wow Zone · War Room (live big-screen pulse + detailed breakdown)', group: 'Wow Zone' },
  { key: 'activity', label: 'Wow Zone · Activity Calendar (heatmap + streak)', group: 'Wow Zone' },
  { key: 'network', label: 'Wow Zone · Team Network (TL–agent constellation)', group: 'Wow Zone' },
  { key: 'radar', label: 'Wow Zone · Anomaly Radar (spike / crash / stale auto-detect)', group: 'Wow Zone' },
  { key: 'reportCards', label: 'Wow Zone · Agent Report Cards (printable monthly card)', group: 'Wow Zone' },
  { key: 'sprints', label: 'Wow Zone · Hourly Sprints (live TL/agent race per hour)', group: 'Wow Zone' },
  { key: 'stockRadar', label: 'Cross Channel · Stock Radar (TL bubbles + suggested qty)', group: 'Cross Channel' }
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
const DEFAULT_USER_PERMS = ['home', 'executive', 'forecast', 'dataQuality', 'savedViews', 'reportStudio', 'followups', 'tagIssued', 'rangeReport', 'targets', 'dashboard', 'trend', 'stock', 'stockReport', 'performance', 'ffCommission', 'gvDashboard', 'gvTrend', 'gvStock', 'gvStockReport', 'gvPerformance', 'gvCommission', 'dualChannel', 'masterStock', 'compare', 'tv', 'teamMap',
  'sheet:StockDataa', 'sheet:REPORT', 'sheet:GV Master', 'sheet:Tag Assignment', 'sheet:GV REPORT', 'charts', 'export', 'dispatchPlan', 'tlScorecard', 'voiceAssistant', 'arena', 'fame', 'warRoom', 'activity', 'network', 'radar', 'reportCards', 'directAgents', 'newAgents', 'sprints', 'stockRadar'];

// Admin-controlled audience for automated notifications. `users` means all approved non-admin
// users who have notification access; each user's own master/type preferences still apply.
const DEFAULT_NOTIFICATION_ROUTES = Object.freeze({
  dailyDigest: 'admin', monthlyReport: 'both', lowStock: 'admin', midMonth: 'admin',
  zeroDay: 'admin', agentAnomaly: 'admin', tlAnomaly: 'admin', followup: 'both',
  champion: 'both', reportUpdate: 'admin', inactiveUsers: 'admin', backupReminder: 'admin'
});
const NOTIFICATION_AUDIENCES = new Set(['admin', 'users', 'both', 'off']);

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
  ffCommission: { rateCol: '', earnedCol: '', categoryCol: '', dateCol: '' }, // optional REPORT letters; blank = heading auto-detection
  ffPayout: { sheet: 'payout', gid: '', labelCol: '', classCol: '', rateCol: '', penaltyCol: '', noteCol: '' }, // FF sheet "payout" tab: per-class commission rate + penalty (blank = auto-detect)
  commissionAlerts: { enabled: true, outlierPct: 25, gvGapPct: 40, mismatchPct: 5, mismatchMin: 50, zeroEarnedMin: 1 }, // cockpit.js alert thresholds
  dispatch: { tagsPerBox: 25, horizon: 7, minNeed: 1, top: 40 }, // dispatch planner defaults
  dispatchEmail: { ...DEFAULT_DISPATCH_EMAIL }, // 🚚 recurring, selectable Dispatch Planner email
  commissionSlabs: {
    enabled: false, model: 'agentTier',
    channels: {
      ff: [{ min: 1, max: 50, rate: '' }, { min: 51, max: 100, rate: '' }, { min: 101, max: 150, rate: '' }, { min: 151, max: 250, rate: '' }, { min: 251, max: null, rate: '' }],
      gv: [{ min: 1, max: 50, rate: '' }, { min: 51, max: 100, rate: '' }, { min: 101, max: 150, rate: '' }, { min: 151, max: 250, rate: '' }, { min: 251, max: null, rate: '' }]
    }
  },
  gv: {
    master: { tab: 'GV Master', gid: '', uniqueId: 'A', agentName: 'B', tlId: 'C', tlName: 'D', vrn: 'E', vClass: 'F', cch: 'G', serial: 'H', tagId: 'I', amount: 'J', customer: 'K', productId: 'L', commission: 'M', status: 'N', commissionStatus: 'O', date: 'P', time: 'Q', gvTlId: 'R', masterCch: 'S', monthName: 'T', tagType: 'U', gvUniqueId: 'W', gvUniqueName: 'X' },
    assignment: { tab: 'Tag Assignment', gid: '', cls: 'A', tagId: 'B', serial: 'C', status: 'D', agentId: 'E', agentName: 'F', tlId: 'G', tlName: 'H', gvUniqueId: 'L', gvUniqueName: 'M', allocatedAt: '' },
    report: { tab: 'GV REPORT', gid: '1284424234', headerRow: 4, lastCol: 'AZ' }
  },
  stockSheet: 'StockDataa',
  stockGid: '',
  eirSheet: 'EIR',
  eir: { tagId: 'A', vrn: 'B', cls: 'D', type: 'P', status: 'Z', date: 'AA', agentId: 'J', agentName: 'L', masterId: 'AU', tlId: 'AV', gvId: 'AW', gvName: 'AX', gvTl: 'AZ', tlName: 'BA', vrnType: 'BC', monthName: 'BD', regNumber: 'BH', gvMasterId: '5845036', gvChannelTl: 'ApnaPayment Pvt. Ltd.' },
  stock: { id: 'A', name: 'B', tagId: 'C', barcode: 'D', cls: 'E', tagType: 'F', bcAllocatedAt: 'G', agentId: 'H', agentName: 'I', agentAllocatedAt: 'J', tlName: 'K' },
  stockMovement: { enabled: false, sheet: 'Stock Movements', date: 'A', channel: 'B', type: 'C', quantity: 'D', cls: 'E', from: 'F', to: 'G', reference: 'H', note: 'I' },
  excludeTls: ['APS'],
  thresholds: { coverRed: 7, coverOrange: 15, coverAmber: 30, inactiveDays: 3, topN: 10 },
  contacts: { teamWhatsapp: '', teamEmail: '', teamGroupLink: '', signature: 'Team First Forward' },
  // 🎛 Har feature ka admin toggle (Settings → 🎛 Features). UI features client par apply hote hain,
  //    alerts server-side scheduled checks me isi se gate hote hain. Modify numbers bhi yahin.
  features: {
    search: true,        // 🔍 global search (Ctrl/⌘ + K) + topbar button
    share: true,         // 📤 WhatsApp share buttons (Dashboard / Trend / Stock)
    targetBar: true,     // 🎯 Dashboard target progress bar
    stockTrend: true,    // 📉 Stock page 30-din trend chart
    tlCover: true,       // 📈 TL-wise cover list (Stock)
    recon: true,         // 🧾 Stock in vs issued (Stock)
    loginHistory: true,  // 🕘 Login history table (Settings → Users)
    pendingBadge: true,  // ⏳ Pending-approvals sidebar badge
    updateToast: true,   // 🔄 "Update available" toast
    backupReminder: true,// ☁️ Settings backup reminder
    waNumber: '',        // 📤 WhatsApp share target number (blank = share picker)
    alerts: { lowCover: true, midMonth: true, inactive: true, zeroDay: true, newLoginIp: true },
    digestHour: 8,       // 🌅 digest kab se mile (IST hour, once after this)
    midFrom: 15, midTo: 25, midGapPct: 40, // 🎯 mid-month window (tareekh) + peeche hone ki %
    zeroDropPct: 50,     // ⚠️ itna % gira to sharp-drop alert (0 = sirf zero-day)
    backupDays: 7,       // ☁️ settings backup ki reminder age (days)
    emailDigest: false,  // 📧 digest email se bhi bhejo (SMTP niche configure karo)
    // ---- round 2 ke 10 naye features (sab Settings → 🎛 Features se on/off) ----
    tvMode: true,        // 📺 office TV mode (auto-rotate dashboard/trend/stock)
    weekCompare: true,   // 🔁 dashboard par "aaj vs pichhle hafte ke same day"
    agedStock: true,     // 📦 stock aging card (kitne din se pada hai)
    auditLog: true,      // 📜 Settings → Audit log tab
    announcements: true, // 📢 admin announcements (bell me broadcast)
    tlGoals: true,       // 🧮 TL-level monthly goals (Targets → TL rollup)
    otp2fa: true,        // 🔐 naye IP par OTP (email) — SMTP+email na ho to purana raasta
    emailReport: false,  // 📧 roz ka scheduled report email (HTML + CSV attach)
    emailReportHour: 21,
    weeklyEmail: false,  // 📬 weekly auto digest email (Monday)
    weeklyEmailHour: 9,
    anomalyPct: 80,      // 🔍 agent anomaly: itna % gira to alert
    // ---- round 3 ke 6 naye features (sab Settings → 🎛 Features se on/off) ----
    badges: true,        // 🏅 weekly badges + shareable rank card (Performance)
    voiceSummary: true,  // 🗣️ Dashboard par 🔊 voice summary (Hindi TTS)
    askBox: true,        // 🤖 search box me sawal-jawab ("aaj ka VC4?")
    teamMap: true,       // 🗺 team location map (admin)
    tlAnomaly: true,     // 🏆 TL-level anomaly (agent ke saath)
    personalLinks: true, // 🔗 personal read-only links (agent + TL)
    // ---- round 4 ke naye features ----
    customAlerts: true,  // 🗓 custom alert scheduler (admin ke apne reminders/status)
    championEmail: false,// 🥇 monthly champion certificate email (SMTP chahiye)
    championHour: 10, championTop: 3,
    followupTracker: true, // ⏰ follow-up tracker (3+ din silent agents)
    followupDays: 3, followupHour: 10,
    dispatchPlan: true,  // 🎯 suggested-dispatch highlighted cards (GV + FF)
    suggestDays: 15,     // 🎯 suggested qty = avg VC4/day × ye din − stock
    suggestMode: 'both', // 🎯 kaise dikhaye: 'both' = stock − aur bina stock dono | 'net' | 'gross'
    officeLat: 0, officeLng: 0, // 🗺 office location (0 = unset — map card se set karo)
    alerts: { lowCover: true, midMonth: true, inactive: true, zeroDay: true, newLoginIp: true, anomaly: true }
  },
  notificationRoutes: { ...DEFAULT_NOTIFICATION_ROUTES }, // 🔔 automated event → admin/users/both/off
  personalLinks: [],     // 🔗 { id, kind, name, token, enabled } — sirf admin (settingsFor non-admin ko strip karta hai)
  schedules: [],         // 🗓 { id, title, text, kind: daily|weekly|monthly, hour, weekday, day, target, enabled }
  email: { provider: 'auto', host: '', port: 587, secure: false, user: '', pass: '', from: '', to: '', resendKey: '', brevoKey: '' }, // provider: auto | smtp | appsscript | resend | brevo (mailer.js)
  lastBackupAt: null,
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
/** Admin ke feature flags + modify numbers (Settings → 🎛 Features) — defaults ke saath merged. */
function feats() { return deepMerge(DEFAULT_SETTINGS.features, (db.settings && db.settings.features) || {}); }
/**
 * FF REPORT commission mapping ka value — column letter (BZ) YA heading ka naam ("Commission Rate").
 * Naam wale values ko browser exact heading se match karta hai, isliye admin sheet ke heading ka
 * poora naam likh sakta hai (pehle sirf 1–3 letter allowed the aur save hi fail ho jata tha).
 */
function cleanColumnMapping(raw, key) {
  const text = String(raw === null || raw === undefined ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (/^[A-Za-z]{1,3}$/.test(text)) return text.toUpperCase();
  if (text.length > 80) throw new HttpError(400, `${key}: column letter (jaise BZ) ya heading ka naam 80 characters tak likho.`);
  if (!/[A-Za-z0-9]/.test(text)) throw new HttpError(400, `${key}: column letter (e.g. BZ) ya REPORT heading ka naam likho.`);
  if (!/^[\w\s%₹/().#&+:'",\-@*]+$/u.test(text)) throw new HttpError(400, `${key}: heading ke naam me sirf normal characters use karo (letters, digits, %, ₹, /, ( ), -, .).`);
  return text;
}
/** Settings payload: bina login (ya non-admin) ke email SMTP secrets kabhi mat bhejo. */
function settingsFor(u) {
  if (u && u.role === 'admin') return db.settings;
  const s = { ...db.settings };
  if (s.email) s.email = { provider: s.email.provider || 'auto', host: s.email.host || '', port: s.email.port || '', secure: !!s.email.secure, user: '', pass: '', from: s.email.from || '', to: s.email.to || '', resendKey: '', brevoKey: '' };
  delete s.personalLinks; // 🔗 secret tokens sirf admin ko
  delete s.schedules;     // 🗓 admin ke custom reminders
  delete s.dispatchEmail; // 🚚 selected recipients + delivery schedule sirf admin ko
  return s;
}
/** sw.js ka CACHE_NAME — app version (update-toast ke liye). */
let SW_VERSION = '';
try { SW_VERSION = (readFileSync(path.join(__dirname, 'sw.js'), 'utf8').match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/) || [])[1] || ''; } catch { /* dev mode */ }

// 📧 Mail transport (SMTP + HTTPS providers) — mailer.js

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
const DEFAULT_NOTIFY_PREFS = { enabled: true, login: true, signup: true, report: true, monthly: true, digest: true, alert: true, activity: true, click: true, search: true, settings: true, user: true, location: true, info: true, sound: true, push: true };
function normalizeNotifyPrefs(p) {
  const out = { ...DEFAULT_NOTIFY_PREFS };
  if (p && typeof p === 'object') for (const k of Object.keys(DEFAULT_NOTIFY_PREFS)) if (p[k] !== undefined) out[k] = !!p[k];
  return out;
}
function publicUser(u) {
  if (!u) return null;
  return { username: u.username, name: u.name || u.username, email: u.email || '', mobile: u.mobile || '', avatar: u.avatar || '', role: u.role, approved: !!u.approved, permissions: u.role === 'admin' ? allPermKeysNow() : (u.permissions || []), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, mustChangePassword: !!u.mustChangePassword, lastLocation: u.lastLocation || null, notificationsSeenAt: u.notificationsSeenAt || null, notifyAccess: u.role === 'admin' ? true : (u.notifyAccess !== false), notifyPrefs: normalizeNotifyPrefs(u.notifyPrefs), loginHistory: Array.isArray(u.loginHistory) ? u.loginHistory.slice(-10) : [] };
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
function notificationRoutes() {
  const saved = db.settings && db.settings.notificationRoutes;
  const out = { ...DEFAULT_NOTIFICATION_ROUTES };
  if (saved && typeof saved === 'object') for (const key of Object.keys(out)) {
    if (NOTIFICATION_AUDIENCES.has(saved[key])) out[key] = saved[key];
  }
  return out;
}
function notificationVisible(item, user) {
  if (!item || !user) return false;
  // Naye routed items admin/user audience ko exactly respect karte hain. Legacy items ka purana
  // behaviour preserve hai: admin ko poora operational feed, user ko personal/broadcast only.
  if (item.audience) {
    if (user.role === 'admin') return item.audience === 'admin' || item.audience === 'both';
    if (user.notifyAccess === false) return false;
    return item.audience === 'users' || item.audience === 'both';
  }
  if (user.role === 'admin') return true;
  if (user.notifyAccess === false) return false;
  if (item.target === 'broadcast') return true;
  return item.target === `user:${user.username}`;
}
function recordNotification({ type = 'info', title, body, target = 'admin', meta = {}, routeKey = '' }) {
  let audience = '';
  if (routeKey && Object.hasOwn(DEFAULT_NOTIFICATION_ROUTES, routeKey)) {
    audience = notificationRoutes()[routeKey];
    if (audience === 'off') return null;
    target = audience === 'admin' ? 'admin' : 'broadcast';
  }
  const item = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`, type, title: String(title || 'Notification').slice(0, 120), body: String(body || '').slice(0, 800), target, ...(routeKey ? { routeKey, audience } : {}), meta, createdAt: new Date().toISOString() };
  notifyItems().push(item);
  if (notifyItems().length > 500) db.notify.items = notifyItems().slice(-500);
  persist('notify');
  pushFanout(item); // 🔔 instant web push — app band ho tab bhi
  return item;
}
  /** 📜 Audit log (sirf admin Settings → 📜 tab) — best-effort, kabhi action fail nahi karwana. */
  function logAudit(user, action, detail = {}) {
    try {
      if (!db.notify || typeof db.notify !== 'object') db.notify = { items: [], watch: {} };
      if (!Array.isArray(db.notify.audit)) db.notify.audit = [];
      db.notify.audit.push({
        at: new Date().toISOString(),
        actor: (user && user.username) || String(detail.actor || 'anon').slice(0, 40),
        role: user ? user.role : '',
        action: String(action).slice(0, 40),
        target: String(detail.target || '').slice(0, 80),
        note: String(detail.note || '').slice(0, 200),
        ip: String(detail.ip || '').slice(0, 60)
      });
      if (db.notify.audit.length > 400) db.notify.audit = db.notify.audit.slice(-400);
      persist('notify').catch(() => {});
    } catch { /* audit never breaks the main action */ }
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
const CLIENT_PAGES = new Set(['home', 'tagIssued', 'targets', 'rangeReport', 'dashboard', 'trend', 'performance', 'stock', 'stockReport', 'gvDashboard', 'gvTrend', 'gvPerformance', 'gvStock', 'gvStockReport', 'compare', 'charts', 'dispatchPlan', 'tlScorecard']);
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
const otps = new Map(); // 📱 pending login OTP tickets (ticket → {username, code, exp, tries, ip, loginId})
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
    // Voice search needs microphone access after an explicit user click; camera stays disabled.
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(self)',
    ...(FRAME_PROTECTION ? { 'X-Frame-Options': 'SAMEORIGIN' } : {}),
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; img-src 'self' data: blob: https://tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://docs.google.com",
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
/** Reuse the gviz proxy cache for server-rendered personal pages (and stale data if Google blips). */
async function fetchUpstreamCached(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < cacheMs()) return { status: hit.status || 200, body: hit.body, cached: true };
  try {
    let job = inflight.get(url);
    if (!job) { job = fetchUpstream(url).finally(() => inflight.delete(url)); inflight.set(url, job); }
    const out = await job;
    const okBody = out.status >= 200 && out.status < 300 && out.body.includes('setResponse') && !/"status"\s*:\s*"error"/.test(out.body);
    if (okBody) {
      cache.set(url, { at: Date.now(), body: out.body, status: out.status });
      if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    }
    return out;
  } catch (err) {
    if (hit) return { status: hit.status || 200, body: hit.body, cached: true, stale: true };
    throw err;
  }
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
/**
 * Small collaborative workspace stored with notifications so it works with every persistence
 * backend (files, Sheets API and Apps Script) without adding another storage table.
 */
function workspaceStore() {
  if (!db.notify || typeof db.notify !== 'object') db.notify = { items: [], watch: {}, push: [] };
  if (!db.notify.workspace || typeof db.notify.workspace !== 'object') db.notify.workspace = {};
  const w = db.notify.workspace;
  if (!Array.isArray(w.views)) w.views = [];
  if (!Array.isArray(w.notes)) w.notes = [];
  return w;
}
const workspaceId = (prefix) => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
const shortText = (value, max) => String(value ?? '').trim().slice(0, max);
function visibleWorkspaceView(view, user) {
  return !!view && (view.shared === true || view.owner === user.username || user.role === 'admin');
}
function publicWorkspaceUser(username) {
  const u = findUser(username);
  return u ? { username: u.username, name: u.name || u.username } : { username, name: username };
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
    if (!notificationVisible(item, u)) return false;
    const prefs = normalizeNotifyPrefs(u.notifyPrefs);
    if (prefs.enabled === false) return false; // master switch OFF → koi push nahi
    if (prefs.push === false) return false;
    if (prefs[item.type] === false) return false;
    return true;
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
      routeKey: 'monthlyReport',
      meta: { monthlyReport: prev, link: `#/compare?monthA=${prev}&monthB=${prevPrev}` }
    });
    console.log(`monthly report notification sent for ${prev}`);
  } catch (err) { console.warn('monthly report:', err.message); }
}
// ---- 🌅 daily digest: roz ek baar (IST subah 8 ke baad) — kal ki issuance, MTD, abhi ka stock ----
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function istNow() { return new Date(Date.now() + 5.5 * 3600e3); } // sirf date/hour ke liye (UTC+5:30)
/** IST ka aaj ka YYYY-MM-DD */
function dateKeyNow() { const ist = istNow(); const pad = (n) => String(n).padStart(2, '0'); return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`; }
/** Current stock total + class split from one inventory tab (one gviz group-by query). */
async function stockSnapshotFrom(sheetId, sheet, clsCol, tagCol, label) {
  try {
    const tq = `select ${clsCol}, count(${tagCol}) where ${tagCol} is not null group by ${clsCol}`;
    const params = new URLSearchParams({ id: String(sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet, tq });
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
  } catch (err) { console.warn(`${label || 'stock'} snapshot:`, err.message); return null; }
}
/** StockDataa (First Forward) current stock. */
async function stockSnapshot() {
  const s = db.settings, cfg = s.stock || {};
  return stockSnapshotFrom(s.sheetId, s.stockSheet || 'StockDataa', cfg.cls || 'E', cfg.tagId || 'C', 'FF stock');
}
/** Tag Assignment (GV Partner) current stock. */
async function gvStockSnapshot() {
  const s = db.settings, cfg = (s.gv && s.gv.assignment) || {};
  return stockSnapshotFrom(s.gvSheetId, cfg.tab || 'Tag Assignment', cfg.cls || 'A', cfg.tagId || 'B', 'GV stock');
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
      const F = feats();
      if (ist.getUTCHours() < (Number(F.digestHour) || 8)) return null; // digest hour (default subah 8)
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
      routeKey: 'dailyDigest',
      meta: { date: dateKey, link: '#/dashboard', ffMtd, mtdDays, stock: stock ? stock.total : null }
    });
    db.notify.watch.digestDate = dateKey;
    persist('notify').catch(() => {});
    console.log(`daily digest sent for ${dateKey} (${parts.length} lines)`);
    // 📧 Email digest (admin Features tab me ON + SMTP configured ho to).
    const F = feats(), ecfg = db.settings.email || {};
    if (F.emailDigest && mailConfigured(ecfg) && ecfg.to) {
      sendMail(ecfg, `🌅 Daily digest · ${dLabel(dateKey)}`, parts.join('\n'))
        .then(() => console.log('digest email sent'))
        .catch((e) => console.warn('digest email:', e.message));
    }
    return item;
  } catch (err) { console.warn('daily digest:', err.message); return null; }
}
// ---- 🔴 low-cover alert + 📉 stock history (server ke snapshots) --------------------------------
let stockCheckAt = 0;
/**
 * Stock ka current snapshot: history me save (Stock page ka 30-din chart) + cover band calculate
 * (VC4 stock ÷ MTD avg daily issuance). Cover agar kharab hua — turant alert; red zone me to roz
 * ek reminder. 30-min throttle (gviz query bacha rahe).
 */
async function refreshStockState(force = false) {
  if (!force && Date.now() - stockCheckAt < 30 * 60e3) return null;
  stockCheckAt = Date.now();
  try {
    if (!db.notify || typeof db.notify !== 'object') db.notify = { items: [], watch: {} };
    if (!db.notify.watch || typeof db.notify.watch !== 'object') db.notify.watch = {};
    const watch = db.notify.watch;
    const [stock, gvStock] = await Promise.all([stockSnapshot(), gvStockSnapshot()]);
    if (!stock && !gvStock) return null;
    const ist = istNow();
    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
    // 📉 Per-day history (last changed snapshot wins). Legacy top-level fields remain FF-compatible.
    if (!watch.stockHistory || typeof watch.stockHistory !== 'object') watch.stockHistory = {};
    const snap = (value) => {
      if (!value) return null;
      const vc4 = (value.classes && value.classes.VC4) || 0;
      return { total: value.total, vc4, comm: value.total - vc4, classes: { ...(value.classes || {}) } };
    };
    const ffEntry = snap(stock), gvEntry = snap(gvStock);
    const combinedEntry = (ffEntry || gvEntry) ? {
      total: Number(ffEntry && ffEntry.total || 0) + Number(gvEntry && gvEntry.total || 0),
      vc4: Number(ffEntry && ffEntry.vc4 || 0) + Number(gvEntry && gvEntry.vc4 || 0),
      comm: Number(ffEntry && ffEntry.comm || 0) + Number(gvEntry && gvEntry.comm || 0)
    } : null;
    const values = { total: Number(ffEntry && ffEntry.total || 0), vc4: Number(ffEntry && ffEntry.vc4 || 0), comm: Number(ffEntry && ffEntry.comm || 0), ff: ffEntry, gv: gvEntry, combined: combinedEntry };
    const prevEntry = watch.stockHistory[dateKey] || {};
    const previousValues = { total: Number(prevEntry.total || 0), vc4: Number(prevEntry.vc4 || 0), comm: Number(prevEntry.comm || 0), ff: prevEntry.ff || null, gv: prevEntry.gv || null, combined: prevEntry.combined || null };
    let changed = false;
    if (JSON.stringify(previousValues) !== JSON.stringify(values)) {
      watch.stockHistory[dateKey] = { ...values, capturedAt: new Date().toISOString() };
      changed = true;
      const keys = Object.keys(watch.stockHistory).sort();
      for (let i = 0; i < Math.max(0, keys.length - 400); i++) delete watch.stockHistory[keys[i]];
    }
    const vc4 = Number(ffEntry && ffEntry.vc4 || 0);
    // 🔴 Cover = FF VC4 stock ÷ is mahine ka avg daily issuance (server ki per-date history se).
    const daily = watch.daily && typeof watch.daily === 'object' ? watch.daily : {};
    const monthKey = dateKey.slice(0, 7);
    let ffMtd = 0, mtdDays = 0;
    for (const [d, v] of Object.entries(daily)) if (d.startsWith(monthKey) && v && Number(v.ff)) { ffMtd += Number(v.ff); mtdDays++; }
    const avg = mtdDays ? ffMtd / mtdDays : 0;
    if (!vc4 || avg <= 0 || mtdDays < 3) { if (changed) persist('notify').catch(() => {}); return null; } // alert ke liye ≥3 din ka data
    const th = db.settings.thresholds || {};
    const coverRed = Number(th.coverRed) || 7, coverOrange = Number(th.coverOrange) || 15, coverAmber = Number(th.coverAmber) || 30;
    const cover = vc4 / avg;
    const band = cover < coverRed ? 'red' : cover < coverOrange ? 'orange' : cover < coverAmber ? 'amber' : 'green';
    const prevBand = watch.cover && watch.cover.band;
    watch.cover = { at: new Date().toISOString(), cover: Math.round(cover * 10) / 10, band, vc4, avg: Math.round(avg) };
    const rank = { green: 0, amber: 1, orange: 2, red: 3 };
    const emoji = { red: '🔴', orange: '🟠', amber: '🟡', green: '🟢' };
    const worsened = !!prevBand && rank[band] > rank[prevBand];
    const dailyRed = band === 'red' && watch.coverAlertDate !== dateKey;
    if ((worsened || dailyRed) && feats().alerts.lowCover !== false) {
      if (band === 'red') watch.coverAlertDate = dateKey;
      recordNotification({
        type: 'alert',
        title: `${emoji[band]} VC4 stock cover ≈ ${Math.round(cover)} din`,
        body: `Cover ${band} zone me${band === 'red' ? ` (< ${coverRed} din)` : ''} — VC4 stock ${vc4} ÷ MTD avg ${Math.round(avg)}/din.${worsened ? ` Pichhle check me ${prevBand} tha.` : ''} Stock page se class / TL wise dekho.`,
        target: 'admin',
        routeKey: 'lowStock',
        meta: { link: '#/stock', band, cover: Math.round(cover), vc4, avg: Math.round(avg) }
      });
      changed = true;
    }
    if (changed) persist('notify').catch(() => {});
    return { stock, cover, band, mtdDays };
  } catch (err) { console.warn('stock state:', err.message); return null; }
}
// ---- 🎯 mid-month target check (mahine ki 15–25 tareekh ke beech, ek baar) ----------------------
async function maybeMidMonthAlert() {
  try {
    if (!db.notify || typeof db.notify !== 'object') db.notify = { items: [], watch: {} };
    if (!db.notify.watch || typeof db.notify.watch !== 'object') db.notify.watch = {};
    const ist = istNow();
    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
    const day = Number(dateKey.slice(8, 10));
    const ym = dateKey.slice(0, 7);
    const F = feats();
    if (F.alerts.midMonth === false) return null;
    // Server free-tier par sota hai — window (default 15–25) rakhi taaki wake-up par bhi check ho jaye.
    if (day < (Number(F.midFrom) || 15) || day > (Number(F.midTo) || 25)) return null;
    if (db.notify.watch.midMonthAlert === ym) return null;
    const targets = Array.isArray(db.settings.targets) ? db.settings.targets : [];
    const totalTarget = targets.filter((t) => t && t.ym === ym && Number(t.target) > 0).reduce((a, t) => a + Number(t.target), 0);
    const daily = db.notify.watch.daily && typeof db.notify.watch.daily === 'object' ? db.notify.watch.daily : {};
    let ffMtd = 0, gvMtd = 0;
    for (const [d, v] of Object.entries(daily)) if (d.startsWith(ym) && v) { ffMtd += Number(v.ff) || 0; gvMtd += Number(v.gv) || 0; }
    const achieved = ffMtd + gvMtd;
    const daysInMonth = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    const monthLabel = `${day} ${MON_SHORT[Number(dateKey.slice(5, 7)) - 1]}`;
    const keep = 1 - (Number(F.midGapPct) || 40) / 100; // 40%+ peeche = achieved expected ka 60% se kam
    let behind = false, body = '';
    if (totalTarget > 0) {
      const expected = totalTarget * (day / daysInMonth);
      const pct = expected > 0 ? Math.round((achieved / expected) * 100) : 100;
      // 40%+ peeche = achieved expected pace ka 60% se kam.
      if (expected > 0 && achieved < expected * keep) {
        behind = true;
        body = `${monthLabel} (day ${day}/${daysInMonth}): FF+GV ${achieved.toLocaleString('en-IN')} tags vs target ${totalTarget.toLocaleString('en-IN')} ka expected pace ${Math.round(expected).toLocaleString('en-IN')} — sirf ${pct}% (lagbhag ${100 - pct}% peeche). Targets page par agents ko push karo.`;
      }
    } else {
      // Target set nahi hai → pichhle mahine isi tarikh tak ka actual = benchmark.
      const prevD = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 0));
      const prevYm = `${prevD.getUTCFullYear()}-${pad(prevD.getUTCMonth() + 1)}`;
      let prevSame = 0;
      for (const [d, v] of Object.entries(daily)) if (d.startsWith(prevYm) && Number(d.slice(8, 10)) <= day && v) prevSame += (Number(v.ff) || 0) + (Number(v.gv) || 0);
      if (prevSame > 0 && achieved < prevSame * keep) {
        behind = true;
        body = `${monthLabel}: FF+GV ${achieved.toLocaleString('en-IN')} tags — pichhle mahine isi tarikh tak ${prevSame.toLocaleString('en-IN')} the (lagbhag ${100 - Math.round((achieved / prevSame) * 100)}% peeche). Target set karo (Targets page) ya pace badhao.`;
      }
    }
    if (!behind) return null;
    db.notify.watch.midMonthAlert = ym;
    persist('notify').catch(() => {});
    return recordNotification({ type: 'alert', title: `🎯 Mid-month target miss · ${monthLabel}`, body, target: 'admin', routeKey: 'midMonth', meta: { link: '#/targets', achieved, totalTarget, day } });
  } catch (err) { console.warn('mid-month alert:', err.message); return null; }
}
// ---- 💤 weekly inactive users (Monday, 9 AM IST ke baad — hafte me ek baar) ----------------------
function maybeInactiveUsers() {
  try {
    if (feats().alerts.inactive === false) return null;
    if (!db.notify || typeof db.notify !== 'object') db.notify = { items: [], watch: {} };
    if (!db.notify.watch || typeof db.notify.watch !== 'object') db.notify.watch = {};
    const ist = istNow();
    if (ist.getUTCDay() !== 1 || ist.getUTCHours() < 9) return null; // sirf Monday ≥ 09:00 IST
    const pad = (n) => String(n).padStart(2, '0');
    const monday = new Date(ist.getTime() - ((ist.getUTCDay() + 6) % 7) * 86400e3);
    const weekKey = `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
    if (db.notify.watch.inactiveWeek === weekKey) return null;
    const th = db.settings.thresholds || {};
    const maxDays = Number(th.inactiveDays) || 3;
    const now = Date.now();
    const stale = db.users.filter((u) => u && u.approved && u.role !== 'admin').map((u) => {
      const last = Date.parse(u.lastLoginAt || '') || Date.parse(u.createdAt || '');
      return { username: u.username, name: u.name || u.username, days: last ? Math.floor((now - last) / 86400e3) : null };
    }).filter((u) => u.days === null || u.days >= maxDays);
    db.notify.watch.inactiveWeek = weekKey;
    persist('notify').catch(() => {});
    if (!stale.length) return null;
    const list = stale.sort((a, b) => (b.days === null ? 999 : b.days) - (a.days === null ? 999 : a.days)).slice(0, 12)
      .map((u) => `${u.name} ${u.days === null ? '(kabhi login nahi kiya)' : `(${u.days} din)`}`);
    return recordNotification({
      type: 'info',
      title: `💤 Inactive users · ${stale.length} user ${maxDays}+ din se nahi aaye`,
      body: list.join(', ') + (stale.length > 12 ? ' …' : ''),
      target: 'admin',
      routeKey: 'inactiveUsers',
      meta: { link: '#/settings?tab=users', users: stale.map((u) => u.username).slice(0, 40) }
    });
  } catch (err) { console.warn('inactive users:', err.message); return null; }
}
/** Ek jagah se saare scheduled checks — boot + har 30 min. */
function runScheduledChecks() {
  const F = feats();
  return Promise.allSettled([
    maybeDailyDigest(false),
    maybeMidMonthAlert(),
    maybeInactiveUsers(),
    F.alerts.zeroDay === false ? Promise.resolve() : maybeZeroDayAlert(),
    F.backupReminder === false ? Promise.resolve() : maybeBackupReminder(),
    maybeAgentAnomaly(),
    schedulesTick(),
    maybeChampionEmail(false),
    maybeFollowup(false),
    maybeWorkspaceFollowups(false),
    sendWeeklyEmail(false),
    sendReportEmail(false),
    sendDispatchPlanEmail(false),
    refreshStockState(false)
  ]);
}
// ---- ⚠️ zero-day / sharp-drop alert (raat 9 IST ke baad, din me ek baar) ------------------------
async function maybeZeroDayAlert() {
  try {
    if (feats().alerts.zeroDay === false) return null;
    const ist = istNow();
    if (ist.getUTCHours() < 21) return null; // din khatam hone ka wait
    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
    if (db.notify.watch.zeroAlertDate === dateKey) return null;
    await checkReports(false).catch(() => {}); // taaza FF snapshot (5-min throttle)
    const watch = db.notify.watch || {};
    const daily = watch.daily && typeof watch.daily === 'object' ? watch.daily : {};
    const F = feats();
    const dropPct = Number(F.zeroDropPct) || 50;
    const padDay = (d) => { const dt = new Date(d); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; };
    const nowD = new Date(`${dateKey}T00:00:00Z`);
    // Prev 7 din (aaj ke pehle) — jin ka entry hai unka avg.
    let prevSum = 0, prevDays = 0;
    for (let i = 1; i <= 7; i++) {
      const k = padDay(new Date(nowD.getTime() - i * 86400e3));
      const v = Number(daily[k] && daily[k].ff) || 0;
      if (daily[k]) { prevSum += v; prevDays++; }
    }
    const prevAvg = prevDays ? prevSum / prevDays : 0;
    if (prevAvg <= 0) return null; // benchmark hi nahi
    const todayFf = daily[dateKey] ? Number(daily[dateKey].ff) || 0 : null;
    const ffSnap = watch.ff && watch.ff.date ? watch.ff : null;
    const sheetHasToday = !!(ffSnap && ffSnap.date >= dateKey);
    // Case A: sheet me aaj ki rows hi nahi (snapshot ka date aaj se pehle ka) → 0 issuance day.
    const staleOk = ffSnap && ffSnap.date && ffSnap.date >= padDay(new Date(nowD.getTime() - 3 * 86400e3));
    const isZero = !sheetHasToday && staleOk;
    // Case B: aaj data hai par pichhle avg se dropPct+ kam.
    const isDrop = !isZero && todayFf !== null && todayFf < prevAvg * (1 - dropPct / 100);
    if (!isZero && !isDrop) return null;
    db.notify.watch.zeroAlertDate = dateKey;
    persist('notify').catch(() => {});
    const base = `Pichhle ${prevDays} active din ka avg ≈ ${Math.round(prevAvg)}/din.`;
    return recordNotification({
      type: 'alert',
      title: isZero ? `⚠️ Aaj abhi tak 0 issuance (${dateKey.slice(8, 10)} ${MON_SHORT[Number(dateKey.slice(5, 7)) - 1]})` : `⚠️ Sharp drop · aaj sirf ${todayFf} tags (avg ${Math.round(prevAvg)})`,
      body: isZero
        ? `${base} Sheet me aaj ka koi ISSUE_DATE nahi mila — EIR sheet update hui ya nahi, ek baar dekh lo.`
        : `${base} Aaj ${Math.round(100 - (todayFf / prevAvg) * 100)}% kam (${dropPct}%+ gira threshold). Trend page par day-wise dekho.`,
      target: 'admin',
      routeKey: 'zeroDay',
      meta: { link: '#/trend', date: dateKey, prevAvg: Math.round(prevAvg), today: todayFf || 0 }
    });
  } catch (err) { console.warn('zero-day alert:', err.message); return null; }
}
// ---- ☁️ settings backup reminder (roz ek baar, backup purana ho to) -----------------------------
function maybeBackupReminder() {
  try {
    const F = feats();
    if (F.backupReminder === false) return null;
    const ist = istNow();
    if (ist.getUTCHours() < 10) return null;
    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
    if (db.notify.watch.backupRemindDate === dateKey) return null;
    const maxAge = Number(F.backupDays) || 7;
    const last = Date.parse(db.settings.lastBackupAt || '') || Date.parse(db.settings.updatedAt || '') || 0;
    if (!last) return null;
    const age = (Date.now() - last) / 86400e3;
    if (age < maxAge) return null;
    db.notify.watch.backupRemindDate = dateKey;
    persist('notify').catch(() => {});
    return recordNotification({
      type: 'info',
      title: `☁️ Settings backup purana hai (${Math.floor(age)} din)`,
      body: `Settings → ☁️ Storage & backup se settings JSON download kar lo — ${maxAge} din se purana ho chuka hai. Render/storage badalne se pehle ye zaroori hai.`,
      target: 'admin',
      routeKey: 'backupReminder',
      meta: { link: '#/settings?tab=backup', ageDays: Math.floor(age) }
    });
  } catch (err) { console.warn('backup reminder:', err.message); return null; }
}
// ---- 📬 weekly auto-digest email (Monday) + 📧 roz scheduled report email (HTML + CSV) ----------
function emailCfgOrThrow(force) {
  const cfg = db.settings.email || {};
  if (!mailConfigured(cfg) || !cfg.to) {
    if (force) throw new Error('Email provider / To set nahi — Settings → 🎛 Features → Email configure karo');
    return null;
  }
  return cfg;
}
/** Pichhle Monday–Sunday (ya aaj week) ka FF/GV summary — email body ke liye. */
function weekRows(monday) {
  const pad = (n) => String(n).padStart(2, '0');
  const daily = (db.notify.watch && db.notify.watch.daily) || {};
  const rows = [];
  let ff = 0, gv = 0, best = 0, bestDay = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getTime() + i * 86400e3);
    const k = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const v = daily[k] || {};
    const f = Number(v.ff) || 0, g = Number(v.gv) || 0;
    ff += f; gv += g;
    if (f + g > best) { best = f + g; bestDay = k; }
    rows.push({ date: k, ff: f, gv: g, total: f + g });
  }
  return { rows, ff, gv, best, bestDay, days: rows.filter((r) => r.total > 0).length };
}
async function sendWeeklyEmail(force = false) {
  const F = feats();
  if (!force && F.weeklyEmail !== true) return null; // default OFF — admin Features tab se ON kare
  const cfg = emailCfgOrThrow(force);
  if (!cfg) return null;
  const ist = istNow();
  if (!force) {
    if (ist.getUTCDay() !== 1) return null; // Monday
    if (ist.getUTCHours() < (Number(F.weeklyEmailHour) || 9)) return null;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const monday = new Date(ist.getTime() - ((ist.getUTCDay() + 6) % 7) * 86400e3);
  const weekKey = `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
  if (!force && db.notify.watch.weeklyEmailKey === weekKey) return null;
  await checkReports(false).catch(() => {});
  const w = weekRows(monday);
  const stock = await stockSnapshot();
  const th = db.settings.thresholds || {};
  const coverRed = Number(th.coverRed) || 7, coverOrange = Number(th.coverOrange) || 15, coverAmber = Number(th.coverAmber) || 30;
  let coverTxt = '';
  if (stock && stock.classes && stock.classes.VC4) {
    const avg = w.days ? (w.ff + w.gv) / w.days : 0;
    const cover = avg > 0 ? stock.classes.VC4 / avg : 0;
    const band = !cover ? '' : cover < coverRed ? '🔴' : cover < coverOrange ? '🟠' : cover < coverAmber ? '🟡' : '🟢';
    coverTxt = cover ? `\n🚗 VC4 cover ≈ ${Math.round(cover)} din ${band}` : '';
  }
  const subject = `📬 Weekly digest · ${weekKey} week (FF ${w.ff} · GV ${w.gv})`;
  const text = [
    `Weekly digest — ${db.settings.brand || 'Dashboard'} · week ${weekKey}`,
    '',
    `🟦 FF tags: ${w.ff}`,
    `🟩 GV tags: ${w.gv}`,
    `📈 Total: ${w.ff + w.gv} · active days: ${w.days}/7${w.bestDay ? ` · best day: ${w.bestDay} (${w.best})` : ''}`,
    stock ? `📦 Stock: ${stock.total} (VC4 ${stock.classes.VC4 || 0} | Comm ${stock.total - (stock.classes.VC4 || 0)})` : '',
    coverTxt,
    '',
    'Day-wise:',
    ...w.rows.map((r) => `  ${r.date}: FF ${r.ff} · GV ${r.gv} · ${r.total}`),
    '',
    `Dashboard: (is app me kholo)`
  ].filter((l) => l !== '').join('\n');
  await sendMail(cfg, subject, text);
  db.notify.watch.weeklyEmailKey = weekKey;
  persist('notify').catch(() => {});
  logAudit(null, 'weekly_email_sent', { actor: 'scheduler', note: `FF ${w.ff} · GV ${w.gv} · total ${w.ff + w.gv}` });
  console.log(`weekly digest email sent (${weekKey}: FF ${w.ff} · GV ${w.gv})`);
  return { week: weekKey, ff: w.ff, gv: w.gv };
}
async function sendReportEmail(force = false) {
  const F = feats();
  if (!force && F.emailReport !== true) return null;
  const cfg = emailCfgOrThrow(force);
  if (!cfg) return null;
  const ist = istNow();
  const dateKey = dateKeyNow();
  if (!force) {
    if (ist.getUTCHours() < (Number(F.emailReportHour) || 21)) return null;
    if (db.notify.watch.reportEmailDate === dateKey) return null;
  }
  await checkReports(false).catch(() => {});
  const pad = (n) => String(n).padStart(2, '0');
  const daily = (db.notify.watch && db.notify.watch.daily) || {};
  const keys = Object.keys(daily).sort().slice(-14);
  if (!keys.length) return null;
  let ffMtd = 0, gvMtd = 0, mtdDays = 0;
  const mk = dateKey.slice(0, 7);
  for (const [d, v] of Object.entries(daily)) if (d.startsWith(mk) && v) { const f = Number(v.ff) || 0, g = Number(v.gv) || 0; if (f || g) mtdDays++; ffMtd += f; gvMtd += g; }
  const stock = await stockSnapshot();
  const rows = keys.map((k) => ({ date: k, ff: Number(daily[k].ff) || 0, gv: Number(daily[k].gv) || 0 }));
  const csv = ['Date,FF,GV,Total', ...rows.map((r) => `${r.date},${r.ff},${r.gv},${r.ff + r.gv}`)].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <h2 style="margin:0 0 8px">📊 Daily report · ${dateKey}</h2>
    <p style="margin:0 0 10px;color:#64748b">${db.settings.brand || 'Dashboard'} · MTD FF <b>${ffMtd}</b> + GV <b>${gvMtd}</b> (${mtdDays} din)${stock ? ` · stock <b>${stock.total}</b> (VC4 ${stock.classes.VC4 || 0})` : ''}</p>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-size:13px">
      <tr style="background:#eef2ff"><th>Date</th><th>FF</th><th>GV</th><th>Total</th></tr>
      ${rows.reverse().map((r) => `<tr><td>${r.date}</td><td>${r.ff}</td><td>${r.gv}</td><td><b>${r.ff + r.gv}</b></td></tr>`).join('')}
    </table>
    <p style="color:#64748b;font-size:12px">CSV attach hai — Excel me seedha khul jayega.</p></div>`;
  const text = `Daily report ${dateKey} · MTD FF ${ffMtd} + GV ${gvMtd} · last ${rows.length} din ka CSV attach.\n` + rows.map((r) => `${r.date}: ${r.ff + r.gv}`).join('\n');
  await sendMail(cfg, `📊 Daily report · ${dateKey} (MTD ${ffMtd + gvMtd})`, text, { html, attachments: [{ name: `report-${dateKey}.csv`, content: csv }] });
  db.notify.watch.reportEmailDate = dateKey;
  persist('notify').catch(() => {});
  logAudit(null, 'report_email_sent', { actor: 'scheduler', note: `${rows.length} days · MTD ${ffMtd + gvMtd}` });
  console.log(`scheduled report email sent (${dateKey})`);
  return { date: dateKey, days: rows.length };
}

// ---- 🚚 Dispatch Planner scheduled email --------------------------------------------------------
async function dispatchReportTable(channel) {
  const settings = db.settings;
  const tabs = Array.isArray(settings.tabs) ? settings.tabs : DEFAULT_TABS;
  const isGv = channel === 'gv';
  const tab = tabs.find((t) => t && (isGv ? (t.id === 'GV REPORT' || t.tab === 'GV REPORT') : (t.id === 'REPORT' || t.tab === 'REPORT')));
  const report = isGv ? (settings.gv && settings.gv.report) || {} : {};
  const sheet = isGv ? (report.tab || (tab && tab.tab) || 'GV REPORT') : (tab && tab.tab) || 'REPORT';
  const sheetId = isGv ? settings.gvSheetId : settings.sheetId;
  const gid = isGv ? (report.gid || (tab && tab.gid) || '1284424234') : (tab && tab.gid) || settings.reportGid || '242489821';
  const params = new URLSearchParams({ id: String(sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), gid, sheet });
  if (isGv) params.set('range', `A${Number(report.headerRow) || 4}:${String(report.lastCol || 'BE').toUpperCase().replace(/[^A-Z]/g, '') || 'BE'}`);
  const out = await fetchUpstream(upstreamUrl(params));
  if (out.status < 200 || out.status >= 300) throw new Error(`${isGv ? 'GV REPORT' : 'FF REPORT'} sheet responded ${out.status}`);
  return parseGvizServer(out.body);
}
async function loadDispatchAgents(channel) {
  const jobs = [];
  if (channel !== 'gv') jobs.push(dispatchReportTable('ff').then((table) => loadFfDispatchRows(table, db.settings)));
  if (channel !== 'ff') jobs.push(dispatchReportTable('gv').then((table) => loadGvDispatchRows(table, db.settings)));
  const sources = await Promise.all(jobs);
  return sources.flat();
}
async function sendDispatchPlanEmail(force = false, input = null) {
  const saved = db.settings.dispatchEmail || DEFAULT_DISPATCH_EMAIL;
  let schedule;
  try { schedule = normalizeDispatchEmail(input || saved, saved); }
  catch (err) { if (force) throw err; console.warn('dispatch email schedule:', err.message); return null; }
  if (!force && schedule.enabled !== true) return null;
  const recipients = splitRecipients(schedule.recipients);
  if (!recipients.length) { if (force) throw new Error('Dispatch email recipients add karo.'); return null; }
  const emailCfg = db.settings.email || {};
  const mailCfg = { ...emailCfg, to: recipients.join(',') };
  if (!resolveProviders(mailCfg).length) { if (force) throw new Error('Email provider configure nahi — Settings → Features → Email me provider set karo.'); return null; }
  const ist = istNow(), dateKey = dateKeyNow();
  if (!force) {
    if (ist.getUTCHours() < schedule.hour) return null;
    if (schedule.kind === 'weekly' && ist.getUTCDay() !== schedule.weekday) return null;
    if (schedule.kind === 'monthly' && Number(ist.getUTCDate()) !== schedule.day) return null;
    const sent = Array.isArray(db.notify.watch.dispatchEmailFired) ? db.notify.watch.dispatchEmailFired : [];
    const slot = schedule.kind === 'weekly'
      ? (() => { const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7)); return monday.toISOString().slice(0, 10); })()
      : schedule.kind === 'monthly' ? dateKey.slice(0, 7) : dateKey;
    const scheduleId = crypto.createHash('sha256').update(JSON.stringify(schedule)).digest('hex').slice(0, 16);
    const sentKey = `${scheduleId}|${slot}`;
    if (sent.includes(sentKey)) return null;
  }
  const sourceAgents = await loadDispatchAgents(schedule.channel);
  if (!sourceAgents.length) throw new Error('Selected channel ke REPORT sheet me koi dispatch row nahi mili.');
  const plan = buildDispatchPlan(sourceAgents, schedule, { settings: db.settings, days: Number(feats().suggestDays) || 15, now: ist });
  if (!plan.summary.agents && !plan.summary.tls) throw new Error('Selected filters ke liye dispatch data nahi mila.');
  const email = dispatchEmailContent(plan, schedule, db.settings.brand || 'Dashboard', dateKey);
  const result = await sendMail(mailCfg, email.subject, email.text, { html: email.html, attachments: email.attachments });
  if (!force) {
    const sent = Array.isArray(db.notify.watch.dispatchEmailFired) ? db.notify.watch.dispatchEmailFired : [];
    const slot = schedule.kind === 'weekly'
      ? (() => { const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7)); return monday.toISOString().slice(0, 10); })()
      : schedule.kind === 'monthly' ? dateKey.slice(0, 7) : dateKey;
    const scheduleId = crypto.createHash('sha256').update(JSON.stringify(schedule)).digest('hex').slice(0, 16);
    db.notify.watch.dispatchEmailFired = [...sent, `${scheduleId}|${slot}`].slice(-240);
    persist('notify').catch(() => {});
  }
  logAudit(null, 'dispatch_email_sent', { actor: force ? 'admin:test' : 'scheduler', target: recipients.join(','), note: `${plan.summary.agents} agents · ${schedule.sections.join('+')} · ${result.provider}` });
  console.log(`dispatch email ${force ? 'test ' : ''}sent (${dateKey} · ${plan.summary.agents} agents · ${schedule.kind})`);
  return { date: dateKey, recipients: recipients.length, agents: plan.summary.agents, tls: plan.summary.tls, provider: result.provider, attached: email.attachments.map((a) => a.name) };
}

// ---- 🔍 agent anomaly (raat 9 IST) — achanak 0 / bahut kam issuance wale agents -----------------
async function maybeAgentAnomaly(force = false) {
  try {
    const F = feats();
    const doAgent = F.alerts.anomaly !== false;
    const doTl = F.tlAnomaly !== false;
    if (!doAgent && !doTl) return null;
    if (!force) {
      const ist = istNow();
      if (ist.getUTCHours() < 21) return null; // din khatam hone ka wait
      const dk0 = dateKeyNow();
      if (db.notify.watch.anomalyDate === dk0) return null;
    }
    const dateKey = dateKeyNow();
    await checkReports(false).catch(() => {}); // aaj ka FF snapshot confirm karne ke liye
    const sheetToday = !!(db.notify.watch.ff && db.notify.watch.ff.date && db.notify.watch.ff.date >= dateKey);
    const s = db.settings.eir || {};
    const sheet = db.settings.eirSheet || 'EIR';
    const agentCol = s.agentName || 'L', tlCol = s.tlName || 'BA', dateCol = s.date || 'AA', tagCol = s.tagId || 'A';
    const params = (tq) => new URLSearchParams({ id: String(db.settings.sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet, tq });
    const loadByName = async (firstCol) => {
      const tq = `select ${firstCol}, ${dateCol}, count(${tagCol}) where ${tagCol} is not null group by ${firstCol}, ${dateCol} order by ${dateCol} desc limit 3000`;
      const out = await fetchUpstream(upstreamUrl(params(tq)));
      if (out.status < 200 || out.status >= 300) return null;
      const table = parseGvizServer(out.body);
      const map = new Map();
      for (const row of table.rows || []) {
        const name = serverCell(row, 0).trim();
        const dk = serverDate(serverCell(row, 1));
        if (!name || !dk) continue;
        if (!map.has(name)) map.set(name, new Map());
        map.get(name).set(dk, serverNumber(serverCell(row, 2)));
      }
      return map;
    };
    const pad = (n) => String(n).padStart(2, '0');
    const dayMinus = (k, i) => { const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - i); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
    const pct = Number(F.anomalyPct) || 80;
    const evaluate = (byName, minAvg) => {
      const suspects = [];
      for (const [name, m] of byName) {
        let sum = 0, days = 0;
        for (let i = 1; i <= 7; i++) { const k = dayMinus(dateKey, i); if (m.has(k)) { sum += m.get(k); days++; } }
        const avg = days ? sum / days : 0;
        if (days < 3 || avg < minAvg) continue;
        const hasToday = m.has(dateKey);
        const todayN = hasToday ? m.get(dateKey) : 0;
        const isDrop = hasToday && todayN <= avg * (1 - pct / 100);
        const isZero = !hasToday && avg >= minAvg * 1.6 && sheetToday;
        if (isDrop || isZero) suspects.push({ name, today: todayN, avg: Math.round(avg * 10) / 10 });
      }
      suspects.sort((a, b) => b.avg - a.avg);
      return suspects;
    };
    const out = { agent: null, tl: null };
    const excluded = new Set((Array.isArray(db.settings.excludeTls) ? db.settings.excludeTls : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean));
    if (doAgent) {
      const byAgent = await loadByName(agentCol);
      if (byAgent) {
        const suspects = evaluate(byAgent, 3);
        if (suspects.length) {
          const top = suspects.slice(0, 12);
          out.agent = recordNotification({
            type: 'alert',
            title: `📉 Agent anomaly · ${suspects.length} agent ${pct}%+ down (${dateKey.slice(8, 10)} ${MON_SHORT[Number(dateKey.slice(5, 7)) - 1]})`,
            body: top.map((x) => `${x.name} (${x.today} vs avg ${x.avg})`).join(', ') + (suspects.length > top.length ? ` …+${suspects.length - top.length}` : '') + `. Aaj ke numbers vs pichhle 7 din ka avg — Performance page par dekho.`,
            target: 'admin',
            routeKey: 'agentAnomaly',
            meta: { link: '#/performance', date: dateKey, count: suspects.length, pct }
          });
          logAudit(null, 'agent_anomaly', { actor: 'scheduler', note: `${suspects.length} agents ≥${pct}% down` });
        }
      }
    }
    if (doTl) {
      const byTl = await loadByName(tlCol);
      if (byTl) {
        const clean = new Map([...byTl].filter(([n]) => n && n !== '—' && !excluded.has(n.toLowerCase())));
        const suspects = evaluate(clean, 5);
        if (suspects.length) {
          const top = suspects.slice(0, 10);
          out.tl = recordNotification({
            type: 'alert',
            title: `🏆 TL anomaly · ${suspects.length} TL ${pct}%+ down (${dateKey.slice(8, 10)} ${MON_SHORT[Number(dateKey.slice(5, 7)) - 1]})`,
            body: top.map((x) => `${x.name} (${x.today} vs avg ${x.avg})`).join(', ') + (suspects.length > top.length ? ` …+${suspects.length - top.length}` : '') + `. Team issuance vs pichhle 7 din ka avg — Performance → TLs me dekho.`,
            target: 'admin',
            routeKey: 'tlAnomaly',
            meta: { link: '#/performance?view=tls', date: dateKey, count: suspects.length, pct }
          });
          logAudit(null, 'tl_anomaly', { actor: 'scheduler', note: `${suspects.length} TLs ≥${pct}% down` });
        }
      }
    }
    if (sheetToday || out.agent || out.tl) { db.notify.watch.anomalyDate = dateKey; persist('notify').catch(() => {}); }
    return out;
  } catch (err) { console.warn('agent anomaly:', err.message); return null; }
}
let reportCheckAt = 0;
let reportCheckPromise = null;

// ---- 🗓 custom alert scheduler (admin ke reminders/status) ------------------------------------
function renderSchedText(text) {
  const daily = (db.notify.watch && db.notify.watch.daily) || {};
  const ff = (db.notify.watch && db.notify.watch.ff) || {};
  const ym = dateKeyNow().slice(0, 7);
  let mtd = 0;
  for (const [d, v] of Object.entries(daily)) if (d.startsWith(ym)) mtd += (Number(v.ff) || 0) + (Number(v.gv) || 0);
  const today = ff.date === dateKeyNow() ? Number(ff.total) || 0 : 0;
  return String(text || '')
    .replace(/\{date\}/g, dateKeyNow())
    .replace(/\{today\}/g, String(today))
    .replace(/\{mtd\}/g, String(mtd));
}
async function fireSchedule(sched, opts = {}) {
  const item = recordNotification({
    type: sched.type === 'alert' ? 'alert' : 'info',
    title: `🗓 ${sched.title || 'Reminder'}`,
    body: renderSchedText(sched.text),
    target: sched.target === 'broadcast' ? 'broadcast' : 'admin',
    meta: { schedule: true, link: sched.link || '', ...(opts.meta || {}) }
  });
  logAudit(null, 'schedule_fired', { actor: opts.force ? 'admin:test' : 'scheduler', target: String(sched.id || sched.title || ''), note: String(sched.text || '').slice(0, 60) });
  return item;
}
async function schedulesTick(forceSched = null) {
  try {
    const F = feats();
    const list = Array.isArray(db.settings.schedules) ? db.settings.schedules : [];
    if (forceSched) return await fireSchedule(forceSched, { force: true });
    if (F.customAlerts === false || !list.length) return [];
    const ist = istNow();
    const hour = ist.getUTCHours(), dow = ist.getUTCDay(), dom = Number(ist.getUTCDate());
    const dateKey = dateKeyNow();
    if (!Array.isArray(db.notify.watch.schedFired)) db.notify.watch.schedFired = [];
    const fired = new Set(db.notify.watch.schedFired);
    const out = [];
    for (const s of list) {
      if (!s || s.enabled === false) continue;
      const h = Number(s.hour);
      if (!Number.isFinite(h) || hour !== h) continue;
      const ok = s.kind === 'weekly' ? Number(s.weekday) === dow
        : s.kind === 'monthly' ? Number(s.day) === dom
        : true; // daily (default)
      if (!ok) continue;
      const key = `${s.id || s.title}|${dateKey}|${h}`;
      if (fired.has(key)) continue;
      fired.add(key);
      out.push(await fireSchedule(s));
    }
    if (out.length) {
      const keys = [...fired].slice(-240);
      db.notify.watch.schedFired = keys;
      persist('notify').catch(() => {});
    }
    return out;
  } catch (err) { console.warn('schedules:', err.message); return []; }
}
// ---- 🥇 monthly champion certificate email (SMTP) --------------------------------------------
async function championsList(topN) {
  const s = db.settings.eir || {};
  const sheet = db.settings.eirSheet || 'EIR';
  const agentCol = s.agentName || 'L', dateCol = s.date || 'AA', tagCol = s.tagId || 'A';
  const tq = `select ${agentCol}, ${dateCol}, count(${tagCol}) where ${tagCol} is not null group by ${agentCol}, ${dateCol} order by ${dateCol} desc limit 6000`;
  const params = new URLSearchParams({ id: String(db.settings.sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet, tq });
  const out = await fetchUpstream(upstreamUrl(params));
  if (out.status < 200 || out.status >= 300) throw new Error(`sheet ${out.status}`);
  const table = parseGvizServer(out.body);
  const ist = istNow();
  const prev = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
  const prevYm = `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}`;
  const totals = new Map();
  for (const row of table.rows || []) {
    const name = serverCell(row, 0).trim();
    const dk = serverDate(serverCell(row, 1));
    if (!name || !dk.startsWith(prevYm)) continue;
    totals.set(name, (totals.get(name) || 0) + serverNumber(serverCell(row, 2)));
  }
  const list = [...totals.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  return { month: prevYm, list: list.slice(0, Math.max(1, Math.min(10, Number(topN) || 3))) };
}
function championHtml(monthLabel, champs) {
  const accent = (db.settings.theme && db.settings.theme.accent) || '#2563eb';
  const medals = ['🥇', '🥈', '🥉'];
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#0f172a;color:#fff;padding:26px;border-radius:18px;max-width:600px">
    <p style="margin:0 0 4px;color:#94a3b8;letter-spacing:.14em;font-size:12px">🏅 MONTHLY CHAMPIONS · ${escHtml(monthLabel)}</p>
    <h2 style="margin:0 0 18px;font-size:26px">${escHtml(db.settings.brand || 'Dashboard')} — Hall of Fame</h2>
    ${champs.map((c, i) => `<div style="background:#1e293b;border:1px solid ${i === 0 ? accent : '#334155'};border-radius:14px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:14px">
      <div style="font-size:34px">${medals[i] || `#${i + 1}`}</div>
      <div style="flex:1"><div style="font-size:18px;font-weight:700">${escHtml(c.name)}</div>
      <div style="color:#94a3b8;font-size:13px">Last month issuance</div></div>
      <div style="font-size:30px;font-weight:800;color:#fde047">${c.total}</div>
    </div>`).join('')}
    <p style="color:#94a3b8;font-size:12px;margin-top:14px">Certified by ${escHtml(db.settings.brand || 'Dashboard')} · data live sheet se</p></div>`;
}
async function maybeChampionEmail(force = false) {
  try {
    const F = feats();
    if (!force && F.championEmail !== true) return null;
    const cfg = db.settings.email || {};
    if (!mailConfigured(cfg) || !cfg.to) { if (force) throw new Error('Email provider/To set nahi — Features → Email configure karo'); return null; }
    if (!force) {
      const ist = istNow();
      if (ist.getUTCHours() < (Number(F.championHour) || 10)) return null;
      const prev = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
      const prevYm = `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}`;
      if (db.notify.watch.championMonth === prevYm) return null;
    }
    const { month, list } = await championsList(F.championTop);
    if (!list.length) { if (force) throw new Error('Pichhle mahine ka data nahi mila'); return null; }
    const monthLabel = U_labelYmSafe(month);
    const html = championHtml(monthLabel, list);
    const text = `🏆 ${monthLabel} champions — ` + list.map((c, i) => `${i + 1}. ${c.name} (${c.total})`).join(' · ');
    await sendMail(cfg, `🥇 ${monthLabel} Champions · ${db.settings.brand || 'Dashboard'}`, text, { html });
    db.notify.watch.championMonth = month;
    persist('notify').catch(() => {});
    recordNotification({
      type: 'monthly',
      title: `🥇 ${monthLabel} champions · ${list.map((c) => c.name).join(', ')}`,
      body: list.map((c, i) => `${i + 1}. ${c.name} — ${c.total} tags`).join(' · '),
      target: 'broadcast',
      routeKey: 'champion',
      meta: { link: '#/performance', month, champions: list }
    });
    logAudit(null, 'champion_email_sent', { actor: force ? 'admin:test' : 'scheduler', note: list.map((c) => `${c.name}:${c.total}`).join(', ') });
    return { month, list };
  } catch (err) { console.warn('champion email:', err.message); if (force) throw err; return null; }
}
function U_labelYmSafe(ym) {
  const m = Number(String(ym).slice(5, 7)) - 1;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[m] || ''} ${String(ym).slice(0, 4)}`.trim();
}
// ---- ⏰ follow-up tracker (N din silent agents) ------------------------------------------------
async function followupList() {
  const s = db.settings.eir || {};
  const sheet = db.settings.eirSheet || 'EIR';
  const agentCol = s.agentName || 'L', dateCol = s.date || 'AA', tagCol = s.tagId || 'A';
  const tq = `select ${agentCol}, ${dateCol}, count(${tagCol}) where ${tagCol} is not null group by ${agentCol}, ${dateCol} order by ${dateCol} desc limit 6000`;
  const params = new URLSearchParams({ id: String(db.settings.sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet, tq });
  const out = await fetchUpstream(upstreamUrl(params));
  if (out.status < 200 || out.status >= 300) throw new Error(`sheet ${out.status}`);
  const table = parseGvizServer(out.body);
  const latest = new Map();
  for (const row of table.rows || []) {
    const name = serverCell(row, 0).trim();
    const dk = serverDate(serverCell(row, 1));
    if (!name || !dk) continue;
    if (!latest.has(name) || dk > latest.get(name)) latest.set(name, dk);
  }
  const days = Math.max(1, Number(feats().followupDays) || 3);
  const today = new Date(`${dateKeyNow()}T00:00:00Z`);
  const cut = new Date(today.getTime() - days * 86400e3);
  const monthAgo = new Date(today.getTime() - 30 * 86400e3);
  const cutKey = cut.toISOString().slice(0, 10);
  const activeKey = monthAgo.toISOString().slice(0, 10);
  const silent = [];
  for (const [name, last] of latest) {
    if (last < cutKey && last >= activeKey) silent.push({ name, last, days: Math.round((today - new Date(`${last}T00:00:00Z`)) / 86400e3) });
  }
  silent.sort((a, b) => b.days - a.days);
  return { days, list: silent.slice(0, 40) };
}
async function maybeFollowup(force = false) {
  try {
    const F = feats();
    if (!force && F.followupTracker === false) return null;
    if (!force) {
      const ist = istNow();
      if (ist.getUTCHours() < (Number(F.followupHour) || 10)) return null;
      const dateKey = dateKeyNow();
      if (db.notify.watch.followupDate === dateKey) return null;
    }
    const { days, list } = await followupList();
    db.notify.watch.followupDate = dateKeyNow();
    persist('notify').catch(() => {});
    if (!list.length) return null;
    const top = list.slice(0, 15);
    const item = recordNotification({
      type: 'info',
      title: `⏰ Follow-up · ${list.length} agent ${days}+ din silent`,
      body: top.map((x) => `${x.name} (${x.days} din)`).join(', ') + (list.length > top.length ? ` …+${list.length - top.length}` : '') + `. In tak pahuncho — pichhla issuance ${days}+ din pehle.`,
      target: 'broadcast',
      routeKey: 'followup',
      meta: { link: '#/performance?view=alerts', days, count: list.length }
    });
    logAudit(null, 'followup_alert', { actor: force ? 'admin:test' : 'scheduler', note: `${list.length} agents ≥${days} din silent` });
    return item;
  } catch (err) { console.warn('followup:', err.message); if (force) throw err; return null; }
}
/** Notes timeline ke due/open items ka daily reminder; old inactivity follow-up remains separate. */
async function maybeWorkspaceFollowups(force = false) {
  try {
    const F = feats();
    if (!force && F.followupTracker === false) return null;
    const ist = istNow();
    if (!force && ist.getUTCHours() < (Number(F.followupHour) || 10)) return null;
    const dateKey = dateKeyNow();
    const w = workspaceStore();
    const due = w.notes.filter((n) => n && n.status !== 'done' && n.dueAt && Date.parse(n.dueAt) <= Date.now())
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
    if (!force && db.notify.watch.workspaceFollowupDate === dateKey) return null;
    db.notify.watch.workspaceFollowupDate = dateKey;
    persist('notify').catch(() => {});
    if (!due.length) return null;
    const top = due.slice(0, 10);
    const item = recordNotification({
      type: 'info',
      title: `📝 Due follow-ups · ${due.length} item`,
      body: top.map((n) => `${n.entityName}${n.assignee ? ` → ${n.assignee}` : ''}`).join(', ') + (due.length > top.length ? ` …+${due.length - top.length}` : ''),
      target: 'broadcast',
      routeKey: 'followup',
      meta: { link: '#/followups?status=open', count: due.length, noteIds: due.slice(0, 30).map((n) => n.id) }
    });
    logAudit(null, 'workspace_followup_alert', { actor: force ? 'admin:test' : 'scheduler', note: `${due.length} due timeline items` });
    return item;
  } catch (err) { console.warn('workspace followups:', err.message); if (force) throw err; return null; }
}
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
          recordNotification({ type: 'report', title: `${label} report update`, body: `${next.date}: ${deltaText(delta)} — Google Sheet me naya data aaya.`, target: 'admin', routeKey: 'reportUpdate', meta: { source, snapshot: next, previous, delta } });
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

/**
 * 🔐 OTP (2FA) — sirf tab jab: feature ON + naye IP (known IPs se bahar) + user ka email +
 * SMTP configured. Code email par jaata hai; SMTP/email na ho to null → purana login raasta.
 */
async function maybeRequireOtp(u, loginId, ip) {
  try {
    if (feats().otp2fa === false) return null;
    if (!u || !u.email) return null;
    const cfg = db.settings.email || {};
    if (!mailConfigured(cfg)) return null;
    const knownIps = new Set((Array.isArray(u.loginHistory) ? u.loginHistory : []).map((l) => l && l.ip).filter(Boolean));
    if (!ip || knownIps.size === 0 || knownIps.has(ip)) return null; // pehla login ya known IP → seedha andar
    const code = String(crypto.randomInt(100000, 1000000));
    const ticket = crypto.randomBytes(16).toString('hex');
    otps.set(ticket, { username: u.username, code, exp: Date.now() + 10 * 60e3, tries: 0, ip, loginId });
    if (otps.size > 50) { for (const [k, v] of otps) if (v.exp < Date.now()) otps.delete(k); }
    await sendMail({ ...cfg, to: u.email }, `🔐 Login OTP ${code} · ${db.settings.brand || 'Dashboard'}`,
      `Aapka login code: ${code}\n\nYe code 10 min ke liye hai. login ID "${loginId}" · IP ${ip}.\nAgar ye aap nahi the to turant password badal do.`);
    logAudit(u, 'otp_sent', { target: loginId, ip, note: 'naye IP par OTP email bheja' });
    return { ticket, hint: `Code ${u.email} par bheja gaya (10 min valid)` };
  } catch (err) {
    console.warn('otp send (login hi aage jayega):', err.message);
    return null; // SMTP fail → login block mat karo (purana naye-IP alert raasta)
  }
}
/** Password check ke baad wala hissa — login aur OTP verify dono isi se complete hote hain. */
async function finalizeLogin(req, res, u, loginId, ip) {
  attempts.delete(ip);
  u.lastLoginAt = new Date().toISOString();
  // 🕘 Login history (admin ko Users tab me dikhta hai): kab, kis ID se, kis IP se — last 20.
  if (!Array.isArray(u.loginHistory)) u.loginHistory = [];
  // 🔐 Naye IP se login — pehle known IPs se bahar ho to admin ko alert (Features tab se band kar sakte ho).
  const knownIps = new Set(u.loginHistory.map((l) => l && l.ip).filter(Boolean));
  if (ip && knownIps.size > 0 && !knownIps.has(ip) && feats().alerts.newLoginIp !== false) {
    recordNotification({
      type: 'alert',
      title: `🔐 Naye IP se login — ${u.name || u.username}`,
      body: `${u.username} ne "${loginId}" se ${ip} par login kiya — ye IP is account ke history me pehle nahi mila (${u.loginHistory.length} purane logins). Agar ye aap nahi the to password badal do.`,
      target: 'admin',
      meta: { username: u.username, loginId, ip, link: '#/settings?tab=users' }
    });
  }
  u.loginHistory.push({ at: u.lastLoginAt, id: String(loginId).slice(0, 60), ip: ip || '' });
  if (u.loginHistory.length > 20) u.loginHistory = u.loginHistory.slice(-20);
  logAudit(u, 'login', { target: loginId, ip, note: knownIps.size && !knownIps.has(ip) ? 'naya IP (OTP ok)' : '' });
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
  return sendJson(res, 200, { ok: true, user: publicUser(u), settings: settingsFor(u), permissions: permissionsFor(db.settings), tabs: db.settings.tabs }, { 'Set-Cookie': cookieHeader(req, token, SESSION_DAYS * 86400) });
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  const user = sessionUser(req);

  if (p === '/api/health' && method === 'GET') {
    // pendingSignups sirf admin ko (sidebar badge ke liye) — public health me leak nahi.
    return sendJson(res, 200, { ok: true, service: 'first-forward-dashboard', version: '3.20.0', storage: storageStatus(), push: pushHealth(), users: db.users.length, cached: cache.size, cacheSeconds: cacheMs() / 1000, dataDir: STORAGE_BACKEND === 'files' ? DATA_DIR : null, ...(user && user.role === 'admin' ? { pendingSignups: db.users.filter((u) => !u.approved).length } : {}) });
  }
  if (p === '/api/public-config' && method === 'GET') return sendJson(res, 200, publicSettings());
  // App version (sw.js CACHE_NAME) — update-toast ke liye; logged-in se pehle bhi chahiye.
  if (p === '/api/version' && method === 'GET') return sendJson(res, 200, { version: SW_VERSION || 'dev' });

  // ---- auth ----
  if (p === '/api/auth/me' && method === 'GET') {
    return sendJson(res, 200, { user: publicUser(user), settings: user ? settingsFor(user) : publicSettings(), permissions: permissionsFor(db.settings), tabs: db.settings.tabs, ...(user && user.role === 'admin' ? { storage: storageStatus(), pendingSignups: db.users.filter((u) => !u.approved).length } : {}) });
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
    logAudit(u, first ? 'first_admin_setup' : 'signup', { target: username, ip: clientIp(req), note: u.email || u.mobile });
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
    if (!u || !verifyPassword(body.password || '', u.password)) { noteFail(ip); logAudit(null, 'login_failed', { actor: loginId, ip, note: 'galat password/ID' }); throw new HttpError(401, 'Invalid login — check username / email / mobile and password.'); }
    if (!u.approved) throw new HttpError(403, 'Account pending admin approval.');
    // 🔐 OTP (2FA): naye IP par email code possible ho to login yahin rok do.
    const otp = await maybeRequireOtp(u, loginId, ip);
    if (otp) return sendJson(res, 428, { error: 'OTP bheja gaya — email check karo', otpRequired: true, ticket: otp.ticket, hint: otp.hint });
    return finalizeLogin(req, res, u, loginId, ip);
  }
  // 📱 OTP verify (abhi login nahi hua) — code sahi to wahi finalizeLogin (session + history + alerts).
  if (p === '/api/auth/otp' && method === 'POST') {
    const body = await readBody(req);
    const ticket = String(body.ticket || '');
    const rec = otps.get(ticket);
    if (!rec || rec.exp < Date.now()) { if (rec) otps.delete(ticket); throw new HttpError(400, 'OTP expire ho gaya — dobara login karo.'); }
    rec.tries = (rec.tries || 0) + 1;
    if (rec.tries > 5) { otps.delete(ticket); throw new HttpError(429, 'Bohot galat tries — dobara login karo.'); }
    if (String(body.code || '').trim() !== rec.code) { logAudit(null, 'otp_fail', { actor: rec.username, target: rec.loginId, ip: rec.ip }); throw new HttpError(401, 'Galat OTP — dobara try karo.'); }
    otps.delete(ticket);
    const u = findUser(rec.username);
    if (!u || !u.approved) throw new HttpError(401, 'Account unavailable.');
    return finalizeLogin(req, res, u, rec.loginId, rec.ip);
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
  if (p === '/api/stock-history' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    // Pehli baar koi maange to abhi ka snapshot bana lo (Stock page ka chart khali na dikhe).
    if (!stockCheckAt) { try { await refreshStockState(true); } catch { /* optional */ } }
    const watch = (db.notify && db.notify.watch) || {};
    const hist = watch.stockHistory && typeof watch.stockHistory === 'object' ? watch.stockHistory : {};
    const stockShape = (value) => value ? { total: Number(value.total) || 0, vc4: Number(value.vc4) || 0, comm: Number(value.comm) || 0, classes: value.classes && typeof value.classes === 'object' ? value.classes : {} } : null;
    const points = Object.keys(hist).sort().slice(-180).map((date) => {
      const raw = hist[date] || {};
      // Old records stored FF at the top level only; preserve those as valid FF history.
      const ff = stockShape(raw.ff || (Object.hasOwn(raw, 'total') ? raw : null));
      const gv = stockShape(raw.gv);
      const combined = stockShape(raw.combined) || (ff || gv ? { total: Number(ff && ff.total || 0) + Number(gv && gv.total || 0), vc4: Number(ff && ff.vc4 || 0) + Number(gv && gv.vc4 || 0), comm: Number(ff && ff.comm || 0) + Number(gv && gv.comm || 0), classes: {} } : null);
      return { date, capturedAt: raw.capturedAt || null, total: Number(ff && ff.total || 0), vc4: Number(ff && ff.vc4 || 0), comm: Number(ff && ff.comm || 0), ff, gv, combined };
    });
    // MTD (FF + GV) — stock balance reconciliation ke liye.
    const daily = watch.daily && typeof watch.daily === 'object' ? watch.daily : {};
    const monthKey = dateKeyNow().slice(0, 7);
    let ffMtd = 0, gvMtd = 0, mtdDays = 0;
    for (const [d, v] of Object.entries(daily)) if (d.startsWith(monthKey) && v) { const f = Number(v.ff) || 0, g = Number(v.gv) || 0; if (f || g) mtdDays++; ffMtd += f; gvMtd += g; }
    const issuance = Object.keys(daily).sort().slice(-180).map((date) => ({ date, ff: Number(daily[date] && daily[date].ff) || 0, gv: Number(daily[date] && daily[date].gv) || 0 }));
    return sendJson(res, 200, { points, issuance, cover: watch.cover || null, thresholds: db.settings.thresholds || {}, mtd: { ff: ffMtd, gv: gvMtd, days: mtdDays } });
  }
  if (p === '/api/notifications/email/test' && method === 'POST') {
    requireAdmin(user);
    const cfg = db.settings.email || {};
    resetMailMemo(); // test hamesha taaza try kare (pehle ka "SMTP blocked" yaad na rakhe)
    try {
      const out = await sendMail(cfg, `✅ Test email · ${db.settings.brand || 'Dashboard'}`, `Ye test email hai — email configuration sahi chal rahi hai (transport: ${resolveProviders(cfg)[0] || '—'}).\n\nDigest isi tarah subah (${feats().digestHour || 8} IST) push ke saath email par bhi aayega (features.emailDigest ON ho to).\n${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
      logAudit(user, 'email_test', { ip: clientIp(req), note: `${out.provider}${cfg.host && out.provider === 'smtp' ? ` · ${cfg.host}` : ''}` });
      return sendJson(res, 200, { ok: true, provider: out.provider, tried: out.tried });
    } catch (err) {
      const raw = String(err && err.message || err);
      throw new HttpError(502, `Email test fail: ${raw}${mailHint(raw)}`);
    }
  }
  // 🩺 Email diagnose — kya configured hai, SMTP port khula hai ya hosting ne block kiya, HTTPS relay ready hai ya nahi.
  if ((p === '/api/notifications/email/diagnose' || p === '/api/notifications/email/status') && (method === 'POST' || method === 'GET')) {
    requireAdmin(user);
    const cfg = db.settings.email || {};
    if (p.endsWith('/status')) {
      const providers = availableProviders(cfg);
      return sendJson(res, 200, { providers, order: resolveProviders(cfg), preference: cfg.provider || 'auto', envRelay: providers.appsscript });
    }
    return sendJson(res, 200, await diagnoseMail(cfg));
  }
  // 📬 Weekly auto-digest email — force (Settings button / test); schedule maybeWeeklyEmail chalta hai.
  if (p === '/api/notifications/weekly-email' && method === 'POST') {
    requireAdmin(user);
    try {
      const out = await sendWeeklyEmail(true);
      return sendJson(res, 200, { ok: !!out, detail: out || 'kuch data nahi mila' });
    } catch (err) { throw new HttpError(502, `Weekly email fail: ${err.message}`); }
  }
  // 📧 Roz ka scheduled report email (HTML + CSV) — force.
  if (p === '/api/notifications/report-email' && method === 'POST') {
    requireAdmin(user);
    try {
      const out = await sendReportEmail(true);
      return sendJson(res, 200, { ok: !!out, detail: out || 'no data' });
    } catch (err) { throw new HttpError(502, `Report email fail: ${err.message}`); }
  }
  // 🚚 Send the current Dispatch Planner selection immediately (admin test / preview).
  if (p === '/api/dispatch-email/test' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    try {
      const out = await sendDispatchPlanEmail(true, body.schedule || body);
      return sendJson(res, 200, { ok: true, detail: out });
    } catch (err) { throw new HttpError(502, `Dispatch email fail: ${err.message}`); }
  }
  // 📢 Announcement — sab users ke liye bell broadcast (admin hi bhej sakta hai).
  if (p === '/api/announcements' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    const text = String(body.text || '').trim().slice(0, 500);
    if (!text) throw new HttpError(400, 'Announcement khali hai.');
    const item = recordNotification({
      type: 'info',
      title: `📢 Announcement · ${user.name || user.username}`,
      body: text,
      target: 'broadcast',
      meta: { announce: true, by: user.username, link: body.link ? String(body.link).slice(0, 60) : '' }
    });
    logAudit(user, 'announcement', { ip: clientIp(req), note: text.slice(0, 80) });
    return sendJson(res, 200, { ok: true, item });
  }
  // 📜 Audit log — sirf admin.
  if (p === '/api/audit' && method === 'GET') {
    requireAdmin(user);
    const entries = (db.notify && Array.isArray(db.notify.audit) ? db.notify.audit : []).slice(-250).reverse();
    return sendJson(res, 200, { entries });
  }
  // 🗺 Team location (admin) — jinhone Settings/phone se location share ki hai
  if (p === '/api/team-location' && method === 'GET') {
    requireAdmin(user);
    const people = db.users.filter((u) => u.lastLocation && Number.isFinite(Number(u.lastLocation.latitude)) && Number.isFinite(Number(u.lastLocation.longitude))).map((u) => ({
      username: u.username, name: u.name || u.username, role: u.role, approved: !!u.approved,
      lat: u.lastLocation.latitude, lng: u.lastLocation.longitude, accuracy: u.lastLocation.accuracy || null,
      at: u.lastLocation.at || null, lastLoginAt: u.lastLoginAt || null
    })).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return sendJson(res, 200, { people, office: { lat: Number(feats().officeLat) || 0, lng: Number(feats().officeLng) || 0 } });
  }
  // 🔍 Agent + TL anomaly — force (raat 9 ke alawa bhi test/admin "abhi chalao")
  if (p === '/api/notifications/anomaly' && method === 'POST') {
    requireAdmin(user);
    const out = await maybeAgentAnomaly(true);
    return sendJson(res, 200, { ok: !!(out && (out.agent || out.tl)), agent: out && out.agent ? out.agent.title : null, tl: out && out.tl ? out.tl.title : null });
  }
  // 🔗 Personal read-only links (agent + TL) — CRUD sirf admin
  if (p === '/api/personal-links' && method === 'GET') {
    requireAdmin(user);
    const links = (Array.isArray(db.settings.personalLinks) ? db.settings.personalLinks : []).map((l) => ({ ...l, source: l.source === 'gv' ? 'gv' : 'ff' }));
    return sendJson(res, 200, { links });
  }
  if (p === '/api/personal-links' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    const kind = body.kind === 'tl' ? 'tl' : 'agent';
    const source = body.source === 'gv' ? 'gv' : 'ff';
    const name = String(body.name || '').trim().replace(/[\u0000-\u001f<>]/g, '').slice(0, 80);
    if (!name) throw new HttpError(400, 'Agent/TL ka exact naam likho.');
    if (feats().personalLinks === false) throw new HttpError(403, 'Personal links feature band hai — Features tab se ON karo.');
    const duplicate = (db.settings.personalLinks || []).find((l) => (l.source === 'gv' ? 'gv' : 'ff') === source && l.kind === kind && String(l.name).toLowerCase() === name.toLowerCase() && l.enabled !== false);
    if (duplicate) {
      void personalDailyRows({ ...duplicate, source }).catch(() => {});
      if (kind === 'tl') void personalTeamAgents({ ...duplicate, source }).catch(() => {});
      return sendJson(res, 200, { ok: true, link: { ...duplicate, source }, reused: true });
    }
    const link = { id: `pl_${crypto.randomBytes(6).toString('hex')}`, source, kind, name, token: crypto.randomBytes(18).toString('hex'), enabled: true, by: user.username, createdAt: new Date().toISOString() };
    if (!Array.isArray(db.settings.personalLinks)) db.settings.personalLinks = [];
    db.settings.personalLinks.push(link);
    await persist('settings');
    logAudit(user, 'link_create', { target: `${source}:${kind}:${name}`, ip: clientIp(req) });
    // User WhatsApp/open kare usse pehle Google query warm kar do; response ko is par block nahi karte.
    void personalDailyRows(link).catch(() => {});
    if (kind === 'tl') void personalTeamAgents(link).catch(() => {});
    return sendJson(res, 200, { ok: true, link });
  }
  const plDel = p.match(/^\/api\/personal-links\/([^/]+)$/);
  if (plDel && method === 'DELETE') {
    requireAdmin(user);
    const id = decodeURIComponent(plDel[1]);
    const before = (db.settings.personalLinks || []).length;
    db.settings.personalLinks = (db.settings.personalLinks || []).filter((l) => l.id !== id);
    if (db.settings.personalLinks.length === before) throw new HttpError(404, 'Link nahi mila.');
    await persist('settings');
    logAudit(user, 'link_revoke', { target: id, ip: clientIp(req) });
    return sendJson(res, 200, { ok: true });
  }
  const plToggle = p.match(/^\/api\/personal-links\/([^/]+)\/enable$/);
  if (plToggle && method === 'POST') {
    requireAdmin(user);
    const id = decodeURIComponent(plToggle[1]);
    const link = (db.settings.personalLinks || []).find((l) => l.id === id);
    if (!link) throw new HttpError(404, 'Link nahi mila.');
    const body = await readBody(req);
    link.enabled = body.enabled !== false;
    await persist('settings');
    logAudit(user, 'link_toggle', { target: `${link.kind}:${link.name}`, note: link.enabled ? 'ON' : 'OFF' });
    return sendJson(res, 200, { ok: true, link });
  }
  // 🗓 Schedule fire-now (admin test)
  const schFire = p.match(/^\/api\/schedules\/([^/]+)\/fire$/);
  if (schFire && method === 'POST') {
    requireAdmin(user);
    if (feats().customAlerts === false) throw new HttpError(403, '🗓 Custom alerts band hain — Features tab se ON karo.');
    const id = decodeURIComponent(schFire[1]);
    const sched = (Array.isArray(db.settings.schedules) ? db.settings.schedules : []).find((s) => s && s.id === id);
    if (!sched) throw new HttpError(404, 'Schedule nahi mila.');
    const item = await schedulesTick(sched);
    return sendJson(res, 200, { ok: !!item, item: item || null });
  }
  // 🥇 Champion certificate email — force
  if (p === '/api/notifications/champion-email' && method === 'POST') {
    requireAdmin(user);
    if (feats().championEmail !== true) throw new HttpError(403, '🥇 Champion email feature ON nahi — Features tab se ON karo.');
    try {
      const out = await maybeChampionEmail(true);
      return sendJson(res, 200, { ok: !!out, month: out && out.month, top: out ? out.list.map((c) => `${c.name}:${c.total}`) : [] });
    } catch (err) { throw new HttpError(502, `Champion email fail: ${err.message}`); }
  }
  // ⏰ Follow-up list (admin, on-demand) — Alerts card isi ko use karti hai; ?fire=1 to notification bhi
  if (p === '/api/followup' && method === 'GET') {
    requireAdmin(user);
    const out = await followupList();
    if (url.searchParams.get('fire') === '1') {
      if (feats().followupTracker === false) throw new HttpError(403, '⏰ Follow-up tracker band hai — Features tab se ON karo.');
      const item = await maybeFollowup(true); return sendJson(res, 200, { ...out, fired: !!item });
    }
    return sendJson(res, 200, out);
  }
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
    logAudit(u, 'forgot_request', { target: u.username, ip: clientIp(req) });
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
    logAudit(u, 'password_reset_completed', { target: u.username, ip: clientIp(req), note: 'code se reset' });
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
    logAudit(user, 'password_changed', { target: user.username, ip: clientIp(req) });
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

  // ---- collaborative workspace: saved views + agent/TL notes -------------------------------
  if (p === '/api/workspace' && method === 'GET') {
    const w = workspaceStore();
    const canViews = user.role === 'admin' || (user.permissions || []).includes('savedViews');
    const canNotes = user.role === 'admin' || (user.permissions || []).includes('followups');
    return sendJson(res, 200, {
      views: canViews ? w.views.filter((v) => visibleWorkspaceView(v, user)).map((v) => ({ ...v, ownerUser: publicWorkspaceUser(v.owner) })) : [],
      notes: canNotes ? w.notes.map((n) => ({ ...n, createdByUser: publicWorkspaceUser(n.createdBy), updatedByUser: publicWorkspaceUser(n.updatedBy || n.createdBy) })) : []
    });
  }
  if (p === '/api/workspace/views' && method === 'POST') {
    if (user.role !== 'admin' && !(user.permissions || []).includes('savedViews')) throw new HttpError(403, 'Saved views access disabled.');
    const body = await readBody(req);
    const title = shortText(body.title, 100);
    const route = shortText(body.route, 700);
    if (!title) throw new HttpError(400, 'View name required.');
    if (!/^#\/[A-Za-z0-9_%?=&+.,:\/-]+$/.test(route)) throw new HttpError(400, 'Dashboard filter link invalid hai.');
    const w = workspaceStore();
    const now = new Date().toISOString();
    const row = { id: workspaceId('view'), title, description: shortText(body.description, 240), route, shared: body.shared === true, owner: user.username, createdAt: now, updatedAt: now };
    w.views.push(row);
    if (w.views.length > 150) w.views.splice(0, w.views.length - 150);
    await persist('notify');
    logAudit(user, 'saved_view_created', { target: row.id, ip: clientIp(req), note: row.title });
    return sendJson(res, 201, { ok: true, view: { ...row, ownerUser: publicWorkspaceUser(row.owner) } });
  }
  const viewPath = p.match(/^\/api\/workspace\/views\/([^/]+)$/);
  if (viewPath && method === 'DELETE') {
    if (user.role !== 'admin' && !(user.permissions || []).includes('savedViews')) throw new HttpError(403, 'Saved views access disabled.');
    const w = workspaceStore();
    const i = w.views.findIndex((v) => v.id === viewPath[1]);
    if (i < 0) throw new HttpError(404, 'Saved view nahi mila.');
    if (w.views[i].owner !== user.username && user.role !== 'admin') throw new HttpError(403, 'Sirf owner is view ko delete kar sakta hai.');
    const [removed] = w.views.splice(i, 1);
    await persist('notify');
    logAudit(user, 'saved_view_deleted', { target: removed.id, ip: clientIp(req), note: removed.title });
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/workspace/notes' && method === 'POST') {
    if (user.role !== 'admin' && !(user.permissions || []).includes('followups')) throw new HttpError(403, 'Notes access disabled.');
    const body = await readBody(req);
    const text = shortText(body.text, 4000);
    const entityName = shortText(body.entityName, 120);
    if (!text || !entityName) throw new HttpError(400, 'Agent/TL name aur note required hain.');
    const allowedStatus = new Set(['open', 'waiting', 'done']);
    const status = allowedStatus.has(body.status) ? body.status : 'open';
    const due = body.dueAt && Number.isFinite(Date.parse(body.dueAt)) ? new Date(body.dueAt).toISOString() : null;
    const now = new Date().toISOString();
    const row = {
      id: workspaceId('note'), entityType: ['agent', 'tl', 'general'].includes(body.entityType) ? body.entityType : 'agent',
      entityKey: shortText(body.entityKey || entityName, 160), entityName, channel: ['ff', 'gv', 'both'].includes(body.channel) ? body.channel : 'both',
      text, status, priority: ['low', 'normal', 'high'].includes(body.priority) ? body.priority : 'normal', dueAt: due,
      assignee: shortText(body.assignee, 80), createdBy: user.username, updatedBy: user.username, createdAt: now, updatedAt: now,
      timeline: [{ at: now, by: user.username, action: 'created', detail: text.slice(0, 240) }]
    };
    const w = workspaceStore();
    w.notes.push(row);
    if (w.notes.length > 1000) w.notes.splice(0, w.notes.length - 1000);
    await persist('notify');
    return sendJson(res, 201, { ok: true, note: { ...row, createdByUser: publicWorkspaceUser(row.createdBy), updatedByUser: publicWorkspaceUser(row.updatedBy) } });
  }
  const notePath = p.match(/^\/api\/workspace\/notes\/([^/]+)$/);
  if (notePath && method === 'PATCH') {
    if (user.role !== 'admin' && !(user.permissions || []).includes('followups')) throw new HttpError(403, 'Notes access disabled.');
    const w = workspaceStore();
    const row = w.notes.find((n) => n.id === notePath[1]);
    if (!row) throw new HttpError(404, 'Note nahi mila.');
    const body = await readBody(req);
    const before = row.status;
    if (body.status !== undefined) {
      if (!['open', 'waiting', 'done'].includes(body.status)) throw new HttpError(400, 'Status invalid hai.');
      row.status = body.status;
    }
    if (body.text !== undefined) { const text = shortText(body.text, 4000); if (!text) throw new HttpError(400, 'Note khali nahi ho sakta.'); row.text = text; }
    if (body.priority !== undefined && ['low', 'normal', 'high'].includes(body.priority)) row.priority = body.priority;
    if (body.assignee !== undefined) row.assignee = shortText(body.assignee, 80);
    if (body.dueAt !== undefined) row.dueAt = body.dueAt && Number.isFinite(Date.parse(body.dueAt)) ? new Date(body.dueAt).toISOString() : null;
    const now = new Date().toISOString();
    row.updatedAt = now; row.updatedBy = user.username;
    if (!Array.isArray(row.timeline)) row.timeline = [];
    row.timeline.push({ at: now, by: user.username, action: before !== row.status ? `status:${row.status}` : 'updated', detail: shortText(body.timelineNote || '', 240) });
    row.timeline = row.timeline.slice(-30);
    await persist('notify');
    return sendJson(res, 200, { ok: true, note: { ...row, createdByUser: publicWorkspaceUser(row.createdBy), updatedByUser: publicWorkspaceUser(row.updatedBy) } });
  }
  if (notePath && method === 'DELETE') {
    if (user.role !== 'admin' && !(user.permissions || []).includes('followups')) throw new HttpError(403, 'Notes access disabled.');
    const w = workspaceStore();
    const i = w.notes.findIndex((n) => n.id === notePath[1]);
    if (i < 0) throw new HttpError(404, 'Note nahi mila.');
    if (w.notes[i].createdBy !== user.username && user.role !== 'admin') throw new HttpError(403, 'Sirf creator is note ko delete kar sakta hai.');
    w.notes.splice(i, 1);
    await persist('notify');
    return sendJson(res, 200, { ok: true });
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
  if (p === '/api/settings' && method === 'GET') return sendJson(res, 200, { settings: settingsFor(user), defaults: DEFAULT_SETTINGS });
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
    if (patch.notificationRoutes !== undefined) {
      if (!patch.notificationRoutes || typeof patch.notificationRoutes !== 'object' || Array.isArray(patch.notificationRoutes)) throw new HttpError(400, 'notificationRoutes object hona chahiye');
      patch.notificationRoutes = Object.fromEntries(Object.entries(patch.notificationRoutes)
        .filter(([key, value]) => Object.hasOwn(DEFAULT_NOTIFICATION_ROUTES, key) && NOTIFICATION_AUDIENCES.has(value)));
    }
    if (patch.ffCommission !== undefined) {
      if (!patch.ffCommission || typeof patch.ffCommission !== 'object' || Array.isArray(patch.ffCommission)) throw new HttpError(400, 'ffCommission mapping object hona chahiye.');
      for (const key of ['rateCol', 'earnedCol', 'categoryCol', 'dateCol']) {
        if (patch.ffCommission[key] === undefined) continue;
        patch.ffCommission[key] = cleanColumnMapping(patch.ffCommission[key], key);
      }
    }
    if (patch.ffPayout !== undefined) {
      if (!patch.ffPayout || typeof patch.ffPayout !== 'object' || Array.isArray(patch.ffPayout)) throw new HttpError(400, 'ffPayout mapping object hona chahiye.');
      if (patch.ffPayout.sheet !== undefined) patch.ffPayout.sheet = String(patch.ffPayout.sheet || '').trim().slice(0, 80);
      if (patch.ffPayout.gid !== undefined) patch.ffPayout.gid = String(patch.ffPayout.gid || '').trim().slice(0, 30);
      for (const key of ['labelCol', 'classCol', 'rateCol', 'penaltyCol', 'noteCol']) {
        if (patch.ffPayout[key] === undefined) continue;
        patch.ffPayout[key] = cleanColumnMapping(patch.ffPayout[key], `ffPayout.${key}`);
      }
    }
    if (patch.commissionSlabs !== undefined) {
      if (!patch.commissionSlabs || typeof patch.commissionSlabs !== 'object' || Array.isArray(patch.commissionSlabs)) throw new HttpError(400, 'commissionSlabs object hona chahiye.');
      if (patch.commissionSlabs.enabled !== undefined) patch.commissionSlabs.enabled = patch.commissionSlabs.enabled === true || patch.commissionSlabs.enabled === 'true';
      if (patch.commissionSlabs.model !== undefined && !['agentTier', 'marginal'].includes(patch.commissionSlabs.model)) throw new HttpError(400, 'Commission slab model agentTier ya marginal hona chahiye.');
      if (patch.commissionSlabs.channels !== undefined) {
        const bands = [{ min: 1, max: 50 }, { min: 51, max: 100 }, { min: 101, max: 150 }, { min: 151, max: 250 }, { min: 251, max: null }];
        if (!patch.commissionSlabs.channels || typeof patch.commissionSlabs.channels !== 'object' || Array.isArray(patch.commissionSlabs.channels)) throw new HttpError(400, 'commissionSlabs.channels object hona chahiye.');
        for (const channel of ['ff', 'gv']) {
          const input = patch.commissionSlabs.channels[channel];
          if (input === undefined) continue;
          if (!Array.isArray(input) || input.length !== bands.length) throw new HttpError(400, `${channel} ke liye paanch commission slabs required hain.`);
          patch.commissionSlabs.channels[channel] = bands.map((band, i) => {
            const raw = input[i] && input[i].rate;
            const rate = raw === '' || raw === null || raw === undefined ? '' : Number(raw);
            if (rate !== '' && (!Number.isFinite(rate) || rate < 0 || rate > 1000000)) throw new HttpError(400, `${channel} slab ${i + 1}: ₹ rate 0 se 1000000 ke beech hona chahiye.`);
            return { ...band, rate: rate === '' ? '' : Math.round(rate * 10000) / 10000 };
          });
        }
      }
    }
    // 🚨 Commission alerts / 🚚 dispatch planner thresholds (cockpit.js) — numbers ko safe range me clamp karo
    if (patch.commissionAlerts !== undefined || patch.dispatch !== undefined) {
      const clampNum = (obj, key, min, max, label) => {
        if (obj[key] === undefined) return;
        const raw = obj[key] === '' ? null : Number(obj[key]);
        if (raw !== null && !Number.isFinite(raw)) throw new HttpError(400, `${label}: number chahiye.`);
        obj[key] = raw === null ? obj[key] : Math.max(min, Math.min(max, raw));
      };
      if (patch.commissionAlerts !== undefined) {
        if (!patch.commissionAlerts || typeof patch.commissionAlerts !== 'object' || Array.isArray(patch.commissionAlerts)) throw new HttpError(400, 'commissionAlerts object hona chahiye.');
        if (patch.commissionAlerts.enabled !== undefined) patch.commissionAlerts.enabled = patch.commissionAlerts.enabled === true || patch.commissionAlerts.enabled === 'true';
        clampNum(patch.commissionAlerts, 'outlierPct', 1, 200, 'commissionAlerts.outlierPct');
        clampNum(patch.commissionAlerts, 'gvGapPct', 1, 100, 'commissionAlerts.gvGapPct');
        clampNum(patch.commissionAlerts, 'mismatchPct', 0, 100, 'commissionAlerts.mismatchPct');
        clampNum(patch.commissionAlerts, 'mismatchMin', 0, 100000, 'commissionAlerts.mismatchMin');
        clampNum(patch.commissionAlerts, 'zeroEarnedMin', 0, 10000, 'commissionAlerts.zeroEarnedMin');
      }
      if (patch.dispatch !== undefined) {
        if (!patch.dispatch || typeof patch.dispatch !== 'object' || Array.isArray(patch.dispatch)) throw new HttpError(400, 'dispatch object hona chahiye.');
        clampNum(patch.dispatch, 'tagsPerBox', 1, 1000, 'dispatch.tagsPerBox');
        clampNum(patch.dispatch, 'horizon', 1, 90, 'dispatch.horizon');
        clampNum(patch.dispatch, 'minNeed', 0, 100000, 'dispatch.minNeed');
        clampNum(patch.dispatch, 'top', 1, 500, 'dispatch.top');
      }
    }
    if (patch.email !== undefined) {
      if (!patch.email || typeof patch.email !== 'object' || Array.isArray(patch.email)) throw new HttpError(400, 'email object hona chahiye.');
      if (patch.email.provider !== undefined) {
        patch.email.provider = String(patch.email.provider || 'auto').trim().toLowerCase();
        if (!MAIL_PROVIDERS.includes(patch.email.provider)) throw new HttpError(400, `email.provider inme se ek ho: ${MAIL_PROVIDERS.join(' / ')}`);
      }
      for (const key of ['resendKey', 'brevoKey']) if (patch.email[key] !== undefined) patch.email[key] = String(patch.email[key] || '').trim().slice(0, 200);
      if (patch.email.pass !== undefined) patch.email.pass = String(patch.email.pass || '').slice(0, 200);
      if (patch.email.host !== undefined) patch.email.host = String(patch.email.host || '').trim().slice(0, 200);
    }
    if (patch.dispatchEmail !== undefined) {
      try { patch.dispatchEmail = normalizeDispatchEmail(patch.dispatchEmail, db.settings.dispatchEmail || DEFAULT_DISPATCH_EMAIL); }
      catch (err) { throw new HttpError(400, err.message); }
    }
    if (patch.stockMovement !== undefined) {
      if (!patch.stockMovement || typeof patch.stockMovement !== 'object' || Array.isArray(patch.stockMovement)) throw new HttpError(400, 'stockMovement mapping object hona chahiye.');
      if (patch.stockMovement.sheet !== undefined) patch.stockMovement.sheet = String(patch.stockMovement.sheet || '').trim().slice(0, 80);
      for (const key of ['date', 'channel', 'type', 'quantity', 'cls', 'from', 'to', 'reference', 'note']) {
        if (patch.stockMovement[key] === undefined) continue;
        const col = String(patch.stockMovement[key] || '').trim().toUpperCase();
        if (col && !/^[A-Z]{1,3}$/.test(col)) throw new HttpError(400, `stockMovement.${key}: valid column letter chahiye.`);
        patch.stockMovement[key] = col;
      }
      cache.clear();
    }
    if (patch.gv !== undefined) {
      if (!patch.gv || typeof patch.gv !== 'object' || Array.isArray(patch.gv)) throw new HttpError(400, 'gv mapping object hona chahiye.');
      const allocation = patch.gv.assignment && patch.gv.assignment.allocatedAt;
      if (allocation !== undefined) {
        const col = String(allocation || '').trim().toUpperCase();
        if (col && !/^[A-Z]{1,3}$/.test(col)) throw new HttpError(400, 'gv.assignment.allocatedAt: valid column letter chahiye (e.g. N).');
        patch.gv.assignment.allocatedAt = col;
      }
      cache.clear();
    }
    const next = body.reset ? { ...DEFAULT_SETTINGS } : deepMerge(db.settings, patch);
    next.updatedAt = new Date().toISOString(); next.updatedBy = user.username;
    if (next.sheetId !== db.settings.sheetId || next.cacheSeconds !== db.settings.cacheSeconds) cache.clear();
    const changes = changeList(db.settings, next, { skip: ['updatedAt', 'updatedBy', 'lastBackupAt', 'personalLinks'] });
    db.settings = next;
    await persist('settings');
    if (patch.lastBackupAt) logAudit(user, 'backup_export', { ip: clientIp(req), note: 'settings JSON download' });
    else if (changes.length || body.reset) logAudit(user, 'settings_update', { ip: clientIp(req), note: (changes.slice(0, 5).map((c) => c.field).join(', ') + (changes.length > 5 ? '…' : '')) || 'reset' });
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
    logAudit(user, 'user_create', { target: username, ip: clientIp(req), note: `${u.role} · approved=${u.approved}` });
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
      logAudit(user, 'user_update', { target: target.username, ip: clientIp(req), note: userChanges.slice(0, 5).map((c) => c.field).join(', ') || 'permissions/approve' });
      if (userChanges.length || perms.added.length || perms.removed.length) recordNotification({ type: 'user', title: `👥 User updated · ${target.name || target.username}`, body: `${user.name || user.username} ne ${target.username} update kiya${perms.added.length || perms.removed.length ? ` · access +${perms.added.length} / −${perms.removed.length}` : ''}${userChanges.length ? ` · ${userChanges.map((c) => c.field).join(', ')}` : ''}.`, target: 'admin', meta: { username: user.username, subject: target.username, changes: userChanges, permissions: perms, link: '#/settings?tab=users' } });
      return sendJson(res, 200, { ok: true, user: publicUser(target) });
    }
    if (method === 'DELETE') {
      if (target.username === user.username) throw new HttpError(400, 'Apna hi account delete nahi kar sakte.');
      if (target.role === 'admin' && db.users.filter((u) => u.role === 'admin').length <= 1) throw new HttpError(400, 'Aakhri admin ko delete nahi kar sakte.');
      db.users = db.users.filter((u) => u !== target);
      for (const [k, s] of Object.entries(db.sessions)) if (s.username === target.username) delete db.sessions[k];
      await persist('users'); await persist('sessions');
      logAudit(user, 'user_delete', { target: target.username, ip: clientIp(req) });
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
// -------------------------------------------------------------------------------------------
// 🔗 Personal read-only pages — /p/<token> (bina login; agent/TL ka apna performance)
// -------------------------------------------------------------------------------------------
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
function gvizLiteral(name) { return `'${String(name).replace(/\\/g, '').replace(/'/g, "\\'")}'`; }
function personalWindow() {
  const today = dateKeyNow();
  const [y, m] = today.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const start = `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}-01`;
  return { start, today };
}
function personalConfig(link) {
  const source = link.source === 'gv' ? 'gv' : 'ff';
  if (source === 'gv') {
    const m = (db.settings.gv && db.settings.gv.master) || {};
    return {
      source, sheetId: db.settings.gvSheetId, sheet: m.tab || 'GV Master',
      dateCol: m.date || 'P', tagCol: m.tagId || 'I', clsCol: m.cch || m.vClass || 'G',
      nameCol: link.kind === 'tl' ? (m.tlName || 'D') : (m.agentName || 'B'),
      agentCol: m.agentName || 'B', tlCol: m.tlName || 'D', masterCol: ''
    };
  }
  const e = db.settings.eir || {};
  return {
    source, sheetId: db.settings.sheetId, sheet: db.settings.eirSheet || e.sheet || 'EIR',
    dateCol: e.date || 'AA', tagCol: e.tagId || 'A', clsCol: e.cls || 'D',
    nameCol: link.kind === 'tl' ? (e.tlName || 'BA') : (e.agentName || 'L'),
    agentCol: e.agentName || 'L', tlCol: e.tlName || 'BA', masterCol: e.masterId || 'AU'
  };
}
function isFfPersonalRow(master, tl) {
  const e = db.settings.eir || {};
  const gvId = String(e.gvMasterId || '5845036').trim().replace(/\.0+$/, '');
  const id = String(master || '').trim().replace(/\.0+$/, '');
  const gvTl = String(e.gvChannelTl || 'ApnaPayment Pvt. Ltd.').trim().toLowerCase();
  return !((gvId && id === gvId) || (gvTl && String(tl || '').trim().toLowerCase() === gvTl));
}
async function personalDailyRows(link) {
  const c = personalConfig(link);
  const { start, today } = personalWindow();
  const extra = c.source === 'ff' ? `, ${c.masterCol}, ${c.tlCol}` : '';
  const tq = `select ${c.dateCol}, ${c.clsCol}${extra}, count(${c.tagCol}) where ${c.tagCol} is not null and ${c.dateCol} >= date '${start}' and ${c.dateCol} <= date '${today}' and ${c.nameCol} = ${gvizLiteral(link.name)} group by ${c.dateCol}, ${c.clsCol}${extra} order by ${c.dateCol} desc limit 5000`;
  const params = new URLSearchParams({ id: String(c.sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet: c.sheet, tq });
  const out = await fetchUpstreamCached(upstreamUrl(params));
  if (out.status < 200 || out.status >= 300) throw new Error(`sheet ${out.status}`);
  const table = parseGvizServer(out.body);
  const rows = [];
  for (const row of table.rows || []) {
    const dk = serverDate(serverCell(row, 0));
    if (!dk) continue;
    const cells = (row && row.c) || [];
    if (c.source === 'ff' && cells.length >= 5 && !isFfPersonalRow(serverCell(row, 2), serverCell(row, 3))) continue;
    rows.push({ date: dk, cls: classBucket(serverCell(row, 1)), n: serverNumber(serverCell(row, Math.max(0, cells.length - 1))) });
  }
  return rows;
}
async function personalTeamAgents(link) {
  const c = personalConfig(link);
  const { start, today } = personalWindow();
  const extra = c.source === 'ff' ? `, ${c.masterCol}, ${c.tlCol}` : '';
  const tq = `select ${c.agentCol}, ${c.dateCol}${extra}, count(${c.tagCol}) where ${c.tagCol} is not null and ${c.dateCol} >= date '${start}' and ${c.dateCol} <= date '${today}' and ${c.nameCol} = ${gvizLiteral(link.name)} group by ${c.agentCol}, ${c.dateCol}${extra} order by ${c.dateCol} desc limit 5000`;
  const params = new URLSearchParams({ id: String(c.sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet: c.sheet, tq });
  const out = await fetchUpstreamCached(upstreamUrl(params));
  if (out.status < 200 || out.status >= 300) throw new Error(`sheet ${out.status}`);
  const table = parseGvizServer(out.body);
  const byAgent = new Map();
  for (const row of table.rows || []) {
    const name = serverCell(row, 0).trim();
    const dk = serverDate(serverCell(row, 1));
    if (!name || !dk) continue;
    const cells = (row && row.c) || [];
    if (c.source === 'ff' && cells.length >= 5 && !isFfPersonalRow(serverCell(row, 2), serverCell(row, 3))) continue;
    if (!byAgent.has(name)) byAgent.set(name, new Map());
    byAgent.get(name).set(dk, (byAgent.get(name).get(dk) || 0) + serverNumber(serverCell(row, Math.max(0, cells.length - 1))));
  }
  return byAgent;
}

function personalStats(rows) {
  const ym = dateKeyNow().slice(0, 7);
  const todayKey = dateKeyNow();
  const daily = new Map();
  const cls = {};
  for (const r of rows) {
    daily.set(r.date, (daily.get(r.date) || 0) + r.n);
    if (r.date.startsWith(ym)) cls[r.cls] = (cls[r.cls] || 0) + r.n;
  }
  let mtd = 0, mtdActiveDays = 0;
  for (const [d, n] of daily) if (d.startsWith(ym)) { mtd += n; if (n > 0) mtdActiveDays++; }
  const prev = new Date(`${todayKey}T00:00:00Z`); prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevYm = `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}`;
  const dayNow = Number(todayKey.slice(8, 10));
  let prevSame = 0;
  for (const [d, n] of daily) if (d.startsWith(prevYm) && Number(d.slice(8, 10)) <= dayNow) prevSame += n;
  const keyAt = (offset) => {
    const d = new Date(`${todayKey}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  };
  // Real calendar days (zeros included), not the last 14 *active* rows.
  const last14 = Array.from({ length: 14 }, (_, i) => { const date = keyAt(i - 13); return { date, n: daily.get(date) || 0 }; });
  let streak = 0;
  for (let i = 0; i < 366; i++) { if ((daily.get(keyAt(-i)) || 0) > 0) streak++; else break; }
  let best = { date: '', n: 0 };
  for (const [d, n] of daily) if (d.startsWith(ym) && n > best.n) best = { date: d, n };
  const clsTotal = Object.values(cls).reduce((a, b) => a + b, 0);
  return { mtd, mtdActiveDays, prevSame, last14, streak, best, cls, clsTotal, activeDays: last14.filter((x) => x.n > 0).length };
}

async function servePersonalPage(req, res, rawToken) {
  const token = String(rawToken || '').split(/[/?#]/)[0].trim();
  const fail = (code, msg) => sendHtml(res, code, personalShell({ title: 'Link unavailable', heading: '🔒 Link kaam nahi kar raha', body: `<p>${escHtml(msg)}</p>` }));
  if (feats().personalLinks === false) return fail(404, 'Ye feature admin ne band kar rakha hai.');
  const savedLink = (Array.isArray(db.settings.personalLinks) ? db.settings.personalLinks : []).find((l) => l.token === token);
  if (!savedLink) return fail(404, 'Ye link ya to khatam ho gaya ya galat hai. Admin se naya maango.');
  if (!savedLink.enabled) return fail(403, 'Admin ne ye link band kar diya hai.');
  const link = { ...savedLink, source: savedLink.source === 'gv' ? 'gv' : 'ff' };
  try {
    const rows = await personalDailyRows(link);
    if (!rows.length) return fail(404, `"${link.name}" ka data abhi sheet me nahi mila (ya naam alag hai).`);
    const st = personalStats(rows);
    let team = [];
    let goal = null, target = null;
    const ym = dateKeyNow().slice(0, 7);
    const normPerson = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (link.kind === 'tl') {
      goal = ((Array.isArray(db.settings.tlTargets) ? db.settings.tlTargets : []).find((t) => t && t.ym === ym && normPerson(t.tl) === normPerson(link.name)) || null);
      const byAgent = await personalTeamAgents(link);
      for (const [name, m] of byAgent) {
        let mtdA = 0;
        for (const [d, n] of m) if (d.startsWith(ym)) mtdA += n;
        if (mtdA > 0) team.push({ name, mtd: mtdA });
      }
      team.sort((a, b) => b.mtd - a.mtd);
      team = team.slice(0, 15);
    } else {
      target = ((Array.isArray(db.settings.targets) ? db.settings.targets : []).find((t) => t && t.ym === ym && (t.source || 'ff') === link.source && normPerson(t.agent) === normPerson(link.name)) || null);
    }
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const maxBar = Math.max(1, ...st.last14.map((x) => x.n));
    const bars = st.last14.map((x) => `<div class="pb-col" title="${escHtml(x.date)}: ${x.n}"><div class="pb-bar" style="height:${Math.max(4, Math.round((x.n / maxBar) * 100))}%"></div><span>${escHtml(x.date.slice(8, 10))}</span></div>`).join('');
    const clsRows = Object.entries(st.cls).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="pb-kv"><span>${escHtml(k)}</span><b>${v}</b> <i>${pct(v, st.clsTotal)}%</i></div>`).join('') || '<p class="dim">—</p>';
    const goalHtml = goal ? `<div class="pb-goal"><div class="pb-goal-top"><span>🎯 TL goal ${escHtml(ym)}</span><b>${st.mtd} / ${Number(goal.target) || 0} (${pct(st.mtd, Number(goal.target))}%)</b></div><div class="pb-track"><div class="pb-fill" style="width:${Math.min(100, pct(st.mtd, Number(goal.target)))}%"></div></div></div>` : '';
    const targetHtml = target ? `<div class="pb-kv"><span>🎯 Your target ${escHtml(ym)}</span><b>${st.mtd} / ${Number(target.target) || 0} (${pct(st.mtd, Number(target.target))}%)</b></div>` : '';
    const teamHtml = team.length ? `<section class="pb-card"><h3>👥 Team (is mahine)</h3>${team.map((t, i) => `<div class="pb-rank"><span class="pb-pos">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span><span class="pb-name">${escHtml(t.name)}</span><b>${t.mtd}</b></div>`).join('')}</section>` : '';
    const diff = st.mtd - st.prevSame;
    const html = personalShell({
      title: `${link.name} · Performance`,
      heading: `${link.kind === 'tl' ? '👥' : '🧑‍💼'} ${escHtml(link.name)}`,
      sub: `${link.source === 'gv' ? 'GV Partner' : 'First Forward'} · ${link.kind === 'tl' ? 'Team Leader' : 'Agent'} · personal view · read-only`,
      body: `
      ${goalHtml || targetHtml ? `<section class="pb-card pb-goalcard">${goalHtml}${targetHtml}</section>` : ''}
      <section class="pb-kpis">
        <div class="pb-kpi"><small>MTD issued</small><b>${st.mtd}</b><span>${escHtml(ym)}</span></div>
        <div class="pb-kpi"><small>Pichhle mahine same period</small><b>${st.prevSame}</b><span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}</span></div>
        <div class="pb-kpi"><small>Streak</small><b>${st.streak}</b><span>din se active 🔥</span></div>
        <div class="pb-kpi"><small>Best day</small><b>${st.best.n}</b><span>${escHtml(st.best.date)}</span></div>
      </section>
      <section class="pb-card"><h3>📅 Last ${st.last14.length} din</h3><div class="pb-bars">${bars || '<p class="dim">data nahi</p>'}</div></section>
      <section class="pb-grid2">
        <div class="pb-card"><h3>🏷️ Class mix (MTD)</h3>${clsRows}</div>
        <div class="pb-card"><h3>📈 Snapshot</h3>
          <div class="pb-kv"><span>Active days (last 14)</span><b>${st.activeDays}</b></div>
          <div class="pb-kv"><span>MTD avg / active day</span><b>${st.mtdActiveDays ? (st.mtd / st.mtdActiveDays).toFixed(1) : '—'}</b></div>
          <div class="pb-kv"><span>Total rows (14 din chart)</span><b>${st.last14.reduce((a, b) => a + b.n, 0)}</b></div>
        </div>
      </section>
      ${teamHtml}
      <p class="pb-foot">Read-only link · data live sheet se · ${escHtml(db.settings.brand || 'Dashboard')}</p>`
    });
    return sendHtml(res, 200, html, { 'Cache-Control': 'no-store' });
  } catch (err) {
    console.warn('personal page:', err.message);
    return fail(500, 'Data load nahi hua — thodi der baad try karo.');
  }
}
function personalShell({ title, heading, sub, body }) {
  const accent = (db.settings.theme && db.settings.theme.accent) || '#2563eb';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escHtml(title)}</title>
<style>
:root{--a:${escHtml(accent)}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f4f6fb;color:#0f172a;padding:18px;line-height:1.45}
.pb-wrap{max-width:640px;margin:0 auto}
.pb-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.pb-logo{width:44px;height:44px;border-radius:12px;background:var(--a);color:#fff;display:grid;place-items:center;font-weight:800;font-size:17px}
.pb-head h1{font-size:20px}.pb-head p{font-size:12.5px;color:#64748b}
.pb-card{background:#fff;border:1px solid #e5e9f5;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 10px rgba(15,23,42,.04)}
.pb-card h3{font-size:13.5px;color:#475569;margin-bottom:10px}
.pb-kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px}
.pb-kpi{background:#fff;border:1px solid #e5e9f5;border-radius:14px;padding:12px}
.pb-kpi small{color:#64748b;font-size:11.5px;display:block}.pb-kpi b{font-size:26px;display:block;margin:2px 0}.pb-kpi span{font-size:12px;color:#64748b}
.pb-kpi .up{color:#10b981}.pb-kpi .down{color:#ef4444}
.pb-bars{display:flex;align-items:flex-end;gap:5px;height:120px}
.pb-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%}
.pb-bar{width:100%;background:linear-gradient(180deg,var(--a),#93c5fd);border-radius:5px 5px 2px 2px;min-height:4px}
.pb-col span{font-size:9.5px;color:#94a3b8;margin-top:3px}
.pb-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pb-kv{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dashed #eef2f9;font-size:13.5px}
.pb-kv:last-child{border:0}.pb-kv i{color:#94a3b8;font-style:normal;font-size:12px}
.pb-rank{display:flex;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px dashed #eef2f9;font-size:14px}
.pb-rank:last-child{border:0}.pb-pos{width:26px;text-align:center}.pb-name{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pb-goal-top{display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:6px}
.pb-track{height:10px;background:#eef0f8;border-radius:99px;overflow:hidden}.pb-fill{height:100%;background:var(--a);border-radius:99px}
.pb-foot{text-align:center;color:#94a3b8;font-size:11.5px;margin-top:16px}
.dim{color:#94a3b8}
@media(max-width:480px){.pb-grid2{grid-template-columns:1fr}}
</style></head><body><div class="pb-wrap">
<header class="pb-head"><div class="pb-logo">${escHtml(String(db.settings.brand || 'FF').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</div>
<div><h1>${heading || escHtml(title || '')}</h1>${sub ? `<p>${sub}</p>` : ''}</div></header>
${body || ''}
</div></body></html>`;
}
function sendHtml(res, status, html, extra = {}) {
  res.writeHead(status, headers({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), ...extra }));
  res.end(html);
}
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
    if (url.pathname.startsWith('/p/')) {
      try { return await servePersonalPage(req, res, url.pathname.slice(3)); } catch (err) { console.error(err); return sendText(res, 500, 'Server error'); }
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
  // 🔐 Panel-permission migration (v3.8.2): har sidebar option ka apna permission key ban gaya
  // (rangeReport, tv, teamMap, stockReport, gvStockReport, reportStudio, charts, voiceAssistant).
  // Purane users ke paas parent permission thi — child auto grant karo taaki naye options ke baad
  // bhi kisi ka access lock na ho. Admin Access matrix se baad me change kar sakta hai.
  const PERM_CHILDREN = [
    ['tagIssued', 'rangeReport'], ['home', 'tv'], ['home', 'teamMap'],
    ['performance', 'stockReport'], ['gvStock', 'gvStockReport'],
    ['savedViews', 'reportStudio'], ['compare', 'charts'],
    ['dualChannel', 'masterStock'], ['fastagChampions', 'arena'], ['fastagChampions', 'fame'], ['tv', 'warRoom']
  ];
  let permsMigrated = false;
  for (const u of db.users) {
    if (!u || u.role === 'admin' || !Array.isArray(u.permissions)) continue;
    const has = new Set(u.permissions), add = [];
    for (const [parent, child] of PERM_CHILDREN) if (has.has(parent) && !has.has(child)) add.push(child);
    if (!has.has('voiceAssistant')) add.push('voiceAssistant');
    if (add.length) { u.permissions = u.permissions.concat(add); permsMigrated = true; }
  }
  if (permsMigrated) { await persist('users'); console.log('Panel permissions migrated ✓ — existing users ko naye per-page access options grant ho gaye.'); }
  const storedNotify = stored.notify;
  // `vapid` + `pushLog` bhi durable hain — inke bina har restart par nayi VAPID key banti thi aur
  // phone ke notification panel me push aana band ho jaata tha (subscriptions 403 par reject hoti thin).
  db.notify = { items: Array.isArray(storedNotify.items) ? storedNotify.items.slice(-500) : [], watch: storedNotify.watch && typeof storedNotify.watch === 'object' ? storedNotify.watch : {}, push: Array.isArray(storedNotify.push) ? storedNotify.push.slice(-300) : [], pushLog: Array.isArray(storedNotify.pushLog) ? storedNotify.pushLog.slice(-40) : [], vapid: storedNotify.vapid && typeof storedNotify.vapid === 'object' ? storedNotify.vapid : null, workspace: storedNotify.workspace && typeof storedNotify.workspace === 'object' ? storedNotify.workspace : { views: [], notes: [] } };
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
    // 🌅 Scheduled checks: daily digest (subah 8 IST ke baad roz ek baar) + mid-month target +
    //    weekly inactive users + 🔴 cover alert / 📉 stock history — boot par aur har 30 min.
    setTimeout(() => runScheduledChecks(), 15000);
    setInterval(() => runScheduledChecks(), 30 * 60e3).unref();
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
