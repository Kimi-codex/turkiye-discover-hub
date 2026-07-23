-- V1 user + owner experience support.
-- Additive migration: team invitations, owner/member read policies, and
-- category change-request support. Does not grant or depend on global
-- business_owner for new access.

CREATE TABLE IF NOT EXISTS public.business_member_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'manager' CHECK (role = 'manager'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'canceled', 'expired')),
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  canceled_at timestamptz,
  CONSTRAINT business_member_invitations_email_normalized
    CHECK (email = lower(trim(email)))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_member_invitations_pending_email
  ON public.business_member_invitations (business_id, email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_business_member_invitations_business_status
  ON public.business_member_invitations (business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_member_invitations_email_status
  ON public.business_member_invitations (email, status, expires_at);

DROP TRIGGER IF EXISTS business_member_invitations_set_updated_at ON public.business_member_invitations;
CREATE TRIGGER business_member_invitations_set_updated_at
  BEFORE UPDATE ON public.business_member_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_member_invitations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.business_change_requests
  DROP CONSTRAINT IF EXISTS bcr_request_type_check;

ALTER TABLE public.business_change_requests
  ADD CONSTRAINT bcr_request_type_check CHECK (
    request_type IN (
      'business_fields',
      'categories',
      'opening_hours',
      'services',
      'attributes',
      'translations',
      'image_request'
    )
  );

DROP POLICY IF EXISTS business_member_invitations_admin_all ON public.business_member_invitations;
CREATE POLICY business_member_invitations_admin_all ON public.business_member_invitations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

GRANT ALL ON public.business_member_invitations TO service_role;

DROP POLICY IF EXISTS businesses_member_read ON public.businesses;
CREATE POLICY businesses_member_read ON public.businesses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_members bm
      WHERE bm.business_id = businesses.id
        AND bm.user_id = auth.uid()
        AND bm.status = 'active'
        AND bm.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS bcl_member_read ON public.business_category_links;
CREATE POLICY bcl_member_read ON public.business_category_links
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_members bm
      WHERE bm.business_id = business_category_links.business_id
        AND bm.user_id = auth.uid()
        AND bm.status = 'active'
        AND bm.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS business_images_member_read ON public.business_images;
CREATE POLICY business_images_member_read ON public.business_images
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.business_members bm
      WHERE bm.business_id = business_images.business_id
        AND bm.user_id = auth.uid()
        AND bm.status = 'active'
        AND bm.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS boh_member_read ON public.business_opening_hours;
CREATE POLICY boh_member_read ON public.business_opening_hours
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_members bm
      WHERE bm.business_id = business_opening_hours.business_id
        AND bm.user_id = auth.uid()
        AND bm.status = 'active'
        AND bm.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS business_services_member_read ON public.business_services;
CREATE POLICY business_services_member_read ON public.business_services
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_members bm
      WHERE bm.business_id = business_services.business_id
        AND bm.user_id = auth.uid()
        AND bm.status = 'active'
        AND bm.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS business_attributes_member_read ON public.business_attributes;
CREATE POLICY business_attributes_member_read ON public.business_attributes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_members bm
      WHERE bm.business_id = business_attributes.business_id
        AND bm.user_id = auth.uid()
        AND bm.status = 'active'
        AND bm.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS bt_member_read ON public.business_translations;
CREATE POLICY bt_member_read ON public.business_translations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_members bm
      WHERE bm.business_id = business_translations.business_id
        AND bm.user_id = auth.uid()
        AND bm.status = 'active'
        AND bm.role IN ('owner', 'manager')
    )
  );

