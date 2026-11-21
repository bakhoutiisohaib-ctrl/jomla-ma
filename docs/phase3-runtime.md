# Phase 3 — runtime preparation for a protected Moroccan pilot

Prepared 20 October 2026. This is a blueprint and reviewable template set, not a deployment result. No server, VPN, database connection, DNS change, certificate issuance, purchase, original `.env` read or original data migration was performed. Examples live in [ops/pilot](../ops/pilot/README.md).

## Architecture that matches the existing application

Use one reviewed Linux VPS with a static React build, Caddy, Express API, an independent Node worker and a local authenticated MongoDB. Persist images outside the release directory. No Docker, Next.js, PostgreSQL or object-storage migration is introduced.

| Existing source behavior | Runtime consequence |
| --- | --- |
| `frontend/package.json`: `react-scripts build`; API client defaults to `/api` | Serve only the reviewed static `frontend/build`; never expose the development server |
| `backend/start.js`: Mongo connect before listen; default embedded worker | Set external worker mode and give API/worker the same runtime environment and database |
| `backend/workers/worker.js`: direct Node entry, bounded attempts and graceful stop | Separate systemd process with SIGTERM grace longer than the worker drain interval |
| `start.js`: listen called without host | Do not describe the application as loopback-bound. Caddy uses a loopback upstream; firewalls and verified unit filters stop direct network access |
| `services/mediaStorage.js`: absolute `UPLOADS_DIR`, otherwise checkout-local fallback | Supply the absolute persistent path in both processes; do not put mutable data under a release symlink |
| `server.js`: `/uploads` static without session checks | Block media at the proxy until the media-privacy gate is resolved; this template cannot satisfy complete image-based pilot acceptance yet |
| `server.js`: comma-separated CORS and opt-in one-hop proxy trust | Use only the real HTTPS origin, one reviewed direct Caddy proxy, and verify forged forwarding headers on staging |
| `server.js`: readiness is Mongo state/ping | Monitor the worker, disk, failed/pending jobs and audit events separately; readiness 200 is not complete service health |
| Existing backup tools: per-collection logical copy plus images | Pause writers or approve a snapshot method; off-host encryption, scheduling, retention and restore ownership remain external operational gates |

