/* 🛰️ NPCI Status (v3.125.284) — Cross Channel (Delhivery Tracking ki jagah).
   Tag ID / VRN / Chassis — ek ya hazaaron (paste ya CSV upload) → ApnaPayment verifyNpciStatus (server se).
   Result: table + summary (input type · VRN updated / not updated · NPCI status) · CSV / Excel / PDF. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const COLS = ['BANKID', 'REGNUMBER', 'custId', 'cch', 'commVeh', 'activationDt', 'closeDt', 'ENTITYID', 'tagDetails_cardStage', 'tagDetails_npci_ExcCode', 'npci_ExcCode'];
  const MAX = 5000;   // server job chalata hai, browser 1.5s me naye rows leta hai
  const st = { rows: [], busy: false, stop: false, allTags: false, filter: '', total: 0, job: null };
  const isRetry = (r) => !r.ok && (r.retry || /busy|429|HTML|time out|fetch|fail$/i.test(r.msg || ''));
  const FAIL_LAB = (r) => (isRetry(r) ? 'Check fail — dobara karo' : 'Not found (NPCI me nahi)');

  /** Text / CSV → unique inputs (har cell; header jaise "tag id" chhod do). */
  function splitInputs(t) {
    const out = [], seen = new Set();
    String(t || '').split(/[\r\n,;\t|]+/).forEach((cell) => {
      String(cell).trim().split(/\s+/).forEach((x) => {
        const v = x.replace(/^["']|["']$/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (v.length < 4 || v.length > 30 || /^(TAGID|TAG|VRN|CHASSIS|CHASSISNO|VEHICLE|VEHICLENO|REGNUMBER|SNO|SR|NO)$/.test(v)) return;
        if (!seen.has(v)) { seen.add(v); out.push(v); }
      });
    });
    return out;
  }
  const kindOf = (v) => (/^[0-9A-F]{19,24}$/.test(v) ? 'Tag ID' : (/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(v) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(v) || v.length <= 10) ? 'VRN' : 'Chassis');
  /** VRN par kai records (purane Replaced/Closed bhi) — "primary" = Active, warna jo closed/replaced nahi, warna pehla. */
  function primaryOf(recs) {
    if (!recs || !recs.length) return null;
    return recs.find((d) => d.TAGSTATUS === 'A' || /^active$/i.test(d.npci_ExcCode)) || recs.find((d) => !/closed|replaced|blacklist/i.test(d.npci_ExcCode)) || recs[0];
  }
  /** Chassis / Tag ID diya tha → result REGNUMBER 1-10 akshar = VRN update ho chuka; baaki not updated. */
  const vrnUpdated = (reg) => { const r = String(reg || '').replace(/[^A-Z0-9]/gi, ''); return r.length >= 1 && r.length <= 10; };
  const statusKey = (rec) => (rec ? (rec.npci_ExcCode || rec.tagDetails_npci_ExcCode || 'Blank (NPCI ne status nahi diya)') : 'Not found');
  const tone = (s) => (/^active$/i.test(s) ? 'green' : /low balance/i.test(s) ? 'amber' : /black|hot/i.test(s) ? 'red' : /closed|replaced|dispos|surrender/i.test(s) ? 'gray' : /not found|fail|unregister/i.test(s) ? 'red' : 'violet');

  /** Flat rows (table / exports). allTags=false → har input ki ek (primary) row. */
  function flatRows(all) {
    const out = [];
    st.rows.forEach((r, i) => {
      const prim = primaryOf(r.records);
      const recs = all ? r.records : (prim ? [prim] : []);
      const updCell = r.kind === 'VRN' ? '—' : (prim ? (vrnUpdated(prim.REGNUMBER) ? 'Updated' : 'Not updated') : '—');
      if (!recs.length) out.push({ n: i + 1, input: r.input, kind: r.kind, primary: true, TAGID: '', ...Object.fromEntries(COLS.map((c) => [c, ''])), npci_ExcCode: isRetry(r) ? `Check fail — ${r.msg || ''}` : `Not found — ${r.msg || ''}`, failLab: FAIL_LAB(r), vrnUpd: updCell, failed: true });
      else recs.forEach((d) => out.push({ n: i + 1, input: r.input, kind: r.kind, primary: d === prim, ...d, vrnUpd: updCell }));
    });
    return out;
  }
  function summary() {
    const s = { total: Math.max(st.total, st.rows.length), checked: st.rows.length, kind: { 'Tag ID': 0, VRN: 0, Chassis: 0 }, found: 0, failed: 0, notFound: 0, retry: 0, upd: 0, notUpd: 0, updBase: 0, status: {}, multi: 0, active: 0 };
    st.rows.forEach((r) => {
      s.kind[r.kind] = (s.kind[r.kind] || 0) + 1;
      const prim = primaryOf(r.records);
      if (prim) s.found++; else { s.failed++; if (isRetry(r)) s.retry++; else s.notFound++; }
      if (prim && /^active$/i.test(statusKey(prim))) s.active++;
      if (r.records.length > 1) s.multi++;
      if (r.kind !== 'VRN' && prim) { s.updBase++; if (vrnUpdated(prim.REGNUMBER)) s.upd++; else s.notUpd++; }
      const k = prim ? statusKey(prim) : FAIL_LAB(r);
      s.status[k] = (s.status[k] || 0) + 1;
    });
    return s;
  }

  function css() {
    if (document.getElementById('np-css')) return;
    const el = document.createElement('style'); el.id = 'np-css';
    el.textContent = `.np-hero{display:flex;gap:14px;align-items:center;padding:18px 20px;border-radius:18px;background:linear-gradient(135deg,#1e1b4b,#4338ca 55%,#0ea5e9);color:#fff;margin-bottom:14px}
.np-hero h2{margin:0;font-size:22px;color:#fff!important}.np-hero p{margin:4px 0 0;opacity:.92;font-size:13px;color:#e0e7ff!important}.np-ico{font-size:34px}
.np-in{display:grid;grid-template-columns:2fr 1fr;gap:12px}@media(max-width:820px){.np-in{grid-template-columns:1fr}}
.np-in textarea{width:100%;min-height:150px;font-family:ui-monospace,Menlo,monospace;font-size:13px}
.np-up{border:2px dashed var(--line,#cbd5e1);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px;align-items:flex-start;justify-content:center}
.np-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.np-prog{height:6px;border-radius:99px;background:rgba(99,102,241,.15);overflow:hidden;margin-top:10px}.np-prog i{display:block;height:100%;background:linear-gradient(90deg,#6366f1,#0ea5e9);transition:width .3s}
.np-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}
.np-k{border-radius:14px;padding:12px 14px;color:#fff;cursor:pointer;border:0;text-align:left;font-family:inherit}.np-k b{display:block;font-size:24px;margin-top:2px}.np-k small{opacity:.9}
.np-k.on{outline:3px solid #facc15;outline-offset:2px}
.np-k.c1{background:linear-gradient(135deg,#4338ca,#6366f1)}.np-k.c2{background:linear-gradient(135deg,#0369a1,#0ea5e9)}.np-k.c3{background:linear-gradient(135deg,#7c2d12,#ea580c)}.np-k.c4{background:linear-gradient(135deg,#065f46,#10b981)}.np-k.c5{background:linear-gradient(135deg,#9f1239,#e11d48)}.np-k.c6{background:linear-gradient(135deg,#334155,#64748b)}
.np-chips{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 12px}.np-chip{border:0;border-radius:99px;padding:6px 12px;font-weight:700;cursor:pointer;font-family:inherit}
.np-chip.green{background:#dcfce7;color:#166534}.np-chip.amber{background:#fef3c7;color:#92400e}.np-chip.red{background:#fee2e2;color:#991b1b}.np-chip.gray{background:#e2e8f0;color:#334155}.np-chip.violet{background:#ede9fe;color:#5b21b6}.np-chip.on{outline:2px solid #4338ca}
.np-scroll{overflow:auto;max-height:65vh;border:1px solid var(--line,#e2e8f0);border-radius:12px}
.np-tbl{border-collapse:collapse;width:100%;font-size:12.5px;white-space:nowrap}.np-tbl th{position:sticky;top:0;background:#1e293b;color:#fff;padding:8px;text-align:left;z-index:1}.np-tbl td{padding:6px 8px;border-bottom:1px solid var(--line,#eef2f7)}
.np-tbl tr.old td{opacity:.6}.np-tbl tr.bad td{background:rgba(239,68,68,.07)}
.np-pill{display:inline-block;border-radius:99px;padding:2px 9px;font-weight:700;font-size:11.5px}.np-pill.green{background:#dcfce7;color:#166534}.np-pill.amber{background:#fef3c7;color:#92400e}.np-pill.red{background:#fee2e2;color:#991b1b}.np-pill.gray{background:#e2e8f0;color:#334155}.np-pill.violet{background:#ede9fe;color:#5b21b6}
.np-upd{color:#15803d;font-weight:800}.np-nupd{color:#b91c1c;font-weight:800}.np-err{color:#b91c1c}`;
    document.head.appendChild(el);
  }

  function resultHtml() {
    if (!st.rows.length) return '<p class="dim small">Upar Tag ID / VRN / Chassis daal kar <b>Check</b> dabao (ya CSV upload karo). Ek saath ' + MAX + ' tak.</p>';
    const s = summary();
    const k = (cls, key, lab, val, sub) => `<button type="button" class="np-k ${cls}${st.filter === key ? ' on' : ''}" data-np-f="${esc(key)}">${esc(lab)}<b>${U.fmt(val)}</b>${sub ? `<small>${sub}</small>` : ''}</button>`;
    const pctOf = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
    const cards = `<div class="np-sum">
      ${k('c1', '', 'Total input', s.total, `${st.busy ? `⏳ ${U.fmt(s.checked)} check hue · ${U.fmt(s.total - s.checked)} baaki · ` : ''}Tag ID ${s.kind['Tag ID']} · VRN ${s.kind.VRN} · Chassis ${s.kind.Chassis}`)}
      ${k('c2', 'found', 'NPCI me mile', s.found, `Active ${U.fmt(s.active)}${s.multi ? ` · ${s.multi} VRN par kai tags` : ''}`)}
      ${k('c4', 'upd', 'VRN updated', s.upd, `Tag ID / Chassis me se · ${pctOf(s.upd, s.updBase)}`)}
      ${k('c3', 'notupd', 'VRN not updated', s.notUpd, `REGNUMBER 10 akshar se lamba (chassis hi) · ${pctOf(s.notUpd, s.updBase)}`)}
      ${k('c5', 'fail', 'Not found / fail', s.failed, `NPCI me nahi ${U.fmt(s.notFound)}${s.retry ? ` · check fail ${U.fmt(s.retry)}` : ''}`)}</div>
      ${s.retry && !st.busy ? `<div class="np-acts" style="margin:0 0 10px"><button type="button" class="btn primary" data-np-retry>↻ ${U.fmt(s.retry)} fail wale dobara check karo</button><span class="dim small">API ne "busy" bola tha — ab dheere dobara jayenge</span></div>` : ''}`;
    const chips = `<div class="np-chips"><b class="small" style="align-self:center">NPCI status:</b>${Object.entries(s.status).sort((a, b) => b[1] - a[1]).map(([lab, n]) => `<button type="button" class="np-chip ${tone(lab)}${st.filter === `st:${lab}` ? ' on' : ''}" data-np-f="st:${esc(lab)}">${esc(lab)} <b>${U.fmt(n)}</b></button>`).join('')}</div>`;
    const rows = filtered(flatRows(st.allTags));
    const cap = st.busy ? 300 : 3000;   // chalte waqt halka table (har 1.5s re-render), khatam hone par 3000
    const body = rows.slice(0, cap).map((r) => {
      const stx = r.npci_ExcCode || '';
      return `<tr class="${r.failed ? 'bad' : r.primary ? '' : 'old'}"><td class="dim">${r.n}</td><td><b>${esc(r.input)}</b></td><td>${esc(r.kind)}</td><td>${esc(r.TAGID || '')}</td>${COLS.map((c) => (c === 'npci_ExcCode' || c === 'tagDetails_npci_ExcCode') && r[c] ? `<td><span class="np-pill ${tone(r[c])}">${esc(r[c])}</span></td>` : `<td${r.failed && c === 'npci_ExcCode' ? ' class="np-err"' : ''}>${esc(r[c] || '')}</td>`).join('')}<td class="${r.vrnUpd === 'Updated' ? 'np-upd' : r.vrnUpd === 'Not updated' ? 'np-nupd' : 'dim'}">${esc(r.vrnUpd)}</td></tr>`;
    }).join('');
    return `${cards}${chips}
      <div class="np-acts" style="margin:0 0 8px">${s.multi ? `<label class="small" title="Gaadi number (VRN) daalne par NPCI us gaadi par ab tak lage SAARE tags bhejta hai — purane Replaced/Closed bhi. Default me sirf abhi wala (Active) tag dikhta hai."><input type="checkbox" data-np-all${st.allTags ? ' checked' : ''}> VRN wali gaadi ke purane tags bhi dikhao (${s.multi} VRN par 1 se zyada tag mile)</label>` : ''}
        <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn small" data-np-dl="csv">⬇ CSV</button><button type="button" class="btn small" data-np-dl="xlsx">📊 Excel</button><button type="button" class="btn small" data-np-dl="pdf">📄 PDF</button></span></div>
      <p class="dim small" style="margin:0 0 6px">${U.fmt(rows.length)} rows${st.filter ? ' (filter laga hai — card / chip dobara dabao to hatega)' : ''}${rows.length > cap ? ` · table me pehli ${U.fmt(cap)}, poora download me` : ''}</p>
      <div class="np-scroll"><table class="np-tbl"><thead><tr><th>#</th><th>Input</th><th>Input type</th><th>TAGID</th>${COLS.map((c) => `<th>${esc(c)}</th>`).join('')}<th>VRN update</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function filtered(rows) {
    const f = st.filter;
    if (!f) return rows;
    if (f === 'found') return rows.filter((r) => !r.failed);
    if (f === 'fail') return rows.filter((r) => r.failed);
    if (f === 'upd') return rows.filter((r) => r.vrnUpd === 'Updated');
    if (f === 'notupd') return rows.filter((r) => r.vrnUpd === 'Not updated');
    if (f === 'retry') return rows.filter((r) => r.failed && r.failLab === 'Check fail — dobara karo');
    if (f.startsWith('st:')) { const want = f.slice(3); return rows.filter((r) => (r.failed ? r.failLab : (r.npci_ExcCode || r.tagDetails_npci_ExcCode || 'Blank (NPCI ne status nahi diya)')) === want); }
    return rows;
  }

  // ---------------------------------------------------------------- exports
  const HEAD = ['Input', 'Input type', 'TAGID', ...COLS, 'VRN update'];
  const rowArr = (r) => [r.input, r.kind, r.TAGID || '', ...COLS.map((c) => r[c] || ''), r.vrnUpd];
  const fname = () => `NPCI Status - ${U.dateKey(new Date())}${st.filter ? ` - ${st.filter.replace(/^st:/, '')}` : ''}`;
  function summaryRows() {
    const s = summary();
    const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '');
    const out = [
      ['Input', 'Total input', s.total, ''], ['Input', 'Check ho gaye', s.checked, pct(s.checked, s.total)], ...(s.total > s.checked ? [['Input', 'Baaki (check nahi hue)', s.total - s.checked, pct(s.total - s.checked, s.total)]] : []),
      ['Input', 'Tag ID input', s.kind['Tag ID'], ''], ['Input', 'VRN input', s.kind.VRN, ''], ['Input', 'Chassis input', s.kind.Chassis, ''],
      ['Result', 'NPCI me mile', s.found, pct(s.found, s.checked)], ['Result', 'NPCI me nahi mile', s.notFound, pct(s.notFound, s.checked)], ...(s.retry ? [['Result', 'Check fail (dobara karo)', s.retry, pct(s.retry, s.checked)]] : []),
      ['VRN update (Tag ID / Chassis input)', 'VRN updated (REGNUMBER 1-10 akshar)', s.upd, pct(s.upd, s.updBase)], ['VRN update (Tag ID / Chassis input)', 'VRN not updated', s.notUpd, pct(s.notUpd, s.updBase)],
      ['NPCI status', 'Active', s.active, pct(s.active, s.checked)]
    ];
    Object.entries(s.status).filter(([k]) => !/^active$/i.test(k)).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => out.push(['NPCI status', k, n, pct(n, s.checked)]));
    return out;
  }
  async function download(kind, btn) {
    const rows = filtered(flatRows(st.allTags));
    if (!rows.length) return;
    if (kind === 'csv') { U.downloadCsv(`${fname()}.csv`, HEAD, rows.map(rowArr)); return; }
    if (kind === 'xlsx') {
      if (!FF.xlsx && FF.lazy && FF.lazy.inject) { try { await FF.lazy.inject('xlsx'); } catch { /* */ } }
      if (!FF.xlsx) { U.toast && U.toast('Excel module load nahi hua', 'err'); return; }
      FF.xlsx.download(fname(), [{ name: 'Summary', header: ['Section', 'Item', 'Count', '%'], rows: summaryRows() }, { name: 'NPCI Results', header: HEAD, rows: rows.map(rowArr) }]);
      return;
    }
    try {
      if (btn) btn.disabled = true;
      if (!FF.pdf && FF.lazy && FF.lazy.need) await FF.lazy.need('pdf');
      if (!FF.pdf || !FF.pdf.doc) throw new Error('PDF module load nahi hua');
      const s = summary();
      const doc = FF.pdf.doc({ title: 'NPCI Status', subtitle: `${U.fmt(s.total)} input · ${new Date().toLocaleString('en-IN')}`, right: 'ApnaPayment' });
      doc.kpis([{ label: 'Total input', value: U.fmt(s.total), sub: `Tag ${s.kind['Tag ID']} · VRN ${s.kind.VRN} · Chassis ${s.kind.Chassis}` }, { label: 'NPCI me mile', value: U.fmt(s.found) },
        { label: 'VRN updated', value: U.fmt(s.upd), sub: 'Tag ID / Chassis input' }, { label: 'VRN not updated', value: U.fmt(s.notUpd) }, { label: 'Not found / fail', value: U.fmt(s.failed) }], 5);
      doc.section('NPCI status summary', '');
      doc.table([{ h: 'NPCI status', w: 3 }, { h: 'Count', w: 1, align: 'right' }], Object.entries(s.status).sort((a, b) => b[1] - a[1]).map(([k2, n]) => [k2, U.fmt(n)]), { headColor: '#4338ca' });
      const MAXP = 1500;
      doc.section('Results', `${U.fmt(rows.length)} rows${rows.length > MAXP ? ` · PDF me pehli ${MAXP} (poora CSV / Excel me)` : ''}`);
      doc.table([{ h: 'Input', w: 2.4 }, { h: 'Type', w: 0.9 }, { h: 'REGNUMBER', w: 1.6 }, { h: 'cch', w: 0.6 }, { h: 'Activation', w: 1.1 }, { h: 'Close', w: 1 }, { h: 'Card stage', w: 1.2 }, { h: 'npci_ExcCode', w: 1.4 }, { h: 'VRN', w: 1 }],
        rows.slice(0, MAXP).map((r) => [r.input, r.kind, r.REGNUMBER || '', r.cch || '', r.activationDt || '', r.closeDt || '', r.tagDetails_cardStage || '', r.npci_ExcCode || '', r.vrnUpd]), { headColor: '#1e293b' });
      FF.pdf.download(doc.finish(), `${fname()}.pdf`);
    } catch (err) { U.toast && U.toast(err.message || 'PDF nahi bana', 'err'); } finally { if (btn) btn.disabled = false; }
  }

  // ---------------------------------------------------------------- run
  async function run(root, items, opts = {}) {
    const out = root.querySelector('[data-np-out]'), prog = root.querySelector('[data-np-prog]'), lab = root.querySelector('[data-np-plab]');
    if (!items.length) { out.innerHTML = '<p class="np-err">Tag ID / VRN / Chassis daalo.</p>'; return; }
    if (items.length > MAX) { items = items.slice(0, MAX); U.toast && U.toast(`Pehle ${MAX} hi check honge`, 'warn'); }
    const again = !!opts.retry;
    st.busy = true; st.stop = false; st.filter = ''; st.job = null;
    if (!again) { st.rows = []; st.total = items.length; }
    const go = root.querySelector('[data-np-go]'); if (go) go.disabled = true;
    const stopB = root.querySelector('[data-np-stop]'); if (stopB) { stopB.hidden = false; stopB.disabled = false; stopB.textContent = '⏹ Ruko'; }
    prog.hidden = false;
    if (out && !again) out.innerHTML = resultHtml();
    const put = (r) => { const row = { ...r, records: r.records || [] }; const at = again ? st.rows.findIndex((x) => x.input === row.input) : -1; if (at >= 0) st.rows[at] = row; else st.rows.push(row); };
    const t0 = Date.now();
    const label = (n, done) => {
      const s0 = summary(); const sec = (Date.now() - t0) / 1000; const rate = n && sec ? n / sec : 0;
      const eta = !done && rate ? Math.round((items.length - n) / rate) : 0;
      lab.textContent = `${done ? (st.stop ? '⏹ Ruk gaya' : '✅ Ho gaya') : '⏳'} ${U.fmt(n)} / ${U.fmt(items.length)} check hue · ✅ ${U.fmt(s0.found)} mile · ❌ ${U.fmt(s0.notFound)} nahi mile${s0.retry ? ` · ⚠ ${U.fmt(s0.retry)} fail` : ''}${eta ? ` · ~${eta >= 60 ? `${Math.round(eta / 60)} min` : `${eta}s`} baaki` : ''}${done ? '' : ' — beech me bhi download kar sakte ho'}`;
      prog.querySelector('i').style.width = `${Math.round((n / items.length) * 100)}%`;
    };
    label(0, false);
    let got = 0, err = '';
    try {
      const j = await FF.auth.api('/api/npci/job', 'POST', { items });
      st.job = j.id;
      let fails = 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, got ? 1500 : 800));
        let d;
        try { d = await FF.auth.api(`/api/npci/job/${j.id}?from=${got}`); fails = 0; } catch (e) { if (e && e.status === 404) throw e; if (++fails > 6) throw e; continue; }
        (d.rows || []).forEach(put); got += (d.rows || []).length;
        label(got, false);
        if (root.isConnected) out.innerHTML = resultHtml();
        if (d.done) break;
      }
    } catch (e) { err = (e && e.message) || 'Fail'; }
    // jo check nahi hue (stop / error) — "dobara" ke liye fail rows
    if (err) {
      const seen = new Set(st.rows.filter((r) => !isRetry(r)).map((r) => r.input));
      items.filter((x) => !seen.has(x)).forEach((x) => put({ input: x, kind: kindOf(x), ok: false, retry: true, msg: err, records: [] }));
      U.toast && U.toast(`NPCI: ${err}`, 'warn');
    }
    st.busy = false; st.job = null; if (go) go.disabled = false; if (stopB) stopB.hidden = true;
    label(got, true);
    hSave((Date.now() - t0) / 1000, again);
    if (root.isConnected) { out.innerHTML = resultHtml(); const hh = root.querySelector('[data-np-hist]'); if (hh) hh.innerHTML = histHtml(); }
  }

  // 🕘 v3.125.295 — pichhli 3 checks ki history (is browser me): kitne input the, kya status nikla, kitna time laga.
  const HKEY = 'ff.npci.hist.v1';
  const hLoad = () => { try { const a = JSON.parse(localStorage.getItem(HKEY) || '[]'); return Array.isArray(a) ? a.slice(0, 3) : []; } catch { return []; } };
  function hSave(sec, replace) {
    try {
      const s = summary(); if (!s.checked) return;
      const e = { at: Date.now(), total: s.total, checked: s.checked, sec: Math.round(sec), found: s.found, notFound: s.notFound, retry: s.retry, upd: s.upd, notUpd: s.notUpd, updBase: s.updBase, active: s.active, kind: s.kind, status: s.status };
      let a = hLoad(); if (replace && a.length) a[0] = { ...e, sec: a[0].sec + e.sec }; else a.unshift(e);
      localStorage.setItem(HKEY, JSON.stringify(a.slice(0, 3)));
    } catch { /* storage band ho sakta hai */ }
  }
  function histHtml() {
    const a = hLoad(); if (!a.length) return '';
    const when = (t) => new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const dur = (x) => (x >= 60 ? `${Math.floor(x / 60)}m ${x % 60}s` : `${x}s`);
    const top = (o) => Object.entries(o || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<span class="np-pill gray" style="margin:1px 3px 1px 0">${U.esc(k)} <b>${U.fmt(n)}</b></span>`).join('');
    return `<section class="card"><div class="card-body"><b>🕘 Pichhli ${a.length} checks</b> <span class="dim small">(is browser me save)</span>
      <div class="np-scroll" style="margin-top:8px;max-height:none"><table class="np-tbl"><thead><tr><th>Kab</th><th>Input</th><th>Check hue</th><th>Time</th><th>NPCI me mile</th><th>Nahi mile</th><th>VRN updated</th><th>Not updated</th><th>Status</th></tr></thead><tbody>${a.map((h) => `<tr><td>${when(h.at)}</td><td><b>${U.fmt(h.total)}</b><br><span class="dim small">Tag ${U.fmt(h.kind['Tag ID'] || 0)} · VRN ${U.fmt(h.kind.VRN || 0)} · Chassis ${U.fmt(h.kind.Chassis || 0)}</span></td><td>${U.fmt(h.checked)}</td><td>${dur(h.sec)}</td><td>${U.fmt(h.found)}</td><td>${U.fmt(h.notFound)}${h.retry ? ` · ⚠ ${U.fmt(h.retry)} fail` : ''}</td><td class="np-upd">${U.fmt(h.upd)}</td><td class="np-nupd">${U.fmt(h.notUpd)}</td><td style="white-space:normal;min-width:260px">${top(h.status)}</td></tr>`).join('')}</tbody></table></div></div></section>`;
  }
  function render(root) {
    css();
    root.innerHTML = `<div class="np-page">
      <div class="np-hero"><div class="np-ico">🛰️</div><div><h2>NPCI Status</h2><p>Tag ID · VRN · Chassis — ek ya bahut saare ek saath. NPCI ka live status, VRN update check aur summary · CSV / Excel / PDF.</p></div></div>
      <section class="card"><div class="card-body">
        <div class="np-in">
          <div><label class="small"><b>Tag ID / VRN / Chassis</b> — har line me ek (comma / space bhi chalega)</label>
            <textarea class="input" data-np-ta placeholder="34161FA820328EE84D7F6D40&#10;MH14EY3466&#10;MA1RV2TUKT6H20555"></textarea>
            <div class="np-acts"><button type="button" class="btn primary" data-np-go>🔍 Check</button><button type="button" class="btn" data-np-stop hidden>⏹ Ruko</button><button type="button" class="btn" data-np-clear>🧹 Clear</button><span class="dim small" data-np-count></span></div></div>
          <div class="np-up"><b>📄 CSV upload</b><span class="dim small">CSV / TXT — kisi bhi column me Tag ID / VRN / Chassis (header apne aap chhoot jaata hai)</span>
            <label class="btn">⬆ File chuno<input type="file" accept=".csv,.txt,text/csv,text/plain" data-np-file hidden></label><span class="dim small" data-np-fname></span></div>
        </div>
        <div class="np-prog" data-np-prog hidden><i style="width:0"></i></div><small class="dim" data-np-plab></small>
        <p class="dim small" style="margin:8px 0 0">Tag ID = 19-24 akshar (34161F…) · VRN = 10 akshar tak · baaki = Chassis. <b>VRN update</b>: Tag ID / Chassis diya ho aur NPCI ka REGNUMBER 1-10 akshar ka ho = <b>Updated</b>, warna <b>Not updated</b>.</p>
      </div></section>
      <section class="card"><div class="card-body" data-np-out>${resultHtml()}</div></section><div data-np-hist>${histHtml()}</div></div>`;
    const ta = root.querySelector('[data-np-ta]'), cnt = root.querySelector('[data-np-count]');
    const recount = () => { const n = splitInputs(ta.value).length; cnt.textContent = n ? `${U.fmt(n)} unique` : ''; };
    ta.addEventListener('input', recount);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(root, splitInputs(ta.value)); } });
    root.querySelector('[data-np-file]').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const txt = await f.text();
      const items = splitInputs(txt);
      root.querySelector('[data-np-fname]').textContent = `${f.name} · ${U.fmt(items.length)} unique`;
      ta.value = items.join('\n'); recount();
      e.target.value = '';
      run(root, items);
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-np-go]')) { run(root, splitInputs(ta.value)); return; }
      if (e.target.closest('[data-np-stop]')) { st.stop = true; const b = e.target.closest('[data-np-stop]'); b.disabled = true; b.textContent = '⏹ Ruk raha…'; if (st.job) FF.auth.api(`/api/npci/job/${st.job}/stop`, 'POST', {}).catch(() => {}); return; }
      if (e.target.closest('[data-np-retry]')) { if (!st.busy) run(root, st.rows.filter(isRetry).map((r) => r.input), { retry: true }); return; }
      if (e.target.closest('[data-np-clear]')) { ta.value = ''; st.rows = []; st.filter = ''; recount(); root.querySelector('[data-np-out]').innerHTML = resultHtml(); return; }
      const f = e.target.closest('[data-np-f]');
      if (f) { const k = f.dataset.npF; st.filter = st.filter === k ? '' : k; root.querySelector('[data-np-out]').innerHTML = resultHtml(); return; }
      const dl = e.target.closest('[data-np-dl]'); if (dl) { download(dl.dataset.npDl, dl); return; }
    });
    root.addEventListener('change', (e) => { if (e.target.matches('[data-np-all]')) { st.allTags = e.target.checked; root.querySelector('[data-np-out]').innerHTML = resultHtml(); } });
  }

  FF.pages.npciStatus = { title: 'NPCI Status', render, _test: { splitInputs, kindOf, primaryOf, vrnUpdated, flatRows, summary, st } };
})(window.FF);
