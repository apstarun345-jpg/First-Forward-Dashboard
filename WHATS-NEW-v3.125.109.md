# v3.125.109 — stock rebuild memory + 429 fix

- 6 Nov subah: StockDataa badla → purana stock index + naya scan saath memory me → 470 MB → memory guard restart → boot par phir rebuild (loop). Beech me index na hone se dispatch Issued/Stock list Google se seedha maangi gayi → **HTTP 429**.
- Ab: memory zyada ho to rebuild se pehle purana index chhoda jaata hai; scan fail ho to /tmp snapshot wapas. Rebuild "due" logic se (snapshot pehle se naya ho to dobara scan nahi), fail ke baad 30 s retry gap.
- Stock data ban raha ho tab dispatch barcode list Google se nahi maangi jaati — "ban raha hai" aur kuch second baad khud dobara.
