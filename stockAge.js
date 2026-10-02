/* 🧓 STOCK AGEING (v3.31) — "ye stock kitna purana hai?" — FF + GV, har drawer me.
 *
 * v3.28 me browser poora StockDataa (~1 lakh rows) download karke index banata tha — pehla drawer
 * kholte hi bahut der lagti thi. Ab server (/api/stock-age) dono tabs ek baar padh kar har agent / TL /
 * network ke compact bucket counts deta hai; tag-level list sirf bucket par click karne par
 * (/api/stock-age/tags) aati hai.
 *
 *   🟦 FF  (StockDataa)     → umr = Agent Allocated At (J) — khaali ho to BC Allocated At (G)
 *   🟩 GV  (Tag Assignment) → sheet me allocation date nahi: Settings → gv.assignment.allocatedAt ho to wahi,
 *                             warna GV tag ko StockDataa me TAG_ID / barcode (= GV serial) se match karke
 *                             uski allocation date (BC / master ko mila tab se).
 * Buckets cumulative: ≥ 1 mahina (30 din) · ≥ 3 (90) · ≥ 5 (150) · ≥ 6 (180) — 🚗 VC4 + VC20 aur 🚚 VC5+ alag.
 *
 * Public API (sab safe / no-throw):
 *   FF.stockAge.ready(force)                 → Promise<index>
 *   FF.stockAge.forAgent(idOrName|[...], ch) → node | null      (ch: 'ff' | 'gv' | undefined = dono me dhoondo)
 *   FF.stockAge.forTl(name, ch)              → node | null
 *   FF.stockAge.hostHtml(scope, opts)        → HTML host (async bhar jaata hai) · scope = { kind, key, ch, keys, tls }
 *   FF.stockAge.sectionHtml(scope, opts)     → drawer section (details/summary + host)
 *   FF.stockAge.html(scope)                  → index ready hone par poora table HTML (sync)
 *   FF.stockAge.decorate(root)               → saare [data-age-host] / [data-age-chip] bhar do
 *   FF.stockAge.csv(scope, months, group)    → Promise<count> — us bucket ke saare tags ki CSV
 *   FF.stockAge.fetchTags(scope, months, group, limit) → Promise<{ total, rows }>
 */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;

  const GROUP_LABEL = { core: '🚗 VC4 + VC20', comm: '🚚 VC5+ (commercial)' };
  const GROUP_ORDER = ['core', 'comm'];
  const CH_LABEL = { ff: '🟦 First Forward', gv: '🟩 GV Partner' };
  function groupOf(cls) { const c = String(cls || '').toUpperCase().replace(/^VC/, ''); return (c === '4' || c === '20') ? 'core' : 'comm'; }
  const THRESH = [
    { months: 1, days: 30, label: '≥ 1 mahina' },
    { months: 3, days: 90, label: '≥ 3 mahine' },
    { months: 5, days: 150, label: '≥ 5 mahine' },
    { months: 6, days: 180, label: '≥ 6 mahine' }
  ];
  const TH_BY_MONTH = new Map(THRESH.map((t) => [t.months, t]));
  const HOST_SEL = '[data-age-host]';
  const state = { at: 0, promise: null, index: null, error: '', seq: 0, building: false, startedAt: 0 };
  const SOFT_MS = 20000;          // itni der baad host par "abhi bhi ban rahi hai" + Retry (spinner hamesha nahi ghoomta)
  const POLL_HARD_MS = 4 * 60e3;  // server `pending` de raha ho to itni der tak poll
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const digits = (v) => String(v || '').replace(/\D/g, '');
  const norm = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const fmt = (n) => U.fmt(n);

  // ---- 📦 index (server summary → lookup maps) -----------------------------------------------------
  function nodeOf(raw, kind, key, ch) {
    if (!raw) return null;
    const c = raw.c || [[0, 0, 0, 0], [0, 0, 0, 0]];
    const cnt = (g) => ({ 1: c[g][0] || 0, 3: c[g][1] || 0, 5: c[g][2] || 0, 6: c[g][3] || 0 });
    return {
      kind, key, ch, name: raw.n || key, agentId: raw.id || '', tl: raw.tl || '',
      total: { core: raw.t[0] || 0, comm: raw.t[1] || 0 }, unknown: { core: (raw.u || [])[0] || 0, comm: (raw.u || [])[1] || 0 },
      counts: { core: cnt(0), comm: cnt(1) }, oldest: { core: (raw.o || [])[0] || 0, comm: (raw.o || [])[1] || 0 },
      avg: { core: (raw.a || [])[0] || 0, comm: (raw.a || [])[1] || 0 }, tags: []
    };
  }
  /** Kai nodes ka jod (selected agents / TL list) — counts additive, oldest = max, avg = weighted. */
  function mergeNodes(nodes, name, ch) {
    const list = (nodes || []).filter(Boolean);
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    const out = { kind: 'merged', key: name, ch, name, agentId: '', tl: '', total: { core: 0, comm: 0 }, unknown: { core: 0, comm: 0 }, counts: { core: { 1: 0, 3: 0, 5: 0, 6: 0 }, comm: { 1: 0, 3: 0, 5: 0, 6: 0 } }, oldest: { core: 0, comm: 0 }, avg: { core: 0, comm: 0 }, tags: [] };
    const wsum = { core: 0, comm: 0 };
    list.forEach((n) => GROUP_ORDER.forEach((g) => {
      out.total[g] += n.total[g]; out.unknown[g] += n.unknown[g];
      THRESH.forEach((t) => { out.counts[g][t.months] += n.counts[g][t.months] || 0; });
      out.oldest[g] = Math.max(out.oldest[g], n.oldest[g]);
      const known = n.total[g] - n.unknown[g];
      wsum[g] += (n.avg[g] || 0) * known;
    }));
    GROUP_ORDER.forEach((g) => { const known = out.total[g] - out.unknown[g]; out.avg[g] = known ? Math.round(wsum[g] / known) : 0; });
    return out;
  }
  function buildMaps(ch, part) {
    if (!part) return null;
    const byKey = new Map(), byName = new Map(), tls = new Map();
    Object.entries(part.agents || {}).forEach(([key, raw]) => {
      byKey.set(key, raw);
      const nm = norm(raw.n);
      if (nm && !byName.has(nm)) byName.set(nm, key);
    });
    Object.entries(part.tls || {}).forEach(([key, raw]) => { tls.set(key, raw); const nm = norm(raw.n); if (nm && !tls.has(nm)) tls.set(nm, raw); });
    return { ch, part, byKey, byName, tls };
  }
  async function loadIndex(force) {
    if (!FF.auth || typeof FF.auth.api !== 'function') return { error: 'Login ke bina stock ageing nahi milti' };
    // Server index abhi ban raha ho (pehli baar poora StockDataa + Tag Assignment padhna padta hai) to `{ pending: true }` deta hai
    // — request latkti nahi; yahan poll karte hain (pehle ek request 45-60 s tak ghoomti thi aur sab spinner atke rehte the).
    const began = Date.now();
    let data = null;
    for (let attempt = 0; ; attempt++) {
      data = await FF.auth.api(`/api/stock-age${force && attempt === 0 ? '?fresh=1' : ''}`);
      if (!(data && data.pending)) break;
      state.building = true;
      if (Date.now() - began > POLL_HARD_MS) return { error: 'Server abhi bhi stock ageing ka index bana raha hai — thodi der baad Retry karo' };
      await sleep(Math.min(8000, Math.max(1000, Number(data.retryAfterMs) || 3000)));
    }
    state.building = false;
    if (!data || !data.ok) return { error: (data && data.error) || 'Stock ageing load nahi hui' };
    return { at: Date.now(), data, today: data.today, ff: buildMaps('ff', data.ff), gv: buildMaps('gv', data.gv), errors: data.errors || null, total: (data.ff ? data.ff.total : 0) + (data.gv ? data.gv.total : 0), unknown: (data.ff ? data.ff.unknown : 0) + (data.gv ? data.gv.unknown : 0) };
  }
  function ready(force) {
    if (!force && state.index && Date.now() - state.at < 5 * 60e3) return Promise.resolve(state.index);
    if (state.promise && !force) return state.promise;
    state.startedAt = Date.now();
    state.promise = loadIndex(force).then((idx) => {
      if (idx && idx.error) state.error = idx.error;
      else { state.index = idx; state.error = ''; }
      state.at = Date.now();
      return state.index;
    }).catch((err) => {
      state.error = (err && err.message) || 'ageing load nahi hui';
      state.at = Date.now();
      return state.index;
    }).finally(() => { state.promise = null; state.building = false; });
    return state.promise;
  }
  /** UI ke liye: ready / building (server index bana raha) / error. */
  function status() { return { ready: !!state.index, building: !!(state.promise && state.building), loading: !!state.promise, error: state.error || '', since: state.startedAt }; }

  // ---- 🔎 lookup -----------------------------------------------------------------------------------
  const chList = (ch) => (ch === 'ff' || ch === 'gv' ? [ch] : ['ff', 'gv']);
  function agentIn(maps, cand) {
    if (!maps) return null;
    for (const raw of cand) {
      const v = String(raw || '').trim();
      if (!v) continue;
      const d = digits(v), up = v.toUpperCase();
      let key = null;
      if (maps.ch === 'ff' && d && maps.byKey.has(d)) key = d;
      else if (maps.ch === 'gv' && maps.byKey.has(up)) key = up;
      else if (maps.byKey.has(v)) key = v;
      else if (maps.byName.has(norm(v))) key = maps.byName.get(norm(v));
      else if (maps.byKey.has(`n:${norm(v)}`)) key = `n:${norm(v)}`;
      if (key) return nodeOf(maps.byKey.get(key), 'agent', key, maps.ch);
    }
    return null;
  }
  function forAgent(idOrName, ch) {
    const idx = state.index;
    if (!idx) return null;
    const cand = (Array.isArray(idOrName) ? idOrName : [idOrName]).filter((x) => x !== undefined && x !== null && String(x).trim());
    for (const c of chList(ch)) { const n = agentIn(idx[c], cand); if (n) return n; }
    return null;
  }
  function forTl(name, ch) {
    const idx = state.index;
    if (!idx) return null;
    const k = norm(name);
    for (const c of chList(ch)) {
      const maps = idx[c];
      if (!maps) continue;
      const raw = maps.tls.get(k) || maps.tls.get(`ID:${k}`);
      if (raw) return nodeOf(raw, 'tl', k, c);
    }
    return null;
  }
  /** Scope → [{ ch, node, extra }] (ek ya dono channel). */
  function nodesFor(scope) {
    const idx = state.index;
    if (!idx || !scope) return [];
    const kind = scope.kind || 'all';
    const out = [];
    if (kind === 'agent') {
      const cand = [scope.key, ...(scope.keys || [])];
      chList(scope.ch).forEach((c) => { const n = agentIn(idx[c], cand); if (n) out.push({ ch: c, node: n }); });
      return out;
    }
    if (kind === 'tl') {
      chList(scope.ch).forEach((c) => { const n = forTl(scope.key, c); if (n) out.push({ ch: c, node: n }); });
      return out;
    }
    if (kind === 'agents') {
      chList(scope.ch).forEach((c) => {
        const maps = idx[c];
        if (!maps) return;
        const nodes = (scope.keys || []).map((k) => agentIn(maps, [k])).filter(Boolean);
        (scope.tls || []).forEach((t) => { const n = forTl(t, c); if (n) nodes.push(n); });
        const m = mergeNodes(nodes, scope.title || `${nodes.length} selected`, c);
        if (m) out.push({ ch: c, node: m });
      });
      return out;
    }
    chList(scope.ch).forEach((c) => {
      const part = idx[c] && idx[c].part;
      if (!part) return;
      if (c === 'ff' && part.field) out.push({ ch: c, node: nodeOf(part.field, 'field', 'field', c), parked: part.parked ? nodeOf(part.parked, 'parked', 'parked', c) : null });
      else out.push({ ch: c, node: nodeOf(part.all, 'all', 'all', c) });
    });
    return out;
  }
  function nodeFor(scope) { const list = nodesFor(scope); return list.length ? (list.length === 1 ? list[0].node : mergeNodes(list.map((x) => x.node), 'FF + GV', 'both')) : null; }

  // ---- 🧮 numbers ------------------------------------------------------------------------------------
  const count = (node, g, months) => (node && node.counts[g] && node.counts[g][months]) || 0;
  const nodeTotal = (node) => (node ? (node.total.core || 0) + (node.total.comm || 0) : 0);
  const nodeUnknown = (node) => (node ? (node.unknown.core || 0) + (node.unknown.comm || 0) : 0);
  /** v3.28 compat: tag list ab server par hai — sync list khaali (fetchTags use karo). */
  function tagsOlder() { return []; }
  function bucketName(age) {
    if (age === null || age === undefined || age === '') return 'Date nahi';
    if (age >= 180) return '6+ mahine';
    if (age >= 150) return '5-6 mahine';
    if (age >= 90) return '3-5 mahine';
    if (age >= 30) return '1-3 mahine';
    return '0-1 mahina';
  }
  /** Non-cumulative mix: 0-1 · 1-3 · 3-5 · 5-6 · 6+ · date nahi (stacked bar ke liye). */
  function mixOf(node) {
    const tot = nodeTotal(node), unk = nodeUnknown(node);
    const c = (m) => count(node, 'core', m) + count(node, 'comm', m);
    const known = tot - unk;
    return [
      { label: '0-1 mahina', n: Math.max(0, known - c(1)), tone: 'fresh' },
      { label: '1-3 mahine', n: Math.max(0, c(1) - c(3)), tone: 'ok' },
      { label: '3-5 mahine', n: Math.max(0, c(3) - c(5)), tone: 'warn' },
      { label: '5-6 mahine', n: Math.max(0, c(5) - c(6)), tone: 'old' },
      { label: '6+ mahine', n: c(6), tone: 'bad' },
      { label: 'Date nahi', n: unk, tone: 'unk' }
    ];
  }

  // ---- 🌐 server tag list ------------------------------------------------------------------------
  function tagQuery(scope, ch, months, group, limit, unknown) {
    const p = new URLSearchParams({ ch, kind: scope.kind || 'all', months: String(months || 0), group: group || '', limit: String(limit || 40) });
    if (scope.key && scope.kind !== 'all') p.set('key', scope.key);
    if (scope.keys && scope.keys.length) p.set('keys', scope.keys.slice(0, 400).join('|'));
    if (scope.tls && scope.tls.length) p.set('tls', scope.tls.slice(0, 100).join('|'));
    if (unknown) p.set('unknown', '1');
    return `/api/stock-age/tags?${p.toString()}`;
  }
  /** Scope + bucket ke tags (dono channel ho to dono se). */
  async function fetchTags(scope, months, group, limit, unknown) {
    const list = nodesFor(scope);
    const chs = list.length ? [...new Set(list.map((x) => (x.node.kind === 'field' ? 'field:ff' : x.ch)))] : chList(scope.ch);
    let total = 0; const rows = [];
    for (const c of chs) {
      const ch = c.replace(/^field:/, '');
      const sc = c.startsWith('field:') ? { ...scope, kind: 'field' } : scope;
      const out = await FF.auth.api(tagQuery(sc, ch, months, group, limit, unknown));
      if (out && out.pending) throw new Error('Stock ageing index abhi ban raha hai — thodi der baad dobara try karo');
      total += Number(out && out.total) || 0;
      ((out && out.rows) || []).forEach((r) => rows.push({ ...r, ch }));
    }
    rows.sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
    return { total, rows };
  }

  // ---- 🖨 UI ---------------------------------------------------------------------------------------
  const scopeAttrs = (scope) => {
    const s = scope || {};
    return `data-age-kind="${esc(s.kind || 'all')}" data-age-key="${esc(s.key || '')}" data-age-ch="${esc(s.ch || '')}" data-age-keys="${esc((s.keys || []).join('|'))}" data-age-tls="${esc((s.tls || []).join('|'))}"`;
  };
  const scopeFrom = (el) => ({
    kind: el.dataset.ageKind || 'all', key: el.dataset.ageKey || '', ch: el.dataset.ageCh || '',
    keys: (el.dataset.ageKeys || '').split('|').filter(Boolean), tls: (el.dataset.ageTls || '').split('|').filter(Boolean), title: el.dataset.ageTitle || ''
  });
  /** Host div — `decorate(root)` ise async bhar deta hai (card / drawer / table cell sab me same). */
  function hostHtml(scope, opts) {
    const o = opts || {};
    const id = `age${++state.seq}`;
    return `<div class="age-host" data-age-host data-age-id="${id}" ${scopeAttrs(scope)} data-age-title="${esc(o.title || '')}">`
      + `<div class="age-loading" role="status">${U.loader ? U.loader('', { size: 'sm' }) : ''}<span>🧓 Stock ageing load ho rahi hai${U.ellipsis ? U.ellipsis() : '…'}</span></div></div>`;
  }
  /** Drawer section — har drawer me (app.js openDrawer isko khud lagata hai). */
  function sectionHtml(scope, opts) {
    const o = opts || {};
    const who = o.who || whoText(scope);
    return `<section class="drawer-age" data-drawer-age><details ${o.open ? 'open' : ''}><summary><span class="drawer-age-title">🧓 Stock ageing — ${who}</span><span class="age-sum" data-age-sum ${scopeAttrs(scope)}>${U.loader ? U.loader('', { size: 'sm' }) : '…'}</span></summary>`
      + hostHtml(scope, { title: o.title || scope.key || '' }) + '</details></section>';
  }
  function whoText(scope) {
    const s = scope || {};
    const ch = s.ch === 'ff' ? ' <small class="dim">(First Forward)</small>' : s.ch === 'gv' ? ' <small class="dim">(GV Partner)</small>' : '';
    if (s.kind === 'agent') return `agent <b>${esc(s.title || s.key)}</b>${ch}`;
    if (s.kind === 'tl') return `TL <b>${esc(s.title || s.key)}</b>${ch}`;
    if (s.kind === 'agents') return `<b>${esc(s.title || `${(s.keys || []).length + (s.tls || []).length} selected`)}</b>${ch}`;
    return `poora network${ch}`;
  }
  function bucketCell(node, g, t, ch) {
    const n = count(node, g, t.months);
    const tone = t.months >= 6 ? 'red' : t.months >= 5 ? 'amber' : t.months >= 3 ? 'orange' : '';
    if (!n) return `<td class="num dim">0</td>`;
    return `<td class="num"><button type="button" class="age-n ${tone}" data-age-open="${t.months}" data-age-group="${g}" data-age-chx="${ch || ''}" title="${esc(t.label)} purane tags dekho (ya CSV ⬇)">${fmt(n)}</button></td>`;
  }
  function mixBar(node) {
    const tot = nodeTotal(node);
    if (!tot) return '';
    return `<div class="age-mix" role="img" aria-label="Stock age mix">${mixOf(node).filter((x) => x.n > 0).map((x) => `<span class="age-mix-${x.tone}" style="width:${Math.max(1.5, (x.n / tot) * 100)}%" title="${esc(x.label)}: ${fmt(x.n)} (${Math.round((x.n / tot) * 100)}%)"></span>`).join('')}</div>`
      + `<div class="age-mix-legend">${mixOf(node).filter((x) => x.n > 0).map((x) => `<span><i class="age-mix-${x.tone}"></i>${esc(x.label)} <b>${fmt(x.n)}</b></span>`).join('')}</div>`;
  }
  function tableHtml(node, ch) {
    const head = `<tr><th>Group</th><th class="num">Total</th>`
      + THRESH.map((t) => `<th class="num age-th">${esc(t.label)}<button type="button" class="age-csv" data-age-csv="${t.months}" data-age-chx="${ch || ''}" title="CSV: ${esc(t.label)} purane tags">⬇ CSV</button></th>`).join('')
      + `<th class="num">Sabse purana</th><th class="num">Avg umr</th><th class="num" title="Allocation date sheet me nahi mili">Date nahi</th></tr>`;
    const body = GROUP_ORDER.map((g) => {
      const tot = (node && node.total[g]) || 0;
      const old = (node && node.oldest[g]) || 0, avg = (node && node.avg[g]) || 0, unk = (node && node.unknown[g]) || 0;
      return `<tr><td><b>${GROUP_LABEL[g]}</b></td><td class="num">${fmt(tot)}</td>`
        + THRESH.map((t) => bucketCell(node, g, t, ch)).join('')
        + `<td class="num dim">${old ? `${fmt(old)} din` : '—'}</td><td class="num dim">${avg ? `${fmt(avg)} din` : '—'}</td><td class="num">${unk ? `<button type="button" class="age-n gray" data-age-unknown="1" data-age-group="${g}" data-age-chx="${ch || ''}" title="Jin tags ki allocation date nahi mili">${fmt(unk)}</button>` : '<span class="dim">0</span>'}</td></tr>`;
    }).join('');
    const both = (m) => count(node, 'core', m) + count(node, 'comm', m);
    const extra = `<tr class="age-total"><td><b>Dono group</b></td><td class="num"><b>${fmt(nodeTotal(node))}</b></td>`
      + THRESH.map((t) => `<td class="num">${fmt(both(t.months))}</td>`).join('')
      + `<td class="num dim">${fmt(Math.max(node.oldest.core, node.oldest.comm))} din</td><td></td><td class="num">${fmt(nodeUnknown(node))}</td></tr>`;
    return `${mixBar(node)}<div class="table-wrap"><table class="tbl compact age-tbl"><thead>${head}</thead><tbody>${body}${extra}</tbody></table></div>`;
  }
  function chNote(ch) {
    const idx = state.index;
    const part = idx && idx[ch] && idx[ch].part;
    if (ch === 'gv') {
      const m = part ? part.matched || 0 : 0, own = part ? part.own || 0 : 0, tot = part ? part.total || 0 : 0;
      return `GV Tag Assignment me allocation date nahi hoti — ${own ? `${fmt(own)} tags sheet ki date se, ` : ''}${fmt(m)} / ${fmt(tot)} tags ki date StockDataa (tag ID / serial match → Agent / BC Allocated At) se`;
    }
    return 'StockDataa <b>Agent Allocated At</b> (khaali ho to BC Allocated At) se';
  }
  function emptyHtml(scope) {
    const who = scope && scope.kind === 'agent' ? 'Is agent' : scope && scope.kind === 'tl' ? 'Is TL' : 'Is selection';
    return `<p class="dim small">${who} ke naam par stock (StockDataa / Tag Assignment) nahi mila — ageing ke liye kuch nahi.</p>`;
  }
  function blockHtml(entry, scope, multi) {
    const node = entry.node, ch = entry.ch;
    const parked = entry.parked && nodeTotal(entry.parked)
      ? `<p class="dim small age-parked">🏬 Master / GV parked stock (ApnaPayment ke naam, agent nahi): <b>${fmt(nodeTotal(entry.parked))}</b> tags · ≥ 3 mahine <b>${fmt(count(entry.parked, 'core', 3) + count(entry.parked, 'comm', 3))}</b> · ≥ 6 mahine <b>${fmt(count(entry.parked, 'core', 6) + count(entry.parked, 'comm', 6))}</b> — upar wali table sirf field (agents) ki hai.</p>` : '';
    return `<div class="age-block" data-age-block="${ch}">${multi ? `<h5 class="age-ch">${CH_LABEL[ch]} <small class="dim">${fmt(nodeTotal(node))} tags</small></h5>` : ''}`
      + (nodeTotal(node) ? tableHtml(node, ch) : emptyHtml(scope)) + parked
      + `<p class="dim small age-note">📅 ${chNote(ch)} · buckets cumulative (≥ 3 mahine me 6+ wale bhi) · number par click = wahi tags · <b>⬇ CSV</b> = poori list.</p></div>`;
  }
  /** Ek scope ko host me render karo + CSV / list binding. */
  function renderHost(el, scope) {
    if (!el) return;
    if (state.error && !state.index) { el.innerHTML = `<p class="dim small">⚠️ Stock ageing load nahi hui — ${esc(state.error)}. <button type="button" class="btn small" data-age-retry>↻ Retry</button></p>`; bindHost(el, scope); return; }
    const list = nodesFor(scope);
    if (!list.length) { el.innerHTML = emptyHtml(scope); return; }
    el.innerHTML = list.map((e) => blockHtml(e, scope, list.length > 1)).join('') + '<div class="age-out" hidden></div>';
    bindHost(el, scope);
  }
  function summaryText(scope) {
    const list = nodesFor(scope);
    if (!list.length) return state.error && !state.index ? '⚠️ load nahi hui' : 'stock nahi';
    const node = list.length === 1 ? list[0].node : mergeNodes(list.map((x) => x.node), 'all', 'both');
    const both = (m) => count(node, 'core', m) + count(node, 'comm', m);
    const old = Math.max(node.oldest.core, node.oldest.comm);
    return `${fmt(nodeTotal(node))} tags · ≥ 3 mahine <b>${fmt(both(3))}</b> · ≥ 6 mahine <b class="${both(6) ? 'age-red' : ''}">${fmt(both(6))}</b>${old ? ` · sabse purana ${fmt(old)} din` : ''}`;
  }
  async function detailHtml(scope, months, g, chx, unknown) {
    const t = TH_BY_MONTH.get(Number(months)) || { label: unknown ? 'Date nahi' : 'Sab' };
    const sc = chx ? { ...scope, ch: chx } : scope;
    const res = await fetchTags(sc, unknown ? 0 : months, g, 40, unknown);
    const list = res.rows;
    const title = unknown ? `Date-nahi wale ${g ? GROUP_LABEL[g] : ''} tags` : `${esc(t.label)} purane ${g ? GROUP_LABEL[g] : 'saare'} tags`;
    return `<div class="age-list-head"><b>${title}: ${fmt(res.total)}</b>`
      + `<span class="btn-row"><button type="button" class="btn small" data-age-csv="${unknown ? 0 : months}" data-age-group="${g || ''}" data-age-chx="${chx || ''}" ${unknown ? 'data-age-unknown="1"' : ''}>⬇ CSV (${fmt(res.total)})</button>`
      + `<button type="button" class="btn small" data-age-close>✕ Band karo</button></span></div>`
      + (list.length ? `<div class="kd-scroll" style="max-height:260px"><table class="kd-tbl"><thead><tr><th>Tag ID</th><th>Barcode / serial</th><th>Class</th><th>Agent</th><th>TL</th><th>Allocated</th><th class="num">Age</th></tr></thead><tbody>`
        + list.map((x) => `<tr><td class="mono">${esc(x.tagId)}</td><td class="mono dim">${esc(U.barcode ? U.barcode(x.barcode) : x.barcode)}</td><td>${esc(x.cls)}</td><td>${esc(x.agent || '—')}${x.agentId ? ` <small class="dim">${esc(x.agentId)}</small>` : ''}${x.ch === 'gv' ? ' <small class="badge green">GV</small>' : ''}</td><td class="dim">${esc(x.tl || '—')}</td><td>${esc(x.date || '—')}${x.source === 'bc' ? ' <small class="dim" title="Agent date khaali — BC Allocated At">BC</small>' : x.source === 'stockdataa' ? ' <small class="dim" title="StockDataa se match">SD</small>' : ''}</td><td class="num">${x.age === null || x.age === undefined ? '—' : `<b>${fmt(x.age)}</b> din`}</td></tr>`).join('')
        + `</tbody></table></div>${res.total > list.length ? `<p class="dim small">Sabse purane ${list.length} dikh rahe hain — poori list CSV me ⬇</p>` : ''}`
        : '<p class="dim small">Is bucket me koi tag nahi.</p>');
  }
  function csvName(scope, months) {
    const who = scope.kind === 'all' ? 'network' : (scope.title || scope.key || scope.kind);
    return `stock-age-${U.slug(String(who))}-${months ? `${months}m` : 'all'}-${U.stamp()}.csv`;
  }
  async function csv(scope, months, g, unknown) {
    const res = await fetchTags(scope, unknown ? 0 : months, g, 150000, unknown);
    const head = ['Channel', 'Tag ID', 'Barcode / serial', 'Class', 'Group', 'Agent', 'Agent ID', 'TL', 'Allocated date', 'Date source', 'Age (days)', 'Age bucket'];
    const rows = res.rows.map((x) => [x.ch === 'gv' ? 'GV Partner' : 'First Forward', x.tagId, x.barcode, x.cls, GROUP_LABEL[groupOf(x.cls)].replace(/^\S+\s/, ''), x.agent, x.agentId || '', x.tl, x.date, x.source === 'bc' ? 'BC Allocated At' : x.source === 'agent' ? 'Agent Allocated At' : x.source === 'stockdataa' ? 'StockDataa match' : x.source === 'sheet' ? 'Tag Assignment' : '', x.age === null || x.age === undefined ? '' : x.age, bucketName(x.age)]);
    U.downloadCsv(csvName(scope, months), head, rows);
    return rows.length;
  }
  /** Host ke andar ke buttons — ek hi baar bind (delegation + flag). */
  function bindHost(el, scope) {
    if (!el || el.dataset.ageBound === '1') return;
    el.dataset.ageBound = '1';
    el.addEventListener('click', async (e) => {
      const retry = e.target.closest('[data-age-retry]');
      if (retry) { el.dataset.ageBound = ''; el.innerHTML = `<div class="age-loading">${U.loader ? U.loader('', { size: 'sm' }) : ''} 🧓 Dobara load ho rahi hai…</div>`; ready(true).then(() => renderHost(el, scope)); return; }
      const out = el.querySelector('.age-out');
      if (e.target.closest('[data-age-close]')) { if (out) { out.hidden = true; out.innerHTML = ''; } return; }
      const csvBtn = e.target.closest('[data-age-csv]');
      if (csvBtn) {
        const g = csvBtn.dataset.ageGroup || '', chx = csvBtn.dataset.ageChx || '';
        const unknown = csvBtn.dataset.ageUnknown === '1';
        U.setButtonBusy(csvBtn, true, 'CSV…');
        try {
          const n = await csv(chx ? { ...scope, ch: chx } : scope, Number(csvBtn.dataset.ageCsv) || 0, g, unknown);
          U.toast(n ? `⬇ ${n} tags ki CSV download ho gayi` : 'Is bucket me koi tag nahi', n ? 'ok' : 'warn');
        } catch (err) { U.toast(err.message || 'CSV nahi bani', 'err'); }
        finally { U.setButtonBusy(csvBtn, false); }
        return;
      }
      const openBtn = e.target.closest('[data-age-open], [data-age-unknown]');
      if (openBtn && out) {
        const unknown = openBtn.dataset.ageUnknown === '1';
        const months = Number(openBtn.dataset.ageOpen) || 1;
        const g = openBtn.dataset.ageGroup || '', chx = openBtn.dataset.ageChx || '';
        out.hidden = false;
        out.innerHTML = U.spinner('Tags aa rahe hain', { size: 'md' });
        try { out.innerHTML = await detailHtml(scope, months, g, chx, unknown); }
        catch (err) { out.innerHTML = U.errorBox(err); }
      }
    });
  }
  function fillChips(root) {
    for (const el of (root || document).querySelectorAll('[data-age-chip]')) {
      const scope = { kind: el.dataset.ageKind || 'agent', key: el.dataset.ageChip || '', ch: el.dataset.ageCh || 'ff' };
      el.innerHTML = nodesFor(scope).length ? chipHtml(scope) : '<span class="dim small">🧓 —</span>';
    }
  }
  function fillSums(root) {
    for (const el of (root || document).querySelectorAll('[data-age-sum]')) el.innerHTML = summaryText(scopeFrom(el));
  }
  function decorate(root) {
    const host = root || document;
    const scopes = [...host.querySelectorAll(HOST_SEL)];
    const hasChips = !!host.querySelector('[data-age-chip]'), hasSums = !!host.querySelector('[data-age-sum]');
    if (!scopes.length && !hasChips && !hasSums) return Promise.resolve(false);
    if (!state.index) {
      // Ageing abhi nahi aayi — SOFT_MS baad spinner ki jagah saaf message + Retry (data aate hi host khud bhar jaata hai).
      setTimeout(() => {
        if (state.index) return;
        for (const el of scopes) {
          if (el.isConnected === false || !el.querySelector('.age-loading')) continue;
          el.innerHTML = `<p class="dim small">⏳ Stock ageing abhi bhi ban rahi hai${state.building ? ' — server pehli baar poora StockDataa padh raha hai (1–2 min lag sakte hain)' : ''}. Baaki data upar ready hai. <button type="button" class="btn small" data-age-retry>↻ Retry</button></p>`;
          bindHost(el, scopeFrom(el));
        }
        for (const el of host.querySelectorAll('[data-age-sum]')) if (el.querySelector('.ffl')) el.textContent = '⏳ ban rahi hai…';
      }, SOFT_MS);
    }
    return ready().then((idx) => {
      for (const el of scopes) {
        if (el.isConnected === false) continue;
        renderHost(el, scopeFrom(el));
      }
      fillChips(host);
      fillSums(host);
      return !!(idx || state.index);
    });
  }
  /** Chhoti line (table cell): "≥3M 12+4 · 6M+ 3+1". */
  function chipText(scope) {
    const node = nodeFor(scope && scope.kind ? scope : { kind: 'agent', key: scope });
    if (!node) return '';
    const c = (m) => count(node, 'core', m), k = (m) => count(node, 'comm', m);
    return `≥3M ${fmt(c(3))}+${fmt(k(3))} · 6M+ ${fmt(c(6))}+${fmt(k(6))}`;
  }
  const chipHtml = (scope) => `<span class="age-chip" title="VC4+VC20 + VC5+ — 3 mahine se purane · 6 mahine se purane">🧓 ${chipText(scope)}</span>`;
  /** Index ready hone par poora ageing HTML (sync) — tests / diagnostics. */
  function html(scope) {
    if (!state.index) return state.error ? `<p class="dim small">⚠️ ${esc(state.error)}</p>` : emptyHtml(scope);
    const list = nodesFor(scope);
    if (!list.length) return emptyHtml(scope);
    return list.map((e) => blockHtml(e, scope, list.length > 1)).join('');
  }
  /** 📄 Agent/TL Summary page ke liye compact shape: buckets + byClass breakdown.
   *  Server se tag list lekar locally counts banata hai (summary endpoint me per-person class breakdown nahi hai). */
  async function compute(scope, opts) {
    const s = scope || {};
    const ch = s.ch === 'gv' ? 'gv' : 'ff';
    if (s.kind !== 'agent' && s.kind !== 'tl') return null;
    // `opts.waitMs` — itne ms me index na mile to null (caller UI "ban rahi hai / Retry" dikhaye, spinner nahi). Bina opts = purana (poora intezaar).
    const waitMs = opts && Number(opts.waitMs) > 0 ? Number(opts.waitMs) : 0;
    const started = Date.now();
    if (waitMs) { const idx = await U.within(ready(), waitMs, undefined); if (idx === undefined) return null; } else await ready();
    const params = new URLSearchParams({ ch, kind: s.kind, limit: '20000' });
    if (s.key) params.set('key', s.key);
    if (Array.isArray(s.keys) && s.keys.length) params.set('keys', s.keys.slice(0, 400).join('|'));
    let data;
    try {
      const left = waitMs ? Math.max(1000, waitMs - (Date.now() - started)) : 0;
      const call = FF.auth.api(`/api/stock-age/tags?${params.toString()}`);
      data = waitMs ? await U.within(call, left, null) : await call;
    } catch { return null; }
    if (!data || data.pending) return null;   // index tags ke waqt tak ready nahi → caller dobara koshish kare
    const rows = (data && data.rows) || [];
    const buckets = [
      { key: 'b1', label: '0–30d', n: 0 },
      { key: 'b30', label: '30+d', n: 0 },
      { key: 'b90', label: '90+d', n: 0 },
      { key: 'b150', label: '150+d', n: 0 },
      { key: 'b180', label: '180+d', n: 0 }
    ];
    const byClassMap = new Map();
    const slot = (cls) => {
      const k = String(cls || '—').toUpperCase();
      if (!byClassMap.has(k)) byClassMap.set(k, { cls: k, b1: 0, b30: 0, b90: 0, b150: 0, b180: 0, total: 0, old30: 0, old60: 0 });
      return byClassMap.get(k);
    };
    let total = 0, old30 = 0, old60 = 0;
    rows.forEach((r) => {
      const age = Number(r.age);
      const known = Number.isFinite(age) && age >= 0;
      const c = slot(r.cls || 'NA');
      c.total++; total++;
      if (!known) return;
      if (age >= 30) { c.b30++; buckets[1].n++; old30++; } else { c.b1++; buckets[0].n++; }
      if (age >= 60) { /* 60+d critical KPI = 90+d bucket (3 mahine) se match karta hai */ }
      if (age >= 90) { c.b90++; buckets[2].n++; }
      if (age >= 150) { c.b150++; buckets[3].n++; }
      if (age >= 180) { c.b180++; buckets[4].n++; }
      // KPI "60+d critical" = 90+ (≥3 mahine) — baaki UI 30/90/150/180 cumulative use karta hai.
      if (age >= 90) { c.old60++; old60++; }
    });
    byClassMap.forEach((c) => { c.old30 = c.b30 + c.b90 + c.b150 + c.b180; c.old60 = c.b90 + c.b150 + c.b180; });
    buckets[1].n = old30;
    buckets[2].n = old60;
    const out = { total, old30, old60, buckets, byClass: [...byClassMap.values()].sort((a, b) => b.total - a.total) };
    out[ch] = out;
    return out;
  }

  FF.stockAge = {
    ready, status, forAgent, forTl, nodesFor, nodeFor, hostHtml, sectionHtml, html, decorate, csv, fetchTags, compute, chipHtml, chipText, summaryText, tagsOlder, mixOf,
    thresholds: THRESH, groupOf, bucketName, mergeNodes,
    get index() { return state.index; }, get error() { return state.error; },
    _setIndexForTest(data) { state.index = { at: Date.now(), data, today: data.today, ff: buildMaps('ff', data.ff), gv: buildMaps('gv', data.gv), total: 0, unknown: 0 }; state.at = Date.now(); state.error = ''; }
  };
})(window.FF);
