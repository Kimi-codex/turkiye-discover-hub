import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/$lang/_authenticated/admin")({
  ssr: false,
  component: AdminLayout,
});

function AdminLayout() {
  const { user, loading } = useAuth();
  const [adminState, setAdminState] = useState<"checking" | "allowed" | "denied">("checking");

  useEffect(() => {
    let cancelled = false;
    if (loading) return;
    if (!user) {
      setAdminState("denied");
      return;
    }
    setAdminState("checking");
    supabase
      .rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        setAdminState(!error && data === true ? "allowed" : "denied");
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  if (loading || adminState === "checking") {
    return <AdminAccessMessage title="Checking admin access…" />;
  }

  if (!user) {
    return <AdminAccessMessage title="401" message="You must be signed in to access the admin area." />;
  }

  if (adminState !== "allowed") {
    return <AdminAccessMessage title="403" message="You do not have permission to access the admin area." />;
  }

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}

function AdminAccessMessage({ title, message }: { title: string; message?: string }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <div className="mb-2 text-5xl font-semibold">{title}</div>
      {message ? <p className="text-muted-foreground">{message}</p> : null}
    </div>
  );
}
