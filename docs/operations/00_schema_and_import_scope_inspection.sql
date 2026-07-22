-- Read-only schema and import-scope inspection for the import remediation plan.
-- Run manually in the Supabase SQL Editor before preparing any cleanup script.
--
-- This script intentionally performs no writes and no deletes.
-- It verifies the live schema, FK graph, and current imported-data scope so a
-- later cleanup transaction can be generated against real database metadata.

-- 1. Tables expected to participate in imported business cleanup.
with expected(table_name) as (
  values
    ('businesses'),
    ('business_images'),
    ('reviews'),
    ('review_replies'),
    ('business_translations'),
    ('business_category_links'),
    ('business_opening_hours'),
    ('business_services'),
    ('business_attributes'),
    ('business_import_provenance'),
    ('import_batch_items'),
    ('import_approvals'),
    ('import_batches'),
    ('image_processing_jobs'),
    ('translation_jobs'),
    ('favorites'),
    ('reports'),
    ('ownership_claims'),
    ('business_change_requests'),
    ('owner_notifications'),
    ('analytics_events'),
    ('audit_logs')
)
select
  e.table_name,
  case when t.table_name is null then false else true end as exists_in_public_schema
from expected e
left join information_schema.tables t
  on t.table_schema = 'public'
 and t.table_name = e.table_name
order by e.table_name;

-- 2. Live column inventory for relevant tables.
select
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'businesses',
    'business_images',
    'reviews',
    'review_replies',
    'business_translations',
    'business_category_links',
    'business_opening_hours',
    'business_services',
    'business_attributes',
    'business_import_provenance',
    'import_batch_items',
    'import_approvals',
    'import_batches',
    'image_processing_jobs',
    'translation_jobs',
    'favorites',
    'reports',
    'ownership_claims',
    'business_change_requests',
    'owner_notifications',
    'analytics_events',
    'audit_logs'
  )
order by c.table_name, c.ordinal_position;

-- 3. FK graph touching businesses/import/image/review/translation tables.
select
  tc.constraint_name,
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  rc.update_rule,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.table_schema = tc.table_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
 and rc.constraint_schema = tc.table_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and (
    tc.table_name in (
      'businesses',
      'business_images',
      'reviews',
      'review_replies',
      'business_translations',
      'business_category_links',
      'business_opening_hours',
      'business_services',
      'business_attributes',
      'business_import_provenance',
      'import_batch_items',
      'import_approvals',
      'import_batches',
      'image_processing_jobs',
      'translation_jobs',
      'favorites',
      'reports',
      'ownership_claims',
      'business_change_requests',
      'owner_notifications',
      'analytics_events',
      'audit_logs'
    )
    or ccu.table_name in (
      'businesses',
      'business_images',
      'reviews',
      'import_batches',
      'import_batch_items'
    )
  )
order by tc.table_name, kcu.column_name;

-- 3b. Unique/check constraints and indexes needed for idempotent import upserts.
select
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type
from information_schema.table_constraints tc
where tc.table_schema = 'public'
  and tc.table_name in ('businesses', 'business_images', 'reviews', 'business_category_links', 'import_batch_items', 'import_batches')
  and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE', 'CHECK')
order by tc.table_name, tc.constraint_type, tc.constraint_name;

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('businesses', 'business_images', 'reviews', 'business_category_links', 'import_batch_items', 'import_batches')
order by tablename, indexname;

-- 3c. Required import-remediation columns. Any false value must be resolved
-- before cleanup/re-import verification.
with required_columns(table_name, column_name) as (
  values
    ('business_images', 'place_id'),
    ('business_images', 'source_url'),
    ('business_images', 'source_metadata'),
    ('business_images', 'source_fingerprint'),
    ('business_images', 'sort_order'),
    ('business_images', 'is_cover'),
    ('business_images', 'storage_status'),
    ('reviews', 'external_review_id'),
    ('reviews', 'source'),
    ('reviews', 'source_fingerprint'),
    ('reviews', 'author_name'),
    ('reviews', 'review_text'),
    ('reviews', 'review_language'),
    ('reviews', 'review_date')
)
select
  rc.table_name,
  rc.column_name,
  (c.column_name is not null) as exists_in_live_schema
from required_columns rc
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = rc.table_name
 and c.column_name = rc.column_name
order by rc.table_name, rc.column_name;

-- 4. Candidate incorrect import scope by source = 'google_json'.
select
  count(*) as google_json_businesses,
  count(*) filter (where status = 'published') as published,
  count(*) filter (where status = 'pending_review') as pending_review,
  min(created_at) as first_created_at,
  max(created_at) as last_created_at
from public.businesses
where source = 'google_json';

select
  id,
  place_id,
  slug,
  name,
  status,
  rating,
  review_count,
  created_at,
  updated_at
from public.businesses
where source = 'google_json'
order by created_at desc
limit 25;

