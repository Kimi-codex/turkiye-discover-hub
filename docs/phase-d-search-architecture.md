# Phase D — Search Architecture Plan (Revision 2)

**Status:** Draft for review  
**Phase dependency:** Phase C (enrichment) is committed  
**Scope:** Replace ILIKE-based search with fast, indexed, multilingual full-text search. No auth, import, admin pipeline, or onboarding changes.

---

## 1. Search Goals

The target search must handle three user scenarios on a multilingual (tr/en/ar) Turkish business directory:

| Scenario | Example | Expected Behaviour |
|---|---|---|
| **Navigational** | "Karaköy Balıkçısı" | Exact match → business detail page |
| **Exploratory** | "İstanbul'da restoran" | Structured: category=restaurants, city=istanbul → listing |
| **Vague** | "diş kliniği Antalya" | Intent parse → category=clinics, city=antalya |

**Primary goals:**

1. **Intent-aware retrieval** — Preserve the existing `parseIntent` layer; replace the ILIKE fallback with indexed full-text search
2. **Multilingual by default** — A Turkish query matches Turkish content, an English or Arabic query matches across all languages from a single query
3. **Sub-200ms p95** — Current ILIKE with `%query%` is O(n) full-scan; replace with `tsvector` + GIN
4. **Graceful degradation** — Every search path has a fallback; the system never returns an error when data exists
5. **One retrieval strategy for v1** — Sequential fusion: full-text first, trigram ILIKE fallback. No parallel hybrids, no RRF.

---

## 2. Current Searchable Data

### Database tables used in search:

| Table | Columns searched | Current method |
|---|---|---|
| `businesses` | `name`, `formatted_address`, `slug` | ILIKE `%query%` |
| `business_translations` | `name` (per locale) | Not searched |
| `categories` | `slug` (via alias matching only) | ILIKE on slug fallback |
| `category_translations` | `name` (per locale) | Not directly searched |
| `city_translations` | `name` | Not searched as text |
| `business_category_links` | category FK | RPC `search_business_ids_for_category` |

### What is NOT searched today:

- **`business_translations.name`** — Translated business names are not searchable
- **`description`** — Business descriptions are not indexed for search
- **`category_translations.name`** — Not contributed to text relevance
- **`business_attributes`** — Not searchable
- **`business_services`** — Not searchable
- **`reviews`** — Not searchable (privacy/quality concerns)

### Data volume estimate:

| Entity | Est. rows | Est. size |
|---|---|---|
| `businesses` (published) | 50,000 | 500 MB |
| `business_translations` | 150,000 | 200 MB |
| `business_category_links` | 60,000 | 60 MB |
| `categories` + translations | 80 + 240 | Tiny |
| `cities` + translations | 81 + 243 | Tiny |

---

## 3. Phase D v1 — Implementation Scope

Everything in this section is in scope for Phase D v1. Anything not listed here is deferred to a future phase.

---

### 3.1 Search Vector Design

**Chosen design:** Single `search_vector` column using a custom accent-insensitive text search configuration.

**Rationale for a single column:**
- Per-language vectors (tr/en/ar) add complexity to trigger maintenance, query construction, and backfill
- The `simple` dictionary handles all languages equally — no stemming means no language-specific behaviour to debug
- Turkish/English/Arabic all use the same Latin-derived script for business names; stemming differences rarely matter for directory search
- If query logs later show a measurable need for language-specific stemming, per-language vectors can be added alongside without migration
- One column = one GIN index = one query pattern = simpler debugging

