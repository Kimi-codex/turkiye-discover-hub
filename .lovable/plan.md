## المشكلة (السبب الجذري)

الدُفعة `final.json` نُفّذت (Execute) بينما كان `normalizeImages` يرفض روابط الصور المكتوبة كـ **نصوص** (وليس كائنات)، وكذلك تم اعتماد نتائج المعالجة (`rp.normalized`) في مرحلة Analyze السابقة — أي أن الـ Execute يستخدم البيانات المُطبَّعة سلفًا. النتيجة:

- `business_images`: 0 صفوف من هذه الدُفعة (الـ16 الظاهرة قديمة من اختبار سابق).
- `reviews`: 0 صفوف — نفس السبب (Analyze السابق أنتج `reviews: []`).

الأذونات و RLS سليمة، وبنية الحمولة صحيحة: كل عنصر يحتوي `images: [url,...]` و`reviews: [{rating,text,author,date}]`. المشكلة فقط أن Execute لا يعيد التطبيع من `raw_payload.source`.

زر **"Reprocess images from source"** أضيف سابقًا داخل تبويب Images في صفحة تفاصيل الاستيراد، لكنه:
1. غير مرئي بشكل كافٍ (مخفي داخل تبويب فرعي).
2. لا يعالج الرفيوز إطلاقًا.

## الخطة

### 1) دالة سيرفر جديدة `reprocessBatchReviews`
- في `src/lib/admin/imports.functions.ts`، نظيرة لـ `reprocessBatchImages`.
- تمر على كل `import_batch_items` مرتبطة بـ `business_id`، تستدعي `unwrapRecord` ثم `normalizeReviews`، وتـ `upsert` في جدول `reviews` باستخدام `onConflict=(business_id, source, source_fingerprint)` مع `source='google'` و `status='published'`.
- ترجع `{ itemsScanned, itemsWithReviews, reviewsUpserted }` وتُسجّل audit log.

### 2) دالة موحّدة `reprocessBatchData`
- تستدعي داخليًا `reprocessBatchImages` + `reprocessBatchReviews` وتعيد الملخصين معًا. لتمكين زر واحد يفعل كل شيء.

### 3) تحسين واجهة إعادة المعالجة
في `src/routes/$lang._authenticated.admin.imports.$id.tsx`:
- نقل زر **"Reprocess data (images + reviews)"** إلى شريط الإجراءات العلوي للدفعة المكتملة (بجانب Open/Schema/Archive)، ليكون واضحًا فور فتح الدفعة.
- إظهار Toast بعد التنفيذ بعدد الصور والرفيوز المُدرجة.
- إبطال (invalidate) استعلامات `admin/images` و `admin/reviews` والدُفعة الحالية.

في `src/routes/$lang._authenticated.admin.imports.index.tsx`:
- إضافة زر ثانوي **"Reprocess"** على كارت أي دفعة `completed` — لتفادي الحاجة لفتح التفاصيل.

### 4) تنفيذ فوري للدفعة الحالية
بعد تفعيل الأزرار، اضغط زر Reprocess مرة واحدة على `final.json` — سيُدرج ~200 صورة و~200 رفيو، وستظهر مباشرة في:
- `/en/admin/images` (تبويب Records)
- صفحة العمل العامة (`/en/place/...`) في قسم التقييمات

### تفاصيل تقنية

- لا تعديل على مخطط قاعدة البيانات — الأذونات و RLS و `onConflict` كلها جاهزة.
- `normalizeReviews` الحالي يتعامل مع الشكل الموجود في `raw_payload.source.reviews` (بعد unwrap تصبح في `raw.reviews`).
- `normalizeImages` بعد التصحيح الأخير يقبل مصفوفة روابط نصية.
- إعادة المعالجة idempotent: التشغيل المتكرر لا ينشئ تكرارات بفضل `onConflict`.
- الرفيوز المُستوردة تُحفظ بـ `status='published'` وليس `pending`، لأنها من Google (مصدر خارجي موثوق) — رفيوز المستخدمين على المنصة تظل `pending` وتحتاج مراجعة.

## نطاق التغيير
- `src/lib/admin/imports.functions.ts` (إضافة دالتين)
- `src/routes/$lang._authenticated.admin.imports.$id.tsx` (نقل الزر + دمج)
- `src/routes/$lang._authenticated.admin.imports.index.tsx` (زر سريع على الكارت)

لا تغييرات في القاعدة، لا مايجريشن، لا تعديل RLS.