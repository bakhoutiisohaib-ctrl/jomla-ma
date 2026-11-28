# Gate 6A — exact-source full regression and outstanding scope audit — 2026-11-28

**PASS: full local regression baseline. Gate 6 remains OPEN.** Runtime baseline 51c6a8f86750ff6ac53210e553f5acfa5d0a2f3b, branch feat/v49-ui-integration. Original V4.9 SHA256 verified: 927901518b55674939608ca9b08802eff0a1f169da3012ba716d1c33f21cf903. Original Codex integration base 3b4f13a8125d439c278afff025840e0de0632d43 remains an ancestor, and original checkout HEAD remains that commit. No dependency manifest or lockfile differences from integration base. This is an audit and evidence checkpoint, not a runtime change.

## Fresh full regression on one exact committed runtime

- Backend: **746/746 tests, 42/42 suites, 357.227s, exit 0** in one full Jest run, not a union of reruns. Frontend: **485/485 tests, 47/47 suites, 96.299s, exit 0**. Both raw Jest JSON inventories independently matched every tracked test suite, every assertion passed, no failed, pending, skipped or todo assertions or runtime error suites. Total 1,231 assertions across 89 suites.
- Strict CI production build exit 0: main JS 203.95 kB gzip, main CSS 21.01 kB gzip. No source changes between backend, frontend and build. Existing Node/Mongoose warnings and deliberate fault-injection messages are not failed tests.
- Reused documented local prerequisites from [previous full regression](v49-full-backend-2026-11-27.md): fresh private R41_OUTPUT/results, disposable uploads/logs, ignored reports/phase-r2-evidence, validated existing local historical cost-model SHA256 8BBBA5BD6C9F442C843FECED885148F390A55F92E50F00BFBBBD9A85BDDE36E5. No backend .env in integration checkout; synthetic JWT, original DB URI disabled on loopback port 1, NODE_ENV=test, cached MongoDB (runtime download disabled), external discovery disabled, selected provider keys removed from child process, DISABLE_REDIS=1. No actual provider operation. Backend: npm test -- --testTimeout=120000 --silent --json --outputFile=<private>. Frontend: npm test -- --watchAll=false --runInBand --silent --json --outputFile=<private>; CI=true npm run build. Sequential execution, no timeout relaxation relative to documented full run, no forced process termination.
- [Sanitized suite inventory](evidence/v49-gate6a-20261128/summary.json); raw JSON, logs, private directories and offline cost input excluded from Git.

## Source and reference audit: open obligations, not waivers

Reviewed Gate 0 contract, all prior local gate closure reports, current RFQ routes/models, buyer/supplier message UI, public store/trust/verification/review paths, product update and runtime recovery lifecycle, original reference search/voice, media, chat and authentication demonstration. Existing local PASS evidence is not proof of all envisioned features.

| ID | Finding / obligation | Disposition |
| --- | --- | --- |
| R1 | RFQ free messages use a thread push followed by a separate Notification.create. Buyer sends content only; supplier mounted lock and refresh cannot identify a retried write after response loss/reload. | OPEN, first reliability fix. Add durable scoped request identity and payload conflict fence; recover exact message and notice without duplicates, preserve legacy clients and role/closed-thread guards. |
| R2 | Product PUT saves before index scheduling; ambiguous update acknowledgement and concurrent edits not fully resolved. | OPEN. Review revision/recovery contract and tests, no blind retry. |
| R3 | Verification revision CAS exists, but Supplier change, Store cache and audit completion are separate. Public store DTO and filter derive badge from Supplier, not stale Store flag. | OPEN for interrupted audit/projection and internal cache reconciliation; real document review separate. |
| R4 | Supplier notification navigation lacks buyer-style verified target fetch; supplier rejection/sourcing full browser journeys previously deferred. | OPEN. Verify target, authorization, read state and live journeys. |
| R5 | Reviews use mutual attestation; independent payment/delivery proof absent, collusion/withheld confirmation possible; old reviews excluded from new aggregate. | OPEN for eligibility policy/dispute and historic record decisions. No verified-purchase claim. |
| F1 | Reference top-rated/fast-response/country controls need defensible underlying data. Organization country is owner-editable/default MA, not verified nationality; no response SLA definition. | OPEN. Implement only real documented metrics/labels after evidence and explicit semantics, never invent data. |
| F2 | Product video and direct pre-RFQ chat were demo in original reference and remain absent in real app. | OPEN. Design secure media and scoped conversation contracts; no fake UI action or public private-media exposure. |
| F3 | Email/password flow and private recovery tests exist; Google and phone OTP not implemented. External email delivery not verified. | OPEN. Real provider contracts, credentials/configuration and account-linking/anti-duplication acceptance required; never simulate successful login. |
| F4 | Voice search in original uses browser SpeechRecognition; no real implementation in integration. | OPEN. Feature detection, explicit mic action/permission/privacy, transcript editing and text fallback; actual supported-device acceptance. |
| V1 | Prior visual adaptations: compact cards retain 44px targets and real commercial metadata; earlier 24–31px height delta, prototype dialog/filter behaviors differ. | OPEN for consolidated actual reference comparison and owner review. Preserve V4.9 identity, do not redesign from scratch. |
| V2 | Physical phone camera/microphone, AR/FR/EN devices, real catalog visual quality, production traffic, historical migration, final host TLS, live provider mail, operational backup schedule/restore and final environment load. | Separate release/physical gates; record explicitly, do not certify from localhost tests. No deployment authorization. |

Engineering references reviewed: MongoDB atomicity and transactions (https://www.mongodb.com/docs/manual/core/write-operations-atomicity/) and MDN SpeechRecognition (https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition). Single-document atomicity does not make multi-document writes atomic; browser speech support is limited and can involve server recognition. Keep standalone-compatible recoverable patterns and explicit consent/fallback. These are design inputs, not implemented fixes.

## Ordered Gate 6 execution plan

- 6A: complete exact-source regression and obligations ledger — PASS in this checkpoint.
- 6B: transaction reliability, beginning with R1 backend durable message/notification contract, then buyer/supplier client recovery; R2–R4 review/repair and fault-injection verification. Use existing RFQ journal/recovery conventions, no infrastructure change.
- 6C: resolve real V4.9 capability gaps and trust semantics (R5, F1–F4), without dummy data or fake providers. Separate local implementation from provider/device-dependent evidence and owner decisions.
- 6D: consolidated real visual comparison and cross-role browser acceptance, including deferred live journeys, isolation, security and bounded performance; fresh full regression on final source. Explicitly resolve or retain every outstanding obligation. Do not close Gate 6 on failed/blocked required scope.
- Separate release acceptance: final hosting/device/provider/real catalog readiness, explicit owner authorization. No default branch merge, deployment, VPS/DNS, dependency change, original database or historical migration in this checkpoint.

The subdivision is an engineering sequencing decision, not a change to the original Gate 0–6 plan or owner approval of omissions.
