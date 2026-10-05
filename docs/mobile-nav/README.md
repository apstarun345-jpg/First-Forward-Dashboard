# Bottom navigation — before / after (v3.59)

Ye screenshots PR ke visual proof hain. Dono versions asli Chromium me, login ke saath,
mock sheet data par render kiye gaye hain.

| File | Kya dikhata hai |
| --- | --- |
| `before-phone-390.jpg` | v3.58 — 390px phone. Emoji icons (`🏷️`, `🔔`) khali box/tofu aur alag-alag size ke. |
| `after-phone-390.jpg`  | v3.59 — 390px phone. Saare 5 icons ek jaise (23×23 SVG), labels ek baseline par. |
| `before-tablet-1024.jpg` | v3.58 — 1024px tablet. Bar poore screen par phaili hui. |
| `after-tablet-1024.jpg`  | v3.59 — 1024px tablet. Capped + centred bar (`min(560px, 100vw−24px)`). |
| `after-phone-320.jpg`    | v3.59 — 320px (sabse chhota phone). "Tag Issued" bhi pura, koi truncation nahi. |

Measured on the after build (320 / 360 / 390 / 430 / 820 / 1024px):
one icon size (23×23) · one icon row · one label row · zero clipped labels · zero horizontal scroll.
