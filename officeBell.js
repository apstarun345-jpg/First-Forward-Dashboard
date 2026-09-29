/* 🔔 OFFICE BELL + 🎙️ VOICE ANNOUNCER (v3.16.1)
   Naya tag issue hua to office me live khabar:
   • Topbar me bell toggle 🔔 (on/off) + voice toggle 🔊 (bol kar sunao / sirf ting)
   • Har 30 sec halka agent-wise live query (EIR + GV Master — sirf aaj ka group-by count)
   • Kis agent ke kitne naye tags aaye ye pata chalta hai:
     - Voice ON  → "Rahul ne 5 naye tags issue kiye" bol kar sunata hai (ting ki jagah)
     - Voice OFF → WebAudio "ting" (jitne zyada tags, utna full sound)
   • Right-bottom me floating "+N 🏷️" ticker chip hamesha dikhta hai
   • Bahut bada burst (40+) → "zabardast" announcement
   Sheet me time nahi hota isliye ye poll-based hai — naye rows sheet me aate hi pata chalta hai. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const LS_KEY = 'ff-office-bell';
  const LS_VOICE = 'ff-office-bell-voice';
  const st = { mounted: false, timer: null, last: null, fails: 0, pings: 0, audio: null };

  const on = () => { try { return localStorage.getItem(LS_KEY) !== '0'; } catch { return true; } };
  const setOn = (v) => { try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch { /* ignore */ } };
  const voiceOn = () => { try { return localStorage.getItem(LS_VOICE) !== '0'; } catch { return true; } };
  const setVoice = (v) => { try { localStorage.setItem(LS_VOICE, v ? '1' : '0'); } catch { /* ignore */ } };
  const featOn = () => !(FF.config.features && FF.config.features.officeBell === false);

  // ---- sound -----------------------------------------------------------------------------------
  function ting(delta) {
    try {
      if (!st.audio) st.audio = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = st.audio;
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime;
      const notes = delta >= 25 ? [880, 1108.7, 1318.5] : delta >= 10 ? [783.99, 987.77] : [659.25];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f * (1 + Math.min(delta, 50) / 400);
        g.gain.setValueAtTime(0.0001, t0 + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.6);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0 + i * 0.09); o.stop(t0 + i * 0.09 + 0.7);
      });
    } catch { /* sound blocked — ignore */ }
  }

  // ---- 🎙️ voice announce ------------------------------------------------------------------------
  function announceText(movers, totalNew, sourceDeltas) {
    const hi = !(FF.assistant && FF.assistant.getLang && FF.assistant.getLang() === 'en');
    const top = [...(movers || [])].sort((a, b) => b.n - a.n);
    const firstName = (m) => String((m && m.agent) || '').split(/\s+/)[0] || 'Ek agent';
    const sourceName = (ch) => ch === 'GV' ? 'GV Partner' : 'First Forward';
    if (totalNew >= 40) {
      if (sourceDeltas && sourceDeltas.ff > 0 && sourceDeltas.gv > 0) {
        return hi ? `Zabardast! ${totalNew} naye tags — First Forward ${U.fmt(sourceDeltas.ff)}, GV Partner ${U.fmt(sourceDeltas.gv)}.`
          : `Amazing! ${totalNew} new tags — First Forward ${U.fmt(sourceDeltas.ff)}, GV Partner ${U.fmt(sourceDeltas.gv)}.`;
      }
      return hi ? `Zabardast! ${totalNew} naye tags aa gaye — sab kaam par lage hain!`
        : `Amazing! ${totalNew} new tags just came in — everyone is firing!`;
    }
    if (!top.length) return hi ? `${totalNew} naye tags update hue.` : `${totalNew} new tags were updated.`;
    if (top.length === 1) {
      const m = top[0];
      return hi ? `${firstName(m)} ne ${m.n} ${sourceName(m.ch)} ke naye tags issue kiye.`
        : `${firstName(m)} issued ${m.n} new ${sourceName(m.ch)} tags.`;
    }
    const first = top[0], second = top[1];
    const rest = top.length - 2, restN = top.slice(2).reduce((s, m) => s + m.n, 0);
    let text = hi
      ? `${sourceName(first.ch)} me ${firstName(first)} ne ${first.n}, ${sourceName(second.ch)} me ${firstName(second)} ne ${second.n} naye tags issue kiye.`
      : `${sourceName(first.ch)}: ${firstName(first)} issued ${first.n}; ${sourceName(second.ch)}: ${firstName(second)} issued ${second.n} new tags.`;
    if (rest > 0) text += hi ? ` Aur ${rest} agents ne mil kar ${restN} tags.` : ` Plus ${rest} more agents added ${rest}.`;
    return text;
  }
  function speakAnnounce(text) {
    if (FF.assistant && typeof FF.assistant.speak === 'function') {
      try { FF.assistant.speak(text, { force: true }); return; } catch { /* fallback below */ }
    }
    // assistant module na ho to basic speechSynthesis
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'hi-IN'; u.rate = 1.02;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  // ---- floating ticker -------------------------------------------------------------------------
  function floatChip(text, tone) {
    let host = document.getElementById('bell-floats');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bell-floats';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `bell-float ${tone || ''}`;
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, 4200);
    while (host.children.length > 5) host.firstChild.remove();
  }

  // ---- live agent-wise queries ------------------------------------------------------------------
  /** { ff, gv, agents: Map('FF|name' → count), ok: { ff, gv } }. Query rows are arrays from FF.data. */
  async function countsToday() {
    const today = U.dateKey(new Date());
    const D = FF.data;
    const out = { ff: 0, gv: 0, agents: new Map(), ok: { ff: false, gv: false } };
    const cellText = (row, index) => U.clean(D.cellText ? D.cellText(row[index]) : (row[index] && row[index].v));
    const cellNumber = (row, index) => Number(D.cellNumber ? D.cellNumber(row[index]) : row[index] && row[index].v) || 0;
    const add = (ch, name, n) => {
      if (!name || n <= 0) return;
      const key = `${ch}|${name}`;
      out.agents.set(key, (out.agents.get(key) || 0) + n);
      out[ch.toLowerCase()] += n;
    };
    const e = FF.config.eir;
    const m = FF.config.gv && FF.config.gv.master;
    const jobs = [
      D.query(e.sheet, `select ${e.agentName}, ${e.gvName}, ${e.masterId}, ${e.tlName}, count(${e.tagId}) where ${e.date} = date '${today}' group by ${e.agentName}, ${e.gvName}, ${e.masterId}, ${e.tlName}`, { timeoutMs: 20000, fresh: true }),
      FF.config.gvSheetId && m
        ? D.query('GV Master', `select ${m.agentName}, ${m.uniqueId}, count(${m.uniqueId}) where ${m.date} = date '${today}' group by ${m.agentName}, ${m.uniqueId}`, { timeoutMs: 20000, fresh: true })
        : Promise.reject(new Error('GV Master is not configured'))
    ];
    const [eirResult, gvResult] = await Promise.allSettled(jobs);
    if (eirResult.status === 'fulfilled') {
      const table = eirResult.value;
      for (const row of (table.rows || [])) {
        const name = cellText(row, 0) || cellText(row, 1) || cellText(row, 2);
        const masterId = cellText(row, 2), tlName = cellText(row, 3), n = cellNumber(row, 4);
        const isGv = FF.model && FF.model.channelOf
          ? FF.model.channelOf(masterId, tlName) === 'GV Partner'
          : String(masterId).replace(/\.0+$/, '') === String(e.gvMasterId || '5845036') || U.clean(tlName).toLowerCase() === U.clean(e.gvChannelTl || 'ApnaPayment Pvt. Ltd.').toLowerCase();
        // EIR contains both channels in some deployments. GV is announced from GV Master only;
        // otherwise each new GV tag would be announced twice and falsely counted as FF.
        if (!isGv) add('FF', name, n);
      }
      out.ok.ff = true;
    }
    if (gvResult.status === 'fulfilled') {
      for (const row of (gvResult.value.rows || [])) {
        const name = cellText(row, 0) || cellText(row, 1);
        add('GV', name, cellNumber(row, 2));
      }
      out.ok.gv = true;
    }
    return out;
  }

  async function poll() {
    if (!on() || !featOn()) return;
    if (document.hidden) return; // tab background me hai — mat bajao
    let c;
    try { c = await countsToday(); } catch { st.fails++; return; }
    st.fails = 0;
    if (!st.last) { st.last = c; return; } // pehla poll = baseline (chup-chaap)
    const previous = st.last;
    const current = { ...c, agents: new Map(c.agents), ok: { ...c.ok } };
    // Query failure ko zero mat samjho: preserve that source's last good reading so recovery doesn't
    // erase its baseline or cause a duplicate burst on the following poll.
    for (const ch of ['FF', 'GV']) {
      const key = ch.toLowerCase();
      if (!current.ok[key] && previous.ok[key]) {
        current[key] = previous[key]; current.ok[key] = true;
        for (const [agentKey, n] of previous.agents) if (agentKey.startsWith(`${ch}|`)) current.agents.set(agentKey, n);
      }
    }
    const dFf = current.ok.ff && previous.ok.ff ? current.ff - previous.ff : 0;
    const dGv = current.ok.gv && previous.ok.gv ? current.gv - previous.gv : 0;
    // Agent-wise movers — channel ko safely split karo (agent name me bhi '|' ho sakta hai).
    const movers = [];
    current.agents.forEach((n, key) => {
      const split = key.indexOf('|');
      if (split < 0) return;
      const ch = key.slice(0, split), channel = ch.toLowerCase();
      if (!current.ok[channel] || !previous.ok[channel]) return;
      const agent = key.slice(split + 1), old = previous.agents.get(key) || 0;
      if (n > old) movers.push({ ch, agent, n: n - old });
    });
    st.last = current;
    const totalNew = Math.max(0, dFf) + Math.max(0, dGv);
    if (totalNew <= 0) return;
    const parts = [];
    if (dFf > 0) parts.push(`+${U.fmt(dFf)} 🏷️ FF`);
    if (dGv > 0) parts.push(`+${U.fmt(dGv)} 🏷️ GV`);
    st.pings += 1;
    floatChip(parts.join(' · '), dFf > 0 && dGv > 0 ? 'both' : dFf > 0 ? 'ff' : 'gv');
    if (voiceOn()) speakAnnounce(announceText(movers, totalNew, { ff: Math.max(0, dFf), gv: Math.max(0, dGv) }));
    else ting(parts.length > 1 ? totalNew + 5 : totalNew);
    updateBtn();
  }

  // ---- topbar buttons --------------------------------------------------------------------------
  let btn = null, vbtn = null;
  function updateBtn() {
    if (btn) {
      const isOn = on() && featOn();
      btn.textContent = isOn ? '🔔' : '🔕';
      btn.classList.toggle('off', !isOn);
      btn.title = isOn ? `Office Bell ON — naya tag aate hi pata chalega (aaj ${st.pings} pings)` : 'Office Bell OFF — click karke on karo';
    }
    if (vbtn) {
      const v = voiceOn();
      vbtn.textContent = v ? '🔊' : '🔇';
      vbtn.classList.toggle('off', !v);
      vbtn.title = v ? '🎙️ Voice Announcer ON — naye tags bol kar sunayega' : 'Voice Announcer OFF — sirf ting bajega';
    }
  }
  function mount() {
    if (st.mounted || !featOn()) return;
    const actions = U.$('#top-actions');
    if (!actions || U.$('#bell-btn')) return;
    st.mounted = true;
    btn = U.h(`<button class="bell-btn" id="bell-btn" type="button" aria-label="Office bell on/off">🔔</button>`);
    btn.addEventListener('click', () => {
      setOn(!on());
      updateBtn();
      if (on()) { st.last = null; poll().catch(() => {}); U.toast('🔔 Office Bell ON — naye tags ka live pata chalega', 'ok'); }
      else U.toast('🔕 Office Bell OFF', 'warn');
    });
    vbtn = U.h(`<button class="bell-btn" id="bell-voice-btn" type="button" aria-label="Voice announcer on/off">🔊</button>`);
    vbtn.addEventListener('click', () => {
      setVoice(!voiceOn());
      updateBtn();
      if (voiceOn()) { U.toast('🎙️ Voice Announcer ON — ting ki jagah bol kar sunayega', 'ok'); speakAnnounce(FF.assistant && FF.assistant.getLang && FF.assistant.getLang() === 'en' ? 'Voice announcer is on.' : 'Voice announcer on hai — ab naye tags bol kar sunaunga.'); }
      else U.toast('🔇 Sirf ting bajega, awaaz band', 'warn');
    });
    const ref = U.$('#master-search');
    if (ref && typeof actions.insertBefore === 'function') { actions.insertBefore(btn, ref.nextSibling); actions.insertBefore(vbtn, ref.nextSibling); }
    else { actions.appendChild(btn); actions.appendChild(vbtn); }
    updateBtn();
    if (st.timer) clearInterval(st.timer);
    st.timer = setInterval(poll, 30000);
    setTimeout(poll, 4000); // baseline jaldi le lo
  }

  FF.officeBell = { mount, announceText, countsToday, get on() { return on(); }, get voiceOn() { return voiceOn(); }, get pings() { return st.pings; } };
})(window.FF);
