/* 🔢 Barcode Checker (v216) — Management me alag page.
   • Range tab: first + last barcode daalte hi range ke har barcode ka status (auto-check).
   • Multiple tab: kai barcodes paste karo (line / comma / space) → har barcode kis agent ke paas map hai.
   Status: ✅ Issued (EIR) · 📦 Agent stock · 🏢 Master / BC stock · ❓ Not found.
   Stock = server ka StockDataa index (/api/barcode-range, /api/barcode-lookup — sirf wahi rows aati hain).
   Issued = EIR me Tag ID se (stock me na mile to Tag ID aas-paas ke stock tags se anumaan: har barcode +0x20).
   Filters: status chips · agent click · search · Excel (filtered / all). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const MAX = 5000;
  const state = { tab: 'range', rows: null, title: '', filter: 'all', agent: '', q: '', busy: 0, lastKey: '' };

  // ---- 🔧 helpers -------------------------------------------------------------------------------------
  const bcDigits = (v) => String(v || '').replace(/\D/g, '');
  const strip0 = (d) => String(d || '').replace(/^0+(?=\d)/, '');
  function expandRange(a, b) {
    const da = bcDigits(a), db = bcDigits(b);
    if (da.length < 4 || db.length < 4) throw new Error('Pura barcode daalo (digits chahiye)');
    const A = BigInt(da), B = BigInt(db);
    if (B < A) throw new Error('First barcode last se bada hai');
    if (B - A >= BigInt(MAX)) throw new Error(`Range me ${(B - A + 1n).toString()} barcodes hain — max ${MAX.toLocaleString('en-IN')}. Chhota karo.`);
    const width = Math.max(da.length, db.length);
    const tpl = String(a).trim();
    const fmt = (n) => { const d = n.toString().padStart(width, '0'); let k = 0; return /\D/.test(tpl) && da.length === width ? tpl.replace(/\d/g, () => d[k++] || '') : d; };
    const out = [];
    for (let n = A; n <= B; n++) out.push({ n, label: fmt(n), key: strip0(n.toString()) });
    return out;
  }
  const isHex = (t) => /^[0-9A-F]{6,}$/i.test(String(t || ''));
  /** Stock tags (barcode, tagId) se barcode → Tag ID ka step nikaalo (real data: har barcode +0x20). */
  function tagInfer(points) {
    const pts = (points || []).filter((x) => isHex(x.tagId) && x.n !== undefined).map((x) => ({ n: x.n, t: BigInt('0x' + x.tagId), len: x.tagId.length }));
    if (!pts.length) return null;
    pts.sort((p, q) => (p.n < q.n ? -1 : p.n > q.n ? 1 : 0));
    let step = 32n;
    if (pts.length >= 2) {
      const a = pts[0], b = pts[pts.length - 1], dn = b.n - a.n;
      if (dn > 0n && (b.t - a.t) % dn === 0n && (b.t - a.t) / dn > 0n) step = (b.t - a.t) / dn;
    }
    const dist = (p, n) => (p.n > n ? p.n - n : n - p.n);
    return (n) => {
      let best = pts[0];
      for (const p of pts) if (dist(p, n) < dist(best, n)) best = p;
      const t = best.t + (n - best.n) * step;
      return t > 0n ? t.toString(16).toUpperCase().padStart(best.len, '0') : '';
    };
  }
  async function eirByTags(tags) {
    const e = FF.config.eir, D = FF.data;
    const out = new Map();
    const parts = []; for (let i = 0; i < tags.length; i += 120) parts.push(tags.slice(i, i + 120));
    let next = 0;
    const worker = async () => {
      while (next < parts.length) {
        const part = parts[next++];
        const tq = `select ${[e.tagId, e.date, e.vrn, e.cls, e.agentName, e.agentId, e.tlName, e.status, e.type, e.masterId, e.gvName].join(', ')} where ${part.map((t) => `${e.tagId} = '${t}'`).join(' or ')}`;
        const t = await D.query(e.sheet, tq, {});
        (t.rows || []).forEach((r) => {
          const d = D.cellDate(r[1]);
          const ch = FF.model.channelOf(D.cellText(r[9]), D.cellText(r[6]));
          out.set(D.cellText(r[0]).toUpperCase(), { date: d ? U.dateKey(d) : D.cellText(r[1]), vrn: D.cellText(r[2]), cls: D.cellText(r[3]), agent: (ch === 'GV Partner' ? D.cellText(r[10]) : '') || D.cellText(r[4]), agentId: D.cellText(r[5]), tl: D.cellText(r[6]), status: D.cellText(r[7]), type: D.cellText(r[8]), ch });
        });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return out;
  }
  const STATUS = {
    iss: { label: '✅ Issued', tone: 'green' },
    st: { label: '📦 Agent stock', tone: 'purple' },
    bc: { label: '🏢 Master / BC stock', tone: 'gray' },
    nf: { label: '❓ Not found', tone: 'red' }
  };
  const HEAD = ['Barcode', 'Tag ID', 'Status', 'Class', 'Agent', 'Agent ID', 'TL', 'Allocated / Issue date', 'VRN', 'Note', 'Dispatch date', 'Dispatched to'];
  const cells = (r) => [r.barcode, r.tagId, STATUS[r.k].label, r.cls, r.agent, r.agentId, r.tl, r.date, r.vrn, r.note, r.dDate || '', r.dName || ''];
  // 🔎 v3.85 — search haystack ek baar banta hai (lowercase + barcode ke sirf digits) → har key-press par bas includes().
  const hay = (r) => r._h || (r._h = `${cells(r).join(' ').toLowerCase()} ${bcDigits(r.barcode)}`);
  const statusPlain = (r) => STATUS[r.k].label.replace(/^[^A-Za-z]+/, '').trim();
  /** Copy text: 'both' = Barcode<TAB>Tag ID<TAB>Status (Sheets/Excel me seedha columns me paste), 'bc' = sirf barcode, 'tag' = sirf tag id. */
  const copyText = (rows, mode) => rows.map((r) => (mode === 'bc' ? r.barcode : mode === 'tag' ? (r.tagId || '') : [r.barcode, r.tagId || '', statusPlain(r)].join('\t'))).filter((x) => x !== '').join('\n');
  async function copyOut(text, what) {
    const ok = U.copyText ? await U.copyText(text) : false;
    if (U.toast) U.toast(ok ? `📋 ${what} copy ho gaya` : 'Copy nahi hua — browser permission check karein', ok ? 'ok' : 'error');
    return ok;
  }
  const dLabel = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && U.labelDateKey ? U.labelDateKey(iso, true) : (iso || ''));
  /** 📒 Dispatch ledger (IDFC Stock Sheet / GV Stock Sheet First–Last ranges) → har barcode ki dispatch date + naam. */
  async function attachDispatch(rows, started) {
    try {
      const { map, meta } = await (started || FF.data.dispatchLookup(rows.map((r) => r.barcode)));
      rows.forEach((r) => {
        const hit = map.get(String(r.barcode).replace(/\D/g, '').replace(/^0+/, ''));
        r.dDate = r.dName = '—';
        if (!hit) return;
        const parts = [];
        ['ff', 'gv'].forEach((ch) => (hit[ch] || []).slice(0, 1).forEach((e) => parts.push({ ch, e, more: (hit[ch + 'Count'] || 1) - 1 })));
        if (!parts.length) return;
        r.dDate = parts.map((x) => `${parts.length > 1 ? x.ch.toUpperCase() + ' ' : ''}${dLabel(x.e.date) || '—'}`).join(' | ');
        r.dName = parts.map((x) => `${parts.length > 1 ? x.ch.toUpperCase() + ' · ' : ''}${x.e.agent || '—'}${x.e.agentId ? ` (${x.e.agentId})` : ''}${x.e.approx ? ' ~' : ''}${x.more > 0 ? ` +${x.more}` : ''}`).join(' | ');
      });
      state.dispMeta = meta;
    } catch (err) { rows.forEach((r) => { r.dDate = r.dName = ''; }); state.dispMeta = { error: String((err && err.message) || err) }; }
  }
  const SEARCHING = '🔎 searching…';
  /** Ek barcode ka final row: stock row + EIR hit + anumaanit tag. */
  function makeRow(label, st, tag, inferred, is) {
    if (is) return { barcode: label, k: 'iss', tagId: tag, cls: is.cls, agent: is.agent, agentId: is.agentId, tl: is.tl, date: is.date, vrn: is.vrn, note: `${is.ch === 'GV Partner' ? 'GV' : 'FF'}${st ? ' · StockDataa me bhi hai' : inferred ? ' · tag ID barcode se anumaanit' : ''}${is.type ? ' · ' + is.type : ''}` };
    if (st) return { barcode: label, k: st.agent ? 'st' : 'bc', tagId: tag, cls: st.cls, agent: st.agent || st.inventory || '', agentId: st.agentId || '', tl: st.tl || '', date: st.agentAt || st.bcAt || '', vrn: '', note: st.agent ? '' : 'Agent ko allocate nahi' };
    return { barcode: label, k: 'nf', tagId: tag, cls: '', agent: '', agentId: '', tl: '', date: '', vrn: '', note: tag ? 'Na stock me, na EIR me (tag ID anumaanit)' : 'Stock me nahi mila · tag ID ka andaza nahi laga' };
  }

  // ---- 🔎 checks --------------------------------------------------------------------------------------
  async function checkRange(first, last, firstTag) {
    const list = expandRange(first, last);
    const res = await FF.auth.api('/api/barcode-range', 'POST', { first, last });
    const byKey = new Map();
    (res.rows || []).forEach((r) => { const k = strip0(bcDigits(r.barcode)); if (k && !byKey.has(k)) byKey.set(k, r); });
    const pts = [];
    list.forEach((b) => { const r = byKey.get(b.key); if (r) pts.push({ n: b.n, tagId: String(r.tagId || '').toUpperCase() }); });
    if (firstTag) pts.push({ n: list[0].n, tagId: firstTag });
    const infer = tagInfer(pts);
    const tagOf = new Map(), inferred = new Set();
    list.forEach((b) => { const r = byKey.get(b.key); let t = r && r.tagId ? String(r.tagId).toUpperCase() : ''; if (!t && infer) { t = infer(b.n); if (t) inferred.add(b.key); } if (t) tagOf.set(b.key, t); });
    const eir = tagOf.size ? await eirByTags([...new Set(tagOf.values())]) : new Map();
    return list.map((b) => { const t = tagOf.get(b.key) || ''; return makeRow(b.label, byKey.get(b.key), t, inferred.has(b.key), t ? eir.get(t) : null); });
  }
  function parseMulti(text) {
    const seen = new Set(), out = [];
    String(text || '').split(/[\n,;\t ]+/).map((x) => x.trim()).filter(Boolean).forEach((x) => {
      const k = strip0(bcDigits(x)) || x.toUpperCase();
      if (seen.has(k)) return; seen.add(k); out.push(x);
    });
    return out;
  }
  async function checkMulti(list) {
    if (list.length > MAX) throw new Error(`Ek baar me max ${MAX.toLocaleString('en-IN')} barcodes`);
    const res = await FF.auth.api('/api/barcode-lookup', 'POST', { barcodes: list });
    const items = (res.results || []).map((r) => {
      const st = (r.rows || [])[0] || null;
      let tag = st && st.tagId ? String(st.tagId).toUpperCase() : '', inf = false;
      if (!tag && r.near && r.near.length && bcDigits(r.barcode)) {
        const f = tagInfer(r.near.map((x) => ({ n: BigInt(bcDigits(x.barcode) || '0'), tagId: String(x.tagId || '').toUpperCase() })));
        if (f) { tag = f(BigInt(bcDigits(r.barcode))); inf = !!tag; }
      }
      return { label: r.barcode, st, tag, inf };
    });
    const eir = await eirByTags([...new Set(items.map((x) => x.tag).filter(Boolean))]);
    return items.map((x) => makeRow(x.label, x.st, x.tag, x.inf, x.tag ? eir.get(x.tag) : null));
  }

  // ---- 🖼️ render ----------------------------------------------------------------------------------------
  function visible() {
    const terms = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean).map((t) => ({ t, d: /^[\d-]+$/.test(t) && t.replace(/\D/g, '').length >= 3 ? t.replace(/\D/g, '') : '' }));
    return (state.rows || []).filter((r) => {
      if (state.filter !== 'all' && r.k !== state.filter) return false;
      if (state.agent && r.agent !== state.agent) return false;
      if (!terms.length) return true;
      const h = hay(r);
      return terms.every((x) => h.includes(x.t) || (x.d && h.includes(x.d)));   // dashed / bina dash dono barcode chalte hain
    });
  }
  function dispNote() {
    const m = state.dispMeta;
    if (!m) return '';
    if (m.error) return `<p class="dim small">⚠️ Dispatch ledger load nahi hui: ${esc(m.error)}</p>`;
    const errs = Object.entries(m.errors || {});
    const src = (m.sources || []).map((s) => `${s.ok ? '✅' : '❌'} ${esc(s.label)}`).join(' · ');
    if (!errs.length && src) return `<p class="dim small">📒 Dispatch ledger: ${src}</p>`;
    return errs.length ? `<p class="dim small">⚠️ Dispatch ledger — ${src ? src + ' · ' : ''}${errs.map(([, v]) => esc(v)).join(' · ')}</p>` : '';
  }
  const rowsHtml = (show) => show.map((r) => `<tr class="bcc-${r.k}" data-bcc-i="${r._i}"><td class="bcc-cp"><button type="button" class="bcc-rowcopy" data-bcc-row title="Copy Barcode + Tag ID + Status">📋</button></td>${cells(r).map((v, i) => `<td${i === 0 || i === 1 ? ` class="mono bcc-cell" data-bcc-cell="${i === 0 ? 'bc' : 'tag'}" title="Click = copy"` : ''}>${i === 2 ? `<span class="badge ${STATUS[r.k].tone}">${esc(v)}</span>` : esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${HEAD.length + 1}" class="empty">Is filter me kuch nahi</td></tr>`;
  const noteHtml = (vis, show) => `${U.fmt(vis.length)} rows${vis.length > show.length ? ` · pehli ${U.fmt(show.length)} dikh rahi — sab ke liye Copy / Excel` : ''}`;
  function resultsHtml() {
    const rows = state.rows;
    if (!rows) return '';
    const cnt = (k) => rows.filter((r) => r.k === k).length;
    const chip = (k, label, n, tone) => `<button type="button" class="chip bcc-chip ${tone || ''}${state.filter === k ? ' on' : ''}" data-bcc-filter="${k}">${label} <b>${U.fmt(n)}</b></button>`;
    const vis = visible();
    const byAgent = new Map();
    rows.filter((r) => r.agent && (state.filter === 'all' || r.k === state.filter)).forEach((r) => { const o = byAgent.get(r.agent) || { tl: r.tl, iss: 0, st: 0 }; if (r.k === 'iss') o.iss++; else o.st++; byAgent.set(r.agent, o); });
    const agents = [...byAgent.entries()].sort((a, b) => (b[1].iss + b[1].st) - (a[1].iss + a[1].st));
    const show = vis.slice(0, 1500);
    const canX = FF.auth && FF.auth.can && FF.auth.can('export');
    return `<div class="bcc-chips">${chip('all', '🔢 Sab', rows.length, '')}${Object.entries(STATUS).map(([k, v]) => chip(k, v.label, cnt(k), v.tone)).join('')}</div>
      <div class="bcc-tools"><input class="input" data-bcc-q placeholder="🔎 Barcode / tag / agent / TL / VRN…" value="${esc(state.q)}">
        ${state.agent ? `<button type="button" class="chip on" data-bcc-agent="">🧑‍💼 ${esc(state.agent)} ✕</button>` : ''}
        <button type="button" class="btn small primary" data-bcc-copy="both" title="Barcode + Tag ID + Status (tab-separated — Sheets/Excel me seedha paste)">📋 Copy Barcode + Tag ID + Status (<span data-bcc-n>${U.fmt(vis.length)}</span>)</button><button type="button" class="btn small" data-bcc-copy="bc">📋 Barcodes</button><button type="button" class="btn small" data-bcc-copy="tag">📋 Tag IDs</button>
        ${canX ? `<button type="button" class="btn small" data-bcc-xlsx="vis">⬇ Excel (filtered <span data-bcc-n>${U.fmt(vis.length)}</span>)</button><button type="button" class="btn small" data-bcc-xlsx="all">⬇ Excel (sab)</button>` : ''}</div>
      ${agents.length ? `<details class="bcc-agents" ${agents.length <= 12 ? 'open' : ''}><summary><b>🧑‍💼 Agent-wise · ${U.fmt(agents.length)}</b> <span class="dim small">(naam par click = filter)</span></summary>
        <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Agent</th><th>TL</th><th class="num">📦 Stock</th><th class="num">✅ Issued</th><th class="num">Total</th></tr></thead><tbody>${agents.slice(0, 300).map(([k, o]) => `<tr class="clickable${state.agent === k ? ' on' : ''}" data-bcc-agent="${esc(k)}"><td><b>${esc(k)}</b></td><td>${esc(o.tl || '')}</td><td class="num">${U.fmt(o.st)}</td><td class="num">${U.fmt(o.iss)}</td><td class="num"><b>${U.fmt(o.st + o.iss)}</b></td></tr>`).join('')}</tbody></table></div></details>` : ''}
      ${dispNote()}
      <p class="dim small" data-bcc-note>${noteHtml(vis, show)}</p>
      <div class="table-wrap"><table class="tbl compact bcc-tbl"><thead><tr><th></th>${HEAD.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody data-bcc-tbody>${rowsHtml(show)}</tbody></table></div>`;
  }
  /** Sirf table body + counts dobara — search type karte waqt chips / agent table / input ko chhedta nahi (instant). */
  function paintTable() {
    const root = state.root, body = root && root.querySelector('[data-bcc-tbody]');
    if (!body) return paintResults();
    const vis = visible(), show = vis.slice(0, 1500);
    body.innerHTML = rowsHtml(show);
    const note = root.querySelector('[data-bcc-note]'); if (note) note.textContent = noteHtml(vis, show);
    root.querySelectorAll('[data-bcc-n]').forEach((n) => { n.textContent = U.fmt(vis.length); });
  }
  function paintResults() {
    const el = state.root && state.root.querySelector('[data-bcc-out]');
    if (el) el.innerHTML = resultsHtml();
  }
  // Same-sheet audit is on demand: it scans FF and GV separately and never flags a normal FF↔GV match.
  const dup = { source: '', data: null, q: '', limit: 300, seq: 0 };
  const dupRows = () => {
    const q = dup.q.trim().toLowerCase();
    return (dup.data?.groups || []).flatMap((g) => g.rows.map((r) => ({ ...r, key: g.key, count: g.count }))).filter((r) => !q || Object.values(r).some((v) => String(v).toLowerCase().includes(q)));
  };
  function dupPaint(root) {
    const el = root.querySelector('[data-dup-out]'); if (!el) return;
    if (!dup.data) { el.innerHTML = '<p class="dim small">Select FF or GV and run the scan.</p>'; return; }
    const rows = dupRows(), shown = rows.slice(0, dup.limit), d = dup.data;
    el.innerHTML = `<p class="small">${esc(d.sheet)} · ${U.fmt(d.duplicateBarcodes)} duplicate barcodes · ${U.fmt(d.duplicateRows)} rows · scanned ${U.fmt(d.scanned)} · ${esc(d.at)}</p>
      <div class="btn-row"><input class="input" data-dup-q placeholder="Search barcode / tag / agent / TL" value="${esc(dup.q)}">${FF.auth.can('export') ? '<button type="button" class="btn small" data-dup-csv>⬇ CSV (filtered)</button>' : ''}<span class="dim small">${U.fmt(rows.length)} matching rows</span></div>
      <div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Barcode</th><th>Occurrences</th><th>Tag ID</th><th>Class</th><th>Status</th><th>Agent</th><th>Agent ID</th><th>TL</th></tr></thead><tbody>${shown.map((r) => `<tr><td class="mono">${esc(r.barcode)}</td><td>${U.fmt(r.count)}</td><td class="mono">${esc(r.tagId)}</td><td>${esc(r.cls)}</td><td>${esc(r.status)}</td><td>${esc(r.agentName)}</td><td>${esc(r.agentId)}</td><td>${esc(r.tl)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No matching duplicate rows.</td></tr>'}</tbody></table></div>${rows.length > shown.length ? `<button type="button" class="btn small" data-dup-more>Show more (${U.fmt(rows.length - shown.length)} remaining)</button>` : ''}<p class="dim small">CSV contains the filtered rows. Import barcode columns as text in Excel to preserve long numbers and leading zeroes.</p>`;
  }
  async function dupScan(root, source) {
    const seq = ++dup.seq; dup.source = source; dup.data = null; dup.q = ''; dup.limit = 300;
    const out = root.querySelector('[data-dup-out]'); if (!out) return;
    out.innerHTML = U.spinner('Scanning sheet for duplicate barcodes…');
    try {
      let first = true, result; const started = Date.now();
      do {
        result = await FF.auth.api(`/api/duplicate-barcodes?source=${source}${first ? '&fresh=1' : ''}`); first = false;
        if (seq !== dup.seq || !root.isConnected) return;
        if (!result.pending) break;
        if (Date.now() - started > 5 * 60e3) throw new Error('Scan is still running. Please retry shortly.');
        await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Math.min(8000, Number(result.retryAfterMs) || 3000))));
      } while (true);
      dup.data = result; dupPaint(root);
    } catch (err) { if (seq === dup.seq && root.isConnected) out.innerHTML = U.errorBox(err); }
  }
  function dupCsv() {
    const safe = (v) => { const s = String(v ?? ''); return /^[\t\r\n ]*[=+@-]/.test(s) ? `'${s}` : s; };
    const quote = (v) => `"${safe(v).replace(/"/g, '""')}"`;
    const header = ['Barcode', 'Normalized barcode', 'Occurrences', 'Tag ID', 'Class', 'Status', 'Agent', 'Agent ID', 'TL'];
    const body = dupRows().map((r) => [r.barcode, r.key, r.count, r.tagId, r.cls, r.status, r.agentName, r.agentId, r.tl]);
    const csv = [header, ...body].map((r) => r.map(quote).join(',')).join('\r\n');
    U.downloadBlob(`duplicate-barcodes-${dup.source}-${U.stamp()}.csv`, new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  }

  function render(root, params) {
    state.root = root;
    const p = params || {};
    if (p.tab === 'multi') state.tab = 'multi';
    root.innerHTML = `<div class="page bcc-page">
      <div class="page-head"><div><h1>🔢 Barcode Checker</h1>
        <p class="sub">Barcode range or many barcodes → status of every tag: <b>✅ issued</b> (when, on which VRN) · <b>📦 in which agent's stock</b> · <b>🏢 master/BC</b> · <b>❓ missing</b>. Stock = StockDataa · Issued = EIR.</p></div></div>
      <div class="card"><div class="card-body">
        <div class="seg bcc-tabs"><button type="button" class="seg-btn${state.tab === 'range' ? ' on' : ''}" data-bcc-tab="range">↔️ Range (first → last)</button><button type="button" class="seg-btn${state.tab === 'multi' ? ' on' : ''}" data-bcc-tab="multi">📋 Multiple barcodes</button></div>
        <form class="bcc-form" data-bcc-form="range" ${state.tab === 'range' ? '' : 'hidden'}>
          <label class="field"><span class="dim small">First barcode</span><input class="input mono" name="first" value="${esc(p.first || '')}" placeholder="608116-011-0558283" autocomplete="off" inputmode="numeric"></label>
          <label class="field"><span class="dim small">Last barcode</span><input class="input mono" name="last" value="${esc(p.last || '')}" placeholder="608116-011-0558331" autocomplete="off" inputmode="numeric"></label>
          <label class="field"><span class="dim small">First barcode ka Tag ID <em>(optional)</em></span><input class="input mono" name="tag" placeholder="34161FA820328EE817109960" autocomplete="off"></label>
          <button class="btn primary" type="submit">🔎 Check</button>
        </form>
        <form class="bcc-form bcc-multi" data-bcc-form="multi" ${state.tab === 'multi' ? '' : 'hidden'}>
          <label class="field"><span class="dim small">Barcodes — ek line me ek (ya comma / space se alag) · Excel column copy-paste chalega</span>
            <textarea class="input mono" name="list" rows="6" placeholder="608116-011-0558283&#10;608116-011-0558290&#10;6081160110558301">${esc(p.list || '')}</textarea></label>
          <div class="btn-row"><button class="btn primary" type="submit">🔎 Check</button><span class="dim small" data-bcc-count></span></div>
        </form>
        <p class="dim small bcc-note">Max ${MAX.toLocaleString('en-IN')} barcodes ek baar me. Jo tag stock me nahi, uska Tag ID aas-paas ke stock tags se anumaan lagaya jaata hai (note me likha aata hai). Range ka koi bhi tag stock me na ho to first barcode ka Tag ID daal do.</p>
      </div></div>
      <div class="card"><div class="card-body" data-bcc-out>${state.rows ? resultsHtml() : '<div class="empty-state compact">👆 Barcode daalo — result yahan aayega</div>'}</div></div>
      <section class="card" style="margin-top:14px"><div class="card-head"><h3>🔁 Duplicate barcode checker</h3></div><div class="card-body"><p class="dim small">Checks repeated barcodes within each sheet separately: FF StockDataa or GV Tag Assignment (all statuses). A barcode appearing once in each sheet is normal and is not a duplicate. Formatting, leading zeroes and scientific notation are normalized.</p><div class="btn-row">${FF.auth.can('sheet:StockDataa') ? '<button class="btn small" data-dup-scan="ff">🔎 Scan FF</button>' : ''}${FF.auth.can('sheet:Tag Assignment') ? '<button class="btn small" data-dup-scan="gv">🔎 Scan GV</button>' : ''}</div><div data-dup-out></div></div></section>
    </div>`;
    dup.data = null; dup.seq++; dupPaint(root);
    bind(root);
    if (p.first && p.last) run('range');
  }
  async function run(kind) {
    const root = state.root; if (!root) return;
    const out = root.querySelector('[data-bcc-out]');
    const seq = ++state.busy;
    try {
      let rows, title, dispatchP = null;
      if (kind === 'range') {
        const f = root.querySelector('[data-bcc-form="range"]');
        const first = f.first.value.trim(), last = f.last.value.trim(), tag = f.tag.value.trim().toUpperCase();
        if (!first || !last) return;
        const key = `r|${first}|${last}|${tag}`;
        if (key === state.lastKey && state.rows) return;
        let list; try { list = expandRange(first, last); } catch (err) { out.innerHTML = `<div class="error-box">${esc(err.message)}</div>`; return; }
        out.innerHTML = U.spinner(`${U.fmt(list.length)} barcodes check ho rahe hain (stock + issuance)…`);
        dispatchP = FF.data.dispatchLookup(list.map((x) => x.label));   // ⚡ stock check ke saath-saath dispatch lookup shuru
        dispatchP.catch(() => {});
        rows = await checkRange(first, last, isHex(tag) ? tag : '');
        title = `${first}_${last}`; state.lastKey = key;
      } else {
        const f = root.querySelector('[data-bcc-form="multi"]');
        const list = parseMulti(f.list.value);
        if (!list.length) return;
        const key = `m|${list.join('|')}`;
        if (key === state.lastKey && state.rows) return;
        out.innerHTML = U.spinner(`${U.fmt(list.length)} barcodes check ho rahe hain…`);
        dispatchP = FF.data.dispatchLookup(list);
        dispatchP.catch(() => {});
        rows = await checkMulti(list);
        title = `${list.length}-barcodes`; state.lastKey = key;
      }
      if (seq !== state.busy) return;
      rows.forEach((r, i) => { r._i = i; });
      state.rows = rows; state.title = title; state.filter = 'all'; state.agent = ''; state.q = '';
      state.dispMeta = null;
      rows.forEach((r) => { r.dDate = SEARCHING; r.dName = SEARCHING; });
      paintResults();                       // ⚡ stock / issuance turant — dispatch date + naam peeche se bharte hain
      await attachDispatch(rows, dispatchP);
      if (seq === state.busy && state.rows === rows) paintResults();
    } catch (err) {
      if (seq === state.busy) out.innerHTML = U.errorBox(err);
    }
  }
  function bind(root) {
    let t = 0, qRaf = 0;
    const auto = (kind, ms) => { clearTimeout(t); t = setTimeout(() => run(kind), ms); };
    root.addEventListener('submit', (e) => { const f = e.target.closest('[data-bcc-form]'); if (!f) return; e.preventDefault(); state.lastKey = ''; run(f.dataset.bccForm); });
    root.addEventListener('input', (e) => {
      const f = e.target.closest('[data-bcc-form]');
      if (f && f.dataset.bccForm === 'range') {
        const a = bcDigits(f.first.value), b = bcDigits(f.last.value);
        if (a.length >= 8 && b.length >= 8 && a.length === b.length) auto('range', 500);   // dono barcode poore → turant
      }
      if (f && f.dataset.bccForm === 'multi') {
        const n = parseMulti(f.list.value).length;
        const c = root.querySelector('[data-bcc-count]'); if (c) c.textContent = n ? `${U.fmt(n)} barcodes` : '';
        if (e.inputType === 'insertFromPaste' && n) auto('multi', 300);
      }
      if (e.target.matches('[data-bcc-q]')) { state.q = e.target.value; if (!qRaf) qRaf = requestAnimationFrame(() => { qRaf = 0; paintTable(); }); }
      if (e.target.matches('[data-dup-q]')) { dup.q = e.target.value; dup.limit = 300; const pos = e.target.selectionStart; dupPaint(root); const next = root.querySelector('[data-dup-q]'); if (next) { next.focus(); next.setSelectionRange(pos, pos); } }
    });
    root.addEventListener('click', (e) => {
      const scan = e.target.closest('[data-dup-scan]');
      if (scan) { dupScan(root, scan.dataset.dupScan); return; }
      if (e.target.closest('[data-dup-more]')) { dup.limit += 300; dupPaint(root); return; }
      if (e.target.closest('[data-dup-csv]') && dup.data && FF.auth.can('export')) { dupCsv(); return; }
      const tab = e.target.closest('[data-bcc-tab]');
      if (tab) {
        state.tab = tab.dataset.bccTab;
        root.querySelectorAll('[data-bcc-tab]').forEach((b) => b.classList.toggle('on', b === tab));
        root.querySelectorAll('[data-bcc-form]').forEach((f) => { f.hidden = f.dataset.bccForm !== state.tab; });
        return;
      }
      const fl = e.target.closest('[data-bcc-filter]');
      if (fl) { state.filter = fl.dataset.bccFilter; paintResults(); return; }
      const ag = e.target.closest('[data-bcc-agent]');
      if (ag) { const a = ag.dataset.bccAgent; state.agent = state.agent === a ? '' : a; paintResults(); return; }
      const cp = e.target.closest('[data-bcc-copy]');
      if (cp && state.rows) { const rows = visible(); const m = cp.dataset.bccCopy; copyOut(copyText(rows, m), `${U.fmt(rows.length)} ${m === 'bc' ? 'barcodes' : m === 'tag' ? 'tag IDs' : 'rows (Barcode + Tag ID + Status)'}`); return; }
      const rowTr = e.target.closest('tr[data-bcc-i]');
      if (rowTr && state.rows) {
        const r = state.rows[+rowTr.dataset.bccI];
        const cell = e.target.closest('[data-bcc-cell]');
        if (r && cell) { copyOut(copyText([r], cell.dataset.bccCell), cell.dataset.bccCell === 'bc' ? r.barcode : (r.tagId || 'Tag ID')); return; }
        if (r && e.target.closest('[data-bcc-row]')) { copyOut(copyText([r], 'both'), 'Barcode + Tag ID + Status'); return; }
      }
      const x = e.target.closest('[data-bcc-xlsx]');
      if (x && state.rows) {
        const rows = x.dataset.bccXlsx === 'all' ? state.rows : visible();
        const sum = Object.entries(STATUS).map(([k, v]) => [v.label, rows.filter((r) => r.k === k).length]);
        FF.xlsx.download(`barcode-check-${U.slug(state.title)}-${U.stamp()}.xlsx`, [{ name: 'Barcodes', header: HEAD, rows: rows.map(cells) }, { name: 'Summary', header: ['Status', 'Count'], rows: sum }]);
      }
    });
  }

  FF.barcodeChecker = { expandRange, tagInfer, parseMulti, makeRow, paintResults, visible, copyText, _state: state };
  FF.pages.barcodeChecker = { title: 'Barcode Checker', render };
})(window.FF);
