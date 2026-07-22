## السبب الجذري

كل سجل في الملف يحتوي على `images: [ "https://...", "https://...", ... ]` — أي **مصفوفة نصوص URL خام**، وليست كائنات `{ url, width, height, ... }`.

الدالة `normalizeImages` في `src/lib/import/normalize.ts` تتعامل مع كل عنصر باعتباره كائن (`p.url ?? p.photo_reference ?? p.source ?? p.src`). عندما يكون العنصر مجرد نص، كل هذه الحقول `undefined` فترجع `null` ويُتخطى الصف. النتيجة: `normalized.images = []` لكل الأعمال الأربعين، ولا يُدرج أي صف في `business_images` أثناء التنفيذ.

الـ 16 سجل الظاهرين في الصفحة (بـ `source: manual`) من دفعات أقدم مختلفة تمامًا — لا علاقة لهم بالاستيراد الحالي.

## الخطة

### 1. إصلاح `normalizeImages` لقبول النصوص
`src/lib/import/normalize.ts` — داخل `photos.forEach`، اعتبر العنصر إذا كان `typeof p === "string"` كأنه `{ url: p }`. يبقى فحص `^https?://` كما هو. لا تغيير في التصنيف/الغلاف.

### 2. زر إعادة معالجة الصور لدفعة موجودة
بدلًا من إعادة تشغيل التحليل كاملًا، أضف زر **"Reprocess images"** في صفحة تفاصيل الاستيراد `src/routes/$lang._authenticated.admin.imports.$id.tsx` يستدعي دالة خادم جديدة `reprocessBatchImages(batchId)` في `src/lib/admin/imports.functions.ts`:
- تقرأ كل `import_batch_items` للدفعة التي لها `business_id` غير فارغ.
- تعيد استخراج الصور من `raw_payload.source` عبر `unwrapRecord` + `normalizeImages` (الدالة المصححة).
- تعمل `upsert` في `business_images` بنفس منطق `executeImport` (`source_type='google_places'`, `storage_status='pending'`, إلخ) لكل صورة، مع مراعاة `onConflict` الحالي.
- تعيد عدّاد الصور المُدرجة/المحدَّثة.

هذا يُعالج الدفعة الحالية دون إعادة إدراج الأعمال.

### 3. اختبار وحدة سريع
تحديث `src/lib/import/__tests__/pipeline.test.ts` (أو ملف مجاور) بحالة: مصفوفة نصوص → 5 صور مطبعة، الغلاف = الأولى.

### 4. تحقق نهائي
تشغيل الزر على الدفعة العالقة، ثم عرض صفحة `/admin/images` لرؤية 200 سجل (40 × 5) بحالة `pending` — سيبقون `external_only` لعرض `source_url` حتى تُهيَّأ R2.

## تفاصيل تقنية

- التغيير في `normalizeImages` سطر واحد فعليًا:
  ```ts
  const p = typeof rawP === "string" ? { url: rawP } : rawP;
  ```
  ثم استخدم `p` كما هو.
- `reprocessBatchImages` تستخدم `requireAdmin` middleware وتفعل `supabase.from("business_images").upsert(..., { onConflict: "business_id,source_url" })` — نفس النمط الموجود في `executeImport`.
- لا تعديل على DB schema، ولا تعديل على تدفق العمل، ولا على القوائم/الإحصاءات (ستتحدث تلقائيًا لأن العدّاد يقرأ من `business_images` مباشرة).
