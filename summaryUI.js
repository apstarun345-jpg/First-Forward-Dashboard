/* 🎨 AGENT / TL SUMMARY v2 (v3.45) — naya colourful interface, clickable KPI, source-explanation.
 *
 *  Do channel, ek hi design:  🟩 GV Partner  ·  🟦 First Forward
 *    • Hero card (gradient) — kaun, ID, TL, mobile, badges.
 *    • 8 bade KPI cards — har card par: number, VC4/Comm split, aur "sheet/ledger" cross-check chip.
 *      Card par click = us number ke NEECHE ki asli rows (GV Master tags: VRN barcode / TAG_ID / date /
 *      class / status / agent / TL) — drawer me, CSV download ke saath.
 *    • Har KPI ke saath ek line explanation: number kahan se aaya, kaunsa source final hai.
 *    • Class-wise table (colour bars), 6-mahine ka trend, TL ke liye agent table, ageing, alerts.
 *    • "🔍 Data check" panel — GV REPORT / GV Master / Tag Assignment ki heading mapping + jo bhi farq hai.
 *
 *  GV ke numbers FF.gvTruth se aate hain (GV Master ledger = final, Tag Assignment = stock, GV REPORT =
 *  cross-check). FF ke numbers pehle jaise hi (EIR + REPORT + StockDataa) — sirf dikhne ka tarika naya hai.
 */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean, fmt = U.fmt;
  const norm = (s) => clean(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const mob10 = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d; };
  const MP = () => FF.masterProfile;
  const can = (perm) => { try { return !FF.auth || FF.auth.can(perm); } catch { return true; } };
  const canContacts = () => can('contacts');

  // ---- html bits -----------------------------------------------------------------------------------
  const pct = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${Number(v) >= 0 ? '+' : ''}${Math.round(Number(v))}%`);
  function growthTone(v) { return v === null || v === undefined ? '' : Number(v) >= 0 ? 'good' : 'bad'; }
  function chipHtml(text, tone) { return `<span class="gs-chip ${tone || ''}">${text}</span>`; }
  const srcChip = (label, tone) => `<span class="gs-src ${tone || ''}">${label}</span>`;
  /** ledger (final) vs doosre sources — chip: "Sheet 332 (Δ +108)" */
  function crossChip(c) {
    if (!c || !c.others || !c.others.length) return '';
    return c.others.map((o) => `<span class="gs-x ${o.diff === 0 ? 'ok' : 'diff'}" title="${esc(o.label)}: ${fmt(o.value)} · final se farq ${o.diff > 0 ? '+' : ''}${fmt(o.diff)}">${esc(o.label.replace(/\s*\(.*\)\s*$/, ''))} <b>${fmt(o.value)}</b>${o.diff === 0 ? ' ✓' : ` <i>(${o.diff > 0 ? '+' : ''}${fmt(o.diff)})</i>`}</span>`).join('');
  }
  const bar = (n, max, tone) => `<span class="gs-bar ${tone || ''}"><i style="width:${max ? Math.max(2, Math.round((n / max) * 100)) : 0}%"></i></span>`;

  // ---- KPI cards -----------------------------------------------------------------------------------
  function card(o) { return { unit: '', ...o }; }
  function cardsHtml(v) {
    return `<div class="gs-kpis">${v.cards.map((k) => `
      <button type="button" class="gs-kpi ${k.tone || ''}" data-gs-kpi="${esc(k.key)}" title="${esc(k.explain || 'Click = neeche ki rows')}">
        <span class="gs-kpi-top"><span class="gs-kpi-label">${k.icon || ''} ${esc(k.label)}</span><span class="gs-kpi-tap">rows ▸</span></span>
        <span class="gs-kpi-value">${k.valueText !== undefined ? k.valueText : (typeof k.value === 'string' ? esc(k.value) : fmt(k.value))}${k.unit ? ` <small>${esc(k.unit)}</small>` : ''}</span>
        <span class="gs-kpi-sub">${k.sub || ''}</span>
        ${k.check ? `<span class="gs-kpi-x">${crossChip(k.check)}</span>` : ''}
        <span class="gs-kpi-why">${esc(k.why || '')}</span>
      </button>`).join('')}</div>`;
  }

  // ---- report shell --------------------------------------------------------------------------------
  function heroHtml(v) {
    const isGv = v.ch === 'gv';
    return `<div class="gs-hero ${isGv ? 'gv' : 'ff'}">
      <div class="gs-hero-ava">${v.kind === 'tl' ? '👥' : '🧑‍💼'}</div>
      <div class="gs-hero-who">
        <div class="gs-hero-badges">
          <span class="gs-pill">${isGv ? '🟩 GV Partner' : '🟦 First Forward'}</span>
          <span class="gs-pill alt">${v.kind === 'tl' ? '👥 Team Leader' : '🧑‍💼 Agent'}</span>
          ${v.direct ? `<span class="gs-pill warn">🚫 ${esc(v.directLabel || 'Direct (no TL)')}</span>` : ''}
          ${v.priority ? `<span class="gs-pill ${/high/i.test(v.priority) ? 'bad' : /med/i.test(v.priority) ? 'mid' : 'ok'}">🔺 ${esc(v.priority)}</span>` : ''}
          ${v.activity ? `<span class="gs-pill ${/active/i.test(v.activity) ? 'ok' : 'bad'}">${esc(v.activity)}${v.inactive ? ` · ${esc(v.inactive)}` : ''}</span>` : ''}
          ${srcChip(isGv ? '🧾 GV Master final' : '🧾 EIR ledger', 'ledger')}
          ${srcChip(isGv ? '📑 GV REPORT cross-check' : '📑 REPORT sheet', 'sheet')}
        </div>
        <h2>${esc(v.name)}</h2>
        <p class="gs-hero-line">${v.id ? `<span>ID <b>${esc(v.id)}</b></span>` : ''}
          ${v.tlName && v.kind !== 'tl' ? `<span>TL <b>${esc(v.tlName)}</b>${v.tlId ? ` (${esc(v.tlId)})` : ''}</span>` : ''}
          ${v.kind === 'tl' ? `<span>Team <b>${fmt(v.team ? v.team.length : 0)}</b> agents</span>` : ''}
          ${v.mobile && canContacts() ? `<span>📞 <a href="tel:${esc(v.mobile)}">${esc(v.mobile)}</a></span>` : ''}
          <span>Basis <b>${esc(v.ym)}</b> · last month <b>${esc(v.lastYm)}</b></span></p>
      </div>
      <div class="gs-hero-act">
        ${can('export') ? `<button class="btn" data-gs-act="pdf">📄 PDF</button><button class="btn" data-gs-act="excel">📊 Excel</button><button class="btn" data-gs-act="csv">⬇ CSV</button>` : ''}
        ${can('share') ? `<button class="btn" data-gs-act="wa">💬 WhatsApp</button><button class="btn" data-gs-act="copy">📋 Copy</button>` : ''}
      </div>
    </div>`;
  }

  function sourcesHtml(v) {
    if (!v.sources || !v.sources.length) return '';
    const cols = v.sources.map((s) => `<div class="gs-source ${s.tone || ''}">
      <div class="gs-source-head"><b>${esc(s.name)}</b>${s.role ? `<span class="gs-src ${s.tone || ''}">${esc(s.role)}</span>` : ''}</div>
      <ul>${s.values.map((x) => `<li><span>${esc(x.label)}</span><b>${x.valueText !== undefined ? x.valueText : fmt(x.value)}</b></li>`).join('')}</ul>
      ${s.note ? `<p class="dim small">${s.note}</p>` : ''}
    </div>`).join('');
    return `<section class="card gs-card"><div class="card-head"><h3>🧭 Ye numbers kahan se aaye</h3><span class="dim small">${esc(v.sourceNote || '')}</span></div>
      <div class="card-body gs-sources">${cols}</div></section>`;
  }

  function classTableHtml(v) {
    const rows = v.classes || [];
    const max = Math.max(1, ...rows.map((c) => Math.max(c.cur || 0, c.last || 0, c.stock || 0)));
    if (!rows.length) return '<section class="card gs-card"><div class="card-head"><h3>🚗 Class-wise</h3></div><div class="card-body empty">Koi class row nahi mili.</div></section>';
    return `<section class="card gs-card"><div class="card-head"><h3>🚗 Class-wise · issuance &amp; stock</h3><span class="dim small">Row par click = us class ki tag rows</span></div>
      <div class="table-wrap"><table class="tbl compact gs-class">
        <thead><tr><th>Class</th><th class="num">${esc(v.lastYm)}</th><th class="num">${esc(v.ym)}</th><th class="num">Growth</th><th class="num">Stock</th><th></th></tr></thead>
        <tbody>${rows.map((c) => `<tr class="clickable" data-gs-cls="${esc(c.cls)}">
          <td><b>${esc(c.cls)}</b></td>
          <td class="num">${fmt(c.last)}</td>
          <td class="num"><b>${fmt(c.cur)}</b></td>
          <td class="num"><span class="gs-growth ${growthTone(c.growth)}">${pct(c.growth)}</span></td>
          <td class="num"><b>${fmt(c.stock)}</b></td>
          <td class="gs-barcell">${bar(c.cur || c.stock || 0, max, c.cur ? 'in' : 'st')}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="row-total"><td><b>Grand Total</b></td><td class="num"><b>${fmt(v.totals.last)}</b></td><td class="num"><b>${fmt(v.totals.cur)}</b></td>
          <td class="num"><span class="gs-growth ${growthTone(v.totals.growth)}">${pct(v.totals.growth)}</span></td><td class="num"><b>${fmt(v.totals.stock)}</b></td><td></td></tr></tfoot>
      </table></div></section>`;
  }

  function trendHtml(v) {
    const t = v.months || [];
    const max = Math.max(1, ...t.map((m) => m.n));
    return `<section class="card gs-card"><div class="card-head"><h3>📈 6-mahine ka issuance (ledger)</h3><span class="dim small">${esc(v.sourceShort || '')}</span></div>
      <div class="card-body"><div class="gs-trend">${t.map((m) => `<div class="gs-trend-col" title="${esc(m.ym)}: ${fmt(m.n)} tag">
        <span class="gs-trend-n">${m.n ? fmt(m.n) : ''}</span>
        <span class="gs-trend-bar ${m.ym === v.ym ? 'now' : ''}" style="height:${Math.max(4, Math.round((m.n / max) * 100))}%"></span>
        <span class="gs-trend-lbl">${esc(m.lbl || m.ym)}</span></div>`).join('')}</div></div></section>`;
  }

  function teamHtml(v) {
    if (v.kind !== 'tl' || !v.team) return '';
    const max = Math.max(1, ...v.team.map((a) => a.cur || a.stock || 0));
    const rows = v.team.map((a) => `<tr class="clickable" data-gs-agent="${esc(a.name)}" data-gs-agent-id="${esc(a.id || '')}">
      <td><b>${esc(a.name)}</b>${a.id ? `<br><small class="mono dim">${esc(a.id)}</small>` : ''}</td>
      <td class="num">${fmt(a.last)}</td><td class="num"><b>${fmt(a.cur)}</b></td>
      <td class="num">${fmt(a.stock)}</td>
      <td class="num">${a.sheetCur === null || a.sheetCur === undefined ? '<span class="dim">—</span>' : (a.sheetCur === a.cur ? `<span class="gs-growth good">✓ ${fmt(a.sheetCur)}</span>` : `<span class="gs-growth bad">${fmt(a.sheetCur)}</span>`)}</td>
      <td class="gs-barcell">${bar(a.cur || a.stock, max, 'in')}</td></tr>`).join('');
    const sheetNote = v.ch === 'gv' ? 'Sheet column = GV REPORT ka us agent ka number · ✓ = ledger se match' : 'Sheet column = REPORT sheet ka number (jahan mila) · ✓ = ledger se match';
    return `<section class="card gs-card"><div class="card-head"><h3>👥 Team agents (${fmt(v.team.length)})</h3><span class="dim small">${sheetNote}</span></div>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Agent</th><th class="num">${esc(v.lastYm)}</th><th class="num">${esc(v.ym)}</th><th class="num">Stock</th><th class="num">Sheet</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="row-total"><td><b>TL total (agents)</b></td><td class="num"><b>${fmt(v.totals.last)}</b></td><td class="num"><b>${fmt(v.totals.cur)}</b></td><td class="num"><b>${fmt(v.totals.stock)}</b></td><td class="num">${v.sheetTotals && v.sheetTotals.cur !== null ? fmt(v.sheetTotals.cur) : '—'}</td><td></td></tr></tfoot></table></div></section>`;
  }

  function ageingHtml(v) {
    const a = v.ageing;
    if (v.ageState === 'loading' || v.ageState === 'idle') return `<section class="card gs-card"><div class="card-head"><h3>⏳ Stock ageing</h3></div><div class="card-body">${U.spinner('Ageing nikal rahi hai… (baaki report ready hai)')}</div></section>`;
    if (!a) return `<section class="card gs-card"><div class="card-head"><h3>⏳ Stock ageing</h3></div><div class="card-body empty">Ageing data available nahi (stock tags me allocation date nahi mili).${v.ch === 'gv' ? ' GV stock ke liye Tag Assignment + StockDataa ka BC date dekha jaata hai.' : ''}</div></section>`;
    return `<section class="card gs-card"><div class="card-head"><h3>⏳ Stock ageing · ${fmt(a.total)} tags</h3><span class="dim small">30+d <b>${fmt(a.old30)}</b> · 60+d <b class="bad">${fmt(a.old60)}</b></span></div>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th>${a.buckets.map((b) => `<th class="num">${esc(b.label)}</th>`).join('')}<th class="num">30+d</th><th class="num">60+d</th><th class="num">Total</th></tr></thead>
      <tbody>${(a.byClass || []).map((c) => `<tr><td><b>${esc(c.cls)}</b></td>${a.buckets.map((b) => `<td class="num">${fmt(c[b.key] || 0)}</td>`).join('')}<td class="num"><b>${fmt(c.old30)}</b></td><td class="num"><b class="${c.old60 ? 'bad' : ''}">${fmt(c.old60)}</b></td><td class="num"><b>${fmt(c.total)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr class="row-total"><td><b>Grand Total</b></td>${a.buckets.map((b) => `<td class="num"><b>${fmt(b.n || 0)}</b></td>`).join('')}<td class="num"><b>${fmt(a.old30)}</b></td><td class="num"><b class="${a.old60 ? 'bad' : ''}">${fmt(a.old60)}</b></td><td class="num"><b>${fmt(a.total)}</b></td></tr></tfoot></table></div></section>`;
  }

  function checksHtml(v) {
    const list = (v.checks || []).filter((c) => c.others && c.others.length);
    if (!list.length) return '';
    return `<section class="card gs-card"><div class="card-head"><h3>🧮 Sheet vs Ledger — poora hisaab</h3><span class="dim small">Final number ledger ka hai; sheet/EIR sirf cross-check ke liye</span></div>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Metric</th><th class="num">Final (ledger)</th>${list[0].others.map((o) => `<th class="num">${esc(o.label)}</th>`).join('')}<th class="num">Farq</th></tr></thead>
      <tbody>${list.map((c) => {
        const o = c.others[0] || {};
        const d = o.diff;
        return `<tr><td><b>${esc(c.metric)}</b></td><td class="num"><b>${fmt(c.final)}</b></td>${c.others.map((x) => `<td class="num">${fmt(x.value)}</td>`).join('')}
          <td class="num"><span class="gs-growth ${d === 0 ? 'good' : d > 0 ? 'mid' : 'bad'}">${d === 0 ? 'match ✓' : `${d > 0 ? '+' : ''}${fmt(d)}`}</span></td></tr>`;
      }).join('')}</tbody></table></div>
      ${v.warnings && v.warnings.length ? `<div class="card-body gs-warn">${v.warnings.map((w) => `<p>⚠️ ${esc(w)}</p>`).join('')}</div>` : ''}
    </section>`;
  }

  function dataCheckHtml(v) {
    const m = v.dataCheck;
    if (!m) return '';
    const tab = (t) => {
      const map = (m.mapping && m.mapping[t.key]) || null;
      const fields = map ? Object.entries(map.info || {}).filter(([, i]) => i.how === 'header' || i.how === 'mismatch' || i.how === 'config') : [];
      return `<div class="gs-check-tab">
        <div class="gs-check-head"><b>${esc(t.label)}</b><span class="dim small">${t.labels && t.labels.length ? `${t.labels.length} columns mile` : 'headings nahi mile (data load hone par dikhengi)'}</span></div>
        ${t.labels && t.labels.length ? `<div class="gs-check-labels">${t.labels.slice(0, 60).map((l, i) => `<span class="gs-col" title="Column ${U.colLetter(i)}">${U.colLetter(i)}: ${esc(l || '—')}</span>`).join('')}</div>` : ''}
        ${fields.filter(([, i]) => i.how !== 'config').length ? `<table class="tbl compact"><thead><tr><th>Field</th><th>Config</th><th>Padha gaya</th><th>Kaise</th></tr></thead>
          <tbody>${fields.filter(([, i]) => i.how !== 'config').map(([f, i]) => `<tr><td>${esc(f)}</td><td class="mono">${esc(i.configLetter)}</td><td class="mono">${esc(i.letter)} ${i.label ? `· ${esc(i.label)}` : ''}</td><td>${i.how === 'header' ? '<span class="gs-growth good">heading se</span>' : '<span class="gs-growth mid">verify karein</span>'}</td></tr>`).join('')}</tbody></table>` : ''}
      </div>`;
    };
    const loaded = m.loaded || {};
    return `<details class="card gs-card gs-check"><summary><b>🔍 Data check</b> <span class="dim small">GV Master / GV REPORT / Tag Assignment headings, mapping aur farq — yahan sab khula hai</span></summary>
      <div class="card-body">
        <div class="gs-check-stat">
          <span>GV Master rows <b>${fmt(loaded.ledger || 0)}</b></span>
          <span>GV REPORT rows <b>${fmt(loaded.sheet || 0)}</b></span>
          <span>Tag Assignment agents <b>${fmt(loaded.stockAgents || 0)}</b></span>
          <span>Months: <b>${(m.months || []).slice(-4).join(' · ') || '—'}</b></span>
        </div>
        ${m.warnings && m.warnings.length ? `<div class="gs-warn">${m.warnings.map((w) => `<p>⚠️ ${esc(w)}</p>`).join('')}</div>` : '<p class="dim small">✅ Sabhi configured columns heading se match hue — koi mapping warning nahi.</p>'}
        ${(m.tabs || []).map(tab).join('')}
      </div></details>`;
  }

  function reportHtml(v) {
    return `<div class="gs-report">
      ${heroHtml(v)}
      ${cardsHtml(v)}
      ${sourcesHtml(v)}
      <div class="gs-grid2">${classTableHtml(v)}${trendHtml(v)}</div>
      ${teamHtml(v)}
      <div class="gs-grid2">${ageingHtml(v)}${checksHtml(v) || ''}</div>
      ${dataCheckHtml(v)}
    </div>`;
  }

  // ---- GV view model -------------------------------------------------------------------------------
  async function ensureGv(person) {
    if (!FF.gv || !FF.gv.need) return;
    await Promise.all(['master', 'stockAgent', 'stockAgentClass', 'stockTl', 'stockTlClass', 'report'].map((k) => {
      const p = FF.gv.need(k, { only: true });
      return p && p.catch ? p.catch(() => {}) : p;
    }));
  }
  function monthsTrend(rows, ym) {
    const byYm = new Map();
    rows.forEach((r) => { if (r.ym) byYm.set(r.ym, (byYm.get(r.ym) || 0) + (Number(r.n) || 1)); });
    return Array.from({ length: 6 }, (_, i) => { const m = U.ymParts(ym); const d = new Date(m.y, m.m - 1 - (5 - i), 1); const key = U.ymKey(d); return { ym: key, lbl: d.toLocaleString('en-IN', { month: 'short' }), n: byYm.get(key) || 0 }; });
  }
  function gvView(truth, person) {
    const t = truth, isTl = t.kind === 'tl';
    const lt = t.ledger, st = t.stock, sh = t.sheet || {};
    const ym = t.ym, lastYm = t.lastYm;
    const daysElapsed = lt.cur.lastDay || lt.cur.days || 0;
    const dim = U.daysInMonth(ym);
    // EIR/FF and GV are T+1 for monthly Expected: use only completed/report-available days.
    const basis = U.channelBasis ? U.channelBasis('ff', { force: true }) : { days: daysElapsed || 1 };
    const reportDays = Math.max(1, Number(basis.days) || daysElapsed || 1);
    const expectedBase = (lt.rows && Array.isArray(lt.rows.all))
      ? lt.rows.all.filter((r) => r.ym === ym && Number(r.day) <= reportDays).reduce((n, r) => n + (Number(r.n) || 0), 0)
      : lt.cur.total;
    const expected = reportDays ? Math.round((expectedBase / reportDays) * dim) : 0;
    const rate = daysElapsed ? lt.cur.total / daysElapsed : 0;
    const growth = lt.last.total ? ((lt.cur.total - lt.last.total) / lt.last.total) * 100 : null;
    const classes = (() => {
      const keys = new Set([...Object.keys(lt.cur.byClass), ...Object.keys(lt.last.byClass), ...st.byClass.map((c) => c.cls)]);
      const stockBy = new Map(st.byClass.map((c) => [c.cls, c.n]));
      return [...keys].map((cls) => {
        const cur = lt.cur.byClass[cls] || 0, last = lt.last.byClass[cls] || 0;
        return { cls, cur, last, stock: stockBy.get(cls) || 0, growth: last ? ((cur - last) / last) * 100 : null };
      }).sort((a, b) => (b.cur + b.last + b.stock) - (a.cur + a.last + a.stock));
    })();
    const checks = t.checks.map((c, i) => ({ ...c, metric: c.metric }));
    const checkOf = (i) => checks[i];
    const cards = [
      card({ key: 'cur', icon: '🏷️', tone: 'g1', label: `Issuance · ${ym}`, value: lt.cur.total, unit: 'tags',
        sub: `VC4 <b>${fmt(lt.cur.vc4)}</b> · Comm <b>${fmt(lt.cur.comm)}</b> · ${fmt(lt.cur.days)} din active`,
        check: checkOf(0), why: 'GV Master ledger ki tag rows ka jod (final)', explain: `GV Master ki ${fmt(lt.cur.rowCount || 0)} tag rows (${ym}). Click = poori list VRN/TAG_ID ke saath.` }),
      card({ key: 'last', icon: '📅', tone: 'g3', label: `Last month · ${lastYm}`, value: lt.last.total, unit: 'tags',
        sub: `VC4 <b>${fmt(lt.last.vc4)}</b> · Comm <b>${fmt(lt.last.comm)}</b> · growth <span class="gs-growth ${growthTone(growth)}">${pct(growth)}</span>`,
        check: checkOf(1), why: 'GV Master ledger (final) · GV REPORT sirf cross-check', explain: `${lastYm} ki tag rows. Sheet me ${sh.lastAvailable ? fmt(sh.last) : 'blank'} likha hai.` }),
      card({ key: 'today', icon: '⚡', tone: 'g10', label: 'Today issued', value: lt.today.total, unit: 'tags',
        sub: lt.today.total ? `VC4 ${fmt(lt.today.vc4)} · Comm ${fmt(lt.today.comm)}` : 'aaj koi tag nahi',
        why: 'GV Master ka aaj ka data (live)', explain: 'Aaj ki tag rows — GV ki sheet live chalti hai, isliye EIR se pehle GV Master.' }),
      card({ key: 'stock', icon: '📦', tone: 'g5', label: 'Stock in hand', value: st.total, unit: 'tags',
        sub: `${isTl ? `TL ke paas <b>${fmt(st.own)}</b> + agents <b>${fmt(st.agentsTotal)}</b> · ` : ''}VC4 <b>${fmt(st.vc4)}</b> · Comm <b>${fmt(st.comm)}</b>`,
        check: checkOf(2), why: 'Tag Assignment (live stock sheet) — final', explain: `${fmt(st.total)} tag rows is waqt in ke paas${st.excluded ? ` · ${fmt(st.excluded)} out-of-stock rows chhod diye` : ''}. Click = TAG_ID/serial list.` }),
      card({ key: 'expected', icon: '🎯', tone: 'g7', label: 'Expected (month-end)', value: expected, unit: 'tags',
        sub: `Runrate <b>${(expectedBase / reportDays).toFixed(1)}</b>/din · ${fmt(reportDays)}/${dim} reported din · aaj exclude`,
        why: 'Ledger runrate se projection', explain: `${fmt(expectedBase)} ÷ ${fmt(reportDays)} reported din × ${dim} din. Aaj ka live/incomplete day Expected me include nahi hai.` }),
      card({ key: 'days', icon: '📆', tone: 'g8', label: 'Active days (ledger)', value: lt.cur.days, unit: 'din',
        sub: `Avg <b>${lt.cur.days ? (lt.cur.total / lt.cur.days).toFixed(1) : '0'}</b> tag/din`,
        why: 'GV Master ki dates se', explain: 'Jitne din ledger me is person ka tag dikha.' }),
      card({ key: 'repl', icon: '🔁', tone: 'g9', label: 'Replacement / Chassis', value: lt.cur.replacement, unit: 'repl',
        sub: `Chassis <b>${fmt(lt.cur.chassis)}</b> · VRN <b>${fmt(lt.cur.vrn)}</b>`,
        why: 'GV Master status / tag type se', explain: 'Replacement status wali rows alag gini gayi hain.' }),
      card({ key: 'sheet', icon: '📑', tone: 'g12', label: 'GV REPORT sheet', value: sh.cur !== null && sh.cur !== undefined ? sh.cur : '—', unit: 'tags',
        sub: sh.found ? `Stock <b>${sh.stockAvailable ? fmt(sh.stock) : '—'}</b> · Last <b>${sh.lastAvailable ? fmt(sh.last) : '—'}</b>` : 'sheet me row nahi mili',
        why: 'Sirf cross-check (final nahi)', explain: sh.found ? `Sheet me is (${sh.agentId || t.id}) ke liye current month ${sh.curAvailable ? fmt(sh.cur) : 'blank'} hai.` : 'Is person ka row GV REPORT me nahi mila.' })
    ];
    const m = { y: 0 };
    return {
      ch: 'gv', kind: t.kind, name: t.name, id: t.id, tlName: t.tlName, tlId: t.tlId, mobile: t.mobile || person.mobile || '',
      direct: t.direct, ym, lastYm, cards, classes, months: monthsTrend(lt.rows.all, ym), team: isTl ? FF.gvTruth.team({ ...person, ym }) : null,
      checks, warnings: t.warnings, ageing: null, ageState: 'idle',
      totals: { cur: lt.cur.total, last: lt.last.total, stock: st.total, growth },
      sheetTotals: { cur: sh.curAvailable ? sh.cur : null, last: sh.lastAvailable ? sh.last : null, stock: sh.stockAvailable ? sh.stock : null },
      sources: [
        { name: '🧾 GV Master (issuance ledger)', role: 'FINAL', tone: 'ledger', note: 'Column A = agent ID, I = TAG_ID, E = VRN barcode, F = class, P = date.', values: [
          { label: `Is mahine (${ym})`, value: lt.cur.total }, { label: `Last month (${lastYm})`, value: lt.last.total },
          { label: 'Aaj', value: lt.today.total }, { label: 'Total rows', value: lt.rows.all.length }] },
        { name: '📦 Tag Assignment (stock)', role: 'FINAL stock', tone: 'stock', note: 'Ek row = ek tag; status out-of-stock ho to stock me nahi ginta.', values: [
          { label: 'Stock in hand', value: st.total }, { label: 'VC4', value: st.vc4 }, { label: 'Commercial', value: st.comm }] },
        { name: '📑 GV REPORT (sheet)', role: 'CROSS-CHECK', tone: 'sheet', note: 'Sheet ke bane hue numbers — sirf verify karne ke liye.', values: [
          { label: 'Current month', value: sh.curAvailable ? sh.cur : null }, { label: 'Last month', value: sh.lastAvailable ? sh.last : null },
          { label: 'Stock', value: sh.stockAvailable ? sh.stock : null }] }
      ],
      sourceNote: 'Har card par sheet ka number aur farq likha hai — final number ledger (GV Master) ka hai.',
      sourceShort: 'GV Master ledger',
      dataCheck: (() => { try { const h = FF.gvTruth.health(); return h; } catch { return null; } })(),
      truth: t, person
    };
  }

  // ---- FF view model (EIR + REPORT + StockDataa, wahi naya design) ----------------------------------
  async function ffView(spec, listPerson) {
    const person = listPerson || spec;
    const rep = await FF.agentSummary.buildReport(spec, { age: false });
    const p = rep.p, t = p.totals || {}, isTl = rep.isTl;
    const growth = t.growth;
    const classes = (p.classTable || []).filter((x) => x.cur || x.last || x.stock);
    const months = (rep.trend && rep.trend.length ? rep.trend : []).map((m) => ({ ym: m.ym, lbl: m.lbl, n: m.n }));
    while (months.length < 6) months.unshift({ ym: '', lbl: '', n: 0 });
    const sheetCur = ((FF.store && FF.store.get && FF.store.get('agentClass')) || []);
    const val = (row) => `<span class="gs-growth ${growthTone(row)}">${pct(row)}</span>`;
    const cards = [
      card({ key: 'cur', icon: '🏷️', tone: 'g1', label: `Issuance · ${p.curYm || 'MTD'}`, value: t.curTotal, unit: 'tags', sub: `VC4 <b>${fmt(t.curVc4)}</b> · Comm <b>${fmt(t.curComm)}</b>`, why: 'EIR ledger (First Forward sheet)', explain: 'EIR ki tag rows ka jod. Click = day-wise aur class-wise detail.' }),
      card({ key: 'last', icon: '📅', tone: 'g3', label: `Last month · ${p.lastYm || 'prev'}`, value: t.lastTotal, unit: 'tags', sub: `VC4 <b>${fmt(t.lastVc4)}</b> · Comm <b>${fmt(t.lastComm)}</b> · ${val(growth)}`, why: 'EIR ledger + REPORT sheet cross-check', explain: `Pichhle mahine ke tag.` }),
      card({ key: 'expected', icon: '🎯', tone: 'g7', label: 'Expected (month-end)', value: p.expected, unit: 'tags', sub: `Runrate <b>${fmt(p.runRate, true)}</b>/din`, why: 'Runrate se projection', explain: 'Aaj tak ka issuance ÷ din × month ke din.' }),
      card({ key: 'stock', icon: '📦', tone: 'g5', label: 'Stock in hand', value: t.stockTotal, unit: 'tags', sub: `${isTl && p.tlStock && p.tlStock.own ? `TL ke paas <b>${fmt(p.tlStock.own.total)}</b> + agents <b>${fmt(p.tlStock.agents ? p.tlStock.agents.total : 0)}</b> · ` : ''}VC4 <b>${fmt(t.stockVc4)}</b> · Comm <b>${fmt(t.stockComm)}</b>`, why: 'StockDataa (inventory sheet)', explain: 'Field me pada stock — StockDataa ki tag rows.' }),
      card({ key: 'today', icon: '⚡', tone: 'g10', label: 'Today (EIR)', value: FF.store && FF.store.get ? (FF.store.get('daily') || []).filter((r) => r.key === U.dateKey(new Date()) && r.channel !== 'GV Partner' && personMatch(r, person, isTl)).reduce((n, r) => n + (Number(r.n) || 0), 0) : '—', unit: 'tags', why: 'EIR aaj ki rows', explain: 'First Forward ka issuance T+1 aata hai — aaj ka data kal poora hota hai.' }),
      card({ key: 'days', icon: '📆', tone: 'g8', label: `${p.curYm || 'MTD'} active days`, value: (p.agents && isTl ? (p.agents.filter((a) => a.curTotal > 0).length + ' agents') : ((p.curDays || 0) || '—')), unit: isTl ? '' : 'din', sub: isTl ? `Team issuance <b>${fmt(t.curTotal)}</b>` : `Avg <b>${p.runRate ? fmt(p.runRate, true) : '0'}</b>/din`, why: 'EIR se', explain: 'Kitne din / kitne agents active rahe.' })
    ];
    return {
      ch: 'ff', kind: isTl ? 'tl' : 'agent', name: p.name, id: p.id, tlName: p.tlName, tlId: p.tlId, mobile: p.mobile,
      direct: p.direct, directLabel: p.directLabel, priority: p.priority, activity: p.activityStatus, inactive: p.inactiveDuration,
      ym: U.ymKey(new Date()), lastYm: p.lastYm || U.prevMonthKey(U.ymKey(new Date())), cards, classes: classes.map((c) => ({ ...c, growth: c.growth })),
      months, team: isTl ? (p.agents || []) : null, checks: [], warnings: [],
      ageing: null, ageState: 'idle', totals: { cur: t.curTotal, last: t.lastTotal, stock: t.stockTotal, growth },
      sources: [
        { name: '🧾 EIR ledger (issuance)', role: 'FINAL', tone: 'ledger', values: [
          { label: `Is mahine (${p.curYm || 'MTD'})`, value: t.curTotal }, { label: `Last month (${p.lastYm || '—'})`, value: t.lastTotal }] },
        { name: '📦 StockDataa (stock)', role: 'FINAL stock', tone: 'stock', values: [
          { label: 'Stock in hand', value: t.stockTotal }, { label: 'VC4', value: t.stockVc4 }, { label: 'Commercial', value: t.stockComm }] },
        { name: '📑 REPORT sheet', role: 'CROSS-CHECK', tone: 'sheet', note: 'Agent performance sheet — final nahi, sirf verify karne ke liye.', values: [
          { label: 'Sheet rows (poore)', value: sheetCur.length ? sheetCur.length : 0 }, { label: 'Priority (sheet)', value: 0, valueText: esc(p.priority || '—') },
          { label: 'Growth % (sheet)', value: 0, valueText: pct(p.growthNum) }] }
      ],
      sourceNote: 'FF channel: EIR + StockDataa final · REPORT sheet cross-check.',
      sourceShort: 'EIR ledger', rep, person, listPerson: person
    };
  }
  function personMatch(r, person, isTl) {
    const keys = [norm(person.name), norm(person.id)];
    if (isTl) return keys.includes(norm(r.tlName));
    return keys.includes(norm(r.agentName)) || keys.includes(norm(r.agentId));
  }

  // ---- drill drawer --------------------------------------------------------------------------------
  const state = { view: null, drill: null };
  function drawerHost() {
    let host = document.getElementById('gs-drawer-host');
    if (!host) { host = document.createElement('div'); host.id = 'gs-drawer-host'; document.body.appendChild(host); }
    return host;
  }
  function closeDrawer() { const h = drawerHost(); h.innerHTML = ''; state.drill = null; }
  function tableHtml(columns, rows, flags) {
    return `<div class="table-wrap gs-drawer-table"><table class="tbl compact"><thead><tr>${columns.map((c, i) => `<th${i ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, ri) => `<tr class="${flags && flags[ri] ? 'gs-out' : ''}">${r.map((c, i) => `<td${i ? ' class="mono"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${columns.length}" class="empty">Koi row nahi mili.</td></tr>`}</tbody></table></div>`;
  }
  async function openDrill(spec) {
    const v = state.view;
    if (!v) return;
    const host = drawerHost();
    host.innerHTML = `<div class="gs-drawer-backdrop"><section class="gs-drawer" role="dialog" aria-modal="true">
      <header><div><b>${esc(spec.title || 'Rows')}</b><span class="dim small">${esc(spec.source || '')}</span></div><button class="icon-btn" data-gs-close>✕</button></header>
      <div class="gs-drawer-body">${U.spinner('Rows nikal rahe hain…')}</div></section></div>`;
    host.querySelector('[data-gs-close]').addEventListener('click', closeDrawer);
    host.querySelector('.gs-drawer-backdrop').addEventListener('click', (e) => { if (e.target.classList.contains('gs-drawer-backdrop')) closeDrawer(); });
    let d;
    try {
      d = v.ch === 'gv'
        ? await FF.gvTruth.drill({ ...spec, truth: v.truth, kind: v.kind === 'tl' ? 'gv-tl' : 'gv-agent', name: v.name, id: v.id, tlName: v.tlName, tlId: v.tlId })
        : await ffDrill(spec, v);
    } catch (err) {
      host.querySelector('.gs-drawer-body').innerHTML = U.errorBox(err, 'data-gs-close');
      return;
    }
    state.drill = d;
    const body = host.querySelector('.gs-drawer-body');
    body.innerHTML = `
      <p class="gs-drawer-note">${esc(d.note || '')}</p>
      <div class="gs-drawer-actions">
        <span class="gs-chip">${fmt(d.rows.length)} rows</span>
        <button class="btn small" data-gs-drill-csv>⬇ CSV</button>
      </div>
      ${tableHtml(d.columns, d.rows, d.rowFlags)}`;
    const csvBtn = body.querySelector('[data-gs-drill-csv]');
    if (csvBtn) csvBtn.addEventListener('click', () => {
      U.downloadCsv(`rows-${U.slug(v.name)}-${spec.scope || 'cur'}.csv`, d.columns, d.rows);
      U.toast('CSV downloaded ✓', 'ok');
    });
  }
  /** FF ke liye tag rows — EIR daily (issuance) ya StockDataa (stock, on demand). */
  async function ffDrill(spec, v) {
    const isTl = v.kind === 'tl';
    const scope = spec.scope || 'cur';
    if (scope === 'stock') {
      const e = FF.config.stock || {};
      const lit = (x) => `'${String(x).replace(/'/g, "\\'")}'`;
      const where = isTl ? `${e.tlName} = ${lit(v.name)}` : `${e.agentName} = ${lit(v.name)}`;
      const tq = `select ${e.tagId}, ${e.barcode}, ${e.cls}, ${e.tagType}, ${e.agentName}, ${e.tlName}, ${e.bcAllocatedAt}, ${e.agentAllocatedAt} where ${where} limit 3000`;
      let t = null;
      try { t = await FF.data.query(FF.config.stock.sheet, tq, { only: true }); } catch (err) { t = null; }
      const rows = ((t && t.rows) || []).map((r) => [FF.data.cellText(r[0]), FF.data.cellText(r[1]), FF.data.cellText(r[2]), FF.data.cellText(r[3]), FF.data.cellText(r[4]), FF.data.cellText(r[5]), FF.data.cellText(r[7]) || FF.data.cellText(r[6])]);
      return { title: `📦 Stock in hand · ${v.name}`, source: 'StockDataa (First Forward sheet)', note: `${rows.length} tag rows ${isTl ? `${v.name} + uske agents` : v.name} ke paas.`, columns: ['TAG_ID', 'BARCODE', 'CLASS', 'TYPE', 'AGENT', 'TL', 'ALLOCATED'], rows };
    }
    const tk = U.dateKey(new Date());
    const daily = (FF.store.get('daily') || []).filter((r) => personMatch(r, v.person, isTl));
    const ym = scope === 'last' ? v.rep.p.lastYm : v.ym;
    const rows = scope === 'today' ? daily.filter((r) => r.key === tk) : daily.filter((r) => r.ym === ym);
    const total = rows.reduce((n, r) => n + (Number(r.n) || 0), 0);
    return {
      title: `🏷️ ${scope === 'today' ? 'Aaj' : ym} · ${v.name}`, source: 'EIR (First Forward sheet)',
      note: `${rows.length} grouped rows · jod = ${fmt(total)} tag. EIR row tag-wise nahi, date + class + type wise grouped hoti hai.`,
      columns: ['DATE', 'CLASS', 'TYPE', 'AGENT', 'TL', 'COUNT'],
      rows: rows.map((r) => [r.key || (r.d && U.dateKey(r.d)) || '', r.cls || '', r.type || '', r.agentName || '', r.tlName || '', fmt(r.n)])
    };
  }

  // ---- exports -------------------------------------------------------------------------------------
  function viewCsv(v) {
    const rows = [['Field', 'Value']];
    rows.push(['Channel', v.ch === 'gv' ? 'GV Partner' : 'First Forward']);
    rows.push(['Name', v.name], ['ID', v.id || ''], ['TL', v.tlName || ''], ['Basis', v.ym]);
    rows.push([]);
    v.cards.forEach((c) => rows.push([c.label, c.value]));
    rows.push([]);
    rows.push(['Metric', 'Final (ledger)', ...(v.checks[0] ? v.checks[0].others.map((o) => o.label) : [])]);
    v.checks.forEach((c) => rows.push([c.metric, c.final, ...c.others.map((o) => o.value)]));
    rows.push([]);
    rows.push(['Class', v.lastYm, v.ym, 'Stock']);
    v.classes.forEach((c) => rows.push([c.cls, c.last, c.cur, c.stock]));
    return rows;
  }
  function viewText(v) {
    const lines = [`*📋 ${v.name}* (${v.ch === 'gv' ? 'GV Partner' : 'First Forward'} · ${v.kind === 'tl' ? 'Team Leader' : 'Agent'}${v.id ? ` · ${v.id}` : ''})`,
      `Basis: ${v.ym} · last month ${v.lastYm}`, ''];
    v.cards.forEach((c) => lines.push(`${c.icon || ''} ${c.label}: *${c.value}*${c.sub ? ` (${String(c.sub).replace(/<[^>]+>/g, '')})` : ''}`));
    if (v.checks.length) {
      lines.push('', '*🧮 Sheet vs Ledger:*');
      v.checks.forEach((c) => lines.push(`• ${c.metric}: ledger *${c.final}*${c.others.map((o) => ` · ${o.label} ${o.value} (${o.diff > 0 ? '+' : ''}${o.diff})`).join('')}`));
    }
    return lines.join('\n');
  }
  function viewPdf(v) {
    if (!FF.pdf || !FF.pdf.doc) throw new Error('PDF module load nahi hua');
    const doc = FF.pdf.doc({ title: `${v.ch === 'gv' ? 'GV Partner' : 'First Forward'} · ${v.kind === 'tl' ? 'Team Leader' : 'Agent'} Summary`, subtitle: `${v.name}${v.id ? ` (ID: ${v.id})` : ''}${v.tlName ? ` · TL: ${v.tlName}` : ''}`, right: new Date().toLocaleDateString('en-IN') });
    doc.kpis(v.cards.slice(0, 5).map((c) => ({ label: c.label, value: String(c.value), sub: String(c.sub || '').replace(/<[^>]+>/g, '').slice(0, 60), color: '#2563eb' })));
    doc.section(`Class-wise (${v.lastYm} vs ${v.ym}) & Stock`);
    doc.table({ headers: ['Class', v.lastYm, v.ym, 'Stock'], align: ['left', 'right', 'right', 'right'], rows: v.classes.map((c) => [c.cls, fmt(c.last), fmt(c.cur), fmt(c.stock)]), foot: ['TOTAL', fmt(v.totals.last), fmt(v.totals.cur), fmt(v.totals.stock)] });
    if (v.checks.length) {
      doc.section('Sheet vs Ledger (final = ledger)');
      doc.table({ headers: ['Metric', 'Ledger (final)', ...v.checks[0].others.map((o) => o.label), 'Farq'], align: ['left', 'right', 'right', 'right', 'right'], rows: v.checks.map((c) => [c.metric, fmt(c.final), ...c.others.map((o) => fmt(o.value)), `${c.others[0] && c.others[0].diff > 0 ? '+' : ''}${fmt((c.others[0] && c.others[0].diff) || 0)}`]) });
    }
    doc.footer(`${v.ch === 'gv' ? 'GV Master ledger (final) · GV REPORT (cross-check)' : 'EIR ledger (final) · REPORT sheet (cross-check)'}`);
    return doc.finish();
  }

  // ---- page ----------------------------------------------------------------------------------------
  /** GV people — jo abhi memory me hai (turant). Heavy datasets background me load hote hain. */
  function gvListNow() {
    try { return (FF.gvTruth && FF.gvTruth.people) ? FF.gvTruth.people() : []; } catch { return []; }
  }
  /** ⚡ Fast open: GV list turant (current memory), poora data aane par `onLate(list)` se repaint. */
  async function loadList(ch, onLate) {
    if (ch === 'gv') {
      const now = gvListNow();
      const heavy = ensureGv().then(() => gvListNow()).catch(() => []);
      if (onLate) heavy.then((list) => { if (Array.isArray(list) && list.length) { try { onLate(list); } catch { /* ignore */ } } });
      if (now.length) return now;                              // ⚡ turant
      const waited = await U.within(heavy, 1500, null);        // cold start — thoda intezaar
      return waited || now;
    }
    return FF.agentSummary.loadPeople('ff');
  }
  function matchList(list, q) { return FF.agentSummary.matchPeople(list, q); }
  function suggestions(list, q) { return FF.agentSummary.topSuggestions(list, q); }

  function personSpec(p, ch) {
    const isTl = /tl$/.test(String(p.kind || ''));
    return ch === 'gv'
      ? { kind: isTl ? 'gv-tl' : 'gv-agent', name: p.name, id: p.id, tlName: p.tl, tlId: p.tlId, mobile: p.mobile, direct: p.isDirect }
      : { kind: isTl ? 'ff-tl' : 'ff-agent', name: p.name, id: p.id, tl: p.tl, tlId: p.tlId, mobile: p.mobile, direct: p.isDirect, sub: p.id || '' };
  }

  function makePage(ch) {
    const isGv = ch === 'gv';
    const S = { list: [], view: null, person: null };
    async function render(root, params) {
      const label = isGv ? 'GV Partner' : 'First Forward';
      root.innerHTML = `<div class="page gs-page">
        <div class="gs-top">
          <div>
            <h1>${isGv ? '🟩' : '🟦'} ${label} · Agent / TL Summary</h1>
            <p class="sub">Search: <b>naam · agent name · TL name · ID · mobile</b> — poora report, clickable KPI aur tag-level proof ke saath.</p>
          </div>
          <div class="gs-top-act">
            <button class="btn small" data-gs-switch="${isGv ? 'ff' : 'gv'}" title="Dusre channel me dekho">${isGv ? '🟦 First Forward' : '🟩 GV Partner'} me dekho</button>
            <button class="btn small" data-gs-refresh>🔄 Refresh</button>
          </div>
        </div>
        <div class="card gs-search-card"><div class="card-body">
          <div class="gs-search">
            <span class="gs-search-ico">🔎</span>
            <input id="gs-q" class="input" type="search" placeholder="Agent / TL ka naam, ID ya 10-digit mobile…" value="${esc((params && (params.name || params.q)) || '')}" autocomplete="off" aria-label="Search">
            <button class="btn primary" data-gs-search>Search</button>
            <div id="gs-drop" class="gs-drop" hidden></div>
          </div>
          <div class="gs-quick"><span class="dim small">⚡ Turant kholo:</span><div id="gs-sug" class="gs-sug"></div></div>
        </div></div>
        <div id="gs-body">${U.spinner(`${label} ka data load ho raha hai…`)}</div>
      </div>`;
      const body = U.$('#gs-body', root), qEl = U.$('#gs-q', root), drop = U.$('#gs-drop', root), sug = U.$('#gs-sug', root);
      const asked = params && (params.name || params.q);
      S.list = [];
      let lateList = () => {};
      try { S.list = await loadList(ch, (list) => { S.list = list; lateList(list); }); }
      catch (err) { body.innerHTML = U.errorBox(err, 'data-gs-retry'); return; }
      const paintSug = (q) => {
        const hits = suggestions(S.list, q);
        sug.innerHTML = hits.length ? hits.map((p) => {
          const tl = /tl$/.test(p.kind);
          return `<button type="button" class="gs-chipbtn ${tl ? 'tl' : 'ag'}" data-gs-pick="${esc(`${p.kind}|${p.name}`)}">
            <b>${esc(p.name)}</b>${p.id ? ` <small class="mono dim">${esc(p.id)}</small>` : ''} <small class="dim">· ${fmt(p.cur)} mtd · ${fmt(p.stock)} stock${(p.today !== undefined) ? ` · ${fmt(p.today)} aaj` : ''}</small></button>`;
        }).join('') : '<span class="dim small">Koi matching naam/ID/mobile nahi mila</span>';
      };
      lateList = (list) => {
        paintSug(qEl ? qEl.value : '');
        if (asked && !S.person) { const h = matchList(list, asked)[0]; if (h) pick(h); }
      };
      const showDrop = (q) => {
        const hits = matchList(S.list, q);
        drop.innerHTML = hits.length ? hits.slice(0, 40).map((p) => {
          const tl = /tl$/.test(p.kind);
          return `<button type="button" class="gs-drop-opt" data-gs-pick="${esc(`${p.kind}|${p.name}`)}">
            <span><span class="gs-tag ${tl ? 'tl' : 'ag'}">${tl ? 'TL' : 'Agent'}</span> <b>${esc(p.name)}</b>${p.id ? ` <small class="mono dim">${esc(p.id)}</small>` : ''}${!tl && p.tl ? ` <small class="dim">· TL ${esc(p.tl)}</small>` : ''}</span>
            <span class="dim small">last <b>${fmt(p.last)}</b> · mtd <b>${fmt(p.cur)}</b>${p.today !== undefined ? ` · aaj <b>${fmt(p.today)}</b>` : ''} · stock <b>${fmt(p.stock)}</b>${p.sheetCur !== null && p.sheetCur !== undefined ? ` · sheet ${fmt(p.sheetCur)}` : ''}</span></button>`;
        }).join('') : '<div class="gs-drop-empty dim">Kuch nahi mila</div>';
        drop.hidden = false;
      };
      const paintExtras = (v, age) => {
        if (FF.charts && FF.charts.mount) { try { FF.charts.mount(body); } catch { /* charts optional */ } }
        if (FF.app && FF.app.enhanceTables) { try { FF.app.enhanceTables(body); } catch { /* optional */ } }
        if (age !== false) loadAgeing(v);
      };
      async function pick(person) {
        if (!person) return;
        S.person = person;
        drop.hidden = true;
        if (qEl) qEl.value = person.name;
        paintSug('');
        body.innerHTML = U.spinner(`${person.name} ka report ban raha hai…`);
        let view = null;
        try {
          if (isGv) {
            // ⚡ GV: jo abhi memory me hai usse TURANT report (stock + issuance last/current + today),
            // heavy datasets (master/report/stock*) background me load hote hain aur numbers sync kar dete hain.
            const spec = personSpec(person, 'gv');
            const paintGv = (v, age) => { S.view = v; state.view = v; body.innerHTML = reportHtml(v); paintExtras(v, age); };
            const now = FF.gvTruth.person(spec);
            const hasNow = !!(now.ledger.rows.all.length || now.stock.total || (now.sheet && now.sheet.found));
            const heavy = ensureGv(person).catch(() => {});
            if (hasNow) {
              paintGv(gvView(now, person), true);
              heavy.then(() => {
                if (S.person !== person || !body.isConnected) return;
                try {
                  const v2 = gvView(FF.gvTruth.person(spec), person);
                  if (S.view) { v2.ageing = S.view.ageing; v2.ageState = S.view.ageState; }
                  paintGv(v2, false);
                } catch { /* late repaint best effort */ }
              });
              return;
            }
            await U.within(heavy, 9000, null);
            paintGv(gvView(FF.gvTruth.person(spec), person), true);
            return;
          }
          view = await ffView(personSpec(person, 'ff'), person);
        } catch (err) {
          body.innerHTML = U.errorBox(err, 'data-gs-retry');
          return;
        }
        S.view = view; state.view = view;
        body.innerHTML = reportHtml(view);
        paintExtras(view, true);
      }
      async function loadAgeing(view) {
        if (!FF.stockAge || !FF.stockAge.compute) { view.ageState = 'unavailable'; return; }
        view.ageState = 'loading';
        const spec = personSpec(view.person || S.person, ch);
        const scope = spec.kind.endsWith('tl')
          ? { kind: 'tl', key: spec.name, ch, title: spec.name }
          : { kind: 'agent', key: spec.id || spec.name, keys: [spec.name, spec.id].filter(Boolean), ch, title: spec.name };
        let res = null;
        try { res = await FF.stockAge.compute(scope, { waitMs: 45000 }); } catch { res = null; }
        if (S.view !== view) return;
        view.ageing = res && (res[ch] || res.ff || res.gv) || null;
        view.ageState = view.ageing ? 'ready' : 'unavailable';
        const host = U.$('.gs-report', body);
        if (!host) return;
        const grids = host.querySelectorAll('.gs-grid2');
        const grid = grids[1];
        if (grid) grid.innerHTML = `${ageingHtml(view)}${checksHtml(view) || ''}`;
        else host.insertAdjacentHTML('beforeend', ageingHtml(view));
      }
      paintSug('');
      if (qEl) {
        qEl.addEventListener('focus', () => showDrop(qEl.value));
        let timer = 0;
        qEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { showDrop(qEl.value); paintSug(qEl.value); }, 120); });
        qEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { const hit = matchList(S.list, qEl.value)[0]; if (hit) pick(hit); }
          else if (e.key === 'Escape') drop.hidden = true;
        });
      }
      if (root.__gsClick) root.removeEventListener('click', root.__gsClick);
      root.__gsClick = async (e) => {
        const pickBtn = e.target.closest('[data-gs-pick]');
        if (pickBtn) { const [kind, name] = pickBtn.dataset.gsPick.split('|'); pick(S.list.find((p) => p.kind === kind && norm(p.name) === norm(name)) || { kind, name }); return; }
        if (e.target.closest('[data-gs-search]')) { const hit = matchList(S.list, qEl.value)[0]; if (hit) pick(hit); else U.toast('Koi matching Agent / TL nahi mila', 'warn'); return; }
        if (e.target.closest('[data-gs-refresh]')) { try { if (FF.gv && FF.gv.refresh) await FF.gv.refresh(); if (FF.agentSummary && FF.agentSummary.clearCaches) FF.agentSummary.clearCaches(); } catch { /* ignore */ } S.list = await loadList(ch).catch(() => S.list); paintSug(qEl ? qEl.value : ''); if (S.person) pick(S.person); return; }
        const sw = e.target.closest('[data-gs-switch]');
        if (sw && FF.app && FF.app.navigate) { FF.app.navigate(`${sw.dataset.gsSwitch}AgentSummary`, { name: S.person ? S.person.name : '' }); return; }
        const kpi = e.target.closest('[data-gs-kpi]');
        if (kpi && S.view) { const k = S.view.cards.find((c) => c.key === kpi.dataset.gsKpi); if (k) openDrill(k.drill || { scope: k.key === 'stock' ? 'stock' : k.key === 'last' ? 'last' : k.key === 'today' ? 'today' : 'cur' }); return; }
        const cls = e.target.closest('[data-gs-cls]');
        if (cls && S.view) { openDrill({ scope: 'cur', cls: cls.dataset.gsCls, title: `${cls.dataset.gsCls} · ${S.view.name}` }); return; }
        const ag = e.target.closest('[data-gs-agent]');
        if (ag) { const found = S.list.find((p) => !/tl$/.test(p.kind) && (norm(p.name) === norm(ag.dataset.gsAgent) && (!ag.dataset.gsAgentId || String(p.id || '') === ag.dataset.gsAgentId))); if (found) pick(found); else pick({ kind: isGv ? 'gv-agent' : 'ff-agent', name: ag.dataset.gsAgent, id: ag.dataset.gsAgentId }); return; }
        const act = e.target.closest('[data-gs-act]');
        if (act && S.view) {
          const kind = act.dataset.gsAct;
          try {
            if (kind === 'csv') { U.downloadCsv(`${ch}-${U.slug(S.view.name)}-${U.stamp()}.csv`, viewCsv(S.view)[0], viewCsv(S.view).slice(1)); U.toast('CSV ✓', 'ok'); }
            else if (kind === 'pdf') { if (!FF.pdf && FF.lazy && FF.lazy.need) { try { await FF.lazy.need('pdf'); } catch { /* ignore */ } } FF.pdf.download(viewPdf(S.view), `${ch}-${U.slug(S.view.name)}-${U.stamp()}.pdf`); U.toast('PDF ✓', 'ok'); }
            else if (kind === 'wa') window.open(U.waLink(viewText(S.view)), '_blank', 'noopener');
            else if (kind === 'copy') { await U.copyText(viewText(S.view)); U.toast('Copy ✓', 'ok'); }
            else if (kind === 'excel') { FF.xlsx.download(`${ch}-${U.slug(S.view.name)}-${U.stamp()}.xlsx`, { Summary: viewCsv(S.view), Classes: [['Class', S.view.lastYm, S.view.ym, 'Stock'], ...S.view.classes.map((c) => [c.cls, c.last, c.cur, c.stock])] }); U.toast('Excel ✓', 'ok'); }
          } catch (err) { U.toast((err && err.message) || 'Export fail hua', 'err'); }
          return;
        }
        if (!e.target.closest('.gs-search')) drop.hidden = true;
      };
      root.addEventListener('click', root.__gsClick);
      const hit = asked ? matchList(S.list, asked)[0] : null;
      if (hit) await pick(hit);
      else if (!asked && S.list[0]) await pick(S.list[0]);
      else if (asked) body.innerHTML = `<div class="card"><div class="card-body empty">“${esc(asked)}” abhi list me nahi mila — ${label} ka poora data background me load ho raha hai; milte hi khul jayega.</div></div>`;
      else body.innerHTML = '<div class="card"><div class="card-body empty">Koi Agent / TL data nahi mila — GV sheet me data hai? Settings → Data source check karein.</div></div>';
    }
    return { title: 'Agent / TL Summary', render };
  }

  FF.pages.gvAgentSummary = makePage('gv');
  FF.pages.ffAgentSummary = makePage('ff');
  FF.summaryUI = { makePage, viewCsv, viewText, openDrill, closeDrawer };
})(window.FF);
