# ☁️ Settings + user details ko permanent save karna (Google Sheet · Apps Script)

**Problem kya thi:** Render (bina persistent disk ke) har deploy / restart / sleep par app ka
folder mita deta hai. Users, settings, sessions aur notifications usi folder me JSON file me the,
isliye sab wapas **default** ho jaata tha. `/api/health` me ye dikhta hai:
`storage.backend = "files"` aur `durable: false`.

**Fix:** data ek Google Sheet ke hidden tab `APP_STORAGE` me save hota hai, ek chhote
Apps Script web app ke through. Google Cloud project / service account ki zaroorat **nahi**.
Har record server par hi **AES-256-GCM encrypt** hota hai, sheet me sirf encrypted text jaata hai.

> Alternative: Render par paid persistent disk (`/data`, `DATA_DIR=/data`) — DEPLOYMENT.md dekho.
> Advanced alternative (service account): SHEETS_STORAGE.md.

## 🚨 "The document cannot be modified. Perhaps it has grown too large" error aa raha hai?

Jab login/OTP par ye error aaye:
`Could not save users to Google Sheets (Apps Script). Reason: Apps Script storage: The document cannot be modified. Perhaps it has grown too larg`

**Kyun hota hai:**
1. **Google Sheet me `APP_STORAGE_HISTORY` tab bohot bada ho gaya:** Purani saves ke encrypted chunks se Google Sheets ki document size limit cross ho gayi.
2. **Ya Apps Script MAIN business sheet me laga diya gaya:** First Forward ki main sheet me EIR (60,000+ rows) aur StockDataa (100,000+ rows) hain — Google Sheets itni badi sheet me kisi script ko write nahi karne deta.

**Turant Fix (Do tareeqe):**

### Tareeqa 1: Existing sheet ko 1 minute me saaf karo (Agar alag sheet thi)
1. Wo Google Sheet kholo jisme Apps Script laga hai.
2. Agar `APP_STORAGE_HISTORY` tab hai (chhipa ho to menu **View → Hidden sheets → APP_STORAGE_HISTORY**):
   - Uspar right-click karke **Delete** kar do. (Koi user/settings data loss nahi hoga — active data `APP_STORAGE` me rehta hai).
3. `APP_STORAGE` tab me:
   - Row 10 ke neeche ki saari khaali rows delete kar do.
   - Column F ke aage ke saare khaali columns delete kar do.
4. Apps Script editor kholo (Extensions → Apps Script):
   - Naya `google-apps-script/Code.gs` paste karo (ab history 60 rows par bound hai aur auto-trim hoti hai).
   - Dropdown se `cleanStorageHistory` select karke **▶ Run** dabao.
   - **Deploy → Manage deployments → ✏️ Edit → Version: "New version" → Deploy**.
5. Sheet reload karo aur dashboard par OTP / login dobara karo — error gayab ho jayega!

### Tareeqa 2: Nayi clean sheet banao (Sabse reliable, agar main sheet me tha)
1. Google Drive me ek **brand new, empty Google Sheet** banao (naam: `First Forward Storage`).
2. Us sheet me **Extensions → Apps Script** kholo.
3. Purana code hata kar `google-apps-script/Code.gs` paste karo.
4. Editor me `setAppSecretOnce('APNA_RENDER_SECRET')` chalao (wahi same secret jo Render ke `APPS_SCRIPT_SECRET` me hai).
5. **Deploy → New deployment** → ⚙️ **Web app** → *Execute as:* **Me** · *Who has access:* **Anyone** → **Deploy** → URL copy karo.
6. Render dashboard → Environment me `APPS_SCRIPT_URL` naye URL se update karo (secret mat badalna). Save & redeploy.

---

## 🆕 v3.58 — "Could not save users/notify … (Apps Script)" error aa raha hai?

Naya `google-apps-script/Code.gs` paste karo aur **Deploy → Manage deployments → ✏️ Edit →
Version: "New version" → Deploy** karo (ye step bhoolne par purana code hi chalta rehta hai!).
Naye code me:

- **Secret auto-setup:** `setAppSecretOnce()` chalana bhool gaye to bhi ab fail nahi hota —
  server ki pehli call ka secret Script Properties me khud save ho jata hai.
- **Save confirm hota hai:** har write ke baad script sheet ko dobara padh kar verify karta hai.
- **Busy retry:** do saves takraane par script (aur server) khud retry karte hain — pehle yahi
  "busy, retry" error ban kar upar aa jata tha.
- **Debugging aasaan:** Apps Script editor me `checkSetup()` ▶ Run karo → poori checklist milti
  hai; ya browser me apna `/exec` URL kholo → status JSON dikhta hai (secret kabhi leak nahi hota).
- Dashboard error me ab **asli reason** bhi dikhta hai (`Reason: unauthorized (secret mismatch)`
  waghaira) — turant pata chal jata hai ki kya galat hai.

## Sabse aasaan tarika — app ke andar wizard (≈5 minute)

Latest code deploy hone ke baad admin login karo → **Settings → ☁️ Storage & backup**.
Upar pila banner "Settings aur user details permanent save nahi ho rahe" bhi isi page par le jaata hai.

