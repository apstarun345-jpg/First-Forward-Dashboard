# v3.125.414 — 502 fix
- Server restart (memory guard) ke 30-90 s me read calls ab ~2 min tak chup-chaap retry (dispatch-status, barcode lookup, etc. bhi).
- Memory: gc jaldi (heap 200 MB), raat ke heavy jobs (office-dispatched, profile pack) memory ooncha ho to ruk jaate hain.
