/* 🤖 v3.125.121 — Gems robot (assistant ka hi robot) site par
   Purana 🎙 FAB ki jagah yahi robot kone me rehta hai, beech-beech me idhar-udhar ghoomta/naachta hai,
   aur naya update ho to board leke batata hai (growth / de-growth agents & TLs, inactive, low cover,
   wapas aaye agents, girawat, scoreboard, naya data). Click → last 24h ki unique history; drag → jagah
   badlo. Gems se baat: history board → 🎙. Sound ON → bol kar. Settings per viewer (localStorage). */
(function (FF) {
  'use strict';
  if (!FF || typeof document === 'undefined' || FF.mascot) return;
  const U = FF.util || {};
  const esc = U.esc || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const fmt = (n) => (U.fmt ? U.fmt(Math.round(Number(n) || 0)) : String(Math.round(Number(n) || 0)));
  const IMG_V = 2;
  // absolute URL — robot pop-out (Picture-in-Picture) window me bhi images sahi load hon
  const ASSET = (f) => { try { return new URL(`./${f}?v=${IMG_V}`, location.href).href; } catch { return `./${f}?v=${IMG_V}`; } };

  // ---------------------------------------------------------------- per-viewer settings
  const LS = 'ff_mascot_v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
  const cfg = Object.assign({ on: true, sound: false, everySec: 10, idx: 0, seen: {}, snoozeDay: '' }, load());
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch { /* private mode */ } };
  const today = () => new Date().toISOString().slice(0, 10);
  // v3.125.122: robot ki chaal user ne khud maangi hai (aur ⚙ me band ho sakti hai) — OS ka reduced-motion ise nahi rokta
  const reduced = () => false;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);
  // pop-out window khuli ho to uske timer (site ka tab background me ho to Chrome uske timer dheeme kar deta hai)
  const tw = () => { try { return (pipWin && !pipWin.closed) ? pipWin : window; } catch { return window; } };
  const wait = (ms) => new Promise((r) => tw().setTimeout(r, ms));

  // ---------------------------------------------------------------- insights (data → board)
  const sq = (id, n) => { try { return FF.smartQ && FF.smartQ.answer ? FF.smartQ.answer(id, n) : null; } catch { return null; } };
  // 🗣 bolne ke liye naam: 'RAHUL SHARMA' → 'Rahul Sharma' (caps ko voice A-B-C ki tarah padhti thi)
  // ⟪…⟫ = naam (bolte waqt Hinglish→Hindi shabd-badal naam par na lage: 'OLD AGENT' 'एजेंट' na bane)
  const nm = (s) => `⟪${String(s || '').toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())}⟫`;
  const pct = (g) => (g == null ? '' : `${g > 0 ? '+' : ''}${fmt(g)}%`);

  const BUILDERS = [
    function highAgents() {
      const a = sq('high|all', 5); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'high', mood: 'happy', icon: '🚀', title: pick(['Rocket mode ON!', 'Aag laga di! 🔥', 'Growth ke sitare']),
        head: `${r.name} ne ${pct(r.growth)} growth di`, view: 'bars',
        rows: a.rows.map((x) => ({ name: x.name, sub: `${x.ch}${x.tl ? ' · TL ' + x.tl : ''} · ${fmt(x.cur)} tags`, val: pct(x.growth), w: Math.max(0, Number(x.growth) || 0), tone: 'up' })),
        say: `शाबाश! ${nm(r.name)} ने पिछले महीने से ${fmt(r.growth)} प्रतिशत ज़्यादा ग्रोथ दी है।${a.rows[1] ? ` उसके बाद ${nm(a.rows[1].name)}, फिर ${a.rows[2] ? nm(a.rows[2].name) : ''}।` : ''}`,
        q: 'high|all'
      };
    },
    function degrowthAgents() {
      const a = sq('degrowth|all', 5); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'degrowth', mood: 'sad', icon: '📉', title: pick(['Thoda dhyaan do', 'Girawat alert', 'In par nazar rakho']),
        head: `${r.name} ${fmt(Math.abs(r.growth || 0))}% neeche chal rahe hain`, view: 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: `last ${fmt(x.last)} → abhi ${fmt(x.cur)}${x.tl ? ' · TL ' + x.tl : ''}`, val: pct(x.growth), tone: 'down' })),
        say: `${nm(r.name)} की इशुअंस पिछले महीने से ${fmt(Math.abs(r.growth || 0))} प्रतिशत कम चल रही है। एक कॉल कर लो।`,
        q: 'degrowth|all'
      };
    },
    function highTls() {
      const a = sq('highgrowthtl|all', 5); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'hightl', mood: 'happy', icon: '👑', title: pick(['TL champions', 'Team ka jalwa']),
        head: `TL ${r.name} ki team ${pct(r.growth)} upar`, view: 'bars',
        rows: a.rows.map((x) => ({ name: x.name, sub: `${fmt(x.agents)} agents · ${fmt(x.cur)} tags`, val: pct(x.growth), w: Math.max(0, Number(x.growth) || 0), tone: 'up' })),
        say: `टी एल ${nm(r.name)} की टीम इस महीने ${fmt(r.growth)} प्रतिशत ऊपर है। ज़बरदस्त!`,
        q: 'highgrowthtl|all'
      };
    },
    function degrowthTls() {
      const a = sq('degrowthtl|all', 5); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'degrowthtl', mood: 'sad', icon: '🧭', title: pick(['TL team neeche', 'Team ko boost chahiye']),
        head: `TL ${r.name} ki team ${fmt(Math.abs(r.growth || 0))}% neeche`, view: 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: `${fmt(x.agents)} agents · last ${fmt(x.last)} → ${fmt(x.cur)}`, val: pct(x.growth), tone: 'down' })),
        say: `टी एल ${nm(r.name)} की टीम पिछले महीने से ${fmt(Math.abs(r.growth || 0))} प्रतिशत पीछे है।`,
        q: 'degrowthtl|all'
      };
    },
    function inactive() {
      const a = sq('inactive|all', 500); if (!a || !a.rows.length) return null;
      const n = a.rows.length;
      return {
        key: 'inactive', mood: 'sleepy', icon: '😴', title: pick(['Kaun so raha hai?', 'Neend se jagao']),
        head: 'agents ne is month ek bhi tag nahi kiya', view: 'big', big: fmt(n),
        rows: a.rows.slice(0, 5).map((x) => ({ name: x.name, sub: `last month ${fmt(x.last)}${x.stock ? ' · stock ' + fmt(x.stock) : ''}`, val: '0', tone: 'down' })),
        say: `${n} एजेंट्स ने इस महीने अभी तक एक भी टैग इशू नहीं किया। इनको जगाओ!`,
        q: 'inactive|all'
      };
    },
    function lowCover() {
      const a = sq('lowcover|all', 5); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'lowcover', mood: 'alert', icon: '⛽', title: pick(['Stock khatam hone wala!', 'Tanki khaali ho rahi hai']),
        head: `${r.name} ke paas ${fmt(r.cover)} din ka stock`, view: 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: `stock ${fmt(x.stock)} · roz ${fmt(x.rate)}`, val: `${(Number(x.cover) || 0).toFixed(1)}d`, tone: 'warn' })),
        say: `ध्यान दो! ${nm(r.name)} का स्टॉक सिर्फ़ ${Math.max(1, Math.round(r.cover || 0))} दिन का बचा है। डिस्पैच प्लान कर लो।`,
        q: 'lowcover|all'
      };
    },
    function newAgents() {
      const a = sq('newagents|all', 5); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'newagents', mood: 'happy', icon: '👋', title: pick(['Welcome back!', 'Naye khiladi']),
        head: `${r.name} wapas aaye — ${fmt(r.cur)} tags`, view: 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: `last month 0 · ${x.ch}`, val: fmt(x.cur), tone: 'up' })),
        say: `${nm(r.name)} पिछले महीने ज़ीरो थे, इस महीने ${fmt(r.cur)} टैग्स कर चुके हैं। वेलकम बैक!`,
        q: 'newagents|all'
      };
    },
    function drop() {
      const a = sq('biggestdrop|all', 5); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: 'drop', mood: 'alert', icon: '🧯', title: pick(['Sabse badi girawat', 'Yahan aag bujh rahi hai']),
        head: `${r.name}: ${fmt(r.last)} → ${fmt(r.cur)}`, view: 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: `last ${fmt(x.last)} → abhi ${fmt(x.cur)}`, val: `−${fmt(x.drop)}`, tone: 'down' })),
        say: `${nm(r.name)} पिछले महीने ${fmt(r.last)} पर थे, अभी तक सिर्फ़ ${fmt(r.cur)}।`,
        q: 'biggestdrop|all'
      };
    },
    function scoreboard() {
      const a = sq('summary|all'); if (!a || !a.rows.length) return null;
      const t = a.rows[0]; if (!t || !(t.cur || t.last)) return null;
      const d = new Date(), day = d.getDate(), days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const pace = day > 1 ? Math.round((t.cur / (day - 1 || 1)) * days) : 0;
      const prog = t.last ? Math.min(100, Math.round((t.cur / t.last) * 100)) : 100;
      return {
        key: 'summary', mood: pace >= t.last ? 'happy' : 'info', icon: '📊', title: pick(['Mahine ka scoreboard', 'Abhi tak ka hisaab']),
        head: `last month ${fmt(t.last)} ka ${prog}% ho gaya`, view: 'big', big: fmt(t.cur), prog,
        rows: [{ name: 'VC4', val: fmt(t.vc4) }, { name: 'VC20', val: fmt(t.vc20) }, { name: 'VC5+', val: fmt(t.vc5) }].map((x) => ({ ...x, sub: '', tone: 'chip' })),
        foot: pace ? `Isi speed se mahine ka andaaza ≈ ${fmt(pace)} ${pace >= t.last ? '🎯' : ''}` : '',
        say: `इस महीने अभी तक ${fmt(t.cur)} टैग्स, पिछले महीने का ${prog} प्रतिशत।${pace ? ` इसी स्पीड से लगभग ${fmt(pace)} तक जाएँगे।` : ''}`,
        q: 'summary|all'
      };
    }
  ];

  // ---------------------------------------------------------------- 📊 v3.125.125: issuance + stock + dispatch + KYC — sab kuch
  // ek generic builder: smartQ ka koi bhi sawaal → 5 naam ka board + Hindi awaaz
  const chTag = (x) => (x.ch ? String(x.ch).toUpperCase() : '');
  function mk(id, o) {
    return function () {
      const a = sq(id, 5); if (!a || !a.rows.length) return null;
      const r = a.rows[0];
      return {
        key: o.key, mood: o.mood || 'happy', icon: o.icon, title: pick(o.titles), head: o.head(r, a), view: o.bars ? 'bars' : 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: o.sub(x), val: o.val(x), w: o.bars ? Math.max(0, Number(o.w ? o.w(x) : 0) || 0) : 0, tone: o.tone || 'up' })),
        say: o.say(r, a), q: id
      };
    };
  }
  const tlS = (x) => `${chTag(x)}${x.tl ? ' · TL ' + x.tl : ''}`;
  BUILDERS.push(
    mk('top|all', { key: 'top', icon: '🏆', titles: ['Issuance ke badshah', 'Top 5 agents'], bars: true, w: (x) => x.cur,
      head: (r) => `${r.name} sabse aage — ${fmt(r.cur)} tags`, sub: (x) => `${tlS(x)} · last ${fmt(x.last)}`, val: (x) => fmt(x.cur),
      say: (r, a) => `इस महीने सबसे ज़्यादा इशुअंस ${nm(r.name)} की है, ${fmt(r.cur)} टैग्स। दूसरे नंबर पर ${nm((a.rows[1] || {}).name)}।` }),
    mk('vc4|all', { key: 'vc4', icon: '🚗', titles: ['VC4 ke king', 'Car wale champion'], bars: true, w: (x) => x.vc4,
      head: (r) => `${r.name} — ${fmt(r.vc4)} VC4`, sub: tlS, val: (x) => fmt(x.vc4),
      say: (r) => `वी सी 4 में सबसे आगे ${nm(r.name)}, ${fmt(r.vc4)} टैग्स।` }),
    mk('vc20|all', { key: 'vc20', icon: '🚐', titles: ['VC20 champions', 'VC20 me sabse aage'], bars: true, w: (x) => x.vc20,
      head: (r) => `${r.name} — ${fmt(r.vc20)} VC20`, sub: tlS, val: (x) => fmt(x.vc20),
      say: (r) => `वी सी 20 में ${nm(r.name)} सबसे आगे, ${fmt(r.vc20)} टैग्स।` }),
    mk('vc5|all', { key: 'vc5', icon: '🚛', titles: ['VC5+ commercial stars', 'Bade vehicle wale'], bars: true, w: (x) => x.vc5,
      head: (r) => `${r.name} — ${fmt(r.vc5)} VC5+`, sub: tlS, val: (x) => fmt(x.vc5),
      say: (r) => `कमर्शियल वी सी 5 प्लस में ${nm(r.name)} सबसे आगे, ${fmt(r.vc5)} टैग्स।` }),
    mk('stockhigh|all', { key: 'stockhigh', mood: 'info', icon: '📦', titles: ['Sabse zyada stock', 'Godaam full'], bars: true, w: (x) => x.stock, tone: 'chip',
      head: (r) => `${r.name} ke paas ${fmt(r.stock)} tag stock`, sub: (x) => `${tlS(x)} · is month ${fmt(x.cur)}`, val: (x) => fmt(x.stock),
      say: (r) => `सबसे ज़्यादा स्टॉक ${nm(r.name)} के पास है, ${fmt(r.stock)} टैग्स।` }),
    mk('deadstock|all', { key: 'deadstock', mood: 'sleepy', icon: '🪦', titles: ['Stock pada hai, issuance zero', 'Soya hua stock'], tone: 'warn',
      head: (r) => `${r.name}: ${fmt(r.stock)} stock, is month 0`, sub: (x) => `${tlS(x)} · last ${fmt(x.last)}`, val: (x) => fmt(x.stock),
      say: (r) => `${nm(r.name)} के पास ${fmt(r.stock)} टैग्स का स्टॉक पड़ा है, पर इस महीने एक भी इशू नहीं हुआ।` }),
    mk('dispatch|all', { key: 'dispatchneed', mood: 'alert', icon: '🚚', titles: ['Dispatch chahiye', 'Inko tag bhejo'], tone: 'warn',
      head: (r) => `${r.name} ko ~${fmt(r.need)} tag chahiye`, sub: (x) => `stock ${fmt(x.stock)} · is month ${fmt(x.cur)}`, val: (x) => fmt(x.need),
      say: (r) => `${nm(r.name)} को लगभग ${fmt(r.need)} टैग्स भेजने चाहिए।` }),
    mk('nostock|all', { key: 'nostock', mood: 'alert', icon: '🚫', titles: ['Issue kar rahe, stock zero!', 'Stock khatam'], tone: 'down',
      head: (r) => `${r.name} ne ${fmt(r.cur)} kiye, stock 0`, sub: tlS, val: (x) => fmt(x.cur),
      say: (r) => `${nm(r.name)} ने ${fmt(r.cur)} टैग्स इशू किए पर स्टॉक ज़ीरो है। जल्दी डिस्पैच करो।` }),
    mk('runrate|all', { key: 'runrate', icon: '⚡', titles: ['Sabse tez speed', 'Run-rate ke cheetah'], bars: true, w: (x) => x.rate,
      head: (r) => `${r.name} — roz ~${fmt(r.rate)} tags`, sub: tlS, val: (x) => `${fmt(x.rate)}/din`,
      say: (r) => `सबसे तेज़ रन रेट ${nm(r.name)} का है, रोज़ लगभग ${fmt(r.rate)} टैग्स।` }),
    mk('toptl|all', { key: 'toptl', icon: '🥇', titles: ['Top TL teams', 'TL leaderboard'], bars: true, w: (x) => x.cur,
      head: (r) => `TL ${r.name} — ${fmt(r.cur)} tags`, sub: (x) => `${fmt(x.agents)} agents · last ${fmt(x.last)}`, val: (x) => fmt(x.cur),
      say: (r) => `टी एल में सबसे आगे ${nm(r.name)} की टीम, ${fmt(r.cur)} टैग्स।` }),
    mk('stocktl|all', { key: 'stocktl', mood: 'info', icon: '🏬', titles: ['TL ka stock', 'Kis TL ke paas kitna maal'], bars: true, w: (x) => x.stock, tone: 'chip',
      head: (r) => `TL ${r.name} ki team ke paas ${fmt(r.stock)} stock`, sub: (x) => `${fmt(x.agents)} agents · is month ${fmt(x.cur)}`, val: (x) => fmt(x.stock),
      say: (r) => `सबसे ज़्यादा स्टॉक टी एल ${nm(r.name)} की टीम के पास, ${fmt(r.stock)} टैग्स।` }),
    mk('dispatchtl|all', { key: 'dispatchtl', mood: 'alert', icon: '📮', titles: ['TL ko dispatch', 'Team ko maal chahiye'], tone: 'warn',
      head: (r) => `TL ${r.name} ki team ko ~${fmt(r.need)} tag`, sub: (x) => `stock ${fmt(x.stock)} · is month ${fmt(x.cur)}`, val: (x) => fmt(x.need),
      say: (r) => `टी एल ${nm(r.name)} की टीम को लगभग ${fmt(r.need)} टैग्स चाहिए।` }),
    mk('inactagentstl|all', { key: 'inacttl', mood: 'sleepy', icon: '💤', titles: ['TL ke soye agents', 'Team me neend'], tone: 'down',
      head: (r) => `TL ${r.name}: ${fmt(r.inact)} agents inactive`, sub: (x) => `${fmt(x.active)} active / ${fmt(x.agents)}`, val: (x) => fmt(x.inact),
      say: (r) => `टी एल ${nm(r.name)} के ${fmt(r.inact)} एजेंट्स इस महीने इनएक्टिव हैं।` }),
    mk('vc4tl|all', { key: 'vc4tl', icon: '🚙', titles: ['VC4 TL champions'], bars: true, w: (x) => x.vc4,
      head: (r) => `TL ${r.name} — ${fmt(r.vc4)} VC4`, sub: (x) => `${fmt(x.agents)} agents`, val: (x) => fmt(x.vc4),
      say: (r) => `वी सी 4 में टी एल ${nm(r.name)} की टीम सबसे आगे, ${fmt(r.vc4)}।` }),
    function lowIssue() { // stock hai par issuance bahut kam
      const a = sq('top|all', 100000); if (!a || !a.rows.length) return null;
      const rows = a.rows.filter((x) => x.stock >= 20 && x.cur > 0).sort((x, y) => x.cur / x.stock - y.cur / y.stock).slice(0, 5);
      if (!rows.length) return null;
      const r = rows[0];
      return { key: 'lowissue', mood: 'sad', icon: '🐢', title: pick(['Low issuance', 'Stock hai, speed kam']), head: `${r.name}: stock ${fmt(r.stock)}, issue sirf ${fmt(r.cur)}`, view: 'list',
        rows: rows.map((x) => ({ name: x.name, sub: `stock ${fmt(x.stock)} · ${tlS(x)}`, val: fmt(x.cur), tone: 'down' })),
        say: `${nm(r.name)} के पास ${fmt(r.stock)} टैग्स का स्टॉक है, पर इस महीने सिर्फ़ ${fmt(r.cur)} इशू हुए।`, q: 'top|all' };
    },
    function siteTotal() { // poori site ka hisaab
      const t = sq('summary|all'), act = sq('top|all', 100000), st = sq('stockhigh|all', 100000), ina = sq('inactive|all', 100000), dn = sq('dispatch|all', 100000);
      if (!t || !t.rows.length) return null;
      const s0 = t.rows[0], stock = st ? st.rows.reduce((m, x) => m + (Number(x.stock) || 0), 0) : 0, need = dn ? dn.rows.reduce((m, x) => m + (Number(x.need) || 0), 0) : 0;
      const nAct = act ? act.rows.length : 0, nIna = ina ? ina.rows.length : 0;
      return { key: 'sitetotal', mood: 'excited', icon: '🧾', title: 'Poori site ka hisaab', head: `is month ab tak issuance · last month ${fmt(s0.last)}`, view: 'big', big: fmt(s0.cur),
        rows: [{ name: '📦 Stock', val: fmt(stock) }, { name: '🟢 Active', val: fmt(nAct) }, { name: '😴 Inactive', val: fmt(nIna) }, { name: '🚚 Dispatch need', val: fmt(need) }, { name: 'VC4', val: fmt(s0.vc4) }, { name: 'VC20', val: fmt(s0.vc20) }, { name: 'VC5+', val: fmt(s0.vc5) }].map((x) => ({ ...x, sub: '', tone: 'chip' })),
        say: `पूरी साइट का हिसाब: इस महीने अभी तक ${fmt(s0.cur)} टैग्स। स्टॉक ${fmt(stock)}। ${fmt(nAct)} एजेंट्स एक्टिव, ${fmt(nIna)} इनएक्टिव।`, q: 'summary|all' };
    },
    function kycLow() { // issuance zyada, KYC ratio kam
      if (!kycCache.rows || !kycCache.rows.length) return null;
      const rows = kycCache.rows.slice(0, 5), r = rows[0];
      return { key: 'kyclow', mood: 'alert', icon: '🪪', title: pick(['Issuance zyada, KYC kam', 'KYC par dhyaan do']), head: `${r.name}: ${fmt(r.n)} tags, full KYC sirf ${r.pct}%`, view: 'list',
        rows: rows.map((x) => ({ name: x.name, sub: `${x.ch.toUpperCase()} · ${fmt(x.full)}/${fmt(x.n)} full KYC`, val: `${x.pct}%`, tone: 'down' })),
        say: `${nm(r.name)} ने इस महीने ${fmt(r.n)} टैग्स किए, पर फ़ुल के वाई सी सिर्फ़ ${r.pct} प्रतिशत है।`, q: '' };
    },
    function lastDispatch() { // 🚚 tag dispatch (ledger) — aakhri din
      const d = dispCache.data; if (!d || !d.latest) return null;
      const dt = new Date(`${d.latest}T00:00:00`), lbl = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const cls = Object.entries(d.latestCls || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => ({ name: c, val: fmt(n), sub: '', tone: 'chip' }));
      return { key: `dispatch:${d.latest}`, mood: 'excited', icon: '🚚', title: `Tag dispatch · ${lbl}`, head: `${d.agentCount} agents ko gaye · FF ${fmt(d.latestFf)} · GV ${fmt(d.latestGv)}`, view: 'big', big: fmt(d.latestTotal),
        rows: cls.concat((d.agents || []).slice(0, 5).map((x) => ({ name: `${x.name}`, val: fmt(x.qty), sub: '', tone: 'up' }))),
        foot: (d.days || []).slice(1, 4).map((x) => `${new Date(`${x.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${fmt(x.total)}`).join(' · '),
        say: `${lbl} को ${fmt(d.latestTotal)} टैग्स डिस्पैच हुए, ${d.agentCount} एजेंट्स को। सबसे ज़्यादा ${nm(((d.agents || [])[0] || {}).name)} को।`, q: '' };
    }
  );
  // ---------------------------------------------------------------- 📈 v3.125.130: mahine ka run-rate, andaaza, best din, champions (FF + GV)
  const MSHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let msCache = { at: 0, v: null };
  function monthStats() {
    if (msCache.v && Date.now() - msCache.at < 5 * 60e3) return msCache.v;
    if (!U.reportYm) return null;
    const cur = U.reportYm(), prev = U.prevMonthKey ? U.prevMonthKey(cur) : '';
    let ff = []; let gv = [];
    try { ff = (FF.store && FF.store.get && FF.store.get('daily')) || []; if (FF.filters && FF.filters.dropLaggedFf) ff = FF.filters.dropLaggedFf(ff); ff = ff.filter((r) => r.channel !== 'GV Partner'); } catch { ff = []; }
    try { gv = (FF.gv && FF.gv.issuanceRows ? FF.gv.issuanceRows() : []) || []; } catch { gv = []; }
    if (!ff.length && !gv.length) return null;
    const blank = () => ({ total: 0, vc4: 0, vc20: 0, vc5: 0, rep: 0, days: new Map(), agents: new Map(), prevTotal: 0, prevSame: 0, lastDay: 0 });
    const out = { ff: blank(), gv: blank(), all: blank(), cur, prev };
    const add = (ch, r) => {
      const q = Number(r.n) || 0; if (!q) return;
      const cls = r.group === 'VC4' ? 'vc4' : r.group === 'VC20' ? 'vc20' : 'vc5';
      for (const o of [out[ch], out.all]) {
        if (r.ym === cur) {
          o.total += q; o[cls] += q;
          if (String(r.type || '').toUpperCase() === 'REPLACEMENT') o.rep += q;
          const d = o.days.get(r.day) || { total: 0, vc4: 0, vc20: 0, vc5: 0 }; d.total += q; d[cls] += q; o.days.set(r.day, d);
          if (r.day > o.lastDay) o.lastDay = r.day;
          const name = r.agentName || r.agentId || '?', a = o.agents.get(`${ch}|${name}`) || { name, ch, total: 0, vc4: 0, vc20: 0, vc5: 0, rep: 0 };
          a.total += q; a[cls] += q; if (String(r.type || '').toUpperCase() === 'REPLACEMENT') a.rep += q; o.agents.set(`${ch}|${name}`, a);
        } else if (r.ym === prev) { o.prevTotal += q; o.__prevDays = o.__prevDays || []; o.__prevDays.push([r.day, q]); }
      }
    };
    ff.forEach((r) => add('ff', r)); gv.forEach((r) => add('gv', r));
    const dim = U.daysInMonth ? U.daysInMonth(cur) : 30;
    for (const k of ['ff', 'gv', 'all']) {
      const o = out[k], days = Math.max(1, o.lastDay);
      o.prevSame = (o.__prevDays || []).filter(([d]) => d <= o.lastDay).reduce((m, [, q]) => m + q, 0);
      o.rate = { total: o.total / days, vc4: o.vc4 / days, vc20: o.vc20 / days, vc5: o.vc5 / days };
      o.exp = { total: Math.round(o.rate.total * dim), vc4: Math.round(o.rate.vc4 * dim), vc20: Math.round(o.rate.vc20 * dim), vc5: Math.round(o.rate.vc5 * dim) };
      o.dim = dim;
    }
    msCache = { at: Date.now(), v: out };
    return out;
  }
  const dLabel = (ym, d) => `${d} ${MSHORT[Number(String(ym).slice(5, 7)) - 1] || ''}`;
  const r1 = (x) => (x >= 10 ? fmt(x) : (Math.round(x * 10) / 10).toString());
  const chName = (k) => (k === 'ff' ? 'First Forward' : 'GV Partner');
  const chSay = (k) => (k === 'ff' ? 'फ़र्स्ट फ़ॉरवर्ड' : 'जी वी पार्टनर');
  BUILDERS.push(
    function runRateNow() {
      const m = monthStats(); if (!m || !m.all.total) return null;
      const a = m.all;
      return { key: 'rr', mood: 'info', icon: '⚡', title: 'Abhi ka run-rate', view: 'big', big: `${r1(a.rate.total)}/din`, head: `${a.lastDay} din me ${fmt(a.total)} tags`,
        rows: [{ name: 'VC4', val: `${r1(a.rate.vc4)}/din` }, { name: 'VC20', val: `${r1(a.rate.vc20)}/din` }, { name: 'VC5+', val: `${r1(a.rate.vc5)}/din` }, { name: 'First Forward', val: `${r1(m.ff.rate.total)}/din` }, { name: 'GV Partner', val: `${r1(m.gv.rate.total)}/din` }].map((x) => ({ ...x, sub: '', tone: 'chip' })),
        foot: `Isi speed se mahine ka andaaza ≈ ${fmt(a.exp.total)}`,
        say: `अभी हमारा रन रेट रोज़ लगभग ${fmt(a.rate.total)} टैग्स का है। इसमें वी सी 4 रोज़ ${r1(a.rate.vc4)}, वी सी 20 रोज़ ${r1(a.rate.vc20)}, और वी सी 5 प्लस रोज़ ${r1(a.rate.vc5)}। फ़र्स्ट फ़ॉरवर्ड रोज़ ${fmt(m.ff.rate.total)} और जी वी पार्टनर रोज़ ${fmt(m.gv.rate.total)} कर रहे हैं।`, q: 'runrate|all' };
    },
    function expected() {
      const m = monthStats(); if (!m || !m.all.total) return null;
      const a = m.all, g = a.prevTotal ? Math.round(((a.exp.total - a.prevTotal) / a.prevTotal) * 100) : null;
      const sp = a.prevSame ? Math.round(((a.total - a.prevSame) / a.prevSame) * 100) : null;
      return { key: 'exp', mood: g != null && g < 0 ? 'alert' : 'excited', icon: '🎯', title: 'Is mahine ka andaaza', view: 'big', big: fmt(a.exp.total), head: `last month ${fmt(a.prevTotal)}${g != null ? ` · ${pct(g)}` : ''}`,
        rows: [{ name: 'VC4', val: fmt(a.exp.vc4) }, { name: 'VC20', val: fmt(a.exp.vc20) }, { name: 'VC5+', val: fmt(a.exp.vc5) }, { name: 'First Forward', val: fmt(m.ff.exp.total) }, { name: 'GV Partner', val: fmt(m.gv.exp.total) }].map((x) => ({ ...x, sub: '', tone: 'chip' })),
        prog: a.exp.total ? Math.min(100, Math.round((a.total / a.exp.total) * 100)) : 0,
        foot: sp != null ? `Pichle mahine ke isi din (${a.lastDay}) tak ${fmt(a.prevSame)} the — abhi ${fmt(a.total)} (${pct(sp)})` : '',
        say: `इसी स्पीड से चले तो इस महीने लगभग ${fmt(a.exp.total)} टैग्स होंगे${g != null ? `, जो पिछले महीने से ${Math.abs(g)} प्रतिशत ${g >= 0 ? 'ज़्यादा' : 'कम'} है` : ''}। वी सी 4 लगभग ${fmt(a.exp.vc4)}, वी सी 20 लगभग ${fmt(a.exp.vc20)}, और वी सी 5 प्लस लगभग ${fmt(a.exp.vc5)}।${sp != null ? ` पिछले महीने इसी दिन तक ${fmt(a.prevSame)} थे, अभी ${fmt(a.total)} हैं।` : ''}`, q: 'summary|all' };
    },
    function bestDays() {
      const m = monthStats(); if (!m || !m.all.days.size) return null;
      const top = [...m.all.days.entries()].sort((x, y) => y[1].total - x[1].total).slice(0, 5);
      const [d0, v0] = top[0];
      return { key: 'bestday', mood: 'happy', icon: '📅', title: 'Is mahine ke best din', head: `${dLabel(m.cur, d0)} ko sabse zyada — ${fmt(v0.total)} tags`, view: 'bars',
        rows: top.map(([d, v]) => ({ name: dLabel(m.cur, d), sub: `VC4 ${fmt(v.vc4)} · VC20 ${fmt(v.vc20)} · VC5+ ${fmt(v.vc5)}`, val: fmt(v.total), w: v.total, tone: 'up' })),
        say: `इस महीने सबसे ज़्यादा इशुअंस ${d0} ${MON_HI[Number(m.cur.slice(5, 7)) - 1]} को हुई, पूरे ${fmt(v0.total)} टैग्स।${top[1] ? ` दूसरे नंबर पर ${top[1][0]} तारीख़, ${fmt(top[1][1].total)} टैग्स।` : ''}`, q: '' };
    },
    function lastDayIssue() {
      const m = monthStats(); if (!m || !m.all.lastDay) return null;
      const d = m.all.lastDay, v = m.all.days.get(d) || { total: 0, vc4: 0, vc20: 0, vc5: 0 };
      const ff = (m.ff.days.get(d) || { total: 0 }).total, gv = (m.gv.days.get(d) || { total: 0 }).total;
      const avg = m.all.rate.total, diff = avg ? Math.round(((v.total - avg) / avg) * 100) : 0;
      return { key: `lastday:${d}:${v.total}`, mood: diff >= 0 ? 'happy' : 'sad', icon: '🗓', title: `${dLabel(m.cur, d)} ki issuance`, view: 'big', big: fmt(v.total), head: `average se ${pct(diff)} · FF ${fmt(ff)} · GV ${fmt(gv)}`,
        rows: [{ name: 'VC4', val: fmt(v.vc4) }, { name: 'VC20', val: fmt(v.vc20) }, { name: 'VC5+', val: fmt(v.vc5) }].map((x) => ({ ...x, sub: '', tone: 'chip' })),
        say: `${d} ${MON_HI[Number(m.cur.slice(5, 7)) - 1]} को कुल ${fmt(v.total)} टैग्स इशू हुए — फ़र्स्ट फ़ॉरवर्ड ${fmt(ff)} और जी वी ${fmt(gv)}। ये रोज़ के एवरेज से ${Math.abs(diff)} प्रतिशत ${diff >= 0 ? 'ज़्यादा' : 'कम'} है।`, q: '' };
    },
    ...['ff', 'gv'].map((ch) => function champions() {
      const m = monthStats(); if (!m || !m[ch].agents.size) return null;
      const ag = [...m[ch].agents.values()];
      const best = (k) => ag.slice().sort((x, y) => y[k] - x[k])[0];
      const t = best('total'), a4 = best('vc4'), a20 = best('vc20'), a5 = best('vc5'), rp = best('rep');
      const rows = [
        { name: `🏆 ${t.name}`, sub: 'Sabse zyada total', val: fmt(t.total), n: t.total },
        { name: `🚗 ${a4.name}`, sub: 'VC4 king', val: fmt(a4.vc4), n: a4.vc4 },
        { name: `🚐 ${a20.name}`, sub: 'VC20 king', val: fmt(a20.vc20), n: a20.vc20 },
        { name: `🚛 ${a5.name}`, sub: 'VC5+ king', val: fmt(a5.vc5), n: a5.vc5 }
      ].filter((x) => x.n > 0);
      const parts = [a4.vc4 ? `वी सी 4 में ${nm(a4.name)}` : '', a20.vc20 ? `वी सी 20 में ${nm(a20.name)}` : '', a5.vc5 ? `वी सी 5 प्लस में ${nm(a5.name)}` : ''].filter(Boolean);
      if (rp && rp.rep) rows.push({ name: `🔁 ${rp.name}`, sub: 'Sabse zyada replacement', val: fmt(rp.rep) });
      return { key: `champ:${ch}`, mood: 'excited', icon: ch === 'ff' ? '🥇' : '🏅', title: `${chName(ch)} champions`, head: `Is mahine ${fmt(m[ch].total)} tags · ${m[ch].agents.size} agents`, view: 'list',
        rows: rows.map((x) => ({ ...x, tone: 'up' })),
        say: `${chSay(ch)} के चैंपियंस! सबसे ज़्यादा टैग्स ${nm(t.name)} के, ${fmt(t.total)}।${parts.length ? ` ${parts.join(', ')} सबसे आगे हैं।` : ''}`, q: 'top|all' };
    }),
    function ffVsGv() {
      const m = monthStats(); if (!m || !m.all.total) return null;
      const share = Math.round((m.ff.total / m.all.total) * 100);
      const lead = m.ff.total >= m.gv.total ? 'ff' : 'gv';
      return { key: 'ffvsgv', mood: 'excited', icon: '⚔️', title: 'First Forward vs GV Partner', head: `${chName(lead)} aage · FF ${share}% / GV ${100 - share}%`, view: 'list',
        rows: [['Total', 'total'], ['VC4', 'vc4'], ['VC20', 'vc20'], ['VC5+', 'vc5']].map(([n, k]) => ({ name: n, sub: `FF ${fmt(m.ff[k])}  vs  GV ${fmt(m.gv[k])}`, val: m.ff[k] >= m.gv[k] ? 'FF 🏆' : 'GV 🏆', tone: 'chip' }))
          .concat([{ name: 'Run-rate', sub: `FF ${r1(m.ff.rate.total)}/din vs GV ${r1(m.gv.rate.total)}/din`, val: m.ff.rate.total >= m.gv.rate.total ? 'FF 🏆' : 'GV 🏆', tone: 'chip' }]),
        say: `मुक़ाबला! इस महीने फ़र्स्ट फ़ॉरवर्ड के ${fmt(m.ff.total)} टैग्स और जी वी पार्टनर के ${fmt(m.gv.total)}। अभी ${chSay(lead)} आगे है।`, q: '' };
    },
    function topTodayAgents() {
      const m = monthStats(); if (!m || !m.all.lastDay) return null;
      // aakhri din ke top agents — daily rows se dobara (day-level agent map nahi rakha)
      const d = m.all.lastDay, map = new Map();
      const scan = (rows, ch) => rows.forEach((r) => { if (r.ym === m.cur && r.day === d) { const k = `${ch}|${r.agentName || r.agentId}`; const o = map.get(k) || { name: r.agentName || r.agentId, ch, n: 0 }; o.n += Number(r.n) || 0; map.set(k, o); } });
      try { let ff = FF.store.get('daily') || []; if (FF.filters && FF.filters.dropLaggedFf) ff = FF.filters.dropLaggedFf(ff); scan(ff.filter((r) => r.channel !== 'GV Partner'), 'ff'); } catch { /* ignore */ }
      try { scan(FF.gv.issuanceRows() || [], 'gv'); } catch { /* ignore */ }
      const top = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 5); if (!top.length) return null;
      return { key: `daystar:${d}:${top[0].name}`, mood: 'happy', icon: '🌟', title: `${dLabel(m.cur, d)} ke star agents`, head: `${top[0].name} ne us din ${fmt(top[0].n)} tags kiye`, view: 'bars',
        rows: top.map((x) => ({ name: x.name, sub: x.ch === 'ff' ? 'First Forward' : 'GV Partner', val: fmt(x.n), w: x.n, tone: 'up' })),
        say: `${d} ${MON_HI[Number(m.cur.slice(5, 7)) - 1]} के स्टार एजेंट ${nm(top[0].name)} रहे, ${fmt(top[0].n)} टैग्स के साथ।${top[1] ? ` उनके बाद ${nm(top[1].name)}।` : ''}`, q: '' };
    }
  );

  // ---------------------------------------------------------------- 🆕 v3.125.131: record, pehla tag, stock khatam kab, dispatch ka asar, KYC sudhra/bigda, replacement, quiz, shabaashi
  const NK = (x) => String(x || '').trim().toUpperCase();
  const isoOf = (ym, d) => `${ym}-${String(d).padStart(2, '0')}`;
  const dLbl = (iso) => { const [, mo, d] = String(iso).split('-'); return `${Number(d)} ${MSHORT[Number(mo) - 1] || ''}`; };
  const dSay = (iso) => { const [, mo, d] = String(iso).split('-'); return `${Number(d)} ${MON_HI[Number(mo) - 1] || ''}`; };
  let serCache = { at: 0, v: null };
  function series() { // agent → { din → tags } (FF + GV, saare mahine jo load hain)
    if (serCache.v && Date.now() - serCache.at < 5 * 60e3) return serCache.v;
    const ag = new Map(), site = new Map();
    const scan = (rows, ch) => rows.forEach((r) => {
      if (!r.ym || !r.day) return;
      const iso = isoOf(r.ym, r.day), q = Number(r.n) || 0; if (!q) return;
      const name = r.agentName || r.agentId; if (!name) return;
      const k = `${ch}|${NK(name)}`;
      let o = ag.get(k); if (!o) { o = { name, ch, days: new Map(), rep: 0 }; ag.set(k, o); }
      o.days.set(iso, (o.days.get(iso) || 0) + q);
      site.set(iso, (site.get(iso) || 0) + q);
    });
    try { let ff = FF.store.get('daily') || []; if (FF.filters && FF.filters.dropLaggedFf) ff = FF.filters.dropLaggedFf(ff); scan(ff.filter((r) => r.channel !== 'GV Partner'), 'ff'); } catch { /* ignore */ }
    try { scan(FF.gv.issuanceRows() || [], 'gv'); } catch { /* ignore */ }
    if (!ag.size) return null;
    const last = [...site.keys()].sort().pop();
    serCache = { at: Date.now(), v: { ag, site, last } };
    return serCache.v;
  }
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  BUILDERS.push(
    function records() { // 🏅 apna sabse best din (aakhri din)
      const S = series(); if (!S) return null;
      const out = [];
      for (const o of S.ag.values()) {
        const v = o.days.get(S.last) || 0; if (v < 10) continue;
        let best = 0; for (const [d, n] of o.days) if (d !== S.last && n > best) best = n;
        if (best && v > best) out.push({ name: o.name, ch: o.ch, v, best });
      }
      const sv = S.site.get(S.last) || 0; let sb = 0; for (const [d, n] of S.site) if (d !== S.last && n > sb) sb = n;
      out.sort((a, b) => b.v - a.v);
      if (!out.length && !(sv > sb && sb)) return null;
      const rows = out.slice(0, 5).map((x) => ({ name: x.name, sub: `${x.ch === 'ff' ? 'FF' : 'GV'} · pichla best ${fmt(x.best)}`, val: fmt(x.v), tone: 'up' }));
      if (sv > sb && sb) rows.unshift({ name: '🌐 Poori site', sub: `pichla best din ${fmt(sb)}`, val: fmt(sv), tone: 'up' });
      const r = out[0];
      return { key: `record:${S.last}`, mood: 'excited', cls: 'greet', icon: '🏅', title: 'Record toda!', head: `${dLbl(S.last)} ko apna sabse best din`, view: 'list', rows: rows.slice(0, 5),
        say: `${dSay(S.last)} को रिकॉर्ड टूटा!${sv > sb && sb ? ` पूरी साइट का अब तक का सबसे अच्छा दिन, ${fmt(sv)} टैग्स।` : ''}${r ? ` ${nm(r.name)} ने ${fmt(r.v)} टैग्स किए, उनका पिछला बेस्ट ${fmt(r.best)} था।` : ''} शाबाश!`, q: 'top|all' };
    },
    function firstTag() { // 🎈 naye agent ka pehla tag
      const S = series(); if (!S) return null;
      const out = [];
      for (const o of S.ag.values()) {
        const ds = [...o.days.keys()].sort(); const f = ds[0];
        if (f && daysBetween(f, S.last) <= 3 && daysBetween([...S.site.keys()].sort()[0], f) > 20) out.push({ name: o.name, ch: o.ch, f, n: [...o.days.values()].reduce((a, b) => a + b, 0) });
      }
      if (!out.length) return null;
      out.sort((a, b) => b.n - a.n);
      const r = out[0];
      return { key: `first:${out.map((x) => x.name).join(',')}`, mood: 'happy', cls: 'greet', icon: '🎈', title: 'Naye agent ka pehla tag!', head: `${r.name} ne ${dLbl(r.f)} ko shuruaat ki`, view: 'list',
        rows: out.slice(0, 5).map((x) => ({ name: x.name, sub: `${x.ch === 'ff' ? 'First Forward' : 'GV Partner'} · pehla tag ${dLbl(x.f)}`, val: fmt(x.n), tone: 'up' })),
        say: `स्वागत है! ${nm(r.name)} ने ${dSay(r.f)} को अपना पहला टैग किया, अब तक ${fmt(r.n)} टैग्स।${out[1] ? ` और ${out.length - 1} नए एजेंट भी शुरू हुए हैं।` : ''}`, q: '' };
    },
    function stockEnd() { // ⏳ stock kab khatam hoga — tareekh
      const a = sq('lowcover|all', 5); if (!a || !a.rows.length) return null;
      const end = (x) => { const d = new Date(Date.now() + Math.max(0, Number(x.cover) || 0) * 864e5); return d.toISOString().slice(0, 10); };
      const r = a.rows[0];
      return { key: 'stockend', mood: 'alert', icon: '⏳', title: 'Stock kab khatam hoga', head: `${r.name} ka stock ~${dLbl(end(r))} tak`, view: 'list',
        rows: a.rows.map((x) => ({ name: x.name, sub: `stock ${fmt(x.stock)} · roz ${r1(Number(x.rate) || 0)}`, val: dLbl(end(x)), tone: 'warn' })),
        say: `ध्यान दो! ${nm(r.name)} का स्टॉक लगभग ${dSay(end(r))} तक ख़त्म हो जाएगा।${a.rows[1] ? ` ${nm(a.rows[1].name)} का ${dSay(end(a.rows[1]))} तक।` : ''} डिस्पैच प्लान कर लो।`, q: 'lowcover|all' };
    },
    function dispatchEffect() { // 🚚→📈 dispatch ke baad asar
      const S = series(), d = dispCache.data; if (!S || !d || !Array.isArray(d.recent)) return null;
      const rate = (o, from, to) => { let n = 0; for (const [k, v] of o.days) if (k >= from && k < to) n += v; return n / Math.max(1, daysBetween(from, to)); };
      const add = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
      const out = [];
      for (const x of d.recent) {
        if (x.qty < 20 || daysBetween(x.date, S.last) < 3) continue;
        const o = S.ag.get(`${x.ch}|${NK(x.name)}`); if (!o) continue;
        const before = rate(o, add(x.date, -7), x.date), after = rate(o, add(x.date, 1), add(S.last, 1));
        out.push({ ...x, before, after, gain: after - before });
      }
      if (out.length < 2) return null;
      const good = out.slice().sort((a, b) => b.gain - a.gain).slice(0, 3), idle = out.filter((x) => x.after < 0.5).sort((a, b) => b.qty - a.qty).slice(0, 2);
      const rows = good.map((x) => ({ name: x.name, sub: `${dLbl(x.date)} ko ${fmt(x.qty)} tag → roz ${r1(x.before)} se ${r1(x.after)}`, val: x.gain >= 0 ? '📈' : '📉', tone: x.gain >= 0 ? 'up' : 'down' }))
        .concat(idle.map((x) => ({ name: x.name, sub: `${dLbl(x.date)} ko ${fmt(x.qty)} tag mile — issuance nahi`, val: '😴', tone: 'down' })));
      const g = good[0];
      return { key: `dispfx:${S.last}`, mood: 'info', icon: '🚚', title: 'Dispatch ke baad asar', head: `${g.name}: roz ${r1(g.before)} → ${r1(g.after)}`, view: 'list', rows,
        say: `डिस्पैच का असर: ${nm(g.name)} को ${dSay(g.date)} को ${fmt(g.qty)} टैग्स मिले, उसके बाद रोज़ ${r1(g.before)} से बढ़कर ${r1(g.after)} हो गए।${idle[0] ? ` पर ${nm(idle[0].name)} को ${fmt(idle[0].qty)} टैग्स मिले और अभी तक इशू नहीं हुए।` : ''}`, q: '' };
    },
    function kycBetter() {
      const c = (kycCache.cmp || []).filter((x) => x.d >= 10).sort((a, b) => b.d - a.d); if (!c.length) return null;
      const r = c[0];
      return { key: 'kycup', mood: 'happy', icon: '📗', title: 'KYC sudhra 👍', head: `${r.name}: ${r.prev}% → ${r.pct}%`, view: 'list',
        rows: c.slice(0, 5).map((x) => ({ name: x.name, sub: `${x.ch.toUpperCase()} · last month ${x.prev}% → abhi ${x.pct}%`, val: `+${x.d}%`, tone: 'up' })),
        say: `के वाई सी में सुधार! ${nm(r.name)} का फ़ुल के वाई सी पिछले महीने ${r.prev} प्रतिशत था, अब ${r.pct} प्रतिशत है।`, q: '' };
    },
    function kycWorse() {
      const c = (kycCache.cmp || []).filter((x) => x.d <= -10).sort((a, b) => a.d - b.d); if (!c.length) return null;
      const r = c[0];
      return { key: 'kycdown', mood: 'sad', icon: '📕', title: 'KYC bigda 👎', head: `${r.name}: ${r.prev}% → ${r.pct}%`, view: 'list',
        rows: c.slice(0, 5).map((x) => ({ name: x.name, sub: `${x.ch.toUpperCase()} · last month ${x.prev}% → abhi ${x.pct}%`, val: `${x.d}%`, tone: 'down' })),
        say: `ध्यान दो, ${nm(r.name)} का फ़ुल के वाई सी पिछले महीने ${r.prev} प्रतिशत था, अब गिरकर ${r.pct} प्रतिशत रह गया है।`, q: '' };
    },
    function replacementHigh() {
      const m = monthStats(); if (!m || !m.all.total) return null;
      const avg = m.all.rep / m.all.total;
      const ag = [...m.all.agents.values()].filter((a) => a.rep >= 5 && a.total >= 10 && a.rep / a.total > Math.max(0.15, avg * 2)).sort((a, b) => b.rep - a.rep);
      if (!ag.length) return null;
      const r = ag[0];
      return { key: 'rephigh', mood: 'alert', icon: '🔁', title: 'Replacement zyada', head: `${r.name}: ${fmt(r.rep)} replacement (${Math.round((r.rep / r.total) * 100)}%)`, view: 'list',
        rows: ag.slice(0, 5).map((x) => ({ name: x.name, sub: `${x.ch === 'ff' ? 'FF' : 'GV'} · ${fmt(x.total)} me se · site avg ${Math.round(avg * 100)}%`, val: `${Math.round((x.rep / x.total) * 100)}%`, tone: 'warn' })),
        say: `${nm(r.name)} के ${fmt(r.total)} टैग्स में से ${fmt(r.rep)} रिप्लेसमेंट हैं, जो साइट के एवरेज से बहुत ज़्यादा है। एक बार चेक कर लो।`, q: '' };
    },
    function shabaashi() { // 👏 taaliyan
      const S = series(); if (!S) return null;
      let best = null; for (const o of S.ag.values()) { const v = o.days.get(S.last) || 0; if (!best || v > best.v) best = { name: o.name, ch: o.ch, v }; }
      if (!best || best.v < 5) return null;
      return { key: `clap:${S.last}:${best.name}`, mood: 'excited', fx: 'clap', cls: 'mc-wave', icon: '👏', title: `Shabaash ${best.name}!`, head: `${dLbl(S.last)} ko ${fmt(best.v)} tags — sabse aage! Taaliyan 👏👏👏`, view: 'text',
        say: `शाबाश ${nm(best.name)}! ${dSay(S.last)} को ${fmt(best.v)} टैग्स, सबसे आगे! ज़ोरदार तालियाँ!`, q: '' };
    },
    function quiz() { // ❓ quiz — 5 sec sochne do, phir jawab
      const m = monthStats(); if (!m || m.all.agents.size < 3) return null;
      const ag = [...m.all.agents.values()];
      const qs = [];
      const topBy = (k, list) => list.slice().sort((a, b) => b[k] - a[k]);
      [['vc4', 'VC4', 'वी सी 4'], ['vc20', 'VC20', 'वी सी 20'], ['vc5', 'VC5+', 'वी सी 5 प्लस'], ['total', 'total issuance', 'कुल इशुअंस']].forEach(([k, l, h]) => {
        const t = topBy(k, ag); if (!t[0] || !t[0][k]) return;
        qs.push({ q: `Is mahine ${l} me sabse aage kaun?`, qs: `इस महीने ${h} में सबसे आगे कौन है?`, a: t[0].name, val: fmt(t[0][k]), wrong: t.slice(1, 6).map((x) => x.name) });
      });
      ['ff', 'gv'].forEach((ch) => { const t = topBy('total', [...m[ch].agents.values()]); if (t[0] && t.length > 2) qs.push({ q: `${chName(ch)} ka champion kaun?`, qs: `${chSay(ch)} का चैंपियन कौन है?`, a: t[0].name, val: fmt(t[0].total), wrong: t.slice(1, 6).map((x) => x.name) }); });
      if (m.all.days.size > 2) { const td = [...m.all.days.entries()].sort((a, b) => b[1].total - a[1].total); qs.push({ q: 'Is mahine kis din sabse zyada issuance hui?', qs: 'इस महीने किस दिन सबसे ज़्यादा इशुअंस हुई?', a: dLabel(m.cur, td[0][0]), val: fmt(td[0][1].total), wrong: td.slice(1, 6).map(([d]) => dLabel(m.cur, d)) }); }
      if (!qs.length) return null;
      const Q = qs[(Number(cfg.qz) || 0) % qs.length]; cfg.qz = (Number(cfg.qz) || 0) + 1; save();
      const wrong = Q.wrong.filter((w) => w !== Q.a).sort(() => Math.random() - 0.5).slice(0, 2);
      const opts = [Q.a, ...wrong].sort(() => Math.random() - 0.5);
      const ans = opts.indexOf(Q.a);
      return { key: `quiz:${Q.q}`, fun: true, mood: 'curious', icon: '❓', title: 'Quiz time!', head: Q.q, view: 'quiz', stay: 9000,
        quiz: { opts, ans, val: Q.val }, say: `क्विज़ टाइम! ${Q.qs} सोचो सोचो…`, sayAns: `सही जवाब है ${/\d/.test(Q.a) ? Q.a : nm(Q.a)}, ${Q.val} टैग्स के साथ!`, q: '' };
    }
  );

  // ---------------------------------------------------------------- 🆕 v3.125.132: comeback, ek-din wale, ghante ka pattern, chassis, milestones, site activity, data late, motivation, andaaza, robot ka mood
  let presCache = { at: 0, people: [] }, verCache = null;
  const istNow = () => new Date(Date.now() + 5.5 * 3600e3);
  const istToday = () => istNow().toISOString().slice(0, 10);
  const istHour = () => istNow().getUTCHours();
  const firstName = () => { const u = FF.auth && FF.auth.user; return String((u && (u.name || u.username)) || '').split(/\s+/)[0]; };
  function siteAvg(S, n) { const ks = [...S.site.keys()].sort().slice(-(n || 14) - 1, -1); return ks.length ? ks.reduce((a, k) => a + S.site.get(k), 0) / ks.length : 0; }
  BUILDERS.push(
    function comeback() { // 🔙 7+ din chup, ab wapas
      const S = series(); if (!S) return null;
      const out = [];
      for (const o of S.ag.values()) {
        if (!o.days.get(S.last)) continue;
        const ds = [...o.days.keys()].filter((d) => d < S.last).sort(); const prev = ds[ds.length - 1];
        if (prev && daysBetween(prev, S.last) >= 8) out.push({ name: o.name, ch: o.ch, gap: daysBetween(prev, S.last) - 1, n: o.days.get(S.last) });
      }
      if (!out.length) return null;
      out.sort((a, b) => b.gap - a.gap);
      const r = out[0];
      return { key: `comeback:${S.last}`, mood: 'happy', cls: 'greet', icon: '🔙', title: 'Comeback!', head: `${r.name} ${r.gap} din baad wapas — ${fmt(r.n)} tags`, view: 'list',
        rows: out.slice(0, 5).map((x) => ({ name: x.name, sub: `${x.ch === 'ff' ? 'FF' : 'GV'} · ${x.gap} din chup the`, val: fmt(x.n), tone: 'up' })),
        say: `कमबैक! ${nm(r.name)} ${r.gap} दिन बाद वापस आए और ${dSay(S.last)} को ${fmt(r.n)} टैग्स किए।`, q: '' };
    },
    function oneDayers() { // 1️⃣ mahine me sirf ek din
      const S = series(), m = monthStats(); if (!S || !m) return null;
      const out = [];
      for (const o of S.ag.values()) {
        const ds = [...o.days.keys()].filter((d) => d.startsWith(m.cur));
        if (ds.length === 1 && daysBetween(ds[0], S.last) >= 5) out.push({ name: o.name, ch: o.ch, d: ds[0], n: o.days.get(ds[0]) });
      }
      if (out.length < 1) return null;
      out.sort((a, b) => b.n - a.n);
      return { key: `oneday:${out.length}:${S.last}`, mood: 'curious', icon: '1️⃣', title: 'Ek din aaye, phir gayab', head: `${out.length} agents ne is mahine sirf ek din kaam kiya`, view: 'list',
        rows: out.slice(0, 5).map((x) => ({ name: x.name, sub: `${x.ch === 'ff' ? 'FF' : 'GV'} · sirf ${dLbl(x.d)} ko`, val: fmt(x.n), tone: 'warn' })),
        say: `${out.length} एजेंट्स ने इस महीने सिर्फ़ एक दिन काम किया और फिर ग़ायब हो गए। जैसे ${nm(out[0].name)}, सिर्फ़ ${dSay(out[0].d)} को। इनसे बात कर लो।`, q: '' };
    },
    function hourPattern() { // 🕐 din ke kis waqt sabse zyada (GV Master me time hai)
      let rows = []; try { rows = (FF.gv && FF.gv.rows ? FF.gv.rows() : []) || []; } catch { rows = []; }
      if (!rows.length || !FF.model || !FF.model.timeToMins) return null;
      const cut = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), h = new Array(24).fill(0);
      let tot = 0;
      for (const r of rows) { const k = r.date ? String(r.date instanceof Date ? r.date.toISOString() : r.date).slice(0, 10) : ''; if (k && k < cut) continue; const mn = FF.model.timeToMins(r.time); if (!Number.isFinite(mn)) continue; h[Math.floor(mn / 60)] += 1; tot += 1; }
      if (tot < 50) return null;
      const order = h.map((n, i) => [i, n]).sort((a, b) => b[1] - a[1]);
      const lab = (i) => `${i % 12 || 12}${i < 12 ? ' AM' : ' PM'}–${(i + 1) % 12 || 12}${i + 1 < 12 || i + 1 === 24 ? ' AM' : ' PM'}`;
      const sayH = (i) => `${i < 12 ? 'सुबह' : i < 16 ? 'दोपहर' : i < 20 ? 'शाम' : 'रात'} ${i % 12 || 12} से ${(i + 1) % 12 || 12} बजे`;
      const top = order.slice(0, 5);
      return { key: `hours:${top[0][0]}`, mood: 'info', icon: '🕐', title: 'Din ka sabse busy time', head: `${lab(top[0][0])} sabse zyada tags (GV, 30 din)`, view: 'bars',
        rows: top.map(([i, n]) => ({ name: lab(i), sub: `${Math.round((n / tot) * 100)}% tags`, val: fmt(n), w: n, tone: 'up' })),
        say: `पिछले तीस दिन में सबसे ज़्यादा टैग्स ${sayH(top[0][0])} के बीच होते हैं। उसके बाद ${sayH(top[1][0])}। इसी टाइम पर एजेंट्स को एक्टिव रखो।`, q: '' };
    },
    function chassis() { // 🔩 chassis / VRN wale tag
      const m = monthStats(); if (!m) return null;
      const map = new Map(); let tot = 0;
      const scan = (rows, ch) => rows.forEach((r) => { if (r.ym !== m.cur || !/chassis/i.test(r.vrnType || '')) return; const q = Number(r.n) || 0; tot += q; const k = `${ch}|${r.agentName || r.agentId}`; const o = map.get(k) || { name: r.agentName || r.agentId, ch, n: 0 }; o.n += q; map.set(k, o); });
      try { let ff = FF.store.get('daily') || []; if (FF.filters && FF.filters.dropLaggedFf) ff = FF.filters.dropLaggedFf(ff); scan(ff.filter((r) => r.channel !== 'GV Partner'), 'ff'); } catch { /* ignore */ }
      try { scan(FF.gv.issuanceRows() || [], 'gv'); } catch { /* ignore */ }
      if (!tot) return null;
      const top = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 5);
      return { key: `chassis:${tot}`, mood: 'info', icon: '🔩', title: 'Chassis number wale tags', head: `Is mahine ${fmt(tot)} tags chassis par (${Math.round((tot / Math.max(1, m.all.total)) * 100)}%)`, view: 'bars',
        rows: top.map((x) => ({ name: x.name, sub: x.ch === 'ff' ? 'First Forward' : 'GV Partner', val: fmt(x.n), w: x.n, tone: 'chip' })),
        say: `इस महीने ${fmt(tot)} टैग्स चेसिस नंबर पर लगे। सबसे ज़्यादा ${nm(top[0].name)} के, ${fmt(top[0].n)}।`, q: '' };
    },
    function siteMilestone() { // 🎯 site ne 1000 / 5000 … paar kiye
      const m = monthStats(); if (!m || !m.all.total) return null;
      const T = [500, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000, 75000, 100000];
      const hit = T.filter((t) => m.all.total >= t).pop(); if (!hit) return null;
      return { key: `mile:${m.cur}:${hit}`, mood: 'excited', fx: 'clap', cls: 'mc-disco', icon: '🎯', title: `${fmt(hit)} tags paar!`, head: `Is mahine ab tak ${fmt(m.all.total)} — agla padaav ${fmt(T.find((t) => t > m.all.total) || hit * 2)}`, view: 'big', big: fmt(m.all.total),
        rows: [{ name: 'First Forward', val: fmt(m.ff.total) }, { name: 'GV Partner', val: fmt(m.gv.total) }].map((x) => ({ ...x, sub: '', tone: 'chip' })),
        say: `बधाई हो! इस महीने साइट ने ${fmt(hit)} टैग्स का आँकड़ा पार कर लिया। अभी तक ${fmt(m.all.total)} टैग्स। अगला पड़ाव ${fmt(T.find((t) => t > m.all.total) || hit * 2)}!`, q: 'summary|all' };
    },
    function agentMilestone() { // 💯 agent ke 100 / 250 / 500 / 1000 is mahine
      const S = series(), m = monthStats(); if (!S || !m) return null;
      const T = [100, 250, 500, 1000, 2000];
      const out = [];
      for (const o of S.ag.values()) {
        let tot = 0; for (const [d, n] of o.days) if (d.startsWith(m.cur)) tot += n;
        const before = tot - (o.days.get(S.last) || 0);
        const t = T.filter((x) => before < x && tot >= x).pop();
        if (t) out.push({ name: o.name, ch: o.ch, t, tot });
      }
      if (!out.length) return null;
      out.sort((a, b) => b.t - a.t);
      const r = out[0];
      return { key: `amile:${S.last}`, mood: 'excited', fx: 'clap', icon: '💯', title: 'Agent milestone!', head: `${r.name} ne is mahine ${fmt(r.t)} tags paar kiye`, view: 'list',
        rows: out.slice(0, 5).map((x) => ({ name: x.name, sub: `${x.ch === 'ff' ? 'FF' : 'GV'} · ${fmt(x.t)} paar`, val: fmt(x.tot), tone: 'up' })),
        say: `मुबारक हो ${nm(r.name)}! इस महीने ${fmt(r.t)} टैग्स पूरे हो गए, अभी ${fmt(r.tot)} पर हैं।`, q: '' };
    },
    function siteActivity() { // 👀 aaj site par kaun kitna active
      const ppl = (presCache.people || []).filter((p) => p.lastSeen && new Date(p.lastSeen + 5.5 * 3600e3).toISOString().slice(0, 10) === istToday());
      if (!ppl.length) return null;
      const rows = ppl.slice(0, 5).map((p) => {
        const mn = Math.round((Date.now() - p.lastSeen) / 60e3);
        const last = p.lastEvent && p.lastEvent.label ? ` · ${String(p.lastEvent.label).slice(0, 40)}` : '';
        return { name: p.name || p.username, sub: `${String(p.title || p.page || '').replace(/^#\/?/, '').slice(0, 30)}${last}`, val: p.active ? '🟢 abhi' : mn < 60 ? `${mn}m` : `${Math.floor(mn / 60)}h`, tone: 'chip' };
      });
      return { key: `act:${ppl.map((p) => p.username).join(',')}`, mood: 'curious', icon: '👀', title: 'Aaj site par kaun aaya', head: `${ppl.length} log aaj site par · ${ppl.filter((p) => p.active).length} abhi online`, view: 'list', rows,
        say: `आज ${ppl.length} लोग साइट पर आए। ${ppl.filter((p) => p.active).length ? `अभी ${ppl.filter((p) => p.active).map((p) => nm(p.name || p.username)).slice(0, 3).join(', ')} ऑनलाइन हैं।` : ''}`, q: '#/settings?tab=users' };
    },
    function dataLate() { // ⏰ subah sheet update nahi hui
      if (!verCache || !Array.isArray(verCache.sheets) || istHour() < 11) return null;
      const t = istToday();
      const late = verCache.sheets.filter((x) => /eir|stock/i.test(x.name || '') && x.changedAt && new Date(Date.parse(x.changedAt) + 5.5 * 3600e3).toISOString().slice(0, 10) !== t);
      if (!late.length) return null;
      return { key: `late:${t}:${late.map((x) => x.name).join(',')}`, mood: 'alert', icon: '⏰', title: 'Aaj ka data late hai!', head: `${late.map((x) => x.name).join(', ')} aaj abhi tak update nahi hui`, view: 'list',
        rows: late.slice(0, 5).map((x) => ({ name: x.name, sub: 'aakhri update', val: new Date(x.changedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }), tone: 'warn' })),
        say: `ध्यान दो! ${late.map((x) => x.name).join(' और ')} आज अभी तक अपडेट नहीं हुई। शीट चेक कर लो।`, q: '#/' };
    },
    function motivation() { // 🌅 subah ki ek line
      if (istHour() >= 12 || cfg.motivDay === istToday()) return null;
      const n = firstName(), L = [
        ['Aaj ka din aapka hai! Har ek tag ek naya customer hai 🚀', 'आज का दिन आपका है! हर एक टैग एक नया कस्टमर है।'],
        ['Chhote kadam roz — bada target mahine ke end me 🎯', 'छोटे कदम रोज़, बड़ा टारगेट महीने के एंड में।'],
        ['Jo agent aaj call karega, wahi kal record todega 📞', 'जो एजेंट आज कॉल करेगा, वही कल रिकॉर्ड तोड़ेगा।'],
        ['Stock bharo, speed badhao, team ko jagao — chalo shuru karein 💪', 'स्टॉक भरो, स्पीड बढ़ाओ, टीम को जगाओ, चलो शुरू करें!'],
        ['Kal se behtar — bas itna hi karna hai aaj 🌟', 'कल से बेहतर, बस इतना ही करना है आज।']
      ];
      const [h, sy] = L[new Date().getDate() % L.length];
      return { onShow: () => { cfg.motivDay = istToday(); save(); }, key: `motiv:${istToday()}`, fun: true, cls: 'greet', mood: 'happy', icon: '🌅', title: `Good morning${n ? ' ' + n : ''}!`, head: h, view: 'text', stay: 7000,
        say: `गुड मॉर्निंग${n ? ' ' + nm(n) : ''}! ${sy}` };
    },
    function guess() { // 🔮 aaj ka andaaza + kal ka hisaab
      const S = series(); if (!S) return null;
      const g = cfg.guess;
      if (g && g.date && !g.done && S.site.has(g.date)) { // asal aa gaya → result
        const act = S.site.get(g.date), err = act ? Math.round((Math.abs(g.n - act) / act) * 100) : 0;
        return { onShow: () => { cfg.guess = { ...g, done: 1 }; save(); }, key: `guessres:${g.date}`, mood: err <= 10 ? 'excited' : err <= 25 ? 'happy' : 'laugh', fx: err <= 10 ? 'clap' : '', icon: '🔮', title: 'Mera andaaza kaisa raha?', head: `${dLbl(g.date)}: andaaza ${fmt(g.n)} · asal ${fmt(act)} — ${100 - Math.min(100, err)}% sahi`, view: 'big', big: fmt(act),
          rows: [{ name: 'Mera andaaza', val: fmt(g.n) }, { name: 'Asal', val: fmt(act) }, { name: 'Farak', val: `${act >= g.n ? '+' : '−'}${fmt(Math.abs(act - g.n))}` }].map((x) => ({ ...x, sub: '', tone: 'chip' })),
          say: `${dSay(g.date)} के लिए मेरा अंदाज़ा ${fmt(g.n)} था, असल में ${fmt(act)} टैग्स हुए। ${err <= 10 ? 'वाह, लगभग सही!' : err <= 25 ? 'काफ़ी पास था!' : 'इस बार चूक गया, हा हा!'}`, q: '' };
      }
      const t = istToday();
      if (g && g.date === t) return null;
      if (S.site.has(t)) return null;
      // same weekday ka pichle 4 hafte ka average × haal ka level
      const wd = new Date(`${t}T00:00:00Z`).getUTCDay(), same = [];
      for (const [k, v] of S.site) if (new Date(`${k}T00:00:00Z`).getUTCDay() === wd && k < t) same.push([k, v]);
      same.sort((a, b) => (a[0] < b[0] ? 1 : -1));
      const base = same.slice(0, 4).map((x) => x[1]); if (!base.length) return null;
      const est = Math.round((base.reduce((a, b) => a + b, 0) / base.length) * 0.5 + siteAvg(S, 7) * 0.5);
      return { onShow: () => { cfg.guess = { date: t, n: est }; save(); }, key: `guess:${t}`, mood: 'curious', icon: '🔮', title: 'Aaj kitne tags honge?', head: `Mera andaaza: aaj ~${fmt(est)} tags (kal data aane par batata hoon kitna sahi tha)`, view: 'big', big: `~${fmt(est)}`,
        rows: [{ name: 'Pichle 7 din avg', val: fmt(siteAvg(S, 7)) }, { name: 'Isi weekday avg', val: fmt(base.reduce((a, b) => a + b, 0) / base.length) }].map((x) => ({ ...x, sub: '', tone: 'chip' })),
        say: `मेरा अंदाज़ा है आज लगभग ${fmt(est)} टैग्स होंगे। कल डेटा आने पर बताऊँगा कितना सही था!`, q: '' };
    },
    function robotMood() { // 😄/😢 robot ka mood + kaaran
      const S = series(); if (!S) return null;
      const v = S.site.get(S.last) || 0, avg = siteAvg(S, 14); if (!avg) return null;
      const d = Math.round(((v - avg) / avg) * 100);
      const reasons = [{ name: `${dLbl(S.last)} ki issuance`, sub: `14 din avg ${fmt(avg)}`, val: pct(d), tone: d >= 0 ? 'up' : 'down' }];
      const lc = sq('lowcover|all', 500), ina = sq('inactive|all', 5000), hi = sq('high|all', 5000), kl = kycCache.rows || [];
      if (hi && hi.rows.length) reasons.push({ name: 'High growth agents', sub: '', val: fmt(hi.rows.length), tone: 'up' });
      if (lc && lc.rows.length) reasons.push({ name: 'Stock khatam hone wale', sub: '', val: fmt(lc.rows.length), tone: 'warn' });
      if (ina && ina.rows.length) reasons.push({ name: 'Inactive agents', sub: '', val: fmt(ina.rows.length), tone: 'down' });
      if (kl.length) reasons.push({ name: 'KYC kam wale', sub: '', val: fmt(kl.length), tone: 'down' });
      const mood = d >= 10 ? 'excited' : d >= -5 ? 'happy' : d >= -20 ? 'sad' : 'sleepy';
      const face = { excited: '🤩 Bahut khush', happy: '😊 Khush', sad: '😟 Thoda udaas', sleepy: '😢 Udaas' }[mood];
      return { key: `rmood:${S.last}:${mood}`, mood, icon: '🤖', title: `Aaj mera mood: ${face}`, head: d >= 0 ? `Kyunki ${dLbl(S.last)} ko average se ${d}% zyada tags hue!` : `Kyunki ${dLbl(S.last)} ko average se ${Math.abs(d)}% kam tags hue`, view: 'list', rows: reasons.slice(0, 5),
        say: d >= 0 ? `आज मेरा मूड बहुत अच्छा है, क्योंकि ${dSay(S.last)} को एवरेज से ${d} प्रतिशत ज़्यादा टैग्स हुए!` : `आज मैं थोड़ा उदास हूँ, क्योंकि ${dSay(S.last)} को एवरेज से ${Math.abs(d)} प्रतिशत कम टैग्स हुए। चलो आज ज़्यादा करते हैं!`, q: '' };
    }
  );

  // KYC + dispatch: async data, cache me (KYC 30 min, dispatch 10 min)
  const kycCache = { at: 0, rows: [] }, dispCache = { at: 0, data: null };
  async function refreshExtras() {
    if (!allowed()) return;
    if (Date.now() - dispCache.at > 10 * 60e3) {
      try { const d = await api('/api/robot/dispatch'); if (d && !d.pending) { dispCache.data = d; dispCache.at = Date.now(); } } catch { /* ignore */ }
    }
    if (Date.now() - kycCache.at > 30 * 60e3 && FF.model && FF.model.loadKycAll) {
      try {
        const all = await FF.model.loadKycAll();
        const cur = U.reportYm ? U.reportYm() : '';
        const m = new Map();
        for (const r of all || []) {
          if (cur && r.ym !== cur) continue;
          const name = r.gvName || r.agent; if (!name) continue;
          const ch = r.gvName ? 'gv' : 'ff', k = `${ch}|${name}`;
          let o = m.get(k); if (!o) { o = { ch, name, n: 0, full: 0 }; m.set(k, o); }
          o.n += r.n; if (r.kyc === 'full') o.full += r.n;
        }
        kycCache.rows = [...m.values()].filter((o) => o.n >= 15).map((o) => ({ ...o, pct: Math.round((o.full / o.n) * 100) }))
          .filter((o) => o.pct < 70).sort((a, b) => b.n - a.n);
        // v3.125.131 — pichle mahine se KYC ratio tulna (sudhra / bigda)
        const prevYm = U.prevMonthKey ? U.prevMonthKey(cur) : '', pm = new Map();
        for (const r of all || []) {
          if (r.ym !== prevYm) continue;
          const name = r.gvName || r.agent; if (!name) continue;
          const k = `${r.gvName ? 'gv' : 'ff'}|${name}`;
          let o = pm.get(k); if (!o) { o = { n: 0, full: 0 }; pm.set(k, o); }
          o.n += r.n; if (r.kyc === 'full') o.full += r.n;
        }
        kycCache.cmp = [...m.entries()].map(([k, o]) => { const p0 = pm.get(k); if (!p0 || p0.n < 15 || o.n < 15) return null; const a = Math.round((o.full / o.n) * 100), b = Math.round((p0.full / p0.n) * 100); return { ...o, pct: a, prev: b, d: a - b }; }).filter(Boolean);
        kycCache.at = Date.now();
      } catch { /* ignore */ }
    }
  }

  function insights() {
    const out = [];
    BUILDERS.forEach((b) => { try { const x = b(); if (x) out.push(withTl(x)); } catch { /* data abhi nahi */ } });
    return out;
  }
  // 👤 v3.125.133 — har agent ke saath uska TL (board + notification)
  let tlCache = { at: 0, map: null };
  function tlMap() {
    if (tlCache.map && Date.now() - tlCache.at < 5 * 60e3) return tlCache.map;
    const m = new Map();
    ['top|all', 'inactive|all', 'stockhigh|all', 'deadstock|all', 'degrowth|all'].forEach((id) => { const a = sq(id, 100000); (a && a.rows || []).forEach((r) => { if (r && r.name && r.tl) m.set(String(r.name).trim().toUpperCase(), r.tl); }); });
    tlCache = { at: Date.now(), map: m };
    return m;
  }
  function withTl(it) {
    const m = tlMap(); if (!m.size || !it || !Array.isArray(it.rows)) return it;
    it.rows.forEach((r) => {
      const raw = String(r.name || '').replace(/^[^\p{L}]+/u, '').trim(), tl = m.get(raw.toUpperCase());
      if (!tl || tl.toUpperCase() === raw.toUpperCase()) return;
      r.tl = tl;
      if (!/\bTL\b/.test(r.sub || '')) r.sub = r.sub ? `${r.sub} · TL ${tl}` : `TL ${tl}`;
    });
    return it;
  }
  const CLIENT_PUSH = /^(lowcover|stockend|nostock|deadstock|stockhigh|dispatchneed|stocktl|dispatchtl|kyclow|kycup|kycdown|dispfx|rephigh|hours|chassis|oneday|late|lowissue|inacttl|runrate|vc4tl)\b/;
  // 📱 robot ki khabar → app + web push (server dedupe + rate limit karta hai)
  function pushRobot(it) {
    if (!it || it.fun || cfg.push === false || !allowed() || !FF.auth || !FF.auth.api) return;
    // issuance / growth / TL / champions / record / milestone / dispatch / stock total ab SERVER khud bhejta hai (dashboard band ho tab bhi);
    // yahan se sirf wo jo server nahi banata — agent-wise stock, KYC, dispatch ka asar, replacement, busy time, chassis, data late…
    if (!CLIENT_PUSH.test(String(it.key || ''))) return;
    const lines = (it.rows || []).slice(0, 5).map((r) => `• ${r.name}${r.tl ? ` (TL ${r.tl})` : ''}${r.val ? ` — ${r.val}` : ''}`);
    const body = [it.big ? `${it.big} · ${it.head || ''}` : it.head, ...lines, it.foot || ''].filter(Boolean).join('\n');
    const key = `${it.key}|${it.head}|${(it.rows || []).map((r) => r.val).join(',')}|${it.big || ''}`.slice(0, 200);
    if (pushQ.some((x) => x.key === key)) return;
    pushQ.push({ key, title: `🤖 ${it.icon || ''} ${it.title}`.replace(/\s+/g, ' ').trim(), body, link: it.q && it.q[0] === '#' ? it.q : '#/' });
    if (pushQ.length > 30) pushQ.splice(0, pushQ.length - 30);
  }
  // server 25 sec me ek push leta hai → queue se ek-ek karke (koi khabar chhoote nahi)
  const pushQ = [];
  setInterval(() => {
    const x = pushQ.shift(); if (!x || !FF.auth || !FF.auth.api) return;
    FF.auth.api('/api/robot/notify', 'POST', x).then((r) => { if (r && r.reason === 'rate') pushQ.unshift(x); }).catch(() => {});
  }, 27e3);

  // "🆕 naya data aaya" — server ke daily versions se
  const prio = [];
  async function checkVersions() {
    try {
      if (!FF.data || !FF.data.versions) return;
      const v = await FF.data.versions(true); verCache = v;
      const fresh = [];
      (v && v.sheets || []).forEach((s) => {
        const at = Date.parse(s.changedAt || '') || 0;
        if (!at) return;
        const seen = Number(cfg.seen[s.name]) || 0;
        if (at > seen) {
          if (seen || Date.now() - at < 12 * 3600e3) fresh.push({ name: s.name, at, rows: s.rows });
          cfg.seen[s.name] = at;
        }
      });
      save();
      if (fresh.length) {
        const t = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
        prio.push({
          key: 'data', mood: 'excited', icon: '🆕', title: pick(['Naya data aa gaya!', 'Taaza khabar!']),
          head: fresh.length === 1 ? `${fresh[0].name} update hua` : `${fresh.length} sheets update hui`, view: 'list',
          rows: fresh.slice(0, 4).map((x) => ({ name: x.name, sub: x.rows != null ? `${fmt(x.rows)} rows` : '', val: t(x.at), tone: 'chip' })),
          say: `नया डेटा आ गया है! ${fresh.map((x) => x.name).join(', ')} अपडेट हो गया। अब सब नंबर ताज़ा हैं।`,
          q: '#home'
        });
        schedule(4000);
      }
    } catch { /* login nahi / offline */ }
  }

  // ---------------------------------------------------------------- history: last 24h, sirf unique
  const HK = 'ff_mascot_hist_v1', DAY = 24 * 3600e3;
  const sigOf = (it) => `${it.key}|${it.head}|${(it.rows || []).map((r) => `${r.name}:${r.val}`).join(',')}|${it.big || ''}`;
  function histLoad() {
    try { const a = JSON.parse(localStorage.getItem(HK) || '[]'); return Array.isArray(a) ? a.filter((h) => h && Date.now() - h.at < DAY) : []; } catch { return []; }
  }
  function histSave(a) { try { localStorage.setItem(HK, JSON.stringify(a.slice(0, 60))); } catch { /* private mode */ } }
  function histAdd(it) {
    const sig = sigOf(it);
    const a = histLoad().filter((h) => h.sig !== sig); // same baat dobara → purani entry hatao, ek hi rahe
    a.unshift({ sig, at: Date.now(), key: it.key, icon: it.icon, title: it.title, head: it.head, big: it.big || '', q: it.q || '', mood: it.mood });
    histSave(a);
  }
  const saidWithin = (it, ms) => { const sig = sigOf(it); return histLoad().some((h) => h.sig === sig && Date.now() - h.at < ms); };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'abhi' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim(); };
  function runQ(q) {
    if (!q) return;
    try { if (q === '@notif') { if (FF.app && FF.app.openNotifications) FF.app.openNotifications('center'); } else if (q[0] === '#') location.hash = q; else if (FF.smartQ) FF.smartQ.open(q, /inactive/.test(q) ? 50 : 10); } catch { /* optional */ }
  }
  function openAssistant() { const f = document.getElementById('ask-fab'); if (f) f.click(); }

  // ---------------------------------------------------------------- DOM — assistant ka hi robot (Gems) site par
  let el = null, bot = null, board = null, stick = null, mode = 'dock', busy = false, timer = 0;
  let current = null, hover = false, skip = null, pos = [0, 0], dragged = false;
  const root = document.documentElement;
  function build() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'ff-mascot';
    el.className = 'mc';
    el.innerHTML = `
      <div class="mc-stick" aria-hidden="true"></div>
      <div class="mc-board" role="status" aria-live="polite"></div>
      <button type="button" class="mc-bot" aria-label="Gems robot — kya kya bataya (24h history)" title="🤖 Gems — click: maine kya bataya (24h) · drag: jagah badlo">
        <i class="mc-glow" aria-hidden="true"></i>
        <span class="mc-arm l"><img src="${ASSET('robot-arm-l.png')}" alt="" draggable="false"></span>
        <span class="mc-arm r"><img src="${ASSET('robot-arm-r.png')}" alt="" draggable="false"></span>
        <img class="mc-body" src="${ASSET('robot-torso.png')}" alt="" draggable="false">
        <span class="mc-headwrap"><img class="mc-head" src="${ASSET('robot-head.png')}" alt="" draggable="false"><i class="mc-eye l"><b></b></i><i class="mc-eye r"><b></b></i><i class="mc-mouth"><b></b></i></span>
        <span class="mc-fx" aria-hidden="true"></span>
        <span class="mc-dot" hidden></span>
      </button>`;
    document.body.appendChild(el);
    bot = el.querySelector('.mc-bot');
    board = el.querySelector('.mc-board');
    stick = el.querySelector('.mc-stick');
    el.addEventListener('mouseenter', () => { hover = true; });
    el.addEventListener('mouseleave', () => { hover = false; });
    board.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mc]');
      if (b) { e.stopPropagation(); onCtl(b.dataset.mc, b); return; }
      const li = e.target.closest('[data-q]');
      if (li) { runQ(li.dataset.q); closeHist(); return; }
      if (mode === 'show' && current) { runQ(current.q); if (skip) skip(); }
    });
    // drag → nayi jagah (dock) · click → history
    let start = null;
    bot.addEventListener('pointerdown', (e) => {
      if (mode !== 'dock' && mode !== 'hist') return;
      start = { x: e.clientX, y: e.clientY, p: pos.slice() }; dragged = false;
      try { bot.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    bot.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < 8) return;
      if (!dragged) { dragged = true; closeHist(); el.classList.add('drag'); }
      const g = geo();
      place([Math.max(4, Math.min(g.vw - g.W - 4, start.p[0] + dx)), Math.max(g.minY, Math.min(g.vh - g.H - 4, start.p[1] + dy))]);
    });
    const end = () => {
      if (!start) return;
      start = null; el.classList.remove('drag');
      if (dragged && !pipWin) { const g = geo(); cfg.dock = { r: Math.round(g.vw - g.W - pos[0]), b: Math.round(g.vh - g.H - pos[1]) }; save(); }
    };
    bot.addEventListener('pointerup', end);
    bot.addEventListener('pointercancel', end);
    bot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragged) { dragged = false; return; }
      if (mode === 'show') { dance('happy', 1400); return; }
      if (mode === 'hist') closeHist(); else openHist();
    });
    document.addEventListener('click', (e) => { if (mode === 'hist' && !el.contains(e.target)) closeHist(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (mode === 'hist') closeHist(); else if (skip) skip(); } });
    window.addEventListener('resize', () => { if (mode === 'dock') place(dockPos()); });
    // Gems assistant ki state robot par bhi: sun raha / soch raha / bol raha
    const fab = document.getElementById('ask-fab');
    if (fab && window.MutationObserver) {
      const sync = () => { el.dataset.astate = fab.dataset.state || 'idle'; };
      new MutationObserver(sync).observe(fab, { attributes: true, attributeFilter: ['data-state'] });
      sync();
    }
    place(dockPos());
    applyOn();
  }
  function applyOn() {
    const on = !!cfg.on && allowed(); // 👑 sirf admin
    root.classList.toggle('mc-on', on && !pipWin); // robot pop-out me ho to site par 🎙 button wapas
    if (el) el.hidden = !on;
  }

  function rowsHtml(it) {
    const rows = it.rows || [];
    const max = Math.max(1, ...rows.map((r) => r.w || 0));
    if (it.view === 'text') return `<div class="mc-headline mc-textv"><span class="mc-type" data-text="${esc(it.head)}"></span></div>`;
    if (it.view === 'quiz' && it.quiz) return `<div class="mc-headline mc-textv"><span class="mc-type" data-text="${esc(it.head)}"></span></div><ol class="mc-quiz">${it.quiz.opts.map((o, i) => `<li class="${i === it.quiz.ans ? 'ok' : ''}"><b>${'ABC'[i]}</b> ${esc(o)}${i === it.quiz.ans ? ` <small>· ${esc(it.quiz.val)}</small>` : ''}</li>`).join('')}</ol><div class="mc-qtimer"><i></i></div>`;
    if (it.view === 'big') {
      return `<div class="mc-big"><b>${esc(it.big)}</b><span>${esc(it.head)}</span></div>`
        + (it.prog != null ? `<div class="mc-prog"><i style="width:${it.prog}%"></i></div>` : '')
        + (rows.length ? `<div class="mc-chips">${rows.map((r) => `<span class="mc-chip ${r.tone || ''}"><small>${esc(r.name)}</small> <b>${esc(r.val)}</b></span>`).join('')}</div>` : '');
    }
    return `<div class="mc-headline"><span class="mc-type" data-text="${esc(it.head)}"></span></div><ol class="mc-rows ${it.view === 'bars' ? 'bars' : ''}">${rows.map((r, i) => `
      <li style="--d:${0.5 + i * 0.25}s">${it.view === 'bars' ? `<i class="mc-bar" style="--w:${Math.max(8, Math.round((r.w || 0) / max * 100))}%"></i>` : ''}
        <span class="mc-n">${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><b class="mc-v ${r.tone || ''}">${esc(r.val)}</b></li>`).join('')}</ol>`;
  }
  const EVERY = [[10, '10 sec'], [20, '20 sec'], [30, '30 sec'], [60, '1 min'], [120, '2 min'], [300, '5 min'], [600, '10 min']];
  const menuHtml = () => `
      <div class="mc-menu" hidden>
        <label>Naya update kitni der me
          <select data-mc="every">${EVERY.map(([v, l]) => `<option value="${v}"${(Number(cfg.everySec) || 10) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Idhar-udhar ghoomna <input type="checkbox" data-mc="roam"${cfg.roam !== false ? ' checked' : ''}></label>
        <label>Masti (dance + jokes) <input type="checkbox" data-mc="fun"${cfg.fun !== false ? ' checked' : ''}></label>
        <button type="button" data-mc="home">🏠 Wapas kone me (default jagah)</button>
        <button type="button" data-mc="today">😴 Aaj ke liye updates band</button>
        <button type="button" data-mc="off">⛔ Robot band karo (purana 🎙 button)</button>
        <small>Wapas chalu: Settings → 🔔 Sound → 🤖 Robot dost (ya Gems panel → 🤖)</small>
      </div>`;
  function boardHtml(it) {
    return `<div class="mc-bh"><span class="mc-ic">${it.icon}</span><b>${esc(it.title)}</b></div>
      <div class="mc-bb">${rowsHtml(it)}${it.foot ? `<div class="mc-foot">${esc(it.foot)}</div>` : ''}</div>
      <div class="mc-ctl">
        <span class="mc-go">${it.q ? 'Tap → poori list' : ''}</span>
        <button type="button" data-mc="sound" title="Bol kar sunao (on/off)">${cfg.sound ? '🔊' : '🔇'}</button>
        <button type="button" data-mc="next" title="Agla update">⏭</button>
        <button type="button" data-mc="menu" title="Robot settings">⚙</button>
        <button type="button" data-mc="close" title="Abhi chhupao">✕</button>
      </div>${menuHtml()}`;
  }
  function histHtml() {
    const a = histLoad();
    const list = a.length
      ? `<ol class="mc-hist">${a.map((h) => `<li${h.q ? ` data-q="${esc(h.q)}"` : ''} class="m-${esc(h.mood || 'info')}"><span class="mc-hi">${h.icon || '🤖'}</span>
          <span class="mc-n">${esc(h.title)}<small>${h.big ? `<b>${esc(h.big)}</b> ` : ''}${esc(h.head)}</small></span><b class="mc-v">${ago(h.at)}</b></li>`).join('')}</ol>`
      : '<div class="mc-empty">Pichle 24 ghante me abhi kuch nahi bataya.<br>✨ <b>Naya update</b> dabao — main abhi batata hoon!</div>';
    return `<div class="mc-bh"><span class="mc-ic">🕘</span><b>Maine kya bataya · 24h</b><small class="mc-cnt">${a.length} unique</small></div>
      <div class="mc-bb">${list}</div>
      <div class="mc-ctl wide">
        <button type="button" class="mc-pill" data-mc="ask">🎙 Gems se poochho</button>
        <button type="button" class="mc-pill" data-mc="now">✨ Naya update</button>
        ${pipWin ? '<button type="button" class="mc-pill pip" data-mc="popin">↩️ Wapas site par</button>' : pipOk() ? '<button type="button" class="mc-pill pip" data-mc="pop" title="Chhoti window — Chrome ke dusre tab, WhatsApp, kisi bhi app ke upar">📌 Har tab / WhatsApp par</button>' : ''}
        <span class="mc-go"></span>
        <button type="button" data-mc="sound" title="Bol kar sunao (on/off)">${cfg.sound ? '🔊' : '🔇'}</button>
        <button type="button" data-mc="menu" title="Robot settings">⚙</button>
        <button type="button" data-mc="close" title="Band karo">✕</button>
      </div>${menuHtml()}`;
  }

  function onCtl(k, b) {
    if (k === 'sound') {
      cfg.sound = !cfg.sound; save(); b.textContent = cfg.sound ? '🔊' : '🔇';
      if (cfg.sound && current) say(current.say); else stopSpeech();
    } else if (k === 'next') { if (skip) skip('next'); }
    else if (k === 'close') { if (mode === 'hist') closeHist(); else if (skip) skip(); }
    else if (k === 'menu') { const m = board.querySelector('.mc-menu'); if (m) { m.hidden = !m.hidden; layoutBoard(geo(), el.dataset.side || 'left'); } hover = true; }
    else if (k === 'today') { cfg.snoozeDay = today(); save(); if (skip) skip(); closeHist(); }
    else if (k === 'off') { cfg.on = false; save(); if (skip) skip(); closeHist(); applyOn(); }
    else if (k === 'home') { delete cfg.dock; save(); closeHist(); fly([pos, dockPos()], 900); }
    else if (k === 'ask') { closeHist(); openAssistant(); }
    else if (k === 'now') { closeHist(); now(true); }
    else if (k === 'pop') { closeHist(); popOut(); }
    else if (k === 'popin') { closeHist(); popIn(); }
  }
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.closest || !t.closest('#ff-mascot')) return;
    if (t.dataset.mc === 'every') { cfg.everySec = Number(t.value) || 10; save(); schedule(); }
    if (t.dataset.mc === 'roam') { cfg.roam = !!t.checked; save(); }
    if (t.dataset.mc === 'fun') { cfg.fun = !!t.checked; save(); }
  });

  // ---------------------------------------------------------------- 🗣 voice (v3.125.124: sahi Hindi uchcharan)
  // Hindi voice Roman Hinglish ("ne", "kiya", "hai") ko angrezi akshar ki tarah padhti thi → bolne se pehle
  // Devanagari me badlo, naam Title-case, VC4/TL/% ko bol-chaal me; sabse achhi Hindi voice (Natural/Online/Google).
  const HI = {
    ne: 'ने', ki: 'की', ka: 'का', ke: 'के', ko: 'को', hai: 'है', hain: 'हैं', tha: 'था', the: 'थे', thi: 'थी', kiya: 'किया', kiye: 'किए', kar: 'कर', karo: 'करो',
    kare: 'करे', diya: 'दिया', di: 'दी', liya: 'लिया', aaj: 'आज', abhi: 'अभी', naya: 'नया', nayi: 'नई', naye: 'नए', aaya: 'आया', aaye: 'आए', aayi: 'आई',
    wapas: 'वापस', ho: 'हो', hua: 'हुआ', hui: 'हुई', gaya: 'गया', gayi: 'गई', gaye: 'गए', se: 'से', me: 'में', mein: 'में', par: 'पर', aur: 'और', ek: 'एक',
    bhi: 'भी', nahi: 'नहीं', nahin: 'नहीं', kam: 'कम', zyada: 'ज़्यादा', jyada: 'ज़्यादा', mahine: 'महीने', mahina: 'महीना', din: 'दिन', sirf: 'सिर्फ़',
    badla: 'बदला', badli: 'बदली', badle: 'बदले', kisi: 'किसी', koi: 'कोई', kaun: 'कौन', log: 'लोग', maange: 'माँगे', maanga: 'माँगा', ye: 'ये', yeh: 'यह',
    wo: 'वो', woh: 'वह', is: 'इस', us: 'उस', inko: 'इनको', unko: 'उनको', tak: 'तक', pe: 'पे', jaldi: 'जल्दी', bahut: 'बहुत', achha: 'अच्छा', accha: 'अच्छा',
    sabse: 'सबसे', sab: 'सब', upar: 'ऊपर', neeche: 'नीचे', chal: 'चल', rahe: 'रहे', raha: 'रहा', rahi: 'रही', bacha: 'बचा', khatam: 'ख़त्म', wala: 'वाला',
    wale: 'वाले', wali: 'वाली', aage: 'आगे', peeche: 'पीछे', pichle: 'पिछले', agla: 'अगला', agle: 'अगले', kitne: 'कितने', kitna: 'कितना', hisaab: 'हिसाब',
    dhyaan: 'ध्यान', do: 'दो', lo: 'लो', dekho: 'देखो', chalo: 'चलो', bolo: 'बोलो', mera: 'मेरा', meri: 'मेरी', main: 'मैं', aap: 'आप', aapka: 'आपका',
    tags: 'टैग्स', tag: 'टैग', agents: 'एजेंट्स', agent: 'एजेंट', stock: 'स्टॉक', report: 'रिपोर्ट', update: 'अपडेट', today: 'आज', total: 'टोटल',
    issuance: 'इशुअंस', growth: 'ग्रोथ', team: 'टीम', sheet: 'शीट', data: 'डेटा', online: 'ऑनलाइन', settings: 'सेटिंग्स', user: 'यूज़र', search: 'सर्च',
    request: 'रिक्वेस्ट', dispatch: 'डिस्पैच', all: 'ऑल', last: 'लास्ट', month: 'मंथ', replace: 'रिप्लेस', chassis: 'चेसिस'
  };
  const MON_HI = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'];
  const MON_EN = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  // v3.125.130 — insaan jaisi bol-chaal: date pehle ("2026-11-08" → "8 नवंबर", minus nahi), symbols → shabd
  function toSpeech(text) {
    let t = String(text || '').replace(/\p{Extended_Pictographic}️?/gu, ' ');
    const yr = new Date().getFullYear();
    t = t.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m, y, mo, d) => `${Number(d)} ${MON_HI[Number(mo) - 1] || ''}${Number(y) !== yr ? ` ${y}` : ''}`)
      .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, d, mo, y) => `${Number(d)} ${MON_HI[Number(mo) - 1] || ''}${Number(y) !== yr ? ` ${y}` : ''}`)
      .replace(/\b(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\b\.?/gi, (m, d, mo) => `${Number(d)} ${MON_HI[MON_EN[mo.toLowerCase()]]}`)
      .replace(/\b(\d{1,2}):(\d{2})\s?(am|pm)\b/gi, (m, h, mi, ap) => `${/p/i.test(ap) ? (Number(h) >= 6 && Number(h) < 12 ? 'शाम' : 'दोपहर') : 'सुबह'} ${Number(h)} बजकर ${Number(mi)} मिनट`);
    t = t.replace(/\bVC\s?5\s?\+/gi, 'वी सी 5 प्लस').replace(/\bVC\s?(\d+)/gi, 'वी सी $1').replace(/\bTLs?\b/g, 'टी एल').replace(/\bKYC\b/gi, 'के वाई सी')
      .replace(/\bGV\b/g, 'जी वी').replace(/\bFF\b/g, 'फ़र्स्ट फ़ॉरवर्ड').replace(/\bEIR\b/g, 'ई आई आर')
      .replace(/(\d+)\s?\/\s?din\b/gi, '$1 रोज़').replace(/(\d+)\s?\/\s?(\d+)/g, '$2 में से $1')
      .replace(/(\d)\s?%/g, '$1 प्रतिशत').replace(/~\s?|≈\s?/g, 'लगभग ').replace(/\s→\s|→/g, ' से ')
      .replace(/(^|[\s(,])\+(\d)/g, '$1प्लस $2').replace(/(^|[\s(,])[−–-](\d)/g, '$1माइनस $2')
      .replace(/[·|•]/g, ', ').replace(/\s*:\s+/g, ', ').replace(/\s[–—-]\s/g, ', ');
    // ALL CAPS naam → Title case (warna voice R-A-H-U-L padhti hai)
    t = t.replace(/\b[A-Z]{3,}\b/g, (w) => (/^(IDFC|NHAI|VRN)$/.test(w) ? w.split('').join(' ') : w[0] + w.slice(1).toLowerCase()));
    t = t.split(/(⟪[^⟫]*⟫)/).map((seg) => (seg[0] === '⟪' ? seg.slice(1, -1) : seg.replace(/\b[A-Za-z]+\b/g, (w) => HI[w.toLowerCase()] || w))).join('');
    return t.replace(/\s+([,।.!?])/g, '$1').replace(/(,\s*){2,}/g, ', ').replace(/\s+/g, ' ').trim();
  }
  let hiVoice = null;
  function pickVoice() {
    try {
      const vs = window.speechSynthesis.getVoices() || [];
      const pref = U.voicePrefs ? (U.voicePrefs().hi || '') : '';
      const chosen = pref && vs.find((v) => v.voiceURI === pref);
      if (chosen) return chosen;
      const hi = vs.filter((v) => /^hi([-_]|$)/i.test(v.lang));
      const score = (v) => (/natural|neural/i.test(v.name) ? 0 : /online/i.test(v.name) ? 1 : /google/i.test(v.name) ? 2 : 3);
      return hi.sort((a, b) => score(a) - score(b))[0] || null;
    } catch { return null; }
  }
  try { if ('speechSynthesis' in window) { hiVoice = pickVoice(); window.speechSynthesis.addEventListener('voiceschanged', () => { hiVoice = pickVoice(); }); } } catch { /* ignore */ }
  let talking = false;
  function stopSpeech() { try { if (talking && window.speechSynthesis) window.speechSynthesis.cancel(); } catch { /* ignore */ } talking = false; if (el) el.classList.remove('talk'); }
  function say(text) {
    return new Promise((resolve) => {
      const act = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
      if (!cfg.sound || !text || !act || !('speechSynthesis' in window)) return resolve(false);
      const parts = (toSpeech(text).match(/[^।.!?]+[।.!?]*/g) || []).map((x) => x.trim()).filter(Boolean); // chhote vaakya (lookbehind nahi — purane iPhone Safari me poori file fail hoti thi)
      if (!parts.length) return resolve(false);
      let left = parts.length, fin = false;
      const done = () => { if (fin) return; fin = true; talking = false; if (el) el.classList.remove('talk'); resolve(true); };
      talking = true; el.classList.add('talk');
      try {
        window.speechSynthesis.cancel();
        if (!hiVoice) hiVoice = pickVoice();
        const p = U.voicePrefs ? U.voicePrefs() : {};
        parts.forEach((part) => {
          const u = new SpeechSynthesisUtterance(part);
          if (hiVoice) u.voice = hiVoice;
          u.lang = (hiVoice && hiVoice.lang) || 'hi-IN';
          u.rate = Number(p.rate) > 0 ? Math.min(1.1, Number(p.rate)) : 0.95; // aaram se, insaan jaisa
          u.pitch = Number(p.pitch) > 0 ? Math.min(1.2, Number(p.pitch)) : 1; // natural pitch (robotic nahi)
          u.onend = () => { left -= 1; if (left <= 0) done(); };
          u.onerror = done;
          window.speechSynthesis.speak(u);
        });
        setTimeout(done, 30000);
      } catch { done(); }
    });
  }

  // ---------------------------------------------------------------- motion
  function geo() {
    const w = win(), vw = w.innerWidth, vh = w.innerHeight, mob = vw < 760;
    const W = mob ? 62 : 84, H = Math.round(W * 1.208);
    const BW = Math.min(mob ? 260 : 330, vw - W - 30);
    if (pipWin) return { vw, vh, mob, W, H, BW, minY: 8, maxY: vh - H - 10 };
    return { vw, vh, mob, W, H, BW, minY: mob ? 64 : 72, maxY: vh - H - (mob ? 84 : 16) };
  }
  function dockPos() {
    const g = geo(), d = pipWin ? { r: 12, b: 12 } : cfg.dock || { r: g.mob ? 10 : 16, b: g.mob ? 84 : 14 };
    return [Math.max(4, Math.min(g.vw - g.W - 4, g.vw - g.W - d.r)), Math.max(g.minY, Math.min(g.vh - g.H - 4, g.vh - g.H - d.b))];
  }
  const tf = (p, extra) => `translate3d(${Math.round(p[0])}px, ${Math.round(p[1])}px, 0)${extra || ''}`;
  function place(p) { pos = [p[0], p[1]]; if (el) { el.style.setProperty('--w', `${geo().W}px`); el.style.transform = tf(pos); } }
  const clampP = (g, p) => [Math.max(6, Math.min(g.vw - g.W - 6, p[0])), Math.max(g.minY - 20, Math.min(g.vh - g.H - 6, p[1]))];

  // Raste: arc · zig-zag · loop-de-loop · pehle upar phir side (right→up) · hop-hop
  function path(from, to, style) {
    const g = geo(), [x0, y0] = from, [x1, y1] = to, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    let pts;
    switch (style) {
      case 'zigzag': pts = [from, [x0 + (x1 - x0) * 0.25, my - 90], [x0 + (x1 - x0) * 0.5, my + 70], [x0 + (x1 - x0) * 0.75, my - 70], to]; break;
      case 'loop': { const r = 70, c = [mx, my - 40]; pts = [from, [c[0], c[1] + r]]; for (let i = 1; i <= 6; i++) { const a = Math.PI / 2 + (i * Math.PI) / 3; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } pts.push(to); break; }
      case 'up': pts = [from, [x0, g.minY + 10], [x1, g.minY + 10], to]; break;
      case 'hop': pts = [from, [x0 + (x1 - x0) / 3, Math.min(y0, y1) - 110], [x0 + (x1 - x0) * 0.5, Math.max(y0, y1)], [x0 + (x1 - x0) * 2 / 3, Math.min(y0, y1) - 90], to]; break;
      default: pts = [from, [mx, Math.min(y0, y1) - 130], to];
    }
    return pts.map((p) => clampP(g, p));
  }
  async function fly(pts, ms, opts) {
    const o = opts || {};
    const last = pts[pts.length - 1];
    if (!el.animate || reduced() || !ms) { place(last); return; }
    const dx = last[0] - pts[0][0];
    el.style.setProperty('--lean', `${Math.max(-14, Math.min(14, dx / 40))}deg`);
    el.classList.add('moving');
    const frames = pts.map((p, i) => ({ transform: tf(p, o.spin ? ` rotate(${Math.round((-360 * i) / (pts.length - 1))}deg)` : ''), offset: i / (pts.length - 1) }));
    const a = el.animate(frames, { duration: ms, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' });
    await new Promise((r) => { a.onfinish = r; a.oncancel = r; });
    place(last);
    try { a.cancel(); } catch { /* ignore */ }
    el.classList.remove('moving');
  }

  function layoutBoard(g, side) {
    if (pipWin) { // 📌 pop-out: board poori chaudai me robot ke upar — saaf dikhe
      const bw = g.vw - 16;
      board.style.width = `${bw}px`;
      el.dataset.side = 'pip';
      const bh = board.offsetHeight;
      let top = -bh - 6;
      if (pos[1] + top < 8) top = 8 - pos[1];
      board.style.top = `${Math.round(top)}px`;
      board.style.left = `${Math.round(8 - pos[0])}px`;
      stick.style.cssText = 'display:none';
      return;
    }
    board.style.width = `${g.BW}px`;
    el.dataset.side = side;
    const bh = board.offsetHeight;
    // board seene ki height par; screen ke upar se bahar na jaye, neeche bhi na kate
    let bTop = g.W * 0.85 - bh;
    bTop = Math.max(bTop, g.minY - 8 - pos[1]);
    bTop = Math.min(bTop, g.vh - 8 - pos[1] - bh);
    board.style.top = `${Math.round(bTop)}px`;
    board.style.left = side === 'right' ? `${g.W + 10}px` : `${-g.BW - 10}px`;
    // haath (60° upar uthaya, CSS .holding) ka sira — danda yahin se board tak
    const aW = g.W * 0.196, aH = g.W * 0.292, aT = g.W * 0.8064, L = aH * 0.85;
    const px = side === 'right' ? g.W * 0.798 + aW * 0.3 : g.W * 0.006 + aW * 0.7, py = aT + aH * 0.08;
    const hx = side === 'right' ? px + L * 0.866 : px - L * 0.866, hy = py + L * 0.5;
    const bx = side === 'right' ? g.W + 26 : -26, by = Math.min(bTop + bh - 8, Math.max(bTop + 20, g.W * 0.85 - 6));
    const len = Math.hypot(bx - hx, by - hy), ang = Math.atan2(by - hy, bx - hx) * 180 / Math.PI;
    stick.style.cssText = `left:${hx}px;top:${hy}px;width:${len}px;transform:rotate(${ang}deg)`;
  }
  const sideFor = (g) => (pos[0] + g.W / 2 > g.vw / 2 ? 'left' : 'right');

  function typewriter() {
    const t = board.querySelector('.mc-type'); if (!t) return Promise.resolve();
    const s = t.dataset.text || '';
    if (reduced()) { t.textContent = s; return Promise.resolve(); }
    return new Promise((r) => {
      let i = 0; el.classList.add('talk');
      const step = () => { i += 1; t.textContent = s.slice(0, i); if (i < s.length) tw().setTimeout(step, 28); else { t.classList.add('done'); if (!talking) el.classList.remove('talk'); r(); } };
      step();
    });
  }
  function confetti(kind) {
    const fx = el.querySelector('.mc-fx'); if (!fx || reduced()) return;
    const set = kind === 'clap' ? ['👏', '👏', '🎉', '🏆', '⭐'] : kind === 'laugh' ? ['😂', '🤣', 'ha', 'HA', '😆'] : kind === 'sad' ? ['💧'] : kind === 'sleepy' ? ['💤', 'z', 'Z'] : kind === 'alert' ? ['❗', '⚠️'] : kind === 'curious' ? ['❔', '👀'] : ['🎉', '✨', '⭐', '🎊', '💥'];
    const n = kind === 'happy' || kind === 'excited' ? 14 : kind === 'clap' ? 20 : kind === 'laugh' ? 8 : 3;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.textContent = pick(set);
      s.style.setProperty('--tx', `${Math.round(rnd(-90, 90))}px`);
      s.style.setProperty('--ty', `${Math.round(rnd(-120, -40))}px`);
      s.style.setProperty('--r', `${Math.round(rnd(-180, 180))}deg`);
      s.style.animationDelay = `${(i * 0.06).toFixed(2)}s`;
      fx.appendChild(s);
      setTimeout(() => s.remove(), 2400);
    }
  }
  function dance(mood, ms) {
    el.dataset.mood = mood;
    el.classList.add('rest');
    confetti(mood);
    if (ms) setTimeout(() => { el.dataset.mood = current ? current.mood : ''; if (!current) el.classList.remove('rest'); }, ms);
  }
  function dot(on) { const d = el && el.querySelector('.mc-dot'); if (d) d.hidden = !on; }

  // ---------------------------------------------------------------- 📌 pop-out: har tab / WhatsApp ke upar
  // Chrome/Edge (desktop) Document Picture-in-Picture: chhoti "always on top" window — robot usme chala jaata
  // hai, to Chrome ke dusre tab, WhatsApp ya kisi bhi app par ho, robot upar tairta + updates batata rahega.
  let pipWin = null, pipClosedByUser = false, leavingPage = false;
  window.addEventListener('pagehide', () => { leavingPage = true; });
  function win() { return (el && el.ownerDocument && el.ownerDocument.defaultView) || window; }
  const pipOk = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;
  function note(t) { try { if (U.toast) U.toast(t, 'warn'); } catch { /* ignore */ } }
  async function popOut() {
    if (!pipOk()) { note('📌 Pop-out sirf Chrome / Edge (computer) me chalta hai'); return false; }
    if (pipWin) { try { pipWin.focus(); } catch { /* ignore */ } return true; }
    build();
    let w;
    try { w = await window.documentPictureInPicture.requestWindow({ width: 430, height: 620 }); } catch (e) { note('📌 Pop-out nahi khula — robot par click karke dobara try karo'); return false; }
    pipWin = w;
    const d = w.document;
    d.documentElement.className = `${document.documentElement.className} mc-pip`.replace('mc-on', '');
    [...document.documentElement.attributes].forEach((a) => { if (/^data-/.test(a.name)) d.documentElement.setAttribute(a.name, a.value); });
    d.title = '🤖 Gems — live updates';
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((n) => {
      if (n.tagName === 'LINK') { const l = d.createElement('link'); l.rel = 'stylesheet'; l.href = n.href; d.head.appendChild(l); } else d.head.appendChild(n.cloneNode(true));
    });
    const tip = d.createElement('div'); tip.className = 'mc-tip'; tip.textContent = '🤖 Gems live — har tab / app ke upar · band karne ko ✕ (window)'; d.body.appendChild(tip);
    if (skip) skip(); closeHist();
    d.body.appendChild(el);
    d.addEventListener('click', (e) => { if (mode === 'hist' && !el.contains(e.target)) closeHist(); });
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (mode === 'hist') closeHist(); else if (skip) skip(); } });
    w.addEventListener('resize', () => { if (mode === 'dock') place(dockPos()); });
    w.addEventListener('pagehide', () => {
      pipWin = null;
      if (skip) skip();
      document.body.appendChild(el);
      busy = false; mode = 'dock'; el.classList.remove('rest', 'holding', 'moving'); board.classList.remove('in', 'hist');
      place(dockPos()); applyOn();
      cfg.pip = false; save();
      if (!leavingPage) pipClosedByUser = true; // khud band kiya → is page load me dobara apne aap nahi
    });
    cfg.pip = true; save();
    applyOn();
    place(dockPos());
    dance('happy', 1800);
    schedule(2500);
    return true;
  }
  function popIn() { try { if (pipWin) pipWin.close(); } catch { /* ignore */ } }

  // ---------------------------------------------------------------- history board (bot par click)
  function openHist() {
    if (busy) return;
    mode = 'hist'; dot(false);
    const g = geo();
    board.innerHTML = histHtml();
    board.classList.add('hist');
    layoutBoard(g, sideFor(g));
    el.classList.add('rest', 'holding'); el.dataset.mood = 'info';
    setTimeout(() => board.classList.add('in'), 30);
  }
  function closeHist() {
    if (mode !== 'hist') return;
    board.classList.remove('in', 'hist');
    el.classList.remove('rest', 'holding'); el.dataset.mood = '';
    mode = 'dock';
  }

  // ---------------------------------------------------------------- announce one update
  async function show(it) {
    if (busy || !it) return '';
    busy = true; current = it; build(); closeHist();
    mode = 'show';
    const g = geo();
    el.dataset.mood = 'fly';
    board.innerHTML = boardHtml(it);
    board.classList.remove('in', 'hist');
    el.classList.remove('rest', 'talk');
    // jahan hai uske ulti taraf jao — left↔right, kabhi pehle upar
    const goLeft = pos[0] + g.W / 2 > g.vw / 2;
    board.style.width = `${g.BW}px`;
    const bh = board.offsetHeight || 170;
    const yLo = Math.min(g.maxY, g.minY + bh - g.W * 0.85 + 10);
    const rest = pipWin ? dockPos() : [goLeft ? 12 : g.vw - g.W - 12, Math.round(rnd(Math.min(yLo, g.maxY), g.maxY))];
    const style = pick(['arc', 'zigzag', 'loop', 'up', 'hop']);
    await fly(path(pos, rest, style), (it.fast || it.fun ? 1700 : 2400) + (style === 'loop' ? 900 : 300), { spin: style === 'loop' ? false : Math.random() < 0.25 });
    layoutBoard(g, pipWin ? 'pip' : goLeft ? 'right' : 'left');
    dance(it.mood);
    el.classList.add('holding');
    if (it.cls) el.classList.add(it.cls);
    board.classList.add('in');
    try { if (it.onShow) it.onShow(); } catch { /* ignore */ }
    if (!it.fun) { histAdd(it); pushRobot(it); } // masti/jokes history / push me nahi
    toExt(it);
    await wait(350);
    let reason = '';
    const ended = new Promise((res) => { skip = (why) => { reason = why || 'skip'; res(); }; });
    if (it.fx) confetti(it.fx);
    const spoken = typewriter().then(() => say(it.say)).then(async () => {
      if (it.view !== 'quiz') return;
      board.classList.add('quiz-run'); await wait(5000); // ⏳ sochne ka time
      board.classList.add('reveal'); dance('happy'); await say(it.sayAns);
    });
    const minStay = wait(it.stay || Math.max(10000, String(it.say || '').length * 60)); // kam se kam 10 sec board
    const stay = (async () => { await Promise.all([spoken, minStay]); while (hover && !reason) await wait(500); })();
    await Promise.race([stay, ended]);
    skip = null; stopSpeech();
    board.classList.remove('in'); el.classList.remove('holding');
    if (it.cls) el.classList.remove(it.cls);
    el.dataset.mood = 'fly';
    el.classList.remove('rest');
    await wait(250);
    await fly(path(pos, dockPos(), pick(['arc', 'hop'])), 1700);
    el.dataset.mood = ''; current = null; busy = false; hover = false; mode = 'dock';
    if (reason !== 'next' && !it.fun) dot(true); // history me naya hai
    return reason;
  }

  // ---------------------------------------------------------------- 📡 site ki har khabar (admin feeds)
  //  🔔 notifications (tag requests, search, login, anomaly…) · ⚙️ audit (settings / users / links…) ·
  //  👀 kaun online hai · 🆕 site version — har naya item ek baar board par, history me bhi.
  const AUDIT_TXT = {
    settings_update: '⚙️ Settings badli', user_create: '👤 Naya user bana', user_update: '👤 User update hua', user_delete: '🗑 User hata',
    password_changed: '🔑 Password badla', announcement: '📣 Announcement', backup_export: '💾 Backup export', email_test: '✉️ Test email',
    link_assign: '🔗 Link assign', link_create: '🔗 Naya link', link_revoke: '⛔ Link revoke', link_toggle: '🔗 Link on/off', link_update: '🔗 Link update',
    live_assist_accept: '🤝 Live assist accept', live_assist_decline: '🙅 Live assist decline', live_assist_end: '🤝 Live assist khatam', live_assist_request: '🆘 Live assist request',
    public_tag_form_config: '📝 Tag form config', saved_view_created: '⭐ Saved view bana', saved_view_deleted: '🗑 Saved view hata',
    tag_request_bulk_status: '🏷 Tag requests bulk status', tag_request_created: '🏷 Naya tag request', tag_request_deleted: '🗑 Tag request delete',
    tag_request_recovered: '♻️ Tag request wapas', tag_request_updated: '🏷 Tag request update', tag_sheet_config: '📄 Tag sheet config', tag_sheet_push: '📤 Tag sheet push'
  };
  const emo = (s) => { const m = String(s || '').match(/^\s*(\p{Extended_Pictographic}️?)/u); return m ? m[1] : ''; };
  const noEmo = (s) => String(s || '').replace(/^\s*\p{Extended_Pictographic}️?\s*/u, '');
  const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const tm = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''; };
  const queued = new Set();
  function enqueue(it) { if (!it || queued.has(it.id)) return; queued.add(it.id); prio.push(it); if (prio.length > 40) prio.splice(0, prio.length - 40); }
  const api = (p) => (FF.auth && FF.auth.api ? FF.auth.api(p) : Promise.reject(new Error('no api')));
  const firstRun = (k) => !cfg[k];
  async function pollFeeds() {
    if (!allowed() || !cfg.on || document.hidden) return;
    const cutoff = Date.now() - 30 * 60e3; // pehli baar: sirf pichle 30 min ka
    // 🔔 notifications
    try {
      const r = await api('/api/notifications');
      const last = Date.parse(cfg.lastNotif || '') || 0;
      const fresh = (r && r.items || []).filter((x) => { const t = Date.parse(x.createdAt) || 0; return t > last && (last || t > cutoff); })
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      const top = (r && r.items || []).reduce((m, x) => Math.max(m, Date.parse(x.createdAt) || 0), last);
      if (top) cfg.lastNotif = new Date(top).toISOString();
      (firstRun('notifInit') ? fresh.slice(-3) : fresh).forEach((x) => {
        const ic = emo(x.title) || '🔔';
        const link = x.meta && x.meta.link ? String(x.meta.link) : '';
        enqueue({
          id: `n:${x.id}`, key: `notif:${x.id}`, mood: /delete|fail|error|alert|drop|girawat|⚠|❌|🚨/i.test(x.title + x.type) ? 'alert' : x.type === 'search' ? 'curious' : 'excited',
          icon: ic, title: clip(noEmo(x.title), 46) || 'Naya alert', head: clip(x.body || x.title, 160), view: 'text', foot: `🔔 ${tm(x.createdAt)}`,
          say: clip(`${noEmo(x.title)}. ${x.body || ''}`, 220), q: link && link[0] === '#' ? link : '@notif', fast: true
        });
      });
      cfg.notifInit = 1;
    } catch { /* login nahi */ }
    // ⚙️ audit (admin)
    try {
      const r = await api('/api/audit');
      const last = Date.parse(cfg.lastAudit || '') || 0;
      const fresh = (r && r.entries || []).filter((x) => { const t = Date.parse(x.at) || 0; return t > last && (last || t > cutoff); })
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const top = (r && r.entries || []).reduce((m, x) => Math.max(m, Date.parse(x.at) || 0), last);
      if (top) cfg.lastAudit = new Date(top).toISOString();
      (firstRun('auditInit') ? fresh.slice(-3) : fresh).forEach((x) => {
        const lbl = AUDIT_TXT[x.action] || `⚙️ ${String(x.action || 'change').replace(/_/g, ' ')}`;
        enqueue({
          id: `a:${x.at}:${x.action}:${x.target}`, key: `audit:${x.at}:${x.action}`, mood: /delete|revoke|decline/.test(x.action) ? 'alert' : 'info',
          icon: emo(lbl) || '⚙️', title: noEmo(lbl), head: clip(`${x.actor || 'koi'} ne ${x.target ? `"${x.target}" ` : ''}${noEmo(lbl).toLowerCase()}${x.note ? ` — ${x.note}` : ''}`, 160),
          view: 'text', foot: `📜 Audit · ${tm(x.at)}`, say: clip(`${x.actor || 'Kisi'} ne ${noEmo(lbl)}. ${x.note || ''}`, 200), q: '#/settings?tab=audit', fast: true
        });
      });
      cfg.auditInit = 1;
    } catch { /* admin nahi */ }
    // 👀 online log (sirf jab list badle)
    try {
      const r = await api('/api/presence'); presCache = { at: Date.now(), people: (r && r.people) || [] };
      const on = (r && r.people || []).filter((x) => x.active).map((x) => x.name || x.username).filter(Boolean);
      const me = FF.auth && FF.auth.user ? (FF.auth.user.name || FF.auth.user.username) : '';
      const others = on.filter((n) => n !== me);
      const sig = others.slice().sort().join('|');
      if (sig !== (cfg.onlineSig || '')) {
        const prev = new Set(String(cfg.onlineSig || '').split('|').filter(Boolean));
        const joined = others.filter((n) => !prev.has(n));
        cfg.onlineSig = sig;
        if (joined.length) {
          enqueue({
            id: `p:${sig}:${Date.now()}`, key: `online:${sig}`, mood: 'happy', icon: '👀', title: 'Site par kaun aaya', view: 'list',
            head: `${joined.slice(0, 2).join(', ')}${joined.length > 2 ? ` +${joined.length - 2}` : ''} abhi online aaye`,
            rows: others.slice(0, 5).map((n) => ({ name: n, sub: joined.includes(n) ? 'abhi aaye' : 'pehle se online', val: '🟢', tone: 'chip' })),
            foot: `Total online: ${others.length}`, say: `${joined.slice(0, 3).map(nm).join(', ')} अभी साइट पर आए हैं।`, q: '#/settings?tab=users', fast: true
          });
        }
      }
    } catch { /* admin only */ }
    // 🆕 site version
    try {
      const r = await api('/api/version');
      const v = r && r.version ? String(r.version) : '';
      if (v && cfg.lastVer && v !== cfg.lastVer) {
        enqueue({ id: `v:${v}`, key: `ver:${v}`, mood: 'excited', icon: '🚀', title: 'Site update aaya!', head: `Naya version live: ${v.replace(/^apnapayment-/, '')} — page refresh karo to naye features milenge`, view: 'text', say: 'साइट का नया वर्ज़न आ गया है। एक बार रिफ्रेश कर लो।', q: '', fast: true });
      }
      if (v) cfg.lastVer = v;
    } catch { /* ignore */ }
    save();
  }

  // ---------------------------------------------------------------- 🎭 masti: jab koi nayi khabar nahi
  const JOKES = [
    ['🤖', 'Robot ka sach', 'Main kabhi chhutti nahi leta… kyunki mujhe leave form bharna hi nahi aata 😅', 'मैं कभी छुट्टी नहीं लेता… क्योंकि मुझे लीव फ़ॉर्म भरना ही नहीं आता! हा हा हा!'],
    ['🏷', 'FASTag gyaan', 'Toll par sabse fast kaun? FASTag wala… aur dashboard par? Main! 🏎️', 'टोल पर सबसे फ़ास्ट कौन? फ़ास्टैग वाला… और डैशबोर्ड पर? मैं!'],
    ['📈', 'Motivation', 'Growth graph aur gym — dono me roz thoda upar jaana padta hai 💪', 'ग्रोथ ग्राफ़ और जिम — दोनों में रोज़ थोड़ा ऊपर जाना पड़ता है!'],
    ['☕', 'Chai break?', 'Data load ho raha hai… tab tak ek chai ho jaye? Main battery charge kar leta hoon 🔋', 'डेटा लोड हो रहा है… तब तक एक चाय हो जाए? मैं बैटरी चार्ज कर लेता हूँ।'],
    ['🕺', 'Dance time', 'Jab VC4 badhta hai, main aise naachta hoon! Dekho dekho 🎶', 'जब वी सी 4 बढ़ता है, मैं ऐसे नाचता हूँ! देखो देखो!'],
    ['🧮', 'Robot maths', 'Ek agent + ek call = do guna tag. Ye formula maine khud banaya 🤓', 'एक एजेंट प्लस एक कॉल, बराबर दो गुना टैग। ये फ़ॉर्मूला मैंने ख़ुद बनाया!'],
    ['😴', 'Inactive agents ke liye', 'Neend achhi cheez hai… par mahine ke end me nahi! ⏰', 'नींद अच्छी चीज़ है… पर महीने के एंड में नहीं!'],
    ['🎯', 'Target', 'Target door lag raha hai? Main to roz udd ke jaata hoon, aap bhi chalo! 🚀', 'टारगेट दूर लग रहा है? मैं तो रोज़ उड़ के जाता हूँ, आप भी चलो!'],
    ['📦', 'Stock tip', 'Stock khatam hone se pehle dispatch — warna main udaas ho jaata hoon 🥺', 'स्टॉक ख़त्म होने से पहले डिस्पैच — वरना मैं उदास हो जाता हूँ।'],
    ['🦾', 'Boss alert', 'Boss online hai — sab log seedhe baith jao! 😎', 'बॉस ऑनलाइन है — सब लोग सीधे बैठ जाओ! हा हा!']
  ];
  function joke() {
    const i = (Number(cfg.jk) || 0) % JOKES.length; cfg.jk = i + 1; save();
    const [icon, title, head, hi] = JOKES[i];
    return { key: `joke:${i}`, mood: 'laugh', icon, title, head, view: 'text', fun: true, stay: 7000, say: hi };
  }
  const DANCE = ['disco', 'moonwalk', 'spinjump', 'peek', 'nap', 'robot', 'wave'];
  async function funAct() {
    const g = geo();
    const a = DANCE[(Number(cfg.dn) || 0) % DANCE.length]; cfg.dn = (Number(cfg.dn) || 0) + 1; save();
    busy = true; mode = 'fun';
    const go = async (to, style, ms) => { el.dataset.mood = 'fly'; el.classList.remove('rest'); await fly(path(pos, to, style), ms || 2200); };
    const home = async () => { await go(dockPos(), 'arc', 1800); };
    const act = async (cls, ms, mood) => { el.dataset.mood = mood || 'happy'; el.classList.add('rest', cls); confetti(mood || 'happy'); await wait(ms); el.classList.remove(cls); };
    try {
      if (a === 'disco') { await go([rnd(g.vw * 0.25, g.vw * 0.7), g.maxY], 'loop', 2600); await act('mc-disco', 4200, 'excited'); }
      else if (a === 'moonwalk') {
        const y = g.maxY, left = pos[0] > g.vw / 2;
        await go([left ? g.vw - g.W - 20 : 20, y], 'hop', 1600);
        el.classList.add('rest', 'mc-moon'); el.dataset.mood = 'happy';
        await fly([pos, [left ? g.vw * 0.35 : g.vw * 0.6, y]], 3800); el.classList.remove('mc-moon');
      } else if (a === 'spinjump') { await go([rnd(g.vw * 0.2, g.vw * 0.8), rnd(g.minY + 80, g.maxY)], 'zigzag', 2400); await act('mc-spin', 2600, 'excited'); }
      else if (a === 'peek') {
        const right = Math.random() < 0.5, y = rnd(g.minY + 60, g.maxY);
        await go([right ? g.vw - g.W * 0.45 : -g.W * 0.55, y], 'arc', 2200);
        await act(right ? 'mc-peek-r' : 'mc-peek-l', 3600, 'curious');
      } else if (a === 'nap') { await act('mc-nap', 4200, 'sleepy'); el.dataset.mood = 'alert'; confetti('alert'); await act('mc-startle', 900, 'alert'); }
      else if (a === 'robot') { await go([rnd(g.vw * 0.3, g.vw * 0.7), rnd(g.minY + 80, g.maxY)], 'up', 2600); await act('mc-robot', 4000, 'happy'); }
      else { await act('mc-wave', 2600, 'happy'); }
      if (a !== 'nap' && a !== 'wave') await home();
    } finally { el.classList.remove('rest'); el.dataset.mood = ''; busy = false; mode = 'dock'; }
  }

  // ---------------------------------------------------------------- scheduler
  function allowed() { try { return !!(FF.auth && FF.auth.isAdmin && FF.auth.isAdmin()); } catch { return false; } }
  function blocked(soft) {
    if (!cfg.on || !allowed()) return true;
    if (!soft && cfg.snoozeDay === today()) return true;
    if (pipWin) return false; // 📌 pop-out window me: dusre tab / WhatsApp par bhi chalta rahe
    if (document.hidden) return true;
    if (document.body.classList.contains('no-scroll')) return true; // modal/drawer khula hai
    const ask = document.getElementById('ask-panel');
    if (ask && !ask.hidden) return true;
    return false;
  }
  function nextItem(force) {
    if (prio.length) return prio.shift();
    const list = insights();
    // jo baat pichle 3 ghante me bata chuka (same numbers) wo dobara nahi
    for (let k = 0; k < list.length; k++) {
      const i = ((Number(cfg.idx) || 0) + k) % list.length;
      if (force || !saidWithin(list[i], 3 * 3600e3)) { cfg.idx = i + 1; save(); return list[i]; }
    }
    return null;
  }
  const gapMs = () => Math.max(10, Number(cfg.everySec) || 10) * 1e3;
  let timerWin = window;
  function schedule(ms) {
    try { timerWin.clearTimeout(timer); } catch { /* window band */ }
    timerWin = tw();
    timer = timerWin.setTimeout(tick, ms == null ? gapMs() : ms);
  }
  // 🧩 Chrome extension "Gems Robot" laga ho → baaki saare tabs par sirf robot (bina window); ye tab dimaag
  const extOn = () => document.documentElement.dataset.ffRobotExt === '1';
  function toExt(it) {
    if (!extOn() || !it) return;
    const slim = { key: it.key, mood: it.mood, icon: it.icon, title: it.title, head: it.head, view: it.view, big: it.big, prog: it.prog, foot: it.foot, q: it.q, fun: !!it.fun, stay: it.stay, quiz: it.quiz, fx: it.fx, cls: it.cls,
      rows: (it.rows || []).slice(0, 7).map((r) => ({ name: r.name, sub: r.sub, val: r.val, w: r.w, tone: r.tone })) };
    try { window.postMessage({ source: 'ff-robot-page', msg: { type: 'show', item: slim } }, location.origin); } catch { /* ignore */ }
  }
  let extTurn = 0;
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'ff-robot-ext' || !e.data.msg) return;
    const m = e.data.msg;
    if (m.type === 'open') { runQ(m.q || ''); return; }
    if (m.type === 'pull') {
      if (!cfg.on || !allowed() || cfg.snoozeDay === today() || pipWin) return;
      extTurn += 1;
      const it = nextItem(false) || (cfg.fun !== false && extTurn % 2 ? joke() : null);
      if (!it) return;
      try { if (it.onShow) it.onShow(); } catch { /* ignore */ }
      if (!it.fun) { histAdd(it); dot(true); pushRobot(it); }
      toExt(it);
      if (cfg.sound) say(it.say);
    }
  });
  let lastNote = 0;
  async function notifyHidden() {
    try {
      if (cfg.push !== false) { // server push (app + web dono) — local notification ki zarurat nahi
        if (Date.now() - lastNote < Math.max(30e3, gapMs())) return;
        const it = nextItem(false); if (!it || it.fun) return;
        lastNote = Date.now();
        try { if (it.onShow) it.onShow(); } catch { /* ignore */ }
        histAdd(it); pushRobot(it); dot(true);
        return;
      }
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (Date.now() - lastNote < Math.max(60e3, gapMs())) return;
      const it = nextItem(false); if (!it) return;
      lastNote = Date.now();
      try { if (it.onShow) it.onShow(); } catch { /* ignore */ }
      if (!it.fun) histAdd(it);
      const lines = (it.rows || []).slice(0, 5).map((r) => `• ${r.name}${r.val ? ` — ${r.val}` : ''}`).join('\n');
      const body = `${it.big ? `${it.big} · ` : ''}${it.head || ''}${lines ? `\n${lines}` : ''}`.slice(0, 400);
      const opts = { body, icon: ASSET('robot.png'), badge: ASSET('robot.png'), tag: `ff-robot-${it.key}`, renotify: true, data: { link: it.q && it.q[0] === '#' ? it.q : '#/', robot: 1 } };
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await reg.showNotification(`🤖 ${it.icon || ''} ${it.title}`.trim(), opts); else new Notification(`🤖 ${it.title}`, opts);
      dot(true);
      if (cfg.sound) say(it.say);
    } catch { /* ignore */ }
  }
  // 📌 site par pehla click → robot apne aap pop-out window me (browser click ke bina window kholne nahi deta)
  function armAutoPip() {
    const go = () => {
      if (!cfg.on || !allowed() || cfg.autoPip === false || pipWin || pipClosedByUser || !pipOk() || extOn()) return; // extension hai to window ki zarurat nahi
      popOut();
    };
    const once = (e) => {
      if (e.isTrusted === false) return;
      if (el && el.contains(e.target)) return; // robot ke apne buttons
      try { if ('Notification' in window && Notification.permission === 'default' && cfg.notify !== false) Notification.requestPermission().catch(() => {}); } catch { /* ignore */ }
      go();
    };
    document.addEventListener('pointerup', once, true);
    document.addEventListener('keydown', once, true);
    // Chrome (naye version) tab badalne par khud PiP de sakta hai — mil gaya to badhiya
    try { navigator.mediaSession && navigator.mediaSession.setActionHandler('enterpictureinpicture', () => { if (!pipWin && cfg.on && allowed() && cfg.autoPip !== false) popOut(); }); } catch { /* unsupported */ }
  }

  let funTurn = 0, lastUpd = 0;
  async function tick(force) {
    applyOn();
    if (busy || mode === 'hist') return schedule(4e3);
    // 🔔 site ka tab peeche (dusra tab / WhatsApp) aur pop-out nahi → system notification se update
    if (!force && document.hidden && !pipWin && extOn()) return schedule(30e3); // extension har 30 sec "pull" karta hai
    if (!force && document.hidden && !pipWin && cfg.on && allowed() && cfg.notify !== false && cfg.snoozeDay !== today()) { await notifyHidden(); return schedule(60e3); }
    if (!force && blocked()) return schedule(15e3);
    if (!FF.smartQ && FF.lazy && FF.lazy.inject) { try { await FF.lazy.inject('smartQ'); } catch { /* optional */ } }
    // update ka time (default 10 sec) ho gaya → agli khabar; beech ka time masti me, kabhi khaali khada nahi
    const due = force || Date.now() - lastUpd >= gapMs();
    const it = due ? nextItem(force) : null;
    if (it) { const why = await show(it); lastUpd = Date.now(); return schedule(why === 'next' ? 600 : 1500); }
    if (cfg.fun !== false) {
      funTurn += 1;
      if (funTurn % 4 === 0) await show(joke()); else await funAct();
      return schedule(1500);
    }
    if (cfg.roam !== false) { await funAct(); return schedule(4000); }
    schedule();
  }

  // ---------------------------------------------------------------- public (Settings → 🔔 Sound → 🤖 Robot dost)
  function now(force) {
    if (busy || !allowed()) return;
    cfg.on = true; cfg.snoozeDay = ''; save(); build(); applyOn();
    clearTimeout(timer); tick(force !== false);
  }
  function toggle(on) {
    cfg.on = on == null ? !cfg.on : !!on; if (cfg.on) cfg.snoozeDay = ''; save(); build(); applyOn();
    if (cfg.on) schedule(1500); else if (skip) skip();
    return cfg.on;
  }
  function setCfg(o) {
    Object.assign(cfg, o || {});
    if (o && 'on' in o && o.on) cfg.snoozeDay = '';
    save(); build(); applyOn();
    if (!cfg.on && skip) skip();
    if (o && ('everySec' in o || 'on' in o)) schedule(1500);
    return getCfg();
  }
  const getCfg = () => ({ on: !!cfg.on, sound: !!cfg.sound, everySec: Number(cfg.everySec) || 10, roam: cfg.roam !== false, fun: cfg.fun !== false, autoPip: cfg.autoPip !== false, notify: cfg.notify !== false, push: cfg.push !== false });
  function clearHistory() { histSave([]); dot(false); }
  FF.mascot = { _sp: toSpeech, _show: (it) => show(it), now, toggle, setCfg, popOut, popIn, pipOk, get popped() { return !!pipWin; }, getCfg, allowed, clearHistory, history: histLoad, openHistory: () => { build(); openHist(); }, get on() { return cfg.on; }, get sound() { return cfg.sound; }, setSound(v) { cfg.sound = !!v; save(); }, insights, pollFeeds };

  const start = () => {
    // sirf admin ko — login/auth ready hone tak check karte raho
    let tries = 0;
    const boot = () => {
      if (!allowed()) { applyOn(); if (++tries < 90) setTimeout(boot, 2000); return; }
      build();
      // 👋 pehli mulaqat: haath hila ke namaste (din me ek baar)
      const u = FF.auth && FF.auth.user ? String(FF.auth.user.name || FF.auth.user.username || '').split(/\s+/)[0] : '';
      if (cfg.greetDay !== today()) {
        cfg.greetDay = today(); save();
        setTimeout(() => { if (!busy && !blocked()) show({ key: 'greet', fun: true, cls: 'greet', mood: 'happy', icon: '👋', title: `Namaste ${u}!`.trim(), head: 'Main Gems hoon — aaj site ki har khabar main board par dunga 😎', view: 'text', stay: 5500, say: `नमस्ते ${nm(u)}! मैं जेम्स हूँ। आज साइट की हर ख़बर मैं दूँगा।` }); }, 2500);
      }
      schedule(9e3);
      setTimeout(checkVersions, 12e3);
      setInterval(checkVersions, 10 * 60e3);
      setTimeout(pollFeeds, 4e3);
      setInterval(pollFeeds, 30e3);
      armAutoPip();
      setTimeout(refreshExtras, 15e3);
      setInterval(refreshExtras, 5 * 60e3);
      window.addEventListener('ff:data-fresh', () => setTimeout(checkVersions, 3000));
    };
    boot();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window.FF);
