# A. Executive Summary

Current maturity: the project has a solid foundation for authentication, global roles, admin protection, public business pages, imports, reviews, favorites, and a partial owner portal. It is not yet aligned with the approved HiTürkiye business onboarding architecture.

Main architectural gaps:

- The approved model is global `user` / `admin` plus business-scoped `owner` / `manager`.
- Current schema still has global `business_owner` and `moderator`.
- Ownership currently depends on `businesses.owner_id`, which cannot support multiple managers or clean business-scoped roles.
- There is no `business_members` table.
- There is no manager invitation system.
- There is no complete new-business submission system.
- Existing `ownership_claims` only supports a narrow existing-business claim flow.
- Commercial registration fields/documents are not modeled sufficiently.
- Pre-approval onboarding dashboard does not exist.
- Admin review can approve/reject claims, but cannot request changes, request documents, reassign, mark duplicate, or manage full submission lifecycle.

Main security gaps:

- Current owner upload Storage policy and generated upload paths appear incompatible.
- Claim evidence upload uses `claims/{userId}/...`, but `owner-uploads` policies expect the first path segment to equal `auth.uid()`.
- Owner image upload uses `{businessId}/...`, also incompatible with the current path policy.
- Current owner authorization is safe for one-owner businesses, but not compatible with future `manager` access.
- Some owner/review functions use status values that conflict with DB constraints.

Main UX gaps:

- Registration has no phone field, terms acceptance, or usage-intent choice.
- Business claim route asks for raw “Business ID (UUID)”.
- Public business page shows “Claim this business” as a button, but it is not wired to a trustworthy onboarding flow.
- Existing owner dashboard is a full owner dashboard, not a pre-approval onboarding dashboard.
- Owner/admin pages are mostly hard-coded English and not fully localized.

Can the existing system be extended safely?

Yes. The current system should be extended additively. Do not replace it destructively. The safest path is:

1. Preserve current Auth, Admin protections, public directory, import pipeline, business pages, reviews, images, and slugs.
2. Add business-scoped membership.
3. Backfill existing `businesses.owner_id`.
4. Add onboarding/submission tables.
5. Move owner authorization gradually from `owner_id + business_owner` to `business_members`.
6. Deprecate global `business_owner` later.

No current functionality blocks the approved design, but the current owner model must be migrated carefully to avoid dual-authority bugs.

# B. Current System Inventory

## Authentication

Evidence:

- `src/routes/$lang.auth.tsx`
- `src/hooks/use-auth.tsx`
- `src/routes/$lang._authenticated.tsx`
- `src/integrations/supabase/auth-middleware.ts`
- `src/integrations/supabase/auth-attacher.ts`
- `src/integrations/lovable/index.ts`

Current state:

- Supabase Auth is used.
- Email/password sign-up and sign-in exist.
- Google OAuth exists through Lovable.
- Session state is tracked through `useAuth`.
- Server functions require Bearer JWT through `requireSupabaseAuth`.

Missing against approved requirements:

- Phone collection at registration.
- Terms/privacy acceptance.
- Usage-intent choice.
- Forgot password / reset password route.
- Explicit email verification result route.
- Post-registration onboarding redirect logic for business-intent users.

## Profiles

Evidence:

- `supabase/migrations/20260721095626_1705887c-c521-42b9-84ec-a8ef436ee8fb.sql`

Table: `profiles`

Current columns include:

- `id`
- `full_name`
- `avatar_url`
- `phone`
- `preferred_language`
- `status`
- `created_at`
- `updated_at`

Works correctly:

- Profile is created by `handle_new_user`.
- User can select/update own profile under RLS.
- Admin can read/update profiles.

Incomplete:

- UI only shows account email and favorites.
- No profile edit screen.
- Phone exists in schema but is not collected during sign-up.
- Terms acceptance is not stored.

## Roles

Evidence:

- `public.app_role`
- `public.user_roles`
- `public.has_role`
- `src/lib/admin/admin.functions.ts`

Current enum:

```sql
'user', 'business_owner', 'moderator', 'admin'
```

Approved long-term roles:

- Global: `user`, `admin`
- Business-scoped: `owner`, `manager`

Conflict:

- Existing `business_owner` is global and conflicts with the approved scoped-membership model.
- Existing `moderator` conflicts with the V1 requirement that business approval is Admin-only.

Recommendation:

- Preserve both temporarily for backward compatibility.
- Do not remove during this phase.
- Migrate ownership authority to `business_members`.
- Deprecate `business_owner` after owner routes no longer require it.
- Keep `moderator` dormant or restrict it from business onboarding approvals.

## Owner model

Evidence:

- `businesses.owner_id`
- `src/lib/owner/authz.server.ts`
- `public.owner_authz`
- `src/lib/owner/owner.functions.ts`

Current model:

