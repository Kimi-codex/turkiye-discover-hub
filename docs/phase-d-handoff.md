# Phase D — Search Architecture Handoff

**Status:** ✅ Complete  
**Commit:** `7a8282f` (Phase C) + uncommitted Phase D changes  
**Architecture doc:** `docs/phase-d-search-architecture.md` (Revision 2 — approved)

---

## 1. What Was Implemented

Replaced ILIKE-based search with indexed full-text search using PostgreSQL `tsvector` + GIN, with sequential fusion fallback (full-text → trigram), database-backed search aliases, blended ranking score, and search telemetry.

### Scope
- Full-text search via `tsvector` on `businesses.name` and `businesses.slug` (A-weight)
- Custom `simple_unaccent` text search configuration (accent-insensitive, no stemming)
- Sequential fusion: full-text first, trigram ILIKE fallback if <5 results
- Database `search_aliases` table seeded from translations + hardcoded aliases
- Blended `ranking_score` using imported Bayesian with gradual platform review transition
- `search_query_log` table for telemetry
- New trigger-based maintenance for vectors and ranking scores
- All existing filters (city, district, category, rating, priceLevel) preserved

### Not in scope
- No `business_translations.name` in search vector (deferred to D.1)
- No `description` in search vector (deferred to D.1)
- No per-language vectors (deferred to D.2)
- No PostGIS/proximity search (deferred to Phase E)
- No ML reranking (deferred to Phase E)
- No RRF hybrid retrieval (deferred to D.1)
- No admin alias UI (deferred to D.2)
- No materialized views for category counts (deferred to D.2)

---

## 2. Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Search vector column | Single `search_vector` column | Simpler triggers, one GIN index, easy debugging. Stemming differences rarely matter for directory search. |
| Text search config | `public.simple_unaccent` (unaccent + simple) | Accent-insensitive, language-agnostic, no stemming surprises. |
| Retrieval strategy | Sequential fusion | Simpler than RRF. Trigram fallback only activates when full-text returns <5 results. |
| Ranking blend | Bayesian with gradual transition (`alpha = min(1.0, platform_review_count / 10)`) | At launch, imported data is the only signal. Platform reviews gain weight gradually. |
| Alias storage | `search_aliases` table with hardcoded fallback | Admin-editable without code changes. Code always has a fallback path. |
| Telemetry | Fire-and-forget INSERT to `search_query_log` | Silent catch on failure — never blocks the search response. |
| Caching | Category/city list + aliases at 5-min TTL | Intent parser data is stable; 5 minutes is safe. Search results are not cached (every query is unique). |
| Pagination | Offset-based (`page`/`pageSize`) | Fine for top-200 results. Cursor-based is deferred. |

---

## 3. Database Changes

### New columns on `public.businesses`
| Column | Type | Purpose |
|---|---|---|
| `search_vector` | `tsvector` | Full-text search vector with GIN index |
| `platform_avg_rating` | `numeric(2,1)` | Average platform review rating, recomputed by trigger |
| `platform_review_count` | `integer DEFAULT 0` | Count of platform reviews, recomputed by trigger |
| `ranking_score` | `numeric(4,3)` | Blended Bayesian ranking score, recomputed by trigger |

### New tables
| Table | Purpose |
|---|---|
| `public.search_aliases` | Multilingual aliases for category/city/district lookup |
| `public.search_query_log` | Search telemetry (query, method, duration, result count) |

### New indexes
| Index | Type | Purpose |
|---|---|---|
| `businesses_search_vector_idx` | GIN on `search_vector` | Full-text search |
| `businesses_published_ranking_score_idx` | B-tree `(ranking_score DESC NULLS LAST) WHERE status = 'published'` | Recommended sort |
| `uq_search_aliases` | Unique on `(entity_type, entity_id, alias)` | Alias deduplication |
| `search_aliases_lookup_idx` | `(alias text_pattern_ops, entity_type)` | Fast alias→entity lookup |
| `search_query_log_created_idx` | B-tree `(created_at DESC)` | Query log analytics |

