-- 1. Extend translation_jobs with cache/tracking columns
alter table public.translation_jobs
  add column if not exists source_field text,
  add column if not exists source_language text,
  add column if not exists source_content_hash text,
  add column if not exists attempts int not null default 0,
  add column if not exists started_at timestamptz,
  add column if not exists last_error text,
  add column if not exists model text;

-- 2. Reset status constraint so it matches the pipeline states we ship
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.translation_jobs'::regclass and contype='c'
  loop
    execute format('alter table public.translation_jobs drop constraint %I', c.conname);
  end loop;
end$$;

update public.translation_jobs
  set status = 'pending'
  where status not in ('pending','processing','completed','failed','blocked','cancelled');

alter table public.translation_jobs
  add constraint translation_jobs_status_check
  check (status in ('pending','processing','completed','failed','blocked','cancelled'));

-- 3. Prevent duplicate active jobs for the same (business, language, field)
create unique index if not exists translation_jobs_active_unique
  on public.translation_jobs(business_id, target_language, source_field)
  where status in ('pending','processing');

create index if not exists translation_jobs_status_idx
  on public.translation_jobs(status, created_at);

-- 4. Cache-hit index on business_translations
create index if not exists business_translations_hash_idx
  on public.business_translations(business_id, language_code, source_content_hash);

-- 5. Grants + RLS on translation_jobs (admin-only)
grant select, insert, update, delete on public.translation_jobs to authenticated;
grant all on public.translation_jobs to service_role;

alter table public.translation_jobs enable row level security;
drop policy if exists translation_jobs_admin_all on public.translation_jobs;
create policy translation_jobs_admin_all on public.translation_jobs
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- 6. Ensure public.business_translations can be read by anon for public site fallback
grant select on public.business_translations to anon;
grant select on public.business_translations to authenticated;
grant all on public.business_translations to service_role;

-- 7. Ensure updated_at is maintained
drop trigger if exists translation_jobs_set_updated_at on public.translation_jobs;
create trigger translation_jobs_set_updated_at
  before update on public.translation_jobs
  for each row execute function public.set_updated_at();