/* 🔁 FF issuance lag (GV live) + page-local date filters.
   First Forward (EIR) issuance is T+1; GV Partner rows (master ID 5845036) stay live.
   Date/channel/TL/agent/class constraints are read only from the current page URL, never from
   persisted cross-page workspace state. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const DEFAULTS = { period: 'month', channel: '', tl: '', agent: '', cls: '', month: '' };
  const PERIODS = ['today', 'yesterday', 'week', 'month', 'lastMonth', 'all'];

  // ---- 🔁 data lag ------------------------------------------------------------------------------
  /** FF (EIR) issuance kitne din late aata hai. 1 = aaj ka data kal (default). */
  function ffLagDays() {
    const raw = FF.config && FF.config.ffIssuanceLagDays;
    if (raw === undefined || raw === null || raw === '') return 1;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 1;
  }
  const ffLagOn = () => ffLagDays() > 0;
  const dayKey = (d) => U.dateKey(d || new Date());
  function shiftKey(key, days) {
    const d = U.fromDateKey(key) || new Date();
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
    return U.dateKey(x);
  }
  /** FF report ka latest possible date (aaj - lag). Iske aage ki FF rows source me nahi hoti. */
  const ffReportedThrough = () => shiftKey(dayKey(), -ffLagDays());
  const rowKey = (r) => (r && (r.key || (r.date && U.dateKey(r.date)))) || '';
  /** FF row count me aayegi ya nahi — today ki FF rows lag se bahar. */
  function ffVisible(row) {
    if (!ffLagOn()) return true;
    if (!row) return true;
    if (row.channel === 'GV Partner') return true;          // GV hamesha live
    const k = rowKey(row);
    if (!k) return true;
    return k <= ffReportedThrough();
  }
  function dropLaggedFf(rows) { return !ffLagOn() ? (rows || []) : (rows || []).filter(ffVisible); }
  /** Kya ye date FF ke liye abhi reported nahi hai? */
  const isFfPending = (key) => ffLagOn() && !!key && String(key) > ffReportedThrough();

  // ---- page-local filter resolution ---------------------------------------------------------------
  function periodDates(period) {
    const now = new Date();
    const key = (d) => U.dateKey(d);
    if (period === 'today') return { from: key(now), to: key(now) };
    if (period === 'yesterday') { const d = new Date(now); d.setDate(d.getDate() - 1); return { from: key(d), to: key(d) }; }
    if (period === 'week') { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: key(d), to: key(now) }; }
    if (period === 'lastMonth') { const d = new Date(now.getFullYear(), now.getMonth(), 0); return { month: `${d.getFullYear()}-${U.pad2(d.getMonth() + 1)}` }; }
    if (period === 'all') return {};
    return { month: `${now.getFullYear()}-${U.pad2(now.getMonth() + 1)}` };
  }
  /** Only explicit page/link URL params are accepted; old localStorage filter state is ignored. */
  function current() {
    const params = (FF.app && FF.app.current && FF.app.current.params) || {};
    const period = PERIODS.includes(String(params.period)) ? String(params.period) : DEFAULTS.period;
    const month = params.month || periodDates(period).month || '';
    const pick = (k) => (params[k] !== undefined ? params[k] : '');
    const f = {
      period, month,
      channel: pick('channel') || pick('ch') || '',
      tl: pick('tl') || '',
      agent: pick('agent') || '',
      cls: pick('cls') || '',
      from: params.from || '',
      to: params.to || '',
      date: params.date || ''
    };
    const b = bounds(f);
    f.from = b.from; f.to = b.to;
    f.label = label(f);
    f.active = activeList(f);
    f.isDefault = !f.active.length;
    return f;
  }
  function bounds(f) {
    if (f.from || f.to) return { from: f.from || '', to: f.to || '' };
    if (f.date) return { from: f.date, to: f.date };
    const t = dayKey();
    if (f.period === 'today') return { from: t, to: t };
    if (f.period === 'yesterday') { const y = shiftKey(t, -1); return { from: y, to: y }; }
    if (f.period === 'week') return { from: shiftKey(t, -6), to: t };
    if (f.period === 'all') return { from: '', to: '' };
    const ym = f.month || U.ymKey(new Date());
    const last = U.daysInMonth(ym);
    return { from: `${ym}-01`, to: `${ym}-${U.pad2(last)}` };
  }
  function label(f) {
    const bits = [];
    if (f.from && f.to) bits.push(f.from === f.to ? U.labelDateKey(f.from, true) : `${U.labelDateKey(f.from)} → ${U.labelDateKey(f.to)}`);
    else bits.push('All available');
    if (f.channel === 'ff') bits.push('First Forward');
    else if (f.channel === 'gv') bits.push('GV Partner');
    else bits.push('FF + GV');
    if (f.cls) bits.push(f.cls);
    if (f.tl) bits.push(`TL ${f.tl}`);
    if (f.agent) bits.push(`Agent ${f.agent}`);
    return bits.join(' · ');
  }
  function activeList(f) {
    const out = [];
    if (f.period && f.period !== 'month') out.push({ key: 'period', label: f.period === 'week' ? 'Last 7 days' : f.period === 'lastMonth' ? 'Last month' : f.period[0].toUpperCase() + f.period.slice(1), value: f.period });
    if (f.month && (f.period === 'month' || f.period === '')) out.push({ key: 'month', label: U.labelYM(f.month, true), value: f.month });
    if (f.channel) out.push({ key: 'channel', label: f.channel === 'gv' ? 'GV Partner' : 'First Forward', value: f.channel });
    if (f.cls) out.push({ key: 'cls', label: f.cls, value: f.cls });
    if (f.tl) out.push({ key: 'tl', label: `TL: ${f.tl}`, value: f.tl });
    if (f.agent) out.push({ key: 'agent', label: `Agent: ${f.agent}`, value: f.agent });
    return out;
  }
  const norm = (v) => U.clean(v).toUpperCase().replace(/\s+/g, ' ');
  const nameHit = (value, needle) => { const a = norm(value), b = norm(needle); return !!b && a.includes(b); };

  // ---- 🔎 row filters --------------------------------------------------------------------------
  const isGv = (r) => (r && r.channel === 'GV Partner') || (r && !r.channel && /gv/i.test(String(r.gvName || '')));
  function inRange(key, b) { if (!key) return !b.from && !b.to; if (b.from && key < b.from) return false; if (b.to && key > b.to) return false; return true; }
  function classHit(r, cls) {
    if (!cls) return true;
    const wanted = String(cls).toUpperCase();
    return norm(r.group) === wanted || norm(r.cls) === wanted || norm(r.cls) === `VC${wanted.replace(/^VC/, '')}`;
  }
  function rowHit(r, f, src) {
    const gv = isGv(r);
    if (src === 'ff' && gv) return false;
    if (src === 'gv' && !gv) return false;
    if (!inRange(rowKey(r), f)) return false;
    if (!gv && !ffVisible(r)) return false;
    if (!classHit(r, f.cls)) return false;
    if (f.tl && !nameHit(r.tlName || r.tl || '', f.tl)) return false;
    if (f.agent && !(nameHit(r.agentName || r.name || '', f.agent) || nameHit(r.agentId || r.id || '', f.agent))) return false;
    return true;
  }
  /** Issuance rows filtered only by explicit page/link filters. opts.src = 'ff' | 'gv' | 'both'. */
  function issuance(rows, opts) {
    const o = opts || {};
    const f = o.filters || current();
    const src = o.src || (f.channel === 'ff' ? 'ff' : f.channel === 'gv' ? 'gv' : 'both');
    return (rows || []).filter((r) => rowHit(r, f, src));
  }
  /** Stock rows — date range lagta nahi, explicit channel/class/TL/agent filters lagte hain. */
  function stock(rows, opts) {
    const o = opts || {};
    const f = o.filters || current();
    const src = o.src || (f.channel === 'gv' ? 'gv' : 'ff');
    if (src === 'ff' && f.channel === 'gv') return [];
    if (src === 'gv' && f.channel === 'ff') return [];
    return (rows || []).filter((r) => {
      if (f.cls && !classHit({ group: r.group, cls: r.cls }, f.cls)) return false;
      if (f.tl && !nameHit(r.tlName || r.tl || '', f.tl)) return false;
      if (f.agent && !(nameHit(r.agentName || r.name || '', f.agent) || nameHit(r.agentId || r.id || '', f.agent))) return false;
      return true;
    });
  }
  function sum(rows, fn) { return U.sum(rows || [], fn || ((r) => Number(r.n) || 0)); }

  // ---- 🏷️ UI bits ------------------------------------------------------------------------------
  /** Jab selected period me aaj ki tareekh shaamil ho → lag note dikhao. */
  function lagNote(f) {
    if (!ffLagOn()) return '';
    const fc = f || current();
    const today = dayKey();
    const touchesToday = (!fc.to || fc.to >= today) && (!fc.from || fc.from <= today);
    if (!touchesToday) return '';
    return `<span class="lf-lag" title="First Forward ka data T+1 aata hai — aaj ka FF data kal milta hai. GV Partner live chalta hai.">🔁 FF data T+1 · <b>aaj GV live</b>, <b>FF kal</b> (aaj FF = 0)</span>`;
  }
  function chips(f) {
    const fc = f || current();
    if (!fc.active.length) return '<span class="lf-chip dim">No filters — poora data</span>';
    return fc.active.map((a) => `<span class="lf-chip">${U.esc(a.label)}</span>`).join('');
  }

  FF.filters = {
    DEFAULTS, PERIODS, ffLagDays, ffLagOn, ffReportedThrough, ffVisible, dropLaggedFf, isFfPending,
    current, bounds, activeList, issuance, stock, sum, lagNote, chips,
    rowHit, isGv, rowKey, nameHit
  };
})(window.FF);
