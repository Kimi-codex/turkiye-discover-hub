-- Allow applicants to respond to "additional documents required" decisions.
-- This aligns RLS, storage policies, and lifecycle RPCs with the existing
-- business_onboarding_submissions.status value.

DROP POLICY IF EXISTS bos_applicant_update ON public.business_onboarding_submissions;
CREATE POLICY bos_applicant_update ON public.business_onboarding_submissions
  FOR UPDATE TO authenticated
  USING (
    applicant_id = auth.uid()
    AND status IN ('draft', 'changes_requested', 'additional_documents_required')
  )
  WITH CHECK (
    applicant_id = auth.uid()
    AND status IN ('draft', 'changes_requested', 'additional_documents_required')
    AND approved_business_id IS NULL
    AND NOT public.is_suspended(auth.uid())
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
        AND s.status IN ('draft', 'changes_requested', 'additional_documents_required')
    )
    AND NOT public.is_suspended(auth.uid())
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
        AND s.status IN ('draft', 'changes_requested', 'additional_documents_required')
    )
    AND NOT public.is_suspended(auth.uid())
  );

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
        AND s.status IN ('draft', 'changes_requested', 'additional_documents_required')
    )
    AND NOT public.is_suspended(auth.uid())
  );

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
        AND s.status IN ('draft', 'changes_requested', 'additional_documents_required')
    )
    AND NOT public.is_suspended(auth.uid())
  );

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

  IF v_submission.status NOT IN ('draft', 'changes_requested', 'additional_documents_required') THEN
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

  v_event_type := CASE
    WHEN v_submission.status IN ('changes_requested', 'additional_documents_required') THEN 'resubmitted'
    ELSE 'submitted'
  END;

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

  IF v_submission.status NOT IN ('draft', 'changes_requested', 'additional_documents_required') THEN
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

  IF v_submission.status NOT IN ('draft', 'changes_requested', 'additional_documents_required') THEN
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

  IF v_submission.status NOT IN ('draft', 'changes_requested', 'additional_documents_required') THEN
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
