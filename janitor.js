/* v3.125.419 — 🧹 Janitor: roz ek baar purana/stale browser data saaf. Login cookie (HttpOnly, server-set) ko NAHI chhoota.
   Rule: localStorage/sessionStorage ke `ff*`/`apna*` keys jo ab code me kahin use nahi hote (hata diye feature) + din-wale purane keys.
   Cache Storage: sirf `apnapayment-v<N>` ka sabse naya rakhta hai. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const KNOWN = new Set(["Apna", "ApnaPayment", "FF-Dashboard", "FF-TL", "FF-only", "FF-side", "FF.charts", "FF.config.ffIssuanceLagDays", "FF.filters", "FF.gv", "FF.kpiDetail", "FF.model", "FF.officeBell.voiceOn", "FF.pages", "FF.store", "FF.store.daily", "FF.store.loadedAt", "FF.unusual.probeCards", "FF.unusualScan", "FF.util", "FF0D9488", "FF0F766E", "FF14532D", "FF15803D", "FF16A34A", "FF1D4ED8", "FF1F2937", "FF2563EB", "FF475569", "FF4F46E5", "FF6B7280", "FF7C3AED", "FF:", "FFB45309", "FFB91C1C", "FFD97706", "FFDC2626", "FFDCFCE7", "FFE0E7FF", "FFE5E7EB", "FFEA580C", "FFECFDF5", "FFEDE9FE", "FFEFF6FF", "FFF3F4F6", "FFF5F3FF", "FFF8FAFC", "FFFDF2F8", "FFFEF2F2", "FFFEF3C7", "FFFFEDD5", "FFFFFFFF", "apna", "apna-a", "apna-company-label", "apna-logo-wrap", "apna-sub", "apna-text-logo", "apna-top", "apna-tri", "apnapayment-app-storage", "ff-", "ff-3d", "ff-agent", "ff-allocated", "ff-asset-versions", "ff-authoritative-issuance-mismatch", "ff-badge", "ff-brief-day", "ff-cc-style", "ff-class-daily-mismatch", "ff-client-mode", "ff-diag-repairs", "ff-diag-style", "ff-diagnostic-control-fixed", "ff-diagnostic-fixed", "ff-diagnostic-kpi-fixed", "ff-direct", "ff-dispatch-planner-state", "ff-eir", "ff-employee-name", "ff-greeted", "ff-home-issuance-explorer-v1", "ff-ico", "ff-issued", "ff-keys-card", "ff-keys-head", "ff-keys-opt", "ff-keys-sheet", "ff-keys-tbl", "ff-kpi-colors", "ff-leaflet-css", "ff-levelup", "ff-lite", "ff-local-test", "ff-login", "ff-mascot", "ff-native-device-lock", "ff-no-anim", "ff-no-latest-date", "ff-notification", "ff-office-bell", "ff-office-bell-log", "ff-office-bell-nudge", "ff-office-bell-nudge-ok", "ff-office-bell-prefs", "ff-office-bell-voice", "ff-offline-bar", "ff-push", "ff-push-flush", "ff-push-resubscribe", "ff-robot", "ff-robot-ext", "ff-robot-page", "ff-saved-view-empty", "ff-saved-view-form", "ff-saved-view-list", "ff-saved-view-name", "ff-saved-view-open", "ff-saved-view-row", "ff-saved-view-save-row", "ff-saved-views", "ff-saved-views-backdrop", "ff-saved-views-card", "ff-saved-views-foot", "ff-saved-views-head", "ff-saved-views-title", "ff-scrolled", "ff-speak-push", "ff-stale-snapshot", "ff-stock", "ff-switch", "ff-switch-knob", "ff-test", "ff-tl", "ff-voice-ack", "ff-voice-closed", "ff-voice-prefs", "ff-voice-v1", "ff-war-leader", "ff-wow-seen", "ff1", "ff2", "ff:active", "ff:class", "ff:cur", "ff:data-fresh", "ff:data-loaded", "ff:lost", "ff:notify", "ff:proj", "ff:stock", "ff:top5", "ff:up", "ffAgentSummary", "ffBtsAuditV1", "ffClasses", "ffCommission", "ffCommission.categoryCol", "ffCommission.dateCol", "ffCommission.earnedCol", "ffCommission.rateCol", "ffFmJob", "ffFmJobDone", "ffFmSheetCfg", "ffIssuanceLagDays", "ffMascotWakeV2", "ffOps.brief", "ffOps.ctx", "ffOps.dqSeen", "ffOps.fb", "ffOps.follow", "ffOps.seen", "ffOps.tower", "ffPayout", "ffPayout.classCol", "ffPayout.gid", "ffPayout.labelCol", "ffPayout.penaltyCol", "ffPayout.rateCol", "ffPayout.sheet", "ffReport", "ffStock", "ffToday", "ff_a11y", "ff_avatar_size", "ff_bento", "ff_brand_cache", "ff_density", "ff_desk_default_v1", "ff_desk_default_v2", "ff_diag_attr_repairs", "ff_diag_history", "ff_diag_repairs", "ff_dspst", "ff_fav_agents", "ff_feed_sig", "ff_fest", "ff_fm_tab", "ff_focus_mode", "ff_fresh_alert_dismiss", "ff_global_filters", "ff_janitor_at", "ff_kyc", "ff_lang", "ff_live_mirror", "ff_loader_style", "ff_loc_prompt", "ff_lowstock_dismissed", "ff_mascot_hist_v1", "ff_mascot_v1", "ff_mic_permission_asked", "ff_ms_recent", "ff_nav_group", "ff_notify_permission_asked", "ff_notify_prefs", "ff_notify_sound", "ff_onboarding_seen", "ff_presence_pointer", "ff_public_employee", "ff_public_tag_live_share_v1", "ff_public_tag_request_visit_v1", "ff_pw_banner_hide", "ff_rail", "ff_recent", "ff_recent_stock", "ff_saved_views_v1", "ff_sc_alerts_collapsed", "ff_set_recent", "ff_sidebar_auto", "ff_skip_workspace_boot_once", "ff_sound", "ff_speed_prefs", "ff_storage_secret", "ff_storage_url", "ff_ta_collapsed", "ff_ta_dismissed", "ff_table_density", "ff_theme", "ff_theme_explicit", "ff_theme_pack", "ff_theme_scope_migrated_v1", "ff_tr_agent_contacts", "ff_tr_cards2", "ff_tr_cards_detail", "ff_tr_courier", "ff_tr_draft_", "ff_tr_employee_token", "ff_ua_scan_", "ff_user", "ff_ux_3d", "ff_ux_den", "ff_viewas", "ffa-alerts-csv", "ffa-alerts-wa", "ffc-date-range", "ffc-export", "ffc-fix-range", "ffc-fresh", "ffc-fresh-top", "ffc-heading-csv", "ffc-payout-csv", "ffc-payout-xlsx", "ffc-search", "ffc-slab-csv", "ffc-tl-csv", "ffc-tools", "ffdash-sheets", "ffdash-snap", "ffl", "ffl-ell", "ffp-payout-copy", "ffp-payout-csv", "ffp-payout-xlsx", "fftl", "ffvsgv"]);
  const PREFIX = ["FF.store.", "FF:", "ff-", "ff-b-", "ff-commission-", "ff-commission-payout-", "ff-commission-tl-rollup-", "ff-dataset-", "ff-full-backup-", "ff-payout-class-rates-", "ff-payout-reconciliation-", "ff-report-commission-headings-", "ff-robot-", "ff-settings-", "ff-slab-reconciliation-", "ff-suggest-", "ff:", "ff_champ_", "ff_cols:", "ff_home_layout:", "ff_img_size_", "ff_rec_", "ff_recent_", "ff_stk_", "ff_stk_alert_", "ff_stk_snd_", "ff_tr_draft_", "ff_ua_scan_"];
  const OWN = /^(ff|FF|apna|Apna)/;
  const DATED = /^(ff_stk_alert_|ff_stk_snd_|ff_rec_)(\d{4}-\d{2}-\d{2})$/;
  function keep(k) {
    if (KNOWN.has(k)) return true;
    for (const p of PREFIX) if (k.startsWith(p)) return true;
    for (const l of KNOWN) { if (k.length > l.length && k.startsWith(l) && !/[A-Za-z0-9]/.test(k[l.length])) return true; }   // `ff_dspst|id`, `ff_x:id` jaisi composed keys
    return false;
  }
  function sweep(store, today) {
    let n = 0; if (!store) return 0;
    const keys = []; for (let i = 0; i < store.length; i++) keys.push(store.key(i));
    keys.forEach((k) => {
      if (!OWN.test(k)) return;
      const d = DATED.exec(k);
      if ((d && d[2] !== today) || (!d && !keep(k))) { try { store.removeItem(k); n++; } catch { /* ignore */ } }
    });
    return n;
  }
  async function run(force) {
    const today = new Date().toISOString().slice(0, 10);
    try { if (!force && localStorage.getItem('ff_janitor_at') === today) return { ls: 0, ss: 0, caches: 0, skipped: true }; } catch { /* storage blocked */ }
    let ls = 0, ss = 0, c = 0;
    try { ls = sweep(window.localStorage, today); } catch { /* blocked */ }
    try { ss = sweep(window.sessionStorage, today); } catch { /* blocked */ }
    try {
      if (window.caches) {
        const names = (await caches.keys()).filter((n) => /^apnapayment-v\d+$/.test(n)).sort((a, b) => Number(a.split('-v')[1]) - Number(b.split('-v')[1]));
        for (const n of names.slice(0, -1)) { if (await caches.delete(n)) c++; }
      }
    } catch { /* ignore */ }
    try { localStorage.setItem('ff_janitor_at', today); } catch { /* ignore */ }
    return { ls, ss, caches: c };
  }
  FF.janitor = { run, keep };
  setTimeout(() => { run(false).catch(() => {}); }, 25e3);
})(window.FF);
