/* 🚨 UNUSUAL AGENT ACTIVITY (v3.32) — "kaun si agent ki activity normal se alag hai?"
 *
 *   Rules (FF + GV dono channel, EIR daily ledger se — koi naya sheet call nahi):
 *     🚫 High Wrong VRN    — Wrong-VRN tags / issuance   channel average se kai guna zyada
 *     🔁 High Replacement  — Replacement tags / total     channel average se kai guna zyada
 *     🚘 High Chassis      — Chassis-number VRN tags / issuance zyada
 *     ⚡ Single-day spike  — ek din me apni normal (active-day) average ka 3 guna+
 *   Thresholds page par hi badal sakte ho (multiple × network avg, minimum count).
 *   Row par click → us agent ki poori detail (drawer). KPI card = filter.
 */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean;
  const num = (v) => Number(v) || 0;
  const FLAGS = {
    wrong: { label: 'High Wrong VRN', icon: '🚫', tone: 'g7' },
    replace: { label: 'High Replacement', icon: '🔁', tone: 'g8' },
    chassis: { label: 'High Chassis', icon: '🚘', tone: 'g11' },
    spike: { label: 'Single-day spike', icon: '⚡', tone: 'g5' }
  };
  const ui = { ch: 'all', period: 'last30', mult: 2, min: 3, flag: 'all', q: '' };
  let lastRows = [];

  const isReplacement = (r) => String(r.type || '').toUpperCase() === 'REPLACEMENT';
  const isWrong = (r) => /wrong/i.test(String(r.vrnType || ''));
  const isChassis = (r) => /chassis/i.test(String(r.vrnType || ''));

  /** Pure analysis — rows = EIR daily rows. Returns { rows, net, from, to } (test + page dono use karte hain). */
  function analyze(daily, o) {
    const opt = { ch: 'all', period: 'last30', mult: 2, min: 3, ...(o || {}) };
    const list = (daily || []).filter((r) => r && r.key);
    if (!list.length) return { rows: [], net: {}, from: '', to: '' };
    const last = list.reduce((m, r) => (r.key > m ? r.key : m), '');
    const lastDate = new Date(`${last}T00:00:00`);
    const ym = last.slice(0, 7);
    let from = `${ym}-01`, to = last;
    if (opt.period === 'last30') { const d = new Date(lastDate); d.setDate(d.getDate() - 29); from = U.dateKey(d); }
    else if (opt.period === 'prev') { const pm = U.prevMonthKey(ym); from = `${pm}-01`; to = `${pm}-31`; }
    const agents = new Map();
    const net = { ff: { issued: 0, wrong: 0, chassis: 0, replaced: 0 }, gv: { issued: 0, wrong: 0, chassis: 0, replaced: 0 } };
    list.forEach((r) => {
      if (r.key < from || r.key > to) return;
      const ch = r.channel === 'GV Partner' ? 'gv' : 'ff';
      if (opt.ch !== 'all' && opt.ch !== ch) return;
      const key = `${ch}|${clean(r.agentId) || clean(r.agentName).toUpperCase()}`;
      let a = agents.get(key);
      if (!a) { a = { key, ch, id: clean(r.agentId), name: clean(r.agentName) || clean(r.agentId) || '—', tlName: clean(r.tlName), issued: 0, wrong: 0, chassis: 0, replaced: 0, days: new Map() }; agents.set(key, a); }
      if (!a.tlName && clean(r.tlName)) a.tlName = clean(r.tlName);
      const n = num(r.n);
      if (isReplacement(r)) { a.replaced += n; net[ch].replaced += n; }
      else {
        a.issued += n; net[ch].issued += n;
        a.days.set(r.key, (a.days.get(r.key) || 0) + n);
        if (isWrong(r)) { a.wrong += n; net[ch].wrong += n; }
        if (isChassis(r)) { a.chassis += n; net[ch].chassis += n; }
      }
    });
    const rate = (a, b) => (b > 0 ? a / b : 0);
    const netRate = (ch) => ({
      wrong: rate(net[ch].wrong, net[ch].issued),
      chassis: rate(net[ch].chassis, net[ch].issued),
      replace: rate(net[ch].replaced, net[ch].issued + net[ch].replaced)
    });
    const nr = { ff: netRate('ff'), gv: netRate('gv') };
    const floor = 0.05; // 5% se kam ko kabhi "high" nahi maante (average bahut chhota ho tab bhi)
    const rows = [...agents.values()].map((a) => {
      const total = a.issued + a.replaced;
      a.wrongRate = rate(a.wrong, a.issued); a.chassisRate = rate(a.chassis, a.issued); a.replaceRate = rate(a.replaced, total);
      const n = nr[a.ch];
      a.flags = [];
      if (a.wrong >= opt.min && a.wrongRate >= Math.max(floor, n.wrong * opt.mult)) a.flags.push('wrong');
      if (a.replaced >= opt.min && a.replaceRate >= Math.max(floor, n.replace * opt.mult)) a.flags.push('replace');
      if (a.chassis >= opt.min && a.chassisRate >= Math.max(floor, n.chassis * opt.mult)) a.flags.push('chassis');
      const vals = [...a.days.values()];
      const peak = vals.length ? Math.max(...vals) : 0;
      a.avgDay = vals.length ? a.issued / vals.length : 0; a.peak = peak;
      if (vals.length >= 3 && peak >= 10 && peak >= a.avgDay * 3 && peak >= (a.issued - peak) / Math.max(1, vals.length - 1) * 3) a.flags.push('spike');
      a.score = a.flags.length * 100 + a.wrongRate * 100 + a.replaceRate * 100 + a.chassisRate * 100;
      a.days = null;
      return a;
    }).filter((a) => a.issued + a.replaced > 0).sort((x, y) => y.score - x.score || (y.issued - x.issued));
    return { rows, net, netRate: nr, from, to: to > last ? last : to };
  }

  const pct = (v) => `${(num(v) * 100).toFixed(1)}%`;
  const kpi = (icon, label, value, foot, tone, flag) => `<div class="kpi ${tone}" data-un-flag="${flag}" style="cursor:pointer"><div class="kpi-top"><span class="kpi-title">${label}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;

  async function render(root, params) {
    const p = params || {};
    if (p.ch) ui.ch = p.ch; if (p.flag) ui.flag = p.flag;
    root.innerHTML = U.spinner('Agents ki activity check ho rahi hai…');
    let daily;
    try { daily = await FF.store.need('daily'); } catch (err) { root.innerHTML = U.errorBox(err); return; }
    const out = analyze(daily, ui);
    lastRows = out.rows;
    const flagged = out.rows.filter((a) => a.flags.length);
    const by = (f) => flagged.filter((a) => a.flags.includes(f));
    const shown = out.rows.filter((a) => {
      if (ui.flag === 'all' ? !a.flags.length : !a.flags.includes(ui.flag)) return false;
      return !ui.q || [a.name, a.id, a.tlName].join(' ').toLowerCase().includes(ui.q.toLowerCase());
    });
    const badge = (a) => a.flags.map((f) => `<span class="badge ${f === 'wrong' ? 'red' : f === 'replace' ? 'amber' : f === 'chassis' ? 'purple' : 'blue'}" title="${FLAGS[f].label}">${FLAGS[f].icon} ${FLAGS[f].label.replace('High ', '')}</span>`).join(' ');
    const hot = (v, on) => (on ? `<b style="color:#dc2626">${v}</b>` : v);
    const sel = (id, opts, cur) => `<select class="input" id="${id}">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const nrF = out.netRate && out.netRate.ff, nrG = out.netRate && out.netRate.gv;
    root.innerHTML = `<div class="page-head"><div><h1>🚨 Unusual Agent Activity</h1><p class="sub">Jinki <b>Wrong VRN</b>, <b>Replacement</b> ya <b>Chassis</b> wali tags channel average se bahut zyada hain (ya ek din me achanak spike) — period <b>${esc(out.from)} → ${esc(out.to)}</b>. Row par click = agent ki poori detail.</p></div>
      <div class="head-actions"><button class="btn small" id="un-csv">⬇ CSV</button></div></div>
      <div class="metric-grid">
        ${kpi('🚫', 'High Wrong VRN', U.fmt(by('wrong').length), `FF avg ${pct(nrF && nrF.wrong)} · GV avg ${pct(nrG && nrG.wrong)}`, 'g7', 'wrong')}
        ${kpi('🔁', 'High Replacement', U.fmt(by('replace').length), `FF avg ${pct(nrF && nrF.replace)} · GV avg ${pct(nrG && nrG.replace)}`, 'g8', 'replace')}
        ${kpi('🚘', 'High Chassis', U.fmt(by('chassis').length), `FF avg ${pct(nrF && nrF.chassis)} · GV avg ${pct(nrG && nrG.chassis)}`, 'g11', 'chassis')}
        ${kpi('⚡', 'Single-day spike', U.fmt(by('spike').length), 'ek din = normal ka 3x+', 'g5', 'spike')}
        ${kpi('🧾', 'Total flagged', U.fmt(flagged.length), `${U.fmt(flagged.filter((a) => a.flags.length > 1).length)} agents me 2+ flags`, 'g1', 'all')}
      </div>
      <section class="card"><div class="card-head"><h3>${ui.flag === 'all' ? 'Flagged agents' : `${FLAGS[ui.flag].icon} ${FLAGS[ui.flag].label}`} <span class="dim">${U.fmt(shown.length)}</span></h3></div>
        <div class="card-body">
          <div class="un-filters" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:10px">
            <label>Channel ${sel('un-ch', [['all', 'FF + GV'], ['ff', '🟦 First Forward'], ['gv', '🟩 GV Partner']], ui.ch)}</label>
            <label>Period ${sel('un-period', [['last30', 'Last 30 din'], ['mtd', 'Is mahine (MTD)'], ['prev', 'Pichla mahina']], ui.period)}</label>
            <label>Average se kitna guna ${sel('un-mult', [[1.5, '1.5×'], [2, '2×'], [3, '3×'], [5, '5×']], ui.mult)}</label>
            <label>Min tags ${sel('un-min', [[2, '2'], [3, '3'], [5, '5'], [10, '10']], ui.min)}</label>
            <label>Find <input class="input" id="un-q" value="${esc(ui.q)}" placeholder="Agent / TL / ID"></label>
          </div>
          <div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Ch</th><th>Agent</th><th>TL</th><th class="num">Issued</th><th class="num">Wrong VRN</th><th class="num">Chassis</th><th class="num">Replaced</th><th class="num">Peak day</th><th>Flags</th></tr></thead><tbody>
          ${shown.map((a) => `<tr class="clickable" data-kd-agent="${esc(a.name)}" data-kd-agent-id="${esc(a.id)}" data-kd-agent-channel="${a.ch}"><td>${a.ch === 'gv' ? '🟩 GV' : '🟦 FF'}</td><td><b>${esc(a.name)}</b> <small class="dim">${esc(a.id)}</small></td><td>${esc(a.tlName || '—')}</td><td class="num">${U.fmt(a.issued)}</td><td class="num">${hot(`${U.fmt(a.wrong)} <small>(${pct(a.wrongRate)})</small>`, a.flags.includes('wrong'))}</td><td class="num">${hot(`${U.fmt(a.chassis)} <small>(${pct(a.chassisRate)})</small>`, a.flags.includes('chassis'))}</td><td class="num">${hot(`${U.fmt(a.replaced)} <small>(${pct(a.replaceRate)})</small>`, a.flags.includes('replace'))}</td><td class="num">${U.fmt(a.peak)}</td><td>${badge(a)}</td></tr>`).join('') || `<tr><td colspan="9" class="dim">${ui.flag === 'all' ? '✅ Is period me koi agent flag nahi hua.' : 'Is rule me koi agent nahi mila.'}</td></tr>`}
          </tbody></table></div>
          <p class="dim small">Rule: agent ka rate ≥ <b>${ui.mult}×</b> channel average (aur kam se kam 5%) aur tags ≥ <b>${ui.min}</b>. Replacement rate = replaced ÷ (issued + replaced). Spike = ek din ≥ 10 tags aur apni normal din-average ka 3×+.</p>
        </div></section>`;
    const re = () => render(root, {});
    const bind = (id, key, conv) => { const el = U.$(`#${id}`, root); if (el) el.addEventListener('change', () => { ui[key] = conv ? conv(el.value) : el.value; re(); }); };
    bind('un-ch', 'ch'); bind('un-period', 'period'); bind('un-mult', 'mult', Number); bind('un-min', 'min', Number);
    const q = U.$('#un-q', root);
    if (q) q.addEventListener('change', () => { ui.q = q.value; re(); });
    U.$$('[data-un-flag]', root).forEach((c) => c.addEventListener('click', () => { ui.flag = c.dataset.unFlag; re(); }));
    const csv = U.$('#un-csv', root);
    if (csv) csv.addEventListener('click', () => U.downloadCsv(`unusual-activity-${U.stamp()}.csv`,
      ['Channel', 'Agent', 'Agent ID', 'TL', 'Issued', 'Wrong VRN', 'Wrong %', 'Chassis', 'Chassis %', 'Replaced', 'Replacement %', 'Peak day', 'Flags'],
      shown.map((a) => [a.ch === 'gv' ? 'GV Partner' : 'First Forward', a.name, a.id, a.tlName, a.issued, a.wrong, pct(a.wrongRate), a.chassis, pct(a.chassisRate), a.replaced, pct(a.replaceRate), a.peak, a.flags.map((f) => FLAGS[f].label).join(' · ')])));
  }

  FF.unusual = { analyze, FLAGS, get rows() { return lastRows; } };
  FF.pages.unusual = { title: 'Unusual Activity', render };
})(window.FF);
