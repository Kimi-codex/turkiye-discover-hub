-- Keep ownership revocation consistent across legacy owner_id and scoped
-- business_members during the transition.

CREATE OR REPLACE FUNCTION public.revoke_ownership(_business_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_biz public.businesses;
  v_owner uuid;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'revoke_ownership: not admin' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE id = _business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'business not found' USING ERRCODE = 'P0002';
  END IF;

  v_owner := v_biz.owner_id;

  UPDATE public.businesses
    SET owner_id = NULL, updated_at = now()
    WHERE id = _business_id;

  UPDATE public.business_members
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, now()),
        is_primary = false
    WHERE business_id = _business_id
      AND role = 'owner'
      AND status = 'active';

  IF v_owner IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.businesses b
       WHERE b.owner_id = v_owner
         AND b.id <> _business_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.business_members bm
       WHERE bm.user_id = v_owner
         AND bm.role = 'owner'
         AND bm.status = 'active'
     ) THEN
    DELETE FROM public.user_roles
    WHERE user_id = v_owner
      AND role = 'business_owner'::app_role;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, metadata)
    VALUES (
      v_actor,
      'ownership.revoke',
      'business',
      _business_id::text,
      to_jsonb(v_biz),
      jsonb_build_object('owner_id', NULL, 'business_members_revoked', true),
      jsonb_build_object('reason', _reason)
    );

  RETURN jsonb_build_object('ok', true, 'business_id', _business_id, 'previous_owner_id', v_owner);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_ownership(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_ownership(uuid, text) TO authenticated;
