/* 🛰️ NPCI Status (v3.125.284) — Cross Channel (Delhivery Tracking ki jagah).
   Tag ID / VRN / Chassis — ek ya hazaaron (paste ya CSV upload) → ApnaPayment verifyNpciStatus (server se).
   Result: table + summary (input type · VRN updated / not updated · NPCI status) · CSV / Excel / PDF. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const COLS = ['BANKID', 'REGNUMBER', 'custId', 'cch', 'commVeh', 'activationDt', 'closeDt', 'ENTITYID', 'tagDetails_cardStage', 'tagDetails_npci_ExcCode', 'npci_ExcCode'];
  const CHUNK = 40, MAX = 5000;
  const st = { rows: [], busy: false, stop: false, allTags: false, filter: '' };

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
  const statusKey = (rec) => (rec ? (rec.npci_ExcCode || rec.tagDetails_npci_ExcCode || '—') : 'Not found');
  const tone = (s) => (/^active$/i.test(s) ? 'green' : /low balance/i.test(s) ? 'amber' : /black|hot/i.test(s) ? 'red' : /closed|replaced|dispos|surrender/i.test(s) ? 'gray' : /not found|fail|unregister/i.test(s) ? 'red' : 'violet');

  /** Flat rows (table / exports). allTags=false → har input ki ek (primary) row. */
  function flatRows(all) {
    const out = [];
    st.rows.forEach((r, i) => {
      const prim = primaryOf(r.records);
      const recs = all ? r.records : (prim ? [prim] : []);
      const updCell = r.kind === 'VRN' ? '—' : (prim ? (vrnUpdated(prim.REGNUMBER) ? 'Updated' : 'Not updated') : '—');
      if (!recs.length) out.push({ n: i + 1, input: r.input, kind: r.kind, primary: true, TAGID: '', ...Object.fromEntries(COLS.map((c) => [c, ''])), npci_ExcCode: r.ok ? '' : (r.msg || 'Not found'), vrnUpd: updCell, failed: true });
      else recs.forEach((d) => out.push({ n: i + 1, input: r.input, kind: r.kind, primary: d === prim, ...d, vrnUpd: updCell }));
    });
    return out;
  }
  function summary() {
    const s = { total: st.rows.length, kind: { 'Tag ID': 0, VRN: 0, Chassis: 0 }, found: 0, failed: 0, upd: 0, notUpd: 0, updBase: 0, status: {}, multi: 0 };
    st.rows.forEach((r) => {
      s.kind[r.kind] = (s.kind[r.kind] || 0) + 1;
      const prim = primaryOf(r.records);
      if (prim) s.found++; else s.failed++;
      if (r.records.length > 1) s.multi++;
      if (r.kind !== 'VRN' && prim) { s.updBase++; if (vrnUpdated(prim.REGNUMBER)) s.upd++; else s.notUpd++; }
      const k = prim ? statusKey(prim) : 'Not found / fail';
      s.status[k] = (s.status[k] || 0) + 1;
    });
    return s;
  }

  function css() {
    if (document.getElementById('np-css')) return;
    const el = document.createElement('style'); el.id = 'np-css';
    el.textContent = `.np-hero{display:flex;gap:14px;align-items:center;padding:18px 20px;border-radius:18px;background:linear-gradient(135deg,#1e1b4b,#4338ca 55%,#0ea5e9);color:#fff;margin-bottom:14px}
.np-hero h2{margin:0;font-size:22px}.np-hero p{margin:4px 0 0;opacity:.9;font-size:13px}.np-ico{font-size:34px}
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
      ${k('c1', '', 'Total input', s.total, `Tag ID ${s.kind['Tag ID']} · VRN ${s.kind.VRN} · Chassis ${s.kind.Chassis}`)}
      ${k('c2', 'found', 'NPCI me mile', s.found, `${s.multi} VRN par kai tags`)}
      ${k('c4', 'upd', 'VRN updated', s.upd, `Tag ID / Chassis me se · ${pctOf(s.upd, s.updBase)}`)}
      ${k('c3', 'notupd', 'VRN not updated', s.notUpd, `REGNUMBER 10 akshar se lamba (chassis hi) · ${pctOf(s.notUpd, s.updBase)}`)}
      ${k('c5', 'fail', 'Not found / fail', s.failed, '')}</div>`;
    const chips = `<div class="np-chips"><b class="small" style="align-self:center">NPCI status:</b>${Object.entries(s.status).sort((a, b) => b[1] - a[1]).map(([lab, n]) => `<button type="button" class="np-chip ${tone(lab)}${st.filter === `st:${lab}` ? ' on' : ''}" data-np-f="st:${esc(lab)}">${esc(lab)} <b>${U.fmt(n)}</b></button>`).join('')}</div>`;
    const rows = filtered(flatRows(st.allTags));
    const body = rows.slice(0, 3000).map((r) => {
      const stx = r.npci_ExcCode || '';
      return `<tr class="${r.failed ? 'bad' : r.primary ? '' : 'old'}"><td class="dim">${r.n}</td><td><b>${esc(r.input)}</b></td><td>${esc(r.kind)}</td><td>${esc(r.TAGID || '')}</td>${COLS.map((c) => (c === 'npci_ExcCode' || c === 'tagDetails_npci_ExcCode') && r[c] ? `<td><span class="np-pill ${tone(r[c])}">${esc(r[c])}</span></td>` : `<td${r.failed && c === 'npci_ExcCode' ? ' class="np-err"' : ''}>${esc(r[c] || '')}</td>`).join('')}<td class="${r.vrnUpd === 'Updated' ? 'np-upd' : r.vrnUpd === 'Not updated' ? 'np-nupd' : 'dim'}">${esc(r.vrnUpd)}</td></tr>`;
    }).join('');
    return `${cards}${chips}
      <div class="np-acts" style="margin:0 0 8px"><label class="small"><input type="checkbox" data-np-all${st.allTags ? ' checked' : ''}> VRN ke saare tags dikhao (purane Replaced/Closed bhi)</label>
        <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn small" data-np-dl="csv">⬇ CSV</button><button type="button" class="btn small" data-np-dl="xlsx">📊 Excel</button><button type="button" class="btn small" data-np-dl="pdf">📄 PDF</button></span></div>
      <p class="dim small" style="margin:0 0 6px">${U.fmt(rows.length)} rows${st.filter ? ' (filter laga hai — card / chip dobara dabao to hatega)' : ''}${rows.length > 3000 ? ' · table me pehli 3000, poora download me' : ''}</p>
      <div class="np-scroll"><table class="np-tbl"><thead><tr><th>#</th><th>Input</th><th>Input type</th><th>TAGID</th>${COLS.map((c) => `<th>${esc(c)}</th>`).join('')}<th>VRN update</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function filtered(rows) {
    const f = st.filter;
    if (!f) return rows;
    if (f === 'found') return rows.filter((r) => !r.failed);
    if (f === 'fail') return rows.filter((r) => r.failed);
    if (f === 'upd') return rows.filter((r) => r.vrnUpd === 'Updated');
    if (f === 'notupd') return rows.filter((r) => r.vrnUpd === 'Not updated');
    if (f.startsWith('st:')) { const want = f.slice(3); return rows.filter((r) => (r.failed ? 'Not found / fail' : (r.npci_ExcCode || r.tagDetails_npci_ExcCode || '—')) === want); }
    return rows;
  }

  // ---------------------------------------------------------------- exports
  const HEAD = ['Input', 'Input type', 'TAGID', ...COLS, 'VRN update'];
  const rowArr = (r) => [r.input, r.kind, r.TAGID || '', ...COLS.map((c) => r[c] || ''), r.vrnUpd];
  const fname = () => `NPCI Status - ${U.dateKey(new Date())}${st.filter ? ` - ${st.filter.replace(/^st:/, '')}` : ''}`;
  function summaryRows() {
    const s = summary();
    const out = [['Total input', s.total], ['Tag ID input', s.kind['Tag ID']], ['VRN input', s.kind.VRN], ['Chassis input', s.kind.Chassis], ['NPCI me mile', s.found], ['Not found / fail', s.failed],
      ['— VRN update (sirf Tag ID / Chassis input) —', ''], ['VRN updated (REGNUMBER 1-10 akshar)', s.upd], ['VRN not updated', s.notUpd], ['— NPCI status —', '']];
    Object.entries(s.status).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => out.push([k, n]));
    return out;
  }
  async function download(kind, btn) {
    const rows = filtered(flatRows(st.allTags));
    if (!rows.length) return;
    if (kind === 'csv') { U.downloadCsv(`${fname()}.csv`, HEAD, rows.map(rowArr)); return; }
    if (kind === 'xlsx') {
      if (!FF.xlsx && FF.lazy && FF.lazy.inject) { try { await FF.lazy.inject('xlsx'); } catch { /* */ } }
      if (!FF.xlsx) { U.toast && U.toast('Excel module load nahi hua', 'err'); return; }
      FF.xlsx.download(fname(), [{ name: 'Summary', header: ['Item', 'Count'], rows: summaryRows() }, { name: 'NPCI Results', header: HEAD, rows: rows.map(rowArr) }]);
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
  async function run(root, items) {
    const out = root.querySelector('[data-np-out]'), prog = root.querySelector('[data-np-prog]'), lab = root.querySelector('[data-np-plab]');
    if (!items.length) { out.innerHTML = '<p class="np-err">Tag ID / VRN / Chassis daalo.</p>'; return; }
    if (items.length > MAX) { items = items.slice(0, MAX); U.toast && U.toast(`Pehle ${MAX} hi check honge`, 'warn'); }
    st.busy = true; st.stop = false; st.rows = []; st.filter = '';
    const go = root.querySelector('[data-np-go]'); if (go) go.disabled = true;
    const stopB = root.querySelector('[data-np-stop]'); if (stopB) stopB.hidden = false;
    prog.hidden = false;
    for (let i = 0; i < items.length && !st.stop; i += CHUNK) {
      const part = items.slice(i, i + CHUNK);
      lab.textContent = `${U.fmt(Math.min(i + part.length, items.length))} / ${U.fmt(items.length)} check ho rahe hain…`;
      prog.querySelector('i').style.width = `${Math.round((i / items.length) * 100)}%`;
      let d = null;
      for (let a = 0; a < 3 && !d; a++) {
        try { d = await FF.auth.api('/api/npci/check', 'POST', { items: part }); } catch (err) { if (a === 2) { part.forEach((x) => st.rows.push({ input: x, kind: kindOf(x), ok: false, msg: err.message || 'Fail', records: [] })); } else await new Promise((r) => setTimeout(r, 1500 * (a + 1))); }
      }
      if (d && d.rows) d.rows.forEach((r) => st.rows.push({ ...r, records: r.records || [] }));
      if (root.isConnected) out.innerHTML = resultHtml();
    }
    prog.querySelector('i').style.width = '100%';
    lab.textContent = st.stop ? `Ruk gaya — ${U.fmt(st.rows.length)} check hue` : `✅ ${U.fmt(st.rows.length)} check ho gaye`;
    st.busy = false; if (go) go.disabled = false; if (stopB) stopB.hidden = true;
    if (root.isConnected) out.innerHTML = resultHtml();
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
      <section class="card"><div class="card-body" data-np-out>${resultHtml()}</div></section></div>`;
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
      if (e.target.closest('[data-np-stop]')) { st.stop = true; return; }
      if (e.target.closest('[data-np-clear]')) { ta.value = ''; st.rows = []; st.filter = ''; recount(); root.querySelector('[data-np-out]').innerHTML = resultHtml(); return; }
      const f = e.target.closest('[data-np-f]');
      if (f) { const k = f.dataset.npF; st.filter = st.filter === k ? '' : k; root.querySelector('[data-np-out]').innerHTML = resultHtml(); return; }
      const dl = e.target.closest('[data-np-dl]'); if (dl) { download(dl.dataset.npDl, dl); return; }
    });
    root.addEventListener('change', (e) => { if (e.target.matches('[data-np-all]')) { st.allTags = e.target.checked; root.querySelector('[data-np-out]').innerHTML = resultHtml(); } });
  }

  FF.pages.npciStatus = { title: 'NPCI Status', render, _test: { splitInputs, kindOf, primaryOf, vrnUpdated, flatRows, summary, st } };
})(window.FF);
