-- Phase D: Search aliases table — replaces hardcoded CATEGORY_ALIASES.
-- Additive and idempotent. Safe to run at any time.

CREATE TABLE IF NOT EXISTS public.search_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('category', 'city', 'district')),
  entity_id UUID NOT NULL,
  alias TEXT NOT NULL,
  language_code TEXT NOT NULL CHECK (language_code IN ('tr', 'en', 'ar')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_search_aliases
  ON public.search_aliases (entity_type, entity_id, alias);

CREATE INDEX IF NOT EXISTS search_aliases_lookup_idx
  ON public.search_aliases (alias text_pattern_ops, entity_type);

-- Seed from existing category translations
INSERT INTO public.search_aliases (entity_type, entity_id, alias, language_code)
SELECT 'category', c.id, ct.name, ct.language_code
FROM public.categories c
JOIN public.category_translations ct ON ct.category_id = c.id
WHERE ct.name IS NOT NULL
  AND ct.language_code IN ('tr', 'en', 'ar')
ON CONFLICT ON CONSTRAINT uq_search_aliases DO NOTHING;

-- Seed from existing city translations
INSERT INTO public.search_aliases (entity_type, entity_id, alias, language_code)
SELECT 'city', ct2.city_id, ct2.name, ct2.language_code
FROM public.city_translations ct2
WHERE ct2.name IS NOT NULL
  AND ct2.language_code IN ('tr', 'en', 'ar')
ON CONFLICT ON CONSTRAINT uq_search_aliases DO NOTHING;

-- Seed hardcoded aliases (matches existing CATEGORY_ALIASES in parseIntent.ts)
INSERT INTO public.search_aliases (entity_type, entity_id, alias, language_code)
SELECT 'category', c.id, unnest(v.aliases), v.lang
FROM (VALUES
  ('hotels', ARRAY['otel', 'oteller'], 'tr'),
  ('hotels', ARRAY['hotel', 'hotels'], 'en'),
  ('hotels', ARRAY['فندق', 'فنادق'], 'ar'),
  ('clinics', ARRAY['klinik', 'klinikler'], 'tr'),
  ('clinics', ARRAY['clinic', 'clinics'], 'en'),
  ('clinics', ARRAY['عيادة', 'عيادات'], 'ar'),
  ('restaurants', ARRAY['restoran', 'restoranlar'], 'tr'),
  ('restaurants', ARRAY['restaurant', 'restaurants'], 'en'),
  ('restaurants', ARRAY['مطعم', 'مطاعم'], 'ar'),
  ('cafes', ARRAY['kafe', 'kafeler'], 'tr'),
  ('cafes', ARRAY['cafe', 'cafes'], 'en'),
  ('cafes', ARRAY['مقهى', 'مقاهي'], 'ar')
) AS v(slug, aliases, lang)
JOIN public.categories c ON c.slug = v.slug
ON CONFLICT ON CONSTRAINT uq_search_aliases DO NOTHING;

GRANT SELECT ON public.search_aliases TO anon, authenticated;
