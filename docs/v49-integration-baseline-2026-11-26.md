# V4.9 integration — Gate 0 baseline (2026-11-26)

Status: **PASS — targeted baseline only; no application code changed.**

## Immutable inputs

- Production application source: React/Express/Mongoose. Integration base `3b4f13a8125d439c278afff025840e0de0632d43` (feat/buyer-onboarding; Draft PR #2 is open against master). Master at discovery: `f687f59c48fbfd1bf3623abc28f256a65cec27a8`. The launch-blocker branch is already an ancestor of master.
- Owner-approved reference: Jomla_V4_9.html, SHA-256 `927901518b55674939608ca9b08802eff0a1f169da3012ba716d1c33f21cf903`, 918755 bytes. The HTML is byte-identical to index.html in the corresponding ZIP. Reference inspected; not copied into application or this public repository. Confirm the same hash before implementation.
- Local Windows checkout was on the exact integration base with clean Git status before and after checks. Node 25.9.0/npm 11.12.1. No dependency installation/upgrade.

## Fresh verification

| Check | Result |
| --- | --- |
| Frontend targeted Jest | 68/68, 7/7 suites, exit 0 |
| Backend targeted Jest | 30/30, 4/4 suites, exit 0 |
| Frontend CI=true optimized production build | Compiled successfully, index.html exists, exit 0 |
| Git checkout after tests | Same SHA; clean tracked/untracked status |

Frontend suites: LocalAcceptance, LocalReviewJourneys, ProductDetailAfter, RegisterPage, SupplierDashboard, ProductEditor, MarketLayout. Backend suites: products, visualIndex, buyerOnboarding, pilot_journey. All ran sequentially on the existing Windows checkout. Backend used disposable MongoDB 5.0.19 (memory-server), disposable uploads/log directories, original DB URI disabled and external discovery disabled. Build output was a new temporary directory, not the existing preview. Raw evidence and credentials are not committed. Backend emitted existing Mongoose deprecation/Node experimental warnings; expected negative HTTP tests logged errors, but all selected tests passed.

These are 98 fresh targeted tests, not full regression or visual equivalence. No physical-phone retest or production deployment in this gate. Direct Git access from the assistant sandbox failed DNS; GitHub connector read access and the local Windows test runner provided the verified baseline.

## Integration map and acceptance gates

1. **Buyer shell/catalog**: MarketLayout, App.js, ProductCard, HomeIntroduction, atlas CSS and navigation. Transfer visual reference (compact equal-height cards, image overlay labels, clipped title/seller, tier pricing/MOQ, favorite affordance); preserve live catalog API, protected media, quote/cart, availability/role guards, verified supplier state and rating source. If a capability is absent, implement and test its actual contract separately; no dummy ratings or buttons. Capture RTL/LTR desktop/mobile views, keyboard/focus, responsive layout, guest and authenticated routes; confirm baseline journeys.
2. **Product details**: ProductPage, ProductGallery, RelatedProducts, ProductPreview, RFQModal and AddToQuoteCart. Match Overview/Details/Recommended, media gallery, price tiers, commercial actions and navigation continuity without inventing video, reviews or pricing. Verify back/scroll, direct RFQ, cart, unavailable/quote-only products, real DTOs.
3. **Authentication and account navigation**: preserve onboarding branch contact gate, role selection, returnTo, recovery and session isolation; provider buttons only if a real provider is configured and tested. Do not merge or alter Draft PR #2.
4. **Supplier digital office**: SupplierWorkspace, SupplierDashboard, ProductEditor, ProductWizard and associated CSS. Simple/pro presentation, daily tasks and direct navigation, photo-first guided publish, actual draft persistence, honest pending/verified state. Preserve ownership/authorization, explicit image rights and approval, server publication gates, RFQ recovery, messages and notifications. No fake analytics.
5. **Quiet smart search**: current App.js -> /api/ai-search, /api/image-search, /api/products/search; backend/utils/catalog.js and services/visualIndex.js already enforce public-catalog scope and local visual indexing. Add structured parsing and filters in tested small backend/frontend changes; multilingual conditions, strict ranges, AND/OR ambiguity, currency/quantity/MOQ and price tiers, budget and unknown delivery, removable filters, honest alternatives; enforce filters server-side before pagination. Preserve authorization, rate/size caps and no remote URL fetches. Exact image bytes do not establish identity. No external AI dependency/provider or semantic accuracy claim without approval, evaluation and real evidence.
6. **Integrated acceptance**: targeted checks after each small batch, then full regression as feasible, isolated API/browser test and visual comparison with the reference, no production deploy. Record failure and stop at that gate; no silent skip. Preserve unrelated work; no dependency changes, original DB, DNS, VPS, secrets, force-push or merge. Physical-device and final hosting gates remain separate.

Implementation not started at this checkpoint. Keep the integration branch isolated and the PR draft; after each completed batch update HANDOFF, review diff, verify tests and remote SHA. Existing open onboarding PR remains untouched. Begin with a limited buyer shell/card visual slice after reading the actual reference and existing component contracts, not by copying the monolithic demo.