CREATE OR REPLACE FUNCTION public._business_member_is_owner(_business_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = _business_id
      AND bm.user_id = _user_id
      AND bm.role = 'owner'
      AND bm.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public._business_member_is_owner(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._business_member_is_owner(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.list_business_team(_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_members jsonb;
  v_invitations jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'list_business_team: authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public._business_member_is_owner(_business_id, v_actor) THEN
    RAISE EXCEPTION 'list_business_team: owner membership required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membership_id', bm.id,
    'user_id', bm.user_id,
    'email', au.email,
    'role', bm.role,
    'status', bm.status,
    'is_primary', bm.is_primary,
    'created_at', bm.created_at
  ) ORDER BY bm.is_primary DESC, bm.created_at ASC), '[]'::jsonb)
  INTO v_members
  FROM public.business_members bm
  LEFT JOIN auth.users au ON au.id = bm.user_id
  WHERE bm.business_id = _business_id
    AND bm.status = 'active';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', bmi.id,
    'email', bmi.email,
    'role', bmi.role,
    'status', CASE WHEN bmi.status = 'pending' AND bmi.expires_at <= now() THEN 'expired' ELSE bmi.status END,
    'token', CASE WHEN bmi.status = 'pending' AND bmi.expires_at > now() THEN bmi.token::text ELSE NULL END,
    'expires_at', bmi.expires_at,
    'created_at', bmi.created_at,
    'accepted_at', bmi.accepted_at,
    'canceled_at', bmi.canceled_at
  ) ORDER BY bmi.created_at DESC), '[]'::jsonb)
  INTO v_invitations
  FROM public.business_member_invitations bmi
  WHERE bmi.business_id = _business_id
    AND bmi.status IN ('pending', 'accepted', 'canceled')
    AND bmi.created_at > now() - interval '90 days';

  RETURN jsonb_build_object('members', v_members, 'invitations', v_invitations);
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_business_manager(_business_id uuid, _email text)
RETURNS public.business_member_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := lower(trim(_email));
  v_existing_user uuid;
  v_invitation public.business_member_invitations;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'invite_business_manager: authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public._business_member_is_owner(_business_id, v_actor) THEN
    RAISE EXCEPTION 'invite_business_manager: owner membership required' USING ERRCODE = '42501';
  END IF;

  IF v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invite_business_manager: invalid email' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing_user
  FROM auth.users
  WHERE lower(email) = v_email
  LIMIT 1;

  IF v_existing_user IS NOT NULL AND public._business_member_is_owner(_business_id, v_existing_user) THEN
    RAISE EXCEPTION 'invite_business_manager: user is already an owner' USING ERRCODE = '23505';
  END IF;

  IF v_existing_user IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = _business_id
      AND bm.user_id = v_existing_user
      AND bm.status = 'active'
      AND bm.role = 'manager'
  ) THEN
    RAISE EXCEPTION 'invite_business_manager: user is already a manager' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.business_member_invitations (
    business_id, email, role, status, token, invited_by, expires_at
  )
  VALUES (_business_id, v_email, 'manager', 'pending', gen_random_uuid(), v_actor, now() + interval '14 days')
  ON CONFLICT (business_id, email) WHERE status = 'pending'
  DO UPDATE SET
    token = gen_random_uuid(),
    invited_by = EXCLUDED.invited_by,
    expires_at = now() + interval '14 days',
    updated_at = now()
  RETURNING * INTO v_invitation;

  RETURN v_invitation;
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_business_team_invitation(_business_id uuid, _invitation_id uuid)
RETURNS public.business_member_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_invitation public.business_member_invitations;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'regenerate_business_team_invitation: authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public._business_member_is_owner(_business_id, v_actor) THEN
    RAISE EXCEPTION 'regenerate_business_team_invitation: owner membership required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.business_member_invitations
  SET token = gen_random_uuid(),
      expires_at = now() + interval '14 days',
      invited_by = v_actor,
      updated_at = now()
  WHERE id = _invitation_id
    AND business_id = _business_id
    AND status = 'pending'
    AND accepted_at IS NULL
  RETURNING * INTO v_invitation;

  IF v_invitation.id IS NULL THEN
    RAISE EXCEPTION 'regenerate_business_team_invitation: pending invitation not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_invitation;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_business_team_invitation(_business_id uuid, _invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'cancel_business_team_invitation: authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public._business_member_is_owner(_business_id, v_actor) THEN
    RAISE EXCEPTION 'cancel_business_team_invitation: owner membership required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.business_member_invitations
  SET status = 'canceled',
      canceled_at = now(),
      updated_at = now()
  WHERE id = _invitation_id
    AND business_id = _business_id
    AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_business_team_invitation(_invitation_id uuid, _token uuid)
