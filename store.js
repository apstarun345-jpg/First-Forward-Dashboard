/* Central data store: everything the pages need is loaded ONCE (in parallel) when the site opens, and again
   only when the user presses ↻ (force fresh from Google) or reloads the browser. Pages render from memory. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, D = FF.data;

  const DATASETS = {
    daily: { label: 'EIR · daily issuance', load: (o) => M.loadDaily(null, o) },
    agents: { label: 'EIR · agents by month', load: (o) => M.loadAgents(o) },
    agentClass: { label: 'EIR · agent class split', load: (o) => M.loadAgentClassMonthly(o) },
    agentDailyClass: { label: 'EIR · today agent class breakdown', load: (o) => M.loadAgentDailyClass(o) },
    status: { label: 'EIR · tag status', load: (o) => M.loadStatus(o) },
    stock: { label: 'StockDataa · class × TL', load: (o) => M.loadStock(o) },
    stockAgents: { label: 'StockDataa · agent × class', load: (o) => M.loadStockAgents(o) },
    stockTypes: { label: 'StockDataa · agent × type', load: (o) => M.loadStockAgentTypes(o) },
    report: { label: 'REPORT sheet', load: (o) => D.query(FF.config.report.sheet, '', { ...o, gid: FF.config.report.gid }) }
  };
  const state = { data: {}, errors: {}, retrying: false, loading: false, loadedAt: null, progress: { done: 0, total: 0 }, promise: null, listeners: new Set() };

  function emit(event, detail) { state.listeners.forEach((fn) => { try { fn(event, detail); } catch (e) { console.error(e); } }); }
  function on(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }

  /** Load all datasets in parallel. fresh=true bypasses the server cache (Google se naya data). */
  let generation = 0;
  const jobs = new Map();
  // v3.125.51 — kis config (column letters) se dataset bana — settings badle to purana dobara bane.
  const cfgFp = () => { try { const c = FF.config; return JSON.stringify([c.sheetId, c.eir, c.stock, c.report && [c.report.sheet, c.report.gid]]); } catch { return ''; } };
  const builtWith = {};
  const jobKey = (key, fp) => `${key}\u0000${fp}`;
  const keyOfJob = (jk) => String(jk).split('\u0000')[0];
  function loadKey(key, fresh) {
    const fp = cfgFp();
    const jk = jobKey(key, fp);
    if (jobs.has(jk)) return jobs.get(jk);
    const version = generation;
    // Settings (column letters) beech me badal gaye → purana result chhodo, naye config ka job lo.
    const moved = () => version === generation && fp !== cfgFp();
    const p = Promise.resolve().then(() => DATASETS[key].load({ fresh })).then((value) => {
      if (moved()) return loadKey(key, fresh);
      if (version === generation) { state.data[key] = value; builtWith[key] = fp; delete state.errors[key]; }
      return value;
    }, (err) => {
      if (moved()) return loadKey(key, fresh);
      if (version === generation) {
        state.errors[key] = err;
        // 🔁 Any failed load (also page-level `need(key, { only: true })`) joins the background auto-retry.
        if (!state.retrying) setTimeout(() => { if (version === generation && !state.retrying && state.errors[key]) scheduleRetry(version, 0); }, 0);
      }
      throw err;
    }).finally(() => {
      if (version !== generation) return;
      jobs.delete(jk);
      state.progress.done++;
      emit('progress', { key, ...state.progress });
    });
    jobs.set(jk, p);
    return p;
  }
  // ⚡ Boot order: pehle wo datasets jo Home/first paint ke liye chahiye, phir baaki.
  //    Sab ek saath (9 queries) bhejne par Google gviz ki ek hi sheet serialise karti hai aur
  //    pehla page late paint hota tha — isliye 3 workers me limited queue.
  const PRIORITY = ['daily', 'agents', 'agentClass', 'report', 'stock', 'stockAgents', 'status', 'agentDailyClass', 'stockTypes'];
  const LOAD_WORKERS = 3;
  async function runQueue(keys, fresh) {
    const queue = keys.slice();
    const workers = Array.from({ length: Math.max(1, Math.min(LOAD_WORKERS, queue.length)) }, async () => {
      while (queue.length) {
        const key = queue.shift();
        await loadKey(key, !!fresh).catch(() => {});
      }
    });
    await Promise.all(workers);
  }
  function preload(fresh) {
    if (state.loading) return state.promise;
    if (state.promise && !fresh && !Object.keys(state.errors).length) return state.promise;
    const all = Object.keys(DATASETS);
    const keys = [...PRIORITY.filter((k) => all.includes(k)), ...all.filter((k) => !PRIORITY.includes(k))];
    const version = generation;
    state.loading = true; state.errors = {}; state.progress = { done: 0, total: keys.length };
    emit('start');
    state.promise = runQueue(keys, fresh).then(() => {
      if (version === generation) {
        state.loading = false; state.loadedAt = Date.now();
        emit('done');
        scheduleRetry(version, 0);
      }
      return state.data;
    });
    return state.promise;
  }
  // 🔁 Auto-retry (v3.32): jo sheet fail hui ("2 sheet fail") unhe background me khud dobara load karo —
  //    backoff 4s · 10s · 20s · 40s · 75s. Sab theek hote hi status ✓ ho jata hai aur open page refresh hota hai.
  const RETRY_DELAYS = [4000, 10000, 20000, 40000, 75000];
  let retryTimer = null;
  function scheduleRetry(version, round) {
    clearTimeout(retryTimer);
    const failed = Object.keys(state.errors).filter((k) => DATASETS[k]);
    const browser = typeof document !== 'undefined' && typeof window !== 'undefined' && !!window.addEventListener;
    if (!failed.length || version !== generation || (!browser && round >= RETRY_DELAYS.length)) { state.retrying = false; return; }
    // After the fast backoff, keep healing every 90s (visible tab only) instead of giving up.
    const wait = round < RETRY_DELAYS.length ? RETRY_DELAYS[round] : 90000;
    state.retrying = true; state.retryRound = round + 1;
    emit('retry', { keys: failed, round: round + 1 });
    retryTimer = setTimeout(async () => {
      if (version !== generation) return;
      if (typeof document !== 'undefined' && document.hidden && round >= RETRY_DELAYS.length) { scheduleRetry(version, round); return; }
      const list = Object.keys(state.errors).filter((k) => DATASETS[k]);
      list.forEach((k) => { delete state.errors[k]; });
      await runQueue(list, true);
      if (version !== generation) return;
      const left = Object.keys(state.errors).length;
      state.loadedAt = Date.now();
      if (!left) {
        state.retrying = false;
        emit('refresh', { healed: list });
        try { if (FF.app && FF.app.renderCurrent) FF.app.renderCurrent(); if (FF.util && FF.util.toast) FF.util.toast('✅ Fail hui sheets auto-retry se load ho gayi', 'ok'); } catch { /* ignore */ }
        emit('done');
      } else scheduleRetry(version, round + 1);
    }, wait);
    if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();   // never keep a Node (test) process alive
  }
  /** Fail hui sheets abhi turant dobara try (status bar par click). */
  function retryNow() { scheduleRetry(generation, 0); }
  // Network back / tab visible again → retry failed sheets right away.
  try { if (typeof window !== 'undefined' && window.addEventListener) { window.addEventListener('online', () => { if (Object.keys(state.errors).length) retryNow(); }); document.addEventListener('visibilitychange', () => { if (!document.hidden && Object.keys(state.errors).length && !state.retrying) retryNow(); }); } } catch { /* non-browser */ }
  // ⚡ v3.125.50 — browser snapshot se turant dikha data; Google ka naya data aate hi (ff:data-fresh) chup-chaap dobara bana kar page update.
  try {
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('ff:data-fresh', async () => {
      const keys = Object.keys(state.data).filter((k) => DATASETS[k]);
      if (!keys.length) return;
      const version = generation;
      await Promise.allSettled(keys.map((k) => loadKey(k, false)));
      if (version !== generation) return;
      state.loadedAt = Date.now();
      emit('refresh', { fresh: true });
      try { if (FF.app && FF.app.renderCurrent) FF.app.renderCurrent(); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
  /** Settings (column letters) aane ke baad: purane config wale (bane hue ya chal rahe) datasets turant naye config se. */
  function onConfig() {
    const fp = cfgFp();
    const keys = new Set([
      ...Object.keys(state.data).filter((k) => DATASETS[k] && builtWith[k] !== undefined && builtWith[k] !== fp),
      ...[...jobs.keys()].map(keyOfJob).filter((k) => DATASETS[k])
    ]);
    if (!keys.size) return;
    const version = generation;
    // Naye config wali query ka browser snapshot ho to ye turant mil jaata hai (purani query ka Google wait nahi).
    configReload = Promise.allSettled([...keys].map((k) => loadKey(k, false))).then(() => {
      if (version !== generation) return;
      emit('refresh', { config: true });
      try { if (FF.app && FF.app.renderCurrent) FF.app.renderCurrent(); } catch { /* ignore */ }
    }).finally(() => { configReload = null; });
  }
  let configReload = null;
  /** Drill-downs isse pehle await karein: settings (column letters) aa chuke hon aur unke hisaab se data dobara ban chuka ho. */
  async function settled(maxMs = 15000) {
    const end = Date.now() + maxMs;
    while (!(FF.config && FF.config._applied) && Date.now() < end && typeof window !== 'undefined' && window.document) await new Promise((r) => setTimeout(r, 150));
    if (configReload && !(arguments.length > 1 && arguments[1] === 'config-only')) await Promise.race([configReload, new Promise((r) => setTimeout(r, Math.max(0, end - Date.now())))]);
  }
  function get(key) { return state.data[key]; }
  function error(key) { return state.errors[key]; }
  async function need(key, opts) {
    // A slow unrelated stock/report query must not block this page.
    // v3.125.54 — purane (login se pehle wale) column letters se bana ho to sirf ye dataset naye config se.
    if (state.data[key] !== undefined && builtWith[key] !== undefined && builtWith[key] !== cfgFp() && FF.config && FF.config._applied) return loadKey(key, false);
    if (state.data[key] !== undefined) return state.data[key];
    // `{ only: true }` — sirf yehi dataset load karo. Public (bina login) employee form isi ko use
    // karta hai: poora preload wahan bekaar hai aur Google par extra load daalta hai.
    if (!(opts && opts.only) && !state.promise) preload(false);
    return loadKey(key, false);
  }
  /** ⚡ Sirf chune hue datasets ko fresh dobara load karo (auto-sync ke liye — poora preload nahi). */
  async function refresh(keys) {
    const list = ((keys && keys.length) ? keys : ['daily', 'report']).filter((k) => DATASETS[k]);
    state.errors = state.errors || {};
    await runQueue(list, true);
    state.loadedAt = Date.now();
    emit('refresh');
    return state;
  }
  function reset() {
    generation++; jobs.clear(); state.loading = false; state.promise = null;
    state.data = {}; state.errors = {}; state.loadedAt = null; D.clearCache();
  }

  // Quick-find index (agents + TLs from EIR, StockDataa & REPORT) — shared by every search box.
  function people() {
    const agents = new Map(), tls = new Map();
    const addTl = (name, n) => { if (!name || FF.config.isExcludedTl(name)) return; const k = name.trim(); tls.set(k, (tls.get(k) || 0) + (n || 0)); };
    const addAgent = (name, tl, n, id) => { if (!name) return; const k = name.trim(); const e = agents.get(k) || { name: k, tl: '', n: 0, id: '' }; e.n += n || 0; if (tl && !FF.config.isExcludedTl(tl)) e.tl = e.tl || tl; if (id) e.id = e.id || id; agents.set(k, e); };
    (state.data.agents || []).forEach((a) => { addAgent(a.name, a.tlName, a.n, a.id); addTl(a.tlName, a.n); });
    (state.data.stockAgents || []).forEach((a) => { addAgent(a.agentName, a.tlName, 0, a.agentId); addTl(a.tlName, 0); });
    const rep = FF.pages && FF.pages.performance && FF.pages.performance.agents ? FF.pages.performance.agents() : [];
    rep.forEach((a) => { addAgent(a.name, a.tlName, 0, a.agentId); addTl(a.tlName, 0); });
    return { agents: [...agents.values()], tls: [...tls.entries()].map(([name, n]) => ({ name, n })) };
  }
  /** Suggestion items for U.suggest: [{ kind:'agent'|'tl', label, sub, value }] */
  function suggestions(opts) {
    const o = opts || {};
    const { agents, tls } = people();
    const items = [];
    if (o.tls !== false) tls.sort((a, b) => b.n - a.n).forEach((t) => items.push({ kind: 'tl', kindLabel: 'TL', label: t.name, sub: t.n ? `${U.fmtShort(t.n)} tags` : '', value: t.name }));
    if (o.agents !== false) agents.sort((a, b) => b.n - a.n).forEach((a) => items.push({ kind: 'agent', kindLabel: 'Agent', label: a.name, sub: a.tl || (a.id ? `ID ${a.id}` : ''), keywords: a.id, value: a.name, id: a.id, tl: a.tl }));
    return items;
  }

  FF.store = { onConfig, settled, preload, refresh, retryNow, get, error, need, reset, on, people, suggestions, DATASETS, get state() { return state; }, get loadedAt() { return state.loadedAt; }, get loading() { return state.loading; } };
})(window.FF);
