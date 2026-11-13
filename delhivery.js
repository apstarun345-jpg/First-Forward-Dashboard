/* 🚚 Delhivery Tracking (v3.125.258) — Cross Channel.
   1) 📍 Pincode serviceability — ek ya kai pincode (comma / space / new line), turant: Delivery / COD / Prepaid / Pickup / ODA.
   2) 📦 AWB status — ek ya kai AWB, turant: latest status, location, date, expected delivery + scan timeline.
   Delhivery API token sirf server par (Settings → admin); browser ko kabhi nahi milta. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const st = { pin: { rows: [], busy: false }, awb: { rows: [], busy: false, open: new Set() }, cfg: null };

  const splitPins = (t) => [...new Set(String(t || '').split(/[^0-9]+/).filter((x) => /^\d{6}$/.test(x)))];
  const splitAwbs = (t) => [...new Set(String(t || '').toUpperCase().split(/[\s,;]+/).filter((x) => /^[A-Z0-9]{6,20}$/.test(x)))];
  const yes = (v, t, f) => (v ? `<span class="dl-yes">✔ ${t || 'Yes'}</span>` : `<span class="dl-no">✘ ${f || 'No'}</span>`);
  function statusTone(r) {
    const s = `${r.status} ${r.statusType}`.toLowerCase();
    if (r.notFound) return ['gray', 'Not found'];
    if (/deliver/.test(s) && !/undeliver|not deliver/.test(s)) return ['green', r.status];
    if (/rto|return/.test(s)) return ['orange', r.status];
    if (/undeliver|lost|damage|cancel|fail/.test(s)) return ['red', r.status];
    if (/out for delivery|dispatched/.test(s)) return ['violet', r.status];
    if (/transit|pick|manifest|pending|booked|received/.test(s)) return ['blue', r.status];
    return ['gray', r.status || '—'];
  }
  const fmtDt = (v) => {
    if (!v) return '';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  // ---------------------------------------------------------------- pincode
  function pinTable() {
    const rows = st.pin.rows;
    if (!rows.length) return '<p class="dim small">Pincode daal kar <b>Check</b> dabao (ya Enter) — ek saath 300 tak.</p>';
    const ok = rows.filter((r) => r.serviceable).length;
    return `<div class="dl-sum"><span class="dl-chip green">✔ Serviceable <b>${ok}</b></span><span class="dl-chip red">✘ Not serviceable <b>${rows.length - ok}</b></span><span class="dl-chip violet">ODA <b>${rows.filter((r) => r.oda).length}</b></span><button type="button" class="btn sm" data-dl-csv="pin">⬇ CSV</button></div>
    <div class="dl-scroll"><table class="dl-tbl"><thead><tr><th>#</th><th>Pincode</th><th>Delivery</th><th>COD</th><th>Prepaid</th><th>Pickup</th><th>Replacement</th><th>ODA</th><th>City</th><th>District</th><th>State</th><th>Remark</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${r.serviceable ? 'ok' : 'bad'}"><td class="dim">${i + 1}</td><td><b>${esc(r.pin)}</b></td><td>${yes(r.serviceable, 'Serviceable', 'Not serviceable')}</td><td>${r.city || r.serviceable ? yes(r.cod) : '—'}</td><td>${r.city || r.serviceable ? yes(r.prepaid) : '—'}</td><td>${r.city || r.serviceable ? yes(r.pickup) : '—'}</td><td>${r.city || r.serviceable ? yes(r.repl) : '—'}</td><td>${r.oda ? '<span class="dl-warn">ODA</span>' : (r.city ? '<span class="dim">No</span>' : '—')}</td><td>${esc(r.city || '')}</td><td>${esc(r.district || '')}</td><td>${esc(r.state || '')}</td><td class="dim">${esc(r.remarks || r.reason || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
  }
  async function checkPins(root) {
    const ta = root.querySelector('[data-dl-pins]'); const pins = splitPins(ta && ta.value);
    const out = root.querySelector('[data-dl-pin-out]');
    if (!pins.length) { out.innerHTML = '<p class="dl-err">6-digit pincode daalo.</p>'; return; }
    st.pin.busy = true; out.innerHTML = U.spinner(`${pins.length} pincode check ho rahe hain…`);
    try { const d = await FF.auth.api('/api/delhivery/pincode', 'POST', { pins }); st.pin.rows = d.rows || []; out.innerHTML = pinTable(); }
    catch (err) { out.innerHTML = `<p class="dl-err">⚠️ ${esc(err.message)}</p>`; }
    finally { st.pin.busy = false; }
  }

  // ---------------------------------------------------------------- AWB
  function awbTable() {
    const rows = st.awb.rows;
    if (!rows.length) return '<p class="dim small">AWB number daal kar <b>Track</b> dabao (ya Enter) — ek saath 200 tak.</p>';
    const cnt = {};
    rows.forEach((r) => { const [t] = statusTone(r); cnt[t] = (cnt[t] || 0) + 1; });
    const lab = { green: '✅ Delivered', blue: '🚚 In transit', violet: '🛵 Out for delivery', orange: '↩️ RTO / Return', red: '⚠️ Problem', gray: '❔ Other / not found' };
    return `<div class="dl-sum">${Object.entries(lab).filter(([k]) => cnt[k]).map(([k, l]) => `<span class="dl-chip ${k}">${l} <b>${cnt[k]}</b></span>`).join('')}<button type="button" class="btn sm" data-dl-csv="awb">⬇ CSV</button></div>
    <div class="dl-scroll"><table class="dl-tbl"><thead><tr><th>#</th><th>AWB</th><th>Status</th><th>Last update</th><th>Location</th><th>Remark</th><th>Origin → Destination</th><th>Consignee</th><th>Expected</th><th></th></tr></thead><tbody>
    ${rows.map((r, i) => {
      const [tone, label] = statusTone(r);
      const open = st.awb.open.has(r.awb);
      const scans = open && r.scans && r.scans.length ? `<tr class="dl-scans"><td></td><td colspan="9"><ol class="dl-tl">${r.scans.map((z) => `<li><b>${esc(z.scan || z.type)}</b> <span class="dim">${esc(fmtDt(z.at))}</span><br><small>${esc(z.loc)}${z.note ? ` · ${esc(z.note)}` : ''}</small></li>`).join('')}</ol></td></tr>` : '';
      return `<tr class="dl-row ${tone}"><td class="dim">${i + 1}</td><td><b class="mono">${esc(r.awb)}</b>${r.ref ? `<br><small class="dim">Ref ${esc(r.ref)}</small>` : ''}</td><td><span class="dl-st ${tone}">${esc(label || '—')}</span>${r.statusType ? `<br><small class="dim">${esc(r.statusType)}</small>` : ''}</td><td>${esc(fmtDt(r.statusAt))}</td><td>${esc(r.location || '')}</td><td class="dim">${esc(r.instructions || (r.notFound ? 'Delhivery par ye AWB nahi mila' : ''))}</td><td>${esc([r.origin, r.destination].filter(Boolean).join(' → '))}</td><td>${esc(r.consignee || '')}${r.city ? `<br><small class="dim">${esc(r.city)}${r.pin ? ` · ${esc(r.pin)}` : ''}</small>` : ''}</td><td>${esc(fmtDt(r.deliveredAt) ? `Delivered ${fmtDt(r.deliveredAt)}` : fmtDt(r.expected))}</td><td>${r.scans && r.scans.length ? `<button type="button" class="btn sm" data-dl-scan="${esc(r.awb)}">${open ? '▲' : '▼'} ${r.scans.length} scans</button>` : ''}</td></tr>${scans}`;
    }).join('')}
    </tbody></table></div>`;
  }
  async function trackAwbs(root) {
    const ta = root.querySelector('[data-dl-awbs]'); const awbs = splitAwbs(ta && ta.value);
    const out = root.querySelector('[data-dl-awb-out]');
    if (!awbs.length) { out.innerHTML = '<p class="dl-err">AWB number daalo.</p>'; return; }
    st.awb.busy = true; out.innerHTML = U.spinner(`${awbs.length} AWB track ho rahe hain…`);
    try { const d = await FF.auth.api('/api/delhivery/track', 'POST', { awbs }); st.awb.rows = d.rows || []; st.awb.open.clear(); out.innerHTML = awbTable(); }
    catch (err) { out.innerHTML = `<p class="dl-err">⚠️ ${esc(err.message)}</p>`; }
    finally { st.awb.busy = false; }
  }

  function csv(kind) {
    if (kind === 'pin') {
      U.downloadCsv(`Delhivery pincode check ${U.stamp ? U.stamp() : ''}.csv`, ['Pincode', 'Serviceable', 'COD', 'Prepaid', 'Pickup', 'Replacement', 'ODA', 'City', 'District', 'State', 'Remark'],
        st.pin.rows.map((r) => [r.pin, r.serviceable ? 'Yes' : 'No', r.cod ? 'Yes' : 'No', r.prepaid ? 'Yes' : 'No', r.pickup ? 'Yes' : 'No', r.repl ? 'Yes' : 'No', r.oda ? 'Yes' : 'No', r.city || '', r.district || '', r.state || '', r.remarks || r.reason || '']));
    } else {
      U.downloadCsv(`Delhivery AWB status ${U.stamp ? U.stamp() : ''}.csv`, ['AWB', 'Status', 'Status type', 'Last update', 'Location', 'Remark', 'Origin', 'Destination', 'Consignee', 'City', 'Pincode', 'Pickup date', 'Expected delivery', 'Delivered', 'Reference'],
        st.awb.rows.map((r) => [r.awb, r.notFound ? 'Not found' : r.status, r.statusType || '', r.statusAt || '', r.location || '', r.instructions || '', r.origin || '', r.destination || '', r.consignee || '', r.city || '', r.pin || '', r.pickupAt || '', r.expected || '', r.deliveredAt || '', r.ref || '']));
    }
  }

  // ---------------------------------------------------------------- page
  function tokenBox() {
    const c = st.cfg || {};
    if (c.configured) return c.admin ? '<details class="dl-tok"><summary class="dim small">🔑 Delhivery API token badlo</summary><div class="dl-tok-row"><input class="input mono" type="password" data-dl-token placeholder="Naya token paste karo"><button type="button" class="btn sm" data-dl-save>Save</button></div></details>' : '';
    if (!c.admin) return '<div class="dl-alert">🔑 Delhivery API token abhi set nahi hai — admin se set karwao.</div>';
    return `<div class="dl-alert"><b>🔑 Delhivery API token set karo</b> (sirf ek baar — server par safe rehta hai, browser ko nahi jaata)
      <div class="dl-tok-row"><input class="input mono" type="password" data-dl-token placeholder="Delhivery API token"><button type="button" class="btn primary sm" data-dl-save>💾 Save token</button></div></div>`;
  }
  async function render(root) {
    root.innerHTML = `<div class="page-head"><div><h1>🚚 Delhivery Tracking</h1><p class="dim">Pincode serviceability + AWB status — ek ya kai saath, turant.</p></div></div>
      <div data-dl-token-host>${U.spinner('…')}</div>
      <div class="dl-grid">
        <section class="card dl-card pin"><div class="card-head"><h3>📍 Pincode check</h3><p class="dim small">Delivery · COD · Prepaid · Pickup · ODA</p></div><div class="card-body">
          <textarea class="input mono" rows="3" data-dl-pins placeholder="302001, 110001&#10;400001 …  (comma / space / new line)"></textarea>
          <div class="dl-actions"><button type="button" class="btn primary" data-dl-pin-go>🔍 Check pincode</button><span class="dim small" data-dl-pin-n></span></div>
          <div data-dl-pin-out>${pinTable()}</div></div></section>
        <section class="card dl-card awb"><div class="card-head"><h3>📦 AWB status</h3><p class="dim small">Latest status · location · expected delivery · scans</p></div><div class="card-body">
          <textarea class="input mono" rows="3" data-dl-awbs placeholder="AWB numbers — comma / space / new line"></textarea>
          <div class="dl-actions"><button type="button" class="btn primary" data-dl-awb-go>🚚 Track AWB</button><span class="dim small" data-dl-awb-n></span></div>
          <div data-dl-awb-out>${awbTable()}</div></div></section>
      </div>`;
    const paintTok = () => { const h = root.querySelector('[data-dl-token-host]'); if (h) h.innerHTML = tokenBox(); };
    FF.auth.api('/api/delhivery/status').then((c) => { st.cfg = c; paintTok(); }).catch((err) => { const h = root.querySelector('[data-dl-token-host]'); if (h) h.innerHTML = `<div class="dl-alert">⚠️ ${esc(err.message)}</div>`; });
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-dl-pin-go]')) return checkPins(root);
      if (e.target.closest('[data-dl-awb-go]')) return trackAwbs(root);
      const c = e.target.closest('[data-dl-csv]'); if (c) return csv(c.dataset.dlCsv);
      const sc = e.target.closest('[data-dl-scan]');
      if (sc) { const a = sc.dataset.dlScan; if (st.awb.open.has(a)) st.awb.open.delete(a); else st.awb.open.add(a); root.querySelector('[data-dl-awb-out]').innerHTML = awbTable(); return; }
      const sv = e.target.closest('[data-dl-save]');
      if (sv) {
        const inp = root.querySelector('[data-dl-token]'); const token = String(inp && inp.value || '').trim();
        if (!token) return;
        await U.withButtonBusy(sv, async () => {
          try { await FF.auth.api('/api/settings', 'PUT', { delhivery: { token } }); st.cfg = { ...(st.cfg || {}), configured: true }; paintTok(); U.toast('Delhivery token save ho gaya ✅', 'ok'); }
          catch (err) { U.toast(err.message, 'error'); }
        }, 'Saving…');
      }
    });
    // ⚡ Instant: Enter = check (Shift+Enter = nayi line), paste ke turant baad bhi
    const hook = (sel, fn, countSel, splitter, unit) => {
      const ta = root.querySelector(sel); if (!ta) return;
      const count = () => { const n = splitter(ta.value).length; const el = root.querySelector(countSel); if (el) el.textContent = n ? `${n} ${unit}` : ''; };
      ta.addEventListener('input', count);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fn(root); } });
      ta.addEventListener('paste', () => setTimeout(() => { count(); if (splitter(ta.value).length) fn(root); }, 60));
    };
    hook('[data-dl-pins]', checkPins, '[data-dl-pin-n]', splitPins, 'pincode');
    hook('[data-dl-awbs]', trackAwbs, '[data-dl-awb-n]', splitAwbs, 'AWB');
  }

  FF.pages.delhivery = { title: 'Delhivery Tracking', render, _test: { splitPins, splitAwbs, statusTone } };
})(window.FF);
