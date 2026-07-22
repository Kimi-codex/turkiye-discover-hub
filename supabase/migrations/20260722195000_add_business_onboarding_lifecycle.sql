-- Business onboarding V1 foundation: private submissions, documents, images,
-- applicant notifications, and lifecycle history.

CREATE TABLE IF NOT EXISTS public.business_onboarding_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  submission_type text NOT NULL
    CHECK (submission_type IN ('new_business', 'existing_business_verification')),
  target_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'submitted',
      'under_review',
      'changes_requested',
      'additional_documents_required',
      'approved',
      'rejected',
      'withdrawn'
    )),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  locale_draft text CHECK (locale_draft IS NULL OR locale_draft ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  business_name_localized jsonb NOT NULL DEFAULT '{}'::jsonb,
  business_description_localized jsonb NOT NULL DEFAULT '{}'::jsonb,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  services_localized jsonb NOT NULL DEFAULT '{}'::jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarding_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  commercial_registration_number text,
  commercial_registration_legal_name text,
  commercial_registration_country text,
  commercial_registration_issued_at date,
  commercial_registration_expires_at date,
  applicant_full_name text,
  applicant_phone text,
  applicant_role text,
  applicant_business_email text,
  declaration_accepted_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_decision text CHECK (admin_decision IS NULL OR admin_decision IN ('approve_draft', 'approve_publish', 'changes_requested', 'additional_documents_required', 'reject')),
  admin_notes_private text,
  applicant_message_key text,
  applicant_message_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  source_submission_id uuid REFERENCES public.business_onboarding_submissions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bos_target_required_for_existing
    CHECK (submission_type <> 'existing_business_verification' OR target_business_id IS NOT NULL),
  CONSTRAINT bos_target_absent_for_new
    CHECK (submission_type <> 'new_business' OR target_business_id IS NULL),
  CONSTRAINT bos_localized_objects
    CHECK (
      jsonb_typeof(business_name_localized) = 'object'
      AND jsonb_typeof(business_description_localized) = 'object'
      AND jsonb_typeof(services_localized) = 'object'
      AND jsonb_typeof(attributes) = 'object'
      AND jsonb_typeof(contact) = 'object'
      AND jsonb_typeof(address) = 'object'
      AND jsonb_typeof(social_links) = 'object'
      AND jsonb_typeof(onboarding_content) = 'object'
      AND jsonb_typeof(categories) = 'array'
    )
);

CREATE INDEX IF NOT EXISTS idx_bos_applicant_created
  ON public.business_onboarding_submissions (applicant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bos_status_created
  ON public.business_onboarding_submissions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bos_target
  ON public.business_onboarding_submissions (target_business_id) WHERE target_business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bos_approved_business
  ON public.business_onboarding_submissions (approved_business_id) WHERE approved_business_id IS NOT NULL;

DROP TRIGGER IF EXISTS business_onboarding_submissions_set_updated_at ON public.business_onboarding_submissions;
CREATE TRIGGER business_onboarding_submissions_set_updated_at
  BEFORE UPDATE ON public.business_onboarding_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT ON public.business_onboarding_submissions TO authenticated;
GRANT UPDATE (
  locale_draft,
  business_name_localized,
  business_description_localized,
  categories,
  services_localized,
  attributes,
  contact,
  address,
  social_links,
  onboarding_content,
  commercial_registration_number,
  commercial_registration_legal_name,
  commercial_registration_country,
  commercial_registration_issued_at,
  commercial_registration_expires_at,
  applicant_full_name,
  applicant_phone,
  applicant_role,
  applicant_business_email,
  declaration_accepted_at
) ON public.business_onboarding_submissions TO authenticated;
GRANT ALL ON public.business_onboarding_submissions TO service_role;
ALTER TABLE public.business_onboarding_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bos_applicant_read ON public.business_onboarding_submissions;
CREATE POLICY bos_applicant_read ON public.business_onboarding_submissions
  FOR SELECT TO authenticated
  USING (applicant_id = auth.uid());

DROP POLICY IF EXISTS bos_applicant_insert ON public.business_onboarding_submissions;
CREATE POLICY bos_applicant_insert ON public.business_onboarding_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    applicant_id = auth.uid()
    AND status = 'draft'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND admin_decision IS NULL
    AND approved_business_id IS NULL
    AND NOT public.is_suspended(auth.uid())
  );

