# Sourcing S2 — activation, recovery and rollback

Prepared locally; **no original-environment connection or activation performed**.
S3 buyer-decision reliability is not implemented. The existing decision path
only receives the S2 pending-operation guard and its version-race equivalent.

## Storage and protocol

Only SourcingRequest gains optional fields: `operation` (version 1,
`kind:sourcing_offer`, `phase:pending`), quote `submission` receipts and quote
`commercialSnapshot`. Old requests/quotes are not backfilled or guessed.
No new indexes, collections, notification kinds, conversations or orders.

1. Buyer creation remains S1. Offer POST requires a separate Idempotency-Key
   matching `[A-Za-z0-9_-]{16,128}`. Normalize price, delivery days and bounded
   terms/notes; currency remains MAD. Scope the key/hash to request + authenticated
   supplier owner. The authenticated actor is captured independently of the key,
   so authorized colleagues can recover an attempt without replacing its actor.
2. Inspect permanent receipts **before** closed/fulfilled checks. The same
   owner/key/content returns its original quote with its current status, including
   superseded/accepted. Different accepted content: 409
   `SOURCING_OFFER_KEY_CONFLICT`. A new key is an independent intended submission.
3. Reserve one operation with an atomic __v CAS, no existing operation and no
   matching receipt. Pin owner/buyer/actor, normalized input, quote/notification
   IDs, original commercial-state hash and pricing snapshot in that same write.
   Increment __v; do not add an active quote or supersede the previous quote.
4. Validate the intent/current commercial state and the original actor's current
   role, activity, membership and supplier ownership. Upsert the existing
   `sourcing_offer` notification type by the pinned ID using **$setOnInsert only**.
   Verify recipient/type/resource/timestamp and absence of an unrelated decision
   identity. Notification content is derived from type/resourceId virtuals; there
   is no new caller-supplied notification text or schema field. Never reset readAt.
5. Recheck the intent and authorization, then use one native document CAS to add
   the frozen quote/receipt/snapshot, supersede active quotes of that supplier
   only, recalculate the active count, increment __v and remove operation.
   Native publication deliberately preserves unknown historical quote fields
   that a full Mongoose array recast could drop. It is not a backfill.
6. After any lost write acknowledgement, reread the primary and verify the saved
   attempt/effect. Never infer success from E11000 or a timeout alone. A completed
   receipt replay performs no writes and never resumes a different pending offer.

Primary reads and `{w:1,j:true}` are used. No cross-document transaction or process
memory lock supplies correctness. Tested on standalone WiredTiger; no claim of
power-loss or replica-set failover/majority durability is made.

## API and DTO changes

- `POST /api/sourcing/:id/quote`: 400 for missing/invalid key before writes;
  200 confirmed quote (including replay); 202 saved intent still pending;
  503 `SOURCING_OFFER_UNCONFIRMED` when no result can be confirmed.
- 409 `SOURCING_OPERATION_PENDING` is a temporary conflict with another operation;
  retain key/input and retry later. It differs from content-key conflict and
  from a changed or closed commercial request.
- `POST /api/sourcing/:id/operations/:operationId/retry`: supplier/authorized
  staff owner only. No new input/key is needed: the saved intent is authoritative.
  It can also acknowledge an already-completed operation after the quote becomes
  superseded/accepted. Another supplier/buyer cannot resume it.
- All Sourcing reads/responses use explicit whitelists. Keys, hashes, submission
  receipts and the raw journal are not DTOs. Suppliers see only their own quotes;
  buyer contact/identity stay private. Published snapshots expose only permitted
  commercial data, including the price/quantity/unit/total/terms as priced.
- A safe `operation:{kind:sourcing_offer,phase:pending}` banner is visible to
  authorized request viewers. `offerRecovery:{operationId,input,startedAt,
  requiresReview}` is available only to its authorized supplier owner/colleagues
  while the intent's parent/buyer/actor-owner/snapshot identities agree. No keys
  or fingerprints are returned. Contradictory identity suppresses recovery data.
- Notifications may precede final publication. Their normal buyer-authorized
  destination opens the actual request with a pending banner; the new quote is
  absent, and accept/reject buttons and server decision writes are blocked.

## Size budget