### Functions
| Function | Type | Purpose |
|---|---|---|
| `rebuild_search_vectors()` | SQL | Backfill `search_vector` for all published businesses |
| `maintain_search_vector()` | PL/pgSQL trigger | Maintain `search_vector` on INSERT/UPDATE of name/slug |
| `rebuild_ranking_scores()` | PL/pgSQL | Backfill `platform_avg_rating`, `platform_review_count`, `ranking_score` |
| `maintain_business_ranking()` | PL/pgSQL trigger | Recompute ranking on review INSERT/UPDATE/DELETE |

### Triggers
| Trigger | Event | Function |
|---|---|---|
| `trg_businesses_search_vector` | `BEFORE INSERT OR UPDATE OF name, slug` on `businesses` | `maintain_search_vector()` |
| `trg_reviews_business_ranking` | `AFTER INSERT OR UPDATE OR DELETE` on `reviews` | `maintain_business_ranking()` |

### Idempotency
All 4 migrations are idempotent. Every CREATE uses `IF NOT EXISTS` or `OR REPLACE`. Triggers are preceded by `DROP TRIGGER IF EXISTS`. INSERTs use `ON CONFLICT DO NOTHING`.

---

## 4. Migrations

| Migration | File | What it does |
|---|---|---|
| 1 | `20260726100000_enable_search_extensions.sql` | Enables `pg_trgm` and `unaccent` extensions. Creates `public.simple_unaccent` text search config. |
| 2 | `20260726100010_add_search_aliases.sql` | Creates `search_aliases` table with unique and lookup indexes. Seeds from category/city translations and hardcoded aliases. GRANTs SELECT to anon/authenticated. |
| 3 | `20260726100020_add_search_vector_and_ranking.sql` | Adds `search_vector`, `platform_avg_rating`, `platform_review_count`, `ranking_score` columns. Creates GIN and B-tree indexes. Creates backfill functions and maintenance triggers. |
| 4 | `20260726100030_add_search_query_log.sql` | Creates `search_query_log` table with index. GRANTs INSERT to anon/authenticated. |

### Migration order
1 → 2 → 3 → 4

---

## 5. Search Flow

```
User Query (e.g. "istanbul otel")
    │
    ├─ 1. Route loads SearchDictionary (categories, cities, aliases, 5-min cache)
    │      Falls back silently if search_aliases table does not exist
    │
    ├─ 2. parseDirectorySearchIntent(query, locale, dict)
    │      Matches category via aliases (DB → hardcoded fallback)
    │      Matches city via name/slug
    │      Matches district via name/slug (scoped to matched city)
    │      Extracts price level, rating intent, audience intent
    │      Returns structured intent + remaining query
    │
    ├─ 3. toFilters() merges URL params with intent (URL wins)
    │      If descriptiveIntent=true, remaining query is discarded
    │
    ├─ 4. searchPublishedBusinesses(filters)
    │      │
    │      ├─ Has query? → executeFullTextSearch()
    │      │     .textSearch("search_vector", query, { config: "public.simple_unaccent" })
    │      │     + structured filters (city, district, category, rating, priceLevel)
    │      │     + ORDER BY sortColumn (ranking_score for recommended)
    │      │     + pagination (range-based)
    │      │     │
    │      │     └─ < 5 results? → executeTrigramSearch()
    │      │           .or("name.ilike.%query%,formatted_address.ilike.%query%,slug.ilike.%query%")
    │      │           + same structured filters + sort + pagination
    │      │
    │      └─ No query? → executeBrowseSearch()
    │            Same as trigram search but without text filter
    │            (identical to old browse behavior)
    │
    └─ 5. logSearchQuery() — fire-and-forget, silent on failure
```

### Query logging
Every search logs: query text, result count, top 10 result IDs, duration in ms, method (fulltext/trigram_fallback/browse), and locale. Written to `search_query_log` via fire-and-forget INSERT with silent catch.

---

## 6. Ranking Strategy

### Formula
```
imported_bayesian = (rating * review_count + 10.5) / (review_count + 3.0)
platform_bayesian = (platform_avg_rating * platform_review_count + 10.5)
                  / (platform_review_count + 3.0)

alpha = LEAST(1.0, platform_review_count / 10.0)

ranking_score = imported_bayesian * (1.0 - alpha) + platform_bayesian * alpha
```

