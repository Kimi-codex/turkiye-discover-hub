-- Helper RPC that returns published business UUIDs matching a category
-- via EITHER primary_category_id OR business_category_links.
-- Used by the server-side search function to avoid listing thousands
-- of IDs in a PostgREST `id.in.(...)` URL parameter (URL too long /
-- 414 on large categories).
--
-- security invoker + search_path = public so it respects caller RLS.
-- Called from supabaseAdmin (service_role) which bypasses RLS.
--
-- Usage:  SELECT business_id FROM search_business_ids_for_category('uuid-here');

create or replace function public.search_business_ids_for_category(
  p_category_id uuid
)
returns table(business_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct b.id
  from businesses b
  left join business_category_links bcl on bcl.business_id = b.id
  where b.status = 'published'
    and (b.primary_category_id = p_category_id or bcl.category_id = p_category_id)
$$;

grant execute on function public.search_business_ids_for_category(uuid) to anon, authenticated, service_role;
