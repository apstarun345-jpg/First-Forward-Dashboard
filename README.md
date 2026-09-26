# First Forward Dashboard

Colourful dashboard website built directly on top of the Google Sheet
**"Agent Performance & Stock Report"** (EIR · StockDataa · REPORT).

Koi database nahi, koi manual upload nahi — website Google Sheet se data padhti hai
(Google Visualization API / `gviz`) through a small Node server that also handles **login, users,
permissions and settings**. Zero npm dependencies.

## Login & access

* Site **login ke bina nahi khulti**. Pehli baar server start hote hi ek admin ban jaata hai:
  * Render / env me `ADMIN_USER` + `ADMIN_PASSWORD` set ho → wahi admin.
  * Nahi to **`admin` / `admin123`** (pehle login par password badalne ko kaha jaayega — Settings → My account).
* **Sign up** (login page par) → account "pending" banta hai → admin **Settings → Users & access** me
  Active tick karke **per-user, per-feature permissions** deta hai:
  Dashboard · Trend · Stock · Performance · Sheet StockDataa · Sheet REPORT · Download CSV/Excel ·
  WhatsApp/Email share · Force refresh · See mobile numbers. Admin ke paas sab hota hai.
* Sign up band karna ho: Settings → Thresholds → "Sign up allow karo" untick.

## Pages

| Page | Kya dikhata hai |
| --- | --- |
| **Dashboard** | KPI cards + charts (daily line current vs last month, class mix, monthly by class, **VC4 vs Commercial** compare card (MTD vs last month same period), top TLs (APS excluded), top agents, stock by class/TL, tag status, weekday pattern…). |
| **Trend** | Daily / Weekly / Monthly / **Last vs Current** — dimension: Total, Class (VC4 / VC20 / VC5+), Type, Channel, VRN type. TL select + **agent/TL quick-find with dropdown suggestions**. |
| **Stock** | StockDataa: **search bar (agent-wise / TL-wise / class criteria, dropdown suggestions)**. Agent → pivot Class × Tag type; TL → pivot Agent × Class; Class → pivot TL. Har view me **VC4 vs Commercial** compare, **⬇ Excel** (Sheet 1 = Summary/pivot, Sheet 2 = us agent/TL ki saari raw StockDataa rows), CSV, WhatsApp / Email share. Overview me KPIs, TL × class matrix, agent table. |
| **Performance** | REPORT sheet: top **quick-find** (agent / TL naam → click → full profile drawer: VC4 vs Commercial, VC4 / VC20 / VC5+ last month vs current month, stock, 7-day chart, poora 78-column detail). **Shortcut chips**: Priority High / Medium / Low (agent, TL VC4, TL Commercial), Status, Activity. Overview, Agents, TLs (APS excluded), Alerts, Columns views. CSV / Excel export, WhatsApp / Email share (TL mobile REPORT se). |
| **Sheets (left sidebar)** | Sirf **StockDataa** aur **REPORT**. Page-wise view, server-side search, sort, CSV / Excel export. |
| **Settings** | Neeche dekho — sab kuch yahin se badlo. |

**Refresh policy:** koi auto-refresh nahi. Data site khulte hi ek baar poora preload hota hai (aggregates), phir
sirf **↻ button** ya browser reload par dobara aata hai. Options click karne par koi network call nahi (sirf
StockDataa ki raw rows Excel export ke waqt on-demand aati hain). Server bhi Google responses cache karta hai
(`cacheSeconds`, default 10 min) taaki page reload fast rahe; ↻ hamesha Google se fresh laata hai (permission "Force refresh").

## Settings (admin)

| Tab | Kya badal sakte ho |
| --- | --- |
| My account | Naam, mobile, email, password; apna access dekho (sab users) |
| Branding & images | App name, sidebar brand, tagline, **logo upload**, **login page image upload**, sidebar background colours (top/bottom gradient), sidebar text colour, accent colours — live preview |
| Data source | Google Sheet ID, EIR / StockDataa tab names, REPORT gid, **column letters** for EIR & StockDataa (sheet me column shift ho to yahin fix), excluded TL names (default `APS` = direct agents, TL lists me nahi aate), server cache seconds |
| Thresholds | Stock-cover red/orange/amber days, inactive days, Top N, rows per page, sign-up on/off |
| Contacts & sharing | Team WhatsApp number, team email, WhatsApp group link, message signature |
| Users & access | Approve / role / per-feature permissions / reset password / delete / create user |
| Backup | Settings JSON export / import, clear server cache, reset to defaults |

> **Render free plan par disk ephemeral hai** — deploy/restart par `data/` (users, settings, uploaded images) reset ho sakta hai.
> Isliye: (1) `ADMIN_USER` / `ADMIN_PASSWORD` env set rakho (admin hamesha wapas ban jaata hai), (2) Settings → Backup se JSON
> download karke rakho aur zaroorat par import karo, ya (3) Render persistent disk attach karke `DATA_DIR` us par point karo.

## Requirements

* Google Sheet **"Anyone with the link can view"** hona chahiye (abhi hai).
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
| Instance type | Free |
| Health check path | `/api/health` |

### Environment variables

| Variable | Default | Kaam |
| --- | --- | --- |
| `PORT` | `8080` (Render khud set karta hai) | Server port |
| `ADMIN_USER` / `ADMIN_PASSWORD` | – | Bootstrap admin (recommended). Na ho to `admin` / `admin123` |
| `DATA_DIR` | `./data` | Users / sessions / settings JSON folder (persistent disk ho to wahan) |
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
