
-- =====================================================================
-- Phase 2 · M3: businesses + details
-- =====================================================================

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id text NOT NULL UNIQUE,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  original_language text CHECK (original_language IS NULL OR original_language IN ('ar','en','tr')),
  description text,
  primary_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  country_id uuid REFERENCES public.countries(id) ON DELETE SET NULL,
  city_id uuid REFERENCES public.cities(id) ON DELETE SET NULL,
  district_id uuid REFERENCES public.districts(id) ON DELETE SET NULL,
  neighborhood text,
  formatted_address text,
  raw_address text,
  latitude numeric,
  longitude numeric,
  phone text,
  international_phone text,
  email text,
  website text,
  google_maps_url text,
  rating numeric CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  review_count integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  price_level integer CHECK (price_level IS NULL OR (price_level >= 0 AND price_level <= 4)),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'published', 'hidden', 'rejected')),
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('google_json', 'manual', 'owner')),
  source_updated_at timestamptz,
  is_featured boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_businesses_place_id ON public.businesses(place_id);
CREATE INDEX idx_businesses_slug ON public.businesses(slug);
CREATE INDEX idx_businesses_status ON public.businesses(status);
CREATE INDEX idx_businesses_primary_category ON public.businesses(primary_category_id);
CREATE INDEX idx_businesses_city ON public.businesses(city_id);
CREATE INDEX idx_businesses_district ON public.businesses(district_id);
CREATE INDEX idx_businesses_rating ON public.businesses(rating DESC NULLS LAST);
CREATE INDEX idx_businesses_featured ON public.businesses(is_featured) WHERE is_featured = true;
CREATE INDEX idx_businesses_created_at ON public.businesses(created_at DESC);
CREATE INDEX idx_businesses_owner ON public.businesses(owner_id) WHERE owner_id IS NOT NULL;

GRANT SELECT ON public.businesses TO anon, authenticated;
GRANT ALL ON public.businesses TO service_role;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

-- Anonymous + authenticated see only published businesses
CREATE POLICY "businesses_public_read_published" ON public.businesses FOR SELECT
  TO anon, authenticated USING (status = 'published');

-- Owners can view their OWN businesses (any status) — read only
CREATE POLICY "businesses_owner_read_own" ON public.businesses FOR SELECT
  TO authenticated USING (owner_id = auth.uid());

-- Admins have full access
CREATE POLICY "businesses_admin_all" ON public.businesses FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- NOTE: no INSERT/UPDATE/DELETE policies for owners → they cannot mutate
-- core rows directly. Future workflow uses business_change_requests + admin approval.

CREATE TRIGGER businesses_set_updated_at BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- business_category_links
-- =====================================================================
CREATE TABLE public.business_category_links (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, category_id)
);
CREATE INDEX idx_bcl_business ON public.business_category_links(business_id);
CREATE INDEX idx_bcl_category ON public.business_category_links(category_id);
GRANT SELECT ON public.business_category_links TO anon, authenticated;
GRANT ALL ON public.business_category_links TO service_role;
ALTER TABLE public.business_category_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bcl_public_read" ON public.business_category_links FOR SELECT
  TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.status = 'published')
  );
CREATE POLICY "bcl_owner_read" ON public.business_category_links FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = auth.uid())
  );
CREATE POLICY "bcl_admin_all" ON public.business_category_links FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =====================================================================
-- business_images
-- =====================================================================
CREATE TABLE public.business_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  place_id text NOT NULL,
  source_url text,
  source_provider text NOT NULL DEFAULT 'google',
  r2_key text,
  r2_url text,
  content_hash text,
  content_type text,
  file_size bigint,
  width integer,
  height integer,
  image_type text NOT NULL DEFAULT 'gallery'
    CHECK (image_type IN ('cover', 'gallery', 'logo', 'review')),
  is_cover boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  storage_status text NOT NULL DEFAULT 'external_only'
    CHECK (storage_status IN ('pending', 'processing', 'uploaded', 'failed', 'external_only')),
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_business_images_r2_key ON public.business_images(r2_key) WHERE r2_key IS NOT NULL;
CREATE UNIQUE INDEX uq_business_images_source ON public.business_images(business_id, source_url) WHERE source_url IS NOT NULL;
CREATE INDEX idx_business_images_business ON public.business_images(business_id);
CREATE INDEX idx_business_images_place ON public.business_images(place_id);
CREATE INDEX idx_business_images_storage_status ON public.business_images(storage_status);
CREATE INDEX idx_business_images_sort ON public.business_images(business_id, sort_order);
GRANT SELECT ON public.business_images TO anon, authenticated;
GRANT ALL ON public.business_images TO service_role;
ALTER TABLE public.business_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_images_public_read" ON public.business_images FOR SELECT
  TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.status = 'published')
  );
