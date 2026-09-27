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
    if (item.meta && item.meta.link) { location.hash = item.meta.link; return; }
    const view = item.type === 'report' ? reportView(item)
      : (item.type === 'settings' || item.type === 'user') ? changesView(item)
        : activityView(item);
    FF.app.openDrawer({ ...view, wide: item.type === 'report' || item.type === 'settings' || item.type === 'user' });
  }

  // ---- 👁 Live view ------------------------------------------------------------------------------
  const live = { user: '', timer: null, modal: null, lastPage: '', lastEventAt: 0, mirror: true, busy: false };

  function stopWatch() {
    clearInterval(live.timer); live.timer = null;
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
        <div class="live-status" id="lv-status">…</div>
        <label class="live-toggle"><input type="checkbox" id="lv-mirror" ${live.mirror ? 'checked' : ''}> Page mirror</label>
        <button class="btn small" id="lv-close">✕ Close</button>
      </div>
      <div class="live-main">
        <div class="live-stage" id="lv-stage"><div class="live-screen" id="lv-screen">
          <iframe id="lv-frame" title="Live page mirror" tabindex="-1"></iframe>
          <div class="live-overlay-label" id="lv-overlay" hidden></div>
          <div class="live-cursor" id="lv-cursor" hidden><svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#ef4444" stroke="#fff" stroke-width="1.5"/></svg><span id="lv-cursor-name"></span></div>
          <div class="live-blank" id="lv-blank" hidden></div>
        </div></div>
        <aside class="live-side"><h4>Live actions</h4><ol class="live-events" id="lv-events"><li class="dim">Waiting for activity…</li></ol>
          <p class="dim small">Mirror aapke (admin) data se render hota hai; cursor, scroll, page aur clicks user ke browser se live aate hain. Typed text / passwords share nahi hote.</p></aside>
      </div></div>`);
    document.body.appendChild(modal);
    document.body.classList.add('no-scroll');
    live.modal = modal;
    U.$('#lv-cursor-name', modal).textContent = live.user;
    U.$('#lv-close', modal).addEventListener('click', stopWatch);
    U.$('#lv-mirror', modal).addEventListener('change', (e) => { live.mirror = e.target.checked; localStorage.setItem('ff_live_mirror', live.mirror ? '1' : '0'); live.lastPage = ''; tick(); });
    document.addEventListener('keydown', escClose);
    window.addEventListener('resize', () => live.modal && fit(live.lastPerson), { passive: true });
    tick();
    live.timer = setInterval(tick, 1000);
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
    U.$('#lv-name', m).textContent = p.name || p.username;
    const online = p.online && p.visible !== false;
    status.innerHTML = `<span class="presence-state ${online && p.active ? 'live' : ''}">${online ? (p.active ? '● LIVE' : 'IDLE') : 'AWAY'}</span> <small class="dim">updated ${esc(U.timeLabel(p.updatedAt || p.lastSeen))}</small>`;
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
        list.insertAdjacentHTML('afterbegin', `<li class="ev-${esc(e.kind)}"><span>${esc(({ click: '👆', page: '📄', search: '🔍', kpi: '📊', select: '🔽', tab: '🪟' })[e.kind] || '•')}</span><div><b>${esc(e.label)}</b><small>${esc(new Date(e.at).toLocaleTimeString('en-IN'))}${e.page ? ` · ${esc(e.page)}` : ''}</small></div></li>`);
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
