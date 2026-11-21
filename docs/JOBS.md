# طابور المهام الدائم

تنفذ المهام الثقيلة في عامل مستقل، وتُحفظ حالتها في MongoDB نفسها. لا يتطلب ذلك Redis. لا توجد واجهة HTTP لإنشاء نوع مهمة أو payload من اختيار المتصفح؛ تنشئ مسارات التطبيق الموثوقة المهام بعد التحقق من المستخدم والملف.

يبدأ npm start عاملاً مدمجاً مع API افتراضياً. لتشغيل الأمر التالي كعملية مستقلة، اضبط JOB_WORKER_MODE=external في API، مع قاعدة البيانات ومجلد الصور الدائم نفسيهما لدى العامل. يمكن أيضاً تشغيل عدة عمال وفق حدود الموارد.

## التشغيل

من `backend`، بعد إعداد ملف `.env` واتصال `MONGODB_URI`:

```powershell
node workers/worker.js
```

يقرأ العامل ملف `.env` من مجلد backend، ويتصل بالقاعدة، وينشئ فهارس BackgroundJob قبل بدء المطالبة بالعمل. تُحمّل الأنواع المسموحة من `backend/services/jobHandlers.js`، ويُقبل تصدير الخريطة مباشرة أو `{ handlers }`. إخفاق تهيئة القاعدة أو الخريطة يوقف العامل برمز خروج فاشل دون طباعة الأسرار.

إعدادات اختيارية:

| المتغير | الافتراضي | الاستخدام |
| --- | --- | --- |
| `JOB_CONCURRENCY` | 2 | عدد المهام المتزامنة في العملية، بين 1 و20 |
| `JOB_LEASE_MS` | 30000 | مدة حجز المحاولة، مع heartbeat تلقائي |
| `JOB_POLL_MS` | 1000 | فترة الاستعلام عندما يكون الطابور فارغاً |
| `JOB_SHUTDOWN_GRACE_MS` | 15000 | مهلة إنهاء المهام الحالية عند SIGTERM/SIGINT |

يمكن تشغيل أكثر من عامل على القاعدة نفسها. لا يشغّل العامل إلا الأنواع المسجلة لديه؛ تبقى الأنواع غير المعروفة منتظرة حتى يتوفر handler مناسب.

## عقد الإنشاء والمعالج

```js
const { enqueueJob, publicJob, assertJobPermission } = require('./services/jobQueue')

const { job, created } = await enqueueJob({
  type: 'ai_product_draft',
  ownerId: req.supplier.ownerId,
  requestedBy: req.supplier.id,
  organizationId: req.supplier.organizationId,
  requiredPermission: 'manage_products',
  idempotencyKey: operationKey,
  payload: { imageUrl: '/uploads/product-example.png', mimetype: 'image/png' },
  maxAttempts: 3,
  timeoutMs: 120000
})
res.status(created ? 202 : 200).json({ job: publicJob(job) })
```

`payload` يجب أن يكون JSON صالحاً بحد 256KB، مع تحويل المعرّفات والتواريخ إلى نصوص. تُحفظ الصورة في التخزين ويرسل مرجعها، ولا يُنسخ محتوى الصورة الضخم إلى الطابور. تُقرأ بيانات اعتماد المزود من بيئة العامل؛ لا توضع في payload. يجب إنشاء `operationKey` بطريقة ثابتة للعملية المقصودة وعدم إعادة استعماله لعملية مختلفة.

هوية منع التكرار هي `(ownerId, type, idempotencyKey)` مع فهرس فريد. يتطابق ترتيب حقول JSON المختلف مع العملية نفسها. اختلاف payload أو المنظمة أو الصلاحية المطلوبة للمفتاح نفسه يُرفض بـ `IDEMPOTENCY_CONFLICT` و409، حتى بعد انتهاء المهمة. تغيير عدد المحاولات في إعادة الطلب لا يعيد فتح المهمة الأصلية.

```js
const { generateProductDraft } = require('./services/productDraft')

module.exports = {
  ai_product_draft: async (payload, { job, signal, heartbeat }) => {
    await assertJobPermission(job)
    const result = await generateProductDraft(payload, { signal })
    signal.throwIfAborted()
    await assertJobPermission(job)
    // يُعاد DTO عام محدود الحقول؛ لا تُعاد استجابة المزود الخام.
    return result
  }
}
```

يمكن حقن خريطة معالجات في `createWorker({ handlers })` أو استخدام `registerHandlers(handlers)` قبل الإنشاء. يوفر العامل `start()` و`runOnce()` و`stop({ graceMs })`. أداة `runOnce()` مفيدة للفحوص أو تشغيل دفعة محدودة؛ العامل الإنتاجي يستخدم `start()` ثم `stop()`.

