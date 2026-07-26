# Comprehensive Architectural Review

**Project:** turkiye-discover-hub (TanStack Start + Supabase)  
**Baseline commit:** `5b6a236` — Phase D Search Architecture  
**Date:** 2026-07-26  

---

## 1. Overall Project Maturity

| Dimension | Rating | Notes |
|---|---|---|
| Feature completeness | 7/10 | Core directory, search, import, enrichment, owner portal, admin panel all built. Missing: analytics, payment, chat, SEO tooling. |
| Code structure | 8/10 | Clean repository pattern, domain types, i18n abstraction, server functions with middleware. |
| Type safety | 7/10 | Strong domain types but heavy `as any` usage in admin layer and search service for Supabase-generated type gaps. |
| Test coverage | 5/10 | 177 tests across 17 files. Core search/import paths tested. No integration tests. No E2E tests. Admin panel untested. |
| Error handling | 6/10 | Server functions have try/catch. Client error page exists. But many edge cases (network failures, RLS conflicts) not explicitly handled. |
| Documentation | 4/10 | Only Phase D docs + 3 operation docs. No API docs, no runbook, no onboarding guide. README is auto-generated. |
| Monitoring | 3/10 | Search query log exists. Audit log exists. No structured logging, no metrics, no alerting. |
| Performance | 7/10 | Phase D search is fast. Image pipeline has pass-through (no re-encode). No load testing done. |
| Security | 7/10 | RLS on most tables. Server middleware validates admin/owner. Auth is Supabase-managed. Some admin RPCs are SECURITY DEFINER. |
| Deployment maturity | 5/10 | Cloudflare Workers SSR. No CI/CD pipeline visible. No staging environment. No automated deployment. |

**Overall:** Strong foundation with good architectural decisions. Production-ready for core functionality but needs hardening in testing, monitoring, documentation, and deployment automation before public launch.

---

## 2. Current Architecture by Subsystem

### 2.1 Frontend Architecture
- **Framework:** TanStack Start (SSR via Cloudflare Workers) + TanStack Router + TanStack Query
- **UI:** Tailwind CSS v4 + shadcn/ui (Radix primitives, 47 components)
- **i18n:** Custom context-based system with `tr` (default), `en` (fallback), `ar` (RTL). ~350 message keys. `fixMojibake` handles encoding issues.
- **Routing:** File-based routing with locale prefix (`/{lang}/...`). SSR preload enabled. Scroll restoration.

### 2.2 Backend Architecture
- **Runtime:** Cloudflare Workers (Edge SSR)
- **Auth:** Supabase Auth + Lovable auth bridge for OAuth (Google, Apple, Microsoft)
- **API:** TanStack Start server functions (RPC over HTTP). Supabase Data API for direct queries.
- **Middleware chain:** `attachSupabaseAuth` (token injection) → `errorMiddleware` (error page rendering) → route loader
- **Server functions:** ~40+ server functions across admin, owner, onboarding, review, translation, enrichment, and image subsystems

### 2.3 Data Layer
- **Database:** PostgreSQL (Supabase) with 47+ tables
- **Repository pattern:** Interfaces in `src/lib/repos/types.ts`, implementations in `supabase-repos.ts` (production) and `index.ts` (demo)
- **Domain types:** `src/types/domain.ts` (204 lines) — covers all entity types
- **Generated types:** `src/integrations/supabase/types.ts` (2921 lines) — Supabase schema types (has gaps for newer tables/columns)

### 2.4 Storage Layer
- **Image storage:** Cloudflare R2 with pass-through pipeline (no WASM re-encoding yet)
- **File uploads:** Supabase storage buckets (`imports`, `owner-uploads`, `business-verification-documents`, `business-onboarding-images`)
- **Image worker:** `/api/public/hooks/image-tick` — CRON-triggered job that downloads/normalizes/uploads images

