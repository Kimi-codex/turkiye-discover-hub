/**
 * Owner authorization helper.
 *
 * Every business-scoped owner server function MUST call `assertOwns` FIRST
 * with the businessId taken from validated input (never trust arbitrary
 * client data). The `owner_authz` RPC in the DB checks in one round-trip
 * that the caller is authenticated, not suspended, and either has an active
 * owner membership for the specific business or matches the legacy
 * owner_id + business_owner fallback. RLS on `businesses` still applies as a
 * second line of defense.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

export type OwnerAuthzOk = {
  ok: true;
  user_id: string;
  business_id: string;
  status: string;
};

export type OwnerAuthzErr = {
  ok: false;
  code:
    | "NOT_AUTHENTICATED"
    | "SUSPENDED"
    | "MISSING_ROLE"
    | "BUSINESS_MISSING"
    | "NOT_OWNER"
    | "BUSINESS_DELETED";
};

export async function assertOwns(
  supabase: Sb,
  businessId: string,
): Promise<OwnerAuthzOk> {
  if (!businessId || typeof businessId !== "string") {
    throw new Response("Bad request", { status: 400 });
  }
  const { data, error } = await supabase.rpc("owner_authz", {
    _business_id: businessId,
  });
  if (error) {
    console.error("[owner_authz] rpc error", error);
    throw new Response("Forbidden", { status: 403 });
  }
  const res = data as OwnerAuthzOk | OwnerAuthzErr;
  if (!res || !res.ok) {
    const code = (res as OwnerAuthzErr | null)?.code ?? "NOT_OWNER";
    const status =
      code === "NOT_AUTHENTICATED"
        ? 401
        : code === "BUSINESS_MISSING"
          ? 404
          : 403;
    throw new Response(code, { status });
  }
  return res;
}
