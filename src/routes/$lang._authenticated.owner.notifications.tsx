import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listOwnerNotifications,
  markNotificationRead,
} from "@/lib/owner/owner.functions";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/$lang/_authenticated/owner/notifications")({
  ssr: false,
  beforeLoad: async ({ params }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/$lang/auth", params: { lang: params.lang } });
    const { data } = await supabase
      .from("business_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .in("role", ["owner", "manager"])
      .limit(1);
    if (!data || data.length === 0) {
      throw redirect({ to: "/$lang/account/notifications", params: { lang: params.lang } });
    }
  },
  component: NotificationsPage,
});

function NotificationsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listOwnerNotifications);
  const mark = useServerFn(markNotificationRead);
  const q = useQuery({ queryKey: ["owner:notifications"], queryFn: () => list() });
  const m = useMutation({
    mutationFn: (id: string) => mark({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner:notifications"] }),
  });

  return (
    <OwnerShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <ul className="rounded-xl border bg-card">
          {(q.data?.rows ?? []).map((n: {
            id: string; kind: string; created_at: string; read_at: string | null; payload: unknown;
          }) => (
            <li key={n.id} className="flex items-start justify-between border-b p-3 last:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{n.kind}</span>
                  {!n.read_at && <Badge variant="destructive">new</Badge>}
                </div>
                <pre className="mt-1 max-w-lg overflow-x-auto text-xs text-muted-foreground">{JSON.stringify(n.payload, null, 2)}</pre>
                <div className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</div>
              </div>
              {!n.read_at && (
                <Button size="sm" variant="ghost" onClick={() => m.mutate(n.id)}>Mark read</Button>
              )}
            </li>
          ))}
          {(q.data?.rows ?? []).length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">No notifications.</li>
          )}
        </ul>
      </div>
    </OwnerShell>
  );
}
