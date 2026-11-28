# Gate 4E.2 — optional supplier verification (2026-11-27)

**Scoped local acceptance PASS. Gate 4 remains OPEN.** Baseline e070929bdbc84aeba46a7242fc8da462c5c7f921. Verification remains optional and independent of store approval/product publication.

## Implementation
- Supplier-only submission, bounded typed fields, HTTPS URL without credentials (unchanged legacy reference may be retained), private verification revision with conditional state update. Pending dossiers cannot be changed; same pending/approved dossier replay is non-mutating. Changed approved dossier returns to review; old decisions cannot approve a newer revision. Concurrent opposite admin decisions yield exactly one success.
- Administrative decisions carry the exact dossier revision; legacy pending rows use revision 0. Server CAS protects status and revision and writes audited intent/completion. Public badge uses canonical supplier status, not denormalized store flags alone.
- Supplier panel requires a confirmed owner-bound private read; synchronous write guard, token/unmount fence, pending fields disabled, uncertain result requires refresh. Admin confirms returned identity/revision/status/audit, guards duplicate submits and stale list reads. Existing design and simple/advanced separation retained.
- Existing admin/security tests updated for revision contract and disposable MongoDB isolation; new concurrent/stale/replay test and two FE cases.

## Evidence
- Isolated backend: 46/46 (3 suites), exit 0 (admin, security, public pages), 20.457s.
- Targeted frontend 25/25 (4 suites), full FE 466/466 (44 suites), exit 0, 79.575s. CI build initially rejected an effect cleanup ref warning; removed redundant generation increment (mounted/token guard retained). Final targeted recheck 25/25, 10.878s, build compiled successfully with CI=true. Full FE run preceded this cleanup-only correction; final exact-source targeted recheck and actual browser PASS.
- Final Chrome AR390 + isolated Express/MongoDB wiredTiger: 7/7, direct DB PASS, exit 0. Unverified -> pending rev1 -> rejected rev1 -> pending rev2 -> verified rev2. Product/store HTTP 200 at every state; badge false until approval. Repeating identical approved dossier preserves verified state, rev2, exactly two submitted audits, one rejection, one approval. No private ICE exposed on public store page. Screenshots reviewed.
- [Browser/DB records](evidence/v49-gate4e2-verification-20261127/verification-results.json)
- [Pending](evidence/v49-gate4e2-verification-20261127/supplier-pending-verification.png), [approved public store](evidence/v49-gate4e2-verification-20261127/public-verified-store.png), [approved owner](evidence/v49-gate4e2-verification-20261127/supplier-verified.png).

## Limits
No actual government registry verification or document retrieval/review in this synthetic run. Administrative approval is not a commercial guarantee. The existing non-transactional audit and store-cache projection remain separate writes; interruption recovery/legacy cache reconciliation and operational review of documents remain open. No new full backend inventory or physical device test; existing React act warnings in broader tests. No production database, deployment, DNS, VPS, default branch, original worktree or private evidence changed. Next Gate 4E.3, then integrated acceptance.
