# Phase E Launch Experience Handoff

## Executive summary

Phase E implemented the public launch layer on top of the approved Phase D architecture. The work focused on SEO foundation, public directory UX, search experience refinements, public maps, and launch validation. It did not introduce semantic search, embeddings, pgvector, PostGIS, recommendation systems, a second search architecture, a second import pipeline, or auth/RLS redesign.

Approved baseline: `5b6a236` — `feat(search): Phase D full-text search architecture`.

Current branch during implementation: `recovery/phase-e-wip`.

## Pre-existing WIP discovered

Post-baseline WIP already existed on the branch before this implementation:

- SEO helpers and route metadata scaffolding.
- Dynamic sitemap and robots handling in `src/server.ts`.
- Leaflet and markercluster dependencies plus map components.
- Search autocomplete, did-you-mean, highlighting, alias table, search-vector, ranking, and telemetry migrations.
- Locale expansion to Turkish, Arabic, English, French, and Russian.
- Audit/handoff documentation files unrelated to runtime behavior.
- Empty `test_smart_mapping.ps1`.

Reusable WIP was preserved. Unsafe WIP was corrected where it was inside Phase E scope:

- Sitemap generation no longer creates a cartesian explosion of city/category combinations.
- `robots.txt` is generated dynamically instead of using a hardcoded static production host.
- Canonical/hreflang URL generation now uses configured absolute origins.
- JSON-LD now includes Organization, LocalBusiness, BreadcrumbList, and ItemList helpers.
- JSON-LD script serialization escapes script-breakout characters.
- Map popups no longer interpolate unsafe HTML.
- Duplicate migration timestamp prefix was resolved by renaming the WIP search-vector migration.

## Exact implementation order

1. Phase E.1 SEO Foundation.
2. Phase E.2 Public Directory UX.
3. Phase E.3 Search Experience.
4. Phase E.4 Public Maps.
5. Phase E.5 Launch Validation.

## Commit hashes

- E.1 SEO Foundation: `46616a6`
- E.2 Public Directory UX: `b3b3f16`
- E.3 Search Experience migration hygiene: `48f7724`
- E.3 Search Experience completion: `56a0902`
- E.4 Public Maps: `6e237a6`
- E.5 Launch Validation: recorded by the final validation commit.

## Files created

- `src/lib/seo/url.ts`
- `src/lib/seo/generated-content.functions.ts`
- `src/components/directory/DirectoryEmptyState.tsx`
- `src/components/directory/DirectoryPagination.tsx`
- `src/lib/business/__tests__/coordinates.test.ts`
- `src/lib/seo/__tests__/seo-foundation.test.ts`
- `supabase/migrations/20260726103000_phase_e_search_experience_additions.sql`
- `docs/phase-e-launch-experience-handoff.md`

## Files modified

- Public route metadata and JSON-LD:
  - `src/routes/$lang.index.tsx`
  - `src/routes/$lang.$slug.tsx`
  - `src/routes/$lang.$citySlug.$categorySlug.tsx`
  - `src/routes/$lang.$citySlug.$districtSlug.$categorySlug.tsx`
  - `src/routes/$lang.place.$slug.tsx`
- SEO infrastructure:
  - `src/lib/seo/hreflang.ts`
  - `src/lib/seo/jsonld.ts`
  - `src/lib/seo/sitemap.server.ts`
  - `src/server.ts`
- Directory/search UI:
  - `src/routes/$lang.search.tsx`
  - `src/components/search/FiltersPanel.tsx`
  - `src/components/search/AutocompleteDropdown.tsx`
  - `src/components/search/DidYouMean.tsx`
- Search internals:
  - `src/lib/search/autocomplete.server.ts`
  - `src/lib/search/did-you-mean.server.ts`
  - `src/lib/search/parseIntent.ts`
  - `src/lib/search/search-service.server.ts`
  - `src/lib/search/__tests__/parseIntent.test.ts`
- Maps:
  - `src/components/map/ClientMap.tsx`
  - `src/components/map/ClusterMap.tsx`
  - `src/components/map/MapToggle.tsx`

## Migrations created or changed

