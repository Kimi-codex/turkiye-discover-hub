# Phase 3 & 4 — Corrected Implementation Plan

All 25 corrections incorporated. Execute Phase 3 fully, verify, fix, then Phase 4. Stop before Phase 5.

---

## Cross-cutting security rules (apply everywhere)

- **Admin authorization is server-side.** Every admin route loader calls a `requireAdmin` server fn (chained: `requireSupabaseAuth` → verify `has_role(auth.uid(),'admin')` via authenticated `context.supabase`). Loader returns 401/403 (thrown Response) before any admin data. Admin UI shell only mounts inside `_authenticated/admin/route.tsx` whose loader has already verified admin — no privileged content is rendered before verification. Client `useAdmin()` hook is UX-only.
- **Every admin server fn independently** calls the same admin middleware. No "trust the layout."
- **SECURITY DEFINER minimalism.** Do NOT create `is_admin()`. Reuse `has_role(auth.uid(),'admin')`. Any new SECURITY DEFINER fn: fixed `search_path`, `REVOKE EXECUTE FROM PUBLIC`, `GRANT EXECUTE TO service_role` (and `authenticated` only when the fn internally re-checks caller), validates caller inside, does the smallest possible thing. No public `write_audit_log` — audits are written *inside* privileged RPCs / server fns using `supabaseAdmin` (loaded via `await import()` inside handler) or a SECURITY DEFINER RPC that takes fixed args and is only callable by service_role.

---

## PHASE 3 — Admin & Google JSON Import

### 3A. Schema inspection first, then migration

