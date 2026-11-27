# v3.125.558
- 429 (edge rate-limit) se bachav: same GET ek saath ek baar, 3s cache, 429 par sab calls thodi der ruk jaati hain (retry storm nahi), background tab ki polling pause. Idle requests ~aadhi.
