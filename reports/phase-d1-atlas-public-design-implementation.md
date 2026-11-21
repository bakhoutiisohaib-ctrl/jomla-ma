# JOMLA.MA — Phase D1: تنفيذ Atlas للواجهات العامة

21 أكتوبر 2026 · تنفيذ محلي · العربية RTL والفرنسية LTR.

**الحالة: D1 مكتملة محلياً ضمن النطاق المعتمد، وجاهزة للمراجعة البصرية.** طُبقت هوية Atlas على الترويسة والتنقل والرئيسية والكتالوج وبطاقات المنتجات وصفحتي المنتج والمتجر. نجحت **273 حالة خلفية في 22 مجموعة، و115 حالة واجهة في 14 مجموعة**، ونجح بناء الإنتاج. توجد **32 لقطة قبل/بعد**، إضافة إلى أدلة الجرس وحجب المسودات. لم يبدأ D2.

## 1. حفظ الحالة قبل التنفيذ ونطاق المقارنة

فُحص Git أولاً: الفرع `master`، وHEAD هو `22da3d86923262f7ac83408af7bb6f8596a0e152`، مع **65 ملفاً متتبعاً معدلاً و2661 ملفاً غير متتبع** موروثة من العمل السابق. لذلك اقتُرحت ووُثقت نسخة ZIP محلية مع patch وبصمات، ثم أُنجزت وتحققت قبل تعديل مصادر الواجهة. لم يُستخدم stash أو reset، ولم ينشأ Commit أو Push.

- [نسخة ما قبل D1](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/safety/source-before-d1.zip): **2753 ملفاً، 41,894,081 بايت**؛ تحقق CRC وبصمة كل ملف وSHA-256 للأرشيف.
- [سجل البصمات والحالة](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/safety/before-source-manifest.json)، [patch الشجرة](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/safety/working-tree.patch)، [patch الفهرس](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/safety/index.patch)، [تعليمات الاسترجاع الآمن](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/safety/backup-notes.md).
- الاسترجاع يبدأ بفك الأرشيف في مجلد مراجعة جديد. لا يحتوي patch وحده الملفات غير المتتبعة. ملفات البيئة الفعلية والبيانات والاعتماديات ومخرجات البناء المتجاهلة مستثناة؛ هذه نسخة للشيفرة والوثائق وليست نسخة لقاعدة البيانات الأصلية.

تُقارن تغييرات D1 بهذه النسخة، لأن المقارنة مع HEAD وحده تخلط مراحل A–C2 مع هذه الجولة. [الفحص النهائي](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/final-verification.json) يؤكد أن خمسة ملفات موجودة فقط تغيرت، وأن بقية ملفات الأساس مطابقة، وHEAD والفهرس لم يتغيرا. لا تغييرات محتوى غير متوقعة أو ملفات أساس مفقودة.

## 2. ما طُبق من Atlas

المرجع هو [تقرير D0](C:/Users/hp/jomla-ma/reports/phase-d0-premium-design-exploration.md) واتجاه Atlas المعتمد، وليس الاتجاهان الآخران.

| السطح | التنفيذ |
|---|---|
| الترويسة والتنقل | علامة ج + jomla.ma، بحث مركزي، مدخل البحث بالصورة واضح، لغة وحساب، روابط السوق والمتاجر وطلب التوريد. بقي دخول الإشراف موجوداً في التذييل، وخاضعاً لصلاحياته السابقة. |
| الرئيسية | رسالة تجارة جملة واضحة، إجراء تصفح أساسي، طلب خاص ثانوي، رسم Atlas الأصلي من D0، ثم المنتجات. الرسم توضيحي ولا يدّعي أنه صورة مورد. |
| الكتالوج | مرشحات داخل disclosure أصلي قابل للفتح بلوحة المفاتيح، مع مؤشر عدد المرشحات؛ الحقول والترتيب والصفحات والبحث والمقارنة الحالية محفوظة. |
| البطاقة | مساحة صورة موحدة، تسلسل الاسم والسعر والعملة والوحدة وMOQ والموقع، وصف مختصر بصرياً، وشرائح أسعار قابلة للتوسيع. التفاصيل الكاملة متاحة في صفحة المنتج. |
| المنتج | مسار تنقل، صورة رئيسية كبيرة وصور ثانوية، ترتيب السعر والمواصفات وMOQ والشرائح، المتجر والمشاركة والتقييمات الموجودة فقط؛ زر RFQ الحالي نفسه ثابت أسفل الهاتف. |
| المتجر | غلاف مختصر مع الشعار المدار ومعلومات عامة، منتجات مبكرة وبحث داخل المتجر؛ معلومات التعريف والمشاركة جانبية على الحاسوب وأسفل المنتجات على الهاتف. |

