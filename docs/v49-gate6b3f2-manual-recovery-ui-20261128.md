# Gate 6B.3F.2 ? manual recovery UI integration ? 2026-11-28

**PASS: scoped UI implementation and full frontend regression. Gate 6B.3 remains OPEN for manual browser acceptance.** Baseline 015468eb86db606f2857e65eab2e5c9607cdef10.

## Implementation
- Shared VerificationRecovery component in existing supplier verification and admin supplier cards only when sync pending or paused. Explicit read-only check, then explicit resume using exactly the saved operationId. No automatic write, new decision, dossier resend or local persistence.
- Validate supplier ID, revision/status, canonical verification boolean, operation ID/kind/base revision/phase/attempt count and role-specific canResume. A changed status/revision requires parent refresh; terminal or foreign receipt cannot initiate a resume. Confirm same operation and terminal completed/failed phase after POST; failed is separately reported as cancelled. Error clears checked receipt and requires a new lookup.
- Single-flight guard, current session token, keyed scope, cancellation/unmount protection; supplier profile refresh invalidates checked receipt even if revision/status did not change. Supplier cannot resume a saved admin decision. Admin recovery uses existing authorized route; ordinary approval/rejection controls stay locked while sync is incomplete. Parent rereads current profile/list after terminal acknowledgement; no new decision PUT. Arabic/French/English labels, existing layout/notice styles, no CSS changes.

## Verification
- Eight new component/integration cases: owner and admin exact resume, foreign/malformed response, role scope, superseded acknowledgement, failed terminal, session change, changed state. Initial targeted frontend 36/36 in four suites (12.275s), exit 0.
- Full frontend 515/515, 49/49 suites, 104.007s, exit 0. Strict CI build compiled successfully: main.a7052bdd.js 212.37 kB gzip, main.ecb125ac.css 21.01 kB gzip. Sequential process exit 0. No source edits between tests and build.
- git diff --check PASS. Original reference SHA256 927901518b55674939608ca9b08802eff0a1f169da3012ba716d1c33f21cf903 and original checkout HEAD 3b4f13a8125d439c278afff025840e0de0632d43 verified unchanged.
- No backend changes; previous 82/82 backend scoped tests remain separately applicable. No fresh full backend regression.

## Outstanding acceptance
Execution tool blocked creation of the new isolated manual fault browser lab; confirmed lab directory absent. No new browser or DB journey evidence claimed. Earlier automatic recovery browser acceptance is distinct. Manual paused-operation reload, outage/retry, admin/owner scope and DB proof must still be exercised in real Chrome before closing Gate 6B.3. Existing limitations of bounded receipts, audit and projection remain. No deployment, dependency, production data, default branch or reference changes.