The staging plan selects **Node 24 LTS with its current security patch**, pinned at installation, and locked dependencies installed using `npm ci` from reviewed lockfiles. The current local Node 25.9.0 is not a production baseline; the chosen Linux Node 24/sharp/Mongo combination still requires installation and full retesting. `/usr/bin/node` is an explicit unit assumption to check on the target host; do not use an interactive-shell version-manager path accidentally. See [official Node release status](https://nodejs.org/en/about/previous-releases). No local Node runtime was changed.

The initial sizing assumption is 8 GiB, with each Node process's V8 old-generation heap set to 512 MiB and MongoDB WiredTiger cache proposed at 1 GiB. This is planning, not measured capacity. Native Sharp/libvips, Buffers, overall RSS, Mongo process overhead and concurrent API requests are outside a V8 old-generation heap limit. A 4 GiB alternative is narrower and unmeasured. `JOB_CONCURRENCY=1` limits the separate worker, not all uploads or visual searches. Record actual Linux memory and CPU under a controlled synthetic load before accepting either host size.

## Protected access and TLS decision

The public host exposes only WireGuard UDP 51820 plus management SSH from the approved operator source. Caddy listens on the VPN address 10.77.0.1 only; its request admission checks the direct peer's individual invited IP. Node port 5000, Mongo port 27017, Caddy's admin port 2019 and public HTTP/HTTPS stay closed on the internet interface. Client routes include the pilot server only. There is no forwarding/NAT requirement for accessing services on that server. These are proposed controls and must be tested externally after separate approval.

The selected merchant-facing TLS approach uses a **publicly trusted certificate prepared by a separate DNS-01 process** for an owner-controlled pilot subdomain. The placeholder `pilot.example.invalid` cannot be used as the real hostname or certified. Caddy's example loads pre-existing chain/key files and disables automatic HTTPS management; it does not perform ACME or open port 80. This avoids asking merchants to install a private CA. The owner still needs an approved DNS provider/plugin or other approved certificate workflow, scoped credentials, renewal automation, a successful reload hook and an expiry alert. None has been provisioned.

Resolve the real subdomain to the private VPN address and test that resolution on actual target devices. Rebinding protection, Android private DNS, browser secure DNS, cache and home/mobile network behavior can affect access. Do not route all participant internet traffic through the VPN, or configure a non-existent DNS service on its server address. A trusted certificate does not replace VPN admission. HTTP Basic authentication is deliberately absent so application `Authorization: Bearer` is preserved.

Caddy's [bind directive](https://caddyserver.com/docs/caddyfile/directives/bind) selects its listener interface; its [remote_ip matcher](https://caddyserver.com/docs/caddyfile/matchers#remote_ip) checks the immediate peer rather than trusting forwarding headers. The [manual certificate syntax](https://caddyserver.com/docs/caddyfile/directives/tls) and [auto_https options](https://caddyserver.com/docs/caddyfile/options#auto-https) support the supplied-file approach. This does not claim certificate files already exist or that native Caddy validation succeeded.

## Isolation, credentials and persistence

systemd reads a root-owned runtime environment file and invokes Node directly as an unprivileged dedicated user. Keep release code read-only; permit only image/log directories to be writable where required. No completed environment, WireGuard key, database credential or private certificate belongs in Git or a shared report. Template JWT/Mongo secrets are conspicuous invalid placeholders, and production is expected to fail until replaced through an approved secret-management step.

The two units restrict IP traffic to localhost, which fits the initial manual-entry/local-visual-search scope. This also blocks provider HTTPS egress: AI remains out of scope. The systemd filtering depends on the host's BPF/cgroup capabilities and must be verified; it is defense in depth behind host/cloud rules. It does not change Node's listening address. Avoid `MemoryDenyWriteExecute` without a dedicated Node/V8 compatibility test; no untested syscall filter is included.

The proxy uses a case-insensitive deny expression because Express routing is case-insensitive by default; this is still not a complete authorization proof for all normalized/encoded paths. The existing frontend does not have a runtime feature flag to hide the AI action, so manual-only training must explain the unavailable action honestly. Empty credentials plus restricted egress remain independent controls. Do not relax egress to enable AI without a separately approved controlled egress proxy/provider-allowlist design, budget and audit.

The [request_body directive](https://caddyserver.com/docs/caddyfile/directives/request_body) sets an overall 12 MiB request limit, alongside the existing 10 MiB image limit. It must be validated on the host with safe synthetic multipart requests, including 413 above the whole-body limit. This is a size bound, not a concurrency or per-account rate limit.

The [systemd execution reference](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) defines environment and filesystem restrictions; the [resource-control reference](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html#IPAddressAllow=) describes IP traffic filtering. Treat unit verification and actual hostile-path network tests as separate evidence.

The Mongo example sets `net.bindIp:127.0.0.1` and `security.authorization:enabled` for a new dedicated installation. Provision scoped app, backup and restore identities separately. Do not copy the owner's existing database or credentials into the pilot. The [official Mongo configuration reference](https://www.mongodb.com/docs/manual/reference/configuration-options/) documents these controls. The example does not bootstrap accounts, provide replica-set transactions or encrypt the local connection; local access relies on OS boundaries plus Mongo authentication.

The WireGuard examples reserve individual peer addresses and carry no usable keys. Generate private keys on their intended devices, share only public keys with the operator, and revoke a device across its peer/admission records. The [official WireGuard quick start](https://www.wireguard.com/quickstart/) explains key/peer setup, while its [routing discussion](https://www.wireguard.com/netns/) explains interface/routes. No tunnel was started here.

## Explicit unresolved blockers

1. **Media privacy:** the owner selectedStrictDraftPrivacy. Proxy denial hides all `/uploads` and proposed `/api/media` requests; it is a stopgap, not an implemented authenticated media service. Ownership metadata, a permission-checked media route and the Bearer/blob client flow remain unimplemented prerequisites for a separately authorized code round. Do not admit real suppliers, remove that denial or add a public-media fallback until the fix passes isolation and end-to-end tests. Image rights and private verification documents still require explicit handling; no identity documents belong in publicuploads.
2. **Infrastructure:** no host, firewall, VPN, certificate, origin or DNS resolution has been verified. Review and test platform-specificMongo/AppArmor paths, package service users, service sandbox behavior and actual listener exposure.
3. **Backup/restore:** the existing tools do not copy Mongo users or secrets, produce a global snapshot during writes, encrypt archives or schedule off-host transfers. A named owner must configure and test those controls. RPO 24h andRTO 4h are proposals requiring approval and measurement, not founding-blueprint requirements.
4. **AI/external providers:** template credentials stay empty, external flags false and enhancement endpoint denied. Enabling them later requires a separate provider/consent/budget/egress review and live authorized acceptance test.
5. **DNS-01 renewal:** a supplied certificate without tested renewal is not a closed gate. Use scoped DNS credentials separate from API/worker, test renewal and permission-preserving reload, and alert before expiry.

## Validation performed and still required

Local Windows tools available: Node andPython/PyYAML. Caddy, WireGuard, wg, nftables, Docker and systemd-analyze were not available as native executables. No WSL distribution or new package was installed, and no server was started to validate these templates.

Local read-only checks cover environment parsing and required values, YAML structure, systemd section/directive consistency, matching paths and addresses, explicit blocked routes, and placeholders rather than real secrets. These checks are not a replacement for `caddy validate`, `systemd-analyze verify`, `nft --check`, WireGuard setup, certificate-chain validation or live bypass tests on an approved host.

Run `node scripts/check-pilot-blueprint.js` for the repository's offline consistency checks. It loads no `.env`, makes no network/database call and starts no service; a pass is structural and remains **not deployable**. Refresh [the saved validation result](../reports/phase3-local-validation.json) after template hashes are frozen.

Future acceptance evidence must include denied outside-VPN access toUI/API/media and direct ports 5000/27017, admitted unique peers, denial after peer revocation, valid TLS without merchant-installed CA, frontend/API same-origin operation, persisted images/jobs after restart/redeploy once the media blocker is fixed, worker recovery, and an isolated restore drill. Start with synthetic data; only the owner-approved closed-pilot gate can authorize real participants.