الألوان: أخضر `#1b5142`، نص `#18342d`، ثانوي `#53675f`، خلفية `#f7f7f2`، ولمسة طينية `#9e422f`. بطاقات بزوايا 14px، ومسافات أكثر انتظاماً، وخطوط النظام Segoe UI/Tahoma/Arial دون تحميل خط أو مكتبة جديدة. شبكة الكتالوج أربع بطاقات على الحاسوب المختبر وبطاقتان على الهاتف، مع نقاط استجابة وسطية.

أُضيف رابط تجاوز إلى المحتوى، ومؤشر تركيز واضح، وتسميات للبحث والجرس، وأزرار إجراءات رئيسية بارتفاع 44px أو أكثر، ودعم تقليل الحركة. تعكس المحاذاة والمسافات اتجاه اللغة. لم يُجر اختبار قارئ شاشة بشري أو تدقيق WCAG شامل؛ ذلك يبقى فحصاً مستقلاً لاحقاً.

## 3. الملفات المعدلة والمضافة

| الملف | تغيير D1 |
|---|---|
| [App.js](C:/Users/hp/jomla-ma/frontend/src/App.js) | ربط الغلاف العام، الترويسة والبحث والتنقل والرئيسية والمرشحات، وحالات الصفحات العامة. |
| [ProductCard.jsx](C:/Users/hp/jomla-ma/frontend/src/components/products/ProductCard.jsx) | تنظيم العرض والوصف وطي شرائح الأسعار؛ نفس إجراءات المقارنة وRFQ والروابط والصور. |
| [ProductPage.jsx](C:/Users/hp/jomla-ma/frontend/src/components/products/ProductPage.jsx) | هيكل Atlas والمعرض والمواصفات وإجراء الهاتف؛ الغلاف العام أصبح مشتركاً. |
| [StorePage.jsx](C:/Users/hp/jomla-ma/frontend/src/components/suppliers/StorePage.jsx) | الغلاف وتقديم المنتجات والمعلومات العامة، مع البحث والمشاركة الحاليين. |
| [App.test.js](C:/Users/hp/jomla-ma/frontend/src/App.test.js) | تحديث توقعَي عنوان الرئيسية إلى النص المعتمد؛ بقية حالات السلوك محفوظة. |
| [MarketLayout.jsx](C:/Users/hp/jomla-ma/frontend/src/components/common/MarketLayout.jsx) — جديد | الغلاف العام والأيقونات المحلية والجرس والتذييل. |
| [atlas-public.css](C:/Users/hp/jomla-ma/frontend/src/styles/atlas-public.css) — جديد | أنماط ضمن Atlas والأسطح العامة؛ لم يُعدل index.css. |
| [atlas-hero.svg](C:/Users/hp/jomla-ma/frontend/public/atlas-hero.svg) — جديد | الرسم الأصلي من D0؛ أصل زخرفي ثابت، وليس صورة منتج أو مساراً بديلاً لملفات المورد. |
| [MarketLayout.test.jsx](C:/Users/hp/jomla-ma/frontend/src/components/common/MarketLayout.test.jsx) — جديد | خمس حالات مستقلة للعداد والزائر والخطأ وتبديل الحساب والرد المتأخر. |