- A user must have global `business_owner`.
- The business row must have `owner_id = auth.uid()`.
- `owner_authz` checks both.

Works:

- Good business-level isolation for a single owner.
- Server functions call `assertOwns` before business-scoped actions.

Conflicts:

- Cannot support multiple managers.
- Cannot support one business with primary owner plus managers.
- Cannot support business-scoped roles cleanly.
- Cannot support owner transfer history.
- Cannot express revoked/suspended membership per business.

## Claims

Evidence:

- `ownership_claims`
- `submitOwnershipClaim`
- `approve_ownership_claim`
- `src/routes/$lang._authenticated.owner.claim.tsx`
- `src/routes/$lang._authenticated.admin.ownership-claims.tsx`

Current claim fields:

- `business_id`
- `user_id`
- `full_name`
- `phone`
- `business_email`
- `evidence_urls`
- `message`
- `status`
- `admin_notes`
- `reviewed_at`
- `reviewed_by`

Works:

- Authenticated users can submit an ownership claim.
- Admin can approve via RPC.
- Approval is atomic and sets `businesses.owner_id`.
- Approval grants global `business_owner`.
- Audit log is written.

Incomplete/conflicting:

- Claim route requires raw business UUID.
- No commercial registration number.
- No legal registered name.
- No expiry/issue date.
- No registered owner/representative field.
- No legal declaration.
- No change-request/additional-document lifecycle.
- No duplicate/link/reassign flow.
- Admin UI reads fields named `evidence_notes` and `contact_email`, but schema uses `evidence_urls`, `business_email`, and `message`.

## Business creation

Current state:

- Admin can manage businesses through admin domain functions.
- Import pipeline can create/update businesses.
- There is no user-facing new-business submission workflow.

Missing:

- `business_submissions`.
- Draft/submitted/review lifecycle.
- Admin approval for new business creation.
- Pending onboarding images.
- Commercial registration model.

## Business editing

Evidence:

- `business_change_requests`
- `submitChangeRequest`
- `apply_business_change_request`

Works:

- Owners cannot directly update public business rows.
- Owner changes go through change requests.
- Admin applies approved fields via RPC.
- Field-source preservation exists for import conflicts.

Problems:

- Some SQL in `apply_business_change_request` references columns that appear inconsistent with actual schema, e.g. `business_services` insert uses `name`, `description`, `price`, while schema has `service_key`, `value`, `sort_order`.
- Translation section references `language`, `name`, `description`, while schema has `language_code`, `translated_name`, `translated_description`.

This needs correction before owner dashboard is treated as production-ready.

## Admin approval

Evidence:

- `src/lib/admin/domain.functions.ts`
- `src/lib/owner/admin-cr.functions.ts`
- `approve_ownership_claim`
- `set_user_role`
- `record_audit`

Works:

- Admin-only server functions use `requireAdmin`.
- Role changes use RPC with last-admin protection.
- Ownership approval is atomic.
- Change request approval is intended to be atomic.

Missing:

- Full onboarding queue.
- New business submissions.
- Commercial registration viewer.
- Request changes.
- Request additional document.
- Duplicate/link/reassign actions.
- User-visible decision messages.
- Submission history.

## Documents

Current state:

- Claim evidence path is stored in `ownership_claims.evidence_urls`.
- Upload function exists: `createClaimEvidenceUpload`.
- Storage bucket used: `owner-uploads`.

Problems:

- No separate commercial registration document table.
- No MIME/size validation beyond input accept/type metadata.
- No retention model.
- No document metadata model.
- No document replacement history.
- Path/policy mismatch likely blocks or weakens claim upload flow.

## Images

Evidence:

- `business_images`
- `business_images_public`
- `createOwnerImageUpload`
- `registerOwnerImage`
- image import pipeline

Current state:

- Imported/external images use `business_images`.
- Public business reads through `business_images_public`.
- `source_type` supports `google_places`, `owner_upload`, `admin_upload`, `external_manual`.
- Owner upload functions exist.

Problems:

- Onboarding images before business approval are not modeled.
- `business_images` requires `business_id`, so it is not suitable for new-business draft images before business creation unless placeholder draft business records are created.
- Public image view filters `deleted_at`, but public visibility also depends on parent business publication through underlying RLS.
- Need separate pending onboarding image table or private storage metadata before approval.

## Invitations

Current state:

- No invitation system found.
- No `business_invitations`.
- No manager acceptance route.
- No manager role.

## Notifications

Evidence:

- `owner_notifications`
- `listOwnerNotifications`
- `markNotificationRead`

Current state:

- Owner notifications exist.
- Claim status changes can create owner notifications.
- Change request approval can create owner notifications.

Missing:

- General `user_notifications`.
- Manager invitation notifications.
- Business onboarding notifications.
- Admin messages tied to submissions.
- Email sending.

