# v3.35.0

## 🛠 Fix — Agent / TL Summary me ID / TL ID gayab tha (text colour = background)

**Root cause:** report header (`.as-head`) ka gradient blue→purple→pink hai, aur uske andar
ID / TL / mobile line par `.dim` class = `var(--muted)` (light mode `#64748b`) lagta tha.
`#64748b` aur `#2563eb` ka luminance lagbhag barabar (~1.08:1) — isliye **"ID: … · TL: … (TL-ID)"**
line background me ghul jaati thi (dark mode me bhi sirf ~2:1).

**Fix (theme-pack-proof):**

- `styles.css` → `.as-head .dim { color: rgba(255,255,255,.9); }` — header ke andar hamesha white,
  koi bhi theme-pack `--muted` override kare tab bhi readable.
- `.as-drop` dropdown har theme/pack me white hai, par uska `.dim` (TL line + 📞) dark/pack
  `--muted` (#93a3bc / #d0a982) leta tha → white popup par ~2:1. Naya rule
  `.as-drop .dim { color: #475569; }` (hardcoded, ~7.7:1).

IDs (Agent ID, TL ID) permission se independent hamesha visible — wahi to page ki jaan hai.

## 🔐 Access control — ab har option admin ke haath me (Settings → Users / Access matrix)

Pehle Agent / TL Summary **koi bhi permission check nahi karta** tha — chahe admin user ko
export/share/refresh/contacts diya ho ya nahi, buttons aur mobile number sabko dikhte the.
Ab poora summary page site ke baaki hisson (gvpages, performance, kpiDetail, masterSearch…)
jaisa gate ho gaya:

| Summary ka option | Permission (admin checkbox) |
|---|---|
| 📄 PDF · 📊 Excel · ⬇ CSV · 🧾 JSON (header) | `Export data` |
| 👥 Team Pack Excel / PDF (TL view) | `Export data` |
| 🧓 Ageing drill ka ⬇ CSV / 📄 PDF (drawer) | `Export data` |
| 🔄 Data refresh (cache clear) | `Refresh from Google` |
| 📲 Share / WhatsApp · 💬 WA Text · 📋 Copy | `Share (WA/mail/copy)` |
| 📲 Per-agent WA quick-share (team table) | `Share (WA/mail/copy)` + number ke liye `See mobile numbers` |
| 📞 Mobile — header link, suggest chips, dropdown, report text, xlsx, JSON, PDF subtitle | `See mobile numbers` |

- **Render-time hide** (button dikhega hi nahi) + **handler guard** (defense in depth, wahi toast
  strings: "Download permission nahi hai" / "Share permission nahi hai").
- Bina `export` + `share` dono ke to header ka poora `.as-actions` row hi nahi dikhta.
- Per-agent WA ka link bina `contacts` ke generic `wa.me/?text=` chooser ban jaata hai —
  mobile number URL me nahi jaata.
- **Default set me `share`, `refresh`, `contacts` nahi hain** (pata hai, pehle se aisa hai) —
  agar team ko chahiye to admin Users card ke checkboxes se de de. `export` default me on hai.
- Server/DAL kuch nahi badla — `PAGE_PERMISSIONS` + `DEFAULT_USER_PERMS` pehle se the;
  sirf summary page unhe follow nahi karta tha.

**Kya intentionally gate NAHI kiya:** Agent ID / TL ID / TL naam (search + dropdown ki identity),
KPI cards, class-wise table, ageing drill ka view — ye sab `agentSummary` page permission se
controlled hain (jaise pehle the).

## 👁 View-as-user (admin preview) — idea #82

Admin ab **kisi bhi user ban kar poora dashboard dekh sakta hai** — bina uska password/permission
badle. Use karne ka tareeka: **Settings → Users → user card → 👁 Preview**.

- **Kya hota hai:** poore app me us user ke rights lag jaate hain — sidebar me sirf uske pages,
  uske buttons (export/share/refresh/contacts wale), uske liye chhupe adminOnly pages, top-right
  card me uska naam/role. Matlab saaf: "ye user actually kya dekh paata hai" — 2 second me pata chalta hai.
- **Sirf view hai:** session/data real admin ka rehta hai, kuch save nahi hota — banner ye bhi
  batata hai. Har page par upar ek fixed strip:
  `👁 Preview mode — <name> (@username) ke rights se dekh rahe ho … [↩️ Exit preview]`.
- **Preview-aware gates:** `FF.auth.can()` + `FF.auth.isAdmin()` overlay follow karte hain —
  featOk (teamMap/adminOnly), sidebar nav, command palette, live-assist admin gate, tag-request
  admin checks, presence chip — sab target ke hisaab se render hote hain.
- **Safe by design:** preview sirf real admin account se start ho sakta hai; sessionStorage me
  rehta hai (tab refresh ke baad bhi) lekin **init() me validate** hota hai (non-admin login par
  clear) aur **logout par clear**. Non-admin user kabhi overlay me nahi aa sakta.

## 🧪 Tests + versioning

- Naye tests — `dev/v335-summary-access.test.js` (7) + `dev/v335-viewas.test.js` (5) —
  **poora suite 321/321 pass**: default-allow (FF.auth missing), export/share/contacts matrix par
  reportHtml/reportText/reportJson/reportXlsx, source-gate assertions, CSS fix assertions,
  view-as start/stop/restore/logout + wiring.
- Cache-busting `?v=58 → v=59` (index.html + sw.js ASSETS) + service-worker cache
  `apnapayment-v65 → apnapayment-v66` — warna browsers purani CSS hi cache se dikhate.
- `package.json` version `3.34.0 → 3.35.0`.
