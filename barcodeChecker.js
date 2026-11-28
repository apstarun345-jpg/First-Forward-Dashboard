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
  /** ⚡ v3.125.535 — Issued (EIR) check: server se (cache + Google busy handle); kabhi throw nahi karta. Fail ho to {pending} wapas — rows phir bhi dikhte hain, peeche se dobara try. */
  async function eirSafe(tags) {
    const map = new Map(), pending = [];
    for (let i = 0; i < tags.length; i += 600) {
      const part = tags.slice(i, i + 600);
      try {
        const j = await FF.auth.api('/api/barcode-eir', 'POST', { tags: part });
        Object.entries((j && j.eir) || {}).forEach(([t, v]) => map.set(t, { date: v.date || '', vrn: v.vrn || '', cls: v.cls || '', agent: v.agent || '', agentId: v.agentId || '', tl: v.tl || '', status: v.status || '', type: v.type || '', ch: v.ch === 'GV' ? 'GV Partner' : 'First Forward' }));
        ((j && j.pending) || []).forEach((t) => pending.push(t));
      } catch (e1) {
        try { (await eirByTags(part)).forEach((v, k) => map.set(k, v)); } catch (e2) { pending.push(...part); }
      }
    }
    return { map, pending };
  }
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
  const HEAD = ['Barcode', 'Tag ID', 'Status', 'Class', 'Agent', 'Agent ID', 'TL', '🏢 Office stock', 'Allocated / Issue date', 'VRN', 'Note', 'Dispatch date', 'Dispatched to'];
  const cells = (r) => [r.barcode, r.tagId, STATUS[r.k].label, r.cls, r.agent, r.agentId, r.tl, r.office || '', r.date, r.vrn, r.note, r.dDate || '', r.dName || ''];
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
      return { barcode: label, k: ffMapped || gvMapped ? 'st' : 'bc', tagId: tag, cls: st.cls, agent: st.agent || (gvMapped ? gvA : '') || '', office: ffMapped || gvMapped ? '' : (st.inventory || 'Office stock'), agentId: st.agentId || (gvMapped ? st.gvAgentId || '' : ''), tl: st.tl || (gvMapped ? st.gvTl || '' : ''), date: st.agentAt || st.bcAt || '', vrn: '', note: where || (ffMapped ? '' : 'Agent ko allocate nahi') };
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
    const eir = tagOf.size ? (await eirSafe([...new Set(tagOf.values())])).map : new Map();
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
  /** pending EIR tags ko peeche se dobara try (3 s, 6 s, 10 s, 15 s) — mil jaye to row badal kar dobara paint */
  function eirRetry(rows, pend, n) {
    if (n >= 4 || !pend.length) return;
    setTimeout(async () => {
      const fe = await eirSafe(pend);
      let changed = false;
      rows.forEach((r) => { const x = r._x; if (!x || !x.tag || !r.eirPending) return; const is = fe.map.get(x.tag); if (!fe.pending.includes(x.tag)) { const keep = { _i: r._i, dDate: r.dDate, dName: r.dName, _x: x }; Object.keys(r).forEach((k) => delete r[k]); Object.assign(r, makeRow(x.label, x.st, x.tag, x.inf, is || null), keep); changed = true; } });
      if (changed && state.root && state.rows && rows.some((r) => state.rows.includes(r))) { try { paintResults(); } catch { /* */ } }
      if (fe.pending.length) eirRetry(rows, fe.pending, n + 1);
    }, [3000, 3000, 4000, 5000][n] || 5000);
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
    // ⚡ v3.125.532 — raat ka Issued register (server) pehle: issued turant; live EIR sirf register me na milne waale tags ke liye, peeche se
    const regEir = new Map();
    (res.results || []).forEach((r, i) => { const g = r.reg, x = items[i]; if (g && x && x.tag) regEir.set(x.tag, { date: g.d || '', vrn: g.v || '', cls: g.c || '', agent: g.a || '', agentId: g.ai || '', tl: g.tl || '', status: '', type: '', ch: g.s === 'gv' ? 'GV Partner' : 'First Forward' }); });
    const build = (eir) => items.map((x) => { const r = makeRow(x.label, x.st, x.tag, x.inf, x.tag ? eir.get(x.tag) : null); r._x = x; return r; });
    if (early && items.some((x) => x.tag)) early(build(regEir));   // ⚡ stock + register turant, live EIR peeche se
    const need = [...new Set(items.map((x) => x.tag).filter((tg) => tg && !regEir.has(tg)))];
    const fe = need.length ? await eirSafe(need) : { map: new Map(), pending: [] };
    const eir = fe.map;
    regEir.forEach((v, k) => { if (!eir.has(k)) eir.set(k, v); });
    const rows = build(eir);
    if (fe.pending.length) { const pset = new Set(fe.pending); rows.forEach((r) => { if (r._x && r._x.tag && pset.has(r._x.tag) && r.k !== 'iss') { r.eirPending = true; r.note = (r.note || '') + ' · ⏳ Issued-check baaki (apne aap dobara try hoga)'; } }); eirRetry(rows, fe.pending, 0); }
    return rows;
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
  const rowsHtml = (show) => show.map((r) => `<tr class="bcc-${r.k}${r._new && Date.now() - r._new < 1600 ? ' bcc-new' : ''}${r._dup && Date.now() - r._dup < 1600 ? ' bcc-dupflash' : ''}" data-bcc-i="${r._i}"><td class="bcc-cp"><button type="button" class="bcc-rowcopy" data-bcc-row title="Copy Barcode + Tag ID + Status">📋</button></td>${cells(r).map((v, i) => `<td class="bcc-c${i}${i === 0 || i === 1 ? ' mono bcc-cell' : ''}"${i === 0 || i === 1 ? ` data-bcc-cell="${i === 0 ? 'bc' : 'tag'}" title="Click = copy"` : ''}>${i === 2 ? (r.pending ? '<span class="wow-sk"></span>' : `<span class="badge ${STATUS[r.k].tone}">${esc(v)}</span>`) : (r.pending && i > 2 && i < 11 ? '<span class="wow-sk" style="width:48px"></span>' : (i === 7 && v ? `<span class="bcc-office">🏢 ${esc(v)}</span>` : (i === 3 && v ? `<span class="bcc-cls cls-${esc(String(v).toLowerCase().replace(/[^a-z0-9]/g, ''))}">${esc(v)}</span>` : esc(v))))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${HEAD.length + 1}" class="empty">Is filter me kuch nahi</td></tr>`;
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
        <button type="button" class="btn small" data-bcc-copy="bc" title="Sirf barcode numbers">📋 Barcodes</button><button type="button" class="btn small" data-bcc-copy="tag" title="Sirf Tag IDs">📋 Tag IDs</button><button type="button" class="btn small" data-bcc-csv="vis" title="CSV download">⬇ CSV</button>
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
    if (p.tab === 'multi') state.tab = 'multi'; else if (p.tab === 'emp') state.tab = 'emp';
    root.innerHTML = `<div class="page bcc-page">
      <div class="page-head"><div><h1>🔢 Barcode Checker</h1>
        <p class="sub">Barcode range or many barcodes → status of every tag: <b>✅ issued</b> (when, on which VRN) · <b>📦 in which agent's stock</b> · <b>🏢 master/BC</b> · <b>❓ missing</b>. Stock = StockDataa · Issued = EIR.</p></div></div>
      <div class="card"><div class="card-body">
        <div class="seg bcc-tabs"><button type="button" class="seg-btn${state.tab === 'range' ? ' on' : ''}" data-bcc-tab="range">↔️ Range (first → last)</button><button type="button" class="seg-btn${state.tab === 'multi' ? ' on' : ''}" data-bcc-tab="multi">📋 Multiple barcodes</button><button type="button" class="seg-btn${state.tab === 'photo' ? ' on' : ''}" data-bcc-tab="photo">🖼️ Photo upload</button><button type="button" class="seg-btn${state.tab === 'scan' ? ' on' : ''}" data-bcc-tab="scan">📷 Scan</button><button type="button" class="seg-btn${state.tab === 'emp' ? ' on' : ''}" data-bcc-tab="emp">👥 Employee scans <span class="badge" data-emp-badge hidden></span></button></div>
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
        <div class="bcc-photo" data-bcc-form="photo" ${state.tab === 'photo' ? '' : 'hidden'}>
          <div class="btn-row"><button type="button" class="btn primary" data-ph="pick">🖼️ Photos chuno (kai ek saath)</button><button type="button" class="btn small" data-ph="clear">🗑 Saaf</button><span class="dim small" data-ph-note>Photo yahan drag-drop karo ya Ctrl+V paste karo — ek photo ke saare barcode nikalenge</span><input type="file" accept="image/*" multiple hidden data-ph-file></div>
          <div class="bcc-ph-drop" data-ph-drop tabindex="0">⬇ Photos yahan chhodo / paste (Ctrl+V)</div>
          <div class="bcc-ph-list" data-ph-list></div>
        </div>
        <div class="bcc-scan" data-bcc-form="scan" ${state.tab === 'scan' ? '' : 'hidden'}>
          <div class="bcc-scan-bar">
            <button type="button" class="btn primary" data-scan="cam">📷 Camera scan shuru</button>
            <button type="button" class="btn small" data-scan="torch" hidden>🔦 Torch</button>
            <button type="button" class="btn small" data-scan="sound" title="Beep ON/OFF">🔊</button>
            <button type="button" class="btn small" data-scan="clear">🗑 List saaf</button>
            <label class="bcc-vm-pick" title="Class verify: class chuno, phir scan — sahi = hara + beep, galat = laal + vibrate">🎯 Class verify
              <select class="input" data-scan-want><option value="">Off</option>${['VC4', 'VC5', 'VC6', 'VC7', 'VC8', 'VC9', 'VC10', 'VC11', 'VC12', 'VC13', 'VC14', 'VC15', 'VC16', 'VC20'].map((c) => `<option>${c}</option>`).join('')}</select></label>
            <span class="bcc-scan-count" data-scan-count></span>
            <div class="bcc-vm-flash" data-vm-flash aria-live="assertive"></div>
          </div>
          <div class="bcc-cam" data-scan-cam hidden><video playsinline muted></video><div class="bcc-cam-aim"></div><div class="bcc-cam-msg" data-scan-msg></div><div class="bcc-cam-confirm" data-scan-confirm hidden><div class="bcc-cc-t">Ye barcode sahi hai?</div><div class="bcc-cc-code" data-scan-code></div><div class="bcc-cc-dup" data-scan-dupnote></div><div class="bcc-cc-b"><button type="button" class="btn" data-scan-no>🔁 Dobara</button><button type="button" class="btn primary" data-scan-yes>✅ Sahi hai — Save</button></div></div></div>
          <label class="field"><span class="dim small">Scanner gun / bluetooth scanner / haath se — barcode daalo + Enter (ek ke baad ek, list banti jayegi)</span>
            <input class="input mono" data-scan-in placeholder="⌨️ Yahan scan karo ya barcode type karke Enter…" autocomplete="off" inputmode="text"></label>
        </div>
        <div class="bcc-emp" data-bcc-form="emp" ${state.tab === 'emp' ? '' : 'hidden'}>
          <div class="bcc-scan-bar"><span class="bcc-scan-count" data-emp-count></span><input class="input" data-emp-q placeholder="🔎 Naam / barcode / agent…" style="max-width:260px"><button type="button" class="btn small" data-emp-rf>↻ Refresh</button><button type="button" class="btn small" data-emp-link title="Employee ko ye link bhejo">🔗 Employee scan link copy</button><button type="button" class="btn small" data-emp-csv>⬇ CSV</button></div>
          <div class="bcc-emp-dash" data-emp-dash></div>
          <div class="bcc-emp-chips" data-emp-chips></div>
          <div class="table-wrap tall"><table class="tbl compact bcc-tbl"><thead><tr><th>Scan time</th><th>👤 Employee</th><th>Barcode</th><th>Tag ID</th><th>Status</th><th>Class</th><th>Agent</th><th>Agent ID</th><th>TL</th><th>🏢 Office stock</th><th>Allocated / Issue date</th><th>VRN</th><th>Note</th><th>Dispatch date</th><th>Dispatched to</th></tr></thead><tbody data-emp-body><tr><td colspan="14" class="empty">Loading…</td></tr></tbody></table></div>
        </div>
        <p class="dim small bcc-note">Max ${MAX.toLocaleString('en-IN')} barcodes ek baar me. Jo tag stock me nahi, uska Tag ID aas-paas ke stock tags se anumaan lagaya jaata hai (note me likha aata hai). Range ka koi bhi tag stock me na ho to first barcode ka Tag ID daal do.</p>
      </div></div>
      <div class="card"><div class="card-body" data-bcc-out>${state.rows ? resultsHtml() : '<div class="empty-state compact">👆 Barcode daalo — result yahan aayega</div>'}</div></div>
      <section class="card" style="margin-top:14px"><div class="card-head"><h3>🔁 Duplicate barcode checker</h3></div><div class="card-body"><p class="dim small">Checks repeated barcodes within each sheet separately: FF StockDataa or GV Tag Assignment (all statuses). A barcode appearing once in each sheet is normal and is not a duplicate. Formatting, leading zeroes and scientific notation are normalized.</p><div class="btn-row">${FF.auth.can('sheet:StockDataa') ? '<button class="btn small" data-dup-scan="ff">🔎 Scan FF</button>' : ''}${FF.auth.can('sheet:Tag Assignment') ? '<button class="btn small" data-dup-scan="gv">🔎 Scan GV</button>' : ''}</div><div data-dup-out></div></div></section>
    </div>`;
    dup.data = null; dup.seq++; dupPaint(root);
    camStop();
    bind(root);
    phBind(root);
    scanInit(root);
    empStop(); if (state.tab === 'emp') empStart();
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
    try { document.addEventListener('keydown', (e) => { if (!scanPend.open) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); camConfirmClose(true); } else if (e.key === 'Escape') { e.preventDefault(); camConfirmClose(false); } }); } catch { /* optional */ }
    root.addEventListener('input', (e) => { if (e.target.matches('[data-emp-q]')) { emp.q = e.target.value; empPaint(); } });
    root.addEventListener('click', (e) => {
      const eh = e.target.closest('[data-emp-hist]'); if (eh) { const c = eh.dataset.empHist; if (emp.open.has(c)) emp.open.delete(c); else emp.open.add(c); empPaint(); return; }
      const en = e.target.closest('[data-emp-name]'); if (en) { emp.name = en.dataset.empName; empPaint(); return; }
      if (e.target.closest('[data-emp-rf]')) { empLoad(); return; }
      if (e.target.closest('[data-emp-csv]')) { empCsv(); return; }
      if (e.target.closest('[data-emp-link]')) { copyOut(location.origin + '/scan', 'Employee scan link'); return; }
      if (e.target.closest('[data-scan-yes]')) { camConfirmClose(true); return; }
      if (e.target.closest('[data-scan-no]')) { camConfirmClose(false); return; }
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
        if (state.tab === 'emp') empStart(); else empStop();
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
      const cv = e.target.closest('[data-bcc-csv]');
      if (cv && state.rows) { const rows = visible(); U.downloadCsv(`barcode-check-${U.slug(state.title || 'photo')}-${U.stamp()}.csv`, HEAD, rows.map(cells)); return; }
      const x = e.target.closest('[data-bcc-xlsx]');
      if (x && state.rows) {
        const rows = x.dataset.bccXlsx === 'all' ? state.rows : visible();
        const sum = Object.entries(STATUS).map(([k, v]) => [v.label, rows.filter((r) => r.k === k).length]);
        FF.xlsx.download(`barcode-check-${U.slug(state.title)}-${U.stamp()}.xlsx`, [{ name: 'Barcodes', header: HEAD, rows: rows.map(cells) }, { name: 'Summary', header: ['Status', 'Count'], rows: sum }]);
      }
    });
  }


  // ---- 🖼️ Photo upload (v3.125.532) — photo(s) → saare barcode (barcode + neeche likha number OCR) → ek saath check:
  //      Tag ID / status / class / agent / TL / kisme map / dispatch (kisko, kab). Copy (barcode / tag ID / sab) + CSV + Excel.
  const ph = { items: [], seq: 0, timer: 0 };
  const phVision = () => (FF.scanVision ? Promise.resolve(FF.scanVision) : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'scanVision.js?v=535'; s.onload = () => (FF.scanVision ? ok(FF.scanVision) : no(new Error('vision'))); s.onerror = () => no(new Error('vision')); document.head.appendChild(s); }));
  const phValid = (v) => { const d = bcDigits(v); return d.length === 16 ? `${d.slice(0, 6)}-${d.slice(6, 9)}-${d.slice(9)}` : ''; };
  function phPaint() {
    const root = state.root, host = root && root.querySelector('[data-ph-list]'); if (!host) return;
    const all = ph.items.flatMap((it) => it.cands.filter((c) => c.on && phValid(c.code)));
    const uniq = new Set(all.map((c) => phValid(c.code)));
    host.innerHTML = ph.items.map((it) => `<div class="bcc-ph-card" data-ph-id="${it.id}"><div class="bcc-ph-head"><img src="${esc(it.url)}" alt="" class="bcc-ph-img"><div><b>${esc(it.name)}</b><div class="dim small">${it.busy ? '🔎 Padh raha hu… ' + esc(it.step || '') : it.cands.length ? `${it.cands.length} barcode mile` : '❌ barcode nahi mila — photo paas / seedhi lo ya neeche number type karo'}</div></div><button type="button" class="btn small" data-ph-del="${it.id}">✖</button></div>${it.cands.map((c, k) => `<div class="bcc-ph-row"><input type="checkbox" data-ph-ck="${it.id}|${k}"${c.on ? ' checked' : ''}><input class="input mono" data-ph-code="${it.id}|${k}" value="${esc(c.code)}" inputmode="numeric" autocomplete="off"><small class="dim">${c.how === 'text' ? '🔤 number padha' : '▮▮ barcode'}</small>${c.thumb ? `<img class="bcc-ph-thumb" src="${c.thumb}" alt="">` : ''}</div>`).join('')}</div>`).join('') + (ph.items.length ? `<div class="btn-row"><button type="button" class="btn primary" data-ph="check">🔎 ${uniq.size} barcode check karo</button><button type="button" class="btn small" data-ph="addtxt" title="Photo me jo na mile wo number yahan jodo">➕ Number jodo</button><span class="dim small">Galat padha ho to number badlo / untick karo — phir "check karo"</span></div>` : '');
  }
  async function phResolve(it, c) {   // OCR ne ek digit galat padha ho to alt me se jo stock / register me mile wo chuno
    const list = [c.code, ...(c.alts || [])].map(phValid).filter((v, i, a) => v && a.indexOf(v) === i); if (list.length < 2) return;
    try {
      const res = await FF.auth.api('/api/barcode-lookup', 'POST', { barcodes: list });
      const ok = (res.results || []).find((r) => (r.rows && r.rows.length) || r.reg);
      if (ok && ok.barcode !== c.code) { c.code = ok.barcode; }
    } catch { /* check me dikhega */ }
  }
  async function phAdd(files) {
    const list = Array.from(files || []).filter((f) => f && /^image\//.test(f.type || 'image/'));
    for (const file of list) {
      const it = { id: ++ph.seq, name: file.name || 'Photo', url: URL.createObjectURL(file), busy: true, step: '', cands: [] };
      ph.items.unshift(it); phPaint();
      try {
        const V = await phVision();
        let bmp = null; try { bmp = await createImageBitmap(file); } catch { /* */ }
        if (!bmp) bmp = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('img')); im.src = it.url; });
        const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
        const res = await V.read(bmp, w, h, { budgetMs: 25000, onFound: (code, how) => { if (!it.cands.some((c) => c.code === code)) { it.cands.push({ code, how, on: true, alts: [], thumb: '' }); phPaint(); } } });
        for (const r of res) { const c = it.cands.find((x) => x.code === r.code); if (c) { c.alts = r.alts || []; c.thumb = r.thumb || ''; } }
        for (const c of it.cands) if (c.how === 'text' && c.alts.length) await phResolve(it, c);
      } catch (e) { it.err = String((e && e.message) || e); }
      it.busy = false; phPaint(); phCheckSoon(400);
    }
  }
  function phCheckSoon(ms) { clearTimeout(ph.timer); ph.timer = setTimeout(phCheck, ms || 300); }
  function phCheck() {
    const root = state.root; if (!root) return;
    const list = [...new Set(ph.items.flatMap((it) => it.cands.filter((c) => c.on).map((c) => phValid(c.code))).filter(Boolean))];
    if (!list.length) return;
    const f = root.querySelector('[data-bcc-form="multi"]'); if (f && f.list) f.list.value = list.join('\n');
    state.lastKey = ''; run('multi');
  }
  function phBind(root) {
    const file = root.querySelector('[data-ph-file]'), drop = root.querySelector('[data-ph-drop]'); if (!file) return;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ph]'); if (b) {
        const a = b.dataset.ph;
        if (a === 'pick') file.click(); else if (a === 'clear') { ph.items = []; phPaint(); } else if (a === 'check') phCheck();
        else if (a === 'addtxt') { const v = prompt('Barcode number (16 digit):'); const k = phValid(v || ''); if (k) { let it = ph.items.find((x) => x.name === 'Manual'); if (!it) { it = { id: ++ph.seq, name: 'Manual', url: '', busy: false, cands: [] }; ph.items.push(it); } it.cands.push({ code: k, how: 'barcode', on: true, alts: [] }); phPaint(); phCheckSoon(100); } }
        return;
      }
      const d = e.target.closest('[data-ph-del]'); if (d) { ph.items = ph.items.filter((x) => String(x.id) !== d.dataset.phDel); phPaint(); phCheckSoon(200); }
    });
    file.addEventListener('change', () => { const fl = Array.from(file.files || []); file.value = ''; phAdd(fl); });
    root.addEventListener('change', (e) => {
      const ck = e.target.closest('[data-ph-ck]'); if (ck) { const [id, k] = ck.dataset.phCk.split('|'); const it = ph.items.find((x) => String(x.id) === id); if (it && it.cands[k]) { it.cands[k].on = ck.checked; phPaint(); } return; }
      const ci = e.target.closest('[data-ph-code]'); if (ci) { const [id, k] = ci.dataset.phCode.split('|'); const it = ph.items.find((x) => String(x.id) === id), c = it && it.cands[k]; const v = phValid(ci.value); if (c && v) { c.code = v; c.alts = []; c.on = true; phPaint(); phCheckSoon(200); } else if (c) { ci.classList.add('bad'); } }
    });
    ['dragover', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { if (!e.dataTransfer || ![...(e.dataTransfer.types || [])].includes('Files')) return; e.preventDefault(); drop.classList.toggle('on', ev === 'dragover'); if (ev === 'drop') phAdd(Array.from(e.dataTransfer.files)); }));
    drop.addEventListener('dragleave', () => drop.classList.remove('on'));
    if (!ph.pasteBound) ph.pasteBound = 1; else return phPaint();
    document.addEventListener('paste', (e) => { if (state.tab !== 'photo' || !state.root || !state.root.isConnected) return; const fl = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => /^image\//.test(f.type)); if (fl.length) { e.preventDefault(); phAdd(fl); } });
    phPaint();
  }

  // ---- 📷 Scan (v3.125.436) — camera + scanner-gun: har scan turant list me, status peeche se bharta hai ------------------
  // Camera: browser ka BarcodeDetector (phone / Chrome — fast, native); na ho to ZXing (libs/zxing.min.js, sirf zarurat par load).
  // List localStorage me (ff_bcc_scan) — reload / app band hone par bhi bachi rehti hai.
  const SCAN_KEY = 'ff_bcc_scan';
  const scan = { order: [], map: new Map(), queue: [], t: 0, paintRaf: 0, saveT: 0, sound: true, last: { k: '', at: 0 }, ctx: null, want: '', vmDone: new Map() };
  const scanCam = { on: false, stream: null, raf: 0, timer: 0, det: null, reader: null, busy: false, torch: false };
  const scanKey = (c) => strip0(bcDigits(c)) || String(c || '').toUpperCase();
  // 🎯 v3.125.483 — Class verify mode: chuni hui class se har scan ka class match (sheet script jaisa, par turant)
  const vmNorm = (v) => { const c = String(v || '').toUpperCase().replace(/\s+/g, ''); return !c ? '' : (/^VC/.test(c) ? c : (/^\d+$/.test(c) ? 'VC' + c : c)); };
  function vmJudge(r) {
    if (!scan.want || !r || r.pending) return;
    const got = vmNorm(r.cls);
    const v = !got ? 'nf' : got === scan.want ? 'ok' : 'bad';
    if (r._vm === v && r._vmWant === scan.want) return;
    r._vm = v; r._vmWant = scan.want;
    r.note = (v === 'ok' ? `✅ Class sahi (${got})` : v === 'bad' ? `❌ Galat class: ${got} hai, ${scan.want} chahiye` : `⚠️ Class nahi mili — ${scan.want} verify nahi hua`) + (r.note ? ' · ' + String(r.note).replace(/^(✅|❌|⚠️) [^·]*· /, '') : '');
    const key = scanKey(r.barcode);
    if (scan.vmDone.get(key) !== scan.want) { scan.vmDone.set(key, scan.want); scanBeep(v === 'ok' ? 'ok' : 'dup'); vmFlash(v, r.barcode, got); }
  }
  function vmFlash(v, code, got) {
    const host = state.root && state.root.querySelector('[data-vm-flash]'); if (!host) return;
    host.className = `bcc-vm-flash on ${v}`;
    host.innerHTML = v === 'ok' ? `✅ <b>${esc(code)}</b> · ${esc(got)} — sahi` : v === 'bad' ? `❌ <b>${esc(code)}</b> · ye <b>${esc(got)}</b> hai (${esc(scan.want)} nahi)` : `⚠️ <b>${esc(code)}</b> · class nahi mili`;
    clearTimeout(host._t); host._t = setTimeout(() => { host.className = 'bcc-vm-flash'; }, v === 'ok' ? 1400 : 3500);
  }
  const pendingRow = (label) => { const r = makeRow(label, null, '', false, null); r.note = '⏳ check ho raha hai…'; r.pending = true; r.dDate = r.dName = ''; r._new = Date.now(); return r; };
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
    const vm = scan.want ? ` · 🎯 ${esc(scan.want)}: <b class="bcc-vm-ok">✔ ${U.fmt(rows.filter((r) => r._vm === 'ok').length)}</b> · <b class="bcc-vm-bad">✘ ${U.fmt(rows.filter((r) => r._vm === 'bad').length)}</b> · ⚠ ${U.fmt(rows.filter((r) => r._vm === 'nf').length)}` : '';
    el.innerHTML = rows.length ? `<b>${U.fmt(rows.length)}</b> scan · ✅ ${U.fmt(c('iss'))} · 📦 ${U.fmt(c('st'))} · 🏢 ${U.fmt(c('bc'))} · ❓ ${U.fmt(c('nf'))}${vm}` : '<span class="dim">Abhi koi scan nahi</span>';
  }
  function scanPaint() {
    if (scan.paintRaf) return;
    scan.paintRaf = requestAnimationFrame(() => {
      scan.paintRaf = 0;
      if (state.tab !== 'scan' || !state.root) return;
      const rows = scan.order.slice().reverse().map((k) => scan.map.get(k));
      rows.forEach((r, i) => { r._i = i; vmJudge(r); });
      state.rows = rows.length ? rows : null; state.title = 'scanned-list'; state.lastKey = 'scan'; state.dispMeta = state.dispMeta || null;
      if (rows.length) { if (state.q || state.agent || state.filter !== 'all') paintTable(); else paintResults(); }
      else { const out = state.root.querySelector('[data-bcc-out]'); if (out) out.innerHTML = '<div class="empty-state compact">📷 Scan karo — har barcode yahan jodta jayega</div>'; }
      scanCount();
    });
  }
  // 👥 v3.125.606 — app ke andar jo bhi (employee / admin) scan kare, uska naam + time admin ki "Employee scans" table me turant
  function scanShare(code) {
    try {
      const d = String(code || '').replace(/\D/g, ''); if (!/^\d{16}$/.test(d)) return;
      const u = FF.auth && FF.auth.user; const name = String((u && (u.name || u.username)) || '').trim(); if (name.length < 2) return;
      const body = JSON.stringify({ name, code: `${d.slice(0, 6)}-${d.slice(6, 9)}-${d.slice(9)}`, at: new Date().toISOString() });
      fetch('/api/public/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).then(() => { if (state.tab === 'emp') empLoad(); }).catch(() => {});
    } catch { /* scan ko kabhi nahi rokta */ }
  }
  const scanOk = (c) => /^[\d-]+$/.test(String(c || '').trim()) && /^\d{12,20}$/.test(String(c || '').replace(/\D/g, ''));
  function scanAdd(code) {
    if (!scanOk(code)) { U.toast && U.toast('Ye FASTag barcode nahi hai — skip', 'warn'); return false; }
    const k = scanKey(code), ex = scan.map.get(k);
    if (ex) { ex._dup = Date.now(); scanBeep('dup'); scanPaint(); return false; }
    scan.order.push(k); scan.map.set(k, pendingRow(code)); scan.queue.push(code);
    if (!scan.want) scanBeep('ok'); scanSave(); scanPaint();
    try { window.dispatchEvent(new CustomEvent('ff-scan', { detail: { kind: 'ok', code } })); } catch { /* optional */ }
    scanShare(code);
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
      const msg = String((err && err.message) || err);
      if (/429|50[234]|rate|busy|pending|timeout|fetch/i.test(msg)) {
        const left = batch.filter((c) => { const o = scan.map.get(scanKey(c)); if (!o) return false; o._try = (o._try || 0) + 1; o.note = '⏳ server busy — dobara try (' + o._try + ')'; return o._try <= 5; });
        scanPaint();
        if (left.length) { scan.queue.push(...left); clearTimeout(scan.t); scan.t = setTimeout(scanFlush, 2500 * Math.min(4, left.length ? (scan.map.get(scanKey(left[0]))._try || 1) : 1)); return; }
      }
      batch.forEach((c) => { const o = scan.map.get(scanKey(c)); if (o) { o.note = '⚠️ check nahi hua: ' + String((err && err.message) || err).slice(0, 80); o.k = 'nf'; } });
      scanPaint();
    }
  }
  function scanClear() {
    if (scan.order.length > 3 && !window.confirm(`${scan.order.length} scanned barcodes ki list saaf karni hai?`)) return;
    scan.order = []; scan.map.clear(); scan.queue = []; scan.vmDone.clear(); state.rows = null; try { localStorage.removeItem(SCAN_KEY); } catch { /* optional */ }
    scanPaint(); scanCount();
  }
  function scanEnter() {
    scanPaint(); scanCount();
    const inp = state.root && state.root.querySelector('[data-scan-in]');
    if (inp && !(window.matchMedia && matchMedia('(pointer:coarse)').matches)) inp.focus();
  }
  // ---- 👥 Employee scans: public /scan link se employees ke scan (naam ke saath) — live ----
  const emp = { rows: [], by: {}, stats: {}, today: 0, open: new Set(), cache: new Map(), name: '', q: '', timer: 0, busy: false, total: 0, seen: 0 };
  const empTime = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } };
  const agoTxt = (iso) => { const m = Math.round((Date.now() - (Date.parse(iso) || 0)) / 60e3); return !iso ? '—' : m < 1 ? 'abhi' : m < 60 ? m + ' min pehle' : m < 1440 ? Math.round(m / 60) + ' ghante pehle' : Math.round(m / 1440) + ' din pehle'; };
  /** 📜 Ek barcode ka itihaas: pehla scan kisne/kab, uske baad dobara koshish, aur uska abhi ka status. */
  function empHist(r, c) {
    const hits = (r.hits || []).map((h) => `<li>🔁 <b>${esc(h.name)}</b> ne dobara scan kiya — ${esc(empTime(h.at))} <span class="dim">(${esc(agoTxt(h.at))})</span></li>`).join('');
    return `<div class="bcc-emp-h"><b>📜 ${esc(r.code)} ka itihaas</b><ul><li>✅ Pehla scan: <b>${esc(r.name)}</b> — ${esc(empTime(r.at))} <span class="dim">(${esc(agoTxt(r.at))})</span></li>${hits}</ul>${c ? `<div class="dim small">Abhi ka status: ${esc(STATUS[c.k].label)}${c.agent ? ' · ' + esc(c.agent) : ''}${c.dName && c.dName !== SEARCHING ? ' · dispatch: ' + esc(c.dName) : ''}</div>` : ''}${r.dups > (r.hits || []).length ? `<div class="dim small">Kul ${r.dups} dobara koshish (sirf pichhli 10 dikh rahi hain)</div>` : ''}</div>`;
  }
  /** 📊 Live dashboard: aaj ke scan, abhi kaun active, per-employee speed + galat scan. */
  function empDash(root) {
    const box = root.querySelector('[data-emp-dash]'); if (!box) return;
    const names = Object.keys(emp.stats); if (!names.length) { box.innerHTML = ''; return; }
    const wrong = {}; emp.rows.forEach((r) => { const c = emp.cache.get(r.code); if (c && (c.k === 'iss' || c.k === 'nf')) { const o = wrong[r.name] || (wrong[r.name] = { iss: 0, nf: 0 }); o[c.k]++; } });
    const active = names.filter((n) => emp.stats[n].m5 > 0);
    const dupAll = names.reduce((a, n) => a + emp.stats[n].dupTries, 0), wrongAll = Object.values(wrong).reduce((a, o) => a + o.iss + o.nf, 0);
    const card = (t, v, sub, tone) => `<div class="bcc-emp-card ${tone || ''}"><small>${t}</small><b>${v}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const rows = names.sort((a, b) => (emp.stats[b].today - emp.stats[a].today) || (emp.stats[b].total - emp.stats[a].total)).map((n) => {
      const o = emp.stats[n], w = wrong[n] || { iss: 0, nf: 0 }, live = o.m5 > 0;
      return `<tr data-emp-name="${esc(n)}" class="clickable"><td>${live ? '🟢' : '⚪'} <b>${esc(n)}</b></td><td class="num"><b>${U.fmt(o.today)}</b></td><td class="num">${U.fmt(o.h1)}</td><td class="num">${U.fmt(o.total)}</td><td>${esc(agoTxt(o.last))}</td><td class="num">${o.dupTries ? '🔁 ' + o.dupTries : '—'}</td><td class="num">${w.iss ? '⛔ ' + w.iss : '—'}</td><td class="num">${w.nf ? '❓ ' + w.nf : '—'}</td></tr>`;
    }).join('');
    box.innerHTML = `<div class="bcc-emp-cards">${card('Aaj ke scan', U.fmt(emp.today), 'IST aaj', 'blue')}${card('Abhi active', U.fmt(active.length), active.slice(0, 3).join(', ') || 'koi nahi (5 min)', active.length ? 'green' : '')}${card('Kul scan', U.fmt(emp.total), U.fmt(names.length) + ' employee')}${card('🔁 Duplicate koshish', U.fmt(dupAll), 'pehle se scan hue', dupAll ? 'amber' : '')}${card('⛔ Galat scan', U.fmt(wrongAll), 'issued / stock me nahi', wrongAll ? 'red' : '')}</div>
      <details class="bcc-emp-det" open><summary>👥 Employee-wise live</summary><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Employee</th><th class="num">Aaj</th><th class="num">1 ghanta</th><th class="num">Kul</th><th>Last scan</th><th class="num">Duplicate</th><th class="num">Issued</th><th class="num">Not found</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }
  function empPaint() {
    const root = state.root, body = root && root.querySelector('[data-emp-body]'); if (!body) return;
    const q = emp.q.trim().toLowerCase();
    const list = emp.rows.filter((r) => (!emp.name || r.name === emp.name) && (!q || `${r.name} ${r.code} ${(emp.cache.get(r.code) || {}).agent || ''}`.toLowerCase().includes(q) || (/\d/.test(q) && r.code.replace(/\D/g, '').includes(q.replace(/\D/g, '')))));
    body.innerHTML = list.slice(0, 1500).map((r) => {
      const c = emp.cache.get(r.code), fresh = r._f && Date.now() - r._f < 4000;
      const st = c ? `<span class="badge ${STATUS[c.k].tone}">${esc(STATUS[c.k].label || STATUS[c.k].text || c.k)}</span>` : '<span class="dim">⏳</span>';
      const hist = emp.open.has(r.code) ? `<tr class="bcc-emp-hist"><td colspan="10">${empHist(r, c)}</td></tr>` : '';
      return `<tr class="${c ? 'bcc-' + c.k : ''}${fresh ? ' bcc-new' : ''}"><td>${esc(empTime(r.at))}</td><td><b>${esc(r.name)}</b></td><td class="mono bcc-cell" data-emp-hist="${esc(r.code)}" title="Click = itihaas (kisne kab scan kiya)">${esc(r.code)}${r.dups ? ` <span class="badge amber" title="${r.dups} baar dobara scan hua">🔁 ${r.dups}</span>` : ''}</td><td class="mono">${esc(c ? c.tagId : '')}</td><td>${st}</td><td>${esc(c ? c.cls : '')}</td><td>${esc(c ? c.agent : '')}</td><td>${esc(c ? c.agentId : '')}</td><td>${esc(c ? c.tl : '')}</td><td>${esc(c ? c.office || '' : '')}</td><td>${esc(c ? c.date || '' : '')}</td><td>${esc(c ? c.vrn || '' : '')}</td><td>${esc(c ? c.note || '' : '')}</td><td>${esc(c && c.dDate && c.dDate !== SEARCHING ? c.dDate : '')}</td><td>${esc(c && c.dName && c.dName !== SEARCHING ? c.dName : '')}</td></tr>${hist}`;
    }).join('') || '<tr><td colspan="14" class="empty">Abhi kisi employee ne scan nahi kiya</td></tr>';
    empDash(root);
    const cnt = root.querySelector('[data-emp-count]'); if (cnt) cnt.textContent = `${U.fmt(list.length)} scan · ${U.fmt(Object.keys(emp.by).length)} employee`;
    const ch = root.querySelector('[data-emp-chips]');
    if (ch) ch.innerHTML = `<button type="button" class="seg-btn${emp.name ? '' : ' on'}" data-emp-name="">Sab (${U.fmt(emp.total)})</button>` + Object.entries(emp.by).sort((a, b) => b[1] - a[1]).map(([n, c]) => `<button type="button" class="seg-btn${emp.name === n ? ' on' : ''}" data-emp-name="${esc(n)}">👤 ${esc(n)} · ${U.fmt(c)}</button>`).join('');
  }
  async function empEnrich() {
    const need = [...new Set(emp.rows.filter((r) => !emp.cache.has(r.code)).map((r) => r.code))].slice(0, 400);
    if (!need.length) return;
    try {
      const rows = await checkMulti(need);
      rows.forEach((r) => { r.dDate = r.dName = SEARCHING; });
      rows.forEach((r) => emp.cache.set(r.barcode, r));
      empPaint();
      const dp = FF.data.dispatchLookup(need); dp.catch(() => {});
      await attachDispatch(rows, dp); empPaint();
    } catch { /* agli baar dobara try */ }
  }
  async function empLoad() {
    if (emp.busy || !state.root || document.hidden) return; emp.busy = true;
    try {
      const j = await FF.auth.api('/api/scan-log?limit=1500', 'GET');
      const prev = new Set(emp.rows.map((r) => r.code));
      emp.rows = (j.rows || []).map((r) => { if (emp.seen && !prev.has(r.code)) r._f = Date.now(); return r; }); emp.by = j.byName || {}; emp.stats = j.stats || {}; emp.today = j.today || 0; emp.total = j.total || 0; emp.seen = 1;
      const bd = state.root.querySelector('[data-emp-badge]'); if (bd) { bd.hidden = !emp.total; bd.textContent = U.fmt(emp.total); }
      empPaint(); await empEnrich();
    } catch (err) { const b = state.root && state.root.querySelector('[data-emp-body]'); if (b && !emp.rows.length) b.innerHTML = `<tr><td colspan="10" class="empty">⚠️ ${esc(String((err && err.message) || err))}</td></tr>`; }
    emp.busy = false;
  }
  function empStart() { empStop(); empLoad(); emp.timer = setInterval(() => { if (state.tab === 'emp') empLoad(); else empStop(); }, 3000); }
  function empStop() { clearInterval(emp.timer); emp.timer = 0; }
  function empCsv() {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Scan time', 'Employee', 'Barcode', 'Status', 'Class', 'Agent', 'Agent ID', 'TL', 'Tag ID', 'Office stock', 'Issue date', 'VRN', 'Note', 'Dispatch date', 'Dispatched to'].map(q).join(',')];
    emp.rows.filter((r) => !emp.name || r.name === emp.name).forEach((r) => { const c = emp.cache.get(r.code) || {}; lines.push([empTime(r.at), r.name, r.code, c.k ? (STATUS[c.k].label || STATUS[c.k].text || c.k) : '', c.cls, c.agent, c.agentId, c.tl, c.tagId, c.office, c.date, c.vrn, c.note, c.dDate !== SEARCHING ? c.dDate : '', c.dName !== SEARCHING ? c.dName : ''].map(q).join(',')); });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' })); a.download = 'employee-scans.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function scanInit(root) {
    try { scan.sound = localStorage.getItem('ff_bcc_scan_snd') !== '0'; } catch { /* optional */ }
    try { scan.want = localStorage.getItem('ff_bcc_vm') || ''; } catch { /* optional */ }
    const ws = root.querySelector('[data-scan-want]');
    if (ws) {
      ws.value = scan.want;
      ws.addEventListener('change', () => {
        scan.want = ws.value; try { localStorage.setItem('ff_bcc_vm', scan.want); } catch { /* optional */ }
        scan.map.forEach((r, k) => { r._vm = ''; scan.vmDone.set(k, scan.want); });   // purani list ko naye class se dobara judge (bina beep)
        scanPaint();
      });
    }
    const sb = root.querySelector('[data-scan="sound"]'); if (sb) sb.textContent = scan.sound ? '🔊' : '🔇';
    if (!scan.order.length) {
      let saved = []; try { saved = JSON.parse(localStorage.getItem(SCAN_KEY) || '[]'); } catch { /* optional */ }
      (Array.isArray(saved) ? saved : []).slice(-MAX).forEach((c) => { const k = scanKey(c); if (!scan.map.has(k)) { scan.order.push(k); scan.map.set(k, pendingRow(String(c))); scan.queue.push(String(c)); scan.vmDone.set(k, scan.want); } });
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
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'libs/zxing.min.js?v=1'; s.onload = () => (window.ZXing ? ok(window.ZXing) : no(new Error('ZXing load nahi hua'))); s.onerror = () => no(new Error('Scanner library load nahi hui')); document.head.appendChild(s); });
  }
  // Camera sirf poora 16-digit FASTag barcode (608116-039-0598684) maanta hai; QR / adhura / galat padha hua ignore.
  // Padhne ke baad confirm popup: sahi hai to Save (Enter / Space), warna Dobara.
  const camValid = (raw) => { const d = String(raw || '').replace(/\D/g, ''); return /^\d{16}$/.test(d) && /^[\d-]+$/.test(String(raw || '').trim()) ? d : ''; };
  const camFmt = (d) => d.slice(0, 6) + '-' + d.slice(6, 9) + '-' + d.slice(9);
  const scanPend = { code: '', open: false };
  function camConfirmClose(save) {
    const box = state.root && state.root.querySelector('[data-scan-confirm]'); if (box) box.hidden = true;
    if (save && scanPend.code) { scan.last = { k: scanKey(scanPend.code), at: Date.now() }; scanAdd(scanPend.code); }
    scanPend.code = ''; scanPend.open = false;
    if (!save) scan.last = { k: '', at: 0 };
    camMsg(scanCam.on ? 'Agla barcode scan karo' : '');
  }
  function camOnRaw(raw) {
    if (scanPend.open) return;
    const d = camValid(raw); if (!d) return;
    const c = camFmt(d), k = scanKey(c), now = Date.now();
    if (scan.last.k === k && now - scan.last.at < 1800) { scan.last.at = now; return; }
    const box = state.root && state.root.querySelector('[data-scan-confirm]'); if (!box) { scanAdd(c); return; }
    scanPend.code = c; scanPend.open = true;
    const dup = scan.map.has(k);
    box.querySelector('[data-scan-code]').textContent = c;
    box.querySelector('[data-scan-dupnote]').textContent = dup ? '⚠️ Ye barcode list me pehle se hai' : '';
    box.hidden = false; try { navigator.vibrate && navigator.vibrate(40); } catch { /* optional */ }
    const ok = box.querySelector('[data-scan-yes]'); if (ok) ok.focus({ preventScroll: true });
  }
  async function camStart() {
    if (scanCam.on) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { U.toast && U.toast('Is browser / app me camera available nahi (HTTPS + permission chahiye)', 'error'); return; }
    const video = state.root && state.root.querySelector('.bcc-cam video'); if (!video) return;
    camBtn(true); camMsg('Camera khul raha hai…');
    try {
      scanCam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false });
    } catch (err) { camBtn(false); camMsg(''); const nm = err && err.name; U.toast && U.toast(nm === 'NotAllowedError' ? 'Camera allow nahi hua — address bar ke 🔒 / camera icon se Allow karke dobara dabao' : nm === 'NotFoundError' ? 'Camera nahi mila is device me' : nm === 'NotReadableError' ? 'Camera doosri app me use ho raha hai — band karke dobara try karo' : 'Camera start nahi hua (' + (nm || 'error') + ')', 'error'); return; }
    scanCam.on = true;
    video.srcObject = scanCam.stream; try { await video.play(); } catch { /* autoplay */ }
    try { const tr = scanCam.stream.getVideoTracks()[0]; const caps = tr && tr.getCapabilities ? tr.getCapabilities() : {}; const tb = state.root.querySelector('[data-scan="torch"]'); if (tb) tb.hidden = !caps.torch; } catch { /* optional */ }
    camMsg('Barcode ko frame ke beech me rakho');
    let useNative = false;
    // ⚡ v3.125.535 — live: zbar + number (OCR) bhi turant (native/ZXing ke saath); OCR worker camera khulte hi garam
    phVision().then((V) => { if (!scanCam.on) return; if (scanCam.stopLive) scanCam.stopLive(); scanCam.stopLive = V.live(video, { skipNative: 'BarcodeDetector' in window, isActive: () => scanCam.on, hold: () => !!scanPend.open, onFound: (code) => camOnRaw(code), onStatus: (m) => camMsg(m) }); }).catch(() => {});
    if ('BarcodeDetector' in window) {
      try {
        const want = ['code_128', 'code_39', 'code_93', 'itf', 'codabar'];
        const sup = await window.BarcodeDetector.getSupportedFormats();
        const fm = want.filter((f) => sup.includes(f));
        if (fm.length >= 1) { scanCam.det = new window.BarcodeDetector({ formats: fm }); useNative = true; }
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
        scanCam.timer = setTimeout(() => { scanCam.raf = requestAnimationFrame(tick); }, 30);
      };
      tick();
    } else {
      try {
        const Z = await loadZxing();
        const hints = new Map(); hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.CODABAR]); hints.set(Z.DecodeHintType.TRY_HARDER, true);
        scanCam.reader = new Z.BrowserMultiFormatReader(hints, 120);
        scanCam.reader.decodeFromStream(scanCam.stream, video, (res) => { if (res && scanCam.on) camOnRaw(res.getText()); });
      } catch (err) { camStop(); U.toast && U.toast('Scanner start nahi hua: ' + String((err && err.message) || err), 'error'); }
    }
  }
  function camStop() {
    const was = scanCam.on || scanCam.stream;
    scanPend.code = ''; scanPend.open = false; try { const cb = state.root && state.root.querySelector('[data-scan-confirm]'); if (cb) cb.hidden = true; } catch { /* optional */ }
    scanCam.on = false; cancelAnimationFrame(scanCam.raf); clearTimeout(scanCam.timer); try { if (scanCam.stopLive) scanCam.stopLive(); } catch { /* */ } scanCam.stopLive = null;
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
