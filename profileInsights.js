/* 📈 PROFILE INSIGHTS — Master Search / drawer profile ke andar "Team health + Top 10 + Daily chart".
     • TL profile  : 8 clickable boxes (agents · active · inactive · inactive this month / 2 months / 2+ months ·
                     de-growth · high growth) — click par wahi agents ki poori list (sort + CSV) neeche khulti hai.
     • TL profile  : Top 10 agents VC4 · VC20 · VC5+ (this month / last month toggle).
     • Agent profile: activity boxes (issued · growth · run-rate · active days · last issued · best day).
     • Dono me     : current month ka din-wise stacked bar chart (VC4 / VC20 / VC5+), hover par din ka split +
                     us din tak ka run-rate, dashed run-rate line aur last month ki line.
   FF aur GV dono ke liye — rows FF.masterProfile.insightRows(pr) se aati hain (FF: EIR daily · GV: GV Master by TL ID),
   isliye numbers profile ke baaki numbers wale hi source se bante hain. UI English (site ka default). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const fmt = (n, d) => U.fmt(n, d);
  const GROUPS = ['VC4', 'VC20', 'VC5+'];
  const COLORS = { VC4: '#6366f1', VC20: '#ec4899', 'VC5+': '#f59e0b' };
  const HIGH_GROWTH = 20;            // % — run-rate growth vs last month
  const norm = (s) => String(s === null || s === undefined ? '' : s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const normId = (v) => String(v === null || v === undefined ? '' : v).trim().replace(/\.0+$/, '').toUpperCase();
  const num = (v) => Number(v) || 0;
  const blank = () => ({ VC4: 0, VC20: 0, 'VC5+': 0, t: 0 });

  // ------------------------------------------------------------------ box definitions
  const BOXES = [
    { id: 'all', label: 'Total agents', tone: 'indigo', hint: 'Every agent under this TL', pick: () => true },
    { id: 'active', label: 'Active this month', tone: 'green', hint: 'Issued at least 1 tag this month', pick: (a) => a.bucket === 'active' },
    { id: 'inactive', label: 'Inactive', tone: 'red', hint: 'No issuance this month', pick: (a) => a.bucket !== 'active' },
    { id: 'in0', label: 'Inactive this month', tone: 'amber', hint: 'Issued last month · nothing yet this month', pick: (a) => a.bucket === 'in0' },
    { id: 'in2', label: 'Inactive 2 months', tone: 'orange', hint: 'Nothing this & last month · issued 2 months ago', pick: (a) => a.bucket === 'in2' },
    { id: 'in3', label: 'Inactive 2+ months', tone: 'rose', hint: 'No issuance for 3+ months (or never)', pick: (a) => a.bucket === 'in3' },
    { id: 'degrowth', label: 'De-growth', tone: 'red', hint: 'Active, but fewer tags than the same days last month', pick: (a) => a.bucket === 'active' && a.growth !== null && a.growth < 0 },
    { id: 'high', label: `High growth (≥ +${HIGH_GROWTH}%)`, tone: 'green', hint: 'Up strongly vs the same days last month', pick: (a) => a.bucket === 'active' && a.growth !== null && a.growth >= HIGH_GROWTH }
  ];
  const BOX_BY_ID = Object.fromEntries(BOXES.map((b) => [b.id, b]));
  const SORTS = {
    name: (a, b) => a.name.localeCompare(b.name),
    cur: (a, b) => b.cur.t - a.cur.t,
    last: (a, b) => b.last.t - a.last.t,
    rate: (a, b) => b.rate - a.rate,
    growth: (a, b) => (b.growth === null ? -1e9 : b.growth) - (a.growth === null ? -1e9 : a.growth),
    lastKey: (a, b) => String(b.lastKey || '').localeCompare(String(a.lastKey || ''))
  };
  const DEFAULT_SORT = { all: 'cur', active: 'cur', inactive: 'lastKey', in0: 'last', in2: 'lastKey', in3: 'lastKey', degrowth: 'growth-rev', high: 'growth' };

  // ------------------------------------------------------------------ analysis
  const cache = new WeakMap();
  const ui = new Map();        // per profile: { box, sort, top }
  const keyOf = (pr) => `${pr.kind}|${norm(pr.name)}|${normId(pr.id)}`;
  const uiOf = (pr) => { const k = keyOf(pr); if (!ui.has(k)) ui.set(k, { box: '', sort: '', top: 'cur' }); return ui.get(k); };

  function dataReady(pr) {
    try {
      if (pr.ch === 'gv') return !!(FF.gv && FF.gv.get && Array.isArray(FF.gv.get('master')));
      const d = FF.store && FF.store.get && FF.store.get('daily');
      return Array.isArray(d) && d.length > 0;
    } catch { return false; }
  }

  function analyze(pr) {
    const hit = cache.get(pr);
    if (hit) return hit;
    const ch = pr.ch === 'gv' ? 'gv' : 'ff';
    const isTl = /tl$/.test(pr.kind || '');
    const rows = (FF.masterProfile && FF.masterProfile.insightRows ? FF.masterProfile.insightRows(pr) : []) || [];
    const now = new Date();
    const curYm = U.ymKey(now), lastYm = U.prevMonthKey(curYm), prev2Ym = U.prevMonthKey(lastYm);
    const dim = U.daysInMonth(curYm), dimLast = U.daysInMonth(lastYm);
    let elapsed = Number(U.runRateDays(undefined, ch)) || now.getDate();
    elapsed = Math.max(1, Math.min(dim, elapsed));

    // --- roster (agents under the TL, excluding the TL's own row)
    const roster = isTl ? (pr.agents || []) : [];
    const agents = [];
    const byId = new Map(), byName = new Map();
    const add = (name, id, extra) => {
      const a = Object.assign({ name: name || id || 'Unknown', id: id || '', mobile: '', status: '', priority: '', isSelf: false,
        cur: blank(), last: blank(), lastMtd: 0, p2: 0, older: 0, lastKey: '', daysCur: new Set(), bucket: 'in3', rate: 0, growth: null }, extra || {});
      a.isSelf = isTl && (norm(a.name) === norm(pr.name) || (!!pr.selfAgent && ((!!a.id && normId(pr.selfAgent.id) === normId(a.id)) || norm(pr.selfAgent.name) === norm(a.name))));
      agents.push(a);
      if (a.id) byId.set(normId(a.id), a);
      if (norm(a.name) && !byName.has(norm(a.name))) byName.set(norm(a.name), a);
      return a;
    };
    roster.forEach((r) => add(r.name, r.id, { mobile: r.mobile || '', status: r.status || '', priority: r.priority || '' }));

    // --- fold rows into per-agent stats + per-day series
    const days = Array.from({ length: dim }, (_, i) => ({ day: i + 1, key: `${curYm}-${U.pad2(i + 1)}`, VC4: 0, VC20: 0, 'VC5+': 0, t: 0, last: 0 }));
    const lastByDay = Array.from({ length: dimLast + 1 }, () => 0);
    const monthTot = { cur: blank(), last: blank(), lastMtd: 0 };
    const cutDay = Math.min(elapsed, dimLast);   // same calendar days of last month (like the profile's own growth %)
    for (const r of rows) {
      const g = GROUPS.includes(r.group) ? r.group : 'VC5+';
      let a = (r.agentId && byId.get(normId(r.agentId))) || (r.agentName && byName.get(norm(r.agentName))) || null;
      if (!a && isTl) a = add(r.agentName, r.agentId, {});
      if (!a) a = (agents[0] || add(pr.name, pr.id, {}));
      if (r.ym === curYm) {
        a.cur[g] += r.n; a.cur.t += r.n; a.daysCur.add(r.key);
        monthTot.cur[g] += r.n; monthTot.cur.t += r.n;
        const d = days[Number(r.key.slice(8, 10)) - 1];
        if (d) { d[g] += r.n; d.t += r.n; }
      } else if (r.ym === lastYm) {
        a.last[g] += r.n; a.last.t += r.n;
        monthTot.last[g] += r.n; monthTot.last.t += r.n;
        lastByDay[Number(r.key.slice(8, 10))] += r.n;
        if (Number(r.key.slice(8, 10)) <= cutDay) { a.lastMtd += r.n; monthTot.lastMtd += r.n; }
      } else if (r.ym === prev2Ym) a.p2 += r.n;
      else if (r.ym < prev2Ym) a.older += r.n;
      if (!a.lastKey || r.key > a.lastKey) a.lastKey = r.key;
    }
    days.forEach((d) => { d.last = lastByDay[d.day] || 0; });
    // cumulative run-rate per day (till that day)
    const cum = blank();
    days.forEach((d) => { GROUPS.forEach((g) => { cum[g] += d[g]; }); cum.t += d.t; d.rate = { VC4: cum.VC4 / d.day, VC20: cum.VC20 / d.day, 'VC5+': cum['VC5+'] / d.day, t: cum.t / d.day }; });

    const todayKey = U.dateKey(now);
    const daysAgo = (key) => key ? Math.max(0, Math.round((U.fromDateKey(todayKey) - U.fromDateKey(key)) / 864e5)) : null;
    agents.forEach((a) => {
      a.rate = a.cur.t / elapsed;
      a.growth = a.lastMtd > 0 ? ((a.cur.t - a.lastMtd) / a.lastMtd) * 100 : null;
      a.bucket = a.cur.t > 0 ? 'active' : a.last.t > 0 ? 'in0' : a.p2 > 0 ? 'in2' : 'in3';
      a.ago = daysAgo(a.lastKey);
      a.activeDays = a.daysCur.size;
    });
    const team = agents.filter((a) => !a.isSelf);
    const counts = {};
    BOXES.forEach((b) => { counts[b.id] = team.filter(b.pick).length; });
    const total = monthTot.cur.t, lastTotal = monthTot.last.t;
    const rate = { VC4: monthTot.cur.VC4 / elapsed, VC20: monthTot.cur.VC20 / elapsed, 'VC5+': monthTot.cur['VC5+'] / elapsed, t: total / elapsed };
    const lastRate = lastTotal / dimLast;
    const best = days.reduce((m, d) => (d.t > (m ? m.t : 0) ? d : m), null);
    const out = {
      ch, isTl, curYm, lastYm, dim, dimLast, elapsed, cutDay, days, team, counts, monthTot, rate, lastRate,
      growth: monthTot.lastMtd > 0 ? ((total - monthTot.lastMtd) / monthTot.lastMtd) * 100 : null,
      projected: Math.round(rate.t * dim), best, activeDays: days.filter((d) => d.t > 0).length,
      rowCount: rows.length, ready: dataReady(pr), me: isTl ? null : agents[0] || null
    };
    cache.set(pr, out);
    return out;
  }

  // ------------------------------------------------------------------ small html helpers
  const pct = (p) => (p === null || p === undefined ? '<span class="dim">—</span>' : U.pctHtml(Math.abs(p) < 0.5 ? 0 : p, { decimals: 0 }));
  const dayLabel = (key) => { try { return U.labelDateKey(key); } catch { return key; } };
  const agoText = (a) => (a.lastKey ? `${dayLabel(a.lastKey)} <small class="dim">${a.ago === 0 ? 'today' : `${a.ago}d ago`}</small>` : '<span class="dim">No issuance on record</span>');
  const split = (b) => `<span class="pi-split"><i style="--c:${COLORS.VC4}">${fmt(b.VC4)}</i><i style="--c:${COLORS.VC20}">${fmt(b.VC20)}</i><i style="--c:${COLORS['VC5+']}">${fmt(b['VC5+'])}</i></span>`;
  const agentAttrs = (pr, a) => `data-mp-agent="${esc(a.name)}" data-mp-kind="${pr.ch}-agent" data-mp-id="${esc(a.id || '')}"`;

  // ------------------------------------------------------------------ team boxes + list
  function boxesHtml(pr, an, st) {
    const n = Math.max(1, an.counts.all);
    return `<div class="pi-boxes" role="group" aria-label="Team health">${BOXES.map((b) => {
      const c = an.counts[b.id];
      const share = b.id === 'all' ? '' : `${Math.round((c / n) * 100)}% of agents`;
      return `<button type="button" class="pi-box t-${b.tone}${st.box === b.id ? ' on' : ''}${c ? '' : ' zero'}" data-pi-box="${b.id}" aria-pressed="${st.box === b.id}" title="${esc(b.hint)}">
        <small>${esc(b.label)}</small><b>${fmt(c)}</b><em>${share || esc(b.hint)}</em></button>`;
    }).join('')}</div>`;
  }

  function sortedList(an, boxId, sortKey) {
    const list = an.team.filter(BOX_BY_ID[boxId].pick);
    const [key, dir] = String(sortKey || DEFAULT_SORT[boxId] || 'cur').split('-');
    const fn = SORTS[key] || SORTS.cur;
    list.sort((a, b) => (dir === 'rev' ? -fn(a, b) : fn(a, b)) || b.cur.t - a.cur.t || a.name.localeCompare(b.name));
    return list;
  }

  function panelHtml(pr, an, st) {
    if (!st.box || !BOX_BY_ID[st.box]) return '<div class="pi-panel-empty dim small">👆 Click any box above to see exactly which agents are in it.</div>';
    const box = BOX_BY_ID[st.box];
    const sortKey = st.sort || DEFAULT_SORT[st.box];
    const list = sortedList(an, st.box, sortKey);
    const [sk, sd] = String(sortKey).split('-');
    const th = (key, label, cls) => `<th class="${cls || ''} pi-sortable${sk === key ? ' on' : ''}" data-pi-sort="${sk === key ? (sd === 'rev' ? key : `${key}-rev`) : key}" role="button" tabindex="0" title="Sort">${label}${sk === key ? (sd === 'rev' ? ' ▲' : ' ▼') : ''}</th>`;
    const rows = list.map((a, i) => `<tr class="clickable" ${agentAttrs(pr, a)}>
      <td class="dim">${i + 1}</td>
      <td><b>${esc(a.name)}</b><small class="cell-sub">${esc(a.id || '')}${a.status ? ` · ${esc(a.status)}` : ''}</small></td>
      <td>${a.mobile ? `<a href="tel:${esc(a.mobile)}" onclick="event.stopPropagation()">📞 ${esc(a.mobile)}</a>` : '<span class="dim">—</span>'}</td>
      <td class="num">${split(a.cur)}</td>
      <td class="num"><b>${fmt(a.cur.t)}</b></td>
      <td class="num">${fmt(a.last.t)}</td>
      <td class="num">${fmt(a.rate, 1)}</td>
      <td class="num">${pct(a.growth)}</td>
      <td>${agoText(a)}</td></tr>`).join('');
    return `<div class="pi-panel-head"><div><b>${esc(box.label)}</b> · ${fmt(list.length)} agent${list.length === 1 ? '' : 's'}<small class="dim"> — ${esc(box.hint)}</small></div>
      <div class="pi-panel-actions"><button type="button" class="btn small" data-pi-csv>⬇ CSV</button><button type="button" class="btn small" data-pi-close>✕ Close</button></div></div>
      ${list.length ? `<div class="table-wrap pi-table"><table class="tbl compact"><thead><tr><th>#</th>${th('name', 'Agent')}<th>Mobile</th><th class="num">This month <small class="dim">VC4 · VC20 · VC5+</small></th>${th('cur', 'Total', 'num')}${th('last', 'Last month', 'num')}${th('rate', 'Run-rate/day', 'num')}${th('growth', 'Growth', 'num')}${th('lastKey', 'Last issued')}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="dim small">Growth = tags issued 1–${an.cutDay} this month vs the same days last month. Tap an agent to open the full profile.</p>`
        : '<p class="dim small pi-none">🎉 Nobody here right now.</p>'}`;
  }

  // ------------------------------------------------------------------ top 10
  function topHtml(pr, an, st) {
    const which = st.top === 'last' ? 'last' : 'cur';
    const cards = GROUPS.map((g) => {
      const list = an.team.filter((a) => a[which][g] > 0).sort((a, b) => b[which][g] - a[which][g] || b[which].t - a[which].t || a.name.localeCompare(b.name)).slice(0, 10);
      const max = list.length ? list[0][which][g] : 1;
      const other = which === 'cur' ? 'last' : 'cur';
      const sum = an.team.reduce((s, a) => s + a[which][g], 0);
      return `<div class="pi-top" style="--c:${COLORS[g]}"><h5><i></i>${g} <small class="dim">${fmt(sum)} total · ${fmt(an.team.filter((a) => a[which][g] > 0).length)} agents</small></h5>
        ${list.length ? `<ol>${list.map((a, i) => `<li class="clickable" ${agentAttrs(pr, a)}>
          <span class="pi-rk">${i + 1}</span><span class="pi-nm"><b>${esc(a.name)}</b><small class="dim">${esc(a.id || '')}</small></span>
          <span class="pi-bar"><u style="width:${Math.max(4, Math.round((a[which][g] / max) * 100))}%"></u></span>
          <span class="pi-val"><b>${fmt(a[which][g])}</b><small class="dim">${other === 'last' ? 'last' : 'this'} ${fmt(a[other][g])}</small></span></li>`).join('')}</ol>`
          : `<p class="dim small pi-none">No ${g} issuance ${which === 'cur' ? 'this month' : 'last month'}.</p>`}</div>`;
    }).join('');
    return `<div class="pi-top-wrap"><div class="pi-top-head"><h5>🏆 Top 10 agents by class</h5>
      <div class="pi-seg" role="group" aria-label="Period"><button type="button" class="${which === 'cur' ? 'on' : ''}" data-pi-top="cur">This month · ${esc(U.labelYM(an.curYm))}</button><button type="button" class="${which === 'last' ? 'on' : ''}" data-pi-top="last">Last month · ${esc(U.labelYM(an.lastYm))}</button></div></div>
      <div class="pi-tops">${cards}</div></div>`;
  }

  // ------------------------------------------------------------------ chart
  const VBW = 900, VBH = 300, PL = 44, PR = 12, PT = 16, PB = 28;
  function niceMax(v) {
    if (v <= 4) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function chartSvg(an) {
    const { days, dim, elapsed } = an;
    const maxV = niceMax(Math.max(1, ...days.map((d) => Math.max(d.t, d.last)), an.rate.t * 1.1));
    const plotW = VBW - PL - PR, plotH = VBH - PT - PB, colW = plotW / dim, bw = Math.max(3, colW * 0.62);
    const y = (v) => PT + plotH - (v / maxV) * plotH;
    const ticks = [0, 1, 2, 3, 4].map((i) => (maxV / 4) * i);
    let g = ticks.map((t) => `<line class="pi-grid" x1="${PL}" x2="${VBW - PR}" y1="${y(t)}" y2="${y(t)}"/><text class="pi-ax" x="${PL - 6}" y="${y(t) + 3}" text-anchor="end">${fmt(Math.round(t * 10) / 10)}</text>`).join('');
    days.forEach((d, i) => {
      const x = PL + i * colW + (colW - bw) / 2;
      let acc = 0;
      GROUPS.forEach((k) => {
        if (!d[k]) return;
        const h = (d[k] / maxV) * plotH;
        g += `<rect class="pi-bar-seg" x="${x.toFixed(1)}" y="${(y(acc) - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" rx="1.5" fill="${COLORS[k]}"/>`;
        acc += d[k];
      });
      if (d.day > elapsed && !d.t) g += `<rect x="${x.toFixed(1)}" y="${PT + plotH - 2}" width="${bw.toFixed(1)}" height="2" fill="currentColor" opacity=".12"/>`;
      if (d.day % 2 === 1 || d.day === dim) g += `<text class="pi-ax" x="${(PL + i * colW + colW / 2).toFixed(1)}" y="${VBH - 10}" text-anchor="middle">${d.day}</text>`;
    });
    // last month (same day) line
    const pts = days.filter((d) => d.day <= an.dimLast).map((d) => `${(PL + (d.day - 1) * colW + colW / 2).toFixed(1)},${y(d.last).toFixed(1)}`).join(' ');
    if (an.monthTot.last.t) g += `<polyline class="pi-last" points="${pts}"/>`;
    // run-rate line
    if (an.rate.t > 0) g += `<line class="pi-rr" x1="${PL}" x2="${VBW - PR}" y1="${y(an.rate.t)}" y2="${y(an.rate.t)}"/><text class="pi-rr-t" x="${VBW - PR - 2}" y="${y(an.rate.t) - 4}" text-anchor="end">run-rate ${fmt(an.rate.t, 1)}/day</text>`;
    g += `<rect class="pi-hl" x="0" y="${PT}" width="${colW.toFixed(1)}" height="${plotH}" style="display:none"/>`;
    return `<svg class="pi-svg" viewBox="0 0 ${VBW} ${VBH}" role="img" aria-label="Day-wise issuance this month" data-pi-geom="${PL},${colW.toFixed(3)},${dim},${VBW}">${g}</svg>`;
  }

  function chartHtml(pr, an) {
    const r = an.rate;
    const chip = (k) => `<span class="pi-chip" style="--c:${COLORS[k]}"><i></i>${k} <b>${fmt(r[k], 1)}</b>/day <small class="dim">${fmt(an.monthTot.cur[k])} tags</small></span>`;
    const live = an.ch === 'gv' ? 'GV is live (today included)' : "FF data arrives T+1 — today's bar fills tomorrow";
    const legend = `${GROUPS.map((k) => `<span class="pi-lg"><i style="--c:${COLORS[k]}"></i>${k}</span>`).join('')}<span class="pi-lg"><i class="ln last"></i>Last month</span><span class="pi-lg"><i class="ln rr"></i>Run-rate</span>`;
    return `<div class="pi-chart-card"><div class="pi-chart-head"><h5>📊 Day-wise issuance · ${esc(U.labelYM(an.curYm))}</h5><div class="pi-legend">${legend}</div></div>
      <div class="pi-rates"><span class="pi-chip total"><i></i>Total <b>${fmt(r.t, 1)}</b>/day <small class="dim">${fmt(an.monthTot.cur.t)} tags</small></span>${GROUPS.map(chip).join('')}
        <span class="pi-chip proj">Month-end at this pace <b>${fmt(an.projected)}</b> ${an.growth === null ? '' : pct(an.growth)}<small class="dim"> vs same days last month</small></span></div>
      <div class="pi-chart-wrap" data-pi-chart><div class="pi-inner">${chartSvg(an)}<div class="pi-tip" role="status" aria-live="polite" hidden></div></div></div>
      <p class="dim small">Hover (or tap) a bar for that day's VC4 · VC20 · VC5+ split and the run-rate till that day. ${esc(live)}. Active on ${an.activeDays} of ${an.elapsed} days${an.best ? ` · best day <b>${esc(dayLabel(an.best.key))}</b> (${fmt(an.best.t)})` : ''}.</p></div>`;
  }

  function tipHtml(an, d) {
    const row = (k) => `<div><i style="--c:${COLORS[k]}"></i>${k}<b>${fmt(d[k])}</b><small>${fmt(d.rate[k], 1)}/day</small></div>`;
    const future = d.day > an.elapsed && !d.t;
    return `<strong>${esc(dayLabel(d.key))}</strong>${future ? '<div class="dim">No data yet</div>' : `${GROUPS.map(row).join('')}<div class="pi-tip-t"><span>Total</span><b>${fmt(d.t)}</b><small>${fmt(d.rate.t, 1)}/day</small></div>`}
      <div class="pi-tip-l dim">Run-rate shown = average per day from 1st to this day · last month same day: <b>${fmt(d.last)}</b></div>`;
  }

  // ------------------------------------------------------------------ agent boxes
  function agentBoxesHtml(pr, an) {
    const a = an.me || { cur: blank(), last: blank(), lastMtd: 0, lastKey: '', ago: null, bucket: 'in3', growth: null, rate: 0, activeDays: 0 };
    const state = { active: ['Active this month', 'green'], in0: ['Inactive this month', 'amber'], in2: ['Inactive 2 months', 'orange'], in3: ['Inactive 2+ months', 'rose'] }[a.bucket];
    const box = (label, value, em, tone, txt) => `<div class="pi-box static t-${tone}${txt ? ' txt' : ''}"><small>${esc(label)}</small><b>${value}</b><em>${em}</em></div>`;
    return `<div class="pi-boxes">
      ${box('Status', esc(state[0]), a.lastKey ? `Last issued ${esc(dayLabel(a.lastKey))} (${a.ago === 0 ? 'today' : `${a.ago}d ago`})` : 'No issuance on record', state[1], true)}
      ${box(`Issued · ${esc(U.labelYM(an.curYm))}`, fmt(a.cur.t), split(a.cur), 'indigo')}
      ${box(`Last month · ${esc(U.labelYM(an.lastYm))}`, fmt(a.last.t), split(a.last), 'slate')}
      ${box('Growth', a.growth === null ? '—' : pct(a.growth), `1–${an.cutDay} vs same days last month (${fmt(a.lastMtd)})`, a.growth !== null && a.growth < 0 ? 'red' : 'green')}
      ${box('Run-rate', `${fmt(a.rate, 1)}<small class="dim">/day</small>`, `Month-end at this pace ${fmt(Math.round(a.rate * an.dim))}`, 'sky')}
      ${box('Active days', `${fmt(a.activeDays)}<small class="dim"> / ${an.elapsed}</small>`, an.best ? `Best day ${esc(dayLabel(an.best.key))} · ${fmt(an.best.t)}` : 'No issuing day yet', 'amber')}
    </div>`;
  }

  // ------------------------------------------------------------------ public html
  function html(pr) {
    try {
      if (!pr || !FF.masterProfile || !FF.masterProfile.insightRows) return '';
      const an = analyze(pr), st = uiOf(pr);
      const title = an.isTl ? `📈 Team health &amp; performance <small class="dim">· ${fmt(an.counts.all)} agents</small>` : '📈 Activity &amp; run-rate';
      if (!an.ready && !an.rowCount) {
        return `<section class="mp-sec pi" data-mp-sec="insights" data-pi="${esc(keyOf(pr))}"><h4>${title}</h4><p class="dim small pi-none" role="status">⏳ Issuance rows are still loading — this section fills in automatically.</p></section>`;
      }
      return `<section class="mp-sec pi" data-mp-sec="insights" data-pi="${esc(keyOf(pr))}"><h4>${title}</h4>
        ${an.isTl ? `${boxesHtml(pr, an, st)}<div class="pi-panel" data-pi-panel>${panelHtml(pr, an, st)}</div>${topHtml(pr, an, st)}` : agentBoxesHtml(pr, an)}
        ${chartHtml(pr, an)}</section>`;
    } catch (e) {
      try { console.warn('profileInsights:', e); } catch { /* ignore */ }
      return '';
    }
  }

  // ------------------------------------------------------------------ events
  function csvOf(pr, an, st) {
    const list = sortedList(an, st.box, st.sort || DEFAULT_SORT[st.box]);
    const head = ['Agent', 'Agent ID', 'Mobile', 'Status', 'VC4 (this month)', 'VC20 (this month)', 'VC5+ (this month)', 'This month total', 'Last month total', 'Run-rate/day', 'Growth %', 'Last issued'];
    return { head, rows: list.map((a) => [a.name, a.id, a.mobile, a.status, a.cur.VC4, a.cur.VC20, a.cur['VC5+'], a.cur.t, a.last.t, Math.round(a.rate * 10) / 10, a.growth === null ? '' : Math.round(a.growth), a.lastKey || '']) };
  }

  function bind(el) {
    if (!el || el.__piBound) return;
    el.__piBound = true;
    const cur = () => el.__mpProfile;
    const refresh = (sec, part) => {
      const pr = cur(); if (!pr || !sec) return;
      const an = analyze(pr), st = uiOf(pr);
      if (part === 'panel') {
        const panel = sec.querySelector('[data-pi-panel]'); if (panel) panel.innerHTML = panelHtml(pr, an, st);
        sec.querySelectorAll('[data-pi-box]').forEach((b) => { const on = b.dataset.piBox === st.box; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      } else if (part === 'top') {
        const wrap = sec.querySelector('.pi-top-wrap'); if (wrap) wrap.outerHTML = topHtml(pr, an, st);
      }
    };
    el.addEventListener('click', (e) => {
      const sec = e.target.closest('.pi'); if (!sec) return;
      const pr = cur(); if (!pr) return;
      const st = uiOf(pr);
      const box = e.target.closest('[data-pi-box]');
      if (box) {
        st.box = st.box === box.dataset.piBox ? '' : box.dataset.piBox; st.sort = '';
        refresh(sec, 'panel');
        const panel = sec.querySelector('[data-pi-panel]'); if (st.box && panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      if (e.target.closest('[data-pi-close]')) { st.box = ''; refresh(sec, 'panel'); return; }
      const sort = e.target.closest('[data-pi-sort]');
      if (sort) { st.sort = sort.dataset.piSort; refresh(sec, 'panel'); return; }
      const top = e.target.closest('[data-pi-top]');
      if (top) { st.top = top.dataset.piTop; refresh(sec, 'top'); return; }
      if (e.target.closest('[data-pi-csv]')) {
        const an = analyze(pr); if (!st.box) return;
        const c = csvOf(pr, an, st);
        U.downloadCsv(`${U.slug(pr.name)}-${st.box}-${U.stamp()}.csv`, c.head, c.rows);
        return;
      }
      const wrap = e.target.closest('[data-pi-chart]');
      if (wrap) showTip(wrap, e.clientX, pr);
    });
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('[data-pi-sort]')) { e.preventDefault(); e.target.click(); }
    });
    el.addEventListener('mousemove', (e) => {
      const wrap = e.target.closest && e.target.closest('[data-pi-chart]');
      if (wrap) showTip(wrap, e.clientX, cur());
    });
    el.addEventListener('mouseout', (e) => {
      const wrap = e.target.closest && e.target.closest('[data-pi-chart]');
      if (wrap && !wrap.contains(e.relatedTarget)) hideTip(wrap);
    });
  }

  function hideTip(wrap) {
    const tip = wrap.querySelector('.pi-tip'), hl = wrap.querySelector('.pi-hl');
    if (tip) tip.hidden = true;
    if (hl) hl.style.display = 'none';
  }
  function showTip(wrap, clientX, pr) {
    if (!pr) return;
    const svg = wrap.querySelector('.pi-svg'), tip = wrap.querySelector('.pi-tip'), hl = wrap.querySelector('.pi-hl');
    if (!svg || !tip) return;
    const [pl, colW, dim, vbw] = String(svg.dataset.piGeom).split(',').map(Number);
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const vx = ((clientX - rect.left) / rect.width) * vbw;
    const idx = Math.floor((vx - pl) / colW);
    if (idx < 0 || idx >= dim) { hideTip(wrap); return; }
    const an = analyze(pr), d = an.days[idx];
    tip.innerHTML = tipHtml(an, d);
    tip.hidden = false;
    if (hl) { hl.setAttribute('x', String(pl + idx * colW)); hl.style.display = ''; }
    const px = clientX - rect.left;
    const tw = tip.offsetWidth || 220;
    const vis0 = wrap.scrollLeft, vis1 = wrap.scrollLeft + wrap.clientWidth;   // keep the tip inside the visible part (phones scroll the chart)
    let left = px + 14;
    if (left + tw > vis1 - 4) left = px - tw - 14;
    tip.style.left = `${Math.max(vis0 + 4, Math.min(vis1 - tw - 4, left))}px`;
    tip.style.top = '8px';
  }

  FF.profileInsights = { html, bind, analyze, _boxes: BOXES, _tipHtml: tipHtml, _chartSvg: chartSvg };
})(window.FF);
