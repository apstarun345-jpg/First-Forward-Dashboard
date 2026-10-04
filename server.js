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
const BLOCKED_FILES = new Set(['server.js', 'sheets-storage.js', 'apps-script-storage.js', 'mailer.js', 'stock-age.js', 'DEPLOYMENT.md', 'SHEETS_STORAGE.md', 'STORAGE_SETUP.md', 'RECOVERY.md', 'package.json', 'package-lock.json', 'render.yaml', 'README.md', '.env']);
const BLOCKED_DIRS = new Set(['data', 'dev', 'node_modules', '.git', 'google-apps-script']);
// /api/health ka version ab package.json se aata hai (pehle yahan hardcoded purana string tha).
let APP_VERSION = '3.47.0';
try { APP_VERSION = String(JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || APP_VERSION); } catch { /* keep fallback */ }

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
  gvClassCch: { enabled: true, source: 'cch', groups: { VC4: [], VC20: [], VC5: [] } },
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
// ⏪ v3.48: agar cloud store khaali mila aur is server par koi purana data bhi nahi tha to app ne
// defaults seed kar diye (yahi wo situation hai jisme "settings/users gayab" lagta hai). Is flag se
// Settings page admin ko seedha recovery dikha sakta hai — purana data aksar PURANI sheet me hota hai.
let storageSeededFresh = false;
const storageStatus = () => ({
  backend: STORAGE_BACKEND,
  durable: CLOUD_BACKEND || persistentDiskMounted || !process.env.RENDER,
  encrypted: CLOUD_BACKEND,
  tab: CLOUD_BACKEND ? 'APP_STORAGE' : null,
  lastSavedAt: sheetsStore?.lastSavedAt || null,
  persistentDiskMounted,
  dataDir: STORAGE_BACKEND === 'files' ? DATA_DIR : null,
  error: [...storageFailures.values()].join(' ') || null,
  // ⏪ v3.48: sheet history me purani encrypted saves hain to yahan count dikhta hai (auto-restore nahi hota)
  recoverable: recoveryHintInfo || (CLOUD_BACKEND ? { available: null, pending: true } : null),
  seededFresh: storageSeededFresh,
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
  const cfg = (db.settings && db.settings.gvClassCch) || {};
  const token = String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (cfg.enabled !== false && token) {
    const groups = cfg.groups || {};
    for (const [group, values] of Object.entries(groups)) {
      if (Array.isArray(values) && values.some((v) => String(v || '').toUpperCase().replace(/\s+/g, ' ').trim() === token)) return group === 'VC5' || group === 'VC5+' ? 'VC5+' : group;
    }
  }
  const c = token.replace(/\s+/g, '');
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
// Date cell helper: gviz can return typed Date(), text dates, formatted dates, or Sheets serials.
// (Live-feed helpers ke saath hi rakha gaya hai taaki countByDateClass ke saath hi test/extract ho sake.)
function serverDateFromCell(row, index) {
  const cell = row && row.c && row.c[index];
  if (!cell) return '';
  const direct = serverDate(cell.v);
  return direct || serverDate(cell.f);
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
const gvTodayFeedCache = { at: 0, body: null, promise: null };

async function gvTodayFeed(force) {
  const ttl = 30e3; // live today: short cache, but never scan the full 30-day history
  if (!force && gvTodayFeedCache.body && Date.now() - gvTodayFeedCache.at < ttl) return { ...gvTodayFeedCache.body, cached: true };
  if (gvTodayFeedCache.promise) return gvTodayFeedCache.promise;
  gvTodayFeedCache.promise = (async () => {
    const settings = db.settings || {};
    const day = dateKeyNow();
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDay = `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
    const resolved = await resolveGvServerColumns(settings, !!force);
    const tab = (settings.gv && settings.gv.master && settings.gv.master.tab) || 'GV Master';
    const id = String(settings.gvSheetId || '').replace(/[^A-Za-z0-9_-]/g, '');
    const select = [resolved.date, resolved.cls, resolved.tagId, resolved.status, resolved.tagType].join(', ');
    const attempts = [
      { tq: `select ${select} where ${resolved.date} >= date '${day}' and ${resolved.date} < date '${nextDay}' and ${resolved.tagId} is not null limit 100000`, kind: 'today-date' },
      { tq: `select ${select} where toDate(${resolved.date}) >= date '${day}' and toDate(${resolved.date}) < date '${nextDay}' and ${resolved.tagId} is not null limit 100000`, kind: 'today-toDate' },
      { tq: `select ${select} where ${resolved.tagId} is not null limit 100000`, kind: 'today-bounded' }
    ];
    let lastErr = null;
    for (const attempt of attempts) {
      try {
        const params = new URLSearchParams({ id, sheet: tab, tq: attempt.tq });
        const out = await fetchUpstreamCached(upstreamUrl(params), { maxAgeMs: force ? 0 : ttl });
        const table = parseGvizServer(out.body);
        const rows = [];
        for (const row of table.rows || []) {
          const date = serverDateFromCell(row, 0);
          if (date !== day) continue;
          const tag = serverCell(row, 2);
          if (!tag) continue;
          rows.push({
            cls: classBucket(serverCell(row, 1)),
            status: serverCell(row, 3),
            type: serverCell(row, 4)
          });
        }
        // A successful filtered query with no rows means "no today's data" only after we know
        // the date predicate worked. For the bounded fallback, empty is also a valid zero snapshot.
        const classes = {};
        let replacement = 0, chassis = 0;
        for (const row of rows) {
          classes[row.cls] = (classes[row.cls] || 0) + 1;
          if (/repl/i.test(String(row.status || ''))) replacement++;
          if (/chassis/i.test(String(row.type || ''))) chassis++;
        }
        const result = {
          ok: true, date: day, at: new Date().toISOString(),
          gv: {
            source: 'GV Master', live: true, total: rows.length,
            vc4: classes.VC4 || 0, vc20: classes.VC20 || 0, vc5p: classes['VC5+'] || 0,
            comm: (classes.VC20 || 0) + (classes['VC5+'] || 0),
            replacement, chassis, classes,
            cached: !!out.cached, stale: !!out.stale, query: attempt.kind
          }
        };
        gvTodayFeedCache.body = result;
        gvTodayFeedCache.at = Date.now();
        return result;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('GV today feed failed');
  })().finally(() => { gvTodayFeedCache.promise = null; });
  return gvTodayFeedCache.promise;
}

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
function serverColIndex(letter) {
  let n = 0;
  for (const ch of String(letter || '').toUpperCase()) {
    const code = ch.charCodeAt(0) - 64;
    if (code < 1 || code > 26) return -1;
    n = n * 26 + code;
  }
  return n - 1;
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
    // Configured letter tabhi bharosa ke laayak hai jab us column ki heading expected field jaisi ho;
    // warna (column shift / galat mapping) header probe ka column use karo — client-side mapFields bhi
    // yahi karta hai. Kuch na mile to configured letter safe fallback rehta hai.
    const headerAt = (letter) => { const i = serverColIndex(letter); return i >= 0 ? (normalized[i] || '') : ''; };
    const headerMatches = (field, letter) => {
      const label = headerAt(letter);
      if (!label) return false;
      return (GV_SERVER_HEADER_SYNS[field] || []).some((syn) => {
        const want = normalizeServerHeading(syn);
        return want && (label === want || label.includes(want) || want.includes(label));
      });
    };
    const resolveCol = (field, ...configured) => {
      const letter = configured.find((x) => x) || '';
      if (letter && headerMatches(field, letter)) return letter;   // config letter header se confirm
      return pick(field) || letter || '';                          // warna probe, phir bhi na mile to config
    };
    const dateCol = resolveCol('date', cfg.date);
    const cols = {
      // Fallback chain: configured letter → header probe → configured/default letter.
      date: dateCol || cfg.date || pick('date') || fallback.date,
      cls: resolveCol('cls', cfg.cch, cfg.vClass) || fallback.cls,
      tagId: resolveCol('tagId', cfg.tagId) || fallback.tagId,
      status: resolveCol('status', cfg.status) || fallback.status,
      tagType: resolveCol('tagType', cfg.tagType) || fallback.tagType
    };
    gvServerHeaderCache.set(cacheKey, { at: Date.now(), cols });
    return { ...fallback, ...cols, via: 'header' };
  } catch (err) {
    // Header probe optional: live feed should still work on the configured mapping.
    return { ...fallback, via: 'config', warning: err.message };
  }
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
  // 🏷️ IDFC Agents Tag Request (v3.24) — notify kind ke andar hi durable (naya storage kind nahi).
  if (!Array.isArray(w.tagRequests)) w.tagRequests = [];
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

// ---------------------------------------------------------------------------------------------
// 🌐 PUBLIC (bina login) employee Tag Request — v3.27
// ---------------------------------------------------------------------------------------------
// Employee link: /tag-request  → koi login/signup nahi, sirf **employee name mandatory**,
// phir wahi form (agent search + class qty + system check) → submit. Request admin ke paas
// waise hi pahunchti hai (source: 'public-link') aur Google Sheet sync bhi chalti hai.
const PUBLIC_TAG_DEFAULTS = {
  enabled: true, showCheck: true, showStock: true, askMobile: true, askOffice: false, askNote: true,
  askAddress: true,          // 🏠 full address + 📮 pincode — dono mandatory (dispatch/delivery ke liye)
  title: 'IDFC Agents Tag Request', intro: '', maxRows: 60
};
function publicTagFormConfig() {
  const w = workspaceStore();
  if (!w.publicTagForm || typeof w.publicTagForm !== 'object') w.publicTagForm = { ...PUBLIC_TAG_DEFAULTS };
  const cfg = w.publicTagForm;
  for (const k of Object.keys(PUBLIC_TAG_DEFAULTS)) if (cfg[k] === undefined) cfg[k] = PUBLIC_TAG_DEFAULTS[k];
  return cfg;
}
/** Google Sheet link (…/spreadsheets/d/<ID>/edit) ya seedha ID → spreadsheet ID. */
function sheetIdFromLink(link) {
  const text = String(link || '').trim();
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/.exec(text);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(text) ? text : '';
}
/** Public link par simple per-IP throttle (in-memory; server restart par reset ho jaata hai). */
const publicRate = new Map();
function publicRateOk(ip, limit, windowMs) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const win = windowMs || 3600e3;
  const stamps = (publicRate.get(key) || []).filter((t) => now - t < win);
  if (stamps.length >= (limit || 15)) return false;
  stamps.push(now);
  publicRate.set(key, stamps);
  if (publicRate.size > 5000) for (const [k, v] of publicRate) if (!v.length || now - v[v.length - 1] > 6 * 3600e3) publicRate.delete(k);
  return true;
}
/** Public form ko chahiye sirf 3 tarah ke tabs — baaki kuch bhi public gviz se nahi khulta. */
const PUBLIC_GVIZ_KINDS = new Set(['issuance', 'report', 'gv-report']);
/** EIR (customer-level ledger: VRN/tag ID) public link se sirf AGGREGATED (group by) khulega. */
const isAggregateQuery = (tq) => /\bgroup\s+by\b/i.test(String(tq || '')) && /\b(count|sum|avg|min|max)\s*\(/i.test(String(tq || ''));
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
    prefsVoice: prefs.voice !== false,
    prefsSound: prefs.sound !== false,
    notifyAccess: user.role === 'admin' || user.notifyAccess !== false,
    lastOk: lastOk ? { at: lastOk.at, status: lastOk.status, host: lastOk.host } : null,
    lastError: lastError ? { at: lastError.at, status: lastError.status, error: lastError.error, host: lastError.host, dead: !!lastError.dead, config: !!lastError.config } : null,
    // Admin ko poora picture: sab devices + global config health (normal user ko sirf apna).
    ...(user.role === 'admin' ? { allSubs: pushSubs().length, totalDevices: pushSubs().length } : {})
  };
}
/**
 * Notification text ko bolne-layak banao: HTML/emoji/symbols hata do (Web Speech inhe bol deta hai
 * warna — "blue square", "bar chart" jaisa kachra), whitespace saaf karo, length cap karo.
 */
function speechSafe(value, max) {
  return String(value == null ? '' : value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, ' ')
    .replace(/["'`*_#>|~^{}[\]\\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s.,:%+\-–—()/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s([.,:%])/g, '$1')
    .trim()
    .slice(0, max || 200);
}
/** Push ke saath jaane wali chhoti voice line (app band hone par bhi isi ko bola jayega). */
function pushVoiceLine(item) {
  if (!item) return '';
  const meta = item.meta || {};
  let text = '';
  if (item.type === 'report') {
    const delta = meta.delta && typeof meta.delta === 'object' ? meta.delta : null;
    const total = delta && Number.isFinite(Number(delta.total)) ? Number(delta.total) : null;
    const parts = delta && delta.classes ? Object.entries(delta.classes).slice(0, 4).map(([k, v]) => `${k} ${Number(v) > 0 ? '+' : ''}${Number(v)}`) : [];
    if (total !== null && total !== 0) text = `Data update. ${total > 0 ? '+' : ''}${total} tags${parts.length ? ` (${parts.join(', ')})` : ''}.`;
  }
  if (!text) text = [speechSafe(item.title, 90), speechSafe(item.body, 150)].filter(Boolean).join('. ');
  return speechSafe(text, 240);
}
/** User ke kitne notifications abhi unread hain — push par app-icon badge ke liye. */
function unreadCountFor(u) {
  try {
    const seen = u && u.notificationsSeenAt ? new Date(u.notificationsSeenAt).getTime() : 0;
    return visibleNotifications(u, '1970-01-01T00:00:00.000Z').filter((item) => new Date(item.createdAt).getTime() > seen).length;
  } catch { return 0; }
}
/** Important alerts par notification actions (Android/desktop par dikhte hain). */
const PUSH_ACTIONS = {
  report: [{ action: 'open', title: '📊 Kholo' }, { action: 'dismiss', title: '✅ Theek hai' }],
  alert: [{ action: 'open', title: '🔴 Kholo' }, { action: 'dismiss', title: '✅ Theek hai' }],
  digest: [{ action: 'open', title: '🌅 Kholo' }, { action: 'dismiss', title: '✅ Theek hai' }],
  signup: [{ action: 'open', title: '👤 Kholo' }, { action: 'dismiss', title: '✅ Theek hai' }],
  request: [{ action: 'open', title: '🏷️ Kholo' }, { action: 'dismiss', title: '✅ Theek hai' }]
};
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
    const voiceLine = pushVoiceLine(item);
    const data = {
      id: item.id,
      title: item.title,
      body: (item.body || '').replace(/\s+/g, ' ').slice(0, 180),
      tag: item.type || 'ff',
      link: (item.meta && item.meta.link) || '',
      sound: prefs.sound !== false,
      tone: prefs.tone,
      at: Date.parse(item.createdAt) || Date.now(),
      // 🔊 Voice: app band ho to OS notification (text + sound + vibration) turant jaata hai aur
      // ye line queue me rehti hai; app khulte hi bol kar suna di jaati hai (sw.js + pushVoice.js).
      voice: prefs.voice !== false && prefs.sound !== false ? voiceLine : '',
      speak: prefs.voice !== false && prefs.sound !== false,
      user: s.username,
      badge: unreadCountFor(u),
      lang: 'hi-IN',
      actions: PUSH_ACTIONS[item.type] || undefined,
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
/**
 * One source-aware issuance summary for every digest/report surface.
 *
 * `daily` is deliberately sparse: a missing source means that source was not observed on that
 * date, while an explicit zero is a real snapshot.  Active days therefore mean FF + GV > 0;
 * GV-only and zero-observed days remain visible in the returned breakdown instead of being lost
 * by an FF-only truthy check.
 */
function digestDay(value) {
  if (typeof value === 'number') return { ff: value }; // legacy FF-only record
  return value && typeof value === 'object' ? value : {};
}
function sourceAwareDigestSummary(daily, monthKey) {
  const out = { ff: 0, gv: 0, total: 0, days: 0, activeDays: 0, observedDays: 0, zeroDays: 0, ffDays: 0, gvDays: 0 };
  for (const [date, value] of Object.entries(daily || {})) {
    if (!String(date).startsWith(String(monthKey || ''))) continue;
    const v = digestDay(value);
    const hasFf = Object.prototype.hasOwnProperty.call(v, 'ff');
    const hasGv = Object.prototype.hasOwnProperty.call(v, 'gv');
    if (!hasFf && !hasGv) continue;
    const ff = Number(v.ff) || 0;
    const gv = Number(v.gv) || 0;
    out.ff += ff; out.gv += gv; out.total += ff + gv;
    out.observedDays++;
    if (ff > 0) out.ffDays++;
    if (gv > 0) out.gvDays++;
    if (ff + gv > 0) out.activeDays++;
    else out.zeroDays++;
  }
  out.days = out.activeDays;
  out.avg = out.activeDays ? out.total / out.activeDays : 0;
  return out;
}
function digestPayload({ dateKey, ff, gv, daily, stock }) {
  const summary = sourceAwareDigestSummary(daily, String(dateKey || '').slice(0, 7));
  const th = db.settings.thresholds || {};
  const coverRed = Number(th.coverRed) || 7, coverOrange = Number(th.coverOrange) || 15, coverAmber = Number(th.coverAmber) || 30;
  const topClass = (classes) => { const e = Object.entries(classes || {}).sort((a, b) => b[1] - a[1])[0]; return e ? `${e[0]} ${e[1]}` : ''; };
  const dLabel = (iso) => { const d = Number(String(iso).slice(8, 10)), m = Number(String(iso).slice(5, 7)) - 1; return `${d} ${MON_SHORT[m] || ''}`.trim(); };
  const lines = [];
  if (ff) lines.push(`🟦 FF ${dLabel(ff.date)} · ${ff.total} tags${topClass(ff.classes) ? ` (${topClass(ff.classes)})` : ''}`);
  if (gv) lines.push(`🟩 GV ${dLabel(gv.date)} · ${gv.total} tags${topClass(gv.classes) ? ` (${topClass(gv.classes)})` : ''}`);
  const dayLabel = `${summary.activeDays} active day${summary.activeDays === 1 ? '' : 's'}`;
  const sourceDays = `FF ${summary.ffDays} · GV ${summary.gvDays}`;
  const zeroLabel = summary.zeroDays ? ` · ${summary.zeroDays} zero day${summary.zeroDays === 1 ? '' : 's'} observed` : '';
  if (summary.observedDays) lines.push(`📈 MTD FF ${summary.ff} + GV ${summary.gv} = ${summary.total} · ${dayLabel} (${sourceDays})${zeroLabel} · ≈${Math.round(summary.avg)}/active day`);
  if (stock) {
    const vc4 = (stock.classes && stock.classes.VC4) || 0;
    lines.push(`📦 Stock ${stock.total} (VC4 ${vc4} | Comm ${stock.total - vc4})`);
    if (vc4 && summary.avg > 0) {
      const cover = vc4 / summary.avg;
      const emo = cover < coverRed ? '🔴' : cover < coverOrange ? '🟠' : cover < coverAmber ? '🟡' : '🟢';
      lines.push(`VC4 cover ≈ ${Math.round(cover)} din ${emo}`);
    }
  }
  if (!lines.length) lines.push('Abhi tak koi fresh sheet data nahi mila — sheet update hote hi kal ye digest sahi numbers dikhayega.');
  return { summary, lines, latest: { ff: ff || null, gv: gv || null }, stock: stock || null };
}
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
// ---------------------------------------------------------------------------------------------
// 🧓 Stock ageing (v3.31) — StockDataa + Tag Assignment ek baar padh kar compact index (10 min cache).
// Browser ab 1 lakh rows download nahi karta; har drawer / page sirf agent-TL ke bucket counts leta hai.
// ---------------------------------------------------------------------------------------------
const STOCK_AGE_TTL = 10 * 60e3;                 // index itna purana ho to background me refresh (purana turant serve hota hai)
const STOCK_AGE_ERROR_RETRY_MS = Math.max(0, Number(process.env.STOCK_AGE_ERROR_RETRY_MS ?? 30e3));   // fail / adhura index mila → itni der baad dobara koshish (10 min nahi!)
const STOCK_AGE_PAGE_ROWS = Math.max(1, Number(process.env.STOCK_AGE_PAGE_ROWS) || 25000);
const STOCK_AGE_MAX_PAGES = 60;                   // 60 × 25k = 15 lakh rows — safety cap
const STOCK_AGE_PAGE_WINDOW = Math.max(1, Math.min(6, Number(process.env.STOCK_AGE_PAGE_WINDOW) || 3));   // ek saath itne pages in-flight
const STOCK_AGE_CHUNK = 4000;                     // itni rows ke baad event loop ko saans (health check / baaki users na atkein)
// /api/stock-age itne ms se zyada request ko latka kar nahi rakhta: tab `{ pending: true }` deta hai aur build peeche chalta rehta
// hai — browser poll karta hai (pehle request 45-60 s tak ghoomti thi aur Summary / drawers ka spinner kabhi khatam nahi hota tha).
const STOCK_AGE_WAIT_MS = Math.max(0, Number(process.env.STOCK_AGE_WAIT_MS ?? 20000));
const stockAgeState = { at: 0, index: null, promise: null, key: '', retryAt: 0, startedAt: 0, error: '' };
const yieldLoop = () => new Promise((resolve) => setImmediate(resolve));
const colLetter = (v, fallback) => { const c = String(v || fallback || '').trim().toUpperCase(); return /^[A-Z]{1,3}$/.test(c) ? c : ''; };
/** Ek gviz page (bina proxy cache ke — 4-5 MB ke pages cache me bharne se server ki memory bharti thi) + ek retry. */
async function gvizPageServer(params, sheet) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await fetchUpstream(upstreamUrl(params));
      if (out.status < 200 || out.status >= 300) throw new Error(`${sheet}: Google responded ${out.status}`);
      const table = parseGvizServer(out.body);
      // gviz column id (letter) se index — label row ki galti se order na bigde.
      const ids = (table.cols || []).map((c) => String(c.id || '').toUpperCase());
      return { rows: table.rows || [], ids };
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}
/** Tab ko STOCK_AGE_PAGE_ROWS ke pages me padho; har page `onPage(rows, at)` ko milta hai (poora sheet ek saath memory me nahi).
 *  Pages 3-ke-window me parallel aate hain par PROCESS hamesha order me hote hain (ageing ka raw order stable rahe). */
async function gvizPagesServer(sheetId, sheet, letters, where, onPage) {
  const cols = letters.filter(Boolean);
  const base = `select ${cols.join(', ')}${where ? ` where ${where}` : ''}`;
  const id = String(sheetId || '').replace(/[^A-Za-z0-9_-]/g, '');
  const inflight = new Map();
  let launched = 0;
  const launch = (upTo) => {
    while (launched <= upTo && launched < STOCK_AGE_MAX_PAGES) {
      const page = launched++;
      const job = gvizPageServer(new URLSearchParams({ id, sheet, tq: `${base} limit ${STOCK_AGE_PAGE_ROWS} offset ${page * STOCK_AGE_PAGE_ROWS}` }), sheet);
      job.catch(() => {});   // aage ke speculative pages fail / beech me ruk jaayein to unhandled rejection nahi
      inflight.set(page, job);
    }
  };
  launch(STOCK_AGE_PAGE_WINDOW - 1);
  let firstSig = '', total = 0;
  for (let page = 0; page < STOCK_AGE_MAX_PAGES; page++) {
    const { rows, ids } = await inflight.get(page);
    inflight.delete(page);
    if (page > 0 && rows.length) {
      // Offset ignore ho raha ho (wahi page dobara) to duplicate mat jodo — pehla page hi poora data tha.
      if (JSON.stringify(rows[0].c || rows[0]) === firstSig) break;
    }
    if (page === 0) firstSig = rows.length ? JSON.stringify(rows[0].c || rows[0]) : '';
    const at = (L) => { const i = ids.indexOf(L); return i >= 0 ? i : cols.indexOf(L); };
    total += rows.length;
    await onPage(rows, at);
    if (rows.length < STOCK_AGE_PAGE_ROWS) break;
    launch(page + STOCK_AGE_PAGE_WINDOW);
  }
  return total;
}
async function loadStockAgeIndex() {
  const s = db.settings || {};
  const st = s.stock || {};
  const A = (s.gv && s.gv.assignment) || {};
  const errors = {};
  const ffL = { id: colLetter(st.id, 'A'), tagId: colLetter(st.tagId, 'C'), barcode: colLetter(st.barcode, 'D'), cls: colLetter(st.cls, 'E'), bcDate: colLetter(st.bcAllocatedAt, 'G'), agentId: colLetter(st.agentId, 'H'), agentName: colLetter(st.agentName, 'I'), agentDate: colLetter(st.agentAllocatedAt, 'J'), tl: colLetter(st.tlName, 'K') };
  const gvL = { cls: colLetter(A.cls, 'A'), tagId: colLetter(A.tagId, 'B'), serial: colLetter(A.serial, 'C'), status: colLetter(A.status, 'D'), agentId: colLetter(A.agentId, 'E'), agentName: colLetter(A.agentName, 'F'), tlId: colLetter(A.tlId, 'G'), tlName: colLetter(A.tlName, 'H'), date: colLetter(A.allocatedAt, '') };
  const pick = (row, idx) => (idx >= 0 ? serverCell(row, idx) : '');
  const [y, m, d] = dateKeyNow().split('-').map(Number);
  const opts = { todayDay: Date.UTC(y, m - 1, d) / 86400e3, masterId: (s.eir && s.eir.gvMasterId) || '5845036', parkedTl: (s.eir && s.eir.gvChannelTl) || 'ApnaPayment Pvt. Ltd.' };
  let builder = createStockAgeBuilder(opts);
  const gvBuf = [];   // GV ki umr FF (StockDataa) se match hoti hai → GV rows FF ke baad jodte hain (dono pages parallel padhe jaate hain)
  const ffJob = (async () => {
    const letters = [...new Set(Object.values(ffL).filter(Boolean))];
    await gvizPagesServer(s.sheetId, s.stockSheet || 'StockDataa', letters, `${ffL.tagId} is not null`, async (rows, at) => {
      const ix = Object.fromEntries(Object.entries(ffL).map(([k, L]) => [k, L ? at(L) : -1]));
      for (let i = 0; i < rows.length; i += STOCK_AGE_CHUNK) {
        builder.addFf(rows.slice(i, i + STOCK_AGE_CHUNK).map((row) => ({ id: pick(row, ix.id), tagId: pick(row, ix.tagId), barcode: pick(row, ix.barcode), cls: pick(row, ix.cls), bcDate: pick(row, ix.bcDate), agentId: pick(row, ix.agentId), agentName: pick(row, ix.agentName), agentDate: pick(row, ix.agentDate), tl: pick(row, ix.tl) })));
        await yieldLoop();
      }
    });
  })().catch((err) => { errors.ff = err.message; });
  const gvJob = (async () => {
    if (!s.gvSheetId) return;
    const letters = [...new Set(Object.values(gvL).filter(Boolean))];
    await gvizPagesServer(s.gvSheetId, A.tab || 'Tag Assignment', letters, `${gvL.tagId} is not null`, async (rows, at) => {
      const ix = Object.fromEntries(Object.entries(gvL).map(([k, L]) => [k, L ? at(L) : -1]));
      for (let i = 0; i < rows.length; i += STOCK_AGE_CHUNK) {
        for (const row of rows.slice(i, i + STOCK_AGE_CHUNK)) gvBuf.push({ cls: pick(row, ix.cls), tagId: pick(row, ix.tagId), serial: pick(row, ix.serial), status: pick(row, ix.status), agentId: pick(row, ix.agentId), agentName: pick(row, ix.agentName), tlId: pick(row, ix.tlId), tlName: pick(row, ix.tlName), date: pick(row, ix.date) });
        await yieldLoop();
      }
    });
  })().catch((err) => { errors.gv = err.message; gvBuf.length = 0; });
  await Promise.all([ffJob, gvJob]);
  // Adhura FF (beech ke page fail) kabhi mat dikhao — kam ginti sahi jaisi dikhti hai. Khaali FF + GV hi do (errors.ff ke saath).
  if (errors.ff) builder = createStockAgeBuilder(opts);
  for (let i = 0; i < gvBuf.length; i += STOCK_AGE_CHUNK) { builder.addGv(gvBuf.slice(i, i + STOCK_AGE_CHUNK)); await yieldLoop(); }
  const index = builder.finish();
  if (Object.keys(errors).length) index.errors = errors;
  return index;
}
const stockAgeKey = () => JSON.stringify([db.settings.sheetId, db.settings.gvSheetId, db.settings.stockSheet, db.settings.stock, db.settings.gv && db.settings.gv.assignment]);
/** Naya index banao (single-flight). Purana accha index ho to adhure / fail result se replace nahi hota. */
function startStockAgeBuild(key) {
  if (stockAgeState.promise && stockAgeState.key === key) return stockAgeState.promise;
  stockAgeState.key = key;
  stockAgeState.startedAt = Date.now();
  const job = loadStockAgeIndex().then((next) => {
    if (stockAgeState.key !== key) return next;   // settings beech me badal gayi — is result ko store mat karo
    const prev = stockAgeState.index;
    const err = next.errors || {};
    let index = next;
    if (prev) {
      // Fail hui side ke liye purana (accha) data rakho — Google ke ek blip par ageing blank / adhuri na ho.
      if (err.ff) index = prev;
      else if (err.gv) index = { ...next, gv: prev.gv };
    }
    stockAgeState.index = index;
    stockAgeState.at = Date.now();
    const failed = !!(err.ff || err.gv);
    stockAgeState.error = failed ? [err.ff && `FF: ${err.ff}`, err.gv && `GV: ${err.gv}`].filter(Boolean).join(' · ') : '';
    stockAgeState.retryAt = failed ? Date.now() + STOCK_AGE_ERROR_RETRY_MS : 0;
    if (failed) { index = { ...index, errors: { ...err } }; stockAgeState.index = index; }
    else if (index.errors) { index = { ...index }; delete index.errors; stockAgeState.index = index; }
    return index;
  }).catch((err) => {
    stockAgeState.error = (err && err.message) || 'stock ageing build fail';
    stockAgeState.retryAt = Date.now() + STOCK_AGE_ERROR_RETRY_MS;
    if (stockAgeState.index && stockAgeState.key === key) return stockAgeState.index;
    throw err;
  }).finally(() => { if (stockAgeState.promise === job) stockAgeState.promise = null; });
  stockAgeState.promise = job;
  return job;
}
/** Stock ageing index. Stale-while-revalidate: ready index turant milta hai (purana ho to background me refresh),
 *  sirf pehli baar (ya fresh=1) build ka intezaar karna padta hai. */
async function stockAgeIndex(fresh) {
  const key = stockAgeKey();
  const have = stockAgeState.index && stockAgeState.key === key ? stockAgeState.index : null;
  if (have && !fresh) {
    const partial = !!(have.errors && Object.keys(have.errors).length);
    const due = Date.now() - stockAgeState.at >= STOCK_AGE_TTL || (partial && Date.now() >= stockAgeState.retryAt);
    if (due && !stockAgeState.promise) startStockAgeBuild(key).catch(() => {});
    return have;
  }
  return startStockAgeBuild(key);
}
/** `ms` ke andar index mile to do, warna null (build peeche chalta rehta hai) — HTTP request ko latkana nahi. */
async function stockAgeIndexWithin(ms, fresh) {
  const job = stockAgeIndex(fresh);
  if (!(ms > 0)) return job;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try { return await Promise.race([job, timeout]); }
  finally { clearTimeout(timer); job.catch(() => {}); }
}
const stockAgePending = () => ({ ok: true, pending: true, retryAfterMs: 3000, startedAt: stockAgeState.startedAt ? new Date(stockAgeState.startedAt).toISOString() : '', error: stockAgeState.error || '' });
/** /api/health ke liye — sirf coarse sehat (counts / names nahi). */
function stockAgeStatus() {
  const idx = stockAgeState.index;
  return { ready: !!idx, building: !!stockAgeState.promise, ageSec: idx ? Math.round((Date.now() - stockAgeState.at) / 1000) : null, errors: idx && idx.errors ? Object.keys(idx.errors) : [], lastError: stockAgeState.error || '' };
}

// ---------------------------------------------------------------------------------------------
// 🚨 Unusual Activity — tag-level VRN scan (v3.37), SERVER SIDE.
// Pehle browser EIR ke 25,000-row pages khud sequentially kheenchta tha (max 20 pages = 5 lakh rows),
// isliye Unusual Activity page khulte hi kaafi der tak atka rehta tha. Ab wahi scan yahan hota hai:
//   • pages PARALLEL (4 ek saath) — Google proxy cache ke saath,
//   • browser ko sirf compact anomaly index (duplicate VRN groups + wrong/malformed/replacement/
//     chassis evidence rows, capped) jaata hai — poori row dump kabhi nahi,
//   • counting logic unusual-scan.js me shared hai, isliye server index aur browser fallback scan
//     bilkul same numbers banate hain.
// ---------------------------------------------------------------------------------------------
const UA_SCAN_TTL = 10 * 60e3;
const UA_PAGE = 25000;
const UA_MAX_PAGES = 20;
const UA_CONCURRENCY = 4;
const uaScanState = { key: '', at: 0, index: null, promise: null };
const uaDateOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const uaNormCls = (v) => {
  const c = String(v || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!c) return 'VC4';
  return /^VC\d/.test(c) ? c : /^\d+$/.test(c) ? `VC${c}` : c;
};

async function uaGvizTable(params) {
  const out = await fetchUpstreamCached(upstreamUrl(params));
  if (out.status < 200 || out.status >= 300) throw new Error(`Google responded ${out.status}`);
  const table = parseGvizServer(out.body);
  // gviz column id (letter) se index — label row ki wajah se order na bigde.
  const ids = (table.cols || []).map((c) => String(c.id || '').toUpperCase());
  return { rows: table.rows || [], at: (L) => { const i = ids.indexOf(String(L).toUpperCase()); return i; }, cached: !!out.cached };
}

/** EIR ke tag-level rows (date range) — parallel pages, offset-paging sanity check ke saath. */
async function uaEirRecords(from, to, info) {
  const s = db.settings || {};
  const e = s.eir || {};
  const sheet = s.eirSheet || e.sheet || 'EIR';
  const L = {
    date: e.date || 'AA', tagId: e.tagId || 'A', vrn: e.vrn || 'B', cls: e.cls || 'D', vrnType: e.vrnType || 'BC',
    agentName: e.agentName || 'L', agentId: e.agentId || 'J', tlName: e.tlName || 'BA', masterId: e.masterId || 'AU',
    gvName: e.gvName || 'AX', gvId: e.gvId || 'AW', type: e.type || 'P', status: e.status || 'Z'
  };
  const letters = [...new Set(Object.values(L))];
  const select = `select ${letters.join(', ')}`;
  const order = `order by ${L.date} asc, ${L.tagId} asc`;
  const mkParams = (offset, limit, plain) => {
    const d = plain ? L.date : `toDate(${L.date})`;
    const tq = `${select} where ${d} >= date '${from}' and ${d} <= date '${to}' ${order} limit ${limit} offset ${offset}`;
    return new URLSearchParams({ id: String(s.sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet, tq });
  };
  let plain = false;
  const readPage = async (offset, limit) => {
    try { return await uaGvizTable(mkParams(offset, limit, plain)); }
    catch (err) {
      // Date column text me ho to toDate() fail hota hai — ek baar plain compare try karo.
      if (!plain) { plain = true; return uaGvizTable(mkParams(offset, limit, true)); }
      throw err;
    }
  };
  const records = [];
  const seen = new Set();
  let at = null;
  let pages = 0;
  while (pages < UA_MAX_PAGES) {
    const offsets = [];
    for (let i = 0; i < UA_CONCURRENCY && pages + i < UA_MAX_PAGES; i++) offsets.push((pages + i) * UA_PAGE);
    const results = await Promise.all(offsets.map((off) => readPage(off, UA_PAGE)));
    let done = false;
    for (const table of results) {
      pages++;
      info.pages = pages;
      const rows = table.rows || [];
      info.rowsRead += rows.length;
      at = table.at;
      let fresh = 0;
      for (const row of rows) {
        const cell = (k) => serverCell(row, at(L[k]));
        const key = serverDate(cell('date'));
        if (!key) continue;
        const masterId = cell('masterId'), tlName = cell('tlName');
        const ch = UA.chOf(UA.channelOfEir(masterId, tlName, e));
        const agentName = ch === 'gv' ? (cell('gvName') || cell('agentName')) : (cell('agentName') || cell('gvName'));
        const agentId = ch === 'gv' ? (cell('gvId') || cell('agentId')) : (cell('agentId') || cell('gvId'));
        const rec = {
          ch, key, tagId: cell('tagId'), vrn: cell('vrn'), cls: uaNormCls(cell('cls')), vrnType: cell('vrnType'),
          agentName, agentId, tlName, type: cell('type'), status: cell('status')
        };
        const identity = UA.recordKey(rec);
        if (!seen.has(identity)) { seen.add(identity); fresh++; }
        records.push(rec);
      }
      // Offset paging kaam nahi kar raha (same page repeat) → aage mat badho, warn karo.
      if (pages > 1 && rows.length && fresh === 0) { info.offsetIssue = true; done = true; break; }
      if (pages > 1 && fresh > 0) info.offsetVerified = true;
      if (rows.length < UA_PAGE) { done = true; break; }
    }
    if (done) break;
  }
  // Saare pages bhar gaye → ek row probe karke batao ki cap ke aage bhi data hai ya nahi.
  if (!info.offsetIssue && pages >= UA_MAX_PAGES) {
    try {
      const probe = await readPage(UA_PAGE * UA_MAX_PAGES, 1);
      info.capHit = (probe.rows || []).length > 0;
      info.offsetVerified = info.offsetVerified || info.capHit;
    } catch { info.probeFailed = true; }
  }
  return records;
}

/** GV Master (live) ke tag-level rows — aaj ka GV data EIR me T+1 aata hai, isliye ye zaroori hai. */
async function uaGvRecords(from, to, info) {
  const s = db.settings || {};
  if (!s.gvSheetId) return [];
  const m = (s.gv && s.gv.master) || {};
  const L = {
    date: m.date || 'P', tagId: m.tagId || 'I', serial: m.serial || 'H', vrn: m.vrn || 'E', vClass: m.vClass || 'F',
    cch: m.cch || 'G', tagType: m.tagType || 'U', agentName: m.agentName || 'B', agentId: m.uniqueId || 'A',
    tlName: m.tlName || 'D', status: m.status || 'N'
  };
  const letters = [...new Set(Object.values(L))];
  const tab = m.tab || 'GV Master';
  const mk = (plain) => {
    const d = plain ? L.date : `toDate(${L.date})`;
    const tq = `select ${letters.join(', ')} where ${d} >= date '${from}' and ${d} <= date '${to}'`;
    return new URLSearchParams({ id: String(s.gvSheetId).replace(/[^A-Za-z0-9_-]/g, ''), sheet: tab, ...(m.gid ? { gid: String(m.gid) } : {}), tq });
  };
  let table;
  try { table = await uaGvizTable(mk(false)); }
  catch { table = await uaGvizTable(mk(true)); }
  const at = table.at;
  const out = [];
  for (const row of table.rows || []) {
    const cell = (k) => serverCell(row, at(L[k]));
    const key = serverDate(cell('date'));
    const agentId = cell('agentId');
    if (!key || !agentId || /^unique_id$/i.test(agentId)) continue;
    out.push({
      ch: 'gv', key, tagId: cell('tagId') || cell('serial'), vrn: cell('vrn'),
      cls: uaNormCls(cell('cch') || cell('vClass')), vrnType: cell('tagType'),
      agentId, agentName: cell('agentName') || agentId, tlName: cell('tlName') || 'Direct',
      status: cell('status')
    });
  }
  info.gvRows = out.length;
  return out;
}

async function loadUnusualScan(from, to) {
  const started = Date.now();
  const info = { pages: 0, rowsRead: 0, capHit: false, offsetIssue: false, offsetVerified: false, probeFailed: false, gvRows: 0 };
  let eirError = '';
  const [eir, gv] = await Promise.all([
    uaEirRecords(from, to, info).catch((err) => { eirError = err && err.message ? err.message : String(err); return []; }),
    uaGvRecords(from, to, info).catch(() => [])
  ]);
  const records = UA.dedupe(gv.concat(eir));
  const index = UA.buildIndex({
    records, from, to,
    ms: Date.now() - started,
    meta: {
      source: eir.length ? 'server-scan (EIR + GV Master)' : 'server-scan (GV Master only)',
      mode: `parallel ×${UA_CONCURRENCY}`,
      rowsRead: info.rowsRead + info.gvRows, pages: info.pages, gvRows: info.gvRows,
      capHit: info.capHit, offsetIssue: info.offsetIssue, offsetVerified: info.offsetVerified,
      probeFailed: info.probeFailed, error: !!eirError, message: eirError,
      complete: !info.capHit && !info.offsetIssue && !info.probeFailed && !eirError
    }
  });
  return index;
}

/** Range ka scan index (10 min cache + inflight dedupe) — /api/unusual/scan isi se banta hai. */
async function unusualScanIndex({ from, to, fresh }) {
  const key = `${db.settings.sheetId}|${db.settings.gvSheetId}|${db.settings.eirSheet}|${from}|${to}`;
  if (!fresh && uaScanState.index && uaScanState.key === key && Date.now() - uaScanState.at < UA_SCAN_TTL) {
    return { ...uaScanState.index, cached: true };
  }
  if (uaScanState.promise && uaScanState.key === key) return uaScanState.promise;
  uaScanState.key = key;
  uaScanState.promise = loadUnusualScan(from, to).then((index) => {
    // Scan fail ho gaya aur purana index same range ka hai → khali dikhaane se better purana hi do.
    if (index.meta && index.meta.error && !index.totals.rows && uaScanState.index && uaScanState.key === key) return { ...uaScanState.index, stale: true };
    uaScanState.index = index; uaScanState.at = Date.now();
    return index;
  }).finally(() => { uaScanState.promise = null; });
  return uaScanState.promise;
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
    const stock = await stockSnapshot();
    // One source-aware payload drives both the bell notification and optional email.  Never
    // recalculate FF/GV counts in either delivery path.
    const payload = digestPayload({ dateKey, ff, gv, daily, stock });
    const dLabel = (iso) => { const d = Number(String(iso).slice(8, 10)), m = Number(String(iso).slice(5, 7)) - 1; return `${d} ${MON_SHORT[m] || ''}`.trim(); };
    const item = recordNotification({
      type: 'digest',
      title: `🌅 Daily digest · ${dLabel(dateKey)}`,
      body: payload.lines.join(' · '),
      target: 'admin',
      routeKey: 'dailyDigest',
      meta: { date: dateKey, link: '#/dashboard', ...payload.summary, ffMtd: payload.summary.ff, gvMtd: payload.summary.gv, mtdDays: payload.summary.activeDays, stock: stock ? stock.total : null }
    });
    db.notify.watch.digestDate = dateKey;
    persist('notify').catch(() => {});
    console.log(`daily digest sent for ${dateKey} (${payload.lines.length} lines)`);
    // 📧 Email digest (admin Features tab me ON + SMTP configured ho to) — same payload/body.
    const F = feats(), ecfg = db.settings.email || {};
    if (F.emailDigest && mailConfigured(ecfg) && ecfg.to) {
      sendMail(ecfg, `🌅 Daily digest · ${dLabel(dateKey)}`, payload.lines.join('\n'))
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
    const v = digestDay(daily[k]);
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
  const summary = sourceAwareDigestSummary(daily, dateKey.slice(0, 7));
  const ffMtd = summary.ff, gvMtd = summary.gv, mtdDays = summary.activeDays;
  const stock = await stockSnapshot();
  const rows = keys.map((k) => { const v = digestDay(daily[k]); return { date: k, ff: Number(v.ff) || 0, gv: Number(v.gv) || 0 }; });
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
async function overlayDispatchEirIssuance(agents) {
  const e = db.settings.eir || {};
  const sheet = db.settings.eirSheet || e.sheet || 'EIR';
  const sheetId = db.settings.sheetId;
  const dateCol = e.date || 'AA', tagCol = e.tagId || 'A', clsCol = e.cls || 'D';
  const agentIdCol = e.agentId || 'J', agentNameCol = e.agentName || 'L';
  const gvIdCol = e.gvId || 'AW', gvNameCol = e.gvName || 'AX';
  const masterCol = e.masterId || 'AU';
  const gvId = String(e.gvMasterId || '5845036').trim().replace(/\\.0+$/, '');
  const today = dateKeyNow();
  const [y, m, d] = today.split('-').map(Number);
  const ymOf = (dt) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
  const previousYm = ymOf(new Date(Date.UTC(y, m - 2, 1)));
  // 📐 v3.31 — 1 tareekh ko FF ka data month pichhla month hota hai (data kal tak), uska "last month"
  // usse bhi pehle — isliye 2 mahine peeche se padho.
  const start = `${ymOf(new Date(Date.UTC(y, m - 3, 1)))}-01`;
  const yesterdayKey = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  const fields = [agentIdCol, agentNameCol, gvIdCol, gvNameCol, dateCol, clsCol, masterCol];
  const tq = `select ${fields.join(', ')}, count(${tagCol}) where ${tagCol} is not null and ${dateCol} >= date '${start}' and ${dateCol} <= date '${today}' group by ${fields.join(', ')} order by ${dateCol}`;
  const params = new URLSearchParams({ id: String(sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet, tq });
  const out = await fetchUpstream(upstreamUrl(params));
  if (out.status < 200 || out.status >= 300) throw new Error(`EIR dispatch query responded ${out.status}`);
  const table = parseGvizServer(out.body);
  const cleanKey = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const key = (ch, kind, value) => { const x = cleanKey(value); return x ? `${ch}|${kind}:${x}` : ''; };
  const maps = { cur: new Map(), last: new Map() };
  const parsed = [];
  const latest = { ff: '', gv: '' };
  const add = (map, ch, id, name, cls, n) => {
    const keys = [key(ch, 'id', id), key(ch, 'name', name)].filter(Boolean);
    if (!keys.length) return;
    const row = map.get(keys[0]) || { vc4: 0, comm: 0, total: 0 };
    row.total += n;
    if (cls === 'VC4') row.vc4 += n; else row.comm += n;
    keys.forEach((k) => map.set(k, row));
  };
  for (const row of table.rows || []) {
    const date = serverDate(serverCell(row, 4));
    if (!date) continue;
    const master = serverCell(row, 6).trim().replace(/\\.0+$/, '');
    const ch = master === gvId ? 'gv' : 'ff';
    const id = ch === 'gv' ? (serverCell(row, 2) || serverCell(row, 0)) : (serverCell(row, 0) || serverCell(row, 2));
    const name = ch === 'gv' ? (serverCell(row, 3) || serverCell(row, 1)) : (serverCell(row, 1) || serverCell(row, 3));
    // FF ka data T+1 — aaj ki FF row (agar aa bhi jaye) count nahi; GV aaj tak.
    if (date > (ch === 'ff' ? yesterdayKey : today)) continue;
    if (date > latest[ch]) latest[ch] = date;
    parsed.push({ ch, id, name, date, cls: classBucket(serverCell(row, 5)), n: serverNumber(serverCell(row, 7)) });
  }
  // Har channel ka data month = uske latest din ka month; divisor = sheet jaisa (aaj − 1), month-aware.
  const basis = {};
  for (const ch of ['ff', 'gv']) {
    const last = latest[ch] || (ch === 'ff' ? yesterdayKey : today);
    const curYm = last.slice(0, 7);
    const [ly, lm] = curYm.split('-').map(Number);
    const lastYm = ymOf(new Date(Date.UTC(ly, lm - 2, 1)));
    const sameMonth = curYm === today.slice(0, 7);
    const days = ch === 'gv' && sameMonth ? Math.max(1, d - 1) : Math.max(1, Number(last.slice(8, 10)) || 1);
    basis[ch] = { curYm, lastYm, days, latest: last };
  }
  for (const r of parsed) {
    const b = basis[r.ch];
    const ym = r.date.slice(0, 7);
    const map = ym === b.curYm ? maps.cur : ym === b.lastYm ? maps.last : null;
    if (map) add(map, r.ch, r.id, r.name, r.cls, r.n);
  }
  void previousYm;
  const find = (map, agent) => map.get(key(agent.ch, 'id', agent.agentId || agent.id)) || map.get(key(agent.ch, 'name', agent.name || agent.agentName)) || { vc4: 0, comm: 0, total: 0 };
  // REPORT remains the operational source for stock, priority, status, and TL metadata. Only
  // these current/last issuance fields are replaced, so scheduled email matches the browser EIR path.
  agents.forEach((agent) => {
    const cur = find(maps.cur, agent), last = find(maps.last, agent);
    agent.cur = { vc4: cur.vc4, comm: cur.comm, total: cur.total };
    agent.last = { vc4: last.vc4, comm: last.comm, total: last.total };
  });
  Object.defineProperty(agents, 'basis', { value: basis, enumerable: false });
  return agents;
}
async function loadDispatchAgents(channel) {
  const jobs = [];
  if (channel !== 'gv') jobs.push(dispatchReportTable('ff').then((table) => loadFfDispatchRows(table, db.settings)));
  if (channel !== 'ff') jobs.push(dispatchReportTable('gv').then((table) => loadGvDispatchRows(table, db.settings)));
  const sources = await Promise.all(jobs);
  return overlayDispatchEirIssuance(sources.flat());
}
/** buildDispatchPlan ke liye per-channel divisor + data month (overlay ka basis). */
function dispatchBasisOptions(agents) {
  const b = agents && agents.basis;
  if (!b) return {};
  return { elapsed: { ff: b.ff && b.ff.days, gv: b.gv && b.gv.days }, months: { ff: b.ff && b.ff.curYm, gv: b.gv && b.gv.curYm } };
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
  const plan = buildDispatchPlan(sourceAgents, schedule, { settings: db.settings, days: Number(feats().suggestDays) || 15, now: ist, ...dispatchBasisOptions(sourceAgents) });
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
    const agentCol = s.agentName || 'L', tlCol = s.tlName || 'BA', dateCol = s.date || 'AA', tagCol = s.tagId || 'A', masterCol = s.masterId || 'AU';
    const ffWhere = `(${masterCol} is null or ${masterCol} <> ${eirGvMasterId()})`;
    const params = (tq) => new URLSearchParams({ id: String(db.settings.sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet, tq });
    const loadByName = async (firstCol) => {
      const tq = `select ${firstCol}, ${dateCol}, count(${tagCol}) where ${tagCol} is not null and ${ffWhere} group by ${firstCol}, ${dateCol} order by ${dateCol} desc limit 3000`;
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
  const agentCol = s.agentName || 'L', dateCol = s.date || 'AA', tagCol = s.tagId || 'A', masterCol = s.masterId || 'AU';
  const ffWhere = `(${masterCol} is null or ${masterCol} <> ${eirGvMasterId()})`;
  const tq = `select ${agentCol}, ${dateCol}, count(${tagCol}) where ${tagCol} is not null and ${ffWhere} group by ${agentCol}, ${dateCol} order by ${dateCol} desc limit 6000`;
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
  const agentCol = s.agentName || 'L', dateCol = s.date || 'AA', tagCol = s.tagId || 'A', masterCol = s.masterId || 'AU';
  const ffWhere = `(${masterCol} is null or ${masterCol} <> ${eirGvMasterId()})`;
  const tq = `select ${agentCol}, ${dateCol}, count(${tagCol}) where ${tagCol} is not null and ${ffWhere} group by ${agentCol}, ${dateCol} order by ${dateCol} desc limit 6000`;
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
  // 2.5 min throttle — "data update ki notification late aati hai" ka fix (pehle 5 min tha).
  // Client notification polls (har 5s) isi ko trigger karti hain — cadence effectively 2.5 min.
  if (!force && Date.now() - reportCheckAt < 150e3) return;
  reportCheckAt = Date.now();
  reportCheckPromise = (async () => {
    for (const source of ['ff', 'gv']) {
      try {
        const next = await reportSnapshot(source);
        const previous = db.notify.watch[source];
        const currentSnapshot = next && next.date ? { date: next.date, total: Number(next.total) || 0, classes: { ...(next.classes || {}) } } : { date: '', total: 0, classes: {} };
        db.notify.watch[source] = currentSnapshot;
        // Per-date issuance history (daily digest ke liye): persist every recent date returned by
        // the grouped query, not only the latest date. Explicit zero snapshots are meaningful.
        const history = next && next.history && typeof next.history === 'object' ? next.history : (next && next.date ? { [next.date]: next.total } : {});
        if (Object.keys(history).length) {
          if (!db.notify.watch.daily || typeof db.notify.watch.daily !== 'object') db.notify.watch.daily = {};
          for (const [date, total] of Object.entries(history)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
            const prevEntry = db.notify.watch.daily[date] || {};
            // A truthy guard here used to erase zero/empty source days and made GV-only days
            // disappear from MTD and active-day counts.
            if (prevEntry[source] !== total) db.notify.watch.daily[date] = { ...prevEntry, [source]: Number(total) || 0 };
          }
          const keys = Object.keys(db.notify.watch.daily).sort();
          for (let i = 0; i < keys.length - 400; i++) delete db.notify.watch.daily[keys[i]];
        }
        const delta = snapshotDelta(previous, next);
        if (delta && delta.changed) {
          const label = source === 'gv' ? 'GV Partner' : 'First Forward';
          recordNotification({ type: 'report', title: `${label} report update`, body: `${next.date}: ${deltaText(delta)} — Google Sheet me naya data aaya.`, target: 'admin', routeKey: 'reportUpdate', meta: { source, snapshot: currentSnapshot, previous, delta, link: '#/tagIssued' } });
        }
      } catch (err) { console.warn(`report watcher ${source}:`, err.message); }
    }
    await persist('notify');
  })().finally(() => { reportCheckPromise = null; });
  return reportCheckPromise;
}
const etagCache = new Map();   // body-key → etag (chhota LRU, sirf header banane ke liye)
function bodyEtag(body) {
  const key = `${body.length}:${body.slice(0, 64)}:${body.slice(-64)}`;
  if (etagCache.has(key)) return etagCache.get(key);
  const h = crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20);
  const tag = `W/"${h}"`;
  if (etagCache.size > 500) etagCache.delete(etagCache.keys().next().value);
  etagCache.set(key, tag);
  return tag;
}
function sendCached(req, res, entry, tag) {
  // 🏷️ ETag: same query dobara aaye to 304 (sirf header) — payload dobara transfer nahi hota.
  const etag = bodyEtag(entry.body);
  const inm = String(req.headers['if-none-match'] || '');
  if (inm && inm.split(',').map((x) => x.trim()).includes(etag)) {
    res.writeHead(304, headers({ ETag: etag, 'X-Cache': tag, 'X-FF-Source': 'proxy', 'X-FF-Age': String(Math.round((Date.now() - entry.at) / 1000)) }));
    return res.end();
  }
  return sendMaybeCompressed(req, res, 200, 'text/plain; charset=utf-8', entry.body, {
    'Cache-Control': 'no-store', ETag: etag, 'X-Cache': tag, 'X-FF-Source': 'proxy', 'X-FF-Age': String(Math.round((Date.now() - entry.at) / 1000))
  });
}
const HOT = new Map();                 // url → { hits, at } — jo queries sach me use hoti hain
const HOT_LIMIT = 300;
function markHot(url) {
  const h = HOT.get(url) || { hits: 0, at: 0 };
  h.hits++; h.at = Date.now();
  HOT.set(url, h);
  if (HOT.size > HOT_LIMIT) HOT.delete(HOT.keys().next().value);
}
const goodGvizBody = (body) => typeof body === 'string' && body.includes('setResponse') && !/"status"\s*:\s*"error"/.test(body);
async function upstreamOnce(url) {
  let p = inflight.get(url);
  if (!p) { p = fetchUpstream(url).finally(() => inflight.delete(url)); inflight.set(url, p); }
  return p;
}
/** Cache me daalo (dedupe + cap ke saath). */
function remember(url, body, status) {
  const entry = { at: Date.now(), body, status };
  cache.set(url, entry);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  return entry;
}
/** Background refresh — user ko kabhi Google ke intezaar me nahi rakhta. */
async function refreshCache(url) {
  try {
    const { status, body } = await upstreamOnce(url);
    if (status >= 200 && status < 300 && goodGvizBody(body)) return remember(url, body, status);
  } catch { /* upstream down — purana cache hi serve hota rahega */ }
  return null;
}
// 📊 Query diagnostics — "site slow kyun hai" ka exact jawab: kaunsi query kitni baar kitna time le rahi hai.
const PERF = new Map();               // key (sheet + short query) → { n, hits, misses, ms, maxMs, lastAt }
const PERF_LIMIT = 120;
function perfKey(params) {
  const sheet = params.get('gid') ? `gid:${params.get('gid')}` : (params.get('sheet') || 'sheet');
  const tq = String(params.get('tq') || '(full tab)').replace(/\s+/g, ' ').trim();
  return `${sheet} · ${tq.length > 110 ? `${tq.slice(0, 110)}…` : tq}`;
}
function perfNote(params, cacheTag, ms) {
  const key = perfKey(params);
  const p = PERF.get(key) || { n: 0, hits: 0, misses: 0, ms: 0, maxMs: 0, lastAt: 0 };
  p.n++; p.lastAt = Date.now();
  if (cacheTag === 'HIT' || cacheTag === 'STALE') p.hits++; else { p.misses++; p.ms += ms; if (ms > p.maxMs) p.maxMs = ms; }
  PERF.set(key, p);
  if (PERF.size > PERF_LIMIT) PERF.delete(PERF.keys().next().value);
}
async function handleGviz(req, res, params) {
  const fresh = params.get('fresh') === '1';
  const url = upstreamUrl(params);
  const started = Date.now();
  const hit = cache.get(url);
  markHot(url);
  if (hit && !fresh) {
    if (Date.now() - hit.at < cacheMs()) { perfNote(params, 'HIT', 0); return sendCached(req, res, hit, 'HIT'); }
    // ⚡ Stale-while-revalidate: expired entry turant serve karo, naya data peeche se aa jayega.
    void refreshCache(url);
    perfNote(params, 'STALE', 0);
    return sendCached(req, res, hit, 'STALE');
  }
  try {
    const { status, body } = await upstreamOnce(url);
    const ms = Date.now() - started;
    if (status >= 200 && status < 300 && goodGvizBody(body)) { perfNote(params, 'MISS', ms); return sendCached(req, res, remember(url, body, status), 'MISS'); }
    if (hit) { perfNote(params, 'STALE', ms); return sendCached(req, res, hit, 'STALE'); }
    if (!(status >= 200 && status < 300)) { perfNote(params, 'MISS', ms); return sendJson(res, 502, { error: `Google Sheets responded ${status}. Sheet public ("Anyone with the link") hai?` }); }
    perfNote(params, 'MISS', ms);
    return sendMaybeCompressed(req, res, 200, 'text/plain; charset=utf-8', body, { 'Cache-Control': 'no-store', 'X-Cache': 'MISS', 'X-FF-Source': 'proxy' });
  } catch (error) {
    perfNote(params, 'MISS', Date.now() - started);
    if (hit) return sendCached(req, res, hit, 'STALE');
    return sendJson(res, 502, { error: `Google Sheet se data nahi mila: ${error.name === 'AbortError' ? 'timeout' : error.message}` });
  }
}
/**
 * 🌐 PUBLIC gviz (v3.27) — bina login wale employee Tag Request form ke liye.
 * Ye ek hi kaam karta hai: form ko agent/stock/issuance ka wahi data deta hai jo logged-in
 * dashboard ko milta hai — par bahut tange scope me:
 *   • sirf woh tabs jo public form ko chahiye (EIR · REPORT · GV REPORT — configuration registry se),
 *   • sheet ID sirf app ki apni do configured sheets,
 *   • EIR (customer-level VRN ledger) par SIRF group-by/count queries — poori row dump kabhi nahi,
 *   • per-IP throttle (10 min me 120 queries).
 */
async function handlePublicGviz(req, res, params) {
  const ip = clientIp(req);
  if (!publicRateOk(`gviz:${ip}`, 120, 10 * 60e3)) return sendJson(res, 429, { error: 'Bahut zyada requests — thodi der baad try karo.' });
  const tabs = (db.settings && Array.isArray(db.settings.tabs) && db.settings.tabs.length) ? db.settings.tabs : DEFAULT_TABS;
  const sheet = String(params.get('sheet') || '');
  const gid = String(params.get('gid') || '');
  const tab = tabs.find((t) => (sheet && (t.tab === sheet || t.id === sheet)) || (gid && String(t.gid || '') === gid));
  if (!tab || !PUBLIC_GVIZ_KINDS.has(tab.kind)) return sendJson(res, 403, { error: 'Ye query public form ke liye allowed nahi hai.' });
  const tq = String(params.get('tq') || '');
  if (tab.kind === 'issuance' && !isAggregateQuery(tq)) {
    return sendJson(res, 403, { error: 'Public link se issuance ka sirf aggregated (group by) data milta hai.' });
  }
  const id = String(params.get('id') || '').trim();
  if (id && ![db.settings.sheetId, db.settings.gvSheetId].filter(Boolean).includes(id)) return sendJson(res, 403, { error: 'Ye sheet public form ke liye allowed nahi hai.' });
  const clean = new URLSearchParams();
  for (const k of ['sheet', 'gid', 'tq', 'range', 'limit', 'offset', 'headers']) {
    const v = params.get(k);
    if (v !== null && v !== '') clean.set(k, v);
  }
  if (!clean.get('sheet') && !clean.get('gid')) clean.set('sheet', tab.tab);
  if (id) clean.set('id', id);
  return handleGviz(req, res, clean);
}

/** 📊 Admin diagnostics: kaunsi Google query slow hai, cache me kitna hit ho raha hai, kya warm hai. */
function perfReport() {
  const queries = [...PERF.entries()].map(([key, v]) => ({
    key, calls: v.n, cacheHits: v.hits, upstream: v.misses,
    avgMs: v.misses ? Math.round(v.ms / v.misses) : 0, maxMs: v.maxMs, lastAt: new Date(v.lastAt).toISOString()
  })).sort((a, b) => b.avgMs - a.avgMs || b.calls - a.calls);
  const warmed = [...HOT.entries()].filter(([, h]) => h.hits >= WARM_MIN_HITS && h.at > Date.now() - 15 * 60e3).length;
  const hottest = [...HOT.entries()].sort((a, b) => b[1].hits - a[1].hits).slice(0, 10)
    .map(([url, h]) => ({ url: url.length > 160 ? `${url.slice(0, 160)}…` : url, hits: h.hits }));
  return {
    version: '3.47.0', cacheEntries: cache.size, cacheEntriesMax: MAX_CACHE_ENTRIES, cacheMB: Math.round(cache.bytes / 1048576), cacheMBMax: Math.round(MAX_CACHE_BYTES / 1048576),
    cacheSeconds: cacheMs() / 1000, warmedQueries: warmed, hotQueries: hottest,
    slowest: queries.filter((q) => q.upstream > 0).slice(0, 25),
    queries
  };
}
// ⚡ Hot queries ko cache me warm rakho — pehla user bhi instant data dekhta hai (Google ka wait nahi).
const WARM_MIN_HITS = 3;
setInterval(() => {
  const cutoff = Date.now() - 15 * 60e3;
  const hot = [...HOT.entries()].filter(([, h]) => h.at > cutoff && h.hits >= WARM_MIN_HITS)
    .sort((a, b) => b[1].hits - a[1].hits).slice(0, 8);
  if (!hot.length) return;
  (async () => {
    for (const [url] of hot) {
      const entry = cache.get(url);
      if (entry && Date.now() - entry.at < cacheMs() * 0.7) continue;
      await refreshCache(url);
    }
  })().catch(() => {});
}, 60_000).unref?.();

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


// ---- 🎛️ Operations Control Tower snapshots -----------------------------------------------------
const controlTowerRuntime = { at: 0, promise: null };
const CONTROL_TOWER_HISTORY_MAX = 96;
function controlTowerPendingRequestCount() {
  try {
    const rows = workspaceStore().tagRequests || [];
    return rows.filter((r) => !['approved','dispatched','rejected','completed','cancelled'].includes(String(r.status || 'pending').toLowerCase())).length;
  } catch { return 0; }
}
function controlTowerMetricDelta(current, previous) {
  if (!previous) return null;
  const out = {};
  for (const [k, v] of Object.entries(current || {})) {
    if (typeof v !== 'number') continue;
    const p = Number(previous[k] || 0);
    out[k] = v - p;
  }
  return out;
}
function controlTowerActions({ feed, ffStock, gvStock, notifications, pendingSignups, pendingRequests }) {
  const actions = [];
  if (pendingSignups > 0) actions.push({ severity: 'critical', icon: '🆕', title: `${pendingSignups} account approval pending`, detail: 'New signup ko review / approve karo.', link: '#/settings?tab=users' });
  if (pendingRequests > 0) actions.push({ severity: 'critical', icon: '🏷️', title: `${pendingRequests} tag request pending`, detail: 'Tag Request queue me approval / dispatch action pending hai.', link: '#/tagRequest' });
  const gv = feed && feed.gv, ff = feed && feed.ff;
  if (!gv) actions.push({ severity: 'critical', icon: '🟩', title: 'GV live data unavailable', detail: (feed && feed.gvError) || 'GV Master se aaj ka snapshot nahi mila.', link: '#/gvDashboard' });
  else if (gv.stale) actions.push({ severity: 'high', icon: '⏱️', title: 'GV live snapshot stale', detail: 'Latest GV snapshot cache/stale fallback se aa raha hai.', link: '#/home' });
  if (!ff) actions.push({ severity: 'high', icon: '🟦', title: 'FF today feed unavailable', detail: (feed && feed.ffError) || 'EIR today feed nahi mila.', link: '#/dashboard' });
  const alerts = (notifications || []).filter((x) => ['alert'].includes(x.type)).slice(-6).reverse();
  alerts.forEach((x) => actions.push({ severity: 'high', icon: '🚨', title: x.title, detail: x.body, link: (x.meta && x.meta.link) || '#/executive' }));
  const rateFromSeries = (series) => {
    const vals = Object.entries(series || {}).sort((a,b)=>a[0].localeCompare(b[0])).slice(-7).map(([,v])=>Number(v)||0);
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
  };
  if (ffStock) { const rate = rateFromSeries(ff && ff.series); const cover = rate > 0 ? ffStock.total / rate : null; if (cover !== null && cover < 7) actions.push({ severity:'high', icon:'📦', title:'FF stock cover below 7 days', detail:`FF stock ${ffStock.total} · approx cover ${cover.toFixed(1)} days.`, link:'#/stock' }); }
  if (gvStock) { const rate = rateFromSeries(gv && gv.series); const cover = rate > 0 ? gvStock.total / rate : null; if (cover !== null && cover < 7) actions.push({ severity:'high', icon:'📦', title:'GV stock cover below 7 days', detail:`GV stock ${gvStock.total} · approx cover ${cover.toFixed(1)} days.`, link:'#/gvStock' }); }
  if (feed && feed.gv && feed.gv.total === 0) actions.push({ severity: 'high', icon: '0️⃣', title: 'GV Today = 0', detail: 'Server ko aaj ki GV Master rows nahi mili; Control Tower ne isse exception ke roop me flag kiya hai.', link: '#/gvDashboard' });
  const rank = { critical: 4, high: 3, medium: 2, info: 1 };
  return actions.sort((a,b)=>(rank[b.severity]||1)-(rank[a.severity]||1)).slice(0, 20);
}
async function controlTowerSnapshot(user, force) {
  const now = Date.now();
  if (!force && controlTowerRuntime.at && now - controlTowerRuntime.at < 60e3 && controlTowerRuntime.body) return controlTowerRuntime.body;
  if (controlTowerRuntime.promise) return controlTowerRuntime.promise;
  controlTowerRuntime.promise = (async () => {
    const [feedR, ffR, gvR] = await Promise.allSettled([todayFeed(!!force), stockSnapshot(), gvStockSnapshot()]);
    const feed = feedR.status === 'fulfilled' ? feedR.value : { ok:false, gvError:feedR.reason && feedR.reason.message, ffError:feedR.reason && feedR.reason.message };
    const ffStock = ffR.status === 'fulfilled' ? ffR.value : null;
    const gvStock = gvR.status === 'fulfilled' ? gvR.value : null;
    const allNotifications = notifyItems().filter((x) => notificationVisible(x, user)).slice(-80);
    const pendingSignups = db.users.filter((x) => !x.approved).length;
    const pendingRequests = controlTowerPendingRequestCount();
    const metrics = {
      gvToday: Number(feed.gv && feed.gv.total) || 0,
      ffToday: Number(feed.ff && feed.ff.total) || 0,
      combinedToday: (Number(feed.gv && feed.gv.total) || 0) + (Number(feed.ff && feed.ff.total) || 0),
      gvVc4: Number(feed.gv && feed.gv.vc4) || 0,
      gvVc20: Number(feed.gv && feed.gv.vc20) || 0,
      gvVc5p: Number(feed.gv && feed.gv.vc5p) || 0,
      ffStock: Number(ffStock && ffStock.total) || 0,
      gvStock: Number(gvStock && gvStock.total) || 0,
      pendingSignups,
      pendingRequests,
      criticalAlerts: allNotifications.filter((x) => x.type === 'alert').length,
      unreadForUser: user.notificationsSeenAt ? allNotifications.filter((x) => new Date(x.createdAt).getTime() > new Date(user.notificationsSeenAt).getTime()).length : allNotifications.length
    };
    const previous = (controlTowerRuntime.body && controlTowerRuntime.body.snapshot) || null;
    const snapshot = { id: workspaceId('ct'), at: new Date().toISOString(), metrics };
    const previousStored = db.notify.controlTowerSnapshots && db.notify.controlTowerSnapshots.length ? db.notify.controlTowerSnapshots[db.notify.controlTowerSnapshots.length - 1] : null;
    const baseline = previousStored || previous;
    snapshot.delta = controlTowerMetricDelta(metrics, baseline && baseline.metrics);
    if (!Array.isArray(db.notify.controlTowerSnapshots)) db.notify.controlTowerSnapshots = [];
    const lastStoredAt = previousStored ? new Date(previousStored.at).getTime() : 0;
    if (!lastStoredAt || now - lastStoredAt >= 5 * 60e3) {
      db.notify.controlTowerSnapshots.push(snapshot);
      if (db.notify.controlTowerSnapshots.length > CONTROL_TOWER_HISTORY_MAX) db.notify.controlTowerSnapshots = db.notify.controlTowerSnapshots.slice(-CONTROL_TOWER_HISTORY_MAX);
      persist('notify').catch(() => {});
    }
    const body = {
      ok: true, at: new Date().toISOString(), date: dateKeyNow(), live: {
        feed: { date: feed.date || '', gv: feed.gv || null, ff: feed.ff || null, gvError: feed.gvError || '', ffError: feed.ffError || '' },
        ffStock, gvStock,
        pendingSignups, pendingRequests
      },
      snapshot,
      history: (db.notify.controlTowerSnapshots || []).slice(-48),
      actions: controlTowerActions({ feed, ffStock, gvStock, notifications: allNotifications, pendingSignups, pendingRequests }),
      whatChanged: snapshot.delta || {}
    };
    controlTowerRuntime.at = now; controlTowerRuntime.body = body;
    return body;
  })().finally(() => { controlTowerRuntime.promise = null; });
  return controlTowerRuntime.promise;
}

// ---------------------------------------------------------------------------------------------
// ⏪ Recovery (v3.48) — purani settings / users / passwords wapas lana
//    Sheet history (APP_STORAGE_HISTORY) · doosri (purani) sheet · backup file · server disk
//    Rule: kuch bhi tab tak overwrite nahi hota jab tak admin khud restore na dabaye. Har restore
//    se pehle current record ka encrypted backup APP_STORAGE_HISTORY me ban jaata hai (reversible).
// ---------------------------------------------------------------------------------------------
const RECOVERY_KINDS = ['users', 'settings', 'sessions', 'resets'];
const RECOVERY_USER_FIELDS = ['name', 'email', 'mobile', 'avatar', 'role', 'permissions', 'password', 'approved', 'mustChangePassword', 'notifyPrefs', 'notifyAccess', 'createdAt', 'lastLoginAt', 'loginHistory'];
let recoveryHintInfo = null; // boot par mili purani saves ki jankari (health + settings me dikhti hai)

/** 🔐 Panel-permission migration (v3.8.2): har sidebar option ka apna permission key ban gaya
 *  (rangeReport, tv, teamMap, stockReport, gvStockReport, reportStudio, charts, voiceAssistant).
 *  Purane users ke paas parent permission thi — child auto grant karo taaki naye options ke baad
 *  bhi kisi ka access lock na ho. start() aur ⏪ recovery dono isi function se chalte hain. */
async function migrateUserPermissions() {
  const PERM_CHILDREN = [
    ['tagIssued', 'rangeReport'], ['home', 'tv'], ['home', 'teamMap'], ['home', 'masterSearch'],
    ['performance', 'stockReport'], ['gvStock', 'gvStockReport'],
    ['savedViews', 'reportStudio'], ['compare', 'charts'],
    ['dualChannel', 'masterStock'], ['fastagChampions', 'arena'], ['fastagChampions', 'fame'], ['tv', 'warRoom']
  ];
  let migrated = false;
  for (const u of db.users) {
    if (!u || u.role === 'admin' || !Array.isArray(u.permissions)) continue;
    const has = new Set(u.permissions), add = [];
    for (const [parent, child] of PERM_CHILDREN) if (has.has(parent) && !has.has(child)) add.push(child);
    if (!has.has('voiceAssistant')) add.push('voiceAssistant');
    // v3.37: the combined summary became two independent controls. Keep old users'
    // access intact, but expose separate FF and GV switches in Settings → Access matrix.
    if (has.has('agentSummary')) {
      if (!has.has('ffAgentSummary')) add.push('ffAgentSummary');
      if (!has.has('gvAgentSummary')) add.push('gvAgentSummary');
    }
    if (add.length) { u.permissions = [...new Set(u.permissions.concat(add))]; migrated = true; }
  }
  if (migrated) { await persist('users'); console.log('Panel permissions migrated ✓ — existing users ko naye per-page access options grant ho gaye.'); }
  return migrated;
}

/** Ek stored dataset (sheet snapshot / backup file / doosri sheet) ka chhota sa preview. */
function storedSummary(data = {}) {
  const users = Array.isArray(data.users) ? data.users.filter((u) => u && u.username) : [];
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  return {
    users: users.length,
    admins: users.filter((u) => u.role === 'admin').length,
    usernames: users.slice(0, 60).map((u) => String(u.username)),
    approved: users.filter((u) => u.approved !== false).length,
    appName: String(settings.appName || ''),
    settingsUpdatedAt: settings.updatedAt || null,
    sessions: data.sessions && typeof data.sessions === 'object' ? Object.keys(data.sessions).length : 0,
    kinds: RECOVERY_KINDS.filter((k) => data[k] !== undefined && data[k] !== null)
  };
}
function currentSummary() {
  return { users: db.users.length, usernames: db.users.slice(0, 60).map((u) => String(u.username)), appName: String(db.settings.appName || ''), settingsUpdatedAt: db.settings.updatedAt || null };
}
/**
 * Restore kisi bhi purane dataset ko db me — MERGE by default, kabhi andha overwrite nahi.
 *  usersMode: 'merge' (sirf missing users) | 'update' (missing + purane users ki password/permission)
 *             | 'replace' (puri list — phir bhi current admin account hamesha bacha rahta hai, lockout se bachne ke liye)
 */
async function restoreStoredIntoDb(data = {}, { usersMode = 'merge', withSettings = true, withSessions = true, withResets = false, source = 'backup' } = {}) {
  const mode = ['merge', 'update', 'replace'].includes(usersMode) ? usersMode : 'merge';
  const out = { usersAdded: 0, usersUpdated: 0, sessionsAdded: 0, settingsRestored: false, resetsRestored: 0, usersTotal: 0, saved: [] };
  const incoming = (Array.isArray(data.users) ? data.users : []).filter((u) => u && u.username);
  const keepAdmins = db.users.filter((u) => u && u.role === 'admin');
  if (mode === 'replace') {
    const merged = incoming.map((u) => ({ ...u, username: normUser(u.username) }));
    // 🛡️ Lockout guard: current admin account hamesha rahega chahe purane data me na ho.
    for (const admin of keepAdmins) if (!merged.some((u) => u.username === normUser(admin.username))) merged.push(admin);
    out.usersAdded = merged.length - Math.min(merged.length, keepAdmins.length);
    db.users = merged;
  } else {
    for (const u of incoming) {
      const username = normUser(u.username);
      const existing = db.users.find((x) => normUser(x.username) === username);
      if (!existing) { db.users.push({ ...u, username }); out.usersAdded++; continue; }
      if (mode === 'update') {
        for (const key of RECOVERY_USER_FIELDS) if (u[key] !== undefined) existing[key] = u[key];
        out.usersUpdated++;
      }
    }
  }
  out.usersTotal = db.users.length;
  if (withSessions && data.sessions && typeof data.sessions === 'object') {
    for (const [token, session] of Object.entries(data.sessions)) if (!Object.hasOwn(db.sessions, token)) { db.sessions[token] = session; out.sessionsAdded++; }
  }
  if (withSettings && data.settings && typeof data.settings === 'object') {
    db.settings = deepMerge(DEFAULT_SETTINGS, data.settings);
    out.settingsRestored = true;
  }
  if (withResets && Array.isArray(data.resets)) { db.resets = data.resets; out.resetsRestored = data.resets.length; }
  await migrateUserPermissions();
  const kinds = [];
  if (mode === 'replace' || out.usersAdded || out.usersUpdated) kinds.push('users');
  if (out.sessionsAdded) kinds.push('sessions');
  if (out.settingsRestored) kinds.push('settings');
  if (out.resetsRestored) kinds.push('resets');
  for (const kind of kinds) await persist(kind); // har persist se pehle purana record history me chala jaata hai
  out.saved = kinds;
  out.source = source;
  return out;
}
/** Boot ke baad ek baar: sheet history me purani saves hain to admin ko batao (auto-restore kabhi nahi). */
async function recoveryHint() {
  if (!CLOUD_BACKEND || !sheetsStore || typeof sheetsStore.snapshots !== 'function') return null;
  try {
    const { snapshots } = await sheetsStore.snapshots({ limit: 50 });
    recoveryHintInfo = { available: snapshots.length, newestAt: snapshots[0] ? snapshots[0].at : null, oldestAt: snapshots.length ? snapshots[snapshots.length - 1].at : null };
    if (!snapshots.length) return recoveryHintInfo;
    const stale = db.users.length <= 1;
    recordNotification({
      type: 'settings', title: stale ? '⏪ Purana data wapas lane ka option hai' : '⏪ Sheet me purani saves maujood hain',
      body: `Google Sheet ke APP_STORAGE_HISTORY tab me ${snapshots.length} purani encrypted save(s) hain${stale ? ' — abhi sirf ' + db.users.length + ' user load hua hai' : ''}. Settings → ☁️ Storage & backup → ⏪ Purana data wapas lao me jaakar koi bhi purani save wapas la sakte ho. Tab tak kuch bhi change nahi hota.`,
      target: 'admin', meta: { source: 'recovery-hint', snapshots: snapshots.length }
    });
    return recoveryHintInfo;
  } catch (err) {
    // Sabse aam wajah: Apps Script me PURANA Code.gs deployed hai (usme 'history' action hi nahi).
    // Chup-chaap fail na ho — admin ko Settings me seedha karan dikhe.
    console.warn('recovery hint:', err.message);
    const reason = /unknown action|HTML page|invalid response/i.test(err.message)
      ? 'Sheet ke Apps Script me naya Code.gs deploy nahi hua hai (history action missing). Upar “📋 Copy Code.gs” dabao → Apps Script me paste karo → Deploy → Manage deployments → Edit (✏️) → Version: New version → Deploy.'
      : err.message;
    recoveryHintInfo = { available: null, error: reason };
    if (db.users.length <= 1) {
      recordNotification({
        type: 'settings', title: '⏪ Recovery taiyaar nahi hai — Code.gs deploy karo',
        body: `Purani saves dhoondhne ke liye Apps Script me naya Code.gs chahiye. ${reason}`,
        target: 'admin', meta: { source: 'recovery-hint-error' }
      });
    }
    return recoveryHintInfo;
  }
}
/** Server par kahan-kahan purani JSON files mil sakti hain (Render disk / app folder). */
function recoveryDiskDirs() {
  const dirs = [];
  const add = (dir) => { if (dir && !dirs.includes(dir)) dirs.push(dir); };
  add(DATA_DIR);
  add(path.join(__dirname, 'data'));
  if (existsSync('/data')) add('/data');
  return dirs;
}
const RECOVERY_FILES = { users: 'users.json', sessions: 'sessions.json', settings: 'settings.json', resets: 'resets.json' };

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  const user = sessionUser(req);

  if (p === '/api/health' && method === 'GET') {
    // pendingSignups sirf admin ko (sidebar badge ke liye) — public health me leak nahi.
    return sendJson(res, 200, { ok: true, service: 'first-forward-dashboard', version: APP_VERSION, storage: storageStatus(), push: pushHealth(), stockAge: stockAgeStatus(), users: db.users.length, cached: cache.size, cacheSeconds: cacheMs() / 1000, dataDir: STORAGE_BACKEND === 'files' ? DATA_DIR : null, ...(user && user.role === 'admin' ? { pendingSignups: db.users.filter((u) => !u.approved).length } : {}) });
  }
  // 📊 Admin-only: exact reason of slowness (Google query timings, cache hit rate, warm queries).
  if (p === '/api/perf' && method === 'GET') {
    requireAdmin(user);
    return sendJson(res, 200, { ok: true, perf: perfReport() });
  }
  // ⚡ GV ONLY AAJ — Home ka first paint isi fast endpoint se aata hai; history /api/today se alag.
  if (p === '/api/gv-today' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    const force = url.searchParams.get('fresh') === '1' && user.role === 'admin';
    try {
      return sendJson(res, 200, await gvTodayFeed(force));
    } catch (err) {
      if (process.env.DEBUG_TODAY) console.error('[api/gv-today]', err.stack);
      return sendJson(res, 200, { ok: false, error: err.message, gv: null });
    }
  }
  // ⚡ Aaj ka live feed — chhoti grouped queries (server cache se turant). GV = GV Master tab, FF = EIR.
  if (p === '/api/today' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    const force = url.searchParams.get('fresh') === '1' && user.role === 'admin';
    try {
      const feed = await todayFeed(force);
      return sendJson(res, 200, feed);
    } catch (err) {
      if (process.env.DEBUG_TODAY) console.error('[api/today]', err.stack);
      return sendJson(res, 200, { ok: false, error: err.message, gv: null, ff: null });
    }
  }
  // 🎛️ Operations Control Tower — admin-only live operations board.
  if (p === '/api/control-tower' && method === 'GET') {
    requireAdmin(user);
    const force = url.searchParams.get('fresh') === '1';
    return sendJson(res, 200, await controlTowerSnapshot(user, force));
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
  // 🧓 v3.31 stock ageing — summary (agent / TL / network bucket counts, FF + GV) aur tag-level list.
  if (p === '/api/stock-age' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    // ⏳ Index abhi ban raha ho to request ko 45-60 s latkane ke bajay `pending` do — browser poll karta hai (UI kabhi atakta nahi).
    const index = await stockAgeIndexWithin(STOCK_AGE_WAIT_MS, url.searchParams.get('fresh') === '1');
    if (!index) return sendJson(res, 200, stockAgePending());
    const body = JSON.stringify({ ...stockAgeSummary(index), building: !!stockAgeState.promise });
    return sendMaybeCompressed(req, res, 200, 'application/json; charset=utf-8', body, { 'Cache-Control': 'no-store' });
  }
  if (p === '/api/stock-age/tags' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    const q = url.searchParams;
    const split = (v) => String(v || '').split('|').map((x) => x.trim()).filter(Boolean);
    const index = await stockAgeIndexWithin(STOCK_AGE_WAIT_MS, false);
    if (!index) return sendJson(res, 200, { ...stockAgePending(), total: 0, rows: [] });
    const out = stockAgeTags(index, { ch: q.get('ch'), kind: q.get('kind'), key: q.get('key') || '', keys: split(q.get('keys')), tls: split(q.get('tls')), months: Number(q.get('months')) || 0, group: q.get('group') || '', unknown: q.get('unknown') === '1', limit: Number(q.get('limit')) || 2000 });
    return sendMaybeCompressed(req, res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, ...out }), { 'Cache-Control': 'no-store' });
  }
  // 🚨 Unusual Activity — tag-level VRN scan index (duplicate / wrong / malformed / replacement / chassis).
  // Browser ye ek compact JSON me le leta hai; 5 lakh EIR rows download nahi karni padti (page turant khulta hai).
  if (p === '/api/unusual/scan' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    if (user.role !== 'admin' && !(user.permissions || []).includes('unusual')) throw new HttpError(403, 'Unusual Activity access nahi hai.');
    const q = url.searchParams;
    const from = String(q.get('from') || '').slice(0, 10), to = String(q.get('to') || '').slice(0, 10);
    if (!uaDateOk(from) || !uaDateOk(to)) throw new HttpError(400, 'from/to (YYYY-MM-DD) chahiye.');
    if (from > to) throw new HttpError(400, 'from date, to date ke baad nahi ho sakti.');
    const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400e3) + 1;
    if (spanDays > 366) throw new HttpError(400, 'Ek baar me maximum 366 din ka range scan hota hai.');
    const fresh = q.get('fresh') === '1' && user.role === 'admin';
    try {
      const index = await unusualScanIndex({ from, to, fresh });
      const body = JSON.stringify({ ok: true, spanDays, index });
      return sendMaybeCompressed(req, res, 200, 'application/json; charset=utf-8', body, { 'Cache-Control': 'no-store' });
    } catch (err) {
      // 200 + ok:false — client apna fallback (browser-side paging scan) chala leta hai.
      return sendJson(res, 200, { ok: false, error: err && err.message ? err.message : String(err) });
    }
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
    const summary = sourceAwareDigestSummary(daily, dateKeyNow().slice(0, 7));
    const issuance = Object.keys(daily).sort().slice(-180).map((date) => { const v = digestDay(daily[date]); return { date, ff: Number(v.ff) || 0, gv: Number(v.gv) || 0 }; });
    return sendJson(res, 200, { points, issuance, cover: watch.cover || null, thresholds: db.settings.thresholds || {}, mtd: { ff: summary.ff, gv: summary.gv, total: summary.total, days: summary.activeDays, activeDays: summary.activeDays, observedDays: summary.observedDays, zeroDays: summary.zeroDays, ffDays: summary.ffDays, gvDays: summary.gvDays } });
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
  // 🔗 Personal read-only links (agent + TL) — CRUD + Admin Access Control + Auth (TL/Agent ID + Mobile)
  const PL_ALL_SECTIONS = ['overview', 'stock', 'issuance', 'performance', 'ageing', 'export'];
  const normPlSections = (arr) => {
    if (!Array.isArray(arr)) return [...PL_ALL_SECTIONS];
    // An explicitly empty allow-list is an intentional lock-down. Export is only a capability
    // attached to a visible report section, never a stand-alone grant.
    const clean = [...new Set(arr.map((x) => String(x || '').trim()).filter((x) => PL_ALL_SECTIONS.includes(x)))];
    return clean.some((key) => key !== 'export') ? clean : clean.filter((key) => key !== 'export');
  };
  const plDefaults = () => {
    const d = (db.settings && db.settings.personalLinkDefaults) || {};
    return { requireAuth: true, sections: normPlSections(d.sections) };
  };
  const normPlLink = (l) => {
    const def = plDefaults();
    return {
      ...l,
      source: l.source === 'gv' ? 'gv' : 'ff',
      personId: String(l.personId || '').trim().slice(0, 40),
      mobile: String(l.mobile || '').replace(/\D/g, '').slice(-10),
      requireAuth: true,
      sections: Array.isArray(l.sections) ? normPlSections(l.sections) : def.sections
    };
  };
  if (p === '/api/personal-links' && method === 'GET') {
    requireAdmin(user);
    const links = (Array.isArray(db.settings.personalLinks) ? db.settings.personalLinks : []).map(normPlLink);
    return sendJson(res, 200, { links, defaults: plDefaults(), availableSections: PL_ALL_SECTIONS });
  }
  if (p === '/api/personal-links/defaults' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    db.settings.personalLinkDefaults = { requireAuth: true, sections: normPlSections(body.sections) };
    if (body.applyToAll && Array.isArray(db.settings.personalLinks)) {
      db.settings.personalLinks.forEach((l) => {
        l.requireAuth = true;
        l.sections = [...db.settings.personalLinkDefaults.sections];
        revokePersonalLinkSessions(l.id);
      });
    }
    await persist('settings');
    return sendJson(res, 200, { ok: true, defaults: plDefaults(), links: (db.settings.personalLinks || []).map(normPlLink) });
  }
  if (p === '/api/personal-links' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    const kind = body.kind === 'tl' ? 'tl' : 'agent';
    const source = body.source === 'gv' ? 'gv' : 'ff';
    const name = String(body.name || '').trim().replace(/[\u0000-\u001f<>]/g, '').slice(0, 80);
    if (!name) throw new HttpError(400, 'Agent/TL ka exact naam likho.');
    if (feats().personalLinks === false) throw new HttpError(403, 'Personal links feature band hai — Features tab se ON karo.');
    const personId = String(body.personId || '').trim().replace(/[\u0000-\u001f<>]/g, '').slice(0, 40);
    const mobile = String(body.mobile || '').replace(/\D/g, '').slice(-10);
    if (personId.length < 2) throw new HttpError(400, `Admin ko pehle exact ${kind === 'tl' ? 'TL ID' : 'Agent ID'} configure karni hogi.`);
    if (mobile.length !== 10) throw new HttpError(400, 'Personal link ke liye registered 10-digit mobile configure karo.');
    const def = plDefaults();
    const sections = Array.isArray(body.sections) ? normPlSections(body.sections) : def.sections;
    const duplicate = (db.settings.personalLinks || []).find((l) => (l.source === 'gv' ? 'gv' : 'ff') === source && l.kind === kind && String(l.name).toLowerCase() === name.toLowerCase() && l.enabled !== false);
    if (duplicate) {
      const credentialsChanged = String(duplicate.personId || '') !== personId || String(duplicate.mobile || '').replace(/\D/g, '').slice(-10) !== mobile;
      duplicate.personId = personId;
      duplicate.mobile = mobile;
      duplicate.requireAuth = true;
      if (Array.isArray(body.sections)) duplicate.sections = sections;
      if (credentialsChanged || Array.isArray(body.sections)) revokePersonalLinkSessions(duplicate.id);
      await persist('settings');
      void personalDailyRows({ ...duplicate, source }).catch(() => {});
      if (kind === 'tl') void personalTeamAgents({ ...duplicate, source }).catch(() => {});
      return sendJson(res, 200, { ok: true, link: normPlLink(duplicate), reused: true });
    }
    const link = {
      id: `pl_${crypto.randomBytes(6).toString('hex')}`, source, kind, name,
      personId, mobile, requireAuth: true, sections,
      token: crypto.randomBytes(18).toString('hex'), enabled: true, by: user.username, createdAt: new Date().toISOString()
    };
    if (!Array.isArray(db.settings.personalLinks)) db.settings.personalLinks = [];
    db.settings.personalLinks.push(link);
    await persist('settings');
    logAudit(user, 'link_create', { target: `${source}:${kind}:${name}`, ip: clientIp(req) });
    // User WhatsApp/open kare usse pehle Google query warm kar do; response ko is par block nahi karte.
    void personalDailyRows(link).catch(() => {});
    if (kind === 'tl') void personalTeamAgents(link).catch(() => {});
    return sendJson(res, 200, { ok: true, link: normPlLink(link) });
  }
  const plItem = p.match(/^\/api\/personal-links\/([^/]+)$/);
  if (plItem && method === 'PUT') {
    requireAdmin(user);
    const id = decodeURIComponent(plItem[1]);
    const link = (db.settings.personalLinks || []).find((l) => l.id === id);
    if (!link) throw new HttpError(404, 'Link nahi mila.');
    const body = await readBody(req);
    const personId = body.personId !== undefined
      ? String(body.personId || '').trim().replace(/[\u0000-\u001f<>]/g, '').slice(0, 40)
      : String(link.personId || '').trim();
    const mobile = body.mobile !== undefined
      ? String(body.mobile || '').replace(/\D/g, '').slice(-10)
      : String(link.mobile || '').replace(/\D/g, '').slice(-10);
    if (personId.length < 2) throw new HttpError(400, `Exact ${link.kind === 'tl' ? 'TL ID' : 'Agent ID'} zaroori hai.`);
    if (mobile.length !== 10) throw new HttpError(400, 'Registered mobile number 10 digit ka hona chahiye.');
    const credentialsChanged = String(link.personId || '') !== personId || String(link.mobile || '').replace(/\D/g, '').slice(-10) !== mobile;
    link.personId = personId;
    link.mobile = mobile;
    link.requireAuth = true;
    if (Array.isArray(body.sections)) link.sections = normPlSections(body.sections);
    if (body.enabled !== undefined) link.enabled = body.enabled !== false;
    if (credentialsChanged || Array.isArray(body.sections) || link.enabled === false) revokePersonalLinkSessions(link.id);
    await persist('settings');
    logAudit(user, 'link_update', { target: `${link.kind}:${link.name}`, ip: clientIp(req) });
    return sendJson(res, 200, { ok: true, link: normPlLink(link) });
  }
  if (plItem && method === 'DELETE') {
    requireAdmin(user);
    const id = decodeURIComponent(plItem[1]);
    const before = (db.settings.personalLinks || []).length;
    const target = (db.settings.personalLinks || []).find((l) => l.id === id);
    db.settings.personalLinks = (db.settings.personalLinks || []).filter((l) => l.id !== id);
    if (db.settings.personalLinks.length === before) throw new HttpError(404, 'Link nahi mila.');
    revokePersonalLinkSessions(target.id);
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
    if (!link.enabled) revokePersonalLinkSessions(link.id);
    await persist('settings');
    logAudit(user, 'link_toggle', { target: `${link.kind}:${link.name}`, note: link.enabled ? 'ON' : 'OFF' });
    return sendJson(res, 200, { ok: true, link: normPlLink(link) });
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
    for (const k of Object.keys(DEFAULT_NOTIFY_PREFS)) {
      if (patch[k] === undefined) continue;
      next[k] = k === 'tone'
        ? (NOTIFY_TONES.has(String(patch[k])) ? String(patch[k]) : before.tone)
        : !!patch[k];
    }
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
    const prefs = normalizeNotifyPrefs(user.notifyPrefs);
    const wantVoice = prefs.voice !== false && prefs.sound !== false;
    const results = await Promise.all(mine.map(async (s) => {
      const result = await deliverPush(s, {
        id: `test-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
        title: '🔔 Test push notification',
        body: `${user.name || user.username} — ye test alert hai. Phone ke notification panel me dikhna chahiye (app band ho tab bhi).`,
        tag: 'ff-test', link: '#/home', sound: true, tone: prefs.tone, persist: false,
        // 🔊 Ye line app band hone ke baad bhi queue me rehti hai aur app khulte hi boli jaati hai.
        voice: wantVoice ? 'Test alert. App band hone ke baad bhi text notification aata hai, aur ye awaaz app khulte hi sunai deti hai.' : '',
        speak: wantVoice, user: s.username, badge: unreadCountFor(user), lang: 'hi-IN'
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

  // 🌐 Public (bina login) endpoints — employee Tag Request link inhi par chalta hai.
  //    /api/public/* aur branding/version waale endpoints login ke bina khule rehte hain; baaki
  //    sab pehle jaisa protected hai.
  if (!user && !/^\/api\/(public-config|version|public\/)/.test(p)) throw new HttpError(401, 'Login required');

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

  // ---- 🏷️ IDFC Agents Tag Request (v3.24) ------------------------------------------------------
  // User form bharta hai → system check (client-side, sheet se stock/issuance/suggestion) → ye
  // endpoints request ko durable store me rakhte hain taaki admin "Tag Request" section me
  // dekh/edit kar sake. Storage: db.notify.workspace.tagRequests (notify kind ke saath hi durable
  // hai — koi naya storage kind / Apps Script redeploy nahi chahiye).
  // rows ≤150 / requests ≤120 — notify blob (jo har notification par save hota hai) halka rahe.
  const tagRequestRows = (rows) => (Array.isArray(rows) ? rows : []).slice(0, 150).map((r) => ({
    agentId: shortText(r.agentId, 40), agentName: shortText(r.agentName, 120), tl: shortText(r.tl, 120),
    channel: r.channel === 'gv' ? 'gv' : 'ff', cls: shortText(r.cls, 12).toUpperCase(),
    last: Number(r.last) || 0, cur: Number(r.cur) || 0, stock: Number(r.stock) || 0,
    cover: r.cover === null || r.cover === undefined || r.cover === '' ? null : Number(r.cover) || 0,
    priority: shortText(r.priority, 20), growth: Number(r.growth) || 0,
    sugNet: Number(r.sugNet) || 0, sugGross: Number(r.sugGross) || 0,
    approved: Math.max(0, Math.round(Number(r.approved) || 0)), remark: shortText(r.remark, 160),
    // v3.30 — agent ne jo maanga tha (admin qty badle tab bhi original dikhe: "50 → 40").
    ...(r.requested !== undefined && r.requested !== null && r.requested !== '' ? { requested: Math.max(0, Math.round(Number(r.requested) || 0)) } : {})
  }));
  const tagRequestTls = (tls) => (Array.isArray(tls) ? tls : []).slice(0, 100).map((t) => ({
    name: shortText(t.name, 120), channel: t.channel === 'gv' ? 'gv' : 'ff',
    stockVc4: Number(t.stockVc4) || 0, curVc4: Number(t.curVc4) || 0, lastVc4: Number(t.lastVc4) || 0,
    priority: shortText(t.priority, 20), reqApproved: Number(t.reqApproved) || 0, agents: Number(t.agents) || 0,
    sugNet: Number(t.sugNet) || 0, sugGross: Number(t.sugGross) || 0, cover: t.cover === undefined || t.cover === null ? null : Number(t.cover) || 0
  }));
  const visibleTagRequests = (user) => {
    const all = workspaceStore().tagRequests || [];
    const list = user.role === 'admin' ? all : all.filter((r) => r.by === user.username);
    return list.slice(-TAG_REQUEST_CAP).reverse();
  };

  // ---- 🧑‍🤝‍🧑 v3.30 — har AGENT ki alag request (agent ka mobile · full address · pincode ke saath) ----
  // Naya form: upar EMPLOYEE (office wala jo request laga raha hai) + neeche har agent ka block (naam ·
  // mobile · address · pincode · class-wise qty, "➕ Add new agent"). Server har agent ki ALAG request
  // banata hai — apna ID / status / edit / print label; ek submit ke saare agents `batch` ID se jude.
  // Purana `rows[]` payload (purane cached client) bilkul pehle jaisa EK request banata hai.
  const TAG_REQUEST_CAP = 500; // per-agent requests chhoti hoti hain — notify blob ab bhi halka rehta hai
  const tagDigits = (v) => String(v ?? '').replace(/\D/g, '');
  const tagNameKey = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  /** Agent key — client (tagRequest.js → agentKeyOf) bilkul yahi banata hai (inline class edit isi se). */
  const tagAgentKeyOf = (x) => `${x && x.channel === 'gv' ? 'gv' : 'ff'}|${String((x && x.agentId) || '').trim() ? `id:${String(x.agentId).trim()}` : `n:${tagNameKey(x && x.agentName)}`}`;
  const tagRequestAgent = (a) => ({
    name: shortText(a.agentName || a.name, 120), agentId: shortText(a.agentId, 40), tl: shortText(a.tl || a.tlName, 120),
    channel: a.channel === 'gv' ? 'gv' : 'ff',
    ...(String(a.dispatchName || '').trim() ? { dispatchName: shortText(String(a.dispatchName).replace(/\s+/g, ' '), 120) } : {}),
    ...(a.kind === 'tl' ? { kind: 'tl' } : {}),
    mobile: String(a.mobile || a.phone || '').replace(/[^\d+]/g, '').slice(0, 16),
    address: shortText(String(a.address || a.fullAddress || '').replace(/\s+/g, ' '), 300),
    pincode: tagDigits(a.pincode || a.pin).slice(0, 6),
    ...(a.unmatched === true || a.matched === false ? { unmatched: true } : {}) // sheet data me nahi mila (naya agent?)
  });
  const tagMetricNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0; };
  /** Submit ke waqt ka data snapshot (🚗 VC4+VC20 · 🚚 VC5+) — admin ko live data na mile to yahi dikhe. */
  const tagRequestMetrics = (m) => {
    if (!m || typeof m !== 'object') return null;
    const g = (x) => ({ stock: tagMetricNum(x && x.stock), last: tagMetricNum(x && x.last), cur: tagMetricNum(x && x.cur) });
    return { core: g(m.core), comm: g(m.comm), days: Math.max(0, Math.min(31, Math.round(Number(m.days) || 0))), ym: /^\d{4}-\d{2}$/.test(String(m.ym || '')) ? String(m.ym) : '' };
  };
  /** `agents[]` payload → validated per-agent drafts. `rules` = { askMobile, askAddress } (form config). */
  function tagAgentDrafts(list, rules) {
    const rl = rules || {};
    const drafts = [];
    (Array.isArray(list) ? list.slice(0, 40) : []).forEach((a, i) => {
      if (!a || typeof a !== 'object') return;
      const agent = tagRequestAgent(a);
      const label = agent.name || agent.agentId || `Agent ${i + 1}`;
      const rowsIn = (Array.isArray(a.rows) ? a.rows : []).slice(0, 20);
      const hasQty = rowsIn.some((x) => Math.round(Number(x && x.approved) || 0) > 0);
      if (!agent.name && !agent.agentId && !agent.mobile && !hasQty) return; // poora khaali block — chhod do
      if (agent.name.length < 2 && !agent.agentId) throw new HttpError(400, `Agent ${i + 1}: agent ka naam / ID zaroori hai.`);
      const mob = tagDigits(agent.mobile);
      if ((rl.askMobile || mob) && (mob.length < 10 || mob.length > 13)) throw new HttpError(400, `${label}: agent ka mobile number zaroori hai (10 digit).`);
      if (rl.askAddress) {
        if (agent.address.length < 8) throw new HttpError(400, `${label}: agent ka full address zaroori hai (kam se kam 8 characters — house/street/area).`);
        if (!/^\d{6}$/.test(agent.pincode)) throw new HttpError(400, `${label}: pincode zaroori hai (6 digit).`);
      } else if (agent.pincode && !/^\d{6}$/.test(agent.pincode)) throw new HttpError(400, `${label}: pincode 6 digit ka hona chahiye.`);
      const byCls = new Map();
      tagRequestRows(rowsIn.map((x) => ({ ...(x || {}), agentId: agent.agentId, agentName: agent.name, tl: agent.tl, channel: agent.channel }))).forEach((x) => {
        if (!/^VC\d{1,2}$/.test(x.cls) || x.approved <= 0) return;
        const asked = x.requested === undefined ? x.approved : x.requested;
        const prev = byCls.get(x.cls);
        if (prev) { prev.approved += x.approved; prev.requested += asked; return; }
        byCls.set(x.cls, { ...x, requested: asked });
      });
      const rows = [...byCls.values()];
      if (!rows.length) throw new HttpError(400, `${label}: kam se kam ek class me qty daalo.`);
      const total = rows.reduce((s, x) => s + x.approved, 0);
      if (total > 100000) throw new HttpError(400, `${label}: quantity bahut zyada hai — dobara check karo.`);
      drafts.push({ agent, rows, total, metrics: tagRequestMetrics(a.metrics) });
    });
    return drafts;
  }
  /** Store me daalo + cap: pehle sabse purani dispatched/rejected hatao, phir approved, phir koi bhi. */
  function storeTagRequests(list) {
    const w = workspaceStore();
    w.tagRequests.push(...list);
    let extra = w.tagRequests.length - TAG_REQUEST_CAP;
    for (const drop of [['dispatched', 'rejected'], ['approved'], null]) {
      if (extra <= 0) break;
      for (let i = 0; i < w.tagRequests.length && extra > 0;) {
        if (!drop || drop.includes(w.tagRequests[i].status)) { w.tagRequests.splice(i, 1); extra--; } else i++;
      }
    }
    return w;
  }
  /** 🔁 v3.30 agent-wise duplicate — KISI BHI employee ki 30 din ke andar ki active (pending/approved)
   *  request jisme wahi agent (ID / naam / mobile) + wahi class ho. Do employees ek hi agent ki request
   *  dobara daalein to bhi pakda jaata hai. Dispatched/rejected = nayi demand, duplicate nahi. */
  function tagAgentDupes(agents) {
    const wanted = (Array.isArray(agents) ? agents : []).slice(0, 40).map((a) => {
      const ag = tagRequestAgent(a || {});
      const classes = new Set((Array.isArray(a && a.rows) ? a.rows : []).filter((x) => Math.round(Number(x && x.approved) || 0) > 0).map((x) => shortText(x.cls, 12).toUpperCase()));
      return { id: ag.agentId, name: tagNameKey(ag.name), mobile: tagDigits(ag.mobile).slice(-10), classes, label: ag.name || ag.agentId };
    }).filter((x) => (x.id || x.name || x.mobile.length === 10) && x.classes.size);
    if (!wanted.length) return [];
    const nowMs = Date.now();
    const out = [];
    for (const r of (workspaceStore().tagRequests || [])) {
      if (!r) continue;
      const status = String(r.status || 'pending').toLowerCase();
      if (status !== 'pending' && status !== 'approved') continue;
      const t = new Date(r.at || r.updatedAt || 0).getTime();
      if (t && nowMs - t > 30 * 24 * 3600e3) continue;
      const rMob = tagDigits(r.agent && r.agent.mobile).slice(-10);
      const matched = [];
      for (const want of wanted) {
        for (const x of (r.rows || [])) {
          const cls = String((x && x.cls) || '').toUpperCase();
          if (!want.classes.has(cls) || !(Number(x.approved) > 0)) continue;
          const same = (want.id && String(x.agentId || '').trim() === want.id) || (want.name && tagNameKey(x.agentName) === want.name) || (want.mobile.length === 10 && rMob === want.mobile);
          const label = `${x.agentName || want.label} · ${cls}`;
          if (same && !matched.includes(label)) matched.push(label);
        }
      }
      if (!matched.length) continue;
      out.push({
        id: r.id, at: r.at || '', status: r.status || 'pending', total: Number(r.total) || 0, rows: (r.rows || []).length,
        byName: r.byName || '', agentName: (r.agent && r.agent.name) || ((r.rows || [])[0] || {}).agentName || '', matched: matched.slice(0, 8)
      });
    }
    return out.slice(-8).reverse();
  }
  /** Public status card — sirf zaroori fields (address / IP kabhi nahi). */
  const tagStatusView = (r) => {
    const rows = r.rows || [];
    const names = [...new Set(rows.map((x) => x.agentName).filter(Boolean))];
    return {
      id: r.id, at: r.at, status: r.status || 'pending', total: Number(r.total) || 0, byName: r.byName || '', batch: r.batch || '',
      agentName: (r.agent && r.agent.name) || names[0] || '', agentId: (r.agent && r.agent.agentId) || (rows[0] && rows[0].agentId) || '',
      rows: rows.length, agents: Math.max(1, names.length),
      classes: rows.map((x) => ({ cls: x.cls, requested: x.requested === undefined ? Number(x.approved) || 0 : Number(x.requested) || 0, approved: Number(x.approved) || 0, ...(names.length > 1 ? { agent: x.agentName || '' } : {}) })),
      adminNote: r.adminNote || '', note: r.note || '', updatedAt: r.updatedAt || r.at,
      sheetSynced: !!r.sheetSync && !r.sheetSync.error
    };
  };
  /** Submit response me har agent ki chhoti summary (done screen par Request ID list). */
  const tagBatchSummary = (r) => ({
    id: r.id, at: r.at, status: r.status, total: r.total, rows: (r.rows || []).length, byName: r.byName,
    agentName: (r.agent && r.agent.name) || '', agentId: (r.agent && r.agent.agentId) || '', mobile: (r.agent && r.agent.mobile) || '',
    pincode: (r.agent && r.agent.pincode) || '', classes: (r.rows || []).map((x) => ({ cls: x.cls, qty: x.approved })),
    duplicates: r.dupCount || 0, sheetSync: !!r.sheetSync
  });
  /** 🔢 Short 4-digit numeric Tag Request ID (1000–9999) — unique within active tagRequests. */
  function nextTagReqId(usedSet) {
    const used = usedSet || new Set((workspaceStore().tagRequests || []).map((r) => String((r && r.id) || '').trim()));
    for (let i = 0; i < 9000; i++) {
      const cand = String(1000 + Math.floor(Math.random() * 9000));
      if (!used.has(cand)) { used.add(cand); return cand; }
    }
    for (let n = 1000; n <= 9999; n++) {
      const cand = String(n);
      if (!used.has(cand)) { used.add(cand); return cand; }
    }
    return String(1000 + Math.floor(Math.random() * 9000));
  }
  /** Drafts → requests (ek batch): store + persist + 📗 sheet (EK appendrows call, order bana rahe). */
  async function createTagBatch(drafts, ctx) {
    const now = new Date().toISOString();
    const usedIds = new Set((workspaceStore().tagRequests || []).map((r) => String((r && r.id) || '').trim()));
    const batch = workspaceId('tagbatch');
    const created = drafts.map((d) => ({
      id: nextTagReqId(usedIds), at: now, batch, by: ctx.by, byName: ctx.byName,
      employee: ctx.employee, employeeToken: ctx.employeeToken || '', agent: d.agent,
      ...(ctx.source ? { source: ctx.source, ip: ctx.ip } : {}),
      status: 'pending', note: ctx.note || '', adminNote: '',
      rows: d.rows, total: d.total, ...(d.metrics ? { metrics: d.metrics } : {}),
      updatedAt: now, updatedBy: ctx.updatedBy,
      ...(d.dupes && d.dupes.length ? { dupOf: d.dupes.map((x) => x.id), dupCount: d.dupes.length } : {})
    }));
    storeTagRequests(created);
    await persist('notify');
    if (tagSheetConfig().enabled && tagSheetConfig().onSubmit) {
      pushTagRequestsToSheet(created, 'new').then(() => persist('notify').catch(() => {})).catch((err) => {
        console.warn('tag-request sheet sync:', err.message);
        const at = new Date().toISOString();
        created.forEach((r) => { r.sheetSync = { at, event: 'new', error: String(err.message || err).slice(0, 160) }; });
      });
    }
    return {
      batch, created,
      total: created.reduce((s, r) => s + r.total, 0),
      rows: created.reduce((s, r) => s + r.rows.length, 0),
      dupCount: created.filter((r) => r.dupCount).length
    };
  }
  const tagBatchLine = (created) => created.slice(0, 4).map((r) => `${r.agent.name || r.agent.agentId} ${r.total}${r.agent.pincode ? ` (📮${r.agent.pincode})` : ''}`).join(', ') + (created.length > 4 ? ` +${created.length - 4}` : '');

  // ---- 📗 Google Sheet sync (tag requests → connected sheet me direct entry) --------------------
  // Admin config karta hai: kaunsa tab, kaunse columns, kaunsi rows (per class / per agent / per
  // request) aur kab likhna hai (nayi request / status change). Likha Apps Script web app se jaata
  // hai jo target sheet se hi bound hai — isliye entry SEEDHI us Google Sheet me padti hai.
  const TAG_SHEET_FIELDS = {
    event: 'Event', date: 'Date', time: 'Time', requestId: 'Request ID', by: 'By', status: 'Status',
    agentId: 'Agent ID', agent: 'Agent', tl: 'TL', channel: 'Channel', cls: 'Tag Class',
    last: 'Last month', cur: 'Current MTD', growth: 'Growth %', stock: 'Stock', cover: 'Cover (days)',
    priority: 'Priority', sugNet: 'Suggested (stock −)', sugGross: 'Suggested (w/o stock)',
    approved: 'Approved qty', remark: 'Remark', note: 'Note', adminNote: 'Admin note',
    empName: 'Employee', empMobile: 'Employee mobile', empAddress: 'Employee address', empPincode: 'Pincode',
    // v3.30 — delivery ab AGENT ke address par (employee form me agent ka mobile/address/pincode bharta hai)
    agentMobile: 'Agent mobile', agentAddress: 'Agent address', agentPincode: 'Agent pincode', requested: 'Requested qty'
  };
  const tagSheetConfig = () => {
    const w = workspaceStore();
    if (!w.tagRequestSheet || typeof w.tagRequestSheet !== 'object') {
      w.tagRequestSheet = {
        enabled: false, tab: 'Tag Requests', sheetLink: '', spreadsheetId: '', onSubmit: true, onStatus: true,
        rowMode: 'class', columns: ['date', 'time', 'by', 'agentId', 'agent', 'agentMobile', 'agentAddress', 'agentPincode', 'tl', 'channel', 'cls', 'stock', 'cur', 'priority', 'approved', 'remark', 'status']
      };
    }
    // v3.27 — link me sheet ka ID ho to wahi (alag sheet) target banta hai.
    if (w.tagRequestSheet.spreadsheetId === undefined) w.tagRequestSheet.spreadsheetId = sheetIdFromLink(w.tagRequestSheet.sheetLink) || '';
    return w.tagRequestSheet;
  };
  // 📇 Central Agent Address Book — Address tab in the configured request spreadsheet.
  const ADDRESS_BOOK_TAB = 'Address';
  const addressBookRuntime = { at: 0, map: null, promise: null };
  const addressBookKey = (a) => {
    const channel = a && a.channel === 'gv' ? 'gv' : 'ff';
    const id = String((a && (a.agentId || a.id)) || '').trim();
    const name = tagNameKey(a && (a.agentName || a.name));
    return `${channel}|${id ? `id:${id}` : `n:${name}`}`;
  };
  const addressEntryFromRequest = (req) => {
    const a = req && req.agent ? req.agent : {};
    const name = shortText(a.name || a.agentName, 120);
    const agentId = shortText(a.agentId, 40);
    const channel = a.channel === 'gv' ? 'gv' : 'ff';
    const mobile = String(a.mobile || a.phone || '').replace(/[^\\d+]/g, '').slice(0, 16);
    const address = shortText(String(a.address || a.fullAddress || '').replace(/\\s+/g, ' '), 300);
    const pincode = tagDigits(a.pincode || a.pin).slice(0, 6);
    const tl = shortText(a.tl || a.tlName, 120);
    if ((!agentId && name.length < 2) || (!address && !pincode && tagDigits(mobile).length < 10)) return null;
    return { key: addressBookKey({ channel, agentId, agentName: name }), agentId, agent: name, channel, mobile, address, pincode, tl, updatedAt: new Date().toISOString() };
  };
  function addressBookMemoryEntries() {
    const w = workspaceStore();
    if (!w.addressBook || typeof w.addressBook !== 'object') w.addressBook = {};
    return w.addressBook;
  }
  function rememberAddressBook(list) {
    const mem = addressBookMemoryEntries();
    (Array.isArray(list) ? list : []).forEach((e) => {
      if (!e || !e.key) return;
      const old = mem[e.key] || {};
      mem[e.key] = { ...old, ...e, mobile: e.mobile || old.mobile || '', address: e.address || old.address || '', pincode: e.pincode || old.pincode || '', tl: e.tl || old.tl || '', updatedAt: e.updatedAt || old.updatedAt || new Date().toISOString() };
    });
    return mem;
  }
  function fallbackAddressMap() {
    const map = new Map(Object.entries(addressBookMemoryEntries()));
    for (const r of (workspaceStore().tagRequests || []).slice().reverse()) {
      const e = addressEntryFromRequest(r);
      if (e && !map.has(e.key)) map.set(e.key, e);
    }
    return map;
  }
  async function addressBookMap() {
    const now = Date.now();
    if (addressBookRuntime.map && now - addressBookRuntime.at < 10 * 60e3) return addressBookRuntime.map;
    if (addressBookRuntime.promise) return addressBookRuntime.promise;
    const fallback = fallbackAddressMap();
    const store = sheetSyncStore();
    if (!store) { addressBookRuntime.map = fallback; addressBookRuntime.at = now; return fallback; }
    const cfg = tagSheetConfig();
    const targetId = sheetIdFromLink(cfg.sheetLink) || String(cfg.spreadsheetId || '').trim() || '';
    addressBookRuntime.promise = store.call('readaddresses', { tab: ADDRESS_BOOK_TAB, ...(targetId ? { spreadsheetId: targetId } : {}) })
      .then((out) => {
        const map = fallback;
        (out.rows || []).forEach((e) => { if (e && e.key) map.set(String(e.key), e); });
        addressBookRuntime.map = map; addressBookRuntime.at = Date.now(); return map;
      })
      .catch((err) => {
        console.warn('address book read:', err.message);
        addressBookRuntime.map = fallback; addressBookRuntime.at = Date.now(); return fallback;
      })
      .finally(() => { addressBookRuntime.promise = null; });
    return addressBookRuntime.promise;
  }
  async function syncAddressBookToSheet(requests) {
    const entries = (Array.isArray(requests) ? requests : [requests]).map(addressEntryFromRequest).filter(Boolean);
    rememberAddressBook(entries);
    addressBookRuntime.map = null; addressBookRuntime.at = 0;
    const store = sheetSyncStore();
    if (!store || !entries.length) return { ok: true, local: true, synced: false, count: entries.length };
    const cfg = tagSheetConfig();
    const targetId = sheetIdFromLink(cfg.sheetLink) || String(cfg.spreadsheetId || '').trim() || '';
    try {
      const out = await store.call('upsertaddresses', { tab: ADDRESS_BOOK_TAB, rows: entries, ...(targetId ? { spreadsheetId: targetId } : {}) });
      addressBookRuntime.map = null; addressBookRuntime.at = 0;
      return { ok: true, local: true, synced: true, count: entries.length, sheet: out };
    } catch (err) {
      console.warn('address book sync:', err.message);
      return { ok: false, local: true, synced: false, count: entries.length, error: String(err.message || err).slice(0, 180) };
    }
  }
  async function lookupAgentAddress({ agentId, agentName, channel }) {
    const ch = String(channel || '').toLowerCase() === 'gv' ? 'gv' : 'ff';
    const id = String(agentId || '').trim();
    const name = tagNameKey(agentName || '');
    if (!id && !name) return null;
    const map = await addressBookMap();
    const keys = [];
    if (id) keys.push(`${ch}|id:${id}`);
    if (name) keys.push(`${ch}|n:${name}`);
    for (const key of keys) {
      const e = map.get(key);
      if (e && (e.address || e.pincode || e.mobile)) return { mobile: e.mobile || '', address: e.address || '', pincode: e.pincode || '', tl: e.tl || '', source: 'Address' };
    }
    return null;
  }

  /** Apps Script store — storage backend se independent (files backend par bhi sheet sync chale). */
  let tagSheetStore = null;
  function sheetSyncStore() {
    if (tagSheetStore) return tagSheetStore;
    const url = (process.env.APPS_SCRIPT_URL || '').trim(), secret = (process.env.APPS_SCRIPT_SECRET || '').trim();
    if (!url || !secret) return null;
    try { tagSheetStore = new AppsScriptStore({ url, secret }); } catch { tagSheetStore = null; }
    return tagSheetStore;
  }
  const tagSheetFieldValue = (field, x, req, event) => {
    const d = new Date(req.at || Date.now());
    const ch = x.channel === 'gv' ? 'GV Partner' : 'First Forward';
    switch (field) {
      case 'event': return event || '';
      case 'date': return d.toISOString().slice(0, 10);
      case 'time': return d.toISOString().slice(11, 16);
      case 'requestId': return req.id || '';
      case 'by': return req.byName || req.by || '';
      case 'empName': return (req.employee && req.employee.name) || req.byName || '';
      case 'empMobile': return (req.employee && req.employee.mobile) || '';
      case 'empAddress': return (req.employee && req.employee.address) || '';
      case 'empPincode': return (req.employee && req.employee.pincode) || '';
      case 'agentMobile': return (req.agent && req.agent.mobile) || '';
      case 'agentAddress': return (req.agent && req.agent.address) || '';
      case 'agentPincode': return (req.agent && req.agent.pincode) || '';
      case 'requested': return x.requested === undefined || x.requested === null ? Number(x.approved) || 0 : Number(x.requested) || 0;
      case 'status': return req.status || '';
      case 'agentId': return x.agentId || '';
      case 'agent': return x.agentName || '';
      case 'tl': return x.tl || '';
      case 'channel': return ch;
      case 'cls': return x.cls || '';
      case 'last': return Number(x.last) || 0;
      case 'cur': return Number(x.cur) || 0;
      case 'growth': return x.growth === undefined || x.growth === null ? '' : Number(x.growth);
      case 'stock': return Number(x.stock) || 0;
      case 'cover': return x.cover === undefined || x.cover === null ? '' : Number(x.cover);
      case 'priority': return x.priority || '';
      case 'sugNet': return Number(x.sugNet) || 0;
      case 'sugGross': return Number(x.sugGross) || 0;
      case 'approved': return Number(x.approved) || 0;
      case 'remark': return x.remark || '';
      case 'note': return req.note || '';
      case 'adminNote': return req.adminNote || '';
      default: return '';
    }
  };
  /** Request → sheet rows (rowMode ke hisaab se) + header. `event` = new / status / manual. */
  function tagSheetRows(req, cfg, event) {
    const cols = (cfg.columns || []).filter((c) => TAG_SHEET_FIELDS[c]);
    const header = cols.map((c) => TAG_SHEET_FIELDS[c]);
    const rowsIn = Array.isArray(req.rows) ? req.rows : [];
    const mk = (x) => cols.map((c) => tagSheetFieldValue(c, x, req, event));
    let data = [];
    if (cfg.rowMode === 'agent') {
      const byAgent = new Map();
      rowsIn.forEach((x) => {
        const key = `${x.agentId || ''}|${x.agentName || ''}`;
        const a = byAgent.get(key) || { ...x, cls: '', approved: 0, requested: 0 };
        a.cls = [a.cls, x.cls].filter(Boolean).join('+');
        a.approved = (Number(a.approved) || 0) + (Number(x.approved) || 0);
        a.requested = (Number(a.requested) || 0) + (x.requested === undefined || x.requested === null ? Number(x.approved) || 0 : Number(x.requested) || 0);
        byAgent.set(key, a);
      });
      data = [...byAgent.values()].map(mk);
    } else if (cfg.rowMode === 'request') {
      const sum = rowsIn.reduce((s, x) => s + (Number(x.approved) || 0), 0);
      const oneAgent = new Set(rowsIn.map((x) => `${x.agentId || ''}|${x.agentName || ''}`)).size === 1;
      const agg = {
        // v3.30 per-agent request = ek hi agent → uska naam/ID (warna purana "N rows · M agents")
        agentId: oneAgent && rowsIn[0] ? rowsIn[0].agentId || '' : '',
        agentName: oneAgent && rowsIn[0] ? rowsIn[0].agentName || '' : `${rowsIn.length} rows · ${new Set(rowsIn.map((x) => x.agentName)).size} agents`,
        requested: rowsIn.reduce((s, x) => s + (x.requested === undefined || x.requested === null ? Number(x.approved) || 0 : Number(x.requested) || 0), 0),
        tl: [...new Set(rowsIn.map((x) => x.tl).filter(Boolean))].join(', '), channel: rowsIn[0] ? rowsIn[0].channel : 'ff',
        cls: [...new Set(rowsIn.map((x) => x.cls).filter(Boolean))].join(', '),
        last: rowsIn.reduce((s, x) => s + (Number(x.last) || 0), 0), cur: rowsIn.reduce((s, x) => s + (Number(x.cur) || 0), 0),
        stock: rowsIn.reduce((s, x) => s + (Number(x.stock) || 0), 0), cover: null, priority: '',
        sugNet: rowsIn.reduce((s, x) => s + (Number(x.sugNet) || 0), 0), sugGross: rowsIn.reduce((s, x) => s + (Number(x.sugGross) || 0), 0),
        approved: sum, remark: ''
      };
      data = [mk(agg)];
    } else {
      data = rowsIn.map(mk); // 'class' — har agent × class ki alag row (default)
    }
    return { header, rows: data };
  }
  /** Ek ya kai requests (ek submit ka batch) ek hi appendrows call me — rows ka order bana rehta hai aur
   *  Apps Script par kam calls. `throwOnFail` sirf manual/test push ke liye. */
  async function pushTagRequestsToSheet(list, event, throwOnFail) {
    const reqs = (Array.isArray(list) ? list : [list]).filter(Boolean);
    const cfg = tagSheetConfig();
    const store = sheetSyncStore();
    if (!cfg.enabled || !store) {
      if (throwOnFail) throw new HttpError(400, !store ? 'Apps Script connect nahi hai — pehle Settings → Backup me APPS_SCRIPT_URL/SECRET configure karo (ya sheet storage setup).' : 'Sheet sync OFF hai — pehle Tag Request page par 📗 Google Sheet sync ON karo.');
      return null;
    }
    let header = [];
    const rows = [];
    const counts = reqs.map((r) => { const out = tagSheetRows(r, cfg, event); header = out.header; rows.push(...out.rows); return out.rows.length; });
    if (!rows.length) { if (throwOnFail) throw new HttpError(400, 'Sheet ke liye koi row nahi bani.'); return null; }
    const tabName = String(cfg.tab || 'Tag Requests').slice(0, 80) || 'Tag Requests';
    // v3.27 — sheetLink me ID diya ho to entry US ALAG SHEET me jaati hai (Apps Script openById
    // karta hai). Link khaali ho to purana behaviour: script jis sheet se bandha hai usi me.
    const targetId = sheetIdFromLink(cfg.sheetLink) || String(cfg.spreadsheetId || '').trim() || '';
    const out = await store.call('appendrows', { tab: tabName, header, rows, ...(targetId ? { spreadsheetId: targetId } : {}) });
    // Purana Code.gs deploy (v3.25) spreadsheetId ignore karta hai — tab wo chup-chaap APP_STORAGE
    // wali sheet me likh deta. Isliye response ke URL se verify karo ki entry SAHI sheet me gayi.
    if (targetId && out && out.url && !String(out.url).includes(targetId)) {
      const msg = `Entry galat sheet me gayi (${out.spreadsheet || 'Apps Script wali sheet'}) — Render par naya google-apps-script/Code.gs (v3.27) deploy karo, phir dobara bhejo.`;
      const at = new Date().toISOString();
      reqs.forEach((r) => { r.sheetSync = { at, event, error: msg.slice(0, 160), tab: tabName }; });
      if (throwOnFail) throw new HttpError(502, msg);
      throw new Error(msg);
    }
    const at = new Date().toISOString();
    reqs.forEach((r, i) => {
      r.sheetSync = {
        at, event, added: reqs.length === 1 ? (Number(out.added) || counts[i]) : counts[i], tab: out.tab || tabName,
        spreadsheet: out.spreadsheet || '', url: out.url || '', targetId
      };
    });
    return out;
  }
  /** Request ko configured sheet me push karo (single). */
  async function pushTagRequestToSheet(req, event, throwOnFail) {
    return pushTagRequestsToSheet([req], event, throwOnFail);
  }
  if (p === '/api/tag-requests' && method === 'GET') {
    if (user.role !== 'admin' && !(user.permissions || []).includes('tagRequest')) throw new HttpError(403, 'Tag Request access disabled.');
    return sendJson(res, 200, { ok: true, requests: visibleTagRequests(user), admin: user.role === 'admin' });
  }
  if (p === '/api/tag-requests' && method === 'POST') {
    if (user.role !== 'admin' && !(user.permissions || []).includes('tagRequest')) throw new HttpError(403, 'Tag Request access disabled.');
    const body = await readBody(req);
    // 🧑‍🤝‍🧑 v3.30 — naya form: employee + har agent ka block → har agent ki ALAG request (batch).
    if (Array.isArray(body.agents) && body.agents.length) {
      const pcfg = publicTagFormConfig(); // wahi mandatory fields jo employee link par hain (ek jaisa form)
      const drafts = tagAgentDrafts(body.agents, { askMobile: pcfg.askMobile !== false, askAddress: pcfg.askAddress !== false });
      if (!drafts.length) throw new HttpError(400, 'Kam se kam ek agent chahiye (naam + class qty).');
      const emp = body.employee && typeof body.employee === 'object' ? body.employee : {};
      const employee = { name: shortText(emp.name, 80) || user.name || user.username, ...(shortText(emp.office || emp.branch, 80) ? { office: shortText(emp.office || emp.branch, 80) } : {}) };
      drafts.forEach((d) => { d.dupes = tagAgentDupes([{ ...d.agent, rows: d.rows }]); });
      const out = await createTagBatch(drafts, { by: user.username, byName: user.name || user.username, employee, note: shortText(body.note, 300), updatedBy: user.username });
      const n = out.created.length;
      try {
        recordNotification({
          type: 'request', title: `🏷️ Tag request${out.dupCount ? ' 🔁 duplicate' : ''} · ${employee.name}`,
          body: `${n} agent${n > 1 ? 's' : ''} · ${out.total} tags — ${tagBatchLine(out.created)}${body.note ? ` · ${shortText(body.note, 80)}` : ''}`,
          target: 'admin', routeKey: 'tagRequest',
          meta: { requestId: out.created[0].id, requestIds: out.created.map((r) => r.id), batch: out.batch, rows: out.rows, agents: n, total: out.total, duplicates: out.dupCount, username: user.username, link: '#/tagRequest?view=requests' }
        });
        recordNotification({
          type: 'request', title: '✅ Tag request bhej di gayi',
          body: `${n} agent${n > 1 ? 's' : ''} · ${out.total} tags — admin ke paas pahunch gayi. Status Tag Request page par dikhega.`,
          target: `user:${user.username}`, meta: { requestId: out.created[0].id, link: '#/tagRequest?view=requests' }
        });
      } catch { /* notification optional */ }
      logAudit(user, 'tag_request_created', { target: out.batch, note: `${n} agents · ${out.total} tags · ${out.created.map((r) => r.id).join(',')}`.slice(0, 300), ip: clientIp(req) });
      return sendJson(res, 201, { ok: true, request: out.created[0], requests: out.created, batch: { id: out.batch, total: out.total, agents: n, rows: out.rows } });
    }
    const rows = tagRequestRows(body.rows);
    if (!rows.length) throw new HttpError(400, 'Kam se kam ek row chahiye (agent + tag class).');
    const total = rows.reduce((s, r) => s + r.approved, 0);
    if (!total) throw new HttpError(400, 'Approved qty 0 hai — kuch quantity daalo.');
    const now = new Date().toISOString();
    const row = {
      id: nextTagReqId(), at: now, by: user.username, byName: user.name || user.username,
      status: 'pending', note: shortText(body.note, 300), adminNote: '',
      rows, tls: tagRequestTls(body.tls), total, updatedAt: now, updatedBy: user.username
    };
    storeTagRequests([row]);
    await persist('notify');
       rememberAddressBook([addressEntryFromRequest(row)].filter(Boolean));
       await persist('notify').catch(() => {});
       syncAddressBookToSheet([row]).then(() => persist('notify').catch(() => {})).catch(() => {});
    // 📗 Google Sheet sync ON ho to entry direct configured sheet me chali jaati hai (fire & forget —
    // sheet fail hone se request submit kabhi rukti nahi; status drawer me dikh jaata hai).
    if (tagSheetConfig().enabled && tagSheetConfig().onSubmit) {
      pushTagRequestToSheet(row, 'new').then(() => persist('notify').catch(() => {})).catch((err) => {
        console.warn('tag-request sheet sync:', err.message);
        row.sheetSync = { at: new Date().toISOString(), event: 'new', error: String(err.message || err).slice(0, 160) };
      });
    }
    // Admin ko notification (routed: Settings → notification routes se off ho sakta hai) + requester ko confirmation.
    try {
      recordNotification({
        type: 'request', title: `🏷️ Tag request · ${row.byName}`,
        body: `${rows.length} rows · ${new Set(rows.map((r) => r.agentName)).size} agents · ${total} tags${row.note ? ` · ${row.note}` : ''}`,
        target: 'admin', routeKey: 'tagRequest',
        meta: { requestId: row.id, rows: rows.length, total, classes: rows.reduce((a, r) => { a[r.cls] = (a[r.cls] || 0) + r.approved; return a; }, {}), username: user.username, link: '#/tagRequest?view=requests' }
      });
      recordNotification({
        type: 'request', title: '✅ Tag request bhej di gayi',
        body: `${rows.length} rows · ${total} tags — admin ke paas pahunch gayi. Status Tag Request page par dikhega.`,
        target: `user:${user.username}`, meta: { requestId: row.id, link: '#/tagRequest?view=requests' }
      });
    } catch { /* notification optional */ }
    logAudit(user, 'tag_request_created', { target: row.id, note: `${rows.length} rows · ${total} tags`, ip: clientIp(req) });
    return sendJson(res, 201, { ok: true, request: row });
  }
  const tagReqPath = p.match(/^\/api\/tag-requests\/([^/]+)$/);
  if (tagReqPath && method === 'PUT') {
    if (user.role !== 'admin' && !(user.permissions || []).includes('tagRequest')) throw new HttpError(403, 'Tag Request access disabled.');
    const w = workspaceStore();
    const row = (w.tagRequests || []).find((r) => r.id === tagReqPath[1]);
    if (!row) throw new HttpError(404, 'Tag request nahi mili.');
    const owner = row.by === user.username;
    if (user.role !== 'admin' && !(owner && row.status === 'pending')) throw new HttpError(403, 'Sirf admin (ya pending request ka owner) ise update kar sakta hai.');
    const body = await readBody(req);
    // Pehle validate, phir badlo — invalid status par aadhi-adhuri edit memory me na reh jaaye.
    if (body.status !== undefined && !['pending', 'approved', 'dispatched', 'rejected'].includes(body.status)) throw new HttpError(400, 'Status invalid hai.');
    if (body.status !== undefined && body.status !== row.status && user.role !== 'admin') throw new HttpError(403, 'Status sirf admin badal sakta hai.');
    if (body.rows !== undefined) {
      const next = tagRequestRows(body.rows);
      if (next.length) {
        // Admin qty/remark edit karta hai — requester ka original data preserve rehta hai.
        row.rows = row.rows.map((r, i) => ({ ...r, approved: next[i] ? next[i].approved : r.approved, remark: next[i] ? next[i].remark : r.remark }));
        row.total = row.rows.reduce((s, r) => s + (Number(r.approved) || 0), 0);
      }
    }
    // ✏️ v3.30 — table row me hi class-wise edit: { classQty: { VC4: 40, VC5: 10 }, agentKey?, classData? }.
    // Agent ka original maanga hua qty `requested` me safe rehta hai ("50 → 40"); nayi class admin jod
    // sakta hai (classData = us class ka live stock/issuance snapshot). agentKey sirf purani multi-agent
    // request ke liye — us agent ki rows hi badalti hain.
    if (body.classQty && typeof body.classQty === 'object' && !Array.isArray(body.classQty)) {
      const agentKey = shortText(body.agentKey, 200);
      const inScope = (x) => !agentKey || tagAgentKeyOf(x) === agentKey;
      const next = row.rows.map((x) => ({ ...x })); // clone — validation fail ho to asli request na badle
      const tpl = next.find(inScope) || next[0] || {};
      const extra = body.classData && typeof body.classData === 'object' ? body.classData : {};
      for (const [clsRaw, qtyRaw] of Object.entries(body.classQty).slice(0, 16)) {
        const cls = shortText(clsRaw, 12).toUpperCase();
        if (!/^VC\d{1,2}$/.test(cls)) continue;
        const qty = Math.max(0, Math.min(100000, Math.round(Number(qtyRaw) || 0)));
        const hit = next.find((x) => inScope(x) && String(x.cls).toUpperCase() === cls);
        if (hit) {
          if (hit.requested === undefined) hit.requested = Number(hit.approved) || 0;
          hit.approved = qty;
        } else if (qty > 0 && next.length < 150) {
          const d = extra[cls] && typeof extra[cls] === 'object' ? extra[cls] : {};
          const ag = row.agent || {};
          next.push({
            agentId: tpl.agentId || ag.agentId || '', agentName: tpl.agentName || ag.name || '', tl: tpl.tl || ag.tl || '',
            channel: (tpl.channel || ag.channel) === 'gv' ? 'gv' : 'ff', cls,
            last: Number(d.last) || 0, cur: Number(d.cur) || 0, stock: Number(d.stock) || 0, cover: null, priority: '',
            growth: 0, sugNet: 0, sugGross: 0, requested: 0, approved: qty, remark: `admin ne joda (${user.name || user.username})`.slice(0, 160)
          });
        }
      }
      const nextTotal = next.reduce((s, r) => s + (Number(r.approved) || 0), 0);
      if (nextTotal > 100000) throw new HttpError(400, 'Quantity bahut zyada hai — dobara check karo.');
      row.rows = next;
      row.total = nextTotal;
    }
    const prevStatus = row.status;
    if (body.status !== undefined) {
      if (!['pending', 'approved', 'dispatched', 'rejected'].includes(body.status)) throw new HttpError(400, 'Status invalid hai.');
      row.status = body.status;
    }
    if (body.adminNote !== undefined) row.adminNote = shortText(body.adminNote, 300);
    if (body.note !== undefined && row.status === 'pending') row.note = shortText(body.note, 300);
    row.updatedAt = new Date().toISOString(); row.updatedBy = user.username;
    await persist('notify');
    // 📗 Status change (approved/dispatched/rejected) par bhi sheet me fresh entry — config ON ho to.
    if (body.status && body.status !== prevStatus && tagSheetConfig().enabled && tagSheetConfig().onStatus) {
      pushTagRequestToSheet(row, `status:${body.status}`).then(() => persist('notify').catch(() => {})).catch((err) => {
        console.warn('tag-request sheet sync (status):', err.message);
        row.sheetSync = { at: new Date().toISOString(), event: `status:${body.status}`, error: String(err.message || err).slice(0, 160) };
      });
    }
    // Requester ko status update ka notification (admin ne kuch badla to).
    if (user.role === 'admin' && row.by !== user.username) {
      try {
        recordNotification({
          type: 'request', title: `🏷️ Tag request ${body.status ? '· ' + body.status : 'update'}`,
          body: `Aapki request (${row.rows.length} rows · ${row.total} tags) update hui${body.adminNote ? ` — ${row.adminNote}` : ''}.`,
          target: `user:${row.by}`, meta: { requestId: row.id, link: '#/tagRequest?view=requests' }
        });
      } catch { /* optional */ }
    }
    logAudit(user, 'tag_request_updated', { target: row.id, note: `${row.status} · ${row.total} tags`, ip: clientIp(req) });
    return sendJson(res, 200, { ok: true, request: row });
  }
  if (tagReqPath && method === 'DELETE') {
    if (user.role !== 'admin' && !(user.permissions || []).includes('tagRequest')) throw new HttpError(403, 'Tag Request access disabled.');
    const w = workspaceStore();
    const i = (w.tagRequests || []).findIndex((r) => r.id === tagReqPath[1]);
    if (i < 0) throw new HttpError(404, 'Tag request nahi mili.');
    if (user.role !== 'admin' && w.tagRequests[i].by !== user.username) throw new HttpError(403, 'Sirf apni request delete kar sakte ho.');
    w.tagRequests.splice(i, 1);
    await persist('notify');
    logAudit(user, 'tag_request_deleted', { target: tagReqPath[1], ip: clientIp(req) });
    return sendJson(res, 200, { ok: true });
  }

  // ---- 🌐 PUBLIC (bina login) employee Tag Request — v3.27 ---------------------------------------
  // Link: <origin>/tag-request  (ya #/tagRequest?public=1). Employee login/signup ki zaroorat nahi —
  // sirf **naam mandatory**, phir form → system check → submit. Admin ke Tag Request list me yahi
  // request 'public-link' source ke saath aati hai, WhatsApp/notification + Google Sheet sync same.
  const publicTagView = () => {
    const cfg = publicTagFormConfig();
    const sheet = tagSheetConfig();
    return {
      enabled: cfg.enabled !== false,
      showCheck: cfg.showCheck !== false,
      showStock: cfg.showStock !== false,
      askMobile: !!cfg.askMobile,
      askOffice: !!cfg.askOffice,
      askNote: cfg.askNote !== false,
      askAddress: cfg.askAddress !== false,
      maxRows: Math.min(150, Math.max(5, Number(cfg.maxRows) || 60)),
      title: shortText(cfg.title, 120) || 'IDFC Agents Tag Request',
      intro: shortText(cfg.intro, 400),
      brand: db.settings.brand || 'First Forward',
      appName: db.settings.appName || '',
      tagline: db.settings.tagline || 'Dashboard',
      logo: db.settings.logo || '',
      requireEmployeeName: true,
      hasSheetSync: !!sheet.enabled
    };
  };
  // v3.30 — naye format (agent block wali) requests bhi ID se mil jaati hain, chahe login form se bani hon.
  const publicTagFind = (id) => {
    const cleanId = String(id || '').replace(/^#/, '').trim();
    return (workspaceStore().tagRequests || []).find((r) => String(r.id || '') === cleanId && (r.source === 'public-link' || (r.agent && typeof r.agent === 'object')));
  };
  // 🔁 Duplicate detector (v3.27.1) — employee ke naam se 30 din ke andar ki active requests dhoondta hai
  // jisme koi same agent × class row ho. Employee ko submit se pehle warning dikhti hai ("already pending"),
  // aur admin ke notification/request me bhi 🔁 mark ho jaata hai — dobara bhejne par pata rahe.
  const publicTagDupes = (name, rows) => {
    const who = normUser(name);
    if (!who) return [];
    const wanted = new Set();
    (rows || []).forEach((r) => {
      const key = `${String(r && (r.agentId || r.agentName) || '').trim().toLowerCase()}|${String(r && r.cls || '').trim().toUpperCase()}`;
      if (key !== '|') wanted.add(key);
    });
    const nowMs = Date.now();
    const out = [];
    for (const r of (workspaceStore().tagRequests || [])) {
      if (!r || r.source !== 'public-link' || r.by !== `public:${who}`) continue;
      const t = new Date(r.at || r.updatedAt || 0).getTime();
      if (t && nowMs - t > 30 * 24 * 3600e3) continue;                 // 30 din se purani = duplicate nahi
      const status = String(r.status || 'pending').toLowerCase();
      if (status === 'rejected' || status === 'cancelled') continue;    // reject hui request dobara maang sakta hai
      const matched = [];
      for (const x of (r.rows || [])) {
        const key = `${String(x && (x.agentId || x.agentName) || '').trim().toLowerCase()}|${String(x && x.cls || '').trim().toUpperCase()}`;
        if (wanted.has(key) && !matched.includes(key)) matched.push(key);
      }
      if (wanted.size && !matched.length) continue;
      out.push({
        id: r.id, at: r.at || '', status: r.status || 'pending',
        total: Number(r.total) || 0, rows: (r.rows || []).length,
        matched: matched.map((k) => k.split('|').join(' · ')).slice(0, 8)
      });
    }
    return out.slice(-6).reverse();
  };
  if (p === '/api/public/tag-request' && method === 'GET') {
    return sendJson(res, 200, { ok: true, config: publicTagView() });
  }
  if (p === '/api/public/tag-request' && method === 'POST') {
    const cfg = publicTagFormConfig();
    if (cfg.enabled === false) throw new HttpError(403, 'Ye form abhi band hai — apne manager se naya link maango.');
    const body = await readBody(req);
    const emp = body.employee && typeof body.employee === 'object' ? body.employee : body;
    const employeeName = shortText(emp.name || emp.employeeName || body.employeeName, 80);
    if (employeeName.length < 2) throw new HttpError(400, 'Employee name zaroori hai (kam se kam 2 characters).');
    // 🧑‍🤝‍🧑 v3.30 — naya form: upar sirf employee ka naam (office wala), neeche har AGENT ka block
    // (naam · mobile · full address · pincode · class-wise qty). Har agent = alag request (ek batch).
    if (Array.isArray(body.agents) && body.agents.length) {
      const office = shortText(emp.office || emp.branch, 80);
      const drafts = tagAgentDrafts(body.agents, { askMobile: cfg.askMobile !== false, askAddress: cfg.askAddress !== false });
      if (!drafts.length) throw new HttpError(400, 'Kam se kam ek agent chahiye (naam + mobile + class qty).');
      const maxRows = Math.min(150, Math.max(5, Number(cfg.maxRows) || 60));
      const rowCount = drafts.reduce((s, d) => s + d.rows.length, 0);
      if (rowCount > maxRows) throw new HttpError(400, `Ek baar me max ${maxRows} class-rows allowed hain — kuch agents agli request me bhejo.`);
      const grand = drafts.reduce((s, d) => s + d.total, 0);
      if (grand > 100000) throw new HttpError(400, 'Quantity bahut zyada hai — dobara check karo.');
      const ip = clientIp(req);
      if (!publicRateOk(`tag:${ip}`, 15, 60 * 60e3)) throw new HttpError(429, 'Is device se bahut requests aa gayi hain — kuch der baad try karo.');
      drafts.forEach((d) => { d.dupes = tagAgentDupes([{ ...d.agent, rows: d.rows }]); });
      const note = shortText(body.note, 300);
      const employeeToken = publicEmployeeToken(body.employeeToken);
      const out = await createTagBatch(drafts, {
        by: `public:${normUser(employeeName) || 'employee'}`, byName: employeeName,
        employee: { name: employeeName, ...(office ? { office } : {}) }, employeeToken,
        source: 'public-link', ip: String(ip || '').slice(0, 45), note, updatedBy: 'public-link'
      });
      const n = out.created.length;
      const dupIds = [...new Set(out.created.flatMap((r) => r.dupOf || []))];
      try {
        recordNotification({
          type: 'request', title: `🏷️ Tag request (employee link)${out.dupCount ? ' 🔁 duplicate' : ''} · ${employeeName}`,
          body: `${n} agent${n > 1 ? 's' : ''} · ${out.total} tags — ${tagBatchLine(out.created)}${office ? ` · ${office}` : ''}${note ? ` · ${note.slice(0, 80)}` : ''}${out.dupCount ? ` · 🔁 ${out.dupCount} agent ki request pehle se active (${dupIds.slice(0, 3).join(', ')})` : ''}`,
          target: 'admin', routeKey: 'tagRequest',
          meta: { requestId: out.created[0].id, requestIds: out.created.map((r) => r.id), batch: out.batch, rows: out.rows, agents: n, total: out.total, publicLink: true, note, duplicates: out.dupCount, dupOf: dupIds, link: '#/tagRequest?view=requests' }
        });
      } catch { /* notification optional */ }
      logAudit({ username: 'public-link', role: 'public', name: employeeName }, 'tag_request_public_created', {
        target: out.batch, note: `${n} agents · ${out.total} tags · ${employeeName} · ${out.created.map((r) => `${r.id}${r.agent.mobile ? ` 📱${r.agent.mobile}` : ''}`).join(', ')}${out.dupCount ? ` · 🔁 ${dupIds.join(',')}` : ''}`.slice(0, 400), ip
      });
      const dupReqs = out.created.filter((r) => r.dupCount);
      return sendJson(res, 201, {
        ok: true,
        batch: { id: out.batch, total: out.total, agents: n, rows: out.rows },
         employeeToken,
        request: tagBatchSummary(out.created[0]),
        requests: out.created.map(tagBatchSummary),
        warnings: dupReqs.length ? [{
          code: 'duplicate', count: dupReqs.length,
          message: `${dupReqs.length} agent ki request pehle se active hai (same agent + class) — admin ko 🔁 mark ke saath dikhegi.`,
          requests: dupIds.map((id) => ({ id }))
        }] : []
      });
    }
    const mobile = String(emp.mobile || emp.phone || '').replace(/[^\d+]/g, '').slice(0, 16);
    const office = shortText(emp.office || emp.branch, 80);
    // 🏠 address + 📮 pincode — employee link par mandatory (admin chahe to Settings se band kar sakta hai).
    const address = shortText(emp.address || emp.fullAddress || body.address, 300);
    const pincode = String(emp.pincode || emp.pin || body.pincode || '').replace(/[^\d]/g, '').slice(0, 6);
    const city = shortText(emp.city, 60);
    if (cfg.askMobile !== false && String(mobile).replace(/\D/g, '').length < 10) throw new HttpError(400, 'Mobile number zaroori hai (10 digit).');
    if (cfg.askAddress !== false) {
      if (address.replace(/\s+/g, ' ').trim().length < 8) throw new HttpError(400, 'Full address zaroori hai (kam se kam 8 characters — house/street/area).');
      if (!/^\d{6}$/.test(pincode)) throw new HttpError(400, 'Pincode zaroori hai (6 digit).');
    }
    const rows = tagRequestRows(body.rows);
    if (!rows.length) throw new HttpError(400, 'Kam se kam ek row chahiye (agent + tag class + qty).');
    if (rows.length > Math.min(150, Math.max(5, Number(cfg.maxRows) || 60))) throw new HttpError(400, `Ek request me max ${Math.min(150, Math.max(5, Number(cfg.maxRows) || 60))} rows allowed hain.`);
    const total = rows.reduce((s, x) => s + x.approved, 0);
    if (!total) throw new HttpError(400, 'Quantity 0 hai — kisi class me qty daalo.');
    if (total > 100000) throw new HttpError(400, 'Quantity bahut zyada hai — dobara check karo.');
    const ip = clientIp(req);
    if (!publicRateOk(`tag:${ip}`, 15, 60 * 60e3)) throw new HttpError(429, 'Is device se bahut requests aa gayi hain — kuch der baad try karo.');
    // 🔁 Duplicate: same employee ki active request me same agent × class pehle se hai?
    const dupes = publicTagDupes(employeeName, rows);
    const employeeToken = publicEmployeeToken(body.employeeToken);
    const now = new Date().toISOString();
    const row = {
      id: nextTagReqId(), at: now,
      by: `public:${normUser(employeeName) || 'employee'}`, byName: employeeName,
      employee: { name: employeeName, mobile, office, address, pincode, ...(city ? { city } : {}) },
       employeeToken,
      source: 'public-link', ip: String(ip || '').slice(0, 45),
      status: 'pending', note: shortText(body.note, 300), adminNote: '',
      rows, tls: tagRequestTls(body.tls), total, updatedAt: now, updatedBy: 'public-link',
      ...(dupes.length ? { dupOf: dupes.map((d) => d.id), dupCount: dupes.length } : {})
    };
    storeTagRequests([row]);
    await persist('notify');
       rememberAddressBook([addressEntryFromRequest(row)].filter(Boolean));
       await persist('notify').catch(() => {});
       syncAddressBookToSheet([row]).then(() => persist('notify').catch(() => {})).catch(() => {});
    // 📗 Sheet sync ON ho to public request bhi seedha usi Google Sheet me entry banati hai.
    if (tagSheetConfig().enabled && tagSheetConfig().onSubmit) {
      pushTagRequestToSheet(row, 'new').then(() => persist('notify').catch(() => {})).catch((err) => {
        console.warn('public tag-request sheet sync:', err.message);
        row.sheetSync = { at: new Date().toISOString(), event: 'new', error: String(err.message || err).slice(0, 160) };
      });
    }
    try {
      recordNotification({
        type: 'request', title: `🏷️ Tag request (employee link)${dupes.length ? ' 🔁 duplicate' : ''} · ${employeeName}`,
        body: `${rows.length} rows · ${new Set(rows.map((r) => r.agentName)).size} agents · ${total} tags${office ? ` · ${office}` : ''}${mobile ? ` · 📱 ${mobile}` : ''}${pincode ? ` · 📮 ${pincode}` : ''}${address ? ` · 🏠 ${address.slice(0, 60)}${address.length > 60 ? '…' : ''}` : ''}${dupes.length ? ` · 🔁 pehle se ${dupes.length} active request (${dupes.map((d) => d.id).join(', ')})` : ''}`,
        target: 'admin', routeKey: 'tagRequest',
        meta: { requestId: row.id, rows: rows.length, total, publicLink: true, note: row.note, duplicates: dupes.length, dupOf: dupes.map((d) => d.id), link: '#/tagRequest?view=requests' }
      });
    } catch { /* notification optional */ }
    logAudit({ username: 'public-link', role: 'public', name: employeeName }, 'tag_request_public_created', { target: row.id, note: `${rows.length} rows · ${total} tags · ${employeeName}${mobile ? ` · ${mobile}` : ''}${pincode ? ` · 📮${pincode}` : ''}${dupes.length ? ` · 🔁 duplicate of ${dupes.map((d) => d.id).join(',')}` : ''}`, ip });
    return sendJson(res, 201, {
      ok: true,
      request: {
        id: row.id, at: row.at, status: row.status, total: row.total, rows: rows.length,
        byName: employeeName, sheetSync: !!row.sheetSync, duplicates: dupes.length, employeeToken
      },
      warnings: dupes.length ? [{
        code: 'duplicate', count: dupes.length,
        message: `Aapke naam se ${dupes.length} request already active hai (same agent + class) — admin ko 🔁 mark ke saath dikhegi.`,
        requests: dupes.map((d) => ({ id: d.id, status: d.status, at: d.at, total: d.total, matched: d.matched }))
      }] : []
    });
  }
  // 🔁 Public duplicate check — form submit se PEHLE employee ko warning dikhane ke liye.
  if (p === '/api/public/tag-request/check' && method === 'POST') {
    const body = await readBody(req);
    const emp = body.employee && typeof body.employee === 'object' ? body.employee : body;
    const employeeName = shortText(emp.name || emp.employeeName || body.name, 80);
    // v3.30 — naya form: agent-wise (kisi bhi employee ne wahi agent + class daala ho to warning).
    if (Array.isArray(body.agents) && body.agents.length) {
      const ip = clientIp(req);
      if (!publicRateOk(`tagcheck:${ip}`, 90, 10 * 60e3)) throw new HttpError(429, 'Bahut zyada checks — thodi der baad try karo.');
      return sendJson(res, 200, { ok: true, mode: 'agent', name: employeeName, checked: Math.min(40, body.agents.length), duplicates: tagAgentDupes(body.agents) });
    }
    if (employeeName.length < 2) throw new HttpError(400, 'Naam likho (kam se kam 2 characters) — phir purani request check karenge.');
    const ip = clientIp(req);
    if (!publicRateOk(`tagcheck:${ip}`, 90, 10 * 60e3)) throw new HttpError(429, 'Bahut zyada checks — thodi der baad try karo.');
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 150) : [];
    const dupes = publicTagDupes(employeeName, rows);
    return sendJson(res, 200, { ok: true, name: employeeName, checked: rows.length, duplicates: dupes });
  }
  // 👤 Employee link identity — device par save hone wala private token.
  function publicEmployeeToken(raw) {
    const v = String(raw || '').trim();
    return /^[A-Za-z0-9_-]{24,120}$/.test(v) ? v.slice(0, 120) : crypto.randomBytes(24).toString('base64url');
  }
  function employeeStatusByToken(token) {
    const key = String(token || '').trim();
    return key ? (workspaceStore().tagRequests || []).filter((r) => r && r.source === 'public-link' && r.employeeToken === key) : [];
  }
  function employeeStatusSummary(token) {
    const rows = employeeStatusByToken(token), counts = { all: rows.length, pending: 0, approved: 0, dispatched: 0, rejected: 0 };
    let requestedTags = 0, approvedTags = 0;
    rows.forEach((r) => { const st = String(r.status || 'pending').toLowerCase(); if (counts[st] !== undefined) counts[st]++; requestedTags += (r.rows || []).reduce((n, x) => n + (Number(x.requested ?? x.approved) || 0), 0); approvedTags += (r.rows || []).reduce((n, x) => n + (Number(x.approved) || 0), 0); });
    return { totalRequests:counts.all, pending:counts.pending, approved:counts.approved, dispatched:counts.dispatched, rejected:counts.rejected, requestedTags, approvedTags,
      requests:rows.slice(-100).reverse().map((r) => ({ id:r.id, at:r.at, status:r.status, total:r.total, rows:(r.rows||[]).length, agentName:(r.agent&&r.agent.name)||'', agentId:(r.agent&&r.agent.agentId)||'', classes:(r.rows||[]).map(x=>({cls:x.cls,requested:x.requested,approved:x.approved})) })) };
  }
  if (p === '/api/public/tag-request/employee-status' && method === 'GET') {
    const token = String(url.searchParams.get('token') || '').trim();
    if (!/^[A-Za-z0-9_-]{24,120}$/.test(token)) throw new HttpError(400, 'Employee status token missing hai.');
    const ip = clientIp(req); if (!publicRateOk(`tagemp:${ip}`, 60, 10 * 60e3)) throw new HttpError(429, 'Bahut zyada status checks — thodi der baad try karo.');
    return sendJson(res, 200, { ok:true, ...employeeStatusSummary(token) });
  }
  // 📇 Agent contact lookup — central Address tab, exact-agent match only.
  if (p === '/api/tag-request/contact' && method === 'GET') {
    if (!user || (user.role !== 'admin' && !(user.permissions || []).includes('tagRequest'))) throw new HttpError(403, 'Tag Request access disabled.');
    const ip = clientIp(req);
    if (!publicRateOk(`tagcontact:${user.username}:${ip}`, 120, 10 * 60e3)) throw new HttpError(429, 'Bahut zyada contact lookups — thodi der baad try karo.');
    const agentId = shortText(url.searchParams.get('agentId') || '', 40);
    const agentName = shortText(url.searchParams.get('agentName') || '', 120);
    const channel = String(url.searchParams.get('channel') || '').toLowerCase() === 'gv' ? 'gv' : 'ff';
    if (!agentId && !agentName) return sendJson(res, 200, { ok:true, found:false });
    const contact = await lookupAgentAddress({ agentId, agentName, channel });
    return sendJson(res, 200, { ok:true, found:!!contact, contact:contact || null });
  }
  if (p === '/api/public/tag-request/contact' && method === 'GET') {
    const ip = clientIp(req);
    if (!publicRateOk(`tagcontact:${ip}`, 120, 10 * 60e3)) throw new HttpError(429, 'Bahut zyada contact lookups — thodi der baad try karo.');
    const agentId = shortText(url.searchParams.get('agentId') || '', 40);
    const agentName = shortText(url.searchParams.get('agentName') || '', 120);
    const channel = String(url.searchParams.get('channel') || '').toLowerCase() === 'gv' ? 'gv' : 'ff';
    if (!agentId && !agentName) return sendJson(res, 200, { ok:true, found:false });
    const contact = await lookupAgentAddress({ agentId, agentName, channel });
    return sendJson(res, 200, { ok:true, found:!!contact, contact:contact || null });
  }
  if (p === '/api/public/tag-request/status' && method === 'GET') {
    // 📱 v3.30 — agent ke mobile number se saari requests (jo request lagate waqt diya tha). Minimum
    // fields hi jaate hain (status · classes · qty · admin note) — address / IP kabhi nahi.
    const mobileRaw = String(url.searchParams.get('mobile') || '').trim();
    if (mobileRaw) {
      const m = tagDigits(mobileRaw);
      if (m.length < 10 || m.length > 13) throw new HttpError(400, 'Agent ka 10 digit mobile number daalo (jo request lagate waqt diya tha).');
      const ip = clientIp(req);
      if (!publicRateOk(`tagstatus:${ip}`, 60, 10 * 60e3)) throw new HttpError(429, 'Bahut zyada search — thodi der baad try karo.');
      const last10 = m.slice(-10);
      const list = (workspaceStore().tagRequests || []).filter((r) => {
        if (!r) return false;
        const am = tagDigits(r.agent && r.agent.mobile).slice(-10);
        if (am) return am === last10;
        return r.source === 'public-link' && tagDigits(r.employee && r.employee.mobile).slice(-10) === last10; // purani (v3.27) requests
      }).slice(-25).reverse().map(tagStatusView);
      return sendJson(res, 200, { ok: true, mobile: `••••••${last10.slice(-4)}`, count: list.length, requests: list });
    }
    const id = shortText(url.searchParams.get('id'), 60);
    if (!id) throw new HttpError(400, 'Agent ka mobile number ya Request ID daalo.');
    const row = publicTagFind(id);
    if (!row) throw new HttpError(404, 'Is ID ki koi request nahi mili — ID check karo.');
    const view = tagStatusView(row);
    return sendJson(res, 200, {
      ok: true,
      request: {
        id: row.id, at: row.at, status: row.status, total: row.total, byName: row.byName,
        rows: (row.rows || []).length, agents: new Set((row.rows || []).map((x) => x.agentName)).size,
        adminNote: row.adminNote || '', note: row.note || '',
        employee: row.employee ? { name: row.employee.name || '', mobile: row.employee.mobile || '', address: row.employee.address || '', pincode: row.employee.pincode || '' } : null,
        agentName: view.agentName, agentId: view.agentId, classes: view.classes, batch: view.batch,
        sheetSynced: !!row.sheetSync && !row.sheetSync.error,
        updatedAt: row.updatedAt || row.at
      }
    });
  }
  // 🔐 Public Personal Link Auth Verification — credentials must be configured by an admin.
  // A successful check creates an HttpOnly server-side session; the page never trusts DOM hiding.
  if (p === '/api/public/personal-link/verify' && method === 'POST') {
    const ip = clientIp(req);
    if (!publicRateOk(`plauth:${ip}`, 40, 10 * 60e3)) throw new HttpError(429, 'Bahut zyada attempts — thodi der baad try karo.');
    const body = await readBody(req);
    const token = String(body.token || '').trim();
    const rawId = String(body.personId || '').trim();
    const rawMob = String(body.mobile || '').replace(/\D/g, '').slice(-10);
    const savedLink = (Array.isArray(db.settings.personalLinks) ? db.settings.personalLinks : []).find((l) => l.token === token);
    if (!savedLink || savedLink.enabled === false) throw new HttpError(404, 'Link invalid ya band hai.');
    const cfgId = String(savedLink.personId || '').trim();
    const cfgMob = String(savedLink.mobile || '').replace(/\D/g, '').slice(-10);
    if (cfgId.length < 2 || cfgMob.length !== 10) throw new HttpError(409, 'Admin ne is link ke liye ID aur registered 10-digit mobile abhi configure nahi kiya hai.');
    if (rawId.length < 2) throw new HttpError(400, `${savedLink.kind === 'tl' ? 'TL ID' : 'Agent ID'} daalo.`);
    if (rawMob.length !== 10) throw new HttpError(400, '10 digit mobile number daalo.');

    // Exact normalized ID + exact registered mobile; no name-as-ID or partial-ID fallback.
    const normId = (s) => String(s || '').trim().toUpperCase().replace(/[\s#-]+/g, '');
    if (normId(cfgId) !== normId(rawId)) throw new HttpError(403, `${savedLink.kind === 'tl' ? 'TL ID' : 'Agent ID'} match nahi hua — sahi ID daalo.`);
    if (cfgMob !== rawMob) throw new HttpError(403, 'Mobile number match nahi hua — registered 10-digit mobile number daalo.');

    const session = createPersonalLinkSession(req, savedLink);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': session.cookie, 'Cache-Control': 'no-store' });
  }
  if (p === '/api/public/personal-link/logout' && method === 'POST') {
    const body = await readBody(req);
    const token = String(body.token || '').trim();
    const savedLink = (Array.isArray(db.settings.personalLinks) ? db.settings.personalLinks : []).find((l) => l.token === token);
    if (savedLink) {
      const value = parseCookies(req)[personalLinkCookieName(savedLink.token)];
      if (value) personalLinkSessions.delete(sha(value));
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearPersonalLinkCookie(req, savedLink), 'Cache-Control': 'no-store' });
    }
    return sendJson(res, 200, { ok: true });
  }
  // 🌐 Public form config (admin) — link ON/OFF + kaunse fields dikhein.
  if (p === '/api/public-tag-form' && method === 'PUT') {
    requireAdmin(user);
    const body = await readBody(req);
    const c = body.config || body;
    const cfg = publicTagFormConfig();
    if (c.enabled !== undefined) cfg.enabled = !!c.enabled;
    if (c.showCheck !== undefined) cfg.showCheck = !!c.showCheck;
    if (c.showStock !== undefined) cfg.showStock = !!c.showStock;
    if (c.askMobile !== undefined) cfg.askMobile = !!c.askMobile;
    if (c.askOffice !== undefined) cfg.askOffice = !!c.askOffice;
    if (c.askNote !== undefined) cfg.askNote = !!c.askNote;
    if (c.askAddress !== undefined) cfg.askAddress = !!c.askAddress;
    if (c.title !== undefined) cfg.title = shortText(c.title, 120);
    if (c.intro !== undefined) cfg.intro = shortText(c.intro, 400);
    if (c.maxRows !== undefined) cfg.maxRows = Math.min(150, Math.max(5, Number(c.maxRows) || 60));
    cfg.updatedAt = new Date().toISOString(); cfg.updatedBy = user.username;
    await persist('notify');
    logAudit(user, 'public_tag_form_config', { note: `enabled ${cfg.enabled} · check ${cfg.showCheck}`, ip: clientIp(req) });
    return sendJson(res, 200, { ok: true, config: publicTagView() });
  }

  // ---- 📗 Tag Request → Google Sheet sync (admin config + test + manual push) --------------------
  if (p === '/api/tag-request-sheet' && method === 'GET') {
    requireAdmin(user);
    const cfg = tagSheetConfig();
    return sendJson(res, 200, {
      ok: true, config: cfg, fields: TAG_SHEET_FIELDS,
      connected: !!sheetSyncStore(), storageBackend: STORAGE_BACKEND,
      publicForm: publicTagView(), publicPath: '/tag-request', targetId: sheetIdFromLink(cfg.sheetLink) || cfg.spreadsheetId || '',
      hint: sheetSyncStore() ? '' : 'APPS_SCRIPT_URL + APPS_SCRIPT_SECRET (Render → Environment) configure karo — Apps Script se hi sheet me entry hoti hai. Setup: STORAGE_SETUP.md / Settings → Backup.'
    });
  }
  if (p === '/api/tag-request-sheet' && method === 'PUT') {
    requireAdmin(user);
    const body = await readBody(req);
    const cfg = tagSheetConfig();
    const c = body.config || body;
    if (c.enabled !== undefined) cfg.enabled = !!c.enabled;
    if (c.tab !== undefined) cfg.tab = String(c.tab || '').trim().slice(0, 80) || 'Tag Requests';
    if (c.sheetLink !== undefined) {
      cfg.sheetLink = String(c.sheetLink || '').trim().slice(0, 500);
      if (!cfg.sheetLink) cfg.spreadsheetId = '';
      else {
        const id = sheetIdFromLink(cfg.sheetLink);
        if (!id) throw new HttpError(400, 'Sheet link samajh nahi aaya — poora link (https://docs.google.com/spreadsheets/d/…) ya sheet ID paste karo.');
        cfg.spreadsheetId = id;
      }
    }
    if (typeof c.spreadsheetId === 'string') cfg.spreadsheetId = sheetIdFromLink(c.spreadsheetId);
    if (c.onSubmit !== undefined) cfg.onSubmit = !!c.onSubmit;
    if (c.onStatus !== undefined) cfg.onStatus = !!c.onStatus;
    if (c.rowMode !== undefined && ['class', 'agent', 'request'].includes(c.rowMode)) cfg.rowMode = c.rowMode;
    if (Array.isArray(c.columns)) {
      const cols = c.columns.map((x) => String(x)).filter((x) => TAG_SHEET_FIELDS[x]);
      if (cols.length) cfg.columns = [...new Set(cols)];
    }
    if (c.publicForm && typeof c.publicForm === 'object') {
      const pcfg = publicTagFormConfig();
      const pc = c.publicForm;
      if (pc.enabled !== undefined) pcfg.enabled = !!pc.enabled;
      if (pc.showCheck !== undefined) pcfg.showCheck = !!pc.showCheck;
      if (pc.showStock !== undefined) pcfg.showStock = !!pc.showStock;
      if (pc.askMobile !== undefined) pcfg.askMobile = !!pc.askMobile;
      if (pc.askOffice !== undefined) pcfg.askOffice = !!pc.askOffice;
      if (pc.askNote !== undefined) pcfg.askNote = !!pc.askNote;
      if (pc.title !== undefined) pcfg.title = shortText(pc.title, 120);
      if (pc.intro !== undefined) pcfg.intro = shortText(pc.intro, 400);
      if (pc.maxRows !== undefined) pcfg.maxRows = Math.min(150, Math.max(5, Number(pc.maxRows) || 60));
    }
    cfg.updatedAt = new Date().toISOString(); cfg.updatedBy = user.username;
    await persist('notify');
    logAudit(user, 'tag_sheet_config', { note: `enabled ${cfg.enabled} · tab ${cfg.tab} · target ${cfg.spreadsheetId || 'script-sheet'} · ${cfg.columns.length} cols · ${cfg.rowMode}`, ip: clientIp(req) });
    return sendJson(res, 200, { ok: true, config: cfg, connected: !!sheetSyncStore(), publicForm: publicTagView(), targetId: cfg.spreadsheetId || '' });
  }
  if (p === '/api/tag-request-sheet/test' && method === 'POST') {
    requireAdmin(user);
    const store = sheetSyncStore();
    if (!store) throw new HttpError(400, 'Apps Script connect nahi hai — Render me APPS_SCRIPT_URL + APPS_SCRIPT_SECRET set karo (Storage setup guide: STORAGE_SETUP.md).');
    const body = await readBody(req);
    const cfg = tagSheetConfig();
    const link = body.sheetLink !== undefined ? String(body.sheetLink || '').trim() : cfg.sheetLink;
    const targetId = sheetIdFromLink(link) || (body.spreadsheetId ? sheetIdFromLink(body.spreadsheetId) : '') || cfg.spreadsheetId || '';
    const tab = String(body.tab || cfg.tab || 'Tag Requests').trim().slice(0, 80) || 'Tag Requests';
    if (link && !targetId) throw new HttpError(400, 'Sheet link samajh nahi aaya — poora Google Sheet link ya sheet ID paste karo.');
    // 1) Script zinda hai? (ping)  → 2) target sheet + tab reachable hai? ('sheettest' action)
    let ping;
    try { ping = await store.call('ping'); }
    catch (err) { throw new HttpError(502, `Apps Script ping fail: ${err.message}`); }
    let target = null, codeVersion = 'v3.25';
    try {
      const out = await store.call('sheettest', { spreadsheetId: targetId, tab });
      target = out;
      codeVersion = 'v3.27';
    } catch (err) {
      if (!/unknown action/i.test(String(err.message))) throw new HttpError(502, `Sheet check fail: ${err.message}`);
    }
    const notes = [];
    if (!target) notes.push('Apps Script me purana Code.gs deploy hai — alag sheet me entry ke liye naya google-apps-script/Code.gs (v3.27) paste karke "New version" deploy karo.');
    else if (targetId && target.spreadsheetId && target.spreadsheetId !== targetId) notes.push('Apps Script ne kisi doosri sheet ka jawab diya — sheet ka ID check karo.');
    if (target && targetId && !target.exists) notes.push(`Target sheet me "${tab}" tab abhi nahi hai — pehli entry par apne aap ban jayega.`);
    if (targetId) notes.push('Dhyan rakho: us sheet par Apps Script wale Google account ka edit access hona chahiye (Sheet → Share).');
    return sendJson(res, 200, {
      ok: true, connected: true, codeVersion,
      tab: target ? target.tab || tab : (ping.tab || 'APP_STORAGE'),
      spreadsheet: target ? target.spreadsheet || '' : (ping.spreadsheet || ''),
      url: target ? target.url || '' : (ping.url || ''),
      targetSpreadsheetId: targetId, targetExists: target ? !!target.exists : null,
      note: notes.join(' ')
    });
  }
  if (p === '/api/tag-request-sheet/push' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    const w = workspaceStore();
    const row = (w.tagRequests || []).find((r) => r.id === String(body.id || ''));
    if (!row) throw new HttpError(404, 'Tag request nahi mili.');
    const out = await pushTagRequestToSheet(row, body.event === 'status' ? `status:${row.status}` : 'manual', true);
    await persist('notify');
    logAudit(user, 'tag_sheet_push', { target: row.id, note: `${out.added} rows → ${out.tab || ''}`, ip: clientIp(req) });
    return sendJson(res, 200, { ok: true, added: out.added, tab: out.tab, atRow: out.atRow, url: out.url || '' });
  }

  // ---- 🎙️ LIVE ASSIST (v3.26) — admin user ki awaaz/video live sun/dekh sakta hai ---------------
  // TRANSPARENCY BY DESIGN: ye feature SIRF user ki haan ke baad chalta hai —
  //   1. user ko full-screen consent popup dikhta hai (Allow / Decline, 60s timeout),
  //   2. accept karne par hi mic/camera khulta hai,
  //   3. session ke dauran user ki screen par hamesha 🔴 LIVE pill dikhta hai (End button ke saath),
  //   4. har request/accept/end audit log me darj hota hai.
  // Media WebRTC se seedha browser↔browser jaata hai; server sirf signalling (SDP/ICE) relay karta
  // hai aur sessions durable store me rakhta hai (notify kind — koi naya storage kind nahi).
  const LIVE_ASSIST_REQUEST_TTL = 60e3;      // 60s me accept nahi → missed
  const LIVE_ASSIST_MAX_ACTIVE = 60 * 60e3;  // ek session max 1 ghanta
  const liveAssistStore = () => {
    const w = workspaceStore();
    if (!w.liveAssist || typeof w.liveAssist !== 'object') w.liveAssist = { sessions: [] };
    if (!Array.isArray(w.liveAssist.sessions)) w.liveAssist.sessions = [];
    return w.liveAssist;
  };
  const laIceServers = () => {
    // Optional: LIVE_ASSIST_ICE_JSON env me extra STUN/TURN servers (JSON array) — strict NAT me TURN chahiye.
    try {
      const extra = process.env.LIVE_ASSIST_ICE_JSON;
      if (extra) { const arr = JSON.parse(extra); if (Array.isArray(arr) && arr.length) return arr.slice(0, 5); }
    } catch { /* env optional */ }
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  };
  const laPrune = () => {
    const st = liveAssistStore();
    const now = Date.now();
    for (const s of st.sessions) {
      if (s.status === 'requested' && now - new Date(s.requestedAt).getTime() > LIVE_ASSIST_REQUEST_TTL) {
        s.status = 'missed'; s.endedAt = new Date().toISOString(); s.reason = 'timeout';
      } else if (s.status === 'active' && now - new Date(s.acceptedAt || s.requestedAt).getTime() > LIVE_ASSIST_MAX_ACTIVE) {
        s.status = 'ended'; s.endedAt = new Date().toISOString(); s.reason = 'max-time';
      }
    }
    if (st.sessions.length > 120) st.sessions.splice(0, st.sessions.length - 120);
  };
  const laView = (s) => ({
    id: s.id, admin: s.admin, adminName: s.adminName || s.admin, user: s.user, userName: s.userName || s.user,
    mode: s.mode === 'video' ? 'video' : 'audio', status: s.status,
    requestedAt: s.requestedAt, acceptedAt: s.acceptedAt || null, endedAt: s.endedAt || null,
    reason: s.reason || '', ice: laIceServers()
  });
  const laFind = (id) => liveAssistStore().sessions.find((s) => s.id === id);
  const laParty = (s, user) => (s.user === user.username ? 'user' : (user.role === 'admin' ? 'admin' : null));
  // Signals bahut tezi se aate hain (ICE) — har signal par full sheet save mat karo; 5s throttle.
  let laLastPersist = 0;
  const laPersistSoon = () => {
    if (Date.now() - laLastPersist < 5000) return;
    laLastPersist = Date.now();
    persist('notify').catch(() => {});
  };
  if (p === '/api/live-assist' && method === 'GET') {
    requireAdmin(user);
    laPrune();
    return sendJson(res, 200, { ok: true, sessions: liveAssistStore().sessions.slice(-50).reverse().map(laView) });
  }
  if (p === '/api/live-assist/request' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    const username = normUser(body.user);
    const target = findUser(username);
    if (!target) throw new HttpError(404, 'User nahi mila.');
    const mode = body.mode === 'video' ? 'video' : 'audio';
    laPrune();
    const st = liveAssistStore();
    const existing = st.sessions.find((s) => s.user === username && (s.status === 'requested' || s.status === 'active'));
    if (existing) return sendJson(res, 200, { ok: true, existing: true, session: laView(existing) });
    const s = {
      id: workspaceId('assist'), admin: user.username, adminName: user.name || user.username,
      user: username, userName: target.name || username, mode, status: 'requested',
      requestedAt: new Date().toISOString(), signals: [], seq: 0
    };
    st.sessions.push(s);
    await persist('notify');
    try {
      recordNotification({
        type: 'assist', title: `🎙️ Live Assist request · ${s.adminName}`,
        body: `Admin aapse live baat karna chahte hain — sirf aapki ${mode === 'video' ? 'awaaz + camera' : 'awaaz'} jayegi, aur sirf aap Allow karoge tabhi. Screen par request khuli hogi.`,
        target: `user:${username}`, meta: { sessionId: s.id, mode }
      });
    } catch { /* notification optional */ }
    logAudit(user, 'live_assist_request', { target: username, note: mode, ip: clientIp(req) });
    return sendJson(res, 201, { ok: true, session: laView(s) });
  }
  if (p === '/api/live-assist/inbox' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    laPrune();
    const mine = liveAssistStore().sessions.filter((s) => s.user === user.username && (s.status === 'requested' || s.status === 'active'));
    return sendJson(res, 200, { ok: true, sessions: mine.map(laView) });
  }
  const laSigPath = p.match(/^\/api\/live-assist\/([^/]+)\/signal$/);
  if (laSigPath && method === 'POST') {
    if (!user) throw new HttpError(401, 'Login required');
    const s = laFind(laSigPath[1]);
    if (!s) throw new HttpError(404, 'Session nahi mila.');
    const side = laParty(s, user);
    if (!side) throw new HttpError(403, 'Is session ke hissa nahi ho.');
    if (s.status !== 'active') throw new HttpError(400, `Session "${s.status}" hai — signalling band.`);
    const body = await readBody(req);
    if (!['sdp', 'ice'].includes(body.kind) || !body.data || typeof body.data !== 'object') throw new HttpError(400, 'Signal invalid hai.');
    if (JSON.stringify(body.data).length > 40000) throw new HttpError(400, 'Signal bahut bada hai.');
    s.seq = Number(s.seq) + 1;
    if (!Array.isArray(s.signals)) s.signals = [];
    s.signals.push({ seq: s.seq, kind: body.kind, data: body.data, from: side, at: new Date().toISOString() });
    if (s.signals.length > 250) s.signals.splice(0, s.signals.length - 250);
    laPersistSoon();
    return sendJson(res, 200, { ok: true, seq: s.seq });
  }
  if (laSigPath && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    const s = laFind(laSigPath[1]);
    if (!s) throw new HttpError(404, 'Session nahi mila.');
    const side = laParty(s, user);
    if (!side) throw new HttpError(403, 'Is session ke hissa nahi ho.');
    const since = Number(url.searchParams.get('since')) || 0;
    const fresh = (s.signals || []).filter((m) => m.seq > since && m.from !== side)
      .map((m) => ({ seq: m.seq, kind: m.kind, data: m.data, at: m.at }));
    return sendJson(res, 200, { ok: true, status: s.status, seq: Number(s.seq) || 0, signals: fresh });
  }
  const laActPath = p.match(/^\/api\/live-assist\/([^/]+)\/(accept|decline|end)$/);
  if (laActPath && method === 'POST') {
    if (!user) throw new HttpError(401, 'Login required');
    laPrune();
    const s = laFind(laActPath[1]);
    if (!s) throw new HttpError(404, 'Session nahi mila.');
    const side = laParty(s, user);
    if (!side) throw new HttpError(403, 'Is session ke hissa nahi ho.');
    const action = laActPath[2];
    const now = new Date().toISOString();
    if (action === 'accept') {
      if (side !== 'user') throw new HttpError(403, 'Sirf jiske liye request hai wahi allow kar sakta hai.');
      if (s.status !== 'requested') throw new HttpError(400, `Session "${s.status}" hai — ab allow nahi ho sakta.`);
      s.status = 'active'; s.acceptedAt = now;
      try { recordNotification({ type: 'assist', title: '🎙️ Live Assist allowed', body: `${s.userName} ne allow kiya — live session chalu (${s.mode}).`, target: 'admin', meta: { sessionId: s.id } }); } catch { /* optional */ }
      logAudit(user, 'live_assist_accept', { target: s.id, note: s.mode, ip: clientIp(req) });
    } else if (action === 'decline') {
      if (side !== 'user') throw new HttpError(403, 'Sirf jinke liye request hai wahi decline kar sakte hain.');
      if (s.status !== 'requested') throw new HttpError(400, `Session "${s.status}" hai.`);
      s.status = 'declined'; s.endedAt = now; s.reason = 'user-declined';
      try { recordNotification({ type: 'assist', title: '🎙️ Live Assist declined', body: `${s.userName} ne request decline kar di.`, target: 'admin', meta: { sessionId: s.id } }); } catch { /* optional */ }
      logAudit(user, 'live_assist_decline', { target: s.id, ip: clientIp(req) });
    } else { // end — dono me se koi bhi band kar sakta hai
      if (s.status === 'requested' || s.status === 'active') {
        s.status = 'ended'; s.endedAt = now; s.reason = side === 'user' ? 'user-ended' : 'admin-ended';
        logAudit(user, 'live_assist_end', { target: s.id, note: s.reason, ip: clientIp(req) });
      }
    }
    await persist('notify');
    return sendJson(res, 200, { ok: true, session: laView(s) });
  }
  const laOnePath = p.match(/^\/api\/live-assist\/([^/]+)$/);
  if (laOnePath && method === 'GET') {
    if (!user) throw new HttpError(401, 'Login required');
    laPrune();
    const s = laFind(laOnePath[1]);
    if (!s) throw new HttpError(404, 'Session nahi mila.');
    if (!laParty(s, user)) throw new HttpError(403, 'Is session ke hissa nahi ho.');
    return sendJson(res, 200, { ok: true, session: laView(s) });
  }

  // ---- gviz ----
  if (p === '/api/gviz' && method === 'GET') {
    return handleGviz(req, res, url.searchParams);
  }
  // 🌐 Public form ka data (koi login nahi, par scoped + throttled — upar ka comment dekho).
  if (p === '/api/public/gviz' && method === 'GET') {
    return handlePublicGviz(req, res, url.searchParams);
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

  // ---- ⏪ Recovery (v3.48): purani settings / users / passwords wapas lana ---------------------
  const recoveryMode = (body) => ({ usersMode: body.usersMode, withSettings: body.withSettings !== false, withSessions: body.withSessions !== false, withResets: body.withResets === true, source: body.source });
  const cloudStore = () => {
    if (!sheetsStore || typeof sheetsStore.snapshots !== 'function') throw new HttpError(400, 'Ye recovery sirf Google Sheet storage (appsscript backend) ke saath kaam karti hai. Settings → ☁️ Storage & backup me storage connect karo.');
    return sheetsStore;
  };
  // 1) Sheet history (APP_STORAGE_HISTORY) — purani saves ki list + unka preview
  if (p === '/api/storage/history' && method === 'GET') {
    requireAdmin(user);
    const store = cloudStore();
    const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit') || 24)));
    try {
      const { snapshots, total, truncated } = await store.snapshots({ limit });
      const rows = [];
      for (const s of snapshots) for (const e of s.entries) if (e.kind === 'users' || e.kind === 'settings') rows.push(e.row);
      const infoByRow = new Map();
      if (rows.length) {
        try {
          const detailed = await store.history({ rows: rows.slice(0, 48), withData: true });
          for (const e of detailed.entries) {
            if (!e.data) { infoByRow.set(e.row, { locked: true, reason: 'ciphertext nahi mila' }); continue; }
            try {
              const value = store.decode(e.kind, { v: e.version, data: e.data });
              if (e.kind === 'users') {
                const list = Array.isArray(value) ? value : [];
                infoByRow.set(e.row, { users: list.length, admins: list.filter((u) => u && u.role === 'admin').length, usernames: list.slice(0, 60).map((u) => String((u && u.username) || '?')) });
              } else {
                infoByRow.set(e.row, { appName: String((value && value.appName) || ''), settingsUpdatedAt: (value && value.updatedAt) || null });
              }
            } catch (err) { infoByRow.set(e.row, { locked: true, reason: /decrypt/i.test(err.message) ? 'isse alag secret se encrypt hua tha' : err.message }); }
          }
        } catch (err) { console.warn('recovery preview:', err.message); }
      }
      const list = snapshots.map((s) => {
        const infos = s.rows.map((r) => infoByRow.get(r)).filter(Boolean);
        const u = infos.find((i) => i.users !== undefined) || {};
        const st = infos.find((i) => i.appName !== undefined) || {};
        return { at: s.at, kinds: s.kinds, rows: s.rows, bytes: s.bytes, users: u.users ?? null, admins: u.admins ?? null, usernames: u.usernames || [], appName: st.appName || '', settingsUpdatedAt: st.settingsUpdatedAt || null, locked: infos.some((i) => i.locked), reason: (infos.find((i) => i.locked) || {}).reason || '' };
      });
      return sendJson(res, 200, { ok: true, snapshots: list, total, truncated, shown: list.length, current: currentSummary(), backend: STORAGE_BACKEND });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // Sabse aam wajah: Apps Script me abhi PURANA Code.gs deployed hai (usme 'history' action hi nahi).
      if (/unknown action|HTML page|invalid response/i.test(err.message)) {
        throw new HttpError(400, 'Is sheet ke Apps Script me naya Code.gs deploy nahi hua hai (history action missing). Upar "📋 Copy Code.gs" dabao → Apps Script me paste → Deploy → Manage deployments → Edit → Version: New version → Deploy. Uske baad phir se "Purani saves dhoondho" dabao.');
      }
      throw new HttpError(502, `Sheet history read nahi ho payi: ${err.message}`);
    }
  }
  // 2) Sheet history se ek purani save wapas lao
  if (p === '/api/storage/history/restore' && method === 'POST') {
    requireAdmin(user);
    const store = cloudStore();
    const body = await readBody(req);
    const at = String((body && body.at) || '').trim();
    if (!at) throw new HttpError(400, 'Kaunsi save wapas laani hai (at) nahi bataya.');
    try {
      const snap = await store.snapshotData(at, RECOVERY_KINDS);
      const summary = storedSummary(snap.data);
      const result = await restoreStoredIntoDb(snap.data, { ...recoveryMode(body), source: 'sheet-history' });
      recordNotification({ type: 'settings', title: '⏪ Purani save wapas layi gayi', body: `${user.name || user.username} ne ${new Date(snap.at).toLocaleString('en-IN')} ki save restore ki — ${summary.users} users, ${result.usersAdded} naye add, settings ${result.settingsRestored ? 'restore' : 'skip'}.`, target: 'admin', meta: { username: user.username, at: snap.at, changes: [{ field: 'recovery', before: `${currentSummary().users} users`, after: `${result.usersTotal} users` }] } });
      return sendJson(res, 200, { ok: true, at: snap.at, restored: result, summary, locked: snap.locked, current: currentSummary() });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Restore fail: ${err.message}`);
    }
  }
  // 3) Doosri (purani) Google Sheet se data dekho / lao — jab APPS_SCRIPT_URL badal gaya ho
  if (p === '/api/storage/pull' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    const url2 = String((body && body.url) || '').trim();
    const secret2 = String((body && body.secret) || '').trim();
    let probe;
    try { probe = new AppsScriptStore({ url: url2, secret: secret2 }); }
    catch (err) { throw new HttpError(400, err.message); }
    try {
      const data = await probe.read();
      if (!data) throw new HttpError(404, 'Us sheet ka APP_STORAGE khaali hai — usme koi saved users/settings nahi mile.');
      const summary = storedSummary(data);
      if (body.mode !== 'import') return sendJson(res, 200, { ok: true, preview: summary, current: currentSummary(), spreadsheet: (await probe.ping().catch(() => ({}))).spreadsheet || '' });
      const result = await restoreStoredIntoDb(data, { ...recoveryMode(body), source: 'other-sheet' });
      recordNotification({ type: 'settings', title: '⏪ Doosri sheet se data restore hua', body: `${user.name || user.username} ne ek alag Google Sheet se ${summary.users} users + settings restore kiye (${result.usersAdded} naye users add).`, target: 'admin', meta: { username: user.username, changes: [{ field: 'recovery', before: `${currentSummary().users} users`, after: `${result.usersTotal} users` }] } });
      return sendJson(res, 200, { ok: true, restored: result, summary, current: currentSummary() });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Us sheet se data nahi mila: ${err.message}`);
    }
  }
  // 4) Server disk / app folder me purani JSON files dhoondo
  if (p === '/api/storage/scan' && method === 'GET') {
    requireAdmin(user);
    const sources = [];
    for (const dir of recoveryDiskDirs()) {
      try {
        const names = await fs.readdir(dir);
        const files = [];
        for (const name of names) {
          if (!/^(users|settings|sessions|resets|notifications)\.json$/.test(name)) continue;
          try { const stat = await fs.stat(path.join(dir, name)); files.push({ name, bytes: stat.size, modifiedAt: stat.mtime.toISOString() }); } catch { /* skip */ }
        }
        if (!files.length) continue;
        let users = null, usernames = [], appName = '', settingsUpdatedAt = null;
        try { const list = JSON.parse(await fs.readFile(path.join(dir, 'users.json'), 'utf8')); if (Array.isArray(list)) { users = list.length; usernames = list.slice(0, 60).map((u) => String((u && u.username) || '?')); } } catch { /* corrupt */ }
        try { const s = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8')); appName = String((s && s.appName) || ''); settingsUpdatedAt = (s && s.updatedAt) || null; } catch { /* missing */ }
        sources.push({ dir, files, users, usernames, appName, settingsUpdatedAt, isDataDir: dir === DATA_DIR });
      } catch { /* dir unreadable */ }
    }
    return sendJson(res, 200, { ok: true, sources, dataDir: DATA_DIR, backend: STORAGE_BACKEND, current: currentSummary() });
  }
  // 5) Backup file / disk folder / JSON payload se restore
  if (p === '/api/storage/import' && method === 'POST') {
    requireAdmin(user);
    const body = await readBody(req);
    let data = null;
    let origin = 'file';
    if (body && body.dir) {
      const dir = recoveryDiskDirs().find((d) => d === String(body.dir));
      if (!dir) throw new HttpError(400, 'Sirf server ke data folder se import allowed hai.');
      data = {};
      for (const [kind, name] of Object.entries(RECOVERY_FILES)) {
        try { data[kind] = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')); } catch { /* missing file */ }
      }
      origin = `disk:${dir}`;
    } else {
      const payload = (body && (body.payload || body.backup)) || null;
      if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Backup JSON nahi mila.');
      data = payload.users || payload.settings ? payload : (payload.data || null);
      if (!data || (!Array.isArray(data.users) && typeof data.settings !== 'object')) throw new HttpError(400, 'Ye file dashboard backup jaisi nahi lagti — users ya settings nahi mile.');
    }
    const summary = storedSummary(data);
    const result = await restoreStoredIntoDb(data, { ...recoveryMode(body), source: origin });
    recordNotification({ type: 'settings', title: '⏪ Backup se data restore hua', body: `${user.name || user.username} ne ${origin} se ${summary.users} users + settings restore kiye (${result.usersAdded} naye add${result.usersUpdated ? `, ${result.usersUpdated} update` : ''}).`, target: 'admin', meta: { username: user.username, changes: [{ field: 'recovery', before: `${currentSummary().users} users`, after: `${result.usersTotal} users` }] } });
    return sendJson(res, 200, { ok: true, restored: result, summary, origin, current: currentSummary() });
  }
  // 6) Poora backup download (users + settings + sessions) — aage ke liye safety net
  if (p === '/api/storage/backup' && method === 'GET') {
    requireAdmin(user);
    const payload = { app: 'first-forward-dashboard', version: APP_VERSION, exportedAt: new Date().toISOString(), storage: STORAGE_BACKEND, users: db.users, sessions: db.sessions, settings: db.settings, resets: db.resets, notify: db.notify };
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    return sendJson(res, 200, payload, { 'Content-Disposition': `attachment; filename="ff-full-backup-${stamp}.json"` });
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
    // 👤 GV personal commission — exact agent ID + class settings. Blank manual rate is allowed
    // (it keeps the row unresolved instead of silently changing the payout).
    if (patch.gvClassCch !== undefined) {
      const cfg = patch.gvClassCch;
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new HttpError(400, 'gvClassCch object hona chahiye.');
      cfg.enabled = cfg.enabled !== false && cfg.enabled !== 'false'; cfg.source = 'cch';
      if (!cfg.groups || typeof cfg.groups !== 'object' || Array.isArray(cfg.groups)) throw new HttpError(400, 'gvClassCch.groups object hona chahiye.');
      const cleanedGroups = {};
      for (const group of ['VC4', 'VC20', 'VC5']) {
        const raw = cfg.groups[group] === undefined ? [] : cfg.groups[group];
        const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
        cleanedGroups[group] = [...new Set(list.map((v) => String(v || '').trim().replace(/\s+/g, ' ')).filter(Boolean))].slice(0, 200);
      }
      cfg.groups = cleanedGroups;
    }
    if (patch.gvCommissionRates !== undefined) {
      const allowed = ['VC4', 'VC20', 'VC5', 'VC6', 'VC7', 'VC12'];
      const cfg = patch.gvCommissionRates;
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new HttpError(400, 'gvCommissionRates object hona chahiye.');
      if (cfg.enabled !== undefined) cfg.enabled = cfg.enabled === true || cfg.enabled === 'true';
      if (cfg.currentMonthOnly !== undefined) cfg.currentMonthOnly = cfg.currentMonthOnly !== false && cfg.currentMonthOnly !== 'false';
      if (cfg.classes !== undefined) {
        if (!cfg.classes || typeof cfg.classes !== 'object' || Array.isArray(cfg.classes)) throw new HttpError(400, 'gvCommissionRates.classes object hona chahiye.');
        const cleaned = {};
        for (const cls of allowed) {
          if (cfg.classes[cls] === undefined) continue;
          const item = cfg.classes[cls];
          if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, `${cls} commission setting object hona chahiye.`);
          const source = item.source === undefined ? undefined : String(item.source || '').trim().toLowerCase();
          if (source !== undefined && !['master', 'manual'].includes(source)) throw new HttpError(400, `${cls}: source master ya manual hona chahiye.`);
          const raw = item.rate;
          let rate = raw;
          if (raw === null || raw === undefined || raw === '') rate = '';
          else {
            rate = Number(raw);
            if (!Number.isFinite(rate) || rate < 0 || rate > 1000000) throw new HttpError(400, `${cls}: ₹ rate 0 se 1000000 ke beech hona chahiye.`);
            rate = Math.round(rate * 10000) / 10000;
          }
          cleaned[cls] = { ...(source === undefined ? {} : { source }), rate };
        }
        cfg.classes = cleaned;
      }
      // Unknown keys are ignored so an old saved setting cannot inject a new class into the UI.
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
async function serveStatic(req, res, pathname, search) {
  let requested = decodeURIComponent(pathname);
  if (requested === '/' || requested === '') requested = '/index.html';
  const versioned = /[?&]v=/.test(String(search || ''));
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
      const ext = path.extname(candidate).toLowerCase();
      const isShell = ext === '.html' || ext === '.webmanifest';
      // `?v=45` wala asset immutable ho gaya (index.html har deploy par bump karta hai) → repeat visits
      // par scripts ek baar hi download hote hain, phir 0 requests. HTML/manifest no-cache rehta hai.
      const cache = isShell ? 'no-cache' : versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=600';
      // 🏷️ ETag: HTML/no-cache assets har baar revalidate hote hain — 304 me sirf headers jaate hain
      // (poore page ka HTML dobara transfer nahi hota), isliye repeat load noticeable fast ho jata hai.
      const etag = `W/"${stat.size.toString(36)}-${Math.round(Number(stat.mtimeMs)).toString(36)}"`;
      if (String(req.headers['if-none-match'] || '').split(',').map((x) => x.trim()).includes(etag)) {
        res.writeHead(304, headers({ ETag: etag, 'Cache-Control': cache, 'X-FF-Cache': 'not-modified' }));
        return res.end();
      }
      const content = await fs.readFile(candidate);
      const type = MIME[ext] || 'application/octet-stream';
      return sendMaybeCompressed(req, res, 200, type, content, { 'Cache-Control': cache, ETag: etag, 'X-FF-Cache': versioned && !isShell ? 'immutable' : 'revalidate' });
    } catch { /* try next */ }
  }
  if (!path.extname(requested)) return serveStatic(req, res, '/index.html', search); // pretty URLs → app shell
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
  const e = db.settings.eir || {};
  return {
    source, sheetId: db.settings.sheetId, sheet: db.settings.eirSheet || e.sheet || 'EIR',
    dateCol: e.date || 'AA', tagCol: e.tagId || 'A', clsCol: e.cls || 'D',
    nameCol: link.kind === 'tl' ? (source === 'gv' ? (e.gvTl || 'AZ') : (e.tlName || 'BA')) : (source === 'gv' ? (e.gvName || 'AX') : (e.agentName || 'L')),
    agentCol: source === 'gv' ? (e.gvName || 'AX') : (e.agentName || 'L'),
    tlCol: source === 'gv' ? (e.gvTl || 'AZ') : (e.tlName || 'BA'),
    masterCol: e.masterId || 'AU'
  };
}
function eirGvMasterId() {
  return String((db.settings.eir || {}).gvMasterId || '5845036').trim().replace(/\.0+$/, '');
}
function isGvPersonalRow(master) {
  return String(master || '').trim().replace(/\.0+$/, '') === eirGvMasterId();
}
function isFfPersonalRow(master) {
  return !isGvPersonalRow(master);
}
async function personalDailyRows(link) {
  const c = personalConfig(link);
  const { start, today } = personalWindow();
  const extra = `, ${c.masterCol}, ${c.tlCol}`;
  const tq = `select ${c.dateCol}, ${c.clsCol}${extra}, count(${c.tagCol}) where ${c.tagCol} is not null and ${c.dateCol} >= date '${start}' and ${c.dateCol} <= date '${today}' and ${c.nameCol} = ${gvizLiteral(link.name)} group by ${c.dateCol}, ${c.clsCol}${extra} order by ${c.dateCol} desc limit 5000`;
  const params = new URLSearchParams({ id: String(c.sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet: c.sheet, tq });
  const out = await fetchUpstreamCached(upstreamUrl(params));
  if (out.status < 200 || out.status >= 300) throw new Error(`sheet ${out.status}`);
  const table = parseGvizServer(out.body);
  // Legacy GV link adapters may not expose the EIR master column in their response schema.
  // Only that schema mismatch may use the old GV Master link query; normal GV personal pages
  // remain EIR + master-ID filtered just like the main site.
  const responseCols = (table.cols || []).map((cell) => String(cell.id || cell.label || '').trim().toUpperCase());
  if (c.source === 'gv' && !responseCols.includes(String(c.masterCol).toUpperCase())) {
    const m = (db.settings.gv && db.settings.gv.master) || {};
    const legacyDate = m.date || 'P', legacyClass = m.cch || m.vClass || 'G', legacyTag = m.tagId || 'I', legacyName = link.kind === 'tl' ? (m.tlName || 'D') : (m.agentName || 'B');
    const legacyTq = `select ${legacyDate}, ${legacyClass}, count(${legacyTag}) where ${legacyTag} is not null and ${legacyDate} >= date '${start}' and ${legacyDate} <= date '${today}' and ${legacyName} = ${gvizLiteral(link.name)} group by ${legacyDate}, ${legacyClass} order by ${legacyDate} desc limit 5000`;
    const legacyParams = new URLSearchParams({ id: String(db.settings.gvSheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet: m.tab || 'GV Master', tq: legacyTq });
    const legacyOut = await fetchUpstreamCached(upstreamUrl(legacyParams));
    if (legacyOut.status < 200 || legacyOut.status >= 300) throw new Error(`GV legacy personal query responded ${legacyOut.status}`);
    const legacyTable = parseGvizServer(legacyOut.body);
    return (legacyTable.rows || []).map((row) => ({ date: serverDate(serverCell(row, 0)), cls: classBucket(serverCell(row, 1)), n: serverNumber(serverCell(row, 2)) })).filter((row) => row.date);
  }
  const rows = [];
  for (const row of table.rows || []) {
    const dk = serverDate(serverCell(row, 0));
    if (!dk) continue;
    const cells = (row && row.c) || [];
    const gvRow = isGvPersonalRow(serverCell(row, 2));
    if ((c.source === 'gv' && !gvRow) || (c.source === 'ff' && gvRow)) continue;
    rows.push({ date: dk, cls: classBucket(serverCell(row, 1)), n: serverNumber(serverCell(row, Math.max(0, cells.length - 1))) });
  }
  return rows;
}
async function personalTeamAgents(link) {
  const c = personalConfig(link);
  const { start, today } = personalWindow();
  const extra = `, ${c.masterCol}, ${c.tlCol}`;
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
    const gvRow = isGvPersonalRow(serverCell(row, 2));
    if ((c.source === 'gv' && !gvRow) || (c.source === 'ff' && gvRow)) continue;
    if (!byAgent.has(name)) byAgent.set(name, new Map());
    byAgent.get(name).set(dk, (byAgent.get(name).get(dk) || 0) + serverNumber(serverCell(row, Math.max(0, cells.length - 1))));
  }
  return byAgent;
}

/** 🧑‍💼 Agent personal link par uska TL (EIR ke recent rows me sabse zyada wala TL naam).
    v3.31 fix: ye function call ho raha tha par define nahi tha → har agent /p/ link 500 deta tha. */
async function personalAgentTl(link) {
  try {
    const c = personalConfig(link);
    const { start, today } = personalWindow();
    const tq = `select ${c.tlCol}, ${c.masterCol}, count(${c.tagCol}) where ${c.tagCol} is not null and ${c.dateCol} >= date '${start}' and ${c.dateCol} <= date '${today}' and ${c.nameCol} = ${gvizLiteral(link.name)} group by ${c.tlCol}, ${c.masterCol}`;
    const params = new URLSearchParams({ id: String(c.sheetId || '').replace(/[^A-Za-z0-9_-]/g, ''), sheet: c.sheet, tq });
    const out = await fetchUpstreamCached(upstreamUrl(params));
    if (out.status < 200 || out.status >= 300) return '';
    const table = parseGvizServer(out.body);
    let best = '', bestN = -1;
    for (const row of table.rows || []) {
      const tl = serverCell(row, 0).trim();
      const gvRow = isGvPersonalRow(serverCell(row, 1));
      if (!tl || (c.source === 'gv' && !gvRow) || (c.source === 'ff' && gvRow)) continue;
      const n = serverNumber(serverCell(row, 2));
      if (n > bestN) { best = tl; bestN = n; }
    }
    return best;
  } catch { return ''; }
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
  const noStore = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  const fail = (code, msg) => sendHtml(res, code, personalShell({ title: 'Link unavailable', heading: '🔒 Link unavailable', body: `<p>${escHtml(msg)}</p>` }), noStore);
  if (feats().personalLinks === false) return fail(404, 'Ye feature admin ne band kar rakha hai.');
  const savedLink = (Array.isArray(db.settings.personalLinks) ? db.settings.personalLinks : []).find((l) => l.token === token);
  if (!savedLink) return fail(404, 'Ye link ya to khatam ho gaya ya galat hai. Admin se naya maango.');
  if (savedLink.enabled === false) return fail(403, 'Admin ne ye link band kar diya hai.');
  const hasSession = personalLinkSession(req, savedLink);
  if (!hasSession) {
    const idLabel = savedLink.kind === 'tl' ? 'TL ID' : 'Agent ID';
    const credentialsReady = String(savedLink.personId || '').trim().length >= 2 && String(savedLink.mobile || '').replace(/\D/g, '').length === 10;
    const gate = `<section class="pb-card pb-auth-card" id="pl-auth-gate">
      <div class="pb-auth-ico">🔐</div>
      <h2>Personal Report · Verification Required</h2>
      <p class="dim">Assigned <b>${idLabel}</b> aur registered <b>10-digit mobile number</b> verify karke hi report khulegi.</p>
      ${credentialsReady ? `<form class="pb-auth-form" id="pl-auth-form" autocomplete="off">
        <label class="pb-fld"><span>🪪 ${idLabel} *</span><input class="pb-inp" id="pl-inp-id" required placeholder="Enter your ${idLabel}" maxlength="40" autocomplete="off"></label>
        <label class="pb-fld"><span>📱 Registered Mobile Number *</span><input class="pb-inp" id="pl-inp-mob" type="tel" inputmode="numeric" required placeholder="10-digit mobile" maxlength="14" autocomplete="off"></label>
        <div class="pb-auth-err" id="pl-auth-err" hidden></div>
        <button type="submit" class="pb-auth-btn" id="pl-auth-btn">🔓 Verify &amp; Open Report</button>
      </form>` : '<p class="pb-auth-err">Admin setup pending. No report data is available until the ID and mobile are configured.</p>'}
      <p class="dim" style="font-size:11.5px;margin-top:10px">🔒 Your identity is checked securely before any report data is sent.</p>
    </section>`;
    const html = personalShell({ title: 'Personal Report Verification', heading: '🔐 Personal Report', sub: 'Identity verification required · read-only access', token, requireAuth: true, authorized: false, body: gate });
    return sendHtml(res, 200, html, noStore);
  }
  const def = (db.settings && db.settings.personalLinkDefaults) || {};
  const allSections = ['overview', 'stock', 'issuance', 'performance', 'ageing', 'export'];
  const allowedSecs = Array.isArray(savedLink.sections)
    ? savedLink.sections.filter((key) => allSections.includes(key))
    : (Array.isArray(def.sections) ? def.sections.filter((key) => allSections.includes(key)) : allSections);
  const hasSec = (k) => allowedSecs.includes(k);
  const hasVisibleSection = allowedSecs.some((key) => key !== 'export');
  const canExport = hasVisibleSection && hasSec('export');
  const requireAuth = true;
  const link = { ...savedLink, source: savedLink.source === 'gv' ? 'gv' : 'ff' };
  try {
    const needsIssuance = hasSec('overview') || hasSec('issuance') || hasSec('performance');
    const rows = needsIssuance ? await personalDailyRows(link) : [];
    if (needsIssuance && !rows.length) return fail(404, `"${link.name}" ka data abhi sheet me nahi mila (ya naam alag hai).`);
    const st = personalStats(rows);
    let team = [];
    let goal = null, target = null;
    const ym = dateKeyNow().slice(0, 7);
    const normPerson = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
    let byAgentMap = new Map();
    if (link.kind === 'tl' && (hasSec('overview') || hasSec('issuance') || hasSec('performance'))) {
      goal = ((Array.isArray(db.settings.tlTargets) ? db.settings.tlTargets : []).find((t) => t && t.ym === ym && normPerson(t.tl) === normPerson(link.name)) || null);
      if (hasSec('issuance') || hasSec('performance')) byAgentMap = await personalTeamAgents(link);
      for (const [name, m] of byAgentMap) {
        let mtdA = 0;
        for (const [d, n] of m) if (d.startsWith(ym)) mtdA += n;
        if (mtdA > 0) team.push({ name, mtd: mtdA });
      }
      team.sort((a, b) => b.mtd - a.mtd);
      team = team.slice(0, 15);
    } else if (link.kind !== 'tl' && (hasSec('overview') || hasSec('performance'))) {
      target = ((Array.isArray(db.settings.targets) ? db.settings.targets : []).find((t) => t && t.ym === ym && (t.source || 'ff') === link.source && normPerson(t.agent) === normPerson(link.name)) || null);
    }
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const maxBar = Math.max(1, ...st.last14.map((x) => x.n));
    const bars = st.last14.map((x) => `<div class="pb-col" title="${escHtml(x.date)}: ${x.n}"><div class="pb-bar" style="height:${Math.max(4, Math.round((x.n / maxBar) * 100))}%"></div><span>${escHtml(x.date.slice(8, 10))}</span></div>`).join('');
    const clsRows = Object.entries(st.cls).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="pb-kv"><span>${escHtml(k)}</span><b>${v}</b> <i>${pct(v, st.clsTotal)}%</i></div>`).join('') || '<p class="dim">—</p>';
    const goalHtml = goal ? `<div class="pb-goal"><div class="pb-goal-top"><span>🎯 TL goal ${escHtml(ym)}</span><b>${st.mtd} / ${Number(goal.target) || 0} (${pct(st.mtd, Number(goal.target))}%)</b></div><div class="pb-track"><div class="pb-fill" style="width:${Math.min(100, pct(st.mtd, Number(goal.target)))}%"></div></div></div>` : '';
    const targetHtml = target ? `<div class="pb-kv"><span>🎯 Your target ${escHtml(ym)}</span><b>${st.mtd} / ${Number(target.target) || 0} (${pct(st.mtd, Number(target.target))}%)</b></div>` : '';
    const prevYm = (() => { const dd = new Date(`${dateKeyNow()}T00:00:00Z`); dd.setUTCDate(1); dd.setUTCMonth(dd.getUTCMonth() - 1); return `${dd.getUTCFullYear()}-${pad2(dd.getUTCMonth() + 1)}`; })();
    const lastMonthTotal = rows.reduce((a, r) => a + (String(r.date).startsWith(prevYm) ? r.n : 0), 0);
    let stockInfo = null;
    if (hasSec('stock') || hasSec('ageing')) {
      try {
        const sidx = await Promise.race([stockAgeIndex(false), new Promise((_, rej) => setTimeout(() => rej(new Error('stock timeout')), 25000))]);
        stockInfo = personalStock(sidx, link.source, link.kind === 'tl' ? 'tl' : 'agent', link.name);
      } catch (err) { console.warn('personal stock:', err.message); }
    }
    const nf = (n) => Number(n || 0).toLocaleString('en-IN');
    const stCore = stockInfo ? stockInfo.t[0] : 0, stComm = stockInfo ? stockInfo.t[1] : 0;
    const stTotal = stCore + stComm;
    const expBtns = (tblId, label) => canExport ? `<div class="pb-card-acts"><button type="button" class="pb-btn" data-pl-csv="${escHtml(tblId)}" data-pl-title="${escHtml(label)}">⬇ CSV</button><button type="button" class="pb-btn pb-btn-pdf" data-pl-pdf="${escHtml(tblId)}" data-pl-title="${escHtml(label)}">📄 PDF</button></div>` : '';

    // 1. 📦 Class-wise stock — stock access never implicitly grants issuance details.
    const ALL_CLS = ['VC4', 'VC20', 'VC5', 'VC6', 'VC7', 'VC12', 'VC15', 'VC16'];
    const prevCls = {};
    rows.forEach((r) => { if (String(r.date).startsWith(prevYm)) prevCls[r.cls] = (prevCls[r.cls] || 0) + r.n; });
    const clsList = [...new Set([...ALL_CLS, ...(stockInfo && stockInfo.byCls ? Object.keys(stockInfo.byCls) : [])])];
    let totClsStock = 0, totClsLast = 0, totClsMtd = 0, totCls1m = 0, totCls3m = 0;
    const classStockRowsHtml = clsList.map((c) => {
      const sc = (stockInfo && stockInfo.byCls && stockInfo.byCls[c]) || { t: 0, c: [0, 0, 0, 0], o: 0 };
      if (!sc.t && !['VC4', 'VC20', 'VC5', 'VC6', 'VC7', 'VC12'].includes(c)) return '';
      totClsStock += sc.t; totCls1m += sc.c[0]; totCls3m += sc.c[1];
      const grp = c === 'VC4' || c === 'VC20' ? '🚗 Core' : '🚚 Comm';
      return `<tr><td><b>${escHtml(c)}</b></td><td>${grp}</td><td><b>${nf(sc.t)}</b></td><td>${nf(sc.c[0])}</td><td class="${sc.c[1] ? 'pb-warn' : ''}">${nf(sc.c[1])}</td></tr>`;
    }).filter(Boolean).join('');
    const classStockCardHtml = `<section class="pb-card"><div class="pb-card-head"><h3>📦 Class-wise Stock</h3>${expBtns('pl-tbl-cls-stock', `${link.name} - Class-wise Stock`)}</div><div class="pb-scroll"><table class="pb-tbl" id="pl-tbl-cls-stock"><thead><tr><th>Tag Class</th><th>Category</th><th>In Stock</th><th>Stock ≥1M</th><th>Stock ≥3M</th></tr></thead><tbody>${classStockRowsHtml}</tbody><tfoot><tr><td>Grand Total</td><td>All Classes</td><td>${nf(totClsStock || stTotal)}</td><td>${nf(totCls1m)}</td><td>${nf(totCls3m)}</td></tr></tfoot></table></div></section>`;
    const classIssuanceRowsHtml = [...new Set([...ALL_CLS, ...Object.keys(st.cls), ...Object.keys(prevCls)])].map((c) => {
      const last = prevCls[c] || 0, mtd = st.cls[c] || 0;
      if (!last && !mtd && !['VC4', 'VC20', 'VC5', 'VC6', 'VC7', 'VC12'].includes(c)) return '';
      totClsLast += last; totClsMtd += mtd;
      return `<tr><td><b>${escHtml(c)}</b></td><td>${nf(last)}</td><td><b>${nf(mtd)}</b></td><td>${pct(mtd, st.clsTotal)}%</td></tr>`;
    }).filter(Boolean).join('');
    const classIssuanceHtml = `<section class="pb-card"><div class="pb-card-head"><h3>🏷️ Class-wise Issuance</h3>${expBtns('pl-tbl-cls-issue', `${link.name} - Class-wise Issuance`)}</div><div class="pb-scroll"><table class="pb-tbl" id="pl-tbl-cls-issue"><thead><tr><th>Tag Class</th><th>Last Month (${escHtml(prevYm)})</th><th>MTD (${escHtml(ym)})</th><th>MTD Share</th></tr></thead><tbody>${classIssuanceRowsHtml}</tbody><tfoot><tr><td>Grand Total</td><td>${nf(totClsLast)}</td><td>${nf(totClsMtd)}</td><td>100%</td></tr></tfoot></table></div></section>`;

    // 2. 📅 Date-wise Issuance Table
    const byDateMap = new Map();
    rows.forEach((r) => {
      const d = byDateMap.get(r.date) || { date: r.date, vc4: 0, vc20: 0, comm: 0, total: 0 };
      if (r.cls === 'VC4') d.vc4 += r.n;
      else if (r.cls === 'VC20') d.vc20 += r.n;
      else d.comm += r.n;
      d.total += r.n;
      byDateMap.set(r.date, d);
    });
    const dateRowsList = [...byDateMap.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 62);
    const dSum = (k) => dateRowsList.reduce((a, x) => a + x[k], 0);
    const dateTableHtml = `<section class="pb-card"><div class="pb-card-head"><h3>📅 Date-wise Issuance (${dateRowsList.length} active days)</h3>${expBtns('pl-tbl-date-iss', `${link.name} - Date-wise Issuance`)}</div><div class="pb-scroll"><table class="pb-tbl" id="pl-tbl-date-iss"><thead><tr><th>Date</th><th>VC4</th><th>VC20</th><th>🚚 VC5+</th><th>Total Issued</th></tr></thead><tbody>${dateRowsList.map((d) => `<tr><td><b>${escHtml(d.date)}</b></td><td>${nf(d.vc4)}</td><td>${nf(d.vc20)}</td><td>${nf(d.comm)}</td><td><b>${nf(d.total)}</b></td></tr>`).join('')}</tbody><tfoot><tr><td>Grand Total</td><td>${nf(dSum('vc4'))}</td><td>${nf(dSum('vc20'))}</td><td>${nf(dSum('comm'))}</td><td>${nf(dSum('total'))}</td></tr></tfoot></table></div></section>`;

    // 3. 🧓 Stock Ageing Table (Group-wise + Agent-wise for TL)
    const totAgeC = [0, 1, 2, 3].map((i) => (stockInfo ? stockInfo.c[0][i] + stockInfo.c[1][i] : 0));
    const maxOld = stockInfo ? Math.max(stockInfo.o[0] || 0, stockInfo.o[1] || 0) : 0;
    const ageHtml = stockInfo ? `<section class="pb-card"><div class="pb-card-head"><h3>🧓 Stock ageing</h3>${expBtns('pl-tbl-ageing', `${link.name} - Stock Ageing`)}</div><div class="pb-scroll"><table class="pb-tbl" id="pl-tbl-ageing"><thead><tr><th>Group</th><th>Total</th><th>≥1M</th><th>≥3M</th><th>≥5M</th><th>≥6M</th><th>Oldest</th></tr></thead><tbody>${[['🚗 VC4+VC20', 0], ['🚚 VC5+', 1]].map(([lbl, g]) => `<tr><td>${lbl}</td><td>${nf(stockInfo.t[g])}</td>${stockInfo.c[g].map((x, i) => `<td class="${i >= 2 && x ? 'pb-hot' : i === 1 && x ? 'pb-warn' : ''}">${nf(x)}</td>`).join('')}<td>${stockInfo.o[g] ? `${nf(stockInfo.o[g])}d` : '—'}</td></tr>`).join('')}</tbody><tfoot><tr><td>Grand Total</td><td>${nf(stTotal)}</td>${totAgeC.map((x) => `<td>${nf(x)}</td>`).join('')}<td>${maxOld ? `${nf(maxOld)}d` : '—'}</td></tr></tfoot></table></div></section>` : '<section class="pb-card"><h3>🧓 Stock ageing</h3><p class="dim">Stock ageing data abhi uplabdh nahi hai.</p></section>';

    let agentAgeTable = '';
    if (link.kind === 'tl' && stockInfo && stockInfo.agents && stockInfo.agents.length) {
      const agList = stockInfo.agents.slice(0, 80);
      const agTot = agList.reduce((a, x) => a + x.t[0] + x.t[1], 0);
      const ag1m = agList.reduce((a, x) => a + x.c[0][0] + x.c[1][0], 0);
      const ag3m = agList.reduce((a, x) => a + x.c[0][1] + x.c[1][1], 0);
      const ag5m = agList.reduce((a, x) => a + x.c[0][2] + x.c[1][2], 0);
      const ag6m = agList.reduce((a, x) => a + x.c[0][3] + x.c[1][3], 0);
      agentAgeTable = `<section class="pb-card"><div class="pb-card-head"><h3>👥 Agent-wise Stock Ageing (${agList.length} agents)</h3>${expBtns('pl-tbl-ag-age', `${link.name} - Agent Stock Ageing`)}</div><div class="pb-scroll"><table class="pb-tbl" id="pl-tbl-ag-age"><thead><tr><th>Agent</th><th>Total Stock</th><th>🚗 Core</th><th>🚚 Comm</th><th>≥1M</th><th>≥3M</th><th>≥5M</th><th>≥6M</th></tr></thead><tbody>${agList.map((a) => `<tr><td>${escHtml(a.n)}</td><td><b>${nf(a.t[0] + a.t[1])}</b></td><td>${nf(a.t[0])}</td><td>${nf(a.t[1])}</td><td>${nf(a.c[0][0] + a.c[1][0])}</td><td class="${a.c[0][1] + a.c[1][1] ? 'pb-warn' : ''}">${nf(a.c[0][1] + a.c[1][1])}</td><td class="${a.c[0][2] + a.c[1][2] ? 'pb-hot' : ''}">${nf(a.c[0][2] + a.c[1][2])}</td><td class="${a.c[0][3] + a.c[1][3] ? 'pb-hot' : ''}">${nf(a.c[0][3] + a.c[1][3])}</td></tr>`).join('')}</tbody><tfoot><tr><td>Grand Total</td><td>${nf(agTot)}</td><td>${nf(agList.reduce((a, x) => a + x.t[0], 0))}</td><td>${nf(agList.reduce((a, x) => a + x.t[1], 0))}</td><td>${nf(ag1m)}</td><td>${nf(ag3m)}</td><td>${nf(ag5m)}</td><td>${nf(ag6m)}</td></tr></tfoot></table></div></section>`;
    }

    // 4. 👥 TL Agent-wise Issuance — inventory fields live only in the stock section.
    let teamTable = '';
    if (link.kind === 'tl' && hasSec('issuance')) {
      const agentRows = [];
      for (const [name, m] of byAgentMap) {
        let mtdA = 0, lastA = 0;
        for (const [d, n] of m) { if (d.startsWith(ym)) mtdA += n; else if (d.startsWith(prevYm)) lastA += n; }
        if (mtdA || lastA) agentRows.push({ name, mtd: mtdA, last: lastA, total: mtdA + lastA });
      }
      const list = agentRows.sort((a, b) => b.mtd - a.mtd || b.last - a.last).slice(0, 80);
      const sum = (k) => list.reduce((a, r) => a + r[k], 0);
      teamTable = list.length ? `<section class="pb-card"><div class="pb-card-head"><h3>👥 Team · agent-wise issuance (${list.length} agents)</h3>${expBtns('pl-tbl-team', `${link.name} - Team Agent-wise Issuance`)}</div><div class="pb-scroll"><table class="pb-tbl" id="pl-tbl-team"><thead><tr><th>Agent</th><th>Last Month Issued</th><th>MTD Issued</th><th>Combined</th></tr></thead><tbody>${list.map((r) => `<tr><td>${escHtml(r.name)}</td><td>${nf(r.last)}</td><td><b>${nf(r.mtd)}</b></td><td>${nf(r.total)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Grand Total</td><td>${nf(sum('last'))}</td><td>${nf(sum('mtd'))}</td><td>${nf(sum('total'))}</td></tr></tfoot></table></div></section>` : '';
    }
    const teamHtml = team.length ? `<section class="pb-card"><h3>👥 Team (is mahine)</h3>${team.map((t, i) => `<div class="pb-rank"><span class="pb-pos">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span><span class="pb-name">${escHtml(t.name)}</span><b>${t.mtd}</b></div>`).join('')}</section>` : '';

    // 5. 🏆 Performance Scorecard Table
    const dayNow = Math.max(1, Number(dateKeyNow().slice(8, 10)));
    const runRate = (st.mtd / dayNow).toFixed(1);
    const projected = Math.round((st.mtd / dayNow) * 30);
    const diff = st.mtd - st.prevSame;
    const growthPct = st.prevSame > 0 ? `${diff >= 0 ? '+' : ''}${Math.round((diff / st.prevSame) * 100)}%` : 'New';
    const perfStockRow = hasSec('stock') ? `<tr><td><b>Current Stock in Hand</b></td><td><b>${nf(stTotal)} tags</b></td><td>🚗 Core: ${nf(stCore)} · 🚚 Comm: ${nf(stComm)}</td><td>≥3M Old: ${nf(totAgeC[1])} tags</td></tr>` : '';
    const perfStockTotal = hasSec('stock') ? `<td>Stock: ${nf(stTotal)}</td>` : '<td>Performance details</td>';
    const perfCardHtml = `<section class="pb-card"><div class="pb-card-head"><h3>🏆 Performance &amp; Growth Scorecard</h3>${expBtns('pl-tbl-perf', `${link.name} - Performance Scorecard`)}</div><div class="pb-scroll"><table class="pb-tbl" id="pl-tbl-perf"><thead><tr><th>Metric</th><th>Current Value</th><th>Benchmark / Reference</th><th>Status / Delta</th></tr></thead><tbody>
      <tr><td><b>MTD Issued (${escHtml(ym)})</b></td><td><b>${nf(st.mtd)}</b></td><td>Same period (${escHtml(prevYm)}): ${nf(st.prevSame)}</td><td class="${diff >= 0 ? 'pb-up' : 'pb-hot'}">${diff >= 0 ? '▲ +' : '▼ '}${nf(Math.abs(diff))} (${escHtml(growthPct)})</td></tr>
      <tr><td><b>Last Month Total (${escHtml(prevYm)})</b></td><td><b>${nf(lastMonthTotal)}</b></td><td>Projected Month-End: ${nf(projected)}</td><td>Run Rate: ${runRate} / day</td></tr>
      <tr><td><b>Active Days (MTD)</b></td><td><b>${nf(st.mtdActiveDays)} days</b></td><td>Avg / Active Day: ${st.mtdActiveDays ? (st.mtd / st.mtdActiveDays).toFixed(1) : '0'}</td><td>Streak: ${nf(st.streak)} days 🔥</td></tr>
      <tr><td><b>Best Single Day (MTD)</b></td><td><b>${nf(st.best.n)} tags</b></td><td>Date: ${escHtml(st.best.date || '—')}</td><td>Last 14d Active: ${nf(st.activeDays)}/14d</td></tr>
      ${perfStockRow}
    </tbody><tfoot><tr><td>Summary Total</td><td>MTD: ${nf(st.mtd)}</td><td>Last Month: ${nf(lastMonthTotal)}</td>${perfStockTotal}</tr></tfoot></table></div></section>`;

    const stockKpis = hasSec('stock') ? `<section class="pb-kpis"><div class="pb-kpi stock"><small>📦 Stock (total)</small><b>${stockInfo ? nf(stTotal) : '—'}</b><span>${stockInfo ? `🚗 ${nf(stCore)} · 🚚 ${nf(stComm)}` : 'stock data abhi nahi mila'}</span></div></section>` : '';
    const tlName = link.kind === 'tl' || !hasVisibleSection ? '' : (await personalAgentTl(link));

    // Build only tabs that the admin granted; an "All" view can expose only emitted sections.
    const tabDefs = [
      { id: 'overview', label: '📊 Overview', show: hasSec('overview') },
      { id: 'stock', label: '📦 Class-wise Stock', show: hasSec('stock') },
      { id: 'issuance', label: `📅 Date${link.kind === 'tl' ? ' & Agent' : ''} Issuance`, show: hasSec('issuance') },
      { id: 'performance', label: '🏆 Performance', show: hasSec('performance') },
      { id: 'ageing', label: '⏳ Stock Ageing', show: hasSec('ageing') }
    ].filter((t) => t.show);
    if (tabDefs.length > 1) tabDefs.push({ id: 'all', label: '🌐 All Allowed Sections', show: true });
    const firstTab = (tabDefs[0] && tabDefs[0].id) || 'overview';
    const tabsBarHtml = tabDefs.length ? `<div class="pb-tabs-bar"><div class="pb-tabs" id="pl-tabs">${tabDefs.map((t) => `<button type="button" class="pb-tab ${t.id === firstTab ? 'on' : ''}" data-pl-tab="${t.id}">${t.label}</button>`).join('')}</div>${canExport ? `<div class="pb-global-exp"><button type="button" class="pb-btn" id="pl-exp-all-csv">⬇ Full CSV</button><button type="button" class="pb-btn pb-btn-pdf" id="pl-exp-all-pdf">📄 Full PDF</button></div>` : ''}</div>` : '';
    const noSectionsHtml = tabDefs.length ? '' : '<section class="pb-card pb-no-sections"><h3>🔒 No report sections enabled</h3><p class="dim">The administrator has not granted any report sections for this link. Contact them to request access.</p></section>';

    const html = personalShell({
      title: `${link.name} · Performance`,
      heading: `${link.kind === 'tl' ? '👥' : '🧑‍💼'} ${escHtml(link.name)}`,
      sub: `${link.source === 'gv' ? 'GV Partner' : 'First Forward'} · ${link.kind === 'tl' ? 'Team Leader' : 'Agent'}${tlName ? ` · ${link.kind === 'tl' ? '' : 'TL '}<b>${escHtml(tlName)}</b>` : ''} · personal view · read-only`,
      token,
      requireAuth,
      authorized: true,
      personName: link.name,
      body: `
      <div id="pl-portal-content">
        ${tabsBarHtml}
        ${noSectionsHtml}
        ${hasSec('overview') ? `<div class="pl-pane" data-pl-pane="overview">
          ${goalHtml || targetHtml ? `<section class="pb-card pb-goalcard">${goalHtml}${targetHtml}</section>` : ''}
          ${stockKpis}
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
        </div>` : ''}
        ${hasSec('stock') ? `<div class="pl-pane" data-pl-pane="stock" hidden>${classStockCardHtml}</div>` : ''}
        ${hasSec('issuance') ? `<div class="pl-pane" data-pl-pane="issuance" hidden>${classIssuanceHtml}${teamTable}${dateTableHtml}</div>` : ''}
        ${hasSec('performance') ? `<div class="pl-pane" data-pl-pane="performance" hidden>${perfCardHtml}${teamHtml}</div>` : ''}
        ${hasSec('ageing') ? `<div class="pl-pane" data-pl-pane="ageing" hidden>${ageHtml}${agentAgeTable}</div>` : ''}
        <p class="pb-foot">Read-only link · data live sheet se · ${escHtml(db.settings.brand || 'Dashboard')}</p>
      </div>`
    });
    return sendHtml(res, 200, html, noStore);
  } catch (err) {
    console.warn('personal page:', err.message);
    return fail(500, 'Data load nahi hua — thodi der baad try karo.');
  }
}
function personalShell({ title, heading, sub, body, token = '', requireAuth = false, authorized = false, personName = '' }) {
  const accent = (db.settings.theme && db.settings.theme.accent) || '#2563eb';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escHtml(title)}</title>
<style>
:root{--a:${escHtml(accent)}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f4f6fb;color:#0f172a;padding:18px;line-height:1.45}
.pb-wrap{max-width:940px;margin:0 auto}
.pb-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px;background:#fff;padding:14px 16px;border-radius:14px;border:1px solid #e5e9f5;box-shadow:0 2px 10px rgba(15,23,42,.04)}
.pb-head-left{display:flex;align-items:center;gap:12px}
.pb-logo{width:44px;height:44px;border-radius:12px;background:var(--a);color:#fff;display:grid;place-items:center;font-weight:800;font-size:17px;flex-shrink:0}
.pb-head h1{font-size:20px}.pb-head p{font-size:12.5px;color:#64748b}
.pb-card{background:#fff;border:1px solid #e5e9f5;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 10px rgba(15,23,42,.04)}
.pb-card-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.pb-card h3{font-size:14px;color:#1e293b;margin:0;font-weight:700}
.pb-card-acts,.pb-global-exp{display:inline-flex;gap:6px;align-items:center}
.pb-btn{border:1px solid #cbd5e1;background:#f8fafc;color:#1e293b;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;transition:.15s}
.pb-btn:hover{background:#e2e8f0}
.pb-btn-pdf{background:#eff6ff;border-color:#93c5fd;color:#1d4ed8}
.pb-tabs-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;background:#fff;padding:8px 10px;border-radius:12px;border:1px solid #e5e9f5}
.pb-tabs{display:flex;flex-wrap:wrap;gap:6px}
.pb-tab{border:1px solid transparent;background:#f1f5f9;color:#475569;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:700;cursor:pointer;transition:.15s}
.pb-tab.on{background:var(--a);color:#fff;box-shadow:0 2px 6px rgba(37,99,235,.25)}
.pb-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:12px}
.pb-kpi{background:#fff;border:1px solid #e5e9f5;border-radius:14px;padding:12px;text-align:center}
.pb-kpi small{color:#64748b;font-size:11.5px;display:block}.pb-kpi b{font-size:26px;display:block;margin:2px 0}.pb-kpi span{font-size:12px;color:#64748b}
.pb-kpi .up,.pb-up{color:#10b981;font-weight:700}.pb-kpi .down{color:#ef4444;font-weight:700}
.pb-bars{display:flex;align-items:flex-end;gap:5px;height:120px;margin-top:8px}
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
.pb-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.pb-tbl th{background:#1e1b4b;color:#fff;text-align:center;padding:8px 8px;font-weight:600;white-space:nowrap}.pb-tbl th:first-child,.pb-tbl td:first-child{text-align:left}
.pb-tbl td{padding:8px 8px;border-bottom:1px solid #eef2f9;text-align:center}.pb-tbl td:first-child{font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pb-tbl tbody tr:nth-child(even) td{background:#f7f8ff}.pb-tbl tfoot td{font-weight:800;background:#eef2ff;border-top:2px solid #c7d2fe}
.pb-scroll{overflow:auto;margin:0 -4px}.pb-hot{color:#dc2626;font-weight:700}.pb-warn{color:#d97706;font-weight:700}
.pb-kpi.stock{background:linear-gradient(135deg,#eef2ff,#f5f3ff);border-color:#c7d2fe}.pb-kpi.last{background:linear-gradient(135deg,#fdf4ff,#fff);border-color:#f0abfc}
.pb-locked{display:none !important}
.pb-auth-card{max-width:440px;margin:28px auto;text-align:center;padding:24px 20px;border:1.5px solid #c7d2fe;background:linear-gradient(180deg,#ffffff,#f8fafc)}
.pb-auth-ico{font-size:36px;margin-bottom:6px}
.pb-auth-card h2{font-size:19px;margin-bottom:6px}
.pb-auth-form{text-align:left;margin-top:14px;display:flex;flex-direction:column;gap:12px}
.pb-fld span{display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:4px}
.pb-inp{width:100%;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:14px;outline:none}
.pb-inp:focus{border-color:var(--a);box-shadow:0 0 0 3px rgba(37,99,235,.15)}
.pb-auth-btn{background:var(--a);color:#fff;border:0;border-radius:10px;padding:11px 16px;font-size:14px;font-weight:800;cursor:pointer;margin-top:4px}
.pb-auth-err{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;padding:8px 10px;border-radius:8px;font-size:12.5px;font-weight:600}
.pb-no-sections{text-align:center;border:1px dashed #cbd5e1;background:#f8fafc}.pb-no-sections p{margin-top:6px;font-size:13px}
@media(max-width:560px){body{padding:10px}.pb-head{padding:12px}.pb-grid2{grid-template-columns:1fr}.pb-tabs-bar{align-items:flex-start}.pb-tbl{min-width:620px}}
</style></head><body><div class="pb-wrap" id="pl-root" data-token="${escHtml(token)}" data-require-auth="${requireAuth ? '1' : '0'}" data-authorized="${authorized ? '1' : '0'}" data-person="${escHtml(personName)}">
<header class="pb-head"><div class="pb-head-left"><div class="pb-logo">${escHtml(String(db.settings.brand || 'FF').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</div>
<div><h1>${heading || escHtml(title || '')}</h1>${sub ? `<p>${sub}</p>` : ''}</div></div>
${requireAuth ? `<button type="button" class="pb-btn" id="pl-lock-btn" ${authorized ? '' : 'hidden'} title="Lock Personal Link">🔒 Lock</button>` : ''}</header>
${body || ''}
</div>
${token ? '<script src="/pdf.js"></script><script src="/p-portal.js"></script>' : ''}
</body></html>`;
}
function sendHtml(res, status, html, extra = {}) {
  res.writeHead(status, headers({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), ...extra }));
  res.end(html);
}

// ---------------------------------------------------------------------------------------------
// ⚡ Compression + caching — poora app (≈2.4 MB JS/CSS) bina gzip ke bhejne par phone/hotel wifi par
// pehla load bahut slow lagta tha. Ab text assets gzip/brotli me jaate hain aur `?v=` wale URLs
// browser me 1 saal cache rehte hain (file badalne par index.html me version bump hota hai).
// ---------------------------------------------------------------------------------------------
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest\+json|xml)|image\/svg\+xml)/i;
function accepts(req, enc) {
  const h = String((req && req.headers && req.headers['accept-encoding']) || '').toLowerCase();
  return h.includes(enc);
}
/** Buffer/string ko best available encoding me bhejo (brotli → gzip → plain). */
function sendMaybeCompressed(req, res, status, contentType, body, extra = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const base = { 'Content-Type': contentType, ...extra };
  const canZip = buf.length > 1024 && COMPRESSIBLE.test(contentType);
  if (!canZip) {
    res.writeHead(status, headers({ ...base, 'Content-Length': buf.length }));
    return res.end(buf);
  }
  const headersOut = { ...base, Vary: 'Accept-Encoding' };
  let encoded = buf;
  let encoding = '';
  try {
    if (accepts(req, 'br')) { encoded = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }); encoding = 'br'; }
    else if (accepts(req, 'gzip')) { encoded = zlib.gzipSync(buf, { level: 6 }); encoding = 'gzip'; }
  } catch { encoded = buf; encoding = ''; }
  // Sirf tab compress bhejo jab sach me fayda ho.
  if (!encoding || encoded.length >= buf.length) {
    res.writeHead(status, headers({ ...base, 'Content-Length': buf.length }));
    return res.end(buf);
  }
  res.writeHead(status, headers({ ...headersOut, 'Content-Encoding': encoding, 'Content-Length': encoded.length }));
  return res.end(encoded);
}
const PERSONAL_PORTAL_JS = `(function () {
  var root = document.getElementById('pl-root');
  if (!root) return;
  var token = root.getAttribute('data-token') || '';
  var person = root.getAttribute('data-person') || 'Partner';
  var lockBtn = document.getElementById('pl-lock-btn');
  var form = document.getElementById('pl-auth-form');

  if (lockBtn) lockBtn.addEventListener('click', function () {
    lockBtn.disabled = true;
    fetch('/api/public/personal-link/logout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).finally(function () { window.location.reload(); });
  });

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var idInp = document.getElementById('pl-inp-id');
      var mobInp = document.getElementById('pl-inp-mob');
      var errEl = document.getElementById('pl-auth-err');
      var btn = document.getElementById('pl-auth-btn');
      var pid = (idInp && idInp.value || '').trim();
      var mob = (mobInp && mobInp.value || '').replace(/\\D/g, '').slice(-10);
      if (errEl) errEl.hidden = true;
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Verifying…'; }
      fetch('/api/public/personal-link/verify', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, personId: pid, mobile: mob })
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, json: j }; });
      }).then(function (out) {
        if (!out.ok) throw new Error((out.json && out.json.error) || 'Verification failed');
        // The next GET is checked again at the server boundary and only then returns report HTML.
        window.location.reload();
      }).catch(function (err) {
        if (errEl) { errEl.textContent = '⚠️ ' + (err.message || 'Verification failed'); errEl.hidden = false; }
        if (btn) { btn.disabled = false; btn.textContent = '🔓 Verify & Open Report'; }
      });
    });
  }

  // Tab switching
  var tabBtns = document.querySelectorAll('[data-pl-tab]');
  var panes = document.querySelectorAll('[data-pl-pane]');
  Array.prototype.forEach.call(tabBtns, function (b) {
    b.addEventListener('click', function () {
      var target = b.getAttribute('data-pl-tab');
      Array.prototype.forEach.call(tabBtns, function (x) { x.classList.toggle('on', x === b); });
      Array.prototype.forEach.call(panes, function (p) {
        p.hidden = target !== 'all' && p.getAttribute('data-pl-pane') !== target;
      });
    });
  });

  function extractTable(tbl) {
    if (!tbl) return null;
    var headers = Array.prototype.map.call(tbl.querySelectorAll('thead th'), function (th) {
      return (th.innerText || th.textContent || '').replace(/\\s+/g, ' ').trim();
    });
    var rows = [];
    Array.prototype.forEach.call(tbl.querySelectorAll('tbody tr, tfoot tr'), function (tr) {
      var cells = Array.prototype.map.call(tr.querySelectorAll('th, td'), function (td) {
        return (td.innerText || td.textContent || '').replace(/\\s+/g, ' ').trim();
      });
      if (cells.length) rows.push(cells);
    });
    return { headers: headers, rows: rows };
  }
  function downloadCsv(filename, headers, rows) {
    var esc = function (v) {
      var s = String(v == null ? '' : v);
      return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = [headers.map(esc).join(',')].concat(rows.map(function (r) { return r.map(esc).join(','); }));
    var blob = new Blob(['\\ufeff' + lines.join('\\r\\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  function exportPdfTables(title, tables) {
    if (window.FF && FF.pdf && FF.pdf.doc) {
      var doc = FF.pdf.doc({ title: title, sub: person + ' · Personal Report', right: new Date().toLocaleDateString('en-IN') });
      var kpis = [];
      Array.prototype.forEach.call(document.querySelectorAll('.pb-kpi'), function (el) {
        var sm = el.querySelector('small'), b = el.querySelector('b'), sp = el.querySelector('span');
        if (sm && b) kpis.push({ label: sm.textContent.trim(), value: b.textContent.trim(), sub: sp ? sp.textContent.trim() : '', tone: 'blue' });
      });
      if (kpis.length) doc.kpis(kpis.slice(0, 6));
      tables.forEach(function (t) {
        if (!t || !t.rows.length) return;
        doc.section(t.title || title, t.rows.length + ' rows');
        var cols = t.headers.map(function (h, i) { return { label: h || ('Col ' + (i + 1)), align: i === 0 ? 'left' : 'right', bold: i === 0 }; });
        doc.table(cols, t.rows);
      });
      var blob = doc.finish();
      if (blob) { FF.pdf.download(blob, title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf'); return; }
    }
    window.print();
  }

  document.addEventListener('click', function (e) {
    var csvBtn = e.target.closest && e.target.closest('[data-pl-csv]');
    if (csvBtn) {
      var tbl = document.getElementById(csvBtn.getAttribute('data-pl-csv'));
      var data = extractTable(tbl);
      if (data && data.rows.length) {
        var title = csvBtn.getAttribute('data-pl-title') || (person + '-report');
        downloadCsv(title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv', data.headers, data.rows);
      }
      return;
    }
    var pdfBtn = e.target.closest && e.target.closest('[data-pl-pdf]');
    if (pdfBtn) {
      var tbl2 = document.getElementById(pdfBtn.getAttribute('data-pl-pdf'));
      var data2 = extractTable(tbl2);
      if (data2 && data2.rows.length) {
        var title2 = pdfBtn.getAttribute('data-pl-title') || (person + ' Report');
        exportPdfTables(title2, [{ title: title2, headers: data2.headers, rows: data2.rows }]);
      }
      return;
    }
    if (e.target.id === 'pl-exp-all-csv') {
      var allHeaders = ['Section', 'Col 1', 'Col 2', 'Col 3', 'Col 4', 'Col 5', 'Col 6', 'Col 7', 'Col 8'];
      var allRows = [];
      Array.prototype.forEach.call(document.querySelectorAll('table.pb-tbl'), function (t) {
        var d = extractTable(t);
        if (!d || !d.rows.length) return;
        var sec = t.closest('.pb-card') && t.closest('.pb-card').querySelector('h3');
        var secName = sec ? sec.textContent.trim() : t.id;
        allRows.push([secName].concat(d.headers));
        d.rows.forEach(function (r) { allRows.push([secName].concat(r)); });
      });
      if (allRows.length) downloadCsv((person + '-full-report').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv', allHeaders, allRows);
      return;
    }
    if (e.target.id === 'pl-exp-all-pdf') {
      var list = [];
      Array.prototype.forEach.call(document.querySelectorAll('table.pb-tbl'), function (t) {
        var d = extractTable(t);
        if (!d || !d.rows.length) return;
        var sec = t.closest('.pb-card') && t.closest('.pb-card').querySelector('h3');
        list.push({ title: sec ? sec.textContent.trim() : 'Table', headers: d.headers, rows: d.rows });
      });
      exportPdfTables(person + ' - Complete Performance & Stock Report', list);
    }
  });
})();`;

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
    if (url.pathname === '/p-portal.js') {
      return sendMaybeCompressed(req, res, 200, 'application/javascript; charset=utf-8', PERSONAL_PORTAL_JS, { 'Cache-Control': 'no-cache' });
    }
    if (url.pathname.startsWith('/p/')) {
      try { return await servePersonalPage(req, res, url.pathname.slice(3)); } catch (err) { console.error(err); return sendText(res, 500, 'Server error'); }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    return await serveStatic(req, res, url.pathname, url.search);
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
      // ⏪ Nayi/khaali sheet + khaali server disk = abhi-abhi defaults seed hone waale hain.
      // Purana data tab aksar kisi PURANI sheet me hota hai — Settings → Recovery me wapas la sakte hain.
      storageSeededFresh = !!process.env.RENDER && (!Array.isArray(stored.users) || stored.users.length === 0);
      console.log('APP_STORAGE (Apps Script) is empty → seeding it from the current local data.');
      if (storageSeededFresh) console.warn('⚠️  Yeh sheet nayi/khaali thi — is server par koi purana data nahi mila. Agar users/settings pehle kisi AUR sheet me save the to Settings → ☁️ Storage & backup → ⏪ Recovery → "Doosri (purani) Google Sheet se data lao" se wapas layein.');
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
    // 🛡️ Render safety: an empty /data must NEVER silently bootstrap a fresh admin/settings store.
    // A missing/unmounted disk would otherwise make existing login, theme, branding and history appear
    // to be reset after a deploy. Fresh Render installs must explicitly opt in with ALLOW_FRESH_RENDER=1.
    if (process.env.RENDER && STORAGE_BACKEND === 'files' && (!Array.isArray(stored.users) || stored.users.length === 0) && process.env.ALLOW_FRESH_RENDER !== '1') {
      throw new Error('Persistent data store is empty on Render. Existing users/settings were NOT reset. Mount /data or restore the existing storage first; set ALLOW_FRESH_RENDER=1 only for a genuinely new installation.');
    }
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
  // 🔐 Panel-permission migration (v3.8.2 / v3.37) — existing users ka access lock na ho.
  await migrateUserPermissions();
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
    setInterval(() => checkReports(false).catch(() => {}), 3 * 60e3).unref();
    setTimeout(() => maybeMonthlyReport(), 8000);
    setInterval(() => maybeMonthlyReport(), 60 * 60e3).unref();
    // 🌅 Scheduled checks: daily digest (subah 8 IST ke baad roz ek baar) + mid-month target +
    //    weekly inactive users + 🔴 cover alert / 📉 stock history — boot par aur har 30 min.
    setTimeout(() => runScheduledChecks(), 15000);
    setInterval(() => runScheduledChecks(), 30 * 60e3).unref();
    // ⏪ v3.48: sheet history me purani saves hain to admin ko batao (khud kuch restore nahi karta).
    if (CLOUD_BACKEND) setTimeout(() => recoveryHint().catch(() => {}), 20000).unref?.();
    // 🧓 Stock ageing index pehle se bana lo (pehla user 1-2 min intezaar na kare). Render par default ON; STOCK_AGE_WARM=0 se band.
    const warmStockAge = process.env.STOCK_AGE_WARM ? process.env.STOCK_AGE_WARM !== '0' : !!process.env.RENDER;
    if (warmStockAge) setTimeout(() => stockAgeIndex(false).catch((err) => console.warn('stock ageing warm-up:', err.message)), 12000).unref();
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