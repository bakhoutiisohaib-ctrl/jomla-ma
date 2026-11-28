# V4.9 integration — Gate 1B quantity price display (2026-11-26)

**PASS for this limited slice; Gate 1 remains open.** Base f467fa354d6af68f6a573602b7293fefefe50e21. V4.9 reference re-read and SHA-256 verified (927901518b55674939608ca9b08802eff0a1f169da3012ba716d1c33f21cf903). The reference shows a price range; the actual product model and searchCatalog/visualIndex contracts are the source of truth.

## Changes
- The compact card shows a truthful range of reachable unit prices from published tiers, or a single price. The base participates only where a quantity is not covered by a tier. Invalid/malformed browse ranges are not advertised, quote-only items have no numeric claim, and currency is explicit.
- When quantity is applied, the card uses effectiveUnitPrice from the completed server response and labels the quantity. No fabricated fallback for a missing effective price. When price filtering/sorting without quantity, the original server uses the base price: the card explicitly labels that search basis, not a potentially different tier range. The existing server filter semantics remain unchanged; improvement of search policy is a later gate.
- App stores pricing context with the loaded result, not with the next pending filter. Existing RFQ, cart, public media and other routes stay intact. This is display only: no change to quote or payment terms, database or backend. No new dependency.
- Range currency is displayed once; trailing zero decimals are removed for compact range presentation, respecting currency fraction formatting.

## Fresh verification
- Final targeted Jest: 82/82 cases, 8/8 suites, exit 0, including 22 additional cases (21 helper cases and one catalog journey) beyond the preceding 60-test selection. Earlier successful run repeated after the final formatting adjustment, not counted twice.
- CI=true optimized frontend build: compiled successfully, exit 0.
- Real Chrome headless with the built React + Express app, disposable MongoMemoryServer 5.0.19, local port 5059: five language/viewport configurations (Arabic 1280/390/320, French 390, English 1280). No horizontal overflow, readable range, correct badge placement, 44px existing controls, no uncaught runtime errors.
- Live API/browser price flow on synthetic fixtures: tiers 22 MAD for 10–29 and 18 MAD for >=30, base 25 MAD. Browse displayed 18–22; quantity 50 displayed 18 and another untiered product 55. Adding maximum price 20 returned only the 18-MAD item. Clearing filters restored the range; max 26 without quantity displayed the existing server base 25, explicitly labeled. Browser and API flow exit 0. Preview shut down.
- Initial browser attempt on 5061 returned no products/HTTP traffic; this is a Chrome restricted port. Retried on 5059 successfully, then repeated the whole test/build/browser sequence after final formatting adjustment.
- [Reviewed 390px screenshot](evidence/v49-price-slice-20261126/ar-390.png), [geometry and live price flow](evidence/v49-price-slice-20261126/visual-results.json). Synthetic images only, not a full visual parity or physical-device test. No fresh standalone backend suite for this display-only slice; real API exercised in the browser. Raw scripts remain local, outside Git.

## Next
Gate 1 stays open: implement a real account-isolated favorites capability, remaining market shell/navigation and complete visual/functional acceptance. Do not start Gate 2 prematurely. Existing onboarding PR and master untouched. No deployment.
