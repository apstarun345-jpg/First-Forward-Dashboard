/* Preload dashboard aggregates only. Raw sheet tabs stay lazy until opened, so login and
   interactive pages are not blocked by count/page/full-sheet queries for every permitted tab. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  let generation = 0;
  let activeProgressUpdater = null;
  let stopStoreProgress = null;
  let stopGvProgress = null;
  const state = { running: false, done: false, progress: { done: 0, total: 0, loaded: 0, totalSources: 0 }, errors: [], promise: null };

  // Show real per-dataset progress instead of remaining at 0/2 until each whole
  // channel's aggregate preload has finished. The sheet data itself remains lazy/query-based.
  function syncProgress(completedSources, totalSources) {
    const ff = FF.store && FF.store.state ? FF.store.state.progress || {} : {};
    const gvEnabled = !!(FF.gv && FF.gv.enabled && FF.gv.enabled());
    const gv = gvEnabled && FF.gv.state ? FF.gv.state.progress || {} : {};
    const datasetDone = Math.max(0, Number(ff.done) || 0) + Math.max(0, Number(gv.done) || 0);
    const datasetTotal = Math.max(0, Number(ff.total) || 0) + Math.max(0, Number(gv.total) || 0);
    // Test doubles and older data-store adapters may not expose per-dataset counters.
    // In that case, fall back to counting the actual preload sources (FF / GV).
    state.progress = {
      done: datasetTotal ? datasetDone : completedSources,
      total: datasetTotal || totalSources,
      loaded: completedSources,
      totalSources
    };
  }
  function preloadAll(fresh = false) {
    if (state.running) return state.promise;
    const version = generation;
    const tasks = [() => FF.store.preload(fresh)];
    if (FF.gv && FF.gv.enabled()) tasks.push(() => FF.gv.preload(fresh));
    let completedSources = 0;
    state.running = true; state.done = false; state.errors = [];
    syncProgress(completedSources, tasks.length);
    const update = () => {
      if (version !== generation) return;
      syncProgress(completedSources, tasks.length);
      if (FF.app && FF.app.updateStatus) FF.app.updateStatus();
    };
    activeProgressUpdater = update;
    const notifyProgress = () => { if (activeProgressUpdater) activeProgressUpdater(); };
    if (!stopStoreProgress && FF.store && typeof FF.store.on === 'function') stopStoreProgress = FF.store.on(notifyProgress);
    if (!stopGvProgress && FF.gv && typeof FF.gv.on === 'function') stopGvProgress = FF.gv.on(notifyProgress);
    const run = async (task) => {
      try { await task(); }
      catch (err) { if (version === generation) state.errors.push(err); }
      finally {
        if (version === generation) { completedSources++; update(); }
      }
    };
    state.promise = Promise.all(tasks.map(run)).then(() => {
      if (version !== generation) return state;
      state.errors.push(...Object.values(FF.store.state.errors));
      if (FF.gv && FF.gv.enabled()) state.errors.push(...Object.keys(FF.gv.DATASETS).map((key) => FF.gv.error(key)).filter(Boolean));
      state.done = state.errors.length === 0;
      update();
      return state;
    }).finally(() => {
      if (version === generation) {
        update();
        state.running = false;
        activeProgressUpdater = null;
        if (FF.app && FF.app.updateStatus) FF.app.updateStatus();
      }
    });
    return state.promise;
  }
  /** ⚡ Halka refresh — sirf wo datasets jo "aaj live" numbers banate hain (bhaari tab-scan nahi).
      Auto-sync ke liye: 16 queries ki jagah 3 (daily + GV master + REPORT). */
  async function lightSync(fresh = true) {
    const jobs = [FF.store.refresh(['daily', 'report']).catch(() => {})];
    if (FF.gv && FF.gv.enabled && FF.gv.enabled()) jobs.push(FF.gv.refresh(['master']).catch(() => {}));
    if (FF.data && FF.data.today) jobs.push(FF.data.today({ fresh: !!fresh }).catch(() => {}));
    await Promise.all(jobs);
    return state;
  }
  async function fastSync(fresh = true) {
    if (state.running) await state.promise;
    // Keep the displayed data while the data stores refresh; sheet view pages remain lazy.
    if (FF.pages.sheet && FF.pages.sheet.reset) FF.pages.sheet.reset();
    return preloadAll(fresh);
  }
  function reset() { generation++; state.running = false; state.done = false; state.promise = null; state.errors = []; activeProgressUpdater = null; }
  FF.preloader = { preloadAll, fastSync, lightSync, reset, get state() { return state; }, get running() { return state.running; }, get done() { return state.done; } };
})(window.FF);
