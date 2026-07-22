-- Make existing-business onboarding approval atomic and scoped.
-- New onboarding approvals must not create global business_owner grants.

CREATE OR REPLACE FUNCTION public.approve_existing_business_onboarding_submission(
  _submission_id uuid,
  _applicant_message_key text DEFAULT 'onboarding.event.approved',
  _applicant_message_params jsonb DEFAULT '{}'::jsonb,
  _private_notes text DEFAULT NULL
)
RETURNS public.business_onboarding_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_submission public.business_onboarding_submissions;
  v_business public.businesses;
  v_before jsonb;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'approve_existing_business_onboarding_submission: not admin' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_submission
  FROM public.business_onboarding_submissions
  WHERE id = _submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_existing_business_onboarding_submission: submission not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_submission.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'approve_existing_business_onboarding_submission: submission is not reviewable' USING ERRCODE = '23514';
  END IF;

  IF v_submission.submission_type <> 'existing_business_verification'
     OR v_submission.target_business_id IS NULL THEN
    RAISE EXCEPTION 'approve_existing_business_onboarding_submission: only existing-business verification is supported' USING ERRCODE = '23514';
  END IF;

  v_before := to_jsonb(v_submission);

  SELECT * INTO v_business
  FROM public.businesses
  WHERE id = v_submission.target_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_existing_business_onboarding_submission: target business not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_business.owner_id IS NOT NULL AND v_business.owner_id <> v_submission.applicant_id THEN
    RAISE EXCEPTION 'approve_existing_business_onboarding_submission: target business already has a different owner' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = v_business.id
      AND bm.user_id <> v_submission.applicant_id
      AND bm.role = 'owner'
      AND bm.status = 'active'
      AND bm.is_primary = true
  ) THEN
    RAISE EXCEPTION 'approve_existing_business_onboarding_submission: target business already has a different primary owner' USING ERRCODE = '23505';
  END IF;

  UPDATE public.businesses
  SET owner_id = v_submission.applicant_id,
      is_verified = true,
      updated_at = now()
  WHERE id = v_business.id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = v_business.id
      AND bm.user_id = v_submission.applicant_id
      AND bm.status = 'active'
  ) THEN
    INSERT INTO public.business_members (business_id, user_id, role, status, is_primary, approved_by)
    VALUES (v_business.id, v_submission.applicant_id, 'owner', 'active', true, v_actor);
  ELSE
    UPDATE public.business_members
    SET role = 'owner',
        status = 'active',
        is_primary = true,
        approved_by = COALESCE(approved_by, v_actor),
        updated_at = now()
    WHERE business_id = v_business.id
      AND user_id = v_submission.applicant_id
      AND status = 'active';
  END IF;

  UPDATE public.business_onboarding_submissions
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = v_actor,
      admin_decision = 'approve_publish',
      admin_notes_private = _private_notes,
      applicant_message_key = COALESCE(_applicant_message_key, 'onboarding.event.approved'),
      applicant_message_params = COALESCE(_applicant_message_params, '{}'::jsonb),
      approved_business_id = v_business.id,
      updated_at = now()
  WHERE id = v_submission.id
  RETURNING * INTO v_submission;

  INSERT INTO public.business_onboarding_events (
    submission_id,
    actor_id,
    event_type,
    visibility,
    message_key,
    message_params,
    metadata
  )
  VALUES (
    v_submission.id,
    v_actor,
    'approve_existing',
    'applicant',
    COALESCE(_applicant_message_key, 'onboarding.event.approved'),
    COALESCE(_applicant_message_params, '{}'::jsonb),
    jsonb_build_object('private_notes', _private_notes IS NOT NULL)
  );

  INSERT INTO public.user_notifications (
    user_id,
    kind,
    title_key,
    message_key,
    message_params,
    related_business_id,
    related_submission_id
  )
  VALUES (
    v_submission.applicant_id,
    'business_onboarding',
    'onboarding.notification.title',
    COALESCE(_applicant_message_key, 'onboarding.event.approved'),
    COALESCE(_applicant_message_params, '{}'::jsonb),
    v_business.id,
    v_submission.id
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, metadata)
  VALUES (
    v_actor,
    'business_onboarding.approve_existing',
    'business_onboarding_submission',
    v_submission.id::text,
    v_before,
    to_jsonb(v_submission),
    jsonb_build_object('business_id', v_business.id, 'business_members', true, 'global_business_owner_granted', false)
  );

  RETURN v_submission;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_existing_business_onboarding_submission(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_existing_business_onboarding_submission(uuid, text, jsonb, text) TO authenticated, service_role;
