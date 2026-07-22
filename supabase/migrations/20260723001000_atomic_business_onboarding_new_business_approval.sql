-- Make new-business onboarding approval atomic and scoped.
-- This creates the business and primary owner membership without granting
-- the global business_owner role.

CREATE OR REPLACE FUNCTION public.approve_new_business_onboarding_submission(
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
  v_name text;
  v_description text;
  v_base_slug text;
  v_slug text;
  v_suffix integer := 1;
  v_place_id text;
  v_primary_category_id uuid;
  v_now timestamptz := now();
  v_field_sources jsonb;
  v_locale text;
  v_image public.business_onboarding_images;
  v_business_image_id uuid;
  v_cover_assigned boolean := false;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'approve_new_business_onboarding_submission: not admin' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_submission
  FROM public.business_onboarding_submissions
  WHERE id = _submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_new_business_onboarding_submission: submission not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_submission.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'approve_new_business_onboarding_submission: submission is not reviewable' USING ERRCODE = '23514';
  END IF;

  IF v_submission.submission_type <> 'new_business' OR v_submission.target_business_id IS NOT NULL THEN
    RAISE EXCEPTION 'approve_new_business_onboarding_submission: only new-business submissions are supported' USING ERRCODE = '23514';
  END IF;

  IF v_submission.approved_business_id IS NOT NULL THEN
    RAISE EXCEPTION 'approve_new_business_onboarding_submission: submission is already linked to a business' USING ERRCODE = '23505';
  END IF;

  v_before := to_jsonb(v_submission);

  SELECT value INTO v_name
  FROM jsonb_each_text(coalesce(v_submission.business_name_localized, '{}'::jsonb)) AS n(locale, value)
  ORDER BY
    CASE
      WHEN locale = coalesce(v_submission.locale_draft, '') THEN 0
      WHEN locale = 'en' THEN 1
      WHEN locale = 'tr' THEN 2
      WHEN locale = 'ar' THEN 3
      ELSE 4
    END
  LIMIT 1;

  v_name := NULLIF(btrim(coalesce(v_name, '')), '');
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'approve_new_business_onboarding_submission: business name is required' USING ERRCODE = '23514';
  END IF;

  SELECT value INTO v_description
  FROM jsonb_each_text(coalesce(v_submission.business_description_localized, '{}'::jsonb)) AS d(locale, value)
  ORDER BY
    CASE
      WHEN locale = coalesce(v_submission.locale_draft, '') THEN 0
      WHEN locale = 'en' THEN 1
      WHEN locale = 'tr' THEN 2
      WHEN locale = 'ar' THEN 3
      ELSE 4
    END
  LIMIT 1;
  v_description := NULLIF(btrim(coalesce(v_description, '')), '');

  IF NULLIF(btrim(coalesce(v_submission.commercial_registration_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'approve_new_business_onboarding_submission: commercial registration number is required' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_onboarding_documents d
    WHERE d.submission_id = v_submission.id
      AND d.document_type = 'commercial_registration'
      AND d.status = 'active'
      AND d.storage_bucket = 'business-verification-documents'
      AND EXISTS (
        SELECT 1
        FROM storage.objects o
        WHERE o.bucket_id = d.storage_bucket
          AND o.name = d.storage_path
      )
  ) THEN
    RAISE EXCEPTION 'approve_new_business_onboarding_submission: active commercial registration document is required' USING ERRCODE = '23514';
  END IF;

  SELECT category_id INTO v_primary_category_id
  FROM (
    SELECT value::uuid AS category_id, ordinality
    FROM jsonb_array_elements_text(coalesce(v_submission.categories, '[]'::jsonb)) WITH ORDINALITY AS c(value, ordinality)
    WHERE value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) c
  WHERE EXISTS (SELECT 1 FROM public.categories cat WHERE cat.id = c.category_id)
  ORDER BY ordinality
  LIMIT 1;

  v_base_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' FROM v_base_slug);
  IF v_base_slug = '' THEN
    v_base_slug := 'business';
  END IF;
  v_base_slug := left(v_base_slug, 80);
  v_slug := v_base_slug;
  WHILE EXISTS (SELECT 1 FROM public.businesses b WHERE b.slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := left(v_base_slug, 72) || '-' || v_suffix::text;
  END LOOP;

  v_place_id := 'onboarding-' || v_submission.id::text;

  v_field_sources := jsonb_build_object(
    'name', jsonb_build_object('source', 'onboarding', 'updated_at', v_now),
    'description', jsonb_build_object('source', 'onboarding', 'updated_at', v_now),
    'formatted_address', jsonb_build_object('source', 'onboarding', 'updated_at', v_now),
    'phone', jsonb_build_object('source', 'onboarding', 'updated_at', v_now),
    'international_phone', jsonb_build_object('source', 'onboarding', 'updated_at', v_now),
    'email', jsonb_build_object('source', 'onboarding', 'updated_at', v_now),
    'website', jsonb_build_object('source', 'onboarding', 'updated_at', v_now),
    'primary_category_id', jsonb_build_object('source', 'onboarding', 'updated_at', v_now)
  );

  INSERT INTO public.businesses (
    place_id,
    name,
    slug,
    original_language,
    description,
    primary_category_id,
    formatted_address,
    raw_address,
    phone,
    international_phone,
    email,
    website,
    status,
    source,
    is_verified,
    owner_id,
    raw_data,
    field_sources
  )
  VALUES (
    v_place_id,
    v_name,
    v_slug,
    CASE WHEN v_submission.locale_draft IN ('ar', 'en', 'tr') THEN v_submission.locale_draft ELSE NULL END,
    v_description,
    v_primary_category_id,
    NULLIF(btrim(coalesce(v_submission.address->>'formatted_address', '')), ''),
    NULLIF(btrim(coalesce(v_submission.address->>'raw_address', '')), ''),
    NULLIF(btrim(coalesce(v_submission.contact->>'phone', v_submission.applicant_phone, '')), ''),
    NULLIF(btrim(coalesce(v_submission.contact->>'international_phone', '')), ''),
    NULLIF(btrim(coalesce(v_submission.contact->>'email', v_submission.applicant_business_email, '')), ''),
    NULLIF(btrim(coalesce(v_submission.contact->>'website', '')), ''),
    'published',
    'owner',
    true,
    v_submission.applicant_id,
    jsonb_build_object(
      'source', 'business_onboarding',
      'submission_id', v_submission.id,
      'commercial_registration_number', v_submission.commercial_registration_number,
      'commercial_registration_legal_name', v_submission.commercial_registration_legal_name,
      'commercial_registration_country', v_submission.commercial_registration_country,
      'commercial_registration_issued_at', v_submission.commercial_registration_issued_at,
      'commercial_registration_expires_at', v_submission.commercial_registration_expires_at,
      'social_links', v_submission.social_links,
      'onboarding_content', v_submission.onboarding_content
    ),
    v_field_sources
  )
  RETURNING * INTO v_business;

  INSERT INTO public.business_members (business_id, user_id, role, status, is_primary, approved_by)
  VALUES (v_business.id, v_submission.applicant_id, 'owner', 'active', true, v_actor);

  INSERT INTO public.business_category_links (business_id, category_id, is_primary)
  SELECT DISTINCT ON (category_id)
    v_business.id,
    category_id,
    coalesce(category_id = v_primary_category_id, false)
  FROM (
    SELECT value::uuid AS category_id, ordinality
    FROM jsonb_array_elements_text(coalesce(v_submission.categories, '[]'::jsonb)) WITH ORDINALITY AS c(value, ordinality)
    WHERE value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) c
  WHERE EXISTS (SELECT 1 FROM public.categories cat WHERE cat.id = c.category_id)
  ORDER BY category_id, ordinality;

  FOR v_locale IN
    SELECT locale
    FROM jsonb_object_keys(coalesce(v_submission.business_name_localized, '{}'::jsonb)) AS k(locale)
    WHERE locale ~ '^[a-z]{2}(-[A-Z]{2})?$'
  LOOP
    INSERT INTO public.business_translations (
      business_id,
      language_code,
      translated_name,
      translated_description,
      translated_services,
      translation_status,
      translated_by,
      translated_at
    )
    VALUES (
      v_business.id,
      split_part(v_locale, '-', 1),
      NULLIF(btrim(coalesce(v_submission.business_name_localized->>v_locale, '')), ''),
      NULLIF(btrim(coalesce(v_submission.business_description_localized->>v_locale, '')), ''),
      coalesce(v_submission.services_localized->v_locale, '{}'::jsonb),
      'approved',
      'business_onboarding',
      v_now
    )
    ON CONFLICT (business_id, language_code) DO UPDATE
    SET translated_name = EXCLUDED.translated_name,
        translated_description = EXCLUDED.translated_description,
        translated_services = EXCLUDED.translated_services,
        translation_status = 'approved',
        translated_by = 'business_onboarding',
        translated_at = v_now,
        updated_at = v_now;
  END LOOP;

  INSERT INTO public.business_services (business_id, service_key, value, sort_order)
  SELECT v_business.id, key, value, (row_number() OVER (ORDER BY key) - 1)::integer
  FROM jsonb_each(coalesce(v_submission.services_localized, '{}'::jsonb))
  WHERE jsonb_typeof(value) IS NOT NULL;

  INSERT INTO public.business_attributes (business_id, attribute_key, value, source)
  SELECT v_business.id, key, value, 'onboarding'
  FROM jsonb_each(coalesce(v_submission.attributes, '{}'::jsonb))
  WHERE jsonb_typeof(value) IS NOT NULL;

  FOR v_image IN
    SELECT *
    FROM public.business_onboarding_images
    WHERE submission_id = v_submission.id
      AND status = 'pending'
      AND storage_bucket = 'business-onboarding-images'
    ORDER BY sort_order, created_at, id
  LOOP
    INSERT INTO public.business_images (
      business_id,
      place_id,
      source_provider,
      r2_key,
      content_type,
      file_size,
      width,
      height,
      image_type,
      is_cover,
      sort_order,
      storage_status,
      source_type,
      source_title,
      source_metadata,
      source_fingerprint,
      uploaded_at
    )
    VALUES (
      v_business.id,
      v_business.place_id,
      'owner_upload',
      v_image.storage_path,
      v_image.mime_type,
      v_image.size_bytes,
      v_image.width,
      v_image.height,
      v_image.image_type,
      v_image.image_type = 'cover' AND NOT v_cover_assigned,
      v_image.sort_order,
      'uploaded',
      'owner_upload',
      v_image.original_filename,
      jsonb_build_object('onboarding_image_id', v_image.id, 'storage_bucket', v_image.storage_bucket),
      md5('onboarding|' || v_image.id::text),
      v_now
    )
    RETURNING id INTO v_business_image_id;

    IF v_image.image_type = 'cover' AND NOT v_cover_assigned THEN
      v_cover_assigned := true;
    END IF;

    UPDATE public.business_onboarding_images
    SET status = 'approved',
        approved_business_image_id = v_business_image_id,
        updated_at = v_now
    WHERE id = v_image.id;
  END LOOP;

  UPDATE public.business_onboarding_submissions
  SET status = 'approved',
      reviewed_at = v_now,
      reviewed_by = v_actor,
      admin_decision = 'approve_publish',
      admin_notes_private = _private_notes,
      applicant_message_key = COALESCE(_applicant_message_key, 'onboarding.event.approved'),
      applicant_message_params = COALESCE(_applicant_message_params, '{}'::jsonb),
      approved_business_id = v_business.id,
      updated_at = v_now
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
    'approve_new_business',
    'applicant',
    COALESCE(_applicant_message_key, 'onboarding.event.approved'),
    COALESCE(_applicant_message_params, '{}'::jsonb),
    jsonb_build_object('business_id', v_business.id, 'private_notes', _private_notes IS NOT NULL)
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
    'business_onboarding.approve_new_business',
    'business_onboarding_submission',
    v_submission.id::text,
    v_before,
    to_jsonb(v_submission),
    jsonb_build_object('business_id', v_business.id, 'business_members', true, 'global_business_owner_granted', false)
  );

  RETURN v_submission;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_new_business_onboarding_submission(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_new_business_onboarding_submission(uuid, text, jsonb, text) TO authenticated, service_role;
