# 🛠️ v3.58.0 — "Could not save … Save not confirmed" fix · 📇 mobile ka regex · 🩺 diagnosis

Symptom ek hi tha — **"Could not save notify/users to Google Sheets (Apps Script). Save not confirmed"** —
par uske peeche **teen alag bugs** the. Teeno fix ho gaye, aur teeno ke liye aise test likhe gaye hain jo
fix hataane par **fail** ho jaate hain (revert-check, neeche details).

---

## 🐛 Bug 1 — LOCK COLLISION → save permanently fail (sabse bada karan)

**Kya ho raha tha**

- `google-apps-script/Code.gs` ka `doPost` har request par **ek hi global** `LockService.getScriptLock()`
  leta tha: `if (!lock.tryLock(25000)) return { ok:false, error:'busy, retry' }`.
- Client (`apps-script-storage.js`) me `if (!json.ok) throw new Error(...)` tha — us error par **`retry` flag
  hi nahi lagta tha**, aur `"busy"` client ke network-retry regex
  (`fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket`) me **match bhi nahi karta** → loop `break` → save turant
  fail → server 503 → *"Could not save … Save not confirmed"*.
- Yani **Apps Script ne "retry" kaha, client ne retry hi nahi kiya.** Do save ek saath aane par (jaise
  `notify` + `users`) ek lock hold karta tha aur doosra seedha fail ho jaata tha.

**Ab kya hota hai (fix)**

- **Code.gs:** lock ab **60s tak, 8s ke slices** me dobara maanga jaata hai (`acquireLock_`, `LOCK_WAIT_MS`
  / `LOCK_SLICE_MS`) — ek lamba `tryLock(timeout)` Apps Script me bharosemand nahi hai.
- **Code.gs:** busy/quota/timeout par `{ ok:false, code:'busy', retry:true, version }`.
- **Code.gs:** **read-only actions lock ke BINA chalte hain** — `ping`, `health`, `sheettest`,
  `readaddresses`. Apps Script me *keyed* lock nahi hota (poora script ek hi lock par hai), isliye
  contention kam karna hi asli raasta hai. `read`/`history` jaan-boojh kar lock ke andar rakhe gaye hain —
  likhai ke beech aadha-adhoora (torn) read na ho.
- **apps-script-storage.js:** `json.retry === true` **ya** `json.code === 'busy'` **ya** message me
  `busy|lock|timeout|rate limit|quota|temporar` → `err.retry = true` → client apne aap retry karta hai
  (4 attempts, backoff 0.5s → 1s → 2s + jitter; HTTP 429/5xx aur timeout par pehle se hi retry hota hai).
- Client ka per-attempt abort 30s hai aur lock 60s tak wait karta hai — beech me abort ho jaye to client
  dobara try karta hai, aur write **idempotent** hai (har baar poora record hi likha jaata hai), isliye
  duplicate/aadha data ka risk nahi.

## 🐛 Bug 2 — ADDRESS BOOK me mobile kabhi save nahi hota tha (double-backslash regex)

`server.js` → `addressEntryFromRequest()` me regex me **do backslash** the:

```js
// PEHLE (bug)                                    →  '9876500001'.replace(/[^\\d+]/g,'') === ''
const mobile  = ... .replace(/[^\\d+]/g, '')       // '\' · 'd' · '+' chhod kar SAB hata do
const address = ... .replace(/\\s+/g, ' ')         // literal '\' + 's' — kabhi match hi nahi karta
// AB (fix — single backslash)
const mobile  = ... .replace(/[^\d+]/g, '')
const address = ... .replace(/\s+/g, ' ')
```

Matlab: mobile ke **saare digits hat jaate the** → address book me mobile hamesha khaali save hota tha →
📇 "purana address" chip me mobile kabhi nahi aata tha.

Wahi galti **2 aur jagah** thi, wo bhi fix hui (kul **6 sites**):

