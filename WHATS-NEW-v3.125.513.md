# v3.125.513
- Fix misleading GV Today live numbers during count-up: live cards now show their exact snapshot immediately, keeping totals, class counts, shares and split chips consistent.
- Scope other KPI count-up history by route, drill-down date/filter and title instead of title alone, preventing monthly/FF values from leaking into daily/GV animations.
- Add regression tests for monthly-to-daily count leakage, exact live rendering and normal same-metric updates; refresh Home/motion asset versions.
