# Sourcing S1 — deferred index activation and rollback

This procedure is prepared only. It was exercised on disposable MongoDB tests;
it has **not** been run against the project's original database.

## Exact prerequisite

Collection: `sourcingrequests`.

```js
{ key: { buyerId: 1, 'creationReceipt.key': 1 },
  name: 'sourcing_creation_buyer_key', unique: true,
  partialFilterExpression: { 'creationReceipt.key': { $type: 'string' } } }
```

Use simple/binary collation (the default on a normal collection). Runtime
verification rejects a non-simple collation, sparse/non-unique indexes, a
different name, key order/direction or partial filter. An operator must review
a collection with a different default collation separately before provisioning.

The definition lives in `backend/services/sourcingCreationIndex.js`, deliberately
outside Mongoose's automatic schema index registration. Neither startup nor the
create/lookup endpoint creates this index. There is no `syncIndexes`, migration,
backfill or automatic removal/replacement of existing indexes.

## Activation after separate operational approval

1. Verify the target host/database privately and the tested recovery copy. Plan
   a coordinated API/client activation; do not run old creation writers alongside
   the new protocol. Old servers ignore keys. Old clients receive 400 from the
   new required-key endpoint; update all external clients before activation.
2. Provide the target URI through the process environment `SOURCING_INDEX_URI`,
   outside command history/logs. The script never loads `.env`. Do not print the
   URI. Set the explicit database argument to the database in that URI.
3. Read-only preflight, from the repository root:

   ```text
   node backend/scripts/sourcingCreationIndex.js --check CONFIRMED_DATABASE
   ```

   Exit 0/`ready:true`: exact index present. Exit 2/`ready:false`: prerequisite
   absent or mismatched. Exit 1: inspection failed; investigate privately.
4. Only after approval to change that target, the **separate** creation command is:

   ```text
   node backend/scripts/sourcingCreationIndex.js --create CONFIRMED_DATABASE
   ```

   This creates only a missing named index, verifies it, and never repairs/drops
   a mismatched one. Existing duplicates, conflicting indexes, permissions or
   collation may block creation. Stop and obtain an explicit remediation plan;
   never delete/merge historical requests automatically. Review large-index
   build impact on the actual MongoDB deployment first.
5. Repeat `--check`, start all updated API writers, and verify with separately
   approved synthetic smoke data. Do not declare protection active until index
   verification succeeds. No such original-environment steps ran in S1.

## API contract

- Buyer-authenticated `POST /api/sourcing` requires `Idempotency-Key` matching
  `[A-Za-z0-9_-]{16,128}`. Missing/invalid: 400 before insertion.
- New insert: 201. Recovered/replayed insert: 200. Both return
  `{message, sourcing, replayed}`; sourcing is its **current** commercial state.
- Same owner/key with different normalized accepted inputs: 409. New key permits
  an identical independent request. Identity/name/status/quotes sent by a client
  are never accepted as creation authority.
- `GET /api/sourcing/creation-result` uses the same header and buyer authentication,
  never a query-string key. It is registered before `/:id`. A 404 is an observation,
  not proof that a concurrent/previous write cannot complete. Retry the original
  POST with the same key and frozen input; never infer a fresh attempt from 404.
- Missing/mismatched/unreadable prerequisite: create returns 503 with
  `SOURCING_CREATION_INDEX_REQUIRED`. An uncertain write/read returns 503 with
  `SOURCING_CREATION_UNCONFIRMED`. Lookup is read-only and can recover an existing
  valid receipt even when the creation gate is closed; contradictory receipts
  fail closed. Receipts/keys/hashes are excluded from all sourcing DTOs and logs.
- No changes to quote submission or buyer decisions. They do not require this
  creation key. Their S2/S3 consistency gaps remain outside S1.

The receipt is optional and inserted atomically with a new request. Historical
documents without one remain untouched. The service reads the primary with
binary key comparison and requests `{w:1,j:true}` on insertion; no cross-document
transactions, extra effects or recovery worker. Durability still depends on
storage/journal health; this is not an infrastructure disaster-recovery guarantee.

## Client recovery boundary

The modal holds at most one frozen attempt in this tab's memory, isolated by
buyer identity. Close/reopen retains it; account switching removes it. No JWT or
contact/input copy is persisted to disk. POST and lookup are user actions only.
An unresolved form stays frozen, including after lookup 404. Before refreshing
the page, closing the tab or changing account, resolve the attempt if possible:
those boundaries lose the local key. Review buyer history after such a loss;
the client cannot automatically recover a key it no longer has. A new explicit
key intentionally represents a new request, even for identical content.

## Safe rollback

S1 has no server-side pending-effects journal or worker to drain. A persisted
request and its creation receipt are the same single write. Stop new creation
traffic before rollback, and preserve receipts/index/owner-scoped lookup and
DTO redaction. Retain the idempotent backend adapter for old unresolved client
attempts; do not restore an old writer that ignores keys or serializes receipts.
Rolling back a client to a version without keys safely blocks creation (400),
but is not a functioning compatibility rollout. Do not drop the index, remove
receipts or rewrite requests. Prior RFQ deciding/recovery workers remain required
and unchanged; S1 rollback must not roll those earlier phases back.
