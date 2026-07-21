
-- =====================================================================
-- Phase 2 · M4: user + operational tables
-- =====================================================================

-- =====================================================================
-- reviews
-- =====================================================================
CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  external_review_id text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('google', 'platform')),
  author_name text,
  author_avatar_url text,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text text,
  review_language text,
  owner_reply text,
  owner_reply_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'hidden', 'rejected')),
  review_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_reviews_external ON public.reviews(external_review_id) WHERE external_review_id IS NOT NULL;
CREATE INDEX idx_reviews_business ON public.reviews(business_id);
CREATE INDEX idx_reviews_status ON public.reviews(status);
CREATE INDEX idx_reviews_review_date ON public.reviews(review_date DESC);
CREATE INDEX idx_reviews_user ON public.reviews(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_reviews_source ON public.reviews(source);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;
GRANT SELECT ON public.reviews TO anon;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Public: published reviews on published businesses
CREATE POLICY "reviews_public_read_published" ON public.reviews FOR SELECT
  TO anon, authenticated USING (
    status = 'published'
    AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.status = 'published')
  );

-- Authenticated: own pending/hidden/rejected (never other users')
CREATE POLICY "reviews_own_read" ON public.reviews FOR SELECT
  TO authenticated USING (user_id = auth.uid());

-- Admin: full read
CREATE POLICY "reviews_admin_read" ON public.reviews FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

-- INSERT: only platform reviews as self
CREATE POLICY "reviews_insert_own_platform" ON public.reviews FOR INSERT
  TO authenticated WITH CHECK (
    source = 'platform'
    AND user_id = auth.uid()
    AND status = 'pending'
    AND external_review_id IS NULL
  );

-- UPDATE: only own platform reviews; source/user_id immutable
CREATE POLICY "reviews_update_own_platform" ON public.reviews FOR UPDATE
  TO authenticated USING (
    source = 'platform' AND user_id = auth.uid()
  ) WITH CHECK (
    source = 'platform' AND user_id = auth.uid()
  );

-- DELETE: only own platform reviews
CREATE POLICY "reviews_delete_own_platform" ON public.reviews FOR DELETE
  TO authenticated USING (
    source = 'platform' AND user_id = auth.uid()
  );

-- Admin manage
CREATE POLICY "reviews_admin_manage" ON public.reviews FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- favorites
-- =====================================================================
CREATE TABLE public.favorites (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id)
);
CREATE INDEX idx_favorites_business ON public.favorites(business_id);
GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.favorites TO service_role;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorites_own_read" ON public.favorites FOR SELECT
  TO authenticated USING (user_id = auth.uid());
CREATE POLICY "favorites_own_insert" ON public.favorites FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "favorites_own_delete" ON public.favorites FOR DELETE
  TO authenticated USING (user_id = auth.uid());
CREATE POLICY "favorites_admin_read" ON public.favorites FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- =====================================================================
-- reports (private)
-- =====================================================================
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  review_id uuid REFERENCES public.reviews(id) ON DELETE SET NULL,
  image_id uuid REFERENCES public.business_images(id) ON DELETE SET NULL,
  report_type text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'under_review', 'resolved', 'dismissed')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_reports_reporter ON public.reports(reporter_id);
CREATE INDEX idx_reports_business ON public.reports(business_id);
CREATE INDEX idx_reports_status ON public.reports(status);
CREATE INDEX idx_reports_created_at ON public.reports(created_at DESC);

GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Reporter reads only their own reports (admin_notes column is filtered in
-- server responses via explicit select() lists; RLS blocks other users entirely).
CREATE POLICY "reports_own_read" ON public.reports FOR SELECT
  TO authenticated USING (reporter_id = auth.uid());

CREATE POLICY "reports_own_insert" ON public.reports FOR INSERT
  TO authenticated WITH CHECK (
    reporter_id = auth.uid()
    AND status = 'new'
    AND admin_notes IS NULL
    AND resolved_at IS NULL
    AND resolved_by IS NULL
  );

CREATE POLICY "reports_moderator_read" ON public.reports FOR SELECT
  TO authenticated USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  );

CREATE POLICY "reports_admin_manage" ON public.reports FOR ALL
  TO authenticated USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  );

