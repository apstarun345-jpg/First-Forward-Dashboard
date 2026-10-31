/* 🔎 MASTER SEARCH (v3.11) — poori site ke liye universal search bar.
     • Topbar me ek visible search bar (har page par) — type karte hi dropdown suggestions,
       aur suggestion box input ke NEECHE khulta hai (kabhi typed text ke upar overlap nahi karta;
       layout U.suggest ka hai jo body-portal + viewport placement karta hai).
     • Home panel me bada master search bar — search karne par "poori kundli" khulti hai:
       colourful profile cards + data tables (FF + GV issuance, stock, barcode/tag register).
     • Kya-kya search hota hai: agent name, TL name, agent ID, TL ID, GV unique ID / GV name,
       barcode, tag ID / serial, GV TL — dono channels (First Forward + GV Partner) ek saath.

   Do-layer index (fast rahega):
     Layer 1 (light, instant)  → EIR/stock/GV aggregated rows = people + ids.
     Layer 2 (heavy, background) → FF StockDataa + GV Tag Assignment ke barcode-level rows
                                   (FF.insights.loadDetails() — wahi cache jo Master Stock page use karta hai).
   Heavy layer aate hi suggestions apne aap upgrade ho jaate hain. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean;
  // Sheet IDs can arrive as numeric cells with a trailing ".0"; strip that before punctuation
  // removal so the sheet's UNIQUE_ID / TL ID still matches the value typed by the user.
  const normId = (v) => clean(v).replace(/\.0+$/, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normName = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  function expandNumericId(value) {
    const raw = clean(value).replace(/[,\s-]/g, '');
    const m = raw.match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
    if (!m) return raw;
    const sign = m[1] || '', whole = m[2], fraction = m[3] || '', digits = whole + fraction;
    const decimalAt = whole.length + Number(m[4]);
    if (decimalAt <= 0) return sign + '0.' + '0'.repeat(Math.min(1000, -decimalAt)) + digits;
    if (decimalAt >= digits.length) return sign + digits + '0'.repeat(Math.min(1000, decimalAt - digits.length));
    return sign + digits.slice(0, decimalAt) + '.' + digits.slice(decimalAt);
  }
  const normBar = (v) => normId(expandNumericId(v));
  const KIND_LABEL = { 'ff-agent': 'FF Agent', 'gv-agent': 'GV Agent', 'ff-tl': 'FF TL', 'gv-tl': 'GV TL', 'gv-id': 'GV ID', 'agent-id': 'Agent ID' };
  const KIND_ICON = { 'ff-agent': '🧑‍💼', 'gv-agent': '🧑‍💼', 'ff-tl': '👥', 'gv-tl': '👥', 'gv-id': '🆔', 'agent-id': '🆔' };

  const state = { generation: 0, light: null, lightPromise: null, full: null, fullPromise: null, fullError: null, lastQuery: '', results: null, listeners: new Set() };
  const emit = () => state.listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  const onIndexReady = (fn) => { state.listeners.add(fn); return () => state.listeners.delete(fn); };

  // ---------------------------------------------------------------- index builders
  function newIndex() {
    return {
      people: new Map(),   // `${kind}|${normName(name)}` → { kind, name, sub, tlSet, classMap, bars, last, n }
      personGrams: new Map(), // normalized 2-character search gram → people (substring lookup)
      bars: new Map(),     // normBar(barcode) → { key, ff: [], gv: [] }
      barKeys: [],         // barcode keys, insertion order — search seedha isi par chalti hai (neeche search() dekho)
      tlInfo: new Map(),   // `${kind}|${tlName}` → { direct, label, real } (person() ka memo — config calls lakhon baar nahi)
      ids: new Map(),      // normId(id) → { name, kind, tl }
      idBuckets: new Map(), // first 4 normalized ID characters → entries
      mobiles: new Map(), // 10-digit mobile → { name, kind, tl } (agent + TL mobile search)
      mobileGrams: new Map() // 5-digit mobile gram → matching contact entries
    };
  }
  /** TL naam → site-wide label (direct placeholder ko "Direct Agent (APS)/(no TL)" banao). */
  function tlText(name, channel) {
    const n = clean(name);
    if (!n) return '';
    const ch = channel || '';
    if (!FF.config.isRealTl(n)) return FF.config.directLabel({ tlName: n }, ch || 'ff');
    return n;
  }
  /** TL naam ke hisaab se (direct? label? asli TL?) — ek idx me har distinct (kind, TL) ek hi baar nikalta hai. */
  function tlInfoOf(idx, kind, tl) {
    const k = `${kind}|${tl}`;
    let info = idx.tlInfo.get(k);
    if (info) return info;
    const isAgent = kind === 'ff-agent' || kind === 'gv-agent';
    const ch = kind === 'gv-agent' ? 'gv' : 'ff';
    const direct = isAgent && FF.config.isDirectAgent({ tlName: tl, channel: ch === 'gv' ? 'GV Partner' : 'First Forward' }, ch);
    info = { direct: !!direct, label: direct ? FF.config.directLabel({ tlName: tl }, ch) : '', real: !!tl && FF.config.isRealTl(tl) };
    idx.tlInfo.set(k, info);
    return info;
  }
  function person(idx, kind, name, tlName, cls, sub) {
    const nm = clean(name);
    if (!nm) return null;
    // 🧍 Placeholder TL names ("APS", "Direct", "Unassigned") kabhi TL card nahi banate.
    if (kind === 'ff-tl' || kind === 'gv-tl') { if (!FF.config.isRealTl(nm)) return null; }
    const identity = clean(sub).replace(/\.0+$/, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const k = `${kind}|${identity || normName(nm)}`;
    let p = idx.people.get(k);
    if (!p) { p = { kind, name: nm, sub: sub || '', tlSet: new Set(), tlIds: new Set(), ids: new Set(), alias: new Set(), classMap: new Map(), bars: new Set(), last: '', n: 0, direct: false }; idx.people.set(k, p); }
    if (sub && !p.sub) p.sub = clean(sub);
    const tl = clean(tlName);
    if (kind === 'ff-agent' || kind === 'gv-agent') {
      const info = tlInfoOf(idx, kind, tl);
      if (info.direct) { p.direct = true; p.directLabel = info.label; }
    }
    if (tl && !(p.direct && !tlInfoOf(idx, 'tl', tl).real)) p.tlSet.add(tl);
    const c = clean(cls);
    if (c) p.classMap.set(c, (p.classMap.get(c) || 0) + 1);
    return p;
  }
  function pushBucket(map, key, value) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  /** Build small, reusable lookup indexes once per data layer, not once per keystroke. */
  function indexLookups(idx) {
    const peopleGrams = new Map();
    idx.people.forEach((p) => {
      const tl = [...p.tlSet].map(normName).join(' ');
      const aliases = p.alias ? [...p.alias].map(normName).join(' ') : '';
      const hay = `${normName(p.name)} ${normName(p.sub)} ${tl} ${aliases}`.trim();
      p._searchHay = hay;
      const grams = new Set();
      for (let i = 0; i < hay.length - 1; i++) grams.add(hay.slice(i, i + 2));
      grams.forEach((gram) => pushBucket(peopleGrams, gram, p));
    });
    idx.personGrams = peopleGrams;

    const idBuckets = new Map();
    idx.ids.forEach((value, id) => { if (id.length >= 4) pushBucket(idBuckets, id.slice(0, 4), { id, value }); });
    idx.idBuckets = idBuckets;

    const mobileGrams = new Map();
    idx.mobiles.forEach((value) => {
      const mobile = String(value.mobile || '').replace(/\D/g, '');
      const grams = new Set();
      for (let i = 0; i <= mobile.length - 5; i++) grams.add(mobile.slice(i, i + 5));
      grams.forEach((gram) => pushBucket(mobileGrams, gram, value));
    });
    idx.mobileGrams = mobileGrams;
  }
  // Pehle har barcode ke liye 6-char gram + 4-char prefix index banta tha (2.3 lakh barcodes par ~1.2 s CPU + ~127 MB heap, phone par
  // freeze/crash) jabki seedha key-list scan sirf 2-18 ms leta hai — isliye ab sirf barKeys (insertion order) rakhte hain.
  const barEntry = (idx, key) => {
    let e = idx.bars.get(key);
    if (e) return e;
    e = { key, ff: [], gv: [] };
    idx.bars.set(key, e);
    idx.barKeys.push(key);
    return e;
  };

  /** Layer 1 — aggregated rows (instant, never blocks on barcode scans). */
  const LIMITS = { lightSoftMs: 1500 };   // itni der baad jo datasets aa chuke unse index banao; baaki aate hi index me judte hain (tests chhota karte hain)
  /** Sabhi promises ka intezaar — par `ms` se zyada nahi. Return: { name: { status, value|reason } } (pending wale missing). */
  function settleSoon(sources, ms) {
    const out = {};
    const tracked = Object.keys(sources).map((name) => Promise.resolve(sources[name]).then(
      (value) => { out[name] = { status: 'fulfilled', value }; },
      (reason) => { out[name] = { status: 'rejected', reason }; }
    ));
    let timer;
    const deadline = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
    return Promise.race([Promise.all(tracked), deadline]).then(() => { clearTimeout(timer); return { ...out }; });
  }
  async function buildLight() {
    if (state.light) return state.light;
    if (state.lightPromise) return state.lightPromise;
    const generation = state.generation;
    state.lightPromise = (async () => {
      const idx = newIndex();
      let tick = 0;
      const sources = {
        // ⚡ Search cold-start: identity comes from GV Master directly. Do not block on large FF daily/EIR history.
        agents: FF.store.need('agents'), stockAgents: FF.store.need('stockAgents'), gvMaster: FF.gv.need('master'),
        gvReport: FF.gv.need('report'), gvStockAgent: FF.gv.need('stockAgent'), gvStockTl: FF.gv.need('stockTl'),
        // 🔎 FF REPORT: old/alt agent ID (ID column) · TL ID · TL mobile — search me bhi aayenge
        ffReport: (async () => {
          // Master Search/top-bar can open before the lazy Performance module exists.
          // Load it on demand so FF REPORT's canonical TL roster is indexed in both search bars.
          try {
            let P = FF.pages && FF.pages.performance;
            if (!P && FF.lazy && FF.lazy.need) await FF.lazy.need('performance');
            P = FF.pages && FF.pages.performance;
            if (P && P.ensureLoaded) await P.ensureLoaded();
            return P && P.agents ? (P.agents() || []) : [];
          } catch (err) {
            console.warn('Master Search FF REPORT index unavailable:', err && err.message);
            return [];
          }
        })()
      };
      const canMob = (() => { try { return !FF.auth || FF.auth.can('contacts'); } catch { return true; } })();
      const addAlias = (p, ...vals) => { if (!p) return; p.alias = p.alias || new Set(); vals.forEach((v) => { const t = clean(v); if (t && !/^na$/i.test(t)) p.alias.add(t); }); };
      const addMobile = (m, name, kind, tl) => { if (!canMob) return; const d = String(m || '').replace(/\D/g, '').slice(-10); if (d.length === 10) idx.mobiles.set(`${d}|${kind}|${normName(name)}`, { mobile: d, name: clean(name), kind, tl: clean(tl) }); };
      const rememberId = (p, id) => {
        const value = clean(id);
        if (!p || !value || /^na$/i.test(value)) return '';
        p.ids = p.ids || new Set(); p.ids.add(value);
        p.alias = p.alias || new Set(); p.alias.add(value);
        return value;
      };
      const rememberTlId = (p, id) => {
        const value = clean(id);
        if (!p || !value || /^na$/i.test(value)) return '';
        p.tlIds = p.tlIds || new Set(); p.tlIds.add(value);
        return value;
      };
      const indexId = (id, value) => {
        const raw = clean(id), key = normId(raw);
        if (!key || /^na$/i.test(raw)) return;
        const old = idx.ids.get(key);
        if (old && old.kind === value.kind && normName(old.name) === normName(value.name) && old.tl === value.tl) return;
        idx.ids.set(key, { ...value, id: raw });
      };
      const ingest = {};
      ingest.ffReport = async (rows) => {
        for (const a of rows || []) {
          if (++tick % 400 === 0) await U.breathe();
          const ap = person(idx, 'ff-agent', a.name || a.agentId, a.tlName, '', a.agentId || a.id);
          addAlias(ap, a.agentId, a.id, a.gvIdFound);
          [a.agentId, a.id].forEach((v) => { rememberId(ap, v); indexId(v, { name: clean(a.name || v), kind: 'ff-agent', tl: clean(a.tlName) }); });
          rememberTlId(ap, a.tlId);
          addMobile(a.mobile || (/^\d{10}$/.test(clean(a.agentId)) ? a.agentId : ''), a.name, 'ff-agent', a.tlName);
          if (clean(a.tlName) && FF.config.isRealTl(clean(a.tlName))) {
            const tp = person(idx, 'ff-tl', a.tlName, '', '', a.tlId);
            addAlias(tp, a.tlId, canMob ? a.tlMobile : '');
            rememberId(tp, a.tlId);
            indexId(a.tlId, { name: clean(a.tlName), kind: 'ff-tl' });
            addMobile(a.tlMobile, a.tlName, 'ff-tl', '');
          }
        }
      };
      // FF agents (EIR) — id + name + TL + ids
      ingest.agents = async (rows) => {
        for (const a of rows || []) {
          if (++tick % 400 === 0) await U.breathe();
          const p = person(idx, 'ff-agent', a.name || a.id, a.tlName, '', a.id);
          if (p) { p.bars = p.bars; p.issuanceN = (p.issuanceN || 0) + (Number(a.n) || 0); p.n += Number(a.n) || 0; rememberId(p, a.id); rememberTlId(p, a.tlId); }
          if (clean(a.id)) indexId(a.id, { name: clean(a.name || a.id), kind: 'ff-agent', tl: clean(a.tlName) });
          if (clean(a.tlName)) {
            const t = person(idx, 'ff-tl', a.tlName, '', '', a.tlId || '');
            if (t) { t.n += Number(a.n) || 0; rememberId(t, a.tlId); if (clean(a.tlId)) indexId(a.tlId, { name: clean(a.tlName), kind: 'ff-tl' }); }
          }
        }
      };
      // FF stock (agent × class) — IDs + TL from StockDataa
      ingest.stockAgents = async (rows) => {
        for (const r of rows || []) {
          if (++tick % 400 === 0) await U.breathe();
          const p = person(idx, 'ff-agent', r.agentName || r.agentId, r.tlName, r.cls, r.agentId);
          if (p) { p.n += Number(r.n) || 0; rememberId(p, r.agentId); rememberTlId(p, r.tlId); }
          if (clean(r.agentId)) indexId(r.agentId, { name: clean(r.agentName || r.agentId), kind: 'ff-agent', tl: clean(r.tlName) });
          if (clean(r.tlName)) {
            const t = person(idx, 'ff-tl', r.tlName, '', r.cls, r.tlId || '');
            rememberId(t, r.tlId);
            if (clean(r.tlId)) indexId(r.tlId, { name: clean(r.tlName), kind: 'ff-tl' });
          }
        }
      };
      // GV Master — agent id / name / TL id / TL name / GV unique id + name
      ingest.gvMaster = async (rows) => {
        for (const r of rows || []) {
          if (++tick % 400 === 0) await U.breathe();
          const p = person(idx, 'gv-agent', r.agentName || r.agentId, r.tlName, '', r.agentId);
          // GV Master: AGENT_ID is its UNIQUE_ID column. Retain all TL identifiers too:
          // column C (supervisor/TL ID) is the lookup alias, while column R (GV TL ID) is
          // the canonical team-attribution key used by GV issuance and stock profiles.
          if (p) { p.issuanceN = (p.issuanceN || 0) + 1; const cls = clean(r.cls); if (cls) p.classMap.set(cls, (p.classMap.get(cls) || 0) + 1); }
          rememberId(p, r.agentId);
          rememberTlId(p, r.tlId);
          rememberTlId(p, r.gvTlId);
          rememberTlId(p, r.supervisorId);
          if (clean(r.agentId)) indexId(r.agentId, { name: clean(r.agentName || r.agentId), kind: 'gv-agent', tl: clean(r.tlName) });
          const tlIds = [r.tlId, r.gvTlId, r.supervisorId].filter((id) => clean(id));
          const tl = clean(r.tlName) ? person(idx, 'gv-tl', r.tlName, '', r.cls, r.tlId || r.gvTlId || r.supervisorId) : null;
          tlIds.forEach((id) => {
            rememberId(tl, id);
            indexId(id, { name: clean(r.tlName || id), kind: 'gv-tl' });
          });
          if (clean(r.gvUniqueId) || clean(r.gvUniqueName)) {
            const g = person(idx, 'gv-id', r.gvUniqueName || r.gvUniqueId, r.tlName, r.cls, r.gvUniqueId);
            if (g) g.n += 1;
            if (clean(r.gvUniqueId)) idx.ids.set(normId(r.gvUniqueId), { name: clean(r.gvUniqueName || r.gvUniqueId), kind: 'gv-id', tl: clean(r.tlName) });
          }
        }
      };
      // GV REPORT (agent + TL + supervisor ids)
      ingest.gvReport = async (rows) => {
        for (const r of rows || []) {
          if (++tick % 400 === 0) await U.breathe();
          const ap = person(idx, 'gv-agent', r.agentName || r.agentId, r.tlName, '', r.agentId);
          rememberId(ap, r.agentId); rememberTlId(ap, r.tlId); rememberTlId(ap, r.supervisorId);
          if (clean(r.agentId)) indexId(r.agentId, { name: clean(r.agentName || r.agentId), kind: 'gv-agent', tl: clean(r.tlName) });
          addAlias(ap, r.agentId, canMob ? r.mobile : '');
          addMobile(r.mobile, r.agentName || r.agentId, 'gv-agent', r.tlName);
          if (clean(r.tlName) && FF.config.isRealTl(clean(r.tlName))) {
            const tp = person(idx, 'gv-tl', r.tlName, '', '', clean(r.tlId || r.supervisorId));
            [r.tlId, r.supervisorId].forEach((id) => { rememberId(tp, id); if (clean(id)) indexId(id, { name: clean(r.tlName), kind: 'gv-tl' }); });
            addAlias(tp, canMob ? r.tlMobile : '');
          }
          if (r.tlMobile) addMobile(r.tlMobile, r.tlName, 'gv-tl', '');
        }
      };
      // GV stock (Tag Assignment aggregates)
      ingest.gvStockAgent = async (rows) => {
        for (const r of rows || []) {
          if (++tick % 400 === 0) await U.breathe();
          const p = person(idx, 'gv-agent', r.agentName || r.agentId, r.tlName, '', r.agentId);
          if (p) { p.n += Number(r.n) || 0; rememberId(p, r.agentId); rememberTlId(p, r.tlId); }
          if (clean(r.agentId)) indexId(r.agentId, { name: clean(r.agentName || r.agentId), kind: 'gv-agent', tl: clean(r.tlName) });
        }
      };
      ingest.gvStockTl = async (rows) => {
        for (const r of rows || []) {
          const p = person(idx, 'gv-tl', r.tlName, '', '', clean(r.tlId));
          rememberId(p, r.tlId);
          if (clean(r.tlId)) indexId(r.tlId, { name: clean(r.tlName || r.tlId), kind: 'gv-tl' });
        }
      };
      // Canonical order (pehle jaisa): jo datasets deadline tak aa gaye unhe isi order me jodo — slow dataset search ko nahi rokta.
      const ORDER = ['ffReport', 'agents', 'stockAgents', 'gvMaster', 'gvReport', 'gvStockAgent', 'gvStockTl'];
      const settled = await settleSoon(sources, LIMITS.lightSoftMs);
      for (const name of ORDER) if (settled[name] && settled[name].status === 'fulfilled') await ingest[name](settled[name].value);
      indexLookups(idx);
      if (generation !== state.generation) return state.light;
      state.light = idx;
      state.lightPromise = null;
      // Deadline tak jo nahi aaye (slow Google query) — aate hi index me jod do aur dropdown refresh; search pehle se chal rahi hai.
      const late = ORDER.filter((name) => !settled[name]);
      if (late.length) {
        idx.partial = true;
        let left = late.length;
        late.forEach((name) => {
          Promise.resolve(sources[name]).then(async (value) => { if (generation === state.generation) await ingest[name](value); }, () => {})
            .catch(() => {})
            .finally(() => { if (generation !== state.generation) return; indexLookups(idx); if (--left === 0) idx.partial = false; emit(); });
        });
      }
      emit();
      return idx;
    })().catch((err) => { if (generation === state.generation) state.lightPromise = null; throw err; });
    return state.lightPromise;
  }

  /** Layer 2 — barcode-level register (FF StockDataa + GV Tag Assignment). Background load. */
  async function buildFull() {
    if (state.full) return state.full;
    if (state.fullPromise) return state.fullPromise;
    // ⚡ insights.js ab lazy module hai — barcode register ke liye usko on-demand load karo.
    if (!FF.insights || !FF.insights.loadDetails) {
      if (!FF.lazy || !FF.lazy.inject) return null;
      await FF.lazy.inject('insights');
      if (!FF.insights || !FF.insights.loadDetails) return null;
    }
    const generation = state.generation;
    state.fullPromise = (async () => {
      const idx = state.light || await buildLight();
      const details = await FF.insights.loadDetails();
      const stamp = (d) => (d ? (d instanceof Date ? U.dateKey(d) : U.parseDate(d) ? U.dateKey(U.parseDate(d)) : '') : '');
      let tick = 0;
      const stop = async () => { if (++tick % 400) return false; await U.breathe(); return generation !== state.generation; };
      for (const r of details.stock || []) {
        if (await stop()) return state.full;
        const keys = [...new Set([r.barcode, r.tagId].map(normBar).filter(Boolean))];
        if (!keys.length) continue;
        const owner = clean(r.agentName || r.agentId);
        for (const key of keys) {
          const e = barEntry(idx, key);
          if (!e.ff.some((x) => normName(x.agentName) === normName(owner) && normId(x.agentId) === normId(r.agentId) && normId(x.tagId) === normId(r.tagId))) {
            e.ff.push({ barcode: key, tagId: clean(r.tagId), agentId: clean(r.agentId), agentName: owner, tlName: clean(r.tlName), cls: clean(r.cls), allocated: stamp(r.agentAllocatedAt || r.bcAllocatedAt), source: 'StockDataa' });
          }
          const p = person(idx, 'ff-agent', owner, r.tlName, r.cls, r.agentId);
          if (p) { p.bars.add(key); if (!p.last) p.last = stamp(r.agentAllocatedAt || r.bcAllocatedAt); }
          if (clean(r.tlName)) { const t = person(idx, 'ff-tl', r.tlName, '', r.cls, ''); if (t) t.bars.add(key); }
        }
      }
      for (const r of details.assignment || []) {
        if (await stop()) return state.full;
        const keys = [...new Set([r.serial, r.tagId].map(normBar).filter(Boolean))];
        if (!keys.length) continue;
        const owner = clean(r.agentName || r.agentId);
        for (const key of keys) {
          const e = barEntry(idx, key);
          if (!e.gv.some((x) => normId(x.gvId) === normId(r.gvUniqueId) && normName(x.agentName) === normName(owner) && normId(x.tagId) === normId(r.tagId))) {
            e.gv.push({ barcode: key, tagId: clean(r.tagId), agentId: clean(r.agentId), agentName: owner, tlName: clean(r.tlName), cls: clean(r.cls), gvId: clean(r.gvUniqueId), gvName: clean(r.gvUniqueName), allocated: stamp(r.allocatedAt), source: 'Tag Assignment' });
          }
          const p = person(idx, 'gv-agent', owner, r.tlName, r.cls, r.agentId);
          if (p) { p.bars.add(key); if (!p.last) p.last = stamp(r.allocatedAt); }
          if (clean(r.tlName)) { const t = person(idx, 'gv-tl', r.tlName, '', r.cls, ''); if (t) t.bars.add(key); }
          if (clean(r.gvUniqueName) || clean(r.gvUniqueId)) {
            const g = person(idx, 'gv-id', r.gvUniqueName || r.gvUniqueId, r.tlName, r.cls, r.gvUniqueId);
            if (g) g.bars.add(key);
          }
        }
      }
      // Index issued tags from GV Master too (they may no longer exist in the stock/assignment tabs).
      for (const r of details.rawMaster || []) {
        if (await stop()) return state.full;
        const keys = [...new Set([r.serial, r.tagId].map(normBar).filter(Boolean))];
        if (!keys.length) continue;
        const owner = clean(r.agentName || r.agentId);
        for (const key of keys) {
          const e = barEntry(idx, key);
          if (!e.gv.some((x) => x.source === 'GV Master' && normName(x.agentName) === normName(owner) && normId(x.tagId) === normId(r.tagId))) {
            e.gv.push({ barcode: key, tagId: clean(r.tagId), agentId: clean(r.agentId), agentName: owner, tlName: clean(r.tlName), cls: clean(r.cls), gvId: clean(r.gvUniqueId), gvName: clean(r.gvUniqueName), allocated: stamp(r.date), source: 'GV Master' });
          }
          const p = person(idx, 'gv-agent', owner, r.tlName, r.cls, r.agentId);
          if (p) { p.bars.add(key); if (!p.last) p.last = stamp(r.date); }
          if (clean(r.tlName)) { const t = person(idx, 'gv-tl', r.tlName, '', r.cls, ''); if (t) t.bars.add(key); }
        }
      }
      // EIR is FF's issue ledger: retain a tag lookup even when the tag is no longer in StockDataa.
      for (const r of details.eir || []) {
        if (await stop()) return state.full;
        const key = normBar(r.tagId);
        if (!key) continue;
        const e = barEntry(idx, key);
        const owner = clean(r.agentName || r.agentId);
        if (!e.ff.some((x) => x.source === 'EIR' && normId(x.tagId) === normId(r.tagId) && normId(x.agentId) === normId(r.agentId))) {
          e.ff.push({ barcode: key, tagId: clean(r.tagId), agentId: clean(r.agentId), agentName: owner, tlName: clean(r.tlName), cls: clean(r.cls), allocated: stamp(r.date), source: 'EIR' });
        }
        const p = person(idx, 'ff-agent', owner, r.tlName, r.cls, r.agentId);
        if (p) { p.bars.add(key); if (!p.last) p.last = stamp(r.date); }
        if (clean(r.tlName)) { const t = person(idx, 'ff-tl', r.tlName, '', r.cls, ''); if (t) t.bars.add(key); }
      }
      indexLookups(idx);
      if (generation !== state.generation) return state.full;
      idx.fullLoaded = true;
      state.full = idx;
      state.fullPromise = null;
      emit();
      return idx;
    })().catch((err) => {
      if (generation === state.generation) {
        state.fullPromise = null;
        state.fullError = String(err && (err.message || err) || 'Barcode register load failed');
        emit();
      }
      return state.light;
    });
    return state.fullPromise;
  }
  /** Kick the heavy layer off in the background (non-blocking) — suggestions upgrade automatically. */
  function warmFull() {
    GVC.load();
    // 🏷️ Barcode register ke liye insights.js chahiye — wo ab lazy module hai, isliye pehle background
    // me load karo (topbar search khulte hi register bhi taiyaar ho jata hai).
    const ready = (name) => (typeof FF[name] !== 'undefined' ? Promise.resolve() : (FF.lazy && FF.lazy.inject ? FF.lazy.inject(name) : Promise.resolve()));
    ready('masterProfile').then(() => {
      // Har dataset aate hi dropdown / kundli refresh (pehle sab ke khatam hone tak "REPORT load ho raha hai…" rehta tha).
      if (FF.masterProfile && FF.masterProfile.onData && !state.mpSub) state.mpSub = FF.masterProfile.onData(emit);
      if (FF.masterProfile && FF.masterProfile.warm) return FF.masterProfile.warm();
    }).then(emit).catch(() => {});
    // ⚠️ fullPromise ko yahan reset NAHI karte: har keystroke/render par warmFull() chalta hai, aur reset se
    // har call naya 2.3 lakh-row barcode build shuru kar deta tha (page hang). buildFull() khud dedupe karta hai.
    ready('insights').then(() => { if (!state.full && !state.fullPromise) return buildFull(); }).catch((err) => {
      state.fullError = String(err && (err.message || err) || 'Barcode register module load failed');
      emit();
    });
  }
  const MP = () => (FF.masterProfile && FF.masterProfile.supports ? FF.masterProfile : null);

  // 💸 v3.90 — GV agent / TL ka latest commission (Settings → "GV agent commission box"). Server ek chhota map deta hai
  // (agent ID → latest commission, TL ID → max/min); ek baar load, phir har jagah sync + instant (dropdown, kundli, profile box).
  const GVC = {
    data: null, promise: null, failAt: 0,
    load(force) {
      if (!force && this.data) return Promise.resolve(this.data);
      if (this.promise) return this.promise;
      if (!force && this.failAt && Date.now() - this.failAt < 60e3) return Promise.resolve(null);
      if (!FF.auth || !FF.auth.api || !FF.auth.user) return Promise.resolve(null);
      this.promise = FF.auth.api('/api/gv-agent-commission' + (force ? '?fresh=1' : '')).then((d) => {
        this.data = d && d.ok && d.enabled !== false ? d : null;
        if (!this.data) this.failAt = Date.now();
        this.fill(document);
        return this.data;
      }).catch(() => { this.failAt = Date.now(); return null; }).finally(() => { this.promise = null; });
      return this.promise;
    },
    isGv: (p) => /^gv/.test(String((p && p.kind) || '')),
    idOf: (id) => String(id || '').trim().toUpperCase(),
    entry(id, isTl) {
      const d = this.data, k = this.idOf(id);
      if (!d || !k) return null;
      const a = d.agents && d.agents[k], t = isTl && d.tls && d.tls[k];
      if (!a && !t) return null;
      const amount = Math.max(a ? a.a : 0, t ? t.max : 0);
      return { amount, date: a ? a.d : '', min: t ? t.min : (a ? a.a : 0), n: t ? t.n : 0, own: !!a };
    },
    money(v) { const d = this.data || {}; return `${d.currency === undefined ? '₹' : d.currency}${U.fmt(v)}${d.suffix === undefined ? '/tag' : d.suffix}`; },
    text(id, isTl) {
      const d = this.data, e = this.entry(id, isTl);
      if (!d) return '';
      return `${d.label || 'VC4'} max ${e ? this.money(e.amount) : '—'}`;
    },
    subText(p) { return this.isGv(p) && this.data ? (this.entry(p.sub || p.id, /tl$/.test(String(p.kind || ''))) ? `💸 ${this.text(p.sub || p.id, /tl$/.test(String(p.kind || '')))}` : '') : ''; },
    inner(id, isTl, mode) {
      if (!this.data) return mode === 'val' ? '…' : mode === 'sub' ? 'load ho raha hai…' : '💸 …';
      const e = this.entry(id, isTl), d = this.data;
      if (mode === 'val') return e ? this.money(e.amount) : '<span class="dim">—</span>';
      if (mode === 'sub') {
        if (!e) return `${esc(d.label || 'VC4')} · is ID ka commission record nahi mila`;
        const bits = [`${esc(d.label || 'VC4')} max · latest commission`];
        if (isTl && e.n) bits.push(`${U.fmt(e.n)} agents · ${this.money(e.min)} – ${this.money(e.amount)}`);
        if (e.date) bits.push(`as of ${esc(e.date)}`);
        return bits.join(' · ');
      }
      return `💸 ${esc(this.text(id, isTl))}`;
    },
    chip(p) {
      if (!this.isGv(p)) return '';
      const id = p.sub || p.id || '', isTl = /tl$/.test(String(p.kind || ''));
      if (!id) return '';
      return ` <span class="gvc-chip" data-gvc="${esc(this.idOf(id))}|${isTl ? 1 : 0}" data-gvc-mode="chip" title="GV Master · latest commission (product ID se)">${this.inner(id, isTl, 'chip')}</span>`;
    },
    boxHtml(pr, isTl) {
      const id = pr && pr.id;
      if (!id) return '';
      const key = `${esc(this.idOf(id))}|${isTl ? 1 : 0}`;
      return `<div class="mp-kpi msp-kpi k12 gvc-box" title="GV Master · product ID ka latest commission"><small>💸 Commission</small><b class="gvc-val" data-gvc="${key}" data-gvc-mode="val">${this.inner(id, isTl, 'val')}</b><em class="gvc-sub" data-gvc="${key}" data-gvc-mode="sub">${this.inner(id, isTl, 'sub')}</em></div>`;
    },
    fill(root) {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('[data-gvc]').forEach((el) => {
        const [id, tl] = String(el.dataset.gvc || '').split('|');
        el.innerHTML = this.inner(id, tl === '1', el.dataset.gvcMode || 'chip');
      });
    }
  };
  const allPeople = () => [...((state.full || state.light || {}).people || new Map()).values()];
  const personByKey = (key) => ((state.full || state.light || {}).people || new Map()).get(key) || null;
  const personKey = (p) => `${p.kind}|${normName(p.name)}|${normId(p.sub || p.id || [...(p.ids || [])][0] || '')}`;

  // ---------------------------------------------------------------- identity resolver
  /**
   * Canonical person resolver:
   * - exact ID ka authoritative channel idx.ids me already indexed hota hai (GV Master ke IDs last me ingest hote hain).
   * - FF row me gvIdFound / alias ho aur wahi ID GV canonical registry me ho to GV person return karo.
   * - same-name duplicates ko bina identity proof ke merge nahi karta.
   */
  function canonicalPerson(p, idx) {
    if (!p || !idx) return p;
    // A GV person that is both agent and TL keeps its own kind (separate suggestion rows).
    if (/^gv-(agent|tl)$/.test(String(p.kind || ''))) return p;
    const ids = new Set([p.sub, ...(p.ids || []), ...(p.alias || [])].map(normId).filter((x) => x && x.length >= 4));
    for (const id of ids) {
      const canonical = idx.ids && idx.ids.get(id);
      if (!canonical || !/^gv-/.test(String(canonical.kind || ''))) continue;
      const gv = [...idx.people.values()].find((x) => /^gv-agent$|^gv-tl$/.test(String(x.kind || ''))
        && normName(x.name) === normName(canonical.name || p.name)
        && ([x.sub, ...(x.ids || []), ...(x.alias || [])].map(normId).includes(id)));
      if (gv) return gv;
    }
    return p;
  }

  function canonicalPeople(list, idx) {
    const out = [], seen = new Set();
    for (const p of list || []) {
      const cp = canonicalPerson(p, idx);
      const key = `${cp.kind}|${normName(cp.name)}|${normId(cp.sub || '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cp);
    }
    return out;
  }

  // ---------------------------------------------------------------- query
  // ⚡ v3.125.11 — Live barcode lookup: poora register (3.5 lakh barcodes, 4 sheets) load hone me 1-3 min lagta hai,
  // tab tak barcode search khali dikhti thi. Ab typed barcode/tag ke liye 4 chhoti targeted queries (1-9 s) chalti hain
  // aur register ready hote hi normal index le leta hai.
  const live = { map: new Map(), order: [] };
  const liveSafe = (q) => String(q || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function liveLookup(query) {
    const key = normBar(query);
    if (key.length < 4 || !/\d/.test(query)) return null;
    let rec = live.map.get(key);
    if (rec) return rec;
    const D = FF.data, c = FF.config || {};
    if (!D || !D.query) return null;
    rec = { key, pending: true, entries: new Map(), failed: 0 };
    live.map.set(key, rec); live.order.push(key);
    if (live.order.length > 30) live.map.delete(live.order.shift());
    // Sheet me barcode dash ke saath bhi hota hai (608116-011-0558357) — raw aur bina-dash dono roop dhoondo.
    const raw = String(query || '').trim().toLowerCase().replace(/[^a-z0-9\-\/ ]/g, '');
    const needles = [...new Set([liveSafe(query), raw].filter((x) => x && x.length >= 4))];
    const s = c.stock || {}, a = (c.gv && c.gv.assignment) || {}, e = c.eir || {};
    const gen = state.generation;
    // Format dekh kar sirf zaroori column scan karo (kam conditions = tez query):
    //   • 608116-011-… ya sirf digits → barcode/serial column (EIR me barcode nahi hota → EIR skip)
    //   • hex tag ID (34161FA8…)     → tag ID column
    const kindOf = /[a-z]/i.test(key) ? 'tag' : (/-/.test(String(query)) || /^60\d{4}/.test(key)) ? 'barcode' : 'both';
    const pick = (barCol, tagCol) => (kindOf === 'tag' ? [tagCol] : kindOf === 'barcode' ? [barCol] : [barCol, tagCol]);
    const add = (barcode, rowFn) => {
      const k = normBar(barcode); if (!k) return;
      let en = rec.entries.get(k); if (!en) { en = { key: k, ff: [], gv: [] }; rec.entries.set(k, en); }
      rowFn(en, k);
    };
    const find = (sheet, cols, idCols, onRow) => {
      const list = [...new Set(cols.filter(Boolean))];
      const cond = idCols.filter(Boolean).flatMap((col) => needles.map((n) => `lower(${col}) contains '${n}'`)).join(' or ');
      if (!list.length || !cond) return Promise.resolve();
      const idx = new Map(list.map((col, i) => [col, i]));
      const val = (row, col) => { const i = idx.get(col); return i === undefined ? '' : clean(D.identifierText ? D.identifierText(row[i]) : D.cellText(row[i])); };
      const txt = (row, col) => { const i = idx.get(col); return i === undefined ? '' : clean(D.cellText(row[i])); };
      // Server gviz gate `limit ≤ 200` wali queries ko queue ke aage rakhta hai (bade register pages ke peeche nahi atakti).
      return D.query(sheet, `select ${list.join(', ')} where ${cond} limit 40`, { timeoutMs: 40000 })
        .then((t) => { (t.rows || []).forEach((row) => onRow(row, val, txt)); })
        .catch(() => { rec.failed++; })
        .finally(() => { if (gen === state.generation) emit(); });
    };
    const cls = (v) => (FF.gv && FF.gv.normClass ? FF.gv.normClass(v) : v);
    Promise.all([
      find(s.sheet || 'StockDataa', [s.barcode, s.tagId, s.agentId, s.agentName, s.tlName, s.cls, s.agentAllocatedAt, s.bcAllocatedAt], pick(s.barcode, s.tagId), (row, val, txt) => {
        [val(row, s.barcode) || val(row, s.tagId)].forEach((b) => add(b, (en, k) => en.ff.push({ barcode: k, tagId: val(row, s.tagId), agentId: val(row, s.agentId), agentName: txt(row, s.agentName) || val(row, s.agentId), tlName: txt(row, s.tlName), cls: cls(txt(row, s.cls)), allocated: txt(row, s.agentAllocatedAt) || txt(row, s.bcAllocatedAt), source: 'StockDataa' })));
      }),
      find('Tag Assignment', [a.serial, a.tagId, a.agentId, a.agentName, a.tlName, a.cls, a.gvUniqueId, a.gvUniqueName, a.allocatedAt], pick(a.serial, a.tagId), (row, val, txt) => {
        [val(row, a.serial) || val(row, a.tagId)].forEach((b) => add(b, (en, k) => en.gv.push({ barcode: k, tagId: val(row, a.tagId), agentId: val(row, a.agentId), agentName: txt(row, a.agentName) || val(row, a.agentId), tlName: txt(row, a.tlName), cls: cls(txt(row, a.cls)), gvId: txt(row, a.gvUniqueId), gvName: txt(row, a.gvUniqueName), allocated: txt(row, a.allocatedAt), source: 'Tag Assignment' })));
      }),
      kindOf === 'barcode' ? Promise.resolve() : find(e.sheet || 'EIR', [e.tagId, e.agentId, e.agentName, e.tlName, e.cls, e.date], [e.tagId], (row, val, txt) => {
        add(val(row, e.tagId), (en, k) => en.ff.push({ barcode: k, tagId: val(row, e.tagId), agentId: val(row, e.agentId), agentName: txt(row, e.agentName) || val(row, e.agentId), tlName: txt(row, e.tlName), cls: txt(row, e.cls), allocated: txt(row, e.date), source: 'EIR' }));
      })
    ]).finally(() => { rec.pending = false; if (gen === state.generation) emit(); });
    return rec;
  }

  /** v3.125.14 — Ek tag ke do keys (barcode + tag ID) index me alag entries hain; result me ek hi row dikhao.
      Row ka key hamesha barcode/serial (agar mile), tag ID apne column me rehta hai. Index entries mutate nahi hote. */
  function mergeTagEntries(tags) {
    const groups = new Map(), order = [];
    const recKey = (x) => [x.source, normName(x.agentName), normId(x.agentId), normId(x.tagId), normId(x.gvId)].join('|');
    for (const t of tags) {
      const recs = [...(t.ff || []), ...(t.gv || [])];
      const tid = normBar((recs.find((x) => x && x.tagId) || {}).tagId);
      const barcodeKey = normBar((recs.find((x) => x && x.barcode && normBar(x.barcode) !== tid) || {}).barcode);
      const id = tid || t.key;
      let g = groups.get(id);
      if (!g) { g = { key: t.key, ff: [], gv: [], seen: new Set(), tid }; groups.set(id, g); order.push(g); }
      if (t.key !== tid) g.key = t.key; else if (g.key === tid && barcodeKey) g.key = barcodeKey;
      for (const side of ['ff', 'gv']) for (const x of t[side] || []) { const k = side + recKey(x); if (!g.seen.has(k)) { g.seen.add(k); g[side].push(x); } }
    }
    return order.map((g) => ({ key: g.key, ff: g.ff, gv: g.gv }));
  }

  function search(q) {
    const idx = state.full || state.light;
    const query = clean(q);
    const out = { q: query, people: [], tags: [], ids: [], heavy: !!(state.full && state.full.fullLoaded), matched: 0 };
    if (!idx || !query) return out;
    const nql = query.toLowerCase();
    const nn = normName(query);
    const ni = normId(query);
    const barcodeQuery = normBar(query);
    const wantsTags = barcodeQuery.length >= 4 && /\d/.test(query);

    // people by name / TL / id / GV id — 2-gram index avoids scanning every person on each key.
    if (nn.length >= 2) {
      const candidates = idx.personGrams ? (idx.personGrams.get(nn.slice(0, 2)) || []) : idx.people.values();
      for (const p of candidates) if ((p._searchHay || '').includes(nn)) out.people.push(p);
      out.people.sort((a, b) => (b.bars.size - a.bars.size) || (b.n - a.n));
      if (out.people.length > 60) out.people.length = 60;
    }
    // exact / prefix ID hits — only inspect IDs sharing the first 4 normalized characters.
    if (ni.length >= 4) {
      const candidates = idx.idBuckets ? (idx.idBuckets.get(ni.slice(0, 4)) || []) : [...idx.ids].map(([id, value]) => ({ id, value }));
      for (const entry of candidates) if (entry.id === ni || entry.id.startsWith(ni)) out.ids.push({ id: entry.id, ...entry.value });
      out.ids.sort((a, b) => a.id.length - b.id.length);
      if (out.ids.length > 40) out.ids.length = 40;
    }
    // 📞 mobile number (agent + TL) — poora ya aakhri digits, indexed by 5-digit fragments.
    const dq = query.replace(/\D/g, '');
    if (dq.length >= 5 && dq.length <= 13 && !/[a-z]/i.test(query) && idx.mobiles) {
      const want = dq.slice(-10);
      const candidates = idx.mobileGrams ? (idx.mobileGrams.get(want.slice(0, 5)) || []) : idx.mobiles.values();
      for (const v of candidates) if (v.mobile === want || v.mobile.includes(want) || want.includes(v.mobile)) out.ids.push({ id: v.mobile, name: v.name, kind: v.kind, tl: v.tl, via: 'Mobile' });
      if (out.ids.length > 40) out.ids.length = 40;
    }
    // barcode / tag / serial — partial barcode (prefix / beech ke digits) bhi.
    if (wantsTags && idx.bars.size) {
      // Seedha key-list scan (2.3 lakh keys ≈ 2-18 ms) — exact / prefix, aur 6+ digit par substring (middle ke digits bhi).
      const keys = idx.barKeys && idx.barKeys.length ? idx.barKeys : [...idx.bars.keys()];
      const substring = ni.length >= 6;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === barcodeQuery || key.startsWith(barcodeQuery) || (substring && key.includes(barcodeQuery))) { const entry = idx.bars.get(key); if (entry) out.tags.push(entry); }
      }
      out.tags.sort((a, b) => a.key.length - b.key.length || (b.ff.length + b.gv.length) - (a.ff.length + a.gv.length));
      if (out.tags.length > 120) out.tags.length = 120;
    }
    // Register abhi ban raha hai → typed barcode ko seedha sheet se live dhoondo.
    if (wantsTags && !out.heavy) {
      const rec = liveLookup(query);
      if (rec) {
        out.livePending = rec.pending;
        const have = new Set(out.tags.map((t) => t.key));
        rec.entries.forEach((en, k) => { if (!have.has(k) && out.tags.length < 120) { out.tags.push(en); have.add(k); } });
        out.tags.sort((a, b) => a.key.length - b.key.length || (b.ff.length + b.gv.length) - (a.ff.length + a.gv.length));
      }
    }
    if (out.tags.length > 1) out.tags = mergeTagEntries(out.tags);
    out.people = canonicalPeople(out.people, idx);
    suppressFalseFfMatches(out);
    out.matched = out.people.length + out.ids.length + out.tags.length;
    return out;
  }

  /** Exact agent/TL ID match wins before name/TL substring matches.
      GV Master: A=UNIQUE_ID (agent), C=TL ID, R=GV TL ID alias. */
  function preferNameMatches(people, query) {
    const list = people || [];
    const ni = normId(query);
    if (ni.length >= 4) {
      const exact = list.filter((p) => {
        if (normId(p.sub) === ni) return true;
        if (p.ids && [...p.ids].some((id) => normId(id) === ni)) return true;
        if (p.tlIds && [...p.tlIds].some((id) => normId(id) === ni)) return true;
        return false;
      });
      if (exact.length) {
        exact.sort((a, b) => {
          const aTl = /-tl$/.test(String(a.kind)) ? 1 : 0;
          const bTl = /-tl$/.test(String(b.kind)) ? 1 : 0;
          return bTl - aTl || (b.n - a.n);
        });
        return exact;
      }
    }
    const nn = normName(query);
    if (nn.length < 2) return list;
    const matches = list.filter((p) => {
      const name = normName(p.name);
      return name === nn || name.startsWith(nn);
    });
    return matches.length ? matches : list;
  }

  function identityIds(p) {
    if (!p) return [];
    return [...new Set([p.sub, ...(p.ids || []), ...(p.alias || [])].map(normId).filter((v) => v && v.length >= 4))];
  }
  function identitiesLinked(a, b) { const A = new Set(identityIds(a)); return A.size > 0 && identityIds(b).some((id) => A.has(id)); }
  function suppressFalseFfMatches(res) {
    if (!res || !res.people || !res.people.length) return res;
    const queryName = normName(res.q), ni = normId(res.q);
    const gvPeople = res.people.filter((p) => /^gv-/.test(String(p.kind || '')) && (p.kind === 'gv-agent' || p.kind === 'gv-tl'));
    const exactGv = gvPeople.filter((p) => (queryName && normName(p.name) === queryName) || (ni.length >= 4 && identityIds(p).includes(ni)));
    if (!exactGv.length) return res;
    // TL cards are never suppressed: an FF TL and a GV TL with the same name are two real TLs (both channels).
    res.people = res.people.filter((p) => {
      if (!/^ff-/.test(String(p.kind || '')) || p.kind === 'ff-tl') return true;
      const same = exactGv.filter((g) => normName(g.name) === normName(p.name));
      return !same.length || same.some((g) => identitiesLinked(g, p));
    });
    res.ids = (res.ids || []).filter((v) => {
      if (!/^ff-/.test(String(v.kind || '')) || v.kind === 'ff-tl') return true;
      const same = exactGv.filter((g) => normName(g.name) === normName(v.name));
      return !same.length || same.some((g) => identitiesLinked(g, { sub: v.id, ids: [v.id] }));
    });
    return res;
  }

  /** Suggestions for U.suggest() — label + sub + kind chip. */
  /** Suggestions for U.suggest() — direct/fallback matching so 1-2 letters bhi reliably dropdown me aaye. */
  // 🎯 Filter chips (All · GV · FF · Agent · TL · Barcode) — top search dropdown ko narrow karte hain.
  const CHIP_FILTERS = [['', 'All'], ['gv', '🟩 GV'], ['ff', '🟦 FF'], ['agent', 'Agent'], ['tl', 'TL'], ['barcode', 'Barcode']];
  let chipFilter = '';
  function chipMatch(it, f) {
    if (!f || it.none) return true;
    const pk = String((it.person && it.person.kind) || '');
    if (f === 'gv' || f === 'ff') return it.kind === f || pk.startsWith(f + '-');
    if (f === 'agent') return /agent$/.test(pk) || /agent/i.test(String(it.kindLabel || ''));
    if (f === 'tl') return /tl$/.test(pk) || /\bTL\b/.test(String(it.kindLabel || ''));
    if (f === 'barcode') return /barcode|tag/i.test(String(it.kindLabel || ''));
    return true;
  }
  function suggestItems(q) {
    const items = suggestItemsRaw(q);
    if (!chipFilter) return items;
    const kept = items.filter((it) => chipMatch(it, chipFilter));
    return kept.length ? kept : [{ kind: 'cls', kindLabel: 'Filter', label: 'Is filter me kuch nahi mila', sub: 'Upar se "All" chip dabao', value: clean(q), none: true }];
  }
  function suggestItemsRaw(q) {
    const query = clean(q);
    if (!query) return [];
    if (!state.light) {
      buildLight().catch(() => {});
      warmFull();
      return query.length >= 2
        ? [{ kind: 'cls', kindLabel: 'Search', label: `“${query}” search ho raha hai…`, sub: 'index ban raha hai (agents + TLs + IDs)', value: query, none: true }]
        : [];
    }

    let r = null;
    try { r = search(query) || { q: query, people: [], tags: [], ids: [], matched: 0, heavy: false }; }
    catch (err) { console.warn('Master Search suggestion search error:', err && err.message); r = { q: query, people: [], tags: [], ids: [], matched: 0, heavy: false }; }

    // Primary path = indexed search. Fallback = direct scan of the lightweight people index.
    // Isse short-name typing aur stale/missing 2-gram buckets dono cases me dropdown guaranteed hai.
    let people = Array.isArray(r.people) ? r.people.slice() : [];
    if (!people.length) {
      const nq = normName(query);
      const ni = normId(query);
      const all = allPeople();
      const scored = [];
      for (const p of all) {
        const name = normName(p.name);
        const sub = normId(p.sub);
        const tl = [...(p.tlSet || [])].map(normName);
        const aliases = [...(p.alias || [])].map(normName);
        const ids = [...(p.ids || [])].map(normId);
        const hay = [name, sub, ...tl, ...aliases, ...ids].filter(Boolean);
        let score = 0;
        if (nq && name === nq) score = 1000;
        else if (nq && name.startsWith(nq)) score = 850;
        else if (nq && name.includes(nq)) score = 700;
        else if (ni && (sub === ni || ids.includes(ni))) score = 950;
        else if (ni && hay.some((x) => x.startsWith(ni))) score = 800;
        else if (hay.some((x) => x.includes(nq || ni))) score = 500;
        if (score) scored.push({ p, score });
      }
      scored.sort((x, y) => y.score - x.score || (Number(y.p.n) || 0) - (Number(x.p.n) || 0) || String(x.p.name).localeCompare(String(y.p.name)));
      people = scored.slice(0, 60).map((x) => x.p);
    }

    // v3.78 — ranking: jinka NAAM query se match kare (TL cards bhi) pehle; sirf TL naam ki wajah se match
    // hone wale agents baad me. Pehle agents (zyada bars) upar aate the aur 14 ki cap me TL cards kat jaate the.
    const nqRank = normName(query);
    const nameHit = (p) => !!nqRank && normName(p.name).includes(nqRank);
    const isTlRank = (p) => /tl$/.test(String(p.kind || ''));
    const filteredPeople = people
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (nameHit(b.p) - nameHit(a.p)) || (isTlRank(b.p) - isTlRank(a.p)) || (a.i - b.i))
      .map((x) => x.p);
    const items = [];
    filteredPeople.slice(0, 14).forEach((rawP) => {
      const p = canonicalPerson(rawP, state.full || state.light);
      const tl = [...(p.tlSet || [])][0] || '';
      let q1 = null;
      if (people.length === 1 && MP()) { try { q1 = MP().quick(p); } catch (err) { console.warn('Master Search quick preview:', err && err.message); } }
      const isTlKind = /tl$/.test(p.kind);
      const extra = q1 ? [
        q1.mobile && (!FF.auth || FF.auth.can('contacts')) ? `📞 ${q1.mobile}` : '',
        `📦 ${U.fmt(q1.stock.total)}${isTlKind && q1.tlStock && q1.tlStock.own && q1.tlStock.agents ? ` (own ${U.fmt(q1.tlStock.own.total)} + agents ${U.fmt(q1.tlStock.agents.total)})` : ''}${!isTlKind && q1.tlStock && q1.tlStock.has ? ` · TL ${U.fmt(q1.tlStock.total)}${q1.tlStock.own && q1.tlStock.agents ? ` (own ${U.fmt(q1.tlStock.own.total)} + agents ${U.fmt(q1.tlStock.agents.total)})` : ''}` : ''}`,
        (q1.totals && (q1.totals.curTotal || q1.totals.lastTotal)) ? `🏷️ Total ${U.fmt(q1.totals.curTotal)} · 📅 last month ${U.fmt(q1.totals.lastTotal)}` : '',
        q1.tagRequired ? `🏷️ TAG ${U.sugText(q1.calc.total.net, q1.calc.total.gross)}` : (!q1.direct && q1.calc && (q1.calc.total.net || q1.calc.total.gross) ? `🎯 dispatch ${U.sugText(q1.calc.total.net, q1.calc.total.gross)}` : ''),
        q1.calc && q1.calc.total.rate > 0 ? `⚡ ${U.fmt(q1.calc.total.rate, true)}/day` : '',
        q1.calc && q1.calc.total.cover != null ? `⏳ cover ${U.fmt(q1.calc.total.cover, true)} din` : ''
      ].filter(Boolean) : [];
      items.push({
        kind: p.kind.startsWith('gv') ? 'gv' : 'ff',
        kindLabel: KIND_LABEL[p.kind] || p.kind,
        label: p.name,
        sub: [p.sub ? `ID ${p.sub}` : '', GVC.subText(p), tl ? `TL ${p.direct ? (p.directLabel || tl) : tl}` : '', ...extra, !q1 && (p.issuanceN || p.bars.size || p.n) ? `${U.fmt(p.issuanceN || p.bars.size || p.n)} tags` : ''].filter(Boolean).join(' · '),
        badge: q1 && q1.priority ? q1.priority : ((p.issuanceN || p.bars.size) ? `${U.fmt(p.issuanceN || p.bars.size)}` : ''),
        keywords: `${p.sub} ${tl} ${[...(p.classMap || new Map()).keys()].join(' ')}`,
        value: p.name,
        person: p
      });
    });

    (r.ids || []).slice(0, 6).forEach((v) => items.push({
      kind: 'cls', kindLabel: KIND_LABEL[v.kind] || 'ID', label: `${v.name} · ${v.id}`,
      sub: [`ID ${v.id}`, v.tl ? `TL ${v.tl}` : ''].filter(Boolean).join(' · '), value: v.name, personKey: `${v.kind}|${normName(v.name)}`
    }));
    (r.tags || []).slice(0, 8).forEach((t) => {
      const f = t.ff[0], g = t.gv[0];
      items.push({
        kind: 'cls', kindLabel: 'Barcode',
        label: U.barcode(t.key),
        sub: [((f && f.tagId) || (g && g.tagId)) && normBar((f && f.tagId) || (g && g.tagId)) !== t.key ? `Tag ${(f && f.tagId) || (g && g.tagId)}` : '',
          f ? (clean(f.agentName) ? `FF ${f.agentName}${f.tlName ? ' (TL ' + f.tlName + ')' : ''}` : 'FF stock · agent assign nahi') : 'FF not mapped',
          g ? (clean(g.agentName) ? `GV ${g.agentName}${g.tlName ? ' (TL ' + g.tlName + ')' : ''}` : 'GV stock · agent assign nahi') : 'GV not mapped',
          (f && f.cls) || (g && g.cls) || ''].filter(Boolean).join(' · '),
        value: t.key, barcode: t.key
      });
    });
    if (!items.length && r.livePending) items.push({ kind: 'cls', kindLabel: 'Barcode', label: `“${query}” sheet me dhoondh raha hu…`, sub: 'live barcode search (2-10 sec)', value: query, none: true });
    if (!items.length && query.length >= 2) items.push({ kind: 'cls', kindLabel: 'Search', label: `“${query}” ke liye kuch nahi mila`, sub: 'Doosra naam / ID / barcode try karo', value: query, none: true });
    return items;
  }
  // ---------------------------------------------------------------- results panel (kundli)
  const classPills = (map) => [...(map || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, n]) => `<span class="ms-pill">${esc(c)} <b>${U.fmt(n)}</b></span>`).join('') || '<span class="dim small">class data nahi</span>';

  function tagStatus(t) {
    return {
      ff: t.ff[0] ? { text: 'Mapped', tone: 'green' } : { text: 'Not mapped', tone: 'red' },
      gv: t.gv[0] ? { text: 'Mapped', tone: 'green' } : { text: 'Not mapped', tone: 'red' }
    };
  }
  /** Kundli card ke andar quick stats — mobile · TL · stock · TL stock · priority · suggested (data load hone par). */
  function kundliProfileStats(p) {
    const q1 = MP() ? MP().quick(p) : null;
    if (!q1) {
      if (!(MP() && MP().supports(p))) return '';
      // Data aa chuka hai par is naam ki REPORT row nahi → "load ho raha hai" hamesha nahi (misleading) — saaf message.
      const loaded = !!(MP().isLoaded && MP().isLoaded());
      return `<div class="ms-kundli-stats ms-prof"><div><small>Stock / priority</small><b class="dim">${loaded ? 'REPORT me is naam ki row nahi mili' : 'REPORT load ho raha hai…'}</b></div></div>`;
    }
    const isTlKind = /tl$/.test(p.kind);
    const contacts = !FF.auth || FF.auth.can('contacts');
    const d = q1.dispatch || {};
    const tlStockDetail = q1.tlStock && q1.tlStock.own && q1.tlStock.agents
      ? `Own ${U.fmt(q1.tlStock.own.total)} + agents ${U.fmt(q1.tlStock.agents.total)}` : '';
    // v3.40 — TL stock ka split do clickable chips: "TL ke paas (own)" drawer me sirf TL ki rows, "agents"
    // me sirf agents ki — aur Agents block click par wahi list (TL ki apni row count me nahi ginti jaati).
    const tlNameForSpec = isTlKind ? p.name : ((q1.tl && q1.tl.name) || '');
    const tlStockBaseSpec = !isTlKind && q1.direct ? '' : `src=${q1.ch}&scope=stock&tl=${encodeURIComponent(tlNameForSpec)}${q1.ch === 'gv' ? (isTlKind ? (q1.id ? `&tlId=${encodeURIComponent(q1.id)}` : '') : (q1.tl && q1.tl.id ? `&tlId=${encodeURIComponent(q1.tl.id)}` : '')) : ''}`;
    const splitChips = q1.tlStock && q1.tlStock.own && q1.tlStock.agents && tlStockBaseSpec
      ? `<span class="mp-part own" data-kpi="${esc(`${tlStockBaseSpec}&part=own`)}" title="Sirf TL ke paas (own) stock">own ${U.fmt(q1.tlStock.own.total)}</span> + <span class="mp-part team" data-kpi="${esc(`${tlStockBaseSpec}&part=team`)}" title="Sirf agents ke paas stock">agents ${U.fmt(q1.tlStock.agents.total)}</span>`
      : '';
    const peopleSpec = isTlKind ? `src=${q1.ch}&scope=people&tl=${encodeURIComponent(p.name)}&self=0&sort=stock` : '';
    const p1 = q1.projT1 || null;   // 📈 growth % + expected month-end
    const mode = U.suggestMode ? U.suggestMode() : 'both';
    // 🎯 v3.51 — upar ke boxes me HAMESHA dono numbers (stock ke baad + bina stock ghataye).
    // Pehle settings ka mode 'net' hone par box me sirf 0 dikhta tha, jabki neeche table me
    // "without stock deduction" ka data pada hota tha — confusing tha.
    const pair = (net, gross) => `<span class="sug-pair sug-pair-tight"><span class="sug-result net" title="Required − stock"><small>After stock</small><b class="sug-chip">${U.fmt(net)}</b></span><span class="sug-result gross" title="Run-rate × din, stock ghata kar nahi"><small>W/o stock</small><b class="sug-chip wo">${U.fmt(gross)}</b></span></span>`;
    let sugStats = '';
    if (q1.tagRequired) {
      sugStats = `<div class="ms-sug-full"><small>🏷️ Tags required · ${U.fmt(d.days)} din</small><b><span class="sug-pair sug-pair-tight"><span class="sug-result net"><small>After stock</small><span class="sug-chip direct">🏷️ ${U.fmt(d.sugVc4)} + ${U.fmt(d.sugComm)}</span></span><span class="sug-result gross"><small>W/o stock</small><span class="sug-chip wo">🏷️ ${U.fmt((d.sugVc4Gross || 0) + (d.sugCommGross || 0))}</span></span></span></b></div>`;
    } else if (q1.direct) {
      sugStats = '<div class="ms-sug-full"><small>Suggested dispatch</small><b class="dim">No dispatch</b></div>';
    } else {
      const ct = q1.calc.total;
      sugStats = `<div><small>Sug. VC4 <em>(after stock · w/o stock)</em></small><b>${pair(d.sugVc4, d.sugVc4Gross || 0)}</b></div>
      <div><small>Sug. Comm. <em>(after stock · w/o stock)</em></small><b>${pair(d.sugComm, d.sugCommGross || 0)}</b></div>
      <div class="ms-sug-full"><small>🎯 Dispatch · all tags · ${U.fmt(ct.days)} din</small><b>${pair(ct.net, ct.gross)}</b></div>`;
    }
    return `<div class="ms-kundli-stats ms-prof">
      <div><small>${isTlKind ? 'TL mobile' : 'Mobile'}</small><b>${contacts ? (q1.mobile ? esc(q1.mobile) : '—') : '🔒'}</b></div>
      <div><small>Priority</small><b>${esc(q1.priority || '—')}</b></div>
      ${isTlKind
        ? `<div><small>Stock split (own + agents)</small><b>${splitChips ? 'click karo 👇' : tlStockDetail || U.fmt(q1.stock.total)}</b>${splitChips ? `<em>${splitChips}</em>` : ''}</div>
      <div${` class=\"ms-stat-click\" data-kpi=\"${esc(peopleSpec)}\" title=\"In agents ki poori list\"`}><small>Agents</small><b>${U.fmt(q1.agentCount)}${q1.selfAgent ? ' + TL' : ''}</b>${q1.selfAgent ? `<em>TL ka apna stock alag</em>` : ''}</div>`
        : `<div${q1.tlStock && q1.tlStock.has ? ` class=\"ms-stat-click\" data-kpi=\"${esc(tlStockBaseSpec)}\" title=\"TL stock ki detail\"` : ''}><small>TL ke under stock</small><b>${q1.tlStock && q1.tlStock.has ? U.fmt(q1.tlStock.total) : '—'}</b>${splitChips || tlStockDetail ? `<em>${splitChips || tlStockDetail}</em>` : ''}</div>
      <div><small>TL</small><b>${esc((q1.tl && q1.tl.name) ? tlText(q1.tl.name, q1.ch) : (p.direct ? (p.directLabel || 'Direct') : '—'))}</b></div>`}
      ${sugStats}
      <div><small>Run-rate / day <em>(÷ ${U.fmt(q1.calc.total.elapsed)} din)</em></small><b>${U.fmt(q1.calc.total.rate, true)}</b></div>
      <div><small>Cover</small><b>${q1.calc.total.cover != null ? `${U.fmt(q1.calc.total.cover, true)} din` : '—'}</b></div>
      <div class="ms-growth"><small>Growth % <em>${p1 && p1.basis && p1.basis.shortLabel ? `till ${esc(p1.basis.shortLabel)}` : ''}</em></small><b>${p1 && p1.num !== null && p1.num !== undefined && Number.isFinite(p1.num) ? U.pctHtml(p1.num, { decimals: 0 }) : `<span class=\"dim\">—</span>`}</b></div>
      <div><small>Expected month-end</small><b>${p1 ? U.fmt(p1.total) : '—'}</b></div>
    </div>`;
  }
  const SR = () => (FF.searchReport && FF.searchReport.groupPeople ? FF.searchReport : null);
  /** Agent search par usi channel ka TL resolve karo — naam preferred, dono GV Master TL IDs fall back. */
  function linkedTlFor(agent) {
    const idx = state.full || state.light;
    if (!idx || !agent || !/-agent$/.test(String(agent.kind || '')) || agent.direct) return null;
    const channel = String(agent.kind).startsWith('gv') ? 'gv' : 'ff';
    const tlKind = `${channel}-tl`;
    const tls = [...idx.people.values()].filter((p) => p.kind === tlKind);
    const names = [...(agent.tlSet || [])].filter((name) => clean(name) && FF.config.isRealTl(clean(name))).reverse();
    for (const name of names) {
      const hit = tls.find((tl) => normName(tl.name) === normName(name));
      if (hit) return hit;
    }
    const ids = new Set([...(agent.tlIds || [])].map(normId).filter(Boolean));
    if (!ids.size) return null;
    return tls.find((tl) => [tl.sub, ...((tl.ids && [...tl.ids]) || []), ...((tl.alias && [...tl.alias]) || [])]
      .some((id) => ids.has(normId(id)))) || null;
  }
  /** Per-agent search me TL ka poora team profile bhi kholna: all agents + TL self stock/issuance. */
  function teamPeopleFor(group) {
    const out = [], sr = SR();
    for (const ch of ['ff', 'gv']) {
      const agent = group && group[ch];
      if (!agent || /-tl$/.test(String(agent.kind || ''))) continue;
      const tl = linkedTlFor(agent);
      if (!tl) continue;
      const teamGroup = sr && sr.groupPeople ? sr.groupPeople([tl])[0] : null;
      out.push({ channel: ch, person: tl, group: teamGroup || {
        key: normName(tl.name), name: tl.name, ff: ch === 'ff' ? tl : null, gv: ch === 'gv' ? tl : null
      } });
    }
    return out;
  }
  let lastPeople = [];   // abhi dikh rahe result ke log (card ke inline report ko same-naam FF + GV jodne ke liye)
  /** v3.41 — Ek hi insaan (same naam, FF + GV dono) match ho to poori report inline khol do: upar channel toggle
   *  (⚖ FF + GV · 🟦 FF · 🟩 GV). Pehle sirf EXACTLY ek person par khulti thi — FF + GV dono me naam ho to 2 card
   *  aate the aur kuch khulta hi nahi tha. */
  function inlineSingle(container, res) {
    try {
      if (!container || !MP() || !res || res.tags.length || !res.people.length) return;
      const sr = SR();
      const groups = sr ? sr.groupPeople(res.people) : [];
      const single = sr ? groups.length === 1 : (res.people.length === 1 && MP().supports(res.people[0]));
      if (!single) return;
      const first = container.querySelector && container.querySelector('.ms-section');
      if (!first || !first.insertAdjacentHTML) return;
      first.insertAdjacentHTML('beforebegin', '<section class="ms-section ms-profile-inline"><h3>📊 Poori report</h3><div class="ms-profile-slot"></div></section>');
      const slot = container.querySelector('.ms-profile-inline .ms-profile-slot');
      if (!slot) return;
      if (sr) sr.render(slot, groups[0]);
      else MP().renderInto(slot, res.people[0]);
    } catch { /* ignore */ }
  }
  /** Kai log match hon to card ke neeche usi ka inline report (same FF + GV toggle) — "📂 Yahin poori report". */
  function toggleCardInline(btn) {
    const sr = SR();
    if (!sr || !btn) return;
    const person = personByKey(btn.dataset.msInline);
    const card = btn.closest('.ms-kundli');
    if (!person || !card) return;
    const next = card.nextElementSibling;
    if (next && next.classList && next.classList.contains('ms-card-inline')) { next.remove(); btn.classList.remove('active'); btn.textContent = '📂 Yahin poori report'; return; }
    const group = sr.groupPeople(lastPeople.filter((p) => normName(p.name) === normName(person.name)))[0] || sr.groupPeople([person])[0];
    if (!group) return;
    card.insertAdjacentHTML('afterend', '<div class="ms-card-inline"><div class="ms-profile-slot"></div></div>');
    sr.render(card.nextElementSibling.querySelector('.ms-profile-slot'), group);
    btn.classList.add('active'); btn.textContent = '🔽 Report band karo';
  }
  function personKundli(p) {
    const tl = p.direct ? (p.directLabel || 'Direct Agent') : [...p.tlSet].slice(0, 4).map((n) => tlText(n, p.kind === 'gv-agent' ? 'gv' : 'ff')).join(', ');
    const row = MP() && MP().reportDataRow ? MP().reportDataRow(p) : null;   // REPORT tab ke same numbers
    const strip = row ? `<div class="ms-data-strip">
      <div class="dcell stock" data-kpi="${esc(`src=${row.ch}&scope=stock&${row.isTl ? `tl=${encodeURIComponent(row.name)}${row.id ? `&tlId=${encodeURIComponent(row.id)}` : ''}` : `agent=${encodeURIComponent(row.name)}${row.id ? `&agentId=${encodeURIComponent(row.id)}` : ''}`}`)}" role="button" tabindex="0" title="Stock ki detail">
        <small>📦 ${row.isTl ? 'TL Stock · own + agents' : 'Agent Stock'}</small><b>${U.fmt(row.stock)}</b><em>VC4 ${U.fmt(row.stockVc4)} · Comm ${U.fmt(row.stockComm)}${row.isTl && row.ownStock != null ? ` · own ${U.fmt(row.ownStock)} + agents ${U.fmt(row.agentsStock || 0)}` : ''}</em></div>
      <div class="dcell cur" data-kpi="${esc(`src=${row.ch}&scope=mtd&ym=${encodeURIComponent(row.curYm || '')}&${row.isTl ? `tl=${encodeURIComponent(row.name)}${row.id ? `&tlId=${encodeURIComponent(row.id)}` : ''}` : `agent=${encodeURIComponent(row.name)}${row.id ? `&agentId=${encodeURIComponent(row.id)}` : ''}`}`)}" role="button" tabindex="0" title="Total issuance ki detail">
        <small>🏷️ Total Issuance${row.isTl ? ' · TL + agents' : ' · MTD'}</small><b>${U.fmt(row.cur)}</b><em>VC4 ${U.fmt(row.curVc4)} · Comm ${U.fmt(row.curComm)}</em></div>
      <div class="dcell last" data-kpi="${esc(`src=${row.ch}&scope=month&ym=${encodeURIComponent(row.lastYm || '')}&${row.isTl ? `tl=${encodeURIComponent(row.name)}${row.id ? `&tlId=${encodeURIComponent(row.id)}` : ''}` : `agent=${encodeURIComponent(row.name)}${row.id ? `&agentId=${encodeURIComponent(row.id)}` : ''}`}`)}" role="button" tabindex="0" title="Last month issuance ki detail">
        <small>📅 Last Month</small><b>${U.fmt(row.last)}</b><em>VC4 ${U.fmt(row.lastVc4)} · Comm ${U.fmt(row.lastComm)}</em></div>
      <div class="dcell grow"><small>📈 Growth</small><b>${U.pctHtml(row.growth, { decimals: 0 })}</b><em>last vs MTD</em></div>
    </div>` : '';
    return `<article class="ms-kundli v2" data-ms-person="${esc(`${p.kind}|${normName(p.name)}`)}">
      <div class="ms-kundli-head">
        <span class="ms-avatar ${p.kind.startsWith('gv') ? 'gv' : 'ff'}">${esc(p.name.slice(0, 1).toUpperCase())}</span>
        <div class="ms-kundli-id">
          <b>${esc(p.name)}</b>
          <small><span class="badge ${p.kind.startsWith('gv') ? 'green' : 'blue'}">${p.kind.startsWith('gv') ? '🟩 GV Partner' : '🟦 First Forward'}</span> <span class="badge ${/tl$/.test(p.kind) ? 'purple' : 'blue'}">${esc(KIND_LABEL[p.kind] || p.kind)}</span>${p.sub ? ` · ID <b class="mono">${esc(p.sub)}</b>` : ''}${GVC.chip(p)}</small>
        </div>
      </div>
      ${strip}
      ${row && row.issuance && MP() && MP().issuanceCardsHtml ? MP().issuanceCardsHtml(row.issuance) : ''}
      <div class="ms-kundli-stats">
        <div><small>TL</small><b>${p.direct ? `<span class="direct-chip">🚫 ${esc(tl)}</span>` : (row && row.tlName && !p.direct ? `<button type="button" class="mp-link-btn" data-ms-open-tl="1" data-ms-tl-name="${esc(row.tlName)}" data-ms-tl-id="${esc(row.tlId || '')}" data-ms-tl-ch="${esc(row.ch || (p.kind.startsWith('gv') ? 'gv' : 'ff'))}">${esc(row.tlName)}</button>` : esc(tl || '—'))}</b>${row && row.tlId && !p.direct ? `<em>${esc(row.tlId)}</em>` : ''}</div>
        <div><small>Tags / barcodes</small><b>${p.bars.size ? U.fmt(p.bars.size) : U.fmt(p.n)}</b></div>
        <div><small>Activity rows</small><b>${U.fmt(p.n)}</b></div>
        <div><small>Last allocation</small><b>${esc(p.last || '—')}</b></div>
      </div>
      ${kundliProfileStats(p)}
      <div class="ms-pill-row">${classPills(p.classMap)}</div>
      <div class="ms-kundli-actions">
        ${MP() && SR() && MP().supports(p) ? `<button class="btn small primary" data-ms-inline="${esc(personKey(p))}">📂 Yahin poori report</button>` : ''}
        ${MP() && MP().supports(p) ? `<button class="btn small${SR() ? '' : ' primary'}" data-ms-profile="${esc(personKey(p))}">📊 Poori report${SR() ? ' (drawer)' : ''}</button>` : ''}
        ${p.kind.includes('agent') ? `<button class="btn small" data-ms-agent360="${esc(p.name)}">👁 Agent 360</button>` : ''}
        <button class="btn small" data-ms-tags="${esc(p.name)}">🏷️ Tags</button>
      </div>
    </article>`;
  }

  /* 📒 Dispatch date / naam — IDFC Stock Sheet + GV Stock Sheet ranges (server expand). Async fill, cache per barcode. */
  const dispCache = new Map();
  const bcKey = (b) => String(b || '').replace(/\D/g, '').replace(/^0+/, '');
  function dispText(hit) {
    if (!hit) return { date: '—', name: '—', title: '' };
    const parts = [];
    ['ff', 'gv'].forEach((ch) => (hit[ch] || []).slice(0, 1).forEach((e) => parts.push({ ch, e, more: (hit[ch + 'Count'] || 1) - 1 })));
    if (!parts.length) return { date: '—', name: '—', title: '' };
    const two = parts.length > 1;
    const dl = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? U.labelDateKey(iso, true) : (iso || '—'));
    return {
      date: parts.map((x) => `${two ? x.ch.toUpperCase() + ' ' : ''}${dl(x.e.date)}`).join(' | '),
      name: parts.map((x) => `${two ? x.ch.toUpperCase() + ' · ' : ''}${x.e.agent || '—'}${x.e.agentId ? ` (${x.e.agentId})` : ''}${x.e.approx ? ' ~' : ''}${x.more > 0 ? ` +${x.more}` : ''}`).join(' | '),
      title: parts.map((x) => `${x.ch.toUpperCase()}: ${x.e.first} → ${x.e.last} · ${x.e.src || ''}${x.e.row ? ` · row ${x.e.row}` : ""}${x.e.approx ? ' (approx range)' : ''}`).join('\n')
    };
  }
  function dispCellsHtml(key) {
    const k = bcKey(key), d = dispCache.has(k) ? dispText(dispCache.get(k)) : null;
    return `<td data-ms-disp="${esc(k)}" data-f="date" style="white-space:nowrap"${d && d.title ? ` title="${esc(d.title)}"` : ''}>${d ? esc(d.date) : '<span class="dim">🔎 searching…</span>'}</td><td data-ms-disp="${esc(k)}" data-f="name"${d && d.title ? ` title="${esc(d.title)}"` : ''}>${d ? esc(d.name) : '<span class="dim">🔎 searching…</span>'}</td>`;
  }
  async function loadDispatch(keys) {
    const need = [...new Set((keys || []).map(bcKey).filter((k) => k && !dispCache.has(k)))];
    if (!need.length || !FF.data || !FF.data.dispatchLookup) return null;
    const { map, meta } = await FF.data.dispatchLookup(need);
    need.forEach((k) => dispCache.set(k, map.get(k) || null));
    return meta;
  }
  async function fillDispatch(root, res) {
    if (!root || !res || !(res.tags || []).length) return;
    try {
      const meta = await loadDispatch(res.tags.slice(0, 60).map((t) => t.key));
      const first = root.querySelector('td[data-ms-disp]');
      const wrapEl = first && first.closest('.table-wrap');
      if (wrapEl && meta) {
        const errs = Object.values(meta.errors || {}), srcs = (meta.sources || []).map((s) => `${s.ok ? '✅' : '❌'} ${esc(s.label)}`).join(' · ');
        const old = wrapEl.previousElementSibling; if (old && old.classList.contains('ms-disp-note')) old.remove();
        if (errs.length) wrapEl.insertAdjacentHTML('beforebegin', `<p class="dim small ms-disp-note">⚠️ Dispatch ledger — ${srcs ? srcs + ' · ' : ''}${errs.map(esc).join(' · ')}</p>`);
      }
      root.querySelectorAll('td[data-ms-disp]').forEach((td) => {
        const d = dispText(dispCache.get(td.dataset.msDisp));
        td.textContent = td.dataset.f === 'date' ? d.date : d.name;
        if (d.title) td.title = d.title;
      });
    } catch (err) {
      root.querySelectorAll('td[data-ms-disp] .dim').forEach((sp) => { sp.textContent = '⚠'; sp.title = String((err && err.message) || err); });
    }
  }

  function resultsHtml(res) {
    if (!res.matched) {
      return `<div class="ms-empty"><b>“${esc(res.q)}” ke liye kuch nahi mila</b>
        <p>Naam, TL, agent ID, TL ID, GV ID, barcode ya tag ID se search karo. Spelling ya ID ke kuch digits bhi kaafi hain.</p>
        ${res.heavy ? '' : (res.livePending ? '<p class="dim small">Barcode sheet me live dhoondh raha hu… (2-10 sec)</p>' : '<p class="dim small">Barcode / tag register abhi background me load ho raha hai — barcode ke 4+ digits likho, live search chalega.</p>')}</div>`;
    }
    lastPeople = res.people || [];
    const parts = [];
    if (res.people.length) {
      const rows = MP() && MP().reportDataRow ? res.people.slice(0, 60).map((p) => MP().reportDataRow(p)) : [];
      const table = rows.length ? `<section class="ms-section ms-data-section">
        <h3>📊 REPORT data — ek nazar me <span class="dim small">FF → REPORT tab · GV → GV REPORT tab · Summary pages ke same numbers</span></h3>
        <p class="dim small ms-data-note">Har row: <b>Agent · TL · 📦 Stock · 🏷️ Total Issuance · 📅 Last Month</b> — TL rows me stock/issuance = <b>own + agents</b> (rollup). Number par click → detail drawer · row par click → poori report 👇</p>
        ${MP().peopleTableHtml(rows, { id: 'ms-home-data', footer: true, limit: 25, sourceNote: 'Source: FF REPORT / GV REPORT' })}
      </section>` : '';
      parts.push(`${table}<section class="ms-section"><h3>🧑‍💼 Agents & TLs — poori kundli <span class="dim small">${U.fmt(res.people.length)} match</span></h3>
        <div class="ms-kundli-grid">${res.people.slice(0, 24).map(personKundli).join('')}</div></section>`);
    }
    if (res.tags.length) {
      parts.push(`<section class="ms-section"><h3>🏷️ Tags / barcodes <span class="dim small">${U.fmt(res.tags.length)} match</span></h3>
        <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Barcode / serial</th><th>Tag ID</th><th>FF holder</th><th>FF TL</th><th>FF mapping</th><th>GV holder</th><th>GV TL</th><th>GV unique</th><th>GV mapping</th><th>Class</th><th>Allocated</th><th>Dispatch date</th><th>Dispatched to</th></tr></thead><tbody>
        ${res.tags.slice(0, 60).map((t) => {
        const f = t.ff[0] || {}, g = t.gv[0] || {};
        const st = tagStatus(t);
        return `<tr><td class="ms-barcode-cell" style="white-space:nowrap"><b>${esc(U.barcode(t.key))}</b></td><td>${esc((f.tagId || g.tagId) || '—')}</td>
            <td>${esc(f.agentName || '—')}${f.agentId ? `<small>${esc(f.agentId)}</small>` : ''}</td><td>${esc(tlText(f.tlName, 'ff') || '—')}</td>
            <td><span class="badge ${st.ff.tone}">${esc(st.ff.text)}</span></td>
            <td>${esc(g.agentName || '—')}${g.agentId ? `<small>${esc(g.agentId)}</small>` : ''}</td><td>${esc(tlText(g.tlName, 'gv') || '—')}</td>
            <td>${esc(g.gvName || '—')}${g.gvId ? `<small>${esc(g.gvId)}</small>` : ''}</td><td><span class="badge ${st.gv.tone}">${esc(st.gv.text)}</span></td>
            <td>${esc(f.cls || g.cls || '—')}</td><td>${esc(f.allocated || g.allocated || '—')}</td>${dispCellsHtml(t.key)}</tr>`;
      }).join('')}
        </tbody></table></div>${res.tags.length > 60 ? `<p class="dim small">Pehle 60 rows dikhe — CSV me poori list.</p>` : ''}</section>`);
    }
    if (res.ids.length) {
      parts.push(`<section class="ms-section"><h3>🆔 ID matches <span class="dim small">${U.fmt(res.ids.length)}</span></h3>
        <div class="table-wrap"><table class="tbl compact"><thead><tr><th>ID</th><th>Naam</th><th>Role</th><th>TL</th><th></th></tr></thead><tbody>
        ${res.ids.slice(0, 40).map((v) => `<tr><td><b>${esc(v.id)}</b></td><td>${esc(v.name || '—')}</td><td>${esc(KIND_LABEL[v.kind] || v.kind)}${v.via ? ` <small class="dim">· ${esc(v.via)}</small>` : ''}</td><td>${esc(tlText(v.tl, v.kind && v.kind.startsWith('gv') ? 'gv' : 'ff') || '—')}</td><td><button class="btn tiny" data-ms-again="${esc(v.name || v.id)}">🔎 Kholo</button></td></tr>`).join('')}
        </tbody></table></div></section>`);
    }
    return parts.join('');
  }

  function openPanel(q, opts) {
    closePanel();
    const res = typeof q === 'object' && q !== null ? q : search(q);
    const o = opts || {};
    const wrap = U.h(`<div class="ms-panel" id="ms-panel" role="dialog" aria-modal="true" aria-label="Master search results">
      <div class="ms-panel-backdrop" data-ms-close></div>
      <div class="ms-panel-box">
        <div class="ms-panel-head">
          <div><span class="ms-panel-kicker">🔎 Master search</span><h2>${esc(/^\d{12,20}$/.test(clean(res.q)) ? U.barcode(res.q) : (res.q || o.title || 'Results'))}</h2>
            <small class="dim">${U.fmt(res.matched)} match · ${res.heavy ? 'barcode register ready ✓' : (res.livePending ? 'barcode live search…' : 'barcode register loading… (live search on)')}</small></div>
          <div class="btn-row">
            <button class="btn small" data-ms-csv>⬇ CSV</button>
            <button class="btn small" data-ms-pdf>📄 PDF</button>
            <button class="btn small" data-ms-close>✕ Close</button>
          </div>
        </div>
        <div class="ms-panel-body">${resultsHtml(res)}</div>
      </div>
    </div>`);
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    if (FF.app && FF.app.enhanceTables) FF.app.enhanceTables(wrap);
    inlineSingle(wrap.querySelector('.ms-panel-body'), res);
    fillDispatch(wrap.querySelector('.ms-panel-body'), res);
    const box = wrap.querySelector('.ms-panel-box');
    wrap.addEventListener('click', async (e) => {
      if (e.target.closest('[data-ms-close]')) { closePanel(); return; }
      if (e.target.closest('[data-mp-agent]')) { closePanel(); return; }
      if (e.target.closest('[data-kpi]')) { closePanel(); return; }
      const inl = e.target.closest('[data-ms-inline]');
      if (inl) { toggleCardInline(inl); return; }
      const prof = e.target.closest('[data-ms-profile]');
      if (prof) { const person = personByKey(prof.dataset.msProfile); if (person && MP()) { closePanel(); MP().open(person); } return; }
      const a = e.target.closest('[data-ms-agent360]');
      if (a) { closePanel(); if (FF.cockpit && FF.cockpit.agent360) FF.cockpit.agent360({ name: a.dataset.msAgent360 }).catch(() => {}); return; }
      const t = e.target.closest('[data-ms-tags]');
      if (t) { const name = t.dataset.msTags; closePanel(); FF.app.navigate('masterStock', { q: name }); return; }
      const again = e.target.closest('[data-ms-again]');
      if (again) { const nq = again.dataset.msAgain; closePanel(); const input = U.$('#master-search-input'); if (input) input.value = nq; openPanel(nq); return; }
      const csv = e.target.closest('[data-ms-csv]');
      if (csv) {
        if ((res.tags || []).length) { try { await loadDispatch(res.tags.map((t) => t.key)); } catch { /* CSV bina dispatch columns ke bhi chalegi */ } }
        const rows = [];
        res.tags.forEach((tt) => { const f = tt.ff[0] || {}, g = tt.gv[0] || {}; const st = tagStatus(tt); const d = dispText(dispCache.get(bcKey(tt.key))); rows.push(['Tag', U.barcode(tt.key), f.agentName || '', f.tlName || '', g.agentName || '', g.tlName || '', g.gvName || '', f.cls || g.cls || '', st.t, f.allocated || g.allocated || '', 1, d.date === '—' ? '' : d.date, d.name === '—' ? '' : d.name]); });
        res.people.forEach((p) => rows.push(['Person', p.name, KIND_LABEL[p.kind] || p.kind, [...p.tlSet].join(' / '), p.sub || '', '', '', [...p.classMap.keys()].join(' '), '', p.last || '', p.bars.size || p.n || 0, '', '']));
        res.ids.forEach((v) => rows.push(['ID', v.id, v.name || '', KIND_LABEL[v.kind] || v.kind, v.tl || '', '', '', '', '', '', 1, '', '']));
        const totCount = U.sum(rows, (r) => Number(r[10]) || 0);
        rows.push(['Grand Total', `${rows.length} matches`, '', '', '', '', '', '', '', '', totCount, '', '']);
        U.downloadCsv(`master-search-${U.slug(res.q || 'results')}-${U.stamp()}.csv`,
          ['Type', 'Key / Name', 'FF or Agent', 'TL / Role', 'GV holder / ID', 'GV TL', 'GV unique', 'Class', 'Status', 'Allocated / Last', 'Count', 'Dispatch date', 'Dispatched to'], rows);
        return;
      }
      const pdfBtn = e.target.closest('[data-ms-pdf]');
      if (pdfBtn) {
        const pdfName = `master-search-${U.slug(res.q || 'results')}-${U.stamp()}.pdf`;
        if (U.downloadStart) U.downloadStart(pdfName, 'Preparing PDF…');
        if (U.downloadYield) await U.downloadYield();
        try {
          if (!FF.pdf && FF.lazy && FF.lazy.need) await FF.lazy.need('pdf');
          if (!FF.pdf || !FF.pdf.doc) throw new Error('PDF module load nahi hua');
          U.setButtonBusy(pdfBtn, true, 'PDF…');
          const rows = [];
          res.tags.forEach((tt) => { const f = tt.ff[0] || {}, g = tt.gv[0] || {}; const st = tagStatus(tt); rows.push(['Tag', U.barcode(tt.key), f.agentName || g.agentName || '', f.tlName || g.tlName || '', f.cls || g.cls || '', st.t, 1]); });
          res.people.forEach((p) => rows.push(['Person', p.name, KIND_LABEL[p.kind] || p.kind, [...p.tlSet].join(' / '), [...p.classMap.keys()].join(' '), p.last || '', p.bars.size || p.n || 0]));
          res.ids.forEach((v) => rows.push(['ID', v.id, v.name || '', KIND_LABEL[v.kind] || v.kind, v.tl || '', '', 1]));
          const totCount = U.sum(rows, (r) => Number(r[6]) || 0);
          const tblHtml = `<table style="width:100%;border-collapse:collapse;font-size:10.5px"><thead><tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:5px">Type</th><th style="border:1px solid #cbd5e1;padding:5px">Key / Name</th><th style="border:1px solid #cbd5e1;padding:5px">Role / Holder</th><th style="border:1px solid #cbd5e1;padding:5px">TL</th><th style="border:1px solid #cbd5e1;padding:5px">Class</th><th style="border:1px solid #cbd5e1;padding:5px">Status / Last</th><th style="border:1px solid #cbd5e1;padding:5px;text-align:right">Count</th></tr></thead><tbody>${rows.slice(0, 120).map((r) => `<tr>${r.map((c, i) => `<td style="border:1px solid #e2e8f0;padding:4px 6px;${i === 6 ? 'text-align:right;font-weight:700' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}<tr style="background:#eef2ff;font-weight:800"><td colspan="6" style="border:1px solid #cbd5e1;padding:5px 6px">Grand Total (${rows.length} matches)</td><td style="border:1px solid #cbd5e1;padding:5px 6px;text-align:right">${U.fmt(totCount)}</td></tr></tbody></table>`;
          const page = FF.pdf.doc({ title: `Master Search · ${res.q || 'Results'}`, sub: `${U.fmt(res.matched)} matches`, meta: new Date().toLocaleString('en-IN'), body: tblHtml });
          await FF.pdf.download([page], pdfName);
          U.toast('Master search PDF downloaded ✓', 'ok');
        } catch (err) {
          if (U.downloadFail) U.downloadFail(pdfName, (err && err.message) || 'Master Search PDF failed');
          throw err;
        } finally {
          U.setButtonBusy(pdfBtn, false);
        }
        return;
      }
      if (!e.target.closest('.ms-panel-box')) closePanel();
    });
    // ESC closes (only while this panel is on top)
    const onKey = (ev) => { if (ev.key === 'Escape') { closePanel(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    box.addEventListener('ms:closed', () => document.removeEventListener('keydown', onKey));
    return res;
  }
  function closePanel() {
    const el = U.$('#ms-panel');
    if (el) { el.dispatchEvent(new Event('ms:closed')); el.remove(); }
    if (!U.$('.drawer.open') && !U.$('.palette-backdrop:not([hidden])')) document.body.classList.remove('no-scroll');
  }

  // ---------------------------------------------------------------- topbar search bar
  let suggestApi = null;
  let mountedTopbar = false;
  /** 🔎 Naya flow (v3.46): naam / ID search → seedha Management → **Master Search page**,
   *  jahan click karte hi uska poora related data (FF + GV) khul jaata hai — koi results list / modal box nahi.
   *  Barcode / tag-ID searches purane panel (tag-level rows) me hi jaate hain. */
  function openSearchPage(q, person) {
    if (!person && FF.aliases) q = FF.aliases.map(q);   // Assistant / Agent ID (Sheet4) → New ID
    const p = person || {};
    // A selected suggestion is authoritative: route using the selected person's canonical name,
    // not the stale/free-typed query text. This prevents URL q=one-name + id=another-person mismatches.
    const name = clean(p.name || q);
    if (name.length < 2) { U.toast('Kam se kam 2 letter / digit type karo', 'warn'); return false; }
    const kind = clean(p.kind);
    const id = clean(p.id || p.sub);
    const ch = /^gv-/i.test(kind) ? 'gv' : /^ff-/i.test(kind) ? 'ff' : '';
    state.lastQuery = name;
    const params = { q: name };
    if (id) params.id = id;
    if (ch) params.ch = ch;
    // Canonical route: every topbar / Master Search selection opens the same Master Search renderer.
    try { if (FF.app && FF.app.navigate) { FF.app.navigate('masterSearch', params); return true; } } catch {}
    try { const extra = `${id ? `&id=${encodeURIComponent(id)}` : ''}${ch ? `&ch=${encodeURIComponent(ch)}` : ''}`; location.hash = `#/masterSearch?q=${encodeURIComponent(name)}${extra}`; return true; } catch { return false; }
  }

  function mountTopbar(force) {
    // Access gate: bina 'masterSearch' permission ke top-bar search dikhna hi nahi chahiye.
    if (!(FF.auth && typeof FF.auth.can === 'function' && FF.auth.can('masterSearch'))) {
      const stale = document.getElementById('master-search');
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
      mountedTopbar = false;
      return false;
    }
    if (force === true) mountedTopbar = false;
    const actions = U.$('#top-actions');
    // Guard: dobara mount na ho (querySelector par bharosa nahi — DOM shim/iframe me naya element
    // bhi mil sakta hai, isliye innerHTML + module flag dono check karte hain).
    if (!actions || mountedTopbar || /master-search/.test(String(actions.innerHTML || ''))) return false;
    mountedTopbar = true;
    const wrap = U.h(`<div class="master-search" id="master-search">
      <div class="master-search-row">
        <div class="master-search-input">
          <span class="ms-ico" aria-hidden="true">🔎</span>
          <input id="master-search-input" class="input" type="search" placeholder="Search agent, TL, ID, barcode…" autocomplete="off"
            aria-label="Global search across First Forward and GV agents, TLs, IDs, barcodes and tag IDs">
          <button class="ms-clear" id="master-search-clear" type="button" title="Search clear karo" aria-label="Search clear karo" hidden>✕</button>
          <kbd class="ms-kbd">/</kbd>
        </div>
        <button class="ms-range-btn" id="master-search-range" type="button" title="📅 Date range (from → to) report kholo" aria-label="Date range search">📅</button>
      </div>
      <div class="ms-range-pop" id="ms-range-pop" hidden>
        <b>📅 Range report — from se to tak</b>
        <div class="ms-range-inputs">
          <label>From <input class="input" type="date" id="ms-range-from"></label>
          <label>To <input class="input" type="date" id="ms-range-to"></label>
        </div>
        <div class="ms-range-chips" id="ms-range-chips"></div>
        <div class="ms-range-actions">
          <button class="btn small primary" id="ms-range-go">📊 Report kholo</button>
          <button class="btn small" id="ms-range-cancel">✕</button>
        </div>
      </div>
      <div class="ms-hint" id="master-search-hint" hidden></div>
    </div>`);
    // Pehle slot me lagao (title ke turant baad) — insertBefore na ho to prepend/appendChild.
    if (typeof actions.insertBefore === 'function' && actions.firstChild !== undefined) actions.insertBefore(wrap, actions.firstChild);
    else if (typeof actions.prepend === 'function') actions.prepend(wrap);
    else actions.appendChild(wrap);
    const input = U.$('#master-search-input', wrap);
    const hint = U.$('#master-search-hint', wrap);
    warmFull();
    suggestApi = U.suggest(input, {
      min: 1, max: 16,
      items: () => suggestItems(input.value),
      onPick: (it) => {
        // Hard cleanup + suspend current instance so no async refresh can reopen the dropdown.
        try { if (suggestApi && suggestApi.suspend) suggestApi.suspend(); } catch {}
        try { if (suggestApi && suggestApi.close) suggestApi.close(); } catch {}
        if (it.none) return;
        try { remember(it.label || (it.person && it.person.name) || it.barcode); } catch { /* optional */ }
        if (it.barcode) { openPanel(it.barcode); return; }              // 🏷️ barcode/tag = tag-level rows (list yahan theek)
        if (it.person && it.person.name) { openSearchPage(it.person.name, it.person); return; }
        openSearchPage(it.label);
      },
      onEnter: (q) => {
        try { if (suggestApi && suggestApi.suspend) suggestApi.suspend(); } catch {}
        try { if (suggestApi && suggestApi.close) suggestApi.close(); } catch {}
        if (clean(q).length >= 2) { try { remember(q); } catch { /* optional */ } openSearchPage(q); }
      }
    });
    // 🕘⭐ Recent + pinned searches — shown when the box is focused and empty (this device only).
    const RKEY = 'ff_ms_recent';
    const readR = () => { try { const a = JSON.parse(localStorage.getItem(RKEY) || '[]'); return Array.isArray(a) ? a.filter((x) => x && x.label) : []; } catch { return []; } };
    const writeR = (a) => { try { localStorage.setItem(RKEY, JSON.stringify(a.slice(0, 40))); } catch { /* private mode */ } };
    const remember = (label) => {
      label = clean(label); if (label.length < 2) return;
      const a = readR(); const i = a.findIndex((x) => x.label.toLowerCase() === label.toLowerCase());
      const pinned = i >= 0 && a[i].pinned; if (i >= 0) a.splice(i, 1);
      a.unshift({ label, pinned: !!pinned, at: Date.now() });
      const keep = a.filter((x) => x.pinned).concat(a.filter((x) => !x.pinned).slice(0, 8));
      writeR(keep);
    };
    remember.read = readR; remember.write = writeR;
    mountTopbar.remember = remember;
    const panel = U.h('<div class="ms-recent" id="master-search-recent" hidden></div>');
    wrap.appendChild(panel);
    const chips = U.h('<div class="ms-chips" id="master-search-chips" role="group" aria-label="Search filter" hidden></div>');
    wrap.appendChild(chips);
    const paintChips = () => { chips.innerHTML = CHIP_FILTERS.map(([k, l]) => `<button type="button" class="ms-chip${chipFilter === k ? ' on' : ''}" data-ms-chip="${k}" aria-pressed="${chipFilter === k}">${l}</button>`).join(''); };
    paintChips();
    input.addEventListener('focus', () => { chips.hidden = false; });
    document.addEventListener('mousedown', (e) => { if (!chips.hidden && !wrap.contains(e.target)) chips.hidden = true; });
    chips.addEventListener('mousedown', (e) => e.preventDefault());
    chips.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-ms-chip]'); if (!b) return;
      chipFilter = b.dataset.msChip; paintChips();
      try { if (suggestApi && suggestApi.refresh && clean(input.value).length >= 1) suggestApi.refresh(); } catch { /* ignore */ }
      input.focus();
    });
    const paintRecent = () => {
      const a = readR();
      const pinned = a.filter((x) => x.pinned), recent = a.filter((x) => !x.pinned).slice(0, 6);
      if (!pinned.length && !recent.length) { panel.hidden = true; return; }
      const row = (x) => `<div class="ms-recent-row"><button type="button" class="ms-recent-go" data-ms-go="${esc(x.label)}">${x.pinned ? '⭐' : '🕘'} ${esc(x.label)}</button><button type="button" class="ms-recent-pin" data-ms-pin="${esc(x.label)}" title="${x.pinned ? 'Pin hatao' : 'Pin karo'}">${x.pinned ? '★' : '☆'}</button></div>`;
      panel.innerHTML = (pinned.length ? '<div class="ms-recent-h">Pinned</div>' + pinned.map(row).join('') : '') + (recent.length ? '<div class="ms-recent-h">Recent</div>' + recent.map(row).join('') : '');
      panel.hidden = false;
    };
    input.addEventListener('focus', () => { if (!clean(input.value)) paintRecent(); });
    input.addEventListener('input', () => { panel.hidden = true; });
    document.addEventListener('mousedown', (e) => { if (!panel.hidden && !wrap.contains(e.target)) panel.hidden = true; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.hidden = true; });
    panel.addEventListener('mousedown', (e) => e.preventDefault()); // input ka focus na jaye
    panel.addEventListener('click', (e) => {
      const go = e.target.closest && e.target.closest('[data-ms-go]');
      const pin = e.target.closest && e.target.closest('[data-ms-pin]');
      if (pin) { const a = readR(); const it = a.find((x) => x.label === pin.dataset.msPin); if (it) { it.pinned = !it.pinned; writeR(a); paintRecent(); } return; }
      if (go) { panel.hidden = true; input.value = go.dataset.msGo; remember(go.dataset.msGo); openSearchPage(go.dataset.msGo); }
    });
    // Index / data ready hote hi khula dropdown refresh — warna "search ho raha hai…" placeholder agli key tak atka rehta tha.
    let refreshTimer = 0;
    onIndexReady(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        try { if (suggestApi && suggestApi.refresh && input.isConnected && document.activeElement === input && clean(input.value).length >= 2) suggestApi.refresh(); } catch { /* ignore */ }
      }, 150);
    });
    // ✕ Clear button — input khali karo, suggestions band, wapas focus
    const clearBtn = U.$('#master-search-clear', wrap);
    const syncClear = () => { if (clearBtn) clearBtn.hidden = !input.value; };
    input.addEventListener('input', syncClear);
    if (clearBtn) clearBtn.addEventListener('click', () => {
      input.value = '';
      syncClear();
      if (suggestApi && suggestApi.close) suggestApi.close();
      input.focus();
    });
    syncClear();
    // 📅 Date-range (from → to) popover — Range Report kholta hai
    const rangeBtn = U.$('#master-search-range', wrap);
    const pop = U.$('#ms-range-pop', wrap);
    if (rangeBtn && pop) {
      const dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const today = new Date();
      const back = (days) => { const d = new Date(today); d.setDate(d.getDate() - days + 1); return dk(d); };
      const presets = [
        { label: 'Aaj', from: dk(today), to: dk(today) },
        { label: 'Last 7 din', from: back(7), to: dk(today) },
        { label: 'Is mahine', from: dk(new Date(today.getFullYear(), today.getMonth(), 1)), to: dk(today) },
        { label: 'Pichla mahina', from: dk(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: dk(new Date(today.getFullYear(), today.getMonth(), 0)) },
        { label: 'Last 30 din', from: back(30), to: dk(today) }
      ];
      const chipsBox = U.$('#ms-range-chips', pop);
      const fromI = U.$('#ms-range-from', pop), toI = U.$('#ms-range-to', pop);
      if (chipsBox) chipsBox.innerHTML = presets.map((p) => `<button class="chip" data-msr-from="${p.from}" data-msr-to="${p.to}">${p.label}</button>`).join('');
      const openPop = () => {
        if (!fromI.value) fromI.value = dk(new Date(today.getFullYear(), today.getMonth(), 1));
        if (!toI.value) toI.value = dk(today);
        pop.hidden = false;
      };
      rangeBtn.addEventListener('click', (e) => { e.stopPropagation(); if (pop.hidden) openPop(); else pop.hidden = true; });
      pop.addEventListener('click', (e) => {
        e.stopPropagation();
        const chip = e.target.closest('[data-msr-from]');
        if (chip) { fromI.value = chip.dataset.msrFrom; toI.value = chip.dataset.msrTo; return; }
        if (e.target.closest('#ms-range-go')) {
          let f = fromI.value, t = toI.value;
          if (!f || !t) { U.toast('From aur To dono dates chuno', 'warn'); return; }
          if (f > t) { const x = f; f = t; t = x; }
          pop.hidden = true;
          if (FF.app && FF.app.navigate) FF.app.navigate('rangeReport', { from: f, to: t });
          else location.hash = `#/rangeReport?from=${f}&to=${t}`;
        }
        if (e.target.closest('#ms-range-cancel')) pop.hidden = true;
      });
      document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== rangeBtn) pop.hidden = true; });
    }
    // '/' focuses the search bar (Google style) unless already typing in a field
    if (!mountTopbar.boundSlash) {
      mountTopbar.boundSlash = true;
      document.addEventListener('keydown', (e) => {
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
        const el = document.activeElement;
        const tag = el && el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || (el && el.isContentEditable)) return;
        e.preventDefault();
        const box = U.$('#master-search-input');
        if (box) box.focus();
      });
    }
    onIndexReady(() => { if (hint) { hint.hidden = false; hint.textContent = state.full && state.full.fullLoaded ? '✓ barcode / tag register ready' : ''; } });
    return true;
  }

  // ---------------------------------------------------------------- home page big search
  function invalidate() {
    state.generation++;
    state.light = null; state.lightPromise = null;
    state.full = null; state.fullPromise = null; state.fullError = null;
    state.results = null;
    emit();
  }

  // -------------------------------------------------------------------------------------------------
  // 🔎 Management → Master Search (page)  (v3.46)
  //
  //   Seedha naam / ID / mobile type karo → click karo → us insaan ka POORA related data (FF + GV
  //   dono ka combined report + per-channel profile) usi page par khul jaata hai. Koi results list /
  //   modal box nahi — ek se zyada log match hon to sirf ek line ke naam-chips.
  //
  //   Report component FF.searchReport.render() ka hai (numbers 100% masterProfile / GV truth se).
  // -------------------------------------------------------------------------------------------------
  function pageRender(root, params) {
    try { if (U.destroyAllSuggestions) U.destroyAllSuggestions(); } catch { /* stale suggestion portals */ }
    try { if (root.__mspSuggestDestroy) root.__mspSuggestDestroy(); } catch { /* stale suggestion portal */ }
    root.__mspSuggestDestroy = null;
    const asked = clean((params && (params.q || params.name)) || '');
    const askedId = clean((params && (params.id || params.agentId || params.tlId)) || '');
    let chFilter = (params && (params.ch || params.channel)) || '';   // '' = dono · 'ff' · 'gv'
    let groups = [];
    let current = null;

    root.innerHTML = `<div class="page msp-page">
      <div class="page-head">
        <div><h1>🔎 Master Search</h1>
          <p class="sub">GV + First Forward · <b>naam · agent · TL · ID · mobile</b> — agent search par uski poori details + TL ka full team (sab agents aur TL self ka stock/issuance) bhi khulta hai.</p></div>
        <div class="btn-row"><button class="btn small" data-msp-refresh>🔄 Index refresh</button></div>
      </div>
      <div class="card msp-search-card"><div class="card-body">
        <div class="msp-search">
          <span class="msp-ico" aria-hidden="true">🔎</span>
          <input id="msp-q" class="input" type="search" value="${esc(asked)}" placeholder="Naam / ID / mobile likho… (jaise “Rahul”, “5845036”, 98xxxxxxxx)" autocomplete="off" aria-label="Master search">
          <button class="btn primary" data-msp-go>Search</button>
        </div>
        <div class="msp-filters">
          <span class="dim small">Channel:</span>
          <button class="chip${chFilter === '' ? ' on' : ''}" data-msp-ch="">🎯 Dono</button>
          <button class="chip${chFilter === 'ff' ? ' on' : ''}" data-msp-ch="ff">🟦 First Forward</button>
          <button class="chip${chFilter === 'gv' ? ' on' : ''}" data-msp-ch="gv">🟩 GV Partner</button>
          <span class="ms-register-state" id="msp-state"></span>
        </div>
        <div class="msp-chips" id="msp-quick"></div>
      </div></div>
      <div class="msp-bcr-link"><a class="btn small" href="#/barcodeChecker">🔢 Barcode Checker — range / multiple barcodes →</a></div>
      <div id="msp-out"><div class="card"><div class="card-body empty">👆 <b>Naam ya ID type karo</b> — yahan us insaan ka poora FF + GV data aa jayega.</div></div></div>
      <div id="msp-trend"></div>
    </div>`;

    const input = U.$('#msp-q', root);
    const out = U.$('#msp-out', root);
    const quick = U.$('#msp-quick', root);
    const stateEl = U.$('#msp-state', root);
    const paintState = () => { if (stateEl) stateEl.innerHTML = (state.full && state.full.fullLoaded) ? '<span class="badge green">barcode register ready ✓</span>' : '<span class="badge amber">poora index ban raha hai…</span>'; };
    paintState();
    onIndexReady(paintState);

    const isTlP = (p) => /tl$/.test(String(p && p.kind));
    const chOfP = (p) => (String(p && p.kind).startsWith('gv') ? 'gv' : 'ff');
    const tlOfP = (p) => { try { return ((p.tlSet && [...p.tlSet][0]) || p.tl || ''); } catch { return ''; } };
    const gvSpec = (p) => ({ kind: p.kind, name: p.name, id: p.sub || p.id || '', tlName: tlOfP(p), direct: !!p.direct });
    const lightPeople = () => { try { return state.light && state.light.people ? [...state.light.people.values()] : []; } catch { return []; } };

    function paintQuick() {
      if (!quick) return;
      // One chip per NAME (the same TL/agent used to appear twice — once per channel); channel dots show where they exist.
      const byName = new Map();
      lightPeople()
        .filter((p) => !chFilter || chOfP(p) === chFilter)
        .sort((a, b) => (isTlP(b) ? 1 : 0) - (isTlP(a) ? 1 : 0) || String(a.name).localeCompare(String(b.name)))
        .forEach((p) => {
          const k = normName(p.name);
          const hit = byName.get(k);
          if (hit) { hit.chs.add(chOfP(p)); hit.tl = hit.tl || isTlP(p); return; }
          byName.set(k, { p, chs: new Set([chOfP(p)]), tl: isTlP(p) });
        });
      const list = [...byName.values()].slice(0, 10);
      quick.innerHTML = list.length
        ? `<span class="dim small">⚡ Open instantly:</span>${list.map(({ p, chs, tl }) => `<button type="button" class="msp-chip" data-msp-name="${esc(p.name)}" data-msp-person="${esc(p.kind + '|' + normId(p.sub || p.id || ''))}">${tl ? '👥' : '🧑‍💼'} ${esc(p.name)} <small>${chs.has('ff') ? '🟦' : ''}${chs.has('gv') ? '🟩' : ''}</small></button>`).join('')}`
        : '<span class="dim small">Index ban raha hai — 2 second me suggestions aa jayenge.</span>';
    }
    paintQuick();

    /** One slim "pulse" line under the KPI cards — only what the cards above do NOT already show
     *  (GV: today's live count · FF: latest day + last 7 days). Month / last-month / stock live in the KPI cards. */
    const pulseItem = (label, value, sub) => `<span class="msp-pulse-i"><small>${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</span>`;
    function gvStripHtml(person) {
      if (!person || chOfP(person) !== 'gv' || !FF.gvTruth || !FF.gvTruth.person) return '';
      let t = null;
      try { t = FF.gvTruth.person(gvSpec(person)); } catch { return ''; }
      if (!t) return '';
      const tk = (FF.gv && FF.gv.todayKey) ? FF.gv.todayKey() : U.dateKey(new Date());
      const warn = (t.warnings && t.warnings.length) ? `<span class="msp-pulse-warn" title="${esc(t.warnings.join(' · '))}">⚠️ ${esc(t.warnings[0])}</span>` : '';
      return `<div class="msp-pulse" data-msp-pulse="gv"><span class="msp-pulse-h">🟩 GV · live</span>${pulseItem(`Today · ${esc(U.labelDateKey(tk))}`, U.fmt(t.ledger.today.total), `VC4 ${U.fmt(t.ledger.today.vc4)} · Comm ${U.fmt(t.ledger.today.comm)}`)}${warn}</div>`;
    }

    /** 🟦 FF — EIR daily rows (First Forward data arrives T+1, so "today" alone is usually 0). */
    function ffStripHtml(person) {
      if (!person || chOfP(person) !== 'ff') return '';
      const daily = (FF.store && FF.store.get && FF.store.get('daily')) || [];
      const tk = U.dateKey(new Date());
      const nk = normName(person.name);
      const isT = isTlP(person), id = clean(person.sub || person.id || '');
      const mine = daily.filter((r) => r.channel !== 'GV Partner' && (isT ? normName(r.tlName) === nk : (normName(r.agentName) === nk || (id && normName(r.agentId) === normName(id)))));
      const sumOn = (key) => mine.filter((r) => r.key === key).reduce((s, r) => s + (Number(r.n) || 0), 0);
      const back = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return U.dateKey(d); };
      const lastKey = mine.map((r) => String(r.key)).filter((k) => k < tk).sort().pop() || back(1);
      const from7 = back(7);
      const bins = { vc4: 0, vc20: 0, vc5p: 0, total: 0 };
      mine.filter((r) => String(r.key) >= from7 && String(r.key) < tk).forEach((r) => { const q = Number(r.n) || 0; bins.total += q; if (r.group === 'VC4') bins.vc4 += q; else if (r.group === 'VC20') bins.vc20 += q; else bins.vc5p += q; });
      return `<div class="msp-pulse" data-msp-pulse="ff"><span class="msp-pulse-h">🟦 FF · EIR</span>${pulseItem(`Latest day · ${esc(U.labelDateKey(lastKey))}`, U.fmt(sumOn(lastKey)), 'FF data arrives T+1')}${pulseItem('Last 7 days', U.fmt(bins.total), `VC4 ${U.fmt(bins.vc4)} · VC20 ${U.fmt(bins.vc20)} · VC5+ ${U.fmt(bins.vc5p)}`)}</div>`;
    }

    // ---- 📅 v3.51 — Date-wise issuance trend (agent / TL) --------------------------------------
    // Apna search bar: naam likho → us agent / TL ka ROZ ka issuance (VC4 · VC20 · VC5+ · total).
    // FF (EIR) ka data T+1 aata hai isliye aaj ki FF rows hata di jaati hain; GV ki bhi aaj ki row
    // is trend me nahi dikhti (user rule — 5 Oct jaisi aaj ki date kabhi na aaye).
    const trendEl = U.$('#msp-trend', root);
    const trend = { q: '', kind: 'agent', channel: '', ym: '' };
    const trendDaily = () => {
      let rows = (FF.store && FF.store.get && FF.store.get('daily')) || [];
      try { if (FF.filters && FF.filters.dropLaggedFf) rows = FF.filters.dropLaggedFf(rows); } catch { /* optional */ }
      // 🗓️ Aaj ki rows kabhi nahi (FF ka data T+1 aata hai; GV bhi is trend me kal tak hi) — user rule.
      const tk = U.dateKey(new Date());
      return rows.filter((r) => String(r.key) < tk);
    };
    function trendPickRows() {
      const chOk = (r) => !trend.channel || (trend.channel === 'gv' ? r.channel === 'GV Partner' : r.channel !== 'GV Partner');
      const rows = trendDaily().filter(chOk);
      const q = normName(trend.q);
      if (!q) return rows;
      return rows.filter((r) => (trend.kind === 'tl'
        ? normName(r.tlName) === q || normName(r.agentName) === q
        : normName(r.agentName) === q));
    }
    function trendHtml() {
      const rows = trendPickRows();
      const months = U.uniq(rows.map((r) => r.ym)).sort().slice(-6);
      const ym = months.includes(trend.ym) ? trend.ym : (months[months.length - 1] || U.ymKey(new Date()));
      trend.ym = ym;
      const inMonth = rows.filter((r) => r.ym === ym);
      const byDay = new Map();
      inMonth.forEach((r) => {
        const d = byDay.get(r.day) || { day: r.day, vc4: 0, vc20: 0, vc5p: 0, total: 0 };
        const n = Number(r.n) || 0;
        d.total += n;
        if (r.group === 'VC4') d.vc4 += n; else if (r.group === 'VC20') d.vc20 += n; else d.vc5p += n;
        byDay.set(r.day, d);
      });
      const days = [...byDay.values()].sort((a, b) => a.day - b.day);
      const tot = (k) => U.sum(days, (d) => d[k]);
      // v3.52 — chart bhi VC4 · VC20 · VC5+ (stacked) — pehle sirf "Total tags" ki ek series thi.
      const chart = (days.length && FF.charts) ? FF.charts.bars({
        labels: days.map((d) => String(d.day)), height: 220, showValues: true, legendAlways: true,
        series: [
          { name: 'VC4', values: days.map((d) => d.vc4), color: '#6366f1' },
          { name: 'VC20', values: days.map((d) => d.vc20), color: '#f59e0b' },
          { name: 'VC5+', values: days.map((d) => d.vc5p), color: '#10b981' }
        ]
      }) : '';
      const pct = (n) => (tot('total') ? ` <small class="dim">${Math.round((n / tot('total')) * 100)}%</small>` : '');
      const peak = days.reduce((best, d) => (d.total > (best ? best.total : -1) ? d : best), null);
      const classChips = days.length ? `<div class="msp-trend-sum">
          <span class="msp-tsum vc4"><small>VC4</small><b>${U.fmt(tot('vc4'))}</b>${pct(tot('vc4'))}</span>
          <span class="msp-tsum vc20"><small>VC20</small><b>${U.fmt(tot('vc20'))}</b>${pct(tot('vc20'))}</span>
          <span class="msp-tsum vc5p"><small>VC5+</small><b>${U.fmt(tot('vc5p'))}</b>${pct(tot('vc5p'))}</span>
          <span class="msp-tsum total"><small>🏷️ Total · ${U.fmt(days.length)} din</small><b>${U.fmt(tot('total'))}</b> <small class="dim">avg ${U.fmt(tot('total') / Math.max(1, days.length), true)}/din</small></span>
          ${peak ? `<span class="msp-tsum peak"><small>⭐ Best din</small><b>${esc(U.labelDateKey(`${ym}-${U.pad2(peak.day)}`, true))}</b> <small class="dim">${U.fmt(peak.total)} tags</small></span>` : ''}
        </div>` : '';
      let cum = 0;
      const table = days.length ? `<div class="table-wrap tall"><table class="tbl compact msp-trend-tbl">
        <thead><tr><th>Date</th><th class="num">VC4</th><th class="num">VC20</th><th class="num">VC5+</th><th class="num">Total</th><th class="num">Cumulative</th></tr></thead>
        <tbody>${days.map((d) => { cum += d.total; return `<tr><td><b>${esc(U.labelDateKey(`${ym}-${U.pad2(d.day)}`, true))}</b></td><td class="num">${U.fmt(d.vc4)}</td><td class="num">${U.fmt(d.vc20)}</td><td class="num">${U.fmt(d.vc5p)}</td><td class="num"><b>${U.fmt(d.total)}</b></td><td class="num dim">${U.fmt(cum)}</td></tr>`; }).join('')}</tbody>
        <tfoot><tr class="row-total"><td>${U.fmt(days.length)} din</td><td class="num">${U.fmt(tot('vc4'))}</td><td class="num">${U.fmt(tot('vc20'))}</td><td class="num">${U.fmt(tot('vc5p'))}</td><td class="num">${U.fmt(tot('total'))}</td><td class="num dim">—</td></tr></tfoot></table></div>`
        : `<div class="empty-state">📅 Is ${trend.q ? `naam (<b>${esc(trend.q)}</b>)` : 'filter'} ke liye ${U.labelYM(ym, true)} me koi issuance nahi mili — doosra mahina / channel try karo.</div>`;
      return `<div class="card msp-trend-card"><div class="card-head"><div>
          <h3>📅 Date-wise issuance trend <span class="dim small">· agent ya TL</span></h3>
          <p class="dim small">Naam likho → roz ka issuance (VC4 · VC20 · VC5+). FF ka aaj ka data kal aata hai aur GV ki aaj ki row bhi is trend me nahi dikhti — aaj ki date kabhi nahi.</p></div>
        <div class="card-right dim small">${trend.q ? `${trend.kind === 'tl' ? '👥' : '👤'} ${esc(trend.q)}${trend.channel ? ` · ${trend.channel === 'gv' ? '🟩 GV' : '🟦 FF'}` : ''}` : `Sab (${trend.channel ? (trend.channel === 'gv' ? '🟩 GV' : '🟦 FF') : 'FF + GV'} · kul ${U.fmt(trendDaily().length)} rows)`}</div></div>
        <div class="card-body">
          <div class="msp-trend-controls">
            <span class="msp-trend-find"><input class="input" id="msp-trend-q" type="search" placeholder="🔎 Agent / TL naam likho (khaali = sab)" value="${esc(trend.q)}" autocomplete="off" aria-label="Date-wise trend ke liye agent ya TL"></span>
            <span class="msp-trend-kind"><button type="button" class="chip${trend.kind === 'agent' ? ' on' : ''}" data-msp-tkind="agent">🧑‍💼 Agent</button><button type="button" class="chip${trend.kind === 'tl' ? ' on' : ''}" data-msp-tkind="tl">👥 TL (poori team)</button></span>
            <span class="msp-trend-ch"><button type="button" class="chip${trend.channel === '' ? ' on' : ''}" data-msp-tch="">Dono</button><button type="button" class="chip${trend.channel === 'ff' ? ' on' : ''}" data-msp-tch="ff">🟦 FF</button><button type="button" class="chip${trend.channel === 'gv' ? ' on' : ''}" data-msp-tch="gv">🟩 GV</button></span>
            <label class="msp-trend-month">Mahina <select class="input" id="msp-trend-ym">${(months.length ? months : [ym]).map((m) => `<option value="${esc(m)}" ${m === ym ? 'selected' : ''}>${esc(U.labelYM(m, true))}</option>`).join('')}</select></label>
            <button type="button" class="btn small" data-msp-tclear ${trend.q ? '' : 'disabled'}>✕ Clear</button>
          </div>
          ${classChips}
          ${chart ? `<div class="msp-trend-chart">${chart}</div>` : ''}
          ${table}
        </div></div>`;
    }
    function paintTrend() {
      if (!trendEl || !trendEl.isConnected) return;
      trendEl.innerHTML = trendHtml();
      const input = U.$('#msp-trend-q', trendEl);
      // Purana dropdown hatao (har paint par naya input banta hai — warna body me orphan boxes jama hote).
      if (paintTrend._sug) { try { paintTrend._sug.destroy(); } catch { /* ignore */ } paintTrend._sug = null; }
      if (input) {
        paintTrend._sug = U.suggest(input, {
          items: () => lightPeople().slice(0, 400).map((p) => ({
            kind: isTlP(p) ? 'tl' : 'agent', kindLabel: isTlP(p) ? 'TL' : 'Agent', label: p.name,
            sub: `${chOfP(p) === 'gv' ? '🟩 GV' : '🟦 FF'}${tlOfP(p) ? ` · TL ${tlOfP(p)}` : ''}`, value: p.name
          })),
          onPick: (it) => { trend.q = it.value; trend.kind = it.kind; paintTrend(); },
          onEnter: (q) => { trend.q = clean(q || ''); paintTrend(); },
          min: 0
        });
        // v3.52 — type karte waqt suggestions dikhte hain (pick / Enter se apply); poora card tabhi
        // repaint hota hai jab box khaali ho jaaye ya naam exact match kare — warna dropdown har key par mar jaata tha.
        input.addEventListener('input', () => {
          const v = clean(input.value);
          clearTimeout(paintTrend._t);
          paintTrend._t = setTimeout(() => {
            const exact = v && lightPeople().some((p) => normName(p.name) === normName(v));
            if ((!v && trend.q) || (exact && normName(v) !== normName(trend.q))) {
              trend.q = v; const keep = document.activeElement === input; paintTrend();
              const box = U.$('#msp-trend-q', trendEl); if (box && keep) { box.focus(); try { box.setSelectionRange(box.value.length, box.value.length); } catch { /* ignore */ } }
            }
          }, 350);
        });
      }
      trendEl.querySelectorAll('[data-msp-tch]').forEach((b) => b.addEventListener('click', () => { trend.channel = b.dataset.mspTch; paintTrend(); }));
      trendEl.querySelectorAll('[data-msp-tkind]').forEach((b) => b.addEventListener('click', () => { trend.kind = b.dataset.mspTkind; paintTrend(); }));
      const ymSel = U.$('#msp-trend-ym', trendEl);
      if (ymSel) ymSel.addEventListener('change', () => { trend.ym = ymSel.value; paintTrend(); });
      const clr = trendEl.querySelector('[data-msp-tclear]');
      if (clr) clr.addEventListener('click', () => { trend.q = ''; paintTrend(); });
    }
    if (trendEl) {
      paintTrend();
      const need = (FF.store && FF.store.need) ? FF.store.need('daily') : Promise.resolve(null);
      Promise.resolve(need).catch(() => null).then(() => paintTrend());
    }
    /** Koi insaan khola → trend card usi ka ho jaata hai (ek click me date-wise data). */
    const trendFollow = (person) => { if (!trendEl || !person) return; trend.q = person.name; trend.kind = isTlP(person) ? 'tl' : 'agent'; trend.ym = ''; paintTrend(); };

    // ---- 📦 v3.52 — upar ke boxes: stock · issuance (VC4 · VC20 · VC5+) · priority · suggested dispatch ----
    // Pehle search ke upar sirf "aaj ka snapshot" tha (FF me to bas "aaj 0 — data kal aayega") aur
    // priority / suggested sirf neeche channel-tab kholne par milta tha. Ab har channel (FF / GV) ke
    // liye ek KPI card — numbers 100% masterProfile (REPORT + EIR + stock) ke, wahi jo report me hain.
    const num = (v) => Number(v) || 0;
    const prioChip = (p) => (p ? `<span class="badge ${/high/i.test(p) ? 'red' : /medium/i.test(p) ? 'amber' : 'green'}">${esc(p)}</span>` : '<span class="dim">—</span>');
    const sugPair = (net, gross) => `<span class="sug-pair sug-pair-tight"><span class="sug-result net" title="Required − stock"><small>After stock</small><b class="sug-chip">${U.fmt(net)}</b></span><span class="sug-result gross" title="Run-rate × din, stock ghata kar nahi"><small>W/o stock</small><b class="sug-chip wo">${U.fmt(gross)}</b></span></span>`;
    const ymLabel = (ym) => { try { return ym ? U.labelYM(ym, true) : ''; } catch { return String(ym || ''); } };
    /** 🕒 Last active — is agent / TL ka sabse latest issuance (n>0) wala din + kitne din pehle. */
    function lastActiveHtml(pr, isTl, ch) {
      try {
        let rows = [];
        if (ch === 'gv' && FF.gv && FF.gv.liveDailyRows) { try { rows = FF.gv.liveDailyRows() || []; } catch { rows = []; } }
        if (!rows.length) rows = (FF.store && FF.store.get && FF.store.get('daily')) || [];
        const nk = normName(pr.name), id = normName(pr.id || '');
        const isGv = (r) => r.channel === 'GV Partner';
        let best = '', qty = 0;
        for (const r of rows) {
          if ((ch === 'gv') !== isGv(r)) continue;
          if (!(Number(r.n) > 0)) continue;
          const hit = isTl ? (normName(r.tlName) === nk || normName(r.agentName) === nk) : (normName(r.agentName) === nk || (id && normName(r.agentId) === id));
          if (!hit) continue;
          const k = String(r.key || ''); if (!k) continue;
          if (k > best) { best = k; qty = 0; }
          if (k === best) qty += Number(r.n) || 0;
        }
        if (!best) return ' · <span class="badge amber" title="Is naam ka koi issuance data nahi mila">🕒 Last active: —</span>';
        const tk = U.dateKey(new Date());
        const days = Math.max(0, Math.round((new Date(tk + 'T00:00:00') - new Date(best + 'T00:00:00')) / 86400000));
        const ago = days === 0 ? 'aaj' : days === 1 ? 'kal' : `${days} din pehle`;
        const cls = days <= 3 ? 'green' : days <= 10 ? 'amber' : 'red';
        return ` · <span class="badge ${cls}" title="Latest issuance wala din (${esc(U.fmt(qty))} tags)">🕒 Last active: ${esc(U.labelDateKey(best))} · ${ago}</span>`;
      } catch { return ''; }
    }
    /** Working days = distinct days this month with issuance (n>0) for this agent / TL. */
    function workedDays(pr, isTl, ch, ym) {
      try {
        let rows = [];
        if (ch === 'gv' && FF.gv && FF.gv.liveDailyRows) { try { rows = FF.gv.liveDailyRows() || []; } catch { rows = []; } }
        if (!rows.length) rows = (FF.store && FF.store.get && FF.store.get('daily')) || [];
        const nk = normName(pr.name), id = normName(pr.id || '');
        const days = new Set();
        for (const r of rows) {
          if ((ch === 'gv') !== (r.channel === 'GV Partner')) continue;
          if (!(Number(r.n) > 0)) continue;
          const k = String(r.key || ''); if (!k || (ym && k.slice(0, 7) !== ym)) continue;
          const hit = isTl ? (normName(r.tlName) === nk || normName(r.agentName) === nk) : (normName(r.agentName) === nk || (id && normName(r.agentId) === id));
          if (hit) days.add(k);
        }
        return days.size;
      } catch { return 0; }
    }
    function kpiStripHtml(pr) {
      if (!pr) return '';
      const isTl = /tl$/.test(String(pr.kind || '')), ch = pr.ch || chOfP(pr);
      const s = pr.stock || {}, t = pr.totals || {}, d = pr.dispatch || {}, ts = pr.tlStock || {}, m = pr.months || {};
      const c = (pr.calc && pr.calc.total) || {};
      const p1 = pr.projT1 || null;
      // 🚦 Priority = stock cover (din) se — sheet ki priority sirf cover na ho tab fallback.
      const th = (FF.config && FF.config.thresholds) || {};
      const prioEff = c.cover != null ? (c.cover < (th.coverRed || 7) ? 'High' : c.cover < (th.coverOrange || 15) ? 'Medium' : 'Low') : (pr.priority || '');
      let bins = {};
      try { bins = (MP() && MP().groupBinsFor && MP().groupBinsFor(pr)) || {}; } catch { bins = {}; }
      // v3.100 — VC4 / VC20 / VC5+ = bold coloured tiles (ek line me), total optional
      const vcTiles = (v, total) => `<div class="msp-vcs">${[['VC4', 'v4'], ['VC20', 'v20'], ['VC5+', 'v5']].map(([k, c]) => `<span class="vc ${c}"><i>${k}</i><b>${U.fmt((v && v[k]) || 0)}</b></span>`).join('')}${total != null ? `<span class="vc tt"><i>Total</i><b>${U.fmt(total)}</b></span>` : ''}</div>`;
      const mix = (b) => (b && (num(b.VC4) || num(b.VC20) || num(b['VC5+'])) ? vcTiles(b) : '');
      const stockMix = mix(bins.stock) || vcTiles({ VC4: s.vc4, 'VC5+': s.comm });
      const curMix = mix(bins.cur) || vcTiles({ VC4: t.curVc4, 'VC5+': t.curComm });
      const lastMix = mix(bins.last) || vcTiles({ VC4: t.lastVc4, 'VC5+': t.lastComm });
      const who = isTl ? `tl=${encodeURIComponent(pr.name)}${pr.id && ch === 'gv' ? `&tlId=${encodeURIComponent(pr.id)}` : ''}` : `agent=${encodeURIComponent(pr.name)}${pr.id ? `&agentId=${encodeURIComponent(pr.id)}` : ''}`;
      const spec = (scope, ym) => `src=${ch}&scope=${scope}${ym ? `&ym=${encodeURIComponent(ym)}` : ''}&${who}`;
      const peopleSpec = `src=${ch}&scope=people&tl=${encodeURIComponent(pr.name)}&self=0&sort=stock`;
      const box = (cls, label, value, sub, kpi, attrs) => `<div class="mp-kpi msp-kpi ${cls}${kpi || attrs ? ' kpi-clickable' : ''}"${attrs ? ` ${attrs} role="button" tabindex="0" title="Click for details"` : (kpi ? ` data-kpi="${esc(kpi)}" role="button" tabindex="0" title="Detail kholo"` : '')}><small>${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
      // Class-wise plan: two groups — VC4 / VC20 (combined) and VC5+ — each with its own run-rate and stock.
      const days = num(c.days) || num(d.days) || 25, elapsed = Math.max(1, num(c.elapsed) || 1);
      const lastDays = (() => { try { return U.daysInMonth(m.last) || 30; } catch { return 30; } })();
      const grpOf = (cls) => { const k = String(cls || '').toUpperCase().replace(/\s+/g, ''); return k === 'VC4' || k === 'VC20' ? 'A' : 'B'; };
      const fromClasses = (key) => { const o = { A: 0, B: 0 }; (pr.classes || []).forEach((x) => { o[grpOf(x.cls)] += Math.max(0, num(x[key])); }); return o; };
      const pick = (b, key) => {
        const o = { A: num(b && b.VC4) + num(b && b.VC20), B: num(b && b['VC5+']) };
        if (o.A || o.B) return o;
        const f = fromClasses(key);
        return (f.A || f.B) ? f : null;
      };
      const stk = pick(bins.stock, 'stock') || { A: num(s.vc4), B: num(s.comm) };
      const cu = pick(bins.cur, 'cur') || { A: num(t.curVc4), B: num(t.curComm) };
      const la = pick(bins.last, 'last') || { A: num(t.lastVc4), B: num(t.lastComm) };
      const redD = th.coverRed || 7, orgD = th.coverOrange || 15;
      const plan = [['A', 'VC4 / VC20'], ['B', 'VC5+']].map(([g, k]) => {
        const stock = stk[g], cur = cu[g], last = la[g];
        let rate = cur / elapsed, basis = '';
        if (!cur && last) { rate = last / lastDays; basis = 'last month'; }
        const cover = rate > 0 ? stock / rate : null;
        const prio = rate <= 0 ? 'None' : cover < redD ? 'High' : cover < orgD ? 'Medium' : 'Low';
        const gross = Math.ceil(rate * days), net = Math.max(0, gross - stock);
        return { k, stock, cur, last, rate, basis, cover, prio, gross, net };
      });
      const rank = { High: 3, Medium: 2, Low: 1, None: 0 };
      const worst = plan.reduce((a, x) => (rank[x.prio] > rank[a] ? x.prio : a), 'None');
      const sm = '';
      const chipOf = (p) => (p === 'None' ? '<span class="badge">No issuance</span>' : prioChip(p));
      const prioBody = plan.map((x) => `<div class="msp-cls-line"><span class="c1">${esc(x.k)}</span><span class="c2">${chipOf(x.prio)}</span><span class="c3">${x.cover != null ? `<span class="msp-hl ${x.cover < redD ? 'red' : x.cover < orgD ? 'amber' : 'green'}">cover ${U.fmt(x.cover, true)} d</span>` : '<span class="dim">no run-rate</span>'}</span></div>`).join('');
      const prioSub = plan.map((x) => `${esc(x.k)}: stock ${U.fmt(x.stock)} ÷ ${U.fmt(x.rate, true)}/day`).join(' · ');
      // v3.90 — class-wise dispatch: VC4/VC20 ek jagah, baaki TVC-wise (Settings → TVC mapping); neeche VC4/VC20 aur VC5+ totals.
      const calcRow = (label, stock, cur, last) => {
        let rate = cur / elapsed, basis = '';
        if (!cur && last) { rate = last / lastDays; basis = 'last month'; }
        const cover = rate > 0 ? stock / rate : null;
        const prio = rate <= 0 ? 'None' : cover < redD ? 'High' : cover < orgD ? 'Medium' : 'Low';
        const gross = Math.ceil(rate * days), net = Math.max(0, gross - stock);
        return { k: label, stock, cur, last, rate, basis, cover, prio, gross, net };
      };
      const tvcPlan = (() => {
        const list = Array.isArray(pr.classes) ? pr.classes : [];
        const hasClassData = list.some((x) => num(x.stock) || num(x.cur) || num(x.last));
        if (!hasClassData) return { rows: plan, totals: false };
        const normK = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');
        const groups = (FF.config.tvcGroups || []).map((g) => ({ tvc: String(g.tvc), cch: new Set([...(g.cch || []).map(normK), `VC${g.tvc}`]) }));
        const isCoreGroup = (g) => [...g.cch].every((c) => c === 'VC4' || c === 'VC20' || c === `VC${g.tvc}`) && g.tvc === '4';
        const rows = [plan[0]];
        let sumS = 0, sumC = 0, sumL = 0;
        groups.filter((g) => !isCoreGroup(g)).forEach((g) => {
          let s = 0, cu1 = 0, la1 = 0;
          list.forEach((x) => { if (g.cch.has(normK(x.cls))) { s += Math.max(0, num(x.stock)); cu1 += Math.max(0, num(x.cur)); la1 += Math.max(0, num(x.last)); } });
          sumS += s; sumC += cu1; sumL += la1;
          if (s || cu1 || la1) rows.push(calcRow(`VC${g.tvc}`, s, cu1, la1));
        });
        const rs = Math.max(0, stk.B - sumS), rc = Math.max(0, cu.B - sumC), rl = Math.max(0, la.B - sumL);
        if (rs || rc || rl) rows.push(calcRow('Other', rs, rc, rl));
        return { rows, totals: rows.length > 2 };
      })();
      const needCls = (x) => (x.prio === 'None' || !x.net ? 'green' : x.prio === 'High' ? 'red' : 'amber');
      const planLine = (x) => `<div class="msp-cls-line"><span class="c1">${esc(x.k)}</span><span class="c2"><span class="msp-hl ${needCls(x)}">need ${x.prio === 'None' ? '0' : U.fmt(x.net)}</span></span><span class="c3"><span class="msp-hl blue">w/o stock ${U.fmt(x.gross)}</span></span></div>`;
      const commRows = tvcPlan.rows.slice(1);
      const commNet = commRows.reduce((a, x) => a + (x.prio === 'None' ? 0 : x.net), 0), commGross = commRows.reduce((a, x) => a + x.gross, 0);
      const totLine = (label, net, gross) => `<div class="msp-cls-line msp-tot-line"><span class="c1">${label}</span><span class="c2"><span class="msp-hl ${net ? 'amber' : 'green'}">need ${U.fmt(net)}</span></span><span class="c3"><span class="msp-hl blue">w/o stock ${U.fmt(gross)}</span></span></div>`;
      const planBody = `<div class="msp-plan">${tvcPlan.rows.map(planLine).join('')}</div>` + (tvcPlan.totals
        ? `<div class="msp-tot">${totLine('Total VC4/VC20', tvcPlan.rows[0].prio === 'None' ? 0 : tvcPlan.rows[0].net, tvcPlan.rows[0].gross)}${totLine('Total VC5+', commNet, commGross)}</div>` : '');
      const planSub = tvcPlan.rows.map((x) => `${esc(x.k)}: ${U.fmt(x.rate, true)}/day × ${U.fmt(days)} − stock ${U.fmt(x.stock)}${x.basis ? ` (${x.basis} rate)` : ''}`).join(' · ');
      // ---- v3.96 — simple mini tables: VC4 / VC20 / VC5+ + Total
      const miniHtml = (vals, total, tail) => `${vcTiles(vals, total)}${tail ? `<span class="msp-mini-tail">${tail}</span>` : ''}`;
      const curBins = (bins.cur && (num(bins.cur.VC4) || num(bins.cur.VC20) || num(bins.cur['VC5+']))) ? { VC4: num(bins.cur.VC4), VC20: num(bins.cur.VC20), 'VC5+': num(bins.cur['VC5+']) } : { VC4: num(t.curVc4), VC20: 0, 'VC5+': num(t.curComm) };
      const expTotal = Math.round((p1 && p1.basis && Number.isFinite(Number(p1.basis.projectedCurrent))) ? Number(p1.basis.projectedCurrent) : (p1 && Number.isFinite(Number(p1.total)) ? Number(p1.total) : 0));
      const expSplit = (() => {
        const sum = curBins.VC4 + curBins.VC20 + curBins['VC5+'];
        if (!sum || !expTotal) return { VC4: 0, VC20: 0, 'VC5+': 0 };
        const o = {}; let used = 0, big = 'VC4';
        ['VC4', 'VC20', 'VC5+'].forEach((k) => { o[k] = Math.round(expTotal * curBins[k] / sum); used += o[k]; if (curBins[k] > curBins[big]) big = k; });
        o[big] += expTotal - used;   // total hamesha match
        return o;
      })();
      const dayChip = (() => {
        try {
          const nk = normName(pr.name), pid = normName(pr.id || '');
          const same = (r) => (isTl
            ? ((pid && r.tlId) ? normName(r.tlId) === pid : normName(r.tlName) === nk)
            : ((pid && r.agentId) ? normName(r.agentId) === pid : normName(r.agentName) === nk));   // ID ho to ID hi decide kare
          let rows, key, label, icon, tail;
          if (ch === 'gv') {
            rows = (FF.gv && FF.gv.issuanceRows && FF.gv.issuanceRows()) || [];
            key = (FF.gv && FF.gv.todayKey) ? FF.gv.todayKey() : U.dateKey(new Date());
            label = 'Today · live'; icon = '⚡'; tail = 'GV Master live';
          } else {
            rows = ((FF.store && FF.store.get && FF.store.get('daily')) || []).filter((r) => r.channel !== 'GV Partner');
            const yd = new Date(); yd.setDate(yd.getDate() - 1); key = U.dateKey(yd);
            label = 'Yesterday'; icon = '🕘'; tail = 'FF EIR data';
          }
          const vals = { VC4: 0, VC20: 0, 'VC5+': 0 }; let total = 0;
          rows.forEach((r) => {
            const k = String(r.key || U.dateKey(r.date || r.d || new Date(0)));
            if (k !== key || !same(r)) return;
            const n = Number(r.n) || 0; total += n;
            vals[r.group === 'VC4' ? 'VC4' : r.group === 'VC20' ? 'VC20' : 'VC5+'] += n;
          });
          return box('k13', `${icon} ${label} · ${esc(U.labelDateKey ? U.labelDateKey(key) : key)}`, miniHtml(vals, total, tail), '', `${spec('day', '')}&date=${encodeURIComponent(key)}`);
        } catch { return ''; }
      })();
      const wd = workedDays(pr, isTl, ch, m.cur);
      const ownAgents = ts.own && ts.agents ? `own ${U.fmt(ts.own.total)} + agents ${U.fmt(ts.agents.total)}` : '';
      const tlName = (pr.tl && pr.tl.name) || '';
      let sug = '';
      if (pr.tagRequired) {
        sug = box('k7', `🏷️ Tags required · ${U.fmt(d.days)} din`, sugPair(num(d.sugVc4) + num(d.sugComm), num(d.sugVc4Gross) + num(d.sugCommGross)), `VC4 ${U.fmt(d.sugVc4)} + Comm ${U.fmt(d.sugComm)} · ${esc(pr.directLabel || 'Direct')} · priority ${esc(pr.priority || '—')}`, spec('mtd', m.cur));
      } else if (pr.direct) {
        sug = box('k4', '🎯 Suggested dispatch', '<span class="dim">No dispatch</span>', `🚫 ${esc(pr.directLabel || 'Direct agent')} · priority ${esc(pr.priority || 'Low')} — abhi tags ki zarurat nahi`);
      } else {
        sug = box('k4', `🎯 Dispatch need · ${U.fmt(days)} days`, planBody, '', spec('mtd', m.cur));
      }
    /** 📈 Growth tile ka neeche wala text: kya compare hua + run-rate + expected month-end vs last month. */
    const growthSub = (p1, m) => {
      const b = (p1 && p1.basis) || {};
      const sgn = (v) => (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';
      const parts = [];
      if (b.growthSource === 'mtd' && p1.comparableLast != null) parts.push(`1–${U.fmt(b.growthElapsed)} tareekh: ${U.fmt(p1.comparableCurrent)} vs pichhle mahine ${U.fmt(p1.comparableLast)}`);
      else if (b.growthSource === 'runrate') parts.push(`run-rate ${U.fmt(b.ratePerDay, true)}/day vs pichhle mahine ${U.fmt(b.prevRatePerDay, true)}/day`);
      else parts.push('pichhle mahine ka data nahi mila');
      if (p1 && p1.total) parts.push(`expected month-end ${U.fmt(p1.total)}${Number.isFinite(Number(p1.projectedGrowth)) ? ` (${sgn(p1.projectedGrowth)} vs last month)` : ''}`);
      return parts.join(' · ');
    };
      const growthNum = (pr.growthNum !== null && pr.growthNum !== undefined && Number.isFinite(Number(pr.growthNum))) ? Number(pr.growthNum) : null;
      const growthHtml = (growthNum === null || growthNum === undefined || !Number.isFinite(Number(growthNum))) ? '<span class="dim">—</span>' : U.pctHtml(growthNum, { decimals: 0 });
      const notFound = pr.found === false
        ? `<p class="dim small msp-kpi-note">⚠️ ${ch === 'gv' ? 'GV REPORT' : 'REPORT'} tab me is ${isTl ? 'TL' : 'agent'} ki row nahi mili — stock / priority sheet se nahi aa paaye (naam ki spelling check karo); issuance tag-ledger (EIR) se hai.</p>` : '';
      // 🍩 v3.91 — class-wise donuts (last month · this month · stock) summary ke niche; har legend/segment clickable → kpi drill (rows + CSV).
      const donutBlock = (() => {
        const rows = Array.isArray(pr.classes) ? pr.classes : [];
        const C = FF.charts;
        if (!C || !C.donut || !rows.length) return '';
        const mm = pr.months || {};
        const spec2 = (scope, ym, cls) => `src=${ch}&scope=${scope}${ym ? `&ym=${encodeURIComponent(ym)}` : ''}&${who}&cls=${encodeURIComponent(cls)}`;
        const nk = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');
        const grps = (FF.config.tvcGroups || []).map((g) => ({ lab: `VC${g.tvc}`, set: new Set([...(g.cch || []).map(nk), `VC${g.tvc}`]) }));
        const bucketOf = (cls) => { const g = grps.find((x) => x.set.has(nk(cls))); return g ? g.lab : (cls || 'NA'); };
        const mk = (key, scope, ym, title) => {
          const m = new Map();
          rows.forEach((c) => {
            const v = Number(c[key]) || 0; if (v <= 0) return;
            const b = bucketOf(c.cls), o = m.get(b) || { label: b, value: 0, cls: [] };
            o.value += v; if (c.cls && !o.cls.includes(c.cls)) o.cls.push(c.cls); m.set(b, o);
          });
          return [...m.values()].sort((x, y) => y.value - x.value).map((o) => ({
            label: o.label, value: o.value,
            attr: `data-kpi="${esc(spec2(scope, ym, o.cls.join(',') || o.label))}" data-kpi-title="${esc(`${title} · ${o.label}`)}" title="${esc(o.label + (o.cls.length ? ' = ' + o.cls.join(' + ') : '') + ' · click = rows')}" style="cursor:pointer"`
          }));
        };
        const one = (title, items, sub) => `<section class="card gs-card"><div class="card-head"><h3>${title}</h3><span class="dim small">click = rows</span></div><div class="card-body">${items.length ? C.donut({ items, size: 150, subtitle: sub }) : '<div class="empty">No data</div>'}</div></section>`;
        return `<div class="gs-grid3 msp-donuts">${one(`📅 Last month${mm.last ? ` · ${esc(mm.last)}` : ''}`, mk('last', 'month', mm.last, 'Last month'), 'tags')}${one(`🏷️ This month${mm.cur ? ` · ${esc(mm.cur)}` : ''}`, mk('cur', 'mtd', mm.cur, 'This month'), 'tags')}${one('📦 Stock in hand', mk('stock', 'stock', '', 'Stock in hand'), 'in stock')}</div>`;
      })();
      return `<section class="card msp-kpi-card" data-msp-kpi-ch="${ch}"><div class="card-head"><div>
          <h3>${ch === 'gv' ? '🟩 GV Partner' : '🟦 First Forward'} · ${isTl ? 'TL summary' : 'Agent summary'}</h3>
          <p class="dim small">${isTl ? 'TL + all agents combined' : `This agent only${tlName && !pr.direct ? ` · TL ${esc(tlName)}` : ''}`}${lastActiveHtml(pr, isTl, ch)}${pr.partial ? ' · <span class="badge amber">⏳ loading…</span>' : ''}</p></div>
          <div class="card-right">${ch === 'gv' ? GVC.chip({ kind: isTl ? 'gv_tl' : 'gv_agent', sub: pr.id, id: pr.id, channel: 'gv' }) : ''}${prioChip(worst === 'None' ? prioEff : worst)}</div></div>
        <div class="card-body"><div class="mp-kpis msp-kpis">
          ${box('k1', `📦 Stock${isTl ? ' · TL total' : ' · apna'}`, `${U.fmt(s.total)}${c.cover != null ? ` <span class="msp-cover ${c.cover < 7 ? 'bad' : c.cover < 20 ? 'warn' : 'ok'}" title="Run-rate ${U.fmt(c.rate, true)}/day ke hisaab se">⏳ ~${U.fmt(Math.round(c.cover))} din</span>` : ''}`, `${stockMix}${(isTl && ownAgents) || c.cover != null ? `<span class="msp-mini-tail">${isTl && ownAgents ? `${ownAgents}` : ''}${isTl && ownAgents && c.cover != null ? ' · ' : ''}${c.cover != null ? `run-rate ${U.fmt(c.rate, true)}/day` : ''}</span>` : ''}`, spec('stock'))}
          ${isTl
    ? box('k2', '🧑‍💼 Agents', `${U.fmt(pr.agentCount)}${pr.selfAgent ? ' + TL' : ''}`, 'click → agents ki list (stock · issuance ke saath)', peopleSpec)
    : box('k2', '📦 TL ke under stock', ts.has ? U.fmt(ts.total) : '—', ts.has ? `${ownAgents ? `${ownAgents} · ` : ''}TL ${esc(tlName || '—')}` : (pr.direct ? `🚫 ${esc(pr.directLabel || 'Direct — koi TL nahi')}` : 'TL ka stock nahi mila'), ts.has && tlName ? `src=${ch}&scope=stock&tl=${encodeURIComponent(tlName)}${pr.tl && pr.tl.id && ch === 'gv' ? `&tlId=${encodeURIComponent(pr.tl.id)}` : ''}` : '')}
          ${dayChip}
          ${box('k6', `🏷️ Issued this month${m.cur ? ` · ${esc(ymLabel(m.cur))}` : ''}`, U.fmt(t.curTotal), `${curMix}<span class="msp-mini-tail">🗓️ Worked <span class="msp-hl blue">${U.fmt(wd)} of ${U.fmt(elapsed)} days</span></span>`, spec('mtd', m.cur))}
          ${box('k8', `📅 Last month${m.last ? ` · ${esc(ymLabel(m.last))}` : ''}`, U.fmt(t.lastTotal), lastMix, spec('month', m.last))}
          ${box('k3', '🚦 Priority · by class', prioBody, prioSub, isTl ? peopleSpec : spec('stock'))}
          ${sug}
          ${box('k0', `📈 Growth${(p1 && (p1.growthThrough || (p1.basis && p1.basis.growthThrough) || (p1.basis && p1.basis.shortLabel))) ? ` <small class="dim">till ${esc(p1.growthThrough || (p1.basis && p1.basis.growthThrough) || p1.basis.shortLabel)}</small>` : ''}`, growthHtml, growthSub(p1, m), spec('mtd', m.cur), `data-msp-growth="${ch}"`)}
          ${box('k10', '🎯 Expected this month · Run-rate', miniHtml(expSplit, expTotal, `run-rate ${U.fmt(c.rate, true)}/day × ${U.fmt(U.daysInMonth(m.cur || U.ymKey(new Date())))} days`), '', spec('mtd', m.cur))}
          ${ageBoxHtml(pr, isTl, ch)}
          ${dispBoxHtml(pr, isTl, ch)}
          ${kycBoxHtml(pr, isTl)}
          ${ch === 'gv' ? GVC.boxHtml(pr, isTl) : ''}
        </div>${notFound}</div></section>${donutBlock}`;
    }
    const kpiLoadingHtml = (name, ch) => `<section class="card msp-kpi-card" data-msp-kpi-ch="${ch}"><div class="card-body">${U.spinner(`${esc(name)} ka ${ch === 'gv' ? '🟩 GV' : '🟦 FF'} stock · issuance · priority · suggested load ho raha hai…`)}</div></section>`;
    /** Group (FF + GV) ke har channel ka KPI card — pehle quick (memory wala data), phir poora profile aate hi upgrade. */
    async function paintKpis(g, host) {
      if (!host || !MP()) return;
      const chans = ['ff', 'gv'].filter((c) => g[c]);
      const html = {};
      const sourceKey = g && (g._sourceKey || g.key);
      // A channel-filtered view is a derived object, while `current` deliberately remains the
      // original dual-channel group so the user can switch back to "Dono". Compare source keys,
      // not object identity, or async KPI upgrades remain stuck on the loading placeholder.
      const paint = () => {
        const activeKey = current && (current._sourceKey || current.key);
        if (host.isConnected !== false && current && (current === g || (sourceKey && activeKey === sourceKey))) {
          host.innerHTML = chans.map((ch) => html[ch] || '').join('');
          fillAgeBoxes(host);
          fillDispBoxes(host);
          fillKycBoxes(host);
        }
      };
      REPORT_CTX.name = g.name; REPORT_CTX.prs = {};
      chans.forEach((c) => {
        let q = null;
        try { q = MP().quick(g[c]); } catch { q = null; }
        if (q) REPORT_CTX.prs[c] = q;
        html[c] = q ? kpiStripHtml({ ...q, partial: true }) : kpiLoadingHtml(g.name, c);
      });
      paint();
      await Promise.all(chans.map(async (c) => {
        try {
          const pr = await MP()._buildSoon(g[c], (late) => { REPORT_CTX.prs[c] = late; html[c] = kpiStripHtml(late); paint(); });
          REPORT_CTX.prs[c] = pr;
          html[c] = kpiStripHtml(pr);
          paintRank(c, pr);
          prefetchReport(c, pr);
        } catch (err) {
          html[c] = `<section class="card msp-kpi-card" data-msp-kpi-ch="${c}"><div class="card-body dim small">⚠️ ${c === 'gv' ? 'GV' : 'FF'} profile nahi bana: ${esc((err && err.message) || err)}</div></section>`;
        }
        paint();
      }));
    }

    function displayGroupForChannel(g, channel) {
      if (!g) return g;
      if (!g.ff || !g.gv || !channel || channel === 'both') return g;
      return {
        ...g,
        key: `${g.key || normName(g.name)}|${channel}`,
        ff: channel === 'ff' ? g.ff : null,
        gv: channel === 'gv' ? g.gv : null,
        _selectedChannel: channel,
        _channelChoice: true,
        _sourceKey: g.key || normName(g.name)
      };
    }
    const channelChoiceHtml = (g, selected) => {
      if (!g || !g.ff || !g.gv) return '';
      const pick = (key, label) => `<button type="button" class="chip${selected === key ? ' on' : ''}" data-msp-channel="${key}" aria-pressed="${selected === key}">${label}</button>`;
      return `<div class="msp-channel-choice">
        <div><b>⚖ Ye agent / TL FF + GV dono me hai</b><small class="dim">Data mix-up se bachne ke liye channel select karo.</small></div>
        <div class="msp-channel-choice-btns">${pick('both','⚖ Dono')}${pick('ff','🟦 First Forward')}${pick('gv','🟩 GV Partner')}</div>
      </div>`;
    };
    function openGroup(g, channelOverride) {
      if (!g || !out) return;
      const selected = g.ff && g.gv ? (channelOverride || g._selectedChannel || 'both') : (g.ff ? 'ff' : 'gv');
      g._selectedChannel = selected;
      current = g;
      const viewGroup = displayGroupForChannel(g, selected);
      const person = viewGroup.ff || viewGroup.gv;
      if (trendEl) trendEl.hidden = true;     // the person's own day-wise chart + table now live inside the profile (no 2nd copy)
      const linkedTeams = teamPeopleFor(viewGroup);
      const pill = (p, cls, label) => (p ? `<span class="msp-pill ${cls}">${label} ${isTlP(p) ? 'TL' : 'Agent'}${p.sub ? ` <b>${esc(p.sub)}</b> <button type="button" class="cp-btn" data-copy="${esc(p.sub)}" title="Copy ID" aria-label="Copy ID">📋</button>` : ''}</span>` : '');
      // 🆕 NEW Agent tag — sirf agents (TL nahi); data aane par bharta hai
      const heroNewTags = (vg) => ['ff', 'gv'].map((c) => { const p = vg[c]; return p && !isTlP(p) ? `<span class="new-agent-slot" data-new-agent="${c}|${esc(p.sub || '')}|${esc(String(p.name || '').replace(/\|/g, ' '))}">${FF.newAgentTag ? FF.newAgentTag.html(c, p.sub, p.name) : ''}</span>` : ''; }).join('');
      const bits = `${pill(viewGroup.ff, 'ff', '🟦 First Forward')}${pill(viewGroup.gv, 'gv', '🟩 GV Partner')}`;
      const chips = groups.length > 1
        ? `<div class="msp-matches"><span class="dim small">${U.fmt(groups.length)} log mile — click karo:</span>${groups.slice(0, 12).map((gp, i) => `<button type="button" class="msp-chip${gp === g ? ' on' : ''}" data-msp-g="${i}">${esc(gp.name)}${gp.ff && gp.gv ? ' ⚖' : gp.gv ? ' 🟩' : ' 🟦'}</button>`).join('')}</div>`
        : '';
      const teamCards = linkedTeams.map((team) => {
        const chLabel = team.channel === 'gv' ? '🟩 GV Partner' : '🟦 First Forward';
        const id = team.person.sub ? ` · TL ID ${esc(team.person.sub)}` : '';
        return `<section class="card msp-team-card"><div class="card-head"><div><h3>👥 ${esc(team.person.name)} · ${chLabel} TL team${id}</h3><p class="dim small">All agents ka stock + issuance; TL ka apna issuance aur stock alag row me.</p></div></div><div class="card-body"><div class="msp-report" data-msp-team="${team.channel}"></div></div></section>`;
      }).join('');
      out.innerHTML = `${channelChoiceHtml(g, selected)}${chips}
        <div class="msp-hero">
          <span class="ms-avatar ${viewGroup.gv ? 'gv' : 'ff'}">${esc(String(g.name || '?').slice(0, 1).toUpperCase())}</span>
          <div class="msp-hero-id"><b>${esc(g.name)}</b> <button type="button" class="cp-btn" data-copy="${esc(g.name)}" title="Copy name" aria-label="Copy name">📋</button>${heroNewTags(viewGroup)}<div class="msp-pills">${bits || '<span class="msp-pill">Report</span>'}${viewGroup.ff && !isTlP(viewGroup.ff) ? `<span data-alias-of="${esc(viewGroup.ff.sub || '')}"></span>` : ''}</div></div>
          ${person ? `<div class="msp-hero-act">${FF.auth && FF.auth.can && FF.auth.can('export') ? '<button class="btn small primary" data-msp-report title="Choose: Full report / Stock + pivot (ageing auto) / Current month / Last month — Excel">⬇ Full report</button>' : ''}<button class="btn small" data-ms-tags="${esc(person.name)}">🏷️ Tag-level rows</button></div>` : ''}
        </div>
        <div id="msp-det" class="msp-det"></div>
        <div id="msp-kpis" class="msp-kpis-wrap">${['ff', 'gv'].filter((c) => viewGroup[c]).map((c) => kpiLoadingHtml(g.name, c)).join('')}</div>
        <div id="msp-rank"></div>
        ${gvStripHtml(viewGroup.gv)}${ffStripHtml(viewGroup.ff)}
        <div class="msp-report" id="msp-report"></div>${teamCards}`;
      const paintDet = () => {
        const host = out.querySelector('#msp-det');
        if (!host || current !== g) return;
        const contacts = !FF.auth || !FF.auth.can || FF.auth.can('contacts');
        const f = (k, v, mono) => `<div class="msp-det-f"><small>${k}</small><b${mono ? ' class="mono"' : ''}>${v ? esc(v) : '<span class="dim">—</span>'}</b></div>`;
        const mob = (m) => contacts ? (m && !/^na$/i.test(String(m)) ? esc(m) : '<span class="dim">—</span>') : '🔒';
        const card = (pp, ch) => {
          if (!pp) return '';
          let q = null;
          try { q = MP() && MP().supports(pp) ? MP().quick(pp) : null; } catch { q = null; }
          const tlKind = isTlP(pp);
          const id = (q && q.id) || pp.sub || '';
          const tl = q && q.tl ? q.tl : {};
          const tlName = tlKind ? pp.name : (tl.name || [...(pp.tlSet || [])][0] || '');
          const tlId = tlKind ? id : (tl.id || '');
          const tlMob = tlKind ? (q && q.mobile) : tl.mobile;
          return `<div class="msp-det-card ${ch}"><div class="msp-det-h">${ch === 'gv' ? '🟩 GV Partner' : '🟦 First Forward'} · ${tlKind ? 'Team Leader' : 'Agent'}</div><div class="msp-det-grid">
            <div class="msp-det-f"><small>${tlKind ? 'TL mobile' : 'Mobile'}</small><b>${mob(q && q.mobile)}</b></div>
            ${tlKind ? '' : f('TL name', pp.direct ? (pp.directLabel || 'Direct') : tlName)}
            ${tlKind ? '' : f('TL ID', tlId, true)}
            ${tlKind ? '' : `<div class="msp-det-f"><small>TL mobile</small><b>${mob(tlMob)}</b></div>`}
            ${q && q.status ? f('Status', q.status) : ''}${q && q.lastActive ? f('Last active', q.lastActive) : ''}
            ${pp.last ? f('Last allocation', pp.last) : ''}
          </div></div>`;
        };
        host.innerHTML = [card(viewGroup.ff, 'ff'), card(viewGroup.gv, 'gv')].join('');
      };
      paintDet();
      try { if (MP() && MP().loadFor) [viewGroup.ff, viewGroup.gv].filter(Boolean).forEach((pp) => { if (MP().supports(pp)) MP().loadFor(pp).then(paintDet).catch(() => {}); }); } catch { /* optional */ }
      paintKpis(viewGroup, U.$('#msp-kpis', out)).catch(() => {});
      try { if (FF.newAgentTag) FF.newAgentTag.paint(out); if (FF.aliases) FF.aliases.paint(out); } catch { /* ignore */ }
      const host = U.$('#msp-report', out);
      const sr = SR();
      if (sr && host) sr.render(host, viewGroup);
      else if (host && FF.masterProfile && FF.masterProfile.renderInto && person) FF.masterProfile.renderInto(host, person);
      else if (host) host.innerHTML = '<div class="card"><div class="card-body empty">Report module load nahi hua — page reload karo.</div></div>';
      linkedTeams.forEach((team) => {
        const teamHost = out.querySelector(`[data-msp-team="${team.channel}"]`);
        if (sr && teamHost) sr.render(teamHost, team.group);
        else if (teamHost && FF.masterProfile && FF.masterProfile.renderInto) FF.masterProfile.renderInto(teamHost, team.person);
      });
      try { FF.charts && FF.charts.mount && FF.charts.mount(out); } catch { /* charts optional */ }
    }


    const fallbackGroup = (p) => ({ key: normName(p.name), name: p.name, ff: chOfP(p) === 'ff' ? p : null, gv: chOfP(p) === 'gv' ? p : null });

    /** Ek se zyada match — sirf ek line ke naam-chips (koi list nahi); click par poora data. */
    function chipsOnly() {
      out.innerHTML = `<div class="card"><div class="card-body">
        <p class="dim small" style="margin:0 0 8px">${U.fmt(groups.length)} log mile — <b>naam par click karo</b>, uska poora FF + GV data neeche khul jayega:</p>
        <div class="msp-matches">${groups.slice(0, 20).map((gp, i) => `<button type="button" class="msp-chip" data-msp-g="${i}">${esc(gp.name)}${gp.ff && gp.gv ? ' <small>⚖</small>' : gp.gv ? ' <small>🟩</small>' : ' <small>🟦</small>'}</button>`).join('')}</div>
      </div></div>`;
    }

    let runSeq = 0;
    async function run(query, opts) {
      const seq = ++runSeq;
      const open = !opts || opts.open !== false;
      const q = clean(query);
      if (trendEl) trendEl.hidden = false;     // empty / list states keep the date-wise finder; openGroup hides it (profile has its own chart)
      if (q.length < 2) { out.innerHTML = '<div class="card"><div class="card-body empty">Kam se kam 2 letter / digit type karo.</div></div>'; return; }
      out.innerHTML = U.spinner(`“${q}” dhoondha ja raha hai…`);
      try { await buildLight(); } catch { /* index fail — neeche message */ }
      if (seq !== runSeq || !out.isConnected) return;
      paintState(); paintQuick();
      if (!state.light) { out.innerHTML = '<div class="card"><div class="card-body empty">Search index load nahi hua — internet check karke “🔄 Index refresh” dabao.</div></div>'; return; }
      if (seq !== runSeq || !out.isConnected) return;
      const res = search(q);
      // Exact URL/selection ID wins over same-name duplicates. Requested channel is authoritative.
      let exactRequestedPerson = null;
      if (askedId && chFilter) {
        const want = normId(askedId);
        const idx = state.full || state.light;
        exactRequestedPerson = idx && idx.people ? [...idx.people.values()].find((p) => {
          if (chOfP(p) !== chFilter) return false;
          return normId(p.sub || p.id) === want || [...(p.ids || []), ...(p.alias || []), ...(p.tlIds || [])].some((id) => normId(id) === want);
        }) || null : null;
      }
      const channelPeople = exactRequestedPerson ? [exactRequestedPerson] : (res.people || []).filter((p) => !chFilter || chOfP(p) === chFilter);
      const people = preferNameMatches(channelPeople, q);
      const sr = SR();
      groups = sr ? sr.groupPeople(people) : people.map(fallbackGroup);
      // Exact-name cross-channel match: keep one group with a visible FF/GV chooser so
      // the report never silently mixes the two datasets.
      const exactName = normName(q);
      if (exactName) {
        const sameName = groups.filter((g) => normName(g.name) === exactName);
        const hasFf = sameName.some((g) => !!g.ff), hasGv = sameName.some((g) => !!g.gv);
        if (hasFf && hasGv && sameName.length > 1) {
          const first = sameName[0];
          const merged = { ...first, ff: sameName.find((g) => g.ff)?.ff || null, gv: sameName.find((g) => g.gv)?.gv || null, _selectedChannel: 'both', _channelChoice: true };
          groups = [merged, ...groups.filter((g) => !sameName.includes(g))];
        }
      }
      groups.sort((a, b) => Number(!!b.gv) - Number(!!a.gv) || Number(!!b.ff) - Number(!!a.ff) || String(a.name).localeCompare(String(b.name)));
      if (groups.length) {
        let exactIdGroup = null, exactIdChannel = chFilter || '';
        if (askedId) {
          const want = normId(askedId);
          const matchId = (p) => !!p && (
            normId(p.sub || p.id) === want ||
            [...(p.ids || []), ...(p.alias || []), ...(p.tlIds || [])].some((id) => normId(id) === want)
          );
          exactIdGroup = groups.find((g) => (chFilter ? matchId(g[chFilter]) : matchId(g.gv) || matchId(g.ff))) || null;
          if (exactIdGroup && !chFilter) {
            if (matchId(exactIdGroup.gv)) exactIdChannel = 'gv';
            else if (matchId(exactIdGroup.ff)) exactIdChannel = 'ff';
          }
        }
        const preferred = exactIdGroup || (chFilter && groups.find((g) => !!g[chFilter])) || groups[0];
        if (open || groups.length === 1) openGroup(preferred, exactIdChannel || undefined); else chipsOnly();
        warmFull();
        return;
      }
      if ((res.ids || []).length || (res.tags || []).length) {
        out.innerHTML = `<div class="card"><div class="card-body"><h3 class="msp-h">🔖 ID / tag match</h3>${resultsHtml(res)}</div></div>`;
        fillDispatch(out, res);
        return;
      }
      out.innerHTML = `<div class="card"><div class="card-body empty">“${esc(q)}” ke liye kuch nahi mila — doosra naam / ID / mobile try karo${chFilter ? ' (ya channel filter hatao)' : ''}.</div></div>`;
    }

    async function runSelectedPerson(person) {
      const seq = ++runSeq;
      if (!person) return;
      const q = clean(person.name || person.sub || '');
      if (!q) return;
      if (input) input.value = q;
      out.innerHTML = U.spinner(`“${q}” ka profile khola ja raha hai…`);
      try { await buildLight(); } catch { /* profile fallback below */ }
      if (seq !== runSeq || !out.isConnected) return;
      const idx = state.full || state.light;
      const cp = canonicalPerson(person, idx) || person;
      const sr = SR();
      const gp = sr && sr.groupPeople ? sr.groupPeople([cp])[0] : fallbackGroup(cp);
      if (!gp) return;
      groups = [gp];
      openGroup(gp, chOfP(cp));
      try { warmFull(); } catch {}
    }

    if (input) {
      // 🔎 v3.52 — type karte hi suggestion dropdown (topbar wale search jaisa): agent / TL / ID /
      // mobile / barcode — har item ke saath stock · MTD · suggested. Pick → usi ka poora data.
      // (Enter ab U.suggest ke onEnter se chalta hai — pehle wala alag keydown handler double-run karta tha.)
      let sug = null;
      try {
        sug = U.suggest(input, {
          min: 1, max: 14,
          items: () => suggestItems(input.value),
          onPick: (it) => {
            if (!it || it.none) return;
            // Lock this page's suggestion instance after a selection. This prevents
            // onIndexReady / async refresh from reopening the exact same dropdown.
            try { if (sug && sug.suspend) sug.suspend(); } catch {}
            try { if (U.destroyAllSuggestions) U.destroyAllSuggestions(sug); } catch {}
            if (it.barcode) { run(it.barcode); return; }
            const person = it.person ? canonicalPerson(it.person, state.full || state.light) : null;
            if (person) { runSelectedPerson(person); return; }
            const name = it.value || it.label;
            run(name);
          },
          onEnter: (q) => {
            try { if (sug && sug.suspend) sug.suspend(); } catch {}
            if (clean(q).length >= 2) run(q);
          }
        });
      } catch { sug = null; }
      if (!sug) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(input.value); } });
      // Index / REPORT data aate hi khula dropdown refresh (warna "search ho raha hai…" atka rehta).
      let refreshT = 0;
      onIndexReady(() => { clearTimeout(refreshT); refreshT = setTimeout(() => { try { if (sug && sug.refresh && input.isConnected && document.activeElement === input && clean(input.value).length >= 2) sug.refresh(); } catch { /* ignore */ } }, 150); });
      root.__mspSuggestDestroy = () => { try { if (sug && sug.destroy) sug.destroy(); else if (sug && sug.close) sug.close(); } catch {} };
      // Khaali page par cursor seedha search me; URL me naam ho to focus nahi (warna dropdown report ke upar khul jaata).
      if (!asked) setTimeout(() => { try { input.focus(); } catch { /* ignore */ } }, 60);
    }
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-msp-go]')) { if (input) run(input.value); return; }
      if (e.target.closest('[data-msp-refresh]')) {
        invalidate(); out.innerHTML = U.spinner('Index dobara ban raha hai…');
        buildLight().then(() => { paintState(); paintQuick(); if (current) openGroup(current); else out.innerHTML = '<div class="card"><div class="card-body empty">Index ready ✓ — naam type karo.</div></div>'; }).catch(() => {});
        return;
      }
      const ch = e.target.closest('[data-msp-ch]');
      if (ch) { chFilter = ch.dataset.mspCh || ''; root.querySelectorAll('[data-msp-ch]').forEach((b) => b.classList.toggle('on', b === ch)); paintQuick(); if (input && clean(input.value).length >= 2) run(input.value, { open: false }); return; }
      const nm = e.target.closest('[data-msp-name]');
      if (nm) {
        const nmKey = normName(nm.dataset.mspName);
        const candidates = lightPeople()
          .filter((x) => normName(x.name) === nmKey && (!chFilter || chOfP(x) === chFilter))
          .sort((a, b) => (chOfP(a) === chFilter ? -1 : 1) || (isTlP(b) ? 1 : 0) - (isTlP(a) ? 1 : 0));
        const idPick = nm.dataset.mspPerson ? candidates.find((x) => `${x.kind}|${normId(x.sub || x.id || '')}` === nm.dataset.mspPerson) : null;
        const p = idPick || candidates[0];
        if (p) {
          try { if (U.destroyAllSuggestions) U.destroyAllSuggestions(); } catch {}
          if (input) input.value = p.name;
          const sr = SR();
          const gp = sr ? sr.groupPeople([p])[0] : fallbackGroup(p);
          openGroup(gp, chFilter || undefined);
        }
        return;
      }
      const channelBtn = e.target.closest('[data-msp-channel]');
      if (channelBtn && current) {
        const choice = channelBtn.dataset.mspChannel || 'both';
        openGroup(current, choice);
        return;
      }
      const gb = e.target.closest('[data-msp-g]');
      if (gb) { const gp = groups[Number(gb.dataset.mspG)]; if (gp) openGroup(gp); return; }
      const again = e.target.closest('[data-ms-again]');
      if (again) { const query = again.dataset.msAgain || ''; if (input) input.value = query; run(query); return; }
      const tlOpen = e.target.closest('[data-ms-open-tl]');
      if (tlOpen && FF.app && FF.app.navigate) { FF.app.navigate('masterSearch', { q: tlOpen.dataset.msTlName || '', id: tlOpen.dataset.msTlId || '', ch: tlOpen.dataset.msTlCh || '' }); return; }
      const tags = e.target.closest('[data-ms-tags]');
      if (tags && FF.app && FF.app.navigate) { FF.app.navigate('masterStock', { q: tags.dataset.msTags }); return; }
    });
    if (asked) run(asked);
    else { buildLight().then(() => { paintState(); paintQuick(); }).catch(() => {}); }
  }

  // ===== ⬇ v214 — Stock ageing box + Full report (Stock pivot · Issuance pivot · Ageing · tag rows) =====
  const REPORT_CTX = { name: '', prs: {}, cache: new Map() };
  const AGE_BUCKETS = [
    { k: 'a0', label: '0–1 mahina', min: 0, max: 29, tone: 'ok' },
    { k: 'a1', label: '1–3 mahine', min: 30, max: 89, tone: 'ok2' },
    { k: 'a3', label: '3–5 mahine', min: 90, max: 149, tone: 'warn' },
    { k: 'a5', label: '5–6 mahine', min: 150, max: 179, tone: 'warn2' },
    { k: 'a6', label: '6 mahine +', min: 180, max: 1e9, tone: 'bad' }
  ];
  const bucketOfAge = (age) => (age === null || age === undefined || age === '' || !Number.isFinite(Number(age)) ? null : AGE_BUCKETS.find((b) => Number(age) >= b.min && Number(age) <= b.max) || null);
  function ageScopeOfPr(pr, isTl, ch) {
    return isTl ? { kind: 'tl', key: pr.name, ch, title: pr.name } : { kind: 'agent', key: pr.id || pr.name, keys: [pr.name, pr.id].filter(Boolean), ch, title: pr.name };
  }
  // ===== 🚚 Last dispatch — Stock-sheet ledger (IDFC Stock Sheet FF / GV Stock Sheet): which date, which classes, how many =====
  const dispByCache = new Map();
  const dispTvc = (cls) => {
    const k = String(cls || '').toUpperCase().replace(/\s+/g, '');
    const g = (FF.config.tvcGroups || []).find((x) => `VC${x.tvc}` === k || (x.cch || []).some((c) => String(c).toUpperCase().replace(/\s+/g, '') === k));
    return g ? (String(g.tvc) === '4' ? 'VC4/20' : `VC${g.tvc}`) : (k || '—');
  };
  const dispClsNum = (c) => { const m = /\d+/.exec(String(c)); return m ? Number(m[0]) : 999; };
  const dispSplit = (clsMap) => {
    const m = new Map();
    Object.entries(clsMap || {}).forEach(([c, n]) => { const l = dispTvc(c); m.set(l, (m.get(l) || 0) + (Number(n) || 0)); });
    return [...m.entries()].filter(([, n]) => n > 0).sort((a, b) => dispClsNum(a[0]) - dispClsNum(b[0]));
  };
  const dispDate = (k) => { try { return U.labelDateKey ? U.labelDateKey(k) : k; } catch { return k; } };
  const dispAgo = (k) => {
    try { const d = U.fromDateKey(k), n = Math.round((new Date().setHours(0, 0, 0, 0) - d.getTime()) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; } catch { return ''; }
  };
  function dispSpecOf(pr, isTl, ch) {
    const names = [pr.name], ids = [pr.id].filter(Boolean);
    return { ch, names, ids, title: pr.name, isTl: !!isTl };
  }
  function dispBoxHtml(pr, isTl, ch) {
    const sc = dispSpecOf(pr, isTl, ch);
    return `<div class="mp-kpi msp-kpi k12 msp-disp-box kpi-clickable" data-msp-disp-box="${esc(JSON.stringify(sc))}" role="button" tabindex="0" title="Click for all recent dispatches"><small>🚚 Last dispatch</small><b class="msp-disp-main">…</b><em class="msp-disp-sub">${esc(ch === 'gv' ? 'GV Stock Sheet' : 'IDFC Stock Sheet')} · searching…</em></div>`;
  }
  async function dispFetch(sc) {
    const key = JSON.stringify(sc);
    if (!dispByCache.has(key)) {
      const pr = (async () => {
        let data = null;
        for (let i = 0; i < 40; i++) {
          data = await FF.auth.api('/api/dispatch-by', 'POST', { ch: sc.ch, names: sc.names, ids: sc.ids });
          if (!(data && data.pending)) break;
          await new Promise((r) => setTimeout(r, 2500));
        }
        if (!data || !data.ok || data.pending) throw new Error('Dispatch ledger is not ready yet');
        return data;
      })();
      dispByCache.set(key, pr);
      pr.catch(() => dispByCache.delete(key));
    }
    return dispByCache.get(key);
  }
  function dispPaint(box, d) {
    const main = box.querySelector('.msp-disp-main'), sub = box.querySelector('.msp-disp-sub');
    if (!main || !sub) return;
    if (d.none) { main.textContent = '—'; sub.textContent = d.reason || 'Dispatch ledger not set'; return; }
    if (!d.last) { main.textContent = 'No dispatch found'; sub.textContent = 'Not in the Stock sheet under this name / ID'; return; }
    const chips = dispSplit(d.last.cls).map(([c, n]) => `<span class="msp-hl blue">${esc(c)} ${U.fmt(n)}</span>`).join(' ');
    main.innerHTML = `${esc(dispDate(d.last.date))} <small class="dim">${esc(dispAgo(d.last.date))}</small>`;
    const more = (d.recent || []).slice(1, 3).map((r) => `<span class="dim small">${esc(dispDate(r.date))} · ${U.fmt(r.total)}</span>`).join(' · ');
    sub.innerHTML = `<b>${U.fmt(d.last.total)} tags</b> · ${chips}${more ? `<br>${more}` : ''}`;
  }
  function fillDispBoxes(host) {
    const boxes = host ? host.querySelectorAll('[data-msp-disp-box]') : [];
    boxes.forEach((box) => {
      if (box.__dispDone) return; box.__dispDone = true;
      let sc; try { sc = JSON.parse(box.dataset.mspDispBox); } catch { return; }
      dispFetch(sc).then((d) => { if (box.isConnected) { box.__disp = d; dispPaint(box, d); } }).catch((err) => {
        if (!box.isConnected) return;
        const sub = box.querySelector('.msp-disp-sub'), main = box.querySelector('.msp-disp-main');
        if (main) main.textContent = '—'; if (sub) sub.textContent = String((err && err.message) || err);
        box.__dispDone = false;
      });
    });
  }
  function openDispDrawer(box) {
    const d = box.__disp; let sc; try { sc = JSON.parse(box.dataset.mspDispBox); } catch { return; }
    if (!d || !d.recent || !d.recent.length || !FF.app || !FF.app.openDrawer) return;
    const rows = d.recent.map((r) => `<tr><td>${esc(dispDate(r.date))}<br><small class="dim">${esc(dispAgo(r.date))}</small></td><td class="num"><b>${U.fmt(r.total)}</b></td><td>${dispSplit(r.cls).map(([c, n]) => `<span class="msp-hl blue">${esc(c)} ${U.fmt(n)}</span>`).join(' ')}</td><td class="small">${(r.ranges || []).map((x) => `${esc(x.cls || '')} ${U.fmt(x.qty)}: ${esc(x.first)} → ${esc(x.last)}`).join('<br>')}</td></tr>`).join('');
    FF.app.openDrawer({ kicker: `${sc.ch === 'gv' ? 'GV' : 'FF'} dispatch ledger`, title: `${sc.title} · recent dispatches`, sub: `${U.fmt(d.totalDispatches || d.recent.length)} dispatch dates found · showing latest ${d.recent.length}`, body: `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Date</th><th class="num">Tags</th><th>Class-wise</th><th>Barcode range</th></tr></thead><tbody>${rows}</tbody></table></div>` });
  }
  // ===== 🪪 FASTag KYC box — EIR CUSTOMER_FULL_KYC (TRUE = full KYC, FALSE = not KYC): last + current month, class-wise =====
  const kycByCache = new Map();
  const kycPct = (p) => (p === null || p === undefined ? '—' : `${p.toFixed(1)}%`);
  function kycBoxHtml(pr, isTl) {
    const f = isTl ? { tl: pr.name } : { agent: pr.name };
    return `<div class="mp-kpi msp-kpi k12 msp-disp-box msp-kyc-box kpi-clickable" data-msp-kyc-box="${esc(JSON.stringify({ f, t: pr.name }))}" role="button" tabindex="0" title="Click for detailed KYC dashboard"><small>🪪 FASTag KYC ratio · last vs current month</small><b class="msp-kyc-main">…</b><em class="msp-disp-sub"><span class="dim small">Loading…</span></em></div>`;
  }
  function kycFetch(f) {
    const key = JSON.stringify(f);
    if (!kycByCache.has(key)) {
      const p = FF.model.loadKycMonthly(f);
      kycByCache.set(key, p); p.catch(() => kycByCache.delete(key));
    }
    return kycByCache.get(key);
  }
  function kycPaint(box, rows) {
    const main = box.querySelector('.msp-kyc-main'), sub = box.querySelector('.msp-disp-sub');
    if (!main || !sub) return;
    const cur = FF.util.ymKey(new Date()), last = FF.util.prevMonthKey(cur);
    const M = FF.model, U = FF.util;
    const pk = (ym, g) => (r) => r.ym === ym && (!g || r.group === g);
    const c = M.kycRatio(rows, pk(cur)), l = M.kycRatio(rows, pk(last));
    if (!c.total && !l.total) { main.textContent = '—'; sub.innerHTML = '<span class="dim small">Is agent / TL ke liye EIR me KYC data nahi mila</span>'; return; }
    const lastL = U.labelYM(last, true), curL = U.labelYM(cur, true);
    main.innerHTML = `<small class="dim">${esc(lastL)}</small> ${kycPct(l.pct)} <small class="dim">·</small> <small class="dim">${esc(curL)}</small> ${kycPct(c.pct)}`;
    const vrows = ['VC4', 'VC20', 'VC5+'].map((g) => {
      const a = M.kycRatio(rows, pk(last, g)), b = M.kycRatio(rows, pk(cur, g));
      return `<div class="kyc-vrow"><span class="kyc-vlbl">${g}</span><span class="kyc-vv"><small>${esc(lastL)}</small> <b>${kycPct(a.pct)}</b></span><span class="kyc-vv"><small>${esc(curL)}</small> <b>${kycPct(b.pct)}</b></span></div>`;
    }).join('');
    sub.innerHTML = `<div class="kyc-vlist">${vrows}</div>`;
  }
  function fillKycBoxes(host) {
    const boxes = host ? host.querySelectorAll('[data-msp-kyc-box]') : [];
    boxes.forEach((box) => {
      if (box.__kycDone) return; box.__kycDone = true;
      let f; try { f = JSON.parse(box.dataset.mspKycBox).f; } catch { return; }
      kycFetch(f).then((rows) => { if (box.isConnected) kycPaint(box, rows || []); }).catch((err) => {
        if (!box.isConnected) return;
        const main = box.querySelector('.msp-kyc-main'), sub = box.querySelector('.msp-disp-sub');
        if (main) main.textContent = '—'; if (sub) sub.textContent = String((err && err.message) || err);
        box.__kycDone = false;
      });
    });
  }
  function ageBoxHtml(pr, isTl, ch) {
    if (!FF.stockAge) return '';
    const sc = ageScopeOfPr(pr, isTl, ch);
    return `<div class="mp-kpi msp-kpi k11 msp-age-box" data-msp-age="${esc(JSON.stringify(sc))}"><small>🧓 Stock ageing <button type="button" class="msp-age-dl" data-msp-age-dl title="Saare stock tags (age ke saath) Excel">⬇</button></small><div class="msp-age-list">${U.loader ? U.loader('', { size: 'sm' }) : '…'}</div></div>`;
  }
  /** Node (cumulative ≥1/3/5/6 mahine) → alag-alag buckets. */
  function ageSplit(node) {
    const g = ['core', 'comm'];
    const sum = (f) => g.reduce((t, x) => t + (f(x) || 0), 0);
    const total = sum((x) => node.total[x]), unk = sum((x) => node.unknown[x]);
    const c = (m) => sum((x) => node.counts[x][m]);
    const known = total - unk;
    return { total, unk, n: [known - c(1), c(1) - c(3), c(3) - c(5), c(5) - c(6), c(6)].map((v) => Math.max(0, v)) };
  }
  function fillAgeBoxes(host) {
    const boxes = host ? host.querySelectorAll('[data-msp-age]') : [];
    if (!boxes.length || !FF.stockAge) return;
    FF.stockAge.ready().then(() => {
      boxes.forEach((box) => {
        if (!box.isConnected) return;
        const list = box.querySelector('.msp-age-list');
        let sc; try { sc = JSON.parse(box.dataset.mspAge); } catch { return; }
        const node = FF.stockAge.nodeFor(sc);
        if (!node) { list.innerHTML = `<span class="dim small">${FF.stockAge.error ? esc(FF.stockAge.error) : 'Ageing data nahi mila'}</span>`; return; }
        const a = ageSplit(node);
        const max = Math.max(1, ...a.n);
        list.innerHTML = AGE_BUCKETS.map((b, i) => `<button type="button" class="msp-age-row ${b.tone}" data-msp-age-b="${i}" title="${esc(b.label)} wale tags dekho"><span>${b.label}</span><i style="--w:${Math.round((a.n[i] / max) * 100)}%"></i><b>${U.fmt(a.n[i])}</b></button>`).join('')
          + (a.unk ? `<span class="dim small msp-age-unk">Date nahi: ${U.fmt(a.unk)}</span>` : '');
      });
    }).catch(() => {});
  }
  async function stockTagsFor(sc) {
    const key = `age|${JSON.stringify(sc)}`;
    if (!REPORT_CTX.cache.has(key)) {
      const pr = FF.stockAge.ready().then(() => FF.stockAge.fetchTags(sc, 0, '', 150000)).then((r) => (r && r.rows) || []);
      REPORT_CTX.cache.set(key, pr);
      pr.catch(() => REPORT_CTX.cache.delete(key));
    }
    return REPORT_CTX.cache.get(key);
  }
  const ageRowCells = (x) => [x.ch === 'gv' ? 'GV Partner' : 'First Forward', x.tagId, U.barcode ? U.barcode(x.barcode) : x.barcode, x.cls, x.agent, x.agentId || '', x.tl, x.date, x.age === null || x.age === undefined ? '' : x.age, (bucketOfAge(x.age) || { label: 'Date nahi' }).label];
  const AGE_HEAD = ['Channel', 'Tag ID', 'Barcode / serial', 'Class', 'Agent', 'Agent ID', 'TL', 'Allocated date', 'Age (days)', 'Age bucket'];
  async function openAgeBucket(box, idx) {
    let sc; try { sc = JSON.parse(box.dataset.mspAge); } catch { return; }
    const b = AGE_BUCKETS[idx];
    FF.app.openDrawer({ kicker: 'Stock ageing', title: `${sc.title} · ${b.label}`, body: U.spinner('Tags la rahe hain…'), wide: true, loading: true, age: false });
    try {
      const rows = (await stockTagsFor(sc)).filter((x) => bucketOfAge(x.age) === b);
      const show = rows.slice(0, 500);
      const byAgent = new Map(); rows.forEach((x) => byAgent.set(x.agent || '—', (byAgent.get(x.agent || '—') || 0) + 1));
      const top = [...byAgent.entries()].sort((p, q) => q[1] - p[1]).slice(0, 12).map(([k, v]) => `<span class="kd-chip">${esc(k)} <b>${U.fmt(v)}</b></span>`).join('');
      const body = `<p class="dim small">${U.fmt(rows.length)} tags · ${esc(b.label)} purane (allocation date se)${rows.length > show.length ? ' · pehli 500 dikh rahi — sab ke liye ⬇ Excel' : ''}</p>${top ? `<div class="kd-chips">${top}</div>` : ''}
        <div class="table-wrap"><table class="tbl compact"><thead><tr>${AGE_HEAD.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${show.map((x) => `<tr>${ageRowCells(x).map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${AGE_HEAD.length}" class="empty">Is bucket me koi tag nahi 🎉</td></tr>`}</tbody></table></div>`;
      const dl = FF.auth.can('export') ? '<button class="btn small" data-msp-age-xlsx>⬇ Excel</button>' : '';
      FF.app.openDrawer({ kicker: 'Stock ageing', title: `${sc.title} · ${b.label}`, sub: `${U.fmt(rows.length)} tags`, body, wide: true, actions: dl, age: false, replace: true });
      const btn = document.querySelector('#drawer-actions [data-msp-age-xlsx]');
      if (btn) btn.onclick = () => FF.xlsx.download(`stock-age-${U.slug(sc.title)}-${b.k}-${U.stamp()}.xlsx`, [{ name: b.label, header: AGE_HEAD, rows: rows.map(ageRowCells) }]);
    } catch (err) {
      FF.app.openDrawer({ kicker: 'Stock ageing', title: sc.title, body: U.errorBox(err), wide: true, replace: true, age: false });
    }
  }
  async function downloadAgeAll(box) {
    let sc; try { sc = JSON.parse(box.dataset.mspAge); } catch { return; }
    U.toast('⬇ Stock ageing Excel ban raha hai…', 'info');
    const rows = await stockTagsFor(sc);
    const piv = pivot(rows, (x) => x.agent || '—', (x) => (bucketOfAge(x.age) || { label: 'Date nahi' }).label, [...AGE_BUCKETS.map((b) => b.label), 'Date nahi']);
    FF.xlsx.download(`stock-age-${U.slug(sc.title)}-${U.stamp()}.xlsx`, [
      { name: 'Ageing pivot', header: ['Agent', ...piv.cols, 'Total'], rows: piv.rows },
      { name: 'Stock tags', header: AGE_HEAD, rows: rows.map(ageRowCells) }
    ]);
  }
  /** Rows → pivot (rowKey × colKey count) + Total row/column. */
  function pivot(rows, rowKey, colKey, fixedCols) {
    const m = new Map(), colSet = new Set(fixedCols || []);
    rows.forEach((x) => { const r = rowKey(x), c = colKey(x); colSet.add(c); if (!m.has(r)) m.set(r, new Map()); const mm = m.get(r); mm.set(c, (mm.get(c) || 0) + 1); });
    const cols = fixedCols ? [...colSet] : [...colSet].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    const out = [...m.entries()].map(([r, mm]) => { const vals = cols.map((c) => mm.get(c) || 0); return [r, ...vals, vals.reduce((t, v) => t + v, 0)]; }).sort((a, b) => b[b.length - 1] - a[a.length - 1]);
    const tot = cols.map((_, i) => out.reduce((t, r) => t + r[i + 1], 0));
    out.push(['TOTAL', ...tot, tot.reduce((t, v) => t + v, 0)]);
    return { cols, rows: out };
  }
  const ymOf = (d) => String(d || '').slice(0, 7);
  function reportSpecs(pr, ch) {
    const isTl = /tl$/.test(String(pr.kind || ''));
    const m = pr.months || {};
    const cur = m.cur || U.ymKey(new Date()), last = m.last || U.prevMonthKey(cur);
    const spec = isTl ? { src: ch, tl: pr.name, tlId: ch === 'gv' ? (pr.id || '') : '' } : { src: ch, agent: pr.name, agentId: pr.id || '' };
    return { isTl, spec, from: `${last}-01`, to: `${cur}-${U.pad2(U.daysInMonth(cur))}`, cur, last };
  }
  /** Data jutao (cache) — profile khulte hi peeche shuru, click par turant. */
  function reportData(ch, pr) {
    const key = `rep|${ch}|${pr.name}|${pr.id || ''}`;
    if (REPORT_CTX.cache.has(key)) return REPORT_CTX.cache.get(key);
    const r = reportSpecs(pr, ch);
    const sc = ageScopeOfPr(pr, r.isTl, ch);
    const job = Promise.all([
      FF.stockAge ? stockTagsFor(sc).catch(() => []) : Promise.resolve([]),
      (FF.kpiDetail && FF.kpiDetail.rawRowsFor ? FF.kpiDetail.rawRowsFor(r.spec, { from: r.from, to: r.to }) : Promise.resolve([])).catch(() => [])
    ]).then(([stock, issue]) => ({ ...r, stock, issue, sc }));
    REPORT_CTX.cache.set(key, job);
    job.catch(() => REPORT_CTX.cache.delete(key));
    setTimeout(() => REPORT_CTX.cache.delete(key), 10 * 60e3);
    return job;
  }
  function prefetchReport(ch, pr) {
    if (!pr || pr.partial || !(FF.auth && FF.auth.can && FF.auth.can('export'))) return;
    const go = () => { if (FF.kpiDetail && FF.stockAge) reportData(ch, pr).catch(() => {}); else if (FF.lazy && FF.lazy.shellNeed) FF.lazy.shellNeed(['kpiDetail', 'stockAge']).then(() => reportData(ch, pr)).catch(() => {}); };
    (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(go, { timeout: 4000 });
  }
  async function downloadFullReport(btn, parts) {
    const want = (k) => !parts || parts.includes(k);   // parts: 'stock' | 'cur' | 'last' (undefined = everything)
    const chans = ['ff', 'gv'].filter((c) => REPORT_CTX.prs[c]);
    if (!chans.length) { U.toast('Profile abhi load ho raha hai — 2 sec baad try karo', 'warn'); return; }
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Ban raha hai…'; }
    try {
      if (FF.lazy && FF.lazy.shellNeed) await FF.lazy.shellNeed(['kpiDetail', 'stockAge']);
      const sets = await Promise.all(chans.map((c) => reportData(c, REPORT_CTX.prs[c]).then((d) => ({ ch: c, pr: REPORT_CTX.prs[c], d }))));
      const sheets = [];
      const two = sets.length > 1;
      const sfx = (ch) => (two ? (ch === 'gv' ? ' GV' : ' FF') : '');
      const summary = [['Naam', REPORT_CTX.name], ['Report time', new Date().toLocaleString('en-IN')]];
      sets.forEach(({ ch, pr, d }) => {
        const c = (pr.calc && pr.calc.total) || {}, t = pr.totals || {}, s = pr.stock || {};
        const ages = AGE_BUCKETS.map((b) => d.stock.filter((x) => bucketOfAge(x.age) === b).length);
        summary.push([], [`${ch === 'gv' ? '🟩 GV Partner' : '🟦 First Forward'} · ${d.isTl ? 'TL' : 'Agent'}`, pr.name],
          ['Stock (total)', s.total || d.stock.length], ['Stock cover (din)', c.cover != null ? Math.round(c.cover) : ''], ['Run-rate / day', c.rate != null ? Math.round(c.rate * 10) / 10 : ''],
          [`Issued ${U.labelYM ? U.labelYM(d.cur) : d.cur}`, t.curTotal || 0], [`Issued ${U.labelYM ? U.labelYM(d.last) : d.last}`, t.lastTotal || 0], ['Priority', pr.priority || ''],
          ...AGE_BUCKETS.map((b, i) => [`Ageing · ${b.label}`, ages[i]]));
        const L = (ym) => (U.labelYM ? U.labelYM(ym) : ym);
        // 1) Stock + pivot — ageing buckets are added to the stock pivot automatically.
        const sp = pivot(d.stock, (x) => x.agent || '—', (x) => x.cls || 'NA');
        const ageCols = [...AGE_BUCKETS.map((b) => b.label), 'Date nahi'];
        const ap = pivot(d.stock, (x) => x.agent || '—', (x) => (bucketOfAge(x.age) || { label: 'Date nahi' }).label, ageCols);
        const ageMap = new Map(ap.rows.map((r) => [r[0], r.slice(1, 1 + ageCols.length)]));
        if (want('stock')) sheets.push({ name: `Stock pivot${sfx(ch)}`, header: ['Agent', ...sp.cols, 'Total', ...ageCols.map((c) => `Age · ${c}`)], rows: sp.rows.map((r) => [...r, ...(ageMap.get(r[0]) || ageCols.map(() => 0))]) });
        if (want('stock')) sheets.push({ name: `Stock${sfx(ch)}`, header: AGE_HEAD, rows: d.stock.map(ageRowCells) });
        // 2) Current month issuance + pivot, 3) Last month issuance + pivot
        [[d.cur, 'Current', 'cur'], [d.last, 'Last', 'last']].filter((x) => want(x[2])).forEach(([ym, lbl]) => {
          const rows = d.issue.filter((r) => ymOf(r[0]) === ym);
          const ip = pivot(rows, (r) => r[7] || '—', (r) => r[3] || 'NA');
          sheets.push({ name: `${lbl} issuance pivot${sfx(ch)}`.slice(0, 31), header: [`Agent · ${L(ym)}`, ...ip.cols, 'Total'], rows: ip.rows });
          sheets.push({ name: `${lbl} issuance${sfx(ch)}`.slice(0, 31), header: (FF.kpiDetail && FF.kpiDetail.RAW_HEAD) || ['Date', 'Tag ID', 'VRN', 'Class', 'Type', 'VRN type', 'Status', 'Agent', 'Agent ID', 'TL', 'Channel', 'Barcode / serial'], rows });
        });
      });
      sheets.unshift({ name: 'Summary', header: ['Field', 'Value'], rows: summary });
      FF.xlsx.download(`${U.slug(REPORT_CTX.name)}-${!parts ? 'full-report' : parts.join('-')}-${U.stamp()}.xlsx`, sheets);
      U.toast(parts ? '✅ Report download ho gayi' : '✅ Full report download ho gayi', 'ok');
    } catch (err) {
      U.toast('Report nahi bani: ' + ((err && err.message) || err), 'err');
    } finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
  }
  // ===== 📈 Growth drill — what is driving growth up / down (agent-wise for a TL, class-wise always) =====
  const growthGrp = (cls) => { const k = String(cls || '').toUpperCase().replace(/\s+/g, ''); return k === 'VC4' ? 'VC4' : k === 'VC20' ? 'VC20' : 'VC5+'; };
  const num = (v) => Number(v) || 0;
  function growthBreakdown(d, pr) {
    const p1 = pr.projT1 || {};
    const cut = Math.max(1, Math.round(num((p1.basis && p1.basis.growthElapsed) || (pr.calc && pr.calc.total && pr.calc.total.elapsed) || 31)));
    const people = new Map(), classes = new Map();
    const touch = (map, key, init) => { if (!map.has(key)) map.set(key, { ...init, curN: 0, lastN: 0, lastFull: 0, curFull: 0 }); return map.get(key); };
    d.issue.forEach((r) => {
      const ym = ymOf(r[0]), day = Number(String(r[0]).slice(8, 10)) || 0;
      if (ym !== d.cur && ym !== d.last) return;
      const p = touch(people, r[8] || r[7] || '—', { name: r[7] || '—', id: r[8] || '' });
      const c = touch(classes, growthGrp(r[3]), { name: growthGrp(r[3]) });
      [p, c].forEach((o) => {
        if (ym === d.cur) { o.curFull += 1; if (day <= cut) o.curN += 1; } else { o.lastFull += 1; if (day <= cut) o.lastN += 1; }
      });
    });
    const status = (o) => (o.curN > 0 && o.lastFull === 0 ? 'new' : o.curN === 0 && o.lastN > 0 ? 'stopped' : o.curN > o.lastN ? 'up' : o.curN < o.lastN ? 'down' : 'flat');
    const fin = (map) => [...map.values()].map((o) => ({ ...o, delta: o.curN - o.lastN, st: status(o) })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.curN - a.curN);
    const P = fin(people), C = fin(classes);
    const tot = P.reduce((a, o) => ({ cur: a.cur + o.curN, last: a.last + o.lastN }), { cur: 0, last: 0 });
    return { cut, P, C, tot };
  }
  const GROWTH_ST = { new: '<span class="msp-hl blue">🆕 New</span>', stopped: '<span class="msp-hl red">⏹ Stopped</span>', up: '<span class="msp-hl green">▲ Existing · up</span>', down: '<span class="msp-hl amber">▼ Existing · down</span>', flat: '<span class="msp-hl">= Existing · same</span>' };
  async function openGrowth(ch) {
    const pr = REPORT_CTX.prs[ch];
    if (!pr) { U.toast('Profile abhi load ho raha hai — 2 sec baad try karo', 'warn'); return; }
    const isTl = /tl$/.test(String(pr.kind || ''));
    FF.app.openDrawer({ kicker: 'Growth drivers', title: pr.name, body: U.spinner('Loading growth data…'), wide: true, loading: true, age: false });
    try {
      if (FF.lazy && FF.lazy.shellNeed) await FF.lazy.shellNeed(['kpiDetail', 'stockAge']);
      const d = await reportData(ch, pr);
      const g = growthBreakdown(d, pr);
      const pct = g.tot.last ? ((g.tot.cur - g.tot.last) / g.tot.last) * 100 : null;
      const L = (ym) => (U.labelYM ? U.labelYM(ym, true) : ym);
      const chip = (o) => `<span class="kd-chip">${esc(o.name)} <b>${o.delta > 0 ? '+' : ''}${U.fmt(o.delta)}</b></span>`;
      const ups = g.P.filter((o) => o.delta > 0).slice(0, 6), downs = g.P.filter((o) => o.delta < 0).slice(0, 6);
      const share = (o) => (g.tot.cur - g.tot.last ? `${Math.round((o.delta / (g.tot.cur - g.tot.last)) * 100)}%` : '—');
      const peopleTbl = `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>${isTl ? 'Agent' : 'Agent'}</th><th>ID</th><th>Status</th><th class="num">${esc(L(d.last))} (1–${g.cut})</th><th class="num">${esc(L(d.cur))} (1–${g.cut})</th><th class="num">Change</th><th class="num">Share of change</th><th class="num">Last month full</th></tr></thead><tbody>${g.P.map((o) => `<tr><td><b>${esc(o.name)}</b></td><td>${esc(o.id)}</td><td>${GROWTH_ST[o.st]}</td><td class="num">${U.fmt(o.lastN)}</td><td class="num">${U.fmt(o.curN)}</td><td class="num"><b style="font-size:inherit;display:inline;color:${o.delta > 0 ? '#16a34a' : o.delta < 0 ? '#dc2626' : 'inherit'}">${o.delta > 0 ? '+' : ''}${U.fmt(o.delta)}</b></td><td class="num">${share(o)}</td><td class="num">${U.fmt(o.lastFull)}</td></tr>`).join('') || '<tr><td colspan="8" class="dim">No issuance in these two months</td></tr>'}</tbody></table></div>`;
      const classTbl = `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">${esc(L(d.last))} (1–${g.cut})</th><th class="num">${esc(L(d.cur))} (1–${g.cut})</th><th class="num">Change</th><th class="num">Growth</th></tr></thead><tbody>${['VC4', 'VC20', 'VC5+'].map((k) => g.C.find((o) => o.name === k) || { name: k, curN: 0, lastN: 0, delta: 0 }).map((o) => `<tr><td><b>${esc(o.name)}</b></td><td class="num">${U.fmt(o.lastN)}</td><td class="num">${U.fmt(o.curN)}</td><td class="num">${o.delta > 0 ? '+' : ''}${U.fmt(o.delta)}</td><td class="num">${o.lastN ? U.pctHtml((o.delta / o.lastN) * 100, { decimals: 0 }) : (o.curN ? '<span class="msp-hl blue">new</span>' : '—')}</td></tr>`).join('')}</tbody></table></div>`;
      const newN = g.P.filter((o) => o.st === 'new').length, stopN = g.P.filter((o) => o.st === 'stopped').length;
      const body = `<p class="dim small">Same period compared: days 1–${g.cut} of ${esc(L(d.cur))} vs days 1–${g.cut} of ${esc(L(d.last))}. New = no issuance at all last month. Stopped = issued last month, none this month.</p>
        <p><b>${U.fmt(g.tot.last)}</b> → <b>${U.fmt(g.tot.cur)}</b> · ${pct === null ? 'no base' : U.pctHtml(pct, { decimals: 1 })} · ${U.fmt(g.P.length)} ${g.P.length === 1 ? 'agent' : 'agents'} · <span class="msp-hl blue">${U.fmt(newN)} new</span> <span class="msp-hl red">${U.fmt(stopN)} stopped</span></p>
        ${isTl && ups.length ? `<h4>▲ Growth is up because of</h4><div class="kd-chips">${ups.map(chip).join('')}</div>` : ''}
        ${isTl && downs.length ? `<h4>▼ Growth is down because of</h4><div class="kd-chips">${downs.map(chip).join('')}</div>` : ''}
        <h4>By class</h4>${classTbl}
        <h4>${isTl ? 'Agent-wise' : 'Agent'} change</h4>${peopleTbl}`;
      const dl = FF.auth.can('export') ? '<button class="btn small" data-msp-growth-xlsx>⬇ Excel</button>' : '';
      FF.app.openDrawer({ kicker: 'Growth drivers', title: `${pr.name} · growth`, sub: `${U.fmt(g.tot.last)} → ${U.fmt(g.tot.cur)}`, body, wide: true, actions: dl, age: false, replace: true });
      const btn = document.querySelector('#drawer-actions [data-msp-growth-xlsx]');
      if (btn) btn.onclick = () => FF.xlsx.download(`growth-${U.slug(pr.name)}-${U.stamp()}.xlsx`, [
        { name: 'Agents', header: ['Agent', 'ID', 'Status', `${L(d.last)} 1-${g.cut}`, `${L(d.cur)} 1-${g.cut}`, 'Change', 'Last month full', 'This month full'], rows: g.P.map((o) => [o.name, o.id, o.st, o.lastN, o.curN, o.delta, o.lastFull, o.curFull]) },
        { name: 'Classes', header: ['Class', `${L(d.last)} 1-${g.cut}`, `${L(d.cur)} 1-${g.cut}`, 'Change'], rows: ['VC4', 'VC20', 'VC5+'].map((k) => { const o = g.C.find((x) => x.name === k) || { lastN: 0, curN: 0, delta: 0 }; return [k, o.lastN, o.curN, o.delta]; }) }
      ]);
    } catch (err) {
      FF.app.openDrawer({ kicker: 'Growth drivers', title: pr.name, body: U.errorBox(err), wide: true, replace: true, age: false });
    }
  }
  document.addEventListener('click', (e) => {
    const gt = e.target && e.target.closest && e.target.closest('[data-msp-growth]');
    if (gt) { e.preventDefault(); e.stopImmediatePropagation(); openGrowth(gt.dataset.mspGrowth).catch(() => {}); }
  }, true);
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const rep = t.closest('[data-msp-report]');
    const pick = t.closest('[data-msp-rep-part]');
    if (pick) {
      e.preventDefault();
      const menu = pick.closest('.msp-rep-menu'); const btn = menu && menu.previousElementSibling; if (menu) menu.remove();
      const v = pick.dataset.mspRepPart; downloadFullReport(btn && btn.matches('[data-msp-report]') ? btn : null, v === 'all' ? null : v.split(','));
      return;
    }
    if (rep) {
      e.preventDefault();
      const open = rep.nextElementSibling && rep.nextElementSibling.classList.contains('msp-rep-menu');
      document.querySelectorAll('.msp-rep-menu').forEach((m) => m.remove());
      if (open) return;
      const m = document.createElement('div'); m.className = 'msp-rep-menu';
      m.innerHTML = '<button type="button" data-msp-rep-part="all">📦 Full report (sab kuch)</button><button type="button" data-msp-rep-part="stock">📊 Stock + pivot (ageing auto)</button><button type="button" data-msp-rep-part="cur">📅 Current month issuance + pivot</button><button type="button" data-msp-rep-part="last">📆 Last month issuance + pivot</button><button type="button" data-msp-rep-part="stock,cur">📊📅 Stock + Current month</button>';
      rep.insertAdjacentElement('afterend', m);
      return;
    }
    if (!t.closest('.msp-rep-menu')) document.querySelectorAll('.msp-rep-menu').forEach((m) => m.remove());
    const dl = t.closest('[data-msp-age-dl]');
    if (dl) { e.preventDefault(); e.stopPropagation(); const box = dl.closest('[data-msp-age]'); if (box) downloadAgeAll(box).catch((err) => U.toast(String((err && err.message) || err), 'err')); return; }
    const kbox = t.closest('[data-msp-kyc-box]');
    if (kbox) { e.preventDefault(); e.stopPropagation(); try { const sp = JSON.parse(kbox.dataset.mspKycBox); if (FF.kycDetail) FF.kycDetail.open({ title: `${sp.t} · FASTag KYC`, filter: sp.f }); } catch { /* ignore */ } return; }
    const dbox = t.closest('[data-msp-disp-box]');
    if (dbox) { e.preventDefault(); e.stopPropagation(); openDispDrawer(dbox); return; }
    const row = t.closest('[data-msp-age-b]');
    if (row) { e.preventDefault(); e.stopPropagation(); const box = row.closest('[data-msp-age]'); if (box) openAgeBucket(box, Number(row.dataset.mspAgeB)); }
  }, true);

  // ===== 🏆 v215 — Agent ranking in TL (score = issuance 50% + sell-through 30% + growth 20%) =====
  const RANK = { sort: 'score', data: {} };
  function rankRows(pr) {
    const c = (pr.calc && pr.calc.total) || {};
    const el = Math.max(1, Number(c.elapsed) || new Date().getDate());
    const m = pr.months || {};
    const lastDays = m.last ? U.daysInMonth(m.last) : 30;
    const list = (pr.agents || []).filter((a) => a && a.name && (a.cur || a.last || a.stockTotal));
    const maxCur = Math.max(1, ...list.map((a) => a.cur || 0));
    const rows = list.map((a) => {
      const rate = (a.cur || 0) / el, lastRate = (a.last || 0) / lastDays;
      const growth = lastRate ? ((rate - lastRate) / lastRate) * 100 : (rate ? 100 : 0);
      const sell = (a.cur || 0) + (a.stockTotal || 0) ? (a.cur || 0) / ((a.cur || 0) + (a.stockTotal || 0)) * 100 : 0;
      const cover = rate ? (a.stockTotal || 0) / rate : null;
      const score = Math.round(((a.cur || 0) / maxCur) * 50 + (sell / 100) * 30 + (Math.max(-100, Math.min(100, growth)) + 100) / 200 * 20);
      return { name: a.name, id: a.id || '', cur: a.cur || 0, last: a.last || 0, stock: a.stockTotal || 0, rate, growth, sell, cover, score, priority: a.priority || '' };
    });
    return rows;
  }
  function rankSorted(rows, by) {
    const k = { score: (x) => -x.score, cur: (x) => -x.cur, growth: (x) => -x.growth, sell: (x) => -x.sell, cover: (x) => (x.cover == null ? 1e9 : x.cover) }[by] || ((x) => -x.score);
    return rows.slice().sort((a, b) => k(a) - k(b) || b.cur - a.cur);
  }
  function rankHtml(ch, pr) {
    const rows = RANK.data[ch] && RANK.data[ch].rows;
    if (!rows || rows.length < 2) return '';
    const by = RANK.sort, list = rankSorted(rows, by), n = list.length;
    const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`);
    const chip = (k, label) => `<button type="button" class="chip${by === k ? ' on' : ''}" data-msp-rank-sort="${k}">${label}</button>`;
    const coverTxt = (x) => (x.cover == null ? (x.stock ? '<span class="badge red">∞ (0 issuance)</span>' : '—') : `${U.fmt(Math.round(x.cover))} din`);
    const body = list.map((x, i) => `<tr class="${i < 3 ? 'msp-rank-top' : i >= n - 3 && n > 6 ? 'msp-rank-bottom' : ''}">
        <td class="num"><b>${medal(i)}</b></td>
        <td><a href="#/masterSearch?q=${encodeURIComponent(x.name)}${x.id ? `&id=${encodeURIComponent(x.id)}` : ''}&ch=${ch}"><b>${esc(x.name)}</b></a>${x.priority ? ` <small class="dim">${esc(x.priority)}</small>` : ''}</td>
        <td class="num"><b>${U.fmt(x.score)}</b><i class="msp-rank-bar" style="--w:${x.score}%"></i></td>
        <td class="num">${U.fmt(x.cur)}</td><td class="num">${U.fmt(x.last)}</td>
        <td class="num">${U.pctHtml ? U.pctHtml(x.growth, { decimals: 0 }) : `${Math.round(x.growth)}%`}</td>
        <td class="num">${U.fmt(x.stock)}</td><td class="num">${U.fmt(Math.round(x.sell))}%</td><td class="num">${coverTxt(x)}</td></tr>`).join('');
    return `<section class="card msp-rank-card" data-msp-rank-ch="${ch}"><div class="card-head"><div>
        <h3>🏆 Agent ranking · ${esc(pr.name)} ki team ${ch === 'gv' ? '🟩 GV' : '🟦 FF'}</h3>
        <p class="dim small">Score (0–100) = Issuance 50% + Stock use (sell-through) 30% + Growth (run-rate vs last month) 20% · 🟩 top 3 · 🟥 bottom 3</p></div>
        <div class="card-right">${FF.auth && FF.auth.can && FF.auth.can('export') ? `<button class="btn small" data-msp-rank-xlsx="${ch}">⬇ Excel</button>` : ''}</div></div>
      <div class="card-body"><div class="chip-row msp-rank-sorts"><span class="dim small">Sort:</span>${chip('score', '🏆 Score')}${chip('cur', '🏷️ Issuance')}${chip('growth', '📈 Growth')}${chip('sell', '🔄 Stock use')}${chip('cover', '⏳ Cover (kam pehle)')}</div>
      <div class="table-wrap"><table class="tbl compact msp-rank-tbl"><thead><tr><th>Rank</th><th>Agent</th><th class="num">Score</th><th class="num">MTD</th><th class="num">Last month</th><th class="num">Growth</th><th class="num">Stock</th><th class="num">Stock use</th><th class="num">Cover</th></tr></thead><tbody>${body}</tbody></table></div></div></section>`;
  }
  function paintRank(ch, pr) {
    if (!pr || pr.partial || !/tl$/.test(String(pr.kind || ''))) return;
    RANK.data[ch] = { pr, rows: rankRows(pr) };
    const host = document.getElementById('msp-rank');
    if (!host) return;
    const old = host.querySelector(`[data-msp-rank-ch="${ch}"]`);
    const html = rankHtml(ch, pr);
    if (old) old.outerHTML = html; else host.insertAdjacentHTML(ch === 'ff' ? 'afterbegin' : 'beforeend', html);
  }

  document.addEventListener('click', (e) => {
    const t = e.target; if (!t || !t.closest) return;
    const srt = t.closest('[data-msp-rank-sort]');
    if (srt) { RANK.sort = srt.dataset.mspRankSort; Object.keys(RANK.data).forEach((ch) => { const host = document.getElementById('msp-rank'); const old = host && host.querySelector(`[data-msp-rank-ch="${ch}"]`); if (old) old.outerHTML = rankHtml(ch, RANK.data[ch].pr); }); return; }
    const rx = t.closest('[data-msp-rank-xlsx]');
    if (rx) {
      const d = RANK.data[rx.dataset.mspRankXlsx]; if (!d) return;
      FF.xlsx.download(`${U.slug(d.pr.name)}-agent-ranking-${U.stamp()}.xlsx`, [{ name: 'Ranking', header: ['Rank', 'Agent', 'Agent ID', 'Score', 'MTD', 'Last month', 'Growth %', 'Stock', 'Stock use %', 'Cover (din)', 'Priority'], rows: rankSorted(d.rows, RANK.sort).map((x, i) => [i + 1, x.name, x.id, x.score, x.cur, x.last, Math.round(x.growth), x.stock, Math.round(x.sell), x.cover == null ? '' : Math.round(x.cover), x.priority]) }]);
      return;
    }
  });

  FF.pages.masterSearch = { title: 'Master Search', render: pageRender };

  /** v3.78 — barcode suggestions (Fastag Mapping ke barcode box ke liye). Barcode ke prefix/beech ke digits se
   *  match; har item me tag ID, agent, TL, class. Full (barcode) index ready na ho to pending:true deta hai. */
  function barcodeSuggest(q, limit) {
    const want = normBar(q);
    const idx = state.full || state.light;
    if (!idx || !idx.bars || !idx.bars.size) { try { warmFull(); } catch { /* ignore */ } return { pending: true, items: [] }; }
    if (want.length < 3) return { pending: false, items: [] };
    const cap = Math.max(1, Math.min(30, Number(limit) || 12));
    const items = [];
    const keys = idx.barKeys && idx.barKeys.length ? idx.barKeys : [...idx.bars.keys()];
    const substring = want.length >= 6;
    for (let i = 0; i < keys.length && items.length < cap; i++) {
      const key = keys[i];
      if (!(key.startsWith(want) || (substring && key.includes(want)))) continue;
      const e = idx.bars.get(key); if (!e) continue;
      const pool = e.ff.length ? e.ff : e.gv;
      const r = pool.find((x) => x && (x.agentName || x.agentId)) || pool[0] || {};
      const src = e.ff.length ? 'FF' : 'GV';
      items.push({ barcode: key, tagId: r.tagId || '', agentId: r.agentId || '', agentName: r.agentName || '', tlName: r.tlName || '', cls: r.cls || '', channel: src, owners: e.ff.length + e.gv.length });
    }
    items.sort((a, b) => (b.barcode === want) - (a.barcode === want) || (a.barcode.length - b.barcode.length));
    return { pending: false, items };
  }

  FF.masterSearch = {
    buildLight, buildFull, warmFull, barcodeSuggest, invalidate, search, preferNameMatches, suggestItems, resultsHtml, openPanel, closePanel,
    mountTopbar, openSearchPage, onIndexReady, personByKey, linkedTlFor, teamPeopleFor, _limits: LIMITS,
    gvc: GVC,
    reloadCommission() { GVC.data = null; GVC.failAt = 0; return GVC.load(true); },
    get ready() { return !!(state.light); }, get heavyReady() { return !!(state.full && state.full.fullLoaded); },
    get topbarMounted() { return mountedTopbar; },
    label: KIND_LABEL
  };
})(window.FF);