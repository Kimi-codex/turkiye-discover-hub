
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
COMMENT ON FUNCTION public.has_role(uuid, public.app_role) IS
  'RLS helper: SECURITY DEFINER + fixed search_path avoids recursive policy lookups on user_roles. EXECUTE for authenticated is required so authenticated users pass admin/moderator checks in their own row-level policies. The linter warning 0029 is a known false-positive for this pattern.';