- Renamed WIP migration:
  - from `20260726100030_add_description_to_search_vector.sql`
  - to `20260726100040_add_description_to_search_vector.sql`
- Added:
  - `20260726103000_phase_e_search_experience_additions.sql`

The new migration is additive and idempotent. It expands search alias language support, seeds conservative multilingual aliases, adds an alias lookup index, and updates search-vector maintenance to include category labels and aliases while preserving name/slug weighting and Phase D ranking.

## Routes added or changed

No duplicate route families were added.

Changed public route behavior:

- `/$lang/`
- `/$lang/search`
- `/$lang/$slug`
- `/$lang/$citySlug/$categorySlug`
- `/$lang/$citySlug/$districtSlug/$categorySlug`
- `/$lang/place/$slug`
- `/sitemap.xml`
- `/sitemap-pages.xml`
- `/sitemap-categories.xml`
- `/sitemap-cities.xml`
- `/sitemap-directory-{n}.xml`
- `/sitemap-businesses-{n}.xml`
- `/robots.txt`

## Metadata behavior by route

- Homepage: localized title/description, canonical, hreflang, Open Graph, Twitter Card, Organization JSON-LD, WebSite JSON-LD.
- Search page: localized metadata with `noindex, follow`; canonical excludes unstable query combinations.
- Business page: localized business metadata, Phase C SEO fallback where current and successful, canonical, hreflang, Open Graph image, Twitter metadata, LocalBusiness JSON-LD, BreadcrumbList JSON-LD.
- Category/city/district listing pages: localized title/description, canonical, hreflang, Open Graph/Twitter metadata, BreadcrumbList, CollectionPage, and ItemList JSON-LD.

## Sitemap behavior

The sitemap is generated dynamically with absolute URLs. It includes locale homepages, active categories, active cities, valid city/category and city/district/category combinations derived from published businesses, and published business detail pages. It excludes admin, auth, owner/internal app routes, unpublished businesses, query-string search URLs, duplicate URLs, and malformed slugs. Large business and directory route sets are split into numbered sitemap files referenced by a sitemap index.

## Robots behavior

`robots.txt` is generated dynamically and references the configured production origin. It allows public pages and disallows admin, authenticated app, auth, owner, API, and internal technical routes. Static JS/CSS assets are not blocked.

## Structured data implementation

Structured data helpers cover:

- Organization
- WebSite
- LocalBusiness-derived business schema
- BreadcrumbList
- CollectionPage
- ItemList

JSON-LD is serialized with `safeJsonLdStringify()` to prevent script-breakout injection.

## Phase C content integration

Business detail pages read Phase C generated content through a server function that:

- Verifies the business is published.
- Computes the current source hash.
- Requires `generation_status = completed`.
- Requires the current prompt version.
- Requires the matching source hash and locale.
- Returns only renderable public content, not generation metadata.

No AI generation is triggered during page requests.

## Search changes

Phase D architecture was preserved:

- PostgreSQL `tsvector`
- GIN index
- Full-text first
- Trigram/ILIKE fallback only when full-text returns fewer than five results
- Browse path for empty query
- Database aliases with hardcoded fallback
- Blended `ranking_score`
- Non-blocking telemetry

Additive changes:

- Stable tie-breakers after selected sort: rating, review count, and stable ID.
- Search aliases expanded for TR/AR/EN/FR/RU.
- Search vector maintenance includes category labels and aliases at lower weight than name/slug.

## Autocomplete behavior

Autocomplete remains server-backed, debounced, capped, and failure-tolerant. It supports business, category, city, district, and alias suggestions. Business suggestions navigate to canonical business routes; other suggestion types submit an explicit search query.

## Did-you-mean behavior

Did-you-mean remains conservative and is only shown by the UI for low-result searches. It considers business/category/city/district/alias candidates, applies a confidence threshold, and never auto-replaces the user query.

## Map architecture

Maps use the existing Leaflet and `leaflet.markercluster` dependencies with OpenStreetMap tiles. No paid provider, API key, PostGIS, or new spatial architecture was introduced. Map/list mode is URL-backed. Only businesses with valid latitude/longitude are displayed. Marker popups use DOM text nodes and canonical localized business links. List content remains rendered below the map for SEO, accessibility, and no-JavaScript resilience.

