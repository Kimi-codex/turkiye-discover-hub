
-- =====================================================================
-- Phase 2 · M1: foundation — roles, profiles, trigger infrastructure
-- =====================================================================

-- app_role enum
CREATE TYPE public.app_role AS ENUM ('user', 'business_owner', 'moderator', 'admin');

-- Shared updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- user_roles: authoritative role storage (NEVER on profiles)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role: SECURITY DEFINER function usable in RLS without recursion
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated, service_role;

-- Policies on user_roles
-- Users may read only their own role rows
CREATE POLICY "user_roles_select_own"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins may read all role rows
CREATE POLICY "user_roles_select_admin"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- No INSERT/UPDATE/DELETE policies for authenticated/anon → all role
-- mutations blocked from the client. Only service_role can manage roles.

-- =====================================================================
-- profiles
-- =====================================================================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  phone text,
  preferred_language text NOT NULL DEFAULT 'tr',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_preferred_language_check
    CHECK (preferred_language IN ('ar', 'en', 'tr')),
  CONSTRAINT profiles_status_check
    CHECK (status IN ('active', 'suspended', 'blocked'))
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_select_admin"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- users cannot change status through their own update path
    AND status = (SELECT status FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- handle_new_user: robust trigger that never blocks signup
-- =====================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- profile: safe defaults, never fail because of missing metadata
  INSERT INTO public.profiles (id, full_name, avatar_url, preferred_language)
  VALUES (
    NEW.id,
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'full_name',
                    NEW.raw_user_meta_data ->> 'name',
                    ''), ''),
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'avatar_url',
                    NEW.raw_user_meta_data ->> 'picture',
                    ''), ''),
    CASE
      WHEN NEW.raw_user_meta_data ->> 'preferred_language' IN ('ar', 'en', 'tr')
        THEN NEW.raw_user_meta_data ->> 'preferred_language'
      ELSE 'tr'
    END
  )
  ON CONFLICT (id) DO NOTHING;

  -- default 'user' role, exactly once
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never block auth.users creation on profile side-effects.
    RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
