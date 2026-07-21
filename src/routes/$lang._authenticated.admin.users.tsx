import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listUsersAdmin, setUserRoleAdmin } from "@/lib/admin/admin.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type AppRole = "admin" | "moderator" | "business_owner" | "user";
const ROLES: AppRole[] = ["admin", "moderator", "business_owner"];

export const Route = createFileRoute("/$lang/_authenticated/admin/users")({
  ssr: false,
  component: UsersPage,
});

function UsersPage() {
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "users", page],
    queryFn: () => listUsersAdmin({ data: { page, perPage: 50 } }),
  });

  const mut = useMutation({
    mutationFn: (v: { targetUserId: string; role: AppRole; add: boolean; confirmSelf?: boolean }) =>
      setUserRoleAdmin({ data: v }),
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading users…</div>;
  if (q.error)
    return <div className="p-6 text-sm text-destructive">Failed: {(q.error as Error).message}</div>;

  const users = q.data?.users ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <div className="flex items-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <span>Page {page}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={users.length < 50}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Last sign-in</th>
              <th className="px-3 py-2">Roles</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{u.email ?? "—"}</td>
                <td className="px-3 py-2">{u.full_name ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length === 0 ? (
                      <span className="text-xs text-muted-foreground">user</span>
                    ) : (
                      u.roles.map((r) => (
                        <Badge key={r} variant="secondary">
                          {r}
                        </Badge>
                      ))
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    {ROLES.map((role) => {
                      const has = u.roles.includes(role);
                      return (
                        <Button
                          key={role}
                          size="sm"
                          variant={has ? "destructive" : "outline"}
                          disabled={mut.isPending}
                          onClick={() =>
                            mut.mutate({
                              targetUserId: u.id,
                              role,
                              add: !has,
                              confirmSelf: role === "admin" && has,
                            })
                          }
                        >
                          {has ? `Revoke ${role}` : `Grant ${role}`}
                        </Button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={5}>
                  No users
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
