# v3.125.9 — sheets load stability
- Server was restarting every ~40 min (free 512 MB) and its gviz cache was halved every 2 min, so most loads went to Google and some sheets failed.
- Soft trim now runs gc first and keeps the cache unless RSS stays high; memory log shows heap / external / buffers / cache.
- Start script: MALLOC_ARENA_MAX=2 and smaller young generation (lower RSS).
- Boot warm-ups (stock ageing, FASTag mapping, personal links, commission) start after the first user loads; personal-link warm runs every 10 min (was 5).