## Audit logs

Evidence:

- `audit_logs`
- `record_audit`
- `approve_ownership_claim`
- `set_user_role`
- `apply_business_change_request`
- `revoke_ownership`

Current state:

- Audit table exists.
- Admin-readable only.
- Several sensitive admin actions are logged.

Missing:

- Onboarding draft/submission lifecycle logs.
- Document upload/replacement events.
- Invitation lifecycle events.
- Submission reassignment/duplicate/link events.
- User-visible submission history separate from internal audit.

## RLS

Current RLS is strong in several places:

- Public reads only published businesses.
- Users read/update own profiles.
- Users read own roles.
- Users manage own favorites.
- Users insert own pending reviews.
- Admin manages admin data.
- Owner reads are based on `businesses.owner_id`.

Required future change:

- Add membership-based RLS helpers and policies.

## Storage

Existing buckets/policies found:

- `imports`: admin-only storage object policies.
- `owner-uploads`: authenticated owner/admin policies.

Important problem:

- `owner-uploads` policies check `(storage.foldername(name))[1] = auth.uid()::text`.
- Claim upload path currently: `claims/{userId}/...`.
- Owner image upload path currently: `{businessId}/...`.
- These paths do not satisfy the current owner policy.

# C. Requirement-by-Requirement Gap Matrix

| Requirement | Current state | Evidence | Gap | Recommended action | Risk | Priority |
|---|---|---|---|---|---|---|
| Visitor is unauthenticated, not DB role | Correct | No `visitor` enum | None | Preserve | Low | P0 |
| Global roles limited to `user`, `admin` | Not aligned | `app_role` has `business_owner`, `moderator` | Legacy roles exist | Preserve temporarily, deprecate later | Medium | P1 |
| Business roles `owner`, `manager` scoped per business | Missing | No `business_members` | Cannot support managers | Add `business_members` | High | P1 |
| New users start as `user` | Correct | `handle_new_user` | None | Preserve | Low | P0 |
| Usage-intent choice in registration | Missing | `$lang.auth.tsx` | No onboarding redirect | Add intent field, no permission grant | Medium | P1 |
| Phone collection | Schema exists, UI missing | `profiles.phone` | Not collected | Add to registration/profile | Low | P1 |
| Terms acceptance | Missing | No table/field found | Legal gap | Add timestamp/version fields | Medium | P1 |
| Existing business verification | Partial | `ownership_claims` | Too narrow | Extend or replace with submissions | High | P2 |
| New business submission | Missing | No table/route | Required | Add draft/submission model | High | P3 |
| Commercial registration mandatory | Missing | No fields/table | Required | Add sensitive registration data model | High | P2 |
| Admin-only approval | Mostly aligned | `requireAdmin` | Existing `moderator` RLS could confuse | Keep business onboarding admin-only | Medium | P1 |
| Request changes/documents | Missing | Claim status limited | Workflow gap | Add events/statuses/messages | High | P4 |
| Manager invitation | Missing | No invitation table/route | Required | Add after membership | High | P6 |
| Existing owner conflict | Partial | claim rejects if `owner_id` belongs to another user | Too blunt and exposes flow | Add ownership review/dispute submission | Medium | P5 |
| Duplicate prevention | Partial | `place_id` unique, import provenance, name search | No onboarding duplicate workflow | Use narrow matching V1 | High | P3 |
| Private documents | Partial but flawed | `owner-uploads` | Path/policy mismatch, weak metadata | Add secure doc storage model | High | P2 |
| Onboarding images up to 10 | Missing | owner image upload only post-owner | No pre-approval image model | Add pending submission images | Medium | P4 |
| Pre-approval dashboard | Missing | owner dashboard only | Pending users lack dashboard | Add onboarding dashboard | Medium | P4 |
| Admin comparison screen | Missing | claims screen simple | Cannot compare legal/public data | Add submission detail | High | P5 |
| Audit lifecycle | Partial | `audit_logs` | Missing many events | Add event logging | Medium | P5 |
| Notifications | Partial | `owner_notifications` | No user/general onboarding notifications | Add/generalize notifications | Medium | P5 |
| i18n/RTL | Public supports; owner/admin incomplete | messages + hard-coded owner/admin text | New flows need translation | Add translation groups | Medium | P6 |

# D. Preserve / Modify / Add / Deprecate

## Preserve exactly

- Supabase Auth foundation.
- `requireSupabaseAuth`.
- `requireAdmin`.
- `has_role`.
- Existing public business pages.
- Existing multilingual routes.
- Existing public RLS for published businesses.
- Existing Google import pipeline.
- Existing `business_images` external/import behavior.
- Existing slugs/public URLs.
- Existing `audit_logs`.
- Existing `favorites` table.
- Existing `reviews` table.

## Preserve but modify

