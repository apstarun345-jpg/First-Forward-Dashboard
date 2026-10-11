# v3.70.4 — 🔗 FASTag Mapping: VC class ka "VC" prefix ab server pakka lagata hai

## Problem

`/tag-request` wale employee flow ke baad jab admin **🔗 FASTag Mapping** page par
StockDataa se lookup karke apnapayment mapping API (`/api/agent/inventory/update`) par
rows bhejta tha, to rows fail ho jaati thi:

> **Failed** · Invalid vehicle type. Allowed types: VC4, VC5, VC6, VC7, VC12, VC15, VC16.

Wajah: **StockDataa sheet ke TAG_CLASS column me class plain number me likhi hai**
(`4, 5, 6, 7, 12, 16`), jabki API sirf canonical `VC4…VC16` form accept karti hai.
Purana/cached frontend (PWA service worker) ya seedha CSV upload `4` bhej deta tha → mapping fail.

## Fix

1. **Server (asli fix):** `/api/fastag-mapping/map` ab payload banate waqt har row ka
   `vcType` naye `normalizeVcType()` se normalize karke bhejta hai — chahe client kuch bhi bheje.
2. **Client (`fastagMapping.js`):** wahi robust normalizer ab lookup table + API payload dono me —
   - plain number: `4 / 5 / 12 / 16` → `VC4 / VC5 / VC12 / VC16`
   - gviz float: `4.0` → `VC4` · leading zero: `004` → `VC4`
   - decorated: `vc 7 / VC-12 / Class 4 / TAGCLASS16` → `VC7 / VC12 / VC4 / VC16`
   - pehle se `VC4` jaisa → waisa hi · pehchana nahi gaya → API khudi bata degi (pehla behaviour)

Server-side normalize hone se **stale cached browser ya koi bhi purana client ab galti se bhi
bina-VC value API ko nahi bhej sakta** — mapping ("VC" lagakar bhejna) ab guaranteed hai.

## Tests

- `dev/fastag-mapping.lookup.test.js` — naya `normalizeVcType` unit test (14 variants: plain
  number, float, leading zero, spaces, dashes, CLASS-prefixed, unknown passthrough).
- `dev/fastag-mapping.test.js` — server `vcType: normalizeVcType(...)` + client dono jagah
  normalizer ka lock. Pura fastag suite 17/17 pass.
