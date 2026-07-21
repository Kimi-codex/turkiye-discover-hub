
-- =====================================================================
-- Phase 2 · M2: locations + categories
-- =====================================================================

-- countries
CREATE TABLE public.countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.countries TO anon, authenticated;
GRANT ALL ON public.countries TO service_role;
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "countries_public_read_active" ON public.countries FOR SELECT
  TO anon, authenticated USING (is_active = true);
CREATE POLICY "countries_admin_all" ON public.countries FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER countries_set_updated_at BEFORE UPDATE ON public.countries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.country_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  language_code text NOT NULL CHECK (language_code IN ('ar', 'en', 'tr')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_id, language_code)
);
CREATE INDEX idx_country_translations_country ON public.country_translations(country_id);
GRANT SELECT ON public.country_translations TO anon, authenticated;
GRANT ALL ON public.country_translations TO service_role;
ALTER TABLE public.country_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "country_translations_public_read" ON public.country_translations FOR SELECT
  TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.countries c WHERE c.id = country_id AND c.is_active = true)
  );
CREATE POLICY "country_translations_admin_all" ON public.country_translations FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER country_translations_set_updated_at BEFORE UPDATE ON public.country_translations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- cities
CREATE TABLE public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE RESTRICT,
  slug text NOT NULL,
  latitude numeric,
  longitude numeric,
  image_url text,
  is_featured boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_id, slug)
);
CREATE INDEX idx_cities_country ON public.cities(country_id);
CREATE INDEX idx_cities_featured ON public.cities(is_featured) WHERE is_featured = true;
GRANT SELECT ON public.cities TO anon, authenticated;
GRANT ALL ON public.cities TO service_role;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cities_public_read_active" ON public.cities FOR SELECT
  TO anon, authenticated USING (is_active = true);
CREATE POLICY "cities_admin_all" ON public.cities FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER cities_set_updated_at BEFORE UPDATE ON public.cities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.city_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  language_code text NOT NULL CHECK (language_code IN ('ar', 'en', 'tr')),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, language_code)
);
CREATE INDEX idx_city_translations_city ON public.city_translations(city_id);
CREATE INDEX idx_city_translations_lang ON public.city_translations(language_code);
GRANT SELECT ON public.city_translations TO anon, authenticated;
GRANT ALL ON public.city_translations TO service_role;
ALTER TABLE public.city_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "city_translations_public_read" ON public.city_translations FOR SELECT
  TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.cities c WHERE c.id = city_id AND c.is_active = true)
  );
CREATE POLICY "city_translations_admin_all" ON public.city_translations FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER city_translations_set_updated_at BEFORE UPDATE ON public.city_translations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- districts
CREATE TABLE public.districts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  slug text NOT NULL,
  latitude numeric,
  longitude numeric,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, slug)
);
CREATE INDEX idx_districts_city ON public.districts(city_id);
GRANT SELECT ON public.districts TO anon, authenticated;
GRANT ALL ON public.districts TO service_role;
ALTER TABLE public.districts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "districts_public_read_active" ON public.districts FOR SELECT
  TO anon, authenticated USING (is_active = true);
CREATE POLICY "districts_admin_all" ON public.districts FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER districts_set_updated_at BEFORE UPDATE ON public.districts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.district_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id uuid NOT NULL REFERENCES public.districts(id) ON DELETE CASCADE,
  language_code text NOT NULL CHECK (language_code IN ('ar', 'en', 'tr')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (district_id, language_code)
);
CREATE INDEX idx_district_translations_district ON public.district_translations(district_id);
GRANT SELECT ON public.district_translations TO anon, authenticated;
GRANT ALL ON public.district_translations TO service_role;
ALTER TABLE public.district_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "district_translations_public_read" ON public.district_translations FOR SELECT
  TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.districts d WHERE d.id = district_id AND d.is_active = true)
  );
CREATE POLICY "district_translations_admin_all" ON public.district_translations FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER district_translations_set_updated_at BEFORE UPDATE ON public.district_translations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- categories
-- =====================================================================
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE,
  icon text,
  image_url text,
  category_type text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_categories_parent ON public.categories(parent_id);
CREATE INDEX idx_categories_active ON public.categories(is_active);
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories_public_read_active" ON public.categories FOR SELECT
  TO anon, authenticated USING (is_active = true);
CREATE POLICY "categories_admin_all" ON public.categories FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.category_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  language_code text NOT NULL CHECK (language_code IN ('ar', 'en', 'tr')),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, language_code)
);
CREATE INDEX idx_category_translations_category ON public.category_translations(category_id);
CREATE INDEX idx_category_translations_lang ON public.category_translations(language_code);
GRANT SELECT ON public.category_translations TO anon, authenticated;
GRANT ALL ON public.category_translations TO service_role;
ALTER TABLE public.category_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "category_translations_public_read" ON public.category_translations FOR SELECT
  TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.categories c WHERE c.id = category_id AND c.is_active = true)
  );
CREATE POLICY "category_translations_admin_all" ON public.category_translations FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER category_translations_set_updated_at BEFORE UPDATE ON public.category_translations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- category_mappings (admin-only)
-- =====================================================================
CREATE TABLE public.category_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_provider text NOT NULL DEFAULT 'google',
  source_category text NOT NULL,
  normalized_source_category text NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  mapping_status text NOT NULL DEFAULT 'pending'
    CHECK (mapping_status IN ('approved', 'pending', 'ignored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_provider, normalized_source_category)
);
GRANT ALL ON public.category_mappings TO service_role;
ALTER TABLE public.category_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "category_mappings_admin_all" ON public.category_mappings FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER category_mappings_set_updated_at BEFORE UPDATE ON public.category_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
