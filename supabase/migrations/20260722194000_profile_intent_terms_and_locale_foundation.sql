-- Phase 2 foundation: registration metadata and future-compatible locale
-- storage. The public app still exposes only tr/en/ar until translations exist.

CREATE TABLE IF NOT EXISTS public.platform_locales (
  code text PRIMARY KEY,
  native_name text NOT NULL,
  english_name text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('ltr', 'rtl')),
  is_public boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_locales_code_format
    CHECK (code ~ '^[a-z]{2,3}(-[A-Z]{2})?$')
);

INSERT INTO public.platform_locales (code, native_name, english_name, direction, is_public, is_enabled, sort_order)
VALUES
  ('tr', 'Türkçe', 'Turkish', 'ltr', true, true, 10),
  ('en', 'English', 'English', 'ltr', true, true, 20),
  ('ar', 'العربية', 'Arabic', 'rtl', true, true, 30)
ON CONFLICT (code) DO UPDATE
  SET native_name = EXCLUDED.native_name,
      english_name = EXCLUDED.english_name,
      direction = EXCLUDED.direction,
      is_public = EXCLUDED.is_public,
      is_enabled = EXCLUDED.is_enabled,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();

DROP TRIGGER IF EXISTS platform_locales_set_updated_at ON public.platform_locales;
CREATE TRIGGER platform_locales_set_updated_at
  BEFORE UPDATE ON public.platform_locales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.platform_locales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_locales_public_read ON public.platform_locales;
CREATE POLICY platform_locales_public_read ON public.platform_locales
  FOR SELECT TO anon, authenticated
  USING (is_public = true AND is_enabled = true);

DROP POLICY IF EXISTS platform_locales_admin_all ON public.platform_locales;
CREATE POLICY platform_locales_admin_all ON public.platform_locales
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.platform_locales TO anon, authenticated;
GRANT ALL ON public.platform_locales TO service_role;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS registration_intent text NOT NULL DEFAULT 'explore'
    CHECK (registration_intent IN ('explore', 'business'));

DO $$
DECLARE
  v_invalid jsonb;
BEGIN
  WITH invalid_values AS (
    SELECT 'profiles' AS table_name, 'preferred_language' AS column_name, preferred_language AS value
    FROM public.profiles
    WHERE preferred_language IS NOT NULL
      AND preferred_language !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    UNION ALL
    SELECT 'businesses', 'original_language', original_language
    FROM public.businesses
    WHERE original_language IS NOT NULL
      AND original_language !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    UNION ALL
    SELECT 'country_translations', 'language_code', language_code
    FROM public.country_translations
    WHERE language_code IS NOT NULL
      AND language_code !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    UNION ALL
    SELECT 'city_translations', 'language_code', language_code
    FROM public.city_translations
    WHERE language_code IS NOT NULL
      AND language_code !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    UNION ALL
    SELECT 'district_translations', 'language_code', language_code
    FROM public.district_translations
    WHERE language_code IS NOT NULL
      AND language_code !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    UNION ALL
    SELECT 'category_translations', 'language_code', language_code
    FROM public.category_translations
    WHERE language_code IS NOT NULL
      AND language_code !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    UNION ALL
    SELECT 'business_translations', 'language_code', language_code
    FROM public.business_translations
    WHERE language_code IS NOT NULL
      AND language_code !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    UNION ALL
    SELECT 'translation_jobs', 'target_language', target_language
    FROM public.translation_jobs
    WHERE target_language IS NOT NULL
      AND target_language !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'table', table_name,
      'column', column_name,
      'value', value
    )
    ORDER BY table_name, column_name, value
  )
  INTO v_invalid
  FROM (
    SELECT DISTINCT table_name, column_name, value
    FROM invalid_values
  ) distinct_invalid;

  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION
      'Unsupported existing locale/language values found before locale constraint migration. Normalize these values first; no data was changed. Invalid values: %',
      v_invalid
      USING ERRCODE = '23514';
  END IF;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND connamespace = 'public'::regnamespace
      AND pg_get_constraintdef(oid) LIKE '%''ar''%'
      AND pg_get_constraintdef(oid) LIKE '%''en''%'
      AND pg_get_constraintdef(oid) LIKE '%''tr''%'
      AND conrelid::regclass::text IN (
        'profiles',
        'businesses',
        'country_translations',
        'city_translations',
        'district_translations',
        'category_translations',
        'business_translations',
        'translation_jobs'
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.table_name, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_language_format
  CHECK (preferred_language ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_original_language_format
  CHECK (original_language IS NULL OR original_language ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

ALTER TABLE public.country_translations
  ADD CONSTRAINT country_translations_language_code_format
  CHECK (language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

ALTER TABLE public.city_translations
  ADD CONSTRAINT city_translations_language_code_format
  CHECK (language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

ALTER TABLE public.district_translations
  ADD CONSTRAINT district_translations_language_code_format
  CHECK (language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

ALTER TABLE public.category_translations
  ADD CONSTRAINT category_translations_language_code_format
  CHECK (language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

ALTER TABLE public.business_translations
  ADD CONSTRAINT business_translations_language_code_format
  CHECK (language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

ALTER TABLE public.translation_jobs
  ADD CONSTRAINT translation_jobs_target_language_format
  CHECK (target_language ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider text;
  v_preferred_language text;
  v_registration_intent text;
  v_terms_accepted_at timestamptz;
BEGIN
  v_preferred_language := CASE
    WHEN NEW.raw_user_meta_data ->> 'preferred_language' ~ '^[a-z]{2,3}(-[A-Z]{2})?$'
      THEN NEW.raw_user_meta_data ->> 'preferred_language'
    ELSE 'tr'
  END;

  v_registration_intent := CASE
    WHEN NEW.raw_user_meta_data ->> 'registration_intent' = 'business'
      THEN 'business'
    ELSE 'explore'
  END;

  v_terms_accepted_at := CASE
    WHEN NEW.raw_user_meta_data ? 'terms_accepted_at'
      THEN (NEW.raw_user_meta_data ->> 'terms_accepted_at')::timestamptz
    ELSE NULL
  END;

  INSERT INTO public.profiles (
    id,
    full_name,
    avatar_url,
    phone,
    preferred_language,
    terms_accepted_at,
    terms_version,
    registration_intent
  )
  VALUES (
    NEW.id,
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'full_name',
                    NEW.raw_user_meta_data ->> 'name', ''), ''),
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'avatar_url',
                    NEW.raw_user_meta_data ->> 'picture', ''), ''),
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'phone', ''), ''),
    v_preferred_language,
    v_terms_accepted_at,
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'terms_version', ''), ''),
    v_registration_intent
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
        phone = COALESCE(EXCLUDED.phone, profiles.phone),
        preferred_language = EXCLUDED.preferred_language,
        terms_accepted_at = COALESCE(EXCLUDED.terms_accepted_at, profiles.terms_accepted_at),
        terms_version = COALESCE(EXCLUDED.terms_version, profiles.terms_version),
        registration_intent = EXCLUDED.registration_intent,
        updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user') ON CONFLICT (user_id, role) DO NOTHING;

  v_provider := NEW.raw_app_meta_data ->> 'provider';
  PERFORM public._try_bootstrap_first_admin(NEW.id, v_provider, NEW.email_confirmed_at);

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;
