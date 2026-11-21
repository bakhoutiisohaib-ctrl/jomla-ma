# Jomla.ma

> نسخة تطوير وتجربة خاصة؛ ليست اعتماداً للإطلاق التجاري. لمتابعة كل مرحلة ومزامنتها راجع [دليل GitHub](docs/GITHUB_SYNC.md).

سوق B2B يبدأ بالمغرب، بواجهة React وخادم Express وMongoDB. راجع [دليل التشغيل](docs/OPERATIONS.md) و[تقرير الإصلاحات](reports/remediation-2026-10-19.md) و[تقرير الاستكمال](reports/completion-2026-10-19.md).

## التشغيل المحلي

1. داخل backend نفّذ npm ci، ثم انسخ .env.example إلى .env واضبط MongoDB وJWT_SECRET.
2. شغّل npm start داخل backend. لا يبدأ HTTP قبل اتصال قاعدة البيانات.
3. داخل frontend نفّذ npm ci ثم npm start. تمرر الواجهة /api إلى الخادم المحلي على5000.
4. إنشاء المشرف الأول محلي فقط: node scripts/create-admin.js --name "Administrator" --email "admin@example.com" داخل backend؛ يطلب كلمة المرور دون إظهارها.

المهام الخلفية تبدأ مع الخادم افتراضياً. للتشغيل المنفصل اضبط JOB_WORKER_MODE=external ثم npm run worker، مع نفس قاعدة البيانات وUPLOADS_DIR الدائم. راجع [المهام](docs/JOBS.md) و[البحث البصري](docs/VISUAL_SEARCH.md) و[النسخ والاستعادة](docs/BACKUPS.md).

من الجذر: node scripts/preflight.js لفحص الإعدادات دون طباعة أسرار، أو أضف --check-db لفحص اتصال Mongo فقط دون كتابة.

## التحقق

- backend: npm test -- --silent
- frontend: استخدم CI=true ثم npm test -- --watchAll=false --runInBand
- frontend: npm run build
- موقع الإنتاج يخدم frontend/build ثابتاً؛ react-scripts وأدوات الاختبار اعتمادات تطوير وتلزم في مرحلة البناء. لا تنشر خادم npm start التطويري.
- بعد البناء، نسخة اختبار مؤقتة مستقلة تماماً عن قاعدة التطبيق: داخل backend شغّل node scripts/preview-isolated.js ثم افتح http://127.0.0.1:5055. الحسابات المصطنعة موضحة في السكربت. أوقفها بـCtrl+C بعد الفحص؛ ليست خادم إنتاج.

الاختبارات تستعمل قواعد Mongo مؤقتة. تغيّر نموذج النشر والصلاحيات؛ البيانات القديمة تحتاج مراجعة بشرية وإعادة اعتماد، ولا يوجد ترحيل يوافق على صورها أو نشرها تلقائياً.
