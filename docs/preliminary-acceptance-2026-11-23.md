# Preliminary acceptance — 23 November 2026

The owner confirmed no final hosting provider is selected and requested isolated
preliminary checks. These were executed locally without InterServer. No
application changes, dependency updates, original-data operations or deployment
were required. Source under test: `bf7e9b4`.

## Results

| Check | Result |
| --- | --- |
| Backup/restore guards and fidelity | 11 tests passed |
| Supplier, buyer and RFQ API journeys | 3 tests passed |
| Account recovery | 8 tests passed |
| Independent restore smoke | 19 collections, 10 documents and one image restored |
| Restored-data verification | BSON byte equality and index equality passed |
| Restored application | Buyer/supplier login and managed image retrieval passed |
| Small API timing sample | 24 requests, concurrency 2, zero errors; P50 12.7ms, P95 27.3ms, maximum 41.4ms |

The supplier journey covers registration, company/store creation and approval,
real local image upload, explicit publication and indexing. The buyer journey
covers text and visual search, filters, tier/comparison data and privacy. RFQ
covers creation, revised offers, acceptance, persisted notifications and closed
conversation rules. These are HTTP/API tests, not fresh browser interaction.

The separate restore exercise used fresh synthetic trade fixtures, quiescent
writes, a logical backup and a new target database. Login, media retrieval and
the timing sample ran against the restored database on an ephemeral loopback
port. Backup, restore and comparison together took 1511ms. The HTTP server and
Mongo child shut down at completion. No historical InterServer database was
opened or restored during these checks.

## Reproduction and evidence

Windows Node 25.9.0 and the already cached MongoDB 5.0.19 binary were used.
Tests ran sequentially, one fresh process per suite, with a 384MB Node heap
limit and wiredTiger cache set to 0.25GB by a private test-only adapter.
No dependency download or Mongo upgrade was performed. The limited free RAM
motivated this small sequential run rather than a full regression or load test.

The existing Jest suites are `backup`, `pilot_journey`, and `accountRecovery`.
The command used `--experimental-vm-modules --runInBand --testTimeout=30000`,
the existing `pilotIsolation`/`mongoLifecycle` setup helpers plus the bounded
Mongo adapter, and `--runTestsByPath tests/<suite>.test.js`.

[Evidence summary](evidence/preliminary-20261123/summary.json),
[journey results](evidence/preliminary-20261123/pilot-journeys.json), and
[restoration/timing results](evidence/preliminary-20261123/restore-smoke.json)
are sanitized. Raw logs, the adapter and the executed standalone restore-smoke
runner remain in `C:\JomlaLocal\preliminary-20261123`; their relevant hashes
are recorded. Synthetic backup files remain in a unique temporary directory
outside the repository. Do not treat them as real-user backups.

## Unclosed gates

This passes the requested preliminary scope only. A tiny test-mode dataset and
two concurrent loopback requests do not establish hosting capacity, production
latency, browser performance or durability under prolonged load. The old Windows
MongoDB crash root cause is not established by these successful short runs.

Final-host TLS/configuration, real email delivery, off-host scheduled backups,
final-environment restore/performance acceptance and deferred real-phone tests
remain open. Account-recovery tests use private synthetic mail; no real provider
was configured. Choose the final hosting environment before claiming point 3
is accepted there.