يتحقق `assertJobPermission(job)` من المالك الحالي ونشاطه، ودور الطالب الحالي، والمنظمة وعضوية الموظف وصلاحيته الحالية. يُستدعى في بداية المعالج، ومجدداً قبل أي كتابة دائمة بعد انتظار خدمة خارجية. رفضه دائم: `JOB_REJECTED` و`retryable=false`. لا تعوّض صلاحيات لحظة الإدراج عن هذا الفحص. وظائف المعالج المسجلة داخل الخادم هي التي تحدد الأثر المسموح، ولا يُشغّل الطابور شيفرة من payload.

## ضمانات التنفيذ والتعافي

- الانتقال إلى `running` وزيادة رقم المحاولة والحجز عمليّة MongoDB ذرية؛ يفوز عامل واحد فقط بالمهمة.
- للحجز رمز عشوائي مستقل لكل محاولة. تجديد الحجز وحفظ النتيجة يحتاجان الرمز الحالي؛ لا تستطيع محاولة قديمة الكتابة بعد تبني عامل جديد للمهمة.
- لكل محاولة مهلة مستقلة. يمرّر العامل `AbortSignal`، ويجدد الحجز دورياً دون تجاوز المهلة. التأخير الأُسّي يبدأ من `backoffMs` (افتراضياً ثانية) ويتضاعف بين المحاولات حتى حد ساعة، مع `maxAttempts` افتراضي 3 وبحد 10.
- خطأ المعالج يُعاد تلقائياً حتى استنفاد المحاولات؛ `retryable=false` يوقف الإعادة. تُخزّن رسائل عامة معتمدة، دون نص خطأ المزود أو stack.
- إذا توقفت العملية أو انقطع اتصالها بالقاعدة، ينتهي الحجز وتستعيد عملية عاملة لاحقة المهمة مع تأخير. إذا استُنفدت المحاولات تتحول إلى `failed`.
- عند SIGTERM/SIGINT تتوقف المطالبات الجديدة ويُنتظر العمل الجاري. بعد انتهاء مهلة الإغلاق يُرسل abort وتتوقف heartbeats؛ تُترك المحاولة تحت حجزها لتتعافى بعد انتهائه.

الضمان هو **تنفيذ مرة واحدة على الأقل** عند التعافي، وليس ضمان عدم تكرار كل أثر خارجي. يجب أن يحترم كل معالج signal، وأن تكون كتاباته قابلة لإعادة التنفيذ بأمان، مثلاً بالتحديث المشروط على نسخة المنتج أو upsert فريد. مهلة JavaScript لا تستطيع قتل استدعاء تجاهل الإلغاء؛ يمنع رمز الحجز نشر نتيجته القديمة، لكن يلزم ضبط الآثار الجانبية داخل المعالج أيضاً.

## متابعة العميل والعزل

بعد تركيب `routes/jobs` تحت `/api/jobs`:

- `GET /api/jobs` و`GET /api/jobs/mine`: المهام المرئية، مع `page` و`limit` (حتى 100)، و`status` اختيارياً.
- `GET /api/jobs/:id`: `{ job }`، و404 إذا لم تكن مرئية للمستخدم.
- الحالات: `pending` ثم `running` ثم `succeeded`، أو `retry_wait` ثم محاولة جديدة، أو `failed`.

المالك يرى مهامه، والمشرف الحالي يرى المهام، والموظف يرى مهام منظمته فقط بحسب العضوية والصلاحية الحالية المطلوبة لكل مهمة. سحب العضوية أو تغيير الدور يطبق على الطلب التالي دون الاعتماد على الدور القديم في التوكن. النتيجة تعيد `id` والحالة والمحاولات والتواريخ ونتيجة عامة عند النجاح، دون payload أو مفاتيح منع التكرار أو المالك أو تفاصيل الحجز. يُنقّى الناتج دفاعياً من حقول الأسرار وstack، ويظل المعالج مسؤولاً عن DTO عام محدود الحقول.

## استكمال قرارات RFQ — المرحلة B

يعمل `services/rfqDecision.createDecisionRecovery()` مع API في `start.js`، وكذلك مع العامل الخارجي في `workers/worker.js`. لا ينشئ مهمة AI أو Order؛ مصدر الاستكمال هو `QuoteRequest.decision` نفسه. يسمح تشغيل نسختين منه لأن آثار القرار مشروطة بمعرفه وقابلة لإعادة التنفيذ.

يفحص كل 5 ثوانٍ دفعة حتى 25 قراراً مستحقاً من `status=deciding`, `decision.version=1`, `decision.phase=pending`. يزداد `attempts` وتؤجل الأخطاء بتأخير أُسّي حتى 60 ثانية. لا يحول فشل مستمر إلى قبول مكتمل ولا يغير قراراً محفوظاً. السجلات القديمة دون هذا الحقل مستثناة. خروج المشتري بعد حفظ القرار لا يلغي الاستكمال؛ هو تنفيذ نية مخولة سبق حفظها، وكل قرار جديد يخضع للمصادقة الحالية.

