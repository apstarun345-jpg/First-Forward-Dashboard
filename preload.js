/* Background preloader — site open / refresh par sab kuch ek baar load, phir har sheet instant dikhe */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const D = FF.data;
  const state = { running: false, done: false, progress: { total: 0, loaded: 0 }, errors: [] };

  async function preloadAll(fresh) {
    if (state.running && !fresh) return state.promise;
    state.running = true;
    state.done = false;
    state.errors = [];
    const tabs = (FF.config.allTabs ? FF.config.allTabs(true) : []).filter(t => t && t.id);
    const datasets = Object.keys(FF.store.DATASETS || {});
    const gvDatasets = FF.gv ? Object.keys(FF.gv.DATASETS || {}) : [];
    
    // Total steps: FF store + GV store + each sheet tab count probe + first page
    const total = datasets.length + gvDatasets.length + tabs.length;
    state.progress = { total, loaded: 0 };
    
    const emit = () => {
      if (FF.store && FF.store.state) {
        FF.store.state.progress = { done: state.progress.loaded, total: state.progress.total };
      }
    };

    const p = (async () => {
      try {
        // Phase 1: Core datasets in parallel (fastest)
        const corePromises = [];
        corePromises.push(FF.store.preload(!!fresh).then(() => {
          state.progress.loaded += datasets.length;
          emit();
        }).catch(e => { state.errors.push(e); }));
        
        if (FF.gv && FF.gv.enabled()) {
          corePromises.push(FF.gv.preload(!!fresh).then(() => {
            state.progress.loaded += gvDatasets.length;
            emit();
          }).catch(e => { state.errors.push(e); }));
        }
        
        await Promise.allSettled(corePromises);
        
        // Phase 2: Preload all sheet tabs in background (low priority, chunked)
        // Use requestIdleCallback if available for non-blocking
        const preloadTab = async (tab) => {
          try {
            const gid = tab.gid || '';
            // Probe count + first page to warm cache
            await D.query(tab.tab || tab.id, 'select count(A)', { fresh: !!fresh, gid }).catch(() => {});
            await D.query(tab.tab || tab.id, `select * limit 100`, { fresh: !!fresh, gid }).catch(() => {});
          } catch (e) {
            state.errors.push(e);
          } finally {
            state.progress.loaded++;
            emit();
          }
        };

        // Load tabs in batches of 2 to avoid overwhelming Google
        const batchSize = 2;
        for (let i = 0; i < tabs.length; i += batchSize) {
          const batch = tabs.slice(i, i + batchSize);
          await Promise.allSettled(batch.map(preloadTab));
          // Small delay to keep UI responsive
          await new Promise(r => setTimeout(r, 120));
          if (fresh) {
            // If fresh requested, don't delay too much
            await new Promise(r => setTimeout(r, 50));
          }
        }
        
        state.done = true;
        U.toast(`Background sync complete ✓ — ${tabs.length} sheets ready`, 'ok');
      } finally {
        state.running = false;
      }
    })();
    
    state.promise = p;
    return p;
  }

  // Fast sync: force fresh + clear cache + reload all
  async function fastSync() {
    D.clearCache();
    if (FF.store) FF.store.reset();
    if (FF.gv) FF.gv.reset();
    return preloadAll(true);
  }

  FF.preloader = {
    preloadAll,
    fastSync,
    get state() { return state; },
    get running() { return state.running; },
    get done() { return state.done; }
  };
})(window.FF);