-- 5. Dependent row counts for candidate imported businesses.
with target_businesses as (
  select id from public.businesses where source = 'google_json'
)
select 'business_images' as table_name, count(*) as rows
from public.business_images bi
join target_businesses tb on tb.id = bi.business_id
union all
select 'reviews', count(*)
from public.reviews r
join target_businesses tb on tb.id = r.business_id
union all
select 'review_replies', count(*)
from public.review_replies rr
join public.reviews r on r.id = rr.review_id
join target_businesses tb on tb.id = r.business_id
union all
select 'business_translations', count(*)
from public.business_translations bt
join target_businesses tb on tb.id = bt.business_id
union all
select 'business_category_links', count(*)
from public.business_category_links bcl
join target_businesses tb on tb.id = bcl.business_id
union all
select 'business_opening_hours', count(*)
from public.business_opening_hours boh
join target_businesses tb on tb.id = boh.business_id
union all
select 'business_services', count(*)
from public.business_services bs
join target_businesses tb on tb.id = bs.business_id
union all
select 'business_attributes', count(*)
from public.business_attributes ba
join target_businesses tb on tb.id = ba.business_id
union all
select 'business_import_provenance', count(*)
from public.business_import_provenance bip
join target_businesses tb on tb.id = bip.business_id
union all
select 'import_batch_items', count(*)
from public.import_batch_items ibi
join target_businesses tb on tb.id = ibi.business_id
union all
select 'translation_jobs', count(*)
from public.translation_jobs tj
join target_businesses tb on tb.id = tj.business_id
union all
select 'image_processing_jobs', count(*)
from public.image_processing_jobs ipj
join public.business_images bi on bi.id = ipj.business_image_id
join target_businesses tb on tb.id = bi.business_id
union all
select 'favorites', count(*)
from public.favorites f
join target_businesses tb on tb.id = f.business_id
union all
select 'reports_business', count(*)
from public.reports rep
join target_businesses tb on tb.id = rep.business_id
union all
select 'reports_image', count(*)
from public.reports rep
join public.business_images bi on bi.id = rep.image_id
join target_businesses tb on tb.id = bi.business_id
union all
select 'reports_review', count(*)
from public.reports rep
join public.reviews r on r.id = rep.review_id
join target_businesses tb on tb.id = r.business_id
union all
select 'ownership_claims', count(*)
from public.ownership_claims oc
join target_businesses tb on tb.id = oc.business_id
union all
select 'business_change_requests', count(*)
from public.business_change_requests bcr
join target_businesses tb on tb.id = bcr.business_id
union all
select 'owner_notifications', count(*)
from public.owner_notifications n
join target_businesses tb on tb.id = n.business_id
union all
select 'analytics_events', count(*)
from public.analytics_events ae
join target_businesses tb on tb.id = ae.business_id
order by table_name;

-- 6. Import batch scope connected to candidate imported businesses.
with target_businesses as (
  select id from public.businesses where source = 'google_json'
),
target_batches as (
  select distinct import_batch_id as id
  from public.import_batch_items ibi
  join target_businesses tb on tb.id = ibi.business_id
  where ibi.import_batch_id is not null
  union
  select distinct import_batch_id as id
  from public.business_import_provenance bip
  join target_businesses tb on tb.id = bip.business_id
  where bip.import_batch_id is not null
)
select
  ib.id,
  ib.original_filename,
  ib.status,
  ib.stage,
  ib.total_items,
  ib.valid_items,
  ib.invalid_items,
  ib.inserted_items,
  ib.updated_items,
  ib.failed_items,
  ib.created_at,
  ib.updated_at
from public.import_batches ib
join target_batches tb on tb.id = ib.id
order by ib.created_at desc;

-- 7. Import batch dependent counts for candidate batches.
with target_businesses as (
  select id from public.businesses where source = 'google_json'
),
target_batches as (
  select distinct import_batch_id as id
  from public.import_batch_items ibi
  join target_businesses tb on tb.id = ibi.business_id
  where ibi.import_batch_id is not null
  union
  select distinct import_batch_id as id
  from public.business_import_provenance bip
  join target_businesses tb on tb.id = bip.business_id
  where bip.import_batch_id is not null
)
select 'import_batch_items' as table_name, count(*) as rows
from public.import_batch_items ibi
join target_batches tb on tb.id = ibi.import_batch_id
union all
select 'import_approvals', count(*)
from public.import_approvals ia
join target_batches tb on tb.id = ia.batch_id
union all
select 'business_import_provenance', count(*)
from public.business_import_provenance bip
join target_batches tb on tb.id = bip.import_batch_id
union all
select 'import_batches', count(*)
from public.import_batches ib
join target_batches tb on tb.id = ib.id
order by table_name;

-- 8. Protected-data sanity checks. These should not be included in cleanup.
select 'manual_businesses' as protected_scope, count(*) as rows
from public.businesses
where source <> 'google_json' or source is null
union all
select 'categories', count(*) from public.categories
union all
select 'category_translations', count(*) from public.category_translations
union all
select 'cities', count(*) from public.cities
union all
select 'districts', count(*) from public.districts
union all
select 'site_settings', count(*) from public.site_settings
union all
select 'profiles', count(*) from public.profiles
union all
select 'user_roles', count(*) from public.user_roles
order by protected_scope;
