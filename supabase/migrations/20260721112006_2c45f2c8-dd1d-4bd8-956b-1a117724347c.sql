
-- =========================================================================
-- Phase 3 additive migration
-- =========================================================================

-- audit_logs: add snapshot fields
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS before_data jsonb,
  ADD COLUMN IF NOT EXISTS after_data  jsonb;

-- Ensure no INSERT policy exists for public/authenticated roles on audit_logs.
-- Only service_role (via RPC) may write.
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL    ON public.audit_logs TO service_role;

-- =========================================================================
-- import_batches: extend with detailed counters + storage path + lock fields
-- =========================================================================
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS file_hash             text,
  ADD COLUMN IF NOT EXISTS source_provider       text NOT NULL DEFAULT 'google',
  ADD COLUMN IF NOT EXISTS storage_object_path   text,
  ADD COLUMN IF NOT EXISTS storage_bucket        text NOT NULL DEFAULT 'imports',
  ADD COLUMN IF NOT EXISTS file_size             bigint,
  ADD COLUMN IF NOT EXISTS original_filename     text,
  ADD COLUMN IF NOT EXISTS valid_items           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invalid_items         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inserted_items        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_items         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_items       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_items         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS needs_mapping_items   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at            timestamptz,
  ADD COLUMN IF NOT EXISTS error_message         text,
  ADD COLUMN IF NOT EXISTS import_options        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS processing_lock_at    timestamptz,
  ADD COLUMN IF NOT EXISTS processing_lock_by    text;

-- Update the status check constraint to include new lifecycle values
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batches_status_check') THEN
    ALTER TABLE public.import_batches DROP CONSTRAINT import_batches_status_check;
  END IF;
END $$;
ALTER TABLE public.import_batches
  ADD CONSTRAINT import_batches_status_check
  CHECK (status = ANY (ARRAY[
    'uploaded','analyzing','ready','importing',
    'completed','partially_completed','failed','cancelled','pending'
  ]));

CREATE INDEX IF NOT EXISTS idx_import_batches_lock
  ON public.import_batches (processing_lock_at)
  WHERE processing_lock_at IS NOT NULL;

-- =========================================================================
-- import_batch_items: add item_index + action classification + unique index
-- =========================================================================
ALTER TABLE public.import_batch_items
  ADD COLUMN IF NOT EXISTS item_index integer,
  ADD COLUMN IF NOT EXISTS action     text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batch_items_status_check') THEN
    ALTER TABLE public.import_batch_items DROP CONSTRAINT import_batch_items_status_check;
  END IF;
END $$;
ALTER TABLE public.import_batch_items
  ADD CONSTRAINT import_batch_items_status_check
  CHECK (status = ANY (ARRAY[
    'pending','processing','inserted','updated','duplicate',
    'skipped','invalid','needs_mapping','failed'
  ]));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batch_items_action_check') THEN
    ALTER TABLE public.import_batch_items DROP CONSTRAINT import_batch_items_action_check;
  END IF;
END $$;
ALTER TABLE public.import_batch_items
  ADD CONSTRAINT import_batch_items_action_check
  CHECK (action IS NULL OR action = ANY (ARRAY[
    'insert','update','skip','duplicate','invalid','needs_mapping'
  ]));

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batch_items_index
  ON public.import_batch_items (import_batch_id, item_index)
  WHERE item_index IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ibi_place ON public.import_batch_items (place_id);

DROP TRIGGER IF EXISTS import_batch_items_set_updated_at ON public.import_batch_items;
CREATE TRIGGER import_batch_items_set_updated_at
  BEFORE UPDATE ON public.import_batch_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- category_mappings: usage counter
-- =========================================================================
ALTER TABLE public.category_mappings
  ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;

-- =========================================================================
-- businesses: per-field source tracker
-- =========================================================================
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS field_sources jsonb NOT NULL DEFAULT '{}'::jsonb;

