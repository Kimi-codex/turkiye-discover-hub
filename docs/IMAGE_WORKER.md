# Image processing worker

## Architecture

Remote source images (Google Places, external manual) are fetched, normalized, and
stored in Cloudflare R2 by a **pull-based worker** running behind the TanStack
server route `POST /api/public/hooks/image-tick`.

The route is under `/api/public/*`, so the platform edge auth is bypassed. The
route handler enforces authentication itself by requiring the Supabase
service-role JWT as the `apikey` (or `Authorization: Bearer`) header. There is
**exactly one** accepted credential — nothing else authorises the tick endpoint.

## Scheduling (Design A — pg_cron + Vault)

The service-role key is stored in Supabase Vault (never in `cron.job`
definitions, never in code). A wrapper SECURITY DEFINER function reads it at
call time and posts to the tick endpoint via `pg_net`:

```sql
-- one-time, admin-only bootstrap:
select vault.create_secret('<SERVICE_ROLE_JWT>', 'image_worker_service_role');

create or replace function public._trigger_image_tick()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets
    where name = 'image_worker_service_role';
  if v_key is null then raise exception 'service role not in vault'; end if;
  perform net.http_post(
    url := 'https://<project>--<id>.lovable.app/api/public/hooks/image-tick',
    headers := jsonb_build_object('apikey', v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;
revoke all on function public._trigger_image_tick() from public, anon, authenticated;

select cron.schedule('image-tick-every-minute', '* * * * *', $$ select public._trigger_image_tick() $$);
```

Only the `postgres` role executes the wrapper (cron owner), so callers can never
observe or exfiltrate the service-role key.

## Failure semantics

- **R2 not configured** — tick returns `configured: false, claimed: 0` and
  does NOT touch jobs or `business_images`. Retry counters stay untouched
  until real credentials are provided.
- **Transient errors** (HTTP 5xx, timeouts, DB update failures) — job goes to
  `retry`, `next_run_at` is set with exponential backoff (2^attempt minutes,
  capped at 30m). `business_images.storage_status` reverts to `pending`.
- **Terminal errors** (allowlist violation, unsupported content type,
  attempts exhausted) — job marked `failed`, image marked `failed` with a
  stable `error_code` (e.g. `URL_NOT_ALLOWED`, `TOO_LARGE`,
  `UNSUPPORTED_TYPE`, `HTTP_ERROR`).

Failed jobs surface in the admin **Images** page; admins can retry them.

## Idempotency

- The claim RPC uses `FOR UPDATE SKIP LOCKED` so parallel invocations never
  double-process a row.
- `image_processing_jobs` has a partial unique index on `business_image_id`
  for active statuses (`pending | processing | retry`), so enqueue is
  duplicate-safe.
- R2 keys are derived from the SHA-256 of normalized bytes, so
  re-processing identical content is a byte-identical PUT.

## What the worker deliberately does NOT do yet

- WebP re-encoding and EXIF orientation correction. The pipeline structure is
  in place (`src/lib/images/normalize-pipeline.ts`); the WASM encoder is
  postponed until a runtime spike verifies decode/encode inside the deployed
  edge runtime with real orientation fixtures.
- Derivative sizes (`1600`, `800`, `400`). The key format reserves the size
  slot; adding derivatives is additive.
