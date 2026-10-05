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

  // Cache-busting version — index.html ke <script src="...?v=45"> ke saath sync me rakho.
  const VERSION = (function () {
    try {
      const tag = document.querySelector('script[src*="config.js?v="]') || document.querySelector('script[src*="app.js?v="]');
      const m = tag && /[?&]v=([\w.]+)/.exec(tag.getAttribute('src') || '');
      return m ? m[1] : '72';
    } catch { return '72'; }
  })();

  // Page id → modules + transitive page dependencies (order matter karta hai).
  // Lazy-loading me sirf page file load karna kaafi nahi tha: kuch purane modules
  // agentBoard/masterProfile/cockpit/insights jaise helpers ko render-time par use karte hain.
  // In dependencies ko yahin centralize karke page-open errors ko prevent karte hain.
  const INSIGHT_DEPS = ['insights', 'directAgents', 'certificates', 'cockpit'];
  const PROFILE_DEPS = [...INSIGHT_DEPS, 'gvTruth', 'pdf', 'masterProfile'];
  const SUMMARY_DEPS = [...PROFILE_DEPS, 'agentSummary'];
  const WOW_DEPS = [...INSIGHT_DEPS, 'wow', 'wowzone'];
  const GROUPS = {
    home: ['home'],
    controlTower: ['controlTower'],
    executive: [...INSIGHT_DEPS],
    tagRequest: ['pdf', 'tagRequest'],
    masterSearch: [...PROFILE_DEPS, 'searchReport', 'masterSearch'],
    tagIssued: ['tagIssued'],
    performance: [...PROFILE_DEPS, 'agentBoard', 'performance'],
    targets: ['targets'],
    rangeReport: ['rangeReport'],
    tv: ['tv'],
    teamMap: ['map'],
    dashboard: [...WOW_DEPS, 'dashboard'],
    trend: ['trend'],
    stock: ['stock'],
    ffCommission: [...INSIGHT_DEPS],
    gvDashboard: ['gvpages'],
    gvTrend: ['gvpages'],
    gvStock: ['gvpages'],
    gvStockReport: ['gvpages'],
    gvPerformance: ['gvpages'],
    gvCommission: [...PROFILE_DEPS, 'agentBoard', 'gvpages', 'insights'],
    dualChannel: [...INSIGHT_DEPS],
    masterStock: [...INSIGHT_DEPS],
    compare: [...INSIGHT_DEPS, 'map', 'compare'],
    charts: [...INSIGHT_DEPS, 'chartExplorer'],
    forecast: [...INSIGHT_DEPS],
    dataQuality: [...INSIGHT_DEPS],
    savedViews: [...INSIGHT_DEPS],
    reportStudio: [...INSIGHT_DEPS],
    followups: [...INSIGHT_DEPS],
    fastagChampions: [...INSIGHT_DEPS],
    dispatchPlan: [...PROFILE_DEPS, 'dispatchPlanner'],
    tlScorecard: [...INSIGHT_DEPS],
    directAgents: ['directAgents'],
    newAgents: [...PROFILE_DEPS, 'newAgents'],
    unusual: ['pdf', 'unusual-scan', 'unusual'],
    ffAgentSummary: [...SUMMARY_DEPS, 'agentSummary', 'gvTruth', 'summaryUI'],
    gvAgentSummary: [...SUMMARY_DEPS, 'gvpages', 'agentSummary', 'gvTruth', 'agentBoard', 'summaryUI'],
    arena: [...WOW_DEPS],
    fame: [...WOW_DEPS],
    warRoom: [...WOW_DEPS],
    activity: [...WOW_DEPS],
    network: [...WOW_DEPS],
    radar: [...WOW_DEPS],
    reportCards: [...WOW_DEPS],
    sprints: [...WOW_DEPS, 'sprints'],
    stockRadar: ['stockRadar'],
    settings: [...PROFILE_DEPS, 'agentSummary', 'unusual-scan', 'unusual', 'settings']
  };

  // Background warm order (login ke baad idle me) — jo pages sabse zyada khulte hain wo pehle.
  // Bhaari module (insights 330 KB+) sabse aakhir me, taaki pehle paint par asar na pade.
  const WARM = ['pdf', 'tagIssued', 'stock', 'dashboard', 'trend', 'gvpages', 'wowzone', 'targets', 'settings', 'tagRequest', 'cockpit', 'insights'];

  const loaded = new Map();   // name → promise
  const failed = new Set();

  function inject(name) {
    if (loaded.has(name)) return loaded.get(name);
    const p = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      const assetVersion = name === 'settings' ? `${VERSION}-pwa2` : VERSION;
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
      if (typeof FF[name] !== 'undefined') { loaded.set(name, Promise.resolve(name)); continue; }
      await inject(name);
    }
  }

  /** Us page ka module (aur uski dependencies) load karo. */
  function ensure(page) { return loadList(GROUPS[page] || []); }
  /** Sab page modules — fallback jab page ka module kisi group me na mile. */
  function ensureAll() { return loadList([...new Set(Object.values(GROUPS).flat())]); }
  /** Ek ya zyada module by name. */
  function need(names) { return loadList(Array.isArray(names) ? names : [names]); }

  // Background warm — idle me ek-ek module, chhote break ke saath (network/data queries se compete na kare).
  let warmed = false;
  function warm() {
    if (warmed) return; warmed = true;
    const idle = window.requestIdleCallback ? (fn, t) => window.requestIdleCallback(fn, { timeout: t || 3000 }) : (fn) => setTimeout(fn, 1200);
    let i = 0;
    const next = () => {
      if (i >= WARM.length) return;
      const page = WARM[i++];
      idle(() => {
        ensure(page).then(() => setTimeout(next, 350)).catch(() => setTimeout(next, 1200));
      }, 4000);
    };
    setTimeout(next, 1500);
  }

  FF.lazy = { ensure, ensureAll, need, inject, warm, GROUPS, WARM, get loaded() { return [...loaded.keys()]; }, get failed() { return [...failed]; } };
})(window.FF || {});