- `src/routes/$lang.auth.tsx`: add phone, terms, usage intent, redirect handling.
- `profiles`: use existing `phone`, add terms fields if approved.
- `ownership_claims`: either extend cautiously or migrate into broader `business_submissions`.
- `owner_notifications`: reuse or generalize.
- `OwnerShell` and owner routes: keep layout, migrate authorization to business membership.
- `AdminShell`: preserve admin-only protection, add onboarding queues.
- `business_change_requests`: preserve, but fix schema/status inconsistencies.
- `owner-uploads`: preserve bucket if private, fix path policy or path design.

## Add

- `business_members`.
- `business_invitations`.
- `business_submissions`.
- `business_submission_documents`.
- `business_submission_images`.
- `business_submission_events`.
- `user_notifications` or generalized notifications.
- Onboarding search/match route.
- Business onboarding draft dashboard.
- Admin business onboarding queue/detail screens.
- Manager invitation acceptance route.
- Membership authorization helpers.

## Deprecate or remove later

Do not remove immediately.

- Global `business_owner`: deprecate after `business_members` is live and owner routes are migrated.
- `businesses.owner_id` as authority: keep as compatibility/cache, then make non-authoritative later.
- `moderator` role for business onboarding: keep unused/dormant unless separately approved for content moderation.
- Raw UUID claim form: replace with contextual onboarding and deprecate route behavior.
- Narrow `ownership_claims`-only model if `business_submissions` supersedes it.

# E. Detailed Scenario Comparison

## 1. Normal user registration

Current behavior:

- User signs up with name/email/password.
- Trigger creates profile and `user` role.
- No phone, terms, usage intent.

Target behavior:

- Add phone and terms acceptance.
- Add usage intent.
- If “Explore places” selected, redirect to account or prior page.
- Role remains `user`.

Reusable code:

- `$lang.auth.tsx`
- `handle_new_user`
- `profiles`
- `user_roles`

Missing:

- Terms storage.
- Phone UI.
- Intent handling.

Security:

- Intent must not grant permissions.

## 2. Business-intent registration

Current behavior:

- No business-intent flow.

Target behavior:

- Same account system.
- User selects “Add or manage my business.”
- After verification/sign-in, redirect to onboarding discovery.
- Role remains `user`.

Reusable:

- Auth route.
- Profile trigger.

Missing:

- Onboarding destination.
- Intent persistence.

## 3. New business submission

Current behavior:

- Missing.

Target behavior:

- User must search first.
- If no match, create draft submission.
- No public business row until Admin approval unless using hidden draft records intentionally.
- Commercial registration required.
- Optional images up to 10.
- Admin approves/rejects/requests changes/marks duplicate.

Reusable:

- business schema.
- categories/cities/districts.
- business images architecture after approval.

Missing:

- submission table.
- draft lifecycle.
- document model.
- admin queue.

## 4. Existing business verification

Current behavior:

- User manually enters business UUID.
- Claim can be submitted.
- Admin approves/rejects.

Target behavior:

- User selects business from search results.
- No raw UUID entry.
- Commercial registration mandatory.
- Admin can compare submitted data to existing public data.
- Approval creates owner membership for that business.

Reusable:

- `ownership_claims` concept.
- `approve_ownership_claim` transaction pattern.
- `owner_notifications`.

Missing:

- commercial registration fields.
- comparison UI.
- reassign/link/duplicate workflow.

## 5. Existing business with active Owner

Current behavior:

- `submitOwnershipClaim` rejects if `biz.owner_id` exists and is not current user.
- This prevents ownership review/dispute flow.

Target behavior:

- Do not publicly expose claimed/unclaimed state.
- After secure onboarding, allow ownership review request.
- Admin decides whether to reject, request documents, transfer, revoke, or add manager.

Missing:

- conflict/dispute statuses.
- transfer flow.
- membership model.

## 6. Rejected request and resubmission

Current behavior:

- Claim statuses: `pending`, `approved`, `rejected`, `withdrawn`.
- No edit/resubmit lifecycle.

Target behavior:

- Rejected user sees reason.
- Same request can be edited where allowed.
- History preserved.
- Resubmitted status tracked.

Missing:

- `business_submission_events`.
- resubmission statuses.

## 7. Admin requests changes

Current behavior:

- Missing.

Target behavior:

- Admin selects structured reason and message.
- User edits same submission and resubmits.

Missing:

- statuses `changes_requested`, `resubmitted`.
- editable draft locking rules.

## 8. Admin requests additional document

Current behavior:

- Missing.

Target behavior:

- Admin requests document.
- User uploads/replaces/adds document.
- Previous document history preserved.

Missing:

- document table and document events.

## 9. User skips images

Current behavior:

- Not applicable.

Target behavior:

- Images optional.
- Submission can proceed without images.

