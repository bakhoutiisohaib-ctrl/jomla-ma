# Gate 5C.3A — comparable commercial offers contract — 2026-11-28

**Scoped backend checkpoint PASS; Gate 5 OPEN.** Baseline b4ef0460b19a2dc79337fb683f26706e863c7081. Original V4.9 SHA256 927901518b55674939608ca9b08802eff0a1f169da3012ba716d1c33f21cf903 verified. Inspected original j48Family, j48Comparable, j47CompareBody and findSimilarByProduct36. Existing public catalog and price tier behavior retained.

## Implementation
- Public GET /api/products/:id/comparable, Cache-Control no-store, accepts quantity/page/limit only. Fresh anchor and candidates use existing publicCatalogFilter (active supplier, approved active owned store, publication/availability/rights/moderation). Not limited to the current search results or selected supplier.
- Same exact category, taxonomy path (including legacy empty), sale unit and currency. Reuses existing bounded title-family vocabulary; material-only ceramic is excluded as a family; exact same recognized family set is required rather than any overlapping term. Unknown family yields anchor only, not invented alternatives. This is more conservative than the demo's category/unit/any-family rule, and does not establish model/material/specification identity.
- Reuse the visual engine's existing quantity-tier price selector via shared productPricing utility. Explicit requested quantity or anchor MOQ, never silently increase quantity for another supplier. Check price/tier validity, disjoint ranges, MOQ and safe total. States fixed estimate, below MOQ, on-request, unknown, or unavailable overflow total. Eligible safe goods estimates first, then other states; deterministic ID tie break. Sort before pagination, all rows use same quantity/unit/currency; shipping excluded. No negotiation price guarantee or currency conversion.
- Bound candidate scope at 5000 rows with explicit 503 if exceeded, maximum 50 offers per page, 5s database query limits. Separate live reads, not transactional snapshot or load certification.

## Verification
- Three initial real HTTP/Mongo regression tests plus existing tests: 98/98 across five suites (32.192s), exit 0.
- Added cross-supplier/ownership/draft/suspended-store regression and reviewed import placement. Final exact-source isolated backend 99/99, 5/5 suites (products, visualIndex, productAI, publicPages, businessTypes), 27.216s, exit 0. Syntax and git diff --check PASS.
- Confirmed quantity-tier ranking changes from 20 to 50, total calculations, same currency/category/taxonomy/unit, exclusion of unrelated family and nonpublic products, requests below MOQ, on-request pricing, malformed legacy tiers, unsafe totals, invalid inputs and pagination. Existing visual and catalog tests passed without assertion changes.
- No frontend activation, build or browser run for this backend checkpoint; existing manual comparison remains until next slice.

## Remaining
5C.3B wire original comparison modal to this API from real product details and quick preview, validate response identity and quantity, handle errors/refresh and pagination, and retire the stale manual comparison presentation without weakening its existing user journeys. Then integrated Gate 5 acceptance. Product family coverage remains bounded and lexical, unknown types may have no alternatives; exact units/currencies not normalized or converted; decimal amounts are estimates using existing numeric storage, not accounting settlement. Production load, physical camera, full backend inventory and complete visual parity remain open. No original database, reference file, dependencies, default branch, VPS/DNS or deployment changes.
