-- Phase 0 prerequisite fix:
-- keep the existing owner/admin change-request flow working against the actual
-- business_services and business_translations schemas.

ALTER TABLE public.business_change_requests
  DROP CONSTRAINT IF EXISTS business_change_requests_status_check,
  DROP CONSTRAINT IF EXISTS bcr_status_check;

ALTER TABLE public.business_change_requests
  ADD CONSTRAINT bcr_status_check
  CHECK (status IN ('pending','approved','partially_approved','rejected','withdrawn'));

CREATE OR REPLACE FUNCTION public.apply_business_change_request(
  _request_id uuid,
  _approve jsonb,
  _reject jsonb,
  _admin_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cr public.business_change_requests;
  v_biz public.businesses;
  v_allow text[];
  v_field text;
  v_current jsonb;
  v_snapshot jsonb;
  v_new_value jsonb;
  v_new_text text;
  v_applied jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_fs jsonb;
  v_final_status text;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'apply_business_change_request: not admin' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cr FROM public.business_change_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'change request not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_cr.status <> 'pending' THEN
    RAISE EXCEPTION 'change request not pending (current: %)', v_cr.status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE id = v_cr.business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target business not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_cr.request_type = 'business_fields' THEN
    v_allow := public._bcr_field_allowlist('business_fields');
    v_fs := COALESCE(v_biz.field_sources, '{}'::jsonb);

    FOR v_field IN SELECT jsonb_array_elements_text(COALESCE(_approve, '[]'::jsonb)) LOOP
      IF NOT (v_field = ANY(v_allow)) THEN
        RAISE EXCEPTION 'field % not allow-listed for %', v_field, v_cr.request_type USING ERRCODE = 'P0001';
      END IF;

      EXECUTE format('SELECT to_jsonb(b.%I) FROM public.businesses b WHERE id = $1', v_field)
        INTO v_current USING v_biz.id;
      v_snapshot := COALESCE(v_cr.original_values, '{}'::jsonb) -> v_field;
      IF v_current IS DISTINCT FROM COALESCE(v_snapshot, 'null'::jsonb) THEN
        RETURN jsonb_build_object('conflict', true, 'field', v_field, 'current', v_current, 'snapshot', v_snapshot);
      END IF;
    END LOOP;

    FOR v_field IN SELECT jsonb_array_elements_text(COALESCE(_approve, '[]'::jsonb)) LOOP
      v_new_value := COALESCE(v_cr.changes, '{}'::jsonb) -> v_field;
      v_new_text := CASE
        WHEN v_new_value IS NULL OR v_new_value = 'null'::jsonb THEN NULL
        ELSE trim(both '"' from v_new_value::text)
      END;

      IF v_field = 'price_level' THEN
        UPDATE public.businesses SET price_level = v_new_text::integer WHERE id = v_biz.id;
      ELSE
        EXECUTE format('UPDATE public.businesses SET %I = $1 WHERE id = $2', v_field)
          USING v_new_text, v_biz.id;
      END IF;

      v_fs := v_fs || jsonb_build_object(v_field, jsonb_build_object(
        'source','owner','user_id',v_cr.submitted_by,'at', now()
      ));
      v_applied := v_applied || to_jsonb(v_field);
    END LOOP;

    FOR v_field IN SELECT jsonb_array_elements_text(COALESCE(_reject, '[]'::jsonb)) LOOP
      v_rejected := v_rejected || to_jsonb(v_field);
    END LOOP;

    UPDATE public.businesses
      SET field_sources = v_fs, updated_at = now()
      WHERE id = v_biz.id;

  ELSIF v_cr.request_type = 'opening_hours' THEN
    IF (COALESCE(_approve, '[]'::jsonb)) @> '["opening_hours"]'::jsonb THEN
      DELETE FROM public.business_opening_hours WHERE business_id = v_biz.id;
      INSERT INTO public.business_opening_hours (business_id, day_of_week, open_time, close_time, is_closed)
      SELECT v_biz.id,
             (h->>'day_of_week')::int,
             NULLIF(h->>'open_time','')::time,
             NULLIF(h->>'close_time','')::time,
             COALESCE((h->>'is_closed')::boolean, false)
      FROM jsonb_array_elements(COALESCE(v_cr.changes -> 'hours', '[]'::jsonb)) h;
      UPDATE public.businesses
        SET field_sources = COALESCE(field_sources,'{}'::jsonb) || jsonb_build_object(
              'opening_hours', jsonb_build_object('source','owner','user_id',v_cr.submitted_by,'at', now())),
            updated_at = now()
        WHERE id = v_biz.id;
      v_applied := '["opening_hours"]'::jsonb;
    ELSE
      v_rejected := '["opening_hours"]'::jsonb;
    END IF;

  ELSIF v_cr.request_type = 'services' THEN
    IF (COALESCE(_approve, '[]'::jsonb)) @> '["services"]'::jsonb THEN
      DELETE FROM public.business_services WHERE business_id = v_biz.id;
      INSERT INTO public.business_services (business_id, service_key, value, sort_order)
      SELECT
        v_biz.id,
        COALESCE(NULLIF(regexp_replace(lower(s->>'name'), '[^a-z0-9]+', '_', 'g'), ''), 'service_' || ordinality::text),
        jsonb_strip_nulls(jsonb_build_object(
          'name', s->>'name',
          'description', s->>'description',
          'price', NULLIF(s->>'price','')::numeric
        )),
        ordinality::integer - 1
      FROM jsonb_array_elements(COALESCE(v_cr.changes -> 'services', '[]'::jsonb)) WITH ORDINALITY AS items(s, ordinality);
      v_applied := '["services"]'::jsonb;
    ELSE
      v_rejected := '["services"]'::jsonb;
    END IF;

  ELSIF v_cr.request_type = 'attributes' THEN
    IF (COALESCE(_approve, '[]'::jsonb)) @> '["attributes"]'::jsonb THEN
      DELETE FROM public.business_attributes WHERE business_id = v_biz.id;
      INSERT INTO public.business_attributes (business_id, attribute_key, value, source)
      SELECT v_biz.id, a->>'key', a->'value', 'owner'
      FROM jsonb_array_elements(COALESCE(v_cr.changes -> 'attributes', '[]'::jsonb)) a;
      v_applied := '["attributes"]'::jsonb;
    ELSE
      v_rejected := '["attributes"]'::jsonb;
    END IF;

  ELSIF v_cr.request_type = 'translations' THEN
    IF (COALESCE(_approve, '[]'::jsonb)) @> '["translations"]'::jsonb THEN
      INSERT INTO public.business_translations (
        business_id,
        language_code,
        translated_name,
        translated_description,
        translation_status,
        translated_by,
        translated_at
      )
      SELECT
        v_biz.id,
        t->>'language',
        t->>'name',
        t->>'description',
        'approved',
        v_actor::text,
        now()
      FROM jsonb_array_elements(COALESCE(v_cr.changes -> 'translations', '[]'::jsonb)) t
      ON CONFLICT (business_id, language_code) DO UPDATE
        SET translated_name = EXCLUDED.translated_name,
            translated_description = EXCLUDED.translated_description,
            translation_status = 'approved',
            translated_by = v_actor::text,
            translated_at = now(),
            updated_at = now();
      v_applied := '["translations"]'::jsonb;
    ELSE
      v_rejected := '["translations"]'::jsonb;
    END IF;

  ELSIF v_cr.request_type = 'image_request' THEN
    IF (COALESCE(_approve, '[]'::jsonb)) @> '["image_request"]'::jsonb THEN
      IF v_cr.changes ? 'cover_image_id' THEN
        UPDATE public.business_images SET is_cover = false
          WHERE business_id = v_biz.id AND is_cover = true;
        UPDATE public.business_images SET is_cover = true
          WHERE business_id = v_biz.id AND id = (v_cr.changes ->> 'cover_image_id')::uuid;
      END IF;
      IF v_cr.changes ? 'delete_image_ids' THEN
        UPDATE public.business_images SET deleted_at = now()
          WHERE business_id = v_biz.id
            AND id IN (SELECT (jsonb_array_elements_text(v_cr.changes -> 'delete_image_ids'))::uuid);
      END IF;
      v_applied := '["image_request"]'::jsonb;
    ELSE
      v_rejected := '["image_request"]'::jsonb;
    END IF;
  END IF;

  v_final_status := CASE
    WHEN jsonb_array_length(v_applied) > 0 AND jsonb_array_length(v_rejected) > 0 THEN 'partially_approved'
    WHEN jsonb_array_length(v_applied) > 0 THEN 'approved'
    ELSE 'rejected'
  END;

  UPDATE public.business_change_requests
    SET status = v_final_status,
        approved_fields = v_applied,
        rejected_fields = v_rejected,
        reviewed_at = now(),
        reviewed_by = v_actor,
        admin_notes = _admin_notes
    WHERE id = _request_id;

  INSERT INTO public.owner_notifications (user_id, business_id, kind, payload)
    VALUES (v_cr.submitted_by, v_biz.id,
      'change_request.' || v_final_status,
      jsonb_build_object('request_id', _request_id, 'request_type', v_cr.request_type,
        'approved', v_applied, 'rejected', v_rejected, 'admin_notes', _admin_notes));

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, metadata)
    VALUES (v_actor, 'change_request.apply', 'business_change_request', _request_id::text,
      to_jsonb(v_cr),
      jsonb_build_object('status', v_final_status, 'approved', v_applied, 'rejected', v_rejected),
      jsonb_build_object('business_id', v_biz.id, 'admin_notes', _admin_notes));

  RETURN jsonb_build_object('ok', true, 'status', v_final_status, 'approved', v_applied, 'rejected', v_rejected);
END $$;

REVOKE ALL ON FUNCTION public.apply_business_change_request(uuid, jsonb, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_business_change_request(uuid, jsonb, jsonb, text) TO authenticated;
