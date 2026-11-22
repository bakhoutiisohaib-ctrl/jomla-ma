# Launch-blocker fixes — 22 November 2026

Base: `17623293feb0d8c364fec7e28c4402a2d04d3750`, branch
`fix/launch-blockers`. The supplied document contained the overview, not the
ten referenced patch files. These changes were implemented against the source,
not represented as verbatim application of unseen patches.

## Implemented scope

- Delegated staff inbox reads, counts and read receipts allow only the owner's
  supported sales-notification types. Private/future types remain excluded.
- Error handling tolerates missing duplicate-key metadata and sent headers,
  maps upload/JWT errors, and derives the size message from the upload limit.
- Input validation enforces the existing local-image policy, phone bounds,
  valid review supplier IDs and consistent quantity-tier bounds.
- Report resolution claims one durable decision atomically. Conflicting or
  concurrent decisions return 409. Same-intent retry after the 60-second lease
  resumes idempotent effects and stable audit IDs. Public submission is limited
  to 20 requests per 15 minutes per IP; status filters are validated.
- RFQ creation recovery pauses at five attempts. The existing buyer-owned
  explicit retry resumes the same request, key and related identities.
- Sourcing decisions pause after ten attempts or one hour. Legacy operations
  use startedAt plus one hour. Explicit authorized retry renews the recovery
  budget without deleting the journal or allowing a conflicting decision.
- Media HTTP responses use a verified private temporary snapshot and bounded
  64KB reads, then stream the snapshot. Integrity and access are checked before
  headers. Optional ETag revalidation checks authorization before returning 304.
- Successful administrator login clears password state. A loading sourcing
  modal ignores backdrop clicks; frozen submission identity is preserved.
- Cookie/CSRF migration is documented in [the separate plan](jwt-cookie-migration-plan.md),
  not partially implemented.

## Operational choices and limits

`REPORTS_TRANSACTIONS=0` and `MEDIA_REVALIDATION=0` remain defaults. No existing
runtime configuration was changed. Transactions require a replica set; enabling
them against standalone Mongo fails closed. Standalone resolution is a durable
recovery journal, **not** multi-document rollback. A failed decision can have
partial effects until the administrator retries the identical intent after the
lease. Do not clear its claim manually or submit a contradictory replacement.

No TTL index was added: expiring a commercial operation must not delete its
record or unlock it for a conflicting decision. Retry limits apply to automatic
recovery, not an authorized user's deliberate retry. A paused record remains
visible and pending; it is not reported as successfully delivered.

Media revalidation is opt-in because it changes the previous no-store policy.
The snapshot avoids reopening the mutable original file after hashing. It trades
whole-image heap allocation for temporary disk I/O and requires writable private
temporary storage. Normal completion/failure cleans the snapshot; an abrupt
process termination can leave a temporary file for operational cleanup. No
temporary-file cleanup policy or server configuration was changed in this phase.

## Verification environment

Tests/build run in a fresh isolated InterServer copy with synthetic databases,
private network and temporary directories, 70% CPU quota and 2200MB memory cap.
Existing preview/services/data were not replaced. No public ports, DNS changes,
package upgrades or production deployment were performed.

The first targeted run recorded 280 passes and 38 failures: missing subprocess
output configuration, report-limit state shared across independent tests, and
incorrect new-test expectations. These failures are retained in private evidence.
The subsequent single-process full run exhausted its 1200MB JavaScript heap;
it is not counted as a successful regression run. Final backend verification
uses fresh Node processes per suite, a 30-second default test timeout and the
existing isolation/lifecycle helpers. MongoDB 8 uses wiredTiger through a
test-only adapter; the explicit ephemeralForTest teardown case is excluded
because that engine is absent from MongoDB 8. This exclusion is not an app fix.

Final result: **684 backend tests passed, zero failed, one excluded** across
38 suites; **41 frontend tests passed** across five suites; production-mode
private-pilot frontend build exited zero. The excluded test is the explicit
ephemeralForTest teardown case described above. The wiredTiger teardown and
replica-set rollback tests passed. Two per-suite checks were rerun successfully
after correcting the new RFQ test's existing HTTP 201 contract and copying a
missing offline cost-model fixture. No application behavior was relaxed to
obtain a pass.

See [sanitized counts and source hashes](evidence/launch-blockers-20261122/summary.json).
All 21 changed/new application and test files were hash-matched between Windows
and the tested cloud copy. The hashes describe working-file bytes before Git
line-ending normalization. Raw logs and credentials stay outside Git.

The five frontend suites were SourcingModal, AdminDashboard, LocalAcceptance,
LocalReviewJourneys and RecoveryPage. This is scoped frontend regression, not
the entire frontend suite or a fresh visual/browser acceptance.

### Reproducing the backend run

Use an isolated checkout and synthetic-only environment, with its existing
locked dependencies. The cloud-only MongoDB 8 adapter wraps
`MongoMemoryServer.create(options)` to supply `instance.storageEngine =
'wiredTiger'` unless explicitly specified. It does not change dependencies.
Set `MONGOMS_SYSTEM_BINARY` to the reviewed local MongoDB 8.0.34 binary,
`MONGOMS_VERSION=8.0.34`, `MONGOMS_RUNTIME_DOWNLOAD=false`, `NODE_ENV=test`,
`NODE_OPTIONS=--max-old-space-size=1000`, and `TMPDIR`/`R41_OUTPUT` to a fresh
private test directory. Run each `backend/tests/*.test.js` in its own process:

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand \
  --testTimeout=30000 \
  --setupFilesAfterEnv ./tests/helpers/pilotIsolation.js \
    ./tests/helpers/mongoLifecycle.js ./mongo8-test-adapter.cjs \
  --runTestsByPath tests/SELECTED.test.js --json --outputFile=PRIVATE_RESULT.json
```

For `mongoLifecycle.test.js` only, the actual command added
`-t '^(?!real ephemeralForTest)'`. Copy the tracked `ops/pilot`, `scripts` and
`reports/phase3-cost-model.json` inputs as well as the backend and frontend.
Do not run these instructions against original data or assume that a test
adapter makes an unsupported storage engine available.

## Rollback and acceptance

Review/revert the phase commit on this branch; do not blindly downgrade a running
worker with dead RFQ or paused sourcing records. Preserve pending journals and
complete/review them before any runtime downgrade. No data migration was run.

This phase does not certify commercial launch: real email delivery, final
deployment-environment backup/restore/performance acceptance and deferred real
phone checks remain separate gates. Frontend unit tests and build do not replace
new browser screenshots or end-to-end production acceptance.