راقب طول بقاء `deciding` و`decision.lastErrorCode` (`RFQ_DECISION_RETRY` أو `RFQ_DECISION_CONFLICT`) وأخطاء `RFQ_RECOVERY_UNAVAILABLE`. الاستعادة لا تتطلب جلسة متصفح. يستطيع المشتري إعادة `PUT /api/rfq/:id/action` بنفس `offerId` و`action` لاستكمال القرار نفسه. لا تحذف القرار أو تعدل السعر أو تعيد فتح الطلب كوسيلة علاج. راجع التعارض والنسخ الاحتياطي يدوياً؛ لا توجد أداة إصلاح تخميني للاتفاقات السابقة.

تطلب كتابات القرار `writeConcern: { w: 1, j: true }`؛ يلزم MongoDB بتخزين يدعم journal مثل WiredTiger. لا يلزم replica set لهذا المسار، ولا يفترض معاملات متعددة المستندات. الإشعار الداخلي محفوظ مرة واحدة بمعرف القرار؛ هذا لا يضمن تسليم بريد أو SMS خارجي.

## التحقق المنعزل

```powershell
cd backend
npm test -- --runTestsByPath tests/jobs.test.js
```

تستخدم الاختبارات MongoMemoryServer منفصلاً عن قاعدة المستخدم، وتغطي تنافس الإدراج والمطالبة، منع التكرار، إعادة المحاولة والتعافي من الحجز المنتهي، heartbeat والمهلة، fencing للنتائج القديمة، الإغلاق الهادئ، تنقية النتائج والأخطاء، وعزل API وسحب صلاحيات الموظف ودور المشرف، وفحص صلاحية التنفيذ الحالي.
# R2 RFQ creation recovery

The API startup and standalone worker also run `createCreationRecovery()` from
`backend/services/rfqCreation.js`, independently of the Phase B decision runner.
It scans at most25 due `status=creating`, `creation.version=1`, `phase=pending`
records every5 seconds. Backoff grows to60 seconds; safe error codes, attempts,
nextAttemptAt and the retained journal support operational review. It never
reconstructs historical RFQs lacking this journal. `_id`-fenced upserts and a
unique buyer/creation-key index allow concurrent API retries and workers.

Creation remains202 until the conversation, initial message and supplier
notification exist. Missing database acknowledgements are re-read, and persisted
intent resumes after process restart. An unavailable database may prevent both
write confirmation and re-read: clients retain the same key and show uncertainty.
This is recoverable single-document intent plus idempotent effects, not a
multi-document Mongo transaction or a guarantee against storage loss.

Before future rollout with autoIndex disabled, create the exact new partial unique
index declared on QuoteRequest; the API fails closed503 without it. Monitor oldest
pending creation age and RFQ_CREATION_RETRY/CONFLICT, and resolve sustained conflicts
manually without deleting or rewriting intent. Run the recovery process after
restore as well; RFQ/MessageThread/Notification collections and indexes must be
restored together. No original data migration or restore was executed by R2.

# RFQ supplier-offer recovery (R3)

`createOfferRecovery()` starts with the API and the standalone worker, alongside
the unchanged R2 creation and Phase B decision runners. Every5s it scans up to25
explicit `offerSubmission.version=1` journals in pending/committing/aborting,
with exponential retry delay capped at60s. Multiple runners may safely complete
the same stable IDs. Shutdown drains the current pass within its grace period.

Only a supplier action first reserves an offer. Recovery completes that saved
authorization and commercial snapshot; it does not send a new offer or repair
legacy records. Revoked users cannot call submission/retry; background recovery
may finish an intent authorized before revocation. It cannot override a buyer's
stored decision or reopen a closed thread. No external delivery service added.

Monitor oldest outstanding `offering`, commit-stage age, attempts, and sanitized
`RFQ_OFFER_RETRY` / `RFQ_OFFER_CONFLICT` / `RFQ_OFFER_UNAVAILABLE` errors. A lasting
database outage keeps the operation fenced; restore database availability and
rerun recovery with intact intent. Missing threads, conflicting effect IDs or
corrupt snapshot hashes need manual investigation, never guessed backfill.
Before commitment, the previous offer remains active and the pointer unchanged.
After commitment, the operation must finish the selected replacement; the final
RFQ stays fenced until receipt and retirement are verified. Expired committed
quotes remain unacceptably expired under Phase B's existing check.

See `backend/API_GUIDE.md` for required indexes with autoIndex disabled and the
drain-before-rollback procedure. No automatic historical migration, cleanup,
index creation on the original database, or production execution occurred in R3.