0. *(Optional)* **⬇ Export settings JSON** dabake apni settings ka backup le lo.
1. **Google Sheet kholo** — ek **naya private** Google Sheet banao (recommended; business sheet
   alag rehti hai) → menu **Extensions → Apps Script**.
2. Wizard me **📋 Copy Code.gs** dabao — secret code me pehle se bhara hota hai.
   Apps Script me purana code hata ke paste karo → 💾 Save.
3. **Deploy → New deployment** → ⚙️ type **Web app** →
   *Execute as:* **Me** · *Who has access:* **Anyone** → **Deploy** → permissions *Allow* karo →
   **Web app URL** (`https://script.google.com/macros/s/…/exec`) copy karo.
4. URL wizard me paste karo → **🔌 Test connection** → **☁️ Copy current data to Sheet**
   (abhi ke users + settings + sessions sheet me copy ho jaate hain aur verify hote hain).
5. **📋 Copy Render env values** → Render dashboard → service → **Environment** → ye 2 variables add karo:

   | Key | Value |
   | --- | --- |
   | `APPS_SCRIPT_URL` | Web app `/exec` URL |
   | `APPS_SCRIPT_SECRET` | wahi secret jo Code.gs me hai (kam se kam 16 characters) |

   → **Save, rebuild and deploy**.

Check: `https://<site>/api/health` → `storage.backend: "appsscript"`, `durable: true`,
`warning: null`. Settings page par hara ✅ "Permanent storage ON" dikhega.

> ⚠️ Render free plan 15 minute idle par so jaata hai (aur files mita deta hai). Isliye deploy ke
> turant baad steps 1-5 kar lo; uske baad jo bhi settings / users banaoge sab permanent rahenge.

## ⏪ Saved settings / users / passwords gayab ho gaye hain?

Ghabrao mat — data aksar maujood hota hai, bas wapas lana padta hai: **Settings → ☁️ Storage & backup
→ ⏪ Purana data wapas lao** (`APP_STORAGE_HISTORY` ki purani encrypted saves, purani sheet se import,
backup file ya Render disk se restore). Poora step-by-step guide: **[RECOVERY.md](RECOVERY.md)**.

## Zaroori baatein

* **Secret kabhi mat badlo.** Badla to purana data decrypt nahi hoga — app start hi nahi hogi
  (defaults se overwrite kabhi nahi karti). Secret ko password manager me save rakho.
* Code.gs badla ho to **Deploy → Manage deployments → Edit → New version** karo (URL same rehta hai).
* **v3.27 (tag request → alag sheet):** naye Code.gs me `openById` + `sheettest` action hai. Agar aap
  tag requests kisi **doosri Google Sheet** me bhejna chahte ho (Tag Request page → 📗 card → sheet ka
  link), to ye naya Code.gs paste karke "New version" deploy karna zaroori hai — aur us alag sheet par
  is Google account ko **Editor** access dena hoga (Sheet → Share). Link khaali chhodo to entry pehle
  jaisi isi sheet me hoti hai.
* Sheet me `APP_STORAGE` tab ko delete / edit mat karo. Usme encrypted rows hain.
* Agar sheet me pehle se data hai to wizard **overwrite nahi** karta (409). Overwrite sirf confirm
  karne par hota hai.
* Google down ho to save **fail** dikhata hai (503) — kabhi chupchaap temporary file me save nahi
  karta. Server start par sheet read na ho to server start hi nahi hota (defaults par nahi girta).
* Notifications thode delay (≈4s) se batch me save hote hain, taaki Apps Script quota bache.

## 📱 GV live update → phone panel (optional instant edit trigger)

The dashboard server checks the configured **GV Master** live tab every 15 seconds (the shared feed cache
limits normal Google reads to 30 seconds). For direct manual edits, the updated `google-apps-script/Code.gs`
can also install an edit trigger that wakes the server immediately; the server re-reads the live snapshot and
sends a detailed alert only when the GV count/class data actually changed. Formula recalculation, imports and
API/script writes do not fire Google’s `onEdit` trigger, so the server poll remains the fallback.

1. Paste the updated repository `google-apps-script/Code.gs` into the existing Apps Script project. Keep its
   `SECRET` exactly the same as the existing Render `APPS_SCRIPT_SECRET`.
2. In the temporary `configureInstantGvPushOnce()` helper, replace `YOUR-DASHBOARD-DOMAIN` with the HTTPS
   dashboard host and `YOUR-GV-SPREADSHEET-ID` with the spreadsheet ID configured in Dashboard Settings
   (the workbook containing the `GV Master` tab). Run this helper once in Apps Script and allow access; the
   script account needs Editor access to the GV workbook.
3. **Deploy → Manage deployments → Edit → New version → Deploy** so the storage web app keeps using the
   updated Code.gs. Do not change the deployment URL or secret.
4. In Dashboard → Settings → My account → Notifications, admin **Push diagnostics** shows both the last GV
   snapshot check and the last phone push result. The `/api/push/status` endpoint reports the same status.

The Apps Script trigger handles direct cell edits. For formula-driven/API-fed rows, push may follow the 15-second
poll (typically within 30–45 seconds); the dashboard process must remain awake for background checks.

## Local test

```bash
npm test          # dev/apps-script-storage.test.js: mock Apps Script (302 redirect), migrate, restart on empty disk
```
