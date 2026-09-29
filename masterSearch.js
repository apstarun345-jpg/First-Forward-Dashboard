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

  const state = { light: null, lightPromise: null, full: null, fullPromise: null, lastQuery: '', results: null, listeners: new Set() };
  const emit = () => state.listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  const onIndexReady = (fn) => { state.listeners.add(fn); return () => state.listeners.delete(fn); };

  // ---------------------------------------------------------------- index builders
  function newIndex() {
    return {
      people: new Map(),   // `${kind}|${normName(name)}` → { kind, name, sub, tlSet, classMap, bars, last, n }
      bars: new Map(),     // normBar(barcode) → { key, ff: [], gv: [] }
      ids: new Map()       // normId(id) → { name, kind, tl }
    };
  }
  function person(idx, kind, name, tlName, cls, sub) {
    const nm = clean(name);
    if (!nm) return null;
    const k = `${kind}|${normName(nm)}`;
    let p = idx.people.get(k);
    if (!p) { p = { kind, name: nm, sub: sub || '', tlSet: new Set(), classMap: new Map(), bars: new Set(), last: '', n: 0 }; idx.people.set(k, p); }
    if (sub && !p.sub) p.sub = clean(sub);
    if (clean(tlName)) p.tlSet.add(clean(tlName));
    if (clean(cls)) p.classMap.set(clean(cls), (p.classMap.get(clean(cls)) || 0) + 1);
    return p;
  }
  const barEntry = (idx, key) => { let e = idx.bars.get(key); if (!e) { e = { key, ff: [], gv: [] }; idx.bars.set(key, e); } return e; };

  /** Layer 1 — aggregated rows (instant, never blocks on barcode scans). */
  async function buildLight() {
    if (state.light) return state.light;
    if (state.lightPromise) return state.lightPromise;
    state.lightPromise = (async () => {
      const idx = newIndex();
      const [agents, stockAgents, gvMaster, gvReport, gvStockAgent, gvStockTl] = await Promise.allSettled([
        FF.store.need('agents'), FF.store.need('stockAgents'), FF.gv.need('master'),
        FF.gv.need('report'), FF.gv.need('stockAgent'), FF.gv.need('stockTl')
      ]);
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
          const p = person(idx, 'gv-agent', r.agentName || r.agentId, r.tlName, r.cls, r.agentId);
          if (p) p.n += 1;
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
      // GV REPORT (agent + TL + supervisor ids)
      if (gvReport.status === 'fulfilled') {
        for (const r of gvReport.value || []) {
          person(idx, 'gv-agent', r.agentName || r.agentId, r.tlName, '', r.agentId);
          if (clean(r.agentId)) idx.ids.set(normId(r.agentId), { name: clean(r.agentName || r.agentId), kind: 'gv-agent', tl: clean(r.tlName) });
          if (clean(r.tlId)) idx.ids.set(normId(r.tlId), { name: clean(r.tlName || r.tlId), kind: 'gv-tl' });
          if (clean(r.tlName)) person(idx, 'gv-tl', r.tlName, '', '', clean(r.tlId));
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
      state.light = idx;
      state.lightPromise = null;
      emit();
      return idx;
    })().catch((err) => { state.lightPromise = null; throw err; });
    return state.lightPromise;
  }

  /** Layer 2 — barcode-level register (FF StockDataa + GV Tag Assignment). Background load. */
  async function buildFull() {
    if (state.full) return state.full;
    if (state.fullPromise) return state.fullPromise;
    if (!FF.insights || !FF.insights.loadDetails) return null;
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
      idx.fullLoaded = true;
      state.full = idx;
      state.fullPromise = null;
      emit();
      return idx;
    })().catch(() => { state.fullPromise = null; return state.light; });
    return state.fullPromise;
  }
  /** Kick the heavy layer off in the background (non-blocking) — suggestions upgrade automatically. */
  function warmFull() { if (!state.full && !state.fullPromise) buildFull().catch(() => {}); }

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

    // people by name / TL / id / gv id
    if (nn.length >= 2) {
      idx.people.forEach((p) => {
        const hay = `${normName(p.name)} ${normName(p.sub)} ${[...p.tlSet].map(normName).join(' ')}`;
        if (hay.includes(nn)) out.people.push(p);
      });
      out.people.sort((a, b) => (b.bars.size - a.bars.size) || (b.n - a.n));
      if (out.people.length > 60) out.people.length = 60;
    }
    // exact / prefix id hits (agent id, TL id, GV id)
    if (ni.length >= 4) {
      idx.ids.forEach((v, k) => { if (k === ni || k.startsWith(ni)) out.ids.push({ id: k, ...v }); });
      out.ids.sort((a, b) => a.id.length - b.id.length);
      if (out.ids.length > 40) out.ids.length = 40;
    }
    // barcode / tag / serial
    if (wantsTags && idx.bars.size) {
      idx.bars.forEach((e, k) => {
        if (k === ni || k.startsWith(ni) || (ni.length >= 6 && k.includes(ni))) out.tags.push(e);
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
      items.push({
        kind: p.kind.startsWith('gv') ? 'gv' : 'ff',
        kindLabel: KIND_LABEL[p.kind] || p.kind,
        label: p.name,
        sub: [p.sub ? `ID ${p.sub}` : '', tl ? `TL ${tl}` : '', p.bars.size ? `${U.fmt(p.bars.size)} tags` : ''].filter(Boolean).join(' · '),
        badge: p.bars.size ? `${U.fmt(p.bars.size)}` : '',
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
        label: t.key,
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

  function personKundli(p) {
    const tl = [...p.tlSet].slice(0, 4).join(', ');
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
        <div><small>TL</small><b>${esc(tl || '—')}</b></div>
        <div><small>Last allocation</small><b>${esc(p.last || '—')}</b></div>
      </div>
      <div class="ms-pill-row">${classPills(p.classMap)}</div>
      <div class="ms-kundli-actions">
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
        return `<tr><td><b>${esc(t.key)}</b></td><td>${esc((f.tagId || g.tagId) || '—')}</td>
            <td>${esc(f.agentName || '—')}${f.agentId ? `<small>${esc(f.agentId)}</small>` : ''}</td><td>${esc(f.tlName || '—')}</td>
            <td>${esc(g.agentName || '—')}${g.agentId ? `<small>${esc(g.agentId)}</small>` : ''}</td><td>${esc(g.tlName || '—')}</td>
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
        ${res.ids.slice(0, 40).map((v) => `<tr><td><b>${esc(v.id)}</b></td><td>${esc(v.name || '—')}</td><td>${esc(KIND_LABEL[v.kind] || v.kind)}</td><td>${esc(v.tl || '—')}</td><td><button class="btn tiny" data-ms-again="${esc(v.name || v.id)}">🔎 Kholo</button></td></tr>`).join('')}
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
            <button class="btn small" data-ms-close>✕ Close</button>
          </div>
        </div>
        <div class="ms-panel-body">${resultsHtml(res)}</div>
      </div>
    </div>`);
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    const box = wrap.querySelector('.ms-panel-box');
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-ms-close]')) { closePanel(); return; }
      const a = e.target.closest('[data-ms-agent360]');
      if (a) { closePanel(); if (FF.cockpit && FF.cockpit.agent360) FF.cockpit.agent360({ name: a.dataset.msAgent360 }).catch(() => {}); return; }
      const t = e.target.closest('[data-ms-tags]');
      if (t) { const name = t.dataset.msTags; closePanel(); FF.app.navigate('masterStock', { q: name }); return; }
      const again = e.target.closest('[data-ms-again]');
      if (again) { const nq = again.dataset.msAgain; closePanel(); const input = U.$('#master-search-input'); if (input) input.value = nq; openPanel(nq); return; }
      const csv = e.target.closest('[data-ms-csv]');
      if (csv) {
        const rows = [];
        res.tags.forEach((tt) => { const f = tt.ff[0] || {}, g = tt.gv[0] || {}; const st = tagStatus(tt); rows.push(['Tag', tt.key, f.agentName || '', f.tlName || '', g.agentName || '', g.tlName || '', g.gvName || '', f.cls || g.cls || '', st.t, f.allocated || g.allocated || '', '']); });
        res.people.forEach((p) => rows.push(['Person', p.name, KIND_LABEL[p.kind] || p.kind, [...p.tlSet].join(' / '), p.sub || '', '', '', [...p.classMap.keys()].join(' '), '', p.last || '', p.bars.size || p.n]));
        res.ids.forEach((v) => rows.push(['ID', v.id, v.name || '', KIND_LABEL[v.kind] || v.kind, v.tl || '', '', '', '', '', '', '']));
        U.downloadCsv(`master-search-${U.slug(res.q || 'results')}-${U.stamp()}.csv`,
          ['Type', 'Key / Name', 'FF or Agent', 'TL / Role', 'GV holder / ID', 'GV TL', 'GV unique', 'Class', 'Status', 'Allocated / Last', 'Count'], rows);
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
      <div class="master-search-input">
        <span class="ms-ico" aria-hidden="true">🔎</span>
        <input id="master-search-input" class="input" type="search" placeholder="Search — naam, TL, ID, GV ID, barcode, tag ID…" autocomplete="off"
          aria-label="Master search: agent, TL, ID, barcode or tag ID">
        <kbd class="ms-kbd">/</kbd>
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
        if (it.person) { const res = search(it.person.name); openPanel({ ...res, people: [it.person], ids: [], tags: [], matched: 1 + (it.person.bars.size || 0) }); return; }
        openPanel(it.label);
      },
      onEnter: (q) => { if (clean(q).length >= 2) openPanel(q); }
    });
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
    onIndexReady(setState);
    warmFull();
    const run = (query) => {
      const val = clean(query);
      if (val.length < 2) { results.innerHTML = ''; return; }
      state.lastQuery = val;
      const res = search(val);
      results.innerHTML = resultsHtml(res);
      results.dataset.q = val;
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(input.value); } });
    U.$('#home-master-go', container).addEventListener('click', () => { const v = clean(input.value); if (v.length < 2) { U.toast('Kam se kam 2 letter / digit type karo', 'warn'); return; } openPanel(v); });
    container.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-hms]');
      if (chip) { input.value = chip.dataset.hms; run(chip.dataset.hms); return; }
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

  FF.masterSearch = {
    buildLight, buildFull, warmFull, search, suggestItems, resultsHtml, openPanel, closePanel,
    mountTopbar, mountHome, onIndexReady,
    get ready() { return !!(state.light); }, get heavyReady() { return !!(state.full && state.full.fullLoaded); },
    get topbarMounted() { return mountedTopbar; },
    label: KIND_LABEL
  };
})(window.FF);
