# Dashboard diagnostic report

**Date:** 25 November 2026  
**Fix release:** v3.125.517  
**Scope:** First Forward / GV loading, live refresh, combined reports, exports, automated tests and local synthetic-data route smoke checks.

## Confirmed issues fixed

| Issue | User impact | Fix |
|---|---|---|
| Home ignored periodic feed responses once `source` became `master`; polling also required a successful initial feed | GV live cards could stop reflecting newer data while Home remained open, or not recover through scheduled polling | Apply fresh scheduled responses regardless of the initial source; allow scheduled recovery; prevent overlapping refreshes |
| GV today-detail sync did not trigger a Home repaint and had no request deadline | New detail data could remain invisible; a stalled request could block a non-overlapping refresh loop | Reapply the current Master snapshot after sync; abort detail fetches after 15 seconds; detect day changes as updates |
| Combined FF/GV report painted only after both profile promises returned | A slow channel concealed the ready channel behind a loader | Paint each channel as it arrives; explicitly label combined totals partial until both initial results arrive |
| Issuance-only reports reused the full report's pending stock-prefetch promise | Growth/current-month issuance could wait up to 25 seconds for unrelated stock data | Separate issuance-only work from full-report stock waiting; retain normal same-request cache reuse |

### Accuracy safeguards

- Late initial or stale feed responses cannot replace a healthy, more complete Master snapshot.
- Old highest-issuer details are cleared when a newer aggregate is applied, then restored only when the available detailed snapshot covers that aggregate.
- Master refreshes rebase the current row stream rather than the initial render's row stream; today's GV rows replace, not duplicate, today's existing GV rows.
- Refreshes remain subject to Settings cadence, skip hidden tabs, and stop when the Home root is detached.
- No production sheets, user permissions, source mappings or business records were edited during this diagnostic.

## Validation results

### Broad diagnostic scan

`npm run check` passed. A full `npm test` diagnostic run completed with:

- **1,151 reported tests**
- **1,142 passed**
- **7 failed**
- **2 skipped**

This was the broad investigation run, not an all-green final release run. Every failure listed below was reproduced against a separate, untouched extraction of baseline commit `78b3a22`; none was introduced by this round's fixes.

| Existing failure location | Observed finding / next action |
|---|---|
| `dev/regression.test.js` | Storage-health assertion expects an immediate error; current banner policy suppresses errors for five minutes. The rollback assertion before it passed. Reconcile diagnostic-vs-banner timing without weakening persistence checks. |
| `dev/shards.test.js` | `dev/styles-full.css` and deployed CSS chunks differ. Review source-of-truth drift before regenerating CSS; blind regeneration could undo current styling. |
| `dev/sw-version-and-pl-session.test.js` | Starting baseline package/service-worker versions differed. Newer main already corrected this; this release keeps both aligned and its version test passes. |
| `dev/ui-polish.test.js` | Test requires polish CSS to be the final stylesheet, but later UX layers now load after it. Review intended cascade rather than reorder production CSS blindly. |
| `dev/v365-theme-packs.test.js` | Exact chart-palette declaration count is 15 versus expected 13. Review extra overrides; pack-by-pack assertions preceding it passed. |
| `dev/v502-click-speed-complaints.test.js` | Source-pattern assertion still requires the old blocking selected-person `await buildLight()` flow. Functional cold-index selection tests cover the newer non-blocking behavior. |
| `dev/wow.test.js` | Standalone test lacks browser setup required by the current WOW module. Repair the harness before interpreting it as a user-facing error. |

These unresolved checks are **not** a clean bill of health and have not been silently skipped or weakened in the repository.

### Final focused validation

After merging the then-current main (`203d781`) into the current working branch and applying the fixes/release metadata:

- `npm run check`: **passed**.
- Focused Home/GV/profile/report/service-worker regression selection: **65 passed, 0 failed**.
- Includes five new behavioral regression tests covering ready-channel rendering, independent issuance fetching, live polling/recovery, stale-feed protection and hung-request cancellation/day rollover.
- The entire long-running suite was not rerun after the final edits; final validation is the focused selection above.

### Synthetic route smoke comparison

The original `dev/smoke.js` stops before route checks because its fake browser lacks `screen` / `NodeFilter` and related primitives. For investigation only, a temporary copy supplied the missing browser mocks; the checked-in smoke tool was not modified.

- Working tree: **139 checks passed, 28 checks failed**.
- Untouched baseline extraction with the same temporary mocks: **139 passed, 28 failed**.
- Failure labels matched between the two runs. Several checks reference retired pages, old UI wording or fixture identities; mock-DOM limitations also affect Settings checks.
- Therefore this smoke run is **not** an all-green browser acceptance test. It does not verify layout, real clicks, mobile behavior or production sheet totals.

## Remaining verification boundary

Production browser performance, deployed release status, real Google Sheet totals, accessibility and mobile/PWA behavior were **not verified** in this environment. Local app instances used synthetic data and isolated temporary stores, not production accounts.

Recommended next step: authenticated desktop/mobile browser acceptance checks on Home live refresh, FF/GV switching, Master Search, report downloads, Settings and offline/reconnect behavior, plus a separate test/CSS-source maintenance pass for the baseline failures above.