Missing:

- onboarding stepper and validation.

## 10. User uploads up to 10 images

Current behavior:

- Owner image upload exists only after ownership.
- Uses `business_images`, requiring `business_id`.

Target behavior:

- Pending images linked to submission, not public gallery.
- Max 10.
- Validate MIME/size.
- Approve before public.

Missing:

- pending image table/storage structure.

## 11. Admin detects duplicate

Current behavior:

- Imports dedupe by `place_id`, source fingerprint, slug uniqueness.
- Admin can manually manage businesses.

Target behavior:

- Onboarding search flags duplicates.
- Admin can mark submission duplicate or link to existing business.

Missing:

- submission duplicate workflow.

## 12. Admin links to another business

Current behavior:

- Missing.

Target behavior:

- Admin changes target business on verification request with audit/history.

Missing:

- target reassignment action and event.

## 13. Approval and Owner creation

Current behavior:

- `approve_ownership_claim` sets `businesses.owner_id`, grants global `business_owner`, updates claim, writes audit.

Target behavior:

- Create `business_members` row:
  - role `owner`
  - status `active`
  - `is_primary = true`
- Keep `owner_id` temporarily for compatibility.
- Do not grant platform-wide owner authority.

Missing:

- membership transaction.

## 14. Owner invites Manager

Current behavior:

- Missing.

Target behavior:

- Active owner invites manager by email.
- Invitation expires.
- Acceptance creates manager membership.

Missing:

- invitation table/routes/functions.

## 15. Existing user accepts Manager invitation

Current behavior:

- Missing.

Target behavior:

- User signs in.
- Email must match invitation.
- Accept creates active manager membership.

## 16. New user accepts Manager invitation

Current behavior:

- Missing.

Target behavior:

- Invited email registers.
- Email verified.
- Accept invitation.

## 17. Manager access is revoked

Current behavior:

- Missing.

Target behavior:

- Owner or Admin revokes membership.
- Manager loses access immediately.
- Audit written.

## 18. Owner manages multiple businesses

Current behavior:

- `listMyBusinesses` queries `businesses.owner_id = userId`.
- Supports multiple owned rows only if all use `owner_id`.

Target behavior:

- Query `business_members` where user has active owner/manager role.

## 19. Manager manages multiple businesses

Current behavior:

- Missing.

Target behavior:

- Query `business_members`.

## 20. Unauthorized access attempts

Current behavior:

- Owner server functions call `assertOwns`.
- Admin functions use `requireAdmin`.

Target behavior:

- Add `requireBusinessMember`, `requireBusinessOwner`, `requireOwnerOrManager`.
- RLS must match server checks.

# F. Proposed Final Screen Map

## Existing screens to keep

- `/$lang/auth`
- `/$lang/account`
- `/$lang/place/$slug`
- `/$lang/owner`
- `/$lang/owner/notifications`
- `/$lang/admin`
- `/$lang/admin/users`
- `/$lang/admin/audit-logs`
- `/$lang/admin/businesses`
- `/$lang/admin/imports`
- `/$lang/admin/images`
- `/$lang/admin/reviews`

## Existing screens to modify

- `/$lang/auth`: add phone, terms, usage intent.
- `/$lang/account`: add profile, onboarding entry, invitations, review history.
- `/$lang/place/$slug`: replace raw/simple claim CTA with professional representative section.
- `/$lang/owner/claim`: replace raw UUID form with onboarding discovery/selected business context.
- `/$lang/owner`: support memberships and pre-approval submissions.
- `/$lang/admin/ownership-claims`: replace/extend to full onboarding verification queue.

## New screens to add

Authentication:

- Email verification result.
- Forgot password.
- Reset password.
- Post-registration destination handler.

Business onboarding:

- Welcome.
- Existing business search.
- Match results.
- Existing business verification form.
- New business submission form.
- Location/map step.
- Commercial registration step.
- Document upload step.
- Optional images step.
- Review/declaration step.
- Submission success.
- Pre-approval dashboard.
- Changes requested.
- Additional document upload.
- Rejection/resubmission.

Owner/manager:

- Team management.
- Invite manager.
- Pending invitations.
- Active managers.
- Manager invitation acceptance.

Admin:

- Business onboarding queue.
- Submission detail.
- Commercial registration viewer.
- Business comparison.
- Duplicate/link/reassign actions.
- Request changes/document actions.
- Submission event history.

## Screens to deprecate

- Raw UUID claim behavior in `/$lang/owner/claim`.

# G. Proposed Final Data Model

## Existing tables reused

- `profiles`
- `user_roles`
- `businesses`
- `business_category_links`
- `business_images`
- `business_opening_hours`
- `business_services`
- `business_attributes`
- `business_translations`
- `favorites`
- `reviews`
- `reports`
- `business_change_requests`
- `owner_notifications`
- `audit_logs`

