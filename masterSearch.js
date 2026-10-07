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
  const normBar = normId;
  const KIND_LABEL = { 'ff-agent': 'FF Agent', 'gv-agent': 'GV Agent', 'ff-tl': 'FF TL', 'gv-tl': 'GV TL', 'gv-id': 'GV ID', 'agent-id': 'Agent ID' };
  const KIND_ICON = { 'ff-agent': '🧑‍💼', 'gv-agent': '🧑‍💼', 'ff-tl': '👥', 'gv-tl': '👥', 'gv-id': '🆔', 'agent-id': '🆔' };

  const state = { generation: 0, light: null, lightPromise: null, full: null, fullPromise: null, lastQuery: '', results: null, listeners: new Set() };
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
        ffReport: (FF.pages.performance && FF.pages.performance.ensureLoaded ? FF.pages.performance.ensureLoaded().then(() => FF.pages.performance.agents()) : Promise.resolve([]))
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
          if (++tick % 2500 === 0) await U.breathe();
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
          if (++tick % 2500 === 0) await U.breathe();
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
          if (++tick % 2500 === 0) await U.breathe();
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
          if (++tick % 2500 === 0) await U.breathe();
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
          if (++tick % 2500 === 0) await U.breathe();
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
          if (++tick % 2500 === 0) await U.breathe();
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
      const stop = async () => { if (++tick % 3000) return false; await U.breathe(); return generation !== state.generation; };
      for (const r of details.stock || []) {
        if (await stop()) return state.full;
        const key = normBar(r.barcode || r.tagId);
        if (!key) continue;
        const e = barEntry(idx, key);
        const owner = clean(r.agentName || r.agentId);
        if (!e.ff.some((x) => normName(x.agentName) === normName(owner) && normId(x.agentId) === normId(r.agentId))) {
          e.ff.push({ barcode: key, tagId: clean(r.tagId), agentId: clean(r.agentId), agentName: owner, tlName: clean(r.tlName), cls: clean(r.cls), allocated: stamp(r.agentAllocatedAt || r.bcAllocatedAt) });
        }
        const p = person(idx, 'ff-agent', owner, r.tlName, r.cls, r.agentId);
        if (p) { p.bars.add(key); if (!p.last) p.last = stamp(r.agentAllocatedAt || r.bcAllocatedAt); }
        if (clean(r.tlName)) { const t = person(idx, 'ff-tl', r.tlName, '', r.cls, ''); if (t) t.bars.add(key); }
      }
      for (const r of details.assignment || []) {
        if (await stop()) return state.full;
        const key = normBar(r.serial || r.tagId);
        if (!key) continue;
        const e = barEntry(idx, key);
        const owner = clean(r.agentName || r.agentId);
        if (!e.gv.some((x) => normId(x.gvId) === normId(r.gvUniqueId) && normName(x.agentName) === normName(owner))) {
          e.gv.push({ barcode: key, tagId: clean(r.tagId), agentId: clean(r.agentId), agentName: owner, tlName: clean(r.tlName), cls: clean(r.cls), gvId: clean(r.gvUniqueId), gvName: clean(r.gvUniqueName), allocated: stamp(r.allocatedAt) });
        }
        const p = person(idx, 'gv-agent', owner, r.tlName, r.cls, r.agentId);
        if (p) { p.bars.add(key); if (!p.last) p.last = stamp(r.allocatedAt); }
        if (clean(r.tlName)) { const t = person(idx, 'gv-tl', r.tlName, '', r.cls, ''); if (t) t.bars.add(key); }
        if (clean(r.gvUniqueName) || clean(r.gvUniqueId)) {
          const g = person(idx, 'gv-id', r.gvUniqueName || r.gvUniqueId, r.tlName, r.cls, r.gvUniqueId);
          if (g) g.bars.add(key);
        }
      }
      indexLookups(idx);
      if (generation !== state.generation) return state.full;
      idx.fullLoaded = true;
      state.full = idx;
      state.fullPromise = null;
      emit();
      return idx;
    })().catch(() => { if (generation === state.generation) state.fullPromise = null; return state.light; });
    return state.fullPromise;
  }
  /** Kick the heavy layer off in the background (non-blocking) — suggestions upgrade automatically. */
  function warmFull() {
    // 🏷️ Barcode register ke liye insights.js chahiye — wo ab lazy module hai, isliye pehle background
    // me load karo (topbar search khulte hi register bhi taiyaar ho jata hai).
    const ready = (name) => (typeof FF[name] !== 'undefined' ? Promise.resolve() : (FF.lazy && FF.lazy.inject ? FF.lazy.inject(name) : Promise.resolve()));
    ready('masterProfile').then(() => {
      // Har dataset aate hi dropdown / kundli refresh (pehle sab ke khatam hone tak "REPORT load ho raha hai…" rehta tha).
      if (FF.masterProfile && FF.masterProfile.onData && !state.mpSub) state.mpSub = FF.masterProfile.onData(emit);
      if (FF.masterProfile && FF.masterProfile.warm) return FF.masterProfile.warm();
    }).then(emit).catch(() => {});
    ready('insights').then(() => { state.fullPromise = null; if (!state.full && !state.fullPromise) return buildFull(); }).catch(() => {});
  }
  const MP = () => (FF.masterProfile && FF.masterProfile.supports ? FF.masterProfile : null);
  const allPeople = () => [...((state.full || state.light || {}).people || new Map()).values()];
  const personByKey = (key) => ((state.full || state.light || {}).people || new Map()).get(key) || null;
  const personKey = (p) => `${p.kind}|${normName(p.name)}`;

  // ---------------------------------------------------------------- query
  function search(q) {
    const idx = state.full || state.light;
    const query = clean(q);
    const out = { q: query, people: [], tags: [], ids: [], heavy: !!(state.full && state.full.fullLoaded), matched: 0 };
    if (!idx || !query) return out;
    const nql = query.toLowerCase();
    const nn = normName(query);
    const ni = normId(query);
    const wantsTags = ni.length >= 4 && /\d/.test(query);

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
        if (key === ni || key.startsWith(ni) || (substring && key.includes(ni))) { const entry = idx.bars.get(key); if (entry) out.tags.push(entry); }
      }
      out.tags.sort((a, b) => a.key.length - b.key.length || (b.ff.length + b.gv.length) - (a.ff.length + a.gv.length));
      if (out.tags.length > 120) out.tags.length = 120;
    }
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
    res.people = res.people.filter((p) => {
      if (!/^ff-/.test(String(p.kind || ''))) return true;
      const same = exactGv.filter((g) => normName(g.name) === normName(p.name));
      return !same.length || same.some((g) => identitiesLinked(g, p));
    });
    res.ids = (res.ids || []).filter((v) => {
      if (!/^ff-/.test(String(v.kind || ''))) return true;
      const same = exactGv.filter((g) => normName(g.name) === normName(v.name));
      return !same.length || same.some((g) => identitiesLinked(g, { sub: v.id, ids: [v.id] }));
    });
    return res;
  }

  /** Suggestions for U.suggest() — label + sub + kind chip. */
  /** Suggestions for U.suggest() — direct/fallback matching so 1-2 letters bhi reliably dropdown me aaye. */
  function suggestItems(q) {
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

    const filteredPeople = people;
    const items = [];
    filteredPeople.slice(0, 14).forEach((p) => {
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
        sub: [p.sub ? `ID ${p.sub}` : '', tl ? `TL ${p.direct ? (p.directLabel || tl) : tl}` : '', ...extra, !q1 && (p.issuanceN || p.bars.size || p.n) ? `${U.fmt(p.issuanceN || p.bars.size || p.n)} tags` : ''].filter(Boolean).join(' · '),
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
        sub: [f ? `FF ${f.agentName}` : '', g ? `GV ${g.agentName}` : '', (f && f.cls) || (g && g.cls) || ''].filter(Boolean).join(' · '),
        value: t.key, barcode: t.key
      });
    });
    if (!items.length && query.length >= 2) items.push({ kind: 'cls', kindLabel: 'Search', label: `“${query}” ke liye kuch nahi mila`, sub: 'Doosra naam / ID / barcode try karo', value: query, none: true });
    return items;
  }
  // ---------------------------------------------------------------- results panel (kundli)
  const classPills = (map) => [...(map || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, n]) => `<span class="ms-pill">${esc(c)} <b>${U.fmt(n)}</b></span>`).join('') || '<span class="dim small">class data nahi</span>';

  function tagStatus(t) {
    const f = t.ff[0], g = t.gv[0];
    const isGhostFf = /APNA ?PAY/i.test(f ? f.agentName : '');
    const isGhostGv = !g || !clean(g.agentName) || /NOT ?ASSIGN|UNASSIGN|^-$/i.test(clean(g.agentName));
    if (f && g) return normName(f.agentName) === normName(g.agentName) ? { t: 'Matched', tone: 'green' }
      : isGhostFf || isGhostGv ? { t: 'Normal flow (ghost holder)', tone: 'blue' } : { t: 'Owner mismatch', tone: 'amber' };
    if (g) return { t: FF.gv && FF.gv.enabled && FF.gv.enabled() ? 'GV only (StockDataa me nahi)' : 'GV only', tone: 'red' };
    return { t: 'FF only', tone: 'amber' };
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
    const tlStockBaseSpec = !isTlKind && q1.direct ? '' : `src=${q1.ch}&scope=stock&tl=${encodeURIComponent(tlNameForSpec)}`;
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
        <small>📦 Stock${row.isTl ? ' · own + agents' : ''}</small><b>${U.fmt(row.stock)}</b><em>VC4 ${U.fmt(row.stockVc4)} · Comm ${U.fmt(row.stockComm)}${row.isTl && row.ownStock != null ? ` · own ${U.fmt(row.ownStock)} + agents ${U.fmt(row.agentsStock || 0)}` : ''}</em></div>
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
          <small><span class="badge ${p.kind.startsWith('gv') ? 'green' : 'blue'}">${p.kind.startsWith('gv') ? '🟩 GV Partner' : '🟦 First Forward'}</span> <span class="badge ${/tl$/.test(p.kind) ? 'purple' : 'blue'}">${esc(KIND_LABEL[p.kind] || p.kind)}</span>${p.sub ? ` · ID <b class="mono">${esc(p.sub)}</b>` : ''}</small>
        </div>
      </div>
      ${strip}
      ${row && row.issuance && MP() && MP().issuanceCardsHtml ? MP().issuanceCardsHtml(row.issuance) : ''}
      <div class="ms-kundli-stats">
        <div><small>TL</small><b>${p.direct ? `<span class="direct-chip">🚫 ${esc(tl)}</span>` : esc(tl || '—')}</b>${row && row.tlId && !p.direct ? `<em>${esc(row.tlId)}</em>` : ''}</div>
        <div><small>Tags / barcodes</small><b>${p.bars.size ? U.fmt(p.bars.size) : U.fmt(p.n)}</b></div>
        <div><small>Activity rows</small><b>${U.fmt(p.n)}</b></div>
        <div><small>Last allocation</small><b>${esc(p.last || '—')}</b></div>
      </div>
      ${kundliProfileStats(p)}
      <div class="ms-pill-row">${classPills(p.classMap)}</div>
      <div class="ms-kundli-actions">
        ${MP() && SR() && MP().supports(p) ? `<button class="btn small primary" data-ms-inline="${esc(personKey(p))}">📂 Yahin poori report</button>` : ''}
        ${MP() && MP().supports(p) ? `<button class="btn small${SR() ? '' : ' primary'}" data-ms-profile="${esc(personKey(p))}">📊 Poori report${SR() ? ' (drawer)' : ''}</button>` : ''}
        <a class="btn small" href="#/masterStock?q=${encodeURIComponent(p.name)}">🗄️ Register</a>
        ${p.kind.includes('agent') ? `<button class="btn small" data-ms-agent360="${esc(p.name)}">👁 Agent 360</button>` : ''}
        <button class="btn small" data-ms-tags="${esc(p.name)}">🏷️ Tags</button>
      </div>
    </article>`;
  }

  function resultsHtml(res) {
    if (!res.matched) {
      return `<div class="ms-empty"><b>“${esc(res.q)}” ke liye kuch nahi mila</b>
        <p>Naam, TL, agent ID, TL ID, GV ID, barcode ya tag ID se search karo. Spelling ya ID ke kuch digits bhi kaafi hain.</p>
        ${res.heavy ? '' : '<p class="dim small">Barcode / tag register abhi background me load ho raha hai — thodi der baad barcode search bhi chalega.</p>'}</div>`;
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
        <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Barcode / serial</th><th>Tag ID</th><th>FF holder</th><th>FF TL</th><th>GV holder</th><th>GV TL</th><th>GV unique</th><th>Class</th><th>Status</th><th>Allocated</th></tr></thead><tbody>
        ${res.tags.slice(0, 60).map((t) => {
        const f = t.ff[0] || {}, g = t.gv[0] || {};
        const st = tagStatus(t);
        return `<tr><td><b>${esc(U.barcode(t.key))}</b></td><td>${esc((f.tagId || g.tagId) || '—')}</td>
            <td>${esc(f.agentName || '—')}${f.agentId ? `<small>${esc(f.agentId)}</small>` : ''}</td><td>${esc(tlText(f.tlName, 'ff') || '—')}</td>
            <td>${esc(g.agentName || '—')}${g.agentId ? `<small>${esc(g.agentId)}</small>` : ''}</td><td>${esc(tlText(g.tlName, 'gv') || '—')}</td>
            <td>${esc(g.gvName || '—')}${g.gvId ? `<small>${esc(g.gvId)}</small>` : ''}</td><td>${esc(f.cls || g.cls || '—')}</td>
            <td><span class="badge ${st.tone}">${esc(st.t)}</span></td><td>${esc(f.allocated || g.allocated || '—')}</td></tr>`;
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
          <div><span class="ms-panel-kicker">🔎 Master search</span><h2>${esc(res.q || o.title || 'Results')}</h2>
            <small class="dim">${U.fmt(res.matched)} match · ${res.heavy ? 'barcode register ready ✓' : 'barcode register loading…'}</small></div>
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
        const rows = [];
        res.tags.forEach((tt) => { const f = tt.ff[0] || {}, g = tt.gv[0] || {}; const st = tagStatus(tt); rows.push(['Tag', U.barcode(tt.key), f.agentName || '', f.tlName || '', g.agentName || '', g.tlName || '', g.gvName || '', f.cls || g.cls || '', st.t, f.allocated || g.allocated || '', 1]); });
        res.people.forEach((p) => rows.push(['Person', p.name, KIND_LABEL[p.kind] || p.kind, [...p.tlSet].join(' / '), p.sub || '', '', '', [...p.classMap.keys()].join(' '), '', p.last || '', p.bars.size || p.n || 0]));
        res.ids.forEach((v) => rows.push(['ID', v.id, v.name || '', KIND_LABEL[v.kind] || v.kind, v.tl || '', '', '', '', '', '', 1]));
        const totCount = U.sum(rows, (r) => Number(r[10]) || 0);
        rows.push(['Grand Total', `${rows.length} matches`, '', '', '', '', '', '', '', '', totCount]);
        U.downloadCsv(`master-search-${U.slug(res.q || 'results')}-${U.stamp()}.csv`,
          ['Type', 'Key / Name', 'FF or Agent', 'TL / Role', 'GV holder / ID', 'GV TL', 'GV unique', 'Class', 'Status', 'Allocated / Last', 'Count'], rows);
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
    const name = clean(q);
    if (name.length < 2) { U.toast('Kam se kam 2 letter / digit type karo', 'warn'); return false; }
    const p = person || {};
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
          <input id="master-search-input" class="input" type="search" placeholder="Search all — FF/GV agent, TL, ID, barcode, tag ID…" autocomplete="off"
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
        if (it.none) return;
        if (it.barcode) { openPanel(it.barcode); return; }              // 🏷️ barcode/tag = tag-level rows (list yahan theek)
        if (it.person && it.person.name) { openSearchPage(it.person.name, it.person); return; }
        openSearchPage(it.label);
      },
      onEnter: (q) => { if (clean(q).length >= 2) openSearchPage(q); }
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
    state.full = null; state.fullPromise = null;
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
      const list = lightPeople()
        .filter((p) => !chFilter || chOfP(p) === chFilter)
        .sort((a, b) => (isTlP(b) ? 1 : 0) - (isTlP(a) ? 1 : 0) || String(a.name).localeCompare(String(b.name)))
        .slice(0, 10);
      quick.innerHTML = list.length
        ? `<span class="dim small">⚡ Turant kholo:</span>${list.map((p) => `<button type="button" class="msp-chip" data-msp-name="${esc(p.name)}">${isTlP(p) ? '👥' : '🧑‍💼'} ${esc(p.name)}</button>`).join('')}`
        : '<span class="dim small">Index ban raha hai — 2 second me suggestions aa jayenge.</span>';
    }
    paintQuick();

    /** 🟩 GV ka aaj / mahina / stock — GV Master ledger + Tag Assignment (live). */
    function gvStripHtml(person) {
      if (!person || chOfP(person) !== 'gv' || !FF.gvTruth || !FF.gvTruth.person) return '';
      let t = null;
      try { t = FF.gvTruth.person(gvSpec(person)); } catch { return ''; }
      if (!t) return '';
      const g = U.growth(t.ledger.cur.total, t.ledger.last.total);
      const tk = (FF.gv && FF.gv.todayKey) ? FF.gv.todayKey() : U.dateKey(new Date());
      const warn = (t.warnings && t.warnings.length) ? `<p class="dim small">⚠️ ${esc(t.warnings[0])}</p>` : '';
      return `<div class="msp-today"><h3>⚡ Aaj ka snapshot <span class="dim">· GV Master (live)</span></h3><div class="dgrid">
        <div class="dcell"><small>🟩 GV aaj · ${esc(U.labelDateKey(tk))}</small><b>${U.fmt(t.ledger.today.total)}</b><em class="dim">VC4 ${U.fmt(t.ledger.today.vc4)} · Comm ${U.fmt(t.ledger.today.comm)}</em></div>
        <div class="dcell"><small>🗓️ ${esc(t.ym)} / ${esc(t.lastYm)}</small><b>${U.fmt(t.ledger.cur.total)} / ${U.fmt(t.ledger.last.total)}</b><em>${g === null || g === undefined ? '<span class="dim">—</span>' : U.pctHtml(g, { decimals: 0 })}</em></div>
        <div class="dcell"><small>📦 Stock · Tag Assignment</small><b>${U.fmt(t.stock.total)}</b><em class="dim">VC4 ${U.fmt(t.stock.vc4)} · Comm ${U.fmt(t.stock.comm)}</em></div>
      </div>${warn}</div>`;
    }

    /** 🟦 FF ka aaj — EIR daily rows se (First Forward ka data T+1 aata hai). */
    function ffStripHtml(person) {
      if (!person || chOfP(person) !== 'ff') return '';
      const daily = (FF.store && FF.store.get && FF.store.get('daily')) || [];
      const tk = U.dateKey(new Date());
      const nk = normName(person.name);
      const isT = isTlP(person), id = clean(person.sub || person.id || '');
      const mine = daily.filter((r) => r.channel !== 'GV Partner' && (isT ? normName(r.tlName) === nk : (normName(r.agentName) === nk || (id && normName(r.agentId) === normName(id)))));
      const sumOn = (key) => mine.filter((r) => r.key === key).reduce((s, r) => s + (Number(r.n) || 0), 0);
      const n = sumOn(tk);
      // v3.52 — FF ka data T+1 aata hai, isliye sirf "aaj 0" dikhana bekaar tha: ab kal (ya jo aakhri
      // din data me hai) ka issuance + last 7 din ka jod bhi, VC4 · VC20 · VC5+ ke saath.
      const back = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return U.dateKey(d); };
      const lastKey = mine.map((r) => String(r.key)).filter((k) => k < tk).sort().pop() || back(1);
      const lastN = sumOn(lastKey);
      const from7 = back(7);
      const week = mine.filter((r) => String(r.key) >= from7 && String(r.key) < tk);
      const bins = { vc4: 0, vc20: 0, vc5p: 0, total: 0 };
      week.forEach((r) => { const q = Number(r.n) || 0; bins.total += q; if (r.group === 'VC4') bins.vc4 += q; else if (r.group === 'VC20') bins.vc20 += q; else bins.vc5p += q; });
      return `<div class="msp-today"><h3>⚡ Aaj ka snapshot <span class="dim">· First Forward (EIR)</span></h3><div class="dgrid">
        <div class="dcell"><small>🟦 FF aaj · ${esc(U.labelDateKey(tk))}</small><b>${U.fmt(n)}</b><em class="dim">FF ka aaj ka poora data T+1 (kal) aata hai</em></div>
        <div class="dcell"><small>📅 Aakhri din · ${esc(U.labelDateKey(lastKey))}</small><b>${U.fmt(lastN)}</b><em class="dim">jo aakhri din data me hai</em></div>
        <div class="dcell"><small>🗓️ Last 7 din (kal tak)</small><b>${U.fmt(bins.total)}</b><em class="dim">VC4 ${U.fmt(bins.vc4)} · VC20 ${U.fmt(bins.vc20)} · VC5+ ${U.fmt(bins.vc5p)}</em></div>
      </div></div>`;
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
          <span class="msp-tsum vc4"><small>🚗 VC4</small><b>${U.fmt(tot('vc4'))}</b>${pct(tot('vc4'))}</span>
          <span class="msp-tsum vc20"><small>🛻 VC20</small><b>${U.fmt(tot('vc20'))}</b>${pct(tot('vc20'))}</span>
          <span class="msp-tsum vc5p"><small>🚚 VC5+</small><b>${U.fmt(tot('vc5p'))}</b>${pct(tot('vc5p'))}</span>
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
    function kpiStripHtml(pr) {
      if (!pr) return '';
      const isTl = /tl$/.test(String(pr.kind || '')), ch = pr.ch || chOfP(pr);
      const s = pr.stock || {}, t = pr.totals || {}, d = pr.dispatch || {}, ts = pr.tlStock || {}, m = pr.months || {};
      const c = (pr.calc && pr.calc.total) || {};
      const p1 = pr.projT1 || null;
      let bins = {};
      try { bins = (MP() && MP().groupBinsFor && MP().groupBinsFor(pr)) || {}; } catch { bins = {}; }
      const mix = (b) => (b && (num(b.VC4) || num(b.VC20) || num(b['VC5+'])) ? `VC4 ${U.fmt(b.VC4)} · VC20 ${U.fmt(b.VC20)} · VC5+ ${U.fmt(b['VC5+'])}` : '');
      const stockMix = mix(bins.stock) || `VC4 ${U.fmt(s.vc4)} · Comm ${U.fmt(s.comm)}`;
      const curMix = mix(bins.cur) || `VC4 ${U.fmt(t.curVc4)} · Comm ${U.fmt(t.curComm)}`;
      const lastMix = mix(bins.last) || `VC4 ${U.fmt(t.lastVc4)} · Comm ${U.fmt(t.lastComm)}`;
      const who = isTl ? `tl=${encodeURIComponent(pr.name)}${pr.id && ch === 'gv' ? `&tlId=${encodeURIComponent(pr.id)}` : ''}` : `agent=${encodeURIComponent(pr.name)}${pr.id ? `&agentId=${encodeURIComponent(pr.id)}` : ''}`;
      const spec = (scope, ym) => `src=${ch}&scope=${scope}${ym ? `&ym=${encodeURIComponent(ym)}` : ''}&${who}`;
      const peopleSpec = `src=${ch}&scope=people&tl=${encodeURIComponent(pr.name)}&self=0&sort=stock`;
      const box = (cls, label, value, sub, kpi) => `<div class="mp-kpi msp-kpi ${cls}${kpi ? ' kpi-clickable' : ''}"${kpi ? ` data-kpi="${esc(kpi)}" role="button" tabindex="0" title="Detail kholo"` : ''}><small>${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
      const ownAgents = ts.own && ts.agents ? `own ${U.fmt(ts.own.total)} + agents ${U.fmt(ts.agents.total)}` : '';
      const tlName = (pr.tl && pr.tl.name) || '';
      let sug = '';
      if (pr.tagRequired) {
        sug = box('k7', `🏷️ Tags required · ${U.fmt(d.days)} din`, sugPair(num(d.sugVc4) + num(d.sugComm), num(d.sugVc4Gross) + num(d.sugCommGross)), `VC4 ${U.fmt(d.sugVc4)} + Comm ${U.fmt(d.sugComm)} · ${esc(pr.directLabel || 'Direct')} · priority ${esc(pr.priority || '—')}`);
      } else if (pr.direct) {
        sug = box('k4', '🎯 Suggested dispatch', '<span class="dim">No dispatch</span>', `🚫 ${esc(pr.directLabel || 'Direct agent')} · priority ${esc(pr.priority || 'Low')} — abhi tags ki zarurat nahi`);
      } else {
        sug = box('k4', `🎯 Sug. VC4 · ${U.fmt(d.days)} din`, sugPair(d.sugVc4, d.sugVc4Gross || 0), `avg ${U.fmt(d.avgVc4, true)}/day × ${U.fmt(d.days)} din − stock ${U.fmt(s.vc4)}`, `${spec('mtd', m.cur)}&group=VC4`)
          + box('k5', '🎯 Sug. Commercial', sugPair(d.sugComm, d.sugCommGross || 0), `avg ${U.fmt(d.avgComm, true)}/day × ${U.fmt(d.days)} din − stock ${U.fmt(s.comm)}`, `${spec('mtd', m.cur)}&group=COMM`)
          + box('k9', '🎯 Dispatch · all tags', sugPair(c.net, c.gross), `run-rate ${U.fmt(c.rate, true)}/day × ${U.fmt(c.days)} din − stock ${U.fmt(c.stock)}`);
      }
      const growthNum = (pr.growthNum !== null && pr.growthNum !== undefined && Number.isFinite(Number(pr.growthNum))) ? Number(pr.growthNum) : U.growth(num(t.curTotal), num(t.lastTotal));
      const growthHtml = (growthNum === null || growthNum === undefined || !Number.isFinite(Number(growthNum))) ? '<span class="dim">—</span>' : U.pctHtml(growthNum, { decimals: 0 });
      const notFound = pr.found === false
        ? `<p class="dim small msp-kpi-note">⚠️ ${ch === 'gv' ? 'GV REPORT' : 'REPORT'} tab me is ${isTl ? 'TL' : 'agent'} ki row nahi mili — stock / priority sheet se nahi aa paaye (naam ki spelling check karo); issuance tag-ledger (EIR) se hai.</p>` : '';
      return `<section class="card msp-kpi-card" data-msp-kpi-ch="${ch}"><div class="card-head"><div>
          <h3>${ch === 'gv' ? '🟩 GV Partner' : '🟦 First Forward'} · ${isTl ? 'TL (own + agents)' : 'Agent'} — ek nazar me${pr.id ? ` <small class="dim mono">· ${esc(pr.id)}</small>` : ''}</h3>
          <p class="dim small">📦 stock · 🏷️ issuance (VC4 · VC20 · VC5+) · 🚦 priority · 🎯 suggested dispatch — ${isTl ? 'TL + saare agents ka jod' : `sirf is agent ka${tlName && !pr.direct ? ` · TL ${esc(tlName)}` : ''}`}${pr.partial ? ' · <span class="badge amber">⏳ data aa raha hai</span>' : ''}</p></div>
          <div class="card-right">${prioChip(pr.priority)}</div></div>
        <div class="card-body"><div class="mp-kpis msp-kpis">
          ${box('k1', `📦 Stock${isTl ? ' · TL total' : ' · apna'}`, U.fmt(s.total), `${isTl && ownAgents ? `${ownAgents} · ` : ''}${stockMix}`, spec('stock'))}
          ${isTl
    ? box('k2', '🧑‍💼 Agents', `${U.fmt(pr.agentCount)}${pr.selfAgent ? ' + TL' : ''}`, 'click → agents ki list (stock · issuance ke saath)', peopleSpec)
    : box('k2', '📦 TL ke under stock', ts.has ? U.fmt(ts.total) : '—', ts.has ? `${ownAgents ? `${ownAgents} · ` : ''}TL ${esc(tlName || '—')}` : (pr.direct ? `🚫 ${esc(pr.directLabel || 'Direct — koi TL nahi')}` : 'TL ka stock nahi mila'), ts.has && tlName ? `src=${ch}&scope=stock&tl=${encodeURIComponent(tlName)}` : '')}
          ${box('k6', `🏷️ Issued this month${m.cur ? ` · ${esc(ymLabel(m.cur))}` : ''}`, U.fmt(t.curTotal), curMix, spec('mtd', m.cur))}
          ${box('k8', `📅 Last month${m.last ? ` · ${esc(ymLabel(m.last))}` : ''}`, U.fmt(t.lastTotal), lastMix, spec('month', m.last))}
          ${box('k3', '🚦 Priority', prioChip(pr.priority), `${c.cover != null ? `cover ${U.fmt(c.cover, true)} din` : 'cover —'} · run-rate ${U.fmt(c.rate, true)}/day (÷ ${U.fmt(c.elapsed)} din)`, isTl ? peopleSpec : '')}
          ${sug}
          ${box('k0', `📈 Growth${(p1 && (p1.growthThrough || (p1.basis && p1.basis.growthThrough) || (p1.basis && p1.basis.shortLabel))) ? ` <small class="dim">till ${esc(p1.growthThrough || (p1.basis && p1.basis.growthThrough) || p1.basis.shortLabel)}</small>` : ''}`, growthHtml, p1 && p1.total ? `expected month-end ${U.fmt(p1.total)}` : 'last month vs MTD')}
        </div>${notFound}</div></section>`;
    }
    const kpiLoadingHtml = (name, ch) => `<section class="card msp-kpi-card" data-msp-kpi-ch="${ch}"><div class="card-body">${U.spinner(`${esc(name)} ka ${ch === 'gv' ? '🟩 GV' : '🟦 FF'} stock · issuance · priority · suggested load ho raha hai…`)}</div></section>`;
    /** Group (FF + GV) ke har channel ka KPI card — pehle quick (memory wala data), phir poora profile aate hi upgrade. */
    async function paintKpis(g, host) {
      if (!host || !MP()) return;
      const chans = ['ff', 'gv'].filter((c) => g[c]);
      const html = {};
      const paint = () => { if (host.isConnected !== false && current === g) host.innerHTML = chans.map((c) => html[c] || '').join(''); };
      chans.forEach((c) => {
        let q = null;
        try { q = MP().quick(g[c]); } catch { q = null; }
        html[c] = q ? kpiStripHtml({ ...q, partial: true }) : kpiLoadingHtml(g.name, c);
      });
      paint();
      await Promise.all(chans.map(async (c) => {
        try {
          const pr = await MP()._buildSoon(g[c], (late) => { html[c] = kpiStripHtml(late); paint(); });
          html[c] = kpiStripHtml(pr);
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
        _channelChoice: true
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
      trendFollow(person);
      const linkedTeams = teamPeopleFor(viewGroup);
      const bits = [viewGroup.ff ? `🟦 FF ${isTlP(viewGroup.ff) ? 'TL' : 'Agent'}${viewGroup.ff.sub ? ` · ${esc(viewGroup.ff.sub)}` : ''}` : '', viewGroup.gv ? `🟩 GV ${isTlP(viewGroup.gv) ? 'TL' : 'Agent'}${viewGroup.gv.sub ? ` · ${esc(viewGroup.gv.sub)}` : ''}` : ''].filter(Boolean).join('  ·  ');
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
          <div class="msp-hero-id"><b>${esc(g.name)}</b><small>${bits || 'Report'}</small></div>
          ${person ? `<div class="msp-hero-act"><button class="btn small" data-ms-tags="${esc(person.name)}">🏷️ Tag-level rows</button></div>` : ''}
        </div>
        <div id="msp-kpis" class="msp-kpis-wrap">${['ff', 'gv'].filter((c) => viewGroup[c]).map((c) => kpiLoadingHtml(g.name, c)).join('')}</div>
        ${gvStripHtml(viewGroup.gv)}${ffStripHtml(viewGroup.ff)}
        <div class="msp-report" id="msp-report"></div>${teamCards}`;
      paintKpis(viewGroup, U.$('#msp-kpis', out)).catch(() => {});
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

    async function run(query, opts) {
      const open = !opts || opts.open !== false;
      const q = clean(query);
      if (q.length < 2) { out.innerHTML = '<div class="card"><div class="card-body empty">Kam se kam 2 letter / digit type karo.</div></div>'; return; }
      out.innerHTML = U.spinner(`“${q}” dhoondha ja raha hai…`);
      try { await buildLight(); } catch { /* index fail — neeche message */ }
      paintState(); paintQuick();
      if (!state.light) { out.innerHTML = '<div class="card"><div class="card-body empty">Search index load nahi hua — internet check karke “🔄 Index refresh” dabao.</div></div>'; return; }
      const res = search(q);
      const channelPeople = (res.people || []).filter((p) => !chFilter || chOfP(p) === chFilter);
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
        const exactIdGroup = askedId ? groups.find((g) => {
          const p = (chFilter && g[chFilter]) || g.ff || g.gv;
          return !!p && normId(p.sub || p.id) === normId(askedId);
        }) : null;
        const preferred = exactIdGroup || (chFilter && groups.find((g) => !!g[chFilter])) || groups[0];
        if (open || groups.length === 1) openGroup(preferred, chFilter || undefined); else chipsOnly();
        warmFull();
        return;
      }
      if ((res.ids || []).length || (res.tags || []).length) {
        out.innerHTML = `<div class="card"><div class="card-body"><h3 class="msp-h">🔖 ID / tag match</h3>${resultsHtml(res)}</div></div>`;
        return;
      }
      out.innerHTML = `<div class="card"><div class="card-body empty">“${esc(q)}” ke liye kuch nahi mila — doosra naam / ID / mobile try karo${chFilter ? ' (ya channel filter hatao)' : ''}.</div></div>`;
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
            if (it.barcode) { input.value = it.barcode; run(it.barcode); return; }
            const name = (it.person && it.person.name) || it.value || it.label;
            input.value = name;
            run(name);
          },
          onEnter: (q) => { if (clean(q).length >= 2) run(q); }
        });
      } catch { sug = null; }
      if (!sug) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(input.value); } });
      // Index / REPORT data aate hi khula dropdown refresh (warna "search ho raha hai…" atka rehta).
      let refreshT = 0;
      onIndexReady(() => { clearTimeout(refreshT); refreshT = setTimeout(() => { try { if (sug && sug.refresh && input.isConnected && document.activeElement === input && clean(input.value).length >= 2) sug.refresh(); } catch { /* ignore */ } }, 150); });
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
      if (ch) { chFilter = ch.dataset.mspCh || ''; $$('[data-msp-ch]', root).forEach((b) => b.classList.toggle('on', b === ch)); paintQuick(); if (input && clean(input.value).length >= 2) run(input.value, { open: false }); return; }
      const nm = e.target.closest('[data-msp-name]');
      if (nm) {
        const nmKey = normName(nm.dataset.mspName);
        const candidates = lightPeople()
          .filter((x) => normName(x.name) === nmKey && (!chFilter || chOfP(x) === chFilter))
          .sort((a, b) => (chOfP(a) === chFilter ? -1 : 1) || (isTlP(b) ? 1 : 0) - (isTlP(a) ? 1 : 0));
        const p = candidates[0];
        if (p) {
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
      const tags = e.target.closest('[data-ms-tags]');
      if (tags && FF.app && FF.app.navigate) { FF.app.navigate('masterStock', { q: tags.dataset.msTags }); return; }
    });
    if (asked) run(asked);
    else { buildLight().then(() => { paintState(); paintQuick(); }).catch(() => {}); }
  }

  FF.pages.masterSearch = { title: 'Master Search', render: pageRender };

  FF.masterSearch = {
    buildLight, buildFull, warmFull, invalidate, search, preferNameMatches, suggestItems, resultsHtml, openPanel, closePanel,
    mountTopbar, openSearchPage, onIndexReady, personByKey, linkedTlFor, teamPeopleFor, _limits: LIMITS,
    get ready() { return !!(state.light); }, get heavyReady() { return !!(state.full && state.full.fullLoaded); },
    get topbarMounted() { return mountedTopbar; },
    label: KIND_LABEL
  };
})(window.FF);