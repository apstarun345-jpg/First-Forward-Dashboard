# v3.125.97

- **GV & FF Tag Issued → Report (custom range, 2+ months):** new first sheet "Month-wise summary" (month × channel: VC4 / VC20 / VC5+ / Total), and every TL / agent row gets month-wise columns (e.g. "Sep 26 VC4 … Nov 26 Total"). CSV has the same month columns.
- **Master Search → Growth:** "vs September" now uses the expected month-end shown in the Expected box (was blank).
- **Master Search → Last dispatch:** right after a deploy / restart (aggregate not ready yet) the server now reads only this agent's rows from the dispatch sheets — box fills in seconds instead of "searching…". Aggregate load start / finish is logged.