ملفات الأدلة المحلية الجديدة: [phase-d1-snapshot.py](C:/Users/hp/jomla-ma/scripts/phase-d1-snapshot.py)، [prepare-preview.py](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/prepare-preview.py)، [phase-d1-preview.cjs](C:/Users/hp/jomla-ma/scripts/phase-d1-preview.cjs)، [phase-d1-finalize.py](C:/Users/hp/jomla-ma/scripts/phase-d1-finalize.py)، وهذا التقرير ومجلد أدلته. لم تتغير ملفات backend أو الحزم أو المراحل السابقة أو حماية الصور أو المحرر أو لوحات الحساب.

## 4. الإشعارات

الجرس في الترويسة العامة يستخدم **GET `/api/notifications` الحالي** و`unreadCount` بصلاحيات الجلسة الحالية. لا تغيير في عقود API أو إنشاء الإشعارات أو قراءتها أو تعليمها كمقروءة.

- إشعارات جديدة: شارة بعددها، مع حد عرض `99+` فقط؛ يبقى الوصف الميسر بالعدد الفعلي.
- صفر: جرس بلا شارة، مع نص واضح بعدم وجود إشعارات جديدة.
- تحميل أو فشل: العدد غير مؤكد، ولا يُقدّم على أنه صفر مؤكد.
- تحديث كل 30 ثانية أثناء ظهور التبويب، وعند العودة إليه أو التركيز. تُلغى الطلبات عند الخروج أو تبديل المالك، ويُحجب رد الحساب السابق.
- فتح الجرس يعرض الملخص وزر الانتقال إلى مساحة الحساب الحالية، ومنها قسم الإشعارات الموجود. لا ينشئ هذا الزر رابطاً مباشراً جديداً لتبويب الإشعارات.

نجح فحص المشتري مع إشعارين، وحساب آخر بلا إشعارات، والمورد مع إشعار البداية وإشعار RFQ الاصطناعي الجديد. نجح الخروج وتبديل الحساب، وتغطي حالة اختبار إضافية ردّاً متأخراً لا يجوز أن يظهر للحساب التالي.

المؤجل إلى D2: مركز إشعارات متكامل، فتح التبويب المقصود مباشرة، توضيح أنواع الإشعارات وتوقيتها، إدارة المقروء وغير المقروء باستعمال المنطق القائم، وتنسيق التحديث مع لوحة الحساب لتجنب الطلبات المتكررة. لم تُضف خدمات Push أو Email أو WhatsApp.

## 5. التحقق والنتائج

كل فحوص المتصفح وRFQ والخصوصية استخدمت MongoMemoryServer مستقلاً وملفات مؤقتة وبذوراً اصطناعية فقط. لم تُقرأ قاعدة المشروع الأصلية أو تُعدل، ولم تُعدّل ملفات الأسرار. استُخدم بناء الإنتاج مع `/api` في متغير العملية فقط. أُوقفت بيئتا التصوير وأزيل مجلداهما المؤقتان بنجاح.

