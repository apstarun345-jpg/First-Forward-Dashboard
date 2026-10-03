// First Forward Dashboard — zero-dependency Node server.
//  • Serves the static app
//  • Proxies + caches Google Sheets gviz queries (/api/gviz) — login required
//  • Login / signup, sessions, per-user permissions (/api/auth/*, /api/users)
//  • Dashboard settings (branding, sheet mapping, thresholds, contacts) (/api/settings)
// Durable storage: local JSON files OR encrypted APP_STORAGE tab in the same Google spreadsheet.
// Run locally:  npm start   (PORT defaults to 8080; Render sets PORT automatically)
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sheetsStoreFromEnv } from './sheets-storage.js';
import { appsScriptStoreFromEnv, AppsScriptStore } from './apps-script-storage.js';
import { sendMail, mailConfigured, diagnoseMail, mailHint, availableProviders, resolveProviders, resetMailMemo, MAIL_PROVIDERS, splitRecipients } from './mailer.js';
import { DEFAULT_DISPATCH_EMAIL, normalizeDispatchEmail, buildDispatchPlan, dispatchEmailContent } from './dispatch-email.js';
import { createStockAgeBuilder, summaryOf as stockAgeSummary, tagsFor as stockAgeTags, personalStock } from './stock-age.js';
import { loadFfDispatchRows, loadGvDispatchRows } from './dispatch-report.js';
// 🚨 Unusual Activity ka tag-level scan logic — browser (unusual-scan.js script) aur server dono ek hi
// file use karte hain, isliye dono ke duplicate/wrong/malformed counts hamesha same rehte hain.
// Ye classic script hai (koi export nahi): import se sirf execute hota hai aur global set karta hai.
import './unusual-scan.js';

const UA = globalThis.FFunusualScan;

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
const BLOCKED_FILES = new Set(['server.js', 'sheets-storage.js', 'apps-script-storage.js', 'mailer.js', 'stock-age.js', 'DEPLOYMENT.md', 'SHEETS_STORAGE.md', 'STORAGE_SETUP.md', 'package.json', 'package-lock.json', 'render.yaml', 'README.md', '.env']);
const BLOCKED_DIRS = new Set(['data', 'dev', 'node_modules', '.git', 'google-apps-script']);