**Implementation:**

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Custom text search config: unaccent then simple (no stemming)
CREATE TEXT SEARCH CONFIGURATION simple_unaccent (COPY = simple);
ALTER TEXT SEARCH CONFIGURATION simple_unaccent
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, simple;
```

Vector composition (built by trigger, backfilled by migration):

```
search_vector =
  setweight(to_tsvector('simple_unaccent', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('simple_unaccent', coalesce(slug, '')), 'A')
```

- **A-weight:** exact identifiers — `name` and `slug` get the highest weight
- **Only these two fields in v1** — `description`, translation names, category/city names are deferred
- No translation join in v1 — the `simple_unaccent` config already handles cross-language character matching

---

### 3.2 Exact Search

When the user query exactly matches a `businesses.name` or `slug`, that result must rank at the top.

**Implementation:** `phraseto_tsquery('simple_unaccent', query)` matches the exact phrase with the `simple_unaccent` dictionary. The A-weight on `name` and `slug` fields naturally boosts exact matches to the top via `ts_rank`.

```sql
WHERE search_vector @@ phraseto_tsquery('simple_unaccent', 'karaköy balıkçısı')
ORDER BY ts_rank(search_vector, phraseto_tsquery('simple_unaccent', 'karaköy balıkçısı')) DESC
```

`phraseto_tsquery` preserves word order and requires all words to be present — this matches exact navigational queries.

---

### 3.3 Normalized Search

**Client side:** Every user query already passes through the existing `normalize` function in `parseIntent.ts` (NFKC, Turkish lowercasing, Arabic diacritic stripping, punctuation removal). This remains unchanged.

**Server side:** The custom `simple_unaccent` text search configuration strips diacritics (`ü`→`u`, `ş`→`s`, `ç`→`c`, `ğ`→`g`, `ö`→`o`, `ı`→`i`) before matching. This ensures:

- Query `İstanbul` matches stored value `İstanbul` (via `simple` lowercasing + unaccent)
- Query `şehir` matches stored value `sehir` (via unaccent on both sides)
- Double normalization (client + server) is safe — applying `unaccent` twice is idempotent

---

### 3.4 Prefix Search

**Use case:** Autocomplete/suggest-as-you-type in `SmartSearchInput`. Not for the main result page — that uses full-text search.

**Implementation:** Reuse the existing `businesses_published_name_trgm_idx` trigram GIN index.

```sql
SELECT id, name, slug
FROM businesses
WHERE status = 'published'
  AND name ILIKE 'karakö%'
ORDER BY name
LIMIT 10;
```

The trigram index accelerates `ILIKE 'prefix%'` natively because at least the first trigram prefix matches. No new indexes needed for prefix search.

---

### 3.5 Full-Text Search

This is the primary retrieval method for Phase D v1.

**Query construction:**

```sql
-- Convert user query to tsquery
SELECT plainto_tsquery('simple_unaccent', 'istanbul restoran');
-- → 'istanbul' & 'restoran'

-- Main search query:
SELECT b.id, b.name, b.slug, b.rating, b.review_count,
       ts_rank(b.search_vector, q.query) AS rank
FROM businesses b
CROSS JOIN (SELECT plainto_tsquery('simple_unaccent', 'istanbul restoran') AS query) q
WHERE b.status = 'published'
  AND b.search_vector @@ q.query
ORDER BY rank DESC
LIMIT 20;
```

**Language-aware parsing integration:**

The `parseIntent` output determines `matchedCitySlug` and `matchedCategorySlug`. When these are present:

1. Structured filters (`city_id = ?`, `primary_category_id = ?` or category-link join) are applied as WHERE clauses
2. The `tsquery` matches only against text fields (name, slug)
3. Full-text ranking determines sort order within the filtered set

When `parseIntent` produces NO structured match (descriptiveIntent = false), the query is a free-text discovery search — all published businesses matching the tsquery are returned, ranked by `ts_rank`.

---

### 3.6 Multilingual Aliases

**Current state:** Four categories have hardcoded aliases in `CATEGORY_ALIASES` in `parseIntent.ts`.

**Phase D v1 change:** Move aliases to the database for extensibility without code changes.

```sql
CREATE TABLE IF NOT EXISTS search_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('category', 'city', 'district')),
  entity_id UUID NOT NULL,
  alias TEXT NOT NULL,
  language_code TEXT NOT NULL CHECK (language_code IN ('tr', 'en', 'ar')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_search_aliases
  ON search_aliases (entity_type, entity_id, alias);
```

**Seed migration:**

```sql
-- From existing category translations
INSERT INTO search_aliases (entity_type, entity_id, alias, language_code)
SELECT 'category', c.id, ct.name, ct.language_code
FROM categories c
JOIN category_translations ct ON ct.category_id = c.id
WHERE ct.name IS NOT NULL;

-- From existing hardcoded aliases
INSERT INTO search_aliases (entity_type, entity_id, alias, language_code) VALUES
  ('category', (SELECT id FROM categories WHERE slug = 'hotels'), 'otel', 'tr'),
  ('category', (SELECT id FROM categories WHERE slug = 'hotels'), 'oteller', 'tr'),
  ('category', (SELECT id FROM categories WHERE slug = 'restaurants'), 'restoran', 'tr'),
  ('category', (SELECT id FROM categories WHERE slug = 'clinics'), 'klinik', 'tr'),
  ('category', (SELECT id FROM categories WHERE slug = 'cafes'), 'kafe', 'tr'),
  ('category', (SELECT id FROM categories WHERE slug = 'cafes'), 'cafe', 'en');
```

**`parseIntent.ts` update:** Replace the hardcoded `CATEGORY_ALIASES` dictionary with a server-side query to the `search_aliases` table. The function fetches aliases once per request (cached for 5 minutes as described in §8). If the query fails, it falls back to the in-memory hardcoded dictionary — zero regression risk.

**Synonym expansion:** The existing synonym detection in `parseIntent` (ucuz→price_level=1, lüks→price_level=4, aile→family, en iyi→rating desc) is preserved as-is. These are simple keyword → structured-filter mappings. They are not migrated to the database in v1; that is a future enhancement.

---

### 3.7 Category Filtering

**Current state:** Two paths — RPC `search_business_ids_for_category` (preferred) and `primary_category_id.eq(slug)` fallback.

**Phase D v1:** Keep both paths exactly as they are.

- The RPC handles UNION of `primary_category_id` and `business_category_links`
- The fallback handles cases where the RPC URL is too long
- **No recursive CTE for subcategory expansion** — deferred to future phase
- **No `cat_business_counts` materialized view** — deferred; hardcoded `businessCount` in `demo-data.ts` remains
- Category filtering is a structured WHERE clause on the full-text search query, not a separate retrieval path

---

### 3.8 City and Geographic Filtering

**Current state:** Slug-based city/district resolution → `businesses.city_id.eq(uuid)` filter.

**Phase D v1:** Preserve slug-based filtering exactly as-is. This is fast with the existing `businesses_published_city_district_idx` composite index.

**No PostGIS.** No proximity search (`ST_DWithin`). No `GEOGRAPHY` column. All geographic filtering stays at the city/district level via resolved UUIDs.

---

### 3.9 Retrieval Strategy

**Chosen: Sequential Fusion (single-threaded fallback chain).**

This is the sole retrieval strategy for Phase D v1. No parallel retrieval, no RRF, no hybrid fusion.

```
User Query
    │
    ├─ 1. Intent Parser → structured filters (city, category, price)
    │                    → remaining query text
    │
    ├─ 2. Full-text search (tsvector)
    │       → If >= 5 results: return ranked IDs
    │       → If < 5 results: go to 3
    │
    └─ 3. Trigram ILIKE fallback
            → Return ranked IDs (same structured filters applied)
```

**Why sequential fusion over RRF:**
- RRF adds complexity (two parallel queries, FULL OUTER JOIN, rank normalization) for marginal gain
- Sequential fusion is simpler to debug, test, and roll back
- The trigram fallback only activates when full-text returns < 5 results — for most queries, only one path runs
- If analytics later show that users regularly get zero results from full-text when trigram would find matches, RRF can be added without changing the data model

**Structured filters** (city, category, price, rating) are applied identically to both paths via SQL WHERE clauses. The intent parser output is shared — it runs once before either path.

---

### 3.10 Reranking

**Approach:** Simple multiplicative boost factor applied in the `ORDER BY` clause.

```sql
ORDER BY
  ts_rank(b.search_vector, q.query) *
  (1.0 +
    CASE WHEN b.description IS NOT NULL AND b.description != '' THEN 0.2 ELSE 0 END +
    CASE WHEN b.review_count > 10 THEN 0.1 ELSE 0 END
  ) DESC
```

**Boost factors (v1):**
- +0.2 if the business has an AI-generated description (enriched via Phase C)
- +0.1 if the business has more than 10 reviews (community-validated)

**No penalty factors in v1** (no negative boosts for missing images or failed enrichment). The goal is to gently promote well-enriched businesses, not to penalize incomplete ones.

**No ML reranking.** No XGBoost, no embedding-based reranking. Those require Phase E infrastructure.

---

### 3.11 Rating Strategy

**Design principle:** At launch, nearly every business has imported Google ratings and zero platform reviews. The ranking must not get worse than today. Imported data is the primary ranking signal in Phase D v1. Platform reviews become an additional signal that gradually gains weight as activity grows.

#### Current state
- `businesses.rating` — imported Google rating, set once during import, never recalculated
- `businesses.review_count` — imported Google review count, set once during import, never recalculated
- Sort `recommended` = `ORDER BY rating DESC`
- Sort `most_reviewed` = `ORDER BY review_count DESC`

#### Phase D v1 — Blended ranking score

Three columns are added to `businesses`:

| Column | Type | Source | Purpose |
|---|---|---|---|
| `platform_avg_rating` | `numeric(2,1)` | Computed from `reviews WHERE source='platform'` | Platform review average for blending |
| `platform_review_count` | `integer` | Computed from `reviews WHERE source='platform'` | Platform review count for blend weight |
| `ranking_score` | `numeric(4,3)` | Computed blend (see formula below) | Primary sort column for `recommended` |

**`ranking_score` formula:**

```
imported_bayesian = (rating * review_count + prior_weight * prior_mean)
                  / (review_count + prior_weight)

platform_bayesian = (platform_avg_rating * platform_review_count + prior_weight * prior_mean)
                  / (platform_review_count + prior_weight)

alpha = LEAST(1.0, platform_review_count / transition_threshold)

ranking_score = imported_bayesian * (1.0 - alpha) + platform_bayesian * alpha
```

Where:
- `rating`, `review_count` — the original imported values (never modified)
- `prior_mean` = 3.5 (default assumption for low-review-count businesses)
- `prior_weight` = 3 (Bayesian smoothing constant)
- `transition_threshold` = 10 (platform reviews needed to fully switch to platform score)

**Behaviour at different coverage levels:**

| Scenario | platform_review_count | alpha | ranking_score approximates |
|---|---|---|---|
| No platform reviews | 0 | 0 | `imported_bayesian` (same as today, but Bayes-smoothed) |
| Early platform adoption | 3 | 0.30 | 70% imported, 30% platform |
| Moderate platform activity | 7 | 0.70 | 30% imported, 70% platform |
| Platform maturity | 10+ | 1.0 | `platform_bayesian` (fully platform-driven) |

**This means at launch the ranking is essentially identical to today's** (both use imported rating and count) but with Bayesian smoothing as an improvement — a business with 1 imported review of 5.0 scores `(5*1+10.5)/(1+3)=3.875` instead of `5.0`, preventing it from outranking a business with 100 imported reviews averaging 4.5 (`(4.5*100+10.5)/(100+3)=4.47`).

#### Why blend instead of replace

- **Launch quality:** Every business has imported Google data; almost none have platform reviews. A platform-only score would collapse to the default mean for 99% of businesses, making `recommended` sort useless.
- **Smooth transition:** As real platform activity grows, the ranking naturally shifts from "what Google says" to "what users say" — without a hard cutover or code change.
- **No data destruction:** Imported rating and count columns are never overwritten. Rollback is a column drop.

#### Sort behaviour

- `recommended` → `ORDER BY ranking_score DESC`
- `most_reviewed` → `ORDER BY (review_count + platform_review_count) DESC` (total reviews visible)
- Imported rating still displayed on business cards as `businesses.rating` — only the sort key changes

#### Implementation

```sql
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS platform_avg_rating numeric(2,1);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS platform_review_count INTEGER DEFAULT 0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ranking_score numeric(4,3);

-- One-time backfill (safe to run at any time)
UPDATE businesses SET
  platform_avg_rating = COALESCE((
    SELECT AVG(rating)::numeric(2,1) FROM reviews
    WHERE business_id = businesses.id
      AND status = 'published'
      AND source = 'platform'
  ), 0),
  platform_review_count = COALESCE((
    SELECT COUNT(*) FROM reviews
    WHERE business_id = businesses.id
      AND status = 'published'
      AND source = 'platform'
  ), 0);

UPDATE businesses SET
  ranking_score = (
    ((rating * review_count + 10.5) / (review_count + 3.0)) * (1.0 - LEAST(1.0, platform_review_count::numeric / 10.0))
    +
    ((platform_avg_rating * platform_review_count + 10.5) / (platform_review_count + 3.0)) * LEAST(1.0, platform_review_count::numeric / 10.0)
  );

-- Trigger to maintain on review insert/update/delete
CREATE OR REPLACE FUNCTION maintain_business_ranking() RETURNS trigger AS $$
DECLARE
  target_id UUID;
  pr_avg numeric(2,1);
  pr_count integer;
BEGIN
  target_id := COALESCE(NEW.business_id, OLD.business_id);

  SELECT AVG(rating)::numeric(2,1), COUNT(*)::integer
  INTO pr_avg, pr_count
  FROM reviews
  WHERE business_id = target_id
    AND status = 'published'
    AND source = 'platform';

  UPDATE businesses SET
    platform_avg_rating = COALESCE(pr_avg, 0),
    platform_review_count = COALESCE(pr_count, 0),
    ranking_score = (
      ((rating * review_count + 10.5) / (review_count + 3.0)) * (1.0 - LEAST(1.0, COALESCE(pr_count, 0)::numeric / 10.0))
      +
      ((COALESCE(pr_avg, 0) * COALESCE(pr_count, 0) + 10.5) / (COALESCE(pr_count, 0) + 3.0)) * LEAST(1.0, COALESCE(pr_count, 0)::numeric / 10.0)
    )
  WHERE id = target_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reviews_business_ranking
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION maintain_business_ranking();
```

#### Future evolution

When platform review coverage reaches statistical significance (monitored via `search_query_log`), the transition can be accelerated by lowering `transition_threshold` or replaced entirely by switching the formula to use only platform reviews. No column changes needed — only the trigger function body.

---

## 4. Database Indexes

### All existing indexes preserved

| Index | Purpose | Phase D change |
|---|---|---|
| `businesses_published_status_rating_idx` | Recommended sort | Augmented by `ranking_score` sort (blended) |
| `businesses_published_city_district_idx` | City+district filter | Keep |
| `businesses_published_primary_category_idx` | Category filter | Keep |
| `businesses_published_price_rating_idx` | Price filter | Keep |
| `businesses_published_created_at_idx` | Newest sort | Keep |
| `businesses_published_name_trgm_idx` | ILIKE fallback on name | Keep |
| `businesses_published_address_trgm_idx` | ILIKE fallback on address | Keep |
| Category/city/district slug indexes | Slug→UUID lookup | Keep |

### New indexes for Phase D v1

```sql
-- 1. Full-text search vector (GIN, primary retrieval path)
CREATE INDEX IF NOT EXISTS businesses_search_vector_idx
  ON businesses USING GIN (search_vector);

-- 2. Search aliases lookup
CREATE INDEX IF NOT EXISTS search_aliases_lookup_idx
  ON search_aliases (alias text_pattern_ops, entity_type);

-- 3. Ranking score for recommended sort (B-tree, partial on published only)
CREATE INDEX IF NOT EXISTS businesses_published_ranking_score_idx
  ON businesses (ranking_score DESC NULLS LAST)
  WHERE status = 'published';

-- 4. Query log for analytics
CREATE INDEX IF NOT EXISTS search_query_log_created_idx
  ON search_query_log (created_at DESC);
```

### Index maintenance

- `search_vector` maintained by `BEFORE INSERT OR UPDATE OF name, slug` trigger on `businesses`
- `platform_avg_rating`, `platform_review_count`, and `ranking_score` maintained by trigger on `reviews` (insert/update/delete)
- All trigram indexes are `gin_trgm_ops` — no special maintenance needed beyond autovacuum
- No materialized views = no refresh scheduling

---

## 5. Required Migrations

### Migration 1: `20260726_enable_extensions.sql`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TEXT SEARCH CONFIGURATION simple_unaccent (COPY = simple);
ALTER TEXT SEARCH CONFIGURATION simple_unaccent
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, simple;
```

### Migration 2: `20260726_add_search_aliases.sql`

```sql
CREATE TABLE IF NOT EXISTS search_aliases (...);
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_aliases (...);
CREATE INDEX IF NOT EXISTS search_aliases_lookup_idx (...);

-- Seed from category_translations
INSERT INTO search_aliases (...)
SELECT 'category', c.id, ct.name, ct.language_code
FROM categories c
JOIN category_translations ct ON ct.category_id = c.id
WHERE ct.name IS NOT NULL;

-- Seed hardcoded aliases
INSERT INTO search_aliases (...) VALUES (...);
```

### Migration 3: `20260726_add_search_vector_and_ranking.sql`

```sql
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS platform_avg_rating numeric(2,1);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS platform_review_count INTEGER DEFAULT 0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ranking_score numeric(4,3);

CREATE INDEX IF NOT EXISTS businesses_search_vector_idx ON businesses USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS businesses_published_ranking_score_idx
  ON businesses (ranking_score DESC NULLS LAST) WHERE status = 'published';

-- Backfill search_vector
CREATE OR REPLACE FUNCTION rebuild_search_vectors() RETURNS void AS $$
  UPDATE businesses SET
    search_vector =
      setweight(to_tsvector('simple_unaccent', coalesce(name, '')), 'A') ||
      setweight(to_tsvector('simple_unaccent', coalesce(slug, '')), 'A')
  WHERE status = 'published';
$$ LANGUAGE sql;

-- Trigger for search_vector
CREATE OR REPLACE FUNCTION maintain_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple_unaccent', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple_unaccent', coalesce(NEW.slug, '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_businesses_search_vector
  BEFORE INSERT OR UPDATE OF name, slug ON businesses
  FOR EACH ROW EXECUTE FUNCTION maintain_search_vector();

-- Backfill platform stats and ranking_score
CREATE OR REPLACE FUNCTION rebuild_ranking_scores() RETURNS void AS $$
BEGIN
  UPDATE businesses SET
    platform_avg_rating = COALESCE((
      SELECT AVG(rating)::numeric(2,1) FROM reviews
      WHERE business_id = businesses.id
        AND status = 'published'
        AND source = 'platform'
    ), 0),
    platform_review_count = COALESCE((
      SELECT COUNT(*) FROM reviews
      WHERE business_id = businesses.id
        AND status = 'published'
        AND source = 'platform'
    ), 0);

  UPDATE businesses SET
    ranking_score = (
      ((rating * review_count + 10.5) / (review_count + 3.0)) * (1.0 - LEAST(1.0, platform_review_count::numeric / 10.0))
      +
      ((platform_avg_rating * platform_review_count + 10.5) / (platform_review_count + 3.0)) * LEAST(1.0, platform_review_count::numeric / 10.0)
    );
END;
$$ LANGUAGE plpgsql;

-- Trigger for platform stats and ranking_score
CREATE OR REPLACE FUNCTION maintain_business_ranking() RETURNS trigger AS $$
DECLARE
  target_id UUID;
  pr_avg numeric(2,1);
  pr_count integer;
BEGIN
  target_id := COALESCE(NEW.business_id, OLD.business_id);

  SELECT AVG(rating)::numeric(2,1), COUNT(*)::integer
  INTO pr_avg, pr_count
  FROM reviews
  WHERE business_id = target_id
    AND status = 'published'
    AND source = 'platform';

  UPDATE businesses SET
    platform_avg_rating = COALESCE(pr_avg, 0),
    platform_review_count = COALESCE(pr_count, 0),
    ranking_score = (
      ((rating * review_count + 10.5) / (review_count + 3.0)) * (1.0 - LEAST(1.0, COALESCE(pr_count, 0)::numeric / 10.0))
      +
      ((COALESCE(pr_avg, 0) * COALESCE(pr_count, 0) + 10.5) / (COALESCE(pr_count, 0) + 3.0)) * LEAST(1.0, COALESCE(pr_count, 0)::numeric / 10.0)
    )
  WHERE id = target_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reviews_business_ranking
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION maintain_business_ranking();
```

### Migration 4: `20260726_add_search_query_log.sql`

```sql
CREATE TABLE IF NOT EXISTS search_query_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL,
  locale TEXT NOT NULL,
  intent JSONB,
  result_count INTEGER,
  top_result_ids UUID[],
  duration_ms INTEGER,
  method TEXT, -- 'fulltext' or 'trigram_fallback'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_query_log_created_idx
  ON search_query_log (created_at DESC);
```

Note: The query log table has no TTL enforcement in v1. A future enhancement can add a cleanup job or retention policy.

---

## 6. API Design

### Search endpoint (existing route, updated implementation)

The existing `$lang.search.tsx` route and `search-service.server.ts` are updated internally. The API contract does not change:

**Request:** `GET /{lang}/search?q={query}&category={slug}&city={slug}&page={n}`

**Response (unchanged shape):**
```typescript
interface SearchResponse {
  results: BusinessCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  intent: ParsedIntent;
  suggestion?: { query: string; reason: string };
}
```

**Internal changes in `search-service.server.ts`:**

```typescript
async function searchBusinesses(params: SearchParams): Promise<SearchResponse> {
  const intent = await parseIntent(params.query, params.locale);

  // Step 1: Full-text search
  let results = await fullTextSearch({
    query: intent.remainingText,
    filters: buildFilters(intent, params),
    page: params.page,
    pageSize: params.pageSize,
  });

  // Step 2: Fallback to trigram if < 5 results
  if (results.length < 5) {
    results = await trigramSearch({
      query: intent.remainingText,
      filters: buildFilters(intent, params),
      page: params.page,
      pageSize: params.pageSize,
    });
  }

  // Step 3: Log query for telemetry
  logSearchQuery({ query: params.query, locale: params.locale, intent, results });

  return results;
}
```

**No new endpoints in v1.** No `/search/suggest` endpoint (prefix search for autocomplete is handled client-side via direct PostgREST query with ILIKE, as it is today).

---

## 7. Performance Expectations

### Query budget

| Operation | Budget |
|---|---|
| Intent parsing | < 5ms (pure JS) |
| Full-text search (tsvector + GIN) | < 50ms for 50k published businesses |
| Trigram fallback (rare) | < 100ms (GIN index hit) |
| Result mapping + serialization | < 30ms |
| **Total p95** | **< 200ms** |

### Bottlenecks avoided in v1

1. **No translation join** — The current `BUSINESS_SELECT` joins 8+ tables. Splitting into ID+rank then full-fetch for top N is done if `EXPLAIN ANALYZE` shows seq scans on the full query.
2. **No materialized view refresh** — No background contention from `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
3. **Single GIN index** — One index to maintain, one index to hit. Simple execution plans.

---

## 8. Caching Strategy

| Cache | TTL | Invalidation |
|---|---|---|
| Category list (for intent parser) | 5 min | Manual admin action or restart |
| City list (for intent parser) | 5 min | Manual admin action or restart |
| Search aliases (for intent parser) | 5 min | Alias table change (via `updated_at` check) |
| Search results | No cache | Dynamic per query |
| Business detail | 1 min | Business update webhook |

**Why no result caching:** Every search query is unique (different text, different filters, different page). Caching adds complexity for negligible benefit at this scale. If the system grows beyond 50k businesses and query volume exceeds 100 QPS, a Redis result cache can be added.

---

## 9. Pagination Strategy

**Keep the existing offset-based pagination** (`page`/`pageSize` with `OFFSET`/`LIMIT`).

```sql
LIMIT 20 OFFSET ((page - 1) * 20);
```

- No cursor-based pagination in v1 (offset is fine for top-200 results)
- Maximum page depth: page 10 (200 results deep). Beyond that, suggest refining the query
- `totalCount` is fetched via a separate `COUNT(*)` query with the same filters (cached for 30s)

---

## 10. Telemetry and Analytics

### Search query log

Every search writes a row to `search_query_log`:

```typescript
interface SearchQueryLog {
  query: string;           // Raw user input
  locale: string;          // tr | en | ar
  intent: ParsedIntent;    // Parsed intent (structured)
  resultCount: number;     // Number of results returned
  topResultIds: string[];  // Top 10 business IDs returned
  durationMs: number;      // Total query duration
  method: string;          // 'fulltext' | 'trigram_fallback'
  createdAt: string;       // ISO timestamp
}
```

**Usage:**
- Identify queries that return zero results (opportunities to add aliases or data)
- Detect when trigram fallback is consistently needed (signal to add RRF or expand the tsvector)
- Monitor p95 latency over time

**No result explainability in v1.** The `reason` field (matched fields, score breakdown) is deferred to a future phase. The query log captures enough data to diagnose ranking issues without per-result debugging.

---

## 11. Testing Strategy

### Unit tests (vitest)

| Test group | Tests | Coverage |
|---|---|---|
| Intent parser with DB aliases | 15 | All 8 categories × 3 languages; fallback to hardcoded dict |
| Search service query builder | 10 | Each filter combination; tsquery construction |
| Normalisation | 8 | Turkish/Arabic/English diacritics, case folding |
| Sequential fusion fallback logic | 5 | Full-text returns 0, returns 3, returns 10 |
| Reranking boost factors | 4 | Each boost factor applied correctly |

### Integration tests (against test Supabase)

| Test | Scenario |
|---|---|
| `search_full_text_basic` | Query "restoran" returns restaurants ranked by ts_rank |
| `search_exact_boost` | Exact name match ranks higher than partial match |
| `search_structured_filters` | City + category + price produces correct SQL with correct WHERE clauses |
| `search_alias_expansion` | "Otel" matches hotel category via search_aliases table |
| `search_fallback_trigram` | 0 full-text results → trigram ILIKE returns results |
| `search_fallback_group` | 3 full-text results → group is kept, fallback not triggered |
| `search_performance` | Queries complete within 200ms p95 |

### Regression guard

For the first week after deployment, every search query also runs the old ILIKE query in a fire-and-forget comparison (logged, never returned to the user). A daily report flags regressions where:
- New results miss top-10 old results
- Total result count drops by >20%
- The fallback chain triggers more than 10% of queries

After the first week, the comparison is turned off and only the query log remains.

---

## 12. Rollout Plan

### Phase D v1 deployment order

| Step | Description | Duration | Risk | Rollback action |
|---|---|---|---|---|
| 1 | Run Migration 1 (extensions + text search config) | 1 min | None — idempotent | Nothing to revert |
| 2 | Run Migration 2 (search_aliases + seed) | 5 min | Low — additive, old code unaffected | `DROP TABLE IF EXISTS search_aliases CASCADE` |
| 3 | Deploy updated `parseIntent.ts` (query search_aliases, fallback to hardcoded dict) | Code deploy | Low — fallback ensures no regression | Revert code |
| 4 | Run Migration 3 (search_vector, ranking_score, backfill, triggers) | 30 min (batched backfill) | Medium — large backfill on businesses table; run in batches of 1000 | Triggers are additive; skip rollback unless errors |
| 5 | Deploy new `search-service.server.ts` with full-text query + sequential fusion | Code deploy | **High** — primary risk step | Revert to old ILIKE code |
| 6 | Run Migration 4 (search_query_log) | 1 min | Low — additive | `DROP TABLE IF EXISTS search_query_log CASCADE` |
| 7 | Monitor for 48h: query log, latency, fallback rate, zero-result rate | 48h | Medium — watch for regressions | If >10% fallback rate, investigate full-text coverage |
| 8 | Compare old vs new results (regression guard from §11) | 7 days | Low | Tune tsvector or add fields if regressions found |

### Migration 3 backfill strategy

```bash
# Run in batches of 1000 to avoid locking the businesses table
DO $$
DECLARE
  batch_size CONSTANT INTEGER := 1000;
  updated INTEGER;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id FROM businesses
      WHERE search_vector IS NULL
        AND status = 'published'
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE businesses b SET
      search_vector =
        setweight(to_tsvector('simple_unaccent', coalesce(b.name, '')), 'A') ||
        setweight(to_tsvector('simple_unaccent', coalesce(b.slug, '')), 'A')
    FROM batch
    WHERE b.id = batch.id;

    GET DIAGNOSTICS updated = ROW_COUNT;
    RAISE NOTICE 'Backfilled % rows', updated;
    EXIT WHEN updated < batch_size;
    COMMIT;
  END LOOP;
END;
$$;
```

---

## 13. Rollback Strategy

Every change is additive and reversible:

| Component | Rollback action | Data loss? |
|---|---|---|
| `search_vector` column | Ignore it (old code does not reference it) | No — column stays but unused |
| `ranking_score` column | Ignore it | No — column stays but unused |
| `platform_avg_rating` column | Ignore it | No — column stays but unused |
| `platform_review_count` column | Ignore it | No — column stays but unused |
| `search_aliases` table | Ignore it; old code uses hardcoded dict | No |
| `search_query_log` table | `DROP TABLE` or ignore | Query logs lost (acceptable) |
| New triggers | `DROP TRIGGER ... CASCADE` | No |
| New `search-service.server.ts` | Revert to previous git commit | No |
| Updated `parseIntent.ts` | Revert to previous git commit | No |
| Extensions + text search config | Leave in place (other code may depend on `unaccent`/`pg_trgm`) | No |

**Full rollback (worst case):** Revert the code changes for `search-service.server.ts` and `parseIntent.ts` to the previous git commit. All database changes are additive and can be cleaned up in a follow-up migration. Search behaviour returns exactly to pre-Phase-D state.

---

## 14. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| tsvector backfill locks businesses table | Low | Medium | Batch of 1000 with `FOR UPDATE SKIP LOCKED`; backfill runs during low traffic |
| `simple` dictionary misses Turkish stemming | Low | Medium | Query logs monitored; per-language vectors can be added in future without migration |
| Alias migration misses an existing alias | Low | Low | Fallback to hardcoded `CATEGORY_ALIASES`; add missing alias post-deploy |
| Trigram fallback triggers too often | Medium | Low | Expand tsvector to include translations/descriptions; if persistent, add RRF |
| Query log writes slow down search | Low | Low | Log write is fire-and-forget (INSERT with no RETURNING); if bottleneck, move to async queue |
| Ranking_score backfill is slow | Medium | Low | Runs as background batch; businesses with no platform reviews get imported Bayesian score |
| `unaccent` with Turkish `İ`/`ı` edge cases | Low | Medium | `simple` dictionary lowercases correctly; client-side `normalize` also handles this |

---

## 15. Future Enhancements (Post v1)

The following items are explicitly out of scope for Phase D v1. They are listed here to document the roadmap and to prevent scope creep during implementation.

### Phase D.1 (next sprint)

| Enhancement | Rationale | Prerequisite |
|---|---|---|
| Add `business_translations.name` to search_vector (B-weight) | Turkish user searching "restoran" matches English business name "Restaurant" | Stable full-text baseline |
| Add `description` to search_vector (C-weight) | Enriched descriptions from Phase C become searchable | Phase C enrichment coverage >50% |
| Add category/city translation names to search_vector (D-weight) | Query "restoran" matches category name without explicit filter | Query logs show need |
| RRF hybrid retrieval (parallel full-text + trigram fusion) | Users regularly get zero results from full-text alone | Fallback rate >10% in query logs |
| Result explainability debug mode (admin only) | Admin cannot diagnose ranking issues | Query log baseline exists |

### Phase D.2 (later sprint)

| Enhancement | Rationale |
|---|---|
| Materialized view for category business counts | Replace hardcoded `businessCount` in `demo-data.ts` |
| Admin UI for alias management | Allow non-technical admins to add/remove aliases |
| Per-language search vectors (turkish, english, arabic) | Query logs show stemming-steered improvement |
| Search query log retention / auto-cleanup | Prevent unbounded log growth |
| Cursor-based pagination | Offset performance degrades beyond page 10 |

### Phase E (separate phase)

| Enhancement | Rationale |
|---|---|
| Business embedding vectors | Semantic search |
| ML-based reranking | Improve ranking beyond rule-based boosts |
| PostGIS proximity search | "Restaurants near me" functionality |

---

## 16. Comparison: Phase D v1 vs Current System

| Aspect | Current system | Phase D v1 | Improvement |
|---|---|---|---|
| Search method | ILIKE `%query%` on name + address | `tsvector` + GIN full-text on name + slug | O(log n) instead of O(n); 100x faster at 50k rows |
| Fallback | None (ILIKE always returns something) | Full-text → trigram ILIKE | Graceful degradation |
| Exact match | Ranks by ILIKE α-order | Boosted by A-weight + `phraseto_tsquery` | Exact names rank at top |
| Diacritics | Client-side only | Server-side `unaccent` config | Consistent matching |
| Aliases | 4 hardcoded in `parseIntent.ts` | Database `search_aliases` table, seeded from translations | Admin-editable, multilingual |
| Rating sort | Raw `rating DESC` (imported) | Blended Bayesian (imported + platform, weighted by coverage) | Same at launch, fairer over time |
| Caching | None | Category/city/alias caches with 5min TTL | Faster intent parsing |
| Telemetry | None | `search_query_log` table | Data-driven improvements |
| Retrieval strategy | Single ILIKE pass | Sequential fusion (full-text → trigram fallback) | Robust coverage |
