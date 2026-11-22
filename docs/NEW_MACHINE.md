# إعداد نسخة على حاسوب جديد

استنسخ المستودع (تحقق من إعداد خصوصيته في GitHub؛ ظهرت حالته Public عند فحص22 نوفمبر):

```powershell
git clone https://github.com/bakhoutiisohaib-ctrl/jomla-ma.git
cd jomla-ma
git status
```

تحتاج Git وNode/npm وMongoDB للاختبار المحلي. البيئة التي جرى فحص إصدارها عند
التسليم تستخدم Node 25.9.0 وnpm 11.12.1؛ هذا توثيق للإصدار وليس اعتماداً لكل أنظمة
التشغيل. راع متطلبات engines للحزم المقفلة، ولا تعالج فشل التثبيت بترقية عشوائية.

## تثبيت الاعتماديات

```powershell
cd backend
npm ci
cd ../frontend
npm ci
cd ..
```

`package-lock.json` في المجلدين هو المرجع. لا تحتاج نقل node_modules أو الكاش.
لا تشغل تثبيتاً أو بناءً ثقيلاً على قرص ممتلئ. الأوامر هنا لم تُعد تجربتها على حاسوب
جديد أثناء دفعة التوثيق؛ تحقق من نجاح كل خطوة ولا تتجاوز الأخطاء.

## معاينة مصطنعة معزولة

بعد بناء الواجهة:

```powershell
cd frontend
npm run build
cd ../backend
node scripts/preview-isolated.js
```

السكربت ينشئ Mongo مؤقتة وبيانات وصوراً مصطنعة، ويخدم الواجهة على
`http://127.0.0.1:5055`. لا يقرأ إعداد قاعدة التطبيق الأصلية. يحتاج تنزيل MongoDB
أو وجود ثنائيتها في الكاش. حسابات الاختبار وكلمة مرورها محددة صراحة في السكربت؛
لا تستخدمها في بيئة عامة. إيقاف المعاينة ينهي القاعدة المؤقتة ويحذف صورها المؤقتة.

تنبيه معروف: النسخة الحالية تستدعي `MongoMemoryServer.create()` دون محرك تخزين
صريح. عند استخدام MongoDB 7 أو أحدث قد يفشل المحرك الافتراضي القديم؛ عالج إعداد
المعاينة ليستخدم `wiredTiger` وتحقق منه، ولا تغيّر قاعدة قائمة أو ترقي الحزم لتجاوز
المشكلة. هذه المعاينة القديمة ليست نسخة من بيانات InterServer ولا اختبار قبول حديثاً.

## تطوير Frontend وBackend منفصلين

انسخ `backend/.env.example` إلى `backend/.env` فقط إن لم يوجد الملف. اضبط URI
لقاعدة جديدة مصطنعة (مثلاً `jomla_dev_synthetic`)، وJWT_SECRET عشوائياً جديداً.
لا تنسخ قاعدة أو مفاتيح تشغيل قديمة. أبق مزودي AI والاكتشاف الخارجي معطلين.

شغّل Mongo محلياً فقط، ثم من backend: `npm run preflight` وبعد نجاحه `npm start`.
من نافذة ثانية داخل frontend: `npm start`. الواجهة على localhost:3000 وتمرير API
إلى localhost:5000. تحقق من `/health/ready` على API ومن طلب API فعلي، لا من الصفحة فقط.
قاعدة جديدة ستكون فارغة؛ لا تشغل seed على قاعدة أخرى بالخطأ. خادم Backend الحالي
لا يحدد عنوان loopback عند listen؛ شغّل هذه الطريقة فقط في بيئة تطوير معزولة غير
معرّضة للشبكة، أو راجع ربطه بـloopback قبل الاستخدام على جهاز مشترك.

## التحقق الموجه

أوامر PowerShell من المجلد المناسب:

```powershell
# backend
npm test -- --runTestsByPath tests/accountRecovery.test.js tests/backup.test.js tests/pilot_journey.test.js
# frontend
$env:CI = 'true'
npm test -- --watchAll=false --runInBand --runTestsByPath src/RecoveryPage.test.jsx
npm run build
```

هذه أوامر لإعادة التحقق وليست إعلان نجاح جديد. الاختبارات تنشئ قواعد مؤقتة؛ لا
توجهها إلى قاعدة حقيقية. راجع [النسخ](BACKUPS.md) قبل أي تمرين استرجاع.

لاختبار البريد الخاص فقط، الإعدادات هي `NODE_ENV=test` و
`RECOVERY_MAIL_MODE=private-file` و`RECOVERY_MAIL_DIR` كمسار مطلق خاص خارج الويب
والمستودع، و`RECOVERY_ORIGIN` كأصل localhost أو 127.0.0.1. لا ترفع محتوى البريد
ولا روابط استرجاع الحساب إلى GitHub. لا يوجد إرسال بريد حقيقي حالياً.

## مواصلة العمل من جهازين

قبل العمل: `git status` ثم `git pull --ff-only` إذا كان مجلد العمل نظيفاً. عند وجود
تعديلات أو اختلاف تاريخ توقف وراجعها؛ لا تستخدم reset أو force-push. بعد المرحلة
راجع الفرق والاختبارات والتقرير ثم اتبع [دليل المزامنة](GITHUB_SYNC.md).
