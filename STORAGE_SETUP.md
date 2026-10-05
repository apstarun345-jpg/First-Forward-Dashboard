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
