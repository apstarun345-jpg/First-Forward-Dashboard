# First Forward Dashboard — First Forward + GV Partner (v3.11)

Colourful dashboard website built directly on top of **do Google Sheets**:

| Source | Sheet | Tabs | Kya |
| --- | --- | --- | --- |
| **🟦 First Forward** | "Agent Performance & Stock Report" | EIR · StockDataa · REPORT | issuance log, field stock, agent performance |
| **🟩 GV Partner** | "Tag Issued Report" | GV Master · Tag Assignment · GV REPORT | GV issuance, GV stock, GV agent performance |

Dono brands ke metrics **hamesha alag** dikhte hain (Top VC4, Top Commercial, TL/agent lists alag-alag) —
aur ek **⚖️ GV vs First Forward** page side-by-side comparison deta hai.

Koi database nahi, koi manual upload nahi — website Google Sheet se data padhti hai
(Google Visualization API / `gviz`) through a small Node server that also handles **login, users,
permissions and settings**. Zero npm dependencies.

## ✨ v3.15.0 — 🎯 Suggested dispatch: DONO criteria (stock − aur bina stock), har jagah
- Har suggestion ab **do figures** dikhata hai — **stock ke baad** (avg/day × din − stock) aur **bina stock ghataye** (avg/day × din): master search (TLS + agents), profile drawer, Performance dispatch plan, GV dashboard + GV Stock Report, Direct Agents, New Agents.
- ⚙️ Settings → Features me naya **🎯 Suggested dispatch / tags** card: kitne din ka suggest (`suggestDays`) + kaise dikhaye (`suggestMode`: dono / sirf net / sirf gross).
- 🔎 Topbar search: **✕ Clear** button + **📅 From→To date-range** popover (Range Report kholta hai); suggestions me dono criteria.
- 🎨 Site-wide **% rule**: − red, + green bold (KPI cards ke andar bhi) · panel/kundli text bold + bada · **War Room colourful** (dark background removed) · Dashboard ka hidden g13 KPI fix · Performance KPI cards click → full breakdown drawer.
- Docs: [WHATS-NEW-v3.15.0.md](WHATS-NEW-v3.15.0.md)

## ✨ v3.14.0 — 🆕 New Agents & TL Changes
- Naya page `#/newAgents` (Cross Channel): FF + GV ke **naye agents** aur **TL badla / TL hata / TL mila** ke alag tables, KPIs, 6-month chart, CSV. Row click → poori profile drawer.

## ✨ v3.13.0 highlights — 🧾 Master profile · 🏷️ Direct tag-required · ✉️ SMTP fix

- **Master search = poori kundli**: agent/TL par click → drawer me naam, mobile, TL (naam/ID/mobile), agent + TL stock, dispatch priority, suggested VC4/Commercial qty, class-wise issuance (last vs this month + stock), TL totals, agents table aur charts. Ek hi match ho to inline khulta hai. CSV + WhatsApp share.
- **🏷️ Direct · High/Medium · Tag required**: FF + GV dispatch plan, GV Stock Report, Direct Agents page aur Dispatch Planner me alag option — direct agents ko stock nahi, par High/Medium priority ko tags dikhte hain ("No stock" nahi).
- **✉️ Email/SMTP**: STARTTLS bug fix + Apps Script / Resend / Brevo HTTPS fallback + Settings → Email → Diagnose. Render free plan par SMTP ports blocked hote hain.
- Docs: [WHATS-NEW-v3.13.0.md](WHATS-NEW-v3.13.0.md) · `dev/master-profile.test.js` · `dev/mail.test.js`.

## ✨ v3.12.0 highlights — 🧍 Direct Agents & TLs (ek hi rule, poori site par)

