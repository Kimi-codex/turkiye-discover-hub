## الخلاصة بالعربي
المشكلة الظاهرة ليست فقط في النصوص؛ هناك فجوة في تجربة الاستيراد:
- زرّ Next ينفّذ Server Action ثم يبقى المستخدم على نفس البطاقة/التبويب بدون انتقال واضح للخطوة التالية.
- روابط مثل Category mappings موجودة، لكن المستخدم لا يحصل على توجيه تلقائي بعد التحليل، فيبدو كأن الزر لم يعمل.
- صفحة Category mappings تعرض المابينج العالمي فقط، ولا تضمن أن المستخدم يرى فقط التصنيفات الخاصة بالدفعة الحالية؛ لذلك قد تظهر فارغة أو غير مرتبطة بما ضغطت عليه.
- صفحة التفاصيل عند تغيير `tab` قد لا تعطي Feedback كافٍ، خصوصًا بين Analyze → Category mapping → Validation.

## خطة الإصلاح الجذري

### 1. جعل أزرار Next تعمل كتدفّق واضح وليس مجرد Action
- بعد نجاح كل Next Action سيتم نقل المستخدم تلقائيًا إلى المكان الصحيح:
  - Detect schema → صفحة الدفعة تبويب Field Mapping.
  - Approve field mapping → تبويب Analysis.
  - Run analysis → تبويب Categories أو صفحة Category mappings مع فلتر الدفعة.
  - Confirm category mappings → تبويب Validation.
  - Compute preview → تبويب Import.
  - Run import chunk عند الانتهاء → Translations.
  - Translations → Images.
  - Images → Publish.
  - Publish → Completed.
- إضافة Toast/رسالة نجاح واضحة تقول: “تمت الخطوة، انتقل الآن إلى …”.

### 2. إصلاح روابط الإدارة نهائيًا
- مراجعة كل روابط Imports / Field map / Category mappings / Return to batch.
- استخدام TanStack `<Link>` و `navigate` بدل `<a href>` في العودة من صفحة المابينج، حتى لا يتم Reload أو فقدان state.
- ضمان أن الرابط الفعلي للمستخدم يكون مثل:
  - `/:lang/admin/imports/:id?tab=field_mapping`
  - `/:lang/admin/imports/:id?tab=categories`
  - `/:lang/admin/category-mappings?batchId=:id&returnTo=...`

### 3. جعل Category mappings مرتبطة بالدفعة الحالية
- إضافة `batchId` كـ search param في صفحة Category mappings.
- تعديل قراءة المابينج لتدعم فلتر Labels الخاصة بالدفعة الحالية فقط، بدل عرض كل المابينج العالمي فقط.
- إذا لا توجد Labels بعد، تظهر رسالة واضحة: “لم يتم استخراج التصنيفات بعد، ارجع واضغط Run analysis”.
- إذا توجد Labels pending، تعرض فقط المطلوب حله لهذه الدفعة.

### 4. تحسين Bulk Actions في Category mappings
- إبقاء Select all، لكن جعله أوضح دائمًا حتى لو لا يوجد تحديد.
- إضافة أزرار مباشرة:
  - Select all visible
  - Clear selection
  - Apply category to all selected
  - Approve selected
  - Ignore selected
- تعطيل Approve selected مع سبب واضح إذا لم يتم اختيار category.
- إظهار عدّاد: selected / visible / pending.

### 5. تحسين بطاقة الاستيراد والتفاصيل برسالة “ماذا أفعل الآن؟”
- إضافة صندوق Next Action بالعربي/الإنجليزي حسب الواجهة يشرح:
  - أين أنت الآن.
  - لماذا الزر الحالي مطلوب.
  - أين سيذهب بك بعد الضغط.
- في مرحلة Analyze تحديدًا: “اضغط Run analysis؛ بعدها ستظهر التصنيفات في Category mappings”.
- في مرحلة Category mapping: “افتح Category mappings، اختر التصنيف، Approve، ثم ارجع واضغط Continue”.

### 6. معالجة أخطاء Server Actions بوضوح
- عند فشل action مثل وجود pending categories، لا نكتفي بـ toast فقط؛ نعرض رسالة داخل البطاقة مع زر مباشر لفتح صفحة Category mappings بالفلتر الصحيح.
- إظهار status/progress بعد invalidation مباشرة، وليس انتظار refetch interval فقط.

### 7. التحقق بعد التنفيذ
- سأتحقق من:
  - أن الضغط على Next يغيّر المرحلة أو ينقل للتبويب الصحيح.
  - أن Field map لا يعطي 404.
  - أن Category mappings تفتح من الدفعة وتعرض التصنيفات الخاصة بها.
  - أن Bulk Approve يعمل ويعيد المستخدم للدفعة.
  - أن الدفعة لا تبقى “واقف هنا” بدون رسالة واضحة.

## الملفات المتوقع تعديلها
- `src/routes/$lang._authenticated.admin.imports.tsx`
- `src/routes/$lang._authenticated.admin.imports.$id.tsx`
- `src/routes/$lang._authenticated.admin.category-mappings.tsx`
- `src/lib/admin/domain.functions.ts`
- وربما `src/lib/admin/imports.functions.ts` فقط إذا احتجنا endpoint مساعد لإرجاع labels الخاصة بالدفعة.

## النتيجة المتوقعة
بعد الإصلاح، المستخدم لن يحتاج يخمّن. كل زر Next سيأخذه للخطوة التالية أو يفتح الصفحة المطلوبة، وصفحة Category mappings ستعرض مابينج الدفعة نفسها مع bulk actions واضحة.