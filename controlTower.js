/* 🎛️ Operations Control Tower — admin command center.
   Combines Action Center (#1), What Changed (#5), Snapshot Compare (#9) and live GV today health.
   Data comes from the server-side /api/control-tower endpoint so the heavy sheets remain server-backed.
*/
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc, fmt = (n) => U.fmt(Number(n) || 0);
  const state = { data: null, selected: '', timer: null, loading: false, root: null };

  const METRICS = [
    ['gvToday', '🟩 GV Today', 'tags'],
    ['ffToday', '🟦 FF Today', 'tags'],
    ['combinedToday', '⚡ Combined Today', 'tags'],
    ['gvVc4', '🚗 GV VC4', 'tags'],
    ['gvVc20', '🛻 GV VC20', 'tags'],
    ['gvVc5p', '🚚 GV VC5+', 'tags'],
    ['gvStock', '📦 GV Stock', 'tags'],
    ['ffStock', '📦 FF Stock', 'tags'],
    ['pendingRequests', '🏷️ Pending Requests', ''],
    ['pendingSignups', '🆕 Pending Approvals', ''],
    ['criticalAlerts', '🚨 Critical Alerts', ''],
  ];

  const sevMeta = {
    critical: { icon: '🔴', cls: 'ct-critical' },
    high: { icon: '🟠', cls: 'ct-high' },
    medium: { icon: '🟡', cls: 'ct-medium' },
    info: { icon: '🔵', cls: 'ct-info' }
  };

  function deltaHtml(n) {
    const v = Number(n) || 0;
    if (!v) return '<span class="ct-delta flat">• 0</span>';
    return '<span class="ct-delta ' + (v > 0 ? 'up' : 'down') + '">' + (v > 0 ? '▲ +' : '▼ ') + fmt(Math.abs(v)) + '</span>';
  }

  function severityRank(s) { return s === 'critical' ? 4 : s === 'high' ? 3 : s === 'medium' ? 2 : 1; }

  function metricCards(metrics) {
    return METRICS.slice(0, 8).map(([key, label, suffix], i) => {
      const value = Number(metrics && metrics[key]) || 0;
      return '<div class="ct-metric ct-m' + ((i % 6) + 1) + '">' +
        '<span class="ct-metric-label">' + esc(label) + '</span>' +
        '<strong>' + fmt(value) + (suffix ? ' <small>' + esc(suffix) + '</small>' : '') + '</strong>' +
      '</div>';
    }).join('');
  }

  function actionHtml(action) {
    const m = sevMeta[action.severity] || sevMeta.info;
    return '<div class="ct-action ' + m.cls + '">' +
      '<div class="ct-action-icon">' + (action.icon || m.icon) + '</div>' +
      '<div class="ct-action-main"><b>' + esc(action.title || 'Action') + '</b><p>' + esc(action.detail || '') + '</p></div>' +
      (action.link ? '<a class="btn small" href="' + esc(action.link) + '">Open →</a>' : '') +
    '</div>';
  }

  function changedTable(current, delta) {
    const rows = METRICS.map(([key, label]) => ({ key, label, cur: Number(current && current[key]) || 0, d: Number(delta && delta[key]) || 0 }))
      .filter((r) => r.d !== 0);
    if (!rows.length) return '<div class="ct-empty">✅ Last stored snapshot se koi numeric change nahi.</div>';
    return '<div class="table-wrap"><table class="data-table ct-table"><thead><tr><th>Metric</th><th class="num">Current</th><th class="num">Change</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td><b>' + esc(r.label) + '</b></td><td class="num">' + fmt(r.cur) + '</td><td class="num">' + deltaHtml(r.d) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function snapshotCompare(current, chosen) {
    if (!chosen) return '<div class="ct-empty">Purana snapshot select karo. Neeche history me saved checkpoints milenge.</div>';
    const a = chosen.metrics || {}, b = (current && current.metrics) || {};
    const rows = METRICS.map(([key, label]) => {
      const from = Number(a[key]) || 0, now = Number(b[key]) || 0;
      return '<tr><td><b>' + esc(label) + '</b><small>' + esc(U.timeLabel(new Date(chosen.at).getTime())) + ' → now</small></td><td class="num">' + fmt(from) + '</td><td class="num">' + fmt(now) + '</td><td class="num">' + deltaHtml(now - from) + '</td></tr>';
    }).join('');
    return '<div class="table-wrap"><table class="data-table ct-table"><thead><tr><th>Metric</th><th class="num">Snapshot</th><th class="num">Current</th><th class="num">Change</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function sourceStatus(feed) {
    const g = feed && feed.gv;
    if (!g) return '<span class="ct-source bad">GV live unavailable</span>';
    const stateTxt = g.stale ? 'STALE' : g.cached ? 'CACHE' : 'LIVE';
    return '<span class="ct-source ' + (g.stale ? 'bad' : g.cached ? 'warn' : 'good') + '">' + esc(stateTxt) + '</span>';
  }

  function render(root, data) {
    state.root = root;
    state.data = data;
    const live = data.live || {}, feed = live.feed || {}, gv = feed.gv || null, metrics = (data.snapshot && data.snapshot.metrics) || {};
    const actions = [...(data.actions || [])].sort((a,b) => severityRank(b.severity) - severityRank(a.severity));
    const history = Array.isArray(data.history) ? data.history.slice().reverse() : [];
    const selected = state.selected ? history.find((x) => x.id === state.selected) : null;
    const delta = data.whatChanged || {};

    root.innerHTML =
      '<div class="ct-hero">' +
        '<div><div class="ct-kicker">🎛️ MANAGEMENT · LIVE OPERATIONS</div><h1>Operations Control Tower</h1><p>Action Center + What Changed + Snapshot Compare — ek hi screen par FF, GV, stock, requests aur live health.</p></div>' +
        '<div class="ct-hero-actions"><span class="ct-updated">Updated ' + esc(U.timeLabel(new Date(data.at).getTime())) + '</span><button class="btn primary" id="ct-refresh">↻ Refresh Live</button></div>' +
      '</div>' +

      '<section class="card ct-live-card">' +
        '<div class="card-head"><div><h3>🟩 GV Today — LIVE</h3><small class="dim">Source: GV Master · date ' + esc(data.date || '—') + ' · ' + sourceStatus(feed) + '</small></div><a class="btn small" href="#/gvDashboard">Open GV Dashboard →</a></div>' +
        '<div class="ct-gv-pulse">' +
          '<div class="ct-gv-total"><span>Total today</span><strong>' + fmt(gv && gv.total) + '</strong><small>' + (gv ? 'tags · ' + esc(gv.query || 'server feed') : 'No live snapshot') + '</small></div>' +
          '<div class="ct-gv-stat"><span>VC4</span><b>' + fmt(gv && gv.vc4) + '</b></div>' +
          '<div class="ct-gv-stat"><span>VC20</span><b>' + fmt(gv && gv.vc20) + '</b></div>' +
          '<div class="ct-gv-stat"><span>VC5+</span><b>' + fmt(gv && gv.vc5p) + '</b></div>' +
          '<div class="ct-gv-stat"><span>Replacement</span><b>' + fmt(gv && gv.replacement) + '</b></div>' +
          '<div class="ct-gv-stat"><span>Chassis</span><b>' + fmt(gv && gv.chassis) + '</b></div>' +
        '</div>' +
        (feed.gvError ? '<div class="ct-error">⚠️ GV live error: ' + esc(feed.gvError) + '</div>' : '') +
        (!feed.gvError && (!gv || Number(gv.total) === 0) ? '<div class="ct-warning">⚠️ GV Today = 0. Column mapping + date parsing ab server-side header-aware hai; Refresh Live se fresh probe chalao.</div>' : '') +
      '</section>' +

      '<div class="ct-metric-grid">' + metricCards(metrics) + '</div>' +

      '<div class="ct-grid-2">' +
        '<section class="card"><div class="card-head"><div><h3>🚨 Action Center</h3><small class="dim">' + actions.length + ' items · critical problems upar</small></div><span class="ct-count">' + actions.filter((x) => x.severity === 'critical' || x.severity === 'high').length + ' priority</span></div>' +
          '<div class="ct-actions">' + (actions.length ? actions.slice(0, 12).map(actionHtml).join('') : '<div class="ct-empty">✅ Abhi koi immediate action nahi.</div>') + '</div>' +
        '</section>' +
        '<section class="card"><div class="card-head"><div><h3>🧮 What Changed?</h3><small class="dim">Last stored Control Tower snapshot se</small></div><span class="ct-count">' + (data.snapshot && data.snapshot.at ? esc(U.timeLabel(new Date(data.snapshot.at).getTime())) : '—') + '</span></div>' +
          changedTable(metrics, delta) +
        '</section>' +
      '</div>' +

      '<section class="card"><div class="card-head"><div><h3>🔄 Snapshot Compare</h3><small class="dim">Saved checkpoint choose karke current state se exact delta dekho.</small></div>' +
        '<label class="ct-snapshot-select"><span>Compare with</span><select id="ct-snapshot-select"><option value="">Select snapshot…</option>' +
          history.map((x) => '<option value="' + esc(x.id) + '" ' + (x.id === state.selected ? 'selected' : '') + '>' + esc(U.timeLabel(new Date(x.at).getTime())) + ' · GV ' + fmt(x.metrics && x.metrics.gvToday) + ' · FF ' + fmt(x.metrics && x.metrics.ffToday) + '</option>').join('') +
        '</select></label>' +
      '</div>' +
      '<div class="ct-selected-note">' + (selected ? '📌 Selected: <b>' + esc(U.timeLabel(new Date(selected.at).getTime())) + '</b>' : 'History checkpoints auto-save every ~5 min while Control Tower is being opened/used.') + '</div>' +
      snapshotCompare(metrics, selected) +
      '</section>' +

      '<section class="card"><div class="card-head"><div><h3>📦 Operational Snapshot</h3><small class="dim">Stock + request state · same live source payload</small></div></div>' +
        '<div class="ct-op-grid">' +
          '<div><span>🟦 FF Stock</span><b>' + fmt(live.ffStock && live.ffStock.total) + '</b><small>StockDataa</small></div>' +
          '<div><span>🟩 GV Stock</span><b>' + fmt(live.gvStock && live.gvStock.total) + '</b><small>Tag Assignment</small></div>' +
          '<div><span>🏷️ Pending Requests</span><b>' + fmt(live.pendingRequests) + '</b><small>Tag Request queue</small></div>' +
          '<div><span>🆕 Pending Approvals</span><b>' + fmt(live.pendingSignups) + '</b><small>Users queue</small></div>' +
        '</div>' +
      '</section>';

    const refresh = root.querySelector('#ct-refresh');
    if (refresh) refresh.addEventListener('click', () => load(true));
    const select = root.querySelector('#ct-snapshot-select');
    if (select) select.addEventListener('change', () => { state.selected = select.value || ''; render(root, state.data); });
  }

  async function load(force) {
    if (!state.root || state.loading) return;
    state.loading = true;
    const root = state.root;
    const btn = root.querySelector('#ct-refresh');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Refreshing…'; }
    try {
      const path = '/api/control-tower' + (force ? '?fresh=1' : '');
      const data = await FF.auth.api(path);
      if (data && data.ok) render(root, data);
      else throw new Error(data && data.error || 'Control Tower unavailable');
    } catch (err) {
      root.innerHTML = U.errorBox(err, 'id="ct-refresh-error"');
    } finally {
      state.loading = false;
    }
  }

  async function start(root) {
    clearInterval(state.timer);
    state.root = root;
    root.innerHTML = U.spinner('Operations Control Tower load ho raha hai…');
    await load(false);
    state.timer = setInterval(() => {
      if (document.visibilityState === 'visible' && state.root && state.root.isConnected) load(false);
    }, 60000);
  }

  FF.pages.controlTower = { title: 'Operations Control Tower', render: start };
})(window.FF);
