# 📱 Android app jaisa experience

## v3.73 — Native Android shell (sabse naya)

Phone / installed app me ab layout Material 3 (Android) jaisa hai — `native-app.js` + `native-shell.css`, sirf `html.mobile-ui` par (desktop bilkul same):

| Pehle | Ab |
|---|---|
| Topbar me 12 emoji buttons ki side-scroll patti | 56px app bar: ☰ · page title · 🔍 · 🔔 (badge) · ⋮ |
| Bhasha / theme / a11y / focus / refresh / office bell / voice / saved view — sab topbar me | ⋮ → **Options bottom sheet** (asli buttons hi chalte hain, koi feature nahi hata) + Account |
| Search topbar ki patti me chhupa input | Poori screen ka search (← back, suggestions full screen) |
| Phone ka **Back** button page hi badal deta tha | Back pehle khula sheet / drawer / menu / search / notifications band karta hai |
| Har tab tap history me jud jaata tha | Home → tab = back se Home · tab → tab = history me dher nahi |
| Pull-to-refresh band tha | Page top par neeche kheencho → data refresh (app ka apna, browser wala nahi) |
| KPI detail drawer upar se poori screen | Bottom sheet — handle neeche kheencho to band |
| Sidebar me 30px text, kata hua | Normal Android drawer (15px, pill active item), left swipe se band |
| Status bar hamesha kaala | App bar ke rang ka (light / dark) |
| Location prompt bada dabba | Android snackbar (ek line, Allow · ✕) |
| Dark mode me kuch page titles safed-par-safed | Theek |
| Tables me naam akshar-akshar neeche (A/S/H/O/K) | Table swipe hoti hai, naam ek line me |

Installed app khud update ho jaayega (service worker `apnapayment-v126`). Purana app band karke dobara kholo.

---

## v3.58 — pehla app-feel layer

Dashboard ab installed PWA me **native Android app jaisa** chalta hai — browser jaisa feel hata diya gaya hai.

## App me kya-kya native ho gaya

| Browser feel (pehle) | App feel (ab) |
|---|---|
| Pull-to-refresh / rubber-band scroll | ❌ Band — app ka apna ↻ Refresh button hai |
| Link long-press par browser menu/callout | ❌ Band (UI chrome par) |
| Tap par blue flash + double-tap zoom delay | ❌ Band (`touch-action: manipulation`) |
| Topbar/sidebar ka text select ho jata tha | ❌ Band — tables/content par copy pehle jaisa chalta hai |
| Page change par turant content badal jata tha | ✅ Halka native-style slide+fade transition |
| Status bar / notch ke neeche content dab jata tha | ✅ Safe-area insets (edge-to-edge Android, notch phones) |
| Install hone par bhi browser window kabhi khulti thi | ✅ `launch_handler: navigate-existing` — hamesha ek hi app window |

Ye sab sirf **installed app / mobile** me lagta hai (`html.pwa-standalone` class) — desktop browser layout bilkul same hai.

## Phone par install (Play Store ke bina)

1. Android Chrome me dashboard kholo → login karo.
2. Topbar ka **⬇️ Install App** button dabao (ya Chrome menu → *Add to Home screen* → **Install**).
3. Home screen icon se kholo — ab na URL bar, na browser menu: full-screen app window, apna icon, apna splash screen, Recents me alag card.

> Pehle se installed hai? App band karke dobara kholo — service worker `apnapayment-v117` naya shell khud le aayega (update toast bhi aa sakta hai).

## Real APK chahiye (Play Store / APK file)?

PWA ko **Trusted Web Activity (TWA)** APK me 10 minute me convert kar sakte ho — koi code change nahi chahiye, sab requirements (HTTPS, manifest, service worker, maskable icons) pehle se ready hain:

1. <https://www.pwabuilder.com> kholo.
2. URL me `https://first-forward-dashboard.onrender.com` daalo → **Start** → report green hogi.
3. **Package for Stores → Android** → Download. Zip me signed `.apk` (direct install / WhatsApp share ke liye) aur `.aab` (Play Store upload ke liye) dono milte hain.
4. Address bar APK me bhi na dikhe iske liye zip ka `assetlinks.json` file apne server par `/.well-known/assetlinks.json` par serve karna hota hai (Digital Asset Links verification). Zip ke andar instructions hoti hain.

> APK bhi andar se isi live URL ko chalata hai — matlab har deploy par app apne aap update, Play Store review ki zaroorat nahi.
