# V4.9 Gate 1 — card density refinement (2026-11-27)

**PASS for this refinement slice; Gate 1 remains OPEN pending final scope decisions and acceptance.** Base d6391c6ca4cb0d329a43e9a03fe606e810518127.

## Implementation and review
Four frontend files changed: catalog and favorites use explicit dense grid (5 desktop columns at >=1200px, 4/3 intermediate, 2 phones). Shared ProductCard retains square media, full name accessible through link/title, honest price/quantity context, seller verification and rating, supplier link, city, unavailable state and existing commercial handlers. Supplier and city share one line with ellipsis, MOQ shares the action row; quote and cart stay directly available with 44px targets. Favorite and preview visual discs are reduced while their target remains 44px. Store directory grid and backend unchanged. No new dependencies. These are deliberate adaptations, not pixel matching.

## Tests and comparison
- Targeted FE: 40/40, 5/5 suites, 33.504s. Initial production build exit 0.
- First isolated Chrome/React/Express/MongoDB run: 10 records, exit 0; direct DB checks pass. Reviewed actual captures at AR320/390/1280, FR390 and EN1280. No horizontal overflow, square images, title ellipsis, MOQ/quote overflow checks. Arabic MOQ can wrap on 320px but remains visible. Kept quote button directly on card. No runtime changes were necessary following screenshot review.
- Full FE recheck: 372/372, 41/41 suites, 126.959s, exit 0. Final optimized production build compiled successfully, exit 0.
- Strengthened external browser harness with per-control hit testing in all five geometries and real CDP pointer presses for preview and cart. Fresh Chrome profile final rerun 10 records, 22.39s, exit 0. Four controls (favorite, preview, quote, cart) each passed >=44px and center hit check in all five geometries. Combined image/text/activity/taxonomy/verification/quantity search, price 18 MAD for 50, preview Escape focus return, guest cart migration once, A/B favorites/cart isolation, RFQ submission and cart consumption all passed. Direct MongoDB checks confirm exactly one correct RFQ, thread, initial message and notification; A favorite present, B absent. No uncaught JS errors. Existing backend 230/230 from previous integrated checkpoint; not freshly rerun because backend unchanged.

| Viewport | Prior live height px | New live height px | Reference px |
| --- | ---: | ---: | ---: |
| AR 320 | 314.1 | 261.14 | 236.7 |
| AR 390 | 351.8 | 298.64 | 271.7 |
| 1280 (previous live EN; new AR/EN) | 471.1 | 359.53 | 328.9 |

Reference/previous heights from integrated audit, same synthetic live fixture design in new runs. Desktop 5 instead of 4 columns, mobile 2 retained. New cards ~15% shorter at 390 and ~24% shorter at 1280. New cards remain ~24–31px taller than reference; direct commercial controls, 44px targets and explicit price/supplier metadata are intentionally retained. Reference images/fonts/languages differed; these are illustrative geometry measurements, not pixel equality. Two synthetic cards measured, not exhaustive long content or physical-phone testing.

Evidence: [AR320](evidence/v49-card-density-20261127/live-cards-ar-320.png), [AR390](evidence/v49-card-density-20261127/live-cards-ar-390.png), [FR390](evidence/v49-card-density-20261127/live-cards-fr-390.png), [AR1280](evidence/v49-card-density-20261127/live-cards-ar-1280.png), [EN1280](evidence/v49-card-density-20261127/live-cards-en-1280.png), [combined filters](evidence/v49-card-density-20261127/combined-verified-image.png), [favorites](evidence/v49-card-density-20261127/buyer-a-favorites.png), [RFQ](evidence/v49-card-density-20261127/rfq-complete.png), [geometry and journey checks](evidence/v49-card-density-20261127/visual-results.json). Synthetic only. Reference HTML and screenshots, raw lab scripts, local profiles and logs stay outside public Git.

## Remaining
Review remaining reference adaptations and explicit defer/implementation decisions for ratings tied to transactions, response speed and supplier country; disabled controls are not completed metrics. Full backend regression, physical devices, production load, historical data and concurrent ranking changes still not fully accepted. Do not close Gate 1 or start Gate 2 without resolving applicable scope and outstanding material issues. No original checkout/DB, VPS, DNS, deployment or merge changes.
