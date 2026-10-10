/* ⚡ Lazy page modules — pehla load halka rakhne ke liye.
 *
 *   Pehle index.html ke 50+ <script> ek saath download hote the (~2.4 MB JS). Ab sirf **core**
 *   (shell + Home + search + KPI drawer) eager rehta hai; har page ka apna module us page ko
 *   kholne par aata hai. Login ke baad idle time me background me warm bhi ho jata hai, isliye
 *   normal navigation me koi rukavat mehsoos nahi hoti.
 *
 *   API:
 *     FF.lazy.ensure(page)   → us page ke modules load karke promise (already loaded ho to turant)
 *     FF.lazy.ensureAll()    → sab page modules (fallback jab page map me na ho)
 *     FF.lazy.inject(name)   → ek module by name
 *     FF.lazy.warm()         → idle me background pre-load (login ke baad)
 *     FF.lazy.state          → { loaded: [...], failed: [...] } debug ke liye
 */
window.FF = window.FF || {};
(function (FF) {
  'use strict';

  // Cache-busting version.
  // 🧬 v3.60 — server index.html me `<meta name="ff-asset-versions">` bhejta hai: har module ka
  //    CONTENT FINGERPRINT. Isse lazy module ka URL uske apne content se banta hai (pehle sab modules
  //    config.js ka version inherit karte the → ek file badalne par manual bump miss ho jaata tha aur
  //    phone par purana module 1 saal tak immutable cache me phansa reh jaata tha).
  const VERSIONS = (function () {
    try {
      const meta = document.querySelector('meta[name="ff-asset-versions"]');
      const map = meta && JSON.parse(meta.getAttribute('content') || '{}');
      return map && typeof map === 'object' ? map : {};
    } catch { return {}; }
  })();
  const VERSION = (function () {
    try {
      const tag = document.querySelector('script[src*="config.js?v="]') || document.querySelector('script[src*="app.js?v="]');
      const m = tag && /[?&]v=([\w.-]+)/.exec(tag.getAttribute('src') || '');
      return m ? m[1] : '72';
    } catch { return '72'; }
  })();
  /** Module ka apna version (content fingerprint) — na mile to shell ka VERSION. */
  function versionFor(name) {
    const own = VERSIONS[name];
    if (own) return VERSION ? `${VERSION.split('-')[0]}-${own}` : own;
    return VERSION;
  }

  // Page id → modules + transitive page dependencies (order matter karta hai).
  // Lazy-loading me sirf page file load karna kaafi nahi tha: kuch purane modules
  // agentBoard/masterProfile/cockpit/insights jaise helpers ko render-time par use karte hain.
  // In dependencies ko yahin centralize karke page-open errors ko prevent karte hain.
  const INSIGHT_DEPS = ['insights', 'directAgents', 'certificates', 'cockpit'];
  // v3.52 — `performance` (FF REPORT tab reader) PROFILE_DEPS me: masterProfile FF agent/TL ka
  // stock · priority · suggested dispatch FF.pages.performance se padhta hai. Pehle Master Search /
  // Tag Request / Summary pages par ye module load hi nahi hota tha (sirf Performance page kholne par
  // aata tha) → FF profile me "REPORT me row nahi mili", stock 0, priority —, suggested 0.
  const PROFILE_DEPS = [...INSIGHT_DEPS, 'gvTruth', 'pdf', 'agentBoard', 'performance', 'masterProfile'];
  const SUMMARY_DEPS = [...PROFILE_DEPS, 'agentSummary'];
  // 🧹 v3.62 — Wow Zone pages (arena/fame/warRoom/activity/network/radar/reportCards/sprints) hata
  // diye gaye, isliye `wow`/`wowzone` ab kisi page ki dependency nahi hain. `wowzone` (66 KB) sirf
  // theme-packs + tab heartbeat ke liye chahiye — wo ab on-demand aata hai (app.js mountShellExtras),
  // pehle har page open karne par background me 1 MB+ JS parse hota tha.
  const GROUPS = {
    home: ['home'],
    tagRequest: ['pdf', 'performance', 'tagRequest'],   // performance = FF REPORT (stock / priority) — employee link par bhi
    masterSearch: [...PROFILE_DEPS, 'searchReport', 'masterSearch'],
    bulkTagStatus: ['bulkTagStatus'],
    tagIssued: ['tagIssued'],
    performance: [...PROFILE_DEPS, 'agentBoard', 'performance'],
    targets: ['targets'],
    rangeReport: ['rangeReport'],
    teamMap: ['map'],
    dashboard: ['dashboard'],
    trend: ['trend'],
    stock: ['stock'],
    gvDashboard: ['gvpages'],
    gvTrend: ['gvpages'],
    gvStock: ['gvpages'],
    gvStockReport: ['gvpages'],
    fastagMapping: ['fastagMapping'],
    gvPerformance: ['gvpages'],
    dualChannel: [...INSIGHT_DEPS],
    masterStock: [...INSIGHT_DEPS],
    compare: [...INSIGHT_DEPS, 'map', 'compare'],
    dataQuality: [...INSIGHT_DEPS],
    fastagChampions: [...INSIGHT_DEPS],
    dispatchPlan: [...PROFILE_DEPS, 'dispatchPlanner'],
    directAgents: ['kpiDetail', 'directAgents'],   // KPI drill lists kpiDetail me register hoti hain
    newAgents: [...PROFILE_DEPS, 'newAgents'],
    unusual: ['pdf', 'unusual-scan', 'unusual'],
    ffAgentSummary: [...SUMMARY_DEPS, 'agentSummary', 'gvTruth', 'summaryUI'],
    gvAgentSummary: [...SUMMARY_DEPS, 'gvpages', 'agentSummary', 'gvTruth', 'agentBoard', 'summaryUI'],
    settings: [...PROFILE_DEPS, 'agentSummary', 'unusual-scan', 'unusual', 'settings']
  };

  // Background warm order (login ke baad idle me) — jo pages sabse zyada khulte hain wo pehle.
  // Bhaari module (insights 330 KB+) sabse aakhir me, taaki pehle paint par asar na pade.
  const WARM = ['pdf', 'performance', 'tagIssued', 'stock', 'dashboard', 'trend', 'gvpages', 'targets', 'settings', 'tagRequest', 'cockpit', 'insights'];
  // 📱 v3.60 — phone par 2 MB JS background me parse karwana hi "app leg karti hai" ka sabse bada
  // karan tha. Isliye warm ab device ke hisaab se hota hai: touch device par sirf roz kaam aane
  // wale 3 modules (wo bhi 25s baad, jab tak user idle ho), data-saver/2G/low-end par bilkul nahi.
  const WARM_TOUCH = ['performance', 'tagIssued', 'stock'];
  function deviceProfile() {
    const nav = (typeof navigator !== 'undefined' && navigator) || {};
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
    const mq = (q) => { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch { return false; } };
    // Primary input touch ho to hi "phone" maano — touch-screen laptop par desktop jaisa warm chahiye.
    const coarse = window.matchMedia ? mq('(pointer: coarse)')
      : (Number(nav.maxTouchPoints || 0) > 0 && !/Windows NT|Mac OS X|Linux x86_64/i.test(String(nav.userAgent || '')));
    const saveData = conn.saveData === true || /^(slow-)?2g$/.test(String(conn.effectiveType || ''));
    const lowEnd = (Number(nav.deviceMemory) > 0 && Number(nav.deviceMemory) <= 3)
      || (Number(nav.hardwareConcurrency) > 0 && Number(nav.hardwareConcurrency) <= 3);
    return { coarse, saveData, lowEnd, net: String(conn.effectiveType || '') };
  }

  const loaded = new Map();   // name → promise
  const failed = new Set();

  function inject(name) {
    if (loaded.has(name)) return loaded.get(name);
    const p = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      // settings.js ka '-pwa2' suffix purana manual cache-bust tha; ab content fingerprint hi
      // kaafi hai, isliye suffix sirf tab lagta hai jab fingerprint na mile (purana server).
      const base = versionFor(name);
      const assetVersion = name === 'settings' && !VERSIONS.settings ? `${base}-pwa2` : base;
      el.src = `./${name}.js?v=${assetVersion}`;
      el.defer = true;
      el.async = true;
      el.onload = () => resolve(name);
      el.onerror = () => reject(new Error(`${name}.js load nahi hua`));
      document.head.appendChild(el);
    }).catch((err) => {
      loaded.delete(name);
      failed.add(name);
      console.warn('lazy:', err.message);
      return null;
    });
    loaded.set(name, p);
    return p;
  }

  async function loadList(list) {
    for (const name of list || []) {
      // Eager page modules register under FF.pages.<name>, not FF.<name>.
      // Recognize both forms so an eager module (especially Home) is never downloaded again
      // during the boot gate. A duplicate home.js request could otherwise keep first paint stuck.
      if (typeof FF[name] !== 'undefined' || (FF.pages && typeof FF.pages[name] !== 'undefined')) {
        loaded.set(name, Promise.resolve(name)); continue;
      }
      await inject(name);
    }
  }

  // 🧩 v3.60 — kpiDetail/stockAge ab shell extras me hain (first paint ke baad). Ye modules KPI drill
  // lists register karte hain; agar user login ke turant baad (extras load hone se pehle) aisa page
  // khol le to registration skip ho jaati thi. Isliye in pages ke saath drill modules parallel load
  // hote hain — page ke module ka wait nahi badhta, dono saath me aate hain.
  const KPI_REGISTERING = new Set(['performance', 'agentBoard', 'gvpages', 'newAgents', 'targets', 'settings']);
  /** Us page ka module (aur uski dependencies) load karo. */
  function ensure(page) {
    const list = GROUPS[page] || [];
    if (list.some((name) => KPI_REGISTERING.has(name))) {
      return Promise.all([loadList(list), loadList(['kpiDetail', 'stockAge'])]).then(() => undefined);
    }
    return loadList(list);
  }
  /** Sab page modules — fallback jab page ka module kisi group me na mile. */
  function ensureAll() { return loadList([...new Set(Object.values(GROUPS).flat())]); }
  /** Ek ya zyada module by name. */
  function need(names) { return loadList(Array.isArray(names) ? names : [names]); }

  // Background warm — idle me ek-ek module, chhote break ke saath (network/data queries se compete na kare).
  let warmed = false;
  function warm() {
    if (warmed) return; warmed = true;
    const dev = deviceProfile();
    if (dev.saveData) return;                                   // data-saver / 2G → kuch bhi background me mat kheecho
    const list = dev.coarse ? (dev.lowEnd ? [] : WARM_TOUCH) : WARM;
    if (!list.length) return;
    const startDelay = dev.coarse ? 25000 : 6000;               // phone par pehle data + scroll smooth, phir warm
    const gap = dev.coarse ? 1500 : 350;
    const idle = window.requestIdleCallback ? (fn, t) => window.requestIdleCallback(fn, { timeout: t || 3000 }) : (fn) => setTimeout(fn, 1200);
    let i = 0;
    const next = () => {
      if (i >= list.length) return;
      // Tab background me ho to warm rok do — wapas aane par continue (CPU/battery dono bachti hai).
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { setTimeout(next, 5000); return; }
      const page = list[i++];
      idle(() => {
        ensure(page).then(() => setTimeout(next, gap)).catch(() => setTimeout(next, 1200));
      }, dev.coarse ? 8000 : 4000);
    };
    setTimeout(next, startDelay);
  }

  // 🐚 Shell extras — ye modules pehle index.html me eager the (≈550 KB extra parse first paint se
  //    PEHLE). Ab first paint ke baad chhoti waves me aate hain aur apne hooks khud chala lete hain
  //    (notifications bell, KPI drill drawer, search, assistant, office bell, live assist).
  const SHELL_WAVES = [
    // Global search is a core shell affordance — load it in the first idle wave.
    ['masterSearch', 'palette', 'notifications', 'liveView'],
    ['kpiDetail', 'stockAge'],
    ['officeBell', 'pushVoice'],
    ['assistant', 'liveAssist', 'morningCard']
  ];
  let shellPromise = null;
  /** First paint ke baad shell extras load karo; har wave ke baad `afterWave(wave)` hook chalta hai. */
  function shell(opts) {
    if (shellPromise) return shellPromise;
    const o = opts || {};
    const dev = deviceProfile();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const idle = (fn, timeout) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout }) : setTimeout(fn, Math.min(400, timeout)));
    shellPromise = (async () => {
      for (const wave of SHELL_WAVES) {
        // Paint/scroll se compete na kare: idle me hi agla wave, phone par thoda zyada gap.
        await new Promise((r) => idle(r, dev.coarse ? 4000 : 1500));
        await loadList(wave);
        if (typeof o.afterWave === 'function') { try { o.afterWave(wave); } catch { /* hook optional */ } }
        if (dev.coarse) await wait(250);
      }
      return true;
    })();
    return shellPromise;
  }
  /** Ek shell module turant chahiye (bell click, KPI drill, Ctrl+K) — load karke promise. */
  function shellNeed(names) { return loadList(Array.isArray(names) ? names : [names]); }

  FF.lazy = { ensure, ensureAll, need, inject, warm, shell, shellNeed, deviceProfile, GROUPS, WARM, SHELL_WAVES, get loaded() { return [...loaded.keys()]; }, get failed() { return [...failed]; } };
})(window.FF || {});