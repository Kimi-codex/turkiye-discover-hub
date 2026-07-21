
# Phase 5 — Owner Portal

## Pre-plan verification (already confirmed)

- Tables present: `businesses` (with `field_sources jsonb`, `owner_id`), `business_change_requests` (with `changes`, `original_values`, `status`, `reviewed_by/at`, `admin_notes`), `ownership_claims` (with `evidence_urls jsonb`), `review_replies` (with `status`, `moderated_by/at`), `owner_notifications`, `business_owner` role in `app_role`.
- RLS present: owner-read policies on `business_images`, `business_opening_hours`, `business_services`, `business_attributes`, `business_translations`; `bcr_owner_insert` policy already enforces `submitted_by = auth.uid()` **and** `owner_id = auth.uid()`.
- RPCs present: `approve_ownership_claim`, `has_role`, `is_suspended`.
- Storage: private `owner-uploads` bucket exists with per-user path-scoped RLS (from Phase 4).

## Phase 4 status carried forward (blocked, not verified)

Explicitly still blocked until real R2 credentials + deployed runtime spike:

- deployed runtime image-processing spike
- real JPEG/PNG decode and resize
- EXIF orientation correction
- WebP re-encoding
- metadata stripping
- real R2 PUT/HEAD/GET/DELETE
- deployed worker execution
- production scheduler verification
- public URL verification

**Object-key format deviation (must resolve before Phase 5 build):**
The canonical approved format is `businesses/{business_id}/{sanitized_place_id}/{sha256}.webp`.
Phase 4 shipped `businesses/{business_id}/{size}/{prefix}/{hash}.{ext}` without a documented migration. **Step 0 of this plan reverts `buildImageKey` to the canonical format** (owner-upload rows carry a synthetic `sanitized_place_id` = `owner-{uploader_id}` when the business has no Google place_id), and updates the Phase 4 test to lock the canonical shape. No R2 data exists yet, so this is a code-only revert.

## Migration (M5)

Additive; no destructive changes. Every new `public` table gets `GRANT`s in the same migration.

1. `business_change_requests`
   - Add `request_type text NOT NULL DEFAULT 'business_fields'` with CHECK in (`business_fields`, `opening_hours`, `services`, `attributes`, `translations`, `image_request`).
   - Add `approved_fields jsonb` and `rejected_fields jsonb` for partial-approval audit.
   - Add per-owner index `(business_id, status, created_at desc)`.
2. `apply_business_change_request(_request_id uuid, _approve jsonb, _reject jsonb, _admin_notes text)` — SECURITY DEFINER, admin-only:
   - Row-lock CR and target business.
   - Reject when CR is not `pending`.
   - Reject when any approved field's current DB value ≠ CR `original_values` (stale-request conflict) — return `{conflict:true, field:<name>}`; do not partial-apply on conflict.
   - Apply only fields listed in `_approve` AND allow-listed for the CR's `request_type` (Postgres-side allowlist function).
   - For each applied field, set `businesses.field_sources[field] = jsonb_build_object('source','owner','user_id',submitter,'at',now())`.
   - For `opening_hours` / `services` / `attributes` / `translations` request types, replace child rows in-transaction and update `field_sources` with a summary key (e.g. `opening_hours`).
   - Mark CR `approved` when at least one field applied and none rejected; `partially_approved` when both non-empty; `rejected` when nothing applied.
   - Insert audit_log + owner_notification row.
3. `revoke_ownership(_business_id uuid, _reason text)` — admin-only, atomic: clears `owner_id`, revokes `business_owner` role if user owns nothing else, notifies owner.
4. `owner_has_business(_user uuid)` helper for menu gating.
5. Trigger on `ownership_claims` status change to insert `owner_notifications`.
6. `review_replies` add trigger: block author update after moderation != `pending`; enforce partial-unique index already in place (verified — Phase 4).
7. Notification insert helpers with per-role grants (owner receives, admin inserts via RPC only).

## Server-side authorization surface

New file `src/lib/owner/authz.server.ts` with a single helper `requireOwnedBusiness(context, businessId): Promise<{business, capability}>`, called by **every** owner server fn. It:

1. Requires `requireSupabaseAuth` (already gates authenticated user).
2. Runs a single RPC `owner_authz(_business_id)` (SECURITY DEFINER, returns row) that checks in one call: not suspended, has `business_owner` role, `businesses.owner_id = auth.uid()`, business not `deleted`. Returns 403 with a stable code (`SUSPENDED`, `NOT_OWNER`, `MISSING_ROLE`, `BUSINESS_MISSING`).
3. Never trusts `business_id` from client; caller must pass it through the validator, but the RPC is the source of truth.

