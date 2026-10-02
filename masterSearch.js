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
  const normId = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
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
      barKeys: [],         // integer IDs used by the compact barcode substring index
      barPrefixes: new Map(), // first 4 normalized barcode characters → keys
      barGrams: new Map(), // 6-character barcode gram → integer IDs
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
  function person(idx, kind, name, tlName, cls, sub) {
    const nm = clean(name);
    if (!nm) return null;
    // 🧍 Placeholder TL names ("APS", "Direct", "Unassigned") kabhi TL card nahi banate.
    if (kind === 'ff-tl' || kind === 'gv-tl') { if (!FF.config.isRealTl(nm)) return null; }
    const k = `${kind}|${normName(nm)}`;
    let p = idx.people.get(k);
    if (!p) { p = { kind, name: nm, sub: sub || '', tlSet: new Set(), classMap: new Map(), bars: new Set(), last: '', n: 0, direct: false }; idx.people.set(k, p); }
    if (sub && !p.sub) p.sub = clean(sub);
    if (kind === 'ff-agent' || kind === 'gv-agent') {
      const ch = kind === 'gv-agent' ? 'gv' : 'ff';
      const direct = FF.config.isDirectAgent({ tlName, channel: ch === 'gv' ? 'GV Partner' : 'First Forward' }, ch);
      if (direct) { p.direct = true; p.directLabel = FF.config.directLabel({ tlName }, ch); }
    }
    if (clean(tlName) && !(p.direct && !FF.config.isRealTl(clean(tlName)))) p.tlSet.add(clean(tlName));
    if (clean(cls)) p.classMap.set(clean(cls), (p.classMap.get(clean(cls)) || 0) + 1);
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
  const barEntry = (idx, key) => {
    let e = idx.bars.get(key);
    if (e) return e;
    e = { key, ff: [], gv: [] };
    idx.bars.set(key, e);
    const id = idx.barKeys.length;
    idx.barKeys.push(key);
    if (key.length >= 4) pushBucket(idx.barPrefixes, key.slice(0, 4), key);
    if (key.length >= 6) {
      const grams = new Set();
      for (let i = 0; i <= key.length - 6; i++) grams.add(key.slice(i, i + 6));
      grams.forEach((gram) => pushBucket(idx.barGrams, gram, id));
    }
    return e;
  };

  /** Layer 1 — aggregated rows (instant, never blocks on barcode scans). */
  async function buildLight() {
    if (state.light) return state.light;
    if (state.lightPromise) return state.lightPromise;
    const generation = state.generation;
    state.lightPromise = (async () => {
      const idx = newIndex();
      const [agents, stockAgents, gvMaster, gvIssuance, gvReport, gvStockAgent, gvStockTl, ffReport] = await Promise.allSettled([
        FF.store.need('agents'), FF.store.need('stockAgents'), FF.gv.need('master'),
        FF.store.need('daily').then(() => (FF.gv.issuanceRows ? FF.gv.issuanceRows() : [])),
        FF.gv.need('report'), FF.gv.need('stockAgent'), FF.gv.need('stockTl'),
        // 🔎 FF REPORT: old/alt agent ID (ID column) · TL ID · TL mobile — search me bhi aayenge
        (FF.pages.performance && FF.pages.performance.ensureLoaded ? FF.pages.performance.ensureLoaded().then(() => FF.pages.performance.agents()) : Promise.resolve([]))
      ]);
      const canMob = (() => { try { return !FF.auth || FF.auth.can('contacts'); } catch { return true; } })();
      const addAlias = (p, ...vals) => { if (!p) return; p.alias = p.alias || new Set(); vals.forEach((v) => { const t = clean(v); if (t && !/^na$/i.test(t)) p.alias.add(t); }); };
      const addMobile = (m, name, kind, tl) => { if (!canMob) return; const d = String(m || '').replace(/\D/g, '').slice(-10); if (d.length === 10) idx.mobiles.set(`${d}|${kind}|${normName(name)}`, { mobile: d, name: clean(name), kind, tl: clean(tl) }); };
      if (ffReport.status === 'fulfilled') {
        for (const a of ffReport.value || []) {
          const ap = person(idx, 'ff-agent', a.name || a.agentId, a.tlName, '', a.agentId || a.id);
          addAlias(ap, a.agentId, a.id, a.gvIdFound);
          [a.agentId, a.id].forEach((v) => { if (clean(v) && !/^na$/i.test(clean(v))) idx.ids.set(normId(v), { name: clean(a.name || v), kind: 'ff-agent', tl: clean(a.tlName) }); });
          addMobile(a.mobile || (/^\d{10}$/.test(clean(a.agentId)) ? a.agentId : ''), a.name, 'ff-agent', a.tlName);
          if (clean(a.tlName) && FF.config.isRealTl(clean(a.tlName))) {
            const tp = person(idx, 'ff-tl', a.tlName, '', '', a.tlId);
            addAlias(tp, a.tlId, canMob ? a.tlMobile : '');
            if (clean(a.tlId) && !/^na$/i.test(clean(a.tlId))) idx.ids.set(`${normId(a.tlId)}:tl`, { name: clean(a.tlName), kind: 'ff-tl' });
            addMobile(a.tlMobile, a.tlName, 'ff-tl', '');
          }
        }
      }
      // FF agents (EIR) — id + name + TL + ids
      if (agents.status === 'fulfilled') {
        for (const a of agents.value || []) {
          const p = person(idx, 'ff-agent', a.name || a.id, a.tlName, '', a.id);
          if (p) { p.bars = p.bars; p.n += Number(a.n) || 0; }
          if (clean(a.id)) idx.ids.set(normId(a.id), { name: clean(a.name || a.id), kind: 'ff-agent', tl: clean(a.tlName) });
          if (clean(a.tlName)) {
            const t = person(idx, 'ff-tl', a.tlName, '', '', '');
            if (t) { t.n += Number(a.n) || 0; if (clean(a.id)) idx.ids.set(`${normId(a.id)}:tl`, { name: clean(a.tlName), kind: 'ff-tl' }); }
          }
        }
      }
      // FF stock (agent × class) — IDs + TL from StockDataa
      if (stockAgents.status === 'fulfilled') {
        for (const r of stockAgents.value || []) {
          const p = person(idx, 'ff-agent', r.agentName || r.agentId, r.tlName, r.cls, r.agentId);
          if (p) p.n += Number(r.n) || 0;
          if (clean(r.agentId)) idx.ids.set(normId(r.agentId), { name: clean(r.agentName || r.agentId), kind: 'ff-agent', tl: clean(r.tlName) });
          if (clean(r.tlName)) person(idx, 'ff-tl', r.tlName, '', r.cls, '');
        }
      }
      // GV Master — agent id / name / TL id / TL name / GV unique id + name
      if (gvMaster.status === 'fulfilled') {
        for (const r of gvMaster.value || []) {
          const p = person(idx, 'gv-agent', r.agentName || r.agentId, r.tlName, '', r.agentId);
          // GV Master supplies identity / unique-ID metadata only; issuance quantity is EIR below.
          if (clean(r.agentId)) idx.ids.set(normId(r.agentId), { name: clean(r.agentName || r.agentId), kind: 'gv-agent', tl: clean(r.tlName) });
          if (clean(r.tlId)) idx.ids.set(normId(r.tlId), { name: clean(r.tlName || r.tlId), kind: 'gv-tl' });
          if (clean(r.tlName)) person(idx, 'gv-tl', r.tlName, '', r.cls, r.tlId);
          if (clean(r.gvUniqueId) || clean(r.gvUniqueName)) {
            const g = person(idx, 'gv-id', r.gvUniqueName || r.gvUniqueId, r.tlName, r.cls, r.gvUniqueId);
            if (g) g.n += 1;
            if (clean(r.gvUniqueId)) idx.ids.set(normId(r.gvUniqueId), { name: clean(r.gvUniqueName || r.gvUniqueId), kind: 'gv-id', tl: clean(r.tlName) });
          }
        }
      }
      // GV issuance quantities are EIR-authoritative. Keep GV Master above only for identity and
      // unique-ID metadata; aggregated EIR rows supply the search counts and class quantities.
      if (gvIssuance.status === 'fulfilled') {
        for (const r of gvIssuance.value || []) {
          const n = Number(r.n) || 1;
          const p = person(idx, 'gv-agent', r.agentName || r.agentId, r.tlName, '', r.agentId);
          if (p) {
            p.n += n;
            const cls = clean(r.cls);
            if (cls) p.classMap.set(cls, (p.classMap.get(cls) || 0) + n);
          }
          if (clean(r.agentId)) idx.ids.set(normId(r.agentId), { name: clean(r.agentName || r.agentId), kind: 'gv-agent', tl: clean(r.tlName) });
          if (clean(r.tlName)) {
            const t = person(idx, 'gv-tl', r.tlName, '', r.cls, r.tlId);
            if (t) t.n += n;
          }
        }
      }
      // GV REPORT (agent + TL + supervisor ids)
      if (gvReport.status === 'fulfilled') {
        for (const r of gvReport.value || []) {
          person(idx, 'gv-agent', r.agentName || r.agentId, r.tlName, '', r.agentId);
          if (clean(r.agentId)) idx.ids.set(normId(r.agentId), { name: clean(r.agentName || r.agentId), kind: 'gv-agent', tl: clean(r.tlName) });
          if (clean(r.tlId)) idx.ids.set(normId(r.tlId), { name: clean(r.tlName || r.tlId), kind: 'gv-tl' });
          if (clean(r.tlName)) person(idx, 'gv-tl', r.tlName, '', '', clean(r.tlId));
          addAlias(person(idx, 'gv-agent', r.agentName || r.agentId, r.tlName, '', r.agentId), r.agentId, canMob ? r.mobile : '');
          addMobile(r.mobile, r.agentName || r.agentId, 'gv-agent', r.tlName);
          if (clean(r.tlName) && FF.config.isRealTl(clean(r.tlName))) addAlias(person(idx, 'gv-tl', r.tlName, '', '', r.tlId), r.tlId, canMob ? r.tlMobile : '');
          if (r.tlMobile) addMobile(r.tlMobile, r.tlName, 'gv-tl', '');
        }
      }
      // GV stock (Tag Assignment aggregates)
      if (gvStockAgent.status === 'fulfilled') {
        for (const r of gvStockAgent.value || []) {
          const p = person(idx, 'gv-agent', r.agentName || r.agentId, r.tlName, '', r.agentId);
          if (p) p.n += Number(r.n) || 0;
          if (clean(r.agentId)) idx.ids.set(normId(r.agentId), { name: clean(r.agentName || r.agentId), kind: 'gv-agent', tl: clean(r.tlName) });
        }
      }
      if (gvStockTl.status === 'fulfilled') {
        for (const r of gvStockTl.value || []) person(idx, 'gv-tl', r.tlName, '', '', clean(r.tlId));
      }
      indexLookups(idx);
      if (generation !== state.generation) return state.light;
      state.light = idx;
      state.lightPromise = null;
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
      for (const r of details.stock || []) {
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
    ready('masterProfile').then(() => { if (FF.masterProfile && FF.masterProfile.warm) return FF.masterProfile.warm(); }).then(emit).catch(() => {});
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
    // barcode / tag / serial — prefix and 6-gram inverted indexes preserve partial-barcode search.
    if (wantsTags && idx.bars.size) {
      let candidates = [];
      if (ni.length >= 6 && idx.barGrams) candidates = idx.barGrams.get(ni.slice(0, 6)) || [];
      else if (idx.barPrefixes) candidates = idx.barPrefixes.get(ni.slice(0, 4)) || [];
      for (const item of candidates) {
        const key = typeof item === 'number' ? idx.barKeys[item] : item;
        if (!key || !(key === ni || key.startsWith(ni) || (ni.length >= 6 && key.includes(ni)))) continue;
        const entry = idx.bars.get(key);
        if (entry) out.tags.push(entry);
      }
      // Compatibility for an index created by an older host adapter without the new lookup maps.
      if (!idx.barKeys || !idx.barKeys.length) idx.bars.forEach((entry, key) => {
        if (key === ni || key.startsWith(ni) || (ni.length >= 6 && key.includes(ni))) out.tags.push(entry);
      });
      out.tags.sort((a, b) => a.key.length - b.key.length || (b.ff.length + b.gv.length) - (a.ff.length + a.gv.length));
      if (out.tags.length > 120) out.tags.length = 120;
    }
    out.matched = out.people.length + out.ids.length + out.tags.length;
    return out;
  }

  /** Suggestions for U.suggest() — label + sub + kind chip. */
  function suggestItems(q) {
    if (!state.light) {
      // Index pehli baar ban raha hai — suggestion me spinner jaisa item do (dropdown kabhi khali na lage).
      buildLight().catch(() => {});
      warmFull();
      return [{ kind: 'cls', kindLabel: 'Search', label: `“${clean(q)}” search ho raha hai…`, sub: 'index ban raha hai (agents + TLs + IDs)', value: clean(q), none: true }];
    }
    const r = search(q);
    const items = [];
    r.people.slice(0, 14).forEach((p) => {
      const tl = [...p.tlSet][0] || '';
      const q1 = MP() ? MP().quick(p) : null;   // stock / priority / mobile (agar REPORT load ho chuka)
      const isTlKind = /tl$/.test(p.kind);
      const extra = q1 ? [
        q1.mobile && (!FF.auth || FF.auth.can('contacts')) ? `📞 ${q1.mobile}` : '',
        `📦 ${U.fmt(q1.stock.total)}${!isTlKind && q1.tlStock && q1.tlStock.has ? ` · TL ${U.fmt(q1.tlStock.total)}` : ''}`,
        q1.tagRequired ? `🏷️ TAG ${U.sugText(q1.calc.total.net, q1.calc.total.gross)}` : (!q1.direct && q1.calc && (q1.calc.total.net || q1.calc.total.gross) ? `🎯 dispatch ${U.sugText(q1.calc.total.net, q1.calc.total.gross)}` : ''),
        q1.calc && q1.calc.total.rate > 0 ? `⚡ ${U.fmt(q1.calc.total.rate, true)}/day` : '',
        q1.calc && q1.calc.total.cover != null ? `⏳ cover ${U.fmt(q1.calc.total.cover, true)} din` : ''
      ].filter(Boolean) : [];
      items.push({
        kind: p.kind.startsWith('gv') ? 'gv' : 'ff',
        kindLabel: KIND_LABEL[p.kind] || p.kind,
        label: p.name,
        sub: [p.sub ? `ID ${p.sub}` : '', tl ? `TL ${p.direct ? (p.directLabel || tl) : tl}` : '', ...extra, !q1 && p.bars.size ? `${U.fmt(p.bars.size)} tags` : ''].filter(Boolean).join(' · '),
        badge: q1 && q1.priority ? q1.priority : (p.bars.size ? `${U.fmt(p.bars.size)}` : ''),
        keywords: `${p.sub} ${tl} ${[...p.classMap.keys()].join(' ')}`,
        value: p.name,
        person: p
      });
    });
    r.ids.slice(0, 6).forEach((v) => items.push({
      kind: 'cls', kindLabel: KIND_LABEL[v.kind] || 'ID', label: `${v.name} · ${v.id}`,
      sub: [`ID ${v.id}`, v.tl ? `TL ${v.tl}` : ''].filter(Boolean).join(' · '), value: v.name, personKey: `${v.kind}|${normName(v.name)}`
    }));
    r.tags.slice(0, 8).forEach((t) => {
      const f = t.ff[0], g = t.gv[0];
      items.push({
        kind: 'cls', kindLabel: 'Barcode',
        label: U.barcode(t.key),
        sub: [f ? `FF ${f.agentName}` : '', g ? `GV ${g.agentName}` : '', (f && f.cls) || (g && g.cls) || ''].filter(Boolean).join(' · '),
        value: t.key, barcode: t.key
      });
    });
    if (!items.length) items.push({ kind: 'cls', kindLabel: 'Search', label: `“${clean(q)}” ke liye kuch nahi mila`, sub: 'Doosra naam / ID / barcode try karo', value: clean(q), none: true });
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
    if (!q1) return MP() && MP().supports(p) ? '<div class="ms-kundli-stats ms-prof"><div><small>Stock / priority</small><b class="dim">REPORT load ho raha hai…</b></div></div>' : '';
    const isTlKind = /tl$/.test(p.kind);
    const contacts = !FF.auth || FF.auth.can('contacts');
    const d = q1.dispatch || {};
    const tlStockDetail = q1.tlStock && q1.tlStock.own && q1.tlStock.agents
      ? `Own ${U.fmt(q1.tlStock.own.total)} + agents ${U.fmt(q1.tlStock.agents.total)}` : '';
    const p1 = q1.projT1 || null;   // 📈 growth % + expected month-end
    const mode = U.suggestMode ? U.suggestMode() : 'both';
    // Dono criteria: stock ke baad (net) + bina stock ghataye (gross) — settings ka mode apply hota hai.
    const pair = (net, gross) => U.sugCell(net, gross);
    let sugStats = '';
    if (q1.tagRequired) {
      sugStats = `<div class="ms-sug-full"><small>🏷️ Tags required · ${U.fmt(d.days)} din</small><b>${mode === 'both' ? `<span class="sug-pair"><span class="sug-result net"><small>Tag need · after stock</small><span class="sug-chip direct">🏷️ ${U.fmt(d.sugVc4)} + ${U.fmt(d.sugComm)} tags</span></span><span class="sug-result gross"><small>Tags · no stock deducted</small><span class="sug-chip wo">🏷️ ${U.fmt((d.sugVc4Gross || 0) + (d.sugCommGross || 0))} tags</span></span></span>` : `<span class="sug-chip direct">🏷️ ${U.fmt(mode === 'gross' ? (d.sugVc4Gross || 0) + (d.sugCommGross || 0) : d.sugVc4 + d.sugComm)} tags</span>`}</b></div>`;
    } else if (q1.direct) {
      sugStats = '<div class="ms-sug-full"><small>Suggested dispatch</small><b class="dim">No dispatch</b></div>';
    } else {
      const ct = q1.calc.total;
      sugStats = `<div><small>Sug. VC4 ${mode === 'both' ? '(stock − · w/o stock)' : mode === 'gross' ? '(bina stock)' : '(stock −)'}</small><b>${pair(d.sugVc4, d.sugVc4Gross || 0)}</b></div>
      <div><small>Sug. Comm. ${mode === 'both' ? '(stock − · w/o stock)' : mode === 'gross' ? '(bina stock)' : '(stock −)'}</small><b>${pair(d.sugComm, d.sugCommGross || 0)}</b></div>
      <div class="ms-sug-full"><small>🎯 Dispatch · all tags · ${U.fmt(ct.days)} din</small><b>${pair(ct.net, ct.gross)}</b></div>`;
    }
    return `<div class="ms-kundli-stats ms-prof">
      <div><small>${isTlKind ? 'TL mobile' : 'Mobile'}</small><b>${contacts ? (q1.mobile ? esc(q1.mobile) : '—') : '🔒'}</b></div>
      <div><small>Priority</small><b>${esc(q1.priority || '—')}</b></div>
      <div><small>${isTlKind ? 'TL stock' : 'Agent stock'}</small><b>${U.fmt(q1.stock.total)}</b>${isTlKind && tlStockDetail ? `<em>${tlStockDetail}</em>` : ''}</div>
      ${isTlKind ? `<div><small>Agents</small><b>${U.fmt(q1.agentCount)}</b></div>` : `<div><small>TL stock</small><b>${q1.tlStock && q1.tlStock.has ? U.fmt(q1.tlStock.total) : '—'}</b>${tlStockDetail ? `<em>${tlStockDetail}</em>` : ''}</div>`}
      ${sugStats}
      <div><small>Run-rate / day <em>(÷ ${U.fmt(q1.calc.total.elapsed)} din)</em></small><b>${U.fmt(q1.calc.total.rate, true)}</b></div>
      <div><small>Cover</small><b>${q1.calc.total.cover != null ? `${U.fmt(q1.calc.total.cover, true)} din` : '—'}</b></div>
      <div class="ms-growth"><small>Growth % <em>${p1 && p1.basis && p1.basis.shortLabel ? `till ${esc(p1.basis.shortLabel)}` : ''}</em></small><b>${p1 && p1.num !== null && p1.num !== undefined && Number.isFinite(p1.num) ? U.pctHtml(p1.num, { decimals: 0 }) : `<span class="dim">—</span>`}</b></div>
      <div><small>This month · last</small><b>${U.fmt(q1.totals.curTotal)} · ${U.fmt(q1.totals.lastTotal)}</b></div>
      <div><small>Expected month-end</small><b>${p1 ? U.fmt(p1.total) : '—'}</b></div>
    </div>`;
  }
  /** Sirf ek hi person match ho to uski poori profile inline khol do (async placeholder → data). */
  function inlineSingle(container, res) {
    try {
      if (!container || !MP() || !res || res.tags.length || res.people.length !== 1 || !MP().supports(res.people[0])) return;
      const first = container.querySelector && container.querySelector('.ms-section');
      if (!first || !first.insertAdjacentHTML) return;
      first.insertAdjacentHTML('beforebegin', '<section class="ms-section ms-profile-inline"><h3>📊 Poori report</h3><div class="ms-profile-slot"></div></section>');
      const slot = container.querySelector('.ms-profile-inline .ms-profile-slot');
      const person = res.people[0];
      if (slot) MP().renderInto(slot, person);
    } catch { /* ignore */ }
  }
  function personKundli(p) {
    const tl = p.direct ? (p.directLabel || 'Direct Agent') : [...p.tlSet].slice(0, 4).map((n) => tlText(n, p.kind === 'gv-agent' ? 'gv' : 'ff')).join(', ');
    return `<article class="ms-kundli">
      <div class="ms-kundli-head">
        <span class="ms-avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span>
        <div class="ms-kundli-id">
          <b>${esc(p.name)}</b>
          <small>${esc(KIND_LABEL[p.kind] || p.kind)}${p.sub ? ` · ID ${esc(p.sub)}` : ''}</small>
        </div>
      </div>
      <div class="ms-kundli-stats">
        <div><small>Tags / barcodes</small><b>${p.bars.size ? U.fmt(p.bars.size) : U.fmt(p.n)}</b></div>
        <div><small>Activity rows</small><b>${U.fmt(p.n)}</b></div>
        <div><small>TL</small><b>${p.direct ? `<span class="direct-chip">🚫 ${esc(tl)}</span>` : esc(tl || '—')}</b></div>
        <div><small>Last allocation</small><b>${esc(p.last || '—')}</b></div>
      </div>
      ${kundliProfileStats(p)}
      <div class="ms-pill-row">${classPills(p.classMap)}</div>
      <div class="ms-kundli-actions">
        ${MP() && MP().supports(p) ? `<button class="btn small primary" data-ms-profile="${esc(personKey(p))}">📊 Poori report</button>` : ''}
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
    const parts = [];
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
    if (res.people.length) {
      parts.push(`<section class="ms-section"><h3>🧑‍💼 Agents & TLs <span class="dim small">${U.fmt(res.people.length)} match</span></h3>
        <div class="ms-kundli-grid">${res.people.slice(0, 24).map(personKundli).join('')}</div></section>`);
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
        try {
          if (!FF.pdf && FF.lazy && FF.lazy.loadScript) await FF.lazy.loadScript('pdf.js');
          if (!FF.pdf) return;
          U.setButtonBusy(pdfBtn, true, 'PDF…');
          const rows = [];
          res.tags.forEach((tt) => { const f = tt.ff[0] || {}, g = tt.gv[0] || {}; const st = tagStatus(tt); rows.push(['Tag', U.barcode(tt.key), f.agentName || g.agentName || '', f.tlName || g.tlName || '', f.cls || g.cls || '', st.t, 1]); });
          res.people.forEach((p) => rows.push(['Person', p.name, KIND_LABEL[p.kind] || p.kind, [...p.tlSet].join(' / '), [...p.classMap.keys()].join(' '), p.last || '', p.bars.size || p.n || 0]));
          res.ids.forEach((v) => rows.push(['ID', v.id, v.name || '', KIND_LABEL[v.kind] || v.kind, v.tl || '', '', 1]));
          const totCount = U.sum(rows, (r) => Number(r[6]) || 0);
          const tblHtml = `<table style="width:100%;border-collapse:collapse;font-size:10.5px"><thead><tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:5px">Type</th><th style="border:1px solid #cbd5e1;padding:5px">Key / Name</th><th style="border:1px solid #cbd5e1;padding:5px">Role / Holder</th><th style="border:1px solid #cbd5e1;padding:5px">TL</th><th style="border:1px solid #cbd5e1;padding:5px">Class</th><th style="border:1px solid #cbd5e1;padding:5px">Status / Last</th><th style="border:1px solid #cbd5e1;padding:5px;text-align:right">Count</th></tr></thead><tbody>${rows.slice(0, 120).map((r) => `<tr>${r.map((c, i) => `<td style="border:1px solid #e2e8f0;padding:4px 6px;${i === 6 ? 'text-align:right;font-weight:700' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}<tr style="background:#eef2ff;font-weight:800"><td colspan="6" style="border:1px solid #cbd5e1;padding:5px 6px">Grand Total (${rows.length} matches)</td><td style="border:1px solid #cbd5e1;padding:5px 6px;text-align:right">${U.fmt(totCount)}</td></tr></tbody></table>`;
          const page = FF.pdf.doc({ title: `Master Search · ${res.q || 'Results'}`, sub: `${U.fmt(res.matched)} matches`, meta: new Date().toLocaleString('en-IN'), body: tblHtml });
          await FF.pdf.download([page], `master-search-${U.slug(res.q || 'results')}-${U.stamp()}.pdf`);
          U.toast('Master search PDF downloaded ✓', 'ok');
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
          <input id="master-search-input" class="input" type="search" placeholder="Search — naam, TL, ID, GV ID, barcode, tag ID…" autocomplete="off"
            aria-label="Master search: agent, TL, ID, barcode or tag ID">
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
      min: 2, max: 16,
      items: () => suggestItems(input.value),
      onPick: (it) => {
        if (it.none) return;
        if (it.barcode) { openPanel(it.barcode); return; }
        if (it.person && MP() && MP().supports(it.person)) { MP().open(it.person); return; }
        if (it.person) { const res = search(it.person.name); openPanel({ ...res, people: [it.person], ids: [], tags: [], matched: 1 + (it.person.bars.size || 0) }); return; }
        openPanel(it.label);
      },
      onEnter: (q) => { if (clean(q).length >= 2) openPanel(q); }
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
  function mountHome(container) {
    if (!container) return;
    const q = state.lastQuery || '';
    container.innerHTML = `<div class="home-master-search" id="home-master-search">
      <div class="hms-head">
        <span class="hms-ico">🔎</span>
        <div><b>Master Search</b><small>Naam · TL · agent ID · TL ID · GV ID · barcode · tag ID — First Forward + GV dono ek hi search me</small></div>
      </div>
      <div class="hms-input-wrap">
        <input id="home-master-input" class="input" type="search" value="${esc(q)}" placeholder="Type karo… jaise “Rahul”, “34161FA…”, “5845036”, “GV001”, tag ID…" autocomplete="off" aria-label="Master search">
        <button class="btn" id="home-master-clear" title="Search clear karo">✕ Clear</button>
        <button class="btn primary" id="home-master-go">🔎 Kholo</button>
      </div>
      <div class="hms-chips"><span class="dim small">Try:</span>${['VC4', '5845036', 'ApnaPayment'].map((s) => `<button class="chip" data-hms="${esc(s)}">${esc(s)}</button>`).join('')}<span class="ms-register-state" id="hms-state"></span></div>
      <div id="home-master-results" class="ms-inline"></div>
    </div>`;
    const input = U.$('#home-master-input', container);
    const results = U.$('#home-master-results', container);
    const stateEl = U.$('#hms-state', container);
    const setState = () => { if (stateEl) stateEl.innerHTML = state.full && state.full.fullLoaded ? '<span class="badge green">barcode register ready ✓</span>' : '<span class="badge amber">barcode register load ho raha hai…</span>'; };
    setState();
    onIndexReady(() => {
      setState();
      if (input && clean(input.value).length >= 2) run(input.value);
    });
    warmFull();
    const run = (query) => {
      const val = clean(query);
      if (val.length < 2) { results.innerHTML = ''; return; }
      state.lastQuery = val;
      const res = search(val);
      results.innerHTML = resultsHtml(res);
      results.dataset.q = val;
      inlineSingle(results, res);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(input.value); } });
    const hClear = U.$('#home-master-clear', container);
    if (hClear) hClear.addEventListener('click', () => { input.value = ''; state.lastQuery = ''; results.innerHTML = ''; input.focus(); });
    U.$('#home-master-go', container).addEventListener('click', () => { const v = clean(input.value); if (v.length < 2) { U.toast('Kam se kam 2 letter / digit type karo', 'warn'); return; } openPanel(v); });
    container.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-hms]');
      if (chip) { input.value = chip.dataset.hms; run(chip.dataset.hms); return; }
      const prof = e.target.closest('[data-ms-profile]');
      if (prof) { const person = personByKey(prof.dataset.msProfile); if (person && MP()) MP().open(person); return; }
      const a360 = e.target.closest('[data-ms-agent360]');
      if (a360) { if (FF.cockpit && FF.cockpit.agent360) FF.cockpit.agent360({ name: a360.dataset.msAgent360 }).catch(() => {}); return; }
      const tags = e.target.closest('[data-ms-tags]');
      if (tags) { FF.app.navigate('masterStock', { q: tags.dataset.msTags }); return; }
      const again = e.target.closest('[data-ms-again]');
      if (again) { input.value = again.dataset.msAgain; run(again.dataset.msAgain); }
    });
    if (q) run(q);
    // debounce live search on home (typing shows results without Enter)
    let t = null;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => run(input.value), 320); });
    return { run };
  }

  function invalidate() {
    state.generation++;
    state.light = null; state.lightPromise = null;
    state.full = null; state.fullPromise = null;
    state.results = null;
    emit();
  }
  FF.masterSearch = {
    buildLight, buildFull, warmFull, invalidate, search, suggestItems, resultsHtml, openPanel, closePanel,
    mountTopbar, mountHome, onIndexReady, personByKey,
    get ready() { return !!(state.light); }, get heavyReady() { return !!(state.full && state.full.fullLoaded); },
    get topbarMounted() { return mountedTopbar; },
    label: KIND_LABEL
  };
})(window.FF);
