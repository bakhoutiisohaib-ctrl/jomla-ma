# GitHub synchronization

The owner authorized commits and pushes on 2026-11-21. GitHub stores the source
and reviewed documentation; it is not a deployment or a database backup.

At the end of each development phase:

1. Inspect the diff and preserve unrelated work.
2. Run appropriate targeted checks in the isolated test environment. Record
   passes, failures, and checks not performed in the phase report.
3. Review staged files for secrets, database contents, user uploads, local
   configuration, raw evidence, and private credentials. Do not stage these.
4. Commit the phase with a descriptive message and push the current branch.
5. Compare the local commit with the remote branch tip and report the commit
   link to the owner. Do not call synchronization complete if the push failed.

Never force-push or rewrite history as part of routine synchronization. Review
remote changes before resolving divergence. No deployment is authorized by a
source push. Preserve local evidence outside version control.

## Baseline scope

The initial synchronization captures existing application work, including Atlas,
supplier and buyer flows, RFQ, and private account recovery. It is a development
checkpoint, not production acceptance. Recovery currently uses a private test
mailbox; a real mail provider is not configured. Final operational backup,
restoration and performance acceptance, and physical-phone testing remain
separate gates. Historical test reports are evidence of their stated scopes,
not fresh full-regression results for this synchronization.