- **Rule (configured, Settings → 🧍 Direct Agents):** GV direct = **TL ID + TL Name dono khaali** · FF direct = **TL Name APS**.
- **Ek hi classifier** poore app me: `FF.config.isDirectAgent(row, channel)` + `FF.direct` helpers — dispatch filters, TL dropdowns, TL rollups, ranking, search suggestions, network graph, war room, commission, certificates sab isi rule par.
- **GV Stock Report dispatch** me 🚫 **Direct Agents — alag list (no dispatch)** + TL/Dispatch filter me direct option; **FF Performance** me `🚫 Direct Agents · APS` filter; **Dispatch Planner** me alag direct pool.
- **Naya page** `#/directAgents` — dono channel ke direct agents ka roster (reason, stock, MTD issuance) + CSV + rule cards.
- Docs + tests: [WHATS-NEW-v3.12.0.md](WHATS-NEW-v3.12.0.md) · `dev/direct-agent.test.js` · smoke me v3.12 checks.

## ✨ v3.11.0 highlights — Master Search + Wow Zone 2.0 🔎

- **🔎 Master Search (har page par)** — topbar search bar + Home panel master search. Naam, TL naam,
  agent ID, TL ID, GV ID, barcode, tag ID — sab ek search me (dropdown suggestions input ke **neeche**,
  overlap nahi). Search karne par **poori kundli**: colourful profile cards + barcode/tag tables + CSV.
- **🧭 Executive Cockpit stock fix** — GV-parked StockDataa rows (master ID · "Apna Payment" naam ·
  GV channel TL) **teeno signals** se exclude — combined field stock ab sahi (double count khatam).
- **🔴 War Room detailed** — aaj + MTD ka VC4 / VC20 / VC5+ / chassis / replacement / wrong-VRN breakdown,
  TL-wise table, exact render timestamp.
- **👁 Live view instant** — ms-level `exact HH:MM:SS.mmm`, freshness dot, 0.5s–5s speed selector,
  live data clock (sheet load times + aaj ke tags).
- **🎉 Naye Wow pages** — 📅 Activity Calendar (GitHub-style heatmap + streak), 🕸️ Team Network
  (animated TL↔agent constellation), 🚨 Anomaly Radar, 🧾 Agent Report Cards (grades + auto remarks + print).
- **✨ Aur bhi** — 📈 KPI sparklines, 🟢 live tab heartbeat, 🎨 theme packs (Neon · Glass · 🪔 Diwali · Gold · Mono),
  🎖️ Level-Up Ceremony, 📅 "Aaj ka din" memories, 💬 chat me charts.
- Full notes: [WHATS-NEW-v3.11.0.md](WHATS-NEW-v3.11.0.md)

## ✨ v3.10.0 highlights — WOW ZONE 🎉

- **🎮 Agent Arena** — levels & XP, 11 badges, monthly challenges, badge-unlock par
  🎊 confetti + fanfare, badge gallery, medals leaderboard.
- **🔮 Crystal Ball** — month-end projection + confidence, record-watch agents.
- **🏆 Wall of Fame** — 6-month champion gallery + shareable **Winner Card PNG** (WhatsApp-ready).
- **🔴 War Room** — fullscreen live pulse: count-up counters, FF vs GV race, live ticker,
  🚨 lead-change celebration, 30s auto-refresh.
- **🌅 Morning auto-briefing** — din ke pehle login par assistant khud daily briefing sunata hai
  (voice: "briefing band/chalu karo").
- Full notes: [WHATS-NEW-v3.10.0.md](WHATS-NEW-v3.10.0.md)

## v3.9.0 highlights

- **🗄 Master Stock (naya page)** — barcode / agent / TL / GV name / GV TL search karo →
  StockDataa ↔ Tag Assignment ki total information; kitne Tag Assignment barcodes StockDataa me
  **missing** hain; overlap donut + class charts; ⏰ aged-stock alerts (30–60 / 60+ din).
- **🔗 Dual-channel ghost rule** — barcode double-mapped sirf tab jab FF holder Apna Payment
  (master 5845036) NA ho aur GV side not-assigned ke alawa asli ID ho.
- **🎯 GV dispatch** — dispatch plan + **Direct agents ki alag list** (GV Stock Report → Dispatch tab).
- **🌈 Clickable KPIs everywhere** — compare / charts / dispatch planner / TL scorecard / forecast /
  data quality: har KPI colorful gradient + click → full data dialog (search + CSV).