CREATE POLICY "business_images_owner_read" ON public.business_images FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = auth.uid())
  );
CREATE POLICY "business_images_admin_all" ON public.business_images FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER business_images_set_updated_at BEFORE UPDATE ON public.business_images
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- business_opening_hours
-- =====================================================================
CREATE TABLE public.business_opening_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time time,
  close_time time,
  is_closed boolean NOT NULL DEFAULT false,
  raw_value text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_boh_business ON public.business_opening_hours(business_id);
GRANT SELECT ON public.business_opening_hours TO anon, authenticated;
GRANT ALL ON public.business_opening_hours TO service_role;
ALTER TABLE public.business_opening_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "boh_public_read" ON public.business_opening_hours FOR SELECT
  TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.status = 'published')
  );
CREATE POLICY "boh_owner_read" ON public.business_opening_hours FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = auth.uid())
  );
CREATE POLICY "boh_admin_all" ON public.business_opening_hours FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =====================================================================
-- business_attributes
-- =====================================================================
CREATE TABLE public.business_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  attribute_key text NOT NULL,
  value jsonb,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ba_business ON public.business_attributes(business_id);
CREATE INDEX idx_ba_key ON public.business_attributes(attribute_key);
GRANT SELECT ON public.business_attributes TO anon, authenticated;
GRANT ALL ON public.business_attributes TO service_role;
ALTER TABLE public.business_attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ba_public_read" ON public.business_attributes FOR SELECT
  TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.status = 'published')
  );
CREATE POLICY "ba_owner_read" ON public.business_attributes FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = auth.uid())
  );
CREATE POLICY "ba_admin_all" ON public.business_attributes FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =====================================================================
-- business_services
-- =====================================================================
CREATE TABLE public.business_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  service_key text NOT NULL,
  value jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bs_business ON public.business_services(business_id);
GRANT SELECT ON public.business_services TO anon, authenticated;
GRANT ALL ON public.business_services TO service_role;
ALTER TABLE public.business_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bs_public_read" ON public.business_services FOR SELECT
  TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.status = 'published')
  );
CREATE POLICY "bs_owner_read" ON public.business_services FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = auth.uid())
  );
CREATE POLICY "bs_admin_all" ON public.business_services FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =====================================================================
-- business_translations
-- =====================================================================
CREATE TABLE public.business_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  language_code text NOT NULL CHECK (language_code IN ('ar', 'en', 'tr')),
  translated_name text,
  translated_description text,
  translated_services jsonb,
  source_content_hash text,
  translation_status text NOT NULL DEFAULT 'pending'
    CHECK (translation_status IN ('pending', 'translated', 'approved', 'failed', 'outdated')),
  translated_by text,
  translated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, language_code)
);
CREATE INDEX idx_bt_business ON public.business_translations(business_id);
CREATE INDEX idx_bt_lang ON public.business_translations(language_code);
CREATE INDEX idx_bt_status ON public.business_translations(translation_status);
GRANT SELECT ON public.business_translations TO anon, authenticated;
GRANT ALL ON public.business_translations TO service_role;
ALTER TABLE public.business_translations ENABLE ROW LEVEL SECURITY;
-- Public visibility ONLY for approved translations of published businesses
CREATE POLICY "bt_public_read_approved" ON public.business_translations FOR SELECT
  TO anon, authenticated USING (
    translation_status = 'approved'
    AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.status = 'published')
  );
CREATE POLICY "bt_admin_all" ON public.business_translations FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER bt_set_updated_at BEFORE UPDATE ON public.business_translations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
