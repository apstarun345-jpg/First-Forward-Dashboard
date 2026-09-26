/* Background preloader — site open / refresh par sab kuch background me update, phir har sheet aur stock instant dikhe */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const D = FF.data;
  const state = { running: false, done: false, progress: { total: 0, loaded: 0 }, errors: [] };

  async function preloadAll(fresh = true) {
    if (state.running) return state.promise;
    state.running = true;
    state.done = false;
    state.errors = [];
    const tabs = (FF.config.allTabs ? FF.config.allTabs(true) : []).filter(t => t && t.id);
    const datasets = Object.keys(FF.store.DATASETS || {});
    const gvDatasets = FF.gv ? Object.keys(FF.gv.DATASETS || {}) : [];
    
    // Total steps: FF store + GV store + each sheet tab
    const total = datasets.length + gvDatasets.length + tabs.length;
    state.progress = { total, loaded: 0 };
    
    const emit = () => {
      if (FF.store && FF.store.state) {
        FF.store.state.progress = { done: state.progress.loaded, total: state.progress.total };
      }
    };

    const p = (async () => {
      try {
        // Phase 1: Core datasets in parallel (fastest) — both FF and GV
        const corePromises = [];
        if (FF.store) {
          corePromises.push(FF.store.preload(!!fresh).then(() => {
            state.progress.loaded += datasets.length;
            emit();
          }).catch(e => { state.errors.push(e); }));
        }
        
        if (FF.gv && FF.gv.enabled()) {
          corePromises.push(FF.gv.preload(!!fresh).then(() => {
            state.progress.loaded += gvDatasets.length;
            emit();
          }).catch(e => { state.errors.push(e); }));
        }
        
        await Promise.allSettled(corePromises);
        
        // Phase 2: Preload all sheet tabs in background with configured ranges (chunked)
        const preloadTab = async (tab) => {
          try {
            const gid = tab.gid || '';
            const range = tab.range || (tab.startCol || tab.startRow || tab.endCol || tab.endRow ? (FF.config.formatRange ? FF.config.formatRange(tab.startCol, tab.startRow, tab.endCol, tab.endRow) : `${tab.startCol || 'A'}${tab.startRow || 1}:${tab.endCol || ''}${tab.endRow || ''}`) : '');
            const tabName = tab.tab || tab.id;
            // Warm cache with count + first page (or full sheet for small ones)
            await D.query(tabName, 'select count(A)', { fresh: !!fresh, gid, range }).catch(() => {});
            await D.query(tabName, 'select * limit 100', { fresh: !!fresh, gid, range }).catch(() => {});
            // If report or small sheet, pre-cache full data so opening the tab is 100% instant
            if (tab.kind === 'report' || tab.kind === 'gv-report' || tab.kind === 'gv-issuance') {
              await D.query(tabName, '', { fresh: !!fresh, gid, range }).catch(() => {});
            }
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
          await new Promise(r => setTimeout(r, 60));
        }
        
        state.done = true;
        // Notify active view that fresh background data is ready
        if (FF.app && FF.app.onBackgroundDataUpdated) {
          FF.app.onBackgroundDataUpdated();
        }
        U.toast(`All sheets & stock data updated ✓ (${tabs.length} sheets)`, 'ok');
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