| الفحص | النتيجة والدليل |
|---|---|
| اختبارات الخلفية كاملة | **273/273، 22 مجموعة، صفر فشل** — [JSON](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/backend-tests.json)، [السجل](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/backend-tests.log). |
| انحدار A وB وC1 وC2 | تشمل privacy **39**، RFQ consistency **29**، public media **30**، public pages **22**، إلى جانب الأمن والبحث والفهرسة والمهام والنسخ والاستعادة والصلاحيات. |
| اختبارات الواجهة كاملة | **115/115، 14 مجموعة، صفر فشل** — [JSON](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/frontend-tests.json)، [السجل](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/frontend-tests.log). |
| بناء الإنتاج | **Compiled successfully** مع CI؛ JS رئيسي **104.43kB gzip** وCSS **5.18kB gzip**، مقابل 101.84 و2.02 قبل D1. [سجل البناء](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/production-build.log). |
| رابط المنتج المباشر + F5 | الصفحة الصحيحة بقيت بعد التحديث. |
| منتج ← متجر، رجوع، تقدم | عادت الصفحات والروابط الصحيحة باستعمال تاريخ المتصفح. |
| بحث المتجر + F5 | البحث «كوب» محفوظ في الرابط، والنتيجة واحدة بعد التحديث. |
| RFQ من المنتج | الزائر عاد بعد الدخول إلى المنتج وفتح RFQ؛ أُرسل طلب اصطناعي واحد بكمية 20، ثم ظهر في لوحة المشتري وبقي بعد F5. قاعدة الاختبار تؤكد **طلباً واحداً فقط**. |
| الكمية والمقارنة | فتح المرشحات وإدخال 50 ثم إضافة المنتج للمقارنة أعطى السعر الصحيح **100 MAD** طبقاً للشريحة، مع MOQ والوحدة والمورد. |
| خصوصية الروابط | رابط المسودة ورابط المتجر غير المعتمد يعرضان عدم التوفر وصفر صور. تعليق المتجر يعيد 404 للمنتج والمتجر و401 للشعار العام، وصفحة المنتج تعرض عدم التوفر وصفر صور. |
| مسار الصور | `/uploads/...` ما زال 404؛ صور المنتجات والشعار الظاهرة تحمل عبر المسار المدار وBlob URLs، دون JWT في الروابط. لم تتغير ProtectedImage أو سياسات التفويض. |
| استجابة واتجاه | 32 حالة قبل/بعد؛ 1440×1000 و390×844، العربية RTL والفرنسية LTR، صفر تجاوز أفقي، وجميع الصور الظاهرة محملة في اللقطات. |
| Console النهائي | لا تحذيرات أو أخطاء في جلسة اللقطات النهائية قبل تجارب الرفض الأمني المتوقعة. |
| سلامة المصادر | تحقق بصمات 2753 ملف أساس؛ خمسة تغييرات متوقعة فقط، وبقية الملفات مطابقة. `git diff --check` ناجح؛ HEAD والفهرس ثابتان. |

التفاصيل القابلة للتدقيق: [رحلات المتصفح وقياسات اللقطات](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/browser-verification.json)، [نتيجة RFQ المعزولة](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/browser/browser-db-result.json)، [فحوص HTTP](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/browser-final/spa-http-probes.json)، [أثر تعليق المتجر](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/browser-final/preview-control-result.json)، [الفحص النهائي](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/final-verification.json).

أوامر التحقق المستخدمة:

```powershell
# من backend — العزل مفروض عبر helper الاختبارات القائم
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --silent --json --outputFile=../reports/phase-d1-evidence/backend-tests.json --setupFilesAfterEnv ./tests/helpers/pilotIsolation.js

# من frontend
$env:CI='true'
npm.cmd test -- --watchAll=false --runInBand --json --outputFile=../reports/phase-d1-evidence/frontend-tests.json
$env:REACT_APP_API_URL='/api'
npm.cmd run build

# من جذر المشروع — فحص الأدلة والبصمات، لا يعيد تشغيل التطبيق
python scripts/phase-d1-finalize.py
```

## 6. لقطات قبل/بعد

[المعرض الكامل: 16 زوجاً قبل/بعد](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/before-after-gallery.md) يغطي الرئيسية والكتالوج والمنتج والمتجر، بالعربية والفرنسية، للحاسوب والهاتف. الرئيسية والكتالوج ضمن الرابط الحالي نفسه؛ لقطة الكتالوج تُظهر موضع شبكة المنتجات بدلاً من مقدمة الرئيسية.

| الواجهة | بعد — عربي حاسوب | بعد — فرنسي حاسوب | بعد — عربي هاتف | بعد — فرنسي هاتف |
|---|---|---|---|---|
| الرئيسية | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-home-ar-desktop.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-home-fr-desktop.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-home-ar-phone.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-home-fr-phone.jpg) |
| الكتالوج | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-catalog-ar-desktop.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-catalog-fr-desktop.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-catalog-ar-phone.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-catalog-fr-phone.jpg) |
| المنتج | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-product-ar-desktop.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-product-fr-desktop.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-product-ar-phone.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-product-fr-phone.jpg) |
| المتجر | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-store-ar-desktop.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-store-fr-desktop.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-store-ar-phone.jpg) | [عرض](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-store-fr-phone.jpg) |

