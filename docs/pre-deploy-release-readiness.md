# Pre-deploy Release Readiness

## Scope

This document records the final remediation and verification pass for Phase E on branch `recovery/phase-e-wip`. It covers confirmed audit findings and regression review across Phases A through E. It does not authorize merge or deployment.

## Audit findings fixed

- Critical: map popup XSS from imported business names.
- High: Phase C SEO source-hash mismatch between enrichment generation and public read path.
- High: descriptive search intent mismatch between server loader and client route.
- High: unbounded search-vector rebuild in deployment path.
- High: insert trigger missing category/alias terms.
- Medium: did-you-mean missing canonical `businesses.name`.
- Medium: sitemap directory-combination request cost.
- Medium: unused Phase E helper/import cleanup.
- Medium: localized pagination accessibility labels.
- Medium: map/list duplicate visible list behavior.
- Low: production origin no longer silently falls back to the Lovable preview host.

## Production migration runbook

1. Pre-deploy checks:
   - Confirm target database has not already applied the edited pre-merge Phase E migrations.
   - Confirm migration timestamp prefixes are unique.
   - Confirm backup/restore procedure exists.
   - Confirm canonical origin env var is set: `VITE_PUBLIC_SITE_URL`, `PUBLIC_SITE_URL`, `SITE_URL`, or `URL`.
2. Apply schema:
   - Apply migrations in timestamp order.
   - Do not run `public.rebuild_search_vectors()` during deploy.
3. Backfill search vectors in bounded batches:
   - Start: `select * from public.backfill_business_search_vectors_batch(null, 500);`
   - Continue with returned cursor: `select * from public.backfill_business_search_vectors_batch('<last_id>', 500);`
   - Repeat until `processed = 0`.
   - Maximum enforced batch size is 1000.
4. Monitor:
   - Batch duration.
   - Database lock waits.
   - CPU/load.
   - Public search latency and errors.
   - Count of published businesses with non-null `search_vector`.
5. Stop conditions:
   - Sustained lock waits.
   - Elevated public API/search error rate.
   - Batch duration outside the approved maintenance threshold.
6. Rollback/disable:
   - Stop batch execution.
   - Revert application commit if public runtime behavior regresses.
   - Disable only the new search-vector refresh triggers if they are proven to cause operational harm.
   - Restore prior vector functions only in a planned maintenance window.
7. Post-deploy verification:
   - Verify search still follows Phase D FTS-first/fallback behavior.
   - Verify newly inserted/updated businesses receive full search vectors.
   - Verify sitemap excludes unpublished/admin/auth/owner routes.
   - Verify canonicals/hreflang use the configured production host.

## Security review summary

Reviewed public-path XSS, unsafe HTML, JSON-LD serialization, URL construction, sitemap XML escaping, map popup content, service-role usage, public server functions, SQL/RPC usage, unpublished data exposure, and telemetry behavior. No new service-role exposure, RLS redesign, auth redesign, raw user-controlled SQL, or public unpublished-data path was introduced by the remediation.

Residual security risk: existing admin/import/image worker service-role paths remain high-privilege by design and should continue to be monitored separately from Phase E.

## Regression review summary

- Phase A: no auth, role, membership, RLS, review, favorite, report, or protected route architecture changes were made.
- Phase B: no import schema detection, mapping, place_id conflict, provenance, image reference, imported review/rating, or draft/publish behavior changes were made.
- Phase C: source-hash selection was aligned; generation keys, prompt versioning, stale detection, failed-record exclusion, and no-AI-on-public-page behavior were preserved.
- Phase D: FTS-first search, fallback threshold, browse mode, aliases, blended ranking, telemetry, filters, and stable ordering were preserved.
- Phase E: SEO, sitemap, robots, metadata, hreflang, JSON-LD, directory UX, pagination, autocomplete, did-you-mean, and map/list behavior were remediated without adding excluded architectures.

## Residual risks and manual checks

- Local `npm run preview` could not serve the built TanStack/Nitro output in this workspace because Vite preview looked for `dist/server/server.js` while the production build emitted `.output`. Browser/Lighthouse validation must therefore be run against a deployed preview before production.
- Rich Results validation must be run against reachable preview URLs with production-like data.
- Production origin env vars must be verified in the deployment environment.
- Search-vector backfill must be run incrementally and monitored.
- The separate image pipeline `failJob()` ID observation remains outside Phase E.

## Preview validation checklist

Run these checks against the deployed preview before production:

- `/<locale>` for English, Turkish, Arabic, and one of French/Russian.
- `/<locale>/search?q=fancy%20restaurant`, `/<locale>/search?q=cheap%20hotel%20in%20Istanbul`, and an Arabic search query.
- Representative category, city, district, and business detail pages.
- Search pagination, filter changes, sort changes, autocomplete, did-you-mean, and map/list mode.
- `/robots.txt`, `/sitemap.xml`, `/sitemap-pages.xml`, `/sitemap-categories.xml`, `/sitemap-cities.xml`, `/sitemap-directory-1.xml`, and `/sitemap-businesses-1.xml`.
- Browser console and hydration logs.
- Canonical, hreflang, Open Graph, Twitter, JSON-LD, and robots meta output.
- Keyboard access for autocomplete, filters, pagination, breadcrumbs, map/list toggle, and empty states.