- **⚡ Commission pages instant open** + FF **Payout Excel** (gross / penalty / net, 5 sheets).
- **🎙 Voice navigation** — "master stock kholo", "open data quality" — 19 pages, permission-aware.
- Full notes: [WHATS-NEW-v3.9.0.md](WHATS-NEW-v3.9.0.md) · previous: [v3.8.2](WHATS-NEW-v3.8.2.md)

## Login & access

* Site **login ke bina nahi khulti**. Pehli baar server start hote hi ek admin ban jaata hai:
  * Render / env me `ADMIN_USER` + `ADMIN_PASSWORD` set ho → first setup par admin create hota hai; existing account/password restart par overwrite nahi hota.
  * Nahi to **`admin` / `admin123`** (pehle login par password badalne ko kaha jaayega — Settings → My account).
* **Login page**: animated split-screen design, "Login ho raha hai…" progress animation, remember-me
  (username yaad rehta hai), password show/hide, aur login ke baad **"Welcome back, <name>!"** splash animation.
* **Forgot password?**(login page) → 2-step flow: (1) request bhejo (admin ko WhatsApp/email shortcut bhi),
  (2) admin Settings → **Access matrix → Password reset requests** me se **6-digit code** generate karta hai
  (30 min valid) → user code + naya password daal ke reset kar leta hai. Email service ki zaroorat nahi.
* **Sign up** (login page par) → account "pending" banta hai → admin **Settings → Users & access** me
  Active tick karke **per-user, per-feature permissions** deta hai.
* **Per-item access, do jagah se:**
  * **Settings → 👥 Users & access** — har user ka card (role, permissions, reset password, delete).
  * **Settings → 🔐 Access matrix** — users × har permission ka ek hi grid (checkbox), per-user quick
    buttons **All / FF / GV / None**, aur ek click me sab non-admin users ke liye presets
    (All · sirf First Forward · sirf GV Partner · read-only), saath me **password reset requests** panel.
* **Settings → 🗂️ Sheets & tabs** — har sheet tab ka registry: **Show on/off** (untick = wo sheet poore app se
  hide, nav + sheets page + permission sab se hat jaata hai), label, sidebar group, spreadsheet (FF/GV), exact
  Google tab name, gid, description — aur naya tab add karne ka option. Har tab ka apna permission
  `sheet:<Tab id>` banta hai jo Access matrix me checkbox ban jaata hai.
* Top-right corner me user menu: **photo upload/change**, naam, email, role (👑 Admin / User), last login, aur **logout**.
* Sign up band karna ho: Settings → Thresholds → "Sign up allow karo" untick.

## Pages

