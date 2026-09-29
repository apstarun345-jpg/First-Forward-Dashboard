/* 🎙️ Dashboard Voice/Text Assistant — mic se pucho, turant jawab pao.
   "Aaj ka Rahul ka issuance", "stock kya hai", "chassis ke kitne" — sab preloaded data se
   turant answer (koi extra Google query nahi). Mic = Web Speech API (hi-IN/en-IN), jawab
   speechSynthesis se bol kar bhi sun sakte hain.
   🌐 Hinglish ⇄ English toggle (panel header) + ⚙ Settings → My account me voice options
   (Hindi voice, English voice, speed, pitch) — sab localStorage 'ff-voice-prefs' me save.
   Feature flag: features.askBox. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util, S = FF.store, G = FF.gv, M = FF.model;
  const esc = U.esc, clean = U.clean;
  const norm = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const money = (v) => '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  let mounted = false, panel = null, log = null, speakOn = true, busy = false;
  let lang = U.voicePrefs().lang === 'en' ? 'en' : 'hi';

  // ---------- helpers ----------
  const fmt = (v) => U.fmt(v);
  const T = (hi, en) => (lang === 'en' ? en : hi);
  async function safe(p, fallback) { try { return await p; } catch { return fallback; } }
  const ymNow = () => U.ymKey(new Date());
  const todayKey = () => U.dateKey(new Date());

  const setLang = (v) => { lang = v === 'en' ? 'en' : 'hi'; U.setVoicePrefs({ lang }); syncLangUI(); };
  const getLang = () => lang;

  async function loadAll() {
    const [daily, agents, stockAgents, gvMaster, gvStock, agentClass] = await Promise.all([
      safe(S.need('daily'), []), safe(S.need('agents'), []), safe(S.need('stockAgents'), []),
      safe(G.need('master'), []), safe(G.need('stockAgent'), []), safe(S.need('agentClass'), [])
    ]);
    return { daily, agents: agents || [], stockAgents: stockAgents || [], gvMaster: gvMaster || [], gvStock: gvStock || [], agentClass: agentClass || [] };
  }

  const STOP = /KA|KI|KE|HAI|KYA|BATAO|KITNE|KITNA|AAJ|TODAY|MONTH|MAHINE|STOCK|ISSUANCE|COMMISSION|CHASSIS|TAG|TAGS|SHOW|TOTAL|WRONG|VRN|REPLACEMENT|VC4|VC20|TOP|CHAMPION|NAAM|THE|AND|WHAT|WHATS|WHO|HOW|MANY|MUCH|IS|ARE|ME|TELL|GIVE|DOES|DID/;
  /** Fuzzy agent find: name tokens FF agents + GV master me. Returns { name, id, key } */
  function findAgent(D, text) {
    const words = norm(text).split(' ').filter((w) => w.length >= 3 && !STOP.test(w));
    if (!words.length) return null;
    const pool = new Map();
    D.agents.filter((a) => a.channel === 'First Forward').forEach((a) => { const k = norm(a.name); if (k && !pool.has(k)) pool.set(k, { name: a.name, id: a.id }); });
    D.gvMaster.forEach((r) => { const k = norm(r.agentName); if (k && !pool.has(k)) pool.set(k, { name: r.agentName, id: r.agentId }); });
    let best = null, bestScore = 0;
    pool.forEach((v, k) => {
      let score = 0;
      words.forEach((w) => { if (k.includes(w)) score += w.length; });
      if (score > bestScore) { bestScore = score; best = { key: k, ...v }; }
    });
    return bestScore >= 3 ? best : null;
  }

  // ---------- answer engine (Hinglish + English) ----------
  async function answer(qRaw) {
    const q = norm(qRaw);
    const D = await loadAll();
    const m = ymNow();
    const has = (...keys) => keys.some((k) => q.includes(k));

    if (has('HELLO', 'HI ', 'HEY', 'NAMASTE', 'NAMASKAR') || q === 'HI') return T(
      'Namaste! 🙏 Main dashboard assistant hoon. Puchiye — "Rahul ka issuance", "total stock kya hai", "chassis ke kitne", "top agent kaun"…',
      'Hello! 🙏 I am your dashboard assistant. Ask me — "Rahul\'s issuance", "total stock", "how many chassis", "who is the top agent"…');

    // ---- top / champions ----
    if (has('TOP', 'CHAMPION', 'SABSE ZYADA', 'NUMBER ONE', 'NO 1')) {
      const ffAgg = new Map();
      D.agents.filter((a) => a.ym === m && a.channel === 'First Forward').forEach((a) => ffAgg.set(a.name, (ffAgg.get(a.name) || 0) + a.n));
      const gvAgg = new Map();
      D.gvMaster.filter((r) => r.ym === m).forEach((r) => gvAgg.set(r.agentName, (gvAgg.get(r.agentName) || 0) + 1));
      const top = (mp) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v], i) => `${['🥇', '🥈', '🥉'][i]} ${n} — ${fmt(v)}`).join(' · ');
      if (has('GV')) return T(`GV Partner ke top 3 (is month): ${top(gvAgg) || 'data nahi'}`, `GV Partner top 3 (this month): ${top(gvAgg) || 'no data'}`);
      if (has('FF', 'FIRST')) return T(`First Forward ke top 3 (is month): ${top(ffAgg) || 'data nahi'}`, `First Forward top 3 (this month): ${top(ffAgg) || 'no data'}`);
      return T(`Is month ke top 3 — FF: ${top(ffAgg) || '—'} · GV: ${top(gvAgg) || '—'}. Detail ke liye FASTag Champions page kholo.`,
        `This month's top 3 — FF: ${top(ffAgg) || '—'} · GV: ${top(gvAgg) || '—'}. Open the FASTag Champions page for details.`);
    }

    // ---- chassis / wrong vrn / replacement ----
    const agent = findAgent(D, qRaw);
    if (has('CHASSIS')) {
      if (agent) {
        const ffC = D.agentClass.filter((r) => r.ym === m && r.channel === 'First Forward' && norm(r.name) === agent.key && /chassis/i.test(r.vrnType || '')).reduce((n, r) => n + r.n, 0);
        const gvC = D.gvMaster.filter((r) => r.ym === m && norm(r.agentName) === agent.key && /chassis/i.test(r.tagType || '')).length;
        return T(`${agent.name} ke chassis tags (is month): FF ${fmt(ffC)} · GV ${fmt(gvC)} — total ${fmt(ffC + gvC)}.`,
          `${agent.name}'s chassis tags (this month): FF ${fmt(ffC)} · GV ${fmt(gvC)} — total ${fmt(ffC + gvC)}.`);
      }
      const ffC = D.daily.filter((r) => r.ym === m && /chassis/i.test(r.vrnType || '')).reduce((n, r) => n + (r.channel === 'First Forward' ? r.n : 0), 0);
      const gvC = D.gvMaster.filter((r) => r.ym === m && /chassis/i.test(r.tagType || '')).length;
      return T(`Is month chassis tags — FF ${fmt(ffC)} · GV ${fmt(gvC)}, total ${fmt(ffC + gvC)}.`,
        `Chassis tags this month — FF ${fmt(ffC)} · GV ${fmt(gvC)}, total ${fmt(ffC + gvC)}.`);
    }
    if (has('WRONG')) {
      const ffW = D.daily.filter((r) => r.ym === m && /wrong/i.test(r.vrnType || '')).reduce((n, r) => n + (r.channel === 'First Forward' ? r.n : 0), 0);
      return T(`Is month Wrong VRN tags (FF EIR): ${fmt(ffW)}. GV Master me wrong-VRN flag alag track nahi hota.`,
        `Wrong-VRN tags this month (FF EIR): ${fmt(ffW)}. The GV Master does not track a wrong-VRN flag separately.`);
    }
    if (has('REPLACEMENT', 'REPLACE')) {
      const ffR = D.daily.filter((r) => r.ym === m && r.type === 'REPLACEMENT' && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
      const gvR = D.gvMaster.filter((r) => r.ym === m && /replacement/i.test(r.status || '')).length;
      return T(`Is month replacement tags — FF ${fmt(ffR)} · GV ${fmt(gvR)}, total ${fmt(ffR + gvR)}.`,
        `Replacement tags this month — FF ${fmt(ffR)} · GV ${fmt(gvR)}, total ${fmt(ffR + gvR)}.`);
    }

    // ---- stock ----
    if (has('STOCK')) {
      if (agent) {
        const ffS = D.stockAgents.filter((r) => norm(r.agentName) === agent.key).reduce((n, r) => n + r.n, 0);
        const gvS = D.gvStock.filter((r) => norm(r.agentName) === agent.key).reduce((n, r) => n + r.n, 0);
        return T(`${agent.name} ke paas stock: FF ${fmt(ffS)} tags · GV ${fmt(gvS)} tags — total ${fmt(ffS + gvS)}.`,
          `${agent.name} has stock of: FF ${fmt(ffS)} tags · GV ${fmt(gvS)} tags — total ${fmt(ffS + gvS)}.`);
      }
      const ffS = D.stockAgents.reduce((n, r) => n + r.n, 0), gvS = D.gvStock.reduce((n, r) => n + r.n, 0);
      const ffVc4 = D.stockAgents.filter((r) => r.group === 'VC4').reduce((n, r) => n + r.n, 0);
      return T(`Total field stock — FF ${fmt(ffS)} (VC4 ${fmt(ffVc4)}, commercial ${fmt(ffS - ffVc4)}) · GV ${fmt(gvS)} · combined ${fmt(ffS + gvS)} tags.`,
        `Total field stock — FF ${fmt(ffS)} (VC4 ${fmt(ffVc4)}, commercial ${fmt(ffS - ffVc4)}) · GV ${fmt(gvS)} · combined ${fmt(ffS + gvS)} tags.`);
    }

    // ---- commission ----
    if (has('COMMISSION', 'KAMAI', 'PAYOUT')) {
      if (agent) {
        const gvC = D.gvMaster.filter((r) => r.ym === m && norm(r.agentName) === agent.key).reduce((n, r) => n + (r.commission || 0), 0);
        const gvN = D.gvMaster.filter((r) => r.ym === m && norm(r.agentName) === agent.key).length;
        return T(`${agent.name} ki GV commission (is month): ${money(gvC)} · ${fmt(gvN)} tags. FF commission REPORT sheet se aata hai — FF Commission page par dekho.`,
          `${agent.name}'s GV commission (this month): ${money(gvC)} · ${fmt(gvN)} tags. FF commission comes from the REPORT sheet — see the FF Commission page.`);
      }
      const gvC = D.gvMaster.filter((r) => r.ym === m).reduce((n, r) => n + (r.commission || 0), 0);
      return T(`GV Partner ki total commission (is month): ${money(gvC)}. FF ki exact earned ke liye FF Commission page kholo.`,
        `GV Partner total commission (this month): ${money(gvC)}. Open the FF Commission page for FF's exact earned figure.`);
    }

    // ---- agent-wise issuance (aaj / month) ----
    if (agent && has('ISSUANCE', 'TAG', 'KITNE', 'KITNA', 'LAGAYE', 'LAGE', 'KAAM')) {
      const today = todayKey();
      const gvToday = D.gvMaster.filter((r) => norm(r.agentName) === agent.key && r.date && U.dateKey(r.date) === today).length;
      const gvMonth = D.gvMaster.filter((r) => norm(r.agentName) === agent.key && r.ym === m).length;
      const ffMonth = D.agents.filter((a) => a.ym === m && a.channel === 'First Forward' && norm(a.name) === agent.key).reduce((n, a) => n + a.n, 0);
      if (has('AAJ', 'TODAY')) {
        const ffToday = D.daily.filter((r) => r.key === today && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
        return T(`${agent.name} — aaj GV ${fmt(gvToday)} tags. FF side aaj agent-wise record EIR summary me nahi aata; FF month-to-date ${fmt(ffMonth)} tags hai (poore FF channel ne aaj ${fmt(ffToday)} tags lagaye).`,
          `${agent.name} — today GV ${fmt(gvToday)} tags. Agent-wise FF record for today is not in the EIR summary; FF month-to-date is ${fmt(ffMonth)} tags (the whole FF channel issued ${fmt(ffToday)} tags today).`);
      }
      return T(`${agent.name} ka issuance (is month): FF ${fmt(ffMonth)} · GV ${fmt(gvMonth)} — total ${fmt(ffMonth + gvMonth)} tags.`,
        `${agent.name}'s issuance (this month): FF ${fmt(ffMonth)} · GV ${fmt(gvMonth)} — total ${fmt(ffMonth + gvMonth)} tags.`);
    }

    // ---- totals ----
    if (has('TOTAL', 'ISSUANCE', 'KITNE TAG', 'BUSINESS')) {
      const ffM = D.daily.filter((r) => r.ym === m && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
      const gvM = D.gvMaster.filter((r) => r.ym === m).length;
      const today = todayKey();
      const ffT = D.daily.filter((r) => r.key === today && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
      const gvT = D.gvMaster.filter((r) => r.date && U.dateKey(r.date) === today).length;
      return T(`Aaj: FF ${fmt(ffT)} + GV ${fmt(gvT)} = ${fmt(ffT + gvT)} tags. Is month: FF ${fmt(ffM)} + GV ${fmt(gvM)} = ${fmt(ffM + gvM)} tags.`,
        `Today: FF ${fmt(ffT)} + GV ${fmt(gvT)} = ${fmt(ffT + gvT)} tags. This month: FF ${fmt(ffM)} + GV ${fmt(gvM)} = ${fmt(ffM + gvM)} tags.`);
    }

    if (agent) return T(`${agent.name} mila (${agent.id || 'ID blank'}). Issuance/stock/commission puchne ke liye "Rahul ka issuance", "Rahul ka stock", "Rahul ki commission" bolo.`,
      `Found ${agent.name} (${agent.id || 'ID blank'}). Ask "Rahul's issuance", "Rahul's stock" or "Rahul's commission".`);

    return T('Ye samajh nahi aaya 🤔. Ye puch sakte hain — "aaj ka total issuance", "Rahul ka issuance", "stock kya hai", "Rahul ka stock", "chassis ke kitne", "wrong VRN", "replacement kitne", "Rahul ki commission", "top agent kaun".',
      'I did not understand that 🤔. Try — "today\'s total issuance", "Rahul\'s issuance", "what is the stock", "Rahul\'s stock", "how many chassis", "wrong VRN", "how many replacements", "Rahul\'s commission", "who is the top agent".');
  }

  // ---------- UI ----------
  const CHIP_Q = {
    hi: [['aaj ka total issuance', 'Aaj ka total'], ['stock kya hai', 'Stock kya hai'], ['chassis ke kitne', 'Chassis kitne'], ['top agent kaun', 'Top agent']],
    en: [["today's total issuance", "Today's total"], ['what is the stock', 'Stock?'], ['how many chassis', 'Chassis count'], ['who is top agent', 'Top agent']]
  };
  const WELCOME = {
    hi: 'Namaste! 🙏 Main dashboard assistant hoon — mic 🎙️ dabakar bolo ya type karo: <b>"Rahul ka issuance"</b>, <b>"stock kya hai"</b>, <b>"chassis ke kitne"</b>, <b>"top agent kaun"</b>…',
    en: 'Hello! 🙏 I am your dashboard assistant — tap the mic 🎙️ or type: <b>"Rahul\'s issuance"</b>, <b>"what is the stock"</b>, <b>"how many chassis"</b>, <b>"who is the top agent"</b>…'
  };
  const HINT = {
    hi: 'Hinglish me pucho — preloaded data se turant jawab',
    en: 'Ask in English or Hinglish — instant answers from preloaded data'
  };
  const PLACEHOLDER = { hi: 'e.g. "Rahul ka issuance" ya "stock kya hai"…', en: 'e.g. "Rahul\'s issuance" or "what is the stock"…' };
  const MIC_TITLE = { hi: '🎤 Bol kar pucho', en: '🎤 Ask by voice' };
  const MIC_HINT = { hi: '🎤 Boliye — "Rahul ka issuance", "stock kya hai"…', en: '🎤 Speak — "Rahul\'s issuance", "what is the stock"…' };

  function bubble(text, who) {
    const el = document.createElement('div');
    el.className = `ask-msg ${who}`;
    el.innerHTML = who === 'me' ? esc(text) : text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  async function ask(text) {
    if (!text || busy) return;
    busy = true;
    bubble(text, 'me');
    const wait = document.createElement('div');
    wait.className = 'ask-msg bot dim';
    wait.textContent = T('…dekh raha hoon', '…checking');
    log.appendChild(wait); log.scrollTop = log.scrollHeight;
    let a;
    try { a = await answer(text); } catch (e) { a = T(`Data load nahi hua (${esc(e.message || 'error')}) — thodi der baad try karo.`, `Could not load data (${esc(e.message || 'error')}) — please try again shortly.`); }
    wait.remove();
    bubble(a, 'bot');
    speak(a);
    busy = false;
  }

  function speak(text) {
    if (!speakOn || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const plain = String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const u = new SpeechSynthesisUtterance(plain);
      const vs = window.speechSynthesis.getVoices() || [];
      const p = U.voicePrefs();
      const wantURI = lang === 'en' ? p.en : p.hi; // har language ki apni chosen voice
      u.voice = (wantURI && vs.find((v) => v.voiceURI === wantURI))
        || vs.find((v) => lang === 'en' ? /^en[-_]IN/i.test(v.lang) : /^hi[-_]IN/i.test(v.lang))
        || vs.find((v) => lang === 'en' ? /en/i.test(v.lang) : /hi/i.test(v.lang))
        || vs[0];
      u.lang = (u.voice && u.voice.lang) || (lang === 'en' ? 'en-IN' : 'hi-IN');
      u.rate = Number(p.rate) > 0 ? Number(p.rate) : 1.02;
      u.pitch = Number(p.pitch) > 0 ? Number(p.pitch) : 1;
      window.speechSynthesis.speak(u);
    } catch { /* TTS optional */ }
  }

  function micListen(btn) {
    U.voiceInput((t) => ask(t), MIC_HINT[lang], { lang: lang === 'en' ? 'en-IN' : 'hi-IN', button: btn });
  }

  function syncLangUI() {
    if (!panel) return;
    const chips = panel.querySelector('.ask-chips');
    if (chips) {
      chips.innerHTML = (CHIP_Q[lang] || CHIP_Q.hi).map(([q, label]) => `<button data-q="${esc(q)}">${esc(label)}</button>`).join('');
      chips.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => ask(b.dataset.q)));
    }
    const inp = panel.querySelector('.ask-input');
    if (inp) inp.placeholder = PLACEHOLDER[lang];
    const small = panel.querySelector('.ask-head small');
    if (small) small.textContent = HINT[lang];
    const mic = panel.querySelector('.ask-mic');
    if (mic) { mic.title = MIC_TITLE[lang]; }
    const langBtn = panel.querySelector('[data-act="lang"]');
    if (langBtn) { langBtn.textContent = lang === 'en' ? 'हिं' : 'EN'; langBtn.title = lang === 'en' ? 'Switch to Hinglish' : 'English me switch karo'; }
  }

  function build() {
    if (mounted || !(FF.config.feat ? FF.config.feat('askBox') !== false : true)) return;
    mounted = true;
    const fab = document.createElement('button');
    fab.id = 'ask-fab';
    fab.className = 'ask-fab';
    fab.type = 'button';
    fab.title = '🎙 Dashboard assistant — pucho kuch bhi';
    fab.setAttribute('aria-label', 'Dashboard assistant kholo');
    fab.innerHTML = '🎙️';
    document.body.appendChild(fab);

    const wrap = document.createElement('div');
    wrap.id = 'ask-panel';
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="ask-head"><span class="ask-dot"></span><b>Dashboard Assistant</b><small>${HINT[lang]}</small><span style="flex:1"></span>
        <button class="ask-ico" data-act="lang" title="${lang === 'en' ? 'Switch to Hinglish' : 'English me switch karo'}">${lang === 'en' ? 'हिं' : 'EN'}</button>
        <button class="ask-ico" data-act="voice" title="🎙 Awaaz settings (Settings → My account)">⚙️</button>
        <button class="ask-ico" data-act="speak" title="Jawab bol kar sunao (on/off)">🔊</button>
        <button class="ask-ico" data-act="close" title="Band karo">✕</button></div>
      <div class="ask-log" aria-live="polite"></div>
      <div class="ask-chips">${(CHIP_Q[lang] || CHIP_Q.hi).map(([q, label]) => `<button data-q="${esc(q)}">${esc(label)}</button>`).join('')}</div>
      <form class="ask-form"><button type="button" class="ask-mic" title="${MIC_TITLE[lang]}">🎙️</button><input class="ask-input" placeholder="${esc(PLACEHOLDER[lang])}" autocomplete="off"><button class="ask-send" type="submit">➤</button></form>`;
    document.body.appendChild(wrap);
    panel = wrap;

    fab.addEventListener('click', () => {
      log = wrap.querySelector('.ask-log');
      wrap.hidden = !wrap.hidden;
      if (!wrap.hidden && !log.children.length) bubble(WELCOME[lang], 'bot');
      if (!wrap.hidden) wrap.querySelector('.ask-input').focus();
    });
    wrap.querySelector('[data-act="close"]').addEventListener('click', () => { wrap.hidden = true; });
    wrap.querySelector('[data-act="lang"]').addEventListener('click', () => setLang(lang === 'en' ? 'hi' : 'en'));
    wrap.querySelector('[data-act="voice"]').addEventListener('click', () => {
      wrap.hidden = true;
      try { window.location.hash = '#/settings?tab=account'; } catch { /* router off */ }
    });
    wrap.querySelector('[data-act="speak"]').addEventListener('click', (e) => {
      speakOn = !speakOn;
      e.currentTarget.textContent = speakOn ? '🔊' : '🔇';
      if (!speakOn && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    });
    wrap.querySelector('.ask-mic').addEventListener('click', (e) => micListen(e.currentTarget));
    wrap.querySelectorAll('.ask-chips button').forEach((b) => b.addEventListener('click', () => ask(b.dataset.q)));
    wrap.querySelector('.ask-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = wrap.querySelector('.ask-input');
      const v = inp.value.trim();
      if (v) { ask(v); inp.value = ''; }
    });

    // Settings page se voice/language badle to panel turant sync ho jaye.
    window.addEventListener('ff-voice-prefs', (e) => {
      const next = e && e.detail && e.detail.lang === 'en' ? 'en' : 'hi';
      if (next !== lang) { lang = next; syncLangUI(); }
    });
  }

  // Mount jab login ho jaye (sidebar user-chip aa jaye) — lightweight poll, ek hi baar.
  (function waitAuth() {
    if (typeof document === 'undefined') return; // node/test env — sirf engine expose karo
    if (FF.auth && FF.auth.user && document.body) { build(); return; }
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (FF.auth && FF.auth.user && document.body && document.querySelector('.sidebar')) { clearInterval(t); build(); }
      else if (tries > 150) clearInterval(t); // ~2 min ke baad chhod do (login screen par mat dikhao)
    }, 800);
  })();

  FF.assistant = { ask, answer, getLang, setLang };
})(window.FF);
