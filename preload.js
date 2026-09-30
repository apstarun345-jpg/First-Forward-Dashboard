/* Preload dashboard aggregates only. Raw sheet tabs stay lazy until opened, so login and
   interactive pages are not blocked by count/page/full-sheet queries for every permitted tab. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  let generation = 0;
  const state = { running: false, done: false, progress: { total: 0, loaded: 0 }, errors: [], promise: null };

  function preloadAll(fresh = false) {
    if (state.running) return state.promise;
    const version = generation;
    state.running = true; state.done = false; state.errors = [];
    const tasks = [() => FF.store.preload(fresh)];
    if (FF.gv && FF.gv.enabled()) tasks.push(() => FF.gv.preload(fresh));
    state.progress = { total: tasks.length, loaded: 0 };
    const run = async (task) => {
      try { await task(); }
      catch (err) { if (version === generation) state.errors.push(err); }
      finally { if (version === generation) { state.progress.loaded++; if (FF.app && FF.app.updateStatus) FF.app.updateStatus(); } }
    };
    state.promise = Promise.all(tasks.map(run)).then(() => {
      if (version !== generation) return state;
      state.errors.push(...Object.values(FF.store.state.errors));
      if (FF.gv && FF.gv.enabled()) state.errors.push(...Object.keys(FF.gv.DATASETS).map((key) => FF.gv.error(key)).filter(Boolean));
      state.done = state.errors.length === 0;
      return state;
    }).finally(() => {
      if (version === generation) { state.running = false; if (FF.app && FF.app.updateStatus) FF.app.updateStatus(); }
    });
    return state.promise;
  }
  async function fastSync(fresh = true) {
    if (state.running) await state.promise;
    // Keep the displayed data while the data stores refresh; sheet view pages remain lazy.
    if (FF.pages.sheet && FF.pages.sheet.reset) FF.pages.sheet.reset();
    return preloadAll(fresh);
  }
  function reset() { generation++; state.running = false; state.done = false; state.promise = null; state.errors = []; }
  FF.preloader = { preloadAll, fastSync, reset, get state() { return state; }, get running() { return state.running; }, get done() { return state.done; } };
})(window.FF);
