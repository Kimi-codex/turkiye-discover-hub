
-- Trigger-only helpers: nobody calls these directly
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Admin RPCs internally re-check has_role; anon must never call them
REVOKE ALL ON FUNCTION public.record_audit(text, text, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_ownership_claim(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_user_role(uuid, app_role, boolean, boolean) FROM PUBLIC, anon;

-- has_role is referenced inside RLS policies; authenticated needs execute, anon doesn't
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