### 2.5 Integration Layer
- **Supabase:** Database, Auth, Storage, RLS
- **Lovable AI:** AI content generation (descriptions, SEO metadata)
- **Lovable Auth:** OAuth provider bridge
- **Cloudflare R2:** Image hosting

---

## 3. Completed Phases (A–D)

### Phase A — Foundation
- User auth (email/password, OAuth), roles (admin/moderator/business_owner/user), profiles
- Location entities (countries, cities, districts) with translations
- Category system with translations and provider mappings
- Business CRUD with images, opening hours, services, attributes, translations
- Reviews with moderation, favorites, reports
- RLS policies, storage policies

### Phase B — Import Pipeline
- Google Places JSON import with schema detection (4 formats: array, places, results, data.results)
- Field mapping with alias resolution (camelCase → snake_case)
- Category mapping with approval workflow
- Multi-stage batch import (upload → detect → map → analyze → validate → preview → execute → translations → enrich → images → publish)
- Import provenance tracking, approval ledger, publication controls
- Smart field-name matching for any provider

### Phase C — AI Enrichment
- AI description generation using Lovable AI (tr/en/ar)
- SEO content generation (title, meta description)
- Hallucination detection (phone, email, URL, price, medical claims)
- Content generation tracking table (`business_content_generation`)
- Integration with import pipeline (enrichment stage)
- Translation pipeline with deduplication and status tracking

### Phase D — Search Architecture
- Full-text search via PostgreSQL tsvector + GIN (phase-out ILIKE)
- `simple_unaccent` text search config for accent-insensitive matching
- Sequential fusion: full-text → trigram ILIKE fallback when <5 results
- Database-backed `search_aliases` table with hardcoded fallback
- Blended `ranking_score` (Bayesian imported + platform review weighting)
- Search telemetry (`search_query_log`)
- Migrations are additive, idempotent, rollback-safe

---

## 4. Remaining Technical Debt

### P0 (Critical)
1. **No CI/CD pipeline** — Every deployment is manual. No automated testing gate.
2. **No staging environment** — All changes go directly to production.
3. **Generated Supabase types are stale** — `search_aliases`, `search_query_log`, `platform_avg_rating`, `platform_review_count`, `ranking_score`, `search_vector`, `business_content_generation` not in generated types. Code uses `as any` casts.
4. **Demo data still shipped** — `src/lib/repos/demo-data.ts` (767 lines) is bundled in production builds.

### P1 (High)
5. **Admin panel has zero tests** — All 20+ admin server functions and 15 admin routes are untested.
6. **Image pipeline pass-through** — WASM WebP encoding not implemented. EXIF orientation not corrected. Width/height not populated.
7. **Owner portal has minimal tests** — Only field-allowlists tested. All server functions untested.
8. **No query log TTL** — `search_query_log` grows unbounded.
9. **`description` not in search vector** — AI-generated descriptions from Phase C are not searchable.

### P2 (Medium)
10. **Hardcoded business counts** — `businessCount` fields in `demo-data.ts` and category/city list responses use static values.
11. **No subcategory expansion** — Searching "restaurants" doesn't match "kebapçı" or "balıkçı" subtypes.
12. **Translation pipeline is offline** — Depends on Lovable AI API key. No fallback provider.
13. **`src/lib/search/search.functions.ts` exports unused `searchPublishedBusinessesFn`** — Duplicate of `search-service.server.ts`.
14. **No mobile PWA support** — No service worker, no manifest, no offline support.
15. **Search results not cached** — Every unique search hits the database directly.
16. **No pagination cursor** — Offset-based pagination degrades beyond page 10.

---