### Behavior at different coverage levels
| platform_review_count | alpha | Effect |
|---|---|---|
| 0 | 0.0 | 100% imported (Bayesian-smoothed) |
| 3 | 0.3 | 70% imported, 30% platform |
| 7 | 0.7 | 30% imported, 70% platform |
| 10+ | 1.0 | 100% platform |

### Sort column mapping
| Sort option | Database column | Direction |
|---|---|---|
| `recommended` (default) | `ranking_score` | DESC |
| `highest_rated` | `rating` (imported) | DESC |
| `most_reviewed` | `review_count` (imported) | DESC |
| `recently_added` | `created_at` | DESC |
| `name` | `name` | ASC |

### Imported data preserved
The `rating` and `review_count` columns (imported Google data) are never modified. Only `platform_avg_rating`, `platform_review_count`, and `ranking_score` are written by triggers.

### Prior constants
- Prior mean: 3.5
- Prior weight: 3 (Bayesian smoothing)
- Transition threshold: 10 (platform reviews for full transition)

---

## 7. Alias System

### Architecture
- `SearchDictionary.categoryAliases?: Record<string, string[]>` — loaded from `search_aliases` table
- `findMatch()` merges passed-in aliases with hardcoded `CATEGORY_ALIASES`
- Route loads aliases in `searchDictQuery()` with 5-min staleTime
- If `search_aliases` table or query fails, `categoryAliases` remains empty → hardcoded aliases handle matching

### Seed data
Two sources in Migration 2:
1. All category and city translations (from `category_translations`, `city_translations`) — covers tr/en/ar names
2. Hardcoded aliases matching the existing `CATEGORY_ALIASES` in `parseIntent.ts` — hotels, clinics, restaurants, cafes in tr/en/ar

### How aliases are checked
```
findMatch(haystack, items, locale, categoryAliases):
  for each item:
    labels = {slug_with_hyphens}
    labels += categoryAliases[item.slug] || []
    labels += CATEGORY_ALIASES[item.slug] || []
    labels += item.name[tr], item.name[en], item.name[ar]
    labels += pickLocalized(item.name, locale)
    match earliest + longest label
```

---

## 8. Trigger Behavior

### search_vector trigger
- **Event:** `BEFORE INSERT OR UPDATE OF name, slug ON businesses`
- **Action:** Recomputes `search_vector` from `name` (A-weight) and `slug` (A-weight) using `simple_unaccent` config
- **Note:** Works correctly on INSERT (NEW populated) and UPDATE of name/slug

### ranking_score trigger
- **Event:** `AFTER INSERT OR UPDATE OR DELETE ON reviews`
- **Action:**
  1. Reads target business ID from `COALESCE(NEW.business_id, OLD.business_id)`
  2. Recomputes `platform_avg_rating` and `platform_review_count` from `reviews WHERE source='platform' AND status='published'`
  3. Recomputes `ranking_score` using the blended Bayesian formula
- **Covers all three cases:**
  - `INSERT`: `NEW.business_id` is populated
  - `UPDATE`: `NEW.business_id` is populated (rating change on a review)
  - `DELETE`: `OLD.business_id` is populated
- **Note:** Function uses `COALESCE(NEW, OLD)` as return value to handle DELETE case correctly

---

## 9. Files Changed

### New files (4 migrations)
- `supabase/migrations/20260726100000_enable_search_extensions.sql`
- `supabase/migrations/20260726100010_add_search_aliases.sql`
- `supabase/migrations/20260726100020_add_search_vector_and_ranking.sql`
- `supabase/migrations/20260726100030_add_search_query_log.sql`

### New test files
- `src/lib/search/__tests__/search-filters.test.ts` — 10 tests (sort column mappings, filter normalization)