## Existing tables extended

`profiles`:

- add `terms_accepted_at`
- add `terms_version`
- optionally `registration_intent`

`ownership_claims`:

- either extend for backward compatibility or migrate into `business_submissions`.
- Keep existing rows readable.

## New tables required

### `business_members`

Purpose: source of truth for business-scoped access.

Key fields:

- `id`
- `business_id`
- `user_id`
- `role`: `owner` / `manager`
- `status`: `pending` / `active` / `revoked` / `suspended`
- `is_primary`
- `invited_by`
- `approved_by`
- `created_at`
- `updated_at`
- `revoked_at`

Constraints:

- unique active `(business_id, user_id)`
- one active primary owner per business
- manager cannot be primary owner

### `business_submissions`

Purpose: unified onboarding request for new business and existing verification.

Key fields:

- `id`
- `submission_type`: `new_business` / `existing_business_verification` / `ownership_review`
- `target_business_id`
- `submitted_by`
- `status`
- public business fields as JSON or structured columns
- commercial registration fields
- declaration accepted fields
- admin decision fields
- timestamps

Statuses:

- `draft`
- `submitted`
- `under_review`
- `changes_requested`
- `additional_document_required`
- `approved`
- `rejected`
- `resubmitted`
- `withdrawn`
- `duplicate`
- `linked_to_existing`

### `business_submission_documents`

Purpose: sensitive commercial registration files.

Fields:

- `id`
- `submission_id`
- `uploaded_by`
- `document_type`
- `storage_bucket`
- `storage_path`
- `mime_type`
- `size_bytes`
- `original_filename`
- `status`
- `created_at`
- `replaced_by`
- `deleted_at`

### `business_submission_images`

Purpose: optional pending onboarding images.

Fields:

- `id`
- `submission_id`
- `uploaded_by`
- `storage_bucket`
- `storage_path`
- `image_type`
- `sort_order`
- `status`
- `content_type`
- `file_size`
- `created_at`

### `business_submission_events`

Purpose: user-visible and admin-visible lifecycle history.

Fields:

- `id`
- `submission_id`
- `actor_id`
- `event_type`
- `visibility`: `internal` / `applicant`
- `message`
- `metadata`
- `created_at`

### `business_invitations`

Purpose: manager invitation.

Fields:

- `id`
- `business_id`
- `email_normalized`
- `role`
- `token_hash`
- `status`
- `invited_by`
- `accepted_by`
- `accepted_at`
- `expires_at`
- `created_at`
- `revoked_at`

### `user_notifications`

Purpose: general notifications for users/applicants/managers.

Can coexist with `owner_notifications` initially, but long-term one generalized table is cleaner.

# H. Proposed Authorization Matrix

| Capability | Visitor | User | Pending applicant | Owner | Manager | Admin |
|---|---:|---:|---:|---:|---:|---:|
| Browse public directory | Yes | Yes | Yes | Yes | Yes | Yes |
| View published businesses | Yes | Yes | Yes | Yes | Yes | Yes |
| Save favorites | No | Yes | Yes | Yes | Yes | Yes |
| Submit review | No | Yes | Yes | Yes, but not own business if policy approved | Yes, but not managed business | Yes |
| View own review history | No | Yes | Yes | Yes | Yes | Yes |
| Start onboarding | No, redirect to auth | Yes | Yes | Yes | Yes | Yes |
| Edit own onboarding draft | No | Own only | Own only | Own only | Own only | All |
| Submit commercial registration | No | Own submission | Own submission | Own submission | Not needed for invitation | Admin view |
| Access private documents | No | Own submission only | Own submission only | Own submission only | No | Yes |
| Manage public business fields | No | No | No | Approval/direct per policy | Limited per policy | Yes |
| Upload approved business images | No | No | Pending only | Yes | Yes | Yes |
| Reply to reviews | No | No | No | Yes, moderated | Yes, if allowed | Yes |
| Invite manager | No | No | No | Yes | No | Yes |
| Revoke manager | No | No | No | Yes | No | Yes |
| Transfer ownership | No | No | No | Request only | No | Yes |
| Approve submissions | No | No | No | No | No | Yes |
| View audit logs | No | No | No | No | No | Yes |
| Manage imports/settings/users | No | No | No | No | No | Yes |

# I. RLS and Server Authorization Plan

