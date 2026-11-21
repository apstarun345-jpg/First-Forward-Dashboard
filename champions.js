/* v3.125.392 — 🏆 Class champions: aaj ke GV live issuance me jab koi agent VC4 / VC20 / VC5+ me 5, 10, 15… (har +5) tags laga de,
   to robot bataye "aaj ka VC4 champion". Har din / class / tier ek hi baar (localStorage). Home ke 'Today's work' me chip bhi. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const GROUPS = ['VC4', 'VC20', 'VC5+'], STEP = 5;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  const KEY = () => `ff_champ_${day()}`;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY()) || '{}') || {}; } catch { return {}; } };
  const save = (s) => { try { localStorage.setItem(KEY(), JSON.stringify(s)); Object.keys(localStorage).filter((k) => /^ff_champ_\d{8}$/.test(k) && k !== KEY()).forEach((k) => localStorage.removeItem(k)); } catch { /* private */ } };
  const NUM = { 5: 'पाँच', 10: 'दस', 15: 'पंद्रह', 20: 'बीस', 25: 'पच्चीस', 30: 'तीस' };
  const CLS_SAY = { VC4: 'वी सी फ़ोर', VC20: 'वी सी ट्वेंटी', 'VC5+': 'वी सी फ़ाइव प्लस' };
  const ICON = { VC4: '🚗', VC20: '🛻', 'VC5+': '🚚' };

  function item(group, who, tier, lead) {
    const n = who.n, name = who.name;
    const nice = `⟪${String(name).toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())}⟫`;
    const mood = tier >= 15 ? 'excited' : 'happy';
    const praise = tier >= 15 ? 'ज़बरदस्त!' : tier >= 10 ? 'शानदार!' : 'बढ़िया शुरुआत!';
    const num = NUM[tier] || String(tier);
    return {
      key: `champ:${group}:${day()}:${tier}:${name}`, grp: `champ:${group}`, mood, icon: ICON[group] || '🏆', fast: true,
      title: `🏆 Aaj ka ${group} champion`, head: `${name} — ab tak ${n} tags (${tier}+ ${lead ? 'lead' : 'paar'})`, view: 'big', big: String(n),
      rows: [{ name: `${group} champion`, val: name, sub: `aaj ${n} tags`, tone: 'up' }],
      say: `आज का ${CLS_SAY[group] || group} चैंपियन ${nice} है। ${num} से ऊपर, अब तक ${n} टैग्स। ${praise}`, q: ''
    };
  }

  function chip(highest) {
    try {
      const row = document.querySelector('#home-todo .todo-row'); if (!row) return;
      const parts = GROUPS.map((g) => { const b = highest[g]; return b && b.n >= STEP ? `<b>${g}</b> ${esc(b.name)} (${b.n})` : ''; }).filter(Boolean);
      let el = row.querySelector('.ux-champ');
      if (!parts.length) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement('a'); el.className = 'todo-item ux-champ'; el.href = '#/home'; row.prepend(el); }
      el.innerHTML = `<span class="todo-ic">🏆</span><span class="todo-tx">Aaj ke champions: ${parts.join(' · ')}</span>`;
    } catch { /* optional */ }
  }

  function update(highest) {
    if (!highest) return;
    chip(highest);
    const st = load(); let dirty = false;
    for (const g of GROUPS) {
      const b = highest[g]; if (!b || !b.n || b.n < STEP) continue;
      const tier = Math.floor(b.n / STEP) * STEP, prev = st[g] || { tier: 0, name: '', n: 0 };
      const newTier = tier > prev.tier;
      const newLeader = prev.name && prev.name !== b.name && b.n > prev.n;
      if (!newTier && !newLeader) continue;
      if (!(FF.mascot && FF.mascot.push)) continue;   // robot abhi load nahi — agli baar
      try { FF.mascot.push(item(g, b, tier, !!newLeader && !newTier)); } catch { continue; }
      st[g] = { tier: Math.max(tier, prev.tier), name: b.name, n: b.n }; dirty = true;
    }
    if (dirty) save(st);
  }
  FF.champions = { update, _item: item };
})(window.FF);
