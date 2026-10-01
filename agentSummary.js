/* 📄 AGENT / TL SUMMARY (v3.32) — FF aur GV dono me ek hi option.
 *
 *   Agent ya TL search karo → ek saaf report: profile (ID · TL · mobile · priority) · stock (VC4 / Commercial) ·
 *   issuance last month + current month (class-wise) · growth + month-end expected · stock ageing (1 / 3 / 5 / 6 mahine) ·
 *   TL ho to uske agents ki table.  Report ko 📄 PDF download · 📤 Share (mobile par PDF file / WhatsApp) · 🟢 WhatsApp text ·
 *   📋 Copy · ⬇ CSV kar sakte ho — taaki search karke seedha agent / TL ko bhej sako.
 *
 *   Data: FF.masterProfile.build() (wahi exact numbers jo Master Search profile me aate hain) + FF.stockAge (ageing).
 *   Pages: ffAgentSummary (First Forward) · gvAgentSummary (GV Partner) — dono is module ko use karte hain.
 */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean;
  const fmt = (n, d) => U.fmt(n, d);
  const num = (v) => Number(v) || 0;
  const norm = (s) => clean(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const canContacts = () => { try { return !FF.auth || FF.auth.can('contacts'); } catch { return true; } };
  const MP = () => FF.masterProfile;
  const sessions = { ff: { person: null, q: '' }, gv: { person: null, q: '' } };

  // ---- people list (agents + TLs) for the search box ----------------------------------------------
  async function loadPeople(ch) {
    const out = [];
    const seenTl = new Set();
    const addTl = (name, id, mobile, direct) => {
      const n = clean(name);
      if (!n || direct || !FF.config.isRealTl(n) || seenTl.has(norm(n))) return;
      seenTl.add(norm(n));
      out.push({ kind: `${ch}-tl`, name: n, sub: clean(id), tl: '', mobile: clean(mobile), isTl: true });
    };
    if (ch === 'ff') {
      const P = FF.pages.performance;
      if (P && P.ensureLoaded) await P.ensureLoaded();
      ((P && P.agents && P.agents()) || []).forEach((a) => {
        const direct = FF.config.isDirectAgent(a, 'ff');
        out.push({ kind: 'ff-agent', name: clean(a.name || a.agentId), sub: clean(a.agentId || a.id), tl: direct ? '' : clean(a.tlName), mobile: clean(a.mobile), old: clean(a.id), direct });
        addTl(a.tlName, a.tlId, a.tlMobile, direct);
      });
    } else {
      const rows = (await FF.gv.need('report')) || [];
      rows.forEach((r) => {
        const direct = FF.config.isDirectAgent(r, 'gv');
        out.push({ kind: 'gv-agent', name: clean(r.agentName || r.agentId), sub: clean(r.agentId), tl: direct ? '' : clean(r.tlName), mobile: clean(r.mobile), direct });
        addTl(r.tlName, r.tlId, r.tlMobile, direct);
      });
    }
    return out;
  }
  const personOf = (p) => ({ kind: p.kind, name: p.name, sub: p.sub, tlSet: new Set(p.tl ? [p.tl] : []), classMap: new Map(), bars: new Set(), n: 0, direct: !!p.direct });
  function matchPeople(list, q) {
    const t = clean(q).toLowerCase();
    if (t.length < 2) return [];
    const d = t.replace(/\D/g, '');
    const mob = canContacts();
    return list.filter((p) => `${p.name} ${p.sub} ${p.old || ''} ${p.tl}`.toLowerCase().includes(t) || (mob && d.length >= 5 && String(p.mobile || '').replace(/\D/g, '').includes(d)))
      .sort((a, b) => (b.isTl ? 1 : 0) - (a.isTl ? 1 : 0) || a.name.localeCompare(b.name)).slice(0, 25);
  }

  // ---- report model --------------------------------------------------------------------------------
  const GROUPS = [['core', '🚗 VC4 + VC20'], ['comm', '🚚 VC5+ (commercial)']];
  const THRESH = [1, 3, 5, 6];
  function ageRows(node) {
    if (!node) return [];
    return GROUPS.map(([g, label]) => {
      const total = num(node.total && node.total[g]);
      return { label, total, m: THRESH.map((m) => num(node.counts && node.counts[g] && node.counts[g][m])), oldest: num(node.oldest && node.oldest[g]), avg: num(node.avg && node.avg[g]), unknown: num(node.unknown && node.unknown[g]) };
    });
  }
  async function buildReport(person) {
    const ch = /^gv/.test(person.kind) ? 'gv' : 'ff';
    const pr = await MP().build(person);
    let node = null, ageErr = '';
    try {
      await Promise.race([FF.stockAge.ready(), new Promise((_, rej) => setTimeout(() => rej(new Error('ageing data late')), 20000))]);
      node = /tl$/.test(person.kind) ? FF.stockAge.forTl(person.name, ch) : FF.stockAge.forAgent([pr.id, person.sub, person.name].filter(Boolean), ch);
    } catch (err) { ageErr = (err && err.message) || 'ageing available nahi'; }
    return { pr, ch, node, age: ageRows(node), ageErr, at: new Date() };
  }
  const monthName = (ym) => { try { return U.labelYM(ym); } catch { return String(ym || ''); } };
  function classRows(pr) {
    const cs = (pr.classes || []).filter((r) => r.cur || r.last || r.stock);
    return cs.map((r) => [r.cls, fmt(r.last), fmt(r.cur), fmt(r.stock)]);
  }
  function reportText(rep) {
    const { pr, age, ch } = rep;
    const base = MP().waText(pr);
    const lines = [base];
    if (age.length) {
      lines.push('', '🧓 Stock ageing (tags):');
      age.forEach((a) => lines.push(`• ${a.label}: total ${fmt(a.total)} · ≥1M ${fmt(a.m[0])} · ≥3M ${fmt(a.m[1])} · ≥5M ${fmt(a.m[2])} · ≥6M ${fmt(a.m[3])}${a.oldest ? ` · oldest ${fmt(a.oldest)} din` : ''}`));
    }
    lines.push('', `📅 ${rep.at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · ${ch === 'gv' ? 'GV Partner' : 'First Forward'}`);
    return lines.join('\n');
  }
  function reportCsv(rep) {
    const { pr } = rep;
    const rows = [['Field', 'Value'], ['Name', pr.name], ['ID', pr.id || ''], ['Channel', pr.channel], ['TL', (pr.tl && pr.tl.name) || ''], ['Priority', pr.priority || ''], ['Stock total', pr.stock && pr.stock.total], ['Stock VC4', pr.stock && pr.stock.vc4], ['Stock Commercial', pr.stock && pr.stock.comm], ['Last month issued', pr.totals && pr.totals.lastTotal], ['Current month issued', pr.totals && pr.totals.curTotal], [], ['Class', 'Last month', 'This month', 'Stock']];
    (pr.classes || []).forEach((r) => rows.push([r.cls, r.last, r.cur, r.stock]));
    if (rep.age.length) { rows.push([], ['Ageing group', 'Total', '>=1M', '>=3M', '>=5M', '>=6M', 'Oldest days']); rep.age.forEach((a) => rows.push([a.label, a.total, ...a.m, a.oldest])); }
    if (pr.agents && pr.agents.length) { rows.push([], ['Agent', 'ID', 'Stock', 'Last month', 'This month', 'Priority']); pr.agents.forEach((a) => rows.push([a.name, a.id, a.stockTotal, a.last, a.cur, a.priority])); }
    return rows;
  }

  // ---- PDF -----------------------------------------------------------------------------------------
  async function makePdf(rep) {
    if (FF.lazy && FF.lazy.need) { try { await FF.lazy.need('pdf'); } catch { /* ignore */ } }
    const { pr, age } = rep;
    const isTl = /tl$/.test(pr.kind);
    const brand = (FF.auth && FF.auth.settings && FF.auth.settings.brand) || FF.config.brand || 'First Forward';
    const t = pr.totals || {}, s = pr.stock || {}, m = pr.months || {};
    const d = FF.pdf.doc({ title: `${pr.name} — summary`, brand, accent: rep.ch === 'gv' ? '#059669' : '#2563eb' });
    const sub = [`${pr.channel} · ${isTl ? 'Team Leader' : 'Agent'}`, pr.id ? `ID ${pr.id}` : '', !isTl && pr.tl && pr.tl.name && !pr.direct ? `TL ${pr.tl.name}` : '', canContacts() && pr.mobile ? `Mobile ${pr.mobile}` : '', pr.priority ? `Priority ${pr.priority}` : '', pr.status ? `Status ${String(pr.status).replace(/^[^\p{L}]+/u, '')}` : ''].filter(Boolean).join('  ·  ');
    d.title(pr.name, sub);
    d.kpis([
      { label: 'Stock (total)', value: fmt(s.total), sub: `VC4 ${fmt(s.vc4)} · Comm ${fmt(s.comm)}`, color: '#2563eb' },
      { label: `Last month${m.last ? ` (${monthName(m.last)})` : ''}`, value: fmt(t.lastTotal), sub: `VC4 ${fmt(t.lastVc4)} · Comm ${fmt(t.lastComm)}`, color: '#7c3aed' },
      { label: `This month${m.cur ? ` (${monthName(m.cur)})` : ''}`, value: fmt(t.curTotal), sub: `VC4 ${fmt(t.curVc4)} · Comm ${fmt(t.curComm)}`, color: '#059669' },
      { label: 'Growth / expected', value: pr.growth || (pr.growthNum != null ? `${pr.growthNum.toFixed(1)}%` : '—'), sub: pr.projT1 && pr.projT1.total ? `month-end ~${fmt(pr.projT1.total)}` : '', color: '#db2777' }
    ]);
    const dsp = pr.dispatch || {};
    d.text(`Cover ${dsp.cover != null ? `${fmt(dsp.cover, true)} din` : '—'}  ·  Suggested (${dsp.days || ''} din): VC4 ${fmt(dsp.sugVc4)} · Comm ${fmt(dsp.sugComm)} (stock ke baad)  ·  w/o stock: VC4 ${fmt(dsp.sugVc4Gross || 0)} · Comm ${fmt(dsp.sugCommGross || 0)}`, { size: 3.1, color: '#475569' });
    const cr = classRows(pr);
    if (cr.length) {
      d.heading('Issuance & stock — class-wise');
      d.table([{ h: 'Class', w: 2 }, { h: m.last ? `Last (${monthName(m.last)})` : 'Last month', w: 2, align: 'right' }, { h: m.cur ? `This (${monthName(m.cur)})` : 'This month', w: 2, align: 'right' }, { h: 'Stock', w: 2, align: 'right' }], cr);
    }
    d.heading('Stock ageing', '#b45309');
    if (age.length) d.table([{ h: 'Group', w: 3 }, { h: 'Total', w: 1.4, align: 'right' }, { h: '≥ 1 mahina', w: 1.6, align: 'right' }, { h: '≥ 3 mahine', w: 1.6, align: 'right' }, { h: '≥ 5 mahine', w: 1.6, align: 'right' }, { h: '≥ 6 mahine', w: 1.6, align: 'right' }, { h: 'Oldest (din)', w: 1.6, align: 'right' }], age.map((a) => [a.label.replace(/[🚗🚚]\s?/u, ''), fmt(a.total), ...a.m.map((x) => fmt(x)), a.oldest ? fmt(a.oldest) : '—']), { headColor: '#92400e' });
    else d.text(rep.ageErr ? `Ageing data abhi available nahi (${rep.ageErr}).` : 'Is agent / TL ke stock ki ageing data nahi mila.', { color: '#64748b' });
    if (isTl && pr.agents && pr.agents.length) {
      d.heading(`TL ke agents (${pr.agents.length})`, '#047857');
      d.table([{ h: 'Agent', w: 4 }, { h: 'Stock', w: 1.4, align: 'right' }, { h: 'Last', w: 1.4, align: 'right' }, { h: 'This month', w: 1.6, align: 'right' }, { h: 'Priority', w: 1.4 }],
        pr.agents.slice(0, 120).map((a) => [`${a.name}${a.id ? ` (${a.id})` : ''}`, fmt(a.stockTotal), fmt(a.last), fmt(a.cur), a.priority || '—']), { headColor: '#065f46' });
    }
    const canv = d.finish(`${brand} · ${rep.at.toLocaleString('en-IN')}`);
    return FF.pdf.build(canv);
  }
  const fileBase = (rep) => `${U.slug ? U.slug(rep.pr.name) : rep.pr.name.replace(/\W+/g, '-')}-summary-${new Date().toISOString().slice(0, 10)}`;

  // ---- HTML ----------------------------------------------------------------------------------------
  const kpiCard = (label, value, foot, tone) => `<div class="kpi ${tone}"><div class="kpi-top"><span class="kpi-title">${esc(label)}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || '&nbsp;'}</div></div>`;
  function reportHtml(rep) {
    const { pr, age } = rep;
    const isTl = /tl$/.test(pr.kind);
    const t = pr.totals || {}, s = pr.stock || {}, m = pr.months || {}, dsp = pr.dispatch || {};
    const prio = pr.priority ? `<span class="badge ${/high/i.test(pr.priority) ? 'red' : /medium/i.test(pr.priority) ? 'amber' : 'green'}">${esc(pr.priority)}</span>` : '';
    const head = `<div class="as-head"><div class="as-ava">${isTl ? '👥' : '🧑‍💼'}</div><div class="as-who"><h2>${esc(pr.name)}</h2>
      <p>${esc(pr.channel)} · ${isTl ? 'Team Leader' : 'Agent'}${pr.id ? ` · ID <b>${esc(pr.id)}</b>` : ''}${!isTl && pr.tl && pr.tl.name && !pr.direct ? ` · TL <b>${esc(pr.tl.name)}</b>` : ''}${pr.direct ? ` · <span class="direct-chip">🚫 ${esc(pr.directLabel || 'Direct')}</span>` : ''}${canContacts() && pr.mobile ? ` · 📞 <a href="tel:${esc(pr.mobile)}">${esc(pr.mobile)}</a>` : ''} ${prio}</p></div>
      <div class="as-actions"><button class="btn primary" data-as="pdf">📄 Download PDF</button><button class="btn" data-as="share">📤 Share</button><button class="btn" data-as="wa">🟢 WhatsApp</button><button class="btn" data-as="copy">📋 Copy</button><button class="btn" data-as="csv">⬇ CSV</button></div></div>`;
    const kpis = `<div class="metric-grid">
      ${kpiCard('Stock (total)', fmt(s.total), `VC4 ${fmt(s.vc4)} · Comm ${fmt(s.comm)}`, 'g2')}
      ${kpiCard(`Last month${m.last ? ` · ${esc(monthName(m.last))}` : ''}`, fmt(t.lastTotal), `VC4 ${fmt(t.lastVc4)} · Comm ${fmt(t.lastComm)}`, 'g6')}
      ${kpiCard(`This month${m.cur ? ` · ${esc(monthName(m.cur))}` : ''}`, fmt(t.curTotal), `VC4 ${fmt(t.curVc4)} · Comm ${fmt(t.curComm)}`, 'g9')}
      ${kpiCard('Growth', pr.growth ? esc(pr.growth) : '—', pr.projT1 && pr.projT1.total ? `expected month-end ~${fmt(pr.projT1.total)}` : '', 'g7')}
      ${kpiCard('Stock cover', dsp.cover != null ? `${fmt(dsp.cover, true)} <small>din</small>` : '—', `suggested VC4 ${fmt(dsp.sugVc4)} · Comm ${fmt(dsp.sugComm)}`, 'g4')}
      ${isTl ? kpiCard('Agents', fmt(pr.agentCount || (pr.agents || []).length), `${fmt((pr.agents || []).filter((a) => a.cur > 0).length)} active this month`, 'g11') : kpiCard('TL stock', pr.tlStock && pr.tlStock.has ? fmt(pr.tlStock.total) : '—', pr.tl && pr.tl.name ? esc(pr.tl.name) : '', 'g11')}
    </div>`;
    const cr = classRows(pr);
    const classTbl = cr.length ? `<section class="card"><div class="card-head"><h3>🏷️ Issuance &amp; stock — class-wise</h3></div><div class="card-body"><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">Last month</th><th class="num">This month</th><th class="num">Stock</th></tr></thead><tbody>${cr.map((r) => `<tr><td><b>${esc(r[0])}</b></td><td class="num">${r[1]}</td><td class="num"><b>${r[2]}</b></td><td class="num">${r[3]}</td></tr>`).join('')}</tbody></table></div></div></section>` : '';
    const ageTbl = `<section class="card"><div class="card-head"><h3>🧓 Stock ageing</h3></div><div class="card-body">${age.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Group</th><th class="num">Total</th><th class="num">≥ 1 mahina</th><th class="num">≥ 3 mahine</th><th class="num">≥ 5 mahine</th><th class="num">≥ 6 mahine</th><th class="num">Oldest (din)</th></tr></thead><tbody>${age.map((a) => `<tr><td><b>${esc(a.label)}</b></td><td class="num">${fmt(a.total)}</td>${a.m.map((x, i) => `<td class="num">${x ? `<b style="color:${i >= 2 ? '#dc2626' : i === 1 ? '#d97706' : 'inherit'}">${fmt(x)}</b>` : '0'}</td>`).join('')}<td class="num">${a.oldest ? fmt(a.oldest) : '—'}</td></tr>`).join('')}</tbody></table></div>` : `<p class="dim">${rep.ageErr ? `Ageing data abhi nahi aaya (${esc(rep.ageErr)}).` : 'Is agent / TL ke stock ki ageing data nahi mila.'}</p>`}</div></section>`;
    const agentsTbl = isTl && pr.agents && pr.agents.length ? `<section class="card"><div class="card-head"><h3>👥 TL ke agents <span class="dim">${fmt(pr.agents.length)}</span></h3></div><div class="card-body"><div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th><th class="num">Stock</th><th class="num">Last</th><th class="num">This month</th><th>Priority</th></tr></thead><tbody>${pr.agents.map((a) => `<tr class="clickable" data-as-agent="${esc(a.name)}" data-as-agent-id="${esc(a.id || '')}"><td><b>${esc(a.name)}</b> <small class="dim">${esc(a.id || '')}</small></td><td class="num">${fmt(a.stockTotal)}</td><td class="num">${fmt(a.last)}</td><td class="num"><b>${fmt(a.cur)}</b></td><td>${esc(a.priority || '—')}</td></tr>`).join('')}</tbody></table></div></div></section>` : '';
    return `<div class="as-report">${head}${kpis}<div class="as-two">${classTbl}${ageTbl}</div>${agentsTbl}<p class="dim small">Report time: ${esc(rep.at.toLocaleString('en-IN'))} · numbers wahi hain jo Master Search profile me aate hain.</p></div>`;
  }

  // ---- page ----------------------------------------------------------------------------------------
  function make(ch) {
    return async function render(root, params) {
      const S = sessions[ch];
      const label = ch === 'gv' ? 'GV Partner' : 'First Forward';
      root.innerHTML = `<div class="page-head"><div><h1>📄 Agent / TL Summary <small class="dim">· ${label}</small></h1><p class="sub">Agent ya TL ka naam / ID${canContacts() ? ' / mobile' : ''} search karo → stock, issuance (last + current month) aur ageing ki report — phir <b>PDF / Share</b> karke seedha unko bhej do.</p></div></div>
        <section class="card as-search-card"><div class="card-body"><div class="as-search"><input class="input" id="as-q" placeholder="🔍 Agent / TL name, ID${canContacts() ? ', mobile' : ''}…" autocomplete="off" value="${esc(S.q)}"><div class="as-drop" id="as-drop" hidden></div></div><p class="dim small" id="as-note">${U.spinner ? '' : ''}⏳ ${label} ka agent / TL list load ho raha hai…</p></div></section>
        <div id="as-out"></div>`;
      const q = U.$('#as-q', root), drop = U.$('#as-drop', root), note = U.$('#as-note', root), out = U.$('#as-out', root);
      let people = [];
      let rep = null;
      try { people = await loadPeople(ch); note.textContent = `${fmt(people.filter((p) => !p.isTl).length)} agents · ${fmt(people.filter((p) => p.isTl).length)} TLs — kisi ko bhi search karo.`; }
      catch (err) { note.innerHTML = `⚠️ List load nahi hui: ${esc((err && err.message) || err)} — sheets load hone par (auto-retry) dobara kholo.`; }
      const show = async (p) => {
        S.person = p; S.q = p.name; q.value = p.name; drop.hidden = true;
        out.innerHTML = U.spinner(`${p.name} ki report ban rahi hai…`);
        try { rep = await buildReport(personOf(p)); out.innerHTML = reportHtml(rep); bindReport(); }
        catch (err) { out.innerHTML = U.errorBox(err); }
      };
      const bindReport = () => {
        U.$$('[data-as]', out).forEach((b) => b.addEventListener('click', async () => {
          if (!rep) return;
          const op = b.dataset.as;
          if (op === 'copy') { const ok = await U.copyText(reportText(rep)); U.toast(ok ? '📋 Summary copy ho gayi' : 'Copy nahi hua', ok ? 'ok' : 'warn'); return; }
          if (op === 'wa') { window.open(`https://wa.me/?text=${encodeURIComponent(reportText(rep))}`, '_blank', 'noopener'); return; }
          if (op === 'csv') { U.downloadCsv(`${fileBase(rep)}.csv`, ['Field', 'Value'], reportCsv(rep).slice(1).map((r) => r.length ? r : [''])); return; }
          U.setButtonBusy && U.setButtonBusy(b, true, 'PDF ban rahi…');
          try {
            const blob = await makePdf(rep);
            if (op === 'pdf') { FF.pdf.download(blob, `${fileBase(rep)}.pdf`); U.toast('📄 PDF download ho gayi', 'ok'); }
            else { const r = await FF.pdf.share(blob, `${fileBase(rep)}.pdf`, reportText(rep)); if (r === 'downloaded') U.toast('📄 PDF download ho gayi — WhatsApp me attach karke bhejo', 'ok'); }
          } catch (err) { U.toast(`PDF nahi bani: ${(err && err.message) || err}`, 'err'); }
          finally { U.setButtonBusy && U.setButtonBusy(b, false); }
        }));
        U.$$('[data-as-agent]', out).forEach((tr) => tr.addEventListener('click', () => {
          const p = people.find((x) => !x.isTl && (x.sub && x.sub === tr.dataset.asAgentId || norm(x.name) === norm(tr.dataset.asAgent)));
          if (p) { show(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        }));
      };
      const paint = () => {
        const hits = matchPeople(people, q.value);
        S.q = q.value;
        if (!hits.length) { drop.hidden = true; return; }
        drop.innerHTML = hits.map((p, i) => `<button type="button" class="as-opt" data-i="${i}"><span>${p.isTl ? '👥' : '🧑‍💼'} <b>${esc(p.name)}</b> <small class="dim">${esc(p.sub)}</small></span><small class="dim">${p.isTl ? 'TL' : p.direct ? 'Direct agent' : p.tl ? `TL ${esc(p.tl)}` : 'Agent'}</small></button>`).join('');
        drop.hidden = false;
        drop.querySelectorAll('.as-opt').forEach((el) => el.addEventListener('mousedown', (e) => { e.preventDefault(); show(hits[Number(el.dataset.i)]); }));
      };
      q.addEventListener('input', paint);
      q.addEventListener('focus', paint);
      q.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 150));
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const h = matchPeople(people, q.value); if (h[0]) { e.preventDefault(); show(h[0]); } } });
      const want = clean((params && (params.q || params.agent || params.tl)) || '');
      if (want) { const h = matchPeople(people, want).find((p) => norm(p.name) === norm(want)) || matchPeople(people, want)[0]; if (h) show(h); }
      else if (S.person) show(S.person);
    };
  }

  FF.agentSummary = { buildReport, makePdf, reportText, reportCsv, reportHtml, matchPeople, ageRows };
  FF.pages.ffAgentSummary = { title: 'Agent / TL Summary (FF)', render: make('ff') };
  FF.pages.gvAgentSummary = { title: 'Agent / TL Summary (GV)', render: make('gv') };
})(window.FF);
