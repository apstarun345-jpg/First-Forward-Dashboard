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
  const inr = (v, dec) => { const n = num(v); return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: dec === 0 ? 0 : 2, maximumFractionDigits: dec === 0 ? 0 : 2 })}`; };
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
  async function getSnap(force) {
    if (snap && !force) return snap;
    if (snapP && !force) return snapP;
    snapP = (async () => {
      await loadCore();
      const r = await fetch('/api/payout/snapshot', { credentials: 'same-origin', cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      snap = j && j.months ? j : { empty: true };
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
    const tabs = core.monthTabs(now.toISOString().slice(0, 7), 7);
    const thin = (rows) => rows.map((r) => { const o = {}; for (const [k, v] of Object.entries(r)) { if (v === 0 || v === '') continue; o[k] = k === 'pan' ? core.maskPan(v) : (k === 'account' ? core.maskAcc(v) : v); } return o; });
    const readTab = async (kind, tab) => {
      const r = await fetch(`/api/payout/raw?kind=${kind}&tab=${encodeURIComponent(tab)}`, { credentials: 'same-origin', cache: 'no-store' });
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
    snap = null; cache.clear(); await getSnap(true);
    return { ...out, months: months.length };
  }
  async function status() { try { const S = await getSnap(); return S.empty ? null : { at: S.at, by: S.by, months: S.months.map((m) => m.label) }; } catch { return null; } }
  const STATUS_CLS = { paid: 'ps-ok', hold: 'ps-bad', proc: 'ps-warn', other: 'ps-mute', none: 'ps-mute' };

  // ---------------------------------------------------------------- box (Master Search)
  function boxHtml(pr, isTl, ch) {
    if (!canSee() || ch === 'gv') return '';
    const spec = { ids: idsOf(pr), name: pr.name || '', tl: !!isTl };
    return `<div class="mp-kpi msp-kpi k12 msp-pay-box" data-msp-pay-box="${esc(JSON.stringify(spec))}"><small>💰 IDFC payout · last 6 months <span class="dim">(APN + FNF sheet)</span></small><div class="ps-body"><span class="dim small">Loading payout…</span></div></div>`;
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
      return `<tr><td><b>${esc(m.label.replace(/ (\d{4})$/, " '$1").replace(/'20/, "'"))}</b></td><td class="num">${int(t.pay_total)}</td><td class="num">${inr(final, 0)}</td><td class="num">${rel == null ? (f ? '<span class="dim" title="Payment TL / payee ke naam se release hota hai">via TL</span>' : '<span class="dim">—</span>') : inr(rel, 0)}</td><td><span class="ps-chip ${STATUS_CLS[st.key] || 'ps-mute'}" title="${esc(st.label)}">${esc(st.label.length > 14 ? st.label.slice(0, 13) + '…' : st.label)}</span>${f && f.utr ? `<br><small class="dim" title="Payment UTR">${esc(f.utr)}</small>` : ''}</td></tr>`;
    }).join('');
    const role = months[0].data.role === 'payee' ? `TL / payee ${esc(months[0].data.payeeId)}` : `Agent · paid via ${esc(months[0].data.payeeId)} ${esc(months[0].data.payeeName || '')}`;
    const upd = d.snapAt ? ` · <span title="Home → 💰 Payout refresh">updated ${esc(new Date(d.snapAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }))}</span>` : (d.live ? ' · live' : '');
    body.innerHTML = `<div class="ps-role small dim">${role}${upd}</div><table class="ps-tbl"><thead><tr><th>Month</th><th class="num">Payable tags</th><th class="num">Final payout</th><th class="num">Released</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
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
    const months = (d.months || []).filter((m) => m.data);
    let ov = document.getElementById('ps-picker');
    if (!ov) { ov = document.createElement('div'); ov.id = 'ps-picker'; ov.className = 'ops-ov'; document.body.appendChild(ov); }
    ov.innerHTML = `<div class="ops-tower ps-pick"><div class="ops-tw-h"><b>📄 Payslip — ${esc(spec.name || '')}</b><button type="button" class="ops-x" data-ps-x>✕</button></div>
      <div class="ps-mlist">${months.map((m, i) => `<label class="ps-m"><input type="checkbox" value="${esc(m.tab)}"${i === 0 ? ' checked' : ''}> ${esc(m.label)} <small class="dim">${inr(m.data.role === 'payee' && m.data.fnf ? m.data.fnf.final : m.data.totals.final, 0)} · ${esc((m.status && m.status.label) || '')}</small></label>`).join('')}</div>
      <div class="ps-quick"><button type="button" class="btn sm" data-ps-all>Select all</button><button type="button" class="btn sm" data-ps-none>Clear</button><button type="button" class="btn sm" data-ps-last3>Last 3 months</button></div>
      <div class="ps-mode"><label><input type="radio" name="psmode" value="combined" checked> One PDF — all selected months (with summary page)</label><label><input type="radio" name="psmode" value="separate"> Separate PDF for each month</label></div>
      <div class="ops-tw-f"><button type="button" class="btn primary" data-ps-go>⬇ Download PDF</button></div>
      <small>PAN & bank account are masked. Figures exactly as in the APN payout sheet and FNF payment sheet.</small></div>`;
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
        try { await download(spec, sel, mode, d.company); go.textContent = '✅ Downloaded'; }
        catch (err) { go.textContent = `⚠️ ${(err && err.message) || err}`; }
        setTimeout(() => { go.disabled = false; go.textContent = '⬇ Download PDF'; }, 2500);
      }
    };
  }

  // ---------------------------------------------------------------- PDF drawing
  const W = 210, H = 297, M = 12;
  const NAVY = '#0f2a4a', ACC = '#1d4ed8', LINE = '#d6dde8', SOFT = '#f3f6fb', INK = '#0f172a', MUTE = '#5b6475';
  function pager(company) {
    const pages = [];
    let pg = null, y = 0;
    const F = (FF.pdf && FF.pdf.FONT) || 'Arial, sans-serif';
    const font = (mm, w) => { pg.ctx.font = `${w || 400} ${pg.px(mm)}px ${F}`; };
    const newPage = (title) => {
      pg = FF.pdf.page(W, H); pages.push(pg);
      const { ctx, px } = pg;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, px(W), px(H));
      ctx.fillStyle = NAVY; ctx.fillRect(0, 0, px(W), px(26));
      ctx.fillStyle = '#c9a227'; ctx.fillRect(0, px(26), px(W), px(1.1));
      ctx.fillStyle = '#ffffff'; font(5.6, 800); ctx.fillText(company, px(M), px(11.5));
      font(3, 400); ctx.fillStyle = '#cbd5e1'; ctx.fillText('FASTag Partner Programme · Commission Payout Statement', px(M), px(17.5));
      ctx.textAlign = 'right'; ctx.fillStyle = '#ffffff'; font(4.6, 800); ctx.fillText(title || 'PAYSLIP', px(W - M), px(11.5));
      ctx.textAlign = 'left';
      y = 33;
    };
    const need = (h, title) => { if (!pg || y + h > H - 18) newPage(title); };
    const text = (s, x, yy, o) => { const t = o || {}; font(t.size || 3.2, t.w || 400); pg.ctx.fillStyle = t.color || INK; pg.ctx.textAlign = t.align || 'left'; pg.ctx.fillText(String(s), pg.px(x), pg.px(yy)); pg.ctx.textAlign = 'left'; };
    const rect = (x, yy, w, h, fill, stroke) => { const { ctx, px } = pg; if (fill) { ctx.fillStyle = fill; ctx.fillRect(px(x), px(yy), px(w), px(h)); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = px(0.25); ctx.strokeRect(px(x), px(yy), px(w), px(h)); } };
    const section = (t) => { need(12); text(t.toUpperCase(), M, y + 4, { size: 3.1, w: 800, color: ACC }); rect(M, y + 5.6, W - 2 * M, 0.35, ACC); y += 9; };
    /** cols: [{t, w (mm), a:'l'|'r'}], rows: [[..]] , opts: {bold rows idx set, foot row} */
    const table = (cols, rows, o) => {
      const opt = o || {}, rh = opt.rh || 6.2;
      const head = () => { need(rh * 2); rect(M, y, W - 2 * M, rh, SOFT, LINE); let x = M; cols.forEach((c) => { text(c.t, c.a === 'r' ? x + c.w - 2 : x + 2, y + rh * 0.66, { size: 2.8, w: 800, color: MUTE, align: c.a === 'r' ? 'right' : 'left' }); x += c.w; }); y += rh; };
      head();
      rows.forEach((r, ri) => {
        if (y + rh > H - 18) { newPage(opt.title); head(); }
        const bold = opt.foot && ri === rows.length - 1;
        rect(M, y, W - 2 * M, rh, bold ? '#eaf0fb' : (ri % 2 ? '#fbfcfe' : null), LINE);
        let x = M;
        cols.forEach((c, ci) => { const v = r[ci] == null ? '' : String(r[ci]); let s = v; font(3, bold ? 800 : 400); const maxW = pg.px(c.w - 3); while (s.length > 3 && pg.ctx.measureText(s).width > maxW) s = s.slice(0, -2); if (s !== v) s += '…'; text(s, c.a === 'r' ? x + c.w - 2 : x + 2, y + rh * 0.66, { size: 3, w: bold ? 800 : 400, align: c.a === 'r' ? 'right' : 'left' }); x += c.w; });
        y += rh;
      });
      y += 3;
    };
    const kv = (pairs) => {      // 2 column info grid
      const colW = (W - 2 * M) / 2, rh = 6.4;
      for (let i = 0; i < pairs.length; i += 2) {
        need(rh);
        [pairs[i], pairs[i + 1]].forEach((p, j) => {
          if (!p) return;
          const x = M + j * colW;
          rect(x, y, colW, rh, j ? null : null, LINE);
          text(p[0], x + 2, y + 4.3, { size: 2.8, color: MUTE, w: 600 });
          text(p[1] == null || p[1] === '' ? '—' : p[1], x + colW - 2, y + 4.3, { size: 3.1, w: 700, align: 'right' });
        });
        y += rh;
      }
      y += 3;
    };
    const finish = (footer) => {
      pages.forEach((p, i) => {
        const { ctx, px } = p;
        ctx.fillStyle = LINE; ctx.fillRect(px(M), px(H - 14), px(W - 2 * M), px(0.3));
        ctx.fillStyle = MUTE; ctx.font = `400 ${px(2.5)}px ${F}`;
        ctx.fillText('This is a computer-generated statement and does not require a signature. Figures are as per the APN payout sheet and FNF payment records.', px(M), px(H - 9.5));
        ctx.fillText(footer || '', px(M), px(H - 6));
        ctx.textAlign = 'right'; ctx.fillText(`Page ${i + 1} of ${pages.length}`, px(W - M), px(H - 6)); ctx.textAlign = 'left';
      });
      return FF.pdf.build(pages.map((p) => p.canvas));
    };
    return { newPage, need, text, rect, section, table, kv, finish, get y() { return y; }, set y(v) { y = v; } };
  }

  const nowIst = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const slipNo = (m, id) => `APN/IDFC/${m.ym.replace('-', '').slice(2)}/${String(id || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
  const period = (m) => { const [y, mo] = m.ym.split('-').map(Number); const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); const mn = new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' }); return `01 ${mn} ${y} – ${last} ${mn} ${y}`; };

  function drawMonth(P, m, spec) {
    const d = m.data, t = d.totals || {}, f = d.fnf, isPayee = d.role === 'payee';
    const one = !isPayee && d.agents.length === 1 ? d.agents[0] : null;
    const title = `PAYSLIP · ${m.label.toUpperCase()}`;
    P.newPage(title);
    const bank = d.bank || {};
    P.kv([
      ['Payee name', (isPayee ? d.payeeName : (one ? one.name : spec.name)) || '—'], ['Statement type', isPayee ? 'TL / Payee statement' : 'Agent statement'],
      ['Payee ID (APN)', d.payeeId], ['Payslip no.', slipNo(m, isPayee ? d.payeeId : (one ? one.agentId : d.payeeId))],
      ...(one ? [['Agent ID', one.agentId], ['New agent ID', one.newId], ['Agent status', one.status], ['Paid via', `${d.payeeId} · ${d.payeeName || ''}`]] : []),
      ['Name as per PAN', bank.panName], ['PAN', bank.pan],
      ['Bank', bank.bank], ['IFSC', bank.ifsc], ['Account no.', bank.account], ['Pay period', period(m)],
      ['Generated on', `${nowIst()} IST`], ['Agents covered', String(d.agents.length)]
    ]);
    // ---- tags
    P.section('Issuance & payable tags');
    const rate = (k) => (one ? inr(one[k]) : '');
    P.table([{ t: 'Class', w: 30 }, { t: 'Issued', w: 21, a: 'r' }, { t: 'Replacement', w: 23, a: 'r' }, { t: 'Wrong VRN', w: 21, a: 'r' }, { t: 'KYC blacklist', w: 23, a: 'r' }, { t: 'Chassis', w: 19, a: 'r' }, { t: 'Payable tags', w: 24, a: 'r' }, { t: one ? 'Rate / tag' : 'Amount', w: 25, a: 'r' }],
      [['VC4', int(t.iss_vc4), int(t.rep_vc4), int(t.wv_vc4), int(t.kb_vc4), int(t.ch_vc4), int(t.pay_vc4), one ? rate('rate_vc4') : inr(t.po_vc4)],
        ['VC20', int(t.iss_vc20), int(t.rep_vc20), int(t.wv_vc20), int(t.kb_vc20), int(t.ch_vc20), int(t.pay_vc20), one ? rate('rate_vc20') : inr(t.po_vc20)],
        ['Rest class (VC5+)', int(t.iss_rest), int(t.rep_rest), int(t.wv_rest), int(t.kb_rest), int(t.ch_rest), int(t.pay_rest), one ? rate('rate_rest') : inr(t.po_rest)],
        ['Total', int(t.iss_total || (t.iss_vc4 + t.iss_vc20 + t.iss_rest)), int(t.rep_vc4 + t.rep_vc20 + t.rep_rest), int(t.wv_vc4 + t.wv_vc20 + t.wv_rest), int(t.kb_vc4 + t.kb_vc20 + t.kb_rest), int(t.ch_vc4 + t.ch_vc20 + t.ch_rest), int(t.pay_total), one ? '' : inr(t.po_vc4 + t.po_vc20 + t.po_rest)]],
      { foot: true, title });
    // ---- earnings / deductions side by side
    const earn = [['VC4 payout', t.po_vc4], ['VC20 payout', t.po_vc20], ['Rest class payout', t.po_rest], ['MAX FASTag payout', t.po_max], ['KYC payout', t.po_kyc], ['500 product payout', t.po_500], ['Replacement payout (VC20/VC5)', t.po_rep_a], ['Replacement payout (VC6–VC16)', t.po_rep_b], ['Salary', t.salary], ['Bonus / offer / incentive', t.bonus]].filter(([, v]) => num(v));
    const ded = [['TDS @ 2%', t.tds], ['Wrong VRN penalty', t.pen_wrongvrn], ['Tag closure penalty', t.pen_closure], ['Bank complaint', t.bank_complaint], ['Penalty (scanned tags)', t.pen_scanned], ['Secugen device charges', t.secugen], ['Unaffixed tag penalty', t.pen_unaffixed]].filter(([, v]) => num(v));
    const totDed = ded.reduce((s, [, v]) => s + Math.abs(num(v)), 0);
    P.section('Earnings & deductions');
    const n = Math.max(earn.length, ded.length, 1);
    const rows = [];
    for (let i = 0; i < n; i++) rows.push([earn[i] ? earn[i][0] : '', earn[i] ? inr(earn[i][1]) : '', ded[i] ? ded[i][0] : '', ded[i] ? inr(Math.abs(num(ded[i][1]))) : '']);
    rows.push(['Gross payout', inr(t.gross), 'Total deductions', inr(totDed)]);
    P.table([{ t: 'Earnings', w: 58 }, { t: 'Amount', w: 35, a: 'r' }, { t: 'Deductions', w: 58 }, { t: 'Amount', w: 35, a: 'r' }], rows, { foot: true, title });
    // ---- net
    const net = num(t.final), open = num(t.opening), withOpen = num(t.final_open) || net + open;
    P.need(30, title);
    let y = P.y;
    P.rect(M, y, W - 2 * M, 24, '#eef4ff', ACC);
    P.text('NET PAYABLE (THIS MONTH)', M + 4, y + 7, { size: 3, w: 800, color: MUTE });
    P.text(inr(net), M + 4, y + 15, { size: 6.2, w: 800, color: NAVY });
    P.text(`Rupees ${words(net)} Only`, M + 4, y + 20.5, { size: 2.7, color: MUTE });
    P.text(`Opening balance: ${inr(open)}`, W - M - 4, y + 9, { size: 3, w: 600, align: 'right' });
    P.text(`Net incl. opening: ${inr(withOpen)}`, W - M - 4, y + 15.5, { size: 3.4, w: 800, align: 'right', color: NAVY });
    P.y = y + 28;
    // ---- payment (FNF)
    P.section('Payment details (FNF)');
    if (f && !isPayee) {
      P.kv([
        ['Paid through', `${d.payeeId} · ${d.payeeName || ''}`], ['Payee payment status', f.remark || '—'],
        ['Amount released to payee', inr(f.releasing)], ['Payment UTR', f.utr || '—']
      ]);
      P.text('Note: Commission for this agent is released to the payee (TL / partner) above, along with the other agents under that payee.', M, P.y, { size: 2.6, color: MUTE }); P.y += 5;
    } else if (f) {
      P.kv([
        ['Payment status', f.remark || '—'], ['Amount released', inr(f.releasing)],
        ['FNF gross payout', inr(f.gross)], ['TDS (FNF)', inr(Math.abs(num(f.tds)))],
        ['GST', inr(f.gst)], ['Final payout (FNF)', inr(f.final)],
        ['Closing balance', inr(f.closing)], ['Payment UTR', f.utr || '—'],
        ['Invoice no.', f.invoice || '—'], ['Advice sent', [f.adviceSent, f.emailOn].filter(Boolean).join(' · ') || '—']
      ]);
    } else P.kv([['Payment status', 'Not available in FNF sheet for this month'], ['', '']]);
    // ---- agent-wise (TL)
    if (isPayee && d.agents.length) {
      if (P.y + 12 + Math.min(d.agents.length + 2, 8) * 5.6 > H - 18) P.newPage(title);   // table ke 2-3 row akele na tootein
      P.section(`Agent-wise breakdown (${d.agents.length} agents)`);
      const L = d.agents.slice().sort((a, b) => num(b.final) - num(a.final));
      P.table([{ t: '#', w: 9, a: 'r' }, { t: 'Agent name', w: 52 }, { t: 'Agent ID', w: 26 }, { t: 'Issued', w: 18, a: 'r' }, { t: 'Payable', w: 18, a: 'r' }, { t: 'Payout', w: 31, a: 'r' }, { t: 'Final', w: 32, a: 'r' }],
        [...L.map((a, i) => [i + 1, a.name, a.agentId, int(a.iss_total), int(a.pay_total), inr(a.po_total), inr(a.final)]), ['', 'Total', '', int(t.iss_total), int(t.pay_total), inr(t.po_total), inr(t.final)]],
        { foot: true, title, rh: 5.6 });
    }
  }
  function drawSummary(P, sel, spec) {
    P.newPage('PAYOUT SUMMARY');
    const d0 = sel[0].data, bank = d0.bank || {};
    P.kv([['Payee name', d0.role === 'payee' ? d0.payeeName : spec.name], ['Payee ID (APN)', d0.payeeId], ['Name as per PAN', bank.panName], ['PAN', bank.pan], ['Bank', bank.bank], ['Account no.', bank.account], ['Months included', String(sel.length)], ['Generated on', `${nowIst()} IST`]]);
    P.section('Month-wise summary');
    let g = 0, td = 0, nt = 0, rl = 0;
    const rows = sel.map((m) => { const t = m.data.totals, f = m.data.fnf; g += num(t.gross); td += Math.abs(num(t.tds)); nt += num(t.final); const own = m.data.role === 'payee'; rl += f && own ? num(f.releasing) : 0; return [m.label, int(t.pay_total), inr(t.gross), inr(Math.abs(num(t.tds))), inr(t.final), f ? (own ? inr(f.releasing) : 'via TL') : '—', f ? (f.remark || '—') : 'Not in FNF', f && f.utr ? f.utr : '']; });
    rows.push(['Total', int(sel.reduce((s, m) => s + num(m.data.totals.pay_total), 0)), inr(g), inr(td), inr(nt), inr(rl), '', '']);
    P.table([{ t: 'Month', w: 27 }, { t: 'Payable tags', w: 20, a: 'r' }, { t: 'Gross', w: 24, a: 'r' }, { t: 'TDS', w: 19, a: 'r' }, { t: 'Net payable', w: 25, a: 'r' }, { t: 'Released', w: 24, a: 'r' }, { t: 'Status', w: 19 }, { t: 'UTR', w: 28 }], rows, { foot: true, title: 'PAYOUT SUMMARY' });
    P.text(`Total net payable for the selected period: ${inr(nt)} (Rupees ${words(nt)} Only)`, M, P.y + 2, { size: 3, w: 700, color: NAVY }); P.y += 6;
  }
  async function download(spec, sel, mode, company) {
    if (!FF.pdf && FF.lazy && FF.lazy.need) await FF.lazy.need('pdf').catch(() => {});
    if (!FF.pdf || !FF.pdf.page) throw new Error('PDF module load nahi hua — page refresh karo');
    const base = String((sel[0].data.role === 'payee' ? sel[0].data.payeeName || sel[0].data.payeeId : spec.name) || 'payslip').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
    const foot = `${company || COMPANY} · Confidential — for the named payee only`;
    if (mode === 'separate') {
      for (const m of sel) {
        const P = pager(company || COMPANY); drawMonth(P, m, spec);
        FF.pdf.download(P.finish(foot), `Payslip_${base}_${m.tab.replace(' ', '')}.pdf`);
        await new Promise((r) => setTimeout(r, 700));
      }
      return;
    }
    const P = pager(company || COMPANY);
    if (sel.length > 1) drawSummary(P, sel, spec);
    sel.forEach((m) => drawMonth(P, m, spec));
    const span = sel.length > 1 ? `${sel[sel.length - 1].tab.replace(' ', '')}-${sel[0].tab.replace(' ', '')}` : sel[0].tab.replace(' ', '');
    FF.pdf.download(P.finish(foot), `Payslip_${base}_${span}.pdf`);
  }

  FF.payslip = { boxHtml, fill, openPicker, download, words, idsOf, refresh, status, getSnap };
})(window.FF);
