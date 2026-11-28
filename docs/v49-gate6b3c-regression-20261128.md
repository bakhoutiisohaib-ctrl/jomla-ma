# Gate 6B.3C ? full regression after reliability changes ? 2026-11-28

**PASS: exact-source full local regression. Gate 6B.3 remains OPEN.** Runtime baseline adf93321e5e1f8354a3c2de1b0f538ef695b8f90, branch feat/v49-ui-integration. Original V4.9 SHA256 927901518b55674939608ca9b08802eff0a1f169da3012ba716d1c33f21cf903 verified; original Codex checkout HEAD 3b4f13a8125d439c278afff025840e0de0632d43 unchanged. No dependency manifest or lockfile changes from that base.

## Verification
- Backend: 778/778 tests, 45/45 suites, 363.393s, exit 0, one complete run.
- Frontend: 504/504 tests, 48/48 suites, 98.021s, exit 0, one complete run.
- Both Jest JSON inventories independently matched all tracked test suite paths; all recorded assertions passed, no skipped, pending, todo, failed or runtime-error suites. Total 1,282 tests across 93 suites.
- CI production build exit 0; main JS 210.58 kB gzip (main.4b9d285d.js), main CSS 21.01 kB gzip (main.ecb125ac.css). Entire sequential process exit 0, 487.92s. No runtime source changes between tests and build.
- Used the documented isolated Windows regression prerequisites: fresh private R41_OUTPUT/results, synthetic JWT, isolated media/log directories, ignored local phase-r2 evidence directory, validated historical local cost-model SHA256 8BBBA5BD6C9F442C843FECED885148F390A55F92E50F00BFBBBD9A85BDDE36E5, original database disabled on loopback port 1, external discovery disabled, cached MongoDB runtime, no backend .env, selected external provider variables removed. No production service calls. Existing injected failure logs are test scenarios, not failed assertions.
- Sanitized [suite inventory](evidence/v49-gate6b3c-regression-20261128/summary.json). Raw logs, credentials, private paths and cost inputs excluded.

## Unresolved acceptance
A new isolated browser fault/reload lab was attempted but blocked by the execution tool before it could be created or run. No new browser evidence or browser PASS is claimed. The previously blocked dedicated manual recovery operation remains unimplemented; no alternate execution path was used. Existing automatic recovery and status/UI guards retain their earlier scoped acceptance. Full regression validates existing coverage, not the missing manual recovery, real browser fault journeys, historical repair, physical devices or production readiness. Gate 6B.3 remains open for explicit resolution of these outstanding obligations. No new application feature or source change in this checkpoint. No deployment, default branch merge, original DB or reference modification.
