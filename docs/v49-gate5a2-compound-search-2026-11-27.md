# Gate 5A.2 — bounded compound search and exclusions (2026-11-27)

**Scoped backend PASS; Gate 5 OPEN.** Baseline 15d777ccc62642f8a9424f4c5ca8d0b2ebb4f600. The existing Codex catalog engine and opt-in v49-1 API contract are retained. No frontend changes.

## Scope
- Explicit OR between up to three recognized product/sector subjects, with branch-local city, lexical, price, MOQ, budget, unit and verification constraints. A city-only alternative after a named city can extend that city scope when no ambiguous additional conditions exist. All branches intersect the existing public visibility, ownership, taxonomy and explicit catalog filters. One database aggregation and pagination; overlapping branches do not duplicate products.
- Known product-family and city exclusions with bounded lexical scope. These are text-based exclusions, not proof of material composition. Unknown/ambiguous negation is rejected rather than partially interpreted.
- Canonical verified/unverified status, based on the actual administrative decision; verification is not a commercial guarantee. Explicit verified-only filter cannot silently override a contradictory unverified intent.
- Extend reference product vocabulary (blankets, baskets, doors/windows, gifts, charging cables/chargers), recognize four broad reference sector aliases via the existing taxonomy contract, handle grouped numeric amounts and return a confirmed base/MOQ/quantity pricing context for subsequent UI integration.
- Same quantity and sort context required across OR branches in this slice; incompatible quantities/sort, ambiguous scope, mixed AND/OR syntax, unknown branch subjects and unsupported delivery are fail-closed. No automatic branch inheritance of ambiguous commercial constraints, no external discovery, no AI/provider claim. Price predicates apply per branch before pagination. Budget uses decimal goods-only multiplication with conversion guards.

## Verification chronology
- Added five real HTTP/Mongo regression tests and replaced the old intentionally unsupported plain OR case with an ambiguous scope case, since plain OR is now implemented.
- First products run 28/29: combined exclusion parser left a trailing conjunction after removing a city; fixed the parser, not the assertion.
- Second isolated run 83/83 (5 suites), 21.942s.
- Review added taxonomy intersection, grouped numbers, explicit pricing context and guarded decimal conversion; two additional regression cases (seven new tests overall).
- Final exact-source syntax checks for all four changed JS files and git diff --check PASS. Isolated backend **85/85, 5/5 suites, 21.644s, exit 0** (products, externalDiscovery, visualIndex, publicPages, businessTypes). Tests exercise independent branch prices/cities, pagination/deduplication, exclusions/conflicts, canonical verification, taxonomy intersection and goods budget context. Existing nonstructured search and visual/external tests retained.
- No frontend or browser run; feature remains opt-in at API level. No full backend inventory, semantic accuracy or production load claim.

## Remaining
V4.9 parity is not complete: branch-specific differing quantities, unknown negation, arbitrary language/model identifiers, vocabulary coverage, multilingual canonical chip labels, explicit removal of one constraint and alternatives/counts, plus visual reference integration and actual browser acceptance remain open. Do not activate incomplete behavior as though it were complete. No change to original data, dependencies, default branch, VPS/DNS, production deployment or V4.9 reference. Next finish required contract edges and integrate the original V4.9 search presentation.
