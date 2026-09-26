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
    status: { label: 'EIR · tag status', load: (o) => M.loadStatus(o) },
    stock: { label: 'StockDataa · class × TL', load: (o) => M.loadStock(o) },
    stockAgents: { label: 'StockDataa · agent × class', load: (o) => M.loadStockAgents(o) },
    stockTypes: { label: 'StockDataa · agent × type', load: (o) => M.loadStockAgentTypes(o) },
    report: { label: 'REPORT sheet', load: (o) => D.query(FF.config.report.sheet, '', { ...o, gid: FF.config.report.gid }) }
  };
  const state = { data: {}, errors: {}, loading: false, loadedAt: null, progress: { done: 0, total: 0 }, promise: null, listeners: new Set() };

  function emit(event, detail) { state.listeners.forEach((fn) => { try { fn(event, detail); } catch (e) { console.error(e); } }); }
  function on(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }

  /** Load all datasets in parallel. fresh=true bypasses the server cache (Google se naya data). */
  function preload(fresh) {
    if (state.promise && !fresh) return state.promise;
    if (fresh) { D.clearCache(); state.data = {}; }
    const keys = Object.keys(DATASETS);
    state.loading = true; state.errors = {}; state.progress = { done: 0, total: keys.length };
    emit('start');
    const p = Promise.all(keys.map(async (key) => {
      try {
        state.data[key] = await DATASETS[key].load({ fresh });
      } catch (err) {
        console.error(`store: ${key} failed`, err);
        state.errors[key] = err;
        if (err && err.name === 'AuthError') throw err;
      } finally {
        state.progress.done++;
        emit('progress', { key, ...state.progress });
      }
    })).then(() => {
      state.loading = false; state.loadedAt = Date.now();
      emit('done');
      return state.data;
    }).catch((err) => { state.loading = false; emit('error', err); throw err; });
    state.promise = p;
    return p;
  }
  function get(key) { return state.data[key]; }
  function error(key) { return state.errors[key]; }
  /** Await a dataset (resolves after preload). Throws the dataset's own error when it failed. */
  async function need(key) {
    if (!state.promise) preload(false);
    await state.promise.catch(() => {});
    if (state.errors[key]) throw state.errors[key];
    return state.data[key];
  }
  function reset() { state.promise = null; state.data = {}; state.errors = {}; state.loadedAt = null; D.clearCache(); }

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

  FF.store = { preload, get, error, need, reset, on, people, suggestions, DATASETS, get state() { return state; }, get loadedAt() { return state.loadedAt; }, get loading() { return state.loading; } };
})(window.FF);
