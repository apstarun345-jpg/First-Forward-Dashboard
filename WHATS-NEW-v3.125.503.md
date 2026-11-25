# v3.125.503 — live naap se mile slow clicks theek

Live browser me har page ka switch-time naapa. Jo pages 0.4-0.6 s screen rokte the:
- GV Dashboard / Targets / Home: GV summary + agent/TL rollup har baar dobara banta tha (~150 ms × kai baar) → ab inputs na badle to reuse.
- Targets: GV watch-rows overlay (~0.5 s) → reuse.
- Home: Robot updates panel page ke saath hi bhaari render karta tha → page pehle paint, panel baad me.
- FF/GV Agent Summary: TL quick() ek saath ~0.3 s → chhote tukdon me.
- Har page: render shuru hone se pehle ek paint (sidebar highlight + skeleton turant).
