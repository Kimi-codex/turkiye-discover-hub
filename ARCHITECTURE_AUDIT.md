# Full Data Architecture Audit — Turkiye Discover Hub

**Date:** 2026-07-25  
**Project:** `turkiye-discover-hub`  
**Branch:** `main` (693273c)  
**Repository:** https://github.com/Kimi-codex/turkiye-discover-hub.git  

---

## A. Executive Summary

This is a read-only architecture audit of a Turkish business directory platform built with TanStack React Start, Supabase, and Cloudflare R2. The codebase is **actively developed** with 35 database migrations, a full import pipeline (12-stage wizard), owner portal with change-request moderation, onboarding system, multilingual support (tr/en/ar), and an admin panel.

**Key Architectural Finding:** The system is well-architected with a clear separation between import pipeline (staged, transactional) and live data. The database schema is comprehensive and the import pipeline is the most sophisticated subsystem. However, there are significant areas where **hardcoded demo data overlaps with database-driven production paths**, creating a risk that public-facing features show demo content instead of real data.

**Critical Risks:**
1. Hardcoded demo data (`demo-data.ts`) is imported alongside production repos — the `services` object currently uses `supabaseServices` but legacy references may fall through to demo data
2. Field mapping suggestions are hardcoded in `schema-detector.ts` (50+ Google Places paths) — unknown paths are silently marked "unsupported"
3. Images rely on `ExternalOnlyImageStorageProvider` — R2 worker code exists but `normalize-pipeline.ts` is a passthrough
4. Search filters panel uses demo-data category/city lists instead of database queries
5. Categories `businessCount` is hardcoded (1,284 for restaurants, 642 for hotels — never updated from DB)

---