Every owner mutation server fn is written as:

```
createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator(zod)
  .handler(async ({data, context}) => {
    const {business} = await requireOwnedBusiness(context, data.businessId);
    // ...
  });
```

## Owner server functions (`src/lib/owner/*.functions.ts`)

- `owner-businesses.functions.ts`: `listMyBusinesses`, `getMyBusiness(businessId)`.
- `owner-change-requests.functions.ts`: `listMyChangeRequests`, `submitBusinessFieldsCR`, `submitOpeningHoursCR`, `submitServicesCR`, `submitAttributesCR`, `submitTranslationsCR`, `withdrawCR`.
  - Each mutation enforces a **strict per-request-type Zod allowlist** (business-fields: `name`, `description`, `phone`, `email`, `website`, `formatted_address`, `neighborhood`, `price_level`; hours: full 7-day array; services: name+desc+price; attributes: known keys only; translations: `name/description` per lang).
  - Stores `original_values` snapshot at submit time.
- `owner-claims.functions.ts`: `submitOwnershipClaim` (business + evidence file keys), `listMyClaims`. Uploads land in `owner-uploads/{uid}/claims/…` (private) — the server fn only stores the object keys.
- `owner-images.functions.ts`: `requestImageUpload` (returns a signed PUT to `owner-uploads/{uid}/pending/…`), `finalizeUploadedImage` (creates `business_images` row with `source_type='owner_upload'`, `storage_status='pending'`, `place_id = business.place_id ?? 'owner-'||uid`) then calls `queueImagesAfterImport({businessIds:[businessId]})` from Phase 4. Delete request → soft-delete via CR (`request_type='image_request'`).
- `owner-reviews.functions.ts`: `listReviewsForMyBusinesses`, `submitReviewReply(reviewId, body)` — inserts into `review_replies` with `status='pending'`; partial unique index enforces one active reply; `updateOwnReply` only when `status='pending'`.
- `owner-reports.functions.ts`: `submitReport` (review or image on an owned business).
- `owner-notifications.functions.ts`: `listMyNotifications`, `markRead`, `markAllRead`.

## Admin extensions

- New admin server fn `applyChangeRequest(requestId, approvedFields, rejectedFields, notes)` — thin wrapper around new RPC.
- Extend `/admin/businesses/$id` with a **Pending change requests** panel (per-field checkboxes for approve/reject, conflict badge when `original_values` diverges from current DB).
- Extend `/admin/ownership-claims` with revocation button → `revoke_ownership` RPC.
- New route `/admin/review-replies` for moderating owner replies (approve, reject with notes).

## Owner UI (`src/routes/$lang._authenticated.owner.*`)

Under the existing managed `_authenticated` gate (Supabase session already required). All routes `ssr: false`.

```text
$lang._authenticated.owner.tsx                 # shell + sidebar (mobile-collapsible)
$lang._authenticated.owner.index.tsx           # dashboard: my businesses + open CRs + unread notifications
$lang._authenticated.owner.claim.tsx           # submit new ownership claim (search business, evidence upload)
$lang._authenticated.owner.$businessId.tsx     # per-business layout (guard: requireOwnedBusiness on load)
$lang._authenticated.owner.$businessId.index.tsx        # overview, current field_sources display
$lang._authenticated.owner.$businessId.profile.tsx      # business-fields CR editor
$lang._authenticated.owner.$businessId.hours.tsx        # opening-hours CR editor
$lang._authenticated.owner.$businessId.services.tsx     # services CR editor
$lang._authenticated.owner.$businessId.attributes.tsx   # attributes CR editor
$lang._authenticated.owner.$businessId.translations.tsx # per-locale translations CR editor
$lang._authenticated.owner.$businessId.images.tsx       # owner uploads + delete requests
$lang._authenticated.owner.$businessId.reviews.tsx      # reviews + reply composer
$lang._authenticated.owner.$businessId.requests.tsx     # CR history with statuses
$lang._authenticated.owner.notifications.tsx            # in-app notifications
```

Header account menu (already exists) gains an **Owner portal** link visible only when `owner_has_business` returns true, plus a **Notifications** bell with unread count.