RETURNS public.business_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := lower(COALESCE(auth.jwt() ->> 'email', ''));
  v_invitation public.business_member_invitations;
  v_member public.business_members;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'accept_business_team_invitation: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invitation
  FROM public.business_member_invitations
  WHERE id = _invitation_id
    AND token = _token
    AND status = 'pending'
  FOR UPDATE;

  IF v_invitation.id IS NULL THEN
    RAISE EXCEPTION 'accept_business_team_invitation: invitation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_invitation.expires_at <= now() THEN
    UPDATE public.business_member_invitations
    SET status = 'expired', updated_at = now()
    WHERE id = v_invitation.id;
    RAISE EXCEPTION 'accept_business_team_invitation: invitation expired' USING ERRCODE = '22023';
  END IF;

  IF v_email IS DISTINCT FROM v_invitation.email THEN
    RAISE EXCEPTION 'accept_business_team_invitation: email mismatch' USING ERRCODE = '42501';
  END IF;

  IF public._business_member_is_owner(v_invitation.business_id, v_actor) THEN
    RAISE EXCEPTION 'accept_business_team_invitation: owner cannot accept manager invitation' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.business_members (
    business_id, user_id, role, status, is_primary, invited_by, approved_by
  )
  VALUES (
    v_invitation.business_id, v_actor, 'manager', 'active', false, v_invitation.invited_by, v_invitation.invited_by
  )
  ON CONFLICT (business_id, user_id) WHERE status = 'active'
  DO UPDATE SET
    role = CASE WHEN business_members.role = 'owner' THEN business_members.role ELSE 'manager' END,
    invited_by = EXCLUDED.invited_by,
    approved_by = EXCLUDED.approved_by,
    updated_at = now()
  RETURNING * INTO v_member;

  UPDATE public.business_member_invitations
  SET status = 'accepted',
      accepted_by = v_actor,
      accepted_at = now(),
      updated_at = now()
  WHERE id = v_invitation.id;

  INSERT INTO public.owner_notifications (user_id, business_id, kind, payload)
  VALUES (
    v_invitation.invited_by,
    v_invitation.business_id,
    'team_invitation_accepted',
    jsonb_build_object('email', v_invitation.email, 'member_id', v_member.id)
  );

  RETURN v_member;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_business_manager(_business_id uuid, _member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_member public.business_members;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'remove_business_manager: authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public._business_member_is_owner(_business_id, v_actor) THEN
    RAISE EXCEPTION 'remove_business_manager: owner membership required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_member
  FROM public.business_members
  WHERE id = _member_id
    AND business_id = _business_id
  FOR UPDATE;

  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'remove_business_manager: member not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_member.role <> 'manager' OR v_member.is_primary THEN
    RAISE EXCEPTION 'remove_business_manager: only managers can be removed here' USING ERRCODE = '42501';
  END IF;

  UPDATE public.business_members
  SET status = 'revoked',
      revoked_at = now(),
      updated_at = now()
  WHERE id = _member_id
    AND business_id = _business_id
    AND role = 'manager'
    AND status = 'active';

  INSERT INTO public.owner_notifications (user_id, business_id, kind, payload)
  VALUES (
    v_member.user_id,
    _business_id,
    'team_membership_revoked',
    jsonb_build_object('business_id', _business_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_business_team(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.invite_business_manager(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.regenerate_business_team_invitation(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.cancel_business_team_invitation(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.accept_business_team_invitation(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.remove_business_manager(uuid, uuid) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.list_business_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_business_manager(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_business_team_invitation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_business_team_invitation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_business_team_invitation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_business_manager(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._bcr_field_allowlist(_type text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _type
    WHEN 'business_fields' THEN ARRAY[
      'name','description','phone','international_phone','email','website',
      'formatted_address','neighborhood','price_level'
    ]
    WHEN 'categories' THEN ARRAY['categories']
    WHEN 'opening_hours' THEN ARRAY['opening_hours']
    WHEN 'services' THEN ARRAY['services']
    WHEN 'attributes' THEN ARRAY['attributes']
    WHEN 'translations' THEN ARRAY['translations']
    WHEN 'image_request' THEN ARRAY['image_request']
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION public.apply_business_change_request(
  _request_id uuid,
  _approve jsonb DEFAULT '[]'::jsonb,
  _reject jsonb DEFAULT '[]'::jsonb,
  _admin_notes text DEFAULT NULL
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
  v_fs jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_final_status text;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cr FROM public.business_change_requests WHERE id = _request_id FOR UPDATE;
  IF v_cr.id IS NULL THEN
    RAISE EXCEPTION 'change request not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_cr.status <> 'pending' THEN
    RAISE EXCEPTION 'change request already reviewed' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE id = v_cr.business_id FOR UPDATE;
  IF v_biz.id IS NULL THEN
    RAISE EXCEPTION 'business not found' USING ERRCODE = 'P0002';
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

  ELSIF v_cr.request_type = 'categories' THEN
    IF (COALESCE(_approve, '[]'::jsonb)) @> '["categories"]'::jsonb THEN
      IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(v_cr.changes -> 'category_ids', '[]'::jsonb)) cid
        JOIN public.categories c ON c.id = cid::uuid AND c.is_active = true
      ) THEN
        RAISE EXCEPTION 'at least one active category required' USING ERRCODE = '22023';
      END IF;

      DELETE FROM public.business_category_links WHERE business_id = v_biz.id;
      INSERT INTO public.business_category_links (business_id, category_id, is_primary)
      SELECT
        v_biz.id,
        cid::uuid,
        cid::uuid = NULLIF(v_cr.changes ->> 'primary_category_id', '')::uuid
      FROM jsonb_array_elements_text(COALESCE(v_cr.changes -> 'category_ids', '[]'::jsonb)) cid
      JOIN public.categories c ON c.id = cid::uuid AND c.is_active = true
      ON CONFLICT (business_id, category_id) DO UPDATE
        SET is_primary = EXCLUDED.is_primary;

      UPDATE public.businesses
      SET primary_category_id = NULLIF(v_cr.changes ->> 'primary_category_id', '')::uuid,
          field_sources = COALESCE(field_sources,'{}'::jsonb) || jsonb_build_object(
            'categories', jsonb_build_object('source','owner','user_id',v_cr.submitted_by,'at', now())),
          updated_at = now()
      WHERE id = v_biz.id;
      v_applied := '["categories"]'::jsonb;
    ELSE
      v_rejected := '["categories"]'::jsonb;
    END IF;

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
        reviewed_by = v_actor,
        reviewed_at = now(),
        admin_notes = _admin_notes,
        updated_at = now()
    WHERE id = v_cr.id;

  INSERT INTO public.owner_notifications (user_id, business_id, kind, payload)
  VALUES (
    v_cr.submitted_by,
    v_cr.business_id,
    'change_request_reviewed',
    jsonb_build_object(
      'request_id', v_cr.id,
      'request_type', v_cr.request_type,
      'status', v_final_status,
      'approved', v_applied,
      'rejected', v_rejected
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_cr.id,
    'status', v_final_status,
    'approved', v_applied,
    'rejected', v_rejected
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_business_change_request(uuid, jsonb, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_business_change_request(uuid, jsonb, jsonb, text) TO authenticated;