-- =========================================================================
-- reviews: dedicated source_fingerprint + partial unique index
-- =========================================================================
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS source_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_source_fingerprint
  ON public.reviews (business_id, source, source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;

-- Also scope external_review_id uniqueness per business+source to be safe.
-- (Existing uq_reviews_external is global; keep it, add scoped one too.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_external_scoped
  ON public.reviews (business_id, source, external_review_id)
  WHERE external_review_id IS NOT NULL;

-- =========================================================================
-- business_images: retry scheduling fields (Phase 4 will use these)
-- =========================================================================
ALTER TABLE public.business_images
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS uploaded_at     timestamptz;

CREATE INDEX IF NOT EXISTS idx_business_images_next_attempt
  ON public.business_images (next_attempt_at)
  WHERE storage_status IN ('pending','failed');

-- =========================================================================
-- SECURITY DEFINER RPCs
-- =========================================================================

-- record_audit: internal audit writer. Callable by authenticated users but
-- validates the caller has admin role. Prevents forgery by ordinary users.
CREATE OR REPLACE FUNCTION public.record_audit(
  _action      text,
  _entity_type text,
  _entity_id   text,
  _before      jsonb,
  _after       jsonb,
  _metadata    jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'record_audit: caller is not admin' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, before_data, after_data, metadata
  ) VALUES (
    auth.uid(), _action, _entity_type, _entity_id, _before, _after, _metadata
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_audit(text,text,text,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_audit(text,text,text,jsonb,jsonb,jsonb) TO authenticated, service_role;

-- approve_ownership_claim: atomic approval
CREATE OR REPLACE FUNCTION public.approve_ownership_claim(_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.ownership_claims;
  v_business public.businesses;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'approve_ownership_claim: not admin' USING ERRCODE = '42501';
  END IF;

  -- Lock the claim row
  SELECT * INTO v_claim FROM public.ownership_claims
    WHERE id = _claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'claim not pending (current: %)', v_claim.status USING ERRCODE = 'P0001';
  END IF;

  -- Lock business, verify no conflicting owner
  SELECT * INTO v_business FROM public.businesses
    WHERE id = v_claim.business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'business not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_business.owner_id IS NOT NULL AND v_business.owner_id <> v_claim.user_id THEN
    RAISE EXCEPTION 'business already has a different owner' USING ERRCODE = 'P0001';
  END IF;

  -- Assign ownership
  UPDATE public.businesses
    SET owner_id = v_claim.user_id, updated_at = now()
    WHERE id = v_business.id;

  -- Grant business_owner role (idempotent)
  INSERT INTO public.user_roles (user_id, role)
    VALUES (v_claim.user_id, 'business_owner'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

  -- Update claim
  UPDATE public.ownership_claims
    SET status = 'approved',
        reviewed_at = now(),
        reviewed_by = v_actor
    WHERE id = _claim_id;

  -- Audit
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, metadata)
    VALUES (v_actor, 'ownership_claim.approve', 'ownership_claim', _claim_id::text,
      to_jsonb(v_claim),
      jsonb_build_object('status','approved','business_id',v_business.id,'user_id',v_claim.user_id),
      jsonb_build_object('business_slug', v_business.slug));

  RETURN jsonb_build_object('ok', true, 'business_id', v_business.id, 'user_id', v_claim.user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_ownership_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_ownership_claim(uuid) TO authenticated, service_role;

-- set_user_role: transactional role change with last-admin protection
CREATE OR REPLACE FUNCTION public.set_user_role(
  _target_user uuid,
  _role        app_role,
  _add         boolean,
  _confirm_self boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_admin_count integer;
  v_had boolean;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'set_user_role: not admin' USING ERRCODE = '42501';
  END IF;
  IF _target_user IS NULL OR _role IS NULL THEN
    RAISE EXCEPTION 'invalid args' USING ERRCODE = '22023';
  END IF;

  -- Block accidental self admin removal
  IF _role = 'admin'::app_role AND NOT _add AND _target_user = v_actor AND NOT _confirm_self THEN
    RAISE EXCEPTION 'refusing to remove own admin role without confirmation' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the admin role rows to prevent race with concurrent removals
  PERFORM 1 FROM public.user_roles WHERE role = 'admin'::app_role FOR UPDATE;

  IF _role = 'admin'::app_role AND NOT _add THEN
    SELECT count(*) INTO v_admin_count FROM public.user_roles WHERE role = 'admin'::app_role;
    -- If target actually has admin, ensure not the last one
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _target_user AND role = 'admin'::app_role)
      INTO v_had;
    IF v_had AND v_admin_count <= 1 THEN
      RAISE EXCEPTION 'refusing to remove the last remaining admin' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF _add THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_target_user, _role)
      ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _target_user AND role = _role;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor,
      CASE WHEN _add THEN 'user_role.grant' ELSE 'user_role.revoke' END,
      'user', _target_user::text,
      jsonb_build_object('role', _role, 'self', _target_user = v_actor));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_role(uuid, app_role, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, app_role, boolean, boolean) TO authenticated, service_role;

-- bootstrap_admin: usable only when zero admins exist
CREATE OR REPLACE FUNCTION public.bootstrap_admin(_target_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM 1 FROM public.user_roles WHERE role = 'admin'::app_role FOR UPDATE;
  SELECT count(*) INTO v_count FROM public.user_roles WHERE role = 'admin'::app_role;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'bootstrap_admin disabled: admins already exist' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_target_user, 'admin'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (_target_user, 'admin.bootstrap', 'user', _target_user::text, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_admin(uuid) TO service_role;