| File | Site | Pehle | Ab |
|---|---|---|---|
| `server.js` | `addressEntryFromRequest` mobile | `/[^\\d+]/g` | `/[^\d+]/g` |
| `server.js` | `addressEntryFromRequest` address | `/\\s+/g` | `/\s+/g` |
| `server.js` | EIR overlay — `gvMasterId` `.0` strip | `/\\\\.0+$/` | `/\\.0+$/` |
| `server.js` | EIR overlay — sheet ka `master` column `.0` strip | `/\\\\.0+$/` | `/\\.0+$/` |
| `Code.gs` | `readaddresses` pincode cleanup | `/\\D/g` | `/\D/g` |
| `Code.gs` | `upsertaddresses` pincode cleanup | `/\\D/g` | `/\D/g` |

GV master ID ka `.0` na katne se GV rows **galat channel (FF)** me gin li jaati thi — `'5845036.0' !== '5845036'`.
Pincode cleanup ka asar: Address tab me pincode dobara likhne par `\D`/backslash characters bach jaate the.

> **Jaan-boojh kar nahi chhua:** `server.js` ke **client-JS template literals** ke andar wale `\\D` / `\\s+`
> (personal portal ka inline JS). Wahan double backslash **sahi** hai — browser me single ban kar jaata hai.

## 🩺 Bug 3 — diagnosis: fail hone par pata hi nahi chalta tha kya toota

- **`SCRIPT_VERSION` constant** (`'v3.58-storage'`) — `doGet`, `ping`, `health`, `write` aur har error
  response me `version` jaata hai. Isse turant pata chalta hai ki naya Code.gs deploy hua ya nahi.
- **`healthOnce()`** — ek hi jagah poora diagnosis:
  secret set hai + length ok? · effective user · spreadsheet naam/ID/URL · `APP_STORAGE` rows/columns ·
  **kaunse kinds ke records hain aur kaunse MISSING** · `APP_STORAGE_HISTORY` tab + latest save ·
  aur ek **scratch cell par likh-padh kar** write permission confirm (data tab me kuch nahi likha jaata).
- **`doPost` catch:** ab response me **action ka naam + exception ka naam (`errorName`)** bhi aata hai;
  quota / timeout / rate-limit par `code:'busy', retry:true` (client apne aap retry karta hai).
- **`writeRecord_` guard:** agar ek record ko **18278 columns** (Google Sheets ka hard limit) se zyada
  chahiye to ab **saaf error** aata hai — pehle aisa record chup-chaap adhoora likha jaata tha (ya ulta
  `insertColumnsAfter` error deta tha), aur recovery me ciphertext adhoora milta tha.

---

## 🚀 Deploy steps (ZAROORI — sirf dashboard deploy karne se Code.gs update nahi hota)

1. **Google Sheet → Extensions → Apps Script** kholo → poora naya `google-apps-script/Code.gs` paste karo
   (dashboard me **Settings → ☁️ Storage & backup → 📋 Copy Code.gs** se bhi mil jaata hai) → **Save**.
2. **Deploy → Manage deployments → ✏️ Edit → Version: "New version" → Deploy.**
   Naya URL nahi chahiye — wahi `/exec` URL rehta hai, isliye Render ke env vars chhune ki zaroorat nahi.
3. **Verify:** Apps Script editor me `healthOnce()` (▶ Run) — output me `version: "v3.58-storage"` aur
   `writable.ok: true` dikhna chahiye. Dashboard se bhi: Settings → Storage/sheet test (`codeVersion`) aur
   `/api/health`.
4. **Render:** koi naya env var nahi (`APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET` pehle jaise). Server code
   apne aap deploy hota hai.
5. **Cache-bust nahi chheda:** koi browser asset nahi badla (ye fix server-side + Apps Script me hai) —
   `config.js?v=109`, `styles.css?v=110`, SW `apnapayment-v113` waise hi hain.
6. Ab koi bhi save (Settings me kuch badal kar dekho) busy hone par **khud retry** hoga aur confirm hoga.

## 🧾 Error message → matlab

