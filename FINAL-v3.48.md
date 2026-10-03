# FINAL — First Forward Dashboard v3.48.0 ⏪ Recovery release

> Live: **https://first-forward-dashboard.onrender.com** · branch `arena/01a1037d-first-forward-dashboard` · **PR #76**
> Docs: `RECOVERY.md` (Hindi step-by-step) · `WHATS-NEW-v3.48.0.md` · `STORAGE_SETUP.md`
> (purana final doc: `FINAL-v3.8.md`)

---

## 🎯 Jo problem thi

Site khulti thi par **pahle ki saved settings, login password aur user details nahi aa rahi thin**.

Live `/api/health` bol raha tha:

```json
{ "version": "3.45.0", "storage": { "backend": "appsscript", "durable": true, "encrypted": true }, "users": 1 }
```

Matlab: storage theek hai (Google Sheet ka encrypted `APP_STORAGE`), par **sheet me sirf 1 user (default
admin)** bacha hai — isliye sab kuch "reset" lagta hai.

**Asli wajah:** `Code.gs` dobara paste karke naya deployment banane par naya `APP_STORAGE` khaali mila,
aur app ne usme defaults seed kar diye. **Purana data mita nahi tha** — wo `APP_STORAGE_HISTORY`
(har overwrite se pehle ki encrypted copy) aur/ya purani sheet me pada tha. Bas use wapas laane ka
koi rasta app me nahi tha.

---

## ✅ Kya banaya — Settings → ☁️ Storage & backup → ⏪ Purana data wapas lao

| # | Tool | Kab kaam aata hai | Kya karta hai |
|---|---|---|---|
| 1 | 🕰 **Purani saves dhoondho** | Pehle try karo — sheet history me data ho | `APP_STORAGE_HISTORY` ki saari encrypted saves ki list: **kab save hui · kitne users · kaunse usernames · app name**. Sahi wali par **⏪ Wapas lao** → users + settings + **purane password** wapas. |
| 2 | 🔄 **Doosri (purani) sheet se data lao** | Naya Apps Script / nayi sheet banayi ho | Purani sheet ka Web app URL + wahi secret → **🔍 Check** (preview: users/usernames/app name) → **⬇ Import**. |
| 3 | 📤 **Backup file se restore** | Paas me `ff-full-backup-*.json` ho | File chuno → preview → import (users + settings + sessions). |
| 4 | 💾 **Server disk scan** | Render `/data` me purani `users.json` ho | Disk/app folder scan → purani files ki list (kitne users, kab ki) → **⬇ Is folder se data lao**. |
| 5 | ⬇ **Full backup download** | Har bade change se pehle | users + settings + sessions ka backup (password hashes ke saath) — aage ke liye safety net. |

**Options (har source par):** `Merge` (sirf missing users — sabse safe) · `Merge + purane passwords`
(maujuda users ki password/permission bhi purani) · `Replace` (puri list — phir bhi **current admin
account hamesha bacha rahta hai**, lockout guard) · settings laani hai ya nahi · purane login sessions
restore karne hain ya nahi.

### 🛡 Safety (jaan-bujh kar conservative)

- **Kuch bhi automatic overwrite nahi hota** — app sirf *“sheet me N purani saves hain”* notification
  bhejta hai; restore ki permission hamesha admin ki.
- Har restore se pehle **abhi ka data bhi history me chala jaata hai** → galat restore bhi wapas ho sakta hai.
- Decryption sirf **server** par hoti hai (key server ke paas) — Apps Script ko kabhi plaintext nahi milta.
- Sabhi naye endpoints **admin-only** (non-admin ko 403).

---

## 🚀 Deploy ke baad — aapko sirf 3 kaam

1. **PR #76 merge** → Render auto-deploy. (`/api/health` me ab **asli version** dikhta hai — pehle
   `3.45.0` hardcoded tha, ab `package.json` se aata hai, to deploy confirm ho jaayega.)
2. **Settings → ☁️ Storage & backup → 📋 Copy Code.gs** → Apps Script me paste →
   **Deploy → Manage deployments → Edit (✏️) → Version: New version → Deploy**.
   *Ye step zaroori hai* — purane Code.gs me `history` action hai hi nahi (tab clear error message aata hai).
   URL same rehta hai, isliye Render env change karne ki zaroorat nahi.
3. **⏪ Purana data wapas lao → 🔄 Purani saves dhoondho** → jis row me aapke purane users dikhein →
   **⏪ Wapas lao** → **reload (↻)**. Purane password turant kaam karenge.