## Test additions

Added or extended focused tests for:

- Canonical absolute URLs.
- hreflang alternatives.
- JSON-LD safe serialization.
- LocalBusiness aggregate rating and coordinate rules.
- ItemList visible-order mapping.
- French/Russian fallback aliases.
- Coordinate validation.

## Validation results

- `npm run typecheck`: passed.
- `npm run test`: passed, 19 files / 185 tests.
- `npm run build`: passed.

Build warnings:

- Existing TanStack Start `createServerFn().inputValidator()` deprecation warnings.
- Vite `vite-tsconfig-paths` notice.
- Plugin timing warning.
- `inlineDynamicImports` ignored warning.

## Lighthouse results

Not run in this local validation pass because no browser/Lighthouse runner was configured in the repository scripts. Production build bundle output was reviewed instead. Representative manual Lighthouse runs should be performed against a deployed preview before launch.

## Structured-data validation

Automated unit coverage confirms valid JSON serialization, LocalBusiness coordinate/rating conditions, and ItemList ordering. Full Rich Results validation should be run against deployed URLs after deployment because the validator needs reachable public pages and production data.

## Crawl validation

Code-level validation confirms:

- Sitemap and robots routes are handled by `src/server.ts`.
- Sitemap URLs are absolute.
- Admin/auth/owner routes are excluded.
- Search query URLs are excluded.
- Canonicals are absolute.
- hreflang includes all supported locales and x-default.
- Published-business filtering is enforced in sitemap generation.

Network crawl validation should be run against deployed preview URLs before launch.

## Accessibility findings

- Search autocomplete supports keyboard navigation, Escape close, listbox/option semantics, and screen-reader attributes.
- Filters and sort are URL-backed and keyboard-accessible through native/radix controls.
- Pagination has accessible navigation labels.
- Map/list controls expose pressed state.
- Breadcrumbs remain visible on public directory routes.

## Performance findings

- Sitemap generation pages published businesses and splits large sitemap groups.
- Directory combinations are derived from actual published businesses, avoiding low-value cartesian route explosion.
- Autocomplete and did-you-mean responses are capped.
- Maps are client-loaded lazily via `ClientClusterMap`.
- Leaflet bundle remains isolated to map usage.

## Security findings

- Public business and sitemap queries filter to `status = published`.
- JSON-LD script output escapes `<`, `>`, `&`, and line separator characters.
- Leaflet marker popup content uses DOM text assignment instead of raw HTML interpolation.
- Telemetry remains fire-and-forget and non-blocking.
- No auth/RLS policy changes were made.

## Known limitations

- Lighthouse and external structured-data validation require a reachable deployed or preview URL.
- Open-now remains disabled in public filter UI until timezone/reliability behavior is validated end-to-end.
- The generated Supabase types do not include `business_content_generation` / `search_aliases`; server helpers use narrow REST reads where typed client coverage is missing.
- Map uses page result coordinates only; it does not fetch all matching businesses across every page.
- Public map tiles rely on OpenStreetMap availability and acceptable usage.

## Rollback instructions

Rollback is standard git revert per Phase E commit:

1. Revert E.5 validation commit.
2. Revert `6e237a6`.
3. Revert `56a0902`.
4. Revert `48f7724`.
5. Revert `b3b3f16`.
6. Revert `46616a6`.

Database rollback for `20260726103000_phase_e_search_experience_additions.sql`:

1. Remove seeded alias rows if necessary.
2. Restore `maintain_search_vector()` and `rebuild_search_vectors()` definitions from `20260726100040_add_description_to_search_vector.sql`.
3. Re-run `public.rebuild_search_vectors()`.

No destructive SQL was executed during implementation.

## Recommended follow-up work

- Run Lighthouse against deployed preview URLs for homepage, search, business, category, and city pages.
- Run Google Rich Results / Schema validator against deployed representative pages.
- Regenerate Supabase types after applying Phase C/D/E migrations.
- Validate production crawl behavior with a crawler against the deployed host.
- Investigate the separate image pipeline `failJob()` ID observation outside Phase E.
- Revisit open-now filtering only after timezone and opening-hours reliability are proven.
