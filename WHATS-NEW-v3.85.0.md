# v3.85.0 — Barcode Checker: copy + instant search

- Column order: Barcode, Tag ID, Status.
- Copy buttons: Barcode + Tag ID + Status (tab-separated, pastes straight into Sheets/Excel), Barcodes only, Tag IDs only — all filtered rows, not just the 1500 shown.
- Row copy button + click a Barcode / Tag ID cell to copy it.
- Instant search: pre-built haystack, only table body repaints (5000 rows ~30 ms); multi-word AND search; barcode matches with or without dashes.
