// Versioned app shell + offline data cache.
// Auth login/logout/password endpoints are NEVER cached. Sheet data (gviz), /api/auth/me and
// /api/settings are network-first with a cached fallback — internet na ho to last loaded data se app khulta hai.
const CACHE_NAME = 'apnapayment-v79';
const DATA_CACHE = 'ff-data-v5';
const STASH_CACHE = 'ff-push-stash-v1'; // pushsubscriptionchange ke waqt bani subscription yahan rakho
// 🔊 v3.36 — app band hone par aaye alerts ki VOICE queue (page khulte hi bol kar sunata hai).
const VOICE_CACHE = 'ff-voice-v1';
const VOICE_KEY = '/__ff_voice__/pending';
const VOICE_MAX = 8;                    // itni lines se zyada catch-up nahi (spam nahi)
const VOICE_TTL = 12 * 3600e3;          // 12 ghante tak wapas kholte hi suna denge
// ⚡ Sirf eager core precache hota hai (pehla paint fast). Baaki page modules (lazy rollup)
//    pehli use par runtime-cache ho jaate hain — install par 2 MB extra download nahi hota.
const ASSETS = ['./', './index.html', './styles.css?v=71', './controlTower.css?v=1', './config.js?v=71', './util.js?v=71', './i18n.js?v=71', './xlsx.js?v=71', './data.js?v=71', './stockAge.js?v=71', './charts.js?v=71', './model.js?v=71', './filters.js?v=71', './store.js?v=71', './gv.js?v=71', './preload.js?v=71', './auth.js?v=71', './notifications.js?v=71', './sheets.js?v=71', './liveView.js?v=71', './kpiDetail.js?v=71', './home.js?v=71', './performance.js?v=71', './agentBoard.js?v=71', './masterProfile.js?v=71', './masterSearch.js?v=71', './searchReport.js?v=71', './palette.js?v=71', './assistant.js?v=71', './officeBell.js?v=71', './pushVoice.js?v=71', './liveAssist.js?v=71', './morningCard.js?v=71', './lazy.js?v=71', './publicForm.js?v=71', './app.js?v=71', './logos/apna-payment.png', './favicon.svg?v=5', './icon-192.png?v=5', './icon-512.png?v=5'];
// Network-first snapshots survive a temporary connection loss; auth/actions remain live-only.
const OFFLINE_API = (path) => path === '/api/gviz' || path === '/api/today' || path === '/api/auth/me' || path === '/api/settings' || path === '/api/stock-history';

// ---- 🔊 Short notification beep (generated with Web Audio on push, no external asset needed) ----
// Base64-encoded silent fallback + a simple beep tone via AudioContext doesn't work from SW global scope
// reliably, so we use a tiny embedded WAV (200ms beep @ 880Hz) generated at build-time.