| Operation | UI | Server check | RLS/storage | Audit | Test |
|---|---|---|---|---|---|
| Register | Auth form | Supabase Auth | trigger profile/user role | optional | user gets only `user` |
| Update profile | Account settings | auth user only | `profiles_update_own` | optional | user A cannot edit B |
| Create submission draft | Onboarding | `requireSupabaseAuth` | own insert | event | user owns draft |
| Submit onboarding | Review step | owns draft + required fields | own update by status | event | missing doc rejected |
| Upload commercial document | Document step | owns submission | private bucket path by user/submission | document event | public denied |
| Admin review | Admin queue | `requireAdmin` | admin RLS | review event | non-admin denied |
| Approve existing verification | Admin action | `requireAdmin`, lock request/business | transaction creates member | audit | atomic consistency |
| Approve new business | Admin action | `requireAdmin`, duplicate check | transaction creates business/member | audit | no orphan business |
| Owner manage business | Owner dashboard | active owner/manager membership | membership RLS | business event | owner A denied B |
| Invite manager | Team screen | active owner only | invitation insert | audit | manager cannot invite owner |
| Accept invitation | Invite route | auth email matches invited email | invitation update/member insert | audit | mismatch denied |
| Revoke membership | Team/admin | owner/admin | membership update | audit | revoked loses access |
| Upload onboarding images | Optional step | owns submission | private/pending bucket | event | max 10 enforced |
| Publish approved images | Admin approval | `requireAdmin` | service/admin insert into `business_images` | audit | pending image not public |

# J. Migration and Backfill Plan

No migration should be created until this audit is approved.

Safe plan:

1. Add `business_members` without removing `businesses.owner_id`.
2. Backfill:

```text
for each businesses.owner_id not null:
  create active business_members row
  role = owner
  is_primary = true
  approved_by = system/admin
```

3. Update owner authorization helper to support both:
   - new `business_members`
   - legacy `businesses.owner_id`
4. Update owner routes/functions to use membership-aware helpers.
5. Keep global `business_owner` for navigation temporarily.
6. Later derive owner portal visibility from active memberships.
7. Stop granting global `business_owner` on new approvals.
8. After production verification, deprecate `business_owner`.
9. Much later, decide whether to keep `businesses.owner_id` as a denormalized primary-owner pointer or remove it.

Dual-authority risk:

- If `businesses.owner_id` and `business_members` disagree, users may gain or lose access incorrectly.
- During transition, add consistency checks and admin diagnostics.
- Do not allow two write paths to assign ownership independently.

Rollback:

- Because `owner_id` remains, owner portal can fall back to legacy authority if membership migration fails.
- New tables can be ignored without breaking existing public site.

# K. Implementation Phases

## Phase 0 — Architecture lock and data verification

Goal: confirm live role/user/owner data.

Files: none initially.

Tables: `profiles`, `user_roles`, `businesses`, `ownership_claims`.

Definition of done:

- Existing owners identified.
- Legacy role counts known.
- No data modification yet.

## Phase 1 — Authentication, registration, and profile hardening

Goal: approved registration foundation.

Files:

- `$lang.auth.tsx`
- account route
- i18n messages

Tables:

- `profiles`

Add:

- phone collection
- terms acceptance
- usage intent
- profile settings

Rollback:

- hide fields; keep additive columns.

## Phase 2 — Business membership foundation

Goal: introduce scoped authority.

Tables:

- `business_members`

Functions:

- `requireBusinessMember`
- `requireBusinessOwner`
- `requireOwnerOrManager`

Policies:

- membership RLS
- business child read policies using membership

Rollback:

- retain legacy `owner_id`.

## Phase 3 — Business onboarding shell and draft system

Goal: onboarding entry and draft lifecycle.

Tables:

- `business_submissions`
- `business_submission_events`

Routes:

- onboarding welcome
- discovery
- pre-approval dashboard

## Phase 4 — New business submission

Goal: support businesses not yet listed.

Affected:

- categories/cities/districts selection
- business schema mapping
- duplicate check

Do not publish before approval.

## Phase 5 — Existing business verification

Goal: replace raw UUID claim with search-selected verification.

Affected:

- public business page representative CTA
- onboarding search
- submission target business linking

## Phase 6 — Private commercial registration document storage

Goal: secure document upload.

Storage:

- fix `owner-uploads` path/policies or add dedicated private bucket.

Tests:

- public denied
- admin allowed
- applicant own docs allowed

## Phase 7 — Admin review and approval workflows

Goal: full Admin-only review.

Routes:

- admin onboarding queue
- submission detail
- document viewer
- comparison screen

Functions:

- approve/reject/request changes/request docs/link/duplicate.

## Phase 8 — Pre-approval dashboard, changes, rejection, resubmission

Goal: applicant lifecycle.

Tables:

- submission events
- document replacement
- statuses

## Phase 9 — Full Owner dashboard authorization migration

Goal: owner dashboard uses memberships.

Modify:

- all owner routes
- owner server functions
- RLS helpers

## Phase 10 — Manager invitation and access

Goal: owner invites manager.

Tables:

- `business_invitations`

Routes:

- invite manager
- accept invitation

## Phase 11 — Notifications, audit completion, and hardening

Goal: complete event/notification coverage.

