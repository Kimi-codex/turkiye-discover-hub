# الريفيوز: كتابة + مراجعة إدارية + إصلاح الاستيراد

## التشخيص (مؤكَّد بالقراءة)

1. **زر "Write a review"** في `src/routes/$lang.place.$slug.tsx` مجرد زر شكلي — لا Dialog ولا insert. لذلك المستخدم لا يستطيع فعليًا كتابة ريفيو.
2. **لا يوجد أي صف في جدول `reviews`** (`SELECT status,count(*) → []`) رغم استيراد 40 نشاطًا في الدفعة `1c09b6c8…`. وبالفحص:
   - `field_inventory` فارغ لكن ذلك لا يهم — `normalizeReviews` يقرأ `raw.reviews` مباشرة.
   - `normalizeReviews` يتجاهل أي عنصر `rating === null`، ولا يدعم الأشكال البديلة الشائعة في تصديرات Google (`reviews_data`, `user_reviews`, `latest_reviews`, `business.reviews` بعد الفك). لذلك ملف `final.json` الحالي — الذي على الأرجح يستخدم أحد هذه المفاتيح — يُعطي 0 ريفيوز.
   - لا يوجد أي عدّاد يخبر المشرف بعدد الريفيوز التي رآها المُطبِّع مقابل التي كُتبت، فيبدو الاستيراد وكأنه "نجح" بينما الريفيوز مفقودة صامتًا.
3. سياسات RLS الحالية بالفعل تسمح بـ `INSERT` لريفيوز المنصة (`source='platform'`) وتُخفي أي ريفيو `status != 'published'` عن العامة، إذًا المطلوب فقط قناة كتابة + شاشة مراجعة.

---

## الخطوات

### 1) نموذج كتابة ريفيو (مستخدم مسجَّل)
- ملف جديد: `src/components/business/WriteReviewDialog.tsx` — Dialog يحتوي: نجوم 1-5، نص (5-2000 حرف)، زر إرسال.
- Server function جديد `submitReview` في `src/lib/reviews/reviews.functions.ts` مع `requireSupabaseAuth`، ينفّذ:
  ```
  insert into reviews (business_id, user_id, source, rating, review_text,
                       review_language, status)
  values (..., 'platform', ..., ..., <locale>, 'pending')
  ```
  ثم يُعيد `{ ok: true }`.
- في `src/routes/$lang.place.$slug.tsx`: يستبدل زر "Write review" الحالي بمفتاح فتح للـDialog. إذا المستخدم غير مسجَّل → تحويل إلى `/{lang}/auth?redirect=...`.
- بعد الإرسال: Toast «شكرًا، ريفيوك قيد المراجعة» + إخفاء الزر أو إظهار حالة "Pending".

### 2) صفحة إدارة الريفيوز (Moderation)
- ملف جديد: `src/routes/$lang._authenticated.admin.reviews.tsx` + رابط جانبي «Reviews» في Admin shell.
- تبويبات: **Pending / Published / Rejected**، مع بحث بالاسم أو النشاط.
- كل صف: صاحب الريفيو، النشاط (رابط), النجوم, النص, التاريخ, المصدر (`platform`/`google`), أزرار **Approve / Reject / Delete**.
- Server fns في نفس الملف (admin-gated): `listReviewsForModeration`, `setReviewStatus(id, 'published'|'rejected')`, `deleteReview(id)`.
- تدقيق في `audit_logs` لكل تغيير حالة.

### 3) إصلاح استيراد الريفيوز
- `src/lib/import/normalize.ts` → `normalizeReviews`:
  - قبول أي من: `raw.reviews`, `raw.reviews_data`, `raw.user_reviews`, `raw.latest_reviews`, أو المصفوفة نفسها من `raw.business?.reviews` إن وُجدت.
  - تخفيف شرط الرفض: قبول `rating === null` عندما يكون هناك نص، وتخزينه كـ`rating=0` مرفوض من الفلترة النهائية بدل تجاهله بصمت — بدلًا من ذلك: عدّه ضمن "skipped_no_rating" في تقرير الاستيراد.
- `src/lib/import/schema-detector.ts`: إضافة تعرُّف على مفاتيح `reviews_data[]`, `user_reviews[]`, `latest_reviews[]` (aliases فقط للعرض في Field Mapping).
- `imports.functions.ts`:
  - تجميع عدّادات لكل دفعة: `reviewsSeen`, `reviewsWritten`, `reviewsSkippedNoRating`, وحفظها في `metadata.reviewStats`.
  - في حالة `revErr`، تسجيل السبب في لوق الدفعة بدل الابتلاع الصامت.
- إضافة زر **"Reprocess reviews"** على بطاقة الدفعة المكتملة في `src/routes/$lang._authenticated.admin.imports.$id.tsx` يستدعي `reprocessReviewsForBatch(batchId)`: يُعيد تنزيل الملف من التخزين، ويعيد فقط شقّ الريفيوز عبر `upsert` (idempotent — نفس `source_fingerprint`).
- إعدادات: احترام `site_settings.reviews.auto_publish` (موجود). عند `false` → `status='pending'`، وإلا `'published'`. الافتراضي `false` كما هو الآن، لكي تمرّ الريفيوز المستوردة أيضًا من نفس شاشة المراجعة.

### 4) عرض في صفحة النشاط
- `src/lib/repos/supabase-repos.ts` → `listForBusiness`: يبقى فلتر `status='published'`.
- في `src/routes/$lang.place.$slug.tsx`: إضافة empty-state «لا توجد ريفيوز بعد — كن أول من يكتب».

---

## تفاصيل تقنية

- **RLS**: لا تغييرات في السياسات. `reviews_platform_insert_self` (موجود) يسمح للمستخدم بإدخال ريفيو بـ`user_id = auth.uid()` و`source='platform'`. سياسات الأدمن الحالية تكفي لتحديث `status`.
- **حماية من السبام**: منع كتابة أكثر من ريفيو واحد لكل مستخدم لنفس النشاط عبر فحص مسبق داخل `submitReview` (استعلام `select id where business_id=… and user_id=…` — نعالجه بـ`.maybeSingle()` لتفادي أخطاء عدم وجود صف). إن وُجد → رد `{ ok:false, reason:'already_submitted' }`.
- **حالة الاستيراد**: لا مايجريشن مطلوبة. `metadata` عمود JSONB موجود على `import_batches`.
- **إحصائيات الاستيراد**: تُعرض في بطاقة الدفعة تحت "Import summary": `Reviews: seen X → written Y (skipped Z)`.

## ما لن يُلمَس

- شكل صفحة النشاط أو التصميم العام.
- خط أنابيب الصور والترجمة.
- بنية `businesses` أو الـ RPCs.
