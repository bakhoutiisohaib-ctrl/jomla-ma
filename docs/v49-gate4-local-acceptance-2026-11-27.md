# V4.9 Gate 4 — integrated local technical acceptance — 2026-11-27

**PASS / CLOSED for the local technical Gate 4 scope.** Runtime baseline a0d4a4384b6d9ff38e23f8cdf5b9d283d35296fb on feat/v49-ui-integration. This closing checkpoint is documentation and synthetic evidence only; the tested source is unchanged.

## Final same-source checks
- Final full frontend: 468/468 assertions, 44/44 suites, 88.133 s, clean exit. CI production build compiled successfully (main JS 195.69 kB gzip, CSS 20.51 kB). Existing React act warnings in test logs do not mean failures.
- Final relevant isolated backend regression: 54/54, 4/4 suites (reviews_trust, admin, security, publicPages), 26.715 s, clean exit. Earlier individual gate tests remain separate evidence; no claim of a new full backend inventory.
- Seven actual Chrome/Express/standalone MongoDB labs with fresh synthetic accounts and disposable databases: **55/55 browser records**, direct DB verification in every lab. The negotiation/review lab ran against this exact source before its documentation commit; six other labs reran against the clean committed runtime baseline. The serial six-lab rerun exited 0 (57.30 s). Each lab used its own disposable profile/database and loopback-only server; no production data.

| Slice | Actual records | Result |
|---|---:|---|
| 4A simple/advanced supplier workspace | 5 | PASS |
| 4B company, store, employee permission and revocation | 4 | PASS |
| 4C.1 photo/privacy/publication | 3 | PASS |
| 4C.2 draft acknowledgement/publication/withdrawal | 4 | PASS |
| 4D + 4E.3 buyer/supplier negotiation, completed agreement and review | 27 | PASS |
| 4E.1 wholesale opportunities | 5 | PASS |
| 4E.2 optional commercial verification | 7 | PASS |
| Total | 55 | PASS |

## Evidence and acceptance boundary
- [4A office](v49-gate4a-office-2026-11-27.md), [4B company](v49-gate4b-company-2026-11-27.md), [4C.1 photo](v49-gate4c1-photo-2026-11-27.md), [4C.2 drafts](v49-gate4c2-drafts-2026-11-27.md), [4D negotiation](v49-gate4d-trade-2026-11-27.md), [4E.1 wholesale](v49-gate4e1-wholesale-2026-11-27.md), [4E.2 verification](v49-gate4e2-verification-2026-11-27.md), [4E.3 reviews](v49-gate4e3-reviews-2026-11-27.md).
- The fresh recheck adjusted the 4A advanced-navigation count for one new trade-confirmation tab (14 nav actions + 2 mode buttons, versus 13 + 2); the same minimum target-size and overflow assertions were retained. Simple mode remains unchanged. The final trade lab likewise checked 10 buyer actions instead of 9 and navigated to the shifted notifications tab. Its first run failed because the isolated preview lacked a direct /buyer SPA fallback; corrected the harness and reran the complete journey successfully. No product code or pass criteria were weakened to hide failures.
- Direct DB proof: office read-only navigation created no commercial data; company membership revoked and employee detached; photo/draft visibility transitions retained the same product; one accepted RFQ, two offers (one superseded), closed thread, one confirmation containing both role timestamps, exactly one 4/5 review and preserved owner reply; wholesale lifecycle maintained a single record; verification preserved publication access through rejection/resubmission and awarded badge only after approval.
- [Sanitized integrated evidence](evidence/v49-gate4-local-acceptance-2026-11-27/summary.json); six rerun JSON record sets in the same folder. The final negotiation/review JSON records are linked from 4E.3. Raw logs, Chrome profiles, environment, and real data are excluded.

## Remaining declared obligations
This is not production, real legal/commercial certification, independent payment/delivery proof, live email/provider verification, load certification, physical-device acceptance or final project readiness. Mutual confirmations cannot eliminate collusion or withholding; independent transaction proof, dispute resolution and ratings moderation reconciliation remain future obligations. Legacy ratings excluded from new averages; historical deleted reviews without identity cannot be backfilled. Existing deferred product video, pre-RFQ chat, public trust metrics without validated sources, real registry/document inspection and other previously recorded limits remain open. Gate 4 local scope is closed; next gate may begin only according to the existing plan. No merge to default branch, deployment, external infrastructure operation, real database or original project modification.
