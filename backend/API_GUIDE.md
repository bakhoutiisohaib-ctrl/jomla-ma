> وثيقة تاريخية سابقة للإصلاحات. راجع [دليل التشغيل الحالي](../docs/OPERATIONS.md) و[تقرير الإصلاحات](../reports/remediation-2026-10-19.md). عقود الصلاحيات والنشر والمصادقة تغيرت.

# دليل الـ API - Jomla.ma 🇲🇦

## المصادقة والأمان

جميع الطلبات التي تتطلب المصادقة تحتاج على `Authorization` header بـ JWT token:

```
Authorization: Bearer <your_token_here>
```

---

## المورّدين (Suppliers)

### تسجيل مورد جديد
```
POST /api/suppliers/register
Content-Type: application/json

{
  "name": "متجر المورد",
  "email": "supplier@example.com",
  "password": "password123",
  "city": "فاس",
  "phone": "+212612345678",
  "description": "وصف المتجر"
}

Response:
{
  "message": "✅ تم تسجيل المورد بنجاح",
  "token": "eyJhbGc...",
  "supplier": { ... }
}
```

### تسجيل الدخول
```
POST /api/suppliers/login
Content-Type: application/json

{
  "email": "supplier@example.com",
  "password": "password123"
}

Response:
{
  "message": "✅ تم تسجيل الدخول بنجاح",
  "token": "eyJhbGc...",
  "supplier": { ... }
}
```

### جيب جميع المورّدين
```
GET /api/suppliers

Response:
[
  {
    "_id": "...",
    "name": "المتجر",
    "city": "فاس",
    "phone": "+212612345678",
    "description": "...",
    "products": ["pid1", "pid2"]
  }
]
```

### جيب مورد معين
```
GET /api/suppliers/:id

Response:
{
  "_id": "...",
  "name": "المتجر",
  ...
}
```

### جيب منتجات مورد
```
GET /api/suppliers/:id/products

Response:
[
  { product1 },
  { product2 }
]
```

---

## المنتجات (Products)

### جيب المنتجات (مع pagination)
```
GET /api/products?page=1&limit=50

Response:
{
  "products": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1000,
    "pages": 20
  }
}
```

### إضافة منتج جديد (يتطلب المصادقة)
```
POST /api/products
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "حذاء رياضي",
  "category": "أحذية",
  "price": 250,
  "city": "فاس",
  "supplierPhone": "+212612345678",
  "description": "حذاء رياضي عالي الجودة"
}

Response:
{
  "message": "✅ تم إضافة المنتج بنجاح",
  "product": { ... }
}
```

### تحديث منتج (يتطلب المصادقة)
```
PUT /api/products/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "حذاء رياضي محدّث",
  "price": 300
}

Response:
{
  "message": "✅ تم تحديث المنتج بنجاح",
  "product": { ... }
}
```

### حذف منتج (يتطلب المصادقة)
```
DELETE /api/products/:id
Authorization: Bearer <token>

Response:
{
  "message": "✅ تم حذف المنتج بنجاح"
}
```

### البحث الذكي
```
GET /api/products/search?q=حذاء رخيص في فاس&page=1&limit=40

Response:
[
  { product1 },
  { product2 },
  ...
]
```

---

## البحث الذكي (AI Search)

### البحث باستخدام Claude AI
```
POST /api/ai-search
Content-Type: application/json

{
  "query": "أريد أحذية رخيصة الثمن",
  "city": "فاس",
  "category": "أحذية"
}

Response:
{
  "message": "✅ البحث نجح",
  "products": [ ... ],
  "aiResponse": {
    "suggestions": ["حذاء رياضي", "صباط كلاسيك"],
    "message": "حذيتلك على الأحذية الموجودة..."
  }
}
```

---

## البحث بالصور

### البحث عن منتج باستخدام صورة
```
POST /api/image-search
Content-Type: multipart/form-data

form_data:
  image: <image_file>

Response:
{
  "message": "✅ تم تحليل الصورة",
  "labels": ["صباط", "أحذية"],
  "products": [ ... ],
  "description": "وجدنا 5 منتج مشابه لـ: صباط، أحذية"
}
```

---

## تحسين الصورة والوصف (Product AI)

