
-- Phase 6: Secure first-user admin bootstrap
-- Persistent, race-safe, atomic. Never re-opens once completed.

-- 1) Seed the permanent bootstrap flag (protected: only admins/service role write via RLS).
INSERT INTO public.site_settings (key, value, is_public, description)
VALUES (
  'security.initial_admin_bootstrapped',
  'false'::jsonb,
  false,
  'Permanent flag: true once the initial admin has been granted. Never automatically reset.'
)
ON CONFLICT (key) DO NOTHING;

-- 2) Atomic bootstrap function. SECURITY DEFINER, callable only from triggers or service role.
CREATE OR REPLACE FUNCTION public._try_bootstrap_first_admin(
  _user_id uuid,
  _provider text,
  _email_confirmed_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag jsonb;
  v_admin_count integer;
BEGIN
  -- Only email/password signups are eligible.
  IF _provider IS DISTINCT FROM 'email' THEN
    RETURN false;
  END IF;
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;
  -- If email confirmation is required at the auth level, only proceed after confirmation.
  -- We defer to the trigger caller: caller passes NULL confirmed_at to signal "wait".
  IF _email_confirmed_at IS NULL THEN
    RETURN false;
  END IF;

  -- Serialise concurrent bootstrap attempts with an xact-scoped advisory lock.
  PERFORM pg_advisory_xact_lock(hashtext('security.initial_admin_bootstrap'));

  -- Lock the flag row and re-check under lock.
  SELECT value INTO v_flag
    FROM public.site_settings
   WHERE key = 'security.initial_admin_bootstrapped'
   FOR UPDATE;

  IF v_flag IS NULL THEN
    -- Seed row must exist; if missing, insert false and lock it.
    INSERT INTO public.site_settings (key, value, is_public, description)
      VALUES ('security.initial_admin_bootstrapped', 'false'::jsonb, false,
              'Permanent flag: true once initial admin has been granted.')
      ON CONFLICT (key) DO NOTHING;
    SELECT value INTO v_flag FROM public.site_settings
     WHERE key = 'security.initial_admin_bootstrapped' FOR UPDATE;
  END IF;

  IF v_flag = 'true'::jsonb THEN
    RETURN false; -- Already done, never re-opens.
  END IF;

  -- Extra defence: refuse if any admin exists (should be impossible when flag is false).
  SELECT count(*) INTO v_admin_count
    FROM public.user_roles WHERE role = 'admin'::app_role;
  IF v_admin_count > 0 THEN
    -- Reconcile: mark flag true so we never try again.
    UPDATE public.site_settings SET value = 'true'::jsonb, updated_at = now()
     WHERE key = 'security.initial_admin_bootstrapped';
    RETURN false;
  END IF;

  -- Grant admin idempotently.
  INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'admin'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

  -- Permanently mark bootstrap complete.
  UPDATE public.site_settings
     SET value = 'true'::jsonb, updated_at = now()
   WHERE key = 'security.initial_admin_bootstrapped';

  -- Audit log (service-definer path; bypass has_role check via direct insert).
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (_user_id, 'admin.bootstrap', 'user', _user_id::text,
      jsonb_build_object('source', 'first_user_auto', 'provider', _provider));

  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    -- Never break auth flow. Log and continue.
    RAISE WARNING '_try_bootstrap_first_admin failed for %: %', _user_id, SQLERRM;
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public._try_bootstrap_first_admin(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;

-- 3) Extend handle_new_user trigger: attempt bootstrap on INSERT for confirmed email/password users.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider text;
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, preferred_language)
  VALUES (
    NEW.id,
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'full_name',
                    NEW.raw_user_meta_data ->> 'name', ''), ''),
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'avatar_url',
                    NEW.raw_user_meta_data ->> 'picture', ''), ''),
    CASE WHEN NEW.raw_user_meta_data ->> 'preferred_language' IN ('ar','en','tr')
         THEN NEW.raw_user_meta_data ->> 'preferred_language' ELSE 'tr' END
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user') ON CONFLICT (user_id, role) DO NOTHING;

  -- Attempt first-admin bootstrap (only fires for confirmed email/password users).
  v_provider := NEW.raw_app_meta_data ->> 'provider';
  PERFORM public._try_bootstrap_first_admin(NEW.id, v_provider, NEW.email_confirmed_at);

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- 4) Trigger on email confirmation: retry bootstrap when a user confirms email.
CREATE OR REPLACE FUNCTION public.handle_user_email_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider text;
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND (OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at) THEN
    v_provider := NEW.raw_app_meta_data ->> 'provider';
    PERFORM public._try_bootstrap_first_admin(NEW.id, v_provider, NEW.email_confirmed_at);
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_user_email_confirmed failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_email_confirmed();

-- 5) Reconcile with current state: if an admin already exists, mark bootstrap complete.
UPDATE public.site_settings
   SET value = 'true'::jsonb
 WHERE key = 'security.initial_admin_bootstrapped'
   AND EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin'::app_role);
