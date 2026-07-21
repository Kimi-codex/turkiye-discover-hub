import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listAuditLogsAdmin } from "@/lib/admin/domain.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/$lang/_authenticated/admin/audit-logs")({
  ssr: false,
  component: AuditLogsPage,
});

function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const q = useQuery({
    queryKey: ["admin", "audit", { page, action, entity }],
    queryFn: () =>
      listAuditLogsAdmin({
        data: {
          page,
          action: action || undefined,
          entityType: entity || undefined,
        },
      }),
  });
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Audit logs <span className="text-sm font-normal text-muted-foreground">({total})</span></h1>
      </div>
      <div className="flex gap-2 rounded-xl border bg-card p-3">
        <Input placeholder="action contains…" value={action} onChange={(e) => setAction(e.target.value)} className="max-w-xs" />
        <Input placeholder="entity type…" value={entity} onChange={(e) => setEntity(e.target.value)} className="max-w-xs" />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: Record<string, unknown>) => (
              <tr key={String(r.id)} className="border-t align-top">
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(String(r.created_at)).toLocaleString()}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{String(r.actor_id ?? "—")}</td>
                <td className="px-3 py-2 text-xs">{String(r.action)}</td>
                <td className="px-3 py-2 text-xs">
                  {String(r.entity_type ?? "—")} / <span className="font-mono">{String(r.entity_id ?? "")}</span>
                </td>
                <td className="px-3 py-2 text-xs">
                  <pre className="max-w-md overflow-x-auto rounded bg-muted p-1">
                    {JSON.stringify(r.metadata ?? {}, null, 2)}
                  </pre>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No entries
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Prev
        </Button>
        <span className="text-sm">Page {page}</span>
        <Button size="sm" variant="outline" disabled={rows.length < 100} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
