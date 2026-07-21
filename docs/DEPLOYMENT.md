# Deployment Guide — TurkeyDirect

Lovable Cloud (managed Supabase) + Cloudflare R2 (image storage) + TanStack Start on Cloudflare Workers.

---

## 1. Environment variables

All secret values live in Lovable Cloud secrets. `.env` only holds public config.

### Auto-managed (do not edit)

- `SUPABASE_URL`, `VITE_SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PROJECT_ID`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `SUPABASE_DB_URL` (server-only)
- `LOVABLE_API_KEY`

### R2 (must be provided before Phase 4 image pipeline goes live)

Names below are the canonical names already referenced by `src/lib/storage/env.server.ts`. Reuse these exact names — do not introduce duplicates.

| Name | Purpose |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 S3 access key |
| `R2_SECRET_ACCESS_KEY` | R2 S3 secret |
| `R2_BUCKET_NAME` | Bucket for processed images |
| `R2_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` |
| `R2_PUBLIC_URL` | Public base URL used by `BusinessImage` |
| `R2_ACCESS_MODE` | `public` or `signed` |
| `IMAGE_WORKER_SECRET` | Shared secret accepted by `/api/public/hooks/image-tick` |

Until every R2 variable is set, the image pipeline runs in **fallback mode** (`BusinessImage` shows the placeholder / original source URL). The worker will not upload to R2 and will refuse to advance jobs from `pending` to `succeeded`.

---

## 2. Migration order

Migrations live under `supabase/migrations/` and run in filename order. **Never revert an applied production migration** — write a forward corrective migration instead. Restoring from backup is emergency-only.

The canonical order applied to this project:

1. **M1** — Core schema (countries, cities, districts, categories, translations, businesses, images, hours, services, attributes, reviews, favorites).
2. **M2** — Roles (`app_role` enum, `user_roles`, `profiles`, `has_role`, `handle_new_user`).
3. **M3** — Admin RPCs (`bootstrap_admin`, `approve_ownership_claim`, `set_user_role`, `record_audit`, `audit_logs`, `ownership_claims`, `site_settings`, `reports`).
4. **M4** — Import pipeline (`import_batches`, `import_batch_items`, `translation_jobs`, `field_sources`, `popular_times`).
5. **Image pipeline** — `image_processing_jobs`, `claim_next_image_jobs`, `reap_stale_image_jobs`.
6. **M5 (Owner Portal)** — `business_change_requests.request_type`, `owner_authz`, `apply_business_change_request`, `revoke_ownership`, `owner_notifications`, `review_replies`.
7. **Phase 6** — `security.initial_admin_bootstrapped` flag, `_try_bootstrap_first_admin`, `handle_user_email_confirmed` trigger.

---

## 3. First-user admin bootstrap

Once the database is migrated, the **first email/password user to confirm their email automatically receives the `admin` role**. The flag `security.initial_admin_bootstrapped` flips to `true` inside the same transaction that grants the role.

- OAuth-only signups do not trigger bootstrap.
- Deleting the first admin does **not** reset the flag.
- To recover a locked-out project, use the manual `bootstrap_admin(<user_id>)` RPC as a service-role SQL statement.

---

## 4. Image worker — trust model (as implemented)

Endpoint: `POST /api/public/hooks/image-tick`

- **Accepted credential**: `Authorization: Bearer <IMAGE_WORKER_SECRET>` header (also accepted via `x-image-worker-secret` for legacy callers).
- **Validation**: constant-time compare against `process.env.IMAGE_WORKER_SECRET`. Missing secret returns `503 Blocked by configuration`. Invalid secret returns `401`.
- **Caller**: pg_cron job (Scheduler A) invoked via `pg_net.http_post` using the service role's URL and the worker secret loaded from Vault. Only the database has the secret; the browser never sees it.
- **Scheduler flow**: pg_cron runs every minute → `pg_net.http_post` to the endpoint → handler calls `claim_next_image_jobs` (SECURITY DEFINER, service-role-only) → processes up to N jobs → returns 200 with counters.
- **Failure response**: JSON `{ ok: false, error: "..." }` with 4xx/5xx status; the scheduler retries on the next tick. Stale leases are reaped by `reap_stale_image_jobs()`.

**Do not add a second authentication mechanism.** The single bearer-secret path is the trust boundary.

---

## 5. R2 bucket setup

1. Create bucket named `${R2_BUCKET_NAME}` in the Cloudflare account matching `R2_ACCOUNT_ID`.
2. Enable public access if `R2_ACCESS_MODE=public`; otherwise configure signed URL generation.
3. CORS: allow the deployed app origin for `GET, HEAD`. Uploads happen server-side via S3 API, so no browser CORS is needed for `PUT`.
4. Object-key format is deterministic: `businesses/{business_id}/{sanitized_place_id}/{sha256}.webp`. This is intentional and documented in `docs/IMAGE_WORKER.md`.

---

## 6. Cron / scheduler

- The image worker requires a minute-cadence cron. Use pg_cron in the Supabase project:
  ```sql
  select cron.schedule('image-tick', '* * * * *',
    $$ select net.http_post(
         url := 'https://<production-host>/api/public/hooks/image-tick',
         headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='image_worker_secret'))
       ); $$);
  ```
- Stale-lease reaper can be a separate 5-minute cron calling `select public.reap_stale_image_jobs();`.

---

## 7. OAuth (Google)

- Enable Google in `Cloud → Auth → Providers`.
- Redirect URI: the production origin, e.g. `https://turkeydirect.com`. Never point at a protected route.

---

## 8. Custom domain / DNS

1. Publish the project via Lovable → confirm the `.lovable.app` URL works.
2. In Project → Domains, add the custom domain.
3. Add the CNAME record shown in the Domains UI at the DNS provider.
4. Wait for propagation, then verify HTTPS.

---

## 9. Rollback & recovery (forward-safe)

**Priority order — do the least-destructive thing first.**

1. **Redeploy previous frontend build.** Every published deploy is retained; roll back from Project → Deployments. This reverts UI + server functions to a known-good state without touching data.
2. **Disable workers / cron.** If a background job is misbehaving, disable the pg_cron entry:
   ```sql
   select cron.unschedule('image-tick');
   ```
   This stops damage without altering rows.
3. **Forward corrective migration.** For a bad schema or data state, write a new migration that fixes the state going forward. Never `DROP` or automatically revert an applied production migration — it can destroy or invalidate data.
4. **Database restoration — emergency only.** If corruption is unrecoverable via forward correction, restore from the most recent point-in-time backup (Supabase daily backups, retained by plan). This is destructive to writes made after the restore point; use only when necessary.

---

## 10. Backup plan

- Supabase managed daily backups are enabled by default; verify retention on the project's plan.
- For structured exports, use Lovable Cloud → Advanced settings → Export data.
- Store R2 bucket lifecycle rules with 30-day versioning to protect against accidental object deletion.

---

## 11. Deployment checklist

1. All migrations applied through the current head.
2. All required secrets present (see §1).
3. `bunx tsgo --noEmit` and `bunx vitest run` green locally.
4. Production build succeeds (`bun run build`).
5. First-user admin bootstrap verified in a staging project.
6. Google OAuth provider enabled and tested.
7. pg_cron scheduled for image worker (only after R2 credentials land).
8. Custom domain + HTTPS verified.
9. First admin has signed up and confirmed email.
10. Monitoring: audit logs page reachable, error reporting connected.
