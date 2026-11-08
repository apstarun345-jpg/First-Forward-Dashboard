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
  const nm = (s) => String(s || '').toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
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
        kycCache.at = Date.now();
      } catch { /* ignore */ }
    }
  }

  function insights() {
    const out = [];
    BUILDERS.forEach((b) => { try { const x = b(); if (x) out.push(x); } catch { /* data abhi nahi */ } });
    return out;
  }

  // "🆕 naya data aaya" — server ke daily versions se
  const prio = [];
  async function checkVersions() {
    try {
      if (!FF.data || !FF.data.versions) return;
      const v = await FF.data.versions(true);
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
  function toSpeech(text) {
    let t = String(text || '').replace(/\p{Extended_Pictographic}️?/gu, ' ').replace(/[·|•→]/g, ', ');
    t = t.replace(/\bVC\s?5\+/gi, 'वी सी 5 प्लस').replace(/\bVC\s?(\d+)/gi, 'वी सी $1').replace(/\bTLs?\b/g, 'टी एल').replace(/\bKYC\b/gi, 'के वाई सी')
      .replace(/(\d)\s?%/g, '$1 प्रतिशत').replace(/\+(\d)/g, 'प्लस $1').replace(/[−–-](\d)/g, ' माइनस $1')
      .replace(/(\d{4})-(\d{2})-(\d{2})/g, (m, y, mo, d) => `${Number(d)} ${['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'][Number(mo) - 1] || ''}`);
    // ALL CAPS naam → Title case (warna voice R-A-H-U-L padhti hai)
    t = t.replace(/\b[A-Z]{3,}\b/g, (w) => (/^(GV|FF|IDFC|NHAI|VRN)$/.test(w) ? w.split('').join(' ') : w[0] + w.slice(1).toLowerCase()));
    t = t.replace(/\b[A-Za-z]+\b/g, (w) => HI[w.toLowerCase()] || w);
    return t.replace(/\s+/g, ' ').trim();
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
      const parts = toSpeech(text).split(/(?<=[।.!?])\s+/).filter(Boolean); // chhote vaakya → Chrome beech me nahi katta
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
          u.rate = Number(p.rate) > 0 ? Math.min(1.15, Number(p.rate)) : 0.98;
          u.pitch = Math.min(1.4, (Number(p.pitch) > 0 ? Number(p.pitch) : 1) * 1.12); // thodi pyaari robot awaaz
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
      const step = () => { i += 1; t.textContent = s.slice(0, i); if (i < s.length) tw().setTimeout(step, 28); else { if (!talking) el.classList.remove('talk'); r(); } };
      step();
    });
  }
  function confetti(kind) {
    const fx = el.querySelector('.mc-fx'); if (!fx || reduced()) return;
    const set = kind === 'laugh' ? ['😂', '🤣', 'ha', 'HA', '😆'] : kind === 'sad' ? ['💧'] : kind === 'sleepy' ? ['💤', 'z', 'Z'] : kind === 'alert' ? ['❗', '⚠️'] : kind === 'curious' ? ['❔', '👀'] : ['🎉', '✨', '⭐', '🎊', '💥'];
    const n = kind === 'happy' || kind === 'excited' ? 14 : kind === 'laugh' ? 8 : 3;
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
  let pipWin = null;
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
    if (!it.fun) histAdd(it); // masti/jokes history me nahi
    await wait(350);
    let reason = '';
    const ended = new Promise((res) => { skip = (why) => { reason = why || 'skip'; res(); }; });
    const spoken = typewriter().then(() => say(it.say));
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
      const r = await api('/api/presence');
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
  let funTurn = 0, lastUpd = 0;
  async function tick(force) {
    applyOn();
    if (busy || mode === 'hist') return schedule(4e3);
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
  const getCfg = () => ({ on: !!cfg.on, sound: !!cfg.sound, everySec: Number(cfg.everySec) || 10, roam: cfg.roam !== false, fun: cfg.fun !== false });
  function clearHistory() { histSave([]); dot(false); }
  FF.mascot = { now, toggle, setCfg, popOut, popIn, pipOk, get popped() { return !!pipWin; }, getCfg, allowed, clearHistory, history: histLoad, openHistory: () => { build(); openHist(); }, get on() { return cfg.on; }, get sound() { return cfg.sound; }, setSound(v) { cfg.sound = !!v; save(); }, insights, pollFeeds };

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
      setTimeout(refreshExtras, 15e3);
      setInterval(refreshExtras, 5 * 60e3);
      window.addEventListener('ff:data-fresh', () => setTimeout(checkVersions, 3000));
    };
    boot();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window.FF);
