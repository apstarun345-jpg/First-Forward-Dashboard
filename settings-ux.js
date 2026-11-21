/* v3.125.394 — settings-ux.js: Settings page ka design-system upgrade (non-destructive — settings.js ke inputs / handlers wahi rehte hain).
   • colourful tab groups  • search ke neeche quick-jump suggestions  • user cards: chips + samajhne layak Permissions panel (search · group on/off · sensitive flag · meter) */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const D = document;
  const $ = (s, r) => (r || D).querySelector(s), $$ = (s, r) => [...(r || D).querySelectorAll(s)];
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GCOL = ['#2563eb', '#059669', '#7c3aed', '#ec4899', '#f97316'];
  const TAB_G = { account: 0, sound: 0, sources: 1, data: 1, direct: 1, rules: 1, users: 2, access: 2, links: 2, audit: 2, features: 3, contacts: 3, brand: 3, diagnostics: 4, backup: 4 };
  const PG = [[/^pages?$/i, '📄', '#2563eb'], [/professional|insight/i, '💎', '#7c3aed'], [/^management/i, '🛠', '#4f46e5'], [/first forward$/i, '🟦', '#0ea5e9'], [/gv partner$/i, '🟩', '#16a34a'], [/^reports?/i, '📊', '#d97706'], [/cross/i, '🔀', '#ec4899'], [/^actions?/i, '⚡', '#f97316'], [/^settings?/i, '⚙️', '#475569'], [/sheets.*first/i, '📗', '#059669'], [/sheets.*gv/i, '📘', '#0369a1']];
  const SENS = /mobile number|payout|payslip|csv|excel|force refresh|branding|data source|direct agents rule|thresholds|features|sheets & tabs|voice assistant|upload|import/i;
  const POPULAR = ['users', 'brand', 'sources', 'features', 'rules', 'account', 'access', 'audit'];
  const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private */ } } };

  // ---- tab group colours ---------------------------------------------------------------------------
  function paintTabs(root) {
    $$('#set-tabs .set-group', root).forEach((g) => { const b = $('.seg-btn', g); const i = b ? (TAB_G[b.dataset.tab] || 0) : 0; g.style.setProperty('--sg', GCOL[i]); });
  }
  // ---- quick-jump suggestions ------------------------------------------------------------------------
  function suggest(root) {
    const box = $('.set-search', root), input = $('#set-search', root); if (!box || !input) return;
    let el = $('#set-suggest', root);
    const btns = $$('#set-tabs .seg-btn', root); if (!btns.length) return;
    const by = new Map(btns.map((b) => [b.dataset.tab, b]));
    const recent = (LS.get('ff_set_recent') || []).filter((k) => by.has(k)).slice(0, 3);
    const order = [...recent, ...POPULAR.filter((k) => !recent.includes(k) && by.has(k))].slice(0, 8);
    const sig = order.join(',') + '|' + (D.querySelector('#set-tabs .seg-btn.on') || {}).dataset?.tab;
    if (!el) { el = D.createElement('div'); el.id = 'set-suggest'; box.insertAdjacentElement('afterend', el); }
    if (el.dataset.sig === sig) return; el.dataset.sig = sig;
    el.innerHTML = `<span class="sx-lbl">⚡ Seedha jao</span>` + order.map((k) => { const b = by.get(k); const col = GCOL[TAB_G[k] || 0]; return `<button type="button" data-go="${esc(k)}" style="--c:${col}" title="${esc(b.textContent.trim())} kholo">${esc(b.textContent.trim())}${recent.includes(k) ? ' <small>↺</small>' : ''}</button>`; }).join('');
  }
  D.addEventListener('click', (e) => {
    const g = e.target.closest && e.target.closest('#set-suggest [data-go]');
    if (g) { const b = $(`#set-tabs .seg-btn[data-tab="${g.dataset.go}"]`); if (b) { b.click(); const inp = $('#set-search'); if (inp) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); } window.scrollTo({ top: 0, behavior: 'smooth' }); } return; }
    const t = e.target.closest && e.target.closest('#set-tabs .seg-btn');
    if (t) { const r = (LS.get('ff_set_recent') || []).filter((k) => k !== t.dataset.tab); r.unshift(t.dataset.tab); LS.set('ff_set_recent', r.slice(0, 6)); setTimeout(() => suggest(D), 60); }
  }, true);
  D.addEventListener('input', (e) => { if (e.target && e.target.id === 'set-search') { const s = $('#set-suggest'); if (s) s.hidden = !!e.target.value.trim(); } }, true);

  // ---- permissions panel -----------------------------------------------------------------------------
  function splitLabel(text, grp) {
    let t = String(text).replace(/\s+/g, ' ').trim();
    t = t.replace(new RegExp('^' + grp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[·:–-]\\s*', 'i'), '');
    t = t.replace(/^(Management|First Forward|GV Partner|Reports|Cross-channel|Settings|Sheet|Professional Insights)\s*·\s*/i, '');
    const m = /^([^(]+?)\s*\((.+)\)\s*$/.exec(t);
    return m ? { title: m[1].trim(), hint: m[2].trim() } : { title: t, hint: '' };
  }
  function meter(card) {
    const all = $$('[data-perm]', card), on = all.filter((c) => c.checked).length, total = all.length || 1;
    const admin = ($('[data-field="role"]', card) || {}).value === 'admin';
    const cnt = $('.pmx-count', card); if (cnt) cnt.textContent = admin ? 'Sab (admin)' : `${on}/${all.length}`;
    const bar = $('.pmx-meter i', card); if (bar) bar.style.width = `${admin ? 100 : Math.round(on * 100 / total)}%`;
    const sm = $('details.user-perms > summary', card); if (sm && !admin) sm.textContent = `🔐 Permissions (${on}/${all.length})`;
    $$('.perm-group', card).forEach((g) => { const gi = $$('[data-perm]', g), gc = gi.filter((c) => c.checked).length; const em = $('.pmx-gh em', g); if (em) em.textContent = `${gc}/${gi.length}`; });
    const pc = $('.pmx-pc', card); if (pc) pc.textContent = admin ? '🔐 Admin — sab access' : `🔐 ${on}/${all.length} permissions`;
  }
  function filter(card) {
    const q = (($('.pmx-q', card) || {}).value || '').toLowerCase().trim(), mode = ($('.pmx-acts [data-f].on', card) || { dataset: {} }).dataset.f || '';
    $$('.perm-group', card).forEach((g) => {
      let any = 0;
      $$('label.check', g).forEach((l) => {
        const cb = $('input', l); const txt = l.textContent.toLowerCase();
        const ok = (!q || txt.includes(q)) && (mode !== 'on' || cb.checked) && (mode !== 'off' || !cb.checked) && (mode !== 'sens' || l.dataset.sens === '1');
        l.classList.toggle('pmx-hide', !ok); if (ok) any++;
      });
      g.classList.toggle('pmx-hide', !any);
    });
  }
  function enhanceCard(card) {
    if (card.dataset.pmx) return; const boxes = $('.perm-boxes', card); if (!boxes) return; card.dataset.pmx = '1';
    const role = ($('[data-field="role"]', card) || {}).value || 'user'; card.dataset.role = role;
    // chips row
    const meta = $('.user-meta', card), bell = $('[data-field="notifyAccess"]', card), act = $('[data-field="approved"]', card);
    if (meta && !$('.pmx-chips-row', card)) {
      const row = D.createElement('div'); row.className = 'pmx-chips-row';
      row.innerHTML = `<span class="pmx-chip ${role === 'admin' ? 'warn' : 'info'}">${role === 'admin' ? '👑 Admin' : '👤 User'}</span><span class="pmx-chip ${act && act.checked ? 'ok' : 'warn'}">${act && act.checked ? '✅ Active' : '⏳ Pending'}</span><span class="pmx-chip ${bell && !bell.checked ? 'bad' : 'ok'}" title="Bell off ho tab bhi robot / live screen ko is user ki activity milti hai">${bell && !bell.checked ? '🔕 Bell band' : '🔔 Bell on'}</span><span class="pmx-chip vio pmx-pc"></span>`;
      meta.appendChild(row);
      if (bell) bell.addEventListener('change', () => { const c = $$('.pmx-chip', row)[2]; if (c) { c.className = `pmx-chip ${bell.checked ? 'ok' : 'bad'}`; c.textContent = bell.checked ? '🔔 Bell on' : '🔕 Bell band'; } });
      if (act) act.addEventListener('change', () => { const c = $$('.pmx-chip', row)[1]; if (c) { c.className = `pmx-chip ${act.checked ? 'ok' : 'warn'}`; c.textContent = act.checked ? '✅ Active' : '⏳ Pending'; } });
    }
    // groups
    $$('.perm-group', boxes).forEach((g) => {
      const name = ($('small', g) || {}).textContent || ''; const hit = PG.find(([re]) => re.test(name.trim())) || [0, '🔹', '#64748b'];
      g.style.setProperty('--pg', hit[2]);
      const gh = D.createElement('div'); gh.className = 'pmx-gh'; gh.innerHTML = `<span>${hit[1]}</span><b>${esc(name)}</b><em></em><button type="button" data-g="all" title="Is group ke sab on">Sab</button><button type="button" data-g="none" title="Is group ke sab off">Koi nahi</button>`;
      g.insertBefore(gh, g.firstChild);
      $$('label.check', g).forEach((l) => {
        const cb = $('input', l); if (!cb) return; const { title, hint } = splitLabel(l.textContent, name.trim());
        const sens = SENS.test(l.textContent); if (sens) l.dataset.sens = '1';
        l.textContent = ''; l.appendChild(cb); const tx = D.createElement('span'); tx.className = 'pmx-tx';
        tx.innerHTML = `<b>${esc(title)}${sens ? '<i class="pmx-sens" title="Sensitive — soch ke do">⚠ sensitive</i>' : ''}</b>${hint ? `<small>${esc(hint)}</small>` : ''}`; l.appendChild(tx);
      });
    });
    // toolbar
    const bar = D.createElement('div'); bar.className = 'pmx-bar';
    bar.innerHTML = `<b class="pmx-count"></b><div class="pmx-meter"><i></i></div><input class="pmx-q" type="search" placeholder="🔍 Permission dhoondo — jaise mobile, CSV, stock, address" autocomplete="off"><div class="pmx-acts"><button type="button" data-a="all" style="--k:#16a34a">✅ Sab on</button><button type="button" data-a="none" style="--k:#dc2626">🚫 Sab off</button><button type="button" data-a="default" style="--k:#2563eb">↺ Default set</button><button type="button" data-f="on" style="--k:#0891b2">Sirf on</button><button type="button" data-f="off" style="--k:#64748b">Sirf off</button><button type="button" data-f="sens" style="--k:#d97706">⚠ Sensitive</button></div>`;
    boxes.insertAdjacentElement('beforebegin', bar);
    bar.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]'), f = e.target.closest('[data-f]');
      if (a) { const map = { all: '[data-perm-all]', none: '[data-perm-none]', default: '[data-perm-default]' }; const o = $(map[a.dataset.a], card); if (o) o.click(); setTimeout(() => meter(card), 0); }
      if (f) { const was = f.classList.contains('on'); $$('[data-f]', bar).forEach((x) => x.classList.remove('on')); if (!was) f.classList.add('on'); filter(card); }
    });
    $('.pmx-q', bar).addEventListener('input', () => filter(card));
    boxes.addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; const g = b.closest('.perm-group'); $$('[data-perm]', g).forEach((c) => { if (!c.disabled) { c.checked = b.dataset.g === 'all'; c.dispatchEvent(new Event('change', { bubbles: true })); } }); meter(card); });
    boxes.addEventListener('change', () => meter(card));
    const roleSel = $('[data-field="role"]', card); if (roleSel) roleSel.addEventListener('change', () => { card.dataset.role = roleSel.value; setTimeout(() => meter(card), 0); });
    meter(card);
  }
  function run() {
    const root = $('.page-settings'); if (!root) return;
    paintTabs(root); suggest(root); $$('.user-card', root).forEach(enhanceCard);
  }
  let raf = 0;
  function init() {
    const m = $('#main'); if (!m) { setTimeout(init, 400); return; }
    new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; run(); }); }).observe(m, { childList: true, subtree: true });
    run();
  }
  FF.settingsUx = { run, splitLabel };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})(window.FF);
