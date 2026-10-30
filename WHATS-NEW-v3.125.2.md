# v3.125.2
- Fix: Master Search "Last dispatch" and "Stock ageing" showed HTTP 502. The dispatch chip loaded every ledger row into memory and the free-plan memory guard restarted the server. It now reads the sheets once into a small per-agent × date total (class-wise counts and sample barcode ranges), so the server stays under the limit.