RTL/i18n: all owner strings go into `src/lib/i18n/messages/{tr,en,ar}.ts` under an `owner.*` namespace. Every form label, button, and error code is translated in all three locales. Layouts already flip via `dir="rtl"` at the root level from Phase 1; owner pages will use logical Tailwind classes (`ms-*`, `me-*`, `ps-*`, `pe-*`) and mobile-first breakpoints (single column < md, sidebar ≥ md).

## Private upload flow

- Signed PUT lifespan: 5 minutes.
- Signed GET (admin viewing claim evidence) generated server-side only, 60 s TTL.
- Bucket paths: `owner-uploads/{uid}/claims/{uuid}.{ext}` (claim evidence), `owner-uploads/{uid}/pending/{uuid}.{ext}` (image uploads pending R2 promotion).
- RLS on `storage.objects` for `owner-uploads` bucket already restricts each user to their own `{uid}/…` prefix. Admin read of claim evidence uses `supabaseAdmin` inside a server fn after the admin gate.

## Tests

Unit tests (vitest, in-process):

- CR allowlist rejects unknown fields per request type.
- `original_values` snapshot equals current DB row at submit.
- `buildImageKey` returns canonical `businesses/{id}/{place_id}/{hash}.webp`.

Integration tests (Node script hitting Supabase over PostgREST with two synthetic auth tokens — admin + non-owner + owner):

- **Owner authz probe**: non-owner call to every owner server fn returns 403 with the right code.
- **Cross-business isolation**: owner A cannot read or mutate owner B's business (RLS + `requireOwnedBusiness`).
- **Suspended user**: suspending owner blocks all owner mutations.
- **Direct RLS probe**: `business_change_requests` insert with mismatched `business_id`/`owner_id` is denied.
- **Atomic approval**: two concurrent approvals on the same CR — exactly one succeeds, the other returns conflict.
- **Stale-request conflict**: CR submitted, admin changes canonical field directly, approval returns `{conflict:true}` and does not partially apply.
- **Partial approval**: mixed approve+reject applies only approved fields and updates `field_sources` only for those.
- **Review-reply uniqueness**: two `pending` replies for the same review → second returns unique-violation error surfaced as `ALREADY_REPLIED`.
- **Private upload access**: owner A cannot list or read `owner-uploads/{owner_B_id}/…` object keys.
- **Ownership revocation**: `revoke_ownership` clears `owner_id`, drops `business_owner` role when last business, subsequent owner call returns `NOT_OWNER`.

Build/typecheck/full vitest run at the end.

## Reporting format

At end of build I return a table of every verification with one of:

- Passed
- Failed
- Not executed
- Blocked by configuration

and stop before Phase 6.

## Files (all new unless noted)

```text
supabase/migrations/…_phase5.sql                          # M5 above
src/lib/owner/authz.server.ts
src/lib/owner/owner-businesses.functions.ts
src/lib/owner/owner-change-requests.functions.ts
src/lib/owner/owner-claims.functions.ts
src/lib/owner/owner-images.functions.ts
src/lib/owner/owner-reviews.functions.ts
src/lib/owner/owner-reports.functions.ts
src/lib/owner/owner-notifications.functions.ts
src/lib/owner/field-allowlists.ts
src/lib/admin/change-requests.functions.ts               # extends admin surface
src/components/owner/OwnerShell.tsx
src/components/owner/BusinessSidebar.tsx
src/components/owner/ChangeRequestFieldRow.tsx
src/components/owner/HoursEditor.tsx
src/components/owner/ImageUploader.tsx
src/components/owner/NotificationBell.tsx
src/routes/$lang._authenticated.owner.*.tsx              # routes listed above
src/routes/$lang._authenticated.admin.review-replies.tsx # new admin surface
src/routes/$lang._authenticated.admin.businesses.$id.tsx # extended (existing file)
src/lib/i18n/messages/{tr,en,ar}.ts                       # extended (existing files)
src/lib/images/hash.ts                                    # buildImageKey reverted (existing file)
src/lib/images/__tests__/pipeline.test.ts                # updated assertion
docs/PHASE5.md                                            # architecture + verification report template
scripts/phase5-integration.mjs                            # runnable integration probes
```

## Explicit non-goals for Phase 5

- No R2 credential provisioning.
- No changes to Phase 4 worker beyond the key-format revert.
- No public-site changes beyond the header account menu gaining owner/notifications entries.
- No Phase 6 work.
