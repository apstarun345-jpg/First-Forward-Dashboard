/* 🏷️ Tag In Hand — bank mail "Tag In Hand Dated DD-MM-YYYY-AN01-Apna Payment" ki attachment (password-protected .xls) ka data, mahine-wise ek table.
   FF = file me agent id/name hai · GV = blank (GV Master se tag id par ek baar lookup). TL name / TL mail / Remark editable,
   date-wise bulk mail (GV → set ki hui GV mail, FF → TL ki mail). Server: /api/tih (tih-mail.js). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc;
  const CSS = `
  .tih{padding:0 0 24px}
  .tih-hero{margin:0 0 12px;padding:16px 18px;border-radius:16px;color:#fff;background:linear-gradient(120deg,#4f46e5,#7c3aed 45%,#db2777);display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;box-shadow:0 8px 24px rgba(79,70,229,.25)}
  .tih-hero h2{margin:0;font-size:20px}.tih-hero p{margin:2px 0 0;opacity:.9;font-size:12.5px}
  .tih-kpis{display:flex;gap:8px;flex-wrap:wrap}
  .tih-k{background:rgba(255,255,255,.18);backdrop-filter:blur(4px);border-radius:12px;padding:6px 12px;min-width:74px;text-align:center}
  .tih-k b{display:block;font-size:20px;font-variant-numeric:tabular-nums}.tih-k small{font-size:11px;opacity:.9}
  .tih-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}
  .tih-bar select,.tih-bar input[type=search],.tih-bar input[type=text]{padding:7px 10px;border:1px solid var(--line,#cbd5e1);border-radius:10px;background:var(--card,#fff);color:inherit;font-size:13px}
  .tih-seg{display:inline-flex;border:1px solid var(--line,#cbd5e1);border-radius:10px;overflow:hidden}
  .tih-seg button{border:0;background:var(--card,#fff);padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer;color:inherit}
  .tih-seg button.on{color:#fff}.tih-seg button[data-ch="all"].on{background:#4f46e5}.tih-seg button[data-ch="gv"].on{background:#16a34a}.tih-seg button[data-ch="ff"].on{background:#2563eb}
  .tih-btn{border:0;border-radius:10px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer;background:#e0e7ff;color:#3730a3}
  .tih-btn.pri{background:linear-gradient(120deg,#4f46e5,#db2777);color:#fff}.tih-btn.ok{background:#16a34a;color:#fff}.tih-btn:disabled{opacity:.5;cursor:default}
  .tih-send{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;margin:0 0 10px;border-radius:14px;border:1px dashed #a5b4fc;background:color-mix(in srgb,#6366f1 6%,var(--card,#fff))}
  .tih-send b{color:#4338ca}
  .tih-wrap{overflow:auto;border-radius:14px;border:1px solid var(--line,#e2e8f0);background:var(--card,#fff);max-height:70vh}
  table.tih-t{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px}
  .tih-t th{position:sticky;top:0;z-index:2;background:linear-gradient(120deg,#4338ca,#7c3aed);color:#fff;text-align:left;padding:9px 10px;white-space:nowrap;font-size:12px;cursor:pointer}
  .tih-t td{padding:6px 10px;border-bottom:1px solid var(--line,#e2e8f0);vertical-align:middle}
  .tih-t tr.d0 td{background:var(--card,#fff)}.tih-t tr.d1 td{background:color-mix(in srgb,#6366f1 5%,var(--card,#fff))}
  .tih-t tr:hover td{background:color-mix(in srgb,#f59e0b 10%,var(--card,#fff))}
  .tih-ch{display:inline-block;padding:2px 9px;border-radius:999px;font-weight:800;font-size:11px}
  .tih-ch.gv{background:#dcfce7;color:#166534}.tih-ch.ff{background:#dbeafe;color:#1e40af}
  .tih-day{font-weight:800;color:#4338ca;white-space:nowrap}
  .tih-vrn{font-weight:800;letter-spacing:.02em}.tih-tag{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#475569}
  .tih-rs{display:inline-block;padding:2px 8px;border-radius:8px;background:#ffedd5;color:#9a3412;font-size:11.5px;font-weight:700}
  .tih-ag small{display:block;color:var(--muted,#64748b);font-size:11px}
  .tih-src{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:6px;margin-left:4px}
  .tih-src.gv{background:#dcfce7;color:#166534}.tih-src.miss{background:#fee2e2;color:#b91c1c}.tih-src.wait{background:#fef3c7;color:#92400e}
  .tih-tl{font-weight:700;color:#7c3aed}
  .tih-in{width:100%;min-width:130px;padding:4px 7px;border:1px solid var(--line,#cbd5e1);border-radius:8px;background:var(--card,#fff);color:inherit;font-size:12px}
  .tih-in.saved{border-color:#16a34a;box-shadow:0 0 0 2px rgba(22,163,74,.2)}
  .tih-mb{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap}
  .tih-mb.y{background:#dcfce7;color:#166534}.tih-mb.n{background:#f1f5f9;color:#64748b}
  .tih-set{margin:0 0 12px;padding:12px 14px;border:1px solid #c7d2fe;border-radius:14px;background:color-mix(in srgb,#6366f1 5%,var(--card,#fff));display:grid;gap:10px}
  .tih-set label{display:grid;gap:3px;font-size:12px;font-weight:700;color:#4338ca}.tih-set input{padding:7px 10px;border:1px solid var(--line,#cbd5e1);border-radius:8px;background:var(--card,#fff);color:inherit;font-size:13px;font-weight:400}
  .tih-tpl{display:grid;gap:6px;padding:10px;border:1px dashed #a5b4fc;border-radius:12px}.tih-tpl b{color:#4338ca}
  .tih-set textarea{padding:7px 10px;border:1px solid var(--line,#cbd5e1);border-radius:8px;background:var(--card,#fff);color:inherit;font-size:12.5px;font-weight:400;font-family:inherit;width:100%;box-sizing:border-box}
  .tih-chips{display:inline-flex;gap:4px;flex-wrap:wrap}.tih-chip{border:1px solid #c7d2fe;background:var(--card,#fff);color:#4338ca;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer}.tih-chip.on{background:linear-gradient(120deg,#4f46e5,#db2777);color:#fff;border-color:transparent}
  .tih-banner{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;margin:0 0 10px;padding:10px 14px;border-radius:12px;background:#fef3c7;border:1px solid #f59e0b;color:#78350f;font-weight:700;font-size:13px;white-space:pre-wrap}.tih-banner button{border:0;background:transparent;font-size:16px;cursor:pointer;color:inherit}
  .tih-note{font-size:12px;color:var(--muted,#64748b)}.tih-err{color:#b91c1c;font-weight:700;font-size:12.5px}
  .tih-empty{padding:30px;text-align:center;color:var(--muted,#64748b)}
  html[data-theme="dark"] .tih-ch,html[data-theme="dark"] .tih-rs,html[data-theme="dark"] .tih-src,html[data-theme="dark"] .tih-mb{filter:brightness(.92)}
  @media(max-width:700px){.tih-hero h2{font-size:17px}.tih-t{font-size:12px}}
  `;
  const st = { root: null, data: null, busy: false, err: '', ch: 'all', month: '', day: '', q: '', sort: 'day', dir: -1, sel: new Set(), setOpen: false, msg: '', timer: null, tl: '', agent: '', sendDays: new Set(), target: 'all', tname: '', toMail: '' };
  const dmy = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : iso || '—');
  const mlabel = (m) => { try { return new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); } catch { return m; } };
  const css = () => { if (document.getElementById('tih-css')) return; const s = document.createElement('style'); s.id = 'tih-css'; s.textContent = CSS; document.head.appendChild(s); };
  const isAdmin = () => !!(st.data && st.data.admin);
  const akey = (r) => String(r.agentId || r.agentName || '');
  const monthRows = () => ((st.data && st.data.rows) || []).filter((r) => !st.month || (r.day || '').startsWith(st.month));

  function filtered() {
    const q = st.q.trim().toLowerCase();
    let rows = ((st.data && st.data.rows) || []).filter((r) => (st.ch === 'all' || r.ch === st.ch) && (!st.month || (r.day || '').startsWith(st.month)) && (!st.day || r.day === st.day) && (!st.tl || r.tlName === st.tl) && (!st.agent || akey(r) === st.agent));
    if (q) rows = rows.filter((r) => [r.vrn, r.tagId, r.reason, r.agentId, r.agentName, r.tlName, r.remark].join(' ').toLowerCase().includes(q));
    const k = st.sort, d = st.dir;
    rows = rows.slice().sort((a, b) => { const x = String(a[k] || ''), y = String(b[k] || ''); return x < y ? -d : x > y ? d : 0; });
    return rows;
  }
  const daysOf = () => [...new Set(((st.data && st.data.rows) || []).filter((r) => !st.month || (r.day || '').startsWith(st.month)).map((r) => r.day).filter(Boolean))].sort().reverse();

  const tlOpts = () => [...new Set(monthRows().filter((r) => st.ch === 'all' || r.ch === st.ch).map((r) => r.tlName).filter(Boolean))].sort();
  const agentOpts = () => { const m = new Map(); monthRows().filter((r) => (st.ch === 'all' || r.ch === st.ch) && (!st.tl || r.tlName === st.tl)).forEach((r) => { const k = akey(r); if (k && !m.has(k)) m.set(k, `${r.agentName || r.agentId}${r.agentId && r.agentName ? ` (${r.agentId})` : ''}`); }); return [...m].map(([k, n]) => ({ k, n })).sort((a, b) => a.n.localeCompare(b.n)); };
  function head() {
    const all = ((st.data && st.data.rows) || []).filter((r) => !st.month || (r.day || '').startsWith(st.month));
    const ff = all.filter((r) => r.ch === 'ff').length, gv = all.length - ff, gvMiss = all.filter((r) => r.ch === 'gv' && r.src !== 'gv').length, sent = all.filter((r) => r.sentAt).length;
    const k = (n, l) => `<div class="tih-k"><b>${U.fmt(n)}</b><small>${l}</small></div>`;
    return `<div class="tih-hero"><div><h2>🏷️ Tag In Hand</h2><p>Bank ki "Tag In Hand Dated…" mail ki attachment · mahine-wise · FF / GV alag${st.data ? ` · ${st.data.meta.mails} mails padhi` : ''}</p></div><div class="tih-kpis">${k(all.length, 'Total tags')}${k(ff, 'FF')}${k(gv, 'GV')}${gvMiss ? k(gvMiss, 'GV agent nahi mila') : ''}${k(sent, 'Mail gayi')}</div></div>`;
  }
  function bar() {
    const d = st.data; if (!d) return '';
    const months = d.months || [];
    return `<div class="tih-bar">
      <div class="tih-seg">${['all', 'gv', 'ff'].map((c) => `<button data-ch="${c}" class="${st.ch === c ? 'on' : ''}">${c === 'all' ? 'All' : c === 'gv' ? '🟩 GV' : '🟦 FF'}</button>`).join('')}</div>
      <select data-f="month"><option value="">Sab mahine (${months.length})</option>${months.map((m) => `<option value="${m}" ${st.month === m ? 'selected' : ''}>${esc(mlabel(m))}</option>`).join('')}</select>
      <select data-f="day"><option value="">Sab dates</option>${daysOf().map((x) => `<option value="${x}" ${st.day === x ? 'selected' : ''}>${dmy(x)}</option>`).join('')}</select>
      <select data-f="tl"><option value="">Sab TL</option>${tlOpts().map((x) => `<option value="${esc(x)}" ${st.tl === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select data-f="agent"><option value="">Sab agents</option>${agentOpts().map((a) => `<option value="${esc(a.k)}" ${st.agent === a.k ? 'selected' : ''}>${esc(a.n)}</option>`).join('')}</select>
      <input type="search" data-f="q" placeholder="VRN / Tag / agent / TL / remark…" value="${esc(st.q)}">
      <button class="tih-btn" data-act="refresh" ${st.busy ? 'disabled' : ''}>${st.busy ? '⏳ Mail padh raha…' : '🔄 Refresh'}</button>
      <button class="tih-btn" data-act="csv">⬇ CSV</button>
      ${isAdmin() ? '<button class="tih-btn" data-act="set">⚙ Mail settings</button>' : ''}
      <span class="tih-note">${d.meta.pending ? `⏳ ${d.meta.pending} mail abhi padhni baaki` : ''} ${d.meta.error ? `<span class="tih-err">⚠ ${esc(d.meta.error)}</span>` : ''} ${d.meta.gvErr ? `<span class="tih-err">GV lookup: ${esc(d.meta.gvErr)}</span>` : ''}</span></div>`;
  }
  function settings() {
    if (!st.setOpen || !isAdmin()) return '';
    const c = st.data.cfg, t = c.tpl || {};
    const tp = (k, title) => `<div class="tih-tpl"><b>${title}</b><label>Subject<input type="text" data-c="tpl.${k}.subject" value="${esc((t[k] || {}).subject)}"></label><label>Mail body<textarea data-c="tpl.${k}.body" rows="7">${esc((t[k] || {}).body)}</textarea></label></div>`;
    return `<div class="tih-set"><b>⚙ Mail settings</b>
      <label>↩️ Reply-To — jawab is mail par aaye (verification nahi chahiye)<input type="text" data-c="replyTo" value="${esc(c.replyTo)}" placeholder="tarun.kumawat@apnapayment.com"></label>
      <div class="tih-note">⚠ Mail kaun si ID se <b>jaati</b> hai: <b>Google Apps Script</b> relay me hamesha usi Google account se (jisme script bana hai) — doosri ID se bhejna sambhav nahi, bina verification ke koi bhi kisi ke naam se mail nahi bhej sakta. Isliye Reply-To use karo: mail jayegi script wale account se, par "Reply" dabane par aapki mail par jawab aayega (Code.gs ek baar New version deploy karna hai). Poori alag ID se bhejni ho to Resend / Brevo / SMTP me us domain / mail ko verify karke yahan From daalo.</div>
      <label>📤 From (sirf SMTP / Resend / Brevo me chalta hai) — jaise: Apna Payment &lt;ops@domain.com&gt;<input type="text" data-c="from" value="${esc(c.from)}" placeholder="khaali = Settings → Email wala From"></label>
      <label>Mail ke neeche sender naam ({sender})<input type="text" data-c="sender" value="${esc(c.sender)}"></label>
      <label>🟩 GV ki report is mail par jaye (comma se alag)<input type="text" data-c="gvTo" value="${esc(c.gvTo)}" placeholder="gv-team@example.com"></label>
      <label>CC — GV (optional)<input type="text" data-c="gvCc" value="${esc(c.gvCc)}"></label>
      <label>CC — FF TL / agent mails (optional)<input type="text" data-c="ffCc" value="${esc(c.ffCc)}"></label>
      <label>Kitne mahine ki mail leni hain (1–12)<input type="text" data-c="months" value="${esc(c.months)}" style="max-width:90px"></label>
      <div class="tih-note">Mail body / subject me ye likh sakte ho: <code>{name}</code> (agent / TL naam) · <code>{dates}</code> · <code>{count}</code> tags · <code>{agents}</code> · <code>{sender}</code> · <code>{table}</code> (agent-wise table yahan aayegi; na likho to neeche lag jaati hai).</div>
      ${tp('agent', '👤 Direct agent ko mail')}${tp('tl', '🏬 TL ko mail (uske sab agents ek mail me)')}${tp('gv', '🟩 GV report mail')}
      <div><button class="tih-btn pri" data-act="saveset">💾 Save</button> <button class="tih-btn" data-act="gvretry" title="GV Master me jo tag nahi mile unhe dobara dhundo">🔁 GV missing + mail sheet dobara padho</button> <span class="tih-note">${esc(st.msg)}</span></div>
      <div class="tih-note">TL / agent ki mail Google sheet ("TL_Email_Pivot" + Agent master "Email id") se aati hai. Table me mail badalni ho to wahin likh do — wo sheet se upar chalegi.${st.data.meta.mailBook ? ` <span class="tih-err">${esc(st.data.meta.mailBook)}</span>` : ''}</div></div>`;
  }
  function sendBar() {
    if (!st.data || !isAdmin()) return '';
    const days = daysOf();
    if (!days.length) return '';
    if (!st.sendDays.size || ![...st.sendDays].every((d) => days.includes(d))) { st.sendDays = new Set([st.day && days.includes(st.day) ? st.day : days[0]]); }
    const n = st.sel.size, allOn = days.every((d) => st.sendDays.has(d));
    const tls = tlOpts(), ags = agentOpts();
    const nameSel = st.target === 'tl' ? `<select data-f="tname">${tls.map((x) => `<option value="${esc(x)}" ${st.tname === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` : st.target === 'agent' ? `<select data-f="tname">${ags.map((a) => `<option value="${esc(a.k)}" ${st.tname === a.k ? 'selected' : ''}>${esc(a.n)}</option>`).join('')}</select>` : '';
    return `<div class="tih-send"><b>📧 Bulk mail</b>
      <span class="tih-chips"><button class="tih-chip ${allOn ? 'on' : ''}" data-sdall>Sab dates (${days.length})</button>${days.map((x) => `<button class="tih-chip ${st.sendDays.has(x) ? 'on' : ''}" data-sd="${x}">${dmy(x).slice(0, 5)}</button>`).join('')}</span>
      <select data-f="target"><option value="all" ${st.target === 'all' ? 'selected' : ''}>Sab (GV + FF TL/agents)</option><option value="gv" ${st.target === 'gv' ? 'selected' : ''}>Sirf GV</option><option value="ff" ${st.target === 'ff' ? 'selected' : ''}>Sirf FF (TL + direct agents)</option><option value="tl" ${st.target === 'tl' ? 'selected' : ''}>Ek TL ko</option><option value="agent" ${st.target === 'agent' ? 'selected' : ''}>Ek agent ko</option></select>${nameSel}
      <input type="text" data-f="tomail" placeholder="custom email (optional, sirf ek ko bhejne par)" value="${esc(st.toMail)}" style="min-width:220px">
      <button class="tih-btn ok" data-act="send" data-send="go">👁 Preview → Bhejo</button>
      ${n ? `<button class="tih-btn pri" data-act="send" data-send="sel">Selected ${n} rows bhejo</button>` : ''}
      <span class="tih-note">${st.data.cfg.gvTo ? '' : '<span class="tih-err">GV mail set nahi (⚙)</span>'} Subject me TL / direct agent ka naam; TL ke saare agents ek hi mail me agent-wise table ke saath + CSV.</span></div>`;
  }
  function table() {
    const d = st.data;
    if (!d) return `<div class="tih-empty">${st.err ? `<span class="tih-err">${esc(st.err)}</span>` : '⏳ Load ho raha…'}</div>`;
    const rows = filtered();
    if (!rows.length) return `<div class="tih-empty">${d.meta.running || st.busy ? '⏳ Bank mails padh raha hoon…' : 'Is filter me koi tag nahi. Refresh dabao ya mahina badlo.'}</div>`;
    const th = (k, l) => `<th data-sort="${k}">${l}${st.sort === k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    let prev = '', flip = 0;
    const adm = isAdmin();
    const body = rows.slice(0, 1500).map((r) => {
      if (r.day !== prev) { prev = r.day; flip ^= 1; }
      const src = r.ch === 'gv' ? (r.src === 'gv' ? '<span class="tih-src gv" title="GV Master se mila">GV Master</span>' : r.src === 'miss' ? '<span class="tih-src miss" title="GV Master me nahi mila">nahi mila</span>' : '<span class="tih-src wait">dhundh raha…</span>') : '';
      const who = r.agentName || r.agentId ? `${esc(r.agentName || '—')}${r.direct ? ' <span class="tih-src gv">Direct</span>' : ''}<small>${esc(r.agentId)}</small>` : '<span class="tih-note">—</span>';
      const tlm = r.ch === 'gv' ? `<span class="tih-note">${esc((st.data.cfg && st.data.cfg.gvTo) || '→ GV mail')}</span>` : adm ? `<input class="tih-in" data-ent="${esc(r.ent)}" value="${esc(r.mailTo)}" placeholder="${r.direct ? 'agent' : 'TL'} mail daalo" type="text" title="${r.mailSrc === 'sheet' ? 'Google sheet se' : r.mailSrc === 'manual' ? 'Aapne set ki' : 'mail nahi mili'}">${r.mailSrc === 'sheet' ? '<small class="tih-note">📄 sheet</small>' : ''}` : esc(r.mailTo || '—');
      return `<tr class="d${flip}"><td>${adm ? `<input type="checkbox" data-sel="${esc(r.k)}" ${st.sel.has(r.k) ? 'checked' : ''}>` : ''}</td>
        <td class="tih-day">${dmy(r.day)}</td><td><span class="tih-ch ${r.ch}">${r.ch === 'gv' ? '🟩 GV' : '🟦 FF'}</span></td>
        <td class="tih-vrn">${esc(r.vrn)}</td><td class="tih-tag">${esc(r.tagId)}</td><td><span class="tih-rs">${esc(r.reason || '—')}</span></td><td>${dmy(r.issueDate)}</td>
        <td class="tih-ag">${who}${src}</td><td class="tih-tl">${esc(r.tlName || (r.direct ? '(direct)' : '—'))}</td><td>${tlm}</td>
        <td><input class="tih-in" data-remark="${esc(r.k)}" value="${esc(r.remark)}" placeholder="remark…" maxlength="300"></td>
        <td>${r.sentAt ? `<span class="tih-mb y" title="${esc(r.sentTo)}">✉️ ${new Date(r.sentAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>` : '<span class="tih-mb n">—</span>'}</td></tr>`;
    }).join('');
    return `<div class="tih-wrap"><table class="tih-t"><thead><tr><th>${adm ? '<input type="checkbox" data-selall>' : ''}</th>${th('day', 'Report date')}${th('ch', 'Channel')}${th('vrn', 'VRN')}${th('tagId', 'Tag ID')}${th('reason', 'Reason')}${th('issueDate', 'Issue date')}${th('agentName', 'Agent')}${th('tlName', 'TL name')}<th>Mail to (TL / agent)</th>${th('remark', 'Remark')}<th>Mail</th></tr></thead><tbody>${body}</tbody></table></div>${rows.length > 1500 ? `<div class="tih-note" style="padding:6px">Pehle 1500 dikha raha hoon (${rows.length}) — filter lagao.</div>` : ''}<div class="tih-note" style="padding:6px 2px">${rows.length} tags</div>`;
  }
  const banner = () => (st.msg ? `<div class="tih-banner"><span>${esc(st.msg)}</span><button data-act="clrmsg">✕</button></div>` : '');
  function paint() {
    if (!st.root) return;
    const keep = st.root.querySelector('.tih-wrap');
    const sx = keep ? keep.scrollLeft : 0, sy = keep ? keep.scrollTop : 0;
    st.root.innerHTML = `<div class="tih">${head()}${bar()}${banner()}${settings()}${sendBar()}${table()}</div>`;
    const w = st.root.querySelector('.tih-wrap'); if (w) { w.scrollLeft = sx; w.scrollTop = sy; }
  }
  async function load(quiet) {
    try { const d = await FF.auth.api('/api/tih'); st.data = d; st.err = ''; if (!st.month && d.months && d.months[0]) st.month = d.months[0]; }
    catch (e) { st.err = String((e && e.message) || e); }
    if (st.root && st.root.isConnected && !quiet) paint(); else if (st.root && st.root.isConnected) paint();
  }
  async function refresh(extra) {
    if (st.busy) return; st.busy = true; paint();
    try { await FF.auth.api('/api/tih/refresh', 'POST', extra || {}); } catch (e) { st.err = String((e && e.message) || e); }
    st.busy = false; await load();
  }
  function csv() {
    const rows = filtered();
    const c = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['Report date', 'Channel', 'VRN', 'Tag ID', 'Reason', 'Issue date', 'Agent ID', 'Agent name', 'TL name', 'TL mail', 'Remark', 'Mail sent'].join(',')]
      .concat(rows.map((r) => [dmy(r.day), r.ch.toUpperCase(), r.vrn, r.tagId, r.reason, dmy(r.issueDate), r.agentId, r.agentName, r.tlName, r.tlMail, r.remark, r.sentAt ? new Date(r.sentAt).toISOString().slice(0, 10) : ''].map(c).join(',')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
    a.download = `TagInHand_${st.month || 'all'}_${st.ch}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function send(mode, btn) {
    const body = mode === 'sel' ? { keys: [...st.sel], mode: 'all' } : { days: [...st.sendDays], mode: st.target };
    if (mode !== 'sel') {
      if ((st.target === 'tl' || st.target === 'agent')) { const sel = st.root.querySelector('[data-f="tname"]'); st.tname = st.tname || (sel && sel.value) || ''; body.target = st.tname; if (!body.target) { st.msg = 'TL / agent chuno.'; paint(); return; } }
      if (st.toMail) body.to = st.toMail;
    }
    btn.disabled = true;
    try {
      const pre = await FF.auth.api('/api/tih/send', 'POST', { ...body, dry: true });
      const lines = (pre.groups || []).map((g) => `✅ ${g.label} → ${g.to}\n     ${g.n} tags · ${g.agents} agents · "${g.subject}"`).concat((pre.skipped || []).map((s) => `⚠ ${s.label} (${s.n}) — ${s.why}`));
      if (!(pre.groups || []).length) { st.msg = lines.join('\n') || 'Bhejne layak kuch nahi.'; btn.disabled = false; paint(); return; }
      if (pre.quota !== null && pre.quota !== undefined && pre.quota < pre.groups.length) { st.msg = `⛔ Aaj ki Google mail quota sirf ${pre.quota} bachi hai, aur ${pre.groups.length} mail bhejni hain — abhi nahi bhej sakta. Quota ~12:30 PM IST par reset hoti hai, ya Settings → Features → Email me Resend / Brevo / SMTP lagao.\n\nPreview:\n${lines.join('\n')}`; btn.disabled = false; paint(); return; }
      if (!window.confirm(`${pre.groups.length} mail bhejni hain? (${pre.rows} tags${pre.quota != null ? ` · Google quota bachi: ${pre.quota}` : ''})\n\n${lines.join('\n')}`)) { btn.disabled = false; return; }
      const out = await FF.auth.api('/api/tih/send', 'POST', body);
      st.msg = (out.results || []).map((r) => `${r.ok ? '✅' : '❌'} ${r.label} (${r.n})${r.ok ? '' : ' ' + (r.error || '')}`).join(' · ') + ((out.skipped || []).length ? ` · ⚠ ${(out.skipped || []).length} skip` : '');
      st.sel.clear(); await load();
    } catch (e) { st.msg = '❌ ' + String((e && e.message) || e); paint(); }
    btn.disabled = false;
  }
  async function saveSet() {
    const c = { tpl: { agent: {}, tl: {}, gv: {} } };
    st.root.querySelectorAll('[data-c]').forEach((i) => { const p = i.dataset.c.split('.'); if (p[0] === 'tpl') c.tpl[p[1]][p[2]] = i.value; else c[p[0]] = i.value; });
    try { const out = await FF.auth.api('/api/tih/cfg', 'POST', c); st.data.cfg = out.cfg; st.msg = '✅ Save ho gaya'; } catch (e) { st.msg = '❌ ' + String((e && e.message) || e); }
    paint();
  }
  function bind(root) {
    root.addEventListener('click', (e) => {
      const t = e.target;
      const chb = t.closest('[data-ch]'); if (chb) { st.ch = chb.dataset.ch; paint(); return; }
      const sd = t.closest('[data-sd]'); if (sd) { const d = sd.dataset.sd; if (st.sendDays.has(d)) { if (st.sendDays.size > 1) st.sendDays.delete(d); } else st.sendDays.add(d); paint(); return; }
      if (t.closest('[data-sdall]')) { const ds = daysOf(); st.sendDays = ds.every((d) => st.sendDays.has(d)) ? new Set([ds[0]]) : new Set(ds); paint(); return; }
      const so = t.closest('[data-sort]'); if (so) { const k = so.dataset.sort; if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = k === 'day' ? -1 : 1; } paint(); return; }
      const a = t.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act;
      if (act === 'refresh') refresh();
      else if (act === 'csv') csv();
      else if (act === 'clrmsg') { st.msg = ''; paint(); }
      else if (act === 'set') { st.setOpen = !st.setOpen; st.msg = ''; paint(); }
      else if (act === 'saveset') saveSet();
      else if (act === 'gvretry') refresh({ gvRetry: true });
      else if (act === 'send') send(a.dataset.send, a);
    });
    root.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.matches('[data-f="month"]')) { st.month = t.value; st.day = ''; st.sel.clear(); paint(); return; }
      if (t.matches('[data-f="day"]')) { st.day = t.value; paint(); return; }
      if (t.matches('[data-f="tl"]')) { st.tl = t.value; st.agent = ''; paint(); return; }
      if (t.matches('[data-f="agent"]')) { st.agent = t.value; paint(); return; }
      if (t.matches('[data-f="target"]')) { st.target = t.value; st.tname = ''; paint(); return; }
      if (t.matches('[data-f="tname"]')) { st.tname = t.value; return; }
      if (t.matches('[data-f="tomail"]')) { st.toMail = t.value.trim(); return; }
      if (t.matches('[data-sel]')) { if (t.checked) st.sel.add(t.dataset.sel); else st.sel.delete(t.dataset.sel); paint(); return; }
      if (t.matches('[data-selall]')) { filtered().forEach((r) => { if (t.checked) st.sel.add(r.k); else st.sel.delete(r.k); }); paint(); return; }
      if (t.matches('[data-remark]')) {
        try { await FF.auth.api('/api/tih/remark', 'POST', { key: t.dataset.remark, text: t.value }); const r = st.data.rows.find((x) => x.k === t.dataset.remark); if (r) r.remark = t.value.trim(); t.classList.add('saved'); setTimeout(() => t.classList.remove('saved'), 1200); } catch { /* ignore */ }
        return;
      }
      if (t.matches('[data-ent]')) {
        const ent = t.dataset.ent;
        try {
          await FF.auth.api('/api/tih/tlmail', 'POST', { ent, email: t.value });
          st.data.rows.forEach((r) => { if (r.ent === ent) { r.mailTo = t.value.trim(); r.mailSrc = t.value.trim() ? 'manual' : ''; } });
          root.querySelectorAll('[data-ent]').forEach((i) => { if (i.dataset.ent === ent) { i.value = t.value.trim(); i.classList.add('saved'); setTimeout(() => i.classList.remove('saved'), 1200); } });
        } catch (err) { t.value = ''; window.alert(String((err && err.message) || err)); }
      }
    });
    let qt = 0;
    root.addEventListener('input', (e) => {
      if (!e.target.matches('[data-f="q"]')) return;
      st.q = e.target.value; clearTimeout(qt);
      qt = setTimeout(() => { const pos = e.target.selectionStart; paint(); const i = root.querySelector('[data-f="q"]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* */ } } }, 250);
    });
  }
  function render(root) {
    css(); st.root = root; root.innerHTML = '<div class="tih"><div class="tih-empty">⏳ Load ho raha…</div></div>';
    bind(root); load();
    clearInterval(st.timer);
    st.timer = setInterval(() => {
      if (!st.root || !st.root.isConnected) { clearInterval(st.timer); return; }
      if (document.hidden || st.busy) return;
      const ae = document.activeElement; if (ae && st.root.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
      load(true);
    }, 90000);
  }
  FF.pages.tagInHand = { title: 'Tag In Hand', render };
})(window.FF);
