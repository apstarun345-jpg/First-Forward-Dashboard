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
  const HEAD = ['Barcode', 'Status', 'Tag ID', 'Class', 'Agent', 'Agent ID', 'TL', 'Allocated / Issue date', 'VRN', 'Note', 'Dispatch date', 'Dispatched to'];
  const cells = (r) => [r.barcode, STATUS[r.k].label, r.tagId, r.cls, r.agent, r.agentId, r.tl, r.date, r.vrn, r.note, r.dDate || '', r.dName || ''];
  const dLabel = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && U.labelDateKey ? U.labelDateKey(iso, true) : (iso || ''));
  /** 📒 Dispatch ledger (IDFC Stock Sheet / GV Stock Sheet First–Last ranges) → har barcode ki dispatch date + naam. */
  async function attachDispatch(rows) {
    try {
      const { map, meta } = await FF.data.dispatchLookup(rows.map((r) => r.barcode));
      rows.forEach((r) => {
        const hit = map.get(String(r.barcode).replace(/\D/g, '').replace(/^0+/, ''));
        if (!hit) return;
        const parts = [];
        ['ff', 'gv'].forEach((ch) => (hit[ch] || []).slice(0, 1).forEach((e) => parts.push({ ch, e, more: (hit[ch + 'Count'] || 1) - 1 })));
        if (!parts.length) return;
        r.dDate = parts.map((x) => `${parts.length > 1 ? x.ch.toUpperCase() + ' ' : ''}${dLabel(x.e.date) || '—'}`).join(' | ');
        r.dName = parts.map((x) => `${parts.length > 1 ? x.ch.toUpperCase() + ' · ' : ''}${x.e.agent || '—'}${x.e.agentId ? ` (${x.e.agentId})` : ''}${x.e.approx ? ' ~' : ''}${x.more > 0 ? ` +${x.more}` : ''}`).join(' | ');
      });
      state.dispMeta = meta;
    } catch (err) { state.dispMeta = { error: String((err && err.message) || err) }; }
  }
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
    const q = state.q.trim().toLowerCase();
    return (state.rows || []).filter((r) => (state.filter === 'all' || r.k === state.filter) && (!state.agent || r.agent === state.agent) && (!q || cells(r).join(' ').toLowerCase().includes(q)));
  }
  function dispNote() {
    const m = state.dispMeta;
    if (!m) return '';
    if (m.error) return `<p class="dim small">⚠️ Dispatch ledger load nahi hui: ${esc(m.error)}</p>`;
    const errs = Object.entries(m.errors || {});
    return errs.length ? `<p class="dim small">⚠️ Dispatch ledger ki kuch sheets nahi padh payi (${errs.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ')}) — sheet "Anyone with the link: Viewer" honi chahiye.</p>` : '';
  }
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
        ${canX ? `<button type="button" class="btn small" data-bcc-xlsx="vis">⬇ Excel (filtered ${U.fmt(vis.length)})</button><button type="button" class="btn small" data-bcc-xlsx="all">⬇ Excel (sab)</button>` : ''}</div>
      ${agents.length ? `<details class="bcc-agents" ${agents.length <= 12 ? 'open' : ''}><summary><b>🧑‍💼 Agent-wise · ${U.fmt(agents.length)}</b> <span class="dim small">(naam par click = filter)</span></summary>
        <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Agent</th><th>TL</th><th class="num">📦 Stock</th><th class="num">✅ Issued</th><th class="num">Total</th></tr></thead><tbody>${agents.slice(0, 300).map(([k, o]) => `<tr class="clickable${state.agent === k ? ' on' : ''}" data-bcc-agent="${esc(k)}"><td><b>${esc(k)}</b></td><td>${esc(o.tl || '')}</td><td class="num">${U.fmt(o.st)}</td><td class="num">${U.fmt(o.iss)}</td><td class="num"><b>${U.fmt(o.st + o.iss)}</b></td></tr>`).join('')}</tbody></table></div></details>` : ''}
      ${dispNote()}
      <p class="dim small">${U.fmt(vis.length)} rows${vis.length > show.length ? ` · pehli ${U.fmt(show.length)} dikh rahi — sab ke liye Excel` : ''}</p>
      <div class="table-wrap"><table class="tbl compact bcc-tbl"><thead><tr>${HEAD.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${show.map((r) => `<tr class="bcc-${r.k}">${cells(r).map((v, i) => `<td${i === 0 || i === 2 ? ' class="mono"' : ''}>${i === 1 ? `<span class="badge ${STATUS[r.k].tone}">${esc(v)}</span>` : esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${HEAD.length}" class="empty">Is filter me kuch nahi</td></tr>`}</tbody></table></div>`;
  }
  function paintResults() {
    const el = state.root && state.root.querySelector('[data-bcc-out]');
    if (el) el.innerHTML = resultsHtml();
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
    </div>`;
    bind(root);
    if (p.first && p.last) run('range');
  }
  async function run(kind) {
    const root = state.root; if (!root) return;
    const out = root.querySelector('[data-bcc-out]');
    const seq = ++state.busy;
    try {
      let rows, title;
      if (kind === 'range') {
        const f = root.querySelector('[data-bcc-form="range"]');
        const first = f.first.value.trim(), last = f.last.value.trim(), tag = f.tag.value.trim().toUpperCase();
        if (!first || !last) return;
        const key = `r|${first}|${last}|${tag}`;
        if (key === state.lastKey && state.rows) return;
        let list; try { list = expandRange(first, last); } catch (err) { out.innerHTML = `<div class="error-box">${esc(err.message)}</div>`; return; }
        out.innerHTML = U.spinner(`${U.fmt(list.length)} barcodes check ho rahe hain (stock + issuance)…`);
        rows = await checkRange(first, last, isHex(tag) ? tag : '');
        out.innerHTML = U.spinner('Dispatch ledger se dispatch date / naam mil raha hai…');
        await attachDispatch(rows);
        title = `${first}_${last}`; state.lastKey = key;
      } else {
        const f = root.querySelector('[data-bcc-form="multi"]');
        const list = parseMulti(f.list.value);
        if (!list.length) return;
        const key = `m|${list.join('|')}`;
        if (key === state.lastKey && state.rows) return;
        out.innerHTML = U.spinner(`${U.fmt(list.length)} barcodes check ho rahe hain…`);
        rows = await checkMulti(list);
        out.innerHTML = U.spinner('Dispatch ledger se dispatch date / naam mil raha hai…');
        await attachDispatch(rows);
        title = `${list.length}-barcodes`; state.lastKey = key;
      }
      if (seq !== state.busy) return;
      state.rows = rows; state.title = title; state.filter = 'all'; state.agent = ''; state.q = '';
      paintResults();
    } catch (err) {
      if (seq === state.busy) out.innerHTML = U.errorBox(err);
    }
  }
  function bind(root) {
    let t = 0;
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
      if (e.target.matches('[data-bcc-q]')) { state.q = e.target.value; clearTimeout(t); t = setTimeout(() => { const pos = e.target.selectionStart; paintResults(); const q = root.querySelector('[data-bcc-q]'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch { /* ignore */ } } }, 250); }
    });
    root.addEventListener('click', (e) => {
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
      const x = e.target.closest('[data-bcc-xlsx]');
      if (x && state.rows) {
        const rows = x.dataset.bccXlsx === 'all' ? state.rows : visible();
        const sum = Object.entries(STATUS).map(([k, v]) => [v.label, rows.filter((r) => r.k === k).length]);
        FF.xlsx.download(`barcode-check-${U.slug(state.title)}-${U.stamp()}.xlsx`, [{ name: 'Barcodes', header: HEAD, rows: rows.map(cells) }, { name: 'Summary', header: ['Status', 'Count'], rows: sum }]);
      }
    });
  }

  FF.barcodeChecker = { expandRange, tagInfer, parseMulti, makeRow, _state: state };
  FF.pages.barcodeChecker = { title: 'Barcode Checker', render };
})(window.FF);
