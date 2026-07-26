-- Phase E.3: Search experience additions.
-- Additive/idempotent:
--   - expand search_aliases language support to the public Phase E locales
--   - seed conservative multilingual category aliases
--   - include approved category labels and aliases in the existing tsvector
--
-- Rollback:
--   1. Delete unwanted rows inserted into public.search_aliases by alias value.
--   2. Restore maintain_search_vector() and rebuild_search_vectors() from
--      20260726100040_add_description_to_search_vector.sql.
--   3. Re-run public.rebuild_search_vectors().

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'search_aliases_language_code_check'
      AND conrelid = 'public.search_aliases'::regclass
  ) THEN
    ALTER TABLE public.search_aliases
      DROP CONSTRAINT search_aliases_language_code_check;
  END IF;

  ALTER TABLE public.search_aliases
    ADD CONSTRAINT search_aliases_language_code_check
    CHECK (language_code IN ('tr', 'en', 'ar', 'fr', 'ru'));
END $$;

CREATE INDEX IF NOT EXISTS search_aliases_entity_lookup_idx
  ON public.search_aliases (entity_type, entity_id, language_code);

INSERT INTO public.search_aliases (entity_type, entity_id, alias, language_code)
SELECT 'category', c.id, v.alias, v.lang
FROM (VALUES
  ('hotels', 'accommodation', 'en'),
  ('hotels', 'lodging', 'en'),
  ('hotels', 'konaklama', 'tr'),
  ('hotels', 'hôtel', 'fr'),
  ('hotels', 'hotels', 'fr'),
  ('hotels', 'hébergement', 'fr'),
  ('hotels', 'отель', 'ru'),
  ('hotels', 'отели', 'ru'),
  ('hotels', 'гостиница', 'ru'),
  ('clinics', 'dentist', 'en'),
  ('clinics', 'dentists', 'en'),
  ('clinics', 'dental clinic', 'en'),
  ('clinics', 'doctor', 'en'),
  ('clinics', 'medical clinic', 'en'),
  ('clinics', 'dişçi', 'tr'),
  ('clinics', 'disci', 'tr'),
  ('clinics', 'diş kliniği', 'tr'),
  ('clinics', 'doktor', 'tr'),
  ('clinics', 'médecin', 'fr'),
  ('clinics', 'clinique', 'fr'),
  ('clinics', 'dentiste', 'fr'),
  ('clinics', 'стоматолог', 'ru'),
  ('clinics', 'клиника', 'ru'),
  ('clinics', 'врач', 'ru'),
  ('restaurants', 'food', 'en'),
  ('restaurants', 'dining', 'en'),
  ('restaurants', 'eatery', 'en'),
  ('restaurants', 'yemek', 'tr'),
  ('restaurants', 'lokanta', 'tr'),
  ('restaurants', 'restaurant', 'fr'),
  ('restaurants', 'restaurants', 'fr'),
  ('restaurants', 'cuisine', 'fr'),
  ('restaurants', 'ресторан', 'ru'),
  ('restaurants', 'рестораны', 'ru'),
  ('restaurants', 'еда', 'ru'),
  ('cafes', 'coffee', 'en'),
  ('cafes', 'coffee shop', 'en'),
  ('cafes', 'kahve', 'tr'),
  ('cafes', 'café', 'fr'),
  ('cafes', 'cafés', 'fr'),
  ('cafes', 'кофе', 'ru'),
  ('cafes', 'кафе', 'ru')
) AS v(slug, alias, lang)
JOIN public.categories c ON c.slug = v.slug
ON CONFLICT ON CONSTRAINT uq_search_aliases DO NOTHING;

CREATE OR REPLACE FUNCTION public.business_search_alias_text(p_business_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(string_agg(DISTINCT value, ' '), '')
  FROM (
    SELECT ct.name AS value
    FROM public.businesses b
    JOIN public.category_translations ct ON ct.category_id = b.primary_category_id
    WHERE b.id = p_business_id
      AND ct.language_code IN ('tr', 'en', 'ar', 'fr', 'ru')

    UNION

    SELECT ct.name AS value
    FROM public.business_category_links bcl
    JOIN public.category_translations ct ON ct.category_id = bcl.category_id
    WHERE bcl.business_id = p_business_id
      AND ct.language_code IN ('tr', 'en', 'ar', 'fr', 'ru')

    UNION

    SELECT sa.alias AS value
    FROM public.businesses b
    JOIN public.search_aliases sa
      ON sa.entity_type = 'category'
     AND sa.entity_id = b.primary_category_id
    WHERE b.id = p_business_id

    UNION

    SELECT sa.alias AS value
    FROM public.business_category_links bcl
    JOIN public.search_aliases sa
      ON sa.entity_type = 'category'
     AND sa.entity_id = bcl.category_id
    WHERE bcl.business_id = p_business_id
  ) terms
  WHERE value IS NOT NULL AND btrim(value) <> '';
$$;

CREATE OR REPLACE FUNCTION public.maintain_search_vector() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('public.simple_unaccent', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('public.simple_unaccent', coalesce(NEW.slug, '')), 'A') ||
    setweight(to_tsvector('public.simple_unaccent', coalesce(public.business_search_alias_text(NEW.id), '')), 'B') ||
    setweight(to_tsvector('public.simple_unaccent', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_search_vectors() RETURNS void
  LANGUAGE sql AS
$$
  UPDATE public.businesses SET
    search_vector =
      setweight(to_tsvector('public.simple_unaccent', coalesce(name, '')), 'A') ||
      setweight(to_tsvector('public.simple_unaccent', coalesce(slug, '')), 'A') ||
      setweight(to_tsvector('public.simple_unaccent', coalesce(public.business_search_alias_text(id), '')), 'B') ||
      setweight(to_tsvector('public.simple_unaccent', coalesce(description, '')), 'C')
  WHERE status = 'published';
$$;

DROP TRIGGER IF EXISTS trg_businesses_search_vector ON public.businesses;
CREATE TRIGGER trg_businesses_search_vector
  BEFORE INSERT OR UPDATE OF name, slug, description, primary_category_id ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.maintain_search_vector();

SELECT public.rebuild_search_vectors();
