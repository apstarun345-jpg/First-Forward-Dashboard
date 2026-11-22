/* v3.125.419 — 🧱 Style guide (admin) — #/styleguide. Saare components ek jagah: naya page banate waqt yahi se uthao. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const sec = (t, body) => `<div class="card sg-sec"><div class="card-head"><h3>${t}</h3></div><div class="card-body">${body}</div></div>`;
  function render(root) {
    if (!FF.auth || !FF.auth.isAdmin || !FF.auth.isAdmin()) { root.innerHTML = '<div class="card"><div class="card-body">Admin only.</div></div>'; return; }
    const sw = [['--brand', 'Brand'], ['--brand-2', 'Brand 2'], ['--ds-ok', 'OK'], ['--ds-warn', 'Warn'], ['--ds-bad', 'Bad'], ['--ds-info', 'Info']].map(([v, n]) => `<div class="sg-sw" style="background:var(${v})">${n}<br>${v}</div>`).join('');
    const icons = (FF.icons ? FF.icons.names : []).map((n) => `<div class="sg-ico">${FF.icons.get(n, 24)}${n}</div>`).join('');
    root.innerHTML = `<div class="page-head"><h1 class="ds-h1">🧱 Style guide</h1><p class="sub">Tokens, components, states, motion — design system ka reference.</p></div>
      ${sec('Colors', `<div class="sg-grid">${sw}</div>`)}
      ${sec('Typography scale', '<div class="ds-h1">H1 — 32 / 800</div><div class="ds-h2">H2 — 24 / 800</div><div class="ds-h3">H3 — 18 / 700</div><div class="ds-body">Body — 14 / 1.5 · 1,23,456 tabular numbers</div><div class="ds-small">Small — 12.5</div><div class="ds-cap">Caption</div>')}
      ${sec('Buttons & states', '<div class="sg-row"><button class="btn primary">Primary</button><button class="btn">Default</button><button class="btn small">Small</button><button class="btn" disabled>Disabled</button><button class="btn is-loading">Loading</button><button class="btn" id="sg-copy">📋 Copy</button></div>')}
      ${sec('Inputs & states', '<div class="sg-row"><input class="input" placeholder="Normal"><input class="input is-error" placeholder="Error"><select class="input"><option>Select</option></select></div>')}
      ${sec('Badges / status', '<div class="sg-row"><span class="tag gv">GV</span><span class="tag ff">FF</span><span class="badge-vc vc4" data-vc="vc4">VC4</span><span class="badge-vc vc20" data-vc="vc20">VC20</span></div>')}
      ${sec('KPI card + skeleton', `<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)"><div class="kpi g1"><div class="kpi-top"><span class="kpi-title">Sample KPI</span><span class="kpi-icon">🏷️</span></div><div class="kpi-value">12,345</div><div class="kpi-foot">tabular · count-up · ripple</div></div></div>${U.spinner('Skeleton sample…')}`)}
      ${sec('Table', '<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Agent</th><th class="num">Tags</th></tr></thead><tbody><tr class="clickable"><td>Row hover</td><td class="num">1,234</td></tr><tr class="clickable"><td>Clean rows</td><td class="num">987</td></tr></tbody></table></div>')}
      ${sec('Icons', `<div class="sg-grid">${icons}</div>`)}
      ${sec('Motion', '<div class="sg-row"><button class="btn" id="sg-conf">🎉 Confetti</button><button class="btn" id="sg-chime">🔔 Chime (sound ON chahiye)</button><button class="btn" id="sg-clean">🧹 Clean stale data now</button></div><p class="dim small" id="sg-out"></p>')}`;
    const on = (id, fn) => { const b = root.querySelector(id); if (b) b.addEventListener('click', fn); };
    on('#sg-conf', () => FF.motion && FF.motion.confetti && FF.motion.confetti());
    on('#sg-chime', () => FF.motion && FF.motion.chime && FF.motion.chime('win'));
    on('#sg-clean', async () => { const o = root.querySelector('#sg-out'); o.textContent = 'Saaf ho raha hai…'; try { const r = await FF.janitor.run(true); o.textContent = `Hata: ${r.ls} stale browser keys · ${r.ss} session keys · ${r.caches} purane cache. Login cookie safe rakhi.`; } catch (e) { o.textContent = String(e && e.message || e); } });
  }
  FF.pages.styleguide = { title: 'Style guide', render };
})(window.FF);