// ---------------------------------------------------------------------------------------------
// Permissions & settings schema
// ---------------------------------------------------------------------------------------------
// Fixed page / action permissions. Sheet-tab permissions (`sheet:<tabId>`) are generated from the
// `tabs` registry below, so the admin can add or hide sheet tabs and control each one per user.
export const PAGE_PERMISSIONS = [
  { key: 'home', label: 'Home · highlights & charts', group: 'Pages' },
  { key: 'controlTower', label: 'Management · Operations Control Tower (live action + changes + snapshots)', group: 'Management' },
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
  { key: 'tagRequest', label: 'Management · Tag Request (IDFC agents · class-wise stock/tag request form)', group: 'Management' },
  { key: 'masterSearch', label: 'Management · Master Search (GV + FF naam/ID → seedha poora profile)', group: 'Management' },
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
  { key: 'unusual', label: 'Cross-channel · Unusual Agent Activity (wrong VRN / replacement / chassis)', group: 'Cross Channel' },
  { key: 'ffAgentSummary', label: 'First Forward · Agent / TL Summary (share / PDF)', group: 'First Forward' },
  { key: 'gvAgentSummary', label: 'GV Partner · Agent / TL Summary (share / PDF)', group: 'GV Partner' },
  // Legacy key kept so existing saved permissions remain valid during migration.
  { key: 'agentSummary', label: 'Legacy · Agent / TL Summary (use channel-specific access above)', group: 'Cross Channel' },
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
const DEFAULT_USER_PERMS = ['home', 'executive', 'forecast', 'dataQuality', 'savedViews', 'reportStudio', 'followups', 'tagIssued', 'rangeReport', 'masterSearch', 'targets', 'dashboard', 'trend', 'stock', 'stockReport', 'performance', 'ffCommission', 'gvDashboard', 'gvTrend', 'gvStock', 'gvStockReport', 'gvPerformance', 'gvCommission', 'dualChannel', 'masterStock', 'compare', 'tv', 'teamMap',
  'sheet:StockDataa', 'sheet:REPORT', 'sheet:GV Master', 'sheet:Tag Assignment', 'sheet:GV REPORT', 'charts', 'export', 'dispatchPlan', 'tlScorecard', 'voiceAssistant', 'arena', 'fame', 'warRoom', 'activity', 'network', 'radar', 'reportCards', 'directAgents', 'newAgents', 'unusual', 'fastagChampions', 'ffAgentSummary', 'gvAgentSummary', 'agentSummary', 'sprints', 'stockRadar'];

// Admin-controlled audience for automated notifications. `users` means all approved non-admin
// users who have notification access; each user's own master/type preferences still apply.
const DEFAULT_NOTIFICATION_ROUTES = Object.freeze({
  dailyDigest: 'admin', monthlyReport: 'both', lowStock: 'admin', midMonth: 'admin',
  zeroDay: 'admin', agentAnomaly: 'admin', tlAnomaly: 'admin', followup: 'both',
  champion: 'both', reportUpdate: 'both', inactiveUsers: 'admin', backupReminder: 'admin',
  tagRequest: 'admin'   // 🏷️ IDFC Agents Tag Request → admin ke paas
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
  // GV personal commission: VC4 is sourced from the exact GV Master row by default;
  // all other classes wait for an admin-entered official rate. Empty is unresolved, never zero.
  gvCommissionRates: {
    enabled: true, currentMonthOnly: true,
    classes: {
      VC4: { source: 'master', rate: '' }, VC20: { source: 'manual', rate: '' },
      VC5: { source: 'manual', rate: '' }, VC6: { source: 'manual', rate: '' },
      VC7: { source: 'manual', rate: '' }, VC12: { source: 'manual', rate: '' }
    }
  },
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
// Personal-link verification grants short-lived, per-link server sessions. Never trust a
// client-side hidden section or sessionStorage flag for private report data.
const personalLinkSessions = new Map();

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
const NOTIFY_TONES = new Set(['classic', 'soft', 'double', 'chime', 'alert']);
// `voice` = app/web band hone par bhi alerts bol kar sunao (push ke saath "bolne layak" line
// bhejta hai; app dobara khulte hi voice catch-up chalta hai — sw.js + pushVoice.js).
const DEFAULT_NOTIFY_PREFS = { enabled: true, login: true, signup: true, report: true, monthly: true, digest: true, alert: true, activity: true, click: true, search: true, settings: true, user: true, location: true, info: true, request: true, assist: true, sound: true, tone: 'classic', push: true, voice: true };
function normalizeNotifyPrefs(p) {
  const out = { ...DEFAULT_NOTIFY_PREFS };
  if (p && typeof p === 'object') for (const k of Object.keys(DEFAULT_NOTIFY_PREFS)) {
    if (p[k] === undefined) continue;
    out[k] = k === 'tone' ? (NOTIFY_TONES.has(String(p[k])) ? String(p[k]) : DEFAULT_NOTIFY_PREFS.tone) : !!p[k];
  }
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
const CLIENT_PAGES = new Set(['home', 'tagIssued', 'tagRequest', 'targets', 'rangeReport', 'dashboard', 'trend', 'performance', 'stock', 'stockReport', 'gvDashboard', 'gvTrend', 'gvPerformance', 'gvStock', 'gvStockReport', 'compare', 'charts', 'dispatchPlan', 'tlScorecard']);
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
  (req.headers.cookie || '').split(';').forEach((part) => { const i = part.indexOf('='); if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed cookie */ } } });
  return out;
}
const PERSONAL_LINK_SESSION_PREFIX = 'ff_pl_';
const PERSONAL_LINK_SESSION_TTL_MS = 6 * 60 * 60e3;
function personalLinkCookieName(token) { return `${PERSONAL_LINK_SESSION_PREFIX}${sha(String(token || '')).slice(0, 16)}`; }
function prunePersonalLinkSessions() {
  const now = Date.now();
  for (const [key, session] of personalLinkSessions) if (!session || session.expiresAt <= now) personalLinkSessions.delete(key);
  while (personalLinkSessions.size > 5000) personalLinkSessions.delete(personalLinkSessions.keys().next().value);
}
function personalLinkSession(req, link) {
  const value = parseCookies(req)[personalLinkCookieName(link && link.token)];
  if (!value) return false;
  const key = sha(value);
  const session = personalLinkSessions.get(key);
  if (!session || session.expiresAt <= Date.now()) { personalLinkSessions.delete(key); return false; }
  return session.linkId === link.id && session.tokenHash === sha(String(link.token || ''));
}
function createPersonalLinkSession(req, link) {
  prunePersonalLinkSessions();
  const value = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + PERSONAL_LINK_SESSION_TTL_MS;
  personalLinkSessions.set(sha(value), { linkId: link.id, tokenHash: sha(String(link.token || '')), expiresAt });
  const maxAge = Math.floor(PERSONAL_LINK_SESSION_TTL_MS / 1000);
  const cookie = `${personalLinkCookieName(link.token)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;
  return { cookie, value };
}
function revokePersonalLinkSessions(linkId) {
  for (const [key, session] of personalLinkSessions) if (session && session.linkId === linkId) personalLinkSessions.delete(key);
}
function clearPersonalLinkCookie(req, link) {
  return `${personalLinkCookieName(link && link.token)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;
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
// gviz proxy cache — entry count AUR total bytes dono par cap. Pehle sirf 400 entries ka cap tha, size ka nahi:
// bade bodies (StockDataa 25k-row pages, GV Master, EIR…) 512 MB wale instance ki heap bhar dete the (measured:
// ek browsing session ke baad server RSS ~400 MB). Cap se upar jaane par sabse purani entries nikal jaati hain.
const MAX_CACHE_BYTES = Math.max(8, Number(process.env.CACHE_MAX_MB) || 64) * 1024 * 1024;
class GvizCache extends Map {
  constructor() { super(); this.bytes = 0; }
  static sizeOf(entry) { return entry && typeof entry.body === 'string' ? entry.body.length : 0; }
  set(key, entry) {
    const old = super.get(key);
    if (old !== undefined) { this.bytes -= GvizCache.sizeOf(old); super.delete(key); }   // delete + set → insertion order = recency
    const size = GvizCache.sizeOf(entry);
    if (size > MAX_CACHE_BYTES / 2) return this;   // akela entry cap ke aadhe se bada → cache me nahi (baaki entries na nikalein)
    super.set(key, entry);
    this.bytes += size;
    while (this.bytes > MAX_CACHE_BYTES && this.size > 1) this.delete(this.keys().next().value);
    return this;
  }
  delete(key) { const old = super.get(key); const had = super.delete(key); if (had) this.bytes -= GvizCache.sizeOf(old); return had; }
  clear() { super.clear(); this.bytes = 0; }
}
const cache = new GvizCache();   // url → { at, body, status }
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
async function fetchUpstreamCached(url, options) {
  const hit = cache.get(url);
  // Most dashboard queries use the configured (usually 10-minute) cache. Live feeds can set a
  // shorter per-query age so a long CACHE_SECONDS value never freezes GV's "today" number.
  const maxAgeMs = options && options.maxAgeMs !== undefined ? Math.max(0, Number(options.maxAgeMs) || 0) : cacheMs();
  if (hit && Date.now() - hit.at < maxAgeMs) return { status: hit.status || 200, body: hit.body, cached: true };
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
const SERVER_MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
/** Sheet ke date cell → 'yyyy-mm-dd'. gviz ka Date(y,m,d), ISO, dd-mm-yyyy (Indian), dd-Mon-yyyy,
 *  Mon dd, yyyy — sab chalta hai (client ke U.parseDate jaisa hi tolerant, warna server feed aur
 *  client ke numbers alag-alag aa jaate the — "GV aaj live nahi dikh raha" ka ek bada reason). */
function serverDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Google Sheets serial date (1899-12-30 epoch). Guard against ordinary counts/IDs.
    if (value > 20000 && value < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400e3);
      if (!Number.isNaN(dt.getTime())) return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
    }
  }
  const s = String(value === null || value === undefined ? '' : value).trim();
  if (!s) return '';
  const p2 = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => (y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${p2(m)}-${p2(d)}` : '');
  const mon = (name) => { const u = String(name || '').toUpperCase(); return SERVER_MONTHS[u.slice(0, 4)] || SERVER_MONTHS[u.slice(0, 3)] || 0; };
  let m;
  if ((m = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/))) return iso(+m[1], +m[2] + 1, +m[3]);
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]*(\d{2,4})?/))) {
    const mo = mon(m[2]);
    if (mo) { let y = m[3] ? +m[3] : new Date().getFullYear(); if (y < 100) y += 2000; return iso(y, mo, +m[1]); }
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/))) {
    const mo = mon(m[1]);
    if (mo) return iso(+m[3], mo, +m[2]);
  }
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[ T].*)?$/))) {
    let y = +m[3]; if (y < 100) y += 2000;
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) { const t = mo; mo = d; d = t; }   // mm/dd/yyyy bhi tolerate
    return iso(y, mo, d);
  }
  return '';
}
function serverNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function classBucket(value) {
  const c = String(value || '').toUpperCase().replace(/\s+/g, '');
  if (c === '4' || c === 'VC4') return 'VC4';
  if (c === '20' || c === 'VC20') return 'VC20';
  return 'VC5+';
}
/** gviz table → [{ date, cls, n }] (col indexes 0/1/2). */
function countByDateClass(table) {
  const rows = [];
  for (const row of (table && table.rows) || []) {
    const date = serverDateFromCell(row, 0);
    if (!date) continue;
    const cls = classBucket(serverCell(row, 1));
    const n = serverNumber(serverCell(row, 2));
    if (!n) continue;
    rows.push({ date, cls, n });
  }
  return rows;
}

/**
 * 🛡️ Grouped daily-count query — live sheet me date column kabhi date-typed hota hai, kabhi text.
 * Isliye 3 koshish, pehli jo chale wahi: (1) seedha compare, (2) toDate(), (3) poora tab (chhota tab).
 */
async function gvizDailyClassCounts(cfg) {
  const { sheetId, tab, dateCol, classCol, countCol, extraWhere, from30, cacheMaxAgeMs } = cfg;
  const select = `select ${dateCol}, ${classCol}, count(${countCol})`;
  const group = `group by ${dateCol}, ${classCol} order by ${dateCol} desc`;
  const where = (d) => [extraWhere ? `(${extraWhere})` : '', d ? `${d} >= date '${from30}'` : ''].filter(Boolean).join(' and ');
  const attempts = [
    { tq: `${select} where ${where(dateCol)} ${group} limit 500`, kind: 'date' },
    { tq: `${select} where ${where(`toDate(${dateCol})`)} ${group} limit 500`, kind: 'toDate' },
    { tq: `${select}${extraWhere ? ` where ${extraWhere}` : ''} ${group} limit 2000`, kind: 'full-tab' }
  ];
  let lastErr = null, emptyResult = null;
  for (const attempt of attempts) {
    try {
      const params = new URLSearchParams({ id: String(sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet: tab, tq: attempt.tq });
      const out = await fetchUpstreamCached(upstreamUrl(params), cacheMaxAgeMs === undefined ? undefined : { maxAgeMs: cacheMaxAgeMs });
      const rows = countByDateClass(parseGvizServer(out.body));
      // Google Visualization can return a successful-but-empty result when a date column is stored
      // as text. Treat that as a type mismatch too and try toDate(), then the bounded grouped fallback.
      const hasRecentRows = !from30 || rows.some((row) => row.date >= from30);
      if ((rows.length && hasRecentRows) || attempt.kind === 'full-tab') return { rows, cached: !!out.cached, stale: !!out.stale, via: attempt.kind };
      emptyResult = { rows, cached: !!out.cached, stale: !!out.stale, via: attempt.kind };
    } catch (err) { lastErr = err; }
  }
  if (emptyResult) return emptyResult;
  throw lastErr || new Error('gviz grouped count failed');
}

/**
 * 🧾 Aaj ki GV Master rows ka detail — date × class × status × tag type (replacement / chassis ke liye).
 * Chhoti grouped query hai (sirf aaj ki rows), isliye Home ka "GV aaj live" card kabhi bade
 * full-tab download par depend nahi karta. Wahi 3-koshish wala pattern: seedha compare → toDate() → poora tab.
 */
async function gvizDayDetail(cfg) {
  const { sheetId, tab, dateCol, classCol, statusCol, typeCol, countCol, day, dateMode, cacheMaxAgeMs, expectRows } = cfg;
  const select = `select ${dateCol}, ${classCol}, ${statusCol}, ${typeCol}, count(${countCol})`;
  const group = `group by ${dateCol}, ${classCol}, ${statusCol}, ${typeCol} order by ${dateCol} desc`;
  const dateAttempt = { tq: `${select} where ${dateCol} >= date '${day}' ${group} limit 2000`, kind: 'date' };
  const toDateAttempt = { tq: `${select} where toDate(${dateCol}) >= date '${day}' ${group} limit 2000`, kind: 'toDate' };
  const fullAttempt = { tq: `${select} ${group} limit 3000`, kind: 'full-tab' };
  const attempts = dateMode === 'toDate' ? [toDateAttempt, dateAttempt, fullAttempt] : [dateAttempt, toDateAttempt, fullAttempt];
  let lastErr = null, emptyResult = null;
  for (const attempt of attempts) {
    try {
      const params = new URLSearchParams({ id: String(sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet: tab, tq: attempt.tq });
      const out = await fetchUpstreamCached(upstreamUrl(params), cacheMaxAgeMs === undefined ? undefined : { maxAgeMs: cacheMaxAgeMs });
      const table = parseGvizServer(out.body);
      const rows = [];
      for (const row of (table && table.rows) || []) {
        const date = serverDate(serverCell(row, 0));
        if (!date) continue;
        const n = serverNumber(serverCell(row, 4));
        if (!n) continue;
        rows.push({ date, cls: classBucket(serverCell(row, 1)), status: serverCell(row, 2), type: serverCell(row, 3), n });
      }
      const hasExpectedDay = !expectRows || rows.some((row) => row.date === day);
      if (hasExpectedDay || attempt.kind === 'full-tab') return { rows, cached: !!out.cached, stale: !!out.stale, via: attempt.kind };
      emptyResult = { rows, cached: !!out.cached, stale: !!out.stale, via: attempt.kind };
    } catch (err) { lastErr = err; }
  }
  if (emptyResult) return emptyResult;
  throw lastErr || new Error('gviz day detail failed');
}

/**
 * ⚡ /api/today — "aaj" ka live feed (chhota aur cached).
 *   • GV  = GV Partner sheet ka **GV Master** tab (live)  → P(date) × G(class) count
 *   • FF  = First Forward sheet ka **EIR** tab (T+1 ledger) → AA(date) × D(class) count
 * Grouped-by-date queries Google par sasti hain, isliye Home pehle paint yahi se le leta hai.
 * GV side me aaj ka class split + replacement/chassis + weekday run-rate (expected) bhi aata hai.
 */
const todayFeedCache = { at: 0, body: null, promise: null };
async function gvMasterRawTodayFallback(settings, resolved, day, force) {
  const tab = (settings.gv && settings.gv.master && settings.gv.master.tab) || 'GV Master';
  const id = String(settings.gvSheetId || '').replace(/[^A-Za-z0-9_-]/g, '');
  const cols = resolved || { date: 'P', cls: 'G', tagId: 'I', status: 'N', tagType: 'U' };
  const select = [cols.date, cols.cls, cols.tagId, cols.status, cols.tagType].join(', ');
  const attempts = [
    { tq: `select ${select} where ${cols.date} >= date '${day}' and ${cols.tagId} is not null limit 100000`, kind: 'raw-date' },
    { tq: `select ${select} where toDate(${cols.date}) >= date '${day}' and ${cols.tagId} is not null limit 100000`, kind: 'raw-toDate' },
    { tq: `select ${select} where ${cols.tagId} is not null limit 100000`, kind: 'raw-bounded' }
  ];
  let lastErr = null;
  for (const attempt of attempts) {
    try {
      const params = new URLSearchParams({ id, sheet: tab, tq: attempt.tq });
      const out = await fetchUpstreamCached(upstreamUrl(params), { maxAgeMs: force ? 0 : 30e3 });
      const table = parseGvizServer(out.body);
      const todayRows = [];
      for (const row of table.rows || []) {
        const date = serverDateFromCell(row, 0);
        if (date !== day) continue;
        const tag = serverCell(row, 2);
        if (!tag) continue;
        todayRows.push({ date, cls: classBucket(serverCell(row, 1)), status: serverCell(row, 3), type: serverCell(row, 4) });
      }
      if (todayRows.length || attempt.kind === 'raw-bounded') {
        const classes = {};
        let replacement = 0, chassis = 0;
        for (const row of todayRows) {
          classes[row.cls] = (classes[row.cls] || 0) + 1;
          if (/repl/i.test(row.status || '')) replacement++;
          if (/chassis/i.test(row.type || '')) chassis++;
        }
        return { total: todayRows.length, classes, replacement, chassis, cached: !!out.cached, stale: !!out.stale, via: attempt.kind };
      }
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('GV Master raw today fallback failed');
}
async function todayFeed(force) {
  const ttl = 45e3; // 45s — "live" rehne ke liye chhota TTL, aur Google par load bhi kam
  if (!force && todayFeedCache.body && Date.now() - todayFeedCache.at < ttl) return { ...todayFeedCache.body, cached: true };
  if (todayFeedCache.promise) return todayFeedCache.promise;
  todayFeedCache.promise = (async () => {
    const settings = db.settings || {};
    const day = dateKeyNow();
    const [y, m, d] = day.split('-').map(Number);
    const dayStart30 = new Date(Date.UTC(y, m - 1, d - 29));
    const from30 = `${dayStart30.getUTCFullYear()}-${pad2(dayStart30.getUTCMonth() + 1)}-${pad2(dayStart30.getUTCDate())}`;
    // Live feed freshness is intentionally independent of the general gviz cache setting.
    // A manual admin refresh bypasses both the feed snapshot and per-query cache.
    const liveQueryCacheMs = force ? 0 : 30e3;
    const sum = (rows, filter) => rows.reduce((a, r) => a + (!filter || filter(r) ? r.n : 0), 0);
    const result = { ok: true, date: day, at: new Date().toISOString(), gv: null, ff: null };

    // ---- 🟩 GV · GV Master tab (live) ----
    try {
      const gv = settings.gv && settings.gv.master || {};
      const resolved = await resolveGvServerColumns(settings, !!force);
      const tab = gv.tab || 'GV Master';
      const dateCol = resolved.date, classCol = resolved.cls, tagCol = resolved.tagId;
      const out = await gvizDailyClassCounts({ sheetId: settings.gvSheetId, tab, dateCol, classCol, countCol: tagCol, from30, cacheMaxAgeMs: liveQueryCacheMs });
      let rows = out.rows;
      let today = rows.filter((r) => r.date === day);
      let rawFallback = null;
      if (!today.length) {
        try {
          rawFallback = await gvMasterRawTodayFallback(settings, resolved, day, !!force);
          if (rawFallback && rawFallback.total) {
            today = Object.entries(rawFallback.classes || {}).map(([cls, n]) => ({ date: day, cls, n }));
            rows = rows.concat(today);
          }
        } catch (rawErr) {
          result.gvRawFallbackError = rawErr.message;
        }
      }
      const series = rows.filter((r) => r.date >= from30).reduce((acc, r) => { acc[r.date] = (acc[r.date] || 0) + r.n; return acc; }, {});
      // Aaj ka detail (class × status × tag type) — replacement/chassis/class split ek hi chhoti query se.
      // Fail ho jaye to bhi feed chalta rahe (total/classes upar wali query se aa jaate hain).
      let detail = null;
      try {
        detail = await gvizDayDetail({
          sheetId: settings.gvSheetId, tab, dateCol, classCol,
          statusCol: resolved.status, typeCol: resolved.tagType, countCol: tagCol, day,
          dateMode: out.via, cacheMaxAgeMs: liveQueryCacheMs, expectRows: today.length > 0
        });
      } catch { detail = null; }
      const dToday = detail ? detail.rows.filter((r) => r.date === day) : [];
      const detailClasses = dToday.reduce((acc, r) => { acc[r.cls] = (acc[r.cls] || 0) + r.n; return acc; }, {});
      const replaced = dToday.length ? dToday.reduce((n, r) => n + (/repl/i.test(String(r.status || '')) ? r.n : 0), 0) : Number(rawFallback && rawFallback.replacement) || 0;
      const chassis = dToday.length ? dToday.reduce((n, r) => n + (/chassis/i.test(String(r.type || '')) ? r.n : 0), 0) : Number(rawFallback && rawFallback.chassis) || 0;
      const detailTotal = dToday.reduce((n, r) => n + r.n, 0);
      const classes = Object.keys(detailClasses).length ? detailClasses : today.reduce((acc, r) => { acc[r.cls] = (acc[r.cls] || 0) + r.n; return acc; }, {});
      const total = detailTotal || sum(today);
      // 🎯 Expected today = pichhle 4 same-weekday ka average (pichhla mahina bhi shaamil), aaj se pehle wale din.
      const weekdayAvg = (() => {
        const keys = Object.keys(series).filter((k) => k < day).sort().reverse();
        if (!keys.length) return null;
        const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
        const same = keys.filter((k) => new Date(`${k}T00:00:00Z`).getUTCDay() === wd).slice(0, 4);
        if (!same.length) return null;
        return Math.round(same.reduce((n, k) => n + series[k], 0) / same.length);
      })();
      const prevDay = Object.keys(series).filter((k) => k < day).sort().pop() || '';
      result.gv = {
        source: 'GV Master', live: true, total,
        vc4: classes.VC4 || 0, vc20: classes.VC20 || 0, vc5p: classes['VC5+'] || 0,
        comm: (classes.VC20 || 0) + (classes['VC5+'] || 0),
        replacement: replaced, chassis,
        classes, expected: weekdayAvg, lastDay: prevDay ? series[prevDay] : null, lastDayDate: prevDay || '',
        series,
        cached: !!out.cached, stale: !!out.stale, query: out.via,
        detailCached: !!(detail && detail.cached), detailStale: !!(detail && detail.stale), detailQuery: detail ? detail.via : null
      };
    } catch (err) { result.gvError = err.message; }

    // ---- 🟦 FF · EIR tab (GV master ID ki rows FF me count nahi hoti) ----
    try {
      const e = settings.eir || {};
      const sheet = settings.eirSheet || e.sheet || 'EIR';
      const dateCol = e.date || 'AA', classCol = e.cls || 'D', tagCol = e.tagId || 'A', masterCol = e.masterId || 'AU', tlCol = e.tlName || 'BA';
      const gvId = String(e.gvMasterId || '5845036').trim().replace(/\.0+$/, '');
      const gvTl = String(e.gvChannelTl || 'ApnaPayment Pvt. Ltd.').replace(/'/g, '');
      // GV channel = master ID 5845036 (ya legacy: master blank + GV channel TL) — model.channelOf jaisa hi.
      const extraWhere = `not (${masterCol} = '${gvId}' or (${masterCol} is null and ${tlCol} = '${gvTl}'))`;
      const out = await gvizDailyClassCounts({ sheetId: settings.sheetId, tab: sheet, dateCol, classCol, countCol: tagCol, extraWhere, from30, cacheMaxAgeMs: liveQueryCacheMs });
      const rows = out.rows;
      const today = rows.filter((r) => r.date === day);
      const latest = rows.reduce((acc, r) => (r.date > acc ? r.date : acc), '');
      result.ff = {
        source: 'EIR', total: sum(today), latest, throughYesterday: latest ? latest < day : false,
        classes: today.reduce((acc, r) => { acc[r.cls] = (acc[r.cls] || 0) + r.n; return acc; }, {}),
        series: rows.reduce((acc, r) => { acc[r.date] = (acc[r.date] || 0) + r.n; return acc; }, {}),
        cached: !!out.cached, stale: !!out.stale, query: out.via
      };
    } catch (err) { result.ffError = err.message; }

    todayFeedCache.body = result; todayFeedCache.at = Date.now();
    return result;
  })().finally(() => { todayFeedCache.promise = null; });
  return todayFeedCache.promise;
}


// ---- 🟩 GV Master server-side column resolver (v3.47) -------------------------------------------
// Home ka live GV feed pehle raw P/G/I letters par dependent tha. Client-side GV loader already
// header-aware hai; server /api/today ko bhi wahi rule follow karna chahiye. Header shift hone par
// probe se actual columns locate hote hain, warna configured letters safe fallback hain.
const GV_SERVER_HEADER_SYNS = {
  date: ['ISSUE_DATE','DATE','ISSUANCE_DATE','TXN_DATE'],
  cls: ['CCH','CCH_CLASS','VCLASS','VEHICLE_CLASS','CLASS','TAG_CLASS'],
  tagId: ['TAG_ID_NUMBER','TAG_ID','TAGID','TAG ID NUMBER','TAG ID'],
  status: ['STATUS','TAG_STATUS','TAG STATUS'],
  tagType: ['TAG_TYPE','TYPE','TAG TYPE']
};
const gvServerHeaderCache = new Map();
function normalizeServerHeading(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}
function serverColLetter(index) {
  let n = Number(index) + 1, out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
async function resolveGvServerColumns(settings, force) {
  const cfg = settings.gv && settings.gv.master || {};
  const tab = cfg.tab || 'GV Master';
  const fallback = {
    date: cfg.date || 'P', cls: cfg.cch || cfg.vClass || 'G', tagId: cfg.tagId || 'I',
    status: cfg.status || 'N', tagType: cfg.tagType || 'U'
  };
  const cacheKey = `${settings.gvSheetId || ''}|${tab}`;
  const hit = gvServerHeaderCache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < 10 * 60e3) return { ...fallback, ...hit.cols, via: 'header-cache' };
  try {
    const params = new URLSearchParams({
      id: String(settings.gvSheetId || '').replace(/[^A-Za-z0-9_-]/g, ''),
      sheet: tab,
      tq: 'select * limit 1'
    });
    const out = await fetchUpstreamCached(upstreamUrl(params), { maxAgeMs: force ? 0 : 10 * 60e3 });
    const table = parseGvizServer(out.body);
    const labels = (table.cols || []).map((x) => x && (x.label || x.id) || '');
    const normalized = labels.map(normalizeServerHeading);
    const pick = (field) => {
      for (const syn of GV_SERVER_HEADER_SYNS[field] || []) {
        const want = normalizeServerHeading(syn);
        let idx = normalized.indexOf(want);
        if (idx < 0) idx = normalized.findIndex((x) => x && (x.includes(want) || want.includes(x)));
        if (idx >= 0) return serverColLetter(idx);
      }
      return '';
    };
    const cols = { date: pick('date') || fallback.date, cls: pick('cls') || fallback.cls, tagId: pick('tagId') || fallback.tagId, status: pick('status') || fallback.status, tagType: pick('tagType') || fallback.tagType };
    gvServerHeaderCache.set(cacheKey, { at: Date.now(), cols });
    return { ...fallback, ...cols, via: 'header' };
  } catch (err) {
    // Header probe optional: live feed should still work on the configured mapping.
    return { ...fallback, via: 'config', warning: err.message };
  }
}
// Date cell helper: gviz can return typed Date(), text dates, formatted dates, or Sheets serials.
function serverDateFromCell(row, index) {
  const cell = row && row.c && row.c[index];
  if (!cell) return '';
  const direct = serverDate(cell.v);
  return direct || serverDate(cell.f);
}

async function reportSnapshot(source) {
  const s = db.settings;
  const isGv = source === 'gv';
  // Both watcher channels come from the bank-backed EIR.  The master ID is the only
  // issuance-channel discriminator here: GV is exactly 5845036 (or the configured equivalent),
  // while FF is every other EIR row, including rows whose master cell is blank.
  const e = s.eir || {};
  const sheetId = s.sheetId;
  const sheet = s.eirSheet || e.sheet || 'EIR';
  const dateCol = e.date || 'AA';
  const classCol = e.cls || 'D';
  const tagCol = e.tagId || 'A';
  const masterCol = e.masterId || 'AU';
  const configuredGvId = String(e.gvMasterId || '5845036').trim().replace(/\.0+$/, '');
  const channelWhere = isGv
    ? `${masterCol} = ${configuredGvId}`
    : `(${masterCol} is null or ${masterCol} <> ${configuredGvId})`;
  const baseWhere = `${dateCol} is not null and ${channelWhere}`;
  const select = `${dateCol}, ${classCol}, ${masterCol}, count(${tagCol})`;
  const group = `${dateCol}, ${classCol}, ${masterCol}`;
  const tq = `select ${select} where ${baseWhere} group by ${group} order by ${dateCol} desc limit 5000`;
  const params = new URLSearchParams({ id: String(sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet, tq });
  const out = await fetchUpstream(upstreamUrl(params));
  if (out.status < 200 || out.status >= 300) throw new Error(`Google responded ${out.status}`);
  const table = parseGvizServer(out.body);
  // A few old/private adapters still return the pre-EIR GV Master schema (date, class, count)
  // despite receiving the new EIR request. Keep that compatibility branch schema-gated; a normal
  // production EIR response includes the configured master column and never reaches GV Master.
  const responseCols = (table.cols || []).map((c) => String(c.id || c.label || '').trim().toUpperCase());
  const hasEirMasterColumn = responseCols.includes(String(masterCol).toUpperCase());
  if (isGv && !hasEirMasterColumn) {
    const legacy = s.gv && s.gv.master || {};
    const legacySheet = legacy.tab || 'GV Master';
    const legacyDate = legacy.date || 'P', legacyClass = legacy.cch || legacy.vClass || 'G', legacyTag = legacy.tagId || 'I';
    const legacyTq = `select ${legacyDate}, ${legacyClass}, count(${legacyTag}) where ${legacyDate} is not null group by ${legacyDate}, ${legacyClass} order by ${legacyDate} desc limit 5000`;
    const legacyParams = new URLSearchParams({ id: String(s.gvSheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet: legacySheet, tq: legacyTq });
    const legacyOut = await fetchUpstream(upstreamUrl(legacyParams));
    if (legacyOut.status < 200 || legacyOut.status >= 300) throw new Error(`GV legacy snapshot responded ${legacyOut.status}`);
    const legacyTable = parseGvizServer(legacyOut.body);
    const legacyGrouped = {};
    for (const row of legacyTable.rows || []) {
      const date = serverDate(serverCell(row, 0));
      if (!date) continue;
      const cls = classBucket(serverCell(row, 1));
      if (!legacyGrouped[date]) legacyGrouped[date] = { classes: {} };
      legacyGrouped[date].classes[cls] = (legacyGrouped[date].classes[cls] || 0) + serverNumber(serverCell(row, 2));
    }
    const legacyHistory = Object.fromEntries(Object.entries(legacyGrouped).map(([date, value]) => [date, Object.values(value.classes).reduce((a, b) => a + b, 0)]));
    const legacyDateKey = Object.keys(legacyGrouped).sort().pop() || '';
    const legacyClasses = legacyDateKey ? legacyGrouped[legacyDateKey].classes : {};
    return { date: legacyDateKey, total: Object.values(legacyClasses).reduce((a, b) => a + b, 0), classes: legacyClasses, history: legacyHistory };
  }
  const rows = [];
  for (const row of table.rows || []) {
    const date = serverDate(serverCell(row, 0));
    if (!date) continue;
    const master = serverCell(row, 2).trim().replace(/\.0+$/, '');
    // Keep the client/server channel contract identical even if an upstream query ignores a
    // malformed filter: never let a GV master row enter FF, or another master enter GV.
    const gvRow = master === configuredGvId;
    if (isGv !== gvRow) continue;
    rows.push({ date, cls: classBucket(serverCell(row, 1)), n: serverNumber(serverCell(row, 3)) });
  }
  // The query already returns recent dates, not just the latest one. Keep a compact date → total
  // history for MTD digests while the watcher continues to expose the latest snapshot for deltas.
  const grouped = {};
  rows.forEach((r) => {
    if (!grouped[r.date]) grouped[r.date] = { classes: {} };
    grouped[r.date].classes[r.cls] = (grouped[r.date].classes[r.cls] || 0) + r.n;
  });
  let history = {};
  Object.entries(grouped).forEach(([d, value]) => { history[d] = Object.values(value.classes).reduce((a, b) => a + b, 0); });
  // A second, date-only aggregate avoids the old date × class × master row ceiling. It uses the
  // exact same EIR channel predicate, so notification MTD totals cannot drift from latest-day data.
  try {
    const historyTq = `select ${dateCol}, count(${tagCol}) where ${baseWhere} group by ${dateCol} order by ${dateCol} desc limit 400`;
    const hparams = new URLSearchParams({ id: String(sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet, tq: historyTq });
    const hout = await fetchUpstream(upstreamUrl(hparams));
    if (hout.status >= 200 && hout.status < 300) {
      const htable = parseGvizServer(hout.body);
      const parsed = {};
      for (const row of htable.rows || []) {
        const dateKey = serverDate(serverCell(row, 0));
        if (dateKey) parsed[dateKey] = serverNumber(serverCell(row, Math.max(1, (row.c || []).length - 1)));
      }
      if (Object.keys(parsed).length && rows.length) history = parsed;
    }
  } catch (err) { /* optional date aggregate — grouped fallback is still valid */ }
  const date = Object.keys(grouped).sort().pop() || '';
  const classes = date ? grouped[date].classes : {};
  return { date, total: Object.values(classes).reduce((a, b) => a + b, 0), classes, history };
}
function snapshotDelta(prev, next) {
  if (!prev || !prev.date || !next || !next.date) return null;
  const keys = new Set([...Object.keys(prev.classes || {}), ...Object.keys(next.classes || {})]);
  const classes = {};
  for (const key of keys) { const d = (next.classes[key] || 0) - (prev.classes[key] || 0); if (d) classes[key] = d; }
  const total = (next.total || 0) - (prev.total || 0);
  // Class-wise corrections (total same, andar ka badlaav) bhi "changed" hain — warna backdated
  // edits par koi notification nahi aata tha.
  return { total, classes, changed: next.date !== prev.date || total !== 0 || Object.keys(classes).length > 0 };
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