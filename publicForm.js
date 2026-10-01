/* 🌐 PUBLIC EMPLOYEE TAG REQUEST (v3.27) — bina login wala form.
 *
 * Kyun: employees ko tag request lagane ke liye account banana/lena padta tha. Ab admin ek link
 * share karta hai —
 *
 *      https://<app>/tag-request          (ya  https://<app>/#/tagRequest?public=1)
 *
 * — jo koi bhi khol sakta hai: koi login nahi, koi signup nahi. Upar sirf **Employee name**
 * mandatory hai (mobile/branch optional, Settings se on/off), phir wahi form — agent search →
 * class-wise qty → system check (stock/issuance/priority/suggestion) → submit. Request admin ke
 * "🏷️ Tag Request" section me 'employee link' badge ke saath aati hai, aur Google Sheet sync bhi
 * chalti hai (agar admin ne ON ki ho).
 *
 * Data: public form sirf /api/public/gviz se padhta hai (server side scoped + throttled — EIR par
 * sirf aggregated queries). Public link se dashboard ka koi doosra page nahi khulta.
 */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const state = { config: null, error: '', at: 0 };

  /** Is URL par public form chalana hai? (clean path ya purana hash wala link) */
  function active() {
    try {
      const path = String(location.pathname || '').replace(/\/+$/, '').toLowerCase();
      if (path === '/tag-request' || path === '/employee-tag-request') return true;
      const hash = String(location.hash || '');
      if (/tagrequest/i.test(hash) && /(^|[?&])public=1(&|$)/.test(hash)) return true;
    } catch { /* SSR / test env */ }
    return false;
  }

  async function api(path, method, body) {
    const res = await fetch(path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin', cache: 'no-store'
    });
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    if (!res.ok) { const err = new Error((json && json.error) || `HTTP ${res.status}`); err.status = res.status; throw err; }
    return json || {};
  }

  /** Login screen ki jagah public form ka shell — sidebar/topbar chhupa hua (body.public-form). */
  function shell() {
    document.body.classList.add('public-form');
    const boot = U.$('#app-boot'); if (boot) boot.remove();
    const main = U.$('#main');
    if (main) main.innerHTML = '';
    return main;
  }

  function messageCard(title, body, extra) {
    return `<section class="card tr-public-msg"><div class="card-body">
      <h2 style="margin:0 0 6px">${title}</h2>
      <p class="dim" style="margin:0 0 10px">${body}</p>${extra || ''}</div></section>`;
  }

  async function boot() {
    const main = shell();
    try { document.title = 'Tag Request · Employee form'; } catch { /* ignore */ }
    if (main) main.innerHTML = `<div class="tr-public-wrap">${U.spinner('Tag request form khul raha hai…')}</div>`;
    let cfg;
    try {
      const out = await api('/api/public/tag-request');
      cfg = (out && out.config) || {};
      state.config = cfg; state.at = Date.now();
    } catch (err) {
      if (main) main.innerHTML = `<div class="tr-public-wrap">${messageCard('⚠️ Form load nahi hua', esc(err.message || 'Server se baat nahi hui.'),
        '<button class="btn primary" onclick="location.reload()">↻ Dobara koshish karo</button>')}</div>`;
      return false;
    }
    if (cfg.brand) { const b = U.$('#brand-name'); if (b) b.textContent = cfg.brand; }
    if (cfg.enabled === false) {
      if (main) main.innerHTML = `<div class="tr-public-wrap">${messageCard('🔒 Ye form abhi band hai',
        'Admin ne employee link filhaal OFF kar rakha hai. Apne manager se naya link maango.')}</div>`;
      return false;
    }
    // Public form ka data sirf scoped public proxy se aata hai (login wala /api/gviz band rehta hai).
    FF.config.proxyPath = '/api/public/gviz';
    try {
      if (FF.lazy && FF.lazy.ensure) await FF.lazy.ensure('tagRequest');
    } catch { /* neeche check */ }
    if (!FF.pages || !FF.pages.tagRequest) {
      if (main) main.innerHTML = `<div class="tr-public-wrap">${messageCard('⚠️ Form module load nahi hua',
        'Internet check karke dobara try karo.', '<button class="btn primary" onclick="location.reload()">↻ Retry</button>')}</div>`;
      return false;
    }
    const root = document.createElement('div');
    root.className = 'page page-tagRequest tr-public-page';
    if (main) main.replaceChildren(root);
    document.body.classList.add('ready');
    try {
      await FF.pages.tagRequest.render(root, { view: 'form', public: '1' }, { publicConfig: cfg });
    } catch (err) {
      console.error(err);
      root.innerHTML = messageCard('⚠️ Form render nahi hua', esc(err.message || ''));
    }
    return true;
  }

  FF.publicForm = { active, boot, api, get config() { return state.config; } };
})(window.FF);
