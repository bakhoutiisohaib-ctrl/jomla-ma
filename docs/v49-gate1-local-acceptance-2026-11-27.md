# V4.9 Gate 1 — local technical acceptance and scope boundary (2026-11-27)

**PASS — local buyer shell/catalog scope under the original Gate 0 acceptance contract.** Not a claim of complete V4.9 functionality, pixel identity, owner visual sign-off, final production readiness, or completed trust metrics. Runtime baseline b268385d1d3f4d7236e7c2a357caeffcba95fb32. Reference hash reconfirmed. The engineering scope decision below is explicit and remains reviewable by the owner; it is not represented as the owner's separate approval.

## Acceptance matrix

| Original Gate 1 requirement | Evidence / outcome |
| --- | --- |
| Live compact product cards, image badges, clipped title/seller, quantity prices and MOQ | PASS: card, price, density and edge-market reports. Two columns phone, five desktop. Actual seller feedback and administrative verification; no transaction-confirmation claim. |
| Favorite affordance and account isolation | PASS: favorites backend/UI, integrated browser and DB checks. |
| Market shell, mobile navigation, protected media and actual commercial actions | PASS: shell, home, reliability and integrated reports. |
| Six declared supplier types, independent product taxonomy | PASS: six-types, taxonomy-backend, taxonomy-ui and sector-browser reports; 10 sectors and 36 leaves, explicit legacy/unclassified handling. |
| Store directory and real optional verification | PASS: store-directory and supplier-trust reports; verified filter includes both verification flags and eligibility, before paging; normal browsing includes eligible unverified sellers. |
| RTL/LTR and responsive geometry, keyboard/focus, guest/authenticated commercial journeys | PASS in tested Chrome desktop/mobile viewports and isolated account journeys. Long-content test six viewports / 36 cards, no geometry violations; ordinary card hit-target checks >=44px. Physical devices are a separate acceptance gate as specified in Gate 0. |
| Complete regression as feasible | PASS: final FE 372/372, 41 suites, exit 0 and build PASS on final runtime. Backend 720/720 distinct tests, 42 suites, zero skipped across initial run and corrected 128-test recheck, not a single clean run. Backend unchanged since that checkpoint. |
| Fresh integrated journey after last card correction | PASS: 10 Chrome records, exit 0, no uncaught JS; real image/text/taxonomy/activity/verification/quantity search, effective 18 MAD for 50, preview Escape restores focus, guest cart migration once, A/B favorites/cart isolation, RFQ and cart consumption. Direct disposable MongoDB confirms one correct RFQ, thread, first message and supplier notification and separate favorites. [Final browser inventory](evidence/v49-gate1-final-20261127/visual-results.json). |
| Bounded local read workload | PASS in limited scope: 144/144 HTTP requests, 305 distinct products and 16 stores over static pages. Not production throughput or a snapshot guarantee under concurrent edits. |

## Explicit scope decision (not full product acceptance)

The Gate 0 contract requires real implementations instead of dummy features, and separate contracts for absent capabilities. V4.9 itself marks trust metrics demo-only and says ratings/response time require real deal data. Gate 1 therefore accepts the implemented catalog and genuine administrative verification, not the three unavailable metrics. Do not enable unsupported controls or call these features done. Existing review aggregate is real account feedback, not evidence of a completed sale; existing legacy reviews must not be reclassified as verified purchases. A supplier-controlled order delivery status or RFQ acceptance is not independent transaction completion.

Carry the following obligations forward, not delete them:
- Gate 3 / Gate 4 cross-cutting trust work: define confirmed buyer/supplier commercial transaction evidence, eligibility and uniqueness for reviews, legacy review policy, anti-abuse and supplier reply. Establish trustworthy supplier-country field/verification, not product origin or city inference. No silent migration or new assertion of trust.
- Gate 4 / Gate 5: establish auditable response-event timing, defined measurement window, exclusions and minimum sample size. Only enable top-rated, response-speed and country filters once their real contracts, API eligibility, UI semantics, empty cases and privacy tests pass.
- Gate 5: assess voice search only with real supported input and permission/error handling, not a demo action. Mobile app affordances not treated as an available native application.
- Gate 6 and separate release/physical acceptance: resolve historical records, ranking changes during pagination, sustained concurrent and write workload, host capacity, physical Android/iOS and owner visual review. No release authorization from this report.

## Visual adaptations and limits

Earlier reference comparison found longer cards; density correction reduced ordinary AR390 height from 351.8 to about 299px and desktop from 471.1 to about 360px. Final long-content correction protects legal extreme values; mixed rows may differ in height, while cards within the tested rows align. Retained 44px interactive areas, direct RFQ/cart and explicit price/supplier metadata rather than matching prototype pixels. Sector popup uses an accessible centered dialog, and trust scope is discoverable across sectors. Supplier types are distinct per approved taxonomy. These are engineering adaptations; owner may request further visual tuning without falsely marking a function absent. See [density](v49-card-density-2026-11-27.md), [edge market](v49-edge-market-2026-11-27.md), [full backend](v49-full-backend-2026-11-27.md), [integrated reference comparison](v49-gate1-integrated-2026-11-27.md), and [trust scope](v49-supplier-trust-2026-11-27.md).

## Next authorized work sequence

Gate 1 local technical scope closed at this checkpoint; no unresolved failed test in that scope. Gate 2 may begin from the saved integration branch as a separate slice. First inspect actual ProductPage, ProductGallery, RelatedProducts, ProductPreview, RFQModal and reference; establish evidence-based Overview/Details/Recommended contract, media availability, tier pricing, return/back/scroll and commercial bar. Preserve all Gate 1 behaviors and repeat execute/test/review/correct/retest/commit/push. No Gate 2 implementation in this checkpoint. Original checkout, database, VPS/DNS, deployment, merge and existing onboarding PR remain untouched. Reference HTML and raw lab assets remain outside public Git.
