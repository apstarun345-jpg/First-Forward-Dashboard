# ⏪ Purani settings, users aur passwords wapas lana (Recovery)

**Problem:** site khul rahi hai par pahle ki **saved settings**, **login password** aur **user details**
nahi aa rahin — `/api/health` me `users: 1` (sirf default admin) dikhta hai.

**Kya hua tha:** app ka data Google Sheet ke `APP_STORAGE` tab me encrypted save hota hai. Jab
**Code.gs dobara paste karke naya deployment** banaya jaata hai (ya nayi sheet / naya URL connect
hota hai), to naya `APP_STORAGE` khaali milta hai aur app usme **defaults** (1 admin) seed kar deta
hai. Purana data mita nahi hai — wo **purani sheet** ya **`APP_STORAGE_HISTORY`** tab me encrypted
pada hai. Neeche teen tareeke hain, upar wala sabse aasaan hai.

> 🔒 Kabhi bhi `APPS_SCRIPT_SECRET` mat badlo. Badla to purana encrypted data decrypt hi nahi hoga
> (app jaan-bujh kar start nahi hoti, defaults se overwrite nahi karti).

---

## 0. Ek baar ye zaroor karo (≈3 minute) — v3.48 code deploy

Recovery tab tabhi chalti hai jab **Render par naya code** ho **aur** Apps Script me **naya Code.gs** ho.

1. Render: is repo ki latest branch deploy hone do (PR merge ke baad auto-deploy).
2. Admin login → **Settings → ☁️ Storage & backup** → **📋 Copy Code.gs** (isme aapka secret pehle se
   bhara hota hai).
3. Google Sheet → **Extensions → Apps Script** → purana code hata ke paste → 💾 **Save**.
4. **Deploy → Manage deployments → Edit (✏️) → Version: New version → Deploy**.
   *(URL badalna nahi chahiye — same `/exec` URL rehta hai, isliye Render env change karne ki
   zaroorat nahi.)*
5. Site par wapas aao → **Settings → ☁️ Storage & backup → ⏪ Purana data wapas lao**.

Agar Code.gs purana hi raha to history dabane par ye message aayega:
*"Is sheet ke Apps Script me naya Code.gs deploy nahi hua hai (history action missing)"*.

---

## 1. 🕰 Sheet history se wapas lao (sabse pehle ye try karo)

Har baar jab bhi koi save overwrite hoti hai, usse pehle wali **encrypted** copy
`APP_STORAGE_HISTORY` tab me chali jaati hai (v3.28 se ye protection chalu hai).

1. **Settings → ☁️ Storage & backup → ⏪ Purana data wapas lao → 🔄 Purani saves dhoondho.**
2. List me har purani save ke saath dikhega: **kab save hui**, **kitne users**, **usernames**,
   **app name**.
3. Sabse purani/सही wali row par **⏪ Wapas lao** dabao. Options:
   - **Users kaise laayein**
     - `Merge` — sirf wahi users laata hai jo abhi nahi hain (sabse safe; current password nahi badalta)
     - `Merge + purane passwords` — maujuda users ki password / permission bhi purani wali ho jaati hain
     - `Replace` — puri user list purani wali (phir bhi aapka abhi ka admin account bacha rahega)
   - **Settings** — purani settings bhi wapas chahiye ya nahi
   - **Login sessions** — purane logins restore karo ya sabko dobara login karwao
4. ✅ ho gaya → **page reload (↻)** karo. Purane users aur unke **purane password** ab kaam karenge.

> 🏷️ **Isi save ke `notify` record se Tag Requests bhi apne aap merge hoti hain** — jo request abhi
> list me nahi hai wahi ID-wise wapas judegi (kuch delete nahi hota). Sirf requests chahiye to
> neeche wala **tareeqa 1b** use karo.

**Kuch bhi tab tak nahi badalta jab tak aap *Wapas lao* na dabayein.** Aur har restore se pehle abhi
ka data bhi history me save ho jaata hai — to galti ho jaaye to wapas bhi ja sakte ho.

---

## 1b. 🏷️ Tag Requests wapas lao (employee link / form wali requests)

**Problem:** employee link se lagayi hui requests Tag Request list me nahi dikh rahin (baaki data
theek hai). **Kyun hota hai:** requests `notify` record ke andar save hoti hain. Deploy ke waqt do
process kuch der saath chalte hain — agar **purana process apna purana snapshot** baad me likh de to
nayi requests gayab ho jaati hain. v3.50 se app aise save ko rok kar storage se **merge** kar leti
hai, aur phir bhi kuch chhoot jaaye to neeche se wapas laayi ja sakti hai.

1. **🏷️ Tag Request → 📥 Tag Requests** kholo. Agar boot par kuch missing mili hai to upar hi peela
   banner + 🔔 notification dikhega: *“⏪ N requests wapas laayi ja sakti hai”* → usi par **⏪ Wapas lao**
   dabao.
2. Ya **Settings → ☁️ Storage & backup → ⏪ Purana data wapas lao → 🏷️ Tag Requests recovery →
   🔎 Tag Requests wapas dhoondho** dabao. Do source check hote hain:
   - **Storage record (sabse fast):** abhi ki Google Sheet `APP_STORAGE` me jo requests hain.
   - **Purani saves (history):** `APP_STORAGE_HISTORY` ki saves (har save batati hai kitni missing hai).