### Modified source files
- `src/lib/search/parseIntent.ts` — Added `SearchAlias` interface, `SearchDictionary.categoryAliases`, `findMatch()` accepts `additionalAliases`
- `src/lib/search/search-filters.ts` — `sortColumn('recommended')` → `ranking_score` DESC
- `src/lib/search/search-service.server.ts` — Rewritten with 3 execution paths (full-text, trigram fallback, browse), sequential fusion, query logging
- `src/routes/$lang.search.tsx` — Loads `search_aliases` into `categoryAliases` map

### Modified test files
- `src/lib/search/__tests__/parseIntent.test.ts` — +5 alias-lookup tests

---

## 10. Known Limitations

1. **`simple_unaccent` has no stemming** — Turkish `restoran` matches `restoran` but not `restoranlar` as a search term. This is acceptable for v1; per-language vectors can be added later.
2. **`description` not in search vector** — Phase C enriched descriptions are not searchable. Deferred to D.1.
3. **`business_translations.name` not in search vector** — Translated business names cannot be matched via full-text. Deferred to D.1.
4. **No subcategory expansion** — Searching for "restaurants" does not match "kebapçı" or "balıkçı" subtypes. Deferred to future phase.
5. **No result explainability** — Admins cannot see why a result ranked where it did. Deferred to D.1.
6. **Trigram fallback on `formatted_address`** — The trigram path still searches `formatted_address` (as the old ILIKE did). Address data is not in the `search_vector`. If address search matters, adding it to the vector is straightforward.
7. **No query log TTL** — `search_query_log` grows unbounded. Add a cleanup job in D.2.
8. **Uncommitted unrelated changes** — 6 files outside Phase D scope have pre-existing uncommitted changes: BusinessGallery.tsx, BusinessImage.tsx, OpeningHours.tsx, RatingStars.tsx, i18n/messages.ts, `$lang.place.$slug.tsx`.

---

## 11. Rollback Procedure

### Quick rollback (revert code only)
```bash
git checkout HEAD -- src/lib/search/search-service.server.ts
git checkout HEAD -- src/lib/search/parseIntent.ts
git checkout HEAD -- src/lib/search/search-filters.ts
git checkout HEAD -- src/routes/\$lang.search.tsx
```
Search behavior returns to pre-Phase-D state. Database changes remain but are unused.

### Full rollback
1. Revert code changes (as above)
2. Drop triggers:
   ```sql
   DROP TRIGGER IF EXISTS trg_reviews_business_ranking ON public.reviews;
   DROP TRIGGER IF EXISTS trg_businesses_search_vector ON public.businesses;
   ```
3. Drop tables (optional):
   ```sql
   DROP TABLE IF EXISTS public.search_query_log CASCADE;
   DROP TABLE IF EXISTS public.search_aliases CASCADE;
   ```
4. Remove columns (optional):
   ```sql
   ALTER TABLE public.businesses DROP COLUMN IF EXISTS search_vector;
   ALTER TABLE public.businesses DROP COLUMN IF EXISTS ranking_score;
   ALTER TABLE public.businesses DROP COLUMN IF EXISTS platform_avg_rating;
   ALTER TABLE public.businesses DROP COLUMN IF EXISTS platform_review_count;
   ```
5. Extensions and text search config can remain (other code may depend on unaccent/pg_trgm).

**Data loss:** Only query logs are lost. Business data is never modified.

---

## 12. Test Results

| Check | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | ✅ Pass (0 errors) |
| Unit tests (`vitest`) | ✅ 177 tests pass (17 files, +14 from baseline) |
| Production build (`npm run build`) | ✅ Pass (pre-existing deprecation warnings only) |

---

## 13. Future Roadmap

### Phase D.1 (next sprint)
- Add `business_translations.name` to search_vector (B-weight)
- Add `description` to search_vector (C-weight)
- Add category/city translation names to search_vector (D-weight)
- RRF hybrid retrieval if fallback rate >10%
- Result explainability debug mode (admin only)

### Phase D.2 (later sprint)
- Materialized view for category business counts
- Admin UI for alias management
- Per-language search vectors
- Search query log retention / auto-cleanup
- Cursor-based pagination

### Phase E (separate phase)
- Business embedding vectors for semantic search
- ML-based reranking
- PostGIS proximity search