| Page | Kya dikhata hai |
| --- | --- |
| **Home** | "**Hello <name> 👋**" greeting (time-based), avatar + role, FF aur GV ke snapshot cards (MTD issuance, VC4, stock, last-month same-period line), sirf aapke access wale shortcuts, aur aapka permission grid. |
| **Dashboard** | KPI cards + charts (daily line current vs last month, class mix, monthly by class, **VC4 vs Commercial** compare card (MTD vs last month same period), top TLs (APS excluded), top agents, stock by class/TL, tag status, weekday pattern…). |
| **Trend** | Daily / Weekly / Monthly / **Last vs Current** — dimension: Total, Class (VC4 / VC20 / VC5+), Type, Channel, VRN type. TL select + **agent/TL quick-find with dropdown suggestions**. |
| **Stock** | StockDataa: **search bar (agent-wise / TL-wise / class criteria, dropdown suggestions)**. Agent → pivot Class × Tag type; TL → pivot Agent × Class; Class → pivot TL. Har view me **VC4 vs Commercial** compare, **⬇ Excel** (Sheet 1 = Summary/pivot, Sheet 2 = us agent/TL ki saari raw StockDataa rows), CSV, WhatsApp / Email share. Overview me KPIs, TL × class matrix, agent table. |
| **Performance** | REPORT sheet: top **quick-find** (agent / TL naam → click → full profile drawer: VC4 vs Commercial, VC4 / VC20 / VC5+ last month vs current month, stock, 7-day chart, poora 78-column detail). **Shortcut chips**: Priority High / Medium / Low (agent, TL VC4, TL Commercial), Status, Activity. Overview, Agents, TLs (APS excluded), Alerts, Columns views. CSV / Excel export, WhatsApp / Email share (TL mobile REPORT se). |
| **GV Partner Dashboard** | GV Master + Tag Assignment + GV REPORT se: GV KPIs (MTD, VC4, Commercial, agents, stock days), GV daily line (current vs last month), class mix, **GV VC4 vs Commercial** MTD vs last month same period, monthly GV issuance by class / type / tag, top GV TLs & agents, GV stock by class + top TLs, weekday pattern, last-14-days table, dispatch/priority watch. |
| **GV Trend** | GV Master: Daily / Weekly / Monthly / **Last vs Current** (per-class same-period compare), dimension = Total / Class / Type / Status, TL filter + agent quick-find. |
| **GV Stock** | Tag Assignment: search (agent / TL / class), overview KPIs, TL × class matrix, agent table, class mix, aur agent/TL drill-down me raw rows ka **⬇ Excel** export. |
| **GV Performance** | GV REPORT: agent quick-find, agent profile drawer (VC4 vs Commercial, MTD vs last month, stock by class, priority, runrate/eRunrate), rankings & alerts, GV REPORT (A–AZ) column view, CSV/Excel + share. |
| **GV Commission Intelligence** | GV Master ka exact transaction amount, earned commission, commission/tag aur effective rate — agent, TL/direct, class, date aur Monday–Sunday breakdown; CSV/Excel/PDF. Current month me **Personal agent commission** table exact `Agent ID + class + rate` dikhata hai; VC4 default GV Master ke commission column se aata hai, aur Settings → Data source me VC4 / VC20 / VC5 / VC6 / VC7 / VC12 ke manual class rates set ho sakte hain. |
| **FF Commission Intelligence** | REPORT headings se dynamically detected rate aur earned commission; Direct Agent / TL-managed / real sheet category split. Missing source par explicit mapping state — guessed payout kabhi nahi. |
| **Dual-channel Agents** | StockDataa barcode ↔ Tag Assignment serial aur REPORT `GV ID Found` ↔ GV unique ID se verified overlap; FF/GV issuance, stock, class mix aur separate/combined summary. Name-only join nahi. |
| **Stock Forecasting** | Live stock-out/replenishment projection; rolling 7/15/30-day forecast-accuracy backtests with WAPE/bias; and FF/GV stock-balance reconciliation: opening + exact movement ledger − predicted/actual consumption vs observed closing stock, with unexplained variance, source coverage and CSV/Excel/PDF. |
| **Data Quality Center** | Duplicate tags/barcodes, missing agent/TL, unassigned stock, invalid/stale dates and cross-sheet mismatches with samples and recommended correction. |
| **Executive Cockpit** | Combined management pulse: MTD/projected issuance, stock, reported earnings, 14-day channel trend and key operational exceptions. |
| **Saved Views / Report Studio / Notes** | Exact filter-route bookmarks and shareable links; scheduled daily HTML+CSV and weekly SMTP reports; export/PDF/WhatsApp controls; collaborative agent/TL note and follow-up timeline. |
| **⚖️ GV vs First Forward** | 12 head-to-head KPIs, insights list, daily issuance lines (FF vs GV), MTD class bars, head-to-head leader table, monthly bars, stock-by-class compare, aur dono taraf ke top agents (click → us brand ka performance page). |
| **Sidebar / Sheets** | Permission-safe accordion: ek waqt me Management, First Forward, GV Partner, Cross Channel ya Workspace section khulta hai; unrelated channel options hidden rehte hain. Registered sheet tabs apne channel ke andar hi dikhte hain. |
| **Settings** | Neeche dekho — sab kuch yahin se badlo. |

