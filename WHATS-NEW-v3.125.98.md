# v3.125.98

- **Tag Issued Report — professional Excel:**
  - Coloured headers: Total / month Total = amber, month columns = teal, performance = blue, prev = dark.
  - Coloured cells: Total & Avg columns amber, month Total green, month class columns alternate blue / pink tint, TOTAL rows grey, GRAND TOTAL dark, Performance green (up) / red (down). Thousands separators, borders.
  - Custom range of 2+ months: Prev columns (were 0 — that period's data isn't loaded) replaced by **Avg / month** and **latest full month vs the month before %** (e.g. Oct 26 vs Sep 26). "Month-wise summary" sheet now has VC4 %, commercial, change & growth vs previous month, days and per-day rate.
  - Single-period report: if the previous period's data isn't loaded, Prev / Performance show "n/a · prev data not loaded" instead of 0 / ★ New.
- **Last dispatch:** direct fallback query no longer fails on number-type columns ("upper takes a text parameter").
