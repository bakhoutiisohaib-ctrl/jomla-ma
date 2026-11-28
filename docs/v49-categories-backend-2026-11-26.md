# V4.9 Gate 1D-4A — Public category directory (2026-11-26)

**PASS for backend foundation only. Gate 1D-4 and Gate 1 remain open.** Base b35a9bdecc3e392ae64f8a19440bdbc2bc7fe481.

## Contract
- GET /api/products/categories: public no-store directory of category labels and counts across eligible products, independent of product pagination and search phrase. Accepts only optional businessType, page and limit. Pagination counts distinct categories, sorted by product count descending then category ascending. Existing parseOptions caps limit at 100. Count means eligible catalog products, not current text/image search hits. Empty directory is valid.
- No migration, hardcoded inventory, taxonomy or synonym merging. Existing category strings remain separate and case-sensitive in grouping. Directory excludes malformed, blank, padded and overlength labels; it does not repair historical product records. Counts are point-in-time, not a transactionally frozen inventory snapshot.
- Existing contains category filter remains default; optional categoryMode=exact permits selection of a literal category in normal and text/image search. This is MongoDB equality on the existing string schema; malformed historical array fields are excluded from the directory, but this slice does not claim a complete malformed-product audit.
- Shared publicCatalogFilter now requires the supplier/store pair to match, not merely independently valid supplier and store IDs. Keeps existing visibility predicates. No permissions broadened.
- Directory aggregation has a 10s maxTimeMS; the existing architecture still materializes eligible supplier/store IDs and pairs, which needs scalability review and load tests before production-scale claims. No cache or production migration.

## Verification
- First focused run 22/23. The failing test shadowed the supplier fixture with a product-creation response, so deactivation targeted an undefined ID. Renamed the variable and added a matchedCount assertion; no production change or weakened acceptance to fix that failure.
- Final targeted backend run: **81/81, 7/7 suites**, exit 0, 198.01s Jest, 210.41s process. Suites products, businessTypes, mediaPrivacy, favorites, buyerOnboarding, pilot_journey, mediaCancellation. Products and businessTypes combined 23/23, including four added cases. Disposable MongoDB and isolated synthetic uploads/logs. Tests cover category beyond first product page, category pagination/count, exact vs contains, invalid input, activity scope, draft/hidden/unavailable exclusion, mismatched ownership, disabled accounts/stores, and exact image search. Existing Node/Mongoose warnings and expected rejection logs remain.
- node --check and git diff --check passed. No frontend build or browser acceptance in this backend-only slice. No comprehensive load test or live-data audit. No original DB/check-out changes, deployment, merge or dependency updates.

Next: Gate 1D-4B connect the real category directory to the existing rail, with independent pagination, loading/error/retry, activity changes, exact selection vs free-text search, stale-response protection and no synthetic categories. Preserve product cards. Then integrated Gate 1 acceptance before Gate 2.