### تحسين الصورة وتوليد وصف احترافي (يتطلب المصادقة)
```
POST /api/product-ai/enhance
Authorization: Bearer <token>
Content-Type: multipart/form-data

form_data:
  image: <image_file>
  productName: "حذاء رياضي أسود"
  category: "أحذية"

Response:
{
  "message": "✅ تم تحسين الصورة وتوليد الوصف",
  "originalImage": "https://...",
  "enhancedImage": "https://...",
  "publicId": "jomla-ma/...",
  "aiData": {
    "title": "حذاء رياضي أسود خفيف الوزن",
    "description": "حذاء رياضي عالي الجودة...",
    "keywords": ["حذاء", "رياضة", "أسود"],
    "suggestedPrice": "200-350 درهم",
    "tips": "صور الحذاء من جوانب مختلفة..."
  },
  "similarImages": [ ... ]
}
```

---

## التقييمات (Reviews)

### جيب تقييمات مورد
```
GET /api/reviews/:supplierId?page=1&limit=20

Response:
{
  "reviews": [
    {
      "supplierId": "...",
      "stars": 5,
      "comment": "ممتاز جداً",
      "date": "2026-04-21T..."
    }
  ],
  "avg": 4.5,
  "total": 10,
  "pagination": { ... }
}
```

### إضافة تقييم
```
POST /api/reviews
Content-Type: application/json

{
  "supplierId": "...",
  "stars": 5,
  "comment": "تجربة رائعة جداً"
}

Response:
{
  "message": "✅ شكراً على تقييمك!",
  "review": { ... }
}
```

---

## التتبع (Tracking)

### تسجيل مشاهدة منتج
```
POST /api/tracking/view/:id

Response:
{
  "message": "✅ تم تسجيل المشاهدة",
  "views": 42
}
```

### جيب المنتجات الأكثر مشاهدة
```
GET /api/tracking/trending?limit=8

Response:
[ ... ]
```

---

## الأخطاء (Error Handling)

جميع الأخطاء ترجع بصيغة موحدة:

```json
{
  "message": "❌ رسالة الخطأ",
  "errors": [
    {
      "field": "email",
      "message": "البريد الإلكتروني غير صحيح"
    }
  ]
}
```

### رموز الأخطاء الشائعة:
- `400` - بيانات غير صحيحة
- `401` - غير مصرح (توكن مفقود أو غير صحيح)
- `403` - ممنوع (ليس لديك صلاحية)
- `404` - غير موجود
- `409` - تضارب (البريد موجود بالفعل)
- `500` - خطأ في السيرفر

---

## المصادقة والحماية ✅

✔️ جميع كلمات المرور مشفرة بـ bcrypt
✔️ المصادقة بـ JWT tokens (صلاحية 7 أيام)
✔️ التحقق من البيانات المدخلة
✔️ معالجة شاملة للأخطاء
✔️ CORS محمي
✔️ التحقق من الصلاحيات (يمكن المورد فقط تعديل منتجاته)

## StrictDraftPrivacy — Phase A, updated by Phase C1 (20 October 2026)

- `POST /api/product-ai/upload` and `/enhance` register immutable `MediaAsset` ownership before returning `imageUrl`. The existing `/uploads/<filename>` value is now an opaque reference, not a publicly readable URL.
- Read bytes using `GET /api/media/<filename>`. Phase C1 permits requests without JWT for a registered asset actually referenced by a currently public product owned by the asset owner, in that owner's approved active store and under an active supplier account. Main and secondary references qualify. Phase C2 also permits a registered same-owner asset explicitly linked as the logo of an eligible public store. Private reads require `Authorization: Bearer <JWT>`. Do not put JWTs in URLs. `HEAD` uses the same checks.
- An owner and currently authorized `manage_products` staff in the recorded organization can read private and unattached assets. Admins have explicit moderation access. Other authenticated accounts can read only images attached to a currently visible catalog product belonging to the asset owner.
- The old `/uploads/*` HTTP path always returns 404. For requests without Authorization, unavailable/private/unregistered references return 401 without image bytes. A valid authenticated account denied an asset receives 404. Supplied invalid/expired/revoked credentials return 401 even for public references; they do not silently become a private identity. Success and errors use `Cache-Control: private, no-store` and `Vary: Authorization`, without ETag or Last-Modified reuse.
- Product writes validate every `imageUrl` and `images` entry. Foreign, unmanaged, external HTTPS/HTTP, data, and alternate media paths are rejected with 400. Legacy records/files are not adopted or published automatically; reupload through the authenticated endpoint after human review.
- Frontends fetch bytes with Bearer when signed in and without credentials as visitors, then display a temporary Blob URL. They revoke old URLs on session/source changes, logout, backgrounding and revalidation. Logout can load a fresh anonymous copy only if the server still authorizes public access. A normal `<img src="/uploads/...">` does not work.
- Local visual indexing, AI jobs and restore use the same registry and immutable byte fingerprint. Backups include `mediaassets` and original files together; file-only restore cannot establish ownership.
- See [Phase A remediation report](../reports/phase-a-media-privacy-remediation.md) for local evidence and remaining hosted verification.

