## سبب المشكلة

1. **صفحة View فارغة ("Business not found")** — زر View في `src/routes/$lang._authenticated.admin.businesses.tsx` يستخدم مسار غير موجود `/$lang/$businessSlug`. المسار الصحيح لصفحة العمل هو `/$lang/place/$slug` (ملف `src/routes/$lang.place.$slug.tsx`). لذلك يذهب الرابط إلى `/en/<slug>` ويسقط على route الفئات/المدن الذي يرمي `notFound()`.

2. **الصور لا تظهر** — قاعدة البيانات فيها 16 صف في `business_images` كلها `deleted_at IS NOT NULL` (تم حذفها جميعًا من لوحة Images سابقًا). لا توجد صور فعّالة، فيتحول `getBusinessImageUrl` إلى placeholder.

3. **لا توجد تقييمات (reviews = 0)** — على الأرجح ملف الاستيراد كان بصيغة `single_places_wrapper` أو `flat` لا تحمل مصفوفة reviews، أو تم استيراد businesses قبل تعديل خطوة الـexecute. لن تُحلّ هذه بمجرد تصليح الرابط.

## الخطة

### 1) إصلاح رابط View في الأدمن
- `src/routes/$lang._authenticated.admin.businesses.tsx`: تغيير `<Link to="/$lang/$businessSlug" params={{ lang, businessSlug: b.slug }}>` إلى `<Link to="/$lang/place/$slug" params={{ lang, slug: b.slug }}>`.
- مسح أي استخدامات أخرى لـ `$businessSlug` في المشروع بـ ripgrep وتصحيحها.

### 2) استعادة الصور المحذوفة
- تنفيذ migration بسيطة: `UPDATE business_images SET deleted_at = NULL WHERE deleted_at IS NOT NULL;` لإعادة تفعيل الـ16 سجلًا الحاليين. الصور ستُعرض عبر `source_url` (Google) لأن R2 غير مُعدّ — وهذا هو fallback المصمم في `getBusinessImageUrl`.
- ملاحظة: بعض روابط Google Places قد تكون host-restricted وقد لا تظهر في المتصفح. إن حصل ذلك بعد الفحص، نضيف placeholder graceful عند فشل التحميل في `<BusinessImage>` (فحص لاحق فقط إذا لم تُعرض فعلًا).

### 3) التحقق من محتوى صفحة التفاصيل
- بعد فتح `/en/place/bogazici-bufe-burger-wedujy` نتأكد أن `BusinessGallery`, `OpeningHoursBlock`, header, وأزرار الاتصال تظهر بشكل سليم. التصميم موجود بالفعل في `$lang.place.$slug.tsx` — لا حاجة لإعادة تصميم؛ فقط نتحقق من الظهور بعد إصلاح الرابط والصور.

### 4) (اختياري لهذا الدور) إعادة استيراد التقييمات
لا يتم في هذا الدور لأنه يتطلب إعادة تشغيل خط الاستيراد؛ سأذكر ذلك كخطوة تالية إن أردت.

## Technical notes
- ملف مُعدَّل واحد فقط في الكود: `admin.businesses.tsx` (سطر واحد).
- Migration واحدة قصيرة لاستعادة صفوف `business_images`.
- التحقق: زيارة `/en/place/bogazici-bufe-burger-wedujy` بعد التغيير.
