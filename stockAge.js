/* 🧓 STOCK AGEING (v3.28) — "ye stock kitna purana hai?" (StockDataa ke **Agent Allocated At** se).
 *
 * Kyun: field me pada purana stock hi asli problem hota hai. Ye module StockDataa ki har row ki
 * allocation date (J = Agent Allocated At; khaali ho to G = BC Allocated At fallback) padhta hai aur
 * agent/TL ke hisaab se batata hai ki kitna stock **1 mahine, 3 mahine, 5 mahine aur 6+ mahine** se
 * purana hai — do groups me: 🚗 **VC4 + VC20** (car) aur 🚚 **VC5+** (commercial).
 *
 * Har month ke saath **⬇ CSV** button hai (`stockAge.hostHtml` se render hota hai) — jis month par click
 * karo, utne purane tags ki poori list (tag ID, barcode, class, agent, TL, allocation date, age) CSV me.
 * Number par click karne se wahi list drawer/card ke andar bhi dikh jaati hai.
 *
 * Data ek hi gviz query se aata hai (7-8 columns, server cache 10 min) aur index agent + TL dono ke
 * hisaab se banta hai — isliye Stock page, agent/TL drawer, tag request — sab jagah same number dikhte hain.
 *
 * Public API (sab safe/no-throw):
 *   FF.stockAge.ready(force)            → Promise<index>
 *   FF.stockAge.forAgent(idOrName)      → node | null      (agent ke tags)
 *   FF.stockAge.forTl(name)             → node | null      (TL ke saare agents ke tags)
 *   FF.stockAge.hostHtml(scope, opts)   → HTML host (placeholder, async bhar jaata hai)
 *   FF.stockAge.html(scope)             → index ready hone par poora table HTML (sync)
 *   FF.stockAge.decorate(root)          → saare [data-age-host] bhar do + CSV/expand bind karo
 *   FF.stockAge.csv(scope, months)      → CSV download (months = 1|3|5|6)
 */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;

  // 🚗 VC4 + VC20 ek jagah · 🚚 VC5+ (baaki sab commercial) ek jagah
  const GROUP_LABEL = { core: '🚗 VC4 + VC20', comm: '🚚 VC5+ (commercial)' };
  const GROUP_ORDER = ['core', 'comm'];
  function groupOf(cls) { const c = String(cls || '').toUpperCase().replace(/^VC/, ''); return (c === '4' || c === '20') ? 'core' : 'comm'; }
  // Month thresholds — cumulative ("isse purane"): 1 mahina = 30+ din, 3 = 90+, 5 = 150+, 6 = 180+
  const THRESH = [
    { months: 1, days: 30, label: '≥ 1 mahina' },
    { months: 3, days: 90, label: '≥ 3 mahine' },
    { months: 5, days: 150, label: '≥ 5 mahine' },
    { months: 6, days: 180, label: '≥ 6 mahine' }
  ];
  const TH_BY_MONTH = new Map(THRESH.map((t) => [t.months, t]));
  const HOST_SEL = '[data-age-host]';

  const state = { at: 0, promise: null, index: null, error: '', seq: 0 };
  const AGE_I = 6; // tag array: [tagId, barcode, cls, day, agentName, tl, age, agentId]

  /** Sheet ke date formats: Date(2026,4,12) · 2026-05-12 · 12/05/2026 (IST) — sab handle. */
  function parseDay(v) {
    const x = String(v || '');
    let m = x.match(/Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
    if (m) return Date.UTC(+m[1], +m[2], +m[3]);
    m = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = x.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return Date.UTC(y, +m[2] - 1, +m[1]); }
    return 0;
  }
  const ageDays = (day) => Math.floor((Date.now() - day) / 86400e3);
  const pkey = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const digits = (v) => String(v || '').replace(/\D/g, '');

  function emptyNode(kind, key, extra) {
    return { kind, key, name: (extra && extra.name) || key, agentId: (extra && extra.agentId) || '', tl: (extra && extra.tl) || '', tags: [], counts: { core: {}, comm: {} }, total: { core: 0, comm: 0 }, oldest: { core: 0, comm: 0 } };
  }
  function addTag(node, tag, g) {
    node.tags.push(tag);
    node.total[g] = (node.total[g] || 0) + 1;
    const age = tag[AGE_I]; // 6 = age (din) — tag array ka index
    if (age > (node.oldest[g] || 0)) node.oldest[g] = age;
    for (const t of THRESH) if (age >= t.days) node.counts[g][t.months] = (node.counts[g][t.months] || 0) + 1;
  }
  /** Ek tag row ka compact record: [tagId, barcode, cls, day, agentName, tlName, age, agentId]. */
  const normCls = (v) => { const d = digits(v); return /^(4|5|6|7|12|16|20)$/.test(d) ? `VC${d}` : String(v || '').trim().toUpperCase(); };
  function tagOf(r, cols) {
    const day = parseDay(r[cols.date]) || parseDay(r[cols.bcDate]);
    if (!day) return null;
    return [String(r[cols.tagId] || ''), String(r[cols.barcode] || ''), normCls(r[cols.cls]), day, String(r[cols.agentName] || ''), String(r[cols.tl] || ''), ageDays(day), digits(r[cols.agentId])];
  }

  async function loadIndex() {
    const s = FF.config.stock || {};
    const letters = { tagId: s.tagId, barcode: s.barcode, cls: s.cls, agentId: s.agentId, agentName: s.agentName, tl: s.tlName, date: s.agentAllocatedAt, bcDate: s.bcAllocatedAt };
    const used = [...new Set(Object.values(letters).map((x) => String(x || '').trim().toUpperCase()).filter(Boolean))];
    if (!used.length) return { error: 'StockDataa ke columns config me nahi mile (Settings → Sheets & tabs)' };
    const idx = new Map(); // letter → col index in response
    const tq = `select ${used.join(', ')} where ${String(s.tagId || '').toUpperCase()} is not null`;
    const t = await FF.data.query(s.sheet, tq);
    const rows = FF.data.textRows(t);
    const labels = (t.cols || []).map((c) => `${String(c.id || '').trim().toUpperCase()}|${String(c.label || '').trim().toUpperCase()}`);
    used.forEach((L, i) => {
      const at = labels.findIndex((x) => x.split('|').includes(L));
      idx.set(L, at >= 0 ? at : i);
    });
    const cols = {
      tagId: idx.get(String(letters.tagId).toUpperCase()),
      barcode: idx.get(String(letters.barcode).toUpperCase()),
      cls: idx.get(String(letters.cls).toUpperCase()),
      agentId: idx.get(String(letters.agentId).toUpperCase()),
      agentName: idx.get(String(letters.agentName).toUpperCase()),
      tl: idx.get(String(letters.tl).toUpperCase()),
      date: idx.get(String(letters.date).toUpperCase()),
      bcDate: letters.bcDate ? idx.get(String(letters.bcDate).toUpperCase()) : -1
    };
    const out = {
      at: Date.now(), rows: rows.length, unknown: 0, total: 0,
      byAgent: new Map(), byTl: new Map(), all: emptyNode('all', 'all', { name: 'Poora network' }),
      cols: FF.config.stock, thresholds: THRESH
    };
    for (const r of rows) {
      const rec = { tagId: r[cols.tagId], barcode: r[cols.barcode], cls: r[cols.cls], agentId: r[cols.agentId], agentName: r[cols.agentName], tl: r[cols.tl], date: r[cols.date], bcDate: cols.bcDate >= 0 ? r[cols.bcDate] : '' };
      const tag = tagOf(r, cols); // raw row array (rec object ke numeric index nahi hote)
      if (!tag) { out.unknown++; continue; }
      const g = groupOf(rec.cls);
      out.total++;
      // agent node (ID se primary; ID khaali ho to naam se)
      const aKey = digits(rec.agentId) || `n:${pkey(rec.agentName)}`;
      let an = out.byAgent.get(aKey);
      if (!an) { an = emptyNode('agent', aKey, { name: rec.agentName || rec.agentId, agentId: digits(rec.agentId), tl: rec.tl }); out.byAgent.set(aKey, an); }
      if (!an.tl && rec.tl) an.tl = rec.tl;
      if ((!an.name || an.name === an.key) && rec.agentName) an.name = rec.agentName;
      addTag(an, tag, g);
      // TL node
      const tKey = pkey(rec.tl) || '—';
      let tn = out.byTl.get(tKey);
      if (!tn) { tn = emptyNode('tl', tKey, { name: rec.tl || '—' }); out.byTl.set(tKey, tn); }
      addTag(tn, tag, g);
      addTag(out.all, tag, g);
    }
    return out;
  }

  function ready(force) {
    if (!force && state.index && Date.now() - state.at < 5 * 60e3) return Promise.resolve(state.index);
    if (state.promise && !force) return state.promise;
    state.promise = loadIndex().then((idx) => {
      if (idx && idx.error) { state.error = idx.error; }
      else { state.index = idx; state.error = ''; }
      state.at = Date.now();
      return state.index;
    }).catch((err) => {
      state.error = (err && err.message) || 'aging load nahi hui';
      state.at = Date.now();
      return state.index;
    }).finally(() => { state.promise = null; });
    return state.promise;
  }

  const norm = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
  function forAgent(idOrName) {
    const idx = state.index;
    if (!idx) return null;
    const d = digits(idOrName);
    if (d && idx.byAgent.has(d)) return idx.byAgent.get(d);
    const want = norm(idOrName);
    for (const n of idx.byAgent.values()) if (norm(n.name) === want || norm(n.agentId) === want) return n;
    return null;
  }
  function forTl(name) { const idx = state.index; return idx ? (idx.byTl.get(norm(name)) || null) : null; }
  function nodeFor(scope) {
    if (!scope) return null;
    if (scope.kind === 'agent') return forAgent(scope.key);
    if (scope.kind === 'tl') return forTl(scope.key);
    return state.index ? state.index.all : null;
  }

  // ---- 🧮 numbers ---------------------------------------------------------------------------------
  const count = (node, g, months) => (node && node.counts[g] && node.counts[g][months]) || 0;
  /** tags older than `months` (0 = sabhi) — group filter optional. */
  function tagsOlder(node, months, g) {
    if (!node) return [];
    const days = months ? (TH_BY_MONTH.get(Number(months)) || { days: months * 30 }).days : 0;
    return node.tags.filter((x) => (g ? groupOf(x[2]) === g : true) && (!days || x[6] >= days));
  }
  const nodeTotal = (node) => (node ? (node.total.core || 0) + (node.total.comm || 0) : 0);

  // ---- 🖨 UI ---------------------------------------------------------------------------------------
  /** Host div — `decorate(root)` ise async bhar deta hai (card/drawer/table cell sab me same). */
  function hostHtml(scope, opts) {
    const o = opts || {};
    const id = `age${++state.seq}`;
    return `<div class="age-host" ${HOST_SEL} data-age-id="${id}" data-age-kind="${esc(scope.kind)}" data-age-key="${esc(scope.key)}" data-age-title="${esc(o.title || '')}">`
      + `<div class="dim small age-loading">🧓 Stock ageing load ho rahi hai…</div></div>`;
  }
  const fmt = (n) => U.fmt(n);
  function bucketCell(node, g, t) {
    const n = count(node, g, t.months);
    const tone = t.months >= 6 ? 'red' : t.months >= 5 ? 'amber' : t.months >= 3 ? 'orange' : '';
    if (!n) return `<td class="num dim">0</td>`;
    return `<td class="num"><button type="button" class="age-n ${tone}" data-age-open="${t.months}" data-age-group="${g}" title="${esc(t.label)} purane tags dekho (ya CSV ⬇)">${fmt(n)}</button></td>`;
  }
  function tableHtml(node, scope, opts) {
    const o = opts || {};
    const head = `<tr><th>Group</th><th class="num">Total</th>`
      + THRESH.map((t) => `<th class="num age-th">${esc(t.label)}<button type="button" class="age-csv" data-age-csv="${t.months}" title="CSV: ${esc(t.label)} purane tags">⬇ CSV</button></th>`).join('')
      + `<th class="num">Sabse purana</th></tr>`;
    const body = GROUP_ORDER.map((g) => {
      const tot = (node && node.total[g]) || 0;
      const old = (node && node.oldest[g]) || 0;
      return `<tr><td><b>${GROUP_LABEL[g]}</b></td><td class="num">${fmt(tot)}</td>`
        + THRESH.map((t) => bucketCell(node, g, t)).join('')
        + `<td class="num dim">${old ? `${fmt(old)} din` : '—'}</td></tr>`;
    }).join('');
    const extra = `<tr class="age-total"><td><b>Dono group</b></td><td class="num"><b>${fmt(nodeTotal(node))}</b></td>`
      + THRESH.map((t) => `<td class="num">${fmt(count(node, 'core', t.months) + count(node, 'comm', t.months))}</td>`).join('')
      + `<td></td></tr>`;
    return `<div class="table-wrap"><table class="tbl compact age-tbl"><thead>${head}</thead><tbody>${body}${extra}</tbody></table></div>`
      + `<div class="age-out" hidden></div>`
      + `<p class="dim small age-note">📅 Allocation date (StockDataa <b>Agent Allocated At</b>) se · buckets cumulative hain (≥ 3 mahine me 6+ mahine wale bhi shaamil) · month ke saath <b>⬇ CSV</b> = us se purane saare tags (tag ID, barcode, class, agent, TL, date, age)${o.note ? ` · ${o.note}` : ''}.</p>`;
  }
  function emptyHtml() {
    return `<p class="dim small">StockDataa me allocation date wale rows nahi mile — Settings → Sheets & tabs me <b>Agent Allocated At</b> column (aur fallback <b>BC Allocated At</b>) set karo.</p>`;
  }
  /** Ek node ko host me render karo + CSV/expand binding. */
  function renderHost(el, node, scope) {
    if (!el) return;
    if (state.error) { el.innerHTML = `<p class="dim small">⚠️ Stock ageing load nahi hui — ${esc(state.error)}. <button type="button" class="btn small" data-age-retry>↻ Retry</button></p>`; bindHost(el, scope); return; }
    if (!node || !node.tags.length) { el.innerHTML = emptyHtml(); return; }
    el.innerHTML = tableHtml(node, scope);
    bindHost(el, scope);
  }
  function detailHtml(node, months, g, scope) {
    const t = TH_BY_MONTH.get(Number(months)) || { label: `≥ ${months} mahine` };
    const list = tagsOlder(node, months, g).sort((a, b) => b[6] - a[6]);
    const show = list.slice(0, 40);
    return `<div class="age-list-head"><b>${esc(t.label)} purane ${g ? GROUP_LABEL[g] : 'saare'} tags: ${fmt(list.length)}</b>`
      + `<span class="btn-row"><button type="button" class="btn small" data-age-csv="${months}" data-age-group="${g || ''}">⬇ CSV (${fmt(list.length)})</button>`
      + `<button type="button" class="btn small" data-age-close>✕ Band karo</button></span></div>`
      + (list.length ? `<div class="kd-scroll" style="max-height:260px"><table class="kd-tbl"><thead><tr><th>Tag ID</th><th>Barcode</th><th>Class</th><th>Agent</th><th>TL</th><th>Allocated</th><th class="num">Age</th></tr></thead><tbody>`
        + show.map((x) => `<tr><td class="mono">${esc(x[0])}</td><td class="mono dim">${esc(x[1])}</td><td>${esc(x[2])}</td><td>${esc(x[4])}${x[7] ? ` <small class="dim">${esc(x[7])}</small>` : ''}</td><td class="dim">${esc(x[5] || '—')}</td><td>${esc(new Date(x[3]).toISOString().slice(0, 10))}</td><td class="num"><b>${fmt(x[6])}</b> din</td></tr>`).join('')
        + `</tbody></table></div>${list.length > show.length ? `<p class="dim small">Top ${show.length} dikha rahe hain — poora list CSV me ⬇</p>` : ''}`
        : '<p class="dim small">Is bucket me koi tag nahi.</p>');
  }
  function csvName(scope, months) {
    const t = TH_BY_MONTH.get(Number(months)) || { months };
    const who = scope.kind === 'agent' ? scope.key : scope.kind === 'tl' ? scope.key : 'network';
    return `stock-age-${U.slug(who)}-${String(t.months).replace('.', '_')}m-${U.stamp()}.csv`;
  }
  function csv(scope, months, g) {
    const node = nodeFor(scope);
    const list = tagsOlder(node, months, g).sort((a, b) => b[6] - a[6]);
    const head = ['Tag ID', 'Barcode', 'Class', 'Group', 'Agent', 'Agent ID', 'TL', 'Allocated date', 'Age (days)', 'Age bucket'];
    const rows = list.map((x) => [x[0], x[1], x[2], GROUP_LABEL[groupOf(x[2])].replace(/^\S+\s/, ''), x[4], x[7] || '', x[5], new Date(x[3]).toISOString().slice(0, 10), x[6], bucketName(x[6])]);
    U.downloadCsv(csvName(scope, months), head, rows);
    return list.length;
  }
  function bucketName(age) {
    if (age >= 180) return '6+ mahine';
    if (age >= 150) return '5-6 mahine';
    if (age >= 90) return '3-5 mahine';
    if (age >= 30) return '1-3 mahine';
    return '0-1 mahina';
  }
  /** Host ke andar ke buttons — ek hi baar bind hote hain (delegation + flag). */
  function bindHost(el, scope) {
    if (!el || el.dataset.ageBound === '1') return;
    el.dataset.ageBound = '1';
    el.addEventListener('click', (e) => {
      const node = nodeFor(scope);
      const retry = e.target.closest('[data-age-retry]');
      if (retry) { el.dataset.ageBound = ''; el.innerHTML = '<div class="dim small">🧓 Dobara load ho rahi hai…</div>'; ready(true).then((idx) => renderHost(el, nodeFor(scope) || (idx && idx.all), scope)); return; }
      const close = e.target.closest('[data-age-close]');
      const out = el.querySelector('.age-out');
      if (close) { if (out) { out.hidden = true; out.innerHTML = ''; } return; }
      const csvBtn = e.target.closest('[data-age-csv]');
      if (csvBtn) {
        const g = csvBtn.dataset.ageGroup || '';
        const n = csv(scope, Number(csvBtn.dataset.ageCsv) || 1, g);
        U.toast(n ? `⬇ ${n} tags ki CSV download ho gayi` : 'Is bucket me koi tag nahi', n ? 'ok' : 'warn');
        return;
      }
      const openBtn = e.target.closest('[data-age-open]');
      if (openBtn && out) {
        const months = Number(openBtn.dataset.ageOpen) || 1;
        const g = openBtn.dataset.ageGroup || '';
        out.hidden = false;
        out.innerHTML = detailHtml(node, months, g, scope);
      }
    });
  }
  /** Page/drawer ke saare hosts bhar do (async — pehle spinner, phir table). */
  function fillChips(root) {
    for (const el of (root || document).querySelectorAll('[data-age-chip]')) {
      const scope = { kind: el.dataset.ageKind || 'agent', key: el.dataset.ageChip || '' };
      const node = nodeFor(scope);
      el.innerHTML = node ? chipHtml(scope) : '<span class="dim small">🧓 —</span>';
    }
  }
  function decorate(root) {
    const host = root || document;
    const scopes = [...host.querySelectorAll(HOST_SEL)];
    const hasChips = !!host.querySelector('[data-age-chip]');
    if (!scopes.length && !hasChips) return Promise.resolve(false);
    return ready().then((idx) => {
      for (const el of scopes) {
        if (el.isConnected === false) continue;
        const scope = { kind: el.dataset.ageKind || 'all', key: el.dataset.ageKey || '' };
        renderHost(el, nodeFor(scope), scope);
      }
      fillChips(host);
      return !!(idx || state.index);
    });
  }
  /** Ek chhoti line (table cell ke liye): "≥3M 12 · 6M+ 3" — index ready na ho to — */
  function chipText(scope) {
    const node = nodeFor(scope);
    if (!node) return '';
    const c = (m) => count(node, 'core', m), k = (m) => count(node, 'comm', m);
    return `≥3M ${fmt(c(3))}+${fmt(k(3))} · 6M+ ${fmt(c(6))}+${fmt(k(6))}`;
  }
  const chipHtml = (scope) => `<span class="age-chip" title="VC4+VC20 + VC5+ — 3 mahine se purane · 6 mahine se purane">🧓 ${chipText(scope)}</span>`;

  /** Index ready hone par poora ageing table HTML (sync) — tests/diagnostics ke liye bhi. */
  function html(scope, opts) {
    const node = nodeFor(scope);
    if (!node) return state.error ? `<p class="dim small">⚠️ ${esc(state.error)}</p>` : emptyHtml();
    if (!node.tags.length) return emptyHtml();
    return tableHtml(node, scope, opts);
  }
  FF.stockAge = { ready, forAgent, forTl, hostHtml, html, decorate, csv, chipHtml, chipText, tagsOlder, thresholds: THRESH, groupOf, bucketName,
    get index() { return state.index; }, get error() { return state.error; } };
})(window.FF);
