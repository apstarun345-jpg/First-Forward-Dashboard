/* Cockpit v3.8 — operations layer on top of the insights engine (loaded after insights.js):
     1. Payout reconciliation  — sheet earned vs rate×tags vs slab expected, payout-sheet-ready export
     2. Agent 360              — one drawer: FF + GV issuance/stock, commission, quality, cross-channel, notes
     3. Commission alerts      — rule engine (missing rate, zero earned, outliers, GV class gap, sheet math)
     4. Dispatch planner       — auto box-wise plan + printable pick-list + WhatsApp text
     5. TL scorecard           — target vs achievement, cover, commission efficiency, risk, grade & rank

   Sab kuch existing APIs se banta hai (FF.insights / FF.gv / FF.store / performance page).
   Koi naya network call sirf tab hota hai jab zaroorat ho; har source try/catch ke andar hai. */
(function (FF) {
  const U = FF.util, D = FF.data, S = FF.store;
  const UI = (FF.insights && FF.insights.ui) || {}; // page chrome (head/sourceChip/printButton) insights.js se
  const chrome = (key, fallback) => (typeof UI[key] === 'function' ? UI[key] : fallback);
  const esc = U.esc;
  const clean = (v) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
  const sum = (list, fn) => (list || []).reduce((a, r) => a + Number((fn ? fn(r) : r) || 0), 0);
  const num = (v) => { const n = U.num(v); return Number.isFinite(n) ? n : null; };
  const valid = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const money = (value, digits) => Number(value || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: digits === undefined ? 0 : digits });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const normId = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normName = (v) => clean(v).toUpperCase();
  const pctOf = (a, b) => (Number(b) ? (Number(a) / Number(b)) * 100 : null);
  const median = (values) => {
    const s = (values || []).slice().sort((a, b) => a - b);
    if (!s.length) return 0;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const alertCfg = () => ({ enabled: true, outlierPct: 25, gvGapPct: 40, mismatchPct: 5, mismatchMin: 50, zeroEarnedMin: 1, ...((FF.config.commissionAlerts) || {}) });
  const dispatchCfg = () => ({ tagsPerBox: 25, horizon: 7, minNeed: 1, top: 40, ...((FF.config.dispatch) || {}) });
  const safe = async (fn, fallback) => { try { return await fn(); } catch (err) { return fallback; } };
  const empty = (title, sub) => `<div class="empty-state">${esc(title)}${sub ? `<br><span class="dim small">${esc(sub)}</span>` : ''}</div>`;
  const chip = (text) => `<span class="chip on">${esc(text)}</span>`;

  // ---- data gatherers ------------------------------------------------------------------------------
  /** FF commission mapping + per-agent index (rate / earned / computed). */
  async function commissionIndex() {
    const mapping = await FF.insights.ffCommissionData();
    const byId = new Map(), byName = new Map();
    (mapping.agents || []).forEach((a) => {
      if (a.agentId) byId.set(normId(a.agentId), a);
      if (a.name) byName.set(normName(a.name), a);
    });
    return {
      mapping, byId, byName,
      find: (id, name) => byId.get(normId(id)) || byName.get(normName(name)) || null,
      rate: (id, name) => { const a = byId.get(normId(id)) || byName.get(normName(name)); return a && valid(a.rateValue) ? Number(a.rateValue) : null; }
    };
  }

  /** GV commission per agent (selected month) + class medians for peer comparison. */
  async function gvAgentCommission(monthOverride) {
    const out = { month: monthOverride || '', agents: [], byId: new Map(), byName: new Map(), classMedians: new Map(), rows: [] };
    if (!FF.gv || !FF.gv.enabled || !FF.gv.enabled()) return out;
    const [rows] = await Promise.all([
      safe(() => FF.gv.need('master'), []),
      safe(() => S.need('daily'), [])
    ]);
    const issuance = FF.gv.issuanceRows ? FF.gv.issuanceRows() : rows;
    const months = FF.gv.months ? FF.gv.months() : [...new Set(issuance.map((r) => r.ym))].sort();
    const month = months.includes(monthOverride) ? monthOverride : (months[months.length - 1] || U.ymKey(new Date()));
    out.month = month; out.rows = rows;
    const scoped = rows.filter((r) => r.ym === month);
    const eirScoped = issuance.filter((r) => r.ym === month);
    const byAgent = new Map(), eirCounts = new Map();
    const personKey = (r) => normId(r.agentId) || normName(r.agentName);
    const classKey = (r) => r.group || (FF.gv.classGroup ? FF.gv.classGroup(r.cls) : (r.cls || 'NA'));
    const ensure = (r) => {
      const key = personKey(r); if (!key) return null;
      if (!byAgent.has(key)) byAgent.set(key, { agentId: r.agentId, agentName: r.agentName, tlName: r.tlName, tags: 0, amount: 0, commission: 0, classes: new Map(), days: new Set() });
      const a = byAgent.get(key);
      if (!a.agentId && r.agentId) a.agentId = r.agentId;
      if (!a.agentName && r.agentName) a.agentName = r.agentName;
      if (!a.tlName && r.tlName) a.tlName = r.tlName;
      return a;
    };
    scoped.forEach((r) => {
      const a = ensure(r); if (!a) return;
      a.amount += Number(r.amount || 0); a.commission += Number(r.commission || 0);
      if (r.date) a.days.add(U.dateKey ? U.dateKey(r.date) : String(r.date));
      const cls = classKey(r), c = a.classes.get(cls) || { tags: 0, commission: 0, amount: 0 };
      c.commission += Number(r.commission || 0); c.amount += Number(r.amount || 0); a.classes.set(cls, c);
    });
    eirScoped.forEach((r) => {
      const a = ensure(r); if (!a) return;
      const n = Math.max(0, Number(r.n) || 1), cls = classKey(r), key = `${personKey(r)}|${cls}`;
      eirCounts.set(key, (eirCounts.get(key) || 0) + n);
    });
    byAgent.forEach((a) => {
      a.classes.forEach((c, cls) => { c.tags = eirCounts.get(`${personKey(a)}|${cls}`) || 0; });
      eirCounts.forEach((n, key) => {
        const prefix = `${personKey(a)}|`;
        if (!key.startsWith(prefix) || a.classes.has(key.slice(prefix.length))) return;
        a.classes.set(key.slice(prefix.length), { tags: n, commission: 0, amount: 0 });
      });
      a.tags = [...a.classes.values()].reduce((n, c) => n + c.tags, 0);
    });
    out.agents = [...byAgent.values()].map((a) => ({
      ...a,
      perTag: a.tags ? a.commission / a.tags : 0,
      amountPerTag: a.tags ? a.amount / a.tags : 0,
      classes: [...a.classes.entries()].map(([cls, v]) => ({ cls, ...v, perTag: v.tags ? v.commission / v.tags : 0 })).sort((x, y) => y.tags - x.tags)
    }));
    const classValues = new Map();
    out.agents.forEach((a) => a.classes.forEach((c) => { if (c.tags && c.commission > 0) { if (!classValues.has(c.cls)) classValues.set(c.cls, []); classValues.get(c.cls).push(c.perTag); } }));
    out.agents.forEach((a) => { if (a.agentId) out.byId.set(normId(a.agentId), a); out.byName.set(normName(a.agentName), a); });
    [...classValues.entries()].forEach(([cls, values]) => { if (values.length >= 3) out.classMedians.set(cls, median(values)); });
    return out;
  }

  /** Forecast rows (memoised inside insights) for stock risk / dispatch needs. */
  async function forecastIndex(growth, safety) {
    const rows = await safe(() => FF.insights.forecastRows(growth, safety), []);
    const byId = new Map(), byName = new Map();
    (rows || []).forEach((r) => { if (r.id) byId.set(normId(r.id), r); if (r.name) byName.set(normName(r.name), r); });
    return { rows: rows || [], byId, byName, find: (id, name) => byId.get(normId(id)) || byName.get(normName(name)) || null };
  }

  /** Data-quality findings that mention this agent (by name or ID). */
  async function qualityFor(name, id) {
    const q = await safe(() => FF.insights.qualityIssues(), null);
    if (!q || !Array.isArray(q.findings)) return { issues: [], summary: null };
    const nk = normName(name), ik = normId(id);
    const hits = q.findings.filter((f) => {
      const text = normName(`${f.title || ''} ${(f.samples || []).slice(0, 60).join(' ')} ${f.category || ''}`);
      return (nk && nk.length >= 3 && text.includes(nk)) || (ik && text.includes(ik));
    }).map((f) => ({ severity: f.severity, category: f.category, source: f.source, title: f.title, count: f.count, action: f.action }));
    return { issues: hits, summary: { checksRun: q.checksRun, passed: q.passed, findings: q.findings.length } };
  }

  /** Workspace notes for an entity (best-effort — permission gated). */
  async function notesFor(name) {
    const nk = normName(name);
    const out = await safe(async () => {
      const data = await FF.auth.api('/api/workspace', 'GET');
      return (data.notes || []).filter((n) => {
        const a = normName(n.entityName), b = normName(n.entityKey);
        return (nk && (a === nk || b === nk || (a.length >= 4 && (nk.includes(a) || a.includes(nk)))));
      });
    }, []);
    return out || [];
  }

  // ---- shared markup helpers -----------------------------------------------------------------------
  function metricCards(cards) {
    return `<div class="ins-metrics">${cards.map((c) => `<div class="ins-metric" data-tone="${c.tone || 'g1'}"><span class="ins-metric-icon" aria-hidden="true">${c.icon || '•'}</span><small>${esc(c.label)}</small><b>${c.value}</b><span>${esc(c.foot || '')}</span><span class="ins-metric-tap" aria-hidden="true">🔎 Full data ↗</span></div>`).join('')}</div>`;
  }
  const sevPill = (sev) => `<span class="sev-pill ${esc(sev)}">${esc(sev)}</span>`;

  // ==================================================================================================
  // 1. PAYOUT RECONCILIATION — sheet · rate×tags · slab expected
  // ==================================================================================================
  /** Ek row = ek agent: tags, sheet earned, rate×tags, slab expected, jo payout figure lena chahiye + flags. */
  async function payoutRecon(opts = {}) {
    const [ci, gv] = await Promise.all([commissionIndex(), gvAgentCommission(opts.month)]);
    const mapping = ci.mapping;
    const cfgA = alertCfg();
    const slabRows = (FF.insights.slabVariance ? FF.insights.slabVariance(mapping.agents || [], 'ff', (r) => r.curTotal, (r) => r.earned, (r) => r.name, (r) => r.agentId, (r) => r.tlName) : []) || [];
    const slabByKey = new Map();
    slabRows.forEach((r) => { slabByKey.set(normId(r.id) || normName(r.name), r); });
    const rows = (mapping.agents || []).map((a) => {
      const key = normId(a.agentId) || normName(a.name);
      const slabRow = slabByKey.get(key) || null;
      const tags = Number(a.curTotal || 0);
      const rateSheet = valid(a.rateValue) ? Number(a.rateValue) : null;
      const earned = valid(a.earned) ? Number(a.earned) : null;
      const computed = valid(a.computed) ? Number(a.computed) : (rateSheet !== null && !mapping.rateIsPercent && tags > 0 ? rateSheet * tags : null);
      const slabExpected = slabRow && valid(slabRow.expected) ? Number(slabRow.expected) : null;
      const recommended = earned !== null ? earned : (computed !== null ? computed : slabExpected);
      const source = earned !== null ? 'REPORT earned' : computed !== null ? 'Rate × tags' : slabExpected !== null ? 'Configured slab' : 'Unresolved';
      const diffSlab = rows_numberDiff(earned, slabExpected);
      const flags = [];
      if (!rateSheet && tags > 0) flags.push('Rate missing');
      if (earned === null && tags > 0) flags.push('Earned blank');
      if (earned === 0 && tags > 0) flags.push('Earned zero');
      if (mapping.rateIsPercent && computed === null && tags > 0) flags.push('% rate — base amount needed');
      if (earned !== null && computed !== null) {
        const tolerance = Math.max(cfgA.mismatchMin, (cfgA.mismatchPct / 100) * Math.max(earned, computed));
        if (Math.abs(earned - computed) > tolerance) flags.push('Sheet vs rate×tags mismatch');
      }
      if (diffSlab !== null && Math.abs(diffSlab) > 0.01) flags.push('Slab difference');
      return {
        key, agentId: a.agentId, name: a.name, tl: a.tlName || (a.segment === 'Direct Agent' ? 'Direct' : '—'), segment: a.segment,
        tags, rateSheet, earned, computed, slabExpected, recommended, source, diffSlab, slabTier: slabRow ? slabRow.tier : '', flags,
        status: !recommended ? 'Unresolved' : flags.length ? 'Review' : 'Ready'
      };
    });
    const gvRows = gv.agents.map((a) => {
      const tags = a.tags, commission = a.commission, perTag = a.perTag;
      const classes = a.classes || [];
      const weakest = classes.slice().sort((x, y) => x.perTag - y.perTag)[0] || null;
      const clsMedian = weakest ? (gv.classMedians.get(weakest.cls) || 0) : 0;
      const gapPct = clsMedian ? ((perTag - clsMedian) / clsMedian) * 100 : null;
      const flags = [];
      if (tags >= 3 && perTag <= 0) flags.push('Zero commission');
      if (gapPct !== null && gapPct < -(cfgA.gvGapPct)) flags.push(`Below class median by ${Math.abs(gapPct).toFixed(0)}%`);
      return {
        agentId: a.agentId, name: a.agentName, tl: a.tlName, segment: a.tlName === 'Direct' || !a.tlName ? 'Direct' : 'TL-managed',
        tags, amount: a.amount, earned: commission, computed: null, slabExpected: null, recommended: commission ? commission : null,
        source: commission ? 'GV Master commission' : 'Unresolved', diffSlab: null,
        perTag, classMedianPerTag: clsMedian || null, gapPct, weakestClass: weakest ? weakest.cls : '',
        flags, status: !commission && tags ? 'Unresolved' : flags.length ? 'Review' : 'Ready'
      };
    });
    const totals = {
      ffAgents: rows.length, ffPayable: rows.filter((r) => r.recommended !== null).length,
      ffAmount: sum(rows.filter((r) => r.recommended !== null), (r) => r.recommended),
      ffSheet: sum(rows.filter((r) => r.earned !== null), (r) => r.earned),
      ffComputed: sum(rows.filter((r) => r.computed !== null), (r) => r.computed),
      ffSlab: sum(rows.filter((r) => r.slabExpected !== null), (r) => r.slabExpected),
      ffReview: rows.filter((r) => r.status === 'Review').length,
      ffUnresolved: rows.filter((r) => r.status === 'Unresolved').length,
      gvAgents: gvRows.length, gvAmount: sum(gvRows, (r) => r.earned), gvTags: sum(gvRows, (r) => r.tags),
      gvReview: gvRows.filter((r) => r.status === 'Review').length, month: gv.month,
      rateSource: mapping.rateCol ? `${mapping.rateCol.letter} · ${mapping.rateCol.sub || mapping.rateCol.section}` : 'not detected',
      earnedSource: mapping.amountCol ? `${mapping.amountCol.letter} · ${mapping.amountCol.sub || mapping.amountCol.section}` : 'not detected',
      slabEnabled: !!(FF.config.commissionSlabs && FF.config.commissionSlabs.enabled)
    };
    return { rows, gvRows, totals, mapping };
  }
  function rows_numberDiff(a, b) { return a !== null && b !== null ? a - b : null; }

  const PAYOUT_HEADERS = ['Agent ID', 'Agent', 'TL / Direct', 'Network', 'Tags (period)', 'Rate (sheet)', 'Earned (sheet)', 'Rate × tags', 'Slab expected', 'Payout to process', 'Payout source', 'Δ earned − slab', 'Slab band', 'Status', 'Flags'];
  const GV_PAYOUT_HEADERS = ['Agent ID', 'Agent', 'TL / Direct', 'Network', 'Tags', 'Amount', 'Commission', 'Commission / tag', 'Class median / tag', 'Gap vs median %', 'Weakest class', 'Status', 'Flags'];

  /** FF commission page me dikhne wale payout card + alerts (insights.js isko mount karta hai). */
  function statusPillSafe(text) {
    const tone = /Unresolved/i.test(text) ? 'red' : /Review/i.test(text) ? 'amber' : /^REPORT earned|Rate × tags|GV Master/i.test(text) ? 'green' : 'blue';
    return `<span class="badge ${tone}">${esc(text)}</span>`;
  }

  // ==================================================================================================
  // 3. COMMISSION ALERTS — rule engine
  // ==================================================================================================
  async function commissionAlerts() {
    const cfgA = alertCfg();
    if (cfgA.enabled === false) return [];
    const [ci, gv, fc] = await Promise.all([commissionIndex(), gvAgentCommission(), safe(() => forecastIndex(), { rows: [], find: () => null })]);
    const m = ci.mapping;
    const alerts = [];
    const push = (a) => { if (a && a.count) alerts.push(a); };
    const agentName = (a) => a.name || a.agentId || '—';

    if (!m.rateCol && !m.amountCol) {
      push({ id: 'no-source', severity: 'critical', title: 'REPORT me commission heading hi nahi mili', detail: `Columns A–${m.lastColLetter} scan hue. Settings me letter/heading naam set karo, ya 🔄 fresh sync karo.`, count: 1, samples: [`Scanned columns: ${m.headers.length}`, `Last column: ${m.lastColLetter}`], route: '#/performance', suggestion: 'Settings → Data source me “Commission Rate” likho ya column finder se ek click me set karo.' });
    }
    const rateSamples = (m.agents || []).map((a) => valid(a.rateValue) ? Number(a.rateValue) : null).filter((v) => v !== null && v > 0);
    const rateMedian = median(rateSamples);
    const bySegment = new Map();
    (m.agents || []).forEach((a) => {
      if (!valid(a.rateValue) || Number(a.rateValue) <= 0) return;
      const key = a.segment || 'Other';
      if (!bySegment.has(key)) bySegment.set(key, []);
      bySegment.get(key).push(Number(a.rateValue));
    });
    const segMedians = new Map([...bySegment.entries()].map(([k, v]) => [k, median(v)]));

    const missingRate = (m.agents || []).filter((a) => Number(a.curTotal || 0) > 0 && !(valid(a.rateValue) && Number(a.rateValue) > 0));
    push({ id: 'rate-missing', severity: missingRate.length ? 'high' : 'info', title: 'Rate missing — sheet me issuance hai par rate blank', detail: 'In agents ka commission calculate nahi ho sakta; sheet me rate bharo (ya Settings me sahi column map karo).', count: missingRate.length, samples: missingRate.slice(0, 200).map((a) => `${agentName(a)} (${a.agentId || '—'}) · tags ${a.curTotal || 0}`), route: '#/performance', suggestion: 'Sheet ke Commission Rate column me in agents ki rate add karo.' });

    const zeroEarned = (m.agents || []).filter((a) => valid(a.earned) && Number(a.earned) === 0 && Number(a.curTotal || 0) >= cfgA.zeroEarnedMin);
    push({ id: 'earned-zero', severity: zeroEarned.length ? 'high' : 'info', title: 'Earned = 0 jabki issuance hui hai', detail: 'Sheet me earned amount 0 likha hai — ya rate 0 hai ya payout row update nahi hui.', count: zeroEarned.length, samples: zeroEarned.slice(0, 200).map((a) => `${agentName(a)} · tags ${a.curTotal || 0} · rate ${a.rateRaw || '—'}`), route: '#/performance', suggestion: 'Sheet me in agents ka earned amount verify karo.' });

    const mismatch = (m.agents || []).filter((a) => valid(a.earned) && valid(a.computed) && Math.abs(Number(a.earned) - Number(a.computed)) > Math.max(cfgA.mismatchMin, (cfgA.mismatchPct / 100) * Math.max(Number(a.earned), Number(a.computed))));
    push({ id: 'sheet-mismatch', severity: mismatch.length ? 'medium' : 'info', title: 'Sheet earned aur rate × tags match nahi karte', detail: `Har row me ${cfgA.mismatchPct}% (ya ${money(cfgA.mismatchMin)}) se zyada gap hai — rate ya tags ka koi hissa sheet me update nahi hua.`, count: mismatch.length, samples: mismatch.slice(0, 200).map((a) => `${agentName(a)} · sheet ${money(a.earned, 2)} vs computed ${money(a.computed, 2)} · tags ${a.curTotal || 0}`), route: '#/performance', suggestion: 'Dono figures sheet me compare karo — mismatch wali row theek karo.' });

    const outliers = (m.agents || []).filter((a) => {
      if (!valid(a.rateValue) || Number(a.rateValue) <= 0) return false;
      const med = segMedians.get(a.segment || 'Other') || rateMedian;
      return med > 0 && Math.abs((Number(a.rateValue) - med) / med) * 100 > cfgA.outlierPct;
    });
    push({ id: 'rate-outlier', severity: outliers.length ? 'medium' : 'info', title: `Rate peer median se ${cfgA.outlierPct}%+ alag`, detail: 'Same network (Direct / TL-managed) ke agents ke rate ke muqable ye rate bahut upar/neeche hai — data-entry error ho sakta hai.', count: outliers.length, samples: outliers.slice(0, 200).map((a) => `${agentName(a)} · rate ${a.rateRaw || a.rateValue} (peer median ${(segMedians.get(a.segment || 'Other') || rateMedian).toFixed(2)}) · ${a.segment}`), route: '#/performance', suggestion: 'Outlier rate ko sheet me verify karo.' });

    if (m.rateIsPercent) push({ id: 'percent-rate', severity: 'medium', title: 'Rate percent (%) me hai — base amount ke bina payout nahi banega', detail: 'Sheet ka rate percent lag raha hai, isliye dashboard per-tag payout calculate nahi karta (galat amount se bachne ke liye).', count: (m.agents || []).filter((a) => Number(a.curTotal || 0) > 0).length, samples: (m.agents || []).slice(0, 200).map((a) => `${agentName(a)} · rate ${a.rateRaw || '—'}`), route: '#/performance', suggestion: 'Percent rate ke saath base amount (ya per-tag rate) column bhi do.' });

    if (gv.agents.length) {
      const gvGap = gv.agents.filter((a) => {
        const cls = (a.classes || []).slice().sort((x, y) => x.perTag - y.perTag)[0];
        const med = cls ? (gv.classMedians.get(cls.cls) || 0) : 0;
        return a.tags >= 3 && med > 0 && a.perTag < med * (1 - cfgA.gvGapPct / 100);
      });
      push({ id: 'gv-class-gap', severity: gvGap.length ? 'medium' : 'info', title: `GV commission per tag class median se ${cfgA.gvGapPct}%+ neeche`, detail: 'GV Master me in agents ka ₹/tag apni class ke median se kaafi kam hai — rate ya amount row check karni chahiye.', count: gvGap.length, samples: gvGap.slice(0, 200).map((a) => { const cls = (a.classes || []).slice().sort((x, y) => x.perTag - y.perTag)[0]; const med = cls ? (gv.classMedians.get(cls.cls) || 0) : 0; return `${a.agentName} · ${cls ? cls.cls : '—'} ₹/tag ${a.perTag.toFixed(2)} vs median ${med.toFixed(2)} · tags ${a.tags}`; }), route: '#/gvPerformance', suggestion: 'GV Master me in rows ka amount/commission verify karo.' });

      const gvZero = gv.agents.filter((a) => a.tags >= 3 && a.commission <= 0);
      push({ id: 'gv-zero', severity: gvZero.length ? 'high' : 'info', title: 'GV me commission 0 par tags issue hue', detail: 'GV Master me commission column blank/zero hai — payout list adhoori rahegi.', count: gvZero.length, samples: gvZero.slice(0, 200).map((a) => `${a.agentName} · tags ${a.tags} · amount ${money(a.amount, 0)}`), route: '#/gvPerformance', suggestion: 'GV Master commission column bharo.' });
    }

    const high7 = fc.rows.filter((r) => r.need7 > 0 && r.rate > 0 && r.stockDays <= 7);
    push({ id: 'commission-at-risk', severity: high7.length ? 'medium' : 'info', title: 'Stock-out se commission at risk', detail: 'Ye agents 7 din me stock khatam kar denge — stock nahi gaya to inki commission ruk jayegi.', count: high7.length, samples: high7.slice(0, 200).map((r) => `${r.name} (${r.channel}) · cover ${Number.isFinite(r.stockDays) ? r.stockDays.toFixed(1) : '—'} din · need ${r.need7} tags`), route: '#/dispatchPlan', suggestion: 'Dispatch planner se in agents ka stock bhejo.' });
    return alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  }
  function severityRank(s) { return s === 'critical' ? 4 : s === 'high' ? 3 : s === 'medium' ? 2 : 1; }


  // ==================================================================================================
  // 2. AGENT 360
  // ==================================================================================================
  async function agent360(opts = {}) {
    const name = clean(opts.name || opts.entityName || opts.agentName);
    const id = clean(opts.id || opts.agentId);
    if (!name && !id) { U.toast('Agent ka naam ya ID chahiye', 'warn'); return null; }
    await FF.pages.performance.ensureLoaded().catch(() => {});
    const ffAgents = (FF.pages.performance.agents ? FF.pages.performance.agents() : []) || [];
    const ffAgent = ffAgents.find((a) => (id && normId(a.agentId || a.id) === normId(id)) || (name && normName(a.name) === normName(name))) || null;
    const displayName = (ffAgent && ffAgent.name) || name || id;
    const [ci, gv, fc, eirMonths, ffStock, gvStock, gvStockClass, quality, notes, cross] = await Promise.all([
      safe(() => commissionIndex(), { mapping: {}, find: () => null }),
      gvAgentCommission(),
      forecastIndex(),
      safe(async () => (await S.need('agents')).filter((r) => (id && normId(r.id) === normId(id)) || (name && normName(r.name) === normName(name))), []),
      safe(async () => (await S.need('stockAgents')).filter((r) => (id && normId(r.agentId) === normId(id)) || (name && normName(r.agentName) === normName(name))), []),
      safe(async () => (await FF.gv.need('stockAgent')).filter((r) => (id && normId(r.agentId) === normId(id)) || (name && normName(r.agentName) === normName(name))), []),
      safe(async () => (await FF.gv.need('stockAgentClass')).filter((r) => name && normName(r.agentName) === normName(name)), []),
      qualityFor(displayName, id || (ffAgent && ffAgent.agentId)),
      notesFor(displayName),
      safe(() => FF.insights.buildCross(), null)
    ]);
    const comm = ci.find(ffAgent ? ffAgent.agentId : id, displayName);
    const gvRow = gv.byId.get(normId(id)) || gv.byName.get(normName(displayName)) || null;
    const risk = fc.find(ffAgent ? ffAgent.agentId : id, displayName);
    const crossRow = cross ? cross.rows.find((r) => (r.ff && (normName(r.ff.name) === normName(displayName) || normId(r.ff.id) === normId(id))) || (r.gv && (normName(r.gv.name) === normName(displayName) || normId(r.gv.id) === normId(id)))) || null : null;
    const ffStockTotal = sum(ffStock, (r) => r.n);
    const gvStockTotal = sum(gvStock, (r) => r.n);
    const classesOf = (rows, key) => {
      const map = new Map();
      rows.forEach((r) => { const k = r.group || 'NA'; map.set(k, (map.get(k) || 0) + Number(r.n || 0)); });
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };
    const monthly = (() => {
      const map = new Map();
      eirMonths.forEach((r) => { const m = map.get(r.ym) || { ym: r.ym, ff: 0, gv: 0, channel: r.channel }; if (r.channel === 'GV Partner') m.gv += r.n; else m.ff += r.n; map.set(r.ym, m); });
      if (gvRow) { /* GV master rows filtered below */ }
      return [...map.values()].sort((a, b) => String(a.ym).localeCompare(String(b.ym))).slice(-8);
    })();
    // GV monthly trend (last 8 months) directly from GV master
    const gvMonths = (() => {
      if (!gv.rows.length) return [];
      const map = new Map();
      gv.rows.filter((r) => normId(r.agentId) === normId(gvRow ? gvRow.agentId : id) || normName(r.agentName) === normName(displayName))
        .forEach((r) => { const m = map.get(r.ym) || { ym: r.ym, tags: 0, commission: 0, amount: 0 }; m.tags++; m.commission += Number(r.commission || 0); m.amount += Number(r.amount || 0); map.set(r.ym, m); });
      return [...map.values()].sort((a, b) => String(a.ym).localeCompare(String(b.ym))).slice(-8);
    })();
    const blocks = [];
    if (ffAgent && !(comm && comm.rateValue > 0)) blocks.push('FF rate missing — commission calculate nahi ho sakta');
    if (risk && risk.risk === 'Critical') blocks.push(`Stock-out in ${Number.isFinite(risk.stockDays) ? risk.stockDays.toFixed(1) : '—'} days`);
    if (crossRow && (crossRow.ffDup || crossRow.gvDup || crossRow.crossOwner)) blocks.push('Double-mapped barcode (cross-channel)');
    if (gvRow && gvRow.tags >= 3 && gvRow.commission <= 0) blocks.push('GV commission zero');
    if (quality.issues.length) blocks.push(`${quality.issues.length} data-quality finding(s)`);
    if (notes.some((n) => n.status !== 'done')) blocks.push('Open follow-up note');

    const kv = (label, value, note) => `<div class="dkpi"><small>${esc(label)}</small><b>${value}</b><span>${esc(note || '')}</span></div>`;
    const sec = (title, inner, sub) => `<div class="dsec"><h4>${esc(title)}${sub ? ` <small class="dim">${esc(sub)}</small>` : ''}</h4>${inner}</div>`;
    const table = (headers, rows) => `<div class="table-wrap"><table class="data-table ins-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}">No rows</td></tr>`}</tbody></table></div>`;

    const overviewPane = `
      <div class="dkpis">
        ${kv('FF tags · MTD', U.fmt(ffAgent ? ffAgent.curTotal : 0), ffAgent ? `VC4 ${U.fmt(ffAgent.curVc4)} · Comm ${U.fmt(ffAgent.curNvc4)}` : 'REPORT me nahi mila')}
        ${kv('FF stock', U.fmt(ffStockTotal || (ffAgent ? ffAgent.stockTotal : 0)), `${ffStock.length} class rows`)}
        ${kv('GV tags · ' + (gv.month ? U.labelYM(gv.month) : 'MTD'), U.fmt(gvRow ? gvRow.tags : 0), gvRow ? `${money(gvRow.commission, 2)} commission` : 'GV Master me nahi mila')}
        ${kv('GV stock', U.fmt(gvStockTotal), gvStockClass.length ? `${gvStockClass.length} class rows` : 'Tag Assignment')}
        ${kv('Commission', comm && valid(comm.earned) ? money(comm.earned, 2) : comm && valid(comm.computed) ? money(comm.computed, 2) : gvRow ? money(gvRow.commission, 2) : '—', comm && valid(comm.rateValue) ? `rate ${comm.rateRaw || comm.rateValue}` : gvRow ? `GV ₹/tag ${gvRow.perTag.toFixed(2)}` : 'rate missing')}
        ${kv('Stock risk', risk ? `${esc(risk.risk)}` : '—', risk ? `cover ${Number.isFinite(risk.stockDays) ? risk.stockDays.toFixed(1) : '—'} din · need7 ${U.fmt(risk.need7)}` : 'forecast me nahi mila')}
      </div>
      <div class="a360-targets"><b>🎯 Target & stock outlook</b><span>${risk && Number.isFinite(risk.need7) ? `Need ${U.fmt(risk.need7)} tags for 7 days` : 'Target data unavailable'}</span><span>${risk && Number.isFinite(risk.stockDays) ? `Cover ${risk.stockDays.toFixed(1)} days` : 'Cover —'}</span><span>${ffAgent && ffAgent.tlName ? `TL ${esc(ffAgent.tlName)}` : 'Direct / channel-only'}</span></div>
      ${blocks.length ? `<div class="mapping-state warn a360-alerts"><div class="mapping-icon">⛔</div><div><h3>${U.fmt(blocks.length)} alert${blocks.length === 1 ? '' : 's'}</h3>${blocks.map((b) => `<p>${esc(b)}</p>`).join('')}<small>Review before payout or dispatch.</small></div></div>` : `<div class="mapping-state a360-alerts"><div class="mapping-icon">✅</div><div><b>No active blocker</b><span>Rate, stock and cross-channel checks are clear.</span></div></div>`}
      <div class="a360-overview-note"><span>Overview combines FF + GV where the source has a verified agent ID or exact name match.</span><span class="dim">Last calculated ${esc(new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span></div>`;
    const issuancePane = `${sec('📈 Issuance trend · FF (EIR) + GV', table(['Month', 'FF tags', 'GV tags', 'Total'], monthly.map((m) => [esc(m.ym), U.fmt(m.ff), U.fmt(m.gv), `<b>${U.fmt(m.ff + m.gv)}</b>`])), 'EIR months × channel')}
      ${gvMonths.length ? sec('🟩 GV monthly · tags / amount / commission', table(['Month', 'Tags', 'Amount', 'Commission', '₹ / tag'], gvMonths.map((m) => [esc(m.ym), U.fmt(m.tags), money(m.amount, 0), money(m.commission, 2), m.tags ? (m.commission / m.tags).toFixed(2) : '—']))) : '<p class="dim small">GV monthly history unavailable.</p>'}`;
    const stockPane = `${sec('🚗 Class split (stock)', table(['Source', 'Class', 'Tags'], [
        ...classesOf(ffStock, 'group').map(([cls, n]) => [statusPillSafe('FF stock'), esc(cls), U.fmt(n)]),
        ...classesOf(gvStockClass, 'group').map(([cls, n]) => [statusPillSafe('GV stock'), esc(cls), U.fmt(n)])
      ]))}
      ${gvRow && gvRow.classes.length ? sec('🟩 GV class mix · current month', table(['Class', 'Tags', 'Commission', '₹ / tag', 'Class median', 'Gap'], gvRow.classes.map((c) => { const med = gv.classMedians.get(c.cls) || 0; const gap = med ? ((c.perTag - med) / med) * 100 : null; return [esc(c.cls), U.fmt(c.tags), money(c.commission, 2), c.perTag.toFixed(2), med ? med.toFixed(2) : '—', gap === null ? '—' : `<span class="badge ${gap < -20 ? 'red' : gap < 0 ? 'amber' : 'green'}">${gap.toFixed(0)}%</span>`]; }))) : ''}`;
    const historyPane = `${sec('🧪 Data quality', quality.issues.length ? `<div class="finding-mini">${quality.issues.map((f) => `<div>${sevPill(f.severity)} <b>${esc(f.title)}</b> <span class="dim small">${esc(f.category)} · ${esc(f.source)}</span> <small>${U.fmt(f.count)} record(s)</small></div>`).join('')}</div>` : `<p class="dim small">Is agent ke naam par koi DQ finding nahi mili (${quality.summary ? `${U.fmt(quality.summary.checksRun)} checks run hue` : 'checks available nahi'}).</p>`)}
      ${crossRow ? sec('🔗 Cross-channel match', table(['FF agent', 'FF TL', 'GV agent', 'GV TL', 'Shared barcodes', 'Evidence', 'Flags'], [[esc(crossRow.ff.name || crossRow.ff.id), esc(crossRow.ff.tlName || '—'), esc(crossRow.gv.name || crossRow.gv.id), esc(crossRow.gv.tlName || '—'), U.fmt(crossRow.barcodeCount), esc(crossRow.methods.join(' + ')), crossRow.ffDup || crossRow.gvDup || crossRow.crossOwner ? statusPillSafe('Double-mapped') : statusPillSafe('Clean')]])) : sec('🔗 Cross-channel match', `<p class="dim small">Is agent ka doosre channel me verified match nahi mila (naam se guess nahi kiya jaata).</p>`)}
`;
    const notesPane = sec('📝 Notes & follow-ups', notes.length ? `<div class="note-history">${notes.slice(0, 12).map((n) => `<div><i></i><p><b>${esc(n.status)} · ${esc(n.priority || 'normal')}</b><span>${esc(n.createdByUser ? (n.createdByUser.name || n.createdByUser.username) : n.createdBy || '')} · ${esc(n.dueAt ? String(n.dueAt).slice(0, 10) : '')}</span><small>${esc(n.text).slice(0, 240)}</small></p></div>`).join('')}</div>` : `<p class="dim small">Koi note nahi.</p>`);
    const gvCandidates = gv && gv.byId ? [...gv.byId.values()].filter((a) => a && (a.agentName || a.name)).map((a) => ({ name: a.agentName || a.name, agentId: a.agentId || a.id, tlName: a.tlName })) : [];
    const candidateAgents = [...new Map([...ffAgents, ...gvCandidates].filter((a) => a && a.name).map((a) => [normId(a.agentId || a.id) || `name:${normName(a.name)}`, a])).values()].sort((a, b) => normName(a.name).localeCompare(normName(b.name)));
    const currentIndex = candidateAgents.findIndex((a) => (id && normId(a.agentId || a.id) === normId(id)) || normName(a.name) === normName(displayName));
    const previousAgent = currentIndex > 0 ? candidateAgents[currentIndex - 1] : null;
    const nextAgent = currentIndex >= 0 && currentIndex < candidateAgents.length - 1 ? candidateAgents[currentIndex + 1] : null;
    const nav = `<div class="a360-nav"><button class="btn small" data-a360-nav="prev" ${previousAgent ? '' : 'disabled'}>← Previous</button><span>${currentIndex >= 0 ? `${currentIndex + 1} / ${candidateAgents.length}` : 'Profile'}</span><button class="btn small" data-a360-nav="next" ${nextAgent ? '' : 'disabled'}>Next →</button></div>`;
    const tab = (key, label, content, active) => `<section class="a360-pane ${active ? 'active' : ''}" data-a360-pane="${key}">${content}</section>`;
    const body = `<div class="a360"><div class="a360-profile-head"><div class="a360-avatar">${esc(displayName.slice(0, 1).toUpperCase())}</div><div class="a360-identity"><span class="a360-kicker">AGENT 360 · ${crossRow ? 'DUAL-CHANNEL' : 'SOURCE PROFILE'}</span><h2>${esc(displayName)}</h2><p>${esc([ffAgent && ffAgent.tlName ? `TL ${ffAgent.tlName}` : 'Direct / unassigned', ffAgent && (ffAgent.agentId || ffAgent.id) ? `ID ${ffAgent.agentId || ffAgent.id}` : id, ffAgent && ffAgent.agentStatus ? ffAgent.agentStatus : ''].filter(Boolean).join(' · '))}</p></div><div class="a360-head-side">${risk ? `<span class="a360-risk ${String(risk.risk || '').toLowerCase()}">${esc(risk.risk || 'Risk')} · ${Number.isFinite(risk.stockDays) ? `${risk.stockDays.toFixed(1)}d cover` : '—'}</span>` : '<span class="a360-risk neutral">No forecast</span>'}${nav}</div></div><div class="a360-tabs" role="tablist"><button class="a360-tab active" data-a360-tab="overview" role="tab">Overview</button><button class="a360-tab" data-a360-tab="issuance" role="tab">Issuance</button><button class="a360-tab" data-a360-tab="stock" role="tab">Stock</button><button class="a360-tab" data-a360-tab="history" role="tab">History & alerts</button><button class="a360-tab" data-a360-tab="notes" role="tab">Notes</button></div>${tab('overview', 'Overview', overviewPane, true)}${tab('issuance', 'Issuance', issuancePane, false)}${tab('stock', 'Stock', stockPane, false)}${tab('history', 'History & alerts', historyPane, false)}${tab('notes', 'Notes', notesPane, false)}</div>`;
    const csvRows = [
      ['Identity', 'Agent', displayName], ['Identity', 'Agent ID', (ffAgent && (ffAgent.agentId || ffAgent.id)) || id || ''],
      ['Identity', 'TL', (ffAgent && ffAgent.tlName) || (gvRow && gvRow.tlName) || '—'],
      ['FF', 'MTD tags', ffAgent ? ffAgent.curTotal : 0], ['FF', 'MTD VC4', ffAgent ? ffAgent.curVc4 : 0], ['FF', 'MTD commercial', ffAgent ? ffAgent.curNvc4 : 0],
      ['FF', 'Stock tags', ffStockTotal], ['FF', 'Rate', comm && comm.rateRaw ? comm.rateRaw : ''],
      ['FF', 'Earned (sheet)', comm && valid(comm.earned) ? comm.earned : ''], ['FF', 'Rate × tags', comm && valid(comm.computed) ? comm.computed : ''],
      ['GV', 'Month', gv.month], ['GV', 'Tags', gvRow ? gvRow.tags : 0], ['GV', 'Amount', gvRow ? gvRow.amount : ''], ['GV', 'Commission', gvRow ? gvRow.commission : ''], ['GV', 'Commission / tag', gvRow ? gvRow.perTag.toFixed(2) : ''],
      ['GV', 'Stock tags', gvStockTotal],
      ['Risk', 'Risk', risk ? risk.risk : ''], ['Risk', 'Cover days', risk && Number.isFinite(risk.stockDays) ? risk.stockDays.toFixed(1) : ''], ['Risk', 'Need 7d', risk ? risk.need7 : ''], ['Risk', 'Need 15d', risk ? risk.need15 : ''],
      ['Flags', 'Blockers', blocks.join(' · ')],
      ...monthly.map((m) => ['Trend', m.ym, `FF ${m.ff} · GV ${m.gv}`]),
      ...notes.map((n) => ['Note', `${n.status} · ${String(n.createdAt || '').slice(0, 10)}`, String(n.text || '').slice(0, 200)])
    ];
    FF.app.openDrawer({
      age: { kind: 'agent', key: (ffAgent && (ffAgent.id || ffAgent.agentId)) || (gvRow && gvRow.agentId) || displayName, keys: [displayName, ffAgent && ffAgent.agentId, gvRow && gvRow.agentId].filter(Boolean), ch: ffAgent && gvRow ? '' : gvRow ? 'gv' : 'ff', title: displayName },
      kicker: 'Agent 360', title: displayName, sub: [ffAgent ? 'First Forward' : '', gvRow ? 'GV Partner' : '', crossRow ? 'Dual-channel' : ''].filter(Boolean).join(' · ') || 'Channel: unknown',
      wide: true,
      actions: `<button class="btn small" id="a360-csv">⬇ Agent CSV</button><button class="btn small" id="a360-wa">📲 WhatsApp</button><button class="btn small" id="a360-link">🔗 Copy link</button><button class="btn small" id="a360-print">🖨 Print</button>`,
      body
    });
    const drawerBody = U.$('#drawer-body', document);
    if (drawerBody) drawerBody.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-a360-tab]');
      if (tabBtn) {
        const key = tabBtn.dataset.a360Tab;
        drawerBody.querySelectorAll('[data-a360-tab]').forEach((b) => { const on = b === tabBtn; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
        drawerBody.querySelectorAll('[data-a360-pane]').forEach((pane) => pane.classList.toggle('active', pane.dataset.a360Pane === key));
        return;
      }
      const navBtn = e.target.closest('[data-a360-nav]');
      if (navBtn && !navBtn.disabled) {
        const target = navBtn.dataset.a360Nav === 'prev' ? previousAgent : nextAgent;
        if (target) { FF.app.closeDrawer(); agent360({ name: target.name, id: target.agentId || target.id || '' }).catch((err) => U.toast(err.message || 'Profile load nahi hua', 'err')); }
      }
    });
    const printBtn = U.$('#a360-print', document);
    if (printBtn) printBtn.addEventListener('click', () => { document.body.classList.add('print-a360'); window.print(); setTimeout(() => document.body.classList.remove('print-a360'), 500); });
    const csvBtn = U.$('#a360-csv', document);
    if (csvBtn) csvBtn.addEventListener('click', () => U.downloadCsv(`agent-360-${(displayName || 'agent').replace(/[^\w]+/g, '-').toLowerCase()}-${U.stamp()}.csv`, ['Section', 'Field', 'Value'], csvRows));
    const waBtn = U.$('#a360-wa', document);
    if (waBtn) waBtn.addEventListener('click', () => {
      const lines = [`*${displayName}* · Agent 360`, `FF: ${ffAgent ? ffAgent.curTotal : 0} tags MTD · stock ${ffStockTotal}`, gvRow ? `GV: ${gvRow.tags} tags · commission ${money(gvRow.commission, 2)}` : '', risk ? `Risk: ${risk.risk} · cover ${Number.isFinite(risk.stockDays) ? risk.stockDays.toFixed(1) : '—'} din` : '', blocks.length ? `Blockers: ${blocks.join(' · ')}` : 'Blockers: none'].filter(Boolean);
      FF.app.shareWhatsApp(lines.join('\n'));
    });
    const linkBtn = U.$('#a360-link', document);
    if (linkBtn) linkBtn.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#/dualChannel?q=${encodeURIComponent(displayName)}`;
      const ok = await U.copyText(url);
      U.toast(ok ? 'Link copy ho gaya' : 'Copy nahi hui', ok ? 'ok' : 'warn');
    });
    return { displayName, ffAgent, gvRow, risk, blocks, rows: csvRows };
  }

  // ==================================================================================================
  // 4. DISPATCH PLANNER
  // ==================================================================================================
  async function dispatchPlan(opts = {}) {
    const dcfg = dispatchCfg();
    const horizon = [7, 15, 30].includes(Number(opts.horizon)) ? Number(opts.horizon) : dcfg.horizon;
    const growth = Number.isFinite(Number(opts.growth)) ? Number(opts.growth) : 0;
    const safety = Number.isFinite(Number(opts.safety)) ? Number(opts.safety) : 5;
    const perBox = Number(opts.tagsPerBox) > 0 ? Number(opts.tagsPerBox) : dcfg.tagsPerBox;
    const fc = await forecastIndex(growth, safety);
    const agentClass = await safe(() => S.need('agentClass'), []);
    const shareOf = (row) => {
      const key = normName(row.name);
      const list = agentClass.filter((r) => normName(r.name) === key);
      const map = new Map();
      list.forEach((r) => map.set(r.group || 'NA', (map.get(r.group || 'NA') || 0) + Number(r.n || 0)));
      const total = [...map.values()].reduce((a, b) => a + b, 0);
      return { map, total };
    };
    const needKey = horizon === 30 ? 'need30' : horizon === 15 ? 'need15' : 'need7';
    const rows = fc.rows
      .filter((r) => r.need7 > 0 || r.need15 > 0 || r.need30 > 0)
      .map((r) => {
        const need = Math.max(0, Number(r[needKey] || 0));
        const shelves = Math.max(1, Math.ceil(need / perBox));
        const { map, total } = shareOf(r);
        const classes = total ? [...map.entries()].map(([cls, n]) => ({ cls, tags: Math.round((n / total) * need * 10) / 10, share: n / total })).sort((a, b) => b.tags - a.tags) : [];
        return {
          ...r, need, shelves, boxes: shelves, dispatchTags: shelves * perBox,
          extra: shelves * perBox - need, classes,
          priority: r.risk === 'Critical' ? 1 : r.risk === 'High' ? 2 : r.risk === 'Medium' ? 3 : 4,
          why: r.stockDays <= 0 ? 'Stock khatam' : `Cover ${Number.isFinite(r.stockDays) ? r.stockDays.toFixed(1) : '—'} din`
        };
      })
      .filter((r) => r.need >= Math.max(1, Number(opts.minNeed) || dcfg.minNeed))
      .sort((a, b) => a.priority - b.priority || b.need - a.need || b.rate - a.rate);
    // 🧍 Direct agents (GV: no TL ID + no TL name · FF: TL Name APS) ko stock dispatch nahi jaata.
    const directRows = rows.filter((r) => r.direct);
    const pool = ['eligible', 'direct', 'all'].includes(opts.pool) ? opts.pool : 'eligible';
    const plan = pool === 'direct' ? directRows : pool === 'all' ? rows : rows.filter((r) => !r.direct);
    const totals = {
      agents: plan.length, tags: sum(plan, (r) => r.dispatchTags), boxes: sum(plan, (r) => r.boxes),
      critical: plan.filter((r) => r.risk === 'Critical').length, high: plan.filter((r) => r.risk === 'High').length,
      ff: plan.filter((r) => r.channel === 'First Forward').length, gv: plan.filter((r) => r.channel === 'GV Partner').length,
      direct: directRows.length, eligible: rows.filter((r) => !r.direct).length, pool,
      horizon, perBox, growth, safety
    };
    return { rows: plan, allRows: rows, directRows, totals, cfg: dcfg };
  }

  async function renderDispatchPlan(root, params) {
    const dcfg = dispatchCfg();
    const horizon = [7, 15, 30].includes(Number(params.horizon)) ? Number(params.horizon) : dcfg.horizon;
    const growth = Number.isFinite(Number(params.growth)) ? Number(params.growth) : 0;
    const safety = Number.isFinite(Number(params.safety)) ? Number(params.safety) : 5;
    const perBox = Number(params.box) > 0 ? Number(params.box) : dcfg.tagsPerBox;
    const channel = ['all', 'ff', 'gv'].includes(params.channel) ? params.channel : 'all';
    const q = clean(params.q).toLowerCase();
    const pool = ['eligible', 'direct', 'all'].includes(params.pool) ? params.pool : 'eligible';
    const data = await dispatchPlan({ horizon, growth, safety, tagsPerBox: perBox, pool });
    const rows = data.rows.filter((r) => (channel === 'ff' ? r.channel === 'First Forward' : channel === 'gv' ? r.channel === 'GV Partner' : true) && (!q || [r.name, r.id, r.tlName, r.risk, r.direct ? 'direct' : ''].join(' ').toLowerCase().includes(q)));
    const t = data.totals;
    const tlGroups = new Map();
    rows.forEach((r) => { const k = r.direct ? FF.config.directLabel(r, r.channel === 'GV Partner' ? 'gv' : 'ff') : (r.tlName || 'Direct / unmapped'); if (!tlGroups.has(k)) tlGroups.set(k, []); tlGroups.get(k).push(r); });
    const D_HEADERS = ['Agent', 'Agent ID', 'Channel', 'TL', 'Stock', 'Demand / day', 'Cover days', 'Risk', `Need ${horizon}d`, 'Boxes', 'Dispatch tags', 'Buffer tags', 'Class split'];
    const toArray = (r) => [r.name, r.id, r.channel, r.direct ? FF.config.directLabel(r, r.channel === 'GV Partner' ? 'gv' : 'ff') : r.tlName, r.stock, Number.isFinite(r.rate) ? Number(r.rate.toFixed(2)) : '', Number.isFinite(r.stockDays) ? Number(r.stockDays.toFixed(1)) : '', r.risk, r.need, r.boxes, r.dispatchTags, r.extra, r.classes.map((c) => `${c.cls} ${c.tags}`).join(' | ')];
    const planText = () => {
      const lines = [`*Dispatch plan · ${horizon} din* (${new Date().toLocaleDateString('en-IN')})`, `${t.agents} agents · ${U.fmt(rows.reduce((a, r) => a + r.dispatchTags, 0))} tags · ${U.fmt(rows.reduce((a, r) => a + r.boxes, 0))} boxes`, ''];
      [...tlGroups.entries()].slice(0, 12).forEach(([tl, list]) => {
        lines.push(`*${tl}*`);
        list.slice(0, 8).forEach((r) => lines.push(`· ${r.name}: ${r.boxes} box (${r.dispatchTags} tags) · ${r.why}`));
      });
      return lines.join('\n');
    };
    root.innerHTML = UI.head('🚚', 'Dispatch Planner', `Forecast ke urgent agents ka auto plan — boxes, class split aur printable pick-list. Growth ${growth}% · safety ${safety} din · 1 box = ${perBox} tags`,
      `<button class="btn small" id="dp-csv">⬇ Plan CSV</button><button class="btn small" id="dp-xlsx">⬇ Plan Excel</button><button class="btn small" id="dp-wa">📲 WhatsApp</button><button class="btn small" id="dp-log">📝 Log plan</button>${UI.printButton}`) + `
      <div class="source-row">${UI.sourceChip('Forecast engine', `${U.fmt(data.allRows.length)} agents need stock`)}${UI.sourceChip('🚫 Direct agents', `${U.fmt(data.totals.direct)} tags only · no stock`)}${UI.sourceChip('Box size', `${U.fmt(perBox)} tags / box`)}${UI.sourceChip('Horizon', `${horizon} din ahead`)}<span class="dim small">Need = projected demand × safety buffer − current stock; boxes upar round hote hain</span></div>
      <div class="ins-filters">
        <form id="dp-controls" class="ins-search"><label class="fld"><span>Horizon</span><select class="select" name="horizon">${[7, 15, 30].map((h) => `<option value="${h}" ${h === horizon ? 'selected' : ''}>${h} din</option>`).join('')}</select></label>
        <label class="fld"><span>Growth %</span><input class="input" type="number" name="growth" min="-50" max="150" value="${growth}" style="width:82px"></label>
        <label class="fld"><span>Safety din</span><input class="input" type="number" name="safety" min="0" max="30" value="${safety}" style="width:70px"></label>
        <label class="fld"><span>Box size</span><input class="input" type="number" name="box" min="1" max="500" value="${perBox}" style="width:78px"></label>
        <label class="fld"><span>Dispatch pool</span><select class="select" data-param="pool"><option value="eligible" ${pool === 'eligible' ? 'selected' : ''}>🚚 Need stock (direct excluded)</option><option value="direct" ${pool === 'direct' ? 'selected' : ''}>🏷️ Direct agents · tag required (no stock)</option><option value="all" ${pool === 'all' ? 'selected' : ''}>All forecast agents</option></select></label>
        <label class="fld"><span>Channel</span><select class="select" data-param="channel"><option value="all">Both</option><option value="ff" ${channel === 'ff' ? 'selected' : ''}>First Forward</option><option value="gv" ${channel === 'gv' ? 'selected' : ''}>GV Partner</option></select></label>
        <input class="input" name="q" value="${esc(params.q || '')}" placeholder="Agent / TL / risk…"><button class="btn primary">Apply</button></form>
      </div>
      ${metricCards([
        { label: 'Agents to dispatch', value: U.fmt(t.agents), foot: `${U.fmt(t.ff)} FF · ${U.fmt(t.gv)} GV`, tone: 'g1', icon: '🚚' },
        { label: 'Total boxes', value: U.fmt(t.boxes), foot: `${U.fmt(t.tags)} tags (1 box = ${U.fmt(perBox)})`, tone: 'g3', icon: '📦' },
        { label: 'Critical (stock-out)', value: U.fmt(t.critical), foot: `${U.fmt(t.high)} high risk`, tone: t.critical ? 'g7' : 'g9', icon: '🚨' },
        { label: 'Buffer tags', value: U.fmt(sum(rows, (r) => r.extra)), foot: 'Box rounding ke wajah se extra', tone: 'g5', icon: '➕' },
        { label: 'Top need', value: rows.length ? U.fmt(rows[0].need) : '0', foot: rows.length ? `${rows[0].name} · ${rows[0].risk}` : '—', tone: 'g6', icon: '⚡' },
        { label: 'TL groups', value: U.fmt(tlGroups.size), foot: 'Har TL ka apna dispatch block', tone: 'g4', icon: '👥' }
      ])}
      <div class="card"><div class="card-head"><h3>🎯 Auto dispatch plan · priority order</h3><span class="dim small">${U.fmt(rows.length)} agents · ${U.fmt(sum(rows, (r) => r.boxes))} boxes</span><div class="btn-row"><button class="btn small" id="dp-csv-2">⬇ CSV</button><button class="btn small" id="dp-copy">📋 Copy</button></div></div>
        <p class="dim small">Priority: <b>Critical → High → Medium</b>, phir sabse zyada need. Class split current month ke issuance share se nikalta hai (VC4 / VC20 / VC5+), sirf guidance ke liye — total boxes upar hi set hain.</p>
        <div class="table-wrap"><table class="data-table ins-table"><thead><tr><th class="tone-blue">#</th><th class="tone-blue">Agent</th><th class="tone-blue">Channel</th><th class="tone-blue">TL</th><th class="tone-blue num">Stock</th><th class="tone-blue num">Demand / day</th><th class="tone-blue num">Cover</th><th class="tone-blue">Risk</th><th class="tone-blue num">Need ${horizon}d</th><th class="tone-blue num">Boxes</th><th class="tone-blue num">Dispatch tags</th><th class="tone-blue">Class split</th></tr></thead><tbody>
          ${rows.slice(0, 120).map((r, i) => `<tr class="${r.risk === 'Critical' ? 'dup-row' : ''}"><td>${i + 1}</td><td><b class="agent-link" data-agent360="${esc(r.name)}">${esc(r.name)}</b><small>${esc(r.id || '')}</small></td><td>${statusPillSafe(r.channel)}</td><td>${r.direct ? `<b class="direct-chip">🚫 ${esc(FF.config.directLabel(r, r.channel === 'GV Partner' ? 'gv' : 'ff'))}</b>` : esc(r.tlName || 'Direct')}</td><td class="num">${U.fmt(r.stock)}</td><td class="num">${Number.isFinite(r.rate) ? r.rate.toFixed(1) : '—'}</td><td class="num">${Number.isFinite(r.stockDays) ? `<span class="badge ${r.stockDays <= 3 ? 'red' : r.stockDays <= 7 ? 'amber' : 'green'}">${r.stockDays.toFixed(1)}</span>` : '—'}</td><td>${statusPillSafe(r.risk)}</td><td class="num"><b>${U.fmt(r.need)}</b></td><td class="num"><b>${U.fmt(r.boxes)}</b></td><td class="num">${U.fmt(r.dispatchTags)}</td><td class="small">${r.classes.length ? esc(r.classes.map((c) => `${c.cls} ${c.tags}`).join(' · ')) : '<span class="dim">class history nahi</span>'}</td></tr>`).join('') || `<tr><td colspan="12">${empty('Dispatch ki zaroorat nahi', 'Is filter par koi agent 7 din me stock-out nahi ho raha.')}</td></tr>`}
        </tbody>${rows.length ? `<tfoot><tr class="row-total"><td colspan="9">Total · ${U.fmt(rows.length)} agents</td><td class="num">${U.fmt(sum(rows, (r) => r.boxes))}</td><td class="num">${U.fmt(sum(rows, (r) => r.dispatchTags))}</td><td></td></tr></tfoot>` : ''}</table></div>
      </div>
      <div class="card dispatch-slip-card"><div class="card-head"><h3>🖨️ Printable pick-list · TL-wise</h3><span class="dim small">Print karke warehouse ko do</span><button class="btn small" id="dp-print">🖨️ Print</button></div>
        <div id="dispatch-slip" class="dispatch-slip">
          ${[...tlGroups.entries()].map(([tl, list]) => { const b = sum(list, (r) => r.boxes); return `<div class="slip-block"><div class="slip-head"><b>${esc(tl)}</b><span>${U.fmt(list.length)} agents · <b>${U.fmt(b)} boxes</b> · ${U.fmt(sum(list, (r) => r.dispatchTags))} tags</span></div><table class="slip-table"><thead><tr><th>Agent</th><th>Boxes</th><th>Tags</th><th>Class split</th><th>Why</th></tr></thead><tbody>${list.map((r) => `<tr><td>${esc(r.name)}<small>${esc(r.id || '')}</small></td><td class="num"><b>${r.boxes}</b></td><td class="num">${r.dispatchTags}</td><td>${esc(r.classes.map((c) => `${c.cls}:${c.tags}`).join(' ') || '—')}</td><td>${esc(r.why)}</td></tr>`).join('')}</tbody></table></div>`; }).join('') || `<p class="dim">Koi dispatch row nahi.</p>`}
        </div>
      </div>`;
    const controls = U.$('#dp-controls', root);
    if (controls) controls.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(controls);
      FF.app.updateParams({ horizon: fd.get('horizon') || '', growth: fd.get('growth') || '', safety: fd.get('safety') || '', box: fd.get('box') || '', q: fd.get('q') || '' });
    });
    // KPI cards clickable → full data dialog (v3.8.3)
    if (UI.bindMetricDetails) UI.bindMetricDetails(root, `Dispatch plan · ${horizon} din`, D_HEADERS, rows.map(toArray), {
      'Agents to dispatch': { title: `${U.fmt(t.agents)} agents ko stock chahiye`, headers: D_HEADERS, rows: rows.map(toArray) },
      'Total boxes': { title: `${U.fmt(t.boxes)} boxes planned`, headers: D_HEADERS, rows: rows.map(toArray), stats: [`${U.fmt(t.tags)} tags · 1 box = ${U.fmt(perBox)}`] },
      'Critical (stock-out)': { title: `${U.fmt(t.critical)} critical agents`, headers: D_HEADERS, rows: rows.filter((r) => r.risk === 'Critical').map(toArray), stats: [`${U.fmt(t.high)} high-risk agents bhi list me`] },
      'Buffer tags': { title: 'Box rounding buffer', headers: D_HEADERS, rows: rows.filter((r) => r.extra > 0).map(toArray), stats: ['Boxes upar round hone se extra tags bante hain'] },
      'Top need': { title: 'Sabse zyada need wale agents', headers: D_HEADERS, rows: [...rows].sort((a, b) => b.need - a.need).slice(0, 50).map(toArray) },
      'TL groups': { title: `${U.fmt(tlGroups.size)} TL groups`, headers: ['TL', 'Agents', 'Boxes', 'Dispatch tags', 'Critical'], rows: [...tlGroups.entries()].map(([tl, list]) => [tl, list.length, sum(list, (r) => r.boxes), sum(list, (r) => r.dispatchTags), list.filter((r) => r.risk === 'Critical').length]) }
    });
    const csv = () => U.downloadCsv(`dispatch-plan-${horizon}d-${U.stamp()}.csv`, D_HEADERS, rows.map(toArray));
    ['#dp-csv', '#dp-csv-2'].forEach((sel) => { const b = U.$(sel, root); if (b) b.addEventListener('click', csv); });
    const xlsx = U.$('#dp-xlsx', root);
    if (xlsx) xlsx.addEventListener('click', () => FF.xlsx.download(`dispatch-plan-${horizon}d-${U.stamp()}.xlsx`, [
      { name: `Plan ${horizon}d`, header: D_HEADERS, rows: rows.map(toArray) },
      { name: 'TL summary', header: ['TL', 'Agents', 'Boxes', 'Tags', 'Critical', 'High'], rows: [...tlGroups.entries()].map(([tl, list]) => [tl, list.length, sum(list, (r) => r.boxes), sum(list, (r) => r.dispatchTags), list.filter((r) => r.risk === 'Critical').length, list.filter((r) => r.risk === 'High').length]) },
      { name: 'Critical only', header: D_HEADERS, rows: rows.filter((r) => r.risk === 'Critical').map(toArray) }
    ]));
    const copyBtn = U.$('#dp-copy', root);
    if (copyBtn) copyBtn.addEventListener('click', async () => { const ok = await U.copyText(planText()); U.toast(ok ? 'Plan copy ho gaya' : 'Copy nahi hui', ok ? 'ok' : 'warn'); });
    const wa = U.$('#dp-wa', root);
    if (wa) wa.addEventListener('click', () => FF.app.shareWhatsApp(planText()));
    const printBtn = U.$('#dp-print', root);
    if (printBtn) printBtn.addEventListener('click', () => window.print());
    const logBtn = U.$('#dp-log', root);
    if (logBtn) logBtn.addEventListener('click', () => U.withButtonBusy(logBtn, async () => {
      const note = [`Dispatch plan · ${horizon} din`, `${rows.length} agents · ${sum(rows, (r) => r.boxes)} boxes · ${sum(rows, (r) => r.dispatchTags)} tags`, ...rows.slice(0, 10).map((r) => `${r.name}: ${r.boxes} box (${r.dispatchTags} tags) — ${r.why}`)].join('\n');
      await FF.auth.api('/api/workspace/notes', 'POST', { entityType: 'general', entityKey: `dispatch-${U.dateKey(new Date())}`, entityName: `Dispatch plan ${U.dateKey(new Date())}`, channel: 'both', text: note, priority: 'high', status: 'open' });
      U.toast('Plan follow-up note me log ho gaya ✓', 'ok');
    }, 'Log ho raha hai…'));
    return data;
  }

  // ==================================================================================================
  // 5. TL SCORECARD
  // ==================================================================================================
  async function tlScorecard(opts = {}) {
    await FF.pages.performance.ensureLoaded().catch(() => {});
    const ffAgents = (FF.pages.performance.agents ? FF.pages.performance.agents() : []) || [];
    const [gv, fc, agentClass, quality] = await Promise.all([
      gvAgentCommission(),
      forecastIndex(),
      safe(() => S.need('agentClass'), []),
      safe(() => FF.insights.qualityIssues(), null)
    ]);
    const targets = ((FF.auth.settings && FF.auth.settings.targets) || []).filter((t) => t && t.ym && Number(t.target) > 0);
    const ym = (FF.pages.performance.months ? FF.pages.performance.months().cur : U.ymKey(new Date())) || U.ymKey(new Date());
    const curMonth = typeof ym === 'string' ? ym : U.ymKey(new Date());
    const targetFor = (source, agentName) => {
      const key = normName(agentName);
      return sum(targets.filter((t) => t.ym === curMonth && (t.source || 'ff') === source && normName(t.agent) === key), (t) => Number(t.target));
    };
    const groups = new Map();
    const ensure = (name, channel) => {
      const key = `${channel}|${normName(name || 'Direct')}`;
      if (!groups.has(key)) groups.set(key, { key, tl: name || 'Direct', channel, agents: [], issuance: 0, prev: 0, stock: 0, target: 0, commission: 0, earnedRows: 0, rateRows: 0, risk: { Critical: 0, High: 0, Medium: 0, Covered: 0, 'No run-rate': 0 }, dq: 0 });
      return groups.get(key);
    };
    ffAgents.forEach((a) => {
      const g = ensure(a.tlName, 'First Forward');
      const risk = fc.find(a.agentId || a.id, a.name);
      g.agents.push({ name: a.name, id: a.agentId || a.id, cur: a.curTotal, prev: a.lastTotal, stock: a.stockTotal, rate: a.earnedRate !== undefined ? a.earnedRate : null, risk: risk ? risk.risk : '', cover: risk && Number.isFinite(risk.stockDays) ? risk.stockDays : null, need7: risk ? risk.need7 : 0 });
      g.issuance += Number(a.curTotal || 0); g.prev += Number(a.lastTotal || 0); g.stock += Number(a.stockTotal || 0);
      g.target += targetFor('ff', a.name);
      if (risk && g.risk[risk.risk] !== undefined) g.risk[risk.risk]++;
    });
    gv.agents.forEach((a) => {
      const g = ensure(a.tlName, 'GV Partner');
      const risk = fc.find(a.agentId, a.agentName);
      g.agents.push({ name: a.agentName, id: a.agentId, cur: a.tags, prev: 0, stock: 0, rate: a.perTag, risk: risk ? risk.risk : '', cover: risk && Number.isFinite(risk.stockDays) ? risk.stockDays : null, need7: risk ? risk.need7 : 0 });
      g.issuance += a.tags; g.commission += a.commission; g.earnedRows++; g.rateRows += a.perTag > 0 ? 1 : 0;
      if (risk && g.risk[risk.risk] !== undefined) g.risk[risk.risk]++;
    });
    // FF commission per TL
    const ffComm = await safe(() => commissionIndex(), null);
    if (ffComm) ffAgents.forEach((a) => {
      const g = ensure(a.tlName, 'First Forward');
      const c = ffComm.find(a.agentId || a.id, a.name);
      if (c) { if (valid(c.earned)) g.commission += Number(c.earned); if (valid(c.earned) || valid(c.computed)) g.earnedRows++; if (valid(c.rateValue) && Number(c.rateValue) > 0) g.rateRows++; }
    });
    // DQ findings per TL (match by agent name inside finding samples)
    if (quality && Array.isArray(quality.findings)) {
      groups.forEach((g) => {
        const names = g.agents.map((a) => normName(a.name)).filter((n) => n.length >= 4);
        g.dq = quality.findings.filter((f) => {
          const text = normName(`${f.title || ''} ${(f.samples || []).slice(0, 80).join(' ')}`);
          return names.some((n) => text.includes(n));
        }).reduce((acc, f) => acc + (f.count || 0), 0);
      });
    }
    const rows = [...groups.values()].map((g) => {
      const agents = g.agents.length;
      const active = g.agents.filter((a) => Number(a.cur || 0) > 0).length;
      const achievement = g.target ? pctOf(g.issuance, g.target) : null;
      const dailyRate = g.issuance / Math.max(1, new Date().getDate());
      const cover = dailyRate > 0 ? g.stock / dailyRate : null;
      const commissionCompleteness = agents ? (g.earnedRows / agents) * 100 : 0;
      const criticalHigh = g.risk.Critical + g.risk.High;
      const comp = {
        target: achievement === null ? null : clamp(achievement, 0, 120),
        active: agents ? (active / agents) * 100 : 0,
        cover: cover === null ? null : clamp((cover / 15) * 100, 0, 100),
        commission: commissionCompleteness,
        quality: clamp(100 - (g.dq * 2) - (criticalHigh * 4), 0, 100)
      };
      const weights = { target: 30, active: 20, cover: 15, commission: 20, quality: 15 };
      let wsum = 0, score = 0;
      Object.entries(comp).forEach(([k, v]) => { if (v === null) return; score += v * weights[k]; wsum += weights[k]; });
      score = wsum ? score / wsum : 0;
      const grade = score >= 85 ? 'A+' : score >= 75 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';
      const focus = [];
      if (achievement !== null && achievement < 60) focus.push(`Target ${achievement.toFixed(0)}% — peeche hai`);
      if (agents && active / agents < 0.6) focus.push(`${agents - active} inactive agents`);
      if (cover !== null && cover < 7) focus.push(`Cover ${cover.toFixed(1)} din (kam)`);
      if (criticalHigh) focus.push(`${criticalHigh} agents stock-out + high risk`);
      if (commissionCompleteness < 70) focus.push(`${agents - g.earnedRows} agents ka commission figure missing`);
      if (g.dq) focus.push(`${g.dq} data-quality record(s)`);
      return { ...g, agents, active, inactive: agents - active, achievement, cover, comp, score, grade, focus, commissionPerTag: g.issuance ? g.commission / g.issuance : 0, growth: pctOf(g.issuance - g.prev, g.prev) };
    }).filter((r) => r.agents > 0).sort((a, b) => b.score - a.score);
    return { rows, month: curMonth, targetsFound: targets.length };
  }


  // ---- wiring -------------------------------------------------------------------------------------
  function wireAgentLinks() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-agent360]') : null;
      if (!el) return;
      e.preventDefault();
      agent360({ name: el.dataset.agent360, id: el.dataset.agent360Id || '' }).catch((err) => U.toast(err.message || 'Agent 360 load nahi hua', 'err'));
    });
  }

  // 🧹 v3.62 — TL Scorecard + FF Tools page retire ho gayi, isliye unke renderers export nahi hote.
  FF.cockpit = { commissionIndex, gvAgentCommission, forecastIndex, payoutRecon, commissionAlerts, agent360, dispatchPlan, tlScorecard, wireAgentLinks, PAYOUT_HEADERS, GV_PAYOUT_HEADERS };
  FF.pages.dispatchPlan = { title: 'Dispatch Planner', render: renderDispatchPlan };
  wireAgentLinks();
})(window.FF);
