# v3.124.11
- Personal / team links no longer get stuck on "Loading your report…": the cold-open build keeps running after the loading screen is shown, and the page's polls pick up that same result (one build per link view, no duplicate slow builds).
- The loading screen shows elapsed seconds and keeps retrying on its own (no dead end); a temporary sheet error returns a retryable answer instead of an error page.
