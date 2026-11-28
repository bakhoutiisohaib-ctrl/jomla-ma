# V4.9 Gate 1D-3A — Declared supplier activities (2026-11-26)

**PASS for backend foundation only. Gate 1D-3 and Gate 1 remain open.** Base 0316bec12aa85f5629de1ce6bb5fefc99ba899d2.

## Contract
- Optional Supplier.businessTypes array, canonical enum manufacturer/importer/distributor/wholesaler, unique values, multiple activities allowed, default [] (unknown/unclassified). No migration or inferred activity for existing accounts.
- Optional declaration at supplier registration; authenticated supplier owner can replace or clear own array using PUT /api/suppliers/me/business-types with exactly {businessTypes:[...]}. Buyer, staff, admin and unauthenticated accounts cannot use this endpoint. Account profile returns declaration. The update uses the existing auditedChange mechanism with SUPPLIER_BUSINESS_TYPES_UPDATED. No change to verification or access rights.
- Public product catalog GET /api/products/search (and list), POST /api/ai-search, POST /api/image-search and GET /api/stores accept optional single businessType enum filter. Filter is applied to internal catalog candidates before ranking/pagination. Public store and product-detail supplier projections include declared types. Invalid literal, repeated or bracket/dotted filter forms are rejected. Absent/empty filter preserves legacy browsing. Public supplier directory itself is unchanged.
- Declared activities are not certified manufacturer status; UI must label as self-declared, independently of verification. External discovery results are not classified by this internal filter; do not represent them as type matches. No frontend, category taxonomy, deployment or dependency changes.

## Evidence
- First run exposed syntax error in account payload (corrected). Next run 67/72; new audit action was missing from the AuditLog enum, and Express simple query parsing could leave bracket syntax as a literal key. Fixed both without removing assertions.
- Focused HTTP/Mongo integration tests **7/7**, then final targeted backend **72/72 (6 suites)**, exit 0, using isolated MongoMemoryServer and synthetic media. Suites: businessTypes, products, mediaPrivacy, favorites, buyerOnboarding, pilot_journey. All changed JS passed node --check, git diff --check. Tested multi-activity declaration, audit, unchanged verification, permission and injection rejection, legacy behavior, clearing declaration, text/image/store filtering, invalid input, registration and public DTO boundaries. Existing Mongoose/Node warnings and expected rejection logs remain.
- No frontend build/browser acceptance claimed for this backend-only slice. Existing general catalog store/supplier visibility logic was not redesigned; no comprehensive corrupted historical-data or load audit. No changes to original checkout/database, no merge or deployment.

Next: Gate 1D-3B connect optional multi-select to supplier registration/account and single activity filter to actual catalog and store search, including empty/error/reset paths, localized labels and no fake inventory. Separately assess category taxonomy/facets, then integrated Gate 1 acceptance before Gate 2.
