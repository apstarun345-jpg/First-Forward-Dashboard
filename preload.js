/* Warm the exact queries used by every permitted sheet, alongside dashboard datasets.
   Normal opens reuse the server cache. Only explicit refresh bypasses it. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  let generation = 0;
  const state = { running: false, done: false, progress: { total: 0, loaded: 0 }, errors: [], promise: null };
  async function warmTab(tab, fresh) {
    const name = tab.tab || tab.id;
    const opts = { fresh, gid: tab.gid || '' };
    const [count, first] = await Promise.all([
      FF.data.query(name, 'select count(A)', opts).catch(() => null),
      FF.data.query(name, 'select * limit 100', opts)
    ]);
    const total = count && FF.data.cellNumber(count.rows[0] && count.rows[0][0]);
    // Never download a huge raw inventory just because its count query failed.
    if ((total !== null && total !== undefined && total <= 2500) || (!count && first.rows.length < 100)) {
      await FF.data.query(name, '', opts);
    }
  }
  function preloadAll(fresh = false) {
    if (state.running) return state.promise;
    const version = generation;
    state.running = true; state.done = false; state.errors = [];
    const tabs = FF.config.allTabs(true).filter(t => FF.auth.can(`sheet:${t.id}`));
    const tasks = [() => FF.store.preload(fresh)];
    if (FF.gv && FF.gv.enabled()) tasks.push(() => FF.gv.preload(fresh));
    state.progress = { total: tasks.length + tabs.length, loaded: 0 };
    const run = async (task) => {
      try { await task(); }
      catch (err) { if (version === generation) state.errors.push(err); }
      finally { if (version === generation) { state.progress.loaded++; if (FF.app && FF.app.updateStatus) FF.app.updateStatus(); } }
    };
    // Sheets start NOW, not after the slowest dashboard request finishes.
    let next = 0;
    const worker = async () => {
      while (version === generation && next < tabs.length) {
        const tab = tabs[next++];
        await run(() => warmTab(tab, fresh));
      }
    };
    state.promise = Promise.all([...tasks.map(run), ...Array.from({ length: Math.min(3, tabs.length) }, () => Promise.resolve().then(worker))])
      .then(() => {
        if (version !== generation) return state;
        state.errors.push(...Object.values(FF.store.state.errors));
        if (FF.gv && FF.gv.enabled()) state.errors.push(...Object.keys(FF.gv.DATASETS).map(k => FF.gv.error(k)).filter(Boolean));
        state.done = state.errors.length === 0;
        return state;
      }).finally(() => { if (version === generation) { state.running = false; if (FF.app && FF.app.updateStatus) FF.app.updateStatus(); } });
    return state.promise;
  }
  async function fastSync(fresh = true) {
    if (state.running) await state.promise;
    // Retain displayed data during refresh; no blank screen or global cache race.
    if (FF.pages.sheet && FF.pages.sheet.reset) FF.pages.sheet.reset();
    return preloadAll(fresh);
  }
  function reset() { generation++; state.running = false; state.done = false; state.promise = null; state.errors = []; }
  FF.preloader = { preloadAll, fastSync, reset, get state() { return state; }, get running() { return state.running; }, get done() { return state.done; } };
})(window.FF);