Agar history khaali aaye → **tareeqa 2 (purani sheet)** ya **3/4 (backup / disk)** — asli data wahin hai.

---

## 🔧 Files badle

| File | Change |
|---|---|
| `google-apps-script/Code.gs` | Naya **`history`** action (purani encrypted saves ki list, `rows` + `withData`), ek write-batch = ek timestamp (snapshot grouping), `savedAt` column hamesha text format, metadata ek hi `getValues()` call me (2000 rows par bhi fast). |
| `apps-script-storage.js` | `history()`, `groupSnapshots()` (ek batch = ek snapshot), `snapshots()`, `snapshotData(at)` (server-side decrypt). |
| `server.js` | Admin-only `/api/storage/history`, `/api/storage/history/restore`, `/api/storage/pull`, `/api/storage/scan`, `/api/storage/import`, `/api/storage/backup`; `restoreStoredIntoDb()` (merge/update/replace + admin lockout guard); `migrateUserPermissions()` ab boot **aur** recovery dono me; `storage.seededFresh` signal; `/api/health` ab package.json version. |
| `settings.js` | Naya **⏪ Purana data wapas lao** panel + `seededFresh` wala pila warning (“ye sheet nayi/khaali mili thi”). |
| `dev/mock-apps-script.js` | Mock ab real Code.gs ki tarah overwrite se pehle **history backup** banata hai. |
| `dev/storage-recovery.test.js` | Naye end-to-end recovery tests. |
| `package.json` · `README.md` · `STORAGE_SETUP.md` | v3.48.0 · recovery sections + pointers. |
| `RECOVERY.md` · `WHATS-NEW-v3.48.0.md` | Hindi guide + release note. |

---

## 🧪 Verification

| Check | Result |
|---|---|
| `npm run check` | ✅ `syntax ok` |
| `node --test dev/*.test.js` | **446 pass / 453** — 7 failing tests **pehle se** (clean `HEAD` worktree par bhi) fail hote hain, is change se unrelated |
| `node --test dev/storage-recovery.test.js dev/apps-script-storage.test.js dev/regression.test.js` | ✅ **9/9 pass** |
| Recovery E2E | 2 users + settings → sheet ko defaults (1 admin) se overwrite → naye deploy par `users: 1` → **history restore** → dono purane users + purani settings + **purane password se login 200** ✅ |
| Doosri sheet | pull preview + import ✅ · `replace` mode me bhi current admin safe ✅ |
| Permissions | Saare naye endpoints non-admin ko **403** ✅ |
| Live-style preview (mock Sheets + mock Apps Script) | `version 3.48.0`, `storage.recoverable.available: 3`, history list me purani save ke decrypted **usernames** (`owner, tl1, agent1`) dikhe ✅ |
| `Code.gs` syntax | ✅ `node --check` |

> ⚠️ `node dev/smoke.js` is sandbox se nahi chal sake — usse real **docs.google.com** chahiye, jo yahan
> network-blocked hai (`fetch failed`). Render par (jahan Google reachable hai) chalega.

---

## 🗺 Aage kya kar sakte hain (impact ke hisaab se)

| Pri | Idea | Fayda |
|---|---|---|
| ⭐1 | **Automatic daily cloud snapshot** (`APP_STORAGE_SNAPSHOTS` tab, roz 1 compressed copy) | Sheet history 2000 rows purani ho jaaye to bhi hafte/mahine purana data pakka milta rahe |
| ⭐2 | **One-click “switch storage sheet”** (nayi sheet → Render env bina khole) | Aage kabhi sheet badalni pade to data khud migrate ho, khaali sheet seed na ho |
| ⭐3 | **Restore preview diff** (kaunse users/settings badlenge, side-by-side) | Restore dabane se pehle exact farq dikhe — aur bhi safe |
| 4 | **Admin-only audit entry for every restore** (kaun, kab, kaunsi save) | Compliance + “kaunse din ka data wapas aaya” clear |
| 5 | **Weekly auto backup email** (encrypted backup file admin ko) | Sheet/Google account chale jaaye to bhi backup paas |

---

### Ek line me
**Data kabhi gaya hi nahi tha — ab use wapas laane ka rasta app ke andar hai:** `Settings → ☁️ Storage & backup → ⏪ Purana data wapas lao`.
Poora guide: **[RECOVERY.md](RECOVERY.md)**.