**Refresh policy:** koi dashboard auto-refresh nahi. Data site khulte hi ek baar poora preload hota hai (aggregates), phir
sirf **↻ button** ya browser reload par dobara aata hai. Preloaded dashboard options click karne par network call nahi;
exact custom-date reports, forecast-accuracy backtests aur raw-row Excel exports zarurat par on-demand query karte hain. Server bhi Google responses cache karta hai
(`cacheSeconds`, default 10 min) taaki page reload fast rahe; ↻ hamesha Google se fresh laata hai (permission "Force refresh").

**Comparison correction:** EIR me GV Partner ka `master ID 5845036` aata hai. **GV vs First Forward** page First Forward side se `5845036` (aur configured GV TL marker) ko pehle exclude karta hai, phir GV Master ke against compare karta hai — isliye GV double-count nahi hota. Admin Settings → Data source me ID/marker badal sakta hai.

**Forecast-accuracy methodology:** selected 7/15/30-day holdout se immediately pehle ke 14 ya 28 calendar days ka agent-wise daily run-rate historical prediction banta hai. Prediction ko subsequent exact EIR (First Forward) aur GV Master issuance/replacement se compare kiya jata hai. Headline accuracy `max(0, 100 − WAPE)` hai; bias positive ho to over-forecast aur negative ho to under-forecast. Stock transfers/inward movement ko consumption nahi maana jata, aur zero-history rows ko accurate score nahi diya jata.

**Stock-balance reconciliation:** server daily FF `StockDataa` aur GV `Tag Assignment` closing snapshots rakhta hai. Optional `Stock Movements` tab (Settings → Data source) me Date, Channel, Type, Quantity, Class, From, To, Reference aur Note map kiye ja sakte hain. Equation `opening + recorded net movement − consumption = closing` hai. `IN` positive, `OUT` negative, internal `TRANSFER` net zero aur `ADJUSTMENT` signed hota hai. Ledger absent ho to dashboard sirf **implied net movement/residual** dikhata hai—use actual inward label nahi karta.

**Notifications:** top-right 🔔 feed me non-admin user login/page-open, consented location share aur Google Sheet ke newest-day grouped report changes aate hain.

**📱 Mobile / OS notification panel (web push):** bell panel (top-right 🔔) me ab **sirf ek switch** hai — **🔔 Notifications ON/OFF**, uske neeche **📅 Monthly report ON/OFF**. Bas. ON karte hi browser permission maangi jaati hai aur web push subscription khud ban jaati hai — uske baad alerts **phone ke notification panel** me aate hain, **app band ho tab bhi** (Android Chrome / Edge / Samsung Internet; iOS 16.4+ par pehle "Add to Home Screen" se install karna zaroori hai). Login ke baad pehli click par permission **ek hi baar khud** maang li jaati hai, isliye koi button dhoondhna nahi padta. OFF karte hi subscription hat jaati hai aur koi toast / alert / sound nahi aata (feed ki list bell me padh sakte ho).

Baaki fine-tuning **Settings → 👤 My account → 🔔 Notifications** me chali gayi hai: sound / vibration, monthly report, aur type-wise alerts (login, report update, signup, activity…). Admin ko wahan **📲 Push diagnostics** bhi dikhta hai — VAPID key source + durable, auth scheme, self-test result, registered devices, aakhri delivery/error, plus **📳 Panel test**, **🛰 Server push test**, **🔁 Force re-subscribe** aur **🔑 Public key copy** buttons.

Push health API: `GET /api/push/status` (apne devices, `lastOk` / `lastError`, `configError`, `selfTest`) aur `GET /api/health` → `push` (`scheme`, `subject`, `selfTest`, `durable`, `devices`, `ttl`, `warning`).

