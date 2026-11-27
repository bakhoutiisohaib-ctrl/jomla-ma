# Gate 4E.1 — wholesale opportunity acknowledgement and lifecycle (2026-11-27)

**Scoped local acceptance: PASS. Gate 4 remains OPEN.** Baseline `c43a4298683c6bc571e561a3c2c46fb3fdbf83fc`, branch `feat/v49-ui-integration`. Development worktree `C:/JomlaLocal/v49-integration`. Backend and approved UI layout unchanged.

## Changes
- Validate the acknowledgement DTO's opportunity ID shape, product identity, update identity, revision, lifecycle status, expiry and tier array before discarding the original attempt.
- Unconfirmed creation preserves the original key/body; unconfirmed update permits owner-scoped read recovery, not a second blind write. Reject mismatched and older-than-original-edit private reads.
- Respect the existing create replay contract: an authenticated idempotent replay may return an advanced revision of the saved opportunity. Show a neutral saved-version message instead of claiming a new draft. Treat a server-derived expired publication acknowledgement as non-public.
- Seven new regression cases in the existing wholesale suite; no API, database model, dependency or timeout changes.

## Test chronology
- First targeted run: 15/15. First full run: 460/461, 42/43 suites; existing taxonomy journey exceeded the unchanged 5 s timeout (304.247 s overall). Isolated recheck 6/7, next recheck 5/7. Detached baseline at c43a429 with shared installed dependencies: 7/7, slow journey 5605 ms. Available physical RAM was approximately 0.46 GiB; owner freed RAM to approximately 4.09 GiB.
- Unchanged taxonomy recheck after RAM release: 7/7; formerly failing journey 1482 ms. Full FE 461/461, 43 suites, 73.381 s; build PASS. Initial browser run failed because the harness did not select the advanced supplier-office mode. Corrected only the local browser harness; repeat 5/5 and direct DB PASS.
- Review identified the existing create-replay and expiry DTO contracts; refined acknowledgement handling and added three more tests (seven new total).
- Final exact-source targeted FE: 18/18, exit 0, 6.043 s. Final `git diff --check`: PASS. Final full FE: **464/464, 43/43 suites**, exit 0, 82.478 s. Final optimized production build: compiled successfully, exit 0. Final fresh isolated Chrome + Express + MongoDB wiredTiger run: **5/5 browser records and direct DB PASS**, exit 0. Existing React act warnings observed during broader suite; no failing assertions in final run.
- Final command sequence was serial, stopped on failure, and completed in 109.97 s. Node 25.9.0, npm 11.12.1. Resource-pressure explanation is supported by before/after tests, not a proof of the sole cause.

## Actual isolated lifecycle
Synthetic supplier uses advanced office, chooses an eligible published product, saves a draft, explicitly publishes, and pauses the same opportunity. Anonymous quantity 50 / maximum unit price 18 MAD filter returns the 18 MAD tier (base 21, MOQ 20). The database contains exactly one opportunity, linked to the intended supplier/store/product. Revision 0 -> 1 -> 2; public detail HTTP 404 -> 200 -> 404 and public filtered-list membership false -> true -> false. Visitor cannot request a quote from the paused public route. Runtime exception count zero. Reviewed three synthetic AR390 screenshots; not a full visual/physical-device sign-off.
- [Final synthetic browser/DB records](evidence/v49-gate4e1-wholesale-20261127/wholesale-results.json)
- [Published supplier card](evidence/v49-gate4e1-wholesale-20261127/supplier-published-opportunity.png)
- [Public opportunity](evidence/v49-gate4e1-wholesale-20261127/public-opportunity.png)
- [Paused supplier card](evidence/v49-gate4e1-wholesale-20261127/supplier-paused-opportunity.png)

## Scope and remaining obligations
This is a scoped FE acknowledgement/lifecycle checkpoint, not final Gate 4 acceptance. Backend unchanged; no new full backend suite run. Earlier backend contract coverage retained, not claimed as newly executed. Real lost-response/replay and expiry-boundary coverage here is mocked FE; real browser confirms normal lifecycle with direct DB checks. The initial create response is structurally checked and product-bound; it does not independently recompute the server's key-derived ID. Pending attempts are in memory, not durable across page reload; existing warning instructs users to inspect their private list. Server-side authorization and creation idempotency/CAS remain authoritative. No real payment, delivery, physical phone, email provider, production deployment, or new end-to-end opportunity RFQ acceptance in this slice. Original project/database, VPS, DNS and default branch untouched. Synthetic local lab and raw runtime logs not published. Next Gate 4E.2 optional commercial verification, then 4E.3 trade-eligible reviews and reply rules; integrated Gate 4 acceptance still required.