Before reservation, calculate BSON size from the complete stored document,
including hidden S1 receipts and unknown legacy fields. Budget operation and the
final quote **simultaneously**, though final publication removes the operation,
plus **256 KiB** below MongoDB's **16 MiB** document limit. This covers bounded
retry fields, numeric/index-key growth and command framing. Repeat before final
publication. Too large before reservation: 413 `SOURCING_DOCUMENT_CAPACITY`, no
intent/notification and no history deletion. API writers are fenced while
pending, so only bounded metadata grows. Direct administrative changes outside
the protocol can invalidate the budget/baseline and require review; they are
never repaired by dropping historical offers.

## Recovery and monitoring

Both `backend/start.js` and `backend/workers/worker.js` start the Sourcing recovery
service. Default poll 5 seconds, batch 25 (hard cap 100), query/write bounds 10
seconds, exponential retry backoff capped at 60 seconds. An explicit authorized
retry can attempt recovery sooner. Multiple API/worker processes may complete
the same intent; stable IDs, verification and document CAS make that safe.

Stopping cancels future polls and waits up to 15 seconds for current work.
`drained:false` means the durable intent may still need another process/restart;
it does not mean failure or permission to erase it. A failed scan does not break
the shutdown drain. No TTL cancels an intent.

Transient failures retain pending and backoff. Validly identified contradictory
intents receive a safe error/backoff without changing commercial data. A damaged
intent identity that cannot be safely rescheduled remains untouched and is
reported. Unsupported kinds/versions are not executed automatically.

Operator review, **not run against the original database in this phase**:

```js
// Broad inspection must include malformed/null/unsupported operations too.
db.sourcingrequests.countDocuments({operation: {$exists: true}})
db.sourcingrequests.find({operation: {$exists: true}}, {
  _id: 1, 'operation.kind': 1, 'operation.version': 1,
  'operation.phase': 1, 'operation.startedAt': 1,
  'operation.attempts': 1, 'operation.nextAttemptAt': 1,
  'operation.lastErrorCode': 1
})
```

API/worker recovery logs contain safe codes and resource identifiers, not keys,
hashes, prices or raw errors. Review pending age, repeated CONFLICT, unavailable
scans and broad-operation counts. A revoked/departed original staff actor is not
silently replaced by a new actor. Its saved operation may stay blocked pending
an approved reconciliation decision; do not restore permissions merely to force
completion or overwrite ownership/price to clear the lock. Many malformed due
records can require intervention to avoid impeding bounded batch progress.

## Browser boundary

The supplier form holds one frozen attempt in component memory. It never stores
JWT, keys or terms in browser persistent storage. Unknown outcomes block modal
closure to retain the local key. Once the server supplies an operation ID, the
modal can close: reopening/refetching restores that owner's frozen saved input
and explicit retry action. No POST occurs on open/login. Account changes/unmount
abort or ignore late results; the record is tied to its loaded session.

Refreshing/closing before learning whether reservation committed can lose the
local key. A saved operation is recoverable from the server; an unrecorded/lost
key cannot be reconstructed by matching price/text/time. Review offer history
before explicitly creating a new attempt. A new key intentionally permits a
different offer. This is not automatic browser recovery after losing all local
attempt information.

## Deferred activation and safe rollback

1. Obtain operational approval, verify recovery artifacts and target privately.
   Do not run original database queries or deployment commands as part of S2.
2. Verify/provision the **S1** index through its separately approved procedure.
   S2 correctness needs no new index; an optional recovery-scan index is a later
   performance decision, not provisioned or required here.
3. Coordinate all writers and clients. Do not run old S1 quote/decision writers
   alongside S2: they ignore the pending guard and may serialize private fields.
   Upgrade every known offer client to send the required key and handle 202.
4. After activation approval only, start compatible API/workers and perform
   separately approved synthetic smoke checks. No such original activation ran.
5. Before rollback, stop new quote/decision traffic and keep compatible recovery
   alive. Inspect **all** operation fields, including unsupported/corrupt ones.
   Drain them or retain a compatible worker, guard and DTO layer. A persistent
   outage/conflict means rollback must wait for an approved plan.
6. Never restore S1 verbatim while S2 data exists: even after draining pending,
   embedded submission keys/snapshots require DTO redaction and original-attempt
   replay support. Preserve receipts, snapshots, notifications/readAt and the S1
   index. Do not delete journals/history or force terminal status to permit a
   rollback. RFQ recovery protocols remain required and unchanged.

**S3 remains necessary:** buyer accept/reject still saves its decision then its
notification through the prior path. S2 adds the pending conflict guard only;
it does not repair lost acknowledgement/partial decision effects for that path.
