# v3.125.494

- All agents/TLs last-dispatch barcode lists are now prepared in advance. The job runs at boot, whenever the stock index changes, and every day after 8:00 IST.
- Cached lists are stored gzipped (up to 3000), so the free-plan memory stays small.