### Phase C1 public-catalog contract

- Public eligibility is checked live on every media request, including HEAD, Range and conditional requests. Unpublishing, hiding, deletion, withdrawing publication/rights/availability, suspending the store or deactivating the supplier prevents subsequent anonymous reads. Files remain private for authorized owners/staff/admins according to Phase A; no ownership is transferred by a public URL.
- A shared asset remains public while at least one eligible same-owner product actually references it. A draft reference alone is insufficient. A mismatched store belonging to another supplier cannot authorize the asset. Existing unregistered/external images are not adopted, migrated or published.
- Public bytes deliberately retain no-store rather than a CDN/public max-age policy. A loaded browser Blob is checked every 15 seconds in a visible tab and on foregrounding; the next HTTP request enforces revocation immediately. Already downloaded bytes/screenshots cannot be withdrawn from an external recipient.
- No anonymous persistent-upload endpoint was added. Existing local visual search uses a bounded in-memory multipart query and existing rate limits; this is separate from saving a managed product image. See [C1 report](../reports/phase-c1-public-catalog-media.md) for the tested scope and limits. RFQ/agreements are unchanged.

## RFQ decision consistency — Phase B (20 October 2026)

- Existing `PUT /api/rfq/:id/action` still requires the active owning buyer and `{ action: 'accept' | 'reject', offerId }`. Only the current active, unexpired offer can start a decision. An older/superseded offer or conflicting decision returns 409.
- The first successful claim atomically saves `status: 'deciding'` and `decision` on the RFQ, including a server-captured commercial agreement for acceptance. Once saved, offer changes, new messages and a different decision are refused. The same `(rfqId, offerId, action)` is safe to replay, including after completion; no extra idempotency header is needed.
- `200 { message, rfq, processing: false }` means all decision effects are verified: the offer has its final status, the thread is closed with one decision message, and one supplier notification is stored. `202 { message, rfq, processing: true }` means the decision is durably recorded and still being completed; it must not be rendered as final acceptance. A failure before durable intent may return 500: refresh and retry the same tuple.
- Automatic recovery starts with both the API and external worker. It scans only version 1 pending decisions; it never guesses repairs for legacy accepted/rejected records without this journal. Concurrent replay is supported. This is eventual consistency with a durable single-document journal, not a multi-document transaction.
- New offers contain immutable `productSnapshot` and `supplierSnapshot`; `rfq.offer.productSnapshot` exposes the selected offer's product context before acceptance. `rfq.decision.agreement` freezes price, total, quantity, currency, unit, delivery days, terms, notes, product definition and participants. It contains no image references and grants no media access. A new decision on a legacy offer explicitly uses `source: 'legacy_product_at_decision'`; missing product identity blocks acceptance instead of inventing it. Existing agreements are not backfilled.
- `GET /api/rfq/:id/thread` adds `rfq` to the existing `{ thread, offers }` response. RFQ list/detail responses include the additive `decision` field and new `deciding` status. Consumers must tolerate populated or unpopulated product references and use the frozen agreement for accepted values.
- See [Phase B report](../reports/phase-b-rfq-consistency.md) for failure tests, storage requirements and remaining limits.

## Public product/store pages — Phase C2 (20 October 2026)

