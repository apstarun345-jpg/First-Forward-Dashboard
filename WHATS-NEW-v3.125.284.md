# v3.125.284 — Cross Channel: Delhivery Tracking hata ke **NPCI Status**

- Tag ID / VRN / Chassis — box me bahut saare paste karo ya CSV upload; server ApnaPayment verifyNpciStatus API se check karta hai (40-40 ke batch, progress bar, Ruko button).
- Result columns: BANKID, REGNUMBER, custId, cch, commVeh, activationDt, closeDt, ENTITYID, tagDetails_cardStage, tagDetails_npci_ExcCode, npci_ExcCode (+ Input, Input type, TAGID, VRN update).
- Summary: input type count; Tag ID / Chassis input par REGNUMBER 1-10 akshar = VRN **Updated**, warna **Not updated**; NPCI status (Active / Low Balance / Closed …) — har card / chip clickable filter.
- VRN par NPCI kai purane tags bhi bhejta hai — default me Active (primary) row; "saare tags" checkbox se sab.
- Download: CSV, Excel (Summary + Results), PDF.
