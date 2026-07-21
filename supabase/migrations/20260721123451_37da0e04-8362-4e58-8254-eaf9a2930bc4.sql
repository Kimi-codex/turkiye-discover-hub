
-- 1. Businesses: popular times storage (Google popular_times)
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS popular_times jsonb;

-- 2. Business images: Google photo classification + labels
ALTER TABLE public.business_images
  ADD COLUMN IF NOT EXISTS google_photo_category text,
  ADD COLUMN IF NOT EXISTS google_photo_labels jsonb;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_images_google_photo_category_check'
  ) THEN
    ALTER TABLE public.business_images
      ADD CONSTRAINT business_images_google_photo_category_check
      CHECK (
        google_photo_category IS NULL OR google_photo_category = ANY (
          ARRAY['cover','exterior','interior','food','menu','product','logo','staff','other']
        )
      );
  END IF;
END $$;

-- 3. Reports: internal notes
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS internal_notes text;

-- 4. Reviews: admin moderation notes
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS admin_notes text;

-- 5. Site settings defaults (admin-visible only via existing policy)
INSERT INTO public.site_settings (key, value, is_public, description) VALUES
  ('import.default_status', '"pending_review"'::jsonb, false, 'Default status for newly imported businesses'),
  ('import.preserve_curated_fields', 'true'::jsonb, false, 'When true, admin/owner/translation-sourced fields are never overwritten by imports'),
  ('import.require_known_city', 'false'::jsonb, false, 'Reject imports that cannot resolve to a known city'),
  ('import.require_category_mapping', 'false'::jsonb, false, 'Reject imports whose primary category has no approved mapping'),
  ('reviews.auto_publish', 'false'::jsonb, false, 'Auto-publish imported Google reviews (else pending)'),
  ('images.queue_after_import', 'false'::jsonb, false, 'When true, image rows are queued for R2 processing after import (Phase 4)')
ON CONFLICT (key) DO NOTHING;

-- 6. Bootstrap admin: revoke public/authenticated execute so it can only run via service_role after first setup
REVOKE ALL ON FUNCTION public.bootstrap_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_admin(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.bootstrap_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_admin(uuid) TO service_role;

-- 7. Helpful moderation indexes
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);
CREATE INDEX IF NOT EXISTS idx_reviews_business_status ON public.reviews(business_id, status);
CREATE INDEX IF NOT EXISTS idx_category_mappings_status ON public.category_mappings(mapping_status);
CREATE INDEX IF NOT EXISTS idx_ibi_batch_status ON public.import_batch_items(import_batch_id, status);
CREATE INDEX IF NOT EXISTS idx_business_images_google_category ON public.business_images(google_photo_category) WHERE google_photo_category IS NOT NULL;

-- 8. Ensure updated_at trigger exists on reviews/reports/etc. (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_business_images_updated_at') THEN
    CREATE TRIGGER trg_business_images_updated_at BEFORE UPDATE ON public.business_images
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reviews_updated_at') THEN
    CREATE TRIGGER trg_reviews_updated_at BEFORE UPDATE ON public.reviews
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reports_updated_at') THEN
    CREATE TRIGGER trg_reports_updated_at BEFORE UPDATE ON public.reports
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