Tables:

- `user_notifications`
- `audit_logs`

## Phase 12 — End-to-end multilingual, responsive, and security testing

Goal: production readiness.

Test:

- Turkish LTR
- English LTR
- Arabic RTL
- desktop/tablet/mobile
- RLS/storage/server authorization

# L. Test Plan

Required tests:

- Unit tests:
  - registration intent validation
  - submission status transitions
  - duplicate matching
  - invitation token hashing
  - membership permission helpers

- Integration tests:
  - new business submission lifecycle
  - existing business verification lifecycle
  - approval transaction
  - rejection/resubmission
  - manager invitation acceptance

- RLS tests:
  - user A cannot read user B submission
  - pending applicant cannot manage business
  - owner of A cannot manage B
  - manager cannot access documents
  - non-admin cannot approve

- Storage tests:
  - public cannot read commercial registration file
  - applicant can upload/read own file
  - admin can read file
  - expired/revoked paths fail if implemented

- Browser tests:
  - registration user intent routes correctly
  - onboarding duplicate search
  - image upload max 10
  - admin approval
  - manager invite and accept

- RTL/LTR tests:
  - Arabic forms
  - Turkish forms
  - English forms
  - long labels
  - mobile stepper

- Security tests:
  - expired invitation rejected
  - invited email mismatch rejected
  - revoked manager loses access
  - client-provided business ID cannot bypass scope
  - user cannot approve own submission

# M. Open Questions

Only these require product-owner approval after inspection:

1. Should `business_owner` be retained indefinitely as a compatibility flag, or fully removed after `business_members` migration?
2. Should `businesses.owner_id` remain as a denormalized primary-owner pointer after migration, or eventually be removed?
3. Should users be allowed to review businesses they own/manage, or should that be blocked?
4. Should rejected commercial registration documents be retained for fraud/audit, and for how long?
5. Should new-business approval create a published business immediately, or allow “approve as draft” as the default safer path?
6. Should manager permissions include replying to reviews in V1, or should review replies remain owner-only initially?
7. Should onboarding documents live in a corrected `owner-uploads` path or a dedicated `business-verification-documents` bucket?

# Architecture verdict

The existing system is extendable, but the approved business onboarding architecture requires additive structural work. The most important change is introducing `business_members` and moving business authority away from global `business_owner` and direct `businesses.owner_id` checks.

# Release-blocking gaps

- No business-scoped membership.
- No new-business submission model.
- No commercial registration model.
- No manager invitation system.
- Raw UUID claim flow.
- Storage path/policy mismatch for owner uploads.
- Owner review reply/report status mismatches.
- Admin ownership claim screen field mismatch.
- No request-changes/additional-document lifecycle.

# Safe-to-reuse components

- Supabase Auth.
- Google OAuth wrapper.
- `profiles`.
- `user_roles` for global `user` / `admin`.
- `requireSupabaseAuth`.
- `requireAdmin`.
- `has_role`.
- Public business schema.
- Import pipeline.
- `business_images` for approved public images.
- `reviews`.
- `favorites`.
- `audit_logs`.
- Owner dashboard shell, after authorization migration.
- Admin dashboard shell, after queue expansion.

# Required additions

- `business_members`.
- `business_submissions`.
- `business_submission_documents`.
- `business_submission_images`.
- `business_submission_events`.
- `business_invitations`.
- General user/onboarding notifications.
- Onboarding screens.
- Admin onboarding review screens.
- Membership-aware authorization helpers.
- Private document Storage model.

# Required modifications

- Registration form and redirect logic.
- Account area.
- Public business representative CTA.
- Owner claim route.
- Owner authorization.
- Admin ownership claim UI.
- Owner upload Storage path/policies.
- Owner review reply/report status usage.
- Owner dashboard data source.

# Legacy elements to deprecate later

- Global `business_owner`.
- `businesses.owner_id` as the primary authorization source.
- Raw UUID ownership claim route.
- Narrow `ownership_claims` model if replaced by unified submissions.
- Moderator involvement in business approval.

# Recommended implementation sequence

1. Verify architecture/data.
2. Harden registration/profile.
3. Add `business_members`.
4. Backfill legacy owners.
5. Add onboarding draft/submission model.
6. Add commercial registration document storage.
7. Add existing-business verification.
8. Add new-business submission.
9. Add Admin review lifecycle.
10. Migrate owner dashboard authorization.
11. Add manager invitations.
12. Complete notifications/audit/tests/i18n.

# Product-owner decisions still required

The seven questions in section M should be answered before implementation begins.

# Explicit confirmation

No implementation was performed. I did not modify files, create migrations, execute SQL, alter Supabase data, upload Storage objects, commit, push, deploy, or change the UI.

AUDIT COMPLETE — NO IMPLEMENTATION PERFORMED