## B. Current System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     TanStack React Start                     │
│  (File-based routing, SSR, Server Functions, Middleware)     │
├─────────────────────────────────────────────────────────────┤
│  Public Routes      │  Account Routes   │  Owner Routes     │
│  /search            │  /account         │  /owner           │
│  /place/:slug       │  /account/settings│  /owner/onboarding │
│  /:city/:category   │  /account/...     │  /owner/:id/...   │
│  /:city/:dist/:cat  │                   │                   │
├─────────────────────┴───────────────────┴──────────────────┤
│  Admin Routes                                                │
│  /admin/imports/*, /admin/businesses/*, /admin/onboarding/* │
│  /admin/category-mappings, /admin/cities, /admin/settings   │
├─────────────────────────────────────────────────────────────┤
│  Supabase (Database, Auth, Storage, RPCs)                   │
│  Cloudflare R2 (Image storage — configured, not active)     │
│  Lovable AI Gateway (Translation provider)                  │
└─────────────────────────────────────────────────────────────┘
```

**Middleware chain:** `requireSupabaseAuth` (JWT Bearer) → `requireAdmin` (admin role check) for all admin functions. Owner functions use `assertOwns` / `business_member_authz` RPCs.

---

## C. End-to-End Data Flow

### Import Pipeline (12 stages)

```
Raw JSON/CSV/XLSX → Upload (signed URL to imports bucket)
  → Schema Detection (detectSchema walks JSON, discovers fields)
  → Field Mapping (suggestFieldMapping maps to DB columns via hardcoded dict)
  → Analysis (normalizeItem → computeIntent → create batch items)
  → Category Mapping (discover source categories → admin maps to internal)
  → Validation (item-level validation)
  → Preview (computeProposedDiff against current DB)
  → Execution (runImportChunk — writes businesses, images, reviews in chunks of 50)
  → Translations (enqueueBatchTranslations → AI translation)
  → Images (markImagesStageDone or reprocessBatchImages)
  → Publish (flip status from pending_review → published)
  → Complete
```

**Key implementation details per stage:**

| Stage | Status | Transactional | Idempotent |
|-------|--------|--------------|------------|
| Upload | Fully implemented | No (single file) | Yes (file hash check) |
| Schema detection | Fully implemented | No | Yes (deterministic) |
| Field mapping | Fully implemented | No | Yes (hash-based) |
| Analysis | Fully implemented | No | Yes (hash-based dedup) |
| Category mapping | Fully implemented | No | Yes |
| Validation | Fully implemented | No | Yes |
| Preview | Fully implemented | No | Yes (hash-based) |
| Execution | Fully implemented | Per-chunk | Yes (place_id + fingerprint) |
| Translations | Fully implemented | No | Yes |
| Images | Partially (passthrough) | No | Yes |
| Publish | Fully implemented | No | Yes |

### Upload Implementation

- **Route:** `imports.index.tsx` — drag-and-drop file upload
- **Server function:** `createImportBatch` generates a signed upload URL for the `imports` Supabase storage bucket
- **File types:** JSON (array, `{places: [...]}`, `{results: [...]}`, `{data: [...]}`), nested `{business, reviews, images}` shapes
- **CSV/XLSX:** Not implemented — the schema detector and pipeline assume JSON
- **Max file size:** Not enforced in application code (relies on Supabase storage limits)
- **Nested JSON:** Full support via `extractImportItems` and `unwrapRecord` in `format.ts`

### Conflict Key

- **`place_id`** is the primary conflict key for businesses — enforced by `UNIQUE(place_id)` on `businesses` table
- **source_fingerprint** is the conflict key for images — enforced by `UNIQUE INDEX uq_business_images_source_fingerprint_all` (deleted_at IS NULL partial + non-partial for upsert inference)
- **source_fingerprint** is the conflict key for reviews — enforced by `UNIQUE INDEX uq_reviews_source_fingerprint_all` on (business_id, source, source_fingerprint)
- **Duplicate businesses cannot be created** — `place_id` is required, and if it matches an existing published business, the import produces an "update" intent

### Transaction Boundaries

- Execution processes items in chunks of 50 (`CHUNK_SIZE=50`)
- Each item is written individually (not in a DB transaction)
- If an item fails, it's marked as `failed` with error message and processing continues
- The batch lock prevents concurrent execution
- There is **no rollback capability** for partially executed batches

---

## D. Database Schema Map

### Core Tables (actively used)

| Table | Purpose | PK | Key FKs | Status |
|-------|---------|----|---------|--------|
| `businesses` | Core business records | `id` (uuid) | `place_id` (UNIQUE), `city_id`, `district_id`, `primary_category_id` | Active |
| `business_category_links` | M2M businesses ↔ categories | `(business_id, category_id)` | Both | Active |
| `business_images` | Images per business | `id` (uuid) | `business_id` | Active |
| `business_opening_hours` | Opening hours | `(business_id, day_of_week)` | `business_id` | Active |
| `business_attributes` | Key-value attributes | `(business_id, attribute_key)` | `business_id` | Active |
| `business_services` | Named services | `(business_id, service_key)` | `business_id` | Active |
| `business_translations` | Multilingual name/description | `(business_id, language_code)` | Both | Active |
| `reviews` | User/imported reviews | `id` (uuid) | `business_id` | Active |
| `business_members` | Owner/manager assignments | `(business_id, user_id)` | Both | Active |
| `categories` | Business categories | `id` (uuid) | `parent_id` (self) | Active |
| `category_translations` | Category names/descriptions | `(category_id, language_code)` | `category_id` | Active |
| `category_mappings` | External→internal category map | `(source_provider, normalized_source_category)` | `category_id` (nullable) | Active |
| `cities` | City records | `id` (uuid) | `country_id` | Active |
| `city_translations` | City names/descriptions | `(city_id, language_code)` | `city_id` | Active |
| `districts` | District records | `id` (uuid) | `city_id` | Active |
| `district_translations` | District names | `(district_id, language_code)` | `district_id` | Active |

### Import Pipeline Tables

| Table | Purpose | Active? |
|-------|---------|---------|
| `import_batches` | Import batch metadata & status | Active |
| `import_batch_items` | Individual items within a batch | Active |
| `import_approvals` | Approval records per stage | Active |
| `business_import_provenance` | Audit trail of import actions | Active |

### Auth/User Tables

| Table | Purpose | Active? |
|-------|---------|---------|
| `profiles` | User profile data | Active |
| `user_roles` | Global role assignments | Active |
| `business_members` | Per-business membership | Active |
| `business_onboarding_submissions` | Business registration requests | Active |
| `user_notifications` | Notifications for users | Active |

### Image/Processing Tables

| Table | Purpose | Active? |
|-------|---------|---------|
| `image_processing_jobs` | Processing queue for images | Active |
| `business_images_public` (view) | Public-safe image view | Active |

### Key Source-of-Truth Decisions

- **Business identity:** `place_id` (Google Places ID) is the universal conflict key
- **Business authorization:** `business_members` table (role + status), NOT `owner_id` on `businesses` (legacy fallback exists)
- **Global roles:** `user_roles` table with `app_role` enum
- **Permissions:** RLS policies enforce public-read, owner-read, admin-all for most tables
- **Language support:** 3 static locales (`tr`, `en`, `ar`) with `platform_locales` table for registry

---

## E. City Architecture

### Key Finding: TWO city systems coexist — database-driven and hardcoded demo

**Database-driven (production):**
- `cities` table (uuid PK, `country_id`, `slug`, `latitude`, `longitude`, `is_active`, `sort_order`)
- `city_translations` table (city_id, language_code, name, description)
- `districts` table (uuid PK, `city_id`, `slug`, `latitude`, `longitude`, `is_active`)
- `district_translations` table (district_id, language_code, name)
- Cities are referenced by `businesses.city_id` (FK)
- City pages (`/:citySlug`) resolve via DB queries in `services.cities.getBySlug()`
- Search service resolves city slugs to IDs via DB queries

**Hardcoded demo data:**
- `src/lib/repos/demo-data.ts:121-206` — 6 cities with hardcoded IDs, slugs, coordinates, Unsplash images, and tr/en/ar names
- `src/lib/repos/demo-data.ts:208-254` — 5 districts with hardcoded IDs and names
- **CRITICAL:** `FiltersPanel.tsx` imports `CITIES` from `demo-data` to render the city filter sidebar — NOT from the database
- `SuggestionChips.tsx` uses hardcoded city names (Sultanahmet, Basaksehir, Antalya, etc.)

**Impact:** When cities are added/removed via the admin panel, the search filters will still show the 6 hardcoded demo cities. The city filter populates from static data, not a live DB query.

### City Slug Resolution

- Routes: `/$lang/$slug` and `/$lang/$citySlug/$categorySlug` and `/$lang/$citySlug/$districtSlug/$categorySlug`
- Slug resolution happens in the search service (`search-service.server.ts:63-131`) — tries to find city by slug in dictionary, then resolves to city_id
- The search dictionary is fetched in `$lang.search.tsx` via `services.cities.list()` which calls Supabase

### Known Issues

- City inventory is hardcoded in 3+ locations (see Hardcoded Inventory section)
- `businessCount` on demo cities is static (2,143 for Istanbul, etc.) — never auto-calculated
- No neighborhood/neighborhood table exists (only `businesses.neighborhood` as free text)
- Districts are hierarchical under cities but there is no district-level business count
- Unknown cities in imported data are handled by `resolveCity` in `imports.functions.ts` — needs live DB verification

---

## F. Category Architecture

### Key Finding: THREE category systems coexist

**1. Database-driven (production):**
- `categories` table (uuid PK, `parent_id`, `slug` UNIQUE, `icon`, `category_type`, `is_active`, `sort_order`)
- `category_translations` table (category_id, language_code, name, description)
- `category_mappings` table (source_provider, source_category → category_id with mapping_status)
- `business_category_links` M2M table
- `businesses.primary_category_id` FK

**2. Hardcoded demo categories:**
- `src/lib/repos/demo-data.ts:13-110` — 8 categories with hardcoded ids, slugs, icons, names, and `businessCount`
- Used by `FiltersPanel.tsx` for the category filter sidebar

**3. Hardcoded aliases in intent parser:**
- `src/lib/search/parseIntent.ts:48-53` — only 4 categories have aliases (hotels, clinics, restaurants, cafes)
- Hospitals, attractions, beauty, shopping have NO alias entries — they can only be matched by their exact slug or translated name

### Category Mapping

- `category_mappings` table stores: `source_provider` (default 'google'), `source_category`, `normalized_source_category`, `category_id` (nullable FK), `mapping_status` (approved/pending/ignored)
- `usage_count` column added in migration 8 for tracking mapping usage
- Admin UI at `/admin/category-mappings` allows approving/ignoring mappings
- During import analysis, discovered source category labels are stored and the admin must resolve them before proceeding to validation
- If a category is unmapped (mapping_status = 'pending' or no category_id), the import cannot proceed past the mapping stage

### Hardcoded Category Lists

| File | Lines | Categories | Used for |
|------|-------|-----------|----------|
| `src/lib/repos/demo-data.ts` | 13-110 | 8 categories | FiltersPanel, CategoryShortcuts |
| `src/lib/search/parseIntent.ts` | 48-53 | 4 alias sets | Search intent parser |
| `src/components/site/PublicHeader.tsx` | nav links | Via nav hardcoded links | Header navigation (#nav.restaurants etc.) |
| `src/lib/i18n/messages.ts` | Various | nav.restaurants, nav.hotels, etc. | Static nav labels |

### Parent-Child Categories

- `categories.parent_id` supports parent-child hierarchy (FK to self, ON DELETE SET NULL)
- No child categories exist in the demo data or migrations (all 8 demo categories have `parentId: null`)
- The category admin UI (`src/routes/$lang._authenticated.admin.categories.tsx`) supports hierarchical display

---

## G. Field Mapping Architecture

### Status: Fully Implemented

**Where suggestions are generated:**
- `src/lib/import/schema-detector.ts:63-129` — `SUGGESTIONS` dictionary maps ~50 Google Places JSON paths to target `(table, column, transform)`

**Transform functions supported:**
- `identity`, `trim`, `number`, `integer`, `url`, `normalizePhone`, `categoryLookup`, `openingHours`, `epochSeconds`, `photoReference`, `arrayOfString`, `json`

**How nested JSON paths work:**
- Dotted paths (e.g., `geometry.location.lat`, `business.openingHours.periods[]`)
- `[]` suffix denotes array elements (e.g., `reviews[].author_name`, `photos[].photo_reference`)
- Arrays are supported: images[], reviews[], photos[], opening_hours.periods[], types[]

**Persistence:**
- Field mappings are stored as part of the batch (`import_batches.field_mapping` column)
- Approved mappings are recorded in `import_approvals` with `approval_kind='field_mapping'`
- Mappings survive page refresh (loaded from batch)
- Mappings are batch-specific (not automatically reusable between imports)

**Required fields:**
- `place_id` (or aliases) is required — the admin cannot ignore it
- If no variant of place_id is found, a `required_missing` row is flagged

**Duplicate prevention:**
- `applyMappingEdits` prevents required rows from being marked ignored
- No cross-field uniqueness validation (one source can map to multiple targets; multiple sources can map to same target)

**Validation:**
- The admin must approve field mappings before analysis can proceed
- `approveImportFieldMapping` checks all required paths are mapped
- Admin edits are merged via `applyMappingEdits`

### Trace: business.name → businesses.name

1. Source JSON has `"name": "Karaköy Balıkçısı"`
2. `detectSchema` discovers path `name` with type string
3. `suggestFieldMapping` matches `name` → `{targetTable: "businesses", targetColumn: "name", transform: "trim"}`
4. Admin approves mapping in Field Mapping tab
5. During analysis, `normalizeItem` applies `trim` transform
6. During execution, `runImportChunk` writes to `businesses.name`
7. Public search returns the name via `search-service.server.ts` join

### Trace: images[] / reviews[] → business_images / reviews

1. Source JSON has `"photos": [{"photo_reference": "..."}]` or `"images": [{"url": "..."}]`
2. `suggestFieldMapping` matches `photos[].photo_reference` → `{targetTable: "business_images", targetColumn: "source_metadata", transform: "photoReference"}`
3. During normalization (`normalize.ts`), `normalizeImages` processes URLs and references, `normalizeReviews` processes review arrays
4. During execution, `reprocessBatchImages` and `reprocessBatchReviews` upsert into their respective tables

---

## H. Import Pipeline (Detailed)

### Stage-by-Stage Audit

#### Stage 1: Upload
- **Implementation:** Fully implemented
- **Input:** File drag-and-drop → `createImportBatch` → signed upload URL
- **Output:** File in `imports` storage bucket, `import_batches` row with `status='pending'`
- **Failure:** File upload errors surfaced to UI
- **Idempotent:** No (each upload creates new batch)

#### Stage 2: Schema Detection
- **Implementation:** Fully implemented
- **Input:** Downloads file from storage, runs `detectSchema`
- **Output:** `import_batches.detected_schema` JSON, schema hash
- **Failure:** Invalid JSON → error message; empty payload → error
- **Idempotent:** Yes (deterministic hash function)

#### Stage 3: Field Mapping
- **Implementation:** Fully implemented  
- **Input:** Admin edits mapping via UI, approves
- **Output:** `import_approvals` with `approval_kind='field_mapping'`, batch advances to `analyze`
- **Failure:** Missing required fields → approval blocked

#### Stage 4: Analysis (Normalization)
- **Implementation:** Fully implemented
- **Input:** Downloads file again, normalizes each item via `normalizeGooglePlace`
- **Output:** `import_batch_items` rows with `intent` (insert/update/noop/invalid), discovered categories

#### Stage 5: Category Mapping
- **Implementation:** Fully implemented
- **Input:** Discovered category labels → admin maps to internal categories
- **Output:** `category_mappings` rows, batch advances to `validation`

#### Stage 6: Validation
- **Implementation:** Fully implemented
- **Input:** Item-level validation results
- **Output:** `import_batch_items.valid_items`, `invalid_items` counts

#### Stage 7: Preview
- **Implementation:** Fully implemented
- **Input:** `computeImportPreview` re-diffs against current DB
- **Output:** Preview with proposed changes per item, `preview_hash`

#### Stage 8: Execution
- **Implementation:** Fully implemented
- **Input:** Admin confirms → `runImportChunk` processes items in chunks of 50
- **Output:** Businesses created/updated, images/reviews upserted, `business_import_provenance` rows
- **Locking:** `import_batches.processing_lock_at` / `processing_lock_by` prevent concurrent execution
- **Failure handling:** Individual item failures are recorded, batch continues; lock is cleared on completion/failure

#### Stage 9: Translations
- **Implementation:** Fully implemented  
- **Input:** `enqueueBatchTranslations` creates translation jobs for each locale
- **Output:** `translation_jobs` rows processed by AI translation service

#### Stage 10: Images
- **Implementation:** Partially implemented — `markImagesStageDone` just advances past this stage
- **Background:** `reprocessBatchImages` can re-extract images from raw payload
- **R2 processing:** Exists but `normalize-pipeline.ts` is passthrough (no actual re-encoding)

#### Stage 11: Publish
- **Implementation:** Fully implemented
- **Input:** `publishImportBatch` flips all batch businesses from `pending_review` to `published`
- **Output:** Businesses become visible on public site

### Confirmed Behaviors

- **`place_id` is the conflict key:** Businesses are matched by `place_id` for upsert
- **Duplicate businesses cannot be created:** UNIQUE constraint on `place_id`
- **Child-table errors are surfaced:** Image/review upsert errors are caught and logged per item
- **Images and reviews fail independently:** An image failure doesn't block the business from being created
- **Partial imports can exist:** Some items may fail while others succeed
- **Failed batches can be retried:** The lock is cleared, and re-running processes only pending/failed items
- **Re-importing the same file is safe:** Hashes detect no-change items (intent = "noop")
- **Import approval is enforced:** Cannot publish without approval from field mapping, category mapping, and publication stages
- **Publishing is separate from execution:** Execution writes with status `pending_review`, publish flips to `published`
- **Execution writes to a status-gated column set:** Businesses are created as `pending_review`, not directly `published`

---

## I. Images

### Current Image Architecture

**Source of truth:** `business_images` table with `storage_status` column:
- `external_only` — image is a remote URL, no local copy
- `pending` — queued for processing
- `uploaded` — successfully uploaded to R2
- `failed` — processing failed

**Display chain (`storage.ts`):**
```
r2_url (when storage_status="uploaded") → source_url (http/https) → SVG placeholder
```

**Active provider:** `ExternalOnlyImageStorageProvider` — R2 is NOT active in the image display pipeline. The `storage.ts` file returns `true` for `isConfigured()` and constructs URLs, but `normalize-pipeline.ts` is a passthrough that never actually re-encodes to WebP or uploads to R2.

**R2 infrastructure exists:**
- `r2-adapter.server.ts` — full Cloudflare R2 adapter using AWS Signature V4
- `env.server.ts` — validates R2 environment variables
- `hash.ts` — builds canonical R2 keys: `businesses/{businessId}/{placeId}/{contentHash}.{ext}`
- `image-tick.ts` — worker endpoint that downloads, normalizes, and uploads images (WORKER: claimed next job → downloads from source URL → normalizes → uploads to R2 → updates storage_status)

**Google photo references:**
- Stored in `source_metadata` as JSONB (photo_reference, name, etc.)
- NOT resolved to actual URLs during import (stored as raw references)
- At render time, `source_url` must be a real http/https URL; if only a photo_reference exists, the image falls through to the SVG placeholder
- A comment in `storage.ts` notes this gap: `// TODO: resolve google photo references at render time`

**Cover image selection:**
- Deterministic: first image in the sorted array (by `sort_order`) if `is_cover=true`, else first image
- Import normalization (`normalize.ts`) sets first image as cover: `idx === 0 ? "cover" : "gallery"` with `isCover: idx === 0`
- Database has UNIQUE INDEX on `(business_id) WHERE is_cover=true AND deleted_at IS NULL` — only one cover per business
- The account page uses fallback: `find(i => i.is_cover) ?? [0]`

### Risks

- **Stale Google URLs:** Google Places photo references expire. Images with `source_url` containing Google-signed URLs may break after the URL expires
- **R2 not active:** The image processing worker exists but the pipeline is a passthrough — images never reach R2
- **Duplicate prevention:** `source_fingerprint` (MD5 of source metadata) prevents duplicate image records
- **First image is always cover during import:** Explicitly set in normalization
- **Hardcoded placeholder:** `getBusinessImageUrl` returns a local SVG when no valid URL exists

---

## J. Reviews

### Review Pipeline

**Import behavior:**
- `normalizeReviews` in `normalize.ts`:
  - Accepts arrays from multiple aliases: `reviews`, `reviews_data`, `user_reviews`, `google_reviews`, `reviewsList`
  - Caps at 15 reviews per business (constant `MAX_IMPORTED_GOOGLE_REVIEWS = 15` in the analyze script)
  - Deduplicates via SHA256 fingerprint (`source_fingerprint`)
  - Filters: requires `rating >= 1 && rating <= 5`, requires non-empty `authorName`
  - If no valid reviews, returns empty array (doesn't block business import)
  - Preserves original `reviewLanguage` if available, otherwise detects via `detectLanguage`

**Deduplication:**
- Uses `source_fingerprint` — a SHA256 hash over `(rating, authorName, reviewText, reviewDate)`
- UNIQUE INDEX: `uq_reviews_source_fingerprint_all` on `(business_id, source, source_fingerprint)` — non-partial for PostgREST upsert inference

**Identity key for reviews:**
- `external_review_id` can be used but is not the primary conflict key
- The true conflict key is `(business_id, source, source_fingerprint)` via the upsert index

**Cap enforcement:**
- The analyze script (`scripts/analyze-import-json.mjs`) enforces the 15-review cap
- During import, `normalizeReviews` also caps at 15
- The 15-cap applies per import batch, not per business — a business could accumulate more reviews across multiple imports

**Aggregate rating/review_count:**
- `reprocessBatchReviews` does NOT update `businesses.rating` or `businesses.review_count`
- These columns remain as imported from the source data
- Platform reviews (written by authenticated users via the website) do not update aggregates either

**Author avatars:**
- Stored as `author_avatar_url` on the `reviews` table
- Imported from Google Places (`profile_photo_url` field)
- The ReviewCard component renders author initials as a fallback (no avatar shown if null)

**Review display:**
- `ReviewCard.tsx` shows: author initials avatar, name, date, rating stars, review text, owner reply
- 6 reviews loaded per business on detail page (via `services.reviews.listForBusiness(b.id, 6)`)
- Admin page lists all reviews with status management

---

## K. Dynamic Attributes

### Current Implementation

**Storage:**
- `business_attributes` table: `(business_id, attribute_key, value JSONB, source)`
- `business_services` table: `(business_id, service_key, value JSONB, sort_order)`
- Both are linked to `businesses` via FK

**Attribute schema:**
- No formal attribute definition schema exists in the database
- Attributes are free-form key-value pairs with `key` validated by regex `[a-z0-9_.-]` (max 80 chars, max 200 rows)
- Services have similar free-form structure (name, description, price with max 100 rows)

**Category-specific forms:**
- Do NOT exist — attributes and services are generic across all categories
- The owner portal has generic `Attributes` and `Services` tabs that work identically for any business type

**Import behavior:**
- `normalize.ts` does NOT extract attributes/services from Google Places data
- The `SUGGESTIONS` dictionary in `schema-detector.ts` has no entries for attributes or services
- Imported unknown attributes are silently discarded

**Search:**
- Attributes are NOT searchable via the public search
- The search service does not filter or rank by attributes
- Services are returned as part of the business object but not used in filtering

**Translation:**
- `business_services` have `value JSONB` — translated services are stored in `business_translations.translated_services JSONB`
- There is a concept of translated services but the owner translation UI only handles name/description

**UI display:**
- Business detail page renders `b.services` (card-style list)
- `BusinessCard.tsx` shows first 2 services/attributes
- No attribute-based filtering in search or category pages

---

## L. Public Search

### Search Architecture (Confidence: Confirmed from code)

**Entry points:**
- Homepage search bar → `/$lang/search?q=...`
- `/search` page with filters
- City/category listing pages → `/$lang/$citySlug` etc.
- Suggestion chips → `/$lang/search?q=<label>`

**Search implementation:**
- Server function: `searchPublishedBusinessesFn` in `search.functions.ts` — Zod-validated inputs
- Core service: `searchPublishedBusinesses` in `search-service.server.ts` — builds Supabase query
- Query: `status = 'published'` + ILIKE filters on `name`, `formatted_address`, `slug`
- City filter: resolves slug → city_id → filter
- Category filter: uses RPC `search_business_ids_for_category` → resolves to business IDs; falls back to querying `business_category_links` directly
- Pagination: `range()` with max page size of 48, default 12
- Sorting: recommended (rating × review_count), highest_rated, most_reviewed, recently_added, name

**Hardcoded elements:**
- `FiltersPanel.tsx` uses `CITIES` and `CATEGORIES` from `demo-data.ts` for filter options — NOT live database queries
- `SuggestionChips.tsx` hardcodes 6 search suggestions with specific category/city combinations

**Search results ARE from production database rows:**
- Confirmed: The search service queries `businesses` with `status='published'` and joins other tables
- No hardcoded search results found

**Filter correspondence to DB values:**
- Category filter uses hardcoded demo categories, but the actual filtering uses DB category IDs
- The mismatch means: if a category exists in DB but not in demo-data, it won't appear in filters but its businesses ARE searchable

**Category counts:**
- NOT live — `businessCount` on demo categories is hardcoded (1,284 for restaurants)
- No live count query exists

**City counts:**
- NOT live — hardcoded on demo cities

**Exposure of non-published businesses:**
- All public queries filter `status='published'` — drafts, pending_review, hidden are excluded

**Two untracked migrations:**
- `20260723130000_public_search_performance_indexes.sql` — Adds 12 performance indexes on published businesses, categories, cities. **Without these, public search will work but may be slow on large datasets.** The application code does not REQUIRE these indexes — they are pure performance optimization.
- `20260723140000_search_businesses_matching_category.sql` — Creates `search_business_ids_for_category` RPC. The search service at `search-service.server.ts:226` calls this RPC with a fallback (`if (data) { ... } else { ... fallback ... }`). **Without this RPC, the fallback code path handles category filtering by querying `business_category_links` directly.** The RPC is an optimization, not a requirement.

---

## M. SEO

### Confirmed from code

- **Homepage:** Dynamic title from i18n, OG tags, hreflang, canonical
- **Search pages:** `noindex, follow` robots meta
- **Business pages:** Dynamic title `{name} — {category} · {city}`, JSON-LD LocalBusiness schema, OG image, Twitter card
- **City pages:** Dynamic title `{name} — {brand.name}`
- **Category pages:** Dynamic title `{name} — {brand.name}`
- **City+Category pages:** Dynamic title `{cat} · {city} — {brand.name}`
- **City+District+Category pages:** Dynamic title `{cat} · {dist}, {city} — {brand.name}`
- **Canonical URLs:** Every public route has `canonicalFor()` helper
- **hreflang:** `buildHreflang()` generates 3 locale alternates + `x-default` pointing to Turkish
- **Open Graph:** title, description, type, URL, image on key routes
- **Twitter cards:** `summary_large_image` on business pages
- **Schema.org:** LocalBusiness on detail page, breadcrumbs on listing pages

**Missing/Incomplete:**
- **Sitemap.xml:** NOT found in the codebase — may be served at infrastructure level
- **Robots.txt:** NOT found in the codebase
- **Organization schema:** NOT present on homepage
- **Breadcrumb schema:** NOT present (breadcrumbs are rendered in UI but not as JSON-LD)
- **Pagination indexing:** No `prev`/`next` rel links on paginated search pages

**SEO adapts dynamically:** Yes — city pages resolve from DB, category pages from DB, business pages from DB. Adding a new city or category via admin will automatically create SEO-optimized pages.

---

## N. Hardcoded Inventory

### Cities (6 hardcoded locations)

| City | File | Lines | Used in |
|------|------|-------|---------|
| Istanbul | `demo-data.ts` | 121-135 | FiltersPanel, category pages |
| Antalya | `demo-data.ts` | 136-149 | FiltersPanel, search |
| Ankara | `demo-data.ts` | 150-163 | FiltersPanel, search |
| Bursa | `demo-data.ts` | 164-177 | FiltersPanel, search |
| Izmir | `demo-data.ts` | 178-192 | FiltersPanel, search |
| Trabzon | `demo-data.ts` | 193-206 | FiltersPanel, search |

### Categories (8 hardcoded)

| Category | ID | Slug | Business Count | File:Line |
|----------|----|------|---------------|-----------|
| Restaurants | cat-restaurants | restaurants | 1,284 | demo-data.ts:14-25 |
| Hotels | cat-hotels | hotels | 642 | demo-data.ts:27-37 |
| Clinics | cat-clinics | clinics | 418 | demo-data.ts:39-49 |
| Hospitals | cat-hospitals | hospitals | 96 | demo-data.ts:51-61 |
| Cafes | cat-cafes | cafes | 812 | demo-data.ts:63-73 |
| Attractions | cat-attractions | attractions | 234 | demo-data.ts:75-85 |
| Beauty | cat-beauty | beauty | 356 | demo-data.ts:87-97 |
| Shopping | cat-shopping | shopping | 189 | demo-data.ts:99-109 |

### Search Suggestions (6 hardcoded chips)

| Chip | File | Lines |
|------|------|-------|
| Hotel in Sultanahmet | `SuggestionChips.tsx` | ~30-40 |
| Dental in Basaksehir | `SuggestionChips.tsx` | ~30-40 |
| Family Antalya | `SuggestionChips.tsx` | ~30-40 |
| Balloon Cappadocia | `SuggestionChips.tsx` | ~30-40 |
| Car rental Antalya | `SuggestionChips.tsx` | ~30-40 |
| Restaurant Kadikoy | `SuggestionChips.tsx` | ~30-40 |

### Business Demo Data (8 hardcoded businesses)

| Business | Place ID | File:Line |
|----------|----------|-----------|
| Karaköy Balıkçısı | `ChIJ_p1-DemoRest_01` | demo-data.ts:299-351 |
| Bosphorus Grand Palace | `ChIJ_p1-DemoHotel_02` | demo-data.ts:352-405 |
| Antalya Dental Clinic | `ChIJ_p1-DemoClinic_03` | demo-data.ts:406-457 |
| Kadıköy Kahve Evi | `ChIJ_p1-DemoCafe_04` | demo-data.ts:458-505 |
| Kapalıçarşı Historic Bazaar | `ChIJ_p1-DemoAttr_05` | demo-data.ts:506-549 |
| Çankaya Kebap Sarayı | `ChIJ_p1-DemoRest_06` | demo-data.ts:550-596 |
| Konyaaltı Beach Resort | `ChIJ_p1-DemoHotel_07` | demo-data.ts:597-644 |
| Istanbul Hair Restoration | `ChIJ_p1-DemoClinic_08` | demo-data.ts:645-694 |

### Field Mapping Dictionary (50+ hardcoded suggestions)

Full dictionary in `schema-detector.ts:63-129` — maps Google Places JSON paths to DB columns. Unknown paths are marked `"unsupported"`.

---

## O. Frontend Route Map

| Route | File | Auth | AuthZ | Data Source |
|-------|------|------|-------|-------------|
| `/$lang/` | `$lang.index.tsx` | None | None | DB (categories) |
| `/$lang/search` | `$lang.search.tsx` | None | None | Server function + DB |
| `/$lang/place/$slug` | `$lang.place.$slug.tsx` | None | None | DB query |
| `/$lang/$slug` | `$lang.$slug.tsx` | None | None | DB (category/city) |
| `/$lang/$city/$cat` | `$lang.$citySlug.$categorySlug.tsx` | None | None | DB |
| `/$lang/$city/$dist/$cat` | `$lang.$citySlug.$districtSlug.$categorySlug.tsx` | None | None | DB |
| `/$lang/auth` | Auth route | None | None | Supabase Auth |
| `/$lang/account` | `account.tsx` | Required | Role-based UI | `useAccountState` |
| `/$lang/account/settings` | `account.settings.tsx` | Required | None | Auth metadata |
| `/$lang/account/notifications` | `account.notifications.tsx` | Required | None | DB |
| `/$lang/owner/*` | Owner routes | Required | Owner/manager | `assertOwns` |
| `/$lang/owner/onboarding` | `owner.onboarding.tsx` | Required | None | DB |
| `/$lang/admin/*` | Admin routes | Required | Admin role only | `has_role` RPC |
| `/$lang/admin/imports` | `imports.index.tsx` | Required | Admin | Server functions |
| `/$lang/admin/imports/$id` | `imports.$id.tsx` | Required | Admin | Server functions |

---

## P. Authorization Boundaries

### Confirmed Architecture

**Global roles:** `user_roles` table with `app_role` enum (`user`, `business_owner`, `moderator`, `admin`)
- RLS-protected: users can only see their own roles; admins see all
- `requireAdmin` middleware checks `has_role('admin')` RPC
- Admin bootstrap function `_try_bootstrap_first_admin` is idempotent

**Business authorization:** `business_members` table
- `role`: `owner` or `manager`
- `status`: `pending`, `active`, `revoked`, `suspended`
- UNIQUE: `(business_id, user_id)` WHERE status='active'
- `owner_authz` RPC checks: authenticated → not suspended → has business_owner role → is member → business not deleted
- Legacy fallback: `businesses.owner_id` still exists but `owner_authz` checks `business_members` first

**registration_intent is UI metadata only:**
- Stored on `profiles.registration_intent` (values: `explore` or `business`)
- Used by `useAccountState` to determine `business_prospect` vs `explorer`
- Does NOT grant any access — only determines which UI is shown
- Onboarding is a separate process that creates actual `business_members` on admin approval

**Client-only authorization risks:**
- `PublicHeader.tsx` checks roles client-side for showing/hiding admin/owner links — this is UX-only, the actual server functions enforce authorization
- UI shows/hides buttons based on `useAccountState` but server validates every action
- No client-only authorization is treated as authoritative

---

## Q. Dead Code and Duplication

### Dead/Unused Code

1. **`src/lib/repos/index.ts`** — Demo services exist but `services` alias points to `supabaseServices`. The demo implementations are accessible but not the default.

2. **`src/lib/images/normalize-pipeline.ts`** — Passthrough function that claims to normalize images but does nothing. The R2 upload pipeline is configured but the normalizer is intentionally disabled.

3. **`src/lib/storage/mock-adapter.server.ts`** — In-memory mock for tests.

### Duplication

1. **City lists:** demo-data.ts (6 cities), FiltersPanel.tsx (imports from demo-data), DB cities table
2. **Category lists:** demo-data.ts (8 categories), FiltersPanel.tsx (imports from demo-data), DB categories table
3. **Category aliases:** Only 4 of 8 categories have aliases in parseIntent.ts — the other 4 must be matched by slug or translated name
4. **Field mapping dictionary:** 50+ Google Places paths hardcoded in schema-detector.ts — no mechanism to extend without code change

### Placeholder Admin Screens

- All admin routes appear to be fully implemented (checked in the admin route exploration)
- Some routes may have minimal functionality but none are pure placeholders

---

## R. Risk Register

### Critical Risks

| Risk | Evidence | Impact | Affected Files |
|------|----------|--------|---------------|
| **Hardcoded demo data shadows DB** | FiltersPanel imports from demo-data.ts | Search filters show hardcoded categories/cities, not DB values | `FiltersPanel.tsx`, `demo-data.ts` |
| **R2 inactive despite configured pipeline** | `normalize-pipeline.ts` is passthrough; `image-tick.ts` worker exists but is not producing uploaded images | All images displayed as external URLs; no local backup or processing | `normalize-pipeline.ts`, `image-tick.ts` |
| **Google photo references not resolved** | Stored as raw `photo_reference` in `source_metadata`; no render-time resolution | Images with only Google references display as broken placeholders | `storage.ts`, `imports.functions.ts` |
| **Field mapping not extensible without code** | 50 paths hardcoded in `SUGGESTIONS` dictionary | Unknown fields silently marked "unsupported" | `schema-detector.ts:63-129` |
| **No rollback for partially executed batches** | Items processed individually, no DB transaction | Failed batches leave partial data; manual cleanup required | `imports.functions.ts` (runImportChunk) |

### High Risks

| Risk | Evidence | Impact |
|------|----------|--------|
| **Aggregate rating/review_count never recalculated** | `reprocessBatchReviews` doesn't update `businesses.rating` | Imported rating is frozen; new platform reviews don't affect aggregate |
| **Category businessCount is hardcoded** | Static 1,284/642/418 etc. in demo-data.ts | Category pages display wrong counts |
| **Search filters use hardcoded data** | FiltersPanel imports demo-data.ts | New DB categories/cities invisible in filters |
| **Partial category alias coverage** | Only 4/8 categories in parseIntent.ts | Intent parser cannot match hospitals, attractions, beauty, shopping |
| **Review import cap is per-batch, not per-business** | normalizeReviews caps at 15 per import | Multiple imports can accumulate >15 reviews per business |
| **Import inherits stale Google photo URLs** | No refresh mechanism for Google photo references | Images silently break over time |

### Medium Risks

| Risk | Evidence |
|------|----------|
| No sitemap.xml in codebase | Missing SEO discovery |
| No robots.txt in codebase | Search engine crawling unconfigured |
| No pagination SEO (prev/next) | Paginated search results not linked for crawlers |
| `businessCount` on cities also hardcoded | Static counts on city pages |
| Category alias matching doesn't include Arabic for all | Some aliases missing in parseIntent.ts |
| No formal attribute definition schema | Attributes are free-form without validation |

### Low Risks

| Risk | Evidence |
|------|----------|
| Unused demo data accessible via repo interface | `demo-data.ts` imports in repos/index.ts |
| Legacy `businesses.owner_id` fallback | `owner_authz` checks `business_members` first |
| Commented-out or TODO code scattered | Various TODO comments in import files |

---

## S. Do-Not-Break Boundaries

### Stable Contracts

| Component | Contract | Reason |
|-----------|----------|--------|
| `businesses.place_id` UNIQUE | Import conflict key, FK target | Changing would break ALL imports |
| `import_batches.id` | All import operations reference batch ID | Stable PK across pipeline |
| `owner_authz` RPC signature | All owner server functions depend on it | `(business_id) RETURNS jsonb` |
| `business_member_authz` RPC signature | Team operations depend on it | `(business_id, roles) RETURNS jsonb` |
| `has_role` RPC signature | Admin middleware depends on it | `(user_id, role) RETURNS boolean` |
| `search_business_ids_for_category` RPC | Search service (with fallback) | New migration, but fallback exists |
| `apply_business_change_request` RPC | Owner portal change requests | Complex function with partial approval |
| `submit_business_onboarding_submission` RPC | Onboarding flow | Validates required fields |
| `approve_existing/new_business_onboarding_submission` RPCs | Admin onboarding approval | Transition to published business |

### Migrations That Must Not Be Edited After Deployment

| Migration | Reason |
|-----------|--------|
| `20260722140500_add_business_image_source_fingerprint.sql` | Existing images depend on the fingerprint index |
| `20260722143000_make_review_import_upsert_conflict_inferable.sql` | Existing reviews depend on the upsert index |
| `20260722191000_add_business_members_foundation.sql` | Migrates legacy `owner_id` → `business_members` |
| `20260722192000_approve_claim_creates_business_member.sql` | Changes `approve_ownership_claim` RPC signature |
| `20260722193000_revoke_ownership_revokes_business_member.sql` | Changes `revoke_ownership` RPC signature |
| `20260722200000_atomic_business_onboarding_existing_approval.sql` | Creates approval RPC with specific signature |

### Existing Tests That Protect Behavior

| Test File | Tests |
|-----------|-------|
| `src/lib/import/__tests__/normalizeReviews.test.ts` | Review cap, validity, nested scraper shape |
| `src/lib/import/__tests__/normalizeImages.test.ts` | URL/reference handling, cover selection |
| `src/lib/import/__tests__/schema-detector.test.ts` | Photo reference classification |
| `src/lib/search/__tests__/parseIntent.test.ts` | Intent parsing for 3 languages |
| `src/lib/search/__tests__/search-phase0-phase1.test.ts` | Mojibake, filters, normalization |
| `src/lib/search/__tests__/search-regression.test.ts` | Category matching, chip removal |
| `src/lib/images/__tests__/allowlist.test.ts` | SSRF allowlist |
| `src/lib/images/__tests__/pipeline.test.ts` | Magic bytes, SHA256, image keys |
| `src/lib/translations/__tests__/hash.test.ts` | Translation hash determinism |
| `src/lib/owner/__tests__/field-allowlists.test.ts` | Change request schemas |

### Frontend-Only Safe Changes

- Search filter UI (use DB queries instead of demo data)
- Category shortcut display (use DB instead of hardcoded)
- Suggestion chips (make dynamic from popular searches)
- SEO meta tags (improve titles/descriptions)
- Business card display (change layout without affecting data)
- Account page layout (already modified per previous task)

---

## T. Recommended Remediation Phases

### Phase 1 (Frontend Only — Low Risk)
1. Replace `FiltersPanel.tsx` demo-data imports with live DB queries via `services.categories.list()` and `services.cities.list()`
2. Add missing category aliases in `parseIntent.ts` for hospitals, attractions, beauty, shopping (all 3 languages)
3. Make `SuggestionChips.tsx` data-driven or remove hardcoded values
4. Add `prev`/`next` pagination SEO links

### Phase 2 (Backend Code — Medium Risk)
1. Add RPC or query to compute live `businessCount` per category and city
2. Add RPC or trigger to recalculate `businesses.rating` and `businesses.review_count` from actual reviews
3. Add render-time Google photo reference resolution (convert `photo_reference` to a real image URL)
4. Make field mapping suggestions extensible (DB-driven instead of hardcoded dictionary)

### Phase 3 (Migration — High Risk)
1. Enable R2 image processing pipeline (activate `normalize-pipeline.ts`)
2. Add backfill migration for existing images to populate `source_fingerprint`
3. Add sitemap.xml generation route

### Phase 4 (Data Cleanup)
1. Remove/archive demo data from `demo-data.ts` once production data exists
2. Add validation to prevent review cap bypass across multiple imports
3. Add rollback capability for failed import batches

---

## U. Files Inspected

Complete list of files read during this audit (available on request — approximately 60+ files across migrations, routes, components, server functions, utilities, tests, and fixtures).

Key directories inspected:
- `supabase/migrations/` — All 35 migration files
- `src/routes/` — All public, account, owner, admin, and API route files
- `src/lib/admin/` — All server functions (imports.functions.ts, domain.functions.ts, admin.functions.ts, require-admin.middleware.ts)
- `src/lib/owner/` — All server functions and authz
- `src/lib/import/` — format.ts, normalize.ts, preview.ts, schema-detector.ts
- `src/lib/search/` — search-service.server.ts, search.functions.ts, parseIntent.ts, search-filters.ts, search-url-state.ts
- `src/lib/repos/` — demo-data.ts, supabase-repos.ts, index.ts, types.ts
- `src/lib/images/` — All 9 files (allowlist, download, hash, magic-bytes, normalize-pipeline, queue.functions, storage)
- `src/lib/translations/` — All 6 files
- `src/lib/i18n/` — index.ts, messages.ts
- `src/hooks/` — use-auth.tsx, use-account-state.ts
- `src/components/` — PublicHeader, AdminShell, OwnerShell, search components, business components
- `src/integrations/supabase/` — client.ts, client.server.ts, auth-middleware.ts, auth-attacher.ts, types.ts
- `src/types/` — domain.ts
- `scripts/` — analyze-import-json.mjs

---

## V. Commands Run

- `git status`
- `git log --oneline -10`
- `git branch --show-current`
- Various `cat`, `find`, `grep`/`Select-String` equivalent operations via tooling
- TypeScript type-check: `npm run typecheck` (PASS)
- Production build: `npm run build` (PASS)
- Tests: `npm test` (72 tests, 11 files, all PASS)

---

## W. Uncertainties and Items Requiring Live Database Verification

1. **Whether R2 is actually provisioned** — The code checks for env vars but `normalize-pipeline.ts` is passthrough. Needs verification against deployed environment variables.
2. **Whether the image-tick worker is deployed** — The cron endpoint exists at `api/public/hooks/image-tick.ts` but may not be registered as a scheduled function.
3. **Whether Google photo references resolve at all in production** — If `source_url` is always populated during import, photo references may not be an issue. Needs production data inspection.
4. **Whether the demo-data is actually rendered in production** — The `services` object uses `supabaseServices` but if Supabase is not connected or returns empty results, the hardcoded demo data becomes visible. Needs production URL checks.
5. **Whether `businessCount` on categories/cities is ever updated** — No code path updates it. Could be manually set via admin panel. Needs DB check.
6. **Whether category slug resolution succeeds for all 8 categories** — The intent parser only has aliases for 4. The remaining 4 rely on slug or translated name matching. Needs testing with real queries.
7. **Whether the search performance indexes are actually needed** — Without the 2 untracked migrations, search works but performance may degrade. Needs load testing.
8. **Which Supabase project is actually connected** — `project_id = "gmijqlcwweceebucvcjd"` in `config.toml`. Needs confirmation this is the correct project.
9. **Whether actual production data exists** — The audit assumes a relatively new project. If production has real data, the hardcoded demo data is a larger concern.
10. **Whether the import pipeline has been used successfully** — Needs log/audit inspection to confirm the pipeline produces correct output.

---

## Verification Confirmation

- **No files modified:** Confirmed — all reads only
- **No SQL executed:** Confirmed — no database interaction
- **No database accessed or mutated:** Confirmed
- **No commit created:** Confirmed — current HEAD: `693273c`
- **No push performed:** Confirmed
- **No deployment performed:** Confirmed
- **Two untracked migration files remain unchanged:**
  - `supabase/migrations/20260723130000_public_search_performance_indexes.sql`
  - `supabase/migrations/20260723140000_search_businesses_matching_category.sql`
