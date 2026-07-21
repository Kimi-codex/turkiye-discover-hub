## سبب الخطأ الفعلي على صفحة `/en/place/bogazici-bufe-burger-wedujy`

- استعلام قاعدة البيانات يعمل، لكن الأعمال المستوردة عندها `city_id = NULL` (40 من أصل 52 عمل منشور). الـ mapper يُرجع `city = {} as City`، فتصبح `business.city.id` قيمتها `undefined`.
- ثم يستدعي loader الصفحة `services.businesses.getSimilar(b, 4)` والذي يبني مرشِّح Supabase:
  ```
  primary_category_id.eq.${id},city_id.eq.${business.city.id}
  ```
  فيصير `city_id.eq.undefined` → PostgREST يُرجع 400 → يُرمى → يلتقطه `errorComponent` → تظهر شاشة "Bir şeyler ters gitti".
- بعد إصلاح الكراش تظهر باقي الحقول عبر fallbacks الموجودة في `pickLocalized`، والصور تُعرض من `source_url` (تم استعادتها في الجولة السابقة).

## الخطة (تغييرات صغيرة، بدون إعادة تصميم)

### 1) `src/lib/repos/supabase-repos.ts` — `getSimilar`
بناء مرشِّح `.or(...)` ديناميكيًا: تضمين `primary_category_id` دائمًا، وتضمين `city_id` فقط عند وجود `business.city?.id`. لن يُرسَل `undefined` أبدًا إلى Supabase.

### 2) `src/routes/$lang.place.$slug.tsx` — عرض متسامح مع غياب city
- `Breadcrumbs`: لا نضيف عنصر المدينة إذا كانت `b.city?.slug` غير موجودة.
- JSON-LD: استخدام `pickLocalized(b.city?.name, "en") || ""` بدلًا من الوصول المباشر (`pickLocalized` أصلًا يعالج `undefined`، لكن `b.city?.name` يبقى أوضح).
- العنوان: عرض `pickLocalized(b.city?.name, locale)` بدون كسر التصميم؛ عند غياب المدينة نُظهر جزء الفئة فقط.

### 3) `src/components/business/BusinessCard.tsx`
تعديل السطر `pickLocalized(business.city.name, locale)` إلى `pickLocalized(business.city?.name, locale)` حتى لا تنكسر بطاقات "Similar" أو أي قوائم تُعرض عمل بدون مدينة.

### 4) التحقق
فتح `/en/place/bogazici-bufe-burger-wedujy` في المتصفح والتأكد من ظهور: صور المعرض، العنوان، النجوم، ساعات العمل، والأزرار — بدون شاشة الخطأ.

## Technical notes
- ثلاث ملفات فقط: `supabase-repos.ts`، `$lang.place.$slug.tsx`، `BusinessCard.tsx`.
- لا تعديل على قاعدة البيانات. ملء `city_id` للأعمال المستوردة عمل منفصل مرتبط بخط الاستيراد وليس ضمن هذا الإصلاح.
