# v3.125.517
- Diagnostic fix: Home GV polling now applies fresh responses after GV Master loads, can recover without an initial feed, prevents overlapping polls, and repaints live details after API synchronization. Older initial/stale feeds cannot replace a healthy Master snapshot.
- Bound GV today-detail requests to 15 seconds so a hung request cannot permanently block the refresh loop; recognize day rollover as a changed snapshot.
- Combined FF/GV report renders each ready channel independently, with a partial-total notice until the other channel is ready.
- Issuance-only reports no longer inherit a pending full-report stock-prefetch promise (which could add up to 25 seconds of unrelated stock waiting).
- Updated eager asset versions and service-worker release cache; diagnostic scope, results and baseline test debt are recorded in DIAGNOSTIC-REPORT-2026-11-25.md.
