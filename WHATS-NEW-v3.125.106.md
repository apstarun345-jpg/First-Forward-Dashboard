# v3.125.106 — StockDataa ki ek hi copy

- FASTag Mapping ab apni alag StockDataa copy (poori rows + barcode / tag Maps, ~60-80 MB) nahi banata. Stock ageing / Master Search / dispatch wala hi index use hota hai — wahi snapshot, wahi "sheet badle tabhi naya".
- Stock index ki FF rows me mapping ke columns bhi (row ID, inventory, tag type, BC / agent allocation date) — mapping report pehle jaisi.
- Barcode / tag lookup compact index se, range lookup serial index (binary search) se.
- Snapshot format v2 (naye columns) — pehli baar ek full scan, phir snapshot.
