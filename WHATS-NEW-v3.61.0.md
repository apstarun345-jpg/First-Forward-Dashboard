# 🚀 v3.61.0 — "App jaisi smooth" performance release

> Complaint jo fix hui: **phone par app leg karti thi, slow khulti thi, aur deploy ke baad purana UI
> phansa reh jaata tha.** Ye release in teeno ka root-cause fix hai — koi feature band nahi hua.

## 1) Pehla paint 2× halka (eager JS ~1.09 MB → ~557 KB)

Pehle `index.html` me **28 scripts** eager thi — bell, KPI drawer, global search, AI assistant,
office bell, live-assist, morning card sab login se **pehle** parse hote the. Phone par Home ka
pehla paint isi liye 1–3 second ruk jaata tha aur scroll atka hua lagta tha.

Ab eager sirf critical shell hai (config/util/i18n/data/charts/model/filters/store/gv/preload/auth/
sheets/home/lazy/publicForm/app). Baaki **11 "shell-extra" modules first paint ke BAAD idle me chhoti
waves me aate hain** (`lazy.js SHELL_WAVES` + `app.js startShellExtras()`), aur click par on-demand bhi:

- 🔔 Bell / Alert center dabao → module load ho kar khulta hai (kabhi dead click nahi)
- KPI card click → `kpiDetail + stockAge` load ho kar drill drawer khulta hai
- 🔍 Search / Ctrl-⌘-K → `masterSearch + palette` on-demand
- 📲 Morning Card → `morningCard` on-demand

**Koi feature missing nahi lagta** — jo cheez user pehle second me dabata hai wo load ho jaati hai.

## 2) Boot logo 874 KB → 7.8 KB

Boot screen (jo sabse pehle dikhta hai) **0.9 MB ka PNG** (1408×768) download karta tha, sirf
280×153 par dikhane ke liye. Ab 560px **WebP (7.8 KB)** + `<picture>` se PNG fallback (purane browsers).
SW precache me bhi wahi chhota asset hai. Ye akela change pehli baar khulne par ~0.9 MB bachata hai.

## 3) Background kaam 1/3 (polling budget)

Phone se server par har minute ~41 background requests jaati thi — Render + Apps Script storage par
ye sab ko slow karta tha ("app leg karti hai" ka asli server-side karan):

| Kya | Pehle | Ab |
| --- | --- | --- |
| Bell poll | 5s visible / 15s hidden | **15s / 60s** (+ in-flight guard, requests stack nahi hoti) |
| Presence (admin live view) | 15s | **45s** |
| Pointer/scroll share timer | 400ms **hamesha** | **sirf jab admin live-view ON ho** |
| Live-assist inbox | 3s | **20s** |
| Push voice catch-up | 20s | **60s** |
| Install-button check | 3s | **60s + events** |
| Bell panel DOM rebuild | har poll (60 rows + presence) | **sirf jab content badla ho / popup khula ho** |
| Home sync pill | 2.5s + **poore `<body>` par MutationObserver** | 4s, observer hata (har DOM mutation par DOM walk hota tha!) |

Scroll/typing ke waqt forced-layout bhi khatam: suggest + multi-select popups ke capture-phase scroll
listeners ab **rAF-throttled** hain (popup band ho to zero kaam), aur tooltip touch devices par bilkul
skip hota hai.

## 4) Phone paint budget (CSS) — scroll leg ka sabse bada karan

Sticky topbar + fixed bottom nav par `backdrop-filter: blur(...)` tha — blur wala fixed element har
scroll frame par poora area dobara sample+paint karta hai. Glass theme-pack me to **har card** par blur
tha. Ab touch/standalone UI me:

- topbar / bottom nav / drawers / filter bar → **solid background, zero blur** (look wahi)
- bottom nav ko apna compositor layer (`will-change: transform; contain: layout paint`)
- infinite pulses band (`#pwa-install`, `.zip-btn`) — sticky topbar har frame repaint hota tha
- hover-only transform/shadow touch par band (tap par bekaar recalc hota tha)
- inner scrollers par `overscroll-behavior: contain` (page rubber-band nahi hota)

Desktop browser layout bilkul untouched hai.

## 5) Background warm ab device-aware

Login ke baad `lazy.warm()` pehle **~2 MB JS** background me parse karwata tha — phone par wahi
sabse bada lag tha. Ab:

- **Phone (touch)**: sirf 3 roz kaam aane wale modules (performance · tagIssued · stock), 25s baad,
  idle me, tab visible ho tabhi
- **Data-saver / 2G / low-end (≤3 GB RAM / ≤3 cores)**: warm bilkul band
- **Desktop**: puri list, 6s baad, idle me

## 6) 🧬 Automatic cache-busting — "deploy ke baad bhi purana app" ka khatma

Pehle har file ka `?v=` **haath se** bump karna padta tha (index.html + sw.js ASSETS + lazy.js).
Kahin miss ho gaya → phone par purana JS/CSS **1 saal tak immutable cache** me phansa rehta tha, aur
SW ke hard-coded pins (jaise `performance.js?v=105` jabki app `?v=109` maangta tha) install par
**~2.5 MB bekaar download** karwate the jo kabhi use hi nahi hota tha.

Ab:

- **Server** `index.html` serve karte waqt har asset URL par uska **content fingerprint** stamp karta
  hai (`?v=109-a1B2c3…`): file badli → naya URL → turant fresh; file wahi → wahi URL → 1 saal immutable.
  ETag bhi stamped body se banta hai, isliye koi bhi asset badalte hi HTML invalidate hota hai.
- `<meta name="ff-asset-versions">` me sab modules ka fingerprint jaata hai → `lazy.js` har module ka
  URL uske **apne content** se banata hai (config.js ka version inherit nahi karta).
- **Service worker** apni precache list **index.html se khud** banata hai (koi hard-coded pins nahi),
  install resilient hai (ek asset fail ho to poora install fail nahi), aur `?v=` wale assets
  **cache-first** serve karta hai → repeat visit par 0 network request.
- `CACHE_NAME` → `apnapayment-v116`.

## 7) Server par bhi halka load

- Report watcher (GV har 15s) pehle har tick par poora `notify` DB Apps Script me likhta tha, chahe
  data wahi ho. Ab **sirf tab persist hota hai jab kuch sach me badla** — Apps Script writes/quota
  bachti hain aur baaki requests fast rehti hain.
- `/api/notifications` me visibility filter ek hi pass me chalta hai (pehle poori list 2× filter hoti thi).

## Numbers (local mock gviz par naapa)

| Cheez | Pehle | Ab |
| --- | --- | --- |
| Eager JS (parse first paint se pehle) | 1086 KB | **557 KB** |
| Eager total transfer (brotli, CSS samet) | 404 KB (32 files) | **258 KB (21 files)** |
| Boot logo | 874 KB | **7.8 KB** |
| SW install precache | ~2.5 MB (44 pins, aadhe mismatched) | **sirf real shell (~0.45 MB, cache-first)** |
| Background requests / min / tab | ~41 | **~13** |

## Regression guards

- `dev/speed-today.test.js` — naya "eager core" test (11 shell-extra modules index.html me eager nahi),
  naya "polling budget" test, device-aware warm test, SW shell-derive test
- `dev/v352-master-search-kpis.test.js`, `dev/v337-unusual-parity.test.js`, `dev/v350-tagreq-recover.test.js`,
  `dev/agent-board.test.js`, `dev/search-report.test.js`, `dev/pwa-mobile-shell.test.js` — version-pin
  tests ab **automatic cache-busting contract** check karte hain (manual pins drift hi bug banate the)
