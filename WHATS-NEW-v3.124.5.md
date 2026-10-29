# v3.124.5
- Home · GV Today live: failed / empty feed now auto-retries (2s · 4s · 8s · 15s · 30s, then every 60s) instead of staying on "live data is coming in…". Live numbers refresh every 60s while Home is open.
- Live feed requests time out after 30s (so a hung request retries instead of spinning).
- Server: GV today feed serves the last same-day snapshot instantly (refreshing behind it) and keeps it on a Google blip, so Home loads fast.
- Sheets that fail ("2 failed") keep auto-retrying: fast backoff, then every 90s while the tab is open; also right away when the network comes back or the tab becomes visible. Page-level loads now join this retry too.
