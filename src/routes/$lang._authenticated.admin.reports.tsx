import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listReportsAdmin, setReportStatusAdmin } from "@/lib/admin/domain.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const STATUSES = ["new", "in_review", "resolved", "rejected"] as const;

export const Route = createFileRoute("/$lang/_authenticated/admin/reports")({
  ssr: false,
  component: ReportsPage,
});

function ReportsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("new");
  const [notesFor, setNotesFor] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ["admin", "reports", status],
    queryFn: () => listReportsAdmin({ data: { status: status || undefined } }),
  });
  const mut = useMutation({
    mutationFn: (v: { id: string; status: (typeof STATUSES)[number]; internalNotes?: string }) =>
      setReportStatusAdmin({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = q.data?.rows ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <select
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Any</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-3">
        {rows.map((r: Record<string, unknown>) => (
          <div key={String(r.id)} className="rounded-xl border bg-card p-4">
            <div className="grid gap-2 md:grid-cols-[1fr_260px]">
              <div>
                <div className="text-sm font-medium">
                  {String(r.entity_type)} · {String(r.reason)}{" "}
                  <span className="text-xs text-muted-foreground">— status: {String(r.status)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Entity id: <span className="font-mono">{String(r.entity_id)}</span> · reporter:{" "}
                  <span className="font-mono">{String(r.reporter_id ?? "—")}</span>
                </div>
                <p className="mt-2 text-sm whitespace-pre-wrap">{String(r.description ?? "")}</p>
                <Textarea
                  className="mt-2"
                  placeholder="Internal notes…"
                  defaultValue={String(r.internal_notes ?? "")}
                  onChange={(e) => setNotesFor((n) => ({ ...n, [String(r.id)]: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                {STATUSES.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={r.status === s ? "default" : "outline"}
                    disabled={mut.isPending}
                    onClick={() =>
                      mut.mutate({
                        id: String(r.id),
                        status: s,
                        internalNotes: notesFor[String(r.id)],
                      })
                    }
                  >
                    Mark {s}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && !q.isLoading && (
          <div className="p-6 text-center text-sm text-muted-foreground">Nothing here</div>
        )}
      </div>
    </div>
  );
}