Before writing SQL: run `psql` reads to dump current columns/constraints for `category_mappings`, `businesses`, `business_images`, `reviews`, `ownership_claims`, `import_batches`, `import_batch_items`, `audit_logs`, `reports`. Reuse existing column names (correction #9). If `category_mappings.category_id` exists, keep it — do NOT add `mapped_category_id`. Same for existing status enums.

**Single migration** adds only what's missing:

- **audit_logs**: ensure columns actor_user_id, action, entity_type, entity_id, before_data jsonb, after_data jsonb, metadata jsonb, created_at. RLS: admin SELECT only via `has_role`. INSERT allowed only to `service_role` (no policy for authenticated).
- **import_batches**: extend with file_hash, source_provider, storage_object_path, valid/invalid/inserted/updated/duplicate/skipped/failed/needs_mapping counters, started_at, completed_at, error_message, import_options jsonb, processing_lock_at, processing_lock_by. Status enum `uploaded|analyzing|ready|importing|completed|partially_completed|failed|cancelled`.
- **import_batch_items**: extend per spec. Unique(batch_id, item_index). Indexes on (batch_id,status), place_id.
- **category_mappings**: reuse existing column names; add only missing (`normalized_source_category`, `status`, `usage_count` if absent). Unique(source_provider, normalized_source_category).
- **businesses**: add `source_updated_at timestamptz`, `raw_data jsonb`, `field_sources jsonb`. Do NOT change existing RLS.
- **reviews**: add `source_fingerprint text` (correction #11). Partial unique indexes:
  `UNIQUE(business_id, source, external_review_id) WHERE external_review_id IS NOT NULL`
  `UNIQUE(business_id, source, source_fingerprint) WHERE source_fingerprint IS NOT NULL`
- **ownership_claims**: ensure evidence + admin_notes exist.
- **Atomic RPCs** (SECURITY DEFINER, locked to `service_role` EXECUTE):
  - `approve_ownership_claim(claim_id, actor uuid)` — corrections #4: `SELECT ... FOR UPDATE` on claim, verify pending, verify no other active owner, set `businesses.owner_id`, `INSERT INTO user_roles (business_owner)`, update claim status, insert audit row — all in one txn.
  - `set_user_role(target uuid, role app_role, add bool, actor uuid)` — corrections #5: locks role rows, blocks self-role-change unless `actor != target` is false AND explicit escalated flag, blocks removing the last remaining admin using a locked recount (`SELECT count(*) FROM user_roles WHERE role='admin' FOR UPDATE`), inserts audit row.
  - `bootstrap_admin(target uuid)` — corrections #22: usable only when zero admins exist; otherwise raises. Not called from committed migration. Invoked manually once via psql after user creates their account.

Grants: every new table `GRANT SELECT,INSERT,UPDATE,DELETE ... TO service_role` + admin RLS. No anon grants.

### 3B. Admin server auth

Files:
- `src/lib/admin/require-admin.middleware.ts` — server middleware factory using `requireSupabaseAuth`, then `.rpc('has_role', {_user_id, _role:'admin'})`; throws `new Response('Forbidden', {status:403})` on failure.
- `src/lib/admin/admin-guard.functions.ts` — `getAdminGate()` server fn used by admin route loader; returns `{ok:true}` or throws 401/403. Loader awaits before UI mounts.

### 3C. Admin routes

`src/routes/$lang/_authenticated/admin/` — `route.tsx` (loader awaits `getAdminGate`, renders `<AdminShell>` around `<Outlet/>`), `index.tsx`, `businesses.tsx`, `businesses.$id.tsx`, `imports.tsx`, `imports.new.tsx`, `imports.$batchId.tsx`, `categories.tsx`, `category-mappings.tsx`, `cities.tsx`, `users.tsx`, `reviews.tsx`, `owner-requests.tsx`, `reports.tsx`, `translations.tsx` (stub), `settings.tsx`, `audit-logs.tsx`, `images.tsx` (Phase-4 filled).

### 3D. Admin UI shell

`src/components/admin/*` — `AdminShell`, `AdminSidebar`, `AdminHeader`, `Breadcrumbs`, `AdminDataTable`, `PermissionDenied`, empty/loading/error states. tr/en/ar strings under `admin.*`. Existing design tokens, no new template.

### 3E. Dashboard

`getAdminOverview` server fn (chained middleware) — uses `count:'exact',head:true`. Real counts only. Recent-activity queries with explicit selects + `limit(10)`.

### 3F–I. Admin CRUD

Business/category/city/mapping/moderation/user server fns, each with `requireAdmin` middleware. Bulk ops write audits inside their RPCs.

**Users admin (correction #2):** `listUsersAdmin` uses `supabaseAdmin.auth.admin.listUsers()` (paginated), joined with `profiles` and `user_roles`; returns only display-safe fields (email, created_at, last_sign_in_at, id, roles). `suspendUser`, `deleteAuthUser` use `supabaseAdmin.auth.admin.updateUserById / deleteUser`. Role mutations go through `set_user_role` RPC. All audited. `supabaseAdmin` imported lazily inside handlers (`await import('@/integrations/supabase/client.server')`).

**Ownership approval (correction #4):** calls `approve_ownership_claim` RPC via `context.supabase.rpc` (RPC is SECURITY DEFINER; we still gate the RPC caller by admin middleware in the wrapping server fn — the RPC additionally re-checks `has_role(actor,'admin')` inside).

### 3J. Import pipeline

**Uploads (corrections #7, #8):** private Supabase Storage bucket `imports` (created via `supabase--storage_create_bucket`, public=false). If bucket creation is blocked, surface a hard configuration error — no base64 fallback. Object key: `imports/{batch_id}/{sha256}.json`. Max size 50MB, MIME `application/json` or `application/zip`. Client uploads via short-lived signed upload URL generated by `createImportUpload` server fn. Retention: delete after `completed` (30 days) or `cancelled/failed` (7 days) via nightly pg_cron calling a private admin endpoint.

**Processing (correction #6):** create a Supabase Edge Function `import-worker` (existing edge-fn infra; the "no new edge fns" rule permits maintaining existing image/etc. — here we consciously reuse only if one exists; else document as limitation and use pg_cron+pg_net polling `/api/public/import-tick` protected by anon `apikey` header per schedule-jobs pattern). The processor:
- Claims one batch with atomic `UPDATE import_batches SET status='importing', processing_lock_at=now(), processing_lock_by=$w WHERE id=$b AND status IN ('ready','importing') AND (processing_lock_at IS NULL OR processing_lock_at < now()-'5 min') RETURNING *`.
- Streams the JSON from Storage (never fully buffered client-side), processes items in chunks of 50, persists per-item status after each chunk, releases lock at end. Idempotent via unique(batch_id, item_index) + per-item guarded status transition.
- Resumable: on restart, continues where `status='pending'|'processing'`.

The client polls `getBatchStatus` every 2s during import. No fire-and-forget promises in request handlers.

**Normalization & validation:** `src/lib/import/{detect-format,extract-items,normalize-google-place,validate}.ts`; normalizers folder per spec; fixtures under `src/lib/import/__fixtures__/`.

**Rules:** place_id canonical; missing → invalid; dup in-file → first wins; unknown category → row in `category_mappings` (pending) + item action `needs_mapping`; city resolution: translations → district → address → warn/error; reviews dedupe by external_review_id or `source_fingerprint = sha256(normalize(author||date||text))` (correction #11); default business status `pending_review`; image rows only (Phase 3), `storage_status='external_only'`, dedupe by (business_id, source_url), place_id stamped.

**Precedence (correction #10):** `field_sources jsonb` per business, shape `{name:{source:'admin'|'owner'|'google', updated_at}}`. Import updates a field only when existing source is null/`google`/`import` AND incoming `source_updated_at >= existing.updated_at`. Fields `featured, verified, owner_id, status, primary_category_id`, approved translations, admin/owner-written description NEVER auto-overwritten. Documented in `src/lib/import/PRECEDENCE.md`.

### 3K. Audit logging

Every mutation server fn writes an audit row within its transaction using the authenticated `context.supabase` (RLS allows service_role only — so the actual insert happens via a dedicated SECURITY DEFINER RPC `record_audit(action, entity_type, entity_id, before, after, meta)` that internally re-checks `has_role(auth.uid(),'admin')` before inserting — correction #3). No public/authenticated INSERT policy.

### 3L. Phase 3 verification

Scripts under `/tmp/browser/phase3/`:
- SQL: seed 3 users, direct RLS probes (anon/authenticated/admin), RPC-forgery attempts.
- Playwright: login as each role, assert route access matrix, 403 responses on direct RPC.
- Fixtures: `valid.json`, `missing-place-id.json`, `dup-place-id.json`, `unknown-category.json`, `mixed.json`, `not-json.txt`, `oversize.json`.
- `bunx tsgo` and `bun run build`.
- Categorize each of the 24 checklist items as Passed / Failed / Not-executed / Blocked.

Fix all failures before Phase 4.

---

## PHASE 4 — Image Pipeline + R2

### 4A. Configuration (correction #24)

Implement full scaffolding (storage abstraction, migrations, queue, admin UI, mock tests, `getR2Status` reporting `configured:false`) without R2 secrets. Ask for secrets only when scaffolding is ready. Required (server-only, added via `add_secret`): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_PUBLIC_URL` (validated — correction #21), optional `R2_UPLOAD_CONCURRENCY`, `R2_MAX_IMAGE_BYTES`, `R2_DOWNLOAD_TIMEOUT_MS`.

### 4B. Storage abstraction

`src/lib/storage/object-storage.ts` (interface), `r2.server.ts` (S3-compatible via `@aws-sdk/client-s3`), `mock.server.ts`, `index.server.ts` (factory).

**R2 URL policy (correction #21):** if `R2_PUBLIC_URL` set + validated → store `r2_url = ${R2_PUBLIC_URL}/${r2_key}`. If not → store only `r2_key`, resolver generates short-lived signed URLs server-side per request; the public resolver never returns raw private-signed URLs to search-engine-visible SSR without cache headers matching TTL.

### 4C. Runtime spike (correction #14) BEFORE choosing library

Spike script `/tmp/browser/phase4/spike-image.mjs` runs in the Cloudflare Workers-compatible runtime (via `wrangler dev` if available, else against the deployed preview): tries `@cf-wasm/photon` first — decode JPEG/PNG, EXIF rotate, resize to 2000px, encode WebP, measure memory + time. If it fails, tries `wasm-image-optimization`. Whichever passes is the sole choice. Document runtime, package version, memory ceiling, max pixels (e.g. 24 Mpx), max input bytes (15 MB), timeout budget (10 s) in `src/lib/images/IMAGE_RUNTIME.md`. No unverified fallback in production path.

### 4D. Migrations

`business_images` add: `content_hash`, `content_type`, `file_size`, `retry_count int default 0`, `next_attempt_at timestamptz` (correction #17), `last_attempt_at`, `uploaded_at`, `error_message`. Status enum extended.

**Cover unique index (correction #19):** migration first deduplicates existing multi-cover rows deterministically (`ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY sort_order, created_at)` → keep row 1 as cover), then creates `CREATE UNIQUE INDEX ON business_images (business_id) WHERE is_cover = true`.

**Image dedupe (correction #20):** partial unique `(business_id, content_hash) WHERE content_hash IS NOT NULL AND storage_status='uploaded'` — after cleanup of existing dupes. Deletion semantics: R2 delete only allowed when the row is the sole active reference to the r2_key (checked in RPC).

**Public view (correction #12):** `CREATE VIEW public.business_images_public WITH (security_invoker = true) AS SELECT id, business_id, place_id, r2_url, source_url, storage_status, image_type, is_cover, sort_order, width, height, alt FROM public.business_images WHERE business_id IN (SELECT id FROM businesses WHERE status='published')`. `REVOKE ALL ON business_images FROM anon, authenticated`; existing public read policies on `business_images` are dropped. `GRANT SELECT ON business_images_public TO anon, authenticated`. Admin & owner queries hit the base table via `supabase` under admin/owner RLS policies.

`image_processing_jobs` table per spec + `next_attempt_at`. Indexes on (status, next_attempt_at), business_id, locked_at.

RLS: base table admin-only mutate; jobs admin-only.

### 4E. Processing worker (correction #13, #16, #18)

**Primary path:** Supabase Edge Function `image-worker` (existing infra — one of the pre-existing edge fns Lovable Cloud allows). Triggered by:
- pg_cron every minute calling `supabase.functions.invoke('image-worker')` OR the documented Lovable Cloud scheduled invocation. **Secret handling:** function auth uses Supabase's built-in service-role verification via `verify_jwt=true`; pg_cron invokes with `apikey` header set to the anon key using standard `net.http_post` — NOT with `IMAGE_WORKER_SECRET`. No secret in migration SQL, no `IMAGE_WORKER_SECRET` created.
- Admin "Process queue" button (server fn calling `supabase.functions.invoke`).

If existing edge-fn infra is unavailable in this project, we document the limitation clearly, admin manual trigger is the only production path, and cron scheduling is deferred (correction #16 explicit).

**Atomic claim (correction #18):** SECURITY DEFINER RPC `claim_image_jobs(worker_id text, batch_size int)`:
```
UPDATE image_processing_jobs SET status='processing', locked_at=now(), locked_by=worker_id,
  started_at=now(), attempt=attempt+1
WHERE id IN (
  SELECT id FROM image_processing_jobs
  WHERE status IN ('pending','failed')
    AND (next_attempt_at IS NULL OR next_attempt_at <= now())
    AND (locked_at IS NULL OR locked_at < now()-'5 min')
    AND attempt < 5
  ORDER BY next_attempt_at NULLS FIRST
  FOR UPDATE SKIP LOCKED
  LIMIT batch_size
) RETURNING *;
```
Only `service_role` may EXECUTE.

**Per-job pipeline:**
1. Identity check: image_row.place_id == business.place_id AND row.business_id == job.business_id. Mismatch → status `invalid`, audit, halt.
2. SSRF-safe fetch (correction #15) — see 4F.
3. Body validation: magic bytes; reject SVG/HTML/exec; enforce max bytes streaming; pixel-count guard.
4. Normalize via chosen WASM lib.
5. SHA-256 hash.
6. Dedupe: skip upload if same (business_id, hash) already uploaded and `HEAD` of `r2_key` succeeds.
7. Upload with correct content-type, Cache-Control `public, max-age=31536000, immutable`, metadata {business_id, place_id}.
8. Update row atomically; audit.
9. On error: classify. Retryable → set `next_attempt_at = now() + expo_backoff(attempt)` (30s, 2m, 8m, 32m, 2h), status back to `pending`. Permanent (invalid_source, mismatch, oversized, unsupported, 404 confirmed) → `failed` no retry unless admin forces.

### 4F. SSRF + DNS rebinding (correction #15)

`src/lib/images/ssrf-fetch.server.ts`:
- **Trusted host allowlist** for imported Google images: `*.googleusercontent.com`, `*.ggpht.com`, `maps.gstatic.com`, `lh3.googleusercontent.com` etc. Non-allowlisted hosts on Google-import path are rejected outright. Admin-added URLs go through full SSRF checks but no allowlist bypass.
- For any allowed host: resolve DNS (`dns.promises.lookup(host,{all:true})`), reject if any resolved IP is loopback/private/link-local/metadata; then re-fetch to the same host — since the runtime does not support IP-pinned fetch, we mitigate rebinding by (a) allowlist for Google, (b) response `Host` verification, (c) redirect count max 3 with each hop revalidated (manual redirect follow), (d) documenting residual risk in `src/lib/images/SSRF_NOTES.md`.
- Redirects: `redirect:'manual'`, each Location URL re-validated.
- Timeouts: connect 5s, total 15s. Max bytes 15MB (stream cutoff via `AbortController`).
- No creds-in-URL, no non-http(s), no punycode weirdness.

### 4G. URL resolver

Keep `getBusinessImageUrl` canonical. Add `<BusinessImage>` component with `onError` fallback (r2→source→placeholder). Wire into all existing image consumers **without layout changes**. Public path uses `business_images_public` view (correction #12) — never reads internal error/retry fields.

### 4H. Image admin page

Full filters/columns/actions/bulk per spec. All mutations via admin server fns. Delete-cover selects next by sort_order or shows placeholder.

### 4I. Import ↔ image queue

Import option `queue_images_for_r2` default false. When true: after business upsert, insert rows into `image_processing_jobs` for new image rows. Import completes regardless of image job outcomes.

### 4J. Admin R2 settings

`getR2Status` returns `{configured, bucket, publicUrl, lastUploadAt, lastFailure}` — no secrets. Connectivity test button: server fn does HEAD `bucket` + 1-byte PUT/DELETE at `_healthcheck/${uuid}`.

### 4K. Phase 4 verification

Scripts under `/tmp/browser/phase4/`:
- Grep production build (`.output/server/**`, `dist/**`) for R2 secret substrings — must be absent.
- Local Python fixture server: valid JPEG/PNG, HTML-as-image, oversized, unsupported, timeout, redirect-to-private-ip.
- Direct localhost/private IP URLs → rejected.
- Business/place mismatch fixture → rejected + audit.
- Dedupe: run same job twice → single R2 object.
- Cover uniqueness violation attempt → DB rejects.
- Anon RLS probe on `business_images` internal columns → denied.
- Anon SELECT on `business_images_public` → allowed, safe fields only.
- Owner attempt to UPDATE `r2_key` → denied.
- Admin queue/retry via UI → succeeds.
- **Deployed-runtime tests (correction #23):** after R2 secrets provided, run image pipeline against deployed preview (`project--{id}-dev.lovable.app`): real download, real R2 upload, real render. R2 HEAD/GET of uploaded object confirms bytes.
- 32-item checklist categorized Passed/Failed/Not-executed/Blocked.

If R2 secrets not supplied by user, categorize all R2 connectivity items as **Blocked by configuration** — do NOT fake pass (correction #25).

---

## Completion report (correction #25)

Two separate reports (Phase 3, Phase 4) with:
- Routes / components / migration files / tables modified / RLS changes.
- Rules implemented (auth, precedence, dedupe, SSRF, retry, concurrency).
- Every verification item: Passed / Failed / Not-executed / Blocked-by-configuration.
- For each Passed security-critical item: method (SQL/RLS probe, server-fn HTTP, browser, deployed worker, R2 HEAD/PUT/GET).
- Explicit security-test matrix from the user's list.
- Known limitations.

## Confirmed out of scope

Owner dashboard, owner self-edit, translation AI, review translation, analytics, notifications, payments, booking.

## Immediate next actions (build mode)

1. Read live schema for the 9 affected tables via psql.
2. Confirm whether an existing Edge Function slot is available for `import-worker` / `image-worker` (else document limitation).
3. Confirm whether private Storage bucket creation is permitted in this workspace (else block imports with a clear config error).
4. Start Phase 3A migration.

Will pause and prompt the user only for: admin bootstrap user UUID (correction #22), and R2 secrets when Phase 4 scaffolding is ready (correction #24).
