-- TRANSACTIONAL CLEANUP FOR INCORRECT final.json IMPORT
--
-- Scope:
--   - import_batches.id = '1c09b6c8-e459-4187-9a28-e4f0e2ddec3d'
--   - import_batches.original_filename = 'final.json'
--   - businesses.source = 'google_json'
--   - businesses linked to that exact import batch
--
-- Safety:
--   - Deletes no auth users, profiles, roles, settings, categories,
--     category_translations, cities, districts, functions, policies, triggers,
--     or schema objects.
--   - Stops if the target batch/business scope is not exactly the inspected
--     scope.
--   - Stops if protected/user-generated dependent records are linked.
--
-- Default behavior:
--   This script ends with ROLLBACK. Run it once as-is to review affected-row
--   counts. To actually clean the data, change the final ROLLBACK to COMMIT
--   and run the full script again.

begin;

create temp table _cleanup_target_batch on commit drop as
select id
from public.import_batches
where id = '1c09b6c8-e459-4187-9a28-e4f0e2ddec3d'
  and original_filename = 'final.json';

create temp table _cleanup_target_businesses on commit drop as
select b.id
from public.businesses b
where b.source = 'google_json'
  and exists (
    select 1
    from public.import_batch_items ibi
    join _cleanup_target_batch tb on tb.id = ibi.import_batch_id
    where ibi.business_id = b.id
  );

create temp table _cleanup_target_reviews on commit drop as
select r.id
from public.reviews r
join _cleanup_target_businesses tb on tb.id = r.business_id;

create temp table _cleanup_target_images on commit drop as
select bi.id
from public.business_images bi
join _cleanup_target_businesses tb on tb.id = bi.business_id;

create temp table _cleanup_counts (
  step text primary key,
  rows_deleted bigint not null
) on commit drop;

do $$
declare
  v_batches integer;
  v_businesses integer;
  v_non_google integer;
  v_items integer;
  v_favorites integer;
  v_claims integer;
  v_change_requests integer;
  v_reports integer;
  v_analytics integer;
  v_notifications integer;
begin
  select count(*) into v_batches from _cleanup_target_batch;
  select count(*) into v_businesses from _cleanup_target_businesses;

  select count(*) into v_non_google
  from public.businesses b
  join _cleanup_target_businesses tb on tb.id = b.id
  where b.source is distinct from 'google_json';

  select count(*) into v_items
  from public.import_batch_items ibi
  join _cleanup_target_batch tb on tb.id = ibi.import_batch_id;

  select count(*) into v_favorites
  from public.favorites f
  join _cleanup_target_businesses tb on tb.id = f.business_id;

  select count(*) into v_claims
  from public.ownership_claims oc
  join _cleanup_target_businesses tb on tb.id = oc.business_id;

  select count(*) into v_change_requests
  from public.business_change_requests bcr
  join _cleanup_target_businesses tb on tb.id = bcr.business_id;

  select count(*) into v_reports
  from public.reports rep
  left join _cleanup_target_businesses tb on tb.id = rep.business_id
  left join _cleanup_target_reviews tr on tr.id = rep.review_id
  left join _cleanup_target_images ti on ti.id = rep.image_id
  where tb.id is not null or tr.id is not null or ti.id is not null;

  select count(*) into v_analytics
  from public.analytics_events ae
  join _cleanup_target_businesses tb on tb.id = ae.business_id;

  select count(*) into v_notifications
  from public.owner_notifications n
  join _cleanup_target_businesses tb on tb.id = n.business_id;

  if v_batches <> 1 then
    raise exception 'Cleanup aborted: expected exactly 1 target batch, found %', v_batches;
  end if;

  if v_businesses <> 40 then
    raise exception 'Cleanup aborted: expected exactly 40 target businesses, found %', v_businesses;
  end if;

  if v_non_google <> 0 then
    raise exception 'Cleanup aborted: found % non-google_json businesses in cleanup scope', v_non_google;
  end if;

  if v_items <> 40 then
    raise exception 'Cleanup aborted: expected exactly 40 import batch items, found %', v_items;
  end if;

  if v_favorites <> 0
     or v_claims <> 0
     or v_change_requests <> 0
     or v_reports <> 0
     or v_analytics <> 0
     or v_notifications <> 0 then
    raise exception
      'Cleanup aborted: protected/user-linked records exist. favorites=%, claims=%, change_requests=%, reports=%, analytics=%, notifications=%',
      v_favorites, v_claims, v_change_requests, v_reports, v_analytics, v_notifications;
  end if;
