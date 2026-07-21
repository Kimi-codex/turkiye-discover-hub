
-- ===== M5. Phase 5 — Owner Portal =====

-- 1. business_change_requests: request type + partial-approval audit
ALTER TABLE public.business_change_requests
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'business_fields',
  ADD COLUMN IF NOT EXISTS approved_fields jsonb,
  ADD COLUMN IF NOT EXISTS rejected_fields jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bcr_request_type_check') THEN
    ALTER TABLE public.business_change_requests
      ADD CONSTRAINT bcr_request_type_check CHECK (
        request_type IN ('business_fields','opening_hours','services','attributes','translations','image_request')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bcr_status_check') THEN
    ALTER TABLE public.business_change_requests
      ADD CONSTRAINT bcr_status_check CHECK (
        status IN ('pending','approved','partially_approved','rejected','withdrawn')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bcr_business_status_created
  ON public.business_change_requests (business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bcr_submitted_by_created
  ON public.business_change_requests (submitted_by, created_at DESC);

-- Owner may withdraw their own PENDING request (RLS UPDATE)
DROP POLICY IF EXISTS bcr_owner_withdraw ON public.business_change_requests;
CREATE POLICY bcr_owner_withdraw ON public.business_change_requests
  FOR UPDATE TO authenticated
  USING (submitted_by = auth.uid() AND status = 'pending')
  WITH CHECK (submitted_by = auth.uid() AND status IN ('pending','withdrawn'));

-- 2. Owner authorization RPC (single round-trip)
CREATE OR REPLACE FUNCTION public.owner_authz(_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status text;
  v_suspended boolean;
  v_has_role boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  END IF;

  SELECT public.is_suspended(v_uid) INTO v_suspended;
  IF v_suspended THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SUSPENDED');
  END IF;

  SELECT public.has_role(v_uid, 'business_owner'::app_role) INTO v_has_role;
  IF NOT v_has_role THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MISSING_ROLE');
  END IF;

  SELECT owner_id, status INTO v_owner, v_status
    FROM public.businesses WHERE id = _business_id;
  IF v_owner IS NULL AND v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BUSINESS_MISSING');
  END IF;
  IF v_owner IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  END IF;
  IF v_status = 'deleted' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BUSINESS_DELETED');
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', v_uid, 'business_id', _business_id, 'status', v_status);
END $$;
REVOKE ALL ON FUNCTION public.owner_authz(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_authz(uuid) TO authenticated;

-- 3. Simple ownership existence helper (used by header UI)
CREATE OR REPLACE FUNCTION public.owner_has_business(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.businesses WHERE owner_id = _user)
$$;
REVOKE ALL ON FUNCTION public.owner_has_business(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_has_business(uuid) TO authenticated;

-- 4. Allow-list of business_fields keys applicable to CR type 'business_fields'
CREATE OR REPLACE FUNCTION public._bcr_field_allowlist(_type text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _type
    WHEN 'business_fields' THEN ARRAY[
      'name','description','phone','international_phone','email','website',
      'formatted_address','neighborhood','price_level'
    ]::text[]
    ELSE ARRAY[]::text[]
  END
$$;

-- 5. apply_business_change_request — atomic partial approval
CREATE OR REPLACE FUNCTION public.apply_business_change_request(
  _request_id uuid,
  _approve jsonb,       -- array of field names, e.g. '["name","phone"]'
  _reject jsonb,        -- array of field names
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

    -- STEP A: conflict detection over ALL approved fields (fail fast, no partial write)
    FOR v_field IN SELECT jsonb_array_elements_text(COALESCE(_approve, '[]'::jsonb)) LOOP
      IF NOT (v_field = ANY(v_allow)) THEN
        RAISE EXCEPTION 'field % not allow-listed for %', v_field, v_cr.request_type USING ERRCODE = 'P0001';
      END IF;
      -- current value snapshot (jsonb) via row_to_json path
      EXECUTE format('SELECT to_jsonb(b.%I) FROM public.businesses b WHERE id = $1', v_field)
        INTO v_current USING v_biz.id;
      v_snapshot := COALESCE(v_cr.original_values, '{}'::jsonb) -> v_field;
      -- Note: NULL vs missing key are equivalent for our purposes
      IF v_current IS DISTINCT FROM COALESCE(v_snapshot, 'null'::jsonb) THEN
        RETURN jsonb_build_object('conflict', true, 'field', v_field,
          'current', v_current, 'snapshot', v_snapshot);
      END IF;
    END LOOP;

    -- STEP B: apply approved fields
    FOR v_field IN SELECT jsonb_array_elements_text(COALESCE(_approve, '[]'::jsonb)) LOOP
      v_new_value := COALESCE(v_cr.changes, '{}'::jsonb) -> v_field;
      -- write it back (jsonb -> column). Text columns most common in allowlist.
      EXECUTE format('UPDATE public.businesses SET %I = ($1)::text WHERE id = $2', v_field)
        USING (CASE WHEN v_new_value IS NULL OR v_new_value = 'null'::jsonb
                    THEN NULL ELSE trim(both '"' from v_new_value::text) END),
              v_biz.id;
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
    -- Whole-set replacement inside the same txn
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
      INSERT INTO public.business_services (business_id, name, description, price)
      SELECT v_biz.id, s->>'name', s->>'description', NULLIF(s->>'price','')::numeric
      FROM jsonb_array_elements(COALESCE(v_cr.changes -> 'services', '[]'::jsonb)) s;
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
      -- Upsert per-locale rows; do NOT delete other locales.
      INSERT INTO public.business_translations (business_id, language, name, description, translation_status, translated_by)
      SELECT v_biz.id, t->>'language', t->>'name', t->>'description', 'approved', v_actor
      FROM jsonb_array_elements(COALESCE(v_cr.changes -> 'translations', '[]'::jsonb)) t
      ON CONFLICT (business_id, language) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            translation_status = 'approved',
            translated_by = v_actor,
            updated_at = now();
      v_applied := '["translations"]'::jsonb;
    ELSE
      v_rejected := '["translations"]'::jsonb;
    END IF;

  ELSIF v_cr.request_type = 'image_request' THEN
    -- Owner requested cover change / image removal; admin toggles bits directly here.
    -- Payload shape: { "cover_image_id": "<uuid>"?, "delete_image_ids": ["<uuid>", ...]? }
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

-- 6. revoke_ownership — admin-only atomic revocation
CREATE OR REPLACE FUNCTION public.revoke_ownership(_business_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_biz public.businesses;
  v_other integer;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'revoke_ownership: not admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_biz FROM public.businesses WHERE id = _business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'business not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_biz.owner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_owner');
  END IF;

  UPDATE public.businesses SET owner_id = NULL, updated_at = now() WHERE id = _business_id;

  SELECT count(*) INTO v_other FROM public.businesses WHERE owner_id = v_biz.owner_id;
  IF v_other = 0 THEN
    DELETE FROM public.user_roles WHERE user_id = v_biz.owner_id AND role = 'business_owner'::app_role;
  END IF;

  INSERT INTO public.owner_notifications (user_id, business_id, kind, payload)
    VALUES (v_biz.owner_id, _business_id, 'ownership.revoked',
      jsonb_build_object('reason', _reason));

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, metadata)
    VALUES (v_actor, 'ownership.revoke', 'business', _business_id::text,
      to_jsonb(v_biz),
      jsonb_build_object('owner_id', null),
      jsonb_build_object('reason', _reason, 'previous_owner', v_biz.owner_id));

  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.revoke_ownership(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_ownership(uuid, text) TO authenticated;

-- 7. Ownership claim → owner notification on status change
CREATE OR REPLACE FUNCTION public._notify_ownership_claim_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved','rejected') THEN
    INSERT INTO public.owner_notifications (user_id, business_id, kind, payload)
    VALUES (NEW.user_id, NEW.business_id, 'ownership_claim.' || NEW.status,
      jsonb_build_object('claim_id', NEW.id, 'admin_notes', NEW.admin_notes));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_ownership_claim ON public.ownership_claims;
CREATE TRIGGER trg_notify_ownership_claim
  AFTER UPDATE OF status ON public.ownership_claims
  FOR EACH ROW EXECUTE FUNCTION public._notify_ownership_claim_change();

-- 8. Storage: admin read access to owner-uploads (for claim evidence + moderation)
DROP POLICY IF EXISTS "owner_uploads_admin_read" ON storage.objects;
CREATE POLICY "owner_uploads_admin_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'owner-uploads' AND public.has_role(auth.uid(), 'admin'::app_role));
