-- 1. business_images: extra columns for strict classification + soft-delete
ALTER TABLE public.business_images
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'google_places'
    CHECK (source_type IN ('google_places','owner_upload','admin_upload','external_manual')),
  ADD COLUMN IF NOT EXISTS source_title text,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_business_images_deleted_at
  ON public.business_images (deleted_at) WHERE deleted_at IS NULL;

WITH ranked AS (
  SELECT id, business_id,
         row_number() OVER (PARTITION BY business_id ORDER BY sort_order, created_at, id) AS rn
  FROM public.business_images
  WHERE is_cover = true AND deleted_at IS NULL
)
UPDATE public.business_images bi
SET is_cover = false, updated_at = now()
FROM ranked r
WHERE bi.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_images_one_cover
  ON public.business_images (business_id)
  WHERE is_cover = true AND deleted_at IS NULL;

-- 2. Public-safe view (SECURITY INVOKER)
DROP VIEW IF EXISTS public.business_images_public;
CREATE VIEW public.business_images_public
  WITH (security_invoker = true)
AS
SELECT
  bi.id, bi.business_id, bi.r2_url, bi.source_url, bi.storage_status,
  bi.image_type, bi.is_cover, bi.sort_order, bi.width, bi.height,
  bi.source_type, bi.source_title, bi.google_photo_category, bi.uploaded_at
FROM public.business_images bi
WHERE bi.deleted_at IS NULL;

GRANT SELECT ON public.business_images_public TO anon, authenticated;

-- 3. image_processing_jobs
CREATE TABLE IF NOT EXISTS public.image_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_image_id uuid NOT NULL REFERENCES public.business_images(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','retry','uploaded','failed','cancelled')),
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  last_error text,
  last_error_code text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.image_processing_jobs TO authenticated;
GRANT ALL ON public.image_processing_jobs TO service_role;
ALTER TABLE public.image_processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "image_jobs_admin_all" ON public.image_processing_jobs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "image_jobs_owner_read" ON public.image_processing_jobs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.business_images bi
    JOIN public.businesses b ON b.id = bi.business_id
    WHERE bi.id = image_processing_jobs.business_image_id
      AND b.owner_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_image_jobs_status_next
  ON public.image_processing_jobs (status, next_run_at)
  WHERE status IN ('pending','retry','processing');

CREATE UNIQUE INDEX IF NOT EXISTS uq_image_jobs_one_active
  ON public.image_processing_jobs (business_image_id)
  WHERE status IN ('pending','processing','retry');

CREATE TRIGGER trg_image_jobs_updated_at
  BEFORE UPDATE ON public.image_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Suspension helper
CREATE OR REPLACE FUNCTION public.is_suspended(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT status = 'suspended' FROM public.profiles WHERE id = _user), false);
$$;

GRANT EXECUTE ON FUNCTION public.is_suspended(uuid) TO anon, authenticated, service_role;

-- Atomic claim RPC
CREATE OR REPLACE FUNCTION public.claim_next_image_jobs(_worker text, _limit int DEFAULT 1, _lease_seconds int DEFAULT 300)
RETURNS SETOF public.image_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.image_processing_jobs;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'claim_next_image_jobs: forbidden' USING ERRCODE = '42501';
  END IF;
  FOR v_row IN
    UPDATE public.image_processing_jobs j
    SET status = 'processing',
        attempt = j.attempt + 1,
        claimed_at = now(),
        claimed_by = _worker,
        lease_expires_at = now() + make_interval(secs => _lease_seconds),
        updated_at = now()
    WHERE j.id IN (
      SELECT id FROM public.image_processing_jobs
      WHERE status IN ('pending','retry') AND next_run_at <= now()
      ORDER BY next_run_at ASC FOR UPDATE SKIP LOCKED LIMIT _limit
    )
    RETURNING j.*
  LOOP
    RETURN NEXT v_row;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_image_jobs(text, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_next_image_jobs(text, int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.reap_stale_image_jobs()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.image_processing_jobs
  SET status = 'retry', next_run_at = now() + interval '30 seconds',
      last_error = coalesce(last_error, 'lease expired'), updated_at = now()
  WHERE status = 'processing' AND lease_expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stale_image_jobs() FROM public;
GRANT EXECUTE ON FUNCTION public.reap_stale_image_jobs() TO service_role;

-- 4. review_replies
CREATE TABLE IF NOT EXISTS public.review_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('draft','pending_review','published','rejected','superseded')),
  moderated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  moderated_at timestamptz,
  moderation_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.review_replies TO authenticated;
GRANT SELECT ON public.review_replies TO anon;
GRANT ALL ON public.review_replies TO service_role;
ALTER TABLE public.review_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "review_replies_public_read" ON public.review_replies
  FOR SELECT TO anon, authenticated USING (status = 'published');
CREATE POLICY "review_replies_owner_read" ON public.review_replies
  FOR SELECT TO authenticated
  USING (author_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = review_replies.business_id AND b.owner_id = auth.uid()
  ));
CREATE POLICY "review_replies_owner_insert" ON public.review_replies
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid() AND status IN ('draft','pending_review')
    AND NOT public.is_suspended(auth.uid())
    AND EXISTS (SELECT 1 FROM public.businesses b
                WHERE b.id = review_replies.business_id AND b.owner_id = auth.uid())
  );
CREATE POLICY "review_replies_admin_all" ON public.review_replies
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE UNIQUE INDEX IF NOT EXISTS uq_review_replies_one_active
  ON public.review_replies (review_id)
  WHERE status IN ('draft','pending_review','published');

CREATE INDEX IF NOT EXISTS idx_review_replies_business ON public.review_replies (business_id);
CREATE INDEX IF NOT EXISTS idx_review_replies_status ON public.review_replies (status);

CREATE TRIGGER trg_review_replies_updated_at
  BEFORE UPDATE ON public.review_replies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. owner_notifications
CREATE TABLE IF NOT EXISTS public.owner_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.owner_notifications TO authenticated;
GRANT ALL ON public.owner_notifications TO service_role;
ALTER TABLE public.owner_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_notifications_own_read" ON public.owner_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "owner_notifications_own_update" ON public.owner_notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_notifications_admin_all" ON public.owner_notifications
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_owner_notifications_user
  ON public.owner_notifications (user_id, created_at DESC);

-- 6. owner-uploads bucket policies (bucket already exists)
CREATE POLICY "owner_uploads_owner_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'owner-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT public.is_suspended(auth.uid())
  );

CREATE POLICY "owner_uploads_owner_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'owner-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "owner_uploads_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'owner-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "owner_uploads_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'owner-uploads' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'owner-uploads' AND public.has_role(auth.uid(), 'admin'::app_role));