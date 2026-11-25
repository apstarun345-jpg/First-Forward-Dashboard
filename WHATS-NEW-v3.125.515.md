# v3.125.515
- Master Search selected-name clicks no longer wait for unrelated search-index sheets. Merged selections also cancel safely when a newer selection wins.
- Remove the intentional 12-second profile wait: show already-loaded data with an explicit partial notice and upgrade when channel datasets finish. Share in-flight channel loads and profile builds across KPI, inline report and linked-team consumers; completed jobs are not retained as a stale profile cache.
- Clean up previous Master Search click/index handlers on re-render, avoiding duplicate opens and background work.
- Guard late KPI/profile responses before updating the active export context; capture the selected identity before report-download awaits so switching names cannot change an in-flight export.
- Growth uses issuance-only report data instead of waiting for stock ageing. Issuance-only Excel downloads load only their required module; existing report prefetch runs on the completed profile upgrade as well.
- Cold/unloaded Google Sheet data and large exports still depend on network and processing time; no fabricated counts or full first-load instant guarantee.