end $$;

with deleted as (
  delete from public.review_replies rr
  using _cleanup_target_reviews tr
  where rr.review_id = tr.id
  returning 1
)
insert into _cleanup_counts values ('01_review_replies', (select count(*) from deleted));

with deleted as (
  delete from public.image_processing_jobs ipj
  using _cleanup_target_images ti
  where ipj.business_image_id = ti.id
  returning 1
)
insert into _cleanup_counts values ('02_image_processing_jobs', (select count(*) from deleted));

with deleted as (
  delete from public.business_images bi
  using _cleanup_target_businesses tb
  where bi.business_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('03_business_images', (select count(*) from deleted));

with deleted as (
  delete from public.reviews r
  using _cleanup_target_businesses tb
  where r.business_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('04_reviews', (select count(*) from deleted));

with deleted as (
  delete from public.business_translations bt
  using _cleanup_target_businesses tb
  where bt.business_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('05_business_translations', (select count(*) from deleted));

with deleted as (
  delete from public.business_category_links bcl
  using _cleanup_target_businesses tb
  where bcl.business_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('06_business_category_links', (select count(*) from deleted));

with deleted as (
  delete from public.business_opening_hours boh
  using _cleanup_target_businesses tb
  where boh.business_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('07_business_opening_hours', (select count(*) from deleted));

with deleted as (
  delete from public.business_services bs
  using _cleanup_target_businesses tb
  where bs.business_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('08_business_services', (select count(*) from deleted));

with deleted as (
  delete from public.business_attributes ba
  using _cleanup_target_businesses tb
  where ba.business_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('09_business_attributes', (select count(*) from deleted));

with deleted as (
  delete from public.translation_jobs tj
  using _cleanup_target_businesses tb
  where tj.business_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('10_translation_jobs', (select count(*) from deleted));

with deleted as (
  delete from public.business_import_provenance bip
  using _cleanup_target_businesses tb
  where bip.business_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('11_business_import_provenance_by_business', (select count(*) from deleted));

with deleted as (
  delete from public.business_import_provenance bip
  using _cleanup_target_batch tb
  where bip.import_batch_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('12_business_import_provenance_by_batch_remaining', (select count(*) from deleted));

with deleted as (
  delete from public.import_approvals ia
  using _cleanup_target_batch tb
  where ia.batch_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('13_import_approvals', (select count(*) from deleted));

with deleted as (
  delete from public.import_batch_items ibi
  using _cleanup_target_batch tb
  where ibi.import_batch_id = tb.id
  returning 1
)
insert into _cleanup_counts values ('14_import_batch_items', (select count(*) from deleted));

with deleted as (
  delete from public.businesses b
  using _cleanup_target_businesses tb
  where b.id = tb.id
  returning 1
)
insert into _cleanup_counts values ('15_businesses', (select count(*) from deleted));

with deleted as (
  delete from public.import_batches ib
  using _cleanup_target_batch tb
  where ib.id = tb.id
  returning 1
)
insert into _cleanup_counts values ('16_import_batches', (select count(*) from deleted));

select * from _cleanup_counts order by step;

-- IMPORTANT:
-- Leave as ROLLBACK for a dry run.
-- Change to COMMIT only after reviewing the row counts above.
rollback;
