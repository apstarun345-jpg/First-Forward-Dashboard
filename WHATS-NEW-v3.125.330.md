# v3.125.330
- Personal /p/ links: finished report page is pre-built in the background (every channel view, every 10 min + after boot) and served instantly (up to 6 h old, refreshed behind it) — no more "Loading your report…" wait.
- Welcome journey card: result cached (30 min fresh, 12 h stale fallback); on failure it retries once silently and hides instead of showing "EIR history could not be loaded".
- Agent mobile numbers in personal pages: trusted mobile directory first (agent ID match; name only if unique), values cleaned to a valid 10-digit mobile, partial source failures are retried in ~1 min (not cached 15 min).
- GV live (today) default refresh 30 min (Settings → GV can change it).
- Keep-alive workflow pings the site every 10 min so the free Render instance does not sleep.