3. Jis row me **missing** likha ho uspar **⏪ Wapas lao** dabao (ya **Storage se wapas lao**).
4. ✅ sirf **missing** requests **ID-wise** judengi — maujooda requests / unka status / admin notes
   waisi hi rehti hain, aur kuch bhi delete nahi hota. Dobara dabane par duplicate nahi banta.

**Ye bhi theek hai:** Tag Request page par **🔔 Notification check** dabao — wo batata hai nayi request
par 🔔 feed + mobile push ban raha hai ya nahi (route `tagRequest` OFF hai? admin ka master switch /
“🏷️ Tag Request” preference OFF hai? koi push device register nahi hai? push service error?).

> ⚠️ Recovery tab ki users/settings list (tareeqa 1) `notify` record wapas **nahi** laati — requests
> ke liye hamesha **1b** (ya us save par restore karte waqt “Tag Requests bhi laao”) use karo.

---

## 2. 🔄 Purani (doosri) Google Sheet se data lao

Agar aapne **naya Apps Script / nayi Google Sheet** banayi aur Render me naya
`APPS_SCRIPT_URL` daala, to asli data **usi purani sheet** me hai. (Settings page par pila warning
*"Ye sheet nayi (khaali) mili thi"* bhi yahi batata hai.)

1. Purani sheet kholo → **Extensions → Apps Script** → uska **Web app URL** (`…/exec`) copy karo.
   Secret wahi hai jo us Code.gs me likha tha.
2. Nayi site par: **Settings → ☁️ Storage & backup → ⏪ Purana data wapas lao → “Doosri (purani)
   Google Sheet se data lao”** → URL + secret daalo → **🔍 Check**.
3. Preview me dikhega: kitne users, kaunse usernames, app name.
4. **⬇ Us sheet se data lao** → options chuno (upar jaise) → import → **reload (↻)**.

> 🏷️ Us purani sheet ke `notify` record se **Tag Requests bhi merge** hoti hain (v3.50 se) — ID-wise,
> kuch delete nahi hota.

> Dono sheets ka **secret same** hona chahiye, warna “decrypt” error aayega. Alag secret hai to
> purane Code.gs me likha secret use karo (Code.gs ki pehli line `const SECRET = '…'`).

---

## 3. 📤 Backup file ya Render disk se restore

- **Backup file:** **⏪ Purana data wapas lao → “Backup file se restore”** → apna purana
  `ff-full-backup-*.json` (ya settings JSON) chuno → import.
- **Render disk:** **💾 Server disk scan** — Render ke `/data` folder me purani `users.json` /
  `settings.json` milti hai to wahan **⬇ Is folder se data lao** daba do.
- **Aage ke liye:** **⬇ Full backup download (users + settings)** — is file me password hashes hote
  hain (isi liye se purane login wapas kaam karte hain), isliye ise sirf apne paas rakho, chat/WhatsApp
  par share mat karo.

---

## ❓ FAQ

**Users abhi bhi 1 hi dikhte hain.** → Ho sakta hai purani save me bhi 1 user ho (yaani loss usse
pahle ho gaya tha). Tab **tareeqa 2 (purani sheet)** ya **3 (backup/disk)** try karo.

**“locked” ya decrypt error aa raha hai.** → Wo purani save kisi **alag secret** se encrypted thi.
Us waqt ka secret (`APP_SCRIPT_SECRET` / Code.gs ki `const SECRET`) use karo.

**`APP_STORAGE_HISTORY` tab me kuch nahi hai.** → Tab us sheet me v3.28 se pahle ka Code.gs tha;
history tabhi banana shuru hua jab naya code deploy hua. Tareeqa 2/3 use karo.

**Sheet me koi purani save hi nahi mili.** → Samay ke saath tab sirf **2000** purani rows rakhta hai
(sabse nayi). Bahut purana data ho to tareeqa 2/3.

**Tag requests gayab ho gayin hain.** → **Tareeqa 1b** (🏷️ Tag Requests recovery) — abhi ka storage
record + purani saves dono check karta hai aur sirf missing requests ID-wise wapas jodta hai.

**Kya kuch automatic ho jaata hai?** Nahi — jaan-bujh kar nahi. (Tag requests ke mamle me v3.50 se
save se *pehle* storage se merge hota hai, par list me wapas laana hamesha aapke click par hota hai.) App sirf *“purani saves maujood hain”*
ki notification bhejta hai; restore ki permission hamesha aapki.

---

## 🔁 Aage se aisa na ho — 2 minute ka kaam

1. **Secret kabhi mat badlo** (password manager me save rakho).
2. Har bade change se pahle: **Settings → ⏪ Purana data wapas lao → ⬇ Full backup download**.
3. Apps Script me code badlo to hamesha **Manage deployments → Edit → New version** (naya deployment
   nahi) — isse URL same rehta hai aur Render env change karne ki zaroorat nahi padti.
4. Ek baar `/api/health` check karo: `storage.backend: "appsscript"`, `durable: true`,
   `warning: null`, `seededFresh: false`. Admin ko `tagRequestRecovery` field bhi dikhta hai
   (missing requests ka summary).
5. Deploy ke waqt purana instance turant band kar do (Render: naya deploy hote hi purana process
   kuch second zinda reh sakta hai) — aur deploy ke baad ek baar **🏷️ Tag Request → 📥 Tag Requests**
   khol ke requests ginti milaa lo.