| Message (jo dikhega) | Matlab | Kya karo |
|---|---|---|
| `Could not save users to Google Sheets (Apps Script). Save not confirmed…` | 4 attempts ke baad bhi save confirm nahi hua (server ne 503 diya) | Neeche ki row dekho; pehle ye pakka karo ki naya Code.gs deploy hai |
| `Apps Script storage: busy, retry — script lock 60s tak free nahi hua` | Koi doosra save 60s tak lock hold kiye tha (client apne aap 4 baar retry karta hai) | Aksar apne aap theek ho jaata hai; lagataar aaye to `healthOnce()` dekho (bahut bada record ya loop) |
| `Apps Script storage timeout` | Ek attempt 30s me jawab nahi aaya (Apps Script slow / lock wait) | Client khud retry karta hai; lagataar ho to `healthOnce()` |
| `unauthorized (secret mismatch)` | Render ke `APPS_SCRIPT_SECRET` aur Apps Script ke secret alag hain | Dono bilkul same karo. **Purana secret MAT badlo** — purane records decrypt nahi honge |
| `APPS_SCRIPT_SECRET missing — run setAppSecretOnce(secret) once…` | Script Properties me secret set hi nahi hai | Apps Script me `setAppSecretOnce('…')` run karo, phir **New version** deploy |
| `unknown action` / `errorName: "UnknownAction"` | Apps Script me **purana** Code.gs deployed hai (naye actions nahi hain) | Naya Code.gs paste + Deploy → Manage deployments → Edit → Version: New version |
| `record for "users" needs 18300 columns, but a Google Sheet can hold only 18278…` | Ek hi record itna bada hai ki sheet me fit nahi hota | Record chhota karo (attachments/images hatao). Record **jaise hai waise save nahi hoga** — chup-chaap kata nahi jayega |
| `...quota / rate limit / too many...` (code `busy`) | Apps Script/Gmail ki daily quota ya rate limit | Thodi der (ya quota reset hone) baad try karo — client khud bhi retry karta hai |
| `SpreadsheetApp.getActive() fail — script kisi sheet se BANDHA hona chahiye` | Script sheet se bandha (bound) nahi hai | Sheet → **Extensions → Apps Script** se kholo; standalone Apps Script project ka `getActive()` kaam nahi karta |
| `Address tab me mobile khaali` (purana data) | v3.58 se pehle ka bug — mobile save hi nahi hua tha | Naya Code.gs deploy hone ke baad koi nayi request aane par mobile apne aap bhar jaayega |

## ✅ Verification

- `npm run check` → **syntax ok**
- `npm test` → **507 tests · 507 pass · 0 fail**
- **Naye/updated tests**
  - `dev/v358-storage-lock.test.js` (7 naye) — Code.gs lock contract (60s/8s slices, busy payload me
    `code:'busy' + retry:true + version`), read-only actions lock ke bina, `SCRIPT_VERSION` har response me,
    `healthOnce()` ke saare fields, 18278-column guard, catch me `action` + `errorName`,
    aur regex double-backslash regression guard (6 sites, client-JS literals ko chhode bina).
  - `dev/apps-script-storage.test.js` (+2) — mock me naya **`busyWrites(n)`** mode (HTTP 200 par
    `{ok:false, code:'busy', retry:true}` **302 → echo flow** ke through, asli Code.gs jaisa):
    (a) busy par client retry karke save **SUCCEED** karta hai, (b) busy lagataar rahe to **error** aata hai
    aur purana data safe rehta hai (chup-chaap loss nahi).
  - `dev/public-tag-request.test.js` (+asserts) — `/api/public/tag-request/contact` se mobile
    `9876500001` wapas aata hai, address ke extra spaces collapse hote hain, aur sheet wali
    `upsertaddresses` row me bhi mobile + collapsed address jaata hai.
- **Revert-check (guard asli hai ya nahi):** har fix ko ek-ek karke temporarily revert kiya gaya —
  **13/13 guards ne revert pakda** (test fail hua), phir fix wapas lagaya gaya (files sha256 se verify kiye).
- Version: **package.json 3.58.0** (health me bhi 3.58.0), Code.gs `SCRIPT_VERSION = 'v3.58-storage'`.