> 🔴 **"403 — permission denied: crypto-key header had no public application server key specified" ka permanent fix.** Push bhejte waqt server purana (draft-01) auth scheme use kar raha tha: `Authorization: WebPush <jwt>`. Is scheme me public application server key `Crypto-Key: p256ecdsa=<key>` header me bhejna **zaroori** hai — wo nahi bheja ja raha tha, isliye FCM (Android Chrome ke saare endpoints) har message 403 se reject kar deta tha. Aur 403 ko "dead subscription" maan kar server use delete kar deta tha → app "Permission mil gayi hai par push subscription active nahi" loop me phans jaati thi aur phone ka panel hamesha silent rehta tha. Ab:
> * Delivery **RFC 8292** scheme se hoti hai — `Authorization: vapid t=<jwt>, k=<public key>` (public key header me hi, Crypto-Key ki zaroorat nahi).
> * Koi push service sirf legacy scheme samajhti ho to **automatic fallback**: `WebPush <jwt>` + `Crypto-Key: p256ecdsa=<key>`. Jo scheme kaam kar jaati hai, server wahi yaad rakhta hai.
> * **401/403 par subscription tab hi drop hoti hai jab wo sach me kharab ho** (key mismatch / expired). Server-side config problem ho to subscription **barkaraar** rehti hai, `configError` record hota hai aur admin ko banner + diagnostics me dikhta hai — chup-chaap tootna band.
> * Har subscription ke saath wo **VAPID key save** hoti hai jis se wo bani thi; key rotate ho jaaye to purani subscriptions boot par hi hata di jaati hain (device app khulte hi re-subscribe kar leta hai).
> * Boot par **VAPID self-test** chalta hai (JWT sign → apni public key se verify, key 65-byte raw point, `sub` claim mailto/https) aur result `/api/health` me aata hai.
> * `sub` claim ab `mailto:admin@apnapayment.local` nahi — `VAPID_SUBJECT` env se set hota hai (default `mailto:admin@apnapayment.com`); FCM/Apple localhost-style subjects ko `403 BadJwtToken` dete hain.

