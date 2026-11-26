# V4.9 Gate 1C-1 — Favorites backend (2026-11-26)

PASS for backend slice only. Gate 1C and Gate 1 remain open.

Introduces one MongoDB document per buyer, keyed by the authenticated buyer ID, containing only product IDs. GET /api/favorites reads the private list; PUT and DELETE /api/favorites/:id set the desired membership idempotently. All methods require a current buyer session and reject extra query/body fields. Cache-Control is private, no-store. PUT checks the same public product visibility and store/supplier ownership boundary as product detail; DELETE works even after withdrawal. GET returns IDs only, never historical product metadata. The UI must revalidate each saved product via the public API and show an unavailable state without leaked metadata.

The temporary design limit is 100 saved items per buyer, enforced atomically even under simultaneous requests. The owner did not specify this limit; it is an implementation guard subject to review. No guest favorites or automatic guest migration are introduced. Product visibility can change after any successful save; saved IDs are not evidence of continued availability.

## Verification
- First run: 25/26, 3/4 suites; the revoked-session test generated a new token without explicitly selecting the hidden tokenVersion. Corrected test fixture to select +tokenVersion, leaving all authorization assertions intact.
- Final run: 26/26, 4/4 suites, exit 0. favorites (9), products, buyerOnboarding, pilot_journey. Used actual Express requests and disposable MongoMemoryServer 5.0.19, test-only credentials and temporary logs/uploads, original DB disabled and external discovery disabled.
- Favorites coverage: authentication/role restrictions, no-store, persistence/idempotence, buyer A/B isolation and owner injection, invalid/missing IDs, draft/hidden/unavailable/foreign-store rejection, closed store and disabled supplier, removal after withdrawal, concurrent first saves, atomic capacity and revoked session. Existing application warnings/expected negative HTTP responses remain.
- No frontend changes or browser/build retest in this backend-only slice. No dependency updates, production deployment, or original DB access.

Next: Gate 1C-2 wire the actual heart and favorites page to this API, isolate frontend state per session, handle late responses and uncertain writes, revalidate public product data and test browser/role/account switching. Do not close Gate 1 or begin Gate 2 prematurely.
