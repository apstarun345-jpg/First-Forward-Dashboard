/* 🔔 OFFICE BELL (v3.16) — naya tag issue hua to office me "ting!" 🎶
   • Topbar me bell toggle (on/off — localStorage me yaad)
   • Har 30 sec ek halka live count query (EIR + GV Master — sirf aaj ka count, full reload nahi)
   • Count badha → WebAudio "ting" (jitne zyada tags ek saath, utna zyada pitch/full sound)
     + right-bottom me floating "+N 🏷️" ticker chip
   • Sheet me time nahi hota isliye ye poll-based hai — ↻ / auto-sync se naye rows aate hi bajta hai. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const LS_KEY = 'ff-office-bell';
  const st = { mounted: false, timer: null, last: null, fails: 0, pings: 0, audio: null };

  const on = () => { try { return localStorage.getItem(LS_KEY) !== '0'; } catch { return true; } };
  const setOn = (v) => { try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch { /* ignore */ } };
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

  // ---- live count queries ----------------------------------------------------------------------
  async function countsToday() {
    const today = U.dateKey(new Date());
    const D = FF.data;
    const out = { ff: 0, gv: 0 };
    try {
      const e = FF.config.eir;
      const t1 = await D.query(e.sheet, `select count(${e.tagId}) where ${e.date} = date '${today}'`, { timeoutMs: 20000, fresh: true });
      out.ff = (t1.rows && t1.rows.length && t1.rows[0].c && t1.rows[0].c[0]) ? (Number(t1.rows[0].c[0].v) || 0) : 0;
    } catch { /* FF query fail — silent */ }
    try {
      const m = FF.config.gv.master;
      if (FF.config.gvSheetId && m) {
        const t2 = await D.query('GV Master', `select count(${m.uniqueId}) where ${m.date} = date '${today}'`, { timeoutMs: 20000, fresh: true });
        out.gv = (t2.rows && t2.rows.length && t2.rows[0].c && t2.rows[0].c[0]) ? (Number(t2.rows[0].c[0].v) || 0) : 0;
      }
    } catch { /* GV off — silent */ }
    return out;
  }

  async function poll() {
    if (!on() || !featOn()) return;
    if (document.hidden) return; // tab background me hai — mat bajao
    let c;
    try { c = await countsToday(); } catch { st.fails++; return; }
    st.fails = 0;
    if (!st.last) { st.last = c; return; } // pehla poll = baseline (chup-chaap)
    const dFf = c.ff - st.last.ff, dGv = c.gv - st.last.gv;
    st.last = c;
    const parts = [];
    if (dFf > 0) parts.push(`+${U.fmt(dFf)} 🏷️ FF`);
    if (dGv > 0) parts.push(`+${U.fmt(dGv)} 🏷️ GV`);
    if (parts.length) {
      const delta = Math.max(dFf, dGv, 0) + Math.min(dFf, dGv);
      ting(parts.length > 1 ? delta + 5 : delta);
      st.pings += 1;
      floatChip(parts.join(' · '), dFf > 0 && dGv > 0 ? 'both' : dFf > 0 ? 'ff' : 'gv');
      updateBtn();
    }
  }

  // ---- topbar button ---------------------------------------------------------------------------
  let btn = null;
  function updateBtn() {
    if (!btn) return;
    const isOn = on() && featOn();
    btn.textContent = isOn ? '🔔' : '🔕';
    btn.classList.toggle('off', !isOn);
    btn.title = isOn ? `Office Bell ON — naya tag = ting! (aaj ${st.pings} pings)` : 'Office Bell OFF — click karke on karo';
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
      if (on()) { st.last = null; poll().catch(() => {}); U.toast('🔔 Office Bell ON — naye tags par ting sunayi dega', 'ok'); }
      else U.toast('🔕 Office Bell OFF', 'warn');
    });
    const ref = U.$('#master-search');
    if (ref && typeof actions.insertBefore === 'function') actions.insertBefore(btn, ref.nextSibling);
    else actions.appendChild(btn);
    updateBtn();
    if (st.timer) clearInterval(st.timer);
    st.timer = setInterval(poll, 30000);
    setTimeout(poll, 4000); // baseline jaldi le lo
  }

  FF.officeBell = { mount, get on() { return on(); }, get pings() { return st.pings; } };
})(window.FF);