- Client URLs: `/products/<ObjectId>`, `/stores/<ObjectId>` and the existing supplier view at `/suppliers/<ObjectId>`. IDs remain stable when names/slugs change. `/stores`, `/login`, `/register`, `/buyer`, `/supplier`, `/admin` and `/` retain their current functions. SPA document fallback belongs to the frontend host, not an API or uploads fallback.
- New `GET /api/products/:id` returns `{ product, store }` for a currently eligible public product and its eligible same-owner store/active supplier. Product fields follow `PUBLIC_FIELDS`; supplier/store fields are explicitly public. Draft/hidden/deleted/unavailable products and ineligible stores/owners return 404 even with owner/admin credentials. Private editing remains on authenticated `/products/mine` and existing write routes. Malformed ids return400.
- `GET /api/stores/:id` retains `{ store, products }` and adds `pagination`. It accepts `q`, `page`, `limit` (up to100; default100 for compatibility). The client requests12. Search and pagination are restricted to this store and its owner; query filters cannot escape that scope. Unapproved/inactive/admin-suspended stores or inactive/non-supplier owners return404. Public store listing applies the same store eligibility.
- Public stores now project `name, slug, description, city, address, phone, logoUrl, categories, supplierId, createdAt` and `_id`. They omit organization/review/internal records, rating defaults and private supplier documents/email. Authenticated owner `/stores/mine` is unchanged. Clients depending on formerly exposed internal fields must use their authorized owner/admin API.
- A nonempty logoUrl on store creation/update must be a registered readable same-owner asset, validated by the existing media ownership checks. Old remote/unmanaged/foreign logo values remain stored but are omitted from public DTOs. Eligible store logos can be read via `/api/media`; banners and unattached files do not gain this exception. Removing the logo link, suspending the store or deactivating its supplier revokes this public reference on the next request, unless another valid public reference independently exists.
- Public detail JSON uses no-store; the client rechecks details every30 seconds in a visible tab and on return. Image byte checks and Blob cleanup keep the15-second C1 cycle. Acceptance/agreements/RFQ payloads and permissions are unchanged.
- Login may carry an internal `returnTo`, checked against known public routes or the account's own workspace. A guest product RFQ action returns a buyer to the product and opens the existing RFQ form after authentication; no request is sent automatically. Sharing uses the canonical public page URL without credentials or RFQ intent.
- See [routing/hosting notes](../docs/ROUTING_PUBLIC_PAGES.md) and [C2 report](../reports/phase-c2-routing-product-store-pages.md). No hosted deployment or guaranteed WhatsApp preview is included.
# R1: safe product creation retries (2026-10-22)

`POST /api/products` accepts `Idempotency-Key: <16–128 ASCII letters, digits, _ or ->`.
The Atlas editor generates one cryptographically random key per creation attempt,
keeps the exact submitted JSON in memory, and resends that pair after an uncertain
response. Do not generate a fresh key for a retry. A separate new product uses a
new key. `PUT /api/products/:id` is unchanged.

The identity is scoped to the live authorized supplier owner; the fingerprint also
binds the submitting actor and accepted input (including explicit rights and
publication consent). Equal retries return **201**, the original product snapshot,
current `visualIndex` recovery status and `creation: { replayed: true }`; the first
response has `replayed: false`. Different input/actor with the same owner/key returns
**409** without changing the product. Key metadata is private and never returned.
An invalid supplied key returns **400**. Old clients omitting the header remain
compatible, but do not receive retry de-duplication. An absent/incompatible unique
index returns **503** for keyed creation; never fall back to an unkeyed retry.

The optional internal Product `creationReceipt` and partial unique index
`product_creation_owner_key` (`supplierId`, `creationReceipt.key`, filtered to string
keys) are written with the product in one insert. Existing products need no
backfill. With `autoIndex: false`, an operator must create this exact declared
index before keyed creation; this development task runs it only on isolated test
databases. It requires no Mongo multi-document transactions. Supplier membership
is recovered with `$addToSet`; creation indexing uses `creation:<productId>` and
the existing durable queue's unique key. An indexing outage is reported in
`visualIndex`; replay can recover an enqueue gap but does not bypass exhausted
worker retry/permission rules or enqueue a second job.

Receipt retention lasts for the product's lifetime. Intentional hard deletion
removes its receipt; an old POST must not be reused after deletion. Reloading or
closing the editor loses its in-memory attempt (no private form is persisted in
browser storage); inspect the supplier's products before starting a fresh attempt.
Recovery requires the original key/body and a currently authorized session. It
never republishes or overwrites a subsequently edited product; media bytes still
use current A/C1 authorization even when the original snapshot contains an image
reference. A reported accepted creation does not guarantee indexing completion.

