# InterServer is a disposable test resource

Owner decision, 23 November 2026: InterServer was used for temporary storage,
builds and isolated tests. It is not the selected production host and must not
be the only location of development work or acceptance evidence.

## Authoritative and portable material

- GitHub `master` contains the source, locked dependency manifests, tests,
  reviewed evidence and handoff. PR #1 was merged as `5c8021e`.
- A new machine starts from [NEW_MACHINE.md](NEW_MACHINE.md), using a new
  synthetic database and newly generated private configuration. SSH access to
  InterServer, its fixture IDs and its runtime credentials are not prerequisites.
- Keep new application edits in the working Git checkout and synchronize them
  after verification. Copy important raw cloud evidence off-host before ending
  a phase; publish only reviewed, sanitized evidence in Git.
- Hosting selection, DNS and real email configuration remain separate decisions.
  Do not install a dependency on a temporary host's address in application code.

## Private preservation copy

A private archive is retained outside Git at
`C:\JomlaLocal\InterServer-preservation-20261123\project-private-verified.tar.gz`, with
`verified-copy.json` beside it. The folder is restricted to the Windows owner
and SYSTEM. It contains private runtime material and must not be uploaded to
the public repository or extracted into a web-served directory.

Scope: the development tree under `jomla-dev-20261105` and historical project
trees `/srv/jomla-ops3`, `/srv/jomla-ops4`, `/srv/jomla-pilot`, `/srv/jomla-phone`.
This preserves source snapshots, scripts, raw evidence, media, historical
backups and stopped development-database files. Reproducible dependencies,
Git internals, temporary test directories, core dumps, sockets and Mongo lock
files were excluded. The current source and Git history are independently
available in GitHub.

This is not an image of the entire server: operating-system configuration and
live databases outside those trees are not included. Historical synthetic
phone-trial state is not required to develop the platform. The development
preview service was already stopped; its attempted live logical export was
unavailable, so no successful fresh mongodump is claimed. The archive includes
its stopped database files. A database restore from this archive has not been
tested. Do not open those files directly as a production database.

The previous logical-backup restore evidence remains documented separately in
[recovery-operations-2026-11-21.md](recovery-operations-2026-11-21.md).
Windows MongoDB troubleshooting and new-machine acceptance are still distinct
checks; this preservation step does not certify either.

No existing server file was deleted, service restarted, account cancelled,
public port opened or deployment performed. The server may retain duplicate
copies until the owner requests a separate reviewed cleanup. For moving to
another computer, clone GitHub for development; transfer this private archive
separately only if its historical evidence is needed.
