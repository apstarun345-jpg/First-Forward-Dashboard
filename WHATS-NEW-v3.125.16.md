# v3.125.16
- Server restart kam: barcode register (3.5 lakh rows) ab har page load par auto load nahi hota — barcode search live lookup se.
- Agent kundli ke boxes (Stock ageing, Last dispatch, KYC, Commission): server restart / Google 429 par "HTTP 502" ki jagah khud dobara load.
- API read calls 502/503/504 par auto-retry (2s→30s).