Rollback: restore the scoped pre-R1 source copies recorded in
`reports/phase-r1-evidence/recovery-point.json`, keep existing product documents and
receipts, and keep the additive index. No data deletion or index removal is needed
for code rollback. Old code loses the retry guarantee. Do not roll back while an
editor is reconciling an uncertain request; retain its key/body and reconcile first.

## R2: RFQ creation and conversation recovery (2026-10-22)

`POST /api/rfq` accepts the same safe `Idempotency-Key` syntax as R1. The current
RFQ modal always supplies a random key and freezes the submitted JSON until its
result is confirmed. The namespace is the live authenticated buyer. Reusing a key
with different normalized accepted input returns409. The original supplier,
currency, conversation subject and first-message content come from the initial
authorized capture, never a later product edit or forged client identity.

The initial QuoteRequest insert stores a private version1 `creation` journal,
stable thread/notification ids, status `creating` and revision-1. A partial unique
index `rfq_creation_buyer_key` on `(buyerId, creation.key)` prevents duplicate
requests. All creation writes request `writeConcern: {w:1,j:true}`. Conversation
and notification use their fixed `_id`s with `$setOnInsert`; replays preserve
messages, closed state and notification `readAt`. Only after verifying both effects
does the RFQ become `pending`, revision0 and `creation.phase=completed`. Phase B's
subsequent revision/decision protocol is unchanged.

- **201**: `processing:false`, owned `rfq`, `threadId`, and
  `creation:{version:1,phase:'completed',replayed:boolean}`. Replaying after later
  negotiation returns that same request's current business status; it never
  rewinds an accepted request or reopens its conversation.
- **202**: `processing:true`, `rfq.status='creating'`, safe creation summary with
  `phase:'pending'`; no ready `threadId`. The request exists but is not ready to
  negotiate. Do not display an "RFQ sent" confirmation yet.
- **POST `/api/rfq/:id/creation/retry`**: authenticated owning buyer only, no body
  required. Reconciles the saved R2 intent and returns the same201/202 contract;
  never creates another RFQ. Another buyer or supplier gets403. Historical requests
  without a version1 journal get409, with no inferred conversation creation.
- **GET `/api/rfq/buyer`** includes `creating` records for history recovery.
  Supplier listing excludes them until ready. Party-authorized thread reads return
  202 with `thread:null` while creating. Existing response/message/decision guards
  block negotiation in that state. Internal keys/hashes/journals are never returned.

The creation recovery runner starts with `backend/start.js` and the standalone
worker, scanning only new `creating/version1/pending` intents every5 seconds,
25 records per scan, backing off failures up to60 seconds. It completes previously
authorized effects without creating new customer requests or requiring the browser
to remain open. Multiple runners and explicit retries are safe together. Disable
neither runner in a future deployment without providing an equivalent recovery
process; importing `server.js` alone does not start runners.

No original database migration was run. Historical records have no creation
journal and are outside the new partial index and recovery scan. With autoIndex
disabled, create the declared unique partial index before accepting RFQ creation;
the API verifies its exact coverage and returns503 if unavailable. Legacy clients
omitting the header retain basic compatibility and get a server-generated durable
intent, but must use the returned RFQ id/history to recover: resending an unkeyed
POST cannot correlate a lost acknowledgement and may create another request.

The modal's key/body stay in memory and are cleared on account change. An unknown
response blocks edits/close and offers explicit retry; a202 with a known id can
also be closed and resumed from buyer history after refresh. Browser reload may
lose the key, so inspect existing requests before opening a fresh attempt. No JWT
or private RFQ body is put in a URL or new browser storage. There is no automatic
RFQ submission on login, mount or background reconciliation.

Rollback must first drain or pause/review pending R2 intents. Restore only the
scoped files in `reports/phase-r2-evidence/recovery-point.json`, preserving additive
fields/indexes and all request data. Old UI/API code does not understand `creating`;
never remove its journal or force it to pending as a rollback shortcut. No data
deletion, guessed historical repair or index removal is part of R2.
# R3 — supplier RFQ offer submission (standalone MongoDB)