DROP POLICY IF EXISTS bos_applicant_update ON public.business_onboarding_submissions;
CREATE POLICY bos_applicant_update ON public.business_onboarding_submissions
  FOR UPDATE TO authenticated
  USING (
    applicant_id = auth.uid()
    AND status IN ('draft', 'changes_requested')
  )
  WITH CHECK (
    applicant_id = auth.uid()
    AND status IN ('draft', 'changes_requested')
    AND approved_business_id IS NULL
    AND NOT public.is_suspended(auth.uid())
  );

DROP POLICY IF EXISTS bos_admin_all ON public.business_onboarding_submissions;
CREATE POLICY bos_admin_all ON public.business_onboarding_submissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.business_onboarding_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.business_onboarding_submissions(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type text NOT NULL
    CHECK (document_type IN ('commercial_registration', 'additional_document')),
  storage_bucket text NOT NULL DEFAULT 'business-verification-documents',
  storage_path text NOT NULL,
  original_filename text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'removed')),
  replaced_by uuid REFERENCES public.business_onboarding_documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_bod_submission
  ON public.business_onboarding_documents (submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bod_uploaded_by
  ON public.business_onboarding_documents (uploaded_by, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bod_one_active_registration
  ON public.business_onboarding_documents (submission_id)
  WHERE document_type = 'commercial_registration' AND status = 'active';

DROP TRIGGER IF EXISTS business_onboarding_documents_set_updated_at ON public.business_onboarding_documents;
CREATE TRIGGER business_onboarding_documents_set_updated_at
  BEFORE UPDATE ON public.business_onboarding_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT ON public.business_onboarding_documents TO authenticated;
GRANT ALL ON public.business_onboarding_documents TO service_role;
ALTER TABLE public.business_onboarding_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bod_applicant_read ON public.business_onboarding_documents;
CREATE POLICY bod_applicant_read ON public.business_onboarding_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_onboarding_submissions s
      WHERE s.id = submission_id AND s.applicant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS bod_applicant_insert ON public.business_onboarding_documents;
CREATE POLICY bod_applicant_insert ON public.business_onboarding_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND storage_bucket = 'business-verification-documents'
    AND (storage.foldername(storage_path))[1] = auth.uid()::text
    AND (storage.foldername(storage_path))[2] = 'submissions'
    AND (storage.foldername(storage_path))[3] = submission_id::text
    AND (storage.foldername(storage_path))[4] = 'documents'
    AND EXISTS (
      SELECT 1 FROM public.business_onboarding_submissions s
      WHERE s.id = submission_id
        AND s.applicant_id = auth.uid()
        AND s.status IN ('draft', 'changes_requested')
    )
    AND NOT public.is_suspended(auth.uid())
  );

DROP POLICY IF EXISTS bod_applicant_update ON public.business_onboarding_documents;

DROP POLICY IF EXISTS bod_admin_all ON public.business_onboarding_documents;
CREATE POLICY bod_admin_all ON public.business_onboarding_documents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.business_onboarding_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.business_onboarding_submissions(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'business-onboarding-images',
  storage_path text NOT NULL,
  original_filename text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  image_type text NOT NULL DEFAULT 'gallery'
    CHECK (image_type IN ('cover', 'gallery', 'logo')),
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  approved_business_image_id uuid REFERENCES public.business_images(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_boi_submission
  ON public.business_onboarding_images (submission_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_boi_uploaded_by
  ON public.business_onboarding_images (uploaded_by, created_at DESC);

DROP TRIGGER IF EXISTS business_onboarding_images_set_updated_at ON public.business_onboarding_images;
CREATE TRIGGER business_onboarding_images_set_updated_at
  BEFORE UPDATE ON public.business_onboarding_images
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_business_onboarding_image_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.status <> 'removed' THEN
    SELECT count(*) INTO v_count
    FROM public.business_onboarding_images
    WHERE submission_id = NEW.submission_id
      AND status <> 'removed'
      AND id IS DISTINCT FROM NEW.id;

    IF v_count >= 10 THEN
      RAISE EXCEPTION 'business_onboarding_images: maximum 10 active images per submission' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_business_onboarding_image_limit ON public.business_onboarding_images;
CREATE TRIGGER trg_business_onboarding_image_limit
  BEFORE INSERT OR UPDATE OF status, submission_id ON public.business_onboarding_images
  FOR EACH ROW EXECUTE FUNCTION public.enforce_business_onboarding_image_limit();

GRANT SELECT, INSERT ON public.business_onboarding_images TO authenticated;
GRANT ALL ON public.business_onboarding_images TO service_role;
ALTER TABLE public.business_onboarding_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boi_applicant_read ON public.business_onboarding_images;
CREATE POLICY boi_applicant_read ON public.business_onboarding_images
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_onboarding_submissions s
      WHERE s.id = submission_id AND s.applicant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS boi_applicant_insert ON public.business_onboarding_images;
CREATE POLICY boi_applicant_insert ON public.business_onboarding_images
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND status = 'pending'
    AND storage_bucket = 'business-onboarding-images'
    AND (storage.foldername(storage_path))[1] = auth.uid()::text
    AND (storage.foldername(storage_path))[2] = 'submissions'
    AND (storage.foldername(storage_path))[3] = submission_id::text
    AND (storage.foldername(storage_path))[4] = 'images'
    AND EXISTS (
      SELECT 1 FROM public.business_onboarding_submissions s
      WHERE s.id = submission_id
        AND s.applicant_id = auth.uid()
        AND s.status IN ('draft', 'changes_requested')
    )
    AND NOT public.is_suspended(auth.uid())
  );

DROP POLICY IF EXISTS boi_applicant_update ON public.business_onboarding_images;

DROP POLICY IF EXISTS boi_admin_all ON public.business_onboarding_images;
CREATE POLICY boi_admin_all ON public.business_onboarding_images
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.business_onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.business_onboarding_submissions(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal', 'applicant')),
  message_key text,
  message_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boe_submission_created
  ON public.business_onboarding_events (submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boe_actor_created
  ON public.business_onboarding_events (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;

GRANT SELECT ON public.business_onboarding_events TO authenticated;
GRANT ALL ON public.business_onboarding_events TO service_role;
ALTER TABLE public.business_onboarding_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boe_applicant_read ON public.business_onboarding_events;
CREATE POLICY boe_applicant_read ON public.business_onboarding_events
  FOR SELECT TO authenticated
  USING (
    visibility = 'applicant'
    AND EXISTS (
      SELECT 1 FROM public.business_onboarding_submissions s
      WHERE s.id = submission_id AND s.applicant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS boe_applicant_insert ON public.business_onboarding_events;

DROP POLICY IF EXISTS boe_admin_all ON public.business_onboarding_events;
CREATE POLICY boe_admin_all ON public.business_onboarding_events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title_key text NOT NULL,
  message_key text NOT NULL,
  message_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  related_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  related_submission_id uuid REFERENCES public.business_onboarding_submissions(id) ON DELETE SET NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
  ON public.user_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_submission
  ON public.user_notifications (related_submission_id) WHERE related_submission_id IS NOT NULL;

GRANT SELECT, UPDATE (read_at) ON public.user_notifications TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notifications_own_read ON public.user_notifications;
CREATE POLICY user_notifications_own_read ON public.user_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_notifications_own_update ON public.user_notifications;
CREATE POLICY user_notifications_own_update ON public.user_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notifications_admin_all ON public.user_notifications;
CREATE POLICY user_notifications_admin_all ON public.user_notifications
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.submit_business_onboarding_submission(_submission_id uuid)
RETURNS public.business_onboarding_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_submission public.business_onboarding_submissions;
  v_document_count integer;
  v_event_type text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: authentication required' USING ERRCODE = '42501';
  END IF;

  IF public.is_suspended(v_actor) THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: account suspended' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_submission
  FROM public.business_onboarding_submissions
  WHERE id = _submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_submission.applicant_id <> v_actor THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: submission not found' USING ERRCODE = '42501';
  END IF;

  IF v_submission.status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: invalid lifecycle state %', v_submission.status USING ERRCODE = '23514';
  END IF;

  IF v_submission.submission_type = 'existing_business_verification'
     AND v_submission.target_business_id IS NULL THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: existing business selection is required' USING ERRCODE = '23514';
  END IF;

  IF v_submission.submission_type = 'existing_business_verification'
     AND NOT EXISTS (
       SELECT 1
       FROM public.businesses b
       WHERE b.id = v_submission.target_business_id
         AND b.status = 'published'
     ) THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: selected business is not available for verification' USING ERRCODE = '23514';
  END IF;

  IF v_submission.submission_type = 'new_business'
     AND NOT EXISTS (
       SELECT 1
       FROM jsonb_each_text(v_submission.business_name_localized) AS n(locale, value)
       WHERE length(btrim(value)) >= 2
     ) THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: business name is required' USING ERRCODE = '23514';
  END IF;

  IF NULLIF(btrim(coalesce(v_submission.commercial_registration_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: commercial registration number is required' USING ERRCODE = '23514';
  END IF;

  IF NULLIF(btrim(coalesce(v_submission.commercial_registration_legal_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: legal business name is required' USING ERRCODE = '23514';
  END IF;

  IF NULLIF(btrim(coalesce(v_submission.commercial_registration_country, '')), '') IS NULL THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: commercial registration country is required' USING ERRCODE = '23514';
  END IF;

  IF v_submission.commercial_registration_expires_at IS NULL THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: commercial registration expiry date is required' USING ERRCODE = '23514';
  END IF;

  IF NULLIF(btrim(coalesce(v_submission.applicant_full_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: applicant name is required' USING ERRCODE = '23514';
  END IF;

  IF NULLIF(btrim(coalesce(v_submission.applicant_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: applicant phone is required' USING ERRCODE = '23514';
  END IF;

  IF NULLIF(btrim(coalesce(v_submission.applicant_role, '')), '') IS NULL THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: applicant role is required' USING ERRCODE = '23514';
  END IF;

  IF NULLIF(btrim(coalesce(v_submission.applicant_business_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: business email is required' USING ERRCODE = '23514';
  END IF;

  IF v_submission.declaration_accepted_at IS NULL THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: declaration acceptance is required' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_document_count
  FROM public.business_onboarding_documents d
  WHERE d.submission_id = v_submission.id
    AND d.uploaded_by = v_actor
    AND d.document_type = 'commercial_registration'
    AND d.storage_bucket = 'business-verification-documents'
    AND d.status = 'active'
    AND (storage.foldername(d.storage_path))[1] = v_actor::text
    AND (storage.foldername(d.storage_path))[2] = 'submissions'
    AND (storage.foldername(d.storage_path))[3] = v_submission.id::text
    AND (storage.foldername(d.storage_path))[4] = 'documents'
    AND EXISTS (
      SELECT 1
      FROM storage.objects o
      WHERE o.bucket_id = d.storage_bucket
        AND o.name = d.storage_path
    );

  IF v_document_count < 1 THEN
    RAISE EXCEPTION 'submit_business_onboarding_submission: active commercial registration document is required' USING ERRCODE = '23514';
  END IF;

  v_event_type := CASE WHEN v_submission.status = 'changes_requested' THEN 'resubmitted' ELSE 'submitted' END;

  UPDATE public.business_onboarding_submissions
  SET status = 'submitted',
      submitted_at = now(),
      reviewed_at = NULL,
      reviewed_by = NULL,
      admin_decision = NULL,
      applicant_message_key = NULL,
      applicant_message_params = '{}'::jsonb,
      version = version + 1,
      updated_at = now()
  WHERE id = v_submission.id
  RETURNING * INTO v_submission;

  INSERT INTO public.business_onboarding_events (
    submission_id,
    actor_id,
    event_type,
    visibility,
    message_key
  )
  VALUES (
    v_submission.id,
    v_actor,
    v_event_type,
    'applicant',
    CASE WHEN v_event_type = 'resubmitted'
      THEN 'onboarding.event.resubmitted'
      ELSE 'onboarding.event.submitted'
    END
  );

  RETURN v_submission;
END $$;

REVOKE ALL ON FUNCTION public.submit_business_onboarding_submission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_business_onboarding_submission(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_business_onboarding_document_replacement(
  _submission_id uuid,
  _document_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_submission public.business_onboarding_submissions;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'prepare_business_onboarding_document_replacement: authentication required' USING ERRCODE = '42501';
  END IF;

  IF _document_type NOT IN ('commercial_registration', 'additional_document') THEN
    RAISE EXCEPTION 'prepare_business_onboarding_document_replacement: invalid document type' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_submission
  FROM public.business_onboarding_submissions
  WHERE id = _submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_submission.applicant_id <> v_actor THEN
    RAISE EXCEPTION 'prepare_business_onboarding_document_replacement: submission not found' USING ERRCODE = '42501';
  END IF;

  IF v_submission.status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'prepare_business_onboarding_document_replacement: submission is not editable' USING ERRCODE = '23514';
  END IF;

  UPDATE public.business_onboarding_documents
  SET status = 'superseded',
      updated_at = now()
  WHERE submission_id = _submission_id
    AND uploaded_by = v_actor
    AND document_type = _document_type
    AND status = 'active';
END $$;

REVOKE ALL ON FUNCTION public.prepare_business_onboarding_document_replacement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_business_onboarding_document_replacement(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_business_onboarding_document(
  _document_id uuid,
  _storage_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_document public.business_onboarding_documents;
  v_submission public.business_onboarding_submissions;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'remove_business_onboarding_document: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_document
  FROM public.business_onboarding_documents
  WHERE id = _document_id
  FOR UPDATE;

  IF NOT FOUND OR v_document.uploaded_by <> v_actor OR v_document.storage_path <> _storage_path THEN
    RAISE EXCEPTION 'remove_business_onboarding_document: document not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_submission
  FROM public.business_onboarding_submissions
  WHERE id = v_document.submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_submission.applicant_id <> v_actor THEN
    RAISE EXCEPTION 'remove_business_onboarding_document: submission not found' USING ERRCODE = '42501';
  END IF;

  IF v_submission.status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'remove_business_onboarding_document: submission is not editable' USING ERRCODE = '23514';
  END IF;

  IF v_document.storage_bucket <> 'business-verification-documents'
     OR (storage.foldername(v_document.storage_path))[1] <> v_actor::text
     OR (storage.foldername(v_document.storage_path))[2] <> 'submissions'
     OR (storage.foldername(v_document.storage_path))[3] <> v_submission.id::text
     OR (storage.foldername(v_document.storage_path))[4] <> 'documents' THEN
    RAISE EXCEPTION 'remove_business_onboarding_document: invalid storage path' USING ERRCODE = '23514';
  END IF;

  UPDATE public.business_onboarding_documents
  SET status = 'removed',
      updated_at = now()
  WHERE id = v_document.id;

  DELETE FROM storage.objects
  WHERE bucket_id = v_document.storage_bucket
    AND name = v_document.storage_path;

  INSERT INTO public.business_onboarding_events (submission_id, actor_id, event_type, visibility, message_key)
  VALUES (v_submission.id, v_actor, 'document_removed', 'applicant', 'onboarding.event.document_removed');
END $$;

REVOKE ALL ON FUNCTION public.remove_business_onboarding_document(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_business_onboarding_document(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_business_onboarding_image(
  _image_id uuid,
  _storage_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_image public.business_onboarding_images;
  v_submission public.business_onboarding_submissions;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'remove_business_onboarding_image: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_image
  FROM public.business_onboarding_images
  WHERE id = _image_id
  FOR UPDATE;

  IF NOT FOUND OR v_image.uploaded_by <> v_actor OR v_image.storage_path <> _storage_path THEN
    RAISE EXCEPTION 'remove_business_onboarding_image: image not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_submission
  FROM public.business_onboarding_submissions
  WHERE id = v_image.submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_submission.applicant_id <> v_actor THEN
    RAISE EXCEPTION 'remove_business_onboarding_image: submission not found' USING ERRCODE = '42501';
  END IF;

  IF v_submission.status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'remove_business_onboarding_image: submission is not editable' USING ERRCODE = '23514';
  END IF;

  IF v_image.storage_bucket <> 'business-onboarding-images'
     OR (storage.foldername(v_image.storage_path))[1] <> v_actor::text
     OR (storage.foldername(v_image.storage_path))[2] <> 'submissions'
     OR (storage.foldername(v_image.storage_path))[3] <> v_submission.id::text
     OR (storage.foldername(v_image.storage_path))[4] <> 'images' THEN
    RAISE EXCEPTION 'remove_business_onboarding_image: invalid storage path' USING ERRCODE = '23514';
  END IF;

  UPDATE public.business_onboarding_images
  SET status = 'removed',
      updated_at = now()
  WHERE id = v_image.id;

  DELETE FROM storage.objects
  WHERE bucket_id = v_image.storage_bucket
    AND name = v_image.storage_path;

  INSERT INTO public.business_onboarding_events (submission_id, actor_id, event_type, visibility, message_key)
  VALUES (v_submission.id, v_actor, 'image_removed', 'applicant', 'onboarding.event.image_removed');
END $$;

REVOKE ALL ON FUNCTION public.remove_business_onboarding_image(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_business_onboarding_image(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_user_notification_read(_notification_id uuid)
RETURNS public.user_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_notification public.user_notifications;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'mark_user_notification_read: authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = _notification_id
    AND user_id = v_actor
  RETURNING * INTO v_notification;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_user_notification_read: notification not found' USING ERRCODE = '42501';
  END IF;

  RETURN v_notification;
END $$;

REVOKE ALL ON FUNCTION public.mark_user_notification_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_user_notification_read(uuid) TO authenticated, service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'business-verification-documents',
    'business-verification-documents',
    false,
    10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'business-onboarding-images',
    'business-onboarding-images',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  )
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS business_verification_documents_applicant_insert ON storage.objects;
CREATE POLICY business_verification_documents_applicant_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'business-verification-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (storage.foldername(name))[2] = 'submissions'
    AND (storage.foldername(name))[4] = 'documents'
    AND EXISTS (
      SELECT 1
      FROM public.business_onboarding_submissions s
      WHERE s.id = CASE
        WHEN (storage.foldername(name))[3] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN ((storage.foldername(name))[3])::uuid
        ELSE NULL
      END
        AND s.applicant_id = auth.uid()
        AND s.status IN ('draft', 'changes_requested')
    )
    AND NOT public.is_suspended(auth.uid())
  );

DROP POLICY IF EXISTS business_verification_documents_applicant_read ON storage.objects;
CREATE POLICY business_verification_documents_applicant_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'business-verification-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (storage.foldername(name))[2] = 'submissions'
    AND (storage.foldername(name))[4] = 'documents'
    AND EXISTS (
      SELECT 1
      FROM public.business_onboarding_submissions s
      WHERE s.id = CASE
        WHEN (storage.foldername(name))[3] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN ((storage.foldername(name))[3])::uuid
        ELSE NULL
      END
        AND s.applicant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS business_verification_documents_applicant_delete ON storage.objects;

DROP POLICY IF EXISTS business_verification_documents_admin_all ON storage.objects;
CREATE POLICY business_verification_documents_admin_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'business-verification-documents' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'business-verification-documents' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS business_onboarding_images_applicant_insert ON storage.objects;
CREATE POLICY business_onboarding_images_applicant_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'business-onboarding-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (storage.foldername(name))[2] = 'submissions'
    AND (storage.foldername(name))[4] = 'images'
    AND EXISTS (
      SELECT 1
      FROM public.business_onboarding_submissions s
      WHERE s.id = CASE
        WHEN (storage.foldername(name))[3] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN ((storage.foldername(name))[3])::uuid
        ELSE NULL
      END
        AND s.applicant_id = auth.uid()
        AND s.status IN ('draft', 'changes_requested')
    )
    AND NOT public.is_suspended(auth.uid())
  );

DROP POLICY IF EXISTS business_onboarding_images_applicant_read ON storage.objects;
CREATE POLICY business_onboarding_images_applicant_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'business-onboarding-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (storage.foldername(name))[2] = 'submissions'
    AND (storage.foldername(name))[4] = 'images'
    AND EXISTS (
      SELECT 1
      FROM public.business_onboarding_submissions s
      WHERE s.id = CASE
        WHEN (storage.foldername(name))[3] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN ((storage.foldername(name))[3])::uuid
        ELSE NULL
      END
        AND s.applicant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS business_onboarding_images_applicant_delete ON storage.objects;

DROP POLICY IF EXISTS business_onboarding_images_admin_all ON storage.objects;
CREATE POLICY business_onboarding_images_admin_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'business-onboarding-images' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'business-onboarding-images' AND public.has_role(auth.uid(), 'admin'::app_role));

-- Manual post-migration verification queries.
-- Run these in a non-production transaction with test users/JWTs and roll back.
--
-- 1. Incomplete direct submission attempt must fail:
--    SET LOCAL ROLE authenticated;
--    SELECT set_config('request.jwt.claim.sub', '<applicant_user_id>', true);
--    UPDATE public.business_onboarding_submissions
--       SET status = 'submitted', submitted_at = now()
--     WHERE id = '<draft_submission_id>'::uuid;
--    -- Expected: permission denied for column status/submitted_at or RLS failure.
--
-- 2. Applicant event forgery must fail:
--    INSERT INTO public.business_onboarding_events (submission_id, actor_id, event_type, visibility)
--    VALUES ('<own_submission_id>'::uuid, '<applicant_user_id>'::uuid, 'submitted', 'applicant');
--    -- Expected: permission denied for table business_onboarding_events.
--
-- 3. Applicant notification content mutation must fail, but read_at may update:
--    UPDATE public.user_notifications
--       SET title_key = 'tampered'
--     WHERE id = '<own_notification_id>'::uuid;
--    -- Expected: permission denied for column title_key.
--    UPDATE public.user_notifications
--       SET read_at = now()
--     WHERE id = '<own_notification_id>'::uuid;
--    -- Expected: success for own notification.
--
-- 4. Applicant cannot delete submitted evidence directly from Storage:
--    DELETE FROM storage.objects
--     WHERE bucket_id = 'business-verification-documents'
--       AND name = '<applicant_user_id>/submissions/<submitted_submission_id>/documents/<file>';
--    -- Expected: RLS/permission failure because no applicant DELETE policy exists.
--
-- 5. Applicant cannot read another applicant's onboarding data:
--    SELECT * FROM public.business_onboarding_submissions WHERE id = '<other_submission_id>'::uuid;
--    SELECT * FROM public.business_onboarding_documents WHERE submission_id = '<other_submission_id>'::uuid;
--    SELECT * FROM public.business_onboarding_images WHERE submission_id = '<other_submission_id>'::uuid;
--    SELECT * FROM public.business_onboarding_events WHERE submission_id = '<other_submission_id>'::uuid;
--    SELECT * FROM public.user_notifications WHERE user_id = '<other_user_id>'::uuid;
--    -- Expected: zero rows.
--
-- 6. Admin access still works:
--    SELECT public.has_role('<admin_user_id>'::uuid, 'admin'::app_role);
--    SELECT count(*) FROM public.business_onboarding_submissions;
--    SELECT count(*) FROM public.business_onboarding_documents;
--    SELECT count(*) FROM public.business_onboarding_images;
--    SELECT count(*) FROM public.business_onboarding_events;
--    -- Expected: admin role true and rows visible under an admin JWT.
--
-- 7. Valid submission through secure function succeeds:
--    SELECT public.submit_business_onboarding_submission('<complete_draft_submission_id>'::uuid);
--    -- Expected: returned row has status = 'submitted', submitted_at set, and an applicant-visible event exists.
