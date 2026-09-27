/* Dedicated, chart-only GV vs First Forward analytics page. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;
  const card = (title, content, right = '') => `<section class="card"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${content}</div></section>`;
  const todayKey = () => U.dateKey(new Date());
  const date = (key) => { const [y,m,d] = String(key).split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const out = new Date(d); out.setDate(out.getDate() + n); return out; };
  const dayKey = (row) => row.key || (row.date ? U.dateKey(row.date) : '');

  async function render(root, params = {}) {
    root.innerHTML = `<div class="page-head"><div><h1>📊 GV vs First Forward · Charts</h1><p class="sub">Chart-only view · issuance mix, daily trend, replacements, exceptions and agent rankings</p></div><div class="head-actions"><button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div class="card controls"><div class="ctrl-row ti-range-controls"><label>📅 From <input class="input" type="date" id="cx-from" max="${todayKey()}"></label><label>To <input class="input" type="date" id="cx-to" max="${todayKey()}"></label><button class="btn" id="cx-week">Last 7 days</button><button class="btn" id="cx-month">Last 30 days</button></div></div>
      <div id="cx-output">${U.spinner('Charts ke liye latest data load ho raha hai…')}</div>`;
    const output = U.$('#cx-output', root), fromEl = U.$('#cx-from', root), toEl = U.$('#cx-to', root);
    const results = await Promise.allSettled([S.need('daily'), S.need('agents'), G.need('master')]);
    if (!root.isConnected) return;
    if (results[0].status !== 'fulfilled' || results[2].status !== 'fulfilled') {
      output.innerHTML = U.errorBox(results.find((x) => x.status === 'rejected')?.reason || new Error('Issuance data could not be loaded.'), 'data-action="refresh"');
      return;
    }
    const daily = results[0].value || [];
    const agentData = results[1].status === 'fulfilled' ? results[1].value || [] : [];
    const latest = [M.latestDate(daily), G.latestDate()].filter(Boolean).sort((a,b) => b-a)[0];
    const latestKey = latest ? U.dateKey(latest) : todayKey();
    const firstRender = !params.from && !params.to;
    const defaultTo = params.to || params.date || latestKey;
    const defaultFrom = params.from || (firstRender ? U.dateKey(addDays(date(defaultTo), -29)) : defaultTo);
    fromEl.value = defaultFrom; toEl.value = defaultTo;

    function draw() {
      const from = fromEl.value || latestKey, to = toEl.value || latestKey;
      if (from > to) { output.innerHTML = '<div class="warn-box">From date, To date se pehle honi chahiye.</div>'; return; }
      const ffRows = daily.filter((r) => r.channel !== 'GV Partner' && dayKey(r) >= from && dayKey(r) <= to);
      const gvRows = G.rows().filter((r) => { const key = r.date ? U.dateKey(r.date) : ''; return key >= from && key <= to; });
      const dates = [];
      for (let d = date(from), end = date(to); d <= end && dates.length < 181; d = addDays(d, 1)) dates.push(U.dateKey(d));
      const countFor = (rows, key) => rows.reduce((n, r) => n + (dayKey(r) === key ? (r.n === undefined ? 1 : r.n) : 0), 0);
      const trend = C.lines({ labels: dates.map((x) => x.slice(5)), tipLabels: dates.map((x) => U.labelDate(date(x), true)), height: 260, series: [
        { name: 'First Forward', values: dates.map((x) => countFor(ffRows, x)), color: '#6366f1' },
        { name: 'GV Partner', values: dates.map((x) => countFor(gvRows, x)), color: '#0d9488' }
      ] });
      const summary = (rows, gv = false) => {
        const s = { total: 0, vc4: 0, vc20: 0, vc5p: 0, replacement: 0, issuance: 0, chassis: 0, wrongVrn: 0 };
        rows.forEach((r) => {
          const n = r.n === undefined ? 1 : r.n; s.total += n;
          if (r.group === 'VC4') s.vc4 += n; else if (r.group === 'VC20') s.vc20 += n; else s.vc5p += n;
          if (/replacement/i.test(r.type || r.status || '')) s.replacement += n; else s.issuance += n;
          if (/chassis/i.test(r.vrnType || r.tagType || '')) s.chassis += n;
          if (!gv && /wrong/i.test(r.vrnType || '')) s.wrongVrn += n;
        });
        s.comm = s.vc20 + s.vc5p; return s;
      };
      const ff = summary(ffRows), gv = summary(gvRows, true);
      const classChart = C.bars({ labels: ['VC4','VC20','VC5+','Commercial'], height: 250, series: [
        { name: 'First Forward', values: [ff.vc4,ff.vc20,ff.vc5p,ff.comm], color: '#6366f1' },
        { name: 'GV Partner', values: [gv.vc4,gv.vc20,gv.vc5p,gv.comm], color: '#0d9488' }
      ], legendAlways: true });
      const opsChart = C.bars({ labels: ['Issuance','Replacement','Chassis','Wrong VRN'], height: 230, series: [
        { name: 'First Forward', values: [ff.issuance,ff.replacement,ff.chassis,ff.wrongVrn], color: '#6366f1' },
        { name: 'GV Partner', values: [gv.issuance,gv.replacement,gv.chassis,0], color: '#0d9488' }
      ], legendAlways: true });
      const people = new Map(), teams = new Map();
      gvRows.forEach((r) => {
        const name = r.agentName || r.agentId || 'Unknown';
        const a = people.get(name) || { total: 0, vc4: 0, commercial: 0 };
        a.total++; if (r.group === 'VC4') a.vc4++; else a.commercial++; people.set(name,a);
        const tl = r.tlName || 'Direct'; teams.set(tl,(teams.get(tl)||0)+1);
      });
      const top = (key) => [...people].sort((a,b) => b[1][key]-a[1][key]).slice(0,12);
      const bars = (data, key, label) => C.hbars({ items: data.map(([name,a],i) => ({ label: name, value: typeof a === 'number' ? a : a[key], sub: typeof a === 'number' ? '' : `Total ${U.fmt(a.total)} · VC4 ${U.fmt(a.vc4)} · Commercial ${U.fmt(a.commercial)}`, color: C.PALETTE[i%C.PALETTE.length] })), valueLabel: label });
      const months = new Set(ffRows.map((r) => r.ym));
      const ffAgents = new Map();
      agentData.forEach((a) => { if (a.channel === 'First Forward' && months.has(a.ym)) ffAgents.set(a.name,(ffAgents.get(a.name)||0)+a.n); });
      const topFf = U.topEntries(ffAgents, 12).map(([name,n],i)=>({ label:name,value:n,color:C.PALETTE[i%C.PALETTE.length] }));
      const totalsDonut = C.donut({ items: [{ label: 'First Forward', value: ff.total, color: '#6366f1' }, { label: 'GV Partner', value: gv.total, color: '#0d9488' }], subtitle: `${U.labelDate(date(from),true)} to ${U.labelDate(date(to),true)}` });
      const tooLong = dates.length >= 181 ? '<p class="dim small">Daily chart me pehle 180 din dikhaye gaye hain.</p>' : '';
      output.innerHTML = `<div class="chart-range-note">${esc(U.labelDate(date(from),true))} – ${esc(U.labelDate(date(to),true))} · FF ${U.fmt(ff.total)} tags · GV ${U.fmt(gv.total)} tags · Total ${U.fmt(ff.total+gv.total)}</div>
        <div class="grid g-2">${card('📈 Daily issuance trend · GV vs FF', `${trend}${tooLong}`)}${card('🤝 Total share by channel', totalsDonut)}</div>
        <div class="grid g-2">${card('🏷️ Vehicle class comparison', classChart)}${card('🔧 Issuance, replacement & exceptions', `${opsChart}<p class="dim small">GV source me separate Wrong VRN field available nahi hai; GV ka Wrong VRN chart value unavailable hai.</p>`)}</div>
        <div class="grid g-2">${card('🏆 Top GV agents · all tags', bars(top('total'),'total','Tags'))}${card('🚗 Top GV VC4 agents', bars(top('vc4'),'vc4','VC4 tags'))}</div>
        <div class="grid g-2">${card('🚚 Top GV Commercial agents', bars(top('commercial'),'commercial','Commercial tags'))}${card('🏢 Top GV TLs / supervisors', C.hbars({items:U.topEntries(teams,12).map(([label,value],i)=>({label,value,color:C.PALETTE[(i+4)%C.PALETTE.length]})),valueLabel:'Tags'}))}</div>
        ${card('⭐ Top First Forward agents · month-level source', C.hbars({items:topFf,valueLabel:'Tags'}) + '<p class="dim small">FF agent totals are available by month only; partial-month date ranges include the full month(s).')}`;
      C.mount(output);
      history.replaceState(null, '', `#/charts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    }
    fromEl.addEventListener('change', draw); toEl.addEventListener('change', draw);
    U.$('#cx-week',root).addEventListener('click',()=>{toEl.value=latestKey;fromEl.value=U.dateKey(addDays(date(latestKey),-6));draw();});
    U.$('#cx-month',root).addEventListener('click',()=>{toEl.value=latestKey;fromEl.value=U.dateKey(addDays(date(latestKey),-29));draw();});
    draw();
  }
  FF.pages.charts = { title: 'GV vs FF Charts', render };
})(window.FF);
