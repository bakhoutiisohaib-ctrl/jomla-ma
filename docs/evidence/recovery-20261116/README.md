# Reviewed evidence: supplier publication and private recovery

These artifacts were collected on 2026-11-16 and packaged on 2026-11-21.
They are historical evidence, not a new run against the GitHub baseline.

- `backend-summary.json`: 22 passed tests, 3 suites; recovery, backup and pilot journey.
- `frontend-summary.json`: 46 passed tests, 6 suites.
- `build-summary.txt`: successful historical frontend build and output bundle names.
- `supplier-published.jpg`: actual synthetic supplier workspace screenshot showing
  the publication confirmation and published product. Reviewed before inclusion.
- `source-hashes.json`: SHA-256 of the original result files, build log and image.

The JSON summaries preserve test names/statuses and totals, omitting raw console
output, failure payloads and machine-specific runtime details. They are derived
summaries, not copies of the complete original logs. Original logs and private
mailboxes/credentials are deliberately not included.

The screenshot does not independently prove every preceding approval/upload step
or the public catalogue. API tests do not prove completion of a browser password
reset. Neither these tests nor the successful build establish production readiness.
