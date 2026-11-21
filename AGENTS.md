# Project workflow

Start with `docs/HANDOFF.md` for current scope, outstanding gates and evidence,
and `docs/NEW_MACHINE.md` for portable setup. Update the handoff when a phase ends.

The owner requested GitHub synchronization after each completed development
phase (2026-11-21). Commits and ordinary pushes are authorized for that purpose.
Follow `docs/GITHUB_SYNC.md`: review the diff, perform targeted verification,
document limits, exclude secrets/private runtime evidence, commit, push, and
verify that the remote branch tip matches the local commit. Report failures
honestly; do not force-push, rewrite history, or deploy as part of synchronization.

Preserve unrelated work and original databases. Do not delete data, upgrade
dependencies, change DNS/security settings, or open public ports without a
specific user instruction. Use isolated synthetic data for tests.
