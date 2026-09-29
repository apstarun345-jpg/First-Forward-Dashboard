# v3.14.0 — New Agents & TL Changes (`newAgents.js`)
* Page: sidebar → Cross Channel → 🆕 New Agents & TL Changes (permission `newAgents`; naye users ko default; purane users ko Settings → Users me tick karna hoga).
* 🆕 Naye agents = pehli issuance selected period me (Is month / 2 / 3 / 6 mahine). Data-start month ke agents count nahi hote.
* 🔀 TL badla · ❌ TL hata (pehle TL, ab Direct/APS/khaali) · ➕ TL mila (pehle Direct, ab TL). Do consecutive active months ke TL compare hote hain; GV me date-level (mahine ke beech badle to latest TL).
* Columns: agent, ID, channel, mobile, pehli issuance, TL (pehle → ab), is/last month, total issued, stock, priority, suggested (Direct High/Medium = 🏷️ tags), status. Click → masterProfile drawer.
* Data: FF `agents` (EIR month × agent × TL) + GV `master` — koi extra sheet call nahi.
