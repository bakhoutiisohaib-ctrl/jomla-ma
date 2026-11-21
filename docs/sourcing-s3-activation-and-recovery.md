# Sourcing S3: activation, recovery and rollback (not executed on original DB)

S3 adds optional versioned `sourcing_decision` intents, per-quote `decisionReceipt` and acceptance `agreement` within SourcingRequest. No new index, migration, backfill, collection or notification type is required. S1's unique partial index remains a separate **unexecuted** original-environment prerequisite. The original environment has not been inspected, activated or certified.

## Contract and guarantees

`PUT /api/sourcing/:id/quotes/:quoteId/action` retains `{action:accept|reject}`; no new Idempotency-Key is required. The authenticated owning buyer + request + quote identify the decision, with the first action immutable. A completed replay returns200/processing:false and its current quote/receipt summary without effects. A pending replay joins the same intent. The opposite action returns409/SOURCING_DECISION_ACTION_CONFLICT. Receipt lookup precedes parent/quote status and pending-operation checks, so an old receipt cannot advance a newer intent.

The CAS reservation fixes buyer/actor, supplier owner, quote, action, snapshot/source, stable operation/notification IDs, expected version and commercial baseline. It changes neither quote status nor parent status. S2 and S3 reservations require no operation and use the same commercial revision; competing claims cannot both succeed. S2 replay remains compatible and may return an old submission without advancing a later decision. Neither protocol has been merged with RFQ.

The decision handler checks kind/version/phase/identity, current buyer eligibility and frozen commercial state before effects and publication. It upserts the supplier notification by stable `_id`, rereads from primary and verifies recipient, sourcing_decision type, sourcing resource, parent, timestamp and absence of an unrelated RFQ decision reference. Notification title/body are existing virtuals derived from type/resource, not free client text; no new action-specific content is invented. `$setOnInsert` preserves readAt. Pending notification targets resolve to the authenticated existing request and display finalization in progress.

One native commercial CAS then writes decisionReceipt and, for acceptance, agreement; updates quote statuses/count and parent; and removes operation. Existing unknown historical quote fields are preserved. Acceptance sets fulfilled (=offer selection only), accepted quote, other active superseded, count0. Rejection affects only that quote, retains the prior open/quoted status and other active quotes, and recalculates count. No payment, order, shipment, conversation or contact entitlement is created.

S2 snapshots remain authoritative even when request fields change before the decision. New decisions on eligible legacy active quotes freeze only currently available fields with source `legacy_sourcing_quote_at_decision`. Completed historical quotes without a receipt return409 on attempted replay, with no guessed receipt/effect. `startedAt`, receipt.decidedAt and agreement.agreedAt identify the fixed decision reservation time; final200 follows verified publication, not that timestamp alone.

200 confirms completion;202 means saved and pending, never final success;503 is unconfirmed, retry the same action.409 operation pending is distinct from opposite action/commercial corruption.413 before claim means no intent/notification was stored. All reads use explicit DTOs: buyer recovery is owner-only, supplier recovery stays supplier/staff-only, raw receipts/keys/hashes/journals and competitor quotes remain hidden. Agreement DTO does not expose buyer contact/identity to suppliers.

## Recovery and monitoring

The existing API and worker loop dispatch explicitly on kind/version1 to **separate** offer and decision handlers. Durable Mongo state, primary rereads, CAS and stable effect IDs provide correctness; local tick coalescing is only scheduling. The existing batch25/cap100,5s polling, exponential backoff capped60s,10s DB operation bounds and15s shutdown drain apply to both kinds. An intent is never erased by time or forced through an ownership/price conflict.

`POST /api/sourcing/:id/operations/:operationId/retry` dispatches by authenticated actor, then checks the corresponding saved kind/identity. The owner buyer can resume decisions only; supplier/admin/authorized staff can resume their offer only. Retry bodies cannot change saved price or action. Completed old-operation receipt replay does not resume the current operation.

Before any future activation, with separate owner approval:

1. Validate S1 index using its existing check/provision procedure; do not infer its presence from schema/autoIndex.
2. Inventory deployed API/worker versions and ensure all support S1/S2/S3 before accepting traffic; mixed old writers are unsafe.
3. Verify Mongo supports acknowledged journaled writes (`w:1,j:true`); no multi-document transaction is assumed. Replication/failover/disk-loss guarantees need deployment-specific validation.
4. Establish read-only operational monitoring for **all** documents with operation, not just valid worker scan candidates: kind/version/age/attempts/nextAttemptAt/safe error code, using restricted tooling. Do not log keys, hashes, raw snapshots, phone numbers or credentials.
5. Escalate unsupported kind/version, identity/price conflicts, revoked original buyer/actor, oversized documents and persistent failures. Correct only through a separately approved case-specific plan. Do not automatically reassign actors, change terms, delete history or clear intent.

The original pending count is unknown: no query was made. A bounded sorted scan without a recovery index can become expensive as catalog/history grows. Persistent contradictory records may repeatedly occupy batch slots. An index/scan strategy or separate storage design needs measurement and approval later; it is not silently enabled here.

## BSON and client retention

Before reservation and again before notification/publication, calculate the full raw BSON document (including hidden S1 receipt and unknown fields) with pending intent **and** resulting receipt/agreement together. Refuse beyond16MiB minus256KiB. The conservative reserve covers bounded retry metadata, command framing and numeric growth. No historical array is trimmed. Out-of-band growth after claim can still hold an intent pending; that is an operational conflict, not permission to force completion.

The buyer UI keeps uncertain quoteId/action in memory only, freezes alternate decisions, retries the same natural action or saved operation ID, and restores saved recovery on authenticated reads. No automatic decision POST on mount/login; no JWT or extra attempt payload is stored on disk. Refresh before a known saved intent may lose in-memory context; authenticated history/receipts remain authoritative. Account/session changes and unmount abort/ignore late results. Closing/reopening a persisted decision requires no new decision creation.

## Safe rollback

The verified R4-0 recovery remains immutable; the S3 limited backup is external and SHA-verified. Restoring source alone is **not** a safe live rollback after intents or new receipts exist.

For any later rollback: stop new Sourcing business writes first; inventory all operations and new receipts with authorized read-only tooling. Drain healthy S2/S3 intents with compatible handlers. Keep the S3 worker/handler available for every pending S3 intent, or leave writes disabled while an approved recovery plan handles conflicts. Never deploy S2/legacy decision writers over pending S3 intents, and never erase receipts/agreements to make old code accept the data. Even after draining, legacy writers could undo receipt/idempotency semantics; rollback must retain the S3 guards and replay behavior or keep affected writes disabled. Preserve every current source/untracked file and evidence before restoration. No rollback, original DB check or activation was executed in this phase.
