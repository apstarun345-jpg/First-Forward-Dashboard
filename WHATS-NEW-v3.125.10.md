# v3.125.10 — fix failed EIR sheets (COLUMN_ONLY_ONCE) + personal links
- Root cause: EIR sheet no longer has GV ID / GV NAME columns; column auto-detect gave tlName and gvId the same letter (AW) and Google rejected the query ("COLUMN_ONLY_ONCE") → Agents / Today-class sheets failed.
- gviz proxy now dedupes repeated columns (max(X) in select, once in group by).
- Missing GV columns fall back to the agent / TL columns instead of stale letters.
- Auto-detect no longer replaces db.settings or calls persist() (failed Apps Script saves rolled settings back every 10 min and broke personal-link requests with "Access changed").
- Memory guard flushes pending durable saves (max 8 s) before its restart.
- Personal links: new admin "Recover lost personal links" button (Settings → Personal links) restores links lost in the settings rollback from sheet history (dry-run first, additive only).
