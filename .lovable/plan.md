## التشخيص بالعربي

المشكلة ليست في خطوة واحدة؛ عندنا التباس بين نوعين من الـMapping:

1. **Field Mapping**
   - هذا داخل Batch الاستيراد نفسه.
   - معناه: ربط حقول ملف JSON مثل `business.name` / `reviews[].rating` مع حقول النظام مثل `name`, `rating`, `phone`.
   - مكانه الصحيح: صفحة الاستيراد نفسها، تبويب **Field mapping**.

2. **Category Mapping**
   - هذا شاشة عامة في الأدمن.
   - معناه: ربط تصنيفات المصدر مثل `restoran`, `bistro`, `kafe` مع كاتالوج التصنيفات عندنا مثل `Restaurants`.
   - مكانه الحالي: **Admin → Category Mappings**.

سبب الوقوف عند مرحلة التحليل/التصنيفات: بعد الضغط على **Run analysis** النظام يكتشف تصنيفات المصدر وينقل الـBatch إلى مرحلة **Category mapping**. بعدها لازم توافق على التصنيفات، ثم ترجع إلى Batch الاستيراد وتضغط **Confirm category mappings** للانتقال إلى Validation/Preview. الواجهة الحالية لا تشرح هذا بوضوح، لذلك يظهر وكأنه واقف.

سبب 404 في زر **Field map**: في الكود أزرار `Open / Schema / Field map` تستخدم route داخلي فيه `_authenticated`. هذا Route ID داخلي وليس URL المستخدم النهائي. سأثبت الروابط على مسارات الأدمن العامة مثل:

```text
/:lang/admin/imports/:id?tab=field_mapping
```

بدل الاعتماد على المسار الداخلي، حتى لا يفتح 404 في النسخة المنشورة.

## خطة الإصلاح الجذري

### 1. إصلاح روابط Import quick links
- تعديل روابط **Open / Schema / Field map** في بطاقة الاستيراد لاستخدام مسارات URL العامة.
- إصلاح روابط داخل صفحة Batch مثل روابط **Images admin** و **Translations admin** التي تستخدم حاليًا `.` وتبقى على نفس الصفحة.
- التأكد أن زر **Field map** يفتح نفس الـBatch مباشرة على تبويب Field mapping بدون 404.

### 2. توضيح Workflow في مرحلة Analyze وCategory Mapping
- تغيير نص مرحلة `mapping` من مجرد **Categories** إلى **Category mapping**.
- في بطاقة الاستيراد، إذا الـBatch وصل مرحلة Category mapping:
  - لا يكون الزر مضللًا كأنه سيكمل كل شيء تلقائيًا.
  - يظهر بوضوح: **Review category mappings**.
  - يظهر شرح: “Approve or ignore source category labels, then return here to continue.”
- في صفحة تفاصيل الاستيراد، تبويب Categories سيعرض:
  - عدد التصنيفات المكتشفة.
  - عدد الموافق عليها.
  - عدد التي ما زالت pending.
  - زر واضح: **Open Category Mappings**.
  - زر واضح بعد الانتهاء: **Continue to validation**.

### 3. منع التقدم الخاطئ إذا التصنيفات ما زالت Pending
- تعديل guard في `confirmImportMappings` حتى لا ينقل الـBatch إلى Validation إذا ما زالت هناك category mappings معلقة.
- اعتبر الحالات كالتالي:
  - `approved` = جاهزة.
  - `ignored` = قرار إداري مقصود، ليست pending.
  - `pending` أو missing = تمنع التقدم وتظهر رسالة واضحة.
- لا يوجد تغيير Database أو Migration؛ فقط منطق server function الحالي.

### 4. إضافة Bulk actions لصفحة Category Mappings
- إضافة checkbox في رأس الجدول لاختيار كل الصفوف الظاهرة.
- إضافة toolbar عند الاختيار يحتوي:
  - عدد العناصر المختارة.
  - Dropdown لاختيار Category واحدة للكل.
  - زر **Apply category to selected**.
  - زر **Approve selected**.
  - زر **Ignore selected**.
  - زر **Clear selection**.
- استخدام نفس server function الحالية `setCategoryMappingAdmin`؛ لا نحتاج DB جديد.

### 5. Return flow بعد Category Mapping
- عندما تفتح Category Mappings من داخل Batch، أضيف `returnTo` في الرابط.
- بعد تنفيذ bulk approve أو approve عادي، تظهر زر واضح: **Return to import batch**.
- هذا يحل مشكلة: “وافقت على الكاتيجوري، أرجع وين وأسوي إيش؟”.

### 6. تحسين رسائل Next Action بدون إعادة تصميم
- أزرار Next تبقى موجودة كما هي، لكن الوصف تحتها يشرح المطلوب فعليًا.
- في مرحلة `analyze`: النص يوضح أن الخطوة التالية ستكون مراجعة Category mappings.
- في مرحلة `mapping`: النص يوضح أن التقدم يعتمد على إنهاء Category mappings أولًا.

## خارج النطاق
- لا تغيير في قاعدة البيانات.
- لا تغيير في R2 أو الصور.
- لا إعادة تصميم كاملة.
- لا تشغيل تلقائي للمراحل؛ سيبقى workflow يدوي كما طلبت.

## التحقق بعد التنفيذ
- الضغط على **Field map** من بطاقة `final.json` يفتح صفحة Batch على تبويب Field mapping بدون 404.
- اختيار كل Category mappings الظاهرة وتحديد `Restaurants` ثم **Approve selected** يعمل دفعة واحدة.
- الرجوع إلى Batch يظهر أن التصنيفات صارت جاهزة.
- الضغط على **Continue / Confirm category mappings** ينقل المرحلة إلى Validation فقط إذا لا توجد pending mappings.
- إذا بقيت pending mappings، تظهر رسالة واضحة بدل أن يتقدم النظام بصمت.