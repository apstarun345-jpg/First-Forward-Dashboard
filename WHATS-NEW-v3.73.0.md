# v3.73.0 — Native Android app shell (phone / installed PWA)

Desktop layout unchanged. Detail table: ANDROID-APP.md → "v3.73".

- App bar ☰ · title · 🔍 · 🔔 · ⋮ ; secondary controls in an Options bottom sheet (real buttons reused).
- Full-screen Master Search with back arrow.
- Android back button closes sheets / drawer / menus / search / notifications first.
- Bottom tabs keep a native history (Home → tab push, tab → tab replace).
- Pull-to-refresh → FF.app.refresh().
- KPI drawer, notifications, account menu, theme packs → bottom sheets (drag handle to close).
- Normal-size navigation drawer with swipe-to-close; status bar colour follows the theme.
- Fixes on phone: letter-stacked table columns, half-width section cards (FASTag Mapping),
  oversized text, location prompt covering content, dark-mode light canvas, empty Settings title.
- Files: native-app.js, native-shell.css, dev/native-shell.test.js; sw cache apnapayment-v126.
