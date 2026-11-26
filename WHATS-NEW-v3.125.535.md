# v3.125.535 — Barcode Checker 429 fix + instant live camera
- Barcode Checker (photo / list): Issued-check ab server se (cache + Google busy handle). Google 429 par "Data did not load" nahi — rows turant dikhte hain, baaki Issued-check peeche se apne aap dobara try hota hai.
- Live camera (Tag Request + Barcode Checker): barcode ya number par le jate hi turant scan — zbar + number (OCR) frame par, OCR worker camera khulte hi garam.
- OCR / scanner files (libs/) ab 1 saal cache — baar baar 7 MB download nahi.