> ⚠️ **VAPID keys hamesha durable rehni chahiye.** Browser subscription us `applicationServerKey` se bandhi hoti hai jis se wo bani thi — keypair badalte hi push service har message reject kar deta hai: in-app bell chalta rehta hai par **phone ka panel silent** ho jaata hai. Keys is order me resolve hoti hain: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` env → durable store (`notify.vapid`, Apps Script / Sheets ke saath) → `DATA_DIR/vapid.json` → generate once + dono jagah save. Render par container disk har deploy/spin-down par mit jaati hai, isliye durable store zaroori hai; save fail ho to server har 60 second me retry karta hai aur `/api/health` + admin banner par warning dikhata hai. Sabse pakka tareeka: `npm run push:keys` chalao aur dono values Render → Environment me pin kar do (ek baar ka kaam). Client bhi self-heal karta hai: server ki key badli ho ya subscription drop hui ho to app khulte hi nayi subscription ban jaati hai. Server FF (GV ID excluded) aur GV ko har 5 minutes check karta hai; feed kholte waqt bhi check hota hai. Dashboard data khud auto-refresh nahi hota; notification aane par ↻ dabao.

**Location privacy:** location automatic/silent tracking nahi hai. User Settings → My account → “Share my location” par browser permission de to sirf latest coordinates/accuracy save hoti hai, aur admin Users & access me Maps link dekh sakta hai.

## Settings (admin)

| Tab | Kya badal sakte ho |
| --- | --- |
| My account | Naam, mobile, email, password, **profile photo upload/remove**; apna access dekho (sab users) |
| Branding & images | App name, sidebar brand, tagline, **logo upload**, **login page image upload**, login animation on/off, sidebar background colours (top/bottom gradient), sidebar text colour, accent colours (incl. GV teal) — live preview |
| Sheets & tabs | Har tab ka Show/Hide, label, group, spreadsheet (FF ya GV), **exact Google tab name**, gid, description + naya tab add karo (isi se permission `sheet:<id>` banta hai) |
| Access matrix | Users × permissions grid, quick presets (All / FF / GV / read-only), per-user All/FF/GV/None, **password reset requests** (code generate karo, reset karo, dismiss karo) |
| Data source | **First Forward sheet**: Sheet ID, EIR / StockDataa tab names, REPORT gid, EIR & StockDataa **column letters** · **GV Partner sheet**: GV Sheet ID, GV Master / Tag Assignment / GV REPORT tab names + gids, GV REPORT header row (4) aur last column (AZ) · excluded TL names (default `APS`) · server cache seconds |
| Thresholds | Stock-cover red/orange/amber days, inactive days, Top N, rows per page, sign-up on/off |
| Contacts & sharing | Team WhatsApp number, team email, WhatsApp group link, message signature |
| Users & access | Approve / role / per-feature permissions / reset password / delete / create user |
| Storage & backup | ☁️ Google Sheet storage wizard (permanent save), settings JSON export / import, clear cache, reset |

> ✅ **Easiest fix for "settings / users reset after deploy": [STORAGE_SETUP.md](STORAGE_SETUP.md)** —
> Settings → ☁️ Storage & backup wizard + Apps Script web app + 2 Render env vars
> (`APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`). No service account or disk needed.
>
> **Production storage is required, not optional.** Render's application directory is ephemeral.
> The app now supports **encrypted storage in `APP_STORAGE` inside the SAME main Google Sheet**:
> see [same-sheet setup and migration](SHEETS_STORAGE.md). Set `STORAGE_BACKEND=sheets` only after
> private Google credentials, the permanent encryption key and the one-time migration are ready.
> This mode does not need a persistent disk for accounts/settings/sessions. Never put readable
> credentials in the public workbook; a hidden tab is not a security boundary.
>
> File mode remains the default for safe compatibility: use a paid persistent disk at `/data`
> and `DATA_DIR=/data` if keeping that mode. Environment admin credentials only bootstrap a
> missing account, not a backup. Settings JSON export does NOT include users or sessions.
> Back up existing records before any deployment or storage switch.

## Requirements

* Dono Google Sheets **"Anyone with the link can view"** hone chahiye.
* GV sheet: `1LkYX746lGZQKhl5ueoKe3kYOo4SNtu47p5-jkVNUiBA` (tabs: `GV Master`, `Tag Assignment`, `GV REPORT` gid `1284424234`).
* Node.js 18+ (Render par default 20).

## Local run

```bash
npm start                                # http://localhost:8080  (login admin / admin123)
ADMIN_USER=me ADMIN_PASSWORD=secret npm start
```

Bina internet ke test karna ho (synthetic data):

```bash
node dev/mock-gviz.js &                                    # fake Google gviz on :9099
GVIZ_BASE=http://localhost:9099 DATA_DIR=/tmp/ffdata npm start
node dev/smoke.js                                          # headless smoke test of every page
```

## Render par deploy

**Option A – Blueprint:** Render → *New +* → *Blueprint* → repo select karo (`render.yaml`) → `ADMIN_USER` / `ADMIN_PASSWORD` bharo → Apply.

**Option B – Manual:** Render → *New +* → *Web Service* → repo connect karo →

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build Command | *(blank)* — koi dependency nahi hai |
| Start Command | `npm start` |
| Instance type | Starter (persistent disk support; avoids free-service idle cold starts) |
| Disk mount | `/data` · 1 GB |
| Environment | `DATA_DIR=/data` |
| Health check path | `/api/health` |

For **same-sheet encrypted storage**, follow [SHEETS_STORAGE.md](SHEETS_STORAGE.md) instead of provisioning a new disk. Do not remove an existing disk before backing up and verifying migration.

### Environment variables

| Variable | Default | Kaam |
| --- | --- | --- |
| `APPS_SCRIPT_URL` | – | Apps Script web-app `/exec` URL → storage backend `appsscript` (see STORAGE_SETUP.md) |
| `APPS_SCRIPT_SECRET` | – | Same secret as in Code.gs (≥16 chars). Never change it after setup |
| `STORAGE_BACKEND` | `appsscript` if `APPS_SCRIPT_URL` set, else `files` | `sheets` = encrypted APP_STORAGE tab via service account |
| `STORAGE_SHEET_ID` | Main `SHEET_ID` | Pin to the existing main spreadsheet ID; set explicitly for migration |
| `GOOGLE_SERVICE_ACCOUNT_FILE` / `GOOGLE_SERVICE_ACCOUNT_JSON` | – | Server-only Google write credential; never in browser/settings/Git |
| `STORAGE_ENCRYPTION_KEY` | – | Permanent random 32-byte base64 secret; back it up privately |
| `PORT` | `8080` (Render khud set karta hai) | Server port |
| `ADMIN_USER` / `ADMIN_PASSWORD` | – | First-time bootstrap only; saved credentials win on restart. Na ho to `admin` / `admin123` |
| `DATA_DIR` | Local: `./data`; production: set `/data` | Users / sessions / settings JSON folder (persistent disk ho to wahan) |
| `SHEET_ID` | sheet ki current ID | Default Google Sheet ID (Settings me bhi badal sakte ho) |
| `CACHE_SECONDS` | `600` | Server cache default (Settings → Data source override karta hai) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | – (auto, durable store me save) | Web-push keys ko explicitly pin karo. Set na karo to server khud banata hai aur **durable storage** (Apps Script / Sheets / `DATA_DIR`) me save karta hai |
| `PUSH_TTL_SECONDS` | `86400` | Push message kitni der tak retry-window me rahe (phone off/doze ho to drop na ho) |
| `VAPID_SUBJECT` | `mailto:admin@apnapayment.com` | VAPID JWT ka `sub` (contact) claim — `mailto:` ya `https:`. localhost/.local mat dena, FCM/Apple 403 dete hain |
| `PUSH_AUTH_SCHEME` | `vapid` | `vapid` = RFC 8292 (default, recommended) · `legacy` = `WebPush` + `Crypto-Key: p256ecdsa=`. Dono me automatic fallback hai |
| `FRAME_PROTECTION` | – | `1` = site ko kisi aur website ke iframe mein khulne se roko |
| `GVIZ_BASE` | `https://docs.google.com` | Sirf local testing (mock server). Production mein set mat karo |

