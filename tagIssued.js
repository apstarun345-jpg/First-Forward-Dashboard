/* GV & FF Tag Issued — date-wise detailed issuance page
   Date chunne par GV aur FF ka niche issuance batata hai detailed me — VC4, Commercial, class-wise up/down */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;

  const kpi = (cls, title, icon, value, foot) => `<div class="kpi ${cls}"><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
  const card = (title, body, right) => `<section class="card"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  const mini = (label, value, foot, cls) => `<div class="mini-kpi ${cls||''}"><span class="mini-label">${esc(label)}</span><span class="mini-value">${value}</span>${foot?`<span class="mini-foot">${foot}</span>`:''}</div>`;

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${U.pad2(d.getMonth()+1)}-${U.pad2(d.getDate())}`;
  }

  function parseInputDate(val) {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d) ? null : d;
  }

  function getDailyForDate(daily, dateObj) {
    const ym = U.ymKey(dateObj);
    const day = dateObj.getDate();
    const rows = daily.filter(r => r.ym === ym && r.day === day);
    const total = U.sum(rows, r => r.n);
    const vc4 = U.sum(rows.filter(r => r.group === 'VC4'), r => r.n);
    const vc20 = U.sum(rows.filter(r => r.group === 'VC20'), r => r.n);
    const vc5p = U.sum(rows.filter(r => r.group === 'VC5+'), r => r.n);
    const comm = vc20 + vc5p;
    const byClass = {};
    rows.forEach(r => { byClass[r.cls] = (byClass[r.cls]||0)+r.n; });
    const byType = {};
    rows.forEach(r => { const t = r.type || 'ISSUANCE'; byType[t] = (byType[t]||0)+r.n; });
    const byChannel = {};
    rows.forEach(r => { const ch = r.channel || 'First Forward'; byChannel[ch] = (byChannel[ch]||0)+r.n; });
    return { date: dateObj, ym, day, total, vc4, vc20, vc5p, comm, byClass, byType, byChannel, rows };
  }

  function getGvForDate(dateObj) {
    const ym = U.ymKey(dateObj);
    const day = dateObj.getDate();
    const all = G.rows().filter(r => r.ym === ym && r.day === day);
    const total = all.length;
    const vc4 = all.filter(r => r.group === 'VC4').length;
    const vc20 = all.filter(r => r.group === 'VC20').length;
    const vc5p = all.filter(r => r.group === 'VC5+').length;
    const comm = vc20 + vc5p;
    const byClass = {};
    all.forEach(r => { byClass[r.cls] = (byClass[r.cls]||0)+1; });
    return { date: dateObj, ym, day, total, vc4, vc20, vc5p, comm, byClass, rows: all };
  }

  function growthBadge(cur, prev) {
    if (prev === null || prev === undefined) return '<span class="badge gray">—</span>';
    const g = U.growth(cur, prev);
    if (g === null) return '<span class="badge gray">—</span>';
    const up = g > 0.5;
    const down = g < -0.5;
    const cls = up ? 'green' : down ? 'red' : 'gray';
    const arrow = up ? '▲' : down ? '▼' : '•';
    return `<span class="badge ${cls}">${arrow} ${U.fmtSigned(g,0)}</span>`;
  }

  async function render(root, params) {
    const initialDate = params.date || todayKey();
    root.innerHTML = `<div class="page-head"><div><h1>🏷️ GV & FF Tag Issued</h1><p class="sub">Date-wise detailed issuance — VC4 / Commercial / class-wise up-down, GV + First Forward</p></div>
      <div class="head-actions"><button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div class="card controls"><div class="ctrl-row">
        <label>📅 Date <input type="date" class="input" id="ti-date" value="${esc(initialDate)}" max="${todayKey()}"></label>
        <button class="btn" id="ti-today">Today</button>
        <button class="btn" id="ti-yest">Yesterday</button>
        <span class="dim small">Date select karte hi niche GV & FF ka detailed issuance ayega</span>
      </div></div>
      <div id="ti-body">${U.spinner('Data load ho raha hai…')}</div>`;

    const body = U.$('#ti-body', root);
    const dateInput = U.$('#ti-date', root);

    // Ensure data loaded
    try {
      await Promise.all([S.need('daily').catch(()=>[]), G.need('master').catch(()=>[])]);
    } catch (e) {
      body.innerHTML = U.errorBox(e, 'data-action="refresh"');
      return;
    }

    async function draw() {
      const val = dateInput.value || todayKey();
      const dateObj = parseInputDate(val);
      if (!dateObj) { body.innerHTML = `<div class="empty-state">Invalid date</div>`; return; }

      // Update URL without reload
      const newHash = `#/tagIssued?date=${val}`;
      if (location.hash !== newHash) history.replaceState(null, '', newHash);

      const daily = S.get('daily') || [];
      const ffData = getDailyForDate(daily.filter(r => r.channel !== 'GV Partner'), dateObj);
      const allData = getDailyForDate(daily, dateObj);
      const gvData = getGvForDate(dateObj);

      // Previous day for growth
      const prevDate = new Date(dateObj); prevDate.setDate(prevDate.getDate()-1);
      const ffPrev = getDailyForDate(daily.filter(r => r.channel !== 'GV Partner'), prevDate);
      const gvPrev = getGvForDate(prevDate);
      const allPrev = getDailyForDate(daily, prevDate);

      // Week ago same weekday
      const weekAgo = new Date(dateObj); weekAgo.setDate(weekAgo.getDate()-7);
      const ffWeek = getDailyForDate(daily.filter(r => r.channel !== 'GV Partner'), weekAgo);
      const gvWeek = getGvForDate(weekAgo);

      const total = ffData.total + gvData.total;
      const totalPrev = ffPrev.total + gvPrev.total;

      const kpis = [
        kpi('g2', `Total Issued · ${U.labelDate(dateObj,true)}`, '🏷️', U.fmt(total), `${growthBadge(total, totalPrev)} vs prev day (${U.fmt(totalPrev)}) · FF <b>${U.fmt(ffData.total)}</b> · GV <b>${U.fmt(gvData.total)}</b>`),
        kpi('g3', 'FF · VC4', '🚗', U.fmt(ffData.vc4), `${growthBadge(ffData.vc4, ffPrev.vc4)} vs prev · Commercial <b>${U.fmt(ffData.comm)}</b> · share ${U.fmtPct(U.pctOf(ffData.vc4, ffData.total),0)}`),
        kpi('g5', 'GV · VC4', '🚀', U.fmt(gvData.vc4), `${growthBadge(gvData.vc4, gvPrev.vc4)} vs prev · Commercial <b>${U.fmt(gvData.comm)}</b> · share ${U.fmtPct(U.pctOf(gvData.vc4, gvData.total),0)}`),
        kpi('g4', 'Commercial Total', '🚚', U.fmt(ffData.comm + gvData.comm), `FF ${U.fmt(ffData.comm)} (VC20 ${U.fmt(ffData.vc20)} + VC5+ ${U.fmt(ffData.vc5p)}) · GV ${U.fmt(gvData.comm)}`),
        kpi('g1', 'FF Growth vs Week Ago', '📈', growthBadge(ffData.total, ffWeek.total), `Week ago ${U.labelDate(weekAgo,true)}: <b>${U.fmt(ffWeek.total)}</b> · GV week ago: <b>${U.fmt(gvWeek.total)}</b>`),
        kpi('g9', 'Class Mix Today', '🔖', Object.keys(allData.byClass).length ? Object.entries(allData.byClass).sort((a,b)=>b[1]-a[1])[0][0] : '—', Object.entries(allData.byClass).map(([k,v])=>`${k} <b>${U.fmt(v)}</b>`).join(' · '))
      ];

      // Class-wise table
      const allClasses = U.uniq([...Object.keys(ffData.byClass), ...Object.keys(gvData.byClass), ...Object.keys(ffPrev.byClass), ...Object.keys(gvPrev.byClass)]).sort((a,b)=>{
        const na = parseInt(a.replace(/\D/g,''),10)||999;
        const nb = parseInt(b.replace(/\D/g,''),10)||999;
        return na-nb;
      });
      const classRows = allClasses.map(cls => {
        const ffCur = ffData.byClass[cls]||0;
        const gvCur = gvData.byClass[cls]||0;
        const ffPr = ffPrev.byClass[cls]||0;
        const gvPr = gvPrev.byClass[cls]||0;
        const totCur = ffCur+gvCur;
        const totPr = ffPr+gvPr;
        return `<tr><td><b>${esc(cls)}</b> <small class="dim">${esc(M.classGroup(cls))}</small></td>
          <td class="num"><b>${U.fmt(ffCur)}</b></td><td class="num">${U.fmt(ffPr)}</td><td class="num">${growthBadge(ffCur, ffPr)}</td>
          <td class="num"><b>${U.fmt(gvCur)}</b></td><td class="num">${U.fmt(gvPr)}</td><td class="num">${growthBadge(gvCur, gvPr)}</td>
          <td class="num"><b>${U.fmt(totCur)}</b></td><td class="num">${U.fmt(totPr)}</td><td class="num">${growthBadge(totCur, totPr)}</td></tr>`;
      }).join('');

      // Detailed breakdown cards
      const ffChart = C.bars({
        labels: ['VC4','VC20','VC5+','Commercial','Total'],
        height: 200,
        series: [
          { name: U.labelDate(prevDate), values: [ffPrev.vc4, ffPrev.vc20, ffPrev.vc5p, ffPrev.comm, ffPrev.total], color: '#c7d2fe' },
          { name: U.labelDate(dateObj), values: [ffData.vc4, ffData.vc20, ffData.vc5p, ffData.comm, ffData.total], color: '#6366f1' }
        ],
        legendAlways: true
      });
      const gvChart = C.bars({
        labels: ['VC4','VC20','VC5+','Commercial','Total'],
        height: 200,
        series: [
          { name: U.labelDate(prevDate), values: [gvPrev.vc4, gvPrev.vc20, gvPrev.vc5p, gvPrev.comm, gvPrev.total], color: '#99f6e4' },
          { name: U.labelDate(dateObj), values: [gvData.vc4, gvData.vc20, gvData.vc5p, gvData.comm, gvData.total], color: '#0d9488' }
        ],
        legendAlways: true
      });

      // Hourly? Not available, but show TL wise for that day if possible
      const tlMapFF = new Map();
      allData.rows.forEach(r => {
        // EIR daily doesn't have TL in daily aggregation, so we need to approximate from agents? 
        // We'll show class-wise instead
      });

      body.innerHTML = `
        <div class="kpi-grid">${kpis.join('')}</div>
        <div class="grid g-2">
          ${card(`🟦 First Forward · ${U.labelDate(dateObj,true)} <span class="dim">vs ${U.labelDate(prevDate,true)}</span>`, ffChart, `<span class="badge indigo">${U.fmt(ffData.total)} tags</span>`)}
          ${card(`🟩 GV Partner · ${U.labelDate(dateObj,true)} <span class="dim">vs ${U.labelDate(prevDate,true)}</span>`, gvChart, `<span class="badge teal">${U.fmt(gvData.total)} tags</span>`)}
        </div>
        ${card(`📋 Class-wise Detailed · ${U.labelDate(dateObj,true)}`, `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">FF Today</th><th class="num">FF Prev</th><th>FF Growth</th><th class="num">GV Today</th><th class="num">GV Prev</th><th>GV Growth</th><th class="num">Total Today</th><th class="num">Total Prev</th><th>Total Growth</th></tr></thead><tbody>${classRows || '<tr><td colspan="10" class="empty">Is date par koi data nahi</td></tr>'}</tbody></table></div>`, `<button class="btn small" data-action="export" data-name="tag-issued-${val}">⬇ CSV</button>`)}
        <div class="grid g-2">
          ${card(`🔍 FF Breakdown · ${U.labelDate(dateObj,true)}`, `<div class="grid g-2" style="margin-bottom:0">${mini('Total', U.fmt(ffData.total), `Prev ${U.fmt(ffPrev.total)} · ${U.fmtSigned(U.growth(ffData.total, ffPrev.total)||0,0)}`)}${mini('VC4 Share', U.fmtPct(U.pctOf(ffData.vc4, ffData.total),0), `VC4 ${U.fmt(ffData.vc4)} / ${U.fmt(ffData.total)}`)}${mini('Commercial', U.fmt(ffData.comm), `VC20 ${U.fmt(ffData.vc20)} · VC5+ ${U.fmt(ffData.vc5p)}`)}${mini('Issuance vs Replacement', `${U.fmt(ffData.byType['ISSUANCE']||0)} / ${U.fmt(ffData.byType['REPLACEMENT']||0)}`, 'Type split')}</div>`, '')}
          ${card(`🔍 GV Breakdown · ${U.labelDate(dateObj,true)}`, `<div class="grid g-2" style="margin-bottom:0">${mini('Total', U.fmt(gvData.total), `Prev ${U.fmt(gvPrev.total)} · ${U.fmtSigned(U.growth(gvData.total, gvPrev.total)||0,0)}`)}${mini('VC4 Share', U.fmtPct(U.pctOf(gvData.vc4, gvData.total),0), `VC4 ${U.fmt(gvData.vc4)} / ${U.fmt(gvData.total)}`)}${mini('Commercial', U.fmt(gvData.comm), `VC20 ${U.fmt(gvData.vc20)} · VC5+ ${U.fmt(gvData.vc5p)}`)}${mini('Top Class Today', Object.entries(gvData.byClass).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—', Object.entries(gvData.byClass).map(([k,v])=>`${k}:${v}`).join(' ') )}</div>`, '')}
        </div>
        <div class="grid g-2">
          ${card(`📈 Trend Last 14 Days (ending ${U.labelDate(dateObj)})`, (() => {
            const days = [];
            const ffVals = [];
            const gvVals = [];
            for (let i=13;i>=0;i--) {
              const d = new Date(dateObj); d.setDate(d.getDate()-i);
              const f = getDailyForDate(daily.filter(r=>r.channel!=='GV Partner'), d);
              const g = getGvForDate(d);
              days.push(U.labelDate(d));
              ffVals.push(f.total);
              gvVals.push(g.total);
            }
            return C.lines({ labels: days, height: 220, series: [
              { name: 'First Forward', values: ffVals, color: '#6366f1' },
              { name: 'GV Partner', values: gvVals, color: '#0d9488' }
            ]});
          })(), '')}
          ${card('💡 Insights', `<ul class="insight-list">
            <li>Selected date <b>${U.labelDate(dateObj,true)}</b> par total <b>${U.fmt(total)}</b> tags issued — FF <b>${U.fmt(ffData.total)}</b> (${U.fmtPct(U.pctOf(ffData.total,total),0)}) aur GV <b>${U.fmt(gvData.total)}</b> (${U.fmtPct(U.pctOf(gvData.total,total),0)}).</li>
            <li>FF VC4 share <b>${U.fmtPct(U.pctOf(ffData.vc4, ffData.total),0)}</b> vs GV VC4 share <b>${U.fmtPct(U.pctOf(gvData.vc4, gvData.total),0)}</b> — ${U.pctOf(gvData.vc4, gvData.total) > U.pctOf(ffData.vc4, ffData.total) ? 'GV ka payable mix better hai' : 'FF ka payable mix better hai'}.</li>
            <li>Growth vs previous day: FF <b>${U.fmtSigned(U.growth(ffData.total, ffPrev.total)||0,0)}</b>, GV <b>${U.fmtSigned(U.growth(gvData.total, gvPrev.total)||0,0)}</b>, Total <b>${U.fmtSigned(U.growth(total, totalPrev)||0,0)}</b>.</li>
            <li>Commercial (NVC4) total <b>${U.fmt(ffData.comm + gvData.comm)}</b> — FF ${U.fmt(ffData.comm)} vs GV ${U.fmt(gvData.comm)}.</li>
            <li>Top class today: <b>${Object.entries(allData.byClass).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—'}</b> with ${U.fmt(Object.entries(allData.byClass).sort((a,b)=>b[1]-a[1])[0]?.[1]||0)} tags.</li>
          </ul>`, '')}
        </div>
        <p class="foot-note">Source: EIR (FF) + GV Master (GV) · Selected date ${val} · Data ${U.timeLabel(S.loadedAt||G.loadedAt||Date.now())} · ↻ se fresh data</p>
      `;
      C.mount(body);
    }

    dateInput.addEventListener('change', draw);
    U.$('#ti-today', root).addEventListener('click', () => { dateInput.value = todayKey(); draw(); });
    U.$('#ti-yest', root).addEventListener('click', () => { const d = new Date(); d.setDate(d.getDate()-1); dateInput.value = `${d.getFullYear()}-${U.pad2(d.getMonth()+1)}-${U.pad2(d.getDate())}`; draw(); });

    await draw();
  }

  FF.pages.tagIssued = { title: 'GV & FF Tag Issued', render };
})(window.FF);
