# What's new — v3.12.0 (🧍 Direct Agents & TLs — ek hi rule, poori site par)

Aapka rule ab **configured** hai aur **har page** par same tarah lagta hai:

| Channel | Direct Agent kaun? |
| --- | --- |
| 🟩 **GV Partner** | jinke **TL ID aur TL Name dono khaali** hain (koi TL hi nahi). Self-supervised rows (agent khud apna supervisor) bhi direct. |
| 🟦 **First Forward** | jinke **TL Name = APS** hai (APS/direct/placeholder naam). |

Default live hai; badalna ho to **Settings → 🧍 Direct Agents** me jaake rule edit karein (FF TL names list, GV blank-TL rule on/off, labels, dispatch exempt). Wahin live preview dikhata hai ki current data me kitne agents direct ban rahe hain.

## Ek jagah define, sab jagah same

- **Nayi API:** `FF.config.isDirectAgent(row, channel)` · `isRealTl(name)` · `directLabel(row, channel)` · `directRules()` + `FF.direct` helper layer (label, reason, counts, split, filterButtons, ruleBanner, roster).
- **GV Stock Report** — dispatch view me do hisse: (1) 📦 "stock chahiye" plan (direct excluded), (2) 🚫 **Direct Agents — alag list (no dispatch)**. TL dropdown me `🚫 Direct Agents · no TL (n)` option, Dispatch filter me `🚫 Direct Agents · no TL`, TL stock rollup me alag row, top par rule banner.
- **FF Performance / dispatch alerts** — TL dropdown me `🚫 Direct Agents · APS (n)`, dispatch bar me "Direct Agents · no dispatch" filter, TL cell me direct chip, direct agents TL ranking me nahi.
- **Dispatch Planner (cockpit)** — dispatch pool: "🚚 Need stock (direct excluded)" / "🚫 Direct agents (no dispatch)" / "All forecast agents".
- **Stock page (FF)** — overview me direct count, Criteria select me "Am I direct? (APS)", agent table ka direct-only view + note.
- **Stock Forecast (insights)** — direct agents urgent dispatch list se bahar, KPI me FF/GV direct split, TL replenishment rollup me `🚫 Direct` bucket.
- **Team Network / Activity / Radar / Report Cards** — direct agents ka apna hub, TL-wise strength me `🚫 Direct Agents (no TL)` row → is naye page par.
- **Master search** — APS/Direct placeholder TL ke ghost cards khatam; person kundli me direct chip + reason; tags/ID tables me direct label.
- **Trend / Range report / Targets / Compare / Dashboard / Certificates / GV commission / Arena / War Room** — sab jagah direct agents ka label same: `Direct Agent (APS)` ya `Direct Agent (no TL)`, aur TL lists se bahar.
- **Naya page `#/directAgents`** — dono channel ke direct agents ka roster (reason, stock, MTD issuance, status, priority) + channel filter + CSV + rule cards.
- **Permission** — naya page permission `directAgents` (Settings → Access matrix me dikhta hai).

## Data layer

- GV Master / Tag Assignment / GV REPORT / GV stock rows par `directAgent` flag (TL ID bhi query hota hai, warna blank-TL rule fire hi nahi hoti).
- `G.tlRollup()` me direct agents kabhi nahi; naya `G.directRollup(ym)` sirf direct agents ke liye. `G.summary(ym).directAgents` bhi milega.

## Tests

- `dev/direct-agent.test.js` — dono channel ke rules + site-wide wiring.
- `dev/smoke.js` — naya v3.12 check: FF + GV dispatch filters, GV/TL rollup leak, dedicated page, roster.
- `npm run check` me `directAgents` bhi shamil.
