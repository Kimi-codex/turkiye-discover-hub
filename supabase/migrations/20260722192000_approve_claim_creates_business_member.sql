-- Keep legacy ownership approval compatible while making business_members the
-- forward path for scoped owner access.

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

  SELECT * INTO v_claim FROM public.ownership_claims
    WHERE id = _claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'claim not pending (current: %)', v_claim.status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_business FROM public.businesses
    WHERE id = v_claim.business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'business not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_business.owner_id IS NOT NULL AND v_business.owner_id <> v_claim.user_id THEN
    RAISE EXCEPTION 'business already has a different owner' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = v_business.id
      AND bm.user_id <> v_claim.user_id
      AND bm.role = 'owner'
      AND bm.status = 'active'
      AND bm.is_primary = true
  ) THEN
    RAISE EXCEPTION 'business already has a different primary owner member' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.businesses
    SET owner_id = v_claim.user_id, updated_at = now()
    WHERE id = v_business.id;

  INSERT INTO public.business_members (business_id, user_id, role, status, is_primary, approved_by)
    VALUES (v_business.id, v_claim.user_id, 'owner', 'active', true, v_actor)
    ON CONFLICT DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
    VALUES (v_claim.user_id, 'business_owner'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.ownership_claims
    SET status = 'approved',
        reviewed_at = now(),
        reviewed_by = v_actor
    WHERE id = _claim_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, metadata)
    VALUES (v_actor, 'ownership_claim.approve', 'ownership_claim', _claim_id::text,
      to_jsonb(v_claim),
      jsonb_build_object('status','approved','business_id',v_business.id,'user_id',v_claim.user_id),
      jsonb_build_object('business_slug', v_business.slug, 'business_members', true));

  RETURN jsonb_build_object('ok', true, 'business_id', v_business.id, 'user_id', v_claim.user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_ownership_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_ownership_claim(uuid) TO authenticated, service_role;
