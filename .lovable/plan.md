## التشخيص المؤكد

المشكلة ليست أنك لم تضغط الزر صح. يوجد خلل فعلي في الـ workflow:

- الدفعة `final.json` تم تحليلها فعلاً: فيها `40` عنصر، كلها صالحة، وتم إنشاء `40` صف في عناصر الاستيراد.
- Field mapping موافق عليه فعلاً.
- تم استخراج `46` تصنيف من الملف، وكلها حالياً `approved` ومربوطة بتصنيفات.
- لكن الدفعة بقيت في مرحلة `analyze` بدل أن تنتقل إلى `mapping`.

السبب الجذري: الكود يحاول نقل المرحلة إلى `mapping`، لكن شرط قاعدة البيانات `import_batches_stage_check` لا يسمح بقيمة `mapping` أصلاً؛ يسمح بـ `entity_mapping` بدلها. تحديث المرحلة يفشل، ودالة `advanceStage` لا تفحص الخطأ، لذلك الواجهة تعتقد أن العملية نجحت وتنقلك لصفحة Category mappings، ثم ترجع فتجد نفس الزر لأن المرحلة لم تتغير.

سبب صفحة Category mappings الفارغة: الصفحة تفتح افتراضياً على فلتر `pending`، بينما تصنيفات هذه الدفعة كلها `approved`، فتظهر فارغة رغم وجود البيانات.

## الخطة الجذرية للإصلاح

1. **إصلاح قاعدة البيانات**
   - تعديل شرط مراحل `import_batches` ليقبل المرحلة الفعلية المستخدمة في الكود: `mapping`.
   - الإبقاء على المراحل القديمة/المرادفة عند الحاجة حتى لا تتعطل دفعات سابقة.

2. **منع الفشل الصامت نهائياً**
   - تحديث `advanceStage` حتى يفحص نتيجة تحديث المرحلة.
   - إذا فشل تحديث المرحلة، يظهر خطأ واضح في الواجهة بدل أن يبدو الزر وكأنه “ما عمل شيء”.

3. **إصلاح الدفعة الحالية تلقائياً**
   - بما أن تحليل الدفعة تم فعلاً وتصنيفاتها كلها محلولة، سنجعل المسار يتعافى بأمان:
     - إما نقلها إلى `mapping` إذا نحتاج خطوة تأكيد التصنيفات.
     - أو السماح بزر “Confirm category mappings” بنقلها إلى `validation` بعد التحقق أن كل التصنيفات approved/ignored.

4. **تحسين Category mappings حتى لا تظهر فاضية بشكل مضلل**
   - عندما تكون الصفحة مفتوحة بـ `batchId` وكل التصنيفات محلولة، تعرض رسالة واضحة: “كل تصنيفات هذه الدفعة محلولة، ارجع للدفعة واضغط Continue/Confirm”.
   - إضافة ملخص counts للدفعة: pending / approved / ignored.
   - إذا pending = 0، إظهار زر مباشر “Return and continue import”.

5. **إصلاح أزرار Schema و Field map**
   - عندما يضغط المستخدم Schema أو Field map، لا يكون تغيير رابط فقط؛ الصفحة تعرض محتوى التبويب فعلياً أو رسالة مقفلة واضحة مع زر الإجراء الصحيح.
   - إبقاء الروابط typed وصحيحة بدون `_authenticated` في URL.

6. **توضيح Next Action حسب الحالة الحقيقية**
   - إذا المرحلة `analyze` لكن يوجد items محللة مسبقاً، لا يعرض “Run analysis” مرة أخرى كأنه لم يحدث شيء.
   - يعرض بدلاً من ذلك “Continue to category confirmation” أو “Open resolved category summary” حسب حالة التصنيفات.

7. **التحقق بعد التنفيذ**
   - اختبار الدفعة الحالية حتى تصل بالتسلسل إلى:
     `mapping → validation → preview → execute → translations → images → publish → completed`.
   - التأكد أن كل زر يغيّر الحالة فعلياً وليس الرابط فقط.

## الملفات/الأجزاء التي سيتم تعديلها

- Migration لإصلاح شرط مراحل `import_batches`.
- `src/lib/admin/imports.functions.ts` لإصلاح `advanceStage` ومنع الفشل الصامت والتعامل مع الدفعات المحللة سابقاً.
- `src/routes/$lang._authenticated.admin.imports.tsx` لتحسين next action والانتقال.
- `src/routes/$lang._authenticated.admin.imports.$id.tsx` لتحسين التبويبات وحالة الدفعة الحالية.
- `src/routes/$lang._authenticated.admin.category-mappings.tsx` لإزالة الالتباس عندما لا توجد pending لأن كل شيء approved.

بعد تطبيق الخطة سأتحقق من الدفعة الحالية نفسها، وليس فقط الكود، حتى تتأكد أنك تستطيع الوصول للنشر بسلام.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>