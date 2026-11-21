# Pilot-OPS1 — reviewed preparation, not activation

These templates target a fresh, operator-reviewed Linux host and database. They contain public placeholders only. They do not install services, create users/indexes, change firewall rules, issue certificates, connect to the original database or activate a pilot. No real credentials belong in this directory.

## Release and process boundaries

Use one immutable, root-owned release at `/srv/jomla-pilot/releases/<reviewed-id>`. Caddy's static document root must equal that release's `frontend/build`; API and worker read the same absolute releasePath and manifest hash from `/etc/jomla-pilot/release.json` (root:jomla-pilot 0640, containing directory root:jomla-pilot 0750). The service user must be able to read, but never replace, the pin. Do not use a mutable `current` link. Both processes verify every listed source/build hash, reject extra source or environment files, and refuse a different Node version. Dependencies are installed separately from the reviewed lockfile and are not attested by the source manifest.

`prepare-release.cjs` makes a NEW offline candidate outside the source tree, with its compiled frontend and SHA-256 manifest. It excludes original environment files, media, database data, tests, old backups and node_modules. It never overwrites an output directory or switches an active pin. Example preparation only:

```sh
node ops/pilot/prepare-release.cjs /reviewed/source /reviewed/build /independent/new-candidate reviewed-id v24.22.1
```

Review the candidate contents and manifest before transferring anything. The compiled build must come from that same reviewed source with public API URL `/api`, no embedded credentials. Keep the exact frontend source/lockfile/build evidence separately. An approved Linux staging run must install locked dependencies (`npm ci --omit=dev` in backend) and verify native Sharp/libvips on that host; this is not performed by the packager.

Install reviewed copies of launch.cjs at `/srv/jomla-pilot/launcher/launch.cjs` and its unchanged sibling helpers as needed; only root may replace them. API and worker units invoke that launcher under shared generation.lock plus separate exclusive api.lock / worker.lock. tmpfiles creates the lock files without replacing their inodes, in a root-owned directory the service account cannot unlink. Parent launchers retain locks while children drain; KillMode=control-group prevents orphan children. Both roles use JOB_WORKER_MODE=external; API recovery loops and worker recovery loops may coexist as designed by the existing durable protocols.

Before any future generation switch, stop and inventory ALL writers (old units, CLI, cron, containers and manually started Node), verify their termination, acquire generation.lock exclusively, update the pinned launcher/spec and matching Caddy root, validate, then release the lock and start only the reviewed units. A second managed role fails its nonblocking lock. These locks do not fence an unmanaged or privileged old process. A fresh database identity unknown to old processes, revoked old access, non-login service user and process inventory are mandatory gates. Do not claim an old writer is excluded merely because the template has flock.

## Files and permissions to approve on the target

| Template / path | Proposed destination / boundary |
| --- | --- |
| runtime.env.example | /etc/jomla-pilot/runtime.env, root:root 0600, fresh credentials only |
| release.json.example | /etc/jomla-pilot/release.json, root-owned pin, no credentials |
| *.service.example | /etc/systemd/system/, root-owned, API/worker separate role locks |
| jomla-pilot.tmpfiles.example | /etc/tmpfiles.d/jomla-pilot.conf; /run/jomla-pilot root-owned 0755 |
| Caddyfile.example | /etc/caddy/Caddyfile; static root only frontend/build |
| caddy-pilot.override.conf.example | /etc/systemd/system/caddy.service.d/pilot.conf |
| mongod.conf.example | new host MongoDB configuration, loopback + authorization |
| mongo-roles.json.example | review-only role specifications, not automatic user creation |
| /var/lib/jomla-pilot/uploads | application-owned 0700, persistent outside release; worker read-only; never served as a directory |
| /var/log/jomla-pilot/runtime | application-owned 0700, outside release, retention reviewed separately |
| /var/lib/mongodb | private MongoDB-owned persistent volume, outside application release |
| /etc/jomla-pilot-tls | root:caddy 0750, key 0640, trusted certificate via separately approved DNS-01 |
| wg0.conf.example / wireguard-client.conf.example | root-only protected configs; unique key per invited device |
| nftables.example.nft | proposed rules for review, never blindly replace a live firewall |

Symlink storage and storage inside a release are refused by the launcher. Never store sensitive supplier verification documents in the ordinary image folder. Backup database, images, role definitions, protected configuration and release pin together under an approved consistent procedure.

## Proxy, media and private data

Caddy binds only WireGuard 10.77.0.1:443, accepts the configured invited peer /32s by actual remote IP, and uses a trusted certificate prepared outside the application. Manual TLS disables automatic certificate requests. DNS, certificate renewal and real device trust still need operational tests. No HTTP Basic layer consumes the JWT Authorization header.

`handle @api` preserves the complete `/api` prefix, including `/api/media`, and the Bearer header. Express retains A/C1 ownership/public-eligibility checks and H5 independent image/business/authentication budgets. Caddy overwrites X-Forwarded-For/Host/Proto from the direct connection and removes Forwarded/X-Real-IP. TRUST_PROXY=1 is permitted ONLY with this single loopback proxy and denial of every direct API connection. Do not put another unreviewed proxy in front or trust arbitrary forwarded headers.

All API responses receive deferred `Cache-Control: private, no-store`, Pragma and Expires, including private media, failures and pending 202 responses. There is no image cache or filesystem alias. `/uploads`, AI enhancement, API docs, audit paths and `/api/suppliers/me/verify` remain blocked, including case variants. Verification intake stays unavailable until private document storage is separately approved; optional commercial verification is not a prerequisite for stores/products. Static .env/.git/backend/ops/node_modules/manifest paths are denied. Only frontend/build is the document root, with SPA fallback for direct product/store URLs.

The API currently calls app.listen(port) without a host and can listen on a wildcard. The units' IPAddressDeny/Allow settings require functioning systemd/cgroup/BPF support. Host and cloud firewall denial of API5000, Mongo27017 and Caddy admin2019, including IPv6, is mandatory; localhost upstream configuration alone does not isolate them. Outside-VPN denial must work even while Caddy is stopped. API/Mongo must never be publicly reachable.

Caddy's 12MiB whole-body limit complements the application's image limit; it is not a concurrency quota. AI credentials and GOOGLE_APPLICATION_CREDENTIALS remain empty, external discovery/terms flags false, Redis disabled and service egress localhost-only. The launcher refuses provider credentials or unapproved proxy/process settings. The existing AI button may remain visible but cannot call a real provider under this policy; no business UI change is included here.

## MongoDB privilege and index gates

Bootstrap fresh host admin credentials through a separately approved operator procedure. Never copy original credentials. Convert each mongo-roles entry to a Mongo custom role with resource `{db: APPROVED_DATABASE, collection: ''}`, inherited roles `[]`, and only its listed actions; use distinct accounts, passwords supplied outside source/logs. API/worker get app only, backup is read-only, index operator is separate, restore privileges are restricted to a NEW isolated restore target. No role grants cluster/admin access. Native Mongo access-control tests and host secret handling remain approval gates.

The operational preload sets Mongoose autoIndex=false and autoCreate=false BEFORE model imports. Runtime app accounts intentionally lack createIndex/createCollection privileges. Prepare required collections/indexes using the separate operator identity only after approved inspection. S1's exact partial unique index sourcing_creation_buyer_key must pass the existing read-only check; protected creation fails closed if missing/mismatched. No provisioning, backfill or original database access is performed here. Never grant the app a broad database-owner role to work around startup failure.

## Qualification and safe shutdown

Pin Node v24.22.1 LTS for the current candidate. Windows portable Node/Caddy checks are recorded externally under Pilot-OPS1; they do not qualify Linux systemd, flock, native modules, nftables, WireGuard or physical phones. A future security patch means a new tested pin, not silent replacement. 512MiB V8 old-space per Node process is not a total RSS/native memory cap. The 8GiB host / 1GiB WiredTiger cache are proposals requiring measured capacity, disk headroom and image growth estimates.

Read-only validation commands for an APPROVED prepared staging host, not activation:

```sh
systemd-analyze verify /etc/systemd/system/jomla-pilot-api.service /etc/systemd/system/jomla-pilot-worker.service
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
nft --check --file /reviewed/pilot-rules.nft
node scripts/check-pilot-blueprint.js
```

The last command checks text only and explicitly says deploymentReady=false. Preserve old evidence; save new results under a new external date directory. Native Caddy validate provisions modules/certificates without starting a listener; placeholders must first be replaced in an isolated copy. Test TLS, JWT forwarding, private/public media, H5 budgets, revoked publication, direct-port denial, role locks, shutdown/restart and device removal before any activation approval.

Pending durable operations are never erased by timeout. Stop new writes and allow existing supported workers to drain before maintenance. Do not restore old code that ignores receipts/intents/agreements. Keep the same supported generation for recovery; quarantine and escalate identity/price/version conflicts without forcing completion. A rollback needs compatible code and the preserved persistent database/media, never deletion of operational fields.

## Backup and remaining approval gates

Adopt and test the ACTUAL operational backup tool, encryption, independent destination, ownership, schedule, disk capacity and restore timing. Existing temporary BSON drills are not acceptance of a production backup mechanism. Quiesce all writers for the existing logical backup, or independently approve a consistent snapshot. Restore into a different empty database/new image directory, verify source hashes, media, indexes, receipts, pending intent and agreement, then resume using compatible code. Mongo users/configuration and secrets require separate protected backup; application backup alone is insufficient. See docs/BACKUPS.md as historical guidance, not automatic approval of destructive restore commands.

Uncompleted gates: Linux/native dependency and service qualification; firewall/VPN/IPv6 and process-exclusion tests; real DNS/TLS issuance and renewal; private secret management; approved consistent backup/restore; fresh database collections/index review and separate approval; storage/memory capacity; physical participant devices and operator monitoring/escalation ownership. No original index, service, DNS, firewall or deployment is changed by this package. The next step is isolated Linux operational qualification and backup drill under separate approval, before provisioning any original environment.

OPS4-A certificate-path correction: keep the certificate directory directly below /etc so Caddy can traverse its parents without access to the private application configuration directory. Directory root:caddy 0750; private key root:caddy 0640. API and worker explicitly deny this directory. Verify actual service identities on Linux before participant admission.