`PUT /api/rfq/:id/respond` with a new/replacement offer accepts an optional
`Idempotency-Key` (16–128 ASCII letters, digits, `_`, `-`). Updated Atlas clients
always provide a cryptographically generated key and retain the original body
until the result is confirmed. Scope is **RFQ + supplier owner**, shared with
currently authorized `manage_rfq` staff; actor attribution is captured once.
Unkeyed legacy clients still work, but cannot recover a lost response by their
own retry. Supplier refusal (`status: rejected`) retains its previous behavior,
is outside R3, and does not accept this offer key.

Accepted offer fields: `unitPrice > 0`, integer `deliveryDays >= 1`,
`paymentTerms` (trimmed, max 2000), `notes` (trimmed, max 5000), optional
`validUntil` (ISO date). Optional `quantity` and `currency` must equal the RFQ;
they cannot change the buyer's requested quantity/currency. Product unit and
commercial snapshots come from the owned product, never caller-supplied data.
The canonical accepted payload is hashed. Changed valid input under the same
key returns409; invalid/mismatched quantity or currency returns400.

- **200**: confirmed terminal submission. Existing `rfq` and `offer` fields are
  retained, with `processing:false` and `submission:{version:1, phase:
  completed|expired, offerId, replayed}`. Replay returns that original offer and
  the RFQ's **current** business state, even after replacement/acceptance.
- **202**: durable intent exists, still finalizing. `processing:true`,
  `submission.phase:pending`; RFQ stays `offering`. Neither the old nor the new
  offer can pass Phase B's existing `responded/currentOfferId/revision` guard.
- Unknown network/5xx result does not establish failure. Explicitly repeat the
  PUT with the same key/body; do not invent another key.
- `POST /api/rfq/:id/offers/retry`, restricted to the owning supplier/authorized
  staff, resumes only saved intent. Optional `{offerId}` pins recovery to the
  original receipt, including if another staff member has since replaced it.
  It never creates a fresh quote from client-supplied commercial data.
- GET `/:id/thread` exposes a supplier-only `offerSubmission` pending summary
  with original input/offerId (no key/hash). Buyer sees `offering` and
  `preparing` display states, without a recovery command or internal journal.

RFQ `offerSubmission` and QuoteOffer `submission` are private, versioned fields.
No historical records are inferred or migrated. New offers start `preparing`.
RFQ reservation is a single atomic CAS; stable offer/message/notification IDs
are stored in it before any separate effect. Effects are idempotent and verified.
Commit is chosen atomically after core effects are durable. Previous-offer
retirement and receipt precede the final RFQ pointer/status publication.

Before commit, expiry preserves the old pointer, snapshot and active offer. An
expired attempt's message/notification may remain in history; its receipt says
expired and it cannot be accepted. After the durable commitment, recovery must
finish the chosen replacement even if expiry subsequently passes; Phase B's
unchanged live expiry check prevents acceptance and a new quote is then needed.
No timeout automatically discards the intent or reopens a decided conversation.

All protocol writes use `{w:1,j:true}`, maxTimeMS10000. This provides local
journal durability on a healthy standalone, not multi-document transactions or
protection against losing/rolling back the database files. Persistent outages,
missing/corrupt journals or conflicting projections need operational review.

## R3 index preparation when autoIndex is disabled (future deployment only)

No command below was applied to the original project database. Before enabling
R3 traffic, provision and verify the schema's exact index definitions:

```javascript
db.quoteoffers.createIndex(
  {rfqId:1, supplierId:1, 'submission.key':1},
  {name:'rfq_offer_submission_key', unique:true,
   partialFilterExpression:{'submission.key':{$type:'string'}}})
db.quoterequests.createIndex(
  {'offerSubmission.version':1,'offerSubmission.phase':1,
   'offerSubmission.nextAttemptAt':1,_id:1}, {name:'rfq_offer_recovery'})
```

New submission/retry checks the unique index's keys, uniqueness, partial filter,
sparse flag and collation; missing/mismatched protection returns503. The partial
filter excludes historical unkeyed offers. Preserve existing R2/Phase B indexes.
Monitor `offering` and pending/committing/aborting age, attempts and error codes.
Back up journals, offers, threads and notifications together.

Rollback: disable new submissions, drain/review every outstanding R3 journal,
confirm final pointers and effects, and preserve receipts/indexes. Restoring
older code without draining leaves `offering` unsupported and removes key
protection for retries. Do not clear journals or delete offers to force recovery.
The scoped pre-R3 source backup is documented in the R3 report; no data rollback
or migration is automatic.
