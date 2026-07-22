-- Phase 1 foundation: business-scoped ownership.
-- Global roles and businesses.owner_id are retained for compatibility.

CREATE TABLE IF NOT EXISTS public.business_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'manager')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'revoked', 'suspended')),
  is_primary boolean NOT NULL DEFAULT false,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT business_members_manager_not_primary CHECK (role <> 'manager' OR is_primary = false)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_members_active_user
  ON public.business_members (business_id, user_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_members_primary_owner
  ON public.business_members (business_id)
  WHERE role = 'owner' AND status = 'active' AND is_primary = true;

CREATE INDEX IF NOT EXISTS idx_business_members_user_status
  ON public.business_members (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_members_business_status
  ON public.business_members (business_id, status, role);

DROP TRIGGER IF EXISTS business_members_set_updated_at ON public.business_members;
CREATE TRIGGER business_members_set_updated_at
  BEFORE UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_members_own_read ON public.business_members;
CREATE POLICY business_members_own_read ON public.business_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS business_members_admin_all ON public.business_members;
CREATE POLICY business_members_admin_all ON public.business_members
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.business_members TO authenticated;
GRANT ALL ON public.business_members TO service_role;

INSERT INTO public.business_members (business_id, user_id, role, status, is_primary, approved_by)
SELECT b.id, b.owner_id, 'owner', 'active', true, NULL
FROM public.businesses b
WHERE b.owner_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.business_member_authz(_business_id uuid, _roles text[] DEFAULT ARRAY['owner','manager'])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_role text;
  v_member_status text;
  v_suspended boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  END IF;

  SELECT public.is_suspended(v_uid) INTO v_suspended;
  IF v_suspended THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SUSPENDED');
  END IF;

  SELECT status INTO v_status FROM public.businesses WHERE id = _business_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BUSINESS_MISSING');
  END IF;

  SELECT role, status INTO v_role, v_member_status
  FROM public.business_members
  WHERE business_id = _business_id
    AND user_id = v_uid
    AND status = 'active'
    AND role = ANY(_roles)
  ORDER BY is_primary DESC, created_at ASC
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_MEMBER');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_uid,
    'business_id', _business_id,
    'business_status', v_status,
    'role', v_role,
    'member_status', v_member_status
  );
END $$;

REVOKE ALL ON FUNCTION public.business_member_authz(uuid, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.business_member_authz(uuid, text[]) TO authenticated;

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
  v_has_legacy_role boolean;
  v_has_owner_membership boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  END IF;

  SELECT public.is_suspended(v_uid) INTO v_suspended;
  IF v_suspended THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SUSPENDED');
  END IF;

  SELECT owner_id, status INTO v_owner, v_status
    FROM public.businesses WHERE id = _business_id;
  IF v_owner IS NULL AND v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BUSINESS_MISSING');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = _business_id
      AND bm.user_id = v_uid
      AND bm.role = 'owner'
      AND bm.status = 'active'
  ) INTO v_has_owner_membership;

  IF v_has_owner_membership THEN
    RETURN jsonb_build_object(
      'ok', true,
      'user_id', v_uid,
      'business_id', _business_id,
      'status', v_status,
      'role', 'owner',
      'source', 'business_members'
    );
  END IF;

  SELECT public.has_role(v_uid, 'business_owner'::app_role) INTO v_has_legacy_role;
  IF NOT v_has_legacy_role THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MISSING_ROLE');
  END IF;

  IF v_owner IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_uid,
    'business_id', _business_id,
    'status', v_status,
    'role', 'owner',
    'source', 'legacy_owner_id'
  );
END $$;

REVOKE ALL ON FUNCTION public.owner_authz(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_authz(uuid) TO authenticated;