-- =====================================================================
-- ownership_claims
-- =====================================================================
CREATE TABLE public.ownership_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  business_email text,
  evidence_urls jsonb,
  message text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_oc_business ON public.ownership_claims(business_id);
CREATE INDEX idx_oc_user ON public.ownership_claims(user_id);
CREATE INDEX idx_oc_status ON public.ownership_claims(status);

GRANT SELECT, INSERT ON public.ownership_claims TO authenticated;
GRANT ALL ON public.ownership_claims TO service_role;
ALTER TABLE public.ownership_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oc_own_read" ON public.ownership_claims FOR SELECT
  TO authenticated USING (user_id = auth.uid());
CREATE POLICY "oc_own_insert" ON public.ownership_claims FOR INSERT
  TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND admin_notes IS NULL
  );
CREATE POLICY "oc_admin_all" ON public.ownership_claims FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =====================================================================
-- business_change_requests
-- =====================================================================
CREATE TABLE public.business_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  changes jsonb NOT NULL,
  original_values jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_bcr_business ON public.business_change_requests(business_id);
CREATE INDEX idx_bcr_submitted_by ON public.business_change_requests(submitted_by);
CREATE INDEX idx_bcr_status ON public.business_change_requests(status);

GRANT SELECT, INSERT ON public.business_change_requests TO authenticated;
GRANT ALL ON public.business_change_requests TO service_role;
ALTER TABLE public.business_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bcr_own_read" ON public.business_change_requests FOR SELECT
  TO authenticated USING (submitted_by = auth.uid());
-- Only owners of the business may submit change requests
CREATE POLICY "bcr_owner_insert" ON public.business_change_requests FOR INSERT
  TO authenticated WITH CHECK (
    submitted_by = auth.uid()
    AND status = 'pending'
    AND admin_notes IS NULL
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_id AND b.owner_id = auth.uid()
    )
  );
CREATE POLICY "bcr_admin_all" ON public.business_change_requests FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =====================================================================
-- Future-ready tables (schema only, admin-managed)
-- =====================================================================
CREATE TABLE public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  total_items integer NOT NULL DEFAULT 0,
  processed_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  metadata jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX idx_import_batches_status ON public.import_batches(status);
CREATE INDEX idx_import_batches_created_at ON public.import_batches(created_at DESC);
GRANT ALL ON public.import_batches TO service_role;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "import_batches_admin_all" ON public.import_batches FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER import_batches_set_updated_at BEFORE UPDATE ON public.import_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.import_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  place_id text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX idx_ibi_batch ON public.import_batch_items(import_batch_id);
CREATE INDEX idx_ibi_status ON public.import_batch_items(status);
GRANT ALL ON public.import_batch_items TO service_role;
ALTER TABLE public.import_batch_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ibi_admin_all" ON public.import_batch_items FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.translation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  target_language text NOT NULL CHECK (target_language IN ('ar', 'en', 'tr')),
  status text NOT NULL DEFAULT 'pending',
  provider text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX idx_tj_business ON public.translation_jobs(business_id);
CREATE INDEX idx_tj_status ON public.translation_jobs(status);
CREATE INDEX idx_tj_target_lang ON public.translation_jobs(target_language);
GRANT ALL ON public.translation_jobs TO service_role;
ALTER TABLE public.translation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tj_admin_all" ON public.translation_jobs FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER tj_set_updated_at BEFORE UPDATE ON public.translation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ae_event_type ON public.analytics_events(event_type);
CREATE INDEX idx_ae_user ON public.analytics_events(user_id);
CREATE INDEX idx_ae_business ON public.analytics_events(business_id);
CREATE INDEX idx_ae_created_at ON public.analytics_events(created_at DESC);
GRANT ALL ON public.analytics_events TO service_role;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ae_admin_all" ON public.analytics_events FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_settings_public_read" ON public.site_settings FOR SELECT
  TO anon, authenticated USING (is_public = true);
CREATE POLICY "site_settings_admin_all" ON public.site_settings FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER site_settings_set_updated_at BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_al_actor ON public.audit_logs(actor_id);
CREATE INDEX idx_al_action ON public.audit_logs(action);
CREATE INDEX idx_al_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX idx_al_created_at ON public.audit_logs(created_at DESC);
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "al_admin_read" ON public.audit_logs FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