## 5. Production Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Lovable AI API outage halts enrichment/translation | Medium | Medium | No fallback provider. No offline mode. |
| Supabase project reaches connection pool limit | Low | High | No connection pooling configured. Workers may exhaust pool during traffic spikes. |
| Image pipeline fails on unknown image formats | Low | Medium | Pass-through handles JPEG/PNG/WebP only. AVIF/GIF/BMP would fail `sniffImageType`. |
| R2 credentials misconfiguration | Low | High | Image worker checks `isConfigured()` but no alerting on failure. |
| SQL injection via admin search/input | Low | High | `requireAdmin` middleware + parameterized queries mitigate. But some raw query patterns exist. |
| Rate limiting on search endpoint | Medium | Low | No rate limiting. A malicious client could spam search queries. |
| SSR memory leak on large result sets | Low | Medium | No explicit limits on search result page size beyond `PUBLIC_SEARCH_MAX_PAGE_SIZE=48`. |
| Locale validation error causes infinite redirect | Low | Medium | `isLocale()` check redirects invalid locales to Turkish. Edge case with malformed locale strings. |

---

## 6. Performance Bottlenecks

### Database
1. **Business detail page joins 8+ tables** — `/place/{slug}` fetches business + city + district + category + category_links + images + hours + services + attributes + translations + reviews + similar businesses in one query. At 50k rows this is fine. At 500k it will need optimization.
2. **Admin business list uses `id.in.(...)`** — When category filtering matches many businesses, URL-length limits trigger a fallback to `primary_category_id.eq` only (losing linked-only businesses).
3. **Import batch item queries** — Heavy JSONB columns (`raw_payload`, `current_snapshot`, `proposed_diff`) on `import_batch_items` may cause table bloat.
4. **No COUNT(*) caching** — Every search query runs an exact count, even on page 1 where only 12 results are needed.

### Frontend
5. **No route-level code splitting optimization** — TanStack Start auto-splits, but some admin routes import heavy chart libraries (`recharts`) on the main bundle.
6. **Hero image is static JPEG** — No WebP/AVIF variant. No responsive image breakpoints.
7. **No lazy loading for admin panels** — All admin routes are loaded eagerly in the authenticated layout.

### Edge Runtime
8. **No KV cache for search dictionary** — Category/city/alias data is fetched from Postgres on every SSR request (5-min stale only within a user session). Could use Cloudflare KV for cross-user caching.

---

## 7. Security Observations

### Strengths
- RLS enabled on all 47 tables
- `requireAdmin` middleware on all admin server functions
- `requireSupabaseAuth` middleware for auth-dependent endpoints
- Auth is Supabase-managed (password hashing, session management, email verification)
- Audit logging via `record_audit` RPC
- Server function input validation with Zod schemas
- `SECURITY DEFINER` RPCs for sensitive operations (admin bootstrap, role management)
- Storage bucket policies restrict public access

### Weaknesses
1. **`as any` casts throughout admin layer** — Bypasses TypeScript safety. Relies entirely on RLS + `requireAdmin` middleware.
2. **Service role key imported dynamically** — `client.server.ts` imports `SUPABASE_SERVICE_ROLE_KEY`. If SSR fails to sanitize server-only imports, this could leak.
3. **No rate limiting** — Auth endpoints, search, and public API have no rate limiting.
4. **No CORS configuration visible** — If the API is accessed from other origins, CORS may not be restricted.
5. **`owner_authz()` and `business_member_authz()` use SECURITY DEFINER** — These functions run with elevated privileges. A bug could grant unauthorized access.
6. **`handle_new_user()` is a trigger on `auth.users`** — If this trigger fails, user signup is blocked entirely.
7. **No IP allowlisting** — Admin endpoints are accessible from any IP if the user has valid credentials.

---

## 8. SEO and Discoverability Readiness

### Ready
- Canonical URLs on all public pages
- Hreflang tags for tr/en/ar + x-default on all public pages
- Open Graph tags (title, description, image, type)
- Twitter Card tags
- `noindex, follow` on search results and auth pages
- JSON-LD structured data (Schema.org LocalBusiness) on business detail pages
- Semantic HTML structure
- Responsive design

