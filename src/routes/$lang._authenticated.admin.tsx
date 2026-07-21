import { Outlet, createFileRoute, isRedirect } from "@tanstack/react-router";
import { getAdminGate } from "@/lib/admin/admin.functions";
import { AdminShell } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/$lang/_authenticated/admin")({
  ssr: false,
  loader: async () => {
    try {
      await getAdminGate();
      return { ok: true as const };
    } catch (err) {
      if (isRedirect(err)) throw err;
      // Server threw 401/403 — surface it to errorComponent, do NOT render shell.
      const status =
        err instanceof Response
          ? err.status
          : (err as { status?: number } | undefined)?.status ?? 403;
      throw new Response(status === 401 ? "Unauthorized" : "Forbidden", { status });
    }
  },
  component: AdminLayout,
  errorComponent: AdminErrorPage,
});

function AdminLayout() {
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}

function AdminErrorPage({ error }: { error: unknown }) {
  const status =
    error instanceof Response
      ? error.status
      : (error as { status?: number } | undefined)?.status ?? 403;
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <div className="mb-2 text-5xl font-semibold">{status}</div>
      <p className="text-muted-foreground">
        {status === 401
          ? "You must be signed in to access the admin area."
          : "You do not have permission to access the admin area."}
      </p>
    </div>
  );
}