## Files

* `server.js` – static files + `/api/gviz` proxy (cache) + auth/users/settings API (JSON store in `DATA_DIR`)
* `config.js` – defaults (sheets, column letters, thresholds); server settings run-time par merge hote hain
* `store.js` – ek baar preload hone wala data store (daily, agents, class-month, stock, REPORT)
* `auth.js` – login / signup screen, permissions, theme apply
* `dashboard.js` · `trend.js` · `stock.js` · `performance.js` · `sheets.js` · `settings.js` – pages
* `charts.js` (SVG charts) · `xlsx.js` (Excel writer, no deps) · `util.js` (helpers + suggestion dropdown)
* `dev/mock-gviz.js`, `dev/smoke.js` – offline test tooling

## Regression checks (v3.2)

- `npm run check` — server, service worker and all browser scripts.
- `npm test` — real server restart/session persistence, saved profiles/users/theme/password,
  failed disk-write rollback, corrupt-store protection, query deduplication, unbounded ranges,
  per-dataset readiness and parallel permission-aware preloading.
- `npm run smoke` — against a running local mock server (above): all page render paths,
  including **zero new gviz requests when opening all preloaded sheet tabs**.

Normal opens reuse the authenticated server cache. FF, GV and permitted sheet previews start
loading together; each page waits only for the datasets it needs. Large sheets preload count +
first 100 rows, not the entire lakh-row inventory. Small sheets also warm their full view.
Searches, later pages and previously unused filters still need their own queries. First uncached
loads depend on Google/network latency; loading a whole account's data cannot be instantaneous.
Manual refresh bypasses the server cache without blanking already displayed data.

### Same-sheet storage checks

`npm test` also verifies encrypted storage against a mock Google Sheets API, including a real
server restart with the entire ephemeral DATA_DIR removed, session/theme persistence,
authenticated encryption, chunking, API failure rollback and quota retries. No real Google
credentials are used by tests. `npm run storage:migrate` is an explicit, one-time command;
read SHEETS_STORAGE.md and supply secrets privately before using it.
