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
  const EIR_CACHE = new Map();   // ⚡ v424 — tag → EIR row (dobara check instant)
  async function eirByTags(tagsAll) {
    const e = FF.config.eir, D = FF.data;
    const out = new Map();
    const tags = [];
    tagsAll.forEach((t) => { if (EIR_CACHE.has(t)) { const v = EIR_CACHE.get(t); if (v) out.set(t, v); } else tags.push(t); });
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
    tags.forEach((t) => { EIR_CACHE.set(t, out.get(t) || null); });
    if (EIR_CACHE.size > 20000) EIR_CACHE.clear();
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
    if (st) {
      const gvA = st.gvAgent || '', mapIn = st.mapIn || '';
      const ffMapped = !!st.agent, gvMapped = mapIn === 'gv' || mapIn === 'both';
      const where = !mapIn ? '' : mapIn === 'both' ? 'FF + GV dono me map' : mapIn === 'ff' ? 'FF StockDataa me map · GV Tag Assignment me nahi' : mapIn === 'gv' ? `GV Tag Assignment me map${gvA ? ' (' + gvA + (st.gvAgentId ? ' · ' + st.gvAgentId : '') + ')' : ''} · FF me agent nahi` : 'Na FF me agent, na GV Tag Assignment me map (office stock)';
      return { barcode: label, k: ffMapped || gvMapped ? 'st' : 'bc', tagId: tag, cls: st.cls, agent: st.agent || (gvMapped ? gvA : '') || st.inventory || '', agentId: st.agentId || (gvMapped ? st.gvAgentId || '' : ''), tl: st.tl || (gvMapped ? st.gvTl || '' : ''), date: st.agentAt || st.bcAt || '', vrn: '', note: where || (ffMapped ? '' : 'Agent ko allocate nahi') };
    }
    return { barcode: label, k: 'nf', tagId: tag, cls: '', agent: '', agentId: '', tl: '', date: '', vrn: '', note: tag ? 'Na stock me, na EIR me (tag ID anumaanit)' : 'Stock me nahi mila · tag ID ka andaza nahi laga' };
  }

  // ---- 🔎 checks --------------------------------------------------------------------------------------
  async function checkRange(first, last, firstTag, early) {
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
    const build = (eir) => list.map((b) => { const t = tagOf.get(b.key) || ''; return makeRow(b.label, byKey.get(b.key), t, inferred.has(b.key), t ? eir.get(t) : null); });
    if (early && tagOf.size) early(build(new Map()));   // ⚡ stock turant dikhao, EIR (issued) peeche se
    const eir = tagOf.size ? await eirByTags([...new Set(tagOf.values())]) : new Map();
    return build(eir);
  }
  /** v3.125.42 — List me "A to B" / "A se B" / "A - B" / "A → B" = range: first se last tak saare barcodes.
   *  Faltu shabd (VC6, to, se…) chhod do — sirf barcode (6+ digit) ya tag ID (hex) ginte hain. */
  const RANGE_RE = /(\d[\d-]{5,}\d)\s*(?:to|se|till|tak|→|->|=>|~|–|—|\s-\s)\s*(\d[\d-]{5,}\d)/gi;
  function parseMulti(text) {
    const seen = new Set(), out = [], errors = [];
    const push = (x) => {
      const k = strip0(bcDigits(x)) || x.toUpperCase();
      if (seen.has(k)) return; seen.add(k); out.push(x);
    };
    const ranges = [];
    const rest = String(text || '').replace(RANGE_RE, (m, a, b) => { ranges.push([a, b]); return ` \u0000${ranges.length - 1}\u0000 `; });
    rest.split(/[\n,;\t ]+/).map((x) => x.trim()).filter(Boolean).forEach((x) => {
      const rm = /^\u0000(\d+)\u0000$/.exec(x);
      if (rm) {
        const [a, b] = ranges[Number(rm[1])];
        try {
          const [lo, hi] = BigInt(bcDigits(a)) <= BigInt(bcDigits(b)) ? [a, b] : [b, a];
          expandRange(lo, hi).forEach((r) => push(r.label));
        } catch (err) { errors.push(`${a} to ${b}: ${err.message}`); }
        return;
      }
      if (bcDigits(x).length >= 6 || (isHex(x) && x.length >= 12 && /[a-f]/i.test(x))) push(x);
    });
    out.errors = errors;
    return out;
  }
  async function checkMulti(list, early) {
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
    const build = (eir) => items.map((x) => makeRow(x.label, x.st, x.tag, x.inf, x.tag ? eir.get(x.tag) : null));
    if (early && items.some((x) => x.tag)) early(build(new Map()));   // ⚡ stock turant, EIR peeche se
    const eir = await eirByTags([...new Set(items.map((x) => x.tag).filter(Boolean))]);
    return build(eir);
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
  const rowsHtml = (show) => show.map((r) => `<tr class="bcc-${r.k}${r._new && Date.now() - r._new < 1600 ? ' bcc-new' : ''}${r._dup && Date.now() - r._dup < 1600 ? ' bcc-dupflash' : ''}" data-bcc-i="${r._i}"><td class="bcc-cp"><button type="button" class="bcc-rowcopy" data-bcc-row title="Copy Barcode + Tag ID + Status">📋</button></td>${cells(r).map((v, i) => `<td${i === 0 || i === 1 ? ` class="mono bcc-cell" data-bcc-cell="${i === 0 ? 'bc' : 'tag'}" title="Click = copy"` : ''}>${i === 2 ? `<span class="badge ${STATUS[r.k].tone}">${esc(v)}</span>` : esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${HEAD.length + 1}" class="empty">Is filter me kuch nahi</td></tr>`;
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
        <div class="seg bcc-tabs"><button type="button" class="seg-btn${state.tab === 'range' ? ' on' : ''}" data-bcc-tab="range">↔️ Range (first → last)</button><button type="button" class="seg-btn${state.tab === 'multi' ? ' on' : ''}" data-bcc-tab="multi">📋 Multiple barcodes</button><button type="button" class="seg-btn${state.tab === 'scan' ? ' on' : ''}" data-bcc-tab="scan">📷 Scan</button></div>
        <form class="bcc-form" data-bcc-form="range" ${state.tab === 'range' ? '' : 'hidden'}>
          <label class="field"><span class="dim small">First barcode</span><input class="input mono" name="first" value="${esc(p.first || '')}" placeholder="608116-011-0558283" autocomplete="off" inputmode="numeric"></label>
          <label class="field"><span class="dim small">Last barcode</span><input class="input mono" name="last" value="${esc(p.last || '')}" placeholder="608116-011-0558331" autocomplete="off" inputmode="numeric"></label>
          <label class="field"><span class="dim small">First barcode ka Tag ID <em>(optional)</em></span><input class="input mono" name="tag" placeholder="34161FA820328EE817109960" autocomplete="off"></label>
          <button class="btn primary" type="submit">🔎 Check</button>
        </form>
        <form class="bcc-form bcc-multi" data-bcc-form="multi" ${state.tab === 'multi' ? '' : 'hidden'}>
          <label class="field"><span class="dim small">Barcodes — ek line me ek (ya comma / space se alag) · range: A to B / A se B · Excel column copy-paste chalega</span>
            <textarea class="input mono" name="list" rows="6" placeholder="608116-011-0558283&#10;608116-011-0558290&#10;6081160110558301">${esc(p.list || '')}</textarea></label>
          <div class="btn-row"><button class="btn primary" type="submit">🔎 Check</button><span class="dim small" data-bcc-count></span></div>
        </form>
        <div class="bcc-scan" data-bcc-form="scan" ${state.tab === 'scan' ? '' : 'hidden'}>
          <div class="bcc-scan-bar">
            <button type="button" class="btn primary" data-scan="cam">📷 Camera scan shuru</button>
            <button type="button" class="btn small" data-scan="torch" hidden>🔦 Torch</button>
            <button type="button" class="btn small" data-scan="sound" title="Beep ON/OFF">🔊</button>
            <button type="button" class="btn small" data-scan="clear">🗑 List saaf</button>
            <span class="bcc-scan-count" data-scan-count></span>
          </div>
          <div class="bcc-cam" data-scan-cam hidden><video playsinline muted></video><div class="bcc-cam-aim"></div><div class="bcc-cam-msg" data-scan-msg></div></div>
          <label class="field"><span class="dim small">Scanner gun / bluetooth scanner / haath se — barcode daalo + Enter (ek ke baad ek, list banti jayegi)</span>
            <input class="input mono" data-scan-in placeholder="⌨️ Yahan scan karo ya barcode type karke Enter…" autocomplete="off" inputmode="text"></label>
        </div>
        <p class="dim small bcc-note">Max ${MAX.toLocaleString('en-IN')} barcodes ek baar me. Jo tag stock me nahi, uska Tag ID aas-paas ke stock tags se anumaan lagaya jaata hai (note me likha aata hai). Range ka koi bhi tag stock me na ho to first barcode ka Tag ID daal do.</p>
      </div></div>
      <div class="card"><div class="card-body" data-bcc-out>${state.rows ? resultsHtml() : '<div class="empty-state compact">👆 Barcode daalo — result yahan aayega</div>'}</div></div>
      <section class="card" style="margin-top:14px"><div class="card-head"><h3>🔁 Duplicate barcode checker</h3></div><div class="card-body"><p class="dim small">Checks repeated barcodes within each sheet separately: FF StockDataa or GV Tag Assignment (all statuses). A barcode appearing once in each sheet is normal and is not a duplicate. Formatting, leading zeroes and scientific notation are normalized.</p><div class="btn-row">${FF.auth.can('sheet:StockDataa') ? '<button class="btn small" data-dup-scan="ff">🔎 Scan FF</button>' : ''}${FF.auth.can('sheet:Tag Assignment') ? '<button class="btn small" data-dup-scan="gv">🔎 Scan GV</button>' : ''}</div><div data-dup-out></div></div></section>
    </div>`;
    dup.data = null; dup.seq++; dupPaint(root);
    camStop();
    bind(root);
    scanInit(root);
    if (p.first && p.last) run('range');
  }
  async function run(kind) {
    const root = state.root; if (!root) return;
    const out = root.querySelector('[data-bcc-out]');
    const seq = ++state.busy;
    try {
      let rows, title, dispatchP = null;
      const earlyPaint = (er) => {
        if (seq !== state.busy) return;
        er.forEach((r, i) => { r._i = i; r.dDate = r.dName = SEARCHING; });
        state.rows = er; state.filter = 'all'; state.agent = ''; state.q = ''; state.dispMeta = null;
        paintResults();
      };
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
        rows = await checkRange(first, last, isHex(tag) ? tag : '', earlyPaint);
        title = `${first}_${last}`; state.lastKey = key;
      } else {
        const f = root.querySelector('[data-bcc-form="multi"]');
        const list = parseMulti(f.list.value);
        if (list.errors.length) throw new Error(list.errors.join(' · '));
        if (!list.length) return;
        const key = `m|${list.join('|')}`;
        if (key === state.lastKey && state.rows) return;
        out.innerHTML = U.spinner(`${U.fmt(list.length)} barcodes check ho rahe hain…`);
        dispatchP = FF.data.dispatchLookup(list);
        dispatchP.catch(() => {});
        rows = await checkMulti(list, earlyPaint);
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
        const pl = parseMulti(f.list.value), n = pl.length;
        const c = root.querySelector('[data-bcc-count]'); if (c) c.textContent = (n ? `${U.fmt(n)} barcodes` : '') + (pl.errors.length ? ` · ⚠️ ${pl.errors[0]}` : '');
        if (e.inputType === 'insertFromPaste' && n) auto('multi', 300);
      }
      if (e.target.matches('[data-bcc-q]')) { state.q = e.target.value; if (!qRaf) qRaf = requestAnimationFrame(() => { qRaf = 0; paintTable(); }); }
      if (e.target.matches('[data-dup-q]')) { dup.q = e.target.value; dup.limit = 300; const pos = e.target.selectionStart; dupPaint(root); const next = root.querySelector('[data-dup-q]'); if (next) { next.focus(); next.setSelectionRange(pos, pos); } }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-scan-in]')) { e.preventDefault(); const v = e.target.value; e.target.value = ''; scanText(v); }
    });
    root.addEventListener('paste', (e) => {
      if (!e.target.matches('[data-scan-in]')) return;
      const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
      if (/[\n,;\s]/.test(t.trim())) { e.preventDefault(); scanText(t); }
    });
    root.addEventListener('click', (e) => {
      const sb = e.target.closest('[data-scan]');
      if (sb) { const a = sb.dataset.scan; if (a === 'cam') (scanCam.on ? camStop() : camStart()); else if (a === 'clear') scanClear(); else if (a === 'sound') { scan.sound = !scan.sound; sb.textContent = scan.sound ? '🔊' : '🔇'; try { localStorage.setItem('ff_bcc_scan_snd', scan.sound ? '1' : '0'); } catch { /* optional */ } } else if (a === 'torch') camTorch(); return; }
      const scan0 = e.target.closest('[data-dup-scan]');
      if (scan0) { dupScan(root, scan0.dataset.dupScan); return; }
      if (e.target.closest('[data-dup-more]')) { dup.limit += 300; dupPaint(root); return; }
      if (e.target.closest('[data-dup-csv]') && dup.data && FF.auth.can('export')) { dupCsv(); return; }
      const tab = e.target.closest('[data-bcc-tab]');
      if (tab) {
        state.tab = tab.dataset.bccTab;
        root.querySelectorAll('[data-bcc-tab]').forEach((b) => b.classList.toggle('on', b === tab));
        root.querySelectorAll('[data-bcc-form]').forEach((f) => { f.hidden = f.dataset.bccForm !== state.tab; });
        if (state.tab !== 'scan') camStop(); else scanEnter();
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


  // ---- 📷 Scan (v3.125.436) — camera + scanner-gun: har scan turant list me, status peeche se bharta hai ------------------
  // Camera: browser ka BarcodeDetector (phone / Chrome — fast, native); na ho to ZXing (vendor/zxing.min.js, sirf zarurat par load).
  // List localStorage me (ff_bcc_scan) — reload / app band hone par bhi bachi rehti hai.
  const SCAN_KEY = 'ff_bcc_scan';
  const scan = { order: [], map: new Map(), queue: [], t: 0, paintRaf: 0, saveT: 0, sound: true, last: { k: '', at: 0 }, ctx: null };
  const scanCam = { on: false, stream: null, raf: 0, timer: 0, det: null, reader: null, busy: false, torch: false };
  const scanKey = (c) => strip0(bcDigits(c)) || String(c || '').toUpperCase();
  const pendingRow = (label) => { const r = makeRow(label, null, '', false, null); r.note = '⏳ check ho raha hai…'; r.dDate = r.dName = ''; r._new = Date.now(); return r; };
  function scanBeep(kind) {
    try { if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 35 : [30, 40, 30]); } catch { /* optional */ }
    if (!scan.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      scan.ctx = scan.ctx || new AC(); const c = scan.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = kind === 'ok' ? 1040 : 380; g.gain.value = 0.06; o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + (kind === 'ok' ? 0.07 : 0.16));
    } catch { /* optional */ }
  }
  function scanSave() {
    clearTimeout(scan.saveT);
    scan.saveT = setTimeout(() => { try { if (scan.order.length) localStorage.setItem(SCAN_KEY, JSON.stringify(scan.order.slice(-MAX).map((k) => scan.map.get(k).barcode))); else localStorage.removeItem(SCAN_KEY); } catch { /* optional */ } }, 300);
  }
  function scanCount() {
    const el = state.root && state.root.querySelector('[data-scan-count]'); if (!el) return;
    const rows = scan.order.map((k) => scan.map.get(k)), c = (k) => rows.filter((r) => r.k === k).length;
    el.innerHTML = rows.length ? `<b>${U.fmt(rows.length)}</b> scan · ✅ ${U.fmt(c('iss'))} · 📦 ${U.fmt(c('st'))} · 🏢 ${U.fmt(c('bc'))} · ❓ ${U.fmt(c('nf'))}` : '<span class="dim">Abhi koi scan nahi</span>';
  }
  function scanPaint() {
    if (scan.paintRaf) return;
    scan.paintRaf = requestAnimationFrame(() => {
      scan.paintRaf = 0;
      if (state.tab !== 'scan' || !state.root) return;
      const rows = scan.order.slice().reverse().map((k) => scan.map.get(k));
      rows.forEach((r, i) => { r._i = i; });
      state.rows = rows.length ? rows : null; state.title = 'scanned-list'; state.lastKey = 'scan'; state.dispMeta = state.dispMeta || null;
      if (rows.length) { if (state.q || state.agent || state.filter !== 'all') paintTable(); else paintResults(); }
      else { const out = state.root.querySelector('[data-bcc-out]'); if (out) out.innerHTML = '<div class="empty-state compact">📷 Scan karo — har barcode yahan jodta jayega</div>'; }
      scanCount();
    });
  }
  function scanAdd(code) {
    const k = scanKey(code), ex = scan.map.get(k);
    if (ex) { ex._dup = Date.now(); scanBeep('dup'); scanPaint(); return false; }
    scan.order.push(k); scan.map.set(k, pendingRow(code)); scan.queue.push(code);
    scanBeep('ok'); scanSave(); scanPaint();
    if (!scan.t) scan.t = setTimeout(scanFlush, 220);
    return true;
  }
  /** Text (scanner gun / paste) → barcodes → list. */
  function scanText(text) {
    const list = parseMulti(text); let n = 0, d = 0;
    list.forEach((c) => { if (scanAdd(c)) n++; else d++; });
    if (!list.length && String(text || '').trim() && U.toast) U.toast('Ye barcode jaisa nahi laga', 'warn');
    return { n, d };
  }
  async function scanFlush() {
    scan.t = 0;
    const batch = scan.queue.splice(0); if (!batch.length) return;
    const put = (rows, fresh) => rows.forEach((r) => { const k = scanKey(r.barcode), old = scan.map.get(k); if (!old) return; if (!r.dDate) { r.dDate = old.dDate || ''; r.dName = old.dName || ''; } r._new = old._new; scan.map.set(k, r); });
    const dp = FF.data.dispatchLookup(batch); dp.catch(() => {});
    try {
      const rows = await checkMulti(batch, (early) => { early.forEach((r) => { r.dDate = r.dName = SEARCHING; }); put(early); scanPaint(); });
      rows.forEach((r) => { const o = scan.map.get(scanKey(r.barcode)); r.dDate = (o && o.dDate) || SEARCHING; r.dName = (o && o.dName) || SEARCHING; });
      put(rows); scanPaint();
      await attachDispatch(rows, dp); scanPaint();
    } catch (err) {
      batch.forEach((c) => { const o = scan.map.get(scanKey(c)); if (o) { o.note = '⚠️ check nahi hua: ' + String((err && err.message) || err).slice(0, 80); o.k = 'nf'; } });
      scanPaint();
    }
  }
  function scanClear() {
    if (scan.order.length > 3 && !window.confirm(`${scan.order.length} scanned barcodes ki list saaf karni hai?`)) return;
    scan.order = []; scan.map.clear(); scan.queue = []; state.rows = null; try { localStorage.removeItem(SCAN_KEY); } catch { /* optional */ }
    scanPaint(); scanCount();
  }
  function scanEnter() {
    scanPaint(); scanCount();
    const inp = state.root && state.root.querySelector('[data-scan-in]');
    if (inp && !(window.matchMedia && matchMedia('(pointer:coarse)').matches)) inp.focus();
  }
  function scanInit(root) {
    try { scan.sound = localStorage.getItem('ff_bcc_scan_snd') !== '0'; } catch { /* optional */ }
    const sb = root.querySelector('[data-scan="sound"]'); if (sb) sb.textContent = scan.sound ? '🔊' : '🔇';
    if (!scan.order.length) {
      let saved = []; try { saved = JSON.parse(localStorage.getItem(SCAN_KEY) || '[]'); } catch { /* optional */ }
      (Array.isArray(saved) ? saved : []).slice(-MAX).forEach((c) => { const k = scanKey(c); if (!scan.map.has(k)) { scan.order.push(k); scan.map.set(k, pendingRow(String(c))); scan.queue.push(String(c)); } });
      if (scan.queue.length && !scan.t) scan.t = setTimeout(scanFlush, 300);
    }
    scanCount();
    if (state.tab === 'scan') scanEnter();
  }
  // ---- 📷 camera --------------------------------------------------------------------------------------
  const camMsg = (t) => { const m = state.root && state.root.querySelector('[data-scan-msg]'); if (m) m.textContent = t || ''; };
  function camBtn(on) {
    const b = state.root && state.root.querySelector('[data-scan="cam"]'); if (b) { b.textContent = on ? '⏹ Camera band karo' : '📷 Camera scan shuru'; b.classList.toggle('danger', !!on); }
    const box = state.root && state.root.querySelector('[data-scan-cam]'); if (box) box.hidden = !on;
    const tb = state.root && state.root.querySelector('[data-scan="torch"]'); if (tb && !on) tb.hidden = true;
  }
  function loadZxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/zxing.min.js?v=1'; s.onload = () => (window.ZXing ? ok(window.ZXing) : no(new Error('ZXing load nahi hua'))); s.onerror = () => no(new Error('Scanner library load nahi hui')); document.head.appendChild(s); });
  }
  function camOnRaw(raw) {
    const list = parseMulti(String(raw || '')); if (!list.length) return;
    const c = list[0], k = scanKey(c), now = Date.now();
    if (scan.last.k === k && now - scan.last.at < 1800) { scan.last.at = now; return; }   // same barcode camera ke saamne — baar-baar nahi
    scan.last = { k, at: now };
    scanAdd(c);
  }
  async function camStart() {
    if (scanCam.on) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { U.toast && U.toast('Is browser / app me camera available nahi (HTTPS + permission chahiye)', 'error'); return; }
    const video = state.root && state.root.querySelector('.bcc-cam video'); if (!video) return;
    camBtn(true); camMsg('Camera khul raha hai…');
    try {
      scanCam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (err) { camBtn(false); camMsg(''); const nm = err && err.name; U.toast && U.toast(nm === 'NotAllowedError' ? 'Camera allow nahi hua — address bar ke 🔒 / camera icon se Allow karke dobara dabao' : nm === 'NotFoundError' ? 'Camera nahi mila is device me' : nm === 'NotReadableError' ? 'Camera doosri app me use ho raha hai — band karke dobara try karo' : 'Camera start nahi hua (' + (nm || 'error') + ')', 'error'); return; }
    scanCam.on = true;
    video.srcObject = scanCam.stream; try { await video.play(); } catch { /* autoplay */ }
    try { const tr = scanCam.stream.getVideoTracks()[0]; const caps = tr && tr.getCapabilities ? tr.getCapabilities() : {}; const tb = state.root.querySelector('[data-scan="torch"]'); if (tb) tb.hidden = !caps.torch; } catch { /* optional */ }
    camMsg('Barcode ko frame ke beech me rakho');
    let useNative = false;
    if ('BarcodeDetector' in window) {
      try {
        const want = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'codabar', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'];
        const sup = await window.BarcodeDetector.getSupportedFormats();
        const fm = want.filter((f) => sup.includes(f));
        if (fm.length >= 3) { scanCam.det = new window.BarcodeDetector({ formats: fm }); useNative = true; }
      } catch { /* ZXing fallback */ }
    }
    if (useNative) {
      const tick = async () => {
        if (!scanCam.on) return;
        if (!scanCam.busy && video.readyState >= 2 && !document.hidden) {
          scanCam.busy = true;
          try { const found = await scanCam.det.detect(video); found.forEach((f) => camOnRaw(f.rawValue)); } catch { /* frame skip */ }
          scanCam.busy = false;
        }
        scanCam.timer = setTimeout(() => { scanCam.raf = requestAnimationFrame(tick); }, 70);
      };
      tick();
    } else {
      try {
        const Z = await loadZxing();
        const hints = new Map(); hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.CODABAR]); hints.set(Z.DecodeHintType.TRY_HARDER, true);
        scanCam.reader = new Z.BrowserMultiFormatReader(hints, 120);
        scanCam.reader.decodeFromStream(scanCam.stream, video, (res) => { if (res && scanCam.on) camOnRaw(res.getText()); });
      } catch (err) { camStop(); U.toast && U.toast('Scanner start nahi hua: ' + String((err && err.message) || err), 'error'); }
    }
  }
  function camStop() {
    const was = scanCam.on || scanCam.stream;
    scanCam.on = false; cancelAnimationFrame(scanCam.raf); clearTimeout(scanCam.timer);
    try { if (scanCam.reader) scanCam.reader.reset(); } catch { /* optional */ }
    scanCam.reader = null; scanCam.det = null;
    try { if (scanCam.stream) scanCam.stream.getTracks().forEach((t) => t.stop()); } catch { /* optional */ }
    scanCam.stream = null; scanCam.torch = false;
    if (was) camBtn(false); camMsg('');
  }
  async function camTorch() {
    try { const tr = scanCam.stream && scanCam.stream.getVideoTracks()[0]; if (!tr) return; scanCam.torch = !scanCam.torch; await tr.applyConstraints({ advanced: [{ torch: scanCam.torch }] }); } catch { U.toast && U.toast('Torch is device par nahi chala', 'warn'); }
  }
  try {
    window.addEventListener('hashchange', () => { if (!/barcodeChecker/i.test(location.hash)) camStop(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) camStop(); });
    window.addEventListener('pagehide', camStop);
  } catch { /* test / non-browser sandbox */ }
  FF.barcodeChecker = { expandRange, tagInfer, parseMulti, makeRow, paintResults, visible, copyText, checkRange, scanAdd, scanText, scanKey, _scan: scan, _state: state };
  FF.pages.barcodeChecker = { title: 'Barcode Checker', render };
})(window.FF);
