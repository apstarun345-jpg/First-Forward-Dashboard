# v3.125.230 — 💰 Payout box + professional payslip PDF

- Master Search (FF agent / TL): new **IDFC payout · last 6 months** box — payable tags, final payout, released amount, FNF remark (Processed / Processing / Hold) + UTR.
- **Payslip download** — month checkboxes (single / multiple / last 3 / all), one combined PDF (with summary page) or separate PDF per month.
- Payslip: "APNAPAYMENT SERVICES PRIVATE LIMITED" header, payee details, issuance & payable tags by class, earnings & deductions, net payable (in words), FNF payment details, agent-wise table for TLs.
- PAN & bank account masked on the server. New permission: "See payout & download payslips".
- Data: APN payout sheet + FNF sheet (`GET /api/payout`). Apps Script `readtab` (v3.76) for fast lock-free reads; older script falls back to chunked readrange.
