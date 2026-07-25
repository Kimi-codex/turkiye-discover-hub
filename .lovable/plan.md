# Review — Account & Settings Feature (commit `6045f39`)

Reviewed the 11 files from the last user commit. The feature is well structured: `useAccountState` derives one of six experience states (admin/owner/manager/applicant/prospect/explorer) from profile + memberships + onboarding + user_roles queries, then `account.tsx` renders adaptive cards, and `account.settings.tsx` provides profile editing. `PasswordInput` and its use in `auth.tsx` are clean.

## Issues found

### 1. Sign-out is missing the documented cache/nav sequence (`account.tsx:45-51`)
Current: `cancelQueries → clear → signOut → navigate(/{locale})`. Missing `replace: true` is fine here (navigate uses it), but it navigates to the public home instead of `/auth`, which is the documented pattern in `tanstack-auth-guards`. Not a bug — but inconsistent with the rest of the app. Minor.

### 2. Settings page saves to `auth.users.user_metadata` only, not `profiles` (`account.settings.tsx:39-50`)
`useAccountState` reads `full_name / phone / preferred_language` from the **`profiles`** table (line 121-133 of the hook). The settings form writes them to `supabase.auth.updateUser({ data })` which updates `raw_user_meta_data` on `auth.users` — a different place. Result: user hits Save, sees a success toast, but:
- The account page keeps showing the old profile values.
- The initial form values come from `user.user_metadata` (line 32-36) which was seeded at signup, so the form itself *looks* like it saved.

**Fix:** also `upsert` into `public.profiles` (or update it) with the same three columns. Ideally both, so `user_metadata` stays in sync for the auth object.

### 3. `hasChanges` compares against stale metadata (`account.settings.tsx:58-61`)
Compares against `user.user_metadata.*`, but Supabase doesn't refresh `user` after `updateUser` until `USER_UPDATED` fires and the root listener invalidates. Immediately after save, the button becomes disabled correctly, but if the user re-edits before the refresh they're comparing to stale values. Low priority — resolves once #2 is fixed and we invalidate `["account:profile"]`.

### 4. `useAccountState` has no `staleTime` and no shared invalidation
Six `useQuery` calls on every mount of `/account`, all with default `staleTime: 0`. Add `staleTime: 30_000` (or per-query values) so tab switches don't re-hit Supabase six times.

### 5. `notificationsQ` uses `(supabase as any)` cast (line 154, 170, 185)
Suggests the generated `Database` types don't include `user_notifications`, `business_onboarding_submissions`, or `business_members`. If those tables exist, regenerate types; if they don't, the queries silently fail at runtime for real users.

### 6. Favorites cover-image fallback fabricates an image record (`account.tsx:291-306`)
Passes a synthetic object with empty `id`/`placeId` to `getBusinessImageUrl`. Works, but brittle — if the helper ever validates ids, this breaks. Prefer a small dedicated helper `coverUrlFromRow(cover)`.

### 7. Password reset flow is missing
`PasswordInput` and the sign-in tab exist, but there is no "Forgot password?" link and no `/reset-password` route. Per platform guidance, this pair must ship together.

### 8. `redirect_uri` for Google OAuth (`auth.tsx:159-161`)
Points at `window.location.origin` (root). Fine for the platform rule, but the post-auth navigation logic lives in the `useEffect` at line 71-91 — meaning after Google returns to `/`, the user has to hit `/auth` again for the redirect to fire. Better: `redirect_uri: ${window.location.origin}/${locale}/auth` so the same post-login routing kicks in.

## Proposed fixes (build mode)

1. **Persist profile updates to `public.profiles`** in `account.settings.tsx` and invalidate `["account:profile"]`.
2. **Add `staleTime`** to the six queries in `use-account-state.ts` (30s reads, 10s for notifications).
3. **Regenerate Supabase types** or, if types can't reach those tables, wrap the casts in a typed helper.
4. **Add "Forgot password?" link** on sign-in tab + create `src/routes/$lang.reset-password.tsx`.
5. **Fix Google `redirect_uri`** to land back on `/{locale}/auth`.
6. **Extract `coverUrlFromRow`** helper (small cleanup).
7. **Align sign-out** to redirect to `/{locale}/auth` per platform guidance (optional — confirm intent).

Items 4 and 7 are behavior choices — confirm before I include them; the rest are safe fixes.

## Out of scope
- Larger owner-portal review (commit only touched shell/index/notifications/onboarding — didn't inspect those).
- i18n key coverage audit for the new `account.settings.*` keys.

Approve to apply fixes 1-3, 5, 6 (safe set), or tell me which of 4/7 to include.
