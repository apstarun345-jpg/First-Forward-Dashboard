# WHATS-NEW v3.48.0 — ⏪ Purani settings, users aur passwords wapas lana (Recovery)

**Problem jo fix hui:** deploy / naye Apps Script deployment ke baad site par pahle ki **saved
settings**, **login password** aur **user details** nahi aa rahi thin — `/api/health` me
`storage.backend: "appsscript"` ke saath `users: 1` (sirf default admin) dikhta tha.

**Asli wajah:** data Google Sheet ke `APP_STORAGE` tab me encrypted save hota hai. Naye deployment /
nayi sheet ke baad wo tab khaali mila, to app ne usme defaults seed kar diye. Purana data mita nahi
tha — wo **`APP_STORAGE_HISTORY`** (har overwrite se pehle ki encrypted copy) ya **purani sheet** me
maujood tha. Ab use wapas laane ka poora flow app ke andar hai.

## ✨ Naya kya hai

### ⏪ Recovery panel — Settings → ☁️ Storage & backup

| Tool | Kya karta hai |
| --- | --- |
| **🕰 Purani saves dhoondho** | `APP_STORAGE_HISTORY` ki saari encrypted saves ki list — kab save hui, kitne users, kaunse usernames, app name. Ek click me restore. |
| **🔄 Doosri (purani) sheet se data lao** | Purani sheet ka Apps Script URL + wahi secret → **🔍 Check** (preview: users/usernames/app name) → **⬇ Import**. Naye Apps Script/nayi sheet wale case ke liye. |
| **📤 Backup file se restore** | `ff-full-backup-*.json` (users + settings + sessions) ya settings JSON import. |
| **💾 Server disk scan** | Render ke `/data` (aur app folder) me purani `users.json` / `settings.json` dhoondhta hai aur wahan se import karta hai. |
| **⬇ Full backup download** | Poora backup (users ke password hashes ke saath) — aage ke liye safety net. |

### 🛡 Safety rules (jaan-bujh kar conservative)

- **Kuch bhi automatic overwrite nahi hota.** App sirf notification bhejta hai: *“sheet me N purani
  saves hain”*. Restore ki permission hamesha admin ki.
- Har restore se pehle **abhi ka data bhi `APP_STORAGE_HISTORY` me chala jaata hai** → galat restore
  bhi wapas ho sakta hai.
- Default mode **Merge** — sirf missing users aate hain, current password nahi badalta.
- `Replace` mode me bhi **current admin account hamesha bacha rahta hai** (lockout guard).
- Settings replace karne se pehle confirm; `usersMode` / settings / sessions alag-alag choose kar sakte hain.

### 🔧 Code-level changes

- `google-apps-script/Code.gs` — naya **`history`** action (purani encrypted saves ki list, optional
  `rows` + `withData`), ek write-batch ke sab records ka **same timestamp** (snapshot grouping ke liye),
  `savedAt` column hamesha **text** format (Sheets ki date auto-format se bachao).
- `apps-script-storage.js` — `history()`, `groupSnapshots()` (ek batch = ek snapshot), `snapshots()`,
  `snapshotData(at)` (server-side decrypt, sirf server ke paas key hai).
- `server.js` —
  - naye admin-only endpoints: `GET /api/storage/history`, `POST /api/storage/history/restore`,
    `POST /api/storage/pull`, `GET /api/storage/scan`, `POST /api/storage/import`, `GET /api/storage/backup`;
  - `restoreStoredIntoDb()` (merge/update/replace + lockout guard) aur `migrateUserPermissions()`
    (permission migration ab start **aur** recovery dono me chalti hai);
  - `storage.seededFresh` — agar cloud store khaali mila aur server par koi purana data nahi tha
    (yahi “sab gayab” wali situation), to UI seedha recovery dikhaata hai;
  - `/api/health` ab **package.json se version** report karta hai (pehle `3.45.0` hardcoded tha).
- `settings.js` — naya **⏪ Purana data wapas lao** section + `seededFresh` warning.

## 🚀 Deploy karne ke steps (user ke liye)

1. Repo deploy (PR merge → Render auto-deploy).
2. **Settings → ☁️ Storage & backup → 📋 Copy Code.gs** → Apps Script me paste →
   **Deploy → Manage deployments → Edit → Version: New version → Deploy**.
3. **Settings → ☁️ Storage & backup → ⏪ Purana data wapas lao** → `🔄 Purani saves dhoondho` →
   sahi wali row par **⏪ Wapas lao** → **reload (↻)**.
4. Agar history khaali ho: **“Doosri (purani) Google Sheet se data lao”** ya **backup file / disk scan**.

Poora Hindi guide: [RECOVERY.md](RECOVERY.md).

## ✅ Tests

- Naya `dev/storage-recovery.test.js`:
  1. 2 users + settings → sheet me migrate → phir sheet ko defaults (1 admin) se overwrite → naye
     deploy par `users: 1` → **history se restore** → dono purane users + purani settings + **purane
     password** wapas (login 200) ✓
  2. Doosri (purani) sheet se **pull preview + import**, `replace` mode me bhi current admin safe ✓
  3. Saare recovery endpoints **admin-only** (non-admin ko 403), full backup `attachment` ✓
- `dev/mock-apps-script.js` ab real Code.gs ki tarah **history backup** banata hai (overwrite se pehle).
- `npm run check` ✓ · `node --test dev/*.test.js` → 446 pass (7 failing tests **pehle se** the,
  clean `HEAD` par bhi fail karte hain — is change se unrelated).
