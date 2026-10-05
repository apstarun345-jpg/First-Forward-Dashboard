# ✨ v3.53.0 — Installed PWA launch recovery + consistent GV CCH categories

## 📲 Installed app opens the dashboard again

- The API-hosted PWA manifest now launches at the origin-root `/#/home` with scope `/`; service-worker registration is also explicitly rooted at `/sw.js`.
- Older installs that still launch at `/api/pwa/` now receive the dashboard shell instead of the API router's `Not Found` response. A root `<base>` ensures that shell's relative scripts and styles load from the app origin.
- The manifest URL is cache-busted and the service-worker cache is bumped so clients can acquire the corrected shell.

## 🧭 GV CCH categories stay consistent from first paint

- The fast GV feed, 30-day Home feed, day-detail query, and raw fallback now all apply the saved CCH-to-category mapping and the same VCLASS fallback rule.
- GV server column discovery now treats CCH and VCLASS as separate fields; when a CCH header is missing, VCLASS becomes the single primary class field rather than being selected twice.
- Saving the GV CCH map or related sheet/column settings invalidates cached feed snapshots. Generation checks stop an older in-flight request from writing stale categories back into cache.
- Home ignores a live-feed snapshot whose map signature differs from the settings already loaded in the browser, preventing the wrong-category flash while a fresh GV Master snapshot loads.

## ✅ Regression coverage

Added coverage for the legacy PWA launch route and root paths, CCH-first/VCLASS-fallback classification across aggregate and detail queries, column resolution, cross-runtime map signatures, and stale-generation protection.
