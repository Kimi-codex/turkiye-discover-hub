-- Phase 1 public search performance support.
-- Manual-review only: additive indexes and pg_trgm for existing normal search.
-- No RLS, grants, ownership, onboarding, storage, AI, vector, or geo changes.

create extension if not exists pg_trgm with schema extensions;

create index if not exists businesses_published_status_rating_idx
  on public.businesses (status, rating desc nulls last, review_count desc nulls last)
  where status = 'published';

create index if not exists businesses_published_city_district_idx
  on public.businesses (city_id, district_id, rating desc nulls last)
  where status = 'published';

create index if not exists businesses_published_primary_category_idx
  on public.businesses (primary_category_id, rating desc nulls last)
  where status = 'published';

create index if not exists businesses_published_price_rating_idx
  on public.businesses (price_level, rating desc nulls last)
  where status = 'published';

create index if not exists businesses_published_created_at_idx
  on public.businesses (created_at desc)
  where status = 'published';

create index if not exists businesses_published_name_trgm_idx
  on public.businesses using gin (name gin_trgm_ops)
  where status = 'published';

create index if not exists businesses_published_address_trgm_idx
  on public.businesses using gin (formatted_address gin_trgm_ops)
  where status = 'published';

create index if not exists business_category_links_category_business_idx
  on public.business_category_links (category_id, business_id);

create index if not exists business_category_links_business_category_idx
  on public.business_category_links (business_id, category_id);

create index if not exists cities_slug_active_idx
  on public.cities (slug)
  where is_active = true;

create index if not exists districts_slug_active_idx
  on public.districts (slug)
  where is_active = true;

create index if not exists categories_slug_active_idx
  on public.categories (slug)
  where is_active = true;
