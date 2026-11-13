/* 💰 v3.125.230 — Payout box (Master Search) + professional payslip PDF.
 * Data: GET /api/payout?ids=&name= → APN sheet (agent-wise payable, class-wise) + FNF sheet (released amount, remark, UTR).
 * Sirf admin / "See payout & download payslips" permission. PAN aur bank account server se hi masked aate hain.
 * PDF: FF.pdf (canvas → PDF, bina CDN) · A4 portrait · company header "APNAPAYMENT SERVICES PRIVATE LIMITED".
 */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  if (FF.payslip) return;
  const COMPANY = 'APNAPAYMENT SERVICES PRIVATE LIMITED';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const inr = (v, dec) => { let n = num(v); n = dec === 0 ? Math.round(n) : Math.round(n * 100) / 100; if (Object.is(n, -0) || Math.abs(n) < 0.005) n = 0; return `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: dec === 0 ? 0 : 2, maximumFractionDigits: dec === 0 ? 0 : 2 })}`; };
  const int = (v) => Math.round(num(v)).toLocaleString('en-IN');
  const canSee = () => { try { return FF.auth.isAdmin() || FF.auth.can('payout'); } catch { return false; } };
  const cache = new Map();

  function words(n) {
    n = Math.round(Math.abs(num(n)));
    if (!n) return 'Zero';
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = (x) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ' ' + a[x % 10] : ''}`);
    const three = (x) => `${x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : ''}${x % 100 ? two(x % 100) : ''}`;
    const parts = [];
    const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
    if (cr) parts.push(`${cr >= 100 ? three(cr) : two(cr)} Crore`); if (lk) parts.push(`${two(lk)} Lakh`); if (th) parts.push(`${two(th)} Thousand`); if (n) parts.push(three(n));
    return parts.join(' ');
  }

  // ---------------------------------------------------------------- data
  function idsOf(pr) {
    const L = [pr.id, pr.sub, ...(pr.ids ? [...pr.ids] : []), ...(pr.alias ? [...pr.alias] : []), ...(pr.tlIds ? [...pr.tlIds] : [])]
      .map((x) => String(x || '').trim()).filter((x) => x && !/^APS\d/i.test(x) && x.length >= 3);
    return [...new Set(L)].slice(0, 12);
  }
  // 💰 v3.125.234 — SNAPSHOT: payout mahine me ek baar aata hai → Home par "Payout refresh" se ek baar poora data
  // (APN + FNF, last 7 months) browser me padh kar compact + masked snapshot server par save. Search par instant (browser me match).
  let core = null, snap = null, snapP = null;
  const loadCore = async () => core || (core = await import('./payout-core.js'));
  // 💾 v3.125.244 — snapshot browser me (IndexedDB) bhi: search par HAMESHA instant, network/429 ho tab bhi.
  // Server se sirf background me check (ETag → 304, ghante me ek baar).
  const IDB = { db: null };
  function idb() {
    if (IDB.db) return Promise.resolve(IDB.db);
    return new Promise((ok, no) => { try { const rq = indexedDB.open('ffPayout', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('kv'); rq.onsuccess = () => { IDB.db = rq.result; ok(IDB.db); }; rq.onerror = () => no(rq.error); } catch (e) { no(e); } });
  }
  const idbGet = async (k) => { try { const db = await idb(); return await new Promise((ok) => { const rq = db.transaction('kv').objectStore('kv').get(k); rq.onsuccess = () => ok(rq.result || null); rq.onerror = () => ok(null); }); } catch { return null; } };
  const idbPut = async (k, v) => { try { const db = await idb(); await new Promise((ok) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = ok; tx.onerror = ok; }); } catch { /* optional */ } };
  async function netSnap(etag) {
    let r = null;
    for (let k = 0; k < 3; k++) {
      r = await fetch('/api/payout/snapshot', { credentials: 'same-origin', cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} }).catch(() => null);
      if (r && (r.ok || r.status === 304)) break;
      if (r && r.status !== 429 && r.status < 500) break;
      await new Promise((ok) => setTimeout(ok, 4000 * (k + 1)));
    }
    if (!r) throw new Error('Network nahi mila');
    if (r.status === 304) return { same: true };
    if (r.status === 202) {           // server abhi snapshot load kar raha hai → thoda ruk kar dobara
      if ((netSnap.tries = (netSnap.tries || 0) + 1) > 12) throw new Error('Payout data server par load ho raha hai — thodi der me dobara kholo');
      await new Promise((ok) => setTimeout(ok, 5000));
      return netSnap(etag);
    }
    netSnap.tries = 0;
    if (!r.ok) throw new Error(r.status === 429 ? 'Server abhi busy hai (429) — thodi der me khud dobara try hoga' : `HTTP ${r.status}`);
    const j = await r.json();
    return { j: j && j.months ? j : { empty: true }, etag: r.headers.get('ETag') || '' };
  }
  let revalAt = 0;
  async function revalidate(local) {
    if (Date.now() - revalAt < 60e3) return; revalAt = Date.now();
    try {
      const n = await netSnap(local && local.etag);
      if (n.same) { await idbPut('snap', { ...local, checked: Date.now() }); return; }
      snap = n.j; cache.clear();
      await idbPut('snap', { etag: n.etag, checked: Date.now(), data: n.j });
    } catch { /* local copy chalti rahe */ }
  }
  async function getSnap(force) {
    if (snap && !force) return snap;
    if (snapP && !force) return snapP;
    snapP = (async () => {
      await loadCore();
      if (!force) {
        const local = await idbGet('snap');
        if (local && local.data) {
          snap = local.data;
          if (Date.now() - (local.checked || 0) > 60 * 60e3) revalidate(local);   // background — wait nahi
          return snap;
        }
      }
      const n = await netSnap('');
      snap = n.j;
      if (!n.j.empty) idbPut('snap', { etag: n.etag, checked: Date.now(), data: n.j });
      return snap;
    })();
    try { return await snapP; } finally { snapP = null; }
  }
  async function fetchPayout(spec) {
    const S = await getSnap();
    if (S.empty) {   // snapshot abhi nahi bana → purana live tarika (sirf matching rows)
      const q = new URLSearchParams({ ids: (spec.ids || []).join(','), name: spec.name || '', months: '7' });
      const key = q.toString(), c = cache.get(key);
      if (c && Date.now() - c.at < 10 * 60e3) return c.p;
      const p = FF.auth.api(`/api/payout?${q}`).then((d) => ({ ...d, live: true }));
      cache.set(key, { at: Date.now(), p }); p.catch(() => cache.delete(key));
      return p;
    }
    const want = { ids: spec.ids || [], name: spec.name || '' };
    const months = S.months.map((m) => {
      const data = core.matchMonth(m.apn, m.fnf, want);
      return { tab: m.tab, ym: m.ym, label: m.label, available: true, data, status: data ? core.statusOf(data.fnf) : null };
    });
    return { ok: true, company: COMPANY, months, snapAt: S.at, snapBy: S.by };
  }
  /** Home → "💰 Payout refresh": har mahine ka APN + FNF tab padho → parse → mask → compact → gzip → server. */
  async function refresh(onStep) {
    await loadCore();
    const step = (t) => { try { onStep && onStep(t); } catch { /* ui */ } };
    const now = new Date(Date.now() + 5.5 * 3600e3);
    const tabs = core.monthTabs(now.toISOString().slice(0, 7), 8);   // 7 mahine data — sabse purane ka bhi growth (pichhla mahina) mile
    const thin = (rows) => rows.map((r) => { const o = {}; for (const [k, v] of Object.entries(r)) { if (v === 0 || v === '') continue; o[k] = k === 'pan' ? core.maskPan(v) : (k === 'account' ? core.maskAcc(v) : v); } return o; });
    const readTab = async (kind, tab) => {
      let r;
      for (let k = 0; k < 3; k++) {     // Google / server ki kabhi-kabhar wali galti par 2 baar aur
        r = await fetch(`/api/payout/raw?kind=${kind}&tab=${encodeURIComponent(tab)}`, { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
        if (r && r.ok) break;
        await new Promise((ok) => setTimeout(ok, 2500 * (k + 1)));
      }
      if (!r) throw new Error('Network error');
      if (!r.ok) { let e = ''; try { e = (await r.json()).error; } catch { /* */ } throw new Error(e || `HTTP ${r.status}`); }
      const j = await r.json();
      if (!j.ok) { if (/nahi mila/i.test(j.error || '')) return null; throw new Error(j.error || 'sheet read fail'); }
      const g = core.parseGrid(j.values || [], kind);
      return { rows: thin(g.rows) };
    };
    const months = [];
    for (const m of tabs) {
      step(`⏳ ${m.label} — APN + FNF padh raha hu…`);
      const [apn, fnf] = await Promise.all([readTab('apn', m.tab), readTab('fnf', m.tab)]);
      if (!apn && !fnf) { step(`— ${m.label}: sheet me tab nahi hai`); continue; }
      months.push({ tab: m.tab, ym: m.ym, label: m.label, apn: apn || { rows: [] }, fnf: fnf || { rows: [] } });
      step(`✅ ${m.label}: ${apn ? apn.rows.length : 0} agents · ${fnf ? fnf.rows.length : 0} payees`);
    }
    if (!months.length) throw new Error('Koi bhi mahine ka tab nahi mila');
    const json = JSON.stringify({ v: 1, at: Date.now(), by: (FF.auth.user && FF.auth.user.name) || '', months });
    step('⏳ Save ho raha hai…');
    const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    const res = await fetch('/api/payout/snapshot', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: gz });
    let out = {}; try { out = await res.json(); } catch { /* */ }
    if (!res.ok || !out.ok) throw new Error(out.error || `HTTP ${res.status}`);
    snap = JSON.parse(json); cache.clear();
    await idbPut('snap', { etag: out.etag || '', checked: Date.now(), data: snap });
    return { ...out, months: months.length };
  }
  async function status() { try { const S = await getSnap(); return S.empty ? null : { at: S.at, by: S.by, months: S.months.map((m) => m.label) }; } catch { return null; } }
  const STATUS_CLS = { paid: 'ps-ok', hold: 'ps-bad', proc: 'ps-warn', other: 'ps-mute', none: 'ps-mute' };

  // ---------------------------------------------------------------- box (Master Search)
  function boxHtml(pr, isTl, ch) {
    if (!canSee() || ch === 'gv') return '';
    const spec = { ids: idsOf(pr), name: pr.name || '', tl: !!isTl };
    return `<div class="mp-kpi msp-kpi k12 msp-pay-box" data-msp-pay-box="${esc(JSON.stringify(spec))}"><small>💰 IDFC payout · last 6 months</small><div class="ps-body"><span class="dim small">Loading payout…</span></div></div>`;
  }
  function paint(box, d, spec) {
    const body = box.querySelector('.ps-body'); if (!body) return;
    const months = (d.months || []).filter((m) => m.data).slice(0, 6);
    if (!months.length) {
      const e1 = (d.months || []).find((m) => m.err);
      body.innerHTML = `<span class="dim small">${e1 ? `⚠️ Payout sheet abhi load nahi hui: ${esc(e1.err)}` : 'Is agent / TL ki payout APN / FNF sheet me nahi mili (last 6 months).'}</span>`;
      return;
    }
    const rows = months.map((m) => {
      const t = m.data.totals || {}, f = m.data.fnf, viaTl = m.data.role !== 'payee';
      const final = viaTl || !f ? num(t.final) : num(f.final);
      const rel = f && !viaTl ? num(f.releasing) : null;
      const st = m.status || { key: 'none', label: '—' };
      return `<tr class="ps-r-${esc(st.key)}"><td class="ps-mon"><b>${esc(m.label.replace(/ (\d{4})$/, " '$1").replace(/'20/, "'"))}</b></td><td class="num ps-tags">${int(t.pay_total)}</td><td class="num ps-fin">${inr(final, 0)}</td><td class="num ps-rel">${rel == null ? (f ? '<span class="dim" title="Payment TL / payee ke naam se release hota hai">via TL</span>' : '<span class="dim">—</span>') : inr(rel, 0)}</td><td><span class="ps-chip ${STATUS_CLS[st.key] || 'ps-mute'}" title="${esc(st.label)}">${esc(st.label.length > 14 ? st.label.slice(0, 13) + '…' : st.label)}</span>${f && f.utr ? `<br><small class="dim" title="Payment UTR">${esc(f.utr)}</small>` : ''}</td></tr>`;
    }).join('');
    const role = months[0].data.role === 'payee' ? `TL / payee ${esc(months[0].data.payeeId)}` : `Agent · paid via ${esc(months[0].data.payeeId)} ${esc(months[0].data.payeeName || '')}`;
    const upd = d.snapAt ? ` · <span title="Home → 💰 Payout refresh">updated ${esc(new Date(d.snapAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }))}</span>` : (d.live ? ' · live' : '');
    body.innerHTML = `<div class="ps-role small dim">${role}${upd}</div><div class="ps-scroll"><table class="ps-tbl"><thead><tr><th>Month</th><th class="num">Payable tags</th><th class="num">Final payout</th><th class="num">Released</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="ps-acts"><button type="button" class="btn sm primary" data-ps-open>📄 Payslip download</button></div>`;
    box.__pay = { d, spec };
  }
  function fill(host) {
    if (!canSee()) return;
    (host ? host.querySelectorAll('[data-msp-pay-box]') : []).forEach((box) => {
      if (box.__payDone) return; box.__payDone = true;
      let spec; try { spec = JSON.parse(box.dataset.mspPayBox); } catch { return; }
      fetchPayout(spec).then((d) => { if (box.isConnected) paint(box, d, spec); }).catch((err) => {
        const b = box.querySelector('.ps-body'); if (b) b.innerHTML = `<span class="dim small">⚠️ ${esc((err && err.message) || err)}</span>`;
        box.__payDone = false;
        setTimeout(() => { if (box.isConnected && !box.__payDone) fill(box.parentNode); }, 30e3);   // khud dobara
      });
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-ps-open]'); if (!b) return;
    const box = b.closest('[data-msp-pay-box]'); if (!box || !box.__pay) return;
    e.preventDefault(); e.stopPropagation();
    openPicker(box.__pay.d, box.__pay.spec);
  }, true);

  // ---------------------------------------------------------------- picker (months + mode)
  function openPicker(d, spec) {
    const all = (d.months || []).filter((m) => m.data), months = all.slice(0, 6);
    let ov = document.getElementById('ps-picker');
    if (!ov) { ov = document.createElement('div'); ov.id = 'ps-picker'; ov.className = 'ops-ov'; document.body.appendChild(ov); }
    ov.innerHTML = `<div class="ops-tower ps-pick"><div class="ops-tw-h"><b>📄 Payslip — ${esc(spec.name || '')}</b><button type="button" class="ops-x" data-ps-x>✕</button></div>
      <div class="ps-mlist">${months.map((m, i) => `<label class="ps-m"><input type="checkbox" value="${esc(m.tab)}"${i === 0 ? ' checked' : ''}> ${esc(m.label)} <small class="dim">${inr(m.data.role === 'payee' && m.data.fnf ? m.data.fnf.final : m.data.totals.final, 0)} · ${esc((m.status && m.status.label) || '')}</small></label>`).join('')}</div>
      <div class="ps-quick"><button type="button" class="btn sm" data-ps-all>Select all</button><button type="button" class="btn sm" data-ps-none>Clear</button><button type="button" class="btn sm" data-ps-last3>Last 3 months</button></div>
      <div class="ps-mode"><b class="small">File</b><label><input type="radio" name="psfmt" value="pdf" checked> 📄 PDF payslip</label><label><input type="radio" name="psfmt" value="xlsx"> 📊 Excel (APN sheet format, rangeen)</label><label><input type="radio" name="psfmt" value="both"> Dono — PDF + Excel</label></div>
      <div class="ps-mode"><b class="small">Months</b><label><input type="radio" name="psmode" value="combined" checked> Ek file — saare chune hue mahine (summary ke saath)</label><label><input type="radio" name="psmode" value="separate"> Har mahine ki alag file</label></div>
      <div class="ops-tw-f"><button type="button" class="btn primary" data-ps-go>⬇ Download</button></div>
      <small>PAN & bank account masked (Excel me account details nahi). Figures exactly as in the APN payout sheet and FNF payment sheet.</small></div>`;
    ov.hidden = false;
    const boxes = () => [...ov.querySelectorAll('.ps-m input')];
    ov.onclick = async (e) => {
      if (e.target === ov || e.target.closest('[data-ps-x]')) { ov.hidden = true; return; }
      if (e.target.closest('[data-ps-all]')) boxes().forEach((x) => { x.checked = true; });
      if (e.target.closest('[data-ps-none]')) boxes().forEach((x) => { x.checked = false; });
      if (e.target.closest('[data-ps-last3]')) boxes().forEach((x, i) => { x.checked = i < 3; });
      const go = e.target.closest('[data-ps-go]');
      if (go) {
        const pick = new Set(boxes().filter((x) => x.checked).map((x) => x.value));
        const sel = months.filter((m) => pick.has(m.tab));
        if (!sel.length) { go.textContent = 'Select at least one month'; return; }
        const mode = (ov.querySelector('input[name=psmode]:checked') || {}).value || 'combined';
        go.disabled = true; go.textContent = '⏳ Creating PDF…';
        const fmt = (ov.querySelector('input[name=psfmt]:checked') || {}).value || 'pdf';
        try { if (fmt !== 'xlsx') await download(spec, sel, mode, d.company, all); if (fmt !== 'pdf') await downloadExcel(spec, sel, mode, all); go.textContent = '✅ Downloaded'; }
        catch (err) { go.textContent = `⚠️ ${(err && err.message) || err}`; }
        setTimeout(() => { go.disabled = false; go.textContent = '⬇ Download'; }, 2500);
      }
    };
  }

  // ---------------------------------------------------------------- PDF drawing (v3.125.236 — rangeen, har APN column)
  const W = 210, H = 297, M = 12;
  const NAVY = '#0f2a4a', LINE = '#d6dde8', INK = '#0f172a', MUTE = '#5b6475';
  const C = { id: '#4f46e5', tags: '#2563eb', kyc: '#0d9488', earn: '#16a34a', ded: '#dc2626', net: '#7c3aed', pay: '#d97706', full: '#475569', agents: '#0891b2', sum: '#4f46e5' };
  const tint = (hex, a) => { const n = parseInt(hex.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255; const m = (c) => Math.round(c + (255 - c) * (1 - a)); return `rgb(${m(r)},${m(g)},${m(b)})`; };
  const STATUS_COL = { paid: '#16a34a', proc: '#d97706', hold: '#dc2626', other: '#475569', none: '#64748b' };
  function pager(company) {
    const pages = [];
    let pg = null, y = 0, col = C.tags, lastTitle = '';
    const F = (FF.pdf && FF.pdf.FONT) || 'Arial, sans-serif';
    const font = (mm, w) => { pg.ctx.font = `${w || 400} ${pg.px(mm)}px ${F}`; };
    const newPage = (title) => {
      title = title || lastTitle; lastTitle = title;
      pg = FF.pdf.page(W, H); pages.push(pg);
      const { ctx, px } = pg;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, px(W), px(H));
      const gr = ctx.createLinearGradient(0, 0, px(W), 0); gr.addColorStop(0, '#0f2a4a'); gr.addColorStop(1, '#1e3a8a');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, px(W), px(26));
      ctx.fillStyle = '#c9a227'; ctx.fillRect(0, px(26), px(W), px(1.1));
      ctx.fillStyle = '#ffffff'; font(5.6, 800); ctx.fillText(company, px(M), px(11.5));
      font(3, 400); ctx.fillStyle = '#cbd5e1'; ctx.fillText('FASTag Partner Programme · IDFC Commission Payout Statement', px(M), px(17.5));
      ctx.textAlign = 'right'; ctx.fillStyle = '#ffffff'; font(4.4, 800); ctx.fillText(title || 'PAYSLIP', px(W - M), px(11.5));
      ctx.textAlign = 'left';
      y = 33;
    };
    const need = (h, title) => { if (!pg || y + h > H - 18) newPage(title); };
    const text = (s, x, yy, o) => { const t = o || {}; font(t.size || 3.2, t.w || 400); pg.ctx.fillStyle = t.color || INK; pg.ctx.textAlign = t.align || 'left'; pg.ctx.fillText(String(s), pg.px(x), pg.px(yy)); pg.ctx.textAlign = 'left'; };
    const rect = (x, yy, w, h, fill, stroke) => { const { ctx, px } = pg; if (fill) { ctx.fillStyle = fill; ctx.fillRect(px(x), px(yy), px(w), px(h)); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = px(0.25); ctx.strokeRect(px(x), px(yy), px(w), px(h)); } };
    const pill = (s, xr, yy, color) => { font(2.8, 800); const w = pg.ctx.measureText(String(s)).width / pg.k + 5; const { ctx, px } = pg; ctx.fillStyle = tint(color, 0.16); const x = xr - w; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(px(x), px(yy - 3.6), px(w), px(5), px(2.5)); else ctx.rect(px(x), px(yy - 3.6), px(w), px(5)); ctx.fill(); text(s, x + w / 2, yy, { size: 2.8, w: 800, color, align: 'center' }); };
    const section = (t, color, h) => { col = color || C.tags; need((h || 12) + 2); rect(M, y, 1.4, 6.2, col); rect(M + 1.4, y, W - 2 * M - 1.4, 6.2, tint(col, 0.1)); text(t.toUpperCase(), M + 4, y + 4.4, { size: 3.1, w: 800, color: col }); y += 8.5; };
    /** cols: [{t, w (mm), a:'l'|'r', c: header color}], rows: [[..]] */
    const table = (cols, rows, o) => {
      const opt = o || {}, rh = opt.rh || 6.2;
      const head = () => { need(rh * 2); let x = M; cols.forEach((c) => { rect(x, y, c.w, rh, tint(c.c || col, 0.18), LINE); text(c.t, c.a === 'r' ? x + c.w - 2 : x + 2, y + rh * 0.66, { size: 2.75, w: 800, color: c.c || col, align: c.a === 'r' ? 'right' : 'left' }); x += c.w; }); y += rh; };
      head();
      rows.forEach((r, ri) => {
        if (y + rh > H - 18) { newPage(opt.title); head(); }
        const bold = opt.foot && ri === rows.length - 1;
        rect(M, y, W - 2 * M, rh, bold ? tint(col, 0.14) : (opt.fill && ri % 2 === 0 ? opt.fill : (ri % 2 ? '#f8fafc' : null)), LINE);
        let x = M;
        cols.forEach((c, ci) => { const v = r[ci] == null ? '' : String(r[ci]); let s = v; font(3, bold ? 800 : 400); const maxW = pg.px(c.w - 3); while (s.length > 3 && pg.ctx.measureText(s).width > maxW) s = s.slice(0, -2); if (s !== v) s += '…'; const cc = opt.cell ? opt.cell(ri, ci, v) : null; text(s, c.a === 'r' ? x + c.w - 2 : x + 2, y + rh * 0.66, { size: 3, w: cc ? 800 : (bold || ci === 0 ? 700 : 400), color: cc || (bold ? (c.c || col) : (opt.ink || INK)), align: c.a === 'r' ? 'right' : 'left' }); x += c.w; });
        y += rh;
      });
      y += 3;
    };
    /** pairs: [label, value, color?]; ncol 2 ya 3 */
    const kv = (pairs, ncol) => {
      const n = ncol || 2, colW = (W - 2 * M) / n, rh = 6.2;
      for (let i = 0, band = 0; i < pairs.length; i += n) {
        const h0 = pairs[i];
        if (h0 && h0.head) {        // group heading — poori line
          need(rh * 2);
          rect(M, y, W - 2 * M, rh - 1, tint(h0.color || col, 0.16)); rect(M, y, 1.2, rh - 1, h0.color || col);
          text(h0.head.toUpperCase(), M + 3, y + 3.7, { size: 2.6, w: 800, color: h0.color || col });
          y += rh - 1; band = 0; continue;
        }
        need(rh);
        for (let j = 0; j < n; j++) {
          const p = pairs[i + j]; if (!p) continue;
          const x = M + j * colW;
          rect(x, y, colW, rh, band % 2 ? '#f8fafc' : null, LINE);
          if (p[0] === '' && (p[1] === '' || p[1] == null)) continue;
          text(p[0], x + 2, y + 4.2, { size: n === 3 ? 2.55 : 2.8, color: MUTE, w: 600 });
          if (p[2] && p[3] === 'pill') pill(p[1], x + colW - 1.5, y + 4.3, p[2]);
          else text(p[1] == null || p[1] === '' ? '—' : p[1], x + colW - 2, y + 4.2, { size: n === 3 ? 2.8 : 3.1, w: 700, align: 'right', color: p[2] || INK });
        }
        y += rh; band++;
      }
      y += 3;
    };
    const finish = (footer) => {
      pages.forEach((p, i) => {
        const { ctx, px } = p;
        ctx.fillStyle = '#c9a227'; ctx.fillRect(px(M), px(H - 14), px(W - 2 * M), px(0.4));
        ctx.fillStyle = MUTE; ctx.font = `400 ${px(2.5)}px ${F}`;
        ctx.fillText('This is a computer-generated statement and does not require a signature. Figures are as per the APN payout sheet and FNF payment records.', px(M), px(H - 9.5));
        ctx.fillText(footer || '', px(M), px(H - 6));
        ctx.textAlign = 'right'; ctx.fillText(`Page ${i + 1} of ${pages.length}`, px(W - M), px(H - 6)); ctx.textAlign = 'left';
      });
      return FF.pdf.build(pages.map((p) => p.canvas));
    };
    return { newPage, need, text, rect, pill, section, table, kv, finish, get y() { return y; }, set y(v) { y = v; } };
  }

  const nowIst = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const slipNo = (m, id) => `APN/IDFC/${m.ym.replace('-', '').slice(2)}/${String(id || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
  const period = (m) => { const [y, mo] = m.ym.split('-').map(Number); const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); const mn = new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' }); return `01 ${mn} ${y} – ${last} ${mn} ${y}`; };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monTag = (m) => { const [y, mo] = m.ym.split('-').map(Number); return `${MON[mo - 1]}'${String(y).slice(2)}`; };
  const fyOf = (m) => { const [y, mo] = m.ym.split('-').map(Number); const s = mo >= 4 ? y : y - 1; return `${String(s).slice(2)}-${String(s + 1).slice(2)}`; };
  /** Payee name: TL naam me "APS" ho (company direct) to agent ka naam, warna TL ka naam. */
  function payeeNameOf(d, spec) {
    const tl = String(d.payeeName || '').trim();
    const agentName = (d.role !== 'payee' && d.agents.length === 1 ? d.agents[0].name : '') || spec.name || (d.agents[0] && d.agents[0].name) || '';
    if (!tl || /\bAPS\b|^APS|APS$/i.test(tl)) return agentName || tl;
    return tl;
  }
  const n0 = (v) => int(v), r2 = (v) => inr(v);
  // Har APN column — label + type (n = count, r = ₹ amount)
  const APN_GROUPS = [
    ['Issuance', C.tags, [['iss_vc4', 'VC4 issued', 'n'], ['iss_vc20', 'VC20 issued', 'n'], ['iss_rest', 'Rest class issued', 'n'], ['iss_total', 'Total issuance', 'n']]],
    ['Replacement', C.tags, [['rep_vc4', 'Replacement VC4', 'n'], ['rep_vc20', 'Replacement VC20', 'n'], ['rep_rest', 'Replacement rest class', 'n']]],
    ['Wrong VRN', C.ded, [['wv_vc4', 'Wrong VRN VC4', 'n'], ['wv_vc20', 'Wrong VRN VC20', 'n'], ['wv_rest', 'Wrong VRN rest class', 'n']]],
    ['KYV blacklist', C.ded, [['kb_vc4', 'KYV blacklist VC4', 'n'], ['kb_vc20', 'KYV blacklist VC20', 'n'], ['kb_rest', 'KYV blacklist rest class', 'n']]],
    ['Chassis', C.tags, [['ch_vc4', 'Chassis VC4', 'n'], ['ch_vc20', 'Chassis VC20', 'n'], ['ch_rest', 'Chassis rest class', 'n']]],
    ['KYC', C.kyc, [['kyc500_n', 'KYC with 500 product', 'n'], ['kycw500_n', 'KYC without 500 product', 'n'], ['po_500', '500 product payout', 'r'], ['po_kyc', 'Normal KYC payout (non-VC4)', 'r']]],
    ['Payable tags', C.tags, [['pay_vc4', 'Payable VC4', 'n'], ['pay_vc20', 'Payable VC20', 'n'], ['pay_rest', 'Payable rest class', 'n'], ['pay_total', 'Total payable tags', 'n']]],
    ['Rates (₹ per tag)', C.kyc, [['rate_vc4', 'VC4 rate', 'r'], ['rate_vc20', 'VC20 rate', 'r'], ['rate_vc4max', 'VC4 rate with MAX issuance', 'r'], ['rate_rest', 'Rest class rate', 'r'], ['rate_kyc500', 'With 500 product rate', 'r'], ['rate_kycw500', 'Without 500 product rate', 'r']], true],
    ['MAX FASTag', C.kyc, [['max_n', 'MAX count', 'n'], ['max_rate', 'MAX rate', 'r', true], ['po_max', 'MAX payout', 'r']]],
    ['Payouts', C.earn, [['po_vc4', 'VC4 payout', 'r'], ['po_vc20', 'VC20 payout', 'r'], ['po_rest', 'Rest class payout', 'r'], ['po_total', 'Total payout', 'r'], ['po_rep_a', 'Replacement payout (VC20/VC5)', 'r'], ['po_rep_b', 'Replacement payout (VC6–VC16)', 'r'], ['salary', 'Salary per month', 'r'], ['bonus', 'Bonus / offer / incentive', 'r'], ['gross', 'Gross payout', 'r']]],
    ['Deductions', C.ded, [['tds', 'TDS @ 2%', 'r'], ['pen_wrongvrn', 'Wrong VRN penalty (₹200)', 'r'], ['pen_closure', 'Tag closure penalty', 'r'], ['bank_complaint', 'Bank complaint', 'r'], ['pen_scanned', 'Penalty – scanned tags', 'r'], ['secugen', 'Secugen device charges', 'r'], ['pen_unaffixed', 'Unaffixed tag penalty', 'r']]],
    ['Balance', C.net, [['opening', 'TL / agent opening balance', 'r'], ['final', 'Final amount (without opening)', 'r'], ['final_open', 'Final amount (with opening)', 'r'], ['payee_sum', 'TL + agents sum (w/o opening)', 'r']]]
  ];

  /** 📈 Chalu (running) mahina: MTD + run-rate se expected month-end, pichhle poore mahine se growth. */
  function curRows(cm) {
    if (!cm || !cm.ym || !cm.cur) return null;
    const f = cm.days / Math.max(1, cm.elapsed);
    return [['VC4', 'vc4'], ['VC20', 'vc20'], ['VC5+ (rest class)', 'rest'], ['Overall', 'total']].map(([lab, k]) => {
      const last = num(cm.prev[k]), mtd = num(cm.cur[k]), exp = Math.round(mtd * f);
      return { lab, last, mtd, exp, g: last ? ((exp - last) / last) * 100 : (exp ? null : 0) };
    });
  }
  function drawCurrent(P, spec, title) {
    const cm = spec && spec.cm, rows = curRows(cm);
    if (!rows) return;
    const cl = monTag({ ym: cm.ym }), pl = cm.last ? monTag({ ym: cm.last }) : 'last month';
    P.section(`Current month — ${cl} (running, 1–${cm.elapsed} of ${cm.days} days) vs ${pl}`, C.pay);
    const gs = (g) => (g === null ? { s: 'New ▲', c: C.earn } : { s: `${g > 0 ? '▲ +' : g < 0 ? '▼ ' : ''}${g.toFixed(1)}%`, c: g > 0 ? C.earn : g < 0 ? C.ded : MUTE });
    const gc = {};
    const body = rows.map((r, i) => { const x = gs(r.g); gc[`${i}:4`] = x.c; return [r.lab, int(r.last), int(r.mtd), int(r.exp), x.s]; });
    P.table([{ t: 'Class', w: 40 }, { t: `${pl} full month`, w: 34, a: 'r', c: C.tags }, { t: `${cl} MTD (1–${cm.elapsed})`, w: 36, a: 'r', c: C.tags }, { t: `${cl} expected (run-rate)`, w: 40, a: 'r', c: C.kyc }, { t: 'Expected growth', w: 36, a: 'r', c: C.pay }],
      body, { foot: true, title, cell: (ri, ci) => gc[`${ri}:${ci}`] || null });
    const bits = [];
    if (cm.mtd !== null && cm.mtd !== undefined) bits.push(`MTD vs ${pl} same days: ${cm.mtd > 0 ? '+' : ''}${cm.mtd}%`);
    if (cm.exp !== null && cm.exp !== undefined) bits.push(`Dashboard forecast vs ${pl} full month: ${cm.exp > 0 ? '+' : ''}${cm.exp}%`);
    P.text(`${bits.join('  ·  ')}${bits.length ? '  ·  ' : ''}Expected = MTD ÷ ${cm.elapsed} days × ${cm.days} days. Payout for ${cl} is not yet released.`, M, P.y, { size: 2.5, color: MUTE }); P.y += 5;
  }
  function drawMonth(P, m, spec, prev) {
    const d = m.data, t = d.totals || {}, f = d.fnf, isPayee = d.role === 'payee';
    const one = d.agents.length === 1 ? d.agents[0] : null;
    const title = `PAYSLIP · ${m.label.toUpperCase()}`;
    P.newPage(title);
    const bank = d.bank || {};
    P.section('Payee details', C.id);
    P.kv([
      ['Payee name', payeeNameOf(d, spec) || '—', C.id], ['Statement type', isPayee ? (d.agents.length > 1 ? 'TL / Payee statement' : 'Payee statement') : 'Agent statement'],
      ['Payee ID (APN)', d.payeeId], ['Payslip no.', slipNo(m, isPayee ? d.payeeId : (one ? one.agentId : d.payeeId))],
      ['TL / Payee name (sheet)', d.payeeName || '—'], ['Pay period', period(m)],
      ...(one ? [['Agent ID', one.agentId], ['New agent ID', one.newId], ['Agent name', one.name], ['User ID', one.userId], ['Agent status', one.status, /^new$/i.test(String(one.status || '').trim()) ? '#1d4ed8' : null], ['Edit remark', one.editRemark]] : []),
      ['Name as per PAN', bank.panName], ['PAN', bank.pan],
      ['Bank', bank.bank], ['IFSC', bank.ifsc], ['Account no.', bank.account], ['Agents (active / inactive)', (() => { const ia = d.agents.filter((a) => /inactive|in\s*-?active|closed|blocked|deactiv/i.test(String(a.status || ''))).length; return `${d.agents.length - ia} / ${ia}`; })()],
      ['Generated on', `${nowIst()} IST`], ['Financial year', `FY 20${fyOf(m)}`]
    ]);
    // ---- tags
    // ---- 📈 Growth: pichhla mahina vs ye mahina (class-wise)
    {
      const pt = prev && prev.data ? prev.data.totals || {} : null;
      const pl = prev ? monTag(prev) : (() => { const [yy, mo] = m.ym.split('-').map(Number); return monTag({ ym: `${mo === 1 ? yy - 1 : yy}-${String(mo === 1 ? 12 : mo - 1).padStart(2, '0')}` }); })();
      const cl = monTag(m);
      P.section(`Growth — ${pl} vs ${cl}`, C.kyc);
      const g = (a, b) => { a = num(a); b = num(b); if (!a && !b) return { s: '—', c: MUTE }; if (!a) return { s: 'New ▲', c: C.earn }; const p = ((b - a) / a) * 100; return { s: `${p > 0 ? '▲ +' : p < 0 ? '▼ ' : ''}${p.toFixed(1)}%`, c: p > 0 ? C.earn : p < 0 ? C.ded : MUTE }; };
      const cls = [['VC4', 'iss_vc4', 'pay_vc4'], ['VC20', 'iss_vc20', 'pay_vc20'], ['VC5+ (rest class)', 'iss_rest', 'pay_rest'], ['Overall', 'iss_total', 'pay_total']];
      const tot = (o, k) => (k === 'iss_total' ? (num(o.iss_total) || num(o.iss_vc4) + num(o.iss_vc20) + num(o.iss_rest)) : num(o[k]));
      const gc = {};
      const rows = cls.map(([lab, ik, pk], ri) => {
        const a = pt ? tot(pt, ik) : null, b = tot(t, ik), pa = pt ? tot(pt, pk) : null, pb = tot(t, pk);
        const gi = pt ? g(a, b) : { s: 'n/a', c: MUTE }, gp = pt ? g(pa, pb) : { s: 'n/a', c: MUTE };
        gc[`${ri}:3`] = gi.c; gc[`${ri}:6`] = gp.c;
        return [lab, pt ? int(a) : '—', int(b), gi.s, pt ? int(pa) : '—', int(pb), gp.s];
      });
      P.table([{ t: 'Class', w: 34 }, { t: `Issued ${pl}`, w: 24, a: 'r', c: C.tags }, { t: `Issued ${cl}`, w: 24, a: 'r', c: C.tags }, { t: 'Issuance growth', w: 30, a: 'r', c: C.kyc }, { t: `Payable ${pl}`, w: 24, a: 'r', c: C.earn }, { t: `Payable ${cl}`, w: 24, a: 'r', c: C.earn }, { t: 'Payable growth', w: 26, a: 'r', c: C.kyc }],
        rows, { foot: true, title, cell: (ri, ci) => gc[`${ri}:${ci}`] || null });
      if (!pt) { P.text(`Previous month (${pl}) data is not in the loaded payout snapshot.`, M, P.y, { size: 2.6, color: MUTE }); P.y += 5; }
      drawCurrent(P, spec, title);
    }
    P.section('Issuance & payable tags', C.tags);
    const rate = (k) => (one ? inr(one[k]) : '');
    P.table([{ t: 'Class', w: 28 }, { t: 'Issued', w: 20, a: 'r' }, { t: 'Replacement', w: 22, a: 'r' }, { t: 'Wrong VRN', w: 21, a: 'r', c: C.ded }, { t: 'KYV blacklist', w: 24, a: 'r', c: C.ded }, { t: 'Chassis', w: 18, a: 'r' }, { t: 'Payable tags', w: 24, a: 'r', c: C.earn }, { t: one ? 'Rate / tag' : 'Amount', w: 29, a: 'r', c: C.earn }],
      [['VC4', int(t.iss_vc4), int(t.rep_vc4), int(t.wv_vc4), int(t.kb_vc4), int(t.ch_vc4), int(t.pay_vc4), one ? rate('rate_vc4') : inr(t.po_vc4)],
        ['VC20', int(t.iss_vc20), int(t.rep_vc20), int(t.wv_vc20), int(t.kb_vc20), int(t.ch_vc20), int(t.pay_vc20), one ? rate('rate_vc20') : inr(t.po_vc20)],
        ['Rest class (VC5+)', int(t.iss_rest), int(t.rep_rest), int(t.wv_rest), int(t.kb_rest), int(t.ch_rest), int(t.pay_rest), one ? rate('rate_rest') : inr(t.po_rest)],
        ['Total', int(t.iss_total || (num(t.iss_vc4) + num(t.iss_vc20) + num(t.iss_rest))), int(num(t.rep_vc4) + num(t.rep_vc20) + num(t.rep_rest)), int(num(t.wv_vc4) + num(t.wv_vc20) + num(t.wv_rest)), int(num(t.kb_vc4) + num(t.kb_vc20) + num(t.kb_rest)), int(num(t.ch_vc4) + num(t.ch_vc20) + num(t.ch_rest)), int(t.pay_total), one ? '' : inr(num(t.po_vc4) + num(t.po_vc20) + num(t.po_rest))]],
      { foot: true, title });
    P.kv([['KYC with 500 product', int(t.kyc500_n), C.kyc], ['KYC without 500 product', int(t.kycw500_n), C.kyc], ['MAX count', int(t.max_n), C.kyc], ['MAX payout', inr(t.po_max), C.kyc]], 2);
    // ---- earnings / deductions side by side
    const earn = [['VC4 payout', t.po_vc4], ['VC20 payout', t.po_vc20], ['Rest class payout', t.po_rest], ['MAX FASTag payout', t.po_max], ['Replacement payout (VC20/VC5)', t.po_rep_a], ['Replacement payout (VC6–VC16)', t.po_rep_b], ['Salary', t.salary], ['Bonus / offer / incentive', t.bonus]].filter(([, v]) => num(v));
    const ded = [['TDS @ 2%', t.tds], ['Wrong VRN penalty', t.pen_wrongvrn], ['Tag closure penalty', t.pen_closure], ['Bank complaint', t.bank_complaint], ['Penalty (scanned tags)', t.pen_scanned], ['Secugen device charges', t.secugen], ['Unaffixed tag penalty', t.pen_unaffixed]].filter(([, v]) => num(v));
    const earnSum = earn.reduce((s, [, v]) => s + num(v), 0), adj = Math.round((num(t.gross) - earnSum) * 100) / 100;
    if (num(t.gross) && Math.abs(adj) >= 1) earn.push(['Adjustment (as per payout sheet)', adj]);   // sheet ka gross hi final — farak saaf dikhe
    const totDed = ded.reduce((s, [, v]) => s + Math.abs(num(v)), 0);
    P.section('Earnings & deductions', C.earn);
    const n = Math.max(earn.length, ded.length, 1);
    const rows = [];
    for (let i = 0; i < n; i++) rows.push([earn[i] ? earn[i][0] : '', earn[i] ? inr(earn[i][1]) : '', ded[i] ? ded[i][0] : '', ded[i] ? inr(Math.abs(num(ded[i][1]))) : '']);
    rows.push(['Gross payout', inr(t.gross), 'Total deductions', inr(totDed)]);
    P.table([{ t: 'Earnings', w: 58, c: C.earn }, { t: 'Amount', w: 35, a: 'r', c: C.earn }, { t: 'Deductions', w: 58, c: C.ded }, { t: 'Amount', w: 35, a: 'r', c: C.ded }], rows, { foot: true, title });
    // ---- net
    const net = num(t.final), open = num(t.opening), withOpen = num(t.final_open) || net + open;
    P.need(30, title);
    const y0 = P.y;
    P.rect(M, y0, W - 2 * M, 24, tint(C.net, 0.1), C.net); P.rect(M, y0, 1.6, 24, C.net);
    P.text('NET PAYABLE (THIS MONTH)', M + 5, y0 + 7, { size: 3, w: 800, color: C.net });
    P.text(inr(net), M + 5, y0 + 15, { size: 6.4, w: 800, color: NAVY });
    P.text(`Rupees ${words(net)} Only`, M + 5, y0 + 20.5, { size: 2.7, color: MUTE });
    P.text(`Opening balance: ${inr(open)}`, W - M - 4, y0 + 9, { size: 3, w: 600, align: 'right' });
    P.text(`Net incl. opening: ${inr(withOpen)}`, W - M - 4, y0 + 15.5, { size: 3.4, w: 800, align: 'right', color: C.net });
    P.y = y0 + 28;
    // ---- payment (FNF)
    P.section('Payment details (FNF)', C.pay);
    const st = m.status || { key: 'none', label: '—' }, sc = STATUS_COL[st.key] || MUTE;
    if (f && !isPayee) {
      P.kv([['Paid through', `${d.payeeId} · ${d.payeeName || ''}`], ['Payee payment status', st.label, sc, 'pill'], ['Amount released to payee', inr(f.releasing), C.earn], ['Payment UTR', f.utr || '—']]);
      P.text('Note: Commission for this agent is released to the payee (TL / partner) above, along with the other agents under that payee.', M, P.y, { size: 2.6, color: MUTE }); P.y += 5;
    } else if (f) {
      P.kv([
        ['Payment status', st.label, sc, 'pill'], ['Amount released', inr(f.releasing), C.earn],
        ['FNF opening', inr(f.opening)], ['FNF gross payout', inr(f.gross)],
        ['TDS (FNF)', inr(Math.abs(num(f.tds))), C.ded], ['GST', inr(f.gst)],
        ['Payout after TDS', inr(f.after_tds)], ['Final payout (FNF)', inr(f.final), C.net],
        ['Closing balance', inr(f.closing)], ['Payment UTR', f.utr || '—'],
        ['Invoice no.', f.invoice || '—'], ['Advice sent', [f.adviceSent, f.emailOn].filter(Boolean).join(' · ') || '—']
      ]);
    } else P.kv([['Payment status', 'Not available in FNF sheet for this month', MUTE], ['', '']]);
    // ---- har APN column (kuch bhi chhoote nahi)
    const src = one || t;
    const pairs = [];
    APN_GROUPS.forEach(([g, color, fields, perAgent]) => {
      if (perAgent && !one) return;                 // TL ke liye rates har agent ke alag — agent table me
      const items = fields.filter((fd) => !(fd[3] && !one)).map(([k, label, ty]) => [label, ty === 'n' ? n0(src[k]) : r2(ty === 'r' && /^(tds|pen_|bank_complaint|secugen)/.test(k) ? Math.abs(num(src[k])) : src[k]), color]);
      if (!items.length) return;
      while (pairs.length % 3) pairs.push(null);
      pairs.push({ head: g, color }, null, null);
      items.forEach((x) => pairs.push(x));
    });
    const rowsNeeded = Math.ceil(pairs.length / 3) * 6.2 + 12;
    if (P.y + Math.min(rowsNeeded, 60) > H - 18) P.newPage(title);
    P.section(`Complete APN payout sheet details${one ? '' : ' (totals of all agents)'}`, C.full);
    // null slot = khaali cell; kv ko 3 col me bharo
    const filled = pairs.map((x) => x || ['', '']);
    P.kv(filled.map((x) => (x.head ? x : (x[0] === '' ? ['', ''] : x))), 3);
    // ---- agent-wise (TL)
    if (d.agents.length > 1) {
      const inact = (a) => /in\s*-?active|inactive|closed|blocked|deactiv/i.test(String(a.status || ''));
      const act = d.agents.filter((a) => !inact(a)), ina = d.agents.filter(inact);
      if (P.y + 12 + Math.min(act.length + 2, 8) * 5.6 > H - 18) P.newPage(title);
      P.section(`Active agents — payout breakdown (${act.length} agents)`, C.agents);
      const L = act.slice().sort((a, b) => num(b.final) - num(a.final));
      P.table([{ t: '#', w: 8, a: 'r' }, { t: 'Agent name', w: 34 }, { t: 'Agent ID', w: 18 }, { t: 'Status', w: 12 }, { t: 'Issued', w: 14, a: 'r' }, { t: 'Payable', w: 15, a: 'r' }, { t: 'KYV BL', w: 13, a: 'r', c: C.ded }, { t: 'MAX', w: 11, a: 'r', c: C.kyc }, { t: 'VC4 rate', w: 16, a: 'r', c: C.kyc }, { t: 'Payout', w: 22, a: 'r', c: C.earn }, { t: 'Final', w: 23, a: 'r', c: C.net }],
        [...L.map((a, i) => [i + 1, a.name, a.agentId, a.status || '', int(a.iss_total), int(a.pay_total), int(num(a.kb_vc4) + num(a.kb_vc20) + num(a.kb_rest)), int(a.max_n), inr(a.rate_vc4, 0), inr(a.po_total, 0), inr(a.final, 0)]),
          (() => { const sm = (k) => L.reduce((x, a) => x + num(a[k]), 0); return ['', 'Total (active)', '', '', int(sm('iss_total')), int(sm('pay_total')), int(sm('kb_vc4') + sm('kb_vc20') + sm('kb_rest')), int(sm('max_n')), '', inr(sm('po_total'), 0), inr(sm('final'), 0)]; })()],
        { foot: true, title, rh: 5.6, cell: (ri, ci, v) => (ci === 3 && /^new$/i.test(String(v).trim()) ? '#1d4ed8' : null) });
      // 🔴 Inactive agents — alag table, laal (payout sirf active ka calculate hota hai)
      if (ina.length) {
        if (P.y + 20 + Math.min(ina.length + 1, 6) * 5.6 > H - 18) P.newPage(title);
        P.section(`Inactive agents — not counted in payout (${ina.length} agents)`, C.ded);
        P.table([{ t: '#', w: 8, a: 'r' }, { t: 'Agent name', w: 46 }, { t: 'Agent ID', w: 22 }, { t: 'New agent ID', w: 24 }, { t: 'Status', w: 22 }, { t: 'Issued', w: 16, a: 'r' }, { t: 'Payable', w: 18, a: 'r' }, { t: 'Final', w: 30, a: 'r' }],
          ina.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).map((a, i) => [i + 1, a.name, a.agentId, a.newId, a.status || 'Inactive', int(a.iss_total), int(a.pay_total), inr(a.final, 0)]),
          { title, rh: 5.6, ink: C.ded, fill: tint(C.ded, 0.06) });
        P.text('Inactive agents are listed for reference only — commission is calculated for active agents.', M, P.y, { size: 2.6, color: C.ded }); P.y += 5;
      }
    }
  }
  function drawSummary(P, sel, spec) {
    P.newPage('PAYOUT SUMMARY');
    const d0 = sel[0].data, bank = d0.bank || {};
    P.section('Payee details', C.id);
    P.kv([['Payee name', payeeNameOf(d0, spec), C.id], ['Payee ID (APN)', d0.payeeId], ['Name as per PAN', bank.panName], ['PAN', bank.pan], ['Bank', bank.bank], ['Account no.', bank.account], ['Months included', String(sel.length)], ['Generated on', `${nowIst()} IST`]]);
    P.section('Month-wise summary', C.sum);
    let g = 0, td = 0, nt = 0, rl = 0;
    const rows = sel.map((m) => { const t = m.data.totals, f = m.data.fnf; g += num(t.gross); td += Math.abs(num(t.tds)); nt += num(t.final); const own = m.data.role === 'payee'; rl += f && own ? num(f.releasing) : 0; return [m.label, int(t.pay_total), inr(t.gross), inr(Math.abs(num(t.tds))), inr(t.final), f ? (own ? inr(f.releasing) : 'via TL') : '—', f ? (f.remark || '—') : 'Not in FNF', f && f.utr ? f.utr : '']; });
    rows.push(['Total', int(sel.reduce((s, m) => s + num(m.data.totals.pay_total), 0)), inr(g), inr(td), inr(nt), inr(rl), '', '']);
    P.table([{ t: 'Month', w: 27 }, { t: 'Payable tags', w: 20, a: 'r', c: C.tags }, { t: 'Gross', w: 24, a: 'r', c: C.earn }, { t: 'TDS', w: 19, a: 'r', c: C.ded }, { t: 'Net payable', w: 25, a: 'r', c: C.net }, { t: 'Released', w: 24, a: 'r', c: C.earn }, { t: 'Status', w: 19, c: C.pay }, { t: 'UTR', w: 28 }], rows, { foot: true, title: 'PAYOUT SUMMARY' });
    P.text(`Total net payable for the selected period: ${inr(nt)} (Rupees ${words(nt)} Only)`, M, P.y + 2, { size: 3, w: 700, color: C.net }); P.y += 6;
    P.y += 2; drawCurrent(P, spec, 'PAYOUT SUMMARY');
  }
  /** File name: APN_IDFC Payout FYR-26-27_Oct'26 - NAME.pdf */
  function fileName(sel, spec) {
    const name = String(payeeNameOf(sel[0].data, spec) || 'Payee').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const ord = sel.slice().sort((a, b) => a.ym.localeCompare(b.ym));
    const fys = [...new Set(ord.map(fyOf))].join(' & ');
    const mon = ord.length > 1 ? `${monTag(ord[0])} to ${monTag(ord[ord.length - 1])}` : monTag(ord[0]);
    return `APN_IDFC Payout FYR-${fys.replace(/-/g, '\u2215')}_${mon} - ${name}.pdf`;   // ∕ (division slash) — "/" file naam me allowed nahi, ye bilkul "/" jaisa dikhta hai
  }
  /** Seedha isi naam se save (site ka generic downloader naam badal deta tha). */
  function saveAs(blob, name) {
    try { if (FF.util && FF.util.downloadStatus) FF.util.downloadStatus('Downloading…', name, false); } catch { /* optional */ }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a);
    try { a.click(); } finally { setTimeout(() => { try { a.remove(); } catch { /* */ } try { URL.revokeObjectURL(url); } catch { /* */ } }, 8000); }
  }
  // ---------------------------------------------------------------- Excel (APN format, account details ke bina)
  const XL_ID = [['agentId', 'Agent ID'], ['newId', 'New Agent ID'], ['name', 'Agent Name'], ['userId', 'User ID'], ['payeeId', 'Agent/TL ID'], ['status', 'Agent Status'], ['payeeName', 'Agent/TL Name']];
  const XL_HEAD = { Issuance: 'hBlue', Replacement: 'hBlue', 'Wrong VRN': 'hRed', 'KYV blacklist': 'hRed', Chassis: 'hBlue', KYC: 'hTeal', 'Payable tags': 'hGreen', 'Rates (₹ per tag)': 'hTeal', 'MAX FASTag': 'hTeal', Payouts: 'hGreen', Deductions: 'hRed', Balance: 'hPurple' };
  function xlCols() {
    const cols = XL_ID.map(([k, h]) => ({ k, h, hs: 'hSlate', t: 's' }));
    APN_GROUPS.forEach(([g, , fields]) => fields.forEach(([k, label, ty]) => cols.push({ k, h: label, hs: XL_HEAD[g] || 'hSlate', t: ty, g })));
    cols.push({ k: 'editRemark', h: 'Edit Remark', hs: 'hSlate', t: 's' });
    return cols;
  }
  const isInact = (a) => /inactive|in\s*-?active|closed|blocked|deactiv/i.test(String(a.status || ''));
  function xlMonthSheet(m) {
    const d = m.data, cols = xlCols();
    const act = d.agents.filter((a) => !isInact(a)).sort((a, b) => num(b.final) - num(a.final)), ina = d.agents.filter(isInact);
    const val = (a, c) => (c.t === 's' ? (a[c.k] == null ? '' : String(a[c.k])) : (a[c.k] == null || a[c.k] === '' ? 0 : num(a[c.k])));
    const rows = [...act, ...ina].map((a) => cols.map((c) => val(a, c)));
    const tot = cols.map((c, i) => (i === 0 ? 'TOTAL' : i === 2 ? `${act.length} active · ${ina.length} inactive` : (c.t === 's' || /^rate_|max_rate/.test(c.k) ? '' : Math.round(act.reduce((x, a) => x + num(a[c.k]), 0) * 100) / 100)));
    rows.push(tot);
    const nAct = act.length, nRows = rows.length;
    return {
      name: `${monTag(m)}`.replace("'", ' '), header: cols.map((c) => c.h), rows,
      headStyleOf: (ci) => cols[ci].hs,
      styleOf: (ri, ci) => {
        const c = cols[ci];
        if (ri === nRows - 1) return c.t === 'r' ? 'totAmt' : 'rowTotal';
        if (ri >= nAct) return c.t === 'r' ? 'inactAmt' : c.t === 'n' ? 'inactNum' : 'inact';
        const z = ri % 2 === 1;
        if (c.k === 'status' && /^new$/i.test(String(rows[ri][ci] || '').trim())) return z ? 'zebNew' : 'newSt';
        if (c.k === 'final' || c.k === 'final_open') return 'pAmt';
        if (c.k === 'gross' || c.k === 'po_total') return 'gAmt';
        if (c.g === 'Deductions' && c.t === 'r') return 'rAmt';
        if (c.t === 'r') return z ? 'zebAmt' : 'amt';
        if (c.t === 'n') return z ? 'zebNum' : 'num';
        return z ? 'zeb' : '';
      }
    };
  }
  function xlSummary(sel, spec, all) {
    const ymPrev = (ym) => { const [y, mo] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
    const pool = all || sel;
    const tv = (t, k) => (k === 'total' ? (num(t.iss_total) || num(t.iss_vc4) + num(t.iss_vc20) + num(t.iss_rest)) : num(t[`iss_${k}`]));
    const gr = (a, b) => (a ? Math.round(((b - a) / a) * 10000) / 10000 : '');
    const rows = sel.map((m) => {
      const t = m.data.totals, f = m.data.fnf, own = m.data.role === 'payee';
      const pv = pool.find((x) => x.ym === ymPrev(m.ym) && x.data), pt = pv ? pv.data.totals : null;
      const g = ['vc4', 'vc20', 'rest', 'total'].map((k) => (pt ? gr(tv(pt, k), tv(t, k)) : ''));
      return [m.label, payeeNameOf(m.data, spec), m.data.payeeId, num(t.iss_total), num(t.pay_total), ...g, num(t.gross), Math.abs(num(t.tds)), num(t.final), num(t.opening), num(t.final_open), f && own ? num(f.releasing) : '', f ? (f.remark || '') : 'Not in FNF', f && f.utr ? f.utr : ''];
    });
    const sum = (i) => Math.round(rows.reduce((x, r) => x + (typeof r[i] === 'number' ? r[i] : 0), 0) * 100) / 100;
    rows.push(['TOTAL', '', '', sum(3), sum(4), '', '', '', '', sum(9), sum(10), sum(11), '', '', sum(14), '', '']);
    // 📈 chalu mahina (running) — upar sabse pehle
    const cm = spec && spec.cm, cr = curRows(cm);
    let curIdx = -1;
    if (cr) {
      const row = [`${monTag({ ym: cm.ym })} — running (1–${cm.elapsed}/${cm.days}), expected`, payeeNameOf(sel[0].data, spec), sel[0].data.payeeId, cr[3].exp, '', ...cr.map((r) => (r.g === null ? '' : Math.round(r.g * 100) / 10000)), '', '', '', '', '', '', `MTD ${cr[3].mtd}${cm.mtd != null ? ` · same-days ${cm.mtd > 0 ? '+' : ''}${cm.mtd}%` : ''}`, 'Payout not released yet'];
      rows.unshift(row); curIdx = 0;
    }
    const H = ['Month', 'Payee Name', 'Payee ID (APN)', 'Total Issuance', 'Payable Tags', 'VC4 Growth %', 'VC20 Growth %', 'VC5+ Growth %', 'Overall Growth %', 'Gross Payout', 'TDS', 'Net Payable', 'Opening Balance', 'Net incl. Opening', 'Released (FNF)', 'Payment Status', 'Payment UTR'];
    const hs = ['hSlate', 'hSlate', 'hSlate', 'hBlue', 'hGreen', 'hTeal', 'hTeal', 'hTeal', 'hTeal', 'hGreen', 'hRed', 'hPurple', 'hPurple', 'hPurple', 'hGreen', 'hAmber', 'hSlate'];
    const n = rows.length;
    return { name: 'Summary', header: H, rows, headStyleOf: (c) => hs[c], styleOf: (ri, c, v) => {
      if (c >= 5 && c <= 8) return v === '' || v == null ? (ri === curIdx ? 'curRow' : '') : v > 0 ? 'pUp' : v < 0 ? 'pDown' : 'pFlat';
      if (ri === curIdx) return c === 3 ? 'curNum' : 'curRow';
      if (ri === n - 1) return c >= 9 ? 'totAmt' : 'rowTotal';
      if (c === 15) return /hold/i.test(v) ? 'down' : /processing|pending/i.test(v) ? 'total' : /processed|paid|released/i.test(v) ? 'up' : '';
      if (c === 11) return 'pAmt'; if (c === 10) return 'rAmt';
      if (c >= 9 && c <= 14) return ri % 2 ? 'zebAmt' : 'amt';
      if (c === 3 || c === 4) return ri % 2 ? 'zebNum' : 'num';
      return ri % 2 ? 'zeb' : '';
    } };
  }
  async function downloadExcel(spec, sel, mode, all) {
    if (!FF.xlsx && FF.lazy && FF.lazy.inject) await FF.lazy.inject('xlsx');
    if (!FF.xlsx) throw new Error('Excel module load nahi hua');
    const xname = (ms) => fileName(ms, spec).replace(/\.pdf$/, '.xlsx');
    if (mode === 'separate') {
      for (const m of sel) { saveAs(FF.xlsx.build([xlSummary([m], spec, all), xlMonthSheet(m)]), xname([m])); await new Promise((r) => setTimeout(r, 700)); }
      return;
    }
    const ord = sel.slice().sort((a, b) => b.ym.localeCompare(a.ym));
    saveAs(FF.xlsx.build([xlSummary(ord, spec, all), ...ord.map(xlMonthSheet)]), xname(sel));
  }
  async function download(spec, sel, mode, company, all) {
    const prevOf = (m) => { const [y, mo] = m.ym.split('-').map(Number); const pd = new Date(Date.UTC(y, mo - 2, 1)); const pym = `${pd.getUTCFullYear()}-${String(pd.getUTCMonth() + 1).padStart(2, '0')}`; return (all || sel).find((x) => x.ym === pym && x.data) || null; };
    if (!FF.pdf && FF.lazy && FF.lazy.need) await FF.lazy.need('pdf').catch(() => {});
    if (!FF.pdf || !FF.pdf.page) throw new Error('PDF module load nahi hua — page refresh karo');
    const foot = `${company || COMPANY} · Confidential — for the named payee only`;
    if (mode === 'separate') {
      for (const m of sel) {
        const P = pager(company || COMPANY); drawMonth(P, m, spec, prevOf(m));
        saveAs(P.finish(foot), fileName([m], spec));
        await new Promise((r) => setTimeout(r, 700));
      }
      return;
    }
    const P = pager(company || COMPANY);
    if (sel.length > 1) drawSummary(P, sel, spec);
    sel.forEach((m) => drawMonth(P, m, spec, prevOf(m)));
    saveAs(P.finish(foot), fileName(sel, spec));
  }

  FF.payslip = { xlSummary, curRows, boxHtml, fill, openPicker, download, downloadExcel, xlMonthSheet, words, idsOf, refresh, status, getSnap, fileName, payeeNameOf };
})(window.FF);
