# Admin bootstrap procedure

The first administrator is created via a one-time database RPC. There is no
hardcoded admin email and no in-app "make me admin" button.

## Prerequisites

1. Sign up in the app (email/password or Google) at `/tr/auth`. This creates
   the `auth.users` row and, via the `handle_new_user` trigger, a matching
   `profiles` row and a default `user` role in `public.user_roles`.
2. Find your `auth.users.id` (UUID). Use the Backend view → SQL editor and run:

   ```sql
   select id, email from auth.users order by created_at desc limit 5;
   ```

## Promote to admin (first time only)

While no admins exist yet, execute:

```sql
select public.bootstrap_admin('<your-user-uuid>');
```

Behavior:

- Fails with `bootstrap_admin disabled: admins already exist` if there is
  already at least one admin. This is intentional — once an admin exists, all
  future role changes must go through `set_user_role` (invoked from the admin
  UI) so they are audited and gated.
- Idempotent — running it twice for the same user is a no-op the first time
  when an admin already exists.
- Writes an `admin.bootstrap` row to `public.audit_logs`.

## Revocation & re-bootstrapping

After the first successful bootstrap, `EXECUTE` on `public.bootstrap_admin(uuid)`
is revoked from `anon` and `authenticated`. Only the backend `service_role`
can still call it. If you ever lose all admins (e.g. every admin is deleted),
recovery requires:

1. Confirm zero rows in `user_roles` with `role='admin'`.
2. Re-run `select public.bootstrap_admin('<uuid>');` from the Backend SQL
   editor (which runs as `service_role`).

Do NOT re-grant execute to `authenticated` — that would allow any signed-in
user to seize the platform the moment no admins exist.

## Adding further admins

Once you are an admin, use the Admin → Users page. Behind the scenes it calls
`set_user_role` which:

- Verifies the caller is an admin.
- Refuses removal of the last remaining admin.
- Refuses removal of your own admin role unless you confirm explicitly.
- Writes an audit row for every grant / revoke.