### Missing
1. **No sitemap.xml** — Critical for search engine discovery of 50k+ business pages.
2. **No robots.txt** — Should explicitly allow crawling and point to sitemap.
3. **No breadcrumb structured data** — Category/city breadcrumb paths not marked up with Schema.org BreadcrumbList.
4. **No FAQ schema** — Clarification questions in search could be FAQ markup.
5. **No `hreflang` on business detail pages** — Place page route has canonical URL but hreflang tags are not verified to work correctly for business content that may not exist in all languages.
6. **No SEO title/meta description stored** — Phase C generates SEO content but it's stored in `business_content_generation` and never rendered in page `<head>`. The page uses a generic fallback.
7. **No `lastmod` in sitemap** — Business update timestamps not exposed for crawl optimization.
8. **No image alt text generation** — Images lack descriptive alt text (business name is used but doesn't describe the image).
9. **No performance metrics exposed** — No Core Web Vitals monitoring.

---

## 9. Database Health and Scalability

### Current State
- 47 tables, 40+ indexes, 20+ RPCs
- Largest tables: `businesses` (~50k), `business_images` (~250k), `reviews` (~150k est.), `import_batch_items` (variable)
- All migrations are additive and idempotent
- No materialized views
- No partitioning

### Concerns
1. **`import_batch_items.raw_payload` is JSONB** — No size limit. A single import with 10k items × 50KB payloads = 500MB of JSONB data.
2. **`audit_logs` has no retention** — No TTL or archival. Grows with every admin action.
3. **`search_query_log` has no retention** — No TTL. Grows with every search.
4. **No connection pooling configuration** — Supabase's built-in PgBouncer may not be configured for this project.
5. **`business_category_links` is a junction table with UUID primary key** — No surrogate key, which is fine, but composite FK indexes may be suboptimal at scale.
6. **No table partitioning** — `business_images` and `reviews` could benefit from partitioning by `created_at` or `business_id` at scale.

### Scalability Limits
| Threshold | Limiting Factor | Mitigation |
|---|---|---|
| 100k businesses | Search query performance | Phase D full-text scaling is sub-linear |
| 1M images | Storage pipeline throughput | Worker processes 5 images per tick; needs parallelism |
| 10k daily searches | Query log table size | Add TTL or archive to separate table |
| 100 concurrent users | Cloudflare Workers free tier | Upgrade to paid plan with 1M requests/month |
| 500 concurrent users | Supabase connection pool | Add PgBouncer configuration or serverless pool |

---

## 10. Search Architecture Summary

### Current Implementation
- **Primary:** Full-text search via `businesses.search_vector` (tsvector with GIN index) using `public.simple_unaccent` config
- **Fallback:** Trigram ILIKE on `name`, `formatted_address`, `slug` when full-text returns <5 results
- **Browse mode:** No text query, structured filters only (city, district, category, rating, priceLevel)
- **Sort:** `ranking_score` (blended Bayesian) for "recommended", `rating`/`review_count`/`created_at`/`name` for other sorts
- **Aliases:** `search_aliases` table with hardcoded `CATEGORY_ALIASES` fallback
- **Telemetry:** `search_query_log` table (fire-and-forget INSERT)
- **Intent parsing:** Client-side `parseDirectorySearchIntent` with category/city/district/price/rating/audience detection
- **Query logging:** `method`, `result_count`, `duration_ms`, `top_result_ids` logged per search

### Vector Composition
```
search_vector = setweight(A, name) || setweight(A, slug)
```
Only name and slug are indexed. Description, translations, and category/city names are NOT in the vector.

### Limitations
1. `description` not searchable (Phase D.1)
2. `business_translations.name` not searchable (Phase D.1)
3. No subcategory expansion
4. No stemmed search (Turkish `restoran` ≠ `restoranlar`)
5. No RRF hybrid retrieval
6. No result explainability for admin

---

## 11. Import Pipeline Summary

### Architecture
```
Upload JSON → Schema Detection → Field Mapping → Analyze → Entity Mapping →
Validation → Preview → Execute → Translations → Enrich → Images → Publish
```

### Key Components
- **`format.ts`:** Detects 4 JSON import formats (array, places, results, data.results). Unwraps camelCase aliases.
- **`normalize.ts`:** Pure normalizers for Google Places data → domain rows. No I/O. Handles opening hours, images, reviews, categories, contact info.
- **`schema-detector.ts`:** Examines import payload and detects available fields.
- **`preview.ts`:** Computes diffs between imported data and existing business records.
- **Import batches:** Full lifecycle tracking with `import_batches`, `import_batch_items`, `import_approvals`, `business_import_provenance`.
- **State machine:** Multi-stage workflow with stage-locking. Admin progresses through stages manually.
- **Category mapping:** Semi-automated with admin approval. `category_mappings` table maps source categories to system categories.

### Supported Formats
- Google Maps JSON Export (flat array)
- Google Places API results (nested)
- Custom JSON with smart field-name matching (camelCase, Turkish, Arabic field names)

### Limitations
1. No CSV/TSV import support
2. No scheduled/automated imports (all manual via admin UI)
3. No incremental sync (re-import checks place_id but doesn't detect deletions)
4. No import rollback (publication is one-way; changes must be reverted manually)

---

## 12. AI Enrichment Pipeline Summary

### Architecture
```
Import Stage → Translation Queue → Lovable AI → Validation → Storage
```

### Components
- **`generator.server.ts`:** Two generators — `generateAIDescription` (50-100 word travel description) and `generateSeoContent` (SEO title + meta description)
- **`lovable-provider.server.ts`:** Lovable AI translation API integration. Translates text between tr/en/ar.
- **`hallucination detection`:** 14 regex patterns block phone numbers, emails, URLs, prices, medical claims, awards, rankings
- **`generation-key.ts`:** Version-tracked content generation keys for cache invalidation
- **`business_content_generation` table:** Tracks generated content with status, version, and business FK

### Limitations
1. Single AI provider (Lovable) — no fallback if API is down
2. No human review workflow — AI content goes straight to storage
3. SEO content generated but never rendered in page `<head>`
4. No content refresh policy — AI-generated content is never regenerated unless manually triggered
5. Hallucination detection is regex-based and has false positives (e.g., "award-winning" in a legitimate travel description)

---

## 13. Public Directory Readiness

### Ready
- Homepage with hero, category shortcuts, city tiles
- Category listing pages with business cards
- City landing pages with search and business grid
- City + District + Category deep-linking pages
- Business detail pages with gallery, reviews, opening hours, services, location
- Map placeholder on business detail (no actual map)
- Multilingual (tr/en/ar) with RTL support
- Responsive design (mobile-first Tailwind)
- Structured data (JSON-LD LocalBusiness)
- Social sharing (OG tags, Twitter cards)

### Not Ready
1. **No actual map integration** — Business detail page has a map placeholder but no Google Maps or Mapbox embed.
2. **No "claim this business" flow from public page** — Button exists but links to auth. No seamless public-to-owner conversion.
3. **No business filtering in browse mode** — No price/rating/featured filters on category/city listing pages.
4. **No infinite scroll or "load more"** — Pagination is traditional page numbers.
5. **No "nearby" or "similar" on detail page without explicit links** — The `getSimilar` method uses category matching, not proximity.
6. **No image lazy loading optimization** — `BusinessImage` component exists but images are loaded eagerly on gallery dialogs.
7. **No offline fallback** — No service worker. Search results disappear without network.

---

## 14. Admin Panel Readiness

### Ready
- Dashboard with entity counts
- Business list with search, filter, sort, inline status/featured/verified changes
- Business editor (name, slug, address, phone, website, description)
- User management with role grant/revoke
- Review moderation (approve/reject/hide)
- Report management
- Ownership claim approval/rejection
- Category mapping management with batch operations
- Import pipeline with full 12-stage workflow
- Translation pipeline status and job management
- Image pipeline monitoring (records + jobs)
- Change request review with field-by-field approval
- Onboarding submission review with document verification
- Owner reply moderation
- Audit log viewer
- Site settings (boolean toggles)

### Not Ready
1. **No category/city CRUD** — Categories and cities are read-only in admin panel.
2. **No bulk business operations** — No bulk publish/unpublish, bulk category assignment, bulk deletion.
3. **No analytics dashboards** — No charts, no search analytics, no user growth metrics.
4. **No notification management** — Admin cannot send notifications to users.
5. **No export functionality** — No CSV/JSON export of businesses, users, reviews.
6. **No admin activity log** — Audit logs exist but are read-only. No summary/aggregation.
7. **No SEO preview** — Cannot preview how a business appears in search results.
8. **No cache invalidation** — No button to clear caches (search dictionary, categories).

---

## 15. Missing Features Required Before Public Launch

### P0 — Blocking
1. **Sitemap.xml generation** — Required for search engine discovery. Must include all published business pages, category pages, city pages, and district pages.
2. **Robots.txt** — Must explicitly allow crawling and reference sitemap.
3. **SEO metadata rendering** — Phase C generates SEO titles and descriptions but they are not rendered in page `<head>`. Every public page should use these if available.
4. **Error monitoring** — No Sentry/Error tracking configured. Production errors are invisible.
5. **Performance monitoring** — No Core Web Vitals tracking. Cannot measure search p99 latency.

### P1 — High Priority
6. **CI/CD pipeline** — Automated testing gate + deployment to staging + production promotion.
7. **Staging environment** — Isolated Supabase project + Cloudflare Workers deployment.
8. **Map integration** — Google Maps or Mapbox embed on business detail page.
9. **Business filtering on category/city pages** — Price level, rating, sort options on listing pages.
10. **Rate limiting** — At minimum on search endpoint and auth endpoints.

### P2 — Medium Priority
11. **Load testing** — At minimum verify search p95 < 200ms under expected traffic.
12. **Image re-encoding pipeline** — WASM WebP encoder + EXIF orientation correction.
13. **Subscription/analytics monitoring** — At minimum Supabase dashboard configured with alerts.
14. **BusinessCount materialized view** — Replace hardcoded static counts.

---

## 16. Recommended Roadmap with Priorities

### P0 — Before Launch (Critical)
| Item | Effort | Rationale |
|---|---|---|
| Sitemap.xml + robots.txt | 1 day | SEO requirement. Without this, Google cannot discover 50k+ business pages. |
| SEO metadata in page head | 1 day | Phase C already generates this. Just need to render it. |
| Error monitoring (Sentry) | 1 day | Blind in production without this. |
| CI/CD pipeline | 3 days | Every deployment is a risk without automated testing. |
| Staging environment | 2 days | Cannot test migrations or code changes safely. |
| Regenerate Supabase types | 1 day | Eliminate `as any` casts for Phase D columns. |

### P1 — High Priority (Next Phase)
| Item | Effort | Phase |
|---|---|---|
| Add description + translations to search vector | 2 days | D.1 |
| Map integration | 2 days | Post-D |
| Listing page filters (price, rating, sort) | 3 days | Post-D |
| Rate limiting | 1 day | Infrastructure |
| Load testing | 2 days | QA |
| Image WASM encoder | 3 days | Infrastructure |
| Admin CRUD for categories/cities | 3 days | Admin |

### P2 — Medium Priority
| Item | Effort | Phase |
|---|---|---|
| Search query log TTL + cleanup | 1 day | D.2 |
| BusinessCount view | 1 day | D.2 |
| Admin analytics dashboard | 5 days | Admin |
| PWA support (manifest, service worker) | 2 days | UX |
| Cursor-based pagination | 2 days | D.2 |
| Cache search dictionary in KV | 1 day | Performance |
| Import rollback support | 3 days | Import |

### P3 — Nice to Have
| Item | Effort |
|---|---|
| CSV/TSV import | 3 days |
| Subcategory expansion (recursive CTE) | 2 days |
| AI content refresh policy | 2 days |
| Bulk admin operations | 3 days |
| Admin notification composer | 2 days |
| Nearby search (PostGIS) | 5 days (Phase E) |

---

## 17. Features That Should NOT Be Implemented Yet

1. **ML-based reranking (Phase E)** — Not enough platform review data. Ranking score baseline needs months of data first.
2. **PostGIS proximity search** — City/district filtering is sufficient. Business density doesn't justify spatial indexes.
3. **Per-language search vectors** — Query logs show no evidence that Turkish stemming is needed. Add only if fallback rate >10%.
4. **RRF hybrid retrieval** — Sequential fusion fallback rate must be monitored first. Add RRF only if persistently >10% fallback.
5. **Business embedding vectors** — Requires embedding infrastructure (pgvector, embedding API). Not justified at current scale.
6. **Payment/booking integration** — Extends scope beyond a directory. Requires PCI compliance, payment provider contracts.
7. **User reviews on platform** — Currently exists but has zero adoption. Building features for an empty system is wasted effort until businesses are claimed.
8. **Mobile native app** — PWA covers mobile needs. Native app is premature without proven mobile traffic.
9. **Multi-region deployment** — Cloudflare Workers are edge-deployed. Database is the bottleneck, not compute location.
10. **Real-time features** — WebSockets/realtime subscriptions add complexity. Polling with TanStack Query's `refetchInterval` is sufficient.

---

## 18. Suggested Architecture for the Next Phase (High Level)

### Proposed: Launch Readiness Phase (Post-D)

**Theme:** Close the gap between "working software" and "production-ready public launch"

### Scope
| Area | What to build | Success criteria |
|---|---|---|
| **SEO** | Sitemap.xml generation, robots.txt, SEO metadata rendering | All 50k+ business pages discoverable by Google |
| **Monitoring** | Sentry error tracking + performance monitoring | Zero blind deployments |
| **Infrastructure** | CI/CD (GitHub Actions) + staging Supabase + Cloudflare preview deploys | Automated testing gate before production |
| **Search quality** | Add description + translations to search vector, monitor fallback rate | <10% fallback rate, <200ms p95 |
| **Admin** | Category/city CRUD, business bulk operations | Admin can manage all entities without SQL |
| **UX** | Map on detail page, listing page filters | Feature parity with competing directories |
| **Testing** | Integration tests for search + import + admin | >200 tests, >60% code coverage |

### What is explicitly NOT in scope
- Phase E features (embeddings, ML reranking, PostGIS)
- Payment/booking
- Mobile native app
- Real-time features
- Multi-region

### Architecture recommendations
1. **Sitemap:** Server function that queries all published businesses with `updated_at` and generates XML. Cache with Cloudflare KV (1-hour TTL). Update on business publish/unpublish via webhook or trigger.
2. **CI/CD:** GitHub Actions with `npm test`, `npm run typecheck`, `npm run build` on PR. Deploy to staging on merge to `develop`. Deploy to production on merge to `main`.
3. **Search vector expansion:** Add `business_translations.name` (B-weight) and `description` (C-weight) to the existing trigger function. Backfill via the existing `rebuild_search_vectors()` function. No new columns needed.
4. **Map integration:** Conditionally render Google Maps iframe or Mapbox embed when latitude/longitude is present. Use static map image for SSR, interactive map client-side.
5. **Admin CRUD:** Follow the existing pattern in `domain.functions.ts` — list with pagination, create/update via server functions with input validation, delete with confirmation. Reuse category/city translation patterns from import pipeline.

### Risk mitigation
| Risk | Mitigation |
|---|---|
| Sitemap generation impacts database | Generate in batches (1000 businesses per query). Cache aggressively. |
| Google Maps API costs | Use static maps for SSR, interactive only on user interaction. Set daily budget alerts. |
| CI/CD breaks existing deploys | Start with `on: pull_request` only. Add auto-deploy after 1 week of stability. |
| Search vector expansion increases write latency | Monitor trigger execution time. If >5ms, batch updates instead of per-row trigger. |
