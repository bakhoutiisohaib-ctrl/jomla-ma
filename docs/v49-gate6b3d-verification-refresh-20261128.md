# Gate 6B.3D ? fail-closed verification profile refresh ? 2026-11-28

**PASS: scoped UI defect correction. Gate 6B.3 remains OPEN.** Baseline 425316cc2cfae910876afbed4acbb05f305c3996. A source review found that a failed read after an initially valid, editable supplier dossier retained the old row and left editing enabled. A regressive revision also passed the read contract.

## Correction
- Both read and write failures now mark the verification panel uncertain and prevent new submission until a valid current-owner profile read succeeds.
- Reject a profile revision lower than the last confirmed revision in the mounted owner/session panel. Keep the displayed record and unsaved inputs on failed refresh, identify it as the last confirmed version, and replace inputs only on a successful authoritative read as before.
- Reuse the existing notice and fieldset; no new endpoint, permission, recovery execution path, CSS or ordinary wizard/layout change.

## Verification
- Added three component regression cases: failed refresh with preserved input and no new POST; malformed synchronization contract after a successful read; regressive revision rejected until a valid refresh. Existing assertions retained.
- First targeted run: 25/28, three failures caused by duplicate accessible alert notices introduced by the initial correction. Consolidated the stale-record explanation into the existing error notice. Final targeted run: 28/28, 3/3 suites, 10.726s, exit 0 (SupplierVerificationPanel, SupplierDashboard, AdminDashboard). Strict CI production build exit 0, main JS 210.77 kB gzip, CSS 21.01 kB gzip. Diff check PASS.
- Full regression at 425316c covers 778 backend and 504 frontend tests before this small UI-only correction; it is not a fresh full regression of this revision. No backend changes or real browser fault acceptance.

## Outstanding
Dedicated manual recovery and the new browser fault lab remain unimplemented/unexecuted following earlier tool blocks; no alternative execution route attempted. The local full regression and this independent UI correction do not remove those requirements. Gate 6B.3 stays open. No deployment, dependency or reference changes. Further closure requires resolution of the blocked acceptance scope, not repeated identical full regression runs.
