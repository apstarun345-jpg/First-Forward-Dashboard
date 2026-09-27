# First Forward Dashboard — First Forward + GV Partner (v3.1)

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
| **⚖️ GV vs First Forward** | 12 head-to-head KPIs, insights list, daily issuance lines (FF vs GV), MTD class bars, head-to-head leader table, monthly bars, stock-by-class compare, aur dono taraf ke top agents (click → us brand ka performance page). |
| **Sheets (left sidebar)** | Group-wise: **First Forward** (StockDataa · REPORT · EIR) aur **GV Partner** (GV Master · Tag Assignment · GV REPORT) — jo tab registry me enabled hain. Page-wise view, server-side search, sort, CSV / Excel export. |
| **Settings** | Neeche dekho — sab kuch yahin se badlo. |

**Refresh policy:** koi dashboard auto-refresh nahi. Data site khulte hi ek baar poora preload hota hai (aggregates), phir
sirf **↻ button** ya browser reload par dobara aata hai. Options click karne par koi network call nahi (sirf
StockDataa ki raw rows Excel export ke waqt on-demand aati hain). Server bhi Google responses cache karta hai
(`cacheSeconds`, default 10 min) taaki page reload fast rahe; ↻ hamesha Google se fresh laata hai (permission "Force refresh").

**Comparison correction:** EIR me GV Partner ka `master ID 5845036` aata hai. **GV vs First Forward** page First Forward side se `5845036` (aur configured GV TL marker) ko pehle exclude karta hai, phir GV Master ke against compare karta hai — isliye GV double-count nahi hota. Admin Settings → Data source me ID/marker badal sakta hai.

**Notifications:** top-right 🔔 feed me non-admin user login/page-open, consented location share aur Google Sheet ke newest-day grouped report changes aate hain. Server lightweight grouped query se FF (GV ID excluded) aur GV ko har 5 minutes check karta hai; feed kholte waqt bhi check hota hai. “Browser alerts on karo” ko ek baar allow karne par tab background me hone par native browser alert bhi aata hai. Dashboard data khud auto-refresh nahi hota; notification aane par ↻ dabao.

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
| Backup | Settings JSON export / import, clear server cache, reset to defaults |

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
| `STORAGE_BACKEND` | `files` | `sheets` = encrypted APP_STORAGE tab in the same main spreadsheet |
| `STORAGE_SHEET_ID` | Main `SHEET_ID` | Pin to the existing main spreadsheet ID; set explicitly for migration |
| `GOOGLE_SERVICE_ACCOUNT_FILE` / `GOOGLE_SERVICE_ACCOUNT_JSON` | – | Server-only Google write credential; never in browser/settings/Git |
| `STORAGE_ENCRYPTION_KEY` | – | Permanent random 32-byte base64 secret; back it up privately |
| `PORT` | `8080` (Render khud set karta hai) | Server port |
| `ADMIN_USER` / `ADMIN_PASSWORD` | – | First-time bootstrap only; saved credentials win on restart. Na ho to `admin` / `admin123` |
| `DATA_DIR` | Local: `./data`; production: set `/data` | Users / sessions / settings JSON folder (persistent disk ho to wahan) |
| `SHEET_ID` | sheet ki current ID | Default Google Sheet ID (Settings me bhi badal sakte ho) |
| `CACHE_SECONDS` | `600` | Server cache default (Settings → Data source override karta hai) |
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
