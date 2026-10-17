/* 🪔 v197 — Festival splash. "Opening your workspace" screen par tyohaar ke hisaab se animated greeting
   (Happy Diwali, Holi, Eid, Navratri, Christmas …) — tyohaar aane se pehle (countdown) aur aane ke baad bhi.
   Tez rakhne ke liye: bina image / library ke — sirf emoji + CSS transform/opacity animation; CSS tabhi inject hoti hai jab koi tyohaar active ho.
   index.html me #app-boot ke turant baad sync chalta hai (paint se pehle). Preview: ?fest=diwali  ·  band: localStorage ff_fest = off. */
(function () {
  'use strict';
  try {
    var boot = document.getElementById('app-boot');
    if (!boot) return;
    var off = '';
    try { off = localStorage.getItem('ff_fest') || ''; } catch (e) { /* storage blocked */ }
    if (off === 'off') return;

    // ── Tyohaar ke rang / text / emoji ──────────────────────────────────────────────────────────
    // n=naam, g=greeting, s=sub-line, e=bada emoji, a/b=title gradient, t=glow rang, p=particles, m=motion, L=diya-row
    var F = {
      newyear:   { n: 'New Year', g: 'Happy New Year', s: 'Naya saal, nayi shuruaat — safalta aur khushiyon se bhara ho!', e: '🎆', a: '#fde047', b: '#38bdf8', t: '250,204,21', p: ['🎉', '✨', '🎊', '🥳', '⭐'], m: 'fall' },
      lohri:     { n: 'Lohri', g: 'Happy Lohri', s: 'Alaav ki garmi, rewdi-gajak ki mithaas — Lohri di lakh lakh vadhaiyan!', e: '🔥', a: '#fb923c', b: '#facc15', t: '249,115,22', p: ['🔥', '✨', '🌾', '🍿'], m: 'rise' },
      sankranti: { n: 'Makar Sankranti', g: 'Happy Makar Sankranti', s: 'Til-gud khao, meetha bolo — patang udao, khushiyan failao!', e: '🪁', a: '#facc15', b: '#fb7185', t: '250,204,21', p: ['🪁', '🌾', '☀️', '✨'], m: 'rise' },
      republic:  { n: 'Republic Day', g: 'Happy Republic Day', s: 'Jai Hind! Gantantra diwas ki hardik shubhkamnayein.', e: '🇮🇳', a: '#fb923c', b: '#4ade80', t: '34,197,94', p: ['🇮🇳', '✨', '🧡', '💚'], m: 'fall', tri: 1 },
      vasant:    { n: 'Vasant Panchami', g: 'Happy Vasant Panchami', s: 'Maa Saraswati ki kripa se gyaan aur safalta mile.', e: '🌼', a: '#fde047', b: '#f59e0b', t: '250,204,21', p: ['🌼', '🌻', '🪷', '✨'], m: 'fall' },
      shivratri: { n: 'Maha Shivratri', g: 'Har Har Mahadev', s: 'Maha Shivratri ki hardik shubhkamnayein 🔱', e: '🔱', a: '#a5b4fc', b: '#67e8f9', t: '99,102,241', p: ['🔱', '🕉️', '✨', '🌙'], m: 'twinkle' },
      holi:      { n: 'Holi', g: 'Happy Holi', s: 'Rang barse! Holi ke rang aapki zindagi khushiyon se bhar dein.', e: '🎨', a: '#f472b6', b: '#22d3ee', t: '236,72,153', p: ['🎨', '💦', '🌈', '🎈', '✨'], m: 'fall', col: 1 },
      ugadi:     { n: 'Ugadi / Gudi Padwa', g: 'Happy Ugadi · Gudi Padwa', s: 'Naye saal ki mangalkamnayein — sukh, samriddhi aur shanti ho.', e: '🌿', a: '#a3e635', b: '#fde047', t: '132,204,22', p: ['🌿', '🌼', '🥭', '✨'], m: 'fall' },
      eidfitr:   { n: 'Eid', g: 'Eid Mubarak', s: 'Eid-ul-Fitr ki dili mubarakbaad — khushiyan aur barkatein mubarak!', e: '🌙', a: '#fde68a', b: '#5eead4', t: '45,212,191', p: ['🌙', '⭐', '✨', '🕌'], m: 'twinkle' },
      ramnavami: { n: 'Ram Navami', g: 'Jai Shri Ram', s: 'Ram Navami ki hardik shubhkamnayein 🏹', e: '🏹', a: '#fb923c', b: '#fde047', t: '249,115,22', p: ['🏹', '🚩', '✨', '🪔'], m: 'rise' },
      mahavir:   { n: 'Mahavir Jayanti', g: 'Happy Mahavir Jayanti', s: 'Ahimsa parmo dharma — shanti aur karuna ka sandesh.', e: '🙏', a: '#fde68a', b: '#fb923c', t: '250,204,21', p: ['🙏', '🪷', '✨'], m: 'twinkle' },
      baisakhi:  { n: 'Baisakhi', g: 'Happy Baisakhi', s: 'Fasal ki khushi, nachte-gaate Baisakhi manao — vadhaiyan ji!', e: '🌾', a: '#facc15', b: '#fb923c', t: '250,204,21', p: ['🌾', '🥁', '✨', '🌻'], m: 'fall' },
      akshaya:   { n: 'Akshaya Tritiya', g: 'Happy Akshaya Tritiya', s: 'Sone si chamak, akshay samriddhi aapke saath rahe 🪙', e: '🪙', a: '#fde047', b: '#f59e0b', t: '250,204,21', p: ['🪙', '✨', '🌟', '💛'], m: 'fall' },
      buddha:    { n: 'Buddha Purnima', g: 'Happy Buddha Purnima', s: 'Shanti, karuna aur gyaan ka prakash sab par barse.', e: '☸️', a: '#fde68a', b: '#f0abfc', t: '250,204,21', p: ['☸️', '🪷', '✨', '🌕'], m: 'twinkle' },
      eidadha:   { n: 'Bakrid', g: 'Eid ul-Adha Mubarak', s: 'Bakrid ki dili mubarakbaad — tyaag aur khushiyon ka tyohaar.', e: '🌙', a: '#fde68a', b: '#5eead4', t: '45,212,191', p: ['🌙', '⭐', '✨', '🕌'], m: 'twinkle' },
      rath:      { n: 'Rath Yatra', g: 'Jai Jagannath', s: 'Rath Yatra ki hardik shubhkamnayein 🛕', e: '🛕', a: '#fb923c', b: '#fde047', t: '249,115,22', p: ['🛕', '🚩', '🌼', '✨'], m: 'rise' },
      guru:      { n: 'Guru Purnima', g: 'Happy Guru Purnima', s: 'Guru ke charno me naman — aapka margdarshan hamari taakat hai.', e: '🙏', a: '#fde68a', b: '#fb923c', t: '250,204,21', p: ['🙏', '🪷', '✨', '🌕'], m: 'twinkle' },
      independence: { n: 'Independence Day', g: 'Happy Independence Day', s: 'Jai Hind! Azaadi ka tyohaar — tiranga hamari shaan hai.', e: '🇮🇳', a: '#fb923c', b: '#4ade80', t: '34,197,94', p: ['🇮🇳', '🪁', '✨', '🧡', '💚'], m: 'rise', tri: 1 },
      onam:      { n: 'Onam', g: 'Happy Onam', s: 'Onashamsakal! Pookalam jaisi rangeen khushiyan aapke saath.', e: '🌸', a: '#fde047', b: '#fb7185', t: '251,113,133', p: ['🌸', '🌼', '🍌', '✨'], m: 'fall' },
      rakhi:     { n: 'Raksha Bandhan', g: 'Happy Raksha Bandhan', s: 'Bhai-behen ke pyaar ka tyohaar — Rakhi ki hardik badhai!', e: '🎀', a: '#f9a8d4', b: '#fde047', t: '244,114,182', p: ['🎀', '💖', '✨', '🌸'], m: 'fall' },
      janmashtami: { n: 'Janmashtami', g: 'Jai Shri Krishna', s: 'Janmashtami ki hardik shubhkamnayein — Hare Krishna! 🦚', e: '🦚', a: '#60a5fa', b: '#fde047', t: '59,130,246', p: ['🦚', '🪈', '🎶', '✨', '🥛'], m: 'rise' },
      ganesh:    { n: 'Ganesh Chaturthi', g: 'Ganpati Bappa Morya', s: 'Ganesh Chaturthi ki shubhkamnayein — vighnaharta sab vighna door karein 🐘', e: '🐘', a: '#fb923c', b: '#facc15', t: '249,115,22', p: ['🐘', '🌺', '🪔', '✨', '🥥'], m: 'fall' },
      gandhi:    { n: 'Gandhi Jayanti', g: 'Gandhi Jayanti', s: 'Satya aur ahimsa ke path par — Bapu ko naman 🙏', e: '🕊️', a: '#e2e8f0', b: '#fde68a', t: '148,163,184', p: ['🕊️', '✨', '🌿'], m: 'twinkle' },
      navratri:  { n: 'Navratri', g: 'Shubh Navratri', s: 'Jai Mata Di! Maa Durga ki kripa aap par bani rahe 🔱', e: '🔱', a: '#fb7185', b: '#fde047', t: '244,63,94', p: ['🔱', '🌺', '🪔', '✨', '💃'], m: 'rise' },
      dussehra:  { n: 'Dussehra', g: 'Happy Dussehra', s: 'Burai par achchai ki jeet — Vijayadashami ki hardik shubhkamnayein 🏹', e: '🏹', a: '#fb923c', b: '#fde047', t: '249,115,22', p: ['🏹', '🎆', '🚩', '✨', '🔥'], m: 'rise' },
      karwa:     { n: 'Karwa Chauth', g: 'Happy Karwa Chauth', s: 'Chand ka intezaar, pyaar ka tyohaar — Karwa Chauth ki badhai 🌙', e: '🌙', a: '#f9a8d4', b: '#fde047', t: '236,72,153', p: ['🌙', '💍', '✨', '❤️'], m: 'twinkle' },
      dhanteras: { n: 'Dhanteras', g: 'Happy Dhanteras', s: 'Dhan-Lakshmi ki kripa se ghar sukh-samriddhi se bhare 🪙', e: '🪙', a: '#fde047', b: '#f59e0b', t: '250,204,21', p: ['🪙', '✨', '🪔', '💰', '🌟'], m: 'fall', L: 1 },
      diwali:    { n: 'Diwali', g: 'Happy Diwali', s: 'Shubh Deepawali! Roshni, khushiyon aur samriddhi se bhara ho aapka ghar ✨', e: '🪔', a: '#fde047', b: '#fb923c', t: '251,146,60', p: ['🪔', '✨', '🎆', '🪙', '🌟', '🏮'], m: 'rise', L: 1 },
      govardhan: { n: 'Govardhan Puja', g: 'Happy Govardhan Puja', s: 'Annakut aur Govardhan Puja ki hardik shubhkamnayein 🐄', e: '🐄', a: '#fde047', b: '#4ade80', t: '132,204,22', p: ['🐄', '🌿', '🪔', '✨'], m: 'rise' },
      bhaidooj:  { n: 'Bhai Dooj', g: 'Happy Bhai Dooj', s: 'Bhai-behen ke atoot rishte ko Bhai Dooj ki badhai 🧡', e: '🧡', a: '#fdba74', b: '#f9a8d4', t: '251,146,60', p: ['🧡', '🪔', '✨', '🎀'], m: 'fall' },
      chhath:    { n: 'Chhath Puja', g: 'Happy Chhath Puja', s: 'Chhathi Maiya aur Surya Dev ka aashirwad sada bana rahe 🌅', e: '🌅', a: '#fdba74', b: '#fde047', t: '251,146,60', p: ['🌅', '🌾', '🪔', '✨'], m: 'rise' },
      nanak:     { n: 'Guru Nanak Jayanti', g: 'Happy Guru Nanak Jayanti', s: 'Waheguru ji ka Khalsa, Waheguru ji ki Fateh — Gurpurab di vadhaiyan 🙏', e: '🙏', a: '#fde047', b: '#60a5fa', t: '59,130,246', p: ['🙏', '🌟', '✨', '🪔'], m: 'twinkle' },
      christmas: { n: 'Christmas', g: 'Merry Christmas', s: 'Khushiyon aur pyaar bhara Christmas — Santa aapko dher saari khushiyan de 🎅', e: '🎄', a: '#4ade80', b: '#f87171', t: '248,113,113', p: ['❄️', '🎄', '⭐', '🎁', '❄️'], m: 'fall', snow: 1 }
    };

    // [key, lead (kitne din pehle se), tail (kitne din baad tak), dates…]  — 'YYYY-MM-DD', range 'A~B', ya har saal 'MM-DD'
    var S = [
      ['newyear', 6, 2, '01-01'], ['lohri', 1, 0, '01-13'], ['sankranti', 2, 1, '01-14'], ['republic', 4, 0, '01-26'],
      ['vasant', 1, 0, '2026-01-23', '2027-02-11', '2028-01-31'],
      ['shivratri', 2, 0, '2026-02-15', '2027-03-06', '2028-02-22'],
      ['holi', 5, 1, '2026-03-04', '2027-03-22', '2028-03-10'],
      ['ugadi', 2, 0, '2026-03-19', '2027-04-07', '2028-03-26'],
      ['eidfitr', 3, 1, '2026-03-21', '2027-03-10', '2028-02-27'],
      ['ramnavami', 2, 0, '2026-03-26', '2027-04-14', '2028-04-03'],
      ['mahavir', 1, 0, '2026-03-31', '2027-04-18', '2028-04-07'],
      ['baisakhi', 2, 0, '04-14'],
      ['akshaya', 2, 0, '2026-04-19', '2027-05-08', '2028-04-27'],
      ['buddha', 1, 0, '2026-05-01', '2027-05-19', '2028-05-08'],
      ['eidadha', 3, 1, '2026-05-27', '2027-05-17', '2028-05-06'],
      ['rath', 1, 0, '2026-07-16', '2027-07-05', '2028-06-24'],
      ['guru', 1, 0, '2026-07-29', '2027-07-18', '2028-07-06'],
      ['independence', 5, 0, '08-15'],
      ['onam', 3, 1, '2026-08-26', '2027-09-12', '2028-09-01'],
      ['rakhi', 4, 1, '2026-08-28', '2027-08-16', '2028-08-04'],
      ['janmashtami', 3, 1, '2026-09-04', '2027-08-25', '2028-08-12'],
      ['ganesh', 5, 9, '2026-09-14', '2027-09-03', '2028-08-23'],
      ['gandhi', 1, 0, '10-02'],
      ['navratri', 4, 0, '2026-10-11~2026-10-19', '2027-09-30~2027-10-08', '2028-09-19~2028-09-26'],
      ['dussehra', 7, 1, '2026-10-20', '2027-10-09', '2028-09-27'],
      ['karwa', 5, 0, '2026-10-29', '2027-10-18', '2028-10-06'],
      ['dhanteras', 3, 0, '2026-11-06', '2027-10-26', '2028-10-15'],
      ['diwali', 30, 3, '2026-11-08', '2027-10-28', '2028-10-17'],
      ['govardhan', 0, 0, '2026-11-09', '2027-10-29', '2028-10-18'],
      ['bhaidooj', 1, 1, '2026-11-11', '2027-10-30', '2028-10-19'],
      ['chhath', 3, 1, '2026-11-15', '2027-11-04', '2028-10-23'],
      ['nanak', 3, 1, '2026-11-24', '2027-11-14'],
      ['christmas', 12, 2, '12-25']
    ];

    // ── Aaj ki tareekh (test ke liye window.__FF_FEST_TODAY = 'YYYY-MM-DD') ───────────────────────
    var DAY = 86400000;
    var now = new Date();
    var forced = (window.__FF_FEST_TODAY || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    var todayUtc = forced ? Date.UTC(+forced[1], +forced[2] - 1, +forced[3]) : Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var year = new Date(todayUtc).getUTCFullYear();
    var ms = function (d) { var p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); };

    var cands = [], upcoming = [];
    S.forEach(function (row) {
      var key = row[0], lead = row[1], tail = row[2];
      for (var i = 3; i < row.length; i++) {
        var spec = row[i], starts, ends;
        if (/^\d{2}-\d{2}$/.test(spec)) {   // har saal wala
          for (var y = year - 1; y <= year + 1; y++) {
            starts = ms(y + '-' + spec); ends = starts;
            push(key, lead, tail, starts, ends);
          }
        } else {
          var parts = spec.split('~'); starts = ms(parts[0]); ends = parts[1] ? ms(parts[1]) : starts;
          push(key, lead, tail, starts, ends);
        }
      }
    });
    function push(key, lead, tail, starts, ends) {
      var toStart = Math.round((starts - todayUtc) / DAY), sinceEnd = Math.round((todayUtc - ends) / DAY);
      if (toStart > 0) {
        if (toStart <= 60) upcoming.push({ key: key, d: toStart, at: starts });
        if (toStart <= lead) cands.push({ key: key, score: toStart, kind: 'soon', d: toStart, at: starts, ends: ends });
      } else if (sinceEnd <= 0) {
        cands.push({ key: key, score: 0, kind: starts === ends ? 'today' : 'range', d: 0, at: starts, ends: ends });
      } else if (sinceEnd <= tail) {
        cands.push({ key: key, score: sinceEnd + 0.5, kind: 'past', d: sinceEnd, at: ends, ends: ends });
      }
    }
    var forceKey = '';
    try { var q = (location.search || '').match(/[?&]fest=([a-z]+)/); forceKey = q ? q[1] : (off && off !== 'off' && F[off] ? off : ''); } catch (e) { /* ignore */ }
    var pick = null;
    if (forceKey && F[forceKey]) pick = { key: forceKey, kind: 'today', d: 0, at: todayUtc, ends: todayUtc, score: 0 };
    else {
      cands.sort(function (a, b) { return a.score - b.score; });
      pick = cands[0] || null;
    }
    if (!pick) return;
    var f = F[pick.key];
    if (!f) return;

    // ── Text ──────────────────────────────────────────────────────────────────────────────────
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var fmt = function (t) { var d = new Date(t); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
    var count;
    if (pick.kind === 'soon') count = fmt(pick.at) + ' · ' + (pick.d === 1 ? 'Kal hai!' : pick.d + ' din baaki');
    else if (pick.kind === 'range') count = 'Utsav chal raha hai · ' + fmt(pick.at) + ' – ' + fmt(pick.ends);
    else if (pick.kind === 'today') count = 'Aaj hai! 🎉';
    else count = pick.d === 1 ? 'Kal tha — shubhkamnayein jaari 🙏' : fmt(pick.at) + ' ko tha · shubhkamnayein 🙏';
    upcoming.sort(function (a, b) { return a.d - b.d; });
    // "Aage →": sabse nazdeek tyohaar + uske baad agla BADA tyohaar (taaki Diwali jaisa bada tyohaar hamesha dikhe)
    var MAJOR = { newyear: 1, republic: 1, holi: 1, eidfitr: 1, eidadha: 1, independence: 1, rakhi: 1, janmashtami: 1, ganesh: 1, navratri: 1, dussehra: 1, diwali: 1, christmas: 1 };
    var next = [], seen = {}; seen[pick.key] = 1;
    var near = upcoming.filter(function (u) { return !seen[u.key] && u.d <= 45 && F[u.key]; });
    if (near[0]) { next.push(near[0]); seen[near[0].key] = 1; }
    var big = near.filter(function (u) { return !seen[u.key] && MAJOR[u.key]; })[0] || near.filter(function (u) { return !seen[u.key]; })[0];
    if (big) next.push(big);
    var nextTxt = next.map(function (u) { return F[u.key].n + ' · ' + fmt(u.at) + ' (' + u.d + ' din)'; }).join('   •   ');

    // ── Markup ────────────────────────────────────────────────────────────────────────────────
    var mobile = !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
    var N = mobile ? 9 : 15, pcs = f.p, bits = '';
    for (var k = 0; k < N; k++) {
      var seed = (k * 37 + 11) % 100;
      bits += '<i style="--x:' + (3 + ((k * 61 + seed) % 94)) + '%;--d:' + (6 + (seed % 7)) + 's;--l:-' + ((k * 0.9) % 8).toFixed(1) + 's;--z:' + (16 + (seed % 17)) + 'px">' + pcs[k % pcs.length] + '</i>';
    }
    var lamps = f.L ? '<div class="fest-lamps"><b>🪔</b><b>🪔</b><b>🪔</b><b>🪔</b><b>🪔</b></div>' : '';
    var html = '<div class="fest-sky ' + f.m + '" aria-hidden="true">' + bits + '</div>' +
      '<div class="fest-banner" role="note">' +
        '<div class="fest-emoji" aria-hidden="true">' + f.e + '</div>' +
        '<div class="fest-title">' + f.g + '</div>' +
        '<div class="fest-sub">' + f.s + '</div>' +
        '<div class="fest-count">' + count + '</div>' +
        (nextTxt ? '<div class="fest-next">Aage → ' + nextTxt + '</div>' : '') +
      '</div>' + lamps;
    var wrap = document.createElement('div');
    wrap.className = 'fest-wrap'; wrap.innerHTML = html;
    var pic = boot.querySelector('picture') || boot.firstChild;
    boot.insertBefore(wrap, pic ? pic.nextSibling : null);

    // ── CSS (sirf festival wale din inject) ──────────────────────────────────────────────────────
    var grad = f.tri ? 'linear-gradient(90deg,#fb923c 0%,#fff 50%,#4ade80 100%)' : 'linear-gradient(90deg,' + f.a + ',' + f.b + ',' + f.a + ')';
    var col = f.col ? 'linear-gradient(90deg,#f472b6,#fde047,#22d3ee,#a78bfa,#f472b6)' : grad;
    var css =
      '.fest-wrap{display:contents}.app-boot .boot-fireworks{display:none!important}' +
      '.fest-sky{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0}' +
      '.fest-sky:before{content:"";position:absolute;inset:0;background:radial-gradient(60% 45% at 50% 38%,rgba(' + f.t + ',.26),transparent 70%),radial-gradient(40% 30% at 15% 85%,rgba(' + f.t + ',.14),transparent 70%),radial-gradient(40% 30% at 85% 80%,rgba(' + f.t + ',.14),transparent 70%)}' +
      '.fest-sky i{position:absolute;left:var(--x);font-style:normal;font-size:var(--z);line-height:1;opacity:0;will-change:transform,opacity;filter:drop-shadow(0 0 8px rgba(' + f.t + ',.55))}' +
      '.fest-sky.rise i{bottom:-8%;animation:festRise var(--d) linear var(--l) infinite}' +
      '.fest-sky.fall i{top:-8%;animation:festFall var(--d) linear var(--l) infinite}' +
      '.fest-sky.twinkle i{top:calc(8% + (var(--z) * 4.2));animation:festTwinkle calc(var(--d) / 2) ease-in-out var(--l) infinite}' +
      '.fest-banner{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;padding:0 18px;max-width:min(92vw,640px)}' +
      '.fest-emoji{font-size:clamp(46px,9vw,72px);line-height:1;animation:festBounce 2.2s ease-in-out infinite;filter:drop-shadow(0 6px 22px rgba(' + f.t + ',.75))}' +
      '.fest-title{font-weight:900;font-size:clamp(30px,7vw,52px);line-height:1.1;letter-spacing:-.01em;background:' + col + ';background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;animation:festShine 3.2s linear infinite;text-shadow:none;padding:2px 4px}' +
      '.fest-sub{font-size:clamp(13px,3.4vw,16px);font-weight:600;color:rgba(255,255,255,.88);line-height:1.45;max-width:34em}' +
      '.fest-count{margin-top:2px;padding:5px 14px;border-radius:99px;font-size:13px;font-weight:800;color:#fff;background:rgba(' + f.t + ',.28);border:1px solid rgba(' + f.t + ',.65);box-shadow:0 0 18px rgba(' + f.t + ',.35)}' +
      '.fest-next{margin-top:4px;font-size:11.5px;font-weight:700;letter-spacing:.02em;color:rgba(255,255,255,.62)}' +
      '.fest-lamps{position:absolute;left:0;right:0;bottom:7%;z-index:1;display:flex;justify-content:center;gap:clamp(14px,4vw,34px);pointer-events:none}' +
      '.fest-lamps b{font-size:clamp(22px,5vw,34px);font-weight:400;animation:festFlame 1.4s ease-in-out infinite;filter:drop-shadow(0 0 14px rgba(251,191,36,.9))}' +
      '.fest-lamps b:nth-child(2){animation-delay:.25s}.fest-lamps b:nth-child(3){animation-delay:.5s}.fest-lamps b:nth-child(4){animation-delay:.75s}.fest-lamps b:nth-child(5){animation-delay:1s}' +
      '@keyframes festRise{0%{transform:translate3d(0,0,0) rotate(-6deg);opacity:0}10%{opacity:.95}50%{transform:translate3d(14px,-55vh,0) rotate(6deg)}90%{opacity:.9}100%{transform:translate3d(-10px,-112vh,0) rotate(-4deg);opacity:0}}' +
      '@keyframes festFall{0%{transform:translate3d(0,0,0) rotate(0);opacity:0}8%{opacity:.95}50%{transform:translate3d(16px,55vh,0) rotate(180deg)}92%{opacity:.9}100%{transform:translate3d(-12px,112vh,0) rotate(360deg);opacity:0}}' +
      '@keyframes festTwinkle{0%,100%{transform:scale(.55);opacity:.15}50%{transform:scale(1.15);opacity:1}}' +
      '@keyframes festBounce{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-8px) scale(1.07)}}' +
      '@keyframes festShine{to{background-position:-200% 0}}' +
      '@keyframes festFlame{0%,100%{transform:scale(1) translateY(0);filter:drop-shadow(0 0 10px rgba(251,191,36,.8)) brightness(1)}50%{transform:scale(1.12) translateY(-2px);filter:drop-shadow(0 0 20px rgba(251,191,36,1)) brightness(1.25)}}' +
      '@media (prefers-reduced-motion:reduce){.fest-sky i,.fest-emoji,.fest-title,.fest-lamps b{animation:none!important}.fest-sky i{opacity:.55}}' +
      'html.ff-no-anim .fest-sky i,html.a11y-motion .fest-sky i,html.ff-no-anim .fest-emoji,html.a11y-motion .fest-emoji,html.ff-no-anim .fest-title,html.a11y-motion .fest-title,html.ff-no-anim .fest-lamps b,html.a11y-motion .fest-lamps b{animation:none!important}' +
      'html.mobile-ui .fest-sub{font-size:13px}';
    var st = document.createElement('style');
    st.id = 'festival-boot-css'; st.textContent = css;
    document.head.appendChild(st);
    window.FF_FEST = { key: pick.key, kind: pick.kind, days: pick.d, name: f.n };
    document.documentElement.setAttribute('data-fest', pick.key);
  } catch (e) { /* festival splash kabhi boot nahi rokta */ }
})();
