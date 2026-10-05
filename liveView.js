/* Admin: notification → "what changed" report, and 👁 Live view of a user's screen.
 * Live view = same-origin mirror: we render the page the user has open (inside an iframe, with the
 * admin's session), scroll it to the user's scroll position and draw the user's live cursor + clicks
 * on top. Nothing from the user's screen is captured — only page, scroll %, pointer % and click labels
 * which the user's browser shares (can be switched off in Settings → My account). */
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const fmt = (n) => U.fmt(Number(n) || 0);
  const when = (iso) => { const t = new Date(iso).getTime(); return Number.isFinite(t) ? `${U.timeLabel(t)} · ${new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''; };
  const CLASS_ORDER = ['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC15', 'VC16', 'VC20'];

  function deltaCell(d) {
    const n = Number(d) || 0;
    return `<td class="num"><span class="delta ${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${n > 0 ? '+' : ''}${fmt(n)}</span></td>`;
  }

  // ---- 📊 Class × type breakdown (kitna update hua — chassis / replace / wrong VRN) --------------
  // Notification ke drawer me sirf class totals hi nahi, type-wise bhi dikhna chahiye. Ye detail
  // EIR ke "daily" dataset se aati hai — wo boot par pehle hi load ho jaata hai (store me cached),
  // isliye drawer khulne par extra Google query nahi jaati.
  const breakdownCache = new Map();
  const CLASS_ORDER_ALL = [...CLASS_ORDER];
  const classRank = (c) => { const i = CLASS_ORDER_ALL.indexOf(String(c).toUpperCase()); return i < 0 ? 99 : i + 1; };
  /** Ek din + channel ke rows → { classes: {cls:{tags,issuance,repl,chassis,wrong}}, agents: [...] } */
  function breakdownOf(rows, dateKey, channel) {
    const key = `${dateKey}|${channel}`;
    if (breakdownCache.has(key)) return breakdownCache.get(key);
    const wanted = (rows || []).filter((r) => {
      const d = r.dateKey || (r.date instanceof Date ? U.dateKey(r.date) : String(r.date || '').slice(0, 10));
      return d === dateKey && (!channel || r.channel === channel);
    });
    const classes = {};
    const agents = new Map();
    for (const r of wanted) {
      const cls = String(r.cls || 'NA').toUpperCase();
      const c = classes[cls] || (classes[cls] = { cls, tags: 0, issuance: 0, repl: 0, chassis: 0, wrong: 0, agents: new Set() });
      const n = Number(r.n) || 0;
      c.tags += n;
      const isRepl = String(r.type || '').toUpperCase() === 'REPLACEMENT';
      const isChassis = /chassis/i.test(r.vrnType || '');
      const isWrong = /wrong|galat/i.test(r.vrnType || '');
      if (isRepl) c.repl += n; else c.issuance += n;
      if (isChassis) c.chassis += n;
      if (isWrong) c.wrong += n;
      if (r.agentName) c.agents.add(String(r.agentName).trim().toUpperCase());
      const aKey = String(r.agentName || r.agentId || '').trim();
      if (aKey) {
        const a = agents.get(aKey) || { name: aKey, tags: 0, cls: new Map() };
        a.tags += n;
        a.cls.set(cls, (a.cls.get(cls) || 0) + n);
        agents.set(aKey, a);
      }
    }
    const out = {
      dateKey, channel, classes,
      total: Object.values(classes).reduce((s, c) => s + c.tags, 0),
      agents: [...agents.values()].sort((a, b) => b.tags - a.tags).slice(0, 10)
    };
    breakdownCache.set(key, out);
    if (breakdownCache.size > 24) breakdownCache.delete(breakdownCache.keys().next().value);
    return out;
  }
  function breakdownHtml(list) {
    if (!list.length) return '<p class="dim small">Type-wise detail is din ke liye nahi mili.</p>';
    const head = '<tr><th>Class</th><th class="num">Tags</th><th class="num">Naye issue</th><th class="num">Replace</th><th class="num">Chassis</th><th class="num">Wrong VRN</th><th class="num">Agents</th></tr>';
    return list.map(({ label, data }) => {
      const rows = Object.values(data.classes).sort((a, b) => classRank(a.cls) - classRank(b.cls) || a.cls.localeCompare(b.cls));
      const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
      const tot = rows.reduce((s, r) => ({ tags: s.tags + r.tags, issuance: s.issuance + r.issuance, repl: s.repl + r.repl, chassis: s.chassis + r.chassis, wrong: s.wrong + r.wrong }), { tags: 0, issuance: 0, repl: 0, chassis: 0, wrong: 0 });
      const agents = new Set(); rows.forEach((r) => r.agents.forEach((a) => agents.add(a)));
      return `<div class="kd-sec"><h4 class="kd-h">${esc(label)} · class × tag type</h4>
        <div class="kd-scroll"><table class="kd-tbl"><thead>${head}</thead><tbody>
          ${rows.map((r) => `<tr><td><b>${esc(r.cls)}</b></td><td class="num"><b>${fmt(r.tags)}</b></td><td class="num">${fmt(r.issuance)}</td><td class="num">${r.repl ? `<span class="delta up">${fmt(r.repl)}</span>` : '—'}</td><td class="num">${r.chassis ? `<span class="delta down">${fmt(r.chassis)}</span>` : '—'}</td><td class="num">${r.wrong ? `<span class="delta down">${fmt(r.wrong)}</span>` : '—'}</td><td class="num">${fmt(r.agents.size)}</td></tr>`).join('')}
        </tbody><tfoot><tr class="kd-total"><td>Total</td><td class="num">${fmt(sum('tags'))}</td><td class="num">${fmt(tot.issuance)}</td><td class="num">${fmt(tot.repl)}</td><td class="num">${fmt(tot.chassis)}</td><td class="num">${fmt(tot.wrong)}</td><td class="num">${fmt(agents.size)}</td></tr></tfoot></table></div>
        ${data.agents.length ? `<div class="dim small" style="margin-top:6px">🏆 Sabse zyada issue: ${data.agents.slice(0, 6).map((a) => `${esc(a.name)} <b>${fmt(a.tags)}</b>`).join(' · ')}</div>` : ''}
      </div>`;
    }).join('');
  }
  /**
   * Notification drawer ke andar type-wise breakdown (async). Placeholder turant dikhta hai,
   * data aate hi replace ho jaata hai — drawer kabhi khali nahi rehta.
   */
  async function fillBreakdown(item) {
    const host = document.querySelector('#drawer-body [data-lv-breakdown]');
    if (!host) return;
    const m = item.meta || {};
    const dateKey = String((m.snapshot && m.snapshot.date) || m.date || '').slice(0, 10);
    const sources = m.source === 'gv' ? ['GV Partner'] : m.source === 'ff' ? ['First Forward'] : ['First Forward', 'GV Partner'];
    if (!dateKey) { host.innerHTML = '<p class="dim small">Is notification me date nahi hai — type-wise detail skip.</p>'; return; }
    let rows = [];
    try { rows = (await FF.store.need('daily')) || []; } catch { /* offline / query fail */ }
    if (!host.isConnected) return;
    const list = sources
      .map((channel) => ({ label: channel === 'GV Partner' ? '🟩 GV Partner' : '🟦 First Forward', data: breakdownOf(rows, dateKey, channel) }))
      .filter((x) => x.data.total > 0);
    host.innerHTML = list.length
      ? `${breakdownHtml(list)}<p class="dim small">Source: EIR ledger (${esc(U.labelDateKey ? U.labelDateKey(dateKey) : dateKey)}) · chassis = VRN type CHASSIS · wrong = WRONG VRN.</p>`
      : '<p class="dim small">Is din ka row-level detail nahi mila (EIR me is date ka data nahi hai) — upar class-wise snapshot dekh lo.</p>';
  }

  // ---- report notification: class-wise before → after ------------------------------------------
  function reportView(item) {
    const m = item.meta || {};
    const now = m.snapshot || {}, prev = m.previous || {}, delta = m.delta || {};
    const sameDay = prev.date && prev.date === now.date;
    const keys = [...new Set([...Object.keys(prev.classes || {}), ...Object.keys(now.classes || {})])]
      .sort((a, b) => ((CLASS_ORDER.indexOf(a) + 1 || 99) - (CLASS_ORDER.indexOf(b) + 1 || 99)) || a.localeCompare(b));
    const rows = keys.map((k) => {
      const p = sameDay ? (prev.classes || {})[k] || 0 : 0;
      const n = (now.classes || {})[k] || 0;
      return `<tr><td>${esc(k)}</td><td class="num">${sameDay ? fmt(p) : '—'}</td><td class="num"><b>${fmt(n)}</b></td>${deltaCell(n - p)}</tr>`;
    }).join('');
    const src = m.source === 'gv' ? 'GV Partner' : 'First Forward';
    const newTags = sameDay ? (now.total || 0) - (prev.total || 0) : now.total || 0;
    const body = `
      <div class="kd-hero"><div><div class="kd-kicker">${esc(src)} · ${esc(now.date ? U.labelDateKey(now.date) : '')}</div>
        <div class="kd-big">${newTags > 0 ? '+' : ''}${fmt(newTags)} <small>tags</small></div>
        <div class="kd-sub">${sameDay ? `Pehle ${fmt(prev.total)} the → ab <b>${fmt(now.total)}</b>` : `Naya din shuru: <b>${fmt(now.total)}</b> tags${prev.date ? ` (pichhla update ${esc(U.labelDateKey(prev.date))}: ${fmt(prev.total)})` : ''}`}</div></div>
        <div class="kd-vs">${esc(when(item.createdAt))}</div></div>
      <div class="kd-sec"><h4 class="kd-h">Class-wise kya badla</h4>
        <div class="kd-scroll"><table class="kd-tbl"><thead><tr><th>Class</th><th class="num">Pehle</th><th class="num">Ab</th><th class="num">Change</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="dim">Class detail available nahi hai.</td></tr>'}</tbody>
        <tfoot><tr class="kd-total"><td>Total</td><td class="num">${sameDay ? fmt(prev.total) : '—'}</td><td class="num">${fmt(now.total)}</td>${deltaCell(newTags)}</tr></tfoot></table></div></div>
      ${delta && delta.classes && Object.keys(delta.classes).length ? `<div class="kd-chips">${Object.entries(delta.classes).map(([k, v]) => `<span class="kd-chip ${v > 0 ? 'green' : 'red'}">${esc(k)} ${v > 0 ? '+' : ''}${fmt(v)}</span>`).join('')}</div>` : ''}
      <div class="kd-sec" data-lv-breakdown="1"><h4 class="kd-h">🔎 Class × tag type (chassis · replace · wrong VRN)</h4><p class="dim small">Detail load ho rahi hai…</p></div>
      <div class="btn-row" style="margin-top:14px">
        ${now.date ? `<button class="btn primary" data-lv-kpi="${esc(now.date)}" data-lv-src="${m.source === 'gv' ? 'gv' : 'ff'}">📊 Us din ki poori detail (class, channel, sab tags)</button>
        <a class="btn" href="#/tagIssued?date=${esc(now.date)}" data-lv-close>📅 Tag Issued page kholo</a>` : ''}
      </div>`;
    return { kicker: '📊 Report update', title: item.title, sub: esc(item.body), body };
  }

  // ---- settings / user notification: field before → after ---------------------------------------
  function changesView(item) {
    const m = item.meta || {};
    const changes = Array.isArray(m.changes) ? m.changes : [];
    const perms = m.permissions || {};
    const tbl = changes.length ? `<div class="kd-scroll tall"><table class="kd-tbl"><thead><tr><th>Field</th><th>Pehle</th><th>Ab</th></tr></thead><tbody>${changes.map((c) => `<tr><td><code>${esc(c.field)}</code></td><td class="dim">${esc(c.before)}</td><td><b>${esc(c.after)}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="dim">Field-level detail is notification ke saath save nahi hui thi.</p>';
    const chips = (list, cls, sign) => (list || []).map((p) => `<span class="kd-chip ${cls}">${sign} ${esc(p)}</span>`).join('');
    const permHtml = (perms.added && perms.added.length) || (perms.removed && perms.removed.length)
      ? `<div class="kd-sec"><h4 class="kd-h">Access / permissions</h4><div class="kd-chips">${chips(perms.added, 'green', '+')}${chips(perms.removed, 'red', '−')}</div></div>` : '';
    const body = `
      <div class="kd-stats">
        <div class="kd-stat"><span>Kisne</span><b>${esc(m.username || '—')}</b></div>
        ${m.subject ? `<div class="kd-stat sky"><span>Kiska account</span><b>${esc(m.subject)}</b></div>` : ''}
        <div class="kd-stat violet"><span>Changes</span><b>${fmt(changes.length)}</b></div>
        <div class="kd-stat amber"><span>Kab</span><b style="font-size:14px">${esc(when(item.createdAt))}</b></div>
      </div>
      <div class="kd-sec"><h4 class="kd-h">Kya change hua</h4>${tbl}</div>${permHtml}
      ${m.username && item.type === 'user' && m.subject && m.subject !== m.username ? '' : liveBtn(m.username)}`;
    return { kicker: item.type === 'settings' ? '⚙️ Settings change' : '👤 User change', title: item.title, sub: esc(item.body), body };
  }

  function liveBtn(username) {
    return username ? `<div class="btn-row" style="margin-top:14px"><button class="btn primary" data-lv-watch="${esc(username)}">👁 ${esc(username)} ka live view</button></div>` : '';
  }

  // ---- login / activity / search / click / location ---------------------------------------------
  function activityView(item) {
    const m = item.meta || {};
    const rows = Object.entries(m).filter(([k, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(String(v))}</b></td></tr>`).join('');
    const loc = m.location && m.location.lat ? `<p><a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${encodeURIComponent(`${m.location.lat},${m.location.lng}`)}">📍 Map par dekho</a> <span class="dim small">±${fmt(m.location.accuracy)} m</span></p>` : '';
    const body = `<p class="dim small">${esc(when(item.createdAt))}</p>
      <div class="kd-scroll"><table class="kd-tbl"><tbody>${rows || '<tr><td class="dim">No extra detail</td></tr>'}</tbody></table></div>${loc}
      ${m.page ? `<p><a class="btn small" href="#/${esc(String(m.page).split('?')[0])}" data-lv-close>↗ Wahi page kholo</a></p>` : ''}
      ${liveBtn(m.username)}`;
    return { kicker: '🔔 Activity', title: item.title, sub: esc(item.body), body };
  }

  function openNotification(item) {
    if (!item) return;
    const view = item.type === 'report' ? reportView(item)
      : (item.type === 'settings' || item.type === 'user') ? changesView(item)
        : activityView(item);
    // 📊 Type-wise breakdown async — drawer turant khulta hai, detail aate hi apne aap bhar jaati hai.
    const needsBreakdown = /data-lv-breakdown/.test(view.body || '');
    // Data drawer me expand + (link ho to) us data page par redirect button — dono options.
    const m = item.meta || {};
    if (m.link) {
      const lbl = (() => { try { const id = String(m.link).replace(/^#\/?/, '').split('?')[0]; const p = ((FF.app && FF.app.PAGES) || []).find((x) => x.id === id); if (id === 'sheet') return decodeURIComponent((String(m.link).split('/')[1] || 'Sheet').split('?')[0]); if (p) return p.label; return id === 'settings' ? 'Settings' : id; } catch { return 'Page'; } })();
      view.body += `<p style="margin:10px 0 2px"><a class="btn small primary" href="${esc(m.link)}" data-lv-close>➡️ ${esc(lbl)} par jao</a> <span class="dim small">notification ke data par redirect</span></p>`;
    }
    FF.app.openDrawer({ ...view, wide: item.type === 'report' || item.type === 'settings' || item.type === 'user' });
    if (needsBreakdown) fillBreakdown(item).catch(() => { /* detail optional */ });
  }

  // ---- 👁 Live view ------------------------------------------------------------------------------
  const live = { user: '', timer: null, modal: null, lastPage: '', lastEventAt: 0, mirror: true, busy: false, speed: 1000, lastRenderAt: 0 };
  /** Exact instant label — HH:MM:SS.mmm (jaise live telemetry me hota hai). */
  const exactClock = (ts) => {
    const d = new Date(ts || Date.now());
    const p = (n, w) => String(n).padStart(w || 2, '0');
    return Number.isFinite(d.getTime()) ? `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}` : '—';
  };
  /** Kitna fresh hai: <2.5s = live, <15s = thoda purana, warna stale. */
  function freshness(ts) {
    const lag = Math.max(0, Date.now() - Number(ts || 0));
    const cls = lag <= 2500 ? 'dot-on' : lag <= 15000 ? 'dot-stale' : 'dot-off';
    const label = lag < 1000 ? 'abhi' : lag < 60000 ? `${(lag / 1000).toFixed(lag < 10000 ? 1 : 0)}s pehle` : `${Math.round(lag / 60000)}m pehle`;
    return { lag, cls, label };
  }

  function stopWatch() {
    clearInterval(live.timer); live.timer = null;
    clearInterval(live.clockTimer); live.clockTimer = null;
    if (live.modal) live.modal.remove();
    live.modal = null; live.user = ''; live.lastPage = ''; live.lastEventAt = 0;
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') stopWatch(); }

  function watch(username) {
    if (!FF.auth.isAdmin || !FF.auth.isAdmin()) { U.toast('Live view sirf admin ke liye hai', 'err'); return; }
    stopWatch();
    FF.app.closeDrawer();
    live.user = String(username || '');
    live.mirror = localStorage.getItem('ff_live_mirror') !== '0';
    const modal = U.h(`<div class="live-modal" role="dialog" aria-label="Live view">
      <div class="live-head">
        <div class="live-who"><span class="live-dot"></span><div><b id="lv-name">${esc(live.user)}</b><small id="lv-page">Connecting…</small></div></div>
        <span class="live-fresh dot-off" id="lv-fresh"><i></i><span id="lv-fresh-text">connecting…</span></span>
        <div class="live-status" id="lv-status">…</div>
        <label class="live-toggle"><input type="checkbox" id="lv-mirror" ${live.mirror ? 'checked' : ''}> Page mirror</label>
        <label class="live-toggle">⚡ Speed
          <select id="lv-speed">
            <option value="500" ${live.speed === 500 ? 'selected' : ''}>0.5s (instant)</option>
            <option value="1000" ${live.speed === 1000 ? 'selected' : ''}>1s</option>
            <option value="2000">2s</option>
            <option value="5000">5s</option>
          </select>
        </label>
        <button class="btn small" id="lv-close">✕ Close</button>
      </div>
      <div class="live-main">
        <div class="live-stage" id="lv-stage"><div class="live-screen" id="lv-screen">
          <iframe id="lv-frame" title="Live page mirror" tabindex="-1"></iframe>
          <div class="live-overlay-label" id="lv-overlay" hidden></div>
          <div class="live-cursor" id="lv-cursor" hidden><svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#ef4444" stroke="#fff" stroke-width="1.5"/></svg><span id="lv-cursor-name"></span></div>
          <div class="live-blank" id="lv-blank" hidden></div>
        </div></div>
        <aside class="live-side"><h4>Live actions <span class="live-instant" id="lv-instant">—</span></h4><ol class="live-events" id="lv-events"><li class="dim">Waiting for activity…</li></ol>
          <div class="live-data-clock" id="lv-data-clock"></div>
          <p class="dim small">Mirror aapke (admin) data se render hota hai; cursor, scroll, page aur clicks user ke browser se live aate hain. Typed text / passwords share nahi hote. Speed 0.5s par sabse instant view milta hai.</p></aside>
      </div></div>`);
    document.body.appendChild(modal);
    document.body.classList.add('no-scroll');
    live.modal = modal;
    U.$('#lv-cursor-name', modal).textContent = live.user;
    U.$('#lv-close', modal).addEventListener('click', stopWatch);
    U.$('#lv-mirror', modal).addEventListener('change', (e) => { live.mirror = e.target.checked; localStorage.setItem('ff_live_mirror', live.mirror ? '1' : '0'); live.lastPage = ''; tick(); });
    U.$('#lv-speed', modal).addEventListener('change', (e) => {
      live.speed = Math.max(500, Math.min(10000, Number(e.target.value) || 1000));
      clearInterval(live.timer);
      live.timer = setInterval(tick, live.speed);
      U.toast(`Live refresh ${(live.speed / 1000).toFixed(1)}s ✓`, 'ok');
    });
    document.addEventListener('keydown', escClose);
    window.addEventListener('resize', () => live.modal && fit(live.lastPerson), { passive: true });
    tick();
    live.timer = setInterval(tick, live.speed);
    // ⏱ "exact instant" clock — hamesha tick karta hai, chahe network call pending ho.
    live.clockTimer = setInterval(() => {
      if (!live.modal) { clearInterval(live.clockTimer); return; }
      const p = live.lastPerson;
      const el = U.$('#lv-fresh', live.modal), txt = U.$('#lv-fresh-text', live.modal);
      if (!el || !txt) return;
      if (!p) { el.className = 'live-fresh dot-off'; txt.textContent = 'offline'; return; }
      const f = freshness(p.updatedAt || p.lastSeen);
      el.className = `live-fresh ${f.cls}`;
      txt.innerHTML = `exact <span class="live-instant">${esc(exactClock(p.updatedAt || p.lastSeen))}</span> · ${esc(f.label)}`;
    }, 250);
  }

  function fit(person) {
    if (!live.modal) return;
    const stage = U.$('#lv-stage', live.modal), screen = U.$('#lv-screen', live.modal);
    const vw = (person && person.viewport && person.viewport.w) || 1280;
    const vh = (person && person.viewport && person.viewport.h) || 800;
    const scale = Math.min(stage.clientWidth / vw, stage.clientHeight / vh, 1);
    screen.style.width = `${vw}px`; screen.style.height = `${vh}px`;
    screen.style.transform = `scale(${scale})`;
    screen.style.left = `${Math.max(0, (stage.clientWidth - vw * scale) / 2)}px`;
    screen.style.top = `${Math.max(0, (stage.clientHeight - vh * scale) / 2)}px`;
  }

  function ripple(x, y) {
    const screen = U.$('#lv-screen', live.modal);
    const r = document.createElement('span');
    r.className = 'live-ripple'; r.style.left = `${x}%`; r.style.top = `${y}%`;
    screen.appendChild(r); setTimeout(() => r.remove(), 900);
  }

  async function tick() {
    if (!live.user || live.busy) return;
    live.busy = true;
    try {
      const out = await FF.auth.api(`/api/presence?user=${encodeURIComponent(live.user)}`);
      if (!live.modal) return;
      render(out.person);
    } catch (err) {
      if (live.modal) U.$('#lv-status', live.modal).textContent = `⚠️ ${err.message}`;
    } finally { live.busy = false; }
  }

  function render(p) {
    const m = live.modal;
    const status = U.$('#lv-status', m), pageEl = U.$('#lv-page', m), blank = U.$('#lv-blank', m), frame = U.$('#lv-frame', m), cursor = U.$('#lv-cursor', m), overlay = U.$('#lv-overlay', m);
    if (!p) {
      status.innerHTML = '<span class="presence-state">OFFLINE</span>';
      pageEl.textContent = 'Is user ki koi live activity nahi mili (app band hai ya sharing off hai).';
      blank.hidden = false; blank.textContent = '😴 User abhi app par nahi hai'; cursor.hidden = true;
      return;
    }
    live.lastPerson = p;
    live.lastRenderAt = Date.now();
    U.$('#lv-name', m).textContent = p.name || p.username;
    const online = p.online && p.visible !== false;
    // ⏱ exact instant — har render par ms-level timestamp (network lag bhi dikhta hai)
    status.innerHTML = `<span class="presence-state ${online && p.active ? 'live' : ''}">${online ? (p.active ? '● LIVE' : 'IDLE') : 'AWAY'}</span> <small class="dim">synced <span class="live-instant">${esc(exactClock(Date.now()))}</span></small>`;
    const inst = U.$('#lv-instant', m);
    if (inst) inst.textContent = `render ${exactClock(Date.now())} · poll ${(live.speed / 1000).toFixed(1)}s`;
    const clockBox = U.$('#lv-data-clock', m);
    if (clockBox) {
      const ffLoad = FF.store && FF.store.loadedAt ? exactClock(FF.store.loadedAt) : '—';
      const gvLoad = FF.gv && FF.gv.loadedAt ? exactClock(FF.gv.loadedAt) : '—';
      const today = U.dateKey(new Date());
      const daily = (FF.store && FF.store.get && FF.store.get('daily')) || [];
      const ffToday = daily.filter((r) => r.key === today && r.channel !== 'GV Partner').reduce((n, r) => n + (Number(r.n) || 0), 0);
      const gvRows = daily.filter((r) => r.channel === 'GV Partner' && r.key === today);
      const gvToday = gvRows.reduce((n, r) => n + (Number(r.n) || 0), 0);
      clockBox.innerHTML = `<div class="notify-line muted" style="border-radius:10px;margin-top:10px">
        <b style="color:#e2e8f0">Live data clock</b><br>
        FF sheet load <span class="live-instant">${esc(ffLoad)}</span> · GV sheet load <span class="live-instant">${esc(gvLoad)}</span><br>
        Aaj: <b style="color:#5eead4">FF ${ffToday}</b> · <b style="color:#5eead4">GV ${gvToday}</b> · total <b style="color:#fde047">${ffToday + gvToday}</b> tags
      </div>`;
    }
    m.classList.toggle('is-live', !!(online && p.active));
    pageEl.textContent = `${p.title || ''} · #/${p.page || ''}`;
    fit(p);
    // page mirror
    const page = String(p.page || 'home').replace(/^#?\/?/, '');
    if (live.mirror && page !== live.lastPage) {
      live.lastPage = page;
      const base = `${location.pathname}?embed=live#/${page}`;
      try {
        if (frame.contentWindow && frame.dataset.loaded === '1') frame.contentWindow.location.hash = `#/${page}`;
        else { frame.src = base; frame.onload = () => { frame.dataset.loaded = '1'; syncScroll(p); }; }
      } catch (_) { frame.src = base; }
    }
    frame.hidden = !live.mirror;
    blank.hidden = live.mirror && p.page;
    if (!live.mirror) blank.textContent = 'Page mirror off — sirf cursor + actions dikh rahe hain';
    syncScroll(p);
    // overlay (drawer / popup the user has open)
    overlay.hidden = !p.overlay; overlay.textContent = p.overlay ? `🗂 User ne khola hai: ${p.overlay}` : '';
    // cursor
    if (p.pointer && online) {
      cursor.hidden = false;
      cursor.style.left = `${p.pointer.x}%`; cursor.style.top = `${p.pointer.y}%`;
    } else cursor.hidden = true;
    // events
    const events = (p.events || []).filter((e) => e.at > live.lastEventAt);
    if (events.length) {
      const list = U.$('#lv-events', m);
      if (!live.lastEventAt) list.innerHTML = '';
      events.forEach((e) => {
        if (e.kind === 'click' && p.pointer && Date.now() - e.at < 4000) ripple(p.pointer.x, p.pointer.y);
        list.insertAdjacentHTML('afterbegin', `<li class="ev-${esc(e.kind)}"><span>${esc(({ click: '👆', page: '📄', search: '🔍', kpi: '📊', select: '🔽', tab: '🪟' })[e.kind] || '•')}</span><div><b>${esc(e.label)}</b><small><span class="live-instant">${esc(exactClock(e.at))}</span> · ${esc(freshness(e.at).label)}${e.page ? ` · ${esc(e.page)}` : ''}</small></div></li>`);
      });
      while (list.children.length > 80) list.lastElementChild.remove();
      live.lastEventAt = Math.max(...events.map((e) => e.at));
    }
  }

  function syncScroll(p) {
    if (!live.modal || !p || !p.scroll) return;
    const frame = U.$('#lv-frame', live.modal);
    try {
      const w = frame.contentWindow;
      if (!w || !w.document || !w.document.documentElement) return;
      const h = w.document.documentElement.scrollHeight;
      // Heights differ slightly (admin vs user data), so keep the same relative position.
      const y = p.scroll.h > 0 && h > 0 ? (p.scroll.y / p.scroll.h) * h : p.scroll.y;
      w.scrollTo({ top: y, behavior: 'smooth' });
    } catch (_) { /* cross-origin (should never happen) */ }
  }

  document.addEventListener('click', (e) => {
    const k = e.target.closest('[data-lv-kpi]');
    if (k) { e.preventDefault(); if (FF.kpiDetail) FF.kpiDetail.open({ scope: 'day', date: k.dataset.lvKpi, src: k.dataset.lvSrc || 'both', title: `Tags issued · ${U.labelDateKey(k.dataset.lvKpi)}` }); return; }
    const w = e.target.closest('[data-lv-watch]');
    if (w) { e.preventDefault(); watch(w.dataset.lvWatch); return; }
    if (e.target.closest('[data-lv-close]')) FF.app.closeDrawer();
  });

  FF.liveView = { openNotification, watch, stop: stopWatch };
})(window.FF);
