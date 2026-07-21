import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Server-only middleware. Chains requireSupabaseAuth then verifies the
 * caller has the 'admin' role via the has_role SECURITY DEFINER function.
 * Throws a Response (401/403) on failure so no privileged data is ever
 * returned to a non-admin caller.
 */
export const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { supabase, userId } = context;
    if (!userId) {
      throw new Response("Unauthorized", { status: 401 });
    }
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (error) {
      console.error("[requireAdmin] has_role error", error);
      throw new Response("Forbidden", { status: 403 });
    }
    if (data !== true) {
      throw new Response("Forbidden", { status: 403 });
    }
    return next({ context: { supabase, userId, claims: context.claims } });
  });
