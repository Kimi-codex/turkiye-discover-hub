import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "./require-admin.middleware";

type AppRole = "admin" | "moderator" | "business_owner" | "user";

/**
 * Gate probe used by the admin route loader. Returns ok:true when the
 * caller is authenticated AND has admin role, else throws 401/403.
 */
export const getAdminGate = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    return { ok: true as const, userId: context.userId };
  });

/**
 * Dashboard counters. Uses count-only queries. Independently re-verifies
 * admin (requireAdmin).
 */
export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const tables = [
      "businesses",
      "reviews",
      "reports",
      "ownership_claims",
      "categories",
      "cities",
      "import_batches",
    ] as const;
    const results = await Promise.all(
      tables.map((t) =>
        supabase
          .from(t)
          .select("*", { count: "exact", head: true })
          .then((r) => [t, r.count ?? 0] as const),
      ),
    );
    return Object.fromEntries(results) as Record<(typeof tables)[number], number>;
  });

interface AdminUserRow {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  full_name: string | null;
  roles: AppRole[];
}

/**
 * Users list — reads auth.users via service-role admin API, joined with
 * profiles + user_roles. Only display-safe fields returned. Never exposes
 * service-role key or tokens to the client.
 */
export const listUsersAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((input: { page?: number; perPage?: number } | undefined) => ({
    page: Math.max(1, Math.floor(input?.page ?? 1)),
    perPage: Math.min(200, Math.max(1, Math.floor(input?.perPage ?? 50))),
  }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
      page: data.page,
      perPage: data.perPage,
    });
    if (authErr) {
      console.error("[listUsersAdmin] auth.admin.listUsers", authErr);
      throw new Response("Failed to list users", { status: 500 });
    }
    const ids = authData.users.map((u) => u.id);
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      context.supabase.from("profiles").select("id, full_name").in("id", ids),
      context.supabase.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    const roleMap = new Map<string, AppRole[]>();
    for (const r of roles ?? []) {
      const list = roleMap.get(r.user_id) ?? [];
      list.push(r.role as AppRole);
      roleMap.set(r.user_id, list);
    }
    const users: AdminUserRow[] = authData.users.map((u) => ({
      id: u.id,
      email: u.email ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      full_name: profileMap.get(u.id)?.full_name ?? null,
      roles: roleMap.get(u.id) ?? [],
    }));
    return { users, page: data.page, perPage: data.perPage };
  });

/**
 * Grant/revoke a role. Delegates to set_user_role RPC which:
 *  - re-checks caller is admin (SECURITY DEFINER),
 *  - blocks removing the last admin,
 *  - writes an audit row atomically.
 */
export const setUserRoleAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (input: {
      targetUserId: string;
      role: AppRole;
      add: boolean;
      confirmSelf?: boolean;
    }) => {
      if (!input?.targetUserId || typeof input.targetUserId !== "string") {
        throw new Response("Invalid targetUserId", { status: 400 });
      }
      const allowed: AppRole[] = ["admin", "moderator", "business_owner", "user"];
      if (!allowed.includes(input.role)) {
        throw new Response("Invalid role", { status: 400 });
      }
      return {
        targetUserId: input.targetUserId,
        role: input.role,
        add: !!input.add,
        confirmSelf: !!input.confirmSelf,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("set_user_role", {
      _target_user: data.targetUserId,
      _role: data.role,
      _add: data.add,
      _confirm_self: data.confirmSelf,
    });
    if (error) {
      console.error("[setUserRoleAdmin]", error);
      throw new Response(error.message ?? "set_user_role failed", { status: 400 });
    }
    return res;
  });