أدلة إضافية: [جرس المشتري](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/buyer-bell-ar-phone.jpg)، [حالة صفر](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/empty-bell-fr-phone.jpg)، [جرس المورد](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/supplier-bell-ar-phone.jpg)، [حجب المسودة](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/draft-denied-fr.jpg).

![الرئيسية بعد Atlas — العربية للحاسوب](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-home-ar-desktop.jpg)

![المنتج بعد Atlas — الفرنسية للهاتف](C:/Users/hp/jomla-ma/reports/phase-d1-evidence/screens/after-product-fr-phone.jpg)

## 7. العقود والحدود والأعمال المؤجلة

**لا تغيير في API أو البيانات أو منطق RFQ أو الاتفاقات.** روابط `/products/:id` و`/stores/:id` وتوجيه الدخول والعودة محفوظة. لم تُنشر صور قديمة أو تُنقل، ولم يُفتح مجلد uploads. لا اعتماديات أو خدمات خارجية جديدة. لوحة المورد والمشتري والمحادثات وRFQModal والمحرر وصفحة المصادقة بقيت بتصميمها الحالي؛ البطاقة المشتركة احتفظت بعقودها.

الحدود المتبقية:

1. جلسة التصوير الأولى الطويلة بلغت حد الطلبات القائم وأعادت 429؛ لم يُرفع الحد ولم تتغير حماية الصور. حُفظ دليل RFQ منها، ثم استُخدمت قاعدة اصطناعية جديدة بالبذور نفسها لالتقاط جميع صور «بعد» النهائية. لذلك تختلف IDs بين بعض أدلة الرحلات واللقطات؛ بيانات العرض والأصول نفسها. إعادة تحقق الصور الدورية القائمة تستحق قياس حمل منفصلاً عند إطالة جلسات الكتالوج.
2. إعادة بناء CRA أثناء جلسة المتصفح سببت فقدان ملف build مؤقتاً؛ أُعيد الفحص بعد اكتمال البناء ونجحت الرحلات. لا يُفترض تشغيل المعاينة أثناء استبدال ملفات البناء.
3. الفحص البصري بمحاكاة viewport في المتصفح، وليس بمختبر أجهزة فعلية أو قياس Core Web Vitals أو اختبار استخدام مع تجار. لم تُضاف خطوط تجارية أو صور مخزون خارجية.
4. صلاحيات البحث بالصورة، ومنها قيود رفع الزائر المجهول، محفوظة كما في C1. لم يُوسع الرفع المجهول، ولم يُدّع اختبار خدمة AI خارجية حقيقية في البيئة المعزولة.
5. متطلبات SPA fallback وقيود SEO/WhatsApp في C2 باقية: HTML الأولي لا يحتوي تفاصيل المنتج أو og:image خاصاً به؛ لم تُضف SSR أو استضافة أو مسارات خادم جديدة.
6. صفحة المورد العامة القديمة `/suppliers/:id` باقية بوظيفتها ومظهرها الحالي خارج نطاق صفحات Atlas الست المعتمدة. صفحات الحساب والإشراف كذلك خارج هذا التحديث.

المؤجل إلى **D2**: لوحتا المورد والمشتري، المحادثات ومركز الإشعارات، تنقل مساحة العمل، وتجربة إضافة المنتج/Wizard بعد مراجعتها. لا دفع أو محفظة أو شحن أو نظام توثيق اختياري جديد في D1.

**نقطة التوقف:** انتهى تنفيذ D1 والتحقق المحلي والتوثيق. يلزم اختيار المالك وموافقته قبل أي عمل D2. لا Commit أو Push أو نشر.
