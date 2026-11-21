# Recovery and operations verification — 2026-11-21

The expired private preview sessions were restarted. Health remained ready after
the drill. No public ports, DNS, old production services or original databases
were changed. Application source was unchanged; no build/full suite was rerun.

## New evidence

- Browser: Arabic recovery request for the synthetic buyer displayed the generic
  confirmation; a matching test-only message with a loopback link was verified in
  the private mailbox. No external email was sent.
- Missing-token page displayed the invalid/expired-link message.
- Valid-link form was opened for the owner; entering and submitting the new
  password requires user handoff under browser-control rules. Completion pending.
- Encrypted backup: authenticated decryption on Windows, tampered ciphertext
  rejected, checksum verified, private key retained outside VPS, plaintext held
  only in local memory. Archive paths/types validated before remote extraction.
- Restored to a new database on a copy of the synthetic snapshot: 61 BSON-exact
  documents in 20 collections; matching indexes; 5 media files with identical
  paths and SHA-256 hashes. Restore/comparison elapsed time: 10041ms.
- 100 read requests, concurrency 5, zero failures. Median 98ms, P95 280.6ms,
  maximum 390ms. Six public synthetic products. Routes: readiness, search,
  stores, product details. RSS at measurement: 190603264 bytes.

## Scope and limitations

The source backup dates from November16. Restoration and performance were
verified November21 in a PrivateNetwork systemd unit capped at 1GB and 50% CPU;
the unit completed with exit0. Production-mode Express inside this lab is not
final hosting acceptance, browser latency, realistic load or capacity proof.
Restore is explicitly non-atomic; its destination was separate from the preview.

Initial transfer failed on Windows text encoding, corrected to UTF-8. Slow SFTP
transfer was stopped and replaced with prefetched download/pipelined upload.
The partial archive was retained; a new filename was used. An early restore
attempt correctly stopped because the off-host completion marker was absent.

Evidence is in [the reviewed bundle](evidence/recovery-20261121/). Raw backup,
credentials and reset links are excluded. JSON and documentation checks are the
only local validation for this documentation change.

Remaining: owner-completed browser password reset, actual outbound-mail setup
when a provider is chosen, and final-environment restore/performance acceptance.
Physical-phone testing remains deferred. Windows MongoDB root cause remains open.
