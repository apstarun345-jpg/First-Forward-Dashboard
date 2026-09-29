/* 🎙️ Dashboard Voice/Text Assistant — mic se pucho, turant jawab pao.
   "Aaj ka Rahul ka issuance", "stock kya hai", "chassis ke kitne" — sab preloaded data se
   turant answer (koi extra Google query nahi). Mic = Web Speech API (hi-IN/en-IN), jawab
   speechSynthesis se bol kar bhi sun sakte hain.
   ✍️ Speak-to-type — bol kar input box me likho, edit karke send karo (dictation mode).
   🎛 Voice Studio — default system voices (Hindi/English + speed + pitch) YA "Meri awaaz":
   apni voice ka sample record/upload karo → uski pitch/pace/timbre analyze kar ke assistant
   usi tone me bolta hai (browser TTS tone-match; profile localStorage me, audio store nahi hota).
   🌐 Hinglish ⇄ English toggle (panel header) + 🧠 context memory — "Rahul ka issuance" ke
   baad "iska stock?" bhi samajh aata hai. Feature flag: features.askBox. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util, S = FF.store, G = FF.gv, M = FF.model;
  const esc = U.esc, clean = U.clean;
  const norm = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const money = (v) => '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  let mounted = false, panel = null, log = null, speakOn = true, busy = false;
  let lang = U.voicePrefs().lang === 'en' ? 'en' : 'hi';
  // 🧠 conversation context — pichhle agent ka naam follow-up questions ke liye.
  const ctx = { agent: null, chips: [], lastBot: '' };
  // 🎧 hands-free conversation mode (Alexa-style) — jawab ke baad khud dobara sunta hai.
  let convMode = U.voicePrefs().convMode === true, convTurns = 0, greeted = false;

  // ---------- helpers ----------
  const fmt = (v) => U.fmt(v);
  const T = (hi, en) => (lang === 'en' ? en : hi);
  async function safe(p, fallback) { try { return await p; } catch { return fallback; } }
  const ymNow = () => U.ymKey(new Date());
  const todayKey = () => U.dateKey(new Date());
  const dayOffsetKey = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return U.dateKey(d); };

  // ---------- 🌅 time-aware greeting (login par voice welcome) ----------
  const greetingWord = (at) => {
    const h = (at instanceof Date ? at : new Date()).getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  };
  const userName = () => {
    const u = (FF.auth && FF.auth.user) || {};
    return clean(u.name || u.username || '') || 'Boss';
  };
  const greetingText = (name, at) => {
    const who = clean(name) || userName();
    const g = greetingWord(at);
    return T(`${g} ${who}! 🙏 Kaise ho aap?`, `${g} ${who}! 🙏 How are you?`);
  };
  const ASK_PROMPT = {
    hi: 'Aaj mere se kya janna chahte ho? Boliye — wrong VRN, top VC4, top GV agents, total issuance, stock… kuch bhi!',
    en: 'What would you like to know today? Say — wrong VRN, top VC4, top GV agents, total issuance, stock… anything!'
  };
  const SUGGEST_CHIPS = () => [
    ['wrong VRN kitne', T('❌ Wrong VRN?', '❌ Wrong VRN?')],
    ['top vc4 agents', T('🚗 Top VC4', '🚗 Top VC4')],
    ['top gv agents', T('🟩 Top GV agents', '🟩 Top GV agents')],
    ['briefing do', T('☀️ Briefing', '☀️ Briefing')],
    ['aaj ka total issuance', T('📊 Aaj ka total', "📊 Today's total")],
    ['stock kya hai', T('📦 Stock status', '📦 Stock status')]
  ];

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

  // ---------- answer engine (Hinglish + English, context-aware) ----------
  /** Answer + chips set karke bhejo. chips = [[question, label], …] follow-up suggestions. */
  const ans = (hi, en, chips) => {
    ctx.chips = Array.isArray(chips) ? chips : [];
    return T(hi, en);
  };

  async function answer(qRaw) {
    const q = norm(qRaw);
    const words = new Set(q.split(' '));
    const has = (...keys) => keys.some((k) => q.includes(k));
    const hasW = (...ws) => ws.some((w) => words.has(w));
    const D = await loadAll();
    const m = ymNow();

    // ---- help ----
    if (has('HELP', 'KYA KYA', 'KAR SAKTE', 'WHAT CAN', 'COMMANDS')) {
      return ans(
        'Main ye sab pooch sakte hain 📋 — <b>totals</b>: "aaj ka total", "kal ka total", "week ka total" · <b>agent</b>: "Rahul ka issuance", "iska stock", "iski commission", "Rahul ka full summary" · <b>categories</b>: "chassis ke kitne", "wrong VRN", "replacement kitne", "VC4 vs commercial" · <b>compare</b>: "FF vs GV", "growth vs last month" · <b>browse</b>: "top agent kaun", "agent list", "data kab update hua". Mic 🎙️ = bol kar pucho, ✍️ = bol kar likho.',
        'You can ask 📋 — <b>totals</b>: "today\'s total", "yesterday\'s total", "this week" · <b>agent</b>: "Rahul\'s issuance", "his stock", "his commission", "Rahul full summary" · <b>categories</b>: "how many chassis", "wrong VRN", "replacements", "VC4 vs commercial" · <b>compare</b>: "FF vs GV", "growth vs last month" · <b>browse</b>: "top agent", "agent list", "data freshness". Mic 🎙️ = ask by voice, ✍️ = speak to type.',
        [['aaj ka total issuance', 'Aaj ka total'], ['top agent kaun', 'Top agent'], ['agent list', 'Agent list']]
      );
    }

    // ---- data freshness ----
    if (has('DATA KAB', 'FRESH', 'UPDATE HUA', 'LAST UPDATE', 'REFRESH HUA')) {
      const ffDates = D.daily.map((r) => r.key).filter(Boolean).sort();
      const gvDates = D.gvMaster.map((r) => (r.date ? U.dateKey(r.date) : '')).filter(Boolean).sort();
      const ffLast = ffDates.at(-1) || '—', gvLast = gvDates.at(-1) || '—';
      return ans(
        `Data freshness — FF EIR daily me sabse naya din: <b>${esc(ffLast)}</b> · GV Master me: <b>${esc(gvLast)}</b>. Dashboard top bar ke ↩ Refresh se sheet se naya data pull hota hai.`,
        `Data freshness — latest day in FF EIR daily: <b>${esc(ffLast)}</b> · GV Master: <b>${esc(gvLast)}</b>. Use the ↩ Refresh button in the top bar to pull fresh sheet data.`,
        [['aaj ka total issuance', 'Aaj ka total'], ['stock kya hai', 'Stock status']]
      );
    }

    // ---- 🗣 Alexa-style chit-chat (small talk — "main theek hu", "kaise ho", "bye"…) ----
    if (has('KAISE HO', 'KAISE HAIN', 'KYA HAAL', 'HOW ARE YOU', 'KYA CHAL RAHA')) {
      return ans(
        'Main ekdum badhiya! 🙌 Dashboard ke saare data ready hain. Aap batao — aaj kya janna chahte ho? Top VC4, top GV agents, wrong VRN, stock… ya <b>briefing do</b> boliye!',
        'I am great! 🙌 All dashboard data is ready. You tell me — what would you like to know today? Top VC4, top GV agents, wrong VRN, stock… or just say <b>give me a briefing</b>!',
        SUGGEST_CHIPS()
      );
    }
    if (has('MAIN THEEK', 'MAI THEEK', 'THEEK HOON', 'THIK HOON', 'I AM FINE', 'I M FINE', 'ALL GOOD', 'BADHIYA HU', 'BADIYA HU', 'ACCHA HU', 'EKDUM THEEK', 'BILKUL THEEK', 'I AM GOOD', 'MAI ACCHA', 'MAI BADIYA')) {
      return ans(
        'Achha sun kar acha laga! 😊 Chaliye kaam ki baat karein — aaj kya batau? Top agents, wrong VRN, chassis, replacement, ya kisi agent ka issuance?',
        'Glad to hear that! 😊 Let us get to work — what should I tell you today? Top agents, wrong VRN, chassis, replacements, or any agent\'s issuance?',
        SUGGEST_CHIPS()
      );
    }
    if (has('SHUKRIYA', 'SHUKRIA', 'THANK', 'DHANYAVAD', 'THANKYOU', 'THANK YOU')) {
      return ans(
        'Aapka swagat hai! 🙏 Aur kuch janna hai — boliye, main ready hoon.',
        'You are welcome! 🙏 Anything else you want to know — just say it, I am ready.',
        SUGGEST_CHIPS()
      );
    }
    if (hasW('BYE', 'ALVIDA', 'CHALTA', 'TATA') || has('GOOD NIGHT', 'SEE YOU', 'MILTE HAI')) {
      convMode = false; try { U.setVoicePrefs({ convMode: false }); } catch { /* optional */ }
      return ans(
        'Bye bye! 👋 Dhyan rakhiye. Jab bhi data chahiye — bas assistant khol kar boliye, main yahin hoon!',
        'Bye bye! 👋 Take care. Whenever you need data — just open the assistant and ask, I am right here!',
        []
      );
    }
    if (has('TUM KAUN', 'AAP KAUN', 'WHO ARE YOU', 'TUMHARA NAAM', 'YOUR NAME', 'APNA NAAM', 'KAUN HO TUM')) {
      return ans(
        'Main aapka <b>Dashboard Assistant</b> hoon 🤖 — First Forward + GV Partner ka poora data meri zubaan par hai. Pucho issuance, stock, commission, top agents, wrong VRN… kuch bhi!',
        'I am your <b>Dashboard Assistant</b> 🤖 — I know the full First Forward + GV Partner data by heart. Ask me about issuance, stock, commission, top agents, wrong VRN… anything!',
        SUGGEST_CHIPS()
      );
    }
    // ---- 🎧 hands-free conversation mode (Alexa-style) ----
    if (has('BAND KARO', 'SO JAO', 'CHUP HO', 'STOP LISTENING', 'STOP SUN', 'LISTENING BAND') || (hasW('STOP') && has('LISTEN', 'SUN', 'MODE', 'BAATEIN', 'CONVERSATION'))) {
      convMode = false; try { U.setVoicePrefs({ convMode: false }); } catch { /* optional */ }
      return ans('Theek hai 🤫 — hands-free mode band. Jab bhi zaroorat ho, 🎧 dabakar ya bol kar bula lijiye!', 'Okay 🤫 — hands-free mode is off. Whenever you need me, tap 🎧 or just ask!', []);
    }
    if (has('HANDS FREE', 'HANDSFREE', 'BAATEIN SHURU', 'CONTINUOUS SUN', 'SUNTE RAHO', 'ALWAYS LISTEN') || (hasW('SUNO') && has('BAATEIN', 'HAMESHA', 'CONTINUOUS'))) {
      convMode = true; convTurns = 0; try { U.setVoicePrefs({ convMode: true }); } catch { /* optional */ }
      return ans('Chalo! 🎧 Hands-free mode ON — ab main har jawab ke baad khud sunta rahunga. Bas boliye! "Stop listening" bologe toh band ho jayega.', 'Let us go! 🎧 Hands-free mode is ON — I will keep listening after every answer. Just speak! Say "stop listening" to turn it off.', SUGGEST_CHIPS());
    }
    if (has('GOOD MORNING', 'GOOD AFTERNOON', 'GOOD EVENING', 'GOOD NIGHT', 'SHUBH', 'NAMASKAR')) {
      if (has('GOOD NIGHT')) return ans('Good night! 🌙 Sweet dreams — kal phir milte hain. Dhyan rakhiye!', 'Good night! 🌙 Sweet dreams — see you tomorrow. Take care!', []);
      return ans(`${greetingWord()}! 🙏 Kaise ho aap? Batao aaj kya janna chahte ho — top agents, wrong VRN, ya briefing?`,
        `${greetingWord()}! 🙏 How are you? Tell me what you want to know today — top agents, wrong VRN, or a briefing?`, SUGGEST_CHIPS());
    }
    if (has('JOKE', 'HASAO', 'FUNNY', 'MAZAK')) {
      const jokes = [
        T('Ek agent ne kaha — "stock khatam ho gaya!" Manager ne kaha — "toh kya, hum toh dashboard bech rahe hain 😄". Bas bas, ab data batau? 📊',
          'An agent said — "my stock ran out!" The manager said — "so what, we sell dashboards 😄". Okay okay, now want some data? 📊'),
        T('Teacher: "report me number kam kyu hai?" Student: "sir, Wi-Fi weak tha!" 🤣 Chalo ab serious baat — issuance kitna hua?',
          'Teacher: "why are the report numbers low?" Student: "sir, the Wi-Fi was weak!" 🤣 Okay, serious now — how much issuance happened?'),
        T('FASTag ne kaha — "main toll pe fast hoon!" Stock ne kaha — "par field me toh slow ho 😂". Waise stock check karni hai?',
          'The FASTag said — "I am fast at the toll!" Stock said — "but slow in the field 😂". By the way, want to check stock?')
      ];
      return ans(jokes[Math.floor(Math.random() * jokes.length)], jokes[0], SUGGEST_CHIPS());
    }
    if (has('TIME KYA', 'SAMAY', 'KITNE BAJE', 'WHAT TIME', 'TIME BATAO', 'DATE KYA', 'AAJ KYA TAREEKH')) {
      const now = new Date();
      return ans(
        `Abhi ${now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} ho rahe hain, ${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}. ⏰ Data chahiye toh boliye!`,
        `It is ${now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}, ${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}. ⏰ Say the word if you need data!`,
        SUGGEST_CHIPS()
      );
    }
    if (has('BRIEFING', 'BRIEF DO', 'AAJ KA HAL', 'SAB BATAO', 'DAILY BRIEF', 'MORNING BRIEF', 'SUBAH KI', 'BRIEFING DO', 'SUMMARY DO')) {
      const yKey = dayOffsetKey(-1);
      const yTotal = D.daily.filter((r) => r.key === yKey).reduce((n, r) => n + (Number(r.n) || 0), 0);
      const today = todayKey();
      const tTotal = D.daily.filter((r) => r.key === today).reduce((n, r) => n + (Number(r.n) || 0), 0);
      const gvToday = D.gvMaster.filter((r) => r.date && U.dateKey(r.date) === today).length;
      const ffM = D.daily.filter((r) => r.ym === m && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
      const gvM = D.gvMaster.filter((r) => r.ym === m).length;
      const ffS = D.stockAgents.reduce((n, r) => n + r.n, 0), gvS = D.gvStock.reduce((n, r) => n + r.n, 0);
      const wrong = D.daily.filter((r) => r.ym === m && /wrong/i.test(r.vrnType || '')).reduce((n, r) => n + (r.channel === 'First Forward' ? r.n : 0), 0);
      const ffAgg = new Map();
      D.agents.filter((a) => a.ym === m && a.channel === 'First Forward').forEach((a) => ffAgg.set(a.name, (ffAgg.get(a.name) || 0) + a.n));
      const topEntry = [...ffAgg.entries()].sort((a, b) => b[1] - a[1])[0];
      return ans(
        `☀️ ${esc(greetingWord())} briefing — kal total ${fmt(yTotal)} tags · aaj ab tak ${fmt(tTotal + gvToday)} (FF ${fmt(tTotal)} + GV ${fmt(gvToday)}) · is month FF ${fmt(ffM)} + GV ${fmt(gvM)} · stock FF ${fmt(ffS)} + GV ${fmt(gvS)} · wrong VRN ${fmt(wrong)} · top agent: ${topEntry ? `${esc(topEntry[0])} (${fmt(topEntry[1])})` : '—'}. Aur detail batau?`,
        `☀️ ${esc(greetingWord())} briefing — yesterday total ${fmt(yTotal)} tags · today so far ${fmt(tTotal + gvToday)} (FF ${fmt(tTotal)} + GV ${fmt(gvToday)}) · this month FF ${fmt(ffM)} + GV ${fmt(gvM)} · stock FF ${fmt(ffS)} + GV ${fmt(gvS)} · wrong VRN ${fmt(wrong)} · top agent: ${topEntry ? `${esc(topEntry[0])} (${fmt(topEntry[1])})` : '—'}. Want more detail?`,
        SUGGEST_CHIPS()
      );
    }

    if (has('DOBARA', 'SUNAO', 'REPEAT', 'PHIR SE', 'AUR BATAO', 'EK BAAR')) {
      return ans(
        `Zaroor ☝️ ${ctx.lastBot ? 'Jo abhi bola tha woh dobara bol raha hoon…' : 'Pehle kuch poochiye — phir main dobara bol dunga!'}`,
        `Sure ☝️ ${ctx.lastBot ? 'Repeating what I just said…' : 'Ask me something first — then I can repeat it!'}`, SUGGEST_CHIPS()
      );
    }

    // ---- hello ----
    if (has('HELLO', 'HI ', 'HEY', 'NAMASTE', 'NAMASKAR') || q === 'HI') return ans(
      'Namaste! 🙏 Main dashboard assistant hoon. Puchiye — "Rahul ka issuance", "total stock kya hai", "chassis ke kitne", "top agent kaun"… Aaj mere se kya janna chahte ho?',
      'Hello! 🙏 I am your dashboard assistant. Ask me — "Rahul\'s issuance", "total stock", "how many chassis", "who is the top agent"… What would you like to know today?', SUGGEST_CHIPS());

    // ---- top / champions (metric-aware: total, VC4, chassis, commercial, replacement, wrong VRN) ----
    if (has('TOP', 'CHAMPION', 'SABSE ZYADA', 'NUMBER ONE', 'NO 1')) {
      const metric = has('WRONG') ? 'wrongVrn' : has('REPLACE') ? 'replacement' : has('CHASSIS') ? 'chassis' : has('COMMERCIAL') ? 'commercial' : has('VC4') ? 'vc4' : 'total';
      const metricLabel = { total: '', vc4: ' (VC4 ke hisaab se)', commercial: ' (commercial ke hisaab se)', chassis: ' (chassis ke hisaab se)', replacement: ' (replacement ke hisaab se)', wrongVrn: ' (wrong VRN ke hisaab se)' }[metric];
      const ffAgg = new Map();
      if (metric === 'total') {
        D.agents.filter((a) => a.ym === m && a.channel === 'First Forward').forEach((a) => ffAgg.set(a.name, (ffAgg.get(a.name) || 0) + a.n));
      } else {
        D.agentClass.filter((r) => r.ym === m && r.channel === 'First Forward').forEach((r) => {
          const hit = metric === 'vc4' ? (r.group || '') === 'VC4'
            : metric === 'commercial' ? (r.group || '') !== 'VC4'
            : metric === 'chassis' ? /chassis/i.test(r.vrnType || '')
            : metric === 'replacement' ? /replacement/i.test(r.type || r.status || '')
            : /wrong/i.test(r.vrnType || '');
          if (hit) ffAgg.set(r.name, (ffAgg.get(r.name) || 0) + (Number(r.n) || 1));
        });
      }
      const gvAgg = new Map();
      if (metric !== 'wrongVrn') {
        D.gvMaster.filter((r) => r.ym === m).forEach((r) => {
          const isVc4 = ((r.group || r.cls || '') + '').toUpperCase().includes('VC4');
          const hit = metric === 'total' ? true
            : metric === 'vc4' ? isVc4
            : metric === 'commercial' ? !isVc4
            : metric === 'chassis' ? /chassis/i.test(r.tagType || '')
            : /replacement/i.test(r.status || '');
          if (hit) gvAgg.set(r.agentName, (gvAgg.get(r.agentName) || 0) + 1);
        });
      }
      const top = (mp) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v], i) => `${['🥇', '🥈', '🥉'][i]} ${n} — ${fmt(v)}`).join(' · ');
      if (has('GV')) return ans(`GV Partner ke top 3${metricLabel} (is month): ${top(gvAgg) || 'data nahi'}`, `GV Partner top 3${metricLabel} (this month): ${top(gvAgg) || 'no data'}`, [['agent list', T('Agent list', 'Agent list')]]);
      if (has('FF', 'FIRST')) return ans(`First Forward ke top 3${metricLabel} (is month): ${top(ffAgg) || 'data nahi'}`, `First Forward top 3${metricLabel} (this month): ${top(ffAgg) || 'no data'}`, [['agent list', T('Agent list', 'Agent list')]]);
      return ans(`Is month ke top 3${metricLabel} — FF: ${top(ffAgg) || '—'} · GV: ${top(gvAgg) || '—'}. Detail ke liye FASTag Champions page kholo.`,
        `This month's top 3${metricLabel} — FF: ${top(ffAgg) || '—'} · GV: ${top(gvAgg) || '—'}. Open the FASTag Champions page for details.`,
        [['agent list', T('Agent list', 'Agent list')], ['growth vs last month', T('Growth?', 'Growth?')]]);
    }

    // ---- follow-up pronouns ("iska stock?") → last discussed agent ----
    const isFollowUp = hasW('ISKA', 'ISKI', 'ISKE', 'USKA', 'USKI', 'USKE', 'INKA', 'INKI', 'INKE', 'ISKA', 'HIS', 'HER', 'THEIR');
    const found = findAgent(D, qRaw);
    const agent = found || (isFollowUp && ctx.agent ? ctx.agent : null);
    if (agent) ctx.agent = { key: agent.key, name: agent.name, id: agent.id };

    // ---- yesterday / week ----
    if (hasW('KAL', 'YESTERDAY') && !has('CHASSIS', 'WRONG', 'REPLACEMENT', 'COMMISSION')) {
      const key = dayOffsetKey(-1);
      const ffT = D.daily.filter((r) => r.key === key && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
      const gvT = D.gvMaster.filter((r) => r.date && U.dateKey(r.date) === key).length;
      return ans(`Kal (${esc(key)}): FF ${fmt(ffT)} + GV ${fmt(gvT)} = <b>${fmt(ffT + gvT)}</b> tags.`,
        `Yesterday (${esc(key)}): FF ${fmt(ffT)} + GV ${fmt(gvT)} = <b>${fmt(ffT + gvT)}</b> tags.`,
        [['aaj ka total issuance', 'Aaj ka total'], ['week ka total', 'Is hafte ka total']]);
    }
    if (hasW('HAFTA', 'HAFTE', 'HAFTEY', 'WEEK') || has('LAST 7', '7 DIN', 'SEVEN DAY')) {
      const keys = new Set([0, -1, -2, -3, -4, -5, -6].map(dayOffsetKey));
      const ffW = D.daily.filter((r) => keys.has(r.key) && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
      const gvW = D.gvMaster.filter((r) => r.date && keys.has(U.dateKey(r.date))).length;
      return ans(`Pichhle 7 din: FF ${fmt(ffW)} + GV ${fmt(gvW)} = <b>${fmt(ffW + gvW)}</b> tags.`,
        `Last 7 days: FF ${fmt(ffW)} + GV ${fmt(gvW)} = <b>${fmt(ffW + gvW)}</b> tags.`,
        [['aaj ka total issuance', 'Aaj ka total'], ['kal ka total', 'Kal ka total']]);
    }

    // ---- VC4 / commercial class mix (issuance) ----
    if ((hasW('VC4', 'VC20', 'VC5') && !has('CHASSIS', 'STOCK')) || has('CLASS MIX', 'SPLIT') || (has('COMMERCIAL') && has('KITNE', 'SPLIT', 'MIX', 'VERSUS', 'VS'))) {
      const ffVc4 = D.agentClass.filter((r) => r.ym === m && r.channel === 'First Forward' && (r.group || '') === 'VC4').reduce((n, r) => n + r.n, 0);
      const ffAll = D.agentClass.filter((r) => r.ym === m && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
      const gvVc4 = D.gvMaster.filter((r) => r.ym === m && ((r.group || r.cls || '') + '').toUpperCase().includes('VC4')).length;
      const gvAll = D.gvMaster.filter((r) => r.ym === m).length;
      return ans(`Is month class mix — FF: VC4 ${fmt(ffVc4)} vs commercial ${fmt(Math.max(0, ffAll - ffVc4))} (total ${fmt(ffAll)}) · GV: VC4 ${fmt(gvVc4)} vs commercial ${fmt(Math.max(0, gvAll - gvVc4))} (total ${fmt(gvAll)}).`,
        `This month's class mix — FF: VC4 ${fmt(ffVc4)} vs commercial ${fmt(Math.max(0, ffAll - ffVc4))} (total ${fmt(ffAll)}) · GV: VC4 ${fmt(gvVc4)} vs commercial ${fmt(Math.max(0, gvAll - gvVc4))} (total ${fmt(gvAll)}).`,
        [['chassis ke kitne', 'Chassis?'], ['replacement kitne', 'Replacement?']]);
    }

    // ---- growth / month comparison ----
    if (has('GROWTH', 'PICHLE MONTH', 'LAST MONTH', 'PREVIOUS MONTH', 'MONTH COMPARE')) {
      const prev = U.prevMonthKey ? U.prevMonthKey(m) : (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return U.ymKey(d); })();
      const ff = (ym) => D.daily.filter((r) => r.ym === ym && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
      const gv = (ym) => D.gvMaster.filter((r) => r.ym === ym).length;
      const pct = (a, b) => b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(1)}%` : '—';
      return ans(`Growth — FF: ${fmt(ff(m))} is month vs ${fmt(ff(prev))} (${esc(U.labelYM(prev))}) → <b>${pct(ff(m), ff(prev))}</b> · GV: ${fmt(gv(m))} vs ${fmt(gv(prev))} → <b>${pct(gv(m), gv(prev))}</b>.`,
        `Growth — FF: ${fmt(ff(m))} this month vs ${fmt(ff(prev))} (${esc(U.labelYM(prev))}) → <b>${pct(ff(m), ff(prev))}</b> · GV: ${fmt(gv(m))} vs ${fmt(gv(prev))} → <b>${pct(gv(m), gv(prev))}</b>.`,
        [['aaj ka total issuance', 'Aaj ka total'], ['top agent kaun', 'Top agent']]);
    }

    // ---- chassis / wrong vrn / replacement (agent-aware) ----
    if (has('CHASSIS')) {
      if (agent) {
        const ffC = D.agentClass.filter((r) => r.ym === m && r.channel === 'First Forward' && norm(r.name) === agent.key && /chassis/i.test(r.vrnType || '')).reduce((n, r) => n + r.n, 0);
        const gvC = D.gvMaster.filter((r) => r.ym === m && norm(r.agentName) === agent.key && /chassis/i.test(r.tagType || '')).length;
        return ans(`${agent.name} ke chassis tags (is month): FF ${fmt(ffC)} · GV ${fmt(gvC)} — total ${fmt(ffC + gvC)}.`,
          `${agent.name}'s chassis tags (this month): FF ${fmt(ffC)} · GV ${fmt(gvC)} — total ${fmt(ffC + gvC)}.`,
          [[`${agent.name} ka stock`, 'Iska stock'], [`${agent.name} ka full summary`, 'Full summary']]);
      }
      const ffC = D.daily.filter((r) => r.ym === m && /chassis/i.test(r.vrnType || '')).reduce((n, r) => n + (r.channel === 'First Forward' ? r.n : 0), 0);
      const gvC = D.gvMaster.filter((r) => r.ym === m && /chassis/i.test(r.tagType || '')).length;
      return ans(`Is month chassis tags — FF ${fmt(ffC)} · GV ${fmt(gvC)}, total ${fmt(ffC + gvC)}.`,
        `Chassis tags this month — FF ${fmt(ffC)} · GV ${fmt(gvC)}, total ${fmt(ffC + gvC)}.`,
        [['replacement kitne', 'Replacement?'], ['wrong VRN kitne', 'Wrong VRN?']]);
    }
    if (has('WRONG')) {
      if (agent) {
        const ffW = D.agentClass.filter((r) => r.ym === m && r.channel === 'First Forward' && norm(r.name) === agent.key && /wrong/i.test(r.vrnType || '')).reduce((n, r) => n + r.n, 0);
        return ans(`${agent.name} ke Wrong VRN tags (is month, FF EIR): ${fmt(ffW)}.`,
          `${agent.name}'s Wrong-VRN tags (this month, FF EIR): ${fmt(ffW)}.`,
          [[`${agent.name} ka full summary`, 'Full summary']]);
      }
      const ffW = D.daily.filter((r) => r.ym === m && /wrong/i.test(r.vrnType || '')).reduce((n, r) => n + (r.channel === 'First Forward' ? r.n : 0), 0);
      return ans(`Is month Wrong VRN tags (FF EIR): ${fmt(ffW)}. GV Master me wrong-VRN flag alag track nahi hota.`,
        `Wrong-VRN tags this month (FF EIR): ${fmt(ffW)}. The GV Master does not track a wrong-VRN flag separately.`,
        [['chassis ke kitne', 'Chassis?']]);
    }
    if (has('REPLACEMENT', 'REPLACE')) {
      if (agent) {
        const ffR = D.agentClass.filter((r) => r.ym === m && r.channel === 'First Forward' && norm(r.name) === agent.key && /replacement/i.test(r.type || r.status || '')).reduce((n, r) => n + r.n, 0);
        const gvR = D.gvMaster.filter((r) => r.ym === m && norm(r.agentName) === agent.key && /replacement/i.test(r.status || '')).length;
        return ans(`${agent.name} ke replacement tags (is month): FF ${fmt(ffR)} · GV ${fmt(gvR)} — total ${fmt(ffR + gvR)}.`,
          `${agent.name}'s replacement tags (this month): FF ${fmt(ffR)} · GV ${fmt(gvR)} — total ${fmt(ffR + gvR)}.`,
          [[`${agent.name} ka stock`, 'Iska stock']]);
      }
      const ffR = D.daily.filter((r) => r.ym === m && r.type === 'REPLACEMENT' && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
      const gvR = D.gvMaster.filter((r) => r.ym === m && /replacement/i.test(r.status || '')).length;
      return ans(`Is month replacement tags — FF ${fmt(ffR)} · GV ${fmt(gvR)}, total ${fmt(ffR + gvR)}.`,
        `Replacement tags this month — FF ${fmt(ffR)} · GV ${fmt(gvR)}, total ${fmt(ffR + gvR)}.`,
        [['chassis ke kitne', 'Chassis?'], ['wrong VRN kitne', 'Wrong VRN?']]);
    }

    // ---- stock ----
    if (has('STOCK')) {
      if (agent) {
        const ffS = D.stockAgents.filter((r) => norm(r.agentName) === agent.key).reduce((n, r) => n + r.n, 0);
        const gvS = D.gvStock.filter((r) => norm(r.agentName) === agent.key).reduce((n, r) => n + r.n, 0);
        return ans(`${agent.name} ke paas stock: FF ${fmt(ffS)} tags · GV ${fmt(gvS)} tags — total ${fmt(ffS + gvS)}.`,
          `${agent.name} has stock of: FF ${fmt(ffS)} tags · GV ${fmt(gvS)} tags — total ${fmt(ffS + gvS)}.`,
          [[`${agent.name} ki commission`, 'Iski commission'], [`${agent.name} ka issuance`, 'Iska issuance']]);
      }
      const ffS = D.stockAgents.reduce((n, r) => n + r.n, 0), gvS = D.gvStock.reduce((n, r) => n + r.n, 0);
      const ffVc4 = D.stockAgents.filter((r) => r.group === 'VC4').reduce((n, r) => n + r.n, 0);
      return ans(`Total field stock — FF ${fmt(ffS)} (VC4 ${fmt(ffVc4)}, commercial ${fmt(ffS - ffVc4)}) · GV ${fmt(gvS)} · combined ${fmt(ffS + gvS)} tags.`,
        `Total field stock — FF ${fmt(ffS)} (VC4 ${fmt(ffVc4)}, commercial ${fmt(ffS - ffVc4)}) · GV ${fmt(gvS)} · combined ${fmt(ffS + gvS)} tags.`,
        [['top agent kaun', 'Top agent'], ['aaj ka total issuance', 'Aaj ka total']]);
    }

    // ---- commission ----
    if (has('COMMISSION', 'KAMAI', 'PAYOUT')) {
      if (agent) {
        const gvC = D.gvMaster.filter((r) => r.ym === m && norm(r.agentName) === agent.key).reduce((n, r) => n + (r.commission || 0), 0);
        const gvN = D.gvMaster.filter((r) => r.ym === m && norm(r.agentName) === agent.key).length;
        return ans(`${agent.name} ki GV commission (is month): ${money(gvC)} · ${fmt(gvN)} tags. FF commission REPORT sheet se aata hai — FF Commission page par dekho.`,
          `${agent.name}'s GV commission (this month): ${money(gvC)} · ${fmt(gvN)} tags. FF commission comes from the REPORT sheet — see the FF Commission page.`,
          [[`${agent.name} ka stock`, 'Iska stock']]);
      }
      const gvC = D.gvMaster.filter((r) => r.ym === m).reduce((n, r) => n + (r.commission || 0), 0);
      return ans(`GV Partner ki total commission (is month): ${money(gvC)}. FF ki exact earned ke liye FF Commission page kholo.`,
        `GV Partner total commission (this month): ${money(gvC)}. Open the FF Commission page for FF's exact earned figure.`,
        [['top agent kaun', 'Top agent']]);
    }

    // ---- agent full summary (360) ----
    if (agent && has('FULL', 'SAB KUCH', 'SUMMARY', 'PROFILE', '360', 'REPORT')) {
      const today = todayKey();
      const ffMonth = D.agents.filter((a) => a.ym === m && a.channel === 'First Forward' && norm(a.name) === agent.key).reduce((n, a) => n + a.n, 0);
      const gvMonth = D.gvMaster.filter((r) => r.ym === m && norm(r.agentName) === agent.key).length;
      const ffS = D.stockAgents.filter((r) => norm(r.agentName) === agent.key).reduce((n, r) => n + r.n, 0);
      const gvS = D.gvStock.filter((r) => norm(r.agentName) === agent.key).reduce((n, r) => n + r.n, 0);
      const gvC = D.gvMaster.filter((r) => r.ym === m && norm(r.agentName) === agent.key).reduce((n, r) => n + (r.commission || 0), 0);
      const chassis = D.agentClass.filter((r) => r.ym === m && r.channel === 'First Forward' && norm(r.name) === agent.key && /chassis/i.test(r.vrnType || '')).reduce((n, r) => n + r.n, 0)
        + D.gvMaster.filter((r) => r.ym === m && norm(r.agentName) === agent.key && /chassis/i.test(r.tagType || '')).length;
      return ans(`📊 <b>${esc(agent.name)}</b> (${esc(agent.id || 'ID blank')}) — full summary:<br>· Issuance (is month): FF ${fmt(ffMonth)} + GV ${fmt(gvMonth)} = <b>${fmt(ffMonth + gvMonth)}</b> tags<br>· Stock: FF ${fmt(ffS)} + GV ${fmt(gvS)} = <b>${fmt(ffS + gvS)}</b> tags<br>· GV commission: ${money(gvC)}<br>· Chassis tags: ${fmt(chassis)}`,
        `📊 <b>${esc(agent.name)}</b> (${esc(agent.id || 'ID blank')}) — full summary:<br>· Issuance (this month): FF ${fmt(ffMonth)} + GV ${fmt(gvMonth)} = <b>${fmt(ffMonth + gvMonth)}</b> tags<br>· Stock: FF ${fmt(ffS)} + GV ${fmt(gvS)} = <b>${fmt(ffS + gvS)}</b> tags<br>· GV commission: ${money(gvC)}<br>· Chassis tags: ${fmt(chassis)}`,
        [[`${agent.name} ka stock`, 'Stock detail'], [`${agent.name} ki commission`, 'Commission detail']]);
    }

    // ---- agent-wise issuance (aaj / month) ----
    if (agent && has('ISSUANCE', 'TAG', 'KITNE', 'KITNA', 'LAGAYE', 'LAGE', 'KAAM')) {
      const today = todayKey();
      const gvToday = D.gvMaster.filter((r) => norm(r.agentName) === agent.key && r.date && U.dateKey(r.date) === today).length;
      const gvMonth = D.gvMaster.filter((r) => norm(r.agentName) === agent.key && r.ym === m).length;
      const ffMonth = D.agents.filter((a) => a.ym === m && a.channel === 'First Forward' && norm(a.name) === agent.key).reduce((n, a) => n + a.n, 0);
      if (has('AAJ', 'TODAY')) {
        const ffToday = D.daily.filter((r) => r.key === today && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
        return ans(`${agent.name} — aaj GV ${fmt(gvToday)} tags. FF side aaj agent-wise record EIR summary me nahi aata; FF month-to-date ${fmt(ffMonth)} tags hai (poore FF channel ne aaj ${fmt(ffToday)} tags lagaye).`,
          `${agent.name} — today GV ${fmt(gvToday)} tags. Agent-wise FF record for today is not in the EIR summary; FF month-to-date is ${fmt(ffMonth)} tags (the whole FF channel issued ${fmt(ffToday)} tags today).`,
          [[`${agent.name} ka stock`, 'Iska stock'], [`${agent.name} ka full summary`, 'Full summary']]);
      }
      return ans(`${agent.name} ka issuance (is month): FF ${fmt(ffMonth)} · GV ${fmt(gvMonth)} — total ${fmt(ffMonth + gvMonth)} tags.`,
        `${agent.name}'s issuance (this month): FF ${fmt(ffMonth)} · GV ${fmt(gvMonth)} — total ${fmt(ffMonth + gvMonth)} tags.`,
        [[`${agent.name} ka stock`, 'Iska stock'], [`${agent.name} ki commission`, 'Iski commission']]);
    }

    // ---- totals ----
    if (has('TOTAL', 'ISSUANCE', 'KITNE TAG', 'BUSINESS')) {
      const ffM = D.daily.filter((r) => r.ym === m && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
      const gvM = D.gvMaster.filter((r) => r.ym === m).length;
      const today = todayKey();
      const ffT = D.daily.filter((r) => r.key === today && r.channel === 'First Forward').reduce((n, r) => n + r.n, 0);
      const gvT = D.gvMaster.filter((r) => r.date && U.dateKey(r.date) === today).length;
      return ans(`Aaj: FF ${fmt(ffT)} + GV ${fmt(gvT)} = ${fmt(ffT + gvT)} tags. Is month: FF ${fmt(ffM)} + GV ${fmt(gvM)} = ${fmt(ffM + gvM)} tags.`,
        `Today: FF ${fmt(ffT)} + GV ${fmt(gvT)} = ${fmt(ffT + gvT)} tags. This month: FF ${fmt(ffM)} + GV ${fmt(gvM)} = ${fmt(ffM + gvM)} tags.`,
        [['kal ka total', 'Kal ka total'], ['growth vs last month', 'Growth?'], ['top agent kaun', 'Top agent']]);
    }

    // ---- agent list / browse ----
    if (has('AGENT LIST', 'LIST AGENT', 'KAUN KAUN', 'SAARE AGENT', 'SAB AGENT', 'AGENTON')) {
      const ffAgg = new Map();
      D.agents.filter((a) => a.ym === m && a.channel === 'First Forward').forEach((a) => ffAgg.set(a.name, (ffAgg.get(a.name) || 0) + a.n));
      const gvAgg = new Map();
      D.gvMaster.filter((r) => r.ym === m).forEach((r) => gvAgg.set(r.agentName, (gvAgg.get(r.agentName) || 0) + 1));
      const topList = (mp, n) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, v]) => `${esc(name)} (${fmt(v)})`).join(', ') || '—';
      return ans(`Top agents (is month) — FF: ${topList(ffAgg, 5)} · GV: ${topList(gvAgg, 5)}. Poora leaderboard FASTag Champions page par hai.`,
        `Top agents (this month) — FF: ${topList(ffAgg, 5)} · GV: ${topList(gvAgg, 5)}. The full leaderboard is on the FASTag Champions page.`,
        [['top agent kaun', 'Top 3'], ['growth vs last month', 'Growth?']]);
    }

    if (agent) return ans(`${agent.name} mila (${agent.id || 'ID blank'}). Issuance/stock/commission puchne ke liye "Rahul ka issuance", "Rahul ka stock", "Rahul ki commission" bolo.`,
      `Found ${agent.name} (${agent.id || 'ID blank'}). Ask "Rahul's issuance", "Rahul's stock" or "Rahul's commission".`,
      [[`${agent.name} ka full summary`, 'Full summary'], [`${agent.name} ka stock`, 'Iska stock']]);

    // ---- casual catch — chhoti baat ("acha", "nice", "aur kuch") ka friendly jawab ----
    const qWords = q.split(' ').filter(Boolean);
    if (qWords.length && qWords.length <= 3) {
      return ans(
        `Hmm "${esc(clean(qRaw))}" — theek hai! 😄 Par main data assistant hoon — aaj kya janna chahte ho? Top VC4, top GV agents, wrong VRN, stock, ya <b>"Rahul ka issuance"</b>!`,
        `Hmm "${esc(clean(qRaw))}" — okay! 😄 But I am a data assistant — what would you like to know? Top VC4, top GV agents, wrong VRN, stock, or <b>"Rahul's issuance"</b>!`,
        SUGGEST_CHIPS()
      );
    }

    return ans('Ye samajh nahi aaya 🤔. Ye puch sakte hain — "aaj ka total issuance", "Rahul ka issuance", "stock kya hai", "Rahul ka stock", "chassis ke kitne", "wrong VRN", "replacement kitne", "Rahul ki commission", "top agent kaun". Ya <b>help</b> bolo.',
      'I did not understand that 🤔. Try — "today\'s total issuance", "Rahul\'s issuance", "what is the stock", "Rahul\'s stock", "how many chassis", "wrong VRN", "how many replacements", "Rahul\'s commission", "who is the top agent". Or say <b>help</b>.',
      [['help', 'Help dekho'], ['aaj ka total issuance', 'Aaj ka total']]);
  }

  // ---------- voice output (default voices + "Meri awaaz" profile) ----------
  /** speak(text, { onEnd, cancel, force }) — chaining ke liye onEnd; cancel:false se queue hota hai. */
  function speak(text, opts) {
    const o = opts || {};
    let done = false;
    const finish = () => { if (!done) { done = true; if (o.onEnd) { try { o.onEnd(); } catch { /* listener */ } } } };
    if (!('speechSynthesis' in window)) { finish(); return; }
    if (!speakOn && !o.force) { finish(); return; }
    try {
      if (o.cancel !== false) window.speechSynthesis.cancel();
      const plain = String(text).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      const u = new SpeechSynthesisUtterance(plain);
      const vs = window.speechSynthesis.getVoices() || [];
      const p = U.voicePrefs();
      const prof = U.voiceProfile();
      const v = U.matchVoice(vs, lang, prof);
      if (v) u.voice = v;
      u.lang = (v && v.lang) || (lang === 'en' ? 'en-IN' : 'hi-IN');
      // pitch/rate: "Meri awaaz" profile apply hone par woh values prefs me aa chuki hote hain.
      u.rate = Number(p.rate) > 0 ? Number(p.rate) : 1.02;
      u.pitch = Number(p.pitch) > 0 ? Number(p.pitch) : 1;
      u.onend = finish;
      u.onerror = finish;
      window.speechSynthesis.speak(u);
    } catch { finish(); }
  }

  // ---------- UI ----------
  const CHIP_Q = {
    hi: [['aaj ka total issuance', 'Aaj ka total'], ['stock kya hai', 'Stock kya hai'], ['chassis ke kitne', 'Chassis kitne'], ['top agent kaun', 'Top agent'], ['help', 'Help']],
    en: [["today's total issuance", "Today's total"], ['what is the stock', 'Stock?'], ['how many chassis', 'Chassis count'], ['who is top agent', 'Top agent'], ['help', 'Help']]
  };
  const WELCOME = {
    hi: 'Namaste! 🙏 Main dashboard assistant hoon — mic 🎙️ se bol kar pucho, ✍️ se bol kar likho, ya type karo: <b>"Rahul ka issuance"</b>, <b>"stock kya hai"</b>, <b>"chassis ke kitne"</b>, <b>"top agent kaun"</b>… Awaz ⚙️ se badal sakte hain — default voices ya apni awaaz upload/record karke.',
    en: 'Hello! 🙏 I am your dashboard assistant — ask with the mic 🎙️, dictate with ✍️, or type: <b>"Rahul\'s issuance"</b>, <b>"what is the stock"</b>, <b>"how many chassis"</b>, <b>"who is the top agent"</b>… Change the voice via ⚙️ — default voices or upload/record your own voice.'
  };
  const HINT = {
    hi: 'Hinglish me pucho — preloaded data se turant jawab',
    en: 'Ask in English or Hinglish — instant answers from preloaded data'
  };
  const PLACEHOLDER = { hi: 'e.g. "Rahul ka issuance" ya "stock kya hai"…', en: 'e.g. "Rahul\'s issuance" or "what is the stock"…' };
  const MIC_TITLE = { hi: '🎤 Bol kar pucho (turant jawab)', en: '🎤 Ask by voice (instant answer)' };
  const MIC_HINT = { hi: '🎤 Boliye — "Rahul ka issuance", "stock kya hai"…', en: '🎤 Speak — "Rahul\'s issuance", "what is the stock"…' };
  const DICTATE_TITLE = { hi: '✍️ Bol kar likho — input me type hoga, edit karke bhejo', en: '✍️ Speak to type — text lands in the box, edit then send' };
  const DICTATE_HINT = { hi: '✍️ Boliye… jo kahoge wo input box me likha jayega', en: '✍️ Speak… your words will be typed into the box' };

  function bubble(text, who) {
    const el = document.createElement('div');
    el.className = `ask-msg ${who}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (who === 'me') {
      el.innerHTML = `${esc(text)}<div class="ask-meta"><span>${time}</span></div>`;
    } else {
      el.innerHTML = `${text}<div class="ask-meta"><span>${time}</span><button class="ask-copy" type="button">📋 Copy</button></div>`;
      const copyBtn = el.querySelector('.ask-copy');
      if (copyBtn) copyBtn.addEventListener('click', () => {
        const plain = String(text).replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '');
        U.copyText ? U.copyText(plain) : navigator.clipboard && navigator.clipboard.writeText(plain);
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1200);
      });
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function renderFollowups() {
    const old = panel && panel.querySelector('.ask-followups');
    if (old) old.remove();
    if (!panel || !ctx.chips || !ctx.chips.length || !log) return;
    const wrap = document.createElement('div');
    wrap.className = 'ask-followups';
    wrap.innerHTML = ctx.chips.map(([q, label]) => `<button type="button" data-q="${esc(q)}">${esc(label)} ↻</button>`).join('');
    wrap.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { ask(b.dataset.q); }));
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  async function ask(text) {
    if (!text || busy) return;
    busy = true;
    ctx.chips = [];
    const oldChips = panel && panel.querySelector('.ask-followups');
    if (oldChips) oldChips.remove();
    bubble(text, 'me');
    const wait = document.createElement('div');
    wait.className = 'ask-msg bot dim';
    wait.textContent = T('…dekh raha hoon', '…checking');
    log.appendChild(wait); log.scrollTop = log.scrollHeight;
    let a;
    try { a = await answer(text); } catch (e) { a = T(`Data load nahi hua (${esc(e.message || 'error')}) — thodi der baad try karo.`, `Could not load data (${esc(e.message || 'error')}) — please try again shortly.`); }
    wait.remove();
    bubble(a, 'bot');
    ctx.lastBot = a;
    speak(a, { onEnd: () => { if (convMode) scheduleListen(); } });
    renderFollowups();
    busy = false;
  }

  function micListen(btn) {
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch { /* barge-in */ }
    U.voiceInput((t) => ask(t), MIC_HINT[lang], { lang: lang === 'en' ? 'en-IN' : 'hi-IN', button: btn });
  }

  // 🎧 hands-free loop — jawab bolne ke baad khud dobara sunna shuru (Alexa-style).
  function scheduleListen() {
    if (!convMode || !panel || panel.hidden) return;
    if (convTurns >= 8) {
      convTurns = 0; convMode = false;
      try { U.setVoicePrefs({ convMode: false }); } catch { /* optional */ }
      syncLangUI();
      bubble(T('🎧 8 turns poore — security ke liye hands-free mode auto band. 🎧 dabakar wapas chalu kar sakte ho.', '🎧 8 turns done — hands-free mode auto-paused. Tap 🎧 to resume.'), 'bot');
      return;
    }
    convTurns++;
    setTimeout(() => {
      if (convMode && panel && !panel.hidden) micListen(panel.querySelector('.ask-mic'));
    }, 450);
  }

  // ---------- ✍️ speak-to-type (dictation → input box, live interim preview) ----------
  function dictate(btn) {
    const inp = panel.querySelector('.ask-input');
    const hint = panel.querySelector('.ask-dictate-hint');
    if (!inp) return;
    if (btn.classList.contains('listening')) { U.voiceInput(() => {}, '', { button: btn }); return; } // stop toggle
    let base = inp.value.replace(/\s+$/, '');
    if (hint) { hint.classList.add('on'); hint.innerHTML = `<b>✍️ Sun raha hoon…</b> ${esc(DICTATE_HINT[lang])}`; }
    inp.classList.add('dictating');
    U.voiceInput((finalText) => {
      base = `${base ? `${base} ` : ''}${finalText}`.trim();
      inp.value = `${base} `;
      inp.focus();
      if (hint) hint.innerHTML = `<b>✍️ Likha gaya ✓</b> ${esc(lang === 'en' ? 'Edit if needed, then hit ➤ to ask.' : 'Chaho to edit karo, phir ➤ dabakar bhejo.')}`;
    }, DICTATE_HINT[lang], {
      lang: lang === 'en' ? 'en-IN' : 'hi-IN',
      button: btn,
      dictation: true,
      onInterim: (t) => {
        if (t) inp.value = `${base ? `${base} ` : ''}${t}`;
        else inp.value = `${base} `;
      },
      onEnd: () => {
        inp.classList.remove('dictating');
        if (hint) hint.classList.remove('on');
      }
    });
  }

  // ---------- 🌅 login greeting (Alexa-style: "Good morning <name>! Kaise ho aap?") ----------
  function openPanel() {
    if (!panel) return null;
    log = panel.querySelector('.ask-log');
    panel.hidden = false;
    return log;
  }

  /** Greeting flow: awaaz me greeting + phir "aaj kya janna chahte ho?" + suggestion chips. */
  function startGreeting(kind) {
    if (!panel) return;
    if (U.voicePrefs && U.voicePrefs().greet === false) return;
    if (kind !== 'login' && greeted) return;
    greeted = true;
    try { sessionStorage.setItem('ff-greeted', '1'); } catch { /* optional */ }
    openPanel();
    const g = greetingText();
    bubble(g, 'bot');
    ctx.lastBot = g;
    ctx.chips = SUGGEST_CHIPS();
    renderFollowups();
    speak(g, {
      onEnd: () => {
        if (!panel || panel.hidden) return;
        const p = lang === 'en' ? ASK_PROMPT.en : ASK_PROMPT.hi;
        bubble(p, 'bot');
        ctx.lastBot = p;
        renderFollowups();
        speak(p, { onEnd: () => { if (convMode) scheduleListen(); } });
      }
    });
    // autoplay-policy fallback: sound block ho to friendly hint.
    setTimeout(() => {
      try {
        if ('speechSynthesis' in window && speakOn && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          bubble(T('🔇 Browser ne sound block ki — page par kahin bhi click karke dobara bolna start karo, awaaz chalu ho jayegi.', '🔇 The browser blocked sound — click anywhere on the page and ask again, audio will start.'), 'bot');
        }
      } catch { /* optional */ }
    }, 1600);
  }

  function maybeGreet() {
    if (!panel || greeted) return;
    let seen = '';
    try { seen = sessionStorage.getItem('ff-greeted') || ''; } catch { /* optional */ }
    if (seen) return;
    startGreeting('restore');
  }

  // ff-login event (auth.js dispatch) — fresh login par turant greeting; build se pehle bhi aaye to miss nahi hona chahiye.
  let pendingGreet = null;
  function onLoginEvent() {
    if (mounted && panel) { startGreeting('login'); }
    else pendingGreet = 'login';
  }
  try { if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('ff-login', onLoginEvent); } catch { /* non-browser */ }

  // ---------- 🎛 Voice Studio — default voices + "Meri awaaz" upload/record ----------
  let studio = null;
  function voiceOptionsHtml(p, key) {
    let vs = [];
    try { vs = ('speechSynthesis' in window) ? (window.speechSynthesis.getVoices() || []) : []; } catch { vs = []; }
    const score = (v) => (/^hi[-_]/i.test(v.lang) ? 0 : /^en[-_]IN/i.test(v.lang) ? 1 : /^en/i.test(v.lang) ? 2 : 3);
    const sorted = vs.slice().sort((a, b) => score(a) - score(b) || String(a.name).localeCompare(String(b.name)));
    const cur = key === 'en' ? p.en : p.hi;
    return `<option value="">🎲 Auto — browser default</option>${sorted.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === cur ? 'selected' : ''}>${esc(v.name)} · ${esc(v.lang)}${v.localService ? '' : ' · 🟣'}</option>`).join('')}`;
  }

  function openVoiceStudio() {
    if (!panel) return;
    const p = U.voicePrefs();
    const prof = U.voiceProfile();
    const old = document.getElementById('ask-voice-studio');
    if (old) old.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'ask-voice-studio';
    dialog.className = 'ask-studio';
    const profChips = prof
      ? `<div class="ask-voice-chips"><span class="ins-pill hot">🎤 ${esc(prof.name)}</span><span class="ins-pill">Pitch ~${esc(prof.hz)} Hz · ${esc(prof.gender === 'male' ? 'deep' : 'soft')}</span><span class="ins-pill">Speed ${Number(prof.rate).toFixed(2)}×</span><span class="ins-pill">Tone ${esc((prof.brightness || 0) > 1400 ? 'bright' : 'warm')}</span></div>`
      : `<div class="ask-voice-chips"><span class="ins-pill">Abhi koi personal voice profile nahi — default voice chal rahi hai.</span></div>`;
    dialog.innerHTML = `
      <div class="ask-studio-head"><div style="flex:1"><b>🎛 Voice Studio</b><small>Assistant ki awaaz yahan se set karo</small></div><button class="ask-ico" data-close title="Band karo">✕</button></div>
      <div class="ask-studio-body">
        <div class="ask-studio-tabs" role="tablist">
          <button class="on" data-tab="default" role="tab">🗣 Default voices</button>
          <button data-tab="mine" role="tab">🎤 Meri awaaz</button>
        </div>
        <div class="ask-studio-pane on" data-pane="default">
          <p class="ask-studio-note">Browser ki system voices — Hindi/English ke liye alag voice, speed aur pitch choose karo. 🟣 = online voice (zyada natural).</p>
          <label class="fld"><span>🌐 Assistant language</span><select class="input" data-vkey="lang"><option value="hi" ${p.lang !== 'en' ? 'selected' : ''}>हिंदी / Hinglish</option><option value="en" ${p.lang === 'en' ? 'selected' : ''}>English</option></select></label>
          <label class="fld"><span>🗣 Hindi / Hinglish awaaz</span><select class="input" data-vkey="hi">${voiceOptionsHtml(p, 'hi')}</select></label>
          <label class="fld"><span>🗣 English awaaz</span><select class="input" data-vkey="en">${voiceOptionsHtml(p, 'en')}</select></label>
          <label class="fld"><span>⚡ Speed <b data-vval="rate">${Number(p.rate) > 0 ? Number(p.rate) : 1.02}</b></span><input type="range" data-vkey="rate" min="0.5" max="1.5" step="0.05" value="${Number(p.rate) > 0 ? Number(p.rate) : 1.02}"></label>
          <label class="fld"><span>🎵 Pitch <b data-vval="pitch">${Number(p.pitch) > 0 ? Number(p.pitch) : 1}</b></span><input type="range" data-vkey="pitch" min="0.5" max="1.5" step="0.05" value="${Number(p.pitch) > 0 ? Number(p.pitch) : 1}"></label>
          <div class="btn-row"><button class="btn small" data-test="hi">🔊 Hindi test</button><button class="btn small" data-test="en">🔊 English test</button><button class="btn small" data-reset>↺ Default</button></div>
        </div>
        <div class="ask-studio-pane" data-pane="mine">
          <p class="ask-studio-note"><b>Meri awaaz 🎤</b> — apni voice ka 5–15 second ka sample record karo ya audio file upload karo. Assistant uski <b>pitch, speed aur tone</b> analyze kar ke usi style me bolne lagta hai (browser TTS tone-match — real voice cloning jaisa feel). Audio file sirf analyze ke liye hoti hai, save nahi hoti.</p>
          ${profChips}
          <div class="voice-drop" data-drop><b>📁 Voice sample upload karo</b><small>MP3 / WAV / M4A / WEBM — ya yahan drag & drop karo</small><input type="file" accept="audio/*" hidden data-file></div>
          <div class="voice-rec-row"><button class="btn" data-rec>⏺ Record karo</button><span class="dim small" data-rec-status>5–15 second clear bolo (mic permission maangega)</span></div>
          <div data-preview-wrap hidden><audio class="ask-audio-preview" controls data-preview></audio></div>
          <div class="ask-voice-chips" data-analysis></div>
          <div class="btn-row"><button class="btn primary" data-apply hidden>✅ Meri awaaz lagao</button><button class="btn small" data-test-mine hidden>🔊 Test meri awaaz me</button>${prof ? '<button class="btn small danger" data-clear>🗑 Profile hatao</button>' : ''}</div>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    studio = dialog;

    // ---- common ----
    const close = () => { try { dialog.close(); } catch { /* open nahi */ } dialog.remove(); studio = null; };
    dialog.querySelector('[data-close]').addEventListener('click', close);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    // tabs
    dialog.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      dialog.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      dialog.querySelectorAll('[data-pane]').forEach((paneEl) => paneEl.classList.toggle('on', paneEl.dataset.pane === b.dataset.tab));
    }));
    // ---- default voices pane ----
    dialog.querySelectorAll('[data-vkey]').forEach((el) => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const key = el.dataset.vkey;
        if (el.tagName === 'SELECT') {
          if (key === 'lang') { U.setVoicePrefs({ lang: el.value }); setLang(el.value); }
          else U.setVoicePrefs({ [key]: el.value });
        } else {
          U.setVoicePrefs({ [key]: Number(el.value) });
          const out = dialog.querySelector(`[data-vval="${key}"]`);
          if (out) out.textContent = el.value;
        }
      });
    });
    const speakSample = (langKey) => {
      if (!('speechSynthesis' in window)) return U.toast('Is browser me speech synthesis support nahi hai — Chrome/Edge try karo.', 'warn');
      try {
        window.speechSynthesis.cancel();
        const text = langKey === 'en' ? 'Hello! I am your First Forward dashboard assistant. Rahul issued forty tags today.' : 'Namaste! Main First Forward dashboard assistant hoon. Aaj Rahul ke chaalis tags lage.';
        const pp = U.voicePrefs();
        const u = new SpeechSynthesisUtterance(text);
        const vs = window.speechSynthesis.getVoices() || [];
        const v = U.matchVoice(vs, langKey === 'en' ? 'en' : 'hi', U.voiceProfile());
        if (v) u.voice = v;
        u.lang = (v && v.lang) || (langKey === 'en' ? 'en-IN' : 'hi-IN');
        u.rate = Number(pp.rate) > 0 ? Number(pp.rate) : 1.02;
        u.pitch = Number(pp.pitch) > 0 ? Number(pp.pitch) : 1;
        window.speechSynthesis.speak(u);
      } catch { /* optional */ }
    };
    dialog.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', () => speakSample(b.dataset.test)));
    const resetBtn = dialog.querySelector('[data-reset]');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      U.setVoiceProfile(null);
      U.setVoicePrefs({ lang: 'hi' });
      setLang('hi');
      U.toast('🎙 Voice settings default par reset ✓', 'ok');
      close(); openVoiceStudio();
    });

    // ---- meri awaaz pane ----
    const drop = dialog.querySelector('[data-drop]');
    const fileInput = dialog.querySelector('[data-file]');
    const analysisEl = dialog.querySelector('[data-analysis]');
    const previewWrap = dialog.querySelector('[data-preview-wrap]');
    const preview = dialog.querySelector('[data-preview]');
    const applyBtn = dialog.querySelector('[data-apply]');
    const testMine = dialog.querySelector('[data-test-mine]');
    const recBtn = dialog.querySelector('[data-rec]');
    const recStatus = dialog.querySelector('[data-rec-status]');
    let analyzed = null;
    const showAnalysis = (res, blob) => {
      analyzed = res;
      analysisEl.innerHTML = `<span class="ins-pill hot">Pitch ~${esc(res.hz)} Hz · ${esc(res.gender === 'male' ? 'deep voice' : 'soft voice')}</span><span class="ins-pill">Speed ${res.rate}× (${esc(res.syllPerSec)} syll/sec)</span><span class="ins-pill">Tone ${esc((res.brightness || 0) > 1400 ? 'bright' : 'warm')}</span><span class="ins-pill">Duration ${esc(res.seconds)}s ✓</span>`;
      if (blob) { try { preview.src = URL.createObjectURL(blob); previewWrap.hidden = false; } catch { /* optional */ } }
      applyBtn.hidden = false;
      if (testMine) testMine.hidden = false;
    };
    const handleBlob = async (blob, name) => {
      if (!blob) return;
      if (blob.size > 25 * 1024 * 1024) return U.toast('File bahut badi hai — 25MB se chhota sample do.', 'warn');
      analysisEl.innerHTML = '<span class="ins-pill">🔍 Awaaz analyze ho rahi hai…</span>';
      try {
        const res = await U.analyzeVoiceBlob(blob);
        if (!res.ok) { analysisEl.innerHTML = `<span class="ins-pill">⚠️ ${esc(res.reason)}</span>`; return; }
        res.name = name || 'Meri awaaz';
        showAnalysis(res, blob);
        U.toast('Awaaz analyze ho gayi — "Meri awaaz lagao" dabao ✓', 'ok');
      } catch (err) {
        analysisEl.innerHTML = `<span class="ins-pill">⚠️ ${esc(err.message || 'Decode nahi hua')}</span>`;
      }
    };
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('drag');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleBlob(f, f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Meri awaaz');
    });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) handleBlob(f, f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Meri awaaz');
    });
    let mediaRec = null, recChunks = [];
    recBtn.addEventListener('click', async () => {
      if (mediaRec && mediaRec.state === 'recording') {
        mediaRec.stop();
        recBtn.textContent = '⏺ Record karo';
        recBtn.classList.remove('danger');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recChunks = [];
        mediaRec = new MediaRecorder(stream);
        mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
        mediaRec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(recChunks, { type: mediaRec.mimeType || 'audio/webm' });
          recStatus.textContent = 'Recording complete ✓';
          handleBlob(blob, 'Meri awaaz');
        };
        mediaRec.start();
        recBtn.textContent = '⏹ Stop';
        recBtn.classList.add('danger');
        recStatus.textContent = '⏺ Recording… bolo abhi (5–15 second)';
      } catch {
        U.toast('Mic permission chahiye — recording ke liye Allow karo.', 'err');
      }
    });
    applyBtn.addEventListener('click', () => {
      if (!analyzed) return;
      U.setVoiceProfile(analyzed);
      U.toast('✅ Meri awaaz lag gayi — assistant ab isi tone me bolega!', 'ok');
      close(); openVoiceStudio();
    });
    if (testMine) testMine.addEventListener('click', () => speakSample(lang));
    const clearBtn = dialog.querySelector('[data-clear]');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      U.setVoiceProfile(null);
      U.toast('🗑 Voice profile hata di — default voice wapas.', 'ok');
      close(); openVoiceStudio();
    });

    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
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
    const dic = panel.querySelector('.ask-dictate');
    if (dic) { dic.title = DICTATE_TITLE[lang]; }
    const conv = panel.querySelector('[data-act="conv"]');
    if (conv) {
      conv.classList.toggle('on', convMode);
      conv.title = convMode ? '🎧 Hands-free ON — jawab ke baad khud sunta hai' : '🎧 Hands-free mode chalu karo (Alexa-style)';
    }
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
        <button class="ask-ico" data-act="voice" title="🎛 Voice Studio — default voices / meri awaaz">🎛️</button>
        <button class="ask-ico${convMode ? ' on' : ''}" data-act="conv" title="${convMode ? '🎧 Hands-free ON — jawab ke baad khud sunta hai' : '🎧 Hands-free mode chalu karo (Alexa-style)'}">🎧</button>
        <button class="ask-ico" data-act="speak" title="Jawab bol kar sunao (on/off)">🔊</button>
        <button class="ask-ico" data-act="close" title="Band karo">✕</button></div>
      <div class="ask-log" aria-live="polite"></div>
      <div class="ask-chips">${(CHIP_Q[lang] || CHIP_Q.hi).map(([q, label]) => `<button data-q="${esc(q)}">${esc(label)}</button>`).join('')}</div>
      <form class="ask-form"><button type="button" class="ask-mic" title="${MIC_TITLE[lang]}">🎙️</button><button type="button" class="ask-dictate" title="${DICTATE_TITLE[lang]}">✍️</button><input class="ask-input" placeholder="${esc(PLACEHOLDER[lang])}" autocomplete="off"><button class="ask-send" type="submit">➤</button></form>
      <div class="ask-dictate-hint"></div>`;
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
    wrap.querySelector('[data-act="voice"]').addEventListener('click', () => openVoiceStudio());
    wrap.querySelector('[data-act="speak"]').addEventListener('click', (e) => {
      speakOn = !speakOn;
      e.currentTarget.textContent = speakOn ? '🔊' : '🔇';
      if (!speakOn && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    });
    wrap.querySelector('[data-act="conv"]').addEventListener('click', (e) => {
      convMode = !convMode; convTurns = 0;
      try { U.setVoicePrefs({ convMode }); } catch { /* optional */ }
      e.currentTarget.classList.toggle('on', convMode);
      e.currentTarget.title = convMode ? '🎧 Hands-free ON — jawab ke baad khud sunta hai' : '🎧 Hands-free mode chalu karo (Alexa-style)';
      if (convMode) {
        bubble(T('🎧 Hands-free mode ON — ab main har jawab ke baad khud sunta rahunga. Bas boliye! "Stop listening" bolo toh band.', '🎧 Hands-free mode ON — I will keep listening after every answer. Just speak! Say "stop listening" to stop.'), 'bot');
        scheduleListen();
      } else {
        try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch { /* optional */ }
        bubble(T('🎧 Hands-free mode OFF — ab sirf tap/type par jawab.', '🎧 Hands-free mode OFF — I will answer only on tap/type.'), 'bot');
      }
    });
    wrap.querySelector('.ask-mic').addEventListener('click', (e) => micListen(e.currentTarget));
    wrap.querySelector('.ask-dictate').addEventListener('click', (e) => dictate(e.currentTarget));
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
      if (e && e.detail && typeof e.detail.convMode === 'boolean' && e.detail.convMode !== convMode) {
        convMode = e.detail.convMode;
        const conv = panel.querySelector('[data-act="conv"]');
        if (conv) conv.classList.toggle('on', convMode);
      }
    });

    // 🌅 greeting — fresh login (ff-login event) turant; warna pehli baar tab open hone par.
    if (pendingGreet) { const k = pendingGreet; pendingGreet = null; setTimeout(() => startGreeting(k), 650); }
    else setTimeout(maybeGreet, 1400);
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

  FF.assistant = { ask, answer, getLang, setLang, speak, openVoiceStudio, startGreeting, greetingWord, greetingText, get context() { return ctx; } };
})(window.FF